import { describeError, envInt, getConfig, runLlm, type LlmResult } from "@/lib/llm";
import { SYSTEM_PROMPT } from "@/lib/prompts";
import { clientKey, rateLimit } from "@/lib/rate-limit";

// Vercel accepts 60 s on every plan. With Fluid compute on (the default for new
// projects) you can raise this to 300 if long answers get cut off.
export const maxDuration = 60;

// POST { prompt: string, stream?: boolean }
//   stream: true  -> text/plain stream of the answer (what the UI uses)
//   stream: false -> JSON { text, provider, model, refused, truncated, ms } (what eval uses)
export async function POST(request: Request) {
  const cfg = getConfig();
  if (!cfg) {
    return Response.json(
      { error: "No model key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY (see .env.example)." },
      { status: 500 },
    );
  }

  if (process.env.NODE_ENV === "production") {
    const limit = rateLimit(clientKey(request), envInt("RATE_LIMIT_PER_10_MIN", 30));
    if (!limit.ok) {
      return Response.json(
        { error: "Too many requests. Try again in a few minutes." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
      );
    }
  }

  let body: { prompt?: unknown; stream?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON like {\"prompt\": \"...\"}." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return Response.json({ error: "prompt is empty." }, { status: 400 });
  const maxChars = envInt("MAX_INPUT_CHARS", 20000);
  if (prompt.length > maxChars) {
    return Response.json({ error: `prompt is longer than ${maxChars} characters.` }, { status: 413 });
  }

  const upstream = new AbortController();
  request.signal.addEventListener("abort", () => upstream.abort());
  const started = Date.now();
  const llmInput = {
    prompt,
    system: SYSTEM_PROMPT,
    maxTokens: envInt("LLM_MAX_TOKENS", 8192),
    signal: upstream.signal,
  };

  if (body.stream !== true) {
    try {
      const result = await runLlm(cfg, llmInput);
      return Response.json({ ...result, ms: Date.now() - started });
    } catch (err) {
      console.error("[api/llm]", err);
      const { status, message } = describeError(err);
      return Response.json({ error: message }, { status });
    }
  }

  // Streaming: hold the response until the first token (or an error) arrives,
  // so a bad key or model ID still comes back as a real HTTP error.
  const encoder = new TextEncoder();
  const buffered: string[] = [];
  let sink: ReadableStreamDefaultController<Uint8Array> | null = null;
  let markFirstToken: () => void = () => {};
  const firstToken = new Promise<void>((resolve) => (markFirstToken = resolve));

  const run = runLlm(cfg, {
    ...llmInput,
    onText: (delta) => {
      if (sink) sink.enqueue(encoder.encode(delta));
      else buffered.push(delta);
      markFirstToken();
    },
  });

  try {
    await Promise.race([firstToken, run]);
  } catch (err) {
    console.error("[api/llm]", err);
    const { status, message } = describeError(err);
    return Response.json({ error: message }, { status });
  }

  const finish = (controller: ReadableStreamDefaultController<Uint8Array>, tail?: string) => {
    try {
      if (tail) controller.enqueue(encoder.encode(tail));
      controller.close();
    } catch {
      // client already disconnected
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      sink = controller;
      for (const delta of buffered.splice(0)) controller.enqueue(encoder.encode(delta));
      run.then(
        (result: LlmResult) => {
          if (result.refused) finish(controller, "\n\n[The model declined this request.]");
          else if (result.truncated) finish(controller, "\n\n[Answer cut off at the token limit.]");
          else finish(controller);
        },
        (err: unknown) => {
          console.error("[api/llm]", err);
          finish(controller, `\n\n[Error: ${describeError(err).message}]`);
        },
      );
    },
    cancel() {
      upstream.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-LLM-Provider": cfg.provider,
      "X-LLM-Model": cfg.model,
    },
  });
}

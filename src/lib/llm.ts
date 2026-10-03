import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// One call path for both providers. Keys stay on the server: this file is only
// imported by route handlers, never by client components.

export type Provider = "anthropic" | "openai";

export type LlmConfig = { provider: Provider; model: string };

export type LlmInput = {
  prompt: string;
  system: string;
  maxTokens: number;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
};

export type LlmResult = {
  text: string;
  provider: Provider;
  model: string; // the model that served the request (Claude can fall back)
  refused: boolean;
  truncated: boolean;
};

const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
const DEFAULT_OPENAI_MODEL = "gpt-6.1-sol";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

// LLM_PROVIDER wins. Otherwise use whichever key is set (Anthropic first).
export function getConfig(): LlmConfig | null {
  const explicit = process.env.LLM_PROVIDER?.trim().toLowerCase();
  let provider: Provider | null = null;
  if (explicit === "anthropic" || explicit === "openai") provider = explicit;
  else if (process.env.ANTHROPIC_API_KEY) provider = "anthropic";
  else if (process.env.OPENAI_API_KEY) provider = "openai";
  if (!provider) return null;

  const model =
    provider === "anthropic"
      ? process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL
      : process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  return { provider, model };
}

export function envInt(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export async function runLlm(cfg: LlmConfig, input: LlmInput): Promise<LlmResult> {
  return cfg.provider === "anthropic" ? runAnthropic(cfg, input) : runOpenAI(cfg, input);
}

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

// Claude 5.x models take adaptive thinking, effort and server-side refusal
// fallbacks. Older models (e.g. claude-haiku-4-5) get a plain request.
function isClaude5(model: string): boolean {
  return /^claude-(fable|opus|sonnet|mythos)-[5-9]/.test(model);
}

async function runAnthropic(cfg: LlmConfig, input: LlmInput): Promise<LlmResult> {
  anthropicClient ??= new Anthropic(); // reads ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL)

  const effortEnv = process.env.ANTHROPIC_EFFORT?.trim() as Effort | undefined;
  const effort: Effort = effortEnv && EFFORTS.includes(effortEnv) ? effortEnv : "medium";

  const base = {
    model: cfg.model,
    max_tokens: input.maxTokens,
    system: input.system,
    messages: [{ role: "user" as const, content: input.prompt }],
  };

  // fallbacks: "default" re-runs a policy decline on Anthropic's recommended
  // fallback model inside the same call (beta server-side-fallback-2026-07-01).
  const stream = isClaude5(cfg.model)
    ? anthropicClient.beta.messages.stream(
        {
          ...base,
          thinking: { type: "adaptive" },
          output_config: { effort },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal: input.signal },
      )
    : anthropicClient.beta.messages.stream(base, { signal: input.signal });

  stream.on("text", (delta) => input.onText?.(delta));
  const message = await stream.finalMessage();

  const refused = message.stop_reason === "refusal";
  const text = message.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  return {
    // A refusal can arrive mid-stream; drop the partial text.
    text: refused ? "" : text,
    provider: "anthropic",
    model: message.model,
    refused,
    truncated: message.stop_reason === "max_tokens",
  };
}

async function runOpenAI(cfg: LlmConfig, input: LlmInput): Promise<LlmResult> {
  openaiClient ??= new OpenAI(); // reads OPENAI_API_KEY (and OPENAI_BASE_URL)

  const stream = await openaiClient.responses.create(
    {
      model: cfg.model,
      instructions: input.system,
      input: input.prompt,
      max_output_tokens: input.maxTokens,
      stream: true,
    },
    { signal: input.signal },
  );

  let text = "";
  let model = cfg.model;
  let refused = false;
  let truncated = false;

  for await (const event of stream) {
    switch (event.type) {
      case "response.output_text.delta":
        text += event.delta;
        input.onText?.(event.delta);
        break;
      case "response.refusal.delta":
        refused = true;
        break;
      case "response.completed":
        model = event.response.model;
        break;
      case "response.incomplete": {
        model = event.response.model;
        const reason = event.response.incomplete_details?.reason;
        truncated = reason === "max_output_tokens";
        refused ||= reason === "content_filter";
        break;
      }
      case "response.failed":
        throw new Error(event.response.error?.message ?? "OpenAI response failed");
      case "error":
        throw new Error(event.message);
    }
  }

  return { text: refused ? "" : text, provider: "openai", model, refused, truncated };
}

// Maps SDK errors to an HTTP status and a message that is safe to show in the
// browser. Full details go to the server log (Vercel > Logs).
export function describeError(err: unknown): { status: number; message: string } {
  const dev = process.env.NODE_ENV !== "production";
  const detail = err instanceof Error ? err.message : String(err);

  if (err instanceof Anthropic.AuthenticationError || err instanceof OpenAI.AuthenticationError) {
    return { status: 502, message: "The API key was rejected. Check the key in your env vars." };
  }
  if (err instanceof Anthropic.RateLimitError || err instanceof OpenAI.RateLimitError) {
    return { status: 429, message: "The model provider is rate limiting us. Try again in a minute." };
  }
  if (err instanceof Anthropic.BadRequestError || err instanceof OpenAI.BadRequestError) {
    return { status: 400, message: dev ? `Bad request: ${detail}` : "The model rejected this request." };
  }
  if (err instanceof Anthropic.APIError || err instanceof OpenAI.APIError) {
    return { status: 502, message: dev ? `Provider error: ${detail}` : "The model provider returned an error." };
  }
  return { status: 500, message: dev ? detail : "Something went wrong." };
}

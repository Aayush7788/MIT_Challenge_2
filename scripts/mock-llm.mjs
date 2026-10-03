// Local stand-in for the Anthropic and OpenAI APIs, so UI work doesn't spend
// credits. It only echoes the prompt. Never record demo videos or eval numbers
// against it.
//
// Special prompts for testing error paths:
//   MOCK_ERROR      -> 401 from the provider
//   MOCK_REFUSE     -> the model declines
//   MOCK_MAXTOKENS  -> answer cut off at the token limit
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text ?? textOf(part?.content))).join(" ");
  }
  return "";
}

function reply(prompt) {
  return `(mock) You asked: "${prompt.slice(0, 120)}". Put a real API key in .env.local to get model answers.`;
}

const pieces = (text) => text.match(/\S+\s*/g) ?? [text];

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function startSse(res) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
}

async function anthropic(res, body) {
  const prompt = textOf(body.messages?.at(-1)?.content);
  if (prompt.includes("MOCK_ERROR")) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key (mock)" } }));
    return;
  }

  const refuse = prompt.includes("MOCK_REFUSE");
  const stopReason = refuse ? "refusal" : prompt.includes("MOCK_MAXTOKENS") ? "max_tokens" : "end_turn";
  const text = reply(prompt);
  const id = `msg_mock_${Date.now()}`;
  const model = body.model ?? "mock";

  if (!body.stream) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id, type: "message", role: "assistant", model,
      content: refuse ? [] : [{ type: "text", text }],
      stop_reason: stopReason, stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20 },
    }));
    return;
  }

  startSse(res);
  sse(res, "message_start", {
    type: "message_start",
    message: { id, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } },
  });
  // A mid-stream refusal still streams some text first, like the real API.
  const streamed = refuse ? pieces(text).slice(0, 3) : pieces(text);
  sse(res, "content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  for (const piece of streamed) {
    await sleep(25);
    sse(res, "content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } });
  }
  sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
  sse(res, "message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: streamed.length } });
  sse(res, "message_stop", { type: "message_stop" });
  res.end();
}

async function openai(res, body) {
  const prompt = textOf(body.input);
  if (prompt.includes("MOCK_ERROR")) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Incorrect API key provided (mock).", type: "invalid_request_error", code: "invalid_api_key" } }));
    return;
  }

  const refuse = prompt.includes("MOCK_REFUSE");
  const truncate = prompt.includes("MOCK_MAXTOKENS");
  const text = reply(prompt);
  const id = `resp_mock_${Date.now()}`;
  const model = body.model ?? "mock";
  const done = (status) => ({
    id, object: "response", model, status,
    incomplete_details: truncate ? { reason: "max_output_tokens" } : null,
    output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }],
  });

  if (!body.stream) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(done(truncate ? "incomplete" : "completed")));
    return;
  }

  startSse(res);
  let seq = 0;
  sse(res, "response.created", { type: "response.created", sequence_number: seq++, response: { id, object: "response", model, status: "in_progress", output: [] } });
  if (refuse) {
    sse(res, "response.refusal.delta", { type: "response.refusal.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: "I can't help with that.", sequence_number: seq++ });
  } else {
    for (const piece of pieces(text)) {
      await sleep(25);
      sse(res, "response.output_text.delta", { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: piece, logprobs: [], sequence_number: seq++ });
    }
  }
  const final = truncate ? "response.incomplete" : "response.completed";
  sse(res, final, { type: final, sequence_number: seq++, response: done(truncate ? "incomplete" : "completed") });
  res.end();
}

const server = http.createServer(async (req, res) => {
  const path = (req.url ?? "").split("?")[0];
  try {
    const body = req.method === "POST" ? await readJson(req) : {};
    if (process.env.MOCK_LOG) {
      const hidden = ["messages", "input", "instructions", "system"];
      const params = Object.fromEntries(Object.entries(body).filter(([key]) => !hidden.includes(key)));
      console.log(req.method, req.url, `beta=${req.headers["anthropic-beta"] ?? "-"}`, JSON.stringify(params));
    }
    if (req.method === "POST" && path === "/v1/messages") return await anthropic(res, body);
    if (req.method === "POST" && path === "/v1/responses") return await openai(res, body);
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `mock: no route for ${req.method} ${path}` } }));
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: String(err) } }));
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock LLM API on http://127.0.0.1:${PORT}`));

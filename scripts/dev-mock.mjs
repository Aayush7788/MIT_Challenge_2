// Runs the mock model API and `next dev` together, so you can build UI without
// spending credits. Usage: npm run dev:mock          (Claude-shaped mock)
//                          npm run dev:mock -- --openai
import { spawn } from "node:child_process";

const provider = process.argv.includes("--openai") ? "openai" : "anthropic";
const port = process.env.MOCK_PORT ?? "4010";

// Real env vars override .env.local in Next.js, so these win over your real keys.
const env = {
  ...process.env,
  LLM_PROVIDER: provider,
  ANTHROPIC_API_KEY: "mock-key",
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
  OPENAI_API_KEY: "mock-key",
  OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
};
delete env.ANTHROPIC_AUTH_TOKEN; // a token from your shell profile would override the mock key

const children = [
  spawn(process.execPath, ["scripts/mock-llm.mjs"], { stdio: "inherit", env }),
  spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev"], { stdio: "inherit", env }),
];

const stop = () => {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) child.on("exit", (code) => code && stop());

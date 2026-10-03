import { getConfig } from "@/lib/llm";

// Quick deploy check: open /api/health on the live URL. Never returns keys.
export async function GET() {
  const cfg = getConfig();
  return Response.json({
    ok: cfg !== null,
    llm: cfg,
    hint: cfg ? undefined : "Set ANTHROPIC_API_KEY or OPENAI_API_KEY in the deployment's env vars.",
  });
}

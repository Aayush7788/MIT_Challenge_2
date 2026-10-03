// Loads .env.local for scripts and lets it win over the shell. Without this, a
// shell profile that exports ANTHROPIC_API_KEY="" or ANTHROPIC_BASE_URL (e.g. for
// Claude Code through another provider) would silently redirect or break calls.
import fs from "node:fs";

const file = ".env.local";
const fromFile = new Set<string>();
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || !m[2]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    fromFile.add(m[1]);
  }
}
for (const name of ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]) {
  if (!fromFile.has(name)) delete process.env[name];
}

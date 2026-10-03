// Adds a new law in one go (we built it for the hour-16 ordinance, but it works
// for a new city too). It saves the text, extracts rule cards, reruns every
// address, adds a change test for the law and prints what changed.
//
//   npx tsx scripts/ingest.ts drop/ordinance.txt --jurisdiction "Cambridge, MA"
//   npx tsx scripts/ingest.ts drop/                      # every .txt/.pdf in a folder
//   npx tsx scripts/ingest.ts drop/ord.txt --tests drop/change_tests.json   # organizer-supplied test
import "./load-env";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeRules } from "../src/lib/law/rules";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!target) {
  console.error('usage: npx tsx scripts/ingest.ts <file-or-folder> [--jurisdiction "City, ST"] [--test-id T6] [--tests file.json]');
  process.exit(1);
}
const JURISDICTION = opt("jurisdiction");
const TEST_ID = opt("test-id") ?? "T6";
const EXTRA_TESTS = "data/derived/extra_change_tests.json";
const QUERY_DATE = "2026-10-01";

const run = (cmd: string, cmdArgs: string[]) => execFileSync(cmd, cmdArgs, { stdio: "inherit" });

function textOf(file: string): string {
  if (file.toLowerCase().endsWith(".pdf")) {
    return execFileSync("python3", ["-c", "import sys; from pypdf import PdfReader; print('\\n'.join((p.extract_text() or '') for p in PdfReader(sys.argv[1]).pages))", file], { encoding: "utf8" });
  }
  return fs.readFileSync(file, "utf8");
}

function main() {
  const files = fs.statSync(target!).isDirectory()
    ? fs.readdirSync(target!).filter((f) => /\.(txt|pdf|md)$/i.test(f)).map((f) => path.join(target!, f))
    : [target!];
  fs.mkdirSync("corpus_extra", { recursive: true });
  const manifestPath = "corpus_extra/manifest.csv";
  const manifest = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf8").trimEnd() : "doc_id,jurisdictions,url,source_type,retrieved_at,sha256,text_file,note";
  const rows = [manifest];
  const docIds: string[] = [];

  for (const f of files) {
    const stem = path.basename(f).replace(/\.[^.]+$/, "");
    const docId = /^[A-Z]{1,3}\d{2,4}$/i.test(stem) ? stem.toUpperCase() : `N${crypto.createHash("sha1").update(stem).digest("hex").slice(0, 4).toUpperCase()}`;
    let text = textOf(f).replace(/\r\n/g, "\n");
    const has = (k: string) => new RegExp(`^${k}:`, "im").test(text.slice(0, 600));
    const header: string[] = [];
    if (!has("SOURCE")) header.push(`SOURCE: ${path.resolve(f)}`);
    if (!has("RETRIEVED")) header.push(`RETRIEVED: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`);
    if (!has("JURISDICTION") && JURISDICTION) header.push(`JURISDICTION: ${JURISDICTION}`);
    if (header.length) text = `${header.join("\n")}\n\n${text}`;
    const out = `corpus_extra/${docId}.txt`;
    fs.writeFileSync(out, text);
    const sha = crypto.createHash("sha256").update(text).digest("hex");
    const src = text.match(/^SOURCE:\s*(.+)$/im)?.[1] ?? f;
    const jur = text.match(/^JURISDICTION:\s*(.+)$/im)?.[1] ?? JURISDICTION ?? "";
    rows.push([docId, `"${jur}"`, src, "new document added with scripts/ingest.ts", new Date().toISOString().slice(0, 16) + "Z", sha, out, `"ingested from ${path.basename(f)}"`].join(","));
    docIds.push(docId);
    console.log(`saved ${out} (${text.length.toLocaleString()} chars)${jur ? `, jurisdiction ${jur}` : ", no jurisdiction header: extraction will infer it"}`);
  }
  // keep one manifest row per doc_id (latest wins)
  const seen = new Set<string>();
  const dedup = rows.reverse().filter((r, i) => {
    if (i === rows.length - 1) return true; // header
    const id = r.split(",")[0];
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).reverse();
  fs.writeFileSync(manifestPath, dedup.join("\n") + "\n");

  console.log("\n== extracting (only new documents call the model)");
  run("npx", ["tsx", "scripts/extract.ts"]);
  console.log("\n== every address, as of 2026-10-01");
  run("npx", ["tsx", "scripts/lookup.ts"]);

  const rules = normalizeRules(JSON.parse(fs.readFileSync("submission/rules.json", "utf8"))).rules;
  const fresh = rules.filter((r) => docIds.includes(r.source_doc_id));
  console.log(`\n== ${fresh.length} rule card(s) from the new document(s)`);
  for (const r of fresh) {
    console.log(`  ${r.team_rule_id}  ${r.jurisdiction} | ${r.category} | ${r.status}${r.effective_date ? ` | effective ${r.effective_date}` : ""}\n      ${r.citation}\n      ${r.requirement}`);
  }

  // Make a change test for the new law. If it takes effect later we compare the
  // query date with its effective date. If it's already in force we just list
  // where it reaches today.
  if (!opt("tests") && fresh.length) {
    const future = fresh.filter((r) => r.effective_date && r.effective_date > QUERY_DATE);
    const test = future.length
      ? { test_id: TEST_ID, title: `New law: ${fresh[0].title}`, type: "as_of", team_rule_ids: fresh.map((r) => r.team_rule_id), as_of_before: QUERY_DATE, as_of_after: future.map((r) => r.effective_date!).sort()[0] }
      : { test_id: TEST_ID, title: `New law: ${fresh[0].title}`, type: "boundary", team_rule_ids: fresh.map((r) => r.team_rule_id), as_of: QUERY_DATE };
    const existing = fs.existsSync(EXTRA_TESTS) ? (JSON.parse(fs.readFileSync(EXTRA_TESTS, "utf8")) as { test_id: string }[]) : [];
    fs.writeFileSync(EXTRA_TESTS, JSON.stringify([...existing.filter((t) => t.test_id !== TEST_ID), test], null, 1));
    console.log(`\nwrote ${TEST_ID} to ${EXTRA_TESTS} (${test.type}${"as_of_after" in test ? `, ${QUERY_DATE} vs ${test.as_of_after}` : ""})`);
  }

  console.log("\n== change tracking");
  run("npx", ["tsx", "scripts/changes.ts", ...(opt("tests") ? ["--tests", `dev/change_tests.json,${opt("tests")}`] : [])]);
  const changes = JSON.parse(fs.readFileSync("submission/changes.json", "utf8"));
  if (changes[TEST_ID]) console.log(`\n${TEST_ID}: ${changes[TEST_ID].affected_address_ids.length} affected addresses. ${changes[TEST_ID].notes}`);
  console.log("\n== self-check");
  run("python3", ["scripts/selfscore.py"]);
  console.log("\nNext: npm run check, then commit and push (Vercel redeploys).");
}

main();

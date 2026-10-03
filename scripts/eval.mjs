// Scores an endpoint on a fixed set of cases and saves the run.
//
//   npm run eval                                   # localhost:3000/api/llm, eval/cases.jsonl
//   npm run eval -- --url http://localhost:3000/api/llm --label baseline
//   npm run eval -- --url http://localhost:3000/api/yourfeature --label product
//   npm run eval -- --compare eval/results/baseline-....json eval/results/product-....json
//
// The endpoint must accept POST {"prompt": "...", "stream": false} and return {"text": "..."}.
// Case format (one JSON object per line in the .jsonl file):
//   {"id": "q1", "input": "prompt text", "expected": "Paris", "match": "contains"}
//   match: "contains" (default, case-insensitive), "exact", or "regex"
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));

if (args.compare) {
  compare([args.compare, ...args._]);
} else {
  await run();
}

async function run() {
  const url = args.url ?? "http://localhost:3000/api/llm";
  const casesPath = args.cases ?? "eval/cases.jsonl";
  const label = args.label ?? "run";
  const concurrency = Number(args.concurrency ?? 2);

  const cases = loadCases(casesPath);
  console.log(`Running ${cases.length} cases against ${url} (label: ${label})\n`);

  const results = await pool(cases, concurrency, async (c) => {
    const result = await runCase(url, c);
    const status = result.pass ? "PASS" : "FAIL";
    const why = result.error
      ? `error: ${result.error}`
      : result.pass
        ? ""
        : `expected ${result.match} "${c.expected}", got "${oneLine(result.output).slice(0, 80)}"`;
    console.log(`${status}  ${c.id}  (${(result.ms / 1000).toFixed(1)}s)  ${why}`);
    return result;
  });

  const passed = results.filter((r) => r.pass).length;
  const [lo, hi] = wilson(passed, results.length);
  console.log(`\n${label}: ${passed}/${results.length} passed = ${pct(passed / results.length)} (95% CI ${pct(lo)} to ${pct(hi)})`);

  const outDir = args.out ?? "eval/results";
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(outDir, `${label}-${stamp}.json`);
  const summary = { label, url, when: new Date().toISOString(), passed, n: results.length, ci95: [lo, hi] };
  fs.writeFileSync(file, JSON.stringify({ ...summary, cases: results }, null, 2));
  console.log(`Saved ${file}`);
}

async function runCase(url, c) {
  const started = Date.now();
  const match = c.match ?? "contains";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: c.input, stream: false }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { id: c.id, pass: false, match, error: data.error ?? `HTTP ${res.status}`, ms: Date.now() - started };
    const output = data.text ?? "";
    return { id: c.id, pass: score(match, c.expected, output), match, expected: c.expected, output, refused: Boolean(data.refused), ms: Date.now() - started };
  } catch (err) {
    return { id: c.id, pass: false, match, error: err instanceof Error ? err.message : String(err), ms: Date.now() - started };
  }
}

function score(match, expected, output) {
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
  if (match === "exact") return norm(output) === norm(expected);
  if (match === "regex") return new RegExp(expected, "i").test(output);
  return norm(output).includes(norm(expected));
}

// Paired comparison of two saved runs on the same cases.
function compare(files) {
  if (files.length !== 2) throw new Error("--compare needs exactly two result files");
  const [a, b] = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
  for (const r of [a, b]) {
    const [lo, hi] = wilson(r.passed, r.n);
    console.log(`${r.label}: ${r.passed}/${r.n} = ${pct(r.passed / r.n)} (95% CI ${pct(lo)} to ${pct(hi)})`);
  }
  const bPass = new Map(b.cases.map((c) => [c.id, c.pass]));
  let both = 0, onlyA = 0, onlyB = 0, neither = 0;
  for (const c of a.cases) {
    if (!bPass.has(c.id)) continue;
    const pb = bPass.get(c.id);
    if (c.pass && pb) both++;
    else if (c.pass) onlyA++;
    else if (pb) onlyB++;
    else neither++;
  }
  console.log(`\nBoth pass ${both}, only ${a.label} ${onlyA}, only ${b.label} ${onlyB}, neither ${neither}`);
  console.log(`McNemar exact p = ${mcnemar(onlyA, onlyB).toFixed(4)} (two-sided, on the ${onlyA + onlyB} cases where they disagree)`);
}

function mcnemar(x, y) {
  const n = x + y;
  if (n === 0) return 1;
  let tail = 0;
  let coef = 1; // C(n, i)
  for (let i = 0; i <= Math.min(x, y); i++) {
    tail += coef;
    coef = (coef * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}

function wilson(k, n, z = 1.96) {
  if (n === 0) return [0, 0];
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

function loadCases(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const cases = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("//")) return;
    const c = JSON.parse(t);
    if (!c.id || typeof c.input !== "string" || typeof c.expected !== "string") {
      throw new Error(`${file}:${i + 1} needs "id", "input" and "expected"`);
    }
    cases.push(c);
  });
  return cases;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  return out;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) out[key] = true;
    else {
      out[key] = value;
      i++;
    }
  }
  return out;
}

function pct(x) {
  return `${(100 * x).toFixed(0)}%`;
}

function oneLine(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

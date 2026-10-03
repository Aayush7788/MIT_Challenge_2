import fs from "node:fs";
import path from "node:path";
import type { Address } from "./schema";

// Reads the RealPage starter pack from disk. It sits at the repo root
// (corpus/, data/, dev/, schema/); official texts the team captures for
// link-only sources go in corpus_extra/<doc_id>.txt, headed by
// "SOURCE: <url>" and "RETRIEVED: <date>" lines.

export const PACK_DIR = process.cwd();
export const EXTRA_DIR = path.join(process.cwd(), "corpus_extra");

export type CorpusDoc = {
  doc_id: string;
  jurisdictions: string;
  url: string;
  source_type: string;
  retrieved_at: string | null;
  text: string;
};

// Minimal CSV parser (quoted fields, commas and newlines inside quotes).
export function parseCsv(raw: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) {
      if (c === '"' && raw[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && raw[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((v) => v.trim() !== ""));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

export function loadCorpus(dir = PACK_DIR): CorpusDoc[] {
  const manifest = parseCsv(fs.readFileSync(path.join(dir, "corpus", "corpus_manifest.csv"), "utf8"));
  const docs: CorpusDoc[] = [];
  for (const m of manifest) {
    const file = path.join(dir, "corpus", "text", `${m.doc_id}.txt`);
    if (!fs.existsSync(file)) continue; // link-only sources have no text
    docs.push({
      doc_id: m.doc_id,
      jurisdictions: m.jurisdictions,
      url: m.url,
      source_type: m.source_type,
      retrieved_at: m.retrieved_at || null,
      text: fs.readFileSync(file, "utf8"),
    });
  }
  if (dir === PACK_DIR && fs.existsSync(EXTRA_DIR)) docs.push(...loadExtra(manifest, new Set(docs.map((d) => d.doc_id))));
  return docs;
}

function loadExtra(manifest: Record<string, string>[], have: Set<string>): CorpusDoc[] {
  const byId = new Map(manifest.map((m) => [m.doc_id, m]));
  const out: CorpusDoc[] = [];
  for (const f of fs.readdirSync(EXTRA_DIR).filter((n) => n.endsWith(".txt")).sort()) {
    const doc_id = f.replace(/\.txt$/, "");
    if (have.has(doc_id)) continue; // the starter pack copy wins
    const text = fs.readFileSync(path.join(EXTRA_DIR, f), "utf8");
    const header = (name: string) => text.match(new RegExp(`^${name}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? null;
    const m = byId.get(doc_id);
    out.push({
      doc_id,
      jurisdictions: header("JURISDICTION") ?? m?.jurisdictions ?? "",
      url: header("SOURCE") ?? m?.url ?? "",
      source_type: "official text captured by the team (not in the starter pack)",
      retrieved_at: header("RETRIEVED"),
      text,
    });
  }
  return out;
}

export function loadAddresses(dir = PACK_DIR): Address[] {
  const rows = parseCsv(fs.readFileSync(path.join(dir, "data", "sample_addresses.csv"), "utf8"));
  const num = (v: string) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return rows.map((r) => ({
    address_id: r.address_id,
    street_address: r.street_address,
    postal_city: r.postal_city,
    state: r.state,
    zip: r.zip,
    year_built: num(r.year_built),
    units: num(r.units),
    use_code: r.use_code,
    use_description: r.use_description,
  }));
}

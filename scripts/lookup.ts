// Part 2: runs the rules engine over every sample address and writes the
// submission files, plus the address table the app reads.
//
//   npx tsx scripts/lookup.ts                                   # as of 2026-10-01, rules from out/rules.json
//   npx tsx scripts/lookup.ts --as-of 2027-07-02 --rules <file> --out <file>
import fs from "node:fs";
import path from "node:path";
import { loadAddresses, parseCsv } from "../src/lib/law/corpus";
import { lookup, toEntries } from "../src/lib/law/engine";
import { buildingFrom, factSheet } from "../src/lib/law/facts";
import { normalizeRules } from "../src/lib/law/rules";
import type { LookupEntry } from "../src/lib/law/schema";

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const AS_OF = opt("as-of", "2026-10-01");
const RULES_IN = opt("rules", process.env.RULES_IN ?? "out/rules.json");
const OUT = opt("out", "submission/lookups.json");

export type ResolvedAddress = { address_id: string; state: string; city: string | null; county: string | null; method: string; matched_address: string | null };

function main() {
  const loaded = normalizeRules(JSON.parse(fs.readFileSync(RULES_IN, "utf8")));
  for (const r of loaded.rejected) console.warn(`REJECTED ${r.id}: ${r.problems.join("; ")}`);
  for (const w of loaded.warnings) console.warn(`warning: ${w}`);
  const rules = loaded.rules;

  const jur: Record<string, ResolvedAddress> = JSON.parse(fs.readFileSync("data/derived/jurisdictions.json", "utf8"));
  const overrides = new Map(
    parseCsv(fs.readFileSync("data/derived/address_overrides.csv", "utf8"))
      .filter((o) => o.address_id && o.legal_city)
      .map((o) => [o.address_id, o]),
  );

  const addresses = loadAddresses();
  const table = [];
  const lookups: Record<string, LookupEntry[]> = {};
  const tally = new Map<string, number>();

  for (const a of addresses) {
    const j = jur[a.address_id];
    const o = overrides.get(a.address_id);
    const city = o?.legal_city ?? j?.city ?? null;
    const facts = factSheet(a);
    const entries = toEntries(lookup(rules, buildingFrom(j?.state ?? a.state, city, facts), AS_OF));
    lookups[a.address_id] = entries;
    for (const e of entries) tally.set(e.result, (tally.get(e.result) ?? 0) + 1);
    table.push({
      ...a,
      legal_city: city,
      county: j?.county ?? null,
      geocode_method: o ? "reviewer_override" : (j?.method ?? "unresolved"),
      matched_address: j?.matched_address ?? null,
      override_note: o?.note ?? null,
    });
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ as_of: AS_OF, lookups }, null, 1));
  if (OUT === "submission/lookups.json") {
    fs.writeFileSync("submission/rules.json", JSON.stringify({ rules }, null, 1));
    fs.writeFileSync("data/derived/addresses.json", JSON.stringify(table));
  }

  const empty = addresses.filter((a) => lookups[a.address_id].length === 0).length;
  console.log(`as of ${AS_OF}: ${rules.length} rules, ${addresses.length} addresses -> ${OUT}`);
  console.log("results:", Object.fromEntries([...tally.entries()].sort()));
  console.log(`addresses with no rule at all: ${empty}`);
}

main();

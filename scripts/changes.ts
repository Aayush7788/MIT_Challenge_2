// Module C, change tracking. For each change test we find our rule cards for it,
// run the engine at the test's dates and list the sample addresses whose answer
// changes (or that the rule reaches), along with any conflict flags.
//
//   npx tsx scripts/changes.ts                      # tests from the starter pack
//   npx tsx scripts/changes.ts --tests a.json,b.json   # add the hour-16 test file
import fs from "node:fs";
import { loadAddresses, parseCsv, PACK_DIR } from "../src/lib/law/corpus";
import { lookup, type Evaluation } from "../src/lib/law/engine";
import { buildingFrom, factSheet } from "../src/lib/law/facts";
import { normalizeRules } from "../src/lib/law/rules";
import type { Category, Result, RuleRecord } from "../src/lib/law/schema";

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const RULES_IN = opt("rules", "submission/rules.json");
// The starter-pack tests, plus anything scripts/ingest.ts added (e.g. the hour-16 ordinance).
const EXTRA_TESTS = "data/derived/extra_change_tests.json";
const TESTS = opt("tests", [`${PACK_DIR}/dev/change_tests.json`, ...(fs.existsSync(EXTRA_TESTS) ? [EXTRA_TESTS] : [])].join(",")).split(",");
const OUT = opt("out", "submission/changes.json");
const DEFAULT_AS_OF = "2026-10-01";

type ChangeTest = {
  test_id: string;
  title: string;
  type: string;
  rule_ids?: string[];
  team_rule_ids?: string[]; // tests written by scripts/ingest.ts name our rules directly
  as_of?: string;
  as_of_before?: string;
  as_of_after?: string;
  states?: string[];
  conflict_with?: string[];
  expected_behavior?: string;
};

// Test rule ids look like "CA-ALG-01", "HOB-ALG-01", "MA-RENT-P1".
const JURISDICTION: Record<string, string> = {
  CA: "CA", NJ: "NJ", MA: "MA",
  HOB: "Hoboken, NJ", JC: "Jersey City, NJ", NWK: "Newark, NJ", NEW: "Newark, NJ",
  SF: "San Francisco, CA", LA: "Los Angeles, CA", SD: "San Diego, CA", BER: "Berkeley, CA", BRK: "Berkeley, CA", SA: "Santa Ana, CA",
  BOS: "Boston, MA", CAM: "Cambridge, MA", CAMB: "Cambridge, MA",
};
const CATEGORY: Record<string, Category> = {
  ALG: "algorithmic_rent_setting", ALGO: "algorithmic_rent_setting", AI: "algorithmic_rent_setting", PRICE: "algorithmic_rent_setting",
  RENT: "rent_increase_limits", RC: "rent_increase_limits", RS: "rent_increase_limits", CAP: "rent_increase_limits",
  EVIC: "just_cause_eviction", EVICT: "just_cause_eviction", EV: "just_cause_eviction", JCE: "just_cause_eviction", JUST: "just_cause_eviction",
  DEP: "security_deposits", DEPOSIT: "security_deposits", SEC: "security_deposits",
  FEE: "application_screening_fees", FEES: "application_screening_fees", APP: "application_screening_fees",
  SCR: "screening_restrictions", SCREEN: "screening_restrictions", CRIM: "screening_restrictions", SOI: "screening_restrictions",
};

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Pull bill and measure names out of a test title, e.g. "AB 325", "S.2983", "IP 25-21" or "FAIR Act".
function identifiers(text: string): string[] {
  const ids = [...text.matchAll(/\b(AB|SB|A|S|H|IP|Ord\.?\s*No\.?|NS)[\s.-]*(\d[\d-]*)\b/gi)].map((m) => compact(`${m[1]}${m[2]}`));
  const named = [...text.matchAll(/\b([A-Z]{3,})\s+Act\b/g)].map((m) => compact(m[1]));
  return [...new Set([...ids, ...named])];
}

function mapRules(testRuleId: string, test: ChangeTest, rules: RuleRecord[]): RuleRecord[] {
  const [j, c, n = ""] = testRuleId.toUpperCase().split("-");
  const jurisdiction = JURISDICTION[j];
  const category = CATEGORY[c];
  if (!jurisdiction || !category) return [];
  const proposal = /^P\d*$/.test(n);
  const cands = rules.filter(
    (r) =>
      r.jurisdiction === jurisdiction &&
      r.category === category &&
      (proposal ? r.status === "pending" || r.status === "failed" : r.status === "in_force" || r.status === "not_yet_effective"),
  );
  const ids = identifiers(`${test.title} ${test.expected_behavior ?? ""}`);
  const named = cands.filter((r) => ids.some((t) => compact(`${r.citation} ${r.title}`).includes(t)));
  return named.length ? named : cands;
}

function main() {
  const rules = normalizeRules(JSON.parse(fs.readFileSync(RULES_IN, "utf8")), { consolidate: RULES_IN !== "submission/rules.json" }).rules;
  const tests: ChangeTest[] = TESTS.flatMap((f) => JSON.parse(fs.readFileSync(f, "utf8")));
  const jur = JSON.parse(fs.readFileSync("data/derived/jurisdictions.json", "utf8"));
  const overrides = new Map(parseCsv(fs.readFileSync("data/derived/address_overrides.csv", "utf8")).map((o) => [o.address_id, o.legal_city]));
  const addresses = loadAddresses().map((a) => {
    const j = jur[a.address_id];
    return { id: a.address_id, building: buildingFrom(j?.state ?? a.state, overrides.get(a.address_id) || j?.city || null, factSheet(a)) };
  });

  const out: Record<string, unknown> = {};
  for (const t of tests) {
    const direct = rules.filter((r) => t.team_rule_ids?.includes(r.team_rule_id));
    const mapped = direct.length ? direct : [...new Map((t.rule_ids ?? []).flatMap((id) => mapRules(id, t, rules)).map((r) => [r.team_rule_id, r])).values()];
    const ids = new Set(mapped.map((r) => r.team_rule_id));
    // Treat pending bills as if they passed today, to see which addresses they'd reach.
    const ruleSet = t.type === "pending" ? rules.map((r) => (ids.has(r.team_rule_id) ? { ...r, status: "in_force" as const, effective_date: null } : r)) : rules;
    const pick = (evals: Evaluation[]) => evals.filter((e) => ids.has(e.team_rule_id));
    const strongest = (evals: Evaluation[]): Result | null => {
      const order: Result[] = ["applies", "superseded", "unknown", "not_yet_effective", "pending"];
      return order.find((r) => evals.some((e) => e.result === r)) ?? null;
    };

    const affected: string[] = [];
    const conflicts: string[] = [];
    // For a pending bill, "after" is a what-if: the bill is never reported as applying.
    const beforeAfter: Record<string, { before: Result | null; after: Result | "would_apply_if_enacted" | "might_apply_if_enacted" | null }> = {};
    for (const a of addresses) {
      if (t.type === "as_of") {
        const before = pick(lookup(ruleSet, a.building, t.as_of_before ?? DEFAULT_AS_OF));
        const after = pick(lookup(ruleSet, a.building, t.as_of_after ?? DEFAULT_AS_OF));
        const b = strongest(before);
        const f = strongest(after);
        if (b !== f) {
          affected.push(a.id);
          beforeAfter[a.id] = { before: b, after: f };
        }
        if ([...before, ...after].some((e) => e.conflict_flag)) conflicts.push(a.id);
      } else {
        const now = pick(lookup(ruleSet, a.building, t.as_of ?? DEFAULT_AS_OF));
        const r = strongest(now);
        if (r && (t.type !== "pending" || r === "applies" || r === "unknown")) {
          affected.push(a.id);
          beforeAfter[a.id] =
            t.type === "pending"
              ? { before: strongest(pick(lookup(rules, a.building, t.as_of ?? DEFAULT_AS_OF))), after: r === "applies" ? "would_apply_if_enacted" : "might_apply_if_enacted" }
              : { before: null, after: r };
        }
        if (now.some((e) => e.conflict_flag)) conflicts.push(a.id);
      }
    }

    const failed = mapped.filter((r) => r.status === "failed");
    const notes = [
      mapped.length
        ? `Matched team rules: ${mapped.map((r) => `${r.team_rule_id} (${r.citation}; ${r.status}${r.effective_date ? `, effective ${r.effective_date}` : ""})`).join("; ")}.`
        : `No extracted rule matches ${(t.rule_ids ?? []).join(", ")}; the source text may be missing from the corpus.`,
      t.type === "as_of" ? `Affected = addresses whose result changes between ${t.as_of_before} and ${t.as_of_after}.` : "",
      t.type === "pending" ? "Pending bills, never in force; affected = addresses they would reach if enacted as written." : "",
      t.type === "negative" ? `Struck or failed measures are never reported as in force.${failed.length ? ` Recorded as failed: ${failed.map((r) => r.citation).join("; ")}.` : ""}` : "",
      `${affected.length} affected, ${conflicts.length} flagged for human review.`,
    ].filter(Boolean).join(" ");

    out[t.test_id] = { affected_address_ids: affected, conflict_flag_address_ids: conflicts, notes, team_rule_ids: [...ids], before_after: beforeAfter };
    console.log(`${t.test_id}: ${mapped.length} rule(s) -> ${affected.length} affected, ${conflicts.length} conflict flags`);
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`wrote ${OUT}`);
}

main();

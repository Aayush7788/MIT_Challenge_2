import type { Category, LookupEntry, Result, RuleRecord } from "./schema";

// Module B: decides, for one address and one query date, which rules apply.
// Pure code over extracted rule records, so every answer is reproducible and
// traceable to a rule record, its citation and its quoted span.

export type Building = {
  state: string; // "CA" | "NJ" | "MA"
  city: string | null; // legal city from geocoding, e.g. "San Francisco"
  year_built: number | null;
  units: number | null;
  units_min?: number | null; // bounds from the land-use code when the exact count is missing
  units_max?: number | null;
  co_date?: string | null; // certificate of occupancy date (YYYY-MM-DD), only when a user enters it
};

// A state rule that yields to stricter local law does not also preempt it.
const preempts = (r: RuleRecord) => r.may_preempt_local_rules && !r.yields_to_local_rule;

function yearsBefore(date: string, years: number): string {
  return `${String(Number.parseInt(date.slice(0, 4), 10) - years).padStart(4, "0")}${date.slice(4)}`;
}

export type Tri = "yes" | "no" | "unknown";

export type Evaluation = LookupEntry & {
  rule: RuleRecord;
  reasons: string[]; // why the rule covers / might cover the building
};

const yearOf = (d: string) => Number.parseInt(d.slice(0, 4), 10);

export function inJurisdiction(rule: RuleRecord, b: Building): boolean {
  if (rule.level === "state") return rule.jurisdiction === b.state;
  if (!b.city) return false;
  return rule.jurisdiction.toLowerCase() === `${b.city}, ${b.state}`.toLowerCase();
}

// Three-valued coverage test against parcel facts. "unknown" means the data
// cannot settle it (missing year/units, cutoff year, owner type...).
export function coverage(rule: RuleRecord, b: Building, asOf: string): { tri: Tri; reasons: string[]; missing: string[] } {
  const c = rule.coverage_conditions;
  const reasons: string[] = [];
  const missing: string[] = [];
  let tri: Tri = "yes";
  const fail = (why: string) => {
    tri = "no";
    reasons.push(why);
  };
  const unsure = (why: string) => {
    if (tri !== "no") tri = "unknown";
    missing.push(why);
  };

  const lo = b.units ?? b.units_min ?? null;
  const hi = b.units ?? b.units_max ?? null;
  const unitText = b.units != null ? `${b.units} units` : lo != null && hi != null ? `${lo} to ${hi} units` : lo != null ? `at least ${lo} units` : hi != null ? `at most ${hi} units` : "";

  if (c.min_units != null) {
    if (lo != null && lo >= c.min_units) reasons.push(`${unitText} (rule covers ${c.min_units}+)`);
    else if (hi != null && hi < c.min_units) fail(`${unitText}, below the ${c.min_units}-unit threshold`);
    else unsure(`covers buildings with ${c.min_units}+ units, and the exact unit count is not in the data${unitText ? ` (${unitText})` : ""}`);
  }
  if (c.max_units != null) {
    if (hi != null && hi <= c.max_units) reasons.push(`${unitText} (rule covers up to ${c.max_units})`);
    else if (lo != null && lo > c.max_units) fail(`${unitText}, above the ${c.max_units}-unit limit`);
    else unsure(`covers buildings with at most ${c.max_units} units, and the exact unit count is not in the data${unitText ? ` (${unitText})` : ""}`);
  }

  const dateWord = c.cutoff_uses_certificate_of_occupancy ? "certificate of occupancy" : "construction";
  const co = b.co_date ?? null;
  if (co && c.built_on_or_before) {
    if (co <= c.built_on_or_before) reasons.push(`certificate of occupancy ${co}, on or before the ${c.built_on_or_before} cutoff`);
    else fail(`certificate of occupancy ${co}, after the ${c.built_on_or_before} cutoff`);
  } else if (c.built_on_or_before) {
    const cut = yearOf(c.built_on_or_before);
    if (b.year_built == null) unsure(`covers buildings with ${dateWord} on or before ${c.built_on_or_before}, and the year built is not in the data`);
    else if (b.year_built < cut) reasons.push(`built ${b.year_built}, before the ${c.built_on_or_before} cutoff`);
    else if (b.year_built > cut) fail(`built ${b.year_built}, after the ${c.built_on_or_before} cutoff`);
    else unsure(`built in ${cut}, the cutoff year; the exact ${dateWord} date decides coverage`);
  }
  if (co && c.built_after) {
    if (co > c.built_after) reasons.push(`certificate of occupancy ${co}, after ${c.built_after}`);
    else fail(`certificate of occupancy ${co}, on or before ${c.built_after}`);
  } else if (c.built_after) {
    const cut = yearOf(c.built_after);
    if (b.year_built == null) unsure(`covers buildings with ${dateWord} after ${c.built_after}, and the year built is not in the data`);
    else if (b.year_built > cut) reasons.push(`built ${b.year_built}, after ${c.built_after}`);
    else if (b.year_built < cut) fail(`built ${b.year_built}, before ${c.built_after}`);
    else unsure(`built in ${cut}, the cutoff year; the exact ${dateWord} date decides coverage`);
  }
  if (co && c.exempt_if_newer_than_years != null) {
    const cut = yearsBefore(asOf, c.exempt_if_newer_than_years);
    if (co < cut) reasons.push(`certificate of occupancy ${co}, older than the ${c.exempt_if_newer_than_years}-year new-construction exemption`);
    else fail(`certificate of occupancy ${co}, inside the ${c.exempt_if_newer_than_years}-year new-construction exemption`);
  } else if (c.exempt_if_newer_than_years != null) {
    const cutYear = yearOf(asOf) - c.exempt_if_newer_than_years;
    if (b.year_built == null) unsure(`buildings newer than ${c.exempt_if_newer_than_years} years are exempt, and the year built is not in the data`);
    else if (b.year_built < cutYear) reasons.push(`built ${b.year_built}, older than the ${c.exempt_if_newer_than_years}-year new-construction exemption`);
    else if (b.year_built > cutYear) fail(`built ${b.year_built}, inside the ${c.exempt_if_newer_than_years}-year new-construction exemption`);
    else unsure(`built in ${cutYear}, at the edge of the ${c.exempt_if_newer_than_years}-year new-construction exemption`);
  }
  if (c.owner_based_exemption_max_units != null) {
    const m = c.owner_based_exemption_max_units;
    if (lo != null && lo > m) reasons.push(`${unitText}, so the owner-type exemption (up to ${m} units) cannot apply`);
    else if (hi != null && hi <= m) unsure(`${unitText}: the owner-type exemption (up to ${m} units) may apply, and owner information is not in the data`);
    else unsure(`an owner-type exemption exists for buildings of up to ${m} units; the exact unit count and the owner are not in the data${unitText ? ` (${unitText})` : ""}`);
  }
  for (const f of c.required_facts_not_in_data ?? []) unsure(`coverage requires a fact not in the data: ${f}`);

  return { tri, reasons, missing };
}

// Evaluates every rule for one building on one date. Rules that do not cover
// the building are left out, as the submission format asks.
export function lookup(rules: RuleRecord[], b: Building, asOf: string): Evaluation[] {
  const out: Evaluation[] = [];
  for (const rule of rules) {
    if (!inJurisdiction(rule, b)) continue;
    if (rule.status === "failed") continue; // struck or defeated measures are never reported

    const cov = coverage(rule, b, asOf);
    if (cov.tri === "no") continue;

    let result: Result;
    let lead: string;
    const effective = rule.effective_date;
    if (rule.status === "pending") {
      result = "pending";
      lead = `Pending proposal, not law. It would ${cov.tri === "yes" ? "cover" : "possibly cover"} this address if enacted.`;
    } else if (effective && effective.length >= 4 && effective > asOf) {
      result = "not_yet_effective";
      lead = `Enacted, but takes effect ${effective}, after the ${asOf} query date.`;
    } else if (!effective && rule.status === "not_yet_effective") {
      result = "not_yet_effective";
      lead = "Enacted, but not yet in effect.";
    } else if (cov.tri === "unknown") {
      result = "unknown";
      lead = "May apply; the public data cannot settle coverage.";
    } else {
      result = "applies";
      lead = "Applies.";
    }

    const detail = [...cov.reasons, ...cov.missing.map((m) => `Unknown: ${m}`)];
    out.push({
      team_rule_id: rule.team_rule_id,
      result,
      explanation: [lead, rule.requirement, detail.length ? `(${detail.join("; ")}.)` : "", rule.coverage_note ?? ""].filter(Boolean).join(" "),
      // A preempting rule's flag is about local ordinances, so it is set below only
      // where one reaches this address; other flags (sources disagree) hold everywhere.
      conflict_flag: rule.conflict_flag && !preempts(rule),
      rule,
      reasons: cov.reasons,
    });
  }

  // Precedence: a state rule that yields to stricter local law is superseded
  // where a local rule in the same category applies.
  const byCat = (cat: Category, level: "state" | "city") => out.filter((e) => e.rule.category === cat && e.rule.level === level);
  for (const e of out.filter((x) => x.rule.level === "state" && x.rule.yields_to_local_rule)) {
    const locals = byCat(e.rule.category, "city");
    const governing = locals.find((l) => l.result === "applies");
    if (governing && e.result === "applies") {
      e.result = "superseded";
      e.explanation = `Covered, but superseded here: ${governing.rule.title} (${governing.rule.citation}) governs this address. ${e.rule.requirement}`;
    } else if (!governing && e.result === "applies" && locals.some((l) => l.result === "unknown")) {
      e.result = "unknown";
      e.explanation = `Applies unless the local rule ${locals.find((l) => l.result === "unknown")!.rule.citation} covers this unit, which the data cannot settle. ${e.rule.requirement}`;
    }
  }

  // Conflicts: a state rule that may preempt local ordinances in the same
  // category is flagged for human review wherever both reach the address.
  for (const s of out.filter((x) => x.rule.level === "state" && preempts(x.rule))) {
    const locals = byCat(s.rule.category, "city");
    if (locals.length === 0) continue;
    s.conflict_flag = true;
    s.explanation += ` Flag for review: may preempt ${locals.map((l) => l.rule.citation).join(", ")}.`;
    for (const l of locals) {
      l.conflict_flag = true;
      l.explanation += ` Flag for review: possible conflict with ${s.rule.title} (${s.rule.citation}).`;
    }
  }
  return out;
}

export function toEntries(evals: Evaluation[]): LookupEntry[] {
  return evals.map(({ team_rule_id, result, explanation, conflict_flag }) => ({ team_rule_id, result, explanation, conflict_flag }));
}

import type { Category, LookupEntry, Result, RuleRecord } from "./schema";

// Module B. Given one building and one date, figure out which rules apply.
// There's no model call in here, only the rule cards, so the same question
// always gets the same answer and we can point to the card behind it.

export type Building = {
  state: string; // "CA" | "NJ" | "MA"
  city: string | null; // legal city from geocoding, e.g. "San Francisco"
  year_built: number | null;
  units: number | null;
  units_min?: number | null; // bounds from the land-use code when the exact count is missing
  units_max?: number | null;
  units_note?: string | null; // where an inferred unit count came from, shown in the explanation
  co_date?: string | null; // certificate of occupancy date (YYYY-MM-DD), only when a user enters it
};

// A state rule that yields to local law can't also preempt it (extraction marked 1946.2 both ways).
const preempts = (r: RuleRecord) => r.may_preempt_local_rules && !r.yields_to_local_rule;

// A state law that exempts new construction from local rent control for N years
// (N.J.S.A. 2A:42-84.5). It's an exemption, not a rule a renter is under, and it
// only works if the owner filed a notice the data can't show. So it shows only
// where a building could still be inside the N years, and there it turns local
// rent control into "unknown" (our lawyer's reading).
const isNewConstructionExemption = (r: RuleRecord) =>
  r.level === "state" && r.category === "rent_increase_limits" && preempts(r) && r.coverage_conditions.exempt_if_newer_than_years != null;

// A city card that announces one period's figure (SF's allowable increase "March 1,
// 2026", Berkeley's "2026 AGA") carries that period's start as its date, but the
// ordinance behind it is older: its own coverage cutoff (1979, 1980) says so.
// Before that date the ordinance still applies; only the figure is unknown.
export function figureStart(r: RuleRecord): string | null {
  const d = r.effective_date;
  const cut = r.coverage_conditions.built_on_or_before;
  if (r.level !== "city" || r.category !== "rent_increase_limits" || !d || !cut) return null;
  if (yearOf(cut) >= yearOf(d) - 1) return null;
  const text = `${r.title} ${r.key_value ?? ""}`;
  return /\b(annual|AGA|allowable)\b/i.test(text) && text.includes(d.slice(0, 4)) ? d : null;
}

function yearsBefore(date: string, years: number): string {
  return `${String(Number.parseInt(date.slice(0, 4), 10) - years).padStart(4, "0")}${date.slice(4)}`;
}

export type Tri = "yes" | "no" | "unknown";

export type Evaluation = LookupEntry & {
  rule: RuleRecord;
  reasons: string[]; // why the rule covers / might cover the building
  figure_from?: string; // the card's figure starts later than the query date (see figureStart)
};

const yearOf = (d: string) => Number.parseInt(d.slice(0, 4), 10);

export function inJurisdiction(rule: RuleRecord, b: Building): boolean {
  if (rule.level === "state") return rule.jurisdiction === b.state;
  if (!b.city) return false;
  return rule.jurisdiction.toLowerCase() === `${b.city}, ${b.state}`.toLowerCase();
}

// yes / no / unknown against the parcel facts. unknown means the data can't
// settle it (no year built, built right in the cutoff year, owner type, etc.).
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
  const unitCount = b.units != null ? `${b.units} units` : lo != null && hi != null ? `${lo} to ${hi} units` : lo != null ? `at least ${lo} units` : hi != null ? `at most ${hi} units` : "";
  const unitText = unitCount && b.units_note ? `${unitCount}, ${b.units_note}` : unitCount;

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

// Run every rule against one building on one date. Rules that don't cover the
// building are dropped, since the submission format wants them left out.
export function lookup(rules: RuleRecord[], b: Building, asOf: string): Evaluation[] {
  const out: Evaluation[] = [];
  for (const rule of rules) {
    if (!inJurisdiction(rule, b)) continue;
    if (rule.status === "failed") continue; // struck or defeated measures are never reported
    if (isNewConstructionExemption(rule)) continue; // handled below

    const cov = coverage(rule, b, asOf);
    if (cov.tri === "no") continue;

    let result: Result;
    let lead: string;
    const effective = rule.effective_date;
    const figureLater = Boolean(effective && effective > asOf && figureStart(rule));
    if (figureLater) {
      result = cov.tri === "unknown" ? "unknown" : "applies";
      lead = `${result === "applies" ? "Applies." : "May apply; the public data cannot settle coverage."} The figure on this card takes effect ${effective}; the figure in force on ${asOf} is not in our sources.`;
    } else if (rule.status === "pending") {
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
    // A flagged card says why in its explanation (preemption flags are added further down).
    const flagNote = rule.conflict_flag && !preempts(rule) && rule.conflict_note ? `Note: ${rule.conflict_note}` : "";
    out.push({
      team_rule_id: rule.team_rule_id,
      result,
      ...(figureLater ? { figure_from: effective! } : {}),
      explanation: [lead, rule.requirement, detail.length ? `(${detail.join("; ")}.)` : "", rule.coverage_note ?? "", flagNote].filter(Boolean).join(" "),
      // For a state rule that might preempt local law, the flag is really about the
      // local ordinance, so we set it further down only where one reaches this
      // address. Other flags (e.g. sources disagree on a date) stay on everywhere.
      conflict_flag: rule.conflict_flag && !preempts(rule),
      rule,
      reasons: cov.reasons,
    });
  }

  for (const x of rules.filter((r) => isNewConstructionExemption(r) && inJurisdiction(r, b) && r.status === "in_force" && !(r.effective_date && r.effective_date > asOf))) {
    const n = x.coverage_conditions.exempt_if_newer_than_years!;
    // The exemption is for a defined building type with a unit floor ("multiple dwelling", 3+).
    const most = b.units ?? b.units_max ?? null;
    if (x.coverage_conditions.min_units != null && most != null && most < x.coverage_conditions.min_units) continue;
    let within: boolean | null;
    if (b.co_date) within = b.co_date > yearsBefore(asOf, n);
    else if (b.year_built == null) within = null;
    else {
      const cut = yearOf(asOf) - n;
      within = b.year_built > cut ? true : b.year_built < cut ? false : null;
    }
    if (within === false) continue; // too old for the exemption, so local rent control stands
    const age =
      within === null
        ? b.year_built == null && !b.co_date
          ? "the building's age is not in the data"
          : `built in ${b.year_built}, the edge of the ${n}-year window`
        : `built ${b.co_date ?? b.year_built}, within the last ${n} years`;
    out.push({
      team_rule_id: x.team_rule_id,
      result: "unknown",
      explanation: `May apply (${age}). ${x.requirement} It only applies if the owner filed the required notice, which public data can't show.`,
      conflict_flag: false,
      rule: x,
      reasons: [],
    });
    for (const e of out.filter((o) => o.rule.level === "city" && o.rule.category === "rent_increase_limits" && o.result === "applies")) {
      e.result = "unknown";
      e.explanation = `May apply. New construction can be exempt from local rent control for ${n} years under ${x.citation} if the owner filed a notice, and here ${age}. ${e.rule.requirement}`;
    }
  }

  // If the state rule yields to local law and a local rule in the same category
  // applies here, the state rule is superseded at this address.
  const byCat = (cat: Category, level: "state" | "city") => out.filter((e) => e.rule.category === cat && e.rule.level === level);
  for (const e of out.filter((x) => x.rule.level === "state" && x.rule.yields_to_local_rule)) {
    const locals = byCat(e.rule.category, "city");
    // Name the local rule itself, not a relocation-payment rule in the same category.
    const applying = locals.filter((l) => l.result === "applies");
    const governing = applying.find((l) => !/relocation/i.test(`${l.rule.title} ${l.rule.citation}`)) ?? applying[0];
    if (governing && e.result === "applies") {
      e.result = "superseded";
      e.explanation = `Covered, but superseded here: ${governing.rule.title} (${governing.rule.citation}) governs this address. ${e.rule.requirement}`;
    } else if (governing && e.result === "unknown") {
      // Whether or not the state rule would cover this unit, the local rule governs.
      e.result = "superseded";
      e.explanation = `Superseded here: ${governing.rule.title} (${governing.rule.citation}) governs this address, whether or not the state rule would otherwise cover this unit. ${e.rule.requirement}`;
    } else if (!governing && e.result === "applies" && locals.some((l) => l.result === "unknown")) {
      e.result = "unknown";
      e.explanation = `Applies unless the local rule ${locals.find((l) => l.result === "unknown")!.rule.citation} covers this unit, which the data cannot settle. ${e.rule.requirement}`;
    }
  }

  // If a state law might preempt a local ordinance and both reach this address,
  // flag both for a person to look at (e.g. the NJ FAIR Act and the Hoboken and JC bans).
  for (const s of out.filter((x) => x.rule.level === "state" && preempts(x.rule) && !isNewConstructionExemption(x.rule))) {
    const locals = byCat(s.rule.category, "city");
    if (locals.length === 0) continue;
    // Before the state law starts, the city ordinance stands alone; say when the conflict begins.
    const when = s.result === "not_yet_effective" && s.rule.effective_date ? `from ${s.rule.effective_date}, ` : "";
    s.conflict_flag = true;
    s.explanation += ` Flag for review: ${when}may preempt ${locals.map((l) => l.rule.citation).join(", ")}.`;
    for (const l of locals) {
      l.conflict_flag = true;
      l.explanation += ` Flag for review: ${when}possible conflict with ${s.rule.title} (${s.rule.citation}).`;
    }
  }
  return out;
}

export function toEntries(evals: Evaluation[]): LookupEntry[] {
  return evals.map(({ team_rule_id, result, explanation, conflict_flag }) => ({ team_rule_id, result, explanation, conflict_flag }));
}

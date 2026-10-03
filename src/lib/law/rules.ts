import { z } from "zod";
import { CATEGORIES, RULE_STATUSES, type Coverage, type RuleRecord } from "./schema";

// Loads a rules.json from any version of the extraction step and turns it into
// records the engine can run. Required fields are checked. If the structured
// coverage is missing we treat it as "no condition" and print a warning, so
// whoever is working on extraction can see which fields the engine couldn't use.

const EMPTY_COVERAGE: Coverage = {
  summary: "",
  min_units: null,
  max_units: null,
  built_on_or_before: null,
  built_after: null,
  cutoff_uses_certificate_of_occupancy: false,
  exempt_if_newer_than_years: null,
  owner_based_exemption_max_units: null,
  required_facts_not_in_data: [],
  minor_exemptions_not_in_data: [],
};

const Required = z.object({
  team_rule_id: z.string().min(1),
  jurisdiction: z.string().min(2),
  level: z.enum(["state", "city"]),
  category: z.enum(CATEGORIES),
  status: z.enum(RULE_STATUSES),
  title: z.string(),
  requirement: z.string(),
  citation: z.string().min(1),
  source_url: z.string(),
  quoted_span: z.string().min(20),
});

const intOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const dateOrNull = (v: unknown) => (typeof v === "string" && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(v.trim()) ? v.trim() : null);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function coverageFrom(raw: unknown, id: string, warn: (m: string) => void): Coverage {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const c = raw as Record<string, unknown>;
    return {
      summary: typeof c.summary === "string" ? c.summary : "",
      min_units: intOrNull(c.min_units),
      max_units: intOrNull(c.max_units),
      built_on_or_before: dateOrNull(c.built_on_or_before),
      built_after: dateOrNull(c.built_after),
      cutoff_uses_certificate_of_occupancy: c.cutoff_uses_certificate_of_occupancy === true,
      exempt_if_newer_than_years: intOrNull(c.exempt_if_newer_than_years),
      owner_based_exemption_max_units: intOrNull(c.owner_based_exemption_max_units),
      required_facts_not_in_data: strings(c.required_facts_not_in_data),
      minor_exemptions_not_in_data: strings(c.minor_exemptions_not_in_data),
    };
  }
  warn(`${id}: coverage_conditions is ${raw == null ? "missing" : "plain text"}; the engine treats the rule as covering every rental unit in its jurisdiction`);
  return { ...EMPTY_COVERAGE, summary: typeof raw === "string" ? raw : "" };
}

const QUERY_DATE = "2026-10-01";

// Boil a citation down to the code section it points at, so the same law cited
// by different documents lines up. For example
//   "Cal. Bus. & Prof. Code § 16729(a) (AB 325, ...)"   base 16729, full 16729(a)
//   "M.G.L. c. 186 § 15B"                               c186§15b
//   "N.J.S.A. 56:9-20"                                  56:9-20
//   "Hoboken Mun. Code ch. 155"                         ch155
//   "S.2983"                                            bill:s2983
export function sectionKey(citation: string): { base: string; full: string } | null {
  const s = citation
    .replace(/\(([^()]*)\)/g, (m, inner: string) => (/^[a-z0-9]{1,4}$/i.test(inner.trim()) ? m : " "))
    .replace(/\s+/g, " ")
    .toLowerCase();
  const sec = s.match(/§+\s*([0-9](?:[0-9a-z.:\-½/]*[0-9a-z½])?)((?:\([0-9a-z]{1,4}\))*)/);
  if (sec) {
    const ch = s.match(/\bc(?:h(?:apter)?)?\.?\s*([0-9]+[a-z]*)\s*,?\s*§/);
    const base = `${ch ? `c${ch[1]}§` : ""}${sec[1]}`;
    return { base, full: base + sec[2] };
  }
  const njsa = s.match(/n\.?\s?j\.?\s?s\.?\s?a\.?\s*([0-9a-z]+:[0-9a-z.\-]*[0-9a-z])((?:\([0-9a-z]{1,4}\))*)/);
  if (njsa) return { base: njsa[1], full: njsa[1] + njsa[2] };
  const bill = s.match(/\b(ab|sb|hb|a|s|h)\s?\.?\s?(\d{2,5})\b/);
  if (bill) return { base: `bill:${bill[1]}${bill[2]}`, full: `bill:${bill[1]}${bill[2]}` };
  const chapter = s.match(/\bch(?:apter)?\.?\s*([0-9]+[a-z]?)\b/);
  if (chapter) return { base: `ch${chapter[1]}`, full: `ch${chapter[1]}` };
  return null;
}

const enacted = (r: RuleRecord) => r.status === "in_force" || r.status === "not_yet_effective";
const official = (r: RuleRecord) => !(r.source_type ?? "").startsWith("secondary");
const words = (r: RuleRecord) => new Set(`${r.title} ${r.requirement}`.toLowerCase().match(/[a-z]{5,}/g) ?? []);
function similar(a: RuleRecord, b: RuleRecord, min = 0.25): boolean {
  const x = words(a);
  const y = words(b);
  const inter = [...x].filter((w) => y.has(w)).length;
  return inter / Math.max(1, new Set([...x, ...y]).size) >= min;
}
const note = (r: RuleRecord, text: string) => {
  r.consolidation_note = r.consolidation_note ? `${r.consolidation_note} ${text}` : text;
};

// Several documents often describe the same law. This cleans that up so we end
// up with one card per law.
//   - a proposal is dropped once we have the enacted version
//   - cards for one code section share an effective date if their sources agree on it
//   - exact duplicates merge into the best-supported card
//   - a news or law-firm summary with no citation is dropped if official text covers it
function consolidate(rules: RuleRecord[]): { kept: RuleRecord[]; notes: string[] } {
  const notes: string[] = [];
  const drop = new Set<RuleRecord>();
  const groups = new Map<string, RuleRecord[]>();
  for (const r of rules) {
    const k = sectionKey(r.citation);
    if (!k) continue;
    const key = `${r.jurisdiction}|${r.category}|${k.base}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const law = g.find(enacted);
    if (law) {
      for (const r of g.filter((x) => x.status === "pending")) {
        drop.add(r);
        notes.push(`${r.team_rule_id} dropped: the proposal was enacted as ${law.team_rule_id} (${law.citation}).`);
      }
    }
    const live = g.filter((r) => !drop.has(r));
    const dates = [...new Set(live.map((r) => r.effective_date).filter((d): d is string => Boolean(d)))];
    if (dates.length === 1) {
      const donor = live.find((r) => r.effective_date === dates[0])!;
      const dk = sectionKey(donor.citation)!;
      // Only copy the date if the donor cites the whole section or the exact same subsection.
      const takes = (x: RuleRecord) => dk.full === dk.base || sectionKey(x.citation)!.full === dk.full;
      for (const r of live.filter((x) => !x.effective_date && enacted(x) && takes(x))) {
        r.effective_date = dates[0];
        if (r.status === "in_force" && dates[0] > QUERY_DATE) r.status = "not_yet_effective";
        note(r, `Effective date taken from ${donor.team_rule_id} (${donor.citation}), which states it for the same code section.`);
        notes.push(`${r.team_rule_id}: effective date ${dates[0]} from ${donor.team_rule_id}.`);
      }
    }
    const byFull = new Map<string, RuleRecord[]>();
    for (const r of live) {
      const f = `${sectionKey(r.citation)!.full}|${r.status}`;
      byFull.set(f, [...(byFull.get(f) ?? []), r]);
    }
    for (const same of byFull.values()) {
      if (same.length < 2) continue;
      const [keep, ...rest] = [...same].sort((a, b) => Number(official(b)) - Number(official(a)) || Number(b.span_verified) - Number(a.span_verified) || b.confidence - a.confidence);
      for (const r of rest) {
        drop.add(r);
        const c = keep.coverage_conditions;
        for (const k of ["min_units", "max_units", "built_on_or_before", "built_after", "exempt_if_newer_than_years", "owner_based_exemption_max_units"] as const) {
          if (c[k] == null && r.coverage_conditions[k] != null) (c as Record<string, unknown>)[k] = r.coverage_conditions[k];
        }
        if (!keep.key_value && r.key_value) keep.key_value = r.key_value;
        note(keep, `Also stated in ${r.source_doc_id} (merged ${r.team_rule_id}).`);
        notes.push(`${r.team_rule_id} merged into ${keep.team_rule_id} (${keep.citation}).`);
      }
    }
  }

  for (const r of rules) {
    if (drop.has(r) || sectionKey(r.citation)) continue;
    // Drop an uncited secondary summary when an official card already covers it.
    const twin = rules.find((o) => o !== r && !drop.has(o) && o.jurisdiction === r.jurisdiction && o.category === r.category && o.status === r.status && official(o) && sectionKey(o.citation));
    if (twin && !official(r)) {
      drop.add(r);
      notes.push(`${r.team_rule_id} dropped: secondary summary of ${twin.team_rule_id} (${twin.citation}).`);
      continue;
    }
    // Same idea for a city proposal with no number once the city has adopted an ordinance on it (Santa Ana).
    if (r.level === "city" && r.status === "pending") {
      const law2 = rules.find((o) => o !== r && !drop.has(o) && o.level === "city" && o.jurisdiction === r.jurisdiction && o.category === r.category && enacted(o) && similar(o, r));
      if (law2) {
        drop.add(r);
        notes.push(`${r.team_rule_id} dropped: the proposal was adopted (${law2.team_rule_id}, ${law2.citation}).`);
      }
    }
  }
  return { kept: rules.filter((r) => !drop.has(r)), notes };
}

const hasCutoff = (c: Coverage) => Boolean(c.built_on_or_before || c.built_after || c.exempt_if_newer_than_years != null);
const hasAnyCondition = (c: Coverage) =>
  hasCutoff(c) || c.min_units != null || c.max_units != null || c.owner_based_exemption_max_units != null || c.required_facts_not_in_data.length > 0;

// Rate announcements and calculator pages (e.g. LA's RSO calculator) apply to the
// same units as the city's rent ordinance, but they rarely say which units those
// are. If a city rent card has no coverage at all, borrow the date cutoff from
// that city's main rent card and note where it came from.
function inheritCityRentCoverage(rules: RuleRecord[]): string[] {
  const notes: string[] = [];
  for (const r of rules) {
    if (r.level !== "city" || r.category !== "rent_increase_limits" || hasAnyCondition(r.coverage_conditions)) continue;
    const donors = rules.filter(
      (d) => d !== r && d.level === "city" && d.category === r.category && d.jurisdiction === r.jurisdiction && d.status === "in_force" && hasCutoff(d.coverage_conditions),
    );
    if (!donors.length) continue;
    const donor = [...donors].sort((a, b) => b.confidence - a.confidence)[0];
    const c = donor.coverage_conditions;
    r.coverage_conditions = {
      ...r.coverage_conditions,
      built_on_or_before: c.built_on_or_before,
      built_after: c.built_after,
      cutoff_uses_certificate_of_occupancy: c.cutoff_uses_certificate_of_occupancy,
      exempt_if_newer_than_years: c.exempt_if_newer_than_years,
    };
    const differ = donors.filter((d) => d !== donor && (d.coverage_conditions.built_on_or_before !== c.built_on_or_before || d.coverage_conditions.built_after !== c.built_after));
    r.coverage_note =
      `Coverage cutoff taken from ${donor.team_rule_id} (${donor.citation}), the same city's rent rule, because this record states none.` +
      (differ.length ? ` Other records give a different cutoff: ${differ.map((d) => `${d.team_rule_id} ${d.coverage_conditions.built_on_or_before ?? d.coverage_conditions.built_after}`).join(", ")}.` : "");
    notes.push(`${r.team_rule_id}: ${r.coverage_note}`);
  }
  return notes;
}

export type LoadedRules = { rules: RuleRecord[]; warnings: string[]; rejected: { id: string; problems: string[] }[] };

export function normalizeRules(input: unknown): LoadedRules {
  const list: unknown[] = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as { rules?: unknown }).rules)
      ? (input as { rules: unknown[] }).rules
      : [];
  const warnings: string[] = [];
  const rejected: LoadedRules["rejected"] = [];
  const rules: RuleRecord[] = [];
  const seen = new Set<string>();

  list.forEach((item, i) => {
    const parsed = Required.safeParse(item);
    const id = (item as { team_rule_id?: string })?.team_rule_id ?? `#${i}`;
    if (!parsed.success) {
      rejected.push({ id, problems: parsed.error.issues.map((e) => `${e.path.join(".") || "(record)"}: ${e.message}`) });
      return;
    }
    if (seen.has(parsed.data.team_rule_id)) {
      rejected.push({ id, problems: ["duplicate team_rule_id"] });
      return;
    }
    seen.add(parsed.data.team_rule_id);
    const r = item as Record<string, unknown>;
    const warn = (m: string) => warnings.push(m);
    rules.push({
      ...parsed.data,
      key_value: typeof r.key_value === "string" ? r.key_value : null,
      coverage_conditions: coverageFrom(r.coverage_conditions, id, warn),
      exemptions: typeof r.exemptions === "string" ? r.exemptions : null,
      overrides: strings(r.overrides),
      interaction: typeof r.interaction === "string" ? r.interaction : null,
      effective_date: dateOrNull(r.effective_date),
      source_doc_id: typeof r.source_doc_id === "string" ? r.source_doc_id : "",
      retrieved_at: typeof r.retrieved_at === "string" ? r.retrieved_at : null,
      span_verified: r.span_verified === true,
      confidence: typeof r.confidence === "number" ? r.confidence : 0.5,
      conflict_flag: r.conflict_flag === true,
      conflict_note: typeof r.conflict_note === "string" ? r.conflict_note : null,
      penalty: typeof r.penalty === "string" ? r.penalty : null,
      yields_to_local_rule: r.yields_to_local_rule === true,
      may_preempt_local_rules: r.may_preempt_local_rules === true,
      source_type: typeof r.source_type === "string" ? r.source_type : undefined,
      coverage_note: typeof r.coverage_note === "string" ? r.coverage_note : null,
      consolidation_note: typeof r.consolidation_note === "string" ? r.consolidation_note : null,
      verification: r.verification && typeof r.verification === "object" ? (r.verification as RuleRecord["verification"]) : undefined,
    });
    if (typeof r.effective_date === "string" && r.effective_date && !dateOrNull(r.effective_date)) {
      warnings.push(`${id}: effective_date "${r.effective_date}" is not YYYY-MM-DD; ignored`);
    }
  });
  const { kept, notes } = consolidate(rules);
  warnings.push(...notes.map((n) => `consolidated: ${n}`));
  warnings.push(...inheritCityRentCoverage(kept).map((n) => `filled: ${n}`));
  return { rules: kept, warnings, rejected };
}

import { z } from "zod";
import { CATEGORIES, RULE_STATUSES, type Coverage, type RuleRecord } from "./schema";

// Reads a rules.json produced by any version of the extraction step and returns
// records the engine can evaluate. Required fields are checked; missing
// structured coverage is filled with "no condition" and reported, so the
// extraction side sees exactly which fields the engine could not use.

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

const hasCutoff = (c: Coverage) => Boolean(c.built_on_or_before || c.built_after || c.exempt_if_newer_than_years != null);
const hasAnyCondition = (c: Coverage) =>
  hasCutoff(c) || c.min_units != null || c.max_units != null || c.owner_based_exemption_max_units != null || c.required_facts_not_in_data.length > 0;

// A city's rate announcement or calculator page covers the same units as the
// city's rent ordinance. A city rent rule that states no coverage at all takes
// the date cutoff stated by another in-force rent rule of the same city, and
// the record says where it came from.
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
    });
    if (typeof r.effective_date === "string" && r.effective_date && !dateOrNull(r.effective_date)) {
      warnings.push(`${id}: effective_date "${r.effective_date}" is not YYYY-MM-DD; ignored`);
    }
  });
  warnings.push(...inheritCityRentCoverage(rules).map((n) => `filled: ${n}`));
  return { rules, warnings, rejected };
}

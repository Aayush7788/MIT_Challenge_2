import { lookup, type Evaluation } from "./engine";
import { buildingFrom, factSheet, type FactSheet, type UserFacts } from "./facts";
import { CATEGORIES, CATEGORY_LABELS, type Address, type Category, type Result, type RuleRecord } from "./schema";

// The address memo: what a lawyer would write after reading the three layers of
// law, checking the building facts and the dates. Built from the engine only.

export type AddressRow = Address & {
  legal_city: string | null;
  county: string | null;
  geocode_method: string;
  matched_address: string | null;
  override_note: string | null;
};

export type MemoItem = {
  team_rule_id: string;
  category: Category;
  result: Result;
  level: "state" | "city";
  jurisdiction: string;
  title: string;
  requirement: string;
  key_value: string | null;
  citation: string;
  quoted_span: string;
  span_verified: boolean;
  source_url: string;
  source_doc_id: string;
  retrieved_at: string | null;
  status: RuleRecord["status"];
  effective_date: string | null;
  explanation: string;
  reasons: string[];
  conflict_flag: boolean;
  conflict_note: string | null;
  exemptions: string | null;
  confidence: number;
  confidence_level: "high" | "medium" | "low";
  confidence_reasons: string[];
};

export type Memo = {
  as_of: string;
  address: { id: string | null; line: string; mailing_city: string; state: string; zip: string; use: string | null };
  jurisdiction: { state: string; county: string | null; city: string | null; mailing_differs: boolean; method: string; matched_address: string | null; note: string | null };
  facts: FactSheet;
  categories: { category: Category; label: string; items: MemoItem[] }[];
  changing: MemoItem[];
  flags: { team_rule_id: string; citation: string; text: string }[];
  counts: Record<Result, number>;
  sources_retrieved: string | null;
};

const ORDER: Result[] = ["applies", "superseded", "unknown", "not_yet_effective", "pending"];

// How much to trust one answer: high only when the quote is verified, the source
// is official text, the facts come straight from public records and nothing is
// flagged; each step down says why.
function trust(e: Evaluation, facts: FactSheet): { level: MemoItem["confidence_level"]; reasons: string[] } {
  const r = e.rule;
  const c = r.coverage_conditions;
  const low: string[] = [];
  const mid: string[] = [];
  if (e.result === "unknown") low.push("coverage depends on a fact the public data does not have");
  // A possible preemption can change whether the rule applies at all; other flags
  // (sources differ on a date or a detail) are shown but weigh less.
  if (e.conflict_flag && /Flag for review: (may preempt|possible conflict)/.test(e.explanation)) low.push("a state law may preempt the local rule; flagged for human review");
  else if (e.conflict_flag) mid.push("sources differ on a detail; see the reviewer note");
  if (!r.span_verified) low.push("quote not found word for word in the source");
  if ((r.source_type ?? "").startsWith("secondary")) mid.push("source is a news report or a copy of the code, not the official text");
  if (r.confidence < 0.6) low.push(`extraction confidence ${Math.round(r.confidence * 100)}%`);
  else if (r.confidence < 0.75) mid.push(`extraction confidence ${Math.round(r.confidence * 100)}%`);
  const usesUnits = c.min_units != null || c.max_units != null || c.owner_based_exemption_max_units != null;
  if (usesUnits && facts.units.source === "land-use code") mid.push("unit count read from the land-use code");
  else if (usesUnits && facts.units.value == null && facts.units_min.value != null) mid.push("only a unit range is known, from the land-use code");
  if (r.coverage_note) mid.push("coverage cutoff taken from a related record");
  if (r.consolidation_note?.includes("Effective date taken")) mid.push("effective date taken from a related record");
  const level = low.length ? "low" : mid.length ? "medium" : "high";
  return { level, reasons: [...low, ...mid] };
}

function item(e: Evaluation, facts: FactSheet): MemoItem {
  const r = e.rule;
  const t = trust(e, facts);
  return {
    team_rule_id: r.team_rule_id,
    category: r.category,
    result: e.result,
    level: r.level,
    jurisdiction: r.jurisdiction,
    title: r.title,
    requirement: r.requirement,
    key_value: r.key_value,
    citation: r.citation,
    quoted_span: r.quoted_span,
    span_verified: r.span_verified,
    source_url: r.source_url,
    source_doc_id: r.source_doc_id,
    retrieved_at: r.retrieved_at,
    status: r.status,
    effective_date: r.effective_date,
    explanation: e.explanation,
    reasons: e.reasons,
    conflict_flag: e.conflict_flag,
    conflict_note: r.conflict_note,
    exemptions: r.exemptions,
    confidence: r.confidence,
    confidence_level: t.level,
    confidence_reasons: t.reasons,
  };
}

export type MemoTarget = {
  id: string | null;
  street_address: string;
  postal_city: string;
  state: string;
  zip: string;
  legal_city: string | null;
  county: string | null;
  geocode_method: string;
  matched_address: string | null;
  override_note?: string | null;
  parcel: Pick<Address, "state" | "year_built" | "units" | "use_code" | "use_description">;
};

export function targetFromRow(a: AddressRow): MemoTarget {
  return {
    id: a.address_id,
    street_address: a.street_address,
    postal_city: a.postal_city,
    state: a.state,
    zip: a.zip,
    legal_city: a.legal_city,
    county: a.county,
    geocode_method: a.geocode_method,
    matched_address: a.matched_address,
    override_note: a.override_note,
    parcel: a,
  };
}

export function buildMemo(rules: RuleRecord[], t: MemoTarget, asOf: string, user: UserFacts = {}): Memo {
  const facts = factSheet(t.parcel, user);
  const evals = lookup(rules, buildingFrom(t.state, t.legal_city, facts), asOf);
  const items = evals.map((e) => item(e, facts));
  const rank = (i: MemoItem) => ORDER.indexOf(i.result) * 10 + (i.level === "city" ? 0 : 1);

  const categories = CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    items: items.filter((i) => i.category === category).sort((a, b) => rank(a) - rank(b)),
  }));

  const flags = items
    .filter((i) => i.conflict_flag)
    .map((i) => ({
      team_rule_id: i.team_rule_id,
      citation: i.citation,
      text: i.explanation.match(/Flag for review: [^.]*\./)?.[0] ?? i.conflict_note ?? "Sources disagree; a person should check this rule.",
    }));

  const counts = Object.fromEntries(ORDER.map((r) => [r, items.filter((i) => i.result === r).length])) as Record<Result, number>;
  const retrieved = items.map((i) => i.retrieved_at).filter((d): d is string => Boolean(d)).sort();

  return {
    as_of: asOf,
    address: { id: t.id, line: t.street_address, mailing_city: t.postal_city, state: t.state, zip: t.zip, use: t.parcel.use_description || null },
    jurisdiction: {
      state: t.state,
      county: t.county,
      city: t.legal_city,
      mailing_differs: Boolean(t.legal_city) && t.postal_city.trim().toLowerCase() !== (t.legal_city ?? "").toLowerCase(),
      method: t.geocode_method,
      matched_address: t.matched_address,
      note: t.override_note ?? null,
    },
    facts,
    categories,
    changing: items.filter((i) => i.result === "pending" || i.result === "not_yet_effective").sort((a, b) => (a.effective_date ?? "9999").localeCompare(b.effective_date ?? "9999")),
    flags,
    counts,
    sources_retrieved: retrieved.length ? retrieved[retrieved.length - 1].slice(0, 10) : null,
  };
}

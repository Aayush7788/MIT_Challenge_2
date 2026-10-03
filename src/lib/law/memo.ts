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

function item(e: Evaluation): MemoItem {
  const r = e.rule;
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
  const items = evals.map(item);
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

import { z } from "zod";

// Types shared by extraction and the engine. The model fills in ExtractedRule,
// and the engine reads RuleRecord, which is the submission format plus the
// structured coverage fields it needs.

export const CATEGORIES = [
  "rent_increase_limits",
  "just_cause_eviction",
  "security_deposits",
  "application_screening_fees",
  "screening_restrictions",
  "algorithmic_rent_setting",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  rent_increase_limits: "Rent increases",
  just_cause_eviction: "Eviction (just cause)",
  security_deposits: "Security deposit",
  application_screening_fees: "Application and screening fees",
  screening_restrictions: "Screening restrictions",
  algorithmic_rent_setting: "Algorithmic pricing",
};

export const RULE_STATUSES = ["in_force", "not_yet_effective", "pending", "failed"] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

export const RESULTS = ["applies", "unknown", "superseded", "not_yet_effective", "pending"] as const;
export type Result = (typeof RESULTS)[number];

export const Coverage = z.object({
  summary: z.string().describe("Plain-language statement of which buildings and units the rule covers."),
  min_units: z
    .number()
    .int()
    .nullable()
    .describe("Rule only covers buildings with at least this many units. Null if there is no such threshold."),
  max_units: z
    .number()
    .int()
    .nullable()
    .describe("Rule only covers buildings with at most this many units. Null if there is no such threshold."),
  built_on_or_before: z
    .string()
    .nullable()
    .describe("YYYY-MM-DD. Rule only covers buildings built (or first certified for occupancy) on or before this date."),
  built_after: z
    .string()
    .nullable()
    .describe("YYYY-MM-DD. Rule only covers buildings built (or first certified for occupancy) after this date."),
  cutoff_uses_certificate_of_occupancy: z
    .boolean()
    .describe("True if the date cutoff is defined by the certificate of occupancy date rather than construction year."),
  exempt_if_newer_than_years: z
    .number()
    .int()
    .nullable()
    .describe("Rolling exemption: units whose certificate of occupancy was issued within this many years of the query date are exempt (e.g. 15 for Cal. Civ. Code 1947.12)."),
  owner_based_exemption_max_units: z
    .number()
    .int()
    .nullable()
    .describe("An exemption that turns on owner type or owner occupancy (owner-occupied small buildings, small landlords) and only exists for buildings with at most this many units. Null if none."),
  required_facts_not_in_data: z
    .array(z.string())
    .describe("Facts the rule's coverage REQUIRES that public parcel data cannot show, so coverage of an ordinary apartment building cannot be determined (e.g. the rule covers only affordable or publicly assisted housing, or only landlords of a certain kind). Do not list exemptions, landlord conduct, or local-versus-state precedence. Usually empty."),
  minor_exemptions_not_in_data: z
    .array(z.string())
    .describe("Narrow exemptions that turn on facts not in parcel data (deed-restricted or subsidized housing, dormitories, hotels, mobilehomes, single-family homes or condos owned by individuals). Listed for the explanation only."),
});
export type Coverage = z.infer<typeof Coverage>;

export const ExtractedRule = z.object({
  jurisdiction: z.string().describe("'CA', 'NJ' or 'MA' for state law; 'City, ST' for a city rule, e.g. 'San Francisco, CA'."),
  level: z.enum(["state", "city"]),
  category: z.enum(CATEGORIES),
  status: z
    .enum(RULE_STATUSES)
    .describe("As of 2026-10-01. Enacted law with a later effective date is not_yet_effective; bills and proposals are pending; struck or defeated measures are failed."),
  title: z.string(),
  requirement: z.string().describe("One or two plain-language sentences a renter can act on."),
  key_value: z.string().nullable().describe("Headline number or formula, e.g. 'lesser of 5% + CPI or 10%', '1 month rent'."),
  coverage: Coverage,
  exemptions: z.string().nullable(),
  effective_date: z.string().nullable().describe("YYYY-MM-DD when the rule takes or took effect, if the text says."),
  penalty: z.string().nullable(),
  citation: z.string().describe("Official citation, e.g. 'Cal. Civ. Code § 1947.12', 'S.F. Admin. Code § 37.9', 'N.J.S.A. 2A:18-61.1'."),
  quoted_span: z
    .string()
    .describe("Exact text copied character for character from THIS document that states the rule. One to three sentences, at least 20 characters."),
  yields_to_local_rule: z
    .boolean()
    .describe("True for a state rule that stops governing where a stricter local rule covers the unit (e.g. statewide rent cap vs local rent control)."),
  may_preempt_local_rules: z
    .boolean()
    .describe("True for a state rule that may preempt or conflict with local ordinances in the same category."),
  interaction: z.string().nullable().describe("How this rule interacts with rules at the other level, if the text says."),
  confidence: z.number().describe("0 to 1: how sure you are that this record is correct and complete."),
  conflict_flag: z.boolean().describe("True if sources disagree or the rule may conflict with another rule; needs human review."),
  conflict_note: z.string().nullable(),
});
export type ExtractedRule = z.infer<typeof ExtractedRule>;

export const DocExtraction = z.object({
  rules: z.array(ExtractedRule),
  notes: z.string().nullable().describe("Anything a reviewer should know, e.g. why no rule was extracted."),
});
export type DocExtraction = z.infer<typeof DocExtraction>;

// What goes in rules.json (see schema/rule_record.schema.json), plus extra fields the engine uses.
export type RuleRecord = {
  team_rule_id: string;
  jurisdiction: string;
  level: "state" | "city";
  category: Category;
  status: RuleStatus;
  title: string;
  requirement: string;
  key_value: string | null;
  coverage_conditions: Coverage;
  exemptions: string | null;
  overrides: string[];
  interaction: string | null;
  effective_date: string | null;
  citation: string;
  source_doc_id: string;
  source_url: string;
  retrieved_at: string | null;
  quoted_span: string;
  span_verified: boolean;
  confidence: number;
  conflict_flag: boolean;
  conflict_note: string | null;
  penalty: string | null;
  yields_to_local_rule: boolean;
  may_preempt_local_rules: boolean;
  coverage_note?: string | null; // set when coverage was filled from a sibling record
  source_type?: string; // manifest source type; "secondary ..." for news, law-firm pages and mirrors
  source_in_starter_corpus?: boolean; // false when the source is a text we captured
  source_jurisdiction?: string; // the jurisdiction the source document belongs to (a city page can state a state rule)
  consolidation_note?: string | null; // set when the record took a date from, or absorbed, another record
  verification?: Verification; // second check (scripts/verify.ts)
};

export type Verification = {
  model: string;
  verdicts: Record<string, string>; // field -> supported / partly_supported / not_supported / not_applicable
  evidence: { field: string; quote: string }[]; // auditor quotes we found word for word in the source
  changes: string[]; // what the second check removed or disputed
};

export type Address = {
  address_id: string;
  street_address: string;
  postal_city: string;
  state: string;
  zip: string;
  year_built: number | null;
  units: number | null;
  use_code: string;
  use_description: string;
};

export type LookupEntry = {
  team_rule_id: string;
  result: Result;
  explanation: string;
  conflict_flag: boolean;
};

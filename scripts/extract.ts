// Module A, rule extraction. Claude reads each document and returns rule records
// in a fixed JSON schema. Then we check every quote against the source text,
// merge rules that show up in several documents and write out/rules.json.
//
//   npx tsx scripts/extract.ts                    # all documents (reuses cached per-doc outputs)
//   npx tsx scripts/extract.ts --fresh            # ignore the cache, call the model for every document
//   npx tsx scripts/extract.ts --docs D001,D004   # only these documents
//   npx tsx scripts/extract.ts --corpus <dir>     # another corpus folder (e.g. the hour-16 drop)
import "./load-env";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { loadCorpus, PACK_DIR, type CorpusDoc } from "../src/lib/law/corpus";
import { DocExtraction, type ExtractedRule, type RuleRecord } from "../src/lib/law/schema";
import { verifySpan } from "../src/lib/law/spans";

const MODEL = process.env.EXTRACT_MODEL ?? "claude-opus-5-5";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORT = (process.env.EXTRACT_EFFORT ?? "medium") as Effort;
const QUERY_DATE = "2026-10-01";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const corpusDir = opt("corpus") ?? PACK_DIR;
const onlyDocs = opt("docs")?.split(",").map((s) => s.trim());
const concurrency = Number(opt("concurrency") ?? 4);
const outFile = opt("out") ?? "out/rules.json";
const auditDir = path.join("out", "audit", "extract");
fs.mkdirSync(auditDir, { recursive: true });

const SYSTEM = `You extract housing-law rules from one source document at a time for the Rental Housing Law Navigator.

Scope: rental housing rules in exactly six categories.
- rent_increase_limits: rent caps and the formula, which buildings are covered, exemptions, and whether a state cap yields to local rent control. A state law that forbids local rent control also belongs here.
- just_cause_eviction: rules that limit whether a landlord may end a tenancy or evict: a requirement of listed just causes, the allowed causes, protection against retaliatory eviction (including a presumption that an eviction after a tenant complaint is retaliation), relocation assistance for no-fault evictions, and coverage. Rules that only govern how a tenancy is ended (notice-to-quit periods, forms, timing and anything a notice to quit must contain or attach) do not limit whether the landlord may end it: they are out of scope, so do not record them. A separate requirement, usually a city ordinance, to give tenants a notice or guide of their rights when a tenancy ends belongs here only as a notice requirement: when the jurisdiction has no just-cause law, set conflict_flag and write in conflict_note "Notice requirement only; <jurisdiction> has no just-cause eviction law."
- security_deposits: maximum deposit, exceptions, effective date.
- application_screening_fees: caps on application or screening fees, other allowed upfront charges (including broker-fee rules), receipts and refunds.
- screening_restrictions: limits on using criminal history or source of income when screening applicants, and timing rules.
- algorithmic_rent_setting: rules on rent-setting software or algorithms: covered software, prohibited conduct, penalties, effective date.

Instructions
1. Return one record per distinct rule this document states, as its own enacted text, a bill, a ballot measure, or an official summary of the governing law. Cite the underlying law, not the web page. Return an empty list if the document has no rule in scope. Never invent a rule, number, date or citation that the document does not state.
2. jurisdiction: "CA", "NJ" or "MA" for state law (level "state"); "City, ST" for a city rule (level "city"), e.g. "Berkeley, CA". Use the plain city name, e.g. "San Francisco, CA" for the City and County of San Francisco.
3. status as of the query date ${QUERY_DATE}: "in_force" if enacted and effective on or before that date; "not_yet_effective" if enacted with a later effective date; "pending" for bills, proposals and measures not yet adopted; "failed" for measures that were struck, defeated, vetoed or withdrawn. A ballot measure that voters rejected, or that a court removed from the ballot, is "failed": record it under the jurisdiction it would have covered (the state, for a statewide question), cite it by its number (e.g. "Initiative Petition 25-21") and state in the requirement that it is not law.
4. effective_date: YYYY-MM-DD when the document states it, including code history notes ("Effective January 1, 2026", "effective 6-21-2025"). An ordinance that takes effect "immediately upon passage" takes its final adoption date when the document states it. If the document gives two different effective dates, use the one in the operative text and set conflict_flag with a conflict_note naming both.
5. quoted_span: copy one to three contiguous sentences character for character from this document, at least 20 characters, containing the operative requirement (the cap, the number, the prohibition). Do not paraphrase, shorten with ellipses, or merge separate passages.
6. citation: put the primary official citation first: the code section if the rule is codified, otherwise the ordinance, session-law or bill number. Add alternates in parentheses. Examples: "Cal. Civ. Code § 1950.5", "Cal. Bus. & Prof. Code § 16729", "S.F. Admin. Code § 37.3", "Hoboken Code § 158-2", "Jersey City Code § 218-12", "Newark Mun. Code § 19:2-3", "San Diego Mun. Code § 98.1103", "N.J.S.A. 46:8-21.2", "M.G.L. c. 186 § 15B", or the ordinance or bill number ("Ord. No. 1234", "A.123") when there is no code section.
7. coverage: fill the structured fields only from what the text states.
   - Cutoffs on construction or first certificate of occupancy go in built_on_or_before / built_after as YYYY-MM-DD; set cutoff_uses_certificate_of_occupancy when the cutoff is a certificate of occupancy date.
   - A rolling new-construction exemption ("units first occupied within the last N years") goes in exempt_if_newer_than_years.
   - Unit-count thresholds go in min_units / max_units. An exemption based on owner type or owner occupancy that only exists for buildings of up to N units (owner-occupied duplexes, small landlords) goes in owner_based_exemption_max_units.
   - required_facts_not_in_data is only for rules whose coverage is limited to a subset that parcel data cannot identify (for example, a rule that covers only affordable housing). Keep it empty for broad rules with exceptions; put narrow exceptions (subsidized housing, dormitories, mobilehomes, individually owned single-family homes or condos) in minor_exemptions_not_in_data instead. A rule that prohibits conduct (such as using pricing software) covers every unit in its jurisdiction; whether a landlord engages in that conduct is not a coverage fact.
8. yields_to_local_rule: true for a state rule that, by its terms, does not govern units covered by a stricter local rule. may_preempt_local_rules: true for a state rule that preempts or may conflict with local ordinances in the same category; explain in interaction and set conflict_flag.
9. requirement: one or two plain-language sentences a renter could act on. key_value: the headline number or formula, or null.
10. A document that says which units a rent-increase limit covers or exempts (for example, "units first certified for occupancy after June 13, 1979 are exempt from the rent increase limitations") states that limit's coverage: also return a rent_increase_limits record carrying those cutoffs, even when the page is mainly about another category.
11. confidence: your honest probability that the record is correct. Lower it when the text is ambiguous or incomplete, or when the document is a news report or a third-party copy of the law.`;

function userMessage(doc: CorpusDoc): string {
  return [
    `doc_id: ${doc.doc_id}`,
    `manifest jurisdiction: ${doc.jurisdictions}`,
    `source type: ${doc.source_type}`,
    `url: ${doc.url}`,
    `retrieved: ${doc.retrieved_at ?? "unknown"}`,
    "",
    "<document>",
    doc.text,
    "</document>",
  ].join("\n");
}

type DocResult = {
  doc_id: string;
  model: string;
  effort: string;
  extracted_at: string;
  stop_reason: string | null;
  usage: { input: number; output: number; cache_read: number; cache_write: number };
  rules: ExtractedRule[];
  notes: string | null;
  cached?: boolean;
};

const client = new Anthropic({ maxRetries: 6 });

async function extractDoc(doc: CorpusDoc): Promise<DocResult> {
  const cacheFile = path.join(auditDir, `${doc.doc_id}.json`);
  if (!flag("fresh") && fs.existsSync(cacheFile)) {
    return { ...(JSON.parse(fs.readFileSync(cacheFile, "utf8")) as DocResult), cached: true };
  }

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: "adaptive" },
    output_config: { effort: EFFORT, format: betaZodOutputFormat(DocExtraction) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMessage(doc) }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    console.warn(`  ${doc.doc_id}: model declined; no rules recorded`);
  }
  const parsed = message.stop_reason === "refusal" ? null : message.parsed_output;
  if (message.stop_reason !== "refusal" && !parsed) {
    throw new Error(`${doc.doc_id}: output did not match the schema (stop_reason ${message.stop_reason})`);
  }

  const result: DocResult = {
    doc_id: doc.doc_id,
    model: message.model,
    effort: EFFORT,
    extracted_at: new Date().toISOString(),
    stop_reason: message.stop_reason,
    usage: {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
      cache_read: message.usage.cache_read_input_tokens ?? 0,
      cache_write: message.usage.cache_creation_input_tokens ?? 0,
    },
    rules: parsed?.rules ?? [],
    notes: parsed?.notes ?? null,
  };
  fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2));
  return result;
}

async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const STATES: Record<string, string> = { california: "CA", "new jersey": "NJ", massachusetts: "MA" };

function normalizeJurisdiction(rule: ExtractedRule, doc: CorpusDoc): { jurisdiction: string; level: "state" | "city" } {
  let j = rule.jurisdiction.trim().replace(/^city (and county )?of /i, "").replace(/^city & county of /i, "");
  if (STATES[j.toLowerCase()]) j = STATES[j.toLowerCase()];
  if (rule.level === "state") {
    const code = j.match(/\b(CA|NJ|MA)\b/)?.[1] ?? doc.jurisdictions.match(/\b(CA|NJ|MA)\b/)?.[1] ?? j;
    return { jurisdiction: code, level: "state" };
  }
  const [cityPart, statePart] = j.split(",").map((s) => s.trim());
  const st = statePart?.match(/\b(CA|NJ|MA)\b/)?.[1] ?? (statePart ? STATES[statePart.toLowerCase()] : undefined) ?? doc.jurisdictions.match(/\b(CA|NJ|MA)\b/)?.[1] ?? "";
  return { jurisdiction: `${cityPart}, ${st}`, level: "city" };
}

function normCite(c: string): string {
  return c.toLowerCase().replace(/section|sec\.|§|\s|\.|,|-|_/g, "");
}

function normDate(d: string | null): string | null {
  if (!d) return null;
  const m = d.match(/^(\d{4})(-\d{2})?(-\d{2})?/);
  return m ? m[0] : null;
}

async function main() {
  let docs = loadCorpus(corpusDir);
  if (onlyDocs) docs = docs.filter((d) => onlyDocs.includes(d.doc_id));
  console.log(`Extracting from ${docs.length} documents with ${MODEL} (effort ${EFFORT}), ${concurrency} at a time`);

  const started = Date.now();
  const results = await pool(docs, concurrency, async (doc) => {
    try {
      const r = await extractDoc(doc);
      console.log(`  ${doc.doc_id}: ${r.rules.length} rule(s)`);
      return r;
    } catch (err) {
      console.error(`  ${doc.doc_id}: FAILED ${err instanceof Error ? err.message : err}`);
      return null;
    }
  });

  // Check the quotes, clean up the fields and attach where each record came from.
  const byDoc = new Map(docs.map((d) => [d.doc_id, d]));
  type Candidate = Omit<RuleRecord, "team_rule_id" | "overrides"> & { official: boolean; jurisdiction_matches_doc: boolean };
  const candidates: Candidate[] = [];
  let unverified = 0;
  let repaired = 0;
  for (const r of results) {
    if (!r) continue;
    const doc = byDoc.get(r.doc_id)!;
    for (const rule of r.rules) {
      const { jurisdiction, level } = normalizeJurisdiction(rule, doc);
      const span = verifySpan(rule.quoted_span, doc.text);
      if (!span.verified) unverified++;
      if (span.repaired) repaired++;
      candidates.push({
        jurisdiction,
        level,
        category: rule.category,
        status: rule.status,
        title: rule.title,
        requirement: rule.requirement,
        key_value: rule.key_value,
        coverage_conditions: rule.coverage,
        exemptions: rule.exemptions,
        interaction: rule.interaction,
        effective_date: normDate(rule.effective_date),
        citation: rule.citation,
        source_doc_id: doc.doc_id,
        source_url: doc.url,
        retrieved_at: doc.retrieved_at,
        quoted_span: span.span,
        span_verified: span.verified,
        confidence: Math.max(0, Math.min(1, span.verified ? rule.confidence : Math.min(rule.confidence, 0.4))),
        conflict_flag: rule.conflict_flag,
        conflict_note: [rule.conflict_note, doc.reviewer_note].filter(Boolean).join(" ") || null,
        penalty: rule.penalty,
        yields_to_local_rule: rule.yields_to_local_rule,
        may_preempt_local_rules: rule.may_preempt_local_rules,
        source_type: doc.source_type,
        source_in_starter_corpus: doc.in_starter_corpus,
        source_jurisdiction: doc.jurisdictions,
        official: !doc.source_type.startsWith("secondary"),
        jurisdiction_matches_doc: doc.jurisdictions.includes(jurisdiction),
      });
    }
  }

  // One record per jurisdiction + category + citation. We keep the best-supported copy.
  const rank = (c: Candidate) =>
    (c.span_verified ? 4 : 0) + (c.official ? 2 : 0) + (c.jurisdiction_matches_doc ? 1 : 0) + c.confidence;
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = `${c.jurisdiction}|${c.category}|${normCite(c.citation)}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const kept = [...groups.values()].map((g) => {
    const best = [...g].sort((a, b) => rank(b) - rank(a))[0];
    // When several documents state the same law, fill in whatever the kept record
    // is missing (coverage cutoffs, effective date, key figure) from the others.
    const filledFrom = new Set<string>();
    for (const c of g) {
      if (c === best) continue;
      const bc = best.coverage_conditions;
      const cc = c.coverage_conditions;
      for (const k of ["min_units", "max_units", "built_on_or_before", "built_after", "exempt_if_newer_than_years", "owner_based_exemption_max_units"] as const) {
        if (bc[k] == null && cc[k] != null) {
          (bc as Record<string, unknown>)[k] = cc[k];
          if ((k === "built_on_or_before" || k === "built_after") && cc.cutoff_uses_certificate_of_occupancy) bc.cutoff_uses_certificate_of_occupancy = true;
          filledFrom.add(c.source_doc_id);
        }
      }
      if (!best.effective_date && c.effective_date) {
        best.effective_date = c.effective_date;
        filledFrom.add(c.source_doc_id);
      }
      if (!best.key_value && c.key_value) {
        best.key_value = c.key_value;
        filledFrom.add(c.source_doc_id);
      }
    }
    if (filledFrom.size) {
      const note = `Fields filled from ${[...filledFrom].join(", ")}, which state the same law.`;
      best.consolidation_note = best.consolidation_note ? `${best.consolidation_note} ${note}` : note;
    }
    const statuses = new Set(g.map((c) => c.status));
    const dates = new Set(g.map((c) => c.effective_date).filter(Boolean));
    if (statuses.size > 1 || dates.size > 1) {
      best.conflict_flag = true;
      const note = `Sources disagree: status ${[...statuses].join(" / ")}${dates.size > 1 ? `; effective date ${[...dates].join(" / ")}` : ""}.`;
      best.conflict_note = best.conflict_note ? `${best.conflict_note} ${note}` : note;
    }
    return best;
  });

  kept.sort((a, b) =>
    a.level !== b.level
      ? a.level === "state" ? -1 : 1
      : a.jurisdiction.localeCompare(b.jurisdiction) || a.category.localeCompare(b.category) || a.citation.localeCompare(b.citation),
  );
  const rules: RuleRecord[] = kept.map((c, i) => {
    const { official, jurisdiction_matches_doc, ...rest } = c;
    void official;
    void jurisdiction_matches_doc;
    return { team_rule_id: `r-${String(i + 1).padStart(4, "0")}`, overrides: [], ...rest };
  });

  // Fill in overrides. A state rule that yields to local rules lists them, and they list it back.
  for (const s of rules.filter((r) => r.level === "state" && r.yields_to_local_rule)) {
    const locals = rules.filter((r) => r.level === "city" && r.category === s.category && r.jurisdiction.endsWith(`, ${s.jurisdiction}`));
    s.overrides = locals.map((l) => l.team_rule_id);
    for (const l of locals) l.overrides.push(s.team_rule_id);
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ rules }, null, 2));

  const usage = results.reduce(
    (acc, r) => (r && !r.cached ? { i: acc.i + r.usage.input, o: acc.o + r.usage.output, cr: acc.cr + r.usage.cache_read, cw: acc.cw + r.usage.cache_write } : acc),
    { i: 0, o: 0, cr: 0, cw: 0 },
  );
  const cost = (usage.i * 4 + usage.o * 20 + usage.cr * 0.2 + usage.cw * 5) / 1e6;
  const summary = {
    finished_at: new Date().toISOString(),
    model: MODEL,
    effort: EFFORT,
    documents: docs.length,
    failed_documents: results.filter((r) => !r).length,
    candidate_rules: candidates.length,
    rules: rules.length,
    unverified_spans: unverified,
    repaired_spans: repaired,
    tokens: usage,
    approx_cost_usd_this_run: Number(cost.toFixed(2)),
    seconds: Math.round((Date.now() - started) / 1000),
  };
  fs.writeFileSync(path.join("out", "audit", "extract-summary.json"), JSON.stringify(summary, null, 2));
  console.log(summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

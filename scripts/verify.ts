// The second agent from our team call: something that checks the extractor's
// work instead of trusting it. A different model reads each document next to
// the cards extracted from it and says, field by field, whether the document
// actually supports the card, quoting the sentence that does. We then check
// those quotes ourselves, plus simple facts (does the date, the number or the
// section number appear in the text at all?).
//
// A field only gets removed when both the auditor and the plain checks come up
// empty, so one model's mistake can't delete good data. A card whose main
// requirement isn't supported is rejected and logged in data/derived/rejected.json.
//
//   npx tsx scripts/verify.ts            # reuses cached audits in out/audit/verify/
//   npx tsx scripts/verify.ts --fresh
import "./load-env";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { loadCorpus, type CorpusDoc } from "../src/lib/law/corpus";
import { sectionKey } from "../src/lib/law/rules";
import type { RuleRecord } from "../src/lib/law/schema";
import { verifySpan } from "../src/lib/law/spans";

const MODEL = process.env.VERIFY_MODEL ?? "claude-sonnet-5-5";
const IN = "out/rules.json";
const OUT = "out/rules.verified.json";
const AUDIT_DIR = "out/audit/verify";
const fresh = process.argv.includes("--fresh");
fs.mkdirSync(AUDIT_DIR, { recursive: true });

const FIELDS = ["requirement", "key_value", "effective_date", "status", "coverage", "citation"] as const;
type Field = (typeof FIELDS)[number];

const Check = z.object({
  verdict: z.enum(["supported", "partly_supported", "not_supported", "not_applicable"]),
  evidence: z.string().nullable().describe("Text copied character for character from the document that supports (or contradicts) the value. One or two sentences. Null if there is none."),
  note: z.string().nullable().describe("Short reason, especially for partly_supported and not_supported."),
});
const CardAudit = z.object({
  team_rule_id: z.string(),
  requirement: Check,
  key_value: Check,
  effective_date: Check,
  status: Check,
  coverage: Check,
  citation: Check,
});
const DocAudit = z.object({ cards: z.array(CardAudit) });
type Audit = z.infer<typeof CardAudit>;

const SYSTEM = `You are the second reviewer on a team that turns housing law into rule cards. Another model read the document below and wrote the cards. You did not write them, and you should not assume they are right. Your job is to check each card against this document and nothing else.

For each card, judge these fields: requirement, key_value, effective_date, status (as of 2026-10-01), coverage (the unit thresholds and construction or certificate-of-occupancy cutoffs listed) and citation.
- supported: the document states it. Copy the sentence that states it into evidence, character for character.
- partly_supported: the document supports part of it, or the value follows from the text by a small step the card explains. Examples: a date computed from "the first day of the twelfth month next following the date of enactment" and a stated enactment date; an effective date computed from a stated adoption date and the default rule the card names (a New Jersey municipal ordinance takes effect 20 days after final passage, N.J.S.A. 40:69A-181(b); a California city ordinance takes effect 30 days after final adoption, Gov. Code § 36937). Copy the supporting text and say in note what is missing.
- not_supported: the document does not state it, or says something different. Say why in note. Put contradicting text in evidence if there is any.
- not_applicable: the field is empty on the card.

Judge only from this document. Outside knowledge does not count as support, even if you believe the card is right. A status of in_force with no effective date is supported when the document presents the rule as current law. A requirement is supported when the document states the rule it describes, even if the card says it in plainer words. Do not rewrite the cards.`;

type Card = RuleRecord & { verification?: unknown };

// Other documents a card took fields from when the same law showed up in several places.
const siblingDocs = (r: Card) => [...new Set((r.consolidation_note ?? "").match(/\b(?:D|X)\d{3}\b/g) ?? [])].filter((d) => d !== r.source_doc_id);

function cardForAudit(r: Card) {
  const c = r.coverage_conditions;
  const coverage = Object.fromEntries(
    Object.entries({
      min_units: c.min_units,
      max_units: c.max_units,
      built_on_or_before: c.built_on_or_before,
      built_after: c.built_after,
      cutoff_is_certificate_of_occupancy: c.cutoff_uses_certificate_of_occupancy || null,
      exempt_if_newer_than_years: c.exempt_if_newer_than_years,
      owner_based_exemption_max_units: c.owner_based_exemption_max_units,
    }).filter(([, v]) => v != null),
  );
  return {
    team_rule_id: r.team_rule_id,
    jurisdiction: r.jurisdiction,
    category: r.category,
    title: r.title,
    requirement: r.requirement,
    key_value: r.key_value,
    effective_date: r.effective_date,
    status: r.status,
    coverage: Object.keys(coverage).length ? coverage : null,
    citation: r.citation,
    extractor_notes: [r.interaction, r.conflict_note].filter(Boolean).join(" ") || null,
  };
}

const client = new Anthropic({ maxRetries: 6 });

async function audit(doc: CorpusDoc, cards: Card[], extra: CorpusDoc[]): Promise<Audit[]> {
  const payload = cards.map(cardForAudit);
  const extraText = extra.map((d) => `<document id="${d.doc_id}" url="${d.url}">\n${d.text}\n</document>`).join("\n\n");
  // Cache on card content, not ids: extraction renumbers ids whenever cards are added.
  const content = payload.map(({ team_rule_id, ...rest }) => (void team_rule_id, rest));
  const key = crypto.createHash("sha1").update(MODEL + SYSTEM + doc.text + extraText + JSON.stringify(content)).digest("hex");
  const file = path.join(AUDIT_DIR, `${doc.doc_id}.json`);
  if (!fresh && fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    if (cached.key === key && Array.isArray(cached.ids) && cached.ids.length === cards.length) {
      // The cache stores the ids the cards had then; same content means same order, so map through it.
      const pos = new Map<string, number>((cached.ids as string[]).map((id, i) => [id, i]));
      return (cached.cards as Audit[]).filter((a) => pos.has(a.team_rule_id)).map((a) => ({ ...a, team_rule_id: cards[pos.get(a.team_rule_id)!].team_rule_id }));
    }
  }
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(DocAudit) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content:
          `<document id="${doc.doc_id}" url="${doc.url}">\n${doc.text}\n</document>\n\n` +
          (extra.length ? `Some cards also took fields from these documents about the same law. Support from any of them counts.\n\n${extraText}\n\n` : "") +
          `<cards>\n${JSON.stringify(payload, null, 1)}\n</cards>`,
      },
    ],
  });
  const msg = await stream.finalMessage();
  const out = msg.parsed_output?.cards ?? [];
  fs.writeFileSync(file, JSON.stringify({ key, doc_id: doc.doc_id, ids: cards.map((c) => c.team_rule_id), model: msg.model, audited_at: new Date().toISOString(), cards: out }, null, 1));
  return out;
}

// Plain checks that don't need a model.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function dateInText(date: string, text: string): boolean {
  const [y, m, d] = date.split("-").map(Number);
  if (!m) return text.includes(String(y));
  const month = MONTHS[m - 1];
  const forms = [
    date,
    `${m}/${d}/${y}`,
    `${m}-${d}-${y}`,
    `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`,
    `${month} ${d}, ${y}`,
    `${month} ${d} ${y}`,
    `${month.slice(0, 3)}. ${d}, ${y}`,
    `${month.slice(0, 3)} ${d}, ${y}`,
    `${month} ${y}`,
  ];
  const flat = text.replace(/\s+/g, " ");
  return forms.some((f) => flat.includes(f));
}
const numbersIn = (s: string) => s.match(/\d+(?:\.\d+)?/g) ?? [];
function plainCheck(field: Field, r: Card, text: string): boolean | null {
  const flat = text.replace(/\s+/g, " ");
  if (field === "key_value") return r.key_value ? numbersIn(r.key_value).every((n) => flat.includes(n)) : null;
  if (field === "effective_date") {
    if (!r.effective_date) return null;
    if (dateInText(r.effective_date, text)) return true;
    // A date computed from a stated adoption date and a named default rule counts
    // when the adoption date (effective date minus the default period) is in the text.
    const why = `${r.interaction ?? ""} ${r.conflict_note ?? ""}`;
    const days = /40:69A-181/.test(why) ? 20 : /36937/.test(why) ? 30 : null;
    if (days == null || r.effective_date.length < 10) return false;
    const [y, m, d] = r.effective_date.split("-").map(Number);
    const adopted = new Date(Date.UTC(y, m - 1, d) - days * 86400000).toISOString().slice(0, 10);
    return dateInText(adopted, text);
  }
  if (field === "coverage") {
    const c = r.coverage_conditions;
    const years = [c.built_on_or_before, c.built_after].filter((x): x is string => Boolean(x)).map((d) => d.slice(0, 4));
    return years.length ? years.every((y) => flat.includes(y)) : null;
  }
  if (field === "citation") {
    const k = sectionKey(r.citation);
    const num = k?.base.replace(/^c\d+[a-z]*§|^bill:[a-z]+|^ch/, "");
    return num ? flat.toLowerCase().includes(num.toLowerCase()) : null;
  }
  return null;
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

async function main() {
  const rules: Card[] = JSON.parse(fs.readFileSync(IN, "utf8")).rules;
  const docs = new Map(loadCorpus().map((d) => [d.doc_id, d]));
  const byDoc = new Map<string, Card[]>();
  for (const r of rules) byDoc.set(r.source_doc_id, [...(byDoc.get(r.source_doc_id) ?? []), r]);
  console.log(`Auditing ${rules.length} cards from ${byDoc.size} documents with ${MODEL}`);

  const audits = new Map<string, Audit>();
  await pool([...byDoc.keys()], 4, async (docId) => {
    const doc = docs.get(docId);
    if (!doc) return;
    const cards = byDoc.get(docId)!;
    const extra = [...new Set(cards.flatMap(siblingDocs))].map((d) => docs.get(d)).filter((d): d is CorpusDoc => Boolean(d));
    try {
      for (const a of await audit(doc, cards, extra)) audits.set(a.team_rule_id, a);
      process.stdout.write(".");
    } catch (err) {
      console.error(`\n  ${docId}: audit failed (${err instanceof Error ? err.message : err}); its cards pass through unchecked`);
    }
  });
  console.log("");

  const kept: Card[] = [];
  const rejected: { team_rule_id: string; jurisdiction: string; category: string; title: string; citation: string; source_doc_id: string; reason: string }[] = [];
  const tally = { cards: rules.length, audited: 0, all_supported: 0, fields_removed: 0, disputed: 0, rejected: 0 };

  for (const r of rules) {
    const a = audits.get(r.team_rule_id);
    const doc = docs.get(r.source_doc_id);
    if (!a || !doc) {
      kept.push(r);
      continue;
    }
    tally.audited++;
    const text = [doc.text, ...siblingDocs(r).map((d) => docs.get(d)?.text ?? "")].join("\n\n");
    const verdicts: Record<string, string> = {};
    const evidence: { field: Field; quote: string }[] = [];
    const changes: string[] = [];
    let disputed = false;
    for (const f of FIELDS) {
      const c = a[f];
      verdicts[f] = c.verdict;
      if (c.evidence && (c.verdict === "supported" || c.verdict === "partly_supported")) {
        const span = verifySpan(c.evidence, text);
        if (span.verified) evidence.push({ field: f, quote: span.span });
      }
      if (c.verdict !== "not_supported") continue;
      const plain = plainCheck(f, r, text);
      if (f === "key_value" && plain === false) {
        changes.push(`key figure "${r.key_value}" removed: the document does not state it (${c.note ?? "auditor"})`);
        r.key_value = null;
      } else if (f === "effective_date" && plain === false) {
        changes.push(`effective date ${r.effective_date} removed: the document does not state it (${c.note ?? "auditor"})`);
        r.effective_date = null;
      } else if (f === "coverage" && plain === false) {
        changes.push(`coverage cutoff removed: the document does not state it (${c.note ?? "auditor"})`);
        r.coverage_conditions = { ...r.coverage_conditions, built_on_or_before: null, built_after: null, cutoff_uses_certificate_of_occupancy: false };
      } else if (f !== "requirement") {
        disputed = true;
        changes.push(`second check disputes the ${f.replace("_", " ")}: ${c.note ?? "not stated in the document"}`);
      }
    }
    tally.fields_removed += changes.filter((x) => x.includes("removed")).length;

    // A card whose main rule the document doesn't state goes out, and we log why.
    if (a.requirement.verdict === "not_supported") {
      rejected.push({ team_rule_id: r.team_rule_id, jurisdiction: r.jurisdiction, category: r.category, title: r.title, citation: r.citation, source_doc_id: r.source_doc_id, reason: a.requirement.note ?? "The document does not state this rule." });
      tally.rejected++;
      continue;
    }
    const supportedAll = FIELDS.every((f) => verdicts[f] === "supported" || verdicts[f] === "not_applicable");
    if (supportedAll) tally.all_supported++;
    if (disputed) tally.disputed++;
    const partly = FIELDS.some((f) => verdicts[f] === "partly_supported");
    r.confidence = Math.min(r.confidence, disputed ? 0.6 : partly ? 0.8 : 0.95);
    r.verification = { model: MODEL, verdicts, evidence, changes };
    kept.push(r);
  }

  fs.writeFileSync(OUT, JSON.stringify({ rules: kept }, null, 2));
  fs.mkdirSync("data/derived", { recursive: true });
  fs.writeFileSync("data/derived/rejected.json", JSON.stringify(rejected, null, 1));
  fs.writeFileSync("out/audit/verify-summary.json", JSON.stringify({ finished_at: new Date().toISOString(), model: MODEL, ...tally }, null, 2));
  console.log(tally);
  for (const x of rejected) console.log(`  rejected ${x.team_rule_id} (${x.citation}): ${x.reason}`);
  console.log(`wrote ${OUT}; npm run pipeline picks it up`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

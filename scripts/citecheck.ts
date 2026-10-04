// Cite-check. Our lawyer's two rules: a citation is code + section (plus the
// ordinance or chapter in brackets), never a law's nickname; and the quote has to
// come from the source the citation names. Many supplied documents are agency
// pages or guides that state a statute in their own words. Their quotes stay on
// the cards, since the citation metric counts only the supplied corpus, and each
// card also gets a quote from the law's own text: a supplied document that is the
// statute or code itself, or an official text we saved in corpus_crosscheck/.
//
// A model writes the citation and picks the quote. Code then checks that every
// number in the citation (section, ordinance, docket) appears in a document we
// hold for that card, and that the quote is word for word in the official text.
// Anything that fails keeps the old citation, and the log says why.
//
//   npx tsx scripts/citecheck.ts                     # reads the grouped rules, writes out/citecheck.json
//   npx tsx scripts/citecheck.ts --only "CA;NJ"      # just these jurisdictions
import "./load-env";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { standardize, type CiteCheckEntry } from "../src/lib/law/cite";
import { loadCorpus, parseCsv, type CorpusDoc } from "../src/lib/law/corpus";
import { normalizeRules } from "../src/lib/law/rules";
import type { RuleRecord } from "../src/lib/law/schema";
import { verifySpan } from "../src/lib/law/spans";

const MODEL = process.env.CITE_MODEL ?? "claude-opus-5-5";
const RULES_IN = process.env.RULES_IN ?? ["out/rules.grouped.json", "out/rules.verified.json", "out/rules.json"].find((f) => fs.existsSync(f))!;
const CROSS_DIR = "corpus_crosscheck";
const CACHE = "out/audit/citecheck";
fs.mkdirSync(CACHE, { recursive: true });

const Check = z.object({
  citation: z.string().describe("The citation in the house style. Every number in it must appear in one of the documents."),
  citation_basis: z.string().describe("Which document states each number in the citation, e.g. '§ 165.00: O031; Ord. No. 187737: O030'"),
  source_is_law_text: z.boolean().describe("True if the card's own source document is the text of the law the citation names"),
  official_doc_id: z.string().nullable().describe("The document that is the official text of the cited law, or null if none is"),
  official_quote: z.string().nullable().describe("One to three sentences copied word for word from that document, stating this card's rule. No ellipses."),
  is_city_policy: z.boolean().describe("True if the rule is an agency policy, not an ordinance, statute or regulation"),
  note: z.string().describe("One sentence on what changed in the citation and why, or 'unchanged'"),
});
type Check = z.infer<typeof Check>;

const SYSTEM = `You cite-check one rule card from a housing-law database, for a lawyer. You get the card and some documents. Do two things.

1. Write the card's citation in this style.
- A citation is code + section, with the ordinance, chapter or bill in parentheses: "Cal. Civ. Code § 1950.5(c) (Stats. 2023, ch. 733, AB 12)", "N.J.S.A. 2A:18-61.1(f)", "San Diego Mun. Code § 98.1103 (Ord. O-21955 N.S.)", "L.A. Mun. Code § 165.00 et seq. (Ord. No. 187737)", "S.F. Police Code art. 49, § 4901 et seq. (Fair Chance Ordinance)", "Berkeley Mun. Code ch. 13.77 (Ellis Implementation Ordinance)".
- A law's nickname ("Just Cause Ordinance", "FEHA", "Measure BB", "Rent Ordinance") is not a citation. It may follow the code cite in parentheses.
- One name per code: "Cal. Civ. Code", "Cal. Gov. Code", "Cal. Bus. & Prof. Code", "N.J.S.A.", "L.A. Mun. Code", "S.F. Admin. Code", "S.F. Police Code", "San Diego Mun. Code", "Berkeley Mun. Code", "Santa Ana Mun. Code", "Cambridge Mun. Code", "Hoboken Code", "Newark Mun. Code". Keep the card's existing form for Massachusetts ("M.G.L. c. 186 § 18"), Boston and Jersey City codes.
- A court case: the citation is the case itself, "Name v. Name, docket number (Court Month Day, Year)"; what the case decided goes in the note. A ballot measure: what it is, the jurisdiction and the election date. A pending or failed bill: bill number and session. An agency policy: its name and date, and say it is a policy.
- If a document says a proposal was adopted, cite the adopted law, never "proposed" or a draft number.
- Lead with the section that holds the card's rule, never a purpose or definitions section, and do not widen a pinpoint into a range. Keep a subsection when the card's main rule sits in it; list other subsections the card also states after "see also id.".
- A session law in parentheses names the act that added or last changed the cited provision. For a whole section, write "as amended through" the latest session law the text shows.
- Use only numbers (sections, chapters, articles, ordinance, docket and bill numbers, dates) that appear in the documents. If no document states the section, cite what they do state and add "(section not stated)". Never guess a number.
- A name in parentheses (a short title such as "Fair Chance Ordinance") must be a name the law's own text uses; leave out names that only agency pages or news use.
- If the citation is already right, return it unchanged.

2. Find the law's own words. If one of the documents is the official text of the law the citation names (a statute, code section, ordinance, regulation, bill or ballot text as published by the legislature, the city, or the city's code publisher), copy one to three sentences from it, word for word, that state this card's rule, and give its id. Start the passage at the beginning of a sentence of the law itself and end it at the end of a sentence; never include history notes, amendment notes or editor's notes. When the current codified code and an ordinance as enacted both hold the passage, quote the code. Agency web pages, guides, FAQs, bulletins, rate notices, newsletters, news stories, law-firm alerts and third-party copies are not the law's text. Prefer the card's own source when it is the law's text. Return null when no document is.`;

type Doc = CorpusDoc & { cites: string | null; where: "supplied" | "extra" | "crosscheck" };

function loadCrosscheck(): Doc[] {
  if (!fs.existsSync(CROSS_DIR)) return [];
  return fs
    .readdirSync(CROSS_DIR)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) => {
      const text = fs.readFileSync(path.join(CROSS_DIR, f), "utf8");
      const header = (name: string) => text.match(new RegExp(`^${name}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? null;
      return {
        doc_id: f.replace(/\.txt$/, ""),
        jurisdictions: header("JURISDICTION") ?? "",
        url: header("SOURCE") ?? "",
        source_type: header("TYPE") ?? "official",
        retrieved_at: header("RETRIEVED"),
        text,
        in_starter_corpus: false,
        cites: header("CITES"),
        where: "crosscheck" as const,
      };
    })
    .filter((d) => d.doc_id !== "D032"); // the landlord group's copy of Hoboken's code; we cite the city's own
}

// Agendas, staff reports, newsletters and old copies help confirm a number, but a
// quote of the law has to come from the law's text.
const lawText = (d: Doc) => !/^secondary|not (?:the law's|code) text|record|older version|newsletter|staff report/i.test(d.source_type);

const STATE_NAMES: Record<string, string> = { california: "CA", "new jersey": "NJ", massachusetts: "MA" };
function sameJurisdiction(doc: Doc, card: RuleRecord): boolean {
  const j = doc.jurisdictions.toLowerCase();
  const want = card.jurisdiction.toLowerCase();
  if (card.level === "state") return j === want || STATE_NAMES[j] === card.jurisdiction || j.split(/[;,]\s*/).includes(want);
  return j.includes(want.split(",")[0]);
}

// Long documents are cut to the windows that share the most words with the card.
function excerpt(text: string, card: RuleRecord, budget = 18000): string {
  if (text.length <= budget) return text;
  const words = new Set(
    `${card.citation} ${card.title} ${card.requirement} ${card.key_value ?? ""}`
      .toLowerCase()
      .match(/[a-z0-9.§:-]{4,}/g) ?? [],
  );
  const size = 3000;
  const windows: { i: number; score: number }[] = [];
  for (let i = 0; i < text.length; i += size) {
    const w = text.slice(i, i + size).toLowerCase();
    let score = 0;
    for (const t of words) if (w.includes(t)) score++;
    windows.push({ i, score });
  }
  const pick = windows
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.floor(budget / size))
    .sort((a, b) => a.i - b.i);
  return [text.slice(0, 600), ...pick.map((w) => text.slice(w.i, w.i + size))].join("\n[...]\n");
}

// Numbers in a citation. A range ("98.1102-98.1104", "§§ 54-55") counts as its two ends.
const tokens = (citation: string) =>
  (citation.match(/[A-Za-z]{0,4}-?\d[\d.,:\-]*[A-Za-z0-9]*/g) ?? [])
    .map((t) => t.replace(/[.,:-]+$/, ""))
    .flatMap((t) => (/^\d+(?:\.\d+)*-\d+(?:\.\d+)*$/.test(t) ? t.split("-") : [t]))
    .filter(Boolean);
const flat = (s: string) => s.toLowerCase().replace(/[\s,]+/g, "");

// The words of a document without the header lines we write on top (SOURCE, NOTE,
// CITES...): a citation has to rest on the document itself, never on our notes.
const body = (text: string) => text.replace(/^(?:[A-Z_]+:.*\n)+\n?/, "");

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// A date in a citation ("June 23, 2026", "Nov. 5, 2024") must appear in a document as written or in numbers.
function dateFound(month: string, day: string, year: string, texts: string[]): boolean {
  const m = MONTH_NAMES.findIndex((n) => n.startsWith(month.toLowerCase().slice(0, 3))) + 1;
  if (!m) return true;
  const forms = [
    new RegExp(`\\b${MONTH_NAMES[m - 1].slice(0, 3)}[a-z]*\\.?\\s+${Number(day)},?\\s+${year}`, "i"),
    new RegExp(`\\b${m}[/-]${Number(day)}[/-](?:${year}|${year.slice(2)})\\b`),
    new RegExp(`${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`),
  ];
  return texts.some((t) => forms.some((f) => f.test(t)));
}

// Every number in the citation must be in a document we hold for this card.
function unsupported(citation: string, texts: string[]): string[] {
  const hay = texts.map(flat);
  const bad = tokens(citation).filter((t) => !hay.some((h) => h.includes(flat(t))));
  for (const m of citation.matchAll(/\b([A-Z][a-z]{2,8})\.?\s+(\d{1,2}),\s*(\d{4})\b/g)) {
    if (!dateFound(m[1], m[2], m[3], texts)) bad.push(m[0]);
  }
  for (const m of citation.matchAll(/\bart(?:icle)?\.?\s+([IVXLC]+|\d+)\b/gi)) {
    const re = new RegExp(`\\barticle\\s+${m[1]}\\b`, "i");
    if (!texts.some((t) => re.test(t))) bad.push(`art. ${m[1]}`);
  }
  return bad;
}

const client = new Anthropic({ maxRetries: 6 });

// Our lawyer's citation requests (review/citation_requests.csv). The model treats
// each one as a reviewer's suggestion: it follows it where the documents support
// it, and says so where they show something else.
const REQUESTS = fs.existsSync("review/citation_requests.csv") ? parseCsv(fs.readFileSync("review/citation_requests.csv", "utf8")) : [];
const requestFor = (card: RuleRecord) =>
  REQUESTS.find((q) => q.jurisdiction === card.jurisdiction && q.category === card.category && new RegExp(q.match, "i").test(`${card.citation} ${card.title}`));

async function check(card: RuleRecord, docs: Doc[]): Promise<Check> {
  const brief = {
    jurisdiction: card.jurisdiction,
    category: card.category,
    status: card.status,
    citation: card.citation,
    title: card.title,
    requirement: card.requirement,
    key_value: card.key_value,
    effective_date: card.effective_date,
    source_doc_id: card.source_doc_id,
    quoted_span: card.quoted_span,
    merged_from: card.consolidation_note,
  };
  const body = docs.map((d) => `<document id="${d.doc_id}" url="${d.url}" kind="${d.where === "supplied" ? "supplied corpus" : "captured by the team"}; ${d.source_type}"${d.cites ? ` cites="${d.cites}"` : ""}>\n${excerpt(d.text, card)}\n</document>`).join("\n\n");
  const req = requestFor(card);
  const ask = req
    ? `\n\n<reviewer_request>Our lawyer asked for this citation: ${req.requested_citation}.${req.reviewer_note ? ` ${req.reviewer_note}` : ""} Use her form, including her pinpoint and her parentheticals, wherever the documents support it. Depart from it only where a document shows a different section, article, ordinance number or date, and say which document in the note.</reviewer_request>`
    : "";
  const user = `<card>\n${JSON.stringify(brief, null, 1)}\n</card>${ask}\n\n${body}`;
  const key = crypto.createHash("sha1").update(MODEL + SYSTEM + user).digest("hex");
  // Cached on content, so renumbered cards keep their answers.
  const file = path.join(CACHE, `${key}.json`);
  let result: Check | null = null;
  let model = MODEL;
  if (fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    if (cached.key === key && (cached.retried || !needsRetry(cached.result, docs))) return cached.result as Check;
    if (cached.key === key) result = cached.result as Check;
  }
  if (!result) {
    const msg = await client.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium", format: betaZodOutputFormat(Check) },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
      })
      .finalMessage();
    if (!msg.parsed_output) throw new Error(`no structured output for ${card.team_rule_id}`);
    result = msg.parsed_output;
    model = msg.model;
  }
  // A quote that is not word for word in its document gets one more try.
  let retried = false;
  if (needsRetry(result, docs)) {
    retried = true;
    const od = docs.find((d) => d.doc_id === result!.official_doc_id)!;
    const retry = await client.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium", format: betaZodOutputFormat(Check) },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [
          { role: "user", content: user },
          { role: "assistant", content: JSON.stringify(result) },
          { role: "user", content: `Your official_quote is not word for word in ${od.doc_id}. Copy a passage exactly as it appears there (same words, same order, no ellipses, no added words), or return null for official_quote. Keep the other fields.` },
        ],
      })
      .finalMessage();
    if (retry.parsed_output) result = retry.parsed_output;
  }
  fs.writeFileSync(file, JSON.stringify({ key, team_rule_id: card.team_rule_id, model, docs: docs.map((d) => d.doc_id), retried, result }, null, 1));
  return result;
}

// Code publishers' pages hold the law as it reads today; an ordinance PDF or an
// agenda copy holds it as enacted.
const CODE_HOSTS = /ecode360\.com|codelibrary\.amlegal\.com|library\.municode\.com|municipal\.codes|leginfo\.legislature\.ca\.gov\/faces\/codes|lis\.njleg|malegislature\.gov\/Laws/i;

// Finish an official quote in code: run it to the end of its sentence, and when the
// same words are in a current code page as well, point to that page.
function finishQuote(official: NonNullable<CiteCheckEntry["official_text"]>, docs: Doc[]): NonNullable<CiteCheckEntry["official_text"]> {
  let { doc_id, url, retrieved_at, in_supplied_corpus, quoted_span } = official;
  const home = docs.find((d) => d.doc_id === doc_id);
  if (home) {
    const text = body(home.text);
    const at = text.indexOf(quoted_span);
    if (at >= 0 && !/[.;:]["”’)]*\s*$/.test(quoted_span)) {
      const rest = text.slice(at + quoted_span.length);
      const end = rest.search(/[.;](?=\s|$)/);
      if (end >= 0 && end < 400) quoted_span += rest.slice(0, end + 1);
    }
  }
  if (!CODE_HOSTS.test(url)) {
    const norm = (t: string) => t.replace(/\s+/g, " ").trim();
    const code = docs.find((d) => d.doc_id !== doc_id && CODE_HOSTS.test(d.url) && lawText(d) && norm(body(d.text)).includes(norm(quoted_span)));
    if (code) {
      const v = verifySpan(quoted_span, body(code.text));
      if (v.verified) ({ doc_id, url, retrieved_at, in_supplied_corpus, quoted_span } = { doc_id: code.doc_id, url: code.url, retrieved_at: code.retrieved_at, in_supplied_corpus: code.in_starter_corpus, quoted_span: v.span });
    }
  }
  return { doc_id, url, retrieved_at, in_supplied_corpus, quoted_span };
}

function needsRetry(result: Check, docs: Doc[]): boolean {
  const od = docs.find((d) => d.doc_id === result.official_doc_id);
  return Boolean(od && result.official_quote && !verifySpan(result.official_quote, body(od.text)).verified);
}

async function main() {
  const rules = normalizeRules(JSON.parse(fs.readFileSync(RULES_IN, "utf8"))).rules;
  const corpus = loadCorpus();
  const all: Doc[] = [
    ...corpus.map((d) => ({ ...d, cites: null, where: d.in_starter_corpus ? ("supplied" as const) : ("extra" as const) })),
    ...loadCrosscheck(),
  ];
  const byId = new Map(all.map((d) => [d.doc_id, d]));

  const docsFor = (card: RuleRecord): Doc[] => {
    const named = new Set([card.source_doc_id, ...`${card.consolidation_note ?? ""} ${card.conflict_note ?? ""}`.matchAll(/\b([DXO]\d{3})\b/g)].map((m) => (typeof m === "string" ? m : m[1])));
    const own = [...named].map((id) => byId.get(id)).filter((d): d is Doc => Boolean(d));
    // Official texts for this jurisdiction: everything in corpus_crosscheck, and the
    // captured official texts in corpus_extra.
    // Ranked by the section numbers they share with the card, then by shared words.
    const nums = new Set(tokens(card.citation).map(flat));
    const words = new Set(`${card.title} ${card.requirement}`.toLowerCase().match(/[a-z]{5,}/g) ?? []);
    const score = (d: Doc) => {
      const cites = flat(`${d.cites ?? ""} ${d.text.slice(0, 1500)}`);
      const head = d.text.slice(0, 20000).toLowerCase();
      return [...nums].filter((n) => n.length > 1 && cites.includes(n)).length * 100 + [...words].filter((w) => head.includes(w)).length;
    };
    const official = all
      .filter((d) => !named.has(d.doc_id) && (d.where === "crosscheck" || (d.where === "extra" && !d.source_type.startsWith("secondary"))) && sameJurisdiction(d, card))
      .map((d) => ({ d, s: score(d) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 5)
      .map((x) => x.d);
    return [...own.slice(0, 4), ...official];
  };

  const out: Record<string, CiteCheckEntry> = {};
  const log: string[] = [];
  let next = 0;
  let failed = 0;
  // --only "CA,NJ" limits a run to some jurisdictions; the others keep their last result.
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1].split(/\s*;\s*/) : null;
  const previous: Record<string, CiteCheckEntry> = fs.existsSync("out/citecheck.json") ? JSON.parse(fs.readFileSync("out/citecheck.json", "utf8")) : {};
  const todo = only ? rules.filter((r) => only.includes(r.jurisdiction)) : rules.slice();
  if (only) for (const r of rules) if (!only.includes(r.jurisdiction) && previous[r.team_rule_id]) out[r.team_rule_id] = previous[r.team_rule_id];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < todo.length) {
        const card = todo[next++];
        const docs = docsFor(card);
        let c: Check;
        try {
          c = await check(card, docs);
        } catch (err) {
          failed++;
          // A failed call (rate limit, no credit) keeps the card's last good result.
          const last = previous[card.team_rule_id];
          const keep = last && (last.from_citation === card.citation || last.citation === card.citation);
          if (keep) out[card.team_rule_id] = { ...last, official_text: last.official_text ? finishQuote(last.official_text, docs) : null };
          log.push(`${card.team_rule_id} | check failed (${(err instanceof Error ? err.message : String(err)).slice(0, 120)}); ${keep ? "kept the previous result" : "citation left as is"}`);
          continue;
        }
        const texts = docs.map((d) => body(d.text));
        // A name in parentheses ("(Fair Chance Ordinance)") stays only if a document uses it.
        const flatTexts = texts.map((t) => t.toLowerCase().replace(/\s+/g, " "));
        const named = c.citation.replace(/\s*\(([^()]*[A-Za-z][^()\d]*)\)/g, (all, inner: string) =>
          /\d/.test(inner) || flatTexts.some((t) => t.includes(inner.toLowerCase().replace(/\s+/g, " ").trim())) ? all : "",
        );
        const proposed = standardize(named);
        const bad = unsupported(proposed, texts);
        const citation = bad.length ? standardize(card.citation) : proposed;
        let official: CiteCheckEntry["official_text"] = null;
        let quoteNote = "no official text among the documents";
        const od = c.official_doc_id ? byId.get(c.official_doc_id) : undefined;
        if (od && c.official_quote && lawText(od)) {
          const v = verifySpan(c.official_quote, body(od.text));
          if (v.verified) {
            official = finishQuote({ doc_id: od.doc_id, url: od.url, retrieved_at: od.retrieved_at, quoted_span: v.span, in_supplied_corpus: od.in_starter_corpus }, docs);
            quoteNote = `official quote from ${od.doc_id}${v.repaired ? " (snapped to the source text)" : ""}`;
          } else quoteNote = `quote from ${od.doc_id} not found word for word; dropped`;
        }
        const title = c.is_city_policy && !/\bpolicy\b[^.]*\bnot\b|not an ordinance/i.test(card.title) ? `${card.title} (a city policy, not an ordinance)` : null;
        out[card.team_rule_id] = {
          from_citation: card.citation,
          citation,
          title,
          official_text: official,
          note: citation !== standardize(card.citation) ? c.note : null,
        };
        log.push(
          [
            card.team_rule_id,
            `${card.citation} -> ${citation}${bad.length ? ` (kept: ${proposed} has numbers not in our documents: ${bad.join(", ")})` : ""}`,
            quoteNote,
            `source is law text: ${c.source_is_law_text}`,
            `basis: ${c.citation_basis}`,
          ].join(" | "),
        );
      }
    }),
  );

  fs.writeFileSync("out/citecheck.json", JSON.stringify(out, null, 1));
  fs.writeFileSync("out/audit/citecheck.txt", log.sort().join("\n") + "\n");
  const n = Object.values(out);
  console.log(
    `${rules.length} cards: ${n.filter((e) => e.citation !== standardize(e.from_citation)).length} citations changed, ${n.filter((e) => e.official_text).length} with a quote from the law's own text (${n.filter((e) => e.official_text && !e.official_text.in_supplied_corpus).length} from texts we captured), ${failed} failed`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Scores our current rules against our lawyer's review of 92 cards
// (data/silver/lawyer_review.csv: her status, effective date, source and note for
// each law, joined to the card text she reviewed). Her row ids come from an older
// run, so each row is matched to today's card by jurisdiction, category, source
// document and code section, never by id.
//
//   npx tsx scripts/lawyer-check.ts      # prints a summary, writes out/audit/lawyer-check.txt
import fs from "node:fs";
import { parseCsv } from "../src/lib/law/corpus";
import { normalizeRules, sectionKey } from "../src/lib/law/rules";
import type { RuleRecord } from "../src/lib/law/schema";

type Row = Record<string, string>;
const rows: Row[] = parseCsv(fs.readFileSync("data/silver/lawyer_review.csv", "utf8"));
const rules = normalizeRules(JSON.parse(fs.readFileSync("submission/rules.json", "utf8")), { consolidate: false }).rules;
const changes = JSON.parse(fs.readFileSync("submission/changes.json", "utf8"));

const family = (c: string) => {
  const k = sectionKey(c);
  return k ? k.base.replace(/^ch/, "").split(".").slice(0, 2).join(".") : null;
};

// The cite-check may have renamed a citation (e.g. 2A:42-84.5 to 84.2, the section
// with the exemption); a card still answers to the name it had before.
const renamed: Record<string, { from_citation: string }> = fs.existsSync("out/citecheck.json") ? JSON.parse(fs.readFileSync("out/citecheck.json", "utf8")) : {};
const families = (r: RuleRecord) => [family(r.citation), renamed[r.team_rule_id] ? family(renamed[r.team_rule_id].from_citation) : null].filter(Boolean);

// Today's card for a reviewed law, or null if it no longer exists on its own.
function current(row: Row): RuleRecord | null {
  const same = rules.filter((r) => r.jurisdiction === row.jurisdiction && r.category === row.category);
  const fam = family(row.citation);
  const direct = same.find((r) => r.source_doc_id === row.source_doc_id && (!fam || families(r).includes(fam)));
  if (direct) return direct;
  const merged = same.find((r) => (r.consolidation_note ?? "").includes(row.source_doc_id) && (!fam || families(r).includes(fam) || !family(r.citation)));
  if (merged) return merged;
  const bySection = fam ? same.find((r) => families(r).includes(fam)) : null;
  if (bySection) return bySection;
  return same.find((r) => r.source_doc_id === row.source_doc_id) ?? null;
}

const byOldId = new Map(rows.map((r) => [r.reviewed_id, r]));
// Row -> today's card, for anyone checking her notes by hand or by agent.
fs.writeFileSync(
  "out/audit/lawyer-map.json",
  JSON.stringify(
    rows.map((row) => {
      const c = current(row);
      return { reviewed_id: row.reviewed_id, jurisdiction: row.jurisdiction, category: row.category, reviewed_citation: row.citation, lawyer_status: row.lawyer_status, lawyer_date: row.lawyer_date, lawyer_note: row.lawyer_note, current_id: c?.team_rule_id ?? null, current_citation: c?.citation ?? null, current_status: c?.status ?? null, current_date: c?.effective_date ?? null };
    }),
    null,
    1,
  ),
);
const lines: string[] = [];
const out = { rows: rows.length, matched: 0, status_agree: 0, status_total: 0, date_agree: 0, date_total: 0, merges_done: 0, merges_total: 0, coverage_folded: 0, coverage_total: 0, test_map_agree: 0, test_map_total: 0 };

for (const row of rows) {
  const cur = current(row);
  const note = row.lawyer_note;
  if (cur) out.matched++;

  if (row.lawyer_status && cur) {
    out.status_total++;
    if (cur.status === row.lawyer_status) out.status_agree++;
    else lines.push(`STATUS ${row.reviewed_id} ${row.citation.slice(0, 50)}: lawyer ${row.lawyer_status}, ours ${cur.status} (${cur.team_rule_id})`);
  }

  // Dates: count rows where she gave a date, or said to leave it blank.
  const wantsBlank = /leave effective_date blank|or blank|leave blank/i.test(note) && !row.lawyer_date;
  if (cur && (row.lawyer_date || wantsBlank)) {
    out.date_total++;
    const ours = cur.effective_date ?? "";
    // A merged subsection keeps its own date in the card's note ("§ X(c)(4) applies from ...").
    const kept = Boolean(row.lawyer_date) && (cur.consolidation_note ?? "").includes(`${row.citation} applies from ${row.lawyer_date}`);
    const ok = row.lawyer_date ? kept || ours.startsWith(row.lawyer_date) || (ours.length > 0 && row.lawyer_date.startsWith(ours)) : ours === "";
    if (ok) out.date_agree++;
    else lines.push(`DATE   ${row.reviewed_id} ${row.citation.slice(0, 50)}: lawyer ${row.lawyer_date || "blank"}, ours ${ours || "blank"} (${cur.team_rule_id})`);
  }

  // Duplicates she asked us to merge: both laws should now be the same card.
  const dup = note.match(/^Duplicate of (r-\d{4})/i) ?? note.match(/Merge into (r-\d{4})/i);
  if (dup) {
    out.merges_total++;
    const target = byOldId.get(dup[1]);
    const t = target ? current(target) : null;
    if (cur && t && cur.team_rule_id === t.team_rule_id) out.merges_done++;
    else lines.push(`MERGE  ${row.reviewed_id} -> ${dup[1]}: still separate (${cur?.team_rule_id ?? "gone"} vs ${t?.team_rule_id ?? "gone"})`);
  }

  // Coverage notes she said are not rules: they should no longer stand alone.
  if (/not a rule|coverage, not a rule|coverage table/i.test(note)) {
    out.coverage_total++;
    const alone = rules.find((r) => r.source_doc_id === row.source_doc_id && r.jurisdiction === row.jurisdiction && r.category === row.category && r.citation === row.citation);
    if (!alone) out.coverage_folded++;
    else lines.push(`COVER  ${row.reviewed_id} ${row.citation.slice(0, 50)}: still its own card (${alone.team_rule_id})`);
  }
}

// Her test map (old ids) against the rules our change tracking picked for each test.
const testMap: Record<string, string[]> = { T1: ["r-0002"], T2: ["r-0066", "r-0070"], T3: ["r-0035"], T4: ["r-0020", "r-0021"], T5: ["r-0031"] };
for (const [t, ids] of Object.entries(testMap)) {
  for (const id of ids) {
    out.test_map_total++;
    const row = byOldId.get(id);
    const cur = row ? current(row) : null;
    const picked: string[] = changes[t]?.team_rule_ids ?? [];
    if (cur && picked.includes(cur.team_rule_id)) out.test_map_agree++;
    else lines.push(`TEST   ${t} expects ${id} (${row?.citation.slice(0, 40)}): ours picked ${picked.join(", ") || "nothing"}, its card is ${cur?.team_rule_id ?? "gone"}`);
  }
}

const summary = [
  `LAWYER REVIEW (Gulnur Bekmukhanbetova, ${rows.length} cards)`,
  `  matched to a current card   ${out.matched}/${out.rows}`,
  `  status agrees               ${out.status_agree}/${out.status_total}`,
  `  effective date agrees       ${out.date_agree}/${out.date_total}`,
  `  duplicates merged           ${out.merges_done}/${out.merges_total}`,
  `  coverage notes folded       ${out.coverage_folded}/${out.coverage_total}`,
  `  test rule map agrees        ${out.test_map_agree}/${out.test_map_total}`,
];
// Her cite-check: enacted rules should cite a code section (a nickname is not a
// citation), and carry a quote from the law's own text.
const enactedRules = rules.filter((r) => r.status === "in_force" || r.status === "not_yet_effective");
const coded = enactedRules.filter((r) => sectionKey(r.citation) || /\b(?:ch|art)\.\s*[\dIVXL]/i.test(r.citation));
const ownWords = enactedRules.filter((r) => r.official_text);
summary.push(
  `  cite a code section or chapter ${coded.length}/${enactedRules.length} enacted rules`,
  `  quote the law's own text       ${ownWords.length}/${enactedRules.length} (${ownWords.filter((r) => r.official_text!.in_supplied_corpus).length} from the supplied corpus)`,
);
for (const r of enactedRules.filter((r) => !coded.includes(r))) lines.push(`CITE   ${r.team_rule_id} ${r.citation.slice(0, 70)}: no code section in the citation`);
for (const r of enactedRules.filter((r) => !r.official_text)) lines.push(`WORDS  ${r.team_rule_id} ${r.citation.slice(0, 70)}: no quote from the law's own text`);
fs.writeFileSync("out/audit/lawyer-check.txt", [...summary, "", ...lines].join("\n") + "\n");
fs.writeFileSync("out/audit/lawyer-check.json", JSON.stringify(out, null, 1));
console.log(summary.join("\n"));
if (process.argv.includes("--details")) console.log("\n" + lines.join("\n"));

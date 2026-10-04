// Same-law grouping. Different documents often cite one law by different names
// ("California Fair Employment and Housing Act" and "Cal. Gov. Code § 12955",
// "Assembly Bill 12" and "Civ. Code § 1950.5(c)"), and some cards aren't rules at
// all, only notes on which units another card covers (a coverage chart, a cutoff
// quoted in passing). String matching can't see that, so a model looks at each
// jurisdiction and category with two or more cards and says which cards are the
// same law and which are coverage notes. The code then picks the card to keep
// (supplied corpus first, official text, current figure) and folds the rest in.
//
//   npx tsx scripts/group.ts          # reads out/rules.verified.json, writes out/rules.grouped.json
import "./load-env";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { fromStarter, mergeInto, rankForKeeping } from "../src/lib/law/rules";
import type { RuleRecord } from "../src/lib/law/schema";

const MODEL = process.env.GROUP_MODEL ?? "claude-opus-5-5";
const IN = fs.existsSync("out/rules.verified.json") ? "out/rules.verified.json" : "out/rules.json";
const OUT = "out/rules.grouped.json";
const DIR = "out/audit/group";
fs.mkdirSync(DIR, { recursive: true });

const Grouping = z.object({
  same_law: z
    .array(
      z.object({
        cards: z.array(z.string()).describe("team_rule_ids of cards that state the same law (the same statute, ordinance or section), at least two"),
        key_value: z.string().nullable().describe("The merged card's key figure, built only from figures that appear on these cards; prefer the figure in force now. Null to keep the kept card's figure."),
        reason: z.string(),
      }),
    )
    .describe("Groups of cards that are one law. Cards about different laws stay out, even in the same category."),
  coverage_only: z
    .array(
      z.object({
        card: z.string().describe("A card that is not a rule but only says which units another card covers"),
        describes: z.string().describe("team_rule_id of the card whose coverage it describes"),
        reason: z.string(),
      }),
    )
    .describe("Cards that are coverage notes for another card, not rules of their own."),
});
type Grouping = z.infer<typeof Grouping>;

const SYSTEM = `You review rule cards that an extraction step wrote from housing-law documents. All cards you see share one jurisdiction and one legal category.

Find two things.
1. Cards that state the same law: the same statute, ordinance or code section, even when cited differently (a law's name versus its code section, a bill versus the section it amended, a city page versus the code it summarizes). Cards about different laws stay separate, even if they are close (for example, a source-of-income rule and a criminal-history rule are different laws; a just-cause requirement and a relocation-payment rule in different sections are different laws).
2. Cards that are not rules but only notes on which units another card covers, such as a coverage chart, or a rent-control cutoff quoted in passing on a page about something else. Say which card each one describes.

Only group what you are confident about. Do not invent figures: a merged key figure may only use numbers that appear on the cards.`;

const brief = (r: RuleRecord) => ({
  team_rule_id: r.team_rule_id,
  citation: r.citation,
  title: r.title,
  requirement: r.requirement,
  key_value: r.key_value,
  status: r.status,
  effective_date: r.effective_date,
  coverage: r.coverage_conditions.summary || null,
  source: `${r.source_doc_id} (${r.source_type ?? "starter pack"})`,
});

const client = new Anthropic({ maxRetries: 6 });

async function group(key: string, cards: RuleRecord[]): Promise<Grouping> {
  const payload = cards.map(brief);
  const content = payload.map(({ team_rule_id, ...rest }) => (void team_rule_id, rest));
  const hash = crypto.createHash("sha1").update(MODEL + SYSTEM + JSON.stringify(content)).digest("hex");
  const file = path.join(DIR, `${key.replace(/[^a-z0-9]+/gi, "_")}.json`);
  if (fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    if (cached.hash === hash && Array.isArray(cached.ids)) {
      // Same content means the same order; map the cached ids onto today's ids.
      const map = new Map<string, string>((cached.ids as string[]).map((id, i) => [id, cards[i].team_rule_id]));
      const g = cached.result as Grouping;
      return {
        same_law: g.same_law.map((s) => ({ ...s, cards: s.cards.map((c) => map.get(c) ?? c) })),
        coverage_only: g.coverage_only.map((c) => ({ ...c, card: map.get(c.card) ?? c.card, describes: map.get(c.describes) ?? c.describes })),
      };
    }
  }
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(Grouping) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: `${key}\n\n${JSON.stringify(payload, null, 1)}` }],
  });
  const msg = await stream.finalMessage();
  const result = msg.parsed_output ?? { same_law: [], coverage_only: [] };
  fs.writeFileSync(file, JSON.stringify({ hash, key, ids: cards.map((c) => c.team_rule_id), model: msg.model, result }, null, 1));
  return result;
}

const numbers = (s: string | null) => (s ?? "").match(/\d+(?:\.\d+)?/g) ?? [];

async function main() {
  const rules: RuleRecord[] = JSON.parse(fs.readFileSync(IN, "utf8")).rules;
  const byKey = new Map<string, RuleRecord[]>();
  for (const r of rules) {
    if (r.status === "failed") continue;
    const k = `${r.jurisdiction} / ${r.category}`;
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const todo = [...byKey.entries()].filter(([, cards]) => cards.length > 1);
  console.log(`Grouping ${todo.length} jurisdiction/category sets with ${MODEL}`);

  const byId = new Map(rules.map((r) => [r.team_rule_id, r]));
  const dropped = new Set<string>();
  const log: string[] = [];
  let next = 0;
  const results: [string, Grouping][] = [];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < todo.length) {
        const [k, cards] = todo[next++];
        try {
          results.push([k, await group(k, cards)]);
        } catch (err) {
          console.error(`  ${k}: grouping failed (${err instanceof Error ? err.message : err}); cards left as they are`);
        }
      }
    }),
  );

  for (const [k, g] of results.sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const c of g.coverage_only) {
      const note = byId.get(c.card);
      const target = byId.get(c.describes);
      if (!note || !target || note === target || dropped.has(c.card) || dropped.has(c.describes)) continue;
      mergeInto(target, note, { coverageOnly: true });
      dropped.add(c.card);
      log.push(`${k}: ${c.card} is a coverage note for ${c.describes} (${c.reason})`);
    }
    for (const s of g.same_law) {
      let cards = s.cards.map((id) => byId.get(id)).filter((r): r is RuleRecord => Boolean(r) && !dropped.has(r!.team_rule_id));
      // A proposal of a law we also have as enacted is dropped, not merged. A proposal in
      // the supplied corpus stays when the enacted law is only in texts we added: the
      // lookup step then marks it adopted and keeps its corpus quote.
      const enactedCards = cards.filter((r) => r.status === "in_force" || r.status === "not_yet_effective");
      if (enactedCards.length) {
        const starterLaw = enactedCards.some(fromStarter);
        for (const p of cards.filter((r) => r.status === "pending" && (starterLaw || !fromStarter(r)))) {
          dropped.add(p.team_rule_id);
          log.push(`${k}: ${p.team_rule_id} dropped, the proposal was enacted (${enactedCards.map((r) => r.team_rule_id).join(", ")})`);
        }
        cards = enactedCards;
      }
      if (cards.length < 2 || new Set(cards.map((r) => r.status)).size > 1) continue;
      const [keep, ...rest] = [...cards].sort(rankForKeeping);
      for (const r of rest) {
        mergeInto(keep, r, {});
        dropped.add(r.team_rule_id);
      }
      // A merged figure is accepted only if every number in it is on one of the cards.
      if (s.key_value) {
        const seen = new Set(cards.flatMap((r) => [...numbers(r.key_value), ...numbers(r.requirement)]));
        if (numbers(s.key_value).every((n) => seen.has(n))) keep.key_value = s.key_value;
      }
      log.push(`${k}: ${rest.map((r) => r.team_rule_id).join(", ")} merged into ${keep.team_rule_id} (${s.reason})`);
    }
  }

  const kept = rules.filter((r) => !dropped.has(r.team_rule_id));
  fs.writeFileSync(OUT, JSON.stringify({ rules: kept }, null, 2));
  fs.writeFileSync("out/audit/group-log.txt", log.join("\n") + "\n");
  console.log(`${rules.length} cards -> ${kept.length}; ${log.length} changes (out/audit/group-log.txt)`);
  for (const l of log) console.log("  " + l.slice(0, 200));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

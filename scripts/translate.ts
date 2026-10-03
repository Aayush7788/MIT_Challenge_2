// Spanish view: translates each rule card's title, plain-language requirement
// and headline figure once, at build time. Citations, numbers and dates stay as
// written. Cached by a hash of the English text, so reruns only translate new or
// changed cards.
//
//   npx tsx scripts/translate.ts
import "./load-env";
import crypto from "node:crypto";
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { normalizeRules } from "../src/lib/law/rules";

const OUT = "data/derived/rules_es.json";
const MODEL = process.env.TRANSLATE_MODEL ?? "claude-opus-5-5";

const Batch = z.object({
  cards: z.array(
    z.object({
      team_rule_id: z.string(),
      title: z.string(),
      requirement: z.string(),
      key_value: z.string().nullable(),
    }),
  ),
});

const SYSTEM = `You translate rule cards for a renter-facing housing law tool into clear, plain Spanish as spoken in the United States (neutral Latin American Spanish).
- Translate meaning faithfully. Do not add, drop or soften anything, and do not add advice.
- Keep citations, code section numbers, ordinance and bill numbers, dollar amounts, percentages and dates exactly as written.
- Keep proper names of laws in English, followed by a short Spanish gloss in parentheses the first time when it helps (for example "Tenant Protection Act (Ley de Protección al Inquilino)").
- Use "inquilino" for tenant, "arrendador" for landlord, "depósito de garantía" for security deposit, "desalojo" for eviction.
- Return one entry per input card, with the same team_rule_id.`;

type Entry = { title: string; requirement: string; key_value: string | null; source_hash: string };

async function main() {
  const rules = normalizeRules(JSON.parse(fs.readFileSync("submission/rules.json", "utf8"))).rules;
  const cache: Record<string, Entry> = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  const hash = (r: (typeof rules)[number]) => crypto.createHash("sha1").update(`${r.title}\n${r.requirement}\n${r.key_value ?? ""}`).digest("hex");
  const todo = rules.filter((r) => cache[r.team_rule_id]?.source_hash !== hash(r));
  console.log(`${rules.length} cards, ${todo.length} to translate`);

  const client = new Anthropic({ maxRetries: 6 });
  const batches: (typeof todo)[] = [];
  for (let i = 0; i < todo.length; i += 25) batches.push(todo.slice(i, i + 25));
  await Promise.all(
    batches.map(async (b) => {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        output_config: { effort: "low", format: betaZodOutputFormat(Batch) },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(b.map((r) => ({ team_rule_id: r.team_rule_id, title: r.title, requirement: r.requirement, key_value: r.key_value }))) }],
      });
      const msg = await stream.finalMessage();
      for (const c of msg.parsed_output?.cards ?? []) {
        const r = b.find((x) => x.team_rule_id === c.team_rule_id);
        if (r) cache[r.team_rule_id] = { title: c.title, requirement: c.requirement, key_value: c.key_value, source_hash: hash(r) };
      }
      console.log(`  batch of ${b.length}: ${msg.parsed_output?.cards.length ?? 0} translated`);
    }),
  );
  const keep = new Set(rules.map((r) => r.team_rule_id));
  const out = Object.fromEntries(Object.entries(cache).filter(([id]) => keep.has(id)));
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`wrote ${OUT}: ${Object.keys(out).length} cards`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

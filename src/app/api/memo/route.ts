import { z } from "zod";
import { checkProposal } from "@/lib/law/check";
import { buildingFrom, factSheet } from "@/lib/law/facts";
import { buildMemo, targetFromRow, type MemoTarget } from "@/lib/law/memo";
import { findAddress, isDate, RULES, RULES_ES } from "@/lib/law/store";
import { geocode } from "@/lib/geocode";
import { clientKey, rateLimit } from "@/lib/rate-limit";

// POST /api/memo {id | address, as_of, facts?, proposal?} -> {memo, check}
// Sample addresses resolve from the starter data; any other US address goes
// through the Census geocoder and starts with no building facts.

const Body = z.object({
  id: z.string().max(20).optional(),
  address: z.string().min(5).max(300).optional(),
  as_of: z.string().refine(isDate, "as_of must be YYYY-MM-DD"),
  facts: z
    .object({
      year_built: z.number().int().min(1700).max(2100).nullable().optional(),
      units: z.number().int().min(1).max(5000).nullable().optional(),
      co_date: z.string().refine(isDate).nullable().optional(),
    })
    .optional(),
  proposal: z
    .object({ kind: z.enum(["rent_increase_pct", "deposit_months", "application_fee_usd"]), amount: z.number().min(0).max(100000) })
    .nullable()
    .optional(),
  lang: z.enum(["en", "es"]).optional(),
});

const STATE_CODES: Record<string, string> = { California: "CA", "New Jersey": "NJ", Massachusetts: "MA" };

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  const { id, address, as_of, facts = {}, proposal, lang = "en" } = parsed.data;

  let target: MemoTarget | null = null;
  if (id) {
    const row = findAddress(id);
    if (row) target = targetFromRow(row);
  } else if (address) {
    const limit = Number(process.env.RATE_LIMIT_PER_10_MIN ?? 30);
    const rl = rateLimit(`geo:${clientKey(request)}`, limit);
    if (!rl.ok) return Response.json({ error: `Too many address lookups. Try again in ${rl.retryAfterSec}s.` }, { status: 429 });
    try {
      const j = await geocode(address, request.signal);
      if (!j) return Response.json({ error: "Address not found. Include street, city, state and ZIP." }, { status: 404 });
      const st = STATE_CODES[j.state.name] ?? j.state.name;
      target = {
        id: null,
        street_address: j.matchedAddress.split(",")[0] ?? address,
        postal_city: j.matchedAddress.split(",")[1]?.trim() ?? "",
        state: st,
        zip: j.matchedAddress.match(/\b\d{5}\b/)?.[0] ?? "",
        legal_city: j.place?.name ?? null,
        county: j.county?.name ?? null,
        geocode_method: "census",
        matched_address: j.matchedAddress,
        parcel: { state: st, year_built: null, units: null, use_code: "", use_description: "" },
      };
    } catch {
      return Response.json({ error: "The address lookup service is unavailable. Try again." }, { status: 502 });
    }
  }
  if (!target) return Response.json({ error: "Pick a sample address or enter a full US address." }, { status: 404 });

  const memo = buildMemo(RULES, target, as_of, facts);
  const check = proposal ? checkProposal(RULES, buildingFrom(target.state, target.legal_city, factSheet(target.parcel, facts)), as_of, proposal) : null;
  if (lang === "es") {
    // Card text in Spanish; citations, quotes and the engine's reasons stay as written.
    const es = (id: string) => RULES_ES[id];
    for (const c of memo.categories) {
      for (const it of c.items) {
        const t = es(it.team_rule_id);
        if (t) Object.assign(it, { title: t.title, requirement: t.requirement, key_value: t.key_value ?? it.key_value });
      }
    }
    for (const it of memo.changing) {
      const t = es(it.team_rule_id);
      if (t) it.title = t.title;
    }
    if (check) {
      for (const l of [...check.blocking, ...check.within, ...check.unsettled, ...check.could_change, ...check.context]) {
        const t = es(l.team_rule_id);
        if (t) Object.assign(l, { title: t.title, key_value: t.key_value ?? l.key_value });
      }
    }
  }
  return Response.json({ memo, check, supported: ["CA", "NJ", "MA"].includes(target.state) });
}

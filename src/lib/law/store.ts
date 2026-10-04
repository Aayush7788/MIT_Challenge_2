import { createHash } from "node:crypto";
import addressesJson from "../../../data/derived/addresses.json";
import rulesJson from "../../../submission/rules.json";
import rulesEs from "../../../data/derived/rules_es.json";
import type { AddressRow } from "./memo";
import { normalizeRules } from "./rules";

// What the API routes read: the rule cards we submit and the 500 resolved addresses.

export const RULES = normalizeRules(rulesJson as unknown, { consolidate: false }).rules;
export const ADDRESSES = addressesJson as unknown as AddressRow[];
const BY_ID = new Map(ADDRESSES.map((a) => [a.address_id, a]));

// Spanish text for each card, made by scripts/translate.ts. An entry counts only
// while it matches the English card it was made from (ids can be reused).
type EsEntry = { title: string; requirement: string; key_value: string | null; source_hash?: string };
const esHash = (r: { title: string; requirement: string; key_value: string | null }) => createHash("sha1").update(`${r.title}\n${r.requirement}\n${r.key_value ?? ""}`).digest("hex");
export const RULES_ES: Record<string, EsEntry> = Object.fromEntries(
  RULES.flatMap((r) => {
    const es = (rulesEs as unknown as Record<string, EsEntry>)[r.team_rule_id];
    return es && es.source_hash === esHash(r) ? [[r.team_rule_id, es]] : [];
  }),
);

export const findAddress = (id: string) => BY_ID.get(id.trim().toUpperCase()) ?? null;

export function searchAddresses(q: string, limit = 12): AddressRow[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return ADDRESSES.filter((a) => {
    const hay = `${a.address_id} ${a.street_address} ${a.postal_city} ${a.legal_city ?? ""} ${a.state} ${a.zip}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  }).slice(0, limit);
}

export const isDate = (s: unknown): s is string => typeof s === "string" && /^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

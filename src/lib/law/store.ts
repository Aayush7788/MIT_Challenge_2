import addressesJson from "../../../data/derived/addresses.json";
import rulesJson from "../../../submission/rules.json";
import type { AddressRow } from "./memo";
import { normalizeRules } from "./rules";

// Server-side data: the submitted rule records and the resolved sample addresses.

export const RULES = normalizeRules(rulesJson as unknown).rules;
export const ADDRESSES = addressesJson as unknown as AddressRow[];
const BY_ID = new Map(ADDRESSES.map((a) => [a.address_id, a]));

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

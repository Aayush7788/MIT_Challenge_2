// Module B, step 1: resolve every sample address to its legal jurisdiction
// (state, county, incorporated city) with the Census geocoder. The mailing city
// is not always the legal city ("Dorchester" is Boston), so we geocode.
//
//   npx tsx scripts/geocode-addresses.ts           # resolves addresses not already in out/jurisdictions.json
//   npx tsx scripts/geocode-addresses.ts --fresh
import "./load-env";
import fs from "node:fs";
import { loadAddresses } from "../src/lib/law/corpus";
import { geocode, type Jurisdiction } from "../src/lib/geocode";

const OUT = "data/derived/jurisdictions.json";
const fresh = process.argv.includes("--fresh");

export type ResolvedAddress = {
  address_id: string;
  state: string;
  city: string | null; // legal city, null if unincorporated or unresolved
  county: string | null;
  method: "census" | "census_without_zip" | "postal_city_fallback" | "unresolved";
  matched_address: string | null;
};

const STATE_CODES: Record<string, string> = { California: "CA", "New Jersey": "NJ", Massachusetts: "MA" };

async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw lastErr;
}

function toResolved(id: string, fallbackState: string, j: Jurisdiction | null, method: ResolvedAddress["method"]): ResolvedAddress {
  if (!j) return { address_id: id, state: fallbackState, city: null, county: null, method: "unresolved", matched_address: null };
  return {
    address_id: id,
    state: STATE_CODES[j.state.name] ?? fallbackState,
    city: j.place?.name ?? null,
    county: j.county?.name ?? null,
    method,
    matched_address: j.matchedAddress,
  };
}

// Parcel data writes "1031-1035 CLINTON ST", "397 05TH AV", "Harvard ST LOT 2A-13".
function cleanStreet(s: string): string {
  return s
    .replace(/^(\d+)[A-Z]?\s*-\s*[\d.]+[A-Z]?\b/i, "$1")
    .replace(/\b0+(\d+)(ST|ND|RD|TH)\b/gi, "$1$2")
    .replace(/\bAV\b/gi, "AVE")
    .replace(/\bLOT\b.*$/i, "")
    .trim();
}

const houseNumber = (s: string) => s.match(/^\s*(\d+)/)?.[1] ?? null;

// Boston neighborhoods and San Diego communities used as mailing cities.
const MAILING_CITY_TO_LEGAL: Record<string, string> = {
  Allston: "Boston", Brighton: "Boston", Charlestown: "Boston", Dorchester: "Boston", "East Boston": "Boston",
  "Hyde Park": "Boston", "Jamaica Plain": "Boston", Mattapan: "Boston", Roslindale: "Boston", Roxbury: "Boston",
  "South Boston": "Boston", "West Roxbury": "Boston", "San Ysidro": "San Diego",
};

async function resolveOne(a: ReturnType<typeof loadAddresses>[number]): Promise<ResolvedAddress> {
  const street = cleanStreet(a.street_address);
  const queries: [string, ResolvedAddress["method"]][] = [];
  if (a.zip) queries.push([`${street}, ${a.postal_city}, ${a.state} ${a.zip}`, "census"]);
  queries.push([`${street}, ${a.postal_city}, ${a.state}`, a.zip ? "census_without_zip" : "census"]);
  const wantNumber = houseNumber(street);
  for (const [q, method] of queries) {
    const j = await withRetry(() => geocode(q));
    // Reject matches to a different house number (e.g. "322 Western Ave" matched to "5 Western Ave").
    if (j && (!wantNumber || houseNumber(j.matchedAddress) === wantNumber)) return toResolved(a.address_id, a.state, j, method);
  }
  // No usable match (often no house number in the parcel record): fall back to the mailing city.
  return {
    address_id: a.address_id,
    state: a.state,
    city: MAILING_CITY_TO_LEGAL[a.postal_city] ?? a.postal_city,
    county: null,
    method: "postal_city_fallback",
    matched_address: null,
  };
}

async function main() {
  const addresses = loadAddresses();
  const existing: Record<string, ResolvedAddress> =
    !fresh && fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  const todo = addresses.filter((a) => !existing[a.address_id] || existing[a.address_id].method === "unresolved");
  console.log(`${addresses.length} addresses, ${todo.length} to geocode`);

  let done = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < todo.length) {
        const a = todo[next++];
        existing[a.address_id] = await resolveOne(a);
        if (++done % 50 === 0) {
          console.log(`  ${done}/${todo.length}`);
          fs.writeFileSync(OUT, JSON.stringify(existing, null, 2));
        }
      }
    }),
  );
  fs.mkdirSync("out", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(existing, null, 2));

  const all = Object.values(existing);
  const byCity = new Map<string, number>();
  for (const r of all) byCity.set(`${r.city ?? "(none)"}, ${r.state}`, (byCity.get(`${r.city ?? "(none)"}, ${r.state}`) ?? 0) + 1);
  console.log("Resolved cities:", Object.fromEntries([...byCity.entries()].sort()));
  console.log("Mailing-city fallback:", all.filter((r) => r.method === "postal_city_fallback").map((r) => r.address_id).join(", ") || "none");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Address -> state / county / city using the free US Census geocoder (no key).
// An address outside any incorporated city gets place = null (unincorporated county).

export type Area = { name: string; fips: string };

export type Jurisdiction = {
  input: string;
  matchedAddress: string;
  lat: number;
  lon: number;
  state: Area;
  county: Area | null;
  place: Area | null;
};

const ENDPOINT = "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";
const cache = new Map<string, Jurisdiction | null>();

type CensusGeo = { NAME?: string; GEOID?: string };
type CensusMatch = {
  matchedAddress: string;
  coordinates: { x: number; y: number };
  geographies: Record<string, CensusGeo[] | undefined>;
};

// "San Francisco city" -> "San Francisco", "Paradise town" -> "Paradise"
function cleanPlaceName(name: string): string {
  return name.replace(/\s+(city|town|village|borough|municipality|CDP|city and borough)$/i, "").trim();
}

function first(geo: Record<string, CensusGeo[] | undefined>, key: string): CensusGeo | null {
  const list = geo[key];
  return list && list.length > 0 ? list[0] : null;
}

export async function geocode(address: string, signal?: AbortSignal): Promise<Jurisdiction | null> {
  const key = address.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  const params = new URLSearchParams({
    address,
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    layers: "States,Counties,Incorporated Places",
    format: "json",
  });
  const res = await fetch(`${ENDPOINT}?${params}`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`Census geocoder returned HTTP ${res.status}`);

  const data = (await res.json()) as { result?: { addressMatches?: CensusMatch[] } };
  const match = data.result?.addressMatches?.[0];
  if (!match) {
    cache.set(key, null);
    return null;
  }

  const state = first(match.geographies, "States");
  const county = first(match.geographies, "Counties");
  const place = first(match.geographies, "Incorporated Places");
  if (!state?.NAME || !state.GEOID) {
    cache.set(key, null);
    return null;
  }

  const result: Jurisdiction = {
    input: address,
    matchedAddress: match.matchedAddress,
    lat: match.coordinates.y,
    lon: match.coordinates.x,
    state: { name: state.NAME, fips: state.GEOID },
    county: county?.NAME && county.GEOID ? { name: county.NAME, fips: county.GEOID } : null,
    place: place?.NAME && place.GEOID ? { name: cleanPlaceName(place.NAME), fips: place.GEOID } : null,
  };
  cache.set(key, result);
  return result;
}

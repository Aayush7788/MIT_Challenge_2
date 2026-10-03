import type { Address } from "./schema";
import type { Building } from "./engine";

// Building facts the engine checks rules against, each tagged with where it
// came from. The parcel data has year built and unit count for most rows. When
// the count is missing, the assessor's land-use text usually still gives a range
// (e.g. "APT 7-30 UNITS", "3S-F-D-6U" or NJ class 4C). Users can fill in the rest.

export type FactSource = "public record" | "land-use code" | "you entered" | "not in data";
export type Fact<T> = { value: T | null; source: FactSource; note?: string };

export type FactSheet = {
  year_built: Fact<number>;
  units: Fact<number>;
  units_min: Fact<number>;
  units_max: Fact<number>;
  co_date: Fact<string>;
};

export type UserFacts = { year_built?: number | null; units?: number | null; co_date?: string | null };

const WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// Unit count (or a range) from the assessor's land-use description.
export function unitsFromLandUse(state: string, useCode: string, desc: string): { min: number | null; max: number | null; exact: number | null; basis: string } | null {
  const d = desc.replace(/(\d)O(?=U\b)/gi, "$10"); // "5B-1OU" is a typo for 10U
  // NJ class codes give a unit count per building, e.g. "3S-F-D-6U-NH" or "3B-7U/4B-24U-G".
  const per = [...d.matchAll(/(\d+)\s*U\b/gi)].map((m) => Number(m[1]));
  if (per.length === 1) return { min: per[0], max: per[0], exact: per[0], basis: `assessor class code "${desc}"` };
  if (per.length > 1) return { min: Math.max(...per), max: per.reduce((a, b) => a + b, 0), exact: null, basis: `assessor class code "${desc}" (several buildings)` };

  let m = d.match(/(\d+)\s*(?:to|-)\s*(\d+)\s*-?\s*units?\b/i);
  if (m) return { min: Number(m[1]), max: Number(m[2]), exact: null, basis: `land-use description "${desc}"` };
  m = d.match(/>\s*(\d+)\s*-?\s*units?\b/i);
  if (m) return { min: Number(m[1]) + 1, max: null, exact: null, basis: `land-use description "${desc}"` };
  m = d.match(/(\d+)\s*\+\s*units?\b/i) ?? d.match(/(\d+)\s*units?\s*or\s*more/i);
  if (m) return { min: Number(m[1]), max: null, exact: null, basis: `land-use description "${desc}"` };
  m = d.match(/(\d+)\s*units?\s*or\s*less/i);
  if (m) return { min: null, max: Number(m[1]), exact: null, basis: `land-use description "${desc}"` };
  m = d.match(/\b(two|three|four|five|six|seven|eight|nine|ten)\s+or\s+more\s+(?:apartments|units)/i);
  if (m) return { min: WORDS[m[1].toLowerCase()], max: null, exact: null, basis: `land-use description "${desc}"` };

  // We read NJ property class 4C as apartments with 5+ units, since 1-4 family
  // homes are class 2. Worth confirming against the state's classification manual.
  if (state === "NJ" && useCode.trim().toUpperCase() === "4C") {
    return { min: 5, max: null, exact: null, basis: "New Jersey property class 4C (apartment building, 5 or more units)" };
  }
  return null;
}

export function factSheet(a: Pick<Address, "state" | "year_built" | "units" | "use_code" | "use_description">, user: UserFacts = {}): FactSheet {
  const fromUse = unitsFromLandUse(a.state, a.use_code, a.use_description);
  const none = <T,>(): Fact<T> => ({ value: null, source: "not in data" });

  const year_built: Fact<number> =
    user.year_built != null ? { value: user.year_built, source: "you entered" } : a.year_built != null ? { value: a.year_built, source: "public record" } : none();

  let units: Fact<number> = none();
  if (user.units != null) units = { value: user.units, source: "you entered" };
  else if (a.units != null) units = { value: a.units, source: "public record" };
  else if (fromUse?.exact != null) units = { value: fromUse.exact, source: "land-use code", note: fromUse.basis };

  const units_min: Fact<number> = units.value != null ? { ...units } : fromUse?.min != null ? { value: fromUse.min, source: "land-use code", note: fromUse.basis } : none();
  const units_max: Fact<number> = units.value != null ? { ...units } : fromUse?.max != null ? { value: fromUse.max, source: "land-use code", note: fromUse.basis } : none();
  const co_date: Fact<string> = user.co_date ? { value: user.co_date, source: "you entered" } : none();

  return { year_built, units, units_min, units_max, co_date };
}

export function buildingFrom(state: string, city: string | null, facts: FactSheet): Building {
  return {
    state,
    city,
    year_built: facts.year_built.value,
    units: facts.units.value,
    units_min: facts.units_min.value,
    units_max: facts.units_max.value,
    co_date: facts.co_date.value,
  };
}

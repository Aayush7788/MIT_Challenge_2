import type { CheckResult, ProposalKind } from "@/lib/law/check";
import type { Category, Result } from "@/lib/law/schema";

// Interface text in English and Spanish. The rule cards come back from the
// server already translated (scripts/translate.ts), with citations and quotes
// left as they are.

export type Lang = "en" | "es";

const en = {
  title: "Rental Housing Law Navigator",
  subtitle: "Which housing rules apply to this apartment on this date, with the source text for each one.",
  navChanges: "Law changes",
  navRules: "Rule cards",
  other: "Español",
  notAdvice: "Not legal advice",
  tabSample: "500 sample buildings",
  tabAny: "Any US address",
  phSample: "Search by street, city or ZIP (e.g. Clinton Hoboken)",
  phAny: "Full address, then Enter (e.g. 1 Dr Carlton B Goodlett Pl, San Francisco, CA 94102)",
  legalCityHit: "legal city:",
  tryIt: "Try:",
  examples: ["San Francisco, built 1926", "Los Angeles, built 1997", "Hoboken, NJ", "South Boston mailing address"],
  asOf: "As of",
  chipNotes: ["before CA AB 325", "after CA AB 325", "default query date", "after NJ FAIR Act"],
  memoHeader: "Address memo · as of",
  legalJur: "Legal jurisdiction:",
  states: { CA: "California", NJ: "New Jersey", MA: "Massachusetts" } as Record<string, string>,
  unincorporated: "unincorporated area",
  mailingNote: (m: string, c: string) => `The mailing city is ${m}, but the legal city is ${c}. City rules follow the legal city.`,
  geocoded: (a: string) => `Located with the US Census geocoder (${a}).`,
  fallback: "The Census geocoder found no match, so the mailing city is used; a reviewer should confirm it.",
  lawsAsOf: (d: string) => ` Laws as published on ${d}; later changes are not reflected.`,
  unsupported: "Our sources cover California, New Jersey and Massachusetts only. Nothing below is complete for this state.",
  rulesReach: (n: number) => `${n} rules reach this address`,
  results: { applies: "Applies", superseded: "Superseded here", unknown: "Unknown", not_yet_effective: "Not yet in effect", pending: "Pending bill" } as Record<Result, string>,
  categories: {
    rent_increase_limits: "Rent increases",
    just_cause_eviction: "Eviction (just cause)",
    security_deposits: "Security deposit",
    application_screening_fees: "Application and screening fees",
    screening_restrictions: "Screening restrictions",
    algorithmic_rent_setting: "Algorithmic pricing",
  } as Record<Category, string>,
  noRule: "No rule in our sources reaches this address in this category on this date.",
  stateTag: (j: string) => `State: ${j}`,
  cityTag: (j: string) => `City: ${j}`,
  flag: "Flag for review",
  confidence: "Confidence",
  levels: { high: "high", medium: "medium", low: "low" } as Record<string, string>,
  highTip: "Verified quote from official text; facts from public records.",
  keyFigure: "Key figure:",
  takesEffect: (d: string) => `Takes effect ${d}.`,
  why: "Why:",
  showSource: "Show source text",
  hideSource: "Hide source text",
  quoteVerified: "Quote checked word for word against the source. ",
  quoteNotVerified: "Quote not verified. ",
  sourceRetrieved: (doc: string, d: string) => `Source ${doc}, retrieved ${d}.`,
  openSource: "Open source",
  exemptions: "Exemptions:",
  reviewerNote: "Reviewer note:",
  ruleMeta: (id: string, status: string, conf: number) => `Rule ${id} · status ${status} · model confidence ${conf}%`,
  canDo: "Can the landlord do this?",
  kinds: { rent_increase_pct: "Raise rent by (%)", deposit_months: "Ask a deposit of (months)", application_fee_usd: "Charge an application fee ($)" } as Record<ProposalKind, string>,
  checkOn: (d: string) => `Check on ${d}`,
  groups: { blocking: "Blocks it", unsettled: "Can't settle from public data", within: "Within these limits", context: "Context", could_change: "Could change" },
  checkFoot: "Answers come from the rules listed here only. This tool does not suggest ways around a rule.",
  facts: "Building facts",
  yearBuilt: "Year built",
  units: "Units",
  unitRange: "Unit range",
  co: "Certificate of occupancy",
  notInData: "not in data",
  sources: { "public record": "public record", "land-use code": "land-use code", "you entered": "you entered", "not in data": "not in data" } as Record<string, string>,
  toRange: (a: string, b: string) => `${a} to ${b}`,
  unitRangeFrom: (n: string) => `Unit range ${n}.`,
  ownerNote: "Owner type and owner occupancy are not in public records, so rules that turn on them stay unknown.",
  knowMore: "Know more? Enter it",
  coDate: "Certificate of occupancy date",
  update: "Update memo",
  changing: "What is changing",
  takesEffectComma: (d: string) => `, takes effect ${d}`,
  noChange: "No pending bill or upcoming law in our sources reaches this address.",
  flagsTitle: "Flags for human review",
  footer1:
    "Not legal advice and not a compliance certification. This prototype summarizes public state and city law from a fixed set of sources (retrieved October 1, 2026). It can be wrong or out of date. Check with a lawyer, a tenant or landlord organization, or your local rent board before acting.",
  footer2:
    "How it works: a language model read each source document and wrote rule records, and every quote was checked word for word against the source. Addresses are placed in their legal city with the US Census geocoder. A fixed rules engine (no model at question time) tests each rule against the building facts and the date, and says unknown when the public data cannot settle it.",
  locale: "en-US",
};

const es: typeof en = {
  title: "Navegador de Leyes de Vivienda en Alquiler",
  subtitle: "Qué normas de vivienda aplican a este apartamento en esta fecha, con el texto de la fuente de cada una.",
  navChanges: "Cambios en la ley",
  navRules: "Fichas de normas",
  other: "English",
  notAdvice: "No es asesoría legal",
  tabSample: "500 edificios de muestra",
  tabAny: "Cualquier dirección de EE. UU.",
  phSample: "Busque por calle, ciudad o código postal (p. ej., Clinton Hoboken)",
  phAny: "Dirección completa y luego Enter (p. ej., 1 Dr Carlton B Goodlett Pl, San Francisco, CA 94102)",
  legalCityHit: "ciudad legal:",
  tryIt: "Pruebe:",
  examples: ["San Francisco, construido en 1926", "Los Ángeles, construido en 1997", "Hoboken, NJ", "Dirección postal de South Boston"],
  asOf: "A la fecha",
  chipNotes: ["antes de AB 325 (CA)", "después de AB 325 (CA)", "fecha de consulta predeterminada", "después de la Ley FAIR (NJ)"],
  memoHeader: "Memorando de la dirección · a la fecha",
  legalJur: "Jurisdicción legal:",
  states: { CA: "California", NJ: "Nueva Jersey", MA: "Massachusetts" },
  unincorporated: "zona no incorporada",
  mailingNote: (m, c) => `La ciudad postal es ${m}, pero la ciudad legal es ${c}. Las normas municipales siguen a la ciudad legal.`,
  geocoded: (a) => `Ubicada con el geocodificador del Censo de EE. UU. (${a}).`,
  fallback: "El geocodificador del Censo no encontró la dirección, así que se usa la ciudad postal; una persona debe confirmarlo.",
  lawsAsOf: (d) => ` Leyes según su publicación al ${d}; no se reflejan cambios posteriores.`,
  unsupported: "Nuestras fuentes cubren solo California, Nueva Jersey y Massachusetts. Lo siguiente no está completo para este estado.",
  rulesReach: (n) => `${n} normas alcanzan esta dirección`,
  results: { applies: "Aplica", superseded: "Desplazada aquí", unknown: "Desconocido", not_yet_effective: "Aún no vigente", pending: "Proyecto pendiente" },
  categories: {
    rent_increase_limits: "Aumentos de renta",
    just_cause_eviction: "Desalojo (causa justa)",
    security_deposits: "Depósito de garantía",
    application_screening_fees: "Cuotas de solicitud y evaluación",
    screening_restrictions: "Restricciones en la evaluación de inquilinos",
    algorithmic_rent_setting: "Fijación de precios por algoritmo",
  },
  noRule: "Ninguna norma de nuestras fuentes alcanza esta dirección en esta categoría en esta fecha.",
  stateTag: (j) => `Estado: ${j}`,
  cityTag: (j) => `Ciudad: ${j}`,
  flag: "Revisión humana",
  confidence: "Confianza",
  levels: { high: "alta", medium: "media", low: "baja" },
  highTip: "Cita verificada de texto oficial; datos de registros públicos.",
  keyFigure: "Cifra clave:",
  takesEffect: (d) => `Entra en vigor el ${d}.`,
  why: "Por qué (en inglés):",
  showSource: "Mostrar texto de la fuente",
  hideSource: "Ocultar texto de la fuente",
  quoteVerified: "Cita verificada palabra por palabra con la fuente. ",
  quoteNotVerified: "Cita no verificada. ",
  sourceRetrieved: (doc, d) => `Fuente ${doc}, consultada el ${d}.`,
  openSource: "Abrir la fuente",
  exemptions: "Exenciones (en inglés):",
  reviewerNote: "Nota para revisión (en inglés):",
  ruleMeta: (id, status, conf) => `Norma ${id} · estado ${status} · confianza del modelo ${conf}%`,
  canDo: "¿Puede el arrendador hacer esto?",
  kinds: { rent_increase_pct: "Subir la renta en (%)", deposit_months: "Pedir un depósito de (meses)", application_fee_usd: "Cobrar una cuota de solicitud ($)" },
  checkOn: (d) => `Verificar al ${d}`,
  groups: { blocking: "Lo impide", unsettled: "No se puede resolver con datos públicos", within: "Dentro de estos límites", context: "Contexto", could_change: "Podría cambiar" },
  checkFoot: "Las respuestas salen solo de las normas listadas aquí. Esta herramienta no sugiere formas de evitar una norma.",
  facts: "Datos del edificio",
  yearBuilt: "Año de construcción",
  units: "Unidades",
  unitRange: "Rango de unidades",
  co: "Certificado de ocupación",
  notInData: "sin dato",
  sources: { "public record": "registro público", "land-use code": "código de uso de suelo", "you entered": "dato suyo", "not in data": "sin dato" },
  toRange: (a, b) => `${a} a ${b}`,
  unitRangeFrom: (n) => `Rango de unidades (en inglés): ${n}.`,
  ownerNote: "El tipo de propietario y si vive en el edificio no están en los registros públicos, así que las normas que dependen de eso quedan como desconocidas.",
  knowMore: "¿Sabe más? Ingréselo",
  coDate: "Fecha del certificado de ocupación",
  update: "Actualizar memorando",
  changing: "Qué está cambiando",
  takesEffectComma: (d) => `, entra en vigor el ${d}`,
  noChange: "Ningún proyecto pendiente ni ley próxima de nuestras fuentes alcanza esta dirección.",
  flagsTitle: "Alertas para revisión humana",
  footer1:
    "No es asesoría legal ni una certificación de cumplimiento. Este prototipo resume leyes públicas estatales y municipales de un conjunto fijo de fuentes (consultadas el 1 de octubre de 2026). Puede contener errores o estar desactualizado. Consulte a un abogado, a una organización de inquilinos o arrendadores, o a la junta de rentas de su ciudad antes de actuar.",
  footer2:
    "Cómo funciona: un modelo de lenguaje leyó cada documento fuente y redactó fichas de normas, y cada cita se verificó palabra por palabra con la fuente. Las direcciones se ubican en su ciudad legal con el geocodificador del Censo de EE. UU. Un motor de reglas fijo (sin modelo al responder) prueba cada norma con los datos del edificio y la fecha, y dice desconocido cuando los datos públicos no alcanzan.",
  locale: "es-US",
};

export const STRINGS: Record<Lang, typeof en> = { en, es };

export function fmtDate(d: string | null | undefined, lang: Lang = "en"): string {
  if (!d) return "";
  const parts = d.split("-").map(Number);
  if (parts.length === 1) return d;
  const date = new Date(Date.UTC(parts[0], (parts[1] ?? 1) - 1, parts[2] ?? 1));
  return new Intl.DateTimeFormat(STRINGS[lang].locale, { timeZone: "UTC", month: "short", day: parts[2] ? "numeric" : undefined, year: "numeric" }).format(date);
}

const amountText = (kind: ProposalKind, n: number | null, lang: Lang) => {
  if (n == null) return "?";
  if (kind === "rent_increase_pct") return `${n}%`;
  if (kind === "application_fee_usd") return `$${n}`;
  if (lang === "es") return n === 1 ? "1 mes de renta" : `${n} meses de renta`;
  return n === 1 ? "1 month's rent" : `${n} months' rent`;
};

// Builds the check's headline in the reader's language from the structured result.
export function headline(c: CheckResult, kind: ProposalKind, amount: number, lang: Lang): string {
  if (lang === "en") return c.headline;
  const d = fmtDate(c.as_of, "es");
  const amt = amountText(kind, amount, "es");
  switch (c.verdict) {
    case "over_limit":
      return `No. ${c.blocking[0]?.citation ?? ""} limita esto a ${amountText(kind, c.limit, "es")} en esta dirección el ${d}.`;
    case "cant_tell":
      return `No se puede saber con datos públicos. ${c.unsettled_count === 1 ? "Una norma podría" : `${c.unsettled_count} normas podrían`} limitar ${amt}; abajo se indica qué lo resolvería.`;
    case "within_limit":
      return `${amt} está dentro de todos los límites que podrían aplicar a esta dirección el ${d}.`;
    default:
      return `No encontramos ninguna norma en nuestras fuentes que limite esto en esta dirección el ${d}.${c.context.length ? ` ${c.context[0].citation}: ${c.context[0].title}.` : ""} Otras normas, como los plazos de aviso, pueden aplicar.`;
  }
}

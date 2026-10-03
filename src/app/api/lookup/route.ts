import { buildMemo, targetFromRow } from "@/lib/law/memo";
import { findAddress, isDate, RULES } from "@/lib/law/store";

// GET /api/lookup?id=A0001&as_of=2026-10-01[&year_built=1962&units=20&co_date=1962-05-01]
// Returns every rule that reaches the address on that date, with its citation.
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const a = findAddress(p.get("id") ?? "");
  if (!a) return Response.json({ error: "Unknown address_id. Use /api/addresses?q=... to find one." }, { status: 404 });
  const asOf = p.get("as_of") ?? "2026-10-01";
  if (!isDate(asOf)) return Response.json({ error: "as_of must be YYYY-MM-DD." }, { status: 400 });
  const num = (k: string) => {
    const n = Number(p.get(k));
    return p.get(k) && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  const co = p.get("co_date");
  const memo = buildMemo(RULES, targetFromRow(a), asOf, { year_built: num("year_built"), units: num("units"), co_date: isDate(co) ? co : null });
  return Response.json({ ...memo, notice: "Not legal advice. Summaries of public law for a prototype; check with a lawyer or your local rent board." });
}

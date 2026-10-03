import Link from "next/link";
import addressesJson from "../../../data/derived/addresses.json";
import extraTests from "../../../data/derived/extra_change_tests.json";
import packTests from "../../../dev/change_tests.json";
import changesJson from "../../../submission/changes.json";
import { RULES } from "@/lib/law/store";

// Module C: each change case, the rules it maps to, and the sample addresses it
// affects, grouped by legal city.

type Test = { test_id: string; title: string; type: string; as_of?: string; as_of_before?: string; as_of_after?: string; expected_behavior?: string };
type Change = { affected_address_ids: string[]; conflict_flag_address_ids: string[]; notes: string; team_rule_ids: string[]; before_after: Record<string, { before: string | null; after: string | null }> };

const addresses = addressesJson as unknown as { address_id: string; street_address: string; legal_city: string | null; state: string }[];
const byId = new Map(addresses.map((a) => [a.address_id, a]));
const changes = changesJson as unknown as Record<string, Change>;
const tests = [...(packTests as Test[]), ...(extraTests as Test[])];
const ruleById = new Map(RULES.map((r) => [r.team_rule_id, r]));

const TYPE_LABEL: Record<string, string> = { as_of: "Takes effect", boundary: "City boundary", pending: "Pending bill", negative: "Struck measure" };

export const metadata = { title: "Law changes | Rental Housing Law Navigator" };

export default function ChangesPage() {
  return (
    <main className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Law changes</h1>
            <p className="text-sm text-stone-600">Which sample addresses each change reaches, and how the answer moves between dates.</p>
          </div>
          <nav className="flex gap-3 text-sm">
            <Link href="/" className="text-blue-700 hover:underline">Address memo</Link>
            <Link href="/rules" className="text-blue-700 hover:underline">Rule cards</Link>
            <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-800 ring-1 ring-rose-200">Not legal advice</span>
          </nav>
        </div>
      </header>
      <section className="mx-auto max-w-6xl space-y-5 px-4 py-5">
        {tests.map((t) => {
          const c = changes[t.test_id];
          if (!c) return null;
          const cities = new Map<string, number>();
          for (const id of c.affected_address_ids) {
            const a = byId.get(id);
            const k = a ? `${a.legal_city ?? "?"}, ${a.state}` : "?";
            cities.set(k, (cities.get(k) ?? 0) + 1);
          }
          const flips = new Map<string, number>();
          for (const v of Object.values(c.before_after ?? {})) {
            const k = `${(v.before ?? "not reported").replaceAll("_", " ")} → ${(v.after ?? "not reported").replaceAll("_", " ")}`;
            flips.set(k, (flips.get(k) ?? 0) + 1);
          }
          const sample = c.affected_address_ids[0];
          const date = t.as_of_after ?? t.as_of ?? "2026-10-01";
          return (
            <article key={t.test_id} className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-bold">
                  <span className="mr-2 rounded bg-stone-900 px-2 py-0.5 text-sm text-white">{t.test_id}</span>
                  {t.title}
                </h2>
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  {TYPE_LABEL[t.type] ?? t.type}
                  {t.as_of_before ? ` · ${t.as_of_before} vs ${t.as_of_after}` : t.as_of ? ` · as of ${t.as_of}` : ""}
                </span>
              </div>
              {t.expected_behavior && <p className="mt-1 text-sm text-stone-600">Test asks: {t.expected_behavior}</p>}
              <div className="mt-3 grid gap-4 md:grid-cols-[1fr_1fr]">
                <div>
                  <p className="text-3xl font-bold">{c.affected_address_ids.length}</p>
                  <p className="text-sm text-stone-600">addresses affected{c.conflict_flag_address_ids.length ? `, ${c.conflict_flag_address_ids.length} flagged for human review` : ""}</p>
                  <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                    {[...cities.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                      <li key={k} className="rounded-full bg-stone-100 px-2.5 py-1">{k}: {n}</li>
                    ))}
                    {!cities.size && <li className="text-stone-500">No sample address is affected.</li>}
                  </ul>
                  {flips.size > 0 && (
                    <ul className="mt-2 text-xs text-stone-600">
                      {[...flips.entries()].map(([k, n]) => (
                        <li key={k}>{n} × {k}</li>
                      ))}
                    </ul>
                  )}
                  {sample && (
                    <Link href={`/?id=${sample}&as_of=${date}`} className="mt-3 inline-block text-sm text-blue-700 hover:underline">
                      Open an affected address on {date}
                    </Link>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Rules it maps to</p>
                  <ul className="mt-1 space-y-2 text-sm">
                    {c.team_rule_ids.map((id) => {
                      const r = ruleById.get(id);
                      return r ? (
                        <li key={id}>
                          <span className="font-mono text-xs">{r.citation}</span>
                          <span className="block text-xs text-stone-500">
                            {r.jurisdiction} · {r.status.replaceAll("_", " ")}
                            {r.effective_date ? ` · effective ${r.effective_date}` : ""} · rule {id}
                          </span>
                        </li>
                      ) : (
                        <li key={id} className="text-xs text-stone-500">{id}</li>
                      );
                    })}
                    {!c.team_rule_ids.length && <li className="text-xs text-stone-500">No extracted rule matches this case.</li>}
                  </ul>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-stone-500">{c.notes}</p>
            </article>
          );
        })}
      </section>
    </main>
  );
}

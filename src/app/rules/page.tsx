import Link from "next/link";
import rejectedJson from "../../../data/derived/rejected.json";
import { RULES } from "@/lib/law/store";
import { CATEGORY_LABELS } from "@/lib/law/schema";

// Every rule card we extracted, with its source document and the exact quote it
// rests on. Handy for checking extraction by eye.

export const metadata = { title: "Rule cards | Rental Housing Law Navigator" };

const rejected = rejectedJson as unknown as { team_rule_id: string; jurisdiction: string; title: string; citation: string; source_doc_id: string; reason: string }[];
const FIELD_LABEL: Record<string, string> = { requirement: "rule", key_value: "key figure", effective_date: "date", status: "status", coverage: "coverage", citation: "citation" };

const STATUS_STYLE: Record<string, string> = {
  in_force: "bg-emerald-100 text-emerald-900",
  not_yet_effective: "bg-sky-100 text-sky-900",
  pending: "bg-violet-100 text-violet-900",
  failed: "bg-stone-200 text-stone-700",
};

function sourceBadge(type: string | undefined, doc: string) {
  const t = type ?? "";
  if (t.startsWith("secondary")) return { label: t.includes("news") ? "news report" : t.includes("mirror") ? "copy of the code" : "secondary source", cls: "bg-amber-100 text-amber-900" };
  if (doc.startsWith("X") || t.includes("captured")) return { label: "official, added by the team", cls: "bg-blue-100 text-blue-900" };
  return { label: "official, starter pack", cls: "bg-stone-100 text-stone-700" };
}

export default function RulesPage() {
  const groups = new Map<string, typeof RULES>();
  for (const r of RULES) groups.set(r.jurisdiction, [...(groups.get(r.jurisdiction) ?? []), r]);
  const order = [...groups.keys()].sort((a, b) => (a.length === 2 ? 0 : 1) - (b.length === 2 ? 0 : 1) || a.localeCompare(b));
  const counts = {
    total: RULES.length,
    verified: RULES.filter((r) => r.span_verified).length,
    flagged: RULES.filter((r) => r.conflict_flag).length,
    checked: RULES.filter((r) => r.verification).length,
    evidence: RULES.reduce((n, r) => n + (r.verification?.evidence.length ?? 0), 0),
  };

  return (
    <main className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Rule cards</h1>
            <p className="text-sm text-stone-600">
              {counts.total} rules read from the source documents. Every quote is checked word for word against its source ({counts.verified} of {counts.total}), a second model re-checked {counts.checked} cards field by field ({counts.evidence} supporting quotes found in the sources), and {counts.flagged} are flagged for human review.
            </p>
          </div>
          <nav className="flex gap-3 text-sm">
            <Link href="/" className="text-blue-700 hover:underline">Address memo</Link>
            <Link href="/changes" className="text-blue-700 hover:underline">Law changes</Link>
            <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-800 ring-1 ring-rose-200">Not legal advice</span>
          </nav>
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-3 text-xs text-stone-500">
          Jump to:{" "}
          {order.map((j, i) => (
            <span key={j}>
              <a href={`#${j.replace(/\W+/g, "-")}`} className="text-blue-700 hover:underline">{j}</a>
              {i < order.length - 1 ? " · " : ""}
            </span>
          ))}
        </div>
      </header>
      <section className="mx-auto max-w-6xl space-y-8 px-4 py-5">
        <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
          <h2 className="font-bold">Rejected by the second check</h2>
          {rejected.length ? (
            <ul className="mt-2 space-y-1">
              {rejected.map((x) => (
                <li key={x.team_rule_id}>
                  <span className="font-mono text-xs">{x.citation}</span> ({x.jurisdiction}, {x.source_doc_id}): {x.reason}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-stone-600">None. Every card&apos;s main rule was found in its source; disputed details are listed on the cards below and lower their confidence.</p>
          )}
        </div>
        {order.map((j) => (
          <div key={j} id={j.replace(/\W+/g, "-")}>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-600">
              {j} <span className="font-normal normal-case text-stone-500">({groups.get(j)!.length})</span>
            </h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {groups.get(j)!.map((r) => {
                const src = sourceBadge(r.source_type, r.source_doc_id);
                return (
                  <li key={r.team_rule_id} className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <span className={`rounded px-2 py-0.5 font-semibold ${STATUS_STYLE[r.status]}`}>{r.status.replaceAll("_", " ")}</span>
                      <span className="rounded bg-stone-100 px-2 py-0.5">{CATEGORY_LABELS[r.category]}</span>
                      {r.effective_date && <span className="rounded bg-stone-100 px-2 py-0.5">effective {r.effective_date}</span>}
                      {r.conflict_flag && <span className="rounded bg-rose-100 px-2 py-0.5 text-rose-800">review</span>}
                    </div>
                    <p className="mt-2 font-semibold leading-snug">{r.title}</p>
                    <p className="mt-1 text-stone-700">{r.requirement}</p>
                    {r.key_value && <p className="mt-1 text-xs"><span className="text-stone-500">Key figure: </span>{r.key_value}</p>}
                    {r.coverage_conditions.summary && <p className="mt-1 text-xs text-stone-500">Covers: {r.coverage_conditions.summary}</p>}
                    <p className="mt-2 font-mono text-xs">{r.citation}</p>
                    <details className="mt-2 text-xs text-stone-600">
                      <summary className="cursor-pointer text-blue-700">Source and quote</summary>
                      {r.official_text && r.official_text.doc_id !== r.source_doc_id && (
                        <>
                          <p className="mt-2 font-medium text-stone-800">The law&rsquo;s own text</p>
                          <blockquote className="mt-1 border-l-2 border-stone-500 pl-3 italic">&ldquo;{r.official_text.quoted_span}&rdquo;</blockquote>
                          <p className="mt-1">
                            {r.official_text.doc_id}, retrieved {r.official_text.retrieved_at?.slice(0, 10) ?? "?"} ·{" "}
                            <a href={r.official_text.url} target="_blank" rel="noreferrer" className="text-blue-700 underline">open</a>
                            {!r.official_text.in_supplied_corpus && " · saved by our team; the supplied corpus has only a summary of this law"}
                          </p>
                          <p className="mt-2 font-medium text-stone-800">The supplied corpus</p>
                        </>
                      )}
                      <blockquote className="mt-2 border-l-2 border-stone-300 pl-3 italic">&ldquo;{r.quoted_span}&rdquo;</blockquote>
                      <p className="mt-2">
                        <span className={`mr-1 rounded px-1.5 py-0.5 ${src.cls}`}>{src.label}</span>
                        {r.source_doc_id}, retrieved {r.retrieved_at?.slice(0, 10) ?? "?"} ·{" "}
                        <a href={r.source_url} target="_blank" rel="noreferrer" className="text-blue-700 underline">open</a>
                      </p>
                      {r.span_verified ? <p className="mt-1">Quote found word for word in the source text.</p> : <p className="mt-1 text-rose-700">Quote not found in the source text.</p>}
                      {r.conflict_note && <p className="mt-1 text-rose-700">Review note: {r.conflict_note}</p>}
                      {r.coverage_note && <p className="mt-1">{r.coverage_note}</p>}
                      {r.consolidation_note && <p className="mt-1">{r.consolidation_note}</p>}
                      {r.citation_note && <p className="mt-1">Citation: {r.citation_note}</p>}
                      {r.verification && (
                        <p className="mt-1">
                          Second check ({r.verification.model}):{" "}
                          {Object.entries(r.verification.verdicts)
                            .filter(([, v]) => v !== "not_applicable")
                            .map(([f, v]) => `${FIELD_LABEL[f] ?? f} ${v.replaceAll("_", " ")}`)
                            .join(", ")}
                          . {r.verification.evidence.length} supporting quotes found in the source.
                          {r.verification.changes.map((c) => (
                            <span key={c} className="block text-amber-800">{c}</span>
                          ))}
                        </p>
                      )}
                      <p className="mt-1 text-stone-400">{r.team_rule_id} · model confidence {Math.round(r.confidence * 100)}%</p>
                    </details>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import type { CheckLine, CheckResult, ProposalKind } from "@/lib/law/check";
import type { Fact } from "@/lib/law/facts";
import type { Memo, MemoItem } from "@/lib/law/memo";
import type { Result } from "@/lib/law/schema";
import { fmtDate, headline, STRINGS, type Lang } from "./i18n";

type Hit = { address_id: string; street_address: string; postal_city: string; legal_city: string | null; state: string; zip: string };
type Target = { kind: "id"; id: string; label: string } | { kind: "address"; address: string; label: string };
type S = (typeof STRINGS)["en"];

const DEFAULT_AS_OF = "2026-10-01";
const DATE_CHIPS = ["2025-12-31", "2026-01-02", "2026-10-01", "2027-07-02"];
const EXAMPLE_IDS = ["A0016", "A0035", "A0002", "A0036"];

const RESULT_CLS: Record<Result, string> = {
  applies: "bg-emerald-100 text-emerald-900 ring-emerald-300",
  superseded: "bg-slate-100 text-slate-700 ring-slate-300",
  unknown: "bg-amber-100 text-amber-900 ring-amber-300",
  not_yet_effective: "bg-sky-100 text-sky-900 ring-sky-300",
  pending: "bg-violet-100 text-violet-900 ring-violet-300",
};

function Chip({ result, L }: { result: Result; L: S }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${RESULT_CLS[result]}`}>{L.results[result]}</span>;
}

function FactRow({ label, fact, L }: { label: string; fact: Fact<number | string>; L: S }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="text-stone-600">{label}</span>
      <span className="text-right">
        <span className="font-medium">{fact.value != null ? `${fact.value}` : L.notInData}</span>
        <span className="ml-2 text-xs text-stone-500" title={fact.note}>
          {L.sources[fact.source] ?? fact.source}
        </span>
      </span>
    </div>
  );
}

function RuleCard({ it, L, lang }: { it: MemoItem; L: S; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const detail = it.explanation.match(/\(([^()]*)\.\)/)?.[1];
  return (
    <li className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-start gap-2">
        <Chip result={it.result} L={L} />
        <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{it.level === "state" ? L.stateTag(it.jurisdiction) : L.cityTag(it.jurisdiction)}</span>
        {it.conflict_flag && <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">{L.flag}</span>}
        <span
          title={it.confidence_reasons.length ? it.confidence_reasons.join("; ") : L.highTip}
          className={`ml-auto rounded px-2 py-0.5 text-xs ${it.confidence_level === "high" ? "bg-emerald-50 text-emerald-800" : it.confidence_level === "medium" ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-800"}`}
        >
          {L.confidence}: {L.levels[it.confidence_level]}
        </span>
      </div>
      <h4 className="mt-2 font-semibold leading-snug text-stone-900">{it.title}</h4>
      <p className="mt-1 text-sm leading-relaxed text-stone-700">{it.requirement}</p>
      {it.key_value && (
        <p className="mt-2 text-sm">
          <span className="text-stone-500">{L.keyFigure} </span>
          <span className="font-medium">{it.key_value}</span>
        </p>
      )}
      {it.result === "superseded" && <p className="mt-2 text-sm text-slate-600">{it.explanation.split(". ").slice(0, 1).join("")}.</p>}
      {it.result === "not_yet_effective" && it.effective_date && <p className="mt-2 text-sm text-sky-800">{L.takesEffect(fmtDate(it.effective_date, lang))}</p>}
      {detail && (
        <p className="mt-2 text-xs leading-relaxed text-stone-500">
          {L.why} {detail}.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-mono text-stone-800">{it.citation}</span>
        <button onClick={() => setOpen(!open)} className="text-blue-700 underline-offset-2 hover:underline">
          {open ? L.hideSource : L.showSource}
        </button>
      </div>
      {open && (
        <div className="mt-2 rounded-md bg-stone-50 p-3 text-xs leading-relaxed text-stone-700">
          <blockquote className="border-l-2 border-stone-300 pl-3 italic">&ldquo;{it.quoted_span}&rdquo;</blockquote>
          <p className="mt-2 text-stone-500">
            {it.span_verified ? L.quoteVerified : L.quoteNotVerified}
            {L.sourceRetrieved(it.source_doc_id, fmtDate(it.retrieved_at?.slice(0, 10), lang))}{" "}
            <a href={it.source_url} target="_blank" rel="noreferrer" className="text-blue-700 underline">
              {L.openSource}
            </a>
          </p>
          {it.source_added && <p className="mt-1 text-stone-500">{L.addedSource}</p>}
          {it.exemptions && (
            <p className="mt-1 text-stone-500">
              {L.exemptions} {it.exemptions}
            </p>
          )}
          {it.conflict_note && (
            <p className="mt-1 text-rose-700">
              {L.reviewerNote} {it.conflict_note}
            </p>
          )}
          {it.confidence_reasons.length > 0 && (
            <p className="mt-1 text-stone-500">
              {L.confidence} {L.levels[it.confidence_level]}: {it.confidence_reasons.join("; ")}.
            </p>
          )}
          {it.second_check && <p className="mt-1 text-stone-500">{lang === "es" ? `Segunda revisión (en inglés): ${it.second_check}.` : `Second check: ${it.second_check}.`}</p>}
          <p className="mt-1 text-stone-400">{L.ruleMeta(it.team_rule_id, it.status.replaceAll("_", " "), Math.round(it.confidence * 100))}</p>
        </div>
      )}
    </li>
  );
}

// One line per category, like the brief's illustrative output: the rule that
// governs here, its key figure and the citations behind the line.
function Glance({ memo, L, lang }: { memo: Memo; L: S; lang: Lang }) {
  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      <h3 className="border-b border-stone-200 px-4 py-2 text-xs font-bold uppercase tracking-wide text-stone-600">
        {L.glance} · {fmtDate(memo.as_of, lang)}
      </h3>
      <table className="w-full text-sm">
        <tbody>
          {memo.categories.map((c) => {
            const applies = c.items.filter((i) => i.result === "applies");
            const superseded = c.items.filter((i) => i.result === "superseded");
            const unknown = c.items.filter((i) => i.result === "unknown");
            const coming = c.items.filter((i) => i.result === "pending" || i.result === "not_yet_effective");
            const main = applies[0] ?? unknown[0] ?? coming[0];
            const cites = [...applies.slice(0, 2), ...superseded.slice(0, 1)].map((i) => i.citation.replace(/\s*\(.*$/, ""));
            return (
              <tr key={c.category} className="border-b border-stone-100 align-top last:border-0">
                <th className="w-40 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">{L.categories[c.category]}</th>
                <td className="px-4 py-2">
                  {main ? (
                    <>
                      <Chip result={main.result} L={L} /> <span className="font-medium">{main.key_value ?? main.title}</span>
                      {main.result === "unknown" && <span className="text-stone-500"> ({L.glanceMaybe})</span>}
                      {superseded.length > 0 && <span className="text-stone-500">; {L.glanceYields(superseded[0].citation.replace(/\s*\(.*$/, ""))}</span>}
                      {main.result === "applies" && coming.length > 0 && <span className="text-violet-800">; {L.glanceComing(coming[0].title)}</span>}
                      {cites.length > 0 && <span className="block font-mono text-xs text-stone-500">{[...new Set(cites)].join(" · ")}</span>}
                    </>
                  ) : (
                    <span className="text-stone-500">{L.glanceNone}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CheckLines({ title, lines, tone, lang }: { title: string; lines: CheckLine[]; tone: string; lang: Lang }) {
  if (!lines.length) return null;
  return (
    <div className="mt-3">
      <p className={`text-xs font-semibold uppercase tracking-wide ${tone}`}>{title}</p>
      <ul className="mt-1 space-y-1.5">
        {lines.map((l) => (
          <li key={l.team_rule_id + title} className="text-sm leading-snug text-stone-700">
            <span className="font-mono text-xs text-stone-900">{l.citation}</span>: {lang === "es" ? `${l.title}${l.key_value ? ` (${l.key_value})` : ""}.` : l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

const VERDICT_STYLE: Record<CheckResult["verdict"], string> = {
  over_limit: "border-rose-300 bg-rose-50 text-rose-900",
  within_limit: "border-emerald-300 bg-emerald-50 text-emerald-900",
  cant_tell: "border-amber-300 bg-amber-50 text-amber-900",
  no_cap_found: "border-stone-300 bg-stone-50 text-stone-900",
};

export default function Page() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  );
}

function Home() {
  const params = useSearchParams();
  const linkedId = params.get("id");
  const linkedAsOf = params.get("as_of");
  const [lang, setLang] = useState<Lang>(params.get("lang") === "es" ? "es" : "en");
  const L = STRINGS[lang];
  const [mode, setMode] = useState<"sample" | "any">("sample");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [target, setTarget] = useState<Target | null>(linkedId ? { kind: "id", id: linkedId, label: linkedId } : null);
  const [asOf, setAsOf] = useState(linkedAsOf && /^\d{4}-\d{2}-\d{2}$/.test(linkedAsOf) ? linkedAsOf : DEFAULT_AS_OF);
  const [facts, setFacts] = useState({ year_built: "", units: "", co_date: "" });
  const [applied, setApplied] = useState({ year_built: "", units: "", co_date: "" });
  const [kind, setKind] = useState<ProposalKind>("rent_increase_pct");
  const [amount, setAmount] = useState("20");
  const [askCheck, setAskCheck] = useState(false);
  type Loaded = { key: string; memo: Memo | null; check: CheckResult | null; supported: boolean; error: string };
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (mode !== "sample" || q.trim().length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const res = await fetch(`/api/addresses?q=${encodeURIComponent(q)}`, { signal: ctrl.signal }).catch(() => null);
      if (res?.ok) setHits(await res.json());
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, mode]);
  const shownHits = mode === "sample" && q.trim().length >= 2 ? hits : [];

  // One request per distinct set of inputs. The memo and the check come back together.
  const proposal = askCheck && amount.trim() && Number.isFinite(Number(amount)) ? { kind, amount: Number(amount) } : null;
  const requestKey = target
    ? JSON.stringify({
        ...(target.kind === "id" ? { id: target.id } : { address: target.address }),
        as_of: asOf,
        facts: {
          year_built: applied.year_built.trim() ? Number(applied.year_built) : null,
          units: applied.units.trim() ? Number(applied.units) : null,
          co_date: applied.co_date || null,
        },
        proposal,
        lang,
      })
    : null;

  useEffect(() => {
    if (!requestKey) return;
    const ctrl = new AbortController();
    fetch("/api/memo", { method: "POST", headers: { "content-type": "application/json" }, body: requestKey, signal: ctrl.signal })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setLoaded({ key: requestKey, memo: data.memo, check: data.check, supported: data.supported, error: "" });
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setLoaded((prev) => ({ key: requestKey, memo: prev?.memo ?? null, check: null, supported: true, error: err instanceof Error ? err.message : "Something went wrong." }));
      });
    return () => ctrl.abort();
  }, [requestKey]);

  const memo = loaded?.memo ?? null;
  const check = loaded?.key === requestKey ? (loaded?.check ?? null) : null;
  const supported = loaded?.supported ?? true;
  const error = loaded?.key === requestKey ? (loaded?.error ?? "") : "";
  const busy = Boolean(requestKey) && loaded?.key !== requestKey;

  const reset = () => {
    setFacts({ year_built: "", units: "", co_date: "" });
    setApplied({ year_built: "", units: "", co_date: "" });
  };
  const pick = (h: Hit) => {
    setTarget({ kind: "id", id: h.address_id, label: `${h.street_address}, ${h.postal_city}, ${h.state} ${h.zip}` });
    setQ("");
    setHits([]);
    reset();
    setAskCheck(false);
  };

  const total = useMemo(() => (memo ? Object.values(memo.counts).reduce((a, b) => a + b, 0) : 0), [memo]);

  return (
    <main className="min-h-screen bg-stone-50 text-stone-900" lang={lang}>
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{L.title}</h1>
            <p className="text-sm text-stone-600">{L.subtitle}</p>
          </div>
          <nav className="flex flex-wrap items-center gap-3 text-sm">
            <Link href="/changes" className="text-blue-700 hover:underline">
              {L.navChanges}
            </Link>
            <Link href="/rules" className="text-blue-700 hover:underline">
              {L.navRules}
            </Link>
            <button onClick={() => setLang(lang === "en" ? "es" : "en")} className="rounded-md border border-stone-300 px-2.5 py-1 text-xs font-semibold hover:bg-stone-100">
              {L.other}
            </button>
            <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-800 ring-1 ring-rose-200">{L.notAdvice}</span>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-5">
        <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex gap-2 text-sm">
            {(["sample", "any"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setQ("");
                }}
                className={`rounded-md px-3 py-1.5 font-medium ${mode === m ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
              >
                {m === "sample" ? L.tabSample : L.tabAny}
              </button>
            ))}
          </div>
          <div className="relative mt-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && mode === "any" && q.trim().length > 5) {
                  setTarget({ kind: "address", address: q.trim(), label: q.trim() });
                  reset();
                }
              }}
              placeholder={mode === "sample" ? L.phSample : L.phAny}
              className="w-full rounded-lg border border-stone-300 px-3 py-2.5 text-base outline-none focus:border-stone-900"
            />
            {shownHits.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-stone-200 bg-white shadow-lg">
                {shownHits.map((h) => (
                  <li key={h.address_id}>
                    <button onClick={() => pick(h)} className="w-full px-3 py-2 text-left text-sm hover:bg-stone-100">
                      <span className="font-medium">{h.street_address}</span>, {h.postal_city}, {h.state} {h.zip}
                      {h.legal_city && h.legal_city.toLowerCase() !== h.postal_city.toLowerCase() && (
                        <span className="ml-2 text-xs text-stone-500">
                          {L.legalCityHit} {h.legal_city}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!target && (
            <p className="mt-3 text-sm text-stone-600">
              {L.tryIt}{" "}
              {EXAMPLE_IDS.map((id, i) => (
                <span key={id}>
                  <button className="text-blue-700 underline-offset-2 hover:underline" onClick={() => setTarget({ kind: "id", id, label: id })}>
                    {L.examples[i]}
                  </button>
                  {i < EXAMPLE_IDS.length - 1 ? " · " : ""}
                </span>
              ))}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <label className="font-medium text-stone-700" htmlFor="asof">
              {L.asOf}
            </label>
            <input id="asof" type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
            {DATE_CHIPS.map((d, i) => (
              <button
                key={d}
                title={L.chipNotes[i]}
                onClick={() => setAsOf(d)}
                className={`rounded-full px-2.5 py-1 text-xs ${asOf === d ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
              >
                {fmtDate(d, lang)}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

        {memo && (
          <div className={`mt-5 transition-opacity ${busy ? "opacity-60" : ""}`}>
            <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                {L.memoHeader} {fmtDate(memo.as_of, lang)}
              </p>
              <h2 className="mt-1 text-lg font-bold">
                {memo.address.line}, {memo.address.mailing_city}, {memo.address.state} {memo.address.zip}
              </h2>
              <p className="mt-1 text-sm text-stone-700">
                {L.legalJur} {L.states[memo.jurisdiction.state] ?? memo.jurisdiction.state}
                {memo.jurisdiction.county ? ` › ${memo.jurisdiction.county}` : ""} › {memo.jurisdiction.city ?? L.unincorporated}
              </p>
              {memo.jurisdiction.mailing_differs && <p className="mt-1 text-sm text-amber-800">{L.mailingNote(memo.address.mailing_city, memo.jurisdiction.city ?? "")}</p>}
              <p className="mt-1 text-xs text-stone-500">
                {memo.jurisdiction.method === "census" || memo.jurisdiction.method === "census_without_zip"
                  ? L.geocoded(memo.jurisdiction.matched_address ?? "")
                  : memo.jurisdiction.method === "postal_city_fallback"
                    ? L.fallback
                    : (memo.jurisdiction.note ?? "")}
                {memo.sources_retrieved ? L.lawsAsOf(fmtDate(memo.sources_retrieved, lang)) : ""}
              </p>
              {!supported && <p className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-900">{L.unsupported}</p>}
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {(Object.keys(RESULT_CLS) as Result[]).map((r) =>
                  memo.counts[r] ? (
                    <span key={r} className={`rounded-full px-2.5 py-0.5 ring-1 ${RESULT_CLS[r]}`}>
                      {memo.counts[r]} {L.results[r].toLowerCase()}
                    </span>
                  ) : null,
                )}
                <span className="text-stone-500">{L.rulesReach(total)}</span>
              </div>
            </div>

            <Glance memo={memo} L={L} lang={lang} />

            <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
              <div className="space-y-6">
                {memo.categories.map((c) => (
                  <section key={c.category}>
                    <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-600">{L.categories[c.category]}</h3>
                    {c.items.length ? (
                      <ul className="space-y-3">
                        {c.items.map((it) => (
                          <RuleCard key={it.team_rule_id} it={it} L={L} lang={lang} />
                        ))}
                      </ul>
                    ) : (
                      <p className="rounded-lg border border-dashed border-stone-300 p-3 text-sm text-stone-500">{L.noRule}</p>
                    )}
                  </section>
                ))}
              </div>

              <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start">
                <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-bold">{L.canDo}</h3>
                  <div className="mt-2 flex gap-2">
                    <select value={kind} onChange={(e) => setKind(e.target.value as ProposalKind)} className="min-w-0 flex-1 rounded-md border border-stone-300 px-2 py-1.5 text-sm">
                      {(Object.keys(L.kinds) as ProposalKind[]).map((k) => (
                        <option key={k} value={k}>
                          {L.kinds[k]}
                        </option>
                      ))}
                    </select>
                    <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-20 rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
                  </div>
                  <button onClick={() => setAskCheck(true)} className="mt-2 w-full rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700">
                    {L.checkOn(fmtDate(asOf, lang))}
                  </button>
                  {check && proposal && (
                    <div className={`mt-3 rounded-lg border p-3 ${VERDICT_STYLE[check.verdict]}`}>
                      <p className="text-sm font-semibold leading-snug">{headline(check, proposal.kind, proposal.amount, lang)}</p>
                      <CheckLines title={L.groups.blocking} lines={check.blocking} tone="text-rose-800" lang={lang} />
                      <CheckLines title={L.groups.unsettled} lines={check.unsettled} tone="text-amber-800" lang={lang} />
                      <CheckLines title={L.groups.within} lines={check.within} tone="text-emerald-800" lang={lang} />
                      <CheckLines title={L.groups.context} lines={check.context} tone="text-stone-600" lang={lang} />
                      <CheckLines title={L.groups.could_change} lines={check.could_change} tone="text-violet-800" lang={lang} />
                    </div>
                  )}
                  <p className="mt-2 text-xs text-stone-500">{L.checkFoot}</p>
                </div>

                <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-bold">{L.facts}</h3>
                  <div className="mt-1 divide-y divide-stone-100">
                    <FactRow label={L.yearBuilt} fact={memo.facts.year_built} L={L} />
                    <FactRow label={L.units} fact={memo.facts.units} L={L} />
                    {memo.facts.units.value == null && (memo.facts.units_min.value != null || memo.facts.units_max.value != null) && (
                      <FactRow label={L.unitRange} fact={{ ...memo.facts.units_min, value: L.toRange(String(memo.facts.units_min.value ?? "?"), String(memo.facts.units_max.value ?? "?")) }} L={L} />
                    )}
                    <FactRow label={L.co} fact={memo.facts.co_date} L={L} />
                  </div>
                  {memo.facts.units_min.note && memo.facts.units.value == null && <p className="mt-1 text-xs text-stone-500">{L.unitRangeFrom(memo.facts.units_min.note)}</p>}
                  <p className="mt-2 text-xs text-stone-500">{L.ownerNote}</p>
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-blue-700">{L.knowMore}</summary>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input placeholder={L.yearBuilt} value={facts.year_built} onChange={(e) => setFacts({ ...facts, year_built: e.target.value })} inputMode="numeric" className="rounded-md border border-stone-300 px-2 py-1" />
                      <input placeholder={L.units} value={facts.units} onChange={(e) => setFacts({ ...facts, units: e.target.value })} inputMode="numeric" className="rounded-md border border-stone-300 px-2 py-1" />
                      <label className="col-span-2 text-xs text-stone-600">
                        {L.coDate}
                        <input type="date" value={facts.co_date} onChange={(e) => setFacts({ ...facts, co_date: e.target.value })} className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1" />
                      </label>
                    </div>
                    <button onClick={() => setApplied(facts)} className="mt-2 rounded-md bg-stone-200 px-3 py-1 text-xs font-semibold hover:bg-stone-300">
                      {L.update}
                    </button>
                  </details>
                </div>

                <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-bold">{L.changing}</h3>
                  {memo.changing.length ? (
                    <ul className="mt-2 space-y-2">
                      {memo.changing.map((c) => (
                        <li key={c.team_rule_id} className="text-sm">
                          <Chip result={c.result} L={L} /> <span className="font-medium">{c.title}</span>
                          <span className="block text-xs text-stone-500">
                            {c.citation}
                            {c.effective_date ? L.takesEffectComma(fmtDate(c.effective_date, lang)) : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-stone-500">{L.noChange}</p>
                  )}
                </div>

                {memo.flags.length > 0 && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                    <h3 className="text-sm font-bold text-rose-900">{L.flagsTitle}</h3>
                    <ul className="mt-2 space-y-2 text-sm text-rose-900">
                      {memo.flags.map((f) => (
                        <li key={f.team_rule_id}>
                          <span className="font-mono text-xs">{f.citation}</span>: {f.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </aside>
            </div>
          </div>
        )}
      </section>

      <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs leading-relaxed text-stone-500">
        <p>{L.footer1}</p>
        <p className="mt-2">{L.footer2}</p>
      </footer>
    </main>
  );
}

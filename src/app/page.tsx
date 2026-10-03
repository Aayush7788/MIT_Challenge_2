"use client";

import { useEffect, useMemo, useState } from "react";
import type { CheckLine, CheckResult, ProposalKind } from "@/lib/law/check";
import type { Fact } from "@/lib/law/facts";
import type { Memo, MemoItem } from "@/lib/law/memo";
import type { Result } from "@/lib/law/schema";

type Hit = { address_id: string; street_address: string; postal_city: string; legal_city: string | null; state: string; zip: string };
type Target = { kind: "id"; id: string; label: string } | { kind: "address"; address: string; label: string };

const DEFAULT_AS_OF = "2026-10-01";
const DATE_CHIPS = [
  { d: "2025-12-31", note: "before CA AB 325" },
  { d: "2026-01-02", note: "after CA AB 325" },
  { d: "2026-10-01", note: "default query date" },
  { d: "2027-07-02", note: "after NJ FAIR Act" },
];
const EXAMPLES = [
  { id: "A0016", why: "San Francisco, built 1926" },
  { id: "A0035", why: "Los Angeles, built 1997" },
  { id: "A0002", why: "Hoboken, NJ" },
  { id: "A0036", why: "South Boston mailing address" },
];

const RESULT_STYLE: Record<Result, { label: string; cls: string }> = {
  applies: { label: "Applies", cls: "bg-emerald-100 text-emerald-900 ring-emerald-300" },
  superseded: { label: "Superseded here", cls: "bg-slate-100 text-slate-700 ring-slate-300" },
  unknown: { label: "Unknown", cls: "bg-amber-100 text-amber-900 ring-amber-300" },
  not_yet_effective: { label: "Not yet in effect", cls: "bg-sky-100 text-sky-900 ring-sky-300" },
  pending: { label: "Pending bill", cls: "bg-violet-100 text-violet-900 ring-violet-300" },
};

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "";
  const parts = d.split("-").map(Number);
  if (parts.length === 1) return d;
  const date = new Date(Date.UTC(parts[0], (parts[1] ?? 1) - 1, parts[2] ?? 1));
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: parts[2] ? "numeric" : undefined, year: "numeric" }).format(date);
};

function Chip({ result }: { result: Result }) {
  const s = RESULT_STYLE[result];
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${s.cls}`}>{s.label}</span>;
}

function FactRow({ label, fact, unit }: { label: string; fact: Fact<number | string>; unit?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="text-stone-600">{label}</span>
      <span className="text-right">
        <span className="font-medium">{fact.value != null ? `${fact.value}${unit ?? ""}` : "not in data"}</span>
        <span className="ml-2 text-xs text-stone-500" title={fact.note}>
          {fact.source}
        </span>
      </span>
    </div>
  );
}

function RuleCard({ it }: { it: MemoItem }) {
  const [open, setOpen] = useState(false);
  const detail = it.explanation.match(/\(([^()]*)\.\)/)?.[1];
  return (
    <li className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-start gap-2">
        <Chip result={it.result} />
        <span className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{it.level === "state" ? `State: ${it.jurisdiction}` : `City: ${it.jurisdiction}`}</span>
        {it.conflict_flag && <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">Flag for review</span>}
      </div>
      <h4 className="mt-2 font-semibold leading-snug text-stone-900">{it.title}</h4>
      <p className="mt-1 text-sm leading-relaxed text-stone-700">{it.requirement}</p>
      {it.key_value && (
        <p className="mt-2 text-sm">
          <span className="text-stone-500">Key figure: </span>
          <span className="font-medium">{it.key_value}</span>
        </p>
      )}
      {it.result === "superseded" && <p className="mt-2 text-sm text-slate-600">{it.explanation.split(". ").slice(0, 1).join("")}.</p>}
      {it.result === "not_yet_effective" && it.effective_date && <p className="mt-2 text-sm text-sky-800">Takes effect {fmtDate(it.effective_date)}.</p>}
      {detail && <p className="mt-2 text-xs leading-relaxed text-stone-500">Why: {detail}.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-mono text-stone-800">{it.citation}</span>
        <button onClick={() => setOpen(!open)} className="text-blue-700 underline-offset-2 hover:underline">
          {open ? "Hide source text" : "Show source text"}
        </button>
      </div>
      {open && (
        <div className="mt-2 rounded-md bg-stone-50 p-3 text-xs leading-relaxed text-stone-700">
          <blockquote className="border-l-2 border-stone-300 pl-3 italic">&ldquo;{it.quoted_span}&rdquo;</blockquote>
          <p className="mt-2 text-stone-500">
            {it.span_verified ? "Quote checked word for word against the source. " : "Quote not verified. "}
            Source {it.source_doc_id}, retrieved {fmtDate(it.retrieved_at?.slice(0, 10))}.{" "}
            <a href={it.source_url} target="_blank" rel="noreferrer" className="text-blue-700 underline">
              Open source
            </a>
          </p>
          {it.exemptions && <p className="mt-1 text-stone-500">Exemptions: {it.exemptions}</p>}
          {it.conflict_note && <p className="mt-1 text-rose-700">Reviewer note: {it.conflict_note}</p>}
          <p className="mt-1 text-stone-400">
            Rule {it.team_rule_id} · status {it.status.replaceAll("_", " ")} · model confidence {Math.round(it.confidence * 100)}%
          </p>
        </div>
      )}
    </li>
  );
}

function CheckLines({ title, lines, tone }: { title: string; lines: CheckLine[]; tone: string }) {
  if (!lines.length) return null;
  return (
    <div className="mt-3">
      <p className={`text-xs font-semibold uppercase tracking-wide ${tone}`}>{title}</p>
      <ul className="mt-1 space-y-1.5">
        {lines.map((l) => (
          <li key={l.team_rule_id + title} className="text-sm leading-snug text-stone-700">
            <span className="font-mono text-xs text-stone-900">{l.citation}</span>: {l.text}
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

export default function Home() {
  const [mode, setMode] = useState<"sample" | "any">("sample");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [target, setTarget] = useState<Target | null>(null);
  const [asOf, setAsOf] = useState(DEFAULT_AS_OF);
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

  // One request per distinct input; the memo and the check come back together.
  const requestKey = target
    ? JSON.stringify({
        ...(target.kind === "id" ? { id: target.id } : { address: target.address }),
        as_of: asOf,
        facts: {
          year_built: applied.year_built.trim() ? Number(applied.year_built) : null,
          units: applied.units.trim() ? Number(applied.units) : null,
          co_date: applied.co_date || null,
        },
        proposal: askCheck && amount.trim() && Number.isFinite(Number(amount)) ? { kind, amount: Number(amount) } : null,
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

  const pick = (h: Hit) => {
    setTarget({ kind: "id", id: h.address_id, label: `${h.street_address}, ${h.postal_city}, ${h.state} ${h.zip}` });
    setQ("");
    setHits([]);
    setFacts({ year_built: "", units: "", co_date: "" });
    setApplied({ year_built: "", units: "", co_date: "" });
    setAskCheck(false);
  };

  const total = useMemo(() => (memo ? Object.values(memo.counts).reduce((a, b) => a + b, 0) : 0), [memo]);

  return (
    <main className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Rental Housing Law Navigator</h1>
            <p className="text-sm text-stone-600">Which housing rules apply to this apartment on this date, with the source text for each one.</p>
          </div>
          <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-800 ring-1 ring-rose-200">Not legal advice</span>
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
                {m === "sample" ? "500 sample buildings" : "Any US address"}
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
                  setFacts({ year_built: "", units: "", co_date: "" });
                  setApplied({ year_built: "", units: "", co_date: "" });
                }
              }}
              placeholder={mode === "sample" ? "Search by street, city or ZIP (e.g. Clinton Hoboken)" : "Full address, then Enter (e.g. 1 Dr Carlton B Goodlett Pl, San Francisco, CA 94102)"}
              className="w-full rounded-lg border border-stone-300 px-3 py-2.5 text-base outline-none focus:border-stone-900"
            />
            {shownHits.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-stone-200 bg-white shadow-lg">
                {shownHits.map((h) => (
                  <li key={h.address_id}>
                    <button onClick={() => pick(h)} className="w-full px-3 py-2 text-left text-sm hover:bg-stone-100">
                      <span className="font-medium">{h.street_address}</span>, {h.postal_city}, {h.state} {h.zip}
                      {h.legal_city && h.legal_city.toLowerCase() !== h.postal_city.toLowerCase() && <span className="ml-2 text-xs text-stone-500">legal city: {h.legal_city}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!target && (
            <p className="mt-3 text-sm text-stone-600">
              Try:{" "}
              {EXAMPLES.map((ex, i) => (
                <span key={ex.id}>
                  <button className="text-blue-700 underline-offset-2 hover:underline" onClick={() => setTarget({ kind: "id", id: ex.id, label: ex.id })}>
                    {ex.why}
                  </button>
                  {i < EXAMPLES.length - 1 ? " · " : ""}
                </span>
              ))}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <label className="font-medium text-stone-700" htmlFor="asof">
              As of
            </label>
            <input id="asof" type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
            {DATE_CHIPS.map((c) => (
              <button
                key={c.d}
                title={c.note}
                onClick={() => setAsOf(c.d)}
                className={`rounded-full px-2.5 py-1 text-xs ${asOf === c.d ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200"}`}
              >
                {fmtDate(c.d)}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

        {memo && (
          <div className={`mt-5 transition-opacity ${busy ? "opacity-60" : ""}`}>
            <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Address memo · as of {fmtDate(memo.as_of)}</p>
              <h2 className="mt-1 text-lg font-bold">
                {memo.address.line}, {memo.address.mailing_city}, {memo.address.state} {memo.address.zip}
              </h2>
              <p className="mt-1 text-sm text-stone-700">
                Legal jurisdiction: {memo.jurisdiction.state === "CA" ? "California" : memo.jurisdiction.state === "NJ" ? "New Jersey" : memo.jurisdiction.state === "MA" ? "Massachusetts" : memo.jurisdiction.state}
                {memo.jurisdiction.county ? ` › ${memo.jurisdiction.county}` : ""} › {memo.jurisdiction.city ?? "unincorporated area"}
              </p>
              {memo.jurisdiction.mailing_differs && (
                <p className="mt-1 text-sm text-amber-800">
                  The mailing city is {memo.address.mailing_city}, but the legal city is {memo.jurisdiction.city}. City rules follow the legal city.
                </p>
              )}
              <p className="mt-1 text-xs text-stone-500">
                {memo.jurisdiction.method === "census" || memo.jurisdiction.method === "census_without_zip"
                  ? `Located with the US Census geocoder (${memo.jurisdiction.matched_address}).`
                  : memo.jurisdiction.method === "postal_city_fallback"
                    ? "The Census geocoder found no match, so the mailing city is used; a reviewer should confirm it."
                    : memo.jurisdiction.note ?? ""}
                {memo.sources_retrieved ? ` Laws as published on ${fmtDate(memo.sources_retrieved)}; later changes are not reflected.` : ""}
              </p>
              {!supported && <p className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-900">Our sources cover California, New Jersey and Massachusetts only. Nothing below is complete for this state.</p>}
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {(Object.keys(RESULT_STYLE) as Result[]).map((r) =>
                  memo.counts[r] ? (
                    <span key={r} className={`rounded-full px-2.5 py-0.5 ring-1 ${RESULT_STYLE[r].cls}`}>
                      {memo.counts[r]} {RESULT_STYLE[r].label.toLowerCase()}
                    </span>
                  ) : null,
                )}
                <span className="text-stone-500">{total} rules reach this address</span>
              </div>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
              <div className="space-y-6">
                {memo.categories.map((c) => (
                  <section key={c.category}>
                    <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-600">{c.label}</h3>
                    {c.items.length ? (
                      <ul className="space-y-3">
                        {c.items.map((it) => (
                          <RuleCard key={it.team_rule_id} it={it} />
                        ))}
                      </ul>
                    ) : (
                      <p className="rounded-lg border border-dashed border-stone-300 p-3 text-sm text-stone-500">No rule in our sources reaches this address in this category on this date.</p>
                    )}
                  </section>
                ))}
              </div>

              <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start">
                <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-bold">Can the landlord do this?</h3>
                  <div className="mt-2 flex gap-2">
                    <select value={kind} onChange={(e) => setKind(e.target.value as ProposalKind)} className="min-w-0 flex-1 rounded-md border border-stone-300 px-2 py-1.5 text-sm">
                      <option value="rent_increase_pct">Raise rent by (%)</option>
                      <option value="deposit_months">Ask a deposit of (months)</option>
                      <option value="application_fee_usd">Charge an application fee ($)</option>
                    </select>
                    <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="w-20 rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
                  </div>
                  <button onClick={() => setAskCheck(true)} className="mt-2 w-full rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700">
                    Check on {fmtDate(asOf)}
                  </button>
                  {check && (
                    <div className={`mt-3 rounded-lg border p-3 ${VERDICT_STYLE[check.verdict]}`}>
                      <p className="text-sm font-semibold leading-snug">{check.headline}</p>
                      <CheckLines title="Blocks it" lines={check.blocking} tone="text-rose-800" />
                      <CheckLines title="Can't settle from public data" lines={check.unsettled} tone="text-amber-800" />
                      <CheckLines title="Within these limits" lines={check.within} tone="text-emerald-800" />
                      <CheckLines title="Context" lines={check.context} tone="text-stone-600" />
                      <CheckLines title="Could change" lines={check.could_change} tone="text-violet-800" />
                    </div>
                  )}
                  <p className="mt-2 text-xs text-stone-500">Answers come from the rules listed here only. This tool does not suggest ways around a rule.</p>
                </div>

                <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-bold">Building facts</h3>
                  <div className="mt-1 divide-y divide-stone-100">
                    <FactRow label="Year built" fact={memo.facts.year_built} />
                    <FactRow label="Units" fact={memo.facts.units} />
                    {memo.facts.units.value == null && (memo.facts.units_min.value != null || memo.facts.units_max.value != null) && (
                      <FactRow
                        label="Unit range"
                        fact={{ ...memo.facts.units_min, value: `${memo.facts.units_min.value ?? "?"} to ${memo.facts.units_max.value ?? "?"}` }}
                      />
                    )}
                    <FactRow label="Certificate of occupancy" fact={memo.facts.co_date} />
                  </div>
                  {memo.facts.units_min.note && memo.facts.units.value == null && <p className="mt-1 text-xs text-stone-500">Unit range read from the {memo.facts.units_min.note}.</p>}
                  <p className="mt-2 text-xs text-stone-500">Owner type and owner occupancy are not in public records, so rules that turn on them stay unknown.</p>
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-blue-700">Know more? Enter it</summary>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input placeholder="Year built" value={facts.year_built} onChange={(e) => setFacts({ ...facts, year_built: e.target.value })} inputMode="numeric" className="rounded-md border border-stone-300 px-2 py-1" />
                      <input placeholder="Units" value={facts.units} onChange={(e) => setFacts({ ...facts, units: e.target.value })} inputMode="numeric" className="rounded-md border border-stone-300 px-2 py-1" />
                      <label className="col-span-2 text-xs text-stone-600">
                        Certificate of occupancy date
                        <input type="date" value={facts.co_date} onChange={(e) => setFacts({ ...facts, co_date: e.target.value })} className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1" />
                      </label>
                    </div>
                    <button onClick={() => setApplied(facts)} className="mt-2 rounded-md bg-stone-200 px-3 py-1 text-xs font-semibold hover:bg-stone-300">
                      Update memo
                    </button>
                  </details>
                </div>

                <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-bold">What is changing</h3>
                  {memo.changing.length ? (
                    <ul className="mt-2 space-y-2">
                      {memo.changing.map((c) => (
                        <li key={c.team_rule_id} className="text-sm">
                          <Chip result={c.result} /> <span className="font-medium">{c.title}</span>
                          <span className="block text-xs text-stone-500">
                            {c.citation}
                            {c.effective_date ? `, takes effect ${fmtDate(c.effective_date)}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-stone-500">No pending bill or upcoming law in our sources reaches this address.</p>
                  )}
                </div>

                {memo.flags.length > 0 && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                    <h3 className="text-sm font-bold text-rose-900">Flags for human review</h3>
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
        <p>
          Not legal advice and not a compliance certification. This prototype summarizes public state and city law from a fixed set of sources (retrieved October 1, 2026). It can be wrong or out of date. Check with a lawyer, a tenant
          or landlord organization, or your local rent board before acting.
        </p>
        <p className="mt-2">
          How it works: a language model read each source document and wrote rule records, and every quote was checked word for word against the source. Addresses are placed in their legal city with the US Census geocoder. A
          fixed rules engine (no model at question time) tests each rule against the building facts and the date, and says unknown when the public data cannot settle it.
        </p>
      </footer>
    </main>
  );
}

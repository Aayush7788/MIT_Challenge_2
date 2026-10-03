# Rental Housing Law Navigator

For any apartment address in California, New Jersey or Massachusetts, this system answers one question: which housing rules apply here on a given date, and what is about to change? Every answer cites the law and quotes the source text it rests on.

Built at Hack-Nation 7 (MIT Global AI Hackathon, October 3-4, 2026) for the RealPage challenge "Rental Housing Law Navigator".

**Live demo:** https://hacknation-7.vercel.app
**Not legal advice.** This is a prototype that summarizes public law from a fixed set of sources. It can be wrong or out of date.

## What it does

- **Address memo.** Pick one of the 500 sample buildings, or type any US address. The memo shows the legal jurisdiction (state, county and city; the mailing city is not always the legal city), the building facts and where each one came from, and every rule in six categories: rent increases, just-cause eviction, security deposits, application and screening fees, screening restrictions, and algorithmic rent-setting. Each rule is marked applies, unknown, superseded, not yet effective or pending, with its citation and the quoted source text.
- **"Can the landlord do this?"** Enter a rent increase, a deposit or an application fee. The answer is no (with the rule that blocks it), within the limit, can't tell (with the missing fact that would settle it), or no cap found.
- **Any date.** Every answer is computed for an as-of date, so a law that is enacted but not yet in effect shows up as "not yet effective" today and "applies" after its effective date.
- **Law changes** (`/changes`) lists, for each change case, the addresses it affects, grouped by legal city. **Rule cards** (`/rules`) shows every extracted rule with its source document and quote.

## Results (self-check)

The organizers' scoring script and dev answer key were not in the starter pack, so `scripts/selfscore.py` approximates the four scripted components against what the challenge brief states (27 rules named in the brief, the expected sets for change tests T1 to T5, and coverage rules the brief spells out, such as the San Francisco and Los Angeles construction cutoffs).

| Component | Self-check |
| --- | --- |
| Extraction accuracy | 23.6 / 25 |
| Address coverage | 20.0 / 20 |
| Citations | 15.0 / 15 |
| Change tracking (T1 to T5) | 15.0 / 15 |
| **Scripted total** | **73.6 / 75** |

The 1.4 missing extraction points are a Santa Ana ordinance number and two effective dates that the public sources we found do not state (Jersey City states only its adoption date, and Berkeley's two published dates disagree).

## How it works

```
corpus text ──► 1. Extract ──► rule cards ──► 3. Apply ──► lookups.json ──► memo, check, /changes
                (Claude,        (verbatim     (rules engine,  changes.json
                 per document)   quotes)       no model)
addresses ───► 2. Resolve (Census geocoder: legal city, county)
```

1. **Extract** (`scripts/extract.ts`). Claude reads each source document and returns rule records in the provided schema, with structured coverage: unit thresholds, construction or certificate-of-occupancy cutoffs, rolling new-construction exemptions, owner-based exemptions, effective date and status. Every quote is checked word for word against the source text; a quote that is not found is repaired to the closest passage or marked unverified. Records of the same law from several documents are merged, a proposal gives way to its enacted version, and records of one code section share the effective date their sources state (`src/lib/law/rules.ts`).
2. **Resolve** (`scripts/geocode-addresses.ts`). The US Census geocoder places each address in its incorporated city, so "Dorchester" resolves to Boston. Unit counts missing from the parcel data are bounded from the assessor's land-use code ("APT 7-30 UNITS", "3S-F-D-6U", New Jersey property class 4C), and each fact records where it came from (`src/lib/law/facts.ts`).
3. **Apply** (`src/lib/law/engine.ts`). A fixed engine tests every rule against the building facts and the date. It answers unknown when the public data cannot settle coverage (missing year built, a building in a cutoff year, owner type), marks a state rule superseded where a stricter local rule governs, and flags possible preemption for human review where a state law and a city ordinance both reach the address. No language model runs at question time, so every answer is reproducible and tied to a rule card.
4. **Track change** (`scripts/changes.ts`). For each change case the engine runs at both dates and lists the addresses whose answer changes; pending bills are evaluated as if enacted to show who they would reach.

## Sources

- The starter pack: 54 official documents with text (of 87 listed). The other 33 are link-only.
- `corpus_extra/`: 11 documents the team captured for link-only sources, one page each, read the way a person would (no crawling): Hoboken § 158-2 and Chapter 155, Jersey City § 218-12, Newark § 19:2-3, San Diego Divisions 8 and 11, Santa Ana's adoption notice, Cal. Bus. & Prof. Code § 16729 (which states AB 325's effective date), and a report of the Massachusetts ruling that struck the rent-control ballot question. Each file starts with its source URL and retrieval time; `corpus_extra/manifest.csv` records a hash. A third-party copy of Hoboken's code and the news report are labeled as secondary sources, and the extraction step ranks official text above them. Pages that block automated access were read in a browser or skipped.

## Run it

```bash
npm install
npm run pipeline        # rules -> submission/lookups.json and changes.json, then the self-check
npm run dev             # http://localhost:3000
```

Extraction calls the Anthropic API: put `ANTHROPIC_API_KEY` in `.env.local` and run `npm run extract` (per-document results are cached in `out/audit/extract/`, so a rerun only calls the model for new or changed documents).

To add a new law (for example the hour-16 ordinance) end to end:

```bash
npm run ingest -- path/to/ordinance.txt --jurisdiction "Cambridge, MA"
```

This saves the text to `corpus_extra/`, extracts its rule cards, recomputes all 500 addresses, adds a change test comparing today with the law's effective date, and prints the affected addresses and the new self-check.

## Outputs

- `submission/rules.json`: rule records in the provided schema, each with citation, source URL, retrieval date and quoted span.
- `submission/lookups.json`: for all 500 addresses, each rule's result (applies, unknown, superseded, not_yet_effective or pending) with an explanation, as of 2026-10-01.
- `submission/changes.json`: affected addresses and conflict flags for each change test.
- `out/audit/`: per-document model outputs, the extraction log and the latest self-check.
- `review/`: sheets for legal review of addresses, rule status and link-only sources.

## Responsible design

- Every rule cites its source and quotes it; quotes are checked against the source text.
- Every answer carries an as-of date; pending bills are kept apart from enacted law; struck measures are never reported as in force.
- Unknown is an answer: when coverage depends on a fact the data does not have, the memo says which fact.
- Conflicts and disagreements between sources are flagged for human review.
- The tool states the rules and does not suggest ways around them.
- No customer, resident or pricing data is used.

## Limitations

- We tested three states and nine cities with addresses (Santa Ana has rules but no sample addresses).
- Owner type and owner occupancy are not in public records, so owner-based exemptions stay unknown.
- Year built stands in for the certificate-of-occupancy date unless a user enters it.
- Unit counts read from land-use codes are bounds, and New Jersey class 4C is read as five or more units.
- The self-check is our approximation of the organizers' scoring, not their script.
- Laws are as published on October 1, 2026 (October 3 for the team-captured pages); later changes are not reflected.

## Team

Aayush (@Aayush7788), rule extraction · Krishna Harish (@krishnatheaverage), rules engine and app · Gulnur Bekmukhanbetova, addresses and legal review.

The organizers' participant guide is in `docs/PARTICIPANT_GUIDE.md`.

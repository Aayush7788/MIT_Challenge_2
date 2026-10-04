# Rental Housing Law Navigator

We built this for the RealPage challenge at Hack-Nation 7, the MIT Global AI Hackathon (October 3 to 4, 2026). You give it an apartment address in California, New Jersey or Massachusetts and a date, and it tells you which housing rules apply there on that date, which ones are about to change, and where each rule comes from (the citation plus the exact sentence from the source).

**Live demo:** https://hacknation-7.vercel.app

**Not legal advice.** We summarize public law from a fixed set of sources, so we may have gotten something wrong or missed a later change.

## What you can do with it

You can pick one of the 500 sample buildings (or type in any US address), and we write a memo for that address. The memo opens with the legal jurisdiction, because the mailing city is often not the legal city (a Dorchester address is in Boston, for example). It then lists the building facts we have and where each one came from, followed by every rule we found in six categories, which are rent increases, just-cause eviction, security deposits, application and screening fees, screening restrictions and algorithmic rent-setting. We mark each rule as applying, unknown, superseded by a stricter local rule, not yet in effect, or pending, and you can open the quoted source text under each one.

You can also ask whether a landlord can do something specific, such as raise the rent by 20% or ask for a two-month deposit. We answer no (and name the rule that blocks it), within the limit, can't tell (and say which missing fact would settle it), or no cap found. The answer depends on the date you pick, so a law that has passed but has not yet started shows up as "not yet in effect" today and as applying after its start date.

We added two pages for review. The Law changes page (`/changes`) shows which addresses each change case affects and how their answers move between the two dates, and the Rule cards page (`/rules`) lists every rule we extracted along with its source document and quote. The whole interface also works in Spanish.

## How well it does

The organizers do not share their scoring script or answer key with participants, so we wrote our own check (`scripts/selfscore.py`). It compares our output with what the challenge brief states directly, which covers the 27 rules the brief names, the expected results of change tests T1 to T5, and coverage rules such as the San Francisco and Los Angeles construction cutoffs. However, the official score uses a held-out key of 58 rules and 100 addresses, so our real number will likely differ.

| Component | Our check |
| --- | --- |
| Extraction accuracy | 25.0 / 25 |
| Address coverage | 20.0 / 20 |
| Citations | 14.3 / 15 |
| Change tracking (T1 to T5) | 15.0 / 15 |
| Scripted total | 74.3 / 75 |

The 0.7 citation points go to answers that rest on official texts we added (the Hoboken, Jersey City and Newark ordinances, San Diego's source-of-income rule and LA's deposit-interest rule), since the citation score only accepts quotes from the supplied corpus. Our check also surfaces two of the brief's open questions. Berkeley's ban carries a review flag because the date we use, March 1, 2026, comes from Ordinance 7,974-N.S., while Ordinance 7,992-N.S. later rewrote the chapter without that clause (a law-firm alert says January 2026). California's 2026 screening-fee figure is not in the statute, which sets $30 adjusted for inflation since 1998, so a fee above $30 comes back "can't tell".

## Legal review

Gulnur Bekmukhanbetova, the lawyer on our team, reviewed all 92 rule cards from an earlier run. For each card she gave a status, an effective date, the source she checked and a note, and she then did a cite-check of every citation. We did not hand-edit the cards to match her answers. Instead we changed the pipeline (the extraction prompt, the merge rules, the engine and the cite-check) and reran it, and `scripts/lawyer-check.ts` scores the output against her sheet (`data/silver/lawyer_review.csv`), matching her rows to today's cards by content because card ids change between runs.

| Her review | Agreement |
| --- | --- |
| Status (in force, pending, failed and so on) | 89 of 89 matched cards |
| Effective date, where she gave one | 37 of 48 |
| Duplicates she asked us to merge | 9 of 9 |
| Coverage notes she asked us to fold into their rule | 4 of 4 |
| Rules behind change tests T1 to T5 | 7 of 7 |
| Enacted rules that cite a code section or chapter | 59 of 65 |
| Enacted rules that also quote the law's own text | 50 of 65 |

Most of the dates we leave blank are dates our sources do not state, such as the 2020 start of Civ. Code § 1946.2 (the code page gives only its latest amendment), and we leave a field blank when the text does not support it. The official texts also corrected two of our citations: the 30-year new-construction exemption is in N.J.S.A. 2A:42-84.2, and Santa Ana's rent stabilization and just-cause rules are in one article of its code (ch. 8, art. XIX, Ord. No. NS-3073).

## How it works

```
corpus text ──► 1. Extract ──► rule cards ──► 3. Apply ──► lookups.json ──► memo, check, /changes
                (Claude,        (verbatim     (rules engine,  changes.json
                 per document)   quotes)       no model)
addresses ───► 2. Resolve (Census geocoder: legal city, county)
```

We followed the same steps the brief lays out.

1. **Extract** (`scripts/extract.ts`). Claude reads each source document and writes rule records in the schema the organizers gave us. Each record includes structured coverage (unit thresholds, construction or certificate-of-occupancy cutoffs, rolling new-construction exemptions and owner-based exemptions) along with the effective date and the status. We then check every quote word for word against the source text. Next, a second model (`scripts/verify.ts`) re-reads each source next to the cards taken from it and must quote the text behind every field (the rule, key figure, date, status, coverage and citation). We check those quotes as well, remove a field only when neither the second model nor a plain text search can find support for it, and reject a card whose main rule is not in its source. Since several documents often describe the same law, we merge their records into one card per law (subsections of one code section included), drop a proposal once we have its enacted version, and let records for one code section share the effective date their sources state (`src/lib/law/rules.ts`). Documents also name one law in different ways ("Assembly Bill 12" and "Civ. Code § 1950.5(c)"), so a model groups the cards of each jurisdiction and category into laws, and code decides which card to keep (`scripts/group.ts`).
   Last comes a cite-check (`scripts/citecheck.ts`), which follows our lawyer's two rules. A citation is a code section, with the ordinance or chapter in parentheses, and never a law's nickname. A quote has to come from the source the citation names. Many supplied documents are agency pages or guides that restate a statute (for example, New Jersey's "Truth in Renting" guide), so for those laws we saved the statute or code text itself in `corpus_crosscheck/`. A model writes each citation in that style and copies a passage from the law's own text. Code then checks that every number in the citation appears in a document we hold and that the passage is word for word in the official text, and anything that fails keeps its old citation. Each card keeps its quote from the supplied corpus too, since the citation score counts only that corpus, and the memo shows the law's own words first.
2. **Resolve** (`scripts/geocode-addresses.ts`). We send each address to the US Census geocoder, which returns the incorporated city and the county. When the parcel data has no unit count, we read a range from the assessor's land-use code where we can (e.g., "APT 7-30 UNITS" or "3S-F-D-6U"), and we record where every fact came from (`src/lib/law/facts.ts`). Every New Jersey row is property class 4C, which state law defines as property for five or more families (our team's lawyer confirmed this reading), so those buildings count as having at least five units.
3. **Apply** (`src/lib/law/engine.ts`). A plain rules engine tests each rule against the building facts and the date. It returns unknown when the public data cannot settle coverage (e.g., a missing year built, or a building finished in a cutoff year), marks a state rule as superseded where a stricter local rule governs, and flags a possible preemption for a person to review. We never call a language model at question time. Thus, the same question always gets the same answer, and every answer points back to a rule card.
4. **Track changes** (`scripts/changes.ts`). For each change case we run the engine at both dates and list the addresses whose answer changes. For a pending bill we treat the bill as passed to see which addresses it would reach.

## Sources

The starter pack lists 87 documents, but only 54 of them come with text. For the link-only sources that mattered most, we saved one page per law into `corpus_extra/`, reading each page the way a person would and never crawling. They cover Hoboken's § 158-2 and § 155-5 (from the city's official code), Jersey City's § 218-12, Newark's § 19:2-3, San Diego's Divisions 8 and 11, Santa Ana's adoption notice, the LA Housing Department's bulletin on deposit interest, the California code page that gives AB 325's effective date, Berkeley's Ordinance 7,974-N.S., the county's official record of Hoboken's November 2024 rent-control vote (defeated, 16,371 to 6,082), a law-firm alert, and a news report on the court ruling that took the Massachusetts rent-control question off the ballot. Each file records its source URL and retrieval time, and `corpus_extra/manifest.csv` keeps a hash of it. Extraction ranks official text above the law-firm alert and the news report, and we skipped pages that block automated access. Our team's lawyer reviewed the sources; at her request we cite Hoboken's official code and keep a landlord group's copy of it only as a cross-check.

For the cite-check we also saved the official text of the statutes and ordinances that the supplied corpus covers only through summaries (`corpus_crosscheck/`, with `manifest.csv`). These come from the state legislatures' sites, city clerk ordinance PDFs, the rent boards' published ordinance texts, and the cities' official code publishers. Several code publishers refuse scripts (American Legal for Los Angeles, ecode360 for Hoboken, Berkeley's code site, and Municode, which needs JavaScript), so we read those pages in a browser and kept a copy only when the SHA-256 of the copied text matched the page. Agendas, staff reports, a newsletter and a law-firm summary of the Massachusetts court decision are in that folder only to confirm ordinance numbers, dates and the case citation, and the cite-check never quotes them as law. Two texts we could not get: the court's slip opinion in Cella v. Attorney General (mass.gov serves it only as a download) and Boston's current City Code.

The organizers told us that texts we add can inform the answers but do not count toward the citation score, which only accepts quotes from the supplied corpus. Thus, when a law appears both in the supplied corpus and in a text we added, we keep the card that quotes the supplied corpus and take only the missing date or status from our text (for example, AB 325's effective date and San Diego's adoption). Laws that appear only in our texts (e.g., the Hoboken and Jersey City bans) keep their own quotes, and the memo marks those sources as added by the team.

## Running it

```bash
npm install
npm run pipeline        # rules -> submission/lookups.json and changes.json, then our check
npm run dev             # http://localhost:3000
```

Extraction needs an Anthropic API key in `.env.local`. When you run `npm run extract`, results are cached per document in `out/audit/extract/`, so a rerun only calls the model for new or changed documents.

We use one command to add a new law, or a new city, from start to finish.

```bash
npm run ingest -- path/to/ordinance.txt --jurisdiction "Cambridge, MA"
```

It saves the text to `corpus_extra/`, extracts the rule cards, runs the second check on them, reruns all 500 addresses, adds a change test that compares today with the law's effective date, and prints the affected addresses along with the new check. We rehearsed this on Oakland, a city outside the challenge data, using two official pages kept in `demo/new-city/oakland/`. `docs/DEMO_NEW_CITY.md` walks through it, and `scripts/demo-new-city.sh` makes a throwaway copy of the repo so the run leaves the submitted files alone.

## Output files

- `submission/rules.json` has our 71 rule records in the organizers' schema, each with a citation, source URL, retrieval date and quoted span.
- `submission/lookups.json` has every rule's result (applies, unknown, superseded, not_yet_effective or pending) for all 500 addresses as of 2026-10-01, with an explanation.
- `submission/changes.json` has the affected addresses and conflict flags for each change test.
- `out/audit/` keeps the model output for each document, the extraction log and our latest check, and `review/` has the sheets we use for legal review.

## Responsible use

Every rule cites its source and quotes it, and we check each quote against the source text. Every answer carries an as-of date, pending bills stay separate from enacted law, and a struck measure never shows up as in force. When coverage depends on a fact we do not have, the memo says unknown and names the fact. We flag disagreements between sources (and possible preemption) for a person to review, and each answer carries a confidence level with the reasons behind it. The tool states the rules and does not suggest ways around them. Moreover, we use no customer, resident or pricing data.

## Limitations

We cover three states and nine cities with sample addresses (Santa Ana has rules but no addresses). Owner type and owner occupancy are not in public records, so owner-based exemptions stay unknown. We use the year built in place of the certificate-of-occupancy date unless a user enters one. Unit counts we read from land-use codes are ranges (e.g., 7 to 30 units), so a rule whose unit threshold falls inside the range stays unknown. Before a city's published annual figure starts (for example, San Francisco's March 1 figure), the memo says the rent law applies but that the earlier figure is not in our sources. In Los Angeles the Just Cause Ordinance card also shows at buildings under the Rent Stabilization Ordinance, whose own just-cause rules govern there, and our corpus has no card for Costa-Hawkins (Civ. Code § 1954.52), so a single-family home that a user enters may come back as covered by a local rent cap. Our score check is an estimate and may be off in either direction. The laws are as published on October 1, 2026 (October 3 for the pages we added), so anything that changed after that is missing.

## Team

Aayush (@Aayush7788) took rule extraction, Krishna Harish (@krishnatheaverage) took the rules engine and the app, and Gulnur Bekmukhanbetova took addresses and legal review.

The organizers' participant guide is in `docs/PARTICIPANT_GUIDE.md`.

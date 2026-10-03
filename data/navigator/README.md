# Rental Housing Law Navigator — team repo (built on the RealPage participant pack)

`python3 -m pytest tests/` → 7 pass on toy rules IN THE PACK'S SCHEMA, driven by the organisers' own pack/dev/change_tests.json.
Real spans from D022 (AB 325), D069 (FAIR Act §6(b)) and D048 (c. 40P §4) already validate against the corpus.

## Pipeline
1. `python3 src/geocode.py`            → data/geocode_cache.json (legal city for all 500 addresses; ~5 min; run ONCE)
2. `ANTHROPIC_API_KEY=... python3 src/extract.py [D022 D069 ...]` → out/rules.json, out/rejected.json, out/extraction_log.json
3. fill `data/test_rule_map.json` with our team_rule_ids for CA-ALG-01, HOB-ALG-01, JC-ALG-01, NJ-ALG-01, MA-ALG-P1, MA-ALG-P2, MA-RENT-P1
4. `python3 src/run.py 2026-10-01`     → out/lookups.json, out/changes.json, out/audit.json (exact submission shapes)
5. point tests at out/rules.json + the map; all five green = submit.

## THREE TEST SOURCES HAVE NO TEXT IN THE PACK — fix in hour 1
- HOB-ALG-01: Hoboken ordinance is link-only (D032–D034, ecode360). Open the page by hand, save the ordinance text as corpus_extra/D034.txt with a 2-line header `SOURCE: <url>` / `RETRIEVED: 2026-10-03`.
- JC-ALG-01: Jersey City ban is link-only (D035 news, D037 law firm); D036 (city page) does not mention it. Fetch the ordinance from the city's municipal code and save as corpus_extra/D035.txt.
- MA-RENT-P1: the struck ballot question is link-only (D059, WBUR). Fetch the WBUR page (or the SJC decision, Cella v. Attorney General, 2026-06-23) as corpus_extra/D059.txt.
Reading a page by hand is allowed (README §6: "read freely; no bulk scraping"). Extraction still runs automatically over the saved text.

## Decisions already encoded (say them in the method note)
- Effective dates: two permitted inferences, both flagged "inferred:" — CA default Jan 1 next year (Const. art. IV §8(c)); formula + enactment date (FAIR Act: 2026-07-20 → 2027-07-01).
- Precedence (src/engine.py PRECEDENCE): MA c.40P §4 preempts local rent control; CA stricter local supersedes state cap/just-cause; NJ FAIR Act §6(b) vs JC/Hoboken → conflict flag.
- Certificate of occupancy ≠ year built: cutoff year → unknown; after cutoff year → exempt; before → covered, explanation says inferred.
- Known data gaps → None → "unknown" (Boston A/ rows, SD/Berkeley year built, NJ unit counts, no owner names).
- Failed measures are never reported in lookups; T5 stays empty.
- Every lookup row: team_rule_id, result, explanation, conflict_flag (+ source_doc_id, quoted_span for the audit view).

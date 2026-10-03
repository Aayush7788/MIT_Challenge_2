# Part 3 — data, as-of date, change tests, submission files, audit  (owner: Gulnur)

Everything below runs from the repo root (where corpus/, data/, dev/ and src/ sit).

| Deliverable | Where | How |
|---|---|---|
| 500 addresses cleaned | `out/address_cleaning_report.json` | `python3 src/clean.py` (done once; report committed) |
| Legal city for every address | `data/geocode_cache.json` | `python3 src/geocode.py` (one run, ~5 min, Census Geocoder) |
| Five tests wired to real rule ids | `data/test_rule_map.json` | after extraction, open `out/rules.json`, type our `team_rule_id` next to each of the 7 test ids |
| As-of date | argument to `src/run.py` | `python3 src/run.py 2026-10-01` (default) or any date, e.g. `2027-07-02` |
| rules.json / lookups.json / changes.json | `out/` | written by `python3 src/run.py` in the pack's exact shapes (`submission_templates/`) |
| Audit log | `out/audit.json` + `out/extraction_log.json` + `out/rejected.json` | written by run.py / extract.py |
| Five tests on real data | `tests/test_real.py` | `python3 -m pytest tests/test_real.py -v` (skips until `out/rules.json` exists) |

## Findings from the address data (README 4.1 plus what we found)
- 500 rows; 212 without year built, 242 without unit count, 130 without zip.
- 26 New Jersey rows carry zip codes from NY/TX — owner mailing zips leaked from the MOD-IV assessor file. Fix: a zip that cannot belong to the row's state is dropped before geocoding (`src/geocode.py`).
- 38 rows use a neighbourhood as postal city (Dorchester, Roxbury, East Boston, Brighton, Allston, South Boston, Jamaica Plain, Hyde Park, Mattapan, San Ysidro). The legal city comes from the Census Geocoder, never from `postal_city`.
- 60 Boston rows with use_code `A/` have no unit count; treated as unknown.
- No owner names, so owner-type exemptions always return `unknown`.

## Blockers for T2 and T5 (not Part 3, but Part 3 cannot pass without them)
Hoboken ordinance (D032–D034), Jersey City ordinance (D035/D037) and the struck MA ballot question (D059) have NO text in the pack. Fetch each page by hand, save as `corpus_extra/<doc_id>.txt` with a two-line header (`SOURCE: <url>` / `RETRIEVED: 2026-10-03`), re-run extraction.

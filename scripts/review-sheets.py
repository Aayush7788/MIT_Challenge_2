"""Builds the review sheets for the lawyer on the team (open them in Google Sheets).

  python3 scripts/review-sheets.py   # reads submission/ if present, else out/

review/addresses_check.csv     every sample address with the legal city we resolved (fallbacks first)
review/rule_status_check.csv   every rule card with our status and effective date, plus verdict columns
review/link_only_sources.csv   sources listed in the manifest without supplied text
"""
import csv
import json
import os

PACK = "data/starter/pack"
SRC = "submission" if os.path.exists("submission/rules.json") else "out"
os.makedirs("review", exist_ok=True)

addresses = list(csv.DictReader(open(f"{PACK}/data/sample_addresses.csv", newline="")))
jur = json.load(open("out/jurisdictions.json"))


def norm(s):
    return (s or "").strip().lower()


rows = []
for a in addresses:
    j = jur.get(a["address_id"], {})
    differs = norm(a["postal_city"]) != norm(j.get("city"))
    fallback = j.get("method") in ("postal_city_fallback", "unresolved")
    rows.append({
        "check_first": "YES" if (fallback or differs) else "",
        "address_id": a["address_id"],
        "street_address": a["street_address"],
        "mailing_city": a["postal_city"],
        "state": a["state"],
        "zip": a["zip"],
        "legal_city_we_found": j.get("city") or "",
        "county": j.get("county") or "",
        "how_we_found_it": {
            "census": "Census geocoder matched the street address",
            "census_without_zip": "Census geocoder matched without the ZIP",
            "postal_city_fallback": "NO MATCH: we used the mailing city",
            "unresolved": "NO MATCH",
        }.get(j.get("method"), j.get("method", "")),
        "census_matched_address": j.get("matched_address") or "",
        "year_built": a["year_built"],
        "units": a["units"],
        "use_description": a["use_description"],
        "your_legal_city": "",
        "your_note": "",
    })
rows.sort(key=lambda r: (r["check_first"] != "YES", "NO MATCH" not in r["how_we_found_it"], r["address_id"]))
with open("review/addresses_check.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)

rules = json.load(open(f"{SRC}/rules.json"))["rules"]
out = []
for r in rules:
    out.append({
        "team_rule_id": r["team_rule_id"],
        "jurisdiction": r["jurisdiction"],
        "category": r["category"],
        "title": r["title"],
        "citation": r["citation"],
        "our_status_on_2026_10_01": r["status"],
        "our_effective_date": r.get("effective_date") or "",
        "key_value": r.get("key_value") or "",
        "who_it_covers": (r.get("coverage_conditions") or {}).get("summary", "") if isinstance(r.get("coverage_conditions"), dict) else (r.get("coverage_conditions") or ""),
        "exemptions": r.get("exemptions") or "",
        "source_doc": r.get("source_doc_id") or "",
        "source_url": r.get("source_url") or "",
        "quote_from_source": r.get("quoted_span") or "",
        "model_confidence": r.get("confidence"),
        "flagged_conflict": r.get("conflict_note") or "",
        "your_status (in_force / not_yet_effective / pending / failed)": "",
        "your_effective_date": "",
        "official_source_you_used": "",
        "your_note": "",
    })
with open("review/rule_status_check.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
    w.writeheader()
    w.writerows(out)

PRIORITY = {"Hoboken, NJ": "HIGH (40 addresses, test T2/T3)", "Jersey City, NJ": "HIGH (50 addresses, test T2/T3)",
            "Newark, NJ": "HIGH (50 addresses)", "San Diego, CA": "HIGH (50 addresses)",
            "Santa Ana, CA": "MEDIUM (rules only, no addresses)"}
links = list(csv.DictReader(open(f"{PACK}/corpus/links_only.csv", newline="")))
lo = []
for l in links:
    lo.append({
        "priority": PRIORITY.get(l["jurisdictions"], "LOW (text for this law is already in the corpus or it is secondary)"),
        "doc_id": l["doc_id"],
        "jurisdiction": l["jurisdictions"],
        "url_in_starter_pack": l["url"],
        "source_type": l["source_type"],
        "official_page_with_full_text (city or state site)": "",
        "date_you_opened_it": "",
        "your_note": "",
    })
lo.sort(key=lambda r: (not r["priority"].startswith("HIGH"), not r["priority"].startswith("MEDIUM"), r["doc_id"]))
with open("review/link_only_sources.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(lo[0].keys()))
    w.writeheader()
    w.writerows(lo)

print(f"addresses_check.csv: {len(rows)} rows, {sum(r['check_first'] == 'YES' for r in rows)} to check first")
print(f"rule_status_check.csv: {len(out)} rule cards (from {SRC}/rules.json)")
print(f"link_only_sources.csv: {len(lo)} sources, {sum(r['priority'].startswith('HIGH') for r in lo)} high priority")

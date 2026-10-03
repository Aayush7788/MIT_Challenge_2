"""Our own score check, since the organizers' score.py wasn't in the starter pack.

  python3 scripts/selfscore.py

This is NOT the official scorer. It estimates the four scripted parts.
  extraction   did we find the rules the brief names (data/silver/brief_rules.json),
               with the right status and date
  coverage     data/silver/lookups.json if someone fills it in (a missing rule that
               applies costs double, "unknown" gets half credit), plus the facts the
               brief states about whole groups of addresses
  citations    share of "applies" answers whose quote appears word for word in the source
  changes      overlap (Jaccard) with the address sets T1-T5 imply, plus T3's conflict flags
"""
import csv
import json
import os
import re

PACK = "."
rules = json.load(open("submission/rules.json"))["rules"]
by_id = {r["team_rule_id"]: r for r in rules}
lookups = json.load(open("submission/lookups.json"))["lookups"]
changes = json.load(open("submission/changes.json"))
jur = json.load(open("data/derived/jurisdictions.json"))
overrides = {r["address_id"]: r["legal_city"] for r in csv.DictReader(open("data/derived/address_overrides.csv")) if r.get("legal_city")}
addresses = {r["address_id"]: r for r in csv.DictReader(open(f"{PACK}/data/sample_addresses.csv"))}


def city(aid):
    return overrides.get(aid) or (jur.get(aid) or {}).get("city")


def state(aid):
    return (jur.get(aid) or {}).get("state") or addresses[aid]["state"]


lines = []
say = lines.append

# Extraction
silver = json.load(open("data/silver/brief_rules.json"))["rules"]
ext_points = 0.0
ext_rows = []
for s in silver:
    pat = re.compile(s["cite"], re.I)
    hits = [r for r in rules if r["jurisdiction"] == s["jurisdiction"] and r["category"] == s["category"] and pat.search(f'{r["citation"]} {r["title"]}')]
    if not hits:
        ext_rows.append(("MISSING", s["label"], ""))
        continue
    status_ok = any(r["status"] == s["status"] for r in hits)
    date_ok = True
    if s.get("date"):
        date_ok = any((r.get("effective_date") or "").startswith(s["date"]) for r in hits)
    ext_points += 0.5 + 0.25 * status_ok + 0.25 * date_ok
    flag = "ok" if status_ok and date_ok else "PARTIAL"
    detail = "" if flag == "ok" else f'ours: {", ".join(f"{r["team_rule_id"]} {r["status"]} {r.get("effective_date")}" for r in hits)}; brief: {s["status"]} {s.get("date", "")}'
    ext_rows.append((flag, s["label"], detail))
ext_score = 25 * ext_points / len(silver)

# Coverage invariants the brief states
def entries(aid):
    return [(e, by_id.get(e["team_rule_id"])) for e in lookups.get(aid, [])]


inv = {}


def check(name, ok):
    a, b = inv.get(name, (0, 0))
    inv[name] = (a + bool(ok), b + 1)


for aid, a in addresses.items():
    st, c = state(aid), city(aid)
    es = entries(aid)
    if st == "MA":
        check("MA: no rent cap reported (T5, c.40P)", not any(r and r["category"] == "rent_increase_limits" and r["level"] == "city" and e["result"] in ("applies", "unknown") for e, r in es))
        check("MA: algorithmic bills shown as pending", any(r and r["category"] == "algorithmic_rent_setting" and e["result"] == "pending" for e, r in es))
    if st == "NJ":
        check("NJ: FAIR Act shown as not yet effective", any(r and r["category"] == "algorithmic_rent_setting" and r["level"] == "state" and e["result"] == "not_yet_effective" for e, r in es))
    if st == "CA":
        check("CA: AB 325 applies on 2026-10-01", any(r and r["level"] == "state" and r["category"] == "algorithmic_rent_setting" and re.search(r"AB\s*325|16729", r["citation"]) and e["result"] == "applies" for e, r in es))
    yb = int(a["year_built"]) if a["year_built"].strip().isdigit() else None
    if c == "San Francisco" and yb:
        local = any(r and r["level"] == "city" and r["category"] == "rent_increase_limits" and e["result"] == "applies" for e, r in es)
        if yb < 1979:
            check("SF pre-1979: local rent cap applies", local)
        elif yb > 1979:
            check("SF post-1979: local rent cap does not apply", not local)
    if c == "Los Angeles" and yb:
        local = any(r and r["level"] == "city" and r["category"] == "rent_increase_limits" and e["result"] == "applies" for e, r in es)
        if yb < 1978:
            check("LA pre-1978: RSO applies", local)
        elif yb > 1978:
            check("LA post-1978: RSO does not apply", not local)
    if c in ("Hoboken", "Jersey City"):
        check("Hoboken/JC: own algorithmic ban applies", any(r and r["level"] == "city" and r["category"] == "algorithmic_rent_setting" and e["result"] == "applies" for e, r in es))

cov_note = ""
silver_lookups = "data/silver/lookups.json"
cov_score = None
if os.path.exists(silver_lookups):
    exp = json.load(open(silver_lookups))
    got = earned = 0.0
    for aid, items in exp.items():
        for it in items:
            pat = re.compile(it["cite"], re.I)
            mine = [e for e, r in entries(aid) if r and r["category"] == it["category"] and pat.search(r["citation"])]
            weight = 2.0 if it["result"] == "applies" else 1.0
            got += weight
            if any(e["result"] == it["result"] for e in mine):
                earned += weight
            elif it["result"] == "applies" and any(e["result"] == "unknown" for e in mine):
                earned += 0.5 * weight
    cov_score = 20 * earned / got if got else None
    cov_note = f"silver key: {len(exp)} addresses"
inv_pass = sum(a for a, b in inv.values()) / max(1, sum(b for a, b in inv.values()))
if cov_score is None:
    cov_score = 20 * inv_pass
    cov_note = "no silver address key yet; using the brief's invariants"

# Citations
texts = {}
for d in ("corpus/text", "corpus_extra"):
    if os.path.isdir(d):
        for f in os.listdir(d):
            texts[f[:-4]] = open(os.path.join(d, f), encoding="utf8").read()
applies = [(e, by_id.get(e["team_rule_id"])) for aid in lookups for e in lookups[aid] if e["result"] == "applies"]
backed = sum(1 for e, r in applies if r and r.get("source_doc_id") in texts and r["quoted_span"] in texts[r["source_doc_id"]])
cit_share = backed / max(1, len(applies))
cit_score = 15 * cit_share

# Changes
ids = list(addresses)
expected = {
    "T1": ({a for a in ids if state(a) == "CA"}, None),
    "T2": ({a for a in ids if city(a) in ("Hoboken", "Jersey City")}, None),
    "T3": ({a for a in ids if state(a) == "NJ"}, {a for a in ids if city(a) in ("Hoboken", "Jersey City")}),
    "T4": ({a for a in ids if state(a) == "MA"}, None),
    "T5": (set(), None),
}


def jac(a, b):
    return 1.0 if not a and not b else len(a & b) / len(a | b)


chg = []
for t, (want, want_conf) in expected.items():
    got = set((changes.get(t) or {}).get("affected_address_ids", []))
    s = jac(want, got)
    if want_conf is not None:
        s = 0.5 * s + 0.5 * jac(want_conf, set((changes.get(t) or {}).get("conflict_flag_address_ids", [])))
    chg.append((t, s, len(got), len(want)))
chg_score = 15 * sum(s for _, s, _, _ in chg) / len(chg)

total = ext_score + cov_score + cit_score + chg_score
say("SELF-CHECK (not the official score.py)")
say(f"  rules {len(rules)} | addresses {len(lookups)} | as of {json.load(open('submission/lookups.json'))['as_of']}")
say("")
say(f"Extraction        {ext_score:5.1f} / 25   ({len(silver)} rules named in the brief)")
for flag, label, detail in ext_rows:
    if flag != "ok":
        say(f"    {flag:8} {label}" + (f"  [{detail}]" if detail else ""))
say(f"Address coverage  {cov_score:5.1f} / 20   ({cov_note})")
for name, (a, b) in inv.items():
    say(f"    {a:3d}/{b:<3d} {name}")
say(f"Citations         {cit_score:5.1f} / 15   ({backed}/{len(applies)} 'applies' answers quote their source verbatim)")
say(f"Change tracking   {chg_score:5.1f} / 15")
for t, s, g, w in chg:
    say(f"    {t}: overlap {s:.2f} (ours {g}, expected {w})")
say(f"SCRIPTED TOTAL    {total:5.1f} / 75")
print("\n".join(lines))
os.makedirs("out/audit", exist_ok=True)
open("out/audit/selfscore.txt", "w").write("\n".join(lines) + "\n")

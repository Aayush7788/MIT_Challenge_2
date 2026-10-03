"""Loaders for the participant pack: corpus manifest + text, sample addresses with their known gaps (README 4.1)."""
import csv, os
PACK = os.path.join(os.path.dirname(__file__), "..", "pack")
EXTRA = os.path.join(os.path.dirname(__file__), "..", "corpus_extra")   # hand-fetched pages for link-only sources (see README)

def load_corpus():
    docs = []
    for r in csv.DictReader(open(os.path.join(PACK, "corpus", "corpus_manifest.csv"))):
        d = {"doc_id": r["doc_id"], "jurisdictions": r["jurisdictions"], "url": r["url"], "source_type": r["source_type"],
             "retrieved_at": (r.get("retrieved_at") or "")[:10], "status": r["status"], "text": None}
        if r["status"] == "ok" and r.get("text_file"):
            d["text"] = open(os.path.join(PACK, "corpus", r["text_file"]), encoding="utf-8", errors="replace").read()
        docs.append(d)
    # extra documents fetched by hand for link-only sources: corpus_extra/<doc_id>.txt with SOURCE:/RETRIEVED: header
    if os.path.isdir(EXTRA):
        for fn in sorted(os.listdir(EXTRA)):
            if not fn.endswith(".txt"): continue
            txt = open(os.path.join(EXTRA, fn), encoding="utf-8", errors="replace").read()
            did = fn[:-4]
            hdr = dict(l.split(":", 1) for l in txt.split("\n")[:2] if ":" in l)
            existing = next((d for d in docs if d["doc_id"] == did), None)
            rec = {"doc_id": did, "jurisdictions": existing["jurisdictions"] if existing else "", "url": hdr.get("SOURCE", "").strip(),
                   "source_type": existing["source_type"] if existing else "hand-fetched", "retrieved_at": hdr.get("RETRIEVED", "").strip()[:10],
                   "status": "ok (fetched by team)", "text": txt}
            if existing: existing.update(rec)
            else: docs.append(rec)
    return docs

def _int(x):
    try: return int(float(x))
    except (TypeError, ValueError): return None

def load_addresses():
    rows = []
    for r in csv.DictReader(open(os.path.join(PACK, "data", "sample_addresses.csv"))):
        rows.append({**r, "year_built": _int(r.get("year_built")), "units": _int(r.get("units"))})
    return rows

def facts_of(a: dict, stack) -> dict:
    """Building facts for the engine. Known gaps become None -> 'unknown' downstream (README 4.1)."""
    units = a["units"]
    if a["state"] == "MA" and (a.get("use_code") or "").startswith("A/"): units = None     # Boston apartment rows lack unit counts
    return {"units": units, "year_built": a["year_built"], "use_code": a.get("use_code"),
            "owner_occupied": None, "single_family": None, "condo": None, "subsidized": None,
            "tenancy_months": None, "corporate_owner": None, "fair_market_rent": None,
            "city": stack.city if stack else None, "county": stack.county if stack else None}

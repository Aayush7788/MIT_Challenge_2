"""Rebuilds corpus_crosscheck/manifest.csv from the headers of the files in it.

Each file holds the official text of one law (or a record that confirms a number,
such as a council agenda), with SOURCE, RETRIEVED, JURISDICTION, CITES and NOTE
lines on top. The cite-check (scripts/citecheck.ts) quotes only files that are
the law's own text.
"""
import csv
import hashlib
import os
import re

DIR = "corpus_crosscheck"
rows = []
for f in sorted(os.listdir(DIR)):
    if not f.endswith(".txt"):
        continue
    text = open(os.path.join(DIR, f), encoding="utf-8").read()
    head = lambda k: (re.search(rf"^{k}:\s*(.+)$", text, re.M) or [None, ""])[1].strip()
    rows.append({
        "doc_id": f[:-4],
        "jurisdictions": head("JURISDICTION"),
        "url": head("SOURCE"),
        "source_type": head("TYPE") or "official",
        "retrieved_at": head("RETRIEVED"),
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "text_file": f"{DIR}/{f}",
        "cites": head("CITES"),
        "note": head("NOTE"),
    })
with open(os.path.join(DIR, "manifest.csv"), "w", newline="") as out:
    w = csv.DictWriter(out, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
print(f"{DIR}/manifest.csv: {len(rows)} files")

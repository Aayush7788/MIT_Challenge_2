"""Saves one official source document into corpus_extra/ so extraction can read it.

  python3 scripts/capture-source.py D034 "Hoboken, NJ" https://hobokennj.iqm2.com/... --note "..."
  python3 scripts/capture-source.py X001 CA https://leginfo... --text-file page.txt   # text copied from a browser

We grab one page per law, the way a person would read it, and never crawl. Each
file starts with SOURCE, RETRIEVED and JURISDICTION lines, and the hash goes in
corpus_extra/manifest.csv, so any quote we use can be traced back to its page.
"""
import argparse
import csv
import datetime
import hashlib
import io
import os
import re
import urllib.request
from html.parser import HTMLParser

BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "table", "blockquote"}


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.out = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript", "head"):
            self.skip += 1
        if tag in BLOCK:
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "head"):
            self.skip = max(0, self.skip - 1)
        if tag in BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)

    def text(self):
        t = "".join(self.out).replace("\xa0", " ")
        t = re.sub(r"[ \t\r\f\v]+", " ", t)
        t = re.sub(r"\n[ ]+", "\n", t)
        t = re.sub(r"\n{3,}", "\n\n", t)
        return t.strip()


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (rental-housing-law-navigator; one-page capture)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read()
        ctype = r.headers.get("Content-Type", "")
    if url.lower().endswith(".pdf") or "pdf" in ctype:
        from pypdf import PdfReader

        return "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(body)).pages)
    p = Text()
    p.feed(body.decode("utf-8", errors="replace"))
    return p.text()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("doc_id")
    ap.add_argument("jurisdiction")
    ap.add_argument("url")
    ap.add_argument("--note", default="")
    ap.add_argument("--type", default="official", help="official, or secondary (mirror / news) so extraction ranks it lower")
    ap.add_argument("--reviewer-note", default="", help="a reviewer's note about this source; extraction adds it to every card from it")
    ap.add_argument("--text-file", help="text already copied from a browser, for sites that block scripts")
    ap.add_argument("--start", help="drop everything before the first line containing this text (site menus)")
    a = ap.parse_args()

    text = open(a.text_file, encoding="utf-8").read() if a.text_file else fetch(a.url)
    if a.start and a.start in text:
        text = text[text.index(a.start):]
    now = datetime.datetime.now(datetime.timezone.utc)
    header = [
        f"SOURCE: {a.url}",
        f"RETRIEVED: {now.strftime('%Y-%m-%d %H:%M')} UTC",
        f"JURISDICTION: {a.jurisdiction}",
    ]
    if a.type != "official":
        header.append(f"TYPE: {a.type}")
    if a.note:
        header.append(f"NOTE: {a.note}")
    if a.reviewer_note:
        header.append(f"REVIEWER_NOTE: {a.reviewer_note}")
    body = "\n".join(header) + "\n\n" + text.strip() + "\n"
    os.makedirs("corpus_extra", exist_ok=True)
    path = f"corpus_extra/{a.doc_id}.txt"
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)

    manifest = "corpus_extra/manifest.csv"
    rows = list(csv.DictReader(open(manifest))) if os.path.exists(manifest) else []
    rows = [r for r in rows if r["doc_id"] != a.doc_id]
    rows.append({
        "doc_id": a.doc_id,
        "jurisdictions": a.jurisdiction,
        "url": a.url,
        "source_type": "official (captured by the team; not in the starter pack)" if a.type == "official" else a.type,
        "retrieved_at": now.strftime("%Y-%m-%dT%H:%MZ"),
        "sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
        "text_file": path,
        "note": a.note,
    })
    with open(manifest, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(sorted(rows, key=lambda r: r["doc_id"]))
    print(f"{path}: {len(text):,} chars")


if __name__ == "__main__":
    main()

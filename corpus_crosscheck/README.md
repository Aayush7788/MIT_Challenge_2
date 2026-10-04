# Official texts for the cite-check

Many documents in the supplied corpus are agency pages or guides that restate a
statute or ordinance in their own words. Our lawyer's rule is that a quote has to
come from the source the citation names, so this folder holds the text of the
laws themselves, one law (or one section) per file. `scripts/citecheck.ts` copies
a passage from these files onto each card (`official_text`) and checks the
card's citation against them. The cards keep their supplied-corpus quotes too,
because the organizers' citation score counts only the supplied corpus.

Each file starts with SOURCE, RETRIEVED, JURISDICTION, CITES and NOTE lines that
we wrote; the cite-check reads only the text below them. `manifest.csv` has the
SHA-256 of every file (`python3 scripts/crosscheck-manifest.py` rebuilds it).

- O001-O004: California code sections and the chaptered text of AB 12 (leginfo).
- O010-O026: New Jersey statutes (NJ Legislature statutes database).
- O030-O034: Los Angeles ordinances (City Clerk PDFs). O033 is a 2013 copy of the
  Rent Stabilization Ordinance and is never quoted.
- O040-O042: the San Francisco Rent Ordinance as published by the Rent Board, and
  the Fair Chance Ordinance as enacted and amended.
- O050-O053: Berkeley's Rent Stabilization Ordinance (Rent Board copy), Measure BB
  as certified, and the Rent Board's AGA regulations.
- O060-O064: Santa Ana's algorithmic-pricing ordinance (second reading) and its
  Rent Stabilization and Just Cause Eviction Ordinance (NS-3073).
- O070, O072: Boston's Housing Stability Notification Act (as filed) and the Fair
  Housing Commission regulations.
- O080-O100: pages from code publishers that refuse scripts (ecode360 for Hoboken,
  American Legal for Los Angeles, Berkeley's code site, Municode for Jersey City,
  Santa Ana and Cambridge). We read each in a browser and kept the copy only when
  the SHA-256 of the copied text matched the page.
- O101: a law-firm summary of Cella v. Attorney General, SJC-13893, kept only to
  confirm the case citation; the court's slip opinion is served only as a download.
- D032: the Hoboken Mile Square Taxpayers Association's 2024 printout of Hoboken
  Code chapter 155. Our lawyer asked us to cite the city's own code (corpus_extra/D033)
  and keep this copy only as a cross-check; it is never quoted.

Agendas, staff reports, a newsletter and the law-firm summary (marked in their
TYPE line) only confirm numbers and dates; the cite-check never quotes them as law.

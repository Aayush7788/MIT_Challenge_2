# Adding a new city live (technical video)

This segment shows that adding a jurisdiction is a data step and not a code change. We add Oakland, California, which is not in the challenge data, from two official pages while the camera is rolling, and then we look up an Oakland address. Everything runs in a throwaway copy of the repo, so the submitted files never change.

## Before recording (about 2 minutes)

1. In the project folder, run `bash scripts/demo-new-city.sh`. It makes a copy in `../navigator-demo` with the dependencies and your `.env.local`.
2. Run `cd ../navigator-demo`.
3. Open the two source files in your editor so you can show them on screen.
   - `demo/new-city/oakland/OAK01.txt` is the City of Oakland's page on allowable rent increases (2.3% from August 1, 2026).
   - `demo/new-city/oakland/OAK02.txt` is the Oakland row of the California Department of Justice's table of local rent limits (units with a certificate of occupancy issued before 1/1/83).

## On camera (about 90 seconds)

1. Say that Oakland isn't in the challenge data, and show the two saved pages with their source and retrieval lines at the top.
2. Run the ingest command.
   ```bash
   npm run ingest -- demo/new-city/oakland --jurisdiction "Oakland, CA"
   ```
   While it runs, explain that the extractor reads both pages, a second model checks every field against the text, and all 500 addresses are recomputed. The output ends with the new Oakland card and the same self-check as before.
3. Start the app with `npm run dev -- --port 3008` and open http://localhost:3008.
4. Click "Any US address", type `1500 Harrison St, Oakland, CA 94612` and press Enter. The memo places it in California › Alameda County › Oakland, and rent increases show as unknown because the public data has no year built.
5. Open "Know more? Enter it", type 1925 as the year built and click "Update memo". Rent increases now apply, at 2.3% under Oakland Mun. Code ch. 8.22.
6. In "Can the landlord do this?", ask about a 10% raise. The answer is "No. Oakland Mun. Code ch. 8.22 limits this to 2.3%."
7. If you have time, change the year built to 2010. Oakland's rent control no longer covers the unit, the state cap takes over, and a 15% raise comes back as no.

A closing line that fits: adding a city took two saved pages and one command, and no code changed.

## Notes from the rehearsal (October 3)

- The two pages became one Oakland card, since they describe the same law. The second check rejected nothing.
- The card keeps the 2026 figure (2.3%). The state table's 0.8% ran through July 31, 2026, so the merge treats it as expired.
- The run costs about $0.10 of API usage.
- The Census geocoder misses plaza addresses (e.g., "1 Frank H Ogawa Plaza"), so use a regular street address.
- Delete `../navigator-demo` when you're done.

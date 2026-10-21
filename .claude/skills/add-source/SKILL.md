---
name: add-source
description: Add a website as a new scraper source for chunky.dad, end to end — recon the site slowly, find its door, write the parser stanza, promoter entry, expectations file and bars entry, run it solo, open the PR. Use this whenever the owner shares a URL, Linktree or Instagram handle and wants it scraped, says "start scraping", "add this site", "new source", "can we read this", or asks whether a site is scrapable — even when he gives several links at once or only an Instagram handle.
---

# Add a source

The job: one website becomes one entry in `scripts/scraper-input.js` that the daily run reads correctly, with the paperwork that keeps it honest. Every step below exists because skipping it cost a run once.

## 1. Sort the links he gave
- **The site itself** is the source. Everything else is context.
- **Linktree / link hubs** are discovery only: open one to find the real site and ticket platform, never configure it.
- **Instagram and Facebook are never fetched** (owner policy, 2026-10-11: IP and account safety first). An Instagram URL goes into the promoter entry as a link, nothing more.
- A ticketing page (Eventbrite organiser, OutSavvy, DICE, TicketSauce) can be the door when the site has none.

## 2. Recon, slowly
Websites are someone else's server. Read like a careful visitor:
- `robots.txt` first; a browser user agent; **4 s between requests to one host, at most a dozen requests in recon**. Save every page you fetch under the scratchpad (`recon-<slug>/`) so you never fetch it twice.
- Read: `<title>`, generator meta, JSON-LD (`application/ld+json`), the platform markers (`tribe-events`, `wp-json`, `squarespace`, `wixstatic`, `elfsight`, `eventon`, `mec-`, `dice.fm`), the sitemap, the visible event text (dates, clocks, venue, price).
- Name the **door**: the one place the site states its events completely. JSON-LD on the page, a Tribe feed, a Squarespace `?format=json` twin, a Wix warmup blob, EventON/MEC AJAX, an Elfsight widget, a DICE list, an Eventbrite organiser page. The parser already has readers for all of these — look at a stanza that uses the same door and copy its shape.
- Write down the **traps** you see: a recurring listing whose structured date is the first edition, a related-events rail, a pass link every night carries, undated teasers, a logo as the only image. These go in the expectations file; some become generic fixes.

## 3. Build in a worktree
`git worktree add -b source/<slug> $SCRATCHPAD/wt-<slug> origin/main`. Never switch branches in the primary checkout.

**The stanza** (`scripts/scraper-input.js`, next to a similar source): a comment that says what the site is, what the door is and what the traps are, then `urls: [...]`. Add `urlDiscoveryDepth: 0` only when the crawl has nothing to gain from following links. Do **not** add `alwaysBear` or `metadata` for a brand that has a registry entry — the promoter-registry test refuses it.

**The promoter entry** (`data/promoters.json`) for a party brand: `name`, `aliases`, `shortName`, `instagram`, `website`, `bearAffinity` ("always" for a bear/chub brand). Then `node tools/generate-scraper-promoters.js`.

**The expectations file** (`data/source-expectations/<slug>.json`, read `data/source-expectations/README.md` and copy a recent `complete` file such as `red-room-ptown.json`). The gate test is strict: trap `kind` must be one of the listed kinds, `bearVerdict` is `{ value, decidedBy, decidedOn }`, `seenInRun` is a run id or null, and the words TODO/TBD/PLACEHOLDER are refused anywhere — say "the midnight stand-in", not "placeholder".

**The venue** goes in `data/bars/<city>.json` when it is not there (`name`, `city`, `address`, `coordinates` from the site's own structured data), then `node tools/generate-scraper-bars.js`. Curated bars outrank geocoders and give the pin.

## 4. Run it solo, read the log
The AI servers must be up (`curl http://100.107.118.60:8000/health` and `:8001`). Then:
```
mkdir -p ../solo-<slug>/storage
CHUNKY_SHARED_STORAGE_DIR=$PWD/../solo-<slug> CHUNKY_RUN_PARSER="<stanza name>" CHUNKY_RUN_OUT=$PWD/../solo-<slug>/out.json node tools/run-once.js > ../solo-<slug>/run.log 2>&1
```
Read `out.json` (`results.analyzedEvents`, `bearDroppedEvents`) and the log lines that matter: `MACHINE DOOR`, `Classified`, `Extracted N event(s) from …`, `Enrich-only crawl`, `GEOCODE VERIFY`, `BEAR CHECK`, `DEDUP`. Ask of every record: right night, right clock, venue name, street, pin, ticket link, image, bear verdict. A record with the day but no clock, or a venue without a pin, is not done.

When something is wrong, fix the **shape**, never the site: a rule with a fixture test (`scripts/fixtures/<topic>-<date>/`) from the real page. Two found this way on 2026-10-20: the enrich crawl dropped the page a row's own ticket link opens, and a JSON-LD Place's GeoCoordinates were never read.

## 5. Finish
- Full suite: `node --test --test-reporter=tap --require ./scripts/test-quiet-console.js $(node -e "console.log(require('./package.json').scripts.test.replace('node --test ',''))")`.
- Commit, push, `gh pr create`. The PR body says: the site and its door, the live solo-run record, every generic fix with its reason, tests, runtime files touched (no new phone file unless flagged).
- **Never merge.** After he merges, follow the `post-merge` skill.
- Record the lesson in memory if a trap was new.

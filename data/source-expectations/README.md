# Source expectations — what each scraped site SHOULD yield

One file per live parser in `scripts/scraper-input.js`, hand-written from the
live site. This is ground truth for the scraper, kept separately from the
scraper so that "what the site publishes" and "what we extracted" can finally be
compared instead of guessed at.

`scripts/source-expectations.test.js` validates every file and **fails until
every source is documented** — that is deliberate. Run `npm test` to see the
ledger.

## Rules that settle the ambiguous cases

- **`source` is the exact `parsers[].name`** from `scraper-input.js`; the filename
  is `slugify(source)`. Rename the parser and the test names both sides.
- **Every event the site publishes goes in — bear or not.** Bear verdicts are a
  separate, later pass (`bearVerdict` stays `null`; `expect.kept` stays `null`).
- **A series is ONE entry**: the RRULE plus concrete `occurrences` inside
  `coverage.occurrenceWindow` (~90 days). Rockbar's 143 widget rows are 6
  one-offs + 19 series, not 143 events.
- **Singles are never window-limited.** A one-off eight months out is documented.
- **Past listings are counted, not enumerated** — `coverage.pastListingsPresent`
  plus the count in `coverage.basis`.
- **`null` means the site publishes nothing for that field.** An omitted key
  inherits from `defaults`, else is not asserted. No `TODO`/`TBD` prose anywhere.
- **`location` is `"lat, lng"` or `null`** — never an address (calendar contract).
  Hand recon rarely has coordinates; `null` is the norm.
- **Quote, never paraphrase.** `evidence.quote` is verbatim source text, or
  `evidence.jsonPath` points into a saved feed response.

## Status

| status | means | requires |
|---|---|---|
| `not-started` | stub only | `recon.date: null`, no events |
| `in-progress` | partial | `recon.date`, non-empty `coverage.knownGaps` |
| `complete` | every published event documented | `publishedEventCount === events.length`, confidence high/medium, `recon.parserUrlsAtRecon` equal to the parser's current `urls` |
| `publishes-nothing` | the site currently lists zero events — a real finding | a positive empty-state citation from **two** doors |
| `unreachable` | ground truth could not be established | which rung failed and how, in `knownGaps`. Never `0` for this. |

## Fields

### `recon`
- `date` — the day the live site was read.
- `method[]` — `feed | static | rendered | page-cache | classification-cache | flyer`, by reliance.
- `parserUrlsAtRecon` — snapshot of `parsers[].urls` that day. A finished file
  must describe the door the scraper actually uses; the test compares them.
- `doors[]` — every URL/endpoint actually read: `{url, kind, role, rowsReturned, truthFlag, note}`.
  `truthFlag` records the feed's own completeness signal (`hasMoreUpcoming`,
  `links.next`, `hasNext`, `total_pages`, `count`) — trust the flag, not the
  array length.

### `coverage`
- `confidence` — `high | medium | low`.
- `basis` — how coverage was established, in prose. Name the door each count came from.
- `publishedEventCount` — distinct things the site publishes now (a series counts once).
- `documentedEventCount` — must equal `events.length`.
- `occurrenceWindow` — the range series occurrences are materialized into.
- `pastListingsPresent` — the site also lists past events (the scraper keeps them
  under `allowPastEvents`; they are not enumerated here).
- `knownGaps[]` — what this file does not cover, and why.

### `events[]`
Event-data keys are **canonical event-schema keys** (`bar` not `venue`,
`website` not `url`, `recurrence` not `rrule`). Dates `YYYY-MM-DD`, times
`HH:MM` 24h local, `city` a `scraper-cities` key, `timezone` IANA.

- `id` — kebab-case, unique in the file.
- `kind` — `series | single`.
- `recurrence` — RRULE value (no `RRULE:` prefix), series only.
- `recurrenceStatedAs` — the site text that states the repeat. Required for
  series: you may not assert a rule you cannot quote.
- `occurrences[]` — `{startDate, origin, cancelled?, overrides?, evidence?}`.
  `origin: "listed"` = the site publishes that dated instance itself (needs
  evidence); `origin: "rule"` = RRULE arithmetic (evidence only if `cancelled`
  or `overrides`).
- `sourceRung` — which rung of the ladder produced this event.
- `confidence` — `high | ambiguous` (e.g. no year on the source).
- `belongsToSource` — for aggregator rows that are another parser's event.
- `sameEventAs[]` — `"<slug>#<event-id>"` cross-file identity, when known.
- `evidence` — `{url, quote}` or `{url, jsonPath}`; `imageUrl` for flyers.
- `expect.extracted` — `true | false | "unknown"`: should this record appear
  **anywhere** in a run (`parserResults[].events[]` ∪ `bearDroppedEvents[]`)?
  `"unknown"` needs a `note` (e.g. flyer-only → an OCR-path question, not a crawl one).
- `expect.kept`, `bearVerdict` — `null` until the owner's bear pass.

### `traps[]`
Things that look like events and must not be scraped (or must not be scraped
from here): `venue-header | past-event | foreign-promoter | foreign-programming
| navigation | recurring-blurb | ticket-tier | merch | announcement |
duplicate-listing | soft-404 | gallery | out-of-config-scope`. Each needs
`label`, `why`, `evidence`, `expect`; `seenInRun` anchors it to a real run id.
A trap may carry `expect.extracted: true` when extraction is correct behaviour
(a past event under `allowPastEvents`) — documenting the judgment stops a future
reader from "fixing" a non-bug.

### `openQuestions[]`
`{q, raisedOn, blocking}` — things the recon could not settle.

## What this is NOT

- Not consumed by the scraper at runtime. No generated `scripts/` twin.
- Not a diff. The comparison tool comes later and has one rule: for every
  event, occurrence, and trap, compare `expect.extracted` against membership in
  the run's `parserResults[].events[] ∪ bearDroppedEvents[]`, keyed on
  `${normalizedTitle}|${startDate}|${bar}` with `ticketUrl` as fallback.

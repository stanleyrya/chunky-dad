---
name: replay-a-rule
description: Replay a new or changed drop, skip, dedup or URL-validator rule over the last saved scraper runs to prove it loses no real events before the PR is opened. Use this whenever you add or tighten anything that removes, withholds, folds or refuses an event or a crawl target — title shapes, validator reasons, identity rungs, furniture rules — and whenever the owner asks "are we losing real events?", "is this safe?", or "what would this have dropped?". Run it before opening the PR, not after.
---

# Replay a rule over real runs

A rule that looks right on its fixture can still eat real parties. On 2026-10-20 a street-line shape ("…st 37" = a German street) read **Midwest Bearfest 2026**, **DOGFEST 5** and **Mx. Fist 2026** as addresses; the fixture test was green. Twelve saved runs showed it in a minute. Do this every time, and put the numbers in the PR.

## The data
`~/Library/Mobile Documents/com~apple~CloudDocs/chunky-dad-data/runs/<runId>.json` — one file per run, `analyzedEvents` (kept), `bearDroppedEvents`, and `parserResults[].urlClassifications` (every page the crawl classified). Twelve runs is a good window; the files are large, so read them in a script, never into the conversation.

## The script
`scripts/replay-rules.js <repo-root> [--runs N]` — loads the repo's `AiWebParser` and runs, over every kept and dropped event and every classified page:
- `AiWebParser.furnitureTitleShape(title)` when it exists (title shapes), and
- `parser.validateEventUrl(url)` for the reasons named in `REJECT_REASONS` at the top of the script.

Point it at the worktree that holds the new rule. It prints three tables: title-shape hits, event URLs the crawler would now refuse, classified pages it would now refuse — each with how many runs the record appeared in, so a real event (kept in 12 of 12) stands out from junk (1 of 12, "Events for July 27").

For a rule that is not one of those two, add a case to the script rather than eyeballing: a dedup rung is replayed by rebuilding the two records from the run file and calling `core.getSameEventIdentitySignal`; a withhold is replayed by counting what `filterEventsForExecution` would now hold back.

## Before and after
When the rule changes what the crawl follows, compare two runs — the last one before and the first one after — per parser: upcoming titles lost and gained. A title that vanishes from every run after the change, while its page still passes the validator, is normal drift; one whose page the rule now refuses is a loss. The 2026-10-20 check of this kind is in the session's memory under `crawl-junk-2026-10-18`.

## What to write in the PR
The hit list after the fix (only furniture left), any real title the first version caught and how the rule changed, and the run window. If a real title still trips the rule, the rule is not ready.

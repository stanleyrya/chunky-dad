---
name: deck-action-cards
description: Turn anything that needs a change to the owner's calendar or data — a duplicate, a wrong end time, a stale record, a rename, a venue fix — into a card on the review deck that he swipes and the phone executes (a manual card via npm run deck-card for a one-off, a new card kind for a family), instead of a page of links, a list of instructions, or a hand edit. Use this whenever you find yourself about to write "you could delete…", "edit this event…", or a to-do list of manual changes; whenever a scan, audit or run surfaces records to fix; and whenever he asks for "a card for this" or "put it on the deck".
---

# Make it a card, not a chore

Verification is the machine's; the judgment is his, one swipe at a time ([[no-human-chores]]). On 2026-10-15 a page of "open in Calendar" links for six duplicates sat untouched for five days because the links did not work on the phone. The same six became deck cards on 2026-10-20 and were cleared with swipes. Lists of manual edits are not a deliverable.

## What a card is
A card is a proposal with: one exact **key** a decision can be stored under, the **record** it concerns (uid, identifier, city, night), the **facts** he needs to judge it on the card itself, the **reason** the machine proposes it (in words), and an **executor** on the phone that re-verifies before it acts and refuses when the calendar no longer matches the card.

## The pattern that already works: gone-shaped cards
`SharedCore.buildGoneFromSourceCandidates` and `buildCalendarTwinCandidates` both emit candidates of `kind: 'gone'` with `key: gone|<city>|<uid>` and a `reason` (`gone`, `duplicate`, `moved`, `twin`). They ride in the run file under `goneFromSource.candidates`; `tools/review-queue.js` files them as cards; `tools/serve-results.js` renders them (`renderReviewGoneCard`, `renderReviewTwinCard`); decisions land in `owner-decisions.json`; `ScriptableAdapter.applyGoneDeletions` executes approvals with guards (one record by identifier, same title, same night, not recurring, and for twins: the kept copy still there). A new *removal* reason needs no new phone code — give it a reason, a renderer branch, and a guard if the night could vanish.

## Rules for a new card kind
- **Fail closed.** The phone re-finds the record and compares; a mismatch is a refusal with a log line, never a best guess.
- **Show both sides.** A twin shows the copy to remove and the copy to keep, fact by fact. An edit shows before and after.
- **Make it look like what it is.** Calendar-hygiene cards (anything that changes a saved record rather than proposing a new one) get their own colour: the twin card's amber band, tinted body and outline, `kind-twin`. Never the white of a source proposal or the purple of a gone card — he must know at a glance that this card edits his calendar.
- **Hidden mirrors for "the other one".** When a choice has two sides, ship the other side as a `twinMirror` candidate so "keep the other one instead" becomes an executable approval, not a note.
- **Reasons in words** on the card and in the run log, with the owner's own exclusions respected and named.
- **Series are never touched** by a card; a series fix is a design question.

## For a one-off: a manual card, in one command
A single record to fix needs no new card kind. `npm run deck-card -- <remove|edit|choose> …` (tools/add-deck-card.js) writes a **manual card** into the iCloud data folder; it shows in teal on the deck with its own band, and the phone executes the approval: `remove` through the gone path, `edit` through `applyManualEdits` (every "before" must still hold), `choose` records the answer only. With `--city` and `--uid` the command reads the saved record from the published calendar, so an edit's before is the record's current value. A card expires the day after its night. Write the `--why` for him, not for you: it is the whole card.

## What the deck cannot do yet
Anything that is not a remove, a field edit on one single record, or a two-way choice — a series change, a venue merge, a bulk rename — has no executor. For those: build the report-only half (the scan, the card, the decision) and say plainly that the execute step is missing; propose its shape and wait for his yes. Auto mode blocks edits that add calendar-delete code or delete UI — the existing removal path is the one to reuse, and a new executor is a PR he reads with eyes on.

## Checklist before opening the PR
Candidate builder with a test from real shapes · deck filing (`review-queue.test.js`) · renderer with its colour (`tools-serve-results.test.js`) · phone guard · `👯`-style log lines · a run of the offline scan over the published calendars with the numbers in the PR.

---
name: twins-scan
description: Find one night saved twice in the chunky.dad city calendars (calendar twins) and show which copy is the extra and why, from the published .ics files, offline. Use this when the owner mentions duplicates, twins, "the same event twice", a double booking, or asks what the twin cards on the deck will show; and before and after any change to the pairing rules in SharedCore.buildCalendarTwinCandidates.
---

# Calendar twins

The daily run already puts twins on the deck (amber cards, `👯 TWIN:` log lines) and the phone removes the copy he approves. This skill is the offline check: the same rules, against the published calendars in the repo, in seconds.

## Run it
```
cd <repo or worktree> && node .claude/skills/twins-scan/scripts/twins-scan.js
```
It reads `data/calendars/*.ics`, expands the next 400 days, skips series, and prints one line per pair: city, night, the copy that would be removed (**EXTRA**), the copy kept, the reason the two are one night, and the reason this copy is the extra. Lines ending "(tie by uid)" with an empty reason are the hidden mirror candidates — the kept copy as a record the deck can swap to — not extra cards.

## Read it against the rules
A pair is one night when, on the same local day: the same ticket page (never a pass link three nights share), the same name, or one name inside the other with the place agreeing or the shorter copy's venue a placeholder. The extra is the copy with fewer facts. Two deliberate exclusions from the owner (2026-10-15): a festival name inside a night's name with no place on the short side (Bearsgiving vs the Love Boat), and the two BeefDip welcome parties (two rooms, one slot).

When a line looks wrong, it is a rule question, not a data question: change `buildCalendarTwinCandidates` in `scripts/shared-core.js`, add the shape to the twins test in `scripts/shared-core.test.js`, run this script again, and replay before the PR (`replay-a-rule`).

## Never
Never delete or edit his calendar by hand or by script. Deletions happen only through the deck and the phone, one swipe each. If something needs an edit the deck cannot express yet (an end time, a rename), see `deck-action-cards`.

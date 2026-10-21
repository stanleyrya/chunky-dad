---
name: post-merge
description: The chores after the owner merges a pull request — confirm the merge, pull the primary checkout, remove the branch's worktree and branch, restart the review server, and verify the next daily run. Use this every time he says "merged", "all merged", "I merged it", "go ahead it's in", or a PR you opened shows MERGED; also before pushing anything to a branch that might already be merged.
---

# After a merge

He squash-merges fast. A push to a merged branch strands the work, and a stale primary checkout "proves" shipped code does not exist, so this runs the same way every time.

## 1. Confirm before touching anything
`gh pr view <n> --json state,mergedAt -q '.state'` — only `MERGED` continues. A PR that GitHub calls `CONFLICTING` is a real conflict: merge `origin/main` into the branch in its worktree, resolve (a squash-merged base means `git checkout --ours` on identical trees), run the suite, push, and tell him it is clean. Do not ask him to retry.

## 2. Pull and clean
```
cd ~/workspace/chunky-dad && git pull --ff-only origin main && git log --oneline -1
git worktree remove --force $SCRATCHPAD/wt-<name>
git branch -D <branch>
```
Worktrees under `~/.claude/jobs/*/tmp/` from older sessions stay unless he asks.

## 3. Restart the review server
The server (`tools/serve-results.js`, :8734) keeps the old code until restarted:
```
PID=$(pgrep -f "node tools/serve-results.js" | grep -v $$ | head -1); [ -n "$PID" ] && kill $PID && sleep 1
nohup node tools/serve-results.js > /dev/null 2>&1 &
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8734/review
```
(`pgrep` matches its own shell — hence the `grep -v $$`.)

## 4. Verify, when the change touches a run
The daily job is `com.chunky-dad.scraper-daily` at 05:15. Kick it only after a prompt or parser change he wants seen today: `launchctl kickstart -k gui/$(id -u)/com.chunky-dad.scraper-daily`. The log is `~/Library/Logs/chunky-dad-scraper/scheduled-run.out.log` — millions of lines; grep, never read whole. Check the new log line the change introduced (`🪑 FURNITURE`, `🎟️ ENRICH`, `👯 TWIN`, …) and the source ledger verdicts on `/metrics`.

## 5. Tell him in three lines
What is on main now, what was removed, what the next run will show. Then stop — the next thing is his call.

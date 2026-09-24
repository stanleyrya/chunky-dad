#!/usr/bin/env node
// ============================================================================
// PROMOTE APPROVED BARS — owner-decisions.json → data/bars/<city>.json
// (Node-only; never ships to the phone)
// ============================================================================
// The swipe deck (tools/serve-results.js /review) records a bar approval as
// a decision with the full candidate snapshot. Nothing at runtime reads that
// approval: bars data is curated, and the curated file is what the site and
// the scraper (via tools/generate-scraper-bars.js) consume. This CLI is the
// promotion step: every approved bar not yet in its city's file is appended
// with the curated shape, then the generator rewrites scripts/scraper-bars.js
// and data/scraper-bars.json. Idempotent — run it any time; commit the diff
// as a normal PR.
//
//   node tools/apply-bar-approvals.js            # promote + regenerate
//   node tools/apply-bar-approvals.js --dry-run  # print what would change
//   node tools/apply-bar-approvals.js --pr       # …and open a PR with the diff
//
// --pr is what the daily launchd job runs after the sweep (see
// tools/launchd/*.plist.template): approved bars become a PR on their own —
// the owner's only step is the merge. The branch is made in a throwaway
// worktree off origin/main so the primary checkout (the review server's
// working tree) is never switched; an open bar-approvals PR is updated in
// place (same branch), and nothing happens when there is nothing to promote.
//
// Shared dir: CHUNKY_SHARED_STORAGE_DIR, defaulting to the iCloud Scriptable
// tree (same default as the server and the launchd job).
// ============================================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const {
    resolveSharedRoot,
    getDecisionsPath,
    loadDecisions,
    loadCuratedBars
} = require('./review-queue');

function normalizeBarNameKey(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/^\s*the\s+/, '')
        .replace(/[^a-z0-9]/g, '');
}

function normalizeCityKey(value) {
    return String(value || '').trim().toLowerCase();
}

// Curated bar shape (see data/bars/<city>.json): identity, location, socials.
// Presentation keys (palette, favicon colours) are produced by other tools.
function buildCuratedBar(snapshot) {
    const bar = {
        name: String(snapshot.name || '').trim(),
        city: normalizeCityKey(snapshot.city),
        address: String(snapshot.address || '').trim(),
        coordinates: String(snapshot.coordinates || '').trim()
    };
    if (snapshot.website) bar.website = String(snapshot.website).trim();
    if (snapshot.instagram) bar.instagram = String(snapshot.instagram).trim();
    return bar;
}

// Pure: { additions: [{city, bar}], skipped: [{city, name, why}] }.
function planBarPromotions(store, curatedBars) {
    const additions = [];
    const skipped = [];
    const pendingByCity = {};
    for (const decision of (store && Array.isArray(store.decisions)) ? store.decisions : []) {
        if (!decision || decision.kind !== 'bar' || decision.verdict !== 'approve') continue;
        const snapshot = decision.snapshot && typeof decision.snapshot === 'object' ? decision.snapshot : null;
        if (!snapshot || !snapshot.name || !snapshot.city) {
            skipped.push({ city: snapshot ? snapshot.city : '', name: snapshot ? snapshot.name : decision.key, why: 'approval carries no name/city snapshot' });
            continue;
        }
        const bar = buildCuratedBar(snapshot);
        if (!bar.coordinates || !bar.address) {
            skipped.push({ city: bar.city, name: bar.name, why: 'candidate has no address or coordinates' });
            continue;
        }
        const existing = (curatedBars && curatedBars[bar.city]) || [];
        const nameKey = normalizeBarNameKey(bar.name);
        const alreadyCurated = existing.some((entry) => normalizeBarNameKey(entry && entry.name) === nameKey)
            || (pendingByCity[bar.city] || []).includes(nameKey);
        if (alreadyCurated) {
            skipped.push({ city: bar.city, name: bar.name, why: 'already in data/bars' });
            continue;
        }
        pendingByCity[bar.city] = (pendingByCity[bar.city] || []).concat(nameKey);
        additions.push({ city: bar.city, bar });
    }
    return { additions, skipped };
}

function writeAdditions(additions, root = repoRoot) {
    const byCity = {};
    for (const addition of additions) {
        byCity[addition.city] = (byCity[addition.city] || []).concat([addition.bar]);
    }
    const written = [];
    for (const city of Object.keys(byCity)) {
        const filePath = path.join(root, 'data', 'bars', `${city}.json`);
        let current = [];
        if (fs.existsSync(filePath)) {
            current = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (!Array.isArray(current)) throw new Error(`${filePath} is not a JSON array`);
        }
        const next = current.concat(byCity[city]);
        fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
        written.push({ city, filePath, added: byCity[city].length });
    }
    return written;
}

const PR_BRANCH = 'bar-approvals';

function git(args, cwd, opts = {}) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', ...opts });
    if (result.status !== 0 && !opts.allowFail) throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
    return (result.stdout || '').trim();
}

// Promote inside a fresh worktree off origin/main, commit, push, and open (or
// update) the bar-approvals PR. Returns the PR URL, or '' when nothing to do.
function promoteAsPullRequest(store) {
    const os = require('os');
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'bar-approvals-'));
    fs.rmdirSync(worktree);
    git(['fetch', '--quiet', 'origin', 'main'], repoRoot);
    const existing = git(['ls-remote', '--heads', 'origin', PR_BRANCH], repoRoot);
    git(['worktree', 'add', '--quiet', '-B', PR_BRANCH, worktree, existing ? `origin/${PR_BRANCH}` : 'origin/main'], repoRoot);
    try {
        if (existing) git(['merge', '--quiet', '--no-edit', 'origin/main'], worktree, { allowFail: true });
        // Re-plan against the worktree's own data: an earlier PR run may have
        // promoted some of these already.
        const { additions: fresh } = planBarPromotions(store, loadCuratedBars(worktree));
        if (fresh.length === 0) return '';
        writeAdditions(fresh, worktree);
        const generated = spawnSync(process.execPath, [path.join(worktree, 'tools', 'generate-scraper-bars.js')], { cwd: worktree, stdio: 'inherit' });
        if (generated.status !== 0) throw new Error('generate-scraper-bars.js failed in the worktree');
        git(['add', '-A'], worktree);
        if (!git(['status', '--porcelain'], worktree)) return '';
        const names = fresh.map((a) => `${a.bar.name} (${a.city})`).join(', ');
        git(['-c', 'user.name=chunky-dad review deck', '-c', 'user.email=review-deck@chunky.dad', 'commit', '--quiet', '-m', `Bars: promote ${fresh.length} approved on the review deck — ${names}`], worktree);
        git(['push', '--quiet', '-u', 'origin', PR_BRANCH], worktree);
        const open = spawnSync('gh', ['pr', 'list', '--head', PR_BRANCH, '--state', 'open', '--json', 'url', '--jq', '.[0].url'], { cwd: worktree, encoding: 'utf8' });
        const openUrl = (open.stdout || '').trim();
        if (openUrl) return openUrl;
        const created = spawnSync('gh', ['pr', 'create', '--head', PR_BRANCH, '--title', `Bars: ${fresh.length} approved on the review deck`, '--body', `Approved by swiping right on bar cards; promoted into data/bars/<city>.json by the daily job (tools/apply-bar-approvals.js --pr).\n\n${fresh.map((a) => `- ${a.bar.name} (${a.city}) — ${a.bar.address}`).join('\n')}\n\nThe Google Sheet sync keeps local additions (tools/sync-bars.js merges both), so the sheet need not change.`], { cwd: worktree, encoding: 'utf8' });
        if (created.status !== 0) throw new Error(`gh pr create failed: ${(created.stderr || '').trim()}`);
        return (created.stdout || '').trim();
    } finally {
        git(['worktree', 'remove', '--force', worktree], repoRoot, { allowFail: true });
    }
}

function main(argv) {
    const dryRun = argv.includes('--dry-run');
    const asPr = argv.includes('--pr');
    const sharedRoot = resolveSharedRoot();
    const decisionsPath = getDecisionsPath(sharedRoot);
    const store = loadDecisions(decisionsPath);
    const curated = loadCuratedBars(repoRoot);
    const { additions, skipped } = planBarPromotions(store, curated);

    console.log(`Owner decisions: ${decisionsPath}`);
    for (const entry of skipped) {
        console.log(`  · skip ${entry.name || '(unnamed)'} (${entry.city || '?'}) — ${entry.why}`);
    }
    if (additions.length === 0) {
        console.log('Nothing to promote.');
        return 0;
    }
    for (const addition of additions) {
        console.log(`  + ${addition.bar.name} (${addition.city}) — ${addition.bar.address} @ ${addition.bar.coordinates}`);
    }
    if (dryRun) {
        console.log(`Dry run: ${additions.length} bar(s) would be appended to data/bars/.`);
        return 0;
    }
    if (asPr) {
        const url = promoteAsPullRequest(store);
        console.log(url ? `Opened/updated PR: ${url}` : 'Nothing new for the PR (already promoted on the branch).');
        return 0;
    }
    const written = writeAdditions(additions, repoRoot);
    for (const entry of written) {
        console.log(`Wrote ${entry.added} bar(s) → ${path.relative(repoRoot, entry.filePath)}`);
    }
    const generated = spawnSync(process.execPath, [path.join(repoRoot, 'tools', 'generate-scraper-bars.js')], {
        cwd: repoRoot,
        stdio: 'inherit'
    });
    if (generated.status !== 0) {
        console.error('generate-scraper-bars.js failed — data/bars is updated, the generated scraper copy is not.');
        return generated.status || 1;
    }
    console.log('Done. Review the diff and open a PR.');
    return 0;
}

module.exports = { planBarPromotions, buildCuratedBar, writeAdditions, normalizeBarNameKey };

if (require.main === module) {
    process.exitCode = main(process.argv.slice(2));
}

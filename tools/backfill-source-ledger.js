#!/usr/bin/env node
// Rebuild metrics/sources.ndjson + metrics/source-upcoming.json from the
// saved runs on disk (runs/ and archive/runs/), oldest first, one pass of
// SharedCore.buildSourceLedger per run with "now" = that run's own time —
// so "upcoming" and "vanished" mean what they meant on the day.
//
// The ledger is DERIVED data: every run also appends its own lines, and
// this tool only exists to seed history (and to re-derive after a schema
// change). It never touches runs, logs or the old metrics files.
//
//   node tools/backfill-source-ledger.js            # the shared iCloud folder
//   node tools/backfill-source-ledger.js --dry-run  # print, write nothing
//   CHUNKY_SHARED_STORAGE_DIR=/path node tools/backfill-source-ledger.js
'use strict';

const fs = require('fs');
const path = require('path');
const { SharedCore } = require('../scripts/shared-core');
const { resolveSharedRoot } = require('./review-queue');

function listRunFiles(sharedRoot) {
    // archive first, runs/ second: the live copy overrides an archived twin
    const dirs = [path.join(sharedRoot, 'archive', 'runs'), path.join(sharedRoot, 'runs')];
    const seen = new Map();
    dirs.forEach((dir) => {
        let names = [];
        try { names = fs.readdirSync(dir); } catch (_) { return; }
        names.filter((name) => /^\d{8}-\d{6}\.json$/.test(name)).forEach((name) => {
            seen.set(name.slice(0, -5), path.join(dir, name));
        });
    });
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function backfill(sharedRoot, { dryRun = false, log = console.log } = {}) {
    const files = listRunFiles(sharedRoot);
    let upcoming = null;
    const lines = [];
    const perRun = [];
    files.forEach(([runId, file]) => {
        let payload;
        try {
            payload = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (error) {
            log(`skip ${runId}: ${error.message}`);
            return;
        }
        const finishedAt = (payload.summary && payload.summary.timestamp) || null;
        const now = finishedAt ? new Date(finishedAt) : new Date(
            `${runId.slice(0, 4)}-${runId.slice(4, 6)}-${runId.slice(6, 8)}T${runId.slice(9, 11)}:${runId.slice(11, 13)}:${runId.slice(13, 15)}Z`
        );
        const built = SharedCore.buildSourceLedger(payload, { runId, previousUpcoming: upcoming, now, finishedAt: finishedAt || now.toISOString() });
        upcoming = built.upcoming;
        built.records.forEach((record) => lines.push(JSON.stringify(record)));
        const trouble = built.records.filter((record) => record.status !== 'ok' || record.vanished.length > 0);
        perRun.push({ runId, hosts: built.records.length, trouble: trouble.length });
        log(`${runId}: ${built.records.length} host line(s)${trouble.length ? ` — trouble: ${trouble.map((r) => `${r.host}(${r.status}${r.vanished.length ? `, ${r.vanished.length} vanished` : ''})`).join(', ')}` : ''}`);
    });
    if (!dryRun && lines.length) {
        const metricsDir = path.join(sharedRoot, 'metrics');
        fs.mkdirSync(metricsDir, { recursive: true });
        const ledgerPath = path.join(metricsDir, 'sources.ndjson');
        const upcomingPath = path.join(metricsDir, 'source-upcoming.json');
        fs.writeFileSync(`${ledgerPath}.tmp`, `${lines.join('\n')}\n`, 'utf8');
        fs.renameSync(`${ledgerPath}.tmp`, ledgerPath);
        fs.writeFileSync(`${upcomingPath}.tmp`, JSON.stringify(upcoming), 'utf8');
        fs.renameSync(`${upcomingPath}.tmp`, upcomingPath);
        log(`wrote ${lines.length} line(s) from ${perRun.length} run(s) → ${ledgerPath}`);
    }
    return { runs: perRun, lines: lines.length, upcoming };
}

if (require.main === module) {
    const dryRun = process.argv.includes('--dry-run');
    const sharedRoot = resolveSharedRoot();
    backfill(sharedRoot, { dryRun });
}

module.exports = { backfill, listRunFiles };

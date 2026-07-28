#!/usr/bin/env node
// ============================================================================
// RUN-ONCE PIPELINE RUNNER (Node-only; never ships to the phone)
// ============================================================================
// Child-process entry point used by tools/serve-results.js: drives the real
// scraper pipeline programmatically (the same orchestrator `node
// scripts/bear-event-scraper-unified.js` runs) and persists the results JSON
// so the parent server can render them with the Scriptable results UI.
//
// Design constraints honored here:
// - scripts/scraper-input.js and the shared scripts/ files are NEVER edited.
//   Configuration injection happens by wrapping WebAdapter.prototype
//   .loadConfiguration in THIS process only (require-cache shared with the
//   orchestrator's own require of web-adapter).
// - dryRun is FORCED on: v1 of the server is report-only, no calendar writes.
// - This file must be run in a CHILD process, never required by the server:
//   the orchestrator/pipeline expects clean globals (no Scriptable stubs),
//   and the server parent installs Scriptable stubs for rendering.
//
// Env contract (all optional):
//   CHUNKY_RUN_PARSER    — run only the parser with this exact name
//   CHUNKY_RUN_OUT       — output JSON path
//                          (default ~/.chunky-dad-scraper/server/latest-run.json)
//   CHUNKY_RUN_OVERRIDES — JSON deep-merged into the loaded config AFTER the
//                          dryRun/parser-filter safety overrides (objects merge
//                          key-wise, arrays/scalars replace). Used by the smoke
//                          test to point parsers/AI at local fixture servers.
//                          NOTE: config.config.dryRun is re-forced to true
//                          after the merge — overrides cannot disable it.
// ============================================================================

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

// Plain-object deep merge: objects merge key-wise, arrays and scalars replace.
function deepMergeInto(target, source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        return target;
    }
    for (const [key, value] of Object.entries(source)) {
        const existing = target[key];
        if (
            value && typeof value === 'object' && !Array.isArray(value) &&
            existing && typeof existing === 'object' && !Array.isArray(existing)
        ) {
            deepMergeInto(existing, value);
        } else {
            target[key] = value;
        }
    }
    return target;
}

// Circular-safe JSON.stringify (results objects are large and occasionally
// self-referential; a dropped "[Circular]" branch beats a crashed dump).
function safeStringify(value) {
    const seen = new WeakSet();
    return JSON.stringify(value, (key, val) => {
        if (val && typeof val === 'object') {
            if (seen.has(val)) return '[Circular]';
            seen.add(val);
        }
        return val;
    });
}

// ---------------------------------------------------------------------------
// Config injection: wrap the Node loadConfiguration path. The orchestrator's
// own `require('./adapters/web-adapter')` returns this same patched module.
// ---------------------------------------------------------------------------
const { WebAdapter } = require(path.join(repoRoot, 'scripts', 'adapters', 'web-adapter'));
const originalLoadConfiguration = WebAdapter.prototype.loadConfiguration;

WebAdapter.prototype.loadConfiguration = async function patchedLoadConfiguration(...args) {
    const config = await originalLoadConfiguration.apply(this, args);
    config.config = config.config || {};

    // Test/smoke overrides FIRST (fixture URLs, stub AI endpoint, cache
    // toggles) — they may replace the parsers array, and the parser filter
    // below must see the final list.
    const overridesRaw = String(process.env.CHUNKY_RUN_OVERRIDES || '').trim();
    if (overridesRaw) {
        deepMergeInto(config, JSON.parse(overridesRaw));
    }

    // Parser filter: run exactly the named parser (even if disabled in the
    // checked-in config — picking it in the UI is an explicit request).
    const parserFilter = String(process.env.CHUNKY_RUN_PARSER || '').trim();
    if (parserFilter && Array.isArray(config.parsers)) {
        config.parsers = config.parsers.map((parser) => ({
            ...parser,
            enabled: parser && parser.name === parserFilter
        }));
        const matched = config.parsers.some((parser) => parser.enabled);
        if (!matched) {
            throw new Error(`run-once: no parser named "${parserFilter}" in the configuration`);
        }
    }

    // SAFETY LAST: v1 server runs are report-only, no calendar writes —
    // forced after the override merge so nothing can switch it back off.
    config.config.dryRun = true;

    return config;
};

// Safe to require AFTER the patch above: the orchestrator only auto-executes
// when it is the require.main module (here, run-once.js is).
const { BearEventScraperOrchestrator } = require(
    path.join(repoRoot, 'scripts', 'bear-event-scraper-unified')
);

(async () => {
    const startedAt = new Date().toISOString();
    const parserFilter = String(process.env.CHUNKY_RUN_PARSER || '').trim();
    console.log(`run-once: starting pipeline (dryRun forced)${parserFilter ? ` — parser filter: ${parserFilter}` : ''}`);

    const orchestrator = new BearEventScraperOrchestrator();
    const results = await orchestrator.run();

    const outPath = process.env.CHUNKY_RUN_OUT ||
        path.join(os.homedir(), '.chunky-dad-scraper', 'server', 'latest-run.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    const payload = {
        savedAt: new Date().toISOString(),
        startedAt,
        parserFilter,
        results
    };
    // Write-then-rename so the parent never reads a half-written dump.
    const tmpPath = `${outPath}.tmp`;
    fs.writeFileSync(tmpPath, safeStringify(payload));
    fs.renameSync(tmpPath, outPath);
    console.log(`run-once: results written to ${outPath}`);
})().catch((error) => {
    console.error(`run-once: pipeline failed: ${error && error.stack ? error.stack : error}`);
    process.exitCode = 1;
});

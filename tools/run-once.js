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
//   The phone remains the ONLY calendar writer.
// - This file must be run in a CHILD process, never required by the server:
//   the orchestrator/pipeline expects clean globals (no Scriptable stubs),
//   and the server parent installs Scriptable stubs for rendering.
//   (Requiring it for its exported helpers is safe — execution and the
//   prototype patch only happen when run-once is the main module.)
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
//   CHUNKY_SHARED_STORAGE_DIR
//                        — opt-in shared Mac↔phone storage root: the phone's
//                          `chunky-dad-scraper` tree (the directory containing
//                          storage/, runs/ and logs/). Page/OCR/AI caches then
//                          read+write the phone's entries, and this run's JSON
//                          and log are ALSO written into the shared runs/ and
//                          logs/ dirs with the phone's YYYYMMDD-HHMMSS naming.
//                          If the root is unreachable the run ABORTS LOUDLY at
//                          startup — never a silent local-cache fallback
//                          (no-partial-runs doctrine). Retention pruning is
//                          never performed here: the phone owns deletion.
//   CHUNKY_RUN_AUTOMATION — truthy ("1"/"true"/"yes") marks this run as an
//                          automation run, exactly like the phone's scheduled
//                          runs: config.runtime.automationRun is stamped so
//                          SharedCore.resolveAutomationContext applies the
//                          per-parser automationEnabled filter (parsers with
//                          automationEnabled: false are skipped). Used by
//                          tools/schedule-mac-run.sh.
//   CHUNKY_SHARED_MATERIALIZE_CEILING_MS
//                        — upper bound (ms) for the shared-root dataless-file
//                          materialization sweep at startup (default 15 min).
//                          macOS evicts iCloud files to dataless stubs, and
//                          ANY fs syscall against a stub can wedge a libuv
//                          threadpool thread in the kernel forever (the
//                          2026-08 scheduled run hung 22+ minutes this way),
//                          so before parser work the sweep force-downloads
//                          every evicted file (`brctl download`) and polls
//                          `find -flags +dataless` until the tree is clean.
//                          Ceiling breach ABORTS LOUDLY (no-partial-runs).
//   UV_THREADPOOL_SIZE   — defaulted to 16 below (and set explicitly in the
//                          launchd plist template): JS-side timeouts cannot
//                          cancel a wedged syscall, so each one leaks a
//                          threadpool slot; with the default pool of 4, four
//                          leaks starve every later fs/dns call.
// ============================================================================

'use strict';

// Threadpool headroom FIRST, before anything can touch the async fs pool:
// libuv reads UV_THREADPOOL_SIZE lazily at first threadpool use, so setting
// it at entry works for direct `node tools/run-once.js` invocations too (the
// launchd plist also sets it for scheduled runs — belt and braces).
ensureThreadpoolHeadroom(process.env);

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

// Default UV_THREADPOOL_SIZE to 16 unless the caller already chose a value.
// Hoisted function declaration so the entry-point call above can run before
// the requires. Returns the effective value for observability/tests.
function ensureThreadpoolHeadroom(env) {
    if (!env || typeof env !== 'object') return null;
    if (!String(env.UV_THREADPOOL_SIZE || '').trim()) {
        env.UV_THREADPOOL_SIZE = '16';
    }
    return env.UV_THREADPOOL_SIZE;
}

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

// Truthy CHUNKY_RUN_AUTOMATION values (same set WebAdapter accepts).
function isAutomationEnv(env) {
    const raw = String((env && env.CHUNKY_RUN_AUTOMATION) || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
}

// ---------------------------------------------------------------------------
// Config shaping applied on top of the loaded configuration. Order matters:
// 1. CHUNKY_RUN_OVERRIDES first (may replace the parsers array),
// 2. CHUNKY_RUN_PARSER exact-name filter over the FINAL parser list,
// 3. CHUNKY_RUN_AUTOMATION stamps config.runtime.automationRun so the
//    shared-core automation filter (per-parser automationEnabled) applies —
//    the scheduled Mac run behaves like the phone's automation runs,
// 4. SAFETY LAST: dryRun re-forced true — nothing can switch it back off.
// ---------------------------------------------------------------------------
function shapeRunOnceConfig(config, env = process.env) {
    config.config = config.config || {};

    const overridesRaw = String((env && env.CHUNKY_RUN_OVERRIDES) || '').trim();
    if (overridesRaw) {
        deepMergeInto(config, JSON.parse(overridesRaw));
    }

    // Parser filter: run exactly the named parser (even if disabled in the
    // checked-in config — picking it in the UI is an explicit request).
    const parserFilter = String((env && env.CHUNKY_RUN_PARSER) || '').trim();
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

    if (isAutomationEnv(env)) {
        config.runtime = (config.runtime && typeof config.runtime === 'object')
            ? config.runtime
            : {};
        config.runtime.automationRun = true;
    }

    // SAFETY LAST: v1 server runs are report-only, no calendar writes —
    // forced after the override merge so nothing can switch it back off.
    config.config.dryRun = true;

    return config;
}

// ---------------------------------------------------------------------------
// Shared-storage preflight (NO PARTIAL RUNS). When the shared root env is
// set, the root and its phone-created storage/ subtree must already exist —
// otherwise abort BEFORE the pipeline starts. Never mkdir here: creating the
// tree while iCloud is signed out (or at a mistyped path) would fork a local
// orphan whose later sync writes confusing state into the real cache.
// ---------------------------------------------------------------------------
function assertSharedStorageRootUsable(env = process.env, fsLike = fs) {
    const sharedRoot = String((env && env.CHUNKY_SHARED_STORAGE_DIR) || '').trim();
    if (!sharedRoot) return null;
    const isDir = (p) => {
        try {
            return fsLike.statSync(p).isDirectory();
        } catch (_) {
            return false;
        }
    };
    if (!isDir(sharedRoot)) {
        throw new Error(`run-once: shared storage root unreachable: ${sharedRoot} does not exist or is not a directory (iCloud signed out? wrong path?) — ABORTING instead of silently falling back to the local cache`);
    }
    if (!isDir(path.join(sharedRoot, 'storage'))) {
        throw new Error(`run-once: shared storage root ${sharedRoot} has no storage/ subtree — expected the phone's chunky-dad-scraper directory (did you point at .../Documents instead of .../Documents/chunky-dad-scraper?) — ABORTING`);
    }
    return sharedRoot;
}

// ---------------------------------------------------------------------------
// Shared-root MATERIALIZATION sweep (defense #1 against dataless iCloud
// stubs). macOS evicts synced files to dataless placeholders; ANY fs syscall
// against one (open/read/stat/rename/unlink) can block in the kernel until
// fileproviderd materializes it — or forever when fileproviderd wedges, as it
// did on the first scheduled run (two libuv threads sampled stuck 22+ minutes
// in open() and rename()). JS-side promise timeouts cannot cancel those
// syscalls, so the ONLY safe order is: download everything FIRST, then run.
//
// Detection deliberately never opens the files: `find -type f -flags
// +dataless` reads only directory entries + inode flags. `brctl download`
// asks fileproviderd to materialize the tree; the poll then watches the
// dataless count fall to 0. Ceiling breach ABORTS LOUDLY (no-partial-runs: a
// run that would wedge or silently miss shared cache entries must not limp).
// Non-macOS, or find/brctl unavailable → sweep skipped (feature is Mac-only
// in practice; the bounded fs ops in web-adapter remain as last defense).
// ---------------------------------------------------------------------------
const MATERIALIZE_CEILING_DEFAULT_MS = 15 * 60 * 1000;
const MATERIALIZE_POLL_INTERVAL_MS = 30 * 1000;

function resolveMaterializeCeilingMs(env = process.env) {
    const raw = Number(String((env && env.CHUNKY_SHARED_MATERIALIZE_CEILING_MS) || '').trim());
    return Number.isFinite(raw) && raw > 0 ? raw : MATERIALIZE_CEILING_DEFAULT_MS;
}

// Count dataless files under root without opening any of them.
// Returns a number, or null when the probe is unavailable (non-macOS find,
// missing binary) — null means "cannot sweep", never "zero".
function countDatalessFilesViaFind(root) {
    try {
        const result = childProcess.spawnSync(
            '/usr/bin/find',
            [root, '-type', 'f', '-flags', '+dataless'],
            { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
        );
        if (result.error || result.status !== 0 || typeof result.stdout !== 'string') {
            return null;
        }
        return result.stdout.split('\n').filter(Boolean).length;
    } catch (_) {
        return null;
    }
}

// Ask fileproviderd to materialize the whole tree. Returns false when brctl
// is unavailable/failed (caller skips the sweep instead of polling forever).
function kickDatalessDownloadViaBrctl(root) {
    try {
        const result = childProcess.spawnSync('/usr/bin/brctl', ['download', root], { encoding: 'utf8' });
        return !result.error && result.status === 0;
    } catch (_) {
        return false;
    }
}

async function materializeSharedStorageTree(sharedRoot, options = {}) {
    const {
        platform = process.platform,
        countDataless = countDatalessFilesViaFind,
        kickDownload = kickDatalessDownloadViaBrctl,
        ceilingMs = resolveMaterializeCeilingMs(process.env),
        pollIntervalMs = MATERIALIZE_POLL_INTERVAL_MS,
        sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now = Date.now,
        log = console.log
    } = options;

    if (!sharedRoot) return { skipped: 'no-shared-root' };
    if (platform !== 'darwin') {
        log(`run-once: dataless materialization sweep skipped (platform ${platform} — the shared iCloud root is Mac-only in practice)`);
        return { skipped: 'non-macos' };
    }
    const initialCount = countDataless(sharedRoot);
    if (initialCount === null) {
        log('run-once: dataless materialization sweep skipped (find -flags probe unavailable) — bounded fs ops remain the only dataless defense this run');
        return { skipped: 'probe-unavailable' };
    }
    if (initialCount === 0) {
        log('run-once: shared storage tree fully materialized (0 dataless files) — safe to start parser work');
        return { datalessAtStart: 0, waitedMs: 0 };
    }
    log(`run-once: ${initialCount} dataless (evicted) file(s) under ${sharedRoot} — kicking iCloud download BEFORE parser work (touching a stub mid-run wedges libuv threadpool slots at syscall level)`);
    if (!kickDownload(sharedRoot)) {
        log('run-once: dataless materialization sweep skipped (brctl download unavailable/failed) — bounded fs ops remain the only dataless defense this run');
        return { skipped: 'brctl-unavailable' };
    }
    const startedAt = now();
    let count = initialCount;
    while (count > 0) {
        if (now() - startedAt >= ceilingMs) {
            throw new Error(`run-once: shared storage tree still has ${count} dataless file(s) after ${Math.round(ceilingMs / 1000)}s — ABORTING (no-partial-runs: proceeding would wedge fs syscalls or miss shared cache entries). One-time fix: right-click the chunky-dad-scraper folder in Finder and choose "Keep Downloaded" so iCloud never evicts it; or re-run once the download finishes.`);
        }
        await sleep(pollIntervalMs);
        count = countDataless(sharedRoot);
        if (count === null) {
            throw new Error('run-once: dataless probe (find -flags +dataless) broke mid-sweep — ABORTING instead of guessing the tree is materialized (no-partial-runs)');
        }
        log(`run-once: materialization progress — ${count} dataless file(s) remaining under the shared root`);
    }
    const waitedMs = now() - startedAt;
    log(`run-once: shared storage tree fully materialized after ${Math.round(waitedMs / 1000)}s (${initialCount} file(s) downloaded) — safe to start parser work`);
    return { datalessAtStart: initialCount, waitedMs };
}

// Scope wrapper around the sweep. The BLOCKING sweep covers only what a run
// actually READS — the storage/ cache tree — because blocking on the whole
// root wedged a real run (2026-08-13) on five phone LOG files whose content
// had not yet UPLOADED from the phone: iCloud had the metadata, the bytes
// were still on the device, so no amount of Mac-side downloading could ever
// drain the count and the sweep rode the ceiling into a pointless abort.
// logs/ and runs/ are write-only for a Mac run (new filenames, atomic
// writes), and the small root-level state files fail soft through the
// bounded fs ops — dataless files there are reported as an ADVISORY line,
// never a blocker.
async function sweepSharedStorageBeforeRun(sharedRoot, options = {}) {
    const {
        joinPath = (a, b) => path.join(a, b),
        countDataless = countDatalessFilesViaFind,
        log = console.log
    } = options;
    if (!sharedRoot) return { skipped: 'no-shared-root' };
    const blockingRoot = joinPath(sharedRoot, 'storage');
    const result = await materializeSharedStorageTree(blockingRoot, { ...options, countDataless, log });
    const totalCount = countDataless(sharedRoot);
    if (typeof totalCount === 'number' && totalCount > 0) {
        log(`run-once: ${totalCount} dataless file(s) remain OUTSIDE the storage/ cache tree (logs/runs — typically content still uploading from the phone) — not needed by this run, continuing`);
    }
    return result;
}

// Tee console output into a buffer (still printed) so shared-storage runs can
// persist a per-run log file the way the phone's FileLogger does.
function installConsoleTee(lines) {
    const wrap = (level, original) => (...args) => {
        try {
            lines.push(args.map((arg) => {
                if (typeof arg === 'string') return arg;
                try {
                    return JSON.stringify(arg);
                } catch (_) {
                    return String(arg);
                }
            }).join(' '));
        } catch (_) { /* the tee must never break the run */ }
        original.apply(console, args);
    };
    console.log = wrap('log', console.log);
    console.warn = wrap('warn', console.warn);
    console.error = wrap('error', console.error);
}

// ---------------------------------------------------------------------------
// Config injection: wrap the Node loadConfiguration path. The orchestrator's
// own `require('./adapters/web-adapter')` returns this same patched module.
// Only applied when run-once IS the process entry point — requiring this file
// for its helpers must not mutate WebAdapter for the requiring process.
// ---------------------------------------------------------------------------
function patchLoadConfiguration(WebAdapter) {
    const originalLoadConfiguration = WebAdapter.prototype.loadConfiguration;
    WebAdapter.prototype.loadConfiguration = async function patchedLoadConfiguration(...args) {
        const config = await originalLoadConfiguration.apply(this, args);
        return shapeRunOnceConfig(config, process.env);
    };
}

async function main() {
    // Abort loudly BEFORE any module of the pipeline runs (the WebAdapter
    // constructor re-checks this — belt and suspenders).
    const sharedRoot = assertSharedStorageRootUsable(process.env, fs);

    const logLines = [];
    if (sharedRoot) {
        installConsoleTee(logLines);
        // Defense #1 (dataless iCloud stubs): download every evicted file
        // BEFORE any parser work. A ceiling breach throws — abort loudly to
        // launchd's err log rather than start a run that would wedge.
        await sweepSharedStorageBeforeRun(sharedRoot);
    }

    const { WebAdapter } = require(path.join(repoRoot, 'scripts', 'adapters', 'web-adapter'));
    patchLoadConfiguration(WebAdapter);

    // Safe to require AFTER the patch above: the orchestrator only
    // auto-executes when it is the require.main module (here, run-once.js is).
    const { BearEventScraperOrchestrator } = require(
        path.join(repoRoot, 'scripts', 'bear-event-scraper-unified')
    );

    const startedAt = new Date().toISOString();
    const parserFilter = String(process.env.CHUNKY_RUN_PARSER || '').trim();
    const automationRun = isAutomationEnv(process.env);
    console.log(`run-once: starting pipeline (dryRun forced)${parserFilter ? ` — parser filter: ${parserFilter}` : ''}${automationRun ? ' — automation run (automationEnabled parser filter applies)' : ''}`);
    if (sharedRoot) {
        console.log(`run-once: shared storage root ${sharedRoot} — caches, run JSON and log are shared with the phone; retention pruning deferred to the cache owner (the phone)`);
    }

    const orchestrator = new BearEventScraperOrchestrator();
    let results;
    try {
        results = await orchestrator.run();
    } catch (error) {
        // A failed shared-storage run still writes its log — that log is the
        // only evidence of what went wrong (mirrors the phone's pre-UI log
        // persistence). The run JSON is deliberately NOT written.
        if (sharedRoot) {
            try {
                const adapter = new WebAdapter({});
                await adapter.saveRunToSharedStorage(null, {
                    logText: logLines.join('\n'),
                    failure: error && error.message ? error.message : String(error)
                });
            } catch (_) { /* the failure below is the primary signal */ }
        }
        throw error;
    }

    // Shared save FIRST (the Node analog of the phone's save-before-UI
    // ordering: persist before the parent server renders/publishes anything).
    if (sharedRoot) {
        const adapter = new WebAdapter({});
        await adapter.saveRunToSharedStorage(results, { logText: logLines.join('\n') });
    }

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
}

if (require.main === module) {
    main().catch((error) => {
        console.error(`run-once: pipeline failed: ${error && error.stack ? error.stack : error}`);
        process.exitCode = 1;
    });
}

module.exports = {
    deepMergeInto,
    safeStringify,
    isAutomationEnv,
    shapeRunOnceConfig,
    assertSharedStorageRootUsable,
    installConsoleTee,
    ensureThreadpoolHeadroom,
    resolveMaterializeCeilingMs,
    sweepSharedStorageBeforeRun,
    materializeSharedStorageTree
};

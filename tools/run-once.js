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
    // checked-in config — picking it in the UI is an explicit request). The
    // list itself is narrowed, not flagged: `enabled` is a manual-run knob
    // that automation runs ignore by design (shared-core honours it only
    // when automation is NOT filtering), so an automation run with a parser
    // filter used to run every parser anyway (run 20260910, all 23 under
    // CHUNKY_RUN_PARSER=Furball). An explicit pick also runs regardless of
    // its automationEnabled flag, for the same reason.
    const parserFilter = String((env && env.CHUNKY_RUN_PARSER) || '').trim();
    if (parserFilter && Array.isArray(config.parsers)) {
        const matched = config.parsers.filter((parser) => parser && parser.name === parserFilter);
        if (matched.length === 0) {
            throw new Error(`run-once: no parser named "${parserFilter}" in the configuration`);
        }
        config.parsers = matched.map((parser) => {
            const picked = { ...parser, enabled: true };
            delete picked.automationEnabled;
            return picked;
        });
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
    // Stall detection: a count that stops FALLING is not "evicted, still
    // downloading" — it is content that does not exist in iCloud yet (bytes
    // pending UPLOAD from the phone; 2026-08-15 05:15 run: 108 fresh cache
    // entries from the phone's evening runs sat undrainable and the sweep
    // rode the 15-min ceiling into a pointless abort). Those files are
    // unreadable no matter how long we wait, and the bounded fs ops treat
    // each as a cache miss (a refetch, not a degraded run) with
    // UV_THREADPOOL_SIZE headroom absorbing any wedged slots — so after
    // STALL_POLLS unchanged polls we PROCEED with a loud warning instead of
    // aborting. A still-falling count keeps waiting (genuine downloads), and
    // the ceiling abort remains for that path.
    const STALL_POLLS = 4;
    let unchangedPolls = 0;
    while (count > 0) {
        if (now() - startedAt >= ceilingMs) {
            throw new Error(`run-once: shared storage tree still has ${count} dataless file(s) after ${Math.round(ceilingMs / 1000)}s — ABORTING (no-partial-runs: proceeding would wedge fs syscalls or miss shared cache entries). One-time fix: right-click the chunky-dad-scraper folder in Finder and choose "Keep Downloaded" so iCloud never evicts it; or re-run once the download finishes.`);
        }
        await sleep(pollIntervalMs);
        const nextCount = countDataless(sharedRoot);
        if (nextCount === null) {
            throw new Error('run-once: dataless probe (find -flags +dataless) broke mid-sweep — ABORTING instead of guessing the tree is materialized (no-partial-runs)');
        }
        unchangedPolls = nextCount >= count ? unchangedPolls + 1 : 0;
        count = nextCount;
        log(`run-once: materialization progress — ${count} dataless file(s) remaining under the shared root`);
        if (unchangedPolls >= STALL_POLLS) {
            log(`run-once: ${count} dataless file(s) have not drained across ${STALL_POLLS} polls — content likely pending UPLOAD from another device (undrainable from this Mac). Proceeding with bounded fs ops as the defense; each such entry reads as a cache miss.`);
            return { datalessAtStart: initialCount, waitedMs: now() - startedAt, undrainable: count };
        }
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
// persist a per-run log file the way the phone's FileLogger does. Every line
// printed gets a clock prefix (the launchd log had none, and a stalled run
// could not be timed) and bumps the stall guard's heartbeat.
const runPulse = { lastOutputAt: Date.now(), lastLine: '' };
function clockPrefix(now = new Date()) {
    const two = (n) => String(n).padStart(2, '0');
    return `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
}
function installConsoleTee(lines) {
    const wrap = (level, original) => (...args) => {
        try {
            runPulse.lastOutputAt = Date.now();
            runPulse.lastLine = typeof args[0] === 'string' ? args[0].slice(0, 200) : '';
            lines.push(args.map((arg) => {
                if (typeof arg === 'string') return arg;
                try {
                    return JSON.stringify(arg);
                } catch (_) {
                    return String(arg);
                }
            }).join(' '));
        } catch (_) { /* the tee must never break the run */ }
        original.apply(console, typeof args[0] === 'string' ? [`${clockPrefix()} ${args[0]}`, ...args.slice(1)] : args);
    };
    console.log = wrap('log', console.log);
    console.warn = wrap('warn', console.warn);
    console.error = wrap('error', console.error);
}

// THE STALL GUARD. A run that goes quiet is a run that is stuck: on
// 2026-10-09 the daily run sat 9½ hours after "Sending AI request
// (ocr-all pass)" — 0% CPU, no sockets, no page fetched, no AI answer, no
// log line — and nothing ended it. Every request in the run already has
// its own timeout, so silence this long is a wait on something that will
// never answer. After STALL_AFTER_MS without a printed line the run is
// failed loudly (its log is saved like any failed run, with the last line
// and what the process was waiting on) and the process exits; the daily
// job then reports a failed run instead of a silence, and the owner re-runs
// (see memory: no partial runs). CHUNKY_RUN_STALL_MINUTES overrides.
const STALL_AFTER_MS = Math.max(5, Number(process.env.CHUNKY_RUN_STALL_MINUTES) || 20) * 60 * 1000;
function describeActiveResources() {
    try {
        const counts = {};
        for (const kind of process.getActiveResourcesInfo()) counts[kind] = (counts[kind] || 0) + 1;
        return Object.entries(counts).map(([kind, n]) => `${kind}×${n}`).join(', ') || 'none';
    } catch (_) {
        return 'unknown';
    }
}
function stallGuard(work, options = {}) {
    const afterMs = Number.isFinite(options.afterMs) ? options.afterMs : STALL_AFTER_MS;
    const everyMs = Number.isFinite(options.everyMs) ? options.everyMs : Math.min(60000, afterMs);
    const pulse = options.pulse || runPulse;
    let timer = null;
    const stalled = new Promise((_, reject) => {
        timer = setInterval(() => {
            const quietMs = Date.now() - pulse.lastOutputAt;
            if (quietMs < afterMs) return;
            const error = new Error(`STALL: no output for ${Math.round(quietMs / 60000)} min — last line: ${pulse.lastLine || '(none)'} — waiting on: ${describeActiveResources()}`);
            error.stall = true;
            reject(error);
        }, everyMs);
        if (timer && typeof timer.unref === 'function') timer.unref();
    });
    return Promise.race([work, stalled]).finally(() => clearInterval(timer));
}

// ---------------------------------------------------------------------------
// Config injection: wrap the Node loadConfiguration path. The orchestrator's
// own `require('./adapters/web-adapter')` returns this same patched module.
// Only applied when run-once IS the process entry point — requiring this file
// for its helpers must not mutate WebAdapter for the requiring process.
// ---------------------------------------------------------------------------
// What the inbox's screenshot crop needs from the run's config: a core to
// talk to the AI with, and the OCR (vision) server block. Nothing when the
// config lacks either — the pictures then stay as they are.
function buildSharedPagesOptions(config) {
    try {
        const ocrConfig = config && config.config && config.config.ocr && typeof config.config.ocr === 'object' ? config.config.ocr : null;
        if (!ocrConfig || ocrConfig.enabled === false || !ocrConfig.endpoint) return {};
        const { SharedCore } = require('../scripts/shared-core');
        const { EventSchema } = require('../scripts/event-schema');
        return { core: new SharedCore(config.cities || {}, { eventSchema: EventSchema }), ocrConfig };
    } catch (error) {
        console.log(`run-once: 📨 screenshot crop unavailable (${error.message}) — inbox pictures stay as they are`);
        return {};
    }
}

function patchLoadConfiguration(WebAdapter) {
    const originalLoadConfiguration = WebAdapter.prototype.loadConfiguration;
    WebAdapter.prototype.loadConfiguration = async function patchedLoadConfiguration(...args) {
        const config = await originalLoadConfiguration.apply(this, args);
        // The inbox's parser joins the list BEFORE the parser filter is applied,
        // so CHUNKY_RUN_PARSER="Shared pages" can run it alone.
        await addSharedPagesParser(config, this, process.env, fs, buildSharedPagesOptions(config));
        return shapeRunOnceConfig(config, process.env);
    };
}

// ---------------------------------------------------------------------------
// THE SHARED INBOX (one folder, sorted by file type). Anything the owner
// drops into iCloud/Scriptable/chunky-dad-scraper/inbox/ from the phone —
// Files › Save, the share sheet, the "Send to chunky.dad" shortcut — is
// read by the next Mac run, by what the file is:
//   *.json           { url, html, title, savedAt } — a page saved from a
//                    logged-in tab (Instagram, Facebook events, anything
//                    behind his login): written into the SHARED page cache
//                    under its own URL, so the run reads it as a cache hit.
//   *.html / *.htm   a saved page; its URL is the page's canonical / og:url
//                    link, else an inbox address of its own.
//   *.png *.jpg *.jpeg *.webp *.gif *.heic *.heif
//                    a flyer or a screenshot of a post: wrapped in a page of
//                    its own (https://inbox.chunky.dad/page/<name>, picture
//                    at /file/<name> — WebAdapter answers both from disk) so
//                    OCR reads it like any flyer; the picture itself is
//                    never written to the calendar (SharedCore.
//                    holdSharedPicturesBack), the deck shows it. HEIC (what
//                    the phone saves photos and screenshots as) is first
//                    re-encoded as a JPEG beside it through sips — the
//                    vision model reads JPEG/PNG/WebP, not HEIC. A
//                    SCREENSHOT of a post (status bar, app header, likes,
//                    caption around the flyer) is cropped to the flyer
//                    first — cropScreenshotToFlyer asks the vision model
//                    where the flyer is; the crop is the picture used, the
//                    original rides along to done/.
//   *.txt / *.url / *.webloc
//                    links, one per line (or the one inside): fetched by
//                    the run itself.
// Everything readable joins ONE extra parser for this run, "Shared pages",
// depth 0. Consumed files move to inbox/done/ (pruned after
// SHARED_PAGES_KEEP_DAYS — the pictures must outlive their run's OCR);
// requests.json (the phone-fetch list, scriptable-adapter
// fulfillInboxRequests) and anything unreadable stay where they are and
// are named in the log. Nothing is fetched live here.
// ---------------------------------------------------------------------------
const SHARED_PAGES_PARSER_NAME = 'Shared pages';
const SHARED_PAGES_KEEP_DAYS = 14;
const SHARED_INBOX_PICTURE_PATTERN = /\.(?:png|jpe?g|webp|gif|hei[cf])$/i;
const SHARED_INBOX_LINK_FILE_PATTERN = /\.(?:txt|url|webloc)$/i;
const SHARED_INBOX_RESERVED = new Set(['requests.json', 'done', '.DS_Store']);
// sips (macOS) re-encodes a HEIC as a JPEG next to it; the HEIC stays and
// is moved to done/ with everything else.
function runSips(args) {
    const { execFile } = require('child_process');
    return new Promise((resolve, reject) => {
        execFile('/usr/bin/sips', args, { timeout: 30000 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout || ''))));
    });
}
function convertHeicToJpeg(inPath, outPath) {
    return runSips(['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', inPath, '--out', outPath]).then(() => outPath);
}

// SCREENSHOT → FLYER (owner, 2026-10-02: "is it possible to crop the
// screenshots?"). A screenshot of a post carries the phone's status bar,
// the app's header, likes and caption around the flyer. The vision model
// (the OCR server) is asked whether the picture is such a screenshot and
// where the flyer sits — Qwen-VL answers `bbox_2d` on a 0–1000 grid; on a
// mocked Instagram screenshot it was within 3 px of the true edges, and a
// bare flyer answers "not a screenshot". The box is trusted only when it
// is plausible (SCREENSHOT_CROP_MIN_AREA..MAX_AREA of the picture, at
// least SCREENSHOT_CROP_MIN_WIDTH of its width); then sips crops a copy
// `<stem>-flyer.jpg` beside the original. Returns the crop's path, or ''
// when the picture stays as it is (not a screenshot, no answer, implausible
// box, vision server down). Never throws — the original is always usable.
const SCREENSHOT_CROP_MIN_AREA = 0.2;
const SCREENSHOT_CROP_MAX_AREA = 0.95;
const SCREENSHOT_CROP_MIN_WIDTH = 0.5;
const SCREENSHOT_CROP_PROMPT = 'Is this image a screenshot of a phone app (status bar, app header, like/share buttons, caption or comments around a picture) that contains an event flyer or poster? '
    + 'Answer with JSON only: {"screenshot": true|false, "app": "<app name or empty>", "bbox_2d": [x1, y1, x2, y2]} where bbox_2d locates the flyer/poster picture itself '
    + '(not the status bar, header, buttons or caption) in your native 0-1000 coordinate grid. If the whole image IS the flyer, answer screenshot false.';
async function cropScreenshotToFlyer(options) {
    const { file, adapter, core, ocrConfig } = options;
    const fsLike = options.fs || fs;
    const sips = options.sips || runSips;
    const locate = options.locate || (async () => {
        if (!core || !ocrConfig || !ocrConfig.endpoint || typeof adapter.fetchImageAsBase64 !== 'function') return null;
        const { SharedCore } = require('../scripts/shared-core');
        const base64 = await adapter.fetchImageAsBase64(SharedCore.sharedInboxUrl('file', path.basename(file)), 30, 1024);
        const raw = await core.callAiGenerate({ ...ocrConfig, numPredict: 200, think: false }, SCREENSHOT_CROP_PROMPT, 'screenshot-crop', adapter, null, base64);
        if (!raw) return null;
        const match = String(raw).match(/\{[\s\S]*\}/);
        if (!match) return null;
        try { return JSON.parse(match[0]); } catch (_) { return null; }
    });
    try {
        const answer = await locate();
        if (!answer || answer.screenshot !== true) return '';
        const box = Array.isArray(answer.bbox_2d) ? answer.bbox_2d.map(Number) : null;
        if (!box || box.length !== 4 || box.some((n) => !Number.isFinite(n))) { console.log(`run-once: 📨 ${path.basename(file)} is a screenshot (${answer.app || 'app'}) but the flyer's box is unreadable — kept as it is`); return ''; }
        const probe = await sips(['-g', 'pixelWidth', '-g', 'pixelHeight', file]);
        const width = Number((probe.match(/pixelWidth:\s*(\d+)/) || [])[1]);
        const height = Number((probe.match(/pixelHeight:\s*(\d+)/) || [])[1]);
        if (!width || !height) return '';
        const x1 = Math.max(0, Math.min(1000, Math.min(box[0], box[2]))) / 1000 * width;
        const x2 = Math.max(0, Math.min(1000, Math.max(box[0], box[2]))) / 1000 * width;
        const y1 = Math.max(0, Math.min(1000, Math.min(box[1], box[3]))) / 1000 * height;
        const y2 = Math.max(0, Math.min(1000, Math.max(box[1], box[3]))) / 1000 * height;
        const cropWidth = Math.round(x2 - x1);
        const cropHeight = Math.round(y2 - y1);
        const area = (cropWidth * cropHeight) / (width * height);
        if (area < SCREENSHOT_CROP_MIN_AREA || area > SCREENSHOT_CROP_MAX_AREA || cropWidth < SCREENSHOT_CROP_MIN_WIDTH * width) {
            console.log(`run-once: 📨 ${path.basename(file)} is a screenshot (${answer.app || 'app'}) but the flyer's box is implausible (${cropWidth}x${cropHeight} of ${width}x${height}) — kept as it is`);
            return '';
        }
        const outPath = path.join(path.dirname(file), `${path.basename(file).replace(/\.[^.]+$/, '')}-flyer.jpg`);
        await sips(['-c', String(cropHeight), String(cropWidth), '--cropOffset', String(Math.round(y1)), String(Math.round(x1)), '-s', 'format', 'jpeg', '-s', 'formatOptions', '90', file, '--out', outPath]);
        if (!fsLike.existsSync(outPath)) return '';
        console.log(`run-once: 📨 ${path.basename(file)} is a screenshot (${answer.app || 'app'}): cropped to the flyer, ${cropWidth}x${cropHeight} at ${Math.round(x1)},${Math.round(y1)} → ${path.basename(outPath)}`);
        return outPath;
    } catch (error) {
        console.log(`run-once: 📨 ${path.basename(file)} not cropped (${error.message}) — kept as it is`);
        return '';
    }
}
async function addSharedPagesParser(config, adapter, env = process.env, fsLike = fs, options = {}) {
    const sharedRoot = String((env && env.CHUNKY_SHARED_STORAGE_DIR) || '').trim();
    if (!sharedRoot || !config || !Array.isArray(config.parsers)) return [];
    const parserFilter = String((env && env.CHUNKY_RUN_PARSER) || '').trim();
    if (parserFilter && parserFilter !== SHARED_PAGES_PARSER_NAME) return [];
    const { SharedCore } = require('../scripts/shared-core');
    const { WebAdapter } = require('../scripts/adapters/web-adapter');
    const dir = path.join(sharedRoot, 'inbox');
    // The old inbox/pages/ folder (one release) is read the same way.
    const folders = [dir, path.join(dir, 'pages')];
    const files = [];
    for (const folder of folders) {
        let names = [];
        try { names = fsLike.readdirSync(folder); } catch (_) { continue; }
        for (const name of names.sort()) {
            if (SHARED_INBOX_RESERVED.has(name) || name.startsWith('.') || (folder === dir && name === 'pages')) continue;
            const file = path.join(folder, name);
            try { if (!fsLike.statSync(file).isFile()) continue; } catch (_) { continue; }
            files.push({ folder, name, file });
        }
    }
    if (files.length === 0) return [];
    const doneDir = path.join(dir, 'done');
    const urls = [];
    const skipped = [];
    const kinds = { page: 0, picture: 0, link: 0 };
    const cachePage = async (url, html, savedAt, by) => {
        if (!adapter || typeof adapter.writeCachedPage !== 'function') return;
        // The run's own config is not applied yet at this point (the cache
        // looks disabled); the shared page cache is addressed by the
        // adapter's storage dir regardless, so the write is explicit.
        const cacheConfig = typeof adapter.getPageCacheConfig === 'function' ? adapter.getPageCacheConfig() : {};
        await adapter.writeCachedPage(url, { html, url, statusCode: 200, headers: { 'x-fetched-by': by, 'x-shared-at': String(savedAt || '') } }, { ...cacheConfig, enabled: true, ttlDays: Number(cacheConfig.ttlDays) > 0 ? cacheConfig.ttlDays : 3 });
    };
    const addUrl = (url) => { if (!urls.includes(url)) urls.push(url); };
    for (const { name, file } of files) {
        let consumed = false;
        const toMove = [{ name, file }];
        if (/\.json$/i.test(name)) {
            let entry = null;
            try { entry = JSON.parse(fsLike.readFileSync(file, 'utf8')); } catch (_) { skipped.push(`${name}: not JSON`); continue; }
            const url = entry && typeof entry.url === 'string' ? entry.url.trim() : '';
            const html = entry && typeof entry.html === 'string' ? entry.html : '';
            if (!/^https?:\/\//i.test(url) || html.length < 200) {
                skipped.push(`${name}: ${!url ? 'no url' : html.length < 200 ? `html is ${html.length} chars` : 'bad url'}`);
                continue;
            }
            await cachePage(url, html, entry.savedAt, 'share-sheet');
            addUrl(url);
            kinds.page++;
            consumed = true;
        } else if (/\.html?$/i.test(name)) {
            const html = fsLike.readFileSync(file, 'utf8');
            if (html.length < 200) { skipped.push(`${name}: html is ${html.length} chars`); continue; }
            const stated = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) || html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i);
            const url = stated && /^https?:\/\//i.test(stated[1]) ? stated[1].trim() : SharedCore.sharedInboxUrl('page', name);
            await cachePage(url, html, fsLike.statSync(file).mtime.toISOString(), 'shared-inbox');
            addUrl(url);
            kinds.page++;
            consumed = true;
        } else if (SHARED_INBOX_PICTURE_PATTERN.test(name)) {
            let pictureName = name;
            let pictureFile = file;
            if (/\.hei[cf]$/i.test(name)) {
                const jpegName = name.replace(/\.hei[cf]$/i, '.jpg');
                try {
                    await convertHeicToJpeg(file, path.join(path.dirname(file), jpegName));
                    pictureName = jpegName;
                    pictureFile = path.join(path.dirname(file), jpegName);
                    toMove.push({ name: jpegName, file: pictureFile });
                } catch (error) {
                    skipped.push(`${name}: HEIC could not be re-encoded (${error.message})`);
                    continue;
                }
            }
            // A screenshot of a post is cropped to its flyer.
            const cropped = await cropScreenshotToFlyer({ file: pictureFile, adapter, core: options.core, ocrConfig: options.ocrConfig, locate: options.locateFlyer, sips: options.sips, fs: fsLike });
            if (cropped) {
                pictureName = path.basename(cropped);
                toMove.push({ name: pictureName, file: cropped });
            }
            const url = SharedCore.sharedInboxUrl('page', pictureName);
            await cachePage(url, WebAdapter.buildSharedPicturePage(pictureName), fsLike.statSync(file).mtime.toISOString(), 'shared-inbox');
            addUrl(url);
            kinds.picture++;
            consumed = true;
        } else if (SHARED_INBOX_LINK_FILE_PATTERN.test(name)) {
            const text = fsLike.readFileSync(file, 'utf8');
            const links = [];
            for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/g)) links.push(match[0].replace(/[),.;]+$/, ''));
            if (links.length === 0) { skipped.push(`${name}: no link inside`); continue; }
            links.forEach(addUrl);
            kinds.link += links.length;
            consumed = true;
        } else {
            skipped.push(`${name}: not a page, picture or link file`);
            continue;
        }
        if (consumed) {
            for (const moved of toMove) {
                try {
                    fsLike.mkdirSync(doneDir, { recursive: true });
                    fsLike.renameSync(moved.file, path.join(doneDir, moved.name));
                } catch (_) { /* a file that will not move is read again next run — harmless, the cache copy is the same */ }
            }
        }
    }
    // Old consumed files go.
    try {
        const keepMs = SHARED_PAGES_KEEP_DAYS * 24 * 60 * 60 * 1000;
        for (const name of fsLike.readdirSync(doneDir)) {
            const file = path.join(doneDir, name);
            if (Date.now() - fsLike.statSync(file).mtimeMs > keepMs) fsLike.unlinkSync(file);
        }
    } catch (_) { /* no done dir yet */ }
    if (skipped.length > 0) console.log(`run-once: 📨 files left in the inbox (${skipped.length}): ${skipped.join('; ')}`);
    if (urls.length === 0) return [];
    config.parsers.push({
        name: SHARED_PAGES_PARSER_NAME,
        urls,
        urlDiscoveryDepth: 0,
        enabled: true,
        automationEnabled: true
    });
    console.log(`run-once: 📨 ${urls.length} address(es) from the inbox (${kinds.page} page(s), ${kinds.picture} picture(s), ${kinds.link} link(s)) read as the "${SHARED_PAGES_PARSER_NAME}" parser: ${urls.join(', ')}`);
    return urls;
}

// NETWORK PREFLIGHT (NO PARTIAL RUNS). The scheduled job can fire while the
// Mac is still joining its network: on 2026-09-30 the 04:34 run made 414
// requests into nothing, could not read 58 published calendars, analysed
// every saved event as new and was written as the day's run. The site the
// calendars are read from is asked until it answers; a Mac that has no
// network after the wait aborts BEFORE the pipeline starts, with no run
// file. CHUNKY_SKIP_NETWORK_PREFLIGHT=1 is for offline replays.
const NETWORK_PREFLIGHT_URL = 'https://chunky.dad/robots.txt';
async function waitForNetwork(options = {}) {
    const env = options.env || process.env;
    if (String(env.CHUNKY_SKIP_NETWORK_PREFLIGHT || '').trim() === '1') return { skipped: true, attempts: 0 };
    const fetchImpl = options.fetch || globalThis.fetch;
    const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const attempts = Number.isFinite(options.attempts) ? options.attempts : 20;
    const gapMs = Number.isFinite(options.gapMs) ? options.gapMs : 15000;
    let lastError = '';
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            // Any answer at all is a network: the status is not judged here.
            await fetchImpl(NETWORK_PREFLIGHT_URL, { method: 'GET', signal: AbortSignal.timeout(10000) });
            if (attempt > 1) console.log(`run-once: network reached on attempt ${attempt}`);
            return { skipped: false, attempts: attempt };
        } catch (error) {
            lastError = error && error.message ? error.message : String(error);
            if (attempt === 1) console.log(`run-once: no network yet (${lastError}) — waiting up to ${Math.round((attempts - 1) * gapMs / 60000)} min before starting`);
            if (attempt < attempts) await sleep(gapMs);
        }
    }
    throw new Error(`run-once: no network after ${attempts} attempts (${lastError}) — ABORTING before any parser work (no partial runs)`);
}

// A run that could not read the calendars it analyses against is not a run
// (SharedCore.describeCalendarReadHealth): thrown after the pipeline so the
// shared-storage failure path writes its LOG and no run JSON.
function assertCalendarsWereRead(results, SharedCore) {
    const health = SharedCore.describeCalendarReadHealth(results && results.publishedCalendarSnapshots);
    if (!health.degraded) return health;
    throw new Error(`run-once: ${health.cities.length} saved calendar(s) could not be read (${health.cities.slice(0, 8).join(', ')}${health.cities.length > 8 ? ', …' : ''}) — their events would be analysed as NEW. Run discarded (no partial runs); the log is kept.`);
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

    await waitForNetwork();

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
    let stalled = false;
    try {
        results = await stallGuard(orchestrator.run());
        const { SharedCore } = require(path.join(repoRoot, 'scripts', 'shared-core'));
        assertCalendarsWereRead(results, SharedCore);
    } catch (error) {
        stalled = Boolean(error && error.stall);
        if (stalled) console.error(`⛔ ${error.message}`);
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
        // A stalled run still holds whatever it was waiting on; the process
        // would never exit on its own. The failure is written above.
        if (stalled) {
            console.error('run-once: exiting after the stall — the failed run is saved, re-run when ready');
            process.exit(3);
        }
        throw error;
    }

    // Shared save FIRST (the Node analog of the phone's save-before-UI
    // ordering: persist before the parent server renders/publishes anything).
    if (sharedRoot) {
        const adapter = new WebAdapter({});
        await adapter.saveRunToSharedStorage(results, { logText: logLines.join('\n') });
        // The automated source audit (tools/source-audit.js): three hosts a
        // run get their listing page read beside what we extracted, every
        // loss confirmed this run is looked for on its site. Report only,
        // budgeted, never a reason for the run to fail. CHUNKY_SOURCE_AUDIT=0 skips it.
        try {
            const { runSourceAudit } = require(path.join(__dirname, 'source-audit'));
            const runConfig = results && results.config && results.config.config ? results.config.config : {};
            const auditAdapter = new WebAdapter({ pageCache: runConfig.pageCache || { enabled: true, ttlDays: 3 }, politeness: runConfig.politeness });
            await runSourceAudit({ results, sharedRoot, adapter: auditAdapter, aiConfig: runConfig.ai || null, env: process.env, log: console.log });
        } catch (error) {
            console.log(`run-once: source audit skipped — ${error && error.message ? error.message : error}`);
        }
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
    stallGuard,
    runPulse,
    clockPrefix,
    describeActiveResources,
    waitForNetwork,
    assertCalendarsWereRead,
    deepMergeInto,
    safeStringify,
    isAutomationEnv,
    shapeRunOnceConfig,
    addSharedPagesParser,
    cropScreenshotToFlyer,
    SHARED_PAGES_PARSER_NAME,
    assertSharedStorageRootUsable,
    installConsoleTee,
    ensureThreadpoolHeadroom,
    resolveMaterializeCeilingMs,
    sweepSharedStorageBeforeRun,
    materializeSharedStorageTree
};

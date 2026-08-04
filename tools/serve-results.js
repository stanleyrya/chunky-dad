#!/usr/bin/env node
// ============================================================================
// MAC/TAILNET RESULTS SERVER (Node-only; lives in tools/ so it NEVER ships to
// the phone — nothing under scripts/ may depend on this file)
// ============================================================================
// v1 of the "run the scraper from the couch" server:
//
//   RUN in a child process — POST /run spawns `node tools/run-once.js`, which
//   drives the real orchestrator with clean globals (the orchestrator sniffs
//   `typeof importModule` at require time, so the pipeline must never see the
//   Scriptable stubs this parent installs for rendering) and dumps results
//   JSON to ~/.chunky-dad-scraper/server/latest-run.json. dryRun is FORCED —
//   v1 is report-only.
//
//   RENDER in the parent — GET / loads the latest results dump, installs the
//   ~25-line Scriptable global stubs (same pattern as
//   scripts/adapters/scriptable-adapter.test.js), requires the untouched
//   scriptable-adapter, and calls generateRichHTML(results) to get the real
//   results UI. The chunkyscrape:// webview→native bridge dead-ends in a
//   browser, so the rendered HTML is post-processed (rewriteBridgeHtml):
//     copy buttons   → navigator.clipboard with a textarea/execCommand
//                      fallback (plain-HTTP tailnet = non-secure context)
//     open-url links → plain <a target="_blank"> with the real URL
//     export-ics     → navigates to /ics/<id> (served below)
//     mark-bear / queue-venue → disabled, title "phone-only in v1"
//
// Endpoints: GET / (results or run form) · GET/POST /run · GET /run-form ·
// GET /log · GET /ics/<id>
//
// House style: no `new URL` / URLSearchParams anywhere (matches the iOS-shared
// scripts even though this file is Node-only). Pure helpers are exported for
// scripts/tools-serve-results.test.js.
// ============================================================================

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const serverDir = path.join(os.homedir(), '.chunky-dad-scraper', 'server');
const latestRunPath = path.join(serverDir, 'latest-run.json');

const DEFAULT_PORT = 8734;
const LOG_TAIL_LINES = 500;

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

// Minimal request-URL parser — path + query map — built with split/
// decodeURIComponent only (house style: no `new URL`, no URLSearchParams).
function parseRequestUrl(rawUrl) {
    const url = String(rawUrl || '');
    const queryIndex = url.indexOf('?');
    const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);
    const query = {};
    if (queryIndex !== -1) {
        const pairs = url.slice(queryIndex + 1).split('&');
        for (const pair of pairs) {
            if (!pair) continue;
            const eqIndex = pair.indexOf('=');
            const rawKey = eqIndex === -1 ? pair : pair.slice(0, eqIndex);
            const rawValue = eqIndex === -1 ? '' : pair.slice(eqIndex + 1);
            try {
                query[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue.replace(/\+/g, ' '));
            } catch (error) {
                query[rawKey] = rawValue;
            }
        }
    }
    return { pathname, query };
}

// Single-flight run lock: one pipeline run at a time; a second acquire fails
// (the server answers 409). Pure state machine so tests can drive it.
function createRunLock() {
    let active = null;
    return {
        tryAcquire(meta = {}) {
            if (active) return null;
            active = { startedAt: new Date().toISOString(), ...meta };
            return active;
        },
        release() {
            const wasActive = active !== null;
            active = null;
            return wasActive;
        },
        isActive() {
            return active !== null;
        },
        current() {
            return active;
        }
    };
}

// Parser names from a scraper-input-shaped config ({ parsers: [{name, enabled}] }).
function listParserNames(config) {
    const parsers = config && Array.isArray(config.parsers) ? config.parsers : [];
    return parsers
        .filter((parser) => parser && typeof parser.name === 'string' && parser.name.trim())
        .map((parser) => ({ name: parser.name, enabled: parser.enabled !== false }));
}

function escapeHtmlText(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// JSON destined for an inline <script> — escape `<` so `</script>` in payload
// text can never terminate the block.
function jsonForInlineScript(value) {
    return JSON.stringify(value == null ? null : value).replace(/</g, '\\u003c');
}

const BRIDGE_SHIM_MARKER = 'chunky-server-bridge-shim';

// ---------------------------------------------------------------------------
// Bridge rewrite: adapt the chunkyscrape:// webview→native handlers for a
// plain browser over the tailnet. Registries come from the adapter instance
// right after generateRichHTML (same per-render maps native reads on-device).
//   registries = {
//     mapVerifyUrls:   { id → real https URL }   (open-url bridge)
//     venueSnippets:   { index → parser entry }  (copy-venue bridge)
//   }
// ---------------------------------------------------------------------------
function rewriteBridgeHtml(html, registries = {}) {
    let out = String(html || '');
    if (out.includes(BRIDGE_SHIM_MARKER)) {
        return out; // idempotent: already rewritten
    }
    const mapVerifyUrls = registries.mapVerifyUrls && typeof registries.mapVerifyUrls === 'object'
        ? registries.mapVerifyUrls
        : {};
    const venueSnippets = registries.venueSnippets && typeof registries.venueSnippets === 'object'
        ? registries.venueSnippets
        : {};

    // 1) open-url → plain anchors: swap the bridge onclick for the real URL
    //    from the per-render registry, opening in a new tab.
    out = out.replace(
        /href="#" onclick="return openMapVerify\(this\)" data-map-url-id="([^"]*)"/g,
        (match, id) => {
            const realUrl = mapVerifyUrls[id];
            if (typeof realUrl !== 'string' || !realUrl) {
                return `href="#" data-map-url-id="${id}"`;
            }
            return `href="${escapeHtmlText(realUrl)}" target="_blank" rel="noopener noreferrer" data-map-url-id="${id}"`;
        }
    );

    // 2) Neutralize every literal chunkyscrape:// left in the original page
    //    scripts. The handlers are also redefined below, so this is belt and
    //    suspenders: even a missed call path can only hit an inert scheme.
    out = out.split('chunkyscrape://').join('bridge-disabled://');

    // 3) Append the shim script: later function declarations override the
    //    originals for every subsequent onclick dispatch.
    const shim = `
<!-- ${BRIDGE_SHIM_MARKER} -->
<script>
(function () {
    window.__serverBridgeData = {
        venueSnippets: ${jsonForInlineScript(venueSnippets)}
    };
})();
// Clipboard with non-secure-context fallback: navigator.clipboard only exists
// on HTTPS/localhost, and this page is usually plain HTTP on the tailnet —
// so fall back to a hidden textarea + document.execCommand('copy').
function serverCopyText(text, done) {
    function finish(ok) { if (typeof done === 'function') done(ok); }
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () { finish(true); }, function () { fallback(); });
        return;
    }
    fallback();
    function fallback() {
        try {
            var area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.left = '-9999px';
            document.body.appendChild(area);
            area.select();
            var ok = document.execCommand('copy');
            document.body.removeChild(area);
            finish(ok);
        } catch (error) {
            finish(false);
        }
    }
}
// copy-venue: snippet text is injected server-side (native kept it in a
// Pasteboard registry; the browser gets the same map inline).
function copyVenueEntry(btn) {
    var idx = btn ? (btn.getAttribute('data-venue-index') || '') : '';
    var snippet = window.__serverBridgeData.venueSnippets[idx];
    if (typeof snippet !== 'string' || !snippet) return;
    serverCopyText(snippet, function (ok) {
        if (ok && typeof markVenueEntryCopied === 'function') markVenueEntryCopied(idx);
        if (!ok) window.prompt('Copy manually (clipboard needs HTTPS — try tailscale serve):', snippet);
    });
}
// export-ics: native built the ICS and opened DocumentPicker; the browser
// just downloads it from the server's per-render registry.
function exportRecurringIcs(btn) {
    var id = btn ? (btn.getAttribute('data-ics-export-id') || '') : '';
    if (id === '') return;
    window.location.href = '/ics/' + encodeURIComponent(id);
}
// mark-bear / queue-venue write to on-device state (calendar overrides, the
// gathering-only venue queue) — phone-only in v1, so the buttons go inert.
function markBearOverride() {}
function queueVenueCandidate() {}
// The liveness beacons and the native log/prompt copy bridges have no browser
// counterpart (there is no Scriptable console to log into, and the log text
// lives on the phone). Inert here so a plain browser never attempts a
// bridge-disabled:// navigation — the beacon fires by itself on every load.
function sendResultsBeacon() {}
function requestNativeLogCopy() {}
function showAiPromptPicker() {}
(function disablePhoneOnlyButtons() {
    var buttons = document.querySelectorAll('.bear-override-btn, .venue-queue-btn');
    for (var i = 0; i < buttons.length; i++) {
        buttons[i].disabled = true;
        buttons[i].title = 'phone-only in v1';
    }
})();
</script>`;

    const bodyCloseIndex = out.lastIndexOf('</body>');
    if (bodyCloseIndex === -1) {
        return out + shim;
    }
    return out.slice(0, bodyCloseIndex) + shim + out.slice(bodyCloseIndex);
}

const HEADER_BAR_MARKER = 'chunky-server-header-bar';

// "34m" / "1.5h" / "2.1d" age label for the calendar-snapshot header segment.
function formatSnapshotAge(ageMs) {
    if (!Number.isFinite(ageMs) || ageMs < 0) return null;
    const minutes = ageMs / (60 * 1000);
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = minutes / 60;
    if (hours < 24) return `${hours.toFixed(1)}h`;
    return `${(hours / 24).toFixed(1)}d`;
}

// v2: published-calendar snapshot freshness per consulted city, e.g.
// "calendar snapshot: seattle 34m old · nyc unavailable". Empty string when
// the run consulted no published calendars (pre-v2 runs, or no events).
function formatCalendarSnapshotLabel(snapshots, nowMs = Date.now()) {
    if (!snapshots || typeof snapshots !== 'object') return '';
    const segments = [];
    for (const city of Object.keys(snapshots).sort()) {
        const snapshot = snapshots[city];
        if (!snapshot || typeof snapshot !== 'object') continue;
        if (snapshot.status === 'ok' && snapshot.fetchedAt) {
            const fetchedMs = Date.parse(snapshot.fetchedAt);
            const age = Number.isFinite(fetchedMs) ? formatSnapshotAge(nowMs - fetchedMs) : null;
            segments.push(`${city} ${age ? `${age} old` : 'fresh'}`);
        } else {
            segments.push(`${city} unavailable`);
        }
    }
    return segments.length > 0 ? `calendar snapshot: ${segments.join(' · ')}` : '';
}

// Small server header bar injected right after <body>. Idempotent: a page
// that already carries the marker is returned unchanged.
function injectHeaderBar(html, info = {}) {
    let out = String(html || '');
    if (out.includes(HEADER_BAR_MARKER)) {
        return out;
    }
    const runLabel = info.savedAt
        ? `Run saved ${escapeHtmlText(info.savedAt)}`
        : 'No run metadata';
    const parserLabel = info.parserFilter
        ? ` · parser: ${escapeHtmlText(info.parserFilter)}`
        : ' · all enabled parsers';
    const snapshotLabel = formatCalendarSnapshotLabel(info.calendarSnapshots);
    const snapshotSpan = snapshotLabel
        ? `\n    <span style="opacity:0.85;">${escapeHtmlText(snapshotLabel)}</span>`
        : '';
    const bar = `
<div id="${HEADER_BAR_MARKER}" style="position:sticky; top:0; z-index:9999; display:flex; gap:14px; align-items:center; flex-wrap:wrap; padding:8px 14px; background:#1c1c1e; color:#f2f2f7; font:13px -apple-system, sans-serif; border-bottom:2px solid #ff6b35;">
    <span style="font-weight:700;">chunky.dad scraper server</span>
    <span>${runLabel}${parserLabel}</span>${snapshotSpan}
    <a href="/run-form" style="color:#ffd60a; font-weight:600; text-decoration:none;">▶ Run scraper</a>
    <a href="/log" style="color:#ffd60a; text-decoration:none;">Log</a>
    <span style="opacity:0.7;">ICS links belong to this render — after a new run, reload before saving events.</span>
</div>`;
    const bodyMatch = out.match(/<body[^>]*>/i);
    if (!bodyMatch) {
        return bar + out;
    }
    const insertAt = bodyMatch.index + bodyMatch[0].length;
    return out.slice(0, insertAt) + bar + out.slice(insertAt);
}

// Per-event ICS via the shared builder (scripts/event-schema.js — untouched:
// buildRecurringEventIcs already omits RRULE when the event has no
// recurrence rule, so one-off events export as plain single VEVENTs).
function buildEventIcs(event, cities, eventSchema) {
    if (!event || typeof event !== 'object' || !eventSchema) return null;
    const cityConfig = cities && event.city ? cities[event.city] : null;
    const timezone = (cityConfig && cityConfig.timezone) || event.timezone || 'UTC';
    const icsText = eventSchema.buildRecurringEventIcs(event, { timezone });
    if (!icsText) return null;
    const slug = typeof eventSchema.slugifyIcsText === 'function'
        ? eventSchema.slugifyIcsText(event.title || event.name || '')
        : '';
    return { icsText, fileName: `${slug || 'chunky-dad-event'}.ics` };
}

// Last N lines of a (possibly large) log text.
function tailLines(text, maxLines = LOG_TAIL_LINES) {
    const lines = String(text || '').split('\n');
    return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
}

// Minimal run-form page: parser dropdown + POST /run.
function renderRunFormPage(parserEntries, options = {}) {
    const entries = Array.isArray(parserEntries) ? parserEntries : [];
    const optionsHtml = ['<option value="">All parsers</option>']
        .concat(entries.map((entry) => {
            const name = escapeHtmlText(entry.name);
            return `<option value="${name}">${name}</option>`;
        }))
        .join('\n');
    const notice = options.notice
        ? `<p style="color:#b25000; font-weight:600;">${escapeHtmlText(options.notice)}</p>`
        : '';
    const hasRun = options.hasRun
        ? '<p><a href="/">← Back to latest results</a></p>'
        : '<p>No results yet — run the scraper to render the results UI here.</p>';
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>chunky.dad scraper server</title></head>
<body style="font:15px -apple-system, sans-serif; max-width:640px; margin:40px auto; padding:0 16px;">
<h1>🐻 chunky.dad scraper server</h1>
${notice}
<p>Runs are <strong>report-only</strong> (dryRun forced) in v1 — no calendar writes.</p>
<form method="POST" action="/run">
    <label>Parser: <select name="parser">${optionsHtml}</select></label>
    <button type="submit" style="margin-left:10px; padding:6px 18px; font-weight:700;">Run scraper</button>
</form>
${hasRun}
<p><a href="/log">View latest run log</a></p>
</body></html>`;
}

// GET /run browser-convenience confirm page (never runs on GET).
function renderConfirmRunPage(parserName) {
    const label = parserName ? `parser <strong>${escapeHtmlText(parserName)}</strong>` : 'all enabled parsers';
    const hiddenValue = escapeHtmlText(parserName || '');
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Confirm run</title></head>
<body style="font:15px -apple-system, sans-serif; max-width:640px; margin:40px auto; padding:0 16px;">
<h1>Start a scraper run?</h1>
<p>This will run ${label} (report-only, dryRun forced).</p>
<form method="POST" action="/run">
    <input type="hidden" name="parser" value="${hiddenValue}">
    <button type="submit" style="padding:6px 18px; font-weight:700;">Yes, run now</button>
    <a href="/" style="margin-left:14px;">Cancel</a>
</form>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Server internals (not exercised by unit tests; smoke-tested live)
// ---------------------------------------------------------------------------

// Scriptable global stubs — the same ~25-line harness the adapter unit tests
// use (scripts/adapters/scriptable-adapter.test.js). Installed ONCE in this
// parent process, and ONLY here: the pipeline always runs in a child process
// with clean globals, so the orchestrator's `typeof importModule` environment
// sniffing never sees these.
let scriptableAdapterModule = null;
function requireScriptableAdapterWithStubs() {
    if (scriptableAdapterModule) return scriptableAdapterModule;
    global.importModule = (name) => require(path.join(repoRoot, 'scripts', name));
    global.Calendar = { forEvents: async () => [] };
    global.Device = { isUsingDarkAppearance: () => false };
    const fileManagerStub = {
        documentsDirectory: () => path.join(os.tmpdir(), 'chunky-dad-server-render'),
        joinPath: (a, b) => `${a}/${b}`,
        fileExists: () => false,
        isDirectory: () => false,
        createDirectory: () => {},
        fileName: (filePath) => String(filePath).split('/').pop(),
        readString: () => null,
        writeString: () => {},
        downloadFileFromiCloud: async () => {}
    };
    global.FileManager = {
        iCloud: () => fileManagerStub,
        local: () => fileManagerStub
    };
    scriptableAdapterModule = require(path.join(repoRoot, 'scripts', 'adapters', 'scriptable-adapter'));
    return scriptableAdapterModule;
}

function loadEventSchema() {
    return require(path.join(repoRoot, 'scripts', 'event-schema')).EventSchema;
}

// Fresh parser list straight from the checked-in config (cache-busted so a
// config edit between runs shows up without restarting the server).
function loadParserEntries() {
    const configPath = path.join(repoRoot, 'scripts', 'scraper-input.js');
    delete require.cache[require.resolve(configPath)];
    return listParserNames(require(configPath));
}

function loadLatestRun() {
    try {
        const raw = fs.readFileSync(latestRunPath, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        return null;
    }
}

function findLatestLogPath() {
    try {
        const files = fs.readdirSync(serverDir)
            .filter((name) => /^run-.*\.log$/.test(name))
            .sort();
        if (files.length === 0) return null;
        return path.join(serverDir, files[files.length - 1]);
    } catch (error) {
        return null;
    }
}

function createServerState() {
    return {
        lock: createRunLock(),
        icsRegistry: {}, // id → event, captured from the adapter per render
        lastRenderResults: null
    };
}

// Render the latest run through the real Scriptable results UI, then adapt
// the bridge for browsers. Also refreshes the server-side ICS registry so
// /ics/<id> ids always match the ids embedded in the served page.
async function renderLatestResults(state, saved) {
    const { ScriptableAdapter } = requireScriptableAdapterWithStubs();
    const results = saved.results || {};
    const cities = (results.config && results.config.cities) || {};
    const adapter = new ScriptableAdapter({ cities });
    // target: 'web' — desktop Safari has no WebView.loadHTML size cliff, so
    // this flow renders EVERY event on one page and sheds nothing. Paging and
    // the shed ladder exist only to survive that Scriptable-side limit; on
    // desktop they would just cost the owner review detail he can have free.
    const html = await adapter.generateRichHTML(results, { target: 'web' });
    const registries = {
        mapVerifyUrls: adapter._mapVerifyUrls || {},
        venueSnippets: typeof adapter.collectVenueEntrySnippets === 'function'
            ? adapter.collectVenueEntrySnippets(results)
            : {}
    };
    state.icsRegistry = adapter._icsExportEvents || {};
    state.lastRenderResults = results;
    let out = rewriteBridgeHtml(html, registries);
    out = injectHeaderBar(out, {
        savedAt: saved.savedAt || '',
        parserFilter: saved.parserFilter || '',
        calendarSnapshots: (saved.results && saved.results.publishedCalendarSnapshots) || null
    });
    return out;
}

// /ics/<id>: the per-render recurring-export registry first (ids embedded in
// the served page), then analyzedEvents[<id>] as a numeric fallback so every
// event in the latest run is exportable, recurring or not.
function lookupIcsEvent(state, id) {
    if (state.icsRegistry && state.icsRegistry[id]) {
        return state.icsRegistry[id];
    }
    const results = state.lastRenderResults || (loadLatestRun() || {}).results || {};
    const analyzed = Array.isArray(results.analyzedEvents) ? results.analyzedEvents : [];
    const index = /^\d+$/.test(id) ? Number(id) : -1;
    if (index >= 0 && index < analyzed.length) {
        return analyzed[index];
    }
    return null;
}

function readRequestBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 1024 * 1024) req.destroy();
        });
        req.on('end', () => resolve(body));
        req.on('error', () => resolve(''));
    });
}

function sendHtml(res, status, html) {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
}

function sendText(res, status, text) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
}

// Spawn the pipeline child (RUN side of the run/render split). stdout+stderr
// stream into a timestamped log under ~/.chunky-dad-scraper/server/.
function startRun(state, parserName, extraEnv = {}) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(serverDir, `run-${stamp}.log`);
    const logStream = fs.createWriteStream(logPath);
    const child = spawn(process.execPath, [path.join(repoRoot, 'tools', 'run-once.js')], {
        cwd: repoRoot,
        env: {
            ...process.env,
            ...extraEnv,
            CHUNKY_RUN_PARSER: parserName || '',
            CHUNKY_RUN_OUT: latestRunPath
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream, { end: false });
    child.on('close', (code) => {
        logStream.end(`\nrun-once exited with code ${code}\n`);
        console.log(`Run finished (exit ${code}) — log: ${logPath}`);
        state.lock.release();
    });
    child.on('error', (error) => {
        logStream.end(`\nrun-once spawn failed: ${error.message}\n`);
        state.lock.release();
    });
    return { child, logPath };
}

async function handleRequest(state, req, res) {
    const { pathname, query } = parseRequestUrl(req.url);

    if (pathname === '/' && req.method === 'GET') {
        const saved = loadLatestRun();
        if (!saved) {
            return sendHtml(res, 200, renderRunFormPage(loadParserEntries(), {
                hasRun: false,
                notice: state.lock.isActive() ? 'A run is currently in progress — refresh in a bit.' : ''
            }));
        }
        try {
            const html = await renderLatestResults(state, saved);
            return sendHtml(res, 200, html);
        } catch (error) {
            console.error(`Render failed: ${error.stack || error}`);
            return sendText(res, 500, `Render failed: ${error.message}`);
        }
    }

    if (pathname === '/run-form' && req.method === 'GET') {
        return sendHtml(res, 200, renderRunFormPage(loadParserEntries(), {
            hasRun: Boolean(loadLatestRun()),
            notice: state.lock.isActive() ? 'A run is currently in progress.' : ''
        }));
    }

    if (pathname === '/run') {
        if (req.method === 'GET') {
            // Browser convenience: never trigger on GET, show a confirm form.
            return sendHtml(res, 200, renderConfirmRunPage(query.parser || ''));
        }
        if (req.method === 'POST') {
            const body = await readRequestBody(req);
            const bodyParams = parseRequestUrl(`?${body}`).query;
            const parserName = (query.parser || bodyParams.parser || '').trim();
            const acquired = state.lock.tryAcquire({ parser: parserName || '(all)' });
            if (!acquired) {
                return sendText(res, 409, `A run is already active (started ${state.lock.current().startedAt}). Try again when it finishes — watch /log.`);
            }
            const { logPath } = startRun(state, parserName);
            console.log(`Run started (parser: ${parserName || 'all enabled'}) — log: ${logPath}`);
            return sendHtml(res, 202, `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Run started</title></head>
<body style="font:15px -apple-system, sans-serif; max-width:640px; margin:40px auto; padding:0 16px;">
<h1>Run started</h1>
<p>Parser: ${escapeHtmlText(parserName || 'all enabled parsers')} (report-only).</p>
<p><a href="/log">Watch the log</a> · <a href="/">Results (reload when the run finishes)</a></p>
</body></html>`);
        }
    }

    if (pathname === '/log' && req.method === 'GET') {
        const logPath = findLatestLogPath();
        if (!logPath) {
            return sendText(res, 404, 'No run log yet.');
        }
        try {
            const text = fs.readFileSync(logPath, 'utf8');
            return sendText(res, 200, `# ${logPath} (last ${LOG_TAIL_LINES} lines)\n${tailLines(text)}`);
        } catch (error) {
            return sendText(res, 500, `Could not read log: ${error.message}`);
        }
    }

    if (pathname.startsWith('/ics/') && req.method === 'GET') {
        const id = pathname.slice('/ics/'.length);
        const event = lookupIcsEvent(state, id);
        if (!event) {
            return sendText(res, 404, `No event with ICS id "${id}" in the latest render.`);
        }
        const results = state.lastRenderResults || (loadLatestRun() || {}).results || {};
        const cities = (results.config && results.config.cities) || {};
        const built = buildEventIcs(event, cities, loadEventSchema());
        if (!built) {
            return sendText(res, 500, 'ICS build failed for that event.');
        }
        res.writeHead(200, {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': `attachment; filename="${built.fileName}"`
        });
        return res.end(built.icsText);
    }

    return sendText(res, 404, 'Not found. Endpoints: / /run /run-form /log /ics/<id>');
}

function parsePortFromArgv(argv) {
    const args = Array.isArray(argv) ? argv : [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--port' && args[i + 1]) {
            const parsed = Number(args[i + 1]);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
        const match = /^--port=(\d+)$/.exec(args[i]);
        if (match) return Number(match[1]);
    }
    return DEFAULT_PORT;
}

function startServer(port = DEFAULT_PORT) {
    fs.mkdirSync(serverDir, { recursive: true });
    const state = createServerState();
    const server = http.createServer((req, res) => {
        handleRequest(state, req, res).catch((error) => {
            console.error(`Request failed: ${error.stack || error}`);
            try {
                sendText(res, 500, `Server error: ${error.message}`);
            } catch (ignore) { /* response already gone */ }
        });
    });
    server.listen(port, '0.0.0.0', () => {
        const hostname = os.hostname().replace(/\.local$/, '');
        console.log('chunky.dad scraper server (v1, report-only)');
        console.log(`  Local:    http://localhost:${port}/`);
        console.log(`  Tailnet:  http://${hostname}:${port}/  (MagicDNS name if this Mac is on your tailnet)`);
        console.log('  Clipboard copy buttons need a secure context — for HTTPS on the tailnet run:');
        console.log(`    tailscale serve --bg ${port}`);
        console.log(`  Results dump + run logs: ${serverDir}`);
    });
    return { server, state };
}

module.exports = {
    DEFAULT_PORT,
    BRIDGE_SHIM_MARKER,
    HEADER_BAR_MARKER,
    parseRequestUrl,
    createRunLock,
    listParserNames,
    escapeHtmlText,
    jsonForInlineScript,
    rewriteBridgeHtml,
    injectHeaderBar,
    formatCalendarSnapshotLabel,
    buildEventIcs,
    tailLines,
    renderRunFormPage,
    renderConfirmRunPage,
    parsePortFromArgv,
    lookupIcsEvent,
    startServer
};

if (require.main === module) {
    startServer(parsePortFromArgv(process.argv.slice(2)));
}

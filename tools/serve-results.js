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
// GET /log · GET /ics/<id> · GET /ics-batch/<id>
//
//   REVIEW (v2, the swipe deck) — GET /review renders one saved run from the
//   shared iCloud runs/ dir (newest by default, ?run=<id> for another) as a
//   deck of cards: new events, merges that change a stored field, new bars.
//   Swipes POST /review/decide into <sharedRoot>/owner-decisions.json (the
//   Mac is that file's only writer; tools/review-queue.js owns the shape).
//   "Execute on phone" is a scriptable:///run link that opens
//   display-saved-run.js with reviewExecute=1 — the PHONE re-analyzes the
//   run against the live calendar and writes only what was approved (plus
//   notes-only housekeeping merges). This server still never writes a
//   calendar. Endpoints: GET /review · GET /review/deck.json ·
//   POST /review/decide · GET /review/decisions.json · GET /review/rejections
//   · GET /inbox/file/<name> (a picture from the shared inbox, for the deck)
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
const zlib = require('zlib');
const { spawn } = require('child_process');

const reviewQueue = require('./review-queue');

const repoRoot = path.resolve(__dirname, '..');
const serverDir = path.join(os.homedir(), '.chunky-dad-scraper', 'server');
const latestRunPath = path.join(serverDir, 'latest-run.json');

const DEFAULT_PORT = 8734;
const LOG_TAIL_LINES = 500;
// The Scriptable script name of scripts/display-saved-run.js on the phone
// (Scriptable names scripts by file stem). Override with
// CHUNKY_REVIEW_SCRIPT_NAME if the copy on the phone is named differently.
const REVIEW_SCRIPT_NAME_DEFAULT = 'display-saved-run';

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
    // The Withheld header carries one "💾 <calendar> (N)" batch button per
    // calendar in a flex row that cannot wrap: eight calendars made the
    // whole page 1041px wide on a 390px phone (2026-09-29), so every card
    // scrolled sideways. And the run's errors were its faintest text:
    // rgb(255,107,107) on rgb(255,240,240), 2.5:1 — the same red, darkened
    // to 5.9:1. Server-side overrides only — the phone's own sheet is
    // rendered by the adapter and is not touched from here.
    const shim = `
<!-- ${BRIDGE_SHIM_MARKER} -->
<style>
.section-header { flex-wrap: wrap; row-gap: 6px; column-gap: 6px; }
.section-header .section-title { flex: 1 1 8em; }
.error-item { color: #b3261e; overflow-wrap: anywhere; }
</style>
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
// export-ics-batch: same treatment for the per-calendar "💾 ICS (N)" batch
// buttons — the server rebuilds the whole calendar's batch on demand.
function exportBatchIcs(btn) {
    var id = btn ? (btn.getAttribute('data-ics-batch-id') || '') : '';
    if (id === '') return;
    window.location.href = '/ics-batch/' + encodeURIComponent(id);
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
//
// A full run consults every city (33 on 2026-09-29) and all but one or two
// were fetched by the same run, so they read the same: named one by one the
// line was eleven rows of a sticky bar on the phone. Cities that say the
// same thing are counted ("31 cities 1.1h old") once SNAPSHOT_FOLD_MIN of
// them agree; the ones that differ — the stale one, the unavailable one —
// keep their names, because those are the ones worth reading.
const SNAPSHOT_FOLD_MIN = 4;
function formatCalendarSnapshotLabel(snapshots, nowMs = Date.now()) {
    if (!snapshots || typeof snapshots !== 'object') return '';
    const entries = [];
    for (const city of Object.keys(snapshots).sort()) {
        const snapshot = snapshots[city];
        if (!snapshot || typeof snapshot !== 'object') continue;
        if (snapshot.status === 'ok' && snapshot.fetchedAt) {
            const fetchedMs = Date.parse(snapshot.fetchedAt);
            const age = Number.isFinite(fetchedMs) ? formatSnapshotAge(nowMs - fetchedMs) : null;
            entries.push({ city, state: `${age ? `${age} old` : 'fresh'}${snapshot.source === 'phone' ? ' (phone)' : ''}` });
        } else {
            entries.push({ city, state: 'unavailable' });
        }
    }
    if (entries.length === 0) return '';
    const sizes = new Map();
    for (const entry of entries) sizes.set(entry.state, (sizes.get(entry.state) || 0) + 1);
    const folded = [...sizes.keys()].filter((state) => sizes.get(state) >= SNAPSHOT_FOLD_MIN)
        .sort((a, b) => sizes.get(b) - sizes.get(a) || a.localeCompare(b));
    const segments = folded.map((state) => `${sizes.get(state)} cities ${state}`)
        .concat(entries.filter((entry) => !folded.includes(entry.state)).map((entry) => `${entry.city} ${entry.state}`));
    return `calendar snapshot: ${segments.join(' · ')}`;
}

// Small server header bar injected right after <body>. Idempotent: a page
// that already carries the marker is returned unchanged.
function injectHeaderBar(html, info = {}) {
    let out = String(html || '');
    if (out.includes(HEADER_BAR_MARKER)) {
        return out;
    }
    const reviewCount = Number.isFinite(info.reviewPending) && info.reviewPending > 0
        ? ` (${info.reviewPending})`
        : '';
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
    // Two rows: the links stay in reach while the page scrolls (sticky),
    // the run facts are read once and scroll away with the page. As one
    // sticky block the bar stood 350px tall on a 390px-wide phone — 41% of
    // the screen, on every one of the page's ~335 screens.
    const bar = `
<div id="${HEADER_BAR_MARKER}" style="position:sticky; top:0; z-index:9999; display:flex; gap:6px 16px; align-items:center; flex-wrap:wrap; padding:8px 14px; padding-top:calc(8px + env(safe-area-inset-top)); background:#1c1c1e; color:#f2f2f7; font:13px -apple-system, sans-serif; border-bottom:2px solid #ff6b35;">
    <span style="font-weight:700;">chunky.dad scraper server</span>
    <a href="/run-form" style="color:#ffd60a; font-weight:600; text-decoration:none;">▶ Run scraper</a>
    <a href="/review" style="color:#ffd60a; font-weight:600; text-decoration:none;">🃏 Review${reviewCount}</a>
    <a href="/log" style="color:#ffd60a; text-decoration:none;">Log</a>
</div>
<div id="chunky-server-run-info" style="display:flex; gap:4px 14px; flex-wrap:wrap; padding:6px 14px; background:#1c1c1e; color:#f2f2f7; font:12px -apple-system, sans-serif;">
    <span>${runLabel}${parserLabel}</span>${snapshotSpan}
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

// Per-calendar batch ICS via the shared builder — the browser counterpart of
// the adapter's exportCalendarBatchIcs. Same timezone resolution as
// buildEventIcs. (No UID ledger here: v1 of the server is report-only and
// never rewrites the phone's run JSON.)
function buildBatchIcs(batch, cities, eventSchema) {
    if (!batch || typeof batch !== 'object' || !eventSchema) return null;
    if (typeof eventSchema.buildCalendarBatchIcs !== 'function') return null;
    const built = eventSchema.buildCalendarBatchIcs(batch.events, {
        calendarName: batch.calendarName,
        getTimezone: (event) => {
            const cityConfig = cities && event.city ? cities[event.city] : null;
            return (cityConfig && cityConfig.timezone) || event.timezone || 'UTC';
        }
    });
    if (!built || !built.icsText) return null;
    const slug = typeof eventSchema.slugifyIcsText === 'function'
        ? eventSchema.slugifyIcsText(batch.calendarName || '')
        : '';
    return { icsText: built.icsText, fileName: `${slug || 'chunky-dad'}-series.ics` };
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
// Review deck (pure renderers, exported for tests)
// ---------------------------------------------------------------------------

function resolveReviewScriptName(env = process.env) {
    const raw = env && env.CHUNKY_REVIEW_SCRIPT_NAME;
    return raw && String(raw).trim() ? String(raw).trim() : REVIEW_SCRIPT_NAME_DEFAULT;
}

// The "Execute on phone" link: opens display-saved-run.js in Scriptable with
// the run id; the phone does the rest (see the file header).
function buildScriptableExecuteLink(runId, scriptName = resolveReviewScriptName()) {
    if (!runId) return '';
    return `scriptable:///run?scriptName=${encodeURIComponent(scriptName)}&runId=${encodeURIComponent(runId)}&reviewExecute=1`;
}

// The same script, asked only to read the calendars and write the snapshot
// files (display-saved-run.js refreshCalendarSnapshots): no scrape, no write.
function buildScriptableSnapshotLink(scriptName = resolveReviewScriptName()) {
    return `scriptable:///run?scriptName=${encodeURIComponent(scriptName)}&snapshot=1`;
}

// ---- dates -----------------------------------------------------------------

function reviewZoneFormatter(timezone, options) {
    try {
        return new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', ...options });
    } catch (error) {
        return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options });
    }
}

// One instant in the event's own zone: day "Fri, Oct 3", dayYear
// "Fri, Oct 3, 2030", time "10:00 PM", zone "EDT", dayKey for same-day tests.
function reviewDateParts(iso, timezone) {
    const date = iso ? new Date(iso) : null;
    if (!date || Number.isNaN(date.getTime())) return null;
    const zone = timezone || 'UTC';
    let zoneLabel = '';
    try {
        const part = reviewZoneFormatter(zone, { timeZoneName: 'short' }).formatToParts(date)
            .find((piece) => piece.type === 'timeZoneName');
        zoneLabel = part ? part.value : '';
    } catch (error) {
        zoneLabel = '';
    }
    return {
        day: reviewZoneFormatter(zone, { weekday: 'short', month: 'short', day: 'numeric' }).format(date),
        dayYear: reviewZoneFormatter(zone, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(date),
        time: reviewZoneFormatter(zone, { hour: 'numeric', minute: '2-digit' }).format(date),
        zone: zoneLabel,
        dayKey: reviewZoneFormatter(zone, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date),
        ms: date.getTime()
    };
}

// "Fri, Oct 3, 2030 · 10:00 PM – 2:00 AM EDT" — same rules as the results
// card: an end renders only when it is strictly after the start (never a
// fabricated "9 PM – 9 PM"), an end on another day names that day, and an
// event with no timezone shows UTC and says so.
//
// `options.endDefaulted`: the page stated no end and the end on the record
// is the pipeline's one default (shared-core ONE END CONTRACT). Printed as
// a closing time it read "12:00 AM – 3:00 AM" on a party whose page names
// no hours at all; the line says what is true — none listed — and what the
// calendar will be given.
function formatReviewDateLine(startIso, endIso, timezone, options = {}) {
    const start = reviewDateParts(startIso, timezone);
    if (!start) return '';
    const end = reviewDateParts(endIso, timezone);
    // `options.wholeDay`: the event is saved as a whole day
    // (SharedCore.applyAllDayConvention) — 'all-day' for a real all-day event
    // (a festival, a weekend), 'time-unknown' for an ordinary event whose
    // time the page never gave. The line names the day — or the first and
    // last day — says which kind, and never prints a clock.
    if (options.wholeDay === 'all-day' || options.wholeDay === 'time-unknown') {
        const lastDay = end && end.dayKey !== start.dayKey ? ` – ${end.dayYear}` : '';
        const kind = options.wholeDay === 'time-unknown' ? 'time not listed (saved as all-day)' : 'all day';
        const late = typeof options.endNote === 'string' && options.endNote.trim() ? ` · the page says: ${options.endNote.trim()}` : '';
        return `${start.dayYear}${lastDay} · ${kind}${late}${timezone ? '' : ' — no timezone on the event'}`;
    }
    const hasEnd = Boolean(end && end.ms > start.ms);
    const hasRealEnd = hasEnd && options.endDefaulted !== true;
    let line = `${start.dayYear} · ${start.time}`;
    if (hasRealEnd) line += end.dayKey === start.dayKey ? ` – ${end.time}` : ` – ${end.day} ${end.time}`;
    if (start.zone) line += ` ${start.zone}`;
    if (!hasRealEnd) {
        const hours = hasEnd ? (end.ms - start.ms) / 3600000 : 0;
        line += hasEnd
            ? ` (no end listed — saved with the ${Number.isInteger(hours) ? hours : hours.toFixed(1)} h default)`
            : ' (no end listed)';
    }
    // What the page said in place of a closing time ("til late").
    if (typeof options.endNote === 'string' && options.endNote.trim()) line += ` · the page says: ${options.endNote.trim()}`;
    if (!timezone) line += ' — no timezone on the event';
    return line;
}

// The UTC verification line the results card carries ("🌍 … UTC"): the one
// thing that exposes a timezone bug before it lands on the calendar.
function formatReviewUtcLine(startIso, endIso) {
    const start = reviewDateParts(startIso, 'UTC');
    if (!start) return '';
    const end = reviewDateParts(endIso, 'UTC');
    const hasRealEnd = Boolean(end && end.ms > start.ms);
    const endText = hasRealEnd ? ` – ${end.dayKey === start.dayKey ? '' : `${end.day} `}${end.time}` : '';
    return `🌍 ${start.day} ${start.time}${endText} UTC`;
}

// "2 h later" / "30 min earlier" / "3 days later" for a changed instant.
function describeReviewTimeDelta(fromIso, toIso) {
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return '';
    const diff = to - from;
    const direction = diff > 0 ? 'later' : 'earlier';
    const minutes = Math.round(Math.abs(diff) / 60000);
    if (minutes < 60) return `${minutes} min ${direction}`;
    const hours = Math.abs(diff) / 3600000;
    if (hours < 48) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h ${direction}`;
    return `${Math.round(hours / 24)} days ${direction}`;
}

// ---- links / places --------------------------------------------------------

function reviewAnchor(href, text, extraClass = '') {
    if (!href) return escapeHtmlText(text);
    return `<a${extraClass ? ` class="${extraClass}"` : ''} href="${escapeHtmlText(href)}" target="_blank" rel="noopener noreferrer">${escapeHtmlText(text)}</a>`;
}

// The URL as stored, minus the scheme and www. — never just the domain
// (owner: a domain-only label showed "bearracuda.com → bearracuda.com" for
// a link that gained "/events/denver17/"; the path IS the change).
function reviewUrlLabel(url, maxLength = 0) {
    const text = String(url || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    if (maxLength > 0 && text.length > maxLength) return `${text.slice(0, maxLength - 1)}…`;
    return text;
}

// A link chip: @handle for instagram, the page for facebook, "maps" for the
// maps link, and the stored URL (scheme dropped, path kept) for everything
// else.
function reviewChip(ctx, kind, icon, url) {
    const adapter = ctx && ctx.adapter;
    const text = typeof url === 'string' ? url.trim() : '';
    if (!text) return '';
    const safe = adapter ? adapter.isSafeExternalUrl(text) : /^https?:\/\/\S+$/i.test(text);
    if (!safe) return '';
    const label = adapter && (kind === 'instagram' || kind === 'facebook' || kind === 'gmaps')
        ? adapter.formatLinkChipLabel(kind, text)
        : reviewUrlLabel(text, 48);
    return `<a class="chip" href="${escapeHtmlText(text)}" target="_blank" rel="noopener noreferrer" title="${escapeHtmlText(text)}">${icon ? `${icon} ` : ''}${escapeHtmlText(label)}</a>`;
}

function reviewPinLabel(ctx, coordinates) {
    const adapter = ctx && ctx.adapter;
    const pair = adapter ? adapter.parseCoordinatePairText(coordinates) : null;
    return pair ? `${pair.lat.toFixed(4)}, ${pair.lng.toFixed(4)}` : String(coordinates || '');
}

// "📍 Rockbar ↗ · 185 Christopher St ↗ · 📌 40.7331, -74.0055 ↗ · 🧭 Route ↗"
// — the results card's route line, with plain anchors (no bridge). Every
// stored place signal is one tap from a map; the Route link draws them
// against each other (a ~0 m route = the same place).
function renderReviewRouteLine(ctx, place = {}) {
    const adapter = ctx && ctx.adapter;
    const bar = String(place.bar || '').trim();
    const address = String(place.address || '').trim();
    const city = String(place.city || '').trim();
    const coordinates = String(place.coordinates || '').trim();
    const parts = [];
    // A curated bar is the one place fact worth a mark on the face: the
    // name, address and pin all come from data/bars, not from the page.
    const curatedMark = place.barSource === 'curated' ? ' <span class="curated" title="curated bar">✓</span>' : '';
    if (bar) parts.push(reviewAnchor(adapter ? adapter.buildBarMapsSearchUrl(bar, city) : '', bar) + curatedMark);
    if (address) {
        const street = address.split(',')[0].trim() || address;
        parts.push(reviewAnchor(adapter ? adapter.buildAddressMapsSearchUrl(address, city) : '', street));
    }
    if (coordinates && adapter && adapter.parseCoordinatePairText(coordinates)) {
        parts.push(reviewAnchor(adapter.buildPinMapsSearchUrl(coordinates), `📌 ${reviewPinLabel(ctx, coordinates)}`));
    }
    const route = adapter ? adapter.buildRouteMapsDirectionsUrl({ bar, city, address, coordinates }) : '';
    if (route) parts.push(reviewAnchor(route, '🧭 Route'));
    const cityName = city && adapter ? adapter.getCityDisplayNameForMaps(city) : city;
    if (parts.length === 0) return `<div class="line route">📍 (no place)${cityName ? ` <span class="muted">· ${escapeHtmlText(cityName)}</span>` : ''}</div>`;
    return `<div class="line route">📍 ${parts.join(' · ')}${cityName ? ` <span class="muted">· ${escapeHtmlText(cityName)}</span>` : ''}</div>`;
}

// ---- merge change rows -----------------------------------------------------

const REVIEW_CHANGE_LABELS = { title: 'Title', startDate: 'Starts', endDate: 'Ends', location: 'Pin', url: 'Event page', bar: 'Venue' };

// { fromHtml, toHtml, noteHtml, warn } for one changed field, in the
// language of the field: dates in the event's zone with the day printed
// once, pins as map links with the distance moved, links as domains.
function describeReviewChange(field, change, proposal, ctx) {
    const from = change && change.from != null ? String(change.from) : '';
    const to = change && change.to != null ? String(change.to) : '';
    const adapter = ctx && ctx.adapter;
    const core = ctx && ctx.core;
    const none = '<span class="none">∅</span>';
    if (field === 'startDate' || field === 'endDate') {
        const tz = proposal && proposal.timezone ? proposal.timezone : null;
        const fp = reviewDateParts(from, tz);
        const tp = reviewDateParts(to, tz);
        const sameDay = fp && tp && fp.dayKey === tp.dayKey;
        const fromHtml = fp ? escapeHtmlText(sameDay ? `${fp.day} · ${fp.time}` : `${fp.day} ${fp.time}`) : none;
        const toHtml = tp
            ? escapeHtmlText(sameDay ? tp.time : `${tp.day} ${tp.time}`)
            : (field === 'endDate' ? '<span class="none">(no end listed)</span>' : none);
        // The event becomes a whole day: the row says which kind instead of
        // printing the span's own "11:59 PM" as if it were a closing time.
        if (proposal && (proposal.wholeDay === 'all-day' || proposal.wholeDay === 'time-unknown')) {
            const kind = proposal.wholeDay === 'time-unknown' ? 'time not listed (saved as all-day)' : 'all day';
            const label = field === 'endDate'
                ? (tp && fp && tp.dayKey !== fp.dayKey ? `${kind}, through ${tp.day}` : kind)
                : (tp ? `${tp.day} · ${kind}` : kind);
            return { fromHtml, toHtml: escapeHtmlText(label), noteHtml: '', warn: false };
        }
        const delta = fp && tp ? describeReviewTimeDelta(from, to) : '';
        return { fromHtml, toHtml, noteHtml: escapeHtmlText(delta), warn: false };
    }
    if (field === 'location') {
        const fromPair = adapter && adapter.parseCoordinatePairText(from);
        const toPair = adapter && adapter.parseCoordinatePairText(to);
        const fromHtml = fromPair ? reviewAnchor(adapter.buildPinMapsSearchUrl(from), `📌 ${reviewPinLabel(ctx, from)}`) : (from ? escapeHtmlText(from) : none);
        const toHtml = toPair ? reviewAnchor(adapter.buildPinMapsSearchUrl(to), `📌 ${reviewPinLabel(ctx, to)}`) : (to ? escapeHtmlText(to) : none);
        let note = '';
        let warn = false;
        if (fromPair && toPair && core && typeof core.coordinatePairDistanceKm === 'function') {
            const km = core.coordinatePairDistanceKm(from, to);
            if (Number.isFinite(km)) {
                warn = km > 0.15;
                const directions = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(`${fromPair.lat},${fromPair.lng}`)}&destination=${encodeURIComponent(`${toPair.lat},${toPair.lng}`)}`;
                note = `${warn ? '⚠️ ' : ''}moved ${escapeHtmlText(core.formatEvidenceDistance(km))} · ${reviewAnchor(directions, '🧭 old → new')}`;
            }
        } else if (!fromPair && toPair) {
            note = 'pin added';
        } else if (fromPair && !toPair) {
            note = '⚠️ pin removed';
            warn = true;
        }
        return { fromHtml, toHtml, noteHtml: note, warn };
    }
    if (field === 'url') {
        const fromHtml = from ? reviewAnchor(from, reviewUrlLabel(from)) : none;
        const toHtml = to ? reviewAnchor(to, reviewUrlLabel(to)) : none;
        return { fromHtml, toHtml, noteHtml: '', warn: false };
    }
    return { fromHtml: from ? escapeHtmlText(from) : none, toHtml: to ? escapeHtmlText(to) : none, noteHtml: '', warn: false };
}

// `context` = { field: why } from the merge's own decision records (the
// same wording the results card shows under its rows). For an override the
// left column is the series night being replaced.
function renderReviewChangeRows(changes, proposal = {}, ctx = {}, context = {}, extraRows = '') {
    const fields = changes && typeof changes === 'object' ? Object.keys(changes) : [];
    if (fields.length === 0 && !extraRows) return '';
    const rows = fields.map((field) => {
        const described = describeReviewChange(field, changes[field] || {}, proposal, ctx);
        const label = REVIEW_CHANGE_LABELS[field] || field;
        const why = context && typeof context[field] === 'string' ? context[field] : '';
        return `<div class="chg" data-field="${escapeHtmlText(field)}"><span class="chg-k">${escapeHtmlText(label)}</span><span class="chg-v"><span class="was">${described.fromHtml}</span><span class="arrow">→</span><span class="now">${described.toHtml}</span></span>${described.noteHtml ? `<span class="chg-n${described.warn ? ' warn' : ''}">${described.noteHtml}</span>` : ''}${why ? `<span class="chg-n why">${escapeHtmlText(why)}</span>` : ''}</div>`;
    }).join('');
    const head = proposal.kind === 'override'
        ? '<span>series night has</span><span>this night becomes</span>'
        : '<span>calendar has</span><span>would become</span>';
    return `<div class="chgs"><div class="chgs-head">${head}</div>${rows}${extraRows || ''}</div>`;
}

// Notes-level changes as rows of their own, under the stored-field rows —
// with values, so an update whose stored fields all match still shows what
// it writes (CUBSCOUT: "Short name CUB-SCOUT → CUB·SCOUT"). Invisible
// characters are made visible (a soft hyphen renders as "·").
const REVIEW_NOTES_LABELS = {
    shortName: 'Short name', shorterName: 'Shorter name', description: 'Description', website: 'Website', ticketUrl: 'Tickets',
    instagram: 'Instagram', facebook: 'Facebook', cover: 'Cover', bar: 'Venue', address: 'Address', image: 'Image',
    imageVertical: 'Image (portrait)', imageHorizontal: 'Image (landscape)', bearSource: 'Bear verdict', bearReview: 'Bear review',
    festival: 'Festival', tea: 'Tea', recurrence: 'Recurrence', city: 'City', allDay: 'All-day event', timeUnknown: 'Time unknown', endNote: 'Ends'
};
function reviewVisibleText(value) {
    return String(value == null ? '' : value).replace(/\u00ad/g, '·').replace(/[\u200b\u200c\u200d\ufeff]/g, '⁞');
}
// `url` and `website` are one field under two names (the stored url, and
// the notes line that mirrors it): a link change that is already a stored
// row is not printed a second time as "Website" with the same two values
// (14 of the 20 update cards of 2026-09-29 carried both).
function isSameReviewLink(a, b) {
    const fold = (value) => reviewUrlLabel(value).replace(/\/+$/, '').toLowerCase();
    return fold(a) === fold(b);
}
function renderReviewNotesChangeRows(display = {}, shown = {}) {
    const storedUrl = shown && typeof shown === 'object' && shown.url && typeof shown.url === 'object' ? shown.url : null;
    const list = (Array.isArray(display.notesChanges) ? display.notesChanges : [])
        .filter((change) => !(change && shown && typeof shown === 'object' && shown[change.key]))
        .filter((change) => !(change && change.key === 'website' && storedUrl
            && isSameReviewLink(change.from, storedUrl.from) && isSameReviewLink(change.to, storedUrl.to)));
    if (list.length === 0) return '';
    const none = '<span class="none">∅</span>';
    const cell = (value) => {
        if (!value) return none;
        const text = reviewVisibleText(value);
        if (/^https?:\/\//i.test(text)) return reviewAnchor(text, reviewUrlLabel(text, 60));
        return escapeHtmlText(text.length > 160 ? `${text.slice(0, 160)}…` : text);
    };
    return list.map((change) => {
        const label = REVIEW_NOTES_LABELS[change.key] || change.key;
        const softHyphen = /\u00ad/.test(String(change.to || '')) || /\u00ad/.test(String(change.from || ''));
        return `<div class="chg chg-notes" data-field="${escapeHtmlText(change.key)}"><span class="chg-k">${escapeHtmlText(label)}</span><span class="chg-v"><span class="was">${cell(change.from)}</span><span class="arrow">→</span><span class="now">${cell(change.to)}</span></span>${softHyphen ? '<span class="chg-n">· marks a soft hyphen (a line-break hint, invisible on the site)</span>' : ''}</div>`;
    }).join('');
}

// ---- cards -----------------------------------------------------------------

function renderReviewBadges(display = {}) {
    const badges = [];
    if (display.bigDrift) badges.push(`<span class="badge warn drift">🧭 big drift — ${escapeHtmlText(display.bigDrift.reason || 'identity changed')} · withheld until you decide</span>`);
    if (display.recurring) badges.push(display.seriesWrite ? '<span class="badge">🔁 recurring — the phone writes it once approved</span>' : '<span class="badge">🔁 recurring — ICS only</span>');
    if (display.seriesMatchTitle) badges.push(`<span class="badge">🔁 matches saved series “${escapeHtmlText(display.seriesMatchTitle)}”</span>`);
    if (Array.isArray(display.sanityCodes) && display.sanityCodes.length > 0) badges.push(`<span class="badge warn">⚠️ ${escapeHtmlText(display.sanityCodes.join(', '))}</span>`);
    if (Array.isArray(display.slotWins) && display.slotWins.length > 0) badges.push(`<span class="badge">🪑 takes the slot from ${escapeHtmlText(display.slotWins.join(', '))} — that night is withheld</span>`);
    if (display.slotTakeover && display.slotTakeover.from) badges.push(`<span class="badge">🪑 takes the slot of the saved ${escapeHtmlText(display.slotTakeover.fromCadence || '')} night “${escapeHtmlText(display.slotTakeover.from)}”</span>`);
    if (Array.isArray(display.venueOverlaps) && display.venueOverlaps.length > 0) badges.push(`<span class="badge warn">⚔️ overlaps ${escapeHtmlText(display.venueOverlaps.join(', '))}</span>`);
    return badges.length > 0 ? `<div class="badges">${badges.join('')}</div>` : '';
}

// The big-drift facts block (review-queue buildReviewDisplayContext →
// shared-core assessMergeDrift): the identity fields that move are
// already rows above; this names the rung that matched the two records,
// the hard facts that still agree, and the two pages the owner can open
// to see for himself. Only on a card whose merge is withheld for drift.
function renderReviewDriftFacts(display = {}) {
    const drift = display && display.bigDrift && typeof display.bigDrift === 'object' ? display.bigDrift : null;
    if (!drift) return '';
    const labels = { title: 'title', startDay: 'start day', bar: 'venue', url: 'event link', location: 'pin' };
    const moved = (Array.isArray(drift.fields) ? drift.fields : [])
        .map((entry) => `${labels[entry.field] || entry.field}${entry.kind === 'rename' ? ' (renamed — no shared word)' : entry.field === 'location' && Number.isFinite(entry.km) ? ` (moved ${entry.km >= 1 ? `${entry.km.toFixed(1)} km` : `${Math.round(entry.km * 1000)} m`})` : ''}`);
    const rows = [
        `<div class="fact"><span class="fact-k">moves</span><span class="fact-v warn">${moved.length > 0 ? escapeHtmlText(moved.join(' · ')) : '—'}</span></div>`,
        `<div class="fact"><span class="fact-k">matched as one event by</span><span class="fact-v">${escapeHtmlText(drift.matchedBy || 'unknown')}</span></div>`,
        `<div class="fact"><span class="fact-k">still agrees on</span><span class="fact-v">${Array.isArray(drift.agree) && drift.agree.length > 0 ? escapeHtmlText(drift.agree.join(' · ')) : '<span class="none">nothing</span>'}</span></div>`,
        `<div class="fact"><span class="fact-k">scraped from</span><span class="fact-v">${drift.sourcePageUrl ? reviewAnchor(drift.sourcePageUrl, reviewUrlLabel(drift.sourcePageUrl, 60)) : '<span class="none">∅</span>'}</span></div>`,
        `<div class="fact"><span class="fact-k">calendar link</span><span class="fact-v">${drift.calendarUrl ? reviewAnchor(drift.calendarUrl, reviewUrlLabel(drift.calendarUrl, 60)) : '<span class="none">∅</span>'}</span></div>`
    ];
    return `<div class="drift"><div class="drift-head">🧭 Big drift — nothing is written until you decide</div>${rows.join('')}</div>`;
}

function renderReviewEvidence(lines) {
    const list = Array.isArray(lines) ? lines.filter(Boolean).slice(0, 6) : [];
    if (list.length === 0) return '';
    return `<ul class="evidence">${list.map((line) => `<li>${escapeHtmlText(line)}</li>`).join('')}</ul>`;
}

// The notes the phone would write, as labelled rows (the real parser, not a
// line splitter), behind one collapsed disclosure.
function renderReviewNotes(notes, ctx) {
    const text = typeof notes === 'string' ? notes.trim() : '';
    if (!text) return '';
    const core = ctx && ctx.core;
    let fields = null;
    if (core && typeof core.parseNotesIntoFields === 'function') {
        try {
            fields = core.parseNotesIntoFields(text);
        } catch (error) {
            fields = null;
        }
    }
    const entries = fields && typeof fields === 'object' && Object.keys(fields).length > 0
        ? Object.keys(fields).map((key) => [key, String(fields[key] == null ? '' : fields[key])])
        : text.split('\n').filter(Boolean).map((line) => {
            const index = line.indexOf(':');
            return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1).trim()] : ['', line.trim()];
        });
    const rows = entries.map(([key, value]) => {
        const shown = value.length > 160 ? `${value.slice(0, 160)}… (${value.length} chars)` : value;
        return `<tr><th>${escapeHtmlText(key)}</th><td>${escapeHtmlText(shown)}</td></tr>`;
    }).join('');
    return `<details class="notes"><summary>📝 Calendar notes (${entries.length})</summary><table>${rows}</table></details>`;
}

function renderReviewThumb(display = {}, fallbackImage = '') {
    const image = String(display.image || fallbackImage || '').trim();
    if (!image) return '';
    const orientation = display.imageOrientation && display.imageOrientation !== 'unknown' ? display.imageOrientation : '';
    const dims = display.imageDimensions && display.imageDimensions.width && display.imageDimensions.height ? display.imageDimensions : null;
    const repeat = Number(display.imageRepeatCount) || 0;
    const placeholder = repeat >= 3;
    // Tap-to-enlarge is wired by the page (a tap that did not become a
    // swipe), so no inline handler here.
    return `<div class="thumb${orientation ? ` ${orientation}` : ''}${placeholder ? ' placeholder' : ''}"><img src="${escapeHtmlText(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.style.display='none'"${dims ? ` style="aspect-ratio:${dims.width}/${dims.height}"` : ''}>${placeholder ? `<div class="thumb-badge">🖼️ placeholder ×${repeat}</div>` : ''}</div>`;
}

// The bear check, as information: what the run decided and why, plus any
// verdict already stored. The verdict itself is a gesture, never a button —
// on a dropped card the swipe IS the verdict; on a kept card, rejecting with
// the "not bear" chip records one (one gesture, both stores).
function renderReviewBearRow(display = {}, proposal = {}) {
    const stored = display.bearVerdict === 'bear' || display.bearVerdict === 'not_bear' ? display.bearVerdict : null;
    let state;
    if (proposal.kind === 'dropped') {
        const reason = String(proposal.dropReason || '').replace(/^ai:\s*/i, 'AI: ');
        state = `🚫 dropped as not bear${reason ? ` — ${reason}` : ''}`;
    } else if (display.bearReview) {
        state = `🐻 kept, but ${display.bearReview}`;
    } else if (display.bearSource) {
        state = `🐻 bear — ${display.bearSource}`;
    } else {
        state = '🐻 bear (no check recorded)';
    }
    const storedText = stored
        ? `<span class="bear-stored">you said: ${stored === 'bear' ? '🐻 bear' : '🚫 not bear'}${display.bearVerdictStampedAt ? ` (${escapeHtmlText(String(display.bearVerdictStampedAt).slice(0, 10))})` : ''}${display.bearVerdictOn ? ` — on the same party, listed as “${escapeHtmlText(display.bearVerdictOn)}”` : ''}</span>`
        : '';
    return `<div class="bear-row"><div class="bear-state">${escapeHtmlText(state)}${storedText ? ` ${storedText}` : ''}</div></div>`;
}

function renderReviewBarCard(entry, ctx = {}) {
    const proposal = entry.proposal || {};
    const adapter = ctx.adapter;
    const core = ctx.core;
    const city = String(proposal.city || '');
    const cityName = adapter ? adapter.getCityDisplayNameForMaps(city) : city;
    let distance = '';
    if (core && typeof core.getCityCenterCoordinatePair === 'function') {
        const center = core.getCityCenterCoordinatePair(city);
        const km = center ? core.coordinatePairDistanceKm(center, proposal.coordinates) : null;
        if (Number.isFinite(km)) distance = `${core.formatEvidenceDistance(km)} from ${cityName || 'the city'} center`;
    }
    const facts = [distance, proposal.signals && proposal.signals.length ? `seen as ${proposal.signals.join(', ')}` : ''].filter(Boolean);
    const sources = (proposal.sourceEvents || []).map((event) => {
        const parts = reviewDateParts(event.date, null);
        return `<li>${escapeHtmlText(event.title || '')}${parts ? ` <span class="muted">— ${escapeHtmlText(parts.day)}</span>` : ''}</li>`;
    }).join('');
    const embed = adapter ? adapter.buildOsmEmbedUrl(proposal.coordinates) : '';
    return `<div class="card-body">
  <div class="kind kind-bar">🏳️‍🌈 New bar</div>
  <h2>${escapeHtmlText(proposal.name)}</h2>
  ${renderReviewRouteLine(ctx, { bar: proposal.name, address: proposal.address, city, coordinates: proposal.coordinates })}
  ${facts.length ? `<div class="line muted">${escapeHtmlText(facts.join(' · '))}</div>` : ''}
  <div class="chips">${reviewChip(ctx, 'website', '🔗', proposal.website)}${reviewChip(ctx, 'instagram', '📸', adapter ? adapter.normalizeInstagramChipUrl(proposal.instagram) : proposal.instagram)}</div>
  ${embed ? `<div class="map"><iframe src="${escapeHtmlText(embed)}" loading="lazy" title="map"></iframe></div>` : ''}
  ${sources ? `<div class="label">Events seen here</div><ul class="sources">${sources}</ul>` : ''}
  ${renderReviewEvidence(proposal.evidence)}
</div>`;
}

// One card's HTML. `entry.proposal` is the decision snapshot (what gets
// stored); `entry.display` is everything else the owner needs to judge it,
// read from the full analyzed event at deck time and absent on entries
// re-rendered from a stored snapshot. `ctx` = { adapter, core } for the maps
// URL builders, link labels and distances; every part degrades without it.
// A card the owner already judged, back because the scraper now shows
// something else for it (tools/review-queue.js attaches `prior`): say so,
// with the earlier reason and what changed, so a fix gets its second look
// with the first verdict in view.
function renderReviewPriorRow(prior) {
    if (!prior || (prior.verdict !== 'reject' && prior.verdict !== 'approve')) return '';
    const when = prior.stampedAt ? String(prior.stampedAt).slice(0, 10) : '';
    const reason = prior.reason
        ? [Array.isArray(prior.reason.tags) ? prior.reason.tags.join(', ') : '', prior.reason.text || ''].filter(Boolean).join(' — ')
        : '';
    const changed = Array.isArray(prior.drift) && prior.drift.length > 0 ? prior.drift.join(', ') : '';
    const drift = prior.night ? (changed || 'nothing visible') : (changed ? `changed since: ${changed}` : 'nothing changed');
    // A decision on another night of the same party: this night is on the
    // deck only because it looks different (a new flyer, another host).
    const what = prior.night ? ` this party's ${escapeHtmlText(prior.night)} night` : ' this';
    const back = prior.night ? 'This night differs' : 'Back for a second look';
    return `<div class="prior">↩︎ You ${prior.verdict === 'reject' ? 'rejected' : 'approved'}${what}${when ? ` on ${escapeHtmlText(when)}` : ''}${reason ? ` — “${escapeHtmlText(reason)}”` : ''}. ${back}: ${escapeHtmlText(drift)}.</div>`;
}

// Calendar link memory on a NEW card: the link came from an earlier
// night of this party, or there is none anywhere — which is the moment a
// paste into any occurrence pays off for every later night.
function renderReviewLinkHistory(entry, proposal, display) {
    if (!entry || entry.kind !== 'new') return '';
    const history = display && display.linkHistory && typeof display.linkHistory === 'object' ? display.linkHistory : null;
    if (!history) return '';
    if (history.website && (history.website === proposal.url || history.website === proposal.ticketUrl)) {
        return `<div class="line muted">🔗 link inherited from the calendar's ${escapeHtmlText(history.from || 'earlier')} night of this party</div>`;
    }
    if (!proposal.url && !proposal.ticketUrl && history.occurrences > 0) {
        return `<div class="line muted">🔗 no link on this row or on the calendar's ${history.occurrences} earlier night${history.occurrences === 1 ? '' : 's'} of this party — paste one into any occurrence and later nights inherit it</div>`;
    }
    return '';
}

function renderReviewCard(entry, ctx = {}) {
    if (entry && entry.kind === 'bar') return renderReviewBarCard(entry, ctx);
    const proposal = entry && entry.proposal ? entry.proposal : {};
    const display = entry && entry.display ? entry.display : {};
    const adapter = ctx.adapter;
    const isOverride = entry.kind === 'override';
    const isMerge = entry.kind === 'merge' || isOverride;
    const isDropped = entry.kind === 'dropped';
    const isSeries = entry.kind === 'series';
    const tz = proposal.timezone || null;
    const endDefaulted = display.endDefaulted === true;
    const wholeDay = proposal.wholeDay === 'all-day' || proposal.wholeDay === 'time-unknown' ? proposal.wholeDay : '';
    const dateLine = formatReviewDateLine(proposal.startDate, proposal.endDate, tz, { endDefaulted, wholeDay, endNote: proposal.endNote });
    // A whole-day event is a day, not an instant: no UTC line to check.
    const utcLine = wholeDay ? '' : formatReviewUtcLine(proposal.startDate, endDefaulted ? null : proposal.endDate);
    const changes = isMerge && proposal.changes && typeof proposal.changes === 'object' ? proposal.changes : {};
    const existingTitle = isMerge && proposal.existingTitle && proposal.existingTitle !== proposal.title && !changes.title
        ? `<div class="line muted">${isOverride ? 'series' : 'calendar title'}: ${escapeHtmlText(proposal.existingTitle)}</div>`
        : '';
    const overrideNight = isOverride && proposal.overrideOf
        ? (() => { const parts = reviewDateParts(proposal.overrideOf, tz); return parts ? `<div class="line muted">replaces the series night of ${escapeHtmlText(parts.day)} (${escapeHtmlText(proposal.existingTitle || 'series')})</div>` : ''; })()
        : '';
    // A series card: the rule in words, the first night, and the nights
    // the rule yields next — what the phone would put on the calendar as
    // ONE recurring event. Nothing in it comes from EventKit.
    const seriesLines = isSeries
        ? (() => {
            const nowMs = Date.now();
            const nights = (Array.isArray(proposal.seriesNights) ? proposal.seriesNights : [])
                .filter((night) => { const ms = Date.parse(night); return Number.isFinite(ms) && ms >= nowMs; })
                .map((night) => reviewDateParts(night, tz)).filter(Boolean);
            const start = reviewDateParts(proposal.startDate, tz);
            const bounded = /COUNT=|UNTIL=/.test(String(proposal.recurrence || ''));
            return `<div class="line">🔁 ${escapeHtmlText(proposal.recurrenceWords || proposal.recurrence || 'repeats')}${start ? ` · ${escapeHtmlText(start.time)}` : ''}${proposal.recurrenceWords ? ` <span class="muted">(${escapeHtmlText(proposal.recurrence || '')})</span>` : ''}</div>`
                + (nights.length ? `<div class="line muted">next: ${escapeHtmlText(nights.slice(0, 4).map((night) => night.day).join(', '))}${nights.length > 4 ? ', …' : ''}</div>` : '')
                + `<div class="line muted">one recurring calendar event${bounded ? '' : ', no end date — it runs until you end it on the phone'}</div>`;
        })()
        : '';
    const cityConfig = adapter && adapter.cities && proposal.city ? adapter.cities[proposal.city] : null;
    const calendarName = cityConfig && typeof cityConfig.calendar === 'string' ? cityConfig.calendar : '';
    const sourceBits = [
        display.parserName || proposal.source || 'unknown source',
        display.pageHost ? `from ${display.pageHost}` : '',
        calendarName ? `📱 ${calendarName}` : ''
    ].filter(Boolean);
    const description = String(proposal.description || '');
    const instagram = adapter ? adapter.normalizeInstagramChipUrl(display.instagram) : display.instagram;
    // The favicon field is the event's OWN brand site (Goldiloxx's
    // linktr.ee, not Red Eye's homepage), so it leads the links when it
    // differs from the event page.
    const brand = display.favicon && reviewUrlLabel(display.favicon) !== reviewUrlLabel(proposal.url) ? display.favicon : '';
    const chips = [
        reviewChip(ctx, 'brand', '🏷', brand),
        reviewChip(ctx, 'website', '🔗', proposal.url),
        reviewChip(ctx, 'tickets', '🎟', proposal.ticketUrl),
        reviewChip(ctx, 'instagram', '📸', instagram),
        reviewChip(ctx, 'facebook', '📘', display.facebook),
        reviewChip(ctx, 'gmaps', '🗺', display.gmaps),
        proposal.cover ? `<span class="chip">💵 ${escapeHtmlText(proposal.cover)}</span>` : ''
    ].filter(Boolean).join('');
    return `<div class="card-body">
  ${renderReviewThumb(display, proposal.image)}
  <div class="kind-row"><span class="kind ${isMerge ? 'kind-merge' : isDropped ? 'kind-dropped' : 'kind-new'}">${isSeries ? '🔁 New series — one recurring event' : isOverride ? '🗓️ Override — this night only' : isMerge ? '🔀 Update saved event' : isDropped ? '🚫 Dropped as not bear' : '✨ New event'}</span>${isDropped && proposal.occurrences > 1 ? `<span class="muted reason">${proposal.occurrences} occurrences</span>` : display.analysisReason ? `<span class="muted reason">${escapeHtmlText(display.analysisReason)}</span>` : ''}</div>
  ${renderReviewPriorRow(entry.prior)}
  <h2>${escapeHtmlText(proposal.title)}</h2>
  ${existingTitle}
  ${overrideNight}
  ${seriesLines}
  ${renderReviewBadges({ ...display, seriesWrite: isSeries })}
  <div class="line">📅 ${isSeries ? 'first night: ' : ''}${escapeHtmlText(dateLine)}</div>
  ${utcLine ? `<div class="utc">${escapeHtmlText(utcLine)}</div>` : ''}
  ${renderReviewRouteLine(ctx, { bar: proposal.bar, address: proposal.address, city: proposal.city, coordinates: proposal.location, barSource: display.barSource })}
  <div class="line muted">${escapeHtmlText(sourceBits.join(' · '))}</div>
  ${chips ? `<div class="chips">${chips}</div>` : ''}
  ${renderReviewLinkHistory(entry, proposal, display)}
  ${renderReviewBearRow(display, proposal)}
  ${renderReviewFriendRows(entry)}
  ${renderReviewPictureRow(entry)}
  ${isMerge ? renderReviewChangeRows(changes, proposal, ctx, display.changeContext, renderReviewNotesChangeRows(display, changes)) : ''}
  ${isMerge ? renderReviewDriftFacts(display) : ''}
  ${description ? `<div class="desc clamped">${escapeHtmlText(description)}</div>${description.length > 220 ? '<div class="desc-more">… more</div>' : ''}` : ''}
  ${renderReviewNotes(display.notes, ctx)}
</div>`;
}

// What friends said about this card (phone a friend), and who was asked
// and has not answered yet. Advice is evidence; the swipe stays the owner's.
function renderReviewFriendRows(entry = {}) {
    const advice = Array.isArray(entry.advice) ? entry.advice : [];
    const asked = Array.isArray(entry.asked) ? entry.asked : [];
    const word = (answer) => ({ yes: '✅ looks right', no: '🚫 not bear', fix: '🔧 needs a fix', 'not-event': '🗑 not an event', off: '✕ something’s off', unsure: '🤔 not sure' }[answer] || '🤔 not sure');
    const rows = advice.map((row) => `<div class="line friend">🙋 ${escapeHtmlText(row.friend)}: ${word(row.answer)}${Array.isArray(row.tags) && row.tags.length ? ` (${escapeHtmlText(row.tags.join(', '))})` : ''}${row.note ? ` — “${escapeHtmlText(row.note)}”` : ''}</div>`);
    if (asked.length > 0) rows.push(`<div class="line muted">🙋 asked ${escapeHtmlText(asked.map((a) => a.friend).join(', '))} — no answer yet</div>`);
    return rows.join('\n');
}

// An inbox picture on its way to the website (see review-queue
// publishSharedPicture): review-only until approved, then waiting on the
// pictures PR, then on the website.
function renderReviewPictureRow(entry = {}) {
    const picture = entry.picture && typeof entry.picture === 'object' ? entry.picture : null;
    if (!picture) return '';
    if (picture.state === 'published') return `<div class="line muted">🖼️ picture is on the website</div>`;
    if (picture.state === 'pr') return `<div class="line muted">🖼️ picture waits for the pictures PR${picture.pr && picture.pr.number ? ` <a href="${escapeHtmlText(String(picture.pr.url || ''))}">#${escapeHtmlText(String(picture.pr.number))}</a>` : ''} — merge it before executing to put it on the event</div>`;
    return `<div class="line muted">🖼️ picture from your inbox — shown here only; approving sends it to the website through a PR</div>`;
}

function renderReviewEmptyPage(message, options = {}) {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review · chunky.dad</title></head>
<body style="font:15px -apple-system, sans-serif; max-width:640px; margin:40px auto; padding:0 16px;">
<h1>🃏 Review</h1>
<p>${escapeHtmlText(message)}</p>
${options.sharedRoot ? `<p style="opacity:0.7;">Shared dir: <code>${escapeHtmlText(options.sharedRoot)}</code></p>` : ''}
<p><a href="/">← Results</a> · <a href="/run-form">▶ Run scraper</a></p>
</body></html>`;
}

// The deck page. Cards are server-rendered (renderReviewCard) and shipped
// inline with the deck JSON; the page script owns the stack, the swipe
// gesture, the reject sheet, undo, and the decide POSTs.
// THE FRIEND'S PAGE (advice/index.html on the website — owner, 2026-10-03:
// "same ui that I have for the most part. It should get our future
// improvements too"). It IS the review deck, rendered in friend mode with
// no cards: the same CSS, card stack, gestures and reasons sheet. The
// cards arrive in the link as the deck's own card HTML; decisions stay on
// the page and leave as a reply link. tools/build-advice-page.js writes
// it; a test fails when the committed file is not what this renders, so
// every deck change reaches friends with the next build.
function renderFriendPage() {
    return renderReviewPage({ runId: '', savedAt: null, environment: null, cards: [], decided: [], counts: {}, waitingGone: [], friends: [] },
        { friendMode: true, runs: [], ctx: {}, scriptName: 'display-saved-run' });
}

function renderReviewPage(deck, options = {}) {
    const runs = Array.isArray(options.runs) ? options.runs : [];
    const scriptLink = buildScriptableExecuteLink(deck.runId, options.scriptName);
    const ctx = options.ctx || {};
    const cards = deck.cards.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        key: entry.key,
        sourceIndex: entry.sourceIndex,
        proposal: entry.proposal,
        bearIdentity: entry.display && entry.display.bearIdentity ? entry.display.bearIdentity : null,
        fixTarget: entry.fixTarget || null,
        series: entry.series || null,
        asked: entry.asked || [],
        advice: entry.advice || [],
        picture: entry.picture || null,
        html: renderReviewCard(entry, ctx)
    }));
    const decided = deck.decided.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        key: entry.key,
        verdict: entry.decision.verdict,
        stampedAt: entry.decision.stampedAt || null,
        reason: entry.decision.reason || null,
        executed: entry.executed || null,
        pendingExecute: entry.pendingExecute === true,
        via: entry.via || null,
        rejectionMode: entry.rejectionMode || '',
        title: entry.kind === 'bar' ? entry.proposal.name : entry.proposal.title,
        proposal: entry.proposal,
        bearIdentity: entry.display && entry.display.bearIdentity ? entry.display.bearIdentity : null,
        fixTarget: entry.fixTarget || null,
        noteKey: entry.noteKey || '',
        asked: entry.asked || [],
        advice: entry.advice || [],
        picture: entry.picture || null,
        html: renderReviewCard(entry, ctx)
    }));
    const payload = {
        runId: deck.runId,
        savedAt: deck.savedAt,
        environment: deck.environment,
        cards,
        decided,
        waitingGone: Array.isArray(deck.waitingGone) ? deck.waitingGone : [],
        counts: deck.counts,
        lastExecution: deck.lastExecution || null,
        tags: reviewQueue.REVIEW_REASON_TAGS,
        executeLink: scriptLink,
        friends: Array.isArray(deck.friends) ? deck.friends : [],
        adviceBase: deck.adviceBase || reviewQueue.ADVICE_PAGE_DEFAULT_BASE,
        // The friend's copy of this page (renderFriendPage): no server
        // behind it — the cards arrive in the link, the answers leave in one.
        friendMode: options.friendMode === true
    };
    // The newest 20 runs, plus the deck's own run when it is older than that
    // (the picker must always show what is on screen).
    const listed = runs.slice(0, 20);
    if (deck.runId && !listed.some((run) => run.runId === deck.runId)) {
        listed.push({ runId: deck.runId, available: true });
    }
    const runOptions = listed.map((run) => {
        const selected = run.runId === deck.runId ? ' selected' : '';
        const shapeLabel = reviewQueue.describeRunShapeLabel(run.shape);
        const label = `${run.runId}${run.available ? '' : ' (syncing)'}${shapeLabel ? ` · ${shapeLabel}` : ''}`;
        return `<option value="${escapeHtmlText(run.runId)}"${selected}${run.available ? '' : ' disabled'}>${escapeHtmlText(label)}</option>`;
    }).join('');
    const SharedCore = require(path.join(repoRoot, 'scripts', 'shared-core')).SharedCore;
    const shapeLabel = reviewQueue.describeRunShapeLabel(deck.runShape);
    const savedLabel = deck.savedAt || deck.runId
        ? escapeHtmlText(`run ${SharedCore.formatRunAgeLabel(deck.savedAt, deck.runId)}${shapeLabel ? ` · ${shapeLabel}` : ''}`)
        : '';
    const missingCalendars = Array.isArray(deck.missingCalendars) ? deck.missingCalendars : [];
    const snapshotLink = buildScriptableSnapshotLink(options.scriptName);
    const phoneListAge = typeof options.phoneCalendarListCapturedAt === 'string' && options.phoneCalendarListCapturedAt
        ? options.phoneCalendarListCapturedAt.slice(0, 10)
        : '';
    // The snapshot refresh is always on the page, not only inside the
    // missing-calendar notice (owner, 2026-09-30: "I don't see an option to
    // refresh the local file on scriptable" — the notice was the only place
    // it lived, and it shows only while a calendar is missing).
    const snapshotBlock = `<div class="snapshot"><a href="${escapeHtmlText(snapshotLink)}">🔄 Refresh the phone's calendar snapshot</a><small>Opens Scriptable: reads the phone's calendars and rewrites the snapshot the Mac analyses against — no scrape, no calendar write.${phoneListAge ? ` The phone's calendar list is from ${escapeHtmlText(phoneListAge)}.` : ''}</small></div>`;
    const missingCalendarNotice = missingCalendars.length > 0
        ? `<div class="missing-cal">❌ No calendar on the phone for ${missingCalendars.map((entry) => `<b>${escapeHtmlText(entry.city)}</b> (${escapeHtmlText(entry.calendarName)} · ${entry.events} event${entry.events === 1 ? '' : 's'})`).join(', ')} — the phone cannot write those until a calendar with that exact name exists.${phoneListAge ? ` The phone's calendar list is from ${escapeHtmlText(phoneListAge)}.` : ''} <a href="${escapeHtmlText(snapshotLink)}">Refresh it on the phone</a> after adding calendars.</div>`
        : '';
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">${options.friendMode === true ? '\n<meta name="robots" content="noindex">' : ''}
<title>${options.friendMode === true ? 'A few events to check' : 'Review'} · chunky.dad</title>
<style>
:root { --bg:#f4f2ee; --card:#ffffff; --ink:#1d1b18; --muted:#6f6a62; --line:#e2ddd4; --accent:#ff6b35; --ok:#2f9e5f; --no:#d0453c; --skip:#8a8378; --shadow:0 12px 32px rgba(40,30,10,0.18); }
@media (prefers-color-scheme: dark) { :root { --bg:#151412; --card:#23211d; --ink:#f2efe9; --muted:#a39d92; --line:#3a362f; --shadow:0 12px 32px rgba(0,0,0,0.55); } }
* { box-sizing:border-box; }
html, body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.4 -apple-system, "SF Pro Text", system-ui, sans-serif; -webkit-text-size-adjust:100%; }
/* iOS Safari zoom traps: a double-tap on a button (two quick swipes or
   taps on Approve/Reject) is a double-tap-to-zoom unless the element opts
   out with touch-action:manipulation, and focusing any form control whose
   font is under 16px auto-zooms the page in (and back out on blur) — the
   reject sheet's textarea did exactly that. Pinch-zoom stays allowed. */
html, body, button, a, .controls, .sheet, .top { touch-action:manipulation; }
select, textarea, input { font-size:16px; }
a { color:var(--accent); }
.top { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:6px 14px; align-items:center; padding:8px 14px; padding-top:calc(8px + env(safe-area-inset-top)); background:var(--bg); border-bottom:1px solid var(--line); }
/* Every row of the header is a row the card does not get: on a phone the
   Results link shares the first row with the run picker instead of taking
   a row of its own under the pills, and the age line and pills follow. */
@media (max-width: 700px) { .top .top-age { flex-basis:100%; } }
@media (min-width: 701px) { .top > a { order:9; } }
.top h1 { font-size:17px; margin:0; }
.top select { font:inherit; font-size:16px; padding:4px 8px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--ink); }
.pills { display:flex; gap:6px; flex-wrap:wrap; }
.pill { font-size:12px; padding:3px 9px; border-radius:999px; border:1px solid var(--line); background:var(--card); color:var(--muted); cursor:pointer; }
.pill.on { border-color:var(--accent); color:var(--ink); font-weight:600; }
.pill b { color:var(--ink); }
/* The stack's height is what the screen has left once the header, the
   buttons and the hint line are on it (fitStage in the page script sets
   --stage-h). A fixed 68vh put the Approve / Not yet row below the fold on
   any screen shorter than ~770px — iPhone Safari with its toolbars showing
   is 664px — and the flyer, sized in vh, took the card with it. */
.stage { position:relative; max-width:560px; margin:14px auto 0; padding:0 14px; height:var(--stage-h, min(68vh, 640px)); }
.card { position:absolute; inset:0 14px; background:var(--card); border-radius:18px; box-shadow:var(--shadow); overflow:hidden; touch-action:pan-y; user-select:none; -webkit-user-select:none; transition:transform .25s ease, opacity .25s ease; will-change:transform; }
.card.dragging { transition:none; }
.card.behind { opacity:.85; pointer-events:none; }
.card.behind2 { opacity:.6; pointer-events:none; }
.card.gone-right, .card.gone-left, .card.gone-down { pointer-events:none; }
.card.behind, .card.behind2 { transform:translate3d(0,10px,0) scale(.96); }
.card.behind2 { transform:translate3d(0,20px,0) scale(.92); }
@media (prefers-reduced-motion: reduce) { .card { transition:none; } }
.card-body { height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:14px 16px 18px; }
.thumb { margin:-14px -16px 12px; background:#0d0c0b; display:flex; justify-content:center; position:relative; cursor:zoom-in; }
.card { -webkit-touch-callout:none; }
.thumb img { display:block; max-width:100%; width:auto; height:auto; max-height:40vh; max-height:calc(var(--stage-h, 68vh) * 0.59); object-fit:contain; }
.thumb.portrait img { max-height:46vh; max-height:calc(var(--stage-h, 68vh) * 0.68); }
.thumb.landscape img { width:100%; max-height:32vh; max-height:calc(var(--stage-h, 68vh) * 0.47); }
.thumb.placeholder img { filter:grayscale(1); opacity:.5; }
.thumb-badge { position:absolute; left:10px; bottom:10px; font-size:11px; background:rgba(0,0,0,.65); color:#fff; padding:2px 8px; border-radius:999px; }
.kind-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:8px; }
.kind-row .reason { font-size:12px; }
.badges { display:flex; flex-wrap:wrap; gap:6px; margin:6px 0; }
.badge { font-size:12px; padding:2px 8px; border-radius:6px; background:var(--bg); border:1px solid var(--line); color:var(--ink); }
.badge.warn { color:var(--no); border-color:var(--no); }
.utc { font-size:12px; color:var(--muted); margin:0 0 3px 22px; }
.route a { color:var(--ink); text-decoration:underline; text-decoration-color:var(--line); text-underline-offset:3px; }
.chgs { margin:10px 0; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
.chgs-head { display:flex; justify-content:space-between; padding:5px 10px; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); background:var(--bg); }
.chg { display:grid; grid-template-columns:84px 1fr; gap:3px 10px; padding:8px 10px; border-top:1px solid var(--line); font-size:14px; }
.chg-k { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); padding-top:2px; }
.chg-v { word-break:break-word; }
.chg .was { color:var(--muted); }
.chg .arrow { margin:0 6px; color:var(--muted); }
.chg .now { color:var(--ok); font-weight:600; }
.chg .now a { color:var(--ok); }
.chg .none { color:var(--muted); font-style:italic; font-weight:400; }
.chg-n { grid-column:2; font-size:12px; color:var(--muted); }
.chg-n.warn { color:var(--no); font-weight:600; }
.chg-n.why { color:var(--ink); opacity:.8; }
.chg-notes .now { color:var(--ink); }
.badge.drift { font-weight:600; }
.drift { margin:10px 0; border:1px solid var(--no); border-radius:10px; overflow:hidden; }
.drift-head { padding:5px 10px; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--no); background:var(--bg); font-weight:600; }
.fact { display:grid; grid-template-columns:96px 1fr; gap:3px 10px; padding:7px 10px; border-top:1px solid var(--line); font-size:13px; }
.fact-k { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); padding-top:2px; }
.fact-v { word-break:break-word; }
.fact-v.warn { color:var(--no); font-weight:600; }
.fact-v .none { color:var(--muted); font-style:italic; }
.evidence { margin:8px 0 0; padding-left:18px; font-size:12px; color:var(--muted); }
.notes { margin-top:10px; font-size:12px; }
.notes summary { cursor:pointer; color:var(--muted); }
.notes table { width:100%; border-collapse:collapse; margin-top:6px; }
.notes th, .notes td { text-align:left; vertical-align:top; padding:3px 6px; border-top:1px solid var(--line); word-break:break-word; }
.notes th { color:var(--muted); font-weight:600; width:30%; }
.map { margin:10px -16px 0; height:170px; pointer-events:none; background:var(--bg); }
.map iframe { width:100%; height:100%; border:0; }
.desc-more { font-size:12px; color:var(--accent); cursor:pointer; margin-top:2px; }
.desc:not(.clamped) + .desc-more { display:none; }
.lightbox { position:fixed; inset:0; z-index:40; display:none; align-items:center; justify-content:center; background:rgba(5,6,10,.93); padding:calc(14px + env(safe-area-inset-top)) 14px calc(14px + env(safe-area-inset-bottom)); cursor:zoom-out; }
.lightbox.open { display:flex; }
.lightbox img { max-width:100%; max-height:100%; width:auto; height:auto; object-fit:contain; border-radius:12px; box-shadow:0 18px 60px rgba(0,0,0,.6); }
.kind { display:inline-block; font-size:12px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; padding:3px 8px; border-radius:6px; margin-bottom:8px; }
.kind-new { background:rgba(47,158,95,.14); color:var(--ok); }
.kind-merge { background:rgba(255,107,53,.16); color:var(--accent); }
.kind-bar { background:rgba(80,120,255,.14); color:#4a6cf7; }
.kind-dropped { background:rgba(208,69,60,.14); color:var(--no); }
.curated { color:var(--ok); font-weight:700; }
.bear-row { margin:8px 0; padding:6px 10px; border:1px solid var(--line); border-radius:10px; background:var(--bg); font-size:13px; }
.missing-cal { margin:8px 16px 0; padding:8px 12px; border:1px solid var(--no); border-radius:10px; font-size:13px; background:var(--card); }
.series { margin:0 0 8px; padding:6px 10px; border:1px solid var(--line); border-radius:10px; font-size:13px; background:var(--bg); }
.series .nights { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
.series .nights .chip { font-size:12px; padding:2px 8px; }
.sheet-modes { display:grid; gap:8px; margin:10px 0 12px; }
.sheet-modes .mode { display:flex; flex-direction:column; gap:2px; text-align:left; font:inherit; padding:12px 14px; border-radius:12px; border:1px solid var(--line); background:var(--bg); color:var(--ink); cursor:pointer; }
.sheet-modes .mode b { font-size:16px; }
.sheet-modes .mode span { font-size:12px; color:var(--muted); }
.sheet-modes .mode-fix { border-color:var(--accent, #ff6b35); }
.sheet.fix-first .sheet-modes .mode:not(.mode-fix) { opacity:.45; }
.sheet.fix-first .sheet-modes .mode-fix { border-width:2px; }
.sheet-fix-note, .waiting-note { font-size:12px; color:var(--muted); margin:0 0 6px; }
.sheet-friend { display:none; gap:6px; flex-wrap:wrap; align-items:center; margin:0 0 10px; }
.sheet.ask .sheet-friend { display:flex; }
.sheet-friend input { flex:1 1 140px; font:inherit; padding:8px 10px; border-radius:10px; border:1px solid var(--line); background:var(--bg); color:var(--ink); }
.line.friend { color:var(--ink); font-weight:600; }
.friends .who { display:flex; gap:8px; align-items:center; flex-wrap:wrap; padding:10px 0 4px; font-weight:600; }
.friends .who button, .friends .reply button { font:inherit; font-size:13px; border:1px solid var(--line); border-radius:8px; background:var(--accent); color:#fff; padding:5px 10px; cursor:pointer; }
.friends .reply { display:flex; gap:8px; margin:8px 0 4px; }
.friends .reply input { flex:1; font:inherit; font-size:13px; padding:6px 10px; border-radius:8px; border:1px solid var(--line); background:var(--bg); color:var(--ink); }
.friends .link { font-size:12px; color:var(--muted); word-break:break-all; margin:4px 0; }
.waiting li .status { font-size:12px; color:var(--muted); }
.series-note { margin-top:4px; color:var(--muted); font-size:12px; }
.series .change-row { margin-top:6px; font-size:13px; overflow-wrap:anywhere; }
.series-join { font:inherit; font-size:12px; background:none; border:1px solid var(--line); border-radius:8px; color:var(--ink); padding:2px 8px; cursor:pointer; }
.series .nights a.chip { text-decoration:none; color:inherit; }
.night-compare { margin-top:6px; font-size:12px; }
.night-compare summary { cursor:pointer; color:var(--muted); }
.night-table { overflow-x:auto; margin-top:4px; }
.night-table table { border-collapse:collapse; width:100%; }
.night-table th, .night-table td { text-align:left; vertical-align:top; padding:3px 8px 3px 0; border-top:1px solid var(--line); white-space:nowrap; }
.night-table th { color:var(--muted); font-weight:500; border-top:none; }
.night-table td a { color:inherit; }
.night-thumb { width:36px; height:36px; object-fit:cover; border-radius:4px; display:block; }
.series-split { font:inherit; font-size:12px; background:none; border:1px solid var(--line); border-radius:8px; color:var(--ink); padding:2px 8px; cursor:pointer; }
.prior { margin:0 0 8px; padding:6px 10px; border:1px dashed var(--no); border-radius:10px; font-size:13px; }
.bear-stored { font-weight:600; }
h2 { font-size:20px; line-height:1.2; margin:0 0 8px; text-wrap:balance; }
.line { margin:3px 0; }
.muted { color:var(--muted); }
.label { margin-top:12px; font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
.chips { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0; }
.chip { font-size:13px; padding:4px 10px; border-radius:999px; border:1px solid var(--line); text-decoration:none; color:var(--ink); background:var(--bg); }
.chip.on { background:var(--accent); border-color:var(--accent); color:#fff; }
.desc { margin-top:10px; white-space:pre-line; color:var(--ink); }
.desc.clamped { display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; }
.sources { margin:4px 0 0; padding-left:18px; }
.stamp { position:absolute; top:22px; padding:6px 12px; border:3px solid; border-radius:8px; font-weight:800; font-size:22px; letter-spacing:.08em; opacity:0; transform:rotate(-12deg); pointer-events:none; }
.stamp.ok { left:18px; color:var(--ok); border-color:var(--ok); }
.stamp.no { right:18px; color:var(--no); border-color:var(--no); transform:rotate(12deg); }
.stamp.ask { left:50%; top:18px; color:var(--accent); border-color:var(--accent); transform:translateX(-50%) rotate(-3deg); font-size:18px; white-space:nowrap; }
.controls { display:flex; justify-content:center; align-items:center; gap:8px; padding:16px 10px 6px; }
.controls button { font:inherit; font-weight:700; border:none; border-radius:999px; padding:12px 14px; color:#fff; cursor:pointer; min-width:0; white-space:nowrap; flex:1 1 auto; max-width:150px; }
.btn-no { background:var(--no); } .btn-ok { background:var(--ok); } .btn-skip { background:var(--skip); flex:0 1 auto; padding:10px 12px; }
.controls .btn-notbear { background:var(--card); color:var(--ink); border:1px solid var(--line); font-weight:600; font-size:13px; padding:11px 10px; }
.controls button:disabled { opacity:.35; cursor:default; }
.controls .btn-ask { background:var(--card); color:var(--ink); border:1px solid var(--line); font-weight:600; font-size:13px; padding:11px 10px; flex:0 1 auto; }
.sheet.ask-only #sheet-tags, .sheet.ask-only .sheet-modes, .sheet.ask-only .sheet-fix-note { display:none; }
.sheet.ask-only .sheet-friend { margin-top:6px; }
.sheet.ask-only #sheet-ask { display:none; }
#sheet-ask-go { display:none; }
.sheet.ask-only #sheet-ask-go { display:inline-block; background:var(--accent); color:#fff; font-weight:700; flex:1; }
.meta { text-align:center; color:var(--muted); font-size:13px; padding:0 14px 8px; }
.meta button { font:inherit; background:none; border:none; color:var(--accent); cursor:pointer; padding:0 6px; }
.execute { display:block; max-width:560px; margin:8px auto 0; padding:0 14px; }
.execute a, .execute span { display:block; text-align:center; padding:12px; border-radius:12px; font-weight:700; text-decoration:none; }
.execute a { background:var(--accent); color:#fff; }
.execute span { background:var(--card); color:var(--muted); border:1px dashed var(--line); }
.execute small { display:block; text-align:center; color:var(--muted); font-weight:400; margin-top:6px; }
.snapshot { display:block; max-width:560px; margin:10px auto 0; padding:0 14px; }
.snapshot a { display:block; text-align:center; padding:10px; border-radius:12px; font-weight:600; text-decoration:none; color:var(--ink); background:var(--card); border:1px solid var(--line); }
.snapshot small { display:block; text-align:center; color:var(--muted); font-weight:400; margin-top:6px; }
.decided { max-width:560px; margin:18px auto 40px; padding:0 14px; }
.decided summary { cursor:pointer; font-weight:600; }
.decided ul { list-style:none; padding:0; margin:8px 0 0; }
.decided li { display:flex; gap:8px; align-items:flex-start; padding:8px 0; border-top:1px solid var(--line); }
.decided .v { font-size:18px; width:24px; flex:none; }
.decided .t { flex:1; min-width:0; }
.decided .r { color:var(--muted); font-size:13px; }
.decided .r.ok { color:var(--ok); }
.decided button { font:inherit; font-size:13px; background:none; border:1px solid var(--line); border-radius:8px; color:var(--ink); padding:3px 8px; cursor:pointer; }
.sheet { position:fixed; inset:0; background:rgba(0,0,0,.45); display:none; align-items:flex-end; z-index:20; }
.sheet.open { display:flex; }
/* The panel is 607px tall and the keyboard leaves ~330–510px: it scrolls
   inside whatever is visible (fitSheet pins .sheet to the visual viewport),
   so "Needs a fix" is never off the top of the screen with no way back. */
.sheet .panel { width:100%; max-width:560px; max-height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch; overscroll-behavior:contain; margin:0 auto; background:var(--card); border-radius:18px 18px 0 0; padding:16px 16px calc(16px + env(safe-area-inset-bottom)); }
.sheet h3 { margin:0 0 10px; font-size:16px; }
.sheet textarea { width:100%; min-height:72px; font:inherit; font-size:16px; padding:8px 10px; border-radius:10px; border:1px solid var(--line); background:var(--bg); color:var(--ink); margin-top:10px; }
.sheet .actions { display:flex; gap:10px; justify-content:flex-end; margin-top:12px; }
.sheet .actions button { font:inherit; font-weight:700; border:none; border-radius:999px; padding:10px 18px; cursor:pointer; }
.empty { text-align:center; color:var(--muted); padding:60px 20px; }
/* Words, views, list and sources (owner, 2026-10-01: "review events
   scraped from the same website at a high level", "review them all in
   list format, then when I click it it goes to that event in the queue",
   "filter by words … remove items by words"). */
.tools { display:flex; gap:8px; align-items:center; flex-wrap:wrap; max-width:560px; margin:10px auto 0; padding:0 14px; }
.tools input { flex:1 1 160px; min-width:0; font:inherit; font-size:16px; padding:7px 10px; border-radius:10px; border:1px solid var(--line); background:var(--card); color:var(--ink); }
.tools .views { display:flex; gap:6px; }
.tools .bulk { display:flex; gap:6px; flex-wrap:wrap; width:100%; }
.tools .bulk button, .lrow button, .src button { font:inherit; font-size:12px; font-weight:600; background:var(--card); color:var(--ink); border:1px solid var(--line); border-radius:999px; padding:4px 10px; cursor:pointer; white-space:nowrap; }
.tools .bulk button.no, .lrow button.no, .src button.no { border-color:var(--no); color:var(--no); }
.tools .bulk button.ok, .lrow button.ok, .src button.ok { border-color:var(--ok); color:var(--ok); }
.hidden { display:none !important; }
.list, .sources { max-width:560px; margin:10px auto 0; padding:0 14px; }
.lrow { display:flex; gap:10px; align-items:flex-start; padding:9px 0; border-top:1px solid var(--line); }
.lrow:first-child { border-top:none; }
.lrow .lthumb { width:64px; height:64px; flex:none; border-radius:8px; object-fit:cover; background:var(--line); cursor:pointer; }
.lrow .lthumb.none { display:flex; align-items:center; justify-content:center; color:var(--muted); font-size:22px; }
.lrow .lbody { flex:1; min-width:0; cursor:pointer; }
.lrow .lbody h4 { margin:0; font-size:15px; line-height:1.25; }
.lrow .lbody .lmeta { color:var(--muted); font-size:12px; margin-top:2px; }
.lrow .lbody .lkind { display:inline-block; font-size:10px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--accent); margin-right:6px; }
.lrow .lacts { display:flex; flex-direction:column; gap:5px; flex:none; }
.src { padding:12px 0; border-top:1px solid var(--line); }
.src:first-child { border-top:none; }
.src h4 { margin:0 0 4px; font-size:15px; display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
.src h4 small { color:var(--muted); font-weight:400; font-size:12px; }
.src .facts { color:var(--muted); font-size:12px; line-height:1.5; }
.src .facts b { color:var(--ink); font-weight:600; }
.src .sacts { display:flex; gap:6px; flex-wrap:wrap; margin-top:7px; }
.toast { position:fixed; left:50%; bottom:calc(24px + env(safe-area-inset-bottom)); transform:translateX(-50%); background:var(--ink); color:var(--bg); padding:8px 14px; border-radius:999px; font-size:13px; opacity:0; transition:opacity .2s; pointer-events:none; z-index:30; }
.toast.show { opacity:1; }
@media (prefers-reduced-motion: reduce) { .card { transition:none; } }
/* Friend mode (renderFriendPage): the same deck, nothing that needs the Mac. */
.friend-mode #run-select, .friend-mode .top a, .friend-mode .top-age, .friend-mode #filters, .friend-mode .tools, .friend-mode .missing-cal,
.friend-mode #btn-ask, .friend-mode #sheet-ask-mode, .friend-mode .sheet-friend, .friend-mode .execute, .friend-mode .snapshot, .friend-mode #waiting-wrap, .friend-mode #friends-wrap, .friend-mode #decided-wrap, .friend-mode .meta .keys { display:none !important; }
.friend-intro { display:none; padding:4px 16px 0; color:var(--muted); font-size:14px; }
.friend-mode .friend-intro { display:block; }
.friend-send { display:none; padding:8px 16px 4px; gap:8px; align-items:center; }
.friend-mode .friend-send { display:flex; }
.friend-send .count { flex:1; color:var(--muted); font-size:13px; }
.friend-send a, .friend-send button { font:inherit; font-weight:700; font-size:14px; border:none; border-radius:999px; padding:10px 14px; text-decoration:none; cursor:pointer; }
.friend-send a { background:var(--accent); color:#fff; }
.friend-send button { background:var(--line); color:var(--ink); }
</style></head>
<body${options.friendMode === true ? ' class="friend-mode"' : ''}>
<div class="top">
  <h1>🃏 Review</h1>
  <select id="run-select" onchange="location.href='/review?run='+encodeURIComponent(this.value)">${runOptions}</select>
  <a href="/" style="margin-left:auto; font-size:13px;">Results</a>
  <span class="muted top-age" style="font-size:12px;">${savedLabel}${deck.environment ? ` · ${escapeHtmlText(deck.environment)}` : ''}</span>
  <div class="pills" id="filters"></div>
</div>
${missingCalendarNotice}
<div class="friend-intro" id="friend-intro"></div>
<div class="friend-send" id="friend-send"><span class="count" id="friend-count"></span><button type="button" id="friend-copy">Copy reply</button><a id="friend-sms" href="#">Send back</a></div>
<div class="tools">
  <input id="word" type="search" placeholder="filter by words (-word excludes)" autocapitalize="none" autocorrect="off">
  <div class="views pills" id="views"></div>
  <div class="bulk hidden" id="bulk"></div>
</div>
<div class="list hidden" id="list"></div>
<div class="sources hidden" id="sources"></div>
<div class="stage" id="stage"></div>
<div class="controls">
  <button class="btn-no" id="btn-reject" type="button">✕ Not yet</button>
  <button class="btn-notbear" id="btn-notbear" type="button" title="Not a bear event — one tap, final, covers every night of the party (key: n)">Not bear</button>
  <button class="btn-ask" id="btn-ask" type="button" title="Not sure? Put it on a friend's list — they answer from a link (key: f)">🙋 Ask</button>
  <button class="btn-skip" id="btn-skip" type="button">↷ Skip</button>
  <button class="btn-ok" id="btn-approve" type="button">✓ Approve</button>
</div>
<div class="meta"><span id="left"></span> · <button type="button" id="btn-undo">↩︎ Undo</button><span class="keys"> · ← not yet · ↖ not bear · ↙ needs a fix · ↓ pull down: ask a friend · → approve · ␣ skip · n not bear · f ask a friend</span></div>
<div class="execute" id="execute"></div>
${snapshotBlock}
<details class="decided waiting" id="waiting-wrap" hidden>
  <summary>🔧 Waiting on a fix <span id="waiting-count"></span></summary>
  <p class="waiting-note">Sent back with a note. Each comes back to the stack by itself when the scraper's card for it changes — nothing to hunt for. "Bring back" returns it now.</p>
  <ul id="waiting"></ul>
</details>
<details class="decided friends" id="friends-wrap" hidden>
  <summary>🙋 Friends <span id="friends-count"></span></summary>
  <p class="waiting-note">Cards you asked a friend about. "Share" makes one link to the page on chunky.dad with the cards in it (no server — the cards travel in the link); the friend answers there and sends a link back. Paste that link below and the cards return to the stack with the advice on them.</p>
  <div id="friends"></div>
</details>
<details class="decided" id="decided-wrap">
  <summary>Decided <span id="decided-count"></span> · <button type="button" id="btn-copy-rejections" onclick="event.preventDefault(); copyRejections();">Copy rejections</button></summary>
  <ul id="decided"></ul>
</details>
<div class="sheet" id="sheet">
  <div class="panel">
    <h3><span id="sheet-heading">Not yet — why?</span> <span class="muted" id="sheet-title"></span></h3>
    <div class="sheet-fix-note">What is wrong? Tap what applies, then pick an answer.</div>
    <div class="chips" id="sheet-tags"></div>
    <div class="sheet-modes">
      <button type="button" class="mode mode-fix" id="sheet-fix"><b>🔧 Needs a fix</b><span>Good event, wrong card. It waits, and comes back by itself once the card changes.</span></button>
      <button type="button" class="mode mode-notbear" id="sheet-notbear"><b>🚫🐻 Not bear</b><span>Not ours. Final — every night of this party.</span></button>
      <button type="button" class="mode mode-never" id="sheet-never"><b>🗑 Not an event</b><span>A duplicate, a fragment, junk. Final, whatever it says later.</span></button>
      <button type="button" class="mode mode-ask" id="sheet-ask-mode"><b>🙋 Ask a friend</b><span>Not sure? A friend who knows the city answers from a page; their answer lands on this card, the swipe stays yours.</span></button>
    </div>
    <div class="sheet-friend" id="sheet-friend"><input id="sheet-friend-name" type="text" placeholder="Friend's name" autocapitalize="words"><span class="chips" id="sheet-friend-chips"></span><button type="button" id="sheet-ask" style="background:var(--accent); color:#fff;">Ask</button></div>
    <textarea id="sheet-text" placeholder="Anything else (optional)"></textarea>
    <div class="actions">
      <button type="button" id="sheet-cancel" style="background:var(--line); color:var(--ink);">Cancel</button>
      <button type="button" id="sheet-ask-go">Add to their list</button>
    </div>
  </div>
</div>
<div class="lightbox" id="lightbox" onclick="closeFlyer()"><img alt=""></div>
<div class="toast" id="toast"></div>
<script>
// A tap is a touch AND, a few milliseconds later, the click the browser
// makes up for it — aimed at whatever is under the finger by then. The
// flyer opened on the touch and that click landed on the lightbox it had
// just opened, which closes on a click: the flyer flashed and was gone.
// The lightbox ignores a close that arrives with the tap that opened it.
var flyerOpenedAt = 0;
function openFlyer(el) {
  var img = el && el.querySelector ? el.querySelector('img') : null;
  if (!img || !img.src) return;
  var box = document.getElementById('lightbox');
  box.querySelector('img').src = img.src;
  box.classList.add('open');
  flyerOpenedAt = Date.now();
}
function closeFlyer() {
  if (Date.now() - flyerOpenedAt < 400) return;
  document.getElementById('lightbox').classList.remove('open');
}
function toggleDesc(el) { if (el) el.classList.toggle('clamped'); }
</script>
<script>
window.__reviewDeck = ${jsonForInlineScript(payload)};
// FRIEND MODE: the cards ride in the link as #j2.<base64url(deflate-raw
// JSON)> — the deck's own card HTML, so a friend sees exactly the card
// the owner sees (tools/review-queue buildFriendLink). Decoded here, then
// the deck starts as usual.
window.__loadFriendDeck = function () {
  var deck = window.__reviewDeck;
  var m = String(location.hash || '').match(/^#j2[.]([A-Za-z0-9_-]+)$/);
  function fail(text) { document.getElementById('stage').innerHTML = '<div class="empty" style="padding:40px 16px; text-align:center;">' + text + '</div>'; }
  if (!m) { fail('This page needs a link from Stanley’s review deck.'); return; }
  try {
    var b64 = m[1].split('-').join('+').split('_').join('/');
    while (b64.length % 4) b64 += '=';
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    new Response(stream).text().then(function (text) {
      var data = JSON.parse(text);
      deck.cards = (data.c || []).map(function (c, i) {
        return { id: 'c' + i, kind: c.k || 'new', key: 'c' + i, proposal: c.p || { title: c.t || '' }, html: c.h || '', series: null, asked: [], advice: [] };
      });
      deck.decided = [];
      deck.friend = data.f || '';
      deck.from = data.from || 'Stanley';
      deck.exportId = data.e || '';
      deck.smsTo = data.to || '';
      document.querySelector('.top h1').textContent = '🐻 ' + deck.from + ' asked you';
      document.title = deck.from + ' asked you · chunky.dad';
      document.getElementById('friend-intro').textContent = data.q || ('Is each one a bear event, and is the card right? Swipe right if it looks right, left if something is off, then Send back.');
      window.__startDeck();
    }).catch(function () { fail('This link could not be read — ask for a new one.'); });
  } catch (e) { fail('This link could not be read — ask for a new one.'); }
};
window.__startDeck = function () {
  var deck = window.__reviewDeck;
  var friendMode = deck.friendMode === true;
  // Friend mode: what was answered, by card key ('c' + index).
  var friendAnswers = {};
  // A card asked of a friend and not answered waits in the Friends
  // section, not the stack.
  function awaitingFriend(c) { return (c.asked || []).length > 0 && (c.advice || []).length === 0; }
  // Every card with an open ask is listed under Friends (the link is
  // built from them); only one with no answer at all leaves the stack.
  var friends = deck.cards.filter(function (c) { return (c.asked || []).length > 0; });
  var queue = deck.cards.filter(function (c) { return !awaitingFriend(c); });
  var decided = deck.decided.slice();
  var knownFriends = (deck.friends || []).slice();
  var history = [];
  var filter = 'all';
  var view = 'stack'; // stack | list | sources
  var words = ''; // the word filter, as typed
  var sourceOnly = ''; // a source chosen on the sources view ('' = every source)
  var pending = null; // stack item awaiting the reject sheet, or { bulk: [items] }
  var solo = {}; // series the owner chose to decide night by night
  var lastTouchAt = 0; // when a finger last touched a card (see attachDrag)
  var clearedGone = {}; // waiting notes dropped on this page load
  var stage = document.getElementById('stage');
  var toastEl = document.getElementById('toast');
  var toastTimer = null;

  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
  }
  function tabOf(kind) { return kind === 'override' ? 'merge' : kind; } // 'series' is its own tab
  // Every word typed must appear somewhere on the card (title, source,
  // venue, address, city, links, description); a word led by "-" must
  // not. Case-insensitive, nothing clever.
  function haystack(c) {
    var p = c.proposal || {};
    return [p.title, p.name, p.source, p.bar, p.address, p.city, p.url, p.ticketUrl, p.website, p.description, c.kind, dayOf(c.key)]
      .map(function (v) { return String(v || ''); }).join(' | ').toLowerCase();
  }
  function matchesWords(c) {
    if (sourceOnly && String((c.proposal || {}).source || '') !== sourceOnly) return false;
    var terms = words.toLowerCase().split(' ').filter(Boolean);
    if (terms.length === 0) return true;
    var hay = haystack(c);
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      if (t[0] === '-') { if (t.length > 1 && hay.indexOf(t.slice(1)) !== -1) return false; }
      else if (hay.indexOf(t) === -1) return false;
    }
    return true;
  }
  function visible() {
    return queue.filter(function (c) { return (filter === 'all' ? c.kind !== 'dropped' : tabOf(c.kind) === filter) && matchesWords(c); });
  }
  // The stack shows ITEMS: a card, or every pending night of one party
  // (card.series) folded into one — one swipe decides them all, each under
  // its own key. "one at a time" unfolds a party for this page load.
  function items() {
    var out = [], seen = {};
    visible().forEach(function (c) {
      var s = c.series && !solo[c.series.key] ? c.series.key : null;
      if (!s) { out.push({ key: c.key, cards: [c] }); return; }
      if (seen[s]) { seen[s].cards.push(c); return; }
      seen[s] = { key: 'series:' + s, series: c.series, cards: [c] };
      out.push(seen[s]);
    });
    return out;
  }
  function nightLabel(c) {
    var nights = c.series && c.series.nights ? c.series.nights : [];
    for (var i = 0; i < nights.length; i++) if (nights[i].key === c.key) return nights[i].label || nights[i].day;
    return c.key.split('|')[3] || '';
  }
  // The night-by-night values the server compared (series.nights[].values)
  // and which of them differ (series.differs). Every night is saved as its
  // own event with its own values — the strip says so, names what differs,
  // and "compare" lays the nights side by side.
  var NIGHT_FIELDS = ${JSON.stringify(reviewQueue.NIGHT_COMPARE_FIELDS)};
  function nightOf(c) {
    var nights = c.series && c.series.nights ? c.series.nights : [];
    for (var i = 0; i < nights.length; i++) if (nights[i].key === c.key) return nights[i];
    return null;
  }
  function shortLink(url) {
    var text = String(url || '').replace(/^https?:[/][/](www[.])?/, '');
    return text.length > 46 ? text.slice(0, 22) + '…' + text.slice(-22) : text;
  }
  function nightCell(field, value) {
    if (!value) return '<span class="muted">—</span>';
    if (field === 'image') return '<a href="' + escapeHtml(value) + '" target="_blank" rel="noopener"><img class="night-thumb" src="' + escapeHtml(value) + '" alt="" loading="lazy"></a>';
    if (field === 'url' || field === 'ticketUrl') return '<a href="' + escapeHtml(value) + '" target="_blank" rel="noopener">' + escapeHtml(shortLink(value)) + '</a>';
    return escapeHtml(value);
  }
  function nightChip(c, differs) {
    var night = nightOf(c);
    var values = night && night.values ? night.values : {};
    var own = differs.indexOf('ticketUrl') !== -1 ? values.ticketUrl : (differs.indexOf('url') !== -1 ? values.url : '');
    var label = escapeHtml(nightLabel(c));
    return own
      ? '<a class="chip" href="' + escapeHtml(own) + '" target="_blank" rel="noopener" title="the page of this night">' + label + ' ↗</a>'
      : '<span class="chip">' + label + '</span>';
  }
  function seriesCompare(item, differs) {
    if (differs.length === 0) return '';
    var fields = NIGHT_FIELDS.filter(function (f) { return differs.indexOf(f.key) !== -1; });
    var head = '<tr><th>night</th>' + fields.map(function (f) { return '<th>' + escapeHtml(f.label) + '</th>'; }).join('') + '</tr>';
    var rows = item.cards.map(function (c) {
      var night = nightOf(c);
      var values = night && night.values ? night.values : {};
      return '<tr><td>' + escapeHtml(nightLabel(c)) + '</td>' + fields.map(function (f) { return '<td>' + nightCell(f.key, values[f.key]) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<details class="night-compare"><summary>compare the ' + item.cards.length + ' nights</summary><div class="night-table"><table>' + head + rows + '</table></div></details>';
  }
  // The rhythm of the nights ON THIS CARD (the server's own function, so
  // the card and the fix queue say the same thing): "every Wednesday".
  var describeSeriesCadence = ${reviewQueue.describeSeriesCadence.toString()};
  function dayOf(key) { return String(key || '').split('|')[3] || ''; }
  function cadenceText(keys) {
    var cadence = describeSeriesCadence(keys.map(dayOf));
    return cadence ? cadence.text : '';
  }
  // What an item's members are called: nights of one party, or events
  // that carry the same change.
  function unitOf(series, count) {
    return series && series.type === 'change' ? (count === 1 ? 'event' : 'events') : (count === 1 ? 'night' : 'nights');
  }
  var CHANGE_LABELS = { allDay: 'time', url: 'link', ticketUrl: 'ticket link', image: 'image', bar: 'venue', address: 'address', location: 'pin', title: 'title', cover: 'cover', description: 'description' };
  function changeRows(series) {
    return (series.change || []).map(function (row) {
      var isLink = row.field === 'url' || row.field === 'ticketUrl' || row.field === 'image';
      var show = function (value) { return value ? escapeHtml(isLink ? shortLink(value) : value) : '<span class="muted">empty</span>'; };
      return '<div class="change-row"><b>' + escapeHtml(CHANGE_LABELS[row.field] || row.field) + '</b> ' + show(row.from) + ' → ' + show(row.to) + '</div>';
    }).join('');
  }
  function changeStrip(item) {
    return '<div class="series"><b>🔀 ' + item.cards.length + ' events, same change</b> — one swipe decides them all · <button type="button" class="series-split">one at a time</button>'
      + changeRows(item.series)
      + '<div class="series-note">Each event is saved under its own decision. The card below shows the first one.</div><div class="nights">'
      + item.cards.slice().sort(function (a, b) { var x = String(a.proposal && a.proposal.startDate || ''), y = String(b.proposal && b.proposal.startDate || ''); return x < y ? -1 : x > y ? 1 : 0; })
        .map(function (c) { return '<span class="chip">' + escapeHtml(nightLabel(c)) + '</span>'; }).join('') + '</div></div>';
  }
  // A folded item the owner took apart ("one at a time") says so on each of
  // its cards and offers the way back: how many of its members are still
  // on the stack, and "fold back" to decide them with one swipe again.
  function siblingsOnStack(card) {
    if (!card.series) return 0;
    return visible().filter(function (c) { return c.series && c.series.key === card.series.key; }).length;
  }
  function joinStrip(item) {
    var card = item.cards[0];
    if (item.cards.length !== 1 || !card.series || !solo[card.series.key]) return '';
    var count = siblingsOnStack(card);
    if (count < 2) return '';
    var what = card.series.type === 'change' ? 'events with the same change' : 'nights of this party';
    return '<div class="series series-solo">One of <b>' + count + ' ' + what + '</b>, decided one at a time · <button type="button" class="series-join">fold back</button></div>';
  }
  function seriesStrip(item) {
    if (item.cards.length === 1) return joinStrip(item);
    if (!item.series || item.cards.length < 2) return '';
    if (item.series.type === 'change') return changeStrip(item);
    var differs = (item.series.differs || []).filter(function (key) {
      // Judged on the nights still on this card, not the whole party.
      var seen = {}, count = 0;
      item.cards.forEach(function (c) { var n = nightOf(c); var v = n && n.values ? n.values[key] : ''; if (!seen['v' + v]) { seen['v' + v] = true; count++; } });
      return count > 1;
    });
    var labels = NIGHT_FIELDS.filter(function (f) { return differs.indexOf(f.key) !== -1; }).map(function (f) { return f.label; });
    var note = labels.length
      ? 'Each night is saved as its own event. Per night: <b>' + escapeHtml(labels.join(', ')) + '</b> — the card below shows the first night.'
      : 'Each night is saved as its own event. The nights are identical apart from the date.';
    var rhythm = cadenceText(item.cards.map(function (c) { return c.key; }));
    return '<div class="series"><b>🗓 ' + item.cards.length + ' nights' + (rhythm ? ', ' + escapeHtml(rhythm) : '') + '</b> — one swipe decides them all · <button type="button" class="series-split">one at a time</button>'
      + '<div class="series-note">' + note + '</div><div class="nights">'
      + item.cards.map(function (c) { return nightChip(c, differs); }).join('') + '</div>' + seriesCompare(item, differs) + '</div>';
  }
  function bindSplit(el, item) {
    var split = el.querySelector('.series-split');
    if (split) split.onclick = function () { solo[item.series.key] = true; toast('Deciding ' + item.cards.length + ' ' + unitOf(item.series, item.cards.length) + ' one at a time'); render(); };
    var join = el.querySelector('.series-join');
    var series = item.cards[0].series;
    if (join && series) join.onclick = function () { delete solo[series.key]; toast('Folded back — one swipe decides them all'); render(); };
  }
  function counts() {
    var out = { all: 0, new: 0, merge: 0, series: 0, bar: 0, dropped: 0 };
    queue.forEach(function (c) { out[tabOf(c.kind)] = (out[tabOf(c.kind)] || 0) + 1; if (c.kind !== 'dropped') out.all++; });
    return out;
  }
  function renderFilters() {
    var c = counts();
    var html = '';
    [['all', 'All'], ['new', 'New'], ['merge', 'Updates'], ['series', 'Series'], ['bar', 'Bars'], ['dropped', 'Not bear']].forEach(function (pair) {
      html += '<span class="pill' + (filter === pair[0] ? ' on' : '') + '" data-f="' + pair[0] + '">' + pair[1] + ' <b>' + (c[pair[0]] || 0) + '</b></span>';
    });
    document.getElementById('filters').innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll('#filters .pill'), function (el) {
      el.onclick = function () { filter = el.getAttribute('data-f'); render(); };
    });
  }
  // The stack is KEYED: a card already on the stage keeps its element and
  // only its class changes (behind2 → behind → top), so the promotion is one
  // CSS transition instead of a rebuilt DOM — rebuilding mid-fly-out is what
  // dropped frames. Elements mid-flight (gone-*) are left to finish and
  // removed afterwards.
  function renderStage() {
    var list = items();
    var keep = {};
    list.slice(0, 3).forEach(function (item, i) {
      keep[item.key] = i;
      var el = stage.querySelector('.card[data-key="' + CSS.escape(item.key) + '"]');
      if (!el) {
        el = document.createElement('div');
        el.setAttribute('data-key', item.key);
        el.innerHTML = item.cards[0].html.replace('<h2>', seriesStrip(item) + '<h2>') + '<div class="stamp ok">APPROVE</div><div class="stamp no">NOT YET</div><div class="stamp ask">🙋 ASK A FRIEND</div>';
        el.className = 'card behind2';
        stage.appendChild(el);
        bindSplit(el, item);
        void el.offsetWidth; // commit the entry state so the promotion animates
      } else if (item.cards.length === 1 && item.cards[0].series && solo[item.cards[0].series.key]) {
        // The count on a split card follows the stack (its siblings get
        // decided one by one); the last one left carries no strip.
        var soloStrip = el.querySelector('.series-solo');
        var fresh = joinStrip(item);
        if (soloStrip && soloStrip.outerHTML !== fresh) { if (fresh) soloStrip.outerHTML = fresh; else soloStrip.remove(); bindSplit(el, item); }
      } else if (item.series) {
        var strip = el.querySelector('.series');
        if (strip && strip.querySelectorAll('.nights .chip').length !== item.cards.length) { strip.outerHTML = seriesStrip(item); bindSplit(el, item); }
        // Nights coming back one by one (an undo): the card was drawn when
        // only the first had returned, so it has no strip yet.
        if (!strip && item.cards.length > 1) {
          var heading = el.querySelector('h2');
          if (heading) { heading.insertAdjacentHTML('beforebegin', seriesStrip(item)); bindSplit(el, item); }
        }
      }
      el.className = 'card' + (i === 1 ? ' behind' : i === 2 ? ' behind2' : '');
      el.style.zIndex = String(3 - i); // the top card paints last
      if (i === 0 && el.getAttribute('data-drag') !== '1') { attachDrag(el, item); el.setAttribute('data-drag', '1'); }
    });
    Array.prototype.forEach.call(stage.querySelectorAll('.card'), function (el) {
      var key = el.getAttribute('data-key');
      if (keep[key] !== undefined || /\bgone-/.test(el.className)) return;
      el.remove();
    });
    var empty = stage.querySelector('.empty');
    if (list.length === 0 && !empty) {
      empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Nothing left to review' + (queue.length ? ' in this filter' : ' in this run') + '. 🐻';
      stage.appendChild(empty);
    } else if (list.length > 0 && empty) {
      empty.remove();
    }
    var nights = list.reduce(function (n, item) { return n + item.cards.length; }, 0);
    document.getElementById('left').textContent = list.length + ' left' + (nights !== list.length ? ' (' + nights + ' nights)' : '');
    var disabled = list.length === 0;
    ['btn-reject', 'btn-skip', 'btn-approve', 'btn-ask'].forEach(function (id) { document.getElementById(id).disabled = disabled; });
    document.getElementById('btn-undo').disabled = history.length === 0;
  }
  function renderExecute() {
    var approved = decided.filter(function (d) { return d.verdict === 'approve' && d.kind !== 'bar' && d.kind !== 'dropped' && d.pendingExecute; }).length;
    var bars = decided.filter(function (d) { return d.verdict === 'approve' && d.kind === 'bar'; }).length;
    var el = document.getElementById('execute');
    var last = deck.lastExecution;
    // The phone's own tally of the approvals it was handed (the run file's
    // executions[].ownerReview): what its checks held back and what it sent
    // back for another look were in the payload and never on the page —
    // 2026-09-27 read "41 written" for 56 approvals, 14 of them withheld.
    var review = last && last.ownerReview && typeof last.ownerReview === 'object' ? last.ownerReview : null;
    var held = review ? [
      Number(review.withheld) > 0 ? review.withheld + ' approved but withheld by the checks on the phone' : '',
      Number(review.awaiting) > 0 ? review.awaiting + ' back for review' : ''
    ].filter(Boolean).join(', ') : '';
    var lastLine = last && last.at
      ? '<small>Last execution ' + escapeHtml(String(last.at).replace('T', ' ').slice(0, 16)) + ' UTC' + (last.runId && last.runId !== deck.runId ? ' (from run ' + escapeHtml(last.runId) + ')' : '') + ': ' + last.processed + ' written' + (last.created !== null ? ' (' + last.created + ' created, ' + last.updated + ' updated)' : '') + (last.failed ? ', ' + last.failed + ' failed' : '') + (held ? ' · ' + escapeHtml(held) : '') + '.</small>'
      : '';
    // Approved cards whose inbox picture is still in the pictures PR: an
    // execute now writes them without the picture.
    var picturesWaiting = decided.filter(function (d) { return d.verdict === 'approve' && d.pendingExecute && d.picture && d.picture.state === 'pr'; });
    var pictureLine = picturesWaiting.length
      ? '<small>🖼️ ' + picturesWaiting.length + ' of these wait' + (picturesWaiting.length === 1 ? 's' : '') + ' for the pictures PR' + (picturesWaiting[0].picture.pr && picturesWaiting[0].picture.pr.url ? ' <a href="' + escapeHtml(picturesWaiting[0].picture.pr.url) + '">#' + escapeHtml(String(picturesWaiting[0].picture.pr.number || '')) + '</a>' : '') + ' — merge it first, or they are written without their flyer.</small>'
      : '';
    if (approved > 0 && deck.executeLink) {
      el.innerHTML = '<a href="' + deck.executeLink.replace(/&/g, '&amp;') + '">📱 Execute ' + approved + ' new approval' + (approved === 1 ? '' : 's') + ' on phone</a><small>Opens Scriptable: the phone re-checks the live calendar, writes only these approvals, and records the run.' + (bars ? ' ' + bars + ' approved bar(s) become a PR after the next daily run.' : '') + '</small>' + pictureLine + lastLine;
    } else {
      el.innerHTML = '<span>' + (last && last.at ? 'Nothing new to execute — approve more cards to enable it' : 'Approve something to enable "Execute on phone"') + '</span>' + lastLine + (bars ? '<small>' + bars + ' approved bar(s) become a PR after the next daily run.</small>' : '');
    }
  }
  function renderDecided() {
    var ul = document.getElementById('decided');
    document.getElementById('decided-count').textContent = '(' + decided.length + ')';
    ul.innerHTML = '';
    decided.slice().reverse().forEach(function (d) {
      var li = document.createElement('li');
      var reason = d.reason ? [(d.reason.tags || []).join(', '), d.reason.text].filter(Boolean).join(' — ') : '';
      var executed = d.executed ? '<div class="r ok">📱 written on the phone' + (d.executed.as ? ' (' + escapeHtml(d.executed.as) + ')' : '') + (d.executed.at ? ' · ' + escapeHtml(String(d.executed.at).replace('T', ' ').slice(0, 16)) : '') + '</div>' : '';
      var via = d.via ? '<div class="r">' + (String(d.via).indexOf('series|') === 0 ? '↪ with the series card — you decided the party there' : '↪ with the series — you decided its ' + escapeHtml(String(d.via).split('|')[3] || 'earlier') + ' night') + '</div>' : '';
      var night = d.key && d.key.split('|').length === 4 ? ' · ' + escapeHtml(d.key.split('|')[3]) : '';
      li.innerHTML = '<span class="v">' + (d.verdict === 'approve' ? '✅' : d.rejectionMode === 'fix' ? '🔧' : d.rejectionMode === 'never' ? '🗑' : '🚫') + '</span><div class="t"><div>' + escapeHtml(d.title || d.key) + ' <span class="r">' + escapeHtml(d.kind) + night + (d.stampedAt ? ' · ' + escapeHtml(String(d.stampedAt).slice(0, 10)) : '') + '</span></div>' + (reason ? '<div class="r">' + escapeHtml(reason) + '</div>' : '') + via + executed + '</div>';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = d.via ? 'Decide alone' : 'Undo';
      btn.onclick = function () { undoDecision(d); };
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }
  // "Needs a fix" rejections: the ones still covering a card on this run,
  // and the ones this run no longer proposes at all (deck.waitingGone).
  function renderWaiting() {
    var wrap = document.getElementById('waiting-wrap');
    var ul = document.getElementById('waiting');
    var rows = decided.filter(function (d) { return d.rejectionMode === 'fix' && !d.via; });
    var gone = (deck.waitingGone || []).filter(function (g) { return !clearedGone[g.key]; });
    wrap.hidden = rows.length + gone.length === 0;
    ul.innerHTML = '';
    function noteOf(reason) { return reason ? [(reason.tags || []).join(', '), reason.text].filter(Boolean).join(' — ') : ''; }
    // One note swiped onto a folded series is stored once per night and is
    // still one note: NEW nights of one party (same title, place) carrying
    // the same words are one row, and its button acts on every night.
    function foldNotes(list) {
      var out = [], seen = {};
      list.forEach(function (d) {
        var parts = String(d.key || '').split('|');
        var party = d.kind === 'new' && parts.length === 4 && parts[0] === 'event' ? parts.slice(0, 3).join('|') + '|' + (d.title || '') + '|' + noteOf(d.reason) : '';
        if (party && seen[party]) { seen[party].members.push(d); return; }
        var row = { first: d, members: [d] };
        if (party) seen[party] = row;
        out.push(row);
      });
      return out;
    }
    function nightsOf(row) {
      if (row.members.length === 1) {
        var key = row.first.key;
        return key && key.split('|').length === 4 ? ' · ' + escapeHtml(dayOf(key)) : '';
      }
      var days = row.members.map(function (d) { return dayOf(d.key); }).sort();
      var rhythm = cadenceText(row.members.map(function (d) { return d.key; }));
      return ' · ' + row.members.length + ' nights' + (rhythm ? ', ' + escapeHtml(rhythm) : '') + ' · ' + escapeHtml(days[0]) + ' → ' + escapeHtml(days[days.length - 1]);
    }
    // Counted as listed: one note on twelve nights is one row, so the
    // heading said "(26)" over eleven rows. The nights ride along.
    var waitingRows = foldNotes(rows.slice().reverse());
    var goneRows = foldNotes(gone.map(function (g) { return { key: g.key, kind: g.kind || 'new', title: g.title, reason: g.reason, bar: g.bar, seriesPresent: g.seriesPresent }; }));
    var listed = waitingRows.length + goneRows.length;
    var nightsWaiting = rows.length + gone.length;
    document.getElementById('waiting-count').textContent = '(' + listed + (nightsWaiting !== listed ? ' · ' + nightsWaiting + ' nights' : '') + ')';
    waitingRows.forEach(function (row) {
      var d = row.first;
      var li = document.createElement('li');
      li.innerHTML = '<span class="v">🔧</span><div class="t"><div>' + escapeHtml(d.title || d.key) + ' <span class="r">' + escapeHtml(d.kind) + nightsOf(row) + '</span></div>'
        + (noteOf(d.reason) ? '<div class="r">' + escapeHtml(noteOf(d.reason)) + '</div>' : '')
        + '<div class="status">unchanged since you sent it back' + (d.stampedAt ? ' · ' + escapeHtml(String(d.stampedAt).slice(0, 10)) : '') + '</div></div>';
      var btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = row.members.length > 1 ? 'Bring back ' + row.members.length : 'Bring back';
      btn.onclick = function () {
        var chain = Promise.resolve();
        row.members.forEach(function (member) { chain = chain.then(function () { return undoDecision(member); }); });
      };
      li.appendChild(btn);
      ul.appendChild(li);
    });
    goneRows.forEach(function (row) {
      var g = row.first;
      var li = document.createElement('li');
      li.innerHTML = '<span class="v">🔧</span><div class="t"><div>' + escapeHtml(g.title || g.key) + ' <span class="r">' + escapeHtml(g.bar || '') + nightsOf(row) + '</span></div>'
        + (noteOf(g.reason) ? '<div class="r">' + escapeHtml(noteOf(g.reason)) + '</div>' : '')
        + '<div class="status">' + (g.seriesPresent
          ? (row.members.length > 1 ? 'these nights are' : 'this night is') + ' not in this run — other nights of the party are on the deck'
          : 'not in this run under this title, place and day — a fix that changed one of those brings it back as a new card') + '</div></div>';
      var btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = row.members.length > 1 ? 'Drop note (' + row.members.length + ')' : 'Drop note';
      btn.onclick = function () {
        var chain = Promise.resolve();
        row.members.forEach(function (member) {
          chain = chain.then(function () { return post({ key: member.key, verdict: 'clear' }).then(function () { clearedGone[member.key] = true; }); });
        });
        chain.then(function () { toast(row.members.length > 1 ? 'Note dropped from ' + row.members.length + ' nights' : 'Note dropped'); render(); })
          .catch(function (error) { toast('Failed: ' + error.message); render(); });
      };
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }
  // What is left of the screen for the stack: its height minus the header
  // (which wraps to more rows on a narrow phone), the button row and the
  // hint line. Re-measured whenever the screen changes — a rotated phone,
  // Safari's toolbars sliding away, the filter pills wrapping.
  function fitStage() {
    var header = document.querySelector('.top');
    var controls = document.querySelector('.controls');
    var hint = document.querySelector('.meta');
    if (!header || !controls || !hint || !window.innerHeight) return;
    // From where the stack actually starts: whatever sits above it (the
    // word filter; the friend page's intro and send bar) counts too.
    var stageTop = stage.getBoundingClientRect().top + (window.scrollY || 0);
    var above = stageTop > 0 ? stageTop : header.offsetHeight;
    var room = Math.floor(window.innerHeight - above - controls.offsetHeight - hint.offsetHeight - 14);
    document.documentElement.style.setProperty('--stage-h', Math.max(280, Math.min(640, room)) + 'px');
  }
  window.addEventListener('resize', fitStage);
  window.addEventListener('orientationchange', fitStage);
  function render() { renderFilters(); renderViews(); renderStage(); renderList(); renderSources(); renderBulk(); renderExecute(); renderWaiting(); renderFriends(); renderDecided(); fitStage(); }

  // ---- views: the stack, the same cards as a list, or the sources ----
  function renderViews() {
    var html = '';
    [['stack', 'Stack'], ['list', 'List'], ['sources', 'Sources']].forEach(function (pair) {
      html += '<span class="pill' + (view === pair[0] ? ' on' : '') + '" data-v="' + pair[0] + '">' + pair[1] + '</span>';
    });
    if (sourceOnly) html += '<span class="pill on" id="source-only" title="showing one source — tap to show all">' + escapeHtml(sourceOnly) + ' ×</span>';
    // Cards on a friend's list: one tap to where they are sent from.
    if (friends.length) html += '<span class="pill" id="friends-pill" title="Cards on a friend’s list — send them a link from here">🙋 Friends ' + friends.length + '</span>';
    document.getElementById('views').innerHTML = html;
    var friendsPill = document.getElementById('friends-pill');
    if (friendsPill) friendsPill.onclick = function () { var wrap = document.getElementById('friends-wrap'); wrap.open = true; wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    Array.prototype.forEach.call(document.querySelectorAll('#views .pill[data-v]'), function (el) {
      el.onclick = function () { view = el.getAttribute('data-v'); render(); window.scrollTo(0, 0); };
    });
    var only = document.getElementById('source-only');
    if (only) only.onclick = function () { sourceOnly = ''; render(); };
    var onStack = view === 'stack';
    document.getElementById('stage').classList.toggle('hidden', !onStack);
    document.querySelector('.controls').classList.toggle('hidden', !onStack);
    document.getElementById('list').classList.toggle('hidden', view !== 'list');
    document.getElementById('sources').classList.toggle('hidden', view !== 'sources');
  }
  var wordInput = document.getElementById('word');
  var wordTimer = null;
  wordInput.oninput = function () {
    clearTimeout(wordTimer);
    wordTimer = setTimeout(function () { words = wordInput.value; render(); }, 120);
  };
  function titleOf(c) { var p = c.proposal || {}; return c.kind === 'bar' ? (p.name || '') : (p.title || ''); }
  function whenOf(c) {
    var p = c.proposal || {};
    if (!p.startDate) return '';
    try {
      var d = new Date(p.startDate);
      var opts = { weekday: 'short', month: 'short', day: 'numeric' };
      if (!p.wholeDay) { opts.hour = 'numeric'; opts.minute = '2-digit'; }
      if (p.timezone) opts.timeZone = p.timezone;
      return d.toLocaleString('en-US', opts);
    } catch (e) { return String(p.startDate).slice(0, 10); }
  }
  function placeOf(c) { var p = c.proposal || {}; return [p.bar, p.city].filter(Boolean).join(' · '); }
  // Jump the stack to THIS POINT of the list (owner: "jump to that part
  // of the list", not one card pulled out of order): the tapped item
  // comes first and the stack carries on down the list from there; the
  // rows above it go to the back, in their own order, so nothing is lost.
  function jumpTo(item) {
    var list = items();
    var at = -1;
    for (var i = 0; i < list.length; i++) if (list[i].key === item.key) { at = i; break; }
    if (at > 0) {
      var ahead = {};
      list.slice(0, at).forEach(function (it) { it.cards.forEach(function (c) { ahead[c.key] = true; }); });
      var moved = queue.filter(function (c) { return ahead[c.key]; });
      queue = queue.filter(function (c) { return !ahead[c.key]; }).concat(moved);
    }
    view = 'stack';
    render();
    window.scrollTo(0, 0);
  }
  function renderList() {
    if (view !== 'list') return;
    var list = items();
    var html = '';
    if (list.length === 0) html = '<div class="empty">Nothing here' + (words || sourceOnly ? ' for this filter' : '') + '. 🐻</div>';
    list.forEach(function (item, i) {
      var c = item.cards[0];
      var p = c.proposal || {};
      var nights = item.cards.length > 1 ? ' · ' + item.cards.length + ' ' + unitOf(item.series, item.cards.length) : '';
      html += '<div class="lrow" data-i="' + i + '">'
        + (p.image ? '<img class="lthumb" data-act="flyer" src="' + escapeHtml(p.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '<div class="lthumb none" data-act="go">' + (c.kind === 'bar' ? '🍺' : '🐻') + '</div>')
        + '<div class="lbody" data-act="go"><h4>' + escapeHtml(titleOf(c)) + '</h4>'
        + '<div class="lmeta"><span class="lkind">' + escapeHtml(tabOf(c.kind) === 'merge' ? 'update' : c.kind === 'series' ? 'series' : c.kind) + '</span>' + escapeHtml([whenOf(c), placeOf(c)].filter(Boolean).join(' · ') + nights) + '</div>'
        + (p.source ? '<div class="lmeta">' + escapeHtml(p.source) + '</div>' : '') + '</div>'
        + '<div class="lacts"><button type="button" class="ok" data-act="approve">✓</button><button type="button" class="no" data-act="notbear">Not bear</button><button type="button" data-act="ask">🙋</button><button type="button" data-act="reject">Not yet…</button></div>'
        + '</div>';
    });
    var root = document.getElementById('list');
    root.innerHTML = html;
    root.onclick = function (ev) {
      var target = ev.target;
      while (target && target !== root && !target.getAttribute('data-act')) target = target.parentNode;
      if (!target || target === root) return;
      var row = target; while (row && !row.classList.contains('lrow')) row = row.parentNode;
      if (!row) return;
      var item = items()[Number(row.getAttribute('data-i'))];
      if (!item) return;
      var act = target.getAttribute('data-act');
      if (act === 'flyer') { openFlyer({ querySelector: function () { return target; } }); return; }
      if (act === 'go') { jumpTo(item); return; }
      if (act === 'approve') { decide(item, 'approve', null, 'gone-right'); return; }
      if (act === 'notbear') { notBearItem(item); return; }
      if (act === 'reject') { pending = item; openSheet(item); return; }
      if (act === 'ask') { askItem(item); return; }
    };
  }
  // One card per source, the facts a wrong-for-the-whole-site mistake
  // shows up in: how many cards, which hosts the links point at, which
  // venues and cities — and the decisions that apply to every card at once.
  function hostOf(url) { var m = String(url || '').match(/^https?:[/][/]([^/?#]+)/i); return m ? m[1].replace(/^www[.]/, '') : ''; }
  function renderSources() {
    if (view !== 'sources') return;
    var groups = {}, order = [];
    visible().forEach(function (c) {
      var name = String((c.proposal || {}).source || '') || '(no source)';
      if (!groups[name]) { groups[name] = { name: name, cards: [], kinds: {}, hosts: {}, places: {} }; order.push(name); }
      var g = groups[name];
      g.cards.push(c);
      g.kinds[tabOf(c.kind)] = (g.kinds[tabOf(c.kind)] || 0) + 1;
      var p = c.proposal || {};
      [p.url, p.ticketUrl, p.website].forEach(function (u) { var h = hostOf(u); if (h) g.hosts[h] = (g.hosts[h] || 0) + 1; });
      var place = placeOf(c); if (place) g.places[place] = (g.places[place] || 0) + 1;
    });
    order.sort(function (a, b) { return groups[b].cards.length - groups[a].cards.length; });
    var top = function (counts, n) { return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, n).map(function (k) { return '<b>' + escapeHtml(k) + '</b> ×' + counts[k]; }).join(', '); };
    var html = order.length === 0 ? '<div class="empty">Nothing here. 🐻</div>' : '';
    order.forEach(function (name) {
      var g = groups[name];
      var kinds = Object.keys(g.kinds).map(function (k) { return g.kinds[k] + ' ' + (k === 'merge' ? 'update' + (g.kinds[k] === 1 ? '' : 's') : k === 'bar' ? 'bar' + (g.kinds[k] === 1 ? '' : 's') : k === 'series' ? 'series' : k === 'dropped' ? 'not bear' : 'new'); }).join(', ');
      html += '<div class="src" data-s="' + escapeHtml(name) + '"><h4>' + escapeHtml(name) + ' <small>' + g.cards.length + ' card' + (g.cards.length === 1 ? '' : 's') + ' · ' + escapeHtml(kinds) + '</small></h4>'
        + '<div class="facts">' + (Object.keys(g.hosts).length ? 'links: ' + top(g.hosts, 4) + '<br>' : 'links: none<br>') + (Object.keys(g.places).length ? 'where: ' + top(g.places, 4) : 'where: nothing placed') + '</div>'
        + '<div class="sacts"><button type="button" data-act="list">List these</button><button type="button" data-act="stack">Review these</button><button type="button" class="ok" data-act="approve">Approve all ' + g.cards.length + '</button><button type="button" class="no" data-act="reject">Not yet, all ' + g.cards.length + '…</button></div></div>';
    });
    var root = document.getElementById('sources');
    root.innerHTML = html;
    root.onclick = function (ev) {
      var target = ev.target;
      while (target && target !== root && !target.getAttribute('data-act')) target = target.parentNode;
      if (!target || target === root) return;
      var block = target; while (block && !block.classList.contains('src')) block = block.parentNode;
      var name = block.getAttribute('data-s');
      var g = groups[name];
      if (!g) return;
      var act = target.getAttribute('data-act');
      if (act === 'list' || act === 'stack') { sourceOnly = name === '(no source)' ? '' : name; view = act; render(); window.scrollTo(0, 0); return; }
      var group = itemsOf(g.cards);
      if (act === 'approve') { if (confirm('Approve all ' + g.cards.length + ' cards from ' + name + '?')) decideMany(group, 'approve', null); return; }
      if (act === 'reject') { pending = { bulk: group, label: g.cards.length + ' cards from ' + name }; openSheet(pending); return; }
    };
  }
  // The folded items of a set of cards (same folding as the stack).
  function itemsOf(cards) {
    var keys = {}; cards.forEach(function (c) { keys[c.key] = true; });
    return items().filter(function (item) { return item.cards.some(function (c) { return keys[c.key]; }); });
  }
  // Everything the filter shows, decided at once — "remove items by words".
  function renderBulk() {
    var root = document.getElementById('bulk');
    var active = Boolean(words.trim()) || Boolean(sourceOnly);
    root.classList.toggle('hidden', !active);
    if (!active) { root.innerHTML = ''; return; }
    var list = items();
    var n = list.reduce(function (sum, item) { return sum + item.cards.length; }, 0);
    root.innerHTML = '<span class="muted" style="font-size:12px;">' + n + ' card' + (n === 1 ? '' : 's') + ' match</span>'
      + '<button type="button" class="ok" id="bulk-approve"' + (n ? '' : ' disabled') + '>Approve all</button>'
      + '<button type="button" class="no" id="bulk-notbear"' + (n ? '' : ' disabled') + '>Not bear, all</button>'
      + '<button type="button" id="bulk-reject"' + (n ? '' : ' disabled') + '>Not yet, all…</button>';
    document.getElementById('bulk-approve').onclick = function () { if (confirm('Approve all ' + n + ' matching cards?')) decideMany(items(), 'approve', null); };
    document.getElementById('bulk-notbear').onclick = function () { if (confirm('Mark all ' + n + ' matching cards not bear? Final.')) decideMany(items(), 'reject', { tags: ['not bear'], text: words.trim() ? 'words: ' + words.trim() : '' }); };
    document.getElementById('bulk-reject').onclick = function () { pending = { bulk: items(), label: n + ' matching cards' }; openSheet(pending); };
  }
  function decideMany(list, verdict, reason) {
    list.forEach(function (item) {
      var c = item.cards[0];
      if (verdict === 'reject' && reason && (reason.tags || []).indexOf('not bear') !== -1) { notBearItem(item, true); return; }
      if (c.kind === 'dropped' && verdict === 'reject' && !reason) { decide(item, 'reject', null, 'gone-left'); return; }
      decide(item, verdict, reason, verdict === 'approve' ? 'gone-right' : 'gone-left');
    });
    var n = list.reduce(function (sum, item) { return sum + item.cards.length; }, 0);
    toast((verdict === 'approve' ? 'Approved ' : 'Decided ') + n + ' card' + (n === 1 ? '' : 's'));
  }
  function notBearItem(item, quiet) {
    var c = item.cards[0];
    if (c.kind === 'dropped') { decide(item, 'reject', null, 'gone-left'); return; }
    if (c.kind === 'bar') { if (!quiet) { pending = item; openSheet(item); } return; }
    decide(item, 'reject', { tags: ['not bear'], text: '' }, 'gone-left');
    if (!quiet) toast('Not bear — final');
  }
  function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Friend mode has no server: a decision is kept on the page and becomes
  // part of the reply link (friendReplyLink).
  function friendRecord(path, body) {
    var key = body && body.key;
    if (key) {
      var r = (body && body.reason) || {};
      var tags = (r.tags || []);
      if (body.verdict === 'clear') delete friendAnswers[key];
      else if (path === '/review/bear') friendAnswers[key] = body.verdict === 'bear' ? { v: 'approve', m: '', t: [], x: '' } : { v: 'reject', m: 'not-bear', t: [], x: (friendAnswers[key] || {}).x || '' };
      else if (path === '/review/decide') friendAnswers[key] = { v: body.verdict, m: body.verdict === 'reject' ? (tags.indexOf('not bear') !== -1 ? 'not-bear' : (r.mode || '')) : '', t: tags.filter(function (t) { return t !== 'not bear'; }), x: r.text || '' };
      renderFriendSend();
    }
    return { ok: true };
  }
  function friendReplyLink() {
    var rows = Object.keys(friendAnswers).map(function (key) { var a = friendAnswers[key]; return [Number(key.slice(1)), a.v, a.m, a.t, a.x]; });
    var json = JSON.stringify({ e: deck.exportId, f: deck.friend, a: rows });
    var bytes = new TextEncoder().encode(json), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var code = btoa(bin).split('+').join('-').split('/').join('_').replace(/=+$/, '');
    return location.origin + location.pathname + '#r2.' + code;
  }
  function renderFriendSend() {
    if (!friendMode) return;
    var n = Object.keys(friendAnswers).length;
    document.getElementById('friend-count').textContent = n + ' of ' + deck.cards.length + ' answered';
    document.getElementById('friend-sms').href = 'sms:' + encodeURIComponent(deck.smsTo || '') + '&body=' + encodeURIComponent(friendReplyLink());
  }
  function postTo(path, body) {
    if (friendMode) return Promise.resolve(friendRecord(path, body));
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); });
  }
  function post(body) { return postTo('/review/decide', body); }
  function postBear(card, verdict, restore) { return postTo('/review/bear', { verdict: verdict, event: card.bearIdentity || card.proposal, key: card.key, restore: restore || undefined }); }
  function topItem() { return items()[0] || null; }
  function removeFromQueue(item) {
    var keys = {};
    item.cards.forEach(function (c) { keys[c.key] = true; });
    queue = queue.filter(function (c) { return !keys[c.key]; });
  }

  // Fly-out starts from wherever the finger left the card (the drag's
  // inline transform is folded into the exit, never snapped to centre
  // first), the next card is promoted in the same frame, and the save goes
  // to the server in the background — a slow tailnet round trip used to
  // freeze the stack. A failed save puts the card back on top.
  function flyOut(el, direction) {
    if (!el) return;
    var dx = Number(el.getAttribute('data-dx') || 0);
    var dy = Number(el.getAttribute('data-dy') || 0);
    el.classList.remove('dragging');
    el.style.transition = 'transform .32s cubic-bezier(.2,.7,.2,1), opacity .28s ease-out';
    el.style.zIndex = '9';
    var w = Math.max(window.innerWidth, 420);
    var target = direction === 'gone-right' ? 'translate3d(' + (w + 120) + 'px,' + (dy * 0.3 - 20) + 'px,0) rotate(18deg)'
      : direction === 'gone-left' ? 'translate3d(' + (-w - 120) + 'px,' + (dy * 0.3 - 20) + 'px,0) rotate(-18deg)'
      : 'translate3d(0,' + Math.round(window.innerHeight * 0.9) + 'px,0) scale(.9)';
    el.className = 'card ' + direction;
    requestAnimationFrame(function () { el.style.transform = target; el.style.opacity = '0'; });
    setTimeout(function () { if (el.parentNode) el.remove(); }, 360);
  }

  // One card's save — a dropped card's swipe is a bear verdict: right =
  // "that IS bear" (rescued by the next run), left = "not bear, confirmed".
  // "Not bear" as a reject reason on a kept card records the verdict too,
  // so the next run drops the party without asking again.
  function saveOne(card, verdict, reason) {
    var alsoNotBear = card.kind !== 'dropped' && verdict === 'reject' && reason && (reason.tags || []).indexOf('not bear') !== -1;
    // A not-bear card sent back with a note. "Needs a fix" says the party
    // IS bear (the next run keeps it) and parks the note under the event's
    // own key, so the kept card waits there until it changes. "Not an
    // event" confirms the drop and keeps the note for the fix queue.
    var droppedNote = card.kind === 'dropped' && verdict === 'reject' && reason && (reason.mode === 'fix' || reason.mode === 'never') && card.fixTarget ? reason.mode : '';
    // What this swipe overwrote (the server hands it back): an undo puts
    // it back instead of leaving the key empty — a card on its second look
    // keeps the decision, and the note, it came back with.
    var replaced = { decision: null, bear: null };
    function keepDecision(result) { replaced.decision = result && result.replaced ? result.replaced : null; return result; }
    function keepBear(result) { replaced.bear = result && result.replaced ? result.replaced : null; return result; }
    var request = droppedNote
      ? postBear(card, droppedNote === 'fix' ? 'bear' : 'not_bear').then(keepBear).then(function () {
          return post({ key: card.fixTarget.key, kind: 'new', verdict: 'reject', runId: deck.runId, snapshot: card.fixTarget, reason: reason }).then(keepDecision);
        })
      : card.kind === 'dropped'
      ? postBear(card, verdict === 'approve' ? 'bear' : 'not_bear').then(keepBear)
      : post({ key: card.key, kind: card.kind, verdict: verdict, runId: deck.runId, snapshot: card.proposal, reason: reason || null }).then(keepDecision)
          .then(function (result) { return alsoNotBear ? postBear(card, 'not_bear').then(keepBear).then(function () { return result; }) : result; });
    return request.then(function () {
      var record = { replaced: replaced, id: card.id, kind: card.kind, key: card.key, verdict: verdict, stampedAt: new Date().toISOString(), reason: reason || null, rejectionMode: verdict === 'reject' && reason ? ((reason.tags || []).indexOf('not bear') !== -1 ? 'not-bear' : (reason.mode || '')) : '', title: card.kind === 'bar' ? card.proposal.name : card.proposal.title, proposal: card.proposal, bearIdentity: card.bearIdentity, fixTarget: card.fixTarget || null, noteKey: droppedNote ? card.fixTarget.key : '', notBearVerdict: alsoNotBear, pendingExecute: verdict === 'approve', html: card.html, series: card.series || null };
      decided.push(record);
      return record;
    });
  }
  // The whole item flies at once; its nights save one after another in
  // the background (a slow tailnet round trip used to freeze the stack).
  // A failed save puts the unsaved nights back on top.
  function decide(item, verdict, reason, direction) {
    var el = stage.querySelector('.card[data-key="' + CSS.escape(item.key) + '"]');
    flyOut(el, direction);
    removeFromQueue(item);
    var card = item.cards[0];
    var records = [];
    var entry = { item: item, records: records };
    // Before the render: it is what enables the Undo button (the first
    // decision of a page load used to leave it disabled).
    history.push(entry);
    render();
    var left = item.cards.slice();
    var chain = Promise.resolve();
    item.cards.forEach(function (c) {
      chain = chain.then(function () { return saveOne(c, verdict, reason).then(function (record) { records.push(record); left.shift(); }); });
    });
    chain.then(function () {
      var nights = item.cards.length > 1 ? ' · ' + item.cards.length + ' ' + unitOf(item.series, item.cards.length) : '';
      var alsoNotBear = records.length > 0 && records[0].notBearVerdict;
      if (friendMode) { toast(verdict === 'approve' ? 'Looks right — got it' : 'Noted'); return; }
      toast((card.kind === 'dropped' ? (verdict === 'approve' ? 'Marked bear — the next run keeps it' : reason && reason.mode === 'fix' ? 'Bear, needs a fix — the next run keeps it and it waits for the fix' : reason && reason.mode === 'never' ? 'Not an event — stays dropped' : 'Not bear, confirmed') : (verdict === 'approve' ? 'Approved' : (alsoNotBear ? 'Rejected — and marked not bear' : 'Rejected'))) + nights);
      renderDecided(); renderExecute(); renderWaiting();
    }).catch(function (error) {
      toast('Not saved: ' + error.message + (left.length > 1 ? ' (' + left.length + ' ' + unitOf(item.series, left.length) + ' back on the stack)' : ''));
      if (records.length === 0) history = history.filter(function (h) { return h !== entry; });
      queue = left.concat(queue);
      render(); renderDecided(); renderExecute();
    });
  }
  function approveTop() { var c = topItem(); if (c) decide(c, 'approve', null, 'gone-right'); }
  function rejectTop(fixFirst) {
    var c = topItem(); if (!c) return;
    // Reached by a down-left swipe: the sheet opens on "needs a fix".
    sheet.classList.toggle('fix-first', fixFirst === true);
    // A not-bear card gets the same three answers: some of them ARE bear
    // and need a fix, which a bare "confirmed" could never say.
    pending = c; openSheet(c);
  }
  function skipTop() {
    var c = topItem(); if (!c) return;
    var el = stage.querySelector('.card[data-key="' + CSS.escape(c.key) + '"]');
    flyOut(el, 'gone-down');
    removeFromQueue(c); queue = queue.concat(c.cards);
    render();
  }
  function requeue(record) {
    decided = decided.filter(function (d) { return d.key !== record.key; });
    queue.unshift({ id: record.id, kind: record.kind, key: record.key, proposal: record.proposal, bearIdentity: record.bearIdentity, fixTarget: record.fixTarget || null, html: record.html, series: record.series || null });
    history.forEach(function (h) { h.records = h.records.filter(function (r) { return r.key !== record.key; }); });
    history = history.filter(function (h) { return h.records.length > 0; });
  }
  function undoDecision(record) {
    // Covered by another night's decision: nothing stored under this key —
    // the card comes back to be decided alone (that decision then wins).
    if (record.via) { requeue(record); if (record.series) solo[record.series.key] = true; toast('Back on the stack — decide this night alone'); render(); return; }
    var was = record.replaced || {};
    var request = record.kind === 'dropped'
      ? postBear(record, 'clear', was.bear).then(function (result) { return record.noteKey ? post({ key: record.noteKey, verdict: 'clear', restore: was.decision || undefined }) : result; })
      : post({ key: record.key, verdict: 'clear', restore: was.decision || undefined })
          .then(function (result) { return record.notBearVerdict ? postBear(record, 'clear', was.bear).then(function () { return result; }) : result; });
    return request.then(function (result) {
      requeue(record);
      toast(result && result.restored ? 'Undone — your earlier decision is back' : 'Undone');
      render();
    }).catch(function (error) { toast('Undo failed: ' + error.message); });
  }
  function undoLast() {
    var last = history[history.length - 1];
    if (!last) return;
    var chain = Promise.resolve();
    last.records.slice().forEach(function (record) { chain = chain.then(function () { return undoDecision(record); }); });
  }

  // Reject sheet
  var sheet = document.getElementById('sheet');
  var sheetTags = document.getElementById('sheet-tags');
  function openSheet(item) {
    var card = item.bulk ? item.bulk[0].cards[0] : item.cards[0];
    var isDropped = !item.bulk && card.kind === 'dropped';
    document.getElementById('sheet-fix').querySelector('b').textContent = isDropped ? '🔧🐻 Bear, but needs a fix' : '🔧 Needs a fix';
    document.getElementById('sheet-fix').querySelector('span').textContent = isDropped
      ? 'It IS ours, and the card is wrong. The next run keeps it; it waits, and comes back by itself once the card changes.'
      : 'Good event, wrong card. It waits, and comes back by itself once the card changes.';
    document.getElementById('sheet-notbear').querySelector('span').textContent = isDropped ? 'Right call. Final — every night of this party.' : 'Not ours. Final — every night of this party.';
    document.getElementById('sheet-title').textContent = item.bulk
      ? item.label + ' — the same answer for every one'
      : (card.kind === 'bar' ? card.proposal.name : card.proposal.title) + (item.cards.length > 1 ? ' · ' + item.cards.length + ' ' + unitOf(item.series, item.cards.length) : '');
    sheetTags.innerHTML = deck.tags.filter(function (t) { return t !== 'not bear'; }).map(function (t) { return '<span class="chip" data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</span>'; }).join('');
    Array.prototype.forEach.call(sheetTags.querySelectorAll('.chip'), function (el) { el.onclick = function () { el.classList.toggle('on'); }; });
    document.getElementById('sheet-text').value = '';
    document.getElementById('sheet-text').placeholder = 'Anything else (optional)';
    document.getElementById('sheet-heading').textContent = friendMode ? 'What’s off?' : 'Not yet — why?';
    if (friendMode) {
      document.getElementById('sheet-fix').querySelector('span').textContent = 'A real bear event, but something on the card is wrong. Tap what, add a note.';
      document.getElementById('sheet-notbear').querySelector('span').textContent = 'Not a bear crowd.';
      document.getElementById('sheet-never').querySelector('span').textContent = 'Not a real event — a duplicate, a fragment, junk.';
    }
    sheet.classList.remove('ask');
    sheet.classList.remove('ask-only');
    sheet.classList.add('open');
    sheet.querySelector('.panel').scrollTop = 0;
    fitSheet();
    setTimeout(function () { document.getElementById('sheet-text').focus(); }, 50);
  }
  // iOS lays a fixed element out against the whole screen and draws the
  // keyboard over its lower half. The visual viewport is the part still
  // showing: the open sheet is pinned to it, and the panel scrolls inside.
  function fitSheet() {
    var view = window.visualViewport;
    if (!view || !sheet.classList.contains('open')) { sheet.style.top = ''; sheet.style.bottom = ''; sheet.style.height = ''; return; }
    sheet.style.top = Math.round(view.offsetTop) + 'px';
    sheet.style.bottom = 'auto';
    sheet.style.height = Math.round(view.height) + 'px';
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitSheet);
    window.visualViewport.addEventListener('scroll', fitSheet);
  }
  function closeSheet() { sheet.classList.remove('open'); sheet.classList.remove('fix-first'); sheet.classList.remove('ask'); sheet.classList.remove('ask-only'); fitSheet(); pending = null; render(); }
  // "Ask a friend": the name row opens under the modes; Ask flags every
  // card of the item for that friend and moves it to the Friends section.
  var friendName = document.getElementById('sheet-friend-name');
  function renderFriendChips() {
    var chips = document.getElementById('sheet-friend-chips');
    chips.innerHTML = knownFriends.map(function (name) { return '<span class="chip" data-name="' + escapeHtml(name) + '">' + escapeHtml(name) + '</span>'; }).join('');
    Array.prototype.forEach.call(chips.querySelectorAll('.chip'), function (el) { el.onclick = function () { friendName.value = el.getAttribute('data-name'); friendName.dispatchEvent(new Event('input')); }; });
  }
  document.getElementById('sheet-ask-mode').onclick = function () {
    sheet.classList.add('ask');
    renderFriendChips();
    if (!friendName.value && knownFriends.length) friendName.value = knownFriends[0];
    setTimeout(function () { friendName.focus(); }, 50);
  };
  // 🙋 Ask (owner, 2026-10-03: "I was assuming some button or swipe"):
  // the same sheet with only the friend row — who, and an optional
  // question for them. The card goes on that friend's list.
  function askItem(item) {
    if (!item) return;
    pending = item;
    openSheet(item);
    sheet.classList.add('ask');
    sheet.classList.add('ask-only');
    document.getElementById('sheet-heading').textContent = '🙋 Ask a friend';
    document.getElementById('sheet-text').placeholder = 'Your question for them (optional) — e.g. still at this bar?';
    renderFriendChips();
    if (!friendName.value && knownFriends.length) friendName.value = knownFriends[0];
    friendName.dispatchEvent(new Event('input'));
    setTimeout(function () { friendName.focus(); }, 50);
  }
  function askTop() { if (friendMode) return; askItem(topItem()); }
  document.getElementById('sheet-ask-go').onclick = function () { document.getElementById('sheet-ask').click(); };
  // The big button names the friend as it is typed.
  friendName.addEventListener('input', function () { var n = friendName.value.trim(); document.getElementById('sheet-ask-go').textContent = n ? 'Add to ' + n + '’s list' : 'Add to their list'; });
  document.getElementById('btn-ask').onclick = askTop;
  document.getElementById('sheet-ask').onclick = function () {
    if (!pending) return closeSheet();
    var name = friendName.value.trim();
    if (!name) { toast('Who? Type a name'); friendName.focus(); return; }
    var text = document.getElementById('sheet-text').value.trim();
    var itemsToAsk = pending.bulk ? pending.bulk : [pending];
    var cards = [];
    itemsToAsk.forEach(function (item) { item.cards.forEach(function (c) { cards.push(c); }); });
    sheet.classList.remove('open'); sheet.classList.remove('ask'); fitSheet(); pending = null;
    var chain = Promise.resolve();
    cards.forEach(function (c) {
      chain = chain.then(function () {
        return postTo('/review/ask', { key: c.key, kind: c.kind, friend: name, question: text, snapshot: c.proposal }).then(function (j) {
          if (j.friends) knownFriends = j.friends;
          c.asked = (c.asked || []).filter(function (a) { return a.friend !== name; }).concat([{ friend: name, askedAt: new Date().toISOString(), question: text }]);
          if (awaitingFriend(c)) queue = queue.filter(function (q) { return q.key !== c.key; });
          if (!friends.some(function (f) { return f.key === c.key; })) friends.push(c);
        });
      });
    });
    chain.then(function () { toast('On ' + name + '’s list (' + cards.length + (cards.length === 1 ? ' card' : ' cards') + ') — send it from 🙋 Friends'); render(); })
      .catch(function (e) { toast('Could not save the ask: ' + e.message); render(); });
  };
  function renderFriends() {
    var wrap = document.getElementById('friends-wrap');
    var box = document.getElementById('friends');
    wrap.hidden = friends.length === 0;
    document.getElementById('friends-count').textContent = '(' + friends.length + ')';
    var byFriend = {};
    friends.forEach(function (c) {
      (c.asked || []).forEach(function (a) { (byFriend[a.friend] = byFriend[a.friend] || []).push(c); });
    });
    box.innerHTML = '';
    Object.keys(byFriend).sort().forEach(function (name) {
      var group = document.createElement('div');
      var who = document.createElement('div');
      who.className = 'who';
      who.innerHTML = '<span>' + escapeHtml(name) + ' · ' + byFriend[name].length + '</span>';
      var share = document.createElement('button');
      share.type = 'button'; share.textContent = 'Share link with ' + name;
      var linkLine = document.createElement('div');
      linkLine.className = 'link';
      share.onclick = function () {
        share.disabled = true;
        postTo('/review/friend-link', { friend: name }).then(function (j) {
          share.disabled = false;
          if (!j.count) { toast('Nothing to send — everything is answered'); return; }
          var text = 'A few events to check (' + j.count + ')';
          linkLine.innerHTML = 'Link for ' + escapeHtml(name) + ' (' + j.count + ' card' + (j.count === 1 ? '' : 's') + '): <a href="' + escapeHtml(j.url) + '" target="_blank" rel="noopener">open it</a> · long-press to copy';
          if (navigator.share) {
            navigator.share({ title: text, text: text, url: j.url }).catch(function () { linkLine.textContent = j.url; });
          } else if (navigator.clipboard) {
            navigator.clipboard.writeText(j.url).then(function () { toast('Link copied — ' + j.count + ' cards, send it to ' + name); }, function () { linkLine.textContent = j.url; });
          } else { linkLine.textContent = j.url; }
        }).catch(function (e) { share.disabled = false; toast('Could not build the link: ' + e.message); });
      };
      who.appendChild(share);
      group.appendChild(who);
      var ul = document.createElement('ul');
      byFriend[name].forEach(function (c) {
        var li = document.createElement('li');
        var night = c.key && c.key.split('|').length === 4 ? ' · ' + escapeHtml(dayOf(c.key)) : '';
        var q = (c.asked || []).filter(function (a) { return a.friend === name && a.question; }).map(function (a) { return a.question; })[0] || '';
        li.innerHTML = '<span class="v">🙋</span><div class="t"><div>' + escapeHtml(titleOf(c)) + ' <span class="r">' + escapeHtml(c.kind) + night + '</span></div>' + (q ? '<div class="r">' + escapeHtml(q) + '</div>' : '') + '</div>';
        var back = document.createElement('button');
        back.type = 'button'; back.textContent = 'Bring back';
        back.onclick = function () {
          postTo('/review/ask', { verdict: 'clear', key: c.key, friend: name }).then(function () {
            c.asked = (c.asked || []).filter(function (a) { return a.friend !== name; });
            if (!(c.asked || []).length) friends = friends.filter(function (f) { return f.key !== c.key; });
            if (!awaitingFriend(c) && !queue.some(function (q) { return q.key === c.key; }) && deck.cards.some(function (d) { return d.key === c.key; })) queue.unshift(c);
            render();
          }).catch(function (e) { toast('Could not take it back: ' + e.message); });
        };
        li.appendChild(back);
        ul.appendChild(li);
      });
      group.appendChild(ul);
      group.appendChild(linkLine);
      box.appendChild(group);
    });
    var reply = document.createElement('div');
    reply.className = 'reply';
    reply.innerHTML = '<input type="text" id="friend-reply" placeholder="Paste the link they sent back" autocapitalize="none" autocorrect="off"><button type="button" id="friend-reply-go">Add their answers</button>';
    box.appendChild(reply);
    document.getElementById('friend-reply-go').onclick = function () {
      var text = document.getElementById('friend-reply').value.trim();
      if (!text) return;
      postTo('/review/advice', { text: text }).then(function (j) {
        toast((j.friend || 'Your friend') + ' answered ' + j.recorded.length + (j.recorded.length === 1 ? ' card' : ' cards') + (j.unknown ? ' (' + j.unknown + ' unknown)' : ''));
        setTimeout(function () { location.reload(); }, 900);
      }).catch(function (e) { toast(e.message); });
    };
  }
  document.getElementById('sheet-cancel').onclick = closeSheet;
  function answerSheet(mode) {
    if (!pending) return closeSheet();
    var tags = Array.prototype.map.call(sheetTags.querySelectorAll('.chip.on'), function (el) { return el.getAttribute('data-tag'); });
    var text = document.getElementById('sheet-text').value.trim();
    var card = pending;
    sheet.classList.remove('open'); fitSheet(); pending = null;
    // "Not bear" rides as the tag every reader already understands (the
    // phone, older decisions, the bear verdict); the other two as a mode.
    var reason = mode === 'not-bear' ? { tags: ['not bear'], text: text } : { tags: tags, text: text, mode: mode };
    // A bulk answer: every item of the set gets this reason.
    if (card.bulk) {
      card.bulk.forEach(function (item) {
        if (item.cards[0].kind === 'dropped') { decide(item, 'reject', mode === 'not-bear' ? null : reason, 'gone-left'); return; }
        decide(item, 'reject', reason, 'gone-left');
      });
      toast('Decided ' + card.bulk.length + ' — ' + (mode === 'fix' ? 'waiting on a fix' : mode === 'never' ? 'not an event' : 'not bear'));
      return;
    }
    // On a not-bear card, "not bear" is the plain confirmation it always was.
    if (card.cards[0].kind === 'dropped') { decide(card, 'reject', mode === 'not-bear' ? null : reason, 'gone-left'); return; }
    decide(card, 'reject', reason, 'gone-left');
    toast(mode === 'fix' ? 'Waiting on a fix — it comes back when the card changes' : mode === 'never' ? 'Not an event — final' : 'Not bear — final');
  }
  document.getElementById('sheet-fix').onclick = function () { answerSheet('fix'); };
  document.getElementById('sheet-notbear').onclick = function () { answerSheet('not-bear'); };
  document.getElementById('sheet-never').onclick = function () { answerSheet('never'); };
  function notBearTop() {
    var c = topItem(); if (!c) return;
    if (c.cards[0].kind === 'dropped') { decide(c, 'reject', null, 'gone-left'); return; }
    if (c.cards[0].kind === 'bar') { pending = c; openSheet(c); return; }
    decide(c, 'reject', { tags: ['not bear'], text: '' }, 'gone-left');
    toast('Not bear — final');
  }
  document.getElementById('btn-notbear').onclick = notBearTop;

  // Drag — touch + mouse (iOS Safari delivers pointer events but starts
  // its own scroll first, so horizontal swipes died as pointercancel).
  // Vertical intent scrolls the card body natively (touch-action: pan-y);
  // horizontal intent is claimed with preventDefault on a non-passive
  // touchmove. A touch that never moved is a tap: flyer → lightbox,
  // description → expand.
  function attachDrag(el, card) {
    var startX = 0, startY = 0, dx = 0, dy = 0, active = false, moved = false, lockedH = false, lockedV = false;
    // PULL DOWN = ask a friend (owner, 2026-10-03: "one swipe option, get
    // creative, but don't do right"). Only from a card scrolled to its top
    // — there a downward pull has nothing to scroll, so it is free; a card
    // scrolled down scrolls back up as before, and up always scrolls.
    var lockedD = false, atTop = false;
    var okStamp = el.querySelector('.stamp.ok'), noStamp = el.querySelector('.stamp.no'), askStamp = el.querySelector('.stamp.ask');
    var frame = null;
    // A left swipe has three directions: UP-left = not bear (done, no
    // sheet), DOWN-left = needs a fix (the sheet opens on that answer), and
    // level = the sheet as before. The angle has to be deliberate — a level
    // swipe always wobbles a little — and the stamp names the answer while
    // the finger is still down, so nothing is a surprise on release.
    function leftZone() {
      if (dx >= 0) return '';
      var reach = Math.abs(dx);
      if (dy < -50 && -dy > reach * 0.35) return 'notbear';
      if (dy > 30 && dy > reach * 0.2) return 'fix';
      return 'ask';
    }
    function paint() {
      frame = null;
      if (lockedD) {
        var pull = Math.max(0, dy);
        el.style.transform = 'translate3d(0,' + (pull * 0.75) + 'px,0) scale(' + (1 - Math.min(pull, 300) / 2500) + ')';
        if (askStamp) askStamp.style.opacity = Math.max(0, Math.min(1, pull / 120));
        return;
      }
      // Leftwards the card follows the finger's height, so the diagonal reads.
      el.style.transform = 'translate3d(' + dx + 'px,' + (dy * (dx < 0 ? 0.7 : 0.3)) + 'px,0) rotate(' + (dx / 18) + 'deg)';
      if (okStamp) okStamp.style.opacity = Math.max(0, Math.min(1, dx / 90));
      if (noStamp) {
        noStamp.style.opacity = Math.max(0, Math.min(1, -dx / 90));
        var zone = leftZone();
        var label = zone === 'notbear' ? 'NOT BEAR' : zone === 'fix' ? 'NEEDS FIX' : 'NOT YET';
        if (noStamp.textContent !== label) noStamp.textContent = label;
      }
    }
    function reset() {
      if (frame) { cancelAnimationFrame(frame); frame = null; }
      el.style.transform = '';
      el.removeAttribute('data-dx'); el.removeAttribute('data-dy');
      if (okStamp) okStamp.style.opacity = 0;
      if (noStamp) noStamp.style.opacity = 0;
      if (askStamp) askStamp.style.opacity = 0;
    }
    // A FINGER may start a swipe anywhere on the card, links included: the
    // route line, the chips and the change rows are links, and with the
    // card scrolled to its change table 14% of it (up to 24%) was a place
    // where a swipe simply did nothing (2026-09-29, 27 cards). A touch
    // that does not move is still the browser's own tap on that link; one
    // that travels far enough to decide never becomes a click. A MOUSE
    // keeps the old rule — a press on a link is the start of a click or of
    // the browser's link drag, and the card follows the pointer, so the
    // release would land on the same link.
    function begin(x, y, target, finger) {
      var skip = finger ? 'select, textarea, input' : 'a, button, select, textarea, input, summary';
      if (target && target.closest && target.closest(skip)) return false;
      active = true; moved = false; lockedH = false; lockedV = false; lockedD = false;
      var body = el.querySelector('.card-body');
      atTop = !body || body.scrollTop <= 0;
      startX = x; startY = y; dx = 0; dy = 0;
      el.classList.add('dragging');
      return true;
    }
    function move(x, y, e) {
      if (!active) return;
      dx = x - startX; dy = y - startY;
      if (!lockedH && !lockedV && !lockedD && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        if (Math.abs(dx) > Math.abs(dy)) lockedH = true;
        else if (dy > 0 && atTop && Math.abs(dy) > Math.abs(dx) * 1.5) lockedD = true;
        else lockedV = true;
      }
      if (lockedD) {
        moved = true;
        if (e && e.cancelable) e.preventDefault();
        if (!frame) frame = requestAnimationFrame(paint);
        return;
      }
      if (!lockedH) return;
      moved = true;
      if (e && e.cancelable) e.preventDefault();
      el.setAttribute('data-dx', String(dx)); el.setAttribute('data-dy', String(dy));
      if (!frame) frame = requestAnimationFrame(paint);
    }
    function tap(target) {
      if (!target || !target.closest) return;
      if (target.closest('a, button, summary')) return; // the browser's own tap
      if (target.closest('.thumb')) { openFlyer(target.closest('.thumb')); return; }
      var desc = target.closest('.desc, .desc-more');
      if (desc) { toggleDesc(el.querySelector('.desc')); }
    }
    function end(target, cancelled) {
      if (!active) return;
      active = false;
      if (frame) { cancelAnimationFrame(frame); frame = null; paint(); }
      if (lockedD) {
        el.classList.remove('dragging'); reset();
        if (!cancelled && dy > 120) askTop();
        return;
      }
      if (!cancelled && lockedH && dx > 110) { approveTop(); return; }
      if (!cancelled && lockedH && dx < -110) {
        var zone = leftZone();
        if (zone === 'notbear') { notBearTop(); return; }
        el.classList.remove('dragging'); reset(); rejectTop(zone === 'fix'); return;
      }
      el.classList.remove('dragging');
      reset();
      if (!cancelled && !moved && !lockedV) tap(target);
    }
    // The same made-up mouse events (mousedown, mouseup) follow every
    // touch: handled as a second tap they toggled the description open and
    // shut again in one go. A mouse press right after a touch is not a mouse.
    el.addEventListener('touchstart', function (e) {
      var t = e.touches[0]; if (!t) return;
      lastTouchAt = Date.now();
      begin(t.clientX, t.clientY, e.target, true);
    }, { passive: true });
    el.addEventListener('touchmove', function (e) {
      var t = e.touches[0]; if (!t) return;
      move(t.clientX, t.clientY, e);
    }, { passive: false });
    el.addEventListener('touchend', function (e) { lastTouchAt = Date.now(); end(e.target, false); });
    el.addEventListener('touchcancel', function (e) { lastTouchAt = Date.now(); end(e.target, true); });
    el.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (Date.now() - lastTouchAt < 800) return;
      if (!begin(e.clientX, e.clientY, e.target, false)) return;
      var onMove = function (ev) { move(ev.clientX, ev.clientY, ev); };
      var onUp = function (ev) {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        end(ev.target, false);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  document.getElementById('btn-approve').onclick = approveTop;
  document.getElementById('btn-reject').onclick = function () { rejectTop(false); };
  document.getElementById('btn-skip').onclick = skipTop;
  document.getElementById('btn-undo').onclick = undoLast;
  document.addEventListener('keydown', function (e) {
    var lightbox = document.getElementById('lightbox');
    if (lightbox.classList.contains('open')) { if (e.key === 'Escape') closeFlyer(); return; }
    if (sheet.classList.contains('open')) { if (e.key === 'Escape') closeSheet(); return; }
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); approveTop(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); rejectTop(false); }
    else if (e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); skipTop(); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); notBearTop(); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); askTop(); }
    else if (e.key === 'z' || e.key === 'Z') { undoLast(); }
  });

  window.copyRejections = function () {
    fetch('/review/rejections').then(function (r) { return r.text(); }).then(function (text) {
      if (!text.trim()) { toast('No rejections yet'); return; }
      function done(ok) { toast(ok ? 'Rejections copied' : 'Copy failed'); if (!ok) window.prompt('Copy manually:', text); }
      if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(); }); return; }
      fallback();
      function fallback() {
        try { var area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.left = '-9999px'; document.body.appendChild(area); area.select(); var ok = document.execCommand('copy'); document.body.removeChild(area); done(ok); } catch (error) { done(false); }
      }
    });
  };

  if (friendMode) {
    document.getElementById('btn-approve').textContent = '✓ Looks right';
    document.getElementById('btn-reject').textContent = '✕ Something’s off';
    document.getElementById('friend-copy').onclick = function () {
      var link = friendReplyLink();
      if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { toast('Reply copied — send it to ' + deck.from); }, function () { window.prompt('Copy this link', link); });
      else window.prompt('Copy this link', link);
    };
    renderFriendSend();
  }
  render();
};
if (window.__reviewDeck.friendMode) window.__loadFriendDeck(); else window.__startDeck();
</script>
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
        icsBatchRegistry: {}, // id → { calendarName, events }, same capture
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
    state.icsBatchRegistry = adapter._icsBatchExports || {};
    state.lastRenderResults = results;
    let out = rewriteBridgeHtml(html, registries);
    out = injectHeaderBar(out, {
        savedAt: saved.savedAt || '',
        parserFilter: saved.parserFilter || '',
        calendarSnapshots: (saved.results && saved.results.publishedCalendarSnapshots) || null,
        reviewPending: countReviewPending()
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

// Latest shared-dir run, or ?run=<id>. { sharedRoot, runs, run|null }.
function resolveReviewRun(query) {
    const sharedRoot = reviewQueue.resolveSharedRoot();
    const runs = reviewQueue.describeRunFiles(sharedRoot);
    const wanted = query && typeof query.run === 'string' && reviewQueue.RUN_ID_PATTERN.test(query.run.trim())
        ? query.run.trim()
        : null;
    const runId = wanted || reviewQueue.pickLatestRunId(sharedRoot);
    const run = runId ? reviewQueue.loadRun(sharedRoot, runId) : null;
    return { sharedRoot, runs, run };
}

// { deck, ctx } — ctx carries the adapter (maps URL builders, link labels,
// calendar names; the same stubbed adapter the results render uses) and the
// deck's SharedCore (distances, notes parsing) for the card renderers.
function buildReviewDeckForRun(sharedRoot, run) {
    const store = reviewQueue.loadDecisions(reviewQueue.getDecisionsPath(sharedRoot));
    const bearVerdicts = reviewQueue.loadBearVerdicts(reviewQueue.getBearVerdictsPath(sharedRoot));
    const curatedBars = reviewQueue.loadCuratedBars(repoRoot);
    const core = reviewQueue.createDeckCore(run.payload, { curatedBars });
    const executions = reviewQueue.collectExecutions(sharedRoot);
    const cities = (run.payload && run.payload.config && run.payload.config.cities) || {};
    const phoneCalendars = reviewQueue.listPhoneCalendars(sharedRoot, cities);
    const writtenLedger = reviewQueue.loadWrittenLedger(sharedRoot);
    const friendAdvice = reviewQueue.loadFriendAdvice(reviewQueue.getFriendAdvicePath(sharedRoot));
    const publishedPictures = reviewQueue.loadPublishedPictures(sharedRoot).pictures;
    const deckOptions = { runId: run.runId, core, bearVerdicts, executions, writtenLedger, friendAdvice, publishedPictures, ...(phoneCalendars ? { phoneCalendars } : {}) };
    let deck = reviewQueue.buildDeck(run.payload, store, deckOptions);
    // The deck closes its own loops (audit 2026-09-22): notes whose fix is
    // saved or whose night has passed are dropped from the store, and a
    // card that came back changed in exactly the fields a note named is
    // approved on the owner's behalf. Both are written here — the Mac is
    // the store's only writer — and the deck is rebuilt on the new store so
    // what renders is what was stored.
    const answered = Array.isArray(deck.answeredNoteKeys) ? deck.answeredNoteKeys : [];
    const autoApprovals = Array.isArray(deck.autoApprovals) ? deck.autoApprovals : [];
    if (answered.length > 0 || autoApprovals.length > 0) {
        let next = store;
        for (const key of answered) next = reviewQueue.clearDecision(next, key).store;
        for (const decision of autoApprovals) {
            next = reviewQueue.upsertDecision(next, reviewQueue.buildDecision({ key: decision.key, kind: decision.kind, verdict: 'approve', runId: run.runId, snapshot: decision.snapshot,
                reason: { tags: [], text: `auto: the fix you asked for arrived (${decision.autoApproved.fields.join(', ')})`, mode: '' } }));
        }
        const saved = reviewQueue.saveDecisions(reviewQueue.getDecisionsPath(sharedRoot), next);
        if (answered.length > 0) console.log(`Review: dropped ${answered.length} answered "needs a fix" note(s): ${answered.join(', ')}`);
        if (autoApprovals.length > 0) console.log(`Review: auto-approved ${autoApprovals.length} card(s) whose fix arrived as asked: ${autoApprovals.map((d) => d.key).join(', ')}`);
        deck = reviewQueue.buildDeck(run.payload, saved, deckOptions);
    }
    // Inbox pictures: a push that failed at approve time is tried again
    // here, and a pending picture whose PR was merged gets its website
    // address — each at most once per 10 min.
    try {
        reviewQueue.publishApprovedPictures(reviewQueue.loadDecisions(reviewQueue.getDecisionsPath(sharedRoot)), { sharedRoot, repoRoot });
    } catch (error) {
        console.log(`Review: inbox picture retry failed: ${error.message}`);
    }
    deck.friends = reviewQueue.knownFriends(friendAdvice);
    deck.adviceBase = resolveAdvicePageBase();
    const { ScriptableAdapter } = requireScriptableAdapterWithStubs();
    return { deck, ctx: { adapter: new ScriptableAdapter({ cities }), core } };
}

// The deck's own card HTML for every card a friend has been asked about:
// from the newest run when the card is on it (its full display), else
// from the snapshot the ask kept. A picture still in the inbox is not on
// the website yet — its address is swapped for the published one or
// dropped (the card then shows no picture).
function renderFriendCardHtml(sharedRoot, store, friend) {
    const out = new Map();
    const name = String(friend || '').trim();
    const asks = (store.asks || []).filter((ask) => ask.friend === name);
    if (asks.length === 0) return out;
    let entries = new Map();
    let ctx = {};
    try {
        const { run } = resolveReviewRun({});
        if (run) {
            const built = buildReviewDeckForRun(sharedRoot, run);
            ctx = built.ctx;
            for (const entry of built.deck.cards.concat(built.deck.decided)) entries.set(entry.key, entry);
        }
    } catch (error) {
        console.log(`Review: friend cards from snapshots only (${error.message})`);
    }
    const published = reviewQueue.loadPublishedPictures(sharedRoot).pictures;
    for (const ask of asks) {
        const entry = entries.get(ask.key) || { kind: ask.kind || 'new', key: ask.key, proposal: ask.snapshot || {}, display: {} };
        let html = renderReviewCard({ ...entry, asked: [], advice: [], picture: null }, ctx);
        // The owner's bookkeeping stays home: the calendar-notes table.
        html = html.replace(/<details class="notes">[\s\S]*?<\/details>/g, '');
        html = html.replace(/src="\/inbox\/file\/([^"]+)"/g, (whole, name) => {
            let decoded = '';
            try { decoded = decodeURIComponent(name); } catch (_) { decoded = name; }
            const record = published[`https://inbox.chunky.dad/file/${encodeURIComponent(decoded)}`];
            return record && record.url ? `src="${escapeHtmlText(record.url)}"` : 'src=""';
        });
        out.set(ask.key, html);
    }
    return out;
}

// Where the friend's page lives: the website, or (CHUNKY_ADVICE_BASE) a
// copy for testing — this server serves the same file at /advice/.
function resolveAdvicePageBase() {
    const raw = String(process.env.CHUNKY_ADVICE_BASE || '').trim();
    return raw || reviewQueue.ADVICE_PAGE_DEFAULT_BASE;
}

// Pending-card count for the header bar on /: cheap when the run is cached
// (readRunFile keys on mtime), and never fatal.
function countReviewPending() {
    try {
        const { sharedRoot, run } = resolveReviewRun({});
        if (!run) return 0;
        return buildReviewDeckForRun(sharedRoot, run).deck.counts.pending;
    } catch (error) {
        return 0;
    }
}

// Transport compression. The results page of a full run is 23.7 MB of
// HTML and the deck 2.7 MB (run 20260929-091555), read on a phone over the
// tailnet; both are markup that repeats itself, so gzip takes them to
// 0.9 MB and 0.2 MB for ~55 ms of CPU. Only when the client asks for it
// (handleRequest notes the request's Accept-Encoding on the response), and
// never for a body too small to gain.
const GZIP_MIN_BYTES = 1024;
function requestAcceptsGzip(req) {
    const header = req && req.headers ? req.headers['accept-encoding'] : '';
    return /(^|[\s,])gzip(\s*;\s*q=(0\.\d*[1-9]\d*|1(\.0*)?))?\s*(,|$)/i.test(String(header || ''));
}

function sendBody(res, status, contentType, body) {
    const text = String(body == null ? '' : body);
    if (res && res.chunkyAcceptsGzip === true && Buffer.byteLength(text) >= GZIP_MIN_BYTES) {
        const packed = zlib.gzipSync(text);
        res.writeHead(status, { 'Content-Type': contentType, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Content-Length': packed.length });
        return res.end(packed);
    }
    res.writeHead(status, { 'Content-Type': contentType });
    return res.end(text);
}

function sendJson(res, status, value) {
    return sendBody(res, status, 'application/json; charset=utf-8', JSON.stringify(value));
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
    return sendBody(res, status, 'text/html; charset=utf-8', html);
}

function sendText(res, status, text) {
    return sendBody(res, status, 'text/plain; charset=utf-8', text);
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
    res.chunkyAcceptsGzip = requestAcceptsGzip(req);

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

    // Browsers ask for it on every page; a 404 is a console error on each
    // load of the deck and the results page.
    if (pathname === '/favicon.ico') {
        res.writeHead(204, {});
        return res.end();
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

    if (pathname.startsWith('/ics-batch/') && req.method === 'GET') {
        const id = pathname.slice('/ics-batch/'.length);
        const batch = state.icsBatchRegistry ? state.icsBatchRegistry[id] : null;
        if (!batch) {
            return sendText(res, 404, `No batch with ICS id "${id}" in the latest render.`);
        }
        const results = state.lastRenderResults || (loadLatestRun() || {}).results || {};
        const cities = (results.config && results.config.cities) || {};
        const built = buildBatchIcs(batch, cities, loadEventSchema());
        if (!built) {
            return sendText(res, 500, 'Batch ICS build failed.');
        }
        res.writeHead(200, {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': `attachment; filename="${built.fileName}"`
        });
        return res.end(built.icsText);
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

    if (pathname === '/review' && req.method === 'GET') {
        const { sharedRoot, runs, run } = resolveReviewRun(query);
        if (!run) {
            return sendHtml(res, 200, renderReviewEmptyPage(
                runs.length === 0
                    ? 'No saved runs in the shared dir yet — the daily Mac run (or a phone run) puts one in runs/.'
                    : 'That run could not be read (still syncing from iCloud, or not a run id).',
                { sharedRoot }
            ));
        }
        try {
            const { deck, ctx } = buildReviewDeckForRun(sharedRoot, run);
            return sendHtml(res, 200, renderReviewPage(deck, { runs, scriptName: resolveReviewScriptName(), ctx, phoneCalendarListCapturedAt: reviewQueue.getPhoneCalendarListCapturedAt(sharedRoot) }));
        } catch (error) {
            console.error(`Review render failed: ${error.stack || error}`);
            return sendText(res, 500, `Review render failed: ${error.message}`);
        }
    }

    if (pathname === '/review/deck.json' && req.method === 'GET') {
        const { sharedRoot, run } = resolveReviewRun(query);
        if (!run) return sendJson(res, 404, { ok: false, error: 'no run' });
        try {
            const { deck } = buildReviewDeckForRun(sharedRoot, run);
            return sendJson(res, 200, { ok: true, ...deck });
        } catch (error) {
            return sendJson(res, 500, { ok: false, error: error.message });
        }
    }

    if (pathname === '/review/decide' && req.method === 'POST') {
        const raw = await readRequestBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (error) {
            return sendJson(res, 400, { ok: false, error: 'body must be JSON' });
        }
        const sharedRoot = reviewQueue.resolveSharedRoot();
        const decisionsPath = reviewQueue.getDecisionsPath(sharedRoot);
        try {
            let store = reviewQueue.loadDecisions(decisionsPath);
            if (body && body.verdict === 'clear') {
                const key = typeof body.key === 'string' ? body.key.trim() : '';
                if (!key) return sendJson(res, 400, { ok: false, error: 'clear needs a key' });
                // The undo of a swipe that overwrote an earlier decision
                // puts that decision back (reviewQueue.restoreDecision).
                const restored = body.restore ? reviewQueue.restoreDecision(store, key, body.restore) : { restored: false };
                if (restored.restored) {
                    store = reviewQueue.saveDecisions(decisionsPath, restored.store);
                    console.log(`Review: undone ${key} — the ${body.restore.verdict} of ${String(body.restore.stampedAt || '').slice(0, 10) || 'earlier'} is back`);
                    return sendJson(res, 200, { ok: true, removed: true, restored: true, decisions: store.decisions.length });
                }
                const cleared = reviewQueue.clearDecision(store, key);
                store = reviewQueue.saveDecisions(decisionsPath, cleared.store);
                console.log(`Review: cleared decision ${key}${cleared.removed ? '' : ' (was not stored)'}`);
                return sendJson(res, 200, { ok: true, removed: cleared.removed, restored: false, decisions: store.decisions.length });
            }
            const decision = reviewQueue.buildDecision(body);
            const replaced = store.decisions.find((entry) => entry.key === decision.key) || null;
            store = reviewQueue.saveDecisions(decisionsPath, reviewQueue.upsertDecision(store, decision));
            console.log(`Review: ${decision.verdict} ${decision.kind} ${decision.key}${decision.reason ? ` — ${[decision.reason.tags.join(', '), decision.reason.text].filter(Boolean).join(' / ')}` : ''}`);
            // An approved card whose picture lives in the inbox: push the
            // picture to the pictures PR now; once merged, the phone writes
            // the event with its website address.
            let picture = null;
            if (decision.verdict === 'approve' && decision.snapshot && reviewQueue.isSharedInboxAddress(decision.snapshot.image)) {
                try {
                    picture = reviewQueue.publishSharedPicture({ sharedRoot, repoRoot, address: decision.snapshot.image, title: decision.snapshot.title, startDate: decision.snapshot.startDate });
                    console.log(`Review: inbox picture for ${decision.key} → ${picture.url || (picture.pr && picture.pr.url) || 'pushed'}`);
                } catch (error) {
                    picture = { error: error.message };
                    console.log(`Review: inbox picture for ${decision.key} NOT published (${error.message}) — tried again at the next deck build`);
                }
            }
            return sendJson(res, 200, { ok: true, decision, replaced, decisions: store.decisions.length, ...(picture ? { picture } : {}) });
        } catch (error) {
            const status = /must be|needs a/.test(error.message) ? 400 : 500;
            return sendJson(res, status, { ok: false, error: error.message });
        }
    }

    // PHONE A FRIEND — the Mac is friend-advice.json's only writer.
    // Flag a card for a friend (verdict 'clear' takes it back).
    if (pathname === '/review/ask' && req.method === 'POST') {
        const raw = await readRequestBody(req);
        let body;
        try { body = JSON.parse(raw || '{}'); } catch (error) { return sendJson(res, 400, { ok: false, error: 'body must be JSON' }); }
        const sharedRoot = reviewQueue.resolveSharedRoot();
        const file = reviewQueue.getFriendAdvicePath(sharedRoot);
        try {
            let store = reviewQueue.loadFriendAdvice(file);
            if (body && body.verdict === 'clear') {
                const cleared = reviewQueue.clearFriendAsk(store, String(body.key || ''), body.friend);
                store = reviewQueue.saveFriendAdvice(file, cleared.store);
                console.log(`Review: took ${body.key} back from ${body.friend || 'every friend'}`);
                return sendJson(res, 200, { ok: true, removed: cleared.removed });
            }
            store = reviewQueue.saveFriendAdvice(file, reviewQueue.recordFriendAsk(store, body || {}));
            console.log(`Review: asked ${body.friend} about ${body.key}`);
            return sendJson(res, 200, { ok: true, asks: store.asks.length, friends: reviewQueue.knownFriends(store) });
        } catch (error) {
            return sendJson(res, /needs a/.test(error.message) ? 400 : 500, { ok: false, error: error.message });
        }
    }

    // One link for everything a friend was asked and has not answered.
    if (pathname === '/review/friend-link' && req.method === 'POST') {
        const raw = await readRequestBody(req);
        let body;
        try { body = JSON.parse(raw || '{}'); } catch (error) { return sendJson(res, 400, { ok: false, error: 'body must be JSON' }); }
        const sharedRoot = reviewQueue.resolveSharedRoot();
        const file = reviewQueue.getFriendAdvicePath(sharedRoot);
        try {
            const store = reviewQueue.loadFriendAdvice(file);
            const htmlByKey = renderFriendCardHtml(sharedRoot, store, body && body.friend);
            const built = reviewQueue.buildFriendLink(store, { friend: body && body.friend, question: body && body.question, base: resolveAdvicePageBase(), htmlByKey });
            if (built.count > 0) reviewQueue.saveFriendAdvice(file, built.store);
            console.log(`Review: link for ${body.friend} — ${built.count} card(s), ${built.url.length} chars${built.left ? `, ${built.left} wait for the next link` : ''}`);
            return sendJson(res, 200, { ok: true, url: built.url, count: built.count, left: built.left, exportId: built.exportId });
        } catch (error) {
            return sendJson(res, /needs a/.test(error.message) ? 400 : 500, { ok: false, error: error.message });
        }
    }

    // A friend's reply (the page's link back, or its hash) → advice rows.
    if (pathname === '/review/advice' && req.method === 'POST') {
        const raw = await readRequestBody(req);
        let body;
        try { body = JSON.parse(raw || '{}'); } catch (error) { return sendJson(res, 400, { ok: false, error: 'body must be JSON' }); }
        const reply = reviewQueue.parseFriendReply(body && body.text);
        if (!reply) return sendJson(res, 400, { ok: false, error: 'that is not a reply link from the friend page' });
        const sharedRoot = reviewQueue.resolveSharedRoot();
        const file = reviewQueue.getFriendAdvicePath(sharedRoot);
        try {
            const result = reviewQueue.recordFriendReply(reviewQueue.loadFriendAdvice(file), reply);
            reviewQueue.saveFriendAdvice(file, result.store);
            console.log(`Review: ${reply.friend || 'a friend'} answered ${result.recorded.length} card(s)${result.unknown ? `, ${result.unknown} unknown` : ''}`);
            return sendJson(res, 200, { ok: true, friend: reply.friend, recorded: result.recorded, unknown: result.unknown });
        } catch (error) {
            return sendJson(res, 500, { ok: false, error: error.message });
        }
    }

    // The friend's page itself, for links built against this server
    // (CHUNKY_ADVICE_BASE) — the same file the website serves at /advice/.
    if ((pathname === '/advice/' || pathname === '/advice' || pathname === '/advice/index.html') && req.method === 'GET') {
        return sendHtml(res, 200, renderFriendPage());
    }

    // 🐻 / 🚫 from the deck: the phone's own verdict store, same identity
    // and entry shape as a results-sheet tap.
    if (pathname === '/review/bear' && req.method === 'POST') {
        const raw = await readRequestBody(req);
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch (error) {
            return sendJson(res, 400, { ok: false, error: 'body must be JSON' });
        }
        const verdict = body && (body.verdict === 'bear' || body.verdict === 'not_bear' || body.verdict === 'clear') ? body.verdict : null;
        if (!verdict) return sendJson(res, 400, { ok: false, error: 'verdict must be bear, not_bear or clear' });
        const sharedRoot = reviewQueue.resolveSharedRoot();
        const verdictsPath = reviewQueue.getBearVerdictsPath(sharedRoot);
        try {
            const { SharedCore } = require(path.join(repoRoot, 'scripts', 'shared-core'));
            const { EventSchema } = require(path.join(repoRoot, 'scripts', 'event-schema'));
            const latest = resolveReviewRun({}).run;
            const cities = (latest && latest.payload && latest.payload.config && latest.payload.config.cities) || {};
            const core = new SharedCore(cities, { eventSchema: EventSchema });
            const current = reviewQueue.loadBearVerdicts(verdictsPath);
            if (verdict === 'clear') {
                const restored = body.restore ? reviewQueue.restoreBearVerdict(current, core, body.restore) : { restored: false };
                if (restored.restored) {
                    reviewQueue.saveBearVerdicts(verdictsPath, restored.verdicts);
                    console.log(`Review: undone — the ${body.restore.verdict} verdict of ${String(body.restore.stampedAt || '').slice(0, 10) || 'earlier'} on "${body.restore.title}" is back`);
                    return sendJson(res, 200, { ok: true, removed: true, restored: true, verdicts: restored.verdicts.length });
                }
                const cleared = reviewQueue.clearBearVerdict(current, core, body.event || {});
                reviewQueue.saveBearVerdicts(verdictsPath, cleared.verdicts);
                const clearedTitles = Array.isArray(cleared.removedTitles) ? cleared.removedTitles : [];
                console.log(`Review: cleared bear verdict for "${(body.event && body.event.title) || '?'}"${cleared.removed ? (clearedTitles.length > 0 ? ` — removed ${clearedTitles.map((title) => `"${title}"`).join(', ')}` : '') : ' (none stored)'}`);
                return sendJson(res, 200, { ok: true, removed: cleared.removed, verdicts: cleared.verdicts.length });
            }
            const result = reviewQueue.upsertBearVerdict(current, core, body.event || {}, verdict);
            reviewQueue.saveBearVerdicts(verdictsPath, result.verdicts);
            console.log(`Review: ${verdict} — "${result.entry.title}" @ "${result.entry.venue || result.entry.city}"`);
            if (verdict === 'bear') {
                const decisionsPath = reviewQueue.getDecisionsPath(sharedRoot);
                const cleared = reviewQueue.clearNotBearRejections(reviewQueue.loadDecisions(decisionsPath), core, body.event || {});
                if (cleared.removed.length > 0) {
                    reviewQueue.saveDecisions(decisionsPath, cleared.store);
                    console.log(`Review: bear verdict also cleared ${cleared.removed.length} "not bear" rejection(s): ${cleared.removed.join(', ')}`);
                }
            }
            return sendJson(res, 200, { ok: true, entry: result.entry, replaced: result.replaced || null, verdicts: result.verdicts.length });
        } catch (error) {
            const status = /must be|no title identity/.test(error.message) ? 400 : 500;
            return sendJson(res, status, { ok: false, error: error.message });
        }
    }

    if (pathname === '/review/decisions.json' && req.method === 'GET') {
        const sharedRoot = reviewQueue.resolveSharedRoot();
        return sendJson(res, 200, reviewQueue.loadDecisions(reviewQueue.getDecisionsPath(sharedRoot)));
    }

    if (pathname === '/review/rejections' && req.method === 'GET') {
        const sharedRoot = reviewQueue.resolveSharedRoot();
        const store = reviewQueue.loadDecisions(reviewQueue.getDecisionsPath(sharedRoot));
        return sendText(res, 200, reviewQueue.formatRejectionsText(store));
    }

    // A picture the owner dropped into the shared inbox (a flyer
    // screenshot): the deck shows it from here, since its pipeline address
    // (https://inbox.chunky.dad/file/<name>) resolves nowhere. Read-only;
    // one path segment, inside the inbox folder only.
    if (pathname.startsWith('/inbox/file/') && req.method === 'GET') {
        let name = '';
        try { name = decodeURIComponent(pathname.slice('/inbox/file/'.length)); } catch (_) { name = ''; }
        const found = name ? reviewQueue.readSharedInboxFile(reviewQueue.resolveSharedRoot(), name) : null;
        if (!found) return sendText(res, 404, 'No such file in the inbox');
        const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', pdf: 'application/pdf', json: 'application/json; charset=utf-8', html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', txt: 'text/plain; charset=utf-8' };
        const extension = (name.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
        res.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream', 'Content-Length': found.buffer.length, 'Cache-Control': 'private, max-age=3600' });
        return res.end(found.buffer);
    }

    return sendText(res, 404, 'Not found. Endpoints: / /run /run-form /log /ics/<id> /ics-batch/<id> /review /review/deck.json /review/decide /review/bear /review/decisions.json /review/rejections /review/ask /review/friend-link /review/advice /advice/ /inbox/file/<name>');
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
        console.log(`  Review deck: http://localhost:${port}/review  (shared dir: ${reviewQueue.resolveSharedRoot()})`);
    });
    return { server, state };
}

module.exports = {
    DEFAULT_PORT,
    BRIDGE_SHIM_MARKER,
    HEADER_BAR_MARKER,
    parseRequestUrl,
    requestAcceptsGzip,
    createRunLock,
    listParserNames,
    escapeHtmlText,
    jsonForInlineScript,
    rewriteBridgeHtml,
    injectHeaderBar,
    formatCalendarSnapshotLabel,
    buildEventIcs,
    buildBatchIcs,
    tailLines,
    renderRunFormPage,
    renderConfirmRunPage,
    parsePortFromArgv,
    lookupIcsEvent,
    resolveReviewScriptName,
    buildScriptableExecuteLink,
    buildScriptableSnapshotLink,
    formatReviewDateLine,
    formatReviewUtcLine,
    describeReviewTimeDelta,
    renderReviewChangeRows,
    renderReviewRouteLine,
    renderReviewBearRow,
    reviewUrlLabel,
    renderReviewCard,
    renderReviewPage,
    renderFriendPage,
  renderFriendPage,
    renderReviewEmptyPage,
    createServerState,
    handleRequest,
    startServer
};

if (require.main === module) {
    startServer(parsePortFromArgv(process.argv.slice(2)));
}

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
function formatCalendarSnapshotLabel(snapshots, nowMs = Date.now()) {
    if (!snapshots || typeof snapshots !== 'object') return '';
    const segments = [];
    for (const city of Object.keys(snapshots).sort()) {
        const snapshot = snapshots[city];
        if (!snapshot || typeof snapshot !== 'object') continue;
        if (snapshot.status === 'ok' && snapshot.fetchedAt) {
            const fetchedMs = Date.parse(snapshot.fetchedAt);
            const age = Number.isFinite(fetchedMs) ? formatSnapshotAge(nowMs - fetchedMs) : null;
            segments.push(`${city} ${age ? `${age} old` : 'fresh'}${snapshot.source === 'phone' ? ' (phone)' : ''}`);
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
    const bar = `
<div id="${HEADER_BAR_MARKER}" style="position:sticky; top:0; z-index:9999; display:flex; gap:14px; align-items:center; flex-wrap:wrap; padding:8px 14px; background:#1c1c1e; color:#f2f2f7; font:13px -apple-system, sans-serif; border-bottom:2px solid #ff6b35;">
    <span style="font-weight:700;">chunky.dad scraper server</span>
    <span>${runLabel}${parserLabel}</span>${snapshotSpan}
    <a href="/run-form" style="color:#ffd60a; font-weight:600; text-decoration:none;">▶ Run scraper</a>
    <a href="/review" style="color:#ffd60a; font-weight:600; text-decoration:none;">🃏 Review${reviewCount}</a>
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
function formatReviewDateLine(startIso, endIso, timezone) {
    const start = reviewDateParts(startIso, timezone);
    if (!start) return '';
    const end = reviewDateParts(endIso, timezone);
    const hasRealEnd = Boolean(end && end.ms > start.ms);
    let line = `${start.dayYear} · ${start.time}`;
    if (hasRealEnd) line += end.dayKey === start.dayKey ? ` – ${end.time}` : ` – ${end.day} ${end.time}`;
    if (start.zone) line += ` ${start.zone}`;
    if (!hasRealEnd) line += ' (no end listed)';
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

const REVIEW_CHANGE_LABELS = { title: 'Title', startDate: 'Starts', endDate: 'Ends', location: 'Pin', url: 'Event page' };

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
    festival: 'Festival', tea: 'Tea', recurrence: 'Recurrence', city: 'City'
};
function reviewVisibleText(value) {
    return String(value == null ? '' : value).replace(/\u00ad/g, '·').replace(/[\u200b\u200c\u200d\ufeff]/g, '⁞');
}
function renderReviewNotesChangeRows(display = {}) {
    const list = Array.isArray(display.notesChanges) ? display.notesChanges : [];
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
    if (display.recurring) badges.push('<span class="badge">🔁 recurring — ICS only</span>');
    if (display.seriesMatchTitle) badges.push(`<span class="badge">🔁 matches saved series “${escapeHtmlText(display.seriesMatchTitle)}”</span>`);
    if (Array.isArray(display.sanityCodes) && display.sanityCodes.length > 0) badges.push(`<span class="badge warn">⚠️ ${escapeHtmlText(display.sanityCodes.join(', '))}</span>`);
    if (Array.isArray(display.venueOverlaps) && display.venueOverlaps.length > 0) badges.push(`<span class="badge warn">⚔️ overlaps ${escapeHtmlText(display.venueOverlaps.join(', '))}</span>`);
    return badges.length > 0 ? `<div class="badges">${badges.join('')}</div>` : '';
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
        ? `<span class="bear-stored">you said: ${stored === 'bear' ? '🐻 bear' : '🚫 not bear'}${display.bearVerdictStampedAt ? ` (${escapeHtmlText(String(display.bearVerdictStampedAt).slice(0, 10))})` : ''}</span>`
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
function renderReviewCard(entry, ctx = {}) {
    if (entry && entry.kind === 'bar') return renderReviewBarCard(entry, ctx);
    const proposal = entry && entry.proposal ? entry.proposal : {};
    const display = entry && entry.display ? entry.display : {};
    const adapter = ctx.adapter;
    const isOverride = entry.kind === 'override';
    const isMerge = entry.kind === 'merge' || isOverride;
    const isDropped = entry.kind === 'dropped';
    const tz = proposal.timezone || null;
    const dateLine = formatReviewDateLine(proposal.startDate, proposal.endDate, tz);
    const utcLine = formatReviewUtcLine(proposal.startDate, proposal.endDate);
    const changes = isMerge && proposal.changes && typeof proposal.changes === 'object' ? proposal.changes : {};
    const existingTitle = isMerge && proposal.existingTitle && proposal.existingTitle !== proposal.title && !changes.title
        ? `<div class="line muted">${isOverride ? 'series' : 'calendar title'}: ${escapeHtmlText(proposal.existingTitle)}</div>`
        : '';
    const overrideNight = isOverride && proposal.overrideOf
        ? (() => { const parts = reviewDateParts(proposal.overrideOf, tz); return parts ? `<div class="line muted">replaces the series night of ${escapeHtmlText(parts.day)} (${escapeHtmlText(proposal.existingTitle || 'series')})</div>` : ''; })()
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
  <div class="kind-row"><span class="kind ${isMerge ? 'kind-merge' : isDropped ? 'kind-dropped' : 'kind-new'}">${isOverride ? '🗓️ Override — this night only' : isMerge ? '🔀 Update saved event' : isDropped ? '🚫 Dropped as not bear' : '✨ New event'}</span>${isDropped && proposal.occurrences > 1 ? `<span class="muted reason">${proposal.occurrences} occurrences</span>` : display.analysisReason ? `<span class="muted reason">${escapeHtmlText(display.analysisReason)}</span>` : ''}</div>
  <h2>${escapeHtmlText(proposal.title)}</h2>
  ${existingTitle}
  ${overrideNight}
  ${renderReviewBadges({ ...display })}
  <div class="line">📅 ${escapeHtmlText(dateLine)}</div>
  ${utcLine ? `<div class="utc">${escapeHtmlText(utcLine)}</div>` : ''}
  ${renderReviewRouteLine(ctx, { bar: proposal.bar, address: proposal.address, city: proposal.city, coordinates: proposal.location, barSource: display.barSource })}
  <div class="line muted">${escapeHtmlText(sourceBits.join(' · '))}</div>
  ${chips ? `<div class="chips">${chips}</div>` : ''}
  ${renderReviewBearRow(display, proposal)}
  ${isMerge ? renderReviewChangeRows(changes, proposal, ctx, display.changeContext, renderReviewNotesChangeRows(display)) : ''}
  ${description ? `<div class="desc clamped">${escapeHtmlText(description)}</div>${description.length > 220 ? '<div class="desc-more">… more</div>' : ''}` : ''}
  ${renderReviewNotes(display.notes, ctx)}
</div>`;
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
        title: entry.kind === 'bar' ? entry.proposal.name : entry.proposal.title,
        proposal: entry.proposal,
        bearIdentity: entry.display && entry.display.bearIdentity ? entry.display.bearIdentity : null,
        html: renderReviewCard(entry, ctx)
    }));
    const payload = {
        runId: deck.runId,
        savedAt: deck.savedAt,
        environment: deck.environment,
        cards,
        decided,
        counts: deck.counts,
        tags: reviewQueue.REVIEW_REASON_TAGS,
        executeLink: scriptLink
    };
    // The newest 20 runs, plus the deck's own run when it is older than that
    // (the picker must always show what is on screen).
    const listed = runs.slice(0, 20);
    if (deck.runId && !listed.some((run) => run.runId === deck.runId)) {
        listed.push({ runId: deck.runId, available: true });
    }
    const runOptions = listed.map((run) => {
        const selected = run.runId === deck.runId ? ' selected' : '';
        const label = `${run.runId}${run.available ? '' : ' (syncing)'}`;
        return `<option value="${escapeHtmlText(run.runId)}"${selected}${run.available ? '' : ' disabled'}>${escapeHtmlText(label)}</option>`;
    }).join('');
    const SharedCore = require(path.join(repoRoot, 'scripts', 'shared-core')).SharedCore;
    const savedLabel = deck.savedAt || deck.runId
        ? escapeHtmlText(`run ${SharedCore.formatRunAgeLabel(deck.savedAt, deck.runId)}`)
        : '';
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Review · chunky.dad</title>
<style>
:root { --bg:#f4f2ee; --card:#ffffff; --ink:#1d1b18; --muted:#6f6a62; --line:#e2ddd4; --accent:#ff6b35; --ok:#2f9e5f; --no:#d0453c; --skip:#8a8378; --shadow:0 12px 32px rgba(40,30,10,0.18); }
@media (prefers-color-scheme: dark) { :root { --bg:#151412; --card:#23211d; --ink:#f2efe9; --muted:#a39d92; --line:#3a362f; --shadow:0 12px 32px rgba(0,0,0,0.55); } }
* { box-sizing:border-box; }
html, body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.4 -apple-system, "SF Pro Text", system-ui, sans-serif; -webkit-text-size-adjust:100%; }
a { color:var(--accent); }
.top { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:8px 14px; align-items:center; padding:10px 14px; padding-top:calc(10px + env(safe-area-inset-top)); background:var(--bg); border-bottom:1px solid var(--line); }
.top h1 { font-size:17px; margin:0; }
.top select { font:inherit; padding:4px 8px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--ink); }
.pills { display:flex; gap:6px; flex-wrap:wrap; }
.pill { font-size:12px; padding:3px 9px; border-radius:999px; border:1px solid var(--line); background:var(--card); color:var(--muted); cursor:pointer; }
.pill.on { border-color:var(--accent); color:var(--ink); font-weight:600; }
.pill b { color:var(--ink); }
.stage { position:relative; max-width:560px; margin:14px auto 0; padding:0 14px; height:min(68vh, 640px); }
.card { position:absolute; inset:0 14px; background:var(--card); border-radius:18px; box-shadow:var(--shadow); overflow:hidden; touch-action:pan-y; user-select:none; -webkit-user-select:none; transition:transform .25s ease, opacity .25s ease; will-change:transform; }
.card.dragging { transition:none; }
.card.behind { transform:scale(.96) translateY(10px); opacity:.85; pointer-events:none; }
.card.behind2 { transform:scale(.92) translateY(20px); opacity:.6; pointer-events:none; }
.card.gone-right { transform:translate(120vw, -20px) rotate(18deg); opacity:0; }
.card.gone-left { transform:translate(-120vw, -20px) rotate(-18deg); opacity:0; }
.card.gone-down { transform:translateY(90vh) scale(.9); opacity:0; }
.card-body { height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:14px 16px 18px; }
.thumb { margin:-14px -16px 12px; background:#0d0c0b; display:flex; justify-content:center; position:relative; cursor:zoom-in; }
.card { -webkit-touch-callout:none; }
.thumb img { display:block; max-width:100%; width:auto; height:auto; max-height:40vh; object-fit:contain; }
.thumb.portrait img { max-height:46vh; }
.thumb.landscape img { width:100%; max-height:32vh; }
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
.chg { display:grid; grid-template-columns:76px 1fr; gap:3px 10px; padding:8px 10px; border-top:1px solid var(--line); font-size:14px; }
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
.controls { display:flex; justify-content:center; align-items:center; gap:18px; padding:16px 14px 6px; }
.controls button { font:inherit; font-weight:700; border:none; border-radius:999px; padding:12px 18px; color:#fff; cursor:pointer; min-width:96px; }
.btn-no { background:var(--no); } .btn-ok { background:var(--ok); } .btn-skip { background:var(--skip); min-width:auto; padding:10px 14px; }
.controls button:disabled { opacity:.35; cursor:default; }
.meta { text-align:center; color:var(--muted); font-size:13px; padding:0 14px 8px; }
.meta button { font:inherit; background:none; border:none; color:var(--accent); cursor:pointer; padding:0 6px; }
.execute { display:block; max-width:560px; margin:8px auto 0; padding:0 14px; }
.execute a, .execute span { display:block; text-align:center; padding:12px; border-radius:12px; font-weight:700; text-decoration:none; }
.execute a { background:var(--accent); color:#fff; }
.execute span { background:var(--card); color:var(--muted); border:1px dashed var(--line); }
.execute small { display:block; text-align:center; color:var(--muted); font-weight:400; margin-top:6px; }
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
.sheet .panel { width:100%; max-width:560px; margin:0 auto; background:var(--card); border-radius:18px 18px 0 0; padding:16px 16px calc(16px + env(safe-area-inset-bottom)); }
.sheet h3 { margin:0 0 10px; font-size:16px; }
.sheet textarea { width:100%; min-height:72px; font:inherit; padding:8px 10px; border-radius:10px; border:1px solid var(--line); background:var(--bg); color:var(--ink); margin-top:10px; }
.sheet .actions { display:flex; gap:10px; justify-content:flex-end; margin-top:12px; }
.sheet .actions button { font:inherit; font-weight:700; border:none; border-radius:999px; padding:10px 18px; cursor:pointer; }
.empty { text-align:center; color:var(--muted); padding:60px 20px; }
.toast { position:fixed; left:50%; bottom:calc(24px + env(safe-area-inset-bottom)); transform:translateX(-50%); background:var(--ink); color:var(--bg); padding:8px 14px; border-radius:999px; font-size:13px; opacity:0; transition:opacity .2s; pointer-events:none; z-index:30; }
.toast.show { opacity:1; }
@media (prefers-reduced-motion: reduce) { .card { transition:none; } }
</style></head>
<body>
<div class="top">
  <h1>🃏 Review</h1>
  <select id="run-select" onchange="location.href='/review?run='+encodeURIComponent(this.value)">${runOptions}</select>
  <span class="muted" style="font-size:12px;">${savedLabel}${deck.environment ? ` · ${escapeHtmlText(deck.environment)}` : ''}</span>
  <div class="pills" id="filters"></div>
  <a href="/" style="margin-left:auto; font-size:13px;">Results</a>
</div>
<div class="stage" id="stage"></div>
<div class="controls">
  <button class="btn-no" id="btn-reject" type="button">✕ Reject</button>
  <button class="btn-skip" id="btn-skip" type="button">↷ Skip</button>
  <button class="btn-ok" id="btn-approve" type="button">✓ Approve</button>
</div>
<div class="meta"><span id="left"></span> · <button type="button" id="btn-undo">↩︎ Undo</button> · ← reject · → approve · ␣ skip</div>
<div class="execute" id="execute"></div>
<details class="decided" id="decided-wrap">
  <summary>Decided <span id="decided-count"></span> · <button type="button" id="btn-copy-rejections" onclick="event.preventDefault(); copyRejections();">Copy rejections</button></summary>
  <ul id="decided"></ul>
</details>
<div class="sheet" id="sheet">
  <div class="panel">
    <h3>Why not? <span class="muted" id="sheet-title"></span></h3>
    <div class="chips" id="sheet-tags"></div>
    <textarea id="sheet-text" placeholder="Anything else (optional) — this is what gets fixed"></textarea>
    <div class="actions">
      <button type="button" id="sheet-cancel" style="background:var(--line); color:var(--ink);">Cancel</button>
      <button type="button" id="sheet-reject" style="background:var(--no); color:#fff;">Reject</button>
    </div>
  </div>
</div>
<div class="lightbox" id="lightbox" onclick="closeFlyer()"><img alt=""></div>
<div class="toast" id="toast"></div>
<script>
function openFlyer(el) {
  var img = el && el.querySelector ? el.querySelector('img') : null;
  if (!img || !img.src) return;
  var box = document.getElementById('lightbox');
  box.querySelector('img').src = img.src;
  box.classList.add('open');
}
function closeFlyer() { document.getElementById('lightbox').classList.remove('open'); }
function toggleDesc(el) { if (el) el.classList.toggle('clamped'); }
</script>
<script>
window.__reviewDeck = ${jsonForInlineScript(payload)};
(function () {
  var deck = window.__reviewDeck;
  var queue = deck.cards.slice();
  var decided = deck.decided.slice();
  var history = [];
  var filter = 'all';
  var pending = null; // card awaiting the reject sheet
  var stage = document.getElementById('stage');
  var toastEl = document.getElementById('toast');
  var toastTimer = null;

  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
  }
  function tabOf(kind) { return kind === 'override' ? 'merge' : kind; }
  function visible() {
    return queue.filter(function (c) { return filter === 'all' ? c.kind !== 'dropped' : tabOf(c.kind) === filter; });
  }
  function counts() {
    var out = { all: 0, new: 0, merge: 0, bar: 0, dropped: 0 };
    queue.forEach(function (c) { out[tabOf(c.kind)] = (out[tabOf(c.kind)] || 0) + 1; if (c.kind !== 'dropped') out.all++; });
    return out;
  }
  function renderFilters() {
    var c = counts();
    var html = '';
    [['all', 'All'], ['new', 'New'], ['merge', 'Updates'], ['bar', 'Bars'], ['dropped', 'Not bear']].forEach(function (pair) {
      html += '<span class="pill' + (filter === pair[0] ? ' on' : '') + '" data-f="' + pair[0] + '">' + pair[1] + ' <b>' + (c[pair[0]] || 0) + '</b></span>';
    });
    document.getElementById('filters').innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll('#filters .pill'), function (el) {
      el.onclick = function () { filter = el.getAttribute('data-f'); render(); };
    });
  }
  function renderStage() {
    var list = visible();
    stage.innerHTML = '';
    if (list.length === 0) {
      stage.innerHTML = '<div class="empty">Nothing left to review' + (queue.length ? ' in this filter' : ' in this run') + '. 🐻</div>';
    }
    list.slice(0, 3).forEach(function (card, i) {
      var el = document.createElement('div');
      el.className = 'card' + (i === 1 ? ' behind' : i === 2 ? ' behind2' : '');
      el.style.zIndex = String(3 - i); // the top card paints last
      el.setAttribute('data-key', card.key);
      el.innerHTML = card.html + '<div class="stamp ok">APPROVE</div><div class="stamp no">REJECT</div>';
      stage.appendChild(el);
      if (i === 0) attachDrag(el, card);
    });
    document.getElementById('left').textContent = list.length + ' left';
    var disabled = list.length === 0;
    ['btn-reject', 'btn-skip', 'btn-approve'].forEach(function (id) { document.getElementById(id).disabled = disabled; });
    document.getElementById('btn-undo').disabled = history.length === 0;
  }
  function renderExecute() {
    var approved = decided.filter(function (d) { return d.verdict === 'approve' && d.kind !== 'bar' && d.kind !== 'dropped'; }).length;
    var bars = decided.filter(function (d) { return d.verdict === 'approve' && d.kind === 'bar'; }).length;
    var el = document.getElementById('execute');
    if (approved > 0 && deck.executeLink) {
      el.innerHTML = '<a href="' + deck.executeLink.replace(/&/g, '&amp;') + '">📱 Execute ' + approved + ' approved on phone</a><small>Opens Scriptable: the phone re-checks the live calendar, writes the approved cards plus notes-only updates, and records the run.' + (bars ? ' ' + bars + ' approved bar(s) are promoted separately (node tools/apply-bar-approvals.js).' : '') + '</small>';
    } else {
      el.innerHTML = '<span>Approve something to enable "Execute on phone"</span>' + (bars ? '<small>' + bars + ' approved bar(s) are promoted with node tools/apply-bar-approvals.js.</small>' : '');
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
      li.innerHTML = '<span class="v">' + (d.verdict === 'approve' ? '✅' : '🚫') + '</span><div class="t"><div>' + escapeHtml(d.title || d.key) + ' <span class="r">' + escapeHtml(d.kind) + (d.stampedAt ? ' · ' + escapeHtml(String(d.stampedAt).slice(0, 10)) : '') + '</span></div>' + (reason ? '<div class="r">' + escapeHtml(reason) + '</div>' : '') + executed + '</div>';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Undo';
      btn.onclick = function () { undoDecision(d); };
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }
  function render() { renderFilters(); renderStage(); renderExecute(); renderDecided(); }
  function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function postTo(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); });
  }
  function post(body) { return postTo('/review/decide', body); }
  function postBear(card, verdict) { return postTo('/review/bear', { verdict: verdict, event: card.bearIdentity || card.proposal, key: card.key }); }
  function topCard() { return visible()[0] || null; }
  function removeFromQueue(card) { queue = queue.filter(function (c) { return c.key !== card.key; }); }

  function decide(card, verdict, reason, direction) {
    var el = stage.querySelector('.card[data-key="' + CSS.escape(card.key) + '"]');
    if (el) el.className = 'card ' + direction;
    // A dropped card's swipe is a bear verdict: right = "that IS bear"
    // (rescued by the next run), left = "not bear, confirmed".
    // "Not bear" as a reject reason on a kept card records the verdict too,
    // so the next run drops the party without asking again.
    var alsoNotBear = card.kind !== 'dropped' && verdict === 'reject' && reason && (reason.tags || []).indexOf('not bear') !== -1;
    var request = card.kind === 'dropped'
      ? postBear(card, verdict === 'approve' ? 'bear' : 'not_bear')
      : post({ key: card.key, kind: card.kind, verdict: verdict, runId: deck.runId, snapshot: card.proposal, reason: reason || null })
          .then(function (result) { return alsoNotBear ? postBear(card, 'not_bear').then(function () { return result; }) : result; });
    request.then(function () {
      removeFromQueue(card);
      var record = { id: card.id, kind: card.kind, key: card.key, verdict: verdict, stampedAt: new Date().toISOString(), reason: reason || null, title: card.kind === 'bar' ? card.proposal.name : card.proposal.title, proposal: card.proposal, bearIdentity: card.bearIdentity, notBearVerdict: alsoNotBear, html: card.html };
      decided.push(record);
      history.push({ card: card, record: record });
      toast(card.kind === 'dropped' ? (verdict === 'approve' ? 'Marked bear — the next run keeps it' : 'Not bear, confirmed') : (verdict === 'approve' ? 'Approved' : (alsoNotBear ? 'Rejected — and marked not bear' : 'Rejected')));
      setTimeout(render, 180);
    }).catch(function (error) {
      toast('Not saved: ' + error.message);
      render();
    });
  }
  function approveTop() { var c = topCard(); if (c) decide(c, 'approve', null, 'gone-right'); }
  function rejectTop() {
    var c = topCard(); if (!c) return;
    if (c.kind === 'dropped') { decide(c, 'reject', null, 'gone-left'); return; }
    pending = c; openSheet(c);
  }
  function skipTop() {
    var c = topCard(); if (!c) return;
    var el = stage.querySelector('.card[data-key="' + CSS.escape(c.key) + '"]');
    if (el) el.className = 'card gone-down';
    removeFromQueue(c); queue.push(c);
    setTimeout(render, 180);
  }
  function undoDecision(record) {
    var request = record.kind === 'dropped'
      ? postBear(record, 'clear')
      : post({ key: record.key, verdict: 'clear' })
          .then(function (result) { return record.notBearVerdict ? postBear(record, 'clear').then(function () { return result; }) : result; });
    request.then(function () {
      decided = decided.filter(function (d) { return d.key !== record.key; });
      var card = { id: record.id, kind: record.kind, key: record.key, proposal: record.proposal, bearIdentity: record.bearIdentity, html: record.html };
      queue.unshift(card);
      history = history.filter(function (h) { return h.card.key !== record.key; });
      toast('Undone');
      render();
    }).catch(function (error) { toast('Undo failed: ' + error.message); });
  }
  function undoLast() { var last = history[history.length - 1]; if (last) undoDecision(last.record); }

  // Reject sheet
  var sheet = document.getElementById('sheet');
  var sheetTags = document.getElementById('sheet-tags');
  function openSheet(card) {
    document.getElementById('sheet-title').textContent = card.kind === 'bar' ? card.proposal.name : card.proposal.title;
    sheetTags.innerHTML = deck.tags.map(function (t) { return '<span class="chip" data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</span>'; }).join('');
    Array.prototype.forEach.call(sheetTags.querySelectorAll('.chip'), function (el) { el.onclick = function () { el.classList.toggle('on'); }; });
    document.getElementById('sheet-text').value = '';
    sheet.classList.add('open');
    setTimeout(function () { document.getElementById('sheet-text').focus(); }, 50);
  }
  function closeSheet() { sheet.classList.remove('open'); pending = null; render(); }
  document.getElementById('sheet-cancel').onclick = closeSheet;
  document.getElementById('sheet-reject').onclick = function () {
    if (!pending) return closeSheet();
    var tags = Array.prototype.map.call(sheetTags.querySelectorAll('.chip.on'), function (el) { return el.getAttribute('data-tag'); });
    var text = document.getElementById('sheet-text').value.trim();
    var card = pending;
    sheet.classList.remove('open'); pending = null;
    decide(card, 'reject', { tags: tags, text: text }, 'gone-left');
  };

  // Drag — touch + mouse (iOS Safari delivers pointer events but starts
  // its own scroll first, so horizontal swipes died as pointercancel).
  // Vertical intent scrolls the card body natively (touch-action: pan-y);
  // horizontal intent is claimed with preventDefault on a non-passive
  // touchmove. A touch that never moved is a tap: flyer → lightbox,
  // description → expand.
  function attachDrag(el, card) {
    var startX = 0, startY = 0, dx = 0, dy = 0, active = false, moved = false, lockedH = false, lockedV = false;
    var okStamp = el.querySelector('.stamp.ok'), noStamp = el.querySelector('.stamp.no');
    function reset() {
      el.style.transform = '';
      if (okStamp) okStamp.style.opacity = 0;
      if (noStamp) noStamp.style.opacity = 0;
    }
    function begin(x, y, target) {
      if (target && target.closest && target.closest('a, button, select, textarea, input, summary')) return false;
      active = true; moved = false; lockedH = false; lockedV = false;
      startX = x; startY = y; dx = 0; dy = 0;
      el.classList.add('dragging');
      return true;
    }
    function move(x, y, e) {
      if (!active) return;
      dx = x - startX; dy = y - startY;
      if (!lockedH && !lockedV && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        if (Math.abs(dx) > Math.abs(dy)) lockedH = true; else lockedV = true;
      }
      if (!lockedH) return;
      moved = true;
      if (e && e.cancelable) e.preventDefault();
      el.style.transform = 'translate(' + dx + 'px,' + (dy * 0.3) + 'px) rotate(' + (dx / 18) + 'deg)';
      if (okStamp) okStamp.style.opacity = Math.max(0, Math.min(1, dx / 90));
      if (noStamp) noStamp.style.opacity = Math.max(0, Math.min(1, -dx / 90));
    }
    function tap(target) {
      if (!target || !target.closest) return;
      if (target.closest('.thumb')) { openFlyer(target.closest('.thumb')); return; }
      var desc = target.closest('.desc, .desc-more');
      if (desc) { toggleDesc(el.querySelector('.desc')); }
    }
    function end(target, cancelled) {
      if (!active) return;
      active = false;
      el.classList.remove('dragging');
      if (!cancelled && lockedH && dx > 110) { approveTop(); return; }
      if (!cancelled && lockedH && dx < -110) { reset(); rejectTop(); return; }
      reset();
      if (!cancelled && !moved && !lockedV) tap(target);
    }
    el.addEventListener('touchstart', function (e) {
      var t = e.touches[0]; if (!t) return;
      begin(t.clientX, t.clientY, e.target);
    }, { passive: true });
    el.addEventListener('touchmove', function (e) {
      var t = e.touches[0]; if (!t) return;
      move(t.clientX, t.clientY, e);
    }, { passive: false });
    el.addEventListener('touchend', function (e) { end(e.target, false); });
    el.addEventListener('touchcancel', function (e) { end(e.target, true); });
    el.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (!begin(e.clientX, e.clientY, e.target)) return;
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
  document.getElementById('btn-reject').onclick = rejectTop;
  document.getElementById('btn-skip').onclick = skipTop;
  document.getElementById('btn-undo').onclick = undoLast;
  document.addEventListener('keydown', function (e) {
    var lightbox = document.getElementById('lightbox');
    if (lightbox.classList.contains('open')) { if (e.key === 'Escape') closeFlyer(); return; }
    if (sheet.classList.contains('open')) { if (e.key === 'Escape') closeSheet(); return; }
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); approveTop(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); rejectTop(); }
    else if (e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); skipTop(); }
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

  render();
})();
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
    const runs = reviewQueue.listRunFiles(sharedRoot);
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
    const deck = reviewQueue.buildDeck(run.payload, store, { runId: run.runId, core, bearVerdicts });
    const { ScriptableAdapter } = requireScriptableAdapterWithStubs();
    const cities = (run.payload && run.payload.config && run.payload.config.cities) || {};
    return { deck, ctx: { adapter: new ScriptableAdapter({ cities }), core } };
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

function sendJson(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
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
            return sendHtml(res, 200, renderReviewPage(deck, { runs, scriptName: resolveReviewScriptName(), ctx }));
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
                const cleared = reviewQueue.clearDecision(store, key);
                store = reviewQueue.saveDecisions(decisionsPath, cleared.store);
                console.log(`Review: cleared decision ${key}${cleared.removed ? '' : ' (was not stored)'}`);
                return sendJson(res, 200, { ok: true, removed: cleared.removed, decisions: store.decisions.length });
            }
            const decision = reviewQueue.buildDecision(body);
            store = reviewQueue.saveDecisions(decisionsPath, reviewQueue.upsertDecision(store, decision));
            console.log(`Review: ${decision.verdict} ${decision.kind} ${decision.key}${decision.reason ? ` — ${[decision.reason.tags.join(', '), decision.reason.text].filter(Boolean).join(' / ')}` : ''}`);
            return sendJson(res, 200, { ok: true, decision, decisions: store.decisions.length });
        } catch (error) {
            const status = /must be|needs a/.test(error.message) ? 400 : 500;
            return sendJson(res, status, { ok: false, error: error.message });
        }
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
                const cleared = reviewQueue.clearBearVerdict(current, core, body.event || {});
                reviewQueue.saveBearVerdicts(verdictsPath, cleared.verdicts);
                console.log(`Review: cleared bear verdict for "${(body.event && body.event.title) || '?'}"${cleared.removed ? '' : ' (none stored)'}`);
                return sendJson(res, 200, { ok: true, removed: cleared.removed, verdicts: cleared.verdicts.length });
            }
            const result = reviewQueue.upsertBearVerdict(current, core, body.event || {}, verdict);
            reviewQueue.saveBearVerdicts(verdictsPath, result.verdicts);
            console.log(`Review: ${verdict} — "${result.entry.title}" @ "${result.entry.venue || result.entry.city}"`);
            return sendJson(res, 200, { ok: true, entry: result.entry, verdicts: result.verdicts.length });
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

    return sendText(res, 404, 'Not found. Endpoints: / /run /run-form /log /ics/<id> /ics-batch/<id> /review /review/deck.json /review/decide /review/bear /review/decisions.json /review/rejections');
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
    formatReviewDateLine,
    formatReviewUtcLine,
    describeReviewTimeDelta,
    renderReviewChangeRows,
    renderReviewRouteLine,
    renderReviewBearRow,
    reviewUrlLabel,
    renderReviewCard,
    renderReviewPage,
    renderReviewEmptyPage,
    createServerState,
    handleRequest,
    startServer
};

if (require.main === module) {
    startServer(parsePortFromArgv(process.argv.slice(2)));
}

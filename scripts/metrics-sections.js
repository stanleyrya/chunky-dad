// ============================================================================
// METRICS SECTIONS - PURE HTML/DATA BUILDERS FOR THE METRICS DASHBOARD
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE JavaScript business logic
//
// 🚨 CRITICAL RESTRICTIONS - NEVER ADD THESE TO THIS FILE:
// ❌ NO Node-only APIs (fs, path, process)
// ❌ NO Scriptable APIs (FileManager, WebView, DrawContext) - display scripts own those
// ❌ NO DOM APIs (document, window) - this builds HTML strings only
//
// ✅ THIS FILE SHOULD ONLY CONTAIN:
// ✅ Plain functions that take metrics records / signals blocks and return
//    HTML strings or chart-ready data series
//
// Renders the "Health & Guards" dashboard section and the quality-trend chart
// series from per-run metrics records (metrics.ndjson lines, see
// buildMetricsRecord in scripts/adapters/scriptable-adapter.js). Records
// written before the `signals` block existed must render gracefully — dashes
// and notes, never NaN or a throw.
//
// Also renders the Sources dashboard (per-website verdicts, host detail,
// vanished events, widget digest) from the source ledger
// (metrics/sources.ndjson, see SharedCore.buildSourceLedger) via
// parseSourceLedger + assessSourceHealth below.
//
// Consumed by:
//   - scripts/display-run-metrics.js (Scriptable dashboard WebView)
//   - scripts/metrics-sections.test.js (headless Node tests)
//
// The run-health verdict itself lives in scripts/run-log-summary.js
// (evaluateRunHealth / formatRunHealthBadge); callers pass the computed badge
// text/status in so this module stays dependency-free.
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Human labels for the guard counters in signals.guards (see GUARD_LINE_RES in
// run-log-summary.js for the log lines each counter is derived from).
const GUARD_LABELS = [
    { key: 'brandBarRejected', label: 'Organizer/brand rejected as venue' },
    { key: 'brandTitleStripped', label: 'Page brand stripped from title' },
    { key: 'taglineRejected', label: 'Site tagline rejected as description' },
    { key: 'geocodePicked', label: 'Geocode candidate picked by distance' },
    { key: 'geocodeRejected', label: 'Geocode rejected (outside event city)' },
    { key: 'geocodeNoResults', label: 'Geocode found no results (address unresolvable)' },
    { key: 'degenerateEndCaught', label: 'Degenerate end date caught' },
    { key: 'coordsPreserved', label: 'Calendar coordinates preserved' },
    { key: 'barPreserved', label: 'Calendar venue preserved' },
    { key: 'locationPreserved', label: 'Calendar location preserved' },
    { key: 'arbitrationDeterministic', label: 'Merge conflicts resolved deterministically' },
    { key: 'mapsLinkPin', label: "Pin taken from the page's maps link (no curated/geocoded pin)" },
    { key: 'mapsLinkConflict', label: "Maps-link pin disagrees with the accepted pin (verify venue)" },
    { key: 'mapsLinkDeclined', label: "Maps-link pin declined against a name-only geocoded pin (verify venue)" }
];

const SIGNALS_PASS_ORDER = ['extraction', 'context-prep', 'repair', 'merge-arbitration', 'ocr'];

function formatMs(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '0ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function formatPercent(value, total) {
    if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 'n/a';
    return `${Math.round((value / total) * 100)}%`;
}

// The one-line run-health badge. `status` is 'ok' | 'warn'; `badgeText` is the
// preformatted plain-text badge (RunLogSummary.formatRunHealthBadge output).
function buildHealthBadgeHtml(badgeText, status) {
    const variant = status === 'warn' ? 'warn' : 'ok';
    return `<div class="health-badge ${variant}">${escapeHtml(badgeText || '')}</div>`;
}

// Guard-activity table: one row per guard that fired in this run's signals.
function buildGuardTableHtml(guards) {
    const safeGuards = guards || {};
    const rows = GUARD_LABELS
        .filter(item => (safeGuards[item.key] || 0) > 0)
        .map(item => `
            <tr>
              <td>${escapeHtml(item.label)}</td>
              <td class="num">${safeGuards[item.key]}</td>
            </tr>`)
        .join('');
    if (!rows) {
        return `<div class="muted">No guards fired in this run.</div>`;
    }
    return `
        <div class="table-wrapper">
          <table class="metrics-table">
            <thead><tr><th>Guard</th><th class="num">Fired</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
}

// Arbitration summary line: conflict count, picks split, fallback rate.
function buildArbitrationSummaryHtml(arbitration) {
    const safe = arbitration || {};
    const conflicts = safe.conflicts || 0;
    if (conflicts === 0) {
        return `<div class="muted">No merge conflicts needed arbitration.</div>`;
    }
    const parts = [
        `${conflicts} conflict${conflicts === 1 ? '' : 's'}`,
        `calendar ${safe.calendarPicks || 0} / scraped ${safe.scrapedPicks || 0}`,
        `fallbacks ${safe.fallbacks || 0} (${formatPercent(safe.fallbacks || 0, conflicts)})`
    ];
    return `<div class="signal-line">${escapeHtml(parts.join(' • '))}</div>`;
}

// AI-by-pass table (requests / avg latency per bucket) plus a totals line
// carrying the run-level failure count (failures are not tracked per pass in
// the signals schema — see buildRunSignals).
function buildAiStatsHtml(ai) {
    const safeAi = ai || {};
    const byPass = safeAi.byPass || {};
    const passes = SIGNALS_PASS_ORDER.filter(pass => byPass[pass])
        .concat(Object.keys(byPass).filter(pass => !SIGNALS_PASS_ORDER.includes(pass)));
    if ((safeAi.requests || 0) === 0 || passes.length === 0) {
        return `<div class="muted">No AI requests in this run.</div>`;
    }
    const rows = passes.map(pass => {
        const stats = byPass[pass] || {};
        const count = stats.n || 0;
        const avgMs = count > 0 ? Math.round((stats.ms || 0) / count) : 0;
        return `
            <tr>
              <td>${escapeHtml(pass)}</td>
              <td class="num">${count}</td>
              <td class="num">${escapeHtml(formatMs(avgMs))}</td>
            </tr>`;
    }).join('');
    const failures = safeAi.failures || 0;
    const totalsLine = [
        `${safeAi.requests || 0} request${(safeAi.requests || 0) === 1 ? '' : 's'}`,
        `${failures} failure${failures === 1 ? '' : 's'}`,
        `total ${formatMs(safeAi.totalMs || 0)}`
    ].join(' • ');
    return `
        <div class="table-wrapper">
          <table class="metrics-table">
            <thead><tr><th>AI pass</th><th class="num">Requests</th><th class="num">Avg</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="signal-line${failures > 0 ? ' warn-text' : ''}">${escapeHtml(totalsLine)}</div>`;
}

// Dedup/filter funnel line, e.g. "18 found → 16 future → 16 bear → 9 final (7 dupes removed)".
function buildFunnelHtml(funnel) {
    const safe = funnel || {};
    if ((safe.found || 0) === 0 && (safe.final || 0) === 0) {
        return '';
    }
    const dupes = safe.duplicatesRemoved || 0;
    const dupeNote = dupes > 0 ? ` (${dupes} dupe${dupes === 1 ? '' : 's'} removed)` : '';
    const text = `${safe.found || 0} found → ${safe.future || 0} future → ${safe.bear || 0} bear → ${safe.final || 0} final${dupeNote}`;
    return `<div class="signal-line">${escapeHtml(text)}</div>`;
}

// Full "Health & Guards" section body for one metrics record (the latest run).
// `health`/`badgeText` are precomputed by the caller via RunLogSummary so this
// module stays free of cross-module imports. Records without a signals block
// (written before metrics 2.0) render the badge plus a graceful note.
function buildHealthGuardsSectionHtml(record, health, badgeText) {
    const badge = buildHealthBadgeHtml(badgeText, health && health.status);
    const signals = record && record.signals ? record.signals : null;
    if (!signals) {
        return `${badge}<div class="muted">No signal data for this run — recorded before signals were collected.</div>`;
    }
    return `
        ${badge}
        ${buildFunnelHtml(signals.funnel)}
        <div class="signal-subtitle">Guard activity</div>
        ${buildGuardTableHtml(signals.guards)}
        <div class="signal-subtitle">Merge arbitration</div>
        ${buildArbitrationSummaryHtml(signals.arbitration)}
        <div class="signal-subtitle">AI requests</div>
        ${buildAiStatsHtml(signals.ai)}`;
}

// Chart-ready quality-trend series over the records that carry signals
// (oldest → newest, matching the dashboard's other charts). Records without
// signals are skipped, never plotted as fake zeros.
function buildQualityTrendData(records) {
    const rows = (Array.isArray(records) ? records : [])
        .filter(record => record && record.signals && typeof record.signals === 'object');
    const percentOf = (value, total) => (Number.isFinite(value) && Number.isFinite(total) && total > 0)
        ? Math.round((value / total) * 100)
        : 0;
    return {
        count: rows.length,
        venuePct: rows.map(record => {
            const quality = record.signals.quality || {};
            return percentOf(quality.withBar, quality.events);
        }),
        coordsPct: rows.map(record => {
            const quality = record.signals.quality || {};
            return percentOf(quality.withCoords, quality.events);
        }),
        durationPct: rows.map(record => {
            const quality = record.signals.quality || {};
            return percentOf(quality.withEndDuration, quality.events);
        }),
        aiTotalMs: rows.map(record => {
            const ai = record.signals.ai || {};
            return Number.isFinite(ai.totalMs) ? ai.totalMs : 0;
        })
    };
}

// ============================================================================
// SOURCE HEALTH — per-website verdicts from the source ledger
// ============================================================================
// Input: the lines of metrics/sources.ndjson (SharedCore.buildSourceLedger
// records, one per run per host). Output: one row per host, trouble first,
// each with the latest line, a rolling baseline and the series for a
// sparkline. Pure — the Scriptable dashboard and the stale-sources widget
// both read this; nothing here touches files or the DOM.
//
// Verdicts (SOURCE_VERDICT_ORDER, worst first):
//   dead     — the latest run reached nothing and the site answered errors
//   stopped  — the latest run extracted 0 where the baseline is > 0
//   shrunk   — extracted less than half the baseline (baseline ≥ 4)
//   empty    — never extracted anything in the window (no baseline either)
//   vanished — upcoming events seen last time are gone this time
//   quiet    — no line within staleAfterDays (the parser has not run)
//   ok
const SOURCE_VERDICT_ORDER = ['dead', 'stopped', 'shrunk', 'empty', 'vanished', 'quiet', 'ok'];

function parseSourceLedger(text) {
    const records = [];
    String(text || '').split('\n').forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && parsed.host) records.push(parsed);
        } catch (_) { /* a torn line never poisons the file */ }
    });
    return records;
}

function medianOf(values) {
    const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function assessSourceHealth(records, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const staleAfterDays = Number.isFinite(options.staleAfterDays) ? options.staleAfterDays : 3;
    const baselineRuns = Number.isFinite(options.baselineRuns) ? options.baselineRuns : 7;
    const byHost = new Map();
    (Array.isArray(records) ? records : []).forEach((record) => {
        if (!record || !record.host) return;
        if (!byHost.has(record.host)) byHost.set(record.host, []);
        byHost.get(record.host).push(record);
    });
    const rows = [];
    byHost.forEach((lines, host) => {
        lines.sort((a, b) => String(a.finished_at || '').localeCompare(String(b.finished_at || '')) || String(a.run_id || '').localeCompare(String(b.run_id || '')));
        const latest = lines[lines.length - 1];
        const earlier = lines.slice(0, -1).filter((line) => line.status === 'ok').slice(-baselineRuns);
        const baseline = medianOf(earlier.map((line) => Number(line.extracted) || 0));
        const latestExtracted = Number(latest.extracted) || 0;
        const vanished = Array.isArray(latest.vanished) ? latest.vanished : [];
        const ageMs = now.getTime() - new Date(latest.finished_at || 0).getTime();
        const ageDays = Number.isFinite(ageMs) ? ageMs / 86400000 : Infinity;
        let verdict = 'ok';
        let since = null;
        if (latest.status === 'dead') {
            verdict = 'dead';
        } else if (latestExtracted === 0 && baseline > 0) {
            verdict = 'stopped';
        } else if (baseline !== null && baseline >= 4 && latestExtracted < baseline / 2) {
            verdict = 'shrunk';
        } else if (latestExtracted === 0 && latest.status === 'empty') {
            verdict = 'empty';
        } else if (vanished.length > 0) {
            verdict = 'vanished';
        } else if (ageDays > staleAfterDays) {
            verdict = 'quiet';
        }
        if (verdict === 'dead' || verdict === 'stopped' || verdict === 'shrunk' || verdict === 'empty') {
            // Walk back to the first consecutive troubled line.
            for (let index = lines.length - 1; index >= 0; index -= 1) {
                const line = lines[index];
                const troubled = line.status !== 'ok' || (baseline !== null && baseline >= 4 && (Number(line.extracted) || 0) < baseline / 2);
                if (!troubled) break;
                since = line.run_id || line.finished_at || since;
            }
        }
        const parsers = Array.isArray(latest.parsers) ? latest.parsers : [];
        rows.push({
            host,
            parsers,
            verdict,
            since,
            baseline,
            latest,
            vanished,
            ageDays: Number.isFinite(ageDays) ? Math.round(ageDays * 10) / 10 : null,
            series: lines.map((line) => ({
                run_id: line.run_id,
                finished_at: line.finished_at,
                extracted: Number(line.extracted) || 0,
                events: Number(line.events) || 0,
                bear: Number(line.bear) || 0,
                upcoming: Number(line.upcoming) || 0,
                proposals: line.proposals || { new: 0, merge: 0 },
                status: line.status || 'ok',
                vanished: Array.isArray(line.vanished) ? line.vanished.length : 0,
                page_errors: Number(line.page_errors) || 0,
                duration_ms: Number(line.duration_ms) || 0
            }))
        });
    });
    rows.sort((a, b) => SOURCE_VERDICT_ORDER.indexOf(a.verdict) - SOURCE_VERDICT_ORDER.indexOf(b.verdict)
        || (Number(b.latest.extracted) || 0) - (Number(a.latest.extracted) || 0)
        || a.host.localeCompare(b.host));
    const counts = {};
    SOURCE_VERDICT_ORDER.forEach((verdict) => { counts[verdict] = 0; });
    rows.forEach((row) => { counts[row.verdict] += 1; });
    return { rows, counts, troubled: rows.filter((row) => row.verdict !== 'ok').length, hosts: rows.length };
}

// ============================================================================
// SOURCE DASHBOARD BUILDERS — HTML/data for the Sources + Host views
// ============================================================================
// Everything below renders assessSourceHealth() output. The display script
// supplies deep-link URLs and favicon URLs through `options` callbacks so this
// module never touches Scriptable, files or the DOM. Verdict colours live in
// the display's stylesheet (class verdict-<verdict>); this module only names
// the class.

const SOURCE_VERDICT_LABELS = {
    dead: 'Dead',
    stopped: 'Stopped',
    shrunk: 'Shrunk',
    empty: 'Empty',
    vanished: 'Vanished',
    quiet: 'Quiet',
    ok: 'OK'
};

const SOURCE_LEDGER_EMPTY_MESSAGE = 'No source ledger yet — every run writes it; seed history with npm run backfill-source-ledger on the Mac.';

const SOURCE_SORT_KEYS = ['verdict', 'host', 'extracted', 'bear', 'upcoming', 'age'];

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function sourceVerdictLabel(verdict) {
    return SOURCE_VERDICT_LABELS[verdict] || String(verdict || 'unknown');
}

function sourceVerdictRank(verdict) {
    const index = SOURCE_VERDICT_ORDER.indexOf(verdict);
    return index === -1 ? SOURCE_VERDICT_ORDER.length : index;
}

// Run ids are YYYYMMDD-HHMMSS in the owner's local time, so they format
// without any timezone maths; ISO finished_at is the fallback (shown in UTC).
function formatSourceRun(runId, finishedAt) {
    const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(String(runId || ''));
    if (match) {
        const month = SHORT_MONTHS[Number(match[2]) - 1] || match[2];
        return `${month} ${Number(match[3])} ${match[4]}:${match[5]}`;
    }
    const iso = String(finishedAt || '');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) {
        return `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;
    }
    return runId ? String(runId) : (iso || 'unknown');
}

function formatSourceAge(ageDays) {
    if (!Number.isFinite(ageDays)) return 'never';
    if (ageDays < 1) return 'today';
    const days = Math.floor(ageDays);
    return `${days}d ago`;
}

function formatSourceDuration(ms) {
    return formatMs(ms);
}

function sourceStatusText(status) {
    const normalized = String(status || 'ok').toLowerCase();
    return normalized || 'ok';
}

// Inline SVG sparkline (no images, no DrawContext). Flat series draw a level
// line; the newest value gets a dot. Returns '' for an empty series.
function buildSparklineSvg(values, options = {}) {
    const points = (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .map((value) => (Number.isFinite(value) ? value : 0));
    if (!points.length) return '';
    const width = Number.isFinite(options.width) ? options.width : 72;
    const height = Number.isFinite(options.height) ? options.height : 20;
    const pad = 2;
    const max = Math.max(...points, 0);
    const min = Math.min(...points, 0);
    const span = max - min || 1;
    const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
    const coords = points.map((value, index) => {
        const x = points.length > 1 ? pad + step * index : width / 2;
        const y = pad + (1 - (value - min) / span) * (height - pad * 2);
        return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    });
    const last = coords[coords.length - 1];
    const polyline = coords.length > 1
        ? `<polyline fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="${coords.map((pair) => pair.join(',')).join(' ')}"/>`
        : '';
    const title = options.title ? `<title>${escapeHtml(options.title)}</title>` : '';
    return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="none" aria-hidden="true">${title}${polyline}<circle cx="${last[0]}" cy="${last[1]}" r="1.8" fill="currentColor"/></svg>`;
}

// Re-sorts assessSourceHealth rows for a {key, direction} sort state. The
// assessment's own order (trouble first, then biggest sites) is the default
// and the tie-break for every key.
function sortSourceRows(rows, sortState) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    const key = sortState && SOURCE_SORT_KEYS.includes(sortState.key) ? sortState.key : 'verdict';
    const direction = sortState && sortState.direction === 'desc' ? -1 : 1;
    const latestNumber = (row, field) => Number(row && row.latest ? row.latest[field] : 0) || 0;
    const baseOrder = (a, b) => sourceVerdictRank(a.verdict) - sourceVerdictRank(b.verdict)
        || latestNumber(b, 'extracted') - latestNumber(a, 'extracted')
        || String(a.host || '').localeCompare(String(b.host || ''));
    list.sort((a, b) => {
        let diff = 0;
        if (key === 'verdict') diff = sourceVerdictRank(a.verdict) - sourceVerdictRank(b.verdict);
        else if (key === 'host') diff = String(a.host || '').localeCompare(String(b.host || ''));
        else if (key === 'extracted') diff = latestNumber(a, 'extracted') - latestNumber(b, 'extracted');
        else if (key === 'bear') diff = latestNumber(a, 'bear') - latestNumber(b, 'bear');
        else if (key === 'upcoming') diff = latestNumber(a, 'upcoming') - latestNumber(b, 'upcoming');
        else if (key === 'age') diff = (Number(a.ageDays) || 0) - (Number(b.ageDays) || 0);
        return diff !== 0 ? diff * direction : baseOrder(a, b);
    });
    return list;
}

function buildVerdictChipHtml(verdict, options = {}) {
    const label = options.label || sourceVerdictLabel(verdict);
    const safeVerdict = String(verdict || 'unknown').replace(/[^a-z]/g, '');
    return `<span class="verdict-chip verdict-${safeVerdict}">${escapeHtml(label)}</span>`;
}

function buildFaviconHtml(url) {
    if (!url) return '<span class="source-favicon placeholder"></span>';
    return `<img class="source-favicon" src="${escapeHtml(url)}" alt="" loading="lazy" onerror="this.remove()">`;
}

function parserLabelFor(row) {
    const parsers = Array.isArray(row && row.parsers) ? row.parsers.filter(Boolean).map(String) : [];
    if (!parsers.length) return '';
    const host = String(row.host || '').toLowerCase();
    const differs = parsers.some((name) => name.toLowerCase() !== host);
    return differs ? parsers.join(', ') : '';
}

// Counter strip for the Sources card: hosts, troubled, then one chip per
// verdict that occurs (ok included, so the healthy count is visible).
function buildSourceCountersHtml(health) {
    const counts = health && health.counts ? health.counts : {};
    const hosts = Number(health && health.hosts) || 0;
    const troubled = Number(health && health.troubled) || 0;
    const chip = (label, value, className = '') => `
        <span class="metric-chip${className ? ` ${className}` : ''}"><span class="metric-chip-label">${escapeHtml(label)}</span><span class="metric-chip-value">${escapeHtml(value)}</span></span>`;
    const verdictChips = SOURCE_VERDICT_ORDER
        .filter((verdict) => (counts[verdict] || 0) > 0)
        .map((verdict) => chip(sourceVerdictLabel(verdict), counts[verdict], `verdict-${verdict}`))
        .join('');
    return `
        <div class="source-counters">
          ${chip('Hosts', hosts)}
          ${chip('Troubled', troubled, troubled > 0 ? 'danger' : '')}
          ${verdictChips}
        </div>`;
}

function buildSourceSortHeader(label, key, sortState, defaultDirection, extraClass = '') {
    const isActive = sortState && sortState.key === key;
    const direction = isActive && sortState.direction === 'asc' ? 'asc' : (isActive ? 'desc' : defaultDirection);
    const nextDirection = isActive ? (direction === 'asc' ? 'desc' : 'asc') : defaultDirection;
    const arrow = isActive ? (direction === 'asc' ? '▲' : '▼') : '';
    const classes = ['sortable', extraClass].filter(Boolean).join(' ');
    return `
                <th class="${classes}">
                  <button class="sort-button${isActive ? ' active' : ''}" type="button" data-sort-view="sources" data-sort-key="${key}" data-sort-dir="${nextDirection}" data-sort-default-dir="${defaultDirection}" data-sort-label="${escapeHtml(label)}">
                    <span class="sort-label">${escapeHtml(label)}</span>
                    <span class="sort-arrow">${arrow}</span>
                  </button>
                </th>`;
}

// The Sources table: one row per host (trouble first unless sortState says
// otherwise). options.hostUrl(row) → deep link, options.faviconUrl(row) → icon.
// The latest extracted · bear · upcoming share one cell so the table fits a
// phone; bear/upcoming stay sortable through the sort state (data attributes).
function buildSourcesTableHtml(health, options = {}) {
    const rows = sortSourceRows(health && health.rows, options.sortState);
    if (!rows.length) {
        return `<div class="muted">${escapeHtml(SOURCE_LEDGER_EMPTY_MESSAGE)}</div>`;
    }
    const hostUrl = typeof options.hostUrl === 'function' ? options.hostUrl : () => '#';
    const faviconUrl = typeof options.faviconUrl === 'function' ? options.faviconUrl : () => null;
    const body = rows.map((row) => {
        const latest = row.latest || {};
        const extracted = Number(latest.extracted) || 0;
        const bear = Number(latest.bear) || 0;
        const upcoming = Number(latest.upcoming) || 0;
        const ageDays = Number.isFinite(row.ageDays) ? row.ageDays : null;
        const parserLabel = parserLabelFor(row);
        const sinceLabel = row.since ? `since ${formatSourceRun(row.since)}` : '';
        const vanishedLabel = row.verdict === 'vanished' && Array.isArray(row.vanished) && row.vanished.length
            ? `${row.vanished.length} gone`
            : '';
        const verdictNote = sinceLabel || vanishedLabel;
        const series = Array.isArray(row.series) ? row.series.map((line) => line.extracted) : [];
        const rowAttrs = [
            `data-source-host="${escapeHtml(row.host)}"`,
            `data-source-verdict="${escapeHtml(row.verdict)}"`,
            `data-source-verdict-rank="${sourceVerdictRank(row.verdict)}"`,
            `data-source-extracted="${extracted}"`,
            `data-source-bear="${bear}"`,
            `data-source-upcoming="${upcoming}"`,
            `data-source-age="${ageDays === null ? '' : ageDays}"`
        ].join(' ');
        return `
          <tr data-row="source" ${rowAttrs}>
            <td>
              <div class="cell-title source-site">
                ${buildFaviconHtml(faviconUrl(row))}
                <a class="row-link" href="${escapeHtml(hostUrl(row))}" data-nav-view="host" data-nav-key="${escapeHtml(row.host)}">${escapeHtml(row.host)}</a>
              </div>
              ${parserLabel ? `<div class="cell-subtitle">${escapeHtml(parserLabel)}</div>` : ''}
            </td>
            <td class="verdict-cell">
              ${buildVerdictChipHtml(row.verdict)}
              ${verdictNote ? `<div class="cell-subtitle">${escapeHtml(verdictNote)}</div>` : ''}
            </td>
            <td class="num trio-cell"><div class="cell-title">${extracted} · ${bear} · ${upcoming}</div></td>
            <td class="trend-cell">${buildSparklineSvg(series, { title: `${series.length} runs` })}</td>
            <td class="age-cell"><div class="cell-subtitle">${escapeHtml(formatSourceAge(ageDays))}</div></td>
          </tr>`;
    }).join('');
    return `
        <div class="table-wrapper">
          <table class="metrics-table list-table sources-table">
            <thead>
              <tr>
                ${buildSourceSortHeader('Site', 'host', options.sortState, 'asc')}
                ${buildSourceSortHeader('Verdict', 'verdict', options.sortState, 'asc', 'verdict-cell')}
                ${buildSourceSortHeader('Extr · Bear · Up', 'extracted', options.sortState, 'desc', 'num trio-cell')}
                <th class="trend-cell">Trend</th>
                ${buildSourceSortHeader('Seen', 'age', options.sortState, 'desc', 'age-cell')}
              </tr>
            </thead>
            <tbody data-list="sources">${body}
            </tbody>
          </table>
        </div>`;
}

// Host detail header: identity line (favicon, host, parsers, verdict, since)
// plus the latest line's numbers as a metrics grid.
function buildHostSummaryHtml(row, options = {}) {
    if (!row || !row.host) {
        return '<div class="muted">No ledger lines for this host yet.</div>';
    }
    const latest = row.latest || {};
    const faviconUrl = typeof options.faviconUrl === 'function' ? options.faviconUrl(row) : null;
    const parserLabel = parserLabelFor(row);
    const metaParts = [
        `Latest ${formatSourceRun(latest.run_id, latest.finished_at)} (${formatSourceAge(row.ageDays)})`,
        latest.environment ? String(latest.environment) : null,
        latest.trigger ? String(latest.trigger) : null,
        row.baseline !== null && row.baseline !== undefined ? `baseline ${row.baseline}` : 'no baseline yet',
        row.since ? `trouble since ${formatSourceRun(row.since)}` : null,
        `${Array.isArray(row.series) ? row.series.length : 0} runs on record`
    ].filter(Boolean);
    const proposals = latest.proposals || {};
    const metric = (label, value, sub = null) => `
          <div class="metric">
            <div class="metric-value">${escapeHtml(value)}${sub ? `<span class="metric-subvalue">${escapeHtml(sub)}</span>` : ''}</div>
            <div class="metric-label">${escapeHtml(label)}</div>
          </div>`;
    return `
        <div class="host-head">
          ${buildFaviconHtml(faviconUrl)}
          <div class="host-head-text">
            <div class="host-name">${escapeHtml(row.host)}</div>
            ${parserLabel ? `<div class="cell-subtitle">${escapeHtml(parserLabel)}</div>` : ''}
          </div>
          ${buildVerdictChipHtml(row.verdict)}
        </div>
        <div class="muted host-meta">${escapeHtml(metaParts.join(' • '))}</div>
        <div class="metrics-grid">
          ${metric('Extracted', Number(latest.extracted) || 0)}
          ${metric('Bear', Number(latest.bear) || 0, `${Number(latest.events) || 0} kept`)}
          ${metric('Upcoming', Number(latest.upcoming) || 0)}
          ${metric('Proposals', `${Number(proposals.new) || 0} new / ${Number(proposals.merge) || 0} merge`)}
          ${metric('Pages', `${Number(latest.pages) || 0}`, `${Number(latest.page_errors) || 0} errors • ${Number(latest.outbound_pages) || 0} outbound`)}
          ${metric('Duration', formatSourceDuration(Number(latest.duration_ms) || 0))}
        </div>`;
}

// The host's run-by-run table, newest first. options.records (the parsed
// ledger) adds the environment column; options.limit caps the rows shown.
function buildHostSeriesTableHtml(row, options = {}) {
    const series = row && Array.isArray(row.series) ? row.series.slice() : [];
    if (!series.length) {
        return '<div class="muted">No runs recorded for this host.</div>';
    }
    const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : series.length;
    // Series rows carry no environment; the raw ledger records (options.records)
    // supply it per host + run_id.
    const envByRun = new Map();
    (Array.isArray(options.records) ? options.records : []).forEach((record) => {
        if (record && record.host === row.host && record.run_id) envByRun.set(record.run_id, record.environment || '');
    });
    const shown = series.slice().reverse().slice(0, limit);
    const rows = shown.map((line) => {
        const proposals = line.proposals || {};
        const status = sourceStatusText(line.status);
        const environment = envByRun.get(line.run_id) || '';
        // One line per row: 49 hosts × dozens of runs is the bulk of the page.
        return `<tr><td><div class="cell-title">${escapeHtml(formatSourceRun(line.run_id, line.finished_at))}</div></td>`
            + `<td><div class="cell-subtitle">${escapeHtml(environment || '—')}</div></td>`
            + `<td class="num tight">${Number(line.extracted) || 0}</td>`
            + `<td class="num tight">${Number(line.bear) || 0}</td>`
            + `<td class="num tight">${Number(line.upcoming) || 0}</td>`
            + `<td class="num tight">${Number(proposals.new) || 0}</td>`
            + `<td class="num tight">${Number(proposals.merge) || 0}</td>`
            + `<td class="status-text source-status-${escapeHtml(status)}">${escapeHtml(status)}</td>`
            + `<td class="num tight">${Number(line.vanished) || 0}</td>`
            + `<td class="num tight">${Number(line.page_errors) || 0}</td>`
            + `<td class="num">${escapeHtml(formatSourceDuration(Number(line.duration_ms) || 0))}</td></tr>`;
    }).join('\n');
    const footer = series.length > shown.length
        ? `<div class="table-footer">+${series.length - shown.length} older runs not shown</div>`
        : '';
    return `
        <div class="table-wrapper">
          <table class="metrics-table list-table host-series-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Env</th>
                <th class="num tight">Extr</th>
                <th class="num tight">Bear</th>
                <th class="num tight">Up</th>
                <th class="num tight">New</th>
                <th class="num tight">Mrg</th>
                <th>Status</th>
                <th class="num tight">Van</th>
                <th class="num tight">Err</th>
                <th class="num">Dur</th>
              </tr>
            </thead>
            <tbody>${rows}
            </tbody>
          </table>
        </div>${footer}`;
}

// The latest line's error strings (the ledger keeps at most three).
function buildHostErrorsHtml(row) {
    const errors = row && row.latest && Array.isArray(row.latest.errors)
        ? row.latest.errors.filter(Boolean).slice(0, 3)
        : [];
    if (!errors.length) {
        return '<div class="muted">No errors in the latest run.</div>';
    }
    return `
        <ul class="source-errors">
          ${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}
        </ul>`;
}

// Upcoming events that were seen last run and are gone now (latest line).
function buildVanishedListHtml(row) {
    const vanished = row && Array.isArray(row.vanished) ? row.vanished : [];
    if (!vanished.length) {
        return '<div class="muted">No upcoming events vanished in the latest run.</div>';
    }
    const rows = vanished.map((item) => `
          <tr>
            <td><div class="cell-title">${escapeHtml(item.title || item.key || 'Untitled')}</div></td>
            <td><div class="cell-subtitle">${escapeHtml(item.day || '—')}</div></td>
            <td class="status-cell">${item.bear ? '🐻' : ''}</td>
            <td><div class="cell-subtitle">${escapeHtml(item.last_seen ? formatSourceRun(item.last_seen) : '—')}</div></td>
          </tr>`).join('');
    return `
        <div class="table-wrapper">
          <table class="metrics-table list-table vanished-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Day</th>
                <th class="status-cell">Bear</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>${rows}
            </tbody>
          </table>
        </div>`;
}

// Widget-ready digest: headline, the top troubled hosts, and the newest run
// stamp (the display formats it relative to now).
function buildSourceWidgetSummary(health, options = {}) {
    const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : 3;
    const rows = health && Array.isArray(health.rows) ? health.rows : [];
    const hosts = rows.length;
    const troubledRows = rows.filter((row) => row.verdict !== 'ok');
    const troubled = troubledRows.length;
    const newest = rows.reduce((latest, row) => {
        const stamp = row.latest && row.latest.finished_at ? String(row.latest.finished_at) : '';
        return stamp > latest ? stamp : latest;
    }, '');
    const siteWord = hosts === 1 ? 'site' : 'sites';
    let headline;
    if (hosts === 0) headline = 'No sources yet';
    else if (troubled > 0) headline = `${troubled} of ${hosts} ${siteWord} need${troubled === 1 ? 's' : ''} a look`;
    else headline = `All ${hosts} ${siteWord} ok`;
    const items = troubledRows.slice(0, limit).map((row) => ({
        host: row.host,
        parsers: Array.isArray(row.parsers) ? row.parsers : [],
        verdict: row.verdict,
        label: sourceVerdictLabel(row.verdict),
        since: row.since || null,
        sinceLabel: row.since ? formatSourceRun(row.since) : null,
        extracted: Number(row.latest && row.latest.extracted) || 0,
        bear: Number(row.latest && row.latest.bear) || 0,
        upcoming: Number(row.latest && row.latest.upcoming) || 0,
        vanished: Array.isArray(row.vanished) ? row.vanished.length : 0
    }));
    return {
        hosts,
        troubled,
        headline,
        items,
        more: Math.max(0, troubled - items.length),
        newestFinishedAt: newest || null
    };
}

// ============================================================================
// CHARTS — SVG renderer, Chart.js config builder and chart specs
// ============================================================================
// Every dashboard chart is a plain "spec" (labels, dates, series, baseline,
// shade) built from assessSourceHealth rows or metrics records. One renderer
// turns a spec into inline SVG (works offline, no scripts) or a Chart.js config
// (the page upgrades to canvas when the CDN script loads).
//
// createChartRenderer() is deliberately self-contained — it closes over
// nothing in this module — so the display script can embed its source text in
// the page (`(${createChartRenderer.toString()})()`) and re-render a chart
// client-side for the 7 / 30 / all range toggle with the very same code the
// tests cover here. Keep it that way: no references to module-level helpers.
//
// Spec shape:
//   { id, kind: 'area'|'lines'|'stack'|'bars'|'diverging', unit, yMax,
//     height, labels: [run_id…], dates: [ISO…], series: [{ key, label,
//     color: {slot} | {hex}, values: [n…], role: 'area'|'line'|'bar'|'dots',
//     down }], baseline: {value, label} | null, shade: {fromLabel, hex, label} | null }
//
// Colours: {slot: n} picks the n-th categorical slot of the palette for the
// page's colour scheme (both palettes validated for CVD separation, lightness
// band and contrast — see the dataviz validator); {hex} is a literal (verdict
// colours, neutral "other"). Series keep their colour across range changes.

function createChartRenderer() {
    const PALETTE = {
        light: ['#5b6ee1', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#8b5cf6', '#e34948'],
        dark: ['#667eea', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
    };
    const THEME = {
        light: { surface: '#ffffff', grid: 'rgba(31, 37, 68, 0.1)', axis: '#5a637a', ink: '#1f2544', neutral: '#a7b0cc' },
        dark: { surface: '#1b1c2b', grid: 'rgba(241, 242, 255, 0.12)', axis: '#c1c6e2', ink: '#f1f2ff', neutral: '#6f7799' }
    };
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const WIDTH = 360;
    const PAD = { left: 36, right: 12, top: 12, bottom: 20 };
    const DAY_MS = 86400000;

    const esc = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
    const round = (value) => Math.round(value * 10) / 10;
    const themeFor = (mode) => (mode === 'dark' ? THEME.dark : THEME.light);
    const resolveColor = (color, mode) => {
        const palette = mode === 'dark' ? PALETTE.dark : PALETTE.light;
        if (color && typeof color === 'object') {
            if (color.hex) return String(color.hex);
            if (Number.isFinite(color.slot)) return palette[((color.slot % palette.length) + palette.length) % palette.length];
        }
        if (typeof color === 'string' && color) return color;
        return palette[0];
    };
    const withAlpha = (hex, alpha) => {
        const clean = String(hex || '').replace('#', '');
        if (!/^[0-9a-fA-F]{6}$/.test(clean)) return hex;
        const r = parseInt(clean.slice(0, 2), 16);
        const g = parseInt(clean.slice(2, 4), 16);
        const b = parseInt(clean.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };
    // Run ids are YYYYMMDD-HHMMSS in local time; ISO dates are the fallback.
    const dateParts = (label, iso) => {
        const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(String(label || ''));
        if (match) return { month: Number(match[2]), day: Number(match[3]), time: `${match[4]}:${match[5]}` };
        const isoMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || ''));
        if (isoMatch) return { month: Number(isoMatch[2]), day: Number(isoMatch[3]), time: `${isoMatch[4]}:${isoMatch[5]}Z` };
        return null;
    };
    const shortDate = (label, iso) => {
        const parts = dateParts(label, iso);
        return parts ? `${MONTHS[parts.month - 1] || parts.month} ${parts.day}` : String(label || '');
    };
    const longDate = (label, iso) => {
        const parts = dateParts(label, iso);
        return parts ? `${MONTHS[parts.month - 1] || parts.month} ${parts.day} ${parts.time}` : String(label || '');
    };
    const formatValue = (value, unit) => {
        const safe = num(value);
        const text = Number.isInteger(safe) ? String(safe) : safe.toFixed(1);
        return unit === '%' ? `${text}%` : (unit ? `${text}${unit}` : text);
    };
    const niceMax = (value) => {
        if (!(value > 0)) return 4;
        if (value < 4) return value <= 1 ? 1 : (value <= 2 ? 2 : 4);
        const exponent = Math.floor(Math.log10(value));
        const base = Math.pow(10, exponent);
        const fraction = value / base;
        const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
        return step * base;
    };

    const seriesOf = (spec) => (Array.isArray(spec && spec.series) ? spec.series : []);
    const countOf = (spec) => (Array.isArray(spec && spec.labels) ? spec.labels.length : 0);

    // Keep only the runs within the last `days` of the newest run (the data,
    // not the clock, anchors the window). 'all' or a non-number keeps everything.
    function sliceChartSpec(spec, range) {
        const days = Number(range);
        const labels = Array.isArray(spec && spec.labels) ? spec.labels : [];
        if (!spec || !(days > 0) || labels.length < 2) return spec;
        const dates = Array.isArray(spec.dates) ? spec.dates : [];
        const times = labels.map((label, index) => {
            const stamp = Date.parse(dates[index] || '');
            if (Number.isFinite(stamp)) return stamp;
            const parts = /^(\d{4})(\d{2})(\d{2})/.exec(String(label || ''));
            return parts ? Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : null;
        });
        const newest = times.reduce((best, time) => (Number.isFinite(time) && time > best ? time : best), -Infinity);
        if (!Number.isFinite(newest)) return spec;
        const cutoff = newest - days * DAY_MS;
        let keep = labels.map((_, index) => index).filter((index) => Number.isFinite(times[index]) && times[index] >= cutoff);
        if (keep.length < 2) keep = labels.map((_, index) => index).slice(-2);
        const pick = (list) => (Array.isArray(list) ? keep.map((index) => list[index]) : list);
        return Object.assign({}, spec, {
            labels: pick(labels),
            dates: pick(dates),
            series: seriesOf(spec).map((item) => Object.assign({}, item, { values: pick(item.values) }))
        });
    }

    function shadeIndex(spec) {
        if (!spec || !spec.shade || !spec.shade.fromLabel) return -1;
        const index = (spec.labels || []).indexOf(spec.shade.fromLabel);
        if (index >= 0) return index;
        // The trouble began before the visible window: shade everything.
        const first = String((spec.labels || [])[0] || '');
        return first && String(spec.shade.fromLabel) < first ? 0 : -1;
    }

    // Layout shared by the SVG renderer and the hit targets.
    function layout(spec) {
        const height = Number.isFinite(spec && spec.height) ? spec.height : 170;
        const count = countOf(spec);
        const plotWidth = WIDTH - PAD.left - PAD.right;
        const plotHeight = height - PAD.top - PAD.bottom;
        const kind = spec && spec.kind ? spec.kind : 'area';
        const series = seriesOf(spec);
        let top = 0;
        if (kind === 'stack' || kind === 'bars') {
            for (let index = 0; index < count; index += 1) {
                top = Math.max(top, series.reduce((sum, item) => sum + Math.max(0, num((item.values || [])[index])), 0));
            }
        } else {
            series.forEach((item) => (item.values || []).forEach((value) => { top = Math.max(top, Math.abs(num(value))); }));
        }
        if (spec && spec.baseline && Number.isFinite(Number(spec.baseline.value))) top = Math.max(top, Number(spec.baseline.value));
        const max = Number.isFinite(spec && spec.yMax) ? spec.yMax : niceMax(top);
        const diverging = kind === 'diverging';
        const zeroY = diverging ? PAD.top + plotHeight / 2 : PAD.top + plotHeight;
        const unitHeight = diverging ? (plotHeight / 2) / max : plotHeight / max;
        const band = count > 0 ? plotWidth / count : plotWidth;
        const bars = kind === 'bars' || kind === 'diverging';
        const xAt = (index) => {
            if (bars) return PAD.left + band * (index + 0.5);
            if (count <= 1) return PAD.left + plotWidth / 2;
            return PAD.left + (plotWidth * index) / (count - 1);
        };
        const yAt = (value) => zeroY - num(value) * unitHeight;
        return { width: WIDTH, height, plotWidth, plotHeight, count, max, zeroY, band, bars, diverging, xAt, yAt };
    }

    function tickIndices(count) {
        if (count <= 4) return Array.from({ length: count }, (_, index) => index);
        return [0, Math.round((count - 1) / 3), Math.round(((count - 1) * 2) / 3), count - 1];
    }

    function smoothPath(points) {
        if (points.length < 2) return '';
        let path = `M${points[0][0]},${points[0][1]}`;
        for (let index = 1; index < points.length; index += 1) {
            const [x0, y0] = points[index - 1];
            const [x1, y1] = points[index];
            const cx = round((x0 + x1) / 2);
            path += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
        }
        return path;
    }

    // Inline SVG for a spec. `options.mode` picks the palette/theme.
    function buildChartSvg(spec, options = {}) {
        const mode = options.mode === 'dark' ? 'dark' : 'light';
        const theme = themeFor(mode);
        const series = seriesOf(spec);
        const count = countOf(spec);
        if (!spec || count === 0 || series.length === 0) return '';
        const geo = layout(spec);
        const id = String(spec.id || 'chart').replace(/[^a-zA-Z0-9_-]/g, '-');
        const unit = spec.unit || '';
        const parts = [];
        const defs = [];

        // Troubled stretch first so everything draws over it.
        const shadeFrom = shadeIndex(spec);
        if (shadeFrom >= 0 && spec.shade) {
            const left = geo.bars ? PAD.left + geo.band * shadeFrom : (shadeFrom > 0 ? (geo.xAt(shadeFrom - 1) + geo.xAt(shadeFrom)) / 2 : geo.xAt(shadeFrom));
            const right = PAD.left + geo.plotWidth;
            parts.push(`<rect class="chart-shade" x="${round(left)}" y="${PAD.top}" width="${round(Math.max(2, right - left))}" height="${round(geo.plotHeight)}" fill="${esc(spec.shade.hex || theme.neutral)}" fill-opacity="0.12"/>`);
        }

        // Gridlines: four or five solid hairlines (whichever makes the ticks
        // whole numbers) plus the zero/base rule.
        const gridSteps = Number.isInteger(geo.max / 4) ? 4 : (Number.isInteger(geo.max / 5) ? 5 : (geo.max < 4 && Number.isInteger(geo.max) ? geo.max : 4));
        for (let step = 1; step <= gridSteps; step += 1) {
            const value = (geo.max * step) / gridSteps;
            const y = round(geo.yAt(value));
            parts.push(`<line class="chart-grid" x1="${PAD.left}" x2="${PAD.left + geo.plotWidth}" y1="${y}" y2="${y}" stroke="${theme.grid}" stroke-width="1"/>`);
            parts.push(`<text class="chart-tick" x="${PAD.left - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="${theme.axis}">${esc(formatValue(value, unit))}</text>`);
            if (geo.diverging) {
                const yDown = round(geo.yAt(-value));
                parts.push(`<line class="chart-grid" x1="${PAD.left}" x2="${PAD.left + geo.plotWidth}" y1="${yDown}" y2="${yDown}" stroke="${theme.grid}" stroke-width="1"/>`);
                parts.push(`<text class="chart-tick" x="${PAD.left - 6}" y="${yDown + 3}" text-anchor="end" font-size="9" fill="${theme.axis}">${esc(formatValue(value, unit))}</text>`);
            }
        }
        parts.push(`<line class="chart-zero" x1="${PAD.left}" x2="${PAD.left + geo.plotWidth}" y1="${round(geo.zeroY)}" y2="${round(geo.zeroY)}" stroke="${theme.axis}" stroke-opacity="0.5" stroke-width="1"/>`);

        if (geo.bars) {
            const barWidth = Math.max(2, Math.min(18, geo.band * 0.62));
            const stackTop = new Array(count).fill(0);
            series.forEach((item, seriesIndex) => {
                if (item.role === 'dots') return;
                const color = resolveColor(item.color, mode);
                for (let index = 0; index < count; index += 1) {
                    const value = num((item.values || [])[index]);
                    if (value === 0) continue;
                    const x = round(geo.xAt(index) - barWidth / 2);
                    let yTop;
                    let height;
                    if (geo.diverging) {
                        const signed = item.down ? -Math.abs(value) : Math.abs(value);
                        yTop = Math.min(geo.yAt(signed), geo.zeroY);
                        height = Math.abs(geo.yAt(signed) - geo.zeroY);
                    } else {
                        const base = stackTop[index];
                        yTop = geo.yAt(base + value);
                        height = geo.yAt(base) - yTop;
                        stackTop[index] = base + value;
                        if (seriesIndex > 0 && height > 4) { height -= 2; }
                    }
                    const radius = Math.min(3, height / 2);
                    parts.push(`<rect class="chart-bar" data-series="${seriesIndex}" data-index="${index}" x="${x}" y="${round(yTop)}" width="${round(barWidth)}" height="${round(Math.max(1, height))}" rx="${round(radius)}" fill="${esc(color)}"${index === count - 1 ? '' : ' fill-opacity="0.85"'}/>`);
                }
            });
        }

        const stackBase = new Array(count).fill(0);
        const lastPoints = [];
        series.forEach((item, seriesIndex) => {
            if (item.role === 'bar') return;
            const color = resolveColor(item.color, mode);
            const values = item.values || [];
            if (item.role === 'dots') {
                for (let index = 0; index < count; index += 1) {
                    const value = num(values[index]);
                    if (value <= 0) continue;
                    const x = round(geo.xAt(index));
                    const y = round(geo.yAt(geo.diverging ? value : value));
                    parts.push(`<circle class="chart-dot" data-series="${seriesIndex}" data-index="${index}" cx="${x}" cy="${y}" r="4" fill="${esc(color)}" stroke="${theme.surface}" stroke-width="2"/>`);
                    parts.push(`<text class="chart-dot-label" x="${x}" y="${y - 7}" text-anchor="middle" font-size="9" font-weight="600" fill="${theme.ink}">${esc(formatValue(value, ''))}</text>`);
                }
                return;
            }
            const stacked = spec.kind === 'stack';
            const points = [];
            const bottoms = [];
            for (let index = 0; index < count; index += 1) {
                const value = Math.max(0, num(values[index]));
                const base = stacked ? stackBase[index] : 0;
                points.push([round(geo.xAt(index)), round(geo.yAt(base + value))]);
                bottoms.push([round(geo.xAt(index)), round(geo.yAt(base))]);
                if (stacked) stackBase[index] = base + value;
            }
            const line = count > 1 ? smoothPath(points) : '';
            if (item.role !== 'line' && count > 1) {
                const gradientId = `g-${id}-${seriesIndex}`;
                defs.push(`<linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${esc(color)}" stop-opacity="${stacked ? 0.55 : 0.32}"/><stop offset="1" stop-color="${esc(color)}" stop-opacity="${stacked ? 0.25 : 0.03}"/></linearGradient>`);
                const back = stacked ? smoothPath(bottoms.slice().reverse()).replace(/^M/, 'L') : `L${points[count - 1][0]},${round(geo.zeroY)} L${points[0][0]},${round(geo.zeroY)}`;
                parts.push(`<path class="chart-area" data-series="${seriesIndex}" d="${line} ${back} Z" fill="url(#${gradientId})"/>`);
            }
            if (line) parts.push(`<path class="chart-line" data-series="${seriesIndex}" d="${line}" fill="none" stroke="${esc(color)}" stroke-width="${stacked ? 1.25 : 2}" stroke-linejoin="round" stroke-linecap="round"/>`);
            if (!stacked) lastPoints.push({ x: points[count - 1][0], y: points[count - 1][1], color });
        });

        // Baseline as a dashed reference rule (a threshold, not a gridline).
        if (spec.baseline && Number.isFinite(Number(spec.baseline.value))) {
            const y = round(geo.yAt(Number(spec.baseline.value)));
            parts.push(`<line class="chart-baseline" x1="${PAD.left}" x2="${PAD.left + geo.plotWidth}" y1="${y}" y2="${y}" stroke="${theme.axis}" stroke-width="1" stroke-dasharray="4 3"/>`);
            parts.push(`<text class="chart-baseline-label" x="${PAD.left + geo.plotWidth}" y="${y - 3}" text-anchor="end" font-size="9" fill="${theme.axis}">${esc(spec.baseline.label || 'baseline')} ${esc(formatValue(spec.baseline.value, unit))}</text>`);
        }

        // Emphasised newest point: a ring in the surface colour, then the dot.
        lastPoints.forEach((point) => {
            parts.push(`<circle class="chart-last" cx="${point.x}" cy="${point.y}" r="3.5" fill="${esc(point.color)}" stroke="${theme.surface}" stroke-width="2"/>`);
        });

        // Date axis.
        tickIndices(count).forEach((index, position, list) => {
            const anchor = position === 0 ? 'start' : (position === list.length - 1 ? 'end' : 'middle');
            const x = round(geo.xAt(index));
            parts.push(`<text class="chart-tick" x="${x}" y="${geo.height - 6}" text-anchor="${anchor}" font-size="9" fill="${theme.axis}">${esc(shortDate(spec.labels[index], (spec.dates || [])[index]))}</text>`);
        });

        // Cursor + one hit target over the plot for the tap-to-caption
        // behaviour; the page maps a tap to the nearest run with indexAtX().
        parts.push(`<line class="chart-cursor" data-chart-cursor x1="0" x2="0" y1="${PAD.top}" y2="${PAD.top + geo.plotHeight}" stroke="${theme.axis}" stroke-width="1" stroke-opacity="0"/>`);
        parts.push(`<rect class="chart-hit" data-chart-hit x="${PAD.left}" y="${PAD.top}" width="${round(geo.plotWidth)}" height="${round(geo.plotHeight)}" fill="transparent"/>`);

        const title = spec.title ? `<title>${esc(spec.title)}</title>` : '';
        return `<svg class="chart-svg" viewBox="0 0 ${geo.width} ${geo.height}" width="100%" role="img" aria-label="${esc(spec.title || 'chart')}" data-count="${count}" style="font-family: inherit; font-variant-numeric: tabular-nums;">${title}${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${parts.join('')}</svg>`;
    }

    // Tap geometry for the page: which run sits under viewBox x, and where a
    // run's cursor line goes.
    function indexAtX(spec, x) {
        const geo = layout(spec);
        if (geo.count === 0) return -1;
        let index;
        if (geo.bars) index = Math.floor((x - PAD.left) / geo.band);
        else if (geo.count === 1) index = 0;
        else index = Math.round(((x - PAD.left) / geo.plotWidth) * (geo.count - 1));
        return Math.max(0, Math.min(geo.count - 1, index));
    }
    function xForIndex(spec, index) {
        const geo = layout(spec);
        return round(geo.xAt(Math.max(0, Math.min(Math.max(0, geo.count - 1), index))));
    }

    // One line of numbers for the run at `index` (the tap caption).
    function describeIndex(spec, index) {
        const count = countOf(spec);
        if (!spec || count === 0) return '';
        const safeIndex = Number.isFinite(index) && index >= 0 && index < count ? index : count - 1;
        const unit = spec.unit || '';
        const values = seriesOf(spec).map((item) => `${item.label} ${formatValue((item.values || [])[safeIndex], unit)}`);
        return `${longDate(spec.labels[safeIndex], (spec.dates || [])[safeIndex])} · ${values.join(' · ')}`;
    }

    // Legend chips: colour swatch + label + the newest value (tabular).
    function buildLegendHtml(spec, options = {}) {
        const mode = options.mode === 'dark' ? 'dark' : 'light';
        const series = seriesOf(spec);
        const count = countOf(spec);
        if (series.length < 2) return '';
        const unit = spec.unit || '';
        return `<div class="chart-legend">${series.map((item, seriesIndex) => {
            const color = resolveColor(item.color, mode);
            const latest = count ? formatValue((item.values || [])[count - 1], unit) : '';
            const shape = item.role === 'bar' || item.role === 'dots' ? 'chart-swatch square' : 'chart-swatch';
            return `<span class="chart-legend-item" data-series="${seriesIndex}"><span class="${shape}" style="background:${esc(color)}"></span><span class="chart-legend-label">${esc(item.label)}</span><span class="chart-legend-value">${esc(latest)}</span></span>`;
        }).join('')}</div>`;
    }

    // Chart.js (v4) config for the same spec. Callbacks cannot ride in JSON, so
    // `config.chunky` carries what the page's upgrader wires up (tooltips,
    // gradient fills, the shaded stretch).
    function buildChartJsConfig(spec, options = {}) {
        const mode = options.mode === 'dark' ? 'dark' : 'light';
        const theme = themeFor(mode);
        const series = seriesOf(spec);
        const count = countOf(spec);
        const kind = spec && spec.kind ? spec.kind : 'area';
        const bars = kind === 'bars' || kind === 'diverging';
        const stacked = kind === 'stack' || kind === 'bars';
        const labels = (spec.labels || []).map((label, index) => shortDate(label, (spec.dates || [])[index]));
        const datasets = series.map((item, seriesIndex) => {
            const color = resolveColor(item.color, mode);
            const values = (item.values || []).map((value) => num(value));
            if (item.role === 'dots') {
                return {
                    type: 'line', label: item.label, data: values.map((value) => (value > 0 ? value : null)), showLine: false,
                    borderColor: color, backgroundColor: color, pointRadius: 5, pointHoverRadius: 7, pointBorderColor: theme.surface, pointBorderWidth: 2, order: 0
                };
            }
            if (item.role === 'bar' || bars) {
                return {
                    type: 'bar', label: item.label, data: item.down ? values.map((value) => -Math.abs(value)) : values,
                    backgroundColor: withAlpha(color, 0.85), borderColor: color, borderWidth: 0, borderRadius: 4, borderSkipped: false,
                    barPercentage: 0.62, categoryPercentage: 1, stack: kind === 'diverging' ? 'diverging' : 'stack', order: 2
                };
            }
            const fill = item.role === 'line' ? false : (stacked && seriesIndex > 0 ? '-1' : 'origin');
            return {
                type: 'line', label: item.label, data: values, borderColor: color, backgroundColor: withAlpha(color, stacked ? 0.45 : 0.18),
                fill, tension: 0.35, borderWidth: stacked ? 1.25 : 2, pointRadius: values.map((_, index) => (index === count - 1 ? 3.5 : 0)),
                pointHoverRadius: 5, pointBackgroundColor: color, pointBorderColor: theme.surface, pointBorderWidth: 2, order: 1, chunkyGradient: fill !== false
            };
        });
        if (spec.baseline && Number.isFinite(Number(spec.baseline.value))) {
            datasets.push({
                type: 'line', label: `${spec.baseline.label || 'Baseline'} ${formatValue(spec.baseline.value, spec.unit || '')}`,
                data: new Array(count).fill(Number(spec.baseline.value)), borderColor: theme.axis, borderDash: [4, 3], borderWidth: 1,
                pointRadius: 0, pointHoverRadius: 0, fill: false, order: 3, chunkyBaseline: true
            });
        }
        const reduceMotion = options.reducedMotion === true;
        const shadeFrom = shadeIndex(spec);
        return {
            type: bars ? 'bar' : 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: reduceMotion ? false : { duration: 650, easing: 'easeOutQuart' },
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { stacked, grid: { display: false }, border: { display: false }, ticks: { color: theme.axis, maxTicksLimit: 5, maxRotation: 0, font: { size: 10 } } },
                    y: Object.assign({
                        stacked, grid: { color: theme.grid, lineWidth: 1 }, border: { display: false, dash: [0] },
                        ticks: { color: theme.axis, maxTicksLimit: 5, font: { size: 10 }, precision: 0 }, beginAtZero: kind !== 'diverging'
                    }, Number.isFinite(spec.yMax) ? { max: spec.yMax } : {}, kind === 'diverging' ? { suggestedMin: -1, suggestedMax: 1 } : {})
                },
                plugins: {
                    legend: { display: series.length > 1 && kind !== 'bars', position: 'bottom', labels: { color: theme.axis, usePointStyle: true, pointStyle: 'circle', boxWidth: 6, boxHeight: 6, padding: 10, font: { size: 10 } } },
                    tooltip: { mode: 'index', intersect: false, titleFont: { size: 11 }, bodyFont: { size: 11 }, padding: 8, displayColors: true, usePointStyle: true },
                    chunkyShade: shadeFrom >= 0 && spec.shade ? { fromIndex: shadeFrom, color: spec.shade.hex || theme.neutral, label: spec.shade.label || '' } : null
                }
            },
            chunky: {
                kind,
                unit: spec.unit || '',
                mode,
                surface: theme.surface,
                titles: (spec.labels || []).map((label, index) => longDate(label, (spec.dates || [])[index])),
                diverging: kind === 'diverging',
                shadeFrom
            }
        };
    }

    return { WIDTH, PALETTE, THEME, resolveColor, withAlpha, shortDate, longDate, formatValue, sliceChartSpec, shadeIndex, buildChartSvg, buildChartJsConfig, describeIndex, buildLegendHtml, indexAtX, xForIndex };
}

const chartRenderer = createChartRenderer();

// ---- spec builders ---------------------------------------------------------

// All run ids seen across rows, oldest → newest, with their finished_at.
function collectSourceRuns(rows) {
    const byRun = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        (Array.isArray(row && row.series) ? row.series : []).forEach((line) => {
            if (!line || !line.run_id) return;
            if (!byRun.has(line.run_id)) byRun.set(line.run_id, line.finished_at || '');
        });
    });
    return Array.from(byRun.entries())
        .sort((a, b) => String(a[1]).localeCompare(String(b[1])) || String(a[0]).localeCompare(String(b[0])))
        .map(([runId, finishedAt]) => ({ run_id: runId, finished_at: finishedAt }));
}

const NEUTRAL_SERIES_HEX = '#a7b0cc';

// Sources overview: extracted per run stacked by host. Troubled hosts are
// named first (worst first, in their verdict colour), then the biggest ok
// hosts fill the palette's eight slots; everything else folds into "other".
function buildSourcesOverviewChartSpec(health, options = {}) {
    const rows = health && Array.isArray(health.rows) ? health.rows : [];
    const runs = collectSourceRuns(rows);
    if (!runs.length || !rows.length) return null;
    const verdictColors = options.verdictColors || {};
    const maxNamed = Number.isFinite(options.maxNamed) ? options.maxNamed : 8;
    const totalOf = (row) => row.series.reduce((sum, line) => sum + (Number(line.extracted) || 0), 0);
    const troubled = rows.filter((row) => row.verdict !== 'ok').sort((a, b) => sourceVerdictRank(a.verdict) - sourceVerdictRank(b.verdict) || totalOf(b) - totalOf(a)).slice(0, maxNamed);
    const okRows = rows.filter((row) => row.verdict === 'ok').sort((a, b) => totalOf(b) - totalOf(a)).slice(0, Math.max(0, maxNamed - troubled.length));
    const namedHosts = new Set([...troubled, ...okRows].map((row) => row.host));
    const valuesFor = (row) => {
        const byRun = new Map(row.series.map((line) => [line.run_id, Number(line.extracted) || 0]));
        return runs.map((run) => byRun.get(run.run_id) || 0);
    };
    const series = [];
    okRows.forEach((row, index) => {
        series.push({ key: row.host, label: row.host, color: { slot: index }, values: valuesFor(row), role: 'area' });
    });
    troubled.forEach((row) => {
        series.push({ key: row.host, label: row.host, color: { hex: verdictColors[row.verdict] || NEUTRAL_SERIES_HEX }, values: valuesFor(row), role: 'area', verdict: row.verdict });
    });
    const rest = rows.filter((row) => !namedHosts.has(row.host));
    if (rest.length) {
        const other = runs.map(() => 0);
        rest.forEach((row) => valuesFor(row).forEach((value, index) => { other[index] += value; }));
        series.push({ key: 'other', label: `${rest.length} other site${rest.length === 1 ? '' : 's'}`, color: { hex: NEUTRAL_SERIES_HEX }, values: other, role: 'area' });
    }
    return {
        id: 'sources-overview',
        kind: 'stack',
        title: 'Extracted per run, by site',
        unit: '',
        height: 210,
        labels: runs.map((run) => run.run_id),
        dates: runs.map((run) => run.finished_at),
        series,
        baseline: null,
        shade: null
    };
}

// Sites answering: per run, how many hosts came back ok vs not (status).
function buildSitesAnsweringChartSpec(health) {
    const rows = health && Array.isArray(health.rows) ? health.rows : [];
    const runs = collectSourceRuns(rows);
    if (!runs.length) return null;
    const ok = runs.map(() => 0);
    const troubled = runs.map(() => 0);
    const index = new Map(runs.map((run, position) => [run.run_id, position]));
    rows.forEach((row) => row.series.forEach((line) => {
        const position = index.get(line.run_id);
        if (position === undefined) return;
        if (line.status === 'ok') ok[position] += 1; else troubled[position] += 1;
    }));
    return {
        id: 'sites-answering',
        kind: 'bars',
        title: 'Sites answering per run',
        unit: '',
        height: 90,
        labels: runs.map((run) => run.run_id),
        dates: runs.map((run) => run.finished_at),
        series: [
            { key: 'ok', label: 'ok', color: { slot: 0 }, values: ok, role: 'bar' },
            { key: 'troubled', label: 'not ok', color: { hex: '#d03b3b' }, values: troubled, role: 'bar' }
        ],
        baseline: null,
        shade: null
    };
}

function hostShade(row, options = {}) {
    if (!row || !row.since) return null;
    const verdictColors = options.verdictColors || {};
    return { fromLabel: row.since, hex: verdictColors[row.verdict] || NEUTRAL_SERIES_HEX, label: `${sourceVerdictLabel(row.verdict)} since ${formatSourceRun(row.since)}` };
}

// Host detail: extracted / bear / upcoming areas, the baseline, the troubled stretch.
function buildHostSeriesChartSpec(row, options = {}) {
    const series = row && Array.isArray(row.series) ? row.series : [];
    if (!row || series.length < 2) return null;
    const safeHost = String(row.host || 'host').replace(/[^a-zA-Z0-9]/g, '-');
    return {
        id: `host-${safeHost}-series`,
        kind: 'area',
        title: `${row.host} per run`,
        unit: '',
        height: 190,
        labels: series.map((line) => line.run_id),
        dates: series.map((line) => line.finished_at),
        series: [
            { key: 'extracted', label: 'Extracted', color: { slot: 0 }, values: series.map((line) => Number(line.extracted) || 0), role: 'area' },
            { key: 'bear', label: 'Bear', color: { slot: 1 }, values: series.map((line) => Number(line.bear) || 0), role: 'area' },
            { key: 'upcoming', label: 'Upcoming', color: { slot: 2 }, values: series.map((line) => Number(line.upcoming) || 0), role: 'line' }
        ],
        baseline: Number.isFinite(Number(row.baseline)) && row.baseline !== null ? { value: Number(row.baseline), label: 'baseline' } : null,
        shade: hostShade(row, options)
    };
}

// Thin bar row under the host chart: pages fetched and page errors per run.
// Pages are not on the assessment series; options.records (the raw ledger) supplies them.
function buildHostPagesChartSpec(row, options = {}) {
    const series = row && Array.isArray(row.series) ? row.series : [];
    if (!row || series.length < 2) return null;
    const pagesByRun = new Map();
    (Array.isArray(options.records) ? options.records : []).forEach((record) => {
        if (record && record.host === row.host && record.run_id) pagesByRun.set(record.run_id, Number(record.pages) || 0);
    });
    const safeHost = String(row.host || 'host').replace(/[^a-zA-Z0-9]/g, '-');
    return {
        id: `host-${safeHost}-pages`,
        kind: 'bars',
        title: `${row.host} pages per run`,
        unit: '',
        height: 80,
        labels: series.map((line) => line.run_id),
        dates: series.map((line) => line.finished_at),
        series: [
            { key: 'pages', label: 'Pages', color: { slot: 0 }, values: series.map((line) => pagesByRun.get(line.run_id) || 0), role: 'bar' },
            { key: 'page_errors', label: 'Page errors', color: { hex: '#d03b3b' }, values: series.map((line) => Number(line.page_errors) || 0), role: 'bar' }
        ],
        baseline: null,
        shade: hostShade(row, options)
    };
}

// Proposals as a diverging bar (new up, merge down) with vanished counts as dots.
function buildHostProposalsChartSpec(row, options = {}) {
    const series = row && Array.isArray(row.series) ? row.series : [];
    if (!row || series.length < 2) return null;
    const verdictColors = options.verdictColors || {};
    const safeHost = String(row.host || 'host').replace(/[^a-zA-Z0-9]/g, '-');
    return {
        id: `host-${safeHost}-proposals`,
        kind: 'diverging',
        title: `${row.host} proposals per run`,
        unit: '',
        height: 150,
        labels: series.map((line) => line.run_id),
        dates: series.map((line) => line.finished_at),
        series: [
            { key: 'new', label: 'New', color: { slot: 0 }, values: series.map((line) => Number(line.proposals && line.proposals.new) || 0), role: 'bar' },
            { key: 'merge', label: 'Merge', color: { slot: 1 }, values: series.map((line) => Number(line.proposals && line.proposals.merge) || 0), role: 'bar', down: true },
            { key: 'vanished', label: 'Vanished', color: { hex: verdictColors.vanished || '#e056a0' }, values: series.map((line) => Number(line.vanished) || 0), role: 'dots' }
        ],
        baseline: null,
        shade: null
    };
}

// Runs tab: event quality (percent of events with a venue / coordinates /
// duration) and AI time per run, from metrics.ndjson records with signals.
function buildQualityChartSpec(records) {
    const rows = (Array.isArray(records) ? records : []).filter((record) => record && record.signals && typeof record.signals === 'object');
    if (rows.length < 2) return null;
    const trend = buildQualityTrendData(rows);
    return {
        id: 'event-quality',
        kind: 'lines',
        title: 'Event quality per run',
        unit: '%',
        yMax: 100,
        height: 170,
        labels: rows.map((record) => record.run_id || ''),
        dates: rows.map((record) => record.finished_at || ''),
        series: [
            { key: 'venue', label: 'With venue', color: { slot: 0 }, values: trend.venuePct, role: 'line' },
            { key: 'coords', label: 'With coordinates', color: { slot: 1 }, values: trend.coordsPct, role: 'line' },
            { key: 'duration', label: 'With duration', color: { slot: 2 }, values: trend.durationPct, role: 'line' }
        ],
        baseline: null,
        shade: null
    };
}

function buildAiTimeChartSpec(records) {
    const rows = (Array.isArray(records) ? records : []).filter((record) => record && record.signals && typeof record.signals === 'object');
    if (rows.length < 2) return null;
    const trend = buildQualityTrendData(rows);
    return {
        id: 'ai-time',
        kind: 'area',
        title: 'AI time per run',
        unit: 's',
        height: 150,
        labels: rows.map((record) => record.run_id || ''),
        dates: rows.map((record) => record.finished_at || ''),
        series: [
            { key: 'ai', label: 'AI time', color: { slot: 6 }, values: trend.aiTotalMs.map((ms) => Math.round(ms / 100) / 10), role: 'area' }
        ],
        baseline: null,
        shade: null
    };
}

const CHART_RANGES = [
    { key: '7', label: '7d', days: 7 },
    { key: '30', label: '30d', days: 30 },
    { key: 'all', label: 'All', days: null }
];

// JSON inside a single-quoted attribute: only &, <, > and the quote itself
// need escaping, which keeps the embedded spec a third the size of &quot;-ing
// every string delimiter.
function escapeJsonAttr(json) {
    return String(json || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/'/g, '&#39;');
}

// A chart figure: range toggle, the SVG for the default range, legend chips
// and the caption line, with the full spec embedded for the page script
// (re-render on range change, tap-to-caption, Chart.js upgrade).
// options.render === false leaves the stage empty (data-chart-pending) so a
// view that is not visible on load costs only its spec; the page renders it
// with the same code when the view is opened. options.follows names another
// figure whose range toggle this one obeys (no toggle of its own).
function buildChartFigureHtml(spec, options = {}) {
    if (!spec || !Array.isArray(spec.labels) || !spec.labels.length) return '';
    const mode = options.mode === 'dark' ? 'dark' : 'light';
    const range = CHART_RANGES.some((item) => item.key === String(options.range)) ? String(options.range) : '30';
    const rangeDays = (CHART_RANGES.find((item) => item.key === range) || {}).days;
    const shown = rangeDays ? chartRenderer.sliceChartSpec(spec, rangeDays) : spec;
    const follows = options.follows ? ` data-chart-follows="${escapeHtml(options.follows)}"` : '';
    const toggle = options.follows || options.rangeToggle === false ? '' : `<div class="chart-range" role="group" aria-label="Range">${CHART_RANGES.map((item) => `<button type="button" class="chart-range-button${item.key === range ? ' active' : ''}" data-chart-range="${item.key}">${escapeHtml(item.label)}</button>`).join('')}</div>`;
    const caption = chartRenderer.describeIndex(shown, shown.labels.length - 1);
    const pending = options.render === false;
    const stage = pending ? '' : chartRenderer.buildChartSvg(shown, { mode });
    return `
        <figure class="chart-figure chart-kind-${escapeHtml(spec.kind || 'area')}" data-chart='${escapeJsonAttr(JSON.stringify(spec))}' data-chart-id="${escapeHtml(spec.id || '')}" data-chart-range="${range}" data-chart-mode="${mode}"${follows}${pending ? ' data-chart-pending="1"' : ''}>
          ${toggle}
          <div class="chart-stage" data-chart-stage style="aspect-ratio: ${chartRenderer.WIDTH} / ${Number.isFinite(spec.height) ? spec.height : 170};">${stage}</div>
          ${chartRenderer.buildLegendHtml(shown, { mode })}
          <figcaption class="chart-caption" data-chart-caption>${escapeHtml(caption)}</figcaption>
        </figure>`;
}

const MetricsSections = {
    SOURCE_VERDICT_ORDER,
    parseSourceLedger,
    assessSourceHealth,
    escapeHtml,
    buildHealthBadgeHtml,
    buildGuardTableHtml,
    buildArbitrationSummaryHtml,
    buildAiStatsHtml,
    buildFunnelHtml,
    buildHealthGuardsSectionHtml,
    buildQualityTrendData,
    SOURCE_VERDICT_LABELS,
    SOURCE_LEDGER_EMPTY_MESSAGE,
    SOURCE_SORT_KEYS,
    sourceVerdictLabel,
    sourceVerdictRank,
    formatSourceRun,
    formatSourceAge,
    formatSourceDuration,
    buildSparklineSvg,
    sortSourceRows,
    buildVerdictChipHtml,
    buildSourceCountersHtml,
    buildSourcesTableHtml,
    buildHostSummaryHtml,
    buildHostSeriesTableHtml,
    buildHostErrorsHtml,
    buildVanishedListHtml,
    buildSourceWidgetSummary,
    createChartRenderer,
    chartRenderer,
    CHART_RANGES,
    buildSourcesOverviewChartSpec,
    buildSitesAnsweringChartSpec,
    buildHostSeriesChartSpec,
    buildHostPagesChartSpec,
    buildHostProposalsChartSpec,
    buildQualityChartSpec,
    buildAiTimeChartSpec,
    buildChartFigureHtml
};

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        MetricsSections,
        SOURCE_VERDICT_ORDER,
        parseSourceLedger,
        assessSourceHealth,
        escapeHtml,
        buildHealthBadgeHtml,
        buildGuardTableHtml,
        buildArbitrationSummaryHtml,
        buildAiStatsHtml,
        buildFunnelHtml,
        buildHealthGuardsSectionHtml,
        buildQualityTrendData,
        SOURCE_VERDICT_LABELS,
        SOURCE_LEDGER_EMPTY_MESSAGE,
        SOURCE_SORT_KEYS,
        sourceVerdictLabel,
        sourceVerdictRank,
        formatSourceRun,
        formatSourceAge,
        formatSourceDuration,
        buildSparklineSvg,
        sortSourceRows,
        buildVerdictChipHtml,
        buildSourceCountersHtml,
        buildSourcesTableHtml,
        buildHostSummaryHtml,
        buildHostSeriesTableHtml,
        buildHostErrorsHtml,
        buildVanishedListHtml,
        buildSourceWidgetSummary,
        createChartRenderer,
        chartRenderer,
        CHART_RANGES,
        buildSourcesOverviewChartSpec,
        buildSitesAnsweringChartSpec,
        buildHostSeriesChartSpec,
        buildHostPagesChartSpec,
        buildHostProposalsChartSpec,
        buildQualityChartSpec,
        buildAiTimeChartSpec,
        buildChartFigureHtml
    };
} else if (typeof window !== 'undefined') {
    window.MetricsSections = MetricsSections;
} else {
    // Scriptable environment
    this.MetricsSections = MetricsSections;
}

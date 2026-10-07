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
    buildSourceWidgetSummary
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
        buildSourceWidgetSummary
    };
} else if (typeof window !== 'undefined') {
    window.MetricsSections = MetricsSections;
} else {
    // Scriptable environment
    this.MetricsSections = MetricsSections;
}

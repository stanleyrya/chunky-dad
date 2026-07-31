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
    { key: 'mapsLinkConflict', label: "Maps-link pin disagrees with the accepted pin (verify venue)" }
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

const MetricsSections = {
    escapeHtml,
    buildHealthBadgeHtml,
    buildGuardTableHtml,
    buildArbitrationSummaryHtml,
    buildAiStatsHtml,
    buildFunnelHtml,
    buildHealthGuardsSectionHtml,
    buildQualityTrendData
};

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        MetricsSections,
        escapeHtml,
        buildHealthBadgeHtml,
        buildGuardTableHtml,
        buildArbitrationSummaryHtml,
        buildAiStatsHtml,
        buildFunnelHtml,
        buildHealthGuardsSectionHtml,
        buildQualityTrendData
    };
} else if (typeof window !== 'undefined') {
    window.MetricsSections = MetricsSections;
} else {
    // Scriptable environment
    this.MetricsSections = MetricsSections;
}

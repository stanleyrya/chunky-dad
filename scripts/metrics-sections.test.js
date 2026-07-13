const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MetricsSections,
  buildHealthBadgeHtml,
  buildGuardTableHtml,
  buildArbitrationSummaryHtml,
  buildAiStatsHtml,
  buildFunnelHtml,
  buildHealthGuardsSectionHtml,
  buildQualityTrendData
} = require('./metrics-sections');

const { RunLogSummary } = require('./run-log-summary');

// A metrics 2.0 record shaped like buildMetricsRecord output (signals present).
function buildRecordWithSignals(overrides = {}) {
  return Object.assign({
    schema_version: 2,
    run_id: '20260713-090000',
    errors_count: 0,
    warnings_count: 0,
    totals: { total_events: 18, final_bear_events: 9 },
    signals: {
      ai: {
        requests: 5,
        failures: 1,
        totalMs: 6000,
        byPass: {
          extraction: { n: 2, ms: 4000 },
          'context-prep': { n: 1, ms: 800 },
          'merge-arbitration': { n: 1, ms: 0 },
          ocr: { n: 1, ms: 1200 }
        }
      },
      guards: {
        brandBarRejected: 2,
        brandTitleStripped: 1,
        taglineRejected: 0,
        geocodePicked: 1,
        geocodeRejected: 1,
        degenerateEndCaught: 0,
        coordsPreserved: 1,
        barPreserved: 0
      },
      arbitration: { conflicts: 4, calendarPicks: 1, scrapedPicks: 1, fallbacks: 2 },
      funnel: { found: 18, future: 16, bear: 16, final: 9, duplicatesRemoved: 7 },
      quality: { events: 9, withBar: 8, withCoords: 6, withEndDuration: 7 }
    }
  }, overrides);
}

// A pre-metrics-2.0 record: no signals block at all.
function buildLegacyRecord(overrides = {}) {
  return Object.assign({
    schema_version: 2,
    run_id: '20260601-120000',
    errors_count: 0,
    totals: { total_events: 4, final_bear_events: 4 }
  }, overrides);
}

// Wire the section builder the same way display-run-metrics.js does: health
// verdict and badge text come from run-log-summary, HTML from this module.
function renderSection(record) {
  const health = RunLogSummary.evaluateRunHealth(record.signals || null, {
    errorsCount: record.errors_count || 0
  });
  return buildHealthGuardsSectionHtml(record, health, RunLogSummary.formatRunHealthBadge(health));
}

test('Health & Guards section renders badge, guards, arbitration and AI stats', () => {
  const html = renderSection(buildRecordWithSignals());

  // Badge (geocodeRejected=1 makes this a warn run)
  assert.ok(html.includes('health-badge warn'));
  assert.ok(html.includes('geocode rejected ×1'));

  // Funnel line
  assert.ok(html.includes('18 found → 16 future → 16 bear → 9 final (7 dupes removed)'));

  // Guard table: only guards that fired appear
  assert.ok(html.includes('Organizer/brand rejected as venue'));
  assert.ok(html.includes('Geocode rejected (outside event city)'));
  assert.ok(!html.includes('Site tagline rejected'));
  assert.ok(!html.includes('Degenerate end date'));

  // Arbitration summary with fallback rate
  assert.ok(html.includes('4 conflicts • calendar 1 / scraped 1 • fallbacks 2 (50%)'));

  // AI stats by pass with avg latency, plus run totals including failures
  assert.ok(html.includes('extraction'));
  assert.ok(html.includes('2.0s'));   // extraction avg 4000/2
  assert.ok(html.includes('800ms'));  // context-prep avg
  assert.ok(html.includes('5 requests • 1 failure • total 6.0s'));
});

test('records without signals render gracefully — no NaN, no crash', () => {
  const html = renderSection(buildLegacyRecord());

  assert.ok(html.includes('health-badge ok'));
  assert.ok(html.includes('🟢 Run healthy'));
  assert.ok(html.includes('No signal data for this run'));
  assert.ok(!html.includes('NaN'));
  assert.ok(!html.includes('undefined'));

  // Legacy record with errors still warns via the badge
  const warnHtml = renderSection(buildLegacyRecord({ errors_count: 2 }));
  assert.ok(warnHtml.includes('health-badge warn'));
  assert.ok(warnHtml.includes('2 errors'));
});

test('healthy run with no guard/arbitration activity renders quiet notes', () => {
  const record = buildRecordWithSignals();
  record.signals.guards = {
    brandBarRejected: 0, brandTitleStripped: 0, taglineRejected: 0,
    geocodePicked: 0, geocodeRejected: 0, degenerateEndCaught: 0,
    coordsPreserved: 0, barPreserved: 0
  };
  record.signals.arbitration = { conflicts: 0, calendarPicks: 0, scrapedPicks: 0, fallbacks: 0 };
  record.signals.ai = { requests: 0, failures: 0, totalMs: 0, byPass: {} };

  const html = renderSection(record);
  assert.ok(html.includes('health-badge ok'));
  assert.ok(html.includes('No guards fired in this run.'));
  assert.ok(html.includes('No merge conflicts needed arbitration.'));
  assert.ok(html.includes('No AI requests in this run.'));
});

test('section HTML escapes markup in badge text', () => {
  const html = buildHealthGuardsSectionHtml(
    buildLegacyRecord(),
    { status: 'warn', reasons: ['<script>alert(1)</script>'] },
    '🟡 1 warning: <script>alert(1)</script>'
  );
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('buildQualityTrendData skips records without signals and never yields NaN', () => {
  const records = [
    buildLegacyRecord(),                       // skipped: no signals
    buildRecordWithSignals(),                  // 8/9 venue, 6/9 coords, 7/9 duration
    buildRecordWithSignals({
      signals: {
        ai: { requests: 0, failures: 0, totalMs: 0, byPass: {} },
        guards: {},
        arbitration: { conflicts: 0, calendarPicks: 0, scrapedPicks: 0, fallbacks: 0 },
        funnel: { found: 0, future: 0, bear: 0, final: 0, duplicatesRemoved: 0 },
        quality: { events: 0, withBar: 0, withCoords: 0, withEndDuration: 0 }  // empty run
      }
    })
  ];

  const trend = buildQualityTrendData(records);
  assert.equal(trend.count, 2);
  assert.deepEqual(trend.venuePct, [89, 0]);
  assert.deepEqual(trend.coordsPct, [67, 0]);
  assert.deepEqual(trend.durationPct, [78, 0]);
  assert.deepEqual(trend.aiTotalMs, [6000, 0]);
  for (const series of [trend.venuePct, trend.coordsPct, trend.durationPct, trend.aiTotalMs]) {
    assert.ok(series.every(value => Number.isFinite(value)));
  }
});

test('buildQualityTrendData handles empty/garbage input', () => {
  for (const input of [[], null, undefined, [null, {}, { signals: null }]]) {
    const trend = buildQualityTrendData(input);
    assert.equal(trend.count, 0);
    assert.deepEqual(trend.venuePct, []);
    assert.deepEqual(trend.aiTotalMs, []);
  }
});

test('module exposes the full MetricsSections surface', () => {
  assert.equal(typeof MetricsSections.buildHealthBadgeHtml, 'function');
  assert.equal(typeof MetricsSections.buildGuardTableHtml, 'function');
  assert.equal(typeof MetricsSections.buildArbitrationSummaryHtml, 'function');
  assert.equal(typeof MetricsSections.buildAiStatsHtml, 'function');
  assert.equal(typeof MetricsSections.buildFunnelHtml, 'function');
  assert.equal(typeof MetricsSections.buildHealthGuardsSectionHtml, 'function');
  assert.equal(typeof MetricsSections.buildQualityTrendData, 'function');
  assert.equal(buildHealthBadgeHtml('🟢 Run healthy', 'ok'), '<div class="health-badge ok">🟢 Run healthy</div>');
});

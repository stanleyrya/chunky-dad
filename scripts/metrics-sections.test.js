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

// ---------------------------------------------------------------------------
// Sources dashboard builders (source ledger → Sources view, host detail, widget)
// ---------------------------------------------------------------------------

// One ledger line shaped like SharedCore.buildSourceLedger output.
function buildLedgerLine(overrides = {}) {
  return Object.assign({
    v: 1,
    run_id: '20260921-184116',
    finished_at: '2026-09-21T22:41:16.345Z',
    environment: 'node',
    trigger: 'scheduled',
    host: 'eaglela.com',
    parsers: ['Eagle LA'],
    pages: 2,
    outbound_pages: 1,
    page_errors: 0,
    errors: [],
    extracted: 40,
    events: 10,
    bear: 8,
    upcoming: 6,
    proposals: { new: 1, merge: 2 },
    duration_ms: 1500,
    status: 'ok',
    vanished: []
  }, overrides);
}

// Four runs: a healthy site, a site that died on the last run, and a site
// whose upcoming events vanished. Assessed at a fixed "now".
function buildLedgerHealth() {
  const runs = [
    ['20260918-050000', '2026-09-18T09:00:00.000Z'],
    ['20260919-050000', '2026-09-19T09:00:00.000Z'],
    ['20260920-050000', '2026-09-20T09:00:00.000Z'],
    ['20260921-050000', '2026-09-21T09:00:00.000Z']
  ];
  const lines = [];
  runs.forEach(([run_id, finished_at], index) => {
    const isLast = index === runs.length - 1;
    lines.push(buildLedgerLine({ run_id, finished_at, host: 'eaglela.com', parsers: ['Eagle LA'], extracted: 40 + index }));
    lines.push(buildLedgerLine({
      run_id, finished_at, host: 'deadbar.example', parsers: ['Dead Bar'],
      environment: isLast ? 'scriptable' : 'node',
      extracted: isLast ? 0 : 20, events: isLast ? 0 : 5, bear: isLast ? 0 : 4, upcoming: isLast ? 0 : 3,
      status: isLast ? 'dead' : 'ok',
      page_errors: isLast ? 1 : 0,
      errors: isLast ? ['SYSTEM: Failed to process URL https://deadbar.example/: fetch failed'] : []
    }));
    lines.push(buildLedgerLine({
      run_id, finished_at, host: 'bearitmtl.com', parsers: ['Bear it MTL'], extracted: 70, bear: 18, upcoming: isLast ? 7 : 8,
      vanished: isLast ? [{ key: 'bear beer bust|bar|2026-10-03', title: 'Bear Beer Bust <late>', day: '2026-10-03', bear: true, last_seen: '20260920-050000' }] : []
    }));
  });
  const text = lines.map(line => JSON.stringify(line)).join('\n') + '\n';
  const records = MetricsSections.parseSourceLedger(text);
  const health = MetricsSections.assessSourceHealth(records, { now: new Date('2026-09-21T12:00:00.000Z') });
  return { records, health };
}

test('formatSourceRun reads the run id as local time and falls back to ISO', () => {
  assert.equal(MetricsSections.formatSourceRun('20260921-184116'), 'Sep 21 18:41');
  assert.equal(MetricsSections.formatSourceRun(null, '2026-09-21T22:41:16.345Z'), '2026-09-21 22:41Z');
  assert.equal(MetricsSections.formatSourceRun('odd-id'), 'odd-id');
  assert.equal(MetricsSections.formatSourceRun(null, null), 'unknown');
  assert.equal(MetricsSections.formatSourceAge(0.4), 'today');
  assert.equal(MetricsSections.formatSourceAge(5.7), '5d ago');
  assert.equal(MetricsSections.formatSourceAge(null), 'never');
});

test('buildSparklineSvg draws a polyline with a dot on the newest value', () => {
  const svg = MetricsSections.buildSparklineSvg([0, 5, 10, 5]);
  assert.ok(svg.startsWith('<svg class="sparkline"'));
  assert.ok(svg.includes('<polyline'));
  assert.ok(svg.includes('<circle'));
  assert.ok(!svg.includes('NaN'));
  // Flat series still draws (level line), single point draws just the dot
  assert.ok(MetricsSections.buildSparklineSvg([3, 3, 3]).includes('<polyline'));
  const single = MetricsSections.buildSparklineSvg([7]);
  assert.ok(single.includes('<circle') && !single.includes('<polyline'));
  assert.equal(MetricsSections.buildSparklineSvg([]), '');
  assert.equal(MetricsSections.buildSparklineSvg(null), '');
});

test('sortSourceRows keeps trouble first by default and honours explicit keys', () => {
  const { health } = buildLedgerHealth();
  const defaultOrder = MetricsSections.sortSourceRows(health.rows, null).map(row => row.verdict);
  assert.deepEqual(defaultOrder, ['dead', 'vanished', 'ok']);
  const byHost = MetricsSections.sortSourceRows(health.rows, { key: 'host', direction: 'asc' }).map(row => row.host);
  assert.deepEqual(byHost, ['bearitmtl.com', 'deadbar.example', 'eaglela.com']);
  const byExtracted = MetricsSections.sortSourceRows(health.rows, { key: 'extracted', direction: 'desc' }).map(row => row.host);
  assert.deepEqual(byExtracted, ['bearitmtl.com', 'eaglela.com', 'deadbar.example']);
  // Unknown key falls back to the verdict order; input is not mutated
  const copy = health.rows.slice();
  MetricsSections.sortSourceRows(health.rows, { key: 'bogus', direction: 'desc' });
  assert.deepEqual(health.rows, copy);
});

test('Sources table renders one row per host, trouble first, with chips, sparkline, since and deep links', () => {
  const { health } = buildLedgerHealth();
  const html = MetricsSections.buildSourcesTableHtml(health, {
    hostUrl: row => `scriptable:///run?scriptName=display-run-metrics&host=${encodeURIComponent(row.host)}`,
    faviconUrl: row => (row.host === 'eaglela.com' ? 'https://chunky.dad/img/favicons/favicon-eaglela.com-64px.ico' : null)
  });
  const rowOrder = Array.from(html.matchAll(/data-source-host="([^"]+)"/g)).map(match => match[1]);
  assert.deepEqual(rowOrder, ['deadbar.example', 'bearitmtl.com', 'eaglela.com']);
  assert.ok(html.includes('verdict-chip verdict-dead'));
  assert.ok(html.includes('verdict-chip verdict-vanished'));
  assert.ok(html.includes('verdict-chip verdict-ok'));
  assert.ok(html.includes('since Sep 21 05:00'));           // dead since the last run
  assert.ok(html.includes('1 gone'));                        // vanished count note
  assert.ok(html.includes('Dead Bar'));                      // parser label differs from the host
  assert.ok(html.includes('href="scriptable:///run?scriptName=display-run-metrics&amp;host=eaglela.com"'));
  assert.ok(html.includes('data-nav-view="host" data-nav-key="eaglela.com"'));
  assert.ok(html.includes('favicon-eaglela.com-64px.ico'));
  assert.ok(html.includes('source-favicon placeholder'));    // hosts without an icon
  assert.equal((html.match(/<svg class="sparkline"/g) || []).length, 3);
  assert.ok(html.includes('data-sort-view="sources"'));
  assert.ok(html.includes('data-source-extracted="43"'));
  assert.ok(!html.includes('NaN') && !html.includes('undefined'));
});

test('Sources counters list hosts, troubled and each verdict that occurs', () => {
  const { health } = buildLedgerHealth();
  const html = MetricsSections.buildSourceCountersHtml(health);
  assert.ok(html.includes('Hosts</span><span class="metric-chip-value">3'));
  assert.ok(html.includes('Troubled</span><span class="metric-chip-value">2'));
  assert.ok(html.includes('verdict-dead'));
  assert.ok(html.includes('verdict-vanished'));
  assert.ok(html.includes('verdict-ok'));
  assert.ok(!html.includes('verdict-stopped'));
  const empty = MetricsSections.buildSourceCountersHtml(null);
  assert.ok(empty.includes('Hosts</span><span class="metric-chip-value">0'));
});

test('Host detail: summary, series table (newest first, with environment), errors and vanished list', () => {
  const { records, health } = buildLedgerHealth();
  const dead = health.rows.find(row => row.host === 'deadbar.example');
  const summary = MetricsSections.buildHostSummaryHtml(dead, { faviconUrl: () => null });
  assert.ok(summary.includes('deadbar.example'));
  assert.ok(summary.includes('verdict-chip verdict-dead'));
  assert.ok(summary.includes('baseline 20'));
  assert.ok(summary.includes('trouble since Sep 21 05:00'));
  assert.ok(summary.includes('4 runs on record'));
  assert.ok(summary.includes('scriptable'));

  const series = MetricsSections.buildHostSeriesTableHtml(dead, { records });
  const runCells = Array.from(series.matchAll(/<div class="cell-title">(Sep \d+ \d\d:\d\d)<\/div>/g)).map(match => match[1]);
  assert.deepEqual(runCells, ['Sep 21 05:00', 'Sep 20 05:00', 'Sep 19 05:00', 'Sep 18 05:00']);
  assert.ok(series.includes('source-status-dead'));
  assert.ok(series.includes('<div class="cell-subtitle">scriptable</div>'));
  assert.ok(series.includes('<div class="cell-subtitle">node</div>'));
  assert.ok(series.includes('1.5s'));
  const limited = MetricsSections.buildHostSeriesTableHtml(dead, { records, limit: 2 });
  assert.ok(limited.includes('+2 older runs not shown'));

  const errors = MetricsSections.buildHostErrorsHtml(dead);
  assert.ok(errors.includes('<li>SYSTEM: Failed to process URL https://deadbar.example/: fetch failed</li>'));
  const healthy = health.rows.find(row => row.host === 'eaglela.com');
  assert.ok(MetricsSections.buildHostErrorsHtml(healthy).includes('No errors in the latest run.'));

  const vanishedRow = health.rows.find(row => row.host === 'bearitmtl.com');
  const vanished = MetricsSections.buildVanishedListHtml(vanishedRow);
  assert.ok(vanished.includes('Bear Beer Bust &lt;late&gt;'));   // escaped
  assert.ok(vanished.includes('2026-10-03'));
  assert.ok(vanished.includes('🐻'));
  assert.ok(vanished.includes('Sep 20 05:00'));                    // last seen run
  assert.ok(MetricsSections.buildVanishedListHtml(healthy).includes('No upcoming events vanished'));

  // Missing row renders a note, never throws
  assert.ok(MetricsSections.buildHostSummaryHtml(null).includes('No ledger lines'));
  assert.ok(MetricsSections.buildHostSeriesTableHtml(null).includes('No runs recorded'));
  assert.ok(MetricsSections.buildHostErrorsHtml(null).includes('No errors'));
  assert.ok(MetricsSections.buildVanishedListHtml(undefined).includes('No upcoming events vanished'));
});

test('widget summary names the troubled count and the top troubled hosts', () => {
  const { health } = buildLedgerHealth();
  const summary = MetricsSections.buildSourceWidgetSummary(health, { limit: 1 });
  assert.equal(summary.headline, '2 of 3 sites need a look');
  assert.equal(summary.hosts, 3);
  assert.equal(summary.troubled, 2);
  assert.equal(summary.items.length, 1);
  assert.equal(summary.items[0].host, 'deadbar.example');
  assert.equal(summary.items[0].label, 'Dead');
  assert.equal(summary.items[0].sinceLabel, 'Sep 21 05:00');
  assert.equal(summary.more, 1);
  assert.equal(summary.newestFinishedAt, '2026-09-21T09:00:00.000Z');

  const calm = MetricsSections.buildSourceWidgetSummary({
    rows: health.rows.filter(row => row.verdict === 'ok'), counts: {}, troubled: 0, hosts: 1
  });
  assert.equal(calm.headline, 'All 1 site ok');
  assert.deepEqual(calm.items, []);
  assert.equal(MetricsSections.buildSourceWidgetSummary(null).headline, 'No sources yet');
});

test('empty ledger renders the friendly message through the table builder', () => {
  const html = MetricsSections.buildSourcesTableHtml({ rows: [], counts: {}, troubled: 0, hosts: 0 });
  assert.ok(html.includes('No source ledger yet'));
  assert.ok(html.includes('npm run backfill-source-ledger'));
  assert.equal(MetricsSections.SOURCE_LEDGER_EMPTY_MESSAGE.includes('backfill-source-ledger'), true);
});

test('module exposes the Sources builders on both export surfaces', () => {
  const exported = require('./metrics-sections');
  ['buildSparklineSvg', 'sortSourceRows', 'buildSourceCountersHtml', 'buildSourcesTableHtml',
    'buildHostSummaryHtml', 'buildHostSeriesTableHtml', 'buildHostErrorsHtml', 'buildVanishedListHtml',
    'buildSourceWidgetSummary', 'formatSourceRun', 'formatSourceAge', 'sourceVerdictLabel'].forEach(name => {
    assert.equal(typeof MetricsSections[name], 'function', name);
    assert.equal(typeof exported[name], 'function', name);
  });
  assert.deepEqual(exported.SOURCE_VERDICT_ORDER, ['dead', 'stopped', 'shrunk', 'empty', 'vanished', 'quiet', 'companion', 'ok']);
  assert.deepEqual(exported.SOURCE_UNTROUBLED_VERDICTS, ['ok', 'companion']);
  assert.equal(MetricsSections.SOURCE_VERDICT_LABELS.shrunk, 'Shrunk');
});

// ---------------------------------------------------------------------------
// Charts: specs from ledger rows / metrics records, the SVG renderer and the
// Chart.js config builder (both from the self-contained createChartRenderer).
// ---------------------------------------------------------------------------

const VERDICT_COLORS = { dead: '#ff6b6b', shrunk: '#feca57', vanished: '#e056a0', ok: '#a7b0cc' };

// Four runs across three hosts: one dies on the last two runs, one is fine,
// one small site reports a vanished event on the last run.
function buildChartLedger() {
  const runs = [
    ['20260920-050000', '2026-09-20T09:00:00.000Z'],
    ['20260921-050000', '2026-09-21T09:00:00.000Z'],
    ['20260928-050000', '2026-09-28T09:00:00.000Z'],
    ['20260929-050000', '2026-09-29T09:00:00.000Z']
  ];
  const line = (host, index, extra) => Object.assign({
    v: 1, run_id: runs[index][0], finished_at: runs[index][1], host, parsers: [host], pages: 3, page_errors: 0, errors: [],
    extracted: 40, events: 10, bear: 9, upcoming: 6, proposals: { new: 1, merge: 8 }, duration_ms: 500, status: 'ok', vanished: []
  }, extra);
  return [
    line('big.example', 0), line('big.example', 1, { extracted: 44 }), line('big.example', 2, { extracted: 42, proposals: { new: 3, merge: 7 } }), line('big.example', 3, { extracted: 46 }),
    line('dead.example', 0, { extracted: 20 }), line('dead.example', 1, { extracted: 22 }), line('dead.example', 2, { extracted: 0, events: 0, bear: 0, upcoming: 0, status: 'dead', page_errors: 1, pages: 1, errors: ['boom'] }), line('dead.example', 3, { extracted: 0, events: 0, bear: 0, upcoming: 0, status: 'dead', page_errors: 2, pages: 1, errors: ['boom'] }),
    line('tiny.example', 0, { extracted: 2, events: 2, bear: 2, upcoming: 2 }), line('tiny.example', 1, { extracted: 2, events: 2, bear: 2, upcoming: 2 }), line('tiny.example', 2, { extracted: 2, events: 2, bear: 2, upcoming: 2 }),
    line('tiny.example', 3, { extracted: 2, events: 2, bear: 2, upcoming: 1, vanished: [{ key: 'x', title: 'Gone Night', day: '2026-10-02', bear: true, last_seen: '20260928-050000' }] })
  ];
}

function chartHealth() {
  return MetricsSections.assessSourceHealth(buildChartLedger(), { now: new Date('2026-09-29T12:00:00.000Z') });
}

test('sources overview spec stacks extracted per run, troubled hosts in their verdict colour, the rest folded', () => {
  const spec = MetricsSections.buildSourcesOverviewChartSpec(chartHealth(), { verdictColors: VERDICT_COLORS, maxNamed: 2 });
  assert.equal(spec.kind, 'stack');
  assert.deepEqual(spec.labels, ['20260920-050000', '20260921-050000', '20260928-050000', '20260929-050000']);
  assert.equal(spec.dates[3], '2026-09-29T09:00:00.000Z');
  // 2 named slots: both troubled hosts (dead first, then vanished) — big.example folds into "other".
  assert.deepEqual(spec.series.map(item => item.key), ['dead.example', 'tiny.example', 'other']);
  assert.deepEqual(spec.series[0].color, { hex: '#ff6b6b' });
  assert.deepEqual(spec.series[0].values, [20, 22, 0, 0]);
  assert.deepEqual(spec.series[1].color, { hex: '#e056a0' });
  assert.deepEqual(spec.series[2].values, [40, 44, 42, 46]);
  assert.equal(spec.series[2].label, '1 other site');
  // With room, ok hosts take palette slots in volume order and keep them.
  const wide = MetricsSections.buildSourcesOverviewChartSpec(chartHealth(), { verdictColors: VERDICT_COLORS });
  assert.deepEqual(wide.series.map(item => item.key), ['big.example', 'dead.example', 'tiny.example']);
  assert.deepEqual(wide.series[0].color, { slot: 0 });
  assert.equal(MetricsSections.buildSourcesOverviewChartSpec({ rows: [] }), null);
});

test('sites answering spec counts ok vs not-ok hosts per run', () => {
  const spec = MetricsSections.buildSitesAnsweringChartSpec(chartHealth());
  assert.equal(spec.kind, 'bars');
  assert.deepEqual(spec.series[0].values, [3, 3, 2, 2]);
  assert.deepEqual(spec.series[1].values, [0, 0, 1, 1]);
  assert.equal(spec.series[1].label, 'not ok');
});

test('host specs: series with baseline + shaded stretch, pages strip, diverging proposals with vanished dots', () => {
  const health = chartHealth();
  const dead = health.rows.find(row => row.host === 'dead.example');
  const series = MetricsSections.buildHostSeriesChartSpec(dead, { verdictColors: VERDICT_COLORS });
  assert.equal(series.id, 'host-dead-example-series');
  assert.deepEqual(series.series.map(item => item.key), ['extracted', 'bear', 'upcoming']);
  assert.deepEqual(series.series[0].values, [20, 22, 0, 0]);
  assert.deepEqual(series.baseline, { value: 21, label: 'baseline' });
  assert.deepEqual(series.shade, { fromLabel: '20260928-050000', hex: '#ff6b6b', label: 'Dead since Sep 28 05:00' });

  const pages = MetricsSections.buildHostPagesChartSpec(dead, { records: buildChartLedger(), verdictColors: VERDICT_COLORS });
  assert.equal(pages.kind, 'bars');
  assert.deepEqual(pages.series[0].values, [3, 3, 1, 1]);
  assert.deepEqual(pages.series[1].values, [0, 0, 1, 2]);
  assert.equal(pages.shade.fromLabel, '20260928-050000');
  // Without the raw records the pages row is zeros, never a throw.
  assert.deepEqual(MetricsSections.buildHostPagesChartSpec(dead).series[0].values, [0, 0, 0, 0]);

  const tiny = health.rows.find(row => row.host === 'tiny.example');
  const proposals = MetricsSections.buildHostProposalsChartSpec(tiny, { verdictColors: VERDICT_COLORS });
  assert.equal(proposals.kind, 'diverging');
  assert.equal(proposals.series[1].down, true);
  assert.deepEqual(proposals.series[2], { key: 'vanished', label: 'Vanished', color: { hex: '#e056a0' }, values: [0, 0, 0, 1], role: 'dots' });
  assert.equal(proposals.shade, null);

  const ok = health.rows.find(row => row.host === 'big.example');
  assert.equal(MetricsSections.buildHostSeriesChartSpec(ok).shade, null);
  assert.equal(MetricsSections.buildHostSeriesChartSpec({ host: 'one.example', series: [{ run_id: 'x' }] }), null, 'one run is not a chart');
});

test('runs specs come from metrics records with signals only', () => {
  const records = [
    buildRecordWithSignals({ run_id: '20260713-090000', finished_at: '2026-07-13T09:00:00.000Z' }),
    buildLegacyRecord(),
    buildRecordWithSignals({ run_id: '20260714-090000', finished_at: '2026-07-14T09:00:00.000Z', signals: Object.assign({}, buildRecordWithSignals().signals, { quality: { events: 10, withBar: 5, withCoords: 10, withEndDuration: 0 }, ai: { requests: 1, failures: 0, totalMs: 12345, byPass: {} } }) })
  ];
  const quality = MetricsSections.buildQualityChartSpec(records);
  assert.equal(quality.kind, 'lines');
  assert.equal(quality.unit, '%');
  assert.equal(quality.yMax, 100);
  assert.deepEqual(quality.labels, ['20260713-090000', '20260714-090000']);
  assert.deepEqual(quality.series.map(item => item.values), [[89, 50], [67, 100], [78, 0]]);
  const ai = MetricsSections.buildAiTimeChartSpec(records);
  assert.equal(ai.unit, 's');
  assert.deepEqual(ai.series[0].values, [6, 12.3]);
  assert.equal(MetricsSections.buildQualityChartSpec([buildLegacyRecord(), buildRecordWithSignals()]), null, 'needs two signal runs');
});

test('chart renderer draws an area chart with gradients, gridlines, baseline, shade and the newest point', () => {
  const renderer = MetricsSections.createChartRenderer();
  const spec = MetricsSections.buildHostSeriesChartSpec(chartHealth().rows.find(row => row.host === 'dead.example'), { verdictColors: VERDICT_COLORS });
  const svg = renderer.buildChartSvg(spec, { mode: 'light' });
  assert.ok(svg.startsWith('<svg class="chart-svg" viewBox="0 0 360 190" width="100%"'));
  assert.equal((svg.match(/<linearGradient /g) || []).length, 2, 'two area fills (upcoming is a line)');
  // top value 22 → axis max 25 → five whole-number ticks (5, 10, … 25), never 6.25.
  assert.equal((svg.match(/class="chart-grid"/g) || []).length, 5);
  assert.ok(svg.includes('>25<') && svg.includes('>5<') && !svg.includes('.25<'), 'integer ticks');
  assert.ok(svg.includes('class="chart-baseline"') && svg.includes('stroke-dasharray="4 3"'));
  assert.ok(svg.includes('baseline 21'));
  assert.ok(svg.includes('class="chart-shade"') && svg.includes('fill="#ff6b6b" fill-opacity="0.12"'));
  assert.equal((svg.match(/class="chart-last"/g) || []).length, 3, 'newest point ring per series');
  assert.ok(svg.includes('stroke="#5b6ee1"'), 'light palette slot 0');
  assert.ok(svg.includes('>Sep 20<') && svg.includes('>Sep 29<'), 'date axis');
  assert.ok(svg.includes('data-chart-hit') && svg.includes('data-chart-cursor'));
  assert.ok(!svg.includes('NaN') && !svg.includes('undefined'));
  const dark = renderer.buildChartSvg(spec, { mode: 'dark' });
  assert.ok(dark.includes('stroke="#667eea"') && dark.includes('#1b1c2b'), 'dark palette + dark surface ring');
  assert.equal(renderer.buildChartSvg({ labels: [], series: [] }), '');
});

test('chart renderer draws stacked bars with a surface gap, diverging bars and dots', () => {
  const renderer = MetricsSections.createChartRenderer();
  const health = chartHealth();
  const strip = renderer.buildChartSvg(MetricsSections.buildSitesAnsweringChartSpec(health), { mode: 'light' });
  assert.equal((strip.match(/class="chart-bar"/g) || []).length, 6, 'four ok bars + two troubled segments');
  assert.ok(strip.includes('fill="#d03b3b"'));
  const tiny = health.rows.find(row => row.host === 'tiny.example');
  const diverging = renderer.buildChartSvg(MetricsSections.buildHostProposalsChartSpec(tiny, { verdictColors: VERDICT_COLORS }), { mode: 'light' });
  assert.equal((diverging.match(/class="chart-bar"/g) || []).length, 8, 'new up + merge down per run');
  assert.equal((diverging.match(/class="chart-dot"/g) || []).length, 1, 'one vanished dot');
  assert.ok(diverging.includes('class="chart-dot-label"'));
  assert.ok(diverging.includes('class="chart-zero"'));
});

test('range slicing keeps the newest window, resolves the shade, and never drops below two runs', () => {
  const renderer = MetricsSections.createChartRenderer();
  const spec = MetricsSections.buildHostSeriesChartSpec(chartHealth().rows.find(row => row.host === 'dead.example'), { verdictColors: VERDICT_COLORS });
  const week = renderer.sliceChartSpec(spec, 7);
  assert.deepEqual(week.labels, ['20260928-050000', '20260929-050000']);
  assert.deepEqual(week.series[0].values, [0, 0]);
  assert.equal(renderer.shadeIndex(week), 0);
  assert.equal(renderer.shadeIndex(spec), 2);
  assert.equal(renderer.sliceChartSpec(spec, 'all'), spec);
  assert.equal(renderer.sliceChartSpec(spec, 30).labels.length, 4);
  const day = renderer.sliceChartSpec(spec, 0.5);
  assert.equal(day.labels.length, 2, 'a window with one run widens to two');
  // A shade that began before the window shades everything; one after it, nothing.
  assert.equal(renderer.shadeIndex(Object.assign({}, week, { shade: { fromLabel: '20260921-050000' } })), 0);
  assert.equal(renderer.shadeIndex(Object.assign({}, week, { shade: { fromLabel: '20261001-050000' } })), -1);
});

test('tap geometry, captions and legend chips', () => {
  const renderer = MetricsSections.createChartRenderer();
  const spec = MetricsSections.buildHostSeriesChartSpec(chartHealth().rows.find(row => row.host === 'dead.example'), { verdictColors: VERDICT_COLORS });
  assert.equal(renderer.indexAtX(spec, 36), 0);
  assert.equal(renderer.indexAtX(spec, 348), 3);
  assert.equal(renderer.indexAtX(spec, 190), 1);
  assert.equal(renderer.indexAtX(spec, -50), 0);
  assert.equal(renderer.xForIndex(spec, 0), 36);
  assert.equal(renderer.xForIndex(spec, 3), 348);
  assert.equal(renderer.describeIndex(spec, 2), 'Sep 28 05:00 · Extracted 0 · Bear 0 · Upcoming 0');
  assert.equal(renderer.describeIndex(spec, 99), 'Sep 29 05:00 · Extracted 0 · Bear 0 · Upcoming 0', 'out of range falls back to the newest');
  const legend = renderer.buildLegendHtml(spec, { mode: 'light' });
  assert.equal((legend.match(/chart-legend-item/g) || []).length, 3);
  assert.ok(legend.includes('<span class="chart-legend-label">Extracted</span><span class="chart-legend-value">0</span>'));
  assert.equal(renderer.buildLegendHtml(MetricsSections.buildAiTimeChartSpec([buildRecordWithSignals(), buildRecordWithSignals({ run_id: '20260714-090000' })])), '', 'single series needs no legend');
  assert.equal(renderer.formatValue(12.34, 's'), '12.3s');
  assert.equal(renderer.formatValue(50, '%'), '50%');
});

test('Chart.js config mirrors the spec: datasets, stacking, baseline, shade, reduced motion', () => {
  const renderer = MetricsSections.createChartRenderer();
  const health = chartHealth();
  const dead = health.rows.find(row => row.host === 'dead.example');
  const config = renderer.buildChartJsConfig(MetricsSections.buildHostSeriesChartSpec(dead, { verdictColors: VERDICT_COLORS }), { mode: 'dark', reducedMotion: true });
  assert.equal(config.type, 'line');
  assert.deepEqual(config.data.labels, ['Sep 20', 'Sep 21', 'Sep 28', 'Sep 29']);
  assert.equal(config.data.datasets.length, 4, 'three series + the baseline');
  assert.equal(config.data.datasets[0].borderColor, '#667eea');
  assert.equal(config.data.datasets[0].fill, 'origin');
  assert.equal(config.data.datasets[0].chunkyGradient, true);
  assert.equal(config.data.datasets[2].fill, false, 'upcoming is a line');
  assert.deepEqual(config.data.datasets[0].pointRadius, [0, 0, 0, 3.5], 'newest point emphasised');
  assert.equal(config.data.datasets[3].chunkyBaseline, true);
  assert.deepEqual(config.data.datasets[3].borderDash, [4, 3]);
  assert.equal(config.options.animation, false);
  assert.deepEqual(config.options.plugins.chunkyShade, { fromIndex: 2, color: '#ff6b6b', label: 'Dead since Sep 28 05:00' });
  assert.equal(config.options.plugins.legend.display, true);
  assert.deepEqual(config.options.interaction, { mode: 'index', intersect: false });
  assert.equal(config.chunky.titles[2], 'Sep 28 05:00');

  const animated = renderer.buildChartJsConfig(MetricsSections.buildSourcesOverviewChartSpec(health, { verdictColors: VERDICT_COLORS }), { mode: 'light' });
  assert.equal(animated.options.animation.duration, 650);
  assert.equal(animated.options.scales.y.stacked, true);
  assert.equal(animated.data.datasets[1].fill, '-1', 'stacked areas fill to the series below');

  const diverging = renderer.buildChartJsConfig(MetricsSections.buildHostProposalsChartSpec(health.rows.find(row => row.host === 'tiny.example'), { verdictColors: VERDICT_COLORS }), { mode: 'light' });
  assert.equal(diverging.type, 'bar');
  assert.deepEqual(diverging.data.datasets[1].data, [-8, -8, -8, -8], 'merge drawn downward');
  assert.deepEqual(diverging.data.datasets[2].data, [null, null, null, 1], 'dots only where something vanished');
  assert.equal(diverging.data.datasets[2].showLine, false);
  const quality = renderer.buildChartJsConfig(MetricsSections.buildQualityChartSpec([buildRecordWithSignals(), buildRecordWithSignals({ run_id: '20260714-090000' })]), {});
  assert.equal(quality.options.scales.y.max, 100);
  const strip = renderer.buildChartJsConfig(MetricsSections.buildSitesAnsweringChartSpec(health), { mode: 'light' });
  assert.equal(strip.type, 'bar');
  assert.equal(strip.options.plugins.legend.display, false, 'strips keep the HTML legend chips');
  assert.equal(strip.data.datasets[0].stack, 'stack');
});

test('chart figure embeds the spec, renders the default range, and can stay pending', () => {
  const spec = MetricsSections.buildHostSeriesChartSpec(chartHealth().rows.find(row => row.host === 'dead.example'), { verdictColors: VERDICT_COLORS });
  const figure = MetricsSections.buildChartFigureHtml(spec, { mode: 'light' });
  assert.ok(figure.includes('<figure class="chart-figure chart-kind-area" data-chart=\'{"id":"host-dead-example-series"'));
  assert.ok(figure.includes('data-chart-id="host-dead-example-series" data-chart-range="30" data-chart-mode="light"'));
  assert.ok(figure.includes('<svg class="chart-svg"'));
  assert.equal((figure.match(/button type="button" class="chart-range-button/g) || []).length, 3);
  assert.ok(figure.includes('data-chart-range="30">30d'));
  assert.ok(figure.includes('class="chart-range-button active" data-chart-range="30"'));
  assert.ok(figure.includes('<figcaption class="chart-caption" data-chart-caption>Sep 29 05:00 · Extracted 0 · Bear 0 · Upcoming 0</figcaption>'));
  assert.ok(figure.includes('aspect-ratio: 360 / 190'));
  const json = /data-chart='([^']*)'/.exec(figure)[1];
  assert.deepEqual(JSON.parse(json.replace(/&amp;/g, '&')), spec, 'the embedded spec round-trips');

  const pending = MetricsSections.buildChartFigureHtml(spec, { mode: 'dark', render: false, follows: 'other-chart' });
  assert.ok(pending.includes('data-chart-pending="1"') && pending.includes('data-chart-follows="other-chart"'));
  assert.ok(!pending.includes('<svg') && !pending.includes('chart-range-button'), 'pending figures carry no svg, followers no toggle');
  assert.equal(MetricsSections.buildChartFigureHtml(null), '');
  assert.ok(!MetricsSections.createChartRenderer.toString().includes('</script'), 'renderer source is safe to inline');
  assert.deepEqual(MetricsSections.CHART_RANGES.map(item => item.key), ['7', '30', 'all']);
  ['buildSourcesOverviewChartSpec', 'buildSitesAnsweringChartSpec', 'buildHostSeriesChartSpec', 'buildHostPagesChartSpec', 'buildHostProposalsChartSpec', 'buildQualityChartSpec', 'buildAiTimeChartSpec', 'buildChartFigureHtml', 'createChartRenderer'].forEach(name => {
    assert.equal(typeof MetricsSections[name], 'function', name);
    assert.equal(typeof require('./metrics-sections')[name], 'function', name);
  });
});

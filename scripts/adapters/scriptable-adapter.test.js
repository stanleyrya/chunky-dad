const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Headless load of the Scriptable adapter: stub the Scriptable globals the
// module touches at require time (importModule, FileManager) so the pure
// HTML-builder methods can be exercised under Node. Calendar/Device carry
// minimal stubs for generateRichHTML; WebView is NOT stubbed on purpose —
// the methods under test must never present UI.
// ---------------------------------------------------------------------------
global.importModule = (name) => require(path.join(__dirname, '..', name));
global.Calendar = { forEvents: async () => [] };
global.Device = { isUsingDarkAppearance: () => false };

const fileManagerStub = {
  documentsDirectory: () => '/tmp/chunky-dad-adapter-test',
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

const { ScriptableAdapter } = require('./scriptable-adapter');

const LOG_FIXTURE = [
  '2026-07-12T03:00:00.000Z [INFO] SYSTEM: Bearracuda → bearracuda (1 URL): https://bearracuda.com/',
  '2026-07-12T03:00:01.000Z [INFO] SYSTEM: Classified https://bearracuda.com/ → eventlist',
  '2026-07-12T03:00:02.000Z [INFO] SYSTEM: Parsed https://bearracuda.com/ → 0 events, 2 links',
  '2026-07-12T03:00:03.000Z [INFO] SYSTEM: Following 2 discovered URLs → 2 unique for crawl depth 1',
  '2026-07-12T03:00:04.000Z [INFO] SYSTEM: Crawling 2 discovered URLs (depth 1/1)',
  '2026-07-12T03:00:05.000Z [INFO] SYSTEM: Classified https://bearracuda.com/events/atlanta → event',
  '2026-07-12T03:00:06.000Z [INFO] 🤖 AI Web: Running AI extraction for https://bearracuda.com/events/atlanta (12 fields)',
  '2026-07-12T03:00:07.000Z [INFO] 🤖 AI Web: Sending AI request (extraction pass) to http://rybook.example:8000/v1/chat/completions — model: qwen, provider: openai, prompt: 4000 chars',
  '2026-07-12T03:00:07.100Z [DEBUG] 🤖 AI Web: Full prompt (extraction pass) (4000 chars)',
  'SECRET PAYLOAD BODY that must never be embedded in the display HTML',
  '2026-07-12T03:00:09.000Z [INFO] 🤖 AI Web: AI request (extraction pass) succeeded in 2000ms — response: 400 chars',
  '2026-07-12T03:00:10.000Z [INFO] SYSTEM: Parsed https://bearracuda.com/events/atlanta → 1 event',
  '2026-07-12T03:00:11.000Z [INFO] SYSTEM: Classified https://bearracuda.com/events/seattle → event',
  '2026-07-12T03:00:12.000Z [INFO] SYSTEM: Parsed https://bearracuda.com/events/seattle → 1 event',
  '2026-07-12T03:00:13.000Z [INFO] SYSTEM: Event filtering complete: 2 → 2 future → 2 bear → 2 final',
  '2026-07-12T03:00:14.000Z [INFO] 🤝 AI MERGE: "BEARRACUDA: Atlanta" field=bar chose scraped ("Heretic") over existing ("Heretic Atlanta") — fresher source',
  '2026-07-12T03:00:15.000Z [WARN] 🤖 AI Web: Dropped 1 field(s) lacking source evidence: shortName'
].join('\n');

function buildResultsStub() {
  return {
    analyzedEvents: [
      {
        title: 'Bear <b>Night</b>',
        _action: 'new',
        startDate: '2026-08-01T02:00:00.000Z'
      },
      {
        title: 'BEARRACUDA: Atlanta',
        _action: 'merge',
        _analysis: { reason: 'matched existing calendar event' }
      }
    ]
  };
}

function buildAdapter() {
  return new ScriptableAdapter({ cities: {} });
}

test('buildRunInsightSectionsHtml renders both collapsed sections from a run log', () => {
  const adapter = buildAdapter();
  const insights = adapter.buildRunInsightsFromLogText(LOG_FIXTURE);
  assert.equal(insights.available, true);

  const html = adapter.buildRunInsightSectionsHtml(insights, buildResultsStub());

  // Both sections exist, with <details> collapsed by default
  assert.ok(html.includes('What Happened'));
  assert.ok(html.includes('What We Did'));
  assert.equal((html.match(/<details class="log-details">/g) || []).length, 2);
  assert.ok(!html.includes('<details open'));

  // Crawl tree content: source, root and followed pages
  assert.ok(html.includes('Bearracuda (bearracuda parser)'));
  assert.ok(html.includes('https://bearracuda.com/ [eventlist]'));
  assert.ok(html.includes('├─ https://bearracuda.com/events/atlanta'));

  // Decisions: structured event actions + log-derived merge reason
  assert.ok(html.includes('NEW → CREATE: &quot;Bear &lt;b&gt;Night&lt;/b&gt;&quot;'));
  assert.ok(html.includes('MERGE → UPDATE: &quot;BEARRACUDA: Atlanta&quot; — matched existing calendar event'));
  assert.ok(html.includes('fresher source'));
  assert.ok(html.includes('Dropped 1 field(s)'));
});

test('run-insight HTML escapes markup and never embeds AI payload bodies', () => {
  const adapter = buildAdapter();
  const insights = adapter.buildRunInsightsFromLogText(LOG_FIXTURE);
  const html = adapter.buildRunInsightSectionsHtml(insights, buildResultsStub());

  assert.ok(!html.includes('SECRET PAYLOAD BODY'));
  assert.ok(!html.includes('<b>Night</b>'));
});

test('saved run without a log file renders sections with a graceful note', () => {
  const adapter = buildAdapter();
  const insights = adapter.loadRunInsightsForDisplay(
    { _isDisplayingSavedRun: true },
    { runId: '20260101-000000', exists: false, reason: 'missing-log-file' }
  );

  assert.equal(insights.available, false);
  assert.ok(insights.reason.includes('Log not found for run 20260101-000000'));

  const html = adapter.buildRunInsightSectionsHtml(insights, buildResultsStub());
  assert.ok(html.includes('What Happened'));
  assert.ok(html.includes('What We Did'));
  assert.ok(html.includes('Log not found for run 20260101-000000'));
  // Structured event actions still render from the saved-run JSON
  assert.ok(html.includes('NEW → CREATE: &quot;Bear &lt;b&gt;Night&lt;/b&gt;&quot;'));
});

test('saved run with a log file feeds its full text through the summary', () => {
  const adapter = buildAdapter();
  const insights = adapter.loadRunInsightsForDisplay(
    { _isDisplayingSavedRun: true },
    { runId: '20260101-000000', exists: true, fullText: LOG_FIXTURE, text: '' }
  );

  assert.equal(insights.available, true);
  assert.equal(insights.summary.crawl.length, 1);
  assert.equal(insights.summary.crawl[0].roots[0].children.length, 2);
});

// ---------------------------------------------------------------------------
// Metrics 2.0: per-run signals block + results-UI health badge
// ---------------------------------------------------------------------------

test('buildMetricsRecord emits the additive signals block from the run log + results', () => {
  const adapter = buildAdapter();

  // Feed guard/AI/arbitration/funnel lines through the console capture — the
  // exact path production lines take into the adapter's in-memory FileLogger.
  console.log('SYSTEM: Bearracuda → bearracuda (1 URL): https://bearracuda.com/');
  console.log('🤖 AI Web: Sending AI request (extraction pass) to http://rybook.example:8000/v1/chat/completions — model: qwen, provider: openai, prompt: 4000 chars');
  console.log('🤖 AI Web: AI request (extraction pass) succeeded in 2000ms — response: 400 chars');
  console.log('🤖 AI Web: Rejecting bar "BEARRACUDA" from best meta 1/1 pass — matches page organizer/brand; keeping field open for later passes');
  console.warn('🗺️ OpenStreetMapNormalizer: Geocode for "922 E. BURNSIDE" resolved outside event city "portland" ("Denver, Colorado") — ignoring coordinates');
  console.log('🤝 AI MERGE: "BEARRACUDA: Portland" field=bar chose calendar ("Sanctuary") over scraped ("BEARRACUDA") — venue, not the organizer');
  console.log('SYSTEM: Event filtering complete: 18 → 16 future → 16 bear → 9 final');
  console.log('🔄 SharedCore: Deduplicated 16 → 9 (removed 7)');

  const results = {
    savedRunId: '20260713-090000',
    errors: [],
    totalEvents: 18,
    bearEvents: 9,
    duplicatesRemoved: 7,
    parserResults: [],
    analyzedEvents: [
      {
        title: 'BEARRACUDA: Portland',
        bar: 'Sanctuary',
        coordinates: { lat: 45.52, lng: -122.65 },
        startDate: '2026-08-01T02:00:00.000Z',
        endDate: '2026-08-01T06:00:00.000Z'
      },
      { title: 'No-venue event', startDate: '2026-08-02T02:00:00.000Z' }
    ]
  };

  const record = adapter.buildMetricsRecord(results);

  // Existing schema unchanged (additive record)
  assert.equal(record.schema_version, 2);
  assert.equal(record.run_id, '20260713-090000');
  assert.equal(record.totals.total_events, 18);
  assert.equal(record.totals.final_bear_events, 9);
  assert.ok(record.actions);
  assert.ok(record.calendar_actions);

  // New signals block: aggregates only
  const signals = record.signals;
  assert.ok(signals, 'signals block missing from metrics record');
  assert.equal(signals.ai.requests, 1);
  assert.equal(signals.ai.failures, 0);
  assert.deepEqual(signals.ai.byPass.extraction, { n: 1, ms: 2000 });
  assert.equal(signals.guards.brandBarRejected, 1);
  assert.equal(signals.guards.geocodeRejected, 1);
  assert.equal(signals.guards.taglineRejected, 0);
  assert.deepEqual(signals.arbitration, {
    conflicts: 1, calendarPicks: 1, scrapedPicks: 0, fallbacks: 0
  });
  assert.deepEqual(signals.funnel, {
    found: 18, future: 16, bear: 16, final: 9, duplicatesRemoved: 7
  });
  assert.deepEqual(signals.quality, {
    events: 2, withBar: 1, withCoords: 1, withEndDuration: 1
  });

  // Compactness: no payload-sized strings sneak into the record
  assert.ok(JSON.stringify(signals).length < 2000);
});

test('results-UI header contains the one-line run-health badge', async () => {
  const adapter = buildAdapter();
  // The shared logger already carries a geocode rejection from the metrics
  // test above; the badge must surface it as a warning.
  const html = await adapter.generateRichHTML({
    totalEvents: 1,
    bearEvents: 1,
    calendarEvents: 0,
    errors: [],
    analyzedEvents: [],
    parserResults: []
  });

  const badgeMatch = html.match(/<div class="header-health-badge (ok|warn)">([^<]*)<\/div>/);
  assert.ok(badgeMatch, 'health badge missing from results header');
  assert.equal(badgeMatch[1], 'warn');
  assert.ok(badgeMatch[2].startsWith('🟡'));
  assert.ok(badgeMatch[2].includes('geocode rejected'));
  // Surgical: exactly one badge element, no extra structure added to the UI
  assert.equal((html.match(/<div class="header-health-badge/g) || []).length, 1);
});

test('long crawl lists are capped in the rendered HTML', () => {
  const adapter = buildAdapter();
  const manyPages = [
    '2026-07-12T05:00:00.000Z [INFO] SYSTEM: Big source → ai-web (1 URL): https://big.example/',
    '2026-07-12T05:00:01.000Z [INFO] SYSTEM: Parsed https://big.example/ → 0 events, 80 links',
    '2026-07-12T05:00:02.000Z [INFO] SYSTEM: Crawling 80 discovered URLs (depth 1/1)'
  ];
  for (let i = 0; i < 80; i += 1) {
    manyPages.push(`2026-07-12T05:00:03.000Z [INFO] SYSTEM: Parsed https://big.example/page-${i} → 1 event`);
  }
  const insights = adapter.buildRunInsightsFromLogText(manyPages.join('\n'));
  const html = adapter.buildRunInsightSectionsHtml(insights, buildResultsStub());

  assert.ok(html.includes('more page(s) not shown'));
  assert.ok(!html.includes('page-79'));
});

// ---------------------------------------------------------------------------
// Per-event provenance section (event-provenance.js glue)
// ---------------------------------------------------------------------------

test('event cards embed the collapsed provenance section with the export control', () => {
  const adapter = buildAdapter();
  const event = {
    title: 'BEARRACUDA: Atlanta',
    startDate: '2026-08-01T02:00:00.000Z',
    endDate: '2026-08-01T06:00:00.000Z',
    url: 'https://bearracuda.com/events/atlanta',
    source: 'bearracuda',
    _action: 'merge',
    _analysis: { action: 'merge' },
    _original: {
      scraper: { title: 'BEARRACUDA: Atlanta', endDate: '2026-08-01T04:00:00.000Z' },
      calendar: { title: 'Bearracuda Atlanta', endDate: '2026-08-01T06:00:00.000Z' },
      merged: {},
      aiArbitration: { arbitrated: ['endDate'], fallbacks: [] }
    },
    _mergeDecisions: [{
      field: 'endDate',
      existingValue: '2026-08-01T06:00:00.000Z',
      newValue: '2026-08-01T04:00:00.000Z',
      chosenValue: '2026-08-01T06:00:00.000Z',
      reason: 'calendar end matches doors-close time',
      source: 'ai'
    }]
  };

  const card = adapter.generateEventCard(event, { runId: '20260713-090000' });

  assert.ok(card.includes('provenance-details'));
  assert.ok(card.includes('🔍 Provenance'));
  assert.ok(card.includes('Parser: bearracuda'));
  assert.ok(card.includes('AI: calendar end matches doors-close time'));
  assert.ok(card.includes('exportProvenanceIssue(this)'));

  // The embedded export payload carries the run id passed through by the card
  const payloadMatch = card.match(/data-payload="([^"]*)"/);
  assert.ok(payloadMatch, 'export payload missing from card');
  const payload = JSON.parse(decodeURIComponent(payloadMatch[1]));
  assert.equal(payload.runId, '20260713-090000');
  assert.equal(payload.mergeDecisions.length, 1);
});

test('a provenance build failure degrades to an empty section, never blocks the card', () => {
  const adapter = buildAdapter();
  const hostile = { title: 'Bad Event', startDate: '2026-08-01T02:00:00.000Z' };
  Object.defineProperty(hostile, '_mergeDecisions', {
    get() { throw new Error('boom'); },
    enumerable: true
  });

  // The adapter wrapper swallows the throw and returns an empty section —
  // the card build continues without provenance instead of dying.
  assert.equal(adapter.buildEventProvenanceHtml(hostile), '');
});

test('generateRichHTML defines the exportProvenanceIssue page handler once', async () => {
  const adapter = buildAdapter();
  const html = await adapter.generateRichHTML({
    totalEvents: 1,
    bearEvents: 1,
    calendarEvents: 0,
    errors: [],
    analyzedEvents: [{ title: 'Bear Night', startDate: '2026-08-01T02:00:00.000Z', _action: 'new' }],
    parserResults: []
  });

  assert.equal((html.match(/function exportProvenanceIssue\(/g) || []).length, 1);
  assert.ok(html.includes('provenance-details'));
  assert.ok(html.includes('No provenance recorded'));
});

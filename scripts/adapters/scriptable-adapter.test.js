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

// ---------------------------------------------------------------------------
// End-of-run cache pruning: cleanupOldFiles recursion + retention config
// ---------------------------------------------------------------------------

test('cleanupOldFiles recurses into nested cache host dirs and reports the pruned count', async () => {
  const adapter = buildAdapter();
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const base = '/tmp/chunky-dad-adapter-test/chunky-dad-scraper/storage/ocr';
  const dirs = {
    [base]: ['host-a', 'host-b'],
    [`${base}/host-a`]: ['stale.json', 'fresh.json'],
    [`${base}/host-b`]: ['ancient.json']
  };
  // Touch-on-hit rewrites entries on use, so mtime IS last use (within the
  // 7-day rate limit) — the pruner never needs to read payloads
  const mtimes = {
    [`${base}/host-a/stale.json`]: new Date(now - 120 * DAY),
    [`${base}/host-a/fresh.json`]: new Date(now - 5 * DAY),
    [`${base}/host-b/ancient.json`]: new Date(now - 400 * DAY)
  };
  const removed = [];
  adapter.fm = {
    documentsDirectory: () => '/tmp/chunky-dad-adapter-test',
    joinPath: (a, b) => `${a}/${b}`,
    fileExists: (p) => Boolean(dirs[p]) || Boolean(mtimes[p]),
    isDirectory: (p) => Boolean(dirs[p]),
    listContents: (p) => dirs[p] || [],
    modificationDate: (p) => mtimes[p] || null,
    remove: (p) => removed.push(p)
  };

  const count = await adapter.cleanupOldFiles('chunky-dad-scraper/storage/ocr', {
    maxAgeDays: 97, // 90d retention + 7d touch-interval grace
    recurse: true
  });

  assert.equal(count, 2);
  assert.deepEqual(removed.sort(), [
    `${base}/host-a/stale.json`,
    `${base}/host-b/ancient.json`
  ]);
});

test('getOcrCacheRetentionDays reads config.ocr.cacheRetentionDays with a 90d default', () => {
  assert.equal(buildAdapter().getOcrCacheRetentionDays(), 90);
  assert.equal(
    new ScriptableAdapter({ cities: {}, ocr: { cacheRetentionDays: 30 } }).getOcrCacheRetentionDays(),
    30
  );
  assert.equal(
    new ScriptableAdapter({ cities: {}, ocr: { cacheRetentionDays: 'bogus' } }).getOcrCacheRetentionDays(),
    90
  );
});

// ---------------------------------------------------------------------------
// Learned dead-end store persistence (dead-ends.json)
// ---------------------------------------------------------------------------

function createDeadEndFmStub() {
  const files = new Map();
  return {
    files,
    documentsDirectory: () => '/tmp/chunky-dad-adapter-test',
    joinPath: (a, b) => `${a}/${b}`,
    fileExists: (p) => files.has(p),
    isDirectory: () => false,
    createDirectory: () => {},
    readString: (p) => (files.has(p) ? files.get(p) : null),
    writeString: (p, s) => { files.set(p, s); },
    downloadFileFromiCloud: async () => {}
  };
}

test('loadDeadEnds/saveDeadEnds round-trip through dead-ends.json', async () => {
  const adapter = buildAdapter();
  adapter.fm = createDeadEndFmStub();

  // Missing file → empty store, never throws
  assert.deepEqual(await adapter.loadDeadEnds(), {});

  const store = {
    'https://site.example/dead': {
      firstSeen: '2026-06-01T00:00:00.000Z',
      lastSeen: '2026-07-01T00:00:00.000Z',
      misses: 3
    }
  };
  await adapter.saveDeadEnds(store);
  assert.ok(adapter.fm.files.has(adapter.getDeadEndsFilePath()), 'store written to dead-ends.json in the scraper dir');
  assert.deepEqual(await adapter.loadDeadEnds(), store);
});

test('loadDeadEnds tolerates corrupt or wrong-shaped files with an empty store', async () => {
  const adapter = buildAdapter();
  adapter.fm = createDeadEndFmStub();
  const path = adapter.getDeadEndsFilePath();

  adapter.fm.files.set(path, '{"https://x.example": {broken json');
  assert.deepEqual(await adapter.loadDeadEnds(), {}, 'parse failure → empty store');

  adapter.fm.files.set(path, '["not", "an", "object"]');
  assert.deepEqual(await adapter.loadDeadEnds(), {}, 'array payload → empty store');

  adapter.fm.files.set(path, 'null');
  assert.deepEqual(await adapter.loadDeadEnds(), {}, 'null payload → empty store');

  // saveDeadEnds refuses non-object stores instead of clobbering the file
  adapter.fm.files.delete(path);
  await adapter.saveDeadEnds(null);
  await adapter.saveDeadEnds(['nope']);
  assert.ok(!adapter.fm.files.has(path));
});

// ---------------------------------------------------------------------------
// Suggested-config tab in the URL Discovery UI section
// ---------------------------------------------------------------------------

test('generateDiscoverySection renders a default-active Suggested Config tab with a copy button', () => {
  const adapter = buildAdapter();
  const suggested = '📋 SUGGESTED CONFIG for "New Site" — paste into parsers[] in scraper-input.js:\n{\n  name: "New Site",\n  urls: ["https://x.example"],\n},';
  const results = {
    parserResults: [{
      name: 'New Site',
      discoveryOnly: true,
      mermaidGraph: 'graph TD;A-->B;',
      asciiTree: 'A\n└─ B',
      discoveryTree: { rootUrls: ['https://x.example'], edges: [], allNodes: ['https://x.example'], segmentsByUrl: {} },
      suggestedConfig: suggested
    }]
  };

  const html = adapter.generateDiscoverySection(results);
  assert.ok(html.includes('📋 Suggested Config'), 'suggested-config tab button rendered');
  assert.ok(html.includes(`class="disc-tab-btn disc-tab-active" data-tab="suggested_New_Site_0"`),
    'suggested tab is the default-active tab');
  assert.ok(html.includes(`class="disc-tab-btn" data-tab="mermaid_New_Site_0"`),
    'mermaid tab is no longer default-active');
  assert.ok(html.includes('📋 Copy Config'), 'copy button rendered');

  // The copy payload starts at "{" — the log header line is stripped so the
  // copied text pastes straight into parsers[].
  const payloadMatch = html.match(/data-encoded="([^"]*)"[^>]*>📋 Copy Config/);
  assert.ok(payloadMatch, 'copy button carries an encoded payload');
  const decoded = decodeURIComponent(payloadMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  assert.ok(decoded.startsWith('{'), `payload starts at the config object, got: ${decoded.slice(0, 30)}`);
  assert.ok(!decoded.includes('📋'), 'log header line stripped from the payload');

  // Mermaid panel is hidden by default when the suggested tab is present
  assert.ok(html.includes(`<div id="mermaid_New_Site_0" class="disc-tab-panel" style="display:none">`));
});

test('generateDiscoverySection keeps Mermaid default-active when no suggested config exists', () => {
  const adapter = buildAdapter();
  const results = {
    parserResults: [{
      name: 'Old Run',
      discoveryOnly: true,
      mermaidGraph: 'graph TD;A-->B;',
      asciiTree: 'A',
      discoveryTree: { rootUrls: [], edges: [], allNodes: [], segmentsByUrl: {} }
    }]
  };
  const html = adapter.generateDiscoverySection(results);
  assert.ok(!html.includes('📋 Suggested Config'), 'no suggested tab without data');
  assert.ok(html.includes(`class="disc-tab-btn disc-tab-active" data-tab="mermaid_Old_Run_0"`), 'mermaid stays the default tab');
  assert.ok(html.includes(`<div id="mermaid_Old_Run_0" class="disc-tab-panel">`), 'mermaid panel visible');
});

// ---------------------------------------------------------------------------
// Calendar reviewer: calendar filtering, apply-finding writes, findings UI
// ---------------------------------------------------------------------------

test('getReviewCalendars keeps writable chunky-dad calendars by default and honors explicit titles', async () => {
  const adapter = buildAdapter();
  const calendars = [
    { title: 'chunky-dad-nyc', allowsContentModifications: true },
    { title: 'chunky-dad-seattle', allowsContentModifications: false },
    { title: 'Personal', allowsContentModifications: true }
  ];
  const originalForEvents = global.Calendar.forEvents;
  global.Calendar.forEvents = async () => calendars;
  try {
    const auto = await adapter.getReviewCalendars([]);
    assert.deepEqual(auto.map((calendar) => calendar.title), ['chunky-dad-nyc'],
      'read-only and non-chunky-dad calendars are excluded by default');

    const explicit = await adapter.getReviewCalendars(['Personal', 'chunky-dad-seattle']);
    assert.deepEqual(explicit.map((calendar) => calendar.title), ['chunky-dad-seattle', 'Personal'],
      'explicit titles override the default filter');
  } finally {
    global.Calendar.forEvents = originalForEvents;
  }
});

test('applyReviewFinding mutates only the proposed fields on the stubbed CalendarEvent', async () => {
  const adapter = buildAdapter();
  const originalNotes = 'bar: STATION 4\naddress: 100 Old Rd, Dallas\nwebsite: https://x.example';
  let saves = 0;
  const stubEvent = {
    title: 'FURBALL',
    location: '1, 2',
    notes: originalNotes,
    save: async () => { saves += 1; }
  };
  adapter.reviewEventIndex = { 'evt-1': stubEvent };

  // Location proposal: only the location field changes
  const pinResult = await adapter.applyReviewFinding({
    id: 'evt-1', eventTitle: 'FURBALL', calendarTitle: 'chunky-dad-dallas',
    proposed: { location: '32.810535, -96.8110709' }
  });
  assert.equal(pinResult.success, true);
  assert.deepEqual(pinResult.appliedFields, ['location']);
  assert.equal(stubEvent.location, '32.810535, -96.8110709');
  assert.equal(stubEvent.notes, originalNotes, 'notes untouched by a location-only fix');
  assert.equal(stubEvent.title, 'FURBALL');
  assert.equal(saves, 1);

  // Address proposal: only the address line inside notes is rewritten
  await adapter.applyReviewFinding({
    id: 'evt-1', eventTitle: 'FURBALL', calendarTitle: 'chunky-dad-dallas',
    proposed: { address: '3911 Cedar Springs Rd, Dallas, TX 75219' }
  });
  assert.equal(stubEvent.notes,
    'bar: STATION 4\naddress: 3911 Cedar Springs Rd, Dallas, TX 75219\nwebsite: https://x.example');
  assert.equal(stubEvent.location, '32.810535, -96.8110709', 'location untouched by an address-only fix');
  assert.equal(saves, 2);

  // Missing address line is appended; free text in notes survives
  stubEvent.notes = 'Doors at 9pm, no cover\nbar: STATION 4';
  await adapter.applyReviewFinding({
    id: 'evt-1', eventTitle: 'FURBALL', calendarTitle: 'chunky-dad-dallas',
    proposed: { address: '5025 Bowser Ave, Dallas' }
  });
  assert.equal(stubEvent.notes, 'Doors at 9pm, no cover\nbar: STATION 4\naddress: 5025 Bowser Ave, Dallas');

  // Unknown finding id or an empty proposal never saves
  const missing = await adapter.applyReviewFinding({ id: 'nope', proposed: { location: '1, 2' } });
  assert.equal(missing.success, false);
  const empty = await adapter.applyReviewFinding({ id: 'evt-1', proposed: {} });
  assert.equal(empty.success, false);
  assert.equal(saves, 3);
});

function buildReviewFindingsFixture() {
  return [
    {
      id: 'ok-1', calendarTitle: 'chunky-dad-nyc', eventTitle: 'OK Event',
      startDate: '2026-08-01T02:00:00.000Z', check: 'geocode', status: 'ok',
      current: { location: '40.7, -73.9', address: '123 W 4th St' }, proposed: {},
      detail: 'stored pin matches a fresh geocode of the address'
    },
    {
      id: 'pm-"1"', calendarTitle: 'chunky-dad-nyc', eventTitle: 'Bear <b>Night</b>',
      startDate: '2026-08-02T02:00:00.000Z', check: 'geocode', status: 'pin-moved',
      current: { location: '40.7, -73.9', address: '123 W 4th St' },
      proposed: { location: '40.71, -73.99' }, distanceKm: 1.25,
      detail: 'stored pin is 1.3km from the fresh verified geocode of this address'
    },
    {
      id: 'ma-1', calendarTitle: 'chunky-dad-seattle', eventTitle: 'Pin Only',
      startDate: '2026-08-03T02:00:00.000Z', check: 'geocode', status: 'missing-address',
      current: { location: '47.6, -122.3', address: '' },
      proposed: { address: '1600 Broadway, Seattle' },
      detail: 'pin has no address — reverse-geocoded address proposed'
    },
    {
      id: 'up-1', calendarTitle: 'chunky-dad-seattle', eventTitle: 'Mystery Venue',
      startDate: '2026-08-04T02:00:00.000Z', check: 'geocode', status: 'unpinnable',
      current: { location: '', address: 'Somewhere Nowhere 123' }, proposed: {},
      detail: 'no usable geocoordinate for this address (grade gate/ladder found nothing)'
    }
  ];
}

test('generateReviewHTML renders per-calendar sections, chips, buttons, and escaped payloads', () => {
  const adapter = buildAdapter();
  const html = adapter.generateReviewHTML(buildReviewFindingsFixture());

  // Summary header: events reviewed / ok / needing attention
  assert.ok(html.includes('Calendar Reviewer'));
  assert.ok(html.includes('<span class="stat-value">4</span>'));
  assert.ok(html.includes('<span class="stat-value">1</span>'));
  assert.ok(html.includes('<span class="stat-value">3</span>'));

  // One section per calendar
  assert.ok(html.includes('chunky-dad-nyc'));
  assert.ok(html.includes('chunky-dad-seattle'));

  // OK events collapse into a single expandable line, with no buttons inside
  assert.ok(html.includes('1 event looks right'));
  const okDetails = html.match(/<details class="ok-details">[\s\S]*?<\/details>/);
  assert.ok(okDetails && okDetails[0].includes('OK Event'));
  assert.ok(!okDetails[0].includes('<button'));

  // Status chips are color-coded per status
  assert.ok(html.includes('status-chip status-pin-moved'));
  assert.ok(html.includes('status-chip status-missing-address'));
  assert.ok(html.includes('status-chip status-unpinnable'));

  // Distance badge for pin-moved
  assert.ok(html.includes('1.3 km'));

  // Titles and ids are escaped — raw markup and quotes never leak into the DOM
  assert.ok(!html.includes('<b>Night</b>'));
  assert.ok(html.includes('Bear &lt;b&gt;Night&lt;/b&gt;'));
  assert.ok(html.includes('data-finding-id="pm-&quot;1&quot;"'));

  // Apply buttons only where a proposal exists (pin-moved + missing-address)
  assert.equal((html.match(/class="apply-btn"/g) || []).length, 2);

  // Map links: Apple Maps anchor plus a collapsed OSM iframe that only
  // carries data-src (the frame src is assigned on first expand)
  assert.ok(html.includes('https://maps.apple.com/?ll=40.71,-73.99&amp;q=Bear%20%3Cb%3ENight%3C%2Fb%3E'));
  assert.ok(html.includes('data-src="https://www.openstreetmap.org/export/embed.html?bbox='));
  assert.ok(!/<iframe[^>]* src=/.test(html), 'iframes must stay unloaded until expanded');

  // Sticky footer bulk actions + the native bridge plumbing
  assert.ok(html.includes('Add missing only'));
  assert.ok(html.includes('Apply all'));
  assert.ok(html.includes("applyBulk('missing-only')"));
  assert.ok(html.includes("applyBulk('all')"));
  assert.ok(html.includes('function postReviewAction'));
  assert.ok(html.includes('function markFindingApplied'));

  // Self-contained page: no external scripts or stylesheets
  assert.ok(!html.includes('<link '));
  assert.ok(!/<script[^>]+src=/.test(html));
});

test('selectReviewFindingsForAction resolves single, bulk, and missing-only payloads', () => {
  const adapter = buildAdapter();
  const findings = buildReviewFindingsFixture();

  const single = adapter.selectReviewFindingsForAction({ action: 'apply', id: 'pm-"1"' }, findings);
  assert.deepEqual(single.map((finding) => finding.id), ['pm-"1"']);

  const missingOnly = adapter.selectReviewFindingsForAction({ action: 'apply-bulk', mode: 'missing-only' }, findings);
  assert.deepEqual(missingOnly.map((finding) => finding.id), ['ma-1'],
    'missing-only excludes pin-moved corrections');

  const all = adapter.selectReviewFindingsForAction({ action: 'apply-bulk', mode: 'all' }, findings);
  assert.deepEqual(all.map((finding) => finding.id), ['pm-"1"', 'ma-1'],
    'bulk apply targets every finding with a proposal');

  // Applied findings are never re-applied; proposal-less findings never match
  findings[1]._applied = true;
  assert.deepEqual(adapter.selectReviewFindingsForAction({ action: 'apply', id: 'pm-"1"' }, findings), []);
  assert.deepEqual(adapter.selectReviewFindingsForAction({ action: 'apply', id: 'up-1' }, findings), []);
});

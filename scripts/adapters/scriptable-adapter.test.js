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

const { ScriptableAdapter, FileLogger, getConsoleTee } = require('./scriptable-adapter');

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

// A saved-run render (the heavy path: it is the only one that builds the Run
// Logs section) with the log lookup stubbed to a fixture.
async function renderSavedRunPage(adapter, logInfo) {
  adapter.loadRunLogsForDisplay = async () => logInfo;
  return adapter.generateRichHTML({
    ...buildResultsStub(),
    _isDisplayingSavedRun: true,
    savedRunId: '20260804-125703',
    totalEvents: 2,
    bearEvents: 2,
    calendarEvents: 0,
    errors: [],
    parserResults: []
  });
}

function savedRunLogInfo() {
  const lines = LOG_FIXTURE.split('\n');
  return {
    runId: '20260804-125703',
    exists: true,
    text: LOG_FIXTURE,
    fullText: LOG_FIXTURE,
    totalLines: lines.length,
    shownLines: lines.length,
    truncated: false
  };
}

test('the results page no longer renders the What Happened / What We Did sections', async () => {
  const adapter = buildAdapter();
  const html = await renderSavedRunPage(adapter, savedRunLogInfo());

  assert.ok(!html.includes('What Happened'), 'the crawl-tree section is gone');
  assert.ok(!html.includes('What We Did'), 'the decisions section is gone');
  assert.ok(!html.includes('insight-section'), 'no leftover section markup');

  // The same parsed insights still feed the one-line header health badge —
  // only the two unused sections were cut, not the parsing behind them.
  const insights = adapter.buildRunInsightsFromLogText(LOG_FIXTURE);
  assert.equal(insights.available, true);
  assert.ok(html.includes('header-health-badge'), 'the run-health badge survives');
});

test('the saved-run page never embeds AI payload bodies or the raw log text', async () => {
  const adapter = buildAdapter();
  const html = await renderSavedRunPage(adapter, savedRunLogInfo());

  // The prompt bodies exist for this run — the picker button proves it — but
  // neither the raw nor the URI-encoded form is anywhere in the page.
  assert.ok(html.includes('🤖 AI Prompts'), 'the prompt picker is still offered');
  assert.ok(!html.includes('SECRET PAYLOAD BODY'), 'no raw prompt body');
  assert.ok(!html.includes(encodeURIComponent('SECRET PAYLOAD BODY')), 'no encoded prompt body');
  assert.ok(!html.includes('data-ai-prompts'), 'the prompt payload attribute is gone');
  assert.ok(!html.includes('<pre class="log-output">'), 'the raw log <pre> is gone');
  assert.ok(!html.includes('Classified https://bearracuda.com/'), 'no log lines embedded');
});

test('saved run without a log file still renders the Run Logs section with a graceful note', async () => {
  const adapter = buildAdapter();
  const insights = adapter.loadRunInsightsForDisplay(
    { _isDisplayingSavedRun: true },
    { runId: '20260101-000000', exists: false, reason: 'missing-log-file' }
  );

  assert.equal(insights.available, false);
  assert.ok(insights.reason.includes('Log not found for run 20260101-000000'));

  const html = await renderSavedRunPage(adapter, {
    runId: '20260101-000000',
    exists: false,
    reason: 'missing-log-file'
  });
  assert.ok(html.includes('No log file found for run 20260101-000000'));
  assert.ok(!html.includes('What Happened'));
  assert.ok(!html.includes('What We Did'));
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

test('long crawl lists are capped by the shared summariser the adapter feeds', () => {
  const adapter = buildAdapter();
  const { RunLogSummary } = require('../run-log-summary.js');
  const manyPages = [
    '2026-07-12T05:00:00.000Z [INFO] SYSTEM: Big source → ai-web (1 URL): https://big.example/',
    '2026-07-12T05:00:01.000Z [INFO] SYSTEM: Parsed https://big.example/ → 0 events, 80 links',
    '2026-07-12T05:00:02.000Z [INFO] SYSTEM: Crawling 80 discovered URLs (depth 1/1)'
  ];
  for (let i = 0; i < 80; i += 1) {
    manyPages.push(`2026-07-12T05:00:03.000Z [INFO] SYSTEM: Parsed https://big.example/page-${i} → 1 event`);
  }
  const insights = adapter.buildRunInsightsFromLogText(manyPages.join('\n'));
  const text = RunLogSummary.formatCrawlTreeText(insights.summary.crawl, { maxNodes: 50 });

  assert.ok(text.includes('more page(s) not shown'));
  assert.ok(!text.includes('page-79'));
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

  // Round 4: no separate provenance section — the merge decision's reason
  // renders in the merge comparison table's reason cell, and the export
  // control rides the card actions row.
  assert.ok(!card.includes('provenance-details'));
  assert.ok(!card.includes('🔍 Provenance'));
  assert.ok(card.includes('calendar end matches doors-close time'), 'decision reason in the merge table');
  assert.ok(card.includes('exportProvenanceIssue(this)'));

  // The embedded export payload carries the run id passed through by the card
  const payloadMatch = card.match(/data-payload="([^"]*)"/);
  assert.ok(payloadMatch, 'export payload missing from card');
  const payload = JSON.parse(decodeURIComponent(payloadMatch[1]));
  assert.equal(payload.runId, '20260713-090000');
  assert.equal(payload.mergeDecisions.length, 1);
});

test('a hostile export payload degrades to no control, never blocks the card', () => {
  const adapter = buildAdapter();
  const hostile = { title: 'Bad Event', startDate: '2026-08-01T02:00:00.000Z' };
  Object.defineProperty(hostile, '_mergeDecisions', {
    get() { throw new Error('boom'); },
    enumerable: true
  });

  // The payload builder degrades to an error stub inside the module and the
  // control builder never throws — the card build continues either way, and
  // whatever payload exists is still exportable.
  const control = adapter.buildExportIssueControlHtml(hostile, { runId: 'r1' });
  assert.ok(control.includes('provenance-export-btn'), 'control renders');
  assert.ok(decodeURIComponent(control.match(/data-payload="([^"]*)"/)[1]).includes('boom'),
    'the error stub names the failure instead of copying silence');
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
  // Round 4: the provenance section is dissolved; the handler survives for
  // the export-issue control on the card actions row.
  assert.ok(!html.includes('provenance-details'));
  assert.ok(html.includes('provenance-export-btn'));
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
    },
    // Host-level bot-wall stats section (shared-core's "::hosts" key) must
    // survive the phone round-trip untouched — Mac and phone share this file
    // when the shared storage root is active.
    '::hosts': {
      'wl.eventim.us': {
        firstSeen: '2026-08-15T08:38:09.000Z',
        lastSeen: '2026-08-15T08:38:09.000Z',
        misses: 2,
        lastStatus: 403
      }
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
// Apple reverse-geocode quota hygiene: persistent placemark cache, pacing,
// circuit breaker (2026-07-16 run: ~50 uncached calls in 6 s tripped Apple's
// GLOBAL rate limit and every cross-check silently degraded to 'skipped')
// ---------------------------------------------------------------------------

const CAMP_OUT_PLACEMARK = {
  subThoroughfare: '446',
  thoroughfare: 'Mt Nebo Rd',
  locality: 'East Stroudsburg',
  postalCode: '18301'
};

function buildReverseGeocodeAdapter() {
  const adapter = buildAdapter();
  adapter.fm = createDeadEndFmStub();
  adapter.sleepForReverseGeocode = async () => {};
  return adapter;
}

test('reverseGeocodePlacemark round-trips placemarks through reverse-geocode-cache.json', async () => {
  const adapter = buildReverseGeocodeAdapter();
  let calls = 0;
  global.Location = {
    reverseGeocode: async () => { calls += 1; return [CAMP_OUT_PLACEMARK]; }
  };
  try {
    const first = await adapter.reverseGeocodePlacemark(41.0219799, -75.1167816);
    assert.deepEqual(first, CAMP_OUT_PLACEMARK);
    assert.equal(calls, 1);

    const cachePath = adapter.getReverseGeocodeCacheFilePath();
    assert.ok(adapter.fm.files.has(cachePath), 'placemark persisted to reverse-geocode-cache.json');
    const stored = JSON.parse(adapter.fm.files.get(cachePath));
    assert.deepEqual(stored['41.02198,-75.11678'].placemark, CAMP_OUT_PLACEMARK);
    assert.ok(Number.isFinite(stored['41.02198,-75.11678'].ts), 'entries carry a timestamp for TTL pruning');

    // A fresh adapter (a later run) reads the disk cache instead of Apple
    const laterRun = buildReverseGeocodeAdapter();
    laterRun.fm = adapter.fm;
    const second = await laterRun.reverseGeocodePlacemark(41.0219799, -75.1167816);
    assert.deepEqual(second, CAMP_OUT_PLACEMARK);
    assert.equal(calls, 1, 'a disk-cache hit spends no Apple quota');
  } finally {
    delete global.Location;
  }
});

test('reverse geocode disk cache tolerates corrupt files, prunes stale entries, and never persists nulls', async () => {
  const adapter = buildReverseGeocodeAdapter();
  const cachePath = adapter.getReverseGeocodeCacheFilePath();
  // Corrupt file → empty cache, never throws; a stale entry rides along to
  // prove the TTL prune on the next save.
  adapter.fm.files.set(cachePath, '{"41.00000,-75.00000": {broken json');
  let calls = 0;
  global.Location = {
    reverseGeocode: async (lat) => {
      calls += 1;
      return lat < 41 ? [] : [CAMP_OUT_PLACEMARK]; // 40.x → no placemark
    }
  };
  try {
    assert.equal(await adapter.reverseGeocodePlacemark(40.7, -73.9), null, 'corrupt cache degrades to a live lookup');
    assert.equal(calls, 1);
    assert.equal(adapter.fm.files.get(cachePath), '{"41.00000,-75.00000": {broken json',
      'a null result never writes the cache file');
    assert.equal(await adapter.reverseGeocodePlacemark(40.7, -73.9), null);
    assert.equal(calls, 1, 'null results stay memoized in memory for the run');

    // Seed a stale entry in the loaded cache, then earn a success: the save
    // prunes anything past the ~30-day TTL.
    adapter.reverseGeocodeDiskCache['40.00000,-74.00000'] = {
      placemark: { locality: 'Stale Town' },
      ts: Date.now() - 31 * 24 * 60 * 60 * 1000
    };
    await adapter.reverseGeocodePlacemark(41.0219799, -75.1167816);
    const stored = JSON.parse(adapter.fm.files.get(cachePath));
    assert.deepEqual(Object.keys(stored), ['41.02198,-75.11678'],
      'stale entries pruned on save; nulls absent');
  } finally {
    delete global.Location;
  }
});

test('circuit breaker stops native reverse geocoding after 3 consecutive failures and logs once', async () => {
  const adapter = buildReverseGeocodeAdapter();
  let attempts = 0;
  global.Location = {
    reverseGeocode: async () => {
      attempts += 1;
      throw new Error('limited on how many reverse-geocoding requests');
    }
  };
  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  try {
    for (let i = 0; i < 5; i += 1) {
      assert.equal(await adapter.reverseGeocodePlacemark(40 + i, -73), null);
    }
  } finally {
    console.log = originalLog;
    delete global.Location;
  }
  assert.equal(attempts, 3, 'the breaker opens after the third failure — later lookups never call Apple');
  assert.equal(
    logLines.filter((line) => line.includes(
      'Apple reverse geocoding unavailable after 3 consecutive failures — skipping remaining lookups this run'
    )).length,
    1,
    'the breaker line is logged exactly once'
  );
  assert.equal(
    logLines.filter((line) => line.includes('Native reverse geocode failed for')).length,
    3,
    'the per-attempt failure line keeps its shape for attempts that do happen'
  );
});

test('a success between failures resets the consecutive-failure count', async () => {
  const adapter = buildReverseGeocodeAdapter();
  let attempts = 0;
  global.Location = {
    reverseGeocode: async () => {
      attempts += 1;
      if (attempts === 3) return [CAMP_OUT_PLACEMARK];
      throw new Error('rate limited');
    }
  };
  try {
    await adapter.reverseGeocodePlacemark(40.1, -73); // fail 1
    await adapter.reverseGeocodePlacemark(40.2, -73); // fail 2
    await adapter.reverseGeocodePlacemark(40.3, -73); // success → reset
    await adapter.reverseGeocodePlacemark(40.4, -73); // fail 1 again
    assert.equal(await adapter.reverseGeocodePlacemark(40.5, -73), null);
    assert.equal(attempts, 5, 'the breaker never opened');
    assert.notEqual(adapter.reverseGeocodeCircuitOpen, true);
  } finally {
    delete global.Location;
  }
});

test('reverse geocode pacing waits ~500ms between actual Apple calls but never for cache hits', async () => {
  const adapter = buildAdapter();
  adapter.fm = createDeadEndFmStub();
  const sleeps = [];
  adapter.sleepForReverseGeocode = async (delayMs) => { sleeps.push(delayMs); };
  let calls = 0;
  global.Location = {
    reverseGeocode: async () => { calls += 1; return [CAMP_OUT_PLACEMARK]; }
  };
  const realNow = Date.now;
  Date.now = () => 1752600000000; // frozen clock: back-to-back calls are 0ms apart
  try {
    await adapter.reverseGeocodePlacemark(40.7, -73.9);
    assert.deepEqual(sleeps, [], 'the first call never waits');

    await adapter.reverseGeocodePlacemark(40.8, -73.8);
    assert.deepEqual(sleeps, [500], 'an immediate second call waits the full spacing');

    await adapter.reverseGeocodePlacemark(40.7, -73.9); // in-memory hit
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [500], 'cache hits never wait');
  } finally {
    Date.now = realNow;
    delete global.Location;
  }
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
  // A location fix now also stamps pin provenance in notes. This finding carries
  // no source/grade, so it defaults to geocoded-approx; only the pinSource line
  // is added — the rest of the notes are untouched.
  assert.equal(stubEvent.notes,
    originalNotes + '\npinSource: geocoded-approx',
    'location fix stamps pinSource but leaves other notes untouched');
  assert.equal(stubEvent.title, 'FURBALL');
  assert.equal(saves, 1);

  // Address proposal: the address line inside notes is rewritten and the
  // reverse-geocoded address is labeled inferred (non-bar-data finding).
  await adapter.applyReviewFinding({
    id: 'evt-1', eventTitle: 'FURBALL', calendarTitle: 'chunky-dad-dallas',
    proposed: { address: '3911 Cedar Springs Rd, Dallas, TX 75219' }
  });
  assert.equal(stubEvent.notes,
    'bar: STATION 4\naddress: 3911 Cedar Springs Rd, Dallas, TX 75219\nwebsite: https://x.example\npinSource: geocoded-approx\naddressSource: inferred');
  assert.equal(stubEvent.location, '32.810535, -96.8110709', 'location untouched by an address-only fix');
  assert.equal(saves, 2);

  // Missing address line is appended; free text in notes survives
  stubEvent.notes = 'Doors at 9pm, no cover\nbar: STATION 4';
  await adapter.applyReviewFinding({
    id: 'evt-1', eventTitle: 'FURBALL', calendarTitle: 'chunky-dad-dallas',
    proposed: { address: '5025 Bowser Ave, Dallas' }
  });
  assert.equal(stubEvent.notes, 'Doors at 9pm, no cover\nbar: STATION 4\naddress: 5025 Bowser Ave, Dallas\naddressSource: inferred');

  // Unknown finding id or an empty proposal never saves
  const missing = await adapter.applyReviewFinding({ id: 'nope', proposed: { location: '1, 2' } });
  assert.equal(missing.success, false);
  const empty = await adapter.applyReviewFinding({ id: 'evt-1', proposed: {} });
  assert.equal(empty.success, false);
  assert.equal(saves, 3);
});

test('applyReviewFinding stamps provenance by finding origin (bar-data curated, geocode graded, reverse inferred)', async () => {
  const adapter = buildAdapter();

  // Bar-data finding applying pin + address → both are curated.
  const barEvent = {
    title: 'MEGAWOOF', location: '', notes: 'bar: EAGLE',
    save: async () => {}
  };
  adapter.reviewEventIndex = { 'bar-1': barEvent };
  await adapter.applyReviewFinding({
    id: 'bar-1', eventTitle: 'MEGAWOOF', calendarTitle: 'chunky-dad-la',
    source: 'bar-data',
    proposed: { location: '34.05, -118.24', address: '4219 Santa Monica Blvd, Los Angeles' }
  });
  assert.ok(barEvent.notes.includes('pinSource: curated'), 'bar-data pin is curated');
  assert.ok(barEvent.notes.includes('addressSource: curated'), 'bar-data address is curated');

  // Geocode finding carrying an exact + passing verdict → geocoded-exact.
  const exactEvent = { title: 'FUR', location: '', notes: 'bar: X', save: async () => {} };
  adapter.reviewEventIndex = { 'geo-1': exactEvent };
  await adapter.applyReviewFinding({
    id: 'geo-1', eventTitle: 'FUR', calendarTitle: 'chunky-dad-nyc',
    grade: 'exact', crossCheck: 'pass',
    proposed: { location: '40.71, -73.99' }
  });
  assert.ok(exactEvent.notes.includes('pinSource: geocoded-exact'), 'exact+pass verdict → geocoded-exact');

  // Reverse-geocoded address (no bar-data source) → addressSource inferred.
  const reverseEvent = { title: 'PIN', location: '47.6, -122.3', notes: '', save: async () => {} };
  adapter.reviewEventIndex = { 'rev-1': reverseEvent };
  await adapter.applyReviewFinding({
    id: 'rev-1', eventTitle: 'PIN', calendarTitle: 'chunky-dad-seattle',
    proposed: { address: '1600 Broadway, Seattle' }
  });
  assert.ok(reverseEvent.notes.includes('addressSource: inferred'), 'reverse-geocoded address is inferred');
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
    },
    {
      id: 'uv-1', calendarTitle: 'chunky-dad-seattle', eventTitle: 'Street Grade Only',
      startDate: '2026-08-05T02:00:00.000Z', check: 'geocode', status: 'unverified',
      current: { location: '47.61, -122.33', address: '3796 Fifth Avenue, Seattle' }, proposed: {},
      detail: 'address only resolves to a street-grade pin — stored pin kept, verify manually'
    }
  ];
}

test('generateReviewHTML renders per-calendar sections, chips, buttons, and escaped payloads', () => {
  const adapter = buildAdapter();
  const html = adapter.generateReviewHTML(buildReviewFindingsFixture());

  // Summary header: events reviewed / ok / needing attention
  assert.ok(html.includes('Calendar Reviewer'));
  assert.ok(html.includes('<span class="stat-value">5</span>'));
  assert.ok(html.includes('<span class="stat-value">1</span>'));
  assert.ok(html.includes('<span class="stat-value">4</span>'));

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
  assert.ok(html.includes('status-chip status-unverified'));
  assert.ok(html.includes('.status-chip.status-unverified'), 'the unverified chip must have its own style');
  assert.ok(html.includes('⚠️ Unverified'));

  // An unverified finding renders its keep-the-pin detail but NO Apply button
  const unverifiedCard = html.match(/<div class="event-card review-card" data-finding-id="uv-1"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(unverifiedCard, 'the unverified finding renders a card');
  assert.ok(html.includes('stored pin kept, verify manually'));

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
  assert.ok(html.includes('function reviewSignal'));
  assert.ok(html.includes('chunkyreview://act'));
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

// ---------------------------------------------------------------------------
// refreshRemoteBars — the combined data/scraper-bars.json is tried FIRST (one
// fetch for every city); the per-city files are the fallback when it fails,
// and the local file backstops both. `combined` is the payload for the
// combined URL — omit it to 404 the combined fetch and exercise the per-city
// fallback path.
// ---------------------------------------------------------------------------

const COMBINED_BARS_URL = 'https://chunky.dad/data/scraper-bars.json';

function buildRemoteBarsAdapter(remoteByCity, combined) {
  const adapter = buildAdapter();
  adapter.getPageCacheConfig = () => ({ enabled: true, ttlDays: 3 });
  adapter.cacheReads = [];
  adapter.cacheWrites = [];
  adapter.fetches = [];
  adapter.readCachedPage = async (url, config) => {
    adapter.cacheReads.push({ url, config });
    return null;
  };
  adapter.writeCachedPage = async (url, responseData, config) => {
    adapter.cacheWrites.push({ url, config });
  };
  adapter.fetchData = async (url, options) => {
    adapter.fetches.push({ url, options });
    if (url === COMBINED_BARS_URL) {
      if (combined === undefined) {
        throw new Error(`HTTP 404 error from ${url}`);
      }
      return { html: typeof combined === 'string' ? combined : JSON.stringify(combined), url, statusCode: 200, headers: {} };
    }
    const cityKey = url.split('/').pop().replace('.json', '');
    if (!(cityKey in remoteByCity)) {
      throw new Error(`HTTP 404 error from ${url}`);
    }
    const body = remoteByCity[cityKey];
    return { html: typeof body === 'string' ? body : JSON.stringify(body), url, statusCode: 200, headers: {} };
  };
  return adapter;
}

test('refreshRemoteBars falls back per city when the combined file 404s, keeping local on failure', async () => {
  const localBars = {
    poconos: [{ name: 'Stale Camp Out', coordinates: '40.0, -75.0' }],
    nyc: [{ name: 'Eagle NYC', coordinates: '40.7517, -74.0043' }],
    seattle: [{ name: 'The Cuff', coordinates: '47.6138, -122.3142' }]
  };
  const adapter = buildRemoteBarsAdapter({
    poconos: [{ name: 'Camp Out', city: 'poconos', address: '446 MT NEBO RD, EAST STROUDSBURG, PA, 18301', coordinates: '41.0219799, -75.1167816' }]
    // combined: 404 → per-city fallback; nyc: 404 (no remote file) → local entry kept
  });

  const result = await adapter.refreshRemoteBars(['poconos', 'nyc', 'bogota'], localBars);

  assert.equal(adapter.fetches[0].url, COMBINED_BARS_URL, 'the combined file is tried first');
  // Union semantics (was: wholesale replace — the replace was the bug that
  // discarded locally curated bars, run 20260724-122902): remote entries
  // lead, local entries with a bar-name key absent from remote survive.
  assert.deepEqual(result.bars.poconos.map((b) => b.name), ['Camp Out', 'Stale Camp Out'],
    'remote city leads; the local-only entry survives the refresh');
  assert.deepEqual(result.bars.nyc.map((b) => b.name), ['Eagle NYC'],
    'fetch failure keeps the local entry');
  assert.deepEqual(result.bars.seattle.map((b) => b.name), ['The Cuff'],
    'cities not under review pass through untouched');
  assert.equal(result.bars.bogota, undefined, 'no remote and no local stays absent');
  assert.deepEqual(result.counts, { remote: 1, local: 1, unavailable: 1 });
});

test('refreshRemoteBars caches bars URLs with a 1-day TTL, separate from the global pageCache TTL', async () => {
  const adapter = buildRemoteBarsAdapter({ poconos: [] }); // combined 404s → per-city fallback
  await adapter.refreshRemoteBars(['poconos'], {});

  assert.equal(adapter.cacheReads.length, 2, 'combined attempt + per-city fallback');
  assert.ok(adapter.cacheReads.every((read) => read.config.ttlDays === 1), 'bars cache reads use the 1-day TTL');
  assert.equal(adapter.cacheWrites.length, 1, 'only the successful per-city fetch writes back');
  assert.equal(adapter.cacheWrites[0].config.ttlDays, 1, 'bars cache writes use the 1-day TTL');
  assert.equal(adapter.fetches.length, 2);
  assert.ok(adapter.fetches.every((fetch) => fetch.options.isCacheableResponse() === false),
    'fetchData is told to keep its global-TTL cache out of the way');

  // A fresh 1-day cache hit spends no fetch at all — the combined file served
  // from cache covers the city on its own.
  adapter.readCachedPage = async () => ({ html: JSON.stringify({ poconos: [{ name: 'Cached Bar' }] }) });
  const cachedRun = await adapter.refreshRemoteBars(['poconos'], {});
  assert.equal(adapter.fetches.length, 2, 'cache hit performs no network fetch');
  assert.deepEqual(cachedRun.bars.poconos.map((b) => b.name), ['Cached Bar']);
});

test('refreshRemoteBars survives invalid JSON and non-array payloads by keeping local data', async () => {
  const adapter = buildRemoteBarsAdapter({
    poconos: 'not json at all',
    nyc: { object: 'not an array' }
  });
  const localBars = { poconos: [{ name: 'Local Camp Out' }] };
  const result = await adapter.refreshRemoteBars(['poconos', 'nyc'], localBars);
  assert.deepEqual(result.bars.poconos.map((b) => b.name), ['Local Camp Out'], 'invalid JSON keeps local');
  assert.equal(result.bars.nyc, undefined, 'non-array payload never becomes bar data');
  assert.deepEqual(result.counts, { remote: 0, local: 1, unavailable: 1 });
});

test('refreshRemoteBars serves requested cities from the combined file with a single fetch', async () => {
  const localBars = {
    nyc: [{ name: 'Stale Eagle' }],
    seattle: [{ name: 'The Cuff' }],
    denver: [{ name: 'Trade' }]
  };
  const adapter = buildRemoteBarsAdapter({}, {
    poconos: [{ name: 'Camp Out' }],
    nyc: [{ name: 'Eagle NYC' }]
  });

  const result = await adapter.refreshRemoteBars(['poconos', 'nyc', 'seattle', 'bogota'], localBars);

  assert.equal(adapter.fetches.length, 1, 'one combined fetch, no per-city fetches');
  assert.equal(adapter.fetches[0].url, COMBINED_BARS_URL);
  assert.deepEqual(result.bars.poconos.map((b) => b.name), ['Camp Out'], 'a combined-only city arrives as-is');
  // Union semantics (was: wholesale replace — the bug that discarded
  // locally curated bars): the combined file leads, but a local entry whose
  // bar-name key is absent from it is appended, not discarded.
  assert.deepEqual(result.bars.nyc.map((b) => b.name), ['Eagle NYC', 'Stale Eagle'],
    'the combined file leads; the local-only entry survives');
  assert.deepEqual(result.bars.seattle.map((b) => b.name), ['The Cuff'],
    'a city absent from the combined file falls back to local');
  assert.equal(result.bars.bogota, undefined, 'neither combined nor local stays absent');
  assert.deepEqual(result.bars.denver.map((b) => b.name), ['Trade'], 'cities not requested pass through untouched');
  assert.deepEqual(result.counts, { remote: 2, local: 1, unavailable: 1 });
});

test('refreshRemoteBars with null cityKeys refreshes ALL cities from the combined file, keeping local-only ones', async () => {
  const localBars = {
    nyc: [{ name: 'Stale Eagle' }],
    'local-only': [{ name: 'Local Hold Out' }]
  };
  const adapter = buildRemoteBarsAdapter({}, {
    nyc: [{ name: 'Eagle NYC' }],
    poconos: [{ name: 'Camp Out' }]
  });

  const result = await adapter.refreshRemoteBars(null, localBars);

  assert.equal(adapter.fetches.length, 1, 'null cityKeys never triggers per-city fetches');
  // Union semantics (was: wholesale replace — the bug that discarded
  // locally curated bars): remote leads, local-only entries survive.
  assert.deepEqual(result.bars.nyc.map((b) => b.name), ['Eagle NYC', 'Stale Eagle'],
    'the combined object leads; the local-only entry survives');
  assert.deepEqual(result.bars.poconos.map((b) => b.name), ['Camp Out'], 'combined-only cities appear');
  assert.deepEqual(result.bars['local-only'].map((b) => b.name), ['Local Hold Out'],
    'local-only cities are kept as fallback entries');
  assert.deepEqual(result.counts, { remote: 2, local: 1, unavailable: 0 });
});

test('refreshRemoteBars with null cityKeys and no combined file returns local bars unchanged', async () => {
  const localBars = { nyc: [{ name: 'Eagle NYC' }], seattle: [{ name: 'The Cuff' }] };
  // combined 404s and there is no city list → the per-city path is impossible
  const adapter = buildRemoteBarsAdapter({});

  const result = await adapter.refreshRemoteBars(null, localBars);

  assert.equal(adapter.fetches.length, 1, 'only the combined fetch is attempted');
  assert.deepEqual(result.bars, localBars);
  assert.deepEqual(result.counts, { remote: 0, local: 2, unavailable: 0 });
});

// ---------------------------------------------------------------------------
// refreshRemotePromoters — one fetch of data/promoters.json (same helper and
// 1-day TTL as bars), union by promoter name key: remote wins per key,
// local-only entries survive. Any failure keeps the local registry.
// ---------------------------------------------------------------------------

const REMOTE_PROMOTERS_URL = 'https://chunky.dad/data/promoters.json';

function buildRemotePromotersAdapter(remotePayload) {
  const adapter = buildAdapter();
  adapter.getPageCacheConfig = () => ({ enabled: true, ttlDays: 3 });
  adapter.cacheReads = [];
  adapter.cacheWrites = [];
  adapter.fetches = [];
  adapter.readCachedPage = async (url, config) => {
    adapter.cacheReads.push({ url, config });
    return null;
  };
  adapter.writeCachedPage = async (url, responseData, config) => {
    adapter.cacheWrites.push({ url, config });
  };
  adapter.fetchData = async (url, options) => {
    adapter.fetches.push({ url, options });
    if (remotePayload === undefined) {
      throw new Error(`HTTP 404 error from ${url}`);
    }
    return {
      html: typeof remotePayload === 'string' ? remotePayload : JSON.stringify(remotePayload),
      url,
      statusCode: 200,
      headers: {}
    };
  };
  return adapter;
}

test('refreshRemotePromoters unions remote and local by promoter name key (remote wins per key)', async () => {
  const localPromoters = [
    { name: 'Bearracuda', shortName: 'STALE' },
    { name: 'Local Only Party', shortName: 'LOCAL' }
  ];
  const adapter = buildRemotePromotersAdapter([
    { name: 'Bearracuda', shortName: 'Bear-rac-uda' },
    { name: 'Goldiloxx', shortName: 'GOLDI-LOXX' }
  ]);

  const result = await adapter.refreshRemotePromoters(localPromoters);

  assert.equal(adapter.fetches.length, 1);
  assert.equal(adapter.fetches[0].url, REMOTE_PROMOTERS_URL);
  assert.deepEqual(result.promoters.map((p) => p.name), ['Bearracuda', 'Goldiloxx', 'Local Only Party'],
    'remote entries lead; the local-only promoter survives the refresh');
  assert.equal(result.promoters[0].shortName, 'Bear-rac-uda', 'remote wins for a shared name key');
  assert.deepEqual(result.counts, { remote: 2, localOnly: 1 });
});

test('refreshRemotePromoters caches the registry URL with a 1-day TTL, separate from the global pageCache TTL', async () => {
  const adapter = buildRemotePromotersAdapter([{ name: 'Bearracuda' }]);
  await adapter.refreshRemotePromoters([]);

  assert.equal(adapter.cacheReads.length, 1);
  assert.equal(adapter.cacheReads[0].config.ttlDays, 1, 'promoters cache reads use the 1-day TTL');
  assert.equal(adapter.cacheWrites.length, 1);
  assert.equal(adapter.cacheWrites[0].config.ttlDays, 1, 'promoters cache writes use the 1-day TTL');
  assert.equal(adapter.fetches[0].options.isCacheableResponse(), false,
    'fetchData is told to keep its global-TTL cache out of the way');

  // A fresh 1-day cache hit spends no fetch at all
  adapter.readCachedPage = async () => ({ html: JSON.stringify([{ name: 'Cached Promoter' }]) });
  const cachedRun = await adapter.refreshRemotePromoters([]);
  assert.equal(adapter.fetches.length, 1, 'cache hit performs no network fetch');
  assert.deepEqual(cachedRun.promoters.map((p) => p.name), ['Cached Promoter']);
});

test('refreshRemotePromoters keeps the local registry on fetch failure, invalid JSON, and non-array payloads', async () => {
  const localPromoters = [{ name: 'Bearracuda', shortName: 'Bear-rac-uda' }];

  const failed = await buildRemotePromotersAdapter(undefined).refreshRemotePromoters(localPromoters);
  assert.deepEqual(failed.promoters, localPromoters, '404/offline keeps local');
  assert.deepEqual(failed.counts, { remote: 0, localOnly: 1 });

  const invalid = await buildRemotePromotersAdapter('not json at all').refreshRemotePromoters(localPromoters);
  assert.deepEqual(invalid.promoters, localPromoters, 'invalid JSON keeps local');

  const nonArray = await buildRemotePromotersAdapter({ object: 'not an array' }).refreshRemotePromoters(localPromoters);
  assert.deepEqual(nonArray.promoters, localPromoters, 'a non-array payload never becomes registry data');
});

// The bars-wiring regression (run 20260724-122902): "Legacy" was curated in
// the local scraper-bars.js, but the remote combined file — served through a
// 1-day cache — didn't have it yet, and the wholesale replace threw the
// local entry away ("Bars data — 23 cities from chunky.dad, 0 from local
// file"). The refresh is now a per-city UNION: remote entries win for a
// shared bar-name key (freshest enrichment), local-only entries survive.
test('refreshRemoteBars union matrix: locally curated bars survive the remote refresh', async () => {
  const localBars = {
    // boston: remote lacks the locally curated Legacy → appended.
    boston: [
      { name: 'Legacy', city: 'boston', address: '79 Warrenton St, Boston, MA 02116' },
      // Same bar-name key as remote "Eagle" ("The " strips) → remote wins.
      { name: 'The Eagle', notes: 'stale local copy' },
      // Nameless entries have no identity key and are skipped.
      { address: 'no name at all' }
    ],
    // seattle: absent from remote → kept as the local fallback city.
    seattle: [{ name: 'The Cuff' }]
  };
  const adapter = buildRemoteBarsAdapter({}, {
    boston: [
      { name: 'Eagle', notes: 'remote enrichment wins for the shared key' },
      { name: 'Alley Cat' }
    ],
    // chicago: remote-only city → arrives untouched.
    chicago: [{ name: 'Metro' }]
  });

  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let result;
  try {
    result = await adapter.refreshRemoteBars(null, localBars);
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(result.bars.boston.map((b) => b.name), ['Eagle', 'Alley Cat', 'Legacy'],
    'remote order leads, the locally curated Legacy is appended, nameless entries are skipped');
  assert.deepEqual(result.bars.boston[0], { name: 'Eagle', notes: 'remote enrichment wins for the shared key' },
    'for a shared bar-name key the remote entry is kept as-is');
  assert.deepEqual(result.bars.chicago.map((b) => b.name), ['Metro'], 'remote-only cities arrive untouched');
  assert.deepEqual(result.bars.seattle.map((b) => b.name), ['The Cuff'], 'local-only cities are kept');
  // The freshness line keeps its exact shape; the merge note is additive.
  assert.ok(logLines.includes(
    '📱 Scriptable: Bars data — 2 cities from chunky.dad, 1 from local file, 0 unavailable'
  ), `freshness line shape unchanged, got: ${JSON.stringify(logLines)}`);
  assert.ok(logLines.includes(
    '📱 Scriptable: Bars data — merged 1 local-only bar(s)'
  ), `additive merge line expected, got: ${JSON.stringify(logLines)}`);
});

test('refreshRemoteBars union: no local-only bars means no merge log line', async () => {
  const adapter = buildRemoteBarsAdapter({}, { boston: [{ name: 'Legacy' }] });
  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let result;
  try {
    result = await adapter.refreshRemoteBars(null, { boston: [{ name: 'Legacy', notes: 'stale' }] });
  } finally {
    console.log = originalLog;
  }
  assert.deepEqual(result.bars.boston, [{ name: 'Legacy' }], 'remote wins for the shared key');
  assert.ok(!logLines.some((line) => line.includes('merged')),
    `no merge line when nothing was appended, got: ${JSON.stringify(logLines)}`);
});

test('supportsReverseGeocode reflects Location API availability', () => {
  const adapter = buildAdapter();
  assert.equal(adapter.supportsReverseGeocode(), false, 'no Location global under Node');
  global.Location = { reverseGeocode: async () => [] };
  try {
    assert.equal(adapter.supportsReverseGeocode(), true, 'Location.reverseGeocode present → capability declared');
  } finally {
    delete global.Location;
  }
});

test('generateReviewHTML renders the bars freshness line when counts are supplied', () => {
  const adapter = buildAdapter();
  const withCounts = adapter.generateReviewHTML([], {
    barsFreshness: { remote: 18, local: 2, unavailable: 3 }
  });
  assert.ok(withCounts.includes('18 cities live from chunky.dad'), 'remote count rendered');
  assert.ok(withCounts.includes('2 local fallback'), 'local fallback count rendered');
  assert.ok(withCounts.includes('3 without bar data'), 'unavailable count rendered');

  const without = adapter.generateReviewHTML([], {});
  assert.ok(!without.includes('🍺 Bars:'), 'no freshness line without counts');
});

// ---------------------------------------------------------------------------
// presentReviewResults — shouldAllowRequest bridge (the reliable Scriptable
// webview→native pattern; the callback/poll bridge died silently on-device
// 2026-07-17 because evaluateJavaScript on a presented web view is unreliable)
// ---------------------------------------------------------------------------

function buildBridgeFinding() {
  return {
    id: 'f1', calendarTitle: 'chunky-dad-nyc', eventTitle: 'MEGAMILK',
    startDate: null, check: 'geocode', status: 'missing-pin',
    current: { location: '', address: '10-90 Wyckoff Ave' },
    proposed: { location: '40.69, -73.90' }, detail: 'fresh geocode proposed'
  };
}

// A fake WebView that lets a test drive shouldAllowRequest like the device
// does: tap → navigate to a URL → handler fires synchronously → present()
// resolves on dismissal.
function installFakeWebView() {
  let handler = null;
  let resolvePresent = null;
  const evals = [];
  global.WebView = class {
    async loadHTML() {}
    set shouldAllowRequest(fn) { handler = fn; }
    get shouldAllowRequest() { return handler; }
    present() { return new Promise((resolve) => { resolvePresent = resolve; }); }
    async evaluateJavaScript(js) { evals.push(js); return undefined; }
  };
  return {
    tap: (url) => handler({ url }),
    dismiss: () => resolvePresent(),
    evals,
    getHandler: () => handler
  };
}

test('parseReviewActionUrl decodes action and id without new URL', () => {
  const adapter = buildAdapter();
  const single = adapter.parseReviewActionUrl('chunkyreview://act?a=apply&id=f%2F1&n=3');
  assert.equal(single.a, 'apply');
  assert.equal(single.id, 'f/1', 'percent-encoded id is decoded');
  const bulk = adapter.parseReviewActionUrl('chunkyreview://act?a=apply-bulk&id=missing-only&n=9');
  assert.equal(bulk.a, 'apply-bulk');
  assert.equal(bulk.id, 'missing-only');
});

test('presentReviewResults applies via shouldAllowRequest and cancels the navigation', async () => {
  const adapter = buildAdapter();
  let saved = 0;
  adapter.reviewEventIndex = { f1: { location: '', notes: '', save: async () => { saved += 1; } } };
  let summaryShown = null;
  adapter.showReviewSummaryAlert = async (counts) => { summaryShown = counts; };

  const wv = installFakeWebView();
  try {
    const done = adapter.presentReviewResults([buildBridgeFinding()], {});
    await new Promise((r) => setImmediate(r)); // let present() wire up

    // A normal navigation (OSM map iframe) is allowed through.
    assert.equal(wv.getHandler()({ url: 'https://www.openstreetmap.org/x' }), true,
      'non-scheme navigation is allowed');

    // A button tap: handler returns false (cancels nav) and kicks off the apply.
    assert.equal(wv.tap('chunkyreview://act?a=apply&id=f1&n=1'), false,
      'the fake navigation is cancelled');
    await new Promise((r) => setImmediate(r)); // let the fire-and-forget apply settle

    wv.dismiss();
    const counts = await done;
    assert.deepEqual(counts, { applied: 1, failed: 0 });
    assert.equal(saved, 1, 'the calendar event was saved');
    assert.ok(wv.evals.some((js) => js.includes('markFindingApplied("f1", true')),
      'chip feedback pushed to the page (best-effort)');
    assert.deepEqual(summaryShown, { applied: 1, failed: 0 },
      'the authoritative summary Alert is shown after dismissal');
  } finally {
    delete global.WebView;
  }
});

test('presentReviewResults survives evaluateJavaScript rejection — the apply still lands', async () => {
  const adapter = buildAdapter();
  let saved = 0;
  adapter.reviewEventIndex = { f1: { location: '', notes: '', save: async () => { saved += 1; } } };
  adapter.showReviewSummaryAlert = async () => {};

  let handler = null;
  let resolvePresent = null;
  global.WebView = class {
    async loadHTML() {}
    set shouldAllowRequest(fn) { handler = fn; }
    present() { return new Promise((resolve) => { resolvePresent = resolve; }); }
    // Mirrors the device failure: evaluateJavaScript on a presented web view throws.
    async evaluateJavaScript() { throw new Error('evaluateJavaScript unavailable'); }
  };
  try {
    const done = adapter.presentReviewResults([buildBridgeFinding()], {});
    await new Promise((r) => setImmediate(r));
    handler({ url: 'chunkyreview://act?a=apply&id=f1&n=1' });
    await new Promise((r) => setImmediate(r));
    resolvePresent();
    const counts = await done;
    assert.deepEqual(counts, { applied: 1, failed: 0 },
      'a dead chip-feedback channel never blocks the native apply');
    assert.equal(saved, 1, 'the calendar write happened regardless');
  } finally {
    delete global.WebView;
  }
});

test('presentReviewResults bulk apply resolves every eligible finding', async () => {
  const adapter = buildAdapter();
  const saves = [];
  adapter.reviewEventIndex = {
    m1: { location: '', notes: '', save: async () => { saves.push('m1'); } },
    p1: { location: '1,2', notes: '', save: async () => { saves.push('p1'); } }
  };
  adapter.showReviewSummaryAlert = async () => {};
  const findings = [
    { id: 'm1', calendarTitle: 'c', eventTitle: 'M', startDate: null, check: 'geocode', status: 'missing-pin', current: { location: '', address: 'x' }, proposed: { location: '3,4' }, detail: 'd' },
    { id: 'p1', calendarTitle: 'c', eventTitle: 'P', startDate: null, check: 'geocode', status: 'pin-moved', current: { location: '1,2', address: 'y' }, proposed: { location: '5,6' }, detail: 'd' }
  ];

  const wv = installFakeWebView();
  try {
    const done = adapter.presentReviewResults(findings, {});
    await new Promise((r) => setImmediate(r));
    // "missing only" applies just the missing-pin finding.
    wv.tap('chunkyreview://act?a=apply-bulk&id=missing-only&n=1');
    await new Promise((r) => setImmediate(r));
    wv.dismiss();
    const counts = await done;
    assert.deepEqual(saves, ['m1'], 'only the missing-pin finding was applied');
    assert.deepEqual(counts, { applied: 1, failed: 0 });
  } finally {
    delete global.WebView;
  }
});

test('review page uses the chunkyreview scheme, error banner, and bar-data visibility', () => {
  const adapter = buildAdapter();
  const barFinding = {
    id: 'b1', calendarTitle: 'chunky-dad-poconos', eventTitle: 'FURBALL CAMP',
    startDate: null, check: 'geocode', status: 'ok', source: 'bar-data',
    current: { location: '41.02, -75.11', address: '446 MT NEBO RD' },
    proposed: {}, detail: 'matches curated bar data (Camp Out)'
  };
  const html = adapter.generateReviewHTML([barFinding], { barsFreshness: { remote: 12, local: 0, unavailable: 10 } });
  assert.ok(html.includes('chunkyreview://act'), 'buttons signal via the custom scheme');
  assert.ok(!html.includes('__reviewQueue') && !html.includes('postReviewAction'),
    'no leftover poll/callback bridge plumbing in the page');
  assert.ok(html.includes('reviewErrorBanner'), 'error banner div present');
  assert.ok(html.includes('window.onerror'), 'page error trap installed');
  assert.ok(html.includes('1 event verified against curated bar data'), 'bar-data count in header');
  assert.ok(html.includes('matches curated bar data (Camp Out)'), 'ok entry shows the bar note');
});

// ---------------------------------------------------------------------------
// Discovered venue calendars (enrich-only ticket crawl): results-UI section
// with a native copy-parser-entry bridge (chunkyscrape:// + shouldAllowRequest)
// ---------------------------------------------------------------------------

function buildDiscoveredVenueFixture() {
  return {
    host: 'www.massive.club',
    origin: 'https://www.massive.club',
    suggestedName: 'massive.club',
    parentTitle: 'BEARRACUDA: LA',
    sourceEntryName: 'Bearracuda Events',
    droppedCount: 9,
    sampleTitles: ['Butt Blast (Jul 23)', 'Twink Bash: Birthday Suit (Aug 1)'],
    parserEntrySnippet: '{ name: "massive.club", enabled: false, urls: ["https://www.massive.club"], alwaysBear: false },'
  };
}

test('generateDiscoveredVenueSection renders host, counts, titles, snippet, and copy button only when venue data exists', () => {
  const adapter = buildAdapter();

  assert.equal(adapter.generateDiscoveredVenueSection({}), '', 'no section without venue data');
  assert.equal(adapter.generateDiscoveredVenueSection({ discoveredVenueCalendars: [] }), '', 'no section for an empty list');

  const html = adapter.generateDiscoveredVenueSection({ discoveredVenueCalendars: [buildDiscoveredVenueFixture()] });
  assert.ok(html.includes('Discovered Venue Calendars'), 'section title present');
  assert.ok(html.includes('www.massive.club'), 'host shown');
  assert.ok(html.includes('9 event(s) found but not ingested (enrich-only ticket crawl)'), 'count line present');
  assert.ok(html.includes('Butt Blast (Jul 23)'), 'sample titles shown');
  assert.ok(html.includes('reached via ticket link from &quot;BEARRACUDA: LA&quot;'), 'parent event named (escaped)');
  assert.ok(html.includes('data-venue-index="0"'), 'copy button carries the venue index, not the snippet');
  assert.ok(html.includes('copyVenueEntry(this)'), 'copy button wired to the custom-scheme signal');
  assert.ok(html.includes('&quot;https://www.massive.club&quot;'), 'paste-ready snippet rendered (escaped)');
  assert.ok(!html.includes('chunkyscrape://act?a=copy-venue&id={'), 'snippet text never travels through the URL');
});

test('generateRichHTML embeds the discovered-venue section and the chunkyscrape page bridge', async () => {
  const adapter = buildAdapter();
  const results = { ...buildResultsStub(), discoveredVenueCalendars: [buildDiscoveredVenueFixture()] };
  const html = await adapter.generateRichHTML(results);
  assert.ok(html.includes('Discovered Venue Calendars'), 'section present when venue data exists');
  assert.ok(html.includes("chunkyscrape://act?a=copy-venue"), 'buttons signal via the custom scheme');
  assert.ok(html.includes('markVenueEntryCopied'), 'best-effort feedback handler defined');
  assert.ok(html.includes('__venueCopyNonce'), 'per-tap nonce keeps repeat taps distinct navigations');

  const withoutVenues = await adapter.generateRichHTML(buildResultsStub());
  assert.ok(!withoutVenues.includes('Discovered Venue Calendars'), 'no section without venue data');
});

test('presentRichResults copies a venue parser entry natively via shouldAllowRequest', async () => {
  const adapter = buildAdapter();
  const venue = buildDiscoveredVenueFixture();
  // calendarEvents already set → the execution prompt path is skipped
  const results = { ...buildResultsStub(), calendarEvents: 1, discoveredVenueCalendars: [venue] };

  const copies = [];
  global.Pasteboard = { copy: (text) => { copies.push(text); } };
  const wv = installFakeWebView();
  try {
    const done = adapter.presentRichResults(results);
    // generateRichHTML awaits several stubs before the handler is assigned
    for (let i = 0; i < 200 && !wv.getHandler(); i++) {
      await new Promise((r) => setImmediate(r));
    }
    assert.ok(wv.getHandler(), 'shouldAllowRequest assigned before present()');

    // Normal navigation passes through untouched.
    assert.equal(wv.getHandler()({ url: 'https://mermaid.live/' }), true, 'non-scheme navigation allowed');

    // A copy tap: navigation cancelled, snippet copied natively from the
    // native-side map (never decoded out of the URL).
    assert.equal(wv.tap('chunkyscrape://act?a=copy-venue&id=0&n=1'), false, 'fake navigation cancelled');
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(copies, [venue.parserEntrySnippet], 'the paste-ready parser entry reached the pasteboard');
    assert.ok(wv.evals.some((js) => js.includes('markVenueEntryCopied("0")')), 'button feedback pushed (best-effort)');

    // A repeat tap (new nonce) copies again.
    wv.tap('chunkyscrape://act?a=copy-venue&id=0&n=2');
    await new Promise((r) => setImmediate(r));
    assert.equal(copies.length, 2, 'repeat taps register (nonce makes each tap distinct)');

    // An unknown venue id is ignored without crashing.
    assert.equal(wv.tap('chunkyscrape://act?a=copy-venue&id=99&n=3'), false);
    await new Promise((r) => setImmediate(r));
    assert.equal(copies.length, 2);

    wv.dismiss();
    await done;
  } finally {
    delete global.WebView;
    delete global.Pasteboard;
  }
});

// ---------------------------------------------------------------------------
// Manual bear/not-bear overrides: results-UI sections + chunkyscrape:// bridge
// ---------------------------------------------------------------------------

const { EventSchema: TestEventSchema } = require(path.join(__dirname, '..', 'event-schema'));

function buildBearDroppedFixture() {
  return {
    title: 'Twink Bash',
    startDate: '2026-08-02T21:00:00.000Z',
    venue: 'Neon Room',
    reason: 'ai: drag show, no bear context',
    host: 'promoter.example',
    event: {
      title: 'Twink Bash',
      startDate: '2026-08-02T21:00:00.000Z',
      bar: 'Neon Room',
      city: 'dallas'
    }
  };
}

test('parseReviewActionUrl decodes mark-bear/mark-not-bear actions with their nonce', () => {
  const adapter = buildAdapter();
  const markBear = adapter.parseReviewActionUrl('chunkyscrape://act?a=mark-bear&id=3&n=7');
  assert.equal(markBear.a, 'mark-bear');
  assert.equal(markBear.id, '3');
  assert.equal(markBear.n, '7');
  const markNotBear = adapter.parseReviewActionUrl('chunkyscrape://act?a=mark-not-bear&id=0&n=12');
  assert.equal(markNotBear.a, 'mark-not-bear');
  assert.equal(markNotBear.id, '0');
  assert.equal(markNotBear.n, '12');
});

test('generateBearDroppedSection renders drops as real event cards with both verdict buttons', () => {
  const adapter = buildAdapter();

  assert.equal(adapter.generateBearDroppedSection({}), '', 'no section without drops');
  assert.equal(adapter.generateBearDroppedSection({ bearDroppedEvents: [] }), '', 'no section for an empty list');

  const html = adapter.generateBearDroppedSection({ bearDroppedEvents: [buildBearDroppedFixture()] });
  assert.ok(html.includes('Dropped as non-bear'), 'section title present');
  // Same card markup the kept events use — not a debug list
  assert.ok(html.includes('class="event-card bear-dropped-card"'), 'rendered through generateEventCard');
  assert.ok(html.includes('class="event-title">Twink Bash<'), 'title in the card title slot');
  assert.ok(html.includes('Neon Room'), 'venue shown');
  assert.ok(html.includes('Bear check: ai: drag show, no bear context • from promoter.example'), 'drop reason + host shown');
  assert.ok(html.includes('DROPPED — NOT BEAR'), 'drop badge replaces the intent/write badge');

  // BOTH actions on the tile, addressed by the dropped-list namespace
  assert.ok(html.includes('data-bear-idx="d0"'), 'dropped-list index carried on the buttons');
  assert.ok(html.includes('data-bear-act="mark-bear"'), 'mark-bear action wired');
  assert.ok(html.includes('data-bear-act="mark-not-bear"'), 'mark-not-bear action wired');
  assert.equal((html.match(/markBearOverride\(this\)/g) || []).length, 2, 'exactly two verdict buttons per card');
  // The current (not-bear) verdict is the highlighted one
  assert.ok(
    html.includes('bear-verdict-btn bear-override-btn is-active" data-bear-idx="d0" data-bear-act="mark-not-bear"'),
    'not-bear is the active verdict on a dropped card'
  );
  assert.ok(
    html.includes('bear-verdict-btn bear-override-btn" data-bear-idx="d0" data-bear-act="mark-bear"'),
    'mark-bear rendered inactive'
  );
  assert.ok(!html.includes('disabled>'), 'live-run buttons are tappable');

  // A rescued row keeps its cards + note but goes read-only (already applied)
  const rescuedHtml = adapter.generateBearDroppedSection({
    bearDroppedEvents: [{ ...buildBearDroppedFixture(), rescued: true }]
  });
  assert.ok(rescuedHtml.includes('Rescued (manual override on calendar record)'));
  assert.ok(rescuedHtml.includes('data-bear-act="mark-bear" disabled'), 'rescued rows cannot be re-marked');
  assert.ok(rescuedHtml.includes('data-bear-verdict="bear"'), 'a rescued drop reads as bear');

  // Saved-run display lists the drops but the buttons are inert
  const savedHtml = adapter.generateBearDroppedSection({
    _isDisplayingSavedRun: true,
    bearDroppedEvents: [buildBearDroppedFixture()]
  });
  assert.ok(savedHtml.includes('Twink Bash'));
  assert.ok(savedHtml.includes('data-bear-act="mark-bear" disabled'), 'saved-run display has no post-dismissal execution');
});

test('generateBearDroppedSection: manuallyMarkedBear renders the rescued treatment', () => {
  const adapter = buildAdapter();
  // A drop the owner rescued mid-run (applyPendingBearOverrides stamps
  // manuallyMarkedBear on the entry, and saveRun persists it) must read as
  // rescued in a saved run — not as a still-active "not bear" verdict.
  const html = adapter.generateBearDroppedSection({
    _isDisplayingSavedRun: true,
    bearDroppedEvents: [{ ...buildBearDroppedFixture(), manuallyMarkedBear: true }]
  });
  assert.ok(html.includes('data-bear-verdict="bear"'), 'verdict shown as bear');
  assert.ok(
    !html.includes('is-active" data-bear-idx="d0" data-bear-act="mark-not-bear"'),
    'not-bear is no longer the active verdict'
  );
  assert.ok(html.includes('data-bear-act="mark-bear" disabled'), 'rendered read-only');
  assert.ok(html.includes('Rescued (marked bear by calendar owner this run)'), 'rescue note shown');

  // Same treatment in a live run: an already-applied rescue is not re-markable.
  const liveHtml = adapter.generateBearDroppedSection({
    bearDroppedEvents: [{ ...buildBearDroppedFixture(), manuallyMarkedBear: true }]
  });
  assert.ok(liveHtml.includes('data-bear-act="mark-bear" disabled'), 'read-only in live runs too');
  assert.ok(liveHtml.includes('data-bear-verdict="bear"'));

  // The pre-existing rescue flag keeps working unchanged.
  const rescuedHtml = adapter.generateBearDroppedSection({
    bearDroppedEvents: [{ ...buildBearDroppedFixture(), rescued: true }]
  });
  assert.ok(rescuedHtml.includes('Rescued (manual override on calendar record)'));
  assert.ok(rescuedHtml.includes('data-bear-verdict="bear"'));
});

test('generateBearDroppedSection: fallback entries without .event render disabled buttons', () => {
  const adapter = buildAdapter();
  // recordBearOverrideAndReport early-returns on entries lacking .event, so
  // live buttons on the flat-fields fallback card would be silently dead —
  // they must carry the same disabled treatment saved-run mode uses.
  const { event, ...flatEntry } = buildBearDroppedFixture();
  const html = adapter.generateBearDroppedSection({ bearDroppedEvents: [flatEntry] });
  assert.ok(html.includes('Twink Bash'), 'fallback card still renders the drop');
  assert.ok(html.includes('Neon Room'), 'venue survives via the flat fields');
  assert.ok(html.includes('data-bear-act="mark-bear" disabled'), 'mark-bear disabled');
  assert.ok(html.includes('data-bear-act="mark-not-bear" disabled'), 'mark-not-bear disabled');
  assert.ok(!html.includes('data-bear-act="mark-bear">'), 'no live mark-bear button');
});

test('buildBearVerdictActionsHtml escapes the card id and marks the active verdict', () => {
  const adapter = buildAdapter();
  assert.equal(adapter.buildBearVerdictActionsHtml(null), '', 'no row without options');
  assert.equal(adapter.buildBearVerdictActionsHtml({ bearVerdict: 'bear' }), '', 'no row without a card id');

  const bear = adapter.buildBearVerdictActionsHtml({ bearIdx: 'k3', bearVerdict: 'bear', interactive: true });
  // Wave 7 compact toggle: icon-scale buttons, the words kept for
  // accessibility in a visually-hidden span — never deleted.
  assert.ok(bear.includes('🐻'));
  assert.ok(bear.includes('🚫'));
  assert.ok(bear.includes('Mark as bear'));
  assert.ok(bear.includes('Mark as not bear'));
  assert.ok(bear.includes('bear-verdict-btn-text'), 'button words ride in the hidden text span');
  assert.ok(bear.includes('data-bear-act="mark-bear"') && bear.includes('is-active" data-bear-idx="k3" data-bear-act="mark-bear"'));
  assert.ok(!bear.includes('is-active" data-bear-idx="k3" data-bear-act="mark-not-bear"'));

  const escaped = adapter.buildBearVerdictActionsHtml({
    bearIdx: 'k1"><script>x</script>',
    bearVerdict: 'not-bear',
    interactive: false,
    note: '<b>note</b>'
  });
  assert.ok(!escaped.includes('<script>'), 'card id is escaped into the attribute');
  assert.ok(escaped.includes('&lt;b&gt;note&lt;/b&gt;'), 'note is escaped');
  assert.ok(escaped.includes(' disabled>'), 'non-interactive renders read-only buttons');
});

test('generateEventCard renders kept events with both verdict buttons and escaped content', () => {
  const adapter = buildAdapter();
  const card = adapter.generateEventCard(
    { title: 'Bear <b>Night</b>', _action: 'new', startDate: '2026-08-01T02:00:00.000Z', bar: 'Ram & "Ranch"' },
    {},
    { bearIdx: 'k0', bearVerdict: 'bear', interactive: true }
  );
  assert.ok(card.includes('data-bear-idx="k0"'), 'kept-list index on the tile');
  assert.equal((card.match(/data-bear-idx="k0"/g) || []).length, 2, 'both directions present');
  assert.ok(card.includes('data-bear-verdict="bear"'), 'current verdict exposed on the row');
  assert.ok(card.includes('Bear &lt;b&gt;Night&lt;/b&gt;'), 'title escaped');
  assert.ok(card.includes('Ram &amp; &quot;Ranch&quot;'), 'venue escaped');
  assert.ok(!card.includes('<b>Night</b>'), 'no raw title markup');

  const plain = adapter.generateEventCard({ title: 'Plain', _action: 'new', startDate: '2026-08-01T02:00:00.000Z' });
  assert.ok(!plain.includes('bear-verdict-row'), 'no verdict row without bear options');
});

test('generateRichHTML embeds the dropped section only when bearDroppedEvents is non-empty', async () => {
  const adapter = buildAdapter();
  const withDrops = await adapter.generateRichHTML({
    ...buildResultsStub(),
    bearDroppedEvents: [buildBearDroppedFixture()]
  });
  assert.ok(withDrops.includes('Dropped as non-bear'), 'dropped section present');
  assert.ok(withDrops.includes('chunkyscrape://act?a='), 'override buttons signal via the custom scheme');
  assert.ok(withDrops.includes('__bearOverrideNonce'), 'per-tap nonce keeps repeat taps distinct navigations');
  assert.ok(withDrops.includes('markBearOverrideDone'), 'best-effort feedback handler defined');
  assert.ok(withDrops.includes('class="event-card bear-dropped-card"'), 'drops reach the page as real event cards');
  assert.ok(withDrops.includes('data-bear-idx="d0"'), 'dropped events are addressable over the bridge');

  const withoutDrops = await adapter.generateRichHTML(buildResultsStub());
  assert.ok(!withoutDrops.includes('Dropped as non-bear'), 'no dropped section without drops');
  // Every kept card carries both verdict buttons, indexed into analyzedEvents
  assert.ok(withoutDrops.includes('data-bear-idx="k0"'), 'first kept event addressable');
  assert.ok(withoutDrops.includes('data-bear-idx="k1"'), 'second kept event addressable');
  assert.equal(
    (withoutDrops.match(/data-bear-idx="k\d+" data-bear-act="mark-not-bear"/g) || []).length,
    2,
    'one not-bear button per kept card (the separate kept-override list is gone)'
  );
  assert.ok(!withoutDrops.includes('mark mistakes not-bear'), 'the standalone kept-override list is gone');
});

test('presentRichResults records override taps and applies them after dismissal', async () => {
  const adapter = buildAdapter();
  const droppedEntry = buildBearDroppedFixture();
  // calendarEvents already set → the execution prompt path is skipped
  const results = {
    ...buildResultsStub(),
    calendarEvents: 1,
    config: { config: {} },
    bearDroppedEvents: [droppedEntry]
  };
  const keptEvent = results.analyzedEvents[0];

  const wv = installFakeWebView();
  try {
    const done = adapter.presentRichResults(results);
    for (let i = 0; i < 200 && !wv.getHandler(); i++) {
      await new Promise((r) => setImmediate(r));
    }
    assert.ok(wv.getHandler(), 'shouldAllowRequest assigned before present()');

    // Taps: rescue the dropped event (d0), bury a kept one (k0), and confirm
    // the other kept one as bear (k1). Navigation always cancelled.
    assert.equal(wv.tap('chunkyscrape://act?a=mark-bear&id=d0&n=1'), false);
    assert.equal(wv.tap('chunkyscrape://act?a=mark-not-bear&id=k0&n=2'), false);
    assert.equal(wv.tap('chunkyscrape://act?a=mark-bear&id=k1&n=3'), false);
    await new Promise((r) => setImmediate(r));
    assert.ok(
      wv.evals.some((js) => js.includes('markBearOverrideDone("d0", "mark-bear")')),
      'in-page "Marked" feedback pushed (best-effort)'
    );

    // Last tap on a card wins: flipping k1 back to not-bear then to bear
    // leaves exactly one pending verdict for it.
    assert.equal(wv.tap('chunkyscrape://act?a=mark-not-bear&id=k1&n=4'), false);
    assert.equal(wv.tap('chunkyscrape://act?a=mark-bear&id=k1&n=5'), false);

    // Out-of-range and unnamespaced ids are ignored without crashing.
    assert.equal(wv.tap('chunkyscrape://act?a=mark-bear&id=d99&n=6'), false);
    assert.equal(wv.tap('chunkyscrape://act?a=mark-not-bear&id=0&n=7'), false);

    wv.dismiss();
    await done;
  } finally {
    delete global.WebView;
  }

  // Marked not-bear: adjusted in the plan as a hidden tombstone — the
  // bearReview flag matches the exact regex the website hides on
  // (js/calendar-core.js isHiddenForBearReview) plus bearSource manual-*.
  assert.ok(/^(unlikely|unsure)/i.test(keptEvent.bearReview), 'tombstone carries the site-hidden bearReview flag');
  assert.ok(String(keptEvent.bearSource).startsWith('manual-not-bear'), 'manual verdict stamped');
  const tombstoneFields = TestEventSchema.parseNotesIntoFields(keptEvent.notes);
  assert.equal(tombstoneFields.bearSource, keptEvent.bearSource, 'bearSource persisted in notes');
  assert.equal(tombstoneFields.bearReview, keptEvent.bearReview, 'hide flag persisted in notes');

  // Marked bear: prepped through the normal calendar flow and appended to the
  // plan (the stubbed environment yields action "new").
  // A kept event confirmed bear is stamped in place (no duplicate write)
  const confirmed = results.analyzedEvents[1];
  assert.ok(String(confirmed.bearSource).startsWith('manual-bear'), 'kept event carries the owner verdict');
  assert.equal(confirmed.isBearEvent, true);
  assert.equal(confirmed.bearReview, undefined, 'an explicit owner bear clears the hide flag');
  assert.equal(TestEventSchema.parseNotesIntoFields(confirmed.notes).bearSource, confirmed.bearSource);

  assert.equal(results.analyzedEvents.length, 3, 'rescued event joined the plan');
  const rescued = results.analyzedEvents[2];
  assert.equal(rescued.title, 'Twink Bash');
  assert.equal(rescued._action, 'new');
  assert.equal(rescued.isBearEvent, true);
  assert.ok(String(rescued.bearSource).startsWith('manual-bear (overrode ai: drag show'), 'manual verdict records what it overrode');
  assert.equal(TestEventSchema.parseNotesIntoFields(rescued.notes).bearSource, rescued.bearSource);
  assert.equal(droppedEntry.manuallyMarkedBear, true);
});

// ---------------------------------------------------------------------------
// getConsoleTee: the sink the orchestrator wires into other modules' consoles
// (Scriptable gives each imported module its own console binding, so
// captureConsole alone only ever saw this adapter module's output).
// ---------------------------------------------------------------------------

test('getConsoleTee routes (level, args) into the logger with captureConsole formatting', () => {
  const fileLogger = new FileLogger();
  const tee = fileLogger.getConsoleTee();
  const err = new Error('tee boom');
  const obj = { a: 1, nested: ['x'] };

  tee('info', ['🐻 message', err, obj]);
  tee('warn', ['warned']);
  tee('error', [err]);
  tee('debug', ['payload', obj]);

  assert.equal(fileLogger.entries.length, 4);
  assert.deepEqual(
    fileLogger.entries.map((entry) => entry.level),
    ['info', 'warn', 'error', 'debug']
  );

  // Identical formatting to captureConsole: both feed formatArgs(args) into
  // append, so Error args keep their stack and objects JSON-stringify.
  const expectedInfo = fileLogger.formatArgs(['🐻 message', err, obj]);
  assert.ok(fileLogger.entries[0].line.endsWith(`[INFO] ${expectedInfo}`));
  assert.ok(expectedInfo.includes('"a":1'), 'object arg is JSON-stringified');

  const expectedError = fileLogger.formatArgs([err]);
  assert.ok(fileLogger.entries[2].line.endsWith(`[ERROR] ${expectedError}`));
  assert.ok(expectedError.includes('tee boom'), 'Error arg keeps its message/stack');

  const expectedDebug = fileLogger.formatArgs(['payload', obj]);
  assert.ok(fileLogger.entries[3].line.endsWith(`[DEBUG] ${expectedDebug}`));
});

test('getConsoleTee respects captureMode none/errors identically to append', () => {
  const fileLogger = new FileLogger({ captureMode: 'none' });
  const tee = fileLogger.getConsoleTee();

  tee('error', ['dropped even at error level']);
  tee('info', ['dropped']);
  assert.equal(fileLogger.entries.length, 0, 'captureMode none drops everything');

  fileLogger.configure({ captureMode: 'errors' });
  tee('info', ['dropped info']);
  tee('debug', ['dropped debug']);
  tee('warn', ['kept warn']);
  tee('error', ['kept error']);
  assert.deepEqual(
    fileLogger.entries.map((entry) => entry.level),
    ['warn', 'error'],
    'captureMode errors keeps only warn/error, like append'
  );
});

test('module-level getConsoleTee export hands the orchestrator a tee function', () => {
  assert.equal(typeof getConsoleTee, 'function');
  assert.equal(typeof getConsoleTee(), 'function');
});

test('wired-then-restored console does not double-append into a capturing logger', () => {
  // Node-only hazard check: here the module console IS the shared global
  // console, so wiring a tee for the same logger that also captureConsole'd
  // would double-append. On Scriptable module consoles are separate objects,
  // so the tee and captureConsole never see the same call. This test proves
  // the restore path leaves exactly one capture in place.
  const savedConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  };
  const { __wireConsoleTee } = require('../shared-core');
  const fileLogger = new FileLogger();
  try {
    fileLogger.captureConsole();

    // Wired on top of captureConsole (shared console): tee appends AND the
    // echo reaches the captureConsole wrapper — the double-append Scriptable
    // never hits because each module gets its own console object.
    const restore = __wireConsoleTee(fileLogger.getConsoleTee());
    assert.equal(typeof restore, 'function');
    console.log('tee-marker-wired');
    assert.equal(
      fileLogger.entries.filter((entry) => entry.line.includes('tee-marker-wired')).length,
      2
    );

    // Restored: only captureConsole remains — exactly one append per line.
    restore();
    console.log('tee-marker-restored');
    assert.equal(
      fileLogger.entries.filter((entry) => entry.line.includes('tee-marker-restored')).length,
      1
    );
  } finally {
    console.log = savedConsole.log;
    console.warn = savedConsole.warn;
    console.error = savedConsole.error;
    console.debug = savedConsole.debug;
    delete console.__consoleTeeRestore;
  }
});

// ---------------------------------------------------------------------------
// Geo-POI bar corroboration (phase 3): the raw placemark is persisted
// verbatim, so newly cached entries carry Apple's POI fields (name/
// areasOfInterest) forward for the normalizers' geo-POI harvest, while
// pre-harvest entries without them are still served unchanged (fail open —
// the old cache is never invalidated).
// ---------------------------------------------------------------------------

test('reverse-geocode cache carries POI fields forward on new entries; old nameless entries stay served', async () => {
  const POI_PLACEMARK = {
    subThoroughfare: '1192',
    thoroughfare: 'Folsom Street',
    locality: 'San Francisco',
    postalCode: '94103',
    name: 'Powerhouse',
    areasOfInterest: ['SoMa']
  };
  const adapter = buildReverseGeocodeAdapter();
  let calls = 0;
  global.Location = {
    reverseGeocode: async () => { calls += 1; return [POI_PLACEMARK]; }
  };
  try {
    await adapter.reverseGeocodePlacemark(37.7756941, -122.4103049);
    const stored = JSON.parse(adapter.fm.files.get(adapter.getReverseGeocodeCacheFilePath()));
    const entry = stored['37.77569,-122.41030'];
    assert.equal(entry.placemark.name, 'Powerhouse', 'newly written entries carry the POI name');
    assert.deepEqual(entry.placemark.areasOfInterest, ['SoMa'], 'areasOfInterest rides along too');

    // A later run serves the POI fields from disk without spending quota
    const laterRun = buildReverseGeocodeAdapter();
    laterRun.fm = adapter.fm;
    const served = await laterRun.reverseGeocodePlacemark(37.7756941, -122.4103049);
    assert.equal(served.name, 'Powerhouse');
    assert.equal(calls, 1, 'disk hit — no Apple call');

    // Pre-harvest entry (no name/areasOfInterest) is served as-is: the
    // normalizers' harvest finds no POI and fails open; never refetched.
    const oldEntry = { subThoroughfare: '446', thoroughfare: 'Mt Nebo Rd', locality: 'East Stroudsburg' };
    laterRun.reverseGeocodeDiskCache['41.02198,-75.11678'] = { placemark: oldEntry, ts: Date.now() };
    const legacy = await laterRun.reverseGeocodePlacemark(41.0219799, -75.1167816);
    assert.deepEqual(legacy, oldEntry, 'old cache entries are honored, not invalidated');
    assert.equal(calls, 1, 'no refetch for nameless legacy entries');
  } finally {
    delete global.Location;
  }
});

// ---------------------------------------------------------------------------
// Provenance-aware preserve verification in the merge-detail comparison rows:
// companion stamps legitimately CHANGE under preserve when a higher authority
// vouches for the kept value — upgrades are good news, only downgrades warn.
// ---------------------------------------------------------------------------

function buildPreserveComparisonEvent(field, { existing, scraped, final: finalValue }) {
  // title/startDate agree on every side so their rows render as SAME VALUE —
  // the row under test is the only one that can warn.
  return {
    title: 'MEGAWOOF: MASSIVE',
    startDate: '2026-08-01T02:00:00.000Z',
    _action: 'merge',
    [field]: finalValue,
    _fieldPriorities: { [field]: { merge: 'preserve' } },
    _original: {
      scraper: { title: 'MEGAWOOF: MASSIVE', startDate: '2026-08-01T02:00:00.000Z', [field]: scraped },
      calendar: { title: 'MEGAWOOF: MASSIVE', startDate: '2026-08-01T02:00:00.000Z', [field]: existing },
      merged: {}
    }
  };
}

test('run 20260722-150336 case: pinSource preserve geocoded-exact → curated renders PROVENANCE UPGRADED, not a failure', () => {
  const adapter = buildAdapter();
  const rows = adapter.generateComparisonRows(buildPreserveComparisonEvent('pinSource', {
    existing: 'geocoded-exact', scraped: 'curated', final: 'curated'
  }));

  assert.ok(rows.includes('PROVENANCE UPGRADED (geocoded-exact → curated)'), rows);
  assert.ok(rows.includes('#34c759'), 'renders in the informational green style');
  assert.ok(!rows.includes('PRESERVE FAILED'), 'must NOT be reported as a failure');
  assert.ok(!rows.includes('⚠️'), 'no warning icon for an upgrade');
});

test('a provenance downgrade (curated → geocoded-approx) keeps the red warning, reworded as PROVENANCE DOWNGRADED', () => {
  const adapter = buildAdapter();
  const rows = adapter.generateComparisonRows(buildPreserveComparisonEvent('pinSource', {
    existing: 'curated', scraped: 'geocoded-approx', final: 'geocoded-approx'
  }));

  assert.ok(rows.includes('PROVENANCE DOWNGRADED (curated → geocoded-approx)'), rows);
  assert.ok(rows.includes('<span style="color: #ff3b30;">PROVENANCE DOWNGRADED'), 'existing red style');
  assert.ok(rows.includes('⚠️'), 'downgrades keep the warning icon');
  assert.ok(!rows.includes('PRESERVE FAILED'));
});

test('non-provenance preserve mismatch still renders PRESERVE FAILED byte-identically', () => {
  const adapter = buildAdapter();
  const rows = adapter.generateComparisonRows(buildPreserveComparisonEvent('shortName', {
    existing: 'FURBALL', scraped: 'MEGAWOOF', final: 'MEGAWOOF'
  }));

  assert.ok(rows.includes('<span style="color: #ff3b30;">PRESERVE FAILED (expected: FURBALL, got: MEGAWOOF)</span>'), rows);
  assert.ok(!rows.includes('PROVENANCE'));
});

test('an unknown provenance value fails open to the existing PRESERVE FAILED behavior', () => {
  const adapter = buildAdapter();
  const rows = adapter.generateComparisonRows(buildPreserveComparisonEvent('pinSource', {
    existing: 'weird-stamp', scraped: 'curated', final: 'curated'
  }));

  assert.ok(rows.includes('<span style="color: #ff3b30;">PRESERVE FAILED (expected: weird-stamp, got: curated)</span>'), rows);
  assert.ok(!rows.includes('PROVENANCE'));
});

test('an equal-tier provenance change (venue-site → geo-poi, same corroborated class) is informational, not a warning', () => {
  const adapter = buildAdapter();
  const rows = adapter.generateComparisonRows(buildPreserveComparisonEvent('barSource', {
    existing: 'venue-site', scraped: 'geo-poi', final: 'geo-poi'
  }));

  assert.ok(rows.includes('PROVENANCE UPGRADED (venue-site → geo-poi)'), rows);
  assert.ok(!rows.includes('PRESERVE FAILED'));
  assert.ok(!rows.includes('⚠️'));
});

// ---------------------------------------------------------------------------
// Venue discovery queue (bar-additions.json) — gathering-only evidence store
// ---------------------------------------------------------------------------

function buildVenueCandidate(overrides = {}) {
  return {
    key: 'seattle|massive',
    name: 'Massive',
    city: 'seattle',
    address: '1400 12th Ave, Seattle, WA 98122',
    coordinates: '47.6135, -122.3163',
    signals: ['venue-site'],
    website: 'https://massiveseattle.com',
    sourceEvents: [
      {
        title: 'Bear Night',
        date: '2026-08-01T02:00:00.000Z',
        sourcePageUrl: 'https://massiveseattle.com/events/bear-night'
      }
    ],
    runId: null,
    ...overrides
  };
}

test('venue queue round-trip: a tapped candidate becomes a bar-additions.json entry', async () => {
  const adapter = buildAdapter();
  adapter.fm = createDeadEndFmStub();

  // Missing file → empty queue, never throws
  assert.deepEqual(await adapter.loadBarAdditions(), {});

  const queue = await adapter.loadBarAdditions();
  const entry = adapter.mergeBarAdditionEntry(
    queue, buildVenueCandidate(), '20260722-120000', '2026-07-22T12:00:00.000Z');
  await adapter.saveBarAdditions(queue);

  assert.ok(adapter.fm.files.has(adapter.getBarAdditionsFilePath()),
    'queue written to bar-additions.json in the scraper dir');
  assert.deepEqual(await adapter.loadBarAdditions(), {
    'seattle|massive': {
      name: 'Massive',
      city: 'seattle',
      address: '1400 12th Ave, Seattle, WA 98122',
      coordinates: '47.6135, -122.3163',
      signals: ['venue-site'],
      sourceEvents: [
        {
          title: 'Bear Night',
          date: '2026-08-01T02:00:00.000Z',
          sourcePageUrl: 'https://massiveseattle.com/events/bear-night'
        }
      ],
      firstSeen: '2026-07-22T12:00:00.000Z',
      lastSeen: '2026-07-22T12:00:00.000Z',
      timesSeen: 1,
      runIds: ['20260722-120000'],
      website: 'https://massiveseattle.com'
    }
  });
  assert.equal(entry.timesSeen, 1);
});

test('venue queue merge on repeat: timesSeen/lastSeen bump, unions, caps, best address', async () => {
  const adapter = buildAdapter();
  adapter.fm = createDeadEndFmStub();

  const queue = await adapter.loadBarAdditions();
  adapter.mergeBarAdditionEntry(
    queue, buildVenueCandidate({ address: 'Seattle, WA', website: '' }),
    'run-1', '2026-07-01T00:00:00.000Z');
  const merged = adapter.mergeBarAdditionEntry(
    queue,
    buildVenueCandidate({
      signals: ['venue-site', 'geo-poi'],
      sourceEvents: [
        // duplicate of the first tap's event → deduped
        { title: 'Bear Night', date: '2026-08-01T02:00:00.000Z', sourcePageUrl: 'https://massiveseattle.com/events/bear-night' },
        { title: 'Underwear Party', date: '2026-08-08T02:00:00.000Z', sourcePageUrl: 'https://massiveseattle.com/events/underwear' }
      ]
    }),
    'run-2', '2026-07-22T12:00:00.000Z');

  assert.equal(merged.timesSeen, 2);
  assert.equal(merged.firstSeen, '2026-07-01T00:00:00.000Z', 'firstSeen unchanged');
  assert.equal(merged.lastSeen, '2026-07-22T12:00:00.000Z');
  assert.deepEqual(merged.signals, ['venue-site', 'geo-poi'], 'signals unioned');
  assert.deepEqual(merged.runIds, ['run-1', 'run-2'], 'runIds unioned');
  assert.equal(merged.address, '1400 12th Ave, Seattle, WA 98122',
    'more complete address replaces the sparse one');
  assert.equal(merged.website, 'https://massiveseattle.com', 'website blank filled');
  assert.deepEqual(merged.sourceEvents.map(e => e.title), ['Bear Night', 'Underwear Party'],
    'sourceEvents unioned without duplicates');

  // Caps: runIds keep the 10 most recent, sourceEvents never exceed 5
  for (let i = 3; i <= 14; i++) {
    adapter.mergeBarAdditionEntry(
      queue,
      buildVenueCandidate({
        sourceEvents: [{ title: `Event ${i}`, date: '', sourcePageUrl: '' }]
      }),
      `run-${i}`, '2026-07-23T00:00:00.000Z');
  }
  assert.equal(merged.runIds.length, 10, 'runIds capped at 10');
  assert.equal(merged.runIds[9], 'run-14', 'most recent runId kept');
  assert.ok(!merged.runIds.includes('run-1'), 'oldest runId dropped by the cap');
  assert.equal(merged.sourceEvents.length, 5, 'sourceEvents capped at 5');

  // A LESS complete address never replaces a more complete one
  adapter.mergeBarAdditionEntry(
    queue, buildVenueCandidate({ address: 'Seattle' }),
    'run-x', '2026-07-24T00:00:00.000Z');
  assert.equal(merged.address, '1400 12th Ave, Seattle, WA 98122');
});

test('venue queue tolerates corrupt or wrong-shaped files with an empty queue', async () => {
  const adapter = buildAdapter();
  adapter.fm = createDeadEndFmStub();
  const path = adapter.getBarAdditionsFilePath();

  adapter.fm.files.set(path, '{"seattle|massive": {broken json');
  assert.deepEqual(await adapter.loadBarAdditions(), {}, 'parse failure → empty queue');

  adapter.fm.files.set(path, '["not", "an", "object"]');
  assert.deepEqual(await adapter.loadBarAdditions(), {}, 'array payload → empty queue');

  adapter.fm.files.set(path, 'null');
  assert.deepEqual(await adapter.loadBarAdditions(), {}, 'null payload → empty queue');

  // saveBarAdditions refuses non-object queues instead of clobbering the file
  adapter.fm.files.delete(path);
  await adapter.saveBarAdditions(null);
  await adapter.saveBarAdditions(['nope']);
  assert.ok(!adapter.fm.files.has(path));

  // mergeBarAdditionEntry fails open on keyless candidates
  assert.equal(adapter.mergeBarAdditionEntry({}, { name: 'No Key' }, null, 'now'), null);
});

test('queue-venue action URLs parse like the other chunkyscrape actions', () => {
  const adapter = buildAdapter();
  const params = adapter.parseReviewActionUrl('chunkyscrape://act?a=queue-venue&id=2&n=7');
  assert.equal(params.a, 'queue-venue');
  assert.equal(params.id, '2');
  assert.equal(params.n, '7');
});

test('new-venue section renders only when candidates exist, never on saved runs', async () => {
  const adapter = buildAdapter();
  adapter.fm = createDeadEndFmStub();

  assert.equal(await adapter.generateNewVenueCandidateSection({}), '');
  assert.equal(await adapter.generateNewVenueCandidateSection({ newVenueCandidates: [] }), '');
  assert.equal(
    await adapter.generateNewVenueCandidateSection({
      _isDisplayingSavedRun: true,
      newVenueCandidates: [buildVenueCandidate()]
    }),
    '', 'saved-run display never renders the queue section');

  const html = await adapter.generateNewVenueCandidateSection({
    newVenueCandidates: [buildVenueCandidate()]
  });
  assert.ok(html.includes('New venue candidates'));
  assert.ok(html.includes('Massive'));
  assert.ok(html.includes('(seattle)'));
  assert.ok(html.includes('1400 12th Ave, Seattle, WA 98122'));
  assert.ok(html.includes('Signals: venue-site'));
  assert.ok(html.includes('Bear Night'));
  assert.ok(html.includes('data-nvq-index="0"'));
  assert.ok(html.includes('Queue for bars data'));
  assert.ok(!html.includes('Queued ✓'));
});

test('already-queued candidates render the Queued badge instead of the button', async () => {
  const adapter = buildAdapter();
  adapter.fm = createDeadEndFmStub();
  adapter.fm.files.set(
    adapter.getBarAdditionsFilePath(),
    JSON.stringify({ 'seattle|massive': { name: 'Massive', timesSeen: 3 } }));

  const html = await adapter.generateNewVenueCandidateSection({
    newVenueCandidates: [
      buildVenueCandidate(),
      buildVenueCandidate({ key: 'seattle|neighbours', name: 'Neighbours' })
    ]
  });
  assert.ok(html.includes('Queued ✓ (seen 3 times)'), 'queued candidate shows badge');
  assert.ok(!html.includes('data-nvq-index="0"'), 'queued candidate has no button');
  assert.ok(html.includes('data-nvq-index="1"'), 'unqueued candidate keeps its button');
});

test('NOTHING in the scraping pipeline reads bar-additions.json (gathering-only)', () => {
  const fs = require('node:fs');
  // The scraping pipeline — shared-core, orchestrator, parsers, normalizers,
  // and the web adapter — must never reference the queue file or its
  // accessors at all: the queue is write-and-display evidence only.
  const pipelineFiles = [
    '../shared-core.js',
    '../bear-event-scraper-unified.js',
    '../normalizers.js',
    '../parsers/ai-web-parser.js',
    './web-adapter.js'
  ];
  for (const rel of pipelineFiles) {
    const source = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    assert.ok(!source.includes('bar-additions'), `${rel} must not reference bar-additions.json`);
    assert.ok(!source.includes('BarAdditions'), `${rel} must not call the queue accessors`);
  }
  // In the Scriptable adapter the queue is read in exactly three places, all
  // results-UI-side: the "Queued ✓" badge, the queue-tap handler, and the
  // post-save run-id backfill for this session's taps. The bars-data load
  // path (loadBarsConfiguration/fetchRemoteBarsJson) and the run pipeline
  // never touch it.
  const adapterSource = fs.readFileSync(path.join(__dirname, 'scriptable-adapter.js'), 'utf8');
  const readCallSites = adapterSource
    .split('\n')
    .filter(line => line.includes('this.loadBarAdditions('));
  assert.equal(readCallSites.length, 3,
    `queue reads allowed only in the badge renderer, the tap handler, and the run-id backfill, found: ${readCallSites.join(' | ')}`);
  const barsLoaderSource = adapterSource.slice(
    adapterSource.indexOf('async loadBarsConfiguration'),
    adapterSource.indexOf('async fetchRemoteBarsJson'));
  assert.ok(barsLoaderSource.length > 0, 'bars loader located');
  assert.ok(!barsLoaderSource.includes('BarAdditions') && !barsLoaderSource.includes('bar-additions'),
    'the bars-data load path never reads the queue');
});

// ---------------------------------------------------------------------------
// Map verify links (Bar/Address/Pin Google Maps lookups) + inline OSM maps
// ---------------------------------------------------------------------------

const MAPS_SEARCH_PREFIX = 'https://www.google.com/maps/search/?api=1&query=';
const MAPS_DIR_PREFIX = 'https://www.google.com/maps/dir/?api=1&';

function buildMapsAdapter() {
  return new ScriptableAdapter({
    cities: {
      nyc: { patterns: ['new york', 'nyc', 'manhattan'] },
      seattle: { patterns: ['seattle'] }
    }
  });
}

test('open-url action URLs parse like the other chunkyscrape actions', () => {
  const adapter = buildMapsAdapter();
  const params = adapter.parseReviewActionUrl('chunkyscrape://act?a=open-url&id=4&n=9');
  assert.equal(params.a, 'open-url');
  assert.equal(params.id, '4');
  assert.equal(params.n, '9');
});

test('bar verify link searches "<bar>, <city display name>" with full encoding', () => {
  const adapter = buildMapsAdapter();
  assert.equal(
    adapter.buildBarMapsSearchUrl('Massive', 'seattle'),
    `${MAPS_SEARCH_PREFIX}Massive%2C%20seattle`);
  // The city display name is the first alias pattern ("nyc" → "new york"),
  // and ampersands are percent-encoded (no new URL/URLSearchParams).
  assert.equal(
    adapter.buildBarMapsSearchUrl('Bear & Bull', 'nyc'),
    `${MAPS_SEARCH_PREFIX}Bear%20%26%20Bull%2C%20new%20york`);
  // Unicode venue names survive encodeURIComponent.
  assert.equal(
    adapter.buildBarMapsSearchUrl('Café Lambda', 'seattle'),
    `${MAPS_SEARCH_PREFIX}Caf%C3%A9%20Lambda%2C%20seattle`);
  // Unknown city keys fall back to the de-hyphenated key.
  assert.equal(
    adapter.buildBarMapsSearchUrl('Ramrod', 'fort-lauderdale'),
    `${MAPS_SEARCH_PREFIX}Ramrod%2C%20fort%20lauderdale`);
  // No city → bar alone; no bar → no link at all.
  assert.equal(adapter.buildBarMapsSearchUrl('Massive', ''), `${MAPS_SEARCH_PREFIX}Massive`);
  assert.equal(adapter.buildBarMapsSearchUrl('', 'seattle'), '');
  assert.equal(adapter.buildBarMapsSearchUrl('   ', 'seattle'), '');
});

test('address verify link appends the city only when the address lacks it', () => {
  const adapter = buildMapsAdapter();
  // Address already contains the city name (case-insensitive) → no append.
  assert.equal(
    adapter.buildAddressMapsSearchUrl('1400 12th Ave, Seattle, WA 98122', 'seattle'),
    `${MAPS_SEARCH_PREFIX}1400%2012th%20Ave%2C%20Seattle%2C%20WA%2098122`);
  // Bare street address → city appended for disambiguation.
  assert.equal(
    adapter.buildAddressMapsSearchUrl('1400 12th Ave', 'seattle'),
    `${MAPS_SEARCH_PREFIX}1400%2012th%20Ave%2C%20seattle`);
  // City display name (not the key) is what gets matched and appended.
  assert.equal(
    adapter.buildAddressMapsSearchUrl('225 E Houston St, New York, NY', 'nyc'),
    `${MAPS_SEARCH_PREFIX}225%20E%20Houston%20St%2C%20New%20York%2C%20NY`);
  // No address → no link.
  assert.equal(adapter.buildAddressMapsSearchUrl('', 'seattle'), '');
});

test('pin verify link searches the raw coordinates; non-coordinates yield no link', () => {
  const adapter = buildMapsAdapter();
  assert.equal(
    adapter.buildPinMapsSearchUrl('47.6135, -122.3163'),
    `${MAPS_SEARCH_PREFIX}47.6135%2C-122.3163`);
  assert.equal(adapter.buildPinMapsSearchUrl('The Cuff, Seattle'), '');
  assert.equal(adapter.buildPinMapsSearchUrl(''), '');
  assert.equal(adapter.buildPinMapsSearchUrl(undefined), '');
});

test('verify row renders only links whose data exists, always via the bridge', () => {
  const adapter = buildMapsAdapter();
  assert.equal(adapter.buildMapVerifyLinksHtml({}), '', 'no data → no row');
  assert.equal(adapter.buildMapVerifyLinksHtml(), '', 'no argument → no row');

  const pinOnly = adapter.buildMapVerifyLinksHtml({ coordinates: '47.61, -122.33' });
  assert.ok(pinOnly.includes('Pin ↗'));
  assert.ok(!pinOnly.includes('Bar ↗') && !pinOnly.includes('Address ↗'),
    'absent fields render no links');
  assert.ok(!pinOnly.includes('Route ↗'), 'a single point never gets a route');

  const full = adapter.buildMapVerifyLinksHtml({
    bar: 'Massive', city: 'seattle',
    address: '1400 12th Ave', coordinates: '47.6135, -122.3163'
  });
  for (const label of ['Bar ↗', 'Address ↗', 'Pin ↗', 'Route ↗']) {
    assert.ok(full.includes(label), `${label} link present`);
  }
  assert.ok(full.includes('openMapVerify(this)'), 'links signal via the bridge');
  assert.ok(!full.includes('href="https'),
    'no plain https hrefs — those would navigate the results WebView away');
  // Each embedded id resolves to a registered Google Maps URL natively —
  // three search links plus the directions Route link.
  const ids = [...full.matchAll(/data-map-url-id="(\d+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 4);
  for (const id of ids.slice(0, 3)) {
    assert.ok(adapter._mapVerifyUrls[id].startsWith(MAPS_SEARCH_PREFIX),
      'URL retrievable from the native-side registry');
  }
  assert.ok(adapter._mapVerifyUrls[ids[3]].startsWith(MAPS_DIR_PREFIX),
    'the Route link registers the directions URL');
});

test('route link chains origin bar → waypoint address → destination pin, fully encoded', () => {
  const adapter = buildMapsAdapter();
  const all = adapter.buildRouteMapsDirectionsUrl({
    bar: 'Bear & Bull', city: 'nyc',
    address: '225 E Houston St', coordinates: '40.7223, -73.9874'
  });
  assert.equal(all,
    'https://www.google.com/maps/dir/?api=1'
    + '&origin=Bear%20%26%20Bull%2C%20new%20york'
    + '&destination=40.7223%2C-73.9874'
    + '&waypoints=225%20E%20Houston%20St%2C%20new%20york');
  // The route legs are the EXACT query strings the single links search for,
  // so a ~0 m rendered route proves all three resolve to one venue.
  assert.ok(adapter.buildBarMapsSearchUrl('Bear & Bull', 'nyc')
    .endsWith('Bear%20%26%20Bull%2C%20new%20york'));
  assert.ok(adapter.buildAddressMapsSearchUrl('225 E Houston St', 'nyc')
    .endsWith('225%20E%20Houston%20St%2C%20new%20york'));
  assert.ok(adapter.buildPinMapsSearchUrl('40.7223, -73.9874')
    .endsWith('40.7223%2C-73.9874'));
});

test('route link with two points maps them to origin → destination, no waypoints', () => {
  const adapter = buildMapsAdapter();
  // bar + pin
  assert.equal(
    adapter.buildRouteMapsDirectionsUrl({
      bar: 'Massive', city: 'seattle', coordinates: '47.6135, -122.3163'
    }),
    'https://www.google.com/maps/dir/?api=1'
    + '&origin=Massive%2C%20seattle&destination=47.6135%2C-122.3163');
  // bar + address
  assert.equal(
    adapter.buildRouteMapsDirectionsUrl({
      bar: 'Massive', city: 'seattle', address: '1400 12th Ave'
    }),
    'https://www.google.com/maps/dir/?api=1'
    + '&origin=Massive%2C%20seattle&destination=1400%2012th%20Ave%2C%20seattle');
  // address + pin
  assert.equal(
    adapter.buildRouteMapsDirectionsUrl({
      city: 'seattle', address: '1400 12th Ave', coordinates: '47.6135, -122.3163'
    }),
    'https://www.google.com/maps/dir/?api=1'
    + '&origin=1400%2012th%20Ave%2C%20seattle&destination=47.6135%2C-122.3163');
});

test('route link needs at least two resolvable points', () => {
  const adapter = buildMapsAdapter();
  assert.equal(adapter.buildRouteMapsDirectionsUrl({}), '');
  assert.equal(adapter.buildRouteMapsDirectionsUrl(), '');
  assert.equal(adapter.buildRouteMapsDirectionsUrl({ bar: 'Massive', city: 'seattle' }), '');
  assert.equal(adapter.buildRouteMapsDirectionsUrl({ coordinates: '47.61, -122.33' }), '');
  // A non-coordinate "pin" contributes nothing, leaving only one real point.
  assert.equal(
    adapter.buildRouteMapsDirectionsUrl({ bar: 'Massive', city: 'seattle', coordinates: 'The Cuff' }),
    '');
});

test('evidence block renders one muted line per string and fails open when empty', () => {
  const adapter = buildMapsAdapter();
  assert.equal(adapter.buildEvidenceLinesHtml([]), '');
  assert.equal(adapter.buildEvidenceLinesHtml(undefined), '');
  assert.equal(adapter.buildEvidenceLinesHtml('not an array'), '');
  assert.equal(adapter.buildEvidenceLinesHtml(['   ', null]), '', 'blank/non-string lines are dropped');

  const html = adapter.buildEvidenceLinesHtml([
    'pin is 42 m from curated "Massive" pin',
    'provenance: bar=venue-site, pin=geocoded-exact'
  ]);
  assert.ok(html.includes('evidence-block'));
  assert.ok(html.includes('Evidence'));
  assert.ok(html.includes('pin is 42 m from curated &quot;Massive&quot; pin'), 'lines are HTML-escaped');
  assert.ok(html.includes('provenance: bar=venue-site, pin=geocoded-exact'));
});

test('candidate rows render the evidence block only when the candidate carries lines', async () => {
  const adapter = buildMapsAdapter();
  adapter.fm = createDeadEndFmStub();

  const withEvidence = await adapter.generateNewVenueCandidateSection({
    newVenueCandidates: [buildVenueCandidate({
      evidence: ['bar corroborated: venue-site', 'provenance: bar=venue-site, pin=geocoded-exact']
    })]
  });
  assert.ok(withEvidence.includes('evidence-block'), 'evidence block present');
  assert.ok(withEvidence.includes('bar corroborated: venue-site'));
  assert.ok(withEvidence.includes('Route ↗'), 'route link present on candidate rows');

  const withoutEvidence = await adapter.generateNewVenueCandidateSection({
    newVenueCandidates: [buildVenueCandidate()]
  });
  assert.ok(!withoutEvidence.includes('evidence-block'), 'no block without lines');
});

test('event cards render the evidence block only when _evidenceLines exist', () => {
  const adapter = buildMapsAdapter();
  const baseEvent = {
    title: 'Bear Night',
    startDate: '2026-08-01T02:00:00.000Z',
    city: 'seattle',
    bar: 'Massive',
    address: '1400 12th Ave',
    location: '47.6135, -122.3163',
    _action: 'new'
  };
  const html = adapter.generateEventCard({
    ...baseEvent,
    _evidenceLines: ['pin is 0.7 km from seattle center', 'bar corroborated: geo-poi']
  });
  assert.ok(html.includes('evidence-block'), 'evidence block on the card');
  assert.ok(html.includes('pin is 0.7 km from seattle center'));
  assert.ok(html.includes('Route ↗'), 'route link present on event cards');

  const bare = adapter.generateEventCard(baseEvent);
  assert.ok(!bare.includes('evidence-block'), 'no block without lines');
  const empty = adapter.generateEventCard({ ...baseEvent, _evidenceLines: [] });
  assert.ok(!empty.includes('evidence-block'), 'empty array → no block (fail open)');
});

test('OSM embed URL has the keyless bbox/marker shape with encoded commas', () => {
  const adapter = buildMapsAdapter();
  const lat = 47.6135;
  const lng = -122.3163;
  const d = 0.004;
  const url = adapter.buildOsmEmbedUrl(`${lat}, ${lng}`);
  assert.equal(
    url,
    'https://www.openstreetmap.org/export/embed.html'
      + `?bbox=${encodeURIComponent(`${lng - d},${lat - d},${lng + d},${lat + d}`)}`
      + `&layer=mapnik&marker=${encodeURIComponent(`${lat},${lng}`)}`);
  assert.ok(url.includes('marker=47.6135%2C-122.3163'), 'marker is lat%2Clng');
  assert.ok(!url.includes('key='), 'keyless embed (why OSM, not Google)');
  assert.equal(adapter.buildOsmEmbedUrl('not coordinates'), '');
});

test('legacy Google embed URL is keyless output=embed with encoded coordinates', () => {
  const adapter = buildMapsAdapter();
  assert.equal(
    adapter.buildGoogleEmbedUrl('47.6135, -122.3163'),
    'https://maps.google.com/maps?q=47.6135%2C-122.3163&z=16&output=embed');
  assert.ok(!adapter.buildGoogleEmbedUrl('47.6135, -122.3163').includes('key='),
    'unofficial keyless endpoint — no API key anywhere');
  assert.equal(adapter.buildGoogleEmbedUrl('not coordinates'), '');
  assert.equal(adapter.buildGoogleEmbedUrl(''), '');
});

test('candidate rows carry the verify row and a lazy inline dual-map toggle', async () => {
  const adapter = buildMapsAdapter();
  adapter.fm = createDeadEndFmStub();

  const html = await adapter.generateNewVenueCandidateSection({
    newVenueCandidates: [buildVenueCandidate()]
  });
  assert.ok(html.includes('Verify:'), 'verify row present');
  assert.ok(html.includes('Bar ↗') && html.includes('Address ↗') && html.includes('Pin ↗'));
  assert.ok(html.includes('toggleCandidateMap(this)'), 'map toggle wired');
  assert.ok(html.includes('id="nvq_map_0"'), 'toggle target container present');
  // Both inline maps ride the toggle: OSM (dependable) + legacy Google
  // (keyless, unofficial), each with its URL parked in data-map-embed.
  const embedUrls = [...html.matchAll(/data-map-embed="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(embedUrls.length, 2, 'exactly two lazy embeds per candidate');
  assert.ok(embedUrls[0].startsWith('https://www.openstreetmap.org/export/embed.html?'),
    'OSM embed first');
  assert.ok(embedUrls[0].includes('marker=47.6135%2C-122.3163'),
    'OSM marker carries the encoded coordinates');
  assert.equal(embedUrls[1],
    'https://maps.google.com/maps?q=47.6135%2C-122.3163&amp;z=16&amp;output=embed',
    'legacy Google embed second (HTML-escaped in the attribute)');
  assert.ok(!/<iframe[^>]*\ssrc=/.test(html),
    'lazy: neither iframe has a src until the toggle is tapped');

  // Without coordinates there is no pin link and no map toggle at all.
  const noCoords = await adapter.generateNewVenueCandidateSection({
    newVenueCandidates: [buildVenueCandidate({ coordinates: '' })]
  });
  assert.ok(!noCoords.includes('toggleCandidateMap'), 'no toggle without coordinates');
  assert.ok(!noCoords.includes('<iframe'), 'no iframe without coordinates');
  assert.ok(!noCoords.includes('Pin ↗'), 'no pin link without coordinates');
  assert.ok(noCoords.includes('Bar ↗'), 'other links unaffected');
});

test('event cards carry the verify links on the face route line, never a details verify row', () => {
  const adapter = buildMapsAdapter();
  adapter.resetMapVerifyUrls();
  const html = adapter.generateEventCard({
    title: 'Bear Night',
    startDate: '2026-08-01T02:00:00.000Z',
    city: 'seattle',
    bar: 'Massive',
    address: '1400 12th Ave',
    location: '47.6135, -122.3163',
    _action: 'new'
  });
  // The old expander Verify row is gone (owner: "Instead of having it in
  // both the main card and expanded details") — its four links now ARE the
  // route-line parts on the face, all through the same bridge registry.
  assert.ok(!html.includes('map-verify-row'), 'no separate verify row on cards');
  for (const cls of ['route-bar-link', 'route-address-link', 'route-pin-link', 'route-directions-link']) {
    assert.ok(html.includes(cls), `${cls} on the face route line`);
  }
  const urls = Object.values(adapter._mapVerifyUrls);
  assert.ok(urls.some((u) => u.startsWith(MAPS_SEARCH_PREFIX) && u.includes('Massive')), 'bar search URL registered');
  assert.ok(urls.some((u) => u.startsWith(MAPS_SEARCH_PREFIX) && u.includes('1400%2012th%20Ave')), 'address search URL registered');
  assert.ok(urls.some((u) => u.startsWith(MAPS_DIR_PREFIX)), 'route directions URL registered');

  const bare = adapter.generateEventCard({
    title: 'No venue data',
    startDate: '2026-08-01T02:00:00.000Z',
    _action: 'new'
  });
  assert.ok(!bare.includes('map-verify-row'), 'no row without bar/address/location');
  assert.ok(!bare.includes('route-bar-link'), 'no links without venue data');
});

test('presentRichResults opens verify links in Safari via the open-url bridge', async () => {
  const adapter = buildMapsAdapter();
  adapter.fm = createDeadEndFmStub();
  // calendarEvents already set → the execution prompt path is skipped
  const results = {
    ...buildResultsStub(),
    calendarEvents: 1,
    newVenueCandidates: [buildVenueCandidate()]
  };

  const opened = [];
  global.Safari = { open: (url) => { opened.push(url); } };
  const wv = installFakeWebView();
  try {
    const done = adapter.presentRichResults(results);
    for (let i = 0; i < 200 && !wv.getHandler(); i++) {
      await new Promise((r) => setImmediate(r));
    }
    assert.ok(wv.getHandler(), 'shouldAllowRequest assigned before present()');
    const ids = Object.keys(adapter._mapVerifyUrls);
    assert.ok(ids.length >= 3, 'candidate verify URLs registered natively during render');

    // A verify tap: navigation cancelled, Safari opens the registered URL
    // on top — the results WebView itself never navigates.
    assert.equal(wv.tap(`chunkyscrape://act?a=open-url&id=${ids[0]}&n=1`), false,
      'fake navigation cancelled');
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(opened, [adapter._mapVerifyUrls[ids[0]]],
      'Safari.open received the native-side URL');

    // An unknown id is ignored without crashing.
    assert.equal(wv.tap('chunkyscrape://act?a=open-url&id=999&n=2'), false);
    await new Promise((r) => setImmediate(r));
    assert.equal(opened.length, 1);

    wv.dismiss();
    await done;
  } finally {
    delete global.WebView;
    delete global.Safari;
  }
});

// ---------------------------------------------------------------------------
// Venue-queue run id backfill (taps precede the save that mints the run id)
// ---------------------------------------------------------------------------

test('venue-queue entries queued before the run id exists get it backfilled after save', async () => {
  const adapter = buildMapsAdapter();
  adapter.fm = createDeadEndFmStub();
  const results = { newVenueCandidates: [buildVenueCandidate()] };
  const wvStub = { evaluateJavaScript: async () => {} };

  // Tap while the results sheet is up: the run has not been saved yet, so
  // no run id exists and the entry lands with runIds: [] — the bug shape.
  await adapter.queueVenueCandidateAndReport('0', results, {}, wvStub);
  let queue = await adapter.loadBarAdditions();
  assert.deepEqual(queue['seattle|massive'].runIds, [],
    'tap-time write has no run id (display precedes save)');
  assert.deepEqual(results._queuedVenueCandidateKeys, ['seattle|massive'],
    'the session remembers which keys it queued');

  // The save path mints the id afterwards; the backfill stamps it in.
  results.savedRunId = '20260723-101010';
  await adapter.backfillQueuedVenueRunIds(results);
  queue = await adapter.loadBarAdditions();
  assert.deepEqual(queue['seattle|massive'].runIds, ['20260723-101010'],
    'queued entry ends up with the real run id');

  // Idempotent — a repeat backfill never duplicates the id.
  await adapter.backfillQueuedVenueRunIds(results);
  queue = await adapter.loadBarAdditions();
  assert.deepEqual(queue['seattle|massive'].runIds, ['20260723-101010']);
});

test('run id backfill preserves history, skips foreign entries, and fails open', async () => {
  const adapter = buildMapsAdapter();
  adapter.fm = createDeadEndFmStub();
  adapter.fm.files.set(adapter.getBarAdditionsFilePath(), JSON.stringify({
    'seattle|massive': { name: 'Massive', timesSeen: 2, runIds: ['20260701-090000'] },
    'seattle|neighbours': { name: 'Neighbours', timesSeen: 1, runIds: [] }
  }));

  // Only this session's keys are stamped; prior run ids are kept.
  const results = {
    savedRunId: '20260723-101010',
    _queuedVenueCandidateKeys: ['seattle|massive', 'seattle|gone-missing']
  };
  await adapter.backfillQueuedVenueRunIds(results);
  const queue = await adapter.loadBarAdditions();
  assert.deepEqual(queue['seattle|massive'].runIds,
    ['20260701-090000', '20260723-101010'], 'new id appended after history');
  assert.deepEqual(queue['seattle|neighbours'].runIds, [],
    'entries not queued this session are untouched');

  // No session keys or no run id → no write at all (fail open).
  const before = adapter.fm.files.get(adapter.getBarAdditionsFilePath());
  await adapter.backfillQueuedVenueRunIds({ savedRunId: '20260724-000000' });
  await adapter.backfillQueuedVenueRunIds({ _queuedVenueCandidateKeys: ['seattle|massive'] });
  assert.equal(adapter.fm.files.get(adapter.getBarAdditionsFilePath()), before,
    'nothing rewritten without both a run id and session keys');
});

// ---------------------------------------------------------------------------
// Embedded-event JSON slimming (runs 20260725-205758/210227: the Bearracuda
// results page hit 1.76 MB — dominated by per-event _aiPrompts/_aiValidation
// blobs embedded 2-3x per card — and WebView.loadHTML white-screened
// silently. buildEmbeddedEventJson is the ONE serializer for all three embed
// sites: the two Copy JSON button attributes and the raw <pre> dump.)
// ---------------------------------------------------------------------------

function buildSyntheticAnalyzedEvent() {
  // Shaped like a real analyzed event (~32 KB): the AI prompt/validation
  // texts live under _original.scraper and are ~10 KB each.
  const bigPrompt = 'PROMPT '.repeat(1500);      // ~10.5 KB
  const bigValidation = 'VALIDATE '.repeat(1200); // ~10.8 KB
  return {
    title: 'BEARRACUDA: Seattle',
    bar: 'Massive',
    city: 'seattle',
    startDate: '2026-08-01T02:00:00.000Z',
    placeId: 'ChIJexample',
    _action: 'merge',
    _parserConfig: {
      name: 'bearracuda',
      parser: 'ai-web',
      urls: ['https://bearracuda.com/'],
      alwaysBear: true,
      maxAdditionalUrls: 20
    },
    _existingEvent: {
      title: 'BEARRACUDA: Seattle',
      identifier: 'CAL-123',
      notes: 'existing notes blob',
      save: function () {}
    },
    _original: {
      scraper: {
        title: 'BEARRACUDA: Seattle',
        _aiPrompts: { extraction: bigPrompt, arbitration: bigPrompt },
        _aiValidation: { report: bigValidation }
      },
      calendar: { title: 'BEARRACUDA: Seattle' },
      merged: { title: 'BEARRACUDA: Seattle', _aiValidation: { report: bigValidation } }
    }
  };
}

test('buildEmbeddedEventJson: button embeds drop _original and the AI blobs; pre embed keeps _original minus the AI blobs', () => {
  const adapter = buildAdapter();
  const event = buildSyntheticAnalyzedEvent();
  const fullSize = JSON.stringify(event, (k, v) => typeof v === 'function' ? '[Function]' : v, 2).length;
  assert.ok(fullSize > 30000, `synthetic event is real-run sized (~32 KB), got ${fullSize}`);

  const buttonJson = adapter.buildEmbeddedEventJson(event, { includeOriginal: false });
  const preJson = adapter.buildEmbeddedEventJson(event, { includeOriginal: true });

  // The AI prompt/validation blobs are gone from EVERY embed, at any depth.
  for (const [label, json] of [['button', buttonJson], ['pre', preJson]]) {
    const parsed = JSON.parse(json);
    const hasKeyDeep = (value, key) => {
      if (!value || typeof value !== 'object') return false;
      if (Object.prototype.hasOwnProperty.call(value, key)) return true;
      return Object.values(value).some(child => hasKeyDeep(child, key));
    };
    assert.equal(hasKeyDeep(parsed, '_aiPrompts'), false, `${label}: no _aiPrompts at any depth`);
    assert.equal(hasKeyDeep(parsed, '_aiValidation'), false, `${label}: no _aiValidation at any depth`);
    assert.equal(hasKeyDeep(parsed, 'placeId'), false, `${label}: placeId stays hidden`);
    // Existing _parserConfig/_existingEvent slimming is preserved.
    assert.deepEqual(parsed._parserConfig, { name: 'bearracuda', parser: 'ai-web' },
      `${label}: _parserConfig slimmed to name+parser`);
    assert.deepEqual(parsed._existingEvent, { title: 'BEARRACUDA: Seattle', identifier: 'CAL-123' },
      `${label}: _existingEvent slimmed to title+identifier`);
  }

  // _original is dropped from the button embeds but kept in the pre embed
  // (that's where a human reads the merge provenance).
  assert.equal('_original' in JSON.parse(buttonJson), false, 'button embed has no _original');
  const preParsed = JSON.parse(preJson);
  assert.ok(preParsed._original && preParsed._original.scraper && preParsed._original.calendar,
    'pre embed keeps _original scraper/calendar provenance');

  // The size win is what un-white-screens the page: the button embed sheds
  // the whole _original subtree, the pre embed sheds the ~20 KB of AI blobs.
  assert.ok(buttonJson.length < fullSize / 10,
    `button embed well under 10% of full event (${buttonJson.length} vs ${fullSize})`);
  assert.ok(preJson.length < fullSize / 3,
    `pre embed sheds the AI blobs (${preJson.length} vs ${fullSize})`);
});

test('generateEventCard embeds are all built by the shared serializer (no AI blobs or button _original in the card HTML)', () => {
  const adapter = buildAdapter();
  const event = buildSyntheticAnalyzedEvent();
  const html = adapter.generateEventCard(event, { runId: '20260725-210227' });
  assert.ok(!html.includes('PROMPT PROMPT'), 'no AI prompt text anywhere in the card HTML');
  assert.ok(!html.includes('VALIDATE VALIDATE'), 'no AI validation text anywhere in the card HTML');
  assert.ok(html.includes('copyEventJSON(this)'), 'copy buttons are still wired up');
  assert.ok(html.includes('&quot;_original&quot;'), 'the raw <pre> dump still shows _original provenance');
}
);

// The "Active config" section was removed from the results UI (owner
// feedback); a regression guard keeps it from creeping back.
// ---------------------------------------------------------------------------

test('generateRichHTML no longer renders an Active config section', async () => {
  const adapter = buildAdapter();
  const html = await adapter.generateRichHTML({
    ...buildResultsStub(),
    config: { config: { dryRun: true }, parsers: [{ name: 'Furball', enabled: true }] }
  });
  assert.ok(!html.includes('Active config'), 'section gone even when a config snapshot exists');
  assert.ok(!html.includes('a=copy-config'), 'copy-config bridge navigation gone');
  assert.ok(!html.includes('copyActiveConfig'), 'page handler gone');
  assert.equal(typeof adapter.generateActiveConfigSection, 'undefined', 'builder deleted');
});

// ---------------------------------------------------------------------------
// Parser picker: guard, selection application, staleness helpers, ordering.
// The native UITable presentation itself is not headlessly testable — these
// cover the pure parts presentParserPicker is built on.
// ---------------------------------------------------------------------------

test('shouldPresentParserPicker: knob off or non-manual runtime → false; on+manual → true', () => {
  const adapter = buildAdapter();
  const manual = { automationRun: false, runsInWidget: false, runsInActionExtension: false };

  assert.equal(
    adapter.shouldPresentParserPicker({ config: {}, runtime: manual }),
    false,
    'knob absent → false'
  );
  assert.equal(
    adapter.shouldPresentParserPicker({ config: { pickParsers: 'yes' }, runtime: manual }),
    false,
    'non-boolean truthy knob → false (requires === true)'
  );
  assert.equal(
    adapter.shouldPresentParserPicker({ config: { pickParsers: true }, runtime: manual }),
    true,
    'knob on + manual run → true'
  );
  assert.equal(
    adapter.shouldPresentParserPicker({
      config: { pickParsers: true },
      runtime: { ...manual, automationRun: true }
    }),
    false,
    'automation run → false'
  );
  assert.equal(
    adapter.shouldPresentParserPicker({
      config: { pickParsers: true },
      runtime: { ...manual, runsInWidget: true }
    }),
    false,
    'widget run → false'
  );
  assert.equal(
    adapter.shouldPresentParserPicker({
      config: { pickParsers: true },
      runtime: { ...manual, runsInActionExtension: true }
    }),
    false,
    'action-extension run → false'
  );
});

test('applyParserPickerSelection flips enabled by membership without mutating originals', () => {
  const adapter = buildAdapter();
  const original = [
    { name: 'Alpha', enabled: false, url: 'https://a.example' },
    { name: 'Beta', enabled: true },
    { name: 'Gamma' }
  ];

  const applied = adapter.applyParserPickerSelection(
    original,
    new Set(['Alpha', 'Ghost'])
  );

  assert.deepEqual(
    applied.map((p) => p.enabled),
    [true, false, false],
    'selected → enabled true, unselected → false; unknown names ignored'
  );
  assert.equal(applied[0].url, 'https://a.example', 'other fields carried over');

  // Originals unmutated (spread copies only)
  assert.equal(original[0].enabled, false);
  assert.equal(original[1].enabled, true);
  assert.equal(original[2].enabled, undefined);
  assert.notEqual(applied[0], original[0], 'copies, not the same objects');

  // Empty selection → every parser session-disabled (this is the dismissal
  // outcome: with no static enabled flags in config, empty means run nothing)
  const none = adapter.applyParserPickerSelection(original, new Set());
  assert.deepEqual(
    none.map((p) => p.enabled),
    [false, false, false],
    'empty Set disables every parser'
  );
});

test('applyParserPickerOutcome: null (dismissal) cancels the run and logs it; a selection applies + logs the run line', () => {
  const adapter = buildAdapter();
  const parsers = [{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Gamma' }];

  const logged = [];
  const originalLog = console.log;
  console.log = (...args) => logged.push(args.join(' '));
  try {
    const cancelled = adapter.applyParserPickerOutcome(parsers, null, 3);
    assert.deepEqual(
      cancelled.map((p) => p.enabled),
      [false, false, false],
      'null → zero-parser session (all session-disabled)'
    );
    assert.ok(
      logged.includes(
        '📱 Scriptable: Parser picker dismissed — run cancelled (no parsers selected)'
      ),
      'dismissal log line emitted'
    );

    const picked = adapter.applyParserPickerOutcome(parsers, new Set(['Beta']), 3);
    assert.deepEqual(
      picked.map((p) => p.enabled),
      [false, true, false],
      'selection applied per-session'
    );
    assert.ok(
      logged.includes('📱 Scriptable: Parser picker: running 1 of 3 parsers'),
      'existing running-X-of-Y log shape preserved'
    );
  } finally {
    console.log = originalLog;
  }

  // Originals never mutated
  assert.equal(parsers[0].enabled, undefined);
});

// ---------------------------------------------------------------------------
// Picker-state persistence: pre-selection = the last run's confirmed picks.
// ---------------------------------------------------------------------------

// Memory-backed FileManager stub for the picker-state round-trip.
function installMemoryFm(adapter) {
  const files = new Map();
  adapter.fm = {
    joinPath: (a, b) => `${a}/${b}`,
    fileExists: (p) => files.has(p) || p === adapter.baseDir,
    // Real FileManagers have this, and saveRun asks it of any path that
    // already exists — which the second write of a run always does.
    isDirectory: (p) => !files.has(p),
    createDirectory: () => {},
    readString: (p) => (files.has(p) ? files.get(p) : null),
    writeString: (p, text) => {
      files.set(p, text);
    },
    downloadFileFromiCloud: async () => {}
  };
  return files;
}

test('picker-state: save/load round-trip; unknown names filtered on load', async () => {
  const adapter = buildAdapter();
  const files = installMemoryFm(adapter);

  assert.deepEqual(
    await adapter.loadPickerState(['Alpha', 'Beta']),
    [],
    'no state file → empty pre-selection (first run)'
  );

  assert.equal(await adapter.savePickerState(['Alpha', 'Ghost']), true);
  assert.ok(files.has(adapter.getPickerStatePath()), 'state file written');
  const payload = JSON.parse(files.get(adapter.getPickerStatePath()));
  assert.deepEqual(payload.selected, ['Alpha', 'Ghost'], 'selection persisted verbatim');

  assert.deepEqual(
    await adapter.loadPickerState(['Alpha', 'Beta']),
    ['Alpha'],
    'round-trip keeps known names, filters unknown (removed/renamed parsers)'
  );
});

test('picker-state: corrupt or misshapen file → empty pre-selection', async () => {
  const adapter = buildAdapter();
  const files = installMemoryFm(adapter);
  const statePath = adapter.getPickerStatePath();

  files.set(statePath, 'not json {{{');
  assert.deepEqual(await adapter.loadPickerState(['Alpha']), [], 'corrupt JSON → []');

  files.set(statePath, JSON.stringify({ selected: 'Alpha' }));
  assert.deepEqual(await adapter.loadPickerState(['Alpha']), [], 'non-array selected → []');

  files.set(statePath, JSON.stringify({ selected: [42, null, 'Alpha'] }));
  assert.deepEqual(
    await adapter.loadPickerState(['Alpha']),
    ['Alpha'],
    'non-string entries dropped'
  );

  assert.deepEqual(adapter.parsePickerState(null, ['Alpha']), [], 'null text → []');
  assert.deepEqual(adapter.parsePickerState('null', ['Alpha']), [], 'JSON null → []');
});

// Headless UITable stub that records every row it is handed and taps, in
// order, the first row whose label contains each entry of `tapLabels` (a
// string, an array of strings, or null = swipe-down dismissal). Rows are
// re-read between taps because toggling a parser rebuilds the table. Color
// stubs return tag strings so titleColor is assertable.
function installPickerUITableStub(tapLabels) {
  const taps =
    tapLabels == null ? [] : Array.isArray(tapLabels) ? tapLabels : [tapLabels];
  const originals = {
    UITable: global.UITable,
    UITableRow: global.UITableRow,
    Font: global.Font,
    Color: global.Color
  };
  const captured = { rows: [] };
  global.UITableRow = class {
    constructor() {
      this.cells = [];
    }
    addText(title) {
      const cell = { title };
      this.cells.push(cell);
      return cell;
    }
  };
  global.UITable = class {
    constructor() {
      this.rows = [];
    }
    addRow(row) {
      this.rows.push(row);
    }
    removeAllRows() {
      this.rows = [];
    }
    reload() {}
    present() {
      captured.rows = this.rows;
      return new Promise((resolve) => {
        setImmediate(() => {
          for (const tapLabel of taps) {
            const row = this.rows.find((r) =>
              r.cells.some((c) => typeof c.title === 'string' && c.title.includes(tapLabel))
            );
            if (row && row.onSelect) row.onSelect();
          }
          captured.rows = this.rows;
          resolve();
        });
      });
    }
  };
  global.Font = { boldSystemFont: () => ({}), systemFont: () => ({}) };
  global.Color = {
    white: () => 'white',
    brown: () => 'brown',
    blue: () => 'blue',
    gray: () => 'gray'
  };
  captured.restore = () => Object.assign(global, originals);
  captured.labels = () =>
    captured.rows.map((r) => (r.cells[0] && r.cells[0].title) || '');
  captured.findRow = (label) =>
    captured.rows.find((r) =>
      r.cells.some((c) => typeof c.title === 'string' && c.title.includes(label))
    );
  return captured;
}

test('presentParserPicker pre-selects NOTHING even with a remembered selection', async () => {
  const adapter = buildAdapter();
  const files = installMemoryFm(adapter);
  const rememberedState = JSON.stringify({ selected: ['Alpha', 'Beta'] });
  files.set(adapter.getPickerStatePath(), rememberedState);

  const table = installPickerUITableStub('▶ Run selected');
  try {
    const picked = await adapter.presentParserPicker({
      parsers: [{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Gamma' }]
    });
    // "Run selected (0)" is a disabled no-op: the tap neither finishes nor
    // dismisses, so the (stubbed) swipe-down that follows resolves null.
    assert.equal(picked, null, 'tapping Run selected with zero checked runs nothing');
    assert.equal(
      files.get(adapter.getPickerStatePath()),
      rememberedState,
      'the remembered "Rerun last" state is NOT overwritten by an empty confirm'
    );

    const labels = table.labels();
    assert.ok(
      labels.includes('▶ Run selected (0)'),
      `Run selected starts at zero (labels: ${labels.join(' | ')})`
    );
    const runSelectedRow = table.findRow('▶ Run selected');
    assert.equal(
      runSelectedRow.cells[0].titleColor,
      'gray',
      'zero-selection Run selected renders gray (disabled)'
    );
    assert.equal(
      runSelectedRow.dismissOnSelect,
      false,
      'zero-selection Run selected does not dismiss the table'
    );
    assert.ok(
      labels.every((label) => !label.startsWith('☑')),
      'no parser row is pre-ticked'
    );
    assert.equal(
      labels.filter((label) => label.startsWith('☐')).length,
      3,
      'every parser row renders unchecked'
    );
  } finally {
    table.restore();
  }
});

test('presentParserPicker: a non-empty "Run selected" still runs and persists the picks', async () => {
  const adapter = buildAdapter();
  const files = installMemoryFm(adapter);
  files.set(
    adapter.getPickerStatePath(),
    JSON.stringify({ selected: ['Beta'] })
  );

  // Tap the Alpha parser row (rebuilds the table), then confirm.
  const table = installPickerUITableStub(['☐ Alpha', '▶ Run selected']);
  try {
    const picked = await adapter.presentParserPicker({
      parsers: [{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Gamma' }]
    });
    assert.deepEqual(Array.from(picked), ['Alpha'], 'the checked parser runs');
    assert.deepEqual(
      JSON.parse(files.get(adapter.getPickerStatePath())).selected,
      ['Alpha'],
      'a non-empty confirm still overwrites the remembered state'
    );

    const labels = table.labels();
    assert.ok(
      labels.includes('▶ Run selected (1)'),
      `count updates after the toggle (labels: ${labels.join(' | ')})`
    );
    const runSelectedRow = table.findRow('▶ Run selected');
    assert.equal(
      runSelectedRow.cells[0].titleColor,
      'blue',
      'armed Run selected renders blue'
    );
    assert.equal(
      runSelectedRow.dismissOnSelect,
      true,
      'armed Run selected dismisses on confirm'
    );
  } finally {
    table.restore();
  }
});

test('presentParserPicker offers "Rerun last" which runs the remembered selection', async () => {
  const adapter = buildAdapter();
  const files = installMemoryFm(adapter);
  files.set(
    adapter.getPickerStatePath(),
    JSON.stringify({ selected: ['Alpha', 'Ghost', 'Beta'] })
  );

  const table = installPickerUITableStub('↻ Rerun last');
  try {
    const picked = await adapter.presentParserPicker({
      parsers: [{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Gamma' }]
    });
    // "Ghost" is no longer configured, so it is filtered out of the remembered set
    assert.deepEqual(Array.from(picked).sort(), ['Alpha', 'Beta']);
    assert.ok(table.labels().includes('↻ Rerun last (2)'), 'row counts the known remembered parsers');
    // The confirmed selection is re-persisted so the row keeps working
    assert.deepEqual(
      JSON.parse(files.get(adapter.getPickerStatePath())).selected.sort(),
      ['Alpha', 'Beta']
    );
  } finally {
    table.restore();
  }
});

test('presentParserPicker hides "Rerun last" on the first run (nothing remembered)', async () => {
  const adapter = buildAdapter();
  installMemoryFm(adapter);

  const table = installPickerUITableStub('▶ Run all');
  try {
    const picked = await adapter.presentParserPicker({ parsers: [{ name: 'Alpha' }] });
    assert.deepEqual(Array.from(picked), ['Alpha']);
    assert.ok(
      table.labels().every((label) => !label.includes('Rerun last')),
      'no rerun row without a remembered selection'
    );
  } finally {
    table.restore();
  }
});

test('formatRerunLastSubtitle previews the remembered set and truncates long lists', () => {
  const adapter = buildAdapter();
  assert.equal(adapter.formatRerunLastSubtitle([]), '');
  assert.equal(adapter.formatRerunLastSubtitle(null), '');
  assert.equal(adapter.formatRerunLastSubtitle(['A', 'B']), 'A, B');
  assert.equal(adapter.formatRerunLastSubtitle(['A', 'B', 'C', 'D', 'E']), 'A, B, C +2 more');
});

test('presentParserPicker: swipe-down dismissal resolves null and persists nothing (headless UITable)', async () => {
  const adapter = buildAdapter();
  const files = installMemoryFm(adapter);

  // Minimal UITable stubs: present() resolves immediately without any action
  // row being tapped — exactly the swipe-down dismissal path.
  const originalUITable = global.UITable;
  const originalUITableRow = global.UITableRow;
  const originalFont = global.Font;
  const originalColor = global.Color;
  global.UITable = class {
    addRow() {}
    removeAllRows() {}
    reload() {}
    present() {
      return Promise.resolve();
    }
  };
  global.UITableRow = class {
    addText() {
      return {};
    }
  };
  global.Font = { boldSystemFont: () => ({}), systemFont: () => ({}) };
  global.Color = { white: () => ({}), brown: () => ({}), blue: () => ({}), gray: () => ({}) };

  try {
    const picked = await adapter.presentParserPicker({
      parsers: [{ name: 'Alpha' }, { name: 'Beta' }]
    });
    assert.equal(picked, null, 'dismissal → null');
    assert.equal(
      files.has(adapter.getPickerStatePath()),
      false,
      'no picker-state written on dismissal'
    );
  } finally {
    global.UITable = originalUITable;
    global.UITableRow = originalUITableRow;
    global.Font = originalFont;
    global.Color = originalColor;
  }
});

const PICKER_METRICS_FIXTURE = [
  '{"finished_at":"2026-07-20T03:00:00.000Z","parsers":[{"parser_name":"Alpha","calendar_actions":{"create":2,"update":0}}]}',
  'not json at all {{{',
  '{"finished_at":"2026-07-10T03:00:00.000Z","parsers":[{"parser_name":"Beta","calendar_actions":{"create":0,"update":1}}]}',
  '{"finished_at":"2026-07-25T03:00:00.000Z","parsers":[{"parser_name":"Alpha","calendar_actions":{"create":0,"update":0}},{"parser_name":"Beta","calendar_actions":{"create":0,"update":0}}]}',
  ''
].join('\n');

test('parseMetricsNdjsonForPicker skips malformed lines and sorts ascending by finished_at', () => {
  const adapter = buildAdapter();
  const records = adapter.parseMetricsNdjsonForPicker(PICKER_METRICS_FIXTURE);

  assert.equal(records.length, 3, 'malformed and blank lines skipped');
  assert.deepEqual(
    records.map((r) => r.finished_at),
    [
      '2026-07-10T03:00:00.000Z',
      '2026-07-20T03:00:00.000Z',
      '2026-07-25T03:00:00.000Z'
    ],
    'ascending by finished_at'
  );
  assert.deepEqual(adapter.parseMetricsNdjsonForPicker(''), []);
});

test('getLastCalendarWriteAtForPicker counts only create/update > 0 and returns null for absent parsers', () => {
  const adapter = buildAdapter();
  const records = adapter.parseMetricsNdjsonForPicker(PICKER_METRICS_FIXTURE);

  // Newest Alpha record (07-25) has 0/0 calendar actions — must NOT count;
  // the older 07-20 record with create:2 is the last real write.
  assert.equal(
    adapter.getLastCalendarWriteAtForPicker(records, 'Alpha'),
    '2026-07-20T03:00:00.000Z'
  );
  assert.equal(
    adapter.getLastCalendarWriteAtForPicker(records, 'Beta'),
    '2026-07-10T03:00:00.000Z',
    'update > 0 counts as a write'
  );
  assert.equal(
    adapter.getLastCalendarWriteAtForPicker(records, 'Nope'),
    null,
    'absent parser → null'
  );
});

test('formatDaysSinceForPicker labels: never / today / 1d ago / Nd ago', () => {
  const adapter = buildAdapter();
  assert.equal(adapter.formatDaysSinceForPicker(null), 'never');
  assert.equal(adapter.formatDaysSinceForPicker(undefined), 'never');
  assert.equal(adapter.formatDaysSinceForPicker(0.4), 'today');
  assert.equal(adapter.formatDaysSinceForPicker(1.7), '1d ago');
  assert.equal(adapter.formatDaysSinceForPicker(12.2), '12d ago');
});

test('buildParserPickerEntries orders stalest-first: never-written, then stale, then fresh', () => {
  const adapter = buildAdapter();
  const now = new Date('2026-07-27T03:00:00.000Z').getTime();
  const records = adapter.parseMetricsNdjsonForPicker(PICKER_METRICS_FIXTURE);
  const parsers = [
    { name: 'Alpha' }, // last write 7d ago (fresh-ish)
    { name: 'Beta' }, // last write 17d ago (stale)
    { name: 'Nope' } // never written
  ];

  const entries = adapter.buildParserPickerEntries(parsers, records, now);

  assert.deepEqual(
    entries.map((e) => e.name),
    ['Nope', 'Beta', 'Alpha'],
    'never-written ranks before stale ranks before fresh'
  );
  assert.equal(entries[0].daysSince, null);
  assert.equal(Math.floor(entries[1].daysSince), 17);
  assert.equal(Math.floor(entries[2].daysSince), 7);
});

// ---------------------------------------------------------------------------
// Recurring events: event-builder link, ICS export bridge, series probe
// ---------------------------------------------------------------------------

function buildRecurringCardEvent(overrides = {}) {
  return {
    title: 'FUZZY',
    _action: 'new',
    startDate: '2026-08-08T02:00:00.000Z',
    endDate: '2026-08-08T07:00:00.000Z',
    bar: 'Dallas Eagle',
    city: 'dallas',
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR',
    _recurring: true,
    _recurringExport: true,
    ...overrides
  };
}

test('event card: every event gets an Event Builder prefill link', () => {
  const adapter = buildAdapter();
  adapter.resetMapVerifyUrls();
  adapter.resetIcsExportEvents();
  const html = adapter.generateEventCard({
    title: 'One Off',
    _action: 'new',
    startDate: '2026-08-01T02:00:00.000Z',
    city: 'dallas',
    website: 'https://example.com/one-off'
  });

  assert.ok(html.includes('class="event-builder-link"'), 'builder link rendered on a plain card');
  assert.ok(html.includes('title="Open in Event Builder"'), 'icon-only builder link keeps its label as a title');
  assert.ok(!html.includes('Save recurring'), 'no ICS export button on a plain card');
  assert.ok(!html.includes('recurring — save via ICS'), 'no recurring badge on a plain card');

  const registeredUrls = Object.values(adapter._mapVerifyUrls);
  const builderUrl = registeredUrls.find((url) =>
    url.startsWith('https://chunky.dad/testing/event-builder.html?'),
  );
  assert.ok(builderUrl, 'builder URL registered through the open-url bridge');
  assert.ok(builderUrl.includes('name=One%20Off'), 'title prefilled');
  assert.ok(builderUrl.includes('city=dallas'));
  assert.ok(builderUrl.includes('website=https%3A%2F%2Fexample.com%2Fone-off'));
  assert.ok(!builderUrl.includes('recurrence='), 'no recurrence param without an rrule');
});

test('event card: builder prefill carries every flyer slot, and omits the ones the event lacks', () => {
  const adapter = buildAdapter();
  adapter.resetMapVerifyUrls();
  adapter.resetIcsExportEvents();
  adapter.generateEventCard({
    title: 'Three Flyers',
    _action: 'new',
    startDate: '2026-08-01T02:00:00.000Z',
    city: 'dallas',
    image: 'https://cdn.example.com/primary.jpg?w=1',
    imageVertical: 'https://cdn.example.com/tall.jpg',
    imageHorizontal: 'https://cdn.example.com/wide.jpg'
  });

  const builderUrl = Object.values(adapter._mapVerifyUrls).find((url) =>
    url.startsWith('https://chunky.dad/testing/event-builder.html?'),
  );
  assert.ok(builderUrl.includes('image=https%3A%2F%2Fcdn.example.com%2Fprimary.jpg%3Fw%3D1'),
    'primary image prefilled and percent-encoded');
  assert.ok(builderUrl.includes('imageVertical=https%3A%2F%2Fcdn.example.com%2Ftall.jpg'),
    'portrait slot prefilled');
  assert.ok(builderUrl.includes('imageHorizontal=https%3A%2F%2Fcdn.example.com%2Fwide.jpg'),
    'landscape slot prefilled');

  adapter.resetMapVerifyUrls();
  adapter.generateEventCard({
    title: 'One Flyer',
    _action: 'new',
    startDate: '2026-08-01T02:00:00.000Z',
    city: 'dallas',
    image: 'https://cdn.example.com/primary.jpg'
  });
  const plainUrl = Object.values(adapter._mapVerifyUrls).find((url) =>
    url.startsWith('https://chunky.dad/testing/event-builder.html?'),
  );
  assert.ok(plainUrl.includes('image=https%3A%2F%2Fcdn.example.com%2Fprimary.jpg'), 'primary still prefilled');
  assert.ok(!plainUrl.includes('imageVertical='), 'no empty portrait param');
  assert.ok(!plainUrl.includes('imageHorizontal='), 'no empty landscape param');
});

test('event card: recurring events get the badge, the builder link, and the ICS export button', () => {
  const adapter = buildAdapter();
  adapter.resetMapVerifyUrls();
  adapter.resetIcsExportEvents();
  const html = adapter.generateEventCard(buildRecurringCardEvent());

  assert.ok(html.includes('🔁 recurring — save via ICS'), 'recurring badge present');
  assert.ok(html.includes('class="event-builder-link"'), 'builder link present');
  assert.ok(html.includes('💾 Save recurring (.ics)'), 'ICS export button present');
  assert.match(html, /data-ics-export-id="\d+"/, 'export button carries a registered id');

  const registeredUrls = Object.values(adapter._mapVerifyUrls);
  const builderUrl = registeredUrls.find((url) =>
    url.startsWith('https://chunky.dad/testing/event-builder.html?'),
  );
  assert.ok(builderUrl.includes('recurrence=FREQ%3DWEEKLY%3BBYDAY%3DFR'), 'rrule prefills the builder');
  assert.ok(!builderUrl.includes('new URL'), 'sanity');
});

test('event card: a recurring event with no start time gets the builder link but no ICS export button', () => {
  const adapter = buildAdapter();
  adapter.resetMapVerifyUrls();
  adapter.resetIcsExportEvents();
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  let html;
  try {
    html = adapter.generateEventCard(buildRecurringCardEvent({
      title: 'DRINK AND DRAW',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU',
      _recurringNoStartTime: true
    }));
  } finally {
    console.log = originalLog;
  }

  assert.ok(html.includes('class="event-builder-link"'), 'builder link still present');
  assert.ok(!html.includes('💾 Save recurring (.ics)'), 'no ICS export button without a start time');
  assert.ok(logs.includes('🔁 RECURRING: "DRINK AND DRAW" has no start time — ICS export disabled, use Event Builder'),
    `gating log expected, got: ${JSON.stringify(logs.filter((l) => l.includes('RECURRING')))}`);
});

test('export-ics bridge: the handler builds the ICS for the registered event and hands it off', async () => {
  const adapter = buildAdapter();
  adapter.resetIcsExportEvents();
  const event = buildRecurringCardEvent();
  const id = adapter.registerIcsExportEvent(event);

  const exported = [];
  global.DocumentPicker = {
    exportString: async (content, name) => {
      exported.push({ content, name });
      return [name];
    }
  };
  try {
    await adapter.exportRecurringEventIcs(id);
  } finally {
    delete global.DocumentPicker;
  }

  assert.equal(exported.length, 1, 'DocumentPicker.exportString called once');
  assert.equal(exported[0].name, 'fuzzy.ics', 'slugged filename');
  const unfolded = exported[0].content.replace(/\r\n[ \t]/g, '');
  assert.ok(unfolded.includes('BEGIN:VCALENDAR'));
  assert.ok(unfolded.includes('RRULE:FREQ=WEEKLY;BYDAY=FR'), 'ICS built from the registered event');
  assert.ok(unfolded.includes('SUMMARY:FUZZY'));
  assert.ok(unfolded.includes('recurrence: FREQ=WEEKLY\\;BYDAY=FR'), 'detection line in DESCRIPTION');
});

test('export-ics bridge: shouldAllowRequest dispatches a=export-ics to the ICS handler', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(__dirname, 'scriptable-adapter.js'), 'utf8');
  // `results` rides along so the minted uid can land on the run's UID ledger.
  const branchMatch = source.match(/params\.a === "export-ics"[\s\S]{0,700}?exportRecurringEventIcs\(params\.id, results\)/);
  assert.ok(branchMatch, 'export-ics action branch wired to exportRecurringEventIcs');
  assert.ok(source.includes("'chunkyscrape://act?a=export-ics&id='"), 'page JS builds the export-ics bridge URL');
});

test('export-ics-batch bridge: shouldAllowRequest dispatches a=export-ics-batch to the batch handler', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(__dirname, 'scriptable-adapter.js'), 'utf8');
  const branchMatch = source.match(/params\.a === "export-ics-batch"[\s\S]{0,700}?exportCalendarBatchIcs\(params\.id, results\)/);
  assert.ok(branchMatch, 'export-ics-batch action branch wired to exportCalendarBatchIcs');
  assert.ok(source.includes("'chunkyscrape://act?a=export-ics-batch&id='"), 'page JS builds the export-ics-batch bridge URL');
});

test('probeRecurringSeries: published-ICS confirmation short-circuits the wide-window probe', async () => {
  const adapter = buildAdapter();
  adapter.getPublishedRecurringUids = async () => new Map([['fuzzy-uid@chunky.dad', true]]);
  let wideWindowCalls = 0;
  adapter.probeSeriesByWideWindow = async () => {
    wideWindowCalls += 1;
    return false;
  };
  const result = await adapter.probeRecurringSeries(
    { identifier: 'CAL-UUID:fuzzy-uid@chunky.dad', title: 'FUZZY' },
    { city: 'dallas' }
  );
  assert.equal(result, true, 'published RRULE UID confirms the series');
  assert.equal(wideWindowCalls, 0, 'wide-window probe skipped');
});

test('probeRecurringSeries: published UID WITHOUT an RRULE is confirmed not-a-series (probe skipped)', async () => {
  const adapter = buildAdapter();
  adapter.getPublishedRecurringUids = async () => new Map([['fuzzy-uid@chunky.dad', false]]);
  let wideWindowCalls = 0;
  adapter.probeSeriesByWideWindow = async () => {
    wideWindowCalls += 1;
    return true;
  };
  const result = await adapter.probeRecurringSeries(
    { identifier: 'CAL-UUID:fuzzy-uid@chunky.dad', title: 'FUZZY' },
    { city: 'dallas' }
  );
  assert.equal(result, false);
  assert.equal(wideWindowCalls, 0, 'probe never runs when the published calendar settles it');
});

test('probeRecurringSeries: published fetch failure falls through to the wide-window probe', async () => {
  const adapter = buildAdapter();
  adapter.getPublishedRecurringUids = async () => null; // fetch failed / no published calendar
  let wideWindowCalls = 0;
  adapter.probeSeriesByWideWindow = async () => {
    wideWindowCalls += 1;
    return true;
  };
  const result = await adapter.probeRecurringSeries(
    { identifier: 'CAL-UUID:fuzzy-uid@chunky.dad', title: 'FUZZY' },
    { city: 'dallas' }
  );
  assert.equal(result, true, 'fallback probe decision used');
  assert.equal(wideWindowCalls, 1);
});

test('probeRecurringSeries: decisions are cached per identifier per run', async () => {
  const adapter = buildAdapter();
  adapter.getPublishedRecurringUids = async () => null;
  let wideWindowCalls = 0;
  adapter.probeSeriesByWideWindow = async () => {
    wideWindowCalls += 1;
    return true;
  };
  const existingEvent = { identifier: 'CAL-UUID:fuzzy-uid@chunky.dad', title: 'FUZZY' };
  await adapter.probeRecurringSeries(existingEvent, { city: 'dallas' });
  await adapter.probeRecurringSeries(existingEvent, { city: 'dallas' });
  assert.equal(wideWindowCalls, 1, 'second call served from the per-run cache');
});

test('probeRecurringSeries fails open on errors and without an identifier', async () => {
  const adapter = buildAdapter();
  adapter.getPublishedRecurringUids = async () => {
    throw new Error('network down');
  };
  adapter.probeSeriesByWideWindow = async () => {
    throw new Error('calendar unavailable');
  };
  assert.equal(
    await adapter.probeRecurringSeries({ identifier: 'CAL-UUID:x@y', title: 'X' }, { city: 'dallas' }),
    false,
    'errors → false (today\'s behavior)'
  );
  assert.equal(await adapter.probeRecurringSeries({ title: 'no identifier' }, {}), false);
});

// ---------------------------------------------------------------------------
// saveRun payload: the top-level bearDroppedEvents copy is display-only and
// sanitized (no `_`-prefixed event keys); parserResults keeps the raw entries.
// ---------------------------------------------------------------------------

test('saveRun persists sanitized dropped entries; parserResults and live entries stay raw', async () => {
  const adapter = buildAdapter();
  const files = installMemoryFm(adapter);

  const entry = buildBearDroppedFixture();
  entry.event._parserConfig = { name: 'megaparser', urls: ['https://x.example'] };
  entry.event._sourcePageUrl = 'https://x.example/page';
  const results = {
    analyzedEvents: [],
    bearDroppedEvents: [entry],
    parserResults: [{ name: 'megaparser', bearDroppedEvents: [entry] }],
    errors: []
  };

  const runId = await adapter.saveRun(results);
  assert.ok(runId, 'run saved');
  const payload = JSON.parse(files.get(adapter.getRunFilePath(runId)));

  const saved = payload.bearDroppedEvents[0];
  assert.equal(saved.reason, 'ai: drag show, no bear context', 'drop reason survives');
  assert.equal(saved.host, 'promoter.example', 'host survives');
  assert.equal(saved.title, 'Twink Bash', 'flat title survives');
  assert.equal(saved.startDate, '2026-08-02T21:00:00.000Z', 'flat startDate survives');
  assert.equal(saved.event.title, 'Twink Bash', 'embedded event title survives');
  assert.ok(
    Object.keys(saved.event).every((key) => !key.startsWith('_')),
    'no _-prefixed keys (including _parserConfig) on the saved embedded event'
  );

  // parserResults is persisted untouched — other consumers may rely on it.
  assert.ok(
    payload.parserResults[0].bearDroppedEvents[0].event._parserConfig,
    'parserResults copy keeps the raw entry'
  );
  // The live entry is never mutated by the save.
  assert.ok(entry.event._parserConfig, 'live entry keeps its working keys');
  assert.equal(results.bearDroppedEvents[0], entry, 'live list untouched');
});

test('sanitizeDroppedEntriesForRunSave tolerates misshapen input', () => {
  const adapter = buildAdapter();
  assert.deepEqual(adapter.sanitizeDroppedEntriesForRunSave(null), []);
  assert.deepEqual(adapter.sanitizeDroppedEntriesForRunSave('nope'), []);
  assert.deepEqual(
    adapter.sanitizeDroppedEntriesForRunSave([null, { title: 'no event field' }]),
    [null, { title: 'no event field' }]
  );
});

test('export-ics bridge: ShareSheet is preferred over QuickLook and DocumentPicker', async () => {
  const adapter = buildAdapter();
  adapter.resetIcsExportEvents();
  const id = adapter.registerIcsExportEvent(buildRecurringCardEvent());

  const shared = [];
  const quickLooked = [];
  const picked = [];
  const staged = {};
  // Save/restore rather than delete: the suite installs its own FileManager
  // global that the adapter constructor needs, and deleting it here broke
  // every later test that built an adapter.
  const previousFileManager = global.FileManager;
  global.FileManager = {
    local: () => ({
      joinPath: (dir, name) => `${dir}/${name}`,
      temporaryDirectory: () => '/tmp',
      writeString: (p, contents) => { staged[p] = contents; }
    })
  };
  global.ShareSheet = { present: async (paths) => { shared.push(paths); } };
  global.QuickLook = { present: async (p) => { quickLooked.push(p); } };
  global.DocumentPicker = { exportString: async (c, n) => { picked.push(n); return [n]; } };
  try {
    await adapter.exportRecurringEventIcs(id);
  } finally {
    global.FileManager = previousFileManager;
    delete global.ShareSheet;
    delete global.QuickLook;
    delete global.DocumentPicker;
  }

  // ShareSheet is the only iOS surface that routes a .ics onward to Calendar;
  // QuickLook merely previews it, which is why the button felt broken.
  assert.equal(shared.length, 1, 'handed to the share sheet');
  assert.deepEqual(shared[0], ['/tmp/fuzzy.ics'], 'the staged .ics file is what gets shared');
  assert.equal(quickLooked.length, 0, 'QuickLook not used when ShareSheet worked');
  assert.equal(picked.length, 0, 'DocumentPicker not used when ShareSheet worked');
  const unfolded = String(staged['/tmp/fuzzy.ics']).replace(/\r\n[ \t]/g, '');
  assert.ok(unfolded.includes('RRULE:FREQ=WEEKLY;BYDAY=FR'), 'the staged file is the recurring ICS');
});

test('event builder link carries coordinates so the pin is not lost', () => {
  const adapter = buildAdapter();
  const url = adapter.buildEventBuilderUrl({
    title: 'FUZZY',
    city: 'nyc',
    location: '40.7128, -74.0060',
    ticketUrl: 'https://tickets.example/fuzzy',
    startDate: new Date('2026-08-07T02:00:00.000Z')
  });
  assert.ok(url.includes(`location=${encodeURIComponent('40.7128, -74.0060')}`),
    `coordinates present in the prefill: ${url}`);
  assert.ok(url.includes('ticketUrl='), 'ticket link carried too');
});

test('promoter registry: a freshly pulled local entry outranks a stale cached remote one', () => {
  const adapter = buildAdapter();
  const remote = [{ name: 'Goldiloxx', shortName: 'GOLDI-LOXX' }];                       // stale site copy
  const local = [{ name: 'Goldiloxx', shortName: 'GOLDI-LOXX', favicon: 'https://linktr.ee/goldiloxx' }];

  // Normal direction: the site copy is the curated source of truth.
  const remoteWins = adapter.mergeRemoteAndLocalPromoters(remote, local);
  assert.equal(remoteWins.merged.length, 1, 'one entry per promoter name');
  assert.equal(remoteWins.merged[0].favicon, undefined, 'remote wins by default');

  // Swapped direction (used when the local module is newer than the cache):
  // the pulled entry wins, and remote-only promoters are still preserved.
  const localWins = adapter.mergeRemoteAndLocalPromoters(local, [
    ...remote,
    { name: 'Remote Only', shortName: 'REMOTE' }
  ]);
  assert.equal(localWins.merged[0].favicon, 'https://linktr.ee/goldiloxx', 'pulled entry wins');
  assert.ok(localWins.merged.some(p => p.name === 'Remote Only'), 'remote-only promoters survive');
});

// ---------------------------------------------------------------------------
// Intent/write labels for a recurring series. CubScout 2026-07-31: the run
// found the saved series, merged it, and confirmed it with the wide-window
// probe — then printed "New: 1 / Intent: NEW | Write: CREATE". Both override
// signals had been erased by then (createFinalEventObject drops underscore
// metadata; the withhold branch deletes the override identity), leaving the
// display layer nothing to distinguish a match from a discovery.
// ---------------------------------------------------------------------------

test('labels: a withheld recurring series reports WITHHELD, never CREATE', () => {
  const adapter = buildAdapter();
  const series = {
    title: 'CUBSCOUT',
    _action: 'new',
    _recurring: true,
    _recurringExport: true,
    recurrenceRule: 'FREQ=MONTHLY;BYDAY=1FR'
  };
  assert.equal(adapter.getWriteActionFromEvent(series), 'withheld');
  assert.equal(adapter.formatWriteActionLabel(adapter.getWriteActionFromEvent(series)), 'WITHHELD');

  // Controls: nothing else moves.
  assert.equal(adapter.getWriteActionFromEvent({ _action: 'new' }), 'create');
  assert.equal(adapter.getWriteActionFromEvent({ _action: 'merge' }), 'update');
  assert.equal(adapter.getWriteActionFromEvent({ _action: 'time_conflict' }), 'skip');
  assert.equal(adapter.getWriteActionFromEvent({}), null);
});

test('labels: a matched series reads as MERGE intent even after its override identity is dropped', () => {
  const adapter = buildAdapter();
  // Exactly the shape buildAnalyzedCalendarEvent produces for a withheld
  // series that matched: action 'new', no override identity left, and
  // `_analysis` as the only surviving evidence of the match.
  const matchedSeries = {
    title: 'CUBSCOUT',
    _action: 'new',
    _recurring: true,
    recurrenceRule: 'FREQ=MONTHLY;BYDAY=1FR',
    _analysis: {
      action: 'new',
      reason: 'Recurring source match found - creating override',
      sourceEvent: true,
      hasOverrideIdentity: true
    }
  };
  assert.equal(adapter.normalizeIntentAction(matchedSeries), 'merge', 'not a new event');
  assert.equal(adapter.formatIntentActionLabel(adapter.normalizeIntentAction(matchedSeries)), 'MERGE');

  // A series that genuinely matched nothing still reads NEW — and is still
  // withheld, because the scraper never writes a series either way.
  const unmatchedSeries = {
    title: 'CUBSCOUT',
    _action: 'new',
    _recurring: true,
    recurrenceRule: 'FREQ=MONTHLY;BYDAY=1FR',
    _analysis: { action: 'new', reason: 'No existing events found', sourceEvent: false, hasOverrideIdentity: false }
  };
  assert.equal(adapter.normalizeIntentAction(unmatchedSeries), 'new');
  assert.equal(adapter.getWriteActionFromEvent(unmatchedSeries), 'withheld');
});

test('builder link: an override card never prefills the series rule it inherited', () => {
  const adapter = buildAdapter();
  // `recurrence` on an analyzed event is the SERIES rule leaked off the source
  // occurrence's notes during the merge — not this event's own schedule.
  // Prefilling it would let a Save turn a one-night override into a series.
  const overrideCard = {
    title: 'CUBSCOUT',
    startDate: '2026-09-05T04:00:00.000Z',
    endDate: '2026-09-05T09:00:00.000Z',
    city: 'la',
    recurrence: 'FREQ=MONTHLY;BYDAY=1FR',
    overrideUid: 'cubscout-20260730T183109Z@chunky.dad',
    overrideRecurrenceId: '20260905'
  };
  const overrideUrl = adapter.buildEventBuilderUrl(overrideCard);
  assert.ok(overrideUrl, 'a builder link is still offered');
  assert.ok(!overrideUrl.includes('recurrence='), 'but carries no rrule');

  // A real series still prefills, because it carries recurrenceRule.
  const seriesUrl = adapter.buildEventBuilderUrl({
    ...overrideCard,
    recurrenceRule: 'FREQ=MONTHLY;BYDAY=1FR'
  });
  assert.ok(seriesUrl.includes('recurrence=FREQ%3DMONTHLY%3BBYDAY%3D1FR'), 'series rrule prefills');
});

// ---------------------------------------------------------------------------
// The override-shadowing flatten inside getExistingEvents: the code that makes
// "override one occurrence" survive a re-run. It had no coverage at all, which
// is why "did we break the override logic?" could not be answered from the
// suite.
// ---------------------------------------------------------------------------

// `run` is async: the restore must wait for it, or the stubs are torn down
// before getExistingEvents ever reads them and every search comes back empty.
async function withStubbedCalendar(calendarTitle, events, run) {
  const originalCalendar = global.Calendar;
  const originalCalendarEvent = global.CalendarEvent;
  const calendar = { title: calendarTitle, identifier: 'CAL-UUID' };
  global.Calendar = { forEvents: async () => [calendar] };
  global.CalendarEvent = { between: async () => events };
  try {
    return await run();
  } finally {
    global.Calendar = originalCalendar;
    global.CalendarEvent = originalCalendarEvent;
  }
}

test('existing-event search: a saved override shadows the series occurrence it replaces', async () => {
  const adapter = new ScriptableAdapter({
    cities: { la: { calendar: 'chunky-dad-la', timezone: 'America/Los_Angeles', patterns: ['los angeles'] } }
  });
  const seriesUid = 'cubscout-20260730T183109Z@chunky.dad';
  const occurrenceStart = new Date('2026-09-05T04:00:00.000Z');
  // The recurrence id is an ICS RECURRENCE-ID (YYYYMMDD), not the dashed
  // date key normalizeEventDate produces for the shadow map.
  const recurrenceId = '20260905';

  // Both records come back from EventKit for the same day: the series
  // occurrence, and the override the scraper wrote to replace it.
  const seriesOccurrence = {
    title: 'CUBSCOUT',
    identifier: `CAL-UUID:${seriesUid}`,
    startDate: occurrenceStart,
    endDate: new Date('2026-09-05T09:00:00.000Z'),
    notes: 'bar: Eagle LA\nrecurrence: FREQ=MONTHLY;BYDAY=1FR'
  };
  const override = {
    title: 'CUBSCOUT',
    identifier: 'CAL-UUID:override-1',
    startDate: occurrenceStart,
    endDate: new Date('2026-09-05T09:00:00.000Z'),
    notes: `bar: Eagle LA\nuid: ${seriesUid}\noverrideUid: ${seriesUid}\noverrideRecurrenceId: ${recurrenceId}`
  };

  const found = await withStubbedCalendar('chunky-dad-la', [seriesOccurrence, override], () =>
    adapter.getExistingEvents({
      city: 'la',
      startDate: occurrenceStart,
      endDate: new Date('2026-09-05T09:00:00.000Z')
    })
  );

  assert.equal(found.length, 1, 'the shadowed source occurrence is dropped');
  assert.equal(found[0].identifier, 'CAL-UUID:override-1', 'the override is what matches');
});

test('existing-event search: an unrelated occurrence is never shadowed', async () => {
  const adapter = new ScriptableAdapter({
    cities: { la: { calendar: 'chunky-dad-la', timezone: 'America/Los_Angeles', patterns: ['los angeles'] } }
  });
  const seriesUid = 'cubscout-20260730T183109Z@chunky.dad';
  const occurrenceStart = new Date('2026-09-05T04:00:00.000Z');

  // An override exists, but for a DIFFERENT date — this occurrence stands.
  const seriesOccurrence = {
    title: 'CUBSCOUT',
    identifier: `CAL-UUID:${seriesUid}`,
    startDate: occurrenceStart,
    endDate: new Date('2026-09-05T09:00:00.000Z'),
    notes: 'bar: Eagle LA\nrecurrence: FREQ=MONTHLY;BYDAY=1FR'
  };
  const unrelatedOverride = {
    title: 'CUBSCOUT',
    identifier: 'CAL-UUID:override-oct',
    startDate: new Date('2026-10-03T04:00:00.000Z'),
    endDate: new Date('2026-10-03T09:00:00.000Z'),
    notes: `bar: Eagle LA\nuid: ${seriesUid}\noverrideUid: ${seriesUid}\noverrideRecurrenceId: 20261003`
  };

  const found = await withStubbedCalendar('chunky-dad-la', [seriesOccurrence, unrelatedOverride], () =>
    adapter.getExistingEvents({
      city: 'la',
      startDate: occurrenceStart,
      endDate: new Date('2026-09-05T09:00:00.000Z')
    })
  );

  assert.equal(found.length, 2, 'both records survive — different occurrences');
});

test('existing-event search: a calendar that does not exist yields no match, and says so', async () => {
  const adapter = new ScriptableAdapter({
    cities: { la: { calendar: 'chunky-dad-la', timezone: 'America/Los_Angeles', patterns: ['los angeles'] } }
  });
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  let found;
  try {
    found = await withStubbedCalendar('some-other-calendar', [], () =>
      adapter.getExistingEvents({
        city: 'la',
        startDate: new Date('2026-09-05T04:00:00.000Z'),
        endDate: new Date('2026-09-05T09:00:00.000Z')
      })
    );
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(found, [], 'no candidates');
  assert.ok(
    lines.some(l => l.includes('does not exist')),
    `the run explains the empty result rather than implying the calendar was empty: ${JSON.stringify(lines)}`
  );
});

// ---------------------------------------------------------------------------
// The Event Builder page rebuilds the WHOLE address bar from its own param
// list on load, so a param it forgets to emit is stripped before the user
// touches anything. `timezone` was missing, which silently degraded the
// event's zone to the device's and saved LA events in Eastern time.
// ---------------------------------------------------------------------------

test('event builder page re-emits the params the scraper link depends on', () => {
  const fs = require('node:fs');
  const builderPath = path.join(__dirname, '..', '..', 'testing', 'event-builder.html');
  const source = fs.readFileSync(builderPath, 'utf8');
  const shareUrlStart = source.indexOf('function buildShareUrl');
  assert.ok(shareUrlStart > -1, 'buildShareUrl still exists');
  const shareUrlBody = source.slice(shareUrlStart, shareUrlStart + 6000);

  for (const param of ['city', 'timezone']) {
    assert.ok(
      shareUrlBody.includes(`setTextParam('${param}'`),
      `buildShareUrl must re-emit '${param}' or the page strips it from the URL on load`
    );
  }
});

test('event card: a series already in the calendar says so, next to the ICS badge', () => {
  const adapter = buildAdapter();
  adapter.resetMapVerifyUrls();
  adapter.resetIcsExportEvents();

  const unmatched = adapter.generateEventCard(buildRecurringCardEvent());
  assert.ok(unmatched.includes('🔁 recurring — save via ICS'), 'the export badge is unchanged');
  assert.ok(!unmatched.includes('already saved'), 'nothing was matched, so nothing is claimed');

  const matched = adapter.generateEventCard(buildRecurringCardEvent({
    _seriesMatch: { identifier: 'CAL-UUID:fuzzy-uid@chunky.dad', title: 'FUZZY', reason: 'Recurring source match found - creating override' }
  }));
  assert.ok(matched.includes('🔁 recurring — save via ICS'), 'the export badge still renders');
  assert.ok(matched.includes('already saved — matches this series'), 'and the match is surfaced');
});

// ---------------------------------------------------------------------------
// Honest terminal state for a matched-but-withheld series: SERIES MATCH /
// WITHHELD with its own summary bucket, never counted toward ➕ New (runs
// 20260807-161034 / 20260807-114625: B BAR, CUBSCOUT, ONYX came back "NEW"
// the day after the owner saved exactly those series).
// ---------------------------------------------------------------------------

test('intent action: a series-matched withheld event reports SERIES MATCH / WITHHELD, metrics keep the base bucket', () => {
  const adapter = buildAdapter();
  const event = buildRecurringCardEvent({
    _seriesMatch: {
      identifier: 'CAL-UUID:fuzzy-uid@chunky.dad',
      instances: 2,
      calendarName: 'chunky-dad-dallas'
    }
  });

  assert.equal(adapter.normalizeIntentAction(event), 'series_match');
  assert.equal(adapter.formatIntentActionLabel('series_match'), 'SERIES MATCH');
  assert.equal(adapter.getWriteActionFromEvent(event), 'withheld');
  assert.equal(adapter.formatWriteActionLabel('withheld'), 'WITHHELD');
  // Metrics are untouched: the base derivation still buckets this as new,
  // so the metrics schema and historical comparisons keep their meaning.
  assert.equal(adapter.normalizeMetricsIntentAction(event), 'new');
  const counts = adapter.countMetricsActions([event]);
  assert.equal(counts.new, 1, 'metrics bucket unchanged');
  assert.equal(counts.other, 0, 'and nothing leaks into other');
});

test('event actions summary: series matches get their own bucket instead of counting toward New', async () => {
  const adapter = buildAdapter();
  const matchedSeries = buildRecurringCardEvent({
    _seriesMatch: { identifier: 'CAL-UUID:fuzzy-uid@chunky.dad', instances: 2, calendarName: 'chunky-dad-dallas' }
  });
  const genuinelyNewSeries = buildRecurringCardEvent({ title: 'BRAND NEW SERIES' });
  const plainNew = {
    title: 'ONE OFF',
    _action: 'new',
    startDate: '2026-08-09T02:00:00.000Z',
    city: 'dallas'
  };

  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    await adapter.displayEnrichedEvents({
      analyzedEvents: [matchedSeries, genuinelyNewSeries, plainNew],
      errors: []
    });
  } finally {
    console.log = originalLog;
  }

  assert.ok(lines.some(l => l.includes('➕ New: 2 events')),
    `the matched series is NOT new — only the genuine discoveries are: ${JSON.stringify(lines.filter(l => l.includes('events')))}`);
  assert.ok(lines.some(l => l.includes('🔁 Series match: 1 events (already saved — withheld)')),
    'the matched series gets its own bucket');
});

test('getSeriesProbeDecision: the wide-window probe caches its instance count for the honest-state report', async () => {
  const adapter = new ScriptableAdapter({
    cities: { la: { calendar: 'chunky-dad-la', timezone: 'America/Los_Angeles', patterns: ['los angeles'] } }
  });
  const identifier = 'CAL-UUID:cubscout-1@chunky.dad';
  const instances = [{ identifier }, { identifier }, { identifier: 'CAL-UUID:other' }];
  const isSeries = await withStubbedCalendar('chunky-dad-la', instances, () =>
    adapter.probeSeriesByWideWindow(identifier, 'la', 'CUBSCOUT'));

  assert.equal(isSeries, true);
  assert.deepEqual(adapter.getSeriesProbeDecision(identifier), { instanceCount: 2, isSeries: true });
  assert.equal(adapter.getSeriesProbeDecision('CAL-UUID:never-probed'), null);
  assert.equal(adapter.getSeriesProbeDecision(''), null);
});

test('getWideWindowCalendarEvents: fetches the probe window once per calendar and fails open', async () => {
  const adapter = new ScriptableAdapter({
    cities: { la: { calendar: 'chunky-dad-la', timezone: 'America/Los_Angeles', patterns: ['los angeles'] } }
  });
  const saved = [{
    identifier: 'CAL-UUID:cubscout-1@chunky.dad',
    title: 'CUBSCOUT',
    startDate: new Date('2026-09-05T04:00:00.000Z'),
    endDate: new Date('2026-09-05T09:00:00.000Z'),
    notes: 'bar: Eagle LA'
  }];

  let betweenCalls = 0;
  const originalCalendar = global.Calendar;
  const originalCalendarEvent = global.CalendarEvent;
  global.Calendar = { forEvents: async () => [{ title: 'chunky-dad-la', identifier: 'CAL-UUID' }] };
  global.CalendarEvent = { between: async () => { betweenCalls += 1; return saved; } };
  try {
    const first = await adapter.getWideWindowCalendarEvents({ city: 'la', title: 'CUBSCOUT' });
    assert.ok(first, 'lookup succeeds');
    assert.equal(first.calendarName, 'chunky-dad-la');
    assert.equal(first.events.length, 1);
    const second = await adapter.getWideWindowCalendarEvents({ city: 'la', title: 'B BAR' });
    assert.equal(second, first, 'cached per calendar per run');
    assert.equal(betweenCalls, 1, 'one calendar read for the whole run');
  } finally {
    global.Calendar = originalCalendar;
    global.CalendarEvent = originalCalendarEvent;
  }

  // Missing calendar → fail open to null (the published-ICS fallback runs).
  const failing = new ScriptableAdapter({
    cities: { la: { calendar: 'chunky-dad-la', timezone: 'America/Los_Angeles', patterns: ['los angeles'] } }
  });
  const result = await withStubbedCalendar('some-other-calendar', [], () =>
    failing.getWideWindowCalendarEvents({ city: 'la' }));
  assert.equal(result, null, 'no calendar, no candidates — never a throw');
});

// ---------------------------------------------------------------------------
// Calendar hygiene section (report-only checklist): rendered ONLY when the
// run attached findings, collapsed by default, copy button only — no button
// in it may write or delete anything.
// ---------------------------------------------------------------------------

function buildHygieneFinding(overrides = {}) {
  return {
    kind: 'superseded',
    title: 'B BAR',
    day: '2026-08-13',
    startDate: new Date('2026-08-14T04:00:00.000Z'),
    calendarName: 'chunky-dad-la',
    identifier: 'CAL-UUID:AAAAAAAA-1111-2222-3333-444444444444',
    caution: false,
    cautionReason: '',
    series: {
      identifier: 'CAL-UUID:bbar-20260801T000000Z@chunky.dad',
      title: 'B BAR',
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      instances: 2,
      ruleSource: 'published-calendar-ics'
    },
    reason: 'its date 2026-08-13 is generated by FREQ=WEEKLY;BYDAY=TH',
    ...overrides
  };
}

test('generateCalendarHygieneSection: absent when there are no findings', () => {
  const adapter = buildAdapter();
  assert.equal(adapter.generateCalendarHygieneSection({}), '');
  assert.equal(adapter.generateCalendarHygieneSection({ calendarHygiene: [] }), '');
  assert.equal(adapter.generateCalendarHygieneSection(null), '');
});

test('generateCalendarHygieneSection: renders the collapsed checklist with copy button and distinct off-pattern label', () => {
  const adapter = buildAdapter();
  const html = adapter.generateCalendarHygieneSection({
    calendarHygiene: [
      buildHygieneFinding(),
      buildHygieneFinding({
        kind: 'off-pattern',
        title: 'SUNDAY BEER BUST',
        day: '2026-08-09',
        identifier: 'CAL-UUID:CA8D02F4-CC9F-414D-913F-5E782016485D',
        caution: true,
        cautionReason: 'bearSource: manual-bear (overrode ai: flyer says bears)',
        series: {
          identifier: 'CAL-UUID:sunday-beer-bust@chunky.dad',
          title: 'SUNDAY BEER BUST',
          rrule: 'FREQ=WEEKLY;BYDAY=SU',
          instances: 1,
          ruleSource: 'published-calendar-ics'
        },
        reason: 'the saved series explicitly excludes 2026-08-09 (EXDATE)'
      })
    ]
  });

  assert.ok(html.includes('Calendar hygiene'), 'section title present');
  assert.ok(html.includes('<details>'), 'collapsed by default');
  assert.ok(html.includes('2 event(s) look superseded by saved series'), 'summary line carries the count');
  assert.ok(html.includes('B BAR') && html.includes('SUNDAY BEER BUST'), 'both findings render');
  assert.ok(html.includes('off-pattern single — might be a special night'), 'off-pattern label is distinct');
  assert.ok(html.includes('looks superseded — series covers this night'), 'superseded label present');
  assert.ok(html.includes('copyDiscoveryText'), 'reuses the existing copy-button pattern');
  assert.ok(html.includes('manual bear verdict/review flag'), 'caution tag rendered');
  assert.ok(html.includes('NEVER deletes'), 'the section says what it will never do');
  // No write/delete affordances: the only handler in the section is the copy
  // button (the chunkyscrape:// bridge actions never appear here).
  assert.ok(!html.includes('chunkyscrape://'), 'no native-bridge action buttons in a report-only section');

  const copyText = adapter.buildCalendarHygieneCopyText(
    adapter.getCalendarHygieneFindings({ calendarHygiene: [buildHygieneFinding()] })
  );
  assert.ok(copyText.startsWith('SUPERSEDED: "B BAR" 2026-08-13'), copyText);
});

test('displayEnrichedEvents: additive hygiene summary line only when findings exist — existing line shapes untouched', async () => {
  const adapter = buildAdapter();
  const baseResults = {
    analyzedEvents: [{
      title: 'ONE OFF',
      startDate: new Date('2026-08-14T04:00:00.000Z'),
      city: 'la',
      _action: 'new',
      _analysis: { action: 'new', reason: 'New event' }
    }]
  };
  const capture = async (results) => {
    const lines = [];
    const originalLog = console.log;
    console.log = (message) => { lines.push(String(message)); };
    try {
      await adapter.displayEnrichedEvents(results);
    } finally {
      console.log = originalLog;
    }
    return lines;
  };

  const without = await capture({ ...baseResults });
  assert.ok(!without.some(l => l.includes('🧹 Calendar hygiene:')), 'no findings → no line');

  const withFindings = await capture({ ...baseResults, calendarHygiene: [buildHygieneFinding()] });
  assert.ok(
    withFindings.some(l => l === '   🧹 Calendar hygiene: 1 event(s) look superseded by saved series (report-only — deletion stays manual)'),
    `the additive summary line renders: ${JSON.stringify(withFindings.filter(l => l.includes('🧹')))}`
  );
  // The existing summary line shapes are unchanged in both runs.
  for (const lines of [without, withFindings]) {
    assert.ok(lines.some(l => l.startsWith('   ➕ New: ')), 'New line untouched');
    assert.ok(lines.some(l => l.startsWith('   🔀 Merge: ')), 'Merge line untouched');
  }
});

test('getPublishedCalendarRecords: parses the published city ICS through the shared body fetch', async () => {
  const adapter = buildAdapter();
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;TZID=America/Los_Angeles:20260904T210000',
    'RRULE:FREQ=MONTHLY;BYDAY=1FR',
    'UID:cubscout-20260731T193113Z@chunky.dad',
    'SUMMARY:CUBSCOUT',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const fetched = [];
  adapter.fetchPublishedCalendarIcsBody = async (cityKey) => {
    fetched.push(cityKey);
    return ics;
  };

  const records = await adapter.getPublishedCalendarRecords('la');
  assert.ok(Array.isArray(records));
  assert.equal(records.length, 1);
  assert.equal(records[0].uid, 'cubscout-20260731T193113Z@chunky.dad');
  assert.equal(records[0].summary, 'CUBSCOUT');
  assert.equal(records[0].rrule, 'FREQ=MONTHLY;BYDAY=1FR');

  await adapter.getPublishedCalendarRecords('la');
  assert.deepEqual(fetched, ['la'], 'memoized per city per run');
  assert.equal(await adapter.getPublishedCalendarRecords(''), null, 'no city, no fetch');
});

test('event card actions: a recurrence-only builder event now gets the ICS export button', () => {
  const adapter = buildAdapter();
  adapter.resetMapVerifyUrls();
  adapter.resetIcsExportEvents();
  const builderEvent = {
    title: 'CUBSCOUT',
    startDate: '2026-09-05T04:00:00.000Z',
    endDate: '2026-09-05T09:00:00.000Z',
    city: 'la',
    // The canonical schema field only — no recurrenceRule, no _recurring.
    recurrence: 'FREQ=MONTHLY;BYDAY=1FR'
  };
  const html = adapter.buildEventCardActionsHtml(builderEvent);
  assert.ok(html.includes('Save recurring (.ics)'),
    'the RRULE is routed to the ICS channel instead of silently dropping');
});

test('getEventOverrideIdentity: notes-carried override identity, source uid, and date key', () => {
  const adapter = buildAdapter();
  const uid = 'cubscout-20260731T193113Z@chunky.dad';
  const override = {
    identifier: 'CAL-UUID:override-1',
    startDate: new Date('2026-09-05T04:00:00.000Z'),
    notes: `bar: Eagle LA\nuid: ${uid}\noverrideUid: ${uid}\noverrideRecurrenceId: 20260905`
  };
  const identity = adapter.getEventOverrideIdentity(override);
  assert.equal(identity.overrideUid, uid);
  assert.equal(identity.overrideRecurrenceId, '20260905');
  assert.equal(identity.overrideKey, `${uid.toLowerCase()}::20260905`);
  assert.equal(identity.sourceUid, uid);
  assert.ok(identity.recurrenceDateKey, 'the occurrence date key is derived from the start date');

  // A plain series occurrence has NO override identity, only a source uid.
  const occurrence = {
    identifier: `CAL-UUID:${uid}`,
    startDate: new Date('2026-09-05T04:00:00.000Z'),
    notes: 'bar: Eagle LA'
  };
  const plain = adapter.getEventOverrideIdentity(occurrence);
  assert.equal(plain.overrideKey, '', 'no override claim');
  assert.equal(plain.sourceUid, uid, 'the identifier suffix IS the ICS UID');

  const empty = adapter.getEventOverrideIdentity(null);
  assert.equal(empty.overrideKey, '');
  assert.equal(empty.sourceUid, '');
});

test('normalizeOverrideUid delegates to the shared normalization (trim, keep case)', () => {
  const adapter = buildAdapter();
  assert.equal(adapter.normalizeOverrideUid('  MixedCase@Chunky.dad '), 'MixedCase@Chunky.dad');
  assert.equal(adapter.normalizeOverrideUid(null), '');
});

// ---------------------------------------------------------------------------
// Event Builder links carry editing context when the run matched a record.
// Without it the builder opened in "brand new event" mode even though the run
// had just matched and merged the event — so a saved series kept being
// re-created instead of updated.
// ---------------------------------------------------------------------------

function builderParams(url) {
  return new Set((url.split('?')[1] || '').split('&').map(p => p.split('=')[0]));
}

test('builder link: a genuine discovery carries no editing context', () => {
  const adapter = buildAdapter();
  const url = adapter.buildEventBuilderUrl({
    title: 'CUBSCOUT', city: 'la',
    startDate: '2026-09-05T04:00:00.000Z', endDate: '2026-09-05T09:00:00.000Z'
  });
  const params = builderParams(url);
  for (const key of ['edit', 'euid', 'emode', 'searchStartDate', 'searchEndDate']) {
    assert.ok(!params.has(key), `${key} must be absent — nothing was matched`);
  }
});

test('builder link: a matched series opens in series mode, pointed at the saved record', () => {
  const adapter = buildAdapter();
  const url = adapter.buildEventBuilderUrl({
    title: 'CUBSCOUT', city: 'la',
    startDate: '2026-09-05T04:00:00.000Z', endDate: '2026-09-05T09:00:00.000Z',
    _recurring: true,
    recurrenceRule: 'FREQ=MONTHLY;BYDAY=1FR',
    _seriesMatch: {
      identifier: 'CAL-UUID:cubscout-20260730T183109Z@chunky.dad',
      startDate: new Date('2026-09-05T04:00:00.000Z'),
      endDate: new Date('2026-09-05T09:00:00.000Z')
    }
  });

  assert.ok(url.includes('edit=1'), 'the page is told this is an edit');
  // Bare ICS UID: the builder matches against the published city ICS, which
  // never sees Scriptable's `<calendarUUID>:` prefix.
  assert.ok(url.includes('euid=cubscout-20260730T183109Z%40chunky.dad'), 'names the saved record');
  assert.ok(!url.includes('CAL-UUID'), 'the calendar uuid prefix is stripped');
  assert.ok(url.includes('emode=series'), 'series mode routes the save to the ICS export');
  // The identifier match compares searchStartDate to the matched record's own
  // start, so it must be the record's time, not the scraped one.
  assert.ok(url.includes('searchStartDate=2026-09-05T04%3A00%3A00.000Z'), 'search window is the record’s');
  assert.ok(url.includes('searchEndDate=2026-09-05T09%3A00%3A00.000Z'));
});

test('builder link: a merged existing event opens in occurrence mode, keeping the Scriptable handoff', () => {
  const adapter = buildAdapter();
  const url = adapter.buildEventBuilderUrl({
    title: 'ONE OFF', city: 'la',
    startDate: '2026-09-05T04:00:00.000Z', endDate: '2026-09-05T09:00:00.000Z',
    _action: 'merge',
    _existingEvent: {
      identifier: 'CAL-UUID:plain@chunky.dad',
      startDate: new Date('2026-09-05T04:00:00.000Z'),
      endDate: new Date('2026-09-05T09:00:00.000Z')
    }
  });

  assert.ok(url.includes('edit=1'));
  assert.ok(url.includes('euid=plain%40chunky.dad'));
  // 'occurrence' with no occurrence id is a plain existing-event edit — the
  // builder keeps the Scriptable button live, which is the one-tap update.
  assert.ok(url.includes('emode=occurrence'));
  assert.ok(url.includes('searchStartDate='));
});

test('builder link: a matched record with no identifier adds nothing', () => {
  const adapter = buildAdapter();
  const url = adapter.buildEventBuilderUrl({
    title: 'CUBSCOUT', city: 'la',
    startDate: '2026-09-05T04:00:00.000Z',
    _seriesMatch: { identifier: '', startDate: new Date('2026-09-05T04:00:00.000Z') }
  });
  assert.ok(!builderParams(url).has('edit'), 'no identity, no claim');
});

test('builder link: a matched series pre-selects the record without flipping into override mode', () => {
  const adapter = buildAdapter();
  const url = adapter.buildEventBuilderUrl({
    title: 'CUBSCOUT', city: 'la',
    startDate: '2026-09-05T04:00:00.000Z', endDate: '2026-09-05T09:00:00.000Z',
    _recurring: true,
    recurrenceRule: 'FREQ=MONTHLY;BYDAY=1FR',
    _seriesMatch: {
      identifier: 'CAL-UUID:cubscout-20260730T183109Z@chunky.dad',
      startDate: new Date('2026-09-05T04:00:00.000Z'),
      endDate: new Date('2026-09-05T09:00:00.000Z')
    }
  });

  // The picker's own id carries a browser-formatted date key off the series
  // anchor, which the phone cannot know — but renderExistingResults falls back
  // to matching the uid segment alone.
  const occid = decodeURIComponent((url.split('occid=')[1] || '').split('&')[0]);
  assert.equal(occid, 'cubscout-20260730T183109Z@chunky.dad::series::');
  // 'series' (not 'occurrence'/'override') keeps isOccurrenceResultId false, so
  // the page does not read this as an occurrence-override edit.
  assert.equal(occid.split('::')[1], 'series');

  // A plain existing-event edit needs no picker — the Scriptable handoff is
  // the one-tap update there.
  const plain = adapter.buildEventBuilderUrl({
    title: 'ONE OFF', city: 'la',
    startDate: '2026-09-05T04:00:00.000Z',
    _action: 'merge',
    _existingEvent: { identifier: 'CAL-UUID:plain@chunky.dad', startDate: new Date('2026-09-05T04:00:00.000Z') }
  });
  assert.ok(!plain.includes('occid='), 'no picker pre-selection for a standalone edit');
});

// ---------------------------------------------------------------------------
// REPORT-ONLY sanity flags in the results UI: compact badge on the event
// card, adjacent line in the enriched-events sample, and an Event Actions
// Summary count line that appears ONLY when something is flagged. Flags are
// stamped upstream (SharedCore.getEventSanityFlags) — the adapter only
// renders them, never alters an action.
// ---------------------------------------------------------------------------

test('generateEventCard shows the sanity badge only on flagged events', () => {
  const adapter = buildAdapter();
  const flagged = adapter.generateEventCard({
    title: '6:30 PM',
    _action: 'new',
    startDate: '2026-08-01T02:00:00.000Z',
    _sanityFlags: [
      { code: 'title-is-date-phrase', detail: 'title is entirely a date/time expression' },
      { code: 'duration-implausible', detail: 'spans 575.4 days (longest curated festival is 10)' }
    ]
  });
  assert.ok(flagged.includes('sanity-flag-badge'));
  assert.ok(flagged.includes('⚠️ sanity: title-is-date-phrase, duration-implausible'));

  const plain = adapter.generateEventCard({
    title: 'Plain',
    _action: 'new',
    startDate: '2026-08-01T02:00:00.000Z',
    _sanityFlags: []
  });
  assert.ok(!plain.includes('sanity-flag-badge'));
  // Absent field (saved runs from before the stamp) renders like empty.
  const legacy = adapter.generateEventCard({
    title: 'Legacy',
    _action: 'new',
    startDate: '2026-08-01T02:00:00.000Z'
  });
  assert.ok(!legacy.includes('sanity-flag-badge'));
});

test('Event Actions Summary carries the sanity count line only when events are flagged', async () => {
  const adapter = buildAdapter();
  const capture = async (results) => {
    const lines = [];
    const originalLog = console.log;
    console.log = (...args) => { lines.push(args.join(' ')); };
    try {
      await adapter.displayEnrichedEvents(results);
    } finally {
      console.log = originalLog;
    }
    return lines;
  };

  const flaggedLines = await capture({
    analyzedEvents: [
      {
        title: '6:30 PM',
        _action: 'new',
        startDate: '2026-08-01T02:00:00.000Z',
        _sanityFlags: [{ code: 'title-is-date-phrase', detail: 'title is entirely a date/time expression' }]
      },
      {
        title: 'Plain',
        _action: 'new',
        startDate: '2026-08-01T02:00:00.000Z',
        _sanityFlags: []
      }
    ]
  });
  assert.ok(
    flaggedLines.includes('   ⚠️ Sanity flags: 1 event(s)'),
    `expected the count line, got: ${JSON.stringify(flaggedLines.filter(line => line.includes('Sanity')))}`);
  // The sample event block gets the adjacent per-event line too.
  assert.ok(flaggedLines.includes('  ⚠️ Sanity: title-is-date-phrase'));

  const cleanLines = await capture({
    analyzedEvents: [
      {
        title: 'Plain',
        _action: 'new',
        startDate: '2026-08-01T02:00:00.000Z',
        _sanityFlags: []
      }
    ]
  });
  assert.ok(
    !cleanLines.some(line => line.includes('Sanity')),
    `no sanity lines when nothing is flagged, got: ${JSON.stringify(cleanLines.filter(line => line.includes('Sanity')))}`);
});

// ---------------------------------------------------------------------------
// Calendar write-time end-date guard (resolveCalendarWriteEndDate). The two
// merge paths in shared-core have consulted hasDegenerateEnd since those rules
// were written; the CREATE path assigned `calendarEvent.endDate = event.endDate`
// with no check at all, and the UPDATE path did the same to the live record.
// ---------------------------------------------------------------------------

test('calendar write: an inverted end span is refused, never handed to EventKit', () => {
  const adapter = buildAdapter();
  const logs = [];
  const originalLog = console.log;
  console.log = (message) => { logs.push(String(message)); };
  let written;
  try {
    written = adapter.resolveCalendarWriteEndDate({
      title: 'PERVERT',
      startDate: new Date('2026-08-02T22:00:00.000Z'),
      endDate: new Date('2026-08-02T20:00:00.000Z')
    });
  } finally {
    console.log = originalLog;
  }
  // EventKit refuses an inverted span; the throw lands in the caller's catch as
  // a "failed" event, i.e. a silent drop of a real night.
  assert.equal(written.toISOString(), '2026-08-02T22:00:00.000Z', 'the start is written instead');
  assert.ok(
    logs.some((line) => line.includes('endDate is before startDate')),
    `expected a refusal log, got: ${JSON.stringify(logs)}`
  );
});

test('calendar write: a zero-duration end and a real end both pass through untouched', () => {
  const adapter = buildAdapter();
  // EKEvent has no way to say "no end stated" — an end date is mandatory — so
  // `end === start` IS that statement on this platform. 48 of the 134 events
  // analyzed on 2026-08-02 are exactly that (Eagle LA flyers: "BAR OPENS 2PM",
  // "9PM EVERY SUNDAY"). Inventing a duration would fabricate data; the shape
  // is reported instead via SharedCore's `end-not-after-start` sanity flag.
  const zeroStart = new Date('2026-08-02T21:00:00.000Z');
  assert.equal(
    adapter.resolveCalendarWriteEndDate({ title: 'SUNDAY BEER BUST', startDate: zeroStart, endDate: zeroStart }),
    zeroStart
  );
  const realEnd = new Date('2026-08-03T02:00:00.000Z');
  assert.equal(
    adapter.resolveCalendarWriteEndDate({ title: 'PACK PARTY', startDate: zeroStart, endDate: realEnd }),
    realEnd
  );
  // Missing/unparseable ends are left exactly as they are (fail open).
  assert.equal(
    adapter.resolveCalendarWriteEndDate({ title: 'PACK PARTY', startDate: zeroStart, endDate: undefined }),
    undefined
  );
});

// ---------------------------------------------------------------------------
// Series authority in the results UI. SharedCore stamps three fields; the
// adapter only renders them.
//   _seriesAuthority = 'slot-host'    → this run writes a single-occurrence
//                                       override of someone else's series
//   _cadenceHint                      → a cadence the page implies, reported
//                                       and never turned into an RRULE
//   _seriesChangeProposal             → a series owner asserts a different
//                                       schedule; the run REFUSES to write it
// Every surface below is additive: with all three absent the render and the
// console output are exactly what they were before.
// ---------------------------------------------------------------------------

// A real city config so the occurrence date is resolved in the calendar's
// timezone rather than falling back to UTC.
function buildAuthorityAdapter() {
  return new ScriptableAdapter({
    cities: { la: { calendar: 'chunky-dad-la', timezone: 'America/Los_Angeles', patterns: ['los angeles', 'la'] } }
  });
}

// The two real Eagle LA cases from the 2026-08-03 run.
function buildSlotHostOverrideEvent(overrides = {}) {
  return {
    title: 'Bear Happy Hour',
    _action: 'new',
    startDate: '2026-08-07T00:00:00.000Z',
    bar: 'Eagle LA',
    city: 'la',
    _seriesAuthority: 'slot-host',
    overrideUid: 'bear-happy-hour@chunky.dad',
    overrideRecurrenceId: '20260807T000000Z',
    ...overrides
  };
}

function buildSeriesOwnerProposalEvent(overrides = {}) {
  return {
    title: 'MOVIE MONDAYS',
    _action: 'new',
    startDate: '2026-08-04T02:00:00.000Z',
    bar: 'Eagle LA',
    city: 'la',
    _recurring: true,
    _seriesAuthority: 'series-owner',
    _seriesChangeProposal: {
      field: 'recurrence',
      current: 'FREQ=WEEKLY;BYDAY=MO',
      proposed: 'FREQ=WEEKLY;BYDAY=TU',
      evidence: 'Movie Mondays moves to Tuesdays starting in August',
      sourceUrl: 'https://eaglela.com/events/movie-mondays/',
      calendarName: 'chunky-dad-la'
    },
    ...overrides
  };
}

test('override card: slot-host events are badged as a single-occurrence override and name the night', () => {
  const adapter = buildAuthorityAdapter();
  const card = adapter.generateEventCard(buildSlotHostOverrideEvent());

  assert.ok(card.includes('series-override-badge'), 'override badge present');
  assert.ok(card.includes('🗓️ override — this date only'), 'card states the override state in words');
  // Which occurrence: the RECURRENCE-ID rendered in the calendar's timezone —
  // 2026-08-07T00:00Z is Thursday Aug 6 in Los Angeles, not Friday Aug 7.
  assert.ok(card.includes('Thu, Aug 6, 2026'), `expected the LA-local occurrence date, got: ${card.slice(0, 900)}`);
  // Distinct from NEW/CREATE in the write tag on the face, not only in the
  // override badge (the old expander "Write: …" note is compressed to a tag).
  assert.ok(card.includes('write-badge">OVERRIDE</span>'), 'write tag says OVERRIDE');
  assert.ok(!card.includes('write-badge">CREATE</span>'), 'an override is never reported as a plain create');

  const plain = adapter.generateEventCard({ title: 'Plain', _action: 'new', startDate: '2026-08-07T00:00:00.000Z' });
  assert.ok(!plain.includes('series-override-badge'), 'no badge without the stamp');
  assert.ok(plain.includes('write-badge">CREATE</span>'), 'unstamped events keep their old write label');
});

test('override label falls back to the event start, and a floating RECURRENCE-ID is read as a wall clock', () => {
  const adapter = buildAuthorityAdapter();
  // No override identity stamped yet: the event's own start names the night.
  const noIdentity = adapter.generateEventCard(
    buildSlotHostOverrideEvent({ overrideUid: '', overrideRecurrenceId: '' })
  );
  assert.ok(noIdentity.includes('🗓️ override — this date only: Thu, Aug 6, 2026'), 'falls back to the start date');

  // TZID form: the digits ARE the local date, so no timezone shifting.
  const zoned = adapter.generateEventCard(
    buildSlotHostOverrideEvent({ overrideRecurrenceId: 'TZID=America/Los_Angeles:20260813T170000' })
  );
  assert.ok(zoned.includes('Thu, Aug 13, 2026'), `expected the wall-clock date, got: ${zoned.slice(0, 900)}`);
});

test('a recurring series stamped slot-host stays WITHHELD — the label never promises a write the run skips', () => {
  const adapter = buildAuthorityAdapter();
  const event = buildSlotHostOverrideEvent({ _recurring: true });
  assert.equal(adapter.getWriteActionFromEvent(event), 'withheld');
  const card = adapter.generateEventCard(event);
  assert.ok(card.includes('write-badge">WITHHELD</span>'), 'filterEventsForExecution is the real gate');
  assert.ok(card.includes('series-override-badge'), 'the override state is still surfaced (flag, do not drop)');
});

test('cadence hints are reported on the card and never become a series write', () => {
  const adapter = buildAuthorityAdapter();
  const card = adapter.generateEventCard(buildSlotHostOverrideEvent({
    _cadenceHint: {
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      evidence: 'Bear Happy Hour every Thursday <script>alert(1)</script>',
      sourceUrl: 'https://eaglela.com/events/bear-happy-hour-2/'
    }
  }));
  assert.ok(card.includes('Cadence hint (not written): FREQ=WEEKLY;BYDAY=TH'), 'hint surfaced');
  assert.ok(!card.includes('<script>alert(1)</script>'), 'page-derived evidence is escaped');
  assert.ok(card.includes('&lt;script&gt;'), 'escaped rather than dropped');
  assert.ok(card.includes('write-badge">OVERRIDE</span>'), 'a cadence hint does not upgrade the write to a series');
});

test('series-change proposals render current vs proposed with evidence, source and calendar', () => {
  const adapter = buildAuthorityAdapter();
  const html = adapter.generateSeriesChangeProposalSection({
    analyzedEvents: [buildSeriesOwnerProposalEvent(), { title: 'Plain', _action: 'new' }]
  });

  assert.ok(html.includes('Series-change proposals'), 'section header');
  assert.ok(html.includes('MOVIE MONDAYS'), 'names the series');
  assert.ok(html.includes('Calendar says today'), 'current side labelled');
  assert.ok(html.includes('FREQ=WEEKLY;BYDAY=MO'), 'current value');
  assert.ok(html.includes('Source proposes'), 'proposed side labelled');
  assert.ok(html.includes('FREQ=WEEKLY;BYDAY=TU'), 'proposed value');
  assert.ok(html.includes('Movie Mondays moves to Tuesdays starting in August'), 'verbatim evidence');
  assert.ok(html.includes('href="https://eaglela.com/events/movie-mondays/"'), 'source link');
  assert.ok(html.includes('chunky-dad-la'), 'calendar name');
  assert.ok(html.includes('Field: recurrence'), 'which field is proposed');
  assert.ok(html.includes('not written'), 'says plainly that nothing was written');

  assert.equal(
    adapter.generateSeriesChangeProposalSection({ analyzedEvents: [{ title: 'Plain', _action: 'new' }] }),
    '',
    'no section without proposals');
  assert.equal(adapter.generateSeriesChangeProposalSection({}), '', 'missing analyzedEvents is not an error');
});

test('proposals collapse per series and escape everything page-derived', () => {
  const adapter = buildAuthorityAdapter();
  // Two occurrences of the same series carry the same proposal: one decision.
  const duplicated = adapter.collectSeriesChangeProposals({
    analyzedEvents: [
      buildSeriesOwnerProposalEvent(),
      buildSeriesOwnerProposalEvent({ startDate: '2026-08-11T02:00:00.000Z' })
    ]
  });
  assert.equal(duplicated.length, 1, 'one proposal per series, not per date');

  const hostile = adapter.generateSeriesChangeProposalSection({
    analyzedEvents: [buildSeriesOwnerProposalEvent({
      title: 'MOVIE <b>MONDAYS</b>',
      _seriesChangeProposal: {
        field: 'recurrence',
        current: 'FREQ=WEEKLY;BYDAY=MO',
        proposed: '"><img src=x onerror=alert(1)>',
        evidence: 'moves to <script>alert(1)</script> Tuesdays',
        sourceUrl: 'javascript:alert(1)',
        calendarName: 'chunky-dad-la'
      }
    })]
  });
  assert.ok(!hostile.includes('<b>MONDAYS</b>'), 'title escaped');
  assert.ok(!hostile.includes('<script>alert(1)</script>'), 'evidence escaped');
  assert.ok(!hostile.includes('<img src=x'), 'proposed value escaped');
  assert.ok(!hostile.includes('href="javascript:'), 'a non-http source is never linkified');
  assert.ok(hostile.includes('javascript:alert(1)'.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))), 'but is still shown as text (flag, do not drop)');
});

test('SAFETY: a series-change proposal never changes the write plan', () => {
  const adapter = buildAuthorityAdapter();
  const withProposal = buildSeriesOwnerProposalEvent();
  const { _seriesChangeProposal, _seriesAuthority, ...withoutProposal } = withProposal;

  assert.equal(
    adapter.getWriteActionFromEvent(withProposal),
    adapter.getWriteActionFromEvent(withoutProposal),
    'write action identical with and without the proposal');
  assert.equal(
    adapter.normalizeIntentAction(withProposal),
    adapter.normalizeIntentAction(withoutProposal),
    'intent action identical');
  assert.deepEqual(
    adapter.countMetricsCalendarActions([withProposal]),
    adapter.countMetricsCalendarActions([withoutProposal]),
    'write-plan counts identical');
  assert.deepEqual(
    adapter.countMetricsActions([withProposal]),
    adapter.countMetricsActions([withoutProposal]),
    'intent counts identical');

  // And the event stays out of execution for the reason it always did
  // (recurring series are ICS-only) — the proposal neither adds nor removes it.
  const { SharedCore: Core } = require('../shared-core');
  assert.equal(Core.filterEventsForExecution([withProposal]).length, 0);
  assert.equal(
    Core.filterEventsForExecution([withProposal]).length,
    Core.filterEventsForExecution([withoutProposal]).length,
    'execution set identical');

  // Nothing is hidden either: the event still renders its own card.
  assert.ok(adapter.generateEventCard(withProposal).includes('MOVIE MONDAYS'));
  assert.ok(adapter.generateEventCard(withProposal).includes('series-proposal-badge'), 'and is badged');
});

test('generateRichHTML embeds the proposals section only when a proposal exists', async () => {
  const adapter = buildAuthorityAdapter();
  const withProposal = await adapter.generateRichHTML({
    analyzedEvents: [buildSeriesOwnerProposalEvent(), buildSlotHostOverrideEvent()]
  });
  assert.ok(withProposal.includes('Series-change proposals'), 'section rendered');
  assert.ok(withProposal.includes('series-override-badge'), 'override card rendered in the same page');

  const withoutProposal = await adapter.generateRichHTML(buildResultsStub());
  assert.ok(!withoutProposal.includes('Series-change proposals'), 'no section without proposals');
  assert.ok(!withoutProposal.includes('series-override-badge'), 'no override badge without the stamp');
});

test('run summary counts overrides and proposals, and stays silent when there are none', async () => {
  const adapter = buildAuthorityAdapter();
  const capture = async (results) => {
    const lines = [];
    const originalLog = console.log;
    console.log = (...args) => { lines.push(args.join(' ')); };
    try {
      await adapter.displayEnrichedEvents(results);
    } finally {
      console.log = originalLog;
    }
    return lines;
  };

  const lines = await capture({
    analyzedEvents: [buildSlotHostOverrideEvent(), buildSeriesOwnerProposalEvent()]
  });
  assert.ok(
    lines.includes('   🗓️ Single-occurrence overrides: 1 event(s)'),
    `expected the override count line, got: ${JSON.stringify(lines.filter(l => l.includes('verride')))}`);
  assert.ok(
    lines.includes('   📐 Series-change proposals: 1 (not written — owner decides)'),
    `expected the proposal count line, got: ${JSON.stringify(lines.filter(l => l.includes('roposal')))}`);
  // The sampled event block carries the detail lines too.
  assert.ok(
    lines.some(l => l.startsWith('  🗓️ Override: single occurrence — Thu, Aug 6, 2026')),
    `expected the per-event override line, got: ${JSON.stringify(lines.filter(l => l.includes('Override')))}`);

  const proposalSample = await capture({ analyzedEvents: [buildSeriesOwnerProposalEvent()] });
  assert.ok(
    proposalSample.some(l => l === '  📐 Series-change proposal (not written): recurrence FREQ=WEEKLY;BYDAY=MO → FREQ=WEEKLY;BYDAY=TU'),
    `expected the per-event proposal line, got: ${JSON.stringify(proposalSample.filter(l => l.includes('📐')))}`);

  const quiet = await capture(buildResultsStub());
  assert.ok(
    !quiet.some(l => l.includes('verride') || l.includes('roposal')),
    `no authority lines when nothing is stamped, got: ${JSON.stringify(quiet)}`);
});

// ---------------------------------------------------------------------------
// Results-HTML size (run 20260803-143036: 52 analyzed events rendered a
// 3198 KB page, WebView.loadHTML white-screened, and the log shows the owner
// "reviewing" 52 events in 3.3 seconds — i.e. he never saw them). Every run
// he actually reviewed rendered at <= 1923 KB.
//
// The page was NOT big because of images, CSS or scripts. Measured on that
// exact run it was: the same event JSON embedded THREE times per card
// (2 x data-event-json + the raw <pre>) = 1290 KB / 43%; ~2400 merge-table
// cells each carrying ~200 bytes of duplicated inline style = 300 KB; and a
// line-by-line diff that emitted every value in full, both sides, uncapped.
//
// These guards are about construction, not one lucky number: the payload and
// the diff renderings draw from DOCUMENT-WIDE budgets, so their contribution
// is bounded by a constant instead of growing with the event count.
// ---------------------------------------------------------------------------

function buildSizedAnalyzedEvent(index) {
  // Shaped like the real run's merge events: long notes + description, a
  // full _original triple, per-field priorities and merge bookkeeping.
  const blurb =
    `Doors at 9. ${'Bears, cubs, otters and their admirers welcome. '.repeat(24)}`;
  const notes = [
    'website: https://example.com/party',
    'instagram: https://instagram.com/example',
    `description: ${blurb}`,
    `shortName: Party ${index}`
  ].join('\n');
  const scraper = {
    title: `MEGAWOOF ${index}`,
    description: `${blurb}NEW LOCATION for ${index}.`,
    startDate: '2026-09-01T02:00:00.000Z',
    endDate: '2026-09-01T08:00:00.000Z',
    bar: `Club ${index}`,
    address: `${index} Main St, Los Angeles, CA`,
    url: `https://example.com/e/${index}`,
    image: `https://example.com/img/${index}.jpg`,
    notes
  };
  const calendar = {
    ...scraper,
    description: `${blurb}OLD LOCATION for ${index}.`,
    bar: `Club ${index} (old)`
  };
  return {
    title: `MEGAWOOF ${index}`,
    key: `megawoof-${index}`,
    city: 'la',
    _action: 'merge',
    startDate: '2026-09-01T02:00:00.000Z',
    endDate: '2026-09-01T08:00:00.000Z',
    bar: `Club ${index}`,
    address: `${index} Main St, Los Angeles, CA`,
    description: `${blurb}NEW LOCATION for ${index}.`,
    notes,
    _fieldPriorities: {
      title: { priority: ['ai-web'], merge: 'ai' },
      description: { priority: ['ai-web'], merge: 'clobber' },
      bar: { priority: ['ai-web'], merge: 'ai' },
      address: { priority: ['ai-web'], merge: 'preserve' }
    },
    _mergeDecisions: { description: 'clobbered', bar: 'ai chose new' },
    _mergeDiff: { description: [calendar.description, scraper.description] },
    _original: { scraper, calendar, merged: { ...scraper }, aiArbitration: { arbitrated: ['bar'] } }
  };
}

// Mirrors run 20260803-143036's composition: 52 analyzed events of which
// roughly a third are merges carrying the full _original triple (that run had
// 15). A page of nothing but merges is not what white-screened.
function buildSizedResults(count) {
  const analyzedEvents = [];
  for (let i = 0; i < count; i++) {
    const event = buildSizedAnalyzedEvent(i);
    if (i % 3 !== 0) {
      delete event._original;
      delete event._mergeDiff;
      delete event._mergeDecisions;
      event._action = 'new';
    }
    analyzedEvents.push(event);
  }
  return { analyzedEvents };
}

function countPayloadEmbeds(html) {
  return {
    dataEventJson: (html.match(/data-event-json=/g) || []).length,
    rawJsonPre: (html.match(/<pre class="raw-json">/g) || []).length
  };
}

test('results HTML: a card embeds its event JSON exactly ONCE (three copies is what white-screened run 20260803-143036)', () => {
  const adapter = buildAdapter();
  const event = buildSizedAnalyzedEvent(1);
  const html = adapter.generateEventCard(event, { runId: '20260803-143036' });

  const embeds = countPayloadEmbeds(html);
  assert.equal(embeds.dataEventJson, 0,
    'no data-event-json attributes: the copy buttons derive from the card payload');
  assert.equal(embeds.rawJsonPre, 1, 'exactly one embedded payload per card');

  // The payload is compact — the ~15% of it that was pure indent whitespace
  // never crosses into the HTML string; the page re-indents it in the DOM.
  const payload = html.match(/<pre class="raw-json">([\s\S]*?)<\/pre>/)[1];
  assert.ok(!payload.includes('\n  &quot;'),
    'embedded payload is compact, not indented');

  // ...and it is still the real, parseable event, still escaped.
  const parsed = JSON.parse(payload
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  assert.equal(parsed.title, 'MEGAWOOF 1');
  assert.ok(parsed._original && parsed._original.calendar,
    'merge provenance is still reachable from the card payload');
});

test('results HTML: page-derived text in the single payload is still escaped', () => {
  const adapter = buildAdapter();
  const event = buildSizedAnalyzedEvent(2);
  event.title = 'Bear </pre><script>alert(1)</script> Night';
  event._original.scraper.bar = 'Club "><img src=x onerror=alert(1)>';
  const html = adapter.generateEventCard(event, { runId: 'r1' });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'no unescaped script tag');
  assert.ok(!html.includes('onerror=alert(1)>'), 'no unescaped event handler');
  assert.ok(html.includes('&lt;script&gt;'), 'the script tag is escaped, not stripped');
  // The restructuring must not have left a second, differently-escaped copy
  // of the same hostile text behind.
  assert.equal(countPayloadEmbeds(html).dataEventJson, 0, 'no attribute-embedded copy');
  assert.equal(countPayloadEmbeds(html).rawJsonPre, 1, 'exactly one escaped payload');
});

test('results HTML: the 52-event run that white-screened now renders well under the size that has actually rendered on device', async () => {
  const adapter = buildAdapter();
  // target 'web' is the whole-run render (every event, nothing shed, no
  // paging) — the thing this test has always been measuring.
  const html = await adapter.generateRichHTML(buildSizedResults(52), { target: 'web' });
  const kb = html.length / 1024;
  assert.ok(kb < 1500,
    `52-event page must be far below the 1923 KB that has rendered on device, got ${Math.round(kb)} KB`);
});

test('results HTML: small runs are not regressed — a 3-event page stays small and keeps its full detail', async () => {
  const adapter = buildAdapter();
  const html = await adapter.generateRichHTML(buildSizedResults(3), { target: 'web' });
  const kb = html.length / 1024;
  assert.ok(kb < 250, `3-event page stays small, got ${Math.round(kb)} KB`);
  // Nothing is trimmed on a small run: the payloads keep their heavy keys.
  assert.ok(html.includes('&quot;_original&quot;'), 'small-run payload keeps _original');
  assert.ok(html.includes('&quot;_fieldPriorities&quot;'), 'small-run payload keeps _fieldPriorities');
  assert.ok(!html.includes('&quot;_trimmed&quot;'), 'nothing was trimmed on a small run');
  assert.equal(countPayloadEmbeds(html).rawJsonPre, 3, 'one payload per card');
});

test('results HTML is bounded BY CONSTRUCTION: 4x the events does not 4x the embedded payload', async () => {
  const adapter = buildAdapter();
  // The per-card payload budget is what is under test here. The page-level
  // shed ladder (applyResultsHtmlSizeGuard) is a SEPARATE, later mechanism —
  // at these event counts it would strip the payloads outright and the
  // measurement below would prove nothing about the budget. It has its own
  // tests further down.
  adapter.applyResultsHtmlSizeGuard = (html) => html;
  const totalPayloadBytes = async (count) => {
    // Whole-run render: the per-card budget is a property of the run, not of
    // whichever slice of it a Scriptable page happens to show.
    const html = await adapter.generateRichHTML(buildSizedResults(count), { target: 'web' });
    let bytes = 0;
    const re = /<pre class="raw-json">([\s\S]*?)<\/pre>/g;
    let match;
    while ((match = re.exec(html))) bytes += match[1].length;
    return bytes;
  };

  const at50 = await totalPayloadBytes(50);
  const at200 = await totalPayloadBytes(200);
  const budget = ScriptableAdapter.EVENT_JSON_TOTAL_BUDGET_BYTES;

  // Escaping inflates the embedded form, so compare against a generous
  // multiple of the budget — the point is that it does NOT scale with N.
  assert.ok(at200 < budget * 2,
    `200-event payload total stays bounded by the ${Math.round(budget / 1024)} KB budget, got ${Math.round(at200 / 1024)} KB`);
  assert.ok(at200 < at50 * 2,
    `4x the events must not 4x the payload (50 events: ${Math.round(at50 / 1024)} KB, 200 events: ${Math.round(at200 / 1024)} KB)`);
});

test('results HTML: a trimmed payload is never silent — it is logged, stamped, and its keys are still rendered', async () => {
  const adapter = buildAdapter();
  // Same separation as above: this pins the per-card budget's stamp, not the
  // page-level shed ladder that would replace the whole payload at 60 events.
  adapter.applyResultsHtmlSizeGuard = (html) => html;
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  let html;
  try {
    html = await adapter.generateRichHTML(buildSizedResults(60), { target: 'web' });
  } finally {
    console.log = originalLog;
  }

  const trimLine = lines.find(l => l.includes('Debug JSON trimmed on'));
  assert.ok(trimLine, `a trim must be logged, got: ${JSON.stringify(lines.slice(0, 5))}`);
  assert.ok(trimLine.includes('MEGAWOOF'), 'the log names the affected event(s)');
  assert.ok(trimLine.includes('_original') || trimLine.includes('_fieldPriorities'),
    'the log names which keys were dropped');
  assert.ok(trimLine.includes('Merge Comparison'),
    'the log says where the dropped keys are still rendered');

  // The copied JSON self-documents the trim, so it can never be mistaken
  // for the complete object.
  assert.ok(html.includes('&quot;_trimmed&quot;'), 'the payload stamps _trimmed');
  assert.ok(html.includes('results-html-budget'), 'the stamp names the reason');
  // And the page says so where the owner is looking.
  assert.ok(html.includes('Debug JSON trimmed to fit the page'),
    'the affected card carries a visible notice');
  // The information itself is still on the page: the merge table renders it.
  assert.ok(html.includes('Merge Comparison'), 'the merge comparison table is still rendered');
});

test('results HTML: an oversized page is never silent about its own size', async () => {
  const adapter = buildAdapter();
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  try {
    // Far below the warn threshold: no noise on a normal run.
    await adapter.generateRichHTML(buildSizedResults(3));
  } finally {
    console.log = originalLog;
  }
  assert.ok(!lines.some(l => l.includes('above the')),
    'no size warning on a page that is comfortably small');

  // The guard itself fires on anything past what has actually rendered.
  const oversized = 'x'.repeat(ScriptableAdapter.RESULTS_HTML_MAX_BYTES + 1);
  const warned = [];
  const restore = console.log;
  console.log = (...args) => { warned.push(args.join(' ')); };
  try {
    adapter.logResultsHtmlSizeGuard(oversized, 200);
  } finally {
    console.log = restore;
  }
  assert.equal(warned.length, 1, 'exactly one warning line');
  assert.ok(warned[0].includes('200 event(s)'), 'the warning names the event count');
  assert.ok(warned[0].includes('blank'), 'the warning explains the blank screen it predicts');
});

test('line-by-line diff bounds each value with an affordance instead of emitting it in full, twice', () => {
  const adapter = buildAdapter();
  const event = buildSizedAnalyzedEvent(7);
  const longOld = `OLD ${'a'.repeat(20000)}`;
  const longNew = `NEW ${'a'.repeat(20000)}`;
  event._original.calendar.description = longOld;
  event._original.scraper.description = longNew;
  event.description = longNew;

  const html = adapter.generateLineDiffView(event);
  assert.ok(!html.includes('a'.repeat(1000)),
    'a 20 KB value is not emitted in full');
  assert.ok(html.length < 20000,
    `the whole line diff stays smaller than ONE of the values it shows, got ${html.length} bytes`);
  // The affordance: the true length and where the full value still lives.
  assert.ok(html.includes('chars total'), 'the badge states the real length');
  assert.ok(html.includes('Copy JSON'), 'the badge names where the full value is');
});

test('a truncated diff still shows WHAT changed: the window follows the first divergence', () => {
  const adapter = buildAdapter();
  const shared = 'z'.repeat(4000);
  const oldValue = `${shared}ANCIENT-VENUE-NAME${'z'.repeat(2000)}`;
  const newValue = `${shared}BRAND-NEW-VENUE-NAME${'z'.repeat(2000)}`;

  // Line view: both sides are rendered, and both must reveal the change.
  const event = buildSizedAnalyzedEvent(8);
  event._original.calendar.description = oldValue;
  event._original.scraper.description = newValue;
  event.description = newValue;
  const lineHtml = adapter.generateLineDiffView(event);
  assert.ok(lineHtml.includes('ANCIENT-VENUE-NAME'),
    'the removed side shows the text that actually differs');
  assert.ok(lineHtml.includes('BRAND-NEW-VENUE-NAME'),
    'the added side shows the text that actually differs');
  // Revealing the change is only half of it — showing it must not cost the
  // whole 1300-character value twice, which is how it used to be done.
  assert.ok(lineHtml.length < oldValue.length,
    `the diff shows the change without emitting both values in full, got ${lineHtml.length} bytes`);

  // Table view: the two cells must not truncate into identical stubs.
  const rows = adapter.generateComparisonRows(event);
  assert.ok(rows.includes('ANCIENT-VENUE-NAME') || rows.includes('BRAND-NEW-VENUE-NAME'),
    `the table cells reveal the divergence, got: ${rows.slice(0, 400)}`);
});

test('merge-table cells carry no per-cell inline styles (2400 copies of one style string was 300 KB of the white-screened page)', () => {
  const adapter = buildAdapter();
  const rows = adapter.generateComparisonRows(buildSizedAnalyzedEvent(9));
  assert.ok(rows.length > 0, 'the fixture actually produces comparison rows');
  assert.ok(!/<td[^>]*style="/.test(rows),
    'no <td style="..."> — the shared chrome lives in one CSS class');
  assert.ok(/<td class="field-row-field">/.test(rows), 'cells are classed instead');
});

test('merge-table value cells no longer carry the ENTIRE value in a title attribute', () => {
  const adapter = buildAdapter();
  const event = buildSizedAnalyzedEvent(10);
  const huge = `HUGE ${'q'.repeat(30000)}`;
  event._original.calendar.address = huge;
  event._original.scraper.address = `${huge} CHANGED`;
  event.address = `${huge} CHANGED`;
  const rows = adapter.generateComparisonRows(event);
  const titles = rows.match(/title="[^"]*"/g) || [];
  for (const title of titles) {
    assert.ok(title.length < 1000,
      `every tooltip is bounded, got a ${title.length}-byte title attribute`);
  }
  assert.ok(rows.includes('chars'), 'the cell states how long the real value is');
});

test('the results page derives Copy JSON from the single card payload and still drops _original', async () => {
  const adapter = buildAdapter();
  const html = await adapter.generateRichHTML(buildSizedResults(2));
  assert.ok(html.includes('function readCardEventJSON('),
    'the page derives the copy payload from the embedded card payload');
  const fnStart = html.indexOf('function readCardEventJSON(');
  const fnBody = html.slice(fnStart, fnStart + 900);
  assert.ok(fnBody.includes("key === '_original'"),
    'the copy path still strips _original, as the old button attribute did');
  assert.ok(fnBody.includes('JSON.stringify(parsed, null, 2)'),
    'the copied JSON keeps its two-space indentation');
  assert.ok(!html.includes("getAttribute('data-event-json')"),
    'nothing reads the removed attribute any more');
  assert.ok(html.includes('function prettyPrintCardPayloads('),
    'the page re-indents the compact payload in the DOM');
});

// ---------------------------------------------------------------------------
// Blank-results-screen fixes: first paint, liveness, log delivery, size guard.
//
// The BEEFMINCE run came up as a white sheet in the WebView. Size was ruled
// out (the same UI had been tapped through at 1782 KB; the blank page was
// 986 KB) and so was a JS/HTML error (the exact page parses clean under jsdom
// and renders 16 cards in Chrome with zero page errors). What was left was
// the render-blocking Google Fonts <link> — and the fact that the page could
// not report anything back, so "blank" was unfalsifiable.
// ---------------------------------------------------------------------------

test('results page: nothing in it blocks first paint on a network request', async () => {
  const adapter = buildAdapter();
  const html = await adapter.generateRichHTML(buildSizedResults(3));

  assert.ok(!/<link\b[^>]*rel=["']?stylesheet/i.test(html),
    'no external stylesheet — WKWebView blocks first paint until it resolves');
  assert.ok(!html.includes('fonts.googleapis.com'),
    'the Google Fonts link is gone');
  assert.ok(!html.includes('fonts.gstatic.com'), 'and so is its font host');
  assert.ok(!/@import\b/.test(html), 'no CSS @import, which blocks the same way');
  assert.ok(!/<script\b[^>]*\ssrc=/i.test(html),
    'no external script — a parser-blocking remote fetch is the same failure');

  // The replacement is a stack the device already has installed.
  assert.ok(html.includes('--font-sans: -apple-system'),
    'the system font stack is defined once as a custom property');
  assert.ok(!html.includes('Poppins'), 'no reference to the downloaded face remains');
});

test('results page: a liveness beacon is emitted and parses as a real bridge action', async () => {
  const adapter = buildAdapter();
  const html = await adapter.generateRichHTML(buildSizedResults(2));

  assert.ok(html.includes("'chunkyscrape://act?a=beacon&id='"),
    'the page navigates the existing chunkyscrape:// bridge, not evaluateJavaScript');
  assert.ok(html.includes("sendResultsBeacon('dom-ready'"),
    'a beacon fires from DOMContentLoaded');
  assert.ok(html.includes("sendResultsBeacon('painted'"),
    'a second beacon fires after the first rendered frame');
  assert.ok(html.includes("sendResultsBeacon('interacted'"),
    'a gesture-backed beacon separates "suppressed" from "never rendered"');

  // The URL the page builds is one the native handler actually understands.
  const parsed = adapter.parseReviewActionUrl('chunkyscrape://act?a=beacon&id=painted&d=22524px');
  assert.equal(parsed.a, 'beacon');
  assert.equal(parsed.id, 'painted');
  assert.equal(parsed.d, '22524px');
});

test('results page liveness: a painted beacon reads as rendered, and silence reads as blank', () => {
  const adapter = buildAdapter();
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  try {
    const seen = [];
    adapter.recordResultsPageBeacon('dom-ready', '16 cards', seen);
    adapter.recordResultsPageBeacon('painted', '22524px', seen);
    adapter.reportResultsPageLiveness(seen);
    adapter.reportResultsPageLiveness([]);
    adapter.reportResultsPageLiveness(['dom-ready']);
    adapter.reportResultsPageLiveness(['interacted']);
  } finally {
    console.log = originalLog;
  }

  assert.ok(lines.some(l => l.includes('beacon: dom-ready (16 cards)')));
  assert.ok(lines.some(l => l.includes('Results page rendered on device')));
  assert.ok(lines.some(l => l.includes('never reported liveness')),
    'no beacons at all is logged as a blank sheet, not as a review');
  assert.ok(lines.some(l => l.includes('never reported a painted frame')),
    'parsed-but-not-painted is its own, distinguishable verdict');
  assert.ok(lines.some(l => l.includes('navigation is being suppressed')),
    'a touched-but-silent page is not reported as blank');
});

test('saved-run page: the raw log and the AI prompt bodies are no longer embedded', async () => {
  const adapter = buildAdapter();
  // A log the size of a real run's: 452 KB of it used to be pasted into the
  // page inside a <pre>, and the prompt bodies another 225 KB in an attribute.
  const bulk = new Array(6000).fill(
    '2026-08-04T12:57:03.000Z [INFO] SYSTEM: Parsed https://beefmince.example/page → 1 event'
  ).join('\n');
  const logText = `${bulk}\n2026-08-04T12:57:04.000Z [DEBUG] 🤖 AI Web: Full prompt (extraction pass) (4000 chars)\n${'PROMPT-BODY '.repeat(4000)}`;
  const html = await renderSavedRunPage(adapter, {
    runId: '20260804-125703',
    exists: true,
    text: logText,
    fullText: logText,
    totalLines: logText.split('\n').length,
    shownLines: logText.split('\n').length,
    truncated: false
  });

  assert.ok(!html.includes('<pre class="log-output">'), 'no raw log <pre>');
  assert.ok(!html.includes('data-ai-prompts'), 'no prompt payload attribute');
  assert.ok(!html.includes('PROMPT-BODY'), 'no prompt body text anywhere');
  assert.ok(!html.includes('https://beefmince.example/page'), 'no log lines anywhere');

  // Generous lower bound rather than a byte count: the point is that a
  // ~550 KB log contributes essentially nothing to the page.
  assert.ok(html.length < logText.length / 2,
    `the whole page must be far smaller than the log it used to embed (page ${Math.round(html.length / 1024)} KB, log ${Math.round(logText.length / 1024)} KB)`);

  // The section itself is still there, still counting lines.
  assert.ok(html.includes('Run Logs'), 'the section survives');
  assert.ok(html.includes('📋 Copy'), 'and so does its copy control');
});

test('saved-run page: the log copy buttons still resolve to real content, natively', async () => {
  const adapter = buildAdapter();
  const html = await renderSavedRunPage(adapter, savedRunLogInfo());

  // The buttons address the native bridge and are addressable back for feedback.
  assert.ok(html.includes('data-log-copy-mode="full"'));
  assert.ok(html.includes('data-log-copy-mode="compact"'));
  assert.ok(html.includes('data-log-copy-mode="prompts"'));
  assert.ok(html.includes("'chunkyscrape://act?a=copy-logs&id='"));
  assert.ok(html.includes("'chunkyscrape://act?a=ai-prompts'"));
  assert.ok(html.includes('function markLogsCopied('), 'native can flash the button back');

  // ...and native is actually holding the content those buttons ask for.
  assert.equal(adapter._runLogCopyText, LOG_FIXTURE);
  assert.ok(adapter._runAiPrompts.length > 0, 'the prompt registry is populated');
  assert.ok(adapter._runAiPrompts.some(p => p.prompt.includes('SECRET PAYLOAD BODY')),
    'and it holds the real prompt body the page no longer carries');

  // Compact mode is the same filter the page used to apply.
  const compact = adapter.compactifyRunLogText(LOG_FIXTURE);
  assert.ok(!compact.includes('Full prompt (extraction pass)'), 'prompt dumps dropped');
  assert.ok(compact.includes('Event filtering complete'), 'everything else kept');

  // A live run must not inherit the previous render's log.
  await adapter.generateRichHTML(buildSizedResults(2));
  assert.equal(adapter._runLogCopyText, '');
  assert.deepEqual(adapter._runAiPrompts, []);
});

test('saved-run page: 📋 Copy puts the registered log on the clipboard', async () => {
  const adapter = buildAdapter();
  await renderSavedRunPage(adapter, savedRunLogInfo());

  const copied = [];
  const originalPasteboard = global.Pasteboard;
  global.Pasteboard = { copy: (text) => copied.push(text) };
  const evaluated = [];
  const webViewStub = { evaluateJavaScript: async (js) => { evaluated.push(js); } };
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  try {
    await adapter.copyRunLogAndReport('full', webViewStub);
    await adapter.copyRunLogAndReport('compact', webViewStub);
  } finally {
    console.log = originalLog;
    global.Pasteboard = originalPasteboard;
  }

  assert.equal(copied.length, 2);
  assert.equal(copied[0], LOG_FIXTURE, 'full copy is the whole registered log');
  assert.ok(!copied[1].includes('Full prompt (extraction pass)'), 'compact copy is filtered');
  assert.ok(evaluated.includes('markLogsCopied("full")'));
  assert.ok(lines.some(l => l.includes('Copied full run log to clipboard')));
});

test('size guard counts UTF-8 bytes, not UTF-16 code units', () => {
  assert.equal(ScriptableAdapter.utf8ByteLength('abc'), 3);
  assert.equal(ScriptableAdapter.utf8ByteLength('é'), 2, 'two-byte character');
  assert.equal(ScriptableAdapter.utf8ByteLength('→'), 3, 'three-byte character');
  assert.equal(ScriptableAdapter.utf8ByteLength('🐻'), 4, 'surrogate pair is one 4-byte code point');
  assert.equal('🐻'.length, 2, '...which String.length reports as two');

  // A page whose UTF-16 length is comfortably UNDER the threshold but whose
  // real UTF-8 size is over it. The old guard measured html.length and would
  // have stayed silent on exactly this page.
  const units = Math.floor(ScriptableAdapter.RESULTS_HTML_MAX_BYTES * 0.7);
  const page = '→'.repeat(units);
  assert.ok(page.length < ScriptableAdapter.RESULTS_HTML_MAX_BYTES,
    'UTF-16 length is under the threshold');
  assert.ok(ScriptableAdapter.utf8ByteLength(page) > ScriptableAdapter.RESULTS_HTML_MAX_BYTES,
    'UTF-8 size is over it');

  const adapter = buildAdapter();
  const warned = [];
  const originalLog = console.log;
  console.log = (...args) => { warned.push(args.join(' ')); };
  try {
    adapter.logResultsHtmlSizeGuard(page, 40);
  } finally {
    console.log = originalLog;
  }
  assert.equal(warned.length, 1, 'the guard fires on real byte size');
  assert.ok(warned[0].includes('40 event(s)'));
});

test('an over-budget page says so ON the page, not only in a log the owner cannot see', () => {
  const adapter = buildAdapter();
  const small = '<html><body><div class="section">ok</div></body></html>';
  const originalLog = console.log;
  console.log = () => {};
  let quiet;
  let loud;
  try {
    quiet = adapter.applyResultsHtmlSizeGuard(small, 3);
    const oversized = `<html><body>${'x'.repeat(ScriptableAdapter.RESULTS_HTML_MAX_BYTES + 1)}</body></html>`;
    loud = adapter.applyResultsHtmlSizeGuard(oversized, 80);
  } finally {
    console.log = originalLog;
  }

  assert.equal(quiet, small, 'a normal page is returned untouched');
  assert.ok(loud.includes('results-size-warning'), 'an over-budget page carries a banner');
  assert.ok(loud.indexOf('results-size-warning') < loud.indexOf('xxxx'),
    'the banner is the first thing in the body, so it renders first');
  assert.ok(loud.includes('80 event(s)'), 'the banner names the run it is describing');
});

// ---------------------------------------------------------------------------
// WebView.loadHTML's silent size cliff: over it WebKit never runs the page.
//
// Empirical bounds, one deployed build, 2026-08-04, verdicts from the #1629
// liveness beacons: 862 KB rendered ("painted, interacted"); 955 KB produced
// NO beacon at all, three runs out of three — no DOM, no scripts, literally
// <html><head></head><body></body></html>. The old 960 KB threshold sat ABOVE
// that cliff, so BEEFMINCE at 959 KB UTF-8 slipped under the guard and
// white-screened anyway; and the guard's only response was a banner INSIDE
// the document WebKit refuses to draw.
// ---------------------------------------------------------------------------

// A page big enough to trip the ceiling on its own, with real sheddable
// structure in it: an inlined base64 header logo (the single heaviest
// non-card item on the device page) plus real merge cards.
// Since pagination bounds the Scriptable page by construction, the shed
// ladder is now a BACKSTOP — it only sees a page that is over the ceiling on
// its own. Feeding it the whole-run render is how that case is reproduced.
async function renderOversizedResultsPage(adapter, { events = 40, logoBytes = 300 * 1024 } = {}) {
  adapter.loadHeaderLogoData = async () => `data:image/png;base64,${'A'.repeat(logoBytes)}`;
  const whole = await adapter.generateRichHTML(buildSizedResults(events), { target: 'web' });
  return adapter.applyResultsHtmlSizeGuard(whole, events);
}

function captureLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  try {
    return { value: fn(), lines };
  } finally {
    console.log = original;
  }
}

async function captureLogAsync(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  try {
    const value = await fn();
    return { value, lines };
  } finally {
    console.log = original;
  }
}

test('size cliff: an over-ceiling page is REDUCED under the ceiling, not merely annotated', async () => {
  const adapter = buildAdapter();
  const { value: html } = await captureLogAsync(() => renderOversizedResultsPage(adapter));

  const reduction = adapter._resultsSizeReduction;
  assert.ok(reduction, 'the render records what it had to do to fit');
  assert.ok(reduction.bytesBefore > ScriptableAdapter.RESULTS_HTML_MAX_BYTES,
    `the unreduced page really was over the ceiling (${reduction.bytesBefore} bytes)`);
  assert.ok(reduction.sheds.length > 0, 'something was actually shed');
  assert.equal(reduction.overBudget, false, 'and it got under the ceiling');

  // The point of the whole change: the STRING HANDED TO loadHTML is smaller.
  // A banner cannot do this, which is why a banner was never the fix.
  const finalBytes = ScriptableAdapter.utf8ByteLength(html);
  assert.ok(finalBytes < reduction.bytesBefore,
    'the returned page is smaller than the page that was built');
  assert.ok(finalBytes <= ScriptableAdapter.RESULTS_HTML_MAX_BYTES,
    `the returned page — banner included — is under the ceiling (${finalBytes} bytes)`);

  // The heaviest rung is the inlined logo, and it degrades to the same remote
  // URL the page already falls back to when the logo cache is cold.
  assert.ok(!html.includes('data:image/png;base64,AAAA'),
    'the inlined base64 logo is gone');
  assert.ok(html.includes('https://chunky.dad/favicons/logo-hero.png'),
    'the logo falls back to its remote URL rather than vanishing');

  // Reduction is not mutilation: every card survives.
  assert.equal((html.match(/class="event-card"/g) || []).length, 40,
    'all 40 cards are still on the page');
});

test('size cliff: the ceiling is a BACKSTOP behind pagination, under the size that hung the device', () => {
  // The ceiling stopped being a cliff estimate when pagination started
  // bounding the page by construction. Its two jobs now:
  //   1. never fire on a page the packer planned (or the shed ladder would be
  //      taking review detail off pages that are already in budget), and
  //   2. cut in BEFORE 878 KB, the single page that hung the phone outright —
  //      no sheet, no return, force-quit.
  // It is deliberately not set just under 878 KB: anchoring on the failure is
  // what produced 1923 -> 960 -> 800 -> 1024 KB, four wrong numbers in a row.
  const ceilingKb = ScriptableAdapter.RESULTS_HTML_MAX_BYTES / 1024;
  const budgetKb = ScriptableAdapter.RESULTS_PAGE_BUDGET_BYTES / 1024;
  assert.ok(ceilingKb >= budgetKb * 1.25,
    `ceiling (${ceilingKb} KB) clears the ${budgetKb} KB page budget by enough that a planned page is never also shed`);
  assert.ok(ceilingKb < 878,
    `ceiling (${ceilingKb} KB) sheds before the 878 KB page that hung the device`);
  assert.ok(ceilingKb > 490,
    `ceiling (${ceilingKb} KB) is still above the largest page proven to render on device (490 KB)`);
});

test('size cliff: every shed is logged with what went and what it cost — no silent caps', async () => {
  const adapter = buildAdapter();
  const { lines } = await captureLogAsync(() => renderOversizedResultsPage(adapter));

  const shedLines = lines.filter(l => l.includes('Results page shed'));
  assert.equal(shedLines.length, adapter._resultsSizeReduction.sheds.length,
    'exactly one log line per shed');
  for (const shed of adapter._resultsSizeReduction.sheds) {
    const line = shedLines.find(l => l.includes(`"${shed.id}"`));
    assert.ok(line, `shed "${shed.id}" is named in the log`);
    assert.ok(/recovering \d+ KB/.test(line), `shed "${shed.id}" reports its byte cost`);
    assert.ok(/page now \d+ KB/.test(line), `shed "${shed.id}" reports the running size`);
    assert.ok(shed.bytes > 0, `shed "${shed.id}" actually removed bytes`);
  }
  assert.ok(lines.some(l => l.includes('back under the')),
    'and the run says, in one line, that the page ended up renderable');
});

test('size cliff: the shed ladder runs heaviest-first and stops as soon as the page fits', async () => {
  const adapter = buildAdapter();
  // A modest overshoot: the logo alone should cover it, so nothing else is
  // touched. A page must never lose more than it had to.
  await captureLogAsync(() => renderOversizedResultsPage(adapter, { events: 8, logoBytes: 980 * 1024 }));

  const ids = adapter._resultsSizeReduction.sheds.map(s => s.id);
  assert.deepEqual(ids, ['header-logo'],
    'only the first rung fired; the debug JSON and provenance sections are untouched');
  assert.equal(adapter._resultsSizeReduction.overBudget, false);
});

test('size cliff: shedding a section leaves the page structurally intact and its controls honest', () => {
  const adapter = buildAdapter();
  // Nested same-tag elements: a lazy regex would cut at the first inner
  // </div> and shred the page. The strip is depth-counted for this reason.
  const nested = '<div id="line-view-a" class="diff-view"><div><div>x</div></div></div>';
  const stripped = ScriptableAdapter.stripBalancedElements(
    `<body><div class="card">before${nested}after</div></body>`,
    '<div id="line-view-',
    'div'
  );
  assert.equal(stripped.removed, 1);
  assert.equal(stripped.html, '<body><div class="card">beforeafter</div></body>');

  // An unbalanced fragment is left alone rather than half-cut.
  const unbalanced = ScriptableAdapter.stripBalancedElements(
    '<div id="line-view-a">oops',
    '<div id="line-view-',
    'div'
  );
  assert.equal(unbalanced.removed, 0, 'nothing is cut when the element never closes');

  // The button that used to open the shed pane says why it no longer does —
  // and the page's inline script, which contains the same words, is untouched.
  const rung = ScriptableAdapter.RESULTS_HTML_SHED_LADDER.find(r => r.id === 'line-diff-views');
  const page = '<button id="diff-toggle-a">\n  Switch to Line View\n</button>'
    + '<div id="line-view-a"><div>diff</div></div>'
    + "<script>button.textContent = 'Switch to Line View';</script>";
  const out = rung.apply(page).html;
  assert.ok(out.includes('Line view trimmed for page size'), 'the dead button is relabelled');
  assert.ok(out.includes("button.textContent = 'Switch to Line View';"),
    "the page's own script is not rewritten");

  // A shed debug payload still parses, so "Copy JSON" copies an explanation
  // instead of copying silence.
  const jsonRung = ScriptableAdapter.RESULTS_HTML_SHED_LADDER.find(r => r.id === 'debug-json');
  const shedJson = jsonRung.apply('<pre class="raw-json">{"title":"x"}</pre>').html;
  const payload = shedJson.match(/<pre class="raw-json">([\s\S]*?)<\/pre>/)[1];
  assert.ok(JSON.parse(payload)._shed, 'the placeholder is valid JSON that names itself');
});

test('size cliff: an un-shrinkable page surfaces via a NATIVE alert, not an in-page banner', async () => {
  const adapter = buildAdapter();
  // Nothing on this page is sheddable, so it stays over the ceiling — the
  // exact case where an in-page banner is invisible by construction.
  const unshrinkable = `<html><body>${'x'.repeat(ScriptableAdapter.RESULTS_HTML_MAX_BYTES + 1)}</body></html>`;
  const { lines } = captureLog(() => adapter.applyResultsHtmlSizeGuard(unshrinkable, 90));

  assert.equal(adapter._resultsSizeReduction.overBudget, true);
  assert.ok(lines.some(l => l.includes('Raising a native alert')),
    'the run says it is falling back to the one channel that survives a blank page');

  const presented = [];
  const originalAlert = global.Alert;
  global.Alert = class {
    constructor() { this.actions = []; }
    addAction(title) { this.actions.push(title); }
    async presentAlert() { presented.push({ title: this.title, message: this.message }); }
  };
  let raised;
  try {
    raised = await adapter.warnResultsPageUnrenderable();
  } finally {
    if (originalAlert === undefined) delete global.Alert; else global.Alert = originalAlert;
  }

  assert.equal(raised, true, 'the alert was raised');
  assert.equal(presented.length, 1, 'exactly one alert');
  assert.ok(presented[0].message.includes('90 event(s)'), 'it names the run');
  assert.ok(presented[0].message.includes('blank'),
    'it warns that the next screen may be blank, which the page itself could not');
  assert.ok(presented[0].message.includes('not'), 'and that a blank sheet is not a reviewed run');
});

test('size cliff: no alert when the page came back under the ceiling', async () => {
  const adapter = buildAdapter();
  const presented = [];
  const originalAlert = global.Alert;
  global.Alert = class {
    addAction() {}
    async presentAlert() { presented.push(this.message); }
  };
  try {
    await captureLogAsync(() => renderOversizedResultsPage(adapter));
    const raised = await adapter.warnResultsPageUnrenderable();
    assert.equal(raised, false, 'a page that was successfully reduced raises nothing');
  } finally {
    if (originalAlert === undefined) delete global.Alert; else global.Alert = originalAlert;
  }
  assert.equal(presented.length, 0);

  // A small page leaves no reduction record at all.
  const clean = buildAdapter();
  captureLog(() => clean.applyResultsHtmlSizeGuard('<html><body>ok</body></html>', 1));
  assert.equal(clean._resultsSizeReduction, null);
  assert.equal(await clean.warnResultsPageUnrenderable(), false);
});

test('size cliff: the ceiling is measured in UTF-8 BYTES, not UTF-16 code units (regression pin)', () => {
  const adapter = buildAdapter();
  // A page whose String.length is comfortably under the ceiling but whose
  // real UTF-8 size — what WebKit holds — is over it. Measuring html.length
  // here is how a 959 KB page reads as "fine".
  const filler = '→'.repeat(Math.floor(ScriptableAdapter.RESULTS_HTML_MAX_BYTES * 0.7));
  const page = `<html><body><div id="line-view-a" class="diff-view">${filler}</div></body></html>`;
  assert.ok(page.length < ScriptableAdapter.RESULTS_HTML_MAX_BYTES,
    'UTF-16 length is under the ceiling');
  assert.ok(ScriptableAdapter.utf8ByteLength(page) > ScriptableAdapter.RESULTS_HTML_MAX_BYTES,
    'UTF-8 size is over it');

  const { value: reduced } = captureLog(() => adapter.applyResultsHtmlSizeGuard(page, 12));
  assert.ok(adapter._resultsSizeReduction, 'the guard fired on the real byte size');
  assert.equal(adapter._resultsSizeReduction.sheds.length, 1);
  assert.equal(adapter._resultsSizeReduction.overBudget, false);
  assert.ok(!reduced.includes('→'), 'the multi-byte payload was actually removed');
});

// ---------------------------------------------------------------------------
// applyPendingBearOverrides: one calendar record, one plan row
// ---------------------------------------------------------------------------

// Events marked bear from the results UI are prepped and appended AFTER both
// dedup passes have run (filterBearEvents runs before deduplicateEvents, so a
// dropped twin never entered dedup). Without a guard, a twin already in the
// plan leaves two `_action: "merge"` rows aimed at ONE calendar record.
test('applyPendingBearOverrides folds a marked-bear twin into the existing plan row', async () => {
  const adapter = buildAdapter();
  const calendarRecord = {
    identifier: 'CAL-TWIN-9',
    title: 'Treasure Trail',
    startDate: new Date('2026-08-08T21:00:00.000Z'),
    endDate: new Date('2026-08-09T01:00:00.000Z'),
    location: '',
    notes: 'bar: The Eagle\nticketUrl: https://tixr.com/e/198706'
  };
  adapter.getExistingEvents = async () => [calendarRecord];

  const existingRow = {
    title: 'Treasure Trail',
    startDate: new Date('2026-08-08T21:00:00.000Z'),
    bar: 'The Eagle',
    ticketUrl: 'https://tixr.com/e/198706',
    isBearEvent: true,
    bearReview: 'unsure — ai: no explicit bear signal',
    _action: 'merge',
    _existingEvent: { identifier: 'CAL-TWIN-9' }
  };
  const results = { analyzedEvents: [existingRow], config: { config: {} } };
  const pending = {
    markedBear: {
      d0: {
        title: 'TREASURE TRAIL — Bear Night',
        reason: 'ai: drag show',
        event: {
          title: 'TREASURE TRAIL — Bear Night',
          startDate: new Date('2026-08-08T22:00:00.000Z'),
          bar: 'The Eagle',
          ticketUrl: 'https://tixr.com/e/198706'
        }
      }
    },
    markedNotBear: {},
    keptMarkedBear: {}
  };

  const counts = await adapter.applyPendingBearOverrides(results, pending);

  assert.equal(results.analyzedEvents.length, 1, 'the marked twin folds into the row that already covers it');
  assert.equal(counts.markedBear, 1, 'the owner\'s verdict still counts even when folded');
  assert.equal(results.analyzedEvents[0].isBearEvent, true);
  assert.equal(results.analyzedEvents[0].bearReview, undefined, 'the folded row loses its hide flag');
  assert.ok(
    String(results.analyzedEvents[0].bearSource || '').startsWith('manual-bear'),
    'the manual verdict is stamped on the surviving row'
  );

  const identifiers = results.analyzedEvents
    .map((entry) => entry._existingEvent && entry._existingEvent.identifier)
    .filter(Boolean);
  assert.equal(new Set(identifiers).size, identifiers.length,
    'two plan rows must never share one _existingEvent.identifier');
});

test('applyPendingBearOverrides still appends a genuinely new marked-bear event', async () => {
  const adapter = buildAdapter();
  adapter.getExistingEvents = async () => [];

  const existingRow = {
    title: 'Unrelated Party',
    startDate: new Date('2026-09-20T21:00:00.000Z'),
    bar: 'Elsewhere',
    _action: 'new'
  };
  const results = { analyzedEvents: [existingRow], config: { config: {} } };
  const pending = {
    markedBear: {
      d0: {
        title: 'Treasure Trail',
        reason: 'ai: drag show',
        event: {
          title: 'Treasure Trail',
          startDate: new Date('2026-08-08T22:00:00.000Z'),
          bar: 'The Eagle'
        }
      }
    },
    markedNotBear: {},
    keptMarkedBear: {}
  };

  const counts = await adapter.applyPendingBearOverrides(results, pending);

  assert.equal(results.analyzedEvents.length, 2, 'an unrelated marked-bear event still gets its own row');
  assert.equal(counts.markedBear, 1);
  assert.equal(results.analyzedEvents[1].isBearEvent, true);
});

// ---------------------------------------------------------------------------
// Typed EventKit setters at the calendar-write boundary.
//
// `CalendarEvent.startDate`/`.endDate` are native, typed properties. Handing
// one a string throws "Expected value of type Date but got value of type
// string"; that throw lands in executeCalendarActions' per-event catch and the
// night is silently lost. It happened for real on 2026-08-02 (Dallas Eagle: 1
// good event, Execute pressed, 0 written) because SharedCore.resolveWallClockDates
// stringified cross-realm Dates. That root cause is fixed in shared-core, but
// the boundary must not depend on any single producer behaving: every module
// feeding this adapter is a different importModule realm.
//
// The stub below is the only faithful model of the platform — a setter that
// rejects anything that is not a Date.
// ---------------------------------------------------------------------------

function isRealDate(value) {
  return Object.prototype.toString.call(value) === '[object Date]';
}

function installTypedCalendarEventStub() {
  const original = global.CalendarEvent;
  const assigned = { saved: 0 };
  global.CalendarEvent = class {
    set startDate(value) {
      if (!isRealDate(value)) {
        throw new Error(`Expected value of type Date but got value of type ${typeof value}`);
      }
      assigned.startDate = value;
    }
    get startDate() { return assigned.startDate; }
    set endDate(value) {
      if (!isRealDate(value)) {
        throw new Error(`Expected value of type Date but got value of type ${typeof value}`);
      }
      assigned.endDate = value;
    }
    get endDate() { return assigned.endDate; }
    async save() { assigned.saved += 1; }
  };
  return { assigned, restore: () => { global.CalendarEvent = original; } };
}

test('createCalendarEvent assigns real Dates to the typed EventKit setters, even from ISO strings', async () => {
  const adapter = buildAdapter();
  const { assigned, restore } = installTypedCalendarEventStub();
  try {
    await adapter.createCalendarEvent(
      {
        title: 'Pet Night with DJ Boost',
        startDate: '2026-08-15T07:00:00.000Z',
        endDate: '2026-08-15T10:00:00.000Z',
        location: '32.810535, -96.8110709',
        notes: 'bar: Dallas Eagle'
      },
      { title: 'chunky-dad-dallas' }
    );
  } finally {
    restore();
  }
  assert.ok(isRealDate(assigned.startDate), 'a string start is coerced before it reaches EventKit');
  assert.ok(isRealDate(assigned.endDate), 'and so is the end');
  assert.equal(assigned.startDate.toISOString(), '2026-08-15T07:00:00.000Z', 'the instant is unchanged');
  assert.equal(assigned.endDate.toISOString(), '2026-08-15T10:00:00.000Z');
  assert.equal(assigned.saved, 1, 'the write actually happened');
});

test('createCalendarEvent passes real Dates through by identity', async () => {
  const adapter = buildAdapter();
  const start = new Date('2026-08-15T07:00:00.000Z');
  const end = new Date('2026-08-15T10:00:00.000Z');
  const { assigned, restore } = installTypedCalendarEventStub();
  try {
    await adapter.createCalendarEvent(
      { title: 'Gear Night', startDate: start, endDate: end, location: '', notes: '' },
      { title: 'chunky-dad-dallas' }
    );
  } finally {
    restore();
  }
  assert.equal(assigned.startDate, start, 'a real Date is never gratuitously rebuilt');
  assert.equal(assigned.endDate, end);
});

test('toCalendarWriteDate coerces strings, keeps Dates, and fails open on junk', () => {
  const adapter = buildAdapter();
  const real = new Date('2026-08-15T07:00:00.000Z');
  assert.equal(adapter.toCalendarWriteDate(real), real, 'identity for a real Date');

  const coerced = adapter.toCalendarWriteDate('2026-08-15T07:00:00.000Z');
  assert.ok(isRealDate(coerced));
  assert.equal(coerced.toISOString(), '2026-08-15T07:00:00.000Z');

  // A cross-realm Date (Scriptable importModule) is a real Date and is kept —
  // the native bridge reads the [[DateValue]] slot, not a realm-local constructor.
  const foreign = require('node:vm').runInNewContext('new Date("2026-08-15T07:00:00.000Z")');
  assert.equal(foreign instanceof Date, false, 'precondition: the production condition');
  assert.equal(adapter.toCalendarWriteDate(foreign), foreign);

  // Fail open — never invent an instant.
  assert.equal(adapter.toCalendarWriteDate(undefined), undefined);
  assert.equal(adapter.toCalendarWriteDate(null), null);
  assert.equal(adapter.toCalendarWriteDate(''), '');
  assert.equal(adapter.toCalendarWriteDate('not a date'), 'not a date');
});

test('resolveCalendarWriteEndDate returns a real Date for an ISO-string end', () => {
  // This method already documented the coercion hazard (its own toMs) but
  // still RETURNED the raw value, so a string walked into the typed setter.
  const adapter = buildAdapter();
  const written = adapter.resolveCalendarWriteEndDate({
    title: 'Eagle Karaoke',
    startDate: '2026-08-15T07:00:00.000Z',
    endDate: '2026-08-15T10:00:00.000Z'
  });
  assert.ok(isRealDate(written));
  assert.equal(written.toISOString(), '2026-08-15T10:00:00.000Z');

  // The inverted-span refusal still returns the START, now as a real Date.
  const logs = [];
  const originalLog = console.log;
  console.log = (message) => { logs.push(String(message)); };
  let refused;
  try {
    refused = adapter.resolveCalendarWriteEndDate({
      title: 'PERVERT',
      startDate: '2026-08-02T22:00:00.000Z',
      endDate: '2026-08-02T20:00:00.000Z'
    });
  } finally {
    console.log = originalLog;
  }
  assert.ok(isRealDate(refused));
  assert.equal(refused.toISOString(), '2026-08-02T22:00:00.000Z');
  assert.ok(logs.some((line) => line.includes('endDate is before startDate')));
});

// ---------------------------------------------------------------------------
// Per-event write failures must reach results.errors.
//
// executeCalendarActions caught each failed write into a local array and
// logged only the FIRST message. The saved run JSON therefore read
// `errors: []` next to `calendarEvents: 0` — byte-identical to a run where the
// user never pressed Execute. That false signal is what hid the bug above for
// days, so the failures are now promoted onto the results object saveRun
// persists and the results UI renders.
// ---------------------------------------------------------------------------

test('per-event calendar write failures are promoted into results.errors', async () => {
  const adapter = buildAdapter();
  adapter.getOrCreateCalendar = async () => ({ title: 'chunky-dad-dallas' });
  const originalCalendarEvent = global.CalendarEvent;
  global.CalendarEvent = class {
    async save() {
      throw new Error('Expected value of type Date but got value of type string');
    }
  };
  let processed;
  try {
    processed = await adapter.executeCalendarActions(
      [
        {
          title: 'Pet Night with DJ Boost',
          city: 'dallas',
          _action: 'new',
          startDate: new Date('2026-08-15T07:00:00.000Z'),
          endDate: new Date('2026-08-15T10:00:00.000Z')
        }
      ],
      {}
    );
  } finally {
    global.CalendarEvent = originalCalendarEvent;
  }

  assert.equal(processed, 0, 'nothing was written');
  assert.equal(adapter.lastExecutionActionCounts.failed, 1);

  const results = { errors: [], calendarEvents: 0 };
  assert.equal(adapter.recordCalendarWriteFailures(results), 1);
  assert.equal(results.errors.length, 1, 'the failure is no longer invisible in the run JSON');
  assert.match(results.errors[0], /Pet Night with DJ Boost/);
  assert.match(results.errors[0], /Expected value of type Date/);

  // Promoting twice (success path, then the outer catch) must not duplicate.
  assert.equal(adapter.recordCalendarWriteFailures(results), 0);
  assert.equal(results.errors.length, 1);
});

test('recordCalendarWriteFailures creates errors[] when absent and is a no-op on a clean run', async () => {
  const adapter = buildAdapter();
  adapter.getOrCreateCalendar = async () => ({ title: 'chunky-dad-dallas' });
  const originalCalendarEvent = global.CalendarEvent;
  global.CalendarEvent = class {
    async save() { throw new Error('boom'); }
  };
  try {
    await adapter.executeCalendarActions(
      [{ title: 'Gear Night', city: 'dallas', _action: 'new', startDate: new Date('2026-08-15T07:00:00.000Z') }],
      {}
    );
  } finally {
    global.CalendarEvent = originalCalendarEvent;
  }
  const results = {};
  assert.equal(adapter.recordCalendarWriteFailures(results), 1);
  assert.deepEqual(results.errors, ['Calendar write failed for "Gear Night": boom']);

  // A run with nothing to execute leaves errors alone.
  await adapter.executeCalendarActions([], {});
  const clean = { errors: [] };
  assert.equal(adapter.recordCalendarWriteFailures(clean), 0);
  assert.deepEqual(clean.errors, []);
});

// ---------------------------------------------------------------------------
// Size-driven pagination (Scriptable flow) + show-everything (web flow).
//
// Three attempts to name WebView.loadHTML's silent size cliff were all wrong
// because each was anchored on a page observed to FAIL. These tests pin the
// replacement: the Scriptable page is bounded BY CONSTRUCTION at a budget far
// under every size proven to render, and the desktop flow — which has no
// cliff — shows everything with nothing shed.
// ---------------------------------------------------------------------------

// Image globals modelled on the real cached logo, measured with `sips` on the
// actual cache/logo-hero.png (320x320, 96,923 B, alpha):
//   320px PNG  96,923 B   ~ px²      transparent
//   160px PNG  33,105 B   ~ px²*1.3  transparent
//   160px JPEG 11,633 B   ~ px²/2    OPAQUE  <- #1631's regression
// Modelling size as a function of the pixel dimension is what makes the
// assertions cover the DOWNSCALE as well as the encode; modelling ALPHA is
// what catches a codec that silently drops it.
function installFakeImageGlobals() {
  const saved = {
    Size: global.Size, Rect: global.Rect, Color: global.Color,
    DrawContext: global.DrawContext, Data: global.Data, Image: global.Image
  };
  const b64len = (bytes) => Math.ceil(bytes / 3) * 4;
  global.Size = class { constructor(w, h) { this.width = w; this.height = h; } };
  global.Rect = class { constructor(x, y, w, h) { this.x = x; this.y = y; this.width = w; this.height = h; } };
  global.Color = { white: () => ({ __white: true }) };
  global.DrawContext = class {
    constructor() { this.size = null; this.respectScreenScale = true; this.opaque = false; this.filled = false; }
    setFillColor() { this.__fill = true; }
    fillRect() { this.filled = true; }
    drawImageInRect(image) { this.__drew = image; }
    // An opaque canvas (or one painted with a background fill) yields an image
    // with no usable alpha — exactly what put a block behind the logo.
    getImage() {
      return { size: this.size, __drawn: true, hasAlpha: !this.opaque && !this.filled };
    }
  };
  global.Data = {
    // PNG keeps whatever alpha the image had; JPEG cannot carry any.
    fromPNG: (img) => ({
      __hasAlpha: img.hasAlpha !== false,
      toBase64String: () => 'P'.repeat(b64len(img.size.width * img.size.width))
    }),
    fromJPEG: (img) => ({
      __hasAlpha: false,
      toBase64String: () => 'J'.repeat(b64len((img.size.width * img.size.width) / 2))
    })
  };
  global.Image = { fromFile: () => ({ size: new global.Size(320, 320), hasAlpha: true }) };
  return () => { Object.assign(global, saved); };
}

function withInlinedLogo(adapter) {
  adapter.loadHeaderLogoImage = async () => ({ size: new global.Size(320, 320), hasAlpha: true });
  return adapter;
}

function inlinedLogoPayload(html) {
  const match = /src="data:image\/([a-z]+);base64,([^"]*)"/i.exec(html);
  return match ? { format: match[1], bytes: match[2].length } : null;
}

// How many heavy events it now takes to actually PAGE. The budget is 1 MB
// (pagination is a rare fallback, not the default), and 40 of these events
// render as ~899 KB — one page, as they should. 80 is ~1.6 MB and really
// splits, which is what the paging-behaviour tests below need to exercise.
const PAGING_EVENTS = 80;

// A WebView that can be presented more than once, the way the paging loop
// does: every present() cycle gets its own promise and its own handler.
function installPagingWebView() {
  let handler = null;
  let resolvePresent = null;
  const loads = [];
  const evals = [];
  global.WebView = class {
    async loadHTML(html) { loads.push(html); }
    set shouldAllowRequest(fn) { handler = fn; }
    get shouldAllowRequest() { return handler; }
    present() { return new Promise((resolve) => { resolvePresent = resolve; }); }
    async evaluateJavaScript(js) { evals.push(js); return undefined; }
  };
  const settle = async () => { for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r)); };
  return {
    loads,
    evals,
    tap: (url) => handler({ url }),
    dismiss: () => { const r = resolvePresent; resolvePresent = null; r(); },
    // Wait until page `n` has been loaded AND its handler installed.
    waitForPage: async (n) => {
      for (let i = 0; i < 2000 && loads.length < n; i++) await new Promise((r) => setImmediate(r));
      await settle();
      return loads[n - 1];
    },
    settle
  };
}

// ---------------------------------------------------------------------------
// LONE SURROGATES — the thing that actually blanked the results sheet.
//
// WKWebView (which Scriptable's WebView.loadHTML wraps) hands the document to
// its content process as UTF-8. A lone surrogate has no UTF-8 encoding, so the
// document is dropped and WebKit renders `<html><head></head><body></body>
// </html>` — no DOM, no scripts, no beacons. Verified against real WebKit
// (a Swift WKWebView driven with loadHTMLString) at 49 CHARACTERS.
//
// They are not in the scraped data. They are MANUFACTURED by render-time
// truncation: one emoji is two UTF-16 code units, and a preview that cuts at a
// code-unit index can cut between them. Real case: run 20260804-201054's
// "BEEFMINCE Brighton Pride" description, whose provenance preview cut through
// the 🏳 of 🏳️‍🌈 and left \uD83C. That one card blanked the whole 959 KB page,
// and after pagination blanked page 3 — the run's SMALLEST page — while its
// larger pages 1 and 2 rendered fine.
// ---------------------------------------------------------------------------

function findLoneSurrogates(text) {
  const hits = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = text.charCodeAt(i + 1);
      if (n >= 0xdc00 && n <= 0xdfff) { i++; continue; }
      hits.push({ index: i, code: c });
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      hits.push({ index: i, code: c });
    }
  }
  return hits;
}

test('blank page: the exact BEEFMINCE description that blanked the sheet renders with ZERO lone surrogates', async () => {
  const adapter = buildAdapter();
  // Verbatim shape of the card that did it: a long description with 🏳️‍🌈
  // sitting where the 80-char provenance preview cuts. The scraped string is
  // perfectly well-formed — the damage was entirely ours.
  const description =
    'Now it’s happening — BEEFMINCE Brighton Pride on Saturday 1 August at Horizon 🏳️‍🌈🔥 For the first time ever, BEEFMINCE has a Saturday night party for Pride.';
  assert.equal(findLoneSurrogates(description).length, 0,
    'the SOURCE data is clean — this is a render bug, not a data bug');

  const event = {
    ...buildSizedAnalyzedEvent(0),
    title: 'BEEFMINCE Brighton Pride',
    description,
    _original: {
      scraper: { description, title: 'BEEFMINCE Brighton Pride' },
      calendar: { title: 'BEEFMINCE Brighton Pride' },
      merged: { description, title: 'BEEFMINCE Brighton Pride' }
    }
  };
  const html = await adapter.generateRichHTML({ analyzedEvents: [event] }, { target: 'scriptable', page: 1 });

  const hits = findLoneSurrogates(html);
  assert.deepEqual(hits, [],
    `the rendered page must contain no unpaired surrogate; found ${hits.length}` +
    (hits.length ? ` (first: U+${hits[0].code.toString(16).toUpperCase()} at ${hits[0].index})` : ''));
  // And the truncation still truncated — the fix is a safe cut, not no cut.
  assert.ok(html.includes('…'), 'the preview is still elided');
});

test('blank page: truncation cuts a surrogate pair whole or not at all, at BOTH ends', () => {
  const flag = '🏳'; // one character, two code units
  const s = `abc${flag}def`;

  // End cut landing between the halves backs up past the whole pair.
  assert.equal(ScriptableAdapter.safeSubstring(s, 0, 4), 'abc',
    'a cut between the high and low half drops the whole character');
  assert.equal(ScriptableAdapter.safeSubstring(s, 0, 5), `abc${flag}`,
    'a cut after the pair keeps it intact');
  // Start cut landing on the low half steps forward past it.
  assert.equal(ScriptableAdapter.safeSubstring(s, 4), 'def',
    'a start index on the low half skips the orphaned half');
  assert.equal(ScriptableAdapter.safeSubstring(s, 3), `${flag}def`,
    'a start index on the high half keeps the pair');
  for (let start = 0; start <= s.length; start++) {
    for (let end = start; end <= s.length; end++) {
      assert.equal(findLoneSurrogates(ScriptableAdapter.safeSubstring(s, start, end)).length, 0,
        `safeSubstring(${start}, ${end}) produced a lone surrogate`);
    }
  }

  // The provenance value preview is where the real one came from: its cut is
  // at 79 units, so sweep an emoji across every position that straddles it.
  const { buildEventProvenanceSectionHtml } = require('../event-provenance');
  for (let pad = 70; pad <= 88; pad++) {
    const description = `${'x'.repeat(pad)}🏳${'y'.repeat(40)}`;
    const section = buildEventProvenanceSectionHtml(
      { description, title: 'T', _original: { scraper: { description }, calendar: {}, merged: { description } } },
      {}
    );
    assert.equal(findLoneSurrogates(section).length, 0,
      `provenance preview left half an emoji behind with the pair at offset ${pad}`);
  }
});

test('blank page: the render sweep is the backstop, and it SAYS SO — no silent repair', async () => {
  const adapter = buildAdapter();
  // A truncation nobody has thought of yet, simulated: something upstream puts
  // an unpaired surrogate into a card. The page must still be renderable.
  const poisoned = '<html><body><h1>hel\uD83Clo</h1></body></html>';
  assert.equal(findLoneSurrogates(poisoned).length, 1, 'the fixture really is poisoned');

  const { lines, value } = captureLog(() => adapter.finalizeRenderedHtml(poisoned));
  assert.deepEqual(findLoneSurrogates(value), [], 'the swept page carries none');
  assert.ok(value.includes('�'), 'the damage is marked with U+FFFD rather than hidden');
  assert.equal(lines.filter((l) => l.includes('unpaired UTF-16 surrogate')).length, 1,
    'exactly one log line names what was repaired and why it matters');

  // A clean page is returned untouched and says nothing.
  const clean = '<html><body><h1>hel🏳lo</h1></body></html>';
  const quiet = captureLog(() => adapter.finalizeRenderedHtml(clean));
  assert.equal(quiet.value, clean, 'a clean page is the same string, not a rebuilt one');
  assert.equal(quiet.lines.filter((l) => l.includes('unpaired UTF-16 surrogate')).length, 0,
    'and nothing is logged when nothing fired');
});

test('pagination: a run whose cards exceed one page budget is split, and EVERY page is under budget', async () => {
  const adapter = buildAdapter();
  const results = buildSizedResults(PAGING_EVENTS);
  const page1 = await adapter.generateRichHTML(results, { target: 'scriptable', page: 1 });
  const pageCount = adapter.getResultsPageCount();
  assert.ok(pageCount > 1, `${PAGING_EVENTS} heavy cards must not fit on one page, got ${pageCount} page(s)`);

  const budget = ScriptableAdapter.RESULTS_PAGE_BUDGET_BYTES;
  const htmls = [page1];
  for (let p = 2; p <= pageCount; p++) {
    htmls.push(await adapter.generateRichHTML(results, { target: 'scriptable', page: p }));
  }
  htmls.forEach((html, i) => {
    const bytes = ScriptableAdapter.utf8ByteLength(html);
    assert.ok(bytes <= budget,
      `page ${i + 1}/${pageCount} is ${Math.round(bytes / 1024)} KB, over the ${Math.round(budget / 1024)} KB budget`);
  });

  // Bounded by construction, not by shedding: no page had to lose content.
  assert.equal(adapter._resultsSizeReduction, null,
    'the shed ladder is a backstop now — pagination alone kept every page in budget');

  // Splitting is not dropping: every card is on exactly one page.
  const cardsPerPage = htmls.map((html) => (html.match(/class="event-card"/g) || []).length);
  assert.equal(cardsPerPage.reduce((a, b) => a + b, 0), PAGING_EVENTS,
    `all ${PAGING_EVENTS} cards are spread across the pages, got ${cardsPerPage.join('+')}`);
  assert.ok(cardsPerPage.every((n) => n > 0), 'no page is empty');

  // Size-driven, not count-driven: heavy merge cards and light new-event cards
  // do not get the same per-page count.
  assert.ok(new Set(cardsPerPage).size > 1 || pageCount === 1,
    `pages are packed by bytes, so their card counts differ: ${cardsPerPage.join(', ')}`);

  // And the page says where the owner is, with a way forward and a way out.
  assert.ok(page1.includes('class="results-pager"'), 'page 1 carries the pager');
  assert.ok(page1.includes(`Page 1 of ${pageCount}`), 'the pager names the position');
  assert.ok(page1.includes("chunkyscrape://act?a=page&id='"), 'paging rides the chunkyscrape bridge');
  assert.ok(page1.includes('finishResultsPaging'), 'and offers a finish-early control');
});

test('pagination: the budget is anchored on the largest page PROVEN to render, never on one that failed', () => {
  const kb = ScriptableAdapter.RESULTS_PAGE_BUDGET_BYTES / 1024;
  // Post-surrogate-fix device evidence: 383/373/490 KB rendered, 878 KB HUNG
  // (sheet never appeared, force-quit). The anchor is 490 KB — the largest
  // page proven to work — because every previous value (1923, 960, 800, 1024)
  // was picked from just under a page that had FAILED, and every one of them
  // was wrong. Keeping Furball's 490 KB on one page is also the owner's
  // stated requirement.
  assert.ok(kb >= 490, `Furball (490 KB, device-proven) must not be split; budget is ${kb} KB`);
  assert.ok(kb < 864, `budget (${kb} KB) splits the 864 KB and 878 KB pages instead of shipping them whole`);
  assert.ok(kb < 878 / 1.5,
    `budget (${kb} KB) leaves real headroom under the 878 KB hang rather than sitting just below it`);
  assert.ok(kb <= ScriptableAdapter.RESULTS_HTML_MAX_BYTES / 1024,
    'and a page built to this budget is never ALSO shed by the ceiling');
});

// A page's byte size is not what blanks it; a lone UTF-16 surrogate is. These
// two guard the actual mechanism.
// Builds a (fullHtml, cards) pair whose page total lands on a given KB size.
// The planner only ever sees those two things, so feeding it them directly is
// the honest way to assert on a specific page size.
function buildSizedPageInputs(kb, cardCount = 16, chrome = 120 * 1024) {
  const cardBytes = Math.floor((kb * 1024 - chrome) / cardCount);
  const cards = Array.from({ length: cardCount }, (_, i) => ({
    group: 'new', html: 'x'.repeat(cardBytes) + String(i).padStart(0, '0')
  }));
  return { cards, fullHtml: 'c'.repeat(chrome) + cards.map((c) => c.html).join('') };
}

test('page budget: the 490 KB run stays ONE page and the 878 KB run that hung becomes TWO', () => {
  const adapter = buildAdapter();
  const budgetKb = Math.round(ScriptableAdapter.RESULTS_PAGE_BUDGET_BYTES / 1024);
  // 490 KB is Furball's entire history and it rendered on device — splitting
  // it was the owner's complaint, so it must not split. 878 KB is the
  // BEEFMINCE page that hung the phone; it must.
  const expected = [[490, 1], [864, 2], [878, 2]];
  for (const [kb, wantPages] of expected) {
    const { cards, fullHtml } = buildSizedPageInputs(kb);
    adapter._resultsPagePlan = null;
    const plan = adapter.planResultsPages(fullHtml, cards);
    assert.equal(plan.pageCount, wantPages,
      `a ${kb} KB run is ${wantPages} page(s), got ${plan.pageCount}; ${budgetKb} KB budget`);
    plan.pages.forEach((page, i) => {
      assert.ok(page.bytes <= ScriptableAdapter.RESULTS_PAGE_BUDGET_BYTES,
        `${kb} KB run, page ${i + 1}: ${Math.round(page.bytes / 1024)} KB is within the ${budgetKb} KB budget`);
    });
  }
});

test('pagination: a small run is ONE page and is byte-identical to showing everything', async () => {
  const adapter = withInlinedLogo(buildAdapter());
  const restore = installFakeImageGlobals();
  try {
    const results = buildSizedResults(3);
    const scriptable = await adapter.generateRichHTML(results, { target: 'scriptable', page: 1 });
    assert.equal(adapter.getResultsPageCount(), 1, 'a 3-event run is exactly one page');

    const web = await buildAdapter().generateRichHTML(results, { target: 'web' });
    withInlinedLogo(adapter);
    assert.equal(scriptable.length > 0, true);
    assert.ok(!scriptable.includes('class="results-pager"'), 'no pager on a one-page run');
    assert.ok(!scriptable.includes('<div class="results-size-warning">'), 'nothing was shed');
    assert.equal((scriptable.match(/class="event-card"/g) || []).length, 3, 'all 3 cards');
    // The count chips stay bare totals, not "n of N".
    assert.ok(/<span class="section-count">\d+<\/span>/.test(scriptable), 'section counts are plain totals');
    assert.ok(!/<span class="section-count">\d+ of \d+<\/span>/.test(scriptable), 'no paged count chips');
    // Full detail retained — a one-page run loses nothing to either mechanism.
    assert.ok(scriptable.includes('&quot;_original&quot;'), 'payload keeps _original');
    assert.ok(scriptable.includes('&quot;_fieldPriorities&quot;'), 'payload keeps _fieldPriorities');
    void web;
  } finally {
    restore();
  }
});

test('pagination: a small run renders the SAME bytes on both flows', async () => {
  const results = buildSizedResults(3);
  const scriptable = await buildAdapter().generateRichHTML(results, { target: 'scriptable', page: 1 });
  const web = await buildAdapter().generateRichHTML(results, { target: 'web' });
  assert.equal(scriptable, web,
    'a run that fits on one page is the pre-pagination render, unchanged, on both targets');
});

test('web flow: every event on ONE page, nothing shed, no pager', async () => {
  const adapter = withInlinedLogo(buildAdapter());
  const restore = installFakeImageGlobals();
  try {
    const html = await adapter.generateRichHTML(buildSizedResults(40), { target: 'web' });
    assert.equal((html.match(/class="event-card"/g) || []).length, 40,
      'desktop Safari has no size cliff — it gets all 40 cards');
    assert.equal(adapter.getResultsPageCount(), 1, 'the web flow never pages');
    assert.ok(!html.includes('class="results-pager"'), 'and shows no pager');
    assert.equal(adapter._resultsSizeReduction, null, 'and sheds nothing');
    assert.ok(!html.includes('<div class="results-size-warning">'), 'no shed banner');
    // The rungs the shed ladder would have pulled are all still here.
    assert.ok(html.includes('<div id="line-view-'), 'line-by-line diff panes survive');
    assert.ok(!html.includes(ScriptableAdapter.SHED_DEBUG_JSON_PLACEHOLDER), 'debug JSON survives');
    assert.ok(html.includes('class="raw-display"'), 'embedded payload blocks survive');
    // Including the cute icon: it is inlined, not swapped for the remote URL.
    assert.ok(html.includes('src="data:image/'), 'the logo stays inlined on desktop');
  } finally {
    restore();
  }
});

test('logo: inlined on BOTH flows as a downscaled PNG that KEEPS ITS ALPHA, well under 50 KB', async () => {
  const restore = installFakeImageGlobals();
  try {
    const scriptableAdapter = withInlinedLogo(buildAdapter());
    const webAdapter = withInlinedLogo(buildAdapter());
    const results = buildSizedResults(3);
    const scriptable = await scriptableAdapter.generateRichHTML(results, { target: 'scriptable', page: 1 });
    const web = await webAdapter.generateRichHTML(results, { target: 'web' });

    for (const [name, html] of [['scriptable', scriptable], ['web', web]]) {
      const logo = inlinedLogoPayload(html);
      assert.ok(logo, `${name} flow inlines the header logo (the cute icon is on both)`);
      // THE REGRESSION: #1631 encoded this as JPEG for the extra ~28 KB, and
      // JPEG has no alpha channel — the transparent mark came back with a
      // solid block behind it ("The icon has a background now?"). PNG or the
      // background is back.
      assert.equal(logo.format, 'png',
        `${name} flow keeps the logo as PNG — JPEG has no alpha channel and put a background behind it`);
      assert.ok(logo.bytes < 50 * 1024,
        `${name} flow inlines ${Math.round(logo.bytes / 1024)} KB, must be under 50 KB (was ~129 KB)`);
    }

    // The win is the DOWNSCALE, and it is the only thing the byte budget ever
    // needed: at the source 320 px the PNG alone is ~129 KB of base64, so
    // passing the 50 KB bar above proves the redraw happened.
  } finally {
    restore();
  }
});

test('logo: the redraw canvas is transparent, so the inlined PNG really carries alpha', () => {
  const restore = installFakeImageGlobals();
  try {
    const adapter = buildAdapter();
    const scaled = adapter.downscaleImage({ size: new global.Size(320, 320), hasAlpha: true }, 160);
    assert.equal(scaled.size.width, 160, 'the logo is redrawn at 160 px');
    assert.equal(scaled.hasAlpha, true,
      'the redraw canvas is NOT opaque and is NOT background-filled — an opaque canvas plus a white fill is what JPEG needed and what erased the transparency');

    // And the encode preserves it: PNG carries the alpha through, JPEG cannot.
    assert.equal(global.Data.fromPNG(scaled).__hasAlpha, true, 'PNG keeps the alpha channel');
    assert.equal(global.Data.fromJPEG(scaled).__hasAlpha, false, 'JPEG would drop it — which is why it is not used');
  } finally {
    restore();
  }
});

test('logo: the re-encoded data URI is built once and cached, not rebuilt per page', async () => {
  const restore = installFakeImageGlobals();
  try {
    const adapter = buildAdapter();
    let builds = 0;
    adapter.loadHeaderLogoImage = async () => { builds += 1; return { size: new global.Size(320, 320) }; };
    const results = buildSizedResults(PAGING_EVENTS);
    await adapter.generateRichHTML(results, { target: 'scriptable', page: 1 });
    const pageCount = adapter.getResultsPageCount();
    assert.ok(pageCount > 1, 'this run really does page');
    for (let p = 2; p <= pageCount; p++) {
      await adapter.generateRichHTML(results, { target: 'scriptable', page: p });
    }
    assert.equal(builds, 1, `the logo is decoded/re-encoded once, not once per page (${pageCount} pages)`);
  } finally {
    restore();
  }
});

test('paging: bear overrides tapped on page 1 SURVIVE to page 2 and are all applied, once', async () => {
  const adapter = buildAdapter();
  const results = buildSizedResults(PAGING_EVENTS);
  results.config = { config: { dryRun: false } };
  results.calendarEvents = 0;
  results.bearDroppedEvents = [];

  // Spy that still runs the real application.
  const appliedWith = [];
  const realApply = adapter.applyPendingBearOverrides.bind(adapter);
  adapter.applyPendingBearOverrides = async (res, pending) => {
    appliedWith.push({
      markedNotBear: Object.keys(pending.markedNotBear).slice().sort(),
      keptMarkedBear: Object.keys(pending.keptMarkedBear).slice().sort()
    });
    return realApply(res, pending);
  };
  let promptCalls = 0;
  adapter.promptForCalendarExecution = async () => { promptCalls += 1; return 0; };

  const wv = installPagingWebView();
  try {
    const done = adapter.presentRichResults(results);
    await wv.waitForPage(1);
    assert.ok(wv.loads[0].includes('class="results-pager"'), 'page 1 is a paged render');

    // Page 1: bury k0, confirm k1. Then ask for page 2 and swipe down.
    assert.equal(wv.tap('chunkyscrape://act?a=mark-not-bear&id=k0&n=1'), false);
    assert.equal(wv.tap('chunkyscrape://act?a=mark-bear&id=k1&n=2'), false);
    await wv.settle();
    assert.equal(wv.tap('chunkyscrape://act?a=page&id=2&n=3'), false, 'page nav cancels the navigation');
    wv.dismiss();

    // Page 2 opens with the page-1 taps still held natively.
    await wv.waitForPage(2);
    assert.ok(wv.loads[1].includes('Page 2 of'), 'the second present is page 2');
    assert.equal(wv.tap('chunkyscrape://act?a=mark-not-bear&id=k2&n=4'), false);
    await wv.settle();
    assert.equal(wv.tap('chunkyscrape://act?a=page-done&n=5'), false, 'finish early, without walking every page');
    wv.dismiss();

    await done;
  } finally {
    delete global.WebView;
  }

  // Applied ONCE, with every page's taps in the same batch.
  assert.equal(appliedWith.length, 1, 'overrides are applied exactly once, after paging ends');
  assert.deepEqual(appliedWith[0].markedNotBear, ['k0', 'k2'],
    'a page-1 tap and a page-2 tap are both in the batch — nothing was discarded when page 2 opened');
  assert.deepEqual(appliedWith[0].keptMarkedBear, ['k1']);

  // And the real effect landed on both events.
  assert.ok(/^(unlikely|unsure)/i.test(results.analyzedEvents[0].bearReview),
    'the page-1 "not bear" tap really tombstoned event 0');
  assert.ok(/^(unlikely|unsure)/i.test(results.analyzedEvents[2].bearReview),
    'the page-2 "not bear" tap really tombstoned event 2');
  assert.ok(String(results.analyzedEvents[1].bearSource).startsWith('manual-bear'),
    'the page-1 "bear" tap really stamped event 1');

  // The execution prompt is a once-per-review question, not once per page.
  assert.equal(promptCalls, 1, 'the execute prompt fired exactly once across two page views');
});

test('paging: a plain swipe-down ADVANCES — every page, no button, and the last one ends the review', async () => {
  // "Kinda weird that I have to hit buttons to proceed to the next page and
  // close at the end." Dismissing the sheet is now the whole forward path:
  // native arms page+1 BEFORE present(), so a review of N pages costs N swipes
  // and zero taps.
  const adapter = buildAdapter();
  const results = buildSizedResults(PAGING_EVENTS);
  results.config = { config: { dryRun: false } };
  results.calendarEvents = 0;
  let promptCalls = 0;
  adapter.promptForCalendarExecution = async () => { promptCalls += 1; return 0; };

  const wv = installPagingWebView();
  let pageCount = 0;
  try {
    const done = adapter.presentRichResults(results);
    await wv.waitForPage(1);
    pageCount = adapter.getResultsPageCount();
    assert.ok(pageCount > 1, 'this run really does page');
    // Swipe, and only swipe, all the way through.
    for (let p = 1; p <= pageCount; p++) {
      wv.dismiss();
      if (p < pageCount) await wv.waitForPage(p + 1);
    }
    await done;
  } finally {
    delete global.WebView;
  }

  assert.equal(wv.loads.length, pageCount,
    `every page was reached by swiping alone (${wv.loads.length} of ${pageCount} built, no taps)`);
  wv.loads.forEach((html, i) => {
    assert.ok(html.includes(`Page ${i + 1} of ${pageCount}`), `load ${i + 1} really is page ${i + 1}`);
  });
  // The last page's dismissal ends it — nothing had to be pressed to "close at the end".
  assert.equal(promptCalls, 1, 'the execute prompt fired exactly once, after the last swipe');

  // And the page says so instead of offering a redundant Next button.
  assert.ok(!wv.loads[0].includes('Page 2 →'),
    'no "next page" button — it did exactly what the swipe already does');
  assert.ok(wv.loads[0].includes('Swipe this sheet down for page 2'),
    'page 1 tells the owner the swipe is the way forward');
  assert.ok(wv.loads[pageCount - 1].includes('Last page.'),
    'the final page says it is the last one');
  assert.ok(!wv.loads[pageCount - 1].includes('class="results-pager-btn is-done"'),
    'and offers no finish-early BUTTON, because dismissing it IS finishing');
});

test('paging: "Done reviewing" is the explicit way to stop early, and it still applies every tap', async () => {
  const adapter = buildAdapter();
  const results = buildSizedResults(PAGING_EVENTS);
  results.config = { config: { dryRun: false } };
  results.calendarEvents = 0;
  results.bearDroppedEvents = [];
  const appliedWith = [];
  const realApply = adapter.applyPendingBearOverrides.bind(adapter);
  adapter.applyPendingBearOverrides = async (res, pending) => {
    appliedWith.push(Object.keys(pending.markedNotBear).slice().sort());
    return realApply(res, pending);
  };
  let promptCalls = 0;
  adapter.promptForCalendarExecution = async () => { promptCalls += 1; return 0; };

  const wv = installPagingWebView();
  let pageCount = 0;
  try {
    const done = adapter.presentRichResults(results);
    await wv.waitForPage(1);
    pageCount = adapter.getResultsPageCount();
    assert.ok(wv.loads[0].includes('finishResultsPaging()'),
      'a page with pages after it carries the finish-early control');
    assert.ok(wv.loads[0].includes(`skip the last ${pageCount - 1} page`),
      'and the button says exactly what it skips');
    wv.tap('chunkyscrape://act?a=mark-not-bear&id=k0&n=1');
    await wv.settle();
    assert.equal(wv.tap('chunkyscrape://act?a=page-done&n=2'), false,
      'the finish tap cancels the fake navigation');
    wv.dismiss();
    await done;
  } finally {
    delete global.WebView;
  }

  assert.equal(wv.loads.length, 1, 'stopping early really stopped — page 2 was never built');
  assert.deepEqual(appliedWith, [['k0']], 'the tap made before stopping is still applied, once');
  assert.equal(promptCalls, 1, 'and the execute prompt still fired, exactly once');
});

test('paging: "← Page N-1" still jumps BACK, which a swipe cannot express', async () => {
  const adapter = buildAdapter();
  const results = buildSizedResults(PAGING_EVENTS);
  results.calendarEvents = 1; // skip the execution prompt

  const wv = installPagingWebView();
  try {
    const done = adapter.presentRichResults(results);
    await wv.waitForPage(1);
    assert.ok(!wv.loads[0].includes('← Page'), 'page 1 has nothing to go back to');
    wv.dismiss();
    await wv.waitForPage(2);
    assert.ok(wv.loads[1].includes('← Page 1'), 'page 2 offers the way back');
    wv.tap('chunkyscrape://act?a=page&id=1&n=1');
    wv.dismiss();
    await wv.waitForPage(3);
    assert.ok(wv.loads[2].includes('Page 1 of'), 'the back tap really re-opened page 1');
    wv.tap('chunkyscrape://act?a=page-done&n=2');
    wv.dismiss();
    await done;
  } finally {
    delete global.WebView;
  }
  assert.equal(wv.loads.length, 3, 'three presentations: page 1, page 2, page 1 again');
});

test('paging: each page fires its own liveness beacons, so one bad page is still detectable', async () => {
  const adapter = buildAdapter();
  const results = buildSizedResults(PAGING_EVENTS);
  results.calendarEvents = 1; // skip the execution prompt

  const wv = installPagingWebView();
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  try {
    const done = adapter.presentRichResults(results);
    await wv.waitForPage(1);
    // Page 1 reports a paint.
    wv.tap('chunkyscrape://act?a=beacon&id=dom-ready&d=5%20cards');
    wv.tap('chunkyscrape://act?a=beacon&id=painted&d=900px');
    wv.tap('chunkyscrape://act?a=page&id=2&n=1');
    wv.dismiss();
    // Page 2 reports nothing at all — a blank sheet.
    await wv.waitForPage(2);
    wv.tap('chunkyscrape://act?a=page-done&n=2');
    wv.dismiss();
    await done;
  } finally {
    console.log = originalLog;
    delete global.WebView;
  }

  assert.ok(wv.loads[0].includes('sendResultsBeacon'), 'every page carries the beacons');
  assert.ok(wv.loads[1].includes('sendResultsBeacon'), 'including page 2');
  assert.ok(lines.some((l) => l.includes('Results page rendered on device')),
    'the page that painted is reported as rendered');
  assert.ok(lines.some((l) => l.includes('never reported liveness')),
    'the page that never beaconed is reported as blank — per page, not per run');
});

test('paging: page boundaries are PINNED — chrome that shrinks mid-review cannot slide a card out of view', async () => {
  const adapter = buildAdapter();
  const results = buildSizedResults(PAGING_EVENTS);
  // Chrome is not constant across a review: queueing a venue on page 1
  // replaces a button with a shorter label. If the boundaries were recomputed
  // from each render's chrome, the freed bytes would enlarge page 1 and page 2
  // would start one card later — and that card would appear on neither.
  let chromePad = 'x'.repeat(40 * 1024);
  adapter.generateDiscoverySection = () => `<!--${chromePad}-->`;

  // Both verdict buttons on a card carry the id, so dedupe to one per card.
  // The page's own script mentions the attribute in a selector string; only
  // real "k<i>"/"d<i>" ids count.
  const idsOf = (html) =>
    [...new Set(html.match(/data-bear-idx="[kd]\d+"/g) || [])].sort();
  const before = [];
  const first = await adapter.generateRichHTML(results, { target: 'scriptable', page: 1 });
  const pageCount = adapter.getResultsPageCount();
  assert.ok(pageCount > 1, 'the run really does page');
  before.push(idsOf(first));
  for (let p = 2; p <= pageCount; p++) {
    before.push(idsOf(await adapter.generateRichHTML(results, { target: 'scriptable', page: p })));
  }

  // Now the chrome shrinks, exactly as a venue-queue tap would shrink it.
  chromePad = '';
  const after = [];
  for (let p = 1; p <= pageCount; p++) {
    after.push(idsOf(await adapter.generateRichHTML(results, { target: 'scriptable', page: p })));
  }

  assert.equal(adapter.getResultsPageCount(), pageCount, 'the page count does not move mid-review');
  assert.deepEqual(after, before,
    'every page shows exactly the cards it showed before the chrome changed');
  // And still nothing is lost: the union is the whole run.
  const seen = after.flat();
  assert.equal(new Set(seen).size, seen.length, 'no card appears on two pages');
  assert.equal(seen.length, PAGING_EVENTS, 'no card fell between two pages');
});

test('paging: a page that fails to render still applies the taps already made, and still asks about execution', async () => {
  const adapter = buildAdapter();
  const results = buildSizedResults(PAGING_EVENTS);
  results.config = { config: { dryRun: false } };
  results.calendarEvents = 0;

  const realRender = adapter.generateRichHTML.bind(adapter);
  let renders = 0;
  adapter.generateRichHTML = async (res, options) => {
    renders += 1;
    if (renders === 2) throw new Error('WebKit fell over building page 2');
    return realRender(res, options);
  };
  const appliedWith = [];
  const realApply = adapter.applyPendingBearOverrides.bind(adapter);
  adapter.applyPendingBearOverrides = async (res, pending) => {
    appliedWith.push(Object.keys(pending.markedNotBear).slice().sort());
    return realApply(res, pending);
  };
  let promptCalls = 0;
  adapter.promptForCalendarExecution = async () => { promptCalls += 1; return 0; };

  const wv = installPagingWebView();
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  try {
    const done = adapter.presentRichResults(results);
    await wv.waitForPage(1);
    wv.tap('chunkyscrape://act?a=mark-not-bear&id=k0&n=1');
    await wv.settle();
    wv.tap('chunkyscrape://act?a=page&id=2&n=2');
    wv.dismiss();
    await done;
  } finally {
    console.log = originalLog;
    delete global.WebView;
  }

  assert.equal(appliedWith.length, 1, 'the page-1 verdict is still applied, exactly once');
  assert.deepEqual(appliedWith[0], ['k0'], 'and it is the verdict the owner actually made');
  assert.equal(promptCalls, 1, 'the execute prompt still fires — a broken page 2 does not end the review');
  assert.ok(lines.some((l) => l.includes('Failed to present results page 2')),
    'and the failure is named in the log, not swallowed');
});

// ---------------------------------------------------------------------------
// Data outlives review: the run JSON is on disk BEFORE the results UI opens.
//
// It used to be written only after the sheet came down, so a hang or a
// force-quit at the review stage destroyed the whole run — every scraped
// event, every AI call's output, the log. These tests pin the write ORDER
// (a present stub that reads the filesystem stub back), and that the second
// write lands on the SAME file rather than forking the run in two.
// ---------------------------------------------------------------------------

function buildRunSaveResults(overrides = {}) {
  return {
    analyzedEvents: [{ title: 'Bear Night', _action: 'new' }],
    bearDroppedEvents: [],
    parserResults: [{ name: 'megaparser', bearEvents: 1, totalEvents: 1 }],
    errors: [],
    totalEvents: 1,
    bearEvents: 1,
    calendarEvents: 0,
    runContext: { type: 'manual', environment: 'app', trigger: 'run' },
    config: { parsers: [{ name: 'megaparser', enabled: true }], runtime: {} },
    ...overrides
  };
}

// displayResults with everything but the save/present ordering stubbed out.
// onPresent stands in for the review: it sees the filesystem exactly as the
// results sheet would.
function installRunSaveHarness(adapter, onPresent) {
  const files = installMemoryFm(adapter);
  const runFiles = () => [...files.keys()].filter((p) => p.startsWith(adapter.runsDir));
  const seenAtPresent = [];
  adapter.displayCalendarProperties = async () => {};
  adapter.compareWithExistingCalendars = async () => {};
  adapter.displayEnrichedEvents = async () => {};
  adapter.cleanupOldFiles = async () => 0;
  adapter.appendMetricsRecord = async () => {};
  adapter.updateMetricsSummary = async () => {};
  adapter.presentRichResults = async (results) => {
    seenAtPresent.push(runFiles().map((p) => ({ path: p, json: JSON.parse(files.get(p)) })));
    if (onPresent) await onPresent(results, files);
  };
  return { files, runFiles, seenAtPresent };
}

async function runDisplayResultsQuietly(adapter, results) {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => { lines.push(args.join(' ')); };
  try {
    await adapter.displayResults(results);
  } finally {
    console.log = originalLog;
  }
  return lines;
}

test('save-before-present: the complete run JSON is already on disk when the results UI opens', async () => {
  const adapter = buildAdapter();
  const { seenAtPresent, runFiles } = installRunSaveHarness(adapter);
  const results = buildRunSaveResults();

  const lines = await runDisplayResultsQuietly(adapter, results);

  assert.equal(seenAtPresent.length, 1, 'the results UI was actually presented');
  const atPresent = seenAtPresent[0];
  assert.equal(atPresent.length, 1, 'exactly one run file existed BEFORE present() was called');
  // Not a placeholder — the scrape's whole payload is in it.
  const early = atPresent[0].json;
  assert.equal(early.version, 2);
  assert.equal(early.analyzedEvents.length, 1, 'the scraped events are in the pre-UI save');
  assert.equal(early.analyzedEvents[0].title, 'Bear Night');
  assert.equal(early.parserResults.length, 1, 'and so are the parser results');
  assert.ok(early.summary.runId, 'the pre-UI save carries a real run id');

  assert.equal(runFiles().length, 1, 'and the post-review write did not add a second file');
  assert.ok(lines.some((l) => l.includes('BEFORE the results UI')),
    'the pre-UI save says so in the log, distinctly from the final save line');
  assert.equal(lines.filter((l) => l.includes('✓ Saved run')).length, 1,
    'the existing saved-run line still appears exactly once — one run, not two');
});

test('save-before-present: a throw at the UI stage still leaves the whole run saved', async () => {
  const adapter = buildAdapter();
  const { files, runFiles } = installRunSaveHarness(adapter, () => {
    // Stands in for the 878 KB page that hung the phone: whatever goes wrong
    // at review, it must not take the data with it.
    throw new Error('WebView.present never returned');
  });
  const results = buildRunSaveResults();

  await runDisplayResultsQuietly(adapter, results);

  const paths = runFiles();
  assert.equal(paths.length, 1, 'the run survived the UI failure');
  const payload = JSON.parse(files.get(paths[0]));
  assert.equal(payload.analyzedEvents.length, 1, 'with its events intact');
  assert.equal(payload.parserResults[0].name, 'megaparser', 'and its parser results intact');
  assert.equal(payload.summary.totals.totalEvents, 1, 'and its totals intact');
});

test('save-before-present: post-review state updates the SAME run file, no duplicate run', async () => {
  const adapter = buildAdapter();
  const { files, runFiles, seenAtPresent } = installRunSaveHarness(adapter, (results) => {
    // What a real review changes on its way out.
    results.analyzedEvents[0].manuallyMarkedBear = true;
    results.calendarEvents = 3;
    results.errors.push('calendar write failed for one event');
  });
  const results = buildRunSaveResults();

  await runDisplayResultsQuietly(adapter, results);

  const paths = runFiles();
  assert.equal(paths.length, 1, 'still exactly one run file');
  assert.equal(paths[0], seenAtPresent[0][0].path, 'and it is the file the pre-UI save wrote');

  const payload = JSON.parse(files.get(paths[0]));
  assert.equal(payload.analyzedEvents[0].manuallyMarkedBear, true, 'the bear override landed');
  assert.equal(payload.summary.totals.calendarEvents, 3, 'the executed calendar writes landed');
  assert.equal(payload.errors.length, 1, 'and errors raised during review landed');

  // Same id, both writes, and the timestamp the id encodes was not re-minted.
  assert.equal(payload.summary.runId, seenAtPresent[0][0].json.summary.runId,
    'the run id is unchanged by the second write');
  assert.equal(payload.summary.timestamp, seenAtPresent[0][0].json.summary.timestamp,
    'and so is the timestamp that id was minted from');
  assert.equal(results.savedRunId, payload.summary.runId);
  assert.equal(results.savedRunPath, paths[0]);
});

test('save-before-present: the run log is written pre-UI too, and rewritten in full afterwards', async () => {
  const adapter = buildAdapter();
  const { files } = installRunSaveHarness(adapter, () => {});
  const logFiles = () => [...files.keys()].filter((p) => p.startsWith(adapter.logsDir));
  let logsAtPresent = [];
  const present = adapter.presentRichResults;
  adapter.presentRichResults = async (r) => {
    logsAtPresent = logFiles();
    return present(r);
  };

  await runDisplayResultsQuietly(adapter, buildRunSaveResults());

  assert.equal(logsAtPresent.length, 1, 'the log existed before the UI opened');
  assert.equal(logFiles().length, 1, 'and the post-review write overwrote it rather than adding another');
  assert.ok(logFiles()[0].endsWith('.log'));
});

test('save-before-present: a saved-run redisplay never re-saves', async () => {
  const adapter = buildAdapter();
  const { runFiles } = installRunSaveHarness(adapter);
  const results = buildRunSaveResults({
    _isDisplayingSavedRun: true,
    sourceRunId: '20260804-125703'
  });

  const lines = await runDisplayResultsQuietly(adapter, results);

  assert.equal(runFiles().length, 0, 'viewing a past run does not fork it into a new one');
  assert.ok(lines.some((l) => l.includes('Skipping run save (display mode)')));
  // And directly, so a future caller cannot route around displayResults' gate.
  assert.equal(await adapter.persistRunSnapshot(results, { phase: 'pre-ui' }), null);
  assert.equal(runFiles().length, 0, 'persistRunSnapshot refuses a redisplay on its own');
});

test('save-before-present: venue-queue backfill still stamps the run id', async () => {
  const adapter = buildAdapter();
  installRunSaveHarness(adapter, (results) => {
    // A venue queued during the sheet, recorded the way a tap records it.
    results._queuedVenueCandidateKeys = ['the-eagle|dallas'];
  });
  const queue = { 'the-eagle|dallas': { name: 'The Eagle', runIds: [] } };
  adapter.loadBarAdditions = async () => queue;
  let saved = null;
  adapter.saveBarAdditions = async (q) => { saved = q; };

  const results = buildRunSaveResults();
  await runDisplayResultsQuietly(adapter, results);

  assert.ok(saved, 'the queue was written back');
  assert.deepEqual(saved['the-eagle|dallas'].runIds, [results.savedRunId],
    'the tapped entry carries this run id, exactly once');
});

// ---------------------------------------------------------------------------
// UI-phase log checkpoints (flushLogCheckpoint).
//
// The results sheet HANGS on device: it never appears, present() never
// returns, the script is force-quit. FileLogger holds every line in memory and
// only touches disk in appendLogSummary — AFTER the sheet is dismissed — so
// every line from "Presenting results UI..." onwards died with the run. That
// is the liveness-beacon verdict (the only proof of whether WebKit ran the
// page), the paging lines, and every override tap: exactly the evidence needed
// to explain the hang.
//
// shouldAllowRequest handlers run WHILE the sheet is presented, before
// present() resolves — so a flush from inside one is on disk before the hang.
// ---------------------------------------------------------------------------

// Routes this module's console into the adapter's singleton FileLogger (the
// same buffer captureConsole fills on device) so a checkpoint has real lines
// to write, and collects them for assertions.
function captureIntoRunLog() {
  const tee = getConsoleTee();
  const lines = [];
  const originals = { log: console.log, warn: console.warn };
  console.log = (...args) => { lines.push(args.join(' ')); tee('info', args); };
  console.warn = (...args) => { lines.push(args.join(' ')); tee('warn', args); };
  return {
    lines,
    restore: () => { console.log = originals.log; console.warn = originals.warn; }
  };
}

// Memory FileManager that records the order of writes, so a test can ask what
// was on disk at a given moment.
function installCheckpointFm(adapter, { failWritesTo = null } = {}) {
  const files = new Map();
  const writes = [];
  adapter.fm = {
    joinPath: (a, b) => `${a}/${b}`,
    fileExists: (p) => files.has(p) || p === adapter.baseDir || p === adapter.logsDir || p === adapter.runsDir,
    isDirectory: () => false,
    createDirectory: () => {},
    fileName: (p) => String(p).split('/').pop(),
    readString: (p) => (files.has(p) ? files.get(p) : null),
    writeString: (p, text) => {
      if (failWritesTo && failWritesTo(p)) throw new Error('simulated disk failure');
      files.set(p, text);
      writes.push(p);
    },
    downloadFileFromiCloud: async () => {}
  };
  return { files, writes };
}

// Like installFakeWebView, but present() runs a hook first — the device's
// "the sheet is now up and native has not regained control" moment.
function installFakeWebViewWithPresentHook(onPresent) {
  let handler = null;
  let resolvePresent = null;
  const evals = [];
  global.WebView = class {
    async loadHTML() {}
    set shouldAllowRequest(fn) { handler = fn; }
    get shouldAllowRequest() { return handler; }
    present() {
      if (onPresent) onPresent();
      return new Promise((resolve) => { resolvePresent = resolve; });
    }
    async evaluateJavaScript(js) { evals.push(js); return undefined; }
  };
  return {
    tap: (url) => handler({ url }),
    dismiss: () => resolvePresent(),
    evals,
    getHandler: () => handler
  };
}

async function waitForHandler(wv) {
  for (let i = 0; i < 300 && !wv.getHandler(); i++) {
    await new Promise((r) => setImmediate(r));
  }
  assert.ok(wv.getHandler(), 'shouldAllowRequest assigned before present()');
}

test('log checkpoint: "Presenting results UI" is on disk BEFORE present() resolves', async () => {
  const adapter = buildAdapter();
  const { files } = installCheckpointFm(adapter);
  const capture = captureIntoRunLog();
  const results = { ...buildResultsStub(), calendarEvents: 1, config: { config: {} } };
  const logPath = adapter.getLogCheckpointPath(results);

  let onDiskWhilePresented = null;
  const wv = installFakeWebViewWithPresentHook(() => {
    // Read the filesystem stub from INSIDE present(), i.e. at the exact
    // moment the device hangs: nothing after this point ever runs.
    onDiskWhilePresented = files.get(logPath) || null;
  });
  try {
    const done = adapter.presentRichResults(results);
    await waitForHandler(wv);
    wv.dismiss();
    await done;
  } finally {
    delete global.WebView;
    capture.restore();
  }

  assert.ok(onDiskWhilePresented, 'the run log exists on disk while the sheet is up');
  assert.ok(
    onDiskWhilePresented.includes('Presenting results UI'),
    'the last line before the cliff is already persisted — a force-quit here keeps it'
  );
  assert.ok(
    onDiskWhilePresented.includes('Results HTML size'),
    'and so are the page-size lines that say how big the page that hung was'
  );
});

test('log checkpoint: a beacon verdict reaches disk synchronously, so a hang after it keeps it', async () => {
  const adapter = buildAdapter();
  const { files } = installCheckpointFm(adapter);
  const capture = captureIntoRunLog();
  const results = { ...buildResultsStub(), calendarEvents: 1, config: { config: {} } };
  const logPath = adapter.getLogCheckpointPath(results);

  const wv = installFakeWebViewWithPresentHook();
  let afterBeacon = null;
  try {
    const done = adapter.presentRichResults(results);
    await waitForHandler(wv);

    // The page reports it painted. No await between the tap and this read:
    // whatever is on disk here is what survives a force-quit one line later.
    assert.equal(wv.tap('chunkyscrape://act?a=beacon&id=painted&d=1px&n=1'), false);
    afterBeacon = files.get(logPath) || null;

    wv.dismiss();
    await done;
  } finally {
    delete global.WebView;
    capture.restore();
  }

  assert.ok(afterBeacon, 'the beacon flush wrote without awaiting anything');
  assert.ok(
    afterBeacon.includes('Results page beacon: painted'),
    'the single most diagnostic line in the run is on disk before the sheet closes'
  );
});

test('log checkpoint: a bear-override tap is on disk before the sheet closes', async () => {
  const adapter = buildAdapter();
  const { files } = installCheckpointFm(adapter);
  const capture = captureIntoRunLog();
  const results = {
    ...buildResultsStub(),
    calendarEvents: 1,
    config: { config: {} },
    bearDroppedEvents: [buildBearDroppedFixture()]
  };
  const logPath = adapter.getLogCheckpointPath(results);

  const wv = installFakeWebViewWithPresentHook();
  let afterTap = null;
  try {
    const done = adapter.presentRichResults(results);
    await waitForHandler(wv);
    assert.equal(wv.tap('chunkyscrape://act?a=mark-not-bear&id=k0&n=1'), false);
    afterTap = files.get(logPath) || null;
    wv.dismiss();
    await done;
  } finally {
    delete global.WebView;
    capture.restore();
  }

  assert.ok(afterTap && afterTap.includes('Bear override tapped'),
    'the owner\'s review decision is durable the moment he makes it');
});

test('log checkpoint: throttled actions coalesce, forced ones always write', async () => {
  const adapter = buildAdapter();
  const { writes } = installCheckpointFm(adapter);
  const capture = captureIntoRunLog();
  const results = { ...buildResultsStub(), calendarEvents: 1, config: { config: {} } };
  const logPath = adapter.getLogCheckpointPath(results);
  const countLogWrites = () => writes.filter((p) => p === logPath).length;

  const wv = installFakeWebViewWithPresentHook();
  let afterBurst = 0;
  let afterForced = 0;
  const TAPS = 12;
  try {
    const done = adapter.presentRichResults(results);
    await waitForHandler(wv);
    const beforeBurst = countLogWrites();

    // Page-arming taps are repeatable noise and ride the throttle.
    for (let i = 0; i < TAPS; i++) wv.tap(`chunkyscrape://act?a=page&id=1&n=${i}`);
    afterBurst = countLogWrites() - beforeBurst;

    // A forced action bypasses it, in the same millisecond window.
    const beforeForced = countLogWrites();
    wv.tap('chunkyscrape://act?a=beacon&id=dom-ready&n=99');
    afterForced = countLogWrites() - beforeForced;

    wv.dismiss();
    await done;
  } finally {
    delete global.WebView;
    capture.restore();
  }

  assert.ok(afterBurst < TAPS, `throttle coalesces rapid taps (${afterBurst} writes for ${TAPS} taps)`);
  assert.equal(afterForced, 1, 'a forced flush always writes, throttle window or not');
});

test('log checkpoint: a flush that throws breaks neither the sheet nor the run', async () => {
  const adapter = buildAdapter();
  installCheckpointFm(adapter, { failWritesTo: (p) => String(p).includes('/logs/') });
  const capture = captureIntoRunLog();
  const results = {
    ...buildResultsStub(),
    calendarEvents: 1,
    config: { config: {} },
    bearDroppedEvents: [buildBearDroppedFixture()]
  };
  const keptEvent = results.analyzedEvents[0];

  const wv = installFakeWebViewWithPresentHook();
  try {
    const done = adapter.presentRichResults(results);
    await waitForHandler(wv);
    assert.equal(wv.tap('chunkyscrape://act?a=beacon&id=painted&n=1'), false,
      'the handler still returns its bool — a flush failure never escapes it');
    assert.equal(wv.tap('chunkyscrape://act?a=mark-not-bear&id=k0&n=2'), false);
    await new Promise((r) => setImmediate(r));
    wv.dismiss();
    await done; // must resolve, not reject
  } finally {
    delete global.WebView;
    capture.restore();
  }

  // The review still happened: the verdict was applied after dismissal.
  assert.ok(String(keptEvent.bearSource).startsWith('manual-not-bear'),
    'the override survived a failing checkpoint');
  const complaints = capture.lines.filter((l) => l.includes('Log checkpoint failed'));
  assert.equal(complaints.length, 1, 'the failure is reported exactly once, not once per flush');
});

test('log checkpoint: checkpoints land on the SAME file the final log write uses', async () => {
  // Protects the single-file invariant: once the run has an id (the run is
  // saved before the sheet), checkpointing must reuse <runId>.log rather than
  // leave a second log behind — and it must never touch the run JSON.
  const adapter = buildAdapter();
  const { files, writes } = installCheckpointFm(adapter);
  const capture = captureIntoRunLog();
  const results = {
    ...buildResultsStub(),
    calendarEvents: 1,
    config: { config: {} },
    savedRunId: '20260805-101112',
    totalEvents: 2,
    bearEvents: 2,
    errors: [],
    parserResults: []
  };

  const wv = installFakeWebViewWithPresentHook();
  let duringSheet = null;
  try {
    const done = adapter.presentRichResults(results);
    await waitForHandler(wv);
    wv.tap('chunkyscrape://act?a=beacon&id=painted&n=1');
    duringSheet = files.get(adapter.getLogFilePath('20260805-101112')) || null;
    wv.dismiss();
    await done;
    await adapter.saveRun(results);
    await adapter.appendLogSummary(results);
  } finally {
    delete global.WebView;
    capture.restore();
  }

  assert.ok(duringSheet && duringSheet.includes('Results page beacon: painted'),
    'checkpoints wrote the run\'s own log file while the sheet was up');
  const logWrites = [...new Set(writes.filter((p) => p.includes('/logs/')))];
  assert.deepEqual(logWrites, [adapter.getLogFilePath('20260805-101112')],
    'one log file for the run — checkpoints and the final write share it');
  assert.ok(!files.has(`${adapter.logsDir}/ui-phase-checkpoint.log`),
    'no fallback file once the run has an id');

  const runWrites = writes.filter((p) => p.includes('/runs/'));
  assert.equal(runWrites.length, 1, 'exactly one run file written — checkpoints never save runs');
  const savedRunLines = capture.lines.filter((l) => l.includes('Saved run'));
  assert.equal(savedRunLines.length, 1, '"Saved run" still appears exactly once');
  assert.ok(files.get(adapter.getLogFilePath('20260805-101112')).includes('Results page beacon: painted'),
    'and the final log still carries everything the checkpoints captured');
});

test('log checkpoint: a saved-run redisplay never overwrites the historical log', async () => {
  const adapter = buildAdapter();
  const { files, writes } = installCheckpointFm(adapter);
  const capture = captureIntoRunLog();
  const results = {
    ...buildResultsStub(),
    calendarEvents: 1,
    config: { config: {} },
    _isDisplayingSavedRun: true,
    sourceRunId: '20260804-125703'
  };
  adapter.loadRunLogsForDisplay = async () => savedRunLogInfo();
  files.set(adapter.getLogFilePath('20260804-125703'), 'the original run log');

  const wv = installFakeWebViewWithPresentHook();
  try {
    const done = adapter.presentRichResults(results);
    await waitForHandler(wv);
    wv.tap('chunkyscrape://act?a=beacon&id=painted&n=1');
    wv.dismiss();
    await done;
  } finally {
    delete global.WebView;
    capture.restore();
  }

  assert.equal(writes.filter((p) => p.includes('/logs/')).length, 0, 'display mode writes no log at all');
  assert.equal(files.get(adapter.getLogFilePath('20260804-125703')), 'the original run log',
    'the run being reviewed keeps its own log');
});

// ---------------------------------------------------------------------------
// THE HANDLER MUST BE INSTALLED BEFORE loadHTML, NOT AFTER.
//
// The results page fires its first liveness beacon from DOMContentLoaded —
// while loadHTML is still running. With shouldAllowRequest assigned after the
// load, that beacon met a WebView with no handler, so the `return false` that
// cancels the fake navigation never ran and a real main-frame navigation to
// `chunkyscrape://` started on top of a main frame that had not finished
// loading. The evidence was an absence: every run ever logged recorded
// `painted` and `interacted` beacons and not one `dom-ready`.
// ---------------------------------------------------------------------------
test('shouldAllowRequest is installed before loadHTML, so the DOM-ready beacon is not a live navigation', async () => {
  const adapter = buildAdapter();
  const results = { ...buildResultsStub(), calendarEvents: 1 };

  let handler = null;
  let resolvePresent = null;
  const handlerSetWhenLoadRan = [];
  let beaconDuringLoad = null;
  global.WebView = class {
    async loadHTML() {
      handlerSetWhenLoadRan.push(handler !== null);
      // Exactly what the page does at DOMContentLoaded, at the moment it does
      // it: navigate to the beacon URL while the document is still loading.
      beaconDuringLoad = handler
        ? handler({ url: 'chunkyscrape://act?a=beacon&id=dom-ready&d=2%20cards' })
        : 'UNHANDLED';
    }
    set shouldAllowRequest(fn) { handler = fn; }
    get shouldAllowRequest() { return handler; }
    present() { return new Promise((resolve) => { resolvePresent = resolve; }); }
    async evaluateJavaScript() { return undefined; }
  };
  try {
    const done = adapter.presentRichResults(results);
    for (let i = 0; i < 500 && !resolvePresent; i++) {
      await new Promise((r) => setImmediate(r));
    }
    assert.deepEqual(handlerSetWhenLoadRan, [true],
      'the handler was already on the WebView when loadHTML ran');
    assert.equal(beaconDuringLoad, false,
      'a beacon fired during the load is CANCELLED, not allowed to navigate');
    resolvePresent();
    await done;
  } finally {
    delete global.WebView;
  }
});

// A cached logo from before the PNG fix must not be served forever: the codec
// is what carries the alpha channel, so a JPEG data URI on disk is the white
// background, not just a stale byte count.
test('a JPEG inline-logo cache is discarded and re-encoded instead of reused', async () => {
  const adapter = buildAdapter();
  const written = [];
  adapter.fm = {
    joinPath: (a, b) => `${a}/${b}`,
    fileExists: () => true,
    modificationDate: () => new Date(),
    readString: () => 'data:image/jpeg;base64,/9j/4AAQSkZJRg',
    writeString: (p, value) => { written.push(value); },
    createDirectory: () => {}
  };
  adapter.cacheDir = '/cache';
  // No image available → the rebuild returns null. What matters is that the
  // stale JPEG was NOT handed back as if it were fine.
  adapter.loadHeaderLogoImage = async () => null;
  const uri = await adapter.buildHeaderLogoDataUri();
  assert.equal(uri, null, 'the JPEG cache is rejected, not returned');
  assert.deepEqual(written, [], 'nothing re-cached when there is no image to encode');

  // A PNG cache is still a cache hit — this must not re-encode on every run.
  adapter.fm.readString = () => 'data:image/png;base64,iVBORw0KGgo';
  assert.equal(await adapter.buildHeaderLogoDataUri(),
    'data:image/png;base64,iVBORw0KGgo', 'a PNG cache is reused untouched');
});

// ---------------------------------------------------------------------------
// THE MERGE TARGET IS NOT A DUPLICATE, AND IT IS NOT A CONFLICT.
//
// compareWithExistingCalendars runs after analysis, so an event that matched
// something in the calendar carries that record in `_existingEvent`. It is
// same-title/same-minute by construction — precisely the duplicate test — and
// it overlaps in time completely, which is what a merge IS. Counting it made
// BEEFMINCE report "15 events, 0 missing, 15 duplicates, 15 conflicts" for 15
// events with exactly one calendar twin each, while the same run's write plan
// read "UPDATE: 15, CREATE: 0".
// ---------------------------------------------------------------------------
function installCalendarCompareStubs(existingEvents) {
  global.Calendar = { forEvents: async () => [{ title: 'chunky-dad-london' }] };
  global.CalendarEvent = { between: async () => existingEvents };
}

function runCalendarCompare(adapter, results) {
  const originalLog = console.log;
  const lines = [];
  console.log = (message) => { lines.push(String(message)); };
  return adapter.compareWithExistingCalendars(results)
    .then(() => { console.log = originalLog; return lines; })
    .catch((error) => { console.log = originalLog; throw error; });
}

test('compareWithExistingCalendars does not report an event as a duplicate of its own merge target', async () => {
  const adapter = buildAdapter();
  adapter.getCalendarNameForDisplay = () => 'chunky-dad-london';
  // Without this the timezone lookup throws, the method's catch swallows it,
  // and the test would pass on an empty log for the wrong reason.
  adapter.getTimezoneForCity = () => 'Europe/London';
  const twin = {
    identifier: 'CAL-1',
    title: 'BEEFMINCE Trunk Den',
    startDate: new Date('2026-08-15T21:00:00.000Z'),
    endDate: new Date('2026-08-16T03:00:00.000Z')
  };
  const event = {
    title: 'BEEFMINCE Trunk Den',
    startDate: '2026-08-15T21:00:00.000Z',
    endDate: '2026-08-16T03:00:00.000Z',
    _action: 'merge',
    _existingEvent: { identifier: 'CAL-1', title: 'BEEFMINCE Trunk Den' }
  };
  adapter.getAllEventsFromResults = () => [event];
  installCalendarCompareStubs([twin]);
  try {
    const lines = await runCalendarCompare(adapter, {});
    assert.ok(!lines.some((l) => l.includes('duplicate(s) in')),
      'the record being merged into is not reported as a duplicate');
    assert.ok(!lines.some((l) => l.includes('time conflict(s) in')),
      'nor as a time conflict with itself');
    assert.ok(lines.some((l) => l.includes('1 events, 0 missing, 0 duplicates, 0 conflicts')),
      `summary counts nothing: ${lines.filter((l) => l.includes('Calendar check complete')).join(' | ')}`);
  } finally {
    delete global.Calendar;
    delete global.CalendarEvent;
  }
});

test('compareWithExistingCalendars still reports a REAL second copy alongside the merge target', async () => {
  const adapter = buildAdapter();
  adapter.getCalendarNameForDisplay = () => 'chunky-dad-london';
  // Without this the timezone lookup throws, the method's catch swallows it,
  // and the test would pass on an empty log for the wrong reason.
  adapter.getTimezoneForCity = () => 'Europe/London';
  const shape = {
    title: 'BEEFMINCE Trunk Den',
    startDate: new Date('2026-08-15T21:00:00.000Z'),
    endDate: new Date('2026-08-16T03:00:00.000Z')
  };
  const event = {
    title: 'BEEFMINCE Trunk Den',
    startDate: '2026-08-15T21:00:00.000Z',
    endDate: '2026-08-16T03:00:00.000Z',
    _action: 'merge',
    _existingEvent: { identifier: 'CAL-1' }
  };
  adapter.getAllEventsFromResults = () => [event];
  installCalendarCompareStubs([
    { identifier: 'CAL-1', ...shape },
    { identifier: 'CAL-2', ...shape } // a genuine second copy
  ]);
  try {
    const lines = await runCalendarCompare(adapter, {});
    assert.ok(lines.some((l) => l.includes('1 duplicate(s) in chunky-dad-london')),
      'the extra copy is still flagged — exactly one, not two');
    assert.ok(lines.some((l) => l.includes('1 events, 0 missing, 1 duplicates, 1 conflicts')),
      `summary counts the extra copy only: ${lines.filter((l) => l.includes('Calendar check complete')).join(' | ')}`);
  } finally {
    delete global.Calendar;
    delete global.CalendarEvent;
  }
});

test('an event with no calendar match still reports a same-title twin as a duplicate', async () => {
  const adapter = buildAdapter();
  adapter.getCalendarNameForDisplay = () => 'chunky-dad-london';
  // Without this the timezone lookup throws, the method's catch swallows it,
  // and the test would pass on an empty log for the wrong reason.
  adapter.getTimezoneForCity = () => 'Europe/London';
  const event = {
    title: 'BEEFMINCE Trunk Den',
    startDate: '2026-08-15T21:00:00.000Z',
    endDate: '2026-08-16T03:00:00.000Z',
    _action: 'new' // nothing matched, so nothing is excluded
  };
  adapter.getAllEventsFromResults = () => [event];
  installCalendarCompareStubs([{
    identifier: 'CAL-9',
    title: 'BEEFMINCE Trunk Den',
    startDate: new Date('2026-08-15T21:00:00.000Z'),
    endDate: new Date('2026-08-16T03:00:00.000Z')
  }]);
  try {
    const lines = await runCalendarCompare(adapter, {});
    assert.ok(lines.some((l) => l.includes('1 duplicate(s) in chunky-dad-london')),
      'a NEW event that collides with an existing one is still a real duplicate');
  } finally {
    delete global.Calendar;
    delete global.CalendarEvent;
  }
});

test('presentReviewResults installs shouldAllowRequest before loadHTML too', async () => {
  const adapter = buildAdapter();
  adapter.showReviewSummaryAlert = async () => {};
  let handler = null;
  let resolvePresent = null;
  const handlerSetWhenLoadRan = [];
  global.WebView = class {
    async loadHTML() { handlerSetWhenLoadRan.push(handler !== null); }
    set shouldAllowRequest(fn) { handler = fn; }
    get shouldAllowRequest() { return handler; }
    present() { return new Promise((resolve) => { resolvePresent = resolve; }); }
    async evaluateJavaScript() { return undefined; }
  };
  try {
    const done = adapter.presentReviewResults([buildBridgeFinding()], {});
    for (let i = 0; i < 500 && !resolvePresent; i++) {
      await new Promise((r) => setImmediate(r));
    }
    assert.deepEqual(handlerSetWhenLoadRan, [true],
      'the handler was already on the WebView when loadHTML ran');
    resolvePresent();
    await done;
  } finally {
    delete global.WebView;
  }
});

// ---------------------------------------------------------------------------
// Network resilience: the adapter is the one choke point (fetchData / postJson
// / fetchImageAsBase64 all funnel through withNetworkResilience) and the one
// place that knows what actually happened on the wire.
// ---------------------------------------------------------------------------

test('fetchImageAsBase64 stamps the status the host answered with, so a non-image 200 is not retried', async () => {
  const adapter = buildAdapter();
  let attempts = 0;
  const slept = [];
  adapter.sleepForNetworkRetry = async (ms) => { slept.push(ms); };
  global.Request = class {
    constructor() { this.response = null; }
    async loadImage() {
      attempts += 1;
      // Exactly what the corpus shows 94 times: the fetch succeeded, the bytes
      // just are not an image.
      this.response = { statusCode: 200 };
      throw new Error('Cannot parse response to an image.');
    }
  };
  try {
    await assert.rejects(
      adapter.fetchImageAsBase64('https://cdn.example/not-an-image', 30, 1024),
      (error) => error.statusCode === 200 &&
        /Failed to fetch image as base64/.test(error.message)
    );
  } finally {
    delete global.Request;
  }
  assert.equal(attempts, 1,
    'the wrapper text matches /failed to fetch/, so without the stamped status this would buy minutes of backoff');
  assert.deepEqual(slept, [], 'not one millisecond of waiting on a host that answered');
});

test('fetchImageAsBase64 still retries a real connectivity failure on the minutes-long ladder', async () => {
  const adapter = buildAdapter();
  let attempts = 0;
  const slept = [];
  adapter.sleepForNetworkRetry = async (ms) => { slept.push(ms); };
  global.Request = class {
    constructor() { this.response = null; }
    async loadImage() {
      attempts += 1;
      // No response object at all: nothing came back from the host.
      throw new Error('The network connection was lost.');
    }
  };
  try {
    await assert.rejects(adapter.fetchImageAsBase64('https://cdn.example/a.jpg', 30, 1024));
  } finally {
    delete global.Request;
  }
  assert.ok(attempts > 1, 'losing service mid-download is exactly what the retry exists for');
  assert.ok(slept.length > 0 && slept[0] >= 5000,
    'backoff starts in seconds, not milliseconds — an inter-station gap lasts minutes');
});

// postForm (form-encoded POST for admin-ajax month feeds) is a sibling of
// fetchData/postJson and must sit behind the SAME resilience choke point.
test('postForm retries a real connectivity failure on the same minutes-long ladder as its siblings', async () => {
  const adapter = buildAdapter();
  let attempts = 0;
  const slept = [];
  adapter.sleepForNetworkRetry = async (ms) => { slept.push(ms); };
  global.Request = class {
    constructor() { this.response = null; }
    async loadString() {
      attempts += 1;
      throw new Error('The network connection was lost.');
    }
  };
  try {
    await assert.rejects(
      adapter.postForm('https://venue.example/wp-admin/admin-ajax.php', 'action=mec_monthly_view_load_month&mec_year=2026&mec_month=09')
    );
  } finally {
    delete global.Request;
  }
  assert.ok(attempts > 1, 'a month feed on a train ride deserves the same patience as a page fetch');
  assert.ok(slept.length > 0 && slept[0] >= 5000,
    'same ladder as fetchData/postJson — nothing else in the codebase grows a retry');
});

test('postForm sends a form-encoded body and caches the response under the synthetic cacheUrl — the second run never touches the network', async () => {
  const adapter = new ScriptableAdapter({ cities: {}, pageCache: { enabled: true, ttlDays: 3 } });
  const store = new Map();
  adapter.readCachedPage = async (url, config) => {
    assert.equal(config.ttlDays, 3, 'month feeds ride the global page-cache TTL, not a private one');
    return store.get(url) || null;
  };
  adapter.writeCachedPage = async (url, responseData, config) => {
    store.set(url, { html: responseData.html, url, statusCode: responseData.statusCode, headers: {} });
  };
  let attempts = 0;
  let seenHeaders = null;
  let seenBody = null;
  global.Request = class {
    constructor(url) { this.url = url; this.response = null; }
    async loadString() {
      attempts += 1;
      seenHeaders = this.headers;
      seenBody = this.body;
      this.response = { statusCode: 200 };
      return '{"month":"<a href=\\"https://venue.example/events/x/?occurrence=2026-09-05\\">X</a>"}';
    }
  };
  const cacheUrl = 'https://venue.example/wp-admin/admin-ajax.php?mec_month_feed=2026-09';
  try {
    const first = await adapter.postForm(
      'https://venue.example/wp-admin/admin-ajax.php',
      'action=mec_monthly_view_load_month&mec_year=2026&mec_month=09&navigator_click=true&atts%5Bid%5D=1224',
      { headers: { 'X-Requested-With': 'XMLHttpRequest' }, cacheUrl }
    );
    assert.equal(first.ok, true);
    assert.match(seenHeaders['Content-Type'], /application\/x-www-form-urlencoded/,
      'admin-ajax reads form fields, not JSON');
    assert.equal(seenHeaders['X-Requested-With'], 'XMLHttpRequest');
    assert.equal(seenBody, 'action=mec_monthly_view_load_month&mec_year=2026&mec_month=09&navigator_click=true&atts%5Bid%5D=1224',
      'the body is sent exactly as handed over — nothing re-encodes the atts blob');

    const second = await adapter.postForm(
      'https://venue.example/wp-admin/admin-ajax.php',
      'action=mec_monthly_view_load_month&mec_year=2026&mec_month=09&navigator_click=true&atts%5Bid%5D=1224',
      { headers: { 'X-Requested-With': 'XMLHttpRequest' }, cacheUrl }
    );
    assert.equal(second.text, first.text, 'the cached grid is byte-identical');
  } finally {
    delete global.Request;
  }
  assert.equal(attempts, 1, 'the second run must be a page-cache hit, not a network call');
});

test('postForm without a cacheUrl neither reads nor writes the page cache', async () => {
  const adapter = new ScriptableAdapter({ cities: {}, pageCache: { enabled: true, ttlDays: 3 } });
  let cacheReads = 0;
  let cacheWrites = 0;
  adapter.readCachedPage = async () => { cacheReads += 1; return null; };
  adapter.writeCachedPage = async () => { cacheWrites += 1; };
  global.Request = class {
    constructor() { this.response = null; }
    async loadString() {
      this.response = { statusCode: 200 };
      return 'ok';
    }
  };
  try {
    const response = await adapter.postForm('https://venue.example/wp-admin/admin-ajax.php', 'action=x');
    assert.equal(response.ok, true);
  } finally {
    delete global.Request;
  }
  assert.equal(cacheReads, 0, 'an uncached POST must not consult the page cache');
  assert.equal(cacheWrites, 0, 'an uncached POST must not write the page cache');
});

test('a network-truncated run gets an unmissable banner and never claims to be complete', () => {
  const adapter = buildAdapter();
  const html = adapter.buildNetworkTruncationBannerHtml({
    networkTruncated: {
      idleSeconds: 312,
      failures: 6,
      hosts: ['a.example', 'b.example'],
      skippedParsers: ['Furball', 'CHUNK']
    }
  });
  assert.match(html, /INCOMPLETE RUN/);
  assert.match(html, /nothing has been written to the calendar/i);
  assert.match(html, /312s/);
  assert.match(html, /Furball, CHUNK/);
  assert.equal(adapter.buildNetworkTruncationBannerHtml({}), '',
    'a healthy run renders exactly as it did before');
});

test('generateRichHTML puts the truncation banner above everything else on the page', async () => {
  const adapter = buildAdapter();
  const results = { ...buildResultsStub(), totalEvents: 2, rawBearEvents: 2, bearEvents: 2, calendarEvents: 0 };
  results.networkTruncated = { idleSeconds: 300, failures: 4, hosts: ['a.example', 'b.example'], skippedParsers: [] };
  // Earlier tests in this file delete the Calendar stub the module-level setup
  // installed; generateRichHTML reads it.
  global.Calendar = { forEvents: async () => [] };
  const html = await adapter.generateRichHTML(results, {});
  const bannerIndex = html.indexOf('INCOMPLETE RUN');
  const headerIndex = html.indexOf('<div class="header">');
  assert.ok(bannerIndex > -1, 'the banner has to be in the rendered page, not just the log');
  assert.ok(headerIndex > -1);
  assert.ok(bannerIndex < headerIndex,
    'above the header: the header scrolls away and the stat tiles below read like a finished run');
});

// ---------------------------------------------------------------------------
// Transient HTTP statuses on the POST paths: a 503 the AI server answered
// with (model loading, busy) is a failure the retry ladder exists for — it
// must THROW from inside the resilience-wrapped attempt with the status
// stamped, while 4xx client rejections keep the {ok:false} return shape.
// ---------------------------------------------------------------------------

test('postJson: a 503 the AI server answered with engages the retry ladder and succeeds on attempt 2', async () => {
  const adapter = buildAdapter();
  let attempts = 0;
  const slept = [];
  adapter.sleepForNetworkRetry = async (ms) => { slept.push(ms); };
  global.Request = class {
    constructor() { this.response = null; }
    async loadString() {
      attempts += 1;
      if (attempts === 1) {
        this.response = { statusCode: 503 };
        return '{"error":"model is loading"}';
      }
      this.response = { statusCode: 200 };
      return '{"choices":[{"message":{"content":"ok"}}]}';
    }
  };
  try {
    const response = await adapter.postJson('http://rybook.example:8001/v1/chat/completions', { prompt: 'x' });
    assert.equal(response.ok, true, 'the retried attempt came back as an ordinary success');
    assert.equal(response.status, 200);
  } finally {
    delete global.Request;
  }
  assert.equal(attempts, 2, 'the 503 threw into the ladder and a second attempt went out');
  assert.deepEqual(slept, [5000], 'exactly one ladder wait — the first rung');
});

// Behavior guard (passes before and after the fix): genuine client
// rejections keep the return shape every caller already branches on.
test('postJson: a 400 client rejection keeps the {ok:false} return shape with zero retries', async () => {
  const adapter = buildAdapter();
  let attempts = 0;
  const slept = [];
  adapter.sleepForNetworkRetry = async (ms) => { slept.push(ms); };
  global.Request = class {
    constructor() { this.response = null; }
    async loadString() {
      attempts += 1;
      this.response = { statusCode: 400 };
      return 'bad request';
    }
  };
  try {
    const response = await adapter.postJson('http://rybook.example:8001/v1/chat/completions', { prompt: 'x' });
    assert.deepEqual(response, { ok: false, status: 400, text: 'bad request' },
      'callers that log the error body still get it');
  } finally {
    delete global.Request;
  }
  assert.equal(attempts, 1, 'a permanent rejection never buys a retry');
  assert.deepEqual(slept, [], 'and never a millisecond of waiting');
});

test('postJson: a sustained 503 exhausts the ladder into the existing stop semantics, never into give-up', async () => {
  const adapter = buildAdapter();
  let attempts = 0;
  const slept = [];
  adapter.sleepForNetworkRetry = async (ms) => { slept.push(ms); };
  global.Request = class {
    constructor() { this.response = null; }
    async loadString() {
      attempts += 1;
      this.response = { statusCode: 503 };
      return 'busy';
    }
  };
  try {
    await assert.rejects(
      adapter.postJson('http://rybook.example:8001/v1/chat/completions', { prompt: 'x' }),
      (error) => error.statusCode === 503 && /HTTP\s+503/.test(error.message)
    );
    assert.equal(attempts, 6, 'first attempt plus all five ladder rungs');
    assert.deepEqual(slept, [5000, 15000, 30000, 60000, 90000], 'the whole #1643 ladder, unchanged');
    assert.equal(adapter.getNetworkResilience().isGivenUp(), false,
      'the server ANSWERED every time — a 503 storm is proof the network is up, never a give-up');
    // Existing exhaustion semantics take over: the host burned its budget,
    // so the next call to it gets one attempt and no waiting.
    slept.length = 0;
    const attemptsBefore = attempts;
    await assert.rejects(adapter.postJson('http://rybook.example:8001/v1/chat/completions', { prompt: 'x' }));
    assert.equal(attempts - attemptsBefore, 1, 'exhausted host: one attempt');
    assert.deepEqual(slept, [], 'exhausted host: no waiting');
  } finally {
    delete global.Request;
  }
});

test('postForm: a 503 month feed rides the same ladder as postJson and recovers', async () => {
  const adapter = buildAdapter();
  let attempts = 0;
  const slept = [];
  adapter.sleepForNetworkRetry = async (ms) => { slept.push(ms); };
  global.Request = class {
    constructor() { this.response = null; }
    async loadString() {
      attempts += 1;
      if (attempts === 1) {
        this.response = { statusCode: 502 };
        return 'bad gateway';
      }
      this.response = { statusCode: 200 };
      return '{"month":"<div></div>"}';
    }
  };
  try {
    const response = await adapter.postForm('https://venue.example/wp-admin/admin-ajax.php', 'action=x');
    assert.equal(response.ok, true);
  } finally {
    delete global.Request;
  }
  assert.equal(attempts, 2, 'the 502 threw into the ladder and the retry landed');
  assert.deepEqual(slept, [5000], 'same ladder, same first rung');
});

// The Node-side mirror: WebAdapter has no ladder of its own, but the two POST
// methods must keep ONE contract across platforms — transient statuses throw
// with the status stamped (callers catch and degrade exactly as they do when
// the Scriptable ladder exhausts), client rejections keep {ok:false}.
test('WebAdapter.postJson mirrors the contract: 503 throws with the status stamped, 400 keeps {ok:false}', async () => {
  const { WebAdapter } = require('./web-adapter');
  const adapter = new WebAdapter({ cities: {} });
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: false, status: 503, text: async () => 'busy' });
    await assert.rejects(
      adapter.postJson('http://rybook.example:8000/v1/chat/completions', { prompt: 'x' }),
      (error) => error.statusCode === 503 && /HTTP\s+503/.test(error.message)
    );
    global.fetch = async () => ({ ok: false, status: 400, text: async () => 'bad request' });
    const rejected = await adapter.postJson('http://rybook.example:8000/v1/chat/completions', { prompt: 'x' });
    assert.deepEqual(rejected, { ok: false, status: 400, text: 'bad request' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('WebAdapter.postForm mirrors the contract too: 5xx throws stamped, 4xx keeps {ok:false}', async () => {
  const { WebAdapter } = require('./web-adapter');
  const adapter = new WebAdapter({ cities: {} });
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: false, status: 500, text: async () => 'server error' });
    await assert.rejects(
      adapter.postForm('https://venue.example/wp-admin/admin-ajax.php', 'action=x'),
      (error) => error.statusCode === 500 && /HTTP\s+500/.test(error.message)
    );
    global.fetch = async () => ({ ok: false, status: 404, text: async () => 'no such action' });
    const rejected = await adapter.postForm('https://venue.example/wp-admin/admin-ajax.php', 'action=x');
    assert.deepEqual(rejected, { ok: false, status: 404, text: 'no such action' });
  } finally {
    global.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Fix wave 4: multi-day card dates, empty-run suppression, template entries,
// junk-title withhold labeling.
// ---------------------------------------------------------------------------

test('generateEventCard renders the end date on multi-day events and stays start-only for same-day events', () => {
  // Real timezone config for the real record: Spooky Bear, run
  // 20260811-155725 — Oct 29 → Nov 2 2026, ptown (America/New_York).
  const adapter = new ScriptableAdapter({
    cities: { ptown: { timezone: 'America/New_York', patterns: ['ptown'] } }
  });
  const tz = { timeZone: 'America/New_York' };
  const fmtDate = (date) => date.toLocaleDateString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', ...tz
  });
  const fmtTime = (date) => date.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', ...tz
  });

  const start = new Date('2026-10-29T04:00:00.000Z');
  const end = new Date('2026-11-02T04:59:59.000Z');
  assert.notEqual(fmtDate(start), fmtDate(end), 'fixture spans calendar days');
  const multiDay = adapter.generateEventCard({
    title: 'Spooky Bear',
    _action: 'new',
    startDate: '2026-10-29T04:00:00.000Z',
    endDate: '2026-11-02T04:59:59.000Z',
    city: 'ptown'
  });
  // Both dates appear, joined as "<start date> <start time> - <end date> <end time>".
  assert.ok(multiDay.includes(fmtDate(start)), 'start date renders');
  assert.ok(multiDay.includes(fmtDate(end)), 'end date renders');
  // Round 4: each datetime half is an atomic .dt-nowrap span with the
  // separator between them.
  assert.ok(
    multiDay.includes(`<span class="dt-nowrap">${fmtDate(start)} ${fmtTime(start)}</span> - <span class="dt-nowrap">${fmtDate(end)} ${fmtTime(end)}</span>`),
    'multi-day span renders both dates with their times');

  // Same-calendar-day events keep the original start-only format.
  const sameStart = new Date('2026-10-29T18:00:00.000Z');
  const sameEnd = new Date('2026-10-29T23:00:00.000Z');
  assert.equal(fmtDate(sameStart), fmtDate(sameEnd), 'fixture is one calendar day');
  const sameDay = adapter.generateEventCard({
    title: 'Bear Tea',
    _action: 'new',
    startDate: '2026-10-29T18:00:00.000Z',
    endDate: '2026-10-29T23:00:00.000Z',
    city: 'ptown'
  });
  assert.ok(
    sameDay.includes(`<span class="dt-nowrap">${fmtDate(sameStart)} ${fmtTime(sameStart)}</span> - <span class="dt-nowrap">${fmtTime(sameEnd)}</span>`),
    'same-day span is unchanged (modulo the atomic wrap spans)');
  assert.ok(
    !sameDay.includes(` - <span class="dt-nowrap">${fmtDate(sameEnd)}`),
    'no end date on a same-day card');
});

test('zero-parsers-processed runs neither save nor present, but parsers-with-zero-events still save', async () => {
  const buildResults = (parserResults) => ({
    totalEvents: 0,
    rawBearEvents: 0,
    bearEvents: 0,
    duplicatesRemoved: 0,
    calendarEvents: 0,
    errors: [],
    analyzedEvents: [],
    parserResults,
    config: { parsers: [{ name: 'Live Parser', enabled: true }], runtime: {} }
  });
  const drive = async (results) => {
    const adapter = buildAdapter();
    const calls = { saved: 0, presented: 0 };
    // Keep the save/UI decision logic real; stub the heavy display helpers
    // and every storage side effect.
    adapter.displayCalendarProperties = async () => {};
    adapter.compareWithExistingCalendars = async () => {};
    adapter.displayEnrichedEvents = async () => {};
    adapter.persistRunSnapshot = async () => { calls.saved += 1; };
    adapter.presentRichResults = async () => { calls.presented += 1; };
    adapter.ensureRelativeStorageDirs = async () => {};
    adapter.appendLogSummary = async () => {};
    adapter.cleanupOldFiles = async () => 0;
    adapter.buildMetricsRecord = () => null;
    const logLines = [];
    const originalLog = console.log;
    console.log = (...args) => { logLines.push(args.join(' ')); };
    try {
      await adapter.displayResults(results);
    } finally {
      console.log = originalLog;
    }
    return { calls, logLines };
  };

  // Start pressed, no parser ever processed (e.g. picker cancelled): no run
  // file, no results sheet, and the reason is logged.
  const emptyRun = await drive(buildResults([]));
  assert.equal(emptyRun.calls.saved, 0, 'zero-parsers-processed run is not saved');
  assert.equal(emptyRun.calls.presented, 0, 'zero-parsers-processed run presents no UI');
  assert.ok(
    emptyRun.logLines.some((line) =>
      line === '📱 Scriptable: Zero parsers processed this run — skipping run save and results UI'),
    'the suppression is logged');

  // A run that processed parsers and found 0 events is a REAL run (audit
  // doctrine): it must still save and still present.
  const zeroEvents = await drive(buildResults([
    { name: 'Live Parser', totalEvents: 0, rawBearEvents: 0, bearEvents: 0, duplicatesRemoved: 0 }
  ]));
  assert.ok(zeroEvents.calls.saved >= 1, '0-event run with processed parsers still saves');
  assert.equal(zeroEvents.calls.presented, 1, 'and still presents the results UI');
});

test('template entries are invisible to parser-name override matching', () => {
  const adapter = buildAdapter();
  const config = {
    parsers: [
      { name: 'New Site Template', template: true, urls: ['https://example.com/events'] },
      { name: 'Live Parser', urls: ['https://example.org/events'] }
    ]
  };
  // Even an exact-name request cannot run a template entry, and the error's
  // available-parsers list does not advertise it.
  assert.throws(
    () => adapter.buildParserNameOverrideConfig('New Site Template', config),
    /not found in scraper-input\.js\. Available parsers: Live Parser$/);
  const live = adapter.buildParserNameOverrideConfig('Live Parser', config);
  assert.equal(live.parserConfig.name, 'Live Parser');
});

test('junk-title flagged events surface Write: withheld instead of promising a CREATE', () => {
  const adapter = buildAdapter();
  const event = {
    title: 'View Event →',
    _action: 'new',
    startDate: '2026-08-15T02:00:00.000Z',
    city: 'unknown',
    _sanityFlags: [{ code: 'junk-title', detail: 'title reads as link/CTA text' }]
  };
  assert.equal(adapter.getWriteActionFromEvent(event), 'withheld');
  // The card still renders (flag, don't drop) and carries the sanity badge.
  const html = adapter.generateEventCard(event);
  assert.ok(html.includes('sanity-flag-badge'));
  assert.ok(html.includes('junk-title'));
});

// ---------------------------------------------------------------------------
// PERSISTENT MANUAL BEAR VERDICTS — bear-verdicts.json (wave 5).
// A results-UI verdict tap used to survive only if the event was written to
// the calendar; un-executed verdicts evaporated and the bear filter
// re-dropped MEAT RACK every Eagle LA run (run 20260812-002001). The tap now
// persists immediately to the adapter-owned bear-verdicts.json; the next run
// loads it and the bear check honors it.
// ---------------------------------------------------------------------------

const { SharedCore: VerdictSharedCore } = require(path.join(__dirname, '..', 'shared-core'));

function createBearVerdictFmStub() {
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

function buildMeatRackDropEntry() {
  return {
    title: 'MEAT RACK',
    startDate: '2026-09-13T03:00:00.000Z',
    venue: 'Eagle LA',
    reason: "ai: 'Meat Rack' is generic and not confirmed as a known bear party series",
    host: 'eaglela.com',
    event: {
      title: 'MEAT RACK',
      startDate: '2026-09-13T03:00:00.000Z',
      bar: 'Eagle LA',
      address: '4219 Santa Monica Blvd, Los Angeles, CA 90029',
      city: 'los angeles'
    }
  };
}

test('bear verdict store: a tap persists to bear-verdicts.json, reloads, and the bear check consumes it', async () => {
  const adapter = buildAdapter();
  adapter.fm = createBearVerdictFmStub();
  const results = { bearDroppedEvents: [buildMeatRackDropEntry()], analyzedEvents: [] };
  const pending = { markedBear: {}, markedNotBear: {}, keptMarkedBear: {} };
  const webView = { evaluateJavaScript: async () => {} };

  await adapter.recordBearOverrideAndReport('mark-bear', 'd0', results, pending, webView);

  // WRITE happened at tap time — not deferred to view dismissal.
  const persisted = adapter.fm.files.get(adapter.getBearVerdictsFilePath());
  assert.ok(persisted, 'bear-verdicts.json is written the moment the verdict is tapped');
  // The tap still records the pending rescue exactly as before.
  assert.ok(pending.markedBear.d0, 'the in-session rescue slot is unchanged');

  // READ at next-run load.
  const loaded = await adapter.loadBearVerdicts();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].verdict, 'bear');
  assert.equal(loaded[0].title, 'MEAT RACK');
  assert.equal(loaded[0].venue, 'Eagle LA');
  assert.ok(loaded[0].stampedAt, 'the entry is date-stamped');

  // CONSUME: injected as core.bearVerdicts, the stored verdict outranks the
  // cascade on the NEXT run — for a different date of the same party.
  const core = new VerdictSharedCore({}, { eventSchema: TestEventSchema });
  core.bearVerdicts = loaded;
  const drops = [];
  const kept = await core.filterBearEvents(
    [{ ...buildMeatRackDropEntry().event, startDate: new Date('2026-09-27T03:00:00.000Z') }],
    { name: 'eagle', ai: { bearCheck: { mode: 'enforce' } } },
    null,
    drops
  );
  assert.equal(kept.length, 1, 'next run keeps MEAT RACK');
  assert.equal(drops.length, 0);
  assert.ok(String(kept[0].bearSource || '').startsWith('manual-bear (verdict store'),
    'provenance names the manual store');
});

test('bear verdict store: the opposite tap overwrites the stored verdict (last tap wins)', async () => {
  const adapter = buildAdapter();
  adapter.fm = createBearVerdictFmStub();
  const entry = buildMeatRackDropEntry();
  const results = { bearDroppedEvents: [entry], analyzedEvents: [{ ...entry.event }] };
  const pending = { markedBear: {}, markedNotBear: {}, keptMarkedBear: {} };
  const webView = { evaluateJavaScript: async () => {} };

  await adapter.recordBearOverrideAndReport('mark-bear', 'd0', results, pending, webView);
  // The reverse verdict, tapped on the kept card of the same identity.
  await adapter.recordBearOverrideAndReport('mark-not-bear', 'k0', results, pending, webView);

  const loaded = await adapter.loadBearVerdicts();
  assert.equal(loaded.length, 1, 'one identity, one entry — the reverse tap updates in place');
  assert.equal(loaded[0].verdict, 'not_bear');
});

test('bear dropped section: _duplicateOfKept entries fold out of the pile with a count note', () => {
  const adapter = buildAdapter();
  const shown = buildBearDroppedFixture();
  const folded = {
    ...buildBearDroppedFixture(),
    title: 'Treasure Trail',
    _duplicateOfKept: 'Treasure Trail Seattle',
    event: { ...buildBearDroppedFixture().event, title: 'Treasure Trail' }
  };

  const html = adapter.generateBearDroppedSection({ bearDroppedEvents: [shown, folded] });
  assert.ok(html.includes('Twink Bash'), 'a real drop still renders');
  assert.ok(!html.includes('event-title">Treasure Trail<'),
    'the duplicate card is folded out of the dropped pile');
  assert.match(html, /1 dropped record was a duplicate of a kept event/,
    'a one-line note reports the fold');

  // The chip still counts ENTRIES (the drop happened), not rendered cards.
  assert.equal(adapter.bearDroppedEntryCount({ bearDroppedEvents: [shown, folded] }), 2);

  // All-folded still renders the section as just the note.
  const allFolded = adapter.generateBearDroppedSection({ bearDroppedEvents: [folded, { ...folded }] });
  assert.match(allFolded, /2 dropped records were duplicates of kept events/);
});

// ---------------------------------------------------------------------------
// Wave 6 — results-UI skimmability: sectioned pile, headline+expander cards,
// collapsed dropped pile, repeated-image badge, plain merge-row labels.
// ---------------------------------------------------------------------------

// One event per pile plus a dropped entry, so section order and counts are
// all observable in a single render.
function buildWave6Results() {
  return {
    analyzedEvents: [
      { title: 'Actionable New', _action: 'new', startDate: '2026-09-01T02:00:00.000Z' },
      {
        title: 'Actionable Merge',
        _action: 'merge',
        startDate: '2026-09-02T02:00:00.000Z',
        _changes: ['image'],
        _analysis: { reason: 'matched existing calendar event' }
      },
      {
        title: 'Saved Series Match',
        _action: 'merge',
        startDate: '2026-09-03T02:00:00.000Z',
        _seriesMatch: true
      },
      {
        title: 'Saved Merge NoOp',
        _action: 'merge',
        startDate: '2026-09-04T02:00:00.000Z',
        _changes: []
      },
      {
        title: 'Withheld Recurring',
        _action: 'new',
        startDate: '2026-09-05T02:00:00.000Z',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR'
      },
      {
        title: 'Withheld Past Span',
        _action: 'new',
        startDate: '2026-01-05T02:00:00.000Z',
        _pastSpanWithheld: true
      },
      {
        title: 'View Event →',
        _action: 'new',
        startDate: '2026-09-06T02:00:00.000Z',
        _sanityFlags: [{ code: 'junk-title', detail: 'title reads as link/CTA text' }]
      }
    ],
    bearDroppedEvents: [
      {
        title: 'Trivia Night',
        startDate: '2026-09-07T02:00:00.000Z',
        venue: 'Some Bar',
        reason: 'ai: no bear-specific language',
        host: 'somebar.example',
        event: { title: 'Trivia Night', startDate: '2026-09-07T02:00:00.000Z', bar: 'Some Bar' }
      }
    ],
    errors: [],
    parserResults: []
  };
}

test('results sheet renders the skim piles in order with counts (live run)', async () => {
  const adapter = buildAdapter();
  const html = await adapter.generateRichHTML(buildWave6Results());

  const order = [
    'New Events to Add',
    'Events to Merge (Adding Info)',
    'Already Saved (No Action)',
    'Withheld (Not Written)',
    'Dropped as non-bear'
  ];
  const positions = order.map((title) => html.indexOf(title));
  positions.forEach((pos, i) => {
    assert.ok(pos !== -1, `section "${order[i]}" is present`);
    if (i > 0) {
      assert.ok(positions[i - 1] < pos, `"${order[i - 1]}" renders before "${order[i]}"`);
    }
  });

  // Counts: 2 already-saved (series match + merge no-op), 3 withheld
  // (recurring, past span, junk title), 1 dropped.
  const savedSection = html.slice(html.indexOf('Already Saved (No Action)'), html.indexOf('Withheld (Not Written)'));
  assert.ok(savedSection.includes('<span class="section-count">2</span>'), 'already-saved count chip says 2');
  const withheldSection = html.slice(html.indexOf('Withheld (Not Written)'), html.indexOf('Dropped as non-bear'));
  assert.ok(withheldSection.includes('<span class="section-count">3</span>'), 'withheld count chip says 3');

  // The withheld/saved reasons ride the card headline as chips.
  assert.ok(html.includes('🔁 already saved — matches this series'));
  assert.ok(html.includes('✅ merge no-op — calendar already has all of this'));
  assert.ok(html.includes('⏳ span fully past — nothing left to attend'));
  assert.ok(html.includes('🚫 junk title — write withheld'));
  assert.ok(html.includes('🔁 recurring — save via ICS, never auto-written'));

  // The saved/withheld events left the actionable piles: New counts only the
  // one actionable new event.
  const newSection = html.slice(html.indexOf('New Events to Add'), html.indexOf('Events to Merge (Adding Info)'));
  assert.ok(newSection.includes('<span class="section-count">1</span>'), 'New pile holds only the actionable event');
});

test('saved-run display renders the same skim piles (rehydration path)', async () => {
  const adapter = buildAdapter();
  adapter.loadRunLogsForDisplay = async () => ({ runId: '20260812-000000', exists: false });
  const html = await adapter.generateRichHTML({
    ...buildWave6Results(),
    _isDisplayingSavedRun: true,
    savedRunId: '20260812-000000'
  });
  for (const title of [
    'New Events to Add',
    'Already Saved (No Action)',
    'Withheld (Not Written)',
    'Dropped as non-bear'
  ]) {
    assert.ok(html.includes(title), `saved-run render has "${title}"`);
  }
  assert.ok(html.includes('⏳ span fully past — nothing left to attend'));
  // Saved-run cards render verdicts read-only, but the buttons still exist.
  assert.ok(html.includes('markBearOverride(this)'));
});

test('the dropped pile is collapsed by default and keeps the mark-bear rescue button', async () => {
  const adapter = buildAdapter();
  const html = await adapter.generateRichHTML(buildWave6Results());

  const detailsIdx = html.indexOf('<details class="bear-dropped-details">');
  assert.ok(detailsIdx !== -1, 'dropped section wraps its cards in a <details>');
  assert.ok(!html.includes('<details class="bear-dropped-details" open'), 'the dropped <details> starts collapsed');

  const droppedSection = html.slice(detailsIdx);
  assert.ok(droppedSection.includes('data-bear-act="mark-bear"'), 'mark-bear rescue button rendered inside');
  assert.ok(droppedSection.includes('🚫 DROPPED — NOT BEAR'), 'dropped card badge rendered inside');
  // The bear-check reason is on the collapsed card headline, not buried.
  assert.ok(droppedSection.includes('headline-reason-chip'));
  assert.ok(droppedSection.includes('ai: no bear-specific language'));
});

test('the already-saved pile is collapsed by default (owner 2026-08-20: no-update events can fold away)', async () => {
  const adapter = buildAdapter();
  const html = await adapter.generateRichHTML(buildWave6Results());

  const idx = html.indexOf('<details class="bear-dropped-details saved-noop-details">');
  assert.ok(idx !== -1, 'saved section wraps its cards in a <details>');
  assert.ok(!html.includes('<details class="bear-dropped-details saved-noop-details" open'),
    'the saved <details> starts collapsed');

  const savedDetails = html.slice(idx, html.indexOf('Withheld (Not Written)'));
  assert.ok(savedDetails.includes('Already Saved (No Action)'), 'summary keeps the section title');
  assert.ok(savedDetails.includes('✅ merge no-op — calendar already has all of this'),
    'no-op card rendered inside the collapsed pile');
});

test('event cards are headline + main section + hidden raw payload, nothing deleted', async () => {
  const adapter = buildAdapter();
  const event = {
    title: 'Bear Night',
    _action: 'new',
    startDate: '2026-09-01T02:00:00.000Z',
    endDate: '2026-09-01T05:00:00.000Z',
    bar: 'The Eagle',
    address: '1 Main St',
    city: 'unknown',
    description: 'A very bear night',
    notes: 'website: https://example.com',
    image: 'https://example.com/poster.jpg'
  };
  const html = adapter.generateEventCard(event);

  // Headline face: title, 📅 date, 📍 venue.
  const headlineIdx = html.indexOf('<div class="event-headline">');
  assert.ok(headlineIdx !== -1, 'card has a headline block');
  // Round 3 dissolved the "Details" expander; round 4 dissolved the debug
  // expander too — the card body IS the main section, and only the hidden
  // Raw-mode payload block sits below it.
  assert.ok(!html.includes('<details class="event-card-details">'), 'no monolithic Details expander');
  assert.ok(!html.includes('event-card-debug'), 'no debug expander either');
  const bodyIdx = html.indexOf('<div class="event-details">');
  const rawIdx = html.indexOf('<div class="raw-display">');
  assert.ok(bodyIdx !== -1, 'card has a main section');
  assert.ok(rawIdx !== -1, 'card keeps its raw payload block');
  assert.ok(headlineIdx < bodyIdx && bodyIdx < rawIdx, 'headline, then main section, then raw payload');
  const headline = html.slice(headlineIdx, bodyIdx);
  assert.ok(headline.includes('Bear Night'));
  assert.ok(headline.includes('📅'));
  assert.ok(headline.includes('📍'));
  assert.ok(headline.includes('The Eagle'));

  // The face carries the route info (as bridge links) and the thumbnail.
  assert.ok(headline.includes('1 Main St'), 'address on the face route line');
  assert.ok(headline.includes('event-thumb'), 'image visible on the face');
  const body = html.slice(bodyIdx, rawIdx);
  assert.ok(body.includes('A very bear night'), 'description on the main section');
  assert.ok(body.includes('📝 Calendar Notes Preview'), 'notes preview kept');
  const raw = html.slice(rawIdx);
  assert.ok(raw.includes('raw-json'), 'debug JSON kept');
  assert.ok(raw.includes('copyEventJSON(this)'), 'copy button kept');
  assert.ok(!html.includes('image-container'), 'no duplicate image block anywhere');
});

test('multi-day headline carries the end date, same-day only the end time', () => {
  const adapter = buildAdapter();
  const multiDay = adapter.generateEventCard({
    title: 'Festival',
    _action: 'new',
    startDate: '2026-08-28T20:00:00.000Z',
    endDate: '2026-08-31T20:00:00.000Z',
    city: 'unknown'
  });
  const headline = multiDay.slice(
    multiDay.indexOf('<div class="event-headline">'),
    multiDay.indexOf('<div class="event-face-controls">')
  );
  assert.ok(/Aug 28.*Aug 31/s.test(headline), 'headline shows both start and end dates');
});

test('repeated-image badge fires at 3+ uses in one run and never at 2', async () => {
  const sharedImage = 'https://venue.example/MORE-INFO-Coming-Soon.jpg';
  const makeEvent = (i) => ({
    title: `Event ${i}`,
    _action: 'new',
    startDate: '2026-09-01T02:00:00.000Z',
    image: sharedImage
  });

  const adapter3 = buildAdapter();
  const html3 = await adapter3.generateRichHTML({
    analyzedEvents: [makeEvent(1), makeEvent(2), makeEvent(3)],
    errors: [],
    parserResults: []
  });
  // The census surfaces on the face thumbnail (the details image block is
  // gone — the thumb IS the card's image now): greyed class + count chip.
  assert.ok(html3.includes('🖼️ placeholder ×3'), 'badge fires at 3 uses');
  assert.ok(html3.includes('event-thumb venue-placeholder-thumb'), 'thumb greyed via class');

  const adapter2 = buildAdapter();
  const html2 = await adapter2.generateRichHTML({
    analyzedEvents: [makeEvent(1), makeEvent(2)],
    errors: [],
    parserResults: []
  });
  assert.ok(!html2.includes('🖼️ placeholder ×'), 'no badge at 2 uses');
  assert.ok(!html2.includes('event-thumb venue-placeholder-thumb'));
});

test('dropped cards count toward the repeated-image census', async () => {
  const sharedImage = 'https://venue.example/placeholder.jpg';
  const adapter = buildAdapter();
  const html = await adapter.generateRichHTML({
    analyzedEvents: [
      { title: 'Kept 1', _action: 'new', startDate: '2026-09-01T02:00:00.000Z', image: sharedImage },
      { title: 'Kept 2', _action: 'new', startDate: '2026-09-02T02:00:00.000Z', image: sharedImage }
    ],
    bearDroppedEvents: [
      {
        title: 'Dropped 1',
        reason: 'ai: not bear',
        host: 'venue.example',
        event: { title: 'Dropped 1', startDate: '2026-09-03T02:00:00.000Z', image: sharedImage }
      }
    ],
    errors: [],
    parserResults: []
  });
  assert.ok(html.includes('🖼️ placeholder ×3'), '2 kept + 1 dropped = 3 uses, badge fires');
});

test('merge rows label deterministic vs AI vs no-op decisions in plain words', () => {
  const adapter = buildAdapter();
  const event = {
    title: 'Merge Labels',
    _action: 'merge',
    startDate: '2026-09-01T02:00:00.000Z',
    city: 'unknown',
    website: 'https://www.furball.example',
    image: 'https://cdn.example/new-poster.jpg',
    bar: 'Same Bar',
    key: 'merge-labels',
    _original: {
      scraper: {
        website: 'https://events.ticketleap.example/furball',
        image: 'https://cdn.example/new-poster.jpg',
        bar: 'Same Bar'
      },
      calendar: {
        website: 'https://www.furball.example',
        image: 'https://cdn.example/old-poster.jpg',
        bar: 'Same Bar'
      },
      merged: {
        website: 'https://www.furball.example',
        image: 'https://cdn.example/new-poster.jpg',
        bar: 'Same Bar'
      }
    },
    _fieldPriorities: {
      website: { merge: 'ai' },
      image: { merge: 'ai' }
    },
    _mergeDecisions: [
      {
        field: 'website',
        existingValue: 'https://www.furball.example',
        newValue: 'https://events.ticketleap.example/furball',
        chosenValue: 'https://www.furball.example',
        reason: 'identity link beats a ticketing/social platform URL',
        source: 'deterministic'
      },
      {
        field: 'image',
        existingValue: 'https://cdn.example/old-poster.jpg',
        newValue: 'https://cdn.example/new-poster.jpg',
        chosenValue: 'https://cdn.example/new-poster.jpg',
        reason: 'poster names this event',
        source: 'ai'
      }
    ]
  };
  const html = adapter.generateEventCard(event);

  // The card table renders ONLY rows that changed something: the AI adoption
  // in full, reason in the shared row format's own reason cell.
  assert.ok(html.includes('🤝 AI — chose new'));
  assert.ok(html.includes('poster names this event'));
  // No-op rows (deterministic kept-existing, same-value) compress into one
  // summary line naming the untouched fields (owner: the merge section
  // should just be the changes).
  assert.ok(!html.includes('🔒 DETERMINISTIC — kept existing'));
  assert.ok(!html.includes('SAME VALUE'));
  assert.ok(html.includes('2 fields unchanged'), 'summary line counts the no-ops');
  assert.ok(/2 fields unchanged — [^<]*website/.test(html), 'summary names the untouched fields');
  // Strategy under the field name reads as words, not a bare "ai".
  assert.ok(html.includes('<small>AI-arbitrated</small>'));
  assert.ok(!html.includes('<small>ai</small>'));

  // The uncompressed renderer keeps EVERY row — deterministic label and its
  // reason intact for tooling and the provenance-preserve tests.
  const fullRows = adapter.generateComparisonRows(event);
  assert.ok(fullRows.includes('🔒 DETERMINISTIC — kept existing'));
  assert.ok(fullRows.includes('identity link beats a ticketing/social platform URL'));
  assert.ok(fullRows.includes('SAME VALUE'));
});

test('merge rows label calendar stickiness and clobber fallback', () => {
  const adapter = buildAdapter();
  const base = {
    title: 'Sticky Labels',
    _action: 'merge',
    startDate: '2026-09-01T02:00:00.000Z',
    city: 'unknown',
    key: 'sticky-labels',
    _original: {
      scraper: { ticketUrl: 'https://tickets.example/new' },
      calendar: { ticketUrl: 'https://tickets.example/saved' },
      merged: { ticketUrl: 'https://tickets.example/saved' }
    },
    _fieldPriorities: { ticketUrl: { merge: 'ai' } }
  };
  const stickyEvent = {
    ...base,
    ticketUrl: 'https://tickets.example/saved',
    _mergeDecisions: [{
      field: 'ticketUrl',
      existingValue: 'https://tickets.example/saved',
      newValue: 'https://tickets.example/new',
      chosenValue: 'https://tickets.example/saved',
      reason: 'calendar stickiness (binding) — saved value kept without AI arbitration',
      source: 'sticky'
    }]
  };
  const stickyHtml = adapter.generateEventCard(stickyEvent);
  // A sticky keep is a no-op — compressed off the card table into the
  // summary line; the labeled row survives in the uncompressed renderer.
  assert.ok(!stickyHtml.includes('🧊 KEPT EXISTING (calendar stickiness)'));
  assert.ok(/\d+ fields? unchanged — [^<]*ticketUrl/.test(stickyHtml), 'ticketUrl named in the unchanged summary');
  assert.ok(adapter.generateComparisonRows(stickyEvent).includes('🧊 KEPT EXISTING (calendar stickiness)'));

  const fallbackHtml = adapter.generateEventCard({
    ...base,
    ticketUrl: 'https://tickets.example/new',
    _mergeDecisions: [{
      field: 'ticketUrl',
      existingValue: 'https://tickets.example/saved',
      newValue: 'https://tickets.example/new',
      chosenValue: 'https://tickets.example/new',
      reason: 'ai unavailable/rejected — clobber fallback',
      source: 'fallback'
    }]
  });
  assert.ok(fallbackHtml.includes('⚠️ NO AI ANSWER — took new (clobber fallback)'));
});

// ---------------------------------------------------------------------------
// Display truth for post-merge deterministic rewrites — the REAL record from
// run 20260815-083809, "TWISTED BEAR San Francisco Debut": the merge-time
// gmaps regeneration replaced the calendar's 73-char coordinate query with
// the 139-char bar+address query, nothing recorded the decision, and the row
// rendered "AI-arbitrated … KEPT EXISTING (no change)" while counting as
// changed. A row must never claim both.
// ---------------------------------------------------------------------------

const TWISTED_CAL_GMAPS =
  'https://www.google.com/maps/search/?api=1&query=37.7699933%2C-122.4133375';
const TWISTED_REBUILT_GMAPS =
  'https://www.google.com/maps/search/?api=1&query=San%20Francisco%20Eagle%20Bar%2C%20398%2012th%20Street%2C%20San%20Francisco%2C%20CA%2094103';

function twistedBearEvent(overrides = {}) {
  const bar = 'San Francisco Eagle Bar';
  const address = '398 12th Street, San Francisco, CA 94103';
  return {
    title: 'TWISTED BEAR San Francisco Debut',
    _action: 'merge',
    startDate: '2026-08-23T04:00:00.000Z',
    endDate: '2026-08-23T09:00:00.000Z',
    location: '37.7699933, -122.4133375',
    bar,
    address,
    gmaps: TWISTED_REBUILT_GMAPS,
    city: 'sf',
    key: 'twisted-bear-san-francisco-debut|2026-08-23|san francisco eagle bar',
    _original: {
      // The scraper offered NO gmaps at all ("scraped: undefined" in the
      // owner's paste); the calendar stored the coordinate query.
      scraper: {
        bar,
        address,
        location: '37.7699927, -122.4134077',
        key: 'twisted-bear-san-francisco-debut|2026-08-23|san francisco eagle bar'
      },
      calendar: {
        bar,
        address,
        gmaps: TWISTED_CAL_GMAPS,
        location: '37.7699933, -122.4133375',
        title: 'TWISTED BEAR San Francisco Debut',
        startDate: '2026-08-23T04:00:00.000Z',
        endDate: '2026-08-23T09:00:00.000Z',
        key: 'twisted-bear-san-francisco-debut|2026-08-23|san francisco eagle bar'
      },
      merged: { bar, address, gmaps: TWISTED_REBUILT_GMAPS }
    },
    _fieldPriorities: {
      gmaps: { merge: 'ai' },
      bar: { merge: 'ai' },
      address: { merge: 'ai' }
    },
    ...overrides
  };
}

test('TWISTED BEAR: a recorded deterministic gmaps rebuild renders once, as a change, with its reason', () => {
  const adapter = buildAdapter();
  const event = twistedBearEvent({
    _mergeDecisions: [
      {
        field: 'gmaps',
        existingValue: TWISTED_CAL_GMAPS,
        newValue: undefined,
        chosenValue: TWISTED_REBUILT_GMAPS,
        reason:
          'gmaps rebuilt from the final merged bar + address (derived field — replaces the stored link)',
        source: 'deterministic'
      }
    ]
  });

  const records = adapter.buildComparisonRowRecords(event);
  const gmapsRows = records.filter((record) => record.field === 'gmaps');
  assert.equal(gmapsRows.length, 1, 'the gmaps row renders exactly once');
  const row = gmapsRows[0];
  assert.equal(row.changed, true, 'a rebuilt link IS a change');
  assert.ok(row.html.includes('🔒 DETERMINISTIC — rewrote'), `truthful outcome label: ${row.html}`);
  assert.ok(row.html.includes('rebuilt from the final merged bar + address'), 'the rebuild reason rides in the reason cell');
  assert.ok(row.html.includes('<small>deterministic</small>'), 'the strategy slot names the real source');
  assert.ok(!row.html.includes('KEPT EXISTING (no change)'), 'a changed row never claims no change');
  assert.ok(!row.html.includes('AI-arbitrated'), 'the AI touched nothing on this field');

  assert.equal(adapter.countChangedMergeFields(event), 1, 'the chip counts the one real change');
  const card = adapter.generateEventCard(event);
  assert.ok(!card.includes('KEPT EXISTING (no change)'), 'no self-contradiction anywhere on the card');
  assert.ok(!card.includes('AI-arbitrated'), 'no AI credit anywhere on the card');
});

test('TWISTED BEAR without a decision record (older saved runs) still never self-contradicts', () => {
  const adapter = buildAdapter();
  const event = twistedBearEvent(); // no _mergeDecisions — the pre-fix run shape

  const records = adapter.buildComparisonRowRecords(event);
  const row = records.find((record) => record.field === 'gmaps');
  assert.equal(row.changed, true, 'value truth: merged differs from calendar');
  assert.ok(row.html.includes('CHANGED (no decision recorded)'),
    `an unattributed change says so plainly: ${row.html}`);
  assert.ok(!row.html.includes('KEPT EXISTING (no change)'), 'the contradictory composite is dead');
  assert.ok(!row.html.includes('AI-arbitrated'),
    'aiArbitration is null for this event — the AI is never blamed');
  assert.ok(row.html.includes('<small>ai (not arbitrated)</small>'),
    'the strategy slot admits arbitration never ran');
});

test('TWISTED BEAR unchanged twin renders "no changes"', () => {
  const adapter = buildAdapter();
  const event = twistedBearEvent({ gmaps: TWISTED_CAL_GMAPS });
  event._original = {
    ...event._original,
    merged: { ...event._original.merged, gmaps: TWISTED_CAL_GMAPS }
  };

  const records = adapter.buildComparisonRowRecords(event);
  const row = records.find((record) => record.field === 'gmaps');
  assert.equal(row.changed, false, 'identical link → no-op');
  assert.ok(row.html.includes('KEPT EXISTING (no change)'), 'the no-op label is reserved for true no-ops');
  assert.equal(adapter.countChangedMergeFields(event), 0, 'the twin card says "no changes"');
});

test('every existing card action survives the headline redesign (live + saved run)', async () => {
  const results = {
    analyzedEvents: [
      {
        title: 'Recurring With Everything',
        _action: 'new',
        startDate: '2026-09-04T02:00:00.000Z',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=TH',
        bar: 'The Eagle',
        city: 'unknown',
        address: '1 Main St',
        location: '34.05,-118.24'
      }
    ],
    bearDroppedEvents: [
      {
        title: 'Dropped One',
        reason: 'ai: not bear',
        host: 'x.example',
        event: { title: 'Dropped One', startDate: '2026-09-05T02:00:00.000Z', bar: 'Bar X' }
      }
    ],
    errors: [],
    parserResults: []
  };

  const assertActions = (html, label) => {
    // ICS export for the recurring card.
    assert.ok(html.includes('exportRecurringIcs(this)'), `${label}: ICS export button`);
    assert.ok(html.includes('data-ics-export-id='), `${label}: ICS export id registered`);
    // Event Builder prefill link.
    assert.ok(html.includes('event-builder-link'), `${label}: event-builder link`);
    // Map verify links (bar/address/pin → openMapVerify bridge).
    assert.ok(html.includes('openMapVerify(this)'), `${label}: map verify handler`);
    assert.ok(html.includes('data-map-url-id='), `${label}: map verify id registered`);
    // Bear verdict buttons (kept card and dropped card).
    assert.ok(html.includes('markBearOverride(this)'), `${label}: bear verdict buttons`);
    assert.ok(html.includes('data-bear-act="mark-bear"'), `${label}: mark-bear action`);
    assert.ok(html.includes('data-bear-act="mark-not-bear"'), `${label}: mark-not-bear action`);
    // Copy buttons.
    assert.ok(html.includes('copyEventJSON(this)'), `${label}: copy JSON button`);
    // The chunkyscrape:// bridge page handlers are still installed.
    assert.ok(html.includes("chunkyscrape://act?a="), `${label}: chunkyscrape bridge`);
  };

  const liveAdapter = buildAdapter();
  assertActions(await liveAdapter.generateRichHTML(results), 'live');

  const savedAdapter = buildAdapter();
  savedAdapter.loadRunLogsForDisplay = async () => ({ runId: '20260812-000001', exists: false });
  assertActions(
    await savedAdapter.generateRichHTML({
      ...results,
      _isDisplayingSavedRun: true,
      savedRunId: '20260812-000001'
    }),
    'saved run'
  );
});

test('_duplicateOfKept records render as one-liners, not full cards (feature-detected)', async () => {
  const adapter = buildAdapter();
  const html = await adapter.generateRichHTML({
    analyzedEvents: [
      { title: 'Kept Event', _action: 'new', startDate: '2026-09-01T02:00:00.000Z' },
      {
        title: 'Second Copy',
        _action: 'new',
        startDate: '2026-09-01T02:00:00.000Z',
        _duplicateOfKept: 'Kept Event'
      }
    ],
    bearDroppedEvents: [
      {
        title: 'Dropped Copy',
        reason: 'ai: not bear',
        host: 'x.example',
        _duplicateOfKept: { title: 'Kept Event' },
        event: { title: 'Dropped Copy', startDate: '2026-09-01T02:00:00.000Z' }
      }
    ],
    errors: [],
    parserResults: []
  });

  assert.ok(html.includes('duplicate-folded-line'), 'one-liner rendered');
  assert.ok(html.includes('"Second Copy" — duplicate of "Kept Event"'), 'analyzed duplicate folded');
  assert.ok(html.includes('"Dropped Copy" — duplicate of "Kept Event"'), 'dropped duplicate folded');
  // The folded records never render as full cards: their bear-verdict button
  // ids (k1 for the analyzed copy, d0 for the dropped copy) must not exist.
  assert.ok(!html.includes('data-bear-idx="k1"'), 'no full card for the analyzed duplicate');
  assert.ok(!html.includes('data-bear-idx="d0"'), 'no full card for the dropped duplicate');
});

// ---------------------------------------------------------------------------
// Execute from saved run: affordance, mandatory re-analysis, audit trail
// ---------------------------------------------------------------------------

function buildSavedRunResults(overrides = {}) {
  return {
    _isDisplayingSavedRun: true,
    sourceRunId: '20260810-101010',
    _savedRunTimestamp: '2026-08-10T10:10:10.000Z',
    totalEvents: 1,
    bearEvents: 1,
    calendarEvents: 0,
    errors: [],
    parserResults: [{ name: 'Eagle', bearEvents: 1, totalEvents: 1 }],
    analyzedEvents: [
      {
        title: 'Bear Night',
        startDate: '2026-08-20T02:00:00.000Z',
        bar: 'The Eagle',
        _action: 'new',
        _analysis: { action: 'new', reason: 'no match at Mac-run time' }
      }
    ],
    config: { parsers: [{ name: 'Eagle', dryRun: false }], config: {} },
    ...overrides
  };
}

// Wires every UI/persistence seam to capturing stubs so the flow runs
// headlessly; individual tests re-override what they assert on.
function instrumentSavedRunAdapter(adapter, captured) {
  adapter.getIdentityCore = () => ({
    prepareEventsForCalendar: async (events) => {
      captured.analyzed = events;
      return events.map((event) => ({ ...event, _action: 'merge' }));
    }
  });
  adapter.executeCalendarActions = async (events) => {
    captured.executed = events;
    return events.length;
  };
  adapter.presentSavedRunExecutionConfirm = async (events, extras) => {
    captured.confirmEvents = events;
    captured.confirmExtras = extras;
    return true;
  };
  adapter.presentSavedRunExecutionNotice = async (title, message) => {
    captured.notices.push({ title, message });
  };
  adapter.preflightSavedRunWriteAccess = async () => true;
  adapter.persistExecutedSavedRunSnapshot = async (results) => {
    captured.persisted = results;
    return results.savedRunId || results.sourceRunId || null;
  };
}

test('saved-run display renders the execute affordance; live and web renders do not', async () => {
  const adapter = buildAdapter();
  const html = await renderSavedRunPage(adapter, savedRunLogInfo());
  assert.ok(html.includes('id="saved-run-execute"'), 'affordance section rendered for a saved run');
  assert.ok(html.includes("Execute this run's writes"), 'explicit execute button label');
  assert.ok(html.includes('requestSavedRunExecute'), 'button wired to the chunkyscrape:// bridge');
  assert.ok(html.includes('a=execute-run'), 'bridge action emitted');
  assert.ok(/is <strong>[^<]+<\/strong>/.test(html), 'run age surfaced on the affordance');

  // A live run gets no execute-from-saved-run affordance
  const liveHtml = await adapter.generateRichHTML({
    ...buildResultsStub(),
    totalEvents: 2,
    bearEvents: 2,
    calendarEvents: 0,
    errors: [],
    parserResults: []
  });
  assert.ok(!liveHtml.includes('id="saved-run-execute"'), 'live runs have no saved-run execute section');

  // The web target has no chunkyscrape:// bridge: no affordance there either
  adapter.loadRunLogsForDisplay = async () => savedRunLogInfo();
  const webHtml = await adapter.generateRichHTML(
    {
      ...buildResultsStub(),
      _isDisplayingSavedRun: true,
      savedRunId: '20260804-125703',
      totalEvents: 2,
      bearEvents: 2,
      calendarEvents: 0,
      errors: [],
      parserResults: []
    },
    { target: 'web' }
  );
  assert.ok(!webHtml.includes('id="saved-run-execute"'), 'web renders stay report-only');
});

test('saved-run display keeps verdict taps live when the verdict store is present', async () => {
  const adapter = buildAdapter();
  const html = await renderSavedRunPage(adapter, savedRunLogInfo());
  // Kept cards carry tappable verdict buttons (k0/k1 from buildResultsStub)
  assert.ok(html.includes('data-bear-idx="k0"'), 'kept card verdict row rendered');
  assert.ok(!html.includes('data-bear-act="mark-bear" disabled'), 'saved-run verdict buttons are NOT disabled on the phone');
  // Direct callers (and web renders) keep the read-only default: the
  // generateBearDroppedSection tests above still assert disabled buttons.
});

test('executing a saved run re-analyzes against the live calendar and executes ONLY the fresh plan', async () => {
  const adapter = buildAdapter();
  const captured = { notices: [] };
  instrumentSavedRunAdapter(adapter, captured);
  const results = buildSavedRunResults();

  const processed = await adapter.executeSavedRunWrites(results);

  assert.equal(processed, 1);
  // the live-analysis seam received the STRIPPED underlying event, not the stale intent
  assert.equal(captured.analyzed.length, 1);
  assert.equal(captured.analyzed[0]._action, undefined, 'stale saved _action never enters re-analysis');
  assert.equal(captured.analyzed[0]._analysis, undefined, 'stale saved _analysis never enters re-analysis');
  assert.equal(captured.analyzed[0]._savedRunSourceIndex, 0, 'source index stamped for the delta report');
  // what EXECUTES is the fresh verdict: saved said NEW, live analysis says MERGE
  assert.equal(captured.executed.length, 1);
  assert.equal(captured.executed[0]._action, 'merge', 'fresh MERGE executes, never the saved NEW');
  // the confirmation surfaced the staleness + the delta
  const header = (captured.confirmExtras.headerLines || []).join('\n');
  assert.ok(header.includes('This run is'), 'run age on the confirmation');
  assert.ok(header.includes('saved NEW → now MERGE'), 'saved-vs-fresh delta on the confirmation');
  assert.equal(results.calendarEvents, 1, 'executed count recorded on results');
  assert.ok(captured.persisted, 'execution outcome persisted back to the run');
});

test('withheld/recurring events never reach the write call even if the saved JSON claims otherwise', async () => {
  const adapter = buildAdapter();
  const captured = { notices: [] };
  instrumentSavedRunAdapter(adapter, captured);
  // Passthrough analysis: the live pass returns the events as analyzed —
  // the recurring rule on the event data is what must gate the write.
  adapter.getIdentityCore = () => ({
    prepareEventsForCalendar: async (events) => {
      captured.analyzed = events;
      return events.map((event) => ({ ...event, _action: 'new' }));
    }
  });
  let confirmCalled = false;
  adapter.presentSavedRunExecutionConfirm = async () => {
    confirmCalled = true;
    return true;
  };
  const results = buildSavedRunResults({
    analyzedEvents: [
      {
        // the saved JSON CLAIMS this is a plain writable NEW event…
        title: 'Weekly Bear Trivia',
        _action: 'new',
        // …but the event data defines a recurring series
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU'
      },
      {
        title: 'Dry Run Parser Event',
        _action: 'new',
        _parserConfig: { name: 'X', dryRun: true }
      }
    ]
  });

  const processed = await adapter.executeSavedRunWrites(results);

  assert.equal(processed, 0);
  assert.equal(captured.executed, undefined, 'executeCalendarActions never called');
  assert.equal(confirmCalled, false, 'nothing executable → no execute confirmation at all');
  assert.ok(
    captured.notices.some((notice) => notice.title === 'Nothing Executable'),
    'degrades with clear messaging instead of writing or throwing'
  );
});

test('executing a saved run rewrites the SAME run file with the execution audit trail', async () => {
  const adapter = buildAdapter();
  const writes = [];
  adapter.fm = {
    documentsDirectory: () => '/tmp/chunky-dad-adapter-test',
    joinPath: (a, b) => `${a}/${b}`,
    fileExists: () => false,
    isDirectory: () => false,
    createDirectory: () => {},
    remove: () => {},
    writeString: (filePath, content) => writes.push({ filePath, content })
  };
  const captured = { notices: [] };
  instrumentSavedRunAdapter(adapter, captured);
  // real persistence path (instrumentSavedRunAdapter stubbed it)
  adapter.persistExecutedSavedRunSnapshot =
    Object.getPrototypeOf(adapter).persistExecutedSavedRunSnapshot.bind(adapter);
  const results = buildSavedRunResults({
    // the display clone carries the readOnly-forced dryRun; the stashed
    // original is what must land back on disk
    config: { parsers: [{ name: 'Eagle', dryRun: true }], config: {} },
    _savedRunOriginalConfig: { parsers: [{ name: 'Eagle', dryRun: false }], config: {} },
    savedRunExecutions: []
  });

  const processed = await adapter.executeSavedRunWrites(results);
  assert.equal(processed, 1);

  const runWrite = writes.find((write) => write.filePath.endsWith('/runs/20260810-101010.json'));
  assert.ok(runWrite, 'the SAME run file (loaded run id) is rewritten — no fork into a new id');
  const payload = JSON.parse(runWrite.content);
  assert.equal(payload.summary.runId, '20260810-101010');
  assert.equal(payload.summary.timestamp, '2026-08-10T10:10:10.000Z', 'original run timestamp preserved');
  assert.equal(payload.summary.totals.calendarEvents, 1, 'executed count on the audit totals');
  assert.equal(payload.executions.length, 1, 'execution recorded');
  assert.equal(payload.executions[0].processed, 1);
  assert.ok(payload.executions[0].executedAt, 'executed-at stamped');
  assert.equal(payload.config.parsers[0].dryRun, false, 'ORIGINAL config persisted, not the readOnly-forced clone');
  assert.equal(payload.analyzedEvents[0]._action, 'merge', 'run file now shows the fresh plan that executed');
});

test('saved-run execution honors the loaded config dryRun as a preview and degrades on empty runs', async () => {
  // dryRun: plan previewed, nothing written, run file untouched
  const adapter = buildAdapter();
  const captured = { notices: [] };
  instrumentSavedRunAdapter(adapter, captured);
  const dryResults = buildSavedRunResults({
    config: { parsers: [{ name: 'Eagle', dryRun: false }], config: { dryRun: true } }
  });
  const dryProcessed = await adapter.executeSavedRunWrites(dryResults);
  assert.equal(dryProcessed, 0);
  assert.equal(captured.executed, undefined, 'dry run never writes');
  assert.equal(captured.persisted, undefined, 'dry run never rewrites the run file');
  const dryNotice = captured.notices.find((notice) => notice.title === 'Dry Run Preview');
  assert.ok(dryNotice, 'dry-run preview messaged');
  assert.ok(String(dryNotice.message).includes('This run is'), 'staleness still surfaced in the preview');

  // zero analyzable events: clear messaging, no throw
  const emptyAdapter = buildAdapter();
  const emptyCaptured = { notices: [] };
  instrumentSavedRunAdapter(emptyAdapter, emptyCaptured);
  const emptyProcessed = await emptyAdapter.executeSavedRunWrites(
    buildSavedRunResults({ analyzedEvents: [] })
  );
  assert.equal(emptyProcessed, 0);
  assert.ok(
    emptyCaptured.notices.some((notice) => notice.title === 'Nothing to Execute'),
    'zero-event saved runs degrade with clear messaging'
  );

  // missing/unreachable calendar: live analysis throws → degrade, never write
  const brokenAdapter = buildAdapter();
  const brokenCaptured = { notices: [] };
  instrumentSavedRunAdapter(brokenAdapter, brokenCaptured);
  brokenAdapter.getIdentityCore = () => ({
    prepareEventsForCalendar: async () => {
      throw new Error('calendar unavailable');
    }
  });
  const brokenProcessed = await brokenAdapter.executeSavedRunWrites(buildSavedRunResults());
  assert.equal(brokenProcessed, 0);
  assert.equal(brokenCaptured.executed, undefined, 'no writes without a fresh analysis');
  assert.ok(
    brokenCaptured.notices.some((notice) => notice.title === 'Live Analysis Failed'),
    'missing calendar degrades with clear messaging, not a throw'
  );
});

// ---------------------------------------------------------------------------
// Wave 7 — dense default card face (rework of the rejected wave-6 redesign):
// image/date/route/verdict visible with NO expander interaction, honest end
// times, and ONE shared row format for merge/provenance/notes field data.
// ---------------------------------------------------------------------------

function buildDenseFaceEvent(overrides = {}) {
  return {
    title: 'Bear Night',
    _action: 'new',
    startDate: '2026-09-01T19:00:00.000Z',
    endDate: '2026-09-01T22:00:00.000Z',
    bar: 'The Eagle',
    address: '4444 Hollywood Blvd, Los Angeles, CA',
    location: '34.0522,-118.2437',
    city: 'unknown',
    image: 'https://example.com/poster.jpg',
    ...overrides
  };
}

test('default card face shows thumbnail, full date line, route line and verdict control without expanding', () => {
  const adapter = buildAdapter();
  const card = adapter.generateEventCard(buildDenseFaceEvent(), {}, {
    bearIdx: 'k0',
    bearVerdict: 'bear',
    interactive: true
  });
  const rawIdx = card.indexOf('<div class="raw-display">');
  assert.ok(rawIdx !== -1, 'card still embeds its raw payload block');
  const face = card.slice(0, rawIdx);

  // The image is visible by default again (owner: "it removed the image").
  assert.ok(face.includes('event-thumb'), 'thumbnail block on the face');
  assert.ok(face.includes('<img src="https://example.com/poster.jpg"'), 'the event image itself');

  // Full date line: start AND end time, no tap needed (each half an atomic
  // nowrap span since round 4).
  assert.ok(face.includes('📅'), 'date line present');
  assert.ok(face.includes('7:00 PM</span> - <span class="dt-nowrap">10:00 PM'), 'start and end time on the face');

  // Compact route line: bar • short street address • pin link over the
  // existing openMapVerify bridge.
  assert.ok(face.includes('event-route-line'), 'route line present');
  assert.ok(face.includes('The Eagle'), 'bar on the route line');
  assert.ok(face.includes('4444 Hollywood Blvd'), 'street address on the route line');
  assert.ok(!face.includes('4444 Hollywood Blvd, Los Angeles'), 'address is the SHORT street form');
  assert.ok(face.includes('data-map-url-id='), 'pin link registered on the bridge');
  assert.ok(face.includes('34.0522,-118.2437'), 'coordinates readable on the face');

  // Bear verdict control on the face, same handlers as ever.
  assert.ok(face.includes('markBearOverride(this)'), 'verdict control needs no expanding');
  assert.ok(face.includes('data-bear-act="mark-bear"'));
});

test('zero-duration events render "(no end listed)" and never a fabricated end time', () => {
  const adapter = buildAdapter();
  // Eagle LA MEC-feed shape: endDate === startDate on every event.
  const card = adapter.generateEventCard(buildDenseFaceEvent({
    startDate: '2026-08-13T02:00:00.000Z',
    endDate: '2026-08-13T02:00:00.000Z'
  }));
  assert.ok(card.includes('(no end listed)'), 'zero-duration says so honestly');
  assert.ok(!card.includes('2:00 AM - 2:00 AM'), 'no fabricated "start - start" end time');

  // A missing endDate is the same truth.
  const noEnd = adapter.generateEventCard(buildDenseFaceEvent({
    startDate: '2026-08-13T02:00:00.000Z',
    endDate: null
  }));
  assert.ok(noEnd.includes('(no end listed)'));

  // A REAL end still renders in full — the honesty note never eats real data.
  const real = adapter.generateEventCard(buildDenseFaceEvent());
  assert.ok(real.includes('7:00 PM</span> - <span class="dt-nowrap">10:00 PM'));
  assert.ok(!real.includes('(no end listed)'));
});

test('multi-day default face renders both dates with the honest end-time logic', () => {
  const adapter = buildAdapter();
  const card = adapter.generateEventCard(buildDenseFaceEvent({
    startDate: '2026-08-28T20:00:00.000Z',
    endDate: '2026-08-31T20:00:00.000Z'
  }));
  const face = card.slice(0, card.indexOf('<div class="event-face-controls">'));
  assert.ok(/Aug 28.*Aug 31/s.test(face), 'both start and end dates on the face');
  assert.ok(!face.includes('(no end listed)'));
});

function buildSharedFormatMergeEvent() {
  return {
    title: 'Shared Format',
    _action: 'merge',
    startDate: '2026-09-01T02:00:00.000Z',
    city: 'unknown',
    key: 'shared-format',
    bar: 'The Eagle',
    website: 'https://www.example.com',
    notes: 'website: https://www.example.com\nShow up early',
    _original: {
      scraper: { bar: 'Eagle LA', website: 'https://tickets.example/x' },
      calendar: { bar: 'The Eagle', website: 'https://www.example.com' },
      merged: { bar: 'The Eagle', website: 'https://www.example.com' }
    },
    _fieldPriorities: { website: { merge: 'ai' } },
    _mergeDecisions: [{
      field: 'website',
      existingValue: 'https://www.example.com',
      newValue: 'https://tickets.example/x',
      chosenValue: 'https://www.example.com',
      reason: 'identity link beats a ticketing URL',
      source: 'deterministic'
    }]
  };
}

test('merge, provenance and notes-preview rows all share the one field-row format', () => {
  const adapter = buildAdapter();
  const event = buildSharedFormatMergeEvent();
  const headerRow = '<tr><th>Field</th><th>Value</th><th>Source / Outcome</th><th>Reason</th></tr>';

  // 1) Merge comparison rows.
  const mergeRows = adapter.generateComparisonRows(event);
  assert.ok(mergeRows.includes('class="field-row"'), 'merge rows use the shared row class');
  assert.ok(mergeRows.includes('field-row-source'), 'merge rows carry the source/outcome cell');

  // 2) Folded provenance rows (round 4: the provenance section dissolved
  // into the merge table) use the very same row builder.
  const folded = adapter.buildFoldedProvenanceRecords(
    { ...event, _original: { ...event._original, calendar: { ...event._original.calendar, city: 'berlin' } }, city: 'unknown' },
    new Set(['bar', 'website'])
  );
  assert.ok(folded.length > 0, 'provenance-only fields fold into records');
  assert.ok(folded.every(r => r.html.includes('class="field-row"')), 'folded rows use the shared row class');
  // Export control markup survives, on the card actions row.
  const exportControl = adapter.buildExportIssueControlHtml(event, { runId: 'r1' });
  assert.ok(exportControl.includes('exportProvenanceIssue(this)'), 'export-issue handler kept');
  assert.ok(exportControl.includes('provenance-export-btn'), 'export control classes kept');

  // 3) Calendar-notes preview inside the card.
  const card = adapter.generateEventCard(event);
  const notesIdx = card.indexOf('📝 Calendar Notes Preview');
  assert.ok(notesIdx !== -1);
  const notesRegion = card.slice(notesIdx, card.indexOf('</details>', notesIdx));
  assert.ok(notesRegion.includes('class="field-row"'), 'notes preview uses the shared row class');
  assert.ok(notesRegion.includes(headerRow), 'notes preview renders the shared table header');

  // The card's merge table renders the same header too — one format, three surfaces.
  assert.ok(card.includes(headerRow));
});

test('review subsections live on the main section; the raw payload hides below it', () => {
  const adapter = buildAdapter();
  const event = buildSharedFormatMergeEvent();
  const card = adapter.generateEventCard(event);
  // Round 3 dissolved the Details expander; round 4 the debug expander.
  assert.ok(!card.includes('<details class="event-card-details">'), 'no Details expander');
  assert.ok(!card.includes('event-card-debug'), 'no debug expander');
  const bodyIdx = card.indexOf('<div class="event-details">');
  const rawIdx = card.indexOf('<div class="raw-display">');
  assert.ok(bodyIdx !== -1 && rawIdx !== -1 && bodyIdx < rawIdx);

  // Merge comparison and notes preview are MAIN-SECTION subsections now.
  for (const marker of ['Merge Comparison', '📝 Calendar Notes Preview']) {
    const idx = card.indexOf(marker);
    assert.ok(idx > bodyIdx && idx < rawIdx, `"${marker}" lives on the main section`);
  }
  // The raw JSON payload sits in the hidden Raw-mode block below the body.
  assert.ok(card.indexOf('class="raw-json"') > rawIdx, 'raw JSON in the raw-display block');

  // Every existing action handler still present.
  assert.ok(card.includes('toggleComparisonSection('));
  assert.ok(card.includes('toggleDiffView(this'));
  assert.ok(card.includes('exportProvenanceIssue(this)'));
  assert.ok(card.includes('copyEventJSON(this)'));
});

test('placeholder-badged thumbnails stay visible on the face with their badge', async () => {
  const sharedImage = 'https://venue.example/MORE-INFO-Coming-Soon.jpg';
  const makeEvent = (i) => ({
    title: `Event ${i}`,
    _action: 'new',
    startDate: '2026-09-01T02:00:00.000Z',
    image: sharedImage
  });
  const adapter = buildAdapter();
  const html = await adapter.generateRichHTML({
    analyzedEvents: [makeEvent(1), makeEvent(2), makeEvent(3)],
    errors: [],
    parserResults: []
  });
  // The thumb renders (visible), greyed via the placeholder class, with a
  // compact badge — flagged, never dropped.
  assert.ok(html.includes('event-thumb venue-placeholder-thumb'), 'thumb greyed via class');
  assert.ok(html.includes('event-thumb-badge'), 'compact placeholder badge on the thumb');
  assert.ok(html.includes('🖼️ placeholder ×3'), 'badge states the reuse count');
});

// ---------------------------------------------------------------------------
// url/website are ONE field: the comparison display never renders a separate
// `url` row (run 20260811-135556: every merge card carried a phantom scraped
// `url` differing from the calendar's native empty one).
// ---------------------------------------------------------------------------
test('getFieldsForComparison excludes url — one links row, never a url twin', () => {
  const adapter = new ScriptableAdapter({ cities: {} });
  const event = {
    title: 'BEEFMINCE x RVT',
    website: 'https://beefmince.com',
    url: 'https://beefmince.com',
    _original: {
      scraper: { website: 'https://beefmince.com' },
      calendar: { website: 'https://beefmince.com', url: undefined },
      merged: { website: 'https://beefmince.com' }
    }
  };
  const fields = adapter.getFieldsForComparison(event);
  assert.equal(fields.includes('website'), true, 'website is the ONE canonical links field');
  assert.equal(fields.includes('url'), false, 'url is an alias/view — never a comparison row of its own');
});

// ---------------------------------------------------------------------------
// Results-UI compression (owner feedback): tappable route line, merge tag +
// changed-rows-only details, Evidence in the debug block only
// ---------------------------------------------------------------------------

function buildCompressionMergeEvent(overrides = {}) {
  const shared = {
    bar: 'Massive',
    address: '1400 12th Ave, Seattle, WA 98122',
    location: '47.6135, -122.3163',
    title: 'Compressed Night',
    startDate: '2026-09-01T02:00:00.000Z',
    endDate: '2026-09-01T05:00:00.000Z',
    // Real runs stamp key on BOTH _original sides (checked against
    // rerun-0812) — an absent key would inflate the changed-field count.
    key: 'compressed-night'
  };
  return {
    ...shared,
    _action: 'merge',
    city: 'seattle',
    image: 'https://cdn.example/new-poster.jpg',
    website: 'https://www.example.com',
    _evidenceLines: ['pin is 0 m from curated pin', 'bar corroborated: curated'],
    _original: {
      scraper: { ...shared, image: 'https://cdn.example/new-poster.jpg', website: 'https://tickets.example/x' },
      calendar: { ...shared, image: 'https://cdn.example/old-poster.jpg', website: 'https://www.example.com' },
      merged: { ...shared, image: 'https://cdn.example/new-poster.jpg', website: 'https://www.example.com' }
    },
    _fieldPriorities: { image: { merge: 'ai' }, website: { merge: 'ai' } },
    _mergeDecisions: [
      {
        field: 'image',
        existingValue: 'https://cdn.example/old-poster.jpg',
        newValue: 'https://cdn.example/new-poster.jpg',
        chosenValue: 'https://cdn.example/new-poster.jpg',
        reason: 'poster names this event',
        source: 'ai'
      },
      {
        field: 'website',
        existingValue: 'https://www.example.com',
        newValue: 'https://tickets.example/x',
        chosenValue: 'https://www.example.com',
        reason: 'identity link beats a ticketing URL',
        source: 'deterministic'
      }
    ],
    ...overrides
  };
}

test('route line parts are tappable bridge links: bar (own gmaps first), address, pin, and Route', () => {
  const adapter = buildMapsAdapter();
  adapter.resetMapVerifyUrls();
  const card = adapter.generateEventCard(
    buildCompressionMergeEvent({ gmaps: 'https://maps.app.goo.gl/abc123' })
  );
  const face = card.slice(0, card.indexOf('<div class="event-details">'));

  const urlFor = (cls) => {
    const m = face.match(new RegExp(`data-map-url-id="(\\d+)" class="map-verify-link ${cls}"`));
    return m ? adapter._mapVerifyUrls[m[1]] : undefined;
  };
  assert.equal(urlFor('route-bar-link'), 'https://maps.app.goo.gl/abc123',
    'bar links the event\'s own gmaps/place link when it has one');
  assert.ok(urlFor('route-address-link').startsWith(MAPS_SEARCH_PREFIX), 'address links a maps search');
  assert.ok(urlFor('route-address-link').includes('1400%2012th%20Ave'), 'search carries the stored address');
  assert.ok(urlFor('route-pin-link').endsWith('47.6135%2C-122.3163'), 'pin links the stored coordinates');
  assert.ok(urlFor('route-directions-link').startsWith(MAPS_DIR_PREFIX),
    'the Route directions link rides the face route line now');
  // Every part goes through the SAME shouldAllowRequest bridge — no plain
  // https hrefs that would navigate the results WebView away.
  assert.ok(!face.includes('href="https'), 'no plain https hrefs on the route line');

  // Without an own gmaps link the bar falls back to a "<bar>, <city>" search.
  adapter.resetMapVerifyUrls();
  const fallbackCard = adapter.generateEventCard(buildCompressionMergeEvent());
  const fallbackFace = fallbackCard.slice(0, fallbackCard.indexOf('<div class="event-details">'));
  const m = fallbackFace.match(/data-map-url-id="(\d+)" class="map-verify-link route-bar-link"/);
  assert.ok(m, 'bar link present without gmaps');
  assert.ok(adapter._mapVerifyUrls[m[1]].startsWith(MAPS_SEARCH_PREFIX));
  assert.ok(adapter._mapVerifyUrls[m[1]].includes('Massive'));
});

test('UITable fallback list rows carry a tappable route link', async () => {
  const adapter = buildMapsAdapter();
  const rows = [];
  const makeCell = (type, title) => ({
    type,
    title,
    rightAligned() {},
    leftAligned() {},
    centerAligned() {}
  });
  class FakeUITableRow {
    constructor() { this.cells = []; }
    addText(title) { const c = makeCell('text', title); this.cells.push(c); return c; }
    addButton(title) { const c = makeCell('button', title); this.cells.push(c); return c; }
  }
  class FakeUITable {
    constructor() { this.rows = []; }
    addRow(row) { rows.push(row); this.rows.push(row); }
    async present() {}
  }
  const opened = [];
  global.UITable = FakeUITable;
  global.UITableRow = FakeUITableRow;
  global.Font = {
    boldSystemFont: () => ({}),
    systemFont: () => ({}),
    italicSystemFont: () => ({})
  };
  global.Color = {
    white: () => ({}), brown: () => ({}), gray: () => ({}),
    blue: () => ({}), green: () => ({}), red: () => ({})
  };
  global.Safari = { open: (url) => opened.push(url) };
  try {
    await adapter.presentUITableFallback({
      totalEvents: 1,
      bearEvents: 1,
      calendarEvents: 0,
      errors: [],
      parserResults: [],
      analyzedEvents: [{
        title: 'Bear Night',
        _action: 'new',
        startDate: '2026-08-01T02:00:00.000Z',
        city: 'seattle',
        bar: 'Massive',
        address: '1400 12th Ave',
        location: '47.6135, -122.3163'
      }]
    });
    const routeCells = rows.flatMap((row) =>
      row.cells.filter((cell) => cell.type === 'button' && cell.title === '📍 Route'));
    assert.equal(routeCells.length, 1, 'the event list row got a route button');
    routeCells[0].onTap();
    assert.equal(opened.length, 1, 'tap opens the maps URL natively');
    assert.ok(opened[0].startsWith(MAPS_DIR_PREFIX), 'route directions URL — same builders as the card');
  } finally {
    delete global.UITable;
    delete global.UITableRow;
    delete global.Font;
    delete global.Color;
    delete global.Safari;
  }

  // The row URL degrades gracefully as location data thins out.
  assert.ok(adapter.buildEventListRowMapsUrl({ location: '47.61, -122.33' }).startsWith(MAPS_SEARCH_PREFIX));
  assert.ok(adapter.buildEventListRowMapsUrl({ bar: 'Massive', city: 'seattle' }).includes('Massive'));
  assert.equal(adapter.buildEventListRowMapsUrl({}), '');
  assert.equal(adapter.buildEventListRowMapsUrl(null), '');
});

test('main section carries no duplicate route/address/date/image blocks', () => {
  const adapter = buildMapsAdapter();
  const card = adapter.generateEventCard(buildCompressionMergeEvent());
  const bodyIdx = card.indexOf('<div class="event-details">');
  const rawIdx = card.indexOf('<div class="raw-display">');
  assert.ok(bodyIdx !== -1 && rawIdx > bodyIdx, 'main section then raw payload block');
  const body = card.slice(bodyIdx, rawIdx);

  assert.ok(!body.includes('map-verify-row'), 'no verify row in the main section');
  assert.ok(!body.includes('<span>📍</span>'), 'no duplicate venue row');
  assert.ok(!body.includes('<span>🏠</span>'), 'no duplicate address row');
  assert.ok(!body.includes('Coordinates:'), 'no duplicate coordinates row');
  assert.ok(!body.includes('<span>📅</span>'), 'no duplicate date row');
  // Round 4: the UTC verification moved onto the face as a muted secondary
  // element — unique info, exactly once.
  const face = card.slice(0, bodyIdx);
  assert.ok(face.includes('event-headline-utc'), 'UTC verification on the face');
  assert.equal((card.match(/event-headline-utc/g) || []).length, 1, 'and only once');
  assert.ok(!body.includes('image-container'), 'no duplicate image block');
  assert.ok(!body.includes('View Full Image'));
});

test('merge state compresses to a counted MERGE tag plus a write tag on the card face', () => {
  const adapter = buildMapsAdapter();
  const card = adapter.generateEventCard(buildCompressionMergeEvent());
  const face = card.slice(0, card.indexOf('<div class="event-details">'));

  // Face: MERGE ·N (N = changed fields) + the write plan as a tag.
  assert.ok(face.includes('MERGE ·1</span>'), 'MERGE tag carries the changed-field count');
  assert.ok(face.includes('write-badge">UPDATE</span>'), 'write tag on the face');
  // The expander note that used to duplicate this is gone.
  assert.ok(!card.includes('Intent: MERGE'), 'no Intent/Write note in the details');

  // Details table: ONLY the changed row, plus one summary line for no-ops.
  assert.ok(card.includes('🤝 AI — chose new'), 'the changed row renders in full');
  assert.ok(!card.includes('🔒 DETERMINISTIC'), 'no-op decision row compressed out');
  const summary = card.match(/(\d+) fields? unchanged/);
  assert.ok(summary, 'one summary line for the unchanged fields');
  assert.ok(Number(summary[1]) >= 5, 'the untouched fields are counted, not rendered as rows');
  assert.ok(card.includes('merge-noop-summary'), 'summary rides the shared table as one row');
  // Tag and table agree by construction.
  assert.equal(adapter.countChangedMergeFields(buildCompressionMergeEvent()), 1);
});

test('Evidence lines render only inside the debug raw-display block', () => {
  const adapter = buildMapsAdapter();
  const card = adapter.generateEventCard(buildCompressionMergeEvent());
  const rawIdx = card.indexOf('class="raw-display"');
  const evidenceIdx = card.indexOf('evidence-block');
  assert.ok(evidenceIdx !== -1, 'evidence still reachable in the debug expander');
  assert.ok(evidenceIdx > rawIdx, 'evidence lives in the debug block, not the default details');
  assert.ok(card.indexOf('pin is 0 m from curated pin') > rawIdx, 'the lines render there');

  const bare = adapter.generateEventCard(buildCompressionMergeEvent({ _evidenceLines: [] }));
  assert.ok(!bare.includes('evidence-block'), 'no lines → no block anywhere (fail open)');
});

test('compression keeps every bridge action id and card handler intact', () => {
  const adapter = buildMapsAdapter();
  // Every chunkyscrape action id round-trips through the bridge URL parser.
  for (const action of [
    'page', 'page-done', 'copy-venue', 'mark-bear', 'mark-not-bear',
    'execute-run', 'queue-venue', 'open-url', 'export-ics', 'copy-logs',
    'ai-prompts', 'beacon'
  ]) {
    const params = adapter.parseReviewActionUrl(`chunkyscrape://act?a=${action}&n=1`);
    assert.equal(params.a, action, `${action} round-trips through the bridge URL`);
  }
  // The compressed card still wires every existing handler.
  const event = buildCompressionMergeEvent({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=TH' });
  const card = adapter.generateEventCard(event, { runId: 'r1' }, {
    bearIdx: 'k0',
    bearVerdict: 'bear',
    interactive: true
  });
  assert.ok(card.includes('route-directions-link'), 'compressed layout marker present');
  for (const handler of [
    'openMapVerify(this)',
    'markBearOverride(this)',
    'copyEventJSON(this)',
    'exportRecurringIcs(this)',
    'exportProvenanceIssue(this)',
    'toggleComparisonSection(',
    'toggleDiffView(this'
  ]) {
    assert.ok(card.includes(handler), `${handler} intact on the compressed card`);
  }
});


// ---------------------------------------------------------------------------
// Results-UI cleanup round 3 (owner feedback): compact header, compact
// buttons, dissolved details subsection, truthful diff state driven by the
// REAL BEEFMINCE Trunk Den record from run 20260813-211637.
// ---------------------------------------------------------------------------

// Real no-op merge from run 20260813-211637 analyzedEvents[0]: every field's
// merged value equals the calendar value (the only _changes entry is "notes",
// which differs by key ordering alone) — the owner's pasted "Has changes over
// 23 fields unchanged" case.
const BEEFMINCE_NOOP_EVENT = {
  "title": "BEEFMINCE Trunk Den",
  "startDate": "2026-08-15T21:00:00.000Z",
  "endDate": "2026-08-16T03:00:00.000Z",
  "location": "51.4863391, -0.1217784",
  "notes": "description: BEEFMINCE is turning the RVT into a sea of banana hammocks for the Trunk Den! Slip on those skimpy swimmers for a night of big boys, big tunes and little trunks, with DJs Ross Jones & Silverhook serving up the summer tunes for our swimwear special theme night in London's most iconic LGBTQ+ venue. Grab yourself a fancy new pair of swimmers from our friends at denloungewear.com and use promo code 'BEEFSWIM15' for 15% off your next swimwear purchase. For Bears, Cubs, Chubs, Muscle Bears, Trans Men, Admirers & everyone in between!\nbar: Royal Vauxhall Tavern\naddress: 372 Kennington Ln, London, United Kingdom SE11 5HY\nticketUrl: https://dice.fm/event/mxdpgl-beefmince-trunk-den-15th-aug-the-royal-vauxhall-tavern-london-tickets\nimage: https://dice-media.imgix.net/attachments/2026-07-27/52a9b2c1-57f7-4a00-baa3-a6a04c4ded74.jpg?rect=0%2C0%2C1080%2C1080\ntimezone: Europe/London\ncover: £12\nwebsite: https://beefmince.com\ninstagram: https://www.instagram.com/rvtofficial\nshortName: BEEF-MINCE\nfavicon: https://beefmince.com\nkey: beefmince-trunk-den|2026-08-15|royal vauxhall tavern\nimageHorizontal: https://dice-media.imgix.net/attachments/2026-07-27/52a9b2c1-57f7-4a00-baa3-a6a04c4ded74.jpg?rect=0%2C216%2C1080%2C648&w=1300&h=630&auto=compress\nbearSource: keyword\npinSource: curated\naddressSource: page\nimageSource: jsonld\nbarSource: curated\ngmaps: https://www.google.com/maps/place/?q=place_id:ChIJuYgA--wEdkgRD-0ylWTyMkw",
  "url": "https://beefmince.com",
  "description": "BEEFMINCE is turning the RVT into a sea of banana hammocks for the Trunk Den! Slip on those skimpy swimmers for a night of big boys, big tunes and little trunks, with DJs Ross Jones & Silverhook serving up the summer tunes for our swimwear special theme night in London's most iconic LGBTQ+ venue. Grab yourself a fancy new pair of swimmers from our friends at denloungewear.com and use promo code 'BEEFSWIM15' for 15% off your next swimwear purchase. For Bears, Cubs, Chubs, Muscle Bears, Trans Men, Admirers & everyone in between!",
  "bar": "Royal Vauxhall Tavern",
  "address": "372 Kennington Ln, London, United Kingdom SE11 5HY",
  "ticketUrl": "https://dice.fm/event/mxdpgl-beefmince-trunk-den-15th-aug-the-royal-vauxhall-tavern-london-tickets",
  "image": "https://dice-media.imgix.net/attachments/2026-07-27/52a9b2c1-57f7-4a00-baa3-a6a04c4ded74.jpg?rect=0%2C0%2C1080%2C1080",
  "source": "ai-web",
  "city": "london",
  "timezone": "Europe/London",
  "cover": "£12",
  "website": "https://beefmince.com",
  "instagram": "https://www.instagram.com/rvtofficial",
  "shortName": "BEEF-MINCE",
  "favicon": "https://beefmince.com",
  "key": "beefmince-trunk-den|2026-08-15|royal vauxhall tavern",
  "imageHorizontal": "https://dice-media.imgix.net/attachments/2026-07-27/52a9b2c1-57f7-4a00-baa3-a6a04c4ded74.jpg?rect=0%2C216%2C1080%2C648&w=1300&h=630&auto=compress",
  "isBearEvent": true,
  "bearSource": "keyword",
  "pinSource": "curated",
  "addressSource": "page",
  "imageSource": "jsonld",
  "barSource": "curated",
  "gmaps": "https://www.google.com/maps/place/?q=place_id:ChIJuYgA--wEdkgRD-0ylWTyMkw",
  "_existingEvent": {
    "title": "BEEFMINCE Trunk Den",
    "identifier": "2DDBF0E6-6877-4FBF-BB94-EC2708DFD113:0B1AA776-F366-45ED-850F-FA5F026D4257",
    "startDate": "2026-08-15T21:00:00.000Z",
    "endDate": "2026-08-16T03:00:00.000Z",
    "location": "51.4863391, -0.1217784"
  },
  "_action": "merge",
  "_fieldPriorities": {
    "title": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "instagram": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "facebook": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "website": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "description": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "rrule": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "bar": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "address": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "startDate": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "endDate": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "url": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "location": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "gmaps": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "image": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "imageVertical": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "imageHorizontal": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "cover": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "ticketUrl": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "key": {
      "merge": "clobber"
    },
    "shortName": {
      "priority": [
        "static"
      ],
      "merge": "clobber"
    },
    "favicon": {
      "priority": [
        "ai-web"
      ],
      "merge": "upsert"
    }
  },
  "_promoter": "BEEFMINCE",
  "_organizer": "DICE",
  "_original": {
    "scraper": {
      "title": "BEEFMINCE Trunk Den",
      "description": "**BEEFMINCE is turning the RVT into a sea of banana hammocks for the Trunk Den!** Slip on those skimpy swimmers for a night of big boys, big tunes and little trunks, with DJs Ross Jones & Silverhook serving up the summer tunes for our swimwear special theme night in London's most iconic LGBTQ+ venue. ***Grab yourself a fancy new pair of swimmers from our friends at denloungewear.com and use promo code 'BEEFSWIM15' for 15% off your next swimwear purchase.*** For Bears, Cubs, Chubs, Muscle Bears, Trans Men, Admirers & everyone in between!",
      "startDate": "2026-08-15T21:00:00.000Z",
      "endDate": "2026-08-16T03:00:00.000Z",
      "bar": "Royal Vauxhall Tavern",
      "address": "372 Kennington Ln, London, United Kingdom SE11 5HY",
      "ticketUrl": "https://dice.fm/event/mxdpgl-beefmince-trunk-den-15th-aug-the-royal-vauxhall-tavern-london-tickets",
      "image": "https://dice-media.imgix.net/attachments/2026-07-27/52a9b2c1-57f7-4a00-baa3-a6a04c4ded74.jpg?rect=0%2C0%2C1080%2C1080",
      "source": "ai-web",
      "city": "london",
      "timezone": "Europe/London",
      "cover": "£12",
      "addressSource": "page",
      "website": "https://beefmince.com",
      "location": "51.4863391, -0.1217784",
      "pinSource": "curated",
      "instagram": "https://www.instagram.com/rvtofficial",
      "notes": "description: **BEEFMINCE is turning the RVT into a sea of banana hammocks for the Trunk Den!** Slip on those skimpy swimmers for a night of big boys, big tunes and little trunks, with DJs Ross Jones & Silverhook serving up the summer tunes for our swimwear special theme night in London's most iconic LGBTQ+ venue. ***Grab yourself a fancy new pair of swimmers from our friends at denloungewear.com and use promo code 'BEEFSWIM15' for 15% off your next swimwear purchase.*** For Bears, Cubs, Chubs, Muscle Bears, Trans Men, Admirers & everyone in between!\nbar: Royal Vauxhall Tavern\naddress: 372 Kennington Ln, London SE11 5HY, UK\nticketUrl: https://dice.fm/event/mxdpgl-beefmince-trunk-den-15th-aug-the-royal-vauxhall-tavern-london-tickets\nimage: https://dice-media.imgix.net/attachments/2026-07-27/52a9b2c1-57f7-4a00-baa3-a6a04c4ded74.jpg?rect=0%2C0%2C1080%2C1080\nimageSource: jsonld\ntimezone: Europe/London\ncover: £12\nbarSource: curated\naddressSource: page\nwebsite: https://link.dice.fm/V0890510c6bd\ngmaps: https://www.google.com/maps/search/?api=1&query=The%20Royal%20Vauxhall%20Tavern%2C%20372%20Kennington%20Ln%2C%20London%20SE11%205HY%2C%20UK\npinSource: curated\ninstagram: https://www.instagram.com/rvtofficial",
      "shortName": "BEEF-MINCE",
      "favicon": "https://beefmince.com",
      "key": "beefmince-trunk-den|2026-08-15|royal vauxhall tavern",
      "imageHorizontal": "https://dice-media.imgix.net/attachments/2026-07-27/52a9b2c1-57f7-4a00-baa3-a6a04c4ded74.jpg?rect=0%2C216%2C1080%2C648&w=1300&h=630&auto=compress",
      "isBearEvent": true,
      "imageSource": "jsonld",
      "barSource": "curated",
      "bearSource": "keyword"
    },
    "calendar": {
      "description": "BEEFMINCE is turning the RVT into a sea of banana hammocks for the Trunk Den! Slip on those skimpy swimmers for a night of big boys, big tunes and little trunks, with DJs Ross Jones & Silverhook serving up the summer tunes for our swimwear special theme night in London's most iconic LGBTQ+ venue. Grab yourself a fancy new pair of swimmers from our friends at denloungewear.com and use promo code 'BEEFSWIM15' for 15% off your next swimwear purchase. For Bears, Cubs, Chubs, Muscle Bears, Trans Men, Admirers & everyone in between!",
      "bar": "Royal Vauxhall Tavern",
      "address": "372 Kennington Ln, London, United Kingdom SE11 5HY",
      "ticketUrl": "https://dice.fm/event/mxdpgl-beefmince-trunk-den-15th-aug-the-royal-vauxhall-tavern-london-tickets",
      "image": "https://dice-media.imgix.net/attachments/2026-07-27/52a9b2c1-57f7-4a00-baa3-a6a04c4ded74.jpg?rect=0%2C0%2C1080%2C1080",
      "timezone": "Europe/London",
      "cover": "£12",
      "imageHorizontal": "https://dice-media.imgix.net/attachments/2026-07-27/52a9b2c1-57f7-4a00-baa3-a6a04c4ded74.jpg?rect=0%2C216%2C1080%2C648&w=1300&h=630&auto=compress",
      "website": "https://beefmince.com",
      "instagram": "https://www.instagram.com/rvtofficial",
      "shortName": "BEEF-MINCE",
      "favicon": "https://beefmince.com",
      "key": "beefmince-trunk-den|2026-08-15|royal vauxhall tavern",
      "bearSource": "keyword",
      "pinSource": "curated",
      "addressSource": "page",
      "imageSource": "jsonld",
      "barSource": "curated",
      "gmaps": "https://www.google.com/maps/place/?q=place_id:ChIJuYgA--wEdkgRD-0ylWTyMkw",
      "title": "BEEFMINCE Trunk Den",
      "startDate": "2026-08-15T21:00:00.000Z",
      "endDate": "2026-08-16T03:00:00.000Z",
      "location": "51.4863391, -0.1217784",
      "notes": "description: BEEFMINCE is turning the RVT into a sea of banana hammocks for the Trunk Den! Slip on those skimpy swimmers for a night of big boys, big tunes and little trunks, with DJs Ross Jones & Silverhook serving up the summer tunes for our swimwear special theme night in London's most iconic LGBTQ+ venue. Grab yourself a fancy new pair of swimmers from our friends at denloungewear.com and use promo code 'BEEFSWIM15' for 15% off your next swimwear purchase. For Bears, Cubs, Chubs, Muscle Bears, Trans Men, Admirers & everyone in between!\nbar: Royal Vauxhall Tavern\naddress: 372 Kennington Ln, London, United Kingdom SE11 5HY\nticketUrl: https://dice.fm/event/mxdpgl-beefmince-trunk-den-15th-aug-the-royal-vauxhall-tavern-london-tickets\nimage: https://dice-media.imgix.net/attachments/2026-07-27/52a9b2c1-57f7-4a00-baa3-a6a04c4ded74.jpg?rect=0%2C0%2C1080%2C1080\ntimezone: Europe/London\ncover: £12\nimageHorizontal: https://dice-media.imgix.net/attachments/2026-07-27/52a9b2c1-57f7-4a00-baa3-a6a04c4ded74.jpg?rect=0%2C216%2C1080%2C648&w=1300&h=630&auto=compress\nwebsite: https://beefmince.com\ninstagram: https://www.instagram.com/rvtofficial\nshortName: BEEF-MINCE\nfavicon: https://beefmince.com\nkey: beefmince-trunk-den|2026-08-15|royal vauxhall tavern\nbearSource: keyword\npinSource: curated\naddressSource: page\nimageSource: jsonld\nbarSource: curated\ngmaps: https://www.google.com/maps/place/?q=place_id:ChIJuYgA--wEdkgRD-0ylWTyMkw"
    },
    "merged": {
      "title": "BEEFMINCE Trunk Den",
      "description": "BEEFMINCE is turning the RVT into a sea of banana hammocks for the Trunk Den! Slip on those skimpy swimmers for a night of big boys, big tunes and little trunks, with DJs Ross Jones & Silverhook serving up the summer tunes for our swimwear special theme night in London's most iconic LGBTQ+ venue. Grab yourself a fancy new pair of swimmers from our friends at denloungewear.com and use promo code 'BEEFSWIM15' for 15% off your next swimwear purchase. For Bears, Cubs, Chubs, Muscle Bears, Trans Men, Admirers & everyone in between!",
      "startDate": "2026-08-15T21:00:00.000Z",
      "endDate": "2026-08-16T03:00:00.000Z",
      "bar": "Royal Vauxhall Tavern",
      "address": "372 Kennington Ln, London, United Kingdom SE11 5HY",
      "ticketUrl": "https://dice.fm/event/mxdpgl-beefmince-trunk-den-15th-aug-the-royal-vauxhall-tavern-london-tickets",
      "image": "https://dice-media.imgix.net/attachments/2026-07-27/52a9b2c1-57f7-4a00-baa3-a6a04c4ded74.jpg?rect=0%2C0%2C1080%2C1080",
      "source": "ai-web",
      "city": "london",
      "timezone": "Europe/London",
      "cover": "£12",
      "website": "https://beefmince.com",
      "instagram": "https://www.instagram.com/rvtofficial",
      "shortName": "BEEF-MINCE",
      "favicon": "https://beefmince.com",
      "key": "beefmince-trunk-den|2026-08-15|royal vauxhall tavern",
      "imageHorizontal": "https://dice-media.imgix.net/attachments/2026-07-27/52a9b2c1-57f7-4a00-baa3-a6a04c4ded74.jpg?rect=0%2C216%2C1080%2C648&w=1300&h=630&auto=compress",
      "isBearEvent": true,
      "bearSource": "keyword",
      "location": "51.4863391, -0.1217784",
      "pinSource": "curated",
      "addressSource": "page",
      "imageSource": "jsonld",
      "barSource": "curated",
      "gmaps": "https://www.google.com/maps/search/?api=1&query=Royal%20Vauxhall%20Tavern%2C%20372%20Kennington%20Ln%2C%20London%2C%20United%20Kingdom%20SE11%205HY"
    },
    "aiArbitration": {
      "arbitrated": [],
      "fallbacks": [],
      "deterministic": [
        "description"
      ]
    }
  },
  "_mergeDecisions": [
    {
      "field": "description",
      "existingValue": "BEEFMINCE is turning the RVT into a sea of banana hammocks for the Trunk Den! Slip on those skimpy swimmers for a night of big boys, big tunes and little trunks, with DJs Ross Jones & Silverhook serving up the summer tunes for our swimwear special theme night in London's most iconic LGBTQ+ venue. Grab yourself a fancy new pair of swimmers from our friends at denloungewear.com and use promo code 'BEEFSWIM15' for 15% off your next swimwear purchase. For Bears, Cubs, Chubs, Muscle Bears, Trans Men, Admirers & everyone in between!",
      "newValue": "**BEEFMINCE is turning the RVT into a sea of banana hammocks for the Trunk Den!** Slip on those skimpy swimmers for a night of big boys, big tunes and little trunks, with DJs Ross Jones & Silverhook serving up the summer tunes for our swimwear special theme night in London's most iconic LGBTQ+ venue. ***Grab yourself a fancy new pair of swimmers from our friends at denloungewear.com and use promo code 'BEEFSWIM15' for 15% off your next swimwear purchase.*** For Bears, Cubs, Chubs, Muscle Bears, Trans Men, Admirers & everyone in between!",
      "chosenValue": "BEEFMINCE is turning the RVT into a sea of banana hammocks for the Trunk Den! Slip on those skimpy swimmers for a night of big boys, big tunes and little trunks, with DJs Ross Jones & Silverhook serving up the summer tunes for our swimwear special theme night in London's most iconic LGBTQ+ venue. Grab yourself a fancy new pair of swimmers from our friends at denloungewear.com and use promo code 'BEEFSWIM15' for 15% off your next swimwear purchase. For Bears, Cubs, Chubs, Muscle Bears, Trans Men, Admirers & everyone in between!",
      "reason": "descriptions are identical once formatting markup is stripped",
      "source": "deterministic"
    }
  ],
  "_changes": [
    "notes"
  ],
  "_mergeDiff": {
    "preserved": [
      "description",
      "bar",
      "address",
      "ticketUrl",
      "image",
      "timezone",
      "cover",
      "imageHorizontal",
      "website",
      "instagram",
      "shortName",
      "favicon",
      "key",
      "bearSource",
      "pinSource",
      "addressSource",
      "imageSource",
      "barSource",
      "gmaps"
    ],
    "added": [],
    "updated": [],
    "removed": []
  },
  "_existingKey": "beefmince-trunk-den|2026-08-15|royal vauxhall tavern",
  "_analysis": {
    "action": "merge",
    "reason": "Key match found",
    "sourceEvent": false,
    "hasOverrideIdentity": false
  },
  "_sanityFlags": []
};

// Real merge WITH a change from the same run (analyzedEvents[4]): the
// calendar had no website, the merge added https://beefmince.com.
const SPOOKMINCE_CHANGE_EVENT = {
  "title": "SPOOKMINCE",
  "startDate": "2026-10-31T22:00:00.000Z",
  "endDate": "2026-11-01T04:00:00.000Z",
  "notes": "description: BEEFMINCE's big Halloween bash is back, and we're haunting a new venue this year! Full info and line up soon.\naddress: London, UK\nticketUrl: https://dice.fm/event/v3x3n7-spookmince-31st-oct-venue-tba-london-london-tickets\nimage: https://dice-media.imgix.net/attachments/2026-07-20/b18c3952-51b5-488c-a72d-8e999074b562.jpg?rect=0%2C0%2C1080%2C1080\ntimezone: Europe/London\ncover: £15\nimageHorizontal: https://dice-media.imgix.net/attachments/2026-07-20/b18c3952-51b5-488c-a72d-8e999074b562.jpg?rect=0%2C216%2C1080%2C648&w=1300&h=630&auto=compress\nwebsite: https://beefmince.com\nshortName: SPOOK-MINCE\nfavicon: https://beefmince.com\nkey: spookmince|2026-10-31|\nbearSource: keyword\nbar: Venue TBA\nbearReview: unsure — ai\\: The event title 'SPOOKMINCE' and minimal description provide no clear indication of bear-scene alignment or audience, and no evidence confirms it was produced by the bear-scene promoter.\naddressSource: page\nimageSource: jsonld\ngmaps: https://www.google.com/maps/search/?api=1&query=Venue%20TBA%2C%20London%2C%20UK",
  "url": "https://beefmince.com",
  "description": "BEEFMINCE's big Halloween bash is back, and we're haunting a new venue this year! Full info and line up soon.",
  "address": "London, UK",
  "ticketUrl": "https://dice.fm/event/v3x3n7-spookmince-31st-oct-venue-tba-london-london-tickets",
  "image": "https://dice-media.imgix.net/attachments/2026-07-20/b18c3952-51b5-488c-a72d-8e999074b562.jpg?rect=0%2C0%2C1080%2C1080",
  "source": "ai-web",
  "city": "london",
  "timezone": "Europe/London",
  "cover": "£15",
  "imageHorizontal": "https://dice-media.imgix.net/attachments/2026-07-20/b18c3952-51b5-488c-a72d-8e999074b562.jpg?rect=0%2C216%2C1080%2C648&w=1300&h=630&auto=compress",
  "website": "https://beefmince.com",
  "shortName": "SPOOK-MINCE",
  "favicon": "https://beefmince.com",
  "key": "spookmince|2026-10-31|",
  "isBearEvent": true,
  "bearSource": "keyword",
  "bar": "Venue TBA",
  "bearReview": "unsure — ai: The event title 'SPOOKMINCE' and minimal description provide no clear indication of bear-scene alignment or audience, and no evidence confirms it was produced by the bear-scene promoter.",
  "addressSource": "page",
  "imageSource": "jsonld",
  "gmaps": "https://www.google.com/maps/search/?api=1&query=Venue%20TBA%2C%20London%2C%20UK",
  "_existingEvent": {
    "title": "SPOOKMINCE",
    "identifier": "2DDBF0E6-6877-4FBF-BB94-EC2708DFD113:C35D68BF-3219-4B72-8EE8-CD8360B483BA",
    "startDate": "2026-10-31T22:00:00.000Z",
    "endDate": "2026-11-01T04:00:00.000Z",
    "location": null
  },
  "_action": "merge",
  "_fieldPriorities": {
    "title": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "instagram": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "facebook": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "website": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "description": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "rrule": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "bar": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "address": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "startDate": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "endDate": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "url": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "location": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "gmaps": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "image": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "imageVertical": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "imageHorizontal": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "cover": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "ticketUrl": {
      "priority": [
        "ai-web"
      ],
      "merge": "ai"
    },
    "key": {
      "merge": "clobber"
    },
    "shortName": {
      "priority": [
        "static"
      ],
      "merge": "clobber"
    },
    "favicon": {
      "priority": [
        "ai-web"
      ],
      "merge": "upsert"
    }
  },
  "_promoter": "SPOOKMINCE",
  "_organizer": "DICE",
  "_original": {
    "scraper": {
      "title": "SPOOKMINCE",
      "description": "**BEEFMINCE's big Halloween bash is back, and we're haunting a new venue this year!** Full info and line up soon.",
      "startDate": "2026-10-31T22:00:00.000Z",
      "endDate": "2026-11-01T04:00:00.000Z",
      "address": "London, UK",
      "ticketUrl": "https://dice.fm/event/v3x3n7-spookmince-31st-oct-venue-tba-london-london-tickets",
      "image": "https://dice-media.imgix.net/attachments/2026-07-20/b18c3952-51b5-488c-a72d-8e999074b562.jpg?rect=0%2C0%2C1080%2C1080",
      "source": "ai-web",
      "city": "london",
      "timezone": "Europe/London",
      "cover": "£15",
      "imageHorizontal": "https://dice-media.imgix.net/attachments/2026-07-20/b18c3952-51b5-488c-a72d-8e999074b562.jpg?rect=0%2C216%2C1080%2C648&w=1300&h=630&auto=compress",
      "addressSource": "page",
      "website": "https://beefmince.com",
      "gmaps": "https://www.google.com/maps/search/?api=1&query=london",
      "shortName": "SPOOK-MINCE",
      "favicon": "https://beefmince.com",
      "key": "spookmince|2026-10-31|",
      "isBearEvent": true,
      "imageSource": "jsonld",
      "bearSource": "keyword"
    },
    "calendar": {
      "description": "BEEFMINCE's big Halloween bash is back, and we're haunting a new venue this year! Full info and line up soon.",
      "address": "London, UK",
      "ticketUrl": "https://dice.fm/event/v3x3n7-spookmince-31st-oct-venue-tba-london-london-tickets",
      "image": "https://dice-media.imgix.net/attachments/2026-07-20/b18c3952-51b5-488c-a72d-8e999074b562.jpg?rect=0%2C0%2C1080%2C1080",
      "timezone": "Europe/London",
      "cover": "£15",
      "imageHorizontal": "https://dice-media.imgix.net/attachments/2026-07-20/b18c3952-51b5-488c-a72d-8e999074b562.jpg?rect=0%2C216%2C1080%2C648&w=1300&h=630&auto=compress",
      "shortName": "SPOOK-MINCE",
      "favicon": "https://beefmince.com",
      "key": "spookmince|2026-10-31|",
      "bearSource": "keyword",
      "bar": "Venue TBA",
      "bearReview": "unsure — ai: The event title 'SPOOKMINCE' and minimal description provide no clear indication of bear-scene alignment or audience, and no evidence confirms it was produced by the bear-scene promoter.",
      "addressSource": "page",
      "imageSource": "jsonld",
      "gmaps": "https://www.google.com/maps/search/?api=1&query=Venue%20TBA%2C%20London%2C%20UK",
      "title": "SPOOKMINCE",
      "startDate": "2026-10-31T22:00:00.000Z",
      "endDate": "2026-11-01T04:00:00.000Z",
      "location": null,
      "notes": "description: BEEFMINCE's big Halloween bash is back, and we're haunting a new venue this year! Full info and line up soon.\naddress: London, UK\nticketUrl: https://dice.fm/event/v3x3n7-spookmince-31st-oct-venue-tba-london-london-tickets\nimage: https://dice-media.imgix.net/attachments/2026-07-20/b18c3952-51b5-488c-a72d-8e999074b562.jpg?rect=0%2C0%2C1080%2C1080\ntimezone: Europe/London\ncover: £15\nimageHorizontal: https://dice-media.imgix.net/attachments/2026-07-20/b18c3952-51b5-488c-a72d-8e999074b562.jpg?rect=0%2C216%2C1080%2C648&w=1300&h=630&auto=compress\nshortName: SPOOK-MINCE\nfavicon: https://beefmince.com\nkey: spookmince|2026-10-31|\nbearSource: keyword\nbar: Venue TBA\nbearReview: unsure — ai\\: The event title 'SPOOKMINCE' and minimal description provide no clear indication of bear-scene alignment or audience, and no evidence confirms it was produced by the bear-scene promoter.\naddressSource: page\nimageSource: jsonld\ngmaps: https://www.google.com/maps/search/?api=1&query=Venue%20TBA%2C%20London%2C%20UK"
    },
    "merged": {
      "title": "SPOOKMINCE",
      "description": "BEEFMINCE's big Halloween bash is back, and we're haunting a new venue this year! Full info and line up soon.",
      "startDate": "2026-10-31T22:00:00.000Z",
      "endDate": "2026-11-01T04:00:00.000Z",
      "address": "London, UK",
      "ticketUrl": "https://dice.fm/event/v3x3n7-spookmince-31st-oct-venue-tba-london-london-tickets",
      "image": "https://dice-media.imgix.net/attachments/2026-07-20/b18c3952-51b5-488c-a72d-8e999074b562.jpg?rect=0%2C0%2C1080%2C1080",
      "source": "ai-web",
      "city": "london",
      "timezone": "Europe/London",
      "cover": "£15",
      "imageHorizontal": "https://dice-media.imgix.net/attachments/2026-07-20/b18c3952-51b5-488c-a72d-8e999074b562.jpg?rect=0%2C216%2C1080%2C648&w=1300&h=630&auto=compress",
      "website": "https://beefmince.com",
      "shortName": "SPOOK-MINCE",
      "favicon": "https://beefmince.com",
      "key": "spookmince|2026-10-31|",
      "isBearEvent": true,
      "bearSource": "keyword",
      "bar": "Venue TBA",
      "bearReview": "unsure — ai: The event title 'SPOOKMINCE' and minimal description provide no clear indication of bear-scene alignment or audience, and no evidence confirms it was produced by the bear-scene promoter.",
      "addressSource": "page",
      "imageSource": "jsonld",
      "gmaps": "https://www.google.com/maps/search/?api=1&query=Venue%20TBA%2C%20London%2C%20UK"
    },
    "aiArbitration": {
      "arbitrated": [],
      "fallbacks": [],
      "deterministic": [
        "description"
      ]
    }
  },
  "_mergeDecisions": [
    {
      "field": "description",
      "existingValue": "BEEFMINCE's big Halloween bash is back, and we're haunting a new venue this year! Full info and line up soon.",
      "newValue": "**BEEFMINCE's big Halloween bash is back, and we're haunting a new venue this year!** Full info and line up soon.",
      "chosenValue": "BEEFMINCE's big Halloween bash is back, and we're haunting a new venue this year! Full info and line up soon.",
      "reason": "descriptions are identical once formatting markup is stripped",
      "source": "deterministic"
    }
  ],
  "_changes": [
    "location",
    "url",
    "notes"
  ],
  "_mergeDiff": {
    "preserved": [
      "description",
      "address",
      "ticketUrl",
      "image",
      "timezone",
      "cover",
      "imageHorizontal",
      "shortName",
      "favicon",
      "key",
      "bearSource",
      "bar",
      "bearReview",
      "addressSource",
      "imageSource",
      "gmaps"
    ],
    "added": [
      {
        "key": "website",
        "value": "https://beefmince.com"
      }
    ],
    "updated": [],
    "removed": []
  },
  "_existingKey": "spookmince|2026-10-31|",
  "_analysis": {
    "action": "merge",
    "reason": "Key match found",
    "sourceEvent": false,
    "hasOverrideIdentity": false
  },
  "_sanityFlags": []
};

function freshRound3Event(source) {
  return JSON.parse(JSON.stringify(source));
}

function round3Results(overrides = {}) {
  return {
    totalEvents: 3,
    rawBearEvents: 3,
    bearEvents: 2,
    calendarEvents: 1,
    duplicatesRemoved: 0,
    errors: [],
    parserResults: [],
    analyzedEvents: [freshRound3Event(BEEFMINCE_NOOP_EVENT)],
    ...overrides
  };
}

test('round3: page header is one compact line — logo kept, huge title/stat tiles gone', async () => {
  const adapter = buildAdapter();
  const html = await adapter.generateRichHTML(round3Results());

  // The cool logo stays.
  assert.ok(html.includes('class="header-logo"'), 'logo kept');
  // The huge markup is gone: no 32px title/subtitle blocks, no stat tiles.
  assert.ok(!html.includes('header-subtitle'), 'no subtitle block');
  assert.ok(!html.includes('<div class="header-title">'), 'no huge title block');
  assert.ok(!html.includes('<div class="stats">'), 'no stat-tile grid');
  assert.ok(!html.includes('Total Events Found'), 'no stat-tile labels');
  // What remains is informative: run context + counts on one line.
  assert.ok(html.includes('class="header-line"'), 'single compact header line');
  assert.ok(html.includes('Run: '), 'run context in the header line');
  const counts = html.match(/<span class="header-counts">([\s\S]*?)<\/span>\s*<\/div>/);
  assert.ok(html.includes('class="header-counts"'), 'counts line present');
  assert.ok(/3<\/span> found/.test(html), 'total count');
  assert.ok(/2<\/span> bear/.test(html), 'bear count');
  assert.ok(/1<\/span> calendar action/.test(html), 'calendar count');
  // The page JS still finds its three .stat-value spans (copy/export paths).
  assert.equal((html.match(/class="stat-value"/g) || []).length, 3);
});

test('round3: action buttons are a compact row, not full-width slabs', async () => {
  const adapter = buildAdapter();
  const html = await adapter.generateRichHTML(round3Results());

  assert.ok(html.includes('class="controls-bar"'), 'one compact controls bar');
  assert.ok(html.includes('onclick="copyRawOutput()"'), 'copy handler kept');
  assert.ok(html.includes('onclick="exportAsJSON()"'), 'export handler kept');
  assert.ok(html.includes('id="displayToggle"') && html.includes('id="sfwToggle"'), 'toggles kept');
  assert.ok(html.includes('class="mini-btn"'), 'buttons are mini');
  assert.ok(!html.includes('📋 Copy Raw Output'), 'no slab-sized button labels');
  assert.ok(!html.includes('📄 Export JSON'), 'no slab-sized button labels');
  assert.ok(!/action-buttons\s*\{[^}]*flex-direction:\s*column/.test(html),
    'no full-width stacking rule for the action buttons');

  // Saved-run execute button: compact inline, same id/handler, never 100% wide.
  const section = adapter.buildSavedRunExecuteSectionHtml({
    _isDisplayingSavedRun: true,
    analyzedEvents: [freshRound3Event(BEEFMINCE_NOOP_EVENT)],
    sourceRunId: '20260813-211637'
  });
  assert.ok(section.includes('id="saved-run-execute-btn"'));
  assert.ok(section.includes('requestSavedRunExecute(this)'));
  assert.ok(!section.includes('width: 100%'), 'execute button is not a full-width slab');
});

test('round3: description renders on the card face, clamped, with an in-page toggle', async () => {
  const adapter = buildAdapter();
  const card = adapter.generateEventCard(freshRound3Event(BEEFMINCE_NOOP_EVENT));

  assert.ok(card.includes('class="event-desc clamped"'), 'description clamped by default');
  assert.ok(card.includes('onclick="toggleDescClamp(this)"'), 'tap toggles the clamp');
  assert.ok(card.includes('banana hammocks'), 'the description text itself is on the face');
  // It is on the MAIN section, before the hidden Raw-mode payload block.
  assert.ok(card.indexOf('event-desc clamped') < card.indexOf('<div class="raw-display">'));
  // The old details description row is gone.
  assert.ok(!card.includes('event-description'), 'no old description row');

  // The page defines the toggle (plain in-page JS, no bridge).
  const html = await adapter.generateRichHTML(round3Results());
  assert.ok(html.includes('function toggleDescClamp('), 'toggle defined in the page script');
  assert.ok(html.includes('.event-desc.clamped'), 'clamp CSS present');
});

test('round3: links render as side-by-side chips with domain/handle labels, including gmaps', () => {
  const adapter = buildAdapter();
  adapter.resetMapVerifyUrls();
  const event = freshRound3Event(BEEFMINCE_NOOP_EVENT);
  event.facebook = 'https://www.facebook.com/BEEFMINCE';
  const card = adapter.generateEventCard(event);

  const row = card.match(/<div class="event-links-row">([\s\S]*?)<\/div>/);
  assert.ok(row, 'one links row on the face');
  const chips = row[1];
  assert.ok(chips.includes('🌐 beefmince.com'), 'website chip shows the registrable domain');
  assert.ok(chips.includes('🎟️ dice.fm'), 'tickets chip shows the ticketing domain');
  assert.ok(chips.includes('📸 @rvtofficial'), 'instagram chip shows the handle');
  assert.ok(chips.includes('👥 BEEFMINCE'), 'facebook chip shows the page name');
  assert.ok(chips.includes('🗺️ maps'), 'gmaps chip present (owner: "we\'re missing some links like gmaps")');

  // Every chip rides the openMapVerify bridge and resolves to its real URL.
  const ids = [...chips.matchAll(/data-map-url-id="(\d+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 5, 'five chips, five registered bridge ids');
  const urls = ids.map((id) => adapter._mapVerifyUrls[id]);
  assert.ok(urls.includes('https://beefmince.com'), 'website URL registered');
  assert.ok(urls.includes(event.ticketUrl), 'ticket URL registered');
  assert.ok(urls.includes(event.instagram), 'instagram URL registered');
  assert.ok(urls.includes(event.gmaps), 'gmaps URL registered');
  assert.ok(!chips.includes('href="https'), 'chips never navigate the WebView directly');

  // The stacked one-per-row link list is gone.
  assert.ok(!card.includes('>Website</a>'), 'no old Website row');
  assert.ok(!card.includes('>Tickets</a>'), 'no old Tickets row');
  assert.ok(!card.includes('>Instagram</a>'), 'no old Instagram row');
  assert.ok(!card.includes('>Google Maps</a>'), 'no old Google Maps row');
});

test('round3→4: the provenance section and the counts line are dissolved, not merely relocated', () => {
  const adapter = buildAdapter();
  const card = adapter.generateEventCard(freshRound3Event(BEEFMINCE_NOOP_EVENT), { runId: 'r1' });

  // Round 4 dissolved the debug expander that round 3 had moved these into:
  // no provenance section anywhere, no counts banner anywhere. The merge
  // decisions still surface — as reasons inside the merge comparison table.
  assert.ok(!card.includes('<details class="provenance-details">'), 'no provenance section');
  assert.ok(!card.includes('🔍 Provenance'));
  assert.ok(!card.includes('debug-field-counts'), 'no Scraper/Calendar/Merged counts banner');
  assert.ok(!card.includes('<strong>Scraper:</strong>'));
});

test('round3: notes preview and merge comparison share ONE container style, no divider above the comparison', () => {
  const adapter = buildAdapter();
  const card = adapter.generateEventCard(freshRound3Event(BEEFMINCE_NOOP_EVENT));

  assert.ok(card.includes('<div class="card-subsection merge-comparison-subsection">'),
    'merge comparison wrapped in the shared subsection container');
  assert.ok(card.includes('<details class="card-subsection notes-preview-subsection">'),
    'notes preview wrapped in the SAME subsection container class');
  // The stray divider line that sat above the merge comparison is gone.
  assert.ok(!card.includes('border-top: 1px solid #e0e0e0'), 'no stray divider line');
  // No double wrapping: the notes preview <details> is not nested in an
  // extra styled box of its own.
  assert.ok(!/<details style="margin-top: 10px;">/.test(card), 'old bare notes wrapper gone');
});

test('round3: the BEEFMINCE no-op merge says "no changes" and its line view collapses every no-op row', () => {
  const adapter = buildAdapter();
  const event = freshRound3Event(BEEFMINCE_NOOP_EVENT);

  // "Changed" means merged differs from calendar — this record has none.
  assert.equal(adapter.countChangedMergeFields(event), 0);
  assert.equal(adapter.hasEventDifferences(event), false);

  const card = adapter.generateEventCard(event);
  assert.ok(card.includes('no changes'), 'section chip tells the truth');
  assert.ok(!card.includes('Has changes'), 'the lying chip is gone');
  assert.ok(card.includes('MERGE ·0'), 'MERGE tag agrees with the chip');
  assert.ok(card.includes('merge-noop-summary'), 'table view keeps its collapsed summary row');

  // THE GAP HIS PASTE SHOWED: the line view must collapse no-ops too.
  const line = adapter.generateLineDiffView(event);
  assert.match(line, /\d+ fields unchanged — /, 'one summary line for the unchanged fields');
  assert.ok(!line.includes('(same in both)'), 'no per-field same-in-both rows');
  assert.ok(!line.includes('(kept existing)'), 'no kept-existing no-op rows');
  assert.ok(!line.includes('(ignored new value)'), 'no ignored-new no-op rows');
  assert.ok(!line.includes('(existing, unchanged)'), 'no existing-unchanged no-op rows');
  const summaryCount = Number(line.match(/(\d+) fields unchanged/)[1]);
  assert.ok(summaryCount >= 20, `all ${summaryCount} no-op fields are counted, not rendered`);
});

test('round3: a real change (SPOOKMINCE website added) still shows its diff in BOTH views', () => {
  const adapter = buildAdapter();
  const event = freshRound3Event(SPOOKMINCE_CHANGE_EVENT);

  assert.equal(adapter.countChangedMergeFields(event), 1, 'exactly the website addition');
  assert.equal(adapter.hasEventDifferences(event), true);

  const card = adapter.generateEventCard(event);
  assert.ok(card.includes('1 changed'), 'chip counts the real change');
  assert.ok(!card.includes('no changes'), 'a changed card never claims no changes');

  // Table view renders the changed row.
  const rows = adapter.generateComparisonRowsCompressed(event);
  assert.ok(rows.includes('website'), 'the changed field renders as a row');
  assert.ok(rows.includes('beefmince.com'), 'with its new value');
  assert.ok(rows.includes('merge-noop-summary'), 'and the untouched fields stay collapsed');

  // Line view renders the diff AND collapses the rest.
  const line = adapter.generateLineDiffView(event);
  assert.ok(line.includes('website'), 'changed field header in the line view');
  assert.ok(/\+<\/span>[^<]*beefmince\.com/.test(line.replace(/&#x2F;|&\/;/g, '/')) || line.includes('beefmince.com'),
    'the added value renders as a + line');
  assert.ok(line.includes('(new field)'), 'labelled as an addition');
  assert.match(line, /\d+ fields unchanged — /, 'no-op rows still collapse to the summary');
});

test('write-policy: a _mergeNoOp merge sits in the already-saved pile and never promises an UPDATE', () => {
  const adapter = buildAdapter();
  // The real BEEFMINCE no-op record with the shared-core write-path stamp:
  // its saved _changes is ['notes'] (ordering-only), so the stamp — not the
  // legacy _changes.length === 0 form — is what moves it.
  const event = freshRound3Event(BEEFMINCE_NOOP_EVENT);
  event._mergeNoOp = true;
  const placement = adapter.classifyEventForResultsSection(event);
  assert.equal(placement.section, 'saved', 'no-op merges are already-saved, not actionable');
  assert.equal(placement.reason, '✅ merge no-op — calendar already has all of this',
    'reuses the existing merge-no-op bucket label');
  assert.equal(adapter.getWriteActionFromEvent(event), 'skip',
    'the card never promises an UPDATE that filterEventsForExecution skips');

  // Without the stamp the same record keeps its old behavior (saved runs
  // recorded before the stamp existed): _changes ['notes'] → actionable,
  // write action update.
  const unstamped = freshRound3Event(BEEFMINCE_NOOP_EVENT);
  assert.equal(adapter.classifyEventForResultsSection(unstamped).section, 'actionable');
  assert.equal(adapter.getWriteActionFromEvent(unstamped), 'update');
});

test('round3: every existing bridge handler id and page handler survives the cleanup', async () => {
  const adapter = buildAdapter();
  // Bridge action ids round-trip through the URL parser.
  for (const action of [
    'page', 'page-done', 'copy-venue', 'mark-bear', 'mark-not-bear',
    'execute-run', 'queue-venue', 'open-url', 'export-ics', 'copy-logs',
    'ai-prompts', 'beacon'
  ]) {
    const params = adapter.parseReviewActionUrl(`chunkyscrape://act?a=${action}&n=1`);
    assert.equal(params.a, action, `${action} round-trips through the bridge URL`);
  }

  // The page still defines every handler the buttons call — plus the new
  // in-page description toggle.
  const html = await adapter.generateRichHTML(round3Results());
  for (const fn of [
    'function copyVenueEntry(', 'function markBearOverride(',
    'function requestSavedRunExecute(', 'function queueVenueCandidate(',
    'function openMapVerify(', 'function exportRecurringIcs(',
    'function requestNativeLogCopy(', 'function showAiPromptPicker(',
    'function exportProvenanceIssue(', 'function copyEventJSON(',
    'function toggleComparisonSection(', 'function toggleDiffView(',
    'function toggleDisplayMode(', 'function toggleImages(',
    'function filterEvents(', 'function toggleDescClamp(',
    'function sendResultsBeacon('
  ]) {
    assert.ok(html.includes(fn), `${fn} still defined in the page script`);
  }

  // And the card wires them.
  adapter.resetMapVerifyUrls();
  const card = adapter.generateEventCard(freshRound3Event(BEEFMINCE_NOOP_EVENT), { runId: 'r1' }, {
    bearIdx: 'k0',
    bearVerdict: 'bear',
    interactive: true
  });
  for (const handler of [
    'openMapVerify(this)', 'markBearOverride(this)', 'copyEventJSON(this)',
    'exportProvenanceIssue(this)', 'toggleComparisonSection(', 'toggleDiffView(this',
    'toggleDescClamp(this)'
  ]) {
    assert.ok(card.includes(handler), `${handler} intact on the card`);
  }
  // Builder icon sits beside the verdict pill in the face controls row.
  const controls = card.match(/<div class="event-face-controls">([\s\S]*?)<\/div>\s*<div class="event-details">/);
  assert.ok(controls, 'face controls row present');
  assert.ok(controls[1].includes('bear-verdict-row'), 'verdict pill in the controls row');
  assert.ok(controls[1].includes('event-builder-link'), 'builder icon next to the verdict pill');
});

// ---------------------------------------------------------------------------
// Round 4 — owner feedback: labelled builder link, tap-to-enlarge thumbnail,
// atomic datetime wrapping, a WORKING Images toggle, and the 🐞 Debug
// expander dissolved into the places its contents belong.
// ---------------------------------------------------------------------------

test('round4: the event-builder link carries a visible label on the same bridge', () => {
  const adapter = buildAdapter();
  const card = adapter.generateEventCard(freshRound3Event(BEEFMINCE_NOOP_EVENT), { runId: 'r1' });
  const link = card.match(/<a[^>]*class="event-builder-link"[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(link, 'builder link present');
  assert.ok(link[0].includes('openMapVerify(this)'), 'still rides the openMapVerify bridge');
  assert.ok(/🛠\s*Builder/.test(link[1]), 'visible "Builder" label, not a bare icon');
});

test('round4: tapping the thumbnail toggles it large in-page, like the description clamp', async () => {
  const adapter = buildAdapter();
  const card = adapter.generateEventCard(buildDenseFaceEvent());
  const thumb = card.match(/<div class="event-thumb[^"]*"[^>]*>/);
  assert.ok(thumb, 'thumbnail present');
  assert.ok(thumb[0].includes('onclick="toggleThumbSize(this)"'), 'tap toggles the size in-page');

  const html = await adapter.generateRichHTML(round3Results());
  assert.ok(html.includes('function toggleThumbSize('), 'page defines the toggle handler');
  assert.ok(html.includes('.event-thumb.thumb-expanded'), 'expanded-size CSS present');
  // Same pattern as toggleDescClamp: pure page JS, never the native bridge.
  const fnBody = html.match(/function toggleThumbSize\(([\s\S]*?)\n\s*\}/);
  assert.ok(fnBody && !fnBody[0].includes('chunkyscrape'), 'expand/collapse never leaves the page');
});

test('round4: start and end datetimes each wrap as one atomic unit', () => {
  const adapter = buildAdapter();
  // Multi-day: the end HALF (date + time) must be one nowrap span so a
  // narrow screen moves the whole end datetime to the next line instead of
  // splitting it after the date.
  const multi = adapter.generateEventCard(buildDenseFaceEvent({
    startDate: '2026-08-28T20:00:00.000Z',
    endDate: '2026-08-31T20:00:00.000Z'
  }));
  assert.match(
    multi,
    /<span class="dt-nowrap">[^<]*Aug 28[^<]*<\/span>\s*-\s*<span class="dt-nowrap">[^<]*Aug 31[^<]*<\/span>/,
    'start and end halves are atomic; only the separator may break'
  );

  // Same-day: the end time is its own atomic span too.
  const sameDay = adapter.generateEventCard(buildDenseFaceEvent());
  assert.match(
    sameDay,
    /<span class="dt-nowrap">[^<]*7:00 PM<\/span>\s*-\s*<span class="dt-nowrap">10:00 PM<\/span>/,
    'same-day end time still wraps as a unit'
  );

  // No fabricated separator when there is no real end.
  const noEnd = adapter.generateEventCard(buildDenseFaceEvent({ endDate: null }));
  assert.ok(noEnd.includes('(no end listed)'));
});

test('round4: the nowrap rule is actually defined in the page CSS', async () => {
  const adapter = buildAdapter();
  const html = await adapter.generateRichHTML(round3Results());
  assert.match(html, /\.dt-nowrap\s*\{[^}]*white-space:\s*nowrap/, '.dt-nowrap CSS rule present');
});

test('round4: the Images toggle targets the image class the cards actually render', async () => {
  const adapter = buildAdapter();
  const html = await adapter.generateRichHTML({
    analyzedEvents: [{
      title: 'Pic Night',
      _action: 'new',
      startDate: '2026-09-01T02:00:00.000Z',
      image: 'https://example.com/p.jpg'
    }],
    errors: [],
    parserResults: []
  });
  assert.ok(html.includes('onchange="toggleImages()"'), 'checkbox wired to the handler');
  assert.equal((html.match(/function toggleImages\(/g) || []).length, 1, 'handler defined once');

  // The regression that made the button dead: the handler queried a class no
  // card emits anymore. Whatever selector the handler uses must match at
  // least one class attribute the page actually renders.
  const fn = html.match(/function toggleImages\(\)[\s\S]*?querySelectorAll\('([^']+)'\)/);
  assert.ok(fn, 'toggleImages queries a selector');
  const classes = fn[1].split(',').map(s => s.trim().replace(/^\./, ''));
  const covered = classes.filter(cls => new RegExp(`class="[^"]*\\b${cls}\\b`).test(html));
  assert.ok(
    covered.length > 0,
    `selector "${fn[1]}" matches no rendered class attribute — the Images button is dead`
  );
});

test('round4: the debug expander is dissolved — UTC and calendar chip on the face, counts banner gone', () => {
  const adapter = buildAdapter();
  const event = freshRound3Event(BEEFMINCE_NOOP_EVENT);
  const card = adapter.generateEventCard(event, { runId: 'r1' });

  assert.ok(!card.includes('event-card-debug'), 'debug expander markup gone');
  assert.ok(!card.includes('🐞'), 'no debug summary anywhere');

  const bodyIdx = card.indexOf('<div class="event-details">');
  assert.ok(bodyIdx !== -1);
  const face = card.slice(0, bodyIdx);
  assert.ok(face.includes('event-headline-utc'), 'UTC rendered on the card face');
  assert.ok(face.includes('🌍'), 'UTC keeps its globe marker');
  assert.ok(face.includes('calendar-chip'), 'calendar target is a face chip');
  assert.ok(
    face.includes(adapter.getCalendarNameForDisplay(event)),
    'the chip names the target calendar'
  );

  // The counts banner is DELETED from display (stays in the run JSON).
  assert.ok(!card.includes('debug-field-counts'), 'counts banner markup gone');
  assert.ok(!card.includes('<strong>Scraper:</strong>'), 'no Scraper/Calendar/Merged counts line');

  // Raw JSON payload still embedded for Raw mode + the copy button.
  assert.ok(card.includes('class="raw-display"'), 'raw display block kept (Raw mode)');
  assert.ok(card.includes('<pre class="raw-json">'), 'embedded payload kept');
});

test('round4: provenance rows fold into the merge table under the shared no-op predicate', () => {
  const adapter = buildAdapter();

  // Real-run shape (run 20260813-223251, BEEFMINCE Trunk Den): the calendar
  // side never stores `city`, so the old provenance table showed
  // "city | london | scraper | took scraped value (calendar had none)" on a
  // card whose merge changed NOTHING. Folded, that row is a no-op: it joins
  // the "N fields unchanged" summary and the changed count stays 0.
  const noop = freshRound3Event(BEEFMINCE_NOOP_EVENT);
  delete noop._original.calendar.city;
  const card = adapter.generateEventCard(noop, { runId: 'r1' });
  assert.ok(!card.includes('provenance-details'), 'no separate provenance section');
  assert.ok(!card.includes('🔍 Provenance'));
  assert.ok(!card.includes('Parser: ai-web'), 'parser/action meta line dropped — the card tags carry it');
  // The folded row joins the shared record list as a no-op (the visible
  // summary line caps how many names it prints, so assert on the records).
  const records = adapter.buildComparisonRowRecords(noop);
  const cityRecord = records.find(r => r.field === 'city');
  assert.ok(cityRecord, 'city folds into the shared record list');
  assert.equal(cityRecord.changed, false, 'and it is a no-op, joining the unchanged summary');
  assert.match(card, /\d+ fields unchanged — /, 'the unchanged summary line renders');
  assert.equal(adapter.countChangedMergeFields(noop), 0, 'a routing-only field never counts as a change');
  assert.ok(card.includes('MERGE ·0'), 'tag still truthful');

  // But when the calendar DID track the field and the merge changed it, the
  // folded row is a real outcome and renders normally.
  const changed = freshRound3Event(BEEFMINCE_NOOP_EVENT);
  changed._original.calendar.city = 'berlin';
  const changedCard = adapter.generateEventCard(changed, { runId: 'r1' });
  assert.match(changedCard, /<strong>city<\/strong>/, 'real city outcome renders as a row');
  assert.ok(changedCard.includes('took scraped value'), 'with its provenance decision as the reason');
  assert.equal(adapter.countChangedMergeFields(changed), 1);
});

test('round4: export-issue and copy-JSON ride the card actions row', () => {
  const adapter = buildAdapter();
  const card = adapter.generateEventCard(freshRound3Event(BEEFMINCE_NOOP_EVENT), { runId: 'r1' });
  const bodyIdx = card.indexOf('<div class="event-details">');
  const faceControls = card.slice(0, bodyIdx);

  assert.ok(faceControls.includes('exportProvenanceIssue(this)'), 'export issue sits with the card actions');
  assert.ok(faceControls.includes('provenance-export-area'), 'its reveal area rides inside the same wrapper');
  assert.ok(faceControls.includes('copyEventJSON(this)'), 'copy JSON reachable without any expander');

  // The export payload still carries the run id and merge decisions.
  const payloadMatch = card.match(/data-payload="([^"]*)"/);
  assert.ok(payloadMatch, 'export payload embedded');
  const payload = JSON.parse(decodeURIComponent(payloadMatch[1]));
  assert.equal(payload.runId, 'r1');
});

test('round4: a links row falls back to the scraper source URL when the event lost its own', () => {
  const adapter = buildAdapter();
  const event = {
    title: 'Sourceless',
    _action: 'merge',
    startDate: '2026-09-01T02:00:00.000Z',
    _original: {
      scraper: { website: 'https://promoter.example/party' },
      calendar: {},
      merged: {}
    }
  };
  const row = adapter.buildEventLinksRowHtml(event);
  assert.ok(row.includes('promoter.example'), 'scraper source URL surfaces as a chip');

  // When the event already links its website, no duplicate source chip.
  const linked = adapter.buildEventLinksRowHtml({
    ...event,
    website: 'https://promoter.example/party'
  });
  assert.equal((linked.match(/promoter\.example/g) || []).length >= 1, true);
});

test('round4: hostile provenance data degrades to a card without the export control, never a crash', () => {
  const adapter = buildAdapter();
  const hostile = { title: 'Bad Event', _action: 'new', startDate: '2026-08-01T02:00:00.000Z' };
  Object.defineProperty(hostile, '_mergeDecisions', {
    get() { throw new Error('boom'); },
    enumerable: true
  });
  const card = adapter.generateEventCard(hostile, { runId: 'r1' });
  assert.ok(card.includes('event-card'), 'card still renders');
  assert.ok(card.includes('Bad Event'));
});

// ---------------------------------------------------------------------------
// Round 5 — owner feedback: thumbnail back to the LEFT of the title block in
// the compact state (round 4's flex-basis:auto wrapped the whole title block
// under the image), calendar notes preview ABOVE the merge comparison, and
// the trailing-arrow convention on EVERY non-button text link via one shared
// helper.
// ---------------------------------------------------------------------------

test('round5: compact card keeps the thumbnail LEFT of the title block; enlarging breaks it out below and a tap returns it', async () => {
  const adapter = buildAdapter();
  const card = adapter.generateEventCard(buildDenseFaceEvent());

  // Structural order: the thumb markup sits BEFORE the title block inside
  // the flex row, so the compact state reads image-left, text-right.
  const main = card.match(/<div class="event-headline-main">([\s\S]*?)<div class="event-headline-body">/);
  assert.ok(main, 'headline main row present');
  assert.ok(main[1].includes('class="event-thumb'), 'thumb sits before the title block in the row');

  const html = await adapter.generateRichHTML(round3Results());
  // Compact layout class: the title block shares the row with the fixed
  // 64px thumb. flex-basis MUST be 0 — round 4's `flex: 1 1 auto` sized the
  // basis from the content, so any long title/date line wrapped the whole
  // body BELOW the image (the "image on top" regression).
  const bodyRule = html.match(/\.event-headline-body\s*\{([^}]*)\}/);
  assert.ok(bodyRule, '.event-headline-body rule present');
  assert.match(bodyRule[1], /flex:\s*1\s+1\s+0/,
    'compact state: zero flex-basis keeps the title block beside the thumb');

  // Enlarged: the breakout row renders ABOVE the title block (round 6,
  // owner request — flipped from round 5's below-the-title placement).
  const expandedRule = html.match(/\.event-thumb\.thumb-expanded\s*\{([^}]*)\}/);
  assert.ok(expandedRule, 'expanded rule present');
  assert.match(expandedRule[1], /flex:\s*1\s+1\s+100%/, 'expanded thumb takes a full-width row');
  assert.match(expandedRule[1], /order:\s*-1/, 'the full-width row stays above the title block');

  // Round 4's toggle survives: the same tap returns the thumb to the slot.
  assert.ok(card.includes('onclick="toggleThumbSize(this)"'), 'tap-to-enlarge toggle intact');
  assert.ok(html.includes('function toggleThumbSize('), 'page still defines the toggle');
});

test('round5: calendar notes preview renders ABOVE the merge comparison', () => {
  const adapter = buildAdapter();
  const card = adapter.generateEventCard(freshRound3Event(BEEFMINCE_NOOP_EVENT), { runId: 'r1' });
  const notesIdx = card.indexOf('notes-preview-subsection');
  const mergeIdx = card.indexOf('merge-comparison-subsection');
  assert.ok(notesIdx !== -1, 'notes preview subsection present');
  assert.ok(mergeIdx !== -1, 'merge comparison subsection present');
  assert.ok(notesIdx < mergeIdx, 'notes preview sits above the merge comparison');
});

test('round5: every non-button text link carries the shared arrow via the one helper', async () => {
  const adapter = buildAdapter();

  // The helper IS the convention: appends the glyph once, never doubles it,
  // leaves empty labels alone.
  assert.equal(adapter.textLinkLabelHtml('The Eagle'), 'The Eagle ↗');
  assert.equal(adapter.textLinkLabelHtml('Route ↗'), 'Route ↗', 'never doubles the glyph');
  assert.equal(adapter.textLinkLabelHtml(''), '', 'empty label stays empty');

  // Sweep every rendered surface: a full results page, a fully-loaded merge
  // card, a plain dense card, the verify row and the review pin block. ZERO
  // anchors may render without the glyph; buttons must never carry it.
  adapter.resetMapVerifyUrls();
  const surfaces = [
    await adapter.generateRichHTML(round3Results()),
    adapter.generateEventCard(freshRound3Event(BEEFMINCE_NOOP_EVENT), { runId: 'r1' }),
    adapter.generateEventCard(buildDenseFaceEvent()),
    adapter.buildMapVerifyLinksHtml({
      bar: 'The Eagle', city: 'los angeles',
      address: '4444 Hollywood Blvd, Los Angeles, CA', coordinates: '34.0522,-118.2437'
    }),
    adapter.buildReviewPinHtml('51.4863, -0.1217', 'BEEFMINCE')
  ];
  for (const html of surfaces) {
    const anchors = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)];
    assert.ok(anchors.length > 0 || html === surfaces[4], 'sweep surfaces render anchors');
    const missing = anchors.filter((m) => !m[1].includes('↗'));
    assert.equal(missing.length, 0,
      `text links without the arrow: ${missing.map((m) => m[0]).slice(0, 5).join(' | ')}`);
    const buttons = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)];
    const glyphButtons = buttons.filter((m) => m[1].includes('↗'));
    assert.equal(glyphButtons.length, 0, 'buttons never carry the text-link glyph');
  }

  // The chips row and the route line specifically (the owner's examples).
  const card = adapter.generateEventCard(freshRound3Event(BEEFMINCE_NOOP_EVENT), { runId: 'r1' });
  const chip = card.match(/<a\b[^>]*event-link-chip[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(chip && chip[1].includes('↗'), 'link chips carry the arrow');
  const routeBar = card.match(/<a\b[^>]*route-bar-link[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(routeBar && routeBar[1].includes('↗'), 'route-line venue link carries the arrow');
});

test('round5: bridge handler ids, page handlers and the Images toggle survive the reshuffle', async () => {
  const adapter = buildAdapter();
  for (const action of [
    'page', 'page-done', 'copy-venue', 'mark-bear', 'mark-not-bear',
    'execute-run', 'queue-venue', 'open-url', 'export-ics', 'copy-logs',
    'ai-prompts', 'beacon'
  ]) {
    const params = adapter.parseReviewActionUrl(`chunkyscrape://act?a=${action}&n=1`);
    assert.equal(params.a, action, `${action} still round-trips through the bridge URL`);
  }
  const html = await adapter.generateRichHTML(round3Results());
  for (const fn of [
    'function copyVenueEntry(', 'function markBearOverride(',
    'function requestSavedRunExecute(', 'function queueVenueCandidate(',
    'function openMapVerify(', 'function exportRecurringIcs(',
    'function requestNativeLogCopy(', 'function showAiPromptPicker(',
    'function exportProvenanceIssue(', 'function copyEventJSON(',
    'function toggleComparisonSection(', 'function toggleDiffView(',
    'function toggleDisplayMode(', 'function toggleImages(',
    'function filterEvents(', 'function toggleDescClamp(',
    'function toggleThumbSize(', 'function sendResultsBeacon('
  ]) {
    assert.ok(html.includes(fn), `${fn} still defined in the page script`);
  }
  // Images toggle still targets a class the cards actually render.
  const fn = html.match(/function toggleImages\(\)[\s\S]*?querySelectorAll\('([^']+)'\)/);
  assert.ok(fn, 'toggleImages queries a selector');
  const classes = fn[1].split(',').map((s) => s.trim().replace(/^\./, ''));
  const covered = classes.filter((cls) => new RegExp(`class="[^"]*\\b${cls}\\b`).test(html));
  assert.ok(covered.length > 0, `selector "${fn[1]}" matches no rendered class`);
});

test('generateEventCard renders the venue-overlap chip only when the report-only flag is stamped', () => {
  const adapter = buildAdapter();
  const flagged = adapter.generateEventCard({
    title: 'SUNDAY BEER BUST',
    _action: 'new',
    startDate: '2026-09-13T21:00:00.000Z',
    bar: 'Eagle LA',
    _venueOverlap: [
      { withTitle: 'ONYX <2nd Sunday>', date: '2026-09-13', venue: 'Eagle LA', window: '14:00–20:00 (assumed end)', otherWindow: '16:00–20:00', source: 'run' }
    ]
  });
  assert.ok(flagged.includes('venue-overlap-badge'), 'overlap chip rendered');
  assert.ok(flagged.includes('⚔️ overlaps: ONYX &lt;2nd Sunday&gt;'), 'colliding title named and escaped');
  assert.ok(!flagged.includes('ONYX <2nd Sunday>'), 'no raw markup from the overlap payload');

  const plain = adapter.generateEventCard({
    title: 'SUNDAY BEER BUST',
    _action: 'new',
    startDate: '2026-09-13T21:00:00.000Z',
    bar: 'Eagle LA'
  });
  assert.ok(!plain.includes('venue-overlap-badge'), 'no chip without the stamp');
});

// ---------------------------------------------------------------------------
// Per-calendar batch ICS export: "💾 ICS (N)" on the Withheld section header
// (one iOS import = one target-calendar prompt + "Add All"), plus the UID
// ledger groundwork (results.icsExports persisted through saveRun).
// ---------------------------------------------------------------------------

function buildBatchCitiesAdapter() {
  return new ScriptableAdapter({
    cities: {
      dallas: { calendar: 'chunky-dad-dallas', timezone: 'America/Chicago' },
      seattle: { calendar: 'chunky-dad-seattle', timezone: 'America/Los_Angeles' }
    }
  });
}

function buildWithheldSeriesEvent(overrides = {}) {
  return {
    title: 'FUZZY',
    _action: 'new',
    startDate: '2026-08-08T02:00:00.000Z',
    endDate: '2026-08-08T07:00:00.000Z',
    bar: 'Dallas Eagle',
    city: 'dallas',
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR',
    _recurring: true,
    _recurringExport: true,
    ...overrides
  };
}

test('withheld header: one 💾 ICS (N) batch control per city calendar, per-event buttons intact', async () => {
  const adapter = buildBatchCitiesAdapter();
  const html = await adapter.generateRichHTML({
    analyzedEvents: [
      buildWithheldSeriesEvent(),
      buildWithheldSeriesEvent({ title: 'CUBSCOUT', recurrenceRule: 'FREQ=MONTHLY;BYDAY=1SA' }),
      { title: 'One Off', _action: 'new', startDate: '2026-08-01T02:00:00.000Z', city: 'dallas' }
    ]
  });

  assert.ok(html.includes('Withheld (Not Written)'), 'withheld section rendered');
  assert.match(html, /data-ics-batch-id="\d+"/, 'batch control carries a registered id');
  assert.ok(html.includes('💾 ICS (2)'), 'single-calendar run keeps the compact label with the batch count');
  assert.ok(html.includes('onclick="exportBatchIcs(this)"'), 'batch control rides the batch bridge handler');
  // Per-event buttons stay — the batch is an addition, not a replacement.
  assert.equal((html.match(/data-ics-export-id="\d+"/g) || []).length, 2, 'both per-event 💾 buttons still render');

  const batches = Object.values(adapter._icsBatchExports || {});
  assert.equal(batches.length, 1, 'one registered batch for the one calendar');
  assert.equal(batches[0].calendarName, 'chunky-dad-dallas');
  assert.deepEqual(batches[0].events.map((e) => e.title), ['FUZZY', 'CUBSCOUT'], 'batch = the withheld series only (no one-off)');
});

test('withheld header: a run spanning two calendars gets one labelled control per calendar', async () => {
  const adapter = buildBatchCitiesAdapter();
  const html = await adapter.generateRichHTML({
    analyzedEvents: [
      buildWithheldSeriesEvent(),
      buildWithheldSeriesEvent({ title: 'SEATTLE STEAM', city: 'seattle', recurrenceRule: 'FREQ=WEEKLY;BYDAY=SA' })
    ]
  });

  assert.ok(html.includes('💾 chunky-dad-dallas (1)'), 'dallas batch labelled with its calendar');
  assert.ok(html.includes('💾 chunky-dad-seattle (1)'), 'seattle batch labelled with its calendar');
  const batches = Object.values(adapter._icsBatchExports || {});
  assert.equal(batches.length, 2, 'one registered batch per calendar');
});

test('withheld header: no batch control without exportable series (no-start-time series excluded)', async () => {
  const adapter = buildBatchCitiesAdapter();
  const html = await adapter.generateRichHTML({
    analyzedEvents: [
      { title: 'One Off', _action: 'new', startDate: '2026-08-01T02:00:00.000Z', city: 'dallas' },
      buildWithheldSeriesEvent({ title: 'DRINK AND DRAW', _recurringNoStartTime: true })
    ]
  });
  assert.ok(!html.includes('data-ics-batch-id='), 'no batch control when nothing can build a meaningful ICS');
  assert.equal(Object.keys(adapter._icsBatchExports || {}).length, 0, 'nothing registered');
});

test('exportCalendarBatchIcs: ONE VCALENDAR with every series, X-WR-CALNAME, and the uid ledger on results', async () => {
  const adapter = buildBatchCitiesAdapter();
  adapter.resetIcsExportEvents();
  const id = adapter.registerIcsBatchExport('chunky-dad-dallas', [
    buildWithheldSeriesEvent(),
    buildWithheldSeriesEvent({ title: 'CUBSCOUT', recurrenceRule: 'FREQ=MONTHLY;BYDAY=1SA' })
  ]);

  const exported = [];
  global.DocumentPicker = {
    exportString: async (content, name) => {
      exported.push({ content, name });
      return [name];
    }
  };
  const results = {};
  try {
    await adapter.exportCalendarBatchIcs(id, results);
  } finally {
    delete global.DocumentPicker;
  }

  assert.equal(exported.length, 1, 'one file for the whole calendar');
  assert.equal(exported[0].name, 'chunky-dad-dallas-series.ics', 'file named for the target calendar');
  const unfolded = exported[0].content.replace(/\r\n[ \t]/g, '');
  assert.equal((unfolded.match(/BEGIN:VCALENDAR/g) || []).length, 1, 'single VCALENDAR wrapper');
  assert.equal((unfolded.match(/BEGIN:VEVENT/g) || []).length, 2, 'both series in the one file');
  assert.ok(unfolded.includes('X-WR-CALNAME:chunky-dad-dallas'), 'target calendar named in the file');
  assert.ok(unfolded.includes('DTSTART;TZID=America/Chicago:'), 'city timezone resolved per event');

  // UID ledger groundwork: the run JSON records what this export minted.
  assert.ok(Array.isArray(results.icsExports), 'ledger array created on results');
  assert.equal(results.icsExports.length, 2, 'one ledger entry per exported event');
  const uidsInFile = [...unfolded.matchAll(/UID:([^\r\n]+)/g)].map((m) => m[1]);
  assert.deepEqual(results.icsExports.map((e) => e.uid), uidsInFile, 'ledger uids are the uids in the file');
  for (const entry of results.icsExports) {
    assert.equal(entry.calendar, 'chunky-dad-dallas');
    assert.equal(entry.mode, 'batch');
    assert.equal(entry.via, 'DocumentPicker');
    assert.ok(entry.exportedAt.includes('T'), 'ISO exportedAt stamp');
  }
  assert.deepEqual(results.icsExports.map((e) => e.title), ['FUZZY', 'CUBSCOUT']);
});

test('exportRecurringEventIcs: the single-event export records its minted uid on the ledger too', async () => {
  const adapter = buildBatchCitiesAdapter();
  adapter.resetIcsExportEvents();
  const id = adapter.registerIcsExportEvent(buildWithheldSeriesEvent());

  const exported = [];
  global.DocumentPicker = {
    exportString: async (content, name) => {
      exported.push({ content, name });
      return [name];
    }
  };
  const results = {};
  try {
    await adapter.exportRecurringEventIcs(id, results);
  } finally {
    delete global.DocumentPicker;
  }

  assert.equal(exported.length, 1);
  assert.equal(results.icsExports.length, 1, 'single export records one ledger entry');
  const entry = results.icsExports[0];
  assert.match(entry.uid, /^fuzzy-\d{8}T\d{6}Z@chunky\.dad$/, 'ledger uid has the mint shape');
  const unfolded = exported[0].content.replace(/\r\n[ \t]/g, '');
  assert.ok(unfolded.includes(`UID:${entry.uid}`), 'ledger uid IS the uid in the exported file');
  assert.equal(entry.calendar, 'chunky-dad-dallas');
  assert.equal(entry.mode, 'single');
});

test('saveRun persists results.icsExports into the run JSON (and omits the key when empty)', async () => {
  const adapter = buildBatchCitiesAdapter();
  const writes = [];
  adapter.fm = {
    joinPath: (a, b) => `${a}/${b}`,
    fileExists: () => true,
    isDirectory: () => false,
    createDirectory: () => {},
    writeString: (filePath, content) => { writes.push({ filePath, content }); }
  };
  adapter.ensureRelativeStorageDirs = async () => {};
  adapter.runsDir = '/tmp/chunky-dad-test-runs';

  const ledger = [{
    title: 'FUZZY', startDate: '2026-08-08T02:00:00.000Z', city: 'dallas',
    calendar: 'chunky-dad-dallas', uid: 'fuzzy-20260503T203532Z@chunky.dad',
    exportedAt: '2026-05-03T20:35:32.000Z', via: 'DocumentPicker', mode: 'batch'
  }];
  await adapter.saveRun({ analyzedEvents: [], icsExports: ledger });
  assert.equal(writes.length, 1, 'run JSON written');
  const payload = JSON.parse(writes[0].content);
  assert.deepEqual(payload.icsExports, ledger, 'uid ledger lands in the run JSON');

  writes.length = 0;
  await adapter.saveRun({ analyzedEvents: [] });
  const emptyPayload = JSON.parse(writes[0].content);
  assert.ok(!('icsExports' in emptyPayload), 'no ledger key on runs that exported nothing');
});

// ---------------------------------------------------------------------------
// Curated festival dataset — refreshRemoteFestivals fetches the published
// data/festivals.json with the same helper and 1-day TTL as bars/promoters;
// the results UI labels _festivalMatch records via the existing chip/bucket
// mechanisms.
// ---------------------------------------------------------------------------

const REMOTE_FESTIVALS_URL = 'https://chunky.dad/data/festivals.json';

function buildRemoteFestivalsAdapter(remotePayload) {
  const adapter = buildAdapter();
  adapter.getPageCacheConfig = () => ({ enabled: true, ttlDays: 3 });
  adapter.cacheReads = [];
  adapter.cacheWrites = [];
  adapter.fetches = [];
  adapter.readCachedPage = async (url, config) => {
    adapter.cacheReads.push({ url, config });
    return null;
  };
  adapter.writeCachedPage = async (url, responseData, config) => {
    adapter.cacheWrites.push({ url, config });
  };
  adapter.fetchData = async (url, options) => {
    adapter.fetches.push({ url, options });
    if (remotePayload === undefined) {
      throw new Error(`HTTP 404 error from ${url}`);
    }
    return {
      html: typeof remotePayload === 'string' ? remotePayload : JSON.stringify(remotePayload),
      url,
      statusCode: 200,
      headers: {}
    };
  };
  return adapter;
}

test('refreshRemoteFestivals fetches the published dataset and unions by key (remote wins)', async () => {
  const local = [
    { key: 'beefdip-bear-week', name: 'BeefDip STALE' },
    { key: 'local-only-fest', name: 'Local Only Fest' }
  ];
  const adapter = buildRemoteFestivalsAdapter({
    festivals: [
      { key: 'beefdip-bear-week', name: 'BeefDip Bear Week', cityKey: 'pv' },
      { key: 'spooky-bear', name: 'Spooky Bear', cityKey: 'ptown' }
    ]
  });

  const result = await adapter.refreshRemoteFestivals(local);

  assert.equal(adapter.fetches.length, 1);
  assert.equal(adapter.fetches[0].url, REMOTE_FESTIVALS_URL);
  assert.deepEqual(result.festivals.map((entry) => entry.key),
    ['beefdip-bear-week', 'spooky-bear', 'local-only-fest'],
    'remote entries lead; the local-only festival survives the refresh');
  assert.equal(result.festivals[0].name, 'BeefDip Bear Week', 'remote wins for a shared key');
  assert.deepEqual(result.counts, { remote: 2, localOnly: 1 });
});

test('refreshRemoteFestivals caches with a 1-day TTL and keeps local on any failure', async () => {
  const adapter = buildRemoteFestivalsAdapter({ festivals: [{ key: 'spooky-bear', name: 'Spooky Bear' }] });
  await adapter.refreshRemoteFestivals([]);
  assert.equal(adapter.cacheReads[0].config.ttlDays, 1, 'festivals cache reads use the 1-day TTL');
  assert.equal(adapter.cacheWrites[0].config.ttlDays, 1, 'festivals cache writes use the 1-day TTL');

  const local = [{ key: 'beefdip-bear-week', name: 'BeefDip Bear Week' }];
  const failed = await buildRemoteFestivalsAdapter(undefined).refreshRemoteFestivals(local);
  assert.deepEqual(failed.festivals, local, '404/offline keeps the injected list');
  assert.deepEqual(failed.counts, { remote: 0, localOnly: 1 });

  const invalid = await buildRemoteFestivalsAdapter('not json at all').refreshRemoteFestivals(local);
  assert.deepEqual(invalid.festivals, local, 'invalid JSON keeps the injected list');

  const wrongShape = await buildRemoteFestivalsAdapter({ object: 'not festivals' }).refreshRemoteFestivals(local);
  assert.deepEqual(wrongShape.festivals, local, 'a payload without a festivals array never becomes data');
});

test('results UI: a _festivalMatch record lands in the withheld pile with the festival chip and bucket', () => {
  const adapter = buildAdapter();
  const umbrella = {
    title: 'BeefDip Bear Week',
    _action: 'new',
    _festivalMatch: {
      key: 'beefdip-bear-week',
      name: 'BeefDip Bear Week',
      reason: 'matches curated festival: BeefDip Bear Week'
    }
  };

  assert.deepEqual(adapter.classifyEventForResultsSection(umbrella), {
    section: 'withheld',
    reason: '🎪 matches curated festival: BeefDip Bear Week'
  });
  assert.equal(adapter.normalizeIntentAction(umbrella), 'festival_match',
    'the umbrella is never counted toward New');
  assert.equal(adapter.formatIntentActionLabel('festival_match'), 'FESTIVAL MATCH');
  assert.equal(adapter.getWriteActionFromEvent(umbrella), 'withheld',
    'the card never promises a CREATE the gate withholds');
});

// ---------------------------------------------------------------------------
// Saved-run browser: iCloud placeholders must never block the screen.
// Incident 2026-08-15: Mac-written 1.5MB run JSONs sit in the shared iCloud
// runs/ dir as not-yet-downloaded placeholders on the phone; enumeration used
// to await downloadFileFromiCloud on EVERY file, so one file mid-upload hung
// "display saved runs" forever right after the frozen
// "📱 Display: Checking for saved runs" log line.
// ---------------------------------------------------------------------------

function buildRunsDirFm(overrides = {}) {
  const calls = { downloads: [], reads: [] };
  const fm = {
    joinPath: (a, b) => `${a}/${b}`,
    listContents: () => ['20260814-010101.json', '20260815-020202.json', 'notes.txt', 'archive.json'],
    isDirectory: (p) => p.endsWith('/archive.json'),
    isFileDownloaded: (p) => !p.includes('20260815-020202'),
    downloadFileFromiCloud: (p) => {
      calls.downloads.push(p);
      throw new Error('BLOCKING iCloud download during enumeration');
    },
    readString: (p) => {
      calls.reads.push(p);
      throw new Error('read of possibly-undownloaded file during enumeration');
    },
    ...overrides
  };
  return { fm, calls };
}

test('list building never downloads or reads run files — undownloaded runs still appear, marked as syncing', () => {
  const { fm, calls } = buildRunsDirFm();

  const { entries, errors } = ScriptableAdapter.listSavedRunEntries(fm, '/icloud/runs');

  assert.equal(calls.downloads.length, 0, 'no downloadFileFromiCloud during enumeration');
  assert.equal(calls.reads.length, 0, 'no readString during enumeration');
  assert.equal(errors.length, 0, 'metadata-only listing has no errors');
  assert.deepEqual(entries.map(e => e.runId), ['20260815-020202', '20260814-010101'], 'json runs only (no dirs, no non-json), newest first');
  assert.equal(entries[0].downloaded, false, 'placeholder run is marked not-downloaded');
  assert.equal(entries[1].downloaded, true, 'local run is marked downloaded');
});

test('list building unwraps .<name>.json.icloud placeholder names and treats fms without isFileDownloaded as downloaded', () => {
  const { fm } = buildRunsDirFm({
    listContents: () => ['.20260816-030303.json.icloud', '20260814-010101.json'],
    isFileDownloaded: undefined,
    isDirectory: () => false
  });

  const { entries } = ScriptableAdapter.listSavedRunEntries(fm, '/icloud/runs');

  assert.deepEqual(
    entries.map(e => [e.runId, e.downloaded]),
    [['20260816-030303', false], ['20260814-010101', true]],
    'icloud wrapper name yields the logical runId, marked syncing; no isFileDownloaded → assume local'
  );
});

test('downloadFileBounded skips the download entirely for an already-local file', async () => {
  let downloads = 0;
  const fm = {
    isFileDownloaded: () => true,
    downloadFileFromiCloud: async () => { downloads += 1; }
  };

  const result = await ScriptableAdapter.downloadFileBounded(fm, '/icloud/runs/a.json', 50);

  assert.deepEqual(result, { ok: true, timedOut: false });
  assert.equal(downloads, 0, 'no iCloud call for a local file');
});

test('downloadFileBounded times out on a stalled iCloud sync instead of hanging (download stays kicked in the background)', async () => {
  let downloads = 0;
  const fm = {
    isFileDownloaded: () => false,
    downloadFileFromiCloud: () => {
      downloads += 1;
      return new Promise(() => {}); // never settles — file mid-upload from the Mac
    }
  };

  const result = await ScriptableAdapter.downloadFileBounded(fm, '/icloud/runs/a.json', 25);

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(downloads, 1, 'the download was kicked once and left running in the background');
});

test('downloadFileBounded resolves ok when the download completes within the bound, and surfaces rejections as errors', async () => {
  const okFm = {
    isFileDownloaded: () => false,
    downloadFileFromiCloud: async () => {}
  };
  assert.deepEqual(
    await ScriptableAdapter.downloadFileBounded(okFm, '/icloud/runs/a.json', 1000),
    { ok: true, timedOut: false }
  );

  const failFm = {
    isFileDownloaded: () => false,
    downloadFileFromiCloud: async () => { throw new Error('icloud says no'); }
  };
  const failed = await ScriptableAdapter.downloadFileBounded(failFm, '/icloud/runs/a.json', 1000);
  assert.equal(failed.ok, false);
  assert.equal(failed.timedOut, false);
  assert.equal(failed.error, 'icloud says no');
});

test('loadRunLogsForDisplay returns icloud-sync-pending (bounded) for an undownloaded log instead of hanging, and the section renders a syncing message', async () => {
  const adapter = buildAdapter();
  adapter.savedFileDownloadTimeoutMs = 25;
  adapter.fm = {
    joinPath: (a, b) => `${a}/${b}`,
    fileExists: () => true,
    isFileDownloaded: () => false,
    downloadFileFromiCloud: () => new Promise(() => {}), // stalled sync
    readString: () => { throw new Error('must not read an undownloaded log'); }
  };
  adapter.logsDir = '/icloud/logs';

  const logInfo = await adapter.loadRunLogsForDisplay({ savedRunId: '20260815-020202', _isDisplayingSavedRun: true });

  assert.equal(logInfo.exists, false);
  assert.equal(logInfo.reason, 'icloud-sync-pending');
  assert.equal(logInfo.runId, '20260815-020202');

  const html = adapter.buildRunLogSectionHtml(logInfo);
  assert.ok(html.includes('still syncing from iCloud'), 'run-logs section explains the pending sync');
});

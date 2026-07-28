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

test('generateBearDroppedSection renders drops with reason and button only when drops exist', () => {
  const adapter = buildAdapter();

  assert.equal(adapter.generateBearDroppedSection({}), '', 'no section without drops');
  assert.equal(adapter.generateBearDroppedSection({ bearDroppedEvents: [] }), '', 'no section for an empty list');

  const html = adapter.generateBearDroppedSection({ bearDroppedEvents: [buildBearDroppedFixture()] });
  assert.ok(html.includes('Dropped as non-bear'), 'section title present');
  assert.ok(html.includes('Twink Bash'), 'title shown');
  assert.ok(html.includes('Neon Room'), 'venue shown');
  assert.ok(html.includes('ai: drag show, no bear context'), 'AI reason shown');
  assert.ok(html.includes('from promoter.example'), 'source host shown');
  assert.ok(html.includes('data-bear-idx="0"'), 'row index carried on the button');
  assert.ok(html.includes('data-bear-act="mark-bear"'), 'mark-bear action wired');
  assert.ok(html.includes('markBearOverride(this)'), 'button signals via the bridge');

  // A rescued row shows its badge instead of a button
  const rescuedHtml = adapter.generateBearDroppedSection({
    bearDroppedEvents: [{ ...buildBearDroppedFixture(), rescued: true }]
  });
  assert.ok(rescuedHtml.includes('Rescued (manual override on calendar record)'));
  assert.ok(!rescuedHtml.includes('data-bear-act="mark-bear"'), 'no button on rescued rows');

  // Saved-run display lists the drops but offers no buttons
  const savedHtml = adapter.generateBearDroppedSection({
    _isDisplayingSavedRun: true,
    bearDroppedEvents: [buildBearDroppedFixture()]
  });
  assert.ok(savedHtml.includes('Twink Bash'));
  assert.ok(!savedHtml.includes('data-bear-act="mark-bear"'));
});

test('generateBearKeptOverrideSection lists kept events with mark-not-bear buttons on live runs only', () => {
  const adapter = buildAdapter();
  const results = buildResultsStub();

  const html = adapter.generateBearKeptOverrideSection(results);
  assert.ok(html.includes('mark mistakes not-bear'), 'section title present');
  assert.ok(html.includes('data-bear-idx="0"'));
  assert.ok(html.includes('data-bear-idx="1"'));
  assert.ok(html.includes('data-bear-act="mark-not-bear"'));

  assert.equal(
    adapter.generateBearKeptOverrideSection({ ...results, _isDisplayingSavedRun: true }),
    '',
    'saved-run display has no post-dismissal execution, so no buttons'
  );
  assert.equal(adapter.generateBearKeptOverrideSection({ analyzedEvents: [] }), '');
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

  const withoutDrops = await adapter.generateRichHTML(buildResultsStub());
  assert.ok(!withoutDrops.includes('Dropped as non-bear'), 'no dropped section without drops');
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

    // Taps: rescue the dropped event, bury a kept one. Navigation cancelled.
    assert.equal(wv.tap('chunkyscrape://act?a=mark-bear&id=0&n=1'), false);
    assert.equal(wv.tap('chunkyscrape://act?a=mark-not-bear&id=0&n=2'), false);
    await new Promise((r) => setImmediate(r));
    assert.ok(
      wv.evals.some((js) => js.includes('markBearOverrideDone("0", "mark-bear")')),
      'in-page "Marked" feedback pushed (best-effort)'
    );

    // Out-of-range ids are ignored without crashing.
    assert.equal(wv.tap('chunkyscrape://act?a=mark-bear&id=99&n=3'), false);

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

test('event cards carry the compact verify row only when venue-ish data exists', () => {
  const adapter = buildMapsAdapter();
  const html = adapter.generateEventCard({
    title: 'Bear Night',
    startDate: '2026-08-01T02:00:00.000Z',
    city: 'seattle',
    bar: 'Massive',
    address: '1400 12th Ave',
    location: '47.6135, -122.3163',
    _action: 'new'
  });
  assert.ok(html.includes('map-verify-row'), 'compact row on the card');
  assert.ok(html.includes('Bar ↗') && html.includes('Address ↗') && html.includes('Pin ↗'));

  const bare = adapter.generateEventCard({
    title: 'No venue data',
    startDate: '2026-08-01T02:00:00.000Z',
    _action: 'new'
  });
  assert.ok(!bare.includes('map-verify-row'), 'no row without bar/address/location');
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
  assert.ok(html.includes('data-event-json'), 'copy buttons still carry event JSON');
  assert.ok(html.includes('&quot;_original&quot;'), 'the raw <pre> dump still shows _original provenance');
}
);

// ---------------------------------------------------------------------------
// Active config section: effective run settings + per-parser override diffs
// rendered from results.config (SharedCore.buildActiveConfigSummary), with a
// native copy-config bridge for the redacted JSON payload.
// ---------------------------------------------------------------------------

function buildActiveConfigResultsFixture() {
  return {
    config: {
      config: {
        daysToLookAhead: 30,
        dryRun: true,
        pageCache: { enabled: true, ttlDays: 3 },
        geocodeVerification: { mode: 'enforce' },
        ai: {
          provider: 'openai',
          endpoint: 'http://rybook.example:8000/v1/chat/completions',
          model: 'global-model',
          bearCheck: { mode: 'enforce' }
        },
        ocr: { enabled: true, endpoint: 'http://rybook.example:8001/v1/chat/completions', model: 'vision-model', maxImages: 2 }
      },
      parsers: [
        {
          name: 'Megawoof <b>America</b>',
          enabled: true,
          parser: 'ai-web',
          urls: ['https://www.eventbrite.com/o/megawoof-america'],
          alwaysBear: true,
          ai: { model: 'parser-model' }
        },
        { name: 'Furball', enabled: false, urls: ['https://furball.nyc'] }
      ]
    }
  };
}

test('generateActiveConfigSection renders run settings, override diffs, and the copy button only when config exists', () => {
  const adapter = buildAdapter();

  assert.equal(adapter.generateActiveConfigSection({}), '', 'no section without results.config');
  assert.equal(adapter.generateActiveConfigSection(null), '', 'no section for null results');
  assert.equal(adapter.generateActiveConfigSection({ config: null }), '', 'no section for a null config snapshot');

  const html = adapter.generateActiveConfigSection(buildActiveConfigResultsFixture());
  assert.ok(html.includes('Active config'), 'section title present');
  assert.ok(html.includes('<span class="section-count">2</span>'), 'count is the parser count');

  // Run settings live in a collapsed <details> with flattened global rows
  assert.ok(html.includes('<summary>Run settings</summary>'), 'run-settings details present');
  assert.ok(!html.includes('<details open'), 'details collapsed by default');
  assert.ok(html.includes('ai.model'), 'flattened global keys rendered');
  assert.ok(html.includes('global-model'), 'global values rendered');
  assert.ok(html.includes('geocodeVerification.mode'), 'run-level knobs rendered');

  // Per-parser rows: escaped name, enabled badge, urls, override diffs
  assert.ok(html.includes('Megawoof &lt;b&gt;America&lt;/b&gt;'), 'parser names are escaped');
  assert.ok(!html.includes('<b>America</b>'), 'raw markup never reaches the page');
  assert.ok(html.includes('>enabled</span>'), 'enabled badge rendered');
  assert.ok(html.includes('>disabled</span>'), 'disabled badge rendered');
  assert.ok(html.includes('https://www.eventbrite.com/o/megawoof-america'), 'parser urls surfaced');
  assert.ok(html.includes('Overrides (2)'), 'override count rendered');
  assert.ok(html.includes('ai.model: parser-model (global: global-model)'), 'diff rendered value (global: value)');
  assert.ok(html.includes('alwaysBear: true (global: unset)'), 'explicit knob with no global value says unset');
  assert.ok(html.includes('no overrides'), 'parser without explicit knobs says no overrides');

  // Copy button signals native (Pasteboard) — never navigator.clipboard
  assert.ok(html.includes('copyActiveConfig(this)'), 'copy button wired to the custom-scheme signal');
  assert.ok(html.includes('📋 Copy effective config JSON'), 'copy button label present');
});

test('generateRichHTML embeds the active-config section and the copy-config handler once', async () => {
  const adapter = buildAdapter();
  const results = { ...buildResultsStub(), ...buildActiveConfigResultsFixture() };
  const html = await adapter.generateRichHTML(results);

  assert.ok(html.includes('Active config'), 'section present when config exists');
  assert.equal((html.match(/a=copy-config/g) || []).length, 1, 'copy-config bridge navigation defined exactly once');
  assert.equal((html.match(/function copyActiveConfig\(/g) || []).length, 1, 'page handler defined exactly once');
  assert.equal((html.match(/function markConfigCopied\(/g) || []).length, 1, 'feedback handler defined exactly once');

  const withoutConfig = await adapter.generateRichHTML(buildResultsStub());
  assert.ok(!withoutConfig.includes('Active config'), 'no section without a config snapshot');
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
    { name: 'Alpha', enabled: true }, // last write 7d ago (fresh-ish)
    { name: 'Beta', enabled: false }, // last write 17d ago (stale)
    { name: 'Nope' } // never written, enabled defaults on
  ];

  const entries = adapter.buildParserPickerEntries(parsers, records, now);

  assert.deepEqual(
    entries.map((e) => e.name),
    ['Nope', 'Beta', 'Alpha'],
    'never-written ranks before stale ranks before fresh'
  );
  assert.equal(entries[0].daysSince, null);
  assert.equal(entries[0].enabled, true, 'enabled !== false defaults to selected-eligible');
  assert.equal(entries[1].enabled, false);
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

  assert.ok(html.includes('🛠 Event Builder'), 'builder link rendered on a plain card');
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

test('event card: recurring events get the badge, the builder link, and the ICS export button', () => {
  const adapter = buildAdapter();
  adapter.resetMapVerifyUrls();
  adapter.resetIcsExportEvents();
  const html = adapter.generateEventCard(buildRecurringCardEvent());

  assert.ok(html.includes('🔁 recurring — save via ICS'), 'recurring badge present');
  assert.ok(html.includes('🛠 Event Builder'), 'builder link present');
  assert.ok(html.includes('💾 Save recurring (.ics)'), 'ICS export button present');
  assert.match(html, /data-ics-export-id="\d+"/, 'export button carries a registered id');

  const registeredUrls = Object.values(adapter._mapVerifyUrls);
  const builderUrl = registeredUrls.find((url) =>
    url.startsWith('https://chunky.dad/testing/event-builder.html?'),
  );
  assert.ok(builderUrl.includes('recurrence=FREQ%3DWEEKLY%3BBYDAY%3DFR'), 'rrule prefills the builder');
  assert.ok(!builderUrl.includes('new URL'), 'sanity');
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
  const branchMatch = source.match(/params\.a === "export-ics"[\s\S]{0,500}?exportRecurringEventIcs\(params\.id\)/);
  assert.ok(branchMatch, 'export-ics action branch wired to exportRecurringEventIcs');
  assert.ok(source.includes("'chunkyscrape://act?a=export-ics&id='"), 'page JS builds the export-ics bridge URL');
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

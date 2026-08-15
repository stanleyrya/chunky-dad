const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Tests for the Mac/tailnet results server's pure helpers
// (tools/serve-results.js — Node-only, never ships to the phone).
//
// The bridge-rewrite tests exercise the REAL Scriptable adapter render, so
// the same headless stub harness as scripts/adapters/scriptable-adapter.test.js
// is installed before requiring it. The stubs live only in this test process;
// the server itself installs them the same way (render side only — pipeline
// runs happen in a child process with clean globals).
// ---------------------------------------------------------------------------
global.importModule = (name) => require(path.join(__dirname, name));
global.Calendar = { forEvents: async () => [] };
global.Device = { isUsingDarkAppearance: () => false };

const fileManagerStub = {
  documentsDirectory: () => '/tmp/chunky-dad-serve-results-test',
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

const { ScriptableAdapter } = require('./adapters/scriptable-adapter');
const { EventSchema } = require('./event-schema');

const {
  parseRequestUrl,
  createRunLock,
  listParserNames,
  rewriteBridgeHtml,
  injectHeaderBar,
  formatCalendarSnapshotLabel,
  buildEventIcs,
  buildBatchIcs,
  tailLines,
  renderRunFormPage,
  parsePortFromArgv,
  lookupIcsEvent,
  BRIDGE_SHIM_MARKER,
  HEADER_BAR_MARKER
} = require('../tools/serve-results');

// ---------------------------------------------------------------------------
// parseRequestUrl (house-style: no `new URL`/URLSearchParams)
// ---------------------------------------------------------------------------

test('parseRequestUrl splits path and decodes query params', () => {
  assert.deepEqual(parseRequestUrl('/run'), { pathname: '/run', query: {} });

  const parsed = parseRequestUrl('/run?parser=Megawoof%20America&x=a+b&flag');
  assert.equal(parsed.pathname, '/run');
  assert.equal(parsed.query.parser, 'Megawoof America');
  assert.equal(parsed.query.x, 'a b');
  assert.equal(parsed.query.flag, '');
});

test('parseRequestUrl survives malformed percent-encoding', () => {
  const parsed = parseRequestUrl('/x?bad=%E0%A4%A');
  assert.equal(parsed.pathname, '/x');
  assert.ok('bad' in parsed.query);
});

// ---------------------------------------------------------------------------
// Single-flight run lock (409 semantics)
// ---------------------------------------------------------------------------

test('run lock is single-flight: second acquire fails until release', () => {
  const lock = createRunLock();
  assert.equal(lock.isActive(), false);

  const first = lock.tryAcquire({ parser: 'A' });
  assert.ok(first, 'first acquire succeeds');
  assert.equal(lock.isActive(), true);
  assert.equal(lock.current().parser, 'A');

  assert.equal(lock.tryAcquire({ parser: 'B' }), null, 'second acquire is refused');
  assert.equal(lock.current().parser, 'A', 'active run is unchanged');

  assert.equal(lock.release(), true);
  assert.equal(lock.isActive(), false);
  assert.ok(lock.tryAcquire({ parser: 'B' }), 'acquire works again after release');
  assert.equal(lock.release(), true);
  assert.equal(lock.release(), false, 'releasing an idle lock reports no-op');
});

// ---------------------------------------------------------------------------
// Parser-name extraction from config
// ---------------------------------------------------------------------------

test('listParserNames extracts named parsers with enabled flags', () => {
  const names = listParserNames({
    parsers: [
      { name: 'One', enabled: true },
      { name: 'Two', enabled: false },
      { name: 'Three' }, // enabled defaults true
      { enabled: true }, // nameless → skipped
      { name: '   ' } // blank → skipped
    ]
  });
  assert.deepEqual(names, [
    { name: 'One', enabled: true },
    { name: 'Two', enabled: false },
    { name: 'Three', enabled: true }
  ]);
  assert.deepEqual(listParserNames(null), []);
});

test('listParserNames reads the real scraper-input config', () => {
  const entries = listParserNames(require('./scraper-input'));
  assert.ok(entries.length > 5, 'real config lists parsers');
  assert.ok(entries.every((entry) => typeof entry.name === 'string' && entry.name.trim()));
  assert.ok(entries.some((entry) => entry.name === 'Bearracuda Events'), 'known parser present');
});

test('the repo scraper-input parsers carry no static enabled flags (picker owns run selection)', () => {
  const { parsers } = require('./scraper-input');
  assert.ok(Array.isArray(parsers) && parsers.length > 5, 'real config lists parsers');

  const withEnabled = parsers.filter((parser) => parser && 'enabled' in parser);
  assert.deepEqual(
    withEnabled.map((parser) => parser.name),
    [],
    'no parser entry declares enabled — manual selection is the picker\'s job'
  );

  // automationEnabled is a different knob (scheduled runs have no picker) and
  // must survive: these festival/aggregator entries opt out of automation.
  const automationOptOuts = parsers
    .filter((parser) => parser && parser.automationEnabled === false)
    .map((parser) => parser.name)
    .sort();
  assert.deepEqual(
    automationOptOuts,
    ['Bears Sitges Week', 'Spooky Bear', 'The Bear Calendar'],
    'automationEnabled: false preserved where it was'
  );
});

// ---------------------------------------------------------------------------
// Bridge rewrite — real adapter fragments
// ---------------------------------------------------------------------------

function buildRecurringEvent() {
  return {
    title: 'Bear Happy Hour',
    _action: 'new',
    city: 'nola',
    bar: 'Oak Barrel Saloon',
    address: '800 Bourbon St, New Orleans, LA',
    location: '29.9611, -90.0645',
    startDate: '2026-09-04T21:00:00.000Z',
    endDate: '2026-09-05T02:00:00.000Z',
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR'
  };
}

function buildServerResultsStub() {
  return {
    analyzedEvents: [
      buildRecurringEvent(),
      { title: 'One-Off Party', _action: 'new', startDate: '2026-08-01T02:00:00.000Z', city: 'nola' }
    ],
    discoveredVenueCalendars: [
      {
        host: 'www.massive.club',
        origin: 'https://www.massive.club',
        suggestedName: 'massive.club',
        parentTitle: 'BEARRACUDA: LA',
        droppedCount: 9,
        sampleTitles: ['Butt Blast (Jul 23)'],
        parserEntrySnippet: '{ name: "massive.club", enabled: false, urls: ["https://www.massive.club"] },'
      }
    ],
    config: {
      config: { dryRun: true },
      parsers: [{ name: 'Fixture', parser: 'ai-web', enabled: true, urls: ['https://fixture.example/'] }]
    }
  };
}

function buildAdapter() {
  return new ScriptableAdapter({ cities: { nola: { timezone: 'America/Chicago', patterns: ['new orleans'] } } });
}

test('rewriteBridgeHtml turns real map-verify bridge anchors into plain target=_blank links', () => {
  const adapter = buildAdapter();
  adapter.resetMapVerifyUrls();
  const fragment = adapter.buildMapVerifyLinksHtml({
    bar: 'Oak Barrel Saloon',
    city: 'nola',
    address: '800 Bourbon St, New Orleans, LA',
    coordinates: '29.9611, -90.0645'
  });
  assert.ok(fragment.includes('openMapVerify(this)'), 'real fragment uses the bridge');

  const html = `<html><body>${fragment}</body></html>`;
  const rewritten = rewriteBridgeHtml(html, { mapVerifyUrls: adapter._mapVerifyUrls });

  assert.ok(!rewritten.includes('onclick="return openMapVerify(this)"'), 'bridge onclick removed');
  assert.ok(rewritten.includes('target="_blank"'), 'anchors open a new tab');
  assert.ok(rewritten.includes('rel="noopener noreferrer"'));
  assert.ok(/href="https:\/\/[^"]+"/.test(rewritten), 'real https URL restored into href');
  assert.ok(!rewritten.includes('href="#"'), 'no dead placeholder hrefs remain');
});

test('rewriteBridgeHtml on a full generateRichHTML render removes every chunkyscrape:// and installs the shim', async () => {
  const adapter = buildAdapter();
  const results = buildServerResultsStub();
  const html = await adapter.generateRichHTML(results);
  assert.ok(html.includes('chunkyscrape://'), 'precondition: raw render uses the bridge');
  assert.ok(html.includes('data-ics-export-id='), 'precondition: recurring card has an export button');

  const registries = {
    mapVerifyUrls: adapter._mapVerifyUrls || {},
    venueSnippets: adapter.collectVenueEntrySnippets(results)
  };
  const rewritten = rewriteBridgeHtml(html, registries);

  // The v1 bridge-shim contract, end to end:
  assert.ok(!rewritten.includes('chunkyscrape://'), 'no chunkyscrape:// left anywhere');
  assert.ok(rewritten.includes(BRIDGE_SHIM_MARKER), 'shim marker present');
  // copy → clipboard with non-secure-context fallback
  assert.ok(rewritten.includes('navigator.clipboard'), 'clipboard API used when secure');
  assert.ok(rewritten.includes("execCommand('copy')"), 'textarea fallback for plain-HTTP tailnet');
  assert.ok(rewritten.includes('massive.club'), 'venue snippet payload embedded for browser copy');
  // export-ics → served /ics/<id> route
  assert.ok(rewritten.includes("'/ics/' + encodeURIComponent(id)"), 'export button navigates to /ics/<id>');
  // open-url → plain anchors (event-builder links ride the same registry)
  assert.ok(rewritten.includes('target="_blank"'), 'bridge links became plain anchors');
  // mark-bear / queue-venue → phone-only
  assert.ok(rewritten.includes('phone-only in v1'), 'phone-only buttons labeled');
  assert.ok(rewritten.includes('.bear-override-btn, .venue-queue-btn'), 'phone-only buttons disabled by selector');

  // Idempotent: rewriting a rewritten page is a no-op.
  assert.equal(rewriteBridgeHtml(rewritten, registries), rewritten);
});

test('rewriteBridgeHtml escapes payloads that could break out of the inline script', () => {
  const rewritten = rewriteBridgeHtml('<html><body></body></html>', {
    venueSnippets: { 0: 'evil </script><script>alert(1)</script>' }
  });
  assert.ok(!rewritten.includes('</script><script>alert(1)'), 'payload cannot terminate the shim script');
  assert.ok(rewritten.includes('\\u003c/script'), 'angle brackets JSON-escaped');
});

// ---------------------------------------------------------------------------
// Header bar injection
// ---------------------------------------------------------------------------

test('injectHeaderBar inserts once after <body> and is idempotent', () => {
  const html = '<html><head></head><body class="x"><p>results</p></body></html>';
  const injected = injectHeaderBar(html, { savedAt: '2026-07-28T00:00:00Z', parserFilter: 'Fixture' });

  assert.ok(injected.includes(HEADER_BAR_MARKER));
  assert.ok(injected.indexOf(HEADER_BAR_MARKER) > injected.indexOf('<body class="x">'), 'bar sits inside body');
  assert.ok(injected.includes('2026-07-28T00:00:00Z'));
  assert.ok(injected.includes('parser: Fixture'));
  assert.ok(injected.includes('href="/run-form"'), 'run button links to the form');
  assert.ok(/ICS links/.test(injected), 'ICS staleness note present');

  const twice = injectHeaderBar(injected, { savedAt: 'other' });
  assert.equal(twice, injected, 'second injection is a no-op');
  assert.equal((twice.match(new RegExp(HEADER_BAR_MARKER, 'g')) || []).length, 1);
});

test('header bar surfaces published-calendar snapshot ages per consulted city (v2)', () => {
  const nowMs = Date.parse('2026-07-28T12:00:00Z');
  const label = formatCalendarSnapshotLabel({
    seattle: { status: 'ok', fetchedAt: '2026-07-28T11:26:00Z' },   // 34m old
    nyc: { status: 'ok', fetchedAt: '2026-07-28T10:00:00Z' },       // 2h old
    la: { status: 'unavailable', fetchedAt: null }
  }, nowMs);
  assert.equal(label, 'calendar snapshot: la unavailable · nyc 2.0h old · seattle 34m old');

  assert.equal(formatCalendarSnapshotLabel(null), '', 'pre-v2 runs render no snapshot segment');
  assert.equal(formatCalendarSnapshotLabel({}), '');

  const html = '<html><head></head><body><p>results</p></body></html>';
  const injected = injectHeaderBar(html, {
    savedAt: '2026-07-28T00:00:00Z',
    calendarSnapshots: { seattle: { status: 'ok', fetchedAt: new Date(Date.now() - 34 * 60 * 1000).toISOString() } }
  });
  assert.ok(injected.includes('calendar snapshot: seattle 34m old'), 'snapshot segment rides in the header bar');

  const withoutSnapshots = injectHeaderBar(html, { savedAt: '2026-07-28T00:00:00Z' });
  assert.ok(!withoutSnapshots.includes('calendar snapshot:'), 'no segment without snapshot data');
});

// ---------------------------------------------------------------------------
// ICS building (shared builder from event-schema — untouched by the server)
// ---------------------------------------------------------------------------

const CITIES = { nola: { timezone: 'America/Chicago' } };

test('buildEventIcs exports a one-off event without any RRULE', () => {
  const built = buildEventIcs(
    { title: 'One-Off Party', city: 'nola', startDate: '2026-08-01T02:00:00.000Z' },
    CITIES,
    EventSchema
  );
  assert.ok(built, 'builder returns a payload');
  assert.ok(built.icsText.startsWith('BEGIN:VCALENDAR'));
  assert.ok(built.icsText.includes('BEGIN:VEVENT'));
  assert.ok(!built.icsText.includes('RRULE'), 'no recurrence → no RRULE line');
  assert.ok(built.icsText.includes('DTSTART;TZID=America/Chicago'), 'city timezone applied');
  assert.equal(built.fileName, 'one-off-party.ics');
});

test('buildEventIcs keeps the RRULE for recurring events and falls back to UTC for unknown cities', () => {
  const built = buildEventIcs(buildRecurringEvent(), {}, EventSchema);
  assert.ok(built.icsText.includes('RRULE:FREQ=WEEKLY;BYDAY=FR'));
  // Unknown city → UTC (mirrors the adapter's getTimezoneForCityOrUtc fallback)
  assert.ok(/DTSTART;TZID=UTC:\d{8}T\d{6}/.test(built.icsText), 'UTC fallback timestamps');
});

test('buildEventIcs returns null for junk input', () => {
  assert.equal(buildEventIcs(null, CITIES, EventSchema), null);
  assert.equal(buildEventIcs({ title: 'x' }, CITIES, null), null);
});

test('buildBatchIcs exports a whole calendar batch as one VCALENDAR named for the calendar', () => {
  const built = buildBatchIcs(
    {
      calendarName: 'chunky-dad-nola',
      events: [
        { title: 'FUZZY', city: 'nola', startDate: '2026-08-08T02:00:00.000Z', recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR' },
        { title: 'CUBSCOUT', city: 'nola', startDate: '2026-08-09T02:00:00.000Z', recurrenceRule: 'FREQ=MONTHLY;BYDAY=1SA' }
      ]
    },
    CITIES,
    EventSchema
  );
  assert.ok(built, 'builder returns a payload');
  assert.equal((built.icsText.match(/BEGIN:VCALENDAR/g) || []).length, 1, 'single VCALENDAR wrapper');
  assert.equal((built.icsText.match(/BEGIN:VEVENT/g) || []).length, 2, 'both series in one file');
  assert.ok(built.icsText.includes('X-WR-CALNAME:chunky-dad-nola'), 'target calendar named');
  assert.ok(built.icsText.includes('DTSTART;TZID=America/Chicago'), 'per-event city timezone applied');
  assert.equal(built.fileName, 'chunky-dad-nola-series.ics');
});

test('buildBatchIcs returns null for junk input', () => {
  assert.equal(buildBatchIcs(null, CITIES, EventSchema), null);
  assert.equal(buildBatchIcs({ calendarName: 'x', events: [] }, CITIES, EventSchema), null);
  assert.equal(buildBatchIcs({ calendarName: 'x', events: [{ title: 'y' }] }, CITIES, null), null);
});

// ---------------------------------------------------------------------------
// ICS route lookup: per-render registry first, analyzedEvents fallback
// ---------------------------------------------------------------------------

test('lookupIcsEvent prefers the render registry and falls back to analyzedEvents by index', () => {
  const registryEvent = buildRecurringEvent();
  const state = {
    icsRegistry: { 0: registryEvent },
    lastRenderResults: { analyzedEvents: [{ title: 'Fallback A' }, { title: 'Fallback B' }] }
  };
  assert.equal(lookupIcsEvent(state, '0'), registryEvent, 'registry id wins');
  assert.equal(lookupIcsEvent(state, '1').title, 'Fallback B', 'numeric fallback to analyzedEvents');
  assert.equal(lookupIcsEvent(state, '99'), null);
  assert.equal(lookupIcsEvent(state, 'nope'), null);
});

// ---------------------------------------------------------------------------
// Small pages + argv parsing
// ---------------------------------------------------------------------------

test('renderRunFormPage lists parsers escaped and posts to /run', () => {
  const html = renderRunFormPage(
    [{ name: 'A & B <Bears>', enabled: true }, { name: 'Off', enabled: false }],
    { hasRun: false }
  );
  assert.ok(html.includes('method="POST"'));
  assert.ok(html.includes('action="/run"'));
  assert.ok(html.includes('A &amp; B &lt;Bears&gt;'), 'names HTML-escaped');
  assert.ok(html.includes('>All parsers<'), 'everything option says All parsers');
  assert.ok(
    !html.includes('disabled in config') && !html.includes('All enabled parsers'),
    'no enabled-in-config annotations — parser entries carry no enabled flags'
  );
  assert.ok(html.includes('report-only'), 'dry-run promise stated');
});

test('parsePortFromArgv reads both flag styles and defaults to 8734', () => {
  assert.equal(parsePortFromArgv([]), 8734);
  assert.equal(parsePortFromArgv(['--port', '9001']), 9001);
  assert.equal(parsePortFromArgv(['--port=9002']), 9002);
  assert.equal(parsePortFromArgv(['--port', 'bogus']), 8734);
});

test('tailLines keeps only the last N lines', () => {
  const text = Array.from({ length: 600 }, (_, i) => `line ${i}`).join('\n');
  const tail = tailLines(text, 500);
  assert.equal(tail.split('\n').length, 500);
  assert.ok(tail.startsWith('line 100'));
  assert.ok(tail.endsWith('line 599'));
});

// ---------------------------------------------------------------------------
// tools/run-once.js exported helpers (safe to require: execution and the
// WebAdapter prototype patch only happen when run-once is the main module).
// ---------------------------------------------------------------------------
const runOnce = require(path.join(__dirname, '..', 'tools', 'run-once.js'));

test('run-once: shapeRunOnceConfig stamps automation runtime and always re-forces dryRun last', () => {
  const config = {
    parsers: [
      { name: 'AutoOff', automationEnabled: false },
      { name: 'AutoOn' }
    ],
    config: {}
  };
  const shaped = runOnce.shapeRunOnceConfig(config, {
    CHUNKY_RUN_AUTOMATION: '1',
    CHUNKY_RUN_OVERRIDES: JSON.stringify({ config: { dryRun: false } })
  });
  assert.equal(shaped.runtime.automationRun, true,
    'automation env marks the run so SharedCore applies the automationEnabled parser filter');
  assert.equal(shaped.config.dryRun, true,
    'dryRun is forced AFTER the override merge — the phone stays the only calendar writer');

  const manual = runOnce.shapeRunOnceConfig({ parsers: [], config: {} }, {});
  assert.equal(manual.runtime, undefined, 'no automation stamp without the env');
  assert.equal(manual.config.dryRun, true, 'dryRun forced on manual runs too');
});

test('run-once: parser filter still selects exactly the named parser and throws on unknown names', () => {
  const shaped = runOnce.shapeRunOnceConfig({
    parsers: [{ name: 'A', enabled: false }, { name: 'B', enabled: true }],
    config: {}
  }, { CHUNKY_RUN_PARSER: 'A' });
  assert.deepEqual(shaped.parsers.map((p) => p.enabled), [true, false]);

  assert.throws(() => runOnce.shapeRunOnceConfig({ parsers: [{ name: 'A' }], config: {} },
    { CHUNKY_RUN_PARSER: 'Nope' }), /no parser named "Nope"/);
});

test('run-once: shared-storage preflight aborts loudly on unreachable/malformed roots and passes valid ones', () => {
  const fs = require('node:fs');
  const os = require('node:os');

  assert.equal(runOnce.assertSharedStorageRootUsable({}, fs), null, 'env unset → feature off, no check');

  assert.throws(
    () => runOnce.assertSharedStorageRootUsable({ CHUNKY_SHARED_STORAGE_DIR: path.join(os.tmpdir(), `gone-${Date.now()}`) }, fs),
    /unreachable/i,
    'missing root aborts before the pipeline starts'
  );

  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'runonce-bare-'));
  try {
    assert.throws(
      () => runOnce.assertSharedStorageRootUsable({ CHUNKY_SHARED_STORAGE_DIR: bare }, fs),
      /storage\/ subtree/i,
      'a root without storage/ is the wrong directory — abort, never mkdir'
    );
    fs.mkdirSync(path.join(bare, 'storage'));
    assert.equal(runOnce.assertSharedStorageRootUsable({ CHUNKY_SHARED_STORAGE_DIR: bare }, fs), bare);
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('run-once: isAutomationEnv accepts the documented truthy spellings only', () => {
  assert.equal(runOnce.isAutomationEnv({ CHUNKY_RUN_AUTOMATION: '1' }), true);
  assert.equal(runOnce.isAutomationEnv({ CHUNKY_RUN_AUTOMATION: 'true' }), true);
  assert.equal(runOnce.isAutomationEnv({ CHUNKY_RUN_AUTOMATION: 'yes' }), true);
  assert.equal(runOnce.isAutomationEnv({ CHUNKY_RUN_AUTOMATION: '0' }), false);
  assert.equal(runOnce.isAutomationEnv({}), false);
});

// ---------------------------------------------------------------------------
// Dataless-stub defenses (2026-08 incident: the first scheduled run hung 22+
// minutes with libuv threads kernel-wedged in open()/rename() against evicted
// iCloud files). Defense #1 is the startup materialization sweep: download
// everything BEFORE parser work, poll the dataless count to 0, abort loudly
// at the ceiling — a run that would wedge or miss the shared cache must not
// limp (no-partial-runs).
// ---------------------------------------------------------------------------
test('run-once: materialization sweep waits for the dataless count to reach 0, then proceeds', async () => {
  const logs = [];
  const log = (line) => logs.push(String(line));
  let fakeNow = 0;
  const counts = [2, 1, 0]; // initial probe, then one per poll
  const kicked = [];

  const result = await runOnce.materializeSharedStorageTree('/shared/root', {
    platform: 'darwin',
    countDataless: () => counts.shift(),
    kickDownload: (root) => { kicked.push(root); return true; },
    ceilingMs: 90000,
    pollIntervalMs: 30000,
    sleep: async (ms) => { fakeNow += ms; },
    now: () => fakeNow,
    log
  });

  assert.deepEqual(result, { datalessAtStart: 2, waitedMs: 60000 });
  assert.deepEqual(kicked, ['/shared/root'], 'brctl download is kicked once, on the whole root');
  assert.ok(logs.some((line) => line.includes('materialization progress')), 'each poll logs progress');
  assert.ok(logs.some((line) => line.includes('fully materialized')), 'the all-clear is loud');

  // Already-clean tree: no download kick, no waiting.
  const clean = await runOnce.materializeSharedStorageTree('/shared/root', {
    platform: 'darwin',
    countDataless: () => 0,
    kickDownload: () => { throw new Error('must not kick a clean tree'); },
    log: () => {}
  });
  assert.deepEqual(clean, { datalessAtStart: 0, waitedMs: 0 });
});

test('run-once: materialization sweep ABORTS LOUDLY at the ceiling (no-partial-runs) and recommends Keep Downloaded', async () => {
  let fakeNow = 0;
  await assert.rejects(
    runOnce.materializeSharedStorageTree('/shared/root', {
      platform: 'darwin',
      countDataless: () => 2, // never drains — fileproviderd wedged / offline
      kickDownload: () => true,
      ceilingMs: 90000,
      pollIntervalMs: 30000,
      sleep: async (ms) => { fakeNow += ms; },
      now: () => fakeNow,
      log: () => {}
    }),
    /ABORTING[\s\S]*Keep Downloaded/,
    'a tree that will not materialize must abort the run, not limp into wedged syscalls'
  );

  // A probe that breaks mid-sweep is also an abort — never guess "clean".
  let firstProbe = true;
  await assert.rejects(
    runOnce.materializeSharedStorageTree('/shared/root', {
      platform: 'darwin',
      countDataless: () => { if (firstProbe) { firstProbe = false; return 3; } return null; },
      kickDownload: () => true,
      ceilingMs: 90000,
      pollIntervalMs: 30000,
      sleep: async () => {},
      now: () => 0,
      log: () => {}
    }),
    /probe[\s\S]*ABORTING/i
  );
});

test('run-once: materialization sweep skips honestly when it cannot run (non-macOS, no find probe, no brctl)', async () => {
  const log = () => {};
  assert.deepEqual(
    await runOnce.materializeSharedStorageTree('/x', { platform: 'linux', log }),
    { skipped: 'non-macos' }
  );
  assert.deepEqual(
    await runOnce.materializeSharedStorageTree('/x', { platform: 'darwin', countDataless: () => null, log }),
    { skipped: 'probe-unavailable' }
  );
  assert.deepEqual(
    await runOnce.materializeSharedStorageTree('/x', { platform: 'darwin', countDataless: () => 3, kickDownload: () => false, log }),
    { skipped: 'brctl-unavailable' }
  );
  assert.deepEqual(await runOnce.materializeSharedStorageTree('', {}), { skipped: 'no-shared-root' });
});

// Defense #1 SCOPE (2026-08-13 incident): the blocking sweep must cover only
// the storage/ cache tree a run READS. A real run rode the ceiling toward an
// abort over five phone LOG files whose bytes had not yet uploaded FROM the
// phone — undrainable from the Mac side, and irrelevant to the run (logs/
// and runs/ are write-only here, new filenames, atomic writes). Files
// outside storage/ are an advisory line, never a blocker.
test('run-once: sweep blocks only on storage/ and reports outside-storage dataless files as advisory', async () => {
  const logs = [];
  const log = (line) => logs.push(String(line));
  const probedRoots = [];
  // storage/ tree is clean; 5 phone logs are dataless in the wider root.
  const countDataless = (root) => {
    probedRoots.push(root);
    return root.endsWith('/storage') ? 0 : 5;
  };
  const result = await runOnce.sweepSharedStorageBeforeRun('/shared/root', {
    platform: 'darwin',
    countDataless,
    kickDownload: () => { throw new Error('must not kick a download for a clean blocking tree'); },
    log
  });
  assert.equal(result.datalessAtStart, 0, 'blocking sweep saw a clean storage tree');
  assert.equal(probedRoots[0], '/shared/root/storage', 'the BLOCKING probe is scoped to storage/');
  assert.ok(probedRoots.includes('/shared/root'), 'the advisory probe covers the whole root');
  assert.ok(
    logs.some((line) => line.includes('5 dataless file(s) remain OUTSIDE the storage/ cache tree')),
    'outside-storage dataless files are reported as advisory, not blocked on'
  );
  // And the run did NOT abort: five undrainable phone-log stubs must never
  // ride the ceiling (the exact 2026-08-13 failure).
});

// Defense #3b: JS-side timeouts cannot cancel wedged syscalls — each one
// leaks a libuv threadpool slot, and the default pool is only 4 slots. Both
// the run-once entry and the launchd plist give the pool headroom.
// Stall detection (2026-08-15 05:15 incident): 108 phone-written cache
// entries sat dataless because their bytes were pending UPLOAD from the
// phone — undrainable from the Mac — and the sweep rode the 15-min ceiling
// into a pointless abort. A count that stops falling now proceeds with the
// bounded-fs-ops defense; a still-falling count keeps waiting.
test('run-once: materialization sweep proceeds after the dataless count stalls (pending phone uploads)', async () => {
  const logs = [];
  const log = (line) => logs.push(String(line));
  let fakeNow = 0;
  const result = await runOnce.materializeSharedStorageTree('/shared/root', {
    platform: 'darwin',
    countDataless: () => 108, // never drains
    kickDownload: () => true,
    ceilingMs: 900 * 1000,
    pollIntervalMs: 1,
    sleep: () => { fakeNow += 30 * 1000; },
    now: () => fakeNow,
    log
  });
  assert.equal(result.undrainable, 108, 'stall reported, not thrown');
  assert.ok(
    logs.some((line) => line.includes('have not drained across') && line.includes('pending UPLOAD')),
    'the stall warning names the pending-upload cause'
  );

  // A still-falling count never trips the stall path — it drains normally.
  const counts = [10, 8, 6, 4, 2, 0];
  const drained = await runOnce.materializeSharedStorageTree('/shared/root', {
    platform: 'darwin',
    countDataless: () => counts.shift(),
    kickDownload: () => true,
    ceilingMs: 900 * 1000,
    pollIntervalMs: 1,
    sleep: () => {},
    now: () => 0,
    log
  });
  assert.equal(drained.datalessAtStart, 10);
  assert.equal(drained.undrainable, undefined, 'a draining sweep completes fully');
});

// Auto-update (owner: "make sure the Mac script is always using up to date
// code"): the launchd command pulls origin/main before invoking run-once,
// and a failed pull falls through to running the current checkout.
test('run-once: launchd plist template pulls origin/main before the run', () => {
  const fs = require('node:fs');
  const template = fs.readFileSync(
    require('node:path').join(__dirname, '..', 'tools', 'launchd', 'com.chunky-dad.scraper-daily.plist.template'),
    'utf8'
  );
  assert.match(template, /git pull --ff-only --quiet origin main/, 'auto-pull present');
  assert.match(template, /git pull failed — running with the current checkout/, 'pull failure falls through to the run');
});

test('run-once: UV_THREADPOOL_SIZE headroom is defaulted at the entry point and pinned in the launchd plist template', () => {
  const fs = require('node:fs');

  const env = {};
  assert.equal(runOnce.ensureThreadpoolHeadroom(env), '16');
  assert.equal(env.UV_THREADPOOL_SIZE, '16');
  assert.equal(
    runOnce.ensureThreadpoolHeadroom({ UV_THREADPOOL_SIZE: '32' }),
    '32',
    'an explicit caller value is respected'
  );
  assert.ok(String(process.env.UV_THREADPOOL_SIZE || '').trim() !== '',
    'requiring run-once ensured the headroom for this process (entry-point call, pre-set values respected)');

  const template = fs.readFileSync(
    path.join(__dirname, '..', 'tools', 'launchd', 'com.chunky-dad.scraper-daily.plist.template'),
    'utf8'
  );
  assert.match(
    template,
    /<key>UV_THREADPOOL_SIZE<\/key>\s*<string>16<\/string>/,
    'scheduled runs get the headroom even if the entry-point default ever moves'
  );
});

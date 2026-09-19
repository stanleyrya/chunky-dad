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

  // automationEnabled is a different knob (scheduled runs have no picker).
  // Owner 2026-09-19: "Turn on all automation!" — no entry opts out; the
  // template entry is skipped by kind, never by flag.
  const automationOptOuts = parsers
    .filter((parser) => parser && parser.automationEnabled === false)
    .map((parser) => parser.name)
    .sort();
  assert.deepEqual(automationOptOuts, [], 'every parser joins the daily run');
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
    parsers: [{ name: 'A', enabled: false, automationEnabled: false }, { name: 'B', enabled: true }],
    config: {}
  }, { CHUNKY_RUN_PARSER: 'A', CHUNKY_RUN_AUTOMATION: '1' });
  // The list is narrowed, not flagged: automation runs ignore `enabled`, so a
  // flagged list ran all 23 parsers under CHUNKY_RUN_PARSER=Furball. And an
  // explicit pick runs even when scheduled automation would skip it.
  assert.deepEqual(shaped.parsers.map((p) => p.name), ['A']);
  assert.equal(shaped.parsers[0].enabled, true);
  assert.equal('automationEnabled' in shaped.parsers[0], false);

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

// ---------------------------------------------------------------------------
// Review deck (v2): renderers, the Scriptable hand-off link, and the routes
// (exercised through handleRequest with a temp shared dir — the first
// HTTP-level coverage this server has).
// ---------------------------------------------------------------------------
const fs = require('node:fs');
const os = require('node:os');
const {
  resolveReviewScriptName,
  buildScriptableExecuteLink,
  formatReviewDateLine,
  formatReviewUtcLine,
  describeReviewTimeDelta,
  renderReviewCard,
  renderReviewPage,
  createServerState,
  handleRequest
} = require('../tools/serve-results');
const reviewQueue = require('../tools/review-queue');

const REVIEW_TEST_CITIES = { nyc: { timezone: 'America/New_York', patterns: ['new york', 'nyc'], calendar: 'chunky-dad-nyc', coordinates: { lat: 40.7128, lng: -74.006 } } };
function buildReviewCtx() {
  return {
    adapter: new ScriptableAdapter({ cities: REVIEW_TEST_CITIES }),
    core: reviewQueue.createDeckCore({ config: { cities: REVIEW_TEST_CITIES } }, {})
  };
}

test('formatReviewDateLine: the event\'s zone with its label, no fabricated end, a named end day, and honesty about a missing zone', () => {
  assert.equal(formatReviewDateLine('2030-10-04T02:00:00.000Z', '2030-10-04T05:00:00.000Z', 'America/New_York'), 'Thu, Oct 3, 2030 · 10:00 PM – Fri, Oct 4 1:00 AM EDT');
  assert.equal(formatReviewDateLine('2030-10-04T02:00:00.000Z', '2030-10-04T03:30:00.000Z', 'America/New_York'), 'Thu, Oct 3, 2030 · 10:00 PM – 11:30 PM EDT');
  assert.equal(formatReviewDateLine('2030-10-04T02:00:00.000Z', null, 'America/New_York'), 'Thu, Oct 3, 2030 · 10:00 PM EDT (no end listed)');
  assert.equal(formatReviewDateLine('2030-10-04T02:00:00.000Z', '2030-10-04T02:00:00.000Z', 'America/New_York'), 'Thu, Oct 3, 2030 · 10:00 PM EDT (no end listed)', 'end == start is not an end');
  assert.equal(formatReviewDateLine('2030-10-04T02:00:00.000Z', null, 'Not/AZone'), 'Fri, Oct 4, 2030 · 2:00 AM UTC (no end listed)', 'unknown zone falls back to UTC');
  assert.equal(formatReviewDateLine('2030-10-04T02:00:00.000Z', null, null), 'Fri, Oct 4, 2030 · 2:00 AM UTC (no end listed) — no timezone on the event');
  assert.equal(formatReviewDateLine('garbage', null, 'UTC'), '');
  assert.equal(formatReviewUtcLine('2030-10-04T02:00:00.000Z', '2030-10-04T05:00:00.000Z'), '🌍 Fri, Oct 4 2:00 AM – 5:00 AM UTC');
  assert.equal(describeReviewTimeDelta('2030-10-04T02:00:00.000Z', '2030-10-04T04:00:00.000Z'), '2 h later');
  assert.equal(describeReviewTimeDelta('2030-10-04T02:00:00.000Z', '2030-10-04T01:30:00.000Z'), '30 min earlier');
  assert.equal(describeReviewTimeDelta('2030-10-04T02:00:00.000Z', '2030-10-07T02:00:00.000Z'), '3 days later');
});

test('the Scriptable hand-off link names the phone script and the run, and the name is overridable', () => {
  assert.equal(buildScriptableExecuteLink('20260913-051750', 'display-saved-run'),
    'scriptable:///run?scriptName=display-saved-run&runId=20260913-051750&reviewExecute=1');
  assert.equal(buildScriptableExecuteLink('20260913-051750', 'Display Saved Run'),
    'scriptable:///run?scriptName=Display%20Saved%20Run&runId=20260913-051750&reviewExecute=1');
  assert.equal(buildScriptableExecuteLink(''), '');
  assert.equal(resolveReviewScriptName({}), 'display-saved-run');
  assert.equal(resolveReviewScriptName({ CHUNKY_REVIEW_SCRIPT_NAME: ' My Script ' }), 'My Script');
});

test('renderReviewCard (new event): whole flyer with a lightbox, zoned date + UTC check, tappable route line, domain-labelled chips', () => {
  const ctx = buildReviewCtx();
  const html = renderReviewCard({ kind: 'new', key: 'k', proposal: {
    title: 'Bear <b>Night</b>', startDate: '2030-10-04T02:00:00.000Z', endDate: '2030-10-04T06:00:00.000Z', timezone: 'America/New_York',
    bar: 'Rockbar', address: '185 Christopher St, New York, NY', city: 'nyc', location: '40.7331, -74.0055', source: 'ai-web',
    url: 'https://www.furball.nyc/events/x', ticketUrl: 'https://tickets.example/x', image: 'https://furball.nyc/flyer.jpg', cover: '$20',
    description: 'Bears "welcome"', changes: {}
  }, display: {
    parserName: 'Furball', pageHost: 'furball.nyc', analysisReason: 'No existing events found', bearSource: 'keyword', bearReview: '',
    evidenceLines: ['pin is 0 m from curated "Rockbar" pin'], notes: 'bar: Rockbar\nwebsite: https://www.furball.nyc/events/x',
    image: 'https://furball.nyc/flyer-portrait.jpg', imageOrientation: 'portrait', imageDimensions: { width: 800, height: 1000 }, imageRepeatCount: 1,
    instagram: '@furballnyc', gmaps: 'https://www.google.com/maps/search/?api=1&query=x'
  } }, ctx);
  assert.ok(html.includes('✨ New event') && html.includes('No existing events found'));
  assert.ok(html.includes('Bear &lt;b&gt;Night&lt;/b&gt;'), 'title escaped');
  assert.ok(html.includes('📅 Thu, Oct 3, 2030 · 10:00 PM – Fri, Oct 4 2:00 AM EDT'));
  assert.ok(html.includes('🌍 Fri, Oct 4 2:00 AM – 6:00 AM UTC'), 'UTC verification line');
  assert.ok(html.includes('href="https://www.google.com/maps/search/?api=1&amp;query=Rockbar%2C%20new%20york"') && html.includes('>Rockbar</a>'), 'bar links to maps');
  assert.ok(html.includes('>185 Christopher St</a>'), 'street-only address label');
  assert.ok(html.includes('>📌 40.7331, -74.0055</a>') && html.includes('>🧭 Route</a>'));
  assert.ok(html.includes('Furball · from furball.nyc · 📱 chunky-dad-nyc'), 'parser name, page host and target calendar');
  assert.ok(html.includes('>Rockbar</a> <span class="curated" title="curated bar">✓</span>') === false, 'no curated tick without a curated barSource');
  assert.ok(html.includes('>🔗 furball.nyc/events/x</a>') && html.includes('>🎟 tickets.example/x</a>') && html.includes('>📸 @furballnyc</a>') && html.includes('>🗺 maps</a>'), 'links keep their path; only handles and the maps link get short labels');
  assert.ok(html.includes('💵 $20'));
  assert.ok(html.includes('class="thumb portrait"') && !html.includes('onclick=') && html.includes('src="https://furball.nyc/flyer-portrait.jpg"') && html.includes('aspect-ratio:800/1000'), 'portrait asset, whole, no inline handlers (the page wires taps)');
  assert.ok(!html.includes('class="evidence"') && !html.includes('provenance:'), 'no evidence blurb on the face');
  assert.ok(html.includes('class="bear-row"') && html.includes('🐻 bear — keyword'), 'the bear check is visible on the card');
  assert.ok(!html.includes('<button'), 'no buttons on a card — swipes and the reject sheet are the only controls');
  assert.ok(html.includes('📝 Calendar notes (2)') && html.includes('<th>bar</th><td>Rockbar</td>'), 'notes parsed into rows');
  assert.ok(html.includes('Bears &quot;welcome&quot;'));
  assert.ok(!html.includes('class="chgs"'), 'a new event has no change block');
});

test('renderReviewCard (update): stacked calendar-has → would-become rows in the field\'s own language', () => {
  const ctx = buildReviewCtx();
  const html = renderReviewCard({ kind: 'merge', key: 'k', proposal: {
    title: 'BEEFMINCE x RVT', existingTitle: 'BEEFMINCE Brief Encounter', startDate: '2030-10-05T03:00:00.000Z', timezone: 'America/New_York', city: 'nyc',
    changes: {
      title: { from: 'BEEFMINCE Brief Encounter', to: 'BEEFMINCE x RVT' },
      startDate: { from: '2030-10-05T01:00:00.000Z', to: '2030-10-05T03:00:00.000Z' },
      location: { from: '40.7331, -74.0055', to: '40.7350, -74.0055' },
      url: { from: '', to: 'https://www.beefmince.co.uk/tickets' }
    }
  }, display: { parserName: 'The Bear Calendar', notesOnlyAlso: true } }, ctx);
  assert.ok(html.includes('🔀 Update saved event'));
  assert.ok(!html.includes('calendar title:'), 'the title row already shows the calendar title');
  assert.ok(html.includes('<span>calendar has</span><span>would become</span>'));
  assert.ok(html.includes('data-field="title"') && html.includes('<span class="was">BEEFMINCE Brief Encounter</span>') && html.includes('<span class="now">BEEFMINCE x RVT</span>'));
  assert.ok(html.includes('<span class="chg-k">Starts</span>') && html.includes('<span class="was">Fri, Oct 4 · 9:00 PM</span>') && html.includes('<span class="now">11:00 PM</span>') && html.includes('2 h later'), 'day printed once, time diffed, delta named');
  assert.ok(html.includes('<span class="chg-k">Pin</span>') && html.includes('>📌 40.7331, -74.0055</a>') && html.includes('>📌 40.7350, -74.0055</a>'));
  assert.match(html, /⚠️ moved 21\d m · <a[^>]*maps\/dir\/\?api=1&amp;origin=40\.7331%2C-74\.0055&amp;destination=40\.735%2C-74\.0055[^>]*>🧭 old → new<\/a>/, 'a pin move shows the distance and a route between old and new');
  assert.ok(html.includes('<span class="chg-k">Event page</span>') && html.includes('<span class="none">∅</span>') && html.includes('>beefmince.co.uk/tickets</a>'), 'a link change shows the whole stored URL, not its domain');
  const samePath = renderReviewCard({ kind: 'merge', key: 'k', proposal: { title: 'X', timezone: 'UTC', changes: { url: { from: 'https://bearracuda.com', to: 'https://bearracuda.com/events/denver17/' } } } }, ctx);
  assert.ok(samePath.includes('>bearracuda.com</a>') && samePath.includes('>bearracuda.com/events/denver17/</a>'), 'Bearracuda Denver: the gained path is visible, trailing slash and all');
  assert.ok(!html.includes('+ notes'), 'no notes blurb');

  const added = renderReviewCard({ kind: 'merge', key: 'k', proposal: { title: 'X', timezone: 'UTC', changes: { location: { from: '', to: '40.7331, -74.0055' }, endDate: { from: '2030-10-05T03:00:00.000Z', to: '' } } } }, ctx);
  assert.ok(added.includes('pin added'));
  assert.ok(added.includes('<span class="none">(no end listed)</span>'), 'an end being dropped says so');
});

test('renderReviewCard (override): the series night it replaces, and the changes against it', () => {
  const ctx = buildReviewCtx();
  const html = renderReviewCard({ kind: 'override', key: 'k', proposal: {
    kind: 'override', title: 'Bears Night Out', existingTitle: 'Bears Night Out', startDate: '2030-10-04T01:00:00.000Z', endDate: '2030-10-04T05:00:00.000Z',
    timezone: 'America/New_York', bar: 'Rockbar', city: 'nyc', overrideOf: '2030-10-04T02:00:00.000Z',
    changes: { startDate: { from: '2030-10-04T02:00:00.000Z', to: '2030-10-04T01:00:00.000Z' }, url: { from: '', to: 'https://rockbarnyc.com/events/bears-night-out' } }
  }, display: {} }, ctx);
  assert.ok(html.includes('🗓️ Override — this night only'));
  assert.ok(html.includes('replaces the series night of Thu, Oct 3 (Bears Night Out)'));
  assert.ok(html.includes('<span>series night has</span><span>this night becomes</span>'));
  assert.ok(html.includes('<span class="chg-k">Starts</span>') && html.includes('<span class="was">Thu, Oct 3 · 10:00 PM</span>') && html.includes('<span class="now">9:00 PM</span>') && html.includes('1 h earlier'));
  assert.ok(html.includes('>rockbarnyc.com/events/bears-night-out</a>'));
});

test('renderReviewCard (bar): route line, distance from the city center, labelled links, a map, and the events it was seen in', () => {
  const ctx = buildReviewCtx();
  const html = renderReviewCard({ kind: 'bar', key: 'bar|nyc|thewoods', proposal: {
    name: 'The Woods', city: 'nyc', address: '48 S 4th St, Brooklyn', coordinates: '40.71, -73.96', signals: ['page-adjacent'],
    website: 'https://thewoods.example/', instagram: '', sourceEvents: [{ title: 'BEAR NIGHT', date: '2030-02-02T02:00:00.000Z' }],
    evidence: ['pin is 4.1 km from nyc center']
  } }, ctx);
  assert.ok(html.includes('🏳️‍🌈 New bar') && html.includes('<h2>The Woods</h2>'));
  assert.ok(html.includes('>The Woods</a>') && html.includes('>48 S 4th St</a>') && html.includes('href="https://www.google.com/maps/search/?api=1&amp;query=40.71%2C-73.96"'));
  assert.match(html, /\d(\.\d)? km from new york center · seen as page-adjacent/);
  assert.ok(html.includes('>🔗 thewoods.example/</a>') && !html.includes('📸'), 'blank links render no chip');
  assert.ok(html.includes('openstreetmap.org/export/embed.html'), 'inline map');
  assert.ok(html.includes('<li>BEAR NIGHT <span class="muted">— Sat, Feb 2</span></li>'));
  assert.ok(html.includes('<li>pin is 4.1 km from nyc center</li>'));
});

test('renderReviewCard: the brand site leads the links, a curated bar gets its tick, a stored verdict shows as the active button', () => {
  const ctx = buildReviewCtx();
  const html = renderReviewCard({ kind: 'new', key: 'k', proposal: {
    title: 'GOLDILOXX SINGLET NITE', startDate: '2030-10-04T02:00:00.000Z', timezone: 'America/New_York', bar: 'Red Eye', city: 'nyc',
    url: 'https://redeyeny.com/', ticketUrl: 'https://redeyetickets.com/events/goldiloxx-singlet-nite', changes: {}
  }, display: { favicon: 'https://linktr.ee/goldiloxx', barSource: 'curated', bearSource: 'ai', bearVerdict: 'bear', bearVerdictStampedAt: '2030-01-02T00:00:00.000Z' } }, ctx);
  const brandAt = html.indexOf('>🏷 linktr.ee/goldiloxx</a>');
  const pageAt = html.indexOf('>🔗 redeyeny.com/</a>');
  assert.ok(brandAt !== -1 && pageAt !== -1 && brandAt < pageAt, 'the favicon (brand) site leads, the venue page follows');
  assert.ok(html.includes('>Red Eye</a> <span class="curated" title="curated bar">✓</span>'), 'curated bar tick');
  assert.ok(html.includes('🐻 bear — ai') && html.includes('you said: 🐻 bear (2030-01-02)'), 'run verdict and the stored verdict both visible');
  const same = renderReviewCard({ kind: 'new', key: 'k', proposal: { title: 'X', timezone: 'UTC', url: 'https://bearracuda.com/', changes: {} }, display: { favicon: 'https://www.bearracuda.com/' } }, ctx);
  assert.ok(!same.includes('🏷'), 'no brand chip when it is the same site as the event page');
});

test('renderReviewCard (dropped): the drop reason is the bear row, and the card asks the one question', () => {
  const ctx = buildReviewCtx();
  const html = renderReviewCard({ kind: 'dropped', key: 'dropped|x', proposal: {
    kind: 'dropped', title: 'Dolly Parton Tribute', startDate: '2030-10-04T02:00:00.000Z', timezone: 'America/New_York', bar: '3 Dollar Bill', city: 'nyc',
    dropReason: 'ai: The title and description contain no bear-specific language.', occurrences: 3, changes: {}
  }, display: {} }, ctx);
  assert.ok(html.includes('🚫 Dropped as not bear') && html.includes('3 occurrences'));
  assert.ok(html.includes('🚫 dropped as not bear — AI: The title and description contain no bear-specific language.'));
  assert.ok(!html.includes('<button'), 'the swipe is the verdict — no buttons');
});

test('renderReviewCard degrades without a context or display (a decided entry re-rendered from its snapshot)', () => {
  const html = renderReviewCard({ kind: 'new', key: 'k', proposal: { title: 'Solo', startDate: '2030-10-04T02:00:00.000Z', timezone: 'UTC', bar: 'Rockbar', city: 'nyc', url: 'https://furball.nyc/' } });
  assert.ok(html.includes('<h2>Solo</h2>') && html.includes('📍 Rockbar') && html.includes('>🔗 furball.nyc/</a>'));
});

test('injectHeaderBar links the review deck with its pending count', () => {
  assert.ok(injectHeaderBar('<html><body></body></html>', { reviewPending: 3 }).includes('🃏 Review (3)'));
  const none = injectHeaderBar('<html><body></body></html>', { reviewPending: 0 });
  assert.ok(none.includes('🃏 Review</a>'));
});

// --- routes -----------------------------------------------------------------

function fakeRequest(method, url, body) {
  const handlers = {};
  return {
    method,
    url,
    headers: {},
    on(event, callback) {
      handlers[event] = callback;
      if (event === 'end') {
        setImmediate(() => {
          if (body && handlers.data) handlers.data(body);
          handlers.end();
        });
      }
      return this;
    },
    destroy() {}
  };
}

function fakeResponse() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(chunk) { this.body = String(chunk == null ? '' : chunk); }
  };
}

async function request(state, method, url, body) {
  const res = fakeResponse();
  await handleRequest(state, fakeRequest(method, url, body), res);
  return res;
}

function reviewRunFixture(runId) {
  const start = '2030-10-04T02:00:00.000Z';
  return {
    version: 2,
    summary: { runId, timestamp: '2030-01-01T05:15:00.000Z', totals: { totalEvents: 1, bearEvents: 1 } },
    runContext: { environment: 'node', type: 'automated' },
    config: { cities: { nyc: { timezone: 'America/New_York', patterns: ['nyc'] } }, config: { dryRun: true }, parsers: [] },
    analyzedEvents: [{
      title: 'FURBALL NYC', bar: 'Rockbar', address: '185 Christopher St', city: 'nyc', timezone: 'America/New_York',
      startDate: start, endDate: '2030-10-04T06:00:00.000Z', url: 'https://furball.nyc/',
      _parserConfig: { name: 'Furball', dryRun: false }, _action: 'new'
    }],
    bearDroppedEvents: [], parserResults: [], errors: [], calendarHygiene: []
  };
}

test('review routes: deck → decide → decided → undo, over a temp shared dir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-review-server-'));
  fs.mkdirSync(path.join(dir, 'runs'));
  fs.writeFileSync(path.join(dir, 'runs', '20300101-051500.json'), JSON.stringify(reviewRunFixture('20300101-051500')));
  const previousEnv = process.env.CHUNKY_SHARED_STORAGE_DIR;
  process.env.CHUNKY_SHARED_STORAGE_DIR = dir;
  const state = createServerState();
  try {
    const page = await request(state, 'GET', '/review');
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('FURBALL NYC'), 'the card is on the page');
    assert.ok(page.body.includes('scriptable:///run?scriptName=display-saved-run&runId=20300101-051500&reviewExecute=1'), 'hand-off link for THIS run');
    assert.ok(page.body.includes('window.__reviewDeck = {'), 'deck payload inlined');
    assert.ok(page.body.includes('"wrong venue"'), 'reject chips shipped');

    const deck = JSON.parse((await request(state, 'GET', '/review/deck.json')).body);
    assert.equal(deck.ok, true);
    assert.equal(deck.counts.pending, 1);
    const card = deck.cards[0];
    assert.equal(card.key, 'event|furball|rockbar|2030-10-03');

    const bad = await request(state, 'POST', '/review/decide', '{nope');
    assert.equal(bad.status, 400);
    const noVerdict = await request(state, 'POST', '/review/decide', JSON.stringify({ key: card.key, verdict: 'maybe' }));
    assert.equal(noVerdict.status, 400);

    const decided = await request(state, 'POST', '/review/decide', JSON.stringify({
      key: card.key, kind: card.kind, verdict: 'reject', runId: deck.runId, snapshot: card.proposal,
      reason: { tags: ['wrong venue'], text: 'it moved to the Eagle' }
    }));
    assert.equal(decided.status, 200, decided.body);
    assert.equal(JSON.parse(decided.body).decisions, 1);
    const stored = JSON.parse(fs.readFileSync(reviewQueue.getDecisionsPath(dir), 'utf8'));
    assert.equal(stored.decisions[0].key, card.key);
    assert.equal(stored.decisions[0].reason.text, 'it moved to the Eagle');

    const after = JSON.parse((await request(state, 'GET', '/review/deck.json')).body);
    assert.equal(after.counts.pending, 0, 'decided cards leave the deck');
    assert.equal(after.decided[0].decision.verdict, 'reject');
    const rejections = await request(state, 'GET', '/review/rejections');
    assert.ok(rejections.body.includes('NEW FURBALL NYC — 2030-10-04 @ Rockbar [Furball] {wrong venue} — it moved to the Eagle'));
    const decisionsJson = JSON.parse((await request(state, 'GET', '/review/decisions.json')).body);
    assert.equal(decisionsJson.decisions.length, 1);

    const cleared = await request(state, 'POST', '/review/decide', JSON.stringify({ key: card.key, verdict: 'clear' }));
    assert.equal(JSON.parse(cleared.body).removed, true);
    assert.equal(JSON.parse((await request(state, 'GET', '/review/deck.json')).body).counts.pending, 1, 'undo puts the card back');

    // 🐻 from the deck writes the phone's verdict store with the tap's shape.
    const bear = await request(state, 'POST', '/review/bear', JSON.stringify({ verdict: 'not_bear', event: { title: 'FURBALL NYC', bar: 'Rockbar', address: '185 Christopher St', location: '', city: 'nyc' } }));
    assert.equal(bear.status, 200, bear.body);
    const verdicts = JSON.parse(fs.readFileSync(reviewQueue.getBearVerdictsPath(dir), 'utf8'));
    assert.equal(verdicts.version, 1);
    assert.deepEqual(Object.keys(verdicts.verdicts[0]).sort(), ['address', 'city', 'location', 'stampedAt', 'title', 'venue', 'verdict'].sort(), 'same entry shape as a results-sheet tap');
    assert.equal(verdicts.verdicts[0].verdict, 'not_bear');
    const flipped = await request(state, 'POST', '/review/bear', JSON.stringify({ verdict: 'bear', event: { title: 'furball nyc', bar: 'The Rockbar', city: 'nyc' } }));
    assert.equal(JSON.parse(flipped.body).verdicts, 1, 'same party → one entry, last verdict wins');
    const deckWithVerdict = JSON.parse((await request(state, 'GET', '/review/deck.json')).body);
    assert.equal(deckWithVerdict.cards[0].display.bearVerdict, 'bear', 'the deck shows the stored verdict');
    const clearedBear = await request(state, 'POST', '/review/bear', JSON.stringify({ verdict: 'clear', event: { title: 'FURBALL NYC', bar: 'Rockbar', city: 'nyc' } }));
    assert.equal(JSON.parse(clearedBear.body).removed, true);
    assert.equal((await request(state, 'POST', '/review/bear', JSON.stringify({ verdict: 'maybe', event: {} }))).status, 400);

    const fallback = await request(state, 'GET', '/review?run=not-a-run');
    assert.ok(fallback.body.includes('FURBALL NYC'), 'a bad run id falls back to the newest run');
    const missing = await request(state, 'GET', '/review?run=20200101-000000');
    assert.ok(missing.body.includes('could not be read'));
  } finally {
    if (previousEnv === undefined) delete process.env.CHUNKY_SHARED_STORAGE_DIR;
    else process.env.CHUNKY_SHARED_STORAGE_DIR = previousEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('review page without any saved run explains where runs come from', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-review-empty-'));
  const previousEnv = process.env.CHUNKY_SHARED_STORAGE_DIR;
  process.env.CHUNKY_SHARED_STORAGE_DIR = dir;
  try {
    const page = await request(createServerState(), 'GET', '/review');
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('No saved runs in the shared dir yet'));
    assert.equal(JSON.parse((await request(createServerState(), 'GET', '/review/deck.json')).body).ok, false);
  } finally {
    if (previousEnv === undefined) delete process.env.CHUNKY_SHARED_STORAGE_DIR;
    else process.env.CHUNKY_SHARED_STORAGE_DIR = previousEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('renderReviewPage lists the shared runs, marks the syncing ones, and ships the decided list', () => {
  const deck = reviewQueue.buildDeck(reviewRunFixture('20300101-051500'), reviewQueue.emptyDecisionStore(), { now: 0, curatedBars: {} });
  const html = renderReviewPage(deck, {
    runs: [{ runId: '20300102-051500', available: false }, { runId: '20300101-051500', available: true }],
    scriptName: 'display-saved-run'
  });
  assert.ok(html.includes('<option value="20300102-051500" disabled>20300102-051500 (syncing)</option>'));
  assert.ok(html.includes('<option value="20300101-051500" selected>20300101-051500</option>'));
  assert.ok(html.includes('"executeLink":"scriptable:///run?scriptName=display-saved-run&runId=20300101-051500&reviewExecute=1"'));
  assert.ok(html.includes('id="sheet-tags"') && html.includes('id="btn-undo"'), 'reject sheet and undo present');
});

test('renderReviewCard (update with only notes changes): the notes rows are the diff, with a soft hyphen made visible', () => {
  const ctx = buildReviewCtx();
  const html = renderReviewCard({ kind: 'override', key: 'k', proposal: {
    kind: 'override', title: 'CUBSCOUT', existingTitle: 'CUBSCOUT', startDate: '2030-10-04T04:00:00.000Z', timezone: 'America/Los_Angeles', bar: 'Eagle LA', city: 'nyc',
    overrideOf: '2030-10-04T04:00:00.000Z', changes: {}
  }, display: { notesChanges: [
    { key: 'shortName', from: 'CUB-SCOUT', to: 'CUB­SCOUT' },
    { key: 'facebook', from: '', to: 'https://www.facebook.com/eagle.bar.la/' }
  ] } }, ctx);
  assert.ok(html.includes('<span>series night has</span><span>this night becomes</span>'), 'the change block renders for notes-only changes');
  assert.ok(html.includes('<span class="chg-k">Short name</span>') && html.includes('<span class="was">CUB-SCOUT</span>') && html.includes('<span class="now">CUB·SCOUT</span>'));
  assert.ok(html.includes('· marks a soft hyphen'));
  assert.ok(html.includes('<span class="chg-k">Facebook</span>') && html.includes('>facebook.com/eagle.bar.la/</a>'));
  assert.ok(!html.includes('+ notes'), 'no blurb when the rows carry the change');
});

test('the header names a phone-sourced calendar baseline', () => {
  const label = formatCalendarSnapshotLabel({ la: { status: 'ok', fetchedAt: new Date(Date.now() - 12 * 60000).toISOString(), source: 'phone' }, nyc: { status: 'ok', fetchedAt: new Date(Date.now() - 3 * 3600000).toISOString() } });
  assert.equal(label, 'calendar snapshot: la 12m old (phone) · nyc 3.0h old');
});

test('renderReviewCard: a card back for a second look shows the earlier verdict, its reason and what changed', () => {
  const ctx = buildReviewCtx();
  const base = { kind: 'new', key: 'k', proposal: {
    title: 'MAD.BEAR FOAM POOL PARTY', startDate: '2027-01-30T04:00:00.000Z', endDate: '2027-01-30T11:00:00.000Z', timezone: 'America/Mexico_City',
    bar: 'Blue Chairs Resort', address: 'LÁZARO CÁRDENAS 254', city: 'pv', location: '', source: 'ai-web', url: '', ticketUrl: '', image: '', cover: '', description: '', changes: {}
  }, display: {} };
  const html = renderReviewCard({ ...base, prior: { verdict: 'reject', stampedAt: '2026-09-16T12:13:11.506Z', reason: { tags: [], text: 'Image seems wrong?' }, drift: ['image', 'url'] } }, ctx);
  assert.ok(html.includes('class="prior"'));
  assert.ok(html.includes('You rejected this on 2026-09-16 — “Image seems wrong?”'));
  assert.ok(html.includes('changed since: image, url'));
  assert.ok(!renderReviewCard(base, ctx).includes('class="prior"'), 'no prior, no row');
});

test('renderReviewCard: calendar link memory — an inherited link is named, and a party with no link anywhere invites a paste', () => {
  const ctx = buildReviewCtx();
  const base = { kind: 'new', key: 'k', proposal: {
    title: 'Bears 4 Bareburger at Bareburger HK', startDate: '2026-09-25T01:00:00.000Z', endDate: '2026-09-25T05:00:00.000Z', timezone: 'America/New_York',
    bar: 'Bareburger', address: '366 W 46th St', city: 'nyc', location: '', source: 'Thotyssey', url: '', ticketUrl: '', image: '', cover: '', description: '', changes: {}
  } };
  const none = renderReviewCard({ ...base, display: { linkHistory: { occurrences: 3, latest: '2026-09-17', website: '', from: null } } }, ctx);
  assert.ok(none.includes("no link on this row or on the calendar's 3 earlier nights of this party"), none);
  const eventbrite = 'https://www.eventbrite.com/e/bears-4-bareburger-tickets-1984094486018';
  const inherited = renderReviewCard({ ...base, proposal: { ...base.proposal, ticketUrl: eventbrite }, display: { linkHistory: { occurrences: 3, latest: '2026-09-17', website: eventbrite, from: '2026-09-17' } } }, ctx);
  assert.ok(inherited.includes("link inherited from the calendar's 2026-09-17 night"), inherited);
  assert.ok(!renderReviewCard({ ...base, display: {} }, ctx).includes('🔗 no link'), 'no history, no line');
});

test('renderReviewCard: a night back because it differs from a decided sibling names that night; a venue change is one row, not two', () => {
  const ctx = buildReviewCtx();
  const base = { kind: 'new', key: 'event|daddy pop|eaglewiltonmanors|2027-01-30', proposal: {
    title: 'DADDY POP', startDate: '2027-01-30T04:00:00.000Z', endDate: '2027-01-30T11:00:00.000Z', timezone: 'America/New_York',
    bar: 'Eagle Wilton Manors', address: '2209 Wilton Dr', city: 'fort-lauderdale', location: '', source: 'ai-web', url: '', ticketUrl: '', image: '', cover: '', description: '', changes: {}
  }, display: {} };
  const html = renderReviewCard({ ...base, prior: { verdict: 'approve', stampedAt: '2026-09-18T13:42:00.000Z', reason: null, drift: ['image'], night: '2026-11-06' } }, ctx);
  assert.ok(html.includes("You approved this party's 2026-11-06 night on 2026-09-18. This night differs: image."), html);

  const merge = { kind: 'merge', key: 'event|bear happy hour|rawhide|2027-01-30', proposal: { ...base.proposal, title: 'Bear Happy Hour at Rawhide', bar: 'Rawhide', existingTitle: 'Bear Happy Hour',
    changes: { title: { from: 'Bear Happy Hour', to: 'Bear Happy Hour at Rawhide' }, bar: { from: 'Check instagram for this week’s location.', to: 'Rawhide' } } },
    display: { notesChanges: [{ key: 'bar', from: 'Check instagram for this week’s location.', to: 'Rawhide' }, { key: 'address', from: '', to: '250 W 26th St' }] } };
  const mergeHtml = renderReviewCard(merge, ctx);
  assert.equal((mergeHtml.match(/data-field="bar"/g) || []).length, 1, 'the venue row is shown once');
  assert.ok(mergeHtml.includes('<span class="chg-k">Venue</span>'));
  assert.ok(mergeHtml.includes('data-field="address"'), 'other notes rows stay');
});

test('renderReviewPage ships each card\'s series and each decided entry\'s via, and the deck folds a series into one item', () => {
  const nights = [0, 7].map((days) => ({
    ...reviewRunFixture('20300101-051500').analyzedEvents[0],
    title: 'DADDY POP', startDate: new Date(Date.UTC(2030, 5, 5 + days, 2)).toISOString(), endDate: new Date(Date.UTC(2030, 5, 5 + days, 6)).toISOString(),
    url: 'https://eaglebarwm.com/event/daddy-pop/' + days + '/', image: 'https://eaglebarwm.com/daddy-pop-1.png'
  }));
  const payload = { ...reviewRunFixture('20300101-051500'), analyzedEvents: nights };
  const deck = reviewQueue.buildDeck(payload, reviewQueue.emptyDecisionStore(), { now: 0, curatedBars: {} });
  assert.equal(deck.cards.length, 2);
  const html = renderReviewPage(deck, { runs: [], scriptName: 'display-saved-run' });
  assert.ok(html.includes('"series":{"key":"' + deck.cards[0].series.key + '"'), 'series rides on the card payload');
  assert.ok(html.includes('class="series-split"'), 'the one-at-a-time control is in the client');
  const store = reviewQueue.upsertDecision(reviewQueue.emptyDecisionStore(), reviewQueue.buildDecision({ key: deck.cards[0].key, kind: 'new', verdict: 'approve', snapshot: deck.cards[0].proposal }));
  const decidedDeck = reviewQueue.buildDeck(payload, store, { now: 0, curatedBars: {} });
  const decidedHtml = renderReviewPage(decidedDeck, { runs: [], scriptName: 'display-saved-run' });
  assert.ok(decidedHtml.includes('"via":"' + deck.cards[0].key + '"'), 'the inherited night says which night decided it');
});

test('renderReviewCard: a party that took a slot says whom it displaced', () => {
  const ctx = buildReviewCtx();
  const entry = { kind: 'new', key: 'k', proposal: {
    title: 'Leather Daddy at Ty\'s', startDate: '2026-11-27T00:00:00.000Z', endDate: '2026-11-27T04:00:00.000Z', timezone: 'America/New_York',
    bar: 'Ty\'s Bar NYC', address: '114 Christopher St', city: 'nyc', location: '', source: 'ai-web', url: '', ticketUrl: '', image: '', cover: '', description: '', changes: {}
  }, display: { slotWins: ['Fursdays at Ty\'s (weekly)'] } };
  const html = renderReviewCard(entry, ctx);
  assert.ok(html.includes('🪑 takes the slot from Fursdays at Ty&#39;s (weekly) — that night is withheld') || html.includes("🪑 takes the slot from Fursdays at Ty's (weekly) — that night is withheld"), html.match(/badge[^<]*/g));
  const merge = renderReviewCard({ ...entry, kind: 'merge', display: { slotTakeover: { from: 'Fursdays at Ty\'s', fromCadence: 'weekly' } } }, ctx);
  assert.ok(/takes the slot of the saved weekly night/.test(merge));
});

test('renderReviewPage labels a single-parser run in the picker and the header, and names the calendars the phone lacks', () => {
  const deck = reviewQueue.buildDeck(reviewRunFixture('20300101-051500'), reviewQueue.emptyDecisionStore(), { now: 0, curatedBars: {} });
  deck.missingCalendars = [{ city: 'berlin', calendarName: 'chunky-dad-berlin', events: 3 }];
  deck.runShape = { configured: 29, ran: ['The Bear Calendar'], trigger: 'app', type: 'manual' };
  const html = renderReviewPage(deck, {
    runs: [{ runId: '20300101-100554', available: true, shape: { configured: 29, ran: ['The Bear Calendar'] } }, { runId: '20300101-051500', available: true, shape: { configured: 29, ran: Array(25).fill('x') } }],
    scriptName: 'display-saved-run'
  });
  assert.ok(html.includes('>20300101-100554 · The Bear Calendar only</option>'), 'picker label');
  assert.ok(html.includes('>20300101-051500</option>'), 'a full run carries no label');
  assert.ok(/run [^<]*· The Bear Calendar only/.test(html), 'header says what this run covered');
  assert.ok(html.includes('No calendar on the phone for <b>berlin</b> (chunky-dad-berlin · 3 events)'), html.match(/missing-cal[^<]*/));
});

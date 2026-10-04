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

test('run-once: the inbox is ONE folder sorted by file type — saved pages, pictures and link files become one "Shared pages" parser; pictures get a page of their own; bad files stay, consumed ones move to done/', async () => {
  const fs = require('fs');
  const os = require('os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-inbox-'));
  const dir = path.join(root, 'inbox');
  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-10-02T09-00.json'), JSON.stringify({ url: 'https://www.instagram.com/p/abc123/', title: 'Goldiloxx', html: '<html><body>' + 'flyer '.repeat(80) + '</body></html>', savedAt: '2026-10-02T09:00:00.000Z' }));
  // The old pages/ folder is still read (one release).
  fs.writeFileSync(path.join(dir, 'pages', '2026-10-02T09-05.json'), JSON.stringify({ url: 'https://www.facebook.com/events/42/', html: '<html>' + 'x'.repeat(300) + '</html>' }));
  fs.writeFileSync(path.join(dir, 'empty.json'), JSON.stringify({ url: 'https://www.instagram.com/p/short/', html: '<html></html>' }));
  fs.writeFileSync(path.join(dir, 'nourl.json'), JSON.stringify({ html: 'x'.repeat(300) }));
  fs.writeFileSync(path.join(dir, 'junk.json'), 'not json');
  // A real 2×2 PNG, and (on a Mac) a HEIC made from it: the HEIC is
  // re-encoded as a JPEG beside it, the JPEG is what gets a page.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVQI12P4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(path.join(dir, 'flyer night.png'), png);
  const heic = process.platform === 'darwin';
  if (heic) require('child_process').execFileSync('/usr/bin/sips', ['-s', 'format', 'heic', path.join(dir, 'flyer night.png'), '--out', path.join(dir, 'IMG_0042.HEIC')], { stdio: 'ignore' });
  else fs.writeFileSync(path.join(dir, 'IMG_0042.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
  fs.writeFileSync(path.join(dir, 'saved.html'), '<html><head><link rel="canonical" href="https://dilf.uk/events/123"></head><body>' + 'words '.repeat(60) + '</body></html>');
  fs.writeFileSync(path.join(dir, 'links.txt'), 'https://dilf.uk/events\nnot a link\nhttps://www.example.com/party.');
  fs.writeFileSync(path.join(dir, 'requests.json'), JSON.stringify({ version: 1, requests: [{ url: 'https://dilf.uk/x' }] }));
  fs.writeFileSync(path.join(dir, 'notes.pdf'), 'pdf');
  const cached = [];
  const adapter = { getPageCacheConfig: () => ({ enabled: true, ttlDays: 3 }), writeCachedPage: async (url, page) => { cached.push({ url, by: page.headers['x-fetched-by'], html: page.html }); } };
  const config = { parsers: [{ name: 'Furball' }], config: {} };
  const originalLog = console.log; const lines = []; console.log = (line) => lines.push(String(line));
  let urls;
  try {
    urls = await runOnce.addSharedPagesParser(config, adapter, { CHUNKY_SHARED_STORAGE_DIR: root });
  } finally { console.log = originalLog; }
  assert.deepEqual(urls, [
    'https://www.instagram.com/p/abc123/',
    'https://inbox.chunky.dad/page/IMG_0042.jpg',
    'https://inbox.chunky.dad/page/flyer%20night.png',
    'https://dilf.uk/events',
    'https://www.example.com/party',
    'https://dilf.uk/events/123',
    'https://www.facebook.com/events/42/'
  ]);
  const picturePage = cached.find((c) => c.url === 'https://inbox.chunky.dad/page/flyer%20night.png');
  assert.ok(picturePage && picturePage.by === 'shared-inbox', 'a picture gets a page of its own in the cache');
  assert.ok(picturePage.html.includes('<img src="https://inbox.chunky.dad/file/flyer%20night.png"'), picturePage.html);
  assert.equal(cached.find((c) => c.url === 'https://dilf.uk/events/123').by, 'shared-inbox', 'a saved .html is cached under its canonical link');
  assert.equal(cached.find((c) => c.url === 'https://www.instagram.com/p/abc123/').by, 'share-sheet');
  const parser = config.parsers.find((p) => p.name === runOnce.SHARED_PAGES_PARSER_NAME);
  assert.ok(parser, 'the extra parser');
  assert.equal(parser.urlDiscoveryDepth, 0);
  assert.deepEqual(parser.urls, urls);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'done')).sort(), ['2026-10-02T09-00.json', '2026-10-02T09-05.json', ...(heic ? ['IMG_0042.HEIC'] : []), 'IMG_0042.jpg', 'flyer night.png', 'links.txt', 'saved.html'], 'consumed files move to done/ (pictures too — OCR reads them from there)');
  assert.equal(fs.readFileSync(path.join(dir, 'done', 'IMG_0042.jpg')).subarray(0, 2).toString('hex'), 'ffd8', 'the JPEG twin');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => !['done', 'pages'].includes(n)).sort(), ['empty.json', 'junk.json', 'notes.pdf', 'nourl.json', 'requests.json'], 'the rest stay; requests.json is the phone-fetch list, never consumed');
  assert.ok(lines.some((line) => /files left in the inbox \(4\)/.test(line)), lines.join('\n'));
  assert.ok(lines.some((line) => /3 page\(s\), 2 picture\(s\), 2 link\(s\)/.test(line)), lines.join('\n'));
  // A parser filter for another parser leaves the inbox alone; no inbox dir, nothing.
  assert.deepEqual(await runOnce.addSharedPagesParser({ parsers: [], config: {} }, adapter, { CHUNKY_SHARED_STORAGE_DIR: root, CHUNKY_RUN_PARSER: 'Furball' }), []);
  assert.deepEqual(await runOnce.addSharedPagesParser({ parsers: [], config: {} }, adapter, { CHUNKY_SHARED_STORAGE_DIR: path.join(root, 'nowhere') }), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('inbox pictures: a screenshot of a post is cropped to its flyer when the vision model places it plausibly; a bare flyer, an implausible box, a missing answer or a failing tool leave the picture as it is', async () => {
  const fs = require('fs');
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-crop-'));
  const file = path.join(dir, 'IMG_0099.PNG');
  fs.writeFileSync(file, 'png');
  const calls = [];
  const sips = async (args) => {
    calls.push(args.join(' '));
    if (args[0] === '-g') return 'pixelWidth: 1170\npixelHeight: 2640\n';
    if (args[0] === '-c') fs.writeFileSync(args[args.length - 1], 'jpeg');
    return '';
  };
  const lines = []; const originalLog = console.log; console.log = (line) => lines.push(String(line));
  try {
    // Qwen-VL's native 0–1000 grid: [0, 174, 998, 733] on a 1170×2640 screenshot.
    const cropped = await runOnce.cropScreenshotToFlyer({ file, sips, locate: async () => ({ screenshot: true, app: 'Instagram', bbox_2d: [0, 174, 998, 733] }) });
    assert.equal(cropped, path.join(dir, 'IMG_0099-flyer.jpg'));
    assert.ok(calls.some((c) => /^-c 1476 1168 --cropOffset 459 0 -s format jpeg/.test(c)), calls.join('\n'));
    assert.ok(lines.some((l) => /is a screenshot \(Instagram\): cropped to the flyer, 1168x1476 at 0,459/.test(l)), lines.join('\n'));
    // A bare flyer: nothing happens.
    assert.equal(await runOnce.cropScreenshotToFlyer({ file, sips, locate: async () => ({ screenshot: false, app: '' }) }), '');
    // A screenshot whose box is a sliver, or wider than the image allows: kept.
    assert.equal(await runOnce.cropScreenshotToFlyer({ file, sips, locate: async () => ({ screenshot: true, bbox_2d: [0, 100, 1000, 150] }) }), '');
    assert.equal(await runOnce.cropScreenshotToFlyer({ file, sips, locate: async () => ({ screenshot: true, bbox_2d: [0, 0, 1000, 1000] }) }), '', 'the whole image is not a crop');
    assert.equal(await runOnce.cropScreenshotToFlyer({ file, sips, locate: async () => ({ screenshot: true, bbox_2d: [0, 100, 300, 900] }) }), '', 'narrower than half the width');
    assert.ok(lines.some((l) => /implausible/.test(l)));
    // No answer, a broken answer, a tool that throws: kept, never a throw.
    assert.equal(await runOnce.cropScreenshotToFlyer({ file, sips, locate: async () => null }), '');
    assert.equal(await runOnce.cropScreenshotToFlyer({ file, sips, locate: async () => ({ screenshot: true, bbox_2d: 'nope' }) }), '');
    assert.equal(await runOnce.cropScreenshotToFlyer({ file, sips: async () => { throw new Error('sips gone'); }, locate: async () => ({ screenshot: true, bbox_2d: [0, 174, 998, 733] }) }), '');
    assert.ok(lines.some((l) => /not cropped \(sips gone\)/.test(l)));
    // No core / no OCR config → the default locator answers null → kept.
    assert.equal(await runOnce.cropScreenshotToFlyer({ file, sips, adapter: {} }), '');

    // Through the intake: the crop is the picture that gets a page; both files move to done/.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-crop-inbox-'));
    fs.mkdirSync(path.join(root, 'inbox'));
    fs.writeFileSync(path.join(root, 'inbox', 'shot.png'), 'png');
    const cached = [];
    const adapter = { getPageCacheConfig: () => ({ enabled: true, ttlDays: 3 }), writeCachedPage: async (url) => { cached.push(url); } };
    const config = { parsers: [], config: {} };
    const urls = await runOnce.addSharedPagesParser(config, adapter, { CHUNKY_SHARED_STORAGE_DIR: root }, fs, { sips, locateFlyer: async () => ({ screenshot: true, app: 'Instagram', bbox_2d: [0, 174, 998, 733] }) });
    assert.deepEqual(urls, ['https://inbox.chunky.dad/page/shot-flyer.jpg']);
    assert.deepEqual(fs.readdirSync(path.join(root, 'inbox', 'done')).sort(), ['shot-flyer.jpg', 'shot.png']);
    fs.rmSync(root, { recursive: true, force: true });
  } finally { console.log = originalLog; }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('review server: /inbox/file/<name> serves a picture from the shared inbox (or its done/ folder) read-only, refuses paths, and the deck rewrites inbox addresses to it', async () => {
  const fs = require('fs');
  const os = require('os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-inbox-serve-'));
  fs.mkdirSync(path.join(root, 'inbox', 'done'), { recursive: true });
  fs.writeFileSync(path.join(root, 'inbox', 'done', 'flyer night.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(root, 'secret.txt'), 'no');
  const reviewQueue = require(path.join(__dirname, '..', 'tools', 'review-queue.js'));
  assert.equal(reviewQueue.reviewImageUrl('https://inbox.chunky.dad/file/flyer%20night.png'), '/inbox/file/flyer%20night.png');
  assert.equal(reviewQueue.reviewImageUrl('https://cdn.example.com/a.jpg'), 'https://cdn.example.com/a.jpg');
  assert.equal(reviewQueue.reviewImageUrl('https://inbox.chunky.dad/page/flyer.png'), 'https://inbox.chunky.dad/page/flyer.png', 'only the file address is served');
  assert.ok(reviewQueue.readSharedInboxFile(root, 'flyer night.png'), 'found in done/');
  assert.equal(reviewQueue.readSharedInboxFile(root, '../secret.txt'), null);
  assert.equal(reviewQueue.readSharedInboxFile(root, 'missing.png'), null);
  const previous = process.env.CHUNKY_SHARED_STORAGE_DIR;
  process.env.CHUNKY_SHARED_STORAGE_DIR = root;
  try {
    const state = createServerState();
    const hit = await request(state, 'GET', '/inbox/file/flyer%20night.png');
    assert.equal(hit.status, 200);
    assert.equal(hit.headers['Content-Type'], 'image/png');
    assert.equal((await request(state, 'GET', '/inbox/file/..%2Fsecret.txt')).status, 404);
    assert.equal((await request(state, 'GET', '/inbox/file/missing.png')).status, 404);
  } finally {
    if (previous === undefined) delete process.env.CHUNKY_SHARED_STORAGE_DIR; else process.env.CHUNKY_SHARED_STORAGE_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('inbox pictures: approving a card pushes a web-sized copy to the pictures branch + one PR (plumbing only, nothing in the checkout touched), records it PENDING; merged → website address; closed → dropped; idempotent; failures record nothing', async () => {
  const fs = require('fs');
  const os = require('os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-pictures-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-pictures-repo-'));
  fs.mkdirSync(path.join(root, 'inbox', 'done'), { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVQI12P4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(path.join(root, 'inbox', 'done', 'IMG_0042.jpg'), png);
  const reviewQueue = require(path.join(__dirname, '..', 'tools', 'review-queue.js'));
  const calls = [];
  let prOpen = null;
  let prState = null;
  const run = (file, args) => {
    calls.push([file, ...args].join(' '));
    if (file === '/usr/bin/sips') { fs.copyFileSync(args[args.length - 3], args[args.length - 1]); return ''; }
    if (file === 'gh' && args[1] === 'list') return JSON.stringify(prOpen ? [prOpen] : []);
    if (file === 'gh' && args[1] === 'create') { prOpen = { number: 1860, url: 'https://github.com/x/y/pull/1860' }; return prOpen.url + '\n'; }
    if (file === 'gh' && args[1] === 'view') return JSON.stringify(prState);
    const sub = args[2];
    if (sub === 'hash-object') return 'b10b' + '0'.repeat(36);
    if (sub === 'write-tree') return '7ree' + '0'.repeat(36);
    if (sub === 'commit-tree') return 'c0de' + '0'.repeat(36);
    if (sub === 'push' && process.env.CHUNKY_TEST_PUSH_FAILS) throw new Error('push rejected');
    return '';
  };
  const address = 'https://inbox.chunky.dad/file/IMG_0042.jpg';
  const common = { sharedRoot: root, repoRoot: repo, address, title: 'BEARRACUDA LA', startDate: '2030-11-14T08:00:00.000Z', run };

  process.env.CHUNKY_TEST_PUSH_FAILS = '1';
  assert.throws(() => reviewQueue.publishSharedPicture(common), /push rejected/);
  assert.deepEqual(reviewQueue.loadPublishedPictures(root).pictures, {}, 'a failed push records nothing');
  delete process.env.CHUNKY_TEST_PUSH_FAILS;

  const record = reviewQueue.publishSharedPicture(common);
  assert.equal(record.url, null, 'pending until the PR is merged');
  assert.equal(record.pr.number, 1860);
  assert.equal(record.branch, 'inbox-pictures');
  assert.match(record.path, /^img\/inbox\/2030-11-14-bearracuda-la-[0-9a-f]{8}\.jpg$/);
  assert.ok(calls.some((c) => /^\/usr\/bin\/sips -Z 1280 -s format jpeg/.test(c)), 'web-sized JPEG');
  assert.ok(calls.some((c) => c.includes('read-tree refs/remotes/origin/main')), 'no open PR → the branch starts from main');
  assert.ok(calls.some((c) => c.includes(`update-index --add --cacheinfo 100644,b10b${'0'.repeat(36)},${record.path}`)));
  assert.ok(calls.some((c) => c.includes(`push --quiet origin c0de${'0'.repeat(36)}:refs/heads/inbox-pictures`)));
  assert.ok(calls.some((c) => /^gh pr create --head inbox-pictures --base main/.test(c)));
  assert.ok(!calls.some((c) => /git -C \S+ (checkout|commit |add |merge)/.test(c)), 'the checkout is never touched');
  assert.equal(fs.readdirSync(repo).length, 0, 'nothing written into the checkout');
  assert.equal(reviewQueue.loadPublishedPictures(root).pictures[address].pr.number, 1860, 'recorded');
  const again = reviewQueue.publishSharedPicture(common);
  assert.equal(again.commit, record.commit, 'idempotent');

  // A second picture while the PR is open rides the same branch + PR.
  fs.writeFileSync(path.join(root, 'inbox', 'two.png'), png);
  const second = reviewQueue.publishSharedPicture({ ...common, address: 'https://inbox.chunky.dad/file/two.png', title: 'Second' });
  assert.equal(second.pr.number, 1860);
  assert.ok(calls.some((c) => c.includes('read-tree refs/remotes/origin/inbox-pictures')), 'the open PR\'s branch is the base');

  // Deck build: pending → merged fills the website address; closed drops.
  prState = { state: 'OPEN', mergedAt: null };
  const attempts = new Map();
  let out = reviewQueue.publishApprovedPictures({ version: 1, decisions: [] }, { sharedRoot: root, repoRoot: repo, run, attempts });
  assert.equal(out.resolved, 0);
  assert.equal(reviewQueue.loadPublishedPictures(root).pictures[address].url, null);
  prState = { state: 'MERGED', mergedAt: '2030-10-05T00:00:00.000Z' };
  out = reviewQueue.publishApprovedPictures({ version: 1, decisions: [] }, { sharedRoot: root, repoRoot: repo, run, attempts, now: Date.now() + 11 * 60 * 1000 });
  assert.equal(out.resolved, 2);
  assert.equal(reviewQueue.loadPublishedPictures(root).pictures[address].url, `https://chunky.dad/${record.path}`);
  assert.equal(reviewQueue.loadPublishedPictures(root).pictures[address].publishedAt, '2030-10-05T00:00:00.000Z');

  // An approved decision whose picture was never pushed (approve-time failure) is published at deck build.
  fs.writeFileSync(path.join(root, 'inbox', 'three.png'), png);
  prOpen = null;
  const decisions = { version: 1, decisions: [{ key: 'event|x|y|2030-10-04', kind: 'new', verdict: 'approve', stampedAt: '2030-10-01T00:00:00.000Z', snapshot: { title: 'Three', startDate: '2030-10-04T02:00:00.000Z', image: 'https://inbox.chunky.dad/file/three.png' } }] };
  out = reviewQueue.publishApprovedPictures(decisions, { sharedRoot: root, repoRoot: repo, run, attempts: new Map() });
  assert.equal(out.published.length, 1);
  assert.equal(out.published[0].pr.number, 1860, 'a new PR (the old one merged → branch restarted from main)');
  prState = { state: 'CLOSED', mergedAt: null };
  reviewQueue.resolvePendingPictures(root, { repoRoot: repo, run });
  assert.equal(reviewQueue.loadPublishedPictures(root).pictures['https://inbox.chunky.dad/file/three.png'], undefined, 'closed unmerged → dropped, offered again later');
  // Old records go: a published one 120 days after it went up, a pending one 60 days after its push.
  const aged = reviewQueue.loadPublishedPictures(root);
  aged.pictures['https://inbox.chunky.dad/file/old.png'] = { url: 'https://chunky.dad/img/inbox/old.jpg', path: 'img/inbox/old.jpg', publishedAt: '2029-01-01T00:00:00.000Z' };
  aged.pictures['https://inbox.chunky.dad/file/stale.png'] = { url: null, path: 'img/inbox/stale.jpg', pr: { number: 5 }, pushedAt: '2029-01-01T00:00:00.000Z' };
  reviewQueue.savePublishedPictures(root, aged);
  assert.equal(reviewQueue.prunePublishedPictures(root, { now: Date.parse('2030-01-01T00:00:00Z') }), 2);
  assert.equal(Object.keys(reviewQueue.loadPublishedPictures(root).pictures).length, 2, 'the two live records stay');
  assert.equal(reviewQueue.prunePublishedPictures(root, { now: Date.parse('2030-01-01T00:00:00Z') }), 0);
  assert.throws(() => reviewQueue.publishSharedPicture({ ...common, address: 'https://inbox.chunky.dad/file/gone.png' }), /is gone/);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

test('phone a friend: an ask leaves the stack for the Friends section; one link per friend carries the cards in its hash (public pictures only, capped); the reply link resolves through the export to advice rows; the card returns with the advice', async () => {
  const fs = require('fs');
  const os = require('os');
  const reviewQueue = require(path.join(__dirname, '..', 'tools', 'review-queue.js'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-friend-'));
  const file = reviewQueue.getFriendAdvicePath(root);
  let store = reviewQueue.loadFriendAdvice(file);
  assert.deepEqual(store, { version: 1, asks: [], exports: [], advice: [], friends: {} });
  const snapshot = { title: 'FURBALL NYC', startDate: '2030-10-04T02:00:00.000Z', timezone: 'America/New_York', bar: 'Rockbar', address: '185 Christopher St', city: 'nyc', url: 'https://furball.nyc/', image: 'https://inbox.chunky.dad/file/x.png', source: 'Furball' };
  assert.throws(() => reviewQueue.recordFriendAsk(store, { key: 'event|furball|rockbar|2030-10-03', friend: '  ' }), /needs a friend/);
  store = reviewQueue.recordFriendAsk(store, { key: 'event|furball|rockbar|2030-10-03', kind: 'new', friend: ' Matt ', question: 'still at Rockbar?', snapshot }, Date.parse('2030-10-01T00:00:00Z'));
  store = reviewQueue.recordFriendAsk(store, { key: 'event|other|eagle|2030-10-05', kind: 'new', friend: 'Matt', snapshot: { ...snapshot, title: 'OTHER', image: 'https://cdn.example.com/f.jpg' } });
  store = reviewQueue.recordFriendAsk(store, { key: 'event|la|eagle|2030-10-05', kind: 'new', friend: 'Roger', snapshot: { ...snapshot, title: 'LA THING' } });
  assert.equal(store.asks.length, 3);
  assert.deepEqual(reviewQueue.knownFriends(store).sort(), ['Matt', 'Roger']);
  reviewQueue.saveFriendAdvice(file, store);

  const htmlByKey = new Map([['event|furball|rockbar|2030-10-03', '<h2>FURBALL NYC</h2>' + '<div class="line">x</div>'.repeat(40)]]);
  const link = reviewQueue.buildFriendLink(reviewQueue.loadFriendAdvice(file), { friend: 'Matt', base: 'https://chunky.dad/phone-a-friend/', now: Date.parse('2030-10-02T00:00:00Z'), htmlByKey });
  assert.equal(link.count, 2);
  assert.equal(link.left, 0);
  assert.match(link.url, /^https:\/\/chunky\.dad\/phone-a-friend\/#j2\.[A-Za-z0-9_-]+$/);
  const payload = JSON.parse(require('zlib').inflateRawSync(Buffer.from(link.url.split('#j2.')[1], 'base64url')).toString('utf8'));
  assert.equal(payload.f, 'Matt');
  assert.equal(payload.e, link.exportId);
  assert.deepEqual(payload.c.map((c) => c.t), ['FURBALL NYC', 'OTHER']);
  assert.ok(payload.c[0].h.includes('<h2>FURBALL NYC</h2>'), 'the deck\'s own card HTML rides in the link');
  assert.ok(payload.c[0].h.startsWith('<div class="line"><b>❓ still at Rockbar?</b></div>'), 'the question tops the card');
  assert.equal(payload.c[1].h, '<h2>OTHER</h2>', 'a card the deck could not render still shows its title');
  assert.ok(link.url.length < 1500, `two cards (one 1 KB of repetitive HTML) fit in ${link.url.length} chars`);
  // Past the size budget, cards wait for the next link.
  let big = reviewQueue.emptyFriendAdviceStore();
  const bigHtml = new Map();
  for (let i = 0; i < 25; i++) {
    big = reviewQueue.recordFriendAsk(big, { key: `event|k${i}|x|2030-10-0${i % 9 + 1}`, friend: 'Roger', snapshot: { title: `K${i}` } });
    bigHtml.set(`event|k${i}|x|2030-10-0${i % 9 + 1}`, require('crypto').randomBytes(900).toString('hex'));
  }
  const capped = reviewQueue.buildFriendLink(big, { friend: 'Roger', htmlByKey: bigHtml });
  assert.ok(capped.url.length <= reviewQueue.ADVICE_LINK_MAX_CHARS, `${capped.url.length} chars`);
  assert.ok(capped.count > 0 && capped.left > 0 && capped.count + capped.left === 25, `${capped.count} sent, ${capped.left} wait`);
  assert.equal(capped.store.exports.at(-1).keys.length, capped.count, 'the export holds exactly the cards sent');
  reviewQueue.saveFriendAdvice(file, link.store);
  assert.equal(reviewQueue.loadFriendAdvice(file).exports[0].keys.length, 2);

  // The friend's page (the deck in friend mode) builds #r2.<base64url JSON { e, f, a: [[i, approve|reject, mode, tags, note]] }>.
  const replyPayload = { e: link.exportId, f: 'Matt', a: [[0, 'reject', 'not-bear', [], 'that is the leather night'], [1, 'approve', '', [], '']] };
  const replyLink = 'https://chunky.dad/phone-a-friend/#r2.' + Buffer.from(JSON.stringify(replyPayload)).toString('base64url');
  const fixReply = reviewQueue.parseFriendReply('#r2.' + Buffer.from(JSON.stringify({ e: 'x', f: 'Matt', a: [[0, 'reject', 'fix', ['wrong venue'], 'moved to the Eagle'], [1, 'reject', 'never', [], ''], [2, 'reject', '', [], ''], [3, 'maybe', '', [], '']] })).toString('base64url'));
  assert.deepEqual(fixReply.answers.map((a) => a.answer), ['fix', 'not-event', 'off'], 'unknown verdicts are dropped');
  assert.deepEqual(fixReply.answers[0].tags, ['wrong venue']);
  const oldReply = reviewQueue.parseFriendReply('#r1.' + Buffer.from(JSON.stringify({ e: 'x', f: 'Matt', a: [[0, 'u', 'hmm', 'T']] })).toString('base64url'));
  assert.equal(oldReply.answers[0].answer, 'unsure', 'the first page\'s replies still read');
  assert.equal(reviewQueue.parseFriendReply('https://chunky.dad/phone-a-friend/#j1.abc'), null, 'an ask link is not a reply');
  assert.equal(reviewQueue.parseFriendReply('hello'), null);
  const reply = reviewQueue.parseFriendReply('  ' + replyLink + ' ');
  assert.equal(reply.friend, 'Matt');
  assert.deepEqual(reply.answers.map((a) => a.answer), ['no', 'yes']);
  const bare = reviewQueue.parseFriendReply('r2.' + replyLink.split('#r2.')[1]);
  assert.equal(bare.exportId, link.exportId, 'the bare code works too');
  const recorded = reviewQueue.recordFriendReply(reviewQueue.loadFriendAdvice(file), reply, Date.parse('2030-10-03T00:00:00Z'));
  assert.equal(recorded.recorded.length, 2);
  assert.equal(recorded.unknown, 0);
  assert.equal(recorded.recorded[0].key, 'event|furball|rockbar|2030-10-03');
  assert.equal(recorded.recorded[0].note, 'that is the leather night');
  reviewQueue.saveFriendAdvice(file, recorded.store);
  const unknown = reviewQueue.recordFriendReply(reviewQueue.loadFriendAdvice(file), { exportId: 'nope', friend: 'Matt', answers: [{ index: 0, answer: 'yes', note: '' }] });
  assert.equal(unknown.unknown, 1, 'an export that is gone cannot be resolved');

  const byKey = reviewQueue.friendAdviceByKey(reviewQueue.loadFriendAdvice(file));
  assert.deepEqual(byKey.get('event|furball|rockbar|2030-10-03').advice.map((a) => a.friend + ':' + a.answer), ['Matt:no']);
  assert.deepEqual(byKey.get('event|furball|rockbar|2030-10-03').asked, [], 'answered → no longer waiting');
  assert.equal(byKey.get('event|la|eagle|2030-10-05').asked[0].friend, 'Roger', 'Roger has not answered');
  // Matt answered everything: the next link has nothing to send.
  assert.equal(reviewQueue.buildFriendLink(reviewQueue.loadFriendAdvice(file), { friend: 'Matt' }).count, 0);
  const cleared = reviewQueue.clearFriendAsk(reviewQueue.loadFriendAdvice(file), 'event|la|eagle|2030-10-05', 'Roger');
  assert.equal(cleared.removed, 1);
  reviewQueue.saveFriendAdvice(file, cleared.store);

  // The deck stamps the rows and the page carries them.
  const run = reviewRunFixture('20300101-051500');
  const deck = reviewQueue.buildDeck(run, { version: 1, decisions: [] }, { runId: run.summary.runId, friendAdvice: reviewQueue.loadFriendAdvice(file), now: Date.parse('2030-10-01T00:00:00Z') });
  const card = deck.cards.find((c) => c.key === 'event|furball|rockbar|2030-10-03');
  assert.deepEqual(card.advice.map((a) => a.answer), ['no']);
  const html = renderReviewPage(deck, { runs: [], scriptName: "display-saved-run", ctx: {} });
  assert.ok(html.includes('🙋 Matt: 🚫 not bear — “that is the leather night”'), 'the advice row is on the card');
  // advice/index.html is what the deck renders in friend mode — a deck change without a rebuild fails here.
  assert.equal(fs.readFileSync(path.join(__dirname, '..', 'phone-a-friend', 'index.html'), 'utf8'), require('../tools/serve-results').renderFriendPage(),
    'phone-a-friend/index.html is stale — run: node tools/build-phone-a-friend-page.js');
  const friendPage = require('../tools/serve-results').renderFriendPage();
  const friendScript = friendPage.slice(friendPage.indexOf('window.__reviewDeck = '));
  assert.doesNotThrow(() => new Function(friendScript.slice(0, friendScript.indexOf('</script>'))), 'the friend page script parses');
  assert.ok(html.includes('id="sheet-ask-mode"') && html.includes('id="friends-wrap"'), 'the ask mode and the Friends section are on the page');
  assert.ok(html.includes('id="btn-ask"') && html.includes('data-act="ask"') && html.includes('id="sheet-ask-go"'), 'a 🙋 Ask button of its own on the stack and in the list, and a big "Add to their list" in the sheet');
  assert.ok(html.includes('class="stamp ask">🙋 ASK A FRIEND') && html.includes('lockedD'), 'pulling a card down asks a friend');
  const deckScript = html.slice(html.indexOf('window.__reviewDeck = '));
  assert.doesNotThrow(() => new Function(deckScript.slice(0, deckScript.indexOf('</script>'))), 'the deck script parses (a stray escape inside the template literal breaks the whole page)');

  // Routes.
  const previous = process.env.CHUNKY_SHARED_STORAGE_DIR;
  process.env.CHUNKY_SHARED_STORAGE_DIR = root;
  try {
    const state = createServerState();
    const asked = await request(state, 'POST', '/review/ask', JSON.stringify({ key: 'event|x|y|2030-10-09', kind: 'new', friend: 'Roger', question: 'bear?', snapshot: { title: 'X' } }));
    assert.equal(asked.status, 200);
    const linked = JSON.parse((await request(state, 'POST', '/review/friend-link', JSON.stringify({ friend: 'Roger' }))).body);
    assert.equal(linked.count, 1);
    assert.ok(linked.url.startsWith('https://chunky.dad/phone-a-friend/#j2.'));
    const sent = JSON.parse(require('zlib').inflateRawSync(Buffer.from(linked.url.split('#j2.')[1], 'base64url')).toString('utf8'));
    assert.ok(sent.c[0].h.includes('class="card-body"') || sent.c[0].h.includes('<h2>'), 'the card is rendered by the deck\'s own renderer');
    const bad = await request(state, 'POST', '/review/advice', JSON.stringify({ text: 'not a link' }));
    assert.equal(bad.status, 400);
    const answer = { e: linked.exportId, f: 'Roger', a: [[0, 'reject', 'fix', ['wrong date or time'], 'ask Matt']] };
    const got = JSON.parse((await request(state, 'POST', '/review/advice', JSON.stringify({ text: 'https://chunky.dad/phone-a-friend/#r2.' + Buffer.from(JSON.stringify(answer)).toString('base64url') }))).body);
    assert.equal(got.recorded.length, 1);
    assert.equal(got.recorded[0].answer, 'fix');
    assert.deepEqual(got.recorded[0].tags, ['wrong date or time']);
    // One tap: the friend's reply link opens THIS server and records the answers.
    const tapLink = (code) => '/review/advice?r=r2.' + Buffer.from(JSON.stringify(code)).toString('base64url');
    const linked2 = JSON.parse((await request(state, 'POST', '/review/friend-link', JSON.stringify({ friend: 'Roger' }))).body);
    assert.equal(linked2.count, 0, 'Roger answered everything already');
    const ask2 = await request(state, 'POST', '/review/ask', JSON.stringify({ key: 'event|y|z|2030-10-12', kind: 'new', friend: 'Roger', snapshot: { title: 'Y' } }));
    assert.equal(ask2.status, 200);
    const fakeReq = { method: 'POST', url: '/review/friend-link', headers: { host: 'rybook.example.ts.net:8734' } };
    assert.equal(require('../tools/serve-results').resolveReplyBase(fakeReq), 'http://rybook.example.ts.net:8734/review/advice', 'replies come back to the address the owner uses');
    assert.equal(require('../tools/serve-results').resolveReplyBase({ headers: { host: 'localhost:8734' } }), '', 'never localhost — no phone can reach it');
    const linked3 = JSON.parse((await request(state, 'POST', '/review/friend-link', JSON.stringify({ friend: 'Roger' }))).body);
    const tapped = await request(state, 'GET', tapLink({ e: linked3.exportId, f: 'Roger', a: [[0, 'approve', '', [], '']] }));
    assert.equal(tapped.status, 200);
    assert.ok(tapped.body.includes('Roger answered 1 card') && tapped.body.includes('url=/review'), tapped.body.slice(0, 300));
    assert.equal((await request(state, 'GET', '/review/advice?r=nope')).status, 400);
    assert.equal(reviewQueue.parseFriendReply('http://x:8734/review/advice?r=r2.' + Buffer.from(JSON.stringify({ e: 'q', f: 'A', a: [[0, 'approve', '', [], '']] })).toString('base64url')).exportId, 'q', 'the ?r= form parses');
    // How to reach a friend lives in the iCloud store only; with a number, the link comes with an sms: link to them.
    assert.equal(reviewQueue.cleanSmsNumber(' (555) 010-2020 '), '5550102020');
    assert.equal(reviewQueue.cleanSmsNumber('+1 555 010 2020'), '+15550102020');
    assert.equal(reviewQueue.cleanSmsNumber('matt'), '', 'not a number');
    const saved = JSON.parse((await request(state, 'POST', '/review/friend-contact', JSON.stringify({ friend: 'Roger', sms: '+1 555 010 2020' }))).body);
    assert.equal(saved.hasContact, true);
    assert.deepEqual(saved.contacts, ['Roger']);
    assert.equal(JSON.parse(fs.readFileSync(reviewQueue.getFriendAdvicePath(root), 'utf8')).friends.Roger.sms, '+15550102020', 'in friend-advice.json (iCloud), nowhere else');
    await request(state, 'POST', '/review/ask', JSON.stringify({ key: 'event|z|z|2030-10-13', kind: 'new', friend: 'Roger', snapshot: { title: 'Z' } }));
    const withSms = JSON.parse((await request(state, 'POST', '/review/friend-link', JSON.stringify({ friend: 'Roger' }))).body);
    assert.ok(withSms.smsLink.startsWith('sms:+15550102020&body='), withSms.smsLink.slice(0, 40));
    assert.ok(decodeURIComponent(withSms.smsLink.split('&body=')[1]).includes(withSms.url), 'the link is in the message');
    const forgot = JSON.parse((await request(state, 'POST', '/review/friend-contact', JSON.stringify({ friend: 'Roger', sms: '' }))).body);
    assert.equal(forgot.hasContact, false);
    const page2 = await request(state, 'GET', '/review');
    assert.ok(!page2.body.includes('15550102020'), 'a number is never on the page');
    // Icons and the home-screen manifest.
    const icon = await request(state, 'GET', '/favicons/review-icon-180.png');
    assert.equal(icon.status, 200);
    assert.equal(icon.headers['Content-Type'], 'image/png');
    assert.equal((await request(state, 'GET', '/favicons/..%2Fpackage.json')).status, 404);
    const manifest = JSON.parse((await request(state, 'GET', '/review/manifest.webmanifest')).body);
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/review');
    const page = await request(state, 'GET', '/advice/');
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('window.__loadFriendDeck') && page.body.includes('class="friend-mode"'), 'the friend page is the deck in friend mode, rendered live');
  } finally {
    if (previous === undefined) delete process.env.CHUNKY_SHARED_STORAGE_DIR; else process.env.CHUNKY_SHARED_STORAGE_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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

test('renderReviewCard (big drift): a warn badge and a facts block — what moves, the matching rung, what still agrees, both pages', () => {
  const ctx = buildReviewCtx();
  const entry = { kind: 'merge', key: 'k', proposal: {
    title: 'TKVR | Nolid', existingTitle: 'Treasure Trail', startDate: '2030-10-11T02:00:00.000Z', timezone: 'America/New_York', city: 'nyc',
    changes: { title: { from: 'Treasure Trail', to: 'TKVR | Nolid' } }
  }, display: { parserName: 'Bearracuda', analysisReason: 'Key match found', bigDrift: {
    reason: 'title renamed (no shared word)', rename: true,
    fields: [{ field: 'title', from: 'Treasure Trail', to: 'TKVR | Nolid', kind: 'rename' }, { field: 'location', from: '1, 1', to: '1.1, 1', km: 11.1 }],
    matchedBy: 'Key match found',
    agree: ['same night (2030-10-10)', 'same bar (Massive)', 'same ticket page (sickening.events/e/x/tickets)'],
    sourcePageUrl: 'https://sickening.events/e/bearracuda-treasure-trail-october',
    calendarUrl: 'https://bearracuda.com/events/ttoct/'
  } } };
  const html = renderReviewCard(entry, ctx);
  assert.ok(html.includes('<span class="badge warn drift">🧭 big drift — title renamed (no shared word) · withheld until you decide</span>'), 'the badge');
  assert.ok(html.includes('<span class="was">Treasure Trail</span>') && html.includes('<span class="now">TKVR | Nolid</span>'), 'the ordinary from → to row stays');
  assert.ok(html.includes('<div class="drift-head">🧭 Big drift — nothing is written until you decide</div>'));
  assert.ok(html.includes('<span class="fact-k">moves</span><span class="fact-v warn">title (renamed — no shared word) · pin (moved 11.1 km)</span>'));
  assert.ok(html.includes('<span class="fact-k">matched as one event by</span><span class="fact-v">Key match found</span>'));
  assert.ok(html.includes('<span class="fact-k">still agrees on</span><span class="fact-v">same night (2030-10-10) · same bar (Massive) · same ticket page (sickening.events/e/x/tickets)</span>'));
  assert.ok(html.includes('<span class="fact-k">scraped from</span>') && html.includes('href="https://sickening.events/e/bearracuda-treasure-trail-october"'));
  assert.ok(html.includes('<span class="fact-k">calendar link</span>') && html.includes('href="https://bearracuda.com/events/ttoct/"'));
  const plain = renderReviewCard({ ...entry, display: { parserName: 'Bearracuda' } }, ctx);
  assert.ok(!plain.includes('big drift') && !plain.includes('class="drift"'), 'an ordinary merge card is unchanged');
  const nothing = renderReviewCard({ ...entry, display: { bigDrift: { reason: 'title and venue changed', fields: [], matchedBy: '', agree: [], sourcePageUrl: '', calendarUrl: '' } } }, ctx);
  assert.ok(nothing.includes('<span class="fact-v"><span class="none">nothing</span></span>') && nothing.includes('<span class="fact-v">unknown</span>'), 'degrades without facts');
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
    assert.ok(page.body.includes('href="scriptable:///run?scriptName=display-saved-run&amp;snapshot=1"'), 'the snapshot refresh is always on the page, whether or not a calendar is missing');
    // Words, views, list and sources (owner, 2026-10-01).
    assert.ok(page.body.includes('id="word"'), 'the word filter');
    assert.ok(page.body.includes('id="views"') && page.body.includes('id="list"') && page.body.includes('id="sources"'), 'stack / list / sources views');
    assert.ok(page.body.includes('id="bulk"'), 'bulk decisions for whatever the filter shows');
    assert.ok(page.body.includes('function jumpTo(') && page.body.includes('function decideMany('), 'jump from the list to the stack; decide a set at once');
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
  assert.ok(html.includes('class="series-join"') && html.includes('fold back'), 'and so is the way back: a split item folds again');
  assert.ok(html.includes('events, same change'), 'the same change on different events is one item');
  assert.ok(html.indexOf('id="sheet-tags"') < html.indexOf('id="sheet-fix"'), 'the chips come before the three answers that close the sheet');
  for (const chip of ['wrong link', 'wrong image', 'should merge', 'recurring']) {
    assert.ok(html.includes(`"${chip}"`), `the deck carries the chip "${chip}"`);
  }
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

test('a folded series says what differs per night, ships each night\'s values, and the page script still parses', () => {
  const base = reviewRunFixture('20300101-051500').analyzedEvents[0];
  const nights = [0, 7, 14].map((days, index) => ({
    ...base,
    title: 'BEARAOKE', startDate: new Date(Date.UTC(2030, 5, 5 + days, 2)).toISOString(), endDate: new Date(Date.UTC(2030, 5, 5 + days, 6)).toISOString(),
    url: 'https://thesofotap.example', ticketUrl: 'https://www.sickening.example/e/bearaoke-' + (index + 2), image: 'https://cdn.example/bearaoke.webp',
    description: 'Sing. '.repeat(60)
  }));
  const deck = reviewQueue.buildDeck({ ...reviewRunFixture('20300101-051500'), analyzedEvents: nights }, reviewQueue.emptyDecisionStore(), { now: 0, curatedBars: {} });
  assert.equal(deck.cards.length, 3);
  const series = deck.cards[0].series;
  assert.deepEqual(series.differs, ['ticketUrl'], 'only the ticket link differs — same time, link, flyer, description');
  assert.deepEqual(series.nights.map((night) => night.values.ticketUrl), ['https://www.sickening.example/e/bearaoke-2', 'https://www.sickening.example/e/bearaoke-3', 'https://www.sickening.example/e/bearaoke-4']);
  assert.ok(series.nights[0].values.time.includes('–'), series.nights[0].values.time);
  assert.ok(series.nights[0].values.description.length <= 161, 'a long description rides as its opening');
  // A later start on one night is a difference too.
  const shifted = nights.map((night, index) => (index === 2 ? { ...night, startDate: new Date(Date.UTC(2030, 5, 19, 3)).toISOString() } : night));
  const shiftedDeck = reviewQueue.buildDeck({ ...reviewRunFixture('20300101-051500'), analyzedEvents: shifted }, reviewQueue.emptyDecisionStore(), { now: 0, curatedBars: {} });
  assert.deepEqual(shiftedDeck.cards[0].series.differs, ['time', 'ticketUrl']);

  const html = renderReviewPage(deck, { runs: [], scriptName: 'display-saved-run' });
  assert.ok(html.includes('Each night is saved as its own event.'), 'the strip says nights are separate events');
  assert.ok(html.includes("compare the ' + item.cards.length + ' nights"), 'the compare control is in the client');
  assert.ok(html.includes('"label":"ticket link"'), 'field labels ride into the client');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length >= 2);
  for (const source of scripts) assert.doesNotThrow(() => new (require('node:vm').Script)(source), 'every inline script parses');
});

test('the series strip names the rhythm of the nights on the card, the Waiting list folds one note on N nights into one row, and the page runs the server\'s own cadence function', () => {
  const base = reviewRunFixture('20300101-051500').analyzedEvents[0];
  const nights = [0, 7, 14].map((days) => ({
    ...base, title: 'Jockstrap Wednesday', bar: 'Eagle NYC', address: '554 W 28th St',
    startDate: new Date(Date.UTC(2030, 5, 6 + days, 2)).toISOString(), endDate: new Date(Date.UTC(2030, 5, 6 + days, 6)).toISOString(), url: ''
  }));
  const payload = { ...reviewRunFixture('20300101-051500'), analyzedEvents: nights };
  const deck = reviewQueue.buildDeck(payload, reviewQueue.emptyDecisionStore(), { now: 0, curatedBars: {} });
  assert.equal(deck.cards[0].series.cadence.text, 'every Wednesday');
  const html = renderReviewPage(deck, { runs: [], scriptName: 'display-saved-run' });
  assert.ok(html.includes('"cadence":{"text":"every Wednesday","stepDays":7,"weekday":"Wednesday","from":"2030-06-05","to":"2030-06-19","nights":3}'), 'the rhythm rides on the card payload');
  for (const piece of ['var describeSeriesCadence = function describeSeriesCadence(days) {', "' nights' + (rhythm ? ', ' + escapeHtml(rhythm) : '')", 'function foldNotes(list) {', "'Bring back ' + row.members.length", "'Drop note (' + row.members.length + ')'"]) {
    assert.ok(html.includes(piece), piece);
  }
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  for (const source of scripts) assert.doesNotThrow(() => new (require('node:vm').Script)(source), 'every inline script parses');
  // The function as the page carries it, run the way the page runs it.
  const shipped = /var describeSeriesCadence = (function describeSeriesCadence\(days\) \{[\s\S]*?\n\});\n/.exec(scripts.join('\n'));
  assert.ok(shipped, 'the cadence function is inlined whole');
  const inPage = require('node:vm').runInNewContext(`(${shipped[1]})`);
  assert.equal(inPage(deck.cards.map((card) => card.key.split('|')[3])).text, 'every Wednesday');
  assert.equal(inPage(deck.cards.slice(1).map((card) => card.key.split('|')[3])), null, 'two nights left on the card: no rhythm claimed');

  // One note swiped onto the folded card: three stored decisions, three decided entries, all waiting.
  let store = reviewQueue.emptyDecisionStore();
  for (const card of deck.cards) {
    store = reviewQueue.upsertDecision(store, reviewQueue.buildDecision({ key: card.key, kind: 'new', verdict: 'reject', snapshot: card.proposal, reason: { mode: 'fix', tags: [], text: 'same for every night' } }));
  }
  const waiting = reviewQueue.buildDeck(payload, store, { now: 0, curatedBars: {} });
  assert.equal(waiting.counts.waiting, 3);
  assert.equal(waiting.cards.length, 0);
  assert.doesNotThrow(() => renderReviewPage(waiting, { runs: [], scriptName: 'display-saved-run' }));
});

test('renderReviewCard: a verdict that reached the card through the party fold names the title it was given on', () => {
  const ctx = buildReviewCtx();
  const proposal = {
    kind: 'dropped', title: 'Jockstrap Wednesday', startDate: '2026-10-01T02:00:00.000Z', endDate: '2026-10-01T08:00:00.000Z', timezone: 'America/New_York',
    bar: 'Eagle NYC', address: '554 W 28th St', city: 'nyc', location: '', source: 'ai-web', url: '', ticketUrl: '', image: '', cover: '', description: '',
    dropReason: 'manual store: not_bear (verdict stamped 2026-09-20)', occurrences: 13, changes: {}
  };
  const folded = renderReviewCard({ kind: 'dropped', key: 'dropped|jockstrap|eaglenyc', proposal,
    display: { bearVerdict: 'not_bear', bearVerdictStampedAt: '2026-09-20T14:44:19.000Z', bearVerdictOn: '🩲 JOCKSTRAP WEDNESDAY | 🎧 DJ <MITCH> | $20 CASH COVER' } }, ctx);
  assert.ok(folded.includes('you said: 🚫 not bear (2026-09-20) — on the same party, listed as “🩲 JOCKSTRAP WEDNESDAY | 🎧 DJ &lt;MITCH&gt; | $20 CASH COVER”'), folded.match(/bear-stored[^<]*/));
  const exact = renderReviewCard({ kind: 'dropped', key: 'dropped|jockstrap|eaglenyc', proposal,
    display: { bearVerdict: 'not_bear', bearVerdictStampedAt: '2026-09-20T14:44:19.000Z', bearVerdictOn: '' } }, ctx);
  assert.ok(exact.includes('you said: 🚫 not bear (2026-09-20)</span>'), 'a verdict on this very title says nothing more');
});

test('the review page offers the three left-swipe answers, a one-tap Not bear, and the Waiting section — and its scripts parse', () => {
  const deck = reviewQueue.buildDeck(reviewRunFixture('20300101-051500'), reviewQueue.emptyDecisionStore(), { now: 0, curatedBars: {} });
  deck.waitingGone = [{ key: 'event|gone|bar|2030-01-05', kind: 'new', title: 'Gone Party', startDate: null, bar: 'Bar', reason: { tags: ['wrong date'], text: '', mode: 'fix' }, stampedAt: '2030-01-01T00:00:00.000Z', seriesPresent: false }];
  const html = renderReviewPage(deck, { runs: [], scriptName: 'display-saved-run' });
  for (const id of ['sheet-fix', 'sheet-notbear', 'sheet-never', 'btn-notbear', 'waiting-wrap']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(html.includes('Bear, but needs a fix'), 'a not-bear card gets the same three answers');
  // Diagonal left swipes: up-left = not bear at once, down-left = the sheet opened on 'needs a fix'.
  for (const piece of ['function leftZone()', "if (zone === 'notbear') { notBearTop(); return; }", "rejectTop(zone === 'fix')", 'NEEDS FIX', '↖ not bear · ↙ needs a fix', '.sheet.fix-first']) assert.ok(html.includes(piece), piece);
  assert.ok(!html.includes("if (c.cards[0].kind === 'dropped') { decide(c, 'reject', null, 'gone-left'); return; }\n    pending = c; openSheet(c);"), 'a left swipe on a not-bear card opens the sheet');
  assert.ok(html.includes('"waitingGone":[{"key":"event|gone|bar|2030-01-05"'), 'orphaned notes ride into the client');
  assert.ok(!html.includes('id="sheet-reject"'), 'the single Reject button is gone');
  for (const source of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1])) {
    assert.doesNotThrow(() => new (require('node:vm').Script)(source), 'every inline script parses');
  }
});

// ---------------------------------------------------------------------------
// UI review 2026-09-29 (phone 390px, run 20260929-091555): defects measured
// in real Chrome, each pinned here.
// ---------------------------------------------------------------------------

test('header bar: cities that read the same are counted, the odd ones keep their names, and only the link row is sticky', () => {
  const nowMs = Date.parse('2026-09-29T15:25:00Z');
  const fresh = '2026-09-29T14:15:00Z'; // 1.2h old
  const snapshots = {};
  for (const city of ['atlanta', 'austin', 'berlin', 'boston', 'dallas', 'nyc', 'sf']) snapshots[city] = { status: 'ok', fetchedAt: fresh };
  snapshots.chicago = { status: 'ok', fetchedAt: '2026-09-27T22:00:00Z', source: 'phone' };
  snapshots.unknown = { status: 'unavailable', fetchedAt: null };
  assert.equal(formatCalendarSnapshotLabel(snapshots, nowMs), 'calendar snapshot: 7 cities 1.2h old · chicago 1.7d old (phone) · unknown unavailable');

  // Three that agree are still three names: nothing to fold yet.
  const few = { la: { status: 'ok', fetchedAt: fresh }, nyc: { status: 'ok', fetchedAt: fresh }, sf: { status: 'ok', fetchedAt: fresh } };
  assert.equal(formatCalendarSnapshotLabel(few, nowMs), 'calendar snapshot: la 1.2h old · nyc 1.2h old · sf 1.2h old');

  const injected = injectHeaderBar('<html><body><p>results</p></body></html>', { savedAt: '2026-09-29T14:15:55Z', calendarSnapshots: snapshots, reviewPending: 30 });
  const sticky = /<div id="chunky-server-header-bar"[^>]*position:sticky[^>]*>([\s\S]*?)<\/div>/.exec(injected);
  assert.ok(sticky, 'the link row is the sticky one');
  assert.ok(sticky[1].includes('href="/run-form"') && sticky[1].includes('🃏 Review (30)') && sticky[1].includes('href="/log"'));
  assert.ok(!sticky[1].includes('calendar snapshot') && !sticky[1].includes('ICS links') && !sticky[1].includes('Run saved'), 'run facts scroll away with the page');
  const info = /<div id="chunky-server-run-info" style="([^"]*)">([\s\S]*?)<\/div>/.exec(injected);
  assert.ok(info && !/sticky|fixed/.test(info[1]), 'the facts row is not pinned');
  assert.ok(info[2].includes('Run saved 2026-09-29T14:15:55Z') && info[2].includes('calendar snapshot: ') && /ICS links/.test(info[2]));
});

test('rewriteBridgeHtml: a section header with many batch buttons wraps instead of widening the page', () => {
  const out = rewriteBridgeHtml('<html><head><style>.section-header { display:flex; }</style></head><body><div class="section-header"></div></body></html>');
  const override = /<style>\s*\.section-header \{ flex-wrap: wrap;[^}]*\}/.exec(out);
  assert.ok(override, 'the override ships with the shim');
  assert.ok(override.index > out.indexOf('.section-header { display:flex; }'), 'after the page\'s own rule, so it wins');
  assert.ok(out.includes('.error-item { color: #b3261e;'), 'the errors are readable: 5.9:1 on their own tint, up from 2.5:1');
  assert.equal(rewriteBridgeHtml(out), out, 'still idempotent');
});

test('transport: gzip only when the browser asks, never for a small body; and the favicon is not a console error', async () => {
  const { requestAcceptsGzip } = require('../tools/serve-results');
  assert.equal(requestAcceptsGzip({ headers: { 'accept-encoding': 'gzip, deflate, br' } }), true);
  assert.equal(requestAcceptsGzip({ headers: { 'accept-encoding': 'deflate, GZIP;q=0.5' } }), true);
  assert.equal(requestAcceptsGzip({ headers: { 'accept-encoding': 'br' } }), false);
  assert.equal(requestAcceptsGzip({ headers: { 'accept-encoding': 'gzip;q=0' } }), false, 'q=0 is a refusal');
  assert.equal(requestAcceptsGzip({ headers: {} }), false);
  assert.equal(requestAcceptsGzip(null), false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-review-gzip-'));
  fs.mkdirSync(path.join(dir, 'runs'));
  fs.writeFileSync(path.join(dir, 'runs', '20300101-051500.json'), JSON.stringify(reviewRunFixture('20300101-051500')));
  const previousEnv = process.env.CHUNKY_SHARED_STORAGE_DIR;
  process.env.CHUNKY_SHARED_STORAGE_DIR = dir;
  try {
    const state = createServerState();
    const plain = await request(state, 'GET', '/review');
    assert.equal(plain.headers['Content-Encoding'], undefined, 'no Accept-Encoding, no compression');

    const packed = { status: null, headers: null, body: null, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(chunk) { this.body = chunk; } };
    const asked = fakeRequest('GET', '/review');
    asked.headers = { 'accept-encoding': 'gzip, deflate' };
    await handleRequest(state, asked, packed);
    assert.equal(packed.status, 200);
    assert.equal(packed.headers['Content-Encoding'], 'gzip');
    assert.equal(packed.headers.Vary, 'Accept-Encoding');
    assert.ok(Buffer.isBuffer(packed.body));
    assert.equal(packed.headers['Content-Length'], packed.body.length);
    const unpacked = require('node:zlib').gunzipSync(packed.body).toString('utf8');
    assert.ok(unpacked.includes('FURBALL NYC') && unpacked.includes('window.__reviewDeck = {'), 'the same page, unpacked');
    assert.ok(packed.body.length < Buffer.byteLength(unpacked) / 3, `${packed.body.length} of ${Buffer.byteLength(unpacked)} bytes`);

    const small = { status: null, headers: null, body: null, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(chunk) { this.body = chunk; } };
    const missing = fakeRequest('GET', '/nope');
    missing.headers = { 'accept-encoding': 'gzip' };
    await handleRequest(state, missing, small);
    assert.equal(small.status, 404);
    assert.equal(small.headers['Content-Encoding'], undefined, 'a one-line answer travels as it is');

    const icon = await request(state, 'GET', '/favicon.ico');
    assert.equal(icon.status, 204);
    assert.equal(icon.body, '');
  } finally {
    if (previousEnv === undefined) delete process.env.CHUNKY_SHARED_STORAGE_DIR;
    else process.env.CHUNKY_SHARED_STORAGE_DIR = previousEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('renderReviewCard (update): a link change is one row — the Website note that mirrors it is not printed again', () => {
  const ctx = buildReviewCtx();
  // BeefDip's PRE WELCOME PARTY as the deck of 2026-09-29 built it.
  const entry = (notesChanges) => ({ kind: 'merge', key: 'k', proposal: {
    kind: 'merge', title: 'PRE WELCOME PARTY', startDate: '2027-01-24T03:00:00.000Z', endDate: '2027-01-24T06:00:00.000Z', timezone: 'America/Mexico_City', city: 'nyc',
    changes: { url: { from: 'http://beefdip.com/tags/', to: 'https://beefdip.com' } }
  }, display: { notesChanges } });
  const html = renderReviewCard(entry([
    { key: 'website', from: 'http://beefdip.com/tags/', to: 'https://beefdip.com' },
    { key: 'address', from: '', to: 'Zona Romántica' }
  ]), ctx);
  assert.equal((html.match(/class="chg[ "]/g) || []).length, 2, 'Event page + Address');
  assert.ok(html.includes('<span class="chg-k">Event page</span>') && html.includes('>beefdip.com/tags/</a>') && html.includes('>beefdip.com</a>'));
  assert.ok(!html.includes('<span class="chg-k">Website</span>'), 'same two links, already a row');
  assert.ok(html.includes('<span class="chg-k">Address</span>'));

  // A Website note that says something ELSE than the stored link is its own row.
  const differs = renderReviewCard(entry([{ key: 'website', from: 'https://beefdip.com/tags/', to: 'https://beefdip.com/planned-events/' }]), ctx);
  assert.ok(differs.includes('<span class="chg-k">Website</span>') && differs.includes('>beefdip.com/planned-events/</a>'));
  // …and with no stored link change at all, the Website note is the only place the change shows.
  const notesOnly = renderReviewCard({ ...entry([{ key: 'website', from: 'https://a.example/', to: 'https://b.example/' }]), proposal: { ...entry([]).proposal, changes: {} } }, ctx);
  assert.ok(notesOnly.includes('<span class="chg-k">Website</span>'));
});

test('formatReviewDateLine / renderReviewCard: a defaulted end is named as a default, never printed as the closing time', () => {
  assert.equal(formatReviewDateLine('2027-04-23T04:00:00.000Z', '2027-04-23T07:00:00.000Z', 'America/New_York', { endDefaulted: true }),
    'Fri, Apr 23, 2027 · 12:00 AM EDT (no end listed — saved with the 3 h default)');
  assert.equal(formatReviewDateLine('2027-04-23T04:00:00.000Z', '2027-04-23T07:00:00.000Z', 'America/New_York'),
    'Fri, Apr 23, 2027 · 12:00 AM – 3:00 AM EDT', 'a stated end is untouched');
  assert.equal(formatReviewDateLine('2027-04-23T04:00:00.000Z', null, 'America/New_York', { endDefaulted: true }),
    'Fri, Apr 23, 2027 · 12:00 AM EDT (no end listed)', 'nothing to call a default');

  const ctx = buildReviewCtx();
  const proposal = { kind: 'new', title: 'SPRING', startDate: '2027-04-23T04:00:00.000Z', endDate: '2027-04-23T07:00:00.000Z', timezone: 'America/New_York', bar: 'Camp Out', city: 'nyc', changes: {} };
  const defaulted = renderReviewCard({ kind: 'new', key: 'k', proposal, display: { endDefaulted: true } }, ctx);
  assert.ok(defaulted.includes('📅 Fri, Apr 23, 2027 · 12:00 AM EDT (no end listed — saved with the 3 h default)'));
  assert.ok(!defaulted.includes('3:00 AM') && !defaulted.includes('7:00 AM'), 'neither the zoned line nor the UTC line claims an end');
  assert.ok(defaulted.includes('🌍 Fri, Apr 23 4:00 AM UTC'));
  const stated = renderReviewCard({ kind: 'new', key: 'k', proposal, display: {} }, ctx);
  assert.ok(stated.includes('12:00 AM – 3:00 AM EDT') && stated.includes('4:00 AM – 7:00 AM UTC'));
});

test('the review page fits the stack to the screen, lets the reject sheet scroll above the keyboard, counts Waiting as listed, and says what the phone held back', () => {
  const deck = reviewQueue.buildDeck(reviewRunFixture('20300101-051500'), reviewQueue.emptyDecisionStore(), { now: 0, curatedBars: {} });
  deck.lastExecution = { at: '2026-09-27T21:47:21.360Z', runId: '20260927-155245', via: 'owner-review', processed: 41, failed: 0, created: 36, updated: 5,
    ownerReview: { approved: 40, rejected: 0, awaiting: 1, housekeeping: 1, withheld: 14 } };
  const html = renderReviewPage(deck, { runs: [], scriptName: 'display-saved-run' });

  // The stack: sized from what the header, the buttons and the hint leave.
  assert.ok(html.includes('height:var(--stage-h, min(68vh, 640px));'), 'the old height is the fallback, not the rule');
  for (const piece of ['function fitStage() {', "window.innerHeight - above - controls.offsetHeight - hint.offsetHeight", "stage.getBoundingClientRect().top", "setProperty('--stage-h'", "window.addEventListener('resize', fitStage);"]) assert.ok(html.includes(piece), piece);
  assert.ok(/function render\(\) \{[^}]*fitStage\(\); \}/.test(html), 'measured after every render — the pills may have wrapped');
  assert.ok(html.includes('max-height:calc(var(--stage-h, 68vh) * 0.59)'), 'the flyer takes its share of the card, not of the screen');
  // The Results link shares the first row with the run picker.
  assert.ok(html.indexOf('<span>Results</span></a>') < html.indexOf('id="filters"') && html.indexOf('<span>Results</span></a>') > html.indexOf('id="run-select"'));

  // The sheet: scrolls inside the visible part of the screen.
  assert.ok(/\.sheet \.panel \{[^}]*max-height:100%;[^}]*overflow-y:auto;/.test(html));
  for (const piece of ['function fitSheet() {', 'var view = window.visualViewport;', "sheet.style.height = Math.round(view.height) + 'px';", "window.visualViewport.addEventListener('resize', fitSheet);"]) assert.ok(html.includes(piece), piece);

  // Waiting: the heading counts the rows under it.
  assert.ok(html.includes("var listed = waitingRows.length + goneRows.length;"));
  assert.ok(!html.includes("textContent = '(' + (rows.length + gone.length) + ')'"), 'not the unfolded night count');

  // Execute: withheld and sent-back approvals are on the line.
  assert.ok(html.includes('"ownerReview":{"approved":40,"rejected":0,"awaiting":1,"housekeeping":1,"withheld":14}'));
  assert.ok(html.includes("review.withheld + ' approved but withheld by the checks on the phone'") && html.includes("review.awaiting + ' back for review'"));

  for (const source of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1])) {
    assert.doesNotThrow(() => new (require('node:vm').Script)(source), 'every inline script parses');
  }
});

test('review routes: a swipe reports the decision it replaced, and its undo puts that decision back', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-review-undo-'));
  fs.mkdirSync(path.join(dir, 'runs'));
  fs.writeFileSync(path.join(dir, 'runs', '20300101-051500.json'), JSON.stringify(reviewRunFixture('20300101-051500')));
  const previousEnv = process.env.CHUNKY_SHARED_STORAGE_DIR;
  process.env.CHUNKY_SHARED_STORAGE_DIR = dir;
  const state = createServerState();
  try {
    const deck = JSON.parse((await request(state, 'GET', '/review/deck.json')).body);
    const card = deck.cards[0];
    const decide = (body) => request(state, 'POST', '/review/decide', JSON.stringify(body));
    const stored = () => JSON.parse(fs.readFileSync(reviewQueue.getDecisionsPath(dir), 'utf8')).decisions;

    const note = JSON.parse((await decide({ key: card.key, kind: card.kind, verdict: 'reject', runId: deck.runId, snapshot: card.proposal,
      reason: { mode: 'fix', tags: [], text: 'Weird website link change' } })).body);
    assert.equal(note.replaced, null, 'a first decision replaces nothing');
    const noteAsStored = stored()[0];

    const slip = JSON.parse((await decide({ key: card.key, kind: card.kind, verdict: 'approve', runId: deck.runId, snapshot: card.proposal })).body);
    assert.deepEqual(slip.replaced, noteAsStored, 'the overwritten note rides back to the page');
    assert.equal(stored()[0].verdict, 'approve');

    const undone = JSON.parse((await decide({ key: card.key, verdict: 'clear', restore: slip.replaced })).body);
    assert.equal(undone.restored, true);
    assert.deepEqual(stored(), [noteAsStored], 'the note is back, untouched');
    assert.ok((await request(state, 'GET', '/review/rejections')).body.includes('[NEEDS FIX] NEW FURBALL NYC'), 'and still in the fix queue');

    // A restore for another key is refused: the clear stays a clear.
    const refused = JSON.parse((await decide({ key: card.key, verdict: 'clear', restore: { ...noteAsStored, key: 'event|else|bar|2030-01-01' } })).body);
    assert.equal(refused.restored, false);
    assert.equal(refused.removed, true);
    assert.deepEqual(stored(), []);

    // Bear verdicts, the same way.
    const party = { title: 'FURBALL NYC', bar: 'Rockbar', address: '185 Christopher St', location: '', city: 'nyc' };
    const bear = JSON.parse((await request(state, 'POST', '/review/bear', JSON.stringify({ verdict: 'bear', event: party }))).body);
    assert.equal(bear.replaced, null);
    const notBear = JSON.parse((await request(state, 'POST', '/review/bear', JSON.stringify({ verdict: 'not_bear', event: party }))).body);
    assert.deepEqual(notBear.replaced, bear.entry);
    const back = JSON.parse((await request(state, 'POST', '/review/bear', JSON.stringify({ verdict: 'clear', event: party, restore: notBear.replaced }))).body);
    assert.equal(back.restored, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(reviewQueue.getBearVerdictsPath(dir), 'utf8')).verdicts, [bear.entry]);

    // The page keeps what each swipe replaced and sends it with the undo.
    const html = (await request(state, 'GET', '/review')).body;
    for (const piece of ['var replaced = { decision: null, bear: null };', "post({ key: record.key, verdict: 'clear', restore: was.decision || undefined })", "postBear(record, 'clear', was.bear)", "'Undone — your earlier decision is back'"]) assert.ok(html.includes(piece), piece);
  } finally {
    if (previousEnv === undefined) delete process.env.CHUNKY_SHARED_STORAGE_DIR;
    else process.env.CHUNKY_SHARED_STORAGE_DIR = previousEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the review page: a finger may start its swipe on a link, a mouse may not', () => {
  const deck = reviewQueue.buildDeck(reviewRunFixture('20300101-051500'), reviewQueue.emptyDecisionStore(), { now: 0, curatedBars: {} });
  const html = renderReviewPage(deck, { runs: [], scriptName: 'display-saved-run' });
  assert.ok(html.includes("var skip = finger ? 'select, textarea, input' : 'a, button, select, textarea, input, summary';"));
  assert.ok(html.includes('begin(t.clientX, t.clientY, e.target, true);'), 'touchstart');
  assert.ok(html.includes('if (!begin(e.clientX, e.clientY, e.target, false)) return;'), 'mousedown');
  assert.ok(html.includes("if (target.closest('a, button, summary')) return; // the browser's own tap"), 'a still finger on a link is the link\'s tap, not the flyer\'s');
  for (const source of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1])) {
    assert.doesNotThrow(() => new (require('node:vm').Script)(source), 'every inline script parses');
  }
});

test('the review page: the click a browser makes up after a tap neither closes the flyer it opened nor toggles the description back', () => {
  const deck = reviewQueue.buildDeck(reviewRunFixture('20300101-051500'), reviewQueue.emptyDecisionStore(), { now: 0, curatedBars: {} });
  const html = renderReviewPage(deck, { runs: [], scriptName: 'display-saved-run' });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  // The lightbox functions as the page carries them, run against a stub of the two nodes they touch.
  const classes = new Set();
  const box = { classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) }, querySelector: () => ({}) };
  let now = 1000;
  const context = require('node:vm').createContext({ document: { getElementById: () => box }, Date: { now: () => now } });
  require('node:vm').runInContext(scripts[0], context);
  const flyer = { querySelector: () => ({ src: 'https://cdn.example/flyer.jpg' }) };
  context.openFlyer(flyer);
  assert.ok(classes.has('open'));
  now += 4; // the made-up click, milliseconds after the touch
  context.closeFlyer();
  assert.ok(classes.has('open'), 'the tap that opened the flyer does not close it');
  now += 900; // the owner's next tap
  context.closeFlyer();
  assert.ok(!classes.has('open'));

  assert.ok(html.includes('if (Date.now() - lastTouchAt < 800) return;'), 'a mouse press right after a touch is the touch\'s echo');
  assert.ok(html.includes("el.addEventListener('touchend', function (e) { lastTouchAt = Date.now(); end(e.target, false); });"));
});

// ---------------------------------------------------------------------------
// run-once: no network, no run (2026-09-30: a run started before the Mac had
// a network was written as the day's run).
// ---------------------------------------------------------------------------
test('run-once: the network is waited for, then the run aborts before any parser work', async () => {
  const sleeps = [];
  let calls = 0;
  const flaky = async () => { calls++; if (calls < 3) throw new TypeError('fetch failed'); return { ok: true }; };
  const reached = await runOnce.waitForNetwork({ env: {}, fetch: flaky, sleep: async (ms) => { sleeps.push(ms); }, attempts: 5, gapMs: 15000 });
  assert.deepEqual(reached, { skipped: false, attempts: 3 });
  assert.deepEqual(sleeps, [15000, 15000]);
  let dead = 0;
  await assert.rejects(
    runOnce.waitForNetwork({ env: {}, fetch: async () => { dead++; throw new TypeError('fetch failed'); }, sleep: async () => {}, attempts: 4, gapMs: 1 }),
    /no network after 4 attempts \(fetch failed\) — ABORTING before any parser work/
  );
  assert.equal(dead, 4);
  let skippedCalls = 0;
  assert.deepEqual(await runOnce.waitForNetwork({ env: { CHUNKY_SKIP_NETWORK_PREFLIGHT: '1' }, fetch: async () => { skippedCalls++; } }), { skipped: true, attempts: 0 });
  assert.equal(skippedCalls, 0, 'an offline replay asks nothing');
  // Any answer is a network — a 404 from the site is not an outage.
  assert.equal((await runOnce.waitForNetwork({ env: {}, fetch: async () => ({ ok: false, status: 404 }), sleep: async () => {} })).attempts, 1);
});

test('run-once: a run that could not read the saved calendars is discarded, not written', () => {
  const { SharedCore } = require(path.join(__dirname, 'shared-core'));
  assert.equal(runOnce.assertCalendarsWereRead({ publishedCalendarSnapshots: { nyc: { status: 'ok' }, sydney: { status: 'unavailable', reason: 'missing' } } }, SharedCore).degraded, false);
  assert.equal(runOnce.assertCalendarsWereRead({}, SharedCore).degraded, false, 'a single-parser run that read no calendar is fine');
  assert.throws(
    () => runOnce.assertCalendarsWereRead({ publishedCalendarSnapshots: { nyc: { status: 'unavailable', reason: 'outage' }, la: { status: 'ok' } } }, SharedCore),
    /1 saved calendar\(s\) could not be read \(nyc\) — their events would be analysed as NEW\. Run discarded/
  );
});

test('review page: the missing-calendar notice says how old the phone\'s list is and links the snapshot-only refresh', () => {
  const { buildScriptableSnapshotLink } = require(path.join(__dirname, '..', 'tools', 'serve-results.js'));
  assert.equal(buildScriptableSnapshotLink('display-saved-run'), 'scriptable:///run?scriptName=display-saved-run&snapshot=1');
});

test('review date line: a whole-day event names its day (or days), says which kind it is and never prints a clock; "late" is shown as the page\'s word', () => {
  const { formatReviewDateLine } = require('../tools/serve-results.js');
  // A bar night whose time the page never gave: saved as all-day, said so.
  assert.equal(formatReviewDateLine('2037-10-01T07:00:00.000Z', '2037-10-02T06:59:59.000Z', 'America/Los_Angeles', { wholeDay: 'time-unknown' }),
    'Thu, Oct 1, 2037 · time not listed (saved as all-day)');
  assert.equal(formatReviewDateLine('2037-10-01T07:00:00.000Z', '2037-10-02T06:59:59.000Z', 'America/Los_Angeles', { wholeDay: 'time-unknown', endNote: 'late' }),
    'Thu, Oct 1, 2037 · time not listed (saved as all-day) · the page says: late');
  // A festival: a real all-day event.
  assert.equal(formatReviewDateLine('2037-10-08T07:00:00.000Z', '2037-10-13T06:59:59.000Z', 'America/Los_Angeles', { wholeDay: 'all-day' }),
    'Thu, Oct 8, 2037 – Mon, Oct 12, 2037 · all day');
  const timed = formatReviewDateLine('2037-10-02T01:00:00.000Z', '2037-10-02T04:00:00.000Z', 'America/Los_Angeles', { endDefaulted: true, endNote: 'late' });
  assert.match(timed, /6:00 PM/);
  assert.match(timed, /the page says: late$/);
  assert.ok(!/all day/.test(formatReviewDateLine('2037-10-02T04:00:00.000Z', '2037-10-02T09:00:00.000Z', 'America/Los_Angeles')));
});

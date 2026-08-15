const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { WebAdapter } = require('./web-adapter');
const { SharedCore } = require('../shared-core');
const { EventSchema } = require('../event-schema');

// ---------------------------------------------------------------------------
// Mac-server v2: WebAdapter.getExistingEvents against the published per-city
// calendar ICS (https://chunky.dad/data/calendars/<cityKey>.ics). Every test
// stubs global fetch — nothing here touches the network.
// ---------------------------------------------------------------------------

const CITIES = {
  la: { calendar: 'chunky-dad-la', timezone: 'America/Los_Angeles', patterns: ['los angeles'] }
};

// Compact stand-in for the real la.ics: one plain timed event (the canonical
// D>U>R>O merge target), one MONTHLY;BYDAY=3SU series (Club Chub), and one
// unsupported YEARLY rule.
const LA_ICS_FIXTURE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:duro-la@test',
  'DTSTART:20260802T050000Z',
  'DTEND:20260802T100000Z',
  'SUMMARY:D>U>R>O is back NEW OUTDOOR LOCATION',
  'DESCRIPTION:bar: Precinct DTLA\\nwebsite: https://example.com/duro',
  'LOCATION:34.04\\, -118.25',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:chub-la@test',
  'DTSTART;TZID=America/Los_Angeles:20250720T150000',
  'DTEND;TZID=America/Los_Angeles:20250720T210000',
  'RRULE:FREQ=MONTHLY;BYDAY=3SU',
  'SUMMARY:Club Chub',
  'DESCRIPTION:bar: The Bullet Bar',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:gala-la@test',
  'DTSTART:20260809T010000Z',
  'DTEND:20260809T040000Z',
  'RRULE:FREQ=YEARLY;BYMONTH=8;BYDAY=1SA',
  'SUMMARY:Annual Gala',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

// fetch stub returning `icsText`; returns a call counter accessor. Restore is
// the caller's job (each test uses withFetchStub).
function withFetchStub(icsText, run) {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (icsText instanceof Error) throw icsText;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => icsText
    };
  };
  const done = () => { global.fetch = originalFetch; };
  return run(() => calls).finally(done);
}

function makeAdapter(overrides = {}) {
  return new WebAdapter({ cities: CITIES, ...overrides });
}

function scrapedDuroEvent() {
  return {
    title: 'D>U>R>O',
    city: 'la',
    timezone: 'America/Los_Angeles',
    startDate: new Date('2026-08-02T05:00:00.000Z'),
    endDate: new Date('2026-08-02T10:00:00.000Z'),
    isBearEvent: true
  };
}

test('getExistingEvents returns window-filtered events from the published calendar (per-run memo: one fetch)', async () => {
  await withFetchStub(LA_ICS_FIXTURE, async (fetchCalls) => {
    const adapter = makeAdapter();

    const matched = await adapter.getExistingEvents(scrapedDuroEvent());
    assert.equal(matched.length, 1, 'only the event inside the search window');
    assert.equal(matched[0].identifier, 'duro-la@test', 'identifier is the raw ICS UID');
    assert.equal(matched[0].title, 'D>U>R>O is back NEW OUTDOOR LOCATION');
    assert.equal(matched[0].startDate.toISOString(), '2026-08-02T05:00:00.000Z');
    assert.equal(matched[0].location, '34.04, -118.25', 'LOCATION string unescaped');
    assert.match(matched[0].notes, /bar: Precinct DTLA\nwebsite:/, 'DESCRIPTION rides in notes');

    // Different date, same city: series occurrence via RRULE expansion
    // (3rd Sunday of August 2026 = Aug 16, 15:00 Los Angeles = 22:00Z).
    const seriesWindow = await adapter.getExistingEvents({
      title: 'Club Chub',
      city: 'la',
      startDate: new Date('2026-08-16T22:00:00.000Z'),
      endDate: new Date('2026-08-17T02:00:00.000Z')
    });
    assert.equal(seriesWindow.length, 1);
    assert.equal(seriesWindow[0].identifier, 'chub-la@test');
    assert.equal(seriesWindow[0].recurrence, 'FREQ=MONTHLY;BYDAY=3SU', 'occurrence carries the series RRULE');
    assert.equal(seriesWindow[0].startDate.toISOString(), '2026-08-16T22:00:00.000Z');

    // A week with no calendar activity → empty.
    const emptyWindow = await adapter.getExistingEvents({
      title: 'Nothing here',
      city: 'la',
      startDate: new Date('2026-09-05T02:00:00.000Z'),
      endDate: new Date('2026-09-05T05:00:00.000Z')
    });
    assert.deepEqual(emptyWindow, []);

    assert.equal(fetchCalls(), 1, 'one ICS fetch per city per run (memoized)');
    assert.equal(adapter._publishedCalendarSnapshots.la.status, 'ok', 'snapshot recorded for the header');
  });
});

// Node-side mirrors of the Scriptable saved-series lookup hooks: the wide
// window is the published calendar expanded over the probe window, and the
// record fallback is the parsed VEVENT list itself.
test('getWideWindowCalendarEvents mirrors the probe window off the published calendar', async () => {
  await withFetchStub(LA_ICS_FIXTURE, async (fetchCalls) => {
    const adapter = makeAdapter();
    const lookup = await adapter.getWideWindowCalendarEvents({ city: 'la', title: 'Club Chub' });

    assert.ok(lookup, 'lookup available on Node');
    assert.equal(lookup.calendarName, 'la');
    const chubOccurrences = lookup.events.filter((e) => e.identifier === 'chub-la@test');
    assert.ok(chubOccurrences.length >= 1, 'the monthly series expands into the now-anchored window');
    assert.equal(chubOccurrences[0].recurrence, 'FREQ=MONTHLY;BYDAY=3SU',
      'expanded occurrences carry the series evidence the lookup reads');
    assert.equal(fetchCalls(), 1, 'shares the per-run published-calendar memo');
  });
});

test('getPublishedCalendarRecords exposes the parsed VEVENTs and fails open', async () => {
  await withFetchStub(LA_ICS_FIXTURE, async () => {
    const adapter = makeAdapter();
    const records = await adapter.getPublishedCalendarRecords('la');
    assert.ok(Array.isArray(records));
    assert.deepEqual(records.map((r) => r.uid).sort(), ['chub-la@test', 'duro-la@test', 'gala-la@test']);
    assert.equal(records.find((r) => r.uid === 'chub-la@test').rrule, 'FREQ=MONTHLY;BYDAY=3SU');
  });
  await withFetchStub(new Error('network down'), async () => {
    const adapter = makeAdapter();
    assert.equal(await adapter.getPublishedCalendarRecords('la'), null, 'fetch failure fails open to null');
  });
});

test('disk cache honors the 0.25-day TTL across adapter instances', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-ics-cache-'));
  const pageCache = { enabled: true, ttlDays: 3 };
  try {
    await withFetchStub(LA_ICS_FIXTURE, async (fetchCalls) => {
      const first = makeAdapter({ pageCache });
      first.pageStorageDir = cacheDir;
      await first.getExistingEvents(scrapedDuroEvent());
      assert.equal(fetchCalls(), 1, 'cold cache fetches');

      const second = makeAdapter({ pageCache });
      second.pageStorageDir = cacheDir;
      const cachedResult = await second.getExistingEvents(scrapedDuroEvent());
      assert.equal(cachedResult.length, 1, 'cache hit still yields events');
      assert.equal(fetchCalls(), 1, 'fresh disk cache serves the second run without a fetch');

      // Age the cached file beyond the 6h (0.25d) ICS TTL → refetch.
      const cachedFiles = fs.readdirSync(cacheDir, { recursive: true })
        .map(String)
        .filter((name) => name.endsWith('.json'));
      assert.equal(cachedFiles.length, 1, 'one cached ICS payload on disk');
      const cachedPath = path.join(cacheDir, cachedFiles[0]);
      const staleTime = new Date(Date.now() - 7 * 60 * 60 * 1000);
      fs.utimesSync(cachedPath, staleTime, staleTime);

      const third = makeAdapter({ pageCache });
      third.pageStorageDir = cacheDir;
      await third.getExistingEvents(scrapedDuroEvent());
      assert.equal(fetchCalls(), 2, 'stale cache (7h > 6h TTL) triggers a refetch');
    });
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('published calendar unavailable → [] and exactly one warn per city per run', async () => {
  const warns = [];
  const originalWarn = console.warn;
  console.warn = (message) => warns.push(String(message));
  try {
    await withFetchStub(new Error('network down'), async () => {
      const adapter = makeAdapter();
      assert.deepEqual(await adapter.getExistingEvents(scrapedDuroEvent()), []);
      assert.deepEqual(await adapter.getExistingEvents(scrapedDuroEvent()), [], 'second lookup degrades the same way');
      const degraded = warns.filter((message) =>
        message.includes('published calendar unavailable for la — merge analysis degraded to NEW'));
      assert.equal(degraded.length, 1, 'one warn per city per run');
      assert.equal(adapter._publishedCalendarSnapshots.la.status, 'unavailable');
    });
  } finally {
    console.warn = originalWarn;
  }
});

test('unsupported RRULE degrades to non-recurring and logs once per uid', async () => {
  const logs = [];
  const originalLog = console.log;
  console.log = (message) => logs.push(String(message));
  try {
    await withFetchStub(LA_ICS_FIXTURE, async () => {
      const adapter = makeAdapter();
      const query = {
        title: 'Annual Gala',
        city: 'la',
        startDate: new Date('2026-08-09T01:00:00.000Z'),
        endDate: new Date('2026-08-09T04:00:00.000Z')
      };
      const first = await adapter.getExistingEvents(query);
      const gala = first.find((event) => event.identifier === 'gala-la@test');
      assert.ok(gala, 'the unsupported series still surfaces as a plain one-off event');
      assert.equal(gala.recurrence, undefined, 'treated as non-recurring');
      await adapter.getExistingEvents(query);
      const unsupportedLogs = logs.filter((message) =>
        message.includes('unsupported RRULE for uid gala-la@test — treated as non-recurring'));
      assert.equal(unsupportedLogs.length, 1, 'logged once per uid per run');
    });
  } finally {
    console.log = originalLog;
  }
});

test('merge analysis over ICS-derived existing events: matching pair produces MERGE, not NEW', async () => {
  await withFetchStub(LA_ICS_FIXTURE, async () => {
    const adapter = makeAdapter();
    const core = new SharedCore(CITIES, { eventSchema: EventSchema });
    const analyzed = await core.prepareEventsForCalendar([scrapedDuroEvent()], adapter, {});
    assert.equal(analyzed.length, 1);
    assert.equal(analyzed[0]._action, 'merge', 'published calendar match upgrades NEW → MERGE');
  });
});

test('recurring series match routes to the hands-off override path (no series mutation intent)', async () => {
  await withFetchStub(LA_ICS_FIXTURE, async () => {
    const adapter = makeAdapter();
    const core = new SharedCore(CITIES, { eventSchema: EventSchema });
    const scraped = {
      title: 'Club Chub',
      city: 'la',
      timezone: 'America/Los_Angeles',
      startDate: new Date('2026-08-16T22:00:00.000Z'),
      endDate: new Date('2026-08-17T02:00:00.000Z')
    };
    const existing = await adapter.getExistingEvents(scraped);
    const analysis = await core.resolveCalendarAnalysisWithSeriesProbe(scraped, existing, 'upsert', adapter);
    assert.equal(analysis.action, 'new', 'series master is never merged into');
    assert.match(analysis.reason, /creating override/, 'routes to override creation');
    assert.equal(analysis.overrideIdentity.overrideUid, 'chub-la@test');
    assert.equal(analysis.overrideIdentity.overrideRecurrenceId, '20260816T220000Z');
  });
});

test('web adapter never gains a calendar write path', () => {
  const adapter = makeAdapter();
  assert.equal(typeof adapter.executeCalendarActions, 'undefined',
    'orchestrator typeof-check must keep skipping calendar execution on Node/Mac');
});

test('displayResults attaches the published-calendar snapshot info for the server header', async () => {
  await withFetchStub(LA_ICS_FIXTURE, async () => {
    const adapter = makeAdapter();
    await adapter.getExistingEvents(scrapedDuroEvent());
    const results = { totalEvents: 0, bearEvents: 0, calendarEvents: 0, parserResults: [], errors: [] };
    await adapter.displayResults(results);
    assert.ok(results.publishedCalendarSnapshots, 'snapshots ride along in the results');
    assert.equal(results.publishedCalendarSnapshots.la.status, 'ok');
    assert.ok(results.publishedCalendarSnapshots.la.fetchedAt, 'fetch age source for "calendar snapshot: la …"');
  });
});

// ---------------------------------------------------------------------------
// Calendar targets are never invented from a city string. Run 2026-07-31
// (Club Chub) resolved a Wilton Manors address to no configured city and the
// old `chunky-dad-${city}` fallback produced the target
// "chunky-dad-wilton manors" — a name with a space in it, for a calendar that
// does not exist. Unrecognized cities now fail closed to one unknown target.
// ---------------------------------------------------------------------------

test('getCalendarName fails closed for an unrecognized city and logs it once', () => {
  const adapter = makeAdapter();
  assert.equal(adapter.getCalendarName('la'), 'chunky-dad-la', 'configured cities are untouched');

  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  let names;
  try {
    names = ['wilton manors', 'wilton manors', '', undefined, 'default']
      .map(city => adapter.getCalendarName(city));
  } finally {
    console.log = originalLog;
  }

  for (const name of names) {
    assert.equal(name, 'chunky-dad-unknown', 'every unrecognized city routes to the one unknown target');
    assert.ok(!/\s/.test(name), 'a calendar name can never contain whitespace');
  }

  const wiltonLines = lines.filter(line => line.includes('wilton manors'));
  assert.equal(wiltonLines.length, 1, 'logged once per distinct unrecognized city, not once per event');
  assert.ok(wiltonLines[0].includes('Unrecognized city'), `expected the visible drop line, got: ${wiltonLines[0]}`);
});

// ---------------------------------------------------------------------------
// REPORT-ONLY sanity flags: the small-batch event detail block prints an
// additive line for flagged events (stamped upstream by
// SharedCore.getEventSanityFlags) and stays silent otherwise.
// ---------------------------------------------------------------------------

test('displayCalendarEvents prints the sanity line only for flagged events', () => {
  const adapter = makeAdapter();
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  try {
    adapter.displayCalendarEvents([
      {
        title: '6:30 PM',
        startDate: '2026-08-01T02:00:00.000Z',
        _sanityFlags: [{ code: 'title-is-date-phrase', detail: 'title is entirely a date/time expression' }]
      },
      { title: 'Plain', startDate: '2026-08-01T02:00:00.000Z' }
    ], { name: 'test-parser' });
  } finally {
    console.log = originalLog;
  }
  const sanityLines = lines.filter(line => line.includes('⚠️ Sanity:'));
  assert.deepEqual(sanityLines, ['   ⚠️ Sanity: title-is-date-phrase']);
});

// ---------------------------------------------------------------------------
// Shared Mac↔phone storage root (CHUNKY_SHARED_STORAGE_DIR). Opt-in: the env
// var points at the phone's chunky-dad-scraper tree and the Node adapter then
// reads/writes the SAME cache entries the phone does (device-parity keys),
// persists runs/logs with the phone's naming, defers all pruning to the
// phone, and ABORTS LOUDLY when the root is unreachable (no-partial-runs).
// ---------------------------------------------------------------------------

function makeSharedRootFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-shared-root-'));
  fs.mkdirSync(path.join(root, 'storage', 'pages'), { recursive: true });
  return root;
}

async function withSharedRootEnv(value, run) {
  const prev = process.env.CHUNKY_SHARED_STORAGE_DIR;
  if (value === undefined) {
    delete process.env.CHUNKY_SHARED_STORAGE_DIR;
  } else {
    process.env.CHUNKY_SHARED_STORAGE_DIR = value;
  }
  try {
    return await run();
  } finally {
    if (prev === undefined) {
      delete process.env.CHUNKY_SHARED_STORAGE_DIR;
    } else {
      process.env.CHUNKY_SHARED_STORAGE_DIR = prev;
    }
  }
}

// The real device page entry this key derivation is verified against
// (READ-only evidence from the phone's tree):
//   storage/pages/api.redeyetickets.com/api__v1__events__search--q-1b8y3s1.json
// The phone's JavaScriptCore has no URL/URLSearchParams, so its --q- hash is
// computed over the RAW query order; Node's sorted-query derivation yields
// --q-10f5jmh for the same URL and would orphan every phone entry.
const DEVICE_PAGE_URL = 'https://api.redeyetickets.com/api/v1/events/search?q=goldiloxx&per_page=25';
const DEVICE_PAGE_HOST_DIR = 'api.redeyetickets.com';
const DEVICE_PAGE_FILE = 'api__v1__events__search--q-1b8y3s1.json';

test('shared root: env repoints the page cache at the phone tree, logs prune deferral, and adds no prune paths', async () => {
  const root = makeSharedRootFixture();
  try {
    await withSharedRootEnv(root, async () => {
      const lines = [];
      const originalLog = console.log;
      console.log = (...args) => { lines.push(args.join(' ')); };
      let adapter;
      try {
        adapter = makeAdapter();
      } finally {
        console.log = originalLog;
      }
      assert.equal(adapter.sharedStorageRoot, root);
      assert.equal(adapter.pageStorageDir, path.join(root, 'storage', 'pages'));
      const deferral = lines.filter((line) => line.includes('retention pruning is deferred to the cache owner'));
      assert.equal(deferral.length, 1, 'one loud line says the phone owns deletion');
      // The web adapter must never grow a deletion path of its own: the
      // phone owns retention for the shared tree.
      assert.equal(typeof adapter.cleanupOldFiles, 'undefined');
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('shared root: unreachable or malformed root ABORTS construction (never a silent local fallback)', async () => {
  await withSharedRootEnv(path.join(os.tmpdir(), `chunky-missing-${Date.now()}`), async () => {
    assert.throws(() => makeAdapter(), /unreachable/i, 'missing dir aborts');
  });
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-bare-root-'));
  try {
    await withSharedRootEnv(bare, async () => {
      assert.throws(() => makeAdapter(), /storage\/ subtree/i, 'a root without storage/ is the wrong directory');
    });
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test('shared root: device-parity page keys — a phone-written entry (raw query order) is a HIT', async () => {
  const root = makeSharedRootFixture();
  try {
    await withSharedRootEnv(root, async () => {
      const adapter = makeAdapter({ pageCache: { enabled: true, ttlDays: 3 } });
      const parts = adapter.getPageCachePathParts(DEVICE_PAGE_URL);
      assert.equal(parts.hostDir, DEVICE_PAGE_HOST_DIR);
      assert.equal(parts.fileName, DEVICE_PAGE_FILE, 'derived name matches the real device entry byte-for-byte');
      assert.equal(parts.normalizedUrl, DEVICE_PAGE_URL, 'the phone stores the raw trimmed URL');

      const hostDir = path.join(root, 'storage', 'pages', DEVICE_PAGE_HOST_DIR);
      fs.mkdirSync(hostDir, { recursive: true });
      fs.writeFileSync(path.join(hostDir, DEVICE_PAGE_FILE), JSON.stringify({
        url: DEVICE_PAGE_URL,
        fetchedAt: new Date().toISOString(),
        statusCode: 200,
        headers: {},
        fetchState: 'downloaded',
        html: '{"events":[]}'
      }, null, 2));

      const cached = await adapter.readCachedPage(DEVICE_PAGE_URL, adapter.getPageCacheConfig());
      assert.ok(cached, 'phone-seeded entry is served to the Mac run');
      assert.equal(cached.html, '{"events":[]}');
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('shared root: cache writes are temp-file-then-rename in the same dir, device envelope preserved', async () => {
  const root = makeSharedRootFixture();
  try {
    await withSharedRootEnv(root, async () => {
      const adapter = makeAdapter({ pageCache: { enabled: true, ttlDays: 3 } });
      const realFs = adapter.fs;
      const renames = [];
      adapter.fs = {
        ...realFs,
        promises: {
          ...realFs.promises,
          rename: async (from, to) => { renames.push({ from, to }); return realFs.promises.rename(from, to); }
        }
      };

      await adapter.writeCachedPage(DEVICE_PAGE_URL, {
        html: '{"events":[1]}', url: DEVICE_PAGE_URL, statusCode: 200, headers: {}
      }, adapter.getPageCacheConfig());

      assert.equal(renames.length, 1, 'write goes through rename');
      assert.equal(path.dirname(renames[0].from), path.dirname(renames[0].to), 'temp file lives in the same directory (atomic rename)');
      const finalPath = path.join(root, 'storage', 'pages', DEVICE_PAGE_HOST_DIR, DEVICE_PAGE_FILE);
      assert.equal(renames[0].to, finalPath);

      const written = JSON.parse(fs.readFileSync(finalPath, 'utf8'));
      assert.deepEqual(Object.keys(written), ['url', 'fetchedAt', 'statusCode', 'headers', 'fetchState', 'html'],
        'exact device envelope (field order included)');
      assert.equal(written.fetchState, 'downloaded');

      const leftovers = fs.readdirSync(path.dirname(finalPath)).filter((name) => name.includes('.tmp-'));
      assert.deepEqual(leftovers, [], 'no torn temp files left for iCloud to sync');
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('shared root: dataless iCloud stub (0-byte placeholder) is a cache MISS, never a crash', async () => {
  const root = makeSharedRootFixture();
  try {
    await withSharedRootEnv(root, async () => {
      const adapter = makeAdapter({ pageCache: { enabled: true, ttlDays: 3 } });
      assert.equal(adapter.pageStorageDir, path.join(root, 'storage', 'pages'), 'reads target the shared tree');
      const hostDir = path.join(root, 'storage', 'pages', DEVICE_PAGE_HOST_DIR);
      fs.mkdirSync(hostDir, { recursive: true });
      fs.writeFileSync(path.join(hostDir, DEVICE_PAGE_FILE), '');
      const cached = await adapter.readCachedPage(DEVICE_PAGE_URL, adapter.getPageCacheConfig());
      assert.equal(cached, null, 'evicted stub fails open to a refetch');
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// 2026-08 incident: writeFileAtomicallyNode renamed a temp file OVER a
// dataless (evicted) iCloud placeholder, which deadlocks inside fileproviderd
// — the awaited rename never resolves and the run hangs silently. Defense:
// under the shared root the destination is unlinked before the rename.
test('shared root: writeFileAtomicallyNode unlinks an existing destination BEFORE the rename (never rename over a possibly-dataless target)', async () => {
  const root = makeSharedRootFixture();
  try {
    await withSharedRootEnv(root, async () => {
      const adapter = makeAdapter({ pageCache: { enabled: true, ttlDays: 3 } });
      const realFs = adapter.fs;
      const ops = [];
      adapter.fs = {
        ...realFs,
        promises: {
          ...realFs.promises,
          unlink: async (p) => { ops.push(['unlink', p]); return realFs.promises.unlink(p); },
          rename: async (from, to) => { ops.push(['rename', to]); return realFs.promises.rename(from, to); }
        }
      };

      const hostDir = path.join(root, 'storage', 'pages', DEVICE_PAGE_HOST_DIR);
      fs.mkdirSync(hostDir, { recursive: true });
      const finalPath = path.join(hostDir, DEVICE_PAGE_FILE);
      fs.writeFileSync(finalPath, 'stale entry (a dataless stub in production)');

      await adapter.writeFileAtomicallyNode(finalPath, 'fresh contents');

      const unlinkIndex = ops.findIndex(([op, p]) => op === 'unlink' && p === finalPath);
      const renameIndex = ops.findIndex(([op, p]) => op === 'rename' && p === finalPath);
      assert.notEqual(unlinkIndex, -1, 'existing destination is unlinked (a dataless target would deadlock the rename in fileproviderd)');
      assert.notEqual(renameIndex, -1, 'write still lands via rename');
      assert.ok(unlinkIndex < renameIndex, 'unlink happens BEFORE the rename');
      assert.equal(fs.readFileSync(finalPath, 'utf8'), 'fresh contents');
    });

    // Shared root OFF: the pure atomic rename is preserved (no unlink — the
    // local tree has no dataless files and the rename-over is what makes the
    // write atomic for concurrent readers).
    await withSharedRootEnv(undefined, async () => {
      const adapter = makeAdapter();
      const realFs = adapter.fs;
      const unlinks = [];
      adapter.fs = {
        ...realFs,
        promises: {
          ...realFs.promises,
          unlink: async (p) => { unlinks.push(p); return realFs.promises.unlink(p); }
        }
      };
      const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-local-write-'));
      try {
        const target = path.join(localDir, 'entry.json');
        fs.writeFileSync(target, 'old');
        await adapter.writeFileAtomicallyNode(target, 'new');
        assert.deepEqual(unlinks, [], 'local writes keep the pure atomic rename');
        assert.equal(fs.readFileSync(target, 'utf8'), 'new');
      } finally {
        fs.rmSync(localDir, { recursive: true, force: true });
      }
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// JS-side timeouts cannot cancel a wedged syscall, but they MUST stop the
// run from awaiting it forever: a wedged rename/unlink under the shared root
// is treated as a failed write (loud line, error thrown to the caller's
// catch) instead of hanging the pipeline — the incident's 22-minute silence.
test('shared root: a wedged rename/unlink is bounded — fails loudly instead of hanging the run', async () => {
  const root = makeSharedRootFixture();
  const HUNG = Symbol('hung');
  const raceAgainstGuard = (promise) => Promise.race([
    promise.then(() => 'resolved', (error) => error),
    new Promise((resolve) => setTimeout(() => resolve(HUNG), 2000))
  ]);
  try {
    await withSharedRootEnv(root, async () => {
      const hostDir = path.join(root, 'storage', 'pages', DEVICE_PAGE_HOST_DIR);
      fs.mkdirSync(hostDir, { recursive: true });
      const finalPath = path.join(hostDir, DEVICE_PAGE_FILE);

      const lines = [];
      const originalLog = console.log;
      console.log = (...args) => { lines.push(args.join(' ')); originalLog.apply(console, args); };
      try {
        // Wedged rename (kernel-stuck syscall in production; a promise that
        // never settles here — the destination does not exist, so no unlink).
        const renameAdapter = makeAdapter({ timeout: 80 });
        const realFs = renameAdapter.fs;
        renameAdapter.fs = {
          ...realFs,
          promises: { ...realFs.promises, rename: () => new Promise(() => {}) }
        };
        const renameOutcome = await raceAgainstGuard(renameAdapter.writeFileAtomicallyNode(finalPath, 'contents'));
        assert.notEqual(renameOutcome, HUNG, 'a wedged rename must not hang the run (bounded shared-root fs op)');
        assert.match(renameOutcome.message, /timed out/i, 'the bounded op reports the timeout as a failed write');

        // Wedged unlink (destination exists → the unlink-first path runs).
        fs.writeFileSync(finalPath, 'existing');
        const unlinkAdapter = makeAdapter({ timeout: 80 });
        const realFs2 = unlinkAdapter.fs;
        unlinkAdapter.fs = {
          ...realFs2,
          promises: { ...realFs2.promises, unlink: () => new Promise(() => {}) }
        };
        const unlinkOutcome = await raceAgainstGuard(unlinkAdapter.writeFileAtomicallyNode(finalPath, 'contents'));
        assert.notEqual(unlinkOutcome, HUNG, 'a wedged unlink must not hang the run either');
        assert.match(unlinkOutcome.message, /timed out/i);
      } finally {
        console.log = originalLog;
      }
      assert.ok(
        lines.some((line) => line.includes('Shared storage fs op timed out')),
        'timed-out shared-root fs ops say so loudly'
      );
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('shared root: saveRunToSharedStorage writes the phone version-2 run JSON + log with YYYYMMDD-HHMMSS naming', async () => {
  const root = makeSharedRootFixture();
  try {
    await withSharedRootEnv(root, async () => {
      const adapter = makeAdapter();
      const circular = { name: 'loop' };
      circular.self = circular;
      const results = {
        totalEvents: 3,
        bearEvents: 2,
        calendarEvents: 0,
        errors: ['one error'],
        runContext: { type: 'manual', environment: 'node', trigger: 'node' },
        config: { config: { dryRun: true } },
        analyzedEvents: [{
          title: 'Test Bear Night',
          startDate: '2026-08-15T02:00:00.000Z',
          _action: 'new',
          _parserConfig: { name: 'p', parser: 'ai', dryRun: true, city: 'la', calendarSearchRangeDays: 2, urls: ['x'], hugeBlob: 'y' },
          onTap: () => {},
          circular
        }],
        bearDroppedEvents: [{ reason: 'not bear', _parserConfig: { big: true }, event: { title: 'Drop', _working: 'x' } }],
        parserResults: [{ name: 'p', bearEvents: 2, totalEvents: 3 }],
        calendarHygiene: []
      };

      const runId = await adapter.saveRunToSharedStorage(results, { logText: 'line one\nline two' });
      assert.match(runId, /^\d{8}-\d{6}$/, 'phone-format run id');
      assert.equal(results.savedRunId, runId);

      const runPath = path.join(root, 'runs', `${runId}.json`);
      const payload = JSON.parse(fs.readFileSync(runPath, 'utf8'));
      assert.equal(payload.version, 2, 'phone saved-run envelope version');
      assert.equal(payload.summary.runId, runId);
      assert.deepEqual(payload.summary.totals, { totalEvents: 3, bearEvents: 2, calendarEvents: 0, errors: 1 });
      assert.deepEqual(payload.summary.parserSummaries, [{ name: 'p', bearEvents: 2, totalEvents: 3 }]);
      const savedEvent = payload.analyzedEvents[0];
      assert.deepEqual(Object.keys(savedEvent._parserConfig).sort(),
        ['calendarSearchRangeDays', 'city', 'dryRun', 'name', 'parser'],
        'parser config slimmed exactly like the phone save');
      assert.equal(savedEvent.onTap, undefined, 'functions stripped');
      assert.equal(payload.bearDroppedEvents[0]._parserConfig, undefined);
      assert.equal(payload.bearDroppedEvents[0].event._working, undefined);

      const logPath = path.join(root, 'logs', `${runId}.log`);
      const logContent = fs.readFileSync(logPath, 'utf8');
      const [firstLine] = logContent.split('\n');
      assert.match(firstLine, /^\d{4}-\d{2}-\d{2}T.* - \{/, 'phone log summary first line');
      const summary = JSON.parse(firstLine.slice(firstLine.indexOf(' - ') + 3));
      assert.equal(summary.runId, runId);
      assert.deepEqual(summary.totals, { totalEvents: 3, bearEvents: 2, calendarEvents: 0, errors: 1 });
      assert.ok(logContent.includes('line one\nline two'), 'teed console lines persisted');

      const tmpLeftovers = [...fs.readdirSync(path.join(root, 'runs')), ...fs.readdirSync(path.join(root, 'logs'))]
        .filter((name) => name.includes('.tmp-'));
      assert.deepEqual(tmpLeftovers, [], 'run/log writes are atomic too');

      // FAILED run: the log (the evidence) is still written; no run JSON.
      const runsBefore = fs.readdirSync(path.join(root, 'runs')).length;
      const failedId = await adapter.saveRunToSharedStorage(null, { logText: 'boom trace', failure: 'pipeline exploded' });
      assert.match(failedId, /^\d{8}-\d{6}$/);
      assert.equal(fs.readdirSync(path.join(root, 'runs')).length, runsBefore, 'no run JSON for a failed run');
      const failedLog = fs.readFileSync(path.join(root, 'logs', `${failedId}.log`), 'utf8');
      assert.ok(failedLog.includes('pipeline exploded'));
      assert.ok(failedLog.includes('boom trace'));
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('shared root off: saveRunToSharedStorage is a no-op and page keys keep the existing local derivation', async () => {
  await withSharedRootEnv(undefined, async () => {
    const adapter = makeAdapter();
    assert.equal(adapter.sharedStorageRoot, null);
    assert.equal(await adapter.saveRunToSharedStorage({ totalEvents: 0 }, {}), null);
    // Local derivation (sorted query) is untouched for the local cache tree.
    const parts = adapter.getPageCachePathParts(DEVICE_PAGE_URL);
    assert.equal(parts.fileName, 'api__v1__events__search--q-10f5jmh.json');
  });
});

test('CHUNKY_RUN_AUTOMATION marks the run context as a scheduled automation run', async () => {
  const prev = process.env.CHUNKY_RUN_AUTOMATION;
  try {
    process.env.CHUNKY_RUN_AUTOMATION = '1';
    const context = makeAdapter().getRunContext();
    assert.equal(context.type, 'automated');
    assert.equal(context.trigger, 'scheduled');
    assert.equal(context.automationRun, true);

    delete process.env.CHUNKY_RUN_AUTOMATION;
    const manual = makeAdapter().getRunContext();
    assert.equal(manual.type, 'manual');
  } finally {
    if (prev === undefined) delete process.env.CHUNKY_RUN_AUTOMATION;
    else process.env.CHUNKY_RUN_AUTOMATION = prev;
  }
});

// ---------------------------------------------------------------------------
// PERSISTENT MANUAL BEAR VERDICTS — web/Node twin of the Scriptable store
// (wave 5): same bear-verdicts.json contract under the adapter's local state
// dir, so Mac-server runs honor the phone's stored verdicts when the file is
// synced there (and fail soft to an empty store everywhere else).
// ---------------------------------------------------------------------------

test('bear verdict store: web adapter round-trips bear-verdicts.json under its local state dir', async () => {
  const adapter = makeAdapter();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-verdicts-'));
  adapter.localStateDir = stateDir;
  try {
    assert.deepEqual(await adapter.loadBearVerdicts(), [], 'missing file → empty store');

    await adapter.saveBearVerdicts([{
      verdict: 'bear',
      stampedAt: '2026-08-12T04:20:00.000Z',
      title: 'MEAT RACK',
      venue: 'Eagle LA'
    }]);
    const loaded = await adapter.loadBearVerdicts();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].verdict, 'bear');
    assert.equal(loaded[0].title, 'MEAT RACK');

    // Corrupt file fails soft to an empty store, never throws.
    fs.writeFileSync(path.join(stateDir, 'bear-verdicts.json'), '{nope');
    assert.deepEqual(await adapter.loadBearVerdicts(), []);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Curated festival dataset (data/festivals.json) — injected like bars and
// promoters; on Node the repo checkout IS the deploy source.
// ---------------------------------------------------------------------------

test('loadConfiguration (Node) injects config.festivals from data/festivals.json', async () => {
  const adapter = new WebAdapter();
  const config = await adapter.loadConfiguration();
  assert.ok(Array.isArray(config.festivals), 'festivals is an array');
  assert.ok(config.festivals.length > 0, 'the curated dataset is non-empty');
  const beefdip = config.festivals.find((entry) => entry.key === 'beefdip-bear-week');
  assert.ok(beefdip, 'the curated BeefDip entry rides along');
  assert.equal(beefdip.cityKey, 'pv');
  assert.ok(beefdip.nextDates && beefdip.nextDates.start, 'nextDates survive the load');
});

test('refreshRemoteFestivals (Node) is an honest pass-through of the repo dataset', async () => {
  const adapter = new WebAdapter();
  const local = [{ key: 'beefdip-bear-week', name: 'BeefDip Bear Week' }];
  const result = await adapter.refreshRemoteFestivals(local);
  assert.deepEqual(result.festivals, local, 'the repo checkout is already current — no network');
  assert.deepEqual(result.counts, { remote: 0, localOnly: 1 });
  const empty = await adapter.refreshRemoteFestivals(null);
  assert.deepEqual(empty.festivals, [], 'a missing list normalizes to an empty array');
});

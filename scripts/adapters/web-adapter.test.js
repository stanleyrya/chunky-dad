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

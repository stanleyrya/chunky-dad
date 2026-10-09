const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SharedCore } = require('./shared-core');
const { parseSourceLedger, assessSourceHealth, SOURCE_VERDICT_ORDER } = require('./metrics-sections');
const { backfill, listRunFiles } = require('../tools/backfill-source-ledger');
const { WebAdapter } = require('./adapters/web-adapter');
// Headless load of the Scriptable adapter (same stubs its own test file uses).
global.importModule = (name) => require(path.join(__dirname, name));
global.Calendar = { forEvents: async () => [] };
global.Device = { isUsingDarkAppearance: () => false };
global.FileManager = { iCloud: () => ({ documentsDirectory: () => '/docs', joinPath: (a, b) => `${a}/${b}`, fileExists: () => false, createDirectory: () => {}, readString: () => null, writeString: () => {}, downloadFileFromiCloud: async () => {} }) };
const { ScriptableAdapter } = require('./adapters/scriptable-adapter');

// ---------------------------------------------------------------------------
// The source ledger: one line per run per website host, written by every run.
// The old metrics record was per parser and only the phone wrote it, so the
// Mac's daily scrapes (the real ones) never showed up anywhere.
// ---------------------------------------------------------------------------

function samplePayload(overrides = {}) {
  const event = (title, day, extra = {}) => ({
    title, startDate: `${day}T22:00:00.000Z`, bar: 'Eagle LA', city: 'la', timezone: 'America/Los_Angeles',
    website: `https://eaglela.com/events/${title.toLowerCase().replace(/\s+/g, '-')}/`, isBearEvent: true, ...extra
  });
  return {
    summary: { runId: '20261006-052536', timestamp: '2026-10-06T09:25:36.063Z' },
    runContext: { type: 'manual', environment: 'scriptable', trigger: 'owner-review', original: { type: 'automated', environment: 'node', trigger: 'scheduled' } },
    parserResults: [
      {
        name: 'Eagle LA', totalEvents: 4, durationMs: 1200,
        config: { urls: ['https://eaglela.com/events/', 'https://eaglela.com/calendar/'] },
        urlClassifications: { 'https://eaglela.com/events/': 'multi-event-page', 'https://eaglela.com/events/bluf/': 'event-page', 'https://www.eventbrite.com/e/123': 'event-page' },
        events: [event('BLUF LA', '2026-11-20'), event('Beer Bust', '2026-10-11'), event('Old Night', '2026-09-01'), event('Karaoke', '2026-10-12', { isBearEvent: false })]
      },
      {
        name: 'Dead Bar', totalEvents: 0, durationMs: 300, config: { urls: ['https://deadbar.example/calendar/'] }, urlClassifications: {}, events: []
      },
      {
        name: 'Quiet Bar', totalEvents: 0, durationMs: 100, config: { urls: ['https://quietbar.example/'] }, urlClassifications: { 'https://quietbar.example/': 'other' }, events: []
      }
    ],
    analyzedEvents: [
      { ...event('BLUF LA', '2026-11-20'), _action: 'merge' },
      { ...event('Beer Bust', '2026-10-11'), _action: 'new' },
      { title: 'Unattributed', startDate: '2026-10-20T00:00:00.000Z', website: 'https://elsewhere.example/x/y', _action: 'new' }
    ],
    errors: ['SYSTEM: Failed to process URL https://deadbar.example/calendar/: HTTP request failed: HTTP 522: ', 'SYSTEM: something else'],
    ...overrides
  };
}

test('buildSourceLedger: one line per host, attributed by the pages actually fetched, scrape context unwrapped from a phone re-save', () => {
  const built = SharedCore.buildSourceLedger(samplePayload(), { now: new Date('2026-10-06T12:00:00Z') });
  assert.deepEqual(built.records.map((r) => r.host), ['deadbar.example', 'eaglela.com', 'quietbar.example']);
  const eagle = built.records.find((r) => r.host === 'eaglela.com');
  assert.equal(eagle.run_id, '20261006-052536');
  assert.equal(eagle.environment, 'node', 'the scrape happened on the Mac even though the phone re-saved the run');
  assert.equal(eagle.trigger, 'scheduled');
  assert.deepEqual(eagle.parsers, ['Eagle LA']);
  assert.equal(eagle.pages, 2, 'two eaglela.com pages fetched');
  assert.equal(eagle.outbound_pages, 1, 'the eventbrite page is an outbound crawl, not this host');
  assert.equal(eagle.extracted, 4);
  assert.equal(eagle.events, 4);
  assert.equal(eagle.bear, 3);
  assert.equal(eagle.upcoming, 3, 'Old Night already happened');
  assert.deepEqual(eagle.proposals, { new: 1, merge: 1 });
  assert.equal(eagle.duration_ms, 1200);
  assert.equal(eagle.status, 'ok');
  assert.equal(eagle.page_errors, 0);
  const dead = built.records.find((r) => r.host === 'deadbar.example');
  assert.equal(dead.status, 'dead');
  assert.equal(dead.page_errors, 1);
  assert.match(dead.errors[0], /HTTP 522/);
  const quiet = built.records.find((r) => r.host === 'quietbar.example');
  assert.equal(quiet.status, 'empty');
  assert.deepEqual(Object.keys(built.upcoming.hosts).sort(), ['deadbar.example', 'eaglela.com', 'quietbar.example']);
  assert.equal(Object.keys(built.upcoming.hosts['eaglela.com'].upcoming).length, 3);
  assert.ok(built.upcoming.hosts['eaglela.com'].upcoming['bluf la|eagle la|2026-11-20'], 'keys are title|place|local day');
});

test('buildSourceLedger: a working site that yields nothing bear is ok, not empty', () => {
  const payload = samplePayload();
  payload.parserResults[0].events = [];
  const built = SharedCore.buildSourceLedger(payload, { now: new Date('2026-10-06T12:00:00Z') });
  const eagle = built.records.find((r) => r.host === 'eaglela.com');
  assert.equal(eagle.extracted, 4);
  assert.equal(eagle.events, 0);
  assert.equal(eagle.status, 'ok');
});

test('buildSourceLedger: vanished = upcoming last time, still in the future, missing now; a dead site keeps its previous snapshot', () => {
  const first = SharedCore.buildSourceLedger(samplePayload(), { now: new Date('2026-10-06T12:00:00Z') });
  const second = samplePayload({ summary: { runId: '20261007-052536', timestamp: '2026-10-07T09:25:36.063Z' } });
  second.parserResults[0].events = second.parserResults[0].events.filter((e) => e.title !== 'BLUF LA');
  second.parserResults[0].totalEvents = 3;
  const next = SharedCore.buildSourceLedger(second, { now: new Date('2026-10-07T12:00:00Z'), previousUpcoming: first.upcoming });
  const eagle = next.records.find((r) => r.host === 'eaglela.com');
  assert.deepEqual(eagle.vanished, [{ key: 'bluf la|eagle la|2026-11-20', title: 'BLUF LA', day: '2026-11-20', bear: true, last_seen: '20261006-052536' }]);
  assert.equal(next.upcoming.hosts['eaglela.com'].run_id, '20261007-052536');

  // The dead site had an upcoming snapshot from an earlier good run: keep it.
  const withDeadHistory = { ...first.upcoming, hosts: { ...first.upcoming.hosts, 'deadbar.example': { run_id: '20261001-000000', finished_at: '2026-10-01T00:00:00Z', upcoming: { 'x|deadbar|2026-12-01': { title: 'X', day: '2026-12-01', bear: true } } } } };
  const afterDead = SharedCore.buildSourceLedger(second, { now: new Date('2026-10-07T12:00:00Z'), previousUpcoming: withDeadHistory });
  const dead = afterDead.records.find((r) => r.host === 'deadbar.example');
  assert.equal(dead.status, 'dead');
  assert.deepEqual(dead.vanished, [], 'unreachable is not "the events went away"');
  assert.equal(afterDead.upcoming.hosts['deadbar.example'].run_id, '20261001-000000', 'the last good snapshot survives a dead run');

  // Hosts that did not run this time keep their snapshot too.
  const partial = samplePayload({ summary: { runId: '20261008-000000', timestamp: '2026-10-08T00:00:00Z' } });
  partial.parserResults = partial.parserResults.slice(0, 1);
  const afterPartial = SharedCore.buildSourceLedger(partial, { now: new Date('2026-10-08T12:00:00Z'), previousUpcoming: afterDead.upcoming });
  assert.equal(afterPartial.records.length, 1);
  assert.ok(afterPartial.upcoming.hosts['quietbar.example'], 'a host that did not run keeps its snapshot');
});

test('buildSourceLedger: a parser without configured urls is keyed by the majority host of its events, then by its name', () => {
  const payload = samplePayload();
  payload.parserResults = [
    { name: 'Shared pages', totalEvents: 2, config: {}, events: [
      { title: 'A', startDate: '2026-11-01T00:00:00Z', website: 'https://inbox.chunky.dad/page/a', isBearEvent: true },
      { title: 'B', startDate: '2026-11-02T00:00:00Z', website: 'https://inbox.chunky.dad/page/b', isBearEvent: true }
    ] },
    { name: 'Local Import', totalEvents: 0, config: {}, events: [] }
  ];
  payload.analyzedEvents = [];
  payload.errors = [];
  const built = SharedCore.buildSourceLedger(payload, { now: new Date('2026-10-06T12:00:00Z') });
  assert.deepEqual(built.records.map((r) => r.host), ['inbox.chunky.dad', 'local-import']);
});

test('assessSourceHealth: verdicts, trouble-first order, since, baseline', () => {
  const line = (host, runId, extracted, extra = {}) => ({
    v: 1, run_id: runId, finished_at: `2026-10-${runId.slice(6, 8)}T05:00:00Z`, host, parsers: [host], extracted, events: extracted, bear: extracted, upcoming: extracted, proposals: { new: 0, merge: 0 }, status: extracted > 0 ? 'ok' : 'empty', vanished: [], page_errors: 0, duration_ms: 10, ...extra
  });
  const records = [
    ...['20261001-050000', '20261002-050000', '20261003-050000', '20261004-050000'].map((id) => line('steady.example', id, 20)),
    line('steady.example', '20261005-050000', 21),
    ...['20261001-050000', '20261002-050000', '20261003-050000'].map((id) => line('stopped.example', id, 12)),
    line('stopped.example', '20261005-050000', 0),
    ...['20261001-050000', '20261002-050000', '20261003-050000'].map((id) => line('shrunk.example', id, 30)),
    line('shrunk.example', '20261004-050000', 9),
    line('shrunk.example', '20261005-050000', 8),
    line('dead.example', '20261004-050000', 15),
    line('dead.example', '20261005-050000', 0, { status: 'dead', page_errors: 2, errors: ['HTTP 403'] }),
    line('never.example', '20261004-050000', 0),
    line('never.example', '20261005-050000', 0),
    line('gone.example', '20261005-050000', 9, { vanished: [{ key: 'k', title: 'Gone Night', day: '2026-11-01', bear: true, last_seen: '20261004-050000' }] }),
    line('old.example', '20260925-050000', 5, { finished_at: '2026-09-25T05:00:00Z' }),
    // The club's website next to its ticketing feed: the parser reads both,
    // the feed answers (South Seattle Bear Social, 2026-10-07).
    ...['20261004-050000', '20261005-050000'].map((id) => line('feed.example', id, 13, { parsers: ['Club'] })),
    ...['20261004-050000', '20261005-050000'].map((id) => line('site.example', id, 0, { parsers: ['Club'] })),
    // Same shape, but the feed's latest line is an OLDER run: no alibi.
    line('lagfeed.example', '20261004-050000', 9, { parsers: ['Lag'] }),
    ...['20261004-050000', '20261005-050000'].map((id) => line('lagsite.example', id, 0, { parsers: ['Lag'] }))
  ];
  const health = assessSourceHealth(records, { now: new Date('2026-10-05T12:00:00Z') });
  const verdictOf = (host) => health.rows.find((r) => r.host === host);
  assert.equal(verdictOf('steady.example').verdict, 'ok');
  assert.equal(verdictOf('steady.example').baseline, 20);
  assert.equal(verdictOf('stopped.example').verdict, 'stopped');
  assert.equal(verdictOf('stopped.example').since, '20261005-050000');
  assert.equal(verdictOf('shrunk.example').verdict, 'shrunk');
  assert.equal(verdictOf('shrunk.example').since, '20261004-050000', 'trouble began the first run under half the baseline');
  assert.equal(verdictOf('dead.example').verdict, 'dead');
  assert.equal(verdictOf('never.example').verdict, 'empty');
  assert.equal(verdictOf('gone.example').verdict, 'vanished');
  assert.equal(verdictOf('old.example').verdict, 'quiet');
  assert.equal(verdictOf('site.example').verdict, 'companion');
  assert.deepEqual(verdictOf('site.example').companionOf, ['feed.example']);
  assert.equal(verdictOf('site.example').since, null);
  assert.equal(verdictOf('feed.example').verdict, 'ok');
  assert.equal(verdictOf('lagsite.example').verdict, 'empty', 'a sibling that answered in an older run is no alibi for this run');
  assert.equal(verdictOf('lagfeed.example').verdict, 'ok');
  assert.deepEqual(health.rows.map((r) => r.verdict), ['dead', 'stopped', 'shrunk', 'empty', 'empty', 'vanished', 'quiet', 'companion', 'ok', 'ok', 'ok']);
  assert.deepEqual([...new Set(health.rows.map((r) => r.verdict))], SOURCE_VERDICT_ORDER.filter((verdict) => verdict !== 'lost'), 'no line in this fixture carries losses');
  assert.equal(health.troubled, 7, 'companion is not trouble');
  assert.equal(health.hosts, 11);
  assert.equal(verdictOf('steady.example').series.length, 5);
});

// ---------------------------------------------------------------------------
// Lost: expected future events gone. Identity is title|day (place-insensitive),
// expected = seen upcoming in ≥2 of the last 4 ok runs, confirmed = missing
// from 2 consecutive ok runs, grouped per series; a rename on the same day +
// place is a match; listing ≥3 → 0 while extracting is immediate.
// ---------------------------------------------------------------------------

const upcomingOf = (entries) => Object.fromEntries(entries.map(([title, day, extra]) => [
  `${title.toLowerCase()}|${(extra && extra.place) || 'eagle la'}|${day}`,
  { title, day, bear: !(extra && extra.notBear) }
]));
const pigDays = ['2026-10-11', '2026-10-18', '2026-10-25'];
const okRun = (runId, entries, extra = {}) => ({ runId, status: 'ok', todayKey: '2026-10-07', extracted: 98, upcomingKeys: upcomingOf(entries), ...extra });
const fullList = [...pigDays.map((day) => ['Bearded Pig Disco', day]), ['Club Chub', '2026-10-18'], ['Beer Bust', '2026-10-12', { notBear: true }]];

test('advanceSourceLoss: first miss is suspected, the second confirms, grouped per series, bear first; a return clears it', () => {
  let state = null;
  ['r1', 'r2', 'r3'].forEach((runId) => { state = SharedCore.advanceSourceLoss(state, okRun(runId, fullList)).state; });
  assert.equal(state.history.length, 3);
  const without = fullList.filter(([title]) => title !== 'Bearded Pig Disco');
  const miss1 = SharedCore.advanceSourceLoss(state, okRun('r4', without));
  assert.equal(miss1.suspected, 3);
  assert.deepEqual(miss1.lost, [], 'one miss is a suspicion, not a loss');
  assert.equal(miss1.state.history.length, 4, 'the window keeps four ok runs');
  const miss2 = SharedCore.advanceSourceLoss(miss1.state, okRun('r5', without));
  assert.equal(miss2.suspected, 0);
  assert.deepEqual(miss2.lost, [{ title: 'Bearded Pig Disco', bear: true, since: 'r5', seen: 3, days: pigDays, new: 3 }]);
  assert.equal(miss2.lost_new, 3);
  const still = SharedCore.advanceSourceLoss(miss2.state, okRun('r6', without));
  assert.equal(still.lost[0].new, 0, 'already confirmed: not new again');
  assert.equal(still.lost[0].since, 'r5');
  const back = SharedCore.advanceSourceLoss(still.state, okRun('r7', fullList));
  assert.deepEqual(back.lost, [], 'seen again → no longer lost');
  // Expected needs ≥2 sightings: a one-run fragment that disappears is nothing.
  const fragment = SharedCore.advanceSourceLoss(back.state, okRun('r8', [...fullList, ['View Event →', '2026-11-04']]));
  const gone = SharedCore.advanceSourceLoss(fragment.state, okRun('r9', fullList));
  const gone2 = SharedCore.advanceSourceLoss(gone.state, okRun('r10', fullList));
  assert.equal(gone.suspected, 0);
  assert.deepEqual(gone2.lost, []);
});

test('advanceSourceLoss: place changes and same-day renames are matches, not losses; a dead run neither confirms nor clears; past days drop out', () => {
  let state = null;
  ['r1', 'r2'].forEach((runId) => { state = SharedCore.advanceSourceLoss(state, okRun(runId, fullList)).state; });
  // Bar enrichment moved the place token: identity is title|day, so nothing is missing.
  const moved = fullList.map(([title, day, extra]) => [title, day, { ...(extra || {}), place: 'the yard 9 bob note' }]);
  const afterMove = SharedCore.advanceSourceLoss(state, okRun('r3', moved));
  assert.equal(afterMove.suspected, 0);
  // A brand prefix on the same day + place overlaps ≥60% of the tokens: a rename.
  const renamed = moved.map(([title, day, extra]) => [title === 'Club Chub' ? 'Club Chub Los Angeles' : title, day, extra]);
  const afterRename = SharedCore.advanceSourceLoss(afterMove.state, okRun('r4', renamed));
  assert.equal(afterRename.suspected, 0);
  // Two misses, but the second run was dead: still only suspected.
  const without = moved.filter(([title]) => title !== 'Club Chub');
  const miss1 = SharedCore.advanceSourceLoss(afterRename.state, okRun('r5', without));
  assert.equal(miss1.suspected, 1);
  const dead = SharedCore.advanceSourceLoss(miss1.state, { runId: 'r6', status: 'dead', todayKey: '2026-10-07', extracted: 0, upcomingKeys: {} });
  assert.deepEqual(dead.lost, []);
  assert.equal(dead.suspected, 0);
  assert.equal(dead.state.history.length, miss1.state.history.length, 'a dead run is not in the window');
  const miss2 = SharedCore.advanceSourceLoss(dead.state, okRun('r7', without));
  assert.equal(miss2.lost.length, 1);
  assert.equal(miss2.lost[0].title, 'Club Chub');
  // The day passes: the loss is no longer a future event.
  const later = SharedCore.advanceSourceLoss(miss2.state, { ...okRun('r8', without), todayKey: '2026-10-19' });
  assert.deepEqual(later.lost, []);
});

test('advanceSourceLoss: listing gone (upcoming ≥3 → 0 while still extracting) is immediate', () => {
  let state = null;
  ['r1', 'r2'].forEach((runId) => { state = SharedCore.advanceSourceLoss(state, okRun(runId, fullList)).state; });
  const empty = SharedCore.advanceSourceLoss(state, okRun('r3', [], { extracted: 99 }));
  assert.equal(empty.listing_gone, true);
  assert.equal(empty.suspected, 5);
  const back = SharedCore.advanceSourceLoss(empty.state, okRun('r4', fullList));
  assert.equal(back.listing_gone, false);
  assert.deepEqual(back.lost, [], 'a one-run page miss that came back');
  const nothing = SharedCore.advanceSourceLoss(back.state, okRun('r5', [], { extracted: 0 }));
  assert.equal(nothing.listing_gone, false, 'extracted 0 is stopped/empty, not a listing that vanished');
});

test('buildSourceLedger: lines carry aggregator, url, lost, suspected and listing_gone; the snapshot keeps the four-run window; aggregators from siteRole', () => {
  const payloadAt = (runId, day, titles) => {
    const payload = samplePayload({ summary: { runId, timestamp: `${day}T09:25:36.063Z` } });
    payload.parserResults[0].events = payload.parserResults[0].events.filter((e) => titles.includes(e.title));
    payload.parserResults[0].totalEvents = payload.parserResults[0].events.length;
    payload.parserResults.push({ name: 'The Bear Calendar', totalEvents: 2, config: { urls: ['https://thebearcalendar.com/events/'], siteRole: 'aggregator' }, urlClassifications: {}, events: [
      { title: 'Furry Friday', startDate: '2026-11-06T22:00:00.000Z', bar: 'Somewhere', website: 'https://thebearcalendar.com/event/furry', isBearEvent: true }
    ] });
    return payload;
  };
  const all = ['BLUF LA', 'Beer Bust', 'Old Night', 'Karaoke'];
  let upcoming = null;
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
  const lists = [all, all, all.filter((t) => t !== 'BLUF LA'), all.filter((t) => t !== 'BLUF LA'), all];
  const records = [];
  days.forEach((day, index) => {
    const built = SharedCore.buildSourceLedger(payloadAt(`${day.replace(/-/g, '')}-052536`, day, lists[index]), { now: new Date(`${day}T12:00:00Z`), previousUpcoming: upcoming });
    upcoming = built.upcoming;
    records.push(built.records.find((r) => r.host === 'eaglela.com'));
  });
  assert.equal(records[0].aggregator, false);
  assert.equal(records[0].url, 'https://eaglela.com/events/');
  assert.deepEqual(records[0].lost, []);
  assert.equal(records[2].suspected, 1, 'first miss of BLUF LA');
  assert.deepEqual(records[2].lost, []);
  assert.deepEqual(records[3].lost, [{ title: 'BLUF LA', bear: true, since: '20261004-052536', seen: 2, days: ['2026-11-20'], new: 1 }]);
  assert.equal(records[3].listing_gone, false);
  assert.deepEqual(records[4].lost, [], 'back on the page');
  assert.equal(upcoming.version, 2);
  assert.equal(upcoming.hosts['eaglela.com'].history.length, 4);
  assert.ok(upcoming.hosts['eaglela.com'].upcoming['bluf la|eagle la|2026-11-20'], 'the old upcoming map is still there for vanished');
  const aggregatorLine = SharedCore.buildSourceLedger(payloadAt('20261006-052536', '2026-10-06', all), { now: new Date('2026-10-06T12:00:00Z'), previousUpcoming: upcoming }).records.find((r) => r.host === 'thebearcalendar.com');
  assert.equal(aggregatorLine.aggregator, true);
  // A version-1 snapshot (upcoming only) still feeds vanished and seeds the window.
  const legacy = { version: 1, run_id: '20261006-052536', hosts: { 'eaglela.com': { run_id: '20261006-052536', finished_at: '2026-10-06T09:25:36.063Z', upcoming: upcoming.hosts['eaglela.com'].upcoming } } };
  const fromLegacy = SharedCore.buildSourceLedger(payloadAt('20261007-052536', '2026-10-07', all.filter((t) => t !== 'BLUF LA')), { now: new Date('2026-10-07T12:00:00Z'), previousUpcoming: legacy });
  const line = fromLegacy.records.find((r) => r.host === 'eaglela.com');
  assert.equal(line.vanished.length, 1);
  assert.equal(line.suspected, 0, 'one prior sighting is not yet an expectation');
  assert.equal(fromLegacy.upcoming.hosts['eaglela.com'].history.length, 1);
});

test('buildSourceLedger: the quality block — completeness of the kept set, flags by code, the bear funnel with its top reason, dedup, stability vs the previous ok run, horizon incl. dropped, runs since new, errors by class, merge churn', () => {
  const payload = samplePayload();
  const eagle = payload.parserResults[0];
  eagle.duplicatesRemoved = 2;
  eagle.events = [
    { title: 'BLUF LA', startDate: '2026-11-20T22:00:00.000Z', bar: 'Eagle LA', location: '34.1, -118.2', website: 'https://eaglela.com/events/bluf/', image: 'https://x/1.jpg', description: 'leather', timezone: 'America/Los_Angeles', isBearEvent: true },
    { title: 'Beer Bust', startDate: '2026-10-11T22:00:00.000Z', bar: 'Eagle LA', website: 'https://eaglela.com/events/bust/', timezone: 'America/Los_Angeles', isBearEvent: true, timeUnknown: true },
    { title: 'Karaoke', startDate: '2026-10-12T22:00:00.000Z', website: 'https://eaglela.com/events/karaoke/', timezone: 'America/Los_Angeles', isBearEvent: false, allDay: true },
    { title: 'Old Night', startDate: '2026-09-01T22:00:00.000Z', bar: 'Eagle LA', website: 'https://eaglela.com/events/old/', timezone: 'America/Los_Angeles', isBearEvent: true }
  ];
  eagle.totalEvents = 6;
  payload.bearDroppedEvents = [
    { title: 'Trivia', startDate: '2027-01-15T03:00:00.000Z', host: 'www.eaglela.com', reason: 'ai: nothing bear about trivia', event: { title: 'Trivia', startDate: '2027-01-15T03:00:00.000Z', timezone: 'America/Los_Angeles', website: 'https://eaglela.com/events/trivia/' } },
    { title: 'Drag', startDate: '2026-10-20T03:00:00.000Z', host: 'eaglela.com', reason: 'manual store: not_bear (verdict stamped 2026-10-06)', event: { title: 'Drag', startDate: '2026-10-20T03:00:00.000Z', timezone: 'America/Los_Angeles', website: 'https://eaglela.com/events/drag/' } },
    { title: 'Elsewhere', startDate: '2026-10-20T03:00:00.000Z', host: 'nowhere.example', reason: 'ai: x', event: { title: 'Elsewhere', website: 'https://nowhere.example/a' } }
  ];
  payload.analyzedEvents = [
    { title: 'BLUF LA', startDate: '2026-11-20T22:00:00.000Z', bar: 'Eagle LA', timezone: 'America/Los_Angeles', website: 'https://eaglela.com/events/bluf/', _action: 'merge', _changes: ['title', 'notes'], _sanityFlags: [{ code: 'flyer-time-conflict', detail: 'x' }] },
    { title: 'Beer Bust', startDate: '2026-10-11T22:00:00.000Z', bar: 'Eagle LA', timezone: 'America/Los_Angeles', website: 'https://eaglela.com/events/bust/', _action: 'merge', _changes: ['notes'], _sanityFlags: ['weekday-derived-date'] },
    { title: 'Karaoke', startDate: '2026-10-12T22:00:00.000Z', timezone: 'America/Los_Angeles', website: 'https://eaglela.com/events/karaoke/', _action: 'new', _sanityFlags: [{ code: 'flyer-time-conflict' }] }
  ];
  payload.errors = ['SYSTEM: Failed to process URL https://eaglela.com/events/: HTTP request failed: HTTP 522: ', 'SYSTEM: Failed to process URL https://eaglela.com/calendar/: fetch failed', 'SYSTEM: Failed to process URL https://deadbar.example/calendar/: HTTP request failed: HTTP 403: '];
  const first = SharedCore.buildSourceLedger(payload, { now: new Date('2026-10-06T12:00:00Z') });
  const q = first.records.find((r) => r.host === 'eaglela.com').quality;
  assert.equal(q.n, 4);
  assert.equal(q.time, 50, 'timeUnknown and allDay are not a time');
  assert.equal(q.place, 75);
  assert.equal(q.coords, 25);
  assert.equal(q.url, 100);
  assert.equal(q.image, 25);
  assert.equal(q.desc, 25);
  assert.deepEqual(q.flags, { 'flyer-time-conflict': 2, 'weekday-derived-date': 1 });
  assert.deepEqual(q.bear, { extracted: 6, kept: 3, ai_dropped: 1, manual_dropped: 1, top_reason: 'ai: nothing bear about trivia' });
  assert.deepEqual(q.dedup, { removed: 2, pct: 25 });
  assert.equal(q.stability, null, 'no previous run yet');
  assert.equal(q.horizon_days, 100, 'the AI-dropped trivia on 2027-01-14 local is the furthest extracted event');
  assert.equal(q.runs_since_new, 0, 'a NEW proposal this run');
  assert.deepEqual(q.errors, { 'http-5xx': 1, transport: 1 }, 'the dead bar’s 403 is not this host’s');
  assert.deepEqual(q.churn, { merges: 2, changed: 1, fields: { title: 1 } });
  const deadQ = first.records.find((r) => r.host === 'deadbar.example').quality;
  assert.deepEqual(deadQ.errors, { 'http-4xx': 1 });
  assert.equal(deadQ.n, 0);
  assert.equal(deadQ.time, null, 'no kept events → no share');
  // Next run: the same kept set minus one → stability 75%, nothing new → runs since new climbs.
  const second = samplePayload({ summary: { runId: '20261007-052536', timestamp: '2026-10-07T09:25:36.063Z' } });
  second.parserResults[0].events = eagle.events.filter((e) => e.title !== 'Karaoke');
  second.analyzedEvents = [];
  second.bearDroppedEvents = [];
  second.errors = [];
  const next = SharedCore.buildSourceLedger(second, { now: new Date('2026-10-07T12:00:00Z'), previousUpcoming: first.upcoming });
  const q2 = next.records.find((r) => r.host === 'eaglela.com').quality;
  assert.equal(q2.stability, 75);
  assert.equal(q2.runs_since_new, 1);
  assert.deepEqual(q2.errors, {});
  assert.equal(next.upcoming.hosts['eaglela.com'].keys.length, 3, 'the kept identities ride in the snapshot');
  assert.equal(next.upcoming.hosts['eaglela.com'].runs_since_new, 1);
});

test('parseSourceLedger tolerates torn lines', () => {
  const records = parseSourceLedger('{"host":"a.example","run_id":"1"}\n{"host":"b.exam\n\n{"nohost":true}\n{"host":"c.example"}\n');
  assert.deepEqual(records.map((r) => r.host), ['a.example', 'c.example']);
});

test('backfill rebuilds the ledger from runs/ and archive/runs/, oldest first, live copy winning over an archived twin', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-ledger-'));
  fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'archive', 'runs'), { recursive: true });
  const first = samplePayload();
  const second = samplePayload({ summary: { runId: '20261007-052536', timestamp: '2026-10-07T09:25:36.063Z' } });
  second.parserResults[0].events = second.parserResults[0].events.filter((e) => e.title !== 'BLUF LA');
  fs.writeFileSync(path.join(root, 'archive', 'runs', '20261006-052536.json'), JSON.stringify({ ...first, parserResults: [] }));
  fs.writeFileSync(path.join(root, 'runs', '20261006-052536.json'), JSON.stringify(first));
  fs.writeFileSync(path.join(root, 'runs', '20261007-052536.json'), JSON.stringify(second));
  fs.writeFileSync(path.join(root, 'runs', 'notes.txt'), 'ignored');
  assert.deepEqual(listRunFiles(root).map(([id, file]) => [id, path.relative(root, file)]), [
    ['20261006-052536', path.join('runs', '20261006-052536.json')],
    ['20261007-052536', path.join('runs', '20261007-052536.json')]
  ]);
  const logs = [];
  const result = backfill(root, { log: (line) => logs.push(line) });
  assert.equal(result.runs.length, 2);
  const records = parseSourceLedger(fs.readFileSync(path.join(root, 'metrics', 'sources.ndjson'), 'utf8'));
  assert.equal(records.length, 6);
  const secondEagle = records.find((r) => r.run_id === '20261007-052536' && r.host === 'eaglela.com');
  assert.equal(secondEagle.vanished.length, 1, 'vanished is derived run over run during the backfill');
  const upcoming = JSON.parse(fs.readFileSync(path.join(root, 'metrics', 'source-upcoming.json'), 'utf8'));
  assert.equal(upcoming.run_id, '20261007-052536');
  assert.match(logs[logs.length - 1], /wrote 6 line/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('WebAdapter.appendSourceLedger writes the ledger + snapshot under the shared root and is idempotent per run id', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-ledger-web-'));
  const adapter = new WebAdapter({});
  adapter.isNode = true;
  adapter.sharedStorageRoot = root;
  adapter.fs = fs;
  adapter.path = path;
  const payload = samplePayload();
  const built = await adapter.appendSourceLedger(payload, '20261006-052536');
  assert.equal(built.records.length, 3);
  const ledgerPath = path.join(root, 'metrics', 'sources.ndjson');
  assert.equal(parseSourceLedger(fs.readFileSync(ledgerPath, 'utf8')).length, 3);
  assert.ok(fs.existsSync(path.join(root, 'metrics', 'source-upcoming.json')));
  const again = await adapter.appendSourceLedger(payload, '20261006-052536');
  assert.equal(again, null, 'a phone execute re-saving the same run adds nothing');
  assert.equal(parseSourceLedger(fs.readFileSync(ledgerPath, 'utf8')).length, 3);
  const next = samplePayload({ summary: { runId: '20261007-052536', timestamp: '2026-10-07T09:25:36.063Z' } });
  next.parserResults[0].events = next.parserResults[0].events.filter((e) => e.title !== 'BLUF LA');
  await adapter.appendSourceLedger(next, '20261007-052536');
  const records = parseSourceLedger(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(records.length, 6);
  assert.equal(records.find((r) => r.run_id === '20261007-052536' && r.host === 'eaglela.com').vanished.length, 1, 'the second write reads the snapshot the first one left');
  fs.rmSync(root, { recursive: true, force: true });
});

test('ScriptableAdapter.appendSourceLedger writes through the file manager and is idempotent per run id', async () => {
  const adapter = new ScriptableAdapter({ cities: {} });
  const files = new Map();
  adapter.fm = {
    documentsDirectory: () => '/docs', joinPath: (a, b) => `${a}/${b}`,
    fileExists: (p) => files.has(p), isDirectory: () => false, createDirectory: () => {},
    readString: (p) => (files.has(p) ? files.get(p) : null), writeString: (p, s) => { files.set(p, s); },
    downloadFileFromiCloud: async () => {}
  };
  adapter.metricsDir = '/docs/chunky-dad-data/metrics';
  const payload = samplePayload();
  const built = await adapter.appendSourceLedger(payload, '20261006-052536');
  assert.equal(built.records.length, 3);
  assert.equal(parseSourceLedger(files.get('/docs/chunky-dad-data/metrics/sources.ndjson')).length, 3);
  assert.ok(files.get('/docs/chunky-dad-data/metrics/source-upcoming.json'));
  assert.equal(await adapter.appendSourceLedger(payload, '20261006-052536'), null);
  assert.equal(parseSourceLedger(files.get('/docs/chunky-dad-data/metrics/sources.ndjson')).length, 3);
});

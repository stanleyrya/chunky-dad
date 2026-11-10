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
  assert.deepEqual([...new Set(health.rows.map((r) => r.verdict))], SOURCE_VERDICT_ORDER.filter((verdict) => verdict !== 'lost' && verdict !== 'drift' && verdict !== 'sparse'), 'no line in this fixture carries losses, drift or a quality block');
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

// Door rows (DICE, Elfsight, Wix …) carry a ticketing host as their link; the
// page they were read off says whose they are.
test('buildSourceLedger: an event is attributed to the page it was read off when that page is one of the parser\'s hosts', () => {
  const payload = samplePayload({
    parserResults: [{
      name: 'Venue', totalEvents: 2, durationMs: 100, config: { urls: ['https://venue.example/'] }, urlClassifications: { 'https://venue.example/': 'multi-event-page', 'https://venue.example/events': 'multi-event-page' },
      events: [
        { title: 'Bear Belly', startDate: '2026-10-20T00:00:00.000Z', website: 'https://link.dice.fm/abc', ticketUrl: 'https://link.dice.fm/abc', _sourcePageUrl: 'https://venue.example/events', isBearEvent: true },
        { title: 'Elsewhere', startDate: '2026-10-21T00:00:00.000Z', website: 'https://other.example/x', isBearEvent: true }
      ]
    }],
    analyzedEvents: []
  });
  const built = SharedCore.buildSourceLedger(payload, { now: new Date('2026-10-06T12:00:00Z') });
  const venue = built.records.find((r) => r.host === 'venue.example');
  assert.equal(venue.events, 2, 'both rows land on the venue: one by the page it was read off, one by the parser\'s primary host');
});

// ---------------------------------------------------------------------------
// Host signals, drift, and "gone from its source" (2026-10-17): what a host
// gave besides rows, the verdict when a signal collapses, and the report-only
// candidates for saved events a first-party source no longer lists.
// ---------------------------------------------------------------------------

function signalsPayload(extractionSource) {
  const payload = samplePayload();
  payload.analyzedEvents = payload.analyzedEvents.map((event) => (event.website && event.website.includes('eaglela.com') ? { ...event, _extractionSource: extractionSource } : event));
  return payload;
}

test('buildSourceLedger: per-host signals (structured vs AI route, pages) ride on the line and in the state; a structured door that collapses to nothing is DRIFT, and the health verdict says so', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  const structured = SharedCore.buildSourceLedger(signalsPayload('jsonld'), { now });
  const eagle = structured.records.find((r) => r.host === 'eaglela.com');
  assert.deepEqual(eagle.signals, { structured: 2, ai: 0, pages: 2, extracted: 4 });
  assert.deepEqual(eagle.drift, [], 'no history yet — nothing to drift from');
  assert.equal(structured.upcoming.hosts['eaglela.com'].signals_history.length, 1, 'the state remembers this run\'s signals');

  // Three ok runs through the JSON-LD door, then a run read by the AI route only.
  const history = { hosts: { 'eaglela.com': { ...structured.upcoming.hosts['eaglela.com'], signals_history: [eagle.signals, eagle.signals, eagle.signals] } } };
  const collapsed = SharedCore.buildSourceLedger(signalsPayload('ai'), { now, previousUpcoming: history });
  const after = collapsed.records.find((r) => r.host === 'eaglela.com');
  assert.deepEqual(after.signals, { structured: 0, ai: 2, pages: 2, extracted: 4 });
  assert.deepEqual(after.drift, [{ signal: 'structured', before: 2, now: 0 }].filter(() => false).concat([]), 'a median of 2 is under the floor of 3 — one small host\'s two rows are not a door');
  const bigger = { hosts: { 'eaglela.com': { ...history.hosts['eaglela.com'], signals_history: [{ structured: 6, ai: 0, pages: 2, extracted: 6 }, { structured: 5, ai: 0, pages: 2, extracted: 5 }, { structured: 7, ai: 1, pages: 2, extracted: 8 }] } } };
  const drifted = SharedCore.buildSourceLedger(signalsPayload('ai'), { now, previousUpcoming: bigger });
  const row = drifted.records.find((r) => r.host === 'eaglela.com');
  assert.deepEqual(row.drift, [{ signal: 'structured', before: 6, now: 0 }]);
  assert.equal(drifted.upcoming.hosts['eaglela.com'].signals_history.length, 4);
  const health = assessSourceHealth([...bigger.hosts['eaglela.com'].signals_history.map((signals, index) => ({ ...row, run_id: `2026100${index + 1}-050000`, finished_at: `2026-10-0${index + 1}T05:00:00Z`, drift: [], signals })), row], { now });
  assert.equal(health.rows.find((r) => r.host === 'eaglela.com').verdict, 'drift');
  assert.ok(SOURCE_VERDICT_ORDER.indexOf('drift') > SOURCE_VERDICT_ORDER.indexOf('shrunk') && SOURCE_VERDICT_ORDER.indexOf('drift') < SOURCE_VERDICT_ORDER.indexOf('lost'));
  assert.ok(SOURCE_VERDICT_ORDER.indexOf('sparse') > SOURCE_VERDICT_ORDER.indexOf('shrunk') && SOURCE_VERDICT_ORDER.indexOf('sparse') < SOURCE_VERDICT_ORDER.indexOf('drift'), 'sparse sits after shrunk (volume first) and before drift');
});

test('buildSourceLedger: the gone-from-source streak state rides in source-upcoming.json — the run that checked carries the new state, any other run carries the previous one', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  const previousUpcoming = { hosts: {}, gone: { la: { 'uid-1': { title: 'Old', day: '2026-10-20', misses: 1 } } } };
  const carried = SharedCore.buildSourceLedger(samplePayload(), { now, previousUpcoming });
  assert.deepEqual(carried.upcoming.gone, previousUpcoming.gone);
  const checked = SharedCore.buildSourceLedger(samplePayload({ goneFromSource: { candidates: [], state: { la: { 'uid-2': { title: 'New', day: '2026-10-21', misses: 2 } } }, summary: {} } }), { now, previousUpcoming });
  assert.deepEqual(Object.keys(checked.upcoming.gone.la), ['uid-2']);
});

test('buildGoneFromSourceCandidates: a saved event pointing into a site a first-party source read, that nothing matched, is a miss; the second miss is a card with what the site lists instead — matched, beyond-horizon, series, thin-read and unattributed records never are', () => {
  const { EventSchema } = require('./event-schema');
  const core = new SharedCore({ la: { timezone: 'America/Los_Angeles', patterns: ['la'] } }, { eventSchema: EventSchema });
  const site = (title, day, extra = {}) => ({ title, startDate: `${day}T05:00:00.000Z`, bar: 'Eagle LA', city: 'la', timezone: 'America/Los_Angeles', website: `https://eaglela.com/events/${title.toLowerCase().replace(/\s+/g, '-')}/`, isBearEvent: true, ...extra });
  const parserResults = [{
    name: 'Eagle LA', totalEvents: 3, config: { name: 'Eagle LA', urls: ['https://eaglela.com/events/'] },
    urlClassifications: { 'https://eaglela.com/events/': 'multi-event-page' },
    events: [site('BLUF LA', '2026-10-24'), site('Underwear Night Party', '2026-10-25', { bar: 'Precinct DTLA' }), site('Bear Night', '2026-11-20')]
  }];
  const saved = (uid, title, day, extra = {}) => ({
    identifier: `cal:${uid}`, title, startDate: new Date(`${day}T05:00:00.000Z`), endDate: new Date(`${day}T09:00:00.000Z`), location: '34.0, -118.0',
    notes: `bar: Eagle LA\naddress: 4219 Santa Monica Blvd\nwebsite: https://eaglela.com/events/${title.toLowerCase().replace(/\s+/g, '-')}/`, url: '', isAllDay: false, ...extra
  });
  const savedByCity = { la: { events: [
    saved('A', 'BLUF LA', '2026-10-24'),
    saved('B', 'Underwear Night', '2026-10-25'),
    saved('C', 'Far Future Party', '2026-12-31'),
    saved('D', 'Weekly Beer Bust', '2026-10-26', { series: true }),
    saved('E', 'Elsewhere Party', '2026-10-27', { notes: 'bar: Other Bar\nwebsite: https://elsewhere.example/party/' }),
    saved('F', 'Already Happened', '2026-09-01')
  ] } };
  const results = { parserResults, analyzedEvents: [{ ...site('BLUF LA', '2026-10-24'), _action: 'merge', _existingEvent: { identifier: 'cal:A', title: 'BLUF LA' } }] };
  const now = new Date('2026-10-06T12:00:00Z');

  const first = core.buildGoneFromSourceCandidates(results, savedByCity, { now });
  assert.equal(first.candidates.length, 0, 'one miss is not a card');
  assert.deepEqual(first.state.la.B && { misses: first.state.la.B.misses, day: first.state.la.B.day, host: first.state.la.B.host }, { misses: 1, day: '2026-10-24', host: 'eaglela.com' });
  assert.equal(first.state.la.A, undefined, 'the matched saved event has no streak');
  assert.equal(first.state.la.C, undefined, 'beyond the furthest night the source showed — outside its statement');
  assert.equal(first.state.la.D, undefined, 'a series occurrence is never a candidate');
  assert.equal(first.state.la.E, undefined, 'a site nobody read this run covers nothing');
  assert.deepEqual({ saved: first.summary.saved, attributed: first.summary.attributed, seen: first.summary.seen, firstMisses: first.summary.firstMisses, beyondHorizon: first.summary.beyondHorizon, series: first.summary.series },
    { saved: 5, attributed: 3, seen: 1, firstMisses: 1, beyondHorizon: 1, series: 1 });

  const second = core.buildGoneFromSourceCandidates(results, savedByCity, { now: new Date('2026-10-07T12:00:00Z'), previousUpcoming: { hosts: {}, gone: first.state } });
  assert.equal(second.candidates.length, 1);
  const card = second.candidates[0];
  assert.equal(card.key, 'gone|la|B');
  assert.equal(card.kind, 'gone');
  assert.equal(card.misses, 2);
  assert.equal(card.uid, 'B');
  assert.equal(card.identifier, 'cal:B');
  assert.equal(card.host, 'eaglela.com');
  assert.equal(card.source, 'Eagle LA');
  assert.equal(card.horizonDay, '2026-11-19', 'local day of the furthest night the source showed');
  assert.equal(card.bar, 'Eagle LA');
  assert.equal(card.instead.sameNight.length, 1, 'the site lists one thing that night');
  assert.equal(card.instead.sameNight[0].title, 'Underwear Night Party');
  assert.equal(card.instead.sameNight[0].samePlace, false);
  assert.equal(card.reason, 'moved', 'similar name at another place that night: the event moved (or the saved place is wrong)');

  // The site lists it at the SAME place and the run gave that row to another
  // saved record: this one is the extra copy — a duplicate card.
  const twinSite = { parserResults: [{ ...parserResults[0], events: [site('BLUF LA', '2026-10-24'), site('Underwear Night', '2026-10-25'), site('Bear Night', '2026-11-20')] }],
    analyzedEvents: [...results.analyzedEvents, { ...site('Underwear Night', '2026-10-25'), _action: 'merge', _existingEvent: { identifier: 'cal:B2', title: 'Underwear Night (copy)' } }] };
  const duplicate = core.buildGoneFromSourceCandidates(twinSite, savedByCity, { now: new Date('2026-10-07T12:00:00Z'), previousUpcoming: { hosts: {}, gone: first.state } });
  assert.equal(duplicate.candidates.length, 1);
  assert.equal(duplicate.candidates[0].reason, 'duplicate');
  assert.deepEqual(duplicate.candidates[0].duplicateOf, { identifier: 'cal:B2', uid: 'B2', title: 'Underwear Night (copy)' });
  // …and when the run proposes that row as NEW instead, the gate failed to
  // fold two records of one event: logged as an identity miss, never a card.
  const gap = { parserResults: twinSite.parserResults, analyzedEvents: [...results.analyzedEvents, { ...site('Underwear Night', '2026-10-25'), _action: 'new' }] };
  const identity = core.buildGoneFromSourceCandidates(gap, savedByCity, { now: new Date('2026-10-07T12:00:00Z'), previousUpcoming: { hosts: {}, gone: first.state } });
  assert.equal(identity.candidates.length, 0);
  assert.equal(identity.summary.identityMisses, 1);
  assert.equal(identity.identityMisses[0].proposal, 'new');
  assert.equal(identity.state.la.B.misses, 1, 'frozen — the site lists it');

  // A thin read freezes the streak: neither counted nor cleared.
  const thinHistory = { hosts: { 'eaglela.com': { history: [1, 2, 3, 4].map((n) => ({ run_id: `r${n}`, upcoming: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`e${i}|eagle la|2026-10-2${i % 9}`, { day: '2026-10-20' }])) })) } }, gone: first.state };
  const thin = core.buildGoneFromSourceCandidates(results, savedByCity, { now: new Date('2026-10-07T12:00:00Z'), previousUpcoming: thinHistory });
  assert.equal(thin.candidates.length, 0);
  assert.equal(thin.state.la.B.misses, 1, 'frozen at the previous count');
  assert.equal(thin.summary.suppressedThin, 1);

  // A host in drift freezes the streak the same way.
  const driftHistory = { hosts: { 'eaglela.com': { signals_history: [{ structured: 6, pages: 1, extracted: 6 }, { structured: 6, pages: 1, extracted: 6 }, { structured: 6, pages: 1, extracted: 6 }] } }, gone: first.state };
  const drift = core.buildGoneFromSourceCandidates(results, savedByCity, { now: new Date('2026-10-07T12:00:00Z'), previousUpcoming: driftHistory });
  assert.equal(drift.candidates.length, 0);
  assert.equal(drift.summary.suppressedDrift, 1);

  // Seen again: the streak clears.
  const seenAgain = core.buildGoneFromSourceCandidates({ parserResults, analyzedEvents: [...results.analyzedEvents, { ...site('Underwear Night', '2026-10-25'), _action: 'merge', _existingEvent: { identifier: 'cal:B' } }] }, savedByCity, { now: new Date('2026-10-07T12:00:00Z'), previousUpcoming: { hosts: {}, gone: first.state } });
  assert.equal(seenAgain.candidates.length, 0);
  assert.equal(seenAgain.state.la, undefined);
});

test('savedEventUid: EventKit "<calendar>:<uid>" and a bare ICS uid both yield the uid; a recurrence suffix is cut', () => {
  assert.equal(SharedCore.savedEventUid('ABCD:7848F567-25CF'), '7848F567-25CF');
  assert.equal(SharedCore.savedEventUid('7848F567-25CF'), '7848F567-25CF');
  assert.equal(SharedCore.savedEventUid('ABCD:7848F567/RID=1234'), '7848F567');
  assert.equal(SharedCore.savedEventUid(''), '');
});

test('buildSourceLedger: a copy an aggregator listed under its own name, folded into the site\'s slot, is charged to the AGGREGATOR host (renamed), never to the site', () => {
  const boatslip = { name: 'The Boatslip', siteRole: 'venue', urls: ['https://theboatslip.com/pages/events'] };
  const gathr = { name: 'Gathr', siteRole: 'aggregator', urls: ['https://gathrparty.com/'] };
  const tea = { title: 'HALLOWEEN UNIFORM TEA - Spooky Bear Wknd', bar: 'Boatslip', city: 'ptown', timezone: 'America/New_York', startDate: '2026-10-30T20:00:00.000Z', endDate: '2026-10-30T23:00:00.000Z', website: 'https://theboatslip.com/pages/events', isBearEvent: true };
  const payload = {
    summary: { runId: '20261030-051500', timestamp: '2026-10-30T09:15:00.000Z' },
    runContext: { type: 'automated', environment: 'node', trigger: 'scheduled' },
    parserResults: [
      { name: 'The Boatslip', totalEvents: 1, durationMs: 500, config: boatslip, urlClassifications: {}, events: [tea] },
      { name: 'Gathr', totalEvents: 1, durationMs: 900, config: gathr, urlClassifications: {}, events: [{ ...tea, title: "Daddy-O's Dog Tag Tea", website: '' }] }
    ],
    analyzedEvents: [{
      ...tea, _action: 'new',
      _aggregatorCopiesFolded: [
        { aggregator: 'Gathr', title: "Daddy-O's Dog Tag Tea", startDate: tea.startDate, bar: 'Boatslip', day: '2026-10-30', site: 'theboatslip.com', source: 'The Boatslip', renamed: true },
        { aggregator: 'Gathr', title: 'Halloween Uniform Tea', startDate: tea.startDate, bar: 'Boatslip', day: '2026-10-30', site: 'theboatslip.com', source: 'The Boatslip', renamed: false },
        { aggregator: 'Nobody', title: 'x', startDate: tea.startDate, bar: 'Boatslip', day: '2026-10-30', site: 'theboatslip.com', source: 'The Boatslip', renamed: true }
      ]
    }],
    errors: []
  };
  const built = SharedCore.buildSourceLedger(payload, { now: new Date('2026-10-30T12:00:00Z') });
  const gathrRow = built.records.find((r) => r.host === 'gathrparty.com');
  const siteRow = built.records.find((r) => r.host === 'theboatslip.com');
  assert.deepEqual(gathrRow.quality.renamed, { n: 1, examples: ['"Daddy-O\'s Dog Tag Tea" = The Boatslip\'s "HALLOWEEN UNIFORM TEA - Spooky Bear Wknd" (2026-10-30)'] }, 'the same-name fold and an unknown aggregator count for nothing');
  assert.deepEqual(siteRow.quality.renamed, { n: 0, examples: [] });
  // The Sources view shows it as a signal on the aggregator only.
  const health = assessSourceHealth(built.records, { now: new Date('2026-10-30T12:00:00Z') });
  const gathrHealth = health.rows.find((row) => row.host === 'gathrparty.com');
  const signal = (gathrHealth.quality && Array.isArray(gathrHealth.quality.signals) ? gathrHealth.quality.signals : []).find((s) => s.key === 'renamed');
  assert.ok(signal, `renamed signal present: ${JSON.stringify(gathrHealth.quality)}`);
  assert.equal(signal.value, '1');
  assert.match(signal.detail, /Daddy-O's Dog Tag Tea/);
  const siteHealth = health.rows.find((row) => row.host === 'theboatslip.com');
  assert.ok(!(siteHealth.quality && siteHealth.quality.signals || []).some((s) => s.key === 'renamed'), 'the site is not blamed');
});

// ---------------------------------------------------------------------------
// new_upcoming: how many of a host's NEW proposals are still to come.
// Bears of San Francisco, 2026-11-09: the feed's own past list gave 30 rows,
// every one already over, and the ledger line read upcoming 0 beside
// proposals.new 30 — the "new" count alone made a site with nothing coming
// look like the day's busiest. The old fields keep their meaning; the new
// one sits beside them.
// ---------------------------------------------------------------------------
function finishedFeedPayload() {
  // Record shapes from run 20261109-053706 (trimmed).
  const row = (title, startDate, slug, extra = {}) => ({
    title, startDate, bar: 'The Willows', city: 'sf', timezone: 'America/Los_Angeles',
    website: `https://www.bosf.org/events/${slug}`, _sourcePageUrl: 'https://www.bosf.org/events', isBearEvent: true, ...extra
  });
  const brunch = row('BOSF Brunch', '2026-10-10T20:00:00.000Z', 'july-dinner-night-pte22');
  const contest = row('Bay Area Cub Contest', '2026-09-06T23:00:00.000Z', 'bay-area-cub-contest-1');
  const dinner = row('BOSF Dinner Night', '2026-11-21T03:00:00.000Z', 'november-dinner-night');
  const tonight = row('Bear Coffee', '2026-11-09T18:00:00.000Z', 'bear-coffee');
  return {
    summary: { runId: '20261109-053706', timestamp: '2026-11-09T10:37:06.000Z' },
    runContext: { type: 'automated', environment: 'node', trigger: 'scheduled' },
    parserResults: [{
      name: 'Bears of San Francisco', totalEvents: 4, durationMs: 800,
      config: { urls: ['https://www.bosf.org/events'] },
      urlClassifications: { 'https://www.bosf.org/events': 'multi-event-page' },
      events: [brunch, contest, dinner, tonight]
    }],
    analyzedEvents: [
      { ...brunch, _action: 'new' },
      { ...contest, _action: 'new' },
      { ...dinner, _action: 'new' },
      { ...tonight, _action: 'new' },
      // A finished night that only updates its saved record is no proposal to create.
      { ...row('BOSF Brunch', '2026-11-07T20:00:00.000Z', 'november-brunch'), _action: 'merge' },
      // A junk title has no ledger key: the host comes from its page, the day from its start.
      { title: 'View Event →', startDate: '2026-10-01T20:00:00.000Z', timezone: 'America/Los_Angeles', website: 'https://www.bosf.org/events/old', _sourcePageUrl: 'https://www.bosf.org/events', _action: 'new' },
      { title: 'View Event →', startDate: '2026-12-01T20:00:00.000Z', timezone: 'America/Los_Angeles', website: 'https://www.bosf.org/events/next', _sourcePageUrl: 'https://www.bosf.org/events', _action: 'new' }
    ],
    errors: []
  };
}

test('new_upcoming: the ledger line says how many of the new proposals are still to come, and every older field keeps its count', () => {
  const now = new Date('2026-11-09T10:37:06Z');
  const built = SharedCore.buildSourceLedger(finishedFeedPayload(), { now });
  const line = built.records.find((r) => r.host === 'bosf.org');
  assert.deepEqual(line.proposals, { new: 6, merge: 1 }, 'proposals still counts every record the run would create, finished or not');
  assert.equal(SharedCore.sourceLedgerEventKey({ title: 'View Event →', startDate: '2026-12-01T20:00:00.000Z', timezone: 'America/Los_Angeles' }), '', 'link text has no ledger key');
  assert.equal(line.new_upcoming, 3, 'the dinner, tonight (today counts, as it does for `upcoming`) and the keyless row dated in December');
  assert.equal(line.upcoming, 2, 'upcoming is unchanged: the two kept rows dated today or later');
  assert.equal(line.extracted, 4);
  assert.equal(line.events, 4);
  assert.equal(line.quality.runs_since_new, 0, 'the "runs since a new event" counter is not redefined');

  // Nothing new that is still to come: the count is 0, not missing.
  const allOver = finishedFeedPayload();
  allOver.analyzedEvents = allOver.analyzedEvents.filter((event) => String(event.startDate) < '2026-11-09');
  const overLine = SharedCore.buildSourceLedger(allOver, { now }).records.find((r) => r.host === 'bosf.org');
  assert.deepEqual(overLine.proposals, { new: 3, merge: 1 });
  assert.equal(overLine.new_upcoming, 0);

  // A host with no proposals at all carries 0 too, and the count survives the ndjson round trip.
  const quiet = SharedCore.buildSourceLedger(samplePayload(), { now: new Date('2026-10-06T12:00:00Z') });
  assert.equal(quiet.records.find((r) => r.host === 'quietbar.example').new_upcoming, 0);
  assert.equal(quiet.records.find((r) => r.host === 'eaglela.com').new_upcoming, 1, 'Beer Bust on 2026-10-11 is still to come on 2026-10-06');
  const reread = parseSourceLedger(built.records.map((r) => JSON.stringify(r)).join('\n'));
  assert.equal(reread.find((r) => r.host === 'bosf.org').new_upcoming, 3);
});

test('new_upcoming: the verdict does not move, the host card shows the count beside Proposals, and a line written before the field reads as before', () => {
  const { buildHostSummaryHtml } = require('./metrics-sections');
  const now = new Date('2026-11-09T12:00:00Z');
  const built = SharedCore.buildSourceLedger(finishedFeedPayload(), { now });
  const withField = built.records;
  const withoutField = built.records.map((record) => { const copy = { ...record }; delete copy.new_upcoming; return copy; });

  const health = assessSourceHealth(withField, { now });
  const oldHealth = assessSourceHealth(withoutField, { now });
  const row = health.rows.find((r) => r.host === 'bosf.org');
  const oldRow = oldHealth.rows.find((r) => r.host === 'bosf.org');
  assert.equal(row.verdict, oldRow.verdict, 'recorded only: the verdict is the same with and without the count');
  assert.deepEqual(row.quality && row.quality.badges, oldRow.quality && oldRow.quality.badges);

  const card = buildHostSummaryHtml(row);
  assert.match(card, /6 new \/ 1 merge<span class="metric-subvalue">3 of the new still to come<\/span>/);
  const oldCard = buildHostSummaryHtml(oldRow);
  assert.match(oldCard, /6 new \/ 1 merge\s*<\/div>/, 'an older line shows the proposals alone');
  assert.doesNotMatch(oldCard, /still to come/);

  // No new proposal, nothing to qualify.
  const noNew = finishedFeedPayload();
  noNew.analyzedEvents = noNew.analyzedEvents.filter((event) => event._action === 'merge');
  const mergeOnly = assessSourceHealth(SharedCore.buildSourceLedger(noNew, { now }).records, { now }).rows.find((r) => r.host === 'bosf.org');
  assert.doesNotMatch(buildHostSummaryHtml(mergeOnly), /still to come/);
});

// ---------------------------------------------------------------------------
// Removal cards need POSITIVE proof (2026-11-09). Nine saved Eagle LA
// events went to the review deck as "gone from the source" because our own
// read of the site's later months had broken: the check took "we did not
// see it" for "the site removed it". Three rules, each tested below:
//   1. a "gone" / "date-moved" card needs proof — the event's own page
//      answering 404/410, or the audit's listing-covers stamp for that day;
//   2. a source that was not read this run is not an empty source;
//   3. a source whose expected events went missing together is degraded and
//      every card for it is held.
// ---------------------------------------------------------------------------
function goneProofFixture() {
  const { EventSchema } = require('./event-schema');
  const core = new SharedCore({ la: { timezone: 'America/Los_Angeles', patterns: ['la'] } }, { eventSchema: EventSchema });
  const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // 05:00Z is the evening before in Los Angeles: `day` here is the UTC day, the local day is one earlier.
  const site = (title, day, extra = {}) => ({ title, startDate: `${day}T05:00:00.000Z`, bar: 'Eagle LA', city: 'la', timezone: 'America/Los_Angeles', website: `https://eaglela.com/events/${slug(title)}/`, isBearEvent: true, ...extra });
  const saved = (uid, title, day, extra = {}) => ({
    identifier: `cal:${uid}`, title, startDate: new Date(`${day}T05:00:00.000Z`), endDate: new Date(`${day}T09:00:00.000Z`), location: '34.0, -118.0',
    notes: `bar: Eagle LA\naddress: 4219 Santa Monica Blvd\nwebsite: https://eaglela.com/events/${slug(title)}/`, url: '', isAllDay: false, ...extra
  });
  const parser = (events, extra = {}) => ({ name: 'Eagle LA', totalEvents: events.length, config: { name: 'Eagle LA', urls: ['https://eaglela.com/calendar/'] }, urlClassifications: { 'https://eaglela.com/calendar/': 'multi-event-page' }, events, ...extra });
  return { core, site, saved, parser, slug };
}

test('buildGoneFromSourceCandidates: not seeing a saved event is not proof the site removed it — a "gone" card needs its own page answering 404/410 or a fresh listing-covers stamp for THAT day; otherwise it is held with the reason (Eagle LA, 2026-11-09)', () => {
  const { core, site, saved, parser } = goneProofFixture();
  const results = { parserResults: [parser([site('BLUF LA', '2026-11-21'), site('MEAT RACK', '2026-11-15'), site('LOST PUPPY', '2026-12-19')])], analyzedEvents: [] };
  const savedByCity = { la: { events: [saved('NYE', 'EAGLE LA NEW YEARS BASH!!', '2026-12-05')] } };
  const first = core.buildGoneFromSourceCandidates(results, savedByCity, { now: new Date('2026-11-08T13:00:00Z') });
  assert.equal(first.candidates.length, 0);
  assert.deepEqual(first.held, [], 'one miss: no card was due, nothing to hold');
  assert.equal(first.state.la.NYE.misses, 1);
  const now = new Date('2026-11-09T13:00:00Z');
  const lostSeries = (still) => ({ hosts: { 'eaglela.com': { lost: { 'eagle la new years bash': { title: 'EAGLE LA NEW YEARS BASH!!', bear: true, seen: 4, days: { '2026-12-04': '20261012-214806' }, ...(still ? { still } : {}) } } } }, gone: first.state });
  const run = (previousUpcoming, coreToUse = core) => coreToUse.buildGoneFromSourceCandidates(results, savedByCity, { now, previousUpcoming });

  // No check of the listing at all.
  const bare = run({ hosts: {}, gone: first.state });
  assert.equal(bare.candidates.length, 0, 'the second miss alone is no longer a card');
  assert.equal(bare.summary.heldNoProof, 1);
  assert.equal(bare.held.length, 1);
  assert.deepEqual({ uid: bare.held[0].uid, reason: bare.held[0].reason, day: bare.held[0].day, misses: bare.held[0].misses, host: bare.held[0].host, source: bare.held[0].source },
    { uid: 'NYE', reason: 'no-proof', day: '2026-12-04', misses: 2, host: 'eaglela.com', source: 'Eagle LA' });
  assert.match(bare.held[0].detail, /nothing proves the site removed it .* no check of the listing yet/);
  assert.equal(bare.state.la.NYE.misses, 2, 'the streak still counts — only the card waits');

  // The stamp every one of the nine carried: "site-removed", judged off the wrong month, no proof.
  const guess = run(lostSeries({ verdict: 'site-removed', at: '2026-11-09T12:40:00.000Z' }));
  assert.equal(guess.candidates.length, 0);
  assert.match(guess.held[0].detail, /an older "site removed" verdict that rests on no proof for that day/);
  // The new audit's answer for that page: unknown.
  const unknown = run(lostSeries({ verdict: 'unknown', at: '2026-11-09T12:40:00.000Z' }));
  assert.equal(unknown.candidates.length, 0);
  assert.match(unknown.held[0].detail, /the listing check says "unknown"/);

  // Proof 2: the listing as read covers the day and does not carry it.
  const proven = run(lostSeries({ verdict: 'site-removed', at: '2026-11-09T12:40:00.000Z', proof: 'listing-covers', days: ['2026-12-04'] }));
  assert.equal(proven.candidates.length, 1);
  assert.deepEqual(proven.held, []);
  assert.equal(proven.candidates[0].reason, 'gone');
  assert.equal(proven.candidates[0].proof.kind, 'listing-covers');
  assert.match(proven.candidates[0].proof.detail, /listing covers 2026-12-04 and does not carry it \(checked 2026-11-09\)/);
  assert.deepEqual(proven.candidates[0].deepCheck, { verdict: 'site-removed', at: '2026-11-09T12:40:00.000Z', proof: 'listing-covers', proven: true });
  // A weekly series: vouched for on its November nights, unknown as a whole — the day vouched for still counts.
  assert.equal(run(lostSeries({ verdict: 'unknown', at: '2026-11-09T12:40:00.000Z', proof: 'listing-covers', days: ['2026-12-04'] })).candidates.length, 1);
  // …the proof vouches for another day: held.
  const otherDay = run(lostSeries({ verdict: 'site-removed', at: '2026-11-09T12:40:00.000Z', proof: 'listing-covers', days: ['2026-11-27'] }));
  assert.equal(otherDay.candidates.length, 0);
  assert.equal(otherDay.held[0].reason, 'no-proof');
  // …the proof is old (the page may have changed since): held.
  assert.equal(SharedCore.GONE_PROOF_MAX_AGE_DAYS, 14);
  assert.equal(run(lostSeries({ verdict: 'site-removed', at: '2026-10-20T12:40:00.000Z', proof: 'listing-covers', days: ['2026-12-04'] })).candidates.length, 0);
  // …the ledger no longer counts that day lost (the run read it again since): held.
  const returned = lostSeries({ verdict: 'site-removed', at: '2026-11-09T12:40:00.000Z', proof: 'listing-covers', days: ['2026-12-04'] });
  returned.hosts['eaglela.com'].lost['eagle la new years bash'].days = { '2026-12-11': '20261012-214806' };
  assert.equal(run(returned).candidates.length, 0);
  // "Still listed" stays what it was: our read's miss, logged, never a card and not a hold.
  const listed = run(lostSeries({ verdict: 'still-listed', at: '2026-11-09T12:40:00.000Z' }));
  assert.equal(listed.candidates.length, 0);
  assert.deepEqual(listed.held, []);
  assert.equal(listed.summary.identityMisses, 1);

  // Proof 1: the event's own page answers "not found" (the dead-end store, no fetch).
  const { core: withStore } = goneProofFixture();
  const pageUrl = 'https://eaglela.com/events/eagle-la-new-years-bash/';
  withStore.deadLinkKnowledge = { store: { [withStore.getUrlDedupeKey(pageUrl)]: { lastStatus: 404, lastSeen: '2026-11-09T12:00:00.000Z', misses: 1 } }, retryDays: 0 };
  const pageGone = run({ hosts: {}, gone: first.state }, withStore);
  assert.equal(pageGone.candidates.length, 1);
  assert.equal(pageGone.candidates[0].proof.kind, 'page-gone');
  assert.equal(pageGone.candidates[0].proof.status, 404);
  assert.match(pageGone.candidates[0].proof.detail, /its own page answers HTTP 404/);
  // A wall is not an absence: 403 proves nothing.
  const { core: walled } = goneProofFixture();
  walled.deadLinkKnowledge = { store: { [walled.getUrlDedupeKey(pageUrl)]: { lastStatus: 403, lastSeen: '2026-11-09T12:00:00.000Z', misses: 3 } }, retryDays: 0 };
  assert.equal(run({ hosts: {}, gone: first.state }, walled).candidates.length, 0);
  // The listing url itself answering 404 says nothing about one event.
  const { core: listingDead, saved: savedAgain } = goneProofFixture();
  listingDead.deadLinkKnowledge = { store: { [listingDead.getUrlDedupeKey('https://eaglela.com/calendar/')]: { lastStatus: 404, lastSeen: '2026-11-09T12:00:00.000Z', misses: 1 } }, retryDays: 0 };
  const pointsAtListing = { la: { events: [savedAgain('NYE', 'EAGLE LA NEW YEARS BASH!!', '2026-12-05', { notes: 'bar: Eagle LA\naddress: 4219 Santa Monica Blvd\nwebsite: https://eaglela.com/calendar/' })] } };
  assert.equal(listingDead.buildGoneFromSourceCandidates(results, pointsAtListing, { now, previousUpcoming: { hosts: {}, gone: first.state } }).candidates.length, 0);
});

test('a source that was not read is not an empty source: the ledger line says not_read (status and counts untouched, nothing confirmed lost, nothing vanished) and no gone card is raised for a site whose configured url the run could not read', () => {
  const { core, site, saved, parser } = goneProofFixture();
  const events = [site('BLUF LA', '2026-11-21'), site('MEAT RACK', '2026-11-15'), site('LOST PUPPY', '2026-12-19'), site('CUBSCOUT', '2026-12-05')];
  const payload = (runId, day, parsers) => ({ summary: { runId, timestamp: `${day}T13:00:00.000Z` }, runContext: { environment: 'node' }, parserResults: parsers, analyzedEvents: [], bearDroppedEvents: [], errors: [] });
  let upcoming = null;
  [['r1', '2026-11-06'], ['r2', '2026-11-07']].forEach(([runId, day]) => { upcoming = SharedCore.buildSourceLedger(payload(runId, day, [parser(events)]), { runId, previousUpcoming: upcoming, now: new Date(`${day}T13:00:00Z`) }).upcoming; });
  // Run 3: the calendar url was refused (the browser allowance was spent) — the parser hands back nothing.
  const unread = parser([], { unreadUrls: [{ url: 'https://eaglela.com/calendar/', reason: 'browser budget spent for this run' }], urlClassifications: {} });
  const third = SharedCore.buildSourceLedger(payload('r3', '2026-11-08', [unread]), { runId: 'r3', previousUpcoming: upcoming, now: new Date('2026-11-08T13:00:00Z') });
  const line = third.records.find((record) => record.host === 'eaglela.com');
  assert.deepEqual(line.not_read, [{ url: 'https://eaglela.com/calendar/', reason: 'browser budget spent for this run' }]);
  assert.equal(line.status, 'empty', 'the old field keeps its old computation; not_read is what the health verdict reads (assessSourceHealth: not stopped, not empty)');
  assert.equal(line.suspected, 0, 'nothing is suspected missing off a read that did not happen');
  assert.deepEqual(line.lost, []);
  assert.deepEqual(line.vanished, [], 'and nothing "vanished"');
  assert.equal(line.collapse, undefined);
  assert.equal(line.extracted, 0, 'the count is what was extracted — the new field is what says why');
  assert.deepEqual(third.upcoming.hosts['eaglela.com'].history.map((entry) => entry.run_id), ['r1', 'r2'], 'the unread run is not one of the host\'s reads');
  const fourth = SharedCore.buildSourceLedger(payload('r4', '2026-11-09', [unread]), { runId: 'r4', previousUpcoming: third.upcoming, now: new Date('2026-11-09T13:00:00Z') });
  assert.deepEqual(fourth.records.find((record) => record.host === 'eaglela.com').lost, [], 'two unread runs confirm nothing');
  // A line of a run that read the source carries no such field.
  assert.equal(SharedCore.buildSourceLedger(payload('r3', '2026-11-08', [parser(events)]), { runId: 'r3', previousUpcoming: upcoming, now: new Date('2026-11-08T13:00:00Z') }).records[0].not_read, undefined);

  // The gone check: the site's source was not read — no miss counted, no card, and (when one was due) a visible hold.
  const savedByCity = { la: { events: [saved('CUB', 'CUBSCOUT', '2026-12-05')] } };
  const prior = { la: { CUB: { title: 'CUBSCOUT', day: '2026-12-04', misses: 1, host: 'eaglela.com' } } };
  const gone = core.buildGoneFromSourceCandidates({ parserResults: [unread], analyzedEvents: [] }, savedByCity, { now: new Date('2026-11-09T13:00:00Z'), previousUpcoming: { hosts: {}, gone: prior } });
  assert.equal(gone.candidates.length, 0);
  assert.equal(gone.summary.notRead, 1);
  assert.equal(gone.state.la.CUB.misses, 1, 'the streak keeps its place: neither counted nor cleared');
  assert.equal(gone.held.length, 1);
  assert.equal(gone.held[0].reason, 'not-read');
  assert.match(gone.held[0].detail, /Eagle LA was not read this run \(https:\/\/eaglela\.com\/calendar\/ — browser budget spent for this run\)/);
  // No streak yet: nothing to hold, and none is started.
  const fresh = core.buildGoneFromSourceCandidates({ parserResults: [unread], analyzedEvents: [] }, savedByCity, { now: new Date('2026-11-09T13:00:00Z') });
  assert.deepEqual(fresh.held, []);
  assert.equal(fresh.state.la, undefined);
  // One url of two unread, the other read and showing other nights: still no card — the unread url may be the one that lists it.
  const half = { name: 'Eagle LA', totalEvents: 2, config: { name: 'Eagle LA', urls: ['https://eaglela.com/calendar/', 'https://eaglela.com/events/'] }, urlClassifications: { 'https://eaglela.com/events/': 'multi-event-page' },
    events: [site('BLUF LA', '2026-11-21'), site('LOST PUPPY', '2026-12-19')], unreadUrls: [{ url: 'https://eaglela.com/calendar/', reason: 'HTTP 503' }] };
  const partial = core.buildGoneFromSourceCandidates({ parserResults: [half], analyzedEvents: [] }, savedByCity, { now: new Date('2026-11-09T13:00:00Z'), previousUpcoming: { hosts: {}, gone: prior } });
  assert.equal(partial.candidates.length, 0);
  assert.equal(partial.held[0].reason, 'not-read');
  assert.match(partial.held[0].detail, /HTTP 503/);
});

test('assessSourceCollapse: THE threshold — 5 or more expected future event-days missing together and at least 10% of what the source should show; proven and set-aside days do not count, days read again or passed clear it', () => {
  assert.deepEqual(SharedCore.SOURCE_COLLAPSE_RULE, { minEvents: 5, share: 0.10 });
  const daysOf = (n, run, month = '12') => Object.fromEntries(Array.from({ length: n }, (_, i) => [`2026-${month}-${String(i + 1).padStart(2, '0')}`, run]));
  const lossOf = (series, misses = {}) => ({ history: [], misses, lost: series });
  // Eagle LA, run 20261012-180543: 12 nights gone together against 53 still shown.
  assert.deepEqual(SharedCore.assessSourceCollapse(lossOf({ a: { title: 'A', days: daysOf(12, 'r5') } }), 53, '2026-10-12'), { missing: 12, upcoming: 53, share: 0.18, since: 'r5' });
  assert.equal(SharedCore.assessSourceCollapse(lossOf({ a: { title: 'A', days: daysOf(4, 'r5') } }), 3, '2026-10-12'), null, 'four is under the floor, whatever the share');
  assert.deepEqual(SharedCore.assessSourceCollapse(lossOf({ a: { title: 'A', days: daysOf(5, 'r5') } }), 45, '2026-10-12'), { missing: 5, upcoming: 45, share: 0.1, since: 'r5' }, '5 of 50 is the edge');
  assert.equal(SharedCore.assessSourceCollapse(lossOf({ a: { title: 'A', days: daysOf(5, 'r5') } }), 46, '2026-10-12'), null, '5 of 51 is under 10%');
  // Together = confirmed by one run. Six nights that dropped out one a week are ordinary churn.
  const trickle = { a: { title: 'A', days: { '2026-12-01': 'r1', '2026-12-02': 'r2', '2026-12-03': 'r3' } }, b: { title: 'B', days: { '2026-12-04': 'r4', '2026-12-05': 'r5', '2026-12-06': 'r6' } } };
  assert.equal(SharedCore.assessSourceCollapse(lossOf(trickle), 10, '2026-10-12'), null);
  // …across titles, one run: a batch.
  const across = { a: { title: 'A', days: daysOf(3, 'r5') }, b: { title: 'B', days: daysOf(3, 'r5', '11') } };
  assert.equal(SharedCore.assessSourceCollapse(lossOf(across), 10, '2026-10-12').missing, 6);
  // First misses of this run, not yet confirmed: a batch with no run id (the day it starts).
  const pending = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`party ${i}|2026-12-${String(i + 10)}`, 1]));
  assert.deepEqual(SharedCore.assessSourceCollapse(lossOf({}, pending), 20, '2026-10-12'), { missing: 7, upcoming: 20, share: 0.26, since: '' });
  // Days that have passed no longer count.
  assert.equal(SharedCore.assessSourceCollapse(lossOf({ a: { title: 'A', days: daysOf(12, 'r5', '10') } }), 20, '2026-10-09'), null, '12 lost days, 4 of them still ahead');
  // Only PROOF takes a day out: the listing covers it without the title, or the run holds it under another name.
  const proven = { a: { title: 'A', days: daysOf(6, 'r5'), still: { verdict: 'site-removed', at: 'x', proof: 'listing-covers', days: Object.keys(daysOf(6, 'r5')) } } };
  assert.equal(SharedCore.assessSourceCollapse(lossOf(proven), 20, '2026-10-12'), null);
  const partly = { a: { title: 'A', days: daysOf(6, 'r5'), still: { verdict: 'unknown', at: 'x', proof: 'listing-covers', days: ['2026-12-01'] } } };
  assert.equal(SharedCore.assessSourceCollapse(lossOf(partly), 20, '2026-10-12').missing, 5);
  assert.equal(SharedCore.assessSourceCollapse(lossOf({ a: { title: 'A', days: daysOf(6, 'r5'), still: { verdict: 'set-aside', at: 'x' } } }), 20, '2026-10-12'), null);
  ['still-listed', 'unknown', 'site-removed'].forEach((verdict) => {
    assert.equal(SharedCore.assessSourceCollapse(lossOf({ a: { title: 'A', days: daysOf(6, 'r5'), still: { verdict, at: 'x' } } }), 20, '2026-10-12').missing, 6, `"${verdict}" with no proof is still our read's problem`);
  });
  assert.equal(SharedCore.assessSourceCollapse(null, 20, '2026-10-12'), null);
});

test('a collapse is our problem until proven otherwise: when a source\'s expected events go missing together the ledger line says collapse, and every gone card for that source is held with the reason — the day it starts and while it lasts (Eagle LA, run 20261012-180543: 12 nights against 53)', () => {
  const { core, site, saved, parser } = goneProofFixture();
  const pad = (n) => String(n).padStart(2, '0');
  // 53 nights the run keeps reading (November, January, the last on 2027-01-30) and 12 December parties it stops reading.
  const steady = Array.from({ length: 53 }, (_, i) => site(`Steady Night ${i + 1}`, i < 30 ? `2026-11-${pad(i + 1)}` : (i < 52 ? `2027-01-${pad(i - 29)}` : '2027-01-31')));
  const december = Array.from({ length: 12 }, (_, i) => site(`December Party ${i + 1}`, `2026-12-${pad(i + 10)}`));
  const payload = (runId, day, events, extra = {}) => ({ summary: { runId, timestamp: `${day}T13:00:00.000Z` }, runContext: { environment: 'node' }, parserResults: [parser(events)], analyzedEvents: [], bearDroppedEvents: [], errors: [], ...extra });
  let upcoming = null;
  [['r1', '2026-10-06'], ['r2', '2026-10-07']].forEach(([runId, day]) => { upcoming = SharedCore.buildSourceLedger(payload(runId, day, steady.concat(december)), { runId, previousUpcoming: upcoming, now: new Date(`${day}T13:00:00Z`) }).upcoming; });
  const savedByCity = { la: { events: [saved('D1', 'December Party 1', '2026-12-10'), saved('D2', 'December Party 2', '2026-12-11')] } };
  const prior = { la: { D1: { title: 'December Party 1', day: '2026-12-09', misses: 1, host: 'eaglela.com' } } };

  // The day it starts: the December nights are first misses of this very run.
  const third = payload('r3', '2026-10-08', steady);
  const now3 = new Date('2026-10-08T13:00:00Z');
  const gone3 = core.buildGoneFromSourceCandidates(third, savedByCity, { now: now3, previousUpcoming: { ...upcoming, gone: prior } });
  assert.equal(gone3.candidates.length, 0);
  assert.equal(gone3.summary.suppressedCollapse, 2);
  assert.equal(gone3.held.length, 1, 'D1 was due a card this run; D2 had no streak yet');
  assert.equal(gone3.held[0].uid, 'D1');
  assert.equal(gone3.held[0].reason, 'collapse');
  assert.match(gone3.held[0].detail, /Eagle LA is degraded: 12 expected future event\(s\) went missing together \(this run\) against \d+ still shown/);
  assert.equal(gone3.state.la.D1.misses, 1, 'frozen');
  assert.equal(gone3.state.la.D2, undefined, 'no streak starts while the source is degraded');
  const ledger3 = SharedCore.buildSourceLedger({ ...third, goneFromSource: gone3 }, { runId: 'r3', previousUpcoming: { ...upcoming, gone: prior }, now: now3 });
  const line3 = ledger3.records.find((record) => record.host === 'eaglela.com');
  assert.equal(line3.collapse.missing, 12);
  assert.equal(line3.collapse.since, '');
  assert.ok(line3.collapse.share >= 0.10, String(line3.collapse.share));
  assert.equal(line3.status, 'ok', 'status keeps its meaning — the collapse is its own field');

  // While it lasts: confirmed on the next run, still held three weeks later.
  const ledger4 = SharedCore.buildSourceLedger({ ...payload('r4', '2026-10-09', steady), goneFromSource: gone3 }, { runId: 'r4', previousUpcoming: ledger3.upcoming, now: new Date('2026-10-09T13:00:00Z') });
  assert.deepEqual({ missing: ledger4.records[0].collapse.missing, since: ledger4.records[0].collapse.since }, { missing: 12, since: 'r4' });
  const later = payload('r30', '2026-10-30', steady);
  const gone30 = core.buildGoneFromSourceCandidates(later, savedByCity, { now: new Date('2026-10-30T13:00:00Z'), previousUpcoming: ledger4.upcoming });
  assert.equal(gone30.candidates.length, 0);
  assert.equal(gone30.held.length, 1);
  assert.match(gone30.held[0].detail, /went missing together \(run r4\)/);

  // Read again: the collapse clears by itself and the events are simply seen.
  const back = payload('r31', '2026-10-31', steady.concat(december), { analyzedEvents: [{ ...december[0], _action: 'merge', _existingEvent: { identifier: 'cal:D1' } }, { ...december[1], _action: 'merge', _existingEvent: { identifier: 'cal:D2' } }] });
  const gone31 = core.buildGoneFromSourceCandidates(back, savedByCity, { now: new Date('2026-10-31T13:00:00Z'), previousUpcoming: ledger4.upcoming });
  assert.equal(gone31.summary.suppressedCollapse, 0);
  assert.equal(gone31.summary.seen, 2);
  assert.equal(SharedCore.buildSourceLedger(back, { runId: 'r31', previousUpcoming: ledger4.upcoming, now: new Date('2026-10-31T13:00:00Z') }).records[0].collapse, undefined);

  // Two nights dropping out is not a collapse: the proof rule decides (held for no proof, not for collapse).
  const two = payload('r3', '2026-10-08', steady.concat(december.slice(2)));
  const goneTwo = core.buildGoneFromSourceCandidates(two, savedByCity, { now: now3, previousUpcoming: { ...upcoming, gone: prior } });
  assert.equal(goneTwo.summary.suppressedCollapse, 0);
  assert.equal(goneTwo.held[0].reason, 'no-proof');
});

test('advanceSourceLoss: the audit\'s proof and the days it vouches for ride with the series; the list item says still_proof — a "site-removed" without it is a guess from before the rule', () => {
  const lostState = (still) => ({ history: [], misses: {}, lost: { 'calf night': { title: 'CALF NIGHT', bear: true, seen: 3, days: { '2026-11-20': 'r4' }, still } } });
  const run = { runId: 'r5', status: 'ok', todayKey: '2026-11-09', extracted: 3, upcomingKeys: {} };
  const proven = SharedCore.advanceSourceLoss(lostState({ verdict: 'site-removed', at: '2026-11-09T12:00:00.000Z', proof: 'listing-covers', days: ['2026-11-20'] }), run);
  assert.deepEqual(proven.state.lost['calf night'].still, { verdict: 'site-removed', at: '2026-11-09T12:00:00.000Z', proof: 'listing-covers', days: ['2026-11-20'] });
  assert.equal(proven.lost[0].still, 'site-removed');
  assert.equal(proven.lost[0].still_proof, 'listing-covers');
  const guess = SharedCore.advanceSourceLoss(lostState({ verdict: 'site-removed', at: '2026-10-12T12:00:00.000Z' }), run);
  assert.deepEqual(guess.state.lost['calf night'].still, { verdict: 'site-removed', at: '2026-10-12T12:00:00.000Z' });
  assert.equal(guess.lost[0].still_proof, undefined);
  // A run that did not read the source ('not-read') neither confirms nor clears.
  const state = { history: [{ run_id: 'r1', upcoming: { 'a|x|2026-12-01': { title: 'A', day: '2026-12-01' } } }, { run_id: 'r2', upcoming: { 'a|x|2026-12-01': { title: 'A', day: '2026-12-01' } } }], misses: {}, lost: {} };
  const unread = SharedCore.advanceSourceLoss(state, { runId: 'r3', status: 'not-read', todayKey: '2026-11-09', extracted: 0, upcomingKeys: {} });
  assert.equal(unread.suspected, 0);
  assert.equal(unread.state.history.length, 2);
  assert.deepEqual(unread.state.misses, {});
});

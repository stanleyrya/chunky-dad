const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('node:child_process');

const {
  replayRun,
  collectScrapedEvents,
  buildCalendarEventFromSnapshot,
  reviveEventDates,
  diffEvents,
  formatReplayReport
} = require('../tools/replay-run');

const REPLAY_CLI = path.join(__dirname, '..', 'tools', 'replay-run.js');

// ---------------------------------------------------------------------------
// Embedded fixture run: the shape written by ScriptableAdapter.saveRun()
// (scripts/adapters/scriptable-adapter.js — version 2 payload). Three scraped
// records: two are the same Dallas event (shared ticketUrl, different titles →
// identity-scan dedup), one is independent. The first analyzed event carries a
// calendar snapshot (_original.calendar), so replay exercises both
// deduplicateEvents and createFinalEventObject. The analyzedEvents below are
// the frozen deterministic outcome of that merge (AI arbitration disabled).
// ---------------------------------------------------------------------------

const TICKET_URL = 'https://events.ticketleap.example/furball-dallas-freedom-tea';

const SCRAPED_A1 = {
  title: 'DALLAS FREEDOM TEA',
  startDate: '2026-07-05T22:00:00.000Z',
  endDate: '2026-07-06T03:00:00.000Z',
  bar: 'STATION 4',
  address: '3911 Cedar Springs Rd, Dallas, TX 75219',
  city: 'dallas',
  timezone: 'America/Chicago',
  ticketUrl: TICKET_URL,
  shortName: 'FUR-BALL',
  source: 'ai-web',
  isBearEvent: true
};

const SCRAPED_A2 = {
  title: 'FURBALL DALLAS',
  description: 'FURBALL PRESENTS',
  startDate: '2026-07-05T22:00:00.000Z',
  endDate: '2026-07-06T03:00:00.000Z',
  bar: 'STATION 4',
  address: '3911 Cedar Springs Rd, Dallas, TX 75219',
  city: 'dallas',
  timezone: 'America/Chicago',
  ticketUrl: TICKET_URL,
  source: 'ai-web',
  isBearEvent: true
};

const SCRAPED_B = {
  title: 'BEAR HAPPY HOUR',
  startDate: '2026-07-08T23:00:00.000Z',
  endDate: '2026-07-09T02:00:00.000Z',
  bar: 'HIDDEN DOOR',
  address: '5025 Bowser Ave, Dallas, TX 75209',
  city: 'dallas',
  timezone: 'America/Chicago',
  source: 'ai-web',
  isBearEvent: true
};

const CALENDAR_NOTES = [
  'bar: STATION 4',
  'address: 3911 Cedar Springs Rd, Dallas, TX 75219',
  'timezone: America/Chicago',
  `ticketUrl: ${TICKET_URL}`,
  'shortName: FUR-BALL'
].join('\n');

const CALENDAR_SNAPSHOT = {
  bar: 'STATION 4',
  address: '3911 Cedar Springs Rd, Dallas, TX 75219',
  timezone: 'America/Chicago',
  ticketUrl: TICKET_URL,
  shortName: 'FUR-BALL',
  title: 'FURBALL',
  startDate: '2026-07-05T21:00:00.000Z',
  endDate: '2026-07-06T02:00:00.000Z',
  location: '32.810535, -96.8110709',
  notes: CALENDAR_NOTES,
  url: 'https://furball.example'
};

// Frozen deterministic outcome of dedup(A1, A2) + createFinalEventObject
// against CALENDAR_SNAPSHOT.
const SAVED_MERGED_A = {
  title: 'FURBALL',
  startDate: '2026-07-05T21:00:00.000Z',
  endDate: '2026-07-06T02:00:00.000Z',
  location: '32.810535, -96.8110709',
  notes: [
    'description: FURBALL PRESENTS',
    'bar: STATION 4',
    'address: 3911 Cedar Springs Rd, Dallas, TX 75219',
    'timezone: America/Chicago',
    `ticketUrl: ${TICKET_URL}`,
    'key: dallas-freedom-tea|2026-07-05|station 4',
    'shortName: FUR-BALL'
  ].join('\n'),
  url: 'https://furball.example',
  description: 'FURBALL PRESENTS',
  bar: 'STATION 4',
  address: '3911 Cedar Springs Rd, Dallas, TX 75219',
  city: 'dallas',
  timezone: 'America/Chicago',
  ticketUrl: TICKET_URL,
  source: 'ai-web',
  isBearEvent: true,
  key: 'dallas-freedom-tea|2026-07-05|station 4',
  shortName: 'FUR-BALL',
  _action: 'merge',
  _existingEvent: {
    title: 'FURBALL',
    startDate: '2026-07-05T21:00:00.000Z',
    endDate: '2026-07-06T02:00:00.000Z',
    location: '32.810535, -96.8110709',
    url: 'https://furball.example',
    notes: CALENDAR_NOTES
  },
  _original: {
    scraper: { ...SCRAPED_A2, key: 'dallas-freedom-tea|2026-07-05|station 4' },
    calendar: CALENDAR_SNAPSHOT,
    merged: {}
  }
};

const SAVED_NEW_B = {
  ...SCRAPED_B,
  key: 'bear-happy-hour|2026-07-08|hidden door',
  notes: [
    'bar: HIDDEN DOOR',
    'address: 5025 Bowser Ave, Dallas, TX 75209',
    'timezone: America/Chicago',
    'key: bear-happy-hour|2026-07-08|hidden door'
  ].join('\n'),
  _action: 'new'
};

function buildFixtureRun() {
  return JSON.parse(JSON.stringify({
    version: 2,
    summary: {
      runId: '20260713-090000',
      timestamp: '2026-07-13T09:00:00.000Z',
      runContext: null,
      totals: { totalEvents: 3, bearEvents: 2, calendarEvents: 0, errors: 0 },
      parserSummaries: [{ name: 'Furball', bearEvents: 2, totalEvents: 3 }]
    },
    runContext: null,
    config: {
      config: { dryRun: true },
      cities: {
        dallas: { calendar: 'chunky-dad-dallas', timezone: 'America/Chicago', patterns: ['dallas'] }
      }
    },
    analyzedEvents: [SAVED_MERGED_A, SAVED_NEW_B],
    parserResults: [
      { name: 'Furball', bearEvents: 2, totalEvents: 3, events: [SCRAPED_A1, SCRAPED_A2, SCRAPED_B] }
    ],
    errors: []
  }));
}

test('replayRun reproduces a saved run with zero differences', async () => {
  const report = await replayRun(buildFixtureRun());

  assert.equal(report.scrapedSource, 'parserResults');
  assert.equal(report.counts.scraped, 3);
  assert.equal(report.counts.replayed, 2, 'the two same-event records must dedup into one');
  assert.equal(report.counts.saved, 2);
  assert.equal(report.counts.matched, 2);
  assert.deepEqual(report.unmatchedSaved, []);
  assert.deepEqual(report.unmatchedReplayed, []);
  assert.equal(report.counts.withDifferences, 0);
  assert.equal(report.ok, true);

  const merged = report.events.find(entry => entry.title === 'FURBALL');
  assert.ok(merged, 'the calendar-merged event must be matched');
  assert.equal(merged.mergedWithCalendar, true);
});

test('replayRun surfaces per-field differences when the saved outcome no longer matches', async () => {
  const run = buildFixtureRun();
  // Simulate a historical run produced by older merge logic: the saved outcome
  // kept a different bar and a different end date than today's code produces.
  run.analyzedEvents[0].bar = 'THE OLD VENUE';
  run.analyzedEvents[0].endDate = '2026-07-06T05:00:00.000Z';

  const report = await replayRun(run);
  assert.equal(report.ok, false);
  assert.equal(report.counts.withDifferences, 1);

  const merged = report.events.find(entry => entry.title === 'FURBALL');
  const fields = merged.differences.map(diff => diff.field).sort();
  assert.deepEqual(fields, ['bar', 'endDate']);

  const barDiff = merged.differences.find(diff => diff.field === 'bar');
  assert.equal(barDiff.saved, 'THE OLD VENUE');
  assert.equal(barDiff.replayed, 'STATION 4');

  const text = formatReplayReport(report);
  assert.match(text, /FURBALL/);
  assert.match(text, /bar:/);
  assert.match(text, /THE OLD VENUE/);
  assert.match(text, /STATION 4/);
});

test('replayRun reports events the replay adds or removes', async () => {
  const run = buildFixtureRun();
  // A saved event the replay can no longer produce (e.g. its scraped records
  // were pruned from the run) must be reported, not crash the diff.
  run.analyzedEvents.push({
    title: 'GHOST EVENT',
    startDate: '2026-07-10T01:00:00.000Z',
    key: 'ghost-event|2026-07-10|'
  });

  const report = await replayRun(run);
  assert.equal(report.ok, false);
  assert.equal(report.unmatchedSaved.length, 1);
  assert.equal(report.unmatchedSaved[0].title, 'GHOST EVENT');
  assert.match(formatReplayReport(report), /GHOST EVENT/);
});

test('replayRun handles older/partial runs gracefully', async () => {
  // Old runs: no parserResults events — fall back to the merge snapshots on
  // analyzedEvents (_original.scraper), then to the events themselves.
  const run = buildFixtureRun();
  run.parserResults = [{ name: 'Furball', bearEvents: 2, totalEvents: 3 }];
  delete run.config.cities;

  const report = await replayRun(run);
  assert.equal(report.scrapedSource, 'analyzedEvents');
  assert.equal(report.counts.scraped, 2);
  assert.ok(report.warnings.some(warning => /cities/.test(warning)), 'missing cities config must be surfaced as a warning');

  // Fully empty run: no events anywhere — warn, do not throw.
  const empty = await replayRun({ version: 1 });
  assert.equal(empty.counts.scraped, 0);
  assert.equal(empty.counts.saved, 0);
  assert.ok(empty.warnings.some(warning => /no scraped events/i.test(warning)));

  await assert.rejects(() => replayRun(null), /empty or not an object/);
});

test('collectScrapedEvents and snapshot/date helpers cover the saved-run shapes', () => {
  const fromAnalyzed = collectScrapedEvents({
    analyzedEvents: [
      { _original: { scraper: { title: 'A', startDate: '2026-07-05T22:00:00.000Z' } } },
      { title: 'B', startDate: '2026-07-06T22:00:00.000Z', _action: 'new' }
    ]
  });
  assert.equal(fromAnalyzed.source, 'analyzedEvents');
  assert.equal(fromAnalyzed.events.length, 2);
  assert.ok(fromAnalyzed.events[0].startDate instanceof Date, 'ISO strings must be revived to Dates');
  assert.equal(fromAnalyzed.events[1].title, 'B');
  assert.equal(fromAnalyzed.events[1]._action, undefined, 'analysis fields must be stripped');

  const calendarEvent = buildCalendarEventFromSnapshot(CALENDAR_SNAPSHOT);
  assert.equal(calendarEvent.title, 'FURBALL');
  assert.equal(calendarEvent.notes, CALENDAR_NOTES);
  assert.ok(calendarEvent.startDate instanceof Date);
  assert.equal(buildCalendarEventFromSnapshot(null), null);

  const revived = reviveEventDates({ startDate: 'not a date', endDate: '2026-07-06T03:00:00.000Z' });
  assert.equal(revived.startDate, 'not a date', 'unparseable dates stay untouched');
  assert.ok(revived.endDate instanceof Date);

  // Date-object vs ISO-string must not count as a difference
  assert.deepEqual(
    diffEvents(
      { title: 'X', startDate: '2026-07-05T22:00:00.000Z' },
      { title: 'X', startDate: new Date('2026-07-05T22:00:00.000Z') }
    ),
    []
  );
});

test('replay-run CLI prints a readable diff and supports --json', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-run-test-'));
  const runPath = path.join(tmpDir, 'run.json');
  try {
    fs.writeFileSync(runPath, JSON.stringify(buildFixtureRun()));

    const text = execFileSync(process.execPath, [REPLAY_CLI, runPath], { encoding: 'utf8' });
    assert.match(text, /Replayed 3 scraped event\(s\)/);
    assert.match(text, /no differences/);

    const json = JSON.parse(execFileSync(process.execPath, [REPLAY_CLI, runPath, '--json'], { encoding: 'utf8' }));
    assert.equal(json.ok, true);
    assert.equal(json.counts.replayed, 2);

    const help = execFileSync(process.execPath, [REPLAY_CLI, '--help'], { encoding: 'utf8' });
    assert.match(help, /Usage: node tools\/replay-run\.js/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

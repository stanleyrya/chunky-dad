const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ---------------------------------------------------------------------------
// tools/audit-saved-events.js — the one-time audit of the events already on
// the calendars. Report-only, Node-only; never ships to the phone.
// ---------------------------------------------------------------------------
const audit = require('../tools/audit-saved-events');

const DAY = 24 * 3600 * 1000;
const NOW = Date.now();

function stamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function vevent({ uid, title, startMs, notes = '', location = '' }) {
  return [
    'BEGIN:VEVENT',
    `DTSTART:${stamp(startMs)}`,
    `DTEND:${stamp(startMs + 4 * 3600 * 1000)}`,
    `DTSTAMP:${stamp(NOW)}`,
    `UID:${uid}`,
    `DESCRIPTION:${notes.replace(/,/g, '\\,').replace(/\n/g, '\\n')}`,
    location ? `LOCATION:${location}` : '',
    `SUMMARY:${title}`,
    'END:VEVENT'
  ].filter(Boolean).join('\r\n');
}

function calendar(events) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR', ''].join('\r\n');
}

function quietly(run) {
  const channels = ['log', 'info', 'warn', 'debug'];
  const spoken = channels.map((channel) => console[channel]);
  channels.forEach((channel) => { console[channel] = () => {}; });
  return Promise.resolve().then(run).finally(() => {
    channels.forEach((channel, index) => { console[channel] = spoken[index]; });
  });
}

function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-saved-'));
  const calendarsDir = path.join(root, 'calendars');
  const sharedRoot = path.join(root, 'shared');
  fs.mkdirSync(calendarsDir, { recursive: true });
  fs.mkdirSync(path.join(sharedRoot, 'runs'), { recursive: true });
  const soon = NOW + 30 * DAY;
  fs.writeFileSync(path.join(calendarsDir, 'nyc.ics'), calendar([
    vevent({ uid: 'kept-keyword@test', title: 'Bear Bust', startMs: soon, notes: 'bar: The Eagle NYC\nbearSource: keyword' }),
    vevent({ uid: 'kept-tagged@test', title: 'Leather Social', startMs: soon + DAY, notes: 'bar: The Eagle NYC' }),
    vevent({ uid: 'kept-flagged@test', title: 'Disco Night', startMs: soon + 2 * DAY, notes: 'bar: The Eagle NYC' }),
    vevent({ uid: 'ruled-out@test', title: 'Karaoke Tuesday', startMs: soon + 3 * DAY, notes: 'bar: The Eagle NYC\nbearSource: manual-not-bear (verdict store 2030-01-01)' }),
    vevent({ uid: 'ruled-in@test', title: 'Sunday Tea', startMs: soon + 4 * DAY, notes: 'bar: The Eagle NYC\nbearSource: manual-bear (verdict store 2030-01-01)' }),
    vevent({ uid: 'unseen@test', title: 'Trivia', startMs: soon + 5 * DAY, notes: 'bar: The Eagle NYC' }),
    vevent({ uid: 'over@test', title: 'Bear Bust', startMs: NOW - 3 * DAY, notes: 'bar: The Eagle NYC' })
  ]));
  const analyzed = (uid, title, extra) => ({
    title, city: 'nyc', bar: 'The Eagle NYC', _action: 'merge', _existingEvent: { identifier: `CALENDAR-ID:${uid}` }, ...extra
  });
  fs.writeFileSync(path.join(sharedRoot, 'runs', '20300101-000000.json'), JSON.stringify({
    analyzedEvents: [
      analyzed('kept-keyword@test', 'Bear Bust', { bearSource: 'keyword' }),
      analyzed('kept-tagged@test', 'Leather Social', { bearSource: 'tagged (ai: a leather night)', tags: ['leather'] }),
      analyzed('kept-flagged@test', 'Disco Night', { bearSource: '', bearReview: 'unsure — ai: nothing names a crowd' })
    ],
    bearDroppedEvents: []
  }));
  return { root, calendarsDir, sharedRoot };
}

test('audit: reads the checkout calendars, classes each saved event by its best evidence, writes nothing', async () => {
  const fixture = buildFixture();
  const before = fs.readdirSync(fixture.sharedRoot).sort();
  const report = await quietly(() => audit.runAudit({
    sharedRoot: fixture.sharedRoot, calendarsDir: fixture.calendarsDir, city: 'nyc', ai: false, now: NOW
  }));
  const byUid = Object.fromEntries(report.parties.map((party) => [party.uids[0], party]));

  // The event that already ended is not part of the audit.
  assert.equal(report.totals.singles.events, 6);
  assert.equal(byUid['over@test'], undefined);

  assert.deepEqual([byUid['kept-keyword@test'].class, byUid['kept-keyword@test'].ruledBy, byUid['kept-keyword@test'].tier, byUid['kept-keyword@test'].evidence],
    ['bear', 'machine', 'keyword-title', 'run-kept']);
  assert.deepEqual([byUid['kept-tagged@test'].class, byUid['kept-tagged@test'].ruledBy], ['tagged', 'machine']);
  // Kept with a flag is neither a yes nor a no.
  assert.equal(byUid['kept-flagged@test'].class, 'review');
  // The owner's stamp on the saved record is his word: never re-asked.
  assert.deepEqual([byUid['ruled-out@test'].class, byUid['ruled-out@test'].ruledBy], ['not-bear', 'owner']);
  assert.deepEqual([byUid['ruled-in@test'].class, byUid['ruled-in@test'].ruledBy], ['bear', 'owner']);
  // Unseen by the run and no model to ask: unjudged, never guessed.
  assert.deepEqual([byUid['unseen@test'].class, byUid['unseen@test'].evidence], ['unjudged', 'copy']);

  // Report-only: the shared folder is exactly as it was.
  assert.deepEqual(fs.readdirSync(fixture.sharedRoot).sort(), before);
  assert.deepEqual(fs.readdirSync(path.join(fixture.sharedRoot, 'runs')), ['20300101-000000.json']);
  fs.rmSync(fixture.root, { recursive: true, force: true });
});

test('audit: a dropped row is matched to its saved record by the calendar matcher, and the store outranks the machine', async () => {
  const fixture = buildFixture();
  const soon = NOW + 30 * DAY;
  const runPath = path.join(fixture.sharedRoot, 'runs', '20300101-000000.json');
  const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
  const droppedEvent = {
    title: 'Trivia', city: 'nyc', bar: 'The Eagle NYC',
    startDate: new Date(soon + 5 * DAY).toISOString(), endDate: new Date(soon + 5 * DAY + 4 * 3600 * 1000).toISOString()
  };
  run.bearDroppedEvents = [
    { title: 'Trivia', reason: 'ai: a general-audience quiz night', event: droppedEvent },
    { title: 'Trivia', reason: 'manual store: not_bear (verdict stamped 2030-01-01)', event: { ...droppedEvent } },
    // A dropped event that is on no calendar matches nothing.
    { title: 'Bingo', reason: 'ai: bingo', event: { ...droppedEvent, title: 'Drag Bingo Spectacular', startDate: new Date(soon + 9 * DAY).toISOString(), endDate: new Date(soon + 9 * DAY + 3600 * 1000).toISOString() } }
  ];
  fs.writeFileSync(runPath, JSON.stringify(run));
  const report = await quietly(() => audit.runAudit({
    sharedRoot: fixture.sharedRoot, calendarsDir: fixture.calendarsDir, city: 'nyc', ai: false, now: NOW
  }));
  const trivia = report.parties.find((party) => party.uids[0] === 'unseen@test');
  assert.deepEqual([trivia.class, trivia.ruledBy, trivia.evidence], ['not-bear', 'owner', 'run-dropped']);
  assert.equal(report.totals.singles.events, 6);
  fs.rmSync(fixture.root, { recursive: true, force: true });
});

test('audit: the adapter has no shared storage root and reads no phone snapshot', async () => {
  const fixture = buildFixture();
  const previous = process.env.CHUNKY_SHARED_STORAGE_DIR;
  process.env.CHUNKY_SHARED_STORAGE_DIR = fixture.sharedRoot;
  try {
    const adapter = audit.createAuditAdapter({ cities: {}, calendarsDir: fixture.calendarsDir });
    assert.equal(adapter.resolveSharedStorageRootSetting(), '');
    assert.equal(await adapter.getPhoneCalendarSnapshot('nyc'), null);
    const published = await adapter.getPublishedCalendarEvents('nyc');
    assert.equal(published.records.length, 7);
    assert.equal(await adapter.getPublishedCalendarEvents('no-such-city'), null);
  } finally {
    if (previous === undefined) delete process.env.CHUNKY_SHARED_STORAGE_DIR;
    else process.env.CHUNKY_SHARED_STORAGE_DIR = previous;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('audit: the nights of one party are one row, a series is counted apart', () => {
  const core = {
    getBearVerdictTitleKey: (title) => String(title).toLowerCase(),
    getOwnerReviewPlaceKey: (event) => String(event.bar || '').toLowerCase()
  };
  const item = (uid, title, verdict, evidence, series = false) => ({
    record: { uid, city: 'nyc', startDate: new Date(NOW + DAY), nights: series ? 12 : 1, series },
    event: { title, bar: 'The Eagle NYC' },
    evidence,
    verdict
  });
  const bear = { class: 'bear', ruledBy: 'machine', tier: 'keyword-title', reason: 'keyword' };
  const report = audit.buildReport(core, [
    item('a', 'Bear Bust', bear, 'run-kept'),
    item('b', 'Bear Bust', bear, 'run-kept'),
    item('c', 'Bear Bust', { class: 'unjudged', ruledBy: 'machine', tier: 'none', reason: '' }, 'copy'),
    item('d', 'Bear Happy Hour', bear, 'copy', true)
  ], { runId: 'x', cities: 1, askedFromCopy: 0 });
  assert.deepEqual(report.totals, { singles: { events: 3, parties: 1 }, series: { events: 1, parties: 1 } });
  assert.deepEqual(report.singles, { 'bear · machine': { events: 3, parties: 1 } });
  assert.equal(report.mixedParties, 1);
  assert.match(audit.formatReport(report), /singles: 3 events in 1 parties/);
});

test('audit: inside a bear run a stored not-bear from an ordinary night does not rule the party out; one given during the run does', async (t) => {
  // The run is read from the repo's own festivals, as the audit reads it:
  // the first bear run in a destination town whose stated dates are inside
  // the window the audit reads (the adapter's own clock, a year ahead).
  const { WebAdapter } = require('./adapters/web-adapter');
  const { SharedCore } = require('./shared-core');
  const { EventSchema } = require('./event-schema');
  const config = await quietly(() => new WebAdapter({}).loadConfiguration());
  const core = new SharedCore(config.cities, { eventSchema: EventSchema, festivals: config.festivals || [] });
  const run = (config.festivals || []).find((festival) => festival && festival.category === 'bear-run' && festival.nextDates
    && /^\d{4}-\d{2}-\d{2}$/.test(String(festival.nextDates.start || ''))
    && Date.parse(`${festival.nextDates.start}T20:00:00Z`) > Date.now() + 2 * DAY
    && Date.parse(`${festival.nextDates.start}T20:00:00Z`) < Date.now() + 390 * DAY
    && core.getBearRunKeyForEvent({ city: festival.cityKey, startDate: `${festival.nextDates.start}T20:00:00Z`, timezone: 'UTC' }) !== '');
  if (!run) { t.skip('no bear run in a destination town states dates in the coming year'); return; }
  const runKey = core.getBearRunKeyForEvent({ city: run.cityKey, startDate: `${run.nextDates.start}T20:00:00Z`, timezone: 'UTC' });
  const night = Date.parse(`${run.nextDates.start}T20:00:00Z`);

  const auditWith = async (verdict) => {
    const fixture = buildFixture();
    fs.writeFileSync(path.join(fixture.calendarsDir, `${run.cityKey}.ics`), calendar([
      vevent({ uid: 'tea@test', title: 'Zzz Afternoon Social', startMs: night, notes: 'bar: Zzz Test Deck' })
    ]));
    fs.writeFileSync(path.join(fixture.sharedRoot, 'bear-verdicts.json'), JSON.stringify({ verdicts: [verdict] }));
    const report = await quietly(() => audit.runAudit({
      sharedRoot: fixture.sharedRoot, calendarsDir: fixture.calendarsDir, city: run.cityKey, ai: false, now: night - 10 * DAY
    }));
    fs.rmSync(fixture.root, { recursive: true, force: true });
    return report.parties.find((party) => party.uids[0] === 'tea@test');
  };
  const stored = { verdict: 'not_bear', stampedAt: '2026-01-01T00:00:00.000Z', title: 'Zzz Afternoon Social', venue: 'Zzz Test Deck', address: '', location: '', city: run.cityKey };
  const ordinary = await auditWith(stored);
  assert.notEqual(ordinary.class, 'not-bear', `kept by the run, got ${ordinary.class}`);
  const during = await auditWith({ ...stored, bearRuns: [runKey] });
  assert.equal(during.class, 'not-bear');
});

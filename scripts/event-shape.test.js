const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ---------------------------------------------------------------------------
// tools/event-shape.js — the shape report of a deck card (is it well formed,
// does its flyer agree, is it like the nights the owner approved), the
// low-risk classes built on it, and the deck's settings file. Node-only
// tooling; never ships to the phone.
// ---------------------------------------------------------------------------
const shape = require('../tools/event-shape');

const NOW = Date.UTC(2030, 8, 1);
// Thursday 2030-10-03, 22:00 in New York.
const START = '2030-10-04T02:00:00.000Z';
const END = '2030-10-04T06:00:00.000Z';
const KEY = 'event|furball nyc|rockbar|2030-10-03';

function proposal(overrides = {}) {
  return {
    kind: 'new',
    key: KEY,
    title: 'FURBALL NYC',
    startDate: START,
    endDate: END,
    timezone: 'America/New_York',
    bar: 'Rockbar',
    address: '185 Christopher St, New York, NY',
    location: '40.7326, -74.0096',
    city: 'nyc',
    url: 'https://furball.nyc/',
    image: 'https://furball.nyc/flyer.jpg',
    ...overrides
  };
}

function approvedNight(overrides = {}) {
  return {
    key: 'event|furball nyc|rockbar|2030-09-05',
    title: 'FURBALL NYC',
    startDate: '2030-09-06T02:00:00.000Z',
    timezone: 'America/New_York',
    location: '40.7326, -74.0096',
    url: 'https://furball.nyc/',
    image: 'https://furball.nyc/september.jpg',
    ...overrides
  };
}

function assess(overrides = {}, input = {}) {
  return shape.assessShape({ proposal: proposal(overrides), now: NOW, ...input });
}

function check(report, code) {
  return report.checks.find((entry) => entry.code === code);
}

test('assessShape: a well-formed card passes every check; what cannot be judged is null, never a failure', () => {
  const report = assess();
  assert.equal(report.ok, true);
  assert.deepEqual(report.failed, []);
  for (const code of ['name', 'start', 'end', 'timezone', 'venue', 'place', 'city', 'link', 'picture-link', 'pipeline-flags', 'held-back', 'slot-clash']) {
    assert.equal(check(report, code).ok, true, code);
  }
  // No ticket link, and a picture nobody has read: unknown, not wrong.
  assert.equal(check(report, 'ticket-link').ok, null);
  assert.equal(check(report, 'flyer-date').ok, null);
  assert.equal(check(report, 'flyer-date').detail, 'the picture has not been read');
  // A card with no end and no map point is still well formed.
  const bare = assess({ endDate: null, location: '' });
  assert.equal(bare.ok, true);
  assert.equal(check(bare, 'end').ok, null);
  assert.equal(check(bare, 'place').ok, null);
});

test('assessShape: the name — empty, cut off, markup, page codes, placeholders, links and separators fail in plain words', () => {
  const cases = [
    ['', 'there is no name'],
    ['MEGAWOOF PHOENIX: THE BIG…', 'the name looks cut off (it ends with …)'],
    ['<b>Bear Night</b>', 'the name has page markup in it'],
    ['Bears &amp; Beers', 'the name has a page code in it (like &amp;)'],
    ['Untitled', 'the name is a placeholder ("Untitled")'],
    ['https://example.com/party', 'the name is a link'],
    ['Bear Night |', 'the name starts or ends with a separator'],
    ['Bear\nNight', 'the name has a line break in it'],
    ['🐻🐻🐻', 'the name has no words']
  ];
  for (const [title, words] of cases) {
    const report = assess({ title });
    assert.equal(check(report, 'name').ok, false, title);
    assert.equal(check(report, 'name').detail, words);
    assert.equal(report.ok, false);
  }
  for (const title of ['🐻 BEAR HAPPY HOUR', 'BEER BLAST | NO COVER TILL 9PM | $20 COVER AT 9PM', 'XL']) {
    assert.equal(check(assess({ title }), 'name').ok, title === 'XL' ? false : true, title);
  }
});

test('assessShape: dates, timezone, place and links — an end before the start, a 52588-hour night, an unknown timezone, nowhere to go, a broken link', () => {
  assert.equal(check(assess({ endDate: START }), 'end').detail, 'the end is not after the start');
  assert.equal(check(assess({ endDate: '2036-10-04T06:00:00.000Z' }), 'end').detail, 'it runs 52612 hours');
  // A whole-day event may run past a day.
  assert.equal(check(assess({ endDate: '2030-10-07T04:00:00.000Z', wholeDay: true }), 'end').ok, true);
  assert.equal(check(assess({ startDate: 'soon' }), 'start').ok, false);
  assert.equal(check(assess({ startDate: '2033-10-04T02:00:00.000Z', endDate: null }), 'start').detail, 'the start is more than 18 months away');
  assert.equal(check(assess({ timezone: 'Mars/Olympus' }), 'timezone').ok, false);
  // A party with no named venue is real; one with no venue, address or pin is not placed.
  assert.equal(check(assess({ bar: '' }), 'venue').ok, true);
  assert.equal(check(assess({ bar: '', address: '', location: '' }), 'venue').ok, false);
  assert.equal(check(assess({ location: 'Rockbar, New York' }), 'place').ok, false);
  assert.equal(check(assess({ city: '' }), 'city').ok, false);
  assert.equal(check(assess({ url: 'furball.nyc' }), 'link').ok, false);
  assert.equal(check(assess({ ticketUrl: 'javascript:void(0)' }), 'ticket-link').ok, false);
  // A picture from the owner's inbox has its own address scheme.
  assert.equal(check(assess({ image: 'inbox:abc123' }), 'picture-link').ok, null);
});

test('assessShape: what the run already said — sanity codes, held-back flags and venue clashes each fail their own check', () => {
  const report = assess({}, { sanityCodes: ['date-far'], flags: ['a big change'], clashes: ['overlaps B BAR at the venue', 'takes the slot from B BAR (weekly)'] });
  assert.deepEqual(report.failed, ['pipeline-flags', 'held-back', 'slot-clash']);
  assert.equal(check(report, 'pipeline-flags').detail, 'the run flagged it: date-far');
  assert.equal(check(report, 'held-back').detail, 'held back by the run: a big change');
  assert.equal(check(report, 'slot-clash').detail, 'overlaps B BAR at the venue; takes the slot from B BAR (weekly)');
  assert.deepEqual(shape.shapeNotices(report), ['the run flagged it: date-far', 'held back by the run: a big change', 'overlaps B BAR at the venue; takes the slot from B BAR (weekly)']);
});

test('assessShape: the flyer as a witness — a printed day that is not the card’s fails; the same day, a range around it, or the night before an after-midnight start pass', () => {
  const flyer = (text) => ({ flyer: { text } });
  const agrees = assess({}, flyer('FURBALL NYC\nTHURSDAY OCTOBER 3\nROCKBAR 10PM'));
  assert.equal(agrees.ok, true);
  assert.equal(check(agrees, 'flyer-date').ok, true);
  assert.equal(check(agrees, 'flyer-date').detail, 'the flyer says October 3');
  assert.equal(check(agrees, 'flyer-weekday').ok, true);
  assert.equal(check(agrees, 'flyer-name').ok, true);

  const wrongDay = assess({}, flyer('FURBALL NYC\nNOVEMBER 27'));
  assert.equal(check(wrongDay, 'flyer-date').ok, false);
  assert.equal(check(wrongDay, 'flyer-date').detail, 'the flyer says November 27; this card is Thursday October 3');
  assert.equal(wrongDay.ok, false);

  // A weekend's flyer covers the nights between its printed days.
  assert.equal(check(assess({}, flyer('BEAR WEEKEND OCTOBER 2 - OCTOBER 5')), 'flyer-date').ok, true);
  // Two printed days far apart are two dates, not a range.
  assert.equal(check(assess({}, flyer('SEPTEMBER 5 and NOVEMBER 7')), 'flyer-date').ok, false);

  // 1:00 on Friday the 4th belongs to Thursday the 3rd's flyer.
  const late = assess({ startDate: '2030-10-04T05:00:00.000Z', endDate: '2030-10-04T08:00:00.000Z' }, flyer('THURSDAY OCTOBER 3'));
  assert.equal(check(late, 'flyer-date').ok, true);
  assert.equal(check(late, 'flyer-weekday').ok, true);

  const wrongWeekday = assess({}, flyer('EVERY SATURDAY'));
  assert.equal(check(wrongWeekday, 'flyer-weekday').ok, false);
  assert.equal(check(wrongWeekday, 'flyer-weekday').detail, 'the flyer says Saturday; this card is a Thursday');
});

test('assessShape: a year on a flyer counts only next to a printed day; a month alone must be the card’s month; a nameless flyer proves nothing', () => {
  const flyer = (text) => ({ flyer: { text } });
  // A founding year or a title year alone is not a date.
  assert.equal(check(assess({}, flyer('FURBALL NYC — SINCE 2019')), 'flyer-date').ok, null);
  // Last year's flyer: the right day, the wrong year.
  const lastYear = assess({}, flyer('FURBALL NYC OCTOBER 3, 2029'));
  assert.equal(check(lastYear, 'flyer-date').ok, false);
  assert.equal(check(lastYear, 'flyer-date').detail, 'the flyer says October 3 2029; this card is in 2030');
  assert.equal(check(assess({}, flyer('OCTOBER 3, 2030')), 'flyer-date').ok, true);
  // A month with no day.
  assert.equal(check(assess({}, flyer('COMING THIS DECEMBER')), 'flyer-date').ok, false);
  assert.equal(check(assess({}, flyer('ALL OCTOBER LONG')), 'flyer-date').ok, null);
  // "May" and "Mar" alone are words, not months.
  assert.equal(check(assess({}, flyer('MAY THE BEST BEAR WIN')), 'flyer-date').ok, null);
  // The name: positive evidence only.
  assert.equal(check(assess({}, flyer('DJ SETS ALL NIGHT LONG')), 'flyer-name').ok, null);
  assert.equal(assess({}, flyer('DJ SETS ALL NIGHT LONG')).ok, true);
});

test('assessShape: a new night is compared with the nights he approved — name, start time, map point, link host and picture', () => {
  const history = { approved: [approvedNight()] };
  const same = assess({}, { history });
  assert.equal(same.ok, true);
  for (const code of ['usual-name', 'usual-time', 'usual-place', 'usual-link', 'usual-picture']) assert.equal(check(same, code).ok, true, code);

  const renamed = assess({ title: 'FURBALL NYC: HALLOWEEN' }, { history });
  assert.equal(check(renamed, 'usual-name').ok, false);
  assert.match(check(renamed, 'usual-name').detail, /this exact name is new for the party \(approved before: "FURBALL NYC"\)/);

  // 22:00 against 22:00 passes; 17:00 is five hours off.
  const early = assess({ startDate: '2030-10-03T21:00:00.000Z', endDate: '2030-10-04T01:00:00.000Z' }, { history });
  assert.equal(check(early, 'usual-time').ok, false);
  assert.equal(check(assess({ startDate: '2030-10-04T03:00:00.000Z' }, { history }), 'usual-time').ok, true);

  const moved = assess({ location: '40.7700, -73.9800' }, { history });
  assert.equal(check(moved, 'usual-place').ok, false);
  assert.match(check(moved, 'usual-place').detail, /^the map point is \d+\.\d km from the approved nights$/);

  assert.equal(check(assess({ url: 'https://tickets.example.com/furball' }, { history }), 'usual-link').ok, false);
  assert.equal(check(assess({ url: '' }, { history }), 'usual-link').detail, 'the approved nights had a link; this one has none');
  assert.equal(check(assess({ image: '' }, { history }), 'usual-picture').ok, false);
  // A party that never had a picture is not missing one.
  assert.equal(check(assess({ image: '' }, { history: { approved: [approvedNight({ image: '' })] } }), 'usual-picture').ok, null);
  // No history: nothing to compare, no usual checks at all.
  assert.equal(check(assess(), 'usual-name'), undefined);
});

test('assessShape: an update is judged by what it changes — an emptied field, a moved pin, a moved start, a description cut in half', () => {
  const update = (changes, kind = 'merge') => assess({ kind, changes });
  assert.equal(update({ endDate: { from: END, to: '2030-10-04T07:00:00.000Z' } }).ok, true);
  const emptied = update({ image: { from: 'https://furball.nyc/flyer.jpg', to: '' } });
  assert.equal(check(emptied, 'update-keeps-values').detail, 'the update empties: image');
  const moved = update({ location: { from: '40.7326, -74.0096', to: '40.7700, -73.9800' } });
  assert.equal(check(moved, 'update-place').ok, false);
  assert.equal(check(update({ location: { from: '40.7326, -74.0096', to: '40.7327, -74.0097' } }), 'update-place').ok, true);
  const later = update({ startDate: { from: START, to: '2030-10-04T22:00:00.000Z' } }, 'override');
  assert.equal(check(later, 'update-start').ok, false);
  assert.equal(check(later, 'update-start').detail, 'the update moves the start by 20 hours');
  assert.equal(check(update({ startDate: { from: START, to: '2030-10-04T03:00:00.000Z' } }), 'update-start').ok, true);
  const long = 'A long description of the night, the DJs, the door price and the dress code. '.repeat(3);
  assert.equal(check(update({ description: { from: long, to: 'Bear night.' } }), 'update-text').ok, false);
  assert.equal(check(update({ description: { from: long, to: long + ' More.' } }), 'update-text'), undefined);
});

test('classifyLowRisk: a clean repeat night, a series night and a quiet update are the three classes; a failed check, a second look, a standing not-bear or a renamed update is none', () => {
  const clean = { ok: true };
  const history = { approved: [approvedNight()], standingNotBear: false };
  assert.equal(shape.classifyLowRisk({ proposal: proposal(), shape: clean, history }), 'repeat');
  assert.equal(shape.classifyLowRisk({ proposal: proposal(), shape: clean, history: { approved: [] } }), null);
  assert.equal(shape.classifyLowRisk({ proposal: proposal(), shape: clean, history: { ...history, standingNotBear: true } }), null);
  assert.equal(shape.classifyLowRisk({ proposal: proposal(), shape: { ok: false }, history }), null);
  // A second look at this very card is his; another night's approval is what makes it a repeat.
  assert.equal(shape.classifyLowRisk({ proposal: proposal(), shape: clean, history, prior: { verdict: 'approve', drift: ['image'] } }), null);
  assert.equal(shape.classifyLowRisk({ proposal: proposal(), shape: clean, history, prior: { verdict: 'approve', night: '2030-09-05', drift: ['image'] } }), 'repeat');
  assert.equal(shape.classifyLowRisk({ proposal: proposal(), shape: clean, history, prior: { verdict: 'reject', night: '2030-09-05' } }), null);
  assert.equal(shape.classifyLowRisk({ proposal: proposal({ kind: 'merge', changes: { endDate: {} } }), shape: clean, prior: { verdict: 'approve', night: '2030-09-05' } }), null);
  assert.equal(shape.classifyLowRisk({ proposal: proposal(), history }), null);
  assert.equal(shape.classifyLowRisk({ proposal: proposal({ kind: 'override', changes: { title: {}, location: {} } }), shape: clean }), 'series-night');
  assert.equal(shape.classifyLowRisk({ proposal: proposal({ kind: 'merge', changes: { endDate: {}, image: {} } }), shape: clean }), 'quiet-merge');
  assert.equal(shape.classifyLowRisk({ proposal: proposal({ kind: 'merge', changes: { title: {} } }), shape: clean }), null);
  assert.equal(shape.classifyLowRisk({ proposal: proposal({ kind: 'merge', changes: { url: {} } }), shape: clean }), null);
  assert.equal(shape.classifyLowRisk({ proposal: proposal({ kind: 'merge', changes: {} }), shape: clean }), null);
  for (const kind of ['series', 'bar', 'dropped', 'remove']) assert.equal(shape.classifyLowRisk({ proposal: proposal({ kind }), shape: clean, history }), null, kind);
});

test('party history: only the owner’s own approvals teach "the usual"; a later not-bear stands; the card’s own night is left out', () => {
  const decisions = [
    { key: 'event|furball nyc|rockbar|2030-09-05', kind: 'new', verdict: 'approve', stampedAt: '2030-09-01T10:00:00.000Z', reason: null, snapshot: { title: 'FURBALL NYC' } },
    // Approved by the deck under a switch: never part of the usual.
    { key: 'event|furball nyc|rockbar|2030-09-12', kind: 'new', verdict: 'approve', stampedAt: '2030-09-02T10:00:00.000Z', reason: { tags: [], text: shape.lowRiskAutoReasonText('repeat') }, snapshot: { title: 'FURBALL NYC DRIFTED' } },
    { key: KEY, kind: 'new', verdict: 'approve', stampedAt: '2030-09-03T10:00:00.000Z', reason: null, snapshot: { title: 'FURBALL NYC' } },
    { key: 'event|other party|rockbar|2030-09-05', kind: 'new', verdict: 'reject', stampedAt: '2030-09-04T10:00:00.000Z', reason: { tags: ['not bear'], text: '' } },
    { key: 'bar|rockbar', kind: 'bar', verdict: 'approve', stampedAt: '2030-09-04T10:00:00.000Z' }
  ];
  const history = shape.buildPartyHistory(decisions);
  assert.equal(shape.partyOf(KEY), 'furball nyc|rockbar');
  assert.equal(shape.partyOf('bar|rockbar'), '');
  const mine = shape.historyFor(history, KEY);
  assert.deepEqual(mine.approved.map((night) => night.key), ['event|furball nyc|rockbar|2030-09-05']);
  assert.equal(mine.standingNotBear, false);
  assert.deepEqual(shape.historyFor(history, 'event|other party|rockbar|2030-10-03'), { approved: [], standingNotBear: true });
  assert.deepEqual(shape.historyFor(history, 'event|nobody|nowhere|2030-10-03'), { approved: [], standingNotBear: false });
  // A not-bear, then an approval after it: the approval stands.
  const reversed = shape.buildPartyHistory([
    { key: 'event|p|v|2030-09-05', kind: 'new', verdict: 'reject', stampedAt: '2030-09-01T10:00:00.000Z', reason: { tags: ['not bear'] } },
    { key: 'event|p|v|2030-09-12', kind: 'new', verdict: 'approve', stampedAt: '2030-09-02T10:00:00.000Z', snapshot: { title: 'P' } }
  ]);
  assert.equal(shape.historyFor(reversed, 'event|p|v|2030-10-03').standingNotBear, false);
});

test('the words of an automatic approval: written per class, read back to the class, and nothing else reads as one', () => {
  for (const cls of Object.keys(shape.LOW_RISK_CLASSES)) {
    assert.equal(shape.readLowRiskAutoClass({ tags: [], text: shape.lowRiskAutoReasonText(cls) }), cls);
  }
  assert.equal(shape.lowRiskAutoReasonText('series-night'), 'auto: low risk (series-night)');
  assert.equal(shape.readLowRiskAutoClass(null), null);
  assert.equal(shape.readLowRiskAutoClass({ text: 'auto: the fix arrived (image)' }), null);
  assert.equal(shape.readLowRiskAutoClass({ text: 'auto: low risk (made-up)' }), null);
  assert.equal(shape.readLowRiskAutoClass({ text: 'wrong picture' }), null);
});

test('flyer text index: storage/ocr is read by image address, the newest answer wins, a re-signed link finds its picture, junk files are skipped', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'event-shape-ocr-'));
  const dir = path.join(root, 'storage', 'ocr', 'furball.nyc');
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, url, cachedAt, answer) => fs.writeFileSync(path.join(dir, name), JSON.stringify({ url, cachedAt, response: { text: JSON.stringify(answer) } }));
  write('a.json', 'https://furball.nyc/flyer.jpg?sig=1', '2030-08-01T00:00:00.000Z', { text: 'OLD TEXT', imageClassification: 'flyer' });
  write('b.json', 'https://furball.nyc/flyer.jpg?sig=1', '2030-09-01T00:00:00.000Z', { text: 'FURBALL OCTOBER 3', imageClassification: 'flyer', eventSummary: 'Furball' });
  fs.writeFileSync(path.join(dir, 'broken.json'), '{not json');
  fs.writeFileSync(path.join(dir, 'no-answer.json'), JSON.stringify({ url: 'https://furball.nyc/x.jpg', response: { text: 'plain words' } }));
  const index = shape.buildFlyerTextIndex(root);
  assert.equal(index.size, 1);
  assert.equal(index.lookup('https://furball.nyc/flyer.jpg?sig=1').text, 'FURBALL OCTOBER 3');
  assert.equal(index.lookup('https://furball.nyc/flyer.jpg?sig=2').text, 'FURBALL OCTOBER 3');
  assert.equal(index.lookup('https://furball.nyc/other.jpg'), null);
  assert.equal(index.lookup(''), null);
  // No storage at all is an empty index, not an error.
  assert.equal(shape.buildFlyerTextIndex(path.join(root, 'missing')).size, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('deck settings: every switch is off until the owner turns it on; changes are validated; a pulled-out card is forgotten once its night has passed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'event-shape-settings-'));
  assert.deepEqual(shape.loadDeckSettings(root), { version: 1, auto: { repeat: false, 'series-night': false, 'quiet-merge': false }, held: {} });
  // Only a literal true turns a switch on.
  assert.deepEqual(shape.normalizeDeckSettings({ auto: { repeat: 'yes', 'series-night': true, other: true }, held: ['x'] }).auto, { repeat: false, 'series-night': true, 'quiet-merge': false });

  const now = Date.UTC(2030, 9, 1);
  let settings = shape.applyDeckSettingsChange(shape.emptyDeckSettings(), { auto: { 'series-night': true } }, now);
  settings = shape.applyDeckSettingsChange(settings, { hold: [KEY, 'event|old party|bar|2030-09-01'] }, now);
  assert.equal(settings.auto['series-night'], true);
  assert.deepEqual(Object.keys(settings.held), [KEY, 'event|old party|bar|2030-09-01']);
  const saved = shape.saveDeckSettings(root, settings, now);
  assert.deepEqual(Object.keys(saved.held), [KEY], 'a night more than two days past is pruned on save');
  assert.deepEqual(shape.loadDeckSettings(root), saved);
  assert.deepEqual(fs.readdirSync(root), [shape.DECK_SETTINGS_FILE_NAME], 'saved atomically, no temp file left');
  assert.deepEqual(shape.applyDeckSettingsChange(saved, { release: KEY }, now).held, {});
  assert.equal(shape.applyDeckSettingsChange(saved, { auto: { 'series-night': false } }, now).auto['series-night'], false);

  assert.throws(() => shape.applyDeckSettingsChange(saved, { auto: { everything: true } }), /must be one of repeat, series-night, quiet-merge/);
  assert.throws(() => shape.applyDeckSettingsChange(saved, { hold: ['  '] }), /hold needs a key/);
  assert.throws(() => shape.applyDeckSettingsChange(saved, { release: [42] }), /release needs a key/);
  assert.throws(() => shape.applyDeckSettingsChange(saved, {}), /needs auto, hold or release/);
  assert.throws(() => shape.applyDeckSettingsChange(saved, null), /must be an object/);

  // A corrupt file reads as every switch off.
  fs.writeFileSync(shape.getDeckSettingsPath(root), '{broken');
  const warn = console.warn; console.warn = () => {};
  try { assert.deepEqual(shape.loadDeckSettings(root), shape.emptyDeckSettings()); } finally { console.warn = warn; }
  fs.rmSync(root, { recursive: true, force: true });
});

test('buildShapeReport: one row per card with a report, the totals a second reader needs, and only the checks that say something', () => {
  const clean = assess({}, { flyer: { text: 'FURBALL NYC THURSDAY OCTOBER 3' } });
  const bad = assess({ title: 'Untitled', key: 'event|untitled|rockbar|2030-10-03' }, { clashes: ['overlaps B BAR at the venue'] });
  const deck = {
    runId: '20301001-051500',
    lowRisk: { auto: { repeat: false, 'series-night': true, 'quiet-merge': false } },
    cards: [
      { key: KEY, kind: 'new', proposal: proposal({ source: 'Furball' }), shape: clean, lowRisk: 'repeat' },
      { key: 'event|untitled|rockbar|2030-10-03', kind: 'new', proposal: proposal({ title: 'Untitled' }), shape: bad },
      { key: 'event|held|rockbar|2030-10-03', kind: 'override', proposal: proposal({ kind: 'override' }), shape: clean, lowRiskHeld: 'series-night' },
      { key: 'bar|rockbar', kind: 'bar', proposal: { name: 'Rockbar' } }
    ],
    decided: [
      { key: 'event|auto|rockbar|2030-10-03', kind: 'override', proposal: proposal({ kind: 'override' }), shape: clean, decision: { verdict: 'approve', reason: { text: shape.lowRiskAutoReasonText('series-night') } } },
      { key: 'event|his|rockbar|2030-10-03', kind: 'new', proposal: proposal(), shape: clean, decision: { verdict: 'reject', reason: { text: 'wrong picture' } } }
    ]
  };
  const report = shape.buildShapeReport(deck);
  assert.equal(report.runId, '20301001-051500');
  assert.deepEqual(report.summary, {
    cards: 5,
    passed: 4,
    flagged: 1,
    failedByCheck: { name: 1, 'slot-clash': 1 },
    lowRisk: { repeat: 1, 'series-night': 0, 'quiet-merge': 0 },
    auto: { repeat: false, 'series-night': true, 'quiet-merge': false }
  });
  const [first, second, third, fourth, fifth] = report.cards;
  assert.deepEqual([first.state, first.lowRisk, first.ok, first.source], ['pending', 'repeat', true, 'Furball']);
  assert.deepEqual(first.checks.map((entry) => entry.code), ['flyer-date', 'flyer-weekday', 'flyer-name'], 'silent passes are left out');
  assert.deepEqual(second.failed, ['name', 'slot-clash']);
  assert.equal(third.pulledOut, 'series-night');
  assert.deepEqual([fourth.state, fourth.approvedForYou, fourth.lowRisk], ['approve', 'series-night', null]);
  assert.deepEqual([fifth.state, fifth.approvedForYou], ['reject', null]);
  assert.deepEqual(shape.buildShapeReport(null).summary.cards, 0);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cli = require('../tools/add-deck-card');
const rq = require('../tools/review-queue');

const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN',
  'BEGIN:VEVENT', 'UID:AAAA-1111', 'DTSTAMP:20300101T000000Z', 'DTSTART:20301016T080000Z', 'DTEND:20301018T050000Z', 'SUMMARY:Furry Friday', 'LOCATION:-33.87\\, 151.22',
  'DESCRIPTION:bar: Kings Cross Hotel\\naddress: 244 William St\\, Sydney', 'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

test('add-deck-card: an edit card reads the saved record from the published calendar (title, night, bar) and takes its current value as the before; choose and list and drop work; a missing uid is an error', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-deckcard-repo-'));
  fs.mkdirSync(path.join(repoRoot, 'data', 'calendars'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'data', 'calendars', 'sydney.ics'), ICS);
  const sharedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-deckcard-shared-'));
  const logs = [];
  const log = (line) => logs.push(String(line));
  const now = new Date('2030-10-01T00:00:00.000Z');
  const RealDate = Date;
  global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [now.getTime()])); } static now() { return now.getTime(); } };
  try {
    const edit = cli.main(['edit', '--city', 'sydney', '--uid', 'AAAA-1111', '--why', 'end runs to Sunday', '--set', 'endDate=2030-10-16T11:00:00.000Z'], { repoRoot, sharedRoot, log }).card;
    assert.equal(edit.title, 'Furry Friday');
    assert.equal(edit.bar, 'Kings Cross Hotel');
    assert.equal(edit.startDate, '2030-10-16T08:00:00.000Z');
    assert.deepEqual(edit.changes, { endDate: { from: '2030-10-18T05:00:00.000Z', to: '2030-10-16T11:00:00.000Z' } });
    assert.equal(edit.key, 'manual|edit-sydney-furry-friday-2030-10-16');
    const choose = cli.main(['choose', '--title', 'A or B?', '--why', 'both saved', '--option', 'Keep A', '--option', 'Keep B'], { repoRoot, sharedRoot, log }).card;
    assert.deepEqual(choose.options, ['Keep A', 'Keep B']);
    const listed = cli.main(['list'], { repoRoot, sharedRoot, log }).cards;
    assert.deepEqual(listed.map((c) => c.action).sort(), ['choose', 'edit']);
    assert.equal(rq.loadManualCards(rq.getManualCardsPath(sharedRoot)).cards.length, 2, 'written to the shared dir');
    assert.equal(cli.main(['drop', '--key', choose.key], { repoRoot, sharedRoot, log }).removed, true);
    assert.throws(() => cli.main(['remove', '--city', 'sydney', '--uid', 'NOPE', '--why', 'x'], { repoRoot, sharedRoot, log }), /no saved event with uid NOPE/);
    assert.throws(() => cli.main(['edit', '--city', 'sydney', '--uid', 'AAAA-1111', '--why', 'x'], { repoRoot, sharedRoot, log }), /at least one change/);
    assert.throws(() => cli.main(['bogus'], { repoRoot, sharedRoot, log }), /usage/);
  } finally {
    global.Date = RealDate;
  }
});

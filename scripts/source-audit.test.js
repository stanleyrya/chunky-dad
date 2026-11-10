const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sourceAudit = require('../tools/source-audit');
const { SharedCore } = require('./shared-core');

// ---------------------------------------------------------------------------
// Which page the audit reads, and what the model is shown of it. The first
// week of audits read the configured url (often a home page's nav) plus up
// to two multi-event pages, glued the texts and cut them to 6000 chars — so
// the model saw only the first page and judged "no events on the page" for
// hosts whose parser read 190 events through a calendar page or a feed.
// ---------------------------------------------------------------------------

test('listingUrlsForHost: every configured url on the host (the ledger line carries one), then the run\'s multi-event pages there; other hosts out; deduped; capped at four', () => {
  const results = { parserResults: [
    { name: 'Eagle', config: { urls: ['https://eaglela.com/', 'https://eaglela.com/calendar/', 'https://www.eventbrite.com/o/eagle'] }, urlClassifications: { 'https://eaglela.com/': 'multi-event-page', 'https://eaglela.com/events/': 'multi-event-page', 'https://eaglela.com/events/bluf/': 'event-page', 'https://www.eventbrite.com/e/1': 'multi-event-page' } },
    { name: 'Eagle Shop', config: { urls: ['https://www.eaglela.com/shop/'] }, urlClassifications: { 'https://eaglela.com/more/': 'multi-event-page', 'https://eaglela.com/even-more/': 'multi-event-page' } }
  ] };
  assert.deepEqual(sourceAudit.listingUrlsForHost(results, 'eaglela.com', 'https://eaglela.com/'),
    ['https://eaglela.com/', 'https://eaglela.com/calendar/', 'https://www.eaglela.com/shop/', 'https://eaglela.com/events/'],
    'configured urls of both parsers first (www folded), then the multi-event pages, four at most');
  assert.deepEqual(sourceAudit.listingUrlsForHost(results, 'eventbrite.com', ''), ['https://www.eventbrite.com/o/eagle', 'https://www.eventbrite.com/e/1']);
  assert.deepEqual(sourceAudit.listingUrlsForHost(null, 'eaglela.com', 'https://eaglela.com/'), ['https://eaglela.com/']);
  assert.deepEqual(sourceAudit.listingUrlsForHost({}, 'nowhere.example', ''), []);
});

test('sniffPageKind: a JSON API, an ICS calendar and an XML feed are doors, not pages', () => {
  assert.equal(sourceAudit.sniffPageKind('{"events":[]}'), 'json');
  assert.equal(sourceAudit.sniffPageKind('﻿  [\n{"id":1}]'), 'json');
  assert.equal(sourceAudit.sniffPageKind('BEGIN:VCALENDAR\r\nVERSION:2.0'), 'ics');
  assert.equal(sourceAudit.sniffPageKind('<?xml version="1.0"?><rss>'), 'xml');
  assert.equal(sourceAudit.sniffPageKind('<rss version="2.0">'), 'xml');
  assert.equal(sourceAudit.sniffPageKind('<!DOCTYPE html><html>'), 'html');
  assert.equal(sourceAudit.sniffPageKind(''), 'html');
});

test('composeAuditText: the page naming the most extracted events comes first, every page gets an equal share of the cap, a short page hands its leftover down, the total never exceeds the cap', () => {
  const home = { url: 'https://x.example/', text: 'Home About Shop Contact Hours Menu '.repeat(40) };          // 1440 chars of nav
  const calendar = { url: 'https://x.example/calendar/', text: 'Fri Oct 24 · Bear Night · 9PM\nSat Oct 25 · Beer Bust · 3PM\n'.repeat(30) }; // 1830 chars
  const tiny = { url: 'https://x.example/about/', text: 'About us.' };
  const out = sourceAudit.composeAuditText([home, calendar, tiny], 900, ['Bear Night', 'Beer Bust', 'Trivia']);
  assert.deepEqual(out.pages.map(page => [page.url, page.hits]), [['https://x.example/calendar/', 2], ['https://x.example/', 0], ['https://x.example/about/', 0]], 'ranked by extracted titles named');
  assert.equal(out.pages[2].shown, 9, 'the short page shows whole');
  assert.equal(out.pages[0].shown, 300 + (300 - 9), 'the leader takes what the short page left over');
  assert.equal(out.pages[1].shown, 300);
  assert.ok(out.text.startsWith('[https://x.example/calendar/]\nFri Oct 24 · Bear Night'), out.text.slice(0, 80));
  assert.ok(out.text.includes('[https://x.example/]\nHome About'));
  assert.ok(out.pages.reduce((sum, page) => sum + page.shown, 0) <= 900);
  // One page: no header, just the text up to the cap.
  const one = sourceAudit.composeAuditText([calendar], 100, []);
  assert.equal(one.text, calendar.text.slice(0, 100));
  assert.deepEqual(sourceAudit.composeAuditText([], 100, []), { text: '', pages: [] });
  assert.equal(sourceAudit.PAGE_TEXT_CAP, 6000, 'the cap itself is unchanged: the measured listing pages have a median of 1.9k readable chars, p90 5.3k');
});

test('parseAuditAnswer, stricter: a "wrong" whose page quote is not on the page is reasoning, not a finding; a "fake" must be the extracted title or contain it — a heading inside a real title names nothing', () => {
  const events = [
    { title: 'Haunted Hoedown', day: '2026-10-29', time: '8:00 PM', place: 'The Heretic' },
    { title: 'Sunday Remix with Rob Reum', day: '2026-10-18', time: '1:00 PM', place: 'Atlanta Eagle' },
    { title: 'Bear Happy Hour', day: '2026-10-29', time: '6:00 PM', place: 'Precinct LA' },
    { title: 'Load More', day: '2026-10-20', time: '', place: '' }
  ];
  const pageText = 'Events\nHAPPY HOUR\nSunday Remix with Rob Reum\nOctober 18, 2026 4:00 pm – 8:00 pm\nHAPPY HOUR\nLoad More\nLoad More\nTHURSDAY, OCT. 29\nHaunted Hoedown\n';
  const answer = JSON.stringify({ missing: [], note: '', fake: [
    { title: 'HAPPY HOUR', kind: 'heading', reason: 'section heading' },
    { title: 'Load More', kind: 'button', reason: 'UI control' }
  ], wrong: [
    { title: 'Haunted Hoedown', field: 'place', page: 'no venue named, but title implies host', extracted: 'The Heretic' },
    { title: 'Sunday Remix with Rob Reum', field: 'time', page: '4:00 pm – 8:00 pm', extracted: '1:00 PM' }
  ] });
  const parsed = sourceAudit.parseAuditAnswer(answer, { extracted: events.map(event => event.title), events, today: '2026-10-17', pageText });
  assert.deepEqual(parsed.wrong.map(item => [item.title, item.field]), [['Sunday Remix with Rob Reum', 'time']], 'the quoted clock is on the page and differs: a finding');
  assert.equal(parsed.unverified, 1, 'the "no venue named" row quotes nothing on the page');
  assert.deepEqual(parsed.fake.map(item => item.title), ['Load More'], '"HAPPY HOUR" is a heading inside "Bear Happy Hour", not a thing we extracted');
  // Without the page text the quote cannot be checked and the old behaviour stands.
  const blind = sourceAudit.parseAuditAnswer(answer, { extracted: events.map(event => event.title), events, today: '2026-10-17' });
  assert.equal(blind.wrong.length, 2);
});

// ---------------------------------------------------------------------------
// The run: a feed door is read for the still-on-site search but never shown
// to the model; a home page before a calendar page no longer hides it.
// ---------------------------------------------------------------------------

function payloadFor(runId, day, parsers) {
  return {
    summary: { runId, timestamp: `${day}T09:00:00.000Z` }, runContext: { environment: 'node' },
    parserResults: parsers, analyzedEvents: [], bearDroppedEvents: [], errors: []
  };
}

function seedLedger(dir, payloads) {
  fs.mkdirSync(path.join(dir, 'metrics'), { recursive: true });
  let upcoming = null; let lines = [];
  payloads.forEach(([runId, day, payload]) => {
    const built = SharedCore.buildSourceLedger(payload, { runId, previousUpcoming: upcoming, now: new Date(`${day}T12:00:00Z`) });
    upcoming = built.upcoming; lines = lines.concat(built.records);
  });
  fs.writeFileSync(path.join(dir, 'metrics', 'sources.ndjson'), lines.map(line => JSON.stringify(line)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'metrics', 'source-upcoming.json'), JSON.stringify(upcoming));
}

test('runSourceAudit: a host whose door is a JSON feed gets ai no-page / door-is-feed and the model is never asked; a host whose home page precedes its calendar page shows the model the calendar; the store keeps the reason and the page kind', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-audit-door-'));
  const event = (title, day, extra) => Object.assign({ title, startDate: `${day}T22:00:00.000Z`, bar: 'Somewhere', timezone: 'America/Los_Angeles', isBearEvent: true }, extra);
  const parsers = () => [
    { name: 'Feed Club', totalEvents: 2, config: { urls: ['https://api.feed.example/v1/events?q=club'] }, urlClassifications: { 'https://api.feed.example/v1/events?q=club': 'multi-event-page' },
      events: [event('Bear Night', '2026-11-20', { website: 'https://api.feed.example/e/1' }), event('Beer Bust', '2026-11-21', { website: 'https://api.feed.example/e/2' })] },
    { name: 'Precinct', totalEvents: 2, config: { urls: ['https://precinct.example/'] }, urlClassifications: { 'https://precinct.example/': 'multi-event-page', 'https://precinct.example/calendar/': 'multi-event-page' },
      events: [event('Bearded Pig Disco', '2026-11-22', { website: 'https://precinct.example/bpd/' }), event('Club Chub', '2026-11-23', { website: 'https://precinct.example/chub/' })] }
  ];
  seedLedger(dir, [['20261001-050000', '2026-10-01', payloadFor('20261001-050000', '2026-10-01', parsers())], ['20261002-050000', '2026-10-02', payloadFor('20261002-050000', '2026-10-02', parsers())]]);
  const fetched = [];
  const adapter = { fetchData: async (url) => {
    fetched.push(url);
    if (url.startsWith('https://api.feed.example/')) return { url, fetchedAt: '2026-10-02T01:00:00.000Z', statusCode: 200, html: JSON.stringify({ events: [{ name: 'Bear Night', start: '2026-11-20' }, { name: 'Beer Bust', start: '2026-11-21' }] }) };
    if (url === 'https://precinct.example/') return { url, fetchedAt: '2026-10-02T01:00:00.000Z', statusCode: 200, html: `<html><body><nav>${'<a>Home</a><a>Shop</a><a>Hours</a>'.repeat(120)}</nav></body></html>` };
    return { url, fetchedAt: '2026-10-02T01:00:00.000Z', statusCode: 200, html: '<html><body><ul><li>Sat Nov 22 · Bearded Pig Disco · 9PM</li><li>Sun Nov 23 · Club Chub · 3PM</li><li>Sun Nov 30 · Machete · 3PM</li></ul></body></html>' };
  } };
  const prompts = [];
  const ai = { generate: async (prompt) => { prompts.push(prompt); return '{"missing":[{"title":"Machete","date":"Sun Nov 30"}],"fake":[],"wrong":[],"note":"ok"}'; } };
  const logs = [];
  const summary = await sourceAudit.runSourceAudit({ sharedRoot: dir, results: payloadFor('20261002-050000', '2026-10-02', parsers()), runId: '20261002-050000', adapter, ai, today: '2026-10-02', now: new Date('2026-10-02T12:00:00Z'), cap: 2, hosts: ['api.feed.example', 'precinct.example'], pageTextCap: 1200, log: line => logs.push(line) });
  assert.deepEqual(summary.audited.sort(), ['api.feed.example', 'precinct.example']);
  assert.deepEqual(summary.errors, []);
  const store = sourceAudit.loadSourceAudit(sourceAudit.getSourceAuditPath(dir));
  const feed = store.hosts['api.feed.example'];
  assert.equal(feed.ai, 'no-page');
  assert.equal(feed.reason, 'door-is-feed');
  assert.match(feed.note, /reads a json feed, not a page/);
  assert.equal(feed.page.kind, 'json');
  assert.ok(feed.page.chars > 0, 'the feed was read (for the still-on-site search), not skipped');
  assert.equal(prompts.length, 1, 'the model is asked once — for the page host only');
  assert.ok(!prompts[0].includes('api.feed.example'), 'never about the feed');
  assert.ok(logs.some(line => /api\.feed\.example — .*ai no-page \(door-is-feed\)/.test(line)), logs.join('\n'));
  const precinct = store.hosts['precinct.example'];
  assert.equal(precinct.ai, 'ok');
  assert.equal(precinct.page.kind, 'html');
  assert.ok(fetched.includes('https://precinct.example/') && fetched.includes('https://precinct.example/calendar/'), 'both pages of the host were fetched');
  assert.ok(prompts[0].includes('Bearded Pig Disco · 9PM'), 'the calendar page reached the model although the nav-only home page was first and longer than its share');
  assert.ok(prompts[0].indexOf('[https://precinct.example/calendar/]') < prompts[0].indexOf('[https://precinct.example/]'), 'the page naming our events leads');
  assert.deepEqual(precinct.missing, [{ title: 'Machete', date: 'Sun Nov 30' }]);
  assert.ok(!sourceAudit.hostHasOpenFindings(feed), 'a feed host carries no findings from a model it never met');
  // The reason survives a normalize round trip and reads back on the dashboard row.
  const normalized = sourceAudit.normalizeSourceAuditStore(JSON.parse(fs.readFileSync(sourceAudit.getSourceAuditPath(dir), 'utf8')));
  assert.equal(normalized.hosts['api.feed.example'].reason, 'door-is-feed');
  const MetricsSections = require('./metrics-sections');
  const health = MetricsSections.assessSourceHealth(MetricsSections.parseSourceLedger(fs.readFileSync(path.join(dir, 'metrics', 'sources.ndjson'), 'utf8')), { now: new Date('2026-10-02T12:00:00Z'), audit: normalized });
  const row = health.rows.find(entry => entry.host === 'api.feed.example');
  assert.equal(row.audit.reason, 'door-is-feed');
  assert.ok(MetricsSections.buildHostAuditHtml(row).includes('The parser reads a feed (JSON or ICS), not a page'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runSourceAudit: when the pages\u2019 readable text names none of the extracted events, the model is not asked (ai no-page, reason page-names-no-events) — a JS-rendered calendar is not evidence of fabricated events', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-audit-shell-'));
  const event = (title, day) => ({ title, startDate: `${day}T22:00:00.000Z`, bar: 'Precinct LA', timezone: 'America/Los_Angeles', isBearEvent: true, website: `https://shell.example/${title.toLowerCase().replace(/\s+/g, '-')}/` });
  const parsers = () => [{ name: 'Shell', totalEvents: 3, config: { urls: ['https://shell.example/'] }, urlClassifications: { 'https://shell.example/': 'multi-event-page', 'https://shell.example/calendar/': 'multi-event-page' },
    events: [event('Bearded Pig Disco', '2026-11-22'), event('Club Chub', '2026-11-23'), event('Fat Slut', '2026-11-24')] }];
  seedLedger(dir, [['20261001-050000', '2026-10-01', payloadFor('20261001-050000', '2026-10-01', parsers())], ['20261002-050000', '2026-10-02', payloadFor('20261002-050000', '2026-10-02', parsers())]]);
  const adapter = { fetchData: async (url) => ({ url, fetchedAt: '2026-10-02T01:00:00.000Z', statusCode: 200, html: '<html><body><nav><a>Home</a><a>Calendar</a><a>Hours</a><a>HAPPY HOUR</a></nav><div id="app"></div><script>window.__EVENTS__=[{"name":"Bearded Pig Disco"}]</script></body></html>' }) };
  const prompts = [];
  const ai = { generate: async (prompt) => { prompts.push(prompt); return '{"missing":[],"fake":[{"title":"HAPPY HOUR","kind":"heading","reason":"heading"}],"wrong":[],"note":"no events on the page"}'; } };
  const logs = [];
  const summary = await sourceAudit.runSourceAudit({ sharedRoot: dir, results: payloadFor('20261002-050000', '2026-10-02', parsers()), runId: '20261002-050000', adapter, ai, today: '2026-10-02', now: new Date('2026-10-02T12:00:00Z'), hosts: ['shell.example'], log: line => logs.push(line) });
  assert.deepEqual(summary.audited, ['shell.example']);
  assert.equal(prompts.length, 0, 'the model is not shown text the events are not in');
  const entry = sourceAudit.loadSourceAudit(sourceAudit.getSourceAuditPath(dir)).hosts['shell.example'];
  assert.equal(entry.ai, 'no-page');
  assert.equal(entry.reason, 'page-names-no-events');
  assert.match(entry.note, /names none of the 3 extracted events/);
  assert.deepEqual(entry.fake, [], 'no invented heading-fakes');
  assert.ok(entry.page && entry.page.chars > 0, 'the pages were read and recorded');
  assert.ok(logs.some(line => /shell\.example — ai no-page \(page-names-no-events\)/.test(line)), logs.join('\n'));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// "Removed by the site" needs proof (2026-11-09). Until then a title whose
// words were missing from ONE listing page was stamped site-removed. Eagle
// LA's calendar page prints the current month's grid only; seven December
// and January parties our own read had stopped seeing (a month-feed cache
// key) were stamped "removed" off a page that shows November, and nine
// removal cards went to the review deck. The fixtures below are that page's
// readable text and BeefDip's programme page, trimmed.
// ---------------------------------------------------------------------------
const GRID_NIGHTS = { 1: ['SUNDAY BEER BUST', 'SUNDAY SWAP MEAT'], 5: ['BEAR HAPPY HOUR', 'B BAR'], 6: ['CUBSCOUT'], 14: ['MEAT RACK'], 20: ['BLUF LA', 'HOT BOOTS GEAR NIGHT'], 21: ['CRUISE LA', 'HELL BENT'], 27: ['LOST PUPPY'], 29: ['BEARS LA MAC AND CHEESE COOK OFF', 'SUNDAY BEER BUST'] };
// The month view as the cached page reads: neighbours' names, "<Month>
// <Year>" alone on a line, weekday heads, each day number alone on a line
// followed by that day's titles, then the next month's first cells.
function monthGridText(nights = GRID_NIGHTS) {
  const lines = ['Home', 'Calendar', 'October', 'November 2026', 'December', 'SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  for (let day = 1; day <= 30; day += 1) { lines.push(String(day)); (nights[day] || []).forEach(title => lines.push(title)); }
  return lines.concat(['1', '2', '3', '4', '5', '©2021 Eagle LA, inc']).join('\n');
}
function monthGridHtml(nights = GRID_NIGHTS) {
  const cells = [];
  for (let day = 1; day <= 30; day += 1) cells.push(`<dt class="mec-calendar-day"><div>${day}</div>${(nights[day] || []).map(title => `<a href="#"><h4 class="mec-event-title">${title}</h4></a>`).join('')}</dt>`);
  return `<html><body><div class="mec-previous-month"><a>October</a></div><div class="mec-calendar-header"><h2>November 2026</h2></div><div class="mec-next-month"><a>December</a></div><dl>${cells.join('')}${[1, 2, 3, 4, 5].map(day => `<dt class="mec-table-nullday"><div>${day}</div></dt>`).join('')}</dl></body></html>`;
}
const PROGRAMME_TEXT = [
  'BeefDip Bear Week 2026', 'Jan 23 – 31 • Puerto Vallarta', 'BEEFDIP BEAR WEEK PV 2027 OFFICIAL PROGRAM', 'FULL SCHEDULE',
  'SATURDAY JANUARY 23, 2027', 'PRE WELCOME PARTY', 'Saturday, Jan 23 • 9PM – Midnight • The Tryst Hotel RoofTop',
  'SUNDAY JANUARY 24, 2027', 'WELCOME PARTY', 'Sun Jan 24 • 3PM–Midnight • Blue Chairs Rooftop',
  'MONDAY JANUARY 25, 2027', 'BOOZE CRUISE', 'Mon Jan 25 • 10AM • Los Muertos Pier',
  'SUNDAY JANUARY 31, 2027', 'FAREWELL POOL PARTY', 'Sun Jan 31 • Noon • Blue Chairs Rooftop'
].join('\n');

test('listingPrintedDays / listingCoversDay: a month grid covers every day of ITS month and no other; dated rows cover the day they print and the days between two of them; a date with no year is never rolled forward', () => {
  const grid = sourceAudit.listingPrintedDays(monthGridText(), '2026-11-09');
  assert.equal(grid.grid.size, 30, 'the whole of November, empty cells too');
  assert.deepEqual(sourceAudit.listingCoversDay(grid, '2026-11-13'), { how: 'grid', from: '2026-11-01', to: '2026-11-30' }, 'an empty cell of the grid is covered');
  assert.equal(sourceAudit.listingCoversDay(grid, '2026-12-03'), null, 'the next month\'s first cells behind the 30 are not December');
  assert.equal(sourceAudit.listingCoversDay(grid, '2026-12-31'), null, 'the "December" link next to the header covers nothing');
  assert.equal(sourceAudit.listingCoversDay(grid, '2027-01-18'), null);
  // A strip of one week under a month heading is not the month.
  const week = sourceAudit.listingPrintedDays(['November 2026', '1', 'BEER BUST', '2', '3', '4', '5', '6', '7'].join('\n'), '2026-11-09');
  assert.equal(week.grid.size, 0, 'seven numbers are not a month grid');
  // Cells of the month before, ahead of the 1, are passed over.
  const lead = ['December 2026', '29', '30', '1'];
  for (let day = 2; day <= 31; day += 1) lead.push(String(day));
  assert.equal(sourceAudit.listingPrintedDays(lead.concat(['1', '2']).join('\n'), '2026-11-09').grid.size, 31);

  const rows = sourceAudit.listingPrintedDays(PROGRAMME_TEXT, '2026-11-09');
  assert.equal(rows.grid.size, 0);
  assert.ok(rows.rows.has('2027-01-23') && rows.rows.has('2027-01-24') && rows.rows.has('2027-01-25') && rows.rows.has('2027-01-31'), [...rows.rows].join(','));
  assert.ok(rows.rows.has('2026-01-24') && !rows.rows.has('2028-01-24'), '"Sun Jan 24" with no year is this year\'s, never next January');
  assert.deepEqual(sourceAudit.listingCoversDay(rows, '2027-01-24'), { how: 'printed', from: '2027-01-24', to: '2027-01-24' });
  assert.deepEqual(sourceAudit.listingCoversDay(rows, '2027-01-28'), { how: 'between', from: '2027-01-25', to: '2027-01-31' }, 'the list runs through the day');
  assert.equal(sourceAudit.listingCoversDay(rows, '2027-02-06'), null, 'nothing printed after it');
  assert.equal(sourceAudit.listingCoversDay(rows, '2027-04-01'), null);
  assert.equal(sourceAudit.listingCoversDay(rows, 'soon'), null);
  // Only real month words: "maybe 12", "mark 3", a clock and a price are not dates.
  const noise = sourceAudit.listingPrintedDays('maybe 12 of us\nmark 3 down\nDoors 9:30 · $12\nDecor 5 stars\n2026-11-14 ISO row\n14 November 2026\nNov. 15th, 2026', '2026-11-09');
  assert.deepEqual([...noise.rows].sort(), ['2026-11-14', '2026-11-15']);
  assert.equal(sourceAudit.LISTING_BRACKET_DAYS, 31);
});

test('stillOnSite: missing words alone are "unknown" — "site-removed" needs the text to be the listing that covers the lost day AND to name what the run read there (Eagle LA 2026-11-09: December and January parties judged off a November grid)', () => {
  const text = monthGridText();
  const today = '2026-11-09';
  const runRows = [{ title: 'MEAT RACK', day: '2026-11-14' }, { title: 'BLUF LA', day: '2026-11-20' }, { title: 'LOST PUPPY', day: '2026-11-27' }, { title: 'CUBSCOUT', day: '2026-11-06' }];
  // The seven of the deck: every one a day the page does not show.
  [['EAGLE LA NEW YEARS BASH!!', '2026-12-31'], ['HAPPY HOLIDAYS FROM THE MEN OF EAGLE LA', '2026-12-25'], ['MLK BUST', '2027-01-18'], ['BEARS LA NAUGHY BEAR', '2026-12-13']].forEach(([title, day]) => {
    const out = sourceAudit.stillOnSite(title, text, { days: [day], today, events: runRows });
    assert.equal(out.verdict, 'unknown', title);
    assert.equal(out.proof, undefined);
    assert.match(out.why, new RegExp(`does not cover ${day}`), out.why);
  });
  // A November night the grid shows without the title, the run's November rows all on it: removed, with the proof.
  const removed = sourceAudit.stillOnSite('CALF B&B EVENT', text, { days: ['2026-11-20'], today, events: runRows });
  assert.equal(removed.verdict, 'site-removed');
  assert.equal(removed.proof, 'listing-covers');
  assert.deepEqual(removed.days, ['2026-11-20']);
  // No options at all (an older caller): never "removed".
  assert.equal(sourceAudit.stillOnSite('CALF B&B EVENT', text).verdict, 'unknown');
  assert.match(sourceAudit.stillOnSite('CALF B&B EVENT', text).why, /no lost day ahead/);
  assert.equal(sourceAudit.stillOnSite('CALF B&B EVENT', text, { days: ['2026-11-02'], today, events: runRows }).verdict, 'unknown', 'a lost day already past proves nothing about today\'s page');
  // The run read nothing from the site in the window: nothing shows this text is the listing it reads.
  const nothingRead = sourceAudit.stillOnSite('CALF B&B EVENT', text, { days: ['2026-11-20'], today, events: [{ title: 'BLUF LA', day: '2026-12-18' }] });
  assert.equal(nothingRead.verdict, 'unknown');
  assert.match(nothingRead.why, /the run read no event from the site between 2026-11-01 and 2026-11-30/);
  // A row the run read in the window is not on the text: it is not the whole listing (a "featured" strip, a filtered view).
  const partial = sourceAudit.stillOnSite('CALF B&B EVENT', text, { days: ['2026-11-20'], today, events: runRows.concat([{ title: 'Tightwad Tuesday', day: '2026-11-17' }]) });
  assert.equal(partial.verdict, 'unknown');
  assert.match(partial.why, /does not name "Tightwad Tuesday" \(2026-11-17\)/);
  // Rows of the run before today are not asked of today's page.
  assert.equal(sourceAudit.stillOnSite('CALF B&B EVENT', text, { days: ['2026-11-20'], today, events: runRows.concat([{ title: 'Tightwad Tuesday', day: '2026-11-03' }]) }).verdict, 'site-removed');
  // Text cut short, or a listing page of the host that could not be read: unknown.
  assert.match(sourceAudit.stillOnSite('CALF B&B EVENT', text, { days: ['2026-11-20'], today, events: runRows, truncated: true }).why, /cut short/);
  const incomplete = sourceAudit.stillOnSite('CALF B&B EVENT', text, { days: ['2026-11-20'], today, events: runRows, incomplete: 'HTTP 403' });
  assert.equal(incomplete.verdict, 'unknown');
  assert.match(incomplete.why, /could not be read \(HTTP 403\)/);
  // A weekly night gone from the November grid, its December nights shown nowhere: unknown, and the days vouched for are named.
  const mixed = sourceAudit.stillOnSite('CALF B&B EVENT', text, { days: ['2026-11-20', '2026-11-27', '2026-12-04'], today, events: runRows });
  assert.equal(mixed.verdict, 'unknown');
  assert.equal(mixed.proof, 'listing-covers');
  assert.deepEqual(mixed.days, ['2026-11-20', '2026-11-27']);
  assert.match(mixed.why, /does not cover 2026-12-04/);
  // Still listed is unchanged, whatever the day.
  assert.equal(sourceAudit.stillOnSite('BLUF LA', text, { days: ['2026-12-18'], today, events: runRows }).verdict, 'still-listed');
  assert.equal(sourceAudit.stillOnSite('Bears LA Mac and Cheese Cook Off', text, { days: ['2026-11-29'], today }).verdict, 'still-listed');
  assert.equal(sourceAudit.stillOnSite('!!', text, { days: ['2026-11-20'], today }).verdict, 'unknown');
  // Dated rows (BeefDip's programme, 2026-11-09): "Welcome T-Dance" is off a page that prints its day with another party.
  const programme = sourceAudit.stillOnSite('Welcome T-Dance', PROGRAMME_TEXT.replace('WELCOME PARTY', 'KICKOFF'), { days: ['2027-01-24'], today, events: [{ title: 'Kickoff', day: '2027-01-24' }] });
  assert.equal(programme.verdict, 'site-removed');
  assert.deepEqual(programme.days, ['2027-01-24']);
  // refineStillVerdict carries proof, days and the reason along.
  assert.deepEqual(sourceAudit.refineStillVerdict({ title: 'CALF B&B EVENT', days: ['2026-11-20'] }, removed, []), { verdict: 'site-removed', line: removed.line, proof: 'listing-covers', days: ['2026-11-20'] });
  assert.match(sourceAudit.refineStillVerdict({ title: 'MLK BUST', days: ['2027-01-18'] }, sourceAudit.stillOnSite('MLK BUST', text, { days: ['2027-01-18'], today, events: runRows }), []).why, /does not cover 2027-01-18/);
});

test('runSourceAudit: the verdict stamped into the loss state carries the proof and the days it vouches for; a party of a month the page does not show is stamped unknown with the reason; the store keeps both through a normalize round trip', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-audit-proof-'));
  const event = (title, day) => ({ title, startDate: `${day}T05:00:00.000Z`, bar: 'Eagle LA', timezone: 'America/Los_Angeles', isBearEvent: true, website: `https://grid.example/events/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/` });
  // startDate 05:00Z is 21:00 the evening before in Los Angeles: the local days are 11-14, 11-20, 11-27, 12-31.
  const steady = [event('MEAT RACK', '2026-11-15'), event('BLUF LA', '2026-11-21'), event('LOST PUPPY', '2026-11-28')];
  const parsers = (extra) => [{ name: 'Grid', totalEvents: steady.length + extra.length, config: { urls: ['https://grid.example/calendar/'] }, urlClassifications: { 'https://grid.example/calendar/': 'multi-event-page' }, events: steady.concat(extra) }];
  const both = [event('CALF NIGHT', '2026-11-21'), event('NEW YEARS BASH', '2027-01-01')];
  seedLedger(dir, [
    ['20261106-050000', '2026-11-06', payloadFor('20261106-050000', '2026-11-06', parsers(both))],
    ['20261107-050000', '2026-11-07', payloadFor('20261107-050000', '2026-11-07', parsers(both))],
    ['20261108-050000', '2026-11-08', payloadFor('20261108-050000', '2026-11-08', parsers([]))],
    ['20261109-050000', '2026-11-09', payloadFor('20261109-050000', '2026-11-09', parsers([]))]
  ]);
  const before = JSON.parse(fs.readFileSync(path.join(dir, 'metrics', 'source-upcoming.json'), 'utf8'));
  assert.deepEqual(Object.keys(before.hosts['grid.example'].lost).sort(), ['calf night', 'new years bash'], 'both confirmed lost on the fourth run');
  const adapter = { fetchData: async (url) => ({ url, fetchedAt: '2026-11-09T05:40:00.000Z', statusCode: 200, html: monthGridHtml() }) };
  const ai = { generate: async () => '{"missing":[],"fake":[],"wrong":[],"note":"ok"}' };
  const logs = [];
  const summary = await sourceAudit.runSourceAudit({ sharedRoot: dir, results: payloadFor('20261109-050000', '2026-11-09', parsers([])), runId: '20261109-050000', adapter, ai, today: '2026-11-09', now: new Date('2026-11-09T12:00:00Z'), hosts: ['grid.example'], log: line => logs.push(line) });
  assert.deepEqual(summary.errors, []);
  assert.deepEqual(summary.audited, ['grid.example']);
  const store = sourceAudit.loadSourceAudit(sourceAudit.getSourceAuditPath(dir));
  const still = Object.fromEntries(store.hosts['grid.example'].still.map(item => [item.title, item]));
  assert.equal(still['CALF NIGHT'].verdict, 'site-removed');
  assert.equal(still['CALF NIGHT'].proof, 'listing-covers');
  assert.deepEqual(still['CALF NIGHT'].days, ['2026-11-20']);
  assert.equal(still['NEW YEARS BASH'].verdict, 'unknown', 'the page shows November; nothing was read about 31 December');
  assert.match(still['NEW YEARS BASH'].why, /does not cover 2026-12-31/);
  assert.equal(still['NEW YEARS BASH'].proof, undefined);
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'metrics', 'source-upcoming.json'), 'utf8')).hosts['grid.example'].lost;
  assert.equal(state['calf night'].still.verdict, 'site-removed');
  assert.equal(state['calf night'].still.proof, 'listing-covers');
  assert.deepEqual(state['calf night'].still.days, ['2026-11-20']);
  assert.deepEqual(Object.keys(state['new years bash'].still).sort(), ['at', 'verdict'], 'no proof, no days');
  assert.equal(state['new years bash'].still.verdict, 'unknown');
  assert.ok(logs.some(line => /grid\.example — "CALF NIGHT" removed by the site: its listing covers/.test(line)), logs.join('\n'));
  assert.ok(logs.some(line => /grid\.example — "NEW YEARS BASH" not found in the text read, but that proves nothing: .*does not cover 2026-12-31/.test(line)), logs.join('\n'));
  const normalized = sourceAudit.normalizeSourceAuditStore(JSON.parse(fs.readFileSync(sourceAudit.getSourceAuditPath(dir), 'utf8')));
  const kept = Object.fromEntries(normalized.hosts['grid.example'].still.map(item => [item.title, item]));
  assert.equal(kept['CALF NIGHT'].proof, 'listing-covers');
  assert.deepEqual(kept['CALF NIGHT'].days, ['2026-11-20']);
  assert.match(kept['NEW YEARS BASH'].why, /does not cover/);
  // The next ledger line says which "removed" rests on proof.
  const next = SharedCore.buildSourceLedger(payloadFor('20261110-050000', '2026-11-10', parsers([])), { runId: '20261110-050000', previousUpcoming: JSON.parse(fs.readFileSync(path.join(dir, 'metrics', 'source-upcoming.json'), 'utf8')), now: new Date('2026-11-10T12:00:00Z') });
  const lost = Object.fromEntries(next.records.find(record => record.host === 'grid.example').lost.map(item => [item.title, item]));
  assert.equal(lost['CALF NIGHT'].still, 'site-removed');
  assert.equal(lost['CALF NIGHT'].still_proof, 'listing-covers');
  assert.equal(lost['NEW YEARS BASH'].still, 'unknown');
  assert.equal(lost['NEW YEARS BASH'].still_proof, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

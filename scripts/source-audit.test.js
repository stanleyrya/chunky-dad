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

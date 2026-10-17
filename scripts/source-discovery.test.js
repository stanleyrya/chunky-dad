const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const discovery = require('../tools/source-discovery');

// ---------------------------------------------------------------------------
// Source discovery: the sites our own data points at that no parser reads.
// Fixtures are synthetic — one first-party parser, one aggregator, one
// published calendar, one bar, two promoters — shaped like the real run
// file, calendar ICS, data/bars and data/promoters.json.
// ---------------------------------------------------------------------------

const shared = discovery.loadSharedCore();
const { core } = shared;
const TODAY = '2026-10-17';

const PARSERS = [
  { name: 'Eagle X', urls: ['https://www.eaglex.example/events/'], siteRole: 'venue' },
  { name: 'Megawoof America', urls: ['https://www.eventbrite.com/o/megawoof-america-18118978189'] },
  { name: 'Lodge NY', urls: ['https://calendar.google.com/calendar/ical/info%40lodgeny.com/public/basic.ics'] },
  { name: 'Cubhouse', urls: ['https://linktr.ee/cubhouse'] },
  { name: 'Thotyssey', urls: ['https://tockify.com/api/ngevent?calname=thotyssey'], siteRole: 'aggregator', aggregatorHosts: ['thotyssey.com', 'tockify.com'] },
  { name: 'New Site Template', template: true, urls: ['https://example.com/events'] }
];
const PROMOTERS = [
  { name: 'Lodge NY', website: 'https://lodgeny.com', bearAffinity: 'always' },
  { name: 'Megawoof America', website: 'https://linktr.ee/megawoof_america' },
  { name: 'Urban Bear', website: 'https://www.theurbanbear.com' }
];
const BARS = [{ name: 'Bear Haus', city: 'berlin', website: 'https://bearhaus.example' }];
const CITIES = { nyc: {}, berlin: {}, sitges: {}, oslo: {} };

function event(title, startDate, city, extra = {}) {
  return Object.assign({ title, startDate: `${startDate}T22:00:00.000Z`, city, isBearEvent: true }, extra);
}

function sampleRun() {
  return {
    summary: { runId: '20261017-054812' },
    parserResults: [
      {
        name: 'Eagle X', config: { urls: ['https://www.eaglex.example/events/'] },
        events: [
          event('Bear Night', '2026-10-24', 'nyc', { website: 'https://www.eaglex.example/events/bear-night/', ticketUrl: 'https://www.eventbrite.com/e/bear-night-tickets-111' }),
          event('Cub Social', '2026-10-25', 'nyc', { website: 'https://www.eaglex.example/events/cub-social/', ticketUrl: 'https://eventim.us/event/Cub-Social/5' })
        ]
      },
      {
        name: 'Thotyssey', config: { siteRole: 'aggregator', urls: ['https://tockify.com/api/ngevent?calname=thotyssey'] },
        events: [
          // Same ticket page a first-party parser already carries: not a discovery.
          event('Bear Night', '2026-10-24', 'nyc', { ticketUrl: 'https://www.eventbrite.com/e/bear-night-tickets-111?aff=thotyssey' }),
          // An unread venue site, twice, two cities.
          event('Bear Haus Friday', '2026-10-30', 'berlin', { website: 'https://bearhaus.example/events/friday' }),
          event('Bear Haus Tour', '2026-11-06', 'nyc', { website: 'https://www.bearhaus.example/tour', isBearEvent: false }),
          // A Megawoof copy: the hub names a configured promoter, so the
          // anonymous eventbrite event page is theirs — not a lead.
          event('MEGAWOOF CHICAGO', '2026-11-07', 'chicago', { website: 'https://linktr.ee/megawoof_america', ticketUrl: 'https://www.eventbrite.com/e/megawoof-chicago-tickets-222' }),
          // Unknown organizer's eventbrite event page: a lead, by platform.
          event('Woof Oslo', '2026-11-08', 'oslo', { ticketUrl: 'https://www.eventbrite.de/e/woof-oslo-tickets-333', bar: 'Ophelia' }),
          // An organizer page we do not read.
          event('Bears Sitges Night', '2026-11-09', 'sitges', { website: 'https://www.eventbrite.co.uk/o/bears-sitges-99887766' }),
          // Lodge NY copy: the promoter join makes lodgeny.com configured.
          event('Lodge NY: The Bear Party', '2026-10-26', 'nyc', { website: 'https://lodgeny.com' }),
          // Instagram-only presence: never a candidate, kept aside.
          event('Secret Bear Rave', '2026-10-31', 'nyc', { instagram: 'https://www.instagram.com/secretbearrave', notes: 'website: https://www.instagram.com/secretbearrave' }),
          // Maps link: never a source.
          event('Nothing Here', '2026-11-01', 'nyc', { website: 'https://www.google.com/maps/place/x' })
        ]
      }
    ],
    bearDroppedEvents: [
      { title: 'Drag Brunch', host: 'www.eaglex.example', event: event('Drag Brunch', '2026-10-26', 'nyc', { website: 'https://www.eaglex.example/events/drag/', ticketUrl: 'https://www.tickettailor.com/events/eaglex/555' }) }
    ]
  };
}

const CALENDAR_EVENTS = [
  { title: 'Bears Disco', startDate: '2026-11-13T22:00:00.000Z', city: 'sitges', isBearEvent: true, key: 'ics:1', notes: 'bar: Scandal\nwebsite: https://scandalsitges.example/bears-disco/\nticketUrl: https://www.eventbrite.es/e/bears-disco-tickets-444' },
  { title: 'Bear Night', startDate: '2026-10-24T22:00:00.000Z', city: 'nyc', isBearEvent: true, key: 'ics:2', notes: 'website: https://www.eaglex.example/events/bear-night/' }
];

function run(overrides = {}) {
  return discovery.discoverSources(Object.assign({
    shared, today: TODAY, run: sampleRun(), parsers: PARSERS, promoters: PROMOTERS, bars: BARS, festivals: [], cities: CITIES,
    calendarEvents: CALENDAR_EVENTS
  }, overrides));
}

test('classifyLink: sites, platform organizer pages, socials, hubs and utilities', () => {
  assert.equal(discovery.classifyLink('https://www.eaglex.example/events/x', core).key, 'eaglex.example');
  assert.equal(discovery.classifyLink('https://www.eventbrite.co.uk/o/bears-sitges-99887766', core).key, 'eventbrite.com/o/bears-sitges-99887766');
  assert.equal(discovery.classifyLink('https://www.eventbrite.de/e/woof-tickets-333', core).key, 'eventbrite.com (organizer unknown)');
  // Path nouns are not organizers.
  assert.equal(discovery.classifyLink('https://dice.fm/partner/tickets/event/abc-tickets', core).organizer, '');
  assert.equal(discovery.classifyLink('https://dice.fm/partner/cmon-everybody-ad2x', core).key, 'dice.fm/cmon-everybody-ad2x');
  assert.equal(discovery.classifyLink('https://events.ticketleap.com/tickets/furballnyc/furball-austin', core).key, 'ticketleap.com/furballnyc');
  assert.equal(discovery.classifyLink('https://events.humanitix.com/fatdad-party', core).organizer, '');
  assert.equal(discovery.classifyLink('https://events.humanitix.com/host/fatdad', core).key, 'humanitix.com/fatdad');
  assert.equal(discovery.classifyLink('https://www.instagram.com/x', core).kind, 'social');
  assert.equal(discovery.classifyLink('https://linktr.ee/x', core).kind, 'hub');
  assert.equal(discovery.classifyLink('https://maps.app.goo.gl/abc', core), null);
  assert.equal(discovery.classifyLink('https://www.stubhub.com/event/1', core), null, 'resale is never a source');
  assert.equal(discovery.classifyLink('not a url', core), null);
});

test('configured index: parser domains, organizer pages, venue metadata and the promoter-name join', () => {
  const configured = discovery.buildConfiguredIndex(PARSERS, core, PROMOTERS);
  assert.ok(configured.domains.has('eaglex.example'));
  assert.ok(configured.keys.has('eventbrite.com/o/megawoof-america-18118978189'));
  assert.ok(configured.aggregatorHosts.has('thotyssey.com'));
  assert.ok(configured.domains.has('lodgeny.com'), 'promoter record named like the parser contributes its website');
  assert.deepEqual(discovery.configuredOwners(discovery.classifyLink('https://lodgeny.com/x', core), configured), ['Lodge NY']);
  assert.deepEqual(discovery.configuredOwners(discovery.classifyLink('https://linktr.ee/megawoof_america', core), configured), ['Megawoof America']);
  assert.ok(!configured.domains.has('theurbanbear.com'), 'a promoter with no parser stays unconfigured');
  assert.ok(!configured.domains.has('example.com'), 'template entries are not sources');
});

test('discoverSources: ranks unread sites, drops what is configured or already carried', () => {
  const report = run();
  const keys = report.candidates.map(row => row.key);
  assert.ok(keys.includes('bearhaus.example'));
  assert.ok(keys.includes('eventbrite.com/o/bears-sitges-99887766'));
  assert.ok(keys.includes('scandalsitges.example'));
  assert.ok(keys.includes('theurbanbear.com'), 'curated promoter website with no parser');
  assert.ok(!keys.includes('eaglex.example'), 'configured parser domain');
  assert.ok(!keys.includes('lodgeny.com'), 'configured through the promoter join');
  assert.ok(!keys.includes('eventim.us (organizer unknown)'), 'ticket page hanging off a first-party event is not a lead');
  assert.ok(!keys.includes('tickettailor.com (organizer unknown)'), 'nor off a first-party bear-check drop');
  assert.ok(!keys.some(key => key.includes('google.com')));
  assert.ok(!keys.some(key => key.includes('instagram')));

  const bearhaus = report.candidates.find(row => row.key === 'bearhaus.example');
  assert.equal(bearhaus.events, 2);
  assert.equal(bearhaus.bearEvents, 1);
  assert.deepEqual(bearhaus.cities, ['berlin', 'nyc']);
  assert.deepEqual(bearhaus.aggregators, ['Thotyssey']);
  assert.deepEqual(bearhaus.knownAs, ['bar: Bear Haus']);
  assert.equal(bearhaus.latest, '2026-11-06');
  // 2 events + 2×1 bear + 3×2 cities + 2 aggregator + 1 known + 2 upcoming
  assert.equal(bearhaus.score, 2 + 2 + 6 + 2 + 1 + 2);

  const eventbrite = report.candidates.find(row => row.key === 'eventbrite.com (organizer unknown)');
  assert.ok(eventbrite, 'anonymous ticket pages from aggregator rows stay visible, by platform');
  assert.equal(eventbrite.events, 2, 'Woof Oslo (aggregator) + Bears Disco (calendar); Bear Night is carried by Eagle X and the Megawoof copy is owned');
  assert.deepEqual(eventbrite.labels.map(entry => entry.label), ['Ophelia']);
});

test('discoverSources: filters, coverage and the instagram-only side list', () => {
  const report = run();
  const sitges = report.cityCoverage.find(entry => entry.city === 'sitges');
  assert.deepEqual(sitges.sources, []);
  assert.equal(sitges.calendarEvents, 1);
  assert.ok(sitges.candidates.includes('scandalsitges.example'));
  const nyc = report.cityCoverage.find(entry => entry.city === 'nyc');
  assert.deepEqual(nyc.runSources, ['Eagle X']);
  assert.deepEqual(nyc.calendarSources, ['Eagle X'], 'the calendar line links the configured site');
  assert.equal(nyc.aggregatorEvents, 5);
  const berlin = report.cityCoverage.find(entry => entry.city === 'berlin');
  assert.equal(berlin.sourceCount, 0);
  assert.ok(report.cityCoverage.some(entry => entry.city === 'oslo'), 'cities from the config appear even with no first-party events');
  assert.equal(report.cityCoverage[0].sourceCount, 0, 'zero-source cities sort first');

  assert.deepEqual(report.instagramOnly.map(entry => entry.handle), ['secretbearrave']);
  assert.deepEqual(report.linkHubs.map(entry => entry.url), ['https://linktr.ee/megawoof_america']);

  const berlinOnly = run({ city: 'berlin' });
  assert.deepEqual(berlinOnly.candidates.map(row => row.key), ['bearhaus.example']);
  const twoPlus = run({ minEvents: 2 });
  assert.ok(twoPlus.candidates.every(row => row.events >= 2));
  assert.ok(twoPlus.candidates.some(row => row.key === 'bearhaus.example'));
});

test('collectCalendarEvents reads website/ticketUrl lines out of folded ICS descriptions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-discovery-'));
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:abc-1', 'DTSTART:20261113T220000Z', 'SUMMARY:Bears Disco',
    'DESCRIPTION:bar: Scandal\\nwebsite: https://scandalsitges.example/bears-dis',
    ' co/\\nticketUrl: https://www.eventbrite.es/e/bears-disco-tickets-444',
    'END:VEVENT', 'END:VCALENDAR', ''
  ].join('\r\n');
  fs.writeFileSync(path.join(dir, 'sitges.ics'), ics);
  fs.writeFileSync(path.join(dir, 'festivals.ics'), 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
  const events = discovery.collectCalendarEvents(dir, shared.SharedCore);
  assert.equal(events.length, 1);
  assert.equal(events[0].city, 'sitges');
  assert.equal(events[0].title, 'Bears Disco');
  assert.equal(events[0].startDate.slice(0, 10), '2026-11-13');
  const links = discovery.eventLinks(events[0]).map(([, url]) => url);
  assert.deepEqual(links, ['https://scandalsitges.example/bears-disco/', 'https://www.eventbrite.es/e/bears-disco-tickets-444']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('renderTable and renderCoverage print the ranked rows', () => {
  const report = run();
  const table = discovery.renderTable(report, 5);
  assert.match(table, /bearhaus\.example/);
  assert.match(table, /bar: Bear Haus/);
  assert.match(table, /agg: Thotyssey/);
  const coverage = discovery.renderCoverage(report);
  assert.match(coverage, /sitges\s+0/);
  assert.match(coverage, /nyc\s+1/);
});

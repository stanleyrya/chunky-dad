// Feed-door shapes that any source can publish, pinned with saved snippets of
// the real feeds under scripts/fixtures/feed-doors/ (read 2026-10-17 from the
// scraper's own page cache):
//
//   1. A Squarespace events collection (?format=json) whose rows carry the
//      template's default map marker (40.7207559, -74.0007613 — the platform's
//      New York HQ) beside the editor's own address lines. The marker is never
//      a place pin, address or not: "Bears at the Beach 2026" at "Nantasket
//      Beach / Hull, MA" shipped to the calendar in Manhattan because the
//      guard stood down for a row that had an address (run 20261017-054812).
//
//   2. A machine door (TicketSauce events_by_organization JSON, a Google
//      Calendar iCalendar export) read by the daily source audit: the audit
//      used to hand the model the first 6 000 characters of the raw body —
//      SMOOCH's nested envelope alone, or the 2023 archive of a calendar that
//      is published oldest-first — and judged every other extracted event
//      "not on the page". A feed is rendered one line per current record
//      before the cap, the way the scraper itself reads it.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { SharedCore } = require('./shared-core');
const { EventSchema } = require('./event-schema');
const { AiWebParser } = require('./parsers/ai-web-parser');
const sourceAudit = require('../tools/source-audit');

const FIXTURES = path.join(__dirname, 'fixtures', 'feed-doors');
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

const CITIES = {
    boston: { calendar: 'chunky-dad-boston', timezone: 'America/New_York', patterns: ['boston'] },
    chicago: { calendar: 'chunky-dad-chicago', timezone: 'America/Chicago', patterns: ['chicago'] },
    nyc: { calendar: 'chunky-dad-nyc', timezone: 'America/New_York', patterns: ['new york', 'nyc'] }
};

function createParser() {
    const core = new SharedCore(CITIES, { eventSchema: EventSchema, bars: {} });
    const parser = new AiWebParser({ normalizeUrl: core.normalizeUrl.bind(core) });
    parser.core = core;
    return parser;
}

const quiet = (fn) => {
    const original = console.log;
    console.log = () => {};
    try { return fn(); } finally { console.log = original; }
};

test('Squarespace: a map pin equal to the template marker is never a place pin, with or without an address beneath it', () => {
    const parser = createParser();
    const payload = JSON.parse(readFixture('squarespace-events-format-json.json'));
    const rows = parser.collectSquarespaceCollectionItems(payload);
    assert.equal(rows.length, 5, 'upcoming[] and past[] rows are both collected');

    const templateMarker = parser.findSquarespaceTemplateMarker(rows);
    assert.equal(templateMarker, '40.72076,-74.00076', 'the marker rows keep beside a different map pin is the template marker');

    const sourceUrl = 'https://www.massbearsandcubs.org/events?format=json';
    const events = quiet(() => rows.map((row) => parser.buildEventFromSquarespaceItem(row, sourceUrl, { templateMarker })));
    const byTitle = (needle) => events.find((event) => event && event.title.includes(needle));

    // A real map pin beside the template marker: the pin is kept.
    const bearTea = byTitle('Bear Tea');
    assert.equal(bearTea.bar, 'Club Cafe');
    assert.equal(bearTea.location, '42.3486155, -71.0723826');

    // The untouched map with no address: no pin (the pre-existing rule).
    const meetings = byTitle('Monthly Membership Meetings');
    assert.equal(meetings.bar, 'Online/Virtual');
    assert.equal(meetings.location, undefined);

    // The untouched map WITH an address line: no pin either — the address
    // ("Hull, MA") geocodes on its own; the New York marker never ships.
    const beach = byTitle('Bears at the Beach');
    assert.equal(beach.bar, 'Nantasket Beach');
    assert.equal(beach.address, 'Hull, MA');
    assert.equal(beach.location, undefined, 'the template marker is not a pin for Hull, MA');

    // A row whose map pin was set (marker == map, both in Boston) keeps it.
    const contest = byTitle('MA Bear Contest 2027');
    assert.equal(contest.location, '42.3581324, -71.0588204');
});

test('source audit: a TicketSauce JSON door reads as one line per current row, not the first 6 000 characters of the raw body', () => {
    const body = readFixture('ticketsauce-events-by-organization.json');
    const records = sourceAudit.feedRecordsFromBody(body);
    assert.equal(records.length, 3, 'every { Event: {…} } envelope is one record');
    assert.deepEqual(records.map((record) => record.title).sort(), ['BEAR HAPPY HOUR', 'BELLY UP + COAT DRIVE', 'SMOOCH']);
    assert.ok(records.every((record) => record.start instanceof Date && !Number.isNaN(record.start.getTime())), 'Event.start is the row\'s start');
    assert.ok(records.every((record) => /Jackhammer/.test(record.place)), 'Event.location is the place');

    const readable = sourceAudit.readableTextFromFeedBody(body, 6000);
    assert.ok(readable && /^Machine feed: 3 record\(s\)/.test(readable.text), readable && readable.text.split('\n')[0]);
    assert.equal(readable.truncated, false);
    // Every title reaches the model whatever the envelope size.
    for (const title of ['SMOOCH', 'BEAR HAPPY HOUR', 'BELLY UP + COAT DRIVE']) {
        assert.ok(readable.text.includes(title), `${title} is in the audit text`);
    }
    assert.ok(readable.text.length < body.length / 5, 'the rendering is the records, not the raw JSON');
});

test('source audit: an iCalendar door lists running series and dated nights and leaves the archive out', () => {
    const body = readFixture('google-calendar-basic.ics');
    const records = sourceAudit.feedRecordsFromBody(body);
    assert.equal(records.length, 3);
    const byTitle = (needle) => records.find((record) => record.title.includes(needle));
    assert.equal(byTitle('Pride Bear Party').historical, true, 'a 2023 single ended more than 30 days ago');
    assert.equal(byTitle("Dads 'n' Lads").historical, false, 'a weekly series with no UNTIL is still running');
    assert.equal(byTitle("Dads 'n' Lads").rrule, 'FREQ=WEEKLY;BYDAY=SU');
    assert.equal(byTitle('Blow Buddies in the East Village').start.toISOString(), '2026-10-29T00:00:00.000Z');

    const readable = sourceAudit.readableTextFromFeedBody(body, 6000);
    assert.match(readable.text, /^Machine feed: 3 record\(s\), 2 current, 1 ended more than 30 days ago \(not shown\)/);
    assert.ok(!readable.text.includes('Pride Bear Party'), 'the archive is not what the site publishes today');
    assert.ok(readable.text.includes("Dads 'n' Lads") && readable.text.includes('repeats FREQ=WEEKLY;BYDAY=SU'));
    assert.ok(readable.text.includes('Blow Buddies in the East Village'));
});

test('source audit: an HTML page is not a feed — the page reader keeps its job', async () => {
    assert.equal(sourceAudit.readableTextFromFeedBody('<html><body><h1>GRRR</h1></body></html>'), null);
    assert.equal(sourceAudit.feedRecordsFromBody(''), null);
    const adapter = { fetchData: async (url) => ({ url, fetchedAt: '2026-10-17T00:00:00.000Z', html: readFixture('ticketsauce-events-by-organization.json') }) };
    const fetched = await sourceAudit.fetchListingText(adapter, 'https://events.ticketsauce.com/events/events_by_organization/x/y/0/0/0/false/false/true/true/0');
    assert.ok(fetched.page && /^Machine feed/.test(fetched.page.text), 'fetchListingText routes a JSON body through the feed renderer');
    assert.ok(fetched.page.text.includes('BELLY UP + COAT DRIVE'));
});

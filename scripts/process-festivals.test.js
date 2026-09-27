const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const tool = require(path.join(__dirname, '..', 'tools', 'process-festivals.js'));

// ---------------------------------------------------------------------------
// The festivals calendar is a CURATED dataset — data/festivals.json is
// generated from it, and nothing else names those dates. In August 2026 two of
// its umbrellas came back as TIMED VEVENTs carrying the scraper's notes shape
// (bar: / timezone: / uid: / favicon:) in place of the curated keys, dated
// 2026-08-28 21:00, and the converter turned those clock times into the
// published nextDates: Bear Week Provincetown lost 2027-07-10..17 (a blank
// date line on the main page) and Bear Pride Chicago's YEARLY rule rolled to a
// derived 2027-08-28. A party record is not an official festival date.
// ---------------------------------------------------------------------------

// The two corrupt VEVENTs exactly as data/calendars/festivals.ics carries them
// (2026-09-25), plus a healthy curated umbrella for contrast.
const CORRUPT_ICS = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
    'X-WR-TIMEZONE:America/New_York',
    'BEGIN:VEVENT',
    'DTSTART:20260829T010000Z',
    'DTEND:20260829T050000Z',
    'DTSTAMP:20260823T201509Z',
    'UID:festival-bear-week-provincetown@chunky.dad',
    'URL:https://www.eventbrite.com/o/ptownbears-78481077703',
    'CREATED:20260727T172240Z',
    'DESCRIPTION:bar: Venue TBA\\ntimezone: America/New_York\\nuid: festival-bear-week-provincetown@chunky.dad\\nfavicon: https://img.evbuc.com/x.png\\nwebsite: https://www.eventbrite.com/o/ptownbears-78481077703',
    'LAST-MODIFIED:20260823T195110Z',
    'SEQUENCE:3',
    'STATUS:CONFIRMED',
    'SUMMARY:Bear Week Provincetown',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;TZID=America/New_York:20260828T210000',
    'DTEND;TZID=America/New_York:20260829T010000',
    'RRULE:FREQ=YEARLY',
    'DTSTAMP:20260823T201509Z',
    'UID:festival-bear-pride-chicago@chunky.dad',
    'CREATED:20260727T172240Z',
    'DESCRIPTION:bar: Venue TBA\\ntimezone: America/New_York\\nuid: festival-bear-pride-chicago@chunky.dad\\nfavicon: https://pbs.twimg.com/x.png\\nwebsite: https://www.instagram.com/bearpridechicago/',
    'LAST-MODIFIED:20260823T195132Z',
    'SEQUENCE:2',
    'STATUS:CONFIRMED',
    'SUMMARY:Bear Pride Chicago',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20261029',
    'DTEND;VALUE=DATE:20261102',
    'DTSTAMP:20260823T201509Z',
    'UID:festival-spooky-bear@chunky.dad',
    'CREATED:20260727T172240Z',
    'DESCRIPTION:key: spooky-bear\\ncategory: bear-run\\ncityKey: ptown\\nwebsite: https://www.ursamen.org/spookybear\\ntypicalTiming: late October (Halloween weekend)\\nrecurring: annual',
    'LAST-MODIFIED:20260727T172242Z',
    'LOCATION:Provincetown\\, MA',
    'SEQUENCE:0',
    'STATUS:CONFIRMED',
    'SUMMARY:Spooky Bear',
    'END:VEVENT',
    'END:VCALENDAR',
    ''
].join('\r\n');

// The dataset as it stood before the corruption (data/festivals.json @ #1549).
const PREVIOUS_ENTRIES = [
    {
        key: 'bear-week-provincetown',
        name: 'Bear Week Provincetown',
        category: 'bear-run',
        cityKey: 'ptown',
        location: 'Provincetown, MA',
        typicalTiming: 'second week of July',
        recurring: 'annual',
        website: 'https://www.eventbrite.com/o/ptownbears-78481077703',
        nextDates: { start: '2027-07-10', end: '2027-07-17' }
    },
    {
        key: 'bear-pride-chicago',
        name: 'Bear Pride Chicago',
        category: 'pride',
        cityKey: 'chicago',
        location: 'Chicago, IL (Northalsted)',
        typicalTiming: 'Memorial Day weekend (late May, alongside IML)',
        recurring: 'annual',
        website: 'https://www.instagram.com/bearpridechicago/'
    }
];

function convert(icsText, previousEntries = PREVIOUS_ENTRIES) {
    const calendar = new tool.CalendarCore();
    const events = calendar.parseICalData(icsText) || [];
    const rawBlocks = tool.parseRawVevents(icsText);
    const now = new Date('2026-09-25T12:00:00Z');
    const todayStr = tool.fmtPlainDate(tool.plainDateFromLocal(now));
    const cutoffStr = tool.fmtPlainDate(tool.addDays(tool.plainDateFromLocal(now), -tool.UPCOMING_GRACE_DAYS));
    return tool.convertEvents(events, rawBlocks, todayStr, cutoffStr, previousEntries);
}

test('festivals: a scraper-shaped VEVENT is refused by name and the dataset keeps its curated dates', () => {
    const { entries, warnings } = convert(CORRUPT_ICS);
    const byKey = new Map(entries.map(entry => [entry.key, entry]));

    // Refused loudly, naming the entry AND the shape that gave it away.
    const ptownRefusal = warnings.find(w => w.includes('REFUSED "Bear Week Provincetown"'));
    const chicagoRefusal = warnings.find(w => w.includes('REFUSED "Bear Pride Chicago"'));
    assert.ok(ptownRefusal, `no refusal warning for Bear Week Provincetown: ${JSON.stringify(warnings)}`);
    assert.ok(chicagoRefusal, `no refusal warning for Bear Pride Chicago: ${JSON.stringify(warnings)}`);
    assert.match(ptownRefusal, /scraper's notes block \(uid: favicon: bar:\)/);
    assert.match(chicagoRefusal, /scraper's notes block/);

    // The clock times never become dates.
    const ptown = byKey.get('bear-week-provincetown');
    assert.deepEqual(ptown.nextDates, { start: '2027-07-10', end: '2027-07-17' },
        'the curated Bear Week dates survive the party record');
    assert.equal(ptown.typicalTiming, 'second week of July');
    assert.equal(ptown.category, 'bear-run');

    // Chicago's YEARLY rule never rolls to a derived 2027-08-28 either: the
    // previous entry is undated (estimated) and stays that way.
    const chicago = byKey.get('bear-pride-chicago');
    assert.equal(chicago.nextDates, undefined, 'the estimated Chicago entry stays undated');
    assert.equal(chicago.category, 'pride');

    // And the run says which entry kept its previous dates.
    assert.ok(warnings.some(w => /Bear Week Provincetown.*keeping the previous data\/festivals\.json entry \(2027-07-10\.\.2027-07-17\)/.test(w)),
        JSON.stringify(warnings));
});

test('festivals: a healthy curated all-day umbrella still converts untouched', () => {
    const { entries, warnings } = convert(CORRUPT_ICS);
    const spooky = entries.find(entry => entry.key === 'spooky-bear');
    assert.ok(spooky, 'the curated Spooky Bear umbrella must still convert');
    assert.deepEqual(spooky.nextDates, { start: '2026-10-29', end: '2026-11-01' });
    assert.equal(spooky.location, 'Provincetown, MA');
    assert.ok(!warnings.some(w => w.includes('REFUSED "Spooky Bear"')), 'a curated umbrella is never refused');
});

test('festivals: a refused VEVENT with no previous entry drops out and says so', () => {
    const { entries, warnings } = convert(CORRUPT_ICS, []);
    assert.equal(entries.find(entry => entry.key === 'bear-week-provincetown'), undefined,
        'with nothing curated to keep, a party record still contributes no dates');
    assert.ok(warnings.some(w => /carries no previous entry for key "bear-week-provincetown"/.test(w)),
        JSON.stringify(warnings));
});

test('festivals: describeScraperRecordRefusal names both tells and clears a real umbrella', () => {
    // 1. the scraper's notes keys, whatever the times say
    assert.match(
        tool.describeScraperRecordRefusal(
            { name: 'X', unprocessedDescription: 'uid: festival-x@chunky.dad\\nwebsite: https://x.test' },
            { allDay: true, dtstartRaw: '20270710' },
            {}
        ),
        /scraper's notes block \(uid:\)/
    );
    // 2. a timed VEVENT with none of the curated keys
    assert.match(
        tool.describeScraperRecordRefusal(
            { name: 'X', unprocessedDescription: 'some free text' },
            { allDay: false, dtstartRaw: '20260828T210000' },
            {}
        ),
        /TIMED VEVENT \(20260828T210000\)/
    );
    // A curated all-day umbrella clears both.
    assert.equal(
        tool.describeScraperRecordRefusal(
            { name: 'Spooky Bear', unprocessedDescription: 'key: spooky-bear\\ncategory: bear-run' },
            { allDay: true, dtstartRaw: '20261029' },
            { key: 'spooky-bear', category: 'bear-run' }
        ),
        ''
    );
    // So does a TIMED entry that still carries curated keys — the tell is the
    // absence of curated data, not the clock (that shape only gets the
    // existing report-only warning in buildEntry).
    assert.equal(
        tool.describeScraperRecordRefusal(
            { name: 'Half-day thing', unprocessedDescription: 'key: half-day\\ncategory: festival' },
            { allDay: false, dtstartRaw: '20260828T210000' },
            { key: 'half-day', category: 'festival' }
        ),
        ''
    );
});

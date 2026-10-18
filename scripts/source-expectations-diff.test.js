// ============================================================================
// SOURCE EXPECTATIONS DIFF — unit tests on synthetic fixtures
// ============================================================================
// tools/source-expectations-diff.js compares data/source-expectations/*.json
// against one run file. These tests build tiny expectation docs and a tiny
// run object in memory and check each outcome the README's rule produces:
// found exact, found fuzzy (a rename), missing (upcoming vs past), a leaked
// trap, a publishes-nothing source, a series occurrence, an aggregator row
// found through its owning parser, and a parser absent from the run.
// Nothing here reads the real expectations or a real run.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');

const diff = require('../tools/source-expectations-diff');

const RUN_DAY = '2026-10-17';

function runEvent(title, startIso, bar, extra = {}) {
    return Object.assign({ title, startDate: startIso, bar, timezone: 'America/New_York', source: 'ai-web' }, extra);
}

function dropped(title, startIso, bar, extra = {}) {
    return { title, startDate: startIso, venue: bar, reason: 'manual store: not_bear', host: 'example.test', event: runEvent(title, startIso, bar, extra) };
}

function doc(source, overrides = {}) {
    return Object.assign({
        source,
        status: 'complete',
        recon: { date: '2026-09-20' },
        coverage: { occurrenceWindow: { start: '2026-09-20', end: '2026-12-19' } },
        defaults: { bar: 'Test Bar', timezone: 'America/New_York' },
        events: [],
        traps: []
    }, overrides);
}

function single(id, title, day, extracted = true, extra = {}) {
    return Object.assign({ id, kind: 'single', title, startDate: day, startTime: '21:00', expect: { extracted } }, extra);
}

const RUN = {
    summary: { runId: '20261017-054812', timestamp: '2026-10-17T09:48:12.250Z' },
    parserResults: [
        {
            name: 'Test Bar',
            events: [
                // 22:00 New York on the 24th is 02:00Z on the 25th: the local day must win.
                runEvent('DIRTY LITTLE SECRET', '2026-10-25T02:00:00.000Z', 'Test Bar'),
                runEvent('JOCK ROCK HALLOWEEN EDITION', '2026-10-31T01:00:00.000Z', 'Test Bar'),
                runEvent('BRAND NEW NIGHT', '2026-11-03T01:00:00.000Z', 'Test Bar'),
                runEvent('Drag Race Viewing Party', '2024-02-03T00:00:00.000Z', 'Test Bar')
            ],
            bearDroppedEvents: [
                dropped('PRIVATE EVENT', '2026-11-06T00:00:00.000Z', 'Test Bar'),
                dropped('TRIVIA', '2026-10-21T00:00:00.000Z', 'Test Bar')
            ]
        },
        {
            name: 'Owner Pub',
            events: [runEvent('B BAR', '2026-10-23T02:00:00.000Z', 'Owner Pub')],
            bearDroppedEvents: []
        },
        {
            name: 'Aggregator',
            events: [runEvent('Somewhere Else Party', '2026-10-21T00:00:00.000Z', 'Elsewhere')],
            bearDroppedEvents: []
        },
        { name: 'Quiet Source', events: [], bearDroppedEvents: [] }
    ],
    bearDroppedEvents: []
};

function report(docs, run = RUN) {
    return diff.diffAll(docs, run, { runDay: RUN_DAY });
}

function only(result, source) {
    const row = result.sources.find((s) => s.source === source);
    assert.ok(row, `no row for ${source}`);
    return row;
}

test('found exact, fuzzy rename, missing upcoming and missing past are told apart', () => {
    const d = doc('Test Bar', {
        events: [
            single('dls', 'DIRTY LITTLE SECRET', '2026-10-24'),
            single('jock-rock', 'JOCK ROCK', '2026-10-30'),
            single('ghost-upcoming', 'GHOST NIGHT', '2026-11-20'),
            single('ghost-past', 'OLD NIGHT', '2026-09-25')
        ]
    });
    const row = only(report([d]), 'Test Bar');
    assert.equal(row.counts.expected, 4);
    assert.equal(row.counts.exact, 1, 'local day (not the UTC day) matches the expectation');
    assert.equal(row.found[0].title, 'DIRTY LITTLE SECRET');
    assert.equal(row.counts.fuzzy, 1, 'a guest name appended to the title is a fuzzy find, not a miss');
    assert.equal(row.fuzzy[0].record.title, 'JOCK ROCK HALLOWEEN EDITION');
    assert.equal(row.counts.missingUpcoming, 1);
    assert.equal(row.missing[0].title, 'GHOST NIGHT');
    assert.equal(row.counts.missingPast, 1);
    assert.equal(row.missingPast[0].title, 'OLD NIGHT');
    assert.equal(row.verdict, 'missing');
});

test('a series contributes one row per listed occurrence, cancelled nights excluded, and the rule check reads the RRULE', () => {
    const d = doc('Test Bar', {
        events: [{
            id: 'dls', kind: 'series', title: 'DIRTY LITTLE SECRET', startDate: '2026-07-10', startTime: '22:00',
            recurrence: 'FREQ=WEEKLY;BYDAY=FR', recurrenceStatedAs: 'Every Friday',
            occurrences: [
                { startDate: '2026-10-24', origin: 'listed', evidence: { url: 'https://example.test/', quote: '24 DLS' } },
                { startDate: '2026-10-31', origin: 'rule', cancelled: true },
                { startDate: '2026-11-07', origin: 'rule' }
            ],
            expect: { extracted: true }
        }]
    });
    const row = only(report([d]), 'Test Bar');
    assert.equal(row.counts.expected, 2, 'two live occurrences; the cancelled one is not expected');
    assert.equal(row.cancelledSkipped, 1);
    assert.equal(row.counts.exact, 1);
    assert.equal(row.counts.missingUpcoming, 1);
    assert.equal(row.missing[0].day, '2026-11-07');
    assert.equal(row.missing[0].origin, 'rule');
    assert.equal(row.counts.missingUpcomingListed, 0, 'a rule-derived miss is not a site-listed miss');
    // The window holds thirteen Fridays from 2026-09-25; the file lists three.
    assert.equal(row.ruleCheck.checked, 1);
    assert.ok(row.ruleCheck.unlisted.length >= 9, `rule check should name the Fridays the file skipped, got ${row.ruleCheck.unlisted.length}`);
    assert.ok(row.ruleCheck.unlisted.every((u) => !['2026-10-24', '2026-10-31', '2026-11-07'].includes(u.day)));
});

test('a trap with expect.extracted:false that appears in the run is leaked; the verdict is leaking', () => {
    const d = doc('Test Bar', {
        events: [single('dls', 'DIRTY LITTLE SECRET', '2026-10-24')],
        traps: [
            { id: 'closure', kind: 'announcement', label: 'CLOSED FOR A PRIVATE EVENT (all-day row)', why: 'closure notice', evidence: { url: 'https://example.test/', quote: 'CLOSED FOR A PRIVATE EVENT' }, expect: { extracted: false } },
            { id: 'ended-series', kind: 'past-event', label: 'Drag Race Viewing Party (ended 2024-05-01)', why: 'ended', evidence: { url: 'https://example.test/', quote: 'Drag Race Viewing Party 2024-02-03' }, expect: { extracted: false } },
            { id: 'quiet-trap', kind: 'navigation', label: 'Upcoming Events heading', why: 'nav', evidence: { url: 'https://example.test/', quote: 'Upcoming Events' }, expect: { extracted: false } },
            { id: 'allowed-past', kind: 'past-event', label: 'TRIVIA — October 20, 2026', why: 'allowPastEvents keeps it', evidence: { url: 'https://example.test/', quote: 'October 20, 2026' }, expect: { extracted: true } }
        ]
    });
    const row = only(report([d]), 'Test Bar');
    assert.equal(row.verdict, 'leaking');
    assert.equal(row.counts.leaked, 2);
    const leakedIds = row.leaked.map((l) => l.id).sort();
    assert.deepEqual(leakedIds, ['closure', 'ended-series']);
    assert.match(row.leaked.find((l) => l.id === 'ended-series').basis, /2024-02-03/);
    assert.equal(row.counts.trapsExpectedFound, 1, 'a trap the scraper is right to extract is reported found, not leaked');
    // Records a trap claimed are not extras.
    assert.ok(!row.extras.some((e) => e.title === 'PRIVATE EVENT'));
});

test('a record that satisfies an expectation is never also a trap leak', () => {
    const d = doc('Test Bar', {
        recon: { date: '2026-10-10' },
        events: [single('dls', 'DIRTY LITTLE SECRET', '2026-10-24')],
        traps: [{ id: 'tiers', kind: 'ticket-tier', label: '"DIRTY LITTLE SECRET – Tier 1" ticket rows', why: 'tiers', evidence: { url: 'https://example.test/', quote: 'Tier 1' }, expect: { extracted: false } }]
    });
    const row = only(report([d]), 'Test Bar');
    assert.equal(row.counts.exact, 1);
    assert.equal(row.counts.leaked, 0);
    assert.equal(row.verdict, 'clean');
});

test('an event with expect.extracted:false that is in the run is a leak too', () => {
    const d = doc('Test Bar', { events: [single('new', 'BRAND NEW NIGHT', '2026-11-02', false)] });
    const row = only(report([d]), 'Test Bar');
    assert.equal(row.counts.leaked, 1);
    assert.equal(row.leaked[0].what, 'event');
});

test('extras are the run records inside the window that nothing claims; stale needs an old recon', () => {
    const d = doc('Test Bar', { recon: { date: '2026-09-01' }, events: [single('dls', 'DIRTY LITTLE SECRET', '2026-10-24')] });
    const row = only(report([d]), 'Test Bar');
    // JOCK ROCK…, BRAND NEW NIGHT, PRIVATE EVENT, TRIVIA are in the window; the 2024 record is not.
    assert.equal(row.counts.extra, 4);
    assert.ok(!row.extras.some((e) => e.day.startsWith('2024')));
    assert.equal(row.reconAgeDays, 46);
    assert.equal(row.verdict, 'stale');

    const fresh = only(report([doc('Test Bar', { recon: { date: '2026-10-10' }, events: [single('dls', 'DIRTY LITTLE SECRET', '2026-10-24')] })]), 'Test Bar');
    assert.equal(fresh.counts.extra, 4);
    assert.equal(fresh.verdict, 'clean', 'extras alone within 21 days of recon are not stale');
});

test('publishes-nothing: no window, so every record from the recon day on is an extra; an empty parser is clean', () => {
    const quiet = doc('Quiet Source', { status: 'publishes-nothing', coverage: { occurrenceWindow: null }, defaults: {} });
    const row = only(report([quiet]), 'Quiet Source');
    assert.equal(row.parserInRun, true);
    assert.equal(row.counts.expected, 0);
    assert.equal(row.counts.extra, 0);
    assert.equal(row.verdict, 'clean');

    const noisy = doc('Test Bar', { status: 'publishes-nothing', coverage: { occurrenceWindow: null }, recon: { date: '2026-09-01' } });
    const noisyRow = only(report([noisy]), 'Test Bar');
    assert.equal(noisyRow.counts.extra, 5, 'everything dated from the recon day on, the 2024 record excluded');
    assert.equal(noisyRow.verdict, 'stale');
});

test('an aggregator row is found through the parser it belongs to, and a parser missing from the run has its own verdict', () => {
    const agg = doc('Aggregator', {
        defaults: {},
        events: [
            single('b-bar', 'B BAR', '2026-10-22', true, { bar: null, belongsToSource: 'Owner Pub' }),
            single('somewhere', 'Somewhere Else Party', '2026-10-20', true, { bar: 'Elsewhere' })
        ]
    });
    const gone = doc('Not Configured Anymore', { events: [single('x', 'ANYTHING', '2026-11-01')] });
    const result = report([agg, gone]);
    const aggRow = only(result, 'Aggregator');
    assert.equal(aggRow.counts.exact, 2);
    assert.equal(aggRow.found.find((f) => f.title === 'B BAR').via, 'Owner Pub');
    const goneRow = only(result, 'Not Configured Anymore');
    assert.equal(goneRow.verdict, 'no-parser-in-run');
    assert.equal(goneRow.parserInRun, false);
    // Worst first: the absent parser sorts above everything else.
    assert.equal(result.sources[0].source, 'Not Configured Anymore');
    assert.deepEqual(result.verdicts, { 'no-parser-in-run': 1, clean: 1 });
});

test('a one-token title key with disagreeing bars is not an exact match', () => {
    const run = {
        summary: { runId: '20261017-054812' },
        parserResults: [{ name: 'Agg', events: [runEvent('Alley Bears', '2026-10-25T20:00:00.000Z', 'The Alley Bar')], bearDroppedEvents: [] }]
    };
    const d = doc('Agg', { defaults: {}, events: [single('sb', 'Sunday Bears', '2026-10-25', true, { bar: 'Town Hall Hotel' })] });
    const row = only(report([d], run), 'Agg');
    assert.equal(row.counts.exact, 0);
    assert.equal(row.counts.fuzzy, 0);
    assert.equal(row.counts.missingUpcoming, 1);
});

test('ticketUrl is the fallback key when the title differs, within a day', () => {
    const run = {
        summary: { runId: '20261017-054812' },
        parserResults: [{ name: 'Tix', events: [runEvent('Completely Renamed', '2026-11-13T05:00:00.000Z', 'Hall', { ticketUrl: 'https://www.eventbrite.com/e/party-123?aff=x' })], bearDroppedEvents: [] }]
    };
    const d = doc('Tix', { defaults: {}, events: [single('p', 'Original Party Name', '2026-11-12', true, { ticketUrl: 'https://eventbrite.com/e/party-123' })] });
    const row = only(report([d], run), 'Tix');
    assert.equal(row.counts.exact, 1);
    assert.equal(row.found[0].tier, 'url');
});

test('older runs with only a top-level bearDroppedEvents list are attributed by host', () => {
    const run = {
        summary: { runId: '20260901-010101' },
        parserResults: [{ name: 'Host Bar', config: { urls: ['https://www.hostbar.test/events'] }, events: [] }],
        bearDroppedEvents: [
            { host: 'hostbar.test', reason: 'ai: no', event: runEvent('HOST NIGHT', '2026-09-20T01:00:00.000Z', 'Host Bar') },
            { host: 'other.test', reason: 'ai: no', event: runEvent('OTHER NIGHT', '2026-09-20T01:00:00.000Z', 'Other') }
        ]
    };
    const d = doc('Host Bar', { recon: { date: '2026-08-30' }, defaults: { bar: 'Host Bar' }, events: [single('h', 'HOST NIGHT', '2026-09-19')] });
    const row = only(diff.diffAll([d], run, { runDay: '2026-09-01' }), 'Host Bar');
    assert.equal(row.counts.dropped, 1, 'only the matching host is attributed');
    assert.equal(row.counts.exact, 1);
});

test('trap probes read dates in every shape the files use', () => {
    assert.deepEqual(diff.datesInText('DTSTART;TZID=America/New_York:20251115T160000 / SUMMARY:X').sort(), ['2025-11-15']);
    assert.deepEqual(diff.datesInText('Craftaoke — September 2, 2026 (listed)').sort(), ['2026-09-02']);
    assert.deepEqual(diff.datesInText('Run 20260909-072307 contains Gay Geek Trivia 2024-06-05').sort(), ['2024-06-05'], 'a run id is not a date');
    assert.deepEqual(diff.datesInText('returns November 27th through the 30th', { reconDay: '2026-09-24' }), ['2026-11-27'], 'a year-less month-day reads against the recon year');
    assert.deepEqual(diff.datesInText('Jan 23 – 31 • Puerto Vallarta', { reconDay: '2026-09-10' }), ['2027-01-23'], 'a month well before the recon month rolls to next year');
});

test('the console table lists sources worst first and the summary names the run', () => {
    const result = report([
        doc('Test Bar', { events: [single('dls', 'DIRTY LITTLE SECRET', '2026-10-24')] }),
        doc('Gone', { events: [single('g', 'G', '2026-11-01')] })
    ]);
    const table = diff.renderTable(result);
    const lines = table.split('\n');
    assert.match(lines[0], /^source\s+verdict\s+exp\s+exact\s+fuzzy\s+miss↑/);
    assert.match(lines[2], /^Gone\s+no-parser-in-run/);
    assert.match(lines[3], /^Test Bar\s+(clean|stale)/);
    assert.match(diff.renderSummaryLines(result)[0], /Run 20261017-054812 \(2026-10-17\)/);
    const verbose = diff.renderVerbose(result);
    assert.match(verbose, /## Gone — no-parser-in-run/);
    assert.match(verbose, /PARSER NOT IN RUN/);
});

test('runDayOf prefers the run id and falls back to the timestamp', () => {
    assert.equal(diff.runDayOf({ summary: { runId: '20261017-054812' } }), '2026-10-17');
    assert.equal(diff.runDayOf({ summary: { timestamp: '2026-10-16T23:00:00.000Z' } }), '2026-10-16');
    assert.equal(diff.runDayOf({}, '20261015-053853'), '2026-10-15');
});

test('a site-wide website is not an identity, and the brand prefix the scraper adds is keyed away', () => {
    const site = 'https://www.lodge.test/';
    const run = {
        summary: { runId: '20261017-054812' },
        parserResults: [{
            name: 'Lodge',
            events: [
                runEvent('Lodge: Blow Buddies', '2026-10-17T00:00:00.000Z', 'Lodge', { website: site }),
                runEvent('Lodge: Squeeze', '2026-10-17T02:00:00.000Z', 'Lodge', { website: site }),
                runEvent("Lodge: Dads 'n' Lads", '2026-10-19T00:00:00.000Z', 'Lodge', { website: site })
            ],
            bearDroppedEvents: []
        }]
    };
    const d = doc('Lodge', {
        defaults: { bar: 'Lodge', website: 'https://www.lodge.test' },
        events: [
            // The ICS summary carries the street address; the run carries the brand prefix instead.
            single('bb', 'Blow Buddies 457 W 56th St, 2nd Fl', '2026-10-16'),
            single('manhole', 'Manhole in Park Slope', '2026-10-18')
        ]
    });
    const row = only(report([d], run), 'Lodge');
    assert.equal(row.counts.exact, 1, 'Blow Buddies meets its prefixed, address-less twin: the head before the street number is the party');
    assert.equal(row.found[0].record.title, 'Lodge: Blow Buddies');
    assert.equal(row.found[0].tier, 'exact');
    assert.equal(row.counts.missingUpcoming, 1, 'the shared homepage must not let Manhole match any record');
    assert.equal(row.missing[0].title, 'Manhole in Park Slope');
    assert.equal(row.found.filter((f) => f.tier === 'url').length, 0);
});

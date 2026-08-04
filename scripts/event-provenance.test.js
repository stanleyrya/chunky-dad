const test = require('node:test');
const assert = require('node:assert/strict');

const {
    EventProvenance,
    buildProvenanceModel,
    buildExportIssuePayload,
    buildExportIssueJson,
    buildExportIssueCompactJson,
    buildEventProvenanceSectionHtml
} = require('./event-provenance');

// ---------------------------------------------------------------------------
// Fixture shaped exactly like a calendar-merged analyzed event after
// createFinalEventObject + sanitizeEventForRunSave (see shared-core.js
// STEP 6 and the _mergeDecisions/aiArbitration records it attaches).
// ---------------------------------------------------------------------------
function buildMergedEventFixture() {
    return {
        title: 'BEARRACUDA: Atlanta',
        bar: 'Heretic',
        address: '2069 Cheshire Bridge Rd',
        location: '33.823,-84.356',
        city: 'atlanta',
        startDate: '2026-08-01T02:00:00.000Z',
        endDate: '2026-08-01T06:00:00.000Z',
        description: 'Bear dance party',
        url: 'https://bearracuda.com/events/atlanta',
        source: 'bearracuda',
        notes: 'internal notes blob',
        _action: 'merge',
        _parserConfig: { name: 'Bearracuda', parser: 'bearracuda' },
        _fieldPriorities: { title: { merge: 'clobber' } },
        _original: {
            scraper: {
                title: 'BEARRACUDA: Atlanta',
                bar: 'Heretic',
                address: '2069 Cheshire Bridge Rd',
                city: 'atlanta',
                startDate: '2026-08-01T02:00:00.000Z',
                endDate: '2026-08-01T04:00:00.000Z',
                description: 'Bear dance party',
                url: 'https://bearracuda.com/events/atlanta'
            },
            calendar: {
                title: 'Bearracuda Atlanta',
                bar: 'Heretic',
                address: '2069 Cheshire Bridge Rd',
                location: '33.823,-84.356',
                city: 'atlanta',
                startDate: '2026-08-01T02:00:00.000Z',
                endDate: '2026-08-01T06:00:00.000Z',
                description: 'Bear dance party'
            },
            merged: {},
            aiArbitration: { arbitrated: ['endDate'], fallbacks: ['title'] }
        },
        _mergeDecisions: [
            {
                field: 'endDate',
                existingValue: '2026-08-01T06:00:00.000Z',
                newValue: '2026-08-01T04:00:00.000Z',
                chosenValue: '2026-08-01T06:00:00.000Z',
                reason: 'calendar end matches doors-close time',
                source: 'ai'
            },
            {
                field: 'title',
                existingValue: 'Bearracuda Atlanta',
                newValue: 'BEARRACUDA: Atlanta',
                chosenValue: 'BEARRACUDA: Atlanta',
                reason: 'ai unavailable/rejected — clobber fallback',
                source: 'fallback'
            }
        ]
    };
}

// ---------------------------------------------------------------------------
// Interesting-row selection
// ---------------------------------------------------------------------------

test('provenance model keeps only interesting rows and counts pass-through fields', () => {
    const model = buildProvenanceModel(buildMergedEventFixture());

    // title (decision + calendar differs), location (scraper found none),
    // endDate (decision + scraper differs) — in PROVENANCE_FIELDS order.
    assert.deepEqual(model.rows.map(row => row.field), ['title', 'location', 'endDate']);
    // bar, address, city, startDate, description are identical pass-throughs
    assert.equal(model.unchangedCount, 5);
    assert.equal(model.hasProvenance, true);
    assert.equal(model.hasCalendar, true);
    assert.equal(model.parser, 'bearracuda');
    assert.equal(model.sourceUrl, 'https://bearracuda.com/events/atlanta');
    assert.equal(model.action, 'merge');
    assert.equal(model.arbitrationSummary, 'AI arbitration: 1 arbitrated, 1 fallback');
});

test('date fields compare by instant: a live Date equals its saved ISO string', () => {
    const event = buildMergedEventFixture();
    event.startDate = new Date('2026-08-01T02:00:00.000Z'); // live-run shape
    const model = buildProvenanceModel(event);

    assert.ok(!model.rows.some(row => row.field === 'startDate'),
        'identical instants must not become a row');
    assert.equal(EventProvenance.valuesEqual('startDate',
        new Date('2026-08-01T02:00:00.000Z'), '2026-08-01T02:00:00.000Z'), true);
    // Non-date fields stay strict
    assert.equal(EventProvenance.valuesEqual('title', 'A', 'a'), false);
});

test('section HTML renders the rows, the unchanged note and the header line', () => {
    const html = buildEventProvenanceSectionHtml(buildMergedEventFixture(), { runId: '20260713-090000' });

    assert.ok(html.includes('<details class="provenance-details">'));
    assert.ok(!html.includes('<details class="provenance-details" open'), 'must be collapsed by default');
    assert.ok(html.includes('🔍 Provenance'));
    assert.ok(html.includes('Parser: bearracuda'));
    assert.ok(html.includes('Action: merge'));
    assert.ok(html.includes('AI arbitration: 1 arbitrated, 1 fallback'));
    assert.ok(html.includes('https://bearracuda.com/events/atlanta'));
    assert.ok(html.includes('5 fields unchanged'));
    assert.ok(html.includes('<th>Calendar</th>'), 'calendar column present for calendar merges');
    assert.ok(html.includes('📤 Export issue'));
});

// ---------------------------------------------------------------------------
// Decision-text rendering
// ---------------------------------------------------------------------------

test('recorded merge decisions render as AI / fallback decision text', () => {
    const html = buildEventProvenanceSectionHtml(buildMergedEventFixture());

    assert.ok(html.includes('AI: calendar end matches doors-close time'));
    assert.ok(html.includes('AI fallback: ai unavailable/rejected — clobber fallback'));
});

test('fields without a recorded decision derive text from which side won', () => {
    const model = buildProvenanceModel(buildMergedEventFixture());
    const locationRow = model.rows.find(row => row.field === 'location');

    assert.equal(locationRow.recorded, false);
    assert.equal(locationRow.decisionText, 'kept from calendar (scrape found none)');
});

test('cross-parser mergeDecisions records (no source key) render their reason as-is', () => {
    const event = {
        title: 'FURBALL',
        bar: 'Eagle NYC',
        source: 'furball',
        mergeDecisions: [{
            field: 'bar',
            existingValue: 'Eagle',
            newValue: 'Eagle NYC',
            chosenValue: 'Eagle NYC',
            reason: 'furball has higher priority (index 0 vs 1)'
        }]
    };
    const html = buildEventProvenanceSectionHtml(event);
    assert.ok(html.includes('furball has higher priority (index 0 vs 1)'));
});

// ---------------------------------------------------------------------------
// Graceful degradation
// ---------------------------------------------------------------------------

test('an event without _original or decisions renders a note, never throws', () => {
    const html = buildEventProvenanceSectionHtml({
        title: 'Bear Night',
        startDate: '2026-08-01T02:00:00.000Z',
        _action: 'new',
        source: 'chunk'
    });

    assert.ok(html.includes('No provenance recorded'));
    assert.ok(html.includes('Parser: chunk'));
    assert.ok(html.includes('📤 Export issue'), 'export still available without provenance');
});

test('null / malformed inputs never throw', () => {
    assert.ok(buildEventProvenanceSectionHtml(null).includes('No provenance recorded'));
    assert.ok(buildEventProvenanceSectionHtml(undefined).includes('No provenance recorded'));
    assert.ok(buildEventProvenanceSectionHtml('not-an-object').includes('No provenance recorded'));
    assert.doesNotThrow(() => buildEventProvenanceSectionHtml({
        _original: 'garbage',
        _mergeDecisions: [null, 42, { noField: true }, { field: 7 }],
        mergeDecisions: 'also-garbage'
    }));
    assert.doesNotThrow(() => buildExportIssuePayload(null));
    assert.equal(typeof JSON.parse(buildExportIssueJson(null)), 'object');
});

test('an _original with only a scraper side renders without a calendar column', () => {
    const event = {
        title: 'CHUNK',
        bar: 'Precinct',
        _original: {
            scraper: { title: 'CHUNK LA', bar: 'Precinct' }
        }
    };
    const model = buildProvenanceModel(event);
    assert.equal(model.hasCalendar, false);
    assert.deepEqual(model.rows.map(row => row.field), ['title']);

    const html = buildEventProvenanceSectionHtml(event);
    assert.ok(!html.includes('<th>Calendar</th>'));
});

// ---------------------------------------------------------------------------
// Export payload
// ---------------------------------------------------------------------------

test('export payload is valid JSON with the documented shape', () => {
    const json = buildExportIssueJson(buildMergedEventFixture(), {
        runId: '20260713-090000',
        timestamp: '2026-07-13T09:00:00.000Z'
    });
    const payload = JSON.parse(json);

    assert.equal(payload.runId, '20260713-090000');
    assert.equal(payload.timestamp, '2026-07-13T09:00:00.000Z');
    assert.equal(payload.parser, 'bearracuda');
    assert.equal(payload.sourceUrl, 'https://bearracuda.com/events/atlanta');
    assert.equal(payload.action, 'merge');
    assert.equal(payload.finalValues.title, 'BEARRACUDA: Atlanta');
    assert.equal(payload.scraperValues.endDate, '2026-08-01T04:00:00.000Z');
    assert.equal(payload.calendarValues.title, 'Bearracuda Atlanta');
    assert.equal(payload.mergeDecisions.length, 2);
    assert.equal(payload.mergeDecisions[0].reason, 'calendar end matches doors-close time');
    assert.equal(payload.mergeDecisions[0].source, 'ai');
    assert.deepEqual(payload.aiArbitration, { arbitrated: ['endDate'], fallbacks: ['title'] });
});

test('export payload excludes internal fields and function values', () => {
    const event = buildMergedEventFixture();
    event.description = () => 'functions never belong in an export';
    event._existingEvent = { identifier: 'ABC' };

    const payload = buildExportIssuePayload(event, { runId: 'r1' });

    for (const section of [payload.finalValues, payload.scraperValues, payload.calendarValues]) {
        for (const key of Object.keys(section)) {
            assert.ok(!key.startsWith('_'), `internal key leaked: ${key}`);
            assert.ok(EventProvenance.PROVENANCE_FIELDS.includes(key), `unlisted key leaked: ${key}`);
        }
    }
    assert.ok(!('description' in payload.finalValues), 'function value must be dropped');
    assert.ok(!('notes' in payload.finalValues));
    assert.ok(!JSON.stringify(payload).includes('_existingEvent'));
});

test('export payload survives Dates and circular references', () => {
    const event = buildMergedEventFixture();
    event.startDate = new Date('2026-08-01T02:00:00.000Z');
    const circular = { note: 'loop' };
    circular.self = circular;
    event._original.scraper.description = circular;

    const payload = JSON.parse(buildExportIssueJson(event));
    assert.equal(payload.finalValues.startDate, '2026-08-01T02:00:00.000Z');
    assert.equal(payload.scraperValues.description.note, 'loop');
});

// ---------------------------------------------------------------------------
// HTML escaping & truncation
// ---------------------------------------------------------------------------

test('values with markup, quotes and emoji are escaped in the section HTML', () => {
    const event = {
        title: '<script>alert("pwned")</script>',
        _original: {
            scraper: { title: `Bear & "Cub's" 🐻 <b>Night</b>` },
            calendar: { title: 'Bear Night' }
        }
    };
    const html = buildEventProvenanceSectionHtml(event);

    assert.ok(!html.includes('<script>alert'));
    assert.ok(!html.includes('<b>Night</b>'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('&quot;'));
    assert.ok(html.includes('&#39;'));
    assert.ok(html.includes('🐻'), 'emoji pass through unmangled');
});

test('long values are truncated with the full value preserved in title=', () => {
    const longValue = 'Woof! '.repeat(40).trim(); // ~240 chars
    const event = {
        description: longValue,
        _original: {
            scraper: { description: longValue },
            calendar: { description: 'short' }
        }
    };
    const html = buildEventProvenanceSectionHtml(event);

    assert.ok(html.includes(`title="${EventProvenance.escapeHtml(longValue)}"`));
    assert.ok(html.includes('…'));
    assert.ok(!html.includes(`>${EventProvenance.escapeHtml(longValue)}<`), 'cell text must be truncated');
});

test('the export control embeds a URI-encoded payload the page JS can decode', () => {
    const html = buildEventProvenanceSectionHtml(buildMergedEventFixture(), { runId: 'r1' });
    const match = html.match(/data-payload="([^"]*)"/);
    assert.ok(match, 'data-payload attribute missing');

    const decoded = decodeURIComponent(match[1]);
    const payload = JSON.parse(decoded);
    assert.equal(payload.runId, 'r1');
    assert.equal(payload.parser, 'bearracuda');
    assert.ok(html.includes(`onclick="exportProvenanceIssue(this)"`));
    assert.ok(html.includes('provenance-export-text'));
    assert.ok(html.includes('onfocus="this.select()"'));
});

// The data-payload attribute is percent-encoded, where every indent space
// costs 3 bytes (`%20`). The embedded copy is therefore compact and the page
// handler re-indents before showing the textarea — so the payload the owner
// copies must be IDENTICAL in content to the pretty serialization.
test('export payload: the compact embed round-trips to the same object as the pretty form', () => {
  const event = buildMergedEventFixture();
  const options = { action: 'merge', parser: 'Eagle LA', runId: '20260803-143036' };
  const pretty = buildExportIssueJson(event, options);
  const compact = buildExportIssueCompactJson(event, options);

  assert.deepEqual(JSON.parse(compact), JSON.parse(pretty), 'same payload, different whitespace');
  assert.ok(compact.length < pretty.length, 'the compact form is smaller');
  assert.ok(!/\n/.test(compact), 'no newlines to percent-encode');
  // What the page does before showing the textarea.
  assert.equal(JSON.stringify(JSON.parse(compact), null, 2), pretty, 're-indenting reproduces the pretty form exactly');
});

test('export payload: the compact builder degrades like the pretty one', () => {
  assert.equal(typeof JSON.parse(buildExportIssueCompactJson(null)), 'object');
  const circular = { title: 'Loop' };
  circular.self = circular;
  const stub = JSON.parse(buildExportIssueCompactJson(circular));
  assert.ok(typeof stub === 'object' && stub !== null, 'never throws, always parseable');
});

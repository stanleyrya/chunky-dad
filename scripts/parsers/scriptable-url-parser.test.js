const test = require('node:test');
const assert = require('node:assert/strict');

const { ScriptableUrlParser } = require('./scriptable-url-parser');
const { EventSchema } = require('../event-schema');
const { SharedCore } = require('../shared-core');

function createParser() {
  return new ScriptableUrlParser({}, { eventSchema: EventSchema });
}

// The Event Builder hands the script back a plain query dict. These are the
// real parameters captured from a phone run on 2026-07-31 (CubScout at Eagle
// LA), trimmed to what each test needs.
function buildQuery(overrides = {}) {
  return {
    title: 'CUBSCOUT',
    city: 'la',
    bar: 'Eagle+LA',
    startDate: '2026-09-05T04:00:00.000Z',
    endDate: '2026-09-05T09:00:00.000Z',
    timezone: 'America/Los_Angeles',
    website: 'https://eaglela.com/events/cub-scout-3/',
    ...overrides
  };
}

function parseQuery(query) {
  return createParser().buildEventFromPayload({ queryParameters: query }, {}, null);
}

// ---------------------------------------------------------------------------
// Recurrence round-trip. The schema canonicalizes rrule/recurrenceRule to
// `recurrence`, but the series stamp reads `recurrenceRule` — so a builder
// link describing a monthly party used to come back as a plain one-off and
// lose its rule entirely on the calendar write.
// ---------------------------------------------------------------------------

test('builder recurrence: a link carrying an rrule produces a recurring series', () => {
  const event = parseQuery(buildQuery({ recurrence: 'FREQ=MONTHLY;BYDAY=1FR' }));

  assert.ok(event, 'the event parses');
  assert.equal(event.recurrence, 'FREQ=MONTHLY;BYDAY=1FR', 'canonical field kept');
  assert.equal(event.recurrenceRule, 'FREQ=MONTHLY;BYDAY=1FR', 'and mirrored to the series stamp');
  assert.equal(SharedCore.isRecurringSeriesEvent(event), true, 'so the pipeline treats it as a series');
});

test('builder recurrence: the alias spellings all land on the series stamp', () => {
  for (const key of ['rrule', 'recurrenceRule', 'recurrence']) {
    const event = parseQuery(buildQuery({ [key]: 'FREQ=WEEKLY;BYDAY=FR' }));
    assert.equal(
      SharedCore.isRecurringSeriesEvent(event),
      true,
      `${key} must reach the series stamp`
    );
  }
});

// The load-bearing exception. `recurrence` is bidirectional: it is the
// canonical notes/ICS key, so the SERIES rule leaks off the source
// occurrence's notes onto a single-occurrence override during the calendar
// merge. Stamping that as a series would withhold the one write the scraper
// IS allowed to make into an existing series.
test('builder recurrence: an occurrence override is never promoted to a series', () => {
  const event = parseQuery(buildQuery({
    recurrence: 'FREQ=MONTHLY;BYDAY=1FR',
    overrideUid: 'cubscout-20260730T183109Z@chunky.dad',
    overrideRecurrenceId: '20260905'
  }));

  assert.ok(event, 'the event parses');
  assert.equal(event.recurrenceRule, undefined, 'the leaked series rule is not stamped');
  assert.equal(SharedCore.isRecurringSeriesEvent(event), false, 'so the override stays writable');
  assert.equal(event.overrideUid, 'cubscout-20260730T183109Z@chunky.dad', 'and keeps its identity');
});

test('builder recurrence: a one-off link stays a one-off', () => {
  const event = parseQuery(buildQuery());

  assert.equal(event.recurrenceRule, undefined);
  assert.equal(SharedCore.isRecurringSeriesEvent(event), false);
});

test('builder recurrence: a blank recurrence param is not a series', () => {
  const event = parseQuery(buildQuery({ recurrence: '   ' }));

  assert.equal(event.recurrenceRule, undefined, 'whitespace is not a rule');
  assert.equal(SharedCore.isRecurringSeriesEvent(event), false);
});

// ---------------------------------------------------------------------------
// Override identity is all-or-nothing (pre-existing contract, pinned here
// because these tests are the first coverage this parser has had).
// ---------------------------------------------------------------------------

test('override identity: half an identity is rejected outright', () => {
  assert.throws(
    () => parseQuery(buildQuery({ overrideUid: 'cubscout@chunky.dad' })),
    /override identity requires both/i
  );
  assert.throws(
    () => parseQuery(buildQuery({ overrideRecurrenceId: '20260905' })),
    /override identity requires both/i
  );
});

test('builder payload: the event carries the timezone the link supplied', () => {
  const event = parseQuery(buildQuery());
  assert.equal(event.timezone, 'America/Los_Angeles', 'the EVENT zone, not the device zone');
});

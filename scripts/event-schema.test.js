const test = require('node:test');
const assert = require('node:assert/strict');

const { EventSchema } = require('./event-schema');

// ---------------------------------------------------------------------------
// formatEventNotes → parseNotesIntoFields round-trip
// ---------------------------------------------------------------------------

test('notes round-trip: colons, backslashes, and newlines in values survive exactly', () => {
  const event = {
    title: 'FURBALL', // excluded from notes; keys below are canonical notes keys
    description: 'Doors: 9pm sharp\nDress code \\ leather welcome',
    bar: 'The Eagle: Backroom',
    shortName: 'FUR\\BALL: DALLAS',
    cover: '$10'
  };

  const notes = EventSchema.formatEventNotes(event);
  const parsed = EventSchema.parseNotesIntoFields(notes);

  assert.equal(parsed.description, 'Doors: 9pm sharp\nDress code \\ leather welcome');
  assert.equal(parsed.bar, 'The Eagle: Backroom');
  assert.equal(parsed.shortName, 'FUR\\BALL: DALLAS');
  assert.equal(parsed.cover, '$10');
  assert.equal(parsed.title, undefined, 'excluded fields never enter the notes');
});

test('notes round-trip: pinSource/addressSource persist while underscore _geocode* fields are excluded', () => {
  const event = {
    bar: 'The Eagle',
    address: '554 W 28th St, New York, NY 10001',
    pinSource: 'geocoded-exact',
    addressSource: 'page',
    // Underscore-prefixed geocode verdict fields must never enter the notes.
    _geocodeGrade: 'exact',
    _geocodeCrossCheck: 'pass',
    _geocodeSource: 'nominatim'
  };

  const notes = EventSchema.formatEventNotes(event);
  const parsed = EventSchema.parseNotesIntoFields(notes);

  assert.equal(parsed.pinSource, 'geocoded-exact', 'pinSource round-trips through notes');
  assert.equal(parsed.addressSource, 'page', 'addressSource round-trips through notes');
  assert.ok(!/_geocode/.test(notes), 'underscore geocode fields are excluded from notes');
  assert.equal(parsed._geocodeGrade, undefined);
  assert.equal(parsed._geocodeCrossCheck, undefined);
});

test('notes round-trip: URL-like values keep their unescaped colons', () => {
  const event = {
    ticketUrl: 'https://tickets.example/e/furball?time=21:00',
    website: 'https://x.example/party'
  };
  const notes = EventSchema.formatEventNotes(event);
  assert.match(notes, /ticketUrl: https:\/\/tickets\.example\/e\/furball\?time=21:00/,
    'URL fields are written verbatim, not colon-escaped');

  const parsed = EventSchema.parseNotesIntoFields(notes);
  assert.equal(parsed.ticketUrl, 'https://tickets.example/e/furball?time=21:00');
  assert.equal(parsed.website, 'https://x.example/party');
});

test('parseNotesIntoFields: a value line that looks like "key: value" stays part of the value', () => {
  // The multi-line description contains an escaped "Doors\: 9pm" line; it must not
  // be promoted to its own field.
  const event = { description: 'Big party\nDoors: 9pm\nCover: cheap' };
  const notes = EventSchema.formatEventNotes(event);
  const parsed = EventSchema.parseNotesIntoFields(notes);
  assert.deepEqual(parsed, { description: 'Big party\nDoors: 9pm\nCover: cheap' });
});

test('parseNotesIntoFields canonicalizes aliased keys (notes context maps location → bar)', () => {
  const parsed = EventSchema.parseNotesIntoFields([
    'venue: The Eagle',
    'location: STATION 4',
    'tickets: https://t.example/x'
  ].join('\n'));
  assert.equal(parsed.bar, 'STATION 4', 'both venue and location canonicalize to bar; last one wins');
  assert.equal(parsed.ticketUrl, 'https://t.example/x');
});

test('parseNotesIntoFields tolerates empty and non-string input', () => {
  assert.deepEqual(EventSchema.parseNotesIntoFields(''), {});
  assert.deepEqual(EventSchema.parseNotesIntoFields(null), {});
  assert.deepEqual(EventSchema.parseNotesIntoFields(undefined), {});
  assert.deepEqual(EventSchema.parseNotesIntoFields(42), {});
});

// ---------------------------------------------------------------------------
// canonicalizeEventKey
// ---------------------------------------------------------------------------

test('canonicalizeEventKey normalizes casing, spaces, dashes, and underscores', () => {
  assert.equal(EventSchema.canonicalizeEventKey('Start Date'), 'startDate');
  assert.equal(EventSchema.canonicalizeEventKey('start_date'), 'startDate');
  assert.equal(EventSchema.canonicalizeEventKey('START-DATE'), 'startDate');
  assert.equal(EventSchema.canonicalizeEventKey('Short Name'), 'shortName');
});

test('canonicalizeEventKey resolves aliases to canonical fields', () => {
  assert.equal(EventSchema.canonicalizeEventKey('venue'), 'bar');
  assert.equal(EventSchema.canonicalizeEventKey('name'), 'title');
  assert.equal(EventSchema.canonicalizeEventKey('summary'), 'title');
  assert.equal(EventSchema.canonicalizeEventKey('url'), 'website');
  assert.equal(EventSchema.canonicalizeEventKey('link'), 'website');
  assert.equal(EventSchema.canonicalizeEventKey('tickets'), 'ticketUrl');
  assert.equal(EventSchema.canonicalizeEventKey('insta'), 'instagram');
  assert.equal(EventSchema.canonicalizeEventKey('rrule'), 'recurrence');
  assert.equal(EventSchema.canonicalizeEventKey('id'), 'identifier');
  assert.equal(EventSchema.canonicalizeEventKey('duration'), 'durationMinutes');
});

test('canonicalizeEventKey maps location → bar only in the notes context', () => {
  assert.equal(EventSchema.canonicalizeEventKey('location'), 'location');
  assert.equal(EventSchema.canonicalizeEventKey('location', { context: 'notes' }), 'bar');
  // Other keys are unaffected by the notes context
  assert.equal(EventSchema.canonicalizeEventKey('venue', { context: 'notes' }), 'bar');
});

test('canonicalizeEventKey passes unknown and falsy keys through unchanged', () => {
  assert.equal(EventSchema.canonicalizeEventKey('someCustomField'), 'someCustomField');
  assert.equal(EventSchema.canonicalizeEventKey(''), '');
  assert.equal(EventSchema.canonicalizeEventKey(null), null);
  assert.equal(EventSchema.canonicalizeEventKey(undefined), undefined);
  assert.equal(EventSchema.canonicalizeEventKey(0), 0);
});

// ---------------------------------------------------------------------------
// findUnescaped / unescapeText
// ---------------------------------------------------------------------------

test('findUnescaped finds the first unescaped delimiter and skips escaped ones', () => {
  assert.equal(EventSchema.findUnescaped('bar: The Eagle', ':'), 3);
  // 'a\:b:c' — the first colon is escaped, the second is not
  assert.equal(EventSchema.findUnescaped('a\\:b:c', ':'), 4);
  // 'a\\:b' — double backslash escapes itself, so the colon IS unescaped
  assert.equal(EventSchema.findUnescaped('a\\\\:b', ':'), 3);
  // 'a\\\:b' — three backslashes: pair + escape, so the colon is escaped
  assert.equal(EventSchema.findUnescaped('a\\\\\\:b', ':'), -1);
});

test('findUnescaped honors startIndex and missing-delimiter cases', () => {
  assert.equal(EventSchema.findUnescaped('a:b:c', ':', 2), 3);
  assert.equal(EventSchema.findUnescaped('no delimiter here', ':'), -1);
  assert.equal(EventSchema.findUnescaped('', ':'), -1);
  assert.equal(EventSchema.findUnescaped(null, ':'), -1);
  assert.equal(EventSchema.findUnescaped('abc', ''), -1);
});

test('unescapeText reverses escapeText', () => {
  assert.equal(EventSchema.unescapeText('Doors\\: 9pm'), 'Doors: 9pm');
  assert.equal(EventSchema.unescapeText('back\\\\slash'), 'back\\slash');
  assert.equal(EventSchema.unescapeText('plain text'), 'plain text');
  assert.equal(EventSchema.unescapeText(123), 123, 'non-strings pass through');

  const original = 'a:b\\c: d';
  assert.equal(EventSchema.unescapeText(EventSchema.escapeText(original)), original);
});

// ---------------------------------------------------------------------------
// isValidMetadataKey
// ---------------------------------------------------------------------------

test('isValidMetadataKey accepts letter-led alphanumeric keys (spaces allowed inside)', () => {
  assert.equal(EventSchema.isValidMetadataKey('bar'), true);
  assert.equal(EventSchema.isValidMetadataKey('ticketUrl'), true);
  assert.equal(EventSchema.isValidMetadataKey('short name'), true);
  assert.equal(EventSchema.isValidMetadataKey('a1'), true);
  assert.equal(EventSchema.isValidMetadataKey('  bar  '), true, 'surrounding whitespace is trimmed');
});

test('isValidMetadataKey rejects garbage', () => {
  assert.equal(EventSchema.isValidMetadataKey(''), false);
  assert.equal(EventSchema.isValidMetadataKey(null), false);
  assert.equal(EventSchema.isValidMetadataKey(undefined), false);
  assert.equal(EventSchema.isValidMetadataKey(42), false);
  assert.equal(EventSchema.isValidMetadataKey('a'), false, 'too short');
  assert.equal(EventSchema.isValidMetadataKey('9lives'), false, 'must start with a letter');
  assert.equal(EventSchema.isValidMetadataKey('has-dash'), false);
  assert.equal(EventSchema.isValidMetadataKey('under_score'), false);
  assert.equal(EventSchema.isValidMetadataKey('https://x.example'), false);
  assert.equal(EventSchema.isValidMetadataKey('x'.repeat(31)), false, 'max 30 chars');
  assert.equal(EventSchema.isValidMetadataKey('x'.repeat(30)), true);
});

// ---------------------------------------------------------------------------
// DEFAULT_NOTES_EXCLUDED_FIELDS
// ---------------------------------------------------------------------------

test('formatEventNotes omits default-excluded fields, underscore fields, and empty values', () => {
  const event = {
    title: 'FURBALL',
    startDate: new Date('2026-07-05T22:00:00.000Z'),
    endDate: new Date('2026-07-06T02:00:00.000Z'),
    city: 'dallas',
    source: 'ai-web',
    url: 'https://x.example',
    notes: 'pre-existing notes',
    matchKey: 'furball|2026-07-05',
    _parserConfig: { name: 'secret' },
    emptyField: '',
    nullField: null,
    bar: 'STATION 4'
  };
  const notes = EventSchema.formatEventNotes(event);
  assert.equal(notes, 'bar: STATION 4', 'only the non-excluded, non-empty field remains');
});

test('DEFAULT_NOTES_EXCLUDED_FIELDS covers the calendar-native and internal fields', () => {
  const excluded = EventSchema.DEFAULT_NOTES_EXCLUDED_FIELDS;
  ['title', 'startDate', 'endDate', 'location', 'notes', 'url', 'city', 'source',
    'coordinates', 'lat', 'lng', 'matchKey', 'recurrence'].forEach(field => {
    assert.equal(excluded.has(field), true, `${field} should be excluded from notes`);
  });
  ['bar', 'address', 'shortName', 'ticketUrl', 'timezone', 'cover'].forEach(field => {
    assert.equal(excluded.has(field), false, `${field} should be allowed in notes`);
  });
});

test('formatEventNotes honors a custom excludeFields set', () => {
  const event = { bar: 'STATION 4', cover: '$10' };
  const notes = EventSchema.formatEventNotes(event, { excludeFields: new Set(['cover']) });
  assert.equal(notes, 'bar: STATION 4');
});

// ---------------------------------------------------------------------------
// Recurring-event ICS export (buildRecurringEventIcs)
// ---------------------------------------------------------------------------

function buildRecurringFixtureEvent(overrides = {}) {
  return {
    title: 'FUZZY',
    startDate: new Date('2026-08-08T02:00:00.000Z'), // Fri 2026-08-07 21:00 America/Chicago (CDT)
    endDate: new Date('2026-08-08T07:00:00.000Z'),   // Sat 2026-08-08 02:00 America/Chicago
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR',
    bar: 'Dallas Eagle',
    cover: '$10',
    website: 'https://example.com/fuzzy',
    location: '32.7767,-96.797',
    city: 'dallas',
    ...overrides
  };
}

const RECURRING_ICS_NOW = new Date('2026-05-03T20:35:32.000Z');

test('buildRecurringEventIcs: RRULE line, UID shape, and TZID-correct DTSTART/DTEND', () => {
  const ics = EventSchema.buildRecurringEventIcs(buildRecurringFixtureEvent(), {
    timezone: 'America/Chicago',
    now: RECURRING_ICS_NOW
  });
  const unfolded = ics.replace(/\r\n[ \t]/g, '');
  assert.ok(unfolded.includes('BEGIN:VCALENDAR'), 'VCALENDAR wrapper present');
  assert.ok(unfolded.includes('BEGIN:VEVENT'), 'VEVENT present');
  assert.ok(unfolded.includes('RRULE:FREQ=WEEKLY;BYDAY=FR'), 'RRULE emitted verbatim');
  // UID matches the event-builder style: <slug>-<utcstamp>@chunky.dad
  assert.ok(unfolded.includes('UID:fuzzy-20260503T203532Z@chunky.dad'), `UID shape (got: ${unfolded.match(/UID:[^\r\n]*/)})`);
  assert.match(unfolded, /UID:[a-z0-9-]+-\d{8}T\d{6}Z@chunky\.dad/);
  // TZID correctness: 02:00Z / 07:00Z on Aug 8 are 21:00 / 02:00 wall-clock in Chicago (CDT, UTC-5)
  assert.ok(unfolded.includes('DTSTART;TZID=America/Chicago:20260807T210000'), 'DTSTART local wall-clock with TZID');
  assert.ok(unfolded.includes('DTEND;TZID=America/Chicago:20260808T020000'), 'DTEND local wall-clock with TZID');
  assert.ok(unfolded.includes('SUMMARY:FUZZY'));
  assert.ok(unfolded.includes('LOCATION:32.7767\\,-96.797'), 'LOCATION comma is ICS-escaped');
});

test('buildRecurringEventIcs: DESCRIPTION carries standard notes plus the recurrence detection line', () => {
  const ics = EventSchema.buildRecurringEventIcs(buildRecurringFixtureEvent(), {
    timezone: 'America/Chicago',
    now: RECURRING_ICS_NOW
  });
  const unfolded = ics.replace(/\r\n[ \t]/g, '');
  const descriptionMatch = unfolded.match(/DESCRIPTION:([^\r\n]*)/);
  assert.ok(descriptionMatch, 'DESCRIPTION present');
  const description = descriptionMatch[1];
  // Standard notes lines (EventSchema.formatEventNotes) survive, newline-escaped
  assert.ok(description.includes('bar: Dallas Eagle'), 'standard notes present');
  assert.ok(description.includes('cover: $10'));
  assert.ok(description.includes('website: https://example.com/fuzzy'));
  // The detection channel: an explicit canonical recurrence line (the default
  // notes-exclusion list applies to scraper calendar writes, not this ICS)
  assert.ok(description.includes('recurrence: FREQ=WEEKLY\\;BYDAY=FR'), 'recurrence line present (ICS-escaped)');
  // recurrenceRule itself never leaks as a raw notes key
  assert.ok(!description.includes('recurrenceRule:'), 'no duplicate raw recurrenceRule key');
});

test('buildRecurringEventIcs: ICS escaping and 75-octet folding', () => {
  const event = buildRecurringFixtureEvent({
    title: 'FUZZY; the big, hairy\nparty',
    description: 'A very long description that keeps going and going to force RFC 5545 line folding, with commas, semicolons; and more text well past seventy-five octets total.'
  });
  const ics = EventSchema.buildRecurringEventIcs(event, { timezone: 'America/Chicago', now: RECURRING_ICS_NOW });
  const lines = ics.split('\r\n');
  for (const line of lines) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line exceeds 75 octets: ${line}`);
  }
  assert.ok(lines.some(line => line.startsWith(' ')), 'long content folded onto continuation lines');
  const unfolded = ics.replace(/\r\n[ \t]/g, '');
  assert.ok(unfolded.includes('SUMMARY:FUZZY\\; the big\\, hairy\\nparty'), 'SUMMARY escaped');
});

test('buildRecurringEventIcs: UTC fallback when no timezone is resolvable', () => {
  const ics = EventSchema.buildRecurringEventIcs(buildRecurringFixtureEvent(), { now: RECURRING_ICS_NOW });
  const unfolded = ics.replace(/\r\n[ \t]/g, '');
  assert.ok(unfolded.includes('DTSTART:20260808T020000Z'), 'DTSTART falls back to UTC-Z');
  assert.ok(!unfolded.includes('TZID='), 'no TZID without a timezone');
});

test('round-trip: js/calendar-core.js parseICalData parses the generated ICS and reports recurrence', () => {
  const noop = () => {};
  globalThis.logger = {
    componentInit: noop, componentLoad: noop, componentError: noop,
    apiCall: noop, debug: noop, info: noop, warn: noop, time: noop, timeEnd: noop
  };
  const CalendarCore = require('../js/calendar-core.js');
  const ics = EventSchema.buildRecurringEventIcs(buildRecurringFixtureEvent(), {
    timezone: 'America/Chicago',
    now: RECURRING_ICS_NOW
  });
  const core = new CalendarCore();
  const events = core.parseICalData(ics);
  assert.equal(events.length, 1, 'one VEVENT parsed');
  const parsed = events[0];
  assert.equal(parsed.name, 'FUZZY');
  assert.equal(parsed.recurring, true, 'parser reports the event as recurring');
  assert.equal(parsed.recurrence, 'FREQ=WEEKLY;BYDAY=FR', 'RRULE round-trips verbatim');
  assert.equal(parsed.eventType, 'weekly');
  assert.equal(parsed.uid, 'fuzzy-20260503T203532Z@chunky.dad');
  assert.equal(parsed.startTimezone, 'America/Chicago', 'TZID round-trips');
  assert.equal(parsed.bar, 'Dallas Eagle', 'DESCRIPTION notes fields round-trip');
});

// ---------------------------------------------------------------------------
// computeNextRruleOccurrence — deterministic next-occurrence date math for
// dateless recurring events (practical subset; unsupported forms → null)
// ---------------------------------------------------------------------------

test('computeNextRruleOccurrence: weekly, monthly-ordinal, and daily forms from an injected now', () => {
  const f = EventSchema.computeNextRruleOccurrence;
  const wedJul22 = new Date(2026, 6, 22, 15, 30, 0); // Wed 2026-07-22, local

  // weekly, single BYDAY: nearest Friday
  assert.equal(f('FREQ=WEEKLY;BYDAY=FR', wedJul22), '2026-07-24');
  // today counts as an occurrence
  assert.equal(f('FREQ=WEEKLY;BYDAY=WE', wedJul22), '2026-07-22');
  // weekly, multiple BYDAY: nearest of the set (Fri Jul 24 beats Tue Jul 28)
  assert.equal(f('FREQ=WEEKLY;BYDAY=TU,FR', wedJul22), '2026-07-24');
  // monthly ordinal: July's 1st Friday (Jul 3) is past → Aug 7
  assert.equal(f('FREQ=MONTHLY;BYDAY=1FR', wedJul22), '2026-08-07');
  // monthly ordinal still ahead in the current month
  assert.equal(f('FREQ=MONTHLY;BYDAY=2FR', new Date(2026, 6, 1)), '2026-07-10');
  // last-weekday form (-1)
  assert.equal(f('FREQ=MONTHLY;BYDAY=-1FR', wedJul22), '2026-07-31');
  // daily: today
  assert.equal(f('FREQ=DAILY', wedJul22), '2026-07-22');
  // an RRULE: prefix is tolerated (normalizeRruleValue strips it upstream)
  assert.equal(f('RRULE:FREQ=WEEKLY;BYDAY=FR', wedJul22), '2026-07-24');
});

test('computeNextRruleOccurrence: unsupported forms return null (event stays discarded)', () => {
  const f = EventSchema.computeNextRruleOccurrence;
  const now = new Date(2026, 6, 22);
  assert.equal(f('FREQ=WEEKLY', now), null, 'weekly without BYDAY has no anchor');
  assert.equal(f('FREQ=MONTHLY;BYDAY=FR', now), null, 'monthly needs an ordinal BYDAY');
  assert.equal(f('FREQ=MONTHLY;BYDAY=1FR,3FR', now), null, 'multiple monthly ordinals are out of subset');
  assert.equal(f('FREQ=WEEKLY;INTERVAL=2;BYDAY=FR', now), null, 'INTERVAL>1 has no DTSTART to phase it');
  assert.equal(f('FREQ=YEARLY', now), null, 'unknown FREQ');
  assert.equal(f('1ST FRIDAY OF THE MONTH', now), null, 'prose is not an RRULE');
  assert.equal(f('', now), null);
  assert.equal(f('FREQ=WEEKLY;BYDAY=FR', new Date('nonsense')), null, 'invalid fromDate');
  assert.equal(f('FREQ=WEEKLY;BYDAY=XX', now), null, 'unknown weekday code');
  assert.equal(f('FREQ=DAILY;BYDAY=FR', now), null, 'filtered daily rules are out of subset');
});

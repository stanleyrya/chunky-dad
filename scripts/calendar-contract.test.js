// ============================================================================
// CALENDAR-AS-DATABASE CONTRACT TESTS
// ============================================================================
// The calendar IS the database: events are persisted as calendar entries whose
// `location` field is ALWAYS a coordinate pair and whose `notes` field is a
// key/value codec (event-schema.js) that must round-trip losslessly. These
// property-style checks pin those invariants over a table of representative
// events, including the nasty real cases from production runs (emoji titles,
// addresses with commas, coordinates with leading whitespace).
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');

const { SharedCore } = require('./shared-core');
const { EventSchema } = require('./event-schema');

const CITIES = {
  nola: { calendar: 'chunky-dad-nola', timezone: 'America/Chicago', patterns: ['new orleans', 'nola'] },
  sf: { calendar: 'chunky-dad-sf', timezone: 'America/Los_Angeles', patterns: ['san francisco', 'sf'] },
  portland: { calendar: 'chunky-dad-portland', timezone: 'America/Los_Angeles', patterns: ['portland', 'pdx'] }
};

function createCore() {
  return new SharedCore(CITIES, { eventSchema: EventSchema });
}

const epoch = (value) => (value instanceof Date ? value : new Date(value)).getTime();

// Representative events, straight from production pain: emoji titles, address
// text where coordinates belong, coordinates with leading whitespace.
const PORTLAND_COORDS = '45.52, -122.65';
const PORTLAND_COORDS_LEADING_SPACE = ' 45.52, -122.65';
const NOLA_COORDS = '29.9611, -90.0645';

function buildScrapedEvent(overrides = {}) {
  return {
    title: 'New Orleans⚜️',
    description: 'FIXTURE PRESENTS',
    startDate: new Date('2026-09-05T02:00:00.000Z'),
    endDate: new Date('2026-09-05T07:00:00.000Z'),
    bar: 'Oak Barrel Saloon',
    address: '800 Bourbon St, New Orleans, LA, 70116',
    city: 'nola',
    timezone: 'America/Chicago',
    location: NOLA_COORDS,
    source: 'ai-web',
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Invariant 1: location is ALWAYS coordinates. Whenever either merge input
// carries a coordinate location, the merged output's location must satisfy
// isCoordinatePair — address text or an empty scrape must never displace it.
// ---------------------------------------------------------------------------

test('contract: mergeParsedEvents never lets text or empty values displace coordinate locations', async () => {
  const core = createCore();

  const table = [
    {
      name: 'existing coordinates vs incoming address text',
      existing: buildScrapedEvent({ location: NOLA_COORDS }),
      incoming: buildScrapedEvent({ location: '800 Bourbon St, New Orleans, LA, 70116', source: 'bearracuda' })
    },
    {
      name: 'existing address text vs incoming coordinates',
      existing: buildScrapedEvent({ location: '800 Bourbon St, New Orleans, LA, 70116' }),
      incoming: buildScrapedEvent({ location: NOLA_COORDS, source: 'bearracuda' })
    },
    {
      name: 'existing coordinates vs incoming empty location',
      existing: buildScrapedEvent({ location: NOLA_COORDS }),
      incoming: buildScrapedEvent({ location: '', source: 'bearracuda' })
    },
    {
      name: 'incoming coordinates with leading whitespace vs existing empty',
      existing: buildScrapedEvent({ location: undefined }),
      incoming: buildScrapedEvent({ title: 'SF⛓️ FLSM', location: PORTLAND_COORDS_LEADING_SPACE, source: 'bearracuda' })
    },
    {
      name: 'both sides coordinates',
      existing: buildScrapedEvent({ location: NOLA_COORDS }),
      incoming: buildScrapedEvent({ location: PORTLAND_COORDS, source: 'bearracuda' })
    }
  ];

  for (const { name, existing, incoming } of table) {
    // No httpAdapter → AI arbitration disabled → deterministic paths only
    const merged = await core.mergeParsedEvents(existing, incoming, {});
    assert.ok(
      core.isCoordinatePair(merged.location),
      `${name}: merged location must be a coordinate pair, got "${merged.location}"`
    );
    assert.ok(
      !/bourbon/i.test(String(merged.location)),
      `${name}: address text must never become the location`
    );
  }
});

test('contract: createFinalEventObject keeps location as coordinates against the calendar', async () => {
  const core = createCore();

  const calendarWithCoords = {
    title: 'New Orleans⚜️',
    startDate: new Date('2026-09-05T02:00:00.000Z'),
    endDate: new Date('2026-09-05T07:00:00.000Z'),
    location: PORTLAND_COORDS_LEADING_SPACE, // legacy record saved with a leading space
    notes: 'bar: Oak Barrel Saloon\naddress: 800 Bourbon St, New Orleans, LA, 70116'
  };

  const table = [
    {
      // Both sides are coordinates and the address did not change → the stored
      // pin (possibly human-corrected) is KEPT; the divergent fresh geocode is
      // flagged in the logs instead of silently applied.
      name: 'calendar pin kept over scraped coordinates when the address is unchanged',
      existing: calendarWithCoords,
      scraped: buildScrapedEvent({ location: NOLA_COORDS }),
      expected: PORTLAND_COORDS_LEADING_SPACE
    },
    {
      name: 'scraped address text must NOT wipe calendar coordinates',
      existing: calendarWithCoords,
      scraped: buildScrapedEvent({ location: '800 Bourbon St, New Orleans, LA, 70116' }),
      expected: PORTLAND_COORDS_LEADING_SPACE
    },
    {
      name: 'empty scrape must NOT wipe calendar coordinates',
      existing: calendarWithCoords,
      scraped: buildScrapedEvent({ location: '' }),
      expected: PORTLAND_COORDS_LEADING_SPACE
    },
    {
      name: 'scraped coordinates fill a calendar event without any',
      existing: { ...calendarWithCoords, location: '' },
      scraped: buildScrapedEvent({ location: NOLA_COORDS }),
      expected: NOLA_COORDS
    }
  ];

  for (const { name, existing, scraped, expected } of table) {
    const finalEvent = await core.createFinalEventObject(existing, scraped, {});
    assert.equal(finalEvent.location, expected, name);
    assert.ok(
      core.isCoordinatePair(finalEvent.location),
      `${name}: final location must be a coordinate pair, got "${finalEvent.location}"`
    );
  }
});

// ---------------------------------------------------------------------------
// Invariant 2: the notes codec round-trips every standard field losslessly.
// The field set is derived from event-schema.js itself (canonical alias
// targets that are not excluded from notes), so schema additions are covered
// automatically.
// ---------------------------------------------------------------------------

function getNotesRoundTrippableFields() {
  const canonicalTargets = new Set(Object.values(EventSchema.EVENT_KEY_ALIASES));
  return [...canonicalTargets].filter(field =>
    !EventSchema.DEFAULT_NOTES_EXCLUDED_FIELDS.has(field) &&
    EventSchema.canonicalizeEventKey(field, { context: 'notes' }) === field
  );
}

test('contract: formatEventNotes → parseNotesIntoFields round-trips every standard field', () => {
  const fields = getNotesRoundTrippableFields();
  assert.ok(fields.includes('bar') && fields.includes('address') && fields.includes('ticketUrl'),
    'sanity: the canonical field set must include the core metadata fields');

  // Every standard field gets a value with a colon — the classic breaker.
  const event = {};
  for (const field of fields) {
    event[field] = `${field} value: with colon`;
  }
  // Overlay the nasty real-world values on the usual suspects.
  Object.assign(event, {
    description: 'Doors: 9 PM\nAfterparty: TBD\nDress code — harness: encouraged',
    bar: 'STATION 4: THE BASEMENT',
    address: '3911 Cedar Springs Rd, Dallas, TX 75219',
    shortName: 'SF⛓️ FLSM',
    ticketUrl: 'https://events.ticketleap.example/tickets/furball?date=2026-09-04&aff=ig',
    website: 'https://fixturepromoter.example/events/new-orleans',
    gmaps: 'https://www.google.com/maps/search/?api=1&query=29.9611%2C-90.0645',
    timezone: 'America/Chicago',
    startTime: '21:00',
    endTime: '02:00'
  });

  const notes = EventSchema.formatEventNotes(event);
  const parsed = EventSchema.parseNotesIntoFields(notes);

  for (const field of fields) {
    assert.equal(parsed[field], event[field], `field "${field}" must round-trip losslessly`);
  }
});

test('contract: multi-line values never swallow the fields that follow them', () => {
  const event = {
    description: 'Line one\nhttps://sneaky.example/not-a-key\nLine three: still description',
    bar: 'Oak Barrel Saloon',
    ticketUrl: 'https://tickets.example/e/fixture-new-orleans/tickets'
  };
  const parsed = EventSchema.parseNotesIntoFields(EventSchema.formatEventNotes(event));
  assert.equal(parsed.description, event.description);
  assert.equal(parsed.bar, event.bar);
  assert.equal(parsed.ticketUrl, event.ticketUrl);
});

// ---------------------------------------------------------------------------
// Invariant 3: event keys are non-empty, stable, and safe for the notes codec.
// ---------------------------------------------------------------------------

test('contract: createEventKey is non-empty, stable, and never breaks the notes format', () => {
  const core = createCore();

  const table = [
    buildScrapedEvent(),
    buildScrapedEvent({ title: 'New Orleans⚜️', bar: '' }),
    buildScrapedEvent({ title: 'SF⛓️ FLSM', bar: 'SF Eagle', city: 'sf' }),
    buildScrapedEvent({ title: 'Portland PRIDE FRIDAY | Late Night', bar: 'Nova PDX', city: 'portland' }),
    buildScrapedEvent({ title: 'BEAR NIGHT: THE RETURN!', bar: 'STATION 4: THE BASEMENT' }),
    buildScrapedEvent({ title: '  padded  title  ', bar: ' padded bar ' }),
    // Custom key template, as configured by real parsers
    buildScrapedEvent({ _parserConfig: { keyTemplate: 'fixture-${date}-${city}' } })
  ];

  for (const event of table) {
    const key = core.createEventKey(event);
    assert.equal(typeof key, 'string');
    assert.ok(key.trim().length > 0, `key must be non-empty for "${event.title}"`);
    assert.ok(!key.includes('\n') && !key.includes('\r'),
      `key must not contain newlines (would corrupt notes): "${key}"`);

    // Stability: identical input yields the identical key.
    const clone = JSON.parse(JSON.stringify({ ...event, startDate: event.startDate.toISOString(), endDate: event.endDate.toISOString() }));
    clone.startDate = new Date(clone.startDate);
    clone.endDate = new Date(clone.endDate);
    assert.equal(core.createEventKey(clone), key, `key must be stable for "${event.title}"`);

    // Notes-codec safety: the key survives a notes round-trip verbatim and
    // does not swallow the field written after it.
    const notes = EventSchema.formatEventNotes({ key, shortName: 'AFTER-KEY' });
    const parsed = EventSchema.parseNotesIntoFields(notes);
    assert.equal(parsed.key, key, `key must round-trip through notes: "${key}"`);
    assert.equal(parsed.shortName, 'AFTER-KEY');
  }
});

// ---------------------------------------------------------------------------
// Invariant 4: a merged event never ends before it starts.
// ---------------------------------------------------------------------------

test('contract: merged events never end before they start', async () => {
  const core = createCore();

  const positive = buildScrapedEvent();
  const degenerate = buildScrapedEvent({
    // endDate collapsed onto startDate — the classic evidence-dropped-end artifact
    endDate: new Date('2026-09-05T02:00:00.000Z'),
    source: 'bearracuda'
  });
  const inverted = buildScrapedEvent({
    // endDate before startDate — worst-case upstream data
    endDate: new Date('2026-09-04T23:00:00.000Z'),
    source: 'bearracuda'
  });

  const parsedPairs = [
    { name: 'degenerate incoming end', existing: positive, incoming: degenerate },
    { name: 'degenerate existing end', existing: degenerate, incoming: positive },
    { name: 'inverted incoming end', existing: positive, incoming: inverted },
    { name: 'inverted existing end', existing: inverted, incoming: positive },
    { name: 'both positive', existing: positive, incoming: buildScrapedEvent({ source: 'bearracuda' }) }
  ];
  for (const { name, existing, incoming } of parsedPairs) {
    const merged = await core.mergeParsedEvents(existing, incoming, {});
    assert.ok(merged.startDate && merged.endDate, `${name}: merged event must keep both dates`);
    assert.ok(
      epoch(merged.endDate) >= epoch(merged.startDate),
      `${name}: merged event must not end before it starts (${merged.startDate} → ${merged.endDate})`
    );
  }

  const calendarEvent = {
    title: 'New Orleans⚜️',
    startDate: new Date('2026-09-05T02:00:00.000Z'),
    endDate: new Date('2026-09-05T07:00:00.000Z'),
    location: NOLA_COORDS,
    notes: 'bar: Oak Barrel Saloon'
  };
  const finalPairs = [
    { name: 'degenerate scrape vs positive calendar', scraped: degenerate },
    { name: 'inverted scrape vs positive calendar', scraped: inverted },
    { name: 'positive scrape vs positive calendar', scraped: positive }
  ];
  for (const { name, scraped } of finalPairs) {
    const finalEvent = await core.createFinalEventObject(calendarEvent, scraped, {});
    assert.ok(
      epoch(finalEvent.endDate) >= epoch(finalEvent.startDate),
      `${name}: final event must not end before it starts (${finalEvent.startDate} → ${finalEvent.endDate})`
    );
  }
});

// A city's device-calendar name is the only string that has to match something
// the operator typed into Calendar.app by hand — nothing derives it, nothing
// validates it, and a mismatch fails at write time with an INFO line rather
// than an error. Run 20260802-142231 lost 9 Puerto Vallarta events to exactly
// that: `calendar: 'chunky-dad-puerto-vallerta'` against a city whose name,
// aliases and patterns all read "vallarta". Pin every calendar name to the
// city's own identity so the next typo fails here instead of in a run.
test('contract: every city calendar name is derivable from that city identity', () => {
  const cityModule = require('../js/city-config.js');
  const config = cityModule.CITY_CONFIG || cityModule.default || cityModule;

  // Calendar names that intentionally differ from every derivable form. Each
  // entry is a live calendar we have NOT verified we can safely rename, so it
  // is pinned rather than "fixed" — remove an entry once its calendar is
  // confirmed renamed on the device. (hong-kong was pinned here until the
  // device calendar was confirmed as chunky-dad-hong-kong, 2026-08-02.)
  const DELIBERATE_EXCEPTIONS = new Map([]);

  const slugify = (value) => String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  let checked = 0;
  for (const [key, city] of Object.entries(config)) {
    if (!city || typeof city !== 'object' || !city.calendar) continue;
    checked += 1;

    if (DELIBERATE_EXCEPTIONS.has(key)) {
      assert.equal(city.calendar, DELIBERATE_EXCEPTIONS.get(key),
        `${key}: pinned exception drifted — re-verify the device calendar before changing it`);
      continue;
    }

    const derivable = new Set(
      [key, slugify(city.name), ...(city.aliases || []).map(slugify)]
        .filter(Boolean)
        .map((form) => `chunky-dad-${form}`)
    );
    assert.ok(derivable.has(city.calendar),
      `${key}: calendar "${city.calendar}" matches none of its own identity forms `
      + `(${[...derivable].join(', ')}) — a typo here silently routes events to a calendar that does not exist`);
  }

  assert.ok(checked >= 40, `expected the full city table, only saw ${checked} cities with calendars`);
});

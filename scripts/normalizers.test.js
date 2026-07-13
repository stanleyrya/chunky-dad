const test = require('node:test');
const assert = require('node:assert/strict');

const { LocationNormalizer, OpenStreetMapNormalizer } = require('./normalizers');
const { SharedCore } = require('./shared-core');
const { EventSchema } = require('./event-schema');

const CITIES = {
  nyc: { timezone: 'America/New_York', patterns: ['new york', 'nyc'] }
};

function createLocationNormalizer() {
  const core = new SharedCore(CITIES, { eventSchema: EventSchema });
  return new LocationNormalizer(core);
}

test('resolveWallClockDates re-anchors flagged dates once the city timezone is known', () => {
  const normalizer = createLocationNormalizer();
  const event = {
    title: 'UNDERBEAR',
    city: 'nyc',
    // Wall-clock 10pm local stored as 10pm UTC by the parser's timezone-less fallback
    startDate: new Date('2026-07-17T22:00:00.000Z'),
    endDate: new Date('2026-07-17T22:00:00.000Z'),
    _timezoneUnresolved: true
  };

  normalizer.resolveWallClockDates(event);

  // 10pm EDT (UTC-4) is 2am UTC the next day
  assert.equal(event.startDate.toISOString(), '2026-07-18T02:00:00.000Z');
  assert.equal(event.endDate.toISOString(), '2026-07-18T02:00:00.000Z');
  assert.equal(event.timezone, 'America/New_York');
  assert.equal(event._timezoneUnresolved, undefined);
});

test('resolveWallClockDates preserves ISO string date types', () => {
  const normalizer = createLocationNormalizer();
  const event = {
    title: 'UNDERBEAR',
    city: 'nyc',
    startDate: '2026-07-17T22:00:00.000Z',
    endDate: '2026-07-17T22:00:00.000Z',
    _timezoneUnresolved: true
  };

  normalizer.resolveWallClockDates(event);

  assert.equal(event.startDate, '2026-07-18T02:00:00.000Z');
  assert.equal(typeof event.startDate, 'string');
});

test('resolveWallClockDates leaves dates untouched when the timezone stays unknown', () => {
  const normalizer = createLocationNormalizer();
  const event = {
    title: 'MYSTERY EVENT',
    city: 'unknown',
    startDate: new Date('2026-07-17T22:00:00.000Z'),
    endDate: new Date('2026-07-17T22:00:00.000Z'),
    _timezoneUnresolved: true
  };

  normalizer.resolveWallClockDates(event);

  assert.equal(event.startDate.toISOString(), '2026-07-17T22:00:00.000Z');
  assert.equal(event._timezoneUnresolved, true, 'flag should remain so the gap stays visible');
});

// ---------------------------------------------------------------------------
// OpenStreetMapNormalizer forward-geocode city validation (2026-07-12 run
// findings: flyer-OCR typo "922 E. BURNSIDE" geocoded to Burnside, Michigan
// for an event in Portland)
// ---------------------------------------------------------------------------

function createOsmNormalizer() {
  const core = new SharedCore(CITIES, { eventSchema: EventSchema });
  return new OpenStreetMapNormalizer(core);
}

// Stub httpAdapter that records the requested URLs and returns canned
// Nominatim search results.
function createStubHttpAdapter(results) {
  const requests = [];
  return {
    requests,
    fetchData: async (url) => {
      requests.push(url);
      return JSON.stringify(results);
    }
  };
}

const WRONG_CITY_RESULT = {
  lat: '43.2105820',
  lon: '-83.0771632',
  display_name: 'Burnside, Argyle Township, Sanilac County, Michigan, United States',
  address: { hamlet: 'Burnside', county: 'Sanilac County', state: 'Michigan' }
};

const PORTLAND_RESULT = {
  lat: '45.5230622',
  lon: '-122.6564816',
  display_name: '722, East Burnside Street, Portland, Multnomah County, Oregon, 97214, United States',
  address: { city: 'Portland', county: 'Multnomah County', state: 'Oregon' }
};

test('forward geocode ignores a result that resolves outside the event city', async () => {
  const normalizer = createOsmNormalizer();
  const httpAdapter = createStubHttpAdapter([WRONG_CITY_RESULT]);
  const event = { title: 'PRIDE FRIDAY', address: '922 E. BURNSIDE', city: 'portland' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.location, undefined, 'coordinates in the wrong state must not be applied');
});

test('forward geocode appends the event city to the query and accepts a matching result', async () => {
  const normalizer = createOsmNormalizer();
  const httpAdapter = createStubHttpAdapter([PORTLAND_RESULT]);
  const event = { title: 'PRIDE FRIDAY', address: '922 E. BURNSIDE', city: 'portland' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.location, '45.5230622, -122.6564816');
  assert.equal(httpAdapter.requests.length, 1);
  assert.ok(
    httpAdapter.requests[0].includes(encodeURIComponent('922 E. BURNSIDE, portland')),
    `query must carry the city for context: ${httpAdapter.requests[0]}`
  );
  assert.ok(httpAdapter.requests[0].includes('&addressdetails=1'), 'validation needs address details');
});

test('forward geocode does not append the city when the address already contains it', async () => {
  const normalizer = createOsmNormalizer();
  const httpAdapter = createStubHttpAdapter([PORTLAND_RESULT]);
  const event = { title: 'PRIDE FRIDAY', address: '722 E Burnside St, Portland, OR', city: 'portland' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.location, '45.5230622, -122.6564816');
  assert.ok(
    httpAdapter.requests[0].includes(`q=${encodeURIComponent('722 E Burnside St, Portland, OR')}&`),
    `query must stay the bare address: ${httpAdapter.requests[0]}`
  );
});

test('forward geocode without an event city keeps the legacy query and accepts the result', async () => {
  const normalizer = createOsmNormalizer();
  const httpAdapter = createStubHttpAdapter([WRONG_CITY_RESULT]);
  const event = { title: 'MYSTERY EVENT', address: '922 E. BURNSIDE' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.location, '43.2105820, -83.0771632', 'no city context means no validation (old behavior)');
  assert.equal(
    httpAdapter.requests[0],
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent('922 E. BURNSIDE')}&limit=1`,
    'the request URL must be byte-identical to the pre-validation behavior'
  );
});

// ---------------------------------------------------------------------------
// OpenStreetMapNormalizer distance-ranked geocoding: when the event city has
// known center coordinates, candidates are ranked by haversine distance to the
// center (textual matching alone false-accepts "Portland, Michigan" for a
// Portland OR event because the display name contains "portland").
// ---------------------------------------------------------------------------

const CITIES_WITH_COORDS = {
  portland: {
    timezone: 'America/Los_Angeles',
    patterns: ['portland', 'pdx'],
    coordinates: { lat: 45.5152, lng: -122.6784 }
  }
};

function createOsmNormalizerWithCoords() {
  const core = new SharedCore(CITIES_WITH_COORDS, { eventSchema: EventSchema });
  return new OpenStreetMapNormalizer(core);
}

// Textually matches "portland" but is ~2800 km from Portland, Oregon.
const PORTLAND_MICHIGAN_RESULT = {
  lat: '42.8692006',
  lon: '-84.9030517',
  display_name: 'Portland, Ionia County, Michigan, United States',
  address: { city: 'Portland', county: 'Ionia County', state: 'Michigan' }
};

test('distance ranking picks the candidate nearest the city center, not the first textual match', async () => {
  const normalizer = createOsmNormalizerWithCoords();
  // The wrong-state (but textually matching) candidate is listed FIRST
  const httpAdapter = createStubHttpAdapter([PORTLAND_MICHIGAN_RESULT, PORTLAND_RESULT]);
  const event = { title: 'PRIDE FRIDAY', address: '722 E Burnside', city: 'portland' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.location, '45.5230622, -122.6564816', 'the Oregon candidate must win by distance');
  assert.ok(
    httpAdapter.requests[0].includes('&limit=5'),
    `known city coordinates must request 5 candidates: ${httpAdapter.requests[0]}`
  );
  assert.ok(httpAdapter.requests[0].includes('&addressdetails=1'), 'address details stay requested');
});

test('distance ranking rejects every candidate beyond the 50 km radius', async () => {
  const normalizer = createOsmNormalizerWithCoords();
  const httpAdapter = createStubHttpAdapter([WRONG_CITY_RESULT, PORTLAND_MICHIGAN_RESULT]);
  const event = { title: 'PRIDE FRIDAY', address: '922 E. BURNSIDE', city: 'portland' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.location, undefined, 'candidates outside the radius must not set coordinates');
});

test('a configured city without coordinates keeps the textual validation path', async () => {
  const normalizer = createOsmNormalizer(); // CITIES: nyc has no coordinates
  const httpAdapter = createStubHttpAdapter([WRONG_CITY_RESULT]);
  const event = { title: 'BEAR NIGHT', address: '355 W 41st St', city: 'nyc' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.location, undefined, 'textual city mismatch must still reject the result');
  assert.ok(httpAdapter.requests[0].includes('&limit=1'), 'no coordinates → legacy single-result request');
});

test('haversineDistanceKm sanity: Portland→Seattle ≈ 233 km, identical points are 0', () => {
  const normalizer = createOsmNormalizerWithCoords();
  const distance = normalizer.haversineDistanceKm(45.5152, -122.6784, 47.6062, -122.3321);
  assert.ok(Math.abs(distance - 233) < 5, `expected ~233 km, got ${distance}`);
  assert.equal(normalizer.haversineDistanceKm(45.5, -122.6, 45.5, -122.6), 0);
});

test('resolveWallClockDates ignores events without the wall-clock flag', () => {
  const normalizer = createLocationNormalizer();
  const event = {
    title: 'ALREADY ANCHORED',
    city: 'nyc',
    startDate: new Date('2026-07-18T02:00:00.000Z')
  };

  normalizer.resolveWallClockDates(event);

  assert.equal(event.startDate.toISOString(), '2026-07-18T02:00:00.000Z');
  assert.equal(event.timezone, undefined);
});

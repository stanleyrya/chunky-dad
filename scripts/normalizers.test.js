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
// City-from-address guard (2026-07-13 run findings: the flyer address
// "1192 FOLSOM ST" has no city part and the fallback returned the lowercased
// street address as the "city", blocking timezone resolution and breaking
// geocoding)
// ---------------------------------------------------------------------------

test('extractCityFromAddress never returns a raw street address as a city', () => {
  const core = new SharedCore(
    {
      sf: { timezone: 'America/Los_Angeles', patterns: ['sf', 'san francisco'] },
      portland: { timezone: 'America/Los_Angeles', patterns: ['portland'] }
    },
    { eventSchema: EventSchema }
  );
  const normalizer = new LocationNormalizer(core);

  assert.equal(normalizer.extractCityFromAddress('1192 FOLSOM ST'), null, 'an address without a city part yields no city');
  assert.equal(
    normalizer.extractCityFromEvent({ title: 'CHUNK', address: '1192 FOLSOM ST' }),
    'unknown',
    'the caller falls through to unknown instead of a garbage city'
  );

  // Legitimate addresses still resolve to their mapped city.
  assert.equal(normalizer.extractCityFromAddress('722 E Burnside St, Portland, OR 97214, USA'), 'portland');
  assert.equal(normalizer.extractCityFromAddress('1192 Folsom St, San Francisco, CA'), 'sf');
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

// ---------------------------------------------------------------------------
// Forward-geocode retry ladder (2026-07-12 run findings: Nominatim returns 0
// results for "2069 CHESHIRE BRIDGE RD NE" — its free-text parser chokes on a
// trailing directional after a street type — while "2069 Cheshire Bridge Rd,
// Atlanta" and "The Heretic, Atlanta" both resolve to the right venue)
// ---------------------------------------------------------------------------

const CITIES_WITH_ATLANTA = {
  atlanta: {
    timezone: 'America/New_York',
    patterns: ['atlanta', 'atl'],
    coordinates: { lat: 33.749, lng: -84.388 }
  }
};

function createOsmNormalizerWithAtlanta() {
  const core = new SharedCore(CITIES_WITH_ATLANTA, { eventSchema: EventSchema });
  return new OpenStreetMapNormalizer(core);
}

// Stub httpAdapter that returns one canned Nominatim result set per request,
// in order (the last one repeats if more requests arrive).
function createSequencedStubAdapter(responses) {
  const requests = [];
  return {
    requests,
    fetchData: async (url) => {
      requests.push(url);
      const index = Math.min(requests.length - 1, responses.length - 1);
      return JSON.stringify(responses[index]);
    }
  };
}

function decodeQueryParam(url) {
  const match = /[?&]q=([^&]*)/.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}

// The Heretic, ~8 km from the Atlanta city center.
const HERETIC_RESULT = {
  lat: '33.8226',
  lon: '-84.3510',
  display_name: 'The Heretic, 2069, Cheshire Bridge Road Northeast, Atlanta, Fulton County, Georgia, 30324, United States',
  address: { city: 'Atlanta', county: 'Fulton County', state: 'Georgia' }
};

test('stripTrailingDirectionals strips only directionals that follow a street type', () => {
  const normalizer = createOsmNormalizerWithAtlanta();
  assert.equal(
    normalizer.stripTrailingDirectionals('2069 CHESHIRE BRIDGE RD NE'),
    '2069 CHESHIRE BRIDGE RD'
  );
  assert.equal(
    normalizer.stripTrailingDirectionals('2069 Cheshire Bridge Road Northeast, Atlanta, GA, 30324'),
    '2069 Cheshire Bridge Road, Atlanta, GA, 30324',
    'a mid-address directional before a comma must also be stripped'
  );
  // Directional PREFIXES are part of the street name and must pass through
  assert.equal(normalizer.stripTrailingDirectionals('3702 N Halsted'), '3702 N Halsted');
  assert.equal(normalizer.stripTrailingDirectionals('722 E Burnside'), '722 E Burnside');
  assert.equal(normalizer.stripTrailingDirectionals('355 W 41st St'), '355 W 41st St');
});

test('buildGeocodeQueryVariants orders, dedupes and caps the ladder', () => {
  const normalizer = createOsmNormalizerWithAtlanta();

  const full = normalizer.buildGeocodeQueryVariants('2069 CHESHIRE BRIDGE RD NE', 'atlanta', 'The Heretic');
  assert.deepEqual(full, [
    '2069 CHESHIRE BRIDGE RD NE, atlanta',
    '2069 CHESHIRE BRIDGE RD, atlanta',
    'The Heretic, atlanta'
  ]);
  assert.ok(full.length <= 3, 'hard cap: at most 3 queries per event');

  // No strippable directional and no bar → the ladder collapses to one query
  assert.deepEqual(
    normalizer.buildGeocodeQueryVariants('3702 N Halsted', 'chicago', ''),
    ['3702 N Halsted, chicago']
  );
  assert.deepEqual(
    normalizer.buildGeocodeQueryVariants('722 E Burnside', 'portland', null),
    ['722 E Burnside, portland']
  );

  // Address already containing the city is not re-anchored (today's behavior)
  assert.deepEqual(
    normalizer.buildGeocodeQueryVariants('2069 Cheshire Bridge Road Northeast, Atlanta, GA, 30324', 'atlanta', 'The Heretic'),
    [
      '2069 Cheshire Bridge Road Northeast, Atlanta, GA, 30324',
      '2069 Cheshire Bridge Road, Atlanta, GA, 30324',
      'The Heretic, atlanta'
    ]
  );
});

test('retry ladder: 0 results retries with the directional stripped, rate-limited per request', async () => {
  const normalizer = createOsmNormalizerWithAtlanta();
  let delays = 0;
  normalizer.delayForRateLimit = async () => { delays += 1; };
  const httpAdapter = createSequencedStubAdapter([[], [HERETIC_RESULT]]);
  const event = { title: 'ATL BEAR NIGHT', address: '2069 CHESHIRE BRIDGE RD NE', city: 'atlanta', bar: 'The Heretic' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.location, '33.8226, -84.3510');
  assert.equal(httpAdapter.requests.length, 2, 'exactly one retry after the empty first response');
  assert.equal(decodeQueryParam(httpAdapter.requests[0]), '2069 CHESHIRE BRIDGE RD NE, atlanta');
  assert.equal(
    decodeQueryParam(httpAdapter.requests[1]),
    '2069 CHESHIRE BRIDGE RD, atlanta',
    'the second query must have the trailing directional stripped'
  );
  assert.equal(delays, 2, 'every live request must pass through the rate limiter');
});

test('retry ladder: falls back to bar+city and stops at the hard cap of 3 requests', async () => {
  const normalizer = createOsmNormalizerWithAtlanta();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createSequencedStubAdapter([[], [], [HERETIC_RESULT]]);
  const event = { title: 'ATL BEAR NIGHT', address: '2069 CHESHIRE BRIDGE RD NE', city: 'atlanta', bar: 'The Heretic' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(httpAdapter.requests.length, 3);
  assert.equal(decodeQueryParam(httpAdapter.requests[2]), 'The Heretic, atlanta');
  assert.equal(event.location, '33.8226, -84.3510', 'the venue-name lookup must rescue the event');
});

test('retry ladder: distance validation still applies to fallback variants', async () => {
  const normalizer = createOsmNormalizerWithAtlanta();
  normalizer.delayForRateLimit = async () => {};
  // Variant 2 returns a candidate ~1000 km from Atlanta — must be rejected, ladder continues
  const httpAdapter = createSequencedStubAdapter([[], [PORTLAND_MICHIGAN_RESULT], []]);
  const event = { title: 'ATL BEAR NIGHT', address: '2069 CHESHIRE BRIDGE RD NE', city: 'atlanta', bar: 'The Heretic' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.location, undefined, 'a far-away candidate from a simplified query must not win');
  assert.equal(httpAdapter.requests.length, 3, 'rejection counts as failure and the ladder continues to the cap');
});

test('retry ladder: identical variants are deduped so no duplicate request is sent', async () => {
  const normalizer = createOsmNormalizerWithAtlanta();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createSequencedStubAdapter([[]]);
  // No strippable directional, no bar → a single query, then exhaustion
  const event = { title: 'CHI BEAR NIGHT', address: '3702 N Halsted', city: 'atlanta' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(httpAdapter.requests.length, 1, 'the stripped variant equals the original and must be skipped');
  assert.equal(event.location, undefined);
});

// ---------------------------------------------------------------------------
// Geocoder hardening (2026-07-14 run findings): the simplified-query fallback
// for "325 Franklin Ave, Brooklyn, NY 11238, USA" eventually queried
// "Brooklyn, nyc", matched the borough itself and stored its centroid (~4 km
// from the venue); and full canonical addresses ("1192 Folsom St, San
// Francisco, CA 94103, USA") return 0 results while the street+city core
// resolves fine — the postal-code/country decoration chokes Nominatim.
// ---------------------------------------------------------------------------

const CITIES_NYC_WITH_COORDS = {
  nyc: {
    timezone: 'America/New_York',
    patterns: ['new york', 'nyc', 'brooklyn'],
    coordinates: { lat: 40.7128, lng: -74.006 }
  }
};

function createOsmNormalizerWithNyc() {
  const core = new SharedCore(CITIES_NYC_WITH_COORDS, { eventSchema: EventSchema });
  return new OpenStreetMapNormalizer(core);
}

// The borough of Brooklyn itself — inside the 50 km radius, so only the
// admin-area check can reject it.
const BROOKLYN_BOROUGH_RESULT = {
  lat: '40.6526006',
  lon: '-73.9497211',
  class: 'boundary',
  type: 'administrative',
  addresstype: 'borough',
  display_name: 'Brooklyn, Kings County, City of New York, New York, United States',
  address: { borough: 'Brooklyn', city: 'City of New York', state: 'New York' }
};

// The venue as Nominatim returns it for a name lookup — an amenity, not an
// administrative area.
const CMON_EVERYBODY_RESULT = {
  lat: '40.6791213',
  lon: '-73.9556999',
  class: 'amenity',
  type: 'bar',
  addresstype: 'amenity',
  display_name: "C'mon Everybody, 325, Franklin Avenue, Brooklyn, Kings County, City of New York, New York, 11238, United States",
  address: { city: 'City of New York', county: 'Kings County', state: 'New York' }
};

test('stripPostalCodeAndCountry keeps street + city and drops postal/country decoration', () => {
  const normalizer = createOsmNormalizerWithNyc();
  assert.equal(
    normalizer.stripPostalCodeAndCountry('1192 Folsom St, San Francisco, CA 94103, USA'),
    '1192 Folsom St, San Francisco'
  );
  assert.equal(
    normalizer.stripPostalCodeAndCountry('325 Franklin Ave, Brooklyn, NY 11238, USA'),
    '325 Franklin Ave, Brooklyn'
  );
  assert.equal(
    normalizer.stripPostalCodeAndCountry('722 E Burnside St, Portland, OR 97214, United States'),
    '722 E Burnside St, Portland'
  );
  // No country decoration → not a canonical address, leave the ladder alone
  assert.equal(normalizer.stripPostalCodeAndCountry('2069 Cheshire Bridge Road Northeast, Atlanta, GA, 30324'), '');
  assert.equal(normalizer.stripPostalCodeAndCountry('1192 FOLSOM ST'), '');
  // Stripping must never leave a bare place token — that query can only match
  // an admin centroid (the "Brooklyn, nyc" poisoning)
  assert.equal(normalizer.stripPostalCodeAndCountry('Brooklyn, NY 11238, USA'), '');
});

test('buildGeocodeQueryVariants tries the postal/country-stripped core after the full address', () => {
  const normalizer = createOsmNormalizerWithNyc();
  assert.deepEqual(
    normalizer.buildGeocodeQueryVariants('325 Franklin Ave, Brooklyn, NY 11238, USA', 'nyc', "C'mon Everybody"),
    [
      '325 Franklin Ave, Brooklyn, NY 11238, USA, nyc',
      '325 Franklin Ave, Brooklyn, nyc',
      "C'mon Everybody, nyc"
    ]
  );
  // With a strippable directional too, the full 4-rung ladder fits the cap and
  // the venue-name rescue is never evicted
  const atlanta = createOsmNormalizerWithAtlanta();
  assert.deepEqual(
    atlanta.buildGeocodeQueryVariants('2069 Cheshire Bridge Rd NE, Atlanta, GA 30324, USA', 'atlanta', 'The Heretic'),
    [
      '2069 Cheshire Bridge Rd NE, Atlanta, GA 30324, USA',
      '2069 Cheshire Bridge Rd NE, Atlanta',
      '2069 Cheshire Bridge Rd, Atlanta, GA 30324, USA',
      'The Heretic, atlanta'
    ]
  );
});

test('a simplified-query admin-area match is rejected instead of poisoning coordinates', async () => {
  const normalizer = createOsmNormalizerWithNyc();
  normalizer.delayForRateLimit = async () => {};
  // Full address → 0 results; stripped variant → the borough itself; venue → 0
  const httpAdapter = createSequencedStubAdapter([[], [BROOKLYN_BOROUGH_RESULT], []]);
  const event = { title: 'BEAR NIGHT', address: '325 Franklin Ave, Brooklyn, NY 11238, USA', city: 'nyc', bar: "C'mon Everybody" };
  const warns = [];
  const realWarn = console.warn;
  console.warn = (message) => { warns.push(String(message)); };
  try {
    await normalizer.normalizeAsync(event, httpAdapter);
  } finally {
    console.warn = realWarn;
  }

  assert.equal(event.location, undefined, 'a borough centroid must never become the event location');
  assert.ok(
    warns.some(w => w.includes('Rejected admin-area result') && w.includes('type=borough')),
    `the rejection must be logged: ${warns.join(' | ')}`
  );
  assert.equal(httpAdapter.requests.length, 3, 'the ladder continues past the rejected result');
});

test('a venue-name simplified query still resolves through an amenity result', async () => {
  const normalizer = createOsmNormalizerWithNyc();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createSequencedStubAdapter([[], [], [CMON_EVERYBODY_RESULT]]);
  const event = { title: 'BEAR NIGHT', address: '325 Franklin Ave, Brooklyn, NY 11238, USA', city: 'nyc', bar: "C'mon Everybody" };
  const logs = [];
  const realLog = console.log;
  console.log = (message) => { logs.push(String(message)); };
  try {
    await normalizer.normalizeAsync(event, httpAdapter);
  } finally {
    console.log = realLog;
  }

  assert.equal(event.location, '40.6791213, -73.9556999', 'the amenity match must keep working');
  assert.ok(
    logs.some(l => l.includes('Geocoded via simplified query "C\'mon Everybody, nyc"')),
    `the simplified-query success log must be preserved: ${logs.join(' | ')}`
  );
});

const CITIES_SF_WITH_COORDS = {
  sf: {
    timezone: 'America/Los_Angeles',
    patterns: ['sf', 'san francisco'],
    coordinates: { lat: 37.7749, lng: -122.4194 }
  }
};

const FOLSOM_RESULT = {
  lat: '37.7756941',
  lon: '-122.4103049',
  display_name: '1192, Folsom Street, San Francisco, California, 94103, United States',
  address: { city: 'San Francisco', county: 'San Francisco', state: 'California' }
};

test('a canonical address that only resolves without postal/country decoration is rescued by the new variant', async () => {
  const core = new SharedCore(CITIES_SF_WITH_COORDS, { eventSchema: EventSchema });
  const normalizer = new OpenStreetMapNormalizer(core);
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createSequencedStubAdapter([[], [FOLSOM_RESULT]]);
  const event = { title: 'CHUNK', address: '1192 Folsom St, San Francisco, CA 94103, USA', city: 'sf' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.location, '37.7756941, -122.4103049');
  assert.equal(httpAdapter.requests.length, 2);
  assert.equal(
    decodeQueryParam(httpAdapter.requests[1]),
    '1192 Folsom St, San Francisco, sf',
    'the second query must be the postal/country-stripped core'
  );
});

// ---------------------------------------------------------------------------
// Geocode cache poisoning (2026-07-12 run findings: cached empty Nominatim
// bodies silently skipped venues that geocode fine live)
// ---------------------------------------------------------------------------

test('geocode requests carry a cache predicate that rejects empty/unparseable bodies', async () => {
  const normalizer = createOsmNormalizer();
  let capturedOptions = null;
  const httpAdapter = {
    fetchData: async (url, options) => {
      capturedOptions = options;
      return JSON.stringify([WRONG_CITY_RESULT]);
    }
  };
  const event = { title: 'MYSTERY EVENT', address: '922 E. BURNSIDE' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(typeof capturedOptions.isCacheableResponse, 'function', 'the adapters gate disk-cache writes on this hook');
  assert.equal(capturedOptions.isCacheableResponse({ html: '[]' }), false, 'an empty result set must never reach the disk cache');
  assert.equal(capturedOptions.isCacheableResponse({ html: 'not json at all' }), false, 'an unparseable body must never reach the disk cache');
  assert.equal(capturedOptions.isCacheableResponse({ html: JSON.stringify([WRONG_CITY_RESULT]) }), true);
  assert.equal(capturedOptions.isCacheableResponse({ html: JSON.stringify({ display_name: 'reverse result' }) }), true);
});

test('a cached empty geocode body is treated as a miss and refetched live', async () => {
  const normalizer = createOsmNormalizerWithCoords();
  const requests = [];
  const httpAdapter = {
    getPageCacheConfig: () => ({ enabled: true, ttlDays: 7 }),
    readCachedPage: async () => ({ html: '[]' }),
    fetchData: async (url) => {
      requests.push(url);
      return JSON.stringify([PORTLAND_RESULT]);
    }
  };
  const event = { title: 'PRIDE FRIDAY', address: '722 E Burnside', city: 'portland' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(requests.length, 1, 'the poisoned cache entry must not satisfy the request');
  assert.equal(event.location, '45.5230622, -122.6564816', 'the live refetch must fill the coordinates');
});

// ---------------------------------------------------------------------------
// Native reverse geocode hook (Scriptable Location.reverseGeocode — the
// normalizer prefers it over Nominatim when the adapter exposes it)
// ---------------------------------------------------------------------------

test('reverse geocode prefers the adapter native hook and skips Nominatim', async () => {
  const normalizer = createOsmNormalizer();
  const requests = [];
  const httpAdapter = {
    fetchData: async (url) => {
      requests.push(url);
      return JSON.stringify({ display_name: 'Nominatim must not be consulted' });
    },
    reverseGeocode: async () => '2069 Cheshire Bridge Rd NE, Atlanta, GA 30324'
  };
  const event = { title: 'ATL BEAR NIGHT', location: '33.8226, -84.3510' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.address, '2069 Cheshire Bridge Rd NE, Atlanta, GA 30324');
  assert.equal(requests.length, 0, 'the native hook must avoid the Nominatim request entirely');
});

test('reverse geocode falls back to Nominatim when the native hook returns nothing', async () => {
  const normalizer = createOsmNormalizer();
  const requests = [];
  const httpAdapter = {
    fetchData: async (url) => {
      requests.push(url);
      return JSON.stringify({ display_name: '722 E Burnside St, Portland, OR' });
    },
    reverseGeocode: async () => null
  };
  const event = { title: 'PRIDE FRIDAY', location: '45.5230622, -122.6564816' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.address, '722 E Burnside St, Portland, OR');
  assert.equal(requests.length, 1, 'Nominatim stays the fallback');
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

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
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent('922 E. BURNSIDE')}&limit=1&addressdetails=1`,
    'the request keeps the legacy query but always carries address details for the grade gate'
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
  assert.equal(httpAdapter.requests.length, 4, 'rejection counts as failure and the ladder continues through the Photon rescue');
  assert.ok(
    httpAdapter.requests[3].includes('photon.komoot.io/api/?q='),
    `the final rung must be the Photon rescue: ${httpAdapter.requests[3]}`
  );
});

test('retry ladder: identical variants are deduped so no duplicate request is sent', async () => {
  const normalizer = createOsmNormalizerWithAtlanta();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createSequencedStubAdapter([[]]);
  // No strippable directional, no bar → a single query, then exhaustion
  const event = { title: 'CHI BEAR NIGHT', address: '3702 N Halsted', city: 'atlanta' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(httpAdapter.requests.length, 2, 'the stripped variant equals the original and must be skipped (only the Photon rescue follows)');
  assert.ok(httpAdapter.requests[0].includes('nominatim'), 'exactly one Nominatim query for the deduped ladder');
  assert.ok(httpAdapter.requests[1].includes('photon.komoot.io'), 'the extra request is the Photon rescue, not a duplicate');
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
  // Anchors carry the city DISPLAY name ("new york"), never the internal key
  // ("nyc") — geocoders can't parse internal keys (see geocodeCityAnchorName).
  assert.deepEqual(
    normalizer.buildGeocodeQueryVariants('325 Franklin Ave, Brooklyn, NY 11238, USA', 'nyc', "C'mon Everybody"),
    [
      '325 Franklin Ave, Brooklyn, NY 11238, USA, new york',
      '325 Franklin Ave, Brooklyn, new york',
      "C'mon Everybody, new york"
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
  assert.equal(httpAdapter.requests.length, 5, 'the ladder continues past the rejected result through the Census and Photon rescues');
  assert.ok(httpAdapter.requests[3].includes('geocoding.geo.census.gov'), 'the US-looking address gets a Census rescue before Photon');
  assert.ok(httpAdapter.requests[4].includes('photon.komoot.io'), 'the final request is the Photon rescue');
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
    logs.some(l => l.includes('Geocoded via simplified query "C\'mon Everybody, new york"')),
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

// ---------------------------------------------------------------------------
// Geocode verification: grade gate (coarse pins are never written, in any
// mode), suspect handling per geocodeVerification.mode, the unit/suite and
// Photon retry rungs, and the Apple reverse cross-check tripwire.
// ---------------------------------------------------------------------------

// Stub adapter that answers by URL substring (Nominatim query text or the
// Photon host); unmatched URLs get an empty result set.
function createRoutedStubAdapter(routes, extras = {}) {
  const requests = [];
  return {
    requests,
    fetchData: async (url) => {
      requests.push(url);
      for (const [substring, response] of routes) {
        if (url.includes(substring)) return JSON.stringify(response);
      }
      return JSON.stringify([]);
    },
    ...extras
  };
}

async function withCapturedConsole(fn) {
  const lines = [];
  const realLog = console.log;
  const realWarn = console.warn;
  console.log = (message) => { lines.push(String(message)); };
  console.warn = (message) => { lines.push(String(message)); };
  try {
    await fn();
  } finally {
    console.log = realLog;
    console.warn = realWarn;
  }
  return lines;
}

const POWERHOUSE_POI_RESULT = {
  lat: '37.7756941',
  lon: '-122.4103049',
  class: 'amenity',
  type: 'nightclub',
  addresstype: 'amenity',
  display_name: 'Powerhouse, 1192, Folsom Street, San Francisco, California, 94103, United States',
  address: { house_number: '1192', road: 'Folsom Street', city: 'San Francisco' }
};

const FOLSOM_STREET_ONLY_RESULT = {
  lat: '37.7740000',
  lon: '-122.4120000',
  class: 'highway',
  type: 'secondary',
  addresstype: 'road',
  display_name: 'Folsom Street, San Francisco, California, United States',
  address: { road: 'Folsom Street', city: 'San Francisco' }
};

const BROOKLYN_SUBURB_RESULT = {
  lat: '40.6526006',
  lon: '-73.9497211',
  class: 'place',
  type: 'suburb',
  addresstype: 'suburb',
  display_name: 'Brooklyn, Kings County, City of New York, New York, United States',
  address: { suburb: 'Brooklyn', city: 'City of New York' }
};

const WRONG_STREET_POI_RESULT = {
  lat: '37.7752000',
  lon: '-122.4180000',
  class: 'amenity',
  type: 'bar',
  addresstype: 'amenity',
  display_name: 'Some Other Bar, 999, Mission Street, San Francisco, California, 94103, United States',
  address: { house_number: '999', road: 'Mission Street', city: 'San Francisco' }
};

const FOLSOM_PLACEMARK = {
  subThoroughfare: '1192',
  thoroughfare: 'Folsom Street',
  locality: 'San Francisco',
  postalCode: '94103'
};

const MISSION_PLACEMARK = {
  subThoroughfare: '999',
  thoroughfare: 'Mission Street',
  locality: 'San Francisco',
  postalCode: '94103'
};

test('geocode verification: a POI-grade result pins exactly as before, with no flags', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter([['nominatim', [POWERHOUSE_POI_RESULT]]]);
  const event = { title: 'CHUNK', address: '1192 Folsom St' };

  const lines = await withCapturedConsole(() => normalizer.normalizeAsync(event, httpAdapter));

  assert.equal(event.location, '37.7756941, -122.4103049');
  assert.ok(
    lines.some(l => l.includes('OpenStreetMapNormalizer: Found coordinates for address "1192 Folsom St"')),
    `the load-bearing success line must still emit: ${lines.join(' | ')}`
  );
  assert.ok(!lines.some(l => l.includes('GEOCODE VERIFY')), `a clean first-rung accept stays silent: ${lines.join(' | ')}`);
});

test('geocode verification: a coarse result is refused in every mode, including off', async () => {
  for (const mode of ['off', 'report', 'enforce']) {
    const normalizer = createOsmNormalizer();
    normalizer.delayForRateLimit = async () => {};
    const httpAdapter = createRoutedStubAdapter([['nominatim', [BROOKLYN_SUBURB_RESULT]]]);
    const event = { title: 'BK BEAR', address: 'Brooklyn' };

    const lines = await withCapturedConsole(() =>
      normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode } })
    );

    assert.equal(event.location, undefined, `mode "${mode}" must never write a borough/suburb centroid`);
    assert.ok(
      lines.some(l => l.includes('🗺️ GEOCODE VERIFY: "BK BEAR" refused generic pin (suburb) for address "Brooklyn"')),
      `mode "${mode}" must log the refusal flag: ${lines.join(' | ')}`
    );
  }
});

test('geocode verification: street-grade pin for a house-numbered input is kept but flagged in report mode', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter([['nominatim', [FOLSOM_STREET_ONLY_RESULT]]]);
  const event = { title: 'CHUNK', address: '1192 Folsom St' };

  const lines = await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'report' } })
  );

  assert.equal(event.location, '37.7740000, -122.4120000', 'report mode still writes the pin');
  assert.ok(
    lines.some(l => l.includes('🗺️ GEOCODE VERIFY: "CHUNK" street-grade pin for house-numbered address "1192 Folsom St" — verify pin')),
    `the suspect flag must be logged: ${lines.join(' | ')}`
  );
});

test('geocode verification: enforce mode exhausts the ladder on street-grade results and leaves the event unpinned', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter([
    ['nominatim', [FOLSOM_STREET_ONLY_RESULT]],
    ['photon.komoot.io', {
      type: 'FeatureCollection',
      features: [{
        geometry: { type: 'Point', coordinates: [-122.412, 37.774] },
        properties: { street: 'Folsom Street', city: 'San Francisco', osm_key: 'highway', osm_value: 'secondary' }
      }]
    }]
  ]);
  const event = { title: 'CHUNK', address: '1192 Folsom St' };

  const lines = await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'enforce' } })
  );

  assert.equal(event.location, undefined, 'enforce mode demands house-number quality for a house-numbered input');
  assert.ok(httpAdapter.requests.some(url => url.includes('photon.komoot.io')), 'the Photon rung must still be tried');
  assert.ok(
    lines.some(l => l.includes('🗺️ GEOCODE VERIFY: "CHUNK" full address but no usable geocoordinate — left unpinned')),
    `the give-up flag must be logged: ${lines.join(' | ')}`
  );
});

test('geocode verification: cross-check mismatch keeps the pin but flags it in report mode', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter(
    [['nominatim', [WRONG_STREET_POI_RESULT]]],
    { reverseGeocodePlacemark: async () => MISSION_PLACEMARK }
  );
  const event = { title: 'CHUNK', address: '1192 Folsom St' };

  const lines = await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'report' } })
  );

  assert.equal(event.location, '37.7752000, -122.4180000', 'report mode keeps the suspect pin');
  assert.ok(
    lines.some(l => l.includes('🗺️ GEOCODE VERIFY: "CHUNK" pin failed reverse cross-check') && l.includes('— verify pin')),
    `the mismatch flag must be logged: ${lines.join(' | ')}`
  );
});

test('geocode verification: cross-check mismatch rejects the pin in enforce mode and the ladder recovers on the next rung', async () => {
  const core = new SharedCore(CITIES_SF_WITH_COORDS, { eventSchema: EventSchema });
  const normalizer = new OpenStreetMapNormalizer(core);
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter(
    [
      [encodeURIComponent('1192 Folsom St, sf'), [WRONG_STREET_POI_RESULT]],
      [encodeURIComponent('Powerhouse, sf'), [POWERHOUSE_POI_RESULT]]
    ],
    {
      reverseGeocodePlacemark: async (lat, lon) =>
        Math.abs(lon - (-122.418)) < 0.0001 ? MISSION_PLACEMARK : FOLSOM_PLACEMARK
    }
  );
  const event = { title: 'CHUNK', address: '1192 Folsom St', bar: 'Powerhouse', city: 'sf' };

  const lines = await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'enforce' } })
  );

  assert.equal(event.location, '37.7756941, -122.4103049', 'the venue-name rung must recover a verified pin');
  assert.ok(
    lines.some(l => l.includes('pin failed reverse cross-check')),
    `the rejected first pin must be flagged: ${lines.join(' | ')}`
  );
  assert.ok(
    lines.some(l => l.includes('🗺️ GEOCODE VERIFY: "CHUNK" accepted exact pin from nominatim (rung 2)')),
    `the verified accept must be logged: ${lines.join(' | ')}`
  );
});

test('geocode verification: cross-check pass writes the pin with no mismatch flag', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter(
    [['nominatim', [POWERHOUSE_POI_RESULT]]],
    { reverseGeocodePlacemark: async () => FOLSOM_PLACEMARK }
  );
  const event = { title: 'CHUNK', address: '1192 Folsom St' };

  const lines = await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'report' } })
  );

  assert.equal(event.location, '37.7756941, -122.4103049');
  assert.ok(!lines.some(l => l.includes('verify pin')), `no suspect flag on a clean cross-check: ${lines.join(' | ')}`);
  assert.ok(
    lines.some(l => l.includes('🗺️ GEOCODE VERIFY: "CHUNK" accepted exact pin from nominatim (rung 1)')),
    `a cross-checked accept is worth one log line: ${lines.join(' | ')}`
  );
});

test('geocode verification: the unit/suite-stripping rung recovers a pin the raw address could not get', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter([
    [encodeURIComponent('1192 Folsom St Suite 200, San Francisco'), []],
    [encodeURIComponent('1192 Folsom St, San Francisco'), [POWERHOUSE_POI_RESULT]]
  ]);
  const event = { title: 'CHUNK', address: '1192 Folsom St Suite 200, San Francisco' };

  await withCapturedConsole(() => normalizer.normalizeAsync(event, httpAdapter));

  assert.equal(event.location, '37.7756941, -122.4103049');
  assert.equal(httpAdapter.requests.length, 2);
  assert.equal(
    decodeQueryParam(httpAdapter.requests[1]),
    '1192 Folsom St, San Francisco',
    'the second rung must be the unit/suite-stripped address'
  );
});

test('geocode verification: the Photon rung recovers when Nominatim returns nothing, with [lon, lat] order handled', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter([
    ['nominatim', []],
    ['photon.komoot.io', {
      type: 'FeatureCollection',
      features: [{
        geometry: { type: 'Point', coordinates: [-122.4103049, 37.7756941] },
        properties: { housenumber: '1192', street: 'Folsom Street', city: 'San Francisco', osm_key: 'building', osm_value: 'yes' }
      }]
    }]
  ]);
  const event = { title: 'CHUNK', address: '1192 Folsom St' };

  const lines = await withCapturedConsole(() => normalizer.normalizeAsync(event, httpAdapter));

  assert.equal(event.location, '37.7756941, -122.4103049', 'the pin must come out "lat, lon" despite GeoJSON [lon, lat]');
  assert.ok(httpAdapter.requests[httpAdapter.requests.length - 1].includes('photon.komoot.io/api/?q='));
  assert.ok(
    lines.some(l => l.includes('accepted exact pin from photon (rung 2)')),
    `the Photon accept must be logged: ${lines.join(' | ')}`
  );
});

test('geocode verification: an adapter without the placemark hook skips the cross-check and still pins', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  // web-adapter case: the hook exists but honestly returns null
  const httpAdapter = createRoutedStubAdapter(
    [['nominatim', [POWERHOUSE_POI_RESULT]]],
    { reverseGeocodePlacemark: async () => null }
  );
  const event = { title: 'CHUNK', address: '1192 Folsom St' };

  const lines = await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'report' } })
  );

  assert.equal(event.location, '37.7756941, -122.4103049');
  assert.ok(!lines.some(l => l.includes('verify pin')), 'a skipped cross-check never flags');

  // and an adapter with no hook at all (plain fetch stub) must not crash
  const bareAdapter = createRoutedStubAdapter([['nominatim', [POWERHOUSE_POI_RESULT]]]);
  const bareEvent = { title: 'CHUNK', address: '1192 Folsom St' };
  await withCapturedConsole(() =>
    normalizer.normalizeAsync(bareEvent, bareAdapter, { geocodeVerification: { mode: 'enforce' } })
  );
  assert.equal(bareEvent.location, '37.7756941, -122.4103049');
});

test('geocode verification: the coords→address reverse path is untouched by verification modes', async () => {
  const normalizer = createOsmNormalizer();
  const requests = [];
  const httpAdapter = {
    fetchData: async (url) => {
      requests.push(url);
      return JSON.stringify({ display_name: '1192 Folsom St, San Francisco, CA' });
    },
    reverseGeocode: async () => null
  };
  const event = { title: 'CHUNK', location: '37.7756941, -122.4103049' };

  const lines = await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'enforce' } })
  );

  assert.equal(event.address, '1192 Folsom St, San Francisco, CA');
  assert.ok(requests[0].includes('nominatim.openstreetmap.org/reverse'), 'the reverse endpoint stays Nominatim');
  assert.ok(!lines.some(l => l.includes('GEOCODE VERIFY')), `the reverse path never emits verification flags: ${lines.join(' | ')}`);
});

// ---------------------------------------------------------------------------
// 2026-07-15 run findings: reviewer proposed replacing correct pins with
// street centroids ("3796 Fifth Avenue, San Diego" → Fifth Avenue downtown,
// 4.7 km away). Fixes under test here: geocode verdict fields (_geocodeGrade
// etc.), city display-name query anchoring, the US Census rescue rung, and
// the tightened unit-strip rung.
// ---------------------------------------------------------------------------

const CITIES_SAN_DIEGO = {
  'san-diego': {
    timezone: 'America/Los_Angeles',
    patterns: ['san diego'],
    coordinates: { lat: 32.7157, lng: -117.1611 }
  }
};

function createOsmNormalizerWithSanDiego() {
  const core = new SharedCore(CITIES_SAN_DIEGO, { eventSchema: EventSchema });
  return new OpenStreetMapNormalizer(core);
}

// The street "Fifth Avenue" itself — a highway-class match whose centroid sits
// downtown, kilometers from house 3796 (inside the 50 km radius, so only the
// grade gate can stop it).
const FIFTH_AVENUE_STREET_RESULT = {
  lat: '32.7150000',
  lon: '-117.1590000',
  class: 'highway',
  type: 'residential',
  addresstype: 'road',
  display_name: 'Fifth Avenue, San Diego, California, United States',
  address: { road: 'Fifth Avenue', city: 'San Diego' }
};

// US Census house-number interpolation for the same address. NOTE the
// coordinates shape: {x: lon, y: lat}.
const CENSUS_FIFTH_AVENUE_MATCH = {
  result: {
    addressMatches: [{
      matchedAddress: '3796 FIFTH AVE, SAN DIEGO, CA, 92103',
      coordinates: { x: -117.1609, y: 32.7481 }
    }]
  }
};

const FIFTH_AVENUE_PLACEMARK = {
  subThoroughfare: '3796',
  thoroughfare: 'Fifth Avenue',
  locality: 'San Diego',
  postalCode: '92103'
};

test('geocode verdict fields record grade, cross-check, source, and rung on accepted pins — and never leak into notes', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter(
    [['nominatim', [POWERHOUSE_POI_RESULT]]],
    { reverseGeocodePlacemark: async () => FOLSOM_PLACEMARK }
  );
  const event = { title: 'CHUNK', address: '1192 Folsom St' };

  await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'report' } })
  );

  assert.equal(event.location, '37.7756941, -122.4103049');
  assert.equal(event._geocodeGrade, 'exact');
  assert.equal(event._geocodeCrossCheck, 'pass');
  assert.equal(event._geocodeSource, 'nominatim');
  assert.equal(event._geocodeRung, 1);
  assert.ok(typeof event.notes === 'string' && event.notes.length > 0, 'a successful geocode refreshes notes');
  assert.ok(!event.notes.includes('_geocode'), `underscore verdict fields must never leak into notes: ${event.notes}`);
});

test('geocode verdict: report-mode cross-check failure and street-grade accepts are recorded truthfully', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const failAdapter = createRoutedStubAdapter(
    [['nominatim', [WRONG_STREET_POI_RESULT]]],
    { reverseGeocodePlacemark: async () => MISSION_PLACEMARK }
  );
  const failEvent = { title: 'CHUNK', address: '1192 Folsom St' };
  await withCapturedConsole(() =>
    normalizer.normalizeAsync(failEvent, failAdapter, { geocodeVerification: { mode: 'report' } })
  );
  assert.equal(failEvent.location, '37.7752000, -122.4180000', 'report mode still keeps the suspect pin');
  assert.equal(failEvent._geocodeCrossCheck, 'fail');
  assert.equal(failEvent._geocodeGrade, 'exact');

  const streetNormalizer = createOsmNormalizer();
  streetNormalizer.delayForRateLimit = async () => {};
  const streetAdapter = createRoutedStubAdapter([['nominatim', [FOLSOM_STREET_ONLY_RESULT]]]);
  const streetEvent = { title: 'CHUNK', address: '1192 Folsom St' };
  await withCapturedConsole(() =>
    streetNormalizer.normalizeAsync(streetEvent, streetAdapter, { geocodeVerification: { mode: 'report' } })
  );
  assert.equal(streetEvent._geocodeGrade, 'street');
  assert.equal(streetEvent._geocodeCrossCheck, 'skipped', 'no placemark hook → the cross-check is skipped');
});

test('geocode verdict: enforce leaves a street-grade breadcrumb when the ladder ends unpinned', async () => {
  const normalizer = createOsmNormalizerWithSanDiego();
  normalizer.delayForRateLimit = async () => {};
  // Nominatim only knows the street; Census has no match; Photon has nothing.
  const httpAdapter = createRoutedStubAdapter([
    ['nominatim', [FIFTH_AVENUE_STREET_RESULT]],
    ['geocoding.geo.census.gov', { result: { addressMatches: [] } }]
  ]);
  const event = { title: 'SD BEAR', address: '3796 Fifth Avenue, San Diego, CA 92103', city: 'san-diego' };

  await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'enforce' } })
  );

  assert.equal(event.location, undefined, 'enforce refuses a street-grade pin for a house-numbered address');
  assert.equal(event._geocodeGrade, 'street', 'the rejected street-grade candidate leaves a breadcrumb');
  assert.equal(event._geocodeCrossCheck, 'skipped');
  assert.equal(event._geocodeSource, 'nominatim');
});

test('geocode queries anchor with the city display name, never the internal key', () => {
  const normalizer = createOsmNormalizer(); // CITIES: nyc → patterns ['new york', 'nyc']
  assert.deepEqual(
    normalizer.buildGeocodeQueryVariants('10-90 Wyckoff Avenue, Queens', 'nyc', ''),
    ['10-90 Wyckoff Avenue, Queens, new york']
  );
  assert.deepEqual(
    normalizer.buildGeocodeQueryVariants('Some Bar', 'nyc', 'Some Bar'),
    ['Some Bar, new york'],
    'the venue-name rescue rung is display-name-anchored too'
  );
  // A key with no cities config entry falls back to the key itself
  assert.deepEqual(
    normalizer.buildGeocodeQueryVariants('922 E. BURNSIDE', 'portland', ''),
    ['922 E. BURNSIDE, portland']
  );
});

test('census rescue: a house-numbered address that only street-grades on Nominatim gets a house-level Census pin', async () => {
  const normalizer = createOsmNormalizerWithSanDiego();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter(
    [
      ['nominatim', [FIFTH_AVENUE_STREET_RESULT]],
      ['geocoding.geo.census.gov', CENSUS_FIFTH_AVENUE_MATCH]
    ],
    { reverseGeocodePlacemark: async () => FIFTH_AVENUE_PLACEMARK }
  );
  const event = { title: 'SD BEAR', address: '3796 Fifth Avenue, San Diego, CA 92103', city: 'san-diego' };

  const lines = await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'enforce' } })
  );

  assert.equal(event.location, '32.7481, -117.1609', 'Census {x: lon, y: lat} must come out as "lat, lon"');
  assert.equal(event._geocodeGrade, 'exact');
  assert.equal(event._geocodeCrossCheck, 'pass');
  assert.equal(event._geocodeSource, 'census');
  const censusRequest = httpAdapter.requests.find(url => url.includes('geocoding.geo.census.gov'));
  assert.ok(
    censusRequest.includes('/geocoder/locations/onelineaddress?address=') &&
    censusRequest.includes('benchmark=Public_AR_Current') &&
    censusRequest.includes('format=json'),
    `the Census request must use the onelineaddress endpoint: ${censusRequest}`
  );
  assert.ok(!httpAdapter.requests.some(url => url.includes('photon.komoot.io')), 'Census rescued the pin before Photon was needed');
  assert.ok(
    lines.some(l => l.includes('🗺️ GEOCODE VERIFY: "SD BEAR" accepted exact pin from census (rung 2)')),
    `the Census accept must be logged: ${lines.join(' | ')}`
  );
});

test('census rescue is skipped for non-US-looking addresses', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter([['nominatim', []]]);
  const event = { title: 'TORREMOLINOS BEARS', address: 'LA NOGALERA, Torremolinos' };

  await withCapturedConsole(() => normalizer.normalizeAsync(event, httpAdapter));

  assert.ok(!httpAdapter.requests.some(url => url.includes('geocoding.geo.census.gov')), 'no Census request for a non-US address');
  assert.ok(httpAdapter.requests.some(url => url.includes('photon.komoot.io')), 'the Photon rescue still runs');
});

test('census rescue: still subject to the reverse cross-check and the city-center radius', async () => {
  // Cross-check mismatch in enforce mode → rejected, event stays unpinned
  const normalizer = createOsmNormalizerWithSanDiego();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter(
    [['geocoding.geo.census.gov', CENSUS_FIFTH_AVENUE_MATCH]],
    { reverseGeocodePlacemark: async () => MISSION_PLACEMARK }
  );
  const event = { title: 'SD BEAR', address: '3796 Fifth Avenue, San Diego, CA 92103', city: 'san-diego' };
  await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'enforce' } })
  );
  assert.equal(event.location, undefined, 'a cross-check-failed Census pin must not be written in enforce mode');
  assert.equal(event._geocodeCrossCheck, 'fail', 'the rejection breadcrumb records the failed cross-check');

  // A Census match outside the 50 km radius is ignored like any other candidate
  const farNormalizer = createOsmNormalizerWithSanDiego();
  farNormalizer.delayForRateLimit = async () => {};
  const farAdapter = createRoutedStubAdapter([
    ['geocoding.geo.census.gov', { result: { addressMatches: [{ matchedAddress: 'X', coordinates: { x: -74.006, y: 40.7128 } }] } }]
  ]);
  const farEvent = { title: 'SD BEAR', address: '3796 Fifth Avenue, San Diego, CA 92103', city: 'san-diego' };
  await withCapturedConsole(() => farNormalizer.normalizeAsync(farEvent, farAdapter));
  assert.equal(farEvent.location, undefined, 'a Census match outside the city radius must be ignored');
});

// ---------------------------------------------------------------------------
// Fail-closed enforce semantics (2026-07-16 run findings, pipeline side):
// a vague input refuses every geocoder candidate, and a cross-check the
// platform COULD run but didn't rejects the candidate. Report mode stays
// accept-and-flag for scraping.
// ---------------------------------------------------------------------------

// An exact-grading POI Nominatim happily returns for the vague query
// "Poconos, PA" — an arbitrary same-named candidate, kilometers from the venue.
const POCONOS_ATTRACTION_RESULT = {
  lat: '41.3000000',
  lon: '-75.3000000',
  class: 'tourism',
  type: 'attraction',
  addresstype: 'tourism',
  display_name: 'Some Attraction, Poconos, Pennsylvania, United States',
  address: { county: 'Poconos' }
};

test('geocode verification: enforce refuses every candidate for a vague address and flags once', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter([['nominatim', [POCONOS_ATTRACTION_RESULT]]]);
  const event = { title: 'FURBALL CAMP', address: 'Poconos, PA' };

  const lines = await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'enforce' } })
  );

  assert.equal(event.location, undefined, 'enforce must never pin a vague input, whatever the grade');
  assert.ok(httpAdapter.requests.length > 0, 'the ladder still ran — the gate refused its answers');
  const flagCount = lines.filter(l =>
    l.includes('🗺️ GEOCODE VERIFY: "FURBALL CAMP" address too vague for a trustworthy pin — left unpinned (enforce)')).length;
  assert.equal(flagCount, 1, `the vague flag fires once per event: ${lines.join(' | ')}`);
  assert.equal(event._geocodeGrade, 'exact', 'the refused candidate leaves a breadcrumb');
  assert.equal(event._geocodeCrossCheck, 'skipped', 'a vague refusal is not a cross-check failure');
});

test('geocode verification: report mode keeps the pin from a vague address but flags it', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter([['nominatim', [POCONOS_ATTRACTION_RESULT]]]);
  const event = { title: 'FURBALL CAMP', address: 'Poconos, PA' };

  const lines = await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'report' } })
  );

  assert.equal(event.location, '41.3000000, -75.3000000', 'report mode accepts as today (flag, don\'t drop)');
  assert.ok(
    lines.some(l => l.includes('🗺️ GEOCODE VERIFY: "FURBALL CAMP" pin from vague address "Poconos, PA" — verify pin')),
    `the vague-pin flag must be logged: ${lines.join(' | ')}`
  );
});

test('geocode verification: enforce rejects a candidate when the platform can cross-check but none ran', async () => {
  const core = new SharedCore(CITIES_SF_WITH_COORDS, { eventSchema: EventSchema });
  const normalizer = new OpenStreetMapNormalizer(core);
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter(
    [
      [encodeURIComponent('1192 Folsom St, sf'), [POWERHOUSE_POI_RESULT]],
      [encodeURIComponent('Powerhouse, sf'), [POWERHOUSE_POI_RESULT]]
    ],
    {
      // Apple rate-limited/down: the capability exists but yields nothing
      reverseGeocodePlacemark: async () => null,
      supportsReverseGeocode: () => true
    }
  );
  const event = { title: 'CHUNK', address: '1192 Folsom St', bar: 'Powerhouse', city: 'sf' };

  const lines = await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'enforce' } })
  );

  assert.equal(event.location, undefined, 'skipped is not pass — the candidate must be rejected in enforce mode');
  assert.ok(httpAdapter.requests.some(url => url.includes('photon.komoot.io')), 'the ladder continues past the rejection');
  const flagCount = lines.filter(l =>
    l.includes('🗺️ GEOCODE VERIFY: "CHUNK" pin rejected — cross-check unavailable (enforce)')).length;
  assert.equal(flagCount, 1, `the unavailable flag fires once per event, not per rung: ${lines.join(' | ')}`);
  assert.equal(event._geocodeGrade, 'exact', 'the rejected candidate leaves a breadcrumb');
  assert.equal(event._geocodeCrossCheck, 'skipped',
    'skipped (not fail) — the reviewer renders its "re-run when Apple geocoding recovers" hint from this');
});

test('geocode verification: structural absence of the cross-check (Node/web) still accepts in enforce mode', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter(
    [['nominatim', [POWERHOUSE_POI_RESULT]]],
    { reverseGeocodePlacemark: async () => null, supportsReverseGeocode: () => false }
  );
  const event = { title: 'CHUNK', address: '1192 Folsom St' };

  const lines = await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'enforce' } })
  );

  assert.equal(event.location, '37.7756941, -122.4103049', 'structural absence is not a failure');
  assert.ok(!lines.some(l => l.includes('cross-check unavailable')), `no rejection flag: ${lines.join(' | ')}`);
});

test('geocode verification: report mode is unchanged for street-specific inputs even with the capability present', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter(
    [['nominatim', [POWERHOUSE_POI_RESULT]]],
    { reverseGeocodePlacemark: async () => null, supportsReverseGeocode: () => true }
  );
  const event = { title: 'CHUNK', address: '1192 Folsom St' };

  const lines = await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'report' } })
  );

  assert.equal(event.location, '37.7756941, -122.4103049', 'report mode accepts exactly as before');
  assert.ok(!lines.some(l => l.includes('GEOCODE VERIFY')), `a clean rung-1 accept stays silent: ${lines.join(' | ')}`);
});

test('stripUnitTokens: hash-unit markers, trailing bare units, and state/ZIP tails', () => {
  const normalizer = createOsmNormalizer();
  // Simple hash markers keep stripping
  assert.equal(normalizer.stripUnitTokens('1123 Folsom St #4, San Francisco'), '1123 Folsom St, San Francisco');
  // "#UNIT 114" must go entirely, not leave a dangling "114"
  assert.equal(
    normalizer.stripUnitTokens('3796 Fifth Avenue #UNIT 114, San Diego'),
    '3796 Fifth Avenue, San Diego'
  );
  // A trailing bare "Unit"/"Suite" with no token before a comma/end is stripped
  assert.equal(
    normalizer.stripUnitTokens('333 S Palm Canyon Dr Unit, Palm Springs'),
    '333 S Palm Canyon Dr, Palm Springs'
  );
  assert.equal(normalizer.stripUnitTokens('333 S Palm Canyon Dr Suite'), '333 S Palm Canyon Dr');
  // The classic forms keep working
  assert.equal(normalizer.stripUnitTokens('1192 Folsom St Suite 200, San Francisco'), '1192 Folsom St, San Francisco');
  assert.equal(normalizer.stripUnitTokens('123 Main St Fl. 2, Boston'), '123 Main St, Boston');
  assert.equal(normalizer.stripUnitTokens('123 Main St Floor 2, Boston'), '123 Main St, Boston');
  // Street names never match the boundary-guarded unit words
  assert.equal(normalizer.stripUnitTokens('3702 N Halsted, Chicago'), '3702 N Halsted, Chicago');
  assert.equal(normalizer.stripUnitTokens('2199 Steiner St, San Francisco'), '2199 Steiner St, San Francisco');
  assert.equal(normalizer.stripUnitTokens('1500 Rue Sainte-Catherine, Montreal'), '1500 Rue Sainte-Catherine, Montreal');
  // A Florida state+ZIP tail must never match the old bare "fl" token
  assert.equal(normalizer.stripUnitTokens('101 Ocean Dr, Miami, FL 33101'), '101 Ocean Dr, Miami, FL 33101');
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

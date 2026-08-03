const test = require('node:test');
const assert = require('node:assert/strict');

const { NormalizerPipeline, LocationNormalizer, OpenStreetMapNormalizer, BasicDataNormalizer, BarDataNormalizer } = require('./normalizers');
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

// REPLACES 'forward geocode without an event city keeps the legacy query and
// accepts the result', which asserted `event.location === '43.2105820,
// -83.0771632'` with the comment "no city context means no validation (old
// behavior)" — i.e. it locked IN the defect: a city-less street line is
// geocoded globally and whatever comes back (here Burnside, MICHIGAN, from
// the very fixture the file names WRONG_CITY_RESULT) is written as the
// event's pin, with nothing left that could ever check it. Run
// 20260802-220918 shipped that exact failure at scale: "619 E Pine" with an
// unresolved city pinned a Seattle event at 39.2327933, -86.6282171 —
// southern Indiana, ~3,000 km off — stamped pinSource "geocoded-exact".
// Fail closed instead: no anchor and no place context in the address means
// the question has no answer, so it is never asked.
test('forward geocode refuses a city-less address when the event has no city either', async () => {
  const normalizer = createOsmNormalizer();
  const httpAdapter = createStubHttpAdapter([WRONG_CITY_RESULT]);
  const event = { title: 'MYSTERY EVENT', address: '922 E. BURNSIDE' };

  const lines = await withCapturedConsole(() => normalizer.normalizeAsync(event, httpAdapter));

  assert.equal(event.location, undefined, 'an unverifiable pin is worse than no pin');
  assert.equal(httpAdapter.requests.length, 0, 'the planet is never asked a question only a local could answer');
  assert.ok(
    lines.some(l => l.includes('Address "922 E. BURNSIDE" names no city or region and the event has none')),
    `the refusal must be visible: ${lines.join(' | ')}`
  );
});

test('forward geocode still runs when the address carries its own place context', async () => {
  const normalizer = createOsmNormalizer();
  const httpAdapter = createStubHttpAdapter([PORTLAND_RESULT]);
  const event = { title: 'MYSTERY EVENT', address: '922 E. BURNSIDE, Portland, OR' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.location, '45.5230622, -122.6564816', 'the address itself says where on earth it is');
  assert.equal(
    httpAdapter.requests[0],
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent('922 E. BURNSIDE, Portland, OR')}&limit=1&addressdetails=1`,
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
    // Name-led rung first: the venue name disambiguates a vague street line.
    'The Heretic, 2069 CHESHIRE BRIDGE RD NE, atlanta',
    '2069 CHESHIRE BRIDGE RD NE, atlanta',
    '2069 CHESHIRE BRIDGE RD, atlanta',
    'The Heretic, atlanta'
  ]);
  assert.ok(full.length <= 6, 'hard cap: at most MAX_GEOCODE_QUERIES_PER_EVENT queries per event');

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
      'The Heretic, 2069 Cheshire Bridge Road Northeast, Atlanta, GA, 30324',
      '2069 Cheshire Bridge Road Northeast, Atlanta, GA, 30324',
      '2069 Cheshire Bridge Road, Atlanta, GA, 30324',
      'The Heretic, atlanta'
    ]
  );

  // An address that ALREADY starts with the venue name is not doubled — a
  // repeated name is a query nothing matches.
  assert.deepEqual(
    normalizer.buildGeocodeQueryVariants('The Heretic, 2069 Cheshire Bridge Road, Atlanta', 'atlanta', 'The Heretic'),
    [
      'The Heretic, 2069 Cheshire Bridge Road, Atlanta',
      'The Heretic, atlanta'
    ]
  );
});

test('retry ladder: 0 results retries with the directional stripped, rate-limited per request', async () => {
  const normalizer = createOsmNormalizerWithAtlanta();
  let delays = 0;
  normalizer.delayForRateLimit = async () => { delays += 1; };
  const httpAdapter = createSequencedStubAdapter([[], [], [HERETIC_RESULT]]);
  const event = { title: 'ATL BEAR NIGHT', address: '2069 CHESHIRE BRIDGE RD NE', city: 'atlanta', bar: 'The Heretic' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.location, '33.8226, -84.3510');
  assert.equal(httpAdapter.requests.length, 3, 'name-led rung, address rung, then the directional retry');
  assert.equal(decodeQueryParam(httpAdapter.requests[0]), 'The Heretic, 2069 CHESHIRE BRIDGE RD NE, atlanta');
  assert.equal(decodeQueryParam(httpAdapter.requests[1]), '2069 CHESHIRE BRIDGE RD NE, atlanta');
  assert.equal(
    decodeQueryParam(httpAdapter.requests[2]),
    '2069 CHESHIRE BRIDGE RD, atlanta',
    'the last query must have the trailing directional stripped'
  );
  assert.equal(delays, 3, 'every live request must pass through the rate limiter');
});

test('retry ladder: falls back to bar+city after every address rung', async () => {
  const normalizer = createOsmNormalizerWithAtlanta();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createSequencedStubAdapter([[], [], [], [HERETIC_RESULT]]);
  const event = { title: 'ATL BEAR NIGHT', address: '2069 CHESHIRE BRIDGE RD NE', city: 'atlanta', bar: 'The Heretic' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(httpAdapter.requests.length, 4);
  assert.equal(decodeQueryParam(httpAdapter.requests[3]), 'The Heretic, atlanta');
  assert.equal(event.location, '33.8226, -84.3510', 'the venue-name lookup must rescue the event');
  // The bar+city rung carries no address — the maps-link rung is allowed to
  // outrank the pin it produces.
  assert.equal(event._geocodeQueryHadAddress, false);
});

test('retry ladder: distance validation still applies to fallback variants', async () => {
  const normalizer = createOsmNormalizerWithAtlanta();
  normalizer.delayForRateLimit = async () => {};
  // Variant 2 returns a candidate ~1000 km from Atlanta — must be rejected, ladder continues
  const httpAdapter = createSequencedStubAdapter([[], [], [PORTLAND_MICHIGAN_RESULT], []]);
  const event = { title: 'ATL BEAR NIGHT', address: '2069 CHESHIRE BRIDGE RD NE', city: 'atlanta', bar: 'The Heretic' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.location, undefined, 'a far-away candidate from a simplified query must not win');
  assert.equal(httpAdapter.requests.length, 6, 'rejection counts as failure and the ladder continues through the Photon rescue + venue follow-up');
  assert.ok(
    httpAdapter.requests[4].includes('photon.komoot.io/api/?q='),
    `the Photon rescue follows every Nominatim rung: ${httpAdapter.requests[4]}`
  );
  assert.ok(
    httpAdapter.requests[5].includes('photon.komoot.io/api/?q=') && decodeQueryParam(httpAdapter.requests[5]) === 'The Heretic, atlanta',
    `the final request is the Photon venue follow-up (empty Nominatim venue rescue): ${httpAdapter.requests[5]}`
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
      "C'mon Everybody, 325 Franklin Ave, Brooklyn, NY 11238, USA, new york",
      '325 Franklin Ave, Brooklyn, NY 11238, USA, new york',
      '325 Franklin Ave, Brooklyn, new york',
      "C'mon Everybody, new york"
    ]
  );
  // With a strippable directional too, the full 5-rung ladder fits the cap and
  // the venue-name rescue is never evicted
  const atlanta = createOsmNormalizerWithAtlanta();
  assert.deepEqual(
    atlanta.buildGeocodeQueryVariants('2069 Cheshire Bridge Rd NE, Atlanta, GA 30324, USA', 'atlanta', 'The Heretic'),
    [
      'The Heretic, 2069 Cheshire Bridge Rd NE, Atlanta, GA 30324, USA',
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
  // Name-led + full address → 0 results; stripped variant → the borough
  // itself; venue → 0
  const httpAdapter = createSequencedStubAdapter([[], [], [BROOKLYN_BOROUGH_RESULT], []]);
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
  assert.equal(httpAdapter.requests.length, 7, 'the ladder continues past the rejected result through the Census and Photon rescues + venue follow-up');
  assert.ok(httpAdapter.requests[4].includes('geocoding.geo.census.gov'), 'the US-looking address gets a Census rescue before Photon');
  assert.ok(httpAdapter.requests[5].includes('photon.komoot.io'), 'the next request is the Photon rescue');
  assert.ok(
    httpAdapter.requests[6].includes('photon.komoot.io') && decodeQueryParam(httpAdapter.requests[6]) === "C'mon Everybody, new york",
    `the final request is the Photon venue follow-up (empty Nominatim venue rescue): ${httpAdapter.requests[6]}`
  );
});

test('a venue-name simplified query still resolves through an amenity result', async () => {
  const normalizer = createOsmNormalizerWithNyc();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createSequencedStubAdapter([[], [], [], [CMON_EVERYBODY_RESULT]]);
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
  // Place context in the address so a request is actually issued (the ladder
  // refuses region-less queries outright — see the fail-closed test above).
  const event = { title: 'MYSTERY EVENT', address: '922 E. BURNSIDE, Portland, OR' };

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
  const event = { title: 'CHUNK', address: '1192 Folsom St, San Francisco' };

  const lines = await withCapturedConsole(() => normalizer.normalizeAsync(event, httpAdapter));

  assert.equal(event.location, '37.7756941, -122.4103049');
  assert.ok(
    lines.some(l => l.includes('OpenStreetMapNormalizer: Found coordinates for address "1192 Folsom St, San Francisco"')),
    `the load-bearing success line must still emit: ${lines.join(' | ')}`
  );
  assert.ok(!lines.some(l => l.includes('GEOCODE VERIFY')), `a clean first-rung accept stays silent: ${lines.join(' | ')}`);
});

test('geocode verification: a coarse result is refused in every mode, including off', async () => {
  for (const mode of ['off', 'report', 'enforce']) {
    const normalizer = createOsmNormalizer();
    normalizer.delayForRateLimit = async () => {};
    const httpAdapter = createRoutedStubAdapter([['nominatim', [BROOKLYN_SUBURB_RESULT]]]);
    const event = { title: 'BK BEAR', address: 'Brooklyn, NY' };

    const lines = await withCapturedConsole(() =>
      normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode } })
    );

    assert.equal(event.location, undefined, `mode "${mode}" must never write a borough/suburb centroid`);
    assert.ok(
      lines.some(l => l.includes('🗺️ GEOCODE VERIFY: "BK BEAR" refused generic pin (suburb) for address "Brooklyn, NY"')),
      `mode "${mode}" must log the refusal flag: ${lines.join(' | ')}`
    );
  }
});

test('geocode verification: street-grade pin for a house-numbered input is kept but flagged in report mode', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter([['nominatim', [FOLSOM_STREET_ONLY_RESULT]]]);
  const event = { title: 'CHUNK', address: '1192 Folsom St, San Francisco' };

  const lines = await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'report' } })
  );

  assert.equal(event.location, '37.7740000, -122.4120000', 'report mode still writes the pin');
  assert.ok(
    lines.some(l => l.includes('🗺️ GEOCODE VERIFY: "CHUNK" street-grade pin for house-numbered address "1192 Folsom St, San Francisco" — verify pin')),
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
  const event = { title: 'CHUNK', address: '1192 Folsom St, San Francisco' };

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
  const event = { title: 'CHUNK', address: '1192 Folsom St, San Francisco' };

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
    lines.some(l => l.includes('🗺️ GEOCODE VERIFY: "CHUNK" accepted exact pin from nominatim (rung 3)')),
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
  const event = { title: 'CHUNK', address: '1192 Folsom St, San Francisco' };

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
  const event = { title: 'CHUNK', address: '1192 Folsom St, San Francisco' };

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
  const event = { title: 'CHUNK', address: '1192 Folsom St, San Francisco' };

  const lines = await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'report' } })
  );

  assert.equal(event.location, '37.7756941, -122.4103049');
  assert.ok(!lines.some(l => l.includes('verify pin')), 'a skipped cross-check never flags');

  // and an adapter with no hook at all (plain fetch stub) must not crash
  const bareAdapter = createRoutedStubAdapter([['nominatim', [POWERHOUSE_POI_RESULT]]]);
  const bareEvent = { title: 'CHUNK', address: '1192 Folsom St, San Francisco' };
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
  const event = { title: 'CHUNK', address: '1192 Folsom St, San Francisco' };

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
  const failEvent = { title: 'CHUNK', address: '1192 Folsom St, San Francisco' };
  await withCapturedConsole(() =>
    normalizer.normalizeAsync(failEvent, failAdapter, { geocodeVerification: { mode: 'report' } })
  );
  assert.equal(failEvent.location, '37.7752000, -122.4180000', 'report mode still keeps the suspect pin');
  assert.equal(failEvent._geocodeCrossCheck, 'fail');
  assert.equal(failEvent._geocodeGrade, 'exact');

  const streetNormalizer = createOsmNormalizer();
  streetNormalizer.delayForRateLimit = async () => {};
  const streetAdapter = createRoutedStubAdapter([['nominatim', [FOLSOM_STREET_ONLY_RESULT]]]);
  const streetEvent = { title: 'CHUNK', address: '1192 Folsom St, San Francisco' };
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
  const event = { title: 'CHUNK', address: '1192 Folsom St, San Francisco' };

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
  const event = { title: 'CHUNK', address: '1192 Folsom St, San Francisco' };

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

// ---------------------------------------------------------------------------
// Geo-provenance: pinSource / addressSource stamping across the normalizers
// (page → curated → geocoded-* → inferred).
// ---------------------------------------------------------------------------

function createBasicNormalizer() {
  const core = new SharedCore(CITIES, { eventSchema: EventSchema });
  return new BasicDataNormalizer(core);
}

test('BasicDataNormalizer stamps page provenance for coordinates and address that arrived from the parser', () => {
  const normalizer = createBasicNormalizer();
  const event = { title: 'PAGE PIN', city: 'nyc', location: '40.7128, -74.006', address: '123 W 4th St' };

  normalizer.normalize(event);

  assert.equal(event.pinSource, 'page', 'a coordinate pair on the event → pinSource page');
  assert.equal(event.addressSource, 'page', 'a non-empty address on the event → addressSource page');
});

test('BasicDataNormalizer leaves sources absent when the corresponding value is absent', () => {
  const normalizer = createBasicNormalizer();
  const noPin = { title: 'NO PIN', city: 'nyc', address: '123 W 4th St' };
  normalizer.normalize(noPin);
  assert.equal(noPin.pinSource, undefined, 'no coordinates → no pinSource');
  assert.equal(noPin.addressSource, 'page');

  const noAddress = { title: 'NO ADDR', city: 'nyc', location: '40.7128, -74.006' };
  normalizer.normalize(noAddress);
  assert.equal(noAddress.pinSource, 'page');
  assert.equal(noAddress.addressSource, undefined, 'no address → no addressSource');

  const textLocation = { title: 'TEXT LOC', city: 'nyc', location: 'somewhere downtown' };
  normalizer.normalize(textLocation);
  assert.equal(textLocation.pinSource, undefined, 'a non-coordinate location is not a page pin');
});

test('BasicDataNormalizer never overwrites a source that is already set', () => {
  const normalizer = createBasicNormalizer();
  const event = {
    title: 'ALREADY SOURCED', city: 'nyc', location: '40.7128, -74.006', address: '123 W 4th St',
    pinSource: 'curated', addressSource: 'curated'
  };
  normalizer.normalize(event);
  assert.equal(event.pinSource, 'curated');
  assert.equal(event.addressSource, 'curated');
});

function createBarNormalizerWithBar() {
  const core = new SharedCore(CITIES, {
    eventSchema: EventSchema,
    bars: {
      nyc: [
        {
          name: 'The Eagle NYC',
          address: '554 W 28th St, New York, NY 10001',
          coordinates: '40.7506, -74.0035',
          googleMaps: 'https://maps.example/eagle'
        }
      ]
    }
  });
  return new BarDataNormalizer(core);
}

test('BarDataNormalizer stamps curated provenance when a bar match fills location and address', () => {
  const normalizer = createBarNormalizerWithBar();
  const event = { title: 'Bear Night', city: 'nyc', bar: 'The Eagle NYC' };

  normalizer.normalize(event);

  assert.equal(event.location, '40.7506, -74.0035');
  assert.equal(event.pinSource, 'curated', 'bar coordinates → pinSource curated');
  assert.equal(event.address, '554 W 28th St, New York, NY 10001');
  assert.equal(event.addressSource, 'curated', 'bar address → addressSource curated');
});

test('BarDataNormalizer does not stamp curated for a value it did not write', () => {
  const normalizer = createBarNormalizerWithBar();
  // Event already has coordinates → bar coordinates are not applied, so pinSource stays as-is.
  const event = { title: 'Bear Night', city: 'nyc', bar: 'The Eagle NYC', location: '41.0, -73.0', pinSource: 'page' };

  normalizer.normalize(event);

  assert.equal(event.location, '41.0, -73.0', 'existing pin is kept');
  assert.equal(event.pinSource, 'page', 'pinSource is untouched when bar coordinates are not applied');
  // Bar address fills a missing one → address (and its source) do get written.
  assert.equal(event.addressSource, 'curated');
});

// ---------------------------------------------------------------------------
// District-to-curated address upgrade rung (Aqua Emporio / Torremolinos)
// ---------------------------------------------------------------------------

const TORREMOLINOS_CITIES = {
  torremolinos: { timezone: 'Europe/Madrid', patterns: ['torremolinos'] }
};

const AQUA_EMPORIO_CURATED = {
  name: 'Aqua Emporio',
  city: 'torremolinos',
  address: 'Calle Danza Invisible, La Nogalera 710, 29620 Torremolinos',
  coordinates: '36.6218328, -4.4982728',
  website: 'https://aquatorremolinos.com',
  instagram: 'https://www.instagram.com/aquatorremolinos'
};

// A second curated bar in the SAME compact district — its address also
// contains "La Nogalera", so these tests prove containment is only ever
// checked against the ONE bar the event's bar name matches.
const EDEN_CURATED = {
  name: 'Eden',
  city: 'torremolinos',
  address: 'Plaza La Nogalera 12, 29620 Torremolinos'
};

function createTorremolinosBarNormalizer(bars = [AQUA_EMPORIO_CURATED]) {
  const core = new SharedCore(TORREMOLINOS_CITIES, {
    eventSchema: EventSchema,
    bars: { torremolinos: bars }
  });
  return new BarDataNormalizer(core);
}

function captureConsoleLog(fn) {
  const lines = [];
  const originalLog = console.log;
  console.log = (message) => { lines.push(String(message)); };
  try { fn(); } finally { console.log = originalLog; }
  return lines;
}

test('district upgrade rung: the Mad.Bear shape upgrades "LA NOGALERA" to the curated street address', () => {
  const normalizer = createTorremolinosBarNormalizer();
  const event = {
    title: 'FURBALL MAD.BEAR',
    city: 'torremolinos',
    bar: 'AQUA EMPORIO',
    address: 'LA NOGALERA',
    addressSource: 'page'
  };

  const lines = captureConsoleLog(() => normalizer.normalize(event));

  assert.equal(event.address, 'Calle Danza Invisible, La Nogalera 710, 29620 Torremolinos',
    'the district fragment is upgraded to the curated street address');
  assert.equal(event.addressSource, 'curated', 'the upgrade stamps addressSource curated');
  assert.ok(lines.includes(
    '🗺️ GEOCODE VERIFY: "FURBALL MAD.BEAR" upgraded district address "LA NOGALERA" to curated bar address "Calle Danza Invisible, La Nogalera 710, 29620 Torremolinos" (bar: Aqua Emporio)'
  ), `upgrade log line expected, got: ${JSON.stringify(lines)}`);
});

test('district upgrade rung: curated pin adoption still fires for the Mad.Bear shape (regression)', () => {
  const normalizer = createTorremolinosBarNormalizer();
  const event = { title: 'FURBALL MAD.BEAR', city: 'torremolinos', bar: 'AQUA EMPORIO', address: 'LA NOGALERA' };

  captureConsoleLog(() => normalizer.normalize(event));

  assert.equal(event.location, '36.6218328, -4.4982728', 'curated coordinates adopted for the pinless event');
  assert.equal(event.pinSource, 'curated');
  assert.equal(event.instagram, 'https://www.instagram.com/aquatorremolinos', 'curated instagram fills the blank');
});

test('bar casing: an already-set bar that strictly matches a curated bar is canonicalized to the curated display name', () => {
  const normalizer = createTorremolinosBarNormalizer();
  const event = { title: 'FURBALL MAD.BEAR', city: 'torremolinos', bar: 'AQUA EMPORIO', address: 'LA NOGALERA' };

  const lines = captureConsoleLog(() => normalizer.normalize(event));

  // Run 20260725-210227 shipped "MASSIVE" and "Massive" for the same venue.
  // BarDataNormalizer now canonicalizes a PRESENT bar to the curated display
  // name whenever it matches by strict normalizeBarNameKey equality, so every
  // event at a curated venue shows the curated spelling/casing.
  assert.equal(event.bar, 'Aqua Emporio');
  assert.ok(lines.includes(
    '🐻 BarDataNormalizer: Canonicalized bar name "AQUA EMPORIO" → "Aqua Emporio" (curated)'
  ), `canonicalization log line expected, got: ${JSON.stringify(lines)}`);
});

// ---------------------------------------------------------------------------
// Curated bar-name canonicalization (run 20260725-210227: "MASSIVE" from
// BEARRACUDA: Seattle vs "Massive" from Treasure Trail Seattle — same venue,
// two spellings on the site)
// ---------------------------------------------------------------------------

function createSeattleBarNormalizer() {
  const core = new SharedCore(
    { seattle: { timezone: 'America/Los_Angeles', patterns: ['seattle'] } },
    {
      eventSchema: EventSchema,
      bars: { seattle: [{ name: 'Massive', address: '619 E Pine St, Seattle, WA 98122' }] }
    }
  );
  return new BarDataNormalizer(core);
}

test('bar canonicalization: MASSIVE is rewritten to the curated display name Massive', () => {
  const normalizer = createSeattleBarNormalizer();
  const event = { title: 'BEARRACUDA: Seattle', city: 'seattle', bar: 'MASSIVE' };

  const lines = captureConsoleLog(() => normalizer.normalize(event));

  assert.equal(event.bar, 'Massive');
  assert.ok(lines.includes(
    '🐻 BarDataNormalizer: Canonicalized bar name "MASSIVE" → "Massive" (curated)'
  ), `canonicalization log line expected, got: ${JSON.stringify(lines)}`);
});

test('bar canonicalization: "Massive Club" is NOT rewritten — strict full-name equality only, never substring', () => {
  const normalizer = createSeattleBarNormalizer();
  const event = { title: 'Some Party', city: 'seattle', bar: 'Massive Club' };

  const lines = captureConsoleLog(() => normalizer.normalize(event));

  assert.equal(event.bar, 'Massive Club', '"Massive Club" ≠ "Massive" under the #1536/#1537 contract');
  assert.ok(!lines.some(line => line.includes('Canonicalized bar name')),
    `no canonicalization log expected, got: ${JSON.stringify(lines)}`);
});

test('bar canonicalization: an uncurated bar is never touched', () => {
  const normalizer = createSeattleBarNormalizer();
  const event = { title: 'Warehouse Party', city: 'seattle', bar: 'KREMWERK' };

  const lines = captureConsoleLog(() => normalizer.normalize(event));

  assert.equal(event.bar, 'KREMWERK');
  assert.ok(!lines.some(line => line.includes('Canonicalized bar name')),
    `no canonicalization log expected, got: ${JSON.stringify(lines)}`);
});

test('district upgrade rung: an address already identical to curated is a no-op', () => {
  const normalizer = createTorremolinosBarNormalizer();
  const event = {
    title: 'FURBALL MAD.BEAR',
    city: 'torremolinos',
    bar: 'AQUA EMPORIO',
    address: 'Calle Danza Invisible, La Nogalera 710, 29620 Torremolinos',
    addressSource: 'page'
  };

  const lines = captureConsoleLog(() => normalizer.normalize(event));

  assert.equal(event.address, 'Calle Danza Invisible, La Nogalera 710, 29620 Torremolinos');
  assert.equal(event.addressSource, 'page', 'no upgrade happened, so the stamp is untouched');
  assert.ok(!lines.some(line => line.includes('upgraded district address')), 'identical address logs nothing');
});

test('district upgrade rung: a non-contained address is NEVER replaced (fail closed)', () => {
  const normalizer = createTorremolinosBarNormalizer();
  const event = {
    title: 'FURBALL MAD.BEAR',
    city: 'torremolinos',
    bar: 'AQUA EMPORIO',
    address: 'Calle Casablanca 5',
    addressSource: 'page'
  };

  const lines = captureConsoleLog(() => normalizer.normalize(event));

  assert.equal(event.address, 'Calle Casablanca 5',
    'a shorter but non-contained address may contradict curated data — it survives to the merge');
  assert.equal(event.addressSource, 'page');
  assert.ok(!lines.some(line => line.includes('upgraded district address')));
});

test('district upgrade rung: no curated match for the bar → no upgrade', () => {
  const normalizer = createTorremolinosBarNormalizer();
  const event = {
    title: 'FURBALL MAD.BEAR',
    city: 'torremolinos',
    bar: 'SOME RANDOM CLUB',
    address: 'LA NOGALERA',
    addressSource: 'page'
  };

  captureConsoleLog(() => normalizer.normalize(event));

  assert.equal(event.address, 'LA NOGALERA');
  assert.equal(event.addressSource, 'page');
});

test('district upgrade rung: missing or empty bar → no upgrade, even with multiple La Nogalera bars curated', () => {
  const normalizer = createTorremolinosBarNormalizer([AQUA_EMPORIO_CURATED, EDEN_CURATED]);

  const noBar = { title: 'FURBALL MAD.BEAR', city: 'torremolinos', address: 'LA NOGALERA', addressSource: 'page' };
  captureConsoleLog(() => normalizer.normalize(noBar));
  assert.equal(noBar.address, 'LA NOGALERA', 'no bar → the district address is never compared to curated bars');
  assert.equal(noBar.addressSource, 'page');

  const emptyBar = { title: 'FURBALL MAD.BEAR', city: 'torremolinos', bar: '   ', address: 'LA NOGALERA', addressSource: 'page' };
  captureConsoleLog(() => normalizer.normalize(emptyBar));
  assert.equal(emptyBar.address, 'LA NOGALERA');
  assert.equal(emptyBar.addressSource, 'page');
});

test('district upgrade rung: containment is keyed on the matched bar — each bar upgrades to ITS OWN address', () => {
  const normalizer = createTorremolinosBarNormalizer([AQUA_EMPORIO_CURATED, EDEN_CURATED]);

  const aquaEvent = { title: 'FURBALL MAD.BEAR', city: 'torremolinos', bar: 'AQUA EMPORIO', address: 'LA NOGALERA' };
  captureConsoleLog(() => normalizer.normalize(aquaEvent));
  assert.equal(aquaEvent.address, 'Calle Danza Invisible, La Nogalera 710, 29620 Torremolinos',
    'AQUA EMPORIO upgrades to Aqua Emporio\'s address, never Eden\'s');
  assert.equal(aquaEvent.addressSource, 'curated');

  const edenEvent = { title: 'GARDEN PARTY', city: 'torremolinos', bar: 'EDEN', address: 'LA NOGALERA' };
  const edenLines = captureConsoleLog(() => normalizer.normalize(edenEvent));
  assert.equal(edenEvent.address, 'Plaza La Nogalera 12, 29620 Torremolinos',
    'EDEN upgrades to Eden\'s address, never Aqua Emporio\'s');
  assert.equal(edenEvent.addressSource, 'curated');
  assert.ok(edenLines.includes(
    '🗺️ GEOCODE VERIFY: "GARDEN PARTY" upgraded district address "LA NOGALERA" to curated bar address "Plaza La Nogalera 12, 29620 Torremolinos" (bar: Eden)'
  ), `Eden upgrade log expected, got: ${JSON.stringify(edenLines)}`);
});

// Nominatim result with a house number → grade 'exact'. Coordinates sit within
// the Portland acceptance radius so distance ranking keeps it.
const PORTLAND_EXACT_RESULT = {
  lat: '45.5230622',
  lon: '-122.6564816',
  display_name: '722, East Burnside Street, Portland, Multnomah County, Oregon, 97214, United States',
  class: 'place',
  type: 'house',
  address: { house_number: '722', road: 'East Burnside Street', city: 'Portland', county: 'Multnomah County', state: 'Oregon' }
};

test('OpenStreetMapNormalizer forward geocode of an exact-grade result → pinSource geocoded-exact', async () => {
  const normalizer = createOsmNormalizerWithCoords();
  const httpAdapter = createStubHttpAdapter([PORTLAND_EXACT_RESULT]);
  const event = { title: 'EXACT PIN', address: '722 E Burnside', city: 'portland' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.location, '45.5230622, -122.6564816');
  assert.equal(event.pinSource, 'geocoded-exact', 'exact grade + non-failed cross-check → geocoded-exact');
});

test('OpenStreetMapNormalizer forward geocode of a street-grade result → pinSource geocoded-approx', async () => {
  const normalizer = createOsmNormalizerWithCoords();
  // PORTLAND_RESULT carries no house number → street grade.
  const httpAdapter = createStubHttpAdapter([PORTLAND_RESULT]);
  const event = { title: 'STREET PIN', address: '722 E Burnside', city: 'portland' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.location, '45.5230622, -122.6564816');
  assert.equal(event.pinSource, 'geocoded-approx', 'street/photon/census-grade → geocoded-approx');
});

test('OpenStreetMapNormalizer reverse geocode of a pin without an address → addressSource inferred', async () => {
  const normalizer = createOsmNormalizer();
  const httpAdapter = {
    requests: [],
    fetchData: async (url) => {
      httpAdapter.requests.push(url);
      return JSON.stringify({ display_name: '350 5th Ave, New York, NY 10118, USA' });
    }
  };
  const event = { title: 'REVERSE ADDR', location: '40.748817, -73.985428' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.address, '350 5th Ave, New York, NY 10118, USA');
  assert.equal(event.addressSource, 'inferred', 'reverse-geocoded address → addressSource inferred');
});

// ---------------------------------------------------------------------------
// Geo-POI bar corroboration (bar corroboration phase 3): POI names harvested
// from geocoder responses the pipeline ALREADY fetches (Nominatim forward
// results, Apple reverse placemarks) vouch for the event's bar. Zero new
// network calls — every test below asserts the request counts stay exactly
// what the geocode ladder spent before this feature existed.
// ---------------------------------------------------------------------------

// Venue hit with the explicit name field (modern Nominatim json output).
const MASSIVE_POI_RESULT = {
  lat: '47.6152000',
  lon: '-122.3204000',
  class: 'amenity',
  type: 'nightclub',
  addresstype: 'amenity',
  name: 'Massive',
  display_name: 'Massive, 619, East Pine Street, Seattle, King County, Washington, 98122, United States',
  address: { house_number: '619', road: 'East Pine Street', city: 'Seattle' }
};

// The same address as a bare-address hit: exact grade (house number) but the
// leading display_name component is the house number — never a POI name.
const PINE_STREET_ADDRESS_RESULT = {
  lat: '47.6152000',
  lon: '-122.3204000',
  class: 'place',
  type: 'house',
  addresstype: 'place',
  display_name: '619, East Pine Street, Seattle, King County, Washington, 98122, United States',
  address: { house_number: '619', road: 'East Pine Street', city: 'Seattle' }
};

test('geo-POI harvest: extractNominatimPoiName prefers name, falls back to a non-numeric display_name lead', () => {
  const normalizer = createOsmNormalizer();
  // Explicit name field wins
  assert.equal(normalizer.extractNominatimPoiName(MASSIVE_POI_RESULT), 'Massive');
  // namedetails.name serves when the top-level name is absent
  assert.equal(
    normalizer.extractNominatimPoiName({ namedetails: { name: 'Massive' }, display_name: '619, East Pine Street' }),
    'Massive'
  );
  // Venue-led display_name (no name field — cached/older responses)
  assert.equal(normalizer.extractNominatimPoiName(POWERHOUSE_POI_RESULT), 'Powerhouse');
  // Bare-address display_name: numeric first component is a house number, not a POI
  assert.equal(normalizer.extractNominatimPoiName(PINE_STREET_ADDRESS_RESULT), '');
  // Garbage shapes fail open
  assert.equal(normalizer.extractNominatimPoiName(null), '');
  assert.equal(normalizer.extractNominatimPoiName({}), '');
});

test('geo-POI harvest: extractPlacemarkPoiNames takes name + areasOfInterest, skips address-shaped names', () => {
  const normalizer = createOsmNormalizer();
  assert.deepEqual(
    normalizer.extractPlacemarkPoiNames({ ...FOLSOM_PLACEMARK, name: 'Powerhouse', areasOfInterest: ['SoMa'] }),
    ['Powerhouse', 'SoMa']
  );
  // Apple sets name to the address line when it knows no POI at the point
  assert.deepEqual(
    normalizer.extractPlacemarkPoiNames({ ...FOLSOM_PLACEMARK, name: '1192 Folsom St' }),
    []
  );
  // …or to the bare street name for street-level hits
  assert.deepEqual(
    normalizer.extractPlacemarkPoiNames({ ...FOLSOM_PLACEMARK, name: 'Folsom Street' }),
    []
  );
  // Cached placemarks from before harvesting simply lack the fields → fail open
  assert.deepEqual(normalizer.extractPlacemarkPoiNames(FOLSOM_PLACEMARK), []);
  assert.deepEqual(normalizer.extractPlacemarkPoiNames(null), []);
});

test('geo-POI matching: full-name equality with symmetric generic-suffix stripping, never substrings', () => {
  const normalizer = createOsmNormalizer();
  assert.equal(normalizer.poiNameMatchesBar('Massive', 'MASSIVE'), true, 'case-insensitive');
  assert.equal(normalizer.poiNameMatchesBar('Massive Nightclub', 'Massive'), true, 'generic suffix strips');
  assert.equal(normalizer.poiNameMatchesBar('Massive', 'Massive Nightclub'), true, 'suffix strips symmetrically');
  assert.equal(normalizer.poiNameMatchesBar('Massive Night Club', 'Massive'), true, 'two-token "night club" form');
  assert.equal(normalizer.poiNameMatchesBar('Heretic', 'The Heretic'), true, 'leading "the" drops on either side');
  assert.equal(normalizer.poiNameMatchesBar('The Eagle', 'Eagle'), true);
  assert.equal(normalizer.poiNameMatchesBar('Eagle Creek Cafe', 'Eagle'), false, 'no prefix/substring matching');
  assert.equal(normalizer.poiNameMatchesBar('Massive Nightclub', 'Mass'), false, 'stripped remainder must match exactly');
  assert.equal(normalizer.poiNameMatchesBar('Nightclub', 'Massive'), false, 'suffix never strips to empty');
  assert.equal(normalizer.poiNameMatchesBar('', 'Massive'), false);
  assert.equal(normalizer.poiNameMatchesBar('Massive', ''), false);
});

test('geo-POI corroboration: an uncorroborated bar upgrades to geo-poi with the corroboration log, one request only', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter([['nominatim', [MASSIVE_POI_RESULT]]]);
  const event = { title: 'BEARRACUDA', address: '619 E Pine St, Seattle', bar: 'MASSIVE', barSource: 'uncorroborated' };

  const lines = await withCapturedConsole(() => normalizer.normalizeAsync(event, httpAdapter));

  assert.equal(event.location, '47.6152000, -122.3204000');
  assert.equal(event.barSource, 'geo-poi', 'uncorroborated upgrades to geo-poi');
  assert.ok(
    lines.includes('🗺️ GEOCODE VERIFY: "BEARRACUDA" bar "MASSIVE" corroborated by map POI "Massive"'),
    `the corroboration log must emit verbatim: ${lines.join(' | ')}`
  );
  assert.equal(httpAdapter.requests.length, 1, 'harvesting spends ZERO requests beyond the geocode itself');
});

test('geo-POI corroboration: an unstamped bar upgrades via the venue-led display_name (no name field)', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter([['nominatim', [POWERHOUSE_POI_RESULT]]]);
  const event = { title: 'CHUNK', address: '1192 Folsom St, San Francisco', bar: 'The Powerhouse' };

  const lines = await withCapturedConsole(() => normalizer.normalizeAsync(event, httpAdapter));

  assert.equal(event.barSource, 'geo-poi', 'unstamped bars are upgradeable too');
  assert.ok(
    lines.includes('🗺️ GEOCODE VERIFY: "CHUNK" bar "The Powerhouse" corroborated by map POI "Powerhouse"'),
    `display_name-harvested POI corroborates: ${lines.join(' | ')}`
  );
  assert.equal(httpAdapter.requests.length, 1);
});

test('geo-POI corroboration: curated/venue-site/page-adjacent stamps are never overwritten', async () => {
  for (const stamp of ['curated', 'venue-site', 'page-adjacent']) {
    const normalizer = createOsmNormalizer();
    normalizer.delayForRateLimit = async () => {};
    const httpAdapter = createRoutedStubAdapter([['nominatim', [MASSIVE_POI_RESULT]]]);
    const event = { title: 'BEARRACUDA', address: '619 E Pine St, Seattle', bar: 'Massive', barSource: stamp };

    const lines = await withCapturedConsole(() => normalizer.normalizeAsync(event, httpAdapter));

    assert.equal(event.barSource, stamp, `${stamp} is equal-or-higher trust and must survive`);
    assert.ok(
      lines.some(l => l.includes('corroborated by map POI "Massive"')),
      `the corroboration is still logged additively for ${stamp}: ${lines.join(' | ')}`
    );
  }
});

test('geo-POI corroboration: POI ≠ uncorroborated bar flags a possible venue-name mismatch, value untouched', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter([['nominatim', [MASSIVE_POI_RESULT]]]);
  const event = { title: 'BEARRACUDA', address: '619 E Pine St, Seattle', bar: 'Neighbours', barSource: 'uncorroborated' };

  const lines = await withCapturedConsole(() => normalizer.normalizeAsync(event, httpAdapter));

  assert.equal(event.bar, 'Neighbours', 'flag-don\'t-drop: the value never changes');
  assert.equal(event.barSource, 'uncorroborated', 'a mismatch never restamps');
  assert.ok(
    lines.includes('🗺️ GEOCODE VERIFY: "BEARRACUDA" address POI is "Massive" but bar is "Neighbours" — possible venue-name mismatch'),
    `the mismatch flag must emit verbatim: ${lines.join(' | ')}`
  );

  // The same mismatch against a corroborated (or unstamped) bar stays silent
  for (const stamp of ['page-adjacent', undefined]) {
    const quietNormalizer = createOsmNormalizer();
    quietNormalizer.delayForRateLimit = async () => {};
    const quietAdapter = createRoutedStubAdapter([['nominatim', [MASSIVE_POI_RESULT]]]);
    const quietEvent = { title: 'BEARRACUDA', address: '619 E Pine St, Seattle', bar: 'Neighbours' };
    if (stamp) quietEvent.barSource = stamp;
    const quietLines = await withCapturedConsole(() => quietNormalizer.normalizeAsync(quietEvent, quietAdapter));
    assert.ok(
      !quietLines.some(l => l.includes('possible venue-name mismatch')),
      `the flag fires ONLY for uncorroborated bars (stamp=${stamp}): ${quietLines.join(' | ')}`
    );
    assert.equal(quietEvent.barSource, stamp, 'no restamping either way');
  }
});

test('geo-POI corroboration: bare-address hits and street-grade pins harvest nothing — fully inert', async () => {
  // Exact-grade bare-address hit: house-number lead is never a POI name
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter([['nominatim', [PINE_STREET_ADDRESS_RESULT]]]);
  const event = { title: 'BEARRACUDA', address: '619 E Pine St, Seattle', bar: 'Massive', barSource: 'uncorroborated' };
  const lines = await withCapturedConsole(() => normalizer.normalizeAsync(event, httpAdapter));
  assert.equal(event.location, '47.6152000, -122.3204000', 'the pin itself is unaffected');
  assert.equal(event.barSource, 'uncorroborated', 'no POI → no upgrade (fail open)');
  assert.ok(
    !lines.some(l => l.includes('map POI') || l.includes('venue-name mismatch')),
    `no corroboration lines without a POI: ${lines.join(' | ')}`
  );

  // Street-grade pin: the result's "name" is the street, never harvested
  const streetNormalizer = createOsmNormalizer();
  streetNormalizer.delayForRateLimit = async () => {};
  const streetAdapter = createRoutedStubAdapter([['nominatim', [FOLSOM_STREET_ONLY_RESULT]]]);
  const streetEvent = { title: 'CHUNK', address: 'Folsom St, San Francisco', bar: 'Folsom', barSource: 'uncorroborated' };
  const streetLines = await withCapturedConsole(() => streetNormalizer.normalizeAsync(streetEvent, streetAdapter));
  assert.equal(streetEvent.location, '37.7740000, -122.4120000');
  assert.equal(streetEvent.barSource, 'uncorroborated', 'a street name must never corroborate a bar');
  assert.ok(
    !streetLines.some(l => l.includes('map POI') || l.includes('venue-name mismatch')),
    `street-grade pins are inert: ${streetLines.join(' | ')}`
  );

  // No pin at all → nothing runs
  const unpinnedNormalizer = createOsmNormalizer();
  unpinnedNormalizer.delayForRateLimit = async () => {};
  const unpinnedAdapter = createRoutedStubAdapter([['nominatim', []]]);
  const unpinnedEvent = { title: 'CHUNK', address: '1192 Folsom St, San Francisco', bar: 'Powerhouse', barSource: 'uncorroborated' };
  const unpinnedLines = await withCapturedConsole(() => unpinnedNormalizer.normalizeAsync(unpinnedEvent, unpinnedAdapter));
  assert.equal(unpinnedEvent.location, undefined);
  assert.equal(unpinnedEvent.barSource, 'uncorroborated');
  assert.ok(!unpinnedLines.some(l => l.includes('map POI') || l.includes('venue-name mismatch')));
});

test('geo-POI corroboration: the Apple reverse placemark corroborates when the forward hit is address-only', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  let reverseCalls = 0;
  // Bare-address forward hit (no POI) + the cross-check placemark Apple
  // already returns naming the venue at the point.
  const httpAdapter = createRoutedStubAdapter(
    [['nominatim', [{
      ...PINE_STREET_ADDRESS_RESULT,
      lat: '37.7756941',
      lon: '-122.4103049',
      display_name: '1192, Folsom Street, San Francisco, California, 94103, United States',
      address: { house_number: '1192', road: 'Folsom Street', city: 'San Francisco' }
    }]]],
    {
      reverseGeocodePlacemark: async () => {
        reverseCalls += 1;
        return { ...FOLSOM_PLACEMARK, name: 'Powerhouse', areasOfInterest: ['SoMa'] };
      }
    }
  );
  const event = { title: 'CHUNK', address: '1192 Folsom St, San Francisco', bar: 'Powerhouse', barSource: 'uncorroborated' };

  const lines = await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'report' } })
  );

  assert.equal(event.location, '37.7756941, -122.4103049');
  assert.equal(event.barSource, 'geo-poi', 'the placemark name corroborates the bar');
  assert.ok(
    lines.includes('🗺️ GEOCODE VERIFY: "CHUNK" bar "Powerhouse" corroborated by map POI "Powerhouse"'),
    `Apple-harvested POI corroborates: ${lines.join(' | ')}`
  );
  assert.equal(httpAdapter.requests.length, 1, 'one forward geocode fetch, exactly as before');
  assert.equal(reverseCalls, 1, 'the SAME single cross-check reverse call — harvesting adds none');

  // A pre-harvest cached placemark (no name field) fails open: pin accepted,
  // no corroboration, no mismatch flag.
  const staleNormalizer = createOsmNormalizer();
  staleNormalizer.delayForRateLimit = async () => {};
  const staleAdapter = createRoutedStubAdapter(
    [['nominatim', [POWERHOUSE_POI_RESULT]]],
    { reverseGeocodePlacemark: async () => FOLSOM_PLACEMARK }
  );
  const staleEvent = { title: 'CHUNK', address: '1192 Folsom St, San Francisco', bar: 'Some Other Bar', barSource: 'uncorroborated' };
  const staleLines = await withCapturedConsole(() =>
    staleNormalizer.normalizeAsync(staleEvent, staleAdapter, { geocodeVerification: { mode: 'report' } })
  );
  assert.equal(staleEvent.location, '37.7756941, -122.4103049');
  // POWERHOUSE_POI_RESULT still names the venue, so the mismatch flag comes
  // from the forward harvest — but the nameless placemark contributed nothing.
  assert.ok(
    staleLines.includes('🗺️ GEOCODE VERIFY: "CHUNK" address POI is "Powerhouse" but bar is "Some Other Bar" — possible venue-name mismatch'),
    `forward POI still flags; the stale placemark stays silent: ${staleLines.join(' | ')}`
  );
});

test('geo-POI harvest stashes _geoPoiName/_geoPoiBarMatch on the event for the evidence panel', async () => {
  // Matching POI: the stashed name is the one that matched the bar and the
  // verdict comes from the existing poiNameMatchesBar at harvest time.
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter([['nominatim', [MASSIVE_POI_RESULT]]]);
  const event = { title: 'BEARRACUDA', address: '619 E Pine St, Seattle', bar: 'MASSIVE', barSource: 'uncorroborated' };
  await withCapturedConsole(() => normalizer.normalizeAsync(event, httpAdapter));
  assert.equal(event._geoPoiName, 'Massive', 'harvested POI name stashed (underscore — never serialized)');
  assert.equal(event._geoPoiBarMatch, true, 'match verdict stashed alongside');

  // Differing POI: first harvested name stashed with a false verdict.
  const mismatchNormalizer = createOsmNormalizer();
  mismatchNormalizer.delayForRateLimit = async () => {};
  const mismatchAdapter = createRoutedStubAdapter([['nominatim', [MASSIVE_POI_RESULT]]]);
  const mismatchEvent = { title: 'BEARRACUDA', address: '619 E Pine St, Seattle', bar: 'Neighbours', barSource: 'uncorroborated' };
  await withCapturedConsole(() => mismatchNormalizer.normalizeAsync(mismatchEvent, mismatchAdapter));
  assert.equal(mismatchEvent._geoPoiName, 'Massive');
  assert.equal(mismatchEvent._geoPoiBarMatch, false);

  // No bar on the event: the POI name still lands, but no verdict either way.
  const noBarNormalizer = createOsmNormalizer();
  noBarNormalizer.delayForRateLimit = async () => {};
  const noBarAdapter = createRoutedStubAdapter([['nominatim', [MASSIVE_POI_RESULT]]]);
  const noBarEvent = { title: 'BEARRACUDA', address: '619 E Pine St, Seattle' };
  await withCapturedConsole(() => noBarNormalizer.normalizeAsync(noBarEvent, noBarAdapter));
  assert.equal(noBarEvent._geoPoiName, 'Massive');
  assert.ok(!('_geoPoiBarMatch' in noBarEvent), 'no bar → no verdict field');

  // No POI harvested (bare-address hit): neither field appears (fail open —
  // cached/skipped geocodes without a POI render no evidence line).
  const inertNormalizer = createOsmNormalizer();
  inertNormalizer.delayForRateLimit = async () => {};
  const inertAdapter = createRoutedStubAdapter([['nominatim', [PINE_STREET_ADDRESS_RESULT]]]);
  const inertEvent = { title: 'BEARRACUDA', address: '619 E Pine St, Seattle', bar: 'Massive', barSource: 'uncorroborated' };
  await withCapturedConsole(() => inertNormalizer.normalizeAsync(inertEvent, inertAdapter));
  assert.ok(!('_geoPoiName' in inertEvent), 'no harvest → no stash');
  assert.ok(!('_geoPoiBarMatch' in inertEvent));
});

// === run 20260723-123149: resolved cities must never contaminate the persisted address ===

test('LocationNormalizer never persists a resolved city into the address; the maps QUERY still gets it', () => {
  // Mirror production nyc patterns: "manhattan" is the longest pattern, which
  // is exactly how "LA NOGALERA" was stored as "LA NOGALERA, Manhattan".
  const core = new SharedCore(
    { nyc: { timezone: 'America/New_York', patterns: ['new york', 'nyc', 'manhattan'] } },
    { eventSchema: EventSchema }
  );
  const normalizer = new LocationNormalizer(core);
  const event = { title: 'FURBALL MAD.BEAR', city: 'nyc', address: 'LA NOGALERA' };

  normalizer.normalize(event);

  assert.equal(event.address, 'LA NOGALERA', 'persisted address must stay exactly as extracted');
  assert.ok(!String(event.address).includes('Manhattan'), 'regression: no ", Manhattan" appended');
  // Query-time decoration is still allowed: the generated maps link may use the
  // city-anchored variant of the incomplete address.
  assert.ok(String(event.gmaps || '').includes(encodeURIComponent('LA NOGALERA, Manhattan')),
    `maps query keeps city anchoring, got: ${event.gmaps}`);
});

test('LocationNormalizer leaves complete addresses and their maps links untouched', () => {
  const core = new SharedCore(
    { nyc: { timezone: 'America/New_York', patterns: ['new york', 'nyc', 'manhattan'] } },
    { eventSchema: EventSchema }
  );
  const normalizer = new LocationNormalizer(core);
  const event = { title: 'UNDERBEAR', city: 'nyc', address: '125 Christopher St, New York, NY 10014' };

  normalizer.normalize(event);

  assert.equal(event.address, '125 Christopher St, New York, NY 10014');
  assert.ok(String(event.gmaps || '').includes(encodeURIComponent('125 Christopher St, New York, NY 10014')));
});

// ---------------------------------------------------------------------------
// Venue-POI adoption + fusion detection (run 20260723-140457: "FURBALL Boston"
// lost its address to the plausibility gate — bar "Legacy" resolves exactly on
// the map; "FURBALL MAD.BEAR" fused AQUA + EMPORIO into a nonexistent venue)
// ---------------------------------------------------------------------------

const CITIES_WITH_BOSTON = {
  boston: {
    timezone: 'America/New_York',
    patterns: ['boston'],
    coordinates: { lat: 42.3601, lng: -71.0589 }
  }
};

const CITIES_WITH_TORREMOLINOS = {
  torremolinos: {
    timezone: 'Europe/Madrid',
    patterns: ['torremolinos'],
    coordinates: { lat: 36.6203, lng: -4.4998 }
  }
};

function createOsmNormalizerFor(cities) {
  const core = new SharedCore(cities, { eventSchema: EventSchema });
  const normalizer = new OpenStreetMapNormalizer(core);
  normalizer.delayForRateLimit = async () => {};
  return normalizer;
}

function captureConsole(fn) {
  const lines = [];
  const original = { log: console.log, warn: console.warn };
  console.log = (...args) => { lines.push(args.join(' ')); };
  console.warn = (...args) => { lines.push(args.join(' ')); };
  const restore = () => { console.log = original.log; console.warn = original.warn; };
  return { lines, restore };
}

// Nightclub "Legacy", 79 Warrenton Street, Boston — exact-grade venue hit.
const LEGACY_NIGHTCLUB_RESULT = {
  lat: '42.3499',
  lon: '-71.0648',
  class: 'amenity',
  type: 'nightclub',
  addresstype: 'amenity',
  name: 'Legacy',
  display_name: 'Legacy, 79, Warrenton Street, Boston, Suffolk County, Massachusetts, 02116, United States',
  address: { house_number: '79', road: 'Warrenton Street', city: 'Boston', state: 'Massachusetts' }
};

test('venue-POI adoption: a bar with no address gains pin + street address from a bar-matching map POI', async () => {
  const normalizer = createOsmNormalizerFor(CITIES_WITH_BOSTON);
  const httpAdapter = createSequencedStubAdapter([[LEGACY_NIGHTCLUB_RESULT]]);
  const event = { title: 'FURBALL Boston', bar: 'Legacy', city: 'boston' };

  const captured = captureConsole(() => {});
  try {
    await normalizer.normalizeAsync(event, httpAdapter);
  } finally {
    captured.restore();
  }

  assert.equal(httpAdapter.requests.length, 1, 'exactly one venue+city Nominatim request');
  assert.equal(decodeQueryParam(httpAdapter.requests[0]), 'Legacy, boston');
  assert.ok(httpAdapter.requests[0].includes('&addressdetails=1'), 'the venue rescue request carries addressdetails');
  assert.equal(event.location, '42.3499, -71.0648', 'the POI-matching hit pins the event');
  assert.equal(event.pinSource, 'geocoded-exact', 'exact grade rules apply as today');
  assert.equal(event.address, '79 Warrenton Street, Boston, Massachusetts', 'street address assembled from addressdetails');
  assert.equal(event.addressSource, 'geo-poi', 'adopted address carries geo-poi provenance');
  assert.equal(event.barSource, 'geo-poi', 'the matching POI also corroborates the bar');
  assert.ok(
    captured.lines.some(line => line.includes('🗺️ GEOCODE VERIFY: "FURBALL Boston" adopted address "79 Warrenton Street, Boston, Massachusetts" from map POI "Legacy" (venue+city lookup)')),
    `adoption log expected, got:\n${captured.lines.join('\n')}`
  );
});

test('venue-POI adoption: a POI that does not match the bar is never adopted (no pin, no address)', async () => {
  const normalizer = createOsmNormalizerFor(CITIES_WITH_BOSTON);
  const otherVenue = { ...LEGACY_NIGHTCLUB_RESULT, name: 'The Alley Bar', display_name: 'The Alley Bar, 79, Warrenton Street, Boston' };
  const httpAdapter = createSequencedStubAdapter([[otherVenue]]);
  const event = { title: 'FURBALL Boston', bar: 'Legacy', city: 'boston' };

  const captured = captureConsole(() => {});
  try {
    await normalizer.normalizeAsync(event, httpAdapter);
  } finally {
    captured.restore();
  }

  assert.equal(event.location, undefined, 'a non-matching POI must not pin a no-address event');
  assert.equal(event.address, undefined, 'no address is adopted from a non-matching POI');
  assert.equal(event.addressSource, undefined);
});

test('venue-POI adoption: generic/administrative hits never adopt, even when the name matches', async () => {
  const normalizer = createOsmNormalizerFor(CITIES_WITH_BOSTON);
  const genericHit = {
    lat: '42.3601',
    lon: '-71.0589',
    class: 'place',
    type: 'locality',
    addresstype: 'locality',
    name: 'Legacy',
    display_name: 'Legacy, Boston, Massachusetts',
    address: { city: 'Boston', state: 'Massachusetts' }
  };
  const httpAdapter = createSequencedStubAdapter([[genericHit]]);
  const event = { title: 'FURBALL Boston', bar: 'Legacy', city: 'boston' };

  const captured = captureConsole(() => {});
  try {
    await normalizer.normalizeAsync(event, httpAdapter);
  } finally {
    captured.restore();
  }

  assert.equal(event.location, undefined, 'a place/locality hit never becomes a pin');
  assert.equal(event.address, undefined, 'a generic hit never supplies an address');
  assert.ok(
    captured.lines.some(line => line.includes('refused generic pin (locality)')),
    'the grade gate refusal stays visible'
  );
});

test('venue-POI adoption via the Photon rescue when Nominatim finds nothing', async () => {
  const normalizer = createOsmNormalizerFor(CITIES_WITH_BOSTON);
  const photonResponse = {
    features: [{
      geometry: { coordinates: [-71.0648, 42.3499] },
      properties: {
        name: 'Legacy',
        osm_key: 'amenity',
        osm_value: 'nightclub',
        housenumber: '79',
        street: 'Warrenton Street',
        city: 'Boston'
      }
    }]
  };
  const httpAdapter = createSequencedStubAdapter([[], photonResponse]);
  const event = { title: 'FURBALL Boston', bar: 'Legacy', city: 'boston' };

  const captured = captureConsole(() => {});
  try {
    await normalizer.normalizeAsync(event, httpAdapter);
  } finally {
    captured.restore();
  }

  assert.equal(httpAdapter.requests.length, 2, 'Nominatim venue rung then the Photon rescue');
  assert.ok(httpAdapter.requests[1].includes('photon.komoot.io'), 'second request is Photon');
  assert.equal(decodeQueryParam(httpAdapter.requests[1]), 'Legacy, boston', 'Photon queries the venue+city string when no address exists');
  assert.equal(event.location, '42.3499, -71.0648');
  assert.equal(event.pinSource, 'geocoded-exact');
  assert.equal(event.address, '79 Warrenton Street, Boston', 'address assembled from Photon street/housenumber/city');
  assert.equal(event.addressSource, 'geo-poi');
});

test('fusion detection: a POI matching only a bar-name prefix flags, never corrects', async () => {
  const normalizer = createOsmNormalizerFor(CITIES_WITH_TORREMOLINOS);
  // Aqua Club, ~200 m from Torremolinos center — exact-grade nightclub.
  const aquaClub = {
    lat: '36.6218328',
    lon: '-4.4982728',
    class: 'amenity',
    type: 'nightclub',
    addresstype: 'amenity',
    name: 'Aqua Club',
    display_name: 'Aqua Club, Calle Casablanca, Torremolinos, Málaga, Spain',
    address: { road: 'Calle Casablanca', town: 'Torremolinos' }
  };
  const httpAdapter = createSequencedStubAdapter([[aquaClub], {}]);
  const event = { title: 'FURBALL MAD.BEAR', bar: 'Aqua Emporio', city: 'torremolinos' };

  const captured = captureConsole(() => {});
  try {
    await normalizer.normalizeAsync(event, httpAdapter);
  } finally {
    captured.restore();
  }

  assert.equal(event.location, undefined, 'no auto-correction: the prefix match never pins');
  assert.equal(event.address, undefined, 'no address is adopted on a fusion flag');
  assert.deepEqual(event._geoPoiFusion, { poi: 'Aqua Club', prefix: 'Aqua' }, 'fusion evidence recorded for the results UI');
  assert.ok(
    captured.lines.some(line => line.includes('🗺️ GEOCODE VERIFY: "FURBALL MAD.BEAR" bar "Aqua Emporio" may fuse multiple venue names — map knows "Aqua Club" (matches "Aqua"); verify manually')),
    `fusion flag log expected, got:\n${captured.lines.join('\n')}`
  );
});

test('fusion detection unit rules: single-token bars and full matches never flag; short prefixes skip', () => {
  const normalizer = createOsmNormalizerFor(CITIES_WITH_TORREMOLINOS);

  const singleToken = { title: 'X', bar: 'Legacy' };
  normalizer.maybeFlagVenueNameFusion(singleToken, ['Legacy Creek Cafe'], {});
  assert.equal(singleToken._geoPoiFusion, undefined, 'single-token bars never flag');

  const fullMatch = { title: 'X', bar: 'Aqua Club' };
  normalizer.maybeFlagVenueNameFusion(fullMatch, ['Aqua Club'], {});
  assert.equal(fullMatch._geoPoiFusion, undefined, 'a full-name match never flags');

  const strippedFullMatch = { title: 'X', bar: 'Aqua Emporio' };
  normalizer.maybeFlagVenueNameFusion(strippedFullMatch, ['Aqua Emporio Nightclub'], {});
  assert.equal(strippedFullMatch._geoPoiFusion, undefined, 'generic-suffix full matches never flag');

  const shortPrefix = { title: 'X', bar: 'Le Grand Room' };
  normalizer.maybeFlagVenueNameFusion(shortPrefix, ['Le'], {});
  assert.equal(shortPrefix._geoPoiFusion, undefined, 'prefixes under 3 chars never flag');

  const flags = {};
  const flagged = { title: 'X', bar: 'Aqua Emporio' };
  const captured = captureConsole(() => {});
  try {
    normalizer.maybeFlagVenueNameFusion(flagged, ['Aqua Club'], flags);
    normalizer.maybeFlagVenueNameFusion(flagged, ['Aqua Club'], flags);
  } finally {
    captured.restore();
  }
  assert.deepEqual(flagged._geoPoiFusion, { poi: 'Aqua Club', prefix: 'Aqua' });
  assert.equal(captured.lines.filter(line => line.includes('may fuse multiple venue names')).length, 1, 'flags at most once per event');
});

test('Mad.Bear ladder regression: generic refusals stay refused and the vague address is never mutated', async () => {
  const normalizer = createOsmNormalizerFor(CITIES_WITH_TORREMOLINOS);
  // Query 1 ("LA NOGALERA, torremolinos"): the locality centroid — refused.
  const nogaleraLocality = {
    lat: '36.6225097',
    lon: '-4.4987054',
    class: 'place',
    type: 'locality',
    addresstype: 'locality',
    name: 'La Nogalera',
    display_name: 'La Nogalera, Torremolinos, Málaga, Spain',
    address: { town: 'Torremolinos', state: 'Andalusia' }
  };
  // Query 2 (venue rescue "Aqua Emporio, torremolinos"): nothing — the fused
  // venue does not exist. Query 3 (Photon, address): a hamlet — refused.
  const photonHamlet = {
    features: [{
      geometry: { coordinates: [-4.4987054, 36.6225097] },
      properties: { name: 'La Nogalera', osm_key: 'place', osm_value: 'hamlet' }
    }]
  };
  // Rung 1 is now the name-led query ("Aqua Emporio, LA NOGALERA,
  // torremolinos") — the fused venue does not exist, so it returns nothing.
  const httpAdapter = createSequencedStubAdapter([[], [nogaleraLocality], [], photonHamlet]);
  const event = { title: 'FURBALL MAD.BEAR', address: 'LA NOGALERA', city: 'torremolinos', bar: 'Aqua Emporio' };

  const captured = captureConsole(() => {});
  try {
    await normalizer.normalizeAsync(event, httpAdapter);
  } finally {
    captured.restore();
  }

  assert.equal(httpAdapter.requests.length, 5, 'name-led rung, address rung, venue rescue rung, Photon rescue, Photon venue follow-up');
  assert.equal(decodeQueryParam(httpAdapter.requests[0]), 'Aqua Emporio, LA NOGALERA, torremolinos', 'the name-led rung leads');
  assert.equal(decodeQueryParam(httpAdapter.requests[1]), 'LA NOGALERA, torremolinos', 'city anchoring stays QUERY-only');
  assert.equal(decodeQueryParam(httpAdapter.requests[2]), 'Aqua Emporio, torremolinos');
  assert.ok(
    httpAdapter.requests[4].includes('photon.komoot.io') && decodeQueryParam(httpAdapter.requests[4]) === 'Aqua Emporio, torremolinos',
    `the empty Nominatim venue rescue triggers the Photon venue follow-up: ${httpAdapter.requests[4]}`
  );
  assert.equal(event.address, 'LA NOGALERA', 'the persisted address is never mutated with the resolved city');
  assert.equal(event.location, undefined, 'generic locality/hamlet pins stay refused — no unstamped pin');
  assert.equal(event.pinSource, undefined, 'no pin means no pinSource stamp');
  assert.equal(event._geoPoiFusion, undefined, 'a coarse-only Photon follow-up never raises a fusion flag');
  assert.ok(
    captured.lines.some(line => line.includes('refused generic pin (locality) for address "LA NOGALERA"')),
    'the locality refusal stays visible'
  );
  assert.ok(
    captured.lines.some(line => line.includes('refused generic pin (hamlet) for address "LA NOGALERA"')),
    'the hamlet refusal stays visible'
  );
});

// ---------------------------------------------------------------------------
// POI-pin reverse cross-check tolerance (run 20260723-152928: "FURBALL
// Boston" adopted "79 Warrenton Street" from the Legacy POI, Apple reversed
// the same building as "75 Warrenton St", and the pin was vetoed by its own
// cross-check — the event ended with neither address nor pin). POI-adopted
// pins tolerate same-street house-number drift ≤ 20; different streets and
// larger gaps still refuse, and non-POI pins keep today's strict comparison.
// Vetoed adoptions keep the POI-vouched ADDRESS (unpinned, flagged).
// ---------------------------------------------------------------------------

// Apple reversing the same building Nominatim pinned: same street, house 75.
const WARRENTON_75_PLACEMARK = {
  subThoroughfare: '75',
  thoroughfare: 'Warrenton St',
  locality: 'Boston'
};

test('POI-pin tolerance: same-street house drift within 20 is accepted for an adopted pin (enforce)', async () => {
  const normalizer = createOsmNormalizerFor(CITIES_WITH_BOSTON);
  const httpAdapter = {
    ...createSequencedStubAdapter([[LEGACY_NIGHTCLUB_RESULT]]),
    reverseGeocodePlacemark: async () => WARRENTON_75_PLACEMARK,
    supportsReverseGeocode: () => true
  };
  const event = { title: 'FURBALL Boston', bar: 'Legacy', city: 'boston' };

  const captured = captureConsole(() => {});
  try {
    await normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'enforce' } });
  } finally {
    captured.restore();
  }

  assert.equal(event.location, '42.3499, -71.0648', 'the tolerance accepts the POI pin');
  assert.equal(event.address, '79 Warrenton Street, Boston, Massachusetts', 'the adopted address survives with the pin');
  assert.equal(event.addressSource, 'geo-poi', 'adopted address carries geo-poi provenance');
  assert.equal(event.pinSource, 'geocoded-exact', 'a tolerated cross-check is a pass — exact grade stamps geocoded-exact');
  assert.equal(event._geocodeCrossCheck, 'pass', 'the tolerated comparison records a pass verdict');
  assert.ok(
    captured.lines.some(line => line.includes('🗺️ GEOCODE VERIFY: "FURBALL Boston" POI pin reverse check: same street, house 75 vs 79 — accepted (provider interpolation tolerance)')),
    `tolerance log expected, got:\n${captured.lines.join('\n')}`
  );
  assert.ok(
    !captured.lines.some(line => line.includes('pin failed reverse cross-check')),
    'a tolerated pin is not logged as a cross-check failure'
  );
});

test('POI-pin tolerance: a different reverse street still refuses the pin, but the adopted address is kept unpinned', async () => {
  const normalizer = createOsmNormalizerFor(CITIES_WITH_BOSTON);
  const httpAdapter = {
    ...createSequencedStubAdapter([[LEGACY_NIGHTCLUB_RESULT], {}]),
    reverseGeocodePlacemark: async () => ({ subThoroughfare: '75', thoroughfare: 'Tremont St', locality: 'Boston' }),
    supportsReverseGeocode: () => true
  };
  const event = { title: 'FURBALL Boston', bar: 'Legacy', city: 'boston' };

  const captured = captureConsole(() => {});
  try {
    await normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'enforce' } });
  } finally {
    captured.restore();
  }

  assert.equal(event.location, undefined, 'a different-street reverse refuses the pin exactly as today');
  assert.equal(event.pinSource, undefined, 'no pin means no pinSource stamp');
  assert.equal(event.address, '79 Warrenton Street, Boston, Massachusetts', 'the POI-vouched address is NOT discarded with the pin');
  assert.equal(event.addressSource, 'geo-poi', 'the kept address stays stamped geo-poi');
  assert.equal(event._geocodeCrossCheck, 'fail', 'the rejection breadcrumb survives for the calendar reviewer');
  assert.ok(
    captured.lines.some(line => line.includes('pin failed reverse cross-check')),
    `the refusal stays visible: ${captured.lines.join('\n')}`
  );
  assert.ok(
    captured.lines.some(line => line.includes('🗺️ GEOCODE VERIFY: "FURBALL Boston" POI-adopted address "79 Warrenton Street, Boston, Massachusetts" kept without pin — reverse cross-check refused the pin (verify manually)')),
    `the kept-without-pin flag must be logged: ${captured.lines.join('\n')}`
  );
  assert.ok(
    !captured.lines.some(line => line.includes('provider interpolation tolerance')),
    'no tolerance log on a different street'
  );
});

test('POI-pin tolerance: a same-street gap over 20 still refuses the pin; the adopted address is kept unpinned', async () => {
  const normalizer = createOsmNormalizerFor(CITIES_WITH_BOSTON);
  const httpAdapter = {
    ...createSequencedStubAdapter([[LEGACY_NIGHTCLUB_RESULT], {}]),
    reverseGeocodePlacemark: async () => ({ subThoroughfare: '175', thoroughfare: 'Warrenton St', locality: 'Boston' }),
    supportsReverseGeocode: () => true
  };
  const event = { title: 'FURBALL Boston', bar: 'Legacy', city: 'boston' };

  const captured = captureConsole(() => {});
  try {
    await normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'enforce' } });
  } finally {
    captured.restore();
  }

  assert.equal(event.location, undefined, 'house 175 vs 79 is beyond interpolation drift — refused');
  assert.equal(event.address, '79 Warrenton Street, Boston, Massachusetts', 'the POI-vouched address is still kept');
  assert.equal(event.addressSource, 'geo-poi');
  assert.ok(
    !captured.lines.some(line => line.includes('provider interpolation tolerance')),
    'no tolerance log beyond the 20-number gap'
  );
  assert.ok(
    captured.lines.some(line => line.includes('pin failed reverse cross-check')),
    'the refusal stays visible'
  );
});

test('POI-pin tolerance never applies to regular address-geocoded pins (strict house comparison regression lock)', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  // Same street, house 1180 vs input 1192 — a gap WITHIN the POI tolerance,
  // but this pin was geocoded from the event's own address, not adopted.
  const httpAdapter = createRoutedStubAdapter(
    [['nominatim', [POWERHOUSE_POI_RESULT]]],
    {
      reverseGeocodePlacemark: async () => ({ subThoroughfare: '1180', thoroughfare: 'Folsom Street', locality: 'San Francisco' }),
      supportsReverseGeocode: () => true
    }
  );
  const event = { title: 'CHUNK', address: '1192 Folsom St, San Francisco' };

  const lines = await withCapturedConsole(() =>
    normalizer.normalizeAsync(event, httpAdapter, { geocodeVerification: { mode: 'enforce' } })
  );

  assert.equal(event.location, undefined, 'a non-POI pin keeps today\'s strict exact-house cross-check');
  assert.ok(
    lines.some(l => l.includes('pin failed reverse cross-check')),
    `the strict refusal must be logged: ${lines.join(' | ')}`
  );
  assert.ok(
    !lines.some(l => l.includes('provider interpolation tolerance')),
    'the tolerance is POI-adoption-only'
  );
});

test('fusion via the Photon venue follow-up: empty Nominatim venue rescue + Photon Aqua Club flags the fused bar', async () => {
  const normalizer = createOsmNormalizerFor(CITIES_WITH_TORREMOLINOS);
  const nogaleraLocality = {
    lat: '36.6225097',
    lon: '-4.4987054',
    class: 'place',
    type: 'locality',
    addresstype: 'locality',
    name: 'La Nogalera',
    display_name: 'La Nogalera, Torremolinos, Málaga, Spain',
    address: { town: 'Torremolinos', state: 'Andalusia' }
  };
  const photonHamlet = {
    features: [{
      geometry: { coordinates: [-4.4987054, 36.6225097] },
      properties: { name: 'La Nogalera', osm_key: 'place', osm_value: 'hamlet' }
    }]
  };
  // Photon's fuzzy venue search DOES know the venue: photon.komoot.io/api/
  // ?q=Aqua+Emporio+Torremolinos → "Aqua Club" (nightclub, Calle Casablanca).
  const aquaClubPhoton = {
    features: [{
      geometry: { coordinates: [-4.4982728, 36.6218328] },
      properties: { name: 'Aqua Club', osm_key: 'amenity', osm_value: 'nightclub', street: 'Calle Casablanca', city: 'Torremolinos' }
    }]
  };
  const httpAdapter = createSequencedStubAdapter([[], [nogaleraLocality], [], photonHamlet, aquaClubPhoton]);
  const event = { title: 'FURBALL MAD.BEAR', address: 'LA NOGALERA', city: 'torremolinos', bar: 'AQUA EMPORIO' };

  const captured = captureConsole(() => {});
  try {
    await normalizer.normalizeAsync(event, httpAdapter);
  } finally {
    captured.restore();
  }

  assert.equal(httpAdapter.requests.length, 5, 'name-led rung, address rung, venue rescue, Photon address rescue, Photon venue follow-up');
  assert.ok(
    httpAdapter.requests[4].includes('photon.komoot.io') && decodeQueryParam(httpAdapter.requests[4]) === 'AQUA EMPORIO, torremolinos',
    `the follow-up must be the venue+city query: ${httpAdapter.requests[4]}`
  );
  assert.equal(event.location, undefined, 'a non-bar-matching venue hit never pins');
  assert.equal(event.address, 'LA NOGALERA', 'no address is adopted from a non-matching POI');
  assert.deepEqual(event._geoPoiFusion, { poi: 'Aqua Club', prefix: 'AQUA' }, 'fusion evidence recorded for the results UI');
  assert.ok(
    captured.lines.some(line => line.includes('🗺️ GEOCODE VERIFY: "FURBALL MAD.BEAR" bar "AQUA EMPORIO" may fuse multiple venue names — map knows "Aqua Club" (matches "AQUA"); verify manually')),
    `fusion flag log expected, got:\n${captured.lines.join('\n')}`
  );
});

// ---------------------------------------------------------------------------
// Curated-bar → city backfill (run 20260724-161423: massive.club events came
// out bar="Massive"/city="unknown" — the page never says "Seattle" — so
// timezone resolution failed and dates stayed wall-clock UTC). When the bar
// matches a curated bar by strict full-name equality in exactly ONE city, the
// city is backfilled BEFORE resolveWallClockDates so re-anchoring runs.
// ---------------------------------------------------------------------------

const BACKFILL_CITIES = {
  seattle: { timezone: 'America/Los_Angeles', patterns: ['seattle'] },
  portland: { timezone: 'America/Los_Angeles', patterns: ['portland'] },
  dallas: { timezone: 'America/Chicago', patterns: ['dallas'] }
};

const MASSIVE_SEATTLE_BAR = {
  name: 'Massive',
  city: 'seattle',
  address: '1428 Broadway, Seattle, WA 98122',
  website: 'https://www.massive.club'
};

function createBackfillNormalizer(bars) {
  const core = new SharedCore(BACKFILL_CITIES, { eventSchema: EventSchema, bars });
  return new LocationNormalizer(core);
}

test('curated-bar city backfill: literal massive.club repro — city resolves and wall-clock dates re-anchor', () => {
  const normalizer = createBackfillNormalizer({ seattle: [MASSIVE_SEATTLE_BAR] });
  const event = {
    title: 'Massive Saturday: Bimbo Hypnosis b2b Poof',
    bar: 'Massive',
    city: 'unknown',
    // Wall-clock 10pm local stored as 10pm UTC by the parser's timezone-less fallback
    startDate: '2026-07-25T22:00:00.000Z',
    endDate: '2026-07-26T02:00:00.000Z',
    _timezoneUnresolved: true
  };

  const lines = captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'seattle');
  assert.equal(event._citySource, 'curated-bar');
  assert.equal(event.timezone, 'America/Los_Angeles');
  // 10pm PDT (UTC-7) is 5am UTC the next day — the actual anchored instant
  assert.equal(event.startDate, '2026-07-26T05:00:00.000Z');
  assert.equal(event.endDate, '2026-07-26T09:00:00.000Z');
  assert.equal(event._timezoneUnresolved, undefined, 'flag cleared once dates are anchored');
  assert.ok(
    lines.includes('🗺️ LocationNormalizer: Backfilled city "seattle" from curated bar "Massive" for "Massive Saturday: Bimbo Hypnosis b2b Poof"'),
    `backfill log line expected, got:\n${lines.join('\n')}`
  );
});

test('curated-bar city backfill: ALL-CAPS bar "MASSIVE" matches via normalizeBarNameKey and re-anchors too', () => {
  const normalizer = createBackfillNormalizer({ seattle: [MASSIVE_SEATTLE_BAR] });
  const event = {
    title: 'PACK PARTY',
    bar: 'MASSIVE',
    city: 'unknown',
    startDate: '2026-07-25T22:00:00.000Z',
    _timezoneUnresolved: true
  };

  captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'seattle');
  assert.equal(event.timezone, 'America/Los_Angeles');
  assert.equal(event.startDate, '2026-07-26T05:00:00.000Z');
  assert.equal(event._timezoneUnresolved, undefined);
});

test('curated-bar city backfill: a present differing city is NEVER overwritten (no backfill log)', () => {
  const normalizer = createBackfillNormalizer({ seattle: [MASSIVE_SEATTLE_BAR] });
  const event = {
    title: 'Make Out Party w/ Hyeonje',
    bar: 'Massive',
    city: 'portland'
  };

  const lines = captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'portland', 'the present city must stay');
  assert.equal(event._citySource, undefined, 'no provenance stamp when nothing was backfilled');
  assert.ok(
    !lines.some(line => line.includes('Backfilled city')),
    `no backfill log expected, got:\n${lines.join('\n')}`
  );
});

test('curated-bar city backfill: a bar name curated in TWO cities is ambiguous — no backfill, one skip log', () => {
  const normalizer = createBackfillNormalizer({
    seattle: [MASSIVE_SEATTLE_BAR],
    portland: [{ name: 'Massive', city: 'portland' }]
  });
  const event = {
    title: 'Butt Blast - Guys Underwear Social',
    bar: 'Massive',
    city: 'unknown',
    startDate: '2026-07-25T22:00:00.000Z',
    _timezoneUnresolved: true
  };

  const lines = captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'unknown', 'ambiguity fails closed — city stays unknown');
  assert.equal(event._citySource, undefined);
  assert.equal(event.startDate, '2026-07-25T22:00:00.000Z', 'dates stay wall-clock — nothing to anchor to');
  assert.equal(event._timezoneUnresolved, true, 'flag remains so the gap stays visible');
  assert.ok(
    lines.includes('🗺️ LocationNormalizer: City backfill skipped for "Butt Blast - Guys Underwear Social" — bar "Massive" is curated in multiple cities (seattle, portland)'),
    `ambiguity log line expected, got:\n${lines.join('\n')}`
  );
});

test('curated-bar city backfill: "Eagle" must NOT match curated "Dallas Eagle" (full-name equality only)', () => {
  const normalizer = createBackfillNormalizer({
    dallas: [{ name: 'Dallas Eagle', city: 'dallas', address: '525 S Riverfront Blvd, Dallas, TX 75207' }]
  });
  const event = { title: 'Gear Night', bar: 'Eagle', city: 'unknown' };

  const lines = captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'unknown', 'partial names never claim a curated bar');
  assert.equal(event._citySource, undefined);
  assert.ok(!lines.some(line => line.includes('Backfilled city')), 'no backfill log for a non-match');
});

test('curated-bar city backfill: an uncurated bar is a no-op', () => {
  const normalizer = createBackfillNormalizer({ seattle: [MASSIVE_SEATTLE_BAR] });
  const event = {
    title: 'Hostile Noise',
    bar: 'Some Warehouse',
    city: 'unknown',
    startDate: '2026-07-25T22:00:00.000Z',
    _timezoneUnresolved: true
  };

  const lines = captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'unknown');
  assert.equal(event._timezoneUnresolved, true);
  assert.equal(event.startDate, '2026-07-25T22:00:00.000Z');
  assert.ok(!lines.some(line => line.includes('Backfilled city')), 'no backfill log for an uncurated bar');
});

test('curated-bar city backfill: generic-name-stem repro — "Eagle" must NOT backfill fort-lauderdale onto Dallas Eagle events', () => {
  // Literal run 20260725-170926: the extracted bar was the truncation "Eagle";
  // fort-lauderdale's curated bar is literally named "Eagle" — the ONLY
  // "Eagle" in curated data — and the uniqueness rule backfilled
  // "fort-lauderdale" onto "Thursday Karaoke"/"Karaoke". "eagle" is contained
  // in "dallaseagle", so the corpus itself proves the name is a family stem.
  const normalizer = createBackfillNormalizer({
    'fort-lauderdale': [{ name: 'Eagle', city: 'fort-lauderdale' }],
    dallas: [{ name: 'Dallas Eagle', city: 'dallas', address: '525 S Riverfront Blvd, Dallas, TX 75207' }]
  });
  const event = {
    title: 'Thursday Karaoke',
    bar: 'Eagle',
    city: 'unknown',
    startDate: '2026-07-24T19:00:00.000Z',
    _timezoneUnresolved: true
  };

  const lines = captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'unknown', 'a generic stem never claims a city');
  assert.equal(event._citySource, undefined);
  assert.equal(event._timezoneUnresolved, true, 'dates stay wall-clock — nothing to anchor to');
  assert.ok(
    lines.includes('🗺️ LocationNormalizer: City backfill skipped for "Thursday Karaoke" — bar "Eagle" is a generic name stem (contained in: Dallas Eagle)'),
    `stem skip log expected, got:\n${lines.join('\n')}`
  );
  assert.ok(!lines.some(line => line.includes('Backfilled city')), 'no backfill log');
});

test('curated-bar city backfill: "Massive" (contained in no other curated name) still backfills alongside the stem guard', () => {
  const normalizer = createBackfillNormalizer({
    seattle: [MASSIVE_SEATTLE_BAR],
    'fort-lauderdale': [{ name: 'Eagle', city: 'fort-lauderdale' }],
    dallas: [{ name: 'Dallas Eagle', city: 'dallas' }]
  });
  const event = {
    title: 'PACK PARTY',
    bar: 'Massive',
    city: 'unknown',
    startDate: '2026-07-25T22:00:00.000Z',
    _timezoneUnresolved: true
  };

  captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'seattle', 'non-stem unique names keep backfilling');
  assert.equal(event._citySource, 'curated-bar');
  assert.equal(event.startDate, '2026-07-26T05:00:00.000Z', 're-anchoring still runs');
});

test('curated-bar city backfill: containment is one-way — the longer unique name "Dallas Eagle" still backfills', () => {
  const normalizer = createBackfillNormalizer({
    'fort-lauderdale': [{ name: 'Eagle', city: 'fort-lauderdale' }],
    dallas: [{ name: 'Dallas Eagle', city: 'dallas' }]
  });
  const event = {
    title: 'Underwear Night',
    bar: 'Dallas Eagle',
    city: 'unknown',
    startDate: '2026-07-30T02:00:00.000Z',
    _timezoneUnresolved: true
  };

  const lines = captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'dallas', 'a longer name containing someone else\'s stem matches exactly');
  assert.equal(event._citySource, 'curated-bar');
  assert.ok(
    lines.includes('🗺️ LocationNormalizer: Backfilled city "dallas" from curated bar "Dallas Eagle" for "Underwear Night"'),
    `backfill log expected, got:\n${lines.join('\n')}`
  );
});

// ---------------------------------------------------------------------------
// Site-identity → city backfill (run 20260802-135030: seven 3dollarbillbk.com
// events shipped city "unknown" and routed to the nonexistent calendar
// "chunky-dad-unknown". The multi-event segment named no venue, so the
// evidence gate dropped `bar` and the curated-bar rung above had nothing to
// match — while the same events carried website/url pointing at a host the
// curated corpus already attributes to a bar). Rung 2 = curated `website`
// host, rung 3 = the parser config's declared city.
// ---------------------------------------------------------------------------

const SITE_IDENTITY_CITIES = {
  nyc: { timezone: 'America/New_York', patterns: ['new york', 'nyc'] },
  seattle: { timezone: 'America/Los_Angeles', patterns: ['seattle'] },
  portland: { timezone: 'America/Los_Angeles', patterns: ['portland'] }
};

// Both curated NYC entries carry the same `website` — the real data shape for
// a venue with two rooms on one site.
const THREE_DOLLAR_BILL_BARS = {
  nyc: [
    { name: '3 Dollar Bill', city: 'nyc', website: 'https://www.3dollarbillbk.com' },
    { name: '3 Dollar Bill Yard', city: 'nyc', website: 'https://www.3dollarbillbk.com' }
  ]
};

function createSiteIdentityNormalizer(bars) {
  const core = new SharedCore(SITE_IDENTITY_CITIES, { eventSchema: EventSchema, bars });
  return new LocationNormalizer(core);
}

test('site-identity city backfill: two curated bars sharing one site AGREE on the city — literal 3dollarbillbk repro', () => {
  const normalizer = createSiteIdentityNormalizer(THREE_DOLLAR_BILL_BARS);
  const event = {
    title: 'The Have Not Room: A Big Brother Watch Party',
    city: 'unknown',
    website: 'https://www.3dollarbillbk.com',
    url: 'https://www.3dollarbillbk.com/rsvp',
    // Wall-clock 7pm local stored as 7pm UTC by the parser's timezone-less fallback
    startDate: '2026-08-06T19:00:00.000Z',
    _timezoneUnresolved: true
  };

  const lines = captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'nyc', 'claimants agreeing on one city is not ambiguity');
  assert.equal(event._citySource, 'curated-website');
  assert.equal(event.timezone, 'America/New_York');
  // 7pm EDT (UTC-4) is 11pm UTC — the actual anchored instant
  assert.equal(event.startDate, '2026-08-06T23:00:00.000Z');
  assert.equal(event._timezoneUnresolved, undefined, 'flag cleared once dates are anchored');
  assert.ok(
    lines.includes('🗺️ LocationNormalizer: Backfilled city "nyc" for "The Have Not Room: A Big Brother Watch Party" from site identity 3dollarbillbk.com (curated: "3 Dollar Bill", "3 Dollar Bill Yard")'),
    `site-identity backfill log expected, got:\n${lines.join('\n')}`
  );
});

test('site-identity city backfill: a single curated bar uniquely claiming the host backfills', () => {
  const normalizer = createSiteIdentityNormalizer({
    seattle: [{ name: 'Massive', city: 'seattle', website: 'https://www.massive.club' }],
    nyc: [{ name: '3 Dollar Bill', city: 'nyc', website: 'https://www.3dollarbillbk.com' }]
  });
  const event = {
    title: 'PACK PARTY',
    city: '',
    website: 'https://massive.club/events/pack-party',
    startDate: '2026-07-25T22:00:00.000Z',
    _timezoneUnresolved: true
  };

  const lines = captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'seattle', 'the www./path difference must not defeat the host match');
  assert.equal(event._citySource, 'curated-website');
  assert.equal(event.startDate, '2026-07-26T05:00:00.000Z', 're-anchoring runs off the recovered city');
  assert.ok(
    lines.includes('🗺️ LocationNormalizer: Backfilled city "seattle" for "PACK PARTY" from site identity massive.club (curated: "Massive")'),
    `site-identity backfill log expected, got:\n${lines.join('\n')}`
  );
});

test('site-identity city backfill: curated bars in DIFFERENT cities claiming one host fail closed', () => {
  const normalizer = createSiteIdentityNormalizer({
    seattle: [{ name: 'Massive', city: 'seattle', website: 'https://www.sharedsite.example' }],
    portland: [{ name: 'Vast', city: 'portland', website: 'https://www.sharedsite.example' }]
  });
  const event = {
    title: 'Butt Blast',
    city: 'unknown',
    website: 'https://www.sharedsite.example/events',
    startDate: '2026-07-25T22:00:00.000Z',
    _timezoneUnresolved: true
  };

  const lines = captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'unknown', 'a cross-city claim set is ambiguity — city stays unresolved');
  assert.equal(event._citySource, undefined);
  assert.equal(event.startDate, '2026-07-25T22:00:00.000Z', 'dates stay wall-clock — nothing to anchor to');
  assert.equal(event._timezoneUnresolved, true, 'flag remains so the gap stays visible');
  assert.ok(
    lines.includes('🗺️ LocationNormalizer: City backfill skipped for "Butt Blast" — site sharedsite.example is claimed by curated bars in multiple cities (seattle, portland)'),
    `ambiguity log line expected, got:\n${lines.join('\n')}`
  );
  assert.ok(!lines.some(line => line.includes('Backfilled city')), 'no backfill log');
});

test('site-identity city backfill: an unknown city with NO signal at all stays unresolved', () => {
  const normalizer = createSiteIdentityNormalizer(THREE_DOLLAR_BILL_BARS);
  const event = {
    title: 'Hostile Noise',
    city: 'unknown',
    website: 'https://www.some-promoter.example/party',
    startDate: '2026-08-06T19:00:00.000Z',
    _timezoneUnresolved: true
  };

  const lines = captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'unknown');
  assert.equal(event._citySource, undefined);
  assert.equal(event._timezoneUnresolved, true);
  assert.equal(event.startDate, '2026-08-06T19:00:00.000Z');
  assert.ok(!lines.some(line => line.includes('Backfilled city')), 'no backfill log without a signal');
});

test('site-identity city backfill: an already-resolved city is NEVER overwritten by site identity or parser config', () => {
  const normalizer = createSiteIdentityNormalizer(THREE_DOLLAR_BILL_BARS);
  const event = {
    title: 'Road Show',
    city: 'seattle',
    website: 'https://www.3dollarbillbk.com/rsvp'
  };

  const lines = captureConsoleLog(() => { normalizer.normalize(event, { parserCity: 'portland' }); });

  assert.equal(event.city, 'seattle', 'the resolved city must stay');
  assert.equal(event._citySource, undefined, 'no provenance stamp when nothing was backfilled');
  assert.ok(!lines.some(line => line.includes('Backfilled city')), 'no backfill log');
});

test('parser-config city backfill: the declared city is the last rung when no site identity resolves', () => {
  const normalizer = createSiteIdentityNormalizer(THREE_DOLLAR_BILL_BARS);
  const event = {
    title: 'Bear Happy Hour',
    city: 'unknown',
    website: 'https://www.some-promoter.example/party',
    startDate: '2026-08-06T19:00:00.000Z',
    _timezoneUnresolved: true
  };

  const lines = captureConsoleLog(() => { normalizer.normalize(event, { parserCity: 'New York' }); });

  assert.equal(event.city, 'nyc', 'the configured city resolves through the city mappings');
  assert.equal(event._citySource, 'parser-config');
  assert.equal(event.startDate, '2026-08-06T23:00:00.000Z', 're-anchoring runs off the configured city');
  assert.ok(
    lines.includes('🗺️ LocationNormalizer: Backfilled city "nyc" for "Bear Happy Hour" from the parser config\'s declared city'),
    `parser-config backfill log expected, got:\n${lines.join('\n')}`
  );
});

test('site-identity city backfill: the curated-bar rung still wins — site identity never runs once it resolved', () => {
  const normalizer = createSiteIdentityNormalizer({
    nyc: [{ name: '3 Dollar Bill', city: 'nyc', website: 'https://www.3dollarbillbk.com' }],
    seattle: [{ name: 'Massive', city: 'seattle', website: 'https://www.massive.club' }]
  });
  const event = {
    title: 'Guest Takeover',
    bar: 'Massive',
    city: 'unknown',
    website: 'https://www.3dollarbillbk.com/rsvp'
  };

  const lines = captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'seattle', 'the named curated bar outranks the site the listing lives on');
  assert.equal(event._citySource, 'curated-bar');
  assert.ok(
    !lines.some(line => line.includes('from site identity')),
    `site-identity rung must not run after a resolved city, got:\n${lines.join('\n')}`
  );
});

test('corroborateBarWithGeoPoi never overwrites the venue-site-identity stamp', () => {
  const normalizer = createOsmNormalizer();
  // A matching POI corroborates but must not restamp an identity-corrected bar
  const identityEvent = { title: 'PERVERT', bar: 'Massive', barSource: 'venue-site-identity' };
  normalizer.corroborateBarWithGeoPoi(identityEvent, ['Massive']);
  assert.equal(identityEvent.barSource, 'venue-site-identity');

  // Empty and uncorroborated stamps still upgrade to geo-poi as before
  const uncorroboratedEvent = { title: 'PERVERT', bar: 'Massive', barSource: 'uncorroborated' };
  normalizer.corroborateBarWithGeoPoi(uncorroboratedEvent, ['Massive']);
  assert.equal(uncorroboratedEvent.barSource, 'geo-poi');
  const unstampedEvent = { title: 'PERVERT', bar: 'Massive' };
  normalizer.corroborateBarWithGeoPoi(unstampedEvent, ['Massive']);
  assert.equal(unstampedEvent.barSource, 'geo-poi');
});

// ===========================================================================
// run 20260727-145617: diacritic folding in city resolution — "montréal" and
// accented address text must resolve the montreal config key (Fix 1)
// ===========================================================================

const MONTREAL_CITIES = {
  montreal: { name: 'Montreal', timezone: 'America/Toronto', patterns: ['montreal', 'mtl'] },
  portland: { timezone: 'America/Los_Angeles', patterns: ['portland', 'pdx'] }
};

function createMontrealLocationNormalizer() {
  const core = new SharedCore(MONTREAL_CITIES, { eventSchema: EventSchema });
  return new LocationNormalizer(core);
}

test('normalizeCityName resolves accented "montréal"/"Montréal"/"MONTRÉAL" to the montreal key; unaccented byte-identical', () => {
  const normalizer = createMontrealLocationNormalizer();
  // Literal run 20260727-145617 value that logged: Unknown city "montréal"
  assert.equal(normalizer.normalizeCityName('montréal'), 'montreal');
  assert.equal(normalizer.normalizeCityName('Montréal'), 'montreal');
  assert.equal(normalizer.normalizeCityName('MONTRÉAL'), 'montreal');
  // Unaccented regression: identical to pre-fix behavior
  assert.equal(normalizer.normalizeCityName('montreal'), 'montreal');
  assert.equal(normalizer.normalizeCityName('Portland'), 'portland');
  // Unmapped input still echoes back lowercased, exactly as before
  assert.equal(normalizer.normalizeCityName('atlantis'), 'atlantis');
});

test('extractCityFromAddress resolves accented address text containing "Montréal" (literal run address shape)', () => {
  const normalizer = createMontrealLocationNormalizer();
  assert.equal(normalizer.extractCityFromAddress('2915 Rue Ontario E, Montréal, QC H2K 1X7'), 'montreal');
  assert.equal(normalizer.extractCityFromAddress('2915 Rue Ontario E, Montreal, QC H2K 1X7'), 'montreal');
  // A bare street line still yields NO city (the 2026-07-13 guard holds)
  assert.equal(normalizer.extractCityFromAddress('2915 Rue Ontario E'), null);
});

test('extractCityFromEvent resolves an accented city field and accented title/venue text', () => {
  const normalizer = createMontrealLocationNormalizer();
  assert.equal(normalizer.extractCityFromEvent({ city: 'montréal' }), 'montreal');
  assert.equal(normalizer.extractCityFromEvent({ title: 'Concours PUP Montréal' }), 'montreal');
  assert.equal(normalizer.extractCityFromEvent({ title: 'Bear Night', bar: 'Bar Le Cocktail Montréal' }), 'montreal');
  // Unaccented regression
  assert.equal(normalizer.extractCityFromEvent({ title: 'Portland Bear Night' }), 'portland');
});

test('LocationNormalizer end-to-end: accented city resolves timezone — no Unknown-city warn, dates re-anchor', () => {
  const normalizer = createMontrealLocationNormalizer();
  const event = {
    title: 'Concours PUP MTL',
    city: 'montréal',
    startDate: new Date('2026-07-27T22:00:00.000Z'),
    endDate: new Date('2026-07-27T22:00:00.000Z'),
    _timezoneUnresolved: true
  };
  const normalized = normalizer.normalize(event);
  assert.equal(normalized.city, 'montreal');
  assert.equal(normalized.timezone, 'America/Toronto');
  // 10pm EDT (UTC-4) = 2am UTC next day — no longer wall-clock UTC
  assert.equal(normalized.startDate.toISOString(), '2026-07-28T02:00:00.000Z');
});

// ---------------------------------------------------------------------------
// Greater Palm Springs aliases (real generated cities config)
// ---------------------------------------------------------------------------

test('cathedral city (city value and address) resolves to palm-springs via the real cities config', () => {
  const realCities = require('./scraper-cities');
  const core = new SharedCore(realCities, { eventSchema: EventSchema });
  const normalizer = new LocationNormalizer(core);
  assert.equal(normalizer.normalizeCityName('cathedral city'), 'palm-springs');
  assert.equal(normalizer.normalizeCityName('Cathedral City'), 'palm-springs');
  assert.equal(
    normalizer.extractCityFromAddress('68718 E Palm Canyon Dr, Cathedral City, CA 92234'),
    'palm-springs');
  // Word-boundary safety: a multi-word alias never matches inside other words
  assert.equal(normalizer.extractCityFromAddress('123 Main St, Cathedralton, TX'), null);
});

test('BasicDataNormalizer stamps _recurring for a non-empty recurrenceRule (series are display+export only)', () => {
  const normalizer = new BasicDataNormalizer();
  const recurring = normalizer.normalize({ title: 'FUZZY', recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR' });
  assert.equal(recurring._recurring, true);

  const emptyRule = normalizer.normalize({ title: 'ONE-OFF', recurrenceRule: '' });
  assert.equal(emptyRule._recurring, undefined, 'empty rrule never stamps');

  const plain = normalizer.normalize({ title: 'PLAIN' });
  assert.equal(plain._recurring, undefined);
});

// ---------------------------------------------------------------------------
// sanitizeDescriptionFormatting (run 20260729-125201: dice.fm markdown and
// Wix raw-HTML descriptions reached notes verbatim)
// ---------------------------------------------------------------------------

const { sanitizeDescriptionFormatting } = require('./normalizers');

// Exact evidence string from the phone run (BEEFMINCE via dice.fm):
// double-asterisk bold runs plus backslash-escaped asterisks.
const DICE_MARKDOWN_DESCRIPTION = "**BEEFMINCE | The UK's Tastiest Bear Club** **\\*Now on Saturdays\\***";
// Exact evidence string from the phone run (The Bear Cave via a Wix site):
// raw HTML plus a LITERAL backslash-n (two characters), not a newline.
const WIX_HTML_DESCRIPTION = '<p>Dress the part, flash your sticker and let the lights guide your night. </p>\\n';

test('sanitizeDescriptionFormatting strips dice.fm markdown emphasis but keeps the words', () => {
  const sanitized = sanitizeDescriptionFormatting(DICE_MARKDOWN_DESCRIPTION);

  assert.ok(!sanitized.includes('**'), `no double-asterisk runs survive: ${JSON.stringify(sanitized)}`);
  assert.ok(!sanitized.includes('\\*'), `no backslash-escaped asterisks survive: ${JSON.stringify(sanitized)}`);
  assert.ok(sanitized.includes("BEEFMINCE | The UK's Tastiest Bear Club"), 'the words are kept');
  assert.ok(sanitized.includes('Now on Saturdays'), 'the escaped-run words are kept');
});

test('sanitizeDescriptionFormatting turns Wix raw HTML + literal backslash-n into plain text', () => {
  const sanitized = sanitizeDescriptionFormatting(WIX_HTML_DESCRIPTION);

  assert.equal(sanitized, 'Dress the part, flash your sticker and let the lights guide your night.');
  assert.ok(!sanitized.includes('<p>') && !sanitized.includes('</p>'), 'no HTML tags survive');
  assert.ok(!sanitized.includes('\\n'), 'no literal backslash-n survives');
});

test('sanitizeDescriptionFormatting is idempotent on the evidence fixtures', () => {
  for (const fixture of [DICE_MARKDOWN_DESCRIPTION, WIX_HTML_DESCRIPTION]) {
    const once = sanitizeDescriptionFormatting(fixture);
    assert.equal(sanitizeDescriptionFormatting(once), once, `sanitize(sanitize(x)) === sanitize(x) for ${JSON.stringify(fixture)}`);
  }
});

test('sanitizeDescriptionFormatting passes a plain description through byte-identical', () => {
  const plain = 'Bears, beers, and DJs from 9pm. $10 at the door.\n\nHosted by the CubScout crew * 21+ only.';
  assert.equal(sanitizeDescriptionFormatting(plain), plain, 'plain text (including a single *) is untouched');
});

test('sanitizeDescriptionFormatting handles block tags, entities, links, headings, and escaped punctuation', () => {
  const html = '<div>Doors &amp; drinks at 9pm<br>DJ set till late</div><p>Tickets &lt;here&gt;</p>';
  assert.equal(
    sanitizeDescriptionFormatting(html),
    'Doors & drinks at 9pm\nDJ set till late\n\nTickets <here>');

  assert.equal(
    sanitizeDescriptionFormatting('# BIG NIGHT\n***Get*** [tickets](https://tix.example/ev) now\\. __Really__'),
    'BIG NIGHT\nGet tickets now. Really');

  // Escaped-asterisk runs collapse over the fixed point: \*\*TBC\*\** → TBC
  assert.equal(sanitizeDescriptionFormatting('\\*\\*TBC\\*\\**'), 'TBC');
});

// ---------------------------------------------------------------------------
// PIN LADDER: curated coordinates > address geocode > the page's maps-link
// pin (the ll= param a ticketing page publishes, harvested by the AI web
// parser behind its venue-identity guard and stashed on _mapsLinkCoordinate).
//
// Measured against verified truth on 5 real Dice venues:
//   venue              maps-link err   address-geocode err
//   Concorde 2               7 m       NO RESULT
//   Royal Vauxhall Tavern    6 m             0 m
//   Westminster Pier       936 m             1 m   <- ll= is a DIFFERENT pier
//   Horizon                181 m       NO RESULT
//   Eden                     0 m       NO RESULT
// The geocode is near-perfect when it resolves but failed outright on 3 of 5;
// the maps-link pin always resolves and was right in exactly those 3. So the
// geocode outranks it, and it fills only what the geocode left blank.
// ---------------------------------------------------------------------------

const PIN_LADDER_CITIES = {
  london: { timezone: 'Europe/London', patterns: ['london'] },
  brighton: { timezone: 'Europe/London', patterns: ['brighton'] }
};

// Curated London bars — Westminster Pier's curated pin is the CORRECT one.
const PIN_LADDER_BARS = {
  london: [
    { name: 'Westminster Pier', city: 'london', address: 'Victoria Embankment, London SW1A 2JH', coordinates: '51.5022544, -0.1231736' }
  ]
};

// Verbatim ll= values from the cached Dice event pages.
const DICE_PIER_PIN = '51.5099822,-0.117819';
const DICE_CONCORDE_PIN = '50.8172448,-0.122510799999986';
const DICE_RVT_PIN = '51.4863391,-0.1217784';

// What Nominatim returns for Westminster Pier's address — 1 m from truth.
const WESTMINSTER_PIER_GEOCODE = {
  lat: '51.5022544',
  lon: '-0.1231736',
  class: 'amenity',
  type: 'ferry_terminal',
  addresstype: 'amenity',
  name: 'Westminster Pier',
  display_name: 'Westminster Pier, Victoria Embankment, London, SW1A 2JH, United Kingdom',
  address: { road: 'Victoria Embankment', city: 'London', postcode: 'SW1A 2JH' }
};

function createPinLadderNormalizer() {
  const core = new SharedCore(PIN_LADDER_CITIES, { eventSchema: EventSchema, bars: PIN_LADDER_BARS });
  const normalizer = new OpenStreetMapNormalizer(core);
  normalizer.delayForRateLimit = async () => {};
  return normalizer;
}

test('pin ladder: a successful address geocode outranks the page maps-link pin, and the disagreement is logged', async () => {
  const normalizer = createPinLadderNormalizer();
  const httpAdapter = createStubHttpAdapter([WESTMINSTER_PIER_GEOCODE]);
  const event = {
    title: 'BOATMINCE',
    bar: 'Westminster Pier',
    city: 'london',
    address: 'Victoria Embankment, London SW1A 2JH',
    _mapsLinkCoordinate: { location: DICE_PIER_PIN, venueName: 'Westminster Pier' }
  };

  const capture = captureConsole(() => {});
  try {
    await normalizer.normalizeAsync(event, httpAdapter);
  } finally {
    capture.restore();
  }

  // The geocode won; the maps-link pin (a different pier) never landed.
  assert.equal(event.location, '51.5022544, -0.1231736');
  assert.ok(String(event.pinSource).startsWith('geocoded-'), `geocode provenance expected, got ${event.pinSource}`);

  // …and the ~940 m disagreement is reported so a human can check it.
  const conflict = capture.lines.find(line => line.includes('MAPS LINK CONFLICT'));
  assert.ok(conflict, `conflict line expected, got: ${JSON.stringify(capture.lines)}`);
  assert.ok(conflict.includes('936 m'), conflict);
  assert.ok(conflict.includes(DICE_PIER_PIN) && conflict.includes('51.5022544, -0.1231736'), conflict);
  assert.ok(conflict.includes('accepted pin kept'), conflict);
});

test('pin ladder: the maps-link pin fills in when the address geocode finds nothing', async () => {
  const normalizer = createPinLadderNormalizer();
  const httpAdapter = createStubHttpAdapter([]); // Nominatim: no results, every rung
  const event = {
    title: 'BEEFMINCE x BRIGHTON',
    bar: 'Concorde 2',
    city: 'brighton',
    address: 'Madeira Drive, Brighton BN2 1EN',
    _mapsLinkCoordinate: { location: DICE_CONCORDE_PIN, venueName: 'Concorde 2' }
  };

  const capture = captureConsole(() => {});
  try {
    await normalizer.normalizeAsync(event, httpAdapter);
  } finally {
    capture.restore();
  }

  assert.equal(event.location, DICE_CONCORDE_PIN);
  assert.equal(event.pinSource, 'maps-link');
  assert.ok(capture.lines.some(line => line.includes('No curated or geocoded pin for "BEEFMINCE x BRIGHTON"')
    && line.includes(DICE_CONCORDE_PIN)),
    `fill line expected, got: ${JSON.stringify(capture.lines)}`);
  // Nothing to disagree with — no conflict line.
  assert.ok(!capture.lines.some(line => line.includes('MAPS LINK CONFLICT')), JSON.stringify(capture.lines));
});

test('pin ladder: curated coordinates win outright — the maps-link pin never displaces them', async () => {
  const pipeline = new NormalizerPipeline();
  pipeline.setCore(new SharedCore(PIN_LADDER_CITIES, { eventSchema: EventSchema, bars: PIN_LADDER_BARS }));
  const osm = pipeline.normalizers[pipeline.normalizers.length - 1];
  osm.delayForRateLimit = async () => {};
  // A geocode result that would ALSO have been accepted, to prove the curated
  // pin short-circuits the ladder rather than merely winning a tie.
  const httpAdapter = createStubHttpAdapter([WESTMINSTER_PIER_GEOCODE]);

  const capture = captureConsole(() => {});
  let normalized;
  try {
    normalized = await pipeline.normalizeEventAsync({
      title: 'BOATMINCE',
      bar: 'Westminster Pier',
      city: 'london',
      startDate: new Date('2026-08-30T18:00:00.000Z'),
      _mapsLinkCoordinate: { location: DICE_PIER_PIN, venueName: 'Westminster Pier' }
    }, httpAdapter);
  } finally {
    capture.restore();
  }

  assert.equal(normalized.location, '51.5022544, -0.1231736', 'the curated pin is kept');
  assert.equal(normalized.pinSource, 'curated');
  assert.equal(httpAdapter.requests.length, 0, 'a curated pin means no geocode request at all');
  const conflict = capture.lines.find(line => line.includes('MAPS LINK CONFLICT'));
  assert.ok(conflict && conflict.includes('(curated)'), `curated-vs-maps-link conflict expected, got: ${JSON.stringify(capture.lines)}`);
});

test('pin ladder: a maps-link pin agreeing with the accepted pin logs no conflict, and junk is ignored', async () => {
  const normalizer = createPinLadderNormalizer();

  // RVT: the maps-link pin and the geocode are the same building (0 m).
  const agreeing = {
    title: 'BEEFMINCE x RVT',
    location: DICE_RVT_PIN,
    pinSource: 'geocoded-exact',
    address: '372 Kennington Ln, London SE11 5HY',
    _mapsLinkCoordinate: { location: '51.4863391,-0.1217784', venueName: 'The Royal Vauxhall Tavern' }
  };
  const agreeingCapture = captureConsole(() => {});
  try {
    await normalizer.normalizeAsync(agreeing, createStubHttpAdapter([]));
  } finally {
    agreeingCapture.restore();
  }
  assert.equal(agreeing.location, DICE_RVT_PIN);
  assert.equal(agreeing.pinSource, 'geocoded-exact');
  assert.ok(!agreeingCapture.lines.some(line => line.includes('MAPS LINK CONFLICT')), JSON.stringify(agreeingCapture.lines));

  // An unusable stash is ignored (the parser never writes these, but the
  // rung fails closed rather than trusting its input).
  for (const stash of [null, {}, { location: '' }, { location: 'not,coords' }, { location: '0,0' }, { location: '91,0' }]) {
    const event = { title: 'X', bar: 'Somewhere', city: 'london', _mapsLinkCoordinate: stash };
    assert.equal(normalizer.applyMapsLinkCoordinateFallback(event), false, JSON.stringify(stash));
    assert.equal(event.location, undefined, JSON.stringify(stash));
  }

  // No stash at all changes nothing.
  const untouched = { title: 'X', bar: 'Somewhere', city: 'london' };
  assert.equal(normalizer.applyMapsLinkCoordinateFallback(untouched), false);
  assert.equal(untouched.location, undefined);
});

test('pin ladder: a NAME-ONLY geocoded pin is FLAGGED against the maps-link pin, never replaced', async () => {
  const normalizer = createPinLadderNormalizer();

  // Run evidence: with the address missing, the venue+city rescue query
  // "Horizon, brighton" resolved to a HOUSE called Horizon on Ainsworth
  // Avenue, 5 km away — and came back exact-grade with a POI name matching
  // the bar, so no response-side signal could catch it. The maps-link pin is
  // the better one HERE — but the same rung resolves Westminster Pier
  // perfectly while ITS maps link is 936 m wrong, and nothing at runtime
  // separates the two. So this logs loudly and changes nothing.
  const event = {
    title: 'BEEFMINCE Brighton Pride',
    bar: 'Horizon',
    city: 'brighton',
    location: '50.8130039, -0.0690619',
    pinSource: 'geocoded-exact',
    address: '56 Ainsworth Avenue, Brighton, England',
    addressSource: 'geo-poi',
    _geocodeQuery: 'Horizon, brighton',
    _geocodeQueryHadAddress: false,
    _mapsLinkCoordinate: { location: '50.819936,-0.140382', venueName: 'Horizon' }
  };

  const capture = captureConsole(() => {});
  try {
    assert.equal(normalizer.applyMapsLinkCoordinateFallback(event), false);
  } finally {
    capture.restore();
  }

  // The geocoded pin is KEPT — nothing about the event's location changes.
  assert.equal(event.location, '50.8130039, -0.0690619');
  assert.equal(event.pinSource, 'geocoded-exact');
  // The address adopted from that same hit is FLAGGED, never deleted — the
  // evidence on whether such an address is wrong points both ways.
  assert.equal(event.address, '56 Ainsworth Avenue, Brighton, England');
  assert.equal(event.addressSource, 'geo-poi');
  assert.ok(capture.lines.some(line => line.includes('MAPS LINK DECLINED')
    && line.includes('name-only query "Horizon, brighton"')
    && line.includes('5069 m')
    && line.includes('maps-link pin NOT applied')),
    JSON.stringify(capture.lines));
  assert.ok(capture.lines.some(line => line.includes('MAPS LINK DECLINED')
    && line.includes('address "56 Ainsworth Avenue, Brighton, England" was adopted from that same questioned map hit')),
    JSON.stringify(capture.lines));
});

test('pin ladder: an address-derived geocoded pin takes the ordinary conflict line and is kept', async () => {
  const normalizer = createPinLadderNormalizer();

  // Westminster Pier, the case the name-led rung fixed: the query carried the
  // event's address ("Victoria Embankment") — no house number and no
  // street-type word, but an address all the same — and the pin it produced
  // is the correct pier. The maps link (a different pier, 936 m away) must
  // NOT displace it; it only gets a conflict line.
  const event = {
    title: 'BOATMINCE',
    bar: 'Westminster Pier',
    city: 'london',
    location: '51.5022544, -0.1231736',
    pinSource: 'geocoded-approx',
    address: 'Victoria Embankment, London, UK',
    _geocodeQuery: 'Westminster Pier, Victoria Embankment, London, UK',
    _geocodeQueryHadAddress: true,
    _mapsLinkCoordinate: { location: DICE_PIER_PIN, venueName: 'Westminster Pier' }
  };

  const capture = captureConsole(() => {});
  try {
    assert.equal(normalizer.applyMapsLinkCoordinateFallback(event), false);
  } finally {
    capture.restore();
  }

  assert.equal(event.location, '51.5022544, -0.1231736', 'the address-derived pin is kept');
  assert.equal(event.pinSource, 'geocoded-approx');
  assert.equal(event.address, 'Victoria Embankment, London, UK');
  assert.ok(capture.lines.some(line => line.includes('accepted pin kept')), JSON.stringify(capture.lines));

  // Every other shape keeps its pin too, whatever the flag says: curated
  // pins, page pins, and geocoded pins with no query flag at all.
  for (const overrides of [
    { pinSource: 'curated' },
    { pinSource: 'page' },
    { pinSource: 'geocoded-exact', _geocodeQueryHadAddress: undefined },
    { pinSource: undefined, _geocodeQueryHadAddress: false }
  ]) {
    const kept = {
      title: 'X', bar: 'Westminster Pier', city: 'london',
      location: '51.5022544, -0.1231736',
      _geocodeQueryHadAddress: false,
      ...overrides,
      _mapsLinkCoordinate: { location: DICE_PIER_PIN, venueName: 'Westminster Pier' }
    };
    const keptCapture = captureConsole(() => {});
    try {
      assert.equal(normalizer.applyMapsLinkCoordinateFallback(kept), false, JSON.stringify(overrides));
    } finally {
      keptCapture.restore();
    }
    assert.equal(kept.location, '51.5022544, -0.1231736', JSON.stringify(overrides));
  }

  // Under the threshold, a name-only pin is left alone too.
  const near = {
    title: 'BEEFMINCE x BRIGHTON', bar: 'Concorde 2', city: 'brighton',
    location: '50.8172912, -0.1225875',
    pinSource: 'geocoded-exact',
    _geocodeQuery: 'Concorde 2, brighton',
    _geocodeQueryHadAddress: false,
    _mapsLinkCoordinate: { location: DICE_CONCORDE_PIN, venueName: 'Concorde 2' }
  };
  const nearCapture = captureConsole(() => {});
  try {
    assert.equal(normalizer.applyMapsLinkCoordinateFallback(near), false);
  } finally {
    nearCapture.restore();
  }
  assert.equal(near.location, '50.8172912, -0.1225875');
  assert.ok(!nearCapture.lines.some(line => line.includes('MAPS LINK CONFLICT')), JSON.stringify(nearCapture.lines));
});

// ---------------------------------------------------------------------------
// title <- bar promotion guard. Run 20260801-170254 shipped a Portland event
// named "Nova Box" — flyer OCR of the venue "NOVA PDX". BarDataNormalizer saw
// the venue in the title, assumed the fields were transposed, and promoted the
// OCR garbage in `bar` into `title` with no verification and no log line.
// ---------------------------------------------------------------------------
function createNovaNormalizer() {
  const core = new SharedCore(
    { portland: { timezone: 'America/Los_Angeles', patterns: ['portland'] } },
    {
      eventSchema: EventSchema,
      bars: {
        portland: [{
          name: 'Nova PDX',
          address: '722 East Burnside Street, Portland, Oregon, 97214',
          coordinates: '45.52281000000001, -122.6581342'
        }]
      }
    }
  );
  return new BarDataNormalizer(core);
}

test('a bar value that is a variant of the matched venue never becomes the title', () => {
  const normalizer = createNovaNormalizer();
  const event = { title: 'CHUNK: Nova PDX', bar: 'Nova Box', city: 'portland' };

  const lines = captureConsoleLog(() => normalizer.normalize(event));

  assert.equal(event.title, 'CHUNK: Nova PDX', 'the OCR venue variant must not overwrite the title');
  assert.equal(event.bar, 'Nova PDX', 'the bar is still corrected to the curated name');
  assert.ok(
    lines.some(line => line.includes('is a variant of "Nova PDX" — kept title, corrected bar only')),
    `the withheld promotion is logged: ${JSON.stringify(lines)}`
  );
});

test('a genuine title-in-bar transposition still promotes, and says so', () => {
  const core = new SharedCore(
    { nyc: { timezone: 'America/New_York', patterns: ['nyc'] } },
    { eventSchema: EventSchema, bars: { nyc: [{ name: 'Eagle', address: '554 W 28th St', coordinates: '40.7506, -74.0035' }] } }
  );
  const normalizer = new BarDataNormalizer(core);
  const event = { title: 'Eagle', bar: 'Bear Night Party', city: 'nyc' };

  const lines = captureConsoleLog(() => normalizer.normalize(event));

  assert.equal(event.title, 'Bear Night Party', 'an unrelated name in `bar` is the real title');
  assert.equal(event.bar, 'Eagle');
  assert.ok(
    lines.some(line => line.includes('was the venue → promoted bar "Bear Night Party" into title')),
    `the promotion is logged: ${JSON.stringify(lines)}`
  );
});

test('isPromotableTitleFromBarField: shared-word variants blocked, distinct names allowed', () => {
  const normalizer = createNovaNormalizer();
  assert.equal(normalizer.isPromotableTitleFromBarField('Nova Box', 'Nova PDX'), false);
  assert.equal(normalizer.isPromotableTitleFromBarField('NOVA-PDX', 'Nova PDX'), false);
  assert.equal(normalizer.isPromotableTitleFromBarField('Eagle Bear Night', 'Eagle'), true,
    'a name that adds words to the venue is a real title');
  assert.equal(normalizer.isPromotableTitleFromBarField('UNDERBEAR', 'Eagle'), true);
});

// ---------------------------------------------------------------------------
// Unrecognized-city gate (run 20260802-221204: "ONYX" shipped
// city "socal / southwest" — ONYX's regional-chapter branding, real flyer
// artwork text, so the verbatim-evidence gate correctly passed it — and every
// run since routed it to the calendar target "chunky-dad-unknown", which does
// not exist and cannot be written; that one target appears 158 times across a
// single day's logs. The same run had the right answer in hand: it logged
// `Backfilled city "la" from curated bar "Eagle LA" for "ONYX"` twice from the
// detail pages, and the merge then preferred the listing page's regional
// string).
// ---------------------------------------------------------------------------

const CITY_GATE_CITIES = {
  la: { calendar: 'chunky-dad-la', timezone: 'America/Los_Angeles', patterns: ['los angeles', 'weho'] },
  seattle: { calendar: 'chunky-dad-seattle', timezone: 'America/Los_Angeles', patterns: ['seattle'] }
};

const EAGLE_LA_BAR = {
  name: 'Eagle LA',
  city: 'la',
  address: '4219 Santa Monica Blvd, Los Angeles, CA 90029',
  coordinates: '34.0918224, -118.2795639',
  website: 'https://eaglela.com'
};

function createCityGateNormalizer(bars) {
  const core = new SharedCore(CITY_GATE_CITIES, { eventSchema: EventSchema, bars: bars || {} });
  return new LocationNormalizer(core);
}

test('unrecognized city: literal ONYX repro — "socal / southwest" is refused and the curated bar restores "la"', () => {
  const normalizer = createCityGateNormalizer({ la: [EAGLE_LA_BAR] });
  const event = {
    title: 'ONYX',
    bar: 'Eagle LA',
    city: 'socal / southwest',
    startDate: '2026-08-09T16:00:00.000Z',
    _timezoneUnresolved: true
  };

  const lines = captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'la', 'the curated bar knows where Eagle LA is');
  assert.equal(event._citySource, 'curated-bar');
  assert.equal(event._unrecognizedCity, 'socal / southwest', 'what the page said is kept as evidence');
  assert.equal(event.timezone, 'America/Los_Angeles', 'a routable city also resolves the timezone');
  assert.ok(
    lines.some(line => line.includes('Refused unrecognized city "socal / southwest" for "ONYX"')),
    `the refusal must be visible: ${lines.join('\n')}`
  );
  assert.ok(
    lines.some(line => line.includes('"ONYX" city recovered as "la" (curated-bar) after refusing "socal / southwest"')),
    `the recovery must be visible: ${lines.join('\n')}`
  );
});

test('unrecognized city: with nothing curated to recover it the event is flagged, never routed', async () => {
  const normalizer = createCityGateNormalizer({ la: [EAGLE_LA_BAR] });
  const event = {
    title: 'BEAR HAPPY HOUR',
    bar: 'Some Uncurated Room',
    city: 'Tulsa',
    description: 'Weekly happy hour',
    url: 'https://example.com/bear-happy-hour'
  };

  const lines = await withCapturedConsole(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'unknown', 'a city with no configured calendar never propagates');
  assert.equal(event._unrecognizedCity, 'tulsa', 'normalizeCityName lowercases before the gate sees it');
  // flag-don't-drop: everything else about the event survives untouched
  assert.equal(event.title, 'BEAR HAPPY HOUR');
  assert.equal(event.bar, 'Some Uncurated Room');
  assert.equal(event.description, 'Weekly happy hour');
  assert.equal(event.url, 'https://example.com/bear-happy-hour');
  assert.ok(
    lines.some(line => line.includes('"BEAR HAPPY HOUR" has no resolvable city — the page said "tulsa"')),
    `the unresolved flag must be visible: ${lines.join('\n')}`
  );
});

test('unrecognized city: configured keys, aliases and the unknown sentinel are all untouched', () => {
  const normalizer = createCityGateNormalizer({});
  for (const [input, expected] of [['la', 'la'], ['Los Angeles', 'la'], ['WEHO', 'la'], ['seattle', 'seattle'], ['unknown', 'unknown']]) {
    const event = { title: 'CONTROL', city: input };
    captureConsoleLog(() => { normalizer.normalize(event); });
    assert.equal(event.city, expected, `"${input}" must resolve to "${expected}"`);
    assert.equal(event._unrecognizedCity, undefined, `"${input}" must never be refused`);
  }
});

test('unrecognized city: the gate is inert when no cities config is injected (missing dependency ≠ erase)', () => {
  const core = new SharedCore({}, { eventSchema: EventSchema });
  const normalizer = new LocationNormalizer(core);
  const event = { title: 'NO CONFIG', city: 'socal / southwest' };

  captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'socal / southwest', 'with no allowlist there is nothing to fail closed against');
  assert.equal(event._unrecognizedCity, undefined);
});

// ---------------------------------------------------------------------------
// Curated venue backfill from site identity (run 20260802-222252: "SHOCK
// Therapy" logged `Backfilled city "dallas" ... from site identity
// thedallaseagle.com (curated: "Dallas Eagle")` and still shipped with no bar,
// no address and no pin — while every sibling event on that page carried
// "Dallas Eagle", "525 S Riverfront Blvd, Dallas, TX 75207" and the curated
// coordinates. Its maps link degraded to a search for the bare word "dallas").
// ---------------------------------------------------------------------------

const DALLAS_EAGLE_BAR = {
  name: 'Dallas Eagle',
  city: 'dallas',
  address: '525 S Riverfront Blvd, Dallas, TX 75207',
  coordinates: '32.7693483, -96.8112576',
  website: 'https://www.thedallaseagle.com',
  instagram: 'https://www.instagram.com/thedallaseagle',
  googleMaps: 'https://www.google.com/maps/place/?q=place_id:ChIJU843NR6cToYROpJZCM8p4-I'
};

function createVenueIdentityNormalizer(bars) {
  const core = new SharedCore(
    { dallas: { calendar: 'chunky-dad-dallas', timezone: 'America/Chicago', patterns: ['dallas'] },
      nyc: { calendar: 'chunky-dad-nyc', timezone: 'America/New_York', patterns: ['new york', 'nyc'] } },
    { eventSchema: EventSchema, bars }
  );
  return new LocationNormalizer(core);
}

test('site-identity venue backfill: literal SHOCK Therapy repro — bar, address and pin come from the same curated match', () => {
  const normalizer = createVenueIdentityNormalizer({ dallas: [DALLAS_EAGLE_BAR] });
  const event = {
    title: 'SHOCK Therapy',
    city: 'unknown',
    website: 'https://www.thedallaseagle.com/events/',
    startDate: '2026-08-01T22:00:00.000Z'
  };

  const lines = captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'dallas');
  assert.equal(event.bar, 'Dallas Eagle', 'the host names the venue, not just the city');
  assert.equal(event.barSource, 'venue-site-identity');
  assert.equal(event.address, '525 S Riverfront Blvd, Dallas, TX 75207', 'the curated address, never the stale Maple Ave one');
  assert.equal(event.addressSource, 'curated');
  assert.equal(event.location, '32.7693483, -96.8112576');
  assert.equal(event.pinSource, 'curated');
  assert.equal(event.gmaps, DALLAS_EAGLE_BAR.googleMaps, 'the curated place_id link, not a search for the word "dallas"');
  assert.equal(event.instagram, DALLAS_EAGLE_BAR.instagram);
  assert.ok(
    lines.some(line => line.includes('Filled bar, address, location, gmaps, instagram for "SHOCK Therapy" from curated bar "Dallas Eagle"')),
    `the venue fill must be visible: ${lines.join('\n')}`
  );
});

test('site-identity venue backfill: fill-only — a bar the page named is never replaced', () => {
  const normalizer = createVenueIdentityNormalizer({ dallas: [DALLAS_EAGLE_BAR] });
  const event = {
    title: 'Road Show',
    city: 'unknown',
    bar: 'Some Other Room',
    website: 'https://www.thedallaseagle.com/events/road-show/'
  };

  captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'dallas', 'the city still backfills');
  assert.equal(event.bar, 'Some Other Room', 'the page outranks an inference from the host');
  assert.equal(event.address, undefined, 'nothing else is filled from a venue the event did not claim');
  assert.equal(event.location, undefined);
});

test('site-identity venue backfill: an off-site street address fails closed (multi-venue safety)', () => {
  const normalizer = createVenueIdentityNormalizer({ dallas: [DALLAS_EAGLE_BAR] });
  const event = {
    title: 'Warehouse Takeover',
    city: 'unknown',
    address: '900 Elm St, Dallas, TX 75202',
    website: 'https://www.thedallaseagle.com/events/warehouse/'
  };

  const lines = captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'dallas');
  assert.equal(event.bar, undefined, 'a party at another address is not this venue');
  assert.equal(event.location, undefined, 'and never gets this venue\'s pin');
  assert.ok(
    lines.some(line => line.includes('Venue backfill skipped for "Warehouse Takeover" — its address "900 Elm St, Dallas, TX 75202" is not curated "Dallas Eagle"\'s address')),
    `the skip must be visible: ${lines.join('\n')}`
  );
});

test('site-identity venue backfill: two curated claimants on one host fill the city only', () => {
  const normalizer = createVenueIdentityNormalizer(THREE_DOLLAR_BILL_BARS);
  const event = {
    title: 'The Have Not Room',
    city: 'unknown',
    website: 'https://www.3dollarbillbk.com'
  };

  const lines = captureConsoleLog(() => { normalizer.normalize(event); });

  assert.equal(event.city, 'nyc', 'sister venues still agree on the city');
  assert.equal(event.bar, undefined, 'but not on which room the event is in');
  assert.equal(event.address, undefined);
  assert.equal(event.location, undefined);
  assert.ok(
    lines.some(line => line.includes('Venue backfill skipped for "The Have Not Room" — site 3dollarbillbk.com is claimed by 2 curated bars')),
    `the ambiguity skip must be visible: ${lines.join('\n')}`
  );
});

// ---------------------------------------------------------------------------
// Region-less geocoding (run 20260802-220918: "Get 2 Soaked | Babe Night" —
// address "619 E Pine", city unresolved. The ladder issued
// "Massive Club, 619 E Pine, unknown" and "619 E Pine, unknown" (0 results
// each), then handed Photon the bare street line, which answered
// 39.2327933, -86.6282171 — southern Indiana, ~3,000 km from Seattle. It was
// written as pinSource "geocoded-exact"; the reverse cross-check compares the
// placemark against the INPUT ADDRESS STRING only, so a city-less address
// matches its own street name anywhere on earth.)
// ---------------------------------------------------------------------------

test('region-less geocode: the literal 619 E Pine repro asks nobody and pins nothing', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter([
    ['nominatim', []],
    ['photon.komoot.io', { features: [{
      geometry: { coordinates: [-86.6282171, 39.2327933] },
      properties: { name: 'Pine', housenumber: '619', street: 'East Pine Street', city: 'Nashville', osm_key: 'building', osm_value: 'yes' }
    }] }]
  ]);
  // 'unknown' is what LocationNormalizer writes when nothing resolves — the
  // literal value the run carried into the ladder.
  const event = { title: 'Get 2 Soaked | Babe Night', bar: 'Massive Club', address: '619 E Pine', city: 'unknown' };

  const lines = await withCapturedConsole(() => normalizer.normalizeAsync(event, httpAdapter));

  assert.equal(event.location, undefined, 'no pin beats a pin 3,000 km away');
  assert.ok(
    !httpAdapter.requests.some(url => url.includes('photon.komoot.io')),
    `Photon must never be handed the bare street line: ${httpAdapter.requests.join(' | ')}`
  );
  assert.ok(
    !httpAdapter.requests.some(url => url.includes(encodeURIComponent('unknown'))),
    `the 'unknown' sentinel is not a place and never anchors a query: ${httpAdapter.requests.join(' | ')}`
  );
  assert.ok(
    lines.some(l => l.includes('Address "619 E Pine" names no city or region and the event has none')),
    `the refusal must be visible: ${lines.join(' | ')}`
  );
});

test('region-less geocode: a resolvable city still anchors the ladder exactly as before', async () => {
  const normalizer = createOsmNormalizerWithCoords();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createStubHttpAdapter([PORTLAND_RESULT]);
  const event = { title: 'PRIDE FRIDAY', address: '722 E Burnside', city: 'portland' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.location, '45.5230622, -122.6564816', 'a real city anchors the query and the gate stays out of the way');
  assert.ok(
    httpAdapter.requests[0].includes(encodeURIComponent('722 E Burnside, portland')),
    `the city must still anchor: ${httpAdapter.requests[0]}`
  );
});

test('metro cross-check: a placemark in another metro refuses the pin even when the street name matches', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  // The address carries place context, so the query IS issued — but the
  // geocoder answers with a same-named street in another state.
  const httpAdapter = createRoutedStubAdapter([
    ['nominatim', [{
      lat: '39.2327933',
      lon: '-86.6282171',
      class: 'building',
      type: 'yes',
      addresstype: 'building',
      display_name: '619, East Pine Street, Nashville, Brown County, Indiana, United States',
      address: { house_number: '619', road: 'East Pine Street', town: 'Nashville' }
    }]]
  ], {
    supportsReverseGeocode: () => true,
    reverseGeocodePlacemark: async () => ({
      subThoroughfare: '619',
      thoroughfare: 'East Pine Street',
      locality: 'Nashville',
      administrativeArea: 'Indiana'
    })
  });
  const event = { title: 'Get 2 Soaked | Babe Night', address: '619 E Pine, Capitol Hill' };

  const lines = await withCapturedConsole(() => normalizer.normalizeAsync(event, httpAdapter));

  assert.equal(event.location, undefined, 'the street name matched — the metro did not');
  assert.ok(
    lines.some(l => l.includes('pin refused — it sits in "Nashville, Indiana"')),
    `the metro refusal must be visible: ${lines.join(' | ')}`
  );
});

test('metro cross-check: a placemark the address itself names is corroborated and pins', async () => {
  const normalizer = createOsmNormalizer();
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createRoutedStubAdapter([['nominatim', [POWERHOUSE_POI_RESULT]]], {
    supportsReverseGeocode: () => true,
    reverseGeocodePlacemark: async () => FOLSOM_PLACEMARK
  });
  const event = { title: 'CHUNK', address: '1192 Folsom St, San Francisco' };

  await normalizer.normalizeAsync(event, httpAdapter);

  assert.equal(event.location, '37.7756941, -122.4103049', 'the address names San Francisco and so does the placemark');
});

test('extractCityFromAddress probes an address without reporting it as an Unknown city', async () => {
  const core = new SharedCore(CITY_GATE_CITIES, { eventSchema: EventSchema });
  const normalizer = new LocationNormalizer(core);

  const lines = await withCapturedConsole(() => {
    assert.equal(normalizer.extractCityFromAddress('619 E Pine'), null, 'a bare street line is still no city');
  });

  assert.ok(
    !lines.some(l => l.includes('Unknown city "619 e pine"')),
    `an internal probe must not manufacture an Unknown-city warning: ${lines.join(' | ')}`
  );
});

// ---------------------------------------------------------------------------
// CURATED-ADDRESS PIN RUNG (run 20260803-091019: 8 of 9 3 Dollar Bill events
// shipped with no `location` at all. The corpus's ONE curated bar carrying an
// `address` with no `coordinates` — "The Yard at 9 Bob Note", 270 Meserole St
// — could never contribute a pin, so an event matched to it stayed unpinned
// even though the owner's own data says exactly where it is.)
//
// The rung geocodes the CURATED address (place-anchored, trustworthy) and
// never a scraped one, keeps the #1619 place-context guard, reuses the
// existing request cache, and stamps honest provenance: 'curated-geocoded'.
// ---------------------------------------------------------------------------

const CURATED_PIN_CITIES = {
  nyc: {
    timezone: 'America/New_York',
    patterns: ['new york', 'nyc', 'brooklyn'],
    coordinates: { lat: 40.7128, lng: -74.006 }
  }
};

// The real shape: an address, a website, and NO coordinates.
const YARD_CURATED_NO_PIN = {
  name: 'The Yard at 9 Bob Note',
  city: 'nyc',
  address: '270 Meserole St, Brooklyn, NY 11206',
  website: 'https://www.3dollarbillbk.com'
};

const MESEROLE_270_RESULT = {
  lat: '40.7085073',
  lon: '-73.9377167',
  display_name: '270, Meserole Street, Brooklyn, Kings County, New York, 11206, United States',
  class: 'building',
  type: 'yes',
  address: { house_number: '270', road: 'Meserole Street', city: 'New York', county: 'Kings County', state: 'New York' }
};

const SCOTT_99_RESULT = {
  lat: '40.7100000',
  lon: '-73.9250000',
  display_name: '99, Scott Avenue, Brooklyn, Kings County, New York, 11237, United States',
  class: 'building',
  type: 'yes',
  address: { house_number: '99', road: 'Scott Avenue', city: 'New York', county: 'Kings County', state: 'New York' }
};

function createCuratedPinCore(bars) {
  return new SharedCore(CURATED_PIN_CITIES, { eventSchema: EventSchema, bars: { nyc: bars } });
}

function createCuratedPinPipeline(bars = [YARD_CURATED_NO_PIN]) {
  const pipeline = new NormalizerPipeline();
  pipeline.setCore(createCuratedPinCore(bars));
  const osm = pipeline.normalizers[pipeline.normalizers.length - 1];
  osm.delayForRateLimit = async () => {};
  return pipeline;
}

test('curated-address handoff: a curated bar with an address but no coordinates hands its OWN address to the geocode rung', () => {
  const normalizer = new BarDataNormalizer(createCuratedPinCore([YARD_CURATED_NO_PIN]));
  // The event carries its own, scruffier address — the handoff must ignore it.
  const event = { title: 'party...or something', city: 'nyc', bar: '9 Bob Note', address: '270 Meserole St. BK' };

  const lines = captureConsoleLog(() => normalizer.normalize(event));

  assert.equal(event._curatedPinAddress, '270 Meserole St, Brooklyn, NY 11206',
    'the CURATED address is what gets handed over');
  assert.equal(event._curatedPinBar, 'The Yard at 9 Bob Note');
  assert.equal(event.address, '270 Meserole St. BK', 'the event keeps its own address');
  assert.ok(
    lines.some(l => l.includes('🗺️ CURATED PIN: curated bar "The Yard at 9 Bob Note" has an address but no coordinates')),
    `the handoff must be visible: ${lines.join(' | ')}`
  );
});

test('curated-address handoff: never fires for a curated bar that HAS coordinates, or for an already-pinned event', () => {
  // Positive control first: the same normalizer DOES hand over for the
  // no-coordinates bar, so the two refusals below are refusals and not a
  // mechanism that never runs.
  const control = new BarDataNormalizer(createCuratedPinCore([YARD_CURATED_NO_PIN]));
  const controlEvent = { title: 'party', city: 'nyc', bar: '9 Bob Note' };
  captureConsoleLog(() => control.normalize(controlEvent));
  assert.equal(controlEvent._curatedPinAddress, '270 Meserole St, Brooklyn, NY 11206');

  const withPin = { ...YARD_CURATED_NO_PIN, coordinates: '40.7085073, -73.9377167' };
  const pinned = new BarDataNormalizer(createCuratedPinCore([withPin]));
  const pinnedEvent = { title: 'party', city: 'nyc', bar: '9 Bob Note' };
  captureConsoleLog(() => pinned.normalize(pinnedEvent));
  assert.equal(pinnedEvent._curatedPinAddress, undefined, 'curated coordinates are used directly — nothing to geocode');
  assert.equal(pinnedEvent.pinSource, 'curated');

  const normalizer = new BarDataNormalizer(createCuratedPinCore([YARD_CURATED_NO_PIN]));
  const alreadyPinned = { title: 'party', city: 'nyc', bar: '9 Bob Note', location: '40.5, -73.5', pinSource: 'page' };
  captureConsoleLog(() => normalizer.normalize(alreadyPinned));
  assert.equal(alreadyPinned._curatedPinAddress, undefined, 'a pinned event never asks for another pin');
  assert.equal(alreadyPinned.pinSource, 'page');
});

test('curated-address handoff: the site-identity venue fill hands over too when the curated record has no pin', () => {
  const normalizer = new LocationNormalizer(createCuratedPinCore([YARD_CURATED_NO_PIN]));
  const event = { title: 'Big Gay Foam Party', city: 'unknown', website: 'https://www.3dollarbillbk.com' };

  captureConsoleLog(() => normalizer.backfillCityFromIdentitySignals(event));

  assert.equal(event.bar, 'The Yard at 9 Bob Note', 'the sole claimant names the venue');
  assert.equal(event._curatedPinAddress, '270 Meserole St, Brooklyn, NY 11206');
  assert.equal(event.location, undefined, 'the sync rung cannot pin — it hands the address on');
});

test('curated-address pin rung: an unpinned curated venue is pinned from its CURATED address, stamped curated-geocoded', async () => {
  const pipeline = createCuratedPinPipeline();
  const httpAdapter = createRoutedStubAdapter([
    [encodeURIComponent('270 Meserole St, Brooklyn, NY 11206'), [MESEROLE_270_RESULT]]
  ]);

  let normalized;
  const lines = await withCapturedConsole(async () => {
    normalized = await pipeline.normalizeEventAsync({
      title: 'party...or something: the lucky me tour afterparty',
      bar: '9 Bob Note',
      city: 'nyc',
      address: '270 Meserole St. BK',
      startDate: new Date('2026-08-14T02:00:00.000Z')
    }, httpAdapter);
  });

  assert.equal(normalized.location, '40.7085073, -73.9377167', 'the curated address produced the pin');
  assert.equal(normalized.pinSource, 'curated-geocoded',
    'honest provenance: curated address, geocoded coordinates — neither "curated" nor "geocoded-exact"');
  assert.equal(httpAdapter.requests.length, 1, 'one query, and the ladder short-circuits after it');
  assert.equal(decodeQueryParam(httpAdapter.requests[0]), '270 Meserole St, Brooklyn, NY 11206, new york',
    'the CURATED address is what was asked — never the event\'s "270 Meserole St. BK"');
  assert.ok(
    lines.some(l => l.includes('🗺️ CURATED PIN:') && l.includes('-> 40.7085073, -73.9377167')),
    `the accept must be visible: ${lines.join(' | ')}`
  );
});

test('curated-address pin rung: the curated address is geocoded ONCE for every event at that venue', async () => {
  const pipeline = createCuratedPinPipeline();
  const httpAdapter = createRoutedStubAdapter([
    [encodeURIComponent('270 Meserole St, Brooklyn, NY 11206'), [MESEROLE_270_RESULT]]
  ]);

  let normalized;
  await withCapturedConsole(async () => {
    normalized = await pipeline.normalizeEventsAsync([
      { title: 'Foam Party', bar: '9 Bob Note', city: 'nyc', startDate: new Date('2026-08-14T02:00:00.000Z') },
      { title: 'Afro Carnival', bar: '9 Bob Note', city: 'nyc', startDate: new Date('2026-08-15T02:00:00.000Z') },
      { title: 'Galaxy Brain Ball', bar: '9 Bob Note', city: 'nyc', startDate: new Date('2026-08-16T02:00:00.000Z') }
    ], httpAdapter);
  });

  assert.equal(normalized.length, 3);
  for (const event of normalized) {
    assert.equal(event.location, '40.7085073, -73.9377167', `${event.title} must be pinned`);
    assert.equal(event.pinSource, 'curated-geocoded');
  }
  assert.equal(httpAdapter.requests.length, 1,
    `the existing request cache must serve the repeats: ${JSON.stringify(httpAdapter.requests)}`);
});

test('curated-address pin rung: keeps the #1619 guard — a curated address naming no place is never geocoded globally', async () => {
  const core = createCuratedPinCore([YARD_CURATED_NO_PIN]);
  const normalizer = new OpenStreetMapNormalizer(core);
  normalizer.delayForRateLimit = async () => {};
  const httpAdapter = createStubHttpAdapter([MESEROLE_270_RESULT]);
  // A curated address with no city, no region and no postal code, on an event
  // whose city never resolved: exactly the shape that pinned a Seattle event
  // in southern Indiana. The rung must ask nobody.
  const event = { title: 'MYSTERY EVENT', _curatedPinAddress: '270 Meserole St', _curatedPinBar: 'The Yard at 9 Bob Note' };

  const lines = await withCapturedConsole(() => normalizer.normalizeAsync(event, httpAdapter));

  assert.equal(event.location, undefined, 'an unanchored address is never geocoded, curated or not');
  assert.equal(httpAdapter.requests.length, 0, 'the planet is never asked');
  assert.ok(
    lines.some(l => l.includes('Address "270 Meserole St" names no city or region and the event has none')),
    `the refusal must be visible: ${lines.join(' | ')}`
  );
});

test('curated-address pin rung: when the curated address resolves to nothing the event\'s own address rungs run unchanged', async () => {
  const pipeline = createCuratedPinPipeline();
  const httpAdapter = createRoutedStubAdapter([
    [encodeURIComponent('270 Meserole St, Brooklyn, NY 11206'), []],
    [encodeURIComponent('99 Scott Ave, Brooklyn, NY 11237'), [SCOTT_99_RESULT]]
  ]);

  let normalized;
  const lines = await withCapturedConsole(async () => {
    normalized = await pipeline.normalizeEventAsync({
      title: 'Yard Takeover',
      bar: '9 Bob Note',
      city: 'nyc',
      address: '99 Scott Ave, Brooklyn, NY 11237',
      startDate: new Date('2026-08-14T02:00:00.000Z')
    }, httpAdapter);
  });

  assert.equal(normalized.location, '40.7100000, -73.9250000', 'the event\'s own address still pins it');
  assert.equal(normalized.pinSource, 'geocoded-exact', 'a pin from the event address keeps its own provenance');
  assert.ok(
    lines.some(l => l.includes('🗺️ CURATED PIN: curated address "270 Meserole St, Brooklyn, NY 11206"')
      && l.includes('falling back to the event\'s own address rungs')),
    `the fallback must be visible: ${lines.join(' | ')}`
  );
});

// ---------------------------------------------------------------------------
// Curated data: "The Yard at 9 Bob Note" carries coordinates (geocoder-derived
// — see the commit message), so the corpus itself pins the run-20260803-091019
// events without any geocode call at all.
// ---------------------------------------------------------------------------

test('curated corpus: every curated bar with an address also carries coordinates', () => {
  const scraperBars = require('./scraper-bars');
  const missing = [];
  for (const [cityKey, cityBars] of Object.entries(scraperBars)) {
    if (!Array.isArray(cityBars)) continue;
    for (const bar of cityBars) {
      const address = typeof bar.address === 'string' ? bar.address.trim() : '';
      const coordinates = typeof bar.coordinates === 'string' ? bar.coordinates.trim() : '';
      if (address && !coordinates) missing.push(`${cityKey}/${bar.name}`);
    }
  }
  assert.deepEqual(missing, [], 'a curated address with no pin cannot place its events');
});

test('curated corpus: the 3 Dollar Bill sibling venue pins its events straight from curated data', async () => {
  const scraperBars = require('./scraper-bars');
  const pipeline = new NormalizerPipeline();
  pipeline.setCore(new SharedCore(CURATED_PIN_CITIES, { eventSchema: EventSchema, bars: { nyc: scraperBars.nyc } }));
  const osm = pipeline.normalizers[pipeline.normalizers.length - 1];
  osm.delayForRateLimit = async () => {};
  const httpAdapter = createStubHttpAdapter([]);

  let normalized;
  await withCapturedConsole(async () => {
    // Verbatim shape of run 20260803-091019's only unpinned event that named
    // a venue at all.
    normalized = await pipeline.normalizeEventAsync({
      title: 'party...or something: the lucky me tour afterparty',
      bar: '9 Bob Note',
      city: 'nyc',
      address: '270 Meserole St, Brooklyn, NY, 11206',
      startDate: new Date('2026-08-14T02:00:00.000Z')
    }, httpAdapter);
  });

  assert.equal(normalized.location, '40.7085073, -73.9377167', 'the curated pin places the event');
  assert.equal(normalized.pinSource, 'curated');
  assert.equal(httpAdapter.requests.length, 0, 'curated data means no geocode request at all');
});

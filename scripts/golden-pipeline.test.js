// ============================================================================
// GOLDEN PIPELINE TEST
// ============================================================================
// Drives the REAL scraping pipeline end-to-end over a small hand-crafted
// promoter site (scripts/fixtures/fixture-promoter/, modeled on the
// bearracuda.com structure seen in production):
//
//   landing page (link-aggregator, JSON-LD @graph Organization/WebSite)
//     ├── /events/new-orleans      (event page, og:title "… | FIXTURE")
//     ├── /events/san-francisco    (event page, organizer-as-bar AI leak)
//     └── tickets.example/…        (third-party ticketing page whose MusicEvent
//                                   JSON-LD describes the SAME event as
//                                   /events/new-orleans → dedup + merge)
//
// The AI endpoint, the page fetches, and the Nominatim geocoder are all served
// by in-test stubs, so the run is fully offline and deterministic. The whole
// stack is real: SharedCore.processParser → crawl → classifyPage(+AI) →
// AiWebParser.parseEvents → NormalizerPipeline (incl. geocoding) →
// SharedCore.deduplicateEvents.
//
// IMPORTANT: assertions cover FINAL OUTPUT ONLY — never request counts, pass
// ordering, or prompt text. The AI stub matches requests on the *kind of answer
// being requested* (classification / arbitration / extraction) and on which
// fixture page's content is present, so changes to pass mechanics (extra
// passes, reordered passes, prompt rewording) must not break this test.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { SharedCore } = require('./shared-core');
const { EventSchema } = require('./event-schema');
const { NormalizerPipeline } = require('./normalizers');
const { AiWebParser } = require('./parsers/ai-web-parser');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'fixture-promoter');
const readFixture = (name) => fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');

const SITE = 'https://fixturepromoter.example';
const TICKETS_URL = 'https://tickets.example/e/fixture-new-orleans/tickets';

const PAGES = {
  [`${SITE}/`]: 'landing.html',
  [`${SITE}/events/new-orleans`]: 'event-new-orleans.html',
  [`${SITE}/events/san-francisco`]: 'event-san-francisco.html',
  [TICKETS_URL]: 'tickets-new-orleans.html'
};

// Cities config mirrors scraper-cities.js entries (patterns + timezone +
// center coordinates, which the geocoder uses for candidate distance ranking).
const CITIES = {
  nola: {
    calendar: 'chunky-dad-nola',
    timezone: 'America/Chicago',
    patterns: ['new orleans', 'nola'],
    coordinates: { lat: 29.9511, lng: -90.0715 }
  },
  sf: {
    calendar: 'chunky-dad-sf',
    timezone: 'America/Los_Angeles',
    patterns: ['san francisco', 'sf'],
    coordinates: { lat: 37.7749, lng: -122.4194 }
  }
};

// ---------------------------------------------------------------------------
// Canned AI responses (per-field evidence+confidence format, exactly what the
// local model returns in production). Every value is verbatim on the fixture
// page so the evidence-validation gate keeps it.
// ---------------------------------------------------------------------------

// New Orleans event page: a clean extraction. The venue matches the ticketing
// page's JSON-LD venue so the dedup merge is deterministic regardless of which
// record the crawl encounters first.
const NOLA_EXTRACTION = JSON.stringify({
  name: { value: 'New Orleans Party | FIXTURE', evidence: 'og:title New Orleans Party | FIXTURE', confidence: 95 },
  venue: { value: 'Oak Barrel Saloon', evidence: '🪩 Oak Barrel Saloon', confidence: 95 },
  addr: { value: '800 Bourbon St, New Orleans, LA, 70116', evidence: '800 Bourbon St, New Orleans, LA, 70116', confidence: 95 },
  city: { value: 'new orleans', evidence: 'New Orleans', confidence: 90 },
  startDate: { value: '2026-09-04', evidence: 'Friday, September 4, 2026', confidence: 95 },
  startTime: { value: '21:00', evidence: 'Doors Open at 9:00 pm', confidence: 90 },
  endTime: { value: '02:00', evidence: 'Party Goes Until 2:00 am!', confidence: 90 },
  tickets: { value: TICKETS_URL, evidence: 'Get Tickets', confidence: 90 },
  // Low-confidence hallucination: must be dropped by the confidence filter.
  cover: { value: '$15', evidence: '', confidence: 20 }
});

// San Francisco event page: the organizer-as-bar leak seen in production
// bearracuda.com runs — the page has no venue text, and the model returns the
// promoter brand as the venue. The brand guard must drop it end-to-end.
const SF_EXTRACTION = JSON.stringify({
  name: { value: 'San Francisco Party | FIXTURE', evidence: 'og:title San Francisco Party | FIXTURE', confidence: 95 },
  venue: { value: 'FIXTURE', evidence: 'Presented by FIXTURE', confidence: 60 },
  addr: { value: '1548 Polk St, San Francisco, CA 94109', evidence: '1548 Polk St, San Francisco, CA 94109', confidence: 95 },
  city: { value: 'san francisco', evidence: 'San Francisco', confidence: 90 },
  startDate: { value: '2026-09-11', evidence: 'Friday, September 11, 2026', confidence: 95 },
  startTime: { value: '21:00', evidence: 'Doors Open at 9:00 pm', confidence: 90 },
  endTime: { value: '02:00', evidence: 'Party Goes Until 2:00 am!', confidence: 90 }
});

const classifyAnswer = (classification) => JSON.stringify({
  classification,
  confidence: 92,
  reason: 'fixture classification'
});

// Scripted Nominatim forward-geocode candidates (first candidate is inside the
// city-center acceptance radius).
const GEOCODE_RESULTS = [
  {
    match: /bourbon/i,
    results: [
      { lat: '29.9611', lon: '-90.0645', display_name: '800, Bourbon Street, French Quarter, New Orleans, LA', address: { city: 'New Orleans' } }
    ]
  },
  {
    match: /polk/i,
    results: [
      // A same-named street in the wrong state, ranked out by distance…
      { lat: '38.5816', lon: '-121.4944', display_name: 'Polk Street, Sacramento, CA', address: { city: 'Sacramento' } },
      // …and the real candidate near the SF city center.
      { lat: '37.7935', lon: '-122.4217', display_name: '1548, Polk Street, San Francisco, CA', address: { city: 'San Francisco' } }
    ]
  }
];

// ---------------------------------------------------------------------------
// Stub adapters
// ---------------------------------------------------------------------------

// Decide what a prompt is asking for by the shape of the answer it requests,
// then answer based on which fixture page's content is in the prompt. This is
// intentionally independent of pass names, pass order, and request counts.
function respondToPrompt(prompt) {
  const text = String(prompt || '');

  // Page-classification requests ask for {"classification": …}
  if (text.includes('"classification"')) {
    if (text.includes('/events/new-orleans') || text.includes('/events/san-francisco')) {
      return classifyAnswer('event-page');
    }
    return classifyAnswer('link-aggregator');
  }

  // Merge-arbitration requests ask for {"pick": …} — decline so the
  // deterministic fallback path is exercised (no model dependency).
  if (text.includes('"pick"')) {
    return '';
  }

  // Extraction-ish requests (extraction, context-prep, repair, retries):
  // answer with the page's scripted event, whichever pass is asking.
  if (text.includes('Oak Barrel Saloon') || text.includes('New Orleans')) {
    return NOLA_EXTRACTION;
  }
  if (text.includes('Polk St') || text.includes('San Francisco')) {
    return SF_EXTRACTION;
  }
  return '';
}

function createStubHttpAdapter() {
  const adapter = {
    aiRequests: [],
    fetchedUrls: [],

    async fetchData(url) {
      adapter.fetchedUrls.push(url);
      const fixture = PAGES[url] || PAGES[String(url).replace(/\/$/, '')];
      if (fixture) {
        return { url, html: readFixture(fixture), statusCode: 200, headers: {} };
      }
      throw new Error(`Unexpected fetch in golden test: ${url}`);
    },

    // The geocoder reads Nominatim responses through the page-cache hooks
    // before ever calling fetchData — serving them here keeps the test
    // offline AND skips the 1.1s/request Nominatim rate-limit delay.
    getPageCacheConfig() {
      return { enabled: true, ttlDays: 1 };
    },
    async readCachedPage(url) {
      if (!/nominatim\.openstreetmap\.org\/search/.test(url)) return null;
      const query = decodeURIComponent(url);
      const entry = GEOCODE_RESULTS.find(candidate => candidate.match.test(query));
      return { html: JSON.stringify(entry ? entry.results : []) };
    },

    async postJson(endpoint, payload) {
      // Works for both providers: openai chat payloads and ollama generate payloads.
      const prompt = payload && Array.isArray(payload.messages)
        ? (typeof payload.messages[0].content === 'string'
          ? payload.messages[0].content
          : payload.messages[0].content.map(part => part.text || '').join('\n'))
        : String(payload && payload.prompt || '');
      adapter.aiRequests.push(prompt);
      const content = respondToPrompt(prompt);
      return {
        ok: true,
        status: 200,
        text: JSON.stringify({ choices: [{ message: { content } }] })
      };
    }
  };
  return adapter;
}

function createStubDisplayAdapter() {
  const lines = [];
  const log = (level) => async (message) => { lines.push(`[${level}] ${message}`); };
  return {
    lines,
    logInfo: log('info'),
    logWarn: log('warn'),
    logError: log('error'),
    logSuccess: log('success')
  };
}

// Mirrors the orchestrator wiring in bear-event-scraper-unified.js run().
function createPipeline() {
  const normalizerPipeline = new NormalizerPipeline();
  const core = new SharedCore(CITIES, {
    eventSchema: EventSchema,
    normalizerPipeline,
    bars: {}
  });
  normalizerPipeline.setCore(core);

  const aiParser = new AiWebParser({ normalizeUrl: core.normalizeUrl.bind(core) });
  aiParser.core = core;

  return { core, parsers: { 'ai-web': aiParser } };
}

const PARSER_CONFIG = {
  name: 'Fixture Promoter',
  parser: 'ai-web',
  enabled: true,
  urls: [`${SITE}/`],
  alwaysBear: true,
  allowPastEvents: true, // fixture dates are fixed — keep the test time-independent
  urlDiscoveryDepth: 1,
  ai: {
    enabled: true,
    provider: 'openai',
    endpoint: 'http://ai.fixture.test/v1/chat/completions',
    model: 'fixture-test-model',
    timeoutSeconds: 5,
    ocr: { enabled: false }
  }
};

const MAIN_CONFIG = {
  config: { dryRun: true },
  cities: CITIES
};

test('golden pipeline: fixture promoter site crawls, extracts, geocodes, and dedups to the final merged events', async () => {
  const { core, parsers } = createPipeline();
  const httpAdapter = createStubHttpAdapter();
  const displayAdapter = createStubDisplayAdapter();

  const result = await core.processParser(PARSER_CONFIG, MAIN_CONFIG, httpAdapter, displayAdapter, parsers, new Set());

  // ---- Final output only from here on ----
  const events = [...result.events].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

  // Three records were scraped (two event pages + the ticketing page); the two
  // records describing the same New Orleans event must merge into one.
  assert.equal(events.length, 2, `expected 2 final events, got ${events.length}: ${events.map(e => e.title).join(' / ')}`);
  assert.equal(result.duplicatesRemoved, 1, 'exactly one duplicate record must be merged away');

  const [nola, sf] = events;

  // --- New Orleans: merged from the event page + ticketing JSON-LD ---
  assert.equal(nola.title, 'New Orleans Party', 'brand suffix must be stripped from the title');
  assert.equal(nola.bar, 'Oak Barrel Saloon', 'bar must be the venue');
  assert.equal(nola.address, '800 Bourbon St, New Orleans, LA, 70116');
  assert.equal(nola.city, 'nola', 'city must resolve to the canonical city key');
  assert.equal(nola.timezone, 'America/Chicago');
  assert.equal(nola.ticketUrl, TICKETS_URL);
  // 9pm CDT with "until 2:00 am" — the end must roll over to the NEXT day and
  // agree with the ticketing page's explicit offsets.
  assert.equal(new Date(nola.startDate).toISOString(), '2026-09-05T02:00:00.000Z');
  assert.equal(new Date(nola.endDate).toISOString(), '2026-09-05T07:00:00.000Z');
  // location is ALWAYS coordinates (stubbed geocoder), never address text
  assert.ok(core.isCoordinatePair(nola.location), `nola location must be coordinates, got "${nola.location}"`);
  assert.equal(nola.location, '29.9611, -90.0645');
  assert.equal(nola.isBearEvent, true);

  // --- San Francisco: organizer-as-bar leak must be stopped by the guard ---
  assert.equal(sf.title, 'San Francisco Party', 'brand suffix must be stripped from the title');
  assert.equal(sf.bar || '', '', 'the promoter brand must never survive as the venue');
  assert.equal(sf.address, '1548 Polk St, San Francisco, CA 94109');
  assert.equal(sf.city, 'sf');
  assert.equal(sf.timezone, 'America/Los_Angeles');
  // 9pm PDT with "until 2:00 am" — rolled-over end on the next local day
  assert.equal(new Date(sf.startDate).toISOString(), '2026-09-12T04:00:00.000Z');
  assert.equal(new Date(sf.endDate).toISOString(), '2026-09-12T09:00:00.000Z');
  // Distance ranking must pick the candidate near the SF center, not Sacramento
  assert.ok(core.isCoordinatePair(sf.location), `sf location must be coordinates, got "${sf.location}"`);
  assert.equal(sf.location, '37.7935, -122.4217');

  // The promoter brand must not leak into any final field on any event.
  for (const event of events) {
    assert.ok(!/fixture/i.test(event.bar || ''), `bar leaked the organizer brand: "${event.bar}"`);
    assert.ok(!/\|\s*FIXTURE/i.test(event.title || ''), `title kept the brand suffix: "${event.title}"`);
    assert.equal(event.cover || '', '', 'the low-confidence cover hallucination must not survive');
    assert.equal(event.source, 'ai-web');
  }
});

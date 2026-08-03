const test = require('node:test');
const assert = require('node:assert/strict');

const { AiWebParser } = require('./ai-web-parser');
const { SharedCore } = require('../shared-core');
const { EventSchema } = require('../event-schema');

function normalizeUrl(url, baseUrl = 'https://furball.example/events') {
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return new URL(value, baseUrl || 'https://furball.example/events').toString();
  } catch (_) {
    return '';
  }
}

function createParser() {
  const parser = new AiWebParser({ normalizeUrl });
  parser.core = new SharedCore({}, { eventSchema: EventSchema });
  return parser;
}

test('pairs nearby row-split event images to the matching multi-event segments', () => {
  const parser = createParser();
  parser.core = { getResolvedFieldPriorities: (config) => config?.fieldPriorities || {} };
  const sourceUrl = 'https://furball.example/events';
  const html = `
    <html>
      <body>
        <section class="page-hero">
          <img src="/images/hero-banner.jpg" alt="Hero banner" />
        </section>

        <section class="events-grid">
          <div class="event-card-image"><img src="/images/event-1.jpg" alt="Furball Blackout flyer" /></div>
          <div class="event-card-image"><img src="/images/event-2.jpg" alt="Furball Pool Party flyer" /></div>
        </section>

        <article class="event-card-copy">
          <p>July 10, 2026</p>
          <h3>FURBALL BLACKOUT</h3>
          <p>3 Dollar Bill</p>
        </article>
        <article class="event-card-copy">
          <p>July 24, 2026</p>
          <h3>FURBALL POOL PARTY</h3>
          <p>Elsewhere Rooftop</p>
        </article>

        <article class="event-card">
          <div class="event-card-image"><img src="/images/event-3.jpg" alt="Furball Summer Bash flyer" /></div>
          <div class="event-card-copy">
            <p>August 14, 2026</p>
            <h3>FURBALL SUMMER BASH</h3>
            <p>Knockdown Center</p>
          </div>
        </article>

        <article class="event-card">
          <div class="event-card-image"><img src="/images/event-4.jpg" alt="Furball Labor Day flyer" /></div>
          <div class="event-card-copy">
            <p>September 4, 2026</p>
            <h3>FURBALL LABOR DAY</h3>
            <p>House of Yes</p>
          </div>
        </article>
      </body>
    </html>
  `;

  const segments = parser.buildMultiEventSegments(html, sourceUrl);
  assert.equal(segments.length, 4);

  const pairedImages = segments.map(segment => {
    const diagnostics = parser.describeMultiEventSegment(segment, sourceUrl);
    return diagnostics.imageUrls[0] || '';
  });

  assert.deepEqual(pairedImages, [
    'https://furball.example/images/event-1.jpg',
    'https://furball.example/images/event-2.jpg',
    'https://furball.example/images/event-3.jpg',
    'https://furball.example/images/event-4.jpg'
  ]);
  assert.ok(!pairedImages.includes('https://furball.example/images/hero-banner.jpg'));
  assert.deepEqual(segments.slice(0, 2).map(segment => segment.imageHintUrls), [
    ['https://furball.example/images/event-1.jpg'],
    ['https://furball.example/images/event-2.jpg']
  ]);
  assert.deepEqual(segments.slice(2).map(segment => segment.imageHintUrls || null), [null, null]);
});

test('validateAiEventEvidence should NOT delete trusted or internal fields', () => {
  // Mock EventSchema for testing
  global.EventSchema = {
    AI_PROMPT_FIELDS: [
      { param: 'title', desc: 'Event title' },
      { param: 'startDate', desc: 'Start date' }
    ],
    canonicalizeEventKey: (key) => key.toLowerCase()
  };

  const parser = createParser();
  const aiEvent = {
    title: 'Furball',
    startDate: '2026-07-11',
    __internal: 'keep me'
  };

  const htmlData = { html: 'Some content' };
  const evidenceContext = parser.buildAiEvidenceContextFromText('Some content');
  const validationContext = { imageEvidenceUrls: new Set() };

  // Test trusted fields
  const result = parser.validateAiEventEvidence(aiEvent, htmlData, {}, null, {
    evidenceContext,
    validationContext,
    trustedFields: ['title']
  });

  assert.ok(result.event.title, 'title should be kept because it is trusted');
  assert.equal(result.event.title, 'Furball');

  // Test internal fields
  assert.ok(result.event.__internal, '__internal should be kept because it is internal');

  // Test field not in evidence but NOT strict
  const nonStrictResult = parser.validateAiEventEvidence(
    { startDate: '2026-07-11' },
    htmlData,
    { ai: { validation: { strict: false } } },
    null,
    {
      evidenceContext,
      validationContext
    }
  );
  assert.ok(nonStrictResult.event.startDate, 'startDate should be kept when strict is false even if evidence is missing');
});

test('getAiPromptFields should group and sort split date/time fields correctly', () => {
  // Mock EventSchema specifically for this test to ensure consistency
  global.EventSchema = {
    AI_PROMPT_FIELDS: [
      { param: 'name',    desc: 'Name' },
      { param: 'startDate', desc: 'Start Date' },
      { param: 'startTime', desc: 'Start Time' },
      { param: 'endDate', desc: 'End Date' },
      { param: 'endTime', desc: 'End Time' },
      { param: 'city', desc: 'City' }
    ],
    canonicalizeEventKey: (key) => {
      const map = {
        'name': 'title',
        'title': 'title',
        'startdate': 'startDate',
        'starttime': 'startTime',
        'enddate': 'endDate',
        'endtime': 'endTime',
        'city': 'city'
      };
      return map[key.toLowerCase()] || key;
    }
  };

  const parser = createParser();
  parser.core = { getResolvedFieldPriorities: (config) => config?.fieldPriorities || {} };

  const parserConfig = {
    fieldPriorities: {
      'startTime': { priority: ['ai-web'] },
      'endTime': { priority: ['ai-web'] },
      'startDate': { priority: ['ai-web'] },
      'endDate': { priority: ['ai-web'] },
      'name': { priority: ['ai-web'] }
    }
  };

  // Scenario 1: OCR enabled (dataFlags.ocr = true)
  const fields = parser.getAiPromptFields(parserConfig, { ocr: true });

  // Expected order based on our mock AI_PROMPT_FIELDS:
  // name (title), startDate (startdate), startTime (starttime), endDate (enddate), endTime (endtime), city (city)
  const normalizedFields = fields.map(f => parser.normalizePromptFieldName(f));

  const expectedOrder = ['title', 'startdate', 'starttime', 'enddate', 'endtime', 'city'];
  assert.deepEqual(normalizedFields, expectedOrder, 'Fields should be sorted according to EventSchema canonical order');
});

test('buildAiPayload and extractAiResponse support both Ollama and OpenAI', () => {
  const parser = createParser();
  const prompt = 'Extract event details';
  const base64Image = 'base64data';

  // Ollama Payload
  const ollamaConfig = {
    provider: 'ollama',
    model: 'qwen3.5:4b',
    numPredict: 512,
    temperature: 0,
    keepAlive: '5m'
  };
  const ollamaPayload = parser.core.buildAiPayload(ollamaConfig, prompt, base64Image);
  assert.equal(ollamaPayload.model, 'qwen3.5:4b');
  assert.equal(ollamaPayload.prompt, prompt);
  assert.deepEqual(ollamaPayload.images, [base64Image]);
  assert.equal(ollamaPayload.options.num_predict, 512);

  // OpenAI Payload (Text only)
  const openaiConfig = {
    provider: 'openai',
    model: 'gpt-4o',
    numPredict: 1024,
    temperature: 0.5
  };
  const openaiPayloadText = parser.core.buildAiPayload(openaiConfig, prompt);
  assert.equal(openaiPayloadText.model, 'gpt-4o');
  assert.equal(openaiPayloadText.messages[0].role, 'user');
  assert.equal(openaiPayloadText.messages[0].content, prompt);
  assert.equal(openaiPayloadText.max_tokens, 1024);
  assert.deepEqual(openaiPayloadText.response_format, { type: 'json_object' });

  // OpenAI Payload (Vision) — unknown magic bytes fall back to png
  const openaiPayloadVision = parser.core.buildAiPayload(openaiConfig, prompt, base64Image);
  assert.ok(Array.isArray(openaiPayloadVision.messages[0].content));
  assert.equal(openaiPayloadVision.messages[0].content[0].type, 'text');
  assert.equal(openaiPayloadVision.messages[0].content[0].text, prompt);
  assert.equal(openaiPayloadVision.messages[0].content[1].type, 'image_url');
  assert.equal(openaiPayloadVision.messages[0].content[1].image_url.url, `data:image/png;base64,${base64Image}`);

  // OpenAI Payload (Vision) — mime detected from base64 magic bytes
  const jpegBase64 = '/9j/4AAQSkZJRgABAQAAAQ';
  const openaiPayloadJpeg = parser.core.buildAiPayload(openaiConfig, prompt, jpegBase64);
  assert.equal(openaiPayloadJpeg.messages[0].content[1].image_url.url, `data:image/jpeg;base64,${jpegBase64}`);
  assert.equal(parser.core.detectBase64ImageMimeType('iVBORw0KGgoAAAANSUhEUg'), 'image/png');
  assert.equal(parser.core.detectBase64ImageMimeType('UklGRh4AAABXRUJQVlA4'), 'image/webp');

  // Response Extraction
  const ollamaResponse = { response: '{"title": "Ollama Event"}' };
  assert.equal(parser.core.extractAiResponse(ollamaConfig, ollamaResponse), '{"title": "Ollama Event"}');

  const openaiResponse = { choices: [{ message: { content: '{"title": "OpenAI Event"}' } }] };
  assert.equal(parser.core.extractAiResponse(openaiConfig, openaiResponse), '{"title": "OpenAI Event"}');
});

test('city survives evidence validation when the page only uses a configured alias', () => {
  const parser = createParser();
  const cityConfig = {
    nyc: { timezone: 'America/New_York', patterns: ['new york', 'nyc', 'brooklyn'] },
    chicago: { timezone: 'America/Chicago', patterns: ['chicago'] }
  };
  const evidenceContext = parser.buildAiEvidenceContextFromText('FURBALL PRESENTS UNDERBEAR ROCKBAR NYC 125 CHRISTOPHER ST NYC');
  const validationContext = { imageEvidenceUrls: new Set(), cityConfig };

  const result = parser.validateAiEventEvidence(
    { city: 'new york' },
    { html: 'irrelevant' },
    {},
    null,
    { evidenceContext, validationContext }
  );
  assert.equal(result.event.city, 'new york', 'canonical city should be kept via its "nyc" alias evidence');

  const mismatch = parser.validateAiEventEvidence(
    { city: 'chicago' },
    { html: 'irrelevant' },
    {},
    null,
    { evidenceContext, validationContext }
  );
  assert.equal(mismatch.event.city, undefined, 'city with no alias in evidence should still be dropped');
});

test('normalizeAiEvent falls back to the address to resolve the timezone', () => {
  const parser = createParser();
  const cityConfig = {
    nyc: { timezone: 'America/New_York', patterns: ['new york', 'nyc'] }
  };
  const aiEvent = {
    title: 'UNDERBEAR',
    startDate: '2026-07-17',
    startTime: '22:00',
    address: '125 Christopher St, New York, NY 10014'
  };

  const event = parser.normalizeAiEvent(aiEvent, {}, null, cityConfig, null);
  assert.ok(event, 'event should normalize');
  // 10pm EDT (UTC-4) on July 17 is 2am UTC on July 18
  assert.equal(event.startDate.toISOString(), '2026-07-18T02:00:00.000Z');
  assert.equal(event.timezone, 'America/New_York');
  assert.equal(event._timezoneUnresolved, undefined);
});

test('normalizeAiEvent flags wall-clock dates when no timezone can be resolved', () => {
  const parser = createParser();
  const aiEvent = {
    title: 'UNDERBEAR',
    startDate: '2026-07-17',
    startTime: '22:00'
  };

  const event = parser.normalizeAiEvent(aiEvent, {}, null, null, null);
  assert.ok(event, 'event should normalize');
  // Wall-clock fallback: local 10pm stored as 10pm UTC, flagged for downstream re-anchoring
  assert.equal(event.startDate.toISOString(), '2026-07-17T22:00:00.000Z');
  assert.equal(event._timezoneUnresolved, true);
});

test('normalizeAiEvent stamps imageSource og-image for the page\'s own meta artwork, page otherwise', () => {
  const parser = createParser();
  const htmlData = {
    url: 'https://bearracuda.com/events/sausage-party/',
    html: `<html><head>
      <meta property="og:image" content="https://Bearracuda.com/wp-content/Uploads/SausageWeb.jpg/" />
      <meta name="twitter:image" content="https://bearracuda.com/img.jpg?a=1&amp;b=2" />
    </head><body></body></html>`
  };
  const base = { title: 'SAUSAGE PARTY', startDate: '2026-08-01', startTime: '21:00' };

  // og:image match is robust to case and trailing-slash differences
  const ogEvent = parser.normalizeAiEvent(
    { ...base, image: 'https://bearracuda.com/wp-content/uploads/sausageweb.jpg' }, {}, htmlData, null, null);
  assert.equal(ogEvent.imageSource, 'og-image');

  // twitter:image counts too; the meta value is entity-decoded before comparing
  const twitterEvent = parser.normalizeAiEvent(
    { ...base, image: 'https://bearracuda.com/img.jpg?a=1&b=2' }, {}, htmlData, null, null);
  assert.equal(twitterEvent.imageSource, 'og-image');

  // A content/OCR/segment image that is NOT the page's meta artwork → page
  const pageEvent = parser.normalizeAiEvent(
    { ...base, image: 'https://static.wixstatic.com/media/8ff085_massiveparty~mv2.webp' }, {}, htmlData, null, null);
  assert.equal(pageEvent.imageSource, 'page');

  // No extracted image → a single-event page adopts its own og:image artwork
  const bareEvent = parser.normalizeAiEvent({ ...base }, {}, htmlData, null, null);
  assert.equal(bareEvent.imageSource, 'og-image');
  assert.equal(
    parser.canonicalizeImageUrlForComparison(bareEvent.image),
    parser.canonicalizeImageUrlForComparison('https://bearracuda.com/wp-content/uploads/sausageweb.jpg'));

  // No image and no page meta artwork → no stamp at all (fail open)
  const bareNoMetaEvent = parser.normalizeAiEvent(
    { ...base }, {}, { url: htmlData.url, html: '<html><head></head><body></body></html>' }, null, null);
  assert.equal('imageSource' in bareNoMetaEvent, false);

  // No htmlData (no meta to compare against) → the AI-web default, page
  const noHtmlEvent = parser.normalizeAiEvent(
    { ...base, image: 'https://x.example/poster.jpg' }, {}, null, null, null);
  assert.equal(noHtmlEvent.imageSource, 'page');
});

test('JSON-LD structured-data images are stamped imageSource jsonld', () => {
  const parser = createParser();
  const events = parser.extractEventsFromJsonLd(SICKENING_JSONLD_HTML, 'https://sickening.events/e/x');
  assert.equal(events.length, 1);
  assert.equal(events[0].image, 'https://res.cloudinary.example/cover.webp');
  assert.equal(events[0].imageSource, 'jsonld');

  // A node without an image gets no stamp (fail open)
  const bare = parser.buildEventFromJsonLdNode({
    '@type': 'Event', name: 'BEAR NIGHT', startDate: '2026-08-01T21:00:00-05:00'
  }, 'https://tickets.example/e/bear-night', null);
  assert.ok(bare, 'event should build');
  assert.equal('imageSource' in bare, false);
});

test('mergeAiEventFields canonicalizes lowercase response keys to schema keys', () => {
  const parser = createParser();
  const merged = parser.mergeAiEventFields({}, {
    startdate: '2026-07-17',
    starttime: '22:00',
    endtime: '02:00',
    bar: 'ROCKBAR',
    __internal: 'keep-raw'
  });

  assert.equal(merged.startDate, '2026-07-17');
  assert.equal(merged.startTime, '22:00');
  assert.equal(merged.endTime, '02:00');
  assert.equal(merged.bar, 'ROCKBAR');
  assert.equal(merged.__internal, 'keep-raw');
  assert.equal(merged.startdate, undefined, 'lowercase key should not survive the merge');
});

test('mergeAiEventFields still prefers already-resolved fields over retry values', () => {
  const parser = createParser();
  const merged = parser.mergeAiEventFields(
    { startDate: '2026-07-17' },
    { startdate: '2026-01-01' }
  );
  assert.equal(merged.startDate, '2026-07-17', 'primary-pass value should win');
});

test('retry-only extraction (lowercase keys) survives date normalization', () => {
  // Reproduces the segment-3 failure: primary pass timed out, retry pass returned
  // perfect data under lowercase keys, and the event was dropped with startDate=null.
  const parser = createParser();
  const retryResponse = {
    title: 'FURBALL',
    startdate: '2026-07-17',
    starttime: '22:00'
  };
  const merged = parser.mergeAiEventFields({}, retryResponse);
  const event = parser.normalizeAiEvent(merged, {}, null, null, null);

  assert.ok(event, 'event should survive normalization');
  assert.ok(event.startDate instanceof Date && !isNaN(event.startDate.getTime()));
  assert.equal(event.startDate.toISOString().slice(0, 10), '2026-07-17');
});

test('ensureSegmentOcrCoverage OCRs only segments the page-level pass missed', async () => {
  const parser = createParser();
  const coveredUrl = 'https://img.example/media/aaa~mv2.jpg/v1/fill/w_296,h_526/aaa~mv2.jpg';
  const missedUrl = 'https://img.example/media/bbb~mv2.png/v1/fill/w_296,h_296/bbb~mv2.png';

  const segments = [
    { lines: [], html: '', imageHintUrls: [coveredUrl] },
    { lines: [], html: '', imageHintUrls: [missedUrl] }
  ];
  const ocrResults = [
    { url: coveredUrl, text: 'FLYER ONE TEXT', imageClassification: 'event-flyer' }
  ];

  const ocrCalls = [];
  parser.getOcrTextForImage = async (url) => {
    ocrCalls.push(url);
    return { url, text: 'FURBALL AUSTIN @ 9PM', imageClassification: 'event-flyer' };
  };

  await parser.ensureSegmentOcrCoverage(segments, ocrResults, {}, 'https://img.example/', null);

  assert.deepEqual(ocrCalls, [missedUrl], 'only the uncovered segment image should be OCRd');
  assert.equal(ocrResults.length, 2);
  assert.equal(ocrResults[1].url, missedUrl);
  assert.equal(ocrResults[1].text, 'FURBALL AUSTIN @ 9PM');

  // The topped-up result must now match the previously uncovered segment
  const matched = parser.filterOcrResultsForSegment(ocrResults, segments[1], 'https://img.example/');
  assert.equal(matched.length, 1);
  assert.equal(matched[0].url, missedUrl);
});

test('ensureSegmentOcrCoverage is a no-op when OCR is disabled or coverage is complete', async () => {
  const parser = createParser();
  const url = 'https://img.example/media/ccc~mv2.jpg/v1/fill/w_296,h_526/ccc~mv2.jpg';
  const segments = [{ lines: [], html: '', imageHintUrls: [url] }];

  let called = false;
  parser.getOcrTextForImage = async () => {
    called = true;
    return null;
  };

  // Coverage complete (same image at a different size counts via stripped-URL match)
  const resizedUrl = 'https://img.example/media/ccc~mv2.jpg/v1/fill/w_592,h_1052/ccc~mv2.jpg';
  const covered = [{ url: resizedUrl, text: 'TEXT', imageClassification: 'event-flyer' }];
  await parser.ensureSegmentOcrCoverage(segments, covered, {}, 'https://img.example/', null);
  assert.equal(called, false, 'covered segment should not trigger OCR');
  assert.equal(covered.length, 1);

  // OCR disabled
  const empty = [];
  await parser.ensureSegmentOcrCoverage(segments, empty, { ai: { ocr: { enabled: false } } }, 'https://img.example/', null);
  assert.equal(called, false, 'disabled OCR should not trigger requests');
  assert.equal(empty.length, 0);
});

test('stripSizeParams collapses path-wrapped image proxy variants (img.evbuc.com)', () => {
  const parser = createParser();
  const inner = 'https://cdn.evbuc.com/images/1184410354/185013722403/1/original.20260512-160408';
  const encoded = encodeURIComponent(inner);
  const variantA = `https://img.evbuc.com/${encoded}?crop=focalpoint&fit=crop&w=940&auto=format%2Ccompress&q=75&s=79b82ef9b2961bb09d52102535747556`;
  const variantB = `https://img.evbuc.com/${encoded}?crop=focalpoint&fit=crop&w=1880&auto=format%2Ccompress&q=75&s=deadbeefdeadbeefdeadbeefdeadbeef`;

  const strippedA = parser.stripSizeParams(variantA);
  const strippedB = parser.stripSizeParams(variantB);
  const strippedInner = parser.stripSizeParams(inner);

  assert.equal(strippedA, strippedB, 'differently-sized/signed variants should collapse');
  assert.equal(strippedA, strippedInner, 'wrapped variants should collapse to the inner URL');

  const html = `
    <img src="${variantA}">
    <img src="${variantB}">
  `;
  const records = parser.extractOrderedImageRecordsFromHtml(html, 'https://www.eventbrite.com/e/test');
  assert.equal(records.length, 1, 'proxy variants of the same image should dedupe to one record');
  assert.equal(records[0].url, variantA, 'first (smaller) variant should win');
});

test('mapWithConcurrencyLimit bounds in-flight tasks and preserves order', async () => {
  const parser = createParser();
  let inFlight = 0;
  let maxInFlight = 0;
  const items = [1, 2, 3, 4, 5];
  const results = await parser.mapWithConcurrencyLimit(items, 2, async (item) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(resolve => setTimeout(resolve, 5));
    inFlight--;
    return item * 10;
  });
  assert.deepEqual(results, [10, 20, 30, 40, 50]);
  assert.equal(maxInFlight, 2, 'no more than `limit` tasks should run at once');
});

test('extractOcrFromAllImages respects maxImages without letting uninteresting images consume slots', async () => {
  const parser = createParser();
  const html = `
    <img src="https://x.example/logo-header.png">
    <img src="https://x.example/images/flyer-one.jpg">
    <img src="https://x.example/images/flyer-two.jpg">
    <img src="https://x.example/images/flyer-three.jpg">
  `;

  const ocrCalls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  parser.getOcrTextForImage = async (url) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(resolve => setTimeout(resolve, 2));
    inFlight--;
    ocrCalls.push(url);
    return { url, text: `TEXT FROM ${url}`, imageClassification: 'event-flyer' };
  };

  const results = await parser.extractOcrFromAllImages(
    { url: 'https://x.example/', html },
    { maxConcurrentRequests: 1 },
    null,
    2
  );

  assert.equal(ocrCalls.length, 2, 'only maxImages should be OCRd');
  assert.ok(ocrCalls.every(url => url.includes('flyer')), 'the uninteresting logo should not consume a slot');
  assert.equal(maxInFlight, 1, 'requests should be serialized');
  assert.equal(results.length, 2);
});

test('getOcrConfig defaults the openai provider to a vision model and accepts top-level ocr blocks', () => {
  const parser = createParser();

  // openai provider must never default to the text/coder extraction model,
  // and the default endpoint must be the VISION server (8001) — the text
  // server on 8000 rejects image input
  const openaiOcr = parser.getOcrConfig({ ai: { ocr: { provider: 'openai' } } });
  assert.equal(openaiOcr.provider, 'openai');
  assert.match(openaiOcr.model, /VL/i, 'openai OCR default must be a vision model');
  assert.equal(openaiOcr.endpoint, 'http://rybook.taila7523c.ts.net:8001/v1/chat/completions');

  // With NO provider configured at all, OCR defaults to the rybook vision
  // server — desktop ollama is explicit opt-in only
  const bare = parser.getOcrConfig({});
  assert.equal(bare.provider, 'openai');
  assert.equal(bare.endpoint, 'http://rybook.taila7523c.ts.net:8001/v1/chat/completions');
  assert.match(bare.model, /VL/i);

  // A mis-nested top-level ocr block should still configure OCR (fallback)...
  const topLevel = parser.getOcrConfig({ ocr: { maxImages: 3, concurrency: 2 } });
  assert.equal(topLevel.maxImages, 3);
  assert.equal(topLevel.maxConcurrentRequests, 2);

  // ...but the canonical ai.ocr block wins when both exist
  const both = parser.getOcrConfig({ ai: { ocr: { maxImages: 4 } }, ocr: { maxImages: 3 } });
  assert.equal(both.maxImages, 4);
});

test('getOcrConfig sees inherited global ocr through resolveEffectiveParserConfig', () => {
  const parser = createParser();
  const mainConfig = {
    config: {
      ocr: {
        provider: 'openai',
        endpoint: 'http://rybook.example:8001/v1/chat/completions',
        model: 'mlx-community/Qwen3-VL-4B-Instruct-4bit'
      }
    }
  };

  // Global ocr + no parser ocr → the global endpoint/model apply
  const inherited = parser.getOcrConfig(parser.core.resolveEffectiveParserConfig({ name: 'Plain' }, mainConfig));
  assert.equal(inherited.provider, 'openai');
  assert.equal(inherited.endpoint, 'http://rybook.example:8001/v1/chat/completions');
  assert.equal(inherited.model, 'mlx-community/Qwen3-VL-4B-Instruct-4bit');

  // Parser override wins key-wise: only `model` is set, the global endpoint is retained
  const overridden = parser.getOcrConfig(parser.core.resolveEffectiveParserConfig(
    { name: 'Override', ai: { ocr: { model: 'parser-vision-model' } } },
    mainConfig
  ));
  assert.equal(overridden.model, 'parser-vision-model');
  assert.equal(overridden.endpoint, 'http://rybook.example:8001/v1/chat/completions');

  // No global + no parser ocr → identical to today's hardcoded defaults
  const bareEntry = { name: 'Bare' };
  assert.deepEqual(
    parser.getOcrConfig(parser.core.resolveEffectiveParserConfig(bareEntry, { config: {} })),
    parser.getOcrConfig(bareEntry)
  );
});

test('getAiConfig sees inherited global ai through resolveEffectiveParserConfig', () => {
  const parser = createParser();
  const mainConfig = {
    config: {
      ai: {
        provider: 'openai',
        endpoint: 'http://rybook.example:8000/v1/chat/completions',
        model: 'global-extraction-model',
        numPredict: 2000
      }
    }
  };

  // Parser with no ai block inherits the global endpoint/model
  const inherited = parser.getAiConfig(parser.core.resolveEffectiveParserConfig({ name: 'Plain' }, mainConfig));
  assert.equal(inherited.endpoint, 'http://rybook.example:8000/v1/chat/completions');
  assert.equal(inherited.model, 'global-extraction-model');

  // Per-parser ai.numPredict overrides while the global endpoint is retained
  const overridden = parser.getAiConfig(parser.core.resolveEffectiveParserConfig(
    { name: 'Override', ai: { numPredict: 512 } },
    mainConfig
  ));
  assert.equal(overridden.numPredict, 512);
  assert.equal(overridden.endpoint, 'http://rybook.example:8000/v1/chat/completions');

  // No global + no parser ai → identical to today's hardcoded defaults
  const bareEntry = { name: 'Bare' };
  assert.deepEqual(
    parser.getAiConfig(parser.core.resolveEffectiveParserConfig(bareEntry, { config: {} })),
    parser.getAiConfig(bareEntry)
  );
});

test('validateEventUrl applies global + parser discoveryBlockedPatterns unioned by resolveEffectiveParserConfig', () => {
  const parser = createParser();
  const mainConfig = {
    config: {
      // /shop etc. are blocked built-in now — the config union mechanism is
      // exercised with patterns the built-ins do NOT cover
      discoveryBlockedPatterns: [/\/(members|vip-lounge)(?:\/|[?#]|$)/, '/private-hire/']
    }
  };
  const effective = parser.core.resolveEffectiveParserConfig(
    { name: 'Union', discoveryBlockedPatterns: ['x.example/hidden'] },
    mainConfig
  );
  const sourceUrl = 'https://x.example/events';

  // Global RegExp entries block whole path segments...
  const members = parser.validateEventUrl('https://x.example/members', sourceUrl, effective);
  assert.equal(members.valid, false);
  assert.match(members.reason, /^config-blocked-pattern:/);
  assert.equal(parser.validateEventUrl('https://x.example/private-hire/rooms', sourceUrl, effective).valid, false);

  // ...without swallowing legitimate event slugs that merely start the same way
  assert.equal(parser.validateEventUrl('https://x.example/members-party', sourceUrl, effective).valid, true);

  // The parser's own substring patterns still apply alongside the global list
  const own = parser.validateEventUrl('https://x.example/hidden', sourceUrl, effective);
  assert.equal(own.valid, false);
  assert.equal(own.reason, 'config-blocked-pattern:x.example/hidden');

  // The formerly-config-only generic junk is now built-in (no config needed)
  const shop = parser.validateEventUrl('https://x.example/shop', sourceUrl, {});
  assert.equal(shop.valid, false);
  assert.match(shop.reason, /^blocked-pattern:/);
});

test('validateEventUrl rejects extensionless script-bundle/SDK endpoints without naming any vendor', () => {
  const parser = createParser();
  const sourceUrl = 'https://promoter.example/events';

  // Run 20260802-142231: "/sdk/js?client-id=…" ends in "/js", not ".js", so the
  // static-asset EXTENSION rule never saw it and a full AI extraction ran on a
  // JavaScript bundle.
  const sdk = parser.validateEventUrl('https://vendor.example/sdk/js?client-id=abc&currency=CAD', sourceUrl, {});
  assert.equal(sdk.valid, false);
  assert.equal(sdk.reason, 'script-bundle-url');

  for (const url of [
    'https://vendor.example/sdk/js',
    'https://vendor.example/v2/js',
    'https://vendor.example/build/css',
    'https://vendor.example/dist/main',
    'https://vendor.example/cdn-cgi/challenge'
  ]) {
    assert.equal(parser.validateEventUrl(url, sourceUrl, {}).reason, 'script-bundle-url', url);
  }

  // Shape rules only — real event paths that merely contain the letters survive
  for (const url of [
    'https://promoter.example/events/js-fest-2026',
    'https://promoter.example/events/sdk-release-party',
    'https://promoter.example/e/discotheque'
  ]) {
    assert.equal(parser.validateEventUrl(url, sourceUrl, {}).valid, true, url);
  }
});

test('validateEventUrl discoveryAllowedPatterns: only matching discovered links survive; blocks still win', () => {
  const parser = createParser();
  const sourceUrl = 'https://sickening.events/events';
  const config = { name: 'Goldiloxx', discoveryAllowedPatterns: ['goldiloxx'] };

  // Matching links pass (case-insensitive substring)
  assert.equal(parser.validateEventUrl('https://sickening.events/e/GOLDILOXX-chicago', sourceUrl, config).valid, true);
  // Non-matching links from the same listing are rejected with the new reason
  const other = parser.validateEventUrl('https://sickening.events/e/some-other-party', sourceUrl, config);
  assert.equal(other.valid, false);
  assert.equal(other.reason, 'not-in-allowed-patterns');
  // RegExp entries work with the same dual semantics as the blocked list
  const rx = { name: 'RX', discoveryAllowedPatterns: [/\/e\/goldiloxx(-|$)/] };
  assert.equal(parser.validateEventUrl('https://sickening.events/e/goldiloxx-chicago-2', sourceUrl, rx).valid, true);
  assert.equal(parser.validateEventUrl('https://sickening.events/e/notgoldiloxxish', sourceUrl, rx).valid, false);
  // Blocks win over allows
  const both = { name: 'Both', discoveryAllowedPatterns: ['goldiloxx'], discoveryBlockedPatterns: ['chicago'] };
  const blocked = parser.validateEventUrl('https://sickening.events/e/goldiloxx-chicago', sourceUrl, both);
  assert.equal(blocked.valid, false);
  assert.match(blocked.reason, /^config-blocked-pattern:/);
  // Empty/absent list changes nothing
  assert.equal(parser.validateEventUrl('https://sickening.events/e/some-other-party', sourceUrl, { name: 'N', discoveryAllowedPatterns: [] }).valid, true);
});

test('discoveryAllowedPatterns scopes extraction: foreign events on a shared listing page are dropped, promoter-matched pages extract freely', () => {
  const parser = createParser();
  const config = { name: 'Goldiloxx', discoveryAllowedPatterns: ['goldiloxx'] };
  const events = [
    { title: 'GOLDILOXX CHICAGO', url: 'https://sickening.events/events' },
    { title: 'Some Other Party', url: 'https://sickening.events/events', ticketUrl: 'https://sickening.events/e/other-party/tickets' },
    { title: 'Untitled-ish', ticketUrl: 'https://sickening.events/e/goldiloxx-chicago-2/tickets' }
  ];

  // Shared listing page (URL does not match): only promoter-matched events survive
  const kept = parser.filterEventsByDiscoveryAllowlist(events, 'https://sickening.events/events', config);
  assert.deepEqual(kept.map(e => e.title), ['GOLDILOXX CHICAGO', 'Untitled-ish'],
    'title match and ticketUrl match keep; foreign event dropped');

  // A page whose own URL matches (the promoter's API search / a followed event page) extracts freely
  const apiKept = parser.filterEventsByDiscoveryAllowlist(events,
    'https://api.redeyetickets.com/api/v1/events/search?q=goldiloxx&per_page=25', config);
  assert.equal(apiKept.length, 3, 'promoter-matched source page keeps everything');

  // No patterns configured → no-op (other parsers unaffected)
  const noop = parser.filterEventsByDiscoveryAllowlist(events, 'https://sickening.events/events', { name: 'Plain' });
  assert.equal(noop.length, 3);
});

test('parseOcrResponseWithClassification salvages OCR text from truncated/degenerate JSON', () => {
  const parser = createParser();

  // Provincetown-style failure: valid text, then the model degenerates into endless
  // newlines and the JSON never closes.
  const truncated = '{\n  "text": "BEAR WEEK KICK OFF\\nBEARRACUDA\\nPROVINCETOWN\\n\\nBEATS BY\\nKELLY' +
    '\n'.repeat(400);
  const salvaged = parser.parseOcrResponseWithClassification(truncated);
  assert.ok(salvaged, 'truncated response should be salvaged, not discarded');
  assert.match(salvaged.text, /BEAR WEEK KICK OFF/);
  assert.match(salvaged.text, /BEATS BY\nKELLY/);
  assert.ok(!/\n{3,}/.test(salvaged.text), 'degenerate newline runs should be collapsed');
  assert.equal(salvaged.reason, 'salvaged-from-truncated-response');

  // Truncation after a complete text field still picks up classification/confidence
  const cutLater = '{"text": "FURBALL NYC\\nSATURDAY 10PM", "imageClassification": "event-flyer", "confidence": 95, "eventSummary": "Furball';
  const later = parser.parseOcrResponseWithClassification(cutLater);
  assert.equal(later.text, 'FURBALL NYC\nSATURDAY 10PM');
  assert.equal(later.imageClassification, 'event-flyer');
  assert.equal(later.confidence, 95);

  // Well-formed responses keep going through the normal parse path untouched
  const complete = parser.parseOcrResponseWithClassification(
    '{"text": "HOT TAKE", "imageClassification": "event-flyer", "eventSummary": "s", "confidence": 90, "reason": "r"}'
  );
  assert.equal(complete.text, 'HOT TAKE');
  assert.equal(complete.reason, 'r');

  // Garbage with no text field stays rejected
  assert.equal(parser.parseOcrResponseWithClassification('not json at all'), null);
  assert.equal(parser.parseOcrResponseWithClassification('{"foo": "bar"'), null);
});

test('shouldRunOcrForPage skips OCR when no extraction or segment pairing will consume it', () => {
  const parser = createParser();

  // Multi-event pages always OCR — segment pairing runs even in discoveryOnly mode
  assert.equal(parser.shouldRunOcrForPage({ discoveryOnly: true }, 'multi-event-page'), true);
  assert.equal(parser.shouldRunOcrForPage({}, 'multi-event-page'), true);

  // Link-aggregators never extract events, so OCR has no consumer
  assert.equal(parser.shouldRunOcrForPage({}, 'link-aggregator'), false);

  // Event pages OCR only when extraction will actually run
  assert.equal(parser.shouldRunOcrForPage({}, 'event-page'), true);
  assert.equal(parser.shouldRunOcrForPage({ discoveryOnly: true }, 'event-page'), false);
  assert.equal(parser.shouldRunOcrForPage({ discoveryOnly: true }, null), false);
});

test('getOcrTextForImage negative-caches context-overflow failures and skips them next time', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-cache-test-'));

  const parser = new AiWebParser({ normalizeUrl, ocrCacheDir: cacheDir });
  parser.core = new SharedCore({}, { eventSchema: EventSchema });

  const imageUrl = 'https://cdn.example/huge-masthead.webp';
  const ocrConfig = {
    cacheEnabled: true,
    model: 'mlx-community/Qwen3-VL-4B-Instruct-4bit',
    prompt: 'ocr prompt',
    timeoutSeconds: 120
  };
  const httpAdapter = { fetchImageAsBase64: async () => 'base64imagedata' };

  // First call: the AI reports a context overflow via diagnostics
  let aiCalls = 0;
  parser.core.callAiGenerate = async (config, prompt, label, adapter, recorder, image, diagnostics) => {
    aiCalls++;
    if (diagnostics) diagnostics.failureKind = 'context-overflow';
    return null;
  };
  const first = await parser.getOcrTextForImage(imageUrl, ocrConfig, 'ocr-all', httpAdapter);
  assert.equal(first, null);
  assert.equal(aiCalls, 1);

  // Second call: the cached failure short-circuits before download or AI request
  parser.core.callAiGenerate = async () => {
    throw new Error('AI should not be called for a negative-cached image');
  };
  const failingAdapter = {
    fetchImageAsBase64: async () => {
      throw new Error('image should not be re-downloaded for a negative-cached image');
    }
  };
  const second = await parser.getOcrTextForImage(imageUrl, ocrConfig, 'ocr-all', failingAdapter);
  assert.equal(second, null);

  // Transient failures (no failureKind) must NOT be cached
  const otherUrl = 'https://cdn.example/other-flyer.jpg';
  parser.core.callAiGenerate = async () => null;
  await parser.getOcrTextForImage(otherUrl, ocrConfig, 'ocr-all', httpAdapter);
  let retried = 0;
  parser.core.callAiGenerate = async () => {
    retried++;
    return null;
  };
  await parser.getOcrTextForImage(otherUrl, ocrConfig, 'ocr-all', httpAdapter);
  assert.equal(retried, 1, 'a transient empty response should be retried on the next call');

  fs.rmSync(cacheDir, { recursive: true, force: true });
});

test('getUrlDedupeKey treats www and bare-host variants as the same URL', () => {
  const parser = createParser();
  assert.equal(
    parser.getUrlDedupeKey('https://www.tryst.events/e/bearracuda/tickets'),
    parser.getUrlDedupeKey('https://tryst.events/e/bearracuda/tickets')
  );
  assert.notEqual(
    parser.getUrlDedupeKey('https://tryst.events/e/bearracuda'),
    parser.getUrlDedupeKey('https://tryst.events/e/bearracuda/tickets')
  );
});

const SICKENING_JSONLD_HTML = `
  <html><head>
    <script type="application/ld+json">
      {"@context":"http://schema.org","@type":"MusicEvent",
       "name":"Bearracuda Portland:PRIDE FRIDAY",
       "url":"https://www.sickening.events/e/bearracuda-portland-pridefriday/tickets",
       "startDate":"2026-07-17T21:00:00-07:00",
       "endDate":"2026-07-18T03:00:00-07:00",
       "eventStatus":"https://schema.org/EventScheduled",
       "description":"<p>Harnesses, Jockstraps &amp; Fetish Gear encouraged.</p>",
       "image":["https://res.cloudinary.example/cover.webp"],
       "organizer":{"@type":"Organization","name":"Crown &amp; Anchor"},
       "location":{"@type":"Place","name":"Nova PDX",
         "address":{"@type":"PostalAddress","streetAddress":"722 East Burnside Street","addressLocality":"Portland","addressRegion":"OR","postalCode":"97214"}},
       "offers":{"@type":"Offer","url":"https://www.sickening.events/e/bearracuda-portland-pridefriday/tickets","availability":"https://schema.org/InStock"}}
    </script>
  </head><body>January February March April May June July August related events footer</body></html>`;

test('extractEventsFromJsonLd builds a complete event from ticketing-page structured data', () => {
  const parser = createParser();
  const events = parser.extractEventsFromJsonLd(SICKENING_JSONLD_HTML, 'https://sickening.events/e/bearracuda-portland-pridefriday');

  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.title, 'Bearracuda Portland:PRIDE FRIDAY');
  // Offset-carrying ISO dates are exact instants — no timezone ambiguity
  assert.equal(event.startDate.toISOString(), '2026-07-18T04:00:00.000Z');
  assert.equal(event.endDate.toISOString(), '2026-07-18T10:00:00.000Z');
  assert.equal(event._timezoneUnresolved, undefined);
  assert.equal(event.bar, 'Nova PDX');
  assert.equal(event.address, '722 East Burnside Street, Portland, OR, 97214');
  assert.equal(event.ticketUrl, 'https://www.sickening.events/e/bearracuda-portland-pridefriday/tickets');
  assert.equal(event.image, 'https://res.cloudinary.example/cover.webp');
  assert.match(event.description, /Harnesses, Jockstraps & Fetish Gear/);
  assert.ok(!/<p>/.test(event.description), 'HTML tags should be stripped');
  assert.equal(event.url, 'https://sickening.events/e/bearracuda-portland-pridefriday');
});

test('formatJsonLdAddress never duplicates locality/region already inside the street address', () => {
  const parser = createParser();
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  // Eventbrite shape (2026-07-15 Megawoof run): streetAddress already carries
  // the FULL address — appending locality/region again produced
  // "..., Queens, NY 11385, Queens, NY", which churned AI merge arbitration on
  // address/gmaps every run and degraded geocoding.
  assert.equal(
    parser.formatJsonLdAddress({
      streetAddress: '10-90 Wyckoff Avenue, Queens, NY 11385',
      addressLocality: 'Queens',
      addressRegion: 'NY',
      postalCode: '11385'
    }, clean),
    '10-90 Wyckoff Avenue, Queens, NY 11385'
  );

  // Bare street (typical bear-site JSON-LD): locality/region/postal MUST still
  // be appended — they are genuinely absent from the street text.
  assert.equal(
    parser.formatJsonLdAddress({
      streetAddress: '123 Main St',
      addressLocality: 'Phoenix',
      addressRegion: 'AZ',
      postalCode: '85004'
    }, clean),
    '123 Main St, Phoenix, AZ, 85004'
  );

  // Token guard: the region "NY" is NOT "present" just because the street
  // contains "SUNNYSIDE" — containment is whole-token, not bare substring.
  assert.equal(
    parser.formatJsonLdAddress({
      streetAddress: '4501 SUNNYSIDE AVE',
      addressLocality: 'Brooklyn',
      addressRegion: 'NY'
    }, clean),
    '4501 SUNNYSIDE AVE, Brooklyn, NY'
  );

  // String and array address shapes pass through unchanged.
  assert.equal(
    parser.formatJsonLdAddress('10-90 Wyckoff Avenue, Queens, NY 11385', clean),
    '10-90 Wyckoff Avenue, Queens, NY 11385'
  );
  assert.equal(
    parser.formatJsonLdAddress([{ streetAddress: '123 Main St', addressLocality: 'Phoenix' }], clean),
    '123 Main St, Phoenix'
  );
});

test('parseJsonLdDateValue anchors offset-less dates as wall-clock UTC and flags them', () => {
  const parser = createParser();

  const exact = parser.parseJsonLdDateValue('2026-07-17T21:00:00-07:00');
  assert.equal(exact.timezoneUnresolved, false);
  assert.equal(exact.date.toISOString(), '2026-07-18T04:00:00.000Z');

  // No offset: must NOT be parsed in the device timezone — anchored as UTC + flagged
  const wallClock = parser.parseJsonLdDateValue('2026-07-17T21:00:00');
  assert.equal(wallClock.timezoneUnresolved, true);
  assert.equal(wallClock.date.toISOString(), '2026-07-17T21:00:00.000Z');

  const dateOnly = parser.parseJsonLdDateValue('2026-07-17');
  assert.equal(dateOnly.timezoneUnresolved, true);
  assert.equal(dateOnly.date.toISOString(), '2026-07-17T00:00:00.000Z');

  assert.equal(parser.parseJsonLdDateValue('not a date').date, null);
  assert.equal(parser.parseJsonLdDateValue('').date, null);
});

test('parseEvents returns JSON-LD events directly and skips OCR and AI extraction', async () => {
  const parser = createParser();
  parser.extractOcrFromAllImages = async () => {
    throw new Error('OCR should not run when JSON-LD covers the event');
  };
  parser.core.callAiGenerate = async () => {
    throw new Error('AI should not be called when JSON-LD covers the event');
  };

  const result = await parser.parseEvents(
    { url: 'https://sickening.events/e/bearracuda-portland-pridefriday', html: SICKENING_JSONLD_HTML },
    {},
    null,
    'event-page',
    null
  );

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title, 'Bearracuda Portland:PRIDE FRIDAY');
  assert.equal(result.events[0].bar, 'Nova PDX');
});

test('parseEvents surfaces JSON-LD events as segments in discovery mode', async () => {
  const parser = createParser();
  const result = await parser.parseEvents(
    { url: 'https://sickening.events/e/bearracuda-portland-pridefriday', html: SICKENING_JSONLD_HTML },
    { discoveryOnly: true },
    null,
    'event-page',
    null
  );

  assert.equal(result.events.length, 0, 'discovery mode never returns events');
  assert.ok(Array.isArray(result.discoveredSegments));
  assert.equal(result.discoveredSegments.length, 1);
  assert.match(result.discoveredSegments[0].preview, /Bearracuda Portland:PRIDE FRIDAY/);
  assert.deepEqual(result.discoveredSegments[0].imageUrls, ['https://res.cloudinary.example/cover.webp']);
});

test('parseEvents falls through to AI extraction when JSON-LD is incomplete for the page type', async () => {
  const parser = createParser();
  // Multi-event page with only ONE JSON-LD event: likely just the featured event is
  // marked up, so the segment path must still run for full coverage.
  let ocrRan = false;
  parser.extractOcrFromAllImages = async () => {
    ocrRan = true;
    return [];
  };
  parser.extractEventsFromMultiEventPage = async () => [];
  parser.getDataFlagsForHtml = parser.getDataFlagsForHtml || (() => ({}));

  const result = await parser.parseEvents(
    { url: 'https://x.example/calendar', html: SICKENING_JSONLD_HTML },
    {},
    null,
    'multi-event-page',
    null
  );

  assert.equal(ocrRan, true, 'OCR should still run on the segment path');
  assert.equal(result.events.length, 0);
});

test('buildEventFromJsonLdNode resolves city and timezone from the address', () => {
  const parser = createParser();
  const cityConfig = {
    portland: { timezone: 'America/Los_Angeles', patterns: ['portland', 'pdx'] },
    nyc: { timezone: 'America/New_York', patterns: ['new york', 'nyc', 'brooklyn'] }
  };

  const events = parser.extractEventsFromJsonLd(SICKENING_JSONLD_HTML, 'https://sickening.events/e/x', cityConfig);
  assert.equal(events.length, 1);
  assert.equal(events[0].city, 'portland');
  assert.equal(events[0].timezone, 'America/Los_Angeles');

  // Bar names must NOT drive city resolution — address only
  const brooklynBowlVegas = parser.buildEventFromJsonLdNode({
    '@type': 'MusicEvent',
    name: 'Bear Night',
    startDate: '2026-08-01T21:00:00-07:00',
    location: {
      '@type': 'Place',
      name: 'Brooklyn Bowl',
      address: { '@type': 'PostalAddress', streetAddress: '3545 S Las Vegas Blvd' }
    }
  }, 'https://x.example/e/bearnight', cityConfig);
  assert.equal(brooklynBowlVegas.city, undefined);
  assert.equal(brooklynBowlVegas.bar, 'Brooklyn Bowl');

  // No cityConfig → no city fields, no crash
  const bare = parser.extractEventsFromJsonLd(SICKENING_JSONLD_HTML, 'https://sickening.events/e/x');
  assert.equal(bare[0].city, undefined);
});

test('buildEventFromJsonLdNode never uses an address-shaped venue name as the bar', () => {
  const parser = createParser();
  const buildNode = (venueName, streetAddress = '10-90 Wyckoff Avenue, Queens, NY 11385') => ({
    '@type': 'MusicEvent',
    name: 'MEGAWOOF & BEARMILK present MEGAMILK',
    startDate: '2026-07-18T22:00:00-04:00',
    location: {
      '@type': 'Place',
      name: venueName,
      address: { '@type': 'PostalAddress', streetAddress }
    }
  });

  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let addressShaped;
  let streetLineTwin;
  let realVenue;
  try {
    // Observed 2026-07-17: Eventbrite filled location.name with the street address
    addressShaped = parser.buildEventFromJsonLdNode(buildNode('10-90 Wyckoff Ave'), 'https://tickets.example/e/megamilk');
    // Not address-shaped (no street-type word), but a normalized duplicate of
    // the address's street line — still never a venue name
    streetLineTwin = parser.buildEventFromJsonLdNode(buildNode('10-90 Wyckoff', '10-90 Wyckoff, Queens, NY'), 'https://tickets.example/e/megamilk');
    // A real venue name is emitted exactly as today
    realVenue = parser.buildEventFromJsonLdNode(buildNode('HOLO'), 'https://tickets.example/e/megamilk');
  } finally {
    console.log = originalLog;
  }

  assert.equal(addressShaped.bar, '', 'the address-shaped venue name must not become the bar');
  assert.equal(addressShaped.address, '10-90 Wyckoff Avenue, Queens, NY 11385', 'the address field is unaffected');
  assert.ok(logLines.includes(
    '🤖 AI Web: JSON-LD venue name "10-90 Wyckoff Ave" looks like a street address — not using it as bar'
  ), `drop log line expected, got: ${JSON.stringify(logLines)}`);

  assert.equal(streetLineTwin.bar, '', 'a street-line duplicate must not become the bar');

  assert.equal(realVenue.bar, 'HOLO');
  assert.ok(!logLines.some(line => line.includes('"HOLO"')), 'a real venue name is never logged as dropped');
});

test('getAiConfig delegates to SharedCore.resolveAiConfig', () => {
  const parser = createParser();
  const viaParser = parser.getAiConfig({ ai: { provider: 'ollama', numPredict: 1234 } });
  const viaCore = parser.core.resolveAiConfig({ provider: 'ollama', numPredict: 1234 });
  assert.deepEqual(viaParser, viaCore);
  assert.equal(viaParser.numPredict, 1234);
  assert.equal(viaParser.arbitrateMerges, true);
  assert.equal(parser.normalizePayloadMode('jsonld'), 'jsonld');
  assert.equal(parser.normalizePayloadMode('bogus'), 'best');
});

test('hasUrlEvidence accepts bare-domain values found verbatim in the source', () => {
  const parser = createParser();
  const html = '<html><body>ADVANCED TIX AT WWW.MASSIVE.CLUB and TICKETS AT BEARRACUDA.COM</body></html>';
  const ctx = parser.buildAiEvidenceContext({ html, url: 'https://x.example/' }, {});

  assert.equal(parser.hasUrlEvidence(ctx, 'WWW.MASSIVE.CLUB'), true);
  assert.equal(parser.hasUrlEvidence(ctx, 'bearracuda.com'), true);
  assert.equal(parser.hasUrlEvidence(ctx, 'https://www.massive.club'), true);
  assert.equal(parser.hasUrlEvidence(ctx, 'https://unrelated.example/tickets'), false);
});

test('embedded Google Maps URLs are uninteresting images', () => {
  const parser = createParser();
  assert.equal(
    parser.isLikelyUninterestingImageUrl('https://maps.google.com/maps?q=722%20E%20Burnside&t=m&z=10&output=embed'),
    true
  );
  assert.equal(parser.isLikelyUninterestingImageUrl('https://x.example/images/flyer.jpg'), false);
});

test("'404' flags standalone segments only, never hex asset IDs or pixel sizes", () => {
  const parser = createParser();
  // Regression (run 20260723-152928): the Boston flyer's Wix asset ID contains
  // "c4047c55" — the old bare-substring '404' pattern flagged the flyer as a
  // 404-error image, so it was never OCR'd and the event lost its start time.
  assert.equal(
    parser.isLikelyUninterestingImageUrl('https://static.wixstatic.com/media/238fae_c4047c55f4534a0990b2b7fdc19dab8f~mv2.png/v1/fill/w_577,h_1027,al_c,q_90,usm_0.66_1.00_0.01,enc_avif,quality_auto/238fae_c4047c55f4534a0990b2b7fdc19dab8f~mv2.png'),
    false
  );
  assert.equal(parser.isLikelyUninterestingImageUrl('https://x.example/img/w_1404,h_900/flyer.jpg'), false);
  assert.equal(parser.isLikelyUninterestingImageUrl('https://x.example/404.png'), true);
  assert.equal(parser.isLikelyUninterestingImageUrl('https://x.example/assets/error-404.jpg'), true);
  assert.equal(parser.isLikelyUninterestingImageUrl('https://x.example/404/not-found.png'), true);
});

test('normalizeAiEvent rolls past-midnight end times to the next day', () => {
  const parser = createParser();
  const cityConfig = { nyc: { timezone: 'America/New_York', patterns: ['new york', 'nyc'] } };

  // "Doors 9pm, party until 1am" — endDate arrives as the START's date because the
  // next-day date is never verbatim in the source.
  const lateNight = parser.normalizeAiEvent({
    title: 'BEAR WEEK KICK OFF',
    startDate: '2026-07-11',
    startTime: '21:00',
    endDate: '2026-07-11',
    endTime: '01:00',
    address: '247 Commercial St, New York, NY'
  }, {}, null, cityConfig, null);
  assert.ok(lateNight);
  assert.equal(lateNight.startDate.toISOString(), '2026-07-12T01:00:00.000Z');
  assert.equal(lateNight.endDate.toISOString(), '2026-07-12T05:00:00.000Z', 'end must roll to 1am the NEXT day');
  assert.ok(lateNight.endDate > lateNight.startDate, 'event must not collapse to zero duration');

  // Same-day ends stay untouched
  const sameDay = parser.normalizeAiEvent({
    title: 'TEA DANCE',
    startDate: '2026-07-11',
    startTime: '16:00',
    endDate: '2026-07-11',
    endTime: '20:00',
    address: '247 Commercial St, New York, NY'
  }, {}, null, cityConfig, null);
  assert.equal(sameDay.endDate.toISOString(), '2026-07-12T00:00:00.000Z'); // 8pm EDT
});

test('normalizeAiEvent anchors an end time with NO end date to the start date', () => {
  const parser = createParser();
  const cityConfig = { nyc: { timezone: 'America/New_York', patterns: ['new york', 'nyc'] } };

  // "Party Goes Until 2:00 am!" — the page never prints the next-day date, so the
  // evidence gate drops the inferred endDate and only rawEndTime=02:00 survives.
  // The end must anchor to the START's date and roll past midnight, not go null
  // and collapse the event to zero duration.
  const lateNight = parser.normalizeAiEvent({
    title: 'NEW ORLEANS',
    startDate: '2026-09-04',
    startTime: '21:00',
    endTime: '02:00',
    address: '800 Bourbon St, New York, NY'
  }, {}, null, cityConfig, null);
  assert.ok(lateNight);
  assert.equal(lateNight.startDate.toISOString(), '2026-09-05T01:00:00.000Z'); // 9pm EDT
  assert.equal(lateNight.endDate.toISOString(), '2026-09-05T06:00:00.000Z', 'end must land at 2am the NEXT day');
  assert.equal(lateNight.endDate - lateNight.startDate, 5 * 60 * 60 * 1000, 'the 5-hour duration must survive');

  // An end time AFTER the start time (still no end date) stays on the same day
  const sameDay = parser.normalizeAiEvent({
    title: 'TEA DANCE',
    startDate: '2026-09-04',
    startTime: '14:00',
    endTime: '18:00',
    address: '800 Bourbon St, New York, NY'
  }, {}, null, cityConfig, null);
  assert.ok(sameDay);
  assert.equal(sameDay.startDate.toISOString(), '2026-09-04T18:00:00.000Z'); // 2pm EDT
  assert.equal(sameDay.endDate.toISOString(), '2026-09-04T22:00:00.000Z', 'same-day end must not roll over');
});

test('getAiPromptFields default branch still requests split time fields', () => {
  const parser = createParser();
  // No OCR, no JSON-LD, no meta — the branch that previously dropped startTime/endTime
  // and produced midnight-start events.
  const fields = parser.getAiPromptFields({}, {});
  const normalized = fields.map(f => parser.normalizePromptFieldName(f));
  assert.ok(normalized.includes('startdate'), 'startDate expected');
  assert.ok(normalized.includes('starttime'), 'startTime must accompany startDate');
  assert.ok(normalized.includes('endtime'), 'endTime must accompany endDate');
  assert.ok(!normalized.includes('start'), 'full datetime fields removed in split mode');
});

test('getOcrTextForImage retries overflowed images at reduced resolution before caching failure', async () => {
  const parser = createParser();
  const cacheWrites = [];
  parser.writeCachedOcrResult = async (url, cfg, text) => {
    cacheWrites.push(text);
    return '/tmp/cache-path';
  };
  const ocrConfig = { cacheEnabled: false, prompt: 'ocr prompt', timeoutSeconds: 5 };
  const adapter = {
    fetchImageAsBase64: async (url, timeout, maxDimension) =>
      maxDimension ? 'smallimg' : 'X'.repeat(500)
  };

  // First attempt overflows, reduced-resolution retry succeeds
  let aiCalls = 0;
  parser.core.callAiGenerate = async (cfg, prompt, label, http, rec, image, diagnostics) => {
    aiCalls++;
    if (image.length > 100) {
      if (diagnostics) diagnostics.failureKind = 'context-overflow';
      return null;
    }
    return JSON.stringify({ text: 'FLYER TEXT', imageClassification: 'event-flyer', eventSummary: 's', confidence: 90, reason: 'r' });
  };
  const result = await parser.getOcrTextForImage('https://x.example/big.png', ocrConfig, 'ocr-all', adapter);
  assert.equal(aiCalls, 2, 'exactly one retry');
  assert.equal(result.text, 'FLYER TEXT');
  assert.ok(!cacheWrites.some(text => text.includes('failureKind')), 'no failure cached when the retry succeeds');

  // Both attempts overflow → negative cache
  cacheWrites.length = 0;
  parser.core.callAiGenerate = async (cfg, prompt, label, http, rec, image, diagnostics) => {
    if (diagnostics) diagnostics.failureKind = 'context-overflow';
    return null;
  };
  const failed = await parser.getOcrTextForImage('https://x.example/huge.png', ocrConfig, 'ocr-all', adapter);
  assert.equal(failed, null);
  assert.ok(cacheWrites.some(text => text.includes('context-overflow')), 'persistent overflow is negative-cached');
});

// ---------------------------------------------------------------------------
// Organizer/site-brand guard (2026-07-12 run findings: bearracuda.com pages
// leaked bar: "BEARRACUDA" — the promoter, not a venue — from og:title)
// ---------------------------------------------------------------------------

const BEARRACUDA_HTML = `
  <html>
    <head>
      <meta property="og:site_name" content="BEARRACUDA" />
      <meta property="og:title" content="Portland PRIDE FRIDAY | BEARRACUDA" />
      <script type="application/ld+json">
        {"@context":"https://schema.org","@graph":[
          {"@type":"Organization","name":"Bearracuda, Inc.","alternateName":"Bearracuda"},
          {"@type":"WebSite","name":"BEARRACUDA"}
        ]}
      </script>
    </head>
    <body><p>Pride Friday at Nova PDX, 722 E Burnside St</p></body>
  </html>
`;

test('extractPageBrandNames reads JSON-LD Organization/WebSite and og:site_name', () => {
  const parser = createParser();
  const brands = parser.extractPageBrandNames(BEARRACUDA_HTML);
  assert.ok(brands.includes('Bearracuda, Inc.'));
  assert.ok(brands.includes('Bearracuda'));
  assert.ok(brands.includes('BEARRACUDA'));
});

test('normalizeAiEvent drops a bar matching the page organizer and strips the title brand suffix', () => {
  const parser = createParser();
  const aiEvent = {
    title: 'Portland PRIDE FRIDAY | BEARRACUDA',
    bar: 'BEARRACUDA',
    startDate: '2026-07-17',
    startTime: '22:00'
  };
  const htmlData = { html: BEARRACUDA_HTML, url: 'https://bearracuda.com/events/portland' };

  const event = parser.normalizeAiEvent(aiEvent, {}, htmlData, null, null);
  assert.ok(event, 'event should normalize');
  assert.equal(event.bar, '', 'the promoter brand must not survive as the venue');
  assert.equal(event.title, 'Portland PRIDE FRIDAY', 'the brand suffix must be stripped from the title');
});

test('normalizeAiEvent keeps an explicitly configured bar even when it matches the site brand', () => {
  // Venue sites ARE their own brand (a bar scraping its own homepage): a
  // configured metadata bar is a deliberate override and must survive the guard —
  // including as the fallback when the AI-extracted bar is dropped as the brand.
  const parser = createParser();
  const parserConfig = { metadata: { bar: 'Bearracuda' } };
  const htmlData = { html: BEARRACUDA_HTML, url: 'https://bearracuda.com/events/portland' };

  const configured = parser.normalizeAiEvent(
    { title: 'Portland PRIDE FRIDAY', startDate: '2026-07-17', startTime: '22:00' },
    parserConfig, htmlData, null, null);
  assert.equal(configured.bar, 'Bearracuda', 'configured bar must survive the brand guard');

  const fallback = parser.normalizeAiEvent(
    { title: 'Portland PRIDE FRIDAY', bar: 'BEARRACUDA', startDate: '2026-07-17', startTime: '22:00' },
    parserConfig, htmlData, null, null);
  assert.equal(fallback.bar, 'Bearracuda', 'dropped AI brand-bar must fall back to the configured value');
});

test('normalizeAiEvent drops a bar matching og:site_name when the page has no JSON-LD', () => {
  const parser = createParser();
  const html = `
    <html>
      <head><meta property="og:site_name" content="BEARRACUDA" /></head>
      <body><p>Provincetown Bear Week kickoff</p></body>
    </html>
  `;
  const aiEvent = {
    title: 'Provincetown⚓ | BEARRACUDA',
    bar: 'Bearracuda',
    startDate: '2026-07-17'
  };

  const event = parser.normalizeAiEvent(aiEvent, {}, { html, url: 'https://bearracuda.com/ptown' }, null, null);
  assert.ok(event, 'event should normalize');
  assert.equal(event.bar, '', 'og:site_name alone must be enough to reject the brand');
  assert.equal(event.title, 'Provincetown⚓');
});

test('normalizeAiEvent keeps a legitimate venue and non-brand titles untouched', () => {
  const parser = createParser();
  const aiEvent = {
    title: 'Portland PRIDE FRIDAY | Late Night',
    bar: 'Nova PDX',
    startDate: '2026-07-17',
    startTime: '22:00'
  };
  const htmlData = { html: BEARRACUDA_HTML, url: 'https://bearracuda.com/events/portland' };

  const event = parser.normalizeAiEvent(aiEvent, {}, htmlData, null, null);
  assert.ok(event, 'event should normalize');
  assert.equal(event.bar, 'Nova PDX', 'real venues must survive the brand guard');
  assert.equal(event.title, 'Portland PRIDE FRIDAY | Late Night', 'non-brand segments are never stripped');
});

test('matchesPageBrandName matches across trailing corporate suffixes and punctuation', () => {
  const parser = createParser();
  assert.equal(parser.matchesPageBrandName('BEARRACUDA', ['Bearracuda, Inc.']), true);
  assert.equal(parser.matchesPageBrandName('bearracuda inc', ['Bearracuda, Inc.']), true);
  assert.equal(parser.matchesPageBrandName('Nova PDX', ['Bearracuda, Inc.', 'BEARRACUDA']), false);
});

// ---------------------------------------------------------------------------
// Organizer context in extraction prompts (prevention, complementing the
// post-extraction guard) + the ai.extraContext override
// ---------------------------------------------------------------------------

test('extraction prompts carry the KNOWN ORGANIZER line when the page declares a brand', () => {
  const parser = createParser();
  const htmlData = { html: BEARRACUDA_HTML, url: 'https://bearracuda.com/events/portland' };
  const aiConfig = parser.getAiConfig({});

  for (const variant of ['default', 'alternate', 'repair']) {
    const prompt = parser.buildExtractionPrompt(
      htmlData, aiConfig, null, {}, ['title', 'bar'], 'SNIPPET', variant, { content: true });
    assert.match(
      prompt,
      /KNOWN ORGANIZER \(derived from page metadata\): "Bearracuda, Inc\."/,
      `${variant} variant must carry the organizer line`);
    assert.match(prompt, /NOT the venue/, `${variant} variant must explain the brand is not the venue`);
  }
});

test('extraction prompts omit the KNOWN ORGANIZER line when the page declares no brand', () => {
  const parser = createParser();
  const htmlData = { html: '<html><body><p>Bear Night at the Eagle</p></body></html>', url: 'https://eagle.example/events' };
  const prompt = parser.buildExtractionPrompt(
    htmlData, parser.getAiConfig({}), null, {}, ['title', 'bar'], 'SNIPPET', 'default', { content: true });
  assert.ok(!/KNOWN ORGANIZER/.test(prompt), 'no page brand → no organizer line');
});

test('ai.extraContext is appended verbatim to the extraction prompt context', () => {
  const parser = createParser();
  const aiConfig = parser.getAiConfig({ ai: { extraContext: 'VENUE HINT: events here are always at Eagle NYC.' } });
  assert.equal(aiConfig.extraContext, 'VENUE HINT: events here are always at Eagle NYC.');

  const prompt = parser.buildExtractionPrompt(
    { html: '<p>party</p>', url: 'https://eagle.example/events' },
    aiConfig, null, {}, ['title', 'bar'], 'SNIPPET', 'default', { content: true });
  assert.match(prompt, /VENUE HINT: events here are always at Eagle NYC\./);

  const withoutOverride = parser.buildExtractionPrompt(
    { html: '<p>party</p>', url: 'https://eagle.example/events' },
    parser.getAiConfig({}), null, {}, ['title', 'bar'], 'SNIPPET', 'default', { content: true });
  assert.ok(!/VENUE HINT/.test(withoutOverride), 'no override → nothing appended');
});

test('the repair prompt keeps the organizer context without the page payload', () => {
  const parser = createParser();
  const htmlData = { html: BEARRACUDA_HTML, url: 'https://bearracuda.com/events/portland' };
  const prompt = parser.buildJsonRepairPrompt(
    '{"title": broken', parser.getAiConfig({}), null, {}, ['title', 'bar'], {}, htmlData);
  assert.match(prompt, /KNOWN ORGANIZER \(derived from page metadata\): "Bearracuda, Inc\."/);
  assert.ok(!prompt.includes('Nova PDX, 722 E Burnside'), 'page body must not leak into the repair prompt');
});

test('normalizeAiEvent stamps the derived organizer as internal _organizer metadata', () => {
  const parser = createParser();
  const htmlData = { html: BEARRACUDA_HTML, url: 'https://bearracuda.com/events/portland' };
  const event = parser.normalizeAiEvent(
    { title: 'Portland PRIDE FRIDAY', bar: 'Nova PDX', startDate: '2026-07-17', startTime: '22:00' },
    {}, htmlData, null, null);
  assert.equal(event._organizer, 'Bearracuda, Inc.');

  const plain = parser.normalizeAiEvent(
    { title: 'Bear Night', startDate: '2026-07-17' },
    {}, { html: '<p>no brand markup</p>', url: 'https://eagle.example' }, null, null);
  assert.equal(plain._organizer, undefined, 'no page brand → no organizer stamp');
});

// ---------------------------------------------------------------------------
// Bare-city titles (2026-07-12 run: bearracuda.com names its event pages after
// the city — og:title "New Orleans⚜️ | BEARRACUDA" → brand strip leaves just
// the city, which is not an event name)
// ---------------------------------------------------------------------------

const CITY_TITLE_CITY_CONFIG = {
  nola: { timezone: 'America/Chicago', patterns: ['new orleans', 'nola'] },
  atlanta: { timezone: 'America/New_York', patterns: ['atlanta'] },
  portland: { timezone: 'America/Los_Angeles', patterns: ['portland', 'pdx'] }
};

const BEARRACUDA_NOLA_HTML = `
  <html>
    <head>
      <meta property="og:site_name" content="BEARRACUDA" />
      <meta property="og:title" content="New Orleans⚜️ | BEARRACUDA" />
      <script type="application/ld+json">
        {"@context":"https://schema.org","@graph":[
          {"@type":"Organization","name":"Bearracuda, Inc.","alternateName":"Bearracuda"},
          {"@type":"WebSite","name":"BEARRACUDA"}
        ]}
      </script>
    </head>
    <body><p>Bearracuda New Orleans at the Metropolitan</p></body>
  </html>
`;

test('normalizeAiEvent prefixes the organizer onto a bare-city title, restoring emoji from og:title', () => {
  const parser = createParser();
  const htmlData = { html: BEARRACUDA_NOLA_HTML, url: 'https://bearracuda.com/events/neworleans' };

  // The model usually drops the emoji: "New Orleans" from og:title "New Orleans⚜️ | BEARRACUDA"
  const event = parser.normalizeAiEvent(
    { title: 'New Orleans', city: 'new orleans', startDate: '2026-10-11', startTime: '22:00' },
    {}, htmlData, CITY_TITLE_CITY_CONFIG, null);
  assert.ok(event, 'event should normalize');
  assert.equal(event.title, 'BEARRACUDA: New Orleans⚜️',
    'organizer prefixed and the emoji-richer og:title variant used as the base');

  // The emoji variant surviving extraction ends the same way (brand strip → prefix)
  const emojiEvent = parser.normalizeAiEvent(
    { title: 'New Orleans⚜️ | BEARRACUDA', city: 'nola', startDate: '2026-10-11', startTime: '22:00' },
    {}, { html: BEARRACUDA_NOLA_HTML, url: 'https://bearracuda.com/events/neworleans' }, CITY_TITLE_CITY_CONFIG, null);
  assert.equal(emojiEvent.title, 'BEARRACUDA: New Orleans⚜️');
});

test('normalizeAiEvent leaves titles that already name the organizer or a real event untouched', () => {
  const parser = createParser();

  // Title already contains the organizer (Atlanta got rescued by its ticketing page)
  const named = parser.normalizeAiEvent(
    { title: 'Bearracuda Atlanta 17 Year Anniversary', city: 'atlanta', startDate: '2026-10-11' },
    {}, { html: BEARRACUDA_NOLA_HTML, url: 'https://bearracuda.com/events/atlanta' }, CITY_TITLE_CITY_CONFIG, null);
  assert.equal(named.title, 'Bearracuda Atlanta 17 Year Anniversary');

  // An already-prefixed title is not city-only — the rule is idempotent
  const prefixed = parser.normalizeAiEvent(
    { title: 'BEARRACUDA: New Orleans⚜️', city: 'nola', startDate: '2026-10-11' },
    {}, { html: BEARRACUDA_NOLA_HTML, url: 'https://bearracuda.com/events/neworleans' }, CITY_TITLE_CITY_CONFIG, null);
  assert.equal(prefixed.title, 'BEARRACUDA: New Orleans⚜️', 'never double-prefixed');

  // A title that merely CONTAINS the city is a real event name
  const containsCity = parser.normalizeAiEvent(
    { title: 'Hot Take Portland', city: 'portland', startDate: '2026-10-11' },
    {}, { html: BEARRACUDA_NOLA_HTML, url: 'https://bearracuda.com/events/portland' }, CITY_TITLE_CITY_CONFIG, null);
  assert.equal(containsCity.title, 'Hot Take Portland');

  // Word-level containment backs the never-double-prefix guard
  assert.equal(parser.titleContainsPageBrandName('Bearracuda Atlanta 17 Year Anniversary', ['Bearracuda, Inc.', 'BEARRACUDA']), true);
  assert.equal(parser.titleContainsPageBrandName('Bearracuda Portland:PRIDE FRIDAY', ['BEARRACUDA']), true);
  assert.equal(parser.titleContainsPageBrandName('New Orleans⚜️', ['BEARRACUDA']), false);
});

test('normalizeAiEvent keeps a bare-city title when no organizer or no city is known', () => {
  const parser = createParser();

  // No page brand → nothing to prefix with
  const noBrand = parser.normalizeAiEvent(
    { title: 'New Orleans', city: 'nola', startDate: '2026-10-11' },
    {}, { html: '<html><body><p>party page with no brand markup</p></body></html>', url: 'https://example.com/nola' },
    CITY_TITLE_CITY_CONFIG, null);
  assert.equal(noBrand.title, 'New Orleans');

  // No resolved city → the title cannot be judged city-only
  const noCity = parser.normalizeAiEvent(
    { title: 'New Orleans', startDate: '2026-10-11' },
    {}, { html: BEARRACUDA_NOLA_HTML, url: 'https://bearracuda.com/events/neworleans' }, CITY_TITLE_CITY_CONFIG, null);
  assert.equal(noCity.title, 'New Orleans');

  // Unknown city value → defensive false
  const unknownCity = parser.normalizeAiEvent(
    { title: 'Denver', city: 'denver', startDate: '2026-10-11' },
    {}, { html: BEARRACUDA_NOLA_HTML, url: 'https://bearracuda.com/events/denver' }, CITY_TITLE_CITY_CONFIG, null);
  assert.equal(unknownCity.title, 'Denver');
});

test('normalizeAiEvent strips a redundant title date matching startDate (real run 20260723 cases)', () => {
  const parser = createParser();
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  let doreAlley;
  let chicago;
  try {
    doreAlley = parser.normalizeAiEvent(
      { title: 'CHUNK DORE ALLEY - Saturday July 25th', startDate: '2026-07-25', startTime: '15:00', timezone: 'America/Los_Angeles' },
      {}, null, null, null);
    chicago = parser.normalizeAiEvent(
      { title: 'CHUNK Chicago - September 19th', startDate: '2026-09-19', timezone: 'America/Chicago' },
      {}, null, null, null);
  } finally {
    console.log = originalLog;
  }
  assert.equal(doreAlley.title, 'CHUNK DORE ALLEY');
  assert.equal(chicago.title, 'CHUNK Chicago');
  assert.ok(logs.includes(
    '🤖 AI Web: Stripped redundant date from title ("CHUNK DORE ALLEY - Saturday July 25th" → "CHUNK DORE ALLEY")'
  ), `additive strip log line expected, got: ${JSON.stringify(logs)}`);
});

test('normalizeAiEvent strips leading date segments and every separator/month spelling variant', () => {
  const parser = createParser();
  const cases = [
    ['Saturday July 25th - CHUNK DORE ALLEY', '2026-07-25', 'CHUNK DORE ALLEY'],
    ['CHUNK PDX | Aug 22nd', '2026-08-22', 'CHUNK PDX'],
    ['CHUNK PDX – Aug. 22', '2026-08-22', 'CHUNK PDX'],
    ['CHUNK Chicago, September 19th, 2026', '2026-09-19', 'CHUNK Chicago'],
    ['CHUNK - 7/25', '2026-07-25', 'CHUNK']
  ];
  for (const [title, startDate, expected] of cases) {
    const event = parser.normalizeAiEvent(
      { title, startDate, timezone: 'America/Los_Angeles' }, {}, null, null, null);
    assert.equal(event.title, expected, `"${title}" should strip to "${expected}"`);
  }
});

test('normalizeAiEvent KEEPS a title date that mismatches startDate and flags it for manual review', () => {
  const parser = createParser();
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  let event;
  try {
    event = parser.normalizeAiEvent(
      { title: 'CHUNK Chicago - September 19th', startDate: '2026-09-26', timezone: 'America/Chicago' },
      {}, null, null, null);
  } finally {
    console.log = originalLog;
  }
  assert.equal(event.title, 'CHUNK Chicago - September 19th', 'mismatching printed date is never stripped');
  assert.ok(logs.includes(
    '🤖 AI Web: Title contains a date that does not match startDate ("CHUNK Chicago - September 19th" vs 2026-09-26) — kept, verify manually'
  ), `verify-manually log line expected, got: ${JSON.stringify(logs)}`);
});

test('normalizeAiEvent never treats edition years or short remainders as date segments', () => {
  const parser = createParser();

  // Edition year attached to a word: a bare year without month+day never qualifies
  const decadence = parser.normalizeAiEvent(
    { title: 'DECADENCE 2026', startDate: '2026-08-30', timezone: 'America/Chicago' }, {}, null, null, null);
  assert.equal(decadence.title, 'DECADENCE 2026');
  const pride = parser.normalizeAiEvent(
    { title: 'Pride 2027', startDate: '2027-06-26', timezone: 'America/New_York' }, {}, null, null, null);
  assert.equal(pride.title, 'Pride 2027');

  // Remainder after removal too short (<3 chars) → untouched
  const shortBase = parser.normalizeAiEvent(
    { title: 'GO - July 25th', startDate: '2026-07-25', timezone: 'America/New_York' }, {}, null, null, null);
  assert.equal(shortBase.title, 'GO - July 25th');

  // No startDate at all → the strip never runs; normalization still fails
  // closed on the missing date exactly as before (pre-existing behavior).
  assert.equal(parser.normalizeAiEvent({ title: 'CHUNK - July 25th' }, {}, null, null, null), null);
});

test('normalizeAiEvent title date-strip matches the PRINTED local date even when UTC rolls past midnight', () => {
  const parser = createParser();
  // 21:00 in LA is 04:00 UTC the NEXT day — the comparison must use the
  // original extracted startDate string, not the rolled timestamp.
  const event = parser.normalizeAiEvent(
    { title: 'CHUNK DORE ALLEY - July 25th', startDate: '2026-07-25', startTime: '21:00', timezone: 'America/Los_Angeles' },
    {}, null, null, null);
  assert.equal(event.startDate.toISOString(), '2026-07-26T04:00:00.000Z', 'the stored instant really is past midnight UTC');
  assert.equal(event.title, 'CHUNK DORE ALLEY', 'the printed date still matches its local calendar date');
});

test('extraction prompt description instruction tells the model not to lead with the date', () => {
  global.EventSchema = EventSchema; // earlier tests leak a mocked schema — pin the real one
  const parser = createParser();
  const prompt = parser.buildExtractionPrompt(null, {}, null, {}, ['title', 'description'], 'SNIPPET', 'default', {});
  assert.match(prompt,
    /- description: Event description\/tagline from source text; do not invent details\. Do not lead with the event's date\/time \(those are captured separately\) — start from the actual description text\./,
    'the schema line stays intact with the new sentence appended');
});

test('the JSON-LD fast path applies the bare-city organizer prefix too', async () => {
  const parser = createParser();
  const html = `
    <html>
      <head>
        <meta property="og:site_name" content="BEARRACUDA" />
        <meta property="og:title" content="New Orleans⚜️ | BEARRACUDA" />
        <script type="application/ld+json">
          {"@context":"https://schema.org","@graph":[
            {"@type":"Organization","name":"Bearracuda, Inc.","alternateName":"Bearracuda"},
            {"@type":"Event","name":"New Orleans⚜️","startDate":"2026-10-11T22:00:00-05:00",
             "location":{"@type":"Place","name":"The Metropolitan",
               "address":{"@type":"PostalAddress","streetAddress":"310 Andrew Higgins Blvd","addressLocality":"New Orleans","addressRegion":"LA"}}}
          ]}
        </script>
      </head>
      <body><p>Bearracuda New Orleans</p></body>
    </html>
  `;

  const result = await parser.parseEvents(
    { html, url: 'https://bearracuda.com/events/neworleans' }, {}, CITY_TITLE_CITY_CONFIG, 'event-page', null);
  assert.equal(result.events.length, 1, 'the structured-data fast path should be used');
  assert.equal(result.events[0].title, 'BEARRACUDA: New Orleans⚜️');
  assert.equal(result.events[0]._organizer, 'Bearracuda, Inc.');
});

// ---------------------------------------------------------------------------
// Wasted-AI-call cuts (2026-07-13 run findings): Event-less JSON-LD passes,
// duplicate context-prep round-trips, and repair passes for evidence-only
// JSON breakage.
// ---------------------------------------------------------------------------

const NO_EVENT_JSONLD_HTML = `
  <html>
    <head>
      <title>Atlanta | BEARRACUDA</title>
      <meta property="og:title" content="Atlanta | BEARRACUDA" />
      <meta property="og:description" content="Bearracuda returns to Atlanta for one night only" />
      <script type="application/ld+json">
        {"@context":"https://schema.org","@graph":[
          {"@type":"WebPage","name":"Atlanta | BEARRACUDA","url":"https://bearracuda.com/events/atlanta"},
          {"@type":"ImageObject","url":"https://bearracuda.com/images/atlanta.jpg"},
          {"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Events"}]},
          {"@type":"WebSite","name":"BEARRACUDA"},
          {"@type":"Organization","name":"Bearracuda, Inc."}
        ]}
      </script>
    </head>
    <body>
      <h1>Bearracuda Atlanta</h1>
      <p>Saturday August 15 at Future Atlanta, 9pm until late.</p>
      <p>DJs all night long with the best bears in the South.</p>
    </body>
  </html>
`;

test('skips the jsonld extraction pass when the page has no Event-typed JSON-LD', async () => {
  const parser = createParser();
  const calls = [];
  parser.core.callAiGenerate = async (config, prompt, label) => {
    calls.push({ label, prompt });
    return '{}';
  };

  const htmlData = { url: 'https://bearracuda.com/events/atlanta', html: NO_EVENT_JSONLD_HTML };
  const aiConfig = parser.getAiConfig({});
  await parser.extractEventWithAiStrategy(htmlData, aiConfig, null, {}, ['title', 'bar'], null);

  assert.equal(htmlData.hasEventTypedJsonLd, false, 'the determination must be cached on htmlData');
  assert.ok(calls.length > 0, 'meta/content passes must still run');
  assert.ok(
    !calls.some(call => call.prompt.includes('JSON_LD_PRIMARY')),
    'no request may carry the Event-less JSON_LD_PRIMARY payload'
  );
  assert.ok(
    calls.some(call => call.prompt.includes('META_PRIMARY')),
    'the meta pass must be unchanged'
  );
  assert.ok(
    calls.some(call => call.prompt.includes('CONTENT')),
    'the content pass must be unchanged'
  );
});

test('keeps the jsonld extraction pass when the page has an Event-typed JSON-LD node', async () => {
  const parser = createParser();
  const calls = [];
  parser.core.callAiGenerate = async (config, prompt, label) => {
    calls.push({ label, prompt });
    return '{}';
  };

  const htmlData = { url: 'https://sickening.events/e/bearracuda-portland-pridefriday', html: SICKENING_JSONLD_HTML };
  await parser.extractEventWithAiStrategy(htmlData, parser.getAiConfig({}), null, {}, ['title', 'bar'], null);

  assert.equal(parser.pageHasEventTypedJsonLd(htmlData), true);
  assert.ok(
    calls.some(call => call.prompt.includes('JSON_LD_PRIMARY')),
    'a MusicEvent node must keep the jsonld pass running as today'
  );
});

test('context-prep responses are cached per identical prompt within a parser instance', async () => {
  const parser = createParser();
  let contextPrepCalls = 0;
  const extractionPrompts = [];
  parser.core.callAiGenerate = async (config, prompt, label) => {
    if (label === 'context-prep') {
      contextPrepCalls++;
      return 'CORRECTIONS:\n- Cleaned Times: 9:00 PM\n- Core Event Date: August 15, 2026\n- Parent Festival Dates: None';
    }
    extractionPrompts.push(prompt);
    return '{}';
  };

  const htmlData = { url: 'https://x.example/party', html: '<p>party</p>' };
  const aiConfig = parser.getAiConfig({});
  const options = { dataFlags: { content: true } };
  const snippet = 'CONTENT\nSAT AUG 15 / 9PM - LATE at Future Atlanta';

  await parser.extractEventWithTwoPassAi(htmlData, aiConfig, null, {}, ['title'], snippet, 'first', options, null);
  await parser.extractEventWithTwoPassAi(htmlData, aiConfig, null, {}, ['title'], snippet, 'retry', options, null);

  assert.equal(contextPrepCalls, 1, 'the identical context-prep prompt must be paid for exactly once');
  assert.equal(extractionPrompts.length, 2);
  assert.ok(
    extractionPrompts.every(prompt => prompt.includes('PRE-PARSED HELPER DATA')),
    'the cached context result must feed both extraction passes'
  );

  // Different content → a genuinely new context-prep request
  await parser.extractEventWithTwoPassAi(htmlData, aiConfig, null, {}, ['title'], 'CONTENT\nA totally different page', 'other', options, null);
  assert.equal(contextPrepCalls, 2, 'different content must not hit the cache');
});

// The exact breakage shapes from the 2026-07-13 Scriptable run logs: raw quotes
// inside `evidence` strings are the only reason JSON.parse fails.
const TREASUREPDX_BROKEN_RESPONSE = '{"title": {"value": "Treasure Trail Portland PRIDE", "evidence": "name":"Treasure Trail Portland PRIDE | BEARRACUDA", "confidence": 95}, "website": {"value": "https://treasurepdx.com", "evidence": "url":"https://treasurepdx.com/", "confidence": 90}}';
const SEATTLE_BROKEN_RESPONSE = '{"startDate": {"value": "2026-08-15", "evidence": "📅 August 15, 2026" and "SAT, AUG 15 / 9PM - LATE", "confidence": 92}, "startTime": {"value": "21:00", "evidence": "9PM - LATE", "confidence": 88}}';

test('salvages evidence-mangled extraction responses instead of running the repair pass', async () => {
  const parser = createParser();
  const labels = [];
  parser.core.callAiGenerate = async (config, prompt, label) => {
    labels.push(label);
    return TREASUREPDX_BROKEN_RESPONSE;
  };

  const event = await parser.extractEventWithTwoPassAi(
    { url: 'https://treasurepdx.com/', html: '<p>x</p>' },
    parser.getAiConfig({}), null, {}, ['title', 'website'], 'SNIPPET', '', {}, null);

  assert.deepEqual(labels, ['extraction'], 'no repair round-trip may be paid for');
  assert.ok(event, 'the salvaged event must be returned');
  assert.equal(event.title, 'Treasure Trail Portland PRIDE');
  assert.equal(event.website, 'https://treasurepdx.com');
});

test('salvage recovers values, confidences and best-effort evidence from the Seattle payload', () => {
  const parser = createParser();
  assert.equal(parser.core.parseAiEventResponse(SEATTLE_BROKEN_RESPONSE), null, 'the payload must really be unparseable');

  const salvaged = parser.salvageUnparseableAiResponse(SEATTLE_BROKEN_RESPONSE, ['startDate', 'startTime']);
  assert.ok(salvaged);
  assert.equal(salvaged.startDate.value, '2026-08-15');
  assert.equal(salvaged.startDate.confidence, 92);
  assert.match(salvaged.startDate.evidence, /August 15, 2026/, 'mangled evidence text is preserved best-effort');
  assert.equal(salvaged.startTime.value, '21:00');
  assert.equal(salvaged.startTime.confidence, 88);
  assert.equal(salvaged.startTime.evidence, '9PM - LATE');

  // Unknown field names never salvage
  assert.equal(parser.salvageUnparseableAiResponse(SEATTLE_BROKEN_RESPONSE, ['title']), null);
  // A value containing raw quotes is a truncation hazard, not a salvage
  assert.equal(
    parser.salvageUnparseableAiResponse('{"title": {"value": "The "Bear" Party", "evidence": "x", "confidence": 90}}', ['title']),
    null
  );
});

test('truly garbage responses still fall through to the AI repair pass', async () => {
  const parser = createParser();
  const labels = [];
  parser.core.callAiGenerate = async (config, prompt, label) => {
    labels.push(label);
    if (label === 'repair') {
      return '{"title": {"value": "Repaired Party", "evidence": "Repaired Party", "confidence": 90}}';
    }
    return 'not json at all &&&';
  };

  const event = await parser.extractEventWithTwoPassAi(
    { url: 'https://x.example/', html: '<p>x</p>' },
    parser.getAiConfig({}), null, {}, ['title'], 'SNIPPET', '', {}, null);

  assert.deepEqual(labels, ['extraction', 'repair'], 'garbage must reach the repair pass exactly as today');
  assert.equal(event.title, 'Repaired Party');
});

test('valid extraction responses never invoke salvage', async () => {
  const parser = createParser();
  let salvageCalls = 0;
  const originalSalvage = parser.salvageUnparseableAiResponse.bind(parser);
  parser.salvageUnparseableAiResponse = (...args) => {
    salvageCalls++;
    return originalSalvage(...args);
  };
  const labels = [];
  parser.core.callAiGenerate = async (config, prompt, label) => {
    labels.push(label);
    return '{"title": {"value": "Clean Party", "evidence": "Clean Party", "confidence": 90}}';
  };

  const event = await parser.extractEventWithTwoPassAi(
    { url: 'https://x.example/', html: '<p>x</p>' },
    parser.getAiConfig({}), null, {}, ['title'], 'SNIPPET', '', {}, null);

  assert.equal(event.title, 'Clean Party');
  assert.equal(salvageCalls, 0, 'the happy path must not change');
  assert.deepEqual(labels, ['extraction']);
});

test('getPageBrandNames caches the brand extraction on htmlData', () => {
  const parser = createParser();
  const htmlData = { html: BEARRACUDA_HTML, url: 'https://bearracuda.com/events/portland' };
  let extractCalls = 0;
  const originalExtract = parser.extractPageBrandNames.bind(parser);
  parser.extractPageBrandNames = (html) => {
    extractCalls++;
    return originalExtract(html);
  };

  const first = parser.getPageBrandNames(htmlData);
  const second = parser.getPageBrandNames(htmlData);
  const viaSpread = parser.getPageBrandNames({ ...htmlData, html: 'OCR TEXT\n' + htmlData.html });

  assert.equal(extractCalls, 1, 'the page html must be parsed exactly once');
  assert.equal(second, first, 'repeat lookups return the cached array');
  assert.deepEqual(viaSpread, first, 'spread copies (segments/OCR) inherit the cache');
});
// ---------------------------------------------------------------------------
// Pass-result guards (2026-07-13 run findings: a junk meta-pass answer — bar:
// "BEARRACUDA" from og:title — consumed the field slot, later passes never
// re-requested bar, and the end-of-pipeline guard left the event with NO bar
// even though the page body named the venue. Same mechanism for the site-level
// WebSite.description tagline leaking in as the event description.)
// ---------------------------------------------------------------------------

const BEARRACUDA_TAGLINE_HTML = `
  <html>
    <head>
      <meta property="og:site_name" content="BEARRACUDA" />
      <script type="application/ld+json">
        {"@context":"https://schema.org","@graph":[
          {"@type":"Organization","name":"Bearracuda, Inc.","alternateName":"Bearracuda"},
          {"@type":"WebSite","name":"BEARRACUDA","description":"A Safe and Inclusive Space for Furry Friends and Their Admirers!"},
          {"@type":"Event","name":"Treasure Trail Portland PRIDE","description":"One night only at Sanctuary."}
        ]}
      </script>
    </head>
    <body><p>Treasure Trail Portland PRIDE — 🪩 Sanctuary, 📍 Map → Sanctuary</p></body>
  </html>
`;

const SITE_TAGLINE = 'A Safe and Inclusive Space for Furry Friends and Their Admirers!';

// Drives extractFieldsAcrossSnippets — the seam where per-pass results are
// merged (mergeAiEventFields) and later passes are narrowed to still-missing
// fields (getRemainingPromptFields) — with one stubbed AI answer per snippet.
async function runPassSequence(parser, htmlData, fields, passResults) {
  const requestedFieldsPerPass = [];
  parser.extractEventWithTwoPassAi = async (hd, aiConfig, cityConfig, parserConfig, requestedFields) => {
    requestedFieldsPerPass.push(requestedFields.slice());
    return passResults[requestedFieldsPerPass.length - 1] || {};
  };
  // Evidence validation is exercised elsewhere; pass results through untouched.
  parser.validateAiEventEvidence = (partial) => ({ event: partial || {}, report: { dropped: [] } });
  const snippets = passResults.map((_, index) => `SNIPPET ${index + 1}`);
  const merged = await parser.extractFieldsAcrossSnippets(
    htmlData, {}, null, {}, fields, snippets, 'test');
  return { merged, requestedFieldsPerPass };
}

test('a brand bar is rejected at pass time and the field is re-requested in later passes', async () => {
  const parser = createParser();
  const htmlData = { html: BEARRACUDA_TAGLINE_HTML, url: 'https://bearracuda.com/events/treasurepdx/' };

  const { merged, requestedFieldsPerPass } = await runPassSequence(parser, htmlData, ['title', 'bar'], [
    { title: 'Treasure Trail Portland PRIDE', bar: 'BEARRACUDA' }, // meta-style pass: brand leak
    { bar: 'Sanctuary' }                                            // content-style pass: real venue
  ]);

  assert.deepEqual(requestedFieldsPerPass[0], ['title', 'bar']);
  assert.deepEqual(requestedFieldsPerPass[1], ['bar'],
    'bar must stay in the next pass\'s field list after the brand rejection (title resolved, so only bar remains)');
  assert.equal(merged.bar, 'Sanctuary', 'the later pass\'s real venue must be accepted');
  assert.equal(merged.title, 'Treasure Trail Portland PRIDE');

  // ...and it survives to the final event through normalizeAiEvent
  const event = parser.normalizeAiEvent(
    { ...merged, startDate: '2026-07-18', startTime: '21:00' }, {}, htmlData, null, null);
  assert.equal(event.bar, 'Sanctuary');
});

test('a non-brand bar from an early pass is accepted and NOT re-requested', async () => {
  const parser = createParser();
  const htmlData = { html: BEARRACUDA_TAGLINE_HTML, url: 'https://bearracuda.com/events/treasurepdx/' };

  const { merged, requestedFieldsPerPass } = await runPassSequence(parser, htmlData, ['title', 'bar'], [
    { bar: 'Sanctuary' },
    { title: 'Treasure Trail Portland PRIDE', bar: 'Some Other Venue' }
  ]);

  assert.deepEqual(requestedFieldsPerPass[0], ['title', 'bar']);
  assert.deepEqual(requestedFieldsPerPass[1], ['title'], 'an accepted bar must not be requested again');
  assert.equal(merged.bar, 'Sanctuary', 'the first accepted value wins');
});

test('a title that IS the brand is rejected at pass time; a brand-suffixed title is kept', async () => {
  const parser = createParser();
  const htmlData = { html: BEARRACUDA_TAGLINE_HTML, url: 'https://bearracuda.com/events/ptown/' };

  const { merged, requestedFieldsPerPass } = await runPassSequence(parser, htmlData, ['title'], [
    { title: 'BEARRACUDA' },                 // whole title is the brand → rejected
    { title: 'Provincetown⚓ | BEARRACUDA' }  // brand suffix only → kept at pass time
  ]);

  assert.deepEqual(requestedFieldsPerPass[1], ['title'], 'title must be re-requested after the brand-only rejection');
  assert.equal(merged.title, 'Provincetown⚓ | BEARRACUDA',
    'a title merely containing the brand is kept at pass time (suffix strip happens at the end)');
});

test('extractPageSiteTaglines reads only WebSite.description, never Event descriptions', () => {
  const parser = createParser();
  const taglines = parser.extractPageSiteTaglines(BEARRACUDA_TAGLINE_HTML);
  assert.deepEqual(taglines, [SITE_TAGLINE]);
  assert.ok(!taglines.includes('One night only at Sanctuary.'),
    'Event-level descriptions are never treated as site taglines');
  assert.deepEqual(parser.extractPageSiteTaglines(BEARRACUDA_HTML), [],
    'a WebSite node without a description yields no taglines');
});

test('a site-tagline description is rejected at pass time and later passes can recover the real one', async () => {
  const parser = createParser();
  const htmlData = { html: BEARRACUDA_TAGLINE_HTML, url: 'https://bearracuda.com/events/neworleans/' };

  const { merged, requestedFieldsPerPass } = await runPassSequence(parser, htmlData, ['description'], [
    // Differing whitespace and case must still match exactly after normalization
    { description: '  a safe  and inclusive space for furry friends and their admirers!  ' },
    { description: 'One night only at Sanctuary.' }
  ]);

  assert.deepEqual(requestedFieldsPerPass[1], ['description'],
    'description must stay open after the tagline rejection');
  assert.equal(merged.description, 'One night only at Sanctuary.');
});

test('normalizeAiEvent drops a site-tagline description as a final backstop', () => {
  const parser = createParser();
  const htmlData = { html: BEARRACUDA_TAGLINE_HTML, url: 'https://bearracuda.com/events/neworleans/' };

  const event = parser.normalizeAiEvent(
    { title: 'Bearracuda New Orleans', description: SITE_TAGLINE, startDate: '2026-08-01' },
    {}, htmlData, null, null);
  assert.equal(event.description, '', 'the site blurb must not survive as the event description');

  // A configured metadata description is a deliberate override and survives,
  // including as the fallback when the AI tagline is dropped.
  const configured = parser.normalizeAiEvent(
    { title: 'Bearracuda New Orleans', description: SITE_TAGLINE, startDate: '2026-08-01' },
    { metadata: { description: 'Bearracuda takes over NOLA.' } }, htmlData, null, null);
  assert.equal(configured.description, 'Bearracuda takes over NOLA.');
});

test('genuine event taglines are never dropped, even ones containing brand words', async () => {
  const parser = createParser();
  const htmlData = { html: BEARRACUDA_TAGLINE_HTML, url: 'https://bearracuda.com/events/ptown/' };

  const { merged } = await runPassSequence(parser, htmlData, ['description'], [
    { description: 'BEAR WEEK KICK OFF' }
  ]);
  assert.equal(merged.description, 'BEAR WEEK KICK OFF', 'distinct event taglines are kept at pass time');

  const event = parser.normalizeAiEvent(
    { title: 'Bearracuda Provincetown', description: 'BEAR WEEK KICK OFF', startDate: '2026-07-11' },
    {}, htmlData, null, null);
  assert.equal(event.description, 'BEAR WEEK KICK OFF', 'distinct event taglines survive the final guard');
});

test('the description guard is inert on pages with no WebSite.description', async () => {
  const parser = createParser();
  // BEARRACUDA_HTML declares WebSite/Organization names but no description
  const htmlData = { html: BEARRACUDA_HTML, url: 'https://bearracuda.com/events/portland' };

  const { merged, requestedFieldsPerPass } = await runPassSequence(parser, htmlData, ['description'], [
    { description: SITE_TAGLINE }
  ]);
  assert.equal(requestedFieldsPerPass.length, 1, 'nothing left to re-request');
  assert.equal(merged.description, SITE_TAGLINE, 'no site tagline on the page → nothing to reject');

  const event = parser.normalizeAiEvent(
    { title: 'Portland PRIDE FRIDAY', description: SITE_TAGLINE, startDate: '2026-07-17' },
    {}, htmlData, null, null);
  assert.equal(event.description, SITE_TAGLINE, 'final guard is inert without a page tagline');
});

// ---------------------------------------------------------------------------
// Confidence retry: location (coordinates) is never re-requested (2026-07-12
// run: the retry pass fabricated coordinates from the street address on nearly
// every page, and the evidence gate dropped them every time)
// ---------------------------------------------------------------------------

test('the confidence-retry field list never contains location; main-pass selection still does', () => {
  // Earlier tests install mock EventSchema globals; pin the real schema so
  // the coords→location canonicalization is exercised for real.
  global.EventSchema = EventSchema;
  const parser = createParser();
  const lowWithCandidates = (partitions) => ({
    level: 'low',
    reason: 'expected-strong-signal-missing-validated-value',
    sourcePartition: null,
    retryCandidates: partitions
  });

  // location and bar are both low-confidence retry candidates → only bar is planned
  const diagnostics = {
    fieldConfidence: {
      title: { level: 'high', reason: 'expected-source-produced-validated-value', sourcePartition: 'jsonld' },
      bar: lowWithCandidates(['content']),
      location: lowWithCandidates(['jsonld', 'content'])
    },
    expectedSignals: {
      title: { expected: ['jsonld'], strong: ['jsonld'] },
      bar: { expected: ['content'], strong: ['content'] },
      location: { expected: ['jsonld', 'content'], strong: ['jsonld'] }
    }
  };
  const plan = parser.planConfidenceRetries(diagnostics, ['title', 'bar', 'location']);
  const plannedFields = plan.flatMap(entry => entry.fields);
  assert.ok(!plannedFields.includes('location'), `location must never appear in a retry plan, got: ${JSON.stringify(plan)}`);
  assert.deepEqual(plan, [{ partition: 'content', fields: ['bar'] }], 'other low-confidence fields still retry');

  // location as the ONLY low-confidence field → empty plan → the retry pass is skipped entirely
  const locationOnly = {
    fieldConfidence: { location: lowWithCandidates(['jsonld']) },
    expectedSignals: { location: { expected: ['jsonld'], strong: ['jsonld'] } }
  };
  assert.deepEqual(parser.planConfidenceRetries(locationOnly, ['location']), [],
    'a location-only retry plan must be empty (no zero-field request)');

  // The no-candidates OCR-content fallback path must not re-add location either
  const contentFallback = {
    fieldConfidence: { location: { level: 'low', reason: 'no-validated-value', sourcePartition: null } },
    expectedSignals: { location: { expected: ['content'], strong: [] } }
  };
  assert.deepEqual(parser.planConfidenceRetries(contentFallback, ['location']), [],
    'the content-expected fallback must not resurrect location');

  // Main-pass field selection is untouched: location is a schema prompt field
  // and stays requested while missing (a page could legitimately embed coords)
  const schemaFields = parser.getEventSchemaPromptFields().map(field => field.normalizedName);
  assert.ok(schemaFields.includes('location'), 'the coords prompt field must still normalize to location');
  assert.deepEqual(
    parser.getRemainingPromptFields(['title', 'location'], { title: 'Treasure Trail Portland PRIDE' }),
    ['location'],
    'a missing location is still requested by the main extraction passes');
});

test('upgradeCdnThumbnailUrl rewrites blurred Wix thumbnails to the original asset', () => {
  const parser = createParser();
  const thumb = 'https://static.wixstatic.com/media/42b6cb_272cdd18dcc74ec5a3eb10e288658278~mv2.jpg/v1/fill/w_147,h_184,al_c,q_80,usm_0.66_1.00_0.01,blur_2,enc_auto/42b6cb_272cdd18dcc74ec5a3eb10e288658278~mv2.jpg';
  assert.equal(
    parser.upgradeCdnThumbnailUrl(thumb),
    'https://static.wixstatic.com/media/42b6cb_272cdd18dcc74ec5a3eb10e288658278~mv2.jpg'
  );

  // Small width alone (no blur) also marks a degraded thumbnail
  const smallNoBlur = 'https://static.wixstatic.com/media/42b6cb_aaa~mv2.jpg/v1/fill/w_300,h_375,al_c,q_80,enc_auto/42b6cb_aaa~mv2.jpg';
  assert.equal(
    parser.upgradeCdnThumbnailUrl(smallNoBlur),
    'https://static.wixstatic.com/media/42b6cb_aaa~mv2.jpg'
  );
});

test('upgradeCdnThumbnailUrl leaves high-quality transforms unchanged', () => {
  const parser = createParser();
  const fullSize = 'https://static.wixstatic.com/media/42b6cb_272cdd18dcc74ec5a3eb10e288658278~mv2.jpg/v1/fill/w_3300,h_4125,al_c,q_90/42b6cb_272cdd18dcc74ec5a3eb10e288658278~mv2.jpg';
  assert.equal(parser.upgradeCdnThumbnailUrl(fullSize), fullSize, 'w_3300 q_90 is not a degraded thumbnail');
});

test('upgradeCdnThumbnailUrl leaves non-Wix URLs unchanged', () => {
  const parser = createParser();
  const nonWix = 'https://example.com/images/flyer.jpg?w=100&blur=2';
  assert.equal(parser.upgradeCdnThumbnailUrl(nonWix), nonWix);
});

test('upgradeCdnThumbnailUrl handles URL-encoded tildes in the asset name', () => {
  const parser = createParser();
  const encoded = 'https://static.wixstatic.com/media/42b6cb_272cdd18dcc74ec5a3eb10e288658278%7Emv2.jpg/v1/fill/w_147,h_184,al_c,q_80,blur_2,enc_auto/42b6cb_272cdd18dcc74ec5a3eb10e288658278%7Emv2.jpg';
  assert.equal(
    parser.upgradeCdnThumbnailUrl(encoded),
    'https://static.wixstatic.com/media/42b6cb_272cdd18dcc74ec5a3eb10e288658278%7Emv2.jpg'
  );
});

test('upgradeCdnThumbnailUrl returns malformed inputs unchanged', () => {
  const parser = createParser();
  assert.equal(parser.upgradeCdnThumbnailUrl('not a url'), 'not a url');
  assert.equal(parser.upgradeCdnThumbnailUrl(''), '');
  assert.equal(parser.upgradeCdnThumbnailUrl(null), null);
  assert.equal(parser.upgradeCdnThumbnailUrl(undefined), undefined);
  // Transform path present but empty params — conservative, unchanged
  const emptyParams = 'https://static.wixstatic.com/media/abc.jpg/v1/fill/';
  assert.equal(parser.upgradeCdnThumbnailUrl(emptyParams), emptyParams);
});

test('normalizeAiEvent upgrades a blurred CDN thumbnail image field', () => {
  const parser = createParser();
  const thumb = 'https://static.wixstatic.com/media/42b6cb_272cdd18dcc74ec5a3eb10e288658278~mv2.jpg/v1/fill/w_147,h_184,al_c,q_80,usm_0.66_1.00_0.01,blur_2,enc_auto/42b6cb_272cdd18dcc74ec5a3eb10e288658278~mv2.jpg';
  const aiEvent = {
    title: 'CHUNK DORE ALLEY',
    startDate: '2026-07-25',
    startTime: '21:00',
    image: thumb
  };

  const event = parser.normalizeAiEvent(aiEvent, {}, null, null, null);
  assert.ok(event, 'event should normalize');
  assert.equal(
    event.image,
    'https://static.wixstatic.com/media/42b6cb_272cdd18dcc74ec5a3eb10e288658278~mv2.jpg',
    'the stored image must never be the blurred thumbnail'
  );
});

// ---------------------------------------------------------------------------
// Scriptable-safe stripSizeParams (2026-07-12 run findings: the URL global does
// not exist in Scriptable, so URL-based stripping silently no-oped and every
// segment logged "failed to match any of the N OCR results")
// ---------------------------------------------------------------------------

test('stripSizeParams strips Wix transforms and unwraps proxies without the URL global (Scriptable)', () => {
  const parser = createParser();
  const asset = 'https://static.wixstatic.com/media/8e6e19_16d4c264742a4b0e93a445f2f04e2170~mv2.jpg';
  const variant = `${asset}/v1/fill/w_147,h_184,al_c,q_80,usm_0.66_1.00_0.01,blur_2,enc_auto/8e6e19_16d4c264742a4b0e93a445f2f04e2170~mv2.jpg`;
  const inner = 'https://cdn.evbuc.com/images/1184410354/185013722403/1/original.20260512-160408';
  const wrapped = `https://img.evbuc.com/${encodeURIComponent(inner)}?crop=focalpoint&fit=crop&w=940&auto=format%2Ccompress&q=75&s=79b82ef9b2961bb09d52102535747556`;

  const RealURL = global.URL;
  global.URL = undefined;
  try {
    assert.equal(parser.stripSizeParams(variant), asset, 'Wix transform variant must strip to the bare asset URL');
    assert.equal(parser.stripSizeParams(asset), asset, 'bare asset URL must pass through unchanged');
    assert.equal(parser.stripSizeParams(wrapped), inner, 'evbuc path-wrapped proxy must unwrap to the inner URL');
    assert.equal(
      parser.stripSizeParams('https://x.example/img.jpg?w=1920&h=1080&fit=crop'),
      'https://x.example/img.jpg?fit=crop',
      'size query params must be dropped while other params survive'
    );
    assert.equal(
      parser.stripSizeParams('https://x.example/photos/1920x1080/flyer.jpg'),
      'https://x.example/photos/flyer.jpg',
      'dimension path segments must be dropped'
    );
  } finally {
    global.URL = RealURL;
  }
});

test('filterOcrResultsForSegment matches bare-asset OCR keys to transform-variant segment images without the URL global', () => {
  const parser = createParser();
  const asset = 'https://static.wixstatic.com/media/8e6e19_16d4c264742a4b0e93a445f2f04e2170~mv2.jpg';
  const variant = `${asset}/v1/fill/w_147,h_184,al_c,q_80,usm_0.66_1.00_0.01,blur_2,enc_auto/8e6e19_16d4c264742a4b0e93a445f2f04e2170~mv2.jpg`;
  const ocrResults = [
    { url: asset, text: 'FLYER TEXT', imageClassification: 'event-flyer' },
    { url: 'https://static.wixstatic.com/media/aaaa11_ffffffffffffffffffffffffffffffff~mv2.jpg', text: 'OTHER FLYER', imageClassification: 'event-flyer' }
  ];
  const segment = { html: '', lines: ['SAT, AUG 22 BEAR NIGHT'], imageHintUrls: [variant] };

  const RealURL = global.URL;
  global.URL = undefined;
  try {
    const matched = parser.filterOcrResultsForSegment(ocrResults, segment, 'https://wix-site.example/events');
    assert.equal(matched.length, 1, 'exactly the segment\'s own flyer OCR must match');
    assert.equal(matched[0].url, asset);
  } finally {
    global.URL = RealURL;
  }
});

// ---------------------------------------------------------------------------
// Weekday-pinned year inference (2026-07-12 run findings: listing text stated a
// weekday but no year, the model hallucinated one, and window repair landed on
// the wrong weekday — e.g. "Sat, Aug 22" → 2025-08-22, a Friday)
// ---------------------------------------------------------------------------

const FROZEN_NOW = () => new Date(Date.UTC(2026, 6, 13, 12, 0, 0)); // 2026-07-13

test('resolveWeekdayPinnedYear pins hallucinated years to the stated weekday', () => {
  const parser = createParser();
  parser.now = FROZEN_NOW;
  // The four real failures from the 2026-07-12 run:
  assert.equal(parser.resolveWeekdayPinnedYear('2024-08-22', 'Sat, Aug 22').value, '2026-08-22');
  assert.equal(parser.resolveWeekdayPinnedYear('2026-10-11', 'Sat, Oct 11').value, '2025-10-11', 'past dates are allowed so the past-filter can drop them');
  assert.equal(parser.resolveWeekdayPinnedYear('2027-01-17', 'Sat, Jan 17').value, '2026-01-17');
  assert.equal(parser.resolveWeekdayPinnedYear('2026-12-31', 'Wed, Dec 31').value, '2025-12-31');
});

test('weekday pinning leaves weekday-less evidence and unparseable values alone', () => {
  const parser = createParser();
  parser.now = FROZEN_NOW;
  assert.equal(parser.resolveWeekdayPinnedYear('2024-08-22', 'Aug 22, 2024'), null, 'an explicit year with no weekday anywhere falls through');
  assert.equal(parser.resolveWeekdayPinnedYear('2024-08-22', 'Aug 22'), null, 'no weekday falls through to existing behavior');
  assert.equal(parser.resolveWeekdayPinnedYear('2024-08-22', ''), null, 'missing evidence falls through');
  assert.equal(parser.resolveWeekdayPinnedYear('Aug 22', 'Sat, Aug 22'), null, 'a value without a 4-digit year cannot be rewritten');
  assert.equal(parser.resolveWeekdayPinnedYear('2026-08-22', 'Saturday party vibes'), null, 'a weekday with no adjacent date does not pin');
});

test('weekday pinning verifies explicit evidence years against the stated weekday', () => {
  const parser = createParser();
  parser.now = FROZEN_NOW;
  // NYE Chicago (2026-07-13 run): the helper pass leaked "2025" into the
  // evidence string, so the old explicit-year guard refused to pin an extracted
  // date that was CORRECT (but past) — window repair then invented a 2027
  // phantom. The stated weekday matches the date+year as extracted → pin as-is.
  const nye = parser.resolveWeekdayPinnedYear(
    '2025-12-31',
    'OCR_IMAGE_TEXT: "WEDNESDAY DECEMBER 31st" and PRE-PARSED HELPER DATA: "Core Event Date": "Wednesday, December 31, 2025"'
  );
  assert.ok(nye, 'matching weekday and year must pin the extracted date');
  assert.equal(nye.value, '2025-12-31');
  assert.equal(nye.pinnedYear, 2025);
  // The pin must protect the correct past date from the year-window bump.
  const normalized = parser.normalizeEventDates(
    new Date(Date.UTC(2026, 0, 1, 3, 0, 0)), // combined 10PM CT on the pinned date
    new Date(Date.UTC(2026, 0, 1, 3, 0, 0)),
    { start: true, end: true }
  );
  assert.equal(normalized.startDate.toISOString(), '2026-01-01T03:00:00.000Z', 'pinned past instant stays past so the past-filter can drop it');
  // Contradicting year: the weekday wins and the year is recomputed.
  const contradicted = parser.resolveWeekdayPinnedYear('2024-08-22', 'Sat, Aug 22, 2024');
  assert.equal(contradicted.value, '2026-08-22', '2024-08-22 is a Thursday; the stated Saturday pins 2026');
  // Genuinely future date with agreeing year and weekday stays untouched.
  const future = parser.resolveWeekdayPinnedYear('2026-08-22', 'Sat, Aug 22, 2026');
  assert.equal(future.value, '2026-08-22');
  assert.equal(future.pinnedYear, 2026);
});

test('weekday pinning falls back to the source content when evidence lacks a weekday', () => {
  const parser = createParser();
  parser.now = FROZEN_NOW;
  // CHUNK SF Jan 17 (2026-07-13 run): the flyer put "SATURDAY" on its own line
  // above "JANUARY 17TH", and the model's evidence quoted only the date line —
  // no weekday, no pin, and 2025-01-17 was bumped to a phantom future date.
  const source = 'CHUNK\nSATURDAY\nJANUARY 17TH\n9PM-2AM\n1192 FOLSOM ST';
  const pinned = parser.resolveWeekdayPinnedYear('2025-01-17', 'JANUARY 17TH', source);
  assert.ok(pinned, 'a weekday on the line above the date token must pin');
  assert.equal(pinned.value, '2026-01-17', '2026-01-17 is the Saturday');
  // No weekday anywhere near the date token → existing behavior (no pin).
  assert.equal(parser.resolveWeekdayPinnedYear('2025-01-17', 'JANUARY 17TH', 'CHUNK\nJANUARY 17TH\n9PM-2AM'), null);
  // Ambiguous: the date token appears twice with conflicting adjacent weekdays.
  const ambiguous = 'FRIDAY\nJANUARY 17TH\nother party\nSATURDAY\nJANUARY 17TH';
  assert.equal(parser.resolveWeekdayPinnedYear('2025-01-17', 'JANUARY 17TH', ambiguous), null);
  // Date-like text between the weekday and the token breaks adjacency.
  assert.equal(parser.resolveWeekdayPinnedYear('2025-01-17', 'JANUARY 17TH', 'SATURDAY DEC 13\nJANUARY 17TH'), null);
});

test('adjustLikelyEventYear re-anchors on the current year when hallucinated-year ±1 misses the window', () => {
  const parser = createParser();
  parser.now = FROZEN_NOW;
  // "Sat, Aug 22" guessed as 2024: 2023/2024/2025 are all outside the window,
  // but the current-year anchor finds 2026-08-22.
  const adjusted = parser.adjustLikelyEventYear(new Date(Date.UTC(2024, 7, 22)));
  assert.equal(adjusted.toISOString().slice(0, 10), '2026-08-22');
  // In-window dates are untouched.
  const inWindow = parser.adjustLikelyEventYear(new Date(Date.UTC(2026, 8, 4)));
  assert.equal(inWindow.toISOString().slice(0, 10), '2026-09-04');
});

test('normalizeEventDates keeps weekday-pinned past dates instead of repairing them into the window', () => {
  const parser = createParser();
  parser.now = FROZEN_NOW;
  const pinnedStart = new Date(Date.UTC(2025, 9, 11, 22, 0, 0)); // Sat 2025-10-11, outside the window
  const pinnedResult = parser.normalizeEventDates(new Date(pinnedStart), new Date(pinnedStart), { start: true, end: true });
  assert.equal(pinnedResult.startDate.toISOString(), '2025-10-11T22:00:00.000Z');
  assert.equal(pinnedResult.endDate.toISOString(), '2025-10-11T22:00:00.000Z');
  // Without the pin the old window repair still applies (and picks 2026-10-11).
  const unpinnedResult = parser.normalizeEventDates(new Date(pinnedStart), new Date(pinnedStart));
  assert.equal(unpinnedResult.startDate.toISOString().slice(0, 10), '2026-10-11');
});

test('extraction flattens field objects through weekday pinning and normalizeAiEvent honors the pin', async () => {
  global.EventSchema = EventSchema; // earlier tests leak a mocked schema — pin the real one
  const parser = createParser();
  parser.now = FROZEN_NOW;
  const response = JSON.stringify({
    title: { value: 'BEAR NIGHT', evidence: 'BEAR NIGHT', confidence: 95 },
    startDate: { value: '2026-10-11', evidence: 'Sat, Oct 11', confidence: 90 }
  });
  parser.core.callAiGenerate = async () => response;

  const event = await parser.extractEventWithTwoPassAi(
    { html: '<p>Sat, Oct 11 BEAR NIGHT</p>', url: 'https://x.example/events' },
    {}, null, {}, ['title', 'startDate'], 'Sat, Oct 11 BEAR NIGHT', 'test',
    { dataFlags: { jsonLd: true } }
  );
  assert.equal(event.startDate, '2025-10-11', 'the AI year must be overridden by the stated weekday');
  assert.deepEqual(event.__weekdayPinnedYears, { start: true });

  // normalizeAiEvent must keep the pinned (past) year, and the derived end date
  // inherits the pin so the pair is not split across years.
  const normalized = parser.normalizeAiEvent({
    title: 'BEAR NIGHT',
    startDate: '2025-10-11',
    startTime: '21:00',
    __weekdayPinnedYears: { start: true }
  }, {}, null, null, null);
  assert.ok(normalized);
  assert.equal(normalized.startDate.toISOString().slice(0, 10), '2025-10-11');
  assert.equal(normalized.endDate.toISOString().slice(0, 10), '2025-10-11');
});

// ---------------------------------------------------------------------------
// Wix server-data (warmup-data) enrichment: the wix-warmup-data blob carries
// authoritative coordinates, timezone, exact UTC instants and ticket prices.
// Enrichment ONLY — it fills empty fields on the finished events and never
// causes any extraction step (JSON-LD path, OCR, AI) to be skipped.
// ---------------------------------------------------------------------------

// Trimmed real structure from chunk-party.com (the app GUID is deliberately
// NOT the production events-app GUID — the extractor must iterate keys). The
// registration.ticketing summary carries fee-INCLUSIVE totals ($21.03/$31.52)
// while the tickets[] array (a sibling of "event") carries the base sticker
// prices — the cover must come from tickets[], never the summary.
const WIX_WARMUP_HTML = `
<html><head>
<script type="application/json" id="wix-warmup-data">{"appsWarmupData":{"deadbeef-0000-4000-8000-000000000000":{"EventsPageInitialState":{"event":{"event":{
  "id":"2a06f832-0000-4000-8000-000000000000",
  "location":{"name":"Nova PDX","coordinates":{"lat":45.52281000000001,"lng":-122.6581342},"address":"722 E Burnside St, Portland, OR 97214, USA","fullAddress":{"country":"US","subdivision":"OR","city":"Portland","postalCode":"97214-1219","formattedAddress":"722 E Burnside St, Portland, OR 97214, USA","geocode":{"latitude":45.52281000000001,"longitude":-122.6581342}}},
  "scheduling":{"config":{"startDate":"2026-08-23T04:00:00.000Z","endDate":"2026-08-23T09:00:00.000Z","timeZoneId":"America/Los_Angeles"}},
  "title":"CHUNK Portland - SUMMER BLOW OUT!","slug":"chunk-portland-summer-blow-out",
  "registration":{"ticketing":{"lowestTicketPrice":{"amount":"21.03","currency":"USD"},"highestTicketPrice":{"amount":"31.52","currency":"USD"},"lowestTicketPriceFormatted":"$21.03","highestTicketPriceFormatted":"$31.52","soldOut":false}}
}},"tickets":[
  {"id":"t1","price":{"amount":"20.50","currency":"USD","value":"20.50"},"free":false,"name":"Early Bird GA","limitPerCheckout":20,"orderIndex":0,"wixFeeConfig":{"type":2},"saleStatus":1,"pricing":{"fixedPrice":{"amount":"20.50","currency":"USD","value":"20.50"},"pricingType":0}},
  {"id":"t2","price":{"amount":"30.75","currency":"USD","value":"30.75"},"free":false,"name":"Tier 1 GA","limitPerCheckout":50,"orderIndex":1,"wixFeeConfig":{"type":2},"saleStatus":1,"pricing":{"fixedPrice":{"amount":"30.75","currency":"USD","value":"30.75"},"pricingType":0}}
]}}}}</script>
</head><body>CHUNK Portland - SUMMER BLOW OUT!</body></html>`;

const CHUNK_PAGE_URL = 'https://www.chunk-party.com/event-details/chunk-portland-summer-blow-out';

const PORTLAND_CITY_CONFIG = {
  portland: { timezone: 'America/Los_Angeles', patterns: ['portland', 'pdx'] }
};

test('extractWixServerEventData parses the warmup blob without the URL global (Scriptable)', () => {
  const parser = createParser();
  const RealURL = global.URL;
  global.URL = undefined;
  try {
    const record = parser.extractWixServerEventData(WIX_WARMUP_HTML);
    assert.ok(record, 'the blob must parse even though its app GUID is unknown');
    assert.equal(record.title, 'CHUNK Portland - SUMMER BLOW OUT!');
    assert.equal(record.slug, 'chunk-portland-summer-blow-out');
    // Byte-for-byte the OpenStreetMapNormalizer location format: "<lat>, <lng>"
    assert.equal(record.coordinates, '45.52281000000001, -122.6581342');
    assert.equal(record.timezone, 'America/Los_Angeles');
    assert.equal(record.startDateUtc.toISOString(), '2026-08-23T04:00:00.000Z');
    assert.equal(record.endDateUtc.toISOString(), '2026-08-23T09:00:00.000Z');
    assert.equal(record.address, '722 E Burnside St, Portland, OR 97214, USA');
    assert.equal(record.city, 'portland');
    assert.equal(record.cover, '$20.50-$30.75');
  } finally {
    global.URL = RealURL;
  }
});

test('extractWixServerEventData yields null for absent, garbage or event-less blobs', () => {
  const parser = createParser();
  const RealURL = global.URL;
  global.URL = undefined;
  try {
    assert.equal(parser.extractWixServerEventData('<html><body>no blob here</body></html>'), null);
    assert.equal(parser.extractWixServerEventData(''), null);
    assert.equal(parser.extractWixServerEventData(null), null);
    assert.equal(
      parser.extractWixServerEventData('<script type="application/json" id="wix-warmup-data">{not json at all'),
      null
    );
    assert.equal(
      parser.extractWixServerEventData('<script type="application/json" id="wix-warmup-data">{"appsWarmupData":{"x":{"SomethingElse":{}}}}</script>'),
      null,
      'a warmup blob without an EventsPageInitialState event is not server data'
    );
  } finally {
    global.URL = RealURL;
  }
});

test('extractWixServerEventData ignores wall-clock scheduling dates and bogus timezone ids', () => {
  const parser = createParser();
  // Same shape, but offset-less dates and a non-IANA timezone
  const html = WIX_WARMUP_HTML
    .replace('2026-08-23T04:00:00.000Z', '2026-08-22T21:00:00')
    .replace('2026-08-23T09:00:00.000Z', '2026-08-23T02:00:00')
    .replace('America/Los_Angeles', 'PST');
  const record = parser.extractWixServerEventData(html);
  assert.ok(record);
  assert.equal(record.startDateUtc, null, 'offset-less dates are not exact instants');
  assert.equal(record.endDateUtc, null);
  assert.equal(record.timezone, null, 'a non-IANA id must not pass through');
  // Explicit-offset (non-Z) instants are exact too
  const offsetRecord = parser.extractWixServerEventData(
    WIX_WARMUP_HTML.replace('2026-08-23T04:00:00.000Z', '2026-08-22T21:00:00-07:00')
  );
  assert.equal(offsetRecord.startDateUtc.toISOString(), '2026-08-23T04:00:00.000Z');
});

test('applyWixServerDataEnrichment fills only empty fields on a matching event', () => {
  const parser = createParser();
  // AI-extraction shape: dates resolved (no wall-clock flag), gaps elsewhere
  const events = [{
    title: 'CHUNK Portland - SUMMER BLOW OUT!',
    startDate: new Date('2026-08-23T04:00:00.000Z'),
    endDate: new Date('2026-08-23T09:00:00.000Z'),
    bar: 'Nova PDX',
    address: '',
    location: '',
    city: '',
    timezone: '',
    cover: ''
  }];

  parser.applyWixServerDataEnrichment(events, { url: CHUNK_PAGE_URL, html: WIX_WARMUP_HTML }, PORTLAND_CITY_CONFIG);

  const event = events[0];
  assert.equal(event.location, '45.52281000000001, -122.6581342');
  assert.equal(event.timezone, 'America/Los_Angeles');
  assert.equal(event.cover, '$20.50-$30.75');
  assert.equal(event.address, '722 E Burnside St, Portland, OR 97214, USA');
  assert.equal(event.city, 'portland', 'the raw Wix city resolves through the configured city keys');
  assert.equal(event.bar, 'Nova PDX', 'existing values stay untouched');
});

test('applyWixServerDataEnrichment never overwrites non-empty fields', () => {
  const parser = createParser();
  const events = [{
    title: 'CHUNK Portland - SUMMER BLOW OUT!',
    startDate: new Date('2026-08-23T05:00:00.000Z'),
    endDate: new Date('2026-08-23T10:00:00.000Z'),
    location: '45.5, -122.6',
    timezone: 'America/New_York',
    cover: '$15',
    address: '123 Somewhere Else St',
    city: 'nyc'
  }];

  parser.applyWixServerDataEnrichment(events, { url: CHUNK_PAGE_URL, html: WIX_WARMUP_HTML }, PORTLAND_CITY_CONFIG);

  const event = events[0];
  assert.equal(event.location, '45.5, -122.6');
  assert.equal(event.timezone, 'America/New_York');
  assert.equal(event.cover, '$15');
  assert.equal(event.address, '123 Somewhere Else St');
  assert.equal(event.city, 'nyc');
  assert.equal(event.startDate.toISOString(), '2026-08-23T05:00:00.000Z', 'anchored dates are trusted data');
});

test('applyWixServerDataEnrichment replaces wall-clock dates with exact UTC instants and clears the flag', () => {
  const parser = createParser();
  // Wall-clock 9pm local stored as 9pm UTC by the timezone-less fallback
  const events = [{
    title: 'CHUNK Portland - SUMMER BLOW OUT!',
    startDate: new Date('2026-08-22T21:00:00.000Z'),
    endDate: new Date('2026-08-23T02:00:00.000Z'),
    _timezoneUnresolved: true
  }];

  parser.applyWixServerDataEnrichment(events, { url: CHUNK_PAGE_URL, html: WIX_WARMUP_HTML }, PORTLAND_CITY_CONFIG);

  const event = events[0];
  assert.equal(event.startDate.toISOString(), '2026-08-23T04:00:00.000Z');
  assert.equal(event.endDate.toISOString(), '2026-08-23T09:00:00.000Z');
  assert.equal(event._timezoneUnresolved, undefined, 'authoritative instants resolve the wall-clock gap');
});

test('applyWixServerDataEnrichment applies nothing when the slug and title both mismatch', () => {
  const parser = createParser();
  const events = [{
    title: 'A COMPLETELY DIFFERENT PARTY',
    startDate: new Date('2026-09-01T04:00:00.000Z'),
    endDate: new Date('2026-09-01T09:00:00.000Z'),
    location: '',
    cover: ''
  }];

  parser.applyWixServerDataEnrichment(
    events,
    { url: 'https://www.chunk-party.com/event-details/some-other-party', html: WIX_WARMUP_HTML },
    PORTLAND_CITY_CONFIG
  );

  assert.equal(events[0].location, '', 'an event-details URL naming a different slug must not be enriched');
  assert.equal(events[0].cover, '');
});

// ---------------------------------------------------------------------------
// Sticker-price covers: the warmup tickets[] array carries BASE prices
// ("45.00") while JSON-LD offers and the registration.ticketing summary are
// fee-inclusive totals ("46.13" = $45.00 + service fee). Verified live on the
// chunk-party.com Dore Alley page: sold-out tickets keep saleStatus 1 but get
// limitPerCheckout 0; purchasable ones have limitPerCheckout > 0.
// ---------------------------------------------------------------------------

const doreTicket = (name, amount, limitPerCheckout) => ({
  id: name, price: { amount, currency: 'USD', value: amount }, free: false,
  name, limitPerCheckout, orderIndex: 0, wixFeeConfig: { type: 2 }, saleStatus: 1,
  pricing: { fixedPrice: { amount, currency: 'USD', value: amount }, pricingType: 0 }
});

// Real Dore Alley shape: 25/30 tiers sold out, 45/60 tiers still purchasable
const DORE_TICKETS = [
  doreTicket("CHUNK DORE '26 Early Bird GA 1", '25.00', 0),
  doreTicket("CHUNK DORE '26 Tier 1 GA 1", '30.00', 0),
  doreTicket("CHUNK DORE '26 Tier 2 GA 1", '45.00', 1),
  doreTicket("CHUNK DORE '26 Tier 3 GA 1", '60.00', 50)
];

const DORE_PAGE_URL = 'https://www.chunk-party.com/event-details/chunk-dore-alley-saturday-july-25th';

const DORE_WARMUP_HTML = `
<html><head>
<script type="application/json" id="wix-warmup-data">${JSON.stringify({
  appsWarmupData: {
    'deadbeef-0000-4000-8000-000000000000': {
      EventsPageInitialState: {
        event: {
          event: {
            title: 'CHUNK DORE ALLEY - Saturday July 25th',
            slug: 'chunk-dore-alley-saturday-july-25th',
            scheduling: { config: { startDate: '2026-07-26T05:00:00.000Z', endDate: '2026-07-26T11:00:00.000Z', timeZoneId: 'America/Los_Angeles' } },
            registration: { ticketing: { lowestTicketPriceFormatted: '$25.63', highestTicketPriceFormatted: '$61.50', soldOut: false } }
          }
        },
        tickets: DORE_TICKETS
      }
    }
  }
})}</script>
</head><body>CHUNK DORE ALLEY - Saturday July 25th</body></html>`;

// The fee-inclusive offers the same page publishes in JSON-LD (real values)
const DORE_OFFERS = {
  '@type': 'AggregateOffer', highPrice: '61.50', lowPrice: '25.63',
  offerCount: '4', priceCurrency: 'USD',
  availability: 'https://schema.org/InStock',
  offers: [
    { '@type': 'offer', name: "CHUNK DORE '26 Early Bird GA 1", price: '25.63', priceCurrency: 'USD', availability: 'https://schema.org/SoldOut' },
    { '@type': 'offer', name: "CHUNK DORE '26 Tier 1 GA 1", price: '30.75', priceCurrency: 'USD', availability: 'https://schema.org/SoldOut' },
    { '@type': 'offer', name: "CHUNK DORE '26 Tier 2 GA 1", price: '46.13', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
    { '@type': 'offer', name: "CHUNK DORE '26 Tier 3 GA 1", price: '61.5', priceCurrency: 'USD', availability: 'https://schema.org/InStock' }
  ]
};

test('formatWixTicketPriceRange ranges over base prices of purchasable tiers only', () => {
  const parser = createParser();
  // 25/30 sold out (limitPerCheckout 0), 45/60 purchasable → walk-up range
  assert.equal(parser.formatWixTicketPriceRange(DORE_TICKETS), '$45-$60');
  // ALL tiers sold out → the full range across all tiers keeps a price
  const allSoldOut = DORE_TICKETS.map(ticket => ({ ...ticket, limitPerCheckout: 0 }));
  assert.equal(parser.formatWixTicketPriceRange(allSoldOut), '$25-$60');
  // A single purchasable tier collapses to one value
  assert.equal(parser.formatWixTicketPriceRange([DORE_TICKETS[0], DORE_TICKETS[2]]), '$45');
  // Real cents keep two decimals; whole dollars drop the ".00"
  assert.equal(parser.formatWixTicketPriceRange([doreTicket('GA', '45.50', 10)]), '$45.50');
  // An absent limitPerCheckout never marks a tier sold out
  const noLimit = doreTicket('GA', '45.00', 10);
  delete noLimit.limitPerCheckout;
  assert.equal(parser.formatWixTicketPriceRange([noLimit]), '$45');
  // price absent → pricing.fixedPrice fallback
  const fixedOnly = doreTicket('GA', '45.00', 10);
  delete fixedOnly.price;
  assert.equal(parser.formatWixTicketPriceRange([fixedOnly]), '$45');
  // Non-USD renders as amount + space + code
  const eur = doreTicket('GA', '45.00', 10);
  eur.price.currency = 'EUR';
  assert.equal(parser.formatWixTicketPriceRange([eur]), '45 EUR');
  // No priced tickets → null: never "$0", never a throw
  assert.equal(parser.formatWixTicketPriceRange([]), null);
  assert.equal(parser.formatWixTicketPriceRange(null), null);
  assert.equal(parser.formatWixTicketPriceRange(undefined), null);
  assert.equal(parser.formatWixTicketPriceRange([{ free: true, name: 'RSVP', limitPerCheckout: 10 }]), null);
  assert.equal(parser.formatWixTicketPriceRange([doreTicket('GA', '0.00', 10)]), null);
  assert.equal(parser.formatWixTicketPriceRange(['garbage', null, 42]), null);
});

test('a JSON-LD-offers cover is upgraded to warmup base sticker prices and the flag is consumed', () => {
  const parser = createParser();
  const event = parser.buildEventFromJsonLdNode({
    name: 'CHUNK DORE ALLEY - Saturday July 25th',
    startDate: '2026-07-25T22:00:00-07:00',
    offers: DORE_OFFERS
  }, DORE_PAGE_URL);
  assert.equal(event.cover, '$46.13-$61.50', 'JSON-LD can only see fee-inclusive totals');
  assert.equal(event._coverFromJsonLdOffers, true, 'the offers-sourced cover is flagged upgradeable');

  const logs = [];
  const realLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  try {
    parser.applyWixServerDataEnrichment([event], { url: DORE_PAGE_URL, html: DORE_WARMUP_HTML }, {});
  } finally {
    console.log = realLog;
  }
  assert.equal(event.cover, '$45-$60', 'base prices of purchasable tiers replace fee totals');
  assert.equal(event._coverFromJsonLdOffers, undefined, 'the scratch flag is consumed by the upgrade');
  assert.ok(
    logs.some(line => line.includes('filled=[') && line.includes('upgraded=[cover]')),
    'the enrichment summary reports the upgrade alongside filled fields'
  );
});

test('an OCR/AI-extracted cover (no flag) is never overridden by warmup ticket prices', () => {
  const parser = createParser();
  const events = [{
    title: 'CHUNK DORE ALLEY - Saturday July 25th',
    startDate: new Date('2026-07-26T05:00:00.000Z'),
    cover: '$40 at the door'
  }];
  parser.applyWixServerDataEnrichment(events, { url: DORE_PAGE_URL, html: DORE_WARMUP_HTML }, {});
  assert.equal(events[0].cover, '$40 at the door', 'independent OCR/AI evidence always wins');
});

test('an empty cover is still filled from warmup tickets (fill-only-empty path)', () => {
  const parser = createParser();
  const events = [{
    title: 'CHUNK DORE ALLEY - Saturday July 25th',
    startDate: new Date('2026-07-26T05:00:00.000Z'),
    cover: ''
  }];
  parser.applyWixServerDataEnrichment(events, { url: DORE_PAGE_URL, html: DORE_WARMUP_HTML }, {});
  assert.equal(events[0].cover, '$45-$60');
});

test('formatJsonLdOffersCover keeps the honest fee-inclusive range for non-Wix pages', () => {
  const parser = createParser();
  // Dore-shaped offers: unchanged fallback when no warmup data exists
  assert.equal(parser.formatJsonLdOffersCover(DORE_OFFERS), '$46.13-$61.50');
});

test('parseEvents enriches the JSON-LD fast-path result from Wix server data without running OCR or AI', async () => {
  const parser = createParser();
  parser.extractOcrFromAllImages = async () => {
    throw new Error('OCR should not run when JSON-LD covers the event');
  };
  parser.core.callAiGenerate = async () => {
    throw new Error('AI should not be called when JSON-LD covers the event');
  };
  // Complete JSON-LD (title + start + venue) with exact instants that differ
  // from the warmup instants — enrichment must not touch them.
  const html = `
    <html><head>
      <script type="application/ld+json">
        {"@context":"http://schema.org","@type":"MusicEvent",
         "name":"CHUNK Portland - SUMMER BLOW OUT!",
         "startDate":"2026-08-22T21:00:00-07:00","endDate":"2026-08-23T02:00:00-07:00",
         "location":{"@type":"Place","name":"Nova PDX",
           "address":{"@type":"PostalAddress","streetAddress":"722 E Burnside St","addressLocality":"Portland","addressRegion":"OR"}}}
      </script>
    ${WIX_WARMUP_HTML.replace('<html><head>', '')}`;

  const result = await parser.parseEvents(
    { url: CHUNK_PAGE_URL, html },
    {},
    PORTLAND_CITY_CONFIG,
    'event-page',
    null
  );

  assert.equal(result.events.length, 1);
  const event = result.events[0];
  assert.equal(event.bar, 'Nova PDX');
  // Enrichment filled the JSON-LD gaps...
  assert.equal(event.location, '45.52281000000001, -122.6581342');
  assert.equal(event.cover, '$20.50-$30.75');
  // ...but never overwrote what JSON-LD provided
  assert.equal(event.startDate.toISOString(), '2026-08-23T04:00:00.000Z');
  assert.equal(event.address, '722 E Burnside St, Portland, OR');
});

test('warmup presence never skips extraction steps: OCR and AI still run when JSON-LD is incomplete', async () => {
  const parser = createParser();
  let ocrRan = false;
  let aiExtractionRan = false;
  parser.extractOcrFromAllImages = async () => {
    ocrRan = true;
    return [];
  };
  parser.extractEventsFromMultiEventPage = async () => {
    aiExtractionRan = true;
    return [];
  };

  // Multi-event page whose single JSON-LD node does NOT take the fast path —
  // the warmup blob is present but must not short-circuit anything.
  const result = await parser.parseEvents(
    { url: CHUNK_PAGE_URL, html: `${SICKENING_JSONLD_HTML}${WIX_WARMUP_HTML}` },
    {},
    PORTLAND_CITY_CONFIG,
    'multi-event-page',
    null
  );

  assert.equal(ocrRan, true, 'OCR must still run with warmup data present');
  assert.equal(aiExtractionRan, true, 'AI extraction must still run with warmup data present');
  assert.equal(result.events.length, 0);
});

// ---------------------------------------------------------------------------
// JSON-LD offers → cover + fast-path coverage/gap-fill (chunk-party.com event
// pages: the JSON-LD carries a complete offers block and the body shows
// prices, but fast-path events never got a cover because the AI never ran)
// ---------------------------------------------------------------------------

const CHUNK_OFFERS = {
  '@type': 'AggregateOffer', highPrice: '30.75', lowPrice: '20.50',
  offerCount: '3', priceCurrency: 'USD',
  availability: 'https://schema.org/InStock',
  url: 'https://tix.example/chunk-pdx',
  offers: [
    { '@type': 'offer', name: 'Early Bird GA', price: '20.5', priceCurrency: 'USD', availability: 'https://schema.org/SoldOut', url: 'https://tix.example/chunk-pdx' },
    { '@type': 'offer', name: 'Tier 1 GA', price: '25.63', priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: 'https://tix.example/chunk-pdx' },
    { '@type': 'offer', name: 'Tier 2 GA', price: '30.75', priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: 'https://tix.example/chunk-pdx' }
  ]
};

const CHUNK_JSONLD_HTML = `
  <html><head>
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Event",
       "name":"CHUNK Portland Summer Blow Out",
       "startDate":"2026-08-22T21:00:00-07:00",
       "endDate":"2026-08-23T02:00:00-07:00",
       "description":"CHUNK returns to Portland.",
       "image":"https://static.example/chunk-pdx.jpg",
       "location":{"@type":"Place","name":"Bossanova Ballroom",
         "address":{"@type":"PostalAddress","streetAddress":"722 E Burnside St","addressLocality":"Portland","addressRegion":"OR"}},
       "offers":${JSON.stringify(CHUNK_OFFERS)}}
    </script>
  </head><body>CHUNK Portland Summer Blow Out at Bossanova Ballroom. Tickets from $20.50 to $30.75.</body></html>`;

test('formatJsonLdOffersCover maps schema.org offer shapes to display prices (Scriptable-safe)', () => {
  global.EventSchema = EventSchema; // earlier tests leak a mocked schema
  const parser = createParser();
  const RealURL = global.URL;
  global.URL = undefined;
  try {
    // AggregateOffer with tiers: the sold-out early bird is excluded from the range
    assert.equal(parser.formatJsonLdOffersCover(CHUNK_OFFERS), '$25.63-$30.75');

    // Every tier sold out → all tier prices back the range
    const allSoldOut = {
      ...CHUNK_OFFERS,
      offers: CHUNK_OFFERS.offers.map(offer => ({ ...offer, availability: 'https://schema.org/SoldOut' }))
    };
    assert.equal(parser.formatJsonLdOffersCover(allSoldOut), '$20.50-$30.75');

    // Tiers without usable prices → AggregateOffer lowPrice/highPrice fallback
    const unpricedTiers = { ...CHUNK_OFFERS, offers: [{ '@type': 'offer', name: 'GA' }] };
    assert.equal(parser.formatJsonLdOffersCover(unpricedTiers), '$20.50-$30.75');
    const bareAggregate = { '@type': 'AggregateOffer', lowPrice: '20.50', highPrice: '30.75' };
    assert.equal(parser.formatJsonLdOffersCover(bareAggregate), '$20.50-$30.75');

    // Single offer object and plain offer arrays
    assert.equal(parser.formatJsonLdOffersCover({ price: '25.63', priceCurrency: 'USD' }), '$25.63');
    assert.equal(parser.formatJsonLdOffersCover([{ price: '20.5' }, { price: '30.75' }]), '$20.50-$30.75');

    // Whole-dollar values render without ".00"; cents always get two decimals
    assert.equal(parser.formatJsonLdOffersCover({ price: '20' }), '$20');
    assert.equal(parser.formatJsonLdOffersCover({ price: '20.5' }), '$20.50');

    // Non-USD currencies render as amount + space + code
    assert.equal(parser.formatJsonLdOffersCover({ price: '25.63', priceCurrency: 'EUR' }), '25.63 EUR');
    assert.equal(
      parser.formatJsonLdOffersCover([{ price: '20.5', priceCurrency: 'EUR' }, { price: '30.75', priceCurrency: 'EUR' }]),
      '20.50-30.75 EUR'
    );

    // Zero/negative/unparseable prices and absent offers yield no cover
    assert.equal(parser.formatJsonLdOffersCover({ price: '0' }), '');
    assert.equal(parser.formatJsonLdOffersCover({ price: '-5' }), '');
    assert.equal(parser.formatJsonLdOffersCover({ price: 'TBD' }), '');
    assert.equal(parser.formatJsonLdOffersCover(undefined), '');
    assert.equal(parser.formatJsonLdOffersCover(null), '');
    assert.equal(parser.formatJsonLdOffersCover('not-an-offer'), '');
    assert.equal(parser.formatJsonLdOffersCover([]), '');
  } finally {
    global.URL = RealURL;
  }
});

test('the JSON-LD fast path sets cover from offers and needs no gap-fill AI request', async () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  let aiCalls = 0;
  parser.core.callAiGenerate = async () => {
    aiCalls++;
    return '{}';
  };

  const result = await parser.parseEvents(
    { url: 'https://www.chunk-party.example/event-details/chunk-portland-summer-blow-out', html: CHUNK_JSONLD_HTML },
    {},
    null,
    'event-page',
    null
  );

  assert.equal(result.events.length, 1, 'the structured-data fast path must be used');
  assert.equal(result.events[0].title, 'CHUNK Portland Summer Blow Out');
  assert.equal(result.events[0].cover, '$25.63-$30.75', 'in-stock tier range from the offers block');
  assert.equal(aiCalls, 0, 'offers already provided cover, so the page price signal must not trigger gap-fill');

  // The offers block without nested tiers still maps through extractEventsFromJsonLd
  const events = parser.extractEventsFromJsonLd(CHUNK_JSONLD_HTML, 'https://www.chunk-party.example/e/x');
  assert.equal(events.length, 1);
  assert.equal(events[0].cover, '$25.63-$30.75');
  assert.equal(events[0].ticketUrl, 'https://tix.example/chunk-pdx', 'offers.url → ticketUrl is unchanged');
});

const GAPFILL_JSONLD_HTML = `
  <html><head>
    <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Event",
       "name":"UNDERBEAR Lounge",
       "startDate":"2026-08-22T21:00:00-04:00",
       "location":{"@type":"Place","name":"Rockbar NYC",
         "address":{"@type":"PostalAddress","streetAddress":"185 Christopher St","addressLocality":"New York","addressRegion":"NY"}}}
    </script>
  </head><body>
    <p>UNDERBEAR Lounge at Rockbar NYC.</p>
    <p>Party with the bears all night long downstairs.</p>
    <p>$15 cover at the door.</p>
  </body></html>`;

test('JSON-LD gap-fill pays exactly one restricted AI request when the page shows a price signal', async () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  const aiCalls = [];
  parser.core.callAiGenerate = async (config, prompt, label) => {
    aiCalls.push(label);
    return JSON.stringify({
      cover: { value: '$15', evidence: '$15 cover at the door', confidence: 95 },
      // A field JSON-LD already provided must never win, even if the model returns it
      title: { value: 'AI Title That Must Not Win', evidence: 'UNDERBEAR Lounge', confidence: 95 }
    });
  };
  const requestedFieldLists = [];
  const originalExtract = parser.extractFieldsAcrossSnippets.bind(parser);
  parser.extractFieldsAcrossSnippets = (htmlData, aiConfig, cityConfig, parserConfig, fields, ...rest) => {
    requestedFieldLists.push(fields.slice());
    return originalExtract(htmlData, aiConfig, cityConfig, parserConfig, fields, ...rest);
  };

  const result = await parser.parseEvents(
    { url: 'https://underbear.example/party', html: GAPFILL_JSONLD_HTML },
    {},
    null,
    'event-page',
    null
  );

  assert.equal(result.events.length, 1, 'the fast path must still return the JSON-LD event');
  assert.deepEqual(aiCalls, ['extraction'], 'exactly one AI request, no context-prep/repair round-trips');
  assert.deepEqual(requestedFieldLists, [['cover']], 'the request must be restricted to the missing signal-matched field');
  assert.equal(result.events[0].cover, '$15', 'the validated AI cover must fill the empty field');
  assert.equal(result.events[0].title, 'UNDERBEAR Lounge', 'a JSON-LD-provided value must never be overwritten');
  assert.equal(result.events[0].bar, 'Rockbar NYC');
});

test('JSON-LD gap-fill makes no AI request when no missing field has a page signal', async () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  let aiCalls = 0;
  parser.core.callAiGenerate = async () => {
    aiCalls++;
    return '{}';
  };

  const html = GAPFILL_JSONLD_HTML.replace('$15 cover at the door.', 'Free entry before ten.');
  const result = await parser.parseEvents(
    { url: 'https://underbear.example/party', html },
    {},
    null,
    'event-page',
    null
  );

  assert.equal(result.events.length, 1);
  assert.equal(aiCalls, 0, 'no price signal in the page text → no AI request at all');
  assert.equal(result.events[0].cover, undefined);
});

test('JSON-LD gap-fill errors degrade to returning the JSON-LD events unchanged', async () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  parser.core.callAiGenerate = async () => {
    throw new Error('AI endpoint down');
  };

  const result = await parser.parseEvents(
    { url: 'https://underbear.example/party', html: GAPFILL_JSONLD_HTML },
    {},
    null,
    'event-page',
    null
  );

  assert.equal(result.events.length, 1, 'a gap-fill failure must never fail the page');
  assert.equal(result.events[0].title, 'UNDERBEAR Lounge');
  assert.equal(result.events[0].bar, 'Rockbar NYC');
  assert.equal(result.events[0].cover, undefined, 'the event is returned exactly as JSON-LD built it');
});

test('the fast path logs a JSON-LD coverage line and a gap-fill outcome line', async () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  parser.core.callAiGenerate = async () => JSON.stringify({
    cover: { value: '$15', evidence: '$15 cover at the door', confidence: 95 }
  });

  const lines = [];
  const realLog = console.log;
  console.log = (...args) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    await parser.parseEvents(
      { url: 'https://underbear.example/party', html: GAPFILL_JSONLD_HTML },
      {},
      null,
      'event-page',
      null
    );
  } finally {
    console.log = realLog;
  }

  const coverageLine = lines.find(line => line.includes('JSON-LD coverage for https://underbear.example/party'));
  assert.ok(coverageLine, 'a coverage line must always be logged on the fast path');
  assert.match(coverageLine, /provided=\[[^\]]*\btitle\b/);
  assert.match(coverageLine, /provided=\[[^\]]*\bbar\b/);
  assert.match(coverageLine, /missing=\[[^\]]*\bcover\b/);

  const gapFillLine = lines.find(line => line.includes('JSON-LD gap-fill for https://underbear.example/party'));
  assert.ok(gapFillLine, 'the gap-fill outcome must be logged');
  assert.match(gapFillLine, /requested=\[cover\]/);
  assert.match(gapFillLine, /filled=\[cover\]/);
});

// ---------------------------------------------------------------------------
// Cache retention: hits refresh a lastUsedAt marker, rate-limited to 7 days,
// so the adapter's end-of-run prune can work from file mtime alone
// ---------------------------------------------------------------------------

test('OCR cache hits stamp lastUsedAt at most once per 7 days', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-touch-test-'));

  const parser = new AiWebParser({ normalizeUrl, ocrCacheDir: cacheDir });
  parser.core = new SharedCore({}, { eventSchema: EventSchema });

  const ocrConfig = { cacheEnabled: true, model: 'test-model', prompt: 'ocr prompt' };
  const imageUrl = 'https://cdn.example/recurring-flyer.jpg';
  const resultText = JSON.stringify({ text: 'BEAR NIGHT 10PM', imageClassification: 'event-flyer' });
  const cachePath = await parser.writeCachedOcrResult(imageUrl, ocrConfig, resultText);
  assert.ok(cachePath, 'cache write should return the entry path');
  assert.equal(JSON.parse(fs.readFileSync(cachePath, 'utf8')).lastUsedAt, undefined);

  // First hit on a legacy entry (no lastUsedAt): rewritten with a day-precision stamp
  const today = new Date().toISOString().slice(0, 10);
  const first = await parser.readCachedOcrResult(imageUrl, ocrConfig);
  assert.equal(first.cached, true);
  const afterFirst = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert.equal(afterFirst.lastUsedAt, today);
  assert.equal(afterFirst.response.text, resultText, 'touching must preserve the cached payload');

  // Second hit the same day: rate-limited, NO rewrite (sentinel survives)
  afterFirst._sentinel = 'untouched';
  fs.writeFileSync(cachePath, JSON.stringify(afterFirst, null, 2), 'utf8');
  const second = await parser.readCachedOcrResult(imageUrl, ocrConfig);
  assert.equal(second.cached, true);
  assert.equal(
    JSON.parse(fs.readFileSync(cachePath, 'utf8'))._sentinel,
    'untouched',
    'a same-day hit must not rewrite the entry'
  );

  // A marker older than the 7-day rate limit is refreshed
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  afterFirst.lastUsedAt = eightDaysAgo;
  fs.writeFileSync(cachePath, JSON.stringify(afterFirst, null, 2), 'utf8');
  await parser.readCachedOcrResult(imageUrl, ocrConfig);
  assert.equal(JSON.parse(fs.readFileSync(cachePath, 'utf8')).lastUsedAt, today);

  // Negative-cached failures are valid hits too — touched the same way
  const failureUrl = 'https://cdn.example/huge-banner.webp';
  const failurePath = await parser.writeCachedOcrResult(
    failureUrl,
    ocrConfig,
    JSON.stringify({ failureKind: 'context-overflow' })
  );
  const failureHit = await parser.readCachedOcrResult(failureUrl, ocrConfig);
  assert.equal(failureHit.failureKind, 'context-overflow');
  assert.equal(JSON.parse(fs.readFileSync(failurePath, 'utf8')).lastUsedAt, today);

  fs.rmSync(cacheDir, { recursive: true, force: true });
});

test('classification cache hits refresh lastUsedAt through the same touch helper', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cls-touch-test-'));

  const parser = new AiWebParser({ normalizeUrl, classificationCacheDir: cacheDir });
  parser.core = new SharedCore({}, { eventSchema: EventSchema });

  const url = 'https://bearracuda.example/events';
  const signature = { model: 'test-model', summaryHash: 'abc' };
  const written = await parser.writeCachedAiClassification(url, signature, { classification: 'multi-event-page' });
  assert.ok(written);

  const outcome = await parser.readCachedAiClassification(url, signature);
  assert.equal(outcome.classification, 'multi-event-page');
  const payload = JSON.parse(fs.readFileSync(written, 'utf8'));
  assert.equal(payload.lastUsedAt, new Date().toISOString().slice(0, 10));

  fs.rmSync(cacheDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Persistent AI-response cache: raw response text keyed by request signature
// (provider+model+prompt+options), filed under the pass label
// ---------------------------------------------------------------------------

function buildAiResponseCacheConfig(overrides = {}) {
  return {
    cacheEnabled: true,
    provider: 'openai',
    endpoint: 'http://rybook.example:8000/v1/chat/completions',
    model: 'test-model',
    numCtx: 2048,
    numPredict: 2000,
    temperature: 0,
    think: false,
    keepAlive: '5m',
    openai: { responseFormat: 'json_object' },
    ...overrides
  };
}

test('AI response cache round-trips raw text and misses when the request signature changes', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-response-cache-test-'));

  const parser = new AiWebParser({ normalizeUrl, aiResponseCacheDir: cacheDir });
  parser.core = new SharedCore({}, { eventSchema: EventSchema });

  const aiConfig = buildAiResponseCacheConfig();
  const prompt = 'Extract the event from this page text: BEAR NIGHT at The Eagle';
  const responseText = '{"title": "BEAR NIGHT", "bar": "The Eagle"}';

  const cachePath = await parser.writeCachedAiResponse(aiConfig, prompt, 'extraction', responseText);
  assert.ok(cachePath, 'cache write should return the entry path');
  assert.ok(cachePath.includes(`${path.sep}extraction${path.sep}`), 'entries are filed under the pass label');
  assert.equal(parser.aiResponseCacheStats.writes, 1);

  const payload = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert.equal(payload.cacheKeyVersion, 1);
  assert.equal(payload.passLabel, 'extraction');
  assert.equal(payload.request.prompt, prompt);
  assert.equal(payload.request.model, 'test-model');
  assert.ok(payload.request.signatureHash, 'payload records the signature hash');
  assert.equal(payload.response.text, responseText);

  const hit = await parser.readCachedAiResponse(aiConfig, prompt, 'extraction');
  assert.equal(hit, responseText);
  assert.equal(parser.aiResponseCacheStats.hits, 1);

  // Signature sensitivity: model, prompt, temperature, and numPredict each
  // produce a different cache path, so a stale entry can never be returned
  const variants = [
    [buildAiResponseCacheConfig({ model: 'other-model' }), prompt],
    [aiConfig, `${prompt} — different page`],
    [buildAiResponseCacheConfig({ temperature: 0.5 }), prompt],
    [buildAiResponseCacheConfig({ numPredict: 1000 }), prompt]
  ];
  for (const [variantConfig, variantPrompt] of variants) {
    assert.equal(await parser.readCachedAiResponse(variantConfig, variantPrompt, 'extraction'), null);
  }
  assert.equal(parser.aiResponseCacheStats.misses, variants.length);

  // Endpoint is deliberately NOT part of the signature — re-homing the model hits
  const rehomed = buildAiResponseCacheConfig({ endpoint: 'http://desktop.example:8000/v1/chat/completions' });
  assert.equal(await parser.readCachedAiResponse(rehomed, prompt, 'extraction'), responseText);

  fs.rmSync(cacheDir, { recursive: true, force: true });
});

test('AI response cache is inert when resolved cacheEnabled is false', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-response-cache-off-test-'));

  const parser = new AiWebParser({ normalizeUrl, aiResponseCacheDir: cacheDir });
  parser.core = new SharedCore({}, { eventSchema: EventSchema });

  // ai.cache: false resolves to cacheEnabled: false and disables both directions
  const aiConfig = parser.core.resolveAiConfig({ cache: false });
  assert.equal(aiConfig.cacheEnabled, false);

  const written = await parser.writeCachedAiResponse(aiConfig, 'prompt', 'extraction', '{"title": "x"}');
  assert.equal(written, null);
  assert.equal(await parser.readCachedAiResponse(aiConfig, 'prompt', 'extraction'), null);
  assert.deepEqual(fs.readdirSync(cacheDir), [], 'no files may be created while disabled');
  assert.deepEqual(parser.aiResponseCacheStats, { hits: 0, misses: 0, writes: 0 });

  fs.rmSync(cacheDir, { recursive: true, force: true });
});

test('AI response cache hits refresh lastUsedAt at most once per 7 days', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-response-touch-test-'));

  const parser = new AiWebParser({ normalizeUrl, aiResponseCacheDir: cacheDir });
  parser.core = new SharedCore({}, { eventSchema: EventSchema });

  const aiConfig = buildAiResponseCacheConfig();
  const prompt = 'Extract the recurring event';
  const responseText = '{"title": "RECURRING BEAR NIGHT"}';
  const today = new Date().toISOString().slice(0, 10);

  const cachePath = await parser.writeCachedAiResponse(aiConfig, prompt, 'extraction', responseText);
  assert.equal(JSON.parse(fs.readFileSync(cachePath, 'utf8')).lastUsedAt, today);

  // A fresh (same-day) marker is rate-limited: NO rewrite on hit (sentinel survives)
  const sameDay = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  sameDay._sentinel = 'untouched';
  fs.writeFileSync(cachePath, JSON.stringify(sameDay, null, 2), 'utf8');
  assert.equal(await parser.readCachedAiResponse(aiConfig, prompt, 'extraction'), responseText);
  assert.equal(
    JSON.parse(fs.readFileSync(cachePath, 'utf8'))._sentinel,
    'untouched',
    'a same-day hit must not rewrite the entry'
  );

  // A marker older than the 7-day rate limit is refreshed on hit
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  sameDay.lastUsedAt = eightDaysAgo;
  fs.writeFileSync(cachePath, JSON.stringify(sameDay, null, 2), 'utf8');
  assert.equal(await parser.readCachedAiResponse(aiConfig, prompt, 'extraction'), responseText);
  const refreshed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert.equal(refreshed.lastUsedAt, today);
  assert.equal(refreshed.response.text, responseText, 'touching must preserve the cached payload');

  fs.rmSync(cacheDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Built-in generic blocked patterns (segment-anchored, accuracy first)
// ---------------------------------------------------------------------------

test('validateEventUrl blocks generic non-event paths built-in, anchored to whole path segments', () => {
  const parser = createParser();
  const sourceUrl = 'https://x.example/events';
  const blocked = [
    'https://x.example/shop',
    'https://x.example/shop/tees',
    'https://x.example/store',
    'https://x.example/merch',
    'https://x.example/cart',
    'https://x.example/checkout',
    'https://x.example/contact',
    'https://x.example/about',
    'https://x.example/faq',
    'https://x.example/account',
    'https://x.example/signin',
    'https://x.example/signup',
    'https://x.example/_api/v1/site',
    'https://bearracuda.example/?p=8724'   // WordPress shortlink
  ];
  for (const url of blocked) {
    const result = parser.validateEventUrl(url, sourceUrl, {});
    assert.equal(result.valid, false, `${url} should be blocked`);
    assert.match(result.reason, /^blocked-pattern:/, `${url} → ${result.reason}`);
  }

  // Event slugs containing overlapping WORDS survive — anchoring is per path segment
  const allowed = [
    'https://x.example/events/all-about-bears',
    'https://x.example/shop-party',
    'https://x.example/events/checkout-these-bears',
    'https://x.example/contact-high-dance-party',
    'https://x.example/events/party?page=2'
  ];
  for (const url of allowed) {
    const result = parser.validateEventUrl(url, sourceUrl, {});
    assert.equal(result.valid, true, `${url} should pass but was rejected: ${result.reason}`);
  }
});

// ---------------------------------------------------------------------------
// discoveryOnly onboarding harvest (social links + JSON-LD organizer)
// ---------------------------------------------------------------------------

const HARVEST_HTML = `
  <html>
    <head>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Twisted Bear: Dallas",
          "startDate": "2026-08-15T21:00:00-05:00",
          "organizer": {
            "@type": "Organization",
            "name": "Twisted Bear Events",
            "url": "https://twistedbear.example"
          }
        }
      </script>
    </head>
    <body>
      <a href="https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fx.example">Share</a>
      <a href="https://www.instagram.com/">Instagram home</a>
      <a href="https://www.instagram.com/twistedbearparty">Follow us</a>
      <a href="https://www.instagram.com/other.account">Second profile (first wins)</a>
      <a href="https://www.facebook.com/login/?next=x">Log in</a>
      <a href="https://www.facebook.com/twistedglobal/">Facebook page</a>
      <a href="https://x.example/e/party-tickets">Tickets</a>
    </body>
  </html>
`;

test('discoveryOnly harvests the first profile-like social link per host and the JSON-LD organizer', async () => {
  const parser = createParser();
  const result = await parser.parseEvents(
    { html: HARVEST_HTML, url: 'https://x.example/events' },
    { discoveryOnly: true },
    null,
    'event-page',
    null
  );

  assert.deepEqual(result.discoveredSocialLinks, {
    instagram: 'https://www.instagram.com/twistedbearparty',
    facebook: 'https://www.facebook.com/twistedglobal/'
  }, 'sharer/login/root links are excluded; first profile-like link per host wins');
  assert.deepEqual(result.discoveredOrganizer, {
    name: 'Twisted Bear Events',
    url: 'https://twistedbear.example/'
  });
  assert.deepEqual(result.events, [], 'discoveryOnly extracts no events');
});

test('social/organizer harvest is inert outside discoveryOnly mode', async () => {
  const parser = createParser();
  // link-aggregator classification takes the same no-AI return path as discovery,
  // so this exercises a normal (non-discovery) run without any network use.
  const result = await parser.parseEvents(
    { html: HARVEST_HTML, url: 'https://x.example/events' },
    {},
    null,
    'link-aggregator',
    null
  );
  assert.equal(result.discoveredSocialLinks, null);
  assert.equal(result.discoveredOrganizer, null);
});

test('extractAdditionalUrls tags uniqueValidCount (pre-budget) non-enumerably for the dead-end detector', () => {
  const parser = createParser();
  const html = `
    <a href="https://x.example/e/party-one">One</a>
    <a href="https://x.example/e/party-two">Two</a>
    <a href="https://x.example/e/party-three">Three</a>
  `;
  const links = parser.extractAdditionalUrls(html, 'https://x.example/events', { maxAdditionalUrls: 0 });
  assert.equal(links.length, 0, 'budget of 0 returns no links');
  assert.equal(links.uniqueValidCount, 3, 'but the pre-budget valid count is preserved');
  assert.ok(!Object.keys(links).includes('uniqueValidCount'), 'tag is non-enumerable');
});

test('getImageSizeFromUrl and OCR consolidation work without URLSearchParams (iOS JavaScriptCore)', () => {
  const parser = createParser();
  // Scriptable's JavaScriptCore has no URLSearchParams — this exact gap crashed the
  // Decadence page ("Failed to parse AI event: ReferenceError: Can't find variable:
  // URLSearchParams" from consolidateDuplicateOcrResults → getImageSizeFromUrl).
  const original = global.URLSearchParams;
  delete global.URLSearchParams;
  try {
    const large = parser.getImageSizeFromUrl('https://cdn.example.com/img.jpg?w=1920&h=1080');
    const small = parser.getImageSizeFromUrl('https://cdn.example.com/img.jpg?w=100&h=100');
    assert.ok(large > small, 'width/height params still rank images');
    assert.ok(parser.getImageSizeFromUrl('https://cdn.example.com/img.jpg?size=large') >= 5000, 'named size params still score');

    const consolidated = parser.consolidateDuplicateOcrResults([
      { url: 'https://bearracuda.com/wp-content/uploads/2026/03/igdecad-2.jpg', text: 'DECADENCE NEW ORLEANS SAT AUG 29' },
      { url: 'https://bearracuda.com/wp-content/uploads/2026/03/igdecad-2-768x1187.jpg', text: 'DECADENCE NEW ORLEANS SAT AUG 29' }
    ]);
    assert.equal(consolidated.length, 1, 'duplicate size variants consolidate without throwing');
  } finally {
    global.URLSearchParams = original;
  }
});

// ---------------------------------------------------------------------------
// Segment listing-title hint: the page's own listing title anchors "title" so
// stylized flyer OCR (taglines, DJ names) can't displace it.
// ---------------------------------------------------------------------------

test('segment extraction prompt carries SEGMENT_LISTING_TITLE and the title rule when derivable', () => {
  const parser = createParser();
  const segment = {
    lines: ['PERVERT', 'Aug 7, 2026 10:00 PM', 'DJs Villa Senor and Dee Jay Energy'],
    html: ''
  };
  const htmlData = parser.buildMultiEventSegmentHtmlData(
    { html: '', url: 'https://venue.example/calendar' }, segment, 0, 3, []
  );
  assert.equal(htmlData.segmentListingTitle, 'PERVERT', 'first non-date page-text line is the listing title');

  // Both the extraction prompt and the confidence-retry prompt (the alternate
  // variant) must carry the hint and the rule.
  for (const variant of ['default', 'alternate']) {
    const prompt = parser.buildExtractionPrompt(htmlData, {}, null, {}, ['title'], 'SNIPPET', variant, { ocr: true, segment: true });
    assert.ok(
      prompt.includes('SEGMENT_LISTING_TITLE (the page\'s own listing title for this event): "PERVERT"'),
      `${variant} prompt carries the listing title`
    );
    assert.ok(
      prompt.includes('- For "title", prefer SEGMENT_LISTING_TITLE or a fuller variant of the same name from the flyer; flyer text that does not contain it (taglines, DJ names, stylized graphics text) is NOT the title.'),
      `${variant} prompt carries the title rule`
    );
  }
});

test('segment extraction prompt is unchanged when no listing title can be derived', () => {
  const parser = createParser();
  const segment = {
    lines: ['Aug 7, 2026 10:00 PM', 'https://venue.example/tickets'],
    html: ''
  };
  const htmlData = parser.buildMultiEventSegmentHtmlData(
    { html: '', url: 'https://venue.example/calendar' }, segment, 0, 3, []
  );
  assert.equal(htmlData.segmentListingTitle, '', 'date/URL-only segments derive no listing title');

  const prompt = parser.buildExtractionPrompt(htmlData, {}, null, {}, ['title'], 'SNIPPET', 'default', { ocr: true, segment: true });
  assert.ok(!prompt.includes('SEGMENT_LISTING_TITLE'), 'no hint line without a derived title');
  assert.ok(!prompt.includes('is NOT the title'), 'no rule line without a derived title');
});

test('deriveSegmentListingTitle skips marker, time-only, and date lines; long prose derives nothing', () => {
  const parser = createParser();
  assert.equal(parser.deriveSegmentListingTitle({
    lines: ['SEGMENT_IMAGE_URL: https://cdn.example/flyer.jpg', '10:00 PM', 'July 25, 2026', 'BEAR NIGHT']
  }), 'BEAR NIGHT');
  assert.equal(parser.deriveSegmentListingTitle({ lines: [] }), '');
  assert.equal(parser.deriveSegmentListingTitle(null), '');
  // A long prose first line is a description, not a title — derive nothing
  assert.equal(parser.deriveSegmentListingTitle({ lines: ['x'.repeat(200), 'BEAR NIGHT'] }), '');
});

// ---------------------------------------------------------------------------
// Name+date on ONE listing line. Run 20260801-170254: chunk-party.com prints
// "CHUNK Portland - 5/23 Sat, May 23" as a single line, so the whole line was
// skipped as a date line and the NEXT line — the venue "Nova PDX" — became the
// page's "own" listing title. The prompt hands that to the AI as the title to
// prefer, which is how a Portland event ended up named after a bar.
// ---------------------------------------------------------------------------
test('deriveSegmentListingTitle recovers the name span from a name+date listing line', () => {
  const parser = createParser();

  // The regression: the venue on the following line must NOT win.
  assert.equal(parser.deriveSegmentListingTitle({
    lines: ['CHUNK Portland - 5/23 Sat, May 23', 'Nova PDX', 'Details']
  }), 'CHUNK Portland', 'name span before the date, not the venue line below');

  assert.equal(parser.deriveSegmentListingTitle({
    lines: ['CHUNK Portland - SUMMER BLOW OUT! Sat, Aug 22', 'Nova PDX']
  }), 'CHUNK Portland - SUMMER BLOW OUT!');

  // Name first, venue AFTER the date — the prefix is the name, never the suffix.
  assert.equal(parser.deriveSegmentListingTitle({
    lines: ['BOATMINCE Sun, Aug 30 Westminster Pier London']
  }), 'BOATMINCE', 'text after the date is the venue, not the name');

  assert.equal(parser.deriveSegmentListingTitle({
    lines: ['BEEFMINCE x Bear Brum 2026 Sat, Sep 26 Eden Birmingham']
  }), 'BEEFMINCE x Bear Brum 2026');
});

test('a derived listing title is always a contiguous span of its source line', () => {
  const parser = createParser();
  // The extraction gate drops any field not verbatim in the source, so a
  // re-glued hint ("CHUNK Portland Bear Night") would cost the title entirely.
  const lines = [
    'CHUNK Portland - 5/23 Sat, May 23',
    'BOATMINCE Sun, Aug 30 Westminster Pier London',
    'BEEFMINCE x Bear Brum 2026 Sat, Sep 26 Eden Birmingham',
    'SPOOKMINCE Sat, Oct 31 Venue TBA, London London'
  ];
  for (const line of lines) {
    const derived = parser.deriveSegmentListingTitle({ lines: [line] });
    assert.ok(derived, `derives a title for ${JSON.stringify(line)}`);
    assert.ok(line.includes(derived), `${JSON.stringify(derived)} must appear verbatim in its source line`);
  }
});

test('a dated line with no name span derives nothing rather than a time fragment', () => {
  const parser = createParser();
  // Date-only first line: falls through to the next line exactly as before.
  assert.equal(parser.deriveSegmentListingTitle({
    lines: ['Aug 7, 2026 10:00 PM', 'PERVERT', 'DJs Villa Senor']
  }), 'PERVERT', 'a bare date line still yields to the real title below it');
  assert.equal(parser.deriveSegmentListingTitle({ lines: ['Aug 7, 2026 10:00 PM'] }), '');
  assert.equal(parser.deriveSegmentListingTitle({ lines: ['July 25, 2026'] }), '');
});

// ---------------------------------------------------------------------------
// Console-tee coverage: every log-producing module imported via importModule
// must carry the __wireConsoleTee shim, or its output silently vanishes from
// the saved Scriptable run log (each imported module has its own console).
// ---------------------------------------------------------------------------
test('every log-producing importModule module exports the __wireConsoleTee shim', () => {
  const wiredModules = {
    'shared-core': require('../shared-core'),
    normalizers: require('../normalizers'),
    'parsers/ai-web-parser': require('./ai-web-parser'),
    'parsers/scriptable-url-parser': require('./scriptable-url-parser')
  };
  for (const [name, moduleExports] of Object.entries(wiredModules)) {
    assert.equal(
      typeof moduleExports.__wireConsoleTee,
      'function',
      `${name} must export __wireConsoleTee so its logs reach the run-log file`
    );
  }
  // event-schema is intentionally absent: it never logs, so it needs no shim.
});

// ---------------------------------------------------------------------------
// Time-evidence hardening: extraction-invented times must never survive the
// evidence gate. Times/dates are never merge-arbitrated downstream (scraped
// clobbers), so an invented time flows straight into calendars. Observed
// on-device: endTime "03:00" with evidence "LATE in OCR_IMAGE_TEXT —
// interpreted as ~3am (common club close time)" at confidence 60 passed the
// gate on a stray digit.
// ---------------------------------------------------------------------------

test('evidence gate drops an invented endTime the source never states (the ~3am case)', () => {
  const parser = createParser();
  // OCR text says "LATE", never 3am. "DECEMBER 3" plants the stray bare digit
  // that used to corroborate 03:00; "@10"/"10PM" are the real (start) times.
  const source = 'MEGAWOOF DECEMBER 3 DOORS @10 10PM TIL LATE';
  const evidenceContext = parser.buildAiEvidenceContextFromText(source);
  const validationContext = { imageEvidenceUrls: new Set() };

  const result = parser.validateAiEventEvidence(
    {
      endTime: '03:00',
      __fieldEvidence: { endTime: 'LATE in OCR_IMAGE_TEXT — interpreted as ~3am (common club close time)' }
    },
    { html: source }, {}, null,
    { evidenceContext, validationContext }
  );
  assert.equal(result.event.endTime, undefined, 'invented 03:00 must be dropped');
  assert.ok(result.report.dropped.some(entry => entry.key === 'endTime'), 'drop must be reported in the existing shape');

  // Same value with NO model evidence string: the bare "3" in "DECEMBER 3"
  // still must not corroborate a time.
  const bareDigit = parser.validateAiEventEvidence(
    { endTime: '03:00' }, { html: source }, {}, null,
    { evidenceContext, validationContext }
  );
  assert.equal(bareDigit.event.endTime, undefined, 'a bare digit in the source is not time evidence');
});

test('evidence gate keeps legitimate time conversions (9PM -> 21:00, 01H, midnight)', () => {
  const parser = createParser();
  const validationContext = { imageEvidenceUrls: new Set() };
  const check = (source, field, value) => parser.validateAiEventEvidence(
    { [field]: value }, { html: source }, {}, null,
    { evidenceContext: parser.buildAiEvidenceContextFromText(source), validationContext }
  ).event[field];

  assert.equal(check('DOORS 9PM SATURDAY', 'startTime', '21:00'), '21:00', '9PM in source corroborates 21:00');
  assert.equal(check('BEARRACUDA JUSQU\'A 01H', 'endTime', '01:00'), '01:00', '01H military format still corroborates');
  assert.equal(check('PARTY TIL MIDNIGHT', 'endTime', '00:00'), '00:00', 'the word midnight corroborates 00:00');
  assert.equal(check('SHOW AT 10:30PM', 'startTime', '22:30'), '22:30', '10:30PM corroborates 22:30');
});

test('inference language in the model evidence fails corroboration even when a time token matches', () => {
  const parser = createParser();
  const source = 'SAT DEC 12 9PM - 3AM';
  const evidenceContext = parser.buildAiEvidenceContextFromText(source);
  const validationContext = { imageEvidenceUrls: new Set() };

  // The source DOES contain 3AM — but the model admits it inferred the value,
  // so the corroboration is not trusted.
  const inferred = parser.validateAiEventEvidence(
    {
      endTime: '03:00',
      __fieldEvidence: { endTime: 'no explicit end time; typically 3am at this venue' }
    },
    { html: source }, {}, null, { evidenceContext, validationContext }
  );
  assert.equal(inferred.event.endTime, undefined, 'inference language must fail corroboration');

  // The same value with verbatim evidence is kept.
  const verbatim = parser.validateAiEventEvidence(
    { endTime: '03:00', __fieldEvidence: { endTime: '9PM - 3AM' } },
    { html: source }, {}, null, { evidenceContext, validationContext }
  );
  assert.equal(verbatim.event.endTime, '03:00', 'verbatim-backed 3AM stays');
});

test('extraction captures per-field evidence so the gate can reject the exact on-device case', async () => {
  global.EventSchema = EventSchema; // earlier tests leak a mocked schema — pin the real one
  const parser = createParser();
  const response = JSON.stringify({
    title: { value: 'MEGAWOOF', evidence: 'MEGAWOOF', confidence: 95 },
    endTime: { value: '03:00', evidence: 'LATE in OCR_IMAGE_TEXT — interpreted as ~3am (common club close time)', confidence: 60 }
  });
  parser.core.callAiGenerate = async () => response;

  const source = 'MEGAWOOF 10PM TIL LATE';
  const event = await parser.extractEventWithTwoPassAi(
    { html: `<p>${source}</p>`, url: 'https://x.example/events' },
    {}, null, {}, ['title', 'endTime'], source, 'test',
    { dataFlags: { jsonLd: true } }
  );
  assert.equal(event.endTime, '03:00', 'confidence 60 passes the confidence filter');
  assert.equal(
    event.__fieldEvidence.endTime,
    'LATE in OCR_IMAGE_TEXT — interpreted as ~3am (common club close time)',
    'the evidence string must be carried for the gate'
  );

  const validated = parser.validateAiEventEvidence(event, { html: source }, {}, null, {
    evidenceContext: parser.buildAiEvidenceContextFromText(source),
    validationContext: { imageEvidenceUrls: new Set() }
  });
  assert.equal(validated.event.title, 'MEGAWOOF', 'verbatim title survives');
  assert.equal(validated.event.endTime, undefined, 'the invented end time is dropped by the gate');
});

test('date-mode values with a time component need that time in the source (T00:00 placeholder exempt)', () => {
  const parser = createParser();
  const validationContext = { imageEvidenceUrls: new Set() };
  const check = (source, value) => parser.validateAiEventEvidence(
    { startDate: value }, { html: source }, {}, null,
    { evidenceContext: parser.buildAiEvidenceContextFromText(source), validationContext }
  ).event.startDate;

  assert.equal(check('DEC 12 BEAR NIGHT 3AM', '2026-12-12T03:00'), '2026-12-12T03:00', 'stated 3AM corroborates the component');
  assert.equal(check('DEC 12 BEAR NIGHT', '2026-12-12T03:00'), undefined, 'an invented time component drops the field');
  assert.equal(check('DEC 12 BEAR NIGHT', '2026-12-12T00:00'), '2026-12-12T00:00', 'T00:00 is the no-time placeholder, not a claim');
  assert.equal(check('DEC 12 BEAR NIGHT', '2026-12-12'), '2026-12-12', 'date-only values are unaffected');
});

// ---------------------------------------------------------------------------
// NYE year-jump: a Dec 31 event ending 2am must land on Jan 1 of the NEXT
// year — never the same year's Jan 1 eleven months in the past (which used to
// collapse the end onto the start).
// ---------------------------------------------------------------------------

test('normalizeEventDates rolls a same-year Jan 1 end across the year boundary', () => {
  const parser = createParser();
  parser.now = () => new Date(Date.UTC(2026, 0, 15)); // mid-January: Jan 1 of the CURRENT year sits inside the past window
  const start = new Date(Date.UTC(2026, 11, 31, 22, 0, 0)); // Dec 31 2026 22:00 (weekday-pinned)
  const wrongEnd = new Date(Date.UTC(2026, 0, 1, 2, 0, 0)); // Jan 1 2026 02:00 — in-window, so year repair leaves it

  const result = parser.normalizeEventDates(new Date(start), new Date(wrongEnd), { start: true });
  assert.equal(result.startDate.toISOString(), '2026-12-31T22:00:00.000Z');
  assert.equal(result.endDate.toISOString(), '2027-01-01T02:00:00.000Z', 'the end must land on Jan 1 of the NEXT year');

  // A weekday-pinned end is deterministic — never bumped; existing collapse applies.
  const pinnedEnd = parser.normalizeEventDates(new Date(start), new Date(wrongEnd), { start: true, end: true });
  assert.equal(pinnedEnd.endDate.toISOString(), '2026-12-31T22:00:00.000Z', 'pinned ends keep the collapse-to-start behavior');

  // An end genuinely months before the start (not a year-boundary tail) still collapses.
  const farEnd = parser.normalizeEventDates(
    new Date(start), new Date(Date.UTC(2026, 5, 1, 2, 0, 0)), { start: true });
  assert.equal(farEnd.endDate.toISOString(), '2026-12-31T22:00:00.000Z', 'non-NYE past ends keep today\'s behavior');
});

test('normalizeAiEvent keeps Dec 31 22:00 -> Jan 1 02:00 in the next year (endTime rollover path)', () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  parser.now = FROZEN_NOW; // 2026-07-13: Dec 31 2026 is inside the future window
  const normalized = parser.normalizeAiEvent({
    title: 'NYE BEAR BASH',
    startDate: '2026-12-31',
    startTime: '22:00',
    endTime: '02:00'
  }, {}, null, null, null);
  assert.ok(normalized);
  assert.equal(normalized.startDate.toISOString(), '2026-12-31T22:00:00.000Z');
  assert.equal(normalized.endDate.toISOString(), '2027-01-01T02:00:00.000Z', 'the 2am end lands on next year\'s Jan 1');
});

// ---------------------------------------------------------------------------
// Bar corroboration (barSource): address-adjacency on the extraction corpus,
// venue-site stamping, curated stamping, and the siteRole facts. All checks
// fail open — no bar, no address, or an unlocatable address stamps nothing.
// ---------------------------------------------------------------------------

// The real incident shape: flyer OCR where the edition subtitle ("SHORE
// THING") sits far above the address while the actual venue is adjacent to it
// ("MASSIVE: 619 E. PINE ST"). Padding lines keep SHORE THING outside both
// the ±2-line and ~150-character windows.
const SHORE_THING_CORPUS = [
  'OCR_IMAGE_TEXT (https://massive.club/media/shore-thing-flyer.jpg):',
  'BEARRACUDA SEATTLE PRESENTS',
  'SHORE THING',
  'THE ANNUAL SUMMER KICKOFF FOR BEARS AND CUBS OF THE PACIFIC NORTHWEST',
  'FEATURING DJ BEARZERKER SPINNING DISCO AND HOUSE ALL NIGHT LONG',
  'WITH SPECIAL GUEST DJ TOPHER JOINING US FROM SAN FRANCISCO',
  'GOGO BEARS SURPRISE PERFORMANCES GIVEAWAYS AND MORE',
  'SATURDAY AUGUST 1ST 2026 FROM TEN UNTIL LATE',
  'TICKETS TWENTY DOLLARS AT THE DOOR OR ONLINE WHILE THEY LAST',
  '10PM - 2AM • 21+',
  'MASSIVE: 619 E. PINE ST',
  'SEATTLE WA 98122'
].join('\n');

function captureLogs(fn) {
  const lines = [];
  const originalLog = console.log;
  console.log = (message) => { lines.push(String(message)); };
  try {
    fn();
  } finally {
    console.log = originalLog;
  }
  return lines;
}

test('Shore Thing incident: subtitle bar far from the address is stamped uncorroborated with flag + adjacent candidate logs', () => {
  const parser = createParser();
  const evidenceContext = parser.buildAiEvidenceContextFromText(SHORE_THING_CORPUS);
  const event = {
    title: 'BEARRACUDA SEATTLE',
    bar: 'Shore Thing',
    address: '619 E. Pine St, Seattle, WA 98122'
  };
  const logs = captureLogs(() => {
    parser.stampBarSourceProvenance(event, evidenceContext, { url: 'https://bearracuda.com/seattle', html: '' });
  });
  assert.equal(event.bar, 'Shore Thing', 'flag-don\'t-drop: the value is never changed');
  assert.equal(event.barSource, 'uncorroborated');
  assert.ok(logs.includes(
    '🤖 AI Web: Bar "Shore Thing" not found near address "619 E. Pine St" in source — flagging as uncorroborated'
  ), `flag log expected, got: ${JSON.stringify(logs)}`);
  assert.ok(logs.includes('🤖 AI Web: Adjacent venue candidate: "MASSIVE"'),
    `candidate log expected, got: ${JSON.stringify(logs)}`);
});

test('bar adjacent to the address stamps page-adjacent: same-line, multi-line, and emoji/punctuation tolerance', () => {
  const parser = createParser();

  // Same line as the address ("MASSIVE: 619 E. PINE ST")
  const sameLine = { title: 'X', bar: 'MASSIVE', address: '619 E. Pine St, Seattle, WA 98122' };
  parser.stampBarSourceProvenance(sameLine, parser.buildAiEvidenceContextFromText(SHORE_THING_CORPUS), null);
  assert.equal(sameLine.barSource, 'page-adjacent');

  // Within ±2 lines
  const multiLineCorpus = [
    'UPCOMING EVENTS',
    'MASSIVE',
    'NIGHTCLUB AND EVENT SPACE',
    '619 E. PINE ST, SEATTLE, WA',
    'DOORS AT TEN'
  ].join('\n');
  const multiLine = { title: 'X', bar: 'Massive', address: '619 E Pine St, Seattle' };
  parser.stampBarSourceProvenance(multiLine, parser.buildAiEvidenceContextFromText(multiLineCorpus), null);
  assert.equal(multiLine.barSource, 'page-adjacent', 'case/punctuation-insensitive containment across the line window');

  // Emoji + punctuation noise, suffix-less street line
  const emojiCorpus = 'Weekly parties\n🪩 Cell Block / 3702 N Halsted\nChicago bears night';
  const emoji = { title: 'X', bar: 'Cell Block', address: '3702 N Halsted, Chicago, IL 60613' };
  parser.stampBarSourceProvenance(emoji, parser.buildAiEvidenceContextFromText(emojiCorpus), null);
  assert.equal(emoji.barSource, 'page-adjacent');
});

test('no stamp when the address is absent from the corpus, missing, or the bar/corpus is empty (fail open)', () => {
  const parser = createParser();

  const addressAbsent = { title: 'X', bar: 'Shore Thing', address: '4067 W Pico Blvd, Los Angeles, CA' };
  parser.stampBarSourceProvenance(addressAbsent, parser.buildAiEvidenceContextFromText(SHORE_THING_CORPUS), null);
  assert.equal('barSource' in addressAbsent, false, 'address not locatable in source → no stamp');

  const noAddress = { title: 'X', bar: 'Shore Thing' };
  parser.stampBarSourceProvenance(noAddress, parser.buildAiEvidenceContextFromText(SHORE_THING_CORPUS), null);
  assert.equal('barSource' in noAddress, false);

  const noBar = { title: 'X', address: '619 E. Pine St, Seattle, WA 98122' };
  parser.stampBarSourceProvenance(noBar, parser.buildAiEvidenceContextFromText(SHORE_THING_CORPUS), null);
  assert.equal('barSource' in noBar, false);

  const noCorpus = { title: 'X', bar: 'Shore Thing', address: '619 E. Pine St, Seattle' };
  parser.stampBarSourceProvenance(noCorpus, null, null);
  assert.equal('barSource' in noCorpus, false);

  // A street line without a leading house number is never searched for
  const unparseable = { title: 'X', bar: 'Shore Thing', address: 'Pier Sixty, New York' };
  parser.stampBarSourceProvenance(unparseable, parser.buildAiEvidenceContextFromText(SHORE_THING_CORPUS), null);
  assert.equal('barSource' in unparseable, false);
});

test('curated bars data (when reachable through core) outranks adjacency: curated stamp even when not adjacent', () => {
  const parser = createParser();
  parser.core = new SharedCore({}, {
    eventSchema: EventSchema,
    bars: { seattle: [{ name: 'Massive' }] }
  });
  const event = { title: 'X', bar: 'MASSIVE', city: 'seattle', address: '4067 W Pico Blvd, Los Angeles' };
  parser.stampBarSourceProvenance(event, parser.buildAiEvidenceContextFromText('no addresses here'), null);
  assert.equal(event.barSource, 'curated');

  // No bars data for the city → the adjacency path still runs (fail open)
  const unknownCity = { title: 'X', bar: 'MASSIVE', city: 'portland', address: '619 E. Pine St, Seattle' };
  parser.stampBarSourceProvenance(unknownCity, parser.buildAiEvidenceContextFromText(SHORE_THING_CORPUS), null);
  assert.equal(unknownCity.barSource, 'page-adjacent');
});

// ---------------------------------------------------------------------------
// siteRole classification: hard facts only, config override on top.
// ---------------------------------------------------------------------------

const VENUE_SITE_HTML = `<html><head>
  <meta property="og:site_name" content="MASSIVE" />
  <script type="application/ld+json">{"@type":"NightClub","name":"Massive","url":"https://massive.club"}</script>
</head><body>MASSIVE NIGHTCLUB SEATTLE</body></html>`;

test('siteRole: JSON-LD venue-ish @type classifies the page as venue; config override wins over it', () => {
  const parser = createParser();
  const htmlData = { url: 'https://massive.club/events', html: VENUE_SITE_HTML };
  assert.equal(parser.resolvePageSiteRole(htmlData, {}), 'venue');
  assert.equal(parser.getPageSiteRole(htmlData), 'venue', 'cached for downstream copies');

  // Config override has top precedence — even against a venue-typed page
  const overridden = { url: 'https://massive.club/events', html: VENUE_SITE_HTML };
  assert.equal(parser.resolvePageSiteRole(overridden, { siteRole: 'organizer' }), 'organizer');
  const venueOverride = { url: 'https://promoter.example/events', html: '<html><body>hi</body></html>' };
  assert.equal(parser.resolvePageSiteRole(venueOverride, { siteRole: 'venue' }), 'venue');

  // A venue-typed Place nested inside an Event is the EVENT's location, not the page's identity
  const eventNested = {
    url: 'https://promoter.example/e/1',
    html: `<script type="application/ld+json">{"@type":"Event","name":"Bear Night","location":{"@type":"NightClub","name":"Massive"}}</script>`
  };
  assert.equal(parser.resolvePageSiteRole(eventNested, {}), '');
});

test('siteRole: segment facts — multiple distinct addresses under an Organization → organizer; single recurring address + footer → venue', () => {
  const parser = createParser();

  const organizerHtml = `<html><head>
    <script type="application/ld+json">{"@type":"Organization","name":"Bearracuda"}</script>
  </head><body>tour dates</body></html>`;
  const organizerData = { url: 'https://bearracuda.example/events', html: organizerHtml };
  const multiCitySegments = [
    { lines: ['FURBALL BLACKOUT', 'JULY 10', '619 E. PINE ST, SEATTLE'] },
    { lines: ['FURBALL LA', 'JULY 24', '4067 W PICO BLVD, LOS ANGELES'] }
  ];
  assert.equal(parser.resolvePageSiteRole(organizerData, {}, multiCitySegments), 'organizer');

  const venueHtml = `<html><body>
    <div>AUG 1 BEAR NIGHT at 619 E. PINE ST</div>
    <div>AUG 8 UNDERWEAR PARTY</div>
    <footer>MASSIVE • 619 E. PINE ST • SEATTLE, WA 98122</footer>
  </body></html>`;
  const venueData = { url: 'https://massive.club/calendar', html: venueHtml };
  const singleAddressSegments = [
    { lines: ['BEAR NIGHT', 'AUG 1', '619 E. PINE ST'] },
    { lines: ['UNDERWEAR PARTY', 'AUG 8'] }
  ];
  assert.equal(parser.resolvePageSiteRole(venueData, {}, singleAddressSegments), 'venue');

  // Multiple addresses WITHOUT an Organization/PerformingGroup type stays undetermined
  const bareData = { url: 'https://somewhere.example/events', html: '<html><body>list</body></html>' };
  assert.equal(parser.resolvePageSiteRole(bareData, {}, multiCitySegments), '');
});

test('siteRole: undetermined pages log once and inject no venue context', () => {
  const parser = createParser();
  const htmlData = { url: 'https://promoter.example/events', html: '<html><body>events</body></html>' };
  assert.equal(parser.resolvePageSiteRole(htmlData, {}), '');
  const logs = captureLogs(() => {
    parser.logPageSiteRoleOnce(htmlData);
    parser.logPageSiteRoleOnce(htmlData);
  });
  assert.deepEqual(logs, ['🤖 AI Web: siteRole for promoter.example undetermined'], 'exactly once per page');
});

test('KNOWN VENUE line appears in extraction prompts only for venue pages, replacing KNOWN ORGANIZER there', () => {
  const parser = createParser();
  const venueData = { url: 'https://massive.club/events', html: VENUE_SITE_HTML };
  parser.resolvePageSiteRole(venueData, {});
  const venuePrompt = parser.buildExtractionPrompt(venueData, {}, null, {}, ['title', 'bar'], 'SNIPPET', 'default', {});
  assert.match(venuePrompt,
    /KNOWN VENUE \(this is the venue's own site\): "MASSIVE" — events on this page take place AT this venue unless the page states another location; DJ names, taglines, and edition subtitles are NOT the venue\./);
  assert.ok(!/KNOWN ORGANIZER/.test(venuePrompt),
    'the organizer line would contradict KNOWN VENUE on the venue\'s own site');

  // Undetermined page with a brand keeps today's organizer line, no venue line
  const organizerData = {
    url: 'https://bearracuda.example/events',
    html: '<html><head><meta property="og:site_name" content="Bearracuda" /></head><body></body></html>'
  };
  parser.resolvePageSiteRole(organizerData, {});
  const organizerPrompt = parser.buildExtractionPrompt(organizerData, {}, null, {}, ['title', 'bar'], 'SNIPPET', 'default', {});
  assert.match(organizerPrompt, /KNOWN ORGANIZER \(derived from page metadata\): "Bearracuda"/);
  assert.ok(!/KNOWN VENUE/.test(organizerPrompt));
});

test('venue-site: a bar equal to the known venue is stamped venue-site and survives the brand guards', () => {
  const parser = createParser();
  const htmlData = { url: 'https://massive.club/events', html: VENUE_SITE_HTML };
  parser.resolvePageSiteRole(htmlData, {});

  // The pass-level brand guard must NOT reject the venue's own name as bar
  const guarded = parser.rejectBrandLikePassFields({ bar: 'MASSIVE' }, htmlData, 'test');
  assert.equal(guarded.bar, 'MASSIVE', 'venue site: the site name IS the venue');

  // normalizeAiEvent keeps the bar, stamps no _organizer on a venue site
  const event = parser.normalizeAiEvent(
    { title: 'BEAR NIGHT', startDate: '2026-08-01', startTime: '21:00', bar: 'MASSIVE' },
    {}, htmlData, null, null);
  assert.equal(event.bar, 'MASSIVE', 'the organizer bar-drop guard is off on venue sites');
  assert.equal(event._organizer, undefined, 'no organizer stamp — arbitration must not veto the venue as bar');

  // And the corroboration stamp marks it venue-site
  parser.stampBarSourceProvenance(event, parser.buildAiEvidenceContextFromText('no addresses in this corpus'), htmlData);
  assert.equal(event.barSource, 'venue-site');

  // A different bar on the same venue page is NOT stamped venue-site
  const other = { title: 'OFFSITE', bar: 'The Cuff', address: '1533 13th Ave, Seattle' };
  parser.stampBarSourceProvenance(other, parser.buildAiEvidenceContextFromText('somewhere else entirely'), htmlData);
  assert.equal('barSource' in other, false);
});

test('venue name derivation prefers declared names and falls back to the host base', () => {
  const parser = createParser();
  // og:site_name wins
  assert.equal(parser.getPageVenueName({ url: 'https://massive.club/e', html: VENUE_SITE_HTML }), 'MASSIVE');
  // JSON-LD venue node name when no og:site_name
  const jsonLdOnly = {
    url: 'https://massive.club/e',
    html: '<script type="application/ld+json">{"@type":"NightClub","name":"Massive"}</script>'
  };
  assert.equal(parser.getPageVenueName(jsonLdOnly), 'Massive');
  // Host base as last resort ("massive" from www.massive.club)
  assert.equal(parser.getPageVenueName({ url: 'https://www.massive.club/events', html: '<html></html>' }), 'massive');
});

// === City evidence hardening (run 20260723-123149: FURBALL MAD.BEAR) ===

const MADBEAR_CITY_CONFIG = {
  nyc: { timezone: 'America/New_York', patterns: ['new york', 'nyc', 'manhattan', 'brooklyn'] },
  torremolinos: { timezone: 'Europe/Madrid', patterns: ['torremolinos'] }
};

async function captureLogsAsync(fn) {
  const lines = [];
  const originalLog = console.log;
  console.log = (message) => { lines.push(String(message)); };
  try {
    await fn();
  } finally {
    console.log = originalLog;
  }
  return lines;
}

test('MAD.BEAR regression: context-cited city evidence is dropped and the adjacent location line restores the real city; address never gains a resolved city', async () => {
  const parser = createParser();
  const htmlData = {
    url: 'https://furball.nyc/madbear',
    html: [
      'SEGMENT_LISTING_TITLE: FURBALL MAD.BEAR',
      'FRIDAY AUGUST 7 2026',
      '@ MAD.BEAR Beach',
      'Torremolinos, Spain',
      'LA NOGALERA',
      'TICKETS ONLINE'
    ].join('\n'),
    ocrResults: [{
      url: 'https://furball.nyc/flyer.jpg',
      text: 'FURBALL MAD.BEAR\nWWW.FURBALL.NYC\nNYC',
      // The poisoned vision context-prep summary (hallucinated venue+city)
      eventSummary: 'Furball NYC event at Aqua Emporio with bears and DJs'
    }]
  };
  parser.getAiEvent = async () => ({
    title: 'FURBALL MAD.BEAR',
    startDate: '2026-08-07',
    bar: 'MAD.BEAR Beach',
    address: 'LA NOGALERA',
    city: 'new york',
    __preValidatedFields: ['startDate'],
    __fieldEvidence: {
      // The exact observed evidence string from the incident run
      city: 'OCR_IMAGE_TEXT: "NYC" and SEGMENT_LISTING_TITLE context + additional context specifies NYC'
    }
  });

  let event = null;
  const logs = await captureLogsAsync(async () => {
    event = await parser.extractSingleEvent(
      htmlData, {}, MADBEAR_CITY_CONFIG,
      ['title', 'startDate', 'city', 'bar', 'address']
    );
  });

  assert.ok(event, 'event should survive extraction');
  assert.equal(event.city, 'torremolinos', 'the page location line wins over branding-derived nyc');
  assert.equal(event._citySource, 'page-adjacent');
  assert.equal(event.address, 'LA NOGALERA', 'address must never gain an appended resolved city');
  assert.ok(logs.includes(
    '🤖 AI Web: City corrected to "torremolinos" from location line "Torremolinos, Spain" (extracted "new york" came from weaker evidence)'
  ), `correction log expected, got: ${JSON.stringify(logs)}`);
  const droppedCity = event._aiValidation && event._aiValidation.dropped.find(entry => entry.field === 'city');
  assert.ok(droppedCity, 'city must be dropped by the evidence gate');
  assert.equal(droppedCity.reason, 'context-cited-evidence');
});

test('evidence gate: context-citing evidence fails corroboration for ANY field', () => {
  const parser = createParser();
  const evidenceContext = parser.buildAiEvidenceContextFromText('DJ NIGHT AT The Eagle 554 W 28TH ST');
  const validationContext = { imageEvidenceUrls: new Set(), cityConfig: null };
  const aiEvent = {
    bar: 'The Eagle',
    __fieldEvidence: { bar: 'per the context, the venue is The Eagle' }
  };
  const result = parser.validateAiEventEvidence(aiEvent, { html: 'x' }, {}, null, { evidenceContext, validationContext });
  assert.equal(result.event.bar, undefined, 'value present in the corpus is still dropped when its evidence cites the context block');
  const entry = result.report.dropped.find(e => e.field === 'bar');
  assert.equal(entry && entry.reason, 'context-cited-evidence');

  // Same value with honest evidence is kept
  const clean = parser.validateAiEventEvidence(
    { bar: 'The Eagle', __fieldEvidence: { bar: 'AT The Eagle' } },
    { html: 'x' }, {}, null, { evidenceContext, validationContext }
  );
  assert.equal(clean.event.bar, 'The Eagle');
});

test('evidence gate: brand/domain-citing city evidence is dropped; a real location line in the same evidence rescues it', () => {
  const parser = createParser();
  const htmlData = { url: 'https://furball.nyc/events', html: '' };
  const evidenceContext = parser.buildAiEvidenceContextFromText('FURBALL PRESENTS\nWWW.FURBALL.NYC\nBROOKLYN NY');
  const validationContext = { imageEvidenceUrls: new Set(), cityConfig: MADBEAR_CITY_CONFIG };

  // Evidence citing only the promoter's domain branding → dropped
  const branded = parser.validateAiEventEvidence(
    { city: 'new york', __fieldEvidence: { city: 'OCR_IMAGE_TEXT: "WWW.FURBALL.NYC"' } },
    htmlData, {}, null, { evidenceContext, validationContext }
  );
  assert.equal(branded.event.city, undefined);
  const entry = branded.report.dropped.find(e => e.field === 'city');
  assert.equal(entry && entry.reason, 'brand-cited-evidence');

  // Same brand tokens but with an explicit "<Place>, <Place>" statement → kept
  const rescued = parser.validateAiEventEvidence(
    { city: 'new york', __fieldEvidence: { city: 'WWW.FURBALL.NYC flyer plus explicit "Brooklyn, NY" address line' } },
    htmlData, {}, null, { evidenceContext, validationContext }
  );
  assert.equal(rescued.event.city, 'new york');

  // Evidence citing a real location and no brand tokens at all → kept (baseline)
  const plain = parser.validateAiEventEvidence(
    { city: 'new york', __fieldEvidence: { city: '"BROOKLYN NY" in the venue block' } },
    htmlData, {}, null, { evidenceContext, validationContext }
  );
  assert.equal(plain.event.city, 'new york');
});

test('city cross-check: adjacent location line resolving to a known city overrides a wrong extracted city', () => {
  const parser = createParser();
  const cityConfig = {
    nyc: { timezone: 'America/New_York', patterns: ['new york', 'nyc'] },
    'asbury-park': { timezone: 'America/New_York', patterns: ['asbury park'] }
  };
  const corpus = ['SUNDAY TEA DANCE', '@ Paradise Lounge', 'Asbury Park, NJ', 'Doors at 4pm'].join('\n');
  const event = { title: 'TEA DANCE', city: 'new york', bar: 'Paradise Lounge' };
  const logs = captureLogs(() => {
    parser.crossCheckCityAgainstAdjacentLocation(event, parser.buildAiEvidenceContextFromText(corpus), cityConfig);
  });
  assert.equal(event.city, 'asbury-park');
  assert.equal(event._citySource, 'page-adjacent');
  assert.ok(logs.includes(
    '🤖 AI Web: City corrected to "asbury-park" from location line "Asbury Park, NJ" (extracted "new york" came from weaker evidence)'
  ), `override log expected, got: ${JSON.stringify(logs)}`);
});

test('city cross-check: unresolvable adjacent location clears a contradicting city; never guesses', () => {
  const parser = createParser();
  const cityConfig = { nyc: { timezone: 'America/New_York', patterns: ['new york', 'nyc'] } };
  const corpus = ['FURBALL SUMMER', '@ MAD.BEAR Beach', 'Benidorm, Spain', 'LA NOGALERA'].join('\n');
  const event = { title: 'FURBALL SUMMER', city: 'new york', bar: 'MAD.BEAR Beach' };
  const logs = captureLogs(() => {
    parser.crossCheckCityAgainstAdjacentLocation(event, parser.buildAiEvidenceContextFromText(corpus), cityConfig);
  });
  assert.equal('city' in event, false, 'city cleared — unknown routes to chunky-dad-unknown, the safe path');
  assert.equal(event._citySource, undefined, 'no provenance stamp on a clear');
  assert.ok(logs.includes(
    '🤖 AI Web: Extracted city "new york" contradicts adjacent location line "Benidorm, Spain" — city cleared, event will need manual review'
  ), `clear log expected, got: ${JSON.stringify(logs)}`);
});

test('city cross-check: fail-open paths — no location line, agreeing location line, no city, no anchors', () => {
  const parser = createParser();
  const cityConfig = { nyc: { timezone: 'America/New_York', patterns: ['new york', 'nyc'] } };

  // No adjacent location line → untouched, no stamp, no log
  const noLine = { title: 'X', city: 'new york', bar: 'Rockbar' };
  const noLineLogs = captureLogs(() => {
    parser.crossCheckCityAgainstAdjacentLocation(
      noLine, parser.buildAiEvidenceContextFromText('PARTY\n@ Rockbar\nDoors at 10pm'), cityConfig);
  });
  assert.equal(noLine.city, 'new york');
  assert.equal(noLine._citySource, undefined);
  assert.equal(noLineLogs.length, 0);

  // Location line that resolves to the SAME city → untouched, no log
  const agrees = { title: 'X', city: 'new york', bar: 'Rockbar' };
  const agreesLogs = captureLogs(() => {
    parser.crossCheckCityAgainstAdjacentLocation(
      agrees, parser.buildAiEvidenceContextFromText('PARTY\n@ Rockbar\nNew York, NY'), cityConfig);
  });
  assert.equal(agrees.city, 'new york');
  assert.equal(agrees._citySource, undefined, 'no stamp when the page merely agrees');
  assert.equal(agreesLogs.length, 0);

  // No extracted city (live or dropped) → untouched
  const noCity = { title: 'X', bar: 'Rockbar' };
  parser.crossCheckCityAgainstAdjacentLocation(
    noCity, parser.buildAiEvidenceContextFromText('@ Rockbar\nTorremolinos, Spain'), cityConfig);
  assert.equal(noCity.city, undefined);

  // No bar/address anchors → untouched
  const noAnchor = { title: 'X', city: 'new york' };
  parser.crossCheckCityAgainstAdjacentLocation(
    noAnchor, parser.buildAiEvidenceContextFromText('Torremolinos, Spain'), cityConfig);
  assert.equal(noAnchor.city, 'new york');
});

test('prompt capture: city guidance and strengthened context header are present, base texts byte-identical', () => {
  const parser = createParser();
  const htmlData = {
    url: 'https://furball.nyc/madbear',
    html: 'FURBALL MAD.BEAR',
    ocrResults: [{ url: 'https://furball.nyc/flyer.jpg', text: 'NYC', eventSummary: 'Furball NYC event summary' }]
  };
  const prompt = parser.buildExtractionPrompt(htmlData, {}, null, {}, ['title', 'city'], 'SNIPPET', 'default', { ocr: true });

  // The ADDITIONAL CONTEXT header keeps its original text with ONLY the new clause appended
  const expectedHeader = 'ADDITIONAL CONTEXT (DO NOT EXTRACT FROM THIS — for disambiguation only, e.g. resolving festival vs. event name conflicts — never cite it as evidence):';
  assert.ok(prompt.includes(expectedHeader), 'strengthened context header expected');
  assert.equal(prompt.split('ADDITIONAL CONTEXT').length, 2, 'exactly one context header');

  // The city line is the schema description byte-identical plus ONLY the appended guidance
  const cityLine = prompt.split('\n').find(line => line.startsWith('- city: '));
  const schemaDescription = parser.getEventSchemaPromptFieldDescription('city');
  assert.ok(schemaDescription, 'schema city description resolves');
  assert.equal(
    cityLine,
    `- city: ${schemaDescription} The promoter's home city in branding, logos, or website domains (e.g. a .nyc domain) is NOT the event city — use explicit location statements (e.g. "Torremolinos, Spain") near the venue/address.`
  );
});

// ---------------------------------------------------------------------------
// Address plausibility gate (run 20260723-140457: extraction stored
// address "Legacy" — the venue's own name — for FURBALL Boston)
// ---------------------------------------------------------------------------

function captureGateLogs() {
  const lines = [];
  const original = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  return { lines, restore: () => { console.log = original; } };
}

test('address gate: an address equal to the bar name is dropped with the additive log', () => {
  const parser = createParser();
  const event = { title: 'FURBALL Boston', bar: 'Legacy', address: 'Legacy', city: 'boston' };

  const captured = captureGateLogs();
  try {
    parser.applyAddressPlausibilityGate(event, {});
  } finally {
    captured.restore();
  }

  assert.equal(event.address, undefined, 'a venue name is not an address');
  assert.ok(
    captured.lines.some(line => line.includes('🤖 AI Web: Dropped implausible address "Legacy" (matches venue name)')),
    `drop log expected, got:\n${captured.lines.join('\n')}`
  );
  assert.equal(event.bar, 'Legacy', 'the bar itself is untouched');
});

test('address gate: an address equal to the derived organizer/brand is dropped', () => {
  const parser = createParser();
  const organizerEqual = { title: 'X', bar: 'The Eagle', address: 'Bearracuda', _organizer: 'Bearracuda' };
  const captured = captureGateLogs();
  try {
    parser.applyAddressPlausibilityGate(organizerEqual, {});
    const brandEqual = { title: 'Y', bar: 'The Eagle', address: 'FURBALL' };
    parser.applyAddressPlausibilityGate(brandEqual, { pageBrandNames: ['Furball'] });
    assert.equal(brandEqual.address, undefined, 'page brand names count as organizer names');
  } finally {
    captured.restore();
  }
  assert.equal(organizerEqual.address, undefined);
  assert.ok(captured.lines.some(line => line.includes('Dropped implausible address "Bearracuda" (matches organizer/brand name)')));
});

test('address gate: vague-but-real place names and street addresses are kept; unsure fails open', () => {
  const parser = createParser();
  const captured = captureGateLogs();
  try {
    const placeName = { title: 'FURBALL MAD.BEAR', bar: 'Aqua Emporio', address: 'LA NOGALERA' };
    parser.applyAddressPlausibilityGate(placeName, {});
    assert.equal(placeName.address, 'LA NOGALERA', 'a multi-word place name is vague but real — kept');

    const street = { title: 'FURBALL Boston', bar: 'Legacy', address: '79 Warrenton St' };
    parser.applyAddressPlausibilityGate(street, {});
    assert.equal(street.address, '79 Warrenton St', 'a street address never drops');

    const commaForm = { title: 'FURBALL Boston', bar: 'Legacy', address: 'Legacy, Boston' };
    parser.applyAddressPlausibilityGate(commaForm, {});
    assert.equal(commaForm.address, 'Legacy, Boston', 'a "Place, Place" comma form is kept (fail open)');

    const noBar = { title: 'X', address: 'Somewhere Nice' };
    parser.applyAddressPlausibilityGate(noBar, {});
    assert.equal(noBar.address, 'Somewhere Nice', 'nothing to compare against and multi-word → kept');
  } finally {
    captured.restore();
  }
});

test('address gate: a bare single word with no address signal drops even when it is not the bar', () => {
  const parser = createParser();
  const captured = captureGateLogs();
  try {
    const event = { title: 'X', bar: 'The Eagle', address: 'Legacy' };
    parser.applyAddressPlausibilityGate(event, {});
    assert.equal(event.address, undefined, 'a lone name-shaped word is never an address');
    assert.ok(captured.lines.some(line => line.includes('Dropped implausible address "Legacy" (not address-shaped)')));
  } finally {
    captured.restore();
  }
});

test('address gate shape rules: isPlausiblyAddressShaped', () => {
  const parser = createParser();
  assert.equal(parser.isPlausiblyAddressShaped('Legacy'), false, 'single bare word fails all three signals');
  assert.equal(parser.isPlausiblyAddressShaped('LA NOGALERA'), true, 'multi-word place name passes');
  assert.equal(parser.isPlausiblyAddressShaped('79 Warrenton St'), true, 'house number + street word');
  assert.equal(parser.isPlausiblyAddressShaped('Warrenton Street'), true, 'street-type word alone');
  assert.equal(parser.isPlausiblyAddressShaped('Brooklyn, NY'), true, 'Place, ST comma form');
  assert.equal(parser.isPlausiblyAddressShaped('Calle Casablanca 12'), true, 'standalone house-number token anywhere');
  assert.equal(parser.isPlausiblyAddressShaped(''), false);
});


// ---------------------------------------------------------------------------
// Evidence-pointer rescue (LOG-ONLY observation phase): "trust the pointer,
// not the copy". The extraction model is a good FINDER and a bad COPIER —
// run 20260723-224434 (FURBALL Boston) dropped address "79 Warrenon" whose
// evidence "79 WARRENTON TICKETS: GAYMAFIABOSTON.COM FURBALL.NYC" sits
// VERBATIM in the OCR corpus. The rescue logs/stashes what the corpus says
// there; it must NEVER change a gate decision or any event data.
// ---------------------------------------------------------------------------

const FURBALL_OCR_TEXT = 'FURBALL BOSTON\nBEAR WEEK RETURN\nSAT, JULY 25\n10pm-3am\n79 WARRENTON TICKETS: GAYMAFIABOSTON.COM FURBALL.NYC';
const FURBALL_SEGMENT_TEXT = 'SEGMENT_LINK_URL: https://tickets.example/furball-boston\nFURBALL Boston\nJuly 25, 2026\nBoston, MA';

// Gate run with the FURBALL-shaped corpora (OCR text prepended to segment
// text — the same combined corpus the snippet gate builds).
function runFurballGate(parser, aiEvent) {
  const combined = `${FURBALL_OCR_TEXT}\n\n${FURBALL_SEGMENT_TEXT}`;
  return parser.validateAiEventEvidence(
    aiEvent,
    { html: combined, ocrResults: [{ url: 'https://img.example/furball.png', text: FURBALL_OCR_TEXT }] },
    {}, null,
    {
      evidenceContext: parser.buildAiEvidenceContextFromText(combined),
      validationContext: { imageEvidenceUrls: new Set() }
    }
  );
}

test('evidence-pointer rescue: the canonical retry-pass shape logs the corpus candidate (79 WARRENTON)', () => {
  const parser = createParser();
  const captured = captureGateLogs();
  let result;
  try {
    result = runFurballGate(parser, {
      address: '79 Warrenon',
      __fieldEvidence: { address: '79 WARRENTON TICKETS: GAYMAFIABOSTON.COM FURBALL.NYC' }
    });
  } finally {
    captured.restore();
  }

  // The gate decision is untouched: the field is still dropped, in the
  // pre-existing report shape (no new keys on the dropped entry).
  assert.equal(result.event.address, undefined, 'rescue must never resurrect the dropped field');
  assert.deepEqual(result.report.dropped, [{ field: 'address', key: 'address', mode: 'exact', value: '79 Warrenon' }]);

  // The candidate carries the CORPUS's own casing, aligned to the value's
  // tokens — "79 WARRENTON", not the whole ticket line.
  assert.deepEqual(result.report.evidenceRescues, [
    { field: 'address', candidate: '79 WARRENTON', modelValue: '79 Warrenon', corpus: 'ocr' }
  ]);
  assert.ok(
    captured.lines.includes('🤖 AI Web: Evidence-pointer rescue (log-only) for address: corpus has "79 WARRENTON" where model wrote "79 Warrenon" (evidence located in ocr text)'),
    `rescue log line expected, got: ${JSON.stringify(captured.lines)}`
  );
});

test('evidence-pointer rescue: the first-pass rotten-evidence shape gets NO rescue', () => {
  const parser = createParser();
  // Real first-pass evidence from run 20260723-224434: inference language
  // ("likely a typo") AND an ADDITIONAL CONTEXT citation. The pointer itself
  // is untrustworthy — this class must stay untouched.
  const result = runFurballGate(parser, {
    address: '79 Warren',
    __fieldEvidence: { address: 'OCR_IMAGE_TEXT: "79 WARRENTON"; Additional context clarifies as "79 Warrenon" — likely a typo for "Warren"' }
  });
  assert.equal(result.event.address, undefined, 'the field still drops');
  assert.equal(result.report.evidenceRescues, undefined, 'nothing is stashed for evidence-quality rejections');

  // Inference language ALONE (no context citation) also blocks the rescue.
  const inferredOnly = runFurballGate(parser, {
    address: '79 Warren',
    __fieldEvidence: { address: 'OCR_IMAGE_TEXT: "79 WARRENTON" — likely a typo for "Warren"' }
  });
  assert.equal(inferredOnly.report.evidenceRescues, undefined, 'inference-language evidence is a rotten pointer');
});

test('evidence-pointer rescue: quoted OCR_IMAGE_TEXT envelope yields the corpus-cased candidate', () => {
  const parser = createParser();
  const result = runFurballGate(parser, {
    address: '79 Warrenon',
    __fieldEvidence: { address: 'OCR_IMAGE_TEXT: "79 WARRENTON"' }
  });
  assert.deepEqual(result.report.evidenceRescues, [
    { field: 'address', candidate: '79 WARRENTON', modelValue: '79 Warrenon', corpus: 'ocr' }
  ]);
});

test('evidence-pointer rescue: curly-quote envelopes and multi-fragment citations locate correctly', () => {
  const parser = createParser();
  // Curly quotes (bear websites and models are both sloppy).
  const curly = runFurballGate(parser, {
    address: '79 Warrenon',
    __fieldEvidence: { address: 'OCR_IMAGE_TEXT: “79 WARRENTON”' }
  });
  assert.deepEqual(curly.report.evidenceRescues, [
    { field: 'address', candidate: '79 WARRENTON', modelValue: '79 Warrenon', corpus: 'ocr' }
  ]);

  // Multi-fragment citation where only the SECOND fragment is in the corpus.
  const multi = runFurballGate(parser, {
    address: '79 Warrenon',
    __fieldEvidence: { address: '"NOT ACTUALLY IN THE CORPUS ANYWHERE" and "79 WARRENTON TICKETS"' }
  });
  assert.deepEqual(multi.report.evidenceRescues, [
    { field: 'address', candidate: '79 WARRENTON', modelValue: '79 Warrenon', corpus: 'ocr' }
  ]);
});

test('evidence-pointer rescue: unlocatable evidence is a silent no-op (the common case, not an error)', () => {
  const parser = createParser();
  const captured = captureGateLogs();
  let result;
  try {
    result = runFurballGate(parser, {
      address: '123 Fake Street',
      __fieldEvidence: { address: 'the flyer says 123 Fake Street near the bottom' }
    });
  } finally {
    captured.restore();
  }
  assert.equal(result.event.address, undefined, 'the field still drops');
  assert.equal(result.report.evidenceRescues, undefined, 'no candidate is stashed');
  assert.ok(!captured.lines.some(line => line.includes('Evidence-pointer rescue')), 'no rescue line is logged');

  // A field with no evidence string at all: also a silent no-op.
  const noEvidence = runFurballGate(parser, { address: '123 Fake Street' });
  assert.equal(noEvidence.report.evidenceRescues, undefined);
});

test('evidence-pointer rescue: a verbatim value passes the gate and the feature never runs', () => {
  const parser = createParser();
  const captured = captureGateLogs();
  let result;
  try {
    result = runFurballGate(parser, {
      address: '79 WARRENTON',
      __fieldEvidence: { address: '79 WARRENTON TICKETS: GAYMAFIABOSTON.COM FURBALL.NYC' }
    });
  } finally {
    captured.restore();
  }
  assert.equal(result.event.address, '79 WARRENTON', 'verbatim value is kept as before');
  assert.equal(result.report.evidenceRescues, undefined, 'no rescue runs on kept fields');
  assert.ok(!captured.lines.some(line => line.includes('Evidence-pointer rescue')));
});

test('evidence-pointer rescue: non-scoped fields (startTime) never rescue even with a verbatim pointer', () => {
  const parser = createParser();
  // 23:30 is nowhere in the corpus (flyer says 10pm-3am) → dropped; the
  // evidence quote IS verbatim, but time fields are out of scope on purpose
  // (format conversion is not transcription).
  const result = runFurballGate(parser, {
    startTime: '23:30',
    __fieldEvidence: { startTime: 'OCR_IMAGE_TEXT: "10pm-3am"' }
  });
  assert.equal(result.event.startTime, undefined, 'the field still drops');
  assert.equal(result.report.evidenceRescues, undefined, 'time fields are excluded from the rescue scope');
});

test('evidence-pointer rescue: token alignment takes the corpus span, not the whole located line', () => {
  const parser = createParser();
  // Long corpus line + mangled two-token value → aligned "79 WARRENTON":
  // "79" anchors exactly, "Warrenon" ≈ "WARRENTON" within the edit budget.
  assert.equal(
    parser.alignValueTokensInSpan('79 Warrenon', '79 WARRENTON TICKETS: GAYMAFIABOSTON.COM FURBALL.NYC'),
    '79 WARRENTON'
  );
  // No exact anchor anywhere → no alignment (the caller falls back to the
  // whole fragment, which is acceptable for log-only).
  assert.equal(parser.alignValueTokensInSpan('Totally Unrelated', '79 WARRENTON TICKETS'), '');
  // A dissimilar token breaks the window even next to an exact anchor.
  assert.equal(parser.alignValueTokensInSpan('79 Houston', '79 WARRENTON TICKETS'), '');
});

test('evidence-pointer rescue: extractSingleEvent stamps deduped _evidenceRescues onto the event', async () => {
  global.EventSchema = EventSchema; // earlier tests leak a mocked schema — pin the real one
  const parser = createParser();
  const combined = `${FURBALL_OCR_TEXT}\n\n${FURBALL_SEGMENT_TEXT}`;
  // Mocked merged AI result: a snippet-pass rescue memo rides __evidenceRescues
  // and the final gate re-drops the same mangled address → the two must dedupe
  // into ONE stashed entry.
  parser.getAiEvent = async () => ({
    title: 'FURBALL Boston',
    startDate: '2026-07-25',
    address: '79 Warrenon',
    __fieldEvidence: { address: '79 WARRENTON TICKETS: GAYMAFIABOSTON.COM FURBALL.NYC' },
    __evidenceRescues: [
      { field: 'address', candidate: '79 WARRENTON', modelValue: '79 Warrenon', corpus: 'ocr' }
    ]
  });

  const event = await parser.extractSingleEvent(
    {
      html: combined,
      url: 'https://www.furball.nyc',
      ocrResults: [{ url: 'https://img.example/furball.png', text: FURBALL_OCR_TEXT }]
    },
    {}, null, ['title', 'address', 'startDate']
  );
  assert.ok(event, 'extraction still yields an event');
  assert.equal(event.address, '', 'the dropped address stays dropped (log-only)');
  assert.deepEqual(event._evidenceRescues, [
    { field: 'address', candidate: '79 WARRENTON', modelValue: '79 Warrenon', corpus: 'ocr' }
  ], 'snippet memo + final-gate rescue dedupe to one entry');
});

test('evidence-pointer rescue: snippet-pass memos concatenate through mergeAiEventFields', () => {
  const parser = createParser();
  const merged = parser.mergeAiEventFields(
    { __evidenceRescues: [{ field: 'address', candidate: 'A', modelValue: 'a', corpus: 'ocr' }] },
    { __evidenceRescues: [{ field: 'bar', candidate: 'B', modelValue: 'b', corpus: 'page' }] }
  );
  assert.deepEqual(merged.__evidenceRescues, [
    { field: 'address', candidate: 'A', modelValue: 'a', corpus: 'ocr' },
    { field: 'bar', candidate: 'B', modelValue: 'b', corpus: 'page' }
  ]);
});

// Bar-convergence rescue (run 20260723-224434: the FURBALL Boston segment
// plainly named its venue "Legacy" — page text, flyer OCR, and curated bars
// all agreed — but the model returned the street address as the bar and the
// verbatim gate dropped it; no bar, so no venue-POI address/pin either).
// Systematic rule: every plausible name line from PAGE / OCR / CURATED is a
// candidate, adoption requires >= 2 independent signals, and position is only
// a ranking tie-breaker — so layout (venue above, below, flyer-only, noise in
// between) never decides whether the rescue works.
// ---------------------------------------------------------------------------

const RESCUE_CITY_CONFIG = {
  cities: {
    boston: { name: 'Boston', patterns: ['boston'], timezone: 'America/New_York' }
  }
};

// The real segment shape from furball.nyc.
const FURBALL_BOSTON_SEGMENT = [
  'FURBALL Boston',
  'Bear Week Return',
  'Legacy',
  'Boston, MA',
  'July 25, 2026'
].join('\n');

// The flyer OCR independently names the venue and its street.
const FURBALL_BOSTON_OCR = 'FURBALL BOSTON\nBEAR WEEK RETURN\nLEGACY\n79 WARRENTON\nJULY 25 2026';

const BOSTON_CURATED_BARS = {
  boston: [{ name: 'Legacy', city: 'boston', address: '79 Warrenton St, Boston, MA 02116' }]
};

function createRescueParser(bars) {
  const parser = createParser();
  parser.core = new SharedCore({}, { eventSchema: EventSchema, bars: bars || {} });
  return parser;
}

function rescueHtmlData(overrides = {}) {
  return {
    url: 'https://furball.nyc/events',
    html: '<html><body>multi-event page</body></html>',
    segmentText: FURBALL_BOSTON_SEGMENT,
    ocrResults: [{ url: 'https://furball.nyc/flyer.jpg', text: FURBALL_BOSTON_OCR }],
    pageBrandNames: ['FURBALL'],
    ...overrides
  };
}

test('bar convergence: the real FURBALL Boston segment rescues "Legacy" on all three signals, barSource curated, downstream stamp untouched', () => {
  const parser = createRescueParser(BOSTON_CURATED_BARS);
  const event = { title: 'FURBALL Boston: Bear Week Return', city: 'boston' };
  const logs = captureLogs(() => {
    parser.applyBarConvergenceRescue(event, rescueHtmlData(), {}, RESCUE_CITY_CONFIG);
  });
  assert.equal(event.bar, 'Legacy');
  assert.equal(event.barSource, 'curated');
  assert.deepEqual(event._barRescue, {
    candidate: 'Legacy',
    signals: ['curated', 'page', 'ocr']
  });
  assert.ok(logs.includes(
    '🤖 AI Web: Rescued bar "Legacy" via signal convergence (signals: curated, page, ocr)'
  ), `rescue log expected, got: ${JSON.stringify(logs)}`);

  // The existing barSource stamp is already-stamped-aware: no re-stamp.
  parser.stampBarSourceProvenance(event, parser.buildAiEvidenceContextFromText(FURBALL_BOSTON_SEGMENT), null);
  assert.equal(event.barSource, 'curated');

  // Curated casing wins over the page line's casing.
  const shouting = { title: 'FURBALL Boston: Bear Week Return', city: 'boston' };
  parser.applyBarConvergenceRescue(
    shouting,
    rescueHtmlData({ segmentText: FURBALL_BOSTON_SEGMENT.replace('Legacy', 'LEGACY') }),
    {},
    RESCUE_CITY_CONFIG
  );
  assert.equal(shouting.bar, 'Legacy', 'curated casing adopted');
  assert.equal(shouting.barSource, 'curated');
});

test('bar convergence: layout independence — the venue line BELOW the city line still converges via page + ocr', () => {
  const parser = createRescueParser({});
  const below = [
    'FURBALL Boston',
    'Boston, MA',
    'Legacy',
    'July 25, 2026'
  ].join('\n');
  const event = { title: 'FURBALL Boston: Bear Week Return', city: 'boston' };
  const logs = captureLogs(() => {
    parser.applyBarConvergenceRescue(
      event,
      rescueHtmlData({ segmentText: below, ocrResults: [{ url: 'https://furball.nyc/flyer.jpg', text: 'LEGACY\n79 WARRENTON' }] }),
      {},
      RESCUE_CITY_CONFIG
    );
  });
  assert.equal(event.bar, 'Legacy', 'position is not an anchor — below the city line works too');
  assert.equal(event.barSource, 'page-adjacent');
  assert.deepEqual(event._barRescue.signals, ['page', 'ocr']);
  assert.ok(logs.includes(
    '🤖 AI Web: Rescued bar "Legacy" via signal convergence (signals: page, ocr)'
  ), `rescue log expected, got: ${JSON.stringify(logs)}`);
});

test('bar convergence: layout independence — noise between the venue and the city line no longer breaks the rescue', () => {
  const parser = createRescueParser(BOSTON_CURATED_BARS);
  const noisy = [
    'FURBALL Boston',
    'Legacy',
    '79 Warrenton St',
    '',
    'Boston, MA'
  ].join('\n');
  const event = { title: 'FURBALL Boston: Bear Week Return', city: 'boston' };
  parser.applyBarConvergenceRescue(event, rescueHtmlData({ segmentText: noisy }), {}, RESCUE_CITY_CONFIG);
  assert.equal(event.bar, 'Legacy', 'an address line between venue and city is just noise now');
  assert.equal(event.barSource, 'curated');
});

test('bar convergence: venue only in OCR but curated → adopted (curated + ocr) with curated casing', () => {
  const parser = createRescueParser(BOSTON_CURATED_BARS);
  const noVenueOnPage = [
    'FURBALL Boston',
    'Bear Week Return',
    'Boston, MA',
    'July 25, 2026'
  ].join('\n');
  const event = { title: 'FURBALL Boston: Bear Week Return', city: 'boston' };
  const logs = captureLogs(() => {
    parser.applyBarConvergenceRescue(
      event,
      rescueHtmlData({ segmentText: noVenueOnPage, ocrResults: [{ url: 'https://furball.nyc/flyer.jpg', text: 'LEGACY\n79 WARRENTON' }] }),
      {},
      RESCUE_CITY_CONFIG
    );
  });
  assert.equal(event.bar, 'Legacy', 'flyer-only venues are reachable — curated casing adopted');
  assert.equal(event.barSource, 'curated');
  assert.deepEqual(event._barRescue.signals, ['curated', 'ocr']);
  assert.ok(logs.includes(
    '🤖 AI Web: Rescued bar "Legacy" via signal convergence (signals: curated, ocr)'
  ), `rescue log expected, got: ${JSON.stringify(logs)}`);
});

test('bar convergence: casing variants normalize to ONE candidate with deduped signals', () => {
  const parser = createRescueParser({});
  // "The Legacy" (page) and "LEGACY" (page + OCR) share one bar-name key.
  // If dedup failed, the OCR form alone would qualify and its casing would
  // be adopted; merged, the page's first form wins.
  const segment = [
    'The Legacy',
    'Boston, MA',
    'LEGACY'
  ].join('\n');
  const event = { title: 'FURBALL Boston: Bear Week Return', city: 'boston' };
  parser.applyBarConvergenceRescue(
    event,
    rescueHtmlData({ segmentText: segment, ocrResults: [{ url: 'https://furball.nyc/flyer.jpg', text: 'LEGACY' }] }),
    {},
    RESCUE_CITY_CONFIG
  );
  assert.equal(event.bar, 'The Legacy', 'merged candidate adopts the first page casing');
  assert.deepEqual(event._barRescue.signals, ['page', 'ocr'], 'each signal counted once');
});

test('bar convergence: one signal alone never adopts — page-only, ocr-only, curated-only all log-only', () => {
  // Page only.
  const pageOnly = createRescueParser({});
  const pageEvent = { title: 'FURBALL Boston: Bear Week Return', city: 'boston' };
  const pageLogs = captureLogs(() => {
    pageOnly.applyBarConvergenceRescue(
      pageEvent,
      rescueHtmlData({ segmentText: 'Legacy\nBoston, MA', ocrResults: [] }),
      {},
      RESCUE_CITY_CONFIG
    );
  });
  assert.equal('bar' in pageEvent, false, 'never adopted from the page corpus alone');
  assert.equal('_barRescue' in pageEvent, false);
  assert.ok(pageLogs.includes(
    '🤖 AI Web: Bar rescue candidate "Legacy" carries only one signal (page) — not adopted'
  ), `log-only line expected, got: ${JSON.stringify(pageLogs)}`);

  // OCR only.
  const ocrOnly = createRescueParser({});
  const ocrEvent = { title: 'FURBALL Boston: Bear Week Return', city: 'boston' };
  const ocrLogs = captureLogs(() => {
    ocrOnly.applyBarConvergenceRescue(
      ocrEvent,
      rescueHtmlData({ segmentText: 'Boston, MA\nJuly 25, 2026', ocrResults: [{ url: 'https://furball.nyc/flyer.jpg', text: 'LEGACY' }] }),
      {},
      RESCUE_CITY_CONFIG
    );
  });
  assert.equal('bar' in ocrEvent, false, 'never adopted from the OCR corpus alone');
  assert.ok(ocrLogs.includes(
    '🤖 AI Web: Bar rescue candidate "LEGACY" carries only one signal (ocr) — not adopted'
  ), `log-only line expected, got: ${JSON.stringify(ocrLogs)}`);

  // Curated only — the name appears in NEITHER text corpus: never adopted,
  // and never even named (the page gave no hint of it).
  const curatedOnly = createRescueParser({ boston: [{ name: 'Alley Cat', city: 'boston' }] });
  const curatedEvent = { title: 'FURBALL Boston: Bear Week Return', city: 'boston' };
  const curatedLogs = captureLogs(() => {
    curatedOnly.applyBarConvergenceRescue(
      curatedEvent,
      rescueHtmlData({ segmentText: 'FURBALL Boston\nBoston, MA', ocrResults: [] }),
      {},
      RESCUE_CITY_CONFIG
    );
  });
  assert.equal('bar' in curatedEvent, false, 'a curated name absent from page and OCR is never adopted');
  assert.ok(!curatedLogs.some(line => line.includes('Alley Cat')),
    `an unobserved curated bar is never named, got: ${JSON.stringify(curatedLogs)}`);
  assert.ok(!curatedLogs.some(line => line.includes('Rescued bar')), 'no adoption log');
});

test('bar convergence: two qualifying candidates — the curated one wins', () => {
  const parser = createRescueParser(BOSTON_CURATED_BARS);
  const segment = [
    'Alley Cat',
    'Legacy',
    'Boston, MA'
  ].join('\n');
  const event = { title: 'FURBALL Boston: Bear Week Return', city: 'boston' };
  parser.applyBarConvergenceRescue(
    event,
    rescueHtmlData({ segmentText: segment, ocrResults: [{ url: 'https://furball.nyc/flyer.jpg', text: 'ALLEY CAT\nLEGACY' }] }),
    {},
    RESCUE_CITY_CONFIG
  );
  assert.equal(event.bar, 'Legacy', 'curated signal outranks an equally-corroborated uncurated candidate');
  assert.equal(event.barSource, 'curated');
});

test('bar convergence: two curated candidates — proximity to a location/address line breaks the tie; a true tie refuses', () => {
  const twoCurated = {
    boston: [
      { name: 'Legacy', city: 'boston', address: '79 Warrenton St, Boston, MA 02116' },
      { name: 'Alley Cat', city: 'boston', address: '1 Boylston Pl, Boston, MA 02116' }
    ]
  };
  // Both curated + page (2 signals each): the one nearest the location line wins.
  const parser = createRescueParser(twoCurated);
  const segment = [
    'Alley Cat',
    'Bear Week Return',
    'Legacy',
    'Boston, MA'
  ].join('\n');
  const event = { title: 'FURBALL Boston: Bear Week Return', city: 'boston' };
  parser.applyBarConvergenceRescue(
    event,
    rescueHtmlData({ segmentText: segment, ocrResults: [] }),
    {},
    RESCUE_CITY_CONFIG
  );
  assert.equal(event.bar, 'Legacy', 'fewest lines from the location line — position as tie-breaker only');

  // True tie: both curated + ocr, neither in the page text at all — nothing
  // distinguishes them, so nothing is adopted.
  const tied = createRescueParser(twoCurated);
  const tiedEvent = { title: 'FURBALL Boston: Bear Week Return', city: 'boston' };
  const tiedLogs = captureLogs(() => {
    tied.applyBarConvergenceRescue(
      tiedEvent,
      rescueHtmlData({ segmentText: 'Boston, MA', ocrResults: [{ url: 'https://furball.nyc/flyer.jpg', text: 'LEGACY\nALLEY CAT' }] }),
      {},
      RESCUE_CITY_CONFIG
    );
  });
  assert.equal('bar' in tiedEvent, false, 'a genuine tie adopts nothing');
  assert.equal('_barRescue' in tiedEvent, false);
  assert.ok(tiedLogs.includes(
    '🤖 AI Web: Bar rescue ambiguous between "Legacy" and "Alley Cat" — not adopted'
  ), `ambiguous log expected, got: ${JSON.stringify(tiedLogs)}`);
});

test('bar convergence: the organizer brand is never rescued as the venue — the name filter runs before signals, curated included', () => {
  // Corroboration is deliberately maximal (page + OCR + even a curated
  // record) to prove the organizer guard fires BEFORE any signal counting.
  const parser = createRescueParser({ boston: [{ name: 'Furball', city: 'boston' }] });
  const segment = [
    'Bear Week Return',
    'FURBALL',
    'Boston, MA'
  ].join('\n');
  const event = { title: 'Bear Week Return: A Party', city: 'boston', _organizer: 'FURBALL' };
  const logs = captureLogs(() => {
    parser.applyBarConvergenceRescue(
      event,
      rescueHtmlData({ segmentText: segment, ocrResults: [{ url: 'https://furball.nyc/flyer.jpg', text: 'FURBALL' }] }),
      {},
      RESCUE_CITY_CONFIG
    );
  });
  assert.equal('bar' in event, false, 'the promoter is never rescued as the venue');
  assert.equal('_barRescue' in event, false);
  assert.ok(!logs.some(line => line.includes('Rescued bar')), `no adoption log, got: ${JSON.stringify(logs)}`);
});

test('bar convergence: a model-returned surviving bar makes the rescue a no-op', () => {
  const parser = createRescueParser(BOSTON_CURATED_BARS);
  const event = { title: 'FURBALL Boston: Bear Week Return', city: 'boston', bar: 'Club Cafe' };
  const logs = captureLogs(() => {
    parser.applyBarConvergenceRescue(event, rescueHtmlData(), {}, RESCUE_CITY_CONFIG);
  });
  assert.equal(event.bar, 'Club Cafe', 'a surviving extraction is never second-guessed');
  assert.equal('barSource' in event, false, 'no stamp from the rescue');
  assert.equal('_barRescue' in event, false);
  assert.equal(logs.length, 0, `rescue must be silent, got: ${JSON.stringify(logs)}`);
});

test('bar convergence: single-page events fall back to the page text when no segmentText exists', () => {
  const parser = createRescueParser(BOSTON_CURATED_BARS);
  const html = '<html><head><title>FURBALL</title></head><body>'
    + '<p>FURBALL Boston</p><p>Bear Week Return</p><p>Legacy</p><p>Boston, MA</p><p>July 25, 2026</p>'
    + '</body></html>';
  const event = { title: 'FURBALL Boston: Bear Week Return', city: 'boston' };
  parser.applyBarConvergenceRescue(
    event,
    { url: 'https://furball.nyc/boston', html, ocrResults: [{ url: 'https://furball.nyc/flyer.jpg', text: FURBALL_BOSTON_OCR }] },
    {},
    RESCUE_CITY_CONFIG
  );
  assert.equal(event.bar, 'Legacy');
  assert.equal(event.barSource, 'curated');
});

// ---------------------------------------------------------------------------
// Word-boundary verbatim gate + address-shaped bar drop (run 20260724-115423:
// FURBALL Boston — model bar "79 Warren" with evidence "79 WARRENTON" PASSED
// the gate because "79 Warren" is a PREFIX of the corpus's "79 WARRENTON
// TICKETS: ..."; the surviving garbage bar then correctly blocked the
// convergence rescue from adopting the real venue "Legacy").
// ---------------------------------------------------------------------------

// The incident flyer OCR: the street line runs straight into the ticket text.
const INCIDENT_20260724_OCR = 'FURBALL BOSTON\nBEAR WEEK RETURN\nLEGACY\n79 WARRENTON TICKETS: GAYMAFIABOSTON.COM FURBALL.NYC';

test('verbatim gate word boundaries: a truncated mid-word span is not verbatim', () => {
  const parser = createParser();
  const ctx = text => parser.buildAiEvidenceContextFromText(text);
  const incident = 'LEGACY\nBEFFYBOY\n79 WARRENTON TICKETS: GAYMAFIABOSTON.COM FURBALL.NYC';

  // The incident shape: a copy that stops mid-word is not verbatim.
  assert.equal(parser.hasExactEvidence(ctx(incident), '79 Warren'), false, '"79 Warren" is a prefix of "79 WARRENTON"');
  // Truncation of the corpus word at either end fails.
  assert.equal(parser.hasExactEvidence(ctx('THE WARRENTONS'), 'Warrenton'), false, 'span followed by "S"');
  assert.equal(parser.hasExactEvidence(ctx('79 WARRENTON'), 'RENTON'), false, 'span preceded by "WAR"');
  assert.equal(parser.hasExactEvidence(ctx('790 MAIN'), '79'), false, 'digit runs are words too');

  // Legitimate boundaries keep passing: newline, space, apostrophe, dot,
  // string edges — with the same case-insensitivity as before.
  assert.equal(parser.hasExactEvidence(ctx(incident), 'Legacy'), true, 'newline-bounded ALL-CAPS corpus line');
  assert.equal(parser.hasExactEvidence(ctx('THE WARRENTON'), 'Warrenton'), true, 'whole word matches');
  assert.equal(parser.hasExactEvidence(ctx('Eagle Bar'), 'Eagle'), true, 'space boundary');
  assert.equal(parser.hasExactEvidence(ctx("Legacy's"), 'Legacy'), true, 'apostrophe boundary');
  assert.equal(parser.hasExactEvidence(ctx(incident), 'FURBALL'), true, 'dot boundary');
  assert.equal(parser.hasExactEvidence(ctx('BEAR   WEEK\nRETURN'), 'Bear Week Return'), true, 'whitespace flexibility unchanged');

  // The compact fallback (punctuation/whitespace variants) still passes on
  // boundaries — and must not reopen the truncation hole.
  assert.equal(parser.hasExactEvidence(ctx('ROCKBAR NYC'), 'Rock Bar'), true, 'compact join, bounded span');
  assert.equal(parser.hasExactEvidence(ctx('ROCK BAR'), 'Rockbar'), true, 'compact split, bounded span');
  assert.equal(parser.hasExactEvidence(ctx('79 WARRENTON'), '79-Warren'), false, 'compact path is boundary-checked too');

  // A mid-word first occurrence does not mask a bounded later one.
  assert.equal(parser.hasExactEvidence(ctx('WARRENTON AND WARREN ST'), 'Warren'), true, 'scan continues past mid-word hits');
});

test('verbatim gate: the incident bar "79 Warren" with evidence "79 WARRENTON" now drops', () => {
  const parser = createParser();
  // The real run's evidence string was exactly "79 WARRENTON" (log line
  // ~320 of 20260724-115423).
  const result = runFurballGate(parser, {
    bar: '79 Warren',
    __fieldEvidence: { bar: '79 WARRENTON' }
  });
  assert.equal(result.event.bar, undefined, 'the truncated copy is no longer verbatim');
  assert.deepEqual(result.report.dropped, [{ field: 'bar', key: 'bar', mode: 'exact', value: '79 Warren' }]);
  // The pointer locates, but the derived candidate "79 WARRENTON" is
  // address-shaped and useless FOR THE BAR FIELD — suppressed silently.
  assert.equal(result.report.evidenceRescues, undefined, 'no address-shaped bar candidate is stashed');
});

test('locateEvidenceFragmentSpan: a fragment located mid-word is not located', () => {
  const parser = createParser();
  const corpus = '79 WARRENTON TICKETS: GAYMAFIABOSTON.COM FURBALL.NYC';
  assert.equal(parser.locateEvidenceFragmentSpan('79 WARREN', corpus), null, 'truncated fragment does not locate');
  assert.equal(parser.locateEvidenceFragmentSpan('79 WARRENTON', corpus), '79 WARRENTON', 'whole-word fragment locates');
  // The regex scans past a mid-word hit to a bounded later occurrence.
  assert.equal(parser.locateEvidenceFragmentSpan('WARREN', 'WARRENTON AND WARREN ST'), 'WARREN');
});

test('evidence-pointer rescue: address-shaped BAR candidates are suppressed; address candidates still log', () => {
  const parser = createParser();
  const captured = captureGateLogs();
  let result;
  try {
    result = runFurballGate(parser, {
      bar: '79 Warrenon',
      address: '79 Warrenon',
      __fieldEvidence: {
        bar: '79 WARRENTON TICKETS: GAYMAFIABOSTON.COM FURBALL.NYC',
        address: '79 WARRENTON TICKETS: GAYMAFIABOSTON.COM FURBALL.NYC'
      }
    });
  } finally {
    captured.restore();
  }
  assert.equal(result.event.bar, undefined);
  assert.equal(result.event.address, undefined);
  assert.deepEqual(result.report.evidenceRescues, [
    { field: 'address', candidate: '79 WARRENTON', modelValue: '79 Warrenon', corpus: 'ocr' }
  ], 'only the address entry is stashed — the bar candidate is address-shaped');
  assert.ok(
    captured.lines.some(line => line.includes('Evidence-pointer rescue (log-only) for address')),
    'the address candidate still logs'
  );
  assert.ok(
    !captured.lines.some(line => line.includes('Evidence-pointer rescue (log-only) for bar')),
    'the bar candidate is suppressed silently'
  );
});

test('bar plausibility shapes: leading house number + street-ish continuation, never "contains a digit"', () => {
  const parser = createParser();
  // Address-shaped: dropped.
  assert.equal(parser.isAddressShapedBarValue('79 Warrenton St'), true, 'house number + street-type word');
  assert.equal(parser.isAddressShapedBarValue('79 WARRENTON'), true, 'truncated street line: house number + single bare word');
  assert.equal(parser.isAddressShapedBarValue('10-90 Wyckoff Ave'), true, 'hyphenated Queens-style house number');
  // Venue names that merely contain numbers: kept (owner doctrine — venue
  // names CAN legitimately contain numbers).
  assert.equal(parser.isAddressShapedBarValue('Bar 32'), false, 'trailing number is not a house number');
  assert.equal(parser.isAddressShapedBarValue('Studio 54'), false);
  assert.equal(parser.isAddressShapedBarValue('700 Club'), false, 'leading number + venue-type word stays a name');
  assert.equal(parser.isAddressShapedBarValue('3 Dollar Bill'), false, 'leading number + multi-word name stays a name');
  assert.equal(parser.isAddressShapedBarValue('Legacy'), false);
  assert.equal(parser.isAddressShapedBarValue(''), false);
});

test('bar plausibility gate: an address-shaped bar is dropped with the additive log; numbered venue names keep', () => {
  const parser = createParser();
  const event = { title: 'FURBALL Boston', bar: '79 WARRENTON', city: 'boston' };
  const logs = captureLogs(() => { parser.applyBarPlausibilityGate(event); });
  assert.equal('bar' in event, false, 'the address-shaped bar is cleared');
  assert.ok(
    logs.includes('🤖 AI Web: Dropped implausible bar "79 WARRENTON" (address-shaped)'),
    `expected the new drop line, got: ${JSON.stringify(logs)}`
  );

  const keep = { title: 'Underbear', bar: '700 Club' };
  const keepLogs = captureLogs(() => { parser.applyBarPlausibilityGate(keep); });
  assert.equal(keep.bar, '700 Club', 'numbered venue names are untouched');
  assert.equal(keepLogs.length, 0, 'no log when nothing drops');
});

// ---------------------------------------------------------------------------
// A city/district is not a venue. Run 2026-07-31 (Club Chub) stored bar
// "Downtown Los Angeles" for an event whose own title says "NEW OUTDOOR
// LOCATION" — the venue was genuinely undisclosed — and the same run's CHUNK
// parser stored bar "Brooklyn" and bar "Portland" for events whose real venues
// (C'mon Everybody, Nova PDX) it named correctly elsewhere. Everything is
// driven by the cities config; no new list of place names exists.
// ---------------------------------------------------------------------------
const CITY_GATE_CONFIG = {
  la: { name: 'Los Angeles', calendar: 'chunky-dad-la', patterns: ['los angeles', 'hollywood', 'downtown los angeles', 'dtla'] },
  nyc: { name: 'New York', calendar: 'chunky-dad-nyc', aliases: ['new-york'], patterns: ['new york', 'nyc', 'manhattan', 'brooklyn'] },
  portland: { name: 'Portland', calendar: 'chunky-dad-portland', patterns: ['portland', 'pdx'] },
  'fort-lauderdale': { name: 'Fort Lauderdale', calendar: 'chunky-dad-fort-lauderdale', patterns: ['fort lauderdale', 'wilton manors'] }
};

test('bar plausibility gate: a city/district value is dropped like an address-shaped one', () => {
  const parser = createParser();

  const duro = {
    title: 'D>U>R>O is back NEW OUTDOOR LOCATION _ NIGHT FOAM PARTY',
    bar: 'Downtown Los Angeles',
    address: 'Downtown Los Angeles, Downtown Los Angeles, Los Angeles, CA, USA',
    city: 'la'
  };
  const duroLogs = captureLogs(() => { parser.applyBarPlausibilityGate(duro, CITY_GATE_CONFIG); });
  assert.equal('bar' in duro, false, 'a district that is a configured city pattern is not a venue');
  assert.ok(
    duroLogs.some(line => line.includes('🤖 AI Web: Dropped implausible bar "Downtown Los Angeles" (city name')),
    `expected the city-name drop line, got: ${JSON.stringify(duroLogs)}`
  );

  const brooklyn = { title: 'CHUNK BROOKLYN - The Return!', bar: 'Brooklyn', city: 'nyc' };
  parser.applyBarPlausibilityGate(brooklyn, CITY_GATE_CONFIG);
  assert.equal('bar' in brooklyn, false, 'a borough that is a configured nyc pattern is not a venue');

  const portland = { title: 'The RETURN', bar: 'Portland', city: 'portland' };
  parser.applyBarPlausibilityGate(portland, CITY_GATE_CONFIG);
  assert.equal('bar' in portland, false, "a bar equal to the event's own city is not a venue");

  const wilton = { title: 'Bear Happy Hour', bar: 'Wilton Manors', city: 'fort-lauderdale' };
  parser.applyBarPlausibilityGate(wilton, CITY_GATE_CONFIG);
  assert.equal('bar' in wilton, false, 'a neighborhood pattern is not a venue either');
});

test('bar plausibility gate: place-named real venues survive the city gate (fails open)', () => {
  const parser = createParser();
  // Whole-value equality only — containment would kill every one of these.
  const survivors = [
    ["C'mon Everybody", 'nyc'],
    ['SF Eagle', 'sf'],
    ['Nova PDX', 'portland'],
    ['Brooklyn Bowl', 'nyc'],
    ['New York Bar', 'nyc'],
    ['Downtown Los Angeles Standard', 'la'],
    ['Precinct DTLA', 'la']
  ];
  for (const [bar, city] of survivors) {
    const event = { title: 'x', bar, city };
    parser.applyBarPlausibilityGate(event, CITY_GATE_CONFIG);
    assert.equal(event.bar, bar, `"${bar}" is a venue name and must survive`);
  }
  // No cities config at all → the gate cannot judge, so it must not drop.
  const noConfig = { title: 'x', bar: 'Brooklyn', city: 'nyc' };
  parser.applyBarPlausibilityGate(noConfig, null);
  assert.equal(noConfig.bar, 'Brooklyn', 'no cities config → fail open, never drop');
});

test('address plausibility gate: a doubled leading segment is a failed geocode, not an address', () => {
  const parser = createParser();
  const event = {
    title: 'D>U>R>O is back NEW OUTDOOR LOCATION _ NIGHT FOAM PARTY',
    address: 'Downtown Los Angeles, Downtown Los Angeles, Los Angeles, CA, USA',
    city: 'la'
  };
  const logs = captureLogs(() => { parser.applyAddressPlausibilityGate(event, {}); });
  assert.equal('address' in event, false, 'the echoed district address is dropped');
  assert.ok(
    logs.some(line => line.includes('duplicate leading segment (failed geocode)')),
    `expected the duplicate-segment drop line, got: ${JSON.stringify(logs)}`
  );

  // Fails open with no city: the address is then the only city signal left.
  const noCity = { title: 'x', address: 'Downtown Los Angeles, Downtown Los Angeles, Los Angeles, CA, USA' };
  parser.applyAddressPlausibilityGate(noCity, {});
  assert.equal(noCity.address, 'Downtown Los Angeles, Downtown Los Angeles, Los Angeles, CA, USA',
    'no city on the event → keep the address, it is the only place signal');

  // A real address is untouched.
  const real = { title: 'x', address: '325 Franklin Ave, Brooklyn, NY 11238, USA', city: 'nyc' };
  parser.applyAddressPlausibilityGate(real, {});
  assert.equal(real.address, '325 Franklin Ave, Brooklyn, NY 11238, USA', 'a real address never trips the rule');
});

test('incident 20260724-115423 end-to-end: truncated bar+address drop, bar rescue candidate suppressed, convergence adopts curated "Legacy"', async () => {
  global.EventSchema = EventSchema; // earlier tests leak a mocked schema — pin the real one
  const parser = createRescueParser(BOSTON_CURATED_BARS);
  // The real run shape: model returns bar/address "79 Warren" with evidence
  // "79 WARRENTON"; corpus carries the flyer OCR (street line + LEGACY),
  // the segment text (Legacy above Boston, MA), curated boston bars carry
  // Legacy.
  parser.getAiEvent = async () => ({
    title: 'FURBALL Boston',
    startDate: '2026-07-25',
    city: 'boston',
    bar: '79 Warren',
    address: '79 Warren',
    __fieldEvidence: { bar: '79 WARRENTON', address: '79 WARRENTON' }
  });
  const htmlData = {
    url: 'https://www.furball.nyc',
    html: `${INCIDENT_20260724_OCR}\n\n${FURBALL_BOSTON_SEGMENT}`,
    segmentText: FURBALL_BOSTON_SEGMENT,
    ocrResults: [{ url: 'https://furball.nyc/flyer.jpg', text: INCIDENT_20260724_OCR }],
    pageBrandNames: ['FURBALL']
  };
  let event;
  const warns = [];
  const originalWarn = console.warn;
  console.warn = (message) => { warns.push(String(message)); };
  let logs;
  try {
    logs = await captureLogsAsync(async () => {
      event = await parser.extractSingleEvent(htmlData, {}, RESCUE_CITY_CONFIG, ['title', 'bar', 'address', 'city', 'startDate']);
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(event, 'extraction yields an event');

  // Stage 1: the gate drops BOTH truncated copies (mid-word is not
  // verbatim). The drop summary is a console.warn line.
  assert.ok(
    warns.some(line => line.includes('Dropped 2 field(s) lacking source evidence: bar, address')),
    `gate drop line expected, got: ${JSON.stringify(warns)}`
  );

  // Stage 2: the pointer rescue logs the ADDRESS candidate but never an
  // address-shaped BAR candidate.
  assert.ok(
    logs.some(line => line.includes('Evidence-pointer rescue (log-only) for address: corpus has "79 WARRENTON"')),
    'address candidate is observed'
  );
  assert.ok(
    !logs.some(line => line.includes('Evidence-pointer rescue (log-only) for bar')),
    'bar candidate is suppressed'
  );
  assert.deepEqual(event._evidenceRescues, [
    { field: 'address', candidate: '79 WARRENTON', modelValue: '79 Warren', corpus: 'ocr' }
  ]);

  // Stage 3: with no surviving garbage bar, the convergence rescue adopts
  // the curated venue on all three signals.
  assert.ok(
    logs.some(line => line.includes('Rescued bar "Legacy" via signal convergence')),
    `convergence rescue line expected, got: ${JSON.stringify(logs)}`
  );
  assert.equal(event.bar, 'Legacy');
  assert.equal(event.barSource, 'curated');
  assert.equal(event.address || '', '', 'the address twin stays dropped');
});

test('bar plausibility gate runs BEFORE the convergence rescue: a verbatim address-shaped bar drops and "Legacy" is rescued', async () => {
  global.EventSchema = EventSchema;
  const parser = createRescueParser(BOSTON_CURATED_BARS);
  // Variant: the model copies the street line VERBATIM ("79 WARRENTON"), so
  // the evidence gate keeps it — the deterministic bar plausibility gate is
  // the only guard, and it must fire before the convergence rescue.
  parser.getAiEvent = async () => ({
    title: 'FURBALL Boston',
    startDate: '2026-07-25',
    city: 'boston',
    bar: '79 WARRENTON',
    __fieldEvidence: { bar: '79 WARRENTON' }
  });
  const htmlData = {
    url: 'https://www.furball.nyc',
    html: `${INCIDENT_20260724_OCR}\n\n${FURBALL_BOSTON_SEGMENT}`,
    segmentText: FURBALL_BOSTON_SEGMENT,
    ocrResults: [{ url: 'https://furball.nyc/flyer.jpg', text: INCIDENT_20260724_OCR }],
    pageBrandNames: ['FURBALL']
  };
  let event;
  const logs = await captureLogsAsync(async () => {
    event = await parser.extractSingleEvent(htmlData, {}, RESCUE_CITY_CONFIG, ['title', 'bar', 'city', 'startDate']);
  });
  assert.ok(event, 'extraction yields an event');
  assert.ok(
    logs.includes('🤖 AI Web: Dropped implausible bar "79 WARRENTON" (address-shaped)'),
    `plausibility drop line expected, got: ${JSON.stringify(logs)}`
  );
  assert.ok(
    logs.some(line => line.includes('Rescued bar "Legacy" via signal convergence')),
    'the freed rescue adopts the real venue'
  );
  assert.equal(event.bar, 'Legacy');
  assert.equal(event.barSource, 'curated');
});

// ---------------------------------------------------------------------------
// Run 20260724-122902 root-cause fixes. The full causal chain of the FURBALL
// Boston failure:
//   1. extractBodyParts deduped OCR and page lines against ONE shared seen
//      set, so the prepended flyer OCR ("LEGACY" / "BEAR WEEK RETURN")
//      evicted the page's own "Legacy" / "Bear Week Return" lines — the
//      model never saw the venue in page context.
//   2. The candidate guard leaked FURBALL (brand-stem miss vs "furballnyc")
//      and BOSTON (no city rule), tying the convergence rescue into
//      "ambiguous — not adopted".
//   3. The ticket URL slug (".../bear-week-legacy-tickets") named the venue
//      but was never a signal.
// The fixtures below are the literal corpus from the run log.
// ---------------------------------------------------------------------------

const RUN_122902_OCR = [
  'JOE FIORE RAFAEL SANCHEZ & BOBBY KELLEY PRESENT',
  'FURBALL',
  'BOSTON',
  '10pm-3am',
  'SAT, JULY 25',
  'BEAR WEEK RETURN',
  'UNDER',
  'WEAR & GEAR',
  'PARTY',
  'CLOTHES',
  'CHECK',
  'LEGACY',
  'BEFFYBOY',
  'GAY MAFIA',
  'BEAR SKM',
  'mistr',
  '79 WARRENTON TICKETS: GAYMAFIABOSTON.COM FURBALL.NYC',
  'JOSHUA',
  'RUIZ'
].join('\n');

// The page's own segment lines (segment discovery log, 16:26:48.943).
const RUN_122902_SEGMENT = [
  'FURBALL Boston',
  'Bear Week Return',
  'July 25, 2026',
  'Legacy',
  'Boston, MA',
  'Get Your Tickets Today!'
].join('\n');

const RUN_122902_TICKET_URL = 'https://www.ticketweb.com/event/furball-boston-725-bear-week-legacy-tickets/14269444?REFERRAL_ID=tmfeed';
const RUN_122902_FLYER_URL = 'https://static.wixstatic.com/media/238fae_c4047c55f4534a0990b2b7fdc19dab8f~mv2.png';

// The combined prompt stream exactly as extractSingleEvent builds it for the
// segment: prepended OCR snippet, then the segment htmlData (SEGMENT_INDEX,
// the resource lines' embedded second OCR copy, SEGMENT_LINK_URL, segment
// content).
function buildRun122902CombinedStream() {
  return [
    `OCR_IMAGE_URL: ${RUN_122902_FLYER_URL}`,
    'OCR_IMAGE_TEXT',
    RUN_122902_OCR,
    '',
    'SEGMENT_INDEX: 1/6',
    `OCR_IMAGE_URL: ${RUN_122902_FLYER_URL}`,
    'OCR_IMAGE_TEXT',
    RUN_122902_OCR,
    `SEGMENT_LINK_URL: ${RUN_122902_TICKET_URL}`,
    RUN_122902_SEGMENT
  ].join('\n');
}

test('extractBodyParts: OCR lines never evict page lines — the literal run-122902 stream keeps BOTH copies of the venue', () => {
  const parser = createParser();
  const parts = parser.extractBodyParts(buildRun122902CombinedStream());

  // The regression: the flyer's LEGACY / BEAR WEEK RETURN used to consume
  // the shared seen set and the page's own lines vanished from CONTENT.
  assert.ok(parts.includes('LEGACY'), 'the OCR venue line is present');
  assert.ok(parts.includes('Legacy'), 'the PAGE venue line is present too — OCR must not evict it');
  assert.ok(parts.includes('BEAR WEEK RETURN'), 'the OCR tagline is present');
  assert.ok(parts.includes('Bear Week Return'), 'the PAGE tagline is present too');

  // Intra-corpus dedup still holds: the resource lines embed a second copy
  // of the whole OCR snippet, and it collapses against the prepended one.
  assert.equal(parts.filter(line => line === 'LEGACY').length, 1, 'the embedded second OCR copy dedups');
  assert.equal(parts.filter(line => line === 'FURBALL').length, 1);
  assert.equal(parts.filter(line => line.startsWith('OCR_IMAGE_URL:')).length, 1);
});

test('extractBodyParts: intra-page dedup and the maxBodyParts cap are unchanged', () => {
  const parser = createParser();

  // Intra-page duplicates still collapse (case-insensitively).
  const withPageDupes = `${buildRun122902CombinedStream()}\nGet Your Tickets Today!\nGET YOUR TICKETS TODAY!`;
  const parts = parser.extractBodyParts(withPageDupes);
  assert.equal(
    parts.filter(line => line.toLowerCase() === 'get your tickets today!').length,
    1,
    'repeated page boilerplate still dedups within the page corpus'
  );

  // The cap stays global across both corpora.
  const manyLines = [];
  for (let i = 0; i < parser.extractionLimits.maxBodyParts + 50; i++) {
    manyLines.push(`Unique page line number ${i}`);
  }
  const capped = parser.extractBodyParts(
    `OCR_IMAGE_URL: https://x.example/a.png\nOCR_IMAGE_TEXT\nFLYER LINE\n\n<html><body>${manyLines.map(l => `<p>${l}</p>`).join('')}</body></html>`
  );
  assert.equal(capped.length, parser.extractionLimits.maxBodyParts, 'the cap is enforced across OCR + page');
  assert.equal(capped[0], 'OCR_IMAGE_URL: https://x.example/a.png', 'order is preserved — OCR first');
});

test('extractBodyParts: inputs without OCR markers behave exactly as before (single page corpus)', () => {
  const parser = createParser();
  const html = '<html><body><p>Legacy</p><p>legacy</p><p>Boston, MA</p></body></html>';
  assert.deepEqual(parser.extractBodyParts(html), ['Legacy', 'Boston, MA'],
    'page-vs-page dedup is untouched for plain pages');
});

test('guard matrix on the run-122902 corpus: brand stem, parser name, city, calendar words, and hype words all reject; real venue names pass', () => {
  const parser = createRescueParser({});
  const event = { title: 'FURBALL Boston', city: 'boston' };
  const htmlData = { pageBrandNames: ['furballnyc'] };
  const parserConfig = { name: 'Furball' };

  // The two candidates that tied the real run into refusal.
  assert.equal(
    parser.getVenueLineCandidateRejection('FURBALL', event, htmlData, RESCUE_CITY_CONFIG, parserConfig),
    'matches organizer/brand',
    'brand stem: "furball" is a prefix of "furballnyc" with a <= 4 char remainder'
  );
  assert.equal(
    parser.getVenueLineCandidateRejection('BOSTON', event, htmlData, RESCUE_CITY_CONFIG, parserConfig),
    'city name',
    'a bare configured city is never a venue candidate'
  );
  // The parser's own configured name alone also rejects (no page brands).
  assert.equal(
    parser.getVenueLineCandidateRejection('FURBALL', event, {}, RESCUE_CITY_CONFIG, parserConfig),
    'matches organizer/brand',
    'parserConfig.name joins the known names'
  );
  // event.city equality rejects even without a cityConfig entry.
  assert.equal(
    parser.getVenueLineCandidateRejection('Boston', event, {}, null, null),
    'city name',
    'the event\'s own city is never the venue'
  );

  // Calendar words join the date rejection.
  for (const word of ['SAT', 'FRI', 'SATURDAYS', 'JULY', 'AUG']) {
    assert.equal(
      parser.getVenueLineCandidateRejection(word, event, htmlData, RESCUE_CITY_CONFIG, parserConfig),
      'date',
      `bare calendar word ${word} rejects`
    );
  }

  // Stoplist additions.
  for (const word of ['TONIGHT', 'LIVE', 'PARTY', 'SOLD OUT', 'PRESALE']) {
    assert.equal(
      parser.getVenueLineCandidateRejection(word, event, htmlData, RESCUE_CITY_CONFIG, parserConfig),
      'generic',
      `hype/status word ${word} rejects`
    );
  }

  // Legitimate venue names still pass every guard.
  for (const name of ['Legacy', 'The Eagle', 'SF Eagle', 'Alley Cat', 'Metro']) {
    assert.equal(
      parser.getVenueLineCandidateRejection(name, event, htmlData, RESCUE_CITY_CONFIG, parserConfig),
      '',
      `venue name ${name} must never be a casualty`
    );
  }
});

test('curated-name sweep: every bar name in data/bars/*.json survives the candidate guards (zero new false positives)', () => {
  const fs = require('fs');
  const path = require('path');
  const parser = createRescueParser({});
  const realCityConfig = require('../scraper-cities');
  const barsDir = path.join(__dirname, '..', '..', 'data', 'bars');
  // Neutral context: no page brands, no event city/title — the sweep tests
  // the shape rules (city names, calendar words, stoplist, address shapes)
  // against every curated name with the REAL cities config.
  const rejections = [];
  let total = 0;
  for (const file of fs.readdirSync(barsDir)) {
    if (!file.endsWith('.json')) continue;
    const bars = JSON.parse(fs.readFileSync(path.join(barsDir, file), 'utf8'));
    for (const bar of Array.isArray(bars) ? bars : []) {
      if (!bar || typeof bar.name !== 'string') continue;
      total += 1;
      const rejection = parser.getVenueLineCandidateRejection(bar.name, {}, {}, realCityConfig, {});
      if (rejection) rejections.push(`${file}: ${JSON.stringify(bar.name)} -> ${rejection}`);
    }
  }
  assert.ok(total >= 50, `the sweep saw a real corpus (${total} names)`);
  // Pre-existing exception (predates this PR's rules): "9th Avenue Saloon"
  // trips the address-shape rule. Nothing else may be rejected — if a new
  // rule catches a curated name, narrow the rule, don't drop the name.
  assert.deepEqual(rejections, ['nyc.json: "9th Avenue Saloon" -> address-shaped'],
    `only the known pre-existing exception may reject, got: ${JSON.stringify(rejections)}`);
});

test('bar convergence on the run-122902 corpus with curated data: FURBALL/BOSTON rejected, "Legacy" adopted on curated+page+ocr+url', () => {
  const parser = createRescueParser(BOSTON_CURATED_BARS);
  const event = { title: 'FURBALL Boston', city: 'boston' };
  const logs = captureLogs(() => {
    parser.applyBarConvergenceRescue(
      event,
      {
        url: 'https://www.furball.nyc',
        html: buildRun122902CombinedStream(),
        segmentText: RUN_122902_SEGMENT,
        ocrResults: [{ url: RUN_122902_FLYER_URL, text: RUN_122902_OCR }],
        pageBrandNames: ['furballnyc']
      },
      { name: 'Furball' },
      RESCUE_CITY_CONFIG
    );
  });
  assert.equal(event.bar, 'Legacy', 'the real corpus now rescues the venue');
  assert.equal(event.barSource, 'curated');
  assert.deepEqual(event._barRescue.signals, ['curated', 'page', 'ocr', 'url']);
  assert.ok(!logs.some(line => line.includes('ambiguous')),
    `no ambiguity refusal any more, got: ${JSON.stringify(logs)}`);
});

test('bar convergence url slug signal: with curated data absent and the venue missing from the page, ocr + url still adopt "Legacy"', () => {
  // The stale-bars-wiring belt-and-braces case: curated corpus empty (the
  // remote refresh served a stale list) AND the page text degraded to the
  // deployed run's CONTENT (venue line evicted). The flyer OCR and the
  // ticket-URL slug both name the venue: 2 independent signals.
  const parser = createRescueParser({});
  const degradedSegment = [
    'FURBALL Boston',
    'July 25, 2026',
    'Boston, MA',
    'Get Your Tickets Today!',
    'UPCOMING EVENTS!'
  ].join('\n');
  const event = { title: 'FURBALL Boston', city: 'boston' };
  const logs = captureLogs(() => {
    parser.applyBarConvergenceRescue(
      event,
      {
        url: 'https://www.furball.nyc',
        html: `SEGMENT_INDEX: 1/6\nSEGMENT_LINK_URL: ${RUN_122902_TICKET_URL}\n${degradedSegment}`,
        segmentText: degradedSegment,
        ocrResults: [{ url: RUN_122902_FLYER_URL, text: RUN_122902_OCR }],
        pageBrandNames: ['furballnyc']
      },
      { name: 'Furball' },
      RESCUE_CITY_CONFIG
    );
  });
  assert.equal(event.bar, 'LEGACY', 'adopted with the OCR casing — no curated or page form exists');
  assert.equal(event.barSource, 'page-adjacent');
  assert.deepEqual(event._barRescue.signals, ['ocr', 'url']);
  assert.ok(logs.includes(
    '🤖 AI Web: Rescued bar "LEGACY" via signal convergence (signals: ocr, url)'
  ), `rescue log expected, got: ${JSON.stringify(logs)}`);
});

test('bar convergence url slug signal: adjacent slug tokens join ("bear week" -> "bearweek"); the event ticketUrl is a slug source too', () => {
  const parser = createRescueParser({});
  assert.ok(parser.buildUrlSlugTokens(RUN_122902_TICKET_URL).includes('legacy'), 'single token');
  assert.ok(parser.buildUrlSlugTokens(RUN_122902_TICKET_URL).includes('bearweek'), 'joined adjacent pair');
  assert.ok(!parser.buildUrlSlugTokens('https://x.example').length, 'no path, no tokens');

  // ticketUrl (no SEGMENT_LINK_URL line) also feeds the slug signal.
  const event = {
    title: 'FURBALL Boston',
    city: 'boston',
    ticketUrl: RUN_122902_TICKET_URL
  };
  parser.applyBarConvergenceRescue(
    event,
    {
      url: 'https://www.furball.nyc',
      html: '<html><body>multi-event page</body></html>',
      segmentText: 'FURBALL Boston\nJuly 25, 2026\nBoston, MA',
      ocrResults: [{ url: RUN_122902_FLYER_URL, text: RUN_122902_OCR }],
      pageBrandNames: ['furballnyc']
    },
    { name: 'Furball' },
    RESCUE_CITY_CONFIG
  );
  assert.equal(event.bar, 'LEGACY');
  assert.deepEqual(event._barRescue.signals, ['ocr', 'url']);
});

test('getFieldContext bar steering: the address-shape sentence is appended, existing schema text unchanged', () => {
  const parser = createParser();
  const context = parser.getFieldContext('bar', null);
  assert.ok(context.endsWith(' A street address is never a venue name.'),
    `the steering sentence is appended, got: ${JSON.stringify(context)}`);
  const schemaText = parser.getEventSchemaPromptFieldDescription('bar');
  assert.ok(context.startsWith(schemaText), 'the schema description itself stays byte-identical');
});

test('getFieldContext title steering: the caption-vs-name sentences are appended, existing schema text unchanged, other fields unaffected', () => {
  const parser = createParser();
  const steering = ` The title is the event's NAME — short and reusable, exactly as it appears in the source. When the source text is an announcement sentence or caption that contains the event name, extract just the name portion (it must still appear verbatim within the source). Never include venue, city, date, or marketing phrases in the title — but the organizer/promoter brand IS part of the name: when the source headline leads with it, keep it.`;
  const context = parser.getFieldContext('title', null);
  assert.ok(context.endsWith(steering),
    `the title steering is appended, got: ${JSON.stringify(context)}`);
  const schemaText = parser.getEventSchemaPromptFieldDescription('title');
  assert.ok(context.startsWith(schemaText), 'the schema description itself stays byte-identical');
  // Other fields never pick up the title steering.
  for (const field of ['bar', 'description', 'city', 'startDate', 'shortName']) {
    assert.ok(!parser.getFieldContext(field, null).includes("The title is the event's NAME"),
      `${field} context is unaffected by title steering`);
  }
});

test('confidence-retry feedback: buildRetryDropFeedback returns plain not-verbatim drops only', () => {
  const parser = createParser();
  const merged = {
    __droppedFieldValues: {
      bar: '79 Warrenon',
      city: 'new york',
      endTime: '   '
    },
    __droppedFieldReasons: {
      bar: '',                          // plain not-verbatim → feedback
      city: 'brand-cited-evidence',     // evidence-quality → never echoed
      endTime: ''                       // blank value → nothing to echo
    }
  };
  assert.deepEqual(
    parser.buildRetryDropFeedback(['bar', 'city', 'endTime'], merged),
    { bar: '79 Warrenon' }
  );
  assert.equal(parser.buildRetryDropFeedback(['city'], merged), null, 'tagged-only fields yield no feedback');
  assert.equal(parser.buildRetryDropFeedback(['bar'], {}), null, 'no memo, no feedback');
  // Field-name matching is normalization-aware (retry passes use lowercased
  // names like "starttime").
  assert.deepEqual(
    parser.buildRetryDropFeedback(['BAR'], merged),
    { bar: '79 Warrenon' }
  );
});

test('confidence-retry feedback: the correction line appears in the alternate prompt only when feedback rides in', () => {
  const parser = createParser();
  const feedback = { bar: '79 Warrenon' };
  const expectedLine = 'Your previous value "79 Warrenon" for bar was rejected — it is not verbatim in the source. Copy the exact text.';

  const withFeedback = parser.buildExtractionPrompt(null, {}, null, {}, ['bar'], 'SNIPPET', 'alternate', {}, feedback);
  assert.ok(withFeedback.includes(expectedLine), 'the alternate retry prompt carries the correction line');

  const withoutFeedback = parser.buildExtractionPrompt(null, {}, null, {}, ['bar'], 'SNIPPET', 'alternate', {});
  assert.ok(!withoutFeedback.includes('was rejected'), 'no feedback, no line');
  assert.equal(
    withFeedback.replace(`${expectedLine}\n\n`, ''),
    withoutFeedback,
    'the correction block is purely additive — removing it restores the existing prompt byte-for-byte'
  );

  // The default template never carries it (feedback only flows on retries,
  // which always use the alternate variant).
  const defaultVariant = parser.buildExtractionPrompt(null, {}, null, {}, ['bar'], 'SNIPPET', 'default', {}, feedback);
  assert.ok(!defaultVariant.includes('was rejected'), 'default template is untouched');
});

test('confidence-retry feedback: dropped-reason memos accumulate first-drop-wins and merge like the value memos', () => {
  const parser = createParser();
  const merged = parser.mergeAiEventFields(
    { __droppedFieldValues: { bar: 'first' }, __droppedFieldReasons: { bar: '' } },
    { __droppedFieldValues: { bar: 'second', city: 'x' }, __droppedFieldReasons: { bar: 'context-cited-evidence', city: '' } }
  );
  assert.deepEqual(merged.__droppedFieldValues, { bar: 'first', city: 'x' }, 'earlier value wins');
  assert.deepEqual(merged.__droppedFieldReasons, { bar: '', city: '' }, 'the reason follows its value');
});

// ---------------------------------------------------------------------------
// Crawl hygiene fixes from phone run 20260724-161423 (massive.club, ai-web)
// ---------------------------------------------------------------------------

test('extractUrlCandidatesFromRawHtml stops candidates at entity-encoded attribute boundaries', () => {
  const parser = createParser();
  // Literal shape from the run: the Get Directions anchor lives inside an
  // entity-encoded attribute, so the raw scan used to bleed past &quot; into
  // the following attribute and tag text.
  const html = '<div data-widget="&lt;a href=&quot;https://www.google.com/maps/dir/?api=1&amp;destination=619+E+Pine+St%2C+Seattle%2C+WA+98122&quot; target=&quot;_blank&quot;&gt;Get Directions&lt;/a&gt;"></div>';
  const candidates = parser.extractUrlCandidatesFromRawHtml(html);
  assert.ok(candidates.length > 0, 'the URL is still discovered');
  for (const candidate of candidates) {
    const text = String(candidate.url || candidate);
    assert.ok(!text.includes('"'), `candidate must stop at quotes: ${text}`);
    assert.ok(!/target=/.test(text), `candidate must not bleed into the next attribute: ${text}`);
    assert.ok(!/Get Directions/.test(text), `candidate must not swallow tag text: ${text}`);
    assert.ok(!/&quot;|&gt;|&lt;/i.test(text), `candidate must stop at encoded delimiters: ${text}`);
  }
  assert.ok(
    candidates.includes('https://www.google.com/maps/dir/?api=1&amp;destination=619+E+Pine+St%2C+Seattle%2C+WA+98122'),
    `clean candidate expected (with &amp; still encoded — normalizeUrl decodes it exactly once), got: ${JSON.stringify(candidates)}`
  );
});

test('entity-mangled image candidates can no longer hide their extension from the static-asset filter', () => {
  // Production wiring: the parser normalizes through SharedCore.normalizeUrl
  const core = new SharedCore({}, { eventSchema: EventSchema });
  const parser = new AiWebParser({ normalizeUrl: core.normalizeUrl.bind(core) });
  parser.core = core;
  // Literal .webp/.avif URLs from the run, embedded behind &quot; boundaries
  // the way Webflow's JSON blobs carry them. Before the fix the candidate kept
  // a trailing quote ("….webp\"") so validateEventUrl's extension check missed.
  const html = [
    '<script>{"gallery":[',
    '&quot;https://cdn.prod.website-files.com/659447a9dbb86fcea688b307/675a7570f4832bc60bb6ddb2_image-0004.webp&quot;,',
    '&quot;https://cdn.prod.website-files.com/659447a9dbb86fcea688b307/6765bd9509d17cbbf6cc31d5_massive-0016.avif&quot;',
    ']}</script>'
  ].join('');
  const links = parser.extractAdditionalUrls(html, 'https://www.massive.club/news', {});
  assert.deepEqual(links.slice(), [], `no CDN asset may survive discovery, got: ${JSON.stringify(links.slice())}`);
});

test('validateEventUrl rejects .avif assets (literal URL fetched as a crawl page in the run)', () => {
  const parser = createParser();
  const result = parser.validateEventUrl(
    'https://cdn.prod.website-files.com/659447a9dbb86fcea688b307/6765bd9509d17cbbf6cc31d5_massive-0016.avif',
    'https://www.massive.club/news'
  );
  assert.deepEqual(result, { valid: false, reason: 'static-asset-extension' });
});

test('getUrlDedupeKey fallback (no URL global, as on iOS JavaScriptCore) still merges www and bare-host variants', () => {
  const parser = createParser();
  const originalUrl = global.URL;
  delete global.URL;
  try {
    assert.equal(
      parser.getUrlDedupeKey('https://www.massive.club/monthly-events'),
      parser.getUrlDedupeKey('https://massive.club/monthly-events')
    );
    assert.notEqual(
      parser.getUrlDedupeKey('https://massive.club/monthly-events'),
      parser.getUrlDedupeKey('https://massive.club/calendar')
    );
  } finally {
    global.URL = originalUrl;
  }
});

test('decodeBasicEntities decodes numeric and hex entities and common named typography, exactly once', () => {
  const parser = createParser();
  // Literal title that shipped with a raw entity in the run
  assert.equal(
    parser.decodeBasicEntities('It&#8217;s PET NIGHT at the Dallas Eagle!'),
    'It’s PET NIGHT at the Dallas Eagle!'
  );
  assert.equal(parser.decodeBasicEntities('Womxn&#8217;s Night'), 'Womxn’s Night');
  assert.equal(parser.decodeBasicEntities('It&#x2019;s time'), 'It’s time');
  assert.equal(parser.decodeBasicEntities('Doors 9PM&#8211;2AM &mdash; free before 10'), 'Doors 9PM–2AM — free before 10');
  assert.equal(parser.decodeBasicEntities('&ldquo;BRUT&rdquo; &hellip;'), '“BRUT” …');
  // &amp; (and its numeric forms) stay encoded at this layer — URL-candidate
  // scanning depends on it; normalizeUrl decodes it exactly once downstream.
  assert.equal(parser.decodeBasicEntities('Rock &amp; Roll'), 'Rock &amp; Roll');
  assert.equal(parser.decodeBasicEntities('Rock &#38; Roll'), 'Rock &#38; Roll');
  // Invalid references are left untouched rather than corrupted
  assert.equal(parser.decodeBasicEntities('bad &#xD800; ref'), 'bad &#xD800; ref');
  assert.equal(parser.decodeBasicEntities('bad &#99999999; ref'), 'bad &#99999999; ref');
});

test('numeric entities are decoded in the corpus BEFORE the verbatim evidence gate, symmetrically with the prompt', () => {
  const parser = createParser();
  const html = '<html><head><title>Dallas Eagle Events</title></head><body><p>It&#8217;s PET NIGHT at the Dallas Eagle! Get ready to unleash your inner pup.</p></body></html>';

  // The prompt payload (extractBodyParts → sections) carries the decoded line…
  const bodyLines = parser.extractBodyParts(html);
  assert.ok(
    bodyLines.some(line => line.includes('It’s PET NIGHT at the Dallas Eagle!')),
    `decoded line expected in body parts, got: ${JSON.stringify(bodyLines)}`
  );
  assert.ok(!bodyLines.some(line => line.includes('&#8217;')), 'no raw numeric entity survives into the prompt corpus');

  // …and the evidence corpus is built from the SAME decoded sections, so a
  // model value copied verbatim from the decoded prompt passes the gate.
  const evidenceContext = parser.buildAiEvidenceContext({ html }, {});
  assert.ok(evidenceContext.raw.includes('It’s PET NIGHT at the Dallas Eagle!'), 'evidence corpus sees the decoded text');
  assert.equal(parser.hasExactEvidence(evidenceContext, 'It’s PET NIGHT at the Dallas Eagle!'), true, 'decoded title is verbatim in the corpus');
});

// ---------------------------------------------------------------------------
// Venue-site address consensus (run 20260724-161423: massive.club shipped
// city "unknown" events while its footer's Get-Directions link carried the
// bar's address on every page)
// ---------------------------------------------------------------------------

const MASSIVE_DIRECTIONS_URL = 'https://www.google.com/maps/dir/?api=1&destination=619+E+Pine+St%2C+Seattle%2C+WA+98122';
const MASSIVE_FOOTER_HTML = `<html><body><footer><a href="https://www.google.com/maps/dir/?api=1&amp;destination=619+E+Pine+St%2C+Seattle%2C+WA+98122">Get Directions</a></footer></body></html>`;
const SEATTLE_CITY_CONFIG = { seattle: { timezone: 'America/Los_Angeles', patterns: ['seattle'] } };

test('extractMapsDirectionsAddresses harvests the literal massive.club directions link (raw and entity-encoded)', () => {
  const parser = createParser();

  // Raw URL, exactly as the run log showed it.
  assert.deepEqual(
    parser.extractMapsDirectionsAddresses(`<a href="${MASSIVE_DIRECTIONS_URL}">Get Directions</a>`),
    ['619 E Pine St, Seattle, WA 98122']
  );

  // The &amp;-entity-encoded form as it appears in raw HTML attributes.
  assert.deepEqual(
    parser.extractMapsDirectionsAddresses(MASSIVE_FOOTER_HTML),
    ['619 E Pine St, Seattle, WA 98122']
  );

  // Google daddr= and Apple Maps address=/q= forms are harvested too.
  assert.deepEqual(
    parser.extractMapsDirectionsAddresses('<a href="https://maps.google.com/?daddr=619+E+Pine+St%2C+Seattle%2C+WA+98122">x</a>'),
    ['619 E Pine St, Seattle, WA 98122']
  );
  assert.deepEqual(
    parser.extractMapsDirectionsAddresses('<a href="https://maps.apple.com/?address=619+E+Pine+St%2C+Seattle%2C+WA+98122">x</a>'),
    ['619 E Pine St, Seattle, WA 98122']
  );

  // Fail closed: a venue NAME in q= is not address-shaped and never harvested,
  // and non-map links contribute nothing.
  assert.deepEqual(parser.extractMapsDirectionsAddresses('<a href="https://maps.apple.com/?q=Massive+Seattle">x</a>'), []);
  assert.deepEqual(parser.extractMapsDirectionsAddresses('<a href="https://massive.club/events?destination=619+E+Pine+St">x</a>'), []);

  // A numeric character reference in the query carries a '#' that must not be
  // read as the URL fragment. Dice's real Horizon link truncated to the
  // address "214 King" — still address-shaped, so the gate passed the
  // fragment through to the venue-site consensus.
  assert.deepEqual(
    parser.extractMapsDirectionsAddresses(
      '<a href="https://maps.google.com/?daddr=214%20King&#x27;s%20Road%2C%20Brighton%2C%20BN1%201NB">x</a>'
    ),
    ["214 King's Road, Brighton, BN1 1NB"]
  );
});

test('venue-site consensus: the same footer address on 3 pages establishes consensus and fills blanks only', () => {
  const parser = createParser();
  const pages = [
    'https://massive.club/',
    'https://massive.club/events',
    'https://www.massive.club/events/underbear' // www variant is the SAME registrable site
  ];
  for (const url of pages) {
    parser.harvestVenueSiteAddresses({ url, html: MASSIVE_FOOTER_HTML });
  }

  const blankEvent = { title: 'UNDERBEAR', _venueSitePageHost: 'massive.club' };
  const otherVenueEvent = {
    title: 'BEARRACUDA AT NEIGHBOURS',
    address: '1509 Broadway, Seattle, WA 98122',
    city: 'seattle',
    _venueSitePageHost: 'massive.club'
  };
  const cityKeptEvent = { title: 'DODGEBALL', city: 'portland', _venueSitePageHost: 'massive.club' };
  const otherSiteEvent = { title: 'FURBALL', _venueSitePageHost: 'furball.example' };
  const events = [blankEvent, otherVenueEvent, cityKeptEvent, otherSiteEvent];

  const logs = captureLogs(() => {
    parser.applyVenueSiteAddressConsensus(events, SEATTLE_CITY_CONFIG);
  });

  assert.ok(logs.includes(
    '🤖 AI Web: Venue-site address consensus for massive.club: "619 E Pine St, Seattle, WA 98122" (3 page(s))'
  ), `consensus log expected, got: ${JSON.stringify(logs)}`);

  // Blank address + city → both filled, provenance stamped 'venue-site'.
  assert.equal(blankEvent.address, '619 E Pine St, Seattle, WA 98122');
  assert.equal(blankEvent.addressSource, 'venue-site');
  assert.equal(blankEvent.city, 'seattle');
  assert.ok(logs.includes('🤖 AI Web: Filled address from venue-site consensus for "UNDERBEAR"'));
  assert.ok(logs.includes('🤖 AI Web: Filled city "seattle" from venue-site consensus for "UNDERBEAR"'));

  // Multi-venue safety: a DIFFERENT address is never relocated.
  assert.equal(otherVenueEvent.address, '1509 Broadway, Seattle, WA 98122');
  assert.equal(otherVenueEvent.addressSource, undefined);

  // An existing city is never overwritten (fill blanks / "unknown" only).
  assert.equal(cityKeptEvent.city, 'portland');

  // Events from a different site are untouched.
  assert.equal(otherSiteEvent.address, undefined);

  // Per-run scope: the harvest was consumed; a second apply derives nothing.
  const secondLogs = captureLogs(() => {
    parser.applyVenueSiteAddressConsensus([{ title: 'X', _venueSitePageHost: 'massive.club' }], SEATTLE_CITY_CONFIG);
  });
  assert.deepEqual(secondLogs, []);
});

test('venue-site consensus: city "unknown" is treated as blank and re-derived', () => {
  const parser = createParser();
  parser.harvestVenueSiteAddresses({ url: 'https://massive.club/', html: MASSIVE_FOOTER_HTML });
  const event = { title: 'UNDERBEAR', city: 'unknown', _venueSitePageHost: 'massive.club' };
  captureLogs(() => parser.applyVenueSiteAddressConsensus([event], SEATTLE_CITY_CONFIG));
  assert.equal(event.city, 'seattle');
  assert.equal(event.address, '619 E Pine St, Seattle, WA 98122');
});

test('venue-site consensus: address text resolving to no configured city fills address but leaves city alone', () => {
  const parser = createParser();
  parser.harvestVenueSiteAddresses({ url: 'https://massive.club/', html: MASSIVE_FOOTER_HTML });
  const event = { title: 'UNDERBEAR', _venueSitePageHost: 'massive.club' };
  captureLogs(() => parser.applyVenueSiteAddressConsensus(
    [event], { portland: { timezone: 'America/Los_Angeles', patterns: ['portland'] } }));
  assert.equal(event.address, '619 E Pine St, Seattle, WA 98122');
  assert.equal(event.city, undefined);
});

test('venue-site consensus: two DISTINCT addresses on one site → no consensus, one log line, nothing derived', () => {
  const parser = createParser();
  parser.harvestVenueSiteAddresses({ url: 'https://massive.club/', html: MASSIVE_FOOTER_HTML });
  parser.harvestVenueSiteAddresses({
    url: 'https://massive.club/other',
    html: '<a href="https://www.google.com/maps/dir/?api=1&amp;destination=1122+E+Pike+St%2C+Seattle%2C+WA+98122">Directions</a>'
  });
  const event = { title: 'UNDERBEAR', _venueSitePageHost: 'massive.club' };
  const logs = captureLogs(() => parser.applyVenueSiteAddressConsensus([event], SEATTLE_CITY_CONFIG));
  assert.ok(logs.includes(
    '🤖 AI Web: No venue-site address consensus for massive.club: 2 distinct addresses observed'
  ), `no-consensus log expected, got: ${JSON.stringify(logs)}`);
  assert.equal(event.address, undefined);
  assert.equal(event.city, undefined);
  assert.equal(event.addressSource, undefined);
});

test('venue-site consensus: abbreviation variants of ONE address still converge (St vs Street)', () => {
  const parser = createParser();
  parser.harvestVenueSiteAddresses({ url: 'https://massive.club/', html: MASSIVE_FOOTER_HTML });
  parser.harvestVenueSiteAddresses({
    url: 'https://massive.club/contact',
    html: '<a href="https://www.google.com/maps/dir/?api=1&amp;destination=619+E+Pine+Street%2C+Seattle%2C+WA+98122">Directions</a>'
  });
  const event = { title: 'UNDERBEAR', _venueSitePageHost: 'massive.club' };
  const logs = captureLogs(() => parser.applyVenueSiteAddressConsensus([event], SEATTLE_CITY_CONFIG));
  assert.ok(logs.some(line => line.startsWith('🤖 AI Web: Venue-site address consensus for massive.club:')),
    `consensus expected despite St/Street spelling, got: ${JSON.stringify(logs)}`);
  assert.equal(event.addressSource, 'venue-site');
});

test('venue-site consensus: siteRole "organizer" parser config blocks the site — nothing derived', () => {
  const parser = createParser();
  const htmlData = { url: 'https://massive.club/', html: MASSIVE_FOOTER_HTML };
  parser.resolvePageSiteRole(htmlData, { siteRole: 'organizer' });
  parser.harvestVenueSiteAddresses(htmlData);
  const event = { title: 'UNDERBEAR', _venueSitePageHost: 'massive.club' };
  const logs = captureLogs(() => parser.applyVenueSiteAddressConsensus([event], SEATTLE_CITY_CONFIG));
  assert.deepEqual(logs, [], 'organizer sites derive nothing, silently');
  assert.equal(event.address, undefined);
  assert.equal(event.city, undefined);
});

test('venue-site consensus: siteRole "venue" config alone is not enough — consensus still needs a harvested address', () => {
  const parser = createParser();
  const htmlData = { url: 'https://massive.club/', html: '<html><body>No directions link here</body></html>' };
  parser.resolvePageSiteRole(htmlData, { siteRole: 'venue' });
  parser.harvestVenueSiteAddresses(htmlData);
  const event = { title: 'UNDERBEAR', _venueSitePageHost: 'massive.club' };
  const logs = captureLogs(() => parser.applyVenueSiteAddressConsensus([event], SEATTLE_CITY_CONFIG));
  assert.deepEqual(logs, []);
  assert.equal(event.address, undefined);
});

test('parseEvents harvests the footer link and tags produced events with the page host', async () => {
  const parser = createParser();
  // JSON-LD path: deterministic, no AI calls needed.
  const html = `
    <html><body>
      <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Event","name":"UNDERBEAR",
       "startDate":"2099-07-25T21:00:00-07:00",
       "location":{"@type":"Place","name":"Massive"}}
      </script>
      <footer><a href="https://www.google.com/maps/dir/?api=1&amp;destination=619+E+Pine+St%2C+Seattle%2C+WA+98122">Get Directions</a></footer>
    </body></html>`;
  const result = await parser.parseEvents(
    { url: 'https://massive.club/events/underbear', html },
    {}, SEATTLE_CITY_CONFIG, 'single-event-page', null);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]._venueSitePageHost, 'massive.club');
  const harvest = parser.venueSiteHarvest['massive.club'];
  assert.ok(harvest, 'harvest entry recorded for the registrable host');
  const keys = Object.keys(harvest.addresses);
  assert.equal(keys.length, 1);
  assert.equal(harvest.addresses[keys[0]].display, '619 E Pine St, Seattle, WA 98122');

  // The end-of-run apply then fills the blanks on that event.
  const logs = captureLogs(() => parser.applyVenueSiteAddressConsensus(result.events, SEATTLE_CITY_CONFIG));
  assert.equal(result.events[0].address, '619 E Pine St, Seattle, WA 98122');
  assert.equal(result.events[0].addressSource, 'venue-site');
  assert.equal(result.events[0].city, 'seattle');
  assert.ok(logs.includes('🤖 AI Web: Venue-site address consensus for massive.club: "619 E Pine St, Seattle, WA 98122" (1 page(s))'));
});

// ---------------------------------------------------------------------------
// End-marker misattribution (run 20260724-155934, Dallas Eagle):
// thedallaseagle.com listings print "End at: August 1, 2026 - 2:00 am" and
// the extraction model repeatedly assigned those END values to START fields
// (events shipped starting at the 2:00 AM closing time, plus zero-duration
// start==end pairs). The values below are the LITERAL model outputs from the
// run log.
// ---------------------------------------------------------------------------

const DALLAS_EAGLE_SEGMENT = 'SEGMENT_INDEX: 1/4\nGEAR NIGHT\nJul 25 2026\nEnd at: August 1, 2026 - 2:00 am\nEnd at: July 26, 2026 - 2:00 am\nThe Dallas Eagle';

test('end-marker gate: startdate+starttime citing an "End at" line are reassigned to the empty end fields', () => {
  const parser = createParser();
  const evidenceContext = parser.buildAiEvidenceContextFromText(DALLAS_EAGLE_SEGMENT);
  const validationContext = { imageEvidenceUrls: new Set() };

  const result = parser.validateAiEventEvidence(
    {
      title: 'GEAR NIGHT',
      startdate: '2026-08-01',
      starttime: '02:00',
      __fieldEvidence: {
        startdate: 'End at: August 1, 2026 - 2:00 am (interpreted as event end date; start date not explicitly given, but assumed same day per typical single-night events)',
        starttime: 'End at: August 1, 2026 - 2:00 am (interpreted as end time; start time not explicitly given)'
      }
    },
    { html: DALLAS_EAGLE_SEGMENT }, {}, null,
    { evidenceContext, validationContext }
  );

  assert.equal(result.event.startdate, undefined, 'the misattributed start date must not stay a start');
  assert.equal(result.event.starttime, undefined, 'the misattributed start time must not stay a start');
  assert.equal(result.event.endDate, '2026-08-01', 'the value moves to the empty endDate (reassign, not discard)');
  assert.equal(result.event.endTime, '02:00', 'the value moves to the empty endTime (reassign, not discard)');
  assert.equal(result.event.title, 'GEAR NIGHT', 'the event itself survives');
  const droppedReasons = result.report.dropped
    .filter(entry => entry.field === 'startdate' || entry.field === 'starttime')
    .map(entry => entry.reason);
  assert.deepEqual(droppedReasons, ['end-marker-cited-evidence', 'end-marker-cited-evidence'],
    'both drops carry the new rejection-class reason');
});

test('end-marker gate: startTime 02:00 with endTime 02:00 from the same End-at line no longer forms a zero-duration pair (GEAR NIGHT)', () => {
  const parser = createParser();
  const evidenceContext = parser.buildAiEvidenceContextFromText(DALLAS_EAGLE_SEGMENT);
  const validationContext = { imageEvidenceUrls: new Set() };

  const result = parser.validateAiEventEvidence(
    {
      title: 'GEAR NIGHT',
      startTime: '02:00',
      endTime: '02:00',
      __fieldEvidence: {
        startTime: 'End at: July 26, 2026 - 2:00 am',
        endTime: 'End at: July 26, 2026 - 2:00 am'
      }
    },
    { html: DALLAS_EAGLE_SEGMENT }, {}, null,
    { evidenceContext, validationContext }
  );

  assert.equal(result.event.startTime, undefined, 'the end-marker-cited start copy is dropped');
  assert.equal(result.event.endTime, '02:00', 'the legitimate endTime is untouched');
  assert.ok(!Object.keys(result.event).some(key => /^start/i.test(key)),
    'no start field remains, so the merge-time zero-duration pair (startTime === endTime) can never form');
});

test('end-marker gate: genuine start evidence ("8:00 PM") is untouched, range evidence with a leading time fails open', () => {
  const parser = createParser();
  const source = 'BEAR NIGHT Doors 8:00 PM until 2am MEGAWOOF 9PM TIL LATE';
  const evidenceContext = parser.buildAiEvidenceContextFromText(source);
  const validationContext = { imageEvidenceUrls: new Set() };

  // Literal correct-behavior output from the same run: a real start exists.
  const genuine = parser.validateAiEventEvidence(
    { starttime: '20:00', __fieldEvidence: { starttime: '8:00 PM' } },
    { html: source }, {}, null, { evidenceContext, validationContext }
  );
  assert.equal(genuine.event.starttime, '20:00', 'a genuinely evidenced start survives');

  // A range whose evidence leads with the start time is not an end-marker citation.
  const range = parser.validateAiEventEvidence(
    { startTime: '21:00', __fieldEvidence: { startTime: '9PM TIL LATE' } },
    { html: source }, {}, null, { evidenceContext, validationContext }
  );
  assert.equal(range.event.startTime, '21:00', 'a time stated before the marker fails open (the value may be the start)');
});

test('end-marker detection: "until 2am" and "doors close at 2" variants are detected, start-side signals are not', () => {
  const parser = createParser();
  // Literal run evidence strings.
  assert.ok(parser.evidenceCitesEndMarker('End at: August 1, 2026 - 2:00 am (interpreted as event end date; start date not explicitly given, but assumed same day per typical single-night events)'));
  assert.ok(parser.evidenceCitesEndMarker('End at: August 1, 2026 - 2:00 am (interpreted as end time; start time not explicitly given)'));
  assert.ok(parser.evidenceCitesEndMarker('End at: July 26, 2026 - 2:00 am'));
  // Required variants.
  assert.ok(parser.evidenceCitesEndMarker('until 2am'));
  assert.ok(parser.evidenceCitesEndMarker('doors close at 2'));
  assert.ok(parser.evidenceCitesEndMarker('closes at 2am'));
  assert.ok(parser.evidenceCitesEndMarker('Ends: 2am'));
  assert.ok(parser.evidenceCitesEndMarker('ends by 2:00 am'));
  // Start-side signals fail open.
  assert.ok(!parser.evidenceCitesEndMarker('8:00 PM'));
  assert.ok(!parser.evidenceCitesEndMarker('Doors 8pm until 2am'));
  assert.ok(!parser.evidenceCitesEndMarker('9PM TIL LATE'));
  assert.ok(!parser.evidenceCitesEndMarker('Starts at 10pm, ends at 2am'));
  assert.ok(!parser.evidenceCitesEndMarker(''));
});

test('end-marker gate: an uncorroborated end-marker value stays dropped instead of being reassigned', () => {
  const parser = createParser();
  const source = 'GEAR NIGHT party until late';
  const result = parser.validateAiEventEvidence(
    { starttime: '02:00', __fieldEvidence: { starttime: 'until late' } },
    { html: source }, {}, null,
    { evidenceContext: parser.buildAiEvidenceContextFromText(source), validationContext: { imageEvidenceUrls: new Set() } }
  );
  assert.equal(result.event.starttime, undefined, 'the start copy is dropped');
  assert.equal(result.event.endTime, undefined, 'a value the corpus never states must not sneak into the end field');
});

test('end-marker recovery: startDate is derived from the reassigned end (end 02:00 rolls back to the previous evening)', () => {
  const parser = createParser();
  const validationState = { validatedFields: new Set() };
  const merged = parser.applyEndMarkerStartDateRecovery(
    {
      title: 'GEAR NIGHT',
      endDate: '2026-08-01',
      endTime: '02:00',
      __droppedFieldReasons: { startdate: 'end-marker-cited-evidence', starttime: 'end-marker-cited-evidence' }
    },
    validationState
  );
  assert.equal(merged.startDate, '2026-07-31', 'end 2026-08-01 02:00 belongs to the evening of 2026-07-31');
  assert.equal(merged.startTime, undefined, 'startTime is left empty, never guessed');
  assert.ok(validationState.validatedFields.has('startdate'),
    'the derived date is marked pre-validated so the final evidence gate does not drop it (it is never verbatim on the page)');

  // An end later than 02:59 stays on its own date.
  const sameDay = parser.applyEndMarkerStartDateRecovery(
    { endDate: '2026-08-01', endTime: '23:00', __droppedFieldReasons: { starttime: 'end-marker-cited-evidence' } },
    { validatedFields: new Set() }
  );
  assert.equal(sameDay.startDate, '2026-08-01', 'a 23:00 end is the same evening');

  // No end time at all: keep the end date (fail closed, event survives).
  const noTime = parser.applyEndMarkerStartDateRecovery(
    { endDate: '2026-08-01', __droppedFieldReasons: { startdate: 'end-marker-cited-evidence' } },
    { validatedFields: new Set() }
  );
  assert.equal(noTime.startDate, '2026-08-01', 'unknown end time keeps the end date');

  // No end-marker memo, or a startDate already present: strict no-op.
  const untouched = { startDate: '2026-07-25', endDate: '2026-08-01', __droppedFieldReasons: { startdate: 'end-marker-cited-evidence' } };
  assert.deepEqual(parser.applyEndMarkerStartDateRecovery(untouched, { validatedFields: new Set() }), untouched,
    'a recovered startDate (e.g. from a retry) wins over derivation');
  const noMemo = { endDate: '2026-08-01' };
  assert.deepEqual(parser.applyEndMarkerStartDateRecovery(noMemo, { validatedFields: new Set() }), noMemo,
    'no end-marker drop, no derivation');
});

test('end-marker survival: the full GEAR NIGHT shape normalizes to a real event with the previous-evening date and positive duration', () => {
  global.EventSchema = EventSchema; // earlier tests leak a mocked schema — pin the real one
  const parser = createParser();
  const evidenceContext = parser.buildAiEvidenceContextFromText(DALLAS_EAGLE_SEGMENT);
  const validationContext = { imageEvidenceUrls: new Set() };

  // Gate + reassignment (both start fields cite the End-at line, end fields empty).
  const gated = parser.validateAiEventEvidence(
    {
      title: 'GEAR NIGHT',
      startdate: '2026-08-01',
      starttime: '02:00',
      __fieldEvidence: {
        startdate: 'End at: August 1, 2026 - 2:00 am (interpreted as event end date; start date not explicitly given, but assumed same day per typical single-night events)',
        starttime: 'End at: August 1, 2026 - 2:00 am (interpreted as end time; start time not explicitly given)'
      }
    },
    { html: DALLAS_EAGLE_SEGMENT }, {}, null,
    { evidenceContext, validationContext }
  );

  // Memo ride-along exactly as extractFieldsAcrossSnippets records it, then recovery.
  const memo = {};
  gated.report.dropped.forEach(entry => { if (entry.reason) memo[entry.field] = entry.reason; });
  const recovered = parser.applyEndMarkerStartDateRecovery(
    { ...gated.event, __droppedFieldReasons: memo },
    { validatedFields: new Set() }
  );
  assert.equal(recovered.startDate, '2026-07-31');

  // The event survives normalization: title + startDate present (the
  // "missing required title/startDate" drop can never trigger) and the
  // start/end pair has positive duration — no zero-duration merge warning.
  const event = parser.normalizeAiEvent(recovered, {}, { html: DALLAS_EAGLE_SEGMENT, url: 'https://thedallaseagle.com/events' }, null, null);
  assert.ok(event, 'the event is never lost');
  assert.equal(event.title, 'GEAR NIGHT');
  assert.ok(event.startDate instanceof Date && !Number.isNaN(event.startDate.getTime()), 'startDate exists');
  assert.ok(event.startDate.toISOString().startsWith('2026-07-31'), 'the event lands on the previous evening');
  assert.ok(event.endDate.getTime() > event.startDate.getTime(), 'positive duration — endDate > startDate');
});

test('end-marker retry feedback: the class rides buildRetryDropFeedback with its own additive line, not-verbatim line unchanged', () => {
  const parser = createParser();
  const merged = {
    __droppedFieldValues: { starttime: '02:00', bar: '79 Warrenon' },
    __droppedFieldReasons: { starttime: 'end-marker-cited-evidence', bar: '' }
  };
  const feedback = parser.buildRetryDropFeedback(['starttime', 'bar'], merged);
  assert.deepEqual(feedback, {
    starttime: { value: '02:00', reason: 'end-marker-cited-evidence' },
    bar: '79 Warrenon'
  }, 'end-marker drops ride as tagged objects, plain not-verbatim drops keep their string shape');

  const prompt = parser.buildExtractionPrompt(null, {}, null, {}, ['starttime', 'bar'], 'SNIPPET', 'alternate', {}, feedback);
  const endMarkerLine = `Your previous value "02:00" for starttime came from an "End at" line — that is the event's END, not its start. Find the START, or leave it blank.`;
  assert.ok(prompt.includes(endMarkerLine), 'the end-marker correction line appears for the class');
  const existingLine = 'Your previous value "79 Warrenon" for bar was rejected — it is not verbatim in the source. Copy the exact text.';
  assert.ok(prompt.includes(existingLine), 'the existing not-verbatim feedback line is unchanged');

  // Other tagged classes still yield nothing.
  assert.equal(
    parser.buildRetryDropFeedback(['city'], {
      __droppedFieldValues: { city: 'new york' },
      __droppedFieldReasons: { city: 'brand-cited-evidence' }
    }),
    null,
    'brand/context-cited drops are still never echoed'
  );
});

test('end-marker steering: getFieldContext appends the END-line sentence to start fields only, schema text unchanged', () => {
  const parser = createParser();
  const steering = ` Text following "End at", "Ends", "Until", or "Doors close" is the event's END, never its start — if no start is stated, leave this field empty.`;
  for (const field of ['startDate', 'startTime']) {
    const context = parser.getFieldContext(field, null);
    assert.ok(context.endsWith(steering), `steering appended for ${field}, got: ${JSON.stringify(context)}`);
    const schemaText = parser.getEventSchemaPromptFieldDescription(parser.normalizePromptFieldName(field));
    assert.ok(context.startsWith(schemaText), `the schema description itself stays byte-identical for ${field}`);
  }
  assert.ok(!parser.getFieldContext('endTime', null).includes('never its start'), 'end fields are not steered');
});

// ---------------------------------------------------------------------------
// Venue-hours notice guard (runs 20260724-161423 / 20260725-170031:
// massive.club's "Hours … Tuesday Closed …" block became a calendar-bound
// bear event titled "Tuesday Closed" with a startDate hallucinated from the
// adjacent "Bearracuda | Seattle Sep 12" listing). A title that is ONLY
// weekday token(s) + a closed-notice word is a schedule notice, never an
// event; anything else significant keeps the event (fail closed).
// ---------------------------------------------------------------------------

test('venue-hours notice: weekday+closed titles are notices, titles with any other significant token are not', () => {
  const parser = createParser();
  // Rejected notices — literal run title plus the stated variants
  assert.equal(parser.isVenueHoursNoticeTitle('Tuesday Closed'), true);
  assert.equal(parser.isVenueHoursNoticeTitle('Closed Mondays'), true);
  assert.equal(parser.isVenueHoursNoticeTitle('Mon-Tue Closed'), true);
  assert.equal(parser.isVenueHoursNoticeTitle('Tuesday: Dark'), true);
  assert.equal(parser.isVenueHoursNoticeTitle('TUESDAYS: CLOSED'), true);
  assert.equal(parser.isVenueHoursNoticeTitle('Monday no events'), true);
  // Real events keep living: closed/dark + other significant tokens
  assert.equal(parser.isVenueHoursNoticeTitle('Closed Party'), false);
  assert.equal(parser.isVenueHoursNoticeTitle('Dark Disco'), false);
  // A weekday alone or a closed-word alone is not a notice (fail closed)
  assert.equal(parser.isVenueHoursNoticeTitle('Tuesday'), false);
  assert.equal(parser.isVenueHoursNoticeTitle('Closed'), false);
  assert.equal(parser.isVenueHoursNoticeTitle(''), false);
  assert.equal(parser.isVenueHoursNoticeTitle(null), false);
});

test('venue-hours notice: extractSingleEvent skips the literal "Tuesday Closed" extraction with the skip log', async () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  // Mirrors the run: the AI bound the hours notice to the adjacent listing's
  // date, producing a fully-formed "event".
  parser.getAiEvent = async () => ({
    title: 'Tuesday Closed',
    startDate: '2026-09-12',
    city: 'seattle',
    __preValidatedFields: ['startDate', 'city']
  });
  let event = 'unset';
  const logs = await captureLogsAsync(async () => {
    event = await parser.extractSingleEvent(
      { html: 'Tuesday Closed\nBearracuda | Seattle Sep 12, 2026 9:00 PM', url: 'https://massive.club/calendar' },
      {}, null, ['title', 'startDate', 'city']
    );
  });
  assert.equal(event, null, 'a venue-hours notice never becomes an event');
  assert.ok(
    logs.includes('🤖 AI Web: Skipped venue-hours notice "Tuesday Closed" — not an event'),
    `skip log expected, got: ${JSON.stringify(logs.filter(line => line.includes('AI Web')))}`
  );
});

// ---------------------------------------------------------------------------
// Image-pairing eligibility: a venue-hours notice segment ("Tuesday Closed")
// describes no event and must never claim a page image in EITHER matcher.
// ---------------------------------------------------------------------------

test('image pairing: a "Tuesday Closed" phantom segment never takes an image in the ordered matcher', () => {
  const parser = createParser();
  const bounds = [
    { rawStart: 0, rawEnd: 100 },
    { rawStart: 5000, rawEnd: 6000 }
  ];
  const records = [{ url: 'https://img.example/flyer.jpg', start: 40, end: 60 }];

  // Without eligibility the image lands on the phantom (overlap, cost 0)
  assert.deepEqual(
    parser.matchOrderedImagesToSegments(bounds, records),
    ['https://img.example/flyer.jpg']);

  // With the phantom marked ineligible the real sibling gets it instead
  const matched = parser.matchOrderedImagesToSegments(bounds, records, [false, true]);
  assert.equal(matched[0], undefined, 'phantom claims nothing');
  assert.equal(matched[1], 'https://img.example/flyer.jpg');
});

test('image pairing: a "Tuesday Closed" phantom segment never takes an image in the OCR matcher, even via similarity', () => {
  const parser = createParser();
  const segments = [
    { lines: ['Tuesday Closed'] },
    { lines: ['HOSTILE NOISE', 'July 10, 2026'] }
  ];
  const bounds = [
    { rawStart: 0, rawEnd: 100, matchedRecords: [{ text: 'Tuesday Closed' }] },
    { rawStart: 5000, rawEnd: 6000, matchedRecords: [{ text: 'HOSTILE NOISE July 10, 2026' }] }
  ];
  const records = [{ url: 'https://img.example/flyer.jpg', start: 40, end: 60 }];
  // OCR text mirrors the phantom's row text — the similarity override would
  // otherwise bind the flyer to the phantom
  const ocrResults = [{
    url: 'https://img.example/flyer.jpg',
    text: 'Tuesday Closed',
    imageClassification: 'event-flyer'
  }];

  const unguarded = parser.matchOrderedImagesToSegmentsWithOcr(segments, bounds, records, ocrResults);
  assert.equal(unguarded[0], 'https://img.example/flyer.jpg', 'without eligibility the phantom wins');

  const guarded = parser.matchOrderedImagesToSegmentsWithOcr(segments, bounds, records, ocrResults, [false, true]);
  assert.equal(guarded[0], null, 'phantom claims nothing');
  assert.equal(guarded[1], 'https://img.example/flyer.jpg', 'the real sibling gets the flyer');
});

test('image pairing: eligibility follows the venue-hours notice detector, failing open without a title', () => {
  const parser = createParser();
  assert.equal(parser.isSegmentEligibleForImagePairing({ lines: ['Tuesday Closed'] }), false);
  assert.equal(parser.isSegmentEligibleForImagePairing({ lines: ['HOSTILE NOISE'] }), true);
  assert.equal(parser.isSegmentEligibleForImagePairing({ lines: [] }), true, 'no derivable title stays eligible');
});

// ---------------------------------------------------------------------------
// Post-pairing title↔OCR consistency gate (run 20260725: the Hostile Noise
// flyer was paired to the Treasure Trail segment).
// ---------------------------------------------------------------------------

function buildOcrGateSegments() {
  return [
    {
      lines: ['Treasure Trail', 'July 10, 2026'],
      html: '',
      imageHintUrls: ['https://img.example/hostile-noise.jpg']
    },
    { lines: ['Hostile Noise', 'July 11, 2026'], html: '', imageHintUrls: [] }
  ];
}

test('OCR consistency gate: the Hostile Noise flyer is reassigned from the Treasure Trail segment to its own listing', () => {
  const parser = createParser();
  const segments = buildOcrGateSegments();
  const ocrResults = [{
    url: 'https://img.example/hostile-noise.jpg',
    text: 'HOSTILE NOISE presents a night of mayhem',
    eventSummary: ''
  }];

  const logs = captureLogs(() => {
    parser.applySegmentOcrConsistencyGate(segments, ocrResults, 'https://venue.example/events');
  });

  assert.ok(segments[1].imageHintUrls.includes('https://img.example/hostile-noise.jpg'),
    'target segment adopts the flyer');
  assert.ok(segments[0].ocrExcludedUrlKeys instanceof Set && segments[0].ocrExcludedUrlKeys.size === 1,
    'owner segment excludes the flyer');
  assert.ok(logs.some(line => line.includes('Reassigned OCR image https://img.example/hostile-noise.jpg')
    && line.includes('flyer text matches sibling listing title')), `reassign log expected, got: ${JSON.stringify(logs)}`);

  // The filter judges ownership with the same keys: owner no longer matches,
  // target now does
  assert.deepEqual(parser.filterOcrResultsForSegment(ocrResults, segments[0], 'https://venue.example/events'), []);
  assert.equal(parser.filterOcrResultsForSegment(ocrResults, segments[1], 'https://venue.example/events').length, 1);
});

test('OCR consistency gate: any title-token overlap with the owner keeps the pairing (thrash-proof)', () => {
  const parser = createParser();
  const segments = [
    {
      lines: ['Treasure Trail Party', 'July 10, 2026'],
      html: '',
      imageHintUrls: ['https://img.example/flyer.jpg']
    },
    { lines: ['Hostile Noise', 'July 11, 2026'], html: '', imageHintUrls: [] }
  ];
  // One owner token ("trail") appears in the flyer text → owner keeps it even
  // though the sibling matches two tokens
  const ocrResults = [{
    url: 'https://img.example/flyer.jpg',
    text: 'Trail mix at the HOSTILE NOISE afterparty',
    eventSummary: ''
  }];

  parser.applySegmentOcrConsistencyGate(segments, ocrResults, 'https://venue.example/events');

  assert.equal(segments[0].ocrExcludedUrlKeys, undefined, 'owner keeps its flyer');
  assert.deepEqual(segments[1].imageHintUrls, [], 'sibling adopts nothing');
});

test('OCR consistency gate: a flyer naming multiple siblings equally is detached, owning nobody', () => {
  const parser = createParser();
  const segments = [
    {
      lines: ['Treasure Trail', 'July 10, 2026'],
      html: '',
      imageHintUrls: ['https://img.example/flyer.jpg']
    },
    { lines: ['Hostile Noise', 'July 11, 2026'], html: '', imageHintUrls: [] },
    { lines: ['Noise Hostile', 'July 12, 2026'], html: '', imageHintUrls: [] }
  ];
  const ocrResults = [{
    url: 'https://img.example/flyer.jpg',
    text: 'HOSTILE NOISE weekend takeover',
    eventSummary: ''
  }];

  const logs = captureLogs(() => {
    parser.applySegmentOcrConsistencyGate(segments, ocrResults, 'https://venue.example/events');
  });

  assert.ok(segments[0].ocrExcludedUrlKeys instanceof Set && segments[0].ocrExcludedUrlKeys.size === 1,
    'owner is detached from the flyer');
  assert.deepEqual(segments[1].imageHintUrls, []);
  assert.deepEqual(segments[2].imageHintUrls, []);
  assert.ok(logs.some(line => line.includes('Detached OCR image https://img.example/flyer.jpg')
    && line.includes('flyer text matches multiple sibling titles')), `detach log expected, got: ${JSON.stringify(logs)}`);
  assert.deepEqual(parser.filterOcrResultsForSegment(ocrResults, segments[0], 'https://venue.example/events'), [],
    'detached flyer no longer reaches the former owner');
});

test('OCR consistency gate: an excluded flyer\'s OCR text and image lines never reach the former owner\'s prompt content', () => {
  const parser = createParser();
  const segments = buildOcrGateSegments();
  const ocrResults = [{
    url: 'https://img.example/hostile-noise.jpg',
    text: 'HOSTILE NOISE presents a night of mayhem',
    eventSummary: ''
  }];
  const htmlData = { url: 'https://venue.example/events', html: '<html><body></body></html>' };

  parser.applySegmentOcrConsistencyGate(segments, ocrResults, htmlData.url);

  const ownerData = parser.buildMultiEventSegmentHtmlData(htmlData, segments[0], 0, 2, ocrResults);
  assert.ok(!ownerData.html.includes('HOSTILE NOISE presents'), 'OCR text stays out of the owner prompt');
  assert.ok(!ownerData.html.includes('https://img.example/hostile-noise.jpg'),
    'no SEGMENT_IMAGE_HINT_URL/SEGMENT_IMAGE_URL line for the excluded image');
  assert.deepEqual(ownerData.ocrResults, []);

  const targetData = parser.buildMultiEventSegmentHtmlData(htmlData, segments[1], 1, 2, ocrResults);
  assert.ok(targetData.html.includes('HOSTILE NOISE presents'), 'OCR text reaches the new owner');
  assert.ok(targetData.html.includes('https://img.example/hostile-noise.jpg'));
});

// ---------------------------------------------------------------------------
// og:image fill for imageless single-event pages (2c): a page that produced
// exactly one event adopts its own og:image; multi-event segments never do.
// ---------------------------------------------------------------------------

test('og:image fill: an imageless single JSON-LD event adopts the page og:image; multi-event pages never do', () => {
  const parser = createParser();
  const htmlData = {
    url: 'https://venue.example/events/big-night',
    html: `<html><head>
      <meta property="og:image" content="https://venue.example/artwork/big-night.jpg" />
    </head><body></body></html>`
  };

  const event = { title: 'BIG NIGHT', image: '' };
  const logs = captureLogs(() => {
    parser.fillImageFromPageMetaArtwork(event, htmlData);
  });
  assert.equal(event.image, 'https://venue.example/artwork/big-night.jpg');
  assert.equal(event.imageSource, 'og-image');
  assert.ok(logs.includes('🤖 AI Web: Filled image from page og:image for "BIG NIGHT"'),
    `fill log expected, got: ${JSON.stringify(logs)}`);

  // An event that already has an image is never overwritten
  const withImage = { title: 'BIG NIGHT', image: 'https://venue.example/other.jpg' };
  parser.fillImageFromPageMetaArtwork(withImage, htmlData);
  assert.equal(withImage.image, 'https://venue.example/other.jpg');
  assert.equal(withImage.imageSource, undefined);

  // Uninteresting meta URLs (logo shapes) are skipped
  const logoData = {
    url: htmlData.url,
    html: '<html><head><meta property="og:image" content="https://venue.example/assets/logo.png" /></head><body></body></html>'
  };
  const logoEvent = { title: 'BIG NIGHT', image: '' };
  parser.fillImageFromPageMetaArtwork(logoEvent, logoData);
  assert.equal(logoEvent.image, '', 'a logo og:image is never adopted');

  // Multi-event segments never adopt the page-level meta image
  const segmentEvent = parser.normalizeAiEvent(
    { title: 'SEGMENT EVENT', startDate: '2026-08-01', startTime: '21:00' },
    {},
    { ...htmlData, dataFlags: { ocr: true, segment: true } },
    null, null);
  assert.equal(segmentEvent.image, '', 'segment events never inherit og:image');
});

// ---------------------------------------------------------------------------
// Venue-site identity (KNOWN VENUE guard): establishment fails closed on any
// missing fact; the replacement pass corrects flyer-subtitle bars only.
// ---------------------------------------------------------------------------

function createIdentityParser() {
  const parser = new AiWebParser({ normalizeUrl });
  parser.core = new SharedCore(
    { seattle: { timezone: 'America/Los_Angeles', patterns: ['seattle'] } },
    {
      eventSchema: EventSchema,
      bars: {
        seattle: [
          { name: 'Massive', city: 'seattle', address: '1620 Broadway, Seattle, WA 98122' },
          { name: 'The Cuff Complex', city: 'seattle', address: '1533 13th Ave, Seattle, WA 98122' },
          { name: 'Rockbar', city: 'seattle', address: '1 Rock Ave, Seattle, WA' }
        ],
        dallas: [
          { name: 'Dallas Eagle', city: 'dallas', address: '525 S Riverfront Blvd, Dallas, TX' },
          { name: 'Rockbar', city: 'dallas', address: '2 Rock St, Dallas, TX' }
        ],
        'fort-lauderdale': [
          { name: 'Eagle', city: 'fort-lauderdale', address: '1951 NW 9th Ave, Fort Lauderdale, FL' }
        ]
      }
    }
  );
  return parser;
}

test('venue-site identity: established for the massive-shaped host, fails closed on blocks, ambiguity, stems, and platforms', () => {
  const parser = createIdentityParser();
  const entry = {
    consensusKey: parser.normalizeVenueSiteAddressKey('1620 Broadway, Seattle, WA 98122'),
    consensusAddress: '1620 Broadway, Seattle, WA 98122',
    blocked: false,
    venueRoleSeen: true,
    venueName: 'Massive'
  };
  const identity = parser.getEstablishedVenueSiteIdentity(entry, entry.consensusKey);
  assert.ok(identity, 'all facts converge → identity established');
  assert.equal(identity.name, 'Massive');
  assert.equal(identity.city, 'seattle');
  assert.equal(identity.hostLevel, true);
  assert.deepEqual(identity.signals, ['venue-role', 'curated-name', 'address-consensus']);

  // Any organizer-resolved page on the host blocks
  assert.equal(parser.getEstablishedVenueSiteIdentity({ ...entry, blocked: true }, entry.consensusKey), null);
  // Undetermined site role does NOT block host-level identity — curated name
  // + matching address consensus are the load-bearing facts (run
  // 20260727-123001: massive.club never resolved 'venue' yet both held)
  const undeterminedIdentity = parser.getEstablishedVenueSiteIdentity(
    { ...entry, venueRoleSeen: false }, entry.consensusKey);
  assert.ok(undeterminedIdentity, 'undetermined role + curated name + address consensus → established');
  assert.equal(undeterminedIdentity.hostLevel, true);
  assert.deepEqual(undeterminedIdentity.signals, ['curated-name', 'address-consensus']);
  // The weaker per-event POI path still REQUIRES an explicit venue-role page
  assert.equal(parser.getEstablishedVenueSiteIdentity(
    { ...entry, venueRoleSeen: false, consensusKey: '', consensusAddress: '' }, ''), null);
  // A consensus address CONTRADICTING the curated address establishes nothing
  assert.equal(parser.getEstablishedVenueSiteIdentity(
    { ...entry, consensusAddress: '525 S Riverfront Blvd, Dallas, TX' }, entry.consensusKey), null);
  // Ambiguous curated name (curated in two cities) never establishes
  assert.equal(parser.getEstablishedVenueSiteIdentity({ ...entry, venueName: 'Rockbar' }, entry.consensusKey), null);
  // Generic franchise stem ("Eagle" ⊂ "Dallas Eagle") never establishes
  assert.equal(parser.getEstablishedVenueSiteIdentity({ ...entry, venueName: 'Eagle' }, entry.consensusKey), null);
  // Ticketing-platform brand matches no curated bar — the structural guard
  assert.equal(parser.getEstablishedVenueSiteIdentity({ ...entry, venueName: 'Eventbrite' }, entry.consensusKey), null);
  // No consensus at all → identity applies per-event only (POI promotion)
  const eventLevel = parser.getEstablishedVenueSiteIdentity(
    { ...entry, consensusKey: '', consensusAddress: '' }, '');
  assert.ok(eventLevel);
  assert.equal(eventLevel.hostLevel, false);
});

test('venue-site identity: the replacement matrix — replace, fill, and every skip shape', () => {
  const parser = createIdentityParser();
  parser.lastVenueSiteConsensus = {
    'massive.club': {
      consensusKey: parser.normalizeVenueSiteAddressKey('1620 Broadway, Seattle, WA 98122'),
      consensusAddress: '1620 Broadway, Seattle, WA 98122',
      blocked: false,
      venueRoleSeen: true,
      venueName: 'Massive'
    }
  };
  const events = [
    // PERVERT/Villa Señor shape: uncorroborated flyer subtitle → replaced
    {
      title: 'PERVERT', bar: 'Villa Señor', barSource: 'uncorroborated', city: '',
      _venueSitePageHost: 'massive.club',
      _barRescue: { candidate: 'Villa Señor', signals: ['page', 'ocr'] }
    },
    // Empty bar → filled
    { title: 'PACK', bar: '', city: 'seattle', _venueSitePageHost: 'massive.club' },
    // Off-site street address → untouched (multi-venue announcement)
    {
      title: 'OFFSITE', bar: 'Somewhere Else', barSource: 'uncorroborated',
      address: '4216 University Way NE, Seattle, WA', _venueSitePageHost: 'massive.club'
    },
    // A DIFFERENT curated bar of the city → untouched (flag-only log)
    { title: 'CUFF TAKEOVER', bar: 'The Cuff Complex', _venueSitePageHost: 'massive.club' },
    // Structured-data bar → untouched
    { title: 'JSONLD NIGHT', bar: 'Some Hall', _barFromJsonLd: true, _venueSitePageHost: 'massive.club' },
    // Venue's own name in another casing → casing normalized only
    { title: 'HOUSE NIGHT', bar: 'MASSIVE', barSource: 'venue-site', _venueSitePageHost: 'massive.club' },
    // Different host → untouched
    { title: 'ELSEWHERE', bar: 'Shore Thing', _venueSitePageHost: 'other.example' }
  ];

  const logs = captureLogs(() => parser.applyVenueSiteIdentityCorrections(events, null));

  assert.equal(events[0].bar, 'Massive');
  assert.equal(events[0].barSource, 'venue-site-identity');
  assert.deepEqual(events[0]._venueIdentityCorrection, {
    original: 'Villa Señor',
    originalSource: 'uncorroborated',
    signals: ['venue-role', 'curated-name', 'address-consensus']
  });
  assert.equal('_barRescue' in events[0], false, 'a rescue of the replaced value is stale evidence');
  assert.equal(events[0].city, 'seattle', 'blank city backfilled from the identity');
  assert.equal(events[1].bar, 'Massive');
  assert.equal(events[1].barSource, 'venue-site-identity');
  assert.equal(events[2].bar, 'Somewhere Else', 'off-site address keeps its own bar');
  assert.equal(events[3].bar, 'The Cuff Complex');
  assert.equal(events[3].barSource, undefined, 'other curated bar untouched');
  assert.equal(events[4].bar, 'Some Hall', 'structured-data bar untouched');
  assert.equal(events[5].bar, 'Massive', 'casing normalized to the curated name');
  assert.equal(events[5].barSource, 'venue-site', 'barSource untouched on a casing normalization');
  assert.equal(events[6].bar, 'Shore Thing', 'other hosts untouched');

  assert.ok(logs.some(line => line.includes(
    '🤖 AI Web: Venue-site identity for massive.club established: "Massive" (seattle) — signals: venue-role, curated-name, address-consensus')),
    `identity log expected, got: ${JSON.stringify(logs)}`);
  assert.ok(logs.some(line => line.includes(
    '🤖 AI Web: Replaced bar "Villa Señor" with venue-site identity "Massive" for "PERVERT" (was uncorroborated)')));
  assert.ok(logs.some(line => line.includes(
    '🤖 AI Web: Filled bar "Massive" from venue-site identity for "PACK"')));
  assert.ok(logs.some(line => line.includes(
    '🤖 AI Web: Kept bar "The Cuff Complex" for "CUFF TAKEOVER" — matches another curated seattle bar; venue-site identity not applied')));
  assert.equal(parser.lastVenueSiteConsensus, null, 'the stash is consumed and cleared');
});

test('venue-site identity: POI promotion applies per-event when the host has no address consensus', () => {
  const parser = createIdentityParser();
  parser.lastVenueSiteConsensus = {
    'massive.club': {
      consensusKey: '', consensusAddress: '',
      blocked: false, venueRoleSeen: true, venueName: 'Massive'
    }
  };
  const events = [
    {
      title: 'SHORE THING', bar: 'Shore Thing', barSource: 'uncorroborated',
      _geoPoiName: 'Massive', _venueSitePageHost: 'massive.club'
    },
    { title: 'NO POI', bar: 'Shore Thing', barSource: 'uncorroborated', _venueSitePageHost: 'massive.club' }
  ];
  parser.applyVenueSiteIdentityCorrections(events, null);
  assert.equal(events[0].bar, 'Massive');
  assert.equal(events[0].barSource, 'venue-site-identity');
  assert.deepEqual(events[0]._venueIdentityCorrection.signals, ['venue-role', 'curated-name', 'geo-poi']);
  assert.equal(events[1].bar, 'Shore Thing', 'without a matching map POI the identity never applies');
});

test('venue-site identity: harvest records venue-role facts and the consensus pass stashes them per host', () => {
  const parser = createIdentityParser();
  const venueData = { url: 'https://massive.club/events', html: VENUE_SITE_HTML };
  parser.resolvePageSiteRole(venueData, {});
  parser.harvestVenueSiteAddresses(venueData);
  parser.tagEventsWithVenueSitePage([{ title: 'X' }], venueData);
  const entry = parser.venueSiteHarvest['massive.club'];
  assert.equal(entry.venueRoleSeen, true);
  assert.equal(entry.venueName, 'MASSIVE');

  parser.applyVenueSiteAddressConsensus([], null);
  const stashed = parser.lastVenueSiteConsensus['massive.club'];
  assert.equal(stashed.venueRoleSeen, true);
  assert.equal(stashed.venueName, 'MASSIVE');
  assert.equal(stashed.blocked, false);
  assert.equal(stashed.consensusKey, '', 'no map-directions addresses → no consensus');
  assert.equal(parser.venueSiteHarvest, null, 'harvest still resets per run');
});

test('venue-site harvest: an undetermined page records the venue name (not the role); an organizer page records neither', () => {
  // Undetermined role (pageSiteRole never resolved — the massive.club shape,
  // run 20260727-123001): the published name is still harvested so identity
  // can be established from curated-name + address-consensus alone.
  const parser = createIdentityParser();
  const undeterminedData = { url: 'https://massive.club/events', html: VENUE_SITE_HTML, pageSiteRole: '' };
  parser.harvestVenueSiteAddresses(undeterminedData);
  const entry = parser.venueSiteHarvest['massive.club'];
  assert.equal(entry.venueRoleSeen, false, 'undetermined never asserts the venue role');
  assert.equal(entry.venueName, 'MASSIVE', 'the page name is harvested anyway');
  assert.equal(entry.blocked, false);

  // Organizer role: blocks the host and records no name
  const organizerParser = createIdentityParser();
  const organizerData = { url: 'https://massive.club/events', html: VENUE_SITE_HTML, pageSiteRole: 'organizer' };
  organizerParser.harvestVenueSiteAddresses(organizerData);
  const blockedEntry = organizerParser.venueSiteHarvest['massive.club'];
  assert.equal(blockedEntry.blocked, true);
  assert.equal(blockedEntry.venueRoleSeen, false);
  assert.equal(blockedEntry.venueName, '', 'organizer pages contribute no identity facts');
});

// ---------------------------------------------------------------------------
// Curated-website identity rung: a curated bar's own `website` field claims a
// registrable host, establishing host-level identity with NO address
// consensus. Fill-only application; multi-claimant hosts resolve the
// sub-venue from the event's own evidence, falling back to the primary.
// Fixture mirrors the 20260802-102127 run: two nyc bars share one site.
// ---------------------------------------------------------------------------

function createCuratedWebsiteParser() {
  const parser = new AiWebParser({ normalizeUrl });
  parser.core = new SharedCore(
    {
      nyc: { timezone: 'America/New_York', patterns: ['nyc', 'new york'] },
      seattle: { timezone: 'America/Los_Angeles', patterns: ['seattle'] }
    },
    {
      eventSchema: EventSchema,
      bars: {
        nyc: [
          {
            name: '3 Dollar Bill', city: 'nyc',
            address: '260 Meserole St, Brooklyn, NY 11206',
            coordinates: '40.7084144, -73.9380583',
            website: 'https://www.3dollarbillbk.com'
          },
          {
            name: 'The Yard at 9 Bob Note', city: 'nyc',
            address: '270 Meserole St, Brooklyn, NY 11206',
            coordinates: null,
            website: 'https://www.3dollarbillbk.com'
          },
          {
            name: 'Rockbar', city: 'nyc',
            address: '185 Christopher St, New York, NY',
            website: 'https://www.rockbarnyc.com'
          }
        ],
        seattle: [
          {
            name: 'Massive', city: 'seattle',
            address: '1620 Broadway, Seattle, WA 98122',
            coordinates: '47.6142900, -122.3211000',
            website: 'https://massive.club'
          }
        ]
      }
    }
  );
  return parser;
}

function curatedWebsiteEntry(overrides = {}) {
  return {
    consensusKey: '', consensusAddress: '', blocked: false,
    venueRoleSeen: false, venueName: '', harvestedAddresses: [],
    ...overrides
  };
}

test('curated-website identity: a single-claimant host establishes from the website field alone and fills blanks only', () => {
  const parser = createCuratedWebsiteParser();
  parser.lastVenueSiteConsensus = { 'massive.club': curatedWebsiteEntry() };
  const events = [
    { title: 'UNDERBEAR', bar: '', city: 'unknown', _venueSitePageHost: 'massive.club' },
    // Non-empty bar is NEVER overwritten (fill-only) — city still fills
    { title: 'GUEST NIGHT', bar: 'Guest Brand', barSource: 'uncorroborated', city: '', _venueSitePageHost: 'massive.club' },
    // A DIFFERENT extracted city → road-show guard, whole event untouched
    { title: 'ROAD SHOW', bar: '', city: 'portland', _venueSitePageHost: 'massive.club' },
    // An ALIAS of the claimants' city resolves through the config and passes
    { title: 'HOMETOWN ALIAS', bar: '', city: 'emerald city', _venueSitePageHost: 'massive.club' },
    { title: 'ELSEWHERE', bar: '', city: 'unknown', _venueSitePageHost: 'other.example' }
  ];
  const cityConfig = {
    seattle: { timezone: 'America/Los_Angeles', patterns: ['seattle', 'emerald city'] },
    portland: { timezone: 'America/Los_Angeles', patterns: ['portland'] }
  };
  const logs = captureLogs(() => parser.applyVenueSiteIdentityCorrections(events, cityConfig));

  assert.equal(events[0].bar, 'Massive');
  assert.equal(events[0].barSource, 'venue-site-identity');
  assert.equal(events[0].city, 'seattle', 'the city fill drives downstream timezone re-anchoring');
  assert.equal(events[1].bar, 'Guest Brand', 'a non-empty bar is never overwritten by the fill-only rung');
  assert.equal(events[1].barSource, 'uncorroborated');
  assert.equal(events[1].city, 'seattle');
  assert.equal(events[2].bar, '', 'a differing extracted city means a party elsewhere — untouched');
  assert.equal(events[2].city, 'portland', 'a non-empty city is never overwritten');
  assert.equal(events[3].bar, 'Massive', 'a config alias of the claimants\' city still passes the guard');
  assert.equal(events[3].city, 'emerald city', 'the alias city itself is non-empty — never overwritten');
  assert.equal(events[4].bar, '', 'other hosts untouched');
  assert.equal(events[4].city, 'unknown');

  assert.ok(logs.some(line => line.includes(
    '🤖 AI Web: Venue-site identity for massive.club established from curated website match: "Massive" (seattle) — signals: curated-website')),
    `identity log expected, got: ${JSON.stringify(logs)}`);
  assert.ok(logs.some(line => line.includes(
    '🤖 AI Web: Filled bar "Massive" from curated-website identity for "UNDERBEAR" (sole curated claimant of the host)')));
  assert.ok(logs.some(line => line.includes(
    '🤖 AI Web: Filled city "seattle" from curated-website identity for "UNDERBEAR"')));
});

test('curated-website identity: a multi-claimant host resolves the sub-venue from the event\'s own evidence', () => {
  const parser = createCuratedWebsiteParser();
  parser.lastVenueSiteConsensus = { '3dollarbillbk.com': curatedWebsiteEntry() };
  const events = [
    // The run's CONFESSIONS DEUX shape: the surviving flyer street line is
    // 9 Bob Note's curated address (locality-suffix tolerant comparison)
    {
      title: 'CONFESSIONS DEUX', bar: '', city: 'unknown',
      address: '270 Meserole St. BK', _venueSitePageHost: '3dollarbillbk.com'
    },
    // No evidence at all → FAIL CLOSED. The primary is a ranking, not
    // evidence: run 20260802-194055 had four unresolved 3dollarbillbk.com
    // events that were really at the sibling "The Yard at 9 Bob Note", so
    // filling the coordinate-carrying primary ships confidently wrong venues.
    { title: 'Big Gay Foam Party', bar: '', city: 'unknown', _venueSitePageHost: '3dollarbillbk.com' },
    // The event's own text names one claimant whole-word
    {
      title: 'Live from The Yard at 9 Bob Note', bar: '', city: 'unknown',
      _venueSitePageHost: '3dollarbillbk.com'
    },
    // Text naming BOTH claimants is ambiguous → the primary answers
    {
      title: 'Takeover: 3 Dollar Bill x The Yard at 9 Bob Note', bar: '', city: 'unknown',
      _venueSitePageHost: '3dollarbillbk.com'
    },
    // Off-site street address (matches no claimant) → untouched entirely
    {
      title: 'OFFSITE', bar: '', city: 'unknown',
      address: '500 Somewhere Else Ave, Queens, NY', _venueSitePageHost: '3dollarbillbk.com'
    }
  ];
  const logs = captureLogs(() => parser.applyVenueSiteIdentityCorrections(events, null));

  assert.equal(events[0].bar, 'The Yard at 9 Bob Note', 'the address evidence picks the sub-venue');
  assert.equal(events[0].city, 'nyc');
  assert.equal(events[1].bar, '', 'no evidence → bar stays blank; guessing the primary ships the wrong sibling');
  assert.equal(events[1].city, 'nyc', 'the city is unambiguous (single claimant city) and still fills');
  assert.equal(events[2].bar, 'The Yard at 9 Bob Note', 'the event text picks the sub-venue');
  assert.equal(events[3].bar, '', 'ambiguous evidence fails closed too');
  assert.equal(events[4].bar, '', 'an off-site party is never claimed');
  assert.equal(events[4].city, 'unknown');

  assert.ok(logs.some(line => line.includes(
    'Venue-site identity for 3dollarbillbk.com established from curated website match: "3 Dollar Bill", "The Yard at 9 Bob Note" (nyc) — signals: curated-website; primary "3 Dollar Bill" (first claimant with curated coordinates)')),
    `identity log expected, got: ${JSON.stringify(logs)}`);
  assert.ok(logs.some(line => line.includes(
    'Filled bar "The Yard at 9 Bob Note" from curated-website identity for "CONFESSIONS DEUX" (the event address is its curated address)')));
  assert.ok(logs.some(line => line.includes(
    'Left bar blank for "Big Gay Foam Party" — 2 curated bars share 3dollarbillbk.com ("3 Dollar Bill", "The Yard at 9 Bob Note") and this event\'s own evidence names none; the primary "3 Dollar Bill" is a ranking, not evidence')),
    `fail-closed log expected, got: ${JSON.stringify(logs)}`);
  assert.ok(!logs.some(line => line.includes('Filled bar "3 Dollar Bill"')),
    'the primary is never filled without per-event evidence');
});

test('curated-website identity: a site-published address picks the primary; blocked, cross-city, and platform hosts never establish', () => {
  const parser = createCuratedWebsiteParser();
  // The site itself publishes one claimant's curated address → that claimant
  // is the primary even without coordinates.
  const published = parser.getCuratedWebsiteVenueSiteIdentity('3dollarbillbk.com',
    curatedWebsiteEntry({ harvestedAddresses: ['270 Meserole St, Brooklyn, NY 11206'] }));
  assert.ok(published);
  assert.equal(published.primary.bar.name, 'The Yard at 9 Bob Note');
  assert.equal(published.primaryReason, 'the site publishes its curated address');
  assert.equal(published.city, 'nyc');
  assert.deepEqual(published.signals, ['curated-website']);

  // Organizer-blocked host: the same veto as every other identity path
  assert.equal(parser.getCuratedWebsiteVenueSiteIdentity('3dollarbillbk.com',
    curatedWebsiteEntry({ blocked: true })), null);

  // Platform host: no curated bar lists it as a website → structurally null
  assert.equal(parser.getCuratedWebsiteVenueSiteIdentity('eventbrite.com', curatedWebsiteEntry()), null);
  assert.deepEqual(parser.getCuratedBarsClaimingHost('eventbrite.com'), []);

  // Claimants curated in DIFFERENT cities → ambiguity, fail closed
  parser.core.bars.seattle.push({
    name: 'Massive East', city: 'seattle', address: '1 Elsewhere St, Seattle, WA',
    website: 'https://www.3dollarbillbk.com'
  });
  const crossCityLogs = captureLogs(() => {
    assert.equal(parser.getCuratedWebsiteVenueSiteIdentity('3dollarbillbk.com', curatedWebsiteEntry()), null);
  });
  assert.ok(crossCityLogs.some(line => line.includes(
    'Curated-website identity for 3dollarbillbk.com is ambiguous — curated bars in nyc, seattle all claim it; nothing derived')));
});

test('curated-website identity: the stronger established identity keeps precedence over the fill-only rung', () => {
  const parser = createCuratedWebsiteParser();
  // Massive-shaped host where the STRONG guard establishes (curated name +
  // matching address consensus): the replacement machinery runs, not fills.
  parser.lastVenueSiteConsensus = {
    'massive.club': curatedWebsiteEntry({
      consensusKey: parser.normalizeVenueSiteAddressKey('1620 Broadway, Seattle, WA 98122'),
      consensusAddress: '1620 Broadway, Seattle, WA 98122',
      venueRoleSeen: true,
      venueName: 'Massive',
      harvestedAddresses: ['1620 Broadway, Seattle, WA 98122']
    })
  };
  const events = [
    { title: 'PERVERT', bar: 'Villa Señor', barSource: 'uncorroborated', city: '', _venueSitePageHost: 'massive.club' }
  ];
  const logs = captureLogs(() => parser.applyVenueSiteIdentityCorrections(events, null));
  assert.equal(events[0].bar, 'Massive', 'the strong identity still replaces flyer brands');
  assert.ok(logs.some(line => line.includes('signals: venue-role, curated-name, address-consensus')));
  assert.ok(!logs.some(line => line.includes('from curated website match')),
    'the fill-only rung stays out of the way when the strong identity establishes');
});

test('venue-site identity addresses: locality-suffix tolerance matches a comma-less borough scribble, never a different address', () => {
  const parser = createCuratedWebsiteParser();
  assert.equal(parser.venueSiteIdentityAddressesAgree(
    '270 Meserole St. BK', '270 Meserole St, Brooklyn, NY 11206'), true,
    'the flyer street line agrees with its curated form');
  assert.equal(parser.venueSiteIdentityAddressesAgree(
    '270 Meserole St. BK', '260 Meserole St, Brooklyn, NY 11206'), false,
    'a different street number never agrees');
  assert.equal(parser.venueSiteIdentityAddressesAgree(
    '270 Meserole St. BK', '270 Thames St, Brooklyn, NY'), false,
    'a different street never agrees');
  assert.equal(parser.venueSiteIdentityAddressesAgree(
    '619 E Pine St, Seattle, WA 98122', '619 E Pine St, Seattle, WA 98122'), true,
    'the existing exact path is untouched');
});

test('address gate: an ADDRESS-SHAPED address equal to the bar value is kept — the bar holds the copy', () => {
  const parser = createParser();
  const event = { title: 'CONFESSIONS DEUX', bar: '270 Meserole St. BK', address: '270 Meserole St. BK' };
  const captured = captureGateLogs();
  try {
    parser.applyAddressPlausibilityGate(event, {});
    parser.applyBarPlausibilityGate(event, null);
  } finally {
    captured.restore();
  }
  assert.equal(event.address, '270 Meserole St. BK', 'the address survives — it locates the sub-venue');
  assert.equal(event.bar, undefined, 'the address-shaped bar still drops (it was the copy)');
  assert.ok(captured.lines.some(line => line.includes(
    '🤖 AI Web: Kept address-shaped address "270 Meserole St. BK" despite equal bar value — the bar holds the copy, not the address')),
    `kept log expected, got:\n${captured.lines.join('\n')}`);
  assert.ok(captured.lines.some(line => line.includes(
    'Dropped implausible bar "270 Meserole St. BK" (address-shaped)')));

  // A name-shaped twin still drops via "matches venue name"
  const nameTwin = { title: 'FURBALL Boston', bar: 'Legacy', address: 'Legacy', city: 'boston' };
  const captured2 = captureGateLogs();
  try {
    parser.applyAddressPlausibilityGate(nameTwin, {});
  } finally {
    captured2.restore();
  }
  assert.equal(nameTwin.address, undefined, 'a venue name is still not an address');
  assert.ok(captured2.lines.some(line => line.includes('Dropped implausible address "Legacy" (matches venue name)')));
});

test('KNOWN VENUE curated-match prompt line appears only with a unique curated match; the base line stays byte-identical', () => {
  const curatedMatchLine = 'KNOWN VENUE (curated match): "MASSIVE" is the venue for every event on this site. Other bar or brand names printed on a flyer are guest hosts or co-presenters, NOT the venue — never return them as "bar" unless the page states the event happens at a different street address.';

  const parser = createIdentityParser();
  const venueData = { url: 'https://massive.club/events', html: VENUE_SITE_HTML };
  parser.resolvePageSiteRole(venueData, {});
  const prompt = parser.buildExtractionPrompt(venueData, {}, null, {}, ['title', 'bar'], 'SNIPPET', 'default', {});
  assert.match(prompt,
    /KNOWN VENUE \(this is the venue's own site\): "MASSIVE" — events on this page take place AT this venue unless the page states another location; DJ names, taglines, and edition subtitles are NOT the venue\./,
    'the existing line is unchanged');
  assert.ok(prompt.includes(curatedMatchLine), 'curated match → the strengthening line is appended');

  // No curated bars data → no curated-match line, base line still present
  const bareParser = createParser();
  const bareData = { url: 'https://massive.club/events', html: VENUE_SITE_HTML };
  bareParser.resolvePageSiteRole(bareData, {});
  const barePrompt = bareParser.buildExtractionPrompt(bareData, {}, null, {}, ['title', 'bar'], 'SNIPPET', 'default', {});
  assert.match(barePrompt, /KNOWN VENUE \(this is the venue's own site\): "MASSIVE"/);
  assert.ok(!barePrompt.includes('KNOWN VENUE (curated match):'), 'no unique curated match → no extra line');
});

// ============================================================================
// JSON-API EXTRACTION PATHWAY
// ============================================================================
// Abridged REAL search payload shape from api.redeyetickets.com (the Goldiloxx
// forensic run that extracted 0 events because no JSON pathway existed).
const REDEYE_SEARCH_PAYLOAD = {
  data: [{
    id: '08125f3d-x',
    slug: 'goldiloxx-july',
    name: 'GOLDILOXX JULY ',
    headline: '',
    description: '<p>DJ JOE MICHAEL and DJ BOOMER BANKS</p>',
    venue: 'Red Eye NY',
    venue_city: 'New York',
    venue_state: 'NY',
    venue_country: 'US',
    venue_time_zone: 'America/New_York',
    first_performance_start_at: '2026-07-26T01:00:00Z',
    first_performance_end_at: '2026-07-26T08:00:00Z',
    flyer_url: 'https://redeye-event-flyers.s3.amazonaws.com/img_9849-optimized.jpg',
    status: 'published'
  }],
  meta: { pagination: { per_page: 20 } }
};
const REDEYE_SOURCE_URL = 'https://api.redeyetickets.com/api/v2/events/search?venue=red-eye-ny';

test('parseEvents extracts the Red Eye search payload via the JSON-API structured path with zero AI/OCR calls', async () => {
  const parser = createParser();
  let aiCalls = 0;
  let ocrCalls = 0;
  parser.core.callAiGenerate = async () => { aiCalls += 1; return null; };
  parser.extractOcrFromAllImages = async () => { ocrCalls += 1; return []; };
  const cityConfig = { nyc: { timezone: 'America/New_York', patterns: ['new york', 'nyc'] } };

  let result;
  const logs = await captureLogsAsync(async () => {
    result = await parser.parseEvents(
      { url: REDEYE_SOURCE_URL, html: JSON.stringify(REDEYE_SEARCH_PAYLOAD) },
      {},
      cityConfig,
      'event-page',
      null
    );
  });

  assert.equal(result.events.length, 1);
  const event = result.events[0];
  assert.equal(event.title, 'GOLDILOXX JULY', 'title is trimmed');
  assert.equal(event.startDate.toISOString(), '2026-07-26T01:00:00.000Z');
  assert.equal(event.endDate.toISOString(), '2026-07-26T08:00:00.000Z');
  assert.equal(event._timezoneUnresolved, undefined, 'trailing-Z instants are authoritative');
  assert.equal(event.bar, 'Red Eye NY');
  assert.equal(event.timezone, 'America/New_York', 'IANA venue_time_zone wins');
  assert.equal(event.address, 'New York, NY');
  assert.equal(event.city, 'nyc', 'city resolved from the composed address');
  assert.equal(event.image, 'https://redeye-event-flyers.s3.amazonaws.com/img_9849-optimized.jpg');
  assert.equal(event.imageSource, 'json-api');
  assert.equal(event.description, 'DJ JOE MICHAEL and DJ BOOMER BANKS', 'description is tag-stripped');
  assert.equal(event.url, REDEYE_SOURCE_URL, 'no public URL is ever fabricated from the slug');
  assert.equal(event.ticketUrl, '', 'slug never becomes a ticket URL');

  assert.equal(aiCalls, 0, 'no extraction AI on the structured path');
  assert.equal(ocrCalls, 0, 'no OCR on the structured path');
  assert.deepEqual(result.extractionSummary, { source: 'json-api', aiPasses: 0, ocrImages: 0 });
  assert.ok(logs.includes('🤖 AI Web: JSON API response detected (1 candidate event object(s))'));
  assert.ok(logs.includes('🤖 AI Web: Extracted 1 event(s) from JSON API structured data — skipping OCR and AI extraction'));
});

test('extractEventsFromJsonApiPayload expands a detail-shaped payload into one event per performance', () => {
  const parser = createParser();
  const detailPayload = {
    data: {
      ...REDEYE_SEARCH_PAYLOAD.data[0],
      performances: [
        { start_at: '2026-07-26T01:00:00Z', end_at: '2026-07-26T08:00:00Z' },
        { start_at: '2026-08-02T01:00:00Z' }
      ]
    }
  };

  const events = parser.extractEventsFromJsonApiPayload(detailPayload, REDEYE_SOURCE_URL, null);
  assert.equal(events.length, 2);
  assert.equal(events[0].title, 'GOLDILOXX JULY');
  assert.equal(events[0].startDate.toISOString(), '2026-07-26T01:00:00.000Z');
  assert.equal(events[0].endDate.toISOString(), '2026-07-26T08:00:00.000Z');
  assert.equal(events[1].startDate.toISOString(), '2026-08-02T01:00:00.000Z');
  assert.equal(events[1].endDate, null);
  // Shared outer fields reach every performance
  assert.equal(events[0].bar, 'Red Eye NY');
  assert.equal(events[1].bar, 'Red Eye NY');
  assert.equal(events[1].url, REDEYE_SOURCE_URL);
});

test('parseEvents handles an empty JSON API payload: detection logged, zero events, no throw', async () => {
  const parser = createParser();
  parser.extractOcrFromAllImages = async () => [];
  let extractionAttempts = 0;
  parser.extractEventsFromSinglePage = async () => { extractionAttempts += 1; return []; };

  let result;
  const logs = await captureLogsAsync(async () => {
    result = await parser.parseEvents(
      { url: 'https://api.redeyetickets.com/api/v2/events/search?venue=empty', html: '{"data":[],"meta":{}}' },
      {},
      null,
      'event-page',
      null
    );
  });

  assert.equal(result.events.length, 0);
  assert.ok(extractionAttempts >= 1, 'the AI pathway still runs on an empty payload (fail open)');
  assert.ok(logs.includes('🤖 AI Web: JSON API response detected (0 candidate event object(s))'));
});

test('parseEvents fails open on unrecognizable JSON: linearized lines feed the AI pathway', async () => {
  const parser = createParser();
  parser.extractOcrFromAllImages = async () => [];
  let extractionAttempts = 0;
  let receivedHtml = null;
  parser.extractEventsFromSinglePage = async (htmlData) => {
    extractionAttempts += 1;
    receivedHtml = htmlData && htmlData.html ? htmlData.html : '';
    return [];
  };

  let result;
  const logs = await captureLogsAsync(async () => {
    result = await parser.parseEvents(
      { url: 'https://api.example/v1/things', html: '{"foo":[{"bar":1,"baz":"qux"}],"note":"hello"}' },
      {},
      null,
      'event-page',
      null
    );
  });

  assert.equal(result.events.length, 0);
  assert.ok(extractionAttempts >= 1, 'AI extraction must still be attempted (fail open)');
  const lines = String(receivedHtml).split('\n');
  assert.ok(lines.length > 1, 'linearized content has more than one line');
  assert.ok(lines.includes('foo[0].bar: 1'));
  assert.ok(lines.includes('foo[0].baz: qux'));
  assert.ok(lines.includes('note: hello'));
  assert.ok(logs.includes('🤖 AI Web: JSON API response detected (0 candidate event object(s))'));
  assert.ok(logs.includes('🤖 AI Web: JSON API payload linearized to 3 line(s) for AI extraction (structured conversion incomplete: missing title, startDate)'));
});

test('detectJsonApiPayload ignores HTML and malformed JSON; the JSON-LD fast path is unchanged', async () => {
  const parser = createParser();
  assert.equal(parser.detectJsonApiPayload(SICKENING_JSONLD_HTML), null);
  assert.equal(parser.detectJsonApiPayload('  <html><body>{"not":"the start"}</body></html>'), null);
  assert.equal(parser.detectJsonApiPayload('{"unterminated": '), null);
  assert.equal(parser.detectJsonApiPayload('"just a string"'), null);
  assert.equal(parser.detectJsonApiPayload(''), null);

  // Regression: the existing HTML fixture still takes the JSON-LD structured
  // path with the exact same outcome as before the JSON-API pathway existed.
  parser.extractOcrFromAllImages = async () => {
    throw new Error('OCR should not run when JSON-LD covers the event');
  };
  parser.core.callAiGenerate = async () => {
    throw new Error('AI should not be called when JSON-LD covers the event');
  };
  const result = await parser.parseEvents(
    { url: 'https://sickening.events/e/bearracuda-portland-pridefriday', html: SICKENING_JSONLD_HTML },
    {},
    null,
    'event-page',
    null
  );
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title, 'Bearracuda Portland:PRIDE FRIDAY');
  assert.equal(result.events[0].bar, 'Nova PDX');
  assert.equal(result.extractionSummary.source, 'jsonld');
});

test('buildEventFromJsonApiObject strips HTML from descriptions and never invents ticket URLs from slugs', () => {
  const parser = createParser();
  const event = parser.buildEventFromJsonApiObject({
    name: 'BEAR NIGHT',
    slug: 'bear-night-august',
    description: '<div><strong>Go-go bears</strong> &amp; friends</div>',
    start_at: '2026-08-08T02:00:00Z',
    flyer_url: 'https://cdn.example/flyer.jpg'
  }, 'https://api.example/v1/events/bear-night-august', null);

  assert.equal(event.title, 'BEAR NIGHT');
  assert.equal(event.description, 'Go-go bears & friends');
  assert.ok(!/</.test(event.description), 'tags are stripped');
  assert.equal(event.url, 'https://api.example/v1/events/bear-night-august');
  assert.equal(event.ticketUrl, '', 'a slug is not an absolute URL — nothing is fabricated');
  assert.equal(event.image, 'https://cdn.example/flyer.jpg');
  assert.equal(event.imageSource, 'json-api');
});

test('linearizeJsonForPrompt emits keyPath lines for scalar leaves, skipping null/empty and stripping tags', () => {
  const parser = createParser();
  const linearized = parser.linearizeJsonForPrompt({
    data: [{ name: 'GOLDILOXX', empty: '', missing: null, nested: { count: 2 } }],
    note: '<b>bold</b> text'
  });
  assert.deepEqual(linearized.split('\n'), [
    'data[0].name: GOLDILOXX',
    'data[0].nested.count: 2',
    'note: bold text'
  ]);
});

// ===========================================================================
// run 20260727-145617 fixes: diacritic-folded city matching (Fix 1),
// postal-code degenerate-event gate (Fix 2), calendar-export crawl block (Fix 4)
// ===========================================================================

test('city matching folds diacritics: "Montréal" text and city values resolve the montreal config entry', () => {
  const parser = createParser();
  const cityConfig = {
    montreal: { name: 'Montreal', timezone: 'America/Toronto', patterns: ['montreal', 'mtl'] },
    nyc: { timezone: 'America/New_York', patterns: ['new york', 'nyc'] }
  };
  // Literal run 20260727-145617 address shape (accented city inside free text)
  assert.equal(parser.findCityKeyInText('Bain Mathieu, 2915 Rue Ontario E, Montréal, QC H2K 1X7', cityConfig), 'montreal');
  // Accented city value → timezone (the run left these wall-clock UTC)
  assert.equal(parser.getTimezoneForCity('montréal', cityConfig), 'America/Toronto');
  assert.equal(parser.getTimezoneForCity('Montréal', cityConfig), 'America/Toronto');
  assert.equal(parser.getTimezoneForCity('MONTRÉAL', cityConfig), 'America/Toronto');
  // findCityConfigEntry folds too
  assert.equal(parser.findCityConfigEntry('Montréal', cityConfig).key, 'montreal');
  // Unaccented regression: byte-identical to pre-fix behavior
  assert.equal(parser.findCityKeyInText('123 Main St, Montreal, QC', cityConfig), 'montreal');
  assert.equal(parser.getTimezoneForCity('montreal', cityConfig), 'America/Toronto');
  assert.equal(parser.getTimezoneForCity('new york', cityConfig), 'America/New_York');
  assert.equal(parser.getTimezoneForCity('atlantis', cityConfig), '');
});

test('postal-code titles: only a title that is NOTHING but a postal code is degenerate', () => {
  const parser = createParser();
  // Literal run title (Canadian postal code) plus the stated shapes
  assert.equal(parser.isPostalCodeOnlyTitle('H2K 1X7'), true);
  assert.equal(parser.isPostalCodeOnlyTitle('h2k 1x7'), true);
  assert.equal(parser.isPostalCodeOnlyTitle('H2K-1X7'), true);
  assert.equal(parser.isPostalCodeOnlyTitle('90210'), true);
  assert.equal(parser.isPostalCodeOnlyTitle('90210-1234'), true);
  assert.equal(parser.isPostalCodeOnlyTitle('SW1A 1AA'), true);
  // Titles containing anything else survive (fail closed)
  assert.equal(parser.isPostalCodeOnlyTitle('Party at H2K 1X7'), false);
  assert.equal(parser.isPostalCodeOnlyTitle('SW4'), false, 'outward-only UK shorthand is not a full postcode');
  assert.equal(parser.isPostalCodeOnlyTitle('Bear Night'), false);
  assert.equal(parser.isPostalCodeOnlyTitle('Furball 2026'), false);
  assert.equal(parser.isPostalCodeOnlyTitle(''), false);
  assert.equal(parser.isPostalCodeOnlyTitle(null), false);
});

test('postal-code gate: extractSingleEvent skips the literal "H2K 1X7" extraction with the skip log', async () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  // Mirrors the run: an address block's postal code became a fully-formed
  // "event" (bar "Bear-IT", city "canada", zero duration) and reached preview.
  parser.getAiEvent = async () => ({
    title: 'H2K 1X7',
    startDate: '2026-07-27',
    __preValidatedFields: ['startDate']
  });
  let event = 'unset';
  const logs = await captureLogsAsync(async () => {
    event = await parser.extractSingleEvent(
      { html: 'Bear-IT\n2915 Rue Ontario E, Montréal, QC H2K 1X7\nJuly 27 2026', url: 'https://bear-it.example/events' },
      {}, null, ['title', 'startDate']
    );
  });
  assert.equal(event, null, 'a postal-code title never becomes an event');
  assert.ok(
    logs.includes('🤖 AI Web: Skipped degenerate event "H2K 1X7" — title is a postal code, not an event'),
    `skip log expected, got: ${JSON.stringify(logs.filter(line => line.includes('AI Web')))}`
  );
});

test('validateEventUrl rejects calendar-export URLs (literal run URLs) but keeps date-in-path event URLs', () => {
  const parser = createParser();
  const sourceUrl = 'https://bear-it.example/events/';
  // The three literal shapes the crawler followed into empty responses
  assert.equal(
    parser.validateEventUrl('https://bear-it.example/events/2026-07-27/?ical=1/', sourceUrl, {}).reason,
    'calendar-export-url');
  assert.equal(
    parser.validateEventUrl('https://bear-it.example/events/mois/?ical=1', sourceUrl, {}).reason,
    'calendar-export-url');
  assert.equal(
    parser.validateEventUrl('https://bear-it.example/events/2026-07-27/?outlook-ical=1', sourceUrl, {}).reason,
    'calendar-export-url');
  // The Events Calendar date-filter links and .ics exports are also blocked
  assert.equal(
    parser.validateEventUrl('https://bear-it.example/events/?tribe-bar-date=2026-07-27', sourceUrl, {}).reason,
    'calendar-export-url');
  assert.equal(
    parser.validateEventUrl('https://bear-it.example/events/export.ics', sourceUrl, {}).reason,
    'calendar-export-url');
  // Normal event URLs with dates in the path stay valid
  assert.equal(parser.validateEventUrl('https://bear-it.example/events/2026-07-27/', sourceUrl, {}).valid, true);
  assert.equal(parser.validateEventUrl('https://bear-it.example/events/bear-night-2026-07-27', sourceUrl, {}).valid, true);
  // "ical" inside a slug or query VALUE is not an export flag
  assert.equal(parser.validateEventUrl('https://bear-it.example/events/musical-bears?musical=1', sourceUrl, {}).valid, true);
});

// ---------------------------------------------------------------------------
// Shared-meridiem time ranges (Fix: QUENCHD — "1-7PM" contains "7pm" but not
// "1pm", so the evidence gate dropped the 13:00 start and it defaulted to
// local midnight)
// ---------------------------------------------------------------------------

test('hasTimeEvidence: a shared-meridiem range corroborates the leading hour', () => {
  const parser = createParser();
  const range = parser.buildAiEvidenceContextFromText('SUNDAY BEER BUST 1-7PM at QUENCHD');
  assert.equal(parser.hasTimeEvidence(range, '13:00'), true, '"1-7PM" states a 1pm start');
  assert.equal(parser.hasTimeEvidence(range, '19:00'), true, '"1-7PM" still states the 7pm end');

  const singleLetter = parser.buildAiEvidenceContextFromText('Patio party 11a-4p with DJ');
  assert.equal(parser.hasTimeEvidence(singleLetter, '11:00'), true, '"11a-4p" states an 11am start');
  assert.equal(parser.hasTimeEvidence(singleLetter, '16:00'), true, '"11a-4p" states a 4pm end');
});

test('hasTimeEvidence: a lone meridiem time is NOT expanded (no false pass)', () => {
  const parser = createParser();
  const plain = parser.buildAiEvidenceContextFromText('Doors 7PM sharp');
  assert.equal(parser.hasTimeEvidence(plain, '13:00'), false, 'plain "7PM" must still reject 13:00');
  assert.equal(parser.hasTimeEvidence(plain, '19:00'), true);
});

// ---------------------------------------------------------------------------
// AI free-text markup strip (Fix: CubScout description was a raw <img> tag
// copied verbatim from The Events Calendar's JSON-LD description)
// ---------------------------------------------------------------------------

test('normalizeAiEvent strips markup from AI descriptions; markup-only falls back to img alt text', () => {
  const parser = createParser();
  const base = { title: 'CubScout First Fridays', startDate: '2026-08-07', startTime: '21:00' };

  const markupOnly = parser.normalizeAiEvent({
    ...base,
    description: '<img loading="lazy" class="size-full" src="https://cubscout.example/flyer.jpg" alt="CubScout First Fridays 9pm $7" width="1080" height="1350">'
  }, {}, null, null, null);
  assert.equal(markupOnly.description, 'CubScout First Fridays 9pm $7',
    'markup-only description adopts the image alt text');

  const inline = parser.normalizeAiEvent({
    ...base,
    description: 'Doors open at <b>9pm</b> — bring your <i>cub</i> card'
  }, {}, null, null, null);
  assert.equal(inline.description, 'Doors open at 9pm — bring your cub card',
    'inline tags are stripped, text kept');

  const plain = 'Plain-text description with  double spaces and\nnewlines stays byte-identical';
  const untouched = parser.normalizeAiEvent({ ...base, description: plain }, {}, null, null, null);
  assert.equal(untouched.description, plain, 'plain text must pass through byte-identical');
});

// ---------------------------------------------------------------------------
// Whole-page fallback when segment discovery finds nothing (Fix: Lumberyard —
// multi-event classification + zero valid segments returned no events despite
// real page content and OCR'd flyers)
// ---------------------------------------------------------------------------

test('multi-event page with no valid segments falls back to whole-page extraction', async () => {
  const parser = createParser();
  const stubEvents = [{ title: 'LUMBERYARD TAKEOVER', startDate: new Date('2026-08-01T02:00:00.000Z') }];
  let singlePageCalls = 0;
  parser.extractEventsFromSinglePage = async () => { singlePageCalls += 1; return stubEvents; };
  const html = `<html><body>
    <p>The Lumberyard is the desert's favorite bear bar patio, with rotating parties, beer busts,
    and special guests all season long. Check the flyers below for everything coming up this month.</p>
  </body></html>`;
  const events = await parser.extractEventsFromMultiEventPage(
    { html, url: 'https://lumberyard.example/events' }, {}, null, ['title'], [], null);
  assert.equal(singlePageCalls, 1, 'single-page extraction must be invoked as the fallback');
  assert.deepEqual(events, stubEvents, 'the fallback events are returned');
});

test('whole-page fallback is guarded: no content, discoveryOnly, and link-aggregator all still return none', async () => {
  const parser = createParser();
  parser.extractEventsFromSinglePage = async () => { throw new Error('single-page extraction must not run'); };

  const noContent = await parser.extractEventsFromMultiEventPage(
    { html: '<html><body></body></html>', url: 'https://x.example/' }, {}, null, ['title'], [], null);
  assert.deepEqual(noContent, [], 'a contentless page never falls back');

  const discovery = await parser.extractEventsFromMultiEventPage(
    { html: '<p>Plenty of body content here that would otherwise justify the whole-page fallback path.</p>', url: 'https://x.example/' },
    { discoveryOnly: true }, null, ['title'], [], null);
  assert.deepEqual(discovery, [], 'discoveryOnly never falls back');

  const aggregator = await parser.parseEvents(
    { html: '<html><body><a href="https://a.example/1">One</a></body></html>', url: 'https://x.example/' },
    {}, null, 'link-aggregator', null);
  assert.deepEqual(aggregator.events, [], 'link-aggregator pages still return no events');
});

// ---------------------------------------------------------------------------
// Promoter names can never be a city (Fix: OCR "TALENT PRESENTED BY
// biggercity" leaked city='biggercity' → unknown-city/no-timezone noise)
// ---------------------------------------------------------------------------

test('normalizeAiEvent rejects a city matching a registry promoter name, keeps real cities', () => {
  const parser = new AiWebParser({ normalizeUrl });
  parser.core = new SharedCore({}, {
    eventSchema: EventSchema,
    // Test-only stub entry — BiggerCity is deliberately NOT in data/promoters.json
    promoters: [{ name: 'BiggerCity', instagram: 'https://www.instagram.com/biggercity' }]
  });

  const promoterCity = parser.normalizeAiEvent(
    { title: 'CCBC WEEKEND', startDate: '2026-05-22', startTime: '20:00', city: 'biggercity' },
    {}, null, null, null);
  assert.equal(promoterCity.city, '', 'a promoter-named city is cleared');

  const realCity = parser.normalizeAiEvent(
    { title: 'PUP NIGHT', startDate: '2026-05-22', startTime: '20:00', city: 'montreal' },
    {}, null, null, null);
  assert.equal(realCity.city, 'montreal', 'real cities are untouched');

  // Fail open: no registry on the core → the city is kept as-is
  const bareParser = new AiWebParser({ normalizeUrl });
  bareParser.core = new SharedCore({}, { eventSchema: EventSchema });
  const noRegistry = bareParser.normalizeAiEvent(
    { title: 'CCBC WEEKEND', startDate: '2026-05-22', startTime: '20:00', city: 'biggercity' },
    {}, null, null, null);
  assert.equal(noRegistry.city, 'biggercity');
});

test('getAiPromptFields: rrule is requested from the default field priorities', () => {
  // Ensure the real schema is active (an earlier test swaps in a mock).
  global.EventSchema = EventSchema;
  const parser = createParser();
  const fields = parser.getAiPromptFields({}, {});
  const normalized = fields.map(f => parser.normalizePromptFieldName(f));
  assert.ok(normalized.includes('recurrence'), 'rrule (canonical: recurrence) is requested by default');
  assert.equal(parser.isPromptFieldRequested('rrule', {}), true,
    'normalizeAiEvent will map the extracted rrule into event.recurrenceRule');
});

// ---------------------------------------------------------------------------
// rrule validation ('schedule-evidence' mode): an RRULE is a derived
// translation, never verbatim — the gate checks the model's EVIDENCE phrase
// against the corpus instead (run 20260728-113040, CubScout / The Lumberyard)
// ---------------------------------------------------------------------------

const RRULE_TEST_CORPUS = 'CUBSCOUT — A NIGHT FOR CUBS, SCOUTS AND EVERYONE ELSE. 1ST FRIDAY OF THE MONTH AT THE EAGLE LA. EVERY 2ND FRIDAY karaoke night. every Tuesday trivia with the pack.';

function runRruleValidation(parser, aiEvent) {
  const evidenceContext = parser.buildAiEvidenceContextFromText(RRULE_TEST_CORPUS);
  const validationContext = { imageEvidenceUrls: new Set() };
  return parser.validateAiEventEvidence(aiEvent, { html: RRULE_TEST_CORPUS }, {}, null, {
    evidenceContext,
    validationContext
  });
}

test('rrule survives the evidence gate when its schedule evidence is verbatim and corroborates the rule', () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  // The literal CubScout case the exact-mode gate used to drop 100% of the time.
  const result = runRruleValidation(parser, {
    rrule: 'FREQ=MONTHLY;BYDAY=1FR',
    __fieldEvidence: { rrule: '1ST FRIDAY OF THE MONTH' }
  });
  assert.equal(result.event.rrule, 'FREQ=MONTHLY;BYDAY=1FR', 'a correct derived RRULE is kept');
  assert.deepEqual(result.report.dropped, [], 'nothing dropped');
});

test('merge-canonicalized recurrence reaches event.recurrenceRule under both response namings', () => {
  // Battery run 20260728 (CubScout): the schedule-evidence gate KEPT the
  // extracted rrule, but the pass merge stores it under the canonical
  // 'recurrence' key and normalizeAiEvent only read recurrenceRule/rrule —
  // so ZERO events battery-wide ever carried recurrence. Replay the literal
  // CubScout response shape through validation → merge → assembly for both
  // prompt namings ('rrule' and 'recurrence').
  global.EventSchema = EventSchema;
  for (const keyName of ['rrule', 'recurrence']) {
    const parser = createParser();
    parser.now = () => new Date(2026, 6, 22, 15, 0, 0); // Wed 2026-07-22 local
    const partial = {
      title: 'CUBSCOUT',
      [keyName]: 'FREQ=MONTHLY;BYDAY=1FR',
      __fieldEvidence: { [keyName]: '1ST FRIDAY OF THE MONTH' }
    };
    const validated = runRruleValidation(parser, partial);
    assert.equal(validated.event[keyName], 'FREQ=MONTHLY;BYDAY=1FR',
      `${keyName}: the schedule-evidence gate keeps the corroborated rule`);
    const merged = parser.mergeAiEventFields({}, validated.event);
    assert.equal(merged.recurrence, 'FREQ=MONTHLY;BYDAY=1FR',
      `${keyName}: the pass merge stores the canonical recurrence key`);
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => { logs.push(args.join(' ')); };
    let event;
    try {
      event = parser.normalizeAiEvent(merged, {}, null, null, null);
    } finally {
      console.log = originalLog;
    }
    assert.ok(event, `${keyName}: the recurring event survives assembly`);
    assert.equal(event.recurrenceRule, 'FREQ=MONTHLY;BYDAY=1FR',
      `${keyName}: the canonical recurrence value lands on event.recurrenceRule`);
    assert.ok(logs.some(line => line.startsWith('🔁 RECURRING: derived next occurrence')),
      `${keyName}: the recurring derivation log fires`);
  }
});

test('whole-page fallback rejects page-title echoes without same-pass time evidence', () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  // Battery run 20260728 (The Lumberyard): the homepage og:title
  // "White Center | United States | Lumber Yard Bar" (a neighborhood) became
  // the surviving event's title via a meta pass that carried no date/time.
  const html = '<html><head><meta property="og:title" content="White Center | United States | Lumber Yard Bar" />'
    + '<title>White Center | United States | Lumber Yard Bar</title></head><body>events</body></html>';
  const fallbackHtmlData = { html, url: 'https://www.thelumberyardbar.com/', _wholePageFallback: true };

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  let guarded;
  let withSchedule;
  let notFallback;
  try {
    guarded = parser.rejectPageTitleEchoPassFields(
      { title: 'White Center', url: 'https://www.thelumberyardbar.com/' },
      fallbackHtmlData
    );
    // A pass carrying the title TOGETHER with its schedule always passes —
    // the goldiloxx-chicago class (og:title IS the event name, full schedule).
    withSchedule = parser.rejectPageTitleEchoPassFields(
      { title: 'White Center', startDate: '2026-07-31', startTime: '21:00' },
      fallbackHtmlData
    );
    // Ordinary (non-fallback) pages are untouched.
    notFallback = parser.rejectPageTitleEchoPassFields(
      { title: 'White Center' },
      { html, url: 'https://www.thelumberyardbar.com/' }
    );
  } finally {
    console.log = originalLog;
  }
  assert.equal(guarded.title, undefined, 'the og:title echo is rejected on the fallback path');
  assert.equal(guarded.url, 'https://www.thelumberyardbar.com/', 'other fields survive');
  assert.ok(logs.includes('🤖 AI Web: Skipped page-title echo "White Center" — not an event'),
    `the junk-gate log fires, got: ${JSON.stringify(logs)}`);
  assert.equal(withSchedule.title, 'White Center', 'a title with same-pass time evidence is kept');
  assert.equal(notFallback.title, 'White Center', 'non-fallback extraction is untouched');

  // A real event name absent from the page's own titles is never rejected.
  const realEvent = parser.rejectPageTitleEchoPassFields(
    { title: 'GLOW: THE SEQUEL' },
    fallbackHtmlData
  );
  assert.equal(realEvent.title, 'GLOW: THE SEQUEL');
});

test('the schedule-evidence gate drops mismatched rules under the recurrence naming too', () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  let mismatch;
  try {
    mismatch = runRruleValidation(parser, {
      recurrence: 'FREQ=WEEKLY;BYDAY=FR',
      __fieldEvidence: { recurrence: 'every Tuesday' }
    });
  } finally {
    console.log = originalLog;
  }
  assert.equal(mismatch.event.recurrence, undefined, 'weekday mismatch fails closed for the recurrence key');
  assert.equal(mismatch.report.dropped[0].reason, 'rrule-schedule-evidence');
  assert.ok(logs.includes('🤖 AI Web: Dropped rrule "FREQ=WEEKLY;BYDAY=FR" — schedule words in evidence do not corroborate the rule'),
    `the corroboration drop log fires on the recurrence-named path, got: ${JSON.stringify(logs)}`);
});

test('rrule validation rejects non-RRULE values, unverbatim evidence, and schedule mismatches', () => {
  global.EventSchema = EventSchema;
  const parser = createParser();

  // Value without FREQ= (schedule prose echoed back) → rejected.
  const prose = runRruleValidation(parser, {
    rrule: '1ST FRIDAY OF THE MONTH',
    __fieldEvidence: { rrule: '1ST FRIDAY OF THE MONTH' }
  });
  assert.equal(prose.event.rrule, undefined, 'prose is not an RRULE');
  assert.equal(prose.report.dropped[0].reason, 'rrule-schedule-evidence');

  // Evidence absent from the corpus AND no corpus day-word support for the
  // rule → rejected. (BYDAY=1SA: the corpus names no Saturday, so the
  // day-word fallback cannot rescue it — a 1FR rule with a fabricated
  // pointer IS rescued now because "1ST FRIDAY OF THE MONTH" is literally
  // in the corpus; see the corpus day-word fallback tests.)
  const absent = runRruleValidation(parser, {
    rrule: 'FREQ=MONTHLY;BYDAY=1SA',
    __fieldEvidence: { rrule: 'FIRST SATURDAY MONTHLY MEETUP' }
  });
  assert.equal(absent.event.rrule, undefined, 'evidence must be a verbatim corpus quote');
  assert.equal(absent.report.dropped[0].reason, 'rrule-schedule-evidence');

  // Weekday mismatch (BYDAY=FR, evidence names Tuesday) → rejected with the
  // distinct corroboration log line.
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  let mismatch;
  try {
    mismatch = runRruleValidation(parser, {
      rrule: 'FREQ=WEEKLY;BYDAY=FR',
      __fieldEvidence: { rrule: 'every Tuesday' }
    });
  } finally {
    console.log = originalLog;
  }
  assert.equal(mismatch.event.rrule, undefined, 'weekday mismatch fails closed');
  assert.ok(logs.includes('🤖 AI Web: Dropped rrule "FREQ=WEEKLY;BYDAY=FR" — schedule words in evidence do not corroborate the rule'),
    `distinct mismatch log expected, got: ${JSON.stringify(logs)}`);

  // FREQ=WEEKLY on ordinal-weekday prose ("EVERY 2ND FRIDAY" is a monthly
  // pattern — the Lumberyard model error) → the gate still drops it, and the
  // schedule-mismatch recovery then reads the CORRECT rule out of that same
  // quote (see the dedicated recovery test below).
  const ordinalWeekly = runRruleValidation(parser, {
    rrule: 'FREQ=WEEKLY;BYDAY=FR',
    __fieldEvidence: { rrule: 'EVERY 2ND FRIDAY' }
  });
  assert.equal(ordinalWeekly.report.dropped[0].reason, 'rrule-schedule-evidence',
    'the gate still drops the mistranslated rule');
  assert.equal(ordinalWeekly.event.rrule, 'FREQ=MONTHLY;BYDAY=2FR',
    'the ordinal the model mistranslated is recovered from its own evidence');

  // Sanity: a genuinely weekly statement passes.
  const weekly = runRruleValidation(parser, {
    rrule: 'FREQ=WEEKLY;BYDAY=TU',
    __fieldEvidence: { rrule: 'every Tuesday' }
  });
  assert.equal(weekly.event.rrule, 'FREQ=WEEKLY;BYDAY=TU');
});

test('rrule retry feedback uses the RRULE-specific correction line, never "copy the exact text"', () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  const merged = {
    __droppedFieldValues: { recurrence: 'FREQ=MONTHLY;BYDAY=1FR' },
    __droppedFieldReasons: { recurrence: 'rrule-schedule-evidence' }
  };
  const feedback = parser.buildRetryDropFeedback(['rrule'], merged);
  assert.deepEqual(feedback, {
    recurrence: { value: 'FREQ=MONTHLY;BYDAY=1FR', reason: 'rrule-schedule-evidence' }
  }, 'rrule drops ride the tagged { value, reason } shape');

  const prompt = parser.buildExtractionPrompt(
    { html: 'x', url: 'https://a.example/' },
    parser.getAiConfig({}),
    null, {}, ['rrule'], 'SNIPPET', 'alternate', {}, feedback
  );
  assert.ok(prompt.includes('Your previous value "FREQ=MONTHLY;BYDAY=1FR" for recurrence was rejected — return a valid iCal RRULE (FREQ=...) that matches the schedule stated in the source, and cite the schedule wording as evidence.'),
    'the class-specific retry line is emitted');
  assert.ok(!prompt.includes('Copy the exact text'),
    'the not-verbatim line never fires for the rrule class');
});

// ---------------------------------------------------------------------------
// Dateless recurring events: a valid RRULE derives the next occurrence as
// startDate instead of dying on the required-field guard (The Lumberyard)
// ---------------------------------------------------------------------------

test('normalizeAiEvent derives the next occurrence for a dateless recurring event', () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  parser.now = () => new Date(2026, 6, 22, 15, 0, 0); // Wed 2026-07-22 local

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  let event;
  try {
    event = parser.normalizeAiEvent(
      { title: 'DRINK AND DRAW', rrule: 'FREQ=WEEKLY;BYDAY=TU' },
      {}, null, null, null
    );
  } finally {
    console.log = originalLog;
  }
  assert.ok(event, 'the recurring event survives normalization');
  assert.equal(event.recurrenceRule, 'FREQ=WEEKLY;BYDAY=TU');
  assert.ok(event.startDate instanceof Date, 'derived startDate is a Date');
  assert.equal(event.startDate.toISOString().slice(0, 10), '2026-07-28', 'next Tuesday from the injected now');
  assert.equal(event._recurringNoStartTime, true, 'no stated start time → flagged for ICS gating');
  assert.ok(logs.includes('🔁 RECURRING: derived next occurrence 2026-07-28 from rrule for "DRINK AND DRAW"'),
    `derivation log expected, got: ${JSON.stringify(logs.filter(l => l.includes('RECURRING')))}`);
});

test('normalizeAiEvent combines an extracted startTime with the derived occurrence date', () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  parser.now = () => new Date(2026, 6, 22, 15, 0, 0);
  const cityConfig = { la: { timezone: 'America/Los_Angeles', patterns: ['los angeles'] } };
  const event = parser.normalizeAiEvent(
    { title: 'CUBSCOUT', rrule: 'FREQ=MONTHLY;BYDAY=1FR', startTime: '21:00', city: 'los angeles' },
    {}, null, cityConfig, null
  );
  assert.ok(event, 'survives with a derived date');
  // 1st Friday after Wed Jul 22 is Aug 7; 9pm PDT = Aug 8 04:00 UTC
  assert.equal(event.startDate.toISOString(), '2026-08-08T04:00:00.000Z');
  assert.equal(event._recurringNoStartTime, undefined, 'a stated start time keeps the ICS export');
});

test('normalizeAiEvent still discards dateless events with unsupported or missing rrules', () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  parser.now = () => new Date(2026, 6, 22, 15, 0, 0);
  assert.equal(parser.normalizeAiEvent({ title: 'X', rrule: 'FREQ=YEARLY' }, {}, null, null, null), null,
    'unsupported rrule form → discarded exactly as before');
  assert.equal(parser.normalizeAiEvent({ title: 'Y' }, {}, null, null, null), null,
    'no rrule, no date → discarded exactly as before');
});

// ---------------------------------------------------------------------------
// Dateless-weekly day-phrase synthesis (run 20260802-140413, The Lumberyard):
// pages that state a weekday pattern but never a date — deterministic regex
// turns the phrase into an rrule + next occurrence so the event reaches the
// existing recurring-withhold machinery instead of dying on the
// required-startDate guard
// ---------------------------------------------------------------------------

const LUMBERYARD_CITY_CONFIG = { seattle: { timezone: 'America/Los_Angeles', patterns: ['seattle'] } };
const LUMBERYARD_QUEERAOKE_TEXT = 'QUEERAOKE Wednesday nights @ 8:30pm Come Join Bumper and Sing your heart out.';
const LUMBERYARD_DRINK_DRAW_TEXT = 'Hosted by Nathan (except the last Tuesday - Drink and Draw)';

function normalizeDayPhraseEvent(parser, aiEvent, sourceText, cityConfig = LUMBERYARD_CITY_CONFIG) {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  let event;
  try {
    event = parser.normalizeAiEvent(aiEvent, {}, { html: sourceText, url: 'https://www.thelumberyardbar.com/' }, cityConfig, null);
  } finally {
    console.log = originalLog;
  }
  return { event, logs };
}

test('day-phrase synthesis: the real QUEERAOKE string becomes a weekly Wednesday 8:30pm series', () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  parser.now = () => new Date(2026, 7, 3, 12, 0, 0); // Mon 2026-08-03 local

  const { event, logs } = normalizeDayPhraseEvent(parser,
    { title: 'QUEERAOKE', city: 'seattle' }, LUMBERYARD_QUEERAOKE_TEXT);
  assert.ok(event, 'the dateless event survives normalization');
  assert.equal(event.recurrenceRule, 'FREQ=WEEKLY;BYDAY=WE');
  // Next Wednesday from Mon Aug 3 is Aug 5; 8:30pm PDT = Aug 6 03:30 UTC.
  assert.equal(event.startDate.toISOString(), '2026-08-06T03:30:00.000Z');
  assert.ok(event.startDate.getTime() > parser.now().getTime(), 'next occurrence is in the future');
  assert.equal(event._recurringNoStartTime, undefined, 'captured @ 8:30pm keeps the ICS export');
  assert.equal(event._recurrenceFromDayPhrase, 'wednesday nights', 'provenance stamps the matched phrase');
  assert.equal(event._timezoneUnresolved, undefined, 'resolved timezone → real instant');
  assert.ok(logs.includes('🔁 RECURRING: "QUEERAOKE" synthesized from day phrase "wednesday nights" → FREQ=WEEKLY;BYDAY=WE, next 2026-08-05 — will be withheld from calendar write (ICS only)'),
    `synthesis log expected, got: ${JSON.stringify(logs.filter(line => line.includes('RECURRING')))}`);
});

test('day-phrase synthesis: the real Drink & Draw string becomes a last-Tuesday monthly series (no stated time → existing no-start-time convention)', () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  parser.now = () => new Date(2026, 7, 3, 12, 0, 0);

  const { event, logs } = normalizeDayPhraseEvent(parser,
    { title: 'Drink & Draw', city: 'seattle' }, LUMBERYARD_DRINK_DRAW_TEXT);
  assert.ok(event, 'the dateless event survives normalization');
  assert.equal(event.recurrenceRule, 'FREQ=MONTHLY;BYDAY=-1TU');
  // Last Tuesday of Aug 2026 is Aug 25; no stated time → the existing
  // derived-occurrence convention (local-midnight placeholder +
  // _recurringNoStartTime, so the card offers the Event Builder link).
  assert.equal(event.startDate.toISOString(), '2026-08-25T07:00:00.000Z');
  assert.ok(event.startDate.getTime() > parser.now().getTime(), 'next occurrence is in the future');
  assert.equal(event._recurringNoStartTime, true, 'no stated time rides the existing no-start-time flag');
  assert.equal(event._recurrenceFromDayPhrase, 'last tuesday');
  assert.ok(logs.includes('🔁 RECURRING: "Drink & Draw" synthesized from day phrase "last tuesday" → FREQ=MONTHLY;BYDAY=-1TU, next 2026-08-25 — will be withheld from calendar write (ICS only)'),
    `synthesis log expected, got: ${JSON.stringify(logs.filter(line => line.includes('RECURRING')))}`);
});

test('day-phrase synthesis: "every Friday" and "2nd Saturday" variants, including a time range', () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  parser.now = () => new Date(2026, 7, 3, 12, 0, 0);

  const friday = normalizeDayPhraseEvent(parser,
    { title: 'BEAR NIGHT', city: 'seattle' }, 'BEAR NIGHT every Friday at 9pm with DJ Cub').event;
  assert.ok(friday);
  assert.equal(friday.recurrenceRule, 'FREQ=WEEKLY;BYDAY=FR');
  assert.equal(friday.startDate.toISOString(), '2026-08-08T04:00:00.000Z', 'next Friday Aug 7, 9pm PDT');
  assert.equal(friday._recurrenceFromDayPhrase, 'every friday');

  const saturday = normalizeDayPhraseEvent(parser,
    { title: 'UNDERWEAR PARTY', city: 'seattle' }, 'UNDERWEAR PARTY 2nd Saturday @ 10pm').event;
  assert.ok(saturday);
  assert.equal(saturday.recurrenceRule, 'FREQ=MONTHLY;BYDAY=2SA');
  assert.equal(saturday.startDate.toISOString(), '2026-08-09T05:00:00.000Z', '2nd Saturday Aug 8, 10pm PDT');

  // Range with an explicit end time: end anchors to the same occurrence.
  const range = normalizeDayPhraseEvent(parser,
    { title: 'BEER BUST', city: 'seattle' }, 'BEER BUST Sundays 4pm-9pm all are welcome').event;
  assert.ok(range);
  assert.equal(range.recurrenceRule, 'FREQ=WEEKLY;BYDAY=SU');
  assert.equal(range.startDate.toISOString(), '2026-08-09T23:00:00.000Z', 'next Sunday Aug 9, 4pm PDT');
  assert.equal(range.endDate.toISOString(), '2026-08-10T04:00:00.000Z', '9pm PDT end from the range tail');

  // "-close" has no clock value: start captured, end left to defaulting.
  const close = normalizeDayPhraseEvent(parser,
    { title: 'EXPOSED', city: 'seattle' }, 'EXPOSED UNDERWEAR OR LESS Fridays 8pm-close').event;
  assert.ok(close);
  assert.equal(close.recurrenceRule, 'FREQ=WEEKLY;BYDAY=FR');
  assert.equal(close.startDate.toISOString(), '2026-08-08T03:00:00.000Z', 'next Friday Aug 7, 8pm PDT');
  assert.equal(close.endDate.toISOString(), close.startDate.toISOString(), 'no end claim → existing defaulting');
});

test('day-phrase synthesis fails closed on multiple distinct day patterns in one segment', () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  parser.now = () => new Date(2026, 7, 3, 12, 0, 0);

  // A multi-pattern segment where the event's OWN day is stated right next
  // to its title resolves by title adjacency: "Trivia Tuesday nights @ 7"
  // is Trivia's schedule; the "last Tuesday" carve-out 40+ chars away
  // belongs to the neighbouring Drink and Draw listing. (The rrule cannot
  // express the "except" — the series is offered ICS-only and withheld from
  // calendar writes, so the operator sees it before importing.)
  const trivia = normalizeDayPhraseEvent(parser,
    { title: 'Trivia', city: 'seattle' },
    'Trivia Tuesday nights @ 7 Hosted by Nathan (except the last Tuesday - Drink and Draw)');
  assert.ok(trivia.event, 'title-adjacent day phrase resolves the multi-pattern segment');
  assert.equal(trivia.event.recurrenceRule, 'FREQ=WEEKLY;BYDAY=TU');
  assert.equal(trivia.event._recurrenceFromDayPhrase, 'tuesday nights');
  assert.equal(trivia.event.startDate.toISOString(), '2026-08-05T02:00:00.000Z', 'next Tuesday Aug 4, 7pm PDT from "@ 7"');

  // The REAL Lumberyard trivia wording states no day for Trivia itself —
  // "last Tuesday" (gap 30) belongs to Drink and Draw, outside the
  // adjacency bound — so it still fails closed and dies as today.
  const realTrivia = normalizeDayPhraseEvent(parser,
    { title: 'Trivia Taco night', city: 'seattle' },
    'Trivia Taco night Hosted by Nathan (except the last Tuesday - Drink and Draw) QUEERAOKE Wednesday nights @ 8:30pm');
  assert.equal(realTrivia.event, null, 'no title-adjacent phrase → no synthesis, event dies as before');
  assert.ok(realTrivia.logs.some(line => line.startsWith('🔁 RECURRING: skipped day-phrase synthesis for "Trivia Taco night" — multiple distinct day patterns in source (')),
    `fail-closed log expected, got: ${JSON.stringify(realTrivia.logs.filter(line => line.includes('RECURRING')))}`);

  // Directly conjoined day phrases are ONE multi-day listing — nearest-wins
  // would silently drop half the schedule, so adjacency refuses.
  const conjoined = normalizeDayPhraseEvent(parser,
    { title: 'HAPPY HOUR', city: 'seattle' }, 'HAPPY HOUR Mondays and Thursdays 4pm');
  assert.equal(conjoined.event, null, 'conjoined days stay ambiguous even when title-adjacent');

  // Two different weekdays → same fail-closed path.
  const twoDays = normalizeDayPhraseEvent(parser,
    { title: 'HAPPY HOUR', city: 'seattle' }, 'HAPPY HOUR Mondays and Thursdays 4pm');
  assert.equal(twoDays.event, null);

  // A bare singular weekday is how one-off dates are written — never a pattern.
  const bare = normalizeDayPhraseEvent(parser,
    { title: 'ONE OFF', city: 'seattle' }, 'Join us Friday for a special show');
  assert.equal(bare.event, null, 'bare singular weekday → no synthesis');
});

test('day-phrase synthesis without a resolved timezone follows the _timezoneUnresolved wall-clock convention', () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  parser.now = () => new Date(2026, 7, 3, 12, 0, 0);

  const { event } = normalizeDayPhraseEvent(parser, { title: 'QUEERAOKE' }, LUMBERYARD_QUEERAOKE_TEXT, null);
  assert.ok(event);
  assert.equal(event.recurrenceRule, 'FREQ=WEEKLY;BYDAY=WE');
  assert.equal(event.startDate.toISOString(), '2026-08-05T20:30:00.000Z', 'wall-clock components labeled UTC');
  assert.equal(event._timezoneUnresolved, true, 'flagged for downstream re-anchoring');
});

test('day-phrase synthesis never fires when a real date is present (regression pin)', () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  parser.now = () => new Date(2026, 7, 3, 12, 0, 0);

  const { event, logs } = normalizeDayPhraseEvent(parser,
    { title: 'ONE-OFF PARTY', startDate: '2026-08-15', startTime: '21:00', city: 'seattle' },
    'ONE-OFF PARTY Saturday August 15 — and come by every Friday for happy hour');
  assert.ok(event);
  assert.equal(event.startDate.toISOString(), '2026-08-16T04:00:00.000Z', 'the extracted real date stands');
  assert.equal(event.recurrenceRule, '', 'no rrule synthesized over a dated event');
  assert.equal(event._recurrenceFromDayPhrase, undefined);
  assert.ok(!logs.some(line => line.includes('synthesized from day phrase')), 'no synthesis log');
});

test('model rrule with day-word corpus evidence passes the schedule-evidence gate without a verbatim pointer', () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  const runWithCorpus = (aiEvent, corpus) => parser.validateAiEventEvidence(aiEvent, { html: corpus }, {}, null, {
    evidenceContext: parser.buildAiEvidenceContextFromText(corpus),
    validationContext: { imageEvidenceUrls: new Set() }
  });

  // No cited evidence at all → the corpus day-words carry the rule.
  const noEvidence = runWithCorpus({ rrule: 'FREQ=WEEKLY;BYDAY=WE' }, LUMBERYARD_QUEERAOKE_TEXT);
  assert.equal(noEvidence.event.rrule, 'FREQ=WEEKLY;BYDAY=WE', 'day-word corpus evidence accepted');
  assert.deepEqual(noEvidence.report.dropped, []);

  // Paraphrased (non-verbatim) pointer → rescued by corpus day-words.
  const paraphrased = runWithCorpus({
    rrule: 'FREQ=WEEKLY;BYDAY=WE',
    __fieldEvidence: { rrule: 'happens weekly on Wednesday evenings' }
  }, LUMBERYARD_QUEERAOKE_TEXT);
  assert.equal(paraphrased.event.rrule, 'FREQ=WEEKLY;BYDAY=WE');

  // Monthly ordinal: fabricated pointer, but the corpus states the ordinal
  // day phrase verbatim ("1ST FRIDAY OF THE MONTH" in RRULE_TEST_CORPUS).
  const monthly = runRruleValidation(parser, {
    rrule: 'FREQ=MONTHLY;BYDAY=1FR',
    __fieldEvidence: { rrule: 'FIRST FRIDAY MONTHLY MEETUP' }
  });
  assert.equal(monthly.event.rrule, 'FREQ=MONTHLY;BYDAY=1FR');

  // A day the corpus never names → still dropped.
  const wrongDay = runWithCorpus({ rrule: 'FREQ=WEEKLY;BYDAY=FR' }, LUMBERYARD_QUEERAOKE_TEXT);
  assert.equal(wrongDay.event.rrule, undefined, 'no day-word support → gated as before');

  // Bare singular weekday prose is a one-off date, not weekly evidence.
  const bareSingular = runWithCorpus({ rrule: 'FREQ=WEEKLY;BYDAY=FR' }, 'Doors at 8, Friday, August 7');
  assert.equal(bareSingular.event.rrule, undefined);
});

test('non-BYDAY-only rrules never use the corpus day-word fallback', () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  const runWithCorpus = (aiEvent) => parser.validateAiEventEvidence(aiEvent, { html: LUMBERYARD_QUEERAOKE_TEXT }, {}, null, {
    evidenceContext: parser.buildAiEvidenceContextFromText(LUMBERYARD_QUEERAOKE_TEXT),
    validationContext: { imageEvidenceUrls: new Set() }
  });

  const interval = runWithCorpus({ rrule: 'FREQ=WEEKLY;BYDAY=WE;INTERVAL=2' });
  assert.equal(interval.event.rrule, undefined, 'INTERVAL stays gated exactly as today');
  const daily = runWithCorpus({ rrule: 'FREQ=DAILY' });
  assert.equal(daily.event.rrule, undefined, 'no BYDAY → no fallback');
});

test('e2e: a day-phrase synthesized event is withheld from calendar writes (ICS export path)', async () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  parser.now = () => new Date(2026, 7, 3, 12, 0, 0);
  const { event } = normalizeDayPhraseEvent(parser,
    { title: 'QUEERAOKE', city: 'seattle' }, LUMBERYARD_QUEERAOKE_TEXT);
  assert.ok(event);
  assert.equal(SharedCore.isRecurringSeriesEvent(event), true,
    'the synthesized rrule lands on recurrenceRule — the key the series detection reads');

  const core = new SharedCore({}, { eventSchema: EventSchema });
  const adapter = { getExistingEvents: async () => [] };
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  let analyzed;
  try {
    analyzed = await core.prepareEventsForCalendar([event], adapter, {});
  } finally {
    console.log = originalLog;
  }
  assert.equal(analyzed.length, 1, "flag-don't-drop: the synthesized series stays in the results");
  assert.equal(analyzed[0]._recurring, true);
  assert.equal(analyzed[0]._recurringExport, true, 'stamped for the results-UI ICS export');
  assert.equal(analyzed[0].recurrenceRule, 'FREQ=WEEKLY;BYDAY=WE', 'rrule survives for the ICS export');
  assert.ok(logs.some(line => line.includes('🔁 RECURRING: "QUEERAOKE" withheld from calendar write — save via ICS export')),
    `withhold log expected, got: ${JSON.stringify(logs.filter(line => line.includes('RECURRING')))}`);
  assert.deepEqual(SharedCore.filterEventsForExecution(analyzed), [],
    'NO calendar write action results from the synthesized series');
});

// ── Multilingual segment date signals (es/ca/fr/de/it/pt) ──────────────────

test('multilingual weekday headings and month+day dates register as date signals', () => {
  const parser = createParser();
  // Spanish schedule headings (Bears Sitges Week shape) — with and without accents
  assert.equal(parser.hasMultiEventDateSignal('JUEVES- 03'), true, 'es weekday + day');
  assert.equal(parser.hasMultiEventDateSignal('SÁBADO - 05'), true, 'accented es weekday');
  assert.equal(parser.hasMultiEventDateSignal('sabado - 05'), true, 'folded-accent equivalence');
  assert.equal(parser.hasMultiEventDateSignal('SABADO -12'), true, 'no space before day');
  assert.equal(parser.hasMultiEventDateSignal('MIÉRCOLES - 09'), true, 'accented miercoles');
  assert.equal(parser.hasMultiEventDateSignal('Domingo'), true, 'full weekday alone is a heading');
  // French / German / Italian / Portuguese / Catalan smoke cases
  assert.equal(parser.hasMultiEventDateSignal('SAMEDI - 05'), true, 'fr weekday heading');
  assert.equal(parser.hasMultiEventDateSignal('FREITAG 12'), true, 'de weekday heading');
  assert.equal(parser.hasMultiEventDateSignal('MERCOLEDÌ - 09'), true, 'it weekday heading');
  assert.equal(parser.hasMultiEventDateSignal('SEXTA-FEIRA - 11'), true, 'pt weekday heading');
  assert.equal(parser.hasMultiEventDateSignal('DISSABTE - 05'), true, 'ca weekday heading');
  // Month names need an adjacent number
  assert.equal(parser.hasMultiEventDateSignal('Del 3 al 13 de SEPTIEMBRE'), true, 'es date range');
  assert.equal(parser.hasMultiEventDateSignal('3 settembre 2026'), true, 'it day month year');
  assert.equal(parser.hasMultiEventDateSignal('am 3. Oktober'), true, 'de ordinal day + month');
  assert.equal(parser.hasMultiEventDateSignal('setembro 2026'), true, 'pt month + year');
});

test('multilingual signals stay conservative: no mid-sentence weekdays, bare months, or English collisions', () => {
  const parser = createParser();
  // Mid-sentence weekday mentions are not schedule headings
  assert.equal(parser.hasMultiEventDateSignal('Nos vemos cada sábado en el bar'), false, 'mid-sentence weekday');
  assert.equal(parser.hasMultiEventDateSignal('la fête du samedi soir'), false, 'fr mid-sentence weekday');
  // Bare non-English month words never count (it "mai" = never, fr "mars" = Mars)
  assert.equal(parser.hasMultiEventDateSignal('non torno mai qui'), false, 'it mai = never');
  assert.equal(parser.hasMultiEventDateSignal('life on mars tribute show'), false, 'bare mars');
  // Collision-prone abbreviations are excluded outright
  assert.equal(parser.hasMultiEventDateSignal('10 out of 10 rating'), false, 'pt "out" excluded');
  assert.equal(parser.hasMultiEventDateSignal('set 3 reminders'), false, 'en "set" excluded');
  // English behavior unchanged (existing patterns still first)
  assert.equal(parser.hasMultiEventDateSignal('July 10, 2026'), true, 'en month date');
  assert.equal(parser.hasMultiEventDateSignal('7/25 Pride Dance @ Eagle Bar'), true, 'en numeric date');
  assert.equal(parser.hasMultiEventDateSignal('Doors open at 10pm'), false, 'en time-only line is not a date');
});

test('Sitges-shaped multi-event page splits into per-day segments with September anchoring', () => {
  const parser = createParser();
  const lines = [
    'PROGRAMA oficial',
    'BEARS SITGES WEEK 2026',
    'Del 3 al 13 de SEPTIEMBRE',
    'JUEVES- 03',
    '19h. INAUGURACIÓN BEARS SITGES WEEK Brindaremos con Cava y Aperitivo. Hotel Calipolis. Entrada Libre',
    '20 h: Ruta del OSO en «Bares Sponsors» — Bears Bar y Bears Dance Bar',
    'VIERNES - 04',
    '18h : Inauguración Exposición por Blanca de Nicolas Entrada Gratuita en Espai Joan Tarrida',
    '21h. OPENING «EARLY-VILLAGE» con motivo del aniversario de Bears Sitges',
    '01h a 06h Opening Party en «BEARS DISCO» by Scandal',
    'SÁBADO - 05',
    '14:00h: BBQ & Music – POP-Air en Restaurant LE PATIO. **Tickets a la venta',
    '21h a 03h Especial NOCHE BLANCA con PRAGUE BEARS en Bear-Village con Dj PAW.L',
    'DOMINGO - 06',
    '10h a 21h BEARS SITGES MARKET en Hotel Calipolis con muchos vendors',
    '01h a 06h JUNGLE NIGHT PARTY en «BEARS DISCO» by Scandal'
  ];
  const html = `<html><body>${lines.map(l => `<p>${l}</p>`).join('\n')}</body></html>`;
  const segments = parser.buildMultiEventSegments(html, 'https://bearssitges.example/programa/');
  assert.ok(segments.length >= 4, `expected >= 4 segments, got ${segments.length}`);
  const headed = ['JUEVES- 03', 'VIERNES - 04', 'SÁBADO - 05', 'DOMINGO - 06']
    .filter(header => segments.some(segment => segment.lines[0] === header));
  assert.equal(headed.length, 4, `each day heading should start a segment, got ${JSON.stringify(segments.map(s => s.lines[0]))}`);

  // Page-level anchor: single unambiguous month from the range phrase, no year stated
  const ctx = parser.derivePageDateContext(html);
  assert.ok(ctx, 'page date context derived');
  assert.equal(ctx.month, 9);
  assert.equal(ctx.year, null, 'no year stated in the range phrase');

  // Day-only headings inherit the month; the segment carrying the range phrase itself does not anchor
  const sabado = segments.find(segment => segment.lines[0] === 'SÁBADO - 05');
  const contextLine = parser.buildSegmentDateContextLine(sabado, ctx);
  assert.ok(contextLine.startsWith('SEGMENT_DATE_CONTEXT: September 5 '), `got: ${contextLine}`);
  const segmentHtmlData = parser.buildMultiEventSegmentHtmlData({ html, url: 'https://bearssitges.example/programa/' }, sabado, 2, segments.length, [], ctx);
  assert.ok(segmentHtmlData.html.includes('SEGMENT_DATE_CONTEXT: September 5 '), 'anchor line rides into the segment prompt html');
  assert.equal(segmentHtmlData.segmentDateContext, contextLine);

  const intro = segments.find(segment => segment.lines.some(l => l === 'Del 3 al 13 de SEPTIEMBRE'));
  if (intro) {
    assert.equal(parser.buildSegmentDateContextLine(intro, ctx), '', 'segments stating their own month are never anchored');
  }
});

test('derivePageDateContext: year capture, ambiguity, and majority fallback', () => {
  const parser = createParser();
  const wrap = (bodyLines) => `<html><body>${bodyLines.map(l => `<p>${l}</p>`).join('')}</body></html>`;
  // Range phrase with year
  const withYear = parser.derivePageDateContext(wrap(['Festival del Orgullo', '3-13 septiembre 2026', 'VIERNES - 04']));
  assert.deepEqual({ month: withYear.month, year: withYear.year }, { month: 9, year: 2026 });
  // Two conflicting range phrases → ambiguous → null
  const ambiguous = parser.derivePageDateContext(wrap(['del 3 al 13 de septiembre', 'du 3 au 13 octobre']));
  assert.equal(ambiguous, null, 'conflicting range months stay unanchored');
  // No range phrase: majority of full dates must agree
  const majority = parser.derivePageDateContext(wrap(['5 de septiembre fiesta', '12 de septiembre concierto', 'gala del 25 aniversario']));
  assert.equal(majority && majority.month, 9, 'majority of full dates anchors');
  const split = parser.derivePageDateContext(wrap(['5 de septiembre fiesta', '12 de octubre concierto']));
  assert.equal(split, null, 'no majority → unanchored');
  // English pages: month+day census works identically, so anchoring is language-neutral
  const english = parser.derivePageDateContext(wrap(['September 5 party', 'September 12 dance', 'gala night'])); 
  assert.equal(english && english.month, 9);
});

// The multilingual full-name vocabulary is DERIVED from Intl locale data, with
// the static tables kept only as the no-Intl safety net (iOS JSC may lack
// locale data). This drift guard pins the two representations to each other:
// if Intl (CLDR) ever spells a name differently than the static table — or the
// static table gains a word Intl doesn't produce — this fails and the entry
// has to be reconciled (folded into both, or moved to CURATED_DATE_VOCABULARY
// as an explicit judgment call like "sonnabend"/"setiembre").
test('Intl-derived date vocabulary equals the static fallback for every locale (drift guard)', () => {
  const parser = createParser();
  const staticFallback = parser.getStaticDateVocabularyFallback();
  const locales = Object.keys(staticFallback);
  assert.deepEqual(locales.sort(), ['ca', 'de', 'en', 'es', 'fr', 'it', 'pt'], 'one static table per supported locale');
  const derived = parser.deriveDateVocabularyFromIntl(locales);
  for (const locale of locales) {
    assert.equal(derived[locale].source, 'intl', `${locale}: Node's Intl carries full locale data, nothing may fall back here`);
    assert.deepEqual(derived[locale].weekdays, staticFallback[locale].weekdays, `${locale} weekdays drifted between Intl and the static fallback`);
    assert.deepEqual(derived[locale].months, staticFallback[locale].months, `${locale} months drifted between Intl and the static fallback`);
  }
});

test('locale-data sanity check: Intl output identical to English falls back to the static table', () => {
  // Simulate iOS JavaScriptCore without locale data: every locale silently
  // formats with the default (en) names. The derivation must detect the
  // en-identical output and use the static fallback for that locale.
  const RealDateTimeFormat = Intl.DateTimeFormat;
  try {
    Intl.DateTimeFormat = function (locale, options) {
      return new RealDateTimeFormat(locale === 'ca' || locale === 'xx' ? 'en' : locale, options);
    };
    const parser = createParser();
    const derived = parser.deriveDateVocabularyFromIntl(['en', 'ca', 'es', 'xx']);
    const staticFallback = parser.getStaticDateVocabularyFallback();
    assert.equal(derived.ca.source, 'static-fallback', 'en-identical weekday names mean no real locale data');
    assert.deepEqual(derived.ca.weekdays, staticFallback.ca.weekdays, 'the static Catalan weekdays take over');
    assert.deepEqual(derived.ca.months, staticFallback.ca.months, 'the static Catalan months take over');
    assert.equal(derived.es.source, 'intl', 'healthy locales still derive from Intl');
    assert.equal(derived.en.source, 'intl', 'en itself is exempt from the differs-from-en check');
    // A locale with no static table contributes nothing rather than English words.
    assert.equal(derived.xx.source, 'static-fallback');
    assert.deepEqual(derived.xx.weekdays, []);
    // The composed vocabulary still understands Catalan via the safety net.
    assert.equal(parser.hasMultiEventDateSignal('DISSABTE - 05'), true, 'ca weekday heading survives broken Intl');
    assert.equal(parser.getMultilingualDateVocabulary().monthsByName.setembre, 9, 'ca month mapping survives broken Intl');
  } finally {
    Intl.DateTimeFormat = RealDateTimeFormat;
  }
});

test('deriveSegmentListingTitle skips European time-only lines', () => {
  const parser = createParser();
  const segment = { lines: ['SÁBADO - 05', '14:00h', '21h a 03h', 'de 21 a 03h', 'FIESTA BLANCA en Bear-Village'] };
  assert.equal(parser.deriveSegmentListingTitle(segment), 'FIESTA BLANCA en Bear-Village');
});

test('hasTimeEvidence understands European time notations (matching side only)', () => {
  const parser = createParser();
  const evidence = (text) => parser.buildAiEvidenceContextFromText(text);
  assert.equal(parser.hasTimeEvidence(evidence('14:00h: BBQ & Music en LE PATIO'), '14:00'), true, '14:00h');
  assert.equal(parser.hasTimeEvidence(evidence('21h a 03h Especial NOCHE BLANCA'), '21:00'), true, '21h start');
  assert.equal(parser.hasTimeEvidence(evidence('21h a 03h Especial NOCHE BLANCA'), '03:00'), true, '03h end');
  assert.equal(parser.hasTimeEvidence(evidence('de 21 a 03h FIESTA'), '21:00'), true, 'unmarked leading hour in an h-range');
  assert.equal(parser.hasTimeEvidence(evidence('16h a 20:30h BEAR TEA-DANCE'), '20:30'), true, 'minutes via h suffix');
  assert.equal(parser.hasTimeEvidence(evidence('9:00 p.m. to 3:00 a.m. BEARS on CRUISE'), '21:00'), true, 'dotted meridiem');
  // Bare number pairs never corroborate an invented time
  assert.equal(parser.hasTimeEvidence(evidence('grupos de 3 a 5 personas'), '03:00'), false, 'bare range without h');
  assert.equal(parser.hasTimeEvidence(evidence('MAY 3 tickets $5'), '03:00'), false, 'bare digits stay rejected');
});

// ── Day-header echo title gate (Sitges extraction-quality polish) ──────────

test('isDayHeaderEchoTitle rejects weekday-heading echoes across languages', () => {
  const parser = createParser();
  // Weekday + day-of-month headings (multilingual, diacritic-folded)
  assert.equal(parser.isDayHeaderEchoTitle('LUNES - 07'), true, 'es weekday + day');
  assert.equal(parser.isDayHeaderEchoTitle('Domingo-06'), true, 'no-space separator');
  assert.equal(parser.isDayHeaderEchoTitle('SAMEDI 05'), true, 'fr weekday + day, no separator');
  assert.equal(parser.isDayHeaderEchoTitle('JUEVES- 03'), true, 'es weekday, hyphen-space');
  assert.equal(parser.isDayHeaderEchoTitle('MIÉRCOLES - 09'), true, 'accented weekday');
  assert.equal(parser.isDayHeaderEchoTitle('SEXTA-FEIRA - 11'), true, 'pt weekday');
  // Bare full weekday is a heading, never an event name
  assert.equal(parser.isDayHeaderEchoTitle('MARTES'), true, 'bare es weekday');
  assert.equal(parser.isDayHeaderEchoTitle('sonntag'), true, 'bare de weekday');
  // English weekday table (gate-side only, same rules)
  assert.equal(parser.isDayHeaderEchoTitle('MONDAY - 07'), true, 'en weekday + day');
  assert.equal(parser.isDayHeaderEchoTitle('Monday'), true, 'bare en weekday');
  assert.equal(parser.isDayHeaderEchoTitle('Sat 05'), true, 'en abbreviation + day');
  // Abbreviations without a day number are ordinary words — never rejected
  assert.equal(parser.isDayHeaderEchoTitle('MAR'), false, 'es abbrev without day (= sea)');
  assert.equal(parser.isDayHeaderEchoTitle('Sat'), false, 'en abbrev without day');
  // Real titles are untouched (any other token keeps the title)
  assert.equal(parser.isDayHeaderEchoTitle('Lunes de Carnaval Party'), false, 'weekday inside a real name');
  assert.equal(parser.isDayHeaderEchoTitle('Sunday Funday'), false, 'weekday + qualifier');
  assert.equal(parser.isDayHeaderEchoTitle('TUESDAY TEA DANCE'), false, 'weekday-led event name');
  assert.equal(parser.isDayHeaderEchoTitle('BEAR POOL PARTY'), false, 'plain event name');
  assert.equal(parser.isDayHeaderEchoTitle('Mr. BEAR SITGES 2026'), false, 'name with year');
  assert.equal(parser.isDayHeaderEchoTitle(''), false, 'empty stays false');
});

test('rejectDayHeaderEchoPassFields drops only the echoed title and keeps the field open', () => {
  const parser = createParser();
  const partial = {
    title: 'LUNES - 07',
    bar: 'Bear-Village',
    startDate: '2026-09-07'
  };
  const guarded = parser.rejectDayHeaderEchoPassFields(partial);
  assert.equal(guarded.title, undefined, 'day-header title rejected at pass level');
  assert.equal(guarded.bar, 'Bear-Village', 'other fields survive');
  assert.equal(guarded.startDate, '2026-09-07', 'date fields survive');
  // Non-echo titles pass through untouched (same object semantics as input)
  const real = parser.rejectDayHeaderEchoPassFields({ title: 'Noche Especial BIENVENIDA' });
  assert.equal(real.title, 'Noche Especial BIENVENIDA');
});

// ── Date-headed schedule segments (lost-segment fixes) ─────────────────────

test('time-prefixed activity lines and date-headed schedule detection', () => {
  const parser = createParser();
  assert.equal(parser.isTimePrefixedActivityLine('14:00h: BBQ & Music en LE PATIO'), true, 'h-notation with minutes');
  assert.equal(parser.isTimePrefixedActivityLine('21h a 03h Especial NOCHE BLANCA'), true, 'h-range');
  assert.equal(parser.isTimePrefixedActivityLine('20 h: Ruta del OSO'), true, 'space before h');
  assert.equal(parser.isTimePrefixedActivityLine('9:00 p.m. to 3:00 a.m. BEARS on CRUISE'), true, 'meridiem');
  assert.equal(parser.isTimePrefixedActivityLine('‎ 18h a 21h Entrega de PACKS'), true, 'invisible LRM prefix stripped');
  assert.equal(parser.isTimePrefixedActivityLine('100€ crédito para compras'), false, 'money is not a time');
  assert.equal(parser.isTimePrefixedActivityLine('BEAR POOL PARTY: En una villa'), false, 'prose line');

  // Date-headed schedule: weekday heading + at least one timed activity —
  // no additional title-shaped line required
  assert.equal(parser.segmentIsDateHeadedSchedule([
    'VIERNES - 11',
    '‎ 20:00h. CENA OFICIAL 25º ANIVERSARIO BEARS SITGES en «Hotel Calipolis» 20:00h. Cóctel – 20:30h. Cena & Performance . INCLUIDA EN EL PACK BEARS SITGES MÁS UNAS PALABRAS EXTRA PARA SUPERAR EL LÍMITE'
  ]), true, 'day heading + one long timed line');
  assert.equal(parser.segmentIsDateHeadedSchedule(['VIERNES - 11', 'Osos en la Playa: Recomendamos']), false, 'no timed line');
  assert.equal(parser.segmentIsDateHeadedSchedule(['FIESTA BLANCA', '21h a 03h en Bear-Village']), false, 'head is not a date signal');

  // Multi-activity day programme needs >= 3 timed lines
  assert.equal(parser.segmentIsMultiActivityDayProgramme([
    'LUNES - 07', '16h a 21h Apertura MARKET', '18:00h a 21h Entrega de PACKS', '21:00h a 03h Noche Especial BIENVENIDA', '01h a 06h After Party'
  ]), true, 'day heading + 4 timed activities');
  assert.equal(parser.segmentIsMultiActivityDayProgramme([
    'LUNES - 07', '21:00h a 03h Noche Especial BIENVENIDA', 'Osos en la Playa'
  ]), false, 'only one timed activity');
});

test('day sections keep their strong-title activity lines and the next day still splits (Sitges JUEVES-10/VIERNES-11 shape)', () => {
  const parser = createParser();
  const lines = [
    'PROGRAMA oficial',
    'Del 3 al 13 de SEPTIEMBRE',
    'MIÉRCOLES - 09',
    '16h a 20:30h BEAR TEA-DANCE : En el RoofTop del Hotel MiM',
    '01h a 06h «Beef Mince» Party en «BEARS DISCO» by Scandal',
    'JUEVES - 10',
    'BEAR POOL PARTY: En una lujosa villa y espacio para eventos en las colinas de Sitges, a sólo 5 minutos del centro Bear-Village. Se proporcionará transporte en autobús.',
    'VER Palauet Modernista Clos La Plana',
    '9:00 p.m. to 3:00 a.m. BEARS on CRUISE Special Night at Bear-Village con Entrada Libre.',
    '01h a 06h SAILOR Party en «BEARS DISCO» by Scandal',
    'VIERNES - 11',
    '20:00h. CENA OFICIAL 25º ANIVERSARIO BEARS SITGES en «Hotel Calipolis» 20:00h. Cóctel – 20:30h. Cena & Performance . INCLUIDA EN EL PACK BEARS SITGES',
    '21:30h a 03:30h Noche Especial anniBEARsary en Bear-Village con DJ PERFECTO y una descripción bastante larga para esta línea'
  ];
  const html = `<html><body>${lines.map(l => `<p>${l}</p>`).join('\n')}</body></html>`;
  const segments = parser.buildMultiEventSegments(html, 'https://bearssitges.example/programa/');

  const jueves = segments.find(segment => segment.lines[0] === 'JUEVES - 10');
  assert.ok(jueves, `JUEVES - 10 heads its own segment, got heads ${JSON.stringify(segments.map(s => s.lines[0]))}`);
  assert.ok(jueves.lines.some(l => l.startsWith('BEAR POOL PARTY')), 'pool party line survives in the day segment');
  assert.ok(jueves.lines.includes('VER Palauet Modernista Clos La Plana'),
    'a strong title line inside a date-headed day section no longer starts a new segment');
  assert.ok(!jueves.lines.includes('VIERNES - 11'), 'next day heading is not swallowed');

  const viernes = segments.find(segment => segment.lines[0] === 'VIERNES - 11');
  assert.ok(viernes, 'VIERNES - 11 heads its own segment (title-signal gate relaxed for date-headed schedules)');
  assert.ok(viernes.lines.some(l => l.startsWith('20:00h.')), 'the day keeps its timed activities');
});

test('day-programme prompt steering: flag rides the segment htmlData and adds the additive rule line', () => {
  const parser = createParser();
  const daySegment = {
    lines: [
      'LUNES - 07',
      '16h a 21h Apertura BEARS SITGES MARKET en Hotel Calipolis',
      '18:00h a 21h Entrega de BEARS SITGES PACKS en Hotel Calipolis',
      '21:00h a 03h Noche Especial BIENVENIDA: En Bear-Village . Entrada Libre',
      '01h a 06h «Opening Night Village» After Party en «BEARS DISCO» by Scandal'
    ]
  };
  const htmlData = parser.buildMultiEventSegmentHtmlData(
    { html: '<html><body></body></html>', url: 'https://bearssitges.example/programa/' },
    daySegment, 0, 1, [], null
  );
  assert.equal(htmlData.segmentDayProgramme, true, 'multi-activity day segment is flagged');

  const prompt = parser.buildExtractionPrompt(htmlData, {}, null, {}, ['title', 'startDate'], 'SNIPPET', 'default', { segment: true, ocr: true });
  assert.ok(prompt.includes('ONE DAY of a longer programme'), 'day-programme rule line present');
  assert.ok(prompt.includes('never the title'), 'weekday-heading warning present');

  // Ordinary segments: no flag, byte-identical prompts (no rule line)
  const plainSegment = { lines: ['FIESTA BLANCA', '3 de septiembre 2026', 'Bear-Village Sitges'] };
  const plainHtmlData = parser.buildMultiEventSegmentHtmlData(
    { html: '<html><body></body></html>', url: 'https://bearssitges.example/programa/' },
    plainSegment, 0, 1, [], null
  );
  assert.equal(plainHtmlData.segmentDayProgramme, false, 'non-programme segment not flagged');
  const plainPrompt = parser.buildExtractionPrompt(plainHtmlData, {}, null, {}, ['title', 'startDate'], 'SNIPPET', 'default', { segment: true, ocr: true });
  assert.ok(!plainPrompt.includes('ONE DAY of a longer programme'), 'rule line absent for ordinary segments');
});

// ── Tier-2 AI segment-boundary fallback ─────────────────────────────────────
// Fixtures are blind-by-language: Dutch is NOT in DATE_VOCABULARY_LOCALES, so
// the deterministic splitter genuinely finds nothing — no monkeypatching of
// vocabulary internals.

const DUTCH_PROGRAMME_HTML = `
  <html><body>
    <article>
      <h1>BEREN WEEKEND PROGRAMMA</h1>
      <p>Het volledige programma van het grote berenweekend in de stad, met feesten en borrels voor alle beren en hun vrienden.</p>
      <h2>DONDERDAG- 03</h2>
      <p>WELKOMSTBORREL IN DE KROEG</p>
      <p>20:00 h. Welkomstborrel met live muziek en gratis hapjes voor alle bezoekers van het festival.</p>
      <h2>VRIJDAG- 04</h2>
      <p>LEREN NACHT IN DE KELDER</p>
      <p>23:00 h. Leren nacht met strikte kledingvoorschriften en twee dansvloeren vol stevige muziek.</p>
      <h2>ZATERDAG- 05</h2>
      <p>GROTE SLOTFEEST AVOND</p>
      <p>22:00 h. Het grote slotfeest met internationale gasten en een spectaculaire show om middernacht.</p>
    </article>
  </body></html>
`;

test('AI boundary pass segments a vocabulary-blind Dutch programme from verbatim headers', async () => {
  const parser = createParser();
  const sourceUrl = 'https://berenfest.example/programma';

  // Tier-1 blindness by construction: Dutch headings carry no supported
  // date vocabulary, so deterministic segmentation finds <2 segments.
  assert.ok(parser.buildMultiEventSegments(DUTCH_PROGRAMME_HTML, sourceUrl).length < 2);

  const labels = [];
  let promptSeen = '';
  let configSeen = null;
  parser.core.callAiGenerate = async (config, prompt, label) => {
    labels.push(label);
    promptSeen = prompt;
    configSeen = config;
    return JSON.stringify({ boundaries: ['DONDERDAG- 03', 'VRIJDAG- 04', 'ZATERDAG- 05'] });
  };

  const segments = await parser.runAiBoundarySegmentation(DUTCH_PROGRAMME_HTML, sourceUrl, [], {}, {}, 0);
  assert.equal(segments.length, 3);
  assert.deepEqual(labels, ['segment-boundaries'], 'boundary pass uses the segment-boundaries pass label');
  assert.equal(configSeen.temperature, 0);
  assert.ok(configSeen.numPredict <= 1200, 'numPredict is clamped to 1200');
  assert.ok(promptSeen.includes('PAGE LINES (one per line, exactly as extracted):'));
  assert.ok(promptSeen.includes(`Return between 2 and ${parser.extractionLimits.multiEventMaxSegments} lines.`));

  // Each day section starts at its verbatim header and keeps its own timed line
  assert.equal(segments[0].lines[0], 'DONDERDAG- 03');
  assert.equal(segments[1].lines[0], 'VRIJDAG- 04');
  assert.equal(segments[2].lines[0], 'ZATERDAG- 05');
  assert.ok(segments[0].lines.some(line => line.includes('20:00')));
  assert.ok(segments[1].lines.some(line => line.includes('23:00')));
  assert.ok(segments[2].lines.some(line => line.includes('22:00')));
  assert.ok(!segments[0].lines.some(line => line.includes('23:00')), 'time lines stay in their own segment');
  // The preamble before the first boundary is discarded
  assert.ok(!segments[0].lines.includes('BEREN WEEKEND PROGRAMMA'));

  // Wiring: extractEventsFromMultiEventPage adopts the AI segments
  const extractedSegments = [];
  parser.extractSingleEvent = async (segmentHtmlData) => {
    extractedSegments.push(segmentHtmlData);
    return { title: `event ${extractedSegments.length}` };
  };
  const events = await parser.extractEventsFromMultiEventPage(
    { html: DUTCH_PROGRAMME_HTML, url: sourceUrl }, {}, {}, [], [], {});
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(event => event._multiEventSegment.total), [3, 3, 3]);
});

test('AI boundary pass drops hallucinated boundaries and falls through to whole-page fallback', async () => {
  const parser = createParser();
  const sourceUrl = 'https://berenfest.example/programma';

  // All-fake proposals: nothing verifies, the pass yields nothing
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); originalLog(...args); };
  try {
    parser.core.callAiGenerate = async () => JSON.stringify({
      boundaries: ['MEGA BEAR BLOWOUT NIGHT', 'AFTERPARTY AT THE DOCKS']
    });
    const segments = await parser.runAiBoundarySegmentation(DUTCH_PROGRAMME_HTML, sourceUrl, [], {}, {}, 0);
    assert.deepEqual(segments, []);
    assert.ok(logs.some(line => line.includes('dropped unverifiable line') && line.includes('MEGA BEAR BLOWOUT NIGHT')));
    assert.ok(logs.some(line => line.includes('proposed 2 line(s); 0 verified verbatim, 2 dropped')));
    assert.ok(logs.some(line => line.includes('yielded <2 verified boundaries')));
  } finally {
    console.log = originalLog;
  }

  // One real + one fake → 1 verified < 2 → the multi-event flow takes the
  // existing whole-page fallback path
  parser.core.callAiGenerate = async () => JSON.stringify({
    boundaries: ['DONDERDAG- 03', 'MEGA BEAR BLOWOUT NIGHT']
  });
  let fallbackHtmlData = null;
  parser.extractEventsFromSinglePage = async (htmlData) => {
    fallbackHtmlData = htmlData;
    return [];
  };
  const events = await parser.extractEventsFromMultiEventPage(
    { html: DUTCH_PROGRAMME_HTML, url: sourceUrl }, {}, {}, [], [], {});
  assert.deepEqual(events, []);
  assert.ok(fallbackHtmlData, 'whole-page fallback ran');
  assert.equal(fallbackHtmlData._wholePageFallback, true);
});

test('AI boundary verification tolerates case, diacritic and zero-width drift', async () => {
  const parser = createParser();
  const sourceUrl = 'https://berenfest.example/programma';
  parser.core.callAiGenerate = async () => JSON.stringify({
    boundaries: [
      '‎donderdag- 03',        // lowercase + leading zero-width mark
      'VRÍJDAG​- 04',          // added diacritic + embedded zero-width space
      'Záterdag- 05'           // mixed case + added diacritic
    ]
  });
  const segments = await parser.runAiBoundarySegmentation(DUTCH_PROGRAMME_HTML, sourceUrl, [], {}, {}, 0);
  assert.equal(segments.length, 3);
  assert.equal(segments[0].lines[0], 'DONDERDAG- 03');
  assert.equal(segments[2].lines[0], 'ZATERDAG- 05');
});

const ENGLISH_HEALTHY_MULTI_HTML = `
  <html><body>
    <p>FURBALL BLACKOUT PARTY</p>
    <p>July 10, 2026 at the Eagle</p>
    <p>Doors open at nine with two floors of music and a late night patio.</p>
    <p>FURBALL POOL SPLASH</p>
    <p>July 24, 2026 at Elsewhere Rooftop</p>
    <p>Swim and dance all afternoon with resident selectors on the deck.</p>
  </body></html>
`;

test('AI boundary pass never runs when tier 1 already found segments or the page is thin', async () => {
  const parser = createParser();
  const sourceUrl = 'https://furball.example/events';

  // Healthy page: deterministic segmentation succeeds, the throwing stub
  // proves the boundary pass is never consulted.
  assert.ok(parser.buildMultiEventSegments(ENGLISH_HEALTHY_MULTI_HTML, sourceUrl).length >= 2);
  parser.core.callAiGenerate = async () => {
    throw new Error('AI boundary pass must not run when tier 1 found segments');
  };
  parser.extractSingleEvent = async () => ({ title: 'x' });
  const events = await parser.extractEventsFromMultiEventPage(
    { html: ENGLISH_HEALTHY_MULTI_HTML, url: sourceUrl }, {}, {}, [], [], {});
  assert.ok(events.length >= 2);

  // Thin page: no time lines, <1500 chars, no OCR → skip log + whole-page fallback
  const thinHtml = `
    <html><body>
      <p>BEER BUST ZONDAG</p>
      <p>Kom langs voor bier en gezelligheid met alle beren van de stad, iedereen is welkom bij ons.</p>
    </body></html>
  `;
  const thinParser = createParser();
  thinParser.core.callAiGenerate = async () => {
    throw new Error('AI boundary pass must not run on a thin page');
  };
  let fallbackHtmlData = null;
  thinParser.extractEventsFromSinglePage = async (htmlData) => {
    fallbackHtmlData = htmlData;
    return [];
  };
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); originalLog(...args); };
  try {
    const thinEvents = await thinParser.extractEventsFromMultiEventPage(
      { html: thinHtml, url: sourceUrl }, {}, {}, [], [], {});
    assert.deepEqual(thinEvents, []);
  } finally {
    console.log = originalLog;
  }
  assert.ok(logs.some(line => line.includes('Skipping AI boundary pass — page content too thin')));
  assert.ok(fallbackHtmlData, 'thin page still takes the whole-page fallback');
  assert.equal(fallbackHtmlData._wholePageFallback, true);
});

test('AI boundary segments cap at multiEventMaxSegments and the raised cap fits a 13-day programme', async () => {
  const parser = createParser();
  assert.equal(parser.extractionLimits.multiEventMaxSegments, 16);

  // 20 verified boundaries → capped at 16 segments
  const sectionCount = 20;
  const headers = [];
  const sections = [];
  for (let i = 1; i <= sectionCount; i++) {
    const header = `SECTIE ${String(i).padStart(2, '0')} BERENAVOND`;
    headers.push(header);
    sections.push(`<h2>${header}</h2><p>21:00 h. Speciale berenavond nummer ${i} met muziek en dans in de grote zaal.</p>`);
  }
  const bigHtml = `<html><body><h1>GROOT BEREN FESTIVAL WEEKEND</h1>${sections.join('')}</body></html>`;
  parser.core.callAiGenerate = async () => JSON.stringify({ boundaries: headers });
  const segments = await parser.runAiBoundarySegmentation(bigHtml, 'https://berenfest.example/alles', [], {}, {}, 0);
  assert.equal(segments.length, 16);
  assert.equal(segments[0].lines[0], 'SECTIE 01 BERENAVOND');
  assert.equal(segments[15].lines[0], 'SECTIE 16 BERENAVOND');

  // Deterministic tier 1: a Sitges-schedule-shaped 13-day programme now
  // survives whole (it silently lost days under the old cap of 12).
  const dayHeaders = [
    'JUEVES- 03', 'VIERNES- 04', 'SABADO- 05', 'DOMINGO- 06', 'LUNES- 07',
    'MARTES- 08', 'MIERCOLES- 09', 'JUEVES- 10', 'VIERNES- 11', 'SABADO- 12',
    'DOMINGO- 13', 'LUNES- 14', 'MARTES- 15'
  ];
  const daySections = dayHeaders.map((header, index) => `
    <h2>${header}</h2>
    <p>FIESTA DE OSOS ${index + 1}</p>
    <p>Gran fiesta numero ${index + 1} con musica y muchos osos en el bar principal.</p>
  `);
  const sitgesHtml = `<html><body><h1>BEARS SITGES WEEK 2026</h1>${daySections.join('')}</body></html>`;
  const sitgesParser = createParser();
  const sitgesSegments = sitgesParser.buildMultiEventSegments(sitgesHtml, 'https://bearssitges.example/programa');
  assert.equal(sitgesSegments.length, 13);
});

// ---------------------------------------------------------------------------
// Cross-host platform-chrome blocked segments (Fix B, run 20260729-100804:
// dice.fm/hc/change_language/* produced 12 [ERROR] 404 fetches).
// ---------------------------------------------------------------------------

test('validateEventUrl blocks platform-chrome path segments on cross-host pages only', () => {
  const parser = createParser();
  const config = { urls: ['https://beefmince.example/events'] };
  const crossHostSource = 'https://dice.example/ticket_purchase_terms.html';

  const hc = parser.validateEventUrl(
    'https://dice.example/hc/change_language/ca?return_to=%2Fhc%2Fca', crossHostSource, config);
  assert.equal(hc.valid, false);
  assert.equal(hc.reason, 'cross-host-chrome:hc');

  const legal = parser.validateEventUrl('https://dice.example/legal/notices', crossHostSource, config);
  assert.equal(legal.valid, false);
  assert.equal(legal.reason, 'cross-host-chrome:legal');

  const careers = parser.validateEventUrl('https://dice.example/careers', crossHostSource, config);
  assert.equal(careers.valid, false);
  assert.equal(careers.reason, 'cross-host-chrome:careers');

  // Real event-detail pages on the cross-host platform still pass
  assert.equal(parser.validateEventUrl(
    'https://dice.example/event/8er825-beefmince-brighton-pride-tickets',
    'https://dice.example/promoters/beefmince', config).valid, true);

  // The same segments on the CONFIGURED host stay crawlable
  const configuredSource = 'https://beefmince.example/events';
  assert.equal(parser.validateEventUrl('https://beefmince.example/legal/notices', configuredSource, config).valid, true);
  assert.equal(parser.validateEventUrl('https://beefmince.example/careers', configuredSource, config).valid, true);

  // /about was already blocked GLOBALLY before this change — reason unchanged
  const about = parser.validateEventUrl('https://beefmince.example/about', configuredSource, config);
  assert.equal(about.valid, false);
  assert.ok(about.reason.startsWith('blocked-pattern:'), `expected the pre-existing blocked-pattern reason, got ${about.reason}`);

  // Slugs merely CONTAINING a chrome word survive (whole-segment matches only)
  assert.equal(parser.validateEventUrl('https://dice.example/event/legal-tender-party', crossHostSource, config).valid, true);
});

// ---------------------------------------------------------------------------
// URL-field sanity gate (Fix C, run 20260729-100804: SPA markup leaked
// "http://www.w3.org/2000/svg" into url/ticketUrl x4 and OCR hallucinated
// ticketUrl "BASTILLE'S POOL.COM").
// ---------------------------------------------------------------------------

test('isPlausibleEventUrlValue rejects namespace URLs and non-URL text, keeps real event URLs', () => {
  const parser = createParser();
  // Namespace URLs: host w3.org + namespace-shaped path
  assert.equal(parser.isPlausibleEventUrlValue('http://www.w3.org/2000/svg'), false);
  assert.equal(parser.isPlausibleEventUrlValue('http://www.w3.org/1999/xhtml'), false);
  // Not parseable as an http(s) URL with a dotted host
  assert.equal(parser.isPlausibleEventUrlValue("BASTILLE'S POOL.COM"), false);
  assert.equal(parser.isPlausibleEventUrlValue('mailto:info@bears.example'), false);
  assert.equal(parser.isPlausibleEventUrlValue('Free'), false);
  assert.equal(parser.isPlausibleEventUrlValue(''), false);
  // Real values pass
  assert.equal(parser.isPlausibleEventUrlValue(
    'https://dice.fm/event/8er825-beefmince-brighton-pride-1st-aug-horizon-brighton-tickets'), true);
  assert.equal(parser.isPlausibleEventUrlValue('https://www.eventbrite.com/e/party-1?aff=x'), true);
  // Scheme-less dotted hosts stay plausible (later normalization adds https)
  assert.equal(parser.isPlausibleEventUrlValue('sitgesbearcave.com'), true);
});

test('normalizeAiEvent drops implausible url/ticketUrl values and logs the rejection', () => {
  const parser = createParser();
  const logged = [];
  const originalLog = console.log;
  console.log = (...args) => { logged.push(args.join(' ')); };
  let event;
  try {
    event = parser.normalizeAiEvent({
      title: 'BASTID FIXTURE',
      startDate: '2026-08-08',
      url: 'http://www.w3.org/2000/svg',
      ticketUrl: "BASTILLE'S POOL.COM"
    }, {}, null, null, null);
  } finally {
    console.log = originalLog;
  }
  assert.ok(event, 'event should normalize');
  assert.equal(event.url, '');
  assert.equal(event.ticketUrl, '');
  assert.ok(logged.includes('🤖 AI Web: Rejected url "http://www.w3.org/2000/svg" — not a plausible event URL'),
    `expected url rejection log, got: ${JSON.stringify(logged.filter(l => l.includes('Rejected')))}`);
  assert.ok(logged.includes(`🤖 AI Web: Rejected ticketUrl "BASTILLE'S POOL.COM" — not a plausible event URL`),
    'expected ticketUrl rejection log');

  // A real event URL survives normalization untouched
  const clean = parser.normalizeAiEvent({
    title: 'BEEFMINCE BRIGHTON PRIDE',
    startDate: '2026-08-01',
    url: 'https://dice.fm/event/8er825-beefmince-brighton-pride-1st-aug-horizon-brighton-tickets'
  }, {}, null, null, null);
  assert.equal(clean.url, 'https://dice.fm/event/8er825-beefmince-brighton-pride-1st-aug-horizon-brighton-tickets');
});

test('sanitizeExtractedUrlField rejects static asset URLs the same way as implausible values', () => {
  const parser = createParser();
  const logged = [];
  const originalLog = console.log;
  console.log = (...args) => { logged.push(args.join(' ')); };
  try {
    // Both published escapes: the webflow CDN JPEG stored as website
    // (MASSIVE) and the wp-content upload JPEG stored as ticketUrl
    // (Portland NYE).
    assert.equal(parser.sanitizeExtractedUrlField('website',
      'https://cdn.prod.website-files.com/64ef/image-asset%20(4).jpeg'), '');
    assert.equal(parser.sanitizeExtractedUrlField('ticketUrl',
      'https://venue.example/wp-content/uploads/2025/12/nye-flyer-768x960.jpg'), '');
    assert.equal(parser.sanitizeExtractedUrlField('url', 'https://fonts.example/brand.woff2'), '');
    // Real pages keep passing — image-ish FOLDERS and transform query params
    // are not asset filenames.
    assert.equal(parser.sanitizeExtractedUrlField('website', 'https://www.massive.club/'),
      'https://www.massive.club/');
    assert.equal(parser.sanitizeExtractedUrlField('website', 'https://beefmince.com/images/june-party/'),
      'https://beefmince.com/images/june-party/');
    assert.equal(parser.sanitizeExtractedUrlField('ticketUrl', 'https://dice.fm/event/abc?format=web'),
      'https://dice.fm/event/abc?format=web');
  } finally {
    console.log = originalLog;
  }
  assert.ok(logged.includes('🤖 AI Web: Rejected website "https://cdn.prod.website-files.com/64ef/image-asset%20(4).jpeg" — static asset URL, not an event page'),
    `expected asset rejection log, got: ${JSON.stringify(logged)}`);
  assert.ok(logged.includes('🤖 AI Web: Rejected ticketUrl "https://venue.example/wp-content/uploads/2025/12/nye-flyer-768x960.jpg" — static asset URL, not an event page'));
});

test('normalizeAiEvent skips an asset-URL candidate and falls through to the next one', () => {
  const parser = createParser();
  const originalLog = console.log;
  console.log = () => {};
  let event;
  try {
    event = parser.normalizeAiEvent({
      title: 'MASSIVE',
      startDate: '2026-08-08',
      url: 'https://cdn.prod.website-files.com/64ef/image-asset%20(4).jpeg',
      website: 'https://www.massive.club/'
    }, {}, null, null, null);
  } finally {
    console.log = originalLog;
  }
  assert.ok(event, 'event should normalize');
  assert.equal(event.url, 'https://www.massive.club/', 'the asset candidate is skipped, not fatal');
});

// ---------------------------------------------------------------------------
// siteRole via curated bars (run 20260729-125247: eaglela.com has no venue-ish
// JSON-LD, siteRole stayed undetermined, and rejectBrandLikePassFields threw
// away bar "Eagle LA" twice)
// ---------------------------------------------------------------------------

const EAGLE_LA_CURATED_BAR = {
  name: 'Eagle LA',
  city: 'la',
  coordinates: '34.0912127, -118.2840632',
  address: '4219 Santa Monica Blvd, Los Angeles, CA 90029'
};

const EAGLE_LA_SITE_HTML = `<html><head>
  <meta property="og:site_name" content="Eagle LA" />
</head><body>CUB SCOUT — EVERY THIRD SATURDAY</body></html>`;

function createEagleLaParser(bars) {
  const parser = new AiWebParser({ normalizeUrl });
  parser.core = new SharedCore({}, { eventSchema: EventSchema, bars });
  return parser;
}

test('siteRole: a page brand matching a curated bar for the parser city resolves venue; the bar survives the brand guard', () => {
  const parser = createEagleLaParser({ la: [EAGLE_LA_CURATED_BAR] });
  const htmlData = { url: 'https://eaglela.com/events/cub-scout-3/', html: EAGLE_LA_SITE_HTML };

  assert.equal(parser.resolvePageSiteRole(htmlData, { city: 'la' }), 'venue');
  assert.equal(htmlData.pageSiteRoleReason, 'curated bar "Eagle LA"');

  // The existing siteRole log line prints the curated reason — no new shape.
  const logs = captureLogs(() => parser.logPageSiteRoleOnce(htmlData));
  assert.deepEqual(logs, ['🤖 AI Web: siteRole for eaglela.com: venue (curated bar "Eagle LA")']);

  // Downstream: the pass-level brand guard keeps the bar on a venue site.
  const guarded = parser.rejectBrandLikePassFields({ bar: 'Eagle LA' }, htmlData, 'test');
  assert.equal(guarded.bar, 'Eagle LA', 'venue site: the page brand IS the venue, never rejected');
});

test('siteRole: a page brand with no curated bar match stays undetermined', () => {
  const parser = createEagleLaParser({ la: [EAGLE_LA_CURATED_BAR] });
  const htmlData = {
    url: 'https://bearracuda.example/events',
    html: '<html><head><meta property="og:site_name" content="Bearracuda" /></head><body></body></html>'
  };
  assert.equal(parser.resolvePageSiteRole(htmlData, { city: 'la' }), '');
  assert.equal(htmlData.pageSiteRoleReason, '');
});

test('siteRole: without a configured city an ambiguous multi-city curated name stays undetermined; a unique hit resolves venue', () => {
  // "Eagle" is curated in two cities → fail closed.
  const ambiguousParser = createEagleLaParser({
    la: [{ name: 'Eagle', city: 'la' }],
    sf: [{ name: 'Eagle', city: 'sf' }]
  });
  const ambiguousData = {
    url: 'https://eagle.example/events',
    html: '<html><head><meta property="og:site_name" content="Eagle" /></head><body></body></html>'
  };
  assert.equal(ambiguousParser.resolvePageSiteRole(ambiguousData, {}), '');

  // The same lookup with a UNIQUE cross-city hit resolves venue.
  const uniqueParser = createEagleLaParser({ la: [EAGLE_LA_CURATED_BAR] });
  const uniqueData = { url: 'https://eaglela.com/events/', html: EAGLE_LA_SITE_HTML };
  assert.equal(uniqueParser.resolvePageSiteRole(uniqueData, {}), 'venue');
  assert.equal(uniqueData.pageSiteRoleReason, 'curated bar "Eagle LA"');
});

test('curated-bar venue chain: BarDataNormalizer canonicalizes the kept bar and adopts curated coordinates + address for an unpinned event', () => {
  const { BarDataNormalizer } = require('../normalizers');
  const core = new SharedCore({}, { eventSchema: EventSchema, bars: { la: [EAGLE_LA_CURATED_BAR] } });
  const normalizer = new BarDataNormalizer(core);

  const event = { title: 'CubScout LA', bar: 'EAGLE LA', city: 'la' };
  normalizer.normalize(event);

  assert.equal(event.bar, 'Eagle LA', 'canonicalized to the curated display name');
  assert.equal(event.location, '34.0912127, -118.2840632', 'curated coordinates adopted for the unpinned event');
  assert.equal(event.pinSource, 'curated');
  assert.equal(event.address, '4219 Santa Monica Blvd, Los Angeles, CA 90029');
  assert.equal(event.addressSource, 'curated');
});

// ============================================================================
// IMAGE ORIENTATION SLOTS (imageVertical / imageHorizontal)
// ============================================================================
// A page that publishes the SAME artwork as a portrait flyer AND a landscape
// banner used to lose one of the two before anything could use it. These tests
// pin the capture side: candidates survive the grouping passes, published
// dimensions beat URL guesses, and an unknown orientation still fills NO slot.

// Stand-in for the shared-core URL dimension readers the schema/merge side owns.
// Reads Wix-style w_<n>,h_<n> transform segments; everything else is unknown.
function stubUrlDimensionReaders(parser) {
  parser.core.getImageDimensionsFromUrl = (url) => {
    const match = String(url || '').match(/[/_]w_(\d+),h_(\d+)/);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
  };
  parser.core.classifyImageOrientation = (url) => {
    const dimensions = parser.core.getImageDimensionsFromUrl(url);
    if (!dimensions) return 'unknown';
    if (dimensions.width > dimensions.height) return 'landscape';
    if (dimensions.width < dimensions.height) return 'portrait';
    return 'square';
  };
  return parser;
}

const WIX_PORTRAIT_FLYER = 'https://static.wixstatic.com/media/aaa111~mv2.jpg/v1/fill/w_792,h_990,al_c,q_85/flyer.jpg';
const WIX_LANDSCAPE_BANNER = 'https://static.wixstatic.com/media/bbb222~mv2.jpg/v1/fill/w_1600,h_900,al_c,q_85/banner.jpg';

test('image slots: a portrait/landscape OCR twin survives consolidation and fills both slots', () => {
  const parser = stubUrlDimensionReaders(createParser());
  const ocrResults = [
    { url: WIX_PORTRAIT_FLYER, text: 'FURBALL BLACKOUT\n3 Dollar Bill', imageClassification: 'event-flyer' },
    { url: WIX_LANDSCAPE_BANNER, text: 'FURBALL BLACKOUT\n3 Dollar Bill', imageClassification: 'event-flyer' }
  ];

  const consolidated = parser.consolidateDuplicateOcrResults(ocrResults);

  // The returned array keeps its exact shape — segment pairing and the
  // extraction prompt see one entry per artwork, exactly as before.
  assert.equal(consolidated.length, 1, 'consolidation still returns one result per artwork');
  assert.equal(consolidated[0].url, WIX_LANDSCAPE_BANNER, 'largest still wins the OCR entry');
  // ...but the twin is no longer deleted.
  assert.deepEqual(consolidated[0].imageShapeVariants, [WIX_PORTRAIT_FLYER]);

  const event = { title: 'Furball Blackout', image: WIX_LANDSCAPE_BANNER };
  parser.applyImageSlots(event, { url: 'https://furball.example/events', html: '', ocrResults: consolidated });

  assert.equal(event.imageVertical, WIX_PORTRAIT_FLYER);
  assert.equal(event.imageHorizontal, WIX_LANDSCAPE_BANNER);
  assert.equal(event.image, WIX_LANDSCAPE_BANNER, 'image keeps its existing meaning and value');
});

test('image slots: the size-variant dedup keeps a differently-shaped fill of the same asset', () => {
  const parser = stubUrlDimensionReaders(createParser());
  // One Wix asset served as a portrait fill AND a landscape fill — these strip
  // to the SAME key, so the old dedup deleted one shape outright.
  const portraitFill = 'https://static.wixstatic.com/media/ccc333~mv2.jpg/v1/fill/w_600,h_900,al_c/asset.jpg';
  const landscapeFill = 'https://static.wixstatic.com/media/ccc333~mv2.jpg/v1/fill/w_1200,h_628,al_c/asset.jpg';

  const deduped = parser.deduplicateOcrResultsByUrl([
    { url: portraitFill, text: 'flyer text' },
    { url: landscapeFill, text: 'flyer text' }
  ]);

  assert.equal(deduped.length, 1);
  assert.deepEqual(deduped[0].imageShapeVariants, [portraitFill]);

  const event = { title: 'Asset Party', image: landscapeFill };
  parser.applyImageSlots(event, { html: '', ocrResults: deduped });
  assert.equal(event.imageVertical, portraitFill);
  assert.equal(event.imageHorizontal, landscapeFill);
});

test('image slots: a JSON-LD image ARRAY of three shapes fills both slots (schema.org 1x1/4x3/16x9)', () => {
  const parser = stubUrlDimensionReaders(createParser());
  const html = `
    <html><head><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'Bearracuda Portland',
      startDate: '2026-07-18T21:00:00-07:00',
      location: { '@type': 'Place', name: 'Holocene', address: '1001 SE Morrison St, Portland, OR' },
      image: [
        'https://cdn.example/w_1000,h_1000/square.jpg',
        'https://cdn.example/w_800,h_1200/portrait.jpg',
        'https://cdn.example/w_1920,h_1080/landscape.jpg'
      ]
    })}</script></head><body></body></html>`;

  const events = parser.extractEventsFromJsonLd(html, 'https://bearracuda.example/e/portland');
  assert.equal(events.length, 1);
  const event = events[0];
  // image keeps its current meaning: the FIRST published shape.
  assert.equal(event.image, 'https://cdn.example/w_1000,h_1000/square.jpg');

  parser.applyImageSlots(event, { url: 'https://bearracuda.example/e/portland', html });
  assert.equal(event.imageVertical, 'https://cdn.example/w_800,h_1200/portrait.jpg');
  assert.equal(event.imageHorizontal, 'https://cdn.example/w_1920,h_1080/landscape.jpg');
});

test('image slots: ImageObject width/height outrank the shape the URL advertises', () => {
  const parser = stubUrlDimensionReaders(createParser());
  // The URL says portrait (w_800,h_1200); the publisher says landscape.
  const candidates = parser.pickJsonLdImageCandidates([
    { '@type': 'ImageObject', url: 'https://cdn.example/w_800,h_1200/lying-url.jpg', width: 1600, height: 900 }
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].width, 1600);
  assert.equal(candidates[0].height, 900);
  assert.equal(candidates[0].authoritative, true);
  assert.equal(parser.resolveImageCandidateOrientation(candidates[0]), 'landscape');

  const event = { title: 'Authoritative Dimensions' };
  parser.rememberImageSlotCandidates(event, candidates);
  parser.applyImageSlots(event, { html: '' });
  assert.equal(event.imageHorizontal, 'https://cdn.example/w_800,h_1200/lying-url.jpg');
  assert.equal(event.imageVertical, undefined, 'the URL guess never overrides published dimensions');
});

test('image slots: og:image:width / og:image:height are parsed and drive orientation', () => {
  // No URL dimension readers at all — the published meta dimensions alone must
  // be enough (they are also the path that works before shared-core lands).
  const parser = createParser();
  const html = `
    <html><head>
      <meta property="og:image" content="https://cdn.example/artwork-a1b2c3.jpg" />
      <meta property="og:image:width" content="1080" />
      <meta property="og:image:height" content="1920" />
    </head><body></body></html>`;

  const candidates = parser.collectPageMetaImageCandidates({ url: 'https://promoter.example/e/1', html });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].width, 1080);
  assert.equal(candidates[0].height, 1920);
  assert.equal(candidates[0].authoritative, true);

  const event = { title: 'Meta Dimensions' };
  parser.applyImageSlots(event, { url: 'https://promoter.example/e/1', html });
  assert.equal(event.imageVertical, 'https://cdn.example/artwork-a1b2c3.jpg');
  assert.equal(event.imageHorizontal, undefined);
});

test('image slots: two og:image tags on one page are BOTH considered', () => {
  const parser = createParser();
  const html = `
    <html><head>
      <meta property="og:image" content="https://cdn.example/tall-a1b2c3.jpg" />
      <meta property="og:image:width" content="1000" />
      <meta property="og:image:height" content="1500" />
      <meta property="og:image" content="https://cdn.example/wide-d4e5f6.jpg" />
      <meta property="og:image:width" content="1500" />
      <meta property="og:image:height" content="1000" />
    </head><body></body></html>`;
  const htmlData = { url: 'https://promoter.example/e/2', html };

  // extractOgMetaContent (first tag only) is unchanged; the new all-tags reader
  // agrees with it on entry 0 and keeps the rest.
  assert.equal(parser.extractOgMetaContent(html, 'og:image'), 'https://cdn.example/tall-a1b2c3.jpg');
  assert.deepEqual(parser.extractOgMetaContentAll(html, 'og:image'), [
    'https://cdn.example/tall-a1b2c3.jpg',
    'https://cdn.example/wide-d4e5f6.jpg'
  ]);

  // The og:image fill still adopts the first usable tag — unchanged behaviour.
  const filled = parser.fillImageFromPageMetaArtwork({ title: 'Two Tags' }, htmlData);
  assert.equal(filled.image, 'https://cdn.example/tall-a1b2c3.jpg');
  assert.equal(filled.imageSource, 'og-image');

  // ...and the SECOND tag, previously discarded, fills the other slot.
  parser.applyImageSlots(filled, htmlData);
  assert.equal(filled.imageVertical, 'https://cdn.example/tall-a1b2c3.jpg');
  assert.equal(filled.imageHorizontal, 'https://cdn.example/wide-d4e5f6.jpg');
});

test('image slots: og:image:width/height pair by DOCUMENT ADJACENCY, not flat index', () => {
  const parser = createParser();
  // Per the OGP spec a width/height tag describes the og:image it FOLLOWS.
  // Here the FIRST og:image publishes no dimensions and the SECOND carries
  // 1080x1350 — flat-index pairing would stamp the first tag authoritative
  // portrait and put the wrong URL in the slot.
  const html = `
    <html><head>
      <meta property="og:image" content="https://cdn.example/banner-nodims.jpg" />
      <meta property="og:image" content="https://cdn.example/feed-flyer.jpg" />
      <meta property="og:image:width" content="1080" />
      <meta property="og:image:height" content="1350" />
    </head><body></body></html>`;

  const candidates = parser.collectPageMetaImageCandidates({ url: 'https://promoter.example/e/adjacency', html });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].url, 'https://cdn.example/banner-nodims.jpg');
  assert.equal(candidates[0].width, null, 'the dimensionless first tag stays unknown');
  assert.equal(candidates[0].height, null);
  assert.equal(candidates[0].authoritative, false);
  assert.equal(candidates[1].url, 'https://cdn.example/feed-flyer.jpg');
  assert.equal(candidates[1].width, 1080, 'the dims attach to the tag they follow');
  assert.equal(candidates[1].height, 1350);
  assert.equal(candidates[1].authoritative, true);

  const event = { title: 'Adjacent Dims' };
  parser.applyImageSlots(event, { url: 'https://promoter.example/e/adjacency', html });
  assert.equal(event.imageVertical, 'https://cdn.example/feed-flyer.jpg',
    'the portrait slot gets the URL the dimensions actually describe');
  assert.equal(event.imageHorizontal, undefined);
});

test('image slots: og:image:width/height before any og:image attach to nothing', () => {
  const parser = createParser();
  const html = `
    <html><head>
      <meta property="og:image:width" content="1080" />
      <meta property="og:image:height" content="1350" />
      <meta property="og:image" content="https://cdn.example/after-orphan-dims.jpg" />
    </head><body></body></html>`;

  const candidates = parser.collectPageMetaImageCandidates({ url: 'https://promoter.example/e/orphan', html });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, 'https://cdn.example/after-orphan-dims.jpg');
  assert.equal(candidates[0].width, null, 'orphan dims describe no tag and are dropped');
  assert.equal(candidates[0].height, null);
  assert.equal(candidates[0].authoritative, false);
});

test('image slots: two og:image tags each keep their OWN adjacent dimensions', () => {
  const parser = createParser();
  const html = `
    <html><head>
      <meta property="og:image" content="https://cdn.example/tall-a1b2c3.jpg" />
      <meta property="og:image:width" content="1000" />
      <meta property="og:image:height" content="1500" />
      <meta property="og:image" content="https://cdn.example/wide-d4e5f6.jpg" />
      <meta property="og:image:width" content="1500" />
      <meta property="og:image:height" content="1000" />
    </head><body></body></html>`;

  const candidates = parser.collectPageMetaImageCandidates({ url: 'https://promoter.example/e/paired', html });
  assert.equal(candidates.length, 2);
  assert.deepEqual(
    candidates.map(c => ({ url: c.url, width: c.width, height: c.height, authoritative: c.authoritative })),
    [
      { url: 'https://cdn.example/tall-a1b2c3.jpg', width: 1000, height: 1500, authoritative: true },
      { url: 'https://cdn.example/wide-d4e5f6.jpg', width: 1500, height: 1000, authoritative: true }
    ]);
});

test('image slots: og:image dims never attach to twitter:image', () => {
  const parser = createParser();
  // A realistic head: the og block first, then the Twitter card repeating a
  // DIFFERENT rendition. The og dims must not leak onto the twitter URL.
  const html = `
    <html><head>
      <meta property="og:image" content="https://cdn.example/og-flyer.jpg" />
      <meta property="og:image:width" content="1080" />
      <meta property="og:image:height" content="1350" />
      <meta name="twitter:image" content="https://cdn.example/twitter-card.jpg" />
    </head><body></body></html>`;

  const candidates = parser.collectPageMetaImageCandidates({ url: 'https://promoter.example/e/twitter', html });
  assert.equal(candidates.length, 2);
  const twitter = candidates.find(c => c.url === 'https://cdn.example/twitter-card.jpg');
  assert.ok(twitter);
  assert.equal(twitter.width, null, 'twitter:image has no dimension siblings');
  assert.equal(twitter.height, null);
  assert.equal(twitter.authoritative, false);
});

test('image slots: an event that already has an image still gets the page meta artwork considered for the OTHER slot', () => {
  const parser = createParser();
  const html = `
    <html><head>
      <meta property="og:image" content="https://cdn.example/wide-d4e5f6.jpg" />
      <meta property="og:image:width" content="1600" />
      <meta property="og:image:height" content="900" />
    </head><body></body></html>`;
  const htmlData = { url: 'https://promoter.example/e/3', html };

  const event = { title: 'Already Has One', image: 'https://cdn.example/extracted-flyer.jpg' };
  parser.fillImageFromPageMetaArtwork(event, htmlData);
  assert.equal(event.image, 'https://cdn.example/extracted-flyer.jpg', 'an existing image is never replaced');

  parser.applyImageSlots(event, htmlData);
  assert.equal(event.imageHorizontal, 'https://cdn.example/wide-d4e5f6.jpg');
  assert.equal(event.imageVertical, undefined, 'the extracted image advertises no shape — no guess');
});

test('image slots: unknown-orientation candidates fill NO slot and leave the event byte-identical', () => {
  const parser = createParser();  // no shared-core dimension readers at all
  const html = `
    <html><head>
      <meta property="og:image" content="https://cdn.example/mystery-a1b2c3.jpg" />
    </head><body></body></html>`;
  const event = {
    title: 'Unknown Shape',
    image: 'https://cdn.example/extracted-a1b2c3.jpg',
    imageSource: 'page',
    startDate: '2026-08-01T02:00:00.000Z'
  };
  const before = JSON.stringify(event);

  const logs = captureLogs(() => parser.applyImageSlots(event, { url: 'https://promoter.example/e/4', html }));

  assert.equal(JSON.stringify(event), before, 'no dimensions anywhere → the event is untouched');
  assert.equal(Object.prototype.hasOwnProperty.call(event, 'imageVertical'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(event, 'imageHorizontal'), false);
  assert.deepEqual(logs, [], 'no slots filled → no slot log line');
});

test('image slots: a logo-shaped URL never lands in a slot', () => {
  const parser = createParser();
  const html = `
    <html><head>
      <meta property="og:image" content="https://cdn.example/site-logo.png" />
      <meta property="og:image:width" content="600" />
      <meta property="og:image:height" content="900" />
      <meta property="twitter:image" content="https://cdn.example/artwork-d4e5f6.jpg" />
    </head><body></body></html>`;
  const htmlData = { url: 'https://promoter.example/e/5', html };

  const event = { title: 'Logo Guard' };
  parser.rememberImageSlotCandidates(event, [
    { url: 'https://cdn.example/sprite-sheet.png', width: 400, height: 1200, authoritative: true },
    { url: 'https://cdn.example/real-flyer.jpg', width: 800, height: 1200, authoritative: true }
  ]);
  parser.applyImageSlots(event, htmlData);

  assert.equal(event.imageVertical, 'https://cdn.example/real-flyer.jpg', 'the logo and sprite are skipped');
  assert.equal(event.imageHorizontal, undefined);
});

test('image slots: the summary log line names both slots', () => {
  const parser = createParser();
  const event = { title: 'Slot Logging' };
  parser.rememberImageSlotCandidates(event, [
    { url: 'https://cdn.example/tall.jpg', width: 800, height: 1200, authoritative: true },
    { url: 'https://cdn.example/wide.jpg', width: 1600, height: 900, authoritative: true }
  ]);
  const logs = captureLogs(() => parser.applyImageSlots(event, { html: '' }));
  assert.deepEqual(logs, [
    '🖼️ IMAGE SLOTS: vertical=https://cdn.example/tall.jpg horizontal=https://cdn.example/wide.jpg for "Slot Logging"'
  ]);
});

test('image slots: near-square artwork belongs to neither slot', () => {
  const parser = createParser();
  assert.equal(parser.orientationFromImageDimensions(1000, 1000), 'square');
  assert.equal(parser.orientationFromImageDimensions(1050, 1000), 'square', 'a 5% difference is not an orientation');
  assert.equal(parser.orientationFromImageDimensions(1200, 1000), 'landscape');
  assert.equal(parser.orientationFromImageDimensions(1000, 1200), 'portrait');
  assert.equal(parser.orientationFromImageDimensions(0, 1200), 'unknown');
  assert.equal(parser.orientationFromImageDimensions('1600 px', '900'), 'landscape');
});

test('image slots: the larger candidate wins inside one orientation', () => {
  const parser = createParser();
  const event = { title: 'Biggest Wins' };
  parser.rememberImageSlotCandidates(event, [
    { url: 'https://cdn.example/small-tall.jpg', width: 400, height: 600, authoritative: true },
    { url: 'https://cdn.example/big-tall.jpg', width: 1200, height: 1800, authoritative: true }
  ]);
  parser.applyImageSlots(event, { html: '' });
  assert.equal(event.imageVertical, 'https://cdn.example/big-tall.jpg');
});

test('image slots: a parser-config declared slot is never clobbered, only joined', () => {
  const parser = createParser();
  // parserConfig.metadata assigns unconditionally and runs BEFORE the slots
  // pass, so a curated slot value must survive it.
  const event = { title: 'Curated Slot', imageVertical: 'https://cdn.example/curated-tall.jpg' };
  parser.rememberImageSlotCandidates(event, [
    { url: 'https://cdn.example/derived-tall.jpg', width: 800, height: 1200, authoritative: true },
    { url: 'https://cdn.example/derived-wide.jpg', width: 1600, height: 900, authoritative: true }
  ]);
  const logs = captureLogs(() => parser.applyImageSlots(event, { html: '' }));

  assert.equal(event.imageVertical, 'https://cdn.example/curated-tall.jpg', 'the declared slot wins');
  assert.equal(event.imageHorizontal, 'https://cdn.example/derived-wide.jpg', 'the empty slot is still filled');
  assert.deepEqual(logs, [
    '🖼️ IMAGE SLOTS: vertical=https://cdn.example/curated-tall.jpg horizontal=https://cdn.example/derived-wide.jpg for "Curated Slot"'
  ]);
});

test('image slots: real bearracuda.com og:image dimensions resolve a portrait slot (live-run shape)', () => {
  // Verbatim meta shape from https://bearracuda.com/events/treasure-trail-seattle/
  // — the page publishes 620x958, which nothing in the repo used to read.
  const parser = createParser();
  const html = `
    <html><head>
      <meta property="og:image" content="https://bearracuda.com/wp-content/uploads/2026/07/sausageweb.jpg" />
      <meta property="og:image:width" content="620" />
      <meta property="og:image:height" content="958" />
      <meta property="og:image:type" content="image/jpeg" />
    </head><body></body></html>`;
  const event = { title: 'Treasure Trail Seattle' };
  parser.applyImageSlots(event, { url: 'https://bearracuda.com/events/treasure-trail-seattle/', html });
  assert.equal(event.imageVertical, 'https://bearracuda.com/wp-content/uploads/2026/07/sausageweb.jpg');
  assert.equal(event.imageHorizontal, undefined);
});

// ---------------------------------------------------------------------------
// MEASURED IMAGE DIMENSIONS (header bytes) → orientation slots
// ---------------------------------------------------------------------------
// Published/URL-encoded dimensions covered only a minority of real images, so
// both orientation slots were effectively never populated. These pin the byte
// math that reads a file's real shape out of its own header, and the wiring
// that turns it into imageVertical/imageHorizontal.
//
// Every fixture below is CONSTRUCTED — minimal valid headers, no network. The
// pixel pairs are the real dimensions of the corresponding images in the
// cached OCR corpus (verified against `sips` on the downloaded files).

function toBase64Fixture(byteValues) {
  return Buffer.from(Uint8Array.from(byteValues)).toString('base64');
}

function be32(value) {
  return [(value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF];
}

function be16(value) {
  return [(value >>> 8) & 0xFF, value & 0xFF];
}

function le16(value) {
  return [value & 0xFF, (value >>> 8) & 0xFF];
}

function le24(value) {
  return [value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF];
}

// PNG: 8-byte signature + IHDR chunk (length, type, width, height, ...).
function pngHeaderBytes(width, height) {
  return [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
    .concat(be32(13), [0x49, 0x48, 0x44, 0x52], be32(width), be32(height), [8, 6, 0, 0, 0, 0, 0, 0, 0]);
}

// JPEG: SOI, an optional metadata segment of `paddingBytes` payload (an ICC/
// EXIF stand-in the SOF scan has to walk past), then SOF0 and EOI.
function jpegHeaderBytes(width, height, paddingBytes = 0, sofMarker = 0xC0) {
  const bytes = [0xFF, 0xD8];
  if (paddingBytes > 0) {
    bytes.push(0xFF, 0xE1, ...be16(paddingBytes + 2));
    for (let i = 0; i < paddingBytes; i++) bytes.push(0x00);
  }
  // SOF payload: length(2) precision(1) height(2) width(2) components(1) ...
  bytes.push(0xFF, sofMarker, ...be16(17), 8, ...be16(height), ...be16(width), 3,
    1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  bytes.push(0xFF, 0xD9);
  return bytes;
}

function riffWrap(fourCC, payload) {
  const chunk = [].concat(
    Array.from(fourCC, (c) => c.charCodeAt(0)),
    le16(payload.length).concat([0, 0]),
    payload
  );
  const body = Array.from('WEBP', (c) => c.charCodeAt(0)).concat(chunk);
  return Array.from('RIFF', (c) => c.charCodeAt(0))
    .concat(le16(body.length).concat([0, 0]), body);
}

// WebP lossy ("VP8 "): 3-byte frame tag, the 9D 01 2A start code, 14-bit dims.
function webpLossyBytes(width, height) {
  return riffWrap('VP8 ', [0x30, 0x01, 0x00, 0x9D, 0x01, 0x2A]
    .concat(le16(width & 0x3FFF), le16(height & 0x3FFF), [0, 0, 0, 0]));
}

// WebP lossless ("VP8L"): 0x2F signature then 14 bits (width-1), 14 bits (height-1).
function webpLosslessBytes(width, height) {
  const w = width - 1;
  const h = height - 1;
  const b0 = w & 0xFF;
  const b1 = ((w >> 8) & 0x3F) | ((h & 0x03) << 6);
  const b2 = (h >> 2) & 0xFF;
  const b3 = (h >> 10) & 0x0F;
  return riffWrap('VP8L', [0x2F, b0, b1, b2, b3, 0, 0, 0, 0, 0]);
}

// WebP extended ("VP8X"): 4 flag bytes then canvas (width-1)/(height-1) as LE24.
function webpExtendedBytes(width, height) {
  return riffWrap('VP8X', [0x10, 0, 0, 0].concat(le24(width - 1), le24(height - 1), [0, 0, 0, 0]));
}

// GIF: "GIF89a" then little-endian screen width/height.
function gifHeaderBytes(width, height) {
  return Array.from('GIF89a', (c) => c.charCodeAt(0))
    .concat(le16(width), le16(height), [0xF7, 0x00, 0x00]);
}

test('measured dimensions: PNG IHDR, JPEG SOFn, WebP VP8/VP8L/VP8X and GIF headers all decode', () => {
  const parser = createParser();
  const read = (bytes) => parser.readImageDimensionsFromBase64(toBase64Fixture(bytes));

  // bearracuda.com/wp-content/uploads/2026/05/45-3.png — real 1111x1389.
  assert.deepEqual(read(pngHeaderBytes(1111, 1389)), { width: 1111, height: 1389 });
  // bearracuda.com/wp-content/uploads/2025/11/ttfinal.jpg — real 1206x1510.
  assert.deepEqual(read(jpegHeaderBytes(1206, 1510)), { width: 1206, height: 1510 });
  // eaglela.com/wp-content/uploads/IG_Lucky-Break-poster-2024.jpg — real 1000x1000.
  assert.deepEqual(read(jpegHeaderBytes(1000, 1000)), { width: 1000, height: 1000 });
  // massive.club webflow flyer (…_dc685dbe…webp) — real lossy 1080x1350.
  assert.deepEqual(read(webpLossyBytes(1080, 1350)), { width: 1080, height: 1350 });
  // massive.club …6765b8ee…_cal.webp — real extended-format 2400x1600.
  assert.deepEqual(read(webpExtendedBytes(2400, 1600)), { width: 2400, height: 1600 });
  assert.deepEqual(read(webpLosslessBytes(1155, 1540)), { width: 1155, height: 1540 });
  assert.deepEqual(read(gifHeaderBytes(600, 800)), { width: 600, height: 800 });

  // Progressive JPEG (SOF2) states its frame the same way.
  assert.deepEqual(read(jpegHeaderBytes(1800, 1500, 0, 0xC2)), { width: 1800, height: 1500 });
  // …and the scan walks past a metadata segment to reach the frame header.
  assert.deepEqual(read(jpegHeaderBytes(620, 958, 4096)), { width: 620, height: 958 });
});

test('measured dimensions: a JPEG whose SOF sits past the cheap prefix is still measured', () => {
  const parser = createParser();
  // Real corpus: static.wixstatic.com/media/f91121_262bf60c…~mv2.jpg carries a
  // ~550KB ICC profile chunked across nine 64KB APP2 segments and puts SOF0 at
  // byte 591,621 — far beyond the first-stage prefix.
  const padding = parser.imageHeaderPrefixBytes + 4096;
  const bytes = jpegHeaderBytes(1448, 1448, padding);
  assert.equal(parser.readImageDimensionsFromBytes(
    parser.decodeBase64Prefix(toBase64Fixture(bytes), parser.imageHeaderPrefixBytes)
  ), null, 'the first-stage prefix genuinely cannot reach this frame header');
  assert.deepEqual(parser.readImageDimensionsFromBase64(toBase64Fixture(bytes)), { width: 1448, height: 1448 });
});

test('measured dimensions: unreadable bytes fail open and quietly — never a throw, never a guess', () => {
  const parser = createParser();
  const read = (value) => parser.readImageDimensionsFromBase64(value);

  assert.equal(read(''), null);
  assert.equal(read(null), null);
  assert.equal(read('not base64 at all !!!'), null);
  // An SVG (the parser's own nonImageAssetExtensions list already skips these).
  assert.equal(read(Buffer.from('<svg width="800" height="1200"></svg>').toString('base64')), null);
  // An HTML error page served with an image content-type.
  assert.equal(read(Buffer.from('<!doctype html><html><body>404</body></html>').toString('base64')), null);
  // A PNG signature with the IHDR chunk truncated away.
  assert.equal(read(toBase64Fixture(pngHeaderBytes(800, 1200).slice(0, 14))), null);
  // A RIFF container that is not WebP at all.
  assert.equal(read(Buffer.from('RIFF    WAVEfmt ').toString('base64')), null);
  // AVIF: out of the four covered formats — unmeasured, not mis-measured.
  assert.equal(read(toBase64Fixture([0, 0, 0, 0x20].concat(
    Array.from('ftypavifavifmif1miafMA1B', (c) => c.charCodeAt(0))
  ))), null);
});

test('measured dimensions: 1x1 lazy-load placeholders and tracking pixels are never artwork', () => {
  const parser = createParser();
  // The exact 1x1 transparent GIF real pages inline as a lazy-loading src.
  const placeholder = 'R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  assert.equal(parser.readImageDimensionsFromBase64(placeholder), null);
  // dice.fm/static/images/1px.png in the real corpus — a 1x1 PNG spacer.
  assert.equal(parser.readImageDimensionsFromBase64(toBase64Fixture(pngHeaderBytes(1, 1))), null);
  // A 1x8 spacer is not "portrait artwork".
  assert.equal(parser.readImageDimensionsFromBase64(toBase64Fixture(gifHeaderBytes(1, 8))), null);
  // The guard is a floor, not a shape test — real artwork above it still reads.
  assert.deepEqual(parser.readImageDimensionsFromBase64(toBase64Fixture(pngHeaderBytes(16, 32))), { width: 16, height: 32 });
});

test('image slots: a measured portrait fills imageVertical and leaves image untouched', () => {
  const parser = createParser();
  // massive.club flyer, real lossy-WebP 1080x1350 — the URL advertises nothing
  // and the page publishes no dimensions, so before measurement this filled
  // NO slot at all.
  const flyer = 'https://cdn.prod.website-files.com/659447a9dbb86fcea688b307/6a5aa7114f13cc7c6b4f5068_dc685dbe-a18c-49bb-abed-28941ad9a8fd.webp';
  assert.equal(parser.getMeasuredImageDimensions(flyer), null);
  parser.measureImageDimensionsFromBase64(flyer, toBase64Fixture(webpLossyBytes(1080, 1350)));
  assert.deepEqual(parser.getMeasuredImageDimensions(flyer), { width: 1080, height: 1350 });

  const event = { title: 'MASSIVE', image: flyer };
  parser.applyImageSlots(event, { url: 'https://massive.club/events', html: '' });
  assert.equal(event.imageVertical, flyer);
  assert.equal(event.imageHorizontal, undefined);
  assert.equal(event.image, flyer, 'image keeps its existing meaning and value');
});

test('image slots: a measured landscape fills imageHorizontal', () => {
  const parser = createParser();
  // bearracuda.com/wp-content/uploads/2026/03/pdxnew.jpg — real 1800x1500.
  const banner = 'https://bearracuda.com/wp-content/uploads/2026/03/pdxnew.jpg';
  parser.measureImageDimensionsFromBase64(banner, toBase64Fixture(jpegHeaderBytes(1800, 1500)));

  const event = { title: 'Bearracuda Portland', image: banner };
  parser.applyImageSlots(event, { url: 'https://bearracuda.com/events/portland/', html: '' });
  assert.equal(event.imageHorizontal, banner);
  assert.equal(event.imageVertical, undefined);
});

test('image slots: measured square artwork fills NEITHER slot (Eagle LA ships 1000x1000 flyers)', () => {
  const parser = createParser();
  // Every eaglela.com flyer in the cached corpus is a 1000x1000 Instagram
  // poster, and its WordPress derivative is 300x300 — "or neither (squarish)".
  const square = 'https://eaglela.com/wp-content/uploads/IG_Lucky-Break-poster-2024.jpg';
  const derivative = 'https://eaglela.com/wp-content/uploads/IG_Lucky-Break-poster-2024-300x300.jpg';
  parser.measureImageDimensionsFromBase64(square, toBase64Fixture(jpegHeaderBytes(1000, 1000)));
  parser.measureImageDimensionsFromBase64(derivative, toBase64Fixture(jpegHeaderBytes(300, 300)));

  const event = { title: 'Lucky Break', image: square };
  parser.rememberImageSlotCandidates(event, [{ url: derivative, width: null, height: null, authoritative: false }]);
  const logs = captureLogs(() => parser.applyImageSlots(event, { url: 'https://eaglela.com/events/', html: '' }));

  assert.equal(Object.prototype.hasOwnProperty.call(event, 'imageVertical'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(event, 'imageHorizontal'), false);
  assert.equal(event.image, square, 'the primary image is untouched');
  assert.deepEqual(logs, [], 'no slot filled → no slot log line');

  // The deadband is what makes "squarish" mean something: a 1000x1050 flyer is
  // 5% off square and still belongs in neither slot, while 1000x1100 (exactly
  // the 1.1 threshold) is a portrait.
  assert.equal(parser.orientationFromImageDimensions(1000, 1050), 'square');
  assert.equal(parser.orientationFromImageDimensions(1000, 1100), 'portrait');
});

test('image slots: measured pixels outrank a published dimension that describes another rendition', () => {
  const parser = createParser();
  // The page advertises the ORIGINAL's landscape shape while serving a
  // portrait crop. The bytes are the only thing that knows what was served.
  const html = `
    <html><head>
      <meta property="og:image" content="https://cdn.example/served-crop.jpg" />
      <meta property="og:image:width" content="1600" />
      <meta property="og:image:height" content="900" />
    </head><body></body></html>`;
  parser.measureImageDimensionsFromBase64('https://cdn.example/served-crop.jpg', toBase64Fixture(jpegHeaderBytes(1080, 1920)));

  const event = { title: 'Lying Meta' };
  parser.applyImageSlots(event, { url: 'https://promoter.example/e/measured', html });
  assert.equal(event.imageVertical, 'https://cdn.example/served-crop.jpg');
  assert.equal(event.imageHorizontal, undefined, 'the published claim never overrides the file itself');
});

test('image slots: a measured slot logs additively without touching the existing slot line', () => {
  const parser = createParser();
  const portrait = 'https://cdn.example/measured-tall.jpg';
  const landscape = 'https://cdn.example/measured-wide.jpg';
  parser.measureImageDimensionsFromBase64(portrait, toBase64Fixture(jpegHeaderBytes(1200, 1500)));
  parser.measureImageDimensionsFromBase64(landscape, toBase64Fixture(webpExtendedBytes(2400, 1600)));

  const event = { title: 'Measured Logging' };
  parser.rememberImageSlotCandidates(event, [
    { url: portrait, width: null, height: null, authoritative: false },
    { url: landscape, width: null, height: null, authoritative: false }
  ]);
  const logs = captureLogs(() => parser.applyImageSlots(event, { html: '' }));
  assert.deepEqual(logs, [
    '🤖 AI Web: imageVertical measured 1200x1500 from image header for "Measured Logging"',
    '🤖 AI Web: imageHorizontal measured 2400x1600 from image header for "Measured Logging"',
    '🖼️ IMAGE SLOTS: vertical=https://cdn.example/measured-tall.jpg horizontal=https://cdn.example/measured-wide.jpg for "Measured Logging"'
  ]);
});

test('image slots: a data: URI candidate is never measured and never fills a slot', () => {
  const parser = createParser();
  const placeholder = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  assert.equal(parser.measureImageDimensionsFromBase64(placeholder, toBase64Fixture(pngHeaderBytes(800, 1200))), null,
    'a non-http value cannot be keyed, so it can never carry a measurement');
  assert.equal(parser.getMeasuredImageDimensions(placeholder), null);

  const event = { title: 'Lazy Placeholder', image: placeholder };
  parser.rememberImageSlotCandidates(event, [{ url: placeholder, width: null, height: null, authoritative: false }]);
  parser.applyImageSlots(event, { html: '' });
  assert.equal(Object.prototype.hasOwnProperty.call(event, 'imageVertical'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(event, 'imageHorizontal'), false);
});

test('measured dimensions: the OCR download path measures the bytes it already fetched', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-measure-test-'));

  const parser = new AiWebParser({ normalizeUrl, ocrCacheDir: cacheDir });
  parser.core = new SharedCore({}, { eventSchema: EventSchema });

  const imageUrl = 'https://cdn.prod.website-files.com/659447a9dbb86fcea688b307/6a45a0af_flyer.webp';
  const ocrConfig = { cacheEnabled: true, model: 'test-vision', prompt: 'ocr prompt', timeoutSeconds: 30 };
  let downloads = 0;
  const httpAdapter = {
    fetchImageAsBase64: async () => {
      downloads++;
      return toBase64Fixture(webpLossyBytes(1155, 1540));
    }
  };
  parser.core.callAiGenerate = async () => JSON.stringify({ text: 'BEAR NIGHT', imageClassification: 'event-flyer', confidence: 90 });

  const result = await parser.getOcrTextForImage(imageUrl, ocrConfig, 'ocr-all', httpAdapter);
  assert.equal(result.text, 'BEAR NIGHT');
  assert.equal(downloads, 1, 'the measurement reuses the OCR download — no second fetch');
  assert.deepEqual(parser.getMeasuredImageDimensions(imageUrl), { width: 1155, height: 1540 });

  const event = { title: 'Bear Night', image: imageUrl };
  parser.applyImageSlots(event, { url: 'https://massive.club/events', html: '' });
  assert.equal(event.imageVertical, imageUrl);

  // A second parser starts with no measurements, hits the OCR cache (so the
  // bytes are never re-downloaded) and must STILL be able to fill the slot.
  const nextRun = new AiWebParser({ normalizeUrl, ocrCacheDir: cacheDir });
  nextRun.core = new SharedCore({}, { eventSchema: EventSchema });
  nextRun.core.callAiGenerate = async () => { throw new Error('AI must not run on a cache hit'); };
  const cached = await nextRun.getOcrTextForImage(imageUrl, ocrConfig, 'ocr-all', {
    fetchImageAsBase64: async () => { throw new Error('a cache hit must not re-download the image'); }
  });
  assert.equal(cached.cached, true);
  assert.deepEqual(nextRun.getMeasuredImageDimensions(imageUrl), { width: 1155, height: 1540 },
    'the stored measurement is what keeps orientation alive across runs');

  const cachedEvent = { title: 'Bear Night', image: imageUrl };
  nextRun.applyImageSlots(cachedEvent, { url: 'https://massive.club/events', html: '' });
  assert.equal(cachedEvent.imageVertical, imageUrl);

  fs.rmSync(cacheDir, { recursive: true, force: true });
});

test('measured dimensions: an unmeasurable OCR image writes a cache entry with no dimensions and no slot', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-measure-open-'));

  const parser = new AiWebParser({ normalizeUrl, ocrCacheDir: cacheDir });
  parser.core = new SharedCore({}, { eventSchema: EventSchema });
  parser.core.callAiGenerate = async () => JSON.stringify({ text: 'SOME TEXT', imageClassification: 'event-flyer' });

  const imageUrl = 'https://cdn.example/mystery-format.avif';
  const ocrConfig = { cacheEnabled: true, model: 'test-vision', prompt: 'ocr prompt', timeoutSeconds: 30 };
  const result = await parser.getOcrTextForImage(imageUrl, ocrConfig, 'ocr-all', {
    fetchImageAsBase64: async () => toBase64Fixture([0, 0, 0, 0x20].concat(
      Array.from('ftypavifavifmif1miafMA1B', (c) => c.charCodeAt(0))
    ))
  });
  assert.equal(result.text, 'SOME TEXT', 'OCR is completely unaffected by an unreadable header');
  assert.equal(parser.getMeasuredImageDimensions(imageUrl), null);

  const stored = JSON.parse(fs.readFileSync(result.cachePath, 'utf8'));
  assert.equal(Object.prototype.hasOwnProperty.call(stored, 'imagePixels'), false,
    'nothing measured → nothing stored, rather than a guess');

  const event = { title: 'Mystery', image: imageUrl };
  parser.applyImageSlots(event, { html: '' });
  assert.equal(Object.prototype.hasOwnProperty.call(event, 'imageVertical'), false);

  fs.rmSync(cacheDir, { recursive: true, force: true });
});

test('strips a leading date phrase from an event title, and only then', () => {
  const parser = createParser();
  const strip = (title) => parser.stripLeadingDatePhraseFromTitle(title);

  // The Bear Cave's Sitges listings put the whole date in the title.
  assert.equal(strip('Wednesday 9th September – BEEFMINCE MEET MARKET'), 'BEEFMINCE MEET MARKET');
  assert.equal(strip('Saturday 12th September – BEEFMINCE: THE BIG BALL'), 'BEEFMINCE: THE BIG BALL');
  assert.equal(strip('Friday 11th September – BEEFMINCE SPORTS ZONE'), 'BEEFMINCE SPORTS ZONE');

  // Fail closed everywhere else: a trailing date stays, a meaningful prefix
  // stays, and a title with no separator is untouched.
  assert.equal(strip('CHUNK Portland - 5/23'), 'CHUNK Portland - 5/23');
  assert.equal(strip('CHUNK Brooklyn 7/4'), 'CHUNK Brooklyn 7/4');
  assert.equal(strip('TREASURE TRAIL Portland: TIX AT THE DOOR'), 'TREASURE TRAIL Portland: TIX AT THE DOOR');
  assert.equal(strip('Bearracuda Atlanta: Winter Beef Ball'), 'Bearracuda Atlanta: Winter Beef Ball');
  assert.equal(strip('Bear Week Sitges - Opening Party'), 'Bear Week Sitges - Opening Party');
  assert.equal(strip(''), '');
});

// ---------------------------------------------------------------------------
// Title doctrine, promoter half: the organizer brand belongs in the event's
// NAME (run 20260731-124200 shipped "The RETURN"). PREFIX ONLY — never strip.
// ---------------------------------------------------------------------------

const CHUNK_BRAND_HTML = '<html><head><meta property="og:site_name" content="CHUNK"/>'
  + '<script type="application/ld+json">{"@context":"https://schema.org/","@type":"WebSite","name":"CHUNK","url":"https://www.chunk-party.com"}</script>'
  + '</head><body></body></html>';
function createChunkParser() {
  const parser = createParser();
  parser.core.promoters = [{ name: 'CHUNK' }];
  return parser;
}
const CHUNK_PAGE = () => ({ html: CHUNK_BRAND_HTML, url: 'https://www.chunk-party.com/event-details/x' });
const CHUNK_CONFIG = { name: 'CHUNK' };

test('prefixes the organizer brand onto a title that lacks it, idempotently', () => {
  const parser = createChunkParser();
  const brands = parser.getPageBrandNames(CHUNK_PAGE());
  const prefix = (title) => parser.buildBrandPrefixedTitle(title, brands, CHUNK_PAGE(), CHUNK_CONFIG);

  assert.equal(prefix('The RETURN'), 'CHUNK: The RETURN');
  assert.equal(prefix('NEW YEARS EVE'), 'CHUNK: NEW YEARS EVE');

  // Idempotent in ANY casing or position — a re-run never doubles up. Every
  // brand-bearing title from run 20260731-120505 is left exactly as it is.
  for (const title of [
    'CHUNK Portland - SUMMER BLOW OUT!',
    'CHUNK Chicago - September 19th',
    'CHUNK DORE ALLEY - Saturday July 25th',
    'CHUNK Brooklyn 7/4',
    'CHUNK Brooklyn - 5/9',
    'CHUNK CHICAGO presents SPRING THAW!',
    'CHUNK CHICAGO presents SAUSAGE PARTY!',
    'CHUNK BROOKLYN - The Return!',
    'chunk portland - the return!',
    'Summer Blow Out — CHUNK'
  ]) {
    assert.equal(prefix(title), '', `already names the brand: ${title}`);
  }
  // And prefixing an already-prefixed title is a no-op.
  assert.equal(prefix(prefix('The RETURN')), '');
});

test('the brand prefix never collapses a title to the bare brand', () => {
  const parser = createChunkParser();
  const brands = parser.getPageBrandNames(CHUNK_PAGE());
  const prefix = (title) => parser.buildBrandPrefixedTitle(title, brands, CHUNK_PAGE(), CHUNK_CONFIG);
  // "<BRAND> <city> <date>" is how this promoter names events: stripping the
  // city and date would collapse four distinct events to the single string
  // "CHUNK". Nothing is ever removed here — the title comes back untouched.
  assert.equal(prefix('CHUNK Brooklyn 7/4'), '');
  // A title that is nothing BUT brand tokens has no name to carry.
  assert.equal(prefix('CHUNK'), '');
  assert.equal(prefix('chunk'), '');
  assert.equal(prefix(''), '');
});

test('the brand prefix demands BOTH curated signals and skips venue sites', () => {
  const brands = createChunkParser().getPageBrandNames(CHUNK_PAGE());

  // Registry knows CHUNK but the parser is named after something else — the
  // aggregator/platform case (linktr.ee → "Linktree", dice.fm → "DICE").
  const wrongParser = createChunkParser();
  assert.equal(wrongParser.buildBrandPrefixedTitle('The RETURN', brands, CHUNK_PAGE(), { name: 'Cubhouse' }), '');
  assert.equal(wrongParser.buildBrandPrefixedTitle('The RETURN', brands, CHUNK_PAGE(), null), '');

  // Parser name matches but the promoter registry does not know the brand —
  // an aggregator named after itself ("The Bear Calendar") lands here.
  const noRegistry = createParser();
  noRegistry.core.promoters = [];
  assert.equal(noRegistry.buildBrandPrefixedTitle('The RETURN', brands, CHUNK_PAGE(), CHUNK_CONFIG), '');
  const corelessParser = new AiWebParser({ normalizeUrl });
  assert.equal(corelessParser.buildBrandPrefixedTitle('The RETURN', brands, CHUNK_PAGE(), CHUNK_CONFIG), '');

  // A page that is the VENUE's own site: there the brand IS the venue.
  const venueParser = createChunkParser();
  const venuePage = { html: CHUNK_BRAND_HTML, url: 'https://www.chunk-party.com/x', pageSiteRole: 'venue' };
  assert.equal(venueParser.buildBrandPrefixedTitle('The RETURN', brands, venuePage, CHUNK_CONFIG), '');

  // No derived brand → nothing is invented.
  assert.equal(createChunkParser().buildBrandPrefixedTitle('The RETURN', [], CHUNK_PAGE(), CHUNK_CONFIG), '');
});

// ---------------------------------------------------------------------------
// Bar plausibility gate: placeholder and website-domain rejections
// ---------------------------------------------------------------------------

test('drops a placeholder or website-domain bar, and keeps dotted venue names', () => {
  const parser = createParser();
  const gate = (bar, city = 'nyc') => {
    const event = { bar, city };
    parser.applyBarPlausibilityGate(event, {});
    return event.bar;
  };
  // Placeholder (run 20260731 shipped SPOOKMINCE with bar "Venue TBA").
  assert.equal(gate('Venue TBA'), undefined);
  assert.equal(gate('TBA'), undefined);
  assert.equal(gate('Venue TBC'), undefined);
  assert.equal(gate('To Be Announced'), undefined);
  // Website domain (run 20260731 shipped bar "CHUNK-PARTY.COM").
  assert.equal(gate('CHUNK-PARTY.COM'), undefined);
  assert.equal(gate('www.chunk-party.com'), undefined);
  assert.equal(gate('https://bearracuda.com'), undefined);
  // Dotted venue names are NOT domains — all three are curated venues.
  assert.equal(gate('massive.club', 'berlin'), 'massive.club');
  assert.equal(gate('MASSIVE.CLUB', 'berlin'), 'MASSIVE.CLUB');
  assert.equal(gate('BEEF.BKK', 'bangkok'), 'BEEF.BKK');
  assert.equal(gate('BARBER.BAR', 'bangkok'), 'BARBER.BAR');
  // Ordinary venue names are untouched.
  assert.equal(gate("C'mon Everybody"), "C'mon Everybody");
  assert.equal(gate('F8 Nightclub & Bar', 'sf'), 'F8 Nightclub & Bar');
  assert.equal(gate('Nova PDX', 'portland'), 'Nova PDX');
  // A name containing a domain-ish word is not a bare host.
  assert.equal(gate('The Web Bar'), 'The Web Bar');
});

// ---------------------------------------------------------------------------
// Truncated-title repair from the page's own JSON-LD Event name (run
// 20260731-124200: CHUNK's page publishes "CHUNK Portland - The RETURN!
// Saturday March 14th" in JSON-LD, <title>, og:title and <h1>, and extraction
// shipped "The RETURN")
// ---------------------------------------------------------------------------

const jsonLdEventPage = (...nodes) => `<html><head>${nodes
  .map(node => `<script type="application/ld+json">${JSON.stringify(node)}</script>`)
  .join('')}</head><body></body></html>`;
const jsonLdEventNode = (name) => ({
  '@context': 'https://schema.org',
  '@type': 'Event',
  name,
  startDate: '2026-03-14T21:00:00-07:00'
});

test('restores a truncated title from the page JSON-LD event name that contains it', () => {
  const parser = createParser();
  const html = jsonLdEventPage(jsonLdEventNode('CHUNK Portland - The RETURN! Saturday March 14th'));
  const htmlData = { html, url: 'https://www.chunk-party.com/event-details/chunk-portland-the-return-saturday-march-14th' };
  assert.equal(
    parser.repairTruncatedTitleFromJsonLd('The RETURN', htmlData),
    'CHUNK Portland - The RETURN! Saturday March 14th');
  // Case, punctuation and whitespace differences never block the repair.
  assert.equal(
    parser.repairTruncatedTitleFromJsonLd('the  return!', htmlData),
    'CHUNK Portland - The RETURN! Saturday March 14th');
});

test('never swaps in a JSON-LD event name that does not contain the extracted title', () => {
  const parser = createParser();
  const htmlData = { html: jsonLdEventPage(jsonLdEventNode('CHUNK Portland - SUMMER BLOW OUT!')), url: 'https://www.chunk-party.com/x' };
  assert.equal(parser.repairTruncatedTitleFromJsonLd('The RETURN', htmlData), 'The RETURN');
  // Word fragments are not containment: "RETURN" must not match "RETURNS".
  const fragmentData = { html: jsonLdEventPage(jsonLdEventNode('CHUNK RETURNS to Portland')), url: 'https://www.chunk-party.com/x' };
  assert.equal(parser.repairTruncatedTitleFromJsonLd('RETURN', fragmentData), 'RETURN');
  // An equal name is not a truncation, and there is nothing to repair.
  const equalData = { html: jsonLdEventPage(jsonLdEventNode('The RETURN')), url: 'https://www.chunk-party.com/x' };
  assert.equal(parser.repairTruncatedTitleFromJsonLd('The RETURN', equalData), 'The RETURN');
  // Ambiguity fails closed: two structured names contain the same title.
  const ambiguousData = {
    html: jsonLdEventPage(
      jsonLdEventNode('CHUNK Brooklyn - The Return!'),
      jsonLdEventNode('CHUNK Portland - The Return! Saturday March 14th')),
    url: 'https://www.chunk-party.com/x'
  };
  assert.equal(parser.repairTruncatedTitleFromJsonLd('The Return', ambiguousData), 'The Return');
  // No structured data, no title, no htmlData → unchanged.
  assert.equal(parser.repairTruncatedTitleFromJsonLd('The RETURN', { html: '<html></html>', url: 'https://x.example/' }), 'The RETURN');
  assert.equal(parser.repairTruncatedTitleFromJsonLd('', { html: jsonLdEventPage(jsonLdEventNode('CHUNK Portland - The RETURN!')) }), '');
  assert.equal(parser.repairTruncatedTitleFromJsonLd('The RETURN', null), 'The RETURN');
});

test('the JSON-LD title repair fails open without a core and composes with the other title cleanups', () => {
  // Fail open: the gate needs SharedCore's JSON-LD reader.
  const coreless = new AiWebParser({ normalizeUrl });
  const html = jsonLdEventPage(jsonLdEventNode('CHUNK Portland - The RETURN! Saturday March 14th'));
  assert.deepEqual(coreless.getPageJsonLdEventNames({ html }), []);
  assert.equal(coreless.repairTruncatedTitleFromJsonLd('The RETURN', { html }), 'The RETURN');

  // Through the real normalization path, the repaired title still faces the
  // leading-date strip, the pipe brand-suffix strip, and the redundant-date
  // strip. The trailing "Saturday March 14th" is attached by whitespace
  // rather than a separator; it used to survive because detectTitleDateSegment
  // required a separator, and the live AI arbiter then had to talk itself out
  // of it case by case ("adds the event date, which is not part of the event's
  // identity"). It matches startDate, so it is now removed deterministically.
  const parser = createParser();
  const repaired = parser.normalizeAiEvent(
    { title: 'The RETURN', startDate: '2026-03-14T21:00:00-07:00' },
    {}, { html, url: 'https://www.chunk-party.com/x' }, null, null);
  assert.equal(repaired.title, 'CHUNK Portland - The RETURN!');

  const datedParser = createParser();
  const dated = datedParser.normalizeAiEvent(
    { title: 'BEEFMINCE MEET MARKET', startDate: '2026-09-09T21:00:00Z' },
    {}, { html: jsonLdEventPage(jsonLdEventNode('Wednesday 9th September - BEEFMINCE MEET MARKET NIGHT')), url: 'https://bear.example/x' },
    null, null);
  assert.equal(dated.title, 'BEEFMINCE MEET MARKET NIGHT');

  const brandedParser = createParser();
  const brandedHtml = `<html><head><meta property="og:site_name" content="CHUNK"/>`
    + `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'CHUNK', url: 'https://www.chunk-party.com' })}</script>`
    + `<script type="application/ld+json">${JSON.stringify(jsonLdEventNode('CHUNK Portland - The RETURN! Saturday March 14th | CHUNK'))}</script>`
    + `</head><body></body></html>`;
  const branded = brandedParser.normalizeAiEvent(
    { title: 'The RETURN', startDate: '2026-03-14T21:00:00-07:00' },
    {}, { html: brandedHtml, url: 'https://www.chunk-party.com/x' }, null, null);
  // Brand suffix stripped, then the redundant trailing date — both cleanups
  // compose on the repaired title.
  assert.equal(branded.title, 'CHUNK Portland - The RETURN!');
});

// ---------------------------------------------------------------------------
// Maps-link coordinate candidates (Dice.fm event pages publish the venue's
// pin in the ll= param of their "Open in maps" link — high value, but Dice
// geocoded Westminster Pier ~940 m off, onto a DIFFERENT pier, and pins
// "Venue TBA" at the centre of London)
// ---------------------------------------------------------------------------

// Verbatim hrefs from the cached Dice pages (raw HTML form: &amp;-encoded,
// and the Horizon link carries a numeric entity INSIDE the query).
const DICE_CONCORDE_HREF = 'https://maps.google.com/?q=Concorde%202%2C%20Madeira%20Shelter%20Hall%2C%20Madeira%20Dr%2C%20Brighton%20BN2%201EN&amp;ll=50.8172448,-0.122510799999986';
const DICE_RVT_HREF = 'https://maps.google.com/?q=The%20Royal%20Vauxhall%20Tavern%2C%20372%20Kennington%20Ln%2C%20London%20SE11%205HY%2C%20UK&amp;ll=51.4863391,-0.1217784';
const DICE_HORIZON_HREF = 'https://maps.google.com/?q=Horizon%2C%20214%20King&#x27;s%20Road%2C%20Brighton%2C%20BN1%201NB%2C%20United%20Kingdom&amp;ll=50.819936,-0.140382';
const DICE_TBA_HREF = 'https://maps.google.com/?q=Venue%20TBA%2C%20London%2C%20London%2C%20UK&amp;ll=51.5073509,-0.1277583';
const DICE_PIER_HREF = 'https://maps.google.com/?q=Westminster%20Pier%2C%20Victoria%20Embankment%2C%20London%2C%20UK&amp;ll=51.5099822,-0.117819';
const diceHtml = (href) => `<div class="Venue"><a href="${href}" target="_blank" rel="noreferrer">Open in maps</a></div>`;

const MAPS_LINK_CURATED_BARS = {
  london: [
    { name: 'Royal Vauxhall Tavern', city: 'london', coordinates: '51.4863391, -0.1217784' },
    { name: 'Westminster Pier', city: 'london', coordinates: '51.5022544, -0.1231736' }
  ],
  brighton: [
    { name: 'Concorde 2', city: 'brighton', coordinates: '50.8172912, -0.1225875' },
    // Curated but coordinate-less — the only shape a maps-link pin could fill.
    { name: 'Horizon', city: 'brighton', address: '211-214 Kings Road Arches, Brighton BN1 1NB' }
  ]
};

function createMapsLinkParser() {
  const parser = createParser();
  parser.core = new SharedCore({}, { eventSchema: EventSchema, bars: MAPS_LINK_CURATED_BARS });
  return parser;
}

test('extractMapsLinkCoordinateCandidates reads ll= and the leading venue name from real Dice hrefs', () => {
  const parser = createMapsLinkParser();

  assert.deepEqual(parser.extractMapsLinkCoordinateCandidates(diceHtml(DICE_CONCORDE_HREF)).map(
    candidate => [candidate.venueName, candidate.location]),
    [['Concorde 2', '50.8172448,-0.122510799999986']]);

  assert.deepEqual(parser.extractMapsLinkCoordinateCandidates(diceHtml(DICE_RVT_HREF)).map(
    candidate => [candidate.venueName, candidate.location]),
    [['The Royal Vauxhall Tavern', '51.4863391,-0.1217784']]);

  // The '#' of a numeric entity inside the query is NOT a URL fragment —
  // stripping it as one truncated the link before the ll= (Horizon page).
  assert.deepEqual(parser.extractMapsLinkCoordinateCandidates(diceHtml(DICE_HORIZON_HREF)).map(
    candidate => [candidate.venueName, candidate.location]),
    [['Horizon', '50.819936,-0.140382']]);

  // One candidate per distinct pin+name, however many times the page links it.
  assert.equal(parser.extractMapsLinkCoordinateCandidates(
    diceHtml(DICE_RVT_HREF) + diceHtml(DICE_RVT_HREF)).length, 1);

  // Non-map links, map links without ll=, and unusable pins yield nothing.
  assert.deepEqual(parser.extractMapsLinkCoordinateCandidates(
    '<a href="https://dice.fm/event?ll=51.4863391,-0.1217784">x</a>'), []);
  assert.deepEqual(parser.extractMapsLinkCoordinateCandidates(
    '<a href="https://maps.google.com/?q=The+Eagle">x</a>'), []);
  assert.deepEqual(parser.extractMapsLinkCoordinateCandidates(
    '<a href="https://maps.google.com/?q=Nowhere&amp;ll=0,0">x</a>'), []);
  assert.deepEqual(parser.extractMapsLinkCoordinateCandidates(
    '<a href="https://maps.google.com/?q=Nowhere&amp;ll=91.5,-0.12">x</a>'), []);
  assert.deepEqual(parser.extractMapsLinkCoordinateCandidates(
    '<a href="https://maps.google.com/?q=Nowhere&amp;ll=not,coords">x</a>'), []);
});

test('maps-link coordinates: identity guard accepts the event bar, rejects placeholders and unrelated venues', () => {
  const parser = createMapsLinkParser();
  const html = diceHtml(DICE_RVT_HREF);

  // Same venue, casing/"The " tolerant (curated matching's own strictness).
  const matched = { title: 'BEEFMINCE x RVT', bar: 'Royal Vauxhall Tavern', city: 'london' };
  const matchedLogs = captureLogs(() => parser.logMapsLinkCoordinateCandidates([matched], { html }));
  assert.ok(matchedLogs.some(line => line.includes('identity guard PASSED')), JSON.stringify(matchedLogs));
  assert.equal(matched._mapsLinkCoordinate.location, '51.4863391,-0.1217784');

  // A page's unrelated map widget never pins an event.
  const unrelated = { title: 'Some other party', bar: 'Eagle London', city: 'london' };
  const unrelatedLogs = captureLogs(() => parser.logMapsLinkCoordinateCandidates([unrelated], { html }));
  assert.ok(unrelatedLogs.some(line => line.includes('identity guard REJECTED')), JSON.stringify(unrelatedLogs));
  assert.equal(unrelated._mapsLinkCoordinate, undefined);

  // An event with no bar has no identity to check against.
  const barless = { title: 'Some other party', city: 'london' };
  captureLogs(() => parser.logMapsLinkCoordinateCandidates([barless], { html }));
  assert.equal(barless._mapsLinkCoordinate, undefined);

  // "Venue TBA" is a city-centre placeholder, not a venue — rejected outright
  // even when the event's own bar says the same words.
  const tba = { title: 'SPOOKMINCE', bar: 'Venue TBA', city: 'london' };
  const tbaLogs = captureLogs(() => parser.logMapsLinkCoordinateCandidates([tba], { html: diceHtml(DICE_TBA_HREF) }));
  assert.ok(tbaLogs.some(line => line.includes('REJECTED (placeholder venue name "Venue TBA")')), JSON.stringify(tbaLogs));
  assert.equal(tba._mapsLinkCoordinate, undefined);

  assert.equal(parser.isPlaceholderVenueName('TBA'), true);
  assert.equal(parser.isPlaceholderVenueName('Venue TBC'), true);
  assert.equal(parser.isPlaceholderVenueName('Venue to be announced'), true);
  assert.equal(parser.isPlaceholderVenueName('Venue'), true);
  assert.equal(parser.isPlaceholderVenueName(''), true);
  assert.equal(parser.isPlaceholderVenueName('The Royal Vauxhall Tavern'), false);
  assert.equal(parser.isPlaceholderVenueName('Tabard Theatre'), false);
});

test('maps-link coordinates: the parser only stashes the candidate — it never writes location', () => {
  const parser = createMapsLinkParser();

  // Westminster Pier — Dice's pin is ~940 m off, onto a different pier. The
  // curated coordinate is reported as the winner and the event is untouched.
  const pier = { title: 'BOATMINCE', bar: 'Westminster Pier', city: 'london' };
  const pierLogs = captureLogs(() => parser.logMapsLinkCoordinateCandidates([pier], { html: diceHtml(DICE_PIER_HREF) }));
  assert.ok(pierLogs.some(line => line.includes('curated coordinate 51.5022544, -0.1231736 wins (candidate is 936 m away)')),
    JSON.stringify(pierLogs));
  assert.ok(pierLogs.some(line => line.includes('held as evidence only')), JSON.stringify(pierLogs));
  assert.equal(pier.location, undefined);

  // An event that already carries a location is never clobbered.
  const located = { title: 'BEEFMINCE x RVT', bar: 'Royal Vauxhall Tavern', city: 'london', location: '51.1,-0.1' };
  const locatedLogs = captureLogs(() => parser.logMapsLinkCoordinateCandidates([located], { html: diceHtml(DICE_RVT_HREF) }));
  assert.ok(locatedLogs.some(line => line.includes('event location already 51.1,-0.1')), JSON.stringify(locatedLogs));
  assert.equal(located.location, '51.1,-0.1');

  // Curated bar with NO coordinate, blank event location: the candidate is
  // held for the pin ladder, where the address geocode still outranks it.
  const horizon = { title: 'BEEFMINCE Brighton Pride', bar: 'Horizon', city: 'brighton' };
  const horizonLogs = captureLogs(() => parser.logMapsLinkCoordinateCandidates([horizon], { html: diceHtml(DICE_HORIZON_HREF) }));
  assert.ok(horizonLogs.some(line => line.includes('curated bar matched but carries no coordinate')
    && line.includes('held for the pin ladder')), JSON.stringify(horizonLogs));
  assert.equal(horizon.location, undefined);
  assert.equal(horizon._mapsLinkCoordinate.location, '50.819936,-0.140382');

  // Only the internal underscore stash is ever added by THIS pass — the pin
  // decision belongs to OpenStreetMapNormalizer.
  assert.deepEqual(Object.keys(horizon).filter(key => !key.startsWith('_')).sort(),
    ['bar', 'city', 'title']);
});

// ---------------------------------------------------------------------------
// Curated-coordinate venue resolution. Run 20260731-120505 shipped bar
// "Portland" for "The RETURN" and bar "Brooklyn" for "CHUNK BROOKLYN - The
// Return!" — city-shaped values that are not venues — while both events
// carried a page-published pin within 3 m of the curated bar that names the
// real venue, and the SAME run got both venues right on sibling events at the
// very same coordinates. Coordinates are verbatim from that run and from
// data/bars. The fixture mirrors the CLEANED corpus (#1598): one row per
// venue, so a resolvable pin has exactly one curated bar in range.
// ---------------------------------------------------------------------------
const VENUE_COORD_CURATED_BARS = {
  portland: [
    { name: 'Nova PDX', city: 'portland', address: '722 E Burnside, Portland', coordinates: '45.5228076, -122.6581521' },
    { name: 'Stag PDX', city: 'portland', coordinates: '45.5232000, -122.6752000' }
  ],
  nyc: [
    { name: "C'mon Everybody", city: 'nyc', address: '325 Franklin Avenue, New York', coordinates: '40.6882793, -73.9569264' }
  ],
  chicago: [
    // 17.7 m apart — the closest genuinely DIFFERENT pair in the corpus.
    { name: 'Jackhammer', city: 'chicago', coordinates: '41.9984139, -87.6710111' },
    { name: 'Touché', city: 'chicago', coordinates: '41.9985708, -87.670974' }
  ]
};

function createVenueCoordinateParser(bars = VENUE_COORD_CURATED_BARS) {
  const parser = createParser();
  parser.core = new SharedCore({}, { eventSchema: EventSchema, bars });
  return parser;
}

test('curated-coordinate venue resolution: one curated bar in range replaces a city-shaped value', () => {
  const parser = createVenueCoordinateParser();

  // Verbatim from run 20260731-120505.
  const portland = {
    title: 'The RETURN',
    bar: 'Portland',
    city: 'portland',
    address: '722 E Burnside St, Portland, OR 97214, USA',
    location: '45.52281000000001, -122.6581342'
  };
  const brooklyn = {
    title: 'CHUNK BROOKLYN - The Return!',
    bar: 'Brooklyn',
    city: 'nyc',
    address: '325 Franklin Ave, Brooklyn, NY 11238, USA',
    location: '40.68830519999999, -73.9569221'
  };
  // A bar the plausibility gate already dropped arrives with none at all.
  const dropped = { title: 'The RETURN', city: 'portland', location: '45.52281000000001, -122.6581342' };

  const logs = captureLogs(() => {
    parser.resolveBarFromCuratedCoordinates([portland, brooklyn, dropped], CITY_GATE_CONFIG);
  });

  assert.equal(portland.bar, 'Nova PDX', 'the pin sits on Nova PDX, not on a city called Portland');
  assert.equal(portland.barSource, 'curated');
  assert.equal(brooklyn.bar, "C'mon Everybody");
  assert.equal(brooklyn.barSource, 'curated');
  assert.equal(dropped.bar, 'Nova PDX', 'a blank bar is filled from the pin');

  assert.ok(
    logs.some(line => line.includes('🤖 AI Web: Resolved bar "Nova PDX" for "The RETURN" from curated coordinates')
      && line.includes('1 m from the event pin')
      && line.includes('replaces "Portland"')),
    `expected the additive resolution line naming venue + distance, got: ${JSON.stringify(logs)}`
  );
  assert.ok(
    logs.some(line => line.includes('🤖 AI Web: Resolved bar "C\'mon Everybody"') && line.includes('3 m from the event pin')),
    JSON.stringify(logs)
  );
});

test('curated-coordinate venue resolution: two DIFFERENT curated venues in range resolve nothing', () => {
  const parser = createVenueCoordinateParser();

  // Midpoint of Jackhammer and Touché — 9 m from each, both inside 12 m.
  const event = { title: 'Some Chicago Party', city: 'chicago', location: '41.99849235, -87.67099255' };
  const logs = captureLogs(() => parser.resolveBarFromCuratedCoordinates([event], CITY_GATE_CONFIG));

  assert.equal('bar' in event, false, 'ambiguous means no answer — never a guess');
  assert.ok(
    logs.some(line => line.includes('are ambiguous') && line.includes('Jackhammer') && line.includes('Touché')
      && line.includes('no venue resolved')),
    `expected the refusal line naming both venues, got: ${JSON.stringify(logs)}`
  );
});

test('curated-coordinate venue resolution: a real venue name is never overridden, and the pass fails closed', () => {
  const parser = createVenueCoordinateParser();

  const cases = [
    // Already the right venue at the very same pin.
    { title: 'Nova Box', bar: 'Nova PDX', city: 'portland', location: '45.52281000000001, -122.6581342' },
    // An uncurated venue sitting on a curated pin still keeps its own name.
    { title: 'Pop-up', bar: 'Some New Venue', city: 'nyc', location: '40.6882793, -73.9569264' },
    // No pin, no city, unknown city, pin nowhere near a curated bar.
    { title: 'No pin', bar: '', city: 'portland' },
    { title: 'No city', bar: '', location: '45.5228076, -122.6581521' },
    { title: 'Unknown city', bar: '', city: 'unknown', location: '45.5228076, -122.6581521' },
    { title: 'Far away', bar: '', city: 'portland', location: '45.5300000, -122.6581521' }
  ];
  const before = cases.map(event => event.bar);
  const logs = captureLogs(() => parser.resolveBarFromCuratedCoordinates(cases, CITY_GATE_CONFIG));

  cases.forEach((event, index) => {
    assert.equal(event.bar === undefined ? '' : event.bar, before[index] === undefined ? '' : before[index],
      `"${event.title}" must be untouched`);
    assert.equal(event.barSource, undefined, `"${event.title}" gains no provenance stamp`);
  });
  assert.equal(logs.length, 0, `nothing resolved → nothing logged, got: ${JSON.stringify(logs)}`);

  // No curated corpus at all → the pass cannot judge and must not act.
  const bare = createParser();
  const orphan = { title: 'The RETURN', bar: 'Portland', city: 'portland', location: '45.52281000000001, -122.6581342' };
  bare.resolveBarFromCuratedCoordinates([orphan], CITY_GATE_CONFIG);
  assert.equal(orphan.bar, 'Portland', 'no bars data → fail closed, change nothing');
});

// Defensive depth, not the primary path: the cleaned corpus (#1598) has no
// same-venue duplicates, but the promote/venue-queue path that adds new bars
// could reintroduce one, and a variant pair must not make resolution give up.
// This is also exactly the corpus state on main before #1598 lands.
const VENUE_COORD_DUPLICATED_BARS = {
  portland: [
    { name: 'Nova PDX', city: 'portland', coordinates: '45.5228076, -122.6581521' },
    // The venue's former name — same address, a second curated row.
    { name: 'Bossanova Ballroom', city: 'portland', coordinates: '45.5228076, -122.6581521' }
  ],
  sf: [
    { name: 'Public Works', city: 'sf', coordinates: '37.7688931, -122.4192651' },
    { name: 'The Public Works SF', city: 'sf', coordinates: '37.7688931, -122.4192651' }
  ]
};

test('curated-coordinate venue resolution: a duplicated curated venue still resolves (defensive depth)', () => {
  const parser = createVenueCoordinateParser(VENUE_COORD_DUPLICATED_BARS);

  // Recognizable name variants of ONE venue: the nearest wins rather than the
  // pass refusing.
  const sf = { title: 'Some SF party', city: 'sf', location: '37.7688931, -122.4192651' };
  const sfLogs = captureLogs(() => parser.resolveBarFromCuratedCoordinates([sf], CITY_GATE_CONFIG));
  assert.equal(sf.bar, 'Public Works');
  assert.ok(sfLogs.some(line => line.includes('curated name variants for the same venue')), JSON.stringify(sfLogs));

  // Two rows whose names share nothing ("Nova PDX" / "Bossanova Ballroom"):
  // the event's own text names exactly one of them, so that one wins.
  const named = {
    title: 'The RETURN', bar: 'Portland', city: 'portland',
    location: '45.52281000000001, -122.6581342',
    description: 'CHUNK PDX Presents ... Saturday March 14th // NOVA PDX // 722 E Burnside St // 9pm - close'
  };
  const namedLogs = captureLogs(() => parser.resolveBarFromCuratedCoordinates([named], CITY_GATE_CONFIG));
  assert.equal(named.bar, 'Nova PDX');
  assert.ok(namedLogs.some(line => line.includes('the only one of 2 curated bars in range the event text names')),
    JSON.stringify(namedLogs));

  // Same two rows, and the page text names NEITHER: fail closed.
  const silent = { title: 'Untitled PDX party', city: 'portland', location: '45.52281000000001, -122.6581342' };
  parser.resolveBarFromCuratedCoordinates([silent], CITY_GATE_CONFIG);
  assert.equal('bar' in silent, false, 'unnameable duplicates resolve nothing rather than guess');
});

test('curated bar name variants: duplicate rows for one venue unify, different neighbours never do', () => {
  const parser = createVenueCoordinateParser();
  const same = [
    ['Public Works', 'The Public Works SF'],
    ['F8 Nightclub & Bar', 'F8 NIGHTCLUB'],
    ['Precinct LA', 'Precinct DTLA'],
    ['SF Eagle', 'San Francisco Eagle Bar'],
    ['Joy Theater', 'Joy Theatre'],
    ['EAGLE TOKYO', 'EAGLE TOKYO BLUE']
  ];
  for (const [a, b] of same) {
    assert.equal(parser.curatedBarNamesAreVariants(a, b), true, `"${a}" / "${b}" are one venue`);
  }
  const different = [
    ['Jackhammer', 'Touché'],
    ['Gym Sports Bar', 'The Pub'],
    ['Powerhouse', 'Hole in the Wall Saloon'],
    ['FLEX', 'Atlas Social Club'],
    ['Diesel', 'Madison Pub'],
    // Generic venue-type words are never the shared word that unifies two names.
    ['Atlas Social Club', 'Berlin Club'],
    ['The Pub', 'The Tavern']
  ];
  for (const [a, b] of different) {
    assert.equal(parser.curatedBarNamesAreVariants(a, b), false, `"${a}" / "${b}" are different places`);
  }
  assert.equal(parser.curatedBarNamesAreVariants('', 'Nova PDX'), false);
});

test('structured-data path: resolution gets first refusal, then the bar gate drops what it could not rescue', () => {
  const parser = createVenueCoordinateParser();
  // The exact ordering the structured-data fast path runs.
  const pass = (events) => {
    parser.resolveBarFromCuratedCoordinates(events, CITY_GATE_CONFIG);
    events.forEach(event => parser.applyBarPlausibilityGate(event, CITY_GATE_CONFIG));
    return events;
  };

  // 1. Resolvable city-shaped bar → replaced with the curated venue, and the
  //    gate then has a real venue name to leave alone.
  const resolvable = { title: 'The RETURN', bar: 'Portland', city: 'portland', location: '45.52281000000001, -122.6581342' };
  // 2. Unresolvable city-shaped bar (pin nowhere near a curated venue) →
  //    dropped by the gate rather than left as a borough.
  const unresolvable = { title: 'CHUNK BROOKLYN', bar: 'Brooklyn', city: 'nyc', location: '40.75, -73.99' };
  // 3. Unresolvable city-shaped bar with no pin at all → dropped.
  const noPin = { title: 'CHUNK PDX', bar: 'Portland', city: 'portland' };
  // 4. Ambiguous coordinates → refuse to resolve, then the gate drops the city.
  const ambiguous = { title: 'Chicago thing', bar: 'Chicago', city: 'chicago', location: '41.99849235, -87.67099255' };
  // 5. Legitimate venue names → untouched in every case.
  const curatedVenue = { title: 'Nova Box', bar: 'Nova PDX', city: 'portland', location: '45.52281000000001, -122.6581342' };
  const uncuratedVenue = { title: 'Pop-up', bar: 'Some New Venue', city: 'nyc', location: '40.6882793, -73.9569264' };
  const placeNamed = { title: 'Bowl night', bar: 'Brooklyn Bowl', city: 'nyc', location: '40.75, -73.99' };

  const logs = captureLogs(() => pass([resolvable, unresolvable, noPin, ambiguous, curatedVenue, uncuratedVenue, placeNamed]));

  assert.equal(resolvable.bar, 'Nova PDX', 'resolution runs first and wins');
  assert.equal('bar' in unresolvable, false, 'an unrescuable borough is dropped, not shipped');
  assert.equal('bar' in noPin, false, 'no pin to rescue with → the gate still drops the city');
  assert.equal('bar' in ambiguous, false, 'refuse to resolve, then drop');
  assert.equal(curatedVenue.bar, 'Nova PDX');
  assert.equal(uncuratedVenue.bar, 'Some New Venue');
  assert.equal(placeNamed.bar, 'Brooklyn Bowl', 'whole-value equality only — a place-named venue survives');

  // The gate's existing drop log is unchanged and still fires on this path.
  assert.ok(logs.some(line => line === '🤖 AI Web: Dropped implausible bar "Brooklyn" (city name — resolves to city "nyc")'),
    `expected the unchanged gate drop line, got: ${JSON.stringify(logs)}`);
  assert.ok(logs.some(line => line.includes('Dropped implausible bar "Chicago"')), JSON.stringify(logs));
  // The rescued event is never dropped — resolution ran before the gate.
  assert.ok(!logs.some(line => line.includes('Dropped implausible bar "Portland"') && line.includes('The RETURN')),
    JSON.stringify(logs));
});

test('bar plausibility gate: a curated venue name for the event city outranks the shape heuristics', () => {
  // Both names are real curated venues that the shape tests misread: "9th
  // Avenue Saloon" contains "Avenue", "440 Castro" is a number + one bare
  // word. The gate now runs on the structured-data path too, so a false
  // positive here would silently delete a correct venue.
  const parser = createParser();
  parser.core = new SharedCore({}, {
    eventSchema: EventSchema,
    bars: {
      nyc: [{ name: '9th Avenue Saloon', city: 'nyc' }],
      sf: [{ name: '440 Castro', city: 'sf' }]
    }
  });
  assert.equal(parser.isAddressShapedBarValue('9th Avenue Saloon'), true, 'the heuristic does misread it');
  assert.equal(parser.isAddressShapedBarValue('440 Castro'), true, 'the heuristic does misread it');

  const saloon = { title: 'x', bar: '9th Avenue Saloon', city: 'nyc' };
  const logs = captureLogs(() => parser.applyBarPlausibilityGate(saloon, CITY_GATE_CONFIG));
  assert.equal(saloon.bar, '9th Avenue Saloon', 'curated data outranks the derived shape guess');
  assert.ok(logs.some(line => line.includes('Kept bar "9th Avenue Saloon" despite reading as address-shaped')),
    JSON.stringify(logs));

  const castro = { title: 'x', bar: '440 Castro', city: 'sf' };
  parser.applyBarPlausibilityGate(castro, CITY_GATE_CONFIG);
  assert.equal(castro.bar, '440 Castro');

  // The exemption is city-scoped and full-name only: it never rescues a value
  // this city does not curate, and it cannot resurrect a city-shaped bar.
  const wrongCity = { title: 'x', bar: '440 Castro', city: 'nyc' };
  parser.applyBarPlausibilityGate(wrongCity, CITY_GATE_CONFIG);
  assert.equal('bar' in wrongCity, false, 'another city curating the name is no excuse');

  const uncurated = { title: 'x', bar: '79 WARRENTON', city: 'nyc' };
  parser.applyBarPlausibilityGate(uncurated, CITY_GATE_CONFIG);
  assert.equal('bar' in uncurated, false, 'an uncurated address-shaped bar still drops');

  const borough = { title: 'x', bar: 'Brooklyn', city: 'nyc' };
  parser.applyBarPlausibilityGate(borough, CITY_GATE_CONFIG);
  assert.equal('bar' in borough, false, 'no curated bar is named after a city — the gate still fires');
});

// ---------------------------------------------------------------------------
// Redundant title dates. "Stripped redundant date from title" appears ZERO
// times in every run log on record, because JSON-LD events skip
// normalizeAiEvent and only the LEADING-phrase strip was copied to that route
// — so chunk-party.com shipped "CHUNK DORE ALLEY - Saturday July 25th" to the
// calendar on every run. Day-first dates ("Wednesday 9th September – …", the
// Sitges listings) were invisible to the detector in BOTH routes.
// ---------------------------------------------------------------------------
test('stripRedundantTitleDate removes a printed date that matches the event start', () => {
  const parser = createParser();
  assert.equal(
    parser.stripRedundantTitleDate('CHUNK DORE ALLEY - Saturday July 25th', ['2026-07-25T22:00:00-07:00']),
    'CHUNK DORE ALLEY');
  assert.equal(
    parser.stripRedundantTitleDate('CHUNK Chicago - September 19th', ['2026-09-19T21:00:00-05:00']),
    'CHUNK Chicago');
  // Whitespace-attached trailing date — no separator at all.
  assert.equal(
    parser.stripRedundantTitleDate('CHUNK Brooklyn 7/4', ['2026-07-04T22:00:00-04:00']),
    'CHUNK Brooklyn');
  // Day-first, the Sitges shape.
  assert.equal(
    parser.stripRedundantTitleDate('Wednesday 9th September – BEEFMINCE MEET MARKET', ['2026-09-09T21:00:00Z']),
    'BEEFMINCE MEET MARKET');
});

test('stripRedundantTitleDate keeps the title when the date is unverified or disagrees', () => {
  const parser = createParser();
  // Printed date contradicts startDate — a signal, not noise. Kept for review.
  assert.equal(
    parser.stripRedundantTitleDate('CHUNK DORE ALLEY - Saturday July 25th', ['2026-08-01T22:00:00-07:00']),
    'CHUNK DORE ALLEY - Saturday July 25th');
  // No usable date to verify against — never strip on a guess.
  assert.equal(
    parser.stripRedundantTitleDate('CHUNK DORE ALLEY - Saturday July 25th', [undefined, null, '']),
    'CHUNK DORE ALLEY - Saturday July 25th');
  assert.equal(parser.stripRedundantTitleDate('', ['2026-07-25T22:00:00-07:00']), '');
});

test('structured-data events get the redundant-date strip, not just the leading one', () => {
  const parser = createParser();
  // The JSON-LD route is the one that ships CHUNK's dated titles; before this
  // it only ever ran stripLeadingDatePhraseFromTitle.
  const html = jsonLdEventPage(jsonLdEventNode('CHUNK DORE ALLEY - Saturday July 25th'));
  const events = parser.parseEvents({ html, url: 'https://www.chunk-party.com/event-details/chunk-dore-alley' }, {});
  const titles = (Array.isArray(events) ? events : []).map(event => event && event.title);
  assert.ok(
    titles.includes('CHUNK DORE ALLEY') || titles.every(title => !/July 25th/.test(String(title))),
    `no JSON-LD title should reach the calendar dated: ${JSON.stringify(titles)}`
  );
});

// ---------------------------------------------------------------------------
// Merge-churn / bad-bar-rescue fix (run 20260801-172321: Club Chub shipped
// bar="DURO" — the party's own name — on signals page+ocr+url, all three the
// same fact reprinted three times). Three enforced guards:
//   1. domain shape and minimum identity length reject a candidate outright;
//   2. the "matches event title" guard survives the parser's OWN brand-prefix
//      rewrite via _titleBeforeBrandPrefix;
//   3. the brand prefixer refuses to stamp the site brand over a DIFFERENT
//      curated promoter's party.
// ---------------------------------------------------------------------------

const DURO_CITY_CONFIG = {
  cities: {
    'los angeles': { name: 'Los Angeles', patterns: ['los angeles', 'dtla', 'downtown la'], timezone: 'America/Los_Angeles' }
  }
};

// The real clubchubusa.com segment shape (page text + flyer OCR).
const DURO_SEGMENT = [
  'DURO',
  'Aug 01, 2026, 10:00 PM',
  'Downtown Los Angeles',
  'Tickets'
].join('\n');
const DURO_OCR = 'MEGAWOOF AMERICA\nPRESENTS\nDURO\nNO LIMITS.\nDOWNTOWN LA';

function duroHtmlData(overrides = {}) {
  return {
    url: 'https://www.clubchubusa.com/event-list',
    html: 'SEGMENT_LINK_URL: https://www.eventbrite.com/e/duro-is-back-new-outdoor-location-night-foam-party-tickets-1991255145744',
    segmentText: DURO_SEGMENT,
    ocrResults: [{ url: 'https://static.wixstatic.com/media/flyer.jpg', text: DURO_OCR }],
    ...overrides
  };
}

test('bar rescue: the party name equal to the PRE-PREFIX title is rejected (the real DURO case)', () => {
  const parser = createRescueParser({});
  // Exactly what run 20260801 produced: the brand prefixer rewrote the title
  // 16ms before the rescue ran, so plain event.title equality no longer
  // matched "DURO" and the party name was adopted as the venue.
  const event = {
    title: 'CLUB CHUB: DURO',
    _titleBeforeBrandPrefix: 'DURO',
    city: 'los angeles'
  };
  parser.applyBarConvergenceRescue(event, duroHtmlData(), { name: 'Club Chub' }, DURO_CITY_CONFIG);
  assert.ok(!event.bar, `party name must not become the bar, got ${JSON.stringify(event.bar)}`);

  // And the guard is the pre-prefix title specifically: without the stamp the
  // old (broken) behavior is reproduced, which is what makes the fix load-bearing.
  assert.equal(
    parser.getVenueLineCandidateRejection('DURO', event, duroHtmlData(), DURO_CITY_CONFIG, null),
    'matches event title'
  );
  assert.equal(
    parser.getVenueLineCandidateRejection('DURO', { title: 'CLUB CHUB: DURO', city: 'los angeles' }, duroHtmlData(), DURO_CITY_CONFIG, null),
    '', 'without the pre-prefix stamp the guard cannot fire — this is the bug'
  );
});

test('bar rescue candidate guards: length and domain shape reject the known garbage, curated names survive', () => {
  const parser = createRescueParser({});
  const event = { title: 'Some Party', city: 'boston' };
  const reject = (candidate) => parser.getVenueLineCandidateRejection(candidate, event, rescueHtmlData(), RESCUE_CITY_CONFIG, null);

  // Rescued garbage from the logs.
  assert.equal(reject('Y'), 'too short');
  assert.equal(reject('X'), 'too short');
  assert.equal(reject('CHUNK-PARTY.COM'), 'domain');
  assert.equal(reject('chunk-party.com'), 'domain');
  assert.equal(reject('www.example.org'), 'url');

  // Real short venue names survive — the length test is on the bar-name KEY,
  // not the raw string, so punctuation and spaces never cost a name its life.
  assert.equal(reject('X BAR'), '');
  assert.equal(reject("Ty's"), '');
  assert.equal(reject('The Pub'), '');
  // The curated dotted names the plausibility gate deliberately whitelists.
  assert.equal(reject('massive.club'), '');
  assert.equal(reject('BARBER.BAR'), '');
  assert.equal(reject('BEEF.BKK'), '');
});

test('bar rescue: the FURBALL/Legacy rescues still fire, and a curated-less adoption is flagged (report-only)', () => {
  // Curated + page + ocr — unchanged.
  const curated = createRescueParser(BOSTON_CURATED_BARS);
  const curatedEvent = { title: 'FURBALL Boston: Bear Week Return', city: 'boston' };
  const curatedLogs = captureLogs(() => {
    curated.applyBarConvergenceRescue(curatedEvent, rescueHtmlData(), {}, RESCUE_CITY_CONFIG);
  });
  assert.equal(curatedEvent.bar, 'Legacy');
  assert.ok(!curatedLogs.some(line => line.includes('no curated corroboration')),
    'a curated-corroborated rescue is never flagged');

  // page + ocr with no curated corpus — STILL ADOPTED (report-only), plus a flag.
  const uncurated = createRescueParser({});
  const uncuratedEvent = { title: 'FURBALL Boston: Bear Week Return', city: 'boston' };
  const uncuratedLogs = captureLogs(() => {
    uncurated.applyBarConvergenceRescue(uncuratedEvent, rescueHtmlData(), {}, RESCUE_CITY_CONFIG);
  });
  assert.equal(uncuratedEvent.bar, 'Legacy', 'behavior unchanged — report-only');
  assert.ok(uncuratedLogs.includes(
    '🤖 AI Web: Bar rescue "Legacy" has no curated corroboration (signals: page, ocr) — adopted, verify manually'
  ), `corroboration flag expected, got: ${JSON.stringify(uncuratedLogs)}`);
  assert.ok(uncuratedLogs.includes(
    '🤖 AI Web: Rescued bar "Legacy" via signal convergence (signals: page, ocr)'
  ), 'the existing adoption log line is byte-identical');

  // "Massive" — the ONE correct value this mechanism ever rescued across all
  // logs, and the only one that carried a curated signal. It still fires.
  const massive = createRescueParser({ seattle: [{ name: 'Massive', city: 'seattle', address: '1605 Boylston Ave, Seattle, WA' }] });
  const massiveEvent = { title: 'BEARRACUDA: Seattle', city: 'seattle' };
  massive.applyBarConvergenceRescue(
    massiveEvent,
    rescueHtmlData({ segmentText: 'BEARRACUDA Seattle\nMassive\n1605 Boylston Ave', ocrResults: [{ url: 'https://x/f.jpg', text: 'MASSIVE' }] }),
    {},
    { cities: { seattle: { name: 'Seattle', patterns: ['seattle'], timezone: 'America/Los_Angeles' } } }
  );
  assert.equal(massiveEvent.bar, 'Massive', 'the one good rescue in the whole log corpus still works');
  assert.equal(massiveEvent.barSource, 'curated');
});

test('brand prefixer: suppressed when the page evidence names ANOTHER curated promoter', () => {
  const parser = createChunkParser();
  parser.core.promoters = [{ name: 'CHUNK' }, { name: 'Megawoof America', aliases: ['MEGAWOOF'] }];
  const brands = parser.getPageBrandNames(CHUNK_PAGE());

  // The real DURO evidence string, verbatim from the log.
  const logs = captureLogs(() => {
    assert.equal(
      parser.buildBrandPrefixedTitle('DURO', brands, CHUNK_PAGE(), CHUNK_CONFIG, 'MEGAWOOF AMERICA\nPRESENTS\nDURO'),
      '', 'another promoter owns this party — the site brand is not stamped on it'
    );
  });
  assert.ok(logs.some(line => line.includes('page evidence names another curated promoter')),
    `suppression log expected, got: ${JSON.stringify(logs)}`);

  // OCR is the second corpus, same outcome.
  const ocrPage = { ...CHUNK_PAGE(), ocrResults: [{ url: 'https://x/flyer.jpg', text: 'MEGAWOOF AMERICA\nPRESENTS\nDURO' }] };
  assert.equal(parser.buildBrandPrefixedTitle('DURO', brands, ocrPage, CHUNK_CONFIG), '');

  // Positive verification only: an unrecognized string never suppresses, and
  // evidence naming the PAGE's own brand never suppresses either.
  assert.equal(
    parser.buildBrandPrefixedTitle('The RETURN', brands, CHUNK_PAGE(), CHUNK_CONFIG, 'SOME RANDOM HYPE LINE\nPRESENTS\nThe RETURN'),
    'CHUNK: The RETURN');
  assert.equal(
    parser.buildBrandPrefixedTitle('The RETURN', brands, CHUNK_PAGE(), CHUNK_CONFIG, 'CHUNK\nPRESENTS\nThe RETURN'),
    'CHUNK: The RETURN');
  // …and with no evidence at all the prefixer behaves exactly as before.
  assert.equal(parser.buildBrandPrefixedTitle('The RETURN', brands, CHUNK_PAGE(), CHUNK_CONFIG), 'CHUNK: The RETURN');
});

// ---------------------------------------------------------------------------
// 2026-08-02 run-review wave: eight mechanical defects from the day's runs.
// ---------------------------------------------------------------------------

// Fix 1 — title date-strip compared against UTC and never fired for
// US-evening events (run 20260802-093810: all five "does not match
// startDate" lines were exactly +1 day).
test('stripRedundantTitleDate prefers raw string candidates over Date objects', () => {
  const parser = createParser();
  // The real DORE ALLEY case: a Jul 25 10PM PDT start is Jul 26 in UTC. The
  // raw JSON-LD string carries the local date and must win even when a Date
  // candidate comes first.
  const utcInstant = new Date('2026-07-26T05:00:00.000Z');
  assert.equal(
    parser.stripRedundantTitleDate('CHUNK DORE ALLEY - Saturday July 25th',
      [utcInstant, '2026-07-25T22:00:00-07:00']),
    'CHUNK DORE ALLEY');
});

test('stripRedundantTitleDate accepts the one-day UTC rollover when only a Date is available', () => {
  const parser = createParser();
  const utcInstant = new Date('2026-07-26T05:00:00.000Z'); // Jul 25, 10PM PDT
  // Title prints the LOCAL date — exactly one day before the UTC date.
  assert.equal(
    parser.stripRedundantTitleDate('CHUNK DORE ALLEY - Saturday July 25th', [utcInstant]),
    'CHUNK DORE ALLEY');
  // Two days off is a genuine mismatch — kept for review.
  assert.equal(
    parser.stripRedundantTitleDate('CHUNK DORE ALLEY - Saturday July 24th', [utcInstant]),
    'CHUNK DORE ALLEY - Saturday July 24th');
  // A day AFTER the UTC date is not a rollover shape either.
  assert.equal(
    parser.stripRedundantTitleDate('CHUNK DORE ALLEY - Saturday July 27th', [utcInstant]),
    'CHUNK DORE ALLEY - Saturday July 27th');
  // Year-end rollover: Jan 1 UTC instant, title prints Dec 31 of the PRIOR year.
  assert.equal(
    parser.stripRedundantTitleDate('NYE BLOWOUT - December 31st 2026', [new Date('2027-01-01T06:00:00.000Z')]),
    'NYE BLOWOUT');
  // A conflicting explicit year blocks the rollover acceptance.
  assert.equal(
    parser.stripRedundantTitleDate('CHUNK DORE ALLEY - July 25th 2025', [utcInstant]),
    'CHUNK DORE ALLEY - July 25th 2025');
  // Raw strings never get the rollover allowance — they already carry the
  // local date, so one-day-off IS a mismatch there.
  assert.equal(
    parser.stripRedundantTitleDate('CHUNK DORE ALLEY - Saturday July 25th', ['2026-07-26T05:00:00Z']),
    'CHUNK DORE ALLEY - Saturday July 25th');
});

test('buildEventFromJsonLdNode keeps the raw startDate string for the title strip', () => {
  const parser = createParser();
  const event = parser.buildEventFromJsonLdNode({
    '@type': 'Event',
    name: 'CHUNK DORE ALLEY - Saturday July 25th',
    startDate: '2026-07-25T22:00:00-07:00',
    location: { '@type': 'Place', name: 'Powerhouse', address: '1347 Folsom St, San Francisco, CA' }
  }, 'https://www.chunk-party.com/event-details/chunk-dore-alley');
  assert.ok(event, 'node builds an event');
  assert.equal(event._startDateRawText, '2026-07-25T22:00:00-07:00');
  // …and with the raw string leading the candidates the strip fires.
  assert.equal(
    parser.stripRedundantTitleDate(event.title, [event._startDateRawText, event.startDate, event.start]),
    'CHUNK DORE ALLEY');
});

// Fix 2 — evidence gate accepted a fabricated placeholder date whose evidence
// was a schedule, not a date (run 20260802-100813: BLOWPOP startDate
// "2026-01-01", evidence "Every Thursday" → phantom 2027 NYE event).
test('evidenceHasConcreteDateSignal separates schedule words from real dates', () => {
  const parser = createParser();
  assert.equal(parser.evidenceHasConcreteDateSignal('Every Thursday'), false);
  assert.equal(parser.evidenceHasConcreteDateSignal('WEDNESDAYS 8:30-MIDNIGHT'), false);
  assert.equal(parser.evidenceHasConcreteDateSignal('Saturdays 10PM'), false);
  assert.equal(parser.evidenceHasConcreteDateSignal('Thursday, August 6, 2026'), true);
  assert.equal(parser.evidenceHasConcreteDateSignal('Saturday July 25th'), true);
  assert.equal(parser.evidenceHasConcreteDateSignal('5/23'), true);
  assert.equal(parser.evidenceHasConcreteDateSignal('2026-01-01'), true);
  assert.equal(parser.evidenceHasConcreteDateSignal(''), false);
});

test('a date value with schedule-only evidence is dropped even when the value appears in the corpus', () => {
  const parser = createParser();
  const source = 'BLOWPOP Every Thursday at Massive free party 2026-01-01';
  const evidenceContext = parser.buildAiEvidenceContextFromText(source);
  const validationContext = { imageEvidenceUrls: new Set() };

  const result = parser.validateAiEventEvidence(
    {
      startDate: '2026-01-01',
      __fieldEvidence: { startDate: 'Every Thursday' }
    },
    { html: source }, {}, null,
    { evidenceContext, validationContext }
  );
  assert.equal(result.event.startDate, undefined, 'weekday-only evidence cannot corroborate a Y-M-D');
  assert.ok(result.report.dropped.some(entry => entry.key === 'startDate' && entry.reason === 'dateless-cited-evidence'),
    `dateless-cited-evidence drop expected, got: ${JSON.stringify(result.report.dropped)}`);

  // Date-shaped evidence keeps working exactly as before.
  const legit = parser.validateAiEventEvidence(
    {
      startDate: '2026-08-06',
      __fieldEvidence: { startDate: 'Thursday, August 6, 2026' }
    },
    { html: 'DRAG BINGO Thursday, August 6, 2026 doors 7pm' }, {}, null,
    {
      evidenceContext: parser.buildAiEvidenceContextFromText('DRAG BINGO Thursday, August 6, 2026 doors 7pm'),
      validationContext: { imageEvidenceUrls: new Set() }
    }
  );
  assert.equal(legit.event.startDate, '2026-08-06', 'a real cited date still passes');
});

test('weekday-pinned dates are exempt from the dateless-evidence drop', () => {
  const parser = createParser();
  const source = 'MEGAWOOF 2026-08-22 SATURDAY';
  const build = (weekdayPinnedYears) => parser.validateAiEventEvidence(
    {
      startDate: '2026-08-22',
      __fieldEvidence: { startDate: 'Saturday' },
      ...(weekdayPinnedYears ? { __weekdayPinnedYears: weekdayPinnedYears } : {})
    },
    { html: source }, {}, null,
    {
      evidenceContext: parser.buildAiEvidenceContextFromText(source),
      validationContext: { imageEvidenceUrls: new Set() }
    }
  );
  // Pinned: the deterministic repair vetted the date — kept.
  assert.equal(build({ start: true }).event.startDate, '2026-08-22');
  // Not pinned: weekday-only evidence is dropped.
  assert.equal(build(null).event.startDate, undefined);
});

// Fix 3 — time strings shipped as event titles (run 20260802-102127: final
// event titled "6:30 PM"; SEGMENT_LISTING_TITLE emitted "6:30 PM 18:30").
test('isTimeOnlyLineText recognizes dual-format time lines and nothing else', () => {
  const parser = createParser();
  assert.equal(parser.isTimeOnlyLineText('6:30 PM 18:30'), true);
  assert.equal(parser.isTimeOnlyLineText('7:00 PM 19:00'), true);
  assert.equal(parser.isTimeOnlyLineText('6:30 PM'), true);
  assert.equal(parser.isTimeOnlyLineText('10PM - 2AM'), true);
  assert.equal(parser.isTimeOnlyLineText('21h a 03h'), true);
  assert.equal(parser.isTimeOnlyLineText("SUGAR, WE'RE HOEIN DOWN"), false);
  assert.equal(parser.isTimeOnlyLineText('Party at 10'), false);
  assert.equal(parser.isTimeOnlyLineText('24'), false, 'a bare number is not a time');
  assert.equal(parser.isTimeOnlyLineText(''), false);
});

test('deriveSegmentListingTitle never emits a dual-format time node as the listing title', () => {
  const parser = createParser();
  // The real 3dollarbillbk.com/rsvp segment shape: the time node precedes the name.
  assert.equal(
    parser.deriveSegmentListingTitle({ lines: ['6:30 PM 18:30', "SUGAR, WE'RE HOEIN DOWN"] }),
    "SUGAR, WE'RE HOEIN DOWN");
  assert.equal(
    parser.deriveSegmentListingTitle({ lines: ['7:00 PM 19:00'] }),
    '');
});

test('normalizeAiEvent treats a time-only title as missing', () => {
  const parser = createParser();
  // The real extraction shape from run 20260802-102127: title "6:30 PM",
  // real name buried in the description. No usable title → the event fails
  // normalization (and the missing-title retry paths take over) instead of a
  // time reaching the calendar as a name.
  const timeOnly = parser.normalizeAiEvent({
    title: '6:30 PM',
    description: "SUGAR, WE'RE HOEIN DOWN",
    startDate: '2026-08-11',
    startTime: '18:30'
  }, {}, null, null, null);
  assert.equal(timeOnly, null, 'a time is not a title; the title must fail');

  // A non-time sibling candidate is promoted instead.
  const promoted = parser.normalizeAiEvent({
    title: '6:30 PM',
    name: 'HOEDOWN',
    startDate: '2026-08-11',
    startTime: '18:30'
  }, {}, null, null, null);
  assert.ok(promoted, 'event should normalize via the next candidate');
  assert.equal(promoted.title, 'HOEDOWN');
});

// Fix 4 — "DOWNTOWN LA" evaded the city-shaped-bar check (run
// 20260802-094341: "Downtown Los Angeles" dropped at :112, sibling
// bar="DOWNTOWN LA" survived at :984).
test('city-shaped bar check catches DOWNTOWN LA via the generated cities config', () => {
  const parser = createParser();
  const cities = require('../scraper-cities');
  assert.match(
    parser.getCityShapedBarRejection('DOWNTOWN LA', {}, cities),
    /resolves to city "la"/);
  assert.match(
    parser.getCityShapedBarRejection('Downtown Los Angeles', {}, cities),
    /resolves to city "la"/);
  // A real venue with a number stays a venue.
  assert.equal(parser.getCityShapedBarRejection('Studio 54', {}, cities), '');
});

// Fix 5 — crawl blocklist: bot-walled tixr, infrastructure hosts, and
// eventbrite's /e/_next/ image proxy.
test('discovery blocks bot-walled and infrastructure hosts without touching maps handling', () => {
  const parser = createParser();
  const sourceUrl = 'https://beefmince.com/venues';
  const blocked = [
    'https://tixr.com/e/201239',
    'https://www.tixr.com/groups/queernationtx/events/x-201262',
    'https://www.google.com',
    'https://maps.googleapis.com',
    'https://content-autofill.googleapis.com',
    'https://maps.gstatic.com/x',
    'https://scontent-lga3-1.cdninstagram.com/v/photo.jpg?x=1',
    'https://github.com/wix/yoshi/issues/2689',
    'https://www.example.com',
    'https://www.eventbrite.com/e/_next/image?url=https%3A%2F%2Fimg.evbuc.com%2Fx&w=940&q=75'
  ];
  for (const url of blocked) {
    const verdict = parser.validateEventUrl(url, sourceUrl, {});
    assert.equal(verdict.valid, false, `${url} must be blocked (got ${JSON.stringify(verdict)})`);
  }
  // Google MAPS urls keep their dedicated rejection reason — the signal the
  // address-harvest machinery relies on is untouched.
  assert.equal(parser.validateEventUrl('https://maps.google.com/?q=525+S+Riverfront', sourceUrl, {}).reason, 'google-maps-url');
  assert.equal(parser.validateEventUrl('https://www.google.com/maps/place/somewhere', sourceUrl, {}).reason, 'google-maps-url');
  // Real event pages still crawl.
  assert.equal(parser.validateEventUrl('https://dice.fm/event/abc123-beefmince', sourceUrl, {}).valid, true);
  assert.equal(parser.validateEventUrl('https://www.eventbrite.com/e/bear-night-tickets-123', sourceUrl, {}).valid, true);
});

// Fix 7 (parser half) — cached misclassification self-heal.
test('reclassifyZeroYieldMultiEventPage invalidates and re-classifies only cache-hit pages', async () => {
  const parser = createParser();
  const calls = { invalidated: [], classified: [] };
  parser.core = {
    getResolvedFieldPriorities: () => ({}),
    resolveAiConfig: (rawAi) => rawAi || {},
    wasAiClassificationCacheHit: (url) => url === 'https://cached.example/events',
    invalidateAiClassificationCacheEntry: async (url) => { calls.invalidated.push(url); return true; },
    classifyPageWithAi: async (url) => {
      calls.classified.push(url);
      return { classification: 'event-page', confidence: 90, reason: 'single event' };
    }
  };

  // Not a cache hit → no invalidation, no re-classify.
  assert.equal(
    await parser.reclassifyZeroYieldMultiEventPage('https://fresh.example/events', '<html>x</html>', {}, {}),
    null);
  assert.deepEqual(calls.invalidated, []);

  // Cache hit → invalidate, re-classify, return the fresh verdict.
  assert.equal(
    await parser.reclassifyZeroYieldMultiEventPage('https://cached.example/events', '<html>x</html>', {}, {}),
    'event-page');
  assert.deepEqual(calls.invalidated, ['https://cached.example/events']);
  assert.deepEqual(calls.classified, ['https://cached.example/events']);
});

test('zero-segment multi-event pages stamp the self-heal marker on htmlData', async () => {
  const parser = createParser();
  const htmlData = { html: '<html><body>nothing datelike here</body></html>', url: 'https://cached.example/events' };
  const events = await parser.extractEventsFromMultiEventPage(htmlData, { discoveryOnly: true }, null, [], [], null);
  assert.deepEqual(events, []);
  assert.equal(htmlData._multiEventZeroSegments, true);
});

// Fix 8 — dice.fm __NEXT_DATA__ never parsed: the old whole-element pattern
// made the JSON scan start AFTER </script> (16 identical SyntaxError WARNs
// per BEEFMINCE run, 20260802-093526).
test('extractUrlsFromNextData harvests the JSON body even with following script tags', () => {
  const parser = createParser();
  const nextData = {
    props: {
      pageProps: {
        events: [
          { name: 'BEEFMINCE XL', start_date: '2026-08-08T21:00:00Z', url: 'https://dice.fm/event/abc123-beefmince-xl' },
          { name: 'BEEFMINCE MEET MARKET', start_date: '2026-09-09T21:00:00Z', url: 'https://dice.fm/event/def456-meet-market' }
        ]
      }
    }
  };
  // The classic lazy-regex trap: the __NEXT_DATA__ tag is followed by MORE
  // script tags (analytics etc.), exactly like dice.fm pages.
  const html = [
    '<html><head>',
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>`,
    '<script>window.dataLayer=[];</script>',
    '<script src="/analytics.js"></script>',
    '</head><body></body></html>'
  ].join('\n');

  const diagnostics = { containersFound: [], containersParsed: [], parseErrors: [], urlSamples: undefined };
  const urls = parser.extractUrlsFromNextData(html, 'https://dice.fm/partner/beefmince', diagnostics);
  assert.ok(urls.includes('https://dice.fm/event/abc123-beefmince-xl'), `urls: ${JSON.stringify(urls)}`);
  assert.ok(urls.includes('https://dice.fm/event/def456-meet-market'), `urls: ${JSON.stringify(urls)}`);
  assert.deepEqual(diagnostics.containersParsed, ['__NEXT_DATA__'], 'payload parsed, no SyntaxError path');

  // No __NEXT_DATA__ tag → clean empty result.
  assert.deepEqual(parser.extractUrlsFromNextData('<html><script>1</script></html>', 'https://dice.fm/x'), []);
});

// ---------------------------------------------------------------------------
// Meta `content` attributes must not truncate at an apostrophe
// (2026-08-03 run review).
//
// The previous `["']([^"']+)["']` shape used ONE character class for BOTH
// delimiters, so a double-quoted value stopped at its first apostrophe. On
// 3dollarbillbk.com that turned og:title "…Aquatica Erotica: Bushwick's Wettest
// Cabaret…" into "…Aquatica Erotica: Bushwick" — and because the truncated
// string then BECAME the page corpus, the verbatim-evidence gate could not
// catch it. Any event title or description with an apostrophe was affected.
// ---------------------------------------------------------------------------

test('meta content: an apostrophe inside a double-quoted value is not a delimiter', () => {
  const parser = createParser();
  const realTag = `<meta property="og:title" content="Buy Tickets to Aquatica Erotica: Bushwick's Wettest Cabaret in Brooklyn on Aug 07, 2026" />`;
  assert.equal(
    parser.readMetaContentAttribute(realTag),
    `Buy Tickets to Aquatica Erotica: Bushwick's Wettest Cabaret in Brooklyn on Aug 07, 2026`
  );
});

test('meta content: single-quoted values, embedded double quotes, and absent/empty attributes', () => {
  const parser = createParser();
  assert.equal(
    parser.readMetaContentAttribute(`<meta name="description" content='Bear Happy Hour — it is "first Thursdays"' />`),
    'Bear Happy Hour — it is "first Thursdays"',
    'single-quoted value keeps embedded double quotes'
  );
  assert.equal(parser.readMetaContentAttribute(`<meta name="viewport" />`), '', 'absent attribute');
  assert.equal(parser.readMetaContentAttribute(`<meta name="x" content="" />`), '', 'empty attribute stays falsy');
  assert.equal(parser.readMetaContentAttribute(`<meta name="x" CONTENT="Cased">`), 'Cased', 'attribute name is case-insensitive');
  assert.equal(parser.readMetaContentAttribute(null), '', 'null tag');
  assert.equal(
    parser.readMetaContentAttribute(`<meta property="og:title" content="LORAX XCX in Brooklyn on Aug 07, 2026" />`),
    'LORAX XCX in Brooklyn on Aug 07, 2026',
    'the apostrophe-free sibling is unchanged'
  );
});

test('meta content: og extraction end-to-end keeps the apostrophe title intact', () => {
  const parser = createParser();
  const html = `<html><head>
    <meta property="og:site_name" content="3 Dollar Bill" />
    <meta property="og:title" content="Buy Tickets to Aquatica Erotica: Bushwick's Wettest Cabaret in Brooklyn on Aug 07, 2026" />
    <meta name="description" content="Bushwick's wettest cabaret returns" />
  </head><body></body></html>`;

  assert.equal(
    parser.extractOgMetaContent(html, 'og:title'),
    `Buy Tickets to Aquatica Erotica: Bushwick's Wettest Cabaret in Brooklyn on Aug 07, 2026`
  );
  assert.deepEqual(
    parser.extractOgMetaContentAll(html, 'og:title'),
    [`Buy Tickets to Aquatica Erotica: Bushwick's Wettest Cabaret in Brooklyn on Aug 07, 2026`]
  );
  const entries = parser.extractOgMetaEntriesAll(html, ['og:title', 'og:site_name']);
  assert.equal(entries.length, 2);
  assert.equal(entries.find(entry => entry.key === 'og:site_name').value, '3 Dollar Bill');

  const metaParts = parser.extractMetaParts(html);
  const description = metaParts.find(part => String(part).includes('wettest cabaret'));
  assert.ok(description, 'the description meta survives');
  assert.ok(String(description).includes(`Bushwick's`), 'and keeps its apostrophe');
});

// ---------------------------------------------------------------------------
// Run 20260802-222252 (thedallaseagle.com): the listing widget prints each
// event's schedule as its own labelled lines ("Start from: …", "End at: …").
// Every one of those lines carries a date signal, so each opened a NEW segment
// boundary — 16 segments for the page, every window straddling two listings —
// and the dated-line title path handed the bare LABEL back as the page's own
// listing title, shipping five ghost calendar events ("Start from" x3,
// "End at" x2).
// ---------------------------------------------------------------------------

const SCHEDULE_LABEL_LISTING_HTML = `
  <html><body>
    <div><p>SHOCK Therapy with DJ Dan Slater</p>
      <p>Start from: August 1, 2026 - 10:00 pm</p>
      <p>End at: August 2, 2026 - 2:00 am</p>
      <p>Plug in and lose yourself at SHOCK Therapy, our monthly dance floor takeover.</p></div>
    <div><p>Bear and Twink Night</p>
      <p>Start from: August 14, 2026 - 9:00 pm</p>
      <p>End at: August 15, 2026 - 2:00 am</p>
      <p>Opposites attract at this event, so come out and enjoy the variety.</p></div>
  </body></html>`;

test('schedule-label lines never open a segment boundary and never become a listing title', () => {
  const parser = createParser();

  // Shape detection: a bare schedule label + separator + date/time-only value.
  assert.equal(parser.isScheduleLabelDateLine('Start from: August 1, 2026 - 10:00 pm'), true);
  assert.equal(parser.isScheduleLabelDateLine('End at: August 2, 2026 - 2:00 am'), true);
  assert.equal(parser.isScheduleLabelDateLine('DOORS OPEN — 8:00 PM'), true,
    'the label set is case-insensitive and generalises beyond one venue');
  assert.equal(parser.isScheduleLabelDateLine('Until: 2:00 am'), true);
  // Fails closed: a real listing head that merely starts with a schedule word
  assert.equal(parser.isScheduleLabelDateLine('Start: Bear Happy Hour August 9'), false,
    'a remainder carrying a name is never treated as a bare schedule value');
  assert.equal(parser.isScheduleLabelDateLine('CHUNK Portland - 5/23 Sat, May 23'), false,
    'a name+date listing line keeps its existing dated-line title behaviour');

  const segments = parser.buildMultiEventSegments(SCHEDULE_LABEL_LISTING_HTML, 'https://eagle.example/events/');
  const titles = segments.map(segment => parser.deriveSegmentListingTitle(segment));
  assert.deepEqual(titles, ['SHOCK Therapy with DJ Dan Slater', 'Bear and Twink Night'],
    `the label lines fold into the event above them, got: ${JSON.stringify(titles)}`);
  assert.ok(!titles.some(title => /^(Start from|End at)$/i.test(title)),
    'the bare label is never the page\'s own listing title');

  // Flag, don't drop: every schedule line still rides along in its own segment
  assert.ok(segments[0].lines.includes('Start from: August 1, 2026 - 10:00 pm'));
  assert.ok(segments[0].lines.includes('End at: August 2, 2026 - 2:00 am'));
  assert.ok(segments[1].lines.includes('Start from: August 14, 2026 - 9:00 pm'));
  assert.ok(segments[1].lines.includes('End at: August 15, 2026 - 2:00 am'));
});

test('curated-website fills run when the POI-gated identity establishes but applies to no event', () => {
  const parser = createCuratedWebsiteParser();
  // The 20260802-194055 shape: siteRole 'venue' + a curated venue name and NO
  // address consensus → getEstablishedVenueSiteIdentity returns the weaker
  // hostLevel:false rung, which then requires a matching _geoPoiName per event.
  const entry = curatedWebsiteEntry({ venueRoleSeen: true, venueName: '3 Dollar Bill' });
  const identity = parser.getEstablishedVenueSiteIdentity(entry, entry.consensusKey);
  assert.ok(identity, 'the POI-gated rung does establish');
  assert.equal(identity.hostLevel, false);

  parser.lastVenueSiteConsensus = { '3dollarbillbk.com': entry };
  const events = [
    // No _geoPoiName anywhere — the listing page never produced one
    { title: 'Galaxy Brain Ball', bar: '', city: 'unknown', _venueSitePageHost: '3dollarbillbk.com' },
    {
      title: 'CONFESSIONS DEUX', bar: '', city: 'unknown',
      address: '270 Meserole St. BK', _venueSitePageHost: '3dollarbillbk.com'
    }
  ];
  const logs = captureLogs(() => parser.applyVenueSiteIdentityCorrections(events, null));

  assert.ok(logs.some(line => line.includes(
    'Venue-site identity for 3dollarbillbk.com established but applied to no event — falling back to the curated-website fills')),
    `the fallback must fire on "did not apply", not only on "identity is null", got: ${JSON.stringify(logs)}`);
  assert.ok(logs.some(line => line.includes('established from curated website match')),
    'the weaker curated-website rung gets its turn');

  // Fail closed on the sibling ambiguity: no per-event evidence → no bar.
  assert.equal(events[0].bar, '', 'the coordinate-carrying primary is a ranking, not evidence');
  assert.equal(events[0].city, 'nyc', 'the unambiguous city still fills — that is what re-anchors the timezone');
  // Real evidence still resolves the sub-venue.
  assert.equal(events[1].bar, 'The Yard at 9 Bob Note');
  assert.equal(events[1].city, 'nyc');
});

test('a schedule-mismatched rrule is recovered from its own cited evidence, failing closed on exceptions', () => {
  global.EventSchema = EventSchema;
  const parser = createParser();
  const corpus = 'DIRTY POP takes over second Sundays at the Dallas Eagle. '
    + 'Trivia Taco night (except the last Tuesday - Drink and Draw).';
  const runOn = (aiEvent) => {
    const evidenceContext = parser.buildAiEvidenceContextFromText(corpus);
    return parser.validateAiEventEvidence(aiEvent, { html: corpus }, {}, null, {
      evidenceContext, validationContext: { imageEvidenceUrls: new Set() }
    });
  };

  // The real 20260802 record: the gate correctly rejects FREQ=WEEKLY;BYDAY=SU
  // for "second Sundays" — and the event then shipped with NO recurrence.
  let recovered;
  const recoveryLogs = captureLogs(() => {
    recovered = runOn({
      rrule: 'FREQ=WEEKLY;BYDAY=SU',
      __fieldEvidence: { rrule: 'second Sundays at the Dallas Eagle' }
    });
  });
  assert.equal(recovered.report.dropped[0].reason, 'rrule-schedule-evidence', 'the gate still drops');
  assert.equal(recovered.event.rrule, 'FREQ=MONTHLY;BYDAY=2SU',
    'the ordinal stated in the cited evidence is recovered');
  assert.ok(recoveryLogs.some(line => line.includes(
    'Recovered rrule "FREQ=MONTHLY;BYDAY=2SU"')), `recovery log expected, got: ${JSON.stringify(recoveryLogs)}`);

  // The known false positive: the ordinal names what the schedule EXCLUDES.
  let excepted;
  const exceptionLogs = captureLogs(() => {
    excepted = runOn({
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
      __fieldEvidence: { rrule: 'Trivia Taco night (except the last Tuesday - Drink and Draw)' }
    });
  });
  assert.equal(excepted.event.rrule, undefined,
    'an exception clause never promotes its day phrase to the schedule');
  assert.ok(exceptionLogs.some(line => line.includes('states an exception, not the schedule')),
    `fail-closed log expected, got: ${JSON.stringify(exceptionLogs)}`);
});

test('a scheme-less dotted host is normalized to https instead of shipping as a relative href', () => {
  const parser = createParser();
  const logs = captureLogs(() => {
    // The run 20260802-194055 value, verbatim from "TICKETS AT 3DOLLARBILLBK.COM"
    assert.equal(parser.sanitizeExtractedUrlField('ticketUrl', '3DOLLARBILLBK.COM'),
      'https://3dollarbillbk.com');
    assert.equal(parser.sanitizeExtractedUrlField('url', 'WWW.EAGLELA.COM/events'),
      'https://www.eaglela.com/events');
  });
  assert.ok(logs.some(line => line.includes(
    'Normalized scheme-less ticketUrl "3DOLLARBILLBK.COM" → "https://3dollarbillbk.com"')),
    `normalization log expected, got: ${JSON.stringify(logs)}`);

  // Already-schemed URLs are untouched, and the existing rejections still win.
  assert.equal(parser.sanitizeExtractedUrlField('url', 'https://eagle.example/events'),
    'https://eagle.example/events');
  assert.equal(parser.sanitizeExtractedUrlField('url', "BASTILLE'S POOL.COM"), '');

  // Fail open: an unwired core leaves the value exactly as it was before.
  const unwired = new AiWebParser({ normalizeUrl });
  unwired.core = null;
  assert.equal(unwired.sanitizeExtractedUrlField('ticketUrl', '3DOLLARBILLBK.COM'), '3DOLLARBILLBK.COM');
});

test('OCR prefers a full-size original over its own resized derivative, and never drops a lone thumbnail', () => {
  const parser = createParser();
  const original = 'https://eaglela.com/wp-content/uploads/ig_wed-hump-night-2024-web-1-1.jpg';
  const thumbnail = 'https://eaglela.com/wp-content/uploads/ig_wed-hump-night-2024-web-1-1-300x300.jpg';

  assert.equal(parser.getResizedImageOriginalUrl(thumbnail), original);
  assert.equal(parser.getResizedImageOriginalUrl(original), '', 'the original names no smaller source');

  const logs = captureLogs(() => {
    assert.deepEqual(
      parser.dropResizedImageUrlsWithOriginal([thumbnail, original, 'https://eaglela.com/flyer.png']),
      [original, 'https://eaglela.com/flyer.png'],
      'the degraded derivative is skipped when its original is on the same page');
  });
  assert.ok(logs.some(line => line.includes(`OCR skipped resized image ${thumbnail}`)),
    `skip log expected, got: ${JSON.stringify(logs)}`);

  // Flag, don't drop: a thumbnail whose original is ABSENT is still OCR'd.
  assert.deepEqual(
    parser.dropResizedImageUrlsWithOriginal([thumbnail, 'https://eaglela.com/other.png']),
    [thumbnail, 'https://eaglela.com/other.png']);
  // A differently-named sibling is never mistaken for the same asset.
  assert.deepEqual(
    parser.dropResizedImageUrlsWithOriginal([thumbnail, 'https://eaglela.com/wp-content/uploads/other-1-1.jpg']),
    [thumbnail, 'https://eaglela.com/wp-content/uploads/other-1-1.jpg']);
});

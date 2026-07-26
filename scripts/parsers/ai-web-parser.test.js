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

  // No image → no stamp at all (fail open)
  const bareEvent = parser.normalizeAiEvent({ ...base }, {}, htmlData, null, null);
  assert.equal('imageSource' in bareEvent, false);

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
// Console-tee coverage: every log-producing module imported via importModule
// must carry the __wireConsoleTee shim, or its output silently vanishes from
// the saved Scriptable run log (each imported module has its own console).
// ---------------------------------------------------------------------------
test('every log-producing importModule module exports the __wireConsoleTee shim', () => {
  const wiredModules = {
    'shared-core': require('../shared-core'),
    normalizers: require('../normalizers'),
    'parsers/ai-web-parser': require('./ai-web-parser'),
    'parsers/bearracuda-parser': require('./bearracuda-parser'),
    'parsers/chunk-parser': require('./chunk-parser'),
    'parsers/linktree-parser': require('./linktree-parser'),
    'parsers/redeyetickets-parser': require('./redeyetickets-parser'),
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
  const steering = ` The title is the event's NAME — short and reusable, exactly as it appears in the source. When the source text is an announcement sentence or caption that contains the event name, extract just the name portion (it must still appear verbatim within the source). Never include venue, city, date, or marketing phrases in the title.`;
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

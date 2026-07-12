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

  // openai provider must never default to the text/coder extraction model
  const openaiOcr = parser.getOcrConfig({ ai: { ocr: { provider: 'openai' } } });
  assert.equal(openaiOcr.provider, 'openai');
  assert.match(openaiOcr.model, /VL/i, 'openai OCR default must be a vision model');
  assert.equal(openaiOcr.endpoint, 'http://rybook.taila7523c.ts.net:8000/v1/chat/completions');

  // A mis-nested top-level ocr block should still configure OCR (fallback)...
  const topLevel = parser.getOcrConfig({ ocr: { maxImages: 3, concurrency: 2 } });
  assert.equal(topLevel.maxImages, 3);
  assert.equal(topLevel.maxConcurrentRequests, 2);

  // ...but the canonical ai.ocr block wins when both exist
  const both = parser.getOcrConfig({ ai: { ocr: { maxImages: 4 } }, ocr: { maxImages: 3 } });
  assert.equal(both.maxImages, 4);
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

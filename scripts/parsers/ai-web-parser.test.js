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

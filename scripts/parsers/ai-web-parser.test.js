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

test('weekday pinning leaves explicit years and weekday-less evidence alone', () => {
  const parser = createParser();
  parser.now = FROZEN_NOW;
  assert.equal(parser.resolveWeekdayPinnedYear('2024-08-22', 'Sat, Aug 22, 2024'), null, 'an explicit year in evidence is trusted');
  assert.equal(parser.resolveWeekdayPinnedYear('2024-08-22', 'Aug 22'), null, 'no weekday falls through to existing behavior');
  assert.equal(parser.resolveWeekdayPinnedYear('2024-08-22', ''), null, 'missing evidence falls through');
  assert.equal(parser.resolveWeekdayPinnedYear('Aug 22', 'Sat, Aug 22'), null, 'a value without a 4-digit year cannot be rewritten');
  assert.equal(parser.resolveWeekdayPinnedYear('2026-08-22', 'Saturday party vibes'), null, 'a weekday with no adjacent date does not pin');
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

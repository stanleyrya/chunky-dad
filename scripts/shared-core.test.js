const test = require('node:test');
const assert = require('node:assert/strict');

const { SharedCore } = require('./shared-core');
const { EventSchema } = require('./event-schema');
const { OpenStreetMapNormalizer, BarDataNormalizer } = require('./normalizers');

const CITIES = {
  dallas: { timezone: 'America/Chicago', patterns: ['dallas'] }
};

function createCore() {
  return new SharedCore(CITIES, { eventSchema: EventSchema });
}

// Real-world pair: freshly scraped event vs the calendar record it should merge into.
// Titles differ ("DALLAS FREEDOM TEA" vs "FURBALL") and the stored time is an hour off
// (legacy wall-clock data), but shortName, venue, address, and ticketUrl all agree.
function buildScrapedEvent(overrides = {}) {
  return {
    title: 'DALLAS FREEDOM TEA',
    description: 'FURBALL PRESENTS',
    startDate: new Date('2026-07-05T22:00:00.000Z'),
    endDate: new Date('2026-07-05T22:00:00.000Z'),
    bar: 'STATION 4',
    address: '3911 Cedar Springs Rd, Dallas, TX 75219',
    city: 'dallas',
    timezone: 'America/Chicago',
    ticketUrl: 'https://events.ticketleap.com/tickets/furballnyc/furball-dallas-freedom-tea-2026',
    shortName: 'FUR-BALL',
    source: 'ai-web',
    ...overrides
  };
}

function buildCalendarEvent(overrides = {}, notesOverride = null) {
  const notes = notesOverride !== null ? notesOverride : [
    'bar: STATION 4',
    'address: 3911 Cedar Springs Rd, Dallas, TX 75219',
    'timezone: America/Chicago',
    'ticketUrl: https://events.ticketleap.com/tickets/furballnyc/furball-dallas-freedom-tea-2026',
    'shortName: FUR-BALL'
  ].join('\n');
  return {
    name: 'FURBALL',
    startDate: new Date('2026-07-05T21:00:00.000Z'),
    endDate: new Date('2026-07-05T21:00:00.000Z'),
    coordinates: { lat: 32.810535, lng: -96.8110709 },
    calendarTimezone: 'America/Chicago',
    notes,
    ...overrides
  };
}

test('identity: shared ticketUrl on the same local day matches', () => {
  const core = createCore();
  const signal = core.getSameEventIdentitySignal(buildScrapedEvent(), buildCalendarEvent());
  assert.equal(signal, 'ticket-url');
});

test('identity: place + close time + similar name matches without ticketUrl', () => {
  const core = createCore();
  const scraped = buildScrapedEvent({ ticketUrl: '' });
  const existing = buildCalendarEvent({}, [
    'bar: STATION 4',
    'address: 3911 Cedar Springs Rd, Dallas, TX 75219',
    'shortName: FUR-BALL'
  ].join('\n'));
  // shortName "FUR-BALL" vs name "FURBALL" is the similar-name link
  const signal = core.getSameEventIdentitySignal(scraped, existing);
  assert.equal(signal, 'place-time-name');
});

test('identity: same venue and time but unrelated names do not match', () => {
  const core = createCore();
  const scraped = buildScrapedEvent({ ticketUrl: '', shortName: '', title: 'BEAR HAPPY HOUR' });
  const existing = buildCalendarEvent({}, 'bar: STATION 4\naddress: 3911 Cedar Springs Rd, Dallas, TX 75219');
  assert.equal(core.getSameEventIdentitySignal(scraped, existing), null);
});

test('identity: shared ticketUrl on different local days does not match', () => {
  const core = createCore();
  const scraped = buildScrapedEvent({ startDate: new Date('2026-07-06T22:00:00.000Z') });
  assert.equal(core.getSameEventIdentitySignal(scraped, buildCalendarEvent()), null);
});

test('identity: ticketUrl comparison ignores protocol, www, and tracking params', () => {
  const core = createCore();
  const scraped = buildScrapedEvent({
    ticketUrl: 'http://www.events.ticketleap.com/tickets/furballnyc/furball-dallas-freedom-tea-2026/?utm_source=ig'
  });
  assert.equal(core.getSameEventIdentitySignal(scraped, buildCalendarEvent()), 'ticket-url');
});

test('analyzeEventAction merges renamed same-day events via identity signals', () => {
  const core = createCore();
  const analysis = core.analyzeEventAction(buildScrapedEvent(), [buildCalendarEvent()]);
  assert.equal(analysis.action, 'merge');
  assert.match(analysis.reason, /Same event identity/);
});

test('analyzeEventAction keeps genuinely different same-venue events separate', () => {
  const core = createCore();
  const scraped = buildScrapedEvent({
    title: 'UNDERWEAR NIGHT',
    shortName: '',
    ticketUrl: 'https://events.ticketleap.com/tickets/other-promoter/underwear-night'
  });
  const analysis = core.analyzeEventAction(scraped, [buildCalendarEvent()]);
  assert.equal(analysis.action, 'new');
});

test('parseAiEventResponse rejects array responses', () => {
  const core = createCore();
  assert.equal(core.parseAiEventResponse('[0]'), null, 'bare arrays are not event objects');
  assert.equal(core.parseAiEventResponse('[{"title": "x"}]'), null);
  assert.deepEqual(core.parseAiEventResponse('{"title": "x"}'), { title: 'x' });
});

test('callAiGenerate flags zero-token finish_reason=length image requests as context overflow', async () => {
  const core = createCore();
  const overflowPayload = JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    model: 'mlx-community/Qwen3-VL-4B-Instruct-4bit',
    choices: [{ index: 0, message: { role: 'assistant' }, finish_reason: 'length' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  });
  const aiConfig = {
    provider: 'openai',
    endpoint: 'http://rybook.example:8001/v1/chat/completions',
    model: 'mlx-community/Qwen3-VL-4B-Instruct-4bit',
    temperature: 0,
    numPredict: 2000,
    timeoutSeconds: 120,
    openai: {}
  };

  // Overflow signature: image attached, finish_reason "length", zero tokens generated
  const overflowAdapter = { postJson: async () => ({ ok: true, status: 200, text: overflowPayload }) };
  const diagnostics = {};
  const result = await core.callAiGenerate(aiConfig, 'ocr prompt', 'ocr-all', overflowAdapter, null, 'base64image', diagnostics);
  assert.equal(result, null);
  assert.equal(diagnostics.failureKind, 'context-overflow');

  // A truncated-but-nonempty response (tokens were generated) is NOT an overflow
  const truncatedPayload = JSON.stringify({
    choices: [{ index: 0, message: { role: 'assistant', content: '{"text": "PARTIAL' }, finish_reason: 'length' }],
    usage: { prompt_tokens: 500, completion_tokens: 2000, total_tokens: 2500 }
  });
  const truncatedAdapter = { postJson: async () => ({ ok: true, status: 200, text: truncatedPayload }) };
  const truncatedDiag = {};
  const truncatedResult = await core.callAiGenerate(aiConfig, 'ocr prompt', 'ocr-all', truncatedAdapter, null, 'base64image', truncatedDiag);
  assert.equal(truncatedResult, '{"text": "PARTIAL');
  assert.equal(truncatedDiag.failureKind, undefined);

  // Text-only requests (no image) never get the overflow flag
  const textDiag = {};
  await core.callAiGenerate(aiConfig, 'text prompt', 'extract', overflowAdapter, null, null, textDiag);
  assert.equal(textDiag.failureKind, undefined);
});

// Persistent AI-response cache: callAiGenerate consults the injected provider
// before the transport and stores accepted responses after it. The provider
// itself is filesystem-backed (see ai-web-parser tests); here it is faked.

function buildAiTestConfig(overrides = {}) {
  return {
    provider: 'openai',
    endpoint: 'http://rybook.example:8000/v1/chat/completions',
    model: 'test-model',
    temperature: 0,
    numPredict: 2000,
    timeoutSeconds: 120,
    cacheEnabled: true,
    openai: {},
    ...overrides
  };
}

function buildOpenAiResponsePayload(content) {
  return JSON.stringify({
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }]
  });
}

test('callAiGenerate returns cached responses without touching the transport', async () => {
  const core = createCore();
  let writeCalls = 0;
  core.aiResponseCache = {
    read: async () => 'CACHED',
    write: async () => { writeCalls++; },
    stats: { hits: 0, misses: 0, writes: 0 }
  };
  const adapter = {
    postJson: async () => {
      throw new Error('transport must not be called on a cache hit');
    }
  };
  const result = await core.callAiGenerate(buildAiTestConfig(), 'extract prompt', 'extraction', adapter);
  assert.equal(result, 'CACHED');
  assert.equal(writeCalls, 0, 'a cache hit must not be re-written');
});

test('callAiGenerate writes the exact accepted response to the cache on a miss', async () => {
  const core = createCore();
  const writeArgs = [];
  core.aiResponseCache = {
    read: async () => null,
    write: async (...args) => { writeArgs.push(args); },
    stats: { hits: 0, misses: 0, writes: 0 }
  };
  let transportCalls = 0;
  const adapter = {
    postJson: async () => {
      transportCalls++;
      return { ok: true, status: 200, text: buildOpenAiResponsePayload('{"title": "FURBALL"}') };
    }
  };
  const result = await core.callAiGenerate(buildAiTestConfig(), 'extract prompt', 'extraction', adapter);
  assert.equal(result, '{"title": "FURBALL"}');
  assert.equal(transportCalls, 1);
  assert.equal(writeArgs.length, 1);
  assert.equal(writeArgs[0][1], 'extract prompt');
  assert.equal(writeArgs[0][2], 'extraction');
  assert.equal(writeArgs[0][3], '{"title": "FURBALL"}');
});

test('callAiGenerate never caches HTTP errors, empty responses, or transport failures', async () => {
  const core = createCore();
  let writeCalls = 0;
  core.aiResponseCache = {
    read: async () => null,
    write: async () => { writeCalls++; },
    stats: { hits: 0, misses: 0, writes: 0 }
  };

  const httpErrorAdapter = { postJson: async () => ({ ok: false, status: 500, text: 'boom' }) };
  assert.equal(await core.callAiGenerate(buildAiTestConfig(), 'p', 'extraction', httpErrorAdapter), null);

  const emptyAdapter = { postJson: async () => ({ ok: true, status: 200, text: buildOpenAiResponsePayload('') }) };
  assert.equal(await core.callAiGenerate(buildAiTestConfig(), 'p', 'extraction', emptyAdapter), null);

  const throwingAdapter = { postJson: async () => { throw new Error('connection refused'); } };
  assert.equal(await core.callAiGenerate(buildAiTestConfig(), 'p', 'extraction', throwingAdapter), null);

  assert.equal(writeCalls, 0, 'failure paths must never populate the cache');
});

test('callAiGenerate bypasses the response cache for image requests', async () => {
  const core = createCore();
  let readCalls = 0;
  let writeCalls = 0;
  core.aiResponseCache = {
    read: async () => { readCalls++; return 'CACHED'; },
    write: async () => { writeCalls++; },
    stats: { hits: 0, misses: 0, writes: 0 }
  };
  const adapter = {
    postJson: async () => ({ ok: true, status: 200, text: buildOpenAiResponsePayload('{"text": "OCR TEXT"}') })
  };
  const result = await core.callAiGenerate(buildAiTestConfig(), 'ocr prompt', 'ocr-all', adapter, null, 'base64image');
  assert.equal(result, '{"text": "OCR TEXT"}');
  assert.equal(readCalls, 0, 'image requests must not read the response cache');
  assert.equal(writeCalls, 0, 'image requests must not write the response cache');
});

test('callAiGenerate without an injected cache calls the transport directly', async () => {
  const core = createCore();
  assert.equal(core.aiResponseCache, null, 'cache is opt-in via injection');
  let transportCalls = 0;
  const adapter = {
    postJson: async () => {
      transportCalls++;
      return { ok: true, status: 200, text: buildOpenAiResponsePayload('{"title": "x"}') };
    }
  };
  const result = await core.callAiGenerate(buildAiTestConfig(), 'p', 'extraction', adapter);
  assert.equal(result, '{"title": "x"}');
  assert.equal(transportCalls, 1);
});

test('resolveAiConfig defaults the response cache on and honors cache: false', () => {
  const core = createCore();
  assert.equal(core.resolveAiConfig({}).cacheEnabled, true, 'absent key defaults ON');
  assert.equal(core.resolveAiConfig({ cache: true }).cacheEnabled, true);
  assert.equal(core.resolveAiConfig({ cache: false }).cacheEnabled, false);
});

test('extractJsonLdEventNodes finds Event nodes in plain, @graph, and list containers', () => {
  const core = createCore();

  const musicEventHtml = `
    <html><head>
      <script type="application/ld+json">
        {"@context":"http://schema.org","@type":"MusicEvent","name":"BEARRACUDA","startDate":"2026-07-17T21:00:00-07:00","url":"https://www.tryst.events/e/bearracuda/tickets"}
      </script>
    </head><body></body></html>`;
  const musicNodes = core.extractJsonLdEventNodes(musicEventHtml);
  assert.equal(musicNodes.length, 1);
  assert.equal(musicNodes[0].name, 'BEARRACUDA');

  const graphHtml = `
    <script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"WebPage","name":"Some Page","url":"https://x.example/"},
        {"@type":"DanceEvent","name":"Party One","startDate":"2026-08-01T22:00:00-05:00"},
        {"@type":"Event","name":"Party Two","startDate":"2026-08-02"}
      ]}
    </script>`;
  const graphNodes = core.extractJsonLdEventNodes(graphHtml);
  assert.equal(graphNodes.length, 2);

  // Nodes without a startDate or name are references, not concrete events
  const incompleteHtml = `
    <script type="application/ld+json">{"@type":"MusicEvent","name":"No Date Here"}</script>
    <script type="application/ld+json">{"@type":"EventSeries","name":"Weekly Series","startDate":"2026-01-01"}</script>
    <script type="application/ld+json">{"@type":"Organization","name":"Not An Event"}</script>`;
  assert.equal(core.extractJsonLdEventNodes(incompleteHtml).length, 0);

  // Malformed JSON in one script must not break others
  const mixedHtml = `
    <script type="application/ld+json">{not valid json</script>
    <script type="application/ld+json">{"@type":"MusicEvent","name":"Survivor","startDate":"2026-09-04T21:00:00-05:00"}</script>`;
  assert.equal(core.extractJsonLdEventNodes(mixedHtml).length, 1);
});

test('classifyPage prefers JSON-LD Event count over the month-name heuristic', () => {
  const core = createCore();

  // A ticketing page: one MusicEvent in JSON-LD, but a related-events footer full of
  // month names that would trip the multi-event heuristic.
  const monthNoise = 'January February March April May June July August September';
  const singleEventHtml = `
    <html><head>
      <script type="application/ld+json">{"@type":"MusicEvent","name":"BEARRACUDA","startDate":"2026-07-17T21:00:00-07:00"}</script>
    </head><body>${monthNoise}</body></html>`;
  assert.equal(core.classifyPage('https://sickening.example/e/bearracuda', singleEventHtml), 'event-page');

  const multiEventHtml = `
    <script type="application/ld+json">[
      {"@type":"Event","name":"Show A","startDate":"2026-08-01"},
      {"@type":"Event","name":"Show B","startDate":"2026-08-08"}
    ]</script>`;
  assert.equal(core.classifyPage('https://x.example/calendar', multiEventHtml), 'multi-event-page');

  // No JSON-LD events → the month heuristic still applies
  assert.equal(core.classifyPage('https://x.example/events', `<body>${monthNoise}</body>`), 'multi-event-page');
  assert.equal(core.classifyPage('https://x.example/party', '<body>July 17 party</body>'), 'event-page');

  // Explicit URL rules still win over JSON-LD
  const ruledCore = new SharedCore(CITIES, { eventSchema: EventSchema });
  ruledCore.pageClassificationRules = ruledCore.normalizePageClassificationRules([
    { pattern: 'sickening\\.example', classification: 'multi-event-page' }
  ]);
  assert.equal(ruledCore.classifyPage('https://sickening.example/e/bearracuda', singleEventHtml), 'multi-event-page');
});

test('classifyPageWithSignal reports which tier decided', () => {
  const core = createCore();

  const jsonLdHtml = '<script type="application/ld+json">{"@type":"MusicEvent","name":"X","startDate":"2026-07-17T21:00:00-07:00"}</script>';
  assert.deepEqual(core.classifyPageWithSignal('https://x.example/e/x', jsonLdHtml), { classification: 'event-page', signal: 'json-ld' });

  assert.deepEqual(
    core.classifyPageWithSignal('https://x.example/party', '<body>July 17 party</body>'),
    { classification: 'event-page', signal: 'heuristic' }
  );
  assert.deepEqual(core.classifyPageWithSignal('https://x.example/', '<body>no dates here</body>'), { classification: 'unknown', signal: 'none' });

  const ruledCore = createCore();
  ruledCore.pageClassificationRules = ruledCore.normalizePageClassificationRules([
    { pattern: 'x\\.example/hub', classification: 'link-aggregator' }
  ]);
  assert.deepEqual(ruledCore.classifyPageWithSignal('https://x.example/hub', jsonLdHtml), { classification: 'link-aggregator', signal: 'url-rule' });
});

test('classifyPageWithSignal classifies raw JSON API bodies deterministically by event-object count', () => {
  const core = createCore();
  const eventObject = { name: 'GOLDILOXX JULY', first_performance_start_at: '2026-07-26T01:00:00Z' };

  assert.deepEqual(
    core.classifyPageWithSignal('https://api.example/v2/events/search', JSON.stringify({ data: [eventObject], meta: {} })),
    { classification: 'event-page', signal: 'json-api' }
  );
  assert.deepEqual(
    core.classifyPageWithSignal('https://api.example/v2/events/search', JSON.stringify({
      data: [eventObject, { title: 'BEAR NIGHT', startDate: '2026-08-08T02:00:00Z' }]
    })),
    { classification: 'multi-event-page', signal: 'json-api' }
  );
  // A bare array payload and a detail-shaped single object both count
  assert.equal(core.countJsonApiEventObjects(JSON.stringify([eventObject, eventObject])), 2);
  assert.equal(core.countJsonApiEventObjects(JSON.stringify({ data: eventObject })), 1);
  // Unrecognizable JSON, empty payloads, and HTML never classify via json-api
  assert.equal(core.countJsonApiEventObjects('{"foo":[{"bar":1}]}'), 0);
  assert.equal(core.countJsonApiEventObjects('{"data":[],"meta":{}}'), 0);
  assert.equal(core.countJsonApiEventObjects('<html><body>July 17</body></html>'), 0);
  assert.deepEqual(
    core.classifyPageWithSignal('https://api.example/misc', '{"foo":[{"bar":1}]}'),
    { classification: 'unknown', signal: 'none' }
  );
});

test('classifyPageWithAi accepts confident valid labels and rejects everything else', async () => {
  const core = createCore();
  const aiConfig = {
    provider: 'openai',
    endpoint: 'http://rybook.example:8000/v1/chat/completions',
    model: 'test-model',
    temperature: 0,
    numPredict: 2000,
    timeoutSeconds: 120,
    openai: {}
  };
  const html = '<html><head><title>Big Party</title></head><body>One night only at The Eagle, July 17.</body></html>';
  const adapterReturning = (content) => ({
    postJson: async () => ({
      ok: true,
      status: 200,
      text: JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] })
    })
  });

  const good = await core.classifyPageWithAi('https://x.example/party', html, aiConfig,
    adapterReturning('{"classification": "event-page", "confidence": 92, "reason": "single event"}'));
  assert.equal(good.classification, 'event-page');
  assert.equal(good.confidence, 92);

  // The numPredict cap should apply to the classification request
  let sentPayload = null;
  const capturingAdapter = {
    postJson: async (endpoint, payload) => {
      sentPayload = payload;
      return { ok: true, status: 200, text: JSON.stringify({ choices: [{ message: { content: '{"classification": "ad", "confidence": 99}' } }] }) };
    }
  };
  await core.classifyPageWithAi('https://x.example/party', html, aiConfig, capturingAdapter);
  assert.equal(sentPayload.max_tokens, 300);

  // Low confidence → keep the heuristic answer
  const lowConfidence = await core.classifyPageWithAi('https://x.example/party', html, aiConfig,
    adapterReturning('{"classification": "multi-event-page", "confidence": 30, "reason": "unsure"}'));
  assert.equal(lowConfidence, null);

  // Invalid or unknown labels → null
  assert.equal(await core.classifyPageWithAi('https://x.example/party', html, aiConfig,
    adapterReturning('{"classification": "unknown", "confidence": 95}')), null);
  assert.equal(await core.classifyPageWithAi('https://x.example/party', html, aiConfig,
    adapterReturning('{"classification": "banana", "confidence": 95}')), null);
  assert.equal(await core.classifyPageWithAi('https://x.example/party', html, aiConfig,
    adapterReturning('not json')), null);

  // Missing config/adapter → null without throwing
  assert.equal(await core.classifyPageWithAi('https://x.example/party', html, null, adapterReturning('{}')), null);
  assert.equal(await core.classifyPageWithAi('https://x.example/party', html, aiConfig, null), null);
});

test('parsePageForCrawl uses the AI second opinion only for weak signals when enabled', async () => {
  const core = createCore();
  const displayAdapter = { logInfo: async () => {} };
  const monthNoise = '<body>January February March April May June July August</body>';
  const receivedClassifications = [];
  const parsers = {
    'ai-web': {
      getAiConfig: () => ({
        provider: 'openai',
        endpoint: 'http://rybook.example:8000/v1/chat/completions',
        model: 'test-model',
        temperature: 0,
        numPredict: 2000,
        timeoutSeconds: 120,
        openai: {}
      }),
      parseEvents: async (htmlData, parserConfig, cities, classification) => {
        receivedClassifications.push(classification);
        return { events: [], additionalLinks: [] };
      }
    }
  };
  const aiAdapter = {
    postJson: async () => ({
      ok: true,
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: '{"classification": "event-page", "confidence": 90, "reason": "one event"}' } }] })
    })
  };

  // Default (no config): heuristic says multi-event-page (8 month names);
  // AI overrides to event-page
  await core.parsePageForCrawl({
    url: 'https://x.example/party',
    htmlData: { url: 'https://x.example/party', html: monthNoise },
    parsers,
    parserConfig: {},
    displayAdapter,
    httpAdapter: aiAdapter
  });
  assert.deepEqual(receivedClassifications, ['event-page']);

  // Explicitly disabled → heuristic result stands, no AI request
  receivedClassifications.length = 0;
  const explodingAdapter = { postJson: async () => { throw new Error('AI must not be called when classifyPages is off'); } };
  await core.parsePageForCrawl({
    url: 'https://x.example/party',
    htmlData: { url: 'https://x.example/party', html: monthNoise },
    parsers,
    parserConfig: { ai: { classifyPages: false } },
    displayAdapter,
    httpAdapter: explodingAdapter
  });
  assert.deepEqual(receivedClassifications, ['multi-event-page']);

  // ai.enabled: false (AI extraction disabled) → no classification request either
  receivedClassifications.length = 0;
  const disabledAiParsers = {
    'ai-web': {
      getAiConfig: () => ({ enabled: false }),
      parseEvents: parsers['ai-web'].parseEvents
    }
  };
  await core.parsePageForCrawl({
    url: 'https://x.example/party',
    htmlData: { url: 'https://x.example/party', html: monthNoise },
    parsers: disabledAiParsers,
    parserConfig: {},
    displayAdapter,
    httpAdapter: explodingAdapter
  });
  assert.deepEqual(receivedClassifications, ['multi-event-page']);

  // Strong signal (JSON-LD) → no AI request even though classification is enabled
  receivedClassifications.length = 0;
  const jsonLdHtml = '<script type="application/ld+json">{"@type":"MusicEvent","name":"X","startDate":"2026-07-17T21:00:00-07:00"}</script>';
  await core.parsePageForCrawl({
    url: 'https://x.example/e/x',
    htmlData: { url: 'https://x.example/e/x', html: jsonLdHtml },
    parsers,
    parserConfig: {},
    displayAdapter,
    httpAdapter: explodingAdapter
  });
  assert.deepEqual(receivedClassifications, ['event-page']);
});

test('classifyPageWithAi persists outcomes through an injected cache provider', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { AiWebParser } = require('./parsers/ai-web-parser');
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cls-cache-test-'));

  const core = createCore();
  const parser = new AiWebParser({
    normalizeUrl: (u) => u,
    classificationCacheDir: cacheDir
  });
  const cache = parser.getAiClassificationCache();
  const aiConfig = {
    provider: 'openai',
    endpoint: 'http://rybook.example:8000/v1/chat/completions',
    model: 'test-model',
    temperature: 0,
    numPredict: 2000,
    timeoutSeconds: 120,
    openai: {}
  };
  const html = '<html><head><title>Big Party</title></head><body>One night only, July 17.</body></html>';
  const adapterReturning = (content) => ({
    postJson: async () => ({
      ok: true,
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content } }] })
    })
  });
  const explodingAdapter = { postJson: async () => { throw new Error('cached pages must not hit the AI'); } };

  // Accepted outcome: first call hits the AI, second is served from cache
  const first = await core.classifyPageWithAi('https://x.example/party', html, aiConfig,
    adapterReturning('{"classification": "event-page", "confidence": 92, "reason": "one event"}'), cache);
  assert.equal(first.classification, 'event-page');
  const second = await core.classifyPageWithAi('https://x.example/party', html, aiConfig, explodingAdapter, cache);
  assert.equal(second.classification, 'event-page');
  assert.equal(second.confidence, 92);

  // Rejected outcome (low confidence) is cached too — no repeat request, still null
  const lowFirst = await core.classifyPageWithAi('https://x.example/other', html, aiConfig,
    adapterReturning('{"classification": "multi-event-page", "confidence": 30}'), cache);
  assert.equal(lowFirst, null);
  const lowSecond = await core.classifyPageWithAi('https://x.example/other', html, aiConfig, explodingAdapter, cache);
  assert.equal(lowSecond, null);

  // Changed page content → different signature → cache miss, AI consulted again
  const changedHtml = '<html><head><title>Big Party</title></head><body>Totally new lineup, August 20.</body></html>';
  const changed = await core.classifyPageWithAi('https://x.example/party', changedHtml, aiConfig,
    adapterReturning('{"classification": "multi-event-page", "confidence": 90, "reason": "many"}'), cache);
  assert.equal(changed.classification, 'multi-event-page');

  fs.rmSync(cacheDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AI merge arbitration
// ---------------------------------------------------------------------------

function buildArbitrationPair() {
  const core = createCore();
  const scraped = {
    title: 'FURBALL DALLAS',
    description: 'FURBALL PRESENTS',
    bar: 'S4',
    address: '3911 Cedar Springs Rd, Dallas, TX 75219',
    startDate: new Date('2026-07-05T22:00:00.000Z'),
    endDate: new Date('2026-07-06T02:00:00.000Z'),
    ticketUrl: 'https://tickets.example/furball',
    city: 'dallas',
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: { ai: { provider: 'ollama', endpoint: 'http://ai.example/api/generate', model: 'test-model' } }
  };
  const existing = {
    title: 'FURBALL',
    startDate: new Date('2026-07-05T21:00:00.000Z'),
    endDate: new Date('2026-07-06T02:00:00.000Z'),
    location: 'STATION 4, Dallas',
    url: '',
    notes: [
      'bar: STATION 4',
      'address: 3911 Cedar Springs Rd, Dallas, TX 75219',
      'ticketUrl: https://tickets.example/furball'
    ].join('\n')
  };
  // Genuine conflicts: title, bar, startDate. Equal fields (address, ticketUrl,
  // endDate) and one-sided fields must never reach the AI.
  return { scraped, existing };
}

function buildArbitrationAdapter(choices, options = {}) {
  const calls = [];
  return {
    calls,
    postJson: async (endpoint, payload) => {
      calls.push(payload);
      if (options.fail) throw new Error('AI endpoint down');
      return {
        ok: true,
        status: 200,
        text: JSON.stringify({ response: JSON.stringify({ choices }) })
      };
    }
  };
}

test('field priority defaults are ai-arbitrated; explicit config and metadata stay deterministic', () => {
  const core = createCore();
  const resolved = core.getResolvedFieldPriorities({
    fieldPriorities: { bar: { priority: ['static'], merge: 'preserve' } },
    metadata: { shortName: { value: 'FUR-BALL' } }
  });
  assert.equal(resolved.title.merge, 'ai');
  assert.equal(resolved.startDate.merge, 'ai');
  assert.equal(resolved.ticketUrl.merge, 'ai');
  assert.equal(resolved.bar.merge, 'preserve', 'explicit fieldPriorities override the ai default');
  assert.equal(resolved.shortName.merge, 'clobber', 'metadata-inferred fields stay clobber');
});

test('createFinalEventObject applies verbatim-validated AI picks in ONE batched request', async () => {
  const core = createCore();
  const { scraped, existing } = buildArbitrationPair();
  const adapter = buildArbitrationAdapter({
    title: { pick: 'scraped', value: 'FURBALL DALLAS', reason: 'more specific' },
    bar: { pick: 'calendar', value: 'STATION 4', reason: 'official venue name' },
    startDate: { pick: 'scraped', value: '2026-07-05T22:00:00.000Z', reason: 'flyer time' }
  });

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 1, 'all conflicts must batch into one AI request');
  assert.match(adapter.calls[0].prompt, /2026-07-05T22:00:00\.000Z/, 'dates are serialized as ISO in the prompt');
  assert.equal(finalEvent.title, 'FURBALL DALLAS');
  assert.equal(finalEvent.bar, 'STATION 4', 'AI picked the calendar value');
  assert.ok(finalEvent.startDate instanceof Date, 'winner keeps its original Date type');
  assert.equal(finalEvent.startDate.toISOString(), '2026-07-05T22:00:00.000Z');
  // Notes round-trip: the arbitrated bar survives formatEventNotes/parseNotesIntoFields
  assert.equal(core.parseNotesIntoFields(finalEvent.notes).bar, 'STATION 4');
  assert.deepEqual(finalEvent._original.aiArbitration.arbitrated.sort(), ['bar', 'startDate', 'title']);
  assert.deepEqual(finalEvent._original.aiArbitration.fallbacks, []);
});

test('hallucinated or missing AI answers fall back to the scraped value (clobber)', async () => {
  const core = createCore();
  const { scraped, existing } = buildArbitrationPair();
  // bar: value matches NEITHER candidate → reject; title/startDate absent → fallback
  const adapter = buildArbitrationAdapter({
    bar: { pick: 'calendar', value: 'STATION FOUR', reason: 'made up' }
  });

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(finalEvent.bar, 'S4', 'hallucinated answer falls back to scraped');
  assert.equal(finalEvent.title, 'FURBALL DALLAS');
  assert.equal(finalEvent.startDate.toISOString(), '2026-07-05T22:00:00.000Z');
  assert.deepEqual(finalEvent._original.aiArbitration.arbitrated, []);
  assert.deepEqual(finalEvent._original.aiArbitration.fallbacks.sort(), ['bar', 'startDate', 'title']);
});

test('a verbatim value with a wrong pick label is trusted via the value', async () => {
  const core = createCore();
  const { scraped, existing } = buildArbitrationPair();
  // pick says scraped but the value verbatim-equals the CALENDAR candidate
  const adapter = buildArbitrationAdapter({
    title: { pick: 'scraped', value: 'FURBALL DALLAS' },
    bar: { pick: 'scraped', value: 'STATION 4' },
    startDate: { pick: 'scraped', value: '2026-07-05T22:00:00.000Z' }
  });

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  assert.equal(finalEvent.bar, 'STATION 4', 'the verbatim-matched candidate wins despite the mislabeled pick');
});

test('AI failure degrades to exactly the clobber behavior', async () => {
  const core = createCore();
  const { scraped, existing } = buildArbitrationPair();
  const adapter = buildArbitrationAdapter({}, { fail: true });

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(finalEvent.title, 'FURBALL DALLAS');
  assert.equal(finalEvent.bar, 'S4');
  assert.equal(finalEvent.startDate.toISOString(), '2026-07-05T22:00:00.000Z');
  assert.equal(finalEvent._original.aiArbitration.fallbacks.length, 3);
});

test('no adapter or arbitrateMerges:false means zero AI requests', async () => {
  const core = createCore();

  const noAdapter = buildArbitrationPair();
  const finalNoAdapter = await core.createFinalEventObject(noAdapter.existing, noAdapter.scraped, {});
  assert.equal(finalNoAdapter.bar, 'S4', 'falls back to scraped without an adapter');

  const optedOut = buildArbitrationPair();
  optedOut.scraped._parserConfig.ai.arbitrateMerges = false;
  const adapter = buildArbitrationAdapter({
    bar: { pick: 'calendar', value: 'STATION 4' }
  });
  const finalOptedOut = await core.createFinalEventObject(optedOut.existing, optedOut.scraped, { httpAdapter: adapter });
  assert.equal(adapter.calls.length, 0, 'opt-out must not send AI requests');
  assert.equal(finalOptedOut.bar, 'S4');
});

test('non-conflicts never reach the AI and keep clobber semantics', async () => {
  const core = createCore();
  const { scraped, existing } = buildArbitrationPair();
  // Remove all genuine conflicts: align title/bar/startDate, add a scraped-only field
  existing.title = scraped.title;
  existing.startDate = new Date(scraped.startDate.getTime());
  existing.notes = existing.notes.replace('bar: STATION 4', 'bar: S4');
  scraped.cover = '$10';
  const adapter = buildArbitrationAdapter({});

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 0, 'no conflicts → no AI request');
  assert.equal(finalEvent.cover, '$10', 'one-sided fields are added via clobber semantics');
});

// ---------------------------------------------------------------------------
// Geo-provenance merge: pinSource/addressSource follow the finalized value,
// deterministically and never via AI (calendar-is-database, no mislabeling).
// ---------------------------------------------------------------------------

// address uses clobber so the merge stays fully deterministic (no AI) — the
// provenance logic must never depend on arbitration.
const PROVENANCE_PRIORITIES = { address: { merge: 'clobber' } };

test('merge: a fresh scraped pin that wins carries the scrape pinSource/addressSource', async () => {
  const core = createCore();
  const adapter = buildArbitrationAdapter({});
  const scraped = {
    title: 'FURBALL', city: 'dallas', source: 'ai-web', _fieldPriorities: PROVENANCE_PRIORITIES,
    location: '32.8105, -96.8110', address: '3911 Cedar Springs Rd, Dallas',
    pinSource: 'geocoded-exact', addressSource: 'page'
  };
  const existing = {
    title: 'FURBALL', location: '32.7000, -96.7000', url: '',
    notes: ['address: 100 Old Rd, Dallas', 'pinSource: page', 'addressSource: page'].join('\n')
  };

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 0, 'provenance never triggers an AI request');
  assert.equal(finalEvent.location, '32.8105, -96.8110', 'the fresh pin wins (address changed)');
  assert.equal(finalEvent.pinSource, 'geocoded-exact', 'pinSource follows the fresh scraped pin');
  assert.equal(finalEvent.addressSource, 'page', 'addressSource follows the fresh scraped address');
  const parsed = core.parseNotesIntoFields(finalEvent.notes);
  assert.equal(parsed.pinSource, 'geocoded-exact');
  assert.equal(parsed.addressSource, 'page');
});

test('merge: a kept calendar pin (address unchanged) keeps the calendar stored sources, never relabeled', async () => {
  const core = createCore();
  const adapter = buildArbitrationAdapter({});
  // Fresh geocode DIFFERS from the stored (curated) pin; the scrape brought no
  // address, so the calendar address is kept → address unchanged → pin kept.
  const scraped = {
    title: 'FURBALL', city: 'dallas', source: 'ai-web', _fieldPriorities: PROVENANCE_PRIORITIES,
    location: '32.9999, -96.9999', pinSource: 'geocoded-approx'
  };
  const existing = {
    title: 'FURBALL', location: '32.7000, -96.7000', url: '',
    notes: ['address: 100 Old Rd, Dallas', 'pinSource: curated', 'addressSource: curated'].join('\n')
  };

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 0, 'provenance never triggers an AI request');
  assert.equal(finalEvent.location, '32.7000, -96.7000', 'the calendar pin is kept');
  assert.equal(finalEvent.pinSource, 'curated', 'kept calendar pin keeps its stored pinSource, not the fresh geocode label');
  assert.equal(finalEvent.addressSource, 'curated', 'kept calendar address keeps its stored addressSource');
});

test('merge: a kept calendar pin with NO stored source leaves the merged source absent (hand-fix not mislabeled)', async () => {
  const core = createCore();
  const adapter = buildArbitrationAdapter({});
  // Hand-fixed calendar pin (no pinSource on record); the fresh geocode differs
  // and the address is unchanged → the calendar pin is kept.
  const scraped = {
    title: 'FURBALL', city: 'dallas', source: 'ai-web', _fieldPriorities: PROVENANCE_PRIORITIES,
    location: '32.9999, -96.9999', pinSource: 'geocoded-approx'
  };
  const existing = {
    title: 'FURBALL', location: '32.7000, -96.7000', url: '',
    notes: 'address: 100 Old Rd, Dallas'
  };

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 0, 'provenance never triggers an AI request');
  assert.equal(finalEvent.location, '32.7000, -96.7000', 'the hand-fixed calendar pin is kept');
  assert.equal(finalEvent.pinSource, undefined, 'no fresh geocode label is stamped onto a pin we kept but did not produce');
  assert.ok(!/pinSource/.test(finalEvent.notes), 'no pinSource line is written to the notes');
});

test('same-instant Date vs ISO string is not a conflict; differing instants are', () => {
  const core = createCore();
  assert.equal(
    core.isGenuineFieldConflict('startDate', new Date('2026-07-05T21:00:00.000Z'), '2026-07-05T21:00:00.000Z'),
    false
  );
  assert.equal(
    core.isGenuineFieldConflict('startDate', new Date('2026-07-05T21:00:00.000Z'), new Date('2026-07-05T22:00:00.000Z')),
    true
  );
  assert.equal(core.isGenuineFieldConflict('bar', 'S4', ''), false, 'empty side is never a conflict');
  assert.equal(core.isGenuineFieldConflict('coordinates', { lat: 1 }, { lat: 2 }), false, 'non-primitives are ineligible');
});

test('mergeParsedEvents: decisive priority skips AI, non-decisive conflicts consult it', async () => {
  const core = createCore();
  const priorities = {
    bar: { priority: ['static', 'ai-web'], merge: 'ai' },
    title: { priority: ['ai-web'], merge: 'ai' }
  };
  const aiParserConfig = { ai: { provider: 'ollama', endpoint: 'http://ai.example', model: 'm' } };

  // Different sources: the priority arrays decide everything — zero AI requests
  const staticExisting = { title: 'FURBALL', bar: 'STATION 4', source: 'static', _fieldPriorities: priorities };
  const aiIncoming = { title: 'FURBALL DALLAS', bar: 'S4', source: 'ai-web', _parserConfig: aiParserConfig, _fieldPriorities: priorities };
  const decisiveAdapter = buildArbitrationAdapter({});
  const decisiveMerge = await core.mergeParsedEvents(staticExisting, aiIncoming, { httpAdapter: decisiveAdapter });
  assert.equal(decisiveAdapter.calls.length, 0, 'decisive priority fields must not be arbitrated');
  assert.equal(decisiveMerge.bar, 'STATION 4', 'static outranks ai-web for bar');
  assert.equal(decisiveMerge.title, 'FURBALL DALLAS', 'only-listed source wins for title');

  // Same source (duplicate from the same parser): same priority index → AI decides
  const existing = { title: 'FURBALL', bar: 'STATION 4', source: 'ai-web', _fieldPriorities: priorities };
  const incoming = { title: 'FURBALL DALLAS', bar: 'S4', source: 'ai-web', _parserConfig: aiParserConfig, _fieldPriorities: priorities };
  const adapter = buildArbitrationAdapter({
    title: { pick: 'existing', value: 'FURBALL', reason: 'canonical name' },
    bar: { pick: 'incoming', value: 'S4', reason: 'newer listing' }
  });
  const merged = await core.mergeParsedEvents(existing, incoming, { httpAdapter: adapter });
  assert.equal(adapter.calls.length, 1, 'all same-priority conflicts batch into one request');
  assert.equal(merged.title, 'FURBALL', 'AI decided the same-priority conflict');
  assert.equal(merged.bar, 'S4');

  // AI failure on a same-priority conflict → preserves existing (today's behavior)
  const failingAdapter = buildArbitrationAdapter({}, { fail: true });
  const mergedFallback = await core.mergeParsedEvents(existing, incoming, { httpAdapter: failingAdapter });
  assert.equal(mergedFallback.title, 'FURBALL', 'same-priority fallback preserves existing');
  assert.equal(mergedFallback.bar, 'STATION 4', 'same-priority fallback preserves existing');
});

// ---------------------------------------------------------------------------
// Deterministic pre-arbitration guardrails (🔒)
// ---------------------------------------------------------------------------

// Arbitration pair with title/bar/startDate aligned so each guardrail test can
// introduce exactly the conflicts it needs.
function buildAlignedArbitrationPair() {
  const { scraped, existing } = buildArbitrationPair();
  existing.title = scraped.title;
  existing.startDate = new Date(scraped.startDate.getTime());
  existing.notes = existing.notes.replace('bar: STATION 4', 'bar: S4');
  return { scraped, existing };
}

test('guardrail: same-host root URL never beats the deeper path — zero AI calls', async () => {
  const core = createCore();
  const { scraped, existing } = buildAlignedArbitrationPair();
  // Observed production shape: the model picked the domain root over the event page
  scraped.website = 'https://bearracuda.com/';
  existing.notes += '\nwebsite: https://www.bearracuda.com/events/portland-pridefriday/';
  const adapter = buildArbitrationAdapter({});

  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let finalEvent;
  try {
    finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  } finally {
    console.log = originalLog;
  }

  assert.equal(adapter.calls.length, 0, 'the only conflict resolved deterministically — no AI request at all');
  assert.equal(finalEvent.website, 'https://www.bearracuda.com/events/portland-pridefriday/',
    'the winner keeps its original untouched value (www + trailing slash preserved)');
  assert.deepEqual(finalEvent._original.aiArbitration.deterministic, ['website']);
  assert.deepEqual(finalEvent._original.aiArbitration.fallbacks, [], 'resolved, not a fallback');
  const record = finalEvent._mergeDecisions.find(decision => decision.field === 'website');
  assert.equal(record.source, 'deterministic');
  assert.equal(record.reason, 'same-host deeper URL beats domain root');
  assert.ok(logLines.includes(
    '🔒 MERGE: "FURBALL DALLAS" field=website resolved deterministically — same-host deeper URL beats domain root'
  ), `stable 🔒 log line expected, got: ${JSON.stringify(logLines)}`);
});

test('guardrail: deterministic field is excluded from the AI batch; genuine conflicts still arbitrate', async () => {
  const core = createCore();
  const { scraped, existing } = buildArbitrationPair(); // title/bar/startDate conflicts remain
  scraped.website = 'https://bearracuda.com/events/portland-pridefriday/';
  existing.notes += '\nwebsite: https://bearracuda.com/';
  const adapter = buildArbitrationAdapter({
    title: { pick: 'scraped', value: 'FURBALL DALLAS' },
    bar: { pick: 'calendar', value: 'STATION 4' },
    startDate: { pick: 'scraped', value: '2026-07-05T22:00:00.000Z' }
  });

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 1, 'the genuine conflicts still batch into one AI request');
  assert.match(adapter.calls[0].prompt, /field: title/);
  assert.ok(!adapter.calls[0].prompt.includes('website'), 'deterministically resolved fields must not reach the prompt');
  assert.ok(!adapter.calls[0].prompt.includes('portland-pridefriday'));
  assert.equal(finalEvent.website, 'https://bearracuda.com/events/portland-pridefriday/', 'scraped deep URL wins over the calendar root');
  assert.deepEqual(finalEvent._original.aiArbitration.deterministic, ['website']);
  assert.deepEqual(finalEvent._original.aiArbitration.arbitrated.sort(), ['bar', 'startDate', 'title']);
});

test('guardrail: cross-host root-vs-deep website resolves deterministically — event page beats bare homepage', async () => {
  const core = createCore();
  const { scraped, existing } = buildAlignedArbitrationPair();
  scraped.website = 'https://ticketmaster.com/';
  existing.notes += '\nwebsite: https://bearracuda.com/events/portland-pridefriday/';
  const adapter = buildArbitrationAdapter({});

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 0, 'a bare homepage never beats an event page, even cross-host');
  assert.equal(finalEvent.website, 'https://bearracuda.com/events/portland-pridefriday/');
  assert.deepEqual(finalEvent._original.aiArbitration.deterministic, ['website']);
});

test('guardrail: same-host deep-vs-deep and root-vs-root URLs still go to the AI', () => {
  const core = createCore();
  assert.equal(
    core.resolveConflictDeterministically('ticketUrl',
      'https://bearracuda.com/events/portland/', 'https://bearracuda.com/tickets/portland/'),
    null, 'both deep → arbitrate');
  assert.equal(
    core.resolveConflictDeterministically('website',
      'https://bearracuda.com/', 'http://www.bearracuda.com'),
    null, 'both root → arbitrate');
  assert.equal(
    core.resolveConflictDeterministically('website',
      'https://bearracuda.com/', 'https://bearracuda.com/?p=1'),
    null, 'a query-only URL is not a deeper path');
});

test('guardrail: "New Orleans" vs "New Orleans⚜️" keeps the emoji title without AI', async () => {
  const core = createCore();
  const { scraped, existing } = buildAlignedArbitrationPair();
  scraped.title = 'New Orleans';
  existing.title = 'New Orleans⚜️';
  const adapter = buildArbitrationAdapter({});

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 0, 'an emoji-stripped twin is not a conflict');
  assert.equal(finalEvent.title, 'New Orleans⚜️', 'calendar emoji titles are canonical');
  assert.deepEqual(finalEvent._original.aiArbitration.deterministic, ['title']);
});

test('guardrail: emoji twin detection covers ⚜️, ⚓ and ⛓️ in both directions', () => {
  const core = createCore();
  const twins = [
    ['New Orleans⚜️', 'New Orleans'],
    ['Anchor Bear Night ⚓', 'Anchor Bear Night'],
    ['CHAINED⛓️', 'CHAINED']
  ];
  for (const [emojiTitle, plainTitle] of twins) {
    assert.deepEqual(
      core.resolveConflictDeterministically('title', emojiTitle, plainTitle),
      { winner: 'a', reason: 'emoji title variant beats its emoji-stripped twin' });
    assert.deepEqual(
      core.resolveConflictDeterministically('title', plainTitle, emojiTitle),
      { winner: 'b', reason: 'emoji title variant beats its emoji-stripped twin' });
  }
  // Real text differences (and case differences) still arbitrate; ASCII is never stripped
  assert.equal(core.resolveConflictDeterministically('title', 'FURBALL', 'FURBALL DALLAS'), null);
  assert.equal(core.resolveConflictDeterministically('title', 'New Orleans⚜️', 'NEW ORLEANS'), null, 'case-sensitive otherwise');
  assert.equal(core.resolveConflictDeterministically('title', 'Bear-Night!', 'BearNight!'), null, 'ASCII punctuation is real text');
  assert.equal(core.resolveConflictDeterministically('title', '🐻', '⚓'), null, 'pure-emoji titles are not twins');
});

test('guardrail: a dateless title beats its dated twin in both directions; both dated or different names fall through', () => {
  const core = createCore();
  assert.deepEqual(
    core.resolveConflictDeterministically('title', 'CHUNK Chicago - September 19th', 'CHUNK Chicago'),
    { winner: 'b', reason: 'date-only suffix is redundant, kept the dateless title' });
  assert.deepEqual(
    core.resolveConflictDeterministically('title', 'CHUNK DORE ALLEY', 'CHUNK DORE ALLEY - Saturday July 25th'),
    { winner: 'a', reason: 'date-only suffix is redundant, kept the dateless title' });
  // Both candidates dated → a genuine question, falls through to existing behavior
  assert.equal(core.resolveConflictDeterministically('title', 'CHUNK - July 25th', 'CHUNK - Jul 25'), null,
    'both dated → arbitrate');
  // Genuinely different base names keep existing behavior
  assert.equal(core.resolveConflictDeterministically('title', 'CHUNK Chicago - September 19th', 'CHUNK Portland'), null,
    'different names → arbitrate');
  // Edition years attached to words are not date segments
  assert.equal(core.resolveConflictDeterministically('title', 'DECADENCE 2026', 'DECADENCE'), null,
    'a bare year is part of the name, not a date segment');
});

test('guardrail: dated vs dateless same-name title resolves without AI, with the stable 🔒 line', async () => {
  const core = createCore();
  const { scraped, existing } = buildAlignedArbitrationPair();
  existing.title = 'CHUNK Chicago - September 19th';
  scraped.title = 'CHUNK Chicago';
  const adapter = buildArbitrationAdapter({});

  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let finalEvent;
  try {
    finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  } finally {
    console.log = originalLog;
  }

  assert.equal(adapter.calls.length, 0, 'a redundant date suffix is not a conflict — zero AI requests');
  assert.equal(finalEvent.title, 'CHUNK Chicago', 'the dateless title wins');
  assert.deepEqual(finalEvent._original.aiArbitration.deterministic, ['title']);
  assert.ok(logLines.includes(
    '🔒 MERGE: "CHUNK Chicago" field=title resolved deterministically — date-only suffix is redundant, kept the dateless title'
  ), `stable 🔒 log line expected, got: ${JSON.stringify(logLines)}`);
});

// ---------------------------------------------------------------------------
// url/website canonicalization (ONE logical field: website is canonical and
// round-trips via the "website:" notes line; url is an output view of it) and
// honest clobber logging (same-instant Dates are not "clobbered")
// ---------------------------------------------------------------------------

test('url/website are one field: a scraped url persists as website and goes quiet on re-run', async () => {
  const core = createCore();
  const { scraped, existing } = buildAlignedArbitrationPair();
  const detailUrl = 'https://bearracuda.com/events/dallas-freedom-tea/';
  scraped.url = detailUrl; // parser found no separate website
  existing.url = ''; // Scriptable can never read the native CalendarEvent.url

  const firstRun = await core.createFinalEventObject(existing, scraped, {});
  assert.equal(firstRun.website, detailUrl, 'the scraped url folds into the canonical website field');
  assert.equal(firstRun.url, detailUrl, 'url is a view of the merged website');
  assert.equal(core.parseNotesIntoFields(firstRun.notes).website, detailUrl,
    'the url round-trips through the website: notes line');
  assert.ok(!/^url:/m.test(firstRun.notes), 'notes never carry a separate url: line');
  assert.ok(firstRun._changes.includes('url'), 'the first run legitimately flags the newly stored website');

  // Re-run with identical scraped data against the saved notes (Scriptable
  // read-back: the native url is still empty) — everything must go quiet.
  const readBack = { ...existing, notes: firstRun.notes, url: '' };
  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let secondRun;
  try {
    secondRun = await core.createFinalEventObject(readBack, scraped, {});
  } finally {
    console.log = originalLog;
  }

  assert.equal(secondRun.url, detailUrl);
  assert.ok(!secondRun._changes.includes('url'), 'an identical re-scrape must not flag url');
  assert.ok(!secondRun._changes.includes('notes'), 'notes are stable across identical runs');
  assert.ok(!logLines.some(line => line.startsWith('🔄 MERGE:')),
    `no clobber log on an identical re-run, got: ${JSON.stringify(logLines)}`);
});

test('url/website: a real scraped website wins over the detail url and nothing churns', async () => {
  const core = createCore();
  const { scraped, existing } = buildAlignedArbitrationPair();
  scraped.url = 'https://tickets.example/detail/123';
  scraped.website = 'https://furball.nyc/'; // page metadata website — url must not displace it
  existing.notes += '\ndescription: FURBALL PRESENTS\nwebsite: https://furball.nyc/';
  existing.url = '';

  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let finalEvent;
  try {
    finalEvent = await core.createFinalEventObject(existing, scraped, {});
  } finally {
    console.log = originalLog;
  }

  assert.equal(finalEvent.website, 'https://furball.nyc/');
  assert.equal(finalEvent.url, 'https://furball.nyc/', 'the url view mirrors the canonical website');
  assert.equal(core.parseNotesIntoFields(finalEvent.notes).website, 'https://furball.nyc/');
  assert.ok(!/^url:/m.test(finalEvent.notes), 'no url: line even when the scrape carried both fields');
  assert.ok(!finalEvent._changes.includes('url'), 'matching stored website → url never flagged');
  assert.ok(!logLines.some(line => line.startsWith('🔄 MERGE:')),
    `url must not be merged/clobbered as its own field, got: ${JSON.stringify(logLines)}`);
});

test('clobber tracking: same-instant Date objects are not reported clobbered; differing instants are', async () => {
  const core = createCore();
  const buildExisting = () => ({
    title: 'FURBALL',
    startDate: new Date('2026-07-05T22:00:00.000Z'),
    endDate: new Date('2026-07-06T02:00:00.000Z'),
    url: '',
    notes: ''
  });
  const scraped = {
    title: 'FURBALL',
    startDate: new Date('2026-07-05T22:00:00.000Z'), // fresh objects, same instants
    endDate: new Date('2026-07-06T02:00:00.000Z'),
    source: 'ai-web',
    _fieldPriorities: { startDate: { merge: 'clobber' }, endDate: { merge: 'clobber' } }
  };

  const capture = async (existingEvent, scrapedEvent) => {
    const logLines = [];
    const originalLog = console.log;
    console.log = (message) => { logLines.push(String(message)); };
    try {
      await core.createFinalEventObject(existingEvent, scrapedEvent, {});
    } finally {
      console.log = originalLog;
    }
    return logLines;
  };

  const quietLines = await capture(buildExisting(), scraped);
  assert.ok(!quietLines.some(line => line.startsWith('🔄 MERGE:')),
    `identical instants must not count as clobbered, got: ${JSON.stringify(quietLines)}`);

  const scrapedLater = { ...scraped, startDate: new Date('2026-07-05T23:00:00.000Z') };
  const clobberLines = await capture(buildExisting(), scrapedLater);
  const clobberLog = clobberLines.find(line => line.startsWith('🔄 MERGE:'));
  assert.ok(clobberLog, `a genuinely different instant is still reported, got: ${JSON.stringify(clobberLines)}`);
  assert.match(clobberLog, /clobbered 1 field \(startDate\)/);
});

// ---------------------------------------------------------------------------
// Bare-city titles (2026-07-12 run: bearracuda.com pages are named after the
// city — "New Orleans⚜️ | BEARRACUDA" → brand strip leaves just the city)
// ---------------------------------------------------------------------------

const CITY_TITLE_CITIES = {
  nola: { timezone: 'America/Chicago', patterns: ['new orleans', 'nola'] },
  ptown: { timezone: 'America/New_York', patterns: ['provincetown', 'ptown'] },
  sf: { timezone: 'America/Los_Angeles', name: 'San Francisco', patterns: ['sf'] },
  'new-york': { timezone: 'America/New_York', patterns: [] },
  portland: { timezone: 'America/Los_Angeles', patterns: ['portland', 'pdx'] },
  chicago: { timezone: 'America/Chicago', patterns: ['chicago'] },
  atlanta: { timezone: 'America/New_York', patterns: ['atlanta'] }
};

function createCityTitleCore() {
  return new SharedCore(CITY_TITLE_CITIES, { eventSchema: EventSchema });
}

test('isCityOnlyTitle matches key, display name, patterns, and emoji variants — whole title only', () => {
  const core = createCityTitleCore();
  // Key, patterns, and case-folding
  assert.equal(core.isCityOnlyTitle('nola', 'nola'), true, 'the city key itself');
  assert.equal(core.isCityOnlyTitle('New Orleans', 'nola'), true, 'configured pattern');
  assert.equal(core.isCityOnlyTitle('NOLA', 'nola'), true, 'pattern is case-folded');
  assert.equal(core.isCityOnlyTitle('  new   orleans ', 'nola'), true, 'whitespace collapsed');
  // Emoji/pictograph variants
  assert.equal(core.isCityOnlyTitle('New Orleans⚜️', 'nola'), true, 'emoji is stripped before matching');
  assert.equal(core.isCityOnlyTitle('Provincetown⚓', 'ptown'), true);
  // Display name and dashed keys read as spaces
  assert.equal(core.isCityOnlyTitle('San Francisco', 'sf'), true, 'display name counts');
  assert.equal(core.isCityOnlyTitle('New York', 'new-york'), true, 'key dashes read as spaces');
  // Whole-title match only: a title that merely CONTAINS the city is a real name
  assert.equal(core.isCityOnlyTitle('Hot Take Portland', 'portland'), false);
  assert.equal(core.isCityOnlyTitle('Treasure Trail Chicago', 'chicago'), false);
  assert.equal(core.isCityOnlyTitle('Atlanta 17 Year', 'atlanta'), false);
  assert.equal(core.isCityOnlyTitle('Bearracuda Atlanta 17 Year Anniversary', 'atlanta'), false);
  // Defensive: unknown/missing city or empty title is never city-only
  assert.equal(core.isCityOnlyTitle('Denver', 'denver'), false, 'unknown city key');
  assert.equal(core.isCityOnlyTitle('New Orleans', ''), false, 'missing city key');
  assert.equal(core.isCityOnlyTitle('', 'nola'), false, 'empty title');
  assert.equal(core.isCityOnlyTitle('⚜️', 'nola'), false, 'pure-emoji title strips to nothing');
});

test('guardrail: a named title beats a bare city title in both directions; ties still arbitrate', () => {
  const core = createCityTitleCore();
  const context = { cityKey: 'nola' };
  assert.deepEqual(
    core.resolveConflictDeterministically('title', 'BEARRACUDA: New Orleans⚜️', 'New Orleans⚜️', context),
    { winner: 'a', reason: 'named title beats bare city title' });
  assert.deepEqual(
    core.resolveConflictDeterministically('title', 'New Orleans⚜️', 'BEARRACUDA: New Orleans⚜️', context),
    { winner: 'b', reason: 'named title beats bare city title' });
  // Emoji-twin rule runs FIRST: two city-only twins keep the emoji variant
  assert.deepEqual(
    core.resolveConflictDeterministically('title', 'New Orleans⚜️', 'New Orleans', context),
    { winner: 'a', reason: 'emoji title variant beats its emoji-stripped twin' });
  // Two named titles (or two bare-city titles) are still a genuine question
  assert.equal(core.resolveConflictDeterministically('title', 'FURBALL', 'MEGAWOOF', context), null);
  assert.equal(core.resolveConflictDeterministically('title', 'New Orleans⚜️', 'NOLA', context), null,
    'two bare-city variants still arbitrate');
  // No city context → the rule never fires
  assert.equal(core.resolveConflictDeterministically('title', 'FURBALL', 'New Orleans'), null);
});

test('guardrail: title doctrine — the venue-bearing title loses to the venue-free named title (Singlet pair, run 20260725-170926)', () => {
  const core = createCore();
  const venueTitle = "Thighs out for the guys yall, it's Singlet Night at the Dallas Eagle";
  const freeTitle = 'Singlet Night with DJ Drew G';
  const context = { barNames: ['Dallas Eagle', 'Dallas Eagle'], sideLabels: { a: 'existing', b: 'incoming' } };
  assert.deepEqual(
    core.resolveConflictDeterministically('title', venueTitle, freeTitle, context),
    { winner: 'b', reason: 'title doctrine: venue name belongs in bar, not title' });
  assert.deepEqual(
    core.resolveConflictDeterministically('title', freeTitle, venueTitle, context),
    { winner: 'a', reason: 'title doctrine: venue name belongs in bar, not title' });
  // Calendar merges are exempt: calendar titles are curated-by-usage
  assert.equal(
    core.resolveConflictDeterministically('title', venueTitle, freeTitle,
      { barNames: ['Dallas Eagle', 'Dallas Eagle'], sideLabels: { a: 'calendar', b: 'scraped' } }),
    null, 'calendar flow falls through to AI');
  // Full-key containment only: "Eagle Karaoke" does NOT contain "dallaseagle"
  assert.equal(
    core.resolveConflictDeterministically('title', 'Eagle Karaoke', 'Karaoke with Dee Ranged', context),
    null, 'a venue stem is never venue containment');
  // Both titles carrying the venue → a genuine question
  assert.equal(
    core.resolveConflictDeterministically('title',
      'Singlet Night at the Dallas Eagle', 'Dallas Eagle Singlet Night', context),
    null, 'both venue-bearing → arbitrate');
  // The venue-free side must still have a significant token of its own
  assert.equal(
    core.resolveConflictDeterministically('title', 'Karaoke at the Dallas Eagle', 'Eagle', context),
    null, 'a venue-token-only title cannot win the rung');
  // Short keys never fire: normalizeBarNameKey("TMC") is under 4 chars
  assert.equal(
    core.resolveConflictDeterministically('title', 'Bear Night at TMC', 'Bear Night with DJ Boost',
      { barNames: ['TMC'], sideLabels: { a: 'existing', b: 'incoming' } }),
    null, 'venue keys shorter than 4 chars are ignored');
});

test('guardrail: calendar bare-city title loses to the scraped named title without AI', async () => {
  const core = createCore(); // dallas cities config — 'Dallas' is city-only
  const { scraped, existing } = buildAlignedArbitrationPair();
  scraped.title = 'BEARRACUDA: Dallas';
  existing.title = 'Dallas';
  const adapter = buildArbitrationAdapter({});

  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let finalEvent;
  try {
    finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  } finally {
    console.log = originalLog;
  }

  assert.equal(adapter.calls.length, 0, 'the only conflict resolved deterministically — no AI request at all');
  assert.equal(finalEvent.title, 'BEARRACUDA: Dallas');
  assert.deepEqual(finalEvent._original.aiArbitration.deterministic, ['title']);
  assert.ok(logLines.includes(
    '🔒 MERGE: "BEARRACUDA: Dallas" field=title resolved deterministically — named title beats bare city title'
  ), `stable 🔒 log line expected, got: ${JSON.stringify(logLines)}`);
});

test('guardrail: scraped bare-city title loses to the calendar named title without AI', async () => {
  const core = createCore();
  const { scraped, existing } = buildAlignedArbitrationPair();
  scraped.title = 'Dallas';
  existing.title = 'FURBALL DALLAS';
  const adapter = buildArbitrationAdapter({});

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 0, 'zero AI calls when the city rule decides the only conflict');
  assert.equal(finalEvent.title, 'FURBALL DALLAS', 'the named calendar title wins');
  assert.deepEqual(finalEvent._original.aiArbitration.deterministic, ['title']);
});

test('mergeParsedEvents: named-vs-bare-city titles resolve deterministically in both directions', async () => {
  const core = createCityTitleCore();
  const priorities = { title: { priority: ['ai-web'], merge: 'ai' } };
  const aiParserConfig = { ai: { provider: 'ollama', endpoint: 'http://ai.example', model: 'm' } };
  const base = { city: 'nola', source: 'ai-web', _fieldPriorities: priorities };

  // Incoming bare city vs existing named title
  const adapterA = buildArbitrationAdapter({});
  const mergedA = await core.mergeParsedEvents(
    { ...base, title: 'BEARRACUDA: New Orleans⚜️' },
    { ...base, title: 'New Orleans⚜️', _parserConfig: aiParserConfig },
    { httpAdapter: adapterA });
  assert.equal(adapterA.calls.length, 0, 'zero AI calls — the city rule decides');
  assert.equal(mergedA.title, 'BEARRACUDA: New Orleans⚜️');

  // Incoming named title vs existing bare city
  const adapterB = buildArbitrationAdapter({});
  const mergedB = await core.mergeParsedEvents(
    { ...base, title: 'New Orleans⚜️' },
    { ...base, title: 'BEARRACUDA: New Orleans⚜️', _parserConfig: aiParserConfig },
    { httpAdapter: adapterB });
  assert.equal(adapterB.calls.length, 0);
  assert.equal(mergedB.title, 'BEARRACUDA: New Orleans⚜️');

  // Two named titles remain a genuine AI question
  const adapterC = buildArbitrationAdapter({
    title: { pick: 'existing', value: 'FURBALL', reason: 'canonical name' }
  });
  const mergedC = await core.mergeParsedEvents(
    { ...base, title: 'FURBALL' },
    { ...base, title: 'MEGAWOOF', _parserConfig: aiParserConfig },
    { httpAdapter: adapterC });
  assert.equal(adapterC.calls.length, 1, 'two named titles still arbitrate');
  assert.equal(mergedC.title, 'FURBALL');
});

test('guardrail: logo-path image loses to event artwork in both directions; both-logo goes to AI', async () => {
  const core = createCore();
  const logo = 'https://res.cloudinary.com/eventservice/image/upload/w_600/saas/logos/image_abc.webp';
  const poster = 'https://bearracuda.com/wp-content/uploads/2026/05/45-3.png';
  assert.deepEqual(
    core.resolveConflictDeterministically('image', logo, poster),
    { winner: 'b', reason: 'event artwork beats logo-path image' });
  assert.deepEqual(
    core.resolveConflictDeterministically('image', poster, logo),
    { winner: 'a', reason: 'event artwork beats logo-path image' });
  const otherLogo = 'https://cdn.tickets.example/assets/logo/brand.png';
  assert.equal(core.resolveConflictDeterministically('image', logo, otherLogo), null, 'both logo-ish → arbitrate');
  assert.deepEqual(
    core.resolveConflictDeterministically('image', 'https://a.example/logo-banners/x.png', poster),
    { winner: 'b', reason: 'event artwork beats logo-path image' },
    'a path component merely containing "logo" counts');
  // "logo" in the hostname or query must NOT count
  assert.equal(
    core.resolveConflictDeterministically('image', 'https://logo.example/poster.png', 'https://bearracuda.com/poster2.png'),
    null, 'hostname is never matched');
  assert.equal(
    core.resolveConflictDeterministically('image', 'https://a.example/img.png?from=logos', 'https://b.example/img2.png'),
    null, 'querystring is never matched');

  // End-to-end: a scraped ticketing-service logo never beats the calendar poster
  const { scraped, existing } = buildAlignedArbitrationPair();
  scraped.image = logo;
  existing.notes += `\nimage: ${poster}`;
  const adapter = buildArbitrationAdapter({});
  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  assert.equal(adapter.calls.length, 0);
  assert.equal(finalEvent.image, poster);
  assert.deepEqual(finalEvent._original.aiArbitration.deterministic, ['image']);
});

// ---------------------------------------------------------------------------
// Deterministic image resolution rung: a URL advertising a clearly larger
// image wins without AI (the arbitration model contradicted itself between
// runs on exactly this shape). Near-ties and size-less URLs still arbitrate.
// ---------------------------------------------------------------------------

test('guardrail: clearly higher-resolution image URL wins in both directions without AI', async () => {
  const core = createCore();
  const hiRes = 'https://cdn.example.com/uploads/1920x1080/poster.jpg';
  const plain = 'https://bearracuda.com/wp-content/uploads/poster.jpg';
  assert.deepEqual(
    core.resolveConflictDeterministically('image', hiRes, plain),
    { winner: 'a', reason: 'clearly higher-resolution image URL' });
  assert.deepEqual(
    core.resolveConflictDeterministically('image', plain, hiRes),
    { winner: 'b', reason: 'clearly higher-resolution image URL' });
  // Query-param sizes rank on the same scale as the parser's OCR dedup
  assert.deepEqual(
    core.resolveConflictDeterministically('image',
      'https://cdn.example.com/img.jpg?w=1920&h=1080', 'https://cdn.example.com/thumbs/img.jpg?w=150&h=150'),
    { winner: 'a', reason: 'clearly higher-resolution image URL' });

  // End-to-end: zero AI calls on a deterministic resolution win
  const { scraped, existing } = buildAlignedArbitrationPair();
  scraped.image = hiRes;
  existing.notes += `\nimage: ${plain}`;
  const adapter = buildArbitrationAdapter({});
  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  assert.equal(adapter.calls.length, 0, 'a clear resolution margin never reaches the AI');
  assert.equal(finalEvent.image, hiRes);
  assert.deepEqual(finalEvent._original.aiArbitration.deterministic, ['image']);
});

test('guardrail: image URLs without a clear resolution margin still go to the AI', () => {
  const core = createCore();
  // Below the meaningful margin (no 2x, no +500) → arbitrate
  assert.equal(
    core.resolveConflictDeterministically('image',
      'https://cdn.example.com/img.jpg?w=800', 'https://cdn.example.com/img.jpg?w=700'),
    null, 'an 800-vs-700 width is a near-tie');
  // Neither URL advertises a size: the URL-length fallback is noise, never a 🔒 win
  assert.equal(
    core.resolveConflictDeterministically('image',
      'https://a.example/p.jpg',
      'https://cdn.other-host.example/wp-content/uploads/2026/05/some-quite-long-poster-file-name.jpg'),
    null, 'length-only scores decide nothing');
  // Equal scores → arbitrate (logo rule and case-only rule aside)
  assert.equal(
    core.resolveConflictDeterministically('image',
      'https://a.example/x/poster.jpg?w=900', 'https://b.example/y/poster.jpg?w=900'),
    null, 'equal advertised sizes still arbitrate');
});

// ---------------------------------------------------------------------------
// Image provenance rung: an image stamped as the event page's OWN artwork
// (imageSource og-image / jsonld at extraction) beats a merely page-derived
// candidate deterministically. Attribution is strict (the record's image must
// BE the candidate), both-og-grade / neither falls through to the resolution
// margin rung, and imageSource follows the winning value like pinSource.
// ---------------------------------------------------------------------------

test('guardrail: own-page artwork (og-image/jsonld) beats a page-sourced image; ambiguity falls through', () => {
  const core = createCore();
  const og = 'https://bearracuda.com/wp-content/uploads/2026/06/sausageweb.jpg';
  const page = 'https://static.wixstatic.com/media/8ff085_massiveparty~mv2.webp';
  const context = (recordA, recordB) => ({
    sideLabels: { a: 'existing', b: 'incoming' },
    records: { a: recordA, b: recordB }
  });

  // og-image beats page-sourced in both directions
  assert.deepEqual(
    core.resolveConflictDeterministically('image', og, page,
      context({ image: og, imageSource: 'og-image' }, { image: page, imageSource: 'page' })),
    { winner: 'a', reason: '"existing" image is the event page\'s own artwork (og-image)' });
  assert.deepEqual(
    core.resolveConflictDeterministically('image', page, og,
      context({ image: page, imageSource: 'page' }, { image: og, imageSource: 'og-image' })),
    { winner: 'b', reason: '"incoming" image is the event page\'s own artwork (og-image)' });

  // jsonld is og-grade too, and an entirely unstamped other side also loses
  assert.deepEqual(
    core.resolveConflictDeterministically('image', og, page,
      context({ image: og, imageSource: 'jsonld' }, { image: page })),
    { winner: 'a', reason: '"existing" image is the event page\'s own artwork (jsonld)' });

  // Both og-grade → no provenance edge; these URLs advertise no size → AI
  assert.equal(
    core.resolveConflictDeterministically('image', og, page,
      context({ image: og, imageSource: 'og-image' }, { image: page, imageSource: 'jsonld' })),
    null, 'both own-artwork candidates are a genuine question');

  // Neither og-grade → the existing resolution-margin rung still decides
  assert.deepEqual(
    core.resolveConflictDeterministically('image',
      'https://cdn.example.com/img.jpg?w=1920&h=1080', 'https://cdn.example.com/thumbs/img.jpg?w=150&h=150',
      context(
        { image: 'https://cdn.example.com/img.jpg?w=1920&h=1080', imageSource: 'page' },
        { image: 'https://cdn.example.com/thumbs/img.jpg?w=150&h=150', imageSource: 'page' })),
    { winner: 'a', reason: 'clearly higher-resolution image URL' });

  // Attribution caution: a record whose OWN image is not the candidate never
  // vouches for it — the stray og-image stamp decides nothing.
  assert.equal(
    core.resolveConflictDeterministically('image', og, page,
      context({ image: 'https://bearracuda.com/other.jpg', imageSource: 'og-image' },
        { image: page, imageSource: 'page' })),
    null, 'provenance only counts when the record\'s image field IS the candidate');

  // The logo rung stays ABOVE provenance: an og-stamped logo-path asset still loses
  const logo = 'https://res.cloudinary.com/eventservice/image/upload/saas/logos/image_abc.webp';
  assert.deepEqual(
    core.resolveConflictDeterministically('image', logo, page,
      context({ image: logo, imageSource: 'og-image' }, { image: page, imageSource: 'page' })),
    { winner: 'b', reason: 'event artwork beats logo-path image' });

  // No records context at all → fail open exactly as before
  assert.equal(core.resolveConflictDeterministically('image', og, page), null);
});

test('imageSource is never arbitration-eligible and round-trips through notes like pinSource', () => {
  const core = createCore();
  assert.equal(core.isArbitrationEligibleField('imageSource'), false);
  assert.equal(core.isArbitrationEligibleField('image'), true, 'the image VALUE itself still arbitrates');

  const notes = core.formatEventNotes({
    image: 'https://bearracuda.com/wp-content/uploads/2026/06/sausageweb.jpg',
    imageSource: 'og-image'
  });
  assert.match(notes, /imageSource: og-image/);
  const parsed = core.parseNotesIntoFields(notes);
  assert.equal(parsed.image, 'https://bearracuda.com/wp-content/uploads/2026/06/sausageweb.jpg');
  assert.equal(parsed.imageSource, 'og-image');
});

test('regression: bearracuda og-image artwork beats the massive.club page-sourced webp in BOTH merge flows', async () => {
  const core = createCore();
  const sausage = 'https://bearracuda.com/wp-content/uploads/2026/06/sausageweb.jpg';
  const webp = 'https://static.wixstatic.com/media/8ff085_massiveparty~mv2.webp';

  // Enrich direction (mergeParsedEvents), both orders — zero AI calls.
  const priorities = { image: { priority: ['ai-web'], merge: 'ai' } };
  const aiParserConfig = { ai: { provider: 'ollama', endpoint: 'http://ai.example', model: 'm' } };
  const base = {
    title: 'SAUSAGE PARTY', city: 'dallas', source: 'ai-web',
    startDate: new Date('2026-08-01T02:00:00.000Z'), _fieldPriorities: priorities
  };

  const adapterA = buildArbitrationAdapter({});
  const mergedA = await core.mergeParsedEvents(
    { ...base, image: webp, imageSource: 'page' },
    { ...base, image: sausage, imageSource: 'og-image', _parserConfig: aiParserConfig },
    { httpAdapter: adapterA });
  assert.equal(adapterA.calls.length, 0, 'own-page artwork resolves without AI');
  assert.equal(mergedA.image, sausage);
  assert.equal(mergedA.imageSource, 'og-image', 'imageSource follows the winning image');

  const adapterB = buildArbitrationAdapter({});
  const mergedB = await core.mergeParsedEvents(
    { ...base, image: sausage, imageSource: 'og-image' },
    { ...base, image: webp, imageSource: 'page', _parserConfig: aiParserConfig },
    { httpAdapter: adapterB });
  assert.equal(adapterB.calls.length, 0);
  assert.equal(mergedB.image, sausage);
  assert.equal(mergedB.imageSource, 'og-image',
    'the incoming base-spread stamp (page) is replaced by the winning side\'s');

  // A winning image with NO stamp leaves imageSource absent — the losing
  // side's stamp is never inherited (fail open, no mislabeling).
  const adapterE = buildArbitrationAdapter({});
  const mergedE = await core.mergeParsedEvents(
    { ...base, image: 'https://cdn.example.com/img.jpg?w=1920&h=1080' },
    { ...base, image: 'https://cdn.example.com/thumbs/img.jpg?w=150&h=150', imageSource: 'page', _parserConfig: aiParserConfig },
    { httpAdapter: adapterE });
  assert.equal(adapterE.calls.length, 0);
  assert.equal(mergedE.image, 'https://cdn.example.com/img.jpg?w=1920&h=1080');
  assert.equal(mergedE.imageSource, undefined, 'a winner with no stamp never inherits the loser\'s');

  // Calendar direction (createFinalEventObject), both sides — zero AI calls.
  const fresh = buildAlignedArbitrationPair();
  fresh.scraped.image = sausage;
  fresh.scraped.imageSource = 'og-image';
  fresh.existing.notes += `\nimage: ${webp}\nimageSource: page`;
  const adapterC = buildArbitrationAdapter({});
  const finalC = await core.createFinalEventObject(fresh.existing, fresh.scraped, { httpAdapter: adapterC });
  assert.equal(adapterC.calls.length, 0);
  assert.equal(finalC.image, sausage, 'the scraped own-artwork image wins');
  assert.equal(finalC.imageSource, 'og-image');
  assert.deepEqual(finalC._original.aiArbitration.deterministic, ['image']);
  const parsedNotes = core.parseNotesIntoFields(finalC.notes);
  assert.equal(parsedNotes.image, sausage);
  assert.equal(parsedNotes.imageSource, 'og-image', 'the stamp persists to notes for the next run');

  const stored = buildAlignedArbitrationPair();
  stored.scraped.image = webp;
  stored.scraped.imageSource = 'page';
  stored.existing.notes += `\nimage: ${sausage}\nimageSource: og-image`;
  const adapterD = buildArbitrationAdapter({});
  const finalD = await core.createFinalEventObject(stored.existing, stored.scraped, { httpAdapter: adapterD });
  assert.equal(adapterD.calls.length, 0);
  assert.equal(finalD.image, sausage, 'the calendar-stored own-artwork image is kept');
  assert.equal(finalD.imageSource, 'og-image', 'the notes-parsed calendar stamp participates and survives');
});

// ---------------------------------------------------------------------------
// Deterministic cross-host ticketUrl rung: a known ticketing-platform URL
// beats a bare non-ticketing domain root. Preference heuristic, not a gate —
// everything else falls through to AI exactly as before.
// ---------------------------------------------------------------------------

test('guardrail: ticketing-platform URL beats a bare non-ticketing domain root in both directions', async () => {
  const core = createCore();
  const ticketing = 'https://www.eventbrite.com/e/megawoof-dallas-tickets-1234';
  const bareRoot = 'https://megawoof.com/';
  assert.deepEqual(
    core.resolveConflictDeterministically('ticketUrl', ticketing, bareRoot),
    { winner: 'a', reason: 'ticketing-platform URL beats bare non-ticketing domain root' });
  assert.deepEqual(
    core.resolveConflictDeterministically('ticketUrl', bareRoot, ticketing),
    { winner: 'b', reason: 'ticketing-platform URL beats bare non-ticketing domain root' });
  // Subdomains of listed platforms count (events.ticketleap.com)
  assert.deepEqual(
    core.resolveConflictDeterministically('ticketUrl', 'https://events.ticketleap.com/venue/show', 'https://somebar.example'),
    { winner: 'a', reason: 'ticketing-platform URL beats bare non-ticketing domain root' });

  // End-to-end: zero AI calls on the deterministic win
  const { scraped, existing } = buildAlignedArbitrationPair();
  scraped.ticketUrl = ticketing;
  existing.notes = existing.notes.replace(
    'ticketUrl: https://tickets.example/furball',
    `ticketUrl: ${bareRoot}`);
  const adapter = buildArbitrationAdapter({});
  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  assert.equal(adapter.calls.length, 0, 'ticketing-vs-bare-root never reaches the AI');
  assert.equal(finalEvent.ticketUrl, ticketing);
  assert.deepEqual(finalEvent._original.aiArbitration.deterministic, ['ticketUrl']);
});

test('guardrail: conservative ticketUrl fall-throughs still go to the AI', () => {
  const core = createCore();
  // Non-ticketing candidate with a REAL path could itself be the event page
  assert.equal(
    core.resolveConflictDeterministically('ticketUrl',
      'https://www.eventbrite.com/e/megawoof-tickets-1234', 'https://megawoof.com/events/dec-31'),
    null, 'a non-ticketing event page is a genuine question');
  // A root with a query string is not a bare root
  assert.equal(
    core.resolveConflictDeterministically('ticketUrl',
      'https://www.eventbrite.com/e/megawoof-tickets-1234', 'https://megawoof.com/?event=123'),
    null, 'query-bearing roots are not bare');
  // Two ticketing platforms are a genuine question
  assert.equal(
    core.resolveConflictDeterministically('ticketUrl',
      'https://www.eventbrite.com/e/tickets-1234', 'https://dice.fm/event/abcdef'),
    null, 'both-ticketing still arbitrates');
  // The ticketing rung is ticketUrl-only: for website the same pair resolves
  // through the cross-host root-vs-deep rung instead, not the ticketing one
  assert.deepEqual(
    core.resolveConflictDeterministically('website',
      'https://www.eventbrite.com/e/tickets-1234', 'https://megawoof.com/'),
    { winner: 'a', reason: 'event-specific URL beats bare homepage' },
    'website is not a ticket field');
});

// ---------------------------------------------------------------------------
// Deterministic cross-host website/url rungs: an event-specific page beats a
// bare homepage across hosts; when both are pathed, the candidate whose host
// this run actually crawled (its own record's _sourcePageUrl) wins. Both
// bare roots, or unattributable pathed pairs, still arbitrate.
// ---------------------------------------------------------------------------

test('guardrail: cross-host website rungs — event page beats bare homepage, crawled host settles pathed pairs, roots arbitrate', () => {
  const core = createCore();
  // Rung 1: bare homepage vs event page, both directions, both aliases
  assert.deepEqual(
    core.resolveConflictDeterministically('website',
      'https://thedallaseagle.com/', 'https://www.eventbrite.com/e/singlet-night-tickets-1234'),
    { winner: 'b', reason: 'event-specific URL beats bare homepage' });
  assert.deepEqual(
    core.resolveConflictDeterministically('url',
      'https://www.eventbrite.com/e/singlet-night-tickets-1234', 'https://thedallaseagle.com/'),
    { winner: 'a', reason: 'event-specific URL beats bare homepage' });
  // Rung 2: both pathed — the candidate that IS its own record's crawled page wins
  const crawledContext = {
    records: {
      a: {
        website: 'https://thedallaseagle.com/events/singlet-night/',
        _sourcePageUrl: 'https://www.thedallaseagle.com/events'
      },
      b: { website: 'https://linktr.ee/dallaseagle/latest' }
    }
  };
  assert.deepEqual(
    core.resolveConflictDeterministically('website',
      'https://thedallaseagle.com/events/singlet-night/', 'https://linktr.ee/dallaseagle/latest', crawledContext),
    { winner: 'a', reason: 'URL is a page this run actually crawled' });
  // Attribution is strict: the record's own website/url must BE the candidate
  const unattributedContext = {
    records: {
      a: {
        website: 'https://thedallaseagle.com/some-other-page/',
        _sourcePageUrl: 'https://www.thedallaseagle.com/events'
      },
      b: { website: 'https://linktr.ee/dallaseagle/latest' }
    }
  };
  assert.equal(
    core.resolveConflictDeterministically('website',
      'https://thedallaseagle.com/events/singlet-night/', 'https://linktr.ee/dallaseagle/latest', unattributedContext),
    null, 'an unattributed candidate cannot claim its record\'s crawl');
  // Both bare roots on different hosts → a genuine question
  assert.equal(
    core.resolveConflictDeterministically('website', 'https://thedallaseagle.com/', 'https://megawoof.com/'),
    null, 'two bare homepages still arbitrate');
  // Both pathed with no records context → arbitrate as today
  assert.equal(
    core.resolveConflictDeterministically('website',
      'https://thedallaseagle.com/events/singlet-night/', 'https://linktr.ee/dallaseagle/latest'),
    null, 'both pathed without crawl attribution → arbitrate');
});

// ---------------------------------------------------------------------------
// Description strict-superset rule: the candidate containing the other's
// ENTIRE normalized text carries strictly more information — no AI needed.
// Partial overlap still arbitrates; equal pairs keep existing behavior.
// ---------------------------------------------------------------------------

test('guardrail: description strict superset wins in both directions (entities and whitespace normalized)', async () => {
  const core = createCore();
  const subset = 'It&rsquo;s the biggest bear party in Dallas &amp; beyond.';
  const superset = 'MEGAWOOF PRESENTS!  It’s the biggest   bear party in Dallas & beyond. Doors at 9PM.';
  assert.deepEqual(
    core.resolveConflictDeterministically('description', superset, subset),
    { winner: 'a', reason: 'description contains the other candidate\'s full text' });
  assert.deepEqual(
    core.resolveConflictDeterministically('description', subset, superset),
    { winner: 'b', reason: 'description contains the other candidate\'s full text' });

  // End-to-end: zero AI calls on the deterministic win
  const { scraped, existing } = buildAlignedArbitrationPair();
  scraped.description = superset;
  existing.notes += `\ndescription: ${subset}`;
  const adapter = buildArbitrationAdapter({});
  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  assert.equal(adapter.calls.length, 0, 'a strict superset never reaches the AI');
  assert.equal(finalEvent.description, superset);
  assert.deepEqual(finalEvent._original.aiArbitration.deterministic, ['description']);
});

test('guardrail: partial-overlap descriptions still arbitrate; equal pairs keep existing behavior', () => {
  const core = createCore();
  // Shared prefix but neither contains the other's FULL text → AI
  assert.equal(
    core.resolveConflictDeterministically('description',
      'Bear party with go-go dancers all night', 'Bear party with DJ sets till 4am'),
    null, 'partial overlap is a genuine conflict');
  // Equal after normalization → the existing case-only rule decides (not the superset rule)
  assert.deepEqual(
    core.resolveConflictDeterministically('description', 'BEAR PARTY  TONIGHT', 'Bear Party Tonight'),
    { winner: 'b', reason: 'case-only variants — kept less-uppercased form' });
  // The rule is description-only: other text fields keep today's behavior
  assert.equal(
    core.resolveConflictDeterministically('title', 'MEGAWOOF: DECADENCE EDITION', 'DECADENCE'),
    null, 'titles never use the superset rule');
});

test('looksLikeStreetAddress: leading house number + street-type word; real venue names never match', () => {
  const core = createCore();
  for (const positive of ['10-90 Wyckoff Ave', '1090 Wyckoff Avenue', '446 MT NEBO RD']) {
    assert.equal(core.looksLikeStreetAddress(positive), true, `"${positive}" is address-shaped`);
  }
  // Pinned venue names: a number without a street word, an ordinal street word
  // without a house number, and no-number names must all stay venue names.
  for (const negative of ['3 Dollar Bill', '9th Avenue Saloon', 'Rockbar', 'Eagle NYC', 'The Rail', '', null]) {
    assert.equal(core.looksLikeStreetAddress(negative), false, `"${negative}" is NOT address-shaped`);
  }
});

test('guardrail: an address-shaped bar never beats a named venue — the MEGAMILK regression, zero AI calls', async () => {
  const core = createCore();
  const { scraped, existing } = buildAlignedArbitrationPair();
  // Observed production shape (2026-07-17): Eventbrite JSON-LD carried the
  // street address in the venue-name slot, and the model picked it over the
  // calendar's real venue with exactly backwards reasoning.
  scraped.title = 'MEGAWOOF & BEARMILK present MEGAMILK';
  existing.title = scraped.title;
  scraped.bar = '10-90 Wyckoff Ave';
  existing.notes = existing.notes.replace('bar: S4', 'bar: HOLO');
  const adapter = buildArbitrationAdapter({});

  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let finalEvent;
  try {
    finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  } finally {
    console.log = originalLog;
  }

  assert.equal(adapter.calls.length, 0, 'the only conflict resolved deterministically — no AI request at all');
  assert.equal(finalEvent.bar, 'HOLO', 'the named venue wins over the street address');
  assert.deepEqual(finalEvent._original.aiArbitration.deterministic, ['bar']);
  assert.deepEqual(finalEvent._original.aiArbitration.fallbacks, [], 'resolved, not a fallback');
  const record = finalEvent._mergeDecisions.find(decision => decision.field === 'bar');
  assert.equal(record.source, 'deterministic');
  assert.equal(record.reason, 'a street address is not a venue name');
  assert.ok(logLines.includes(
    '🔒 MERGE: "MEGAWOOF & BEARMILK present MEGAMILK" field=bar resolved deterministically — a street address is not a venue name'
  ), `stable 🔒 log line expected, got: ${JSON.stringify(logLines)}`);
});

test('guardrail: exactly one address-shaped bar loses in both directions; bar-only rule', () => {
  const core = createCore();
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'HOLO', '10-90 Wyckoff Ave'),
    { winner: 'a', reason: 'a street address is not a venue name' });
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', '10-90 Wyckoff Ave', 'HOLO'),
    { winner: 'b', reason: 'a street address is not a venue name' });
  assert.equal(core.resolveConflictDeterministically('bar', 'HOLO', 'The Rail'), null,
    'two named venues still arbitrate');
  assert.equal(core.resolveConflictDeterministically('shortName', 'HOLO', '10-90 Wyckoff Ave'), null,
    'the address-shape rule applies to bar only');
});

test('guardrail: both bars address-shaped still reaches the AI, with the prompt backstop rule', async () => {
  const core = createCore();
  assert.equal(
    core.resolveConflictDeterministically('bar', '10-90 Wyckoff Ave', '446 Mt Nebo Rd'), null,
    'both sides address-shaped → arbitrate');

  const { scraped, existing } = buildAlignedArbitrationPair();
  scraped.bar = '10-90 Wyckoff Ave';
  existing.notes = existing.notes.replace('bar: S4', 'bar: 446 Mt Nebo Rd');
  const adapter = buildArbitrationAdapter({
    bar: { pick: 'scraped', value: '10-90 Wyckoff Ave', reason: 'matches the ticket page' }
  });
  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  assert.equal(adapter.calls.length, 1, 'both-address conflict still batches to the AI');
  assert.equal(finalEvent.bar, '10-90 Wyckoff Ave');
  assert.match(adapter.calls[0].prompt, /A street address \(e\.g\. "10-90 Wyckoff Ave"\) is never a venue name/,
    'the prompt carries the defense-in-depth rule');
});

test('guardrail: a bar matching curated city bar data beats a non-matching side', async () => {
  const core = new SharedCore(CITIES, {
    eventSchema: EventSchema,
    bars: { dallas: [{ name: 'Eagle NYC', address: '554 W 28th St' }] }
  });
  const context = { cityKey: 'dallas' };
  // Normalized matching (lowercase, non-alphanumerics stripped — same as
  // BarDataNormalizer) in both directions
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'eagle-nyc', 'Dallas Woody\'s', context),
    { winner: 'a', reason: 'matches curated bar data (Eagle NYC)' });
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'Dallas Woody\'s', 'Eagle NYC', context),
    { winner: 'b', reason: 'matches curated bar data (Eagle NYC)' });
  // Curated match outranks the address-shape rule: the curated side wins even
  // against a side the address heuristic would also have picked
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', '554 W 28th St', 'Eagle NYC', context),
    { winner: 'b', reason: 'matches curated bar data (Eagle NYC)' });
  // Both sides matching curated is no tiebreak — still arbitrates
  assert.equal(
    core.resolveConflictDeterministically('bar', 'Eagle NYC', 'Eagle N.Y.C.', context), null,
    'both sides curated → arbitrate');
  // No city context or unknown city → curated rule inert (address rule may still apply)
  assert.equal(
    core.resolveConflictDeterministically('bar', 'Eagle NYC', 'Dallas Woody\'s'), null);
  assert.equal(
    core.resolveConflictDeterministically('bar', 'Eagle NYC', 'Dallas Woody\'s', { cityKey: 'denver' }), null);

  // End-to-end: the curated calendar venue survives without an AI request
  const { scraped, existing } = buildAlignedArbitrationPair();
  scraped.bar = 'Woody\'s Rooftop';
  existing.notes = existing.notes.replace('bar: S4', 'bar: Eagle NYC');
  const adapter = buildArbitrationAdapter({});
  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  assert.equal(adapter.calls.length, 0, 'curated-name rule decides the only conflict — no AI request');
  assert.equal(finalEvent.bar, 'Eagle NYC');
  assert.deepEqual(finalEvent._original.aiArbitration.deterministic, ['bar']);
});

// Seattle fixture for the 2026-07-22 incident: arbitration hallucinated
// "'MASSIVE' is the organizer (BEARRACUDA)" and picked the flyer's edition
// subtitle "Shore Thing" over the curated venue — in BOTH merge flows.
const SEATTLE_CITIES = { seattle: { timezone: 'America/Los_Angeles', patterns: ['seattle'] } };
function createSeattleCore(bars = { seattle: [{ name: 'Massive' }] }) {
  return new SharedCore(SEATTLE_CITIES, { eventSchema: EventSchema, bars });
}

test('guardrail: a leading "the" is dropped on both sides of curated bar matching — full-name equality only', () => {
  const core = new SharedCore(CITIES, {
    eventSchema: EventSchema,
    bars: { dallas: [{ name: 'Eagle NYC' }, { name: 'The Round-Up Saloon' }] }
  });
  const context = { cityKey: 'dallas' };
  // Candidate carries the article, curated name does not
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'The Eagle NYC', 'Dallas Woody\'s', context),
    { winner: 'a', reason: 'matches curated bar data (Eagle NYC)' });
  // Curated name carries the article, candidate does not
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'Dallas Woody\'s', 'Round-Up Saloon', context),
    { winner: 'b', reason: 'matches curated bar data (The Round-Up Saloon)' });
  // Still no substring matching: a bare "Eagle" is NOT the curated "Eagle NYC"
  assert.equal(
    core.resolveConflictDeterministically('bar', 'Eagle', 'Dallas Woody\'s', context), null,
    'partial names never match curated data');
});

test('guardrail: both candidates case-variants of the same curated bar fall through to the case-only rule', () => {
  const core = createSeattleCore();
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'MASSIVE', 'Massive', { cityKey: 'seattle' }),
    { winner: 'b', reason: 'case-only variants — kept less-uppercased form' },
    'both-curated is no tiebreak — the existing case-only rule still decides');
});

test('guardrail: curated rule fails open — no bars data or unknown city leaves the AI path untouched', () => {
  const noBarsCore = new SharedCore(SEATTLE_CITIES, { eventSchema: EventSchema });
  assert.equal(
    noBarsCore.resolveConflictDeterministically('bar', 'MASSIVE', 'Shore Thing', { cityKey: 'seattle' }), null,
    'no bars data → arbitrate as today');
  const core = createSeattleCore();
  assert.equal(
    core.resolveConflictDeterministically('bar', 'MASSIVE', 'Shore Thing', { cityKey: 'portland' }), null,
    'city with no curated bars → arbitrate as today');
  assert.equal(
    core.resolveConflictDeterministically('bar', 'MASSIVE', 'Shore Thing', { cityKey: '' }), null,
    'no resolved city → arbitrate as today');
});

test('incident 2026-07-22 (enrich flow): existing "MASSIVE" beats incoming "Shore Thing" via curated Seattle bars — AI never called', async () => {
  const core = createSeattleCore();
  const priorities = { bar: { priority: ['ai-web'], merge: 'ai' } };
  const aiParserConfig = { ai: { provider: 'ollama', endpoint: 'http://ai.example', model: 'm' } };
  const existing = { title: 'BEARRACUDA SEATTLE', bar: 'MASSIVE', city: 'seattle', source: 'ai-web', _organizer: 'Bearracuda', _fieldPriorities: priorities };
  const incoming = { title: 'BEARRACUDA SEATTLE', bar: 'Shore Thing', city: 'seattle', source: 'ai-web', _parserConfig: aiParserConfig, _fieldPriorities: priorities };
  const adapter = buildArbitrationAdapter({});

  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let merged;
  try {
    merged = await core.mergeParsedEvents(existing, incoming, { httpAdapter: adapter });
  } finally {
    console.log = originalLog;
  }

  assert.equal(adapter.calls.length, 0, 'curated bar data settles the bar field — no AI arbitration request');
  assert.equal(merged.bar, 'MASSIVE', 'the venue survives the enrich merge');
  assert.ok(logLines.includes(
    '🔒 MERGE: "BEARRACUDA SEATTLE" field=bar resolved deterministically — matches curated bar data (Massive)'
  ), `stable 🔒 log line expected, got: ${JSON.stringify(logLines)}`);
});

test('incident 2026-07-22 (calendar flow): calendar "Massive" beats scraped "Shore Thing" via curated Seattle bars — AI never called', async () => {
  const core = createSeattleCore();
  const scraped = {
    title: 'BEARRACUDA SEATTLE',
    bar: 'Shore Thing',
    city: 'seattle',
    startDate: new Date('2026-08-01T05:00:00.000Z'),
    endDate: new Date('2026-08-01T09:00:00.000Z'),
    source: 'ai-web',
    _organizer: 'Bearracuda',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: { ai: { provider: 'ollama', endpoint: 'http://ai.example/api/generate', model: 'test-model' } }
  };
  const existing = {
    title: 'BEARRACUDA SEATTLE',
    startDate: new Date(scraped.startDate.getTime()),
    endDate: new Date(scraped.endDate.getTime()),
    notes: 'bar: Massive'
  };
  const adapter = buildArbitrationAdapter({});

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 0, 'curated bar data settles the only conflict — no AI request');
  assert.equal(finalEvent.bar, 'Massive', 'the calendar venue survives the merge');
  assert.deepEqual(finalEvent._original.aiArbitration.deterministic, ['bar']);
});

test('incident names with NO curated match still arbitrate via AI exactly as today', async () => {
  const core = createSeattleCore({ seattle: [{ name: 'Neighbours' }] });
  const scraped = {
    title: 'BEARRACUDA SEATTLE',
    bar: 'Shore Thing',
    city: 'seattle',
    startDate: new Date('2026-08-01T05:00:00.000Z'),
    endDate: new Date('2026-08-01T09:00:00.000Z'),
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: { ai: { provider: 'ollama', endpoint: 'http://ai.example/api/generate', model: 'test-model' } }
  };
  const existing = {
    title: 'BEARRACUDA SEATTLE',
    startDate: new Date(scraped.startDate.getTime()),
    endDate: new Date(scraped.endDate.getTime()),
    notes: 'bar: MASSIVE'
  };
  const adapter = buildArbitrationAdapter({
    bar: { pick: 'calendar', value: 'MASSIVE', reason: 'venue' }
  });

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 1, 'neither side curated → the AI is consulted as before');
  assert.equal(finalEvent.bar, 'MASSIVE');
});

test('mergeParsedEvents: same-host root-vs-deep website resolves deterministically too', async () => {
  const core = createCore();
  const priorities = { website: { priority: ['ai-web'], merge: 'ai' } };
  const aiParserConfig = { ai: { provider: 'ollama', endpoint: 'http://ai.example', model: 'm' } };
  // Same source → same priority index → normally a non-decisive AI conflict
  const existing = { title: 'FURBALL', website: 'https://bearracuda.com/events/portland-pridefriday/', source: 'ai-web', _fieldPriorities: priorities };
  const incoming = { title: 'FURBALL', website: 'https://bearracuda.com/', source: 'ai-web', _parserConfig: aiParserConfig, _fieldPriorities: priorities };
  const adapter = buildArbitrationAdapter({});

  const merged = await core.mergeParsedEvents(existing, incoming, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 0, 'deterministic resolution must skip AI in the parser-merge path too');
  assert.equal(merged.website, 'https://bearracuda.com/events/portland-pridefriday/');
});

// ---------------------------------------------------------------------------
// Case-only variants (2026-07-12 run: bar="NOVA PDX" vs "Nova PDX",
// bar="MASSIVE" vs "Massive", title="Treasure Trail Portland PRIDE" vs
// "TREASURE TRAIL Portland PRIDE" each burned a 1.5–7s AI arbitration, with
// inconsistent picks between runs)
// ---------------------------------------------------------------------------

test('guardrail: case-only variants keep the less-uppercased form without AI', () => {
  const core = createCore();
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'NOVA PDX', 'Nova PDX'),
    { winner: 'b', reason: 'case-only variants — kept less-uppercased form' });
  assert.deepEqual(
    core.resolveConflictDeterministically('title', 'TREASURE TRAIL Portland PRIDE', 'Treasure Trail Portland PRIDE'),
    { winner: 'b', reason: 'case-only variants — kept less-uppercased form' },
    'the less-uppercased variant wins');
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'MASSIVE', 'Massive'),
    { winner: 'b', reason: 'case-only variants — kept less-uppercased form' });
  // Exact tie (whitespace-collapse-equal, same uppercase count) keeps valueA
  // — the existing/calendar side, for stability
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'Nova PDX', 'Nova  PDX'),
    { winner: 'a', reason: 'case-only variants — kept less-uppercased form' });
  // Genuinely different values must still go to AI
  assert.equal(core.resolveConflictDeterministically('bar', 'The Heretic', 'The Heretic Atlanta'), null);
  // ("722 E Burnside" vs "722 East Burnside Street" used to be the example
  // here — the address ladder now resolves same-address variants like that
  // deterministically; see the deterministic address ladder tests below.)
  assert.equal(core.resolveConflictDeterministically('address', '722 E Burnside', '1200 Canal Street'), null);
});

test('guardrail: earlier deterministic rules keep priority over the case-only rule', () => {
  const core = createCore();
  // Emoji twins that are ALSO case-fold-equal (whitespace-only difference):
  // the emoji-twin rule fires first — longer variant wins with the twin
  // reason, where the case-only rule alone would have kept valueA on a tie.
  assert.deepEqual(
    core.resolveConflictDeterministically('title', 'Nova PDX 🔥', 'Nova  PDX 🔥'),
    { winner: 'b', reason: 'emoji title variant beats its emoji-stripped twin' });
  // Two bare-city case variants: the city rule needs exactly ONE city-only
  // side so it stays silent, and the case-only rule now resolves what
  // previously went to AI ("two bare-city variants still arbitrate" no longer
  // applies when the variants differ only by case).
  const cityCore = createCityTitleCore();
  assert.deepEqual(
    cityCore.resolveConflictDeterministically('title', 'NEW ORLEANS', 'New Orleans', { cityKey: 'nola' }),
    { winner: 'b', reason: 'case-only variants — kept less-uppercased form' });
  // A named-vs-bare-city pair keeps the city rule's reason (it can never be
  // case-fold-equal, so the earlier rule always decides first)
  assert.deepEqual(
    cityCore.resolveConflictDeterministically('title', 'BEARRACUDA: New Orleans⚜️', 'New Orleans⚜️', { cityKey: 'nola' }),
    { winner: 'a', reason: 'named title beats bare city title' });
});

// ---------------------------------------------------------------------------
// Deterministic address ladder (run 20260722-124758: ALL SIX address merge
// conflicts were the SAME address in different formats, each burning an AI
// arbitration call with coin-flip risk)
// ---------------------------------------------------------------------------

const SAME_ADDRESS_REASON = 'same address, kept the more complete form';

// Five of the six real pairs from the run, as [more complete, less complete].
// The first five replay through the scraped-vs-calendar flow below; the sixth
// pair (observed in the enrich flow) replays through mergeParsedEvents.
const RUN_20260722_ADDRESS_PAIRS = [
  { complete: '619 East Pine Street, Seattle, WA, 98122', partial: '619 E. Pine St, Seattle, WA' },
  { complete: '2069 Cheshire Bridge Road Northeast, Atlanta, GA, 30324', partial: '2069 CHESHIRE BRIDGE RD NE' },
  { complete: '1200 Canal Street, New Orleans, LA', partial: '1200 Canal Street' },
  { complete: '619 E. Pine, Seattle, WA, 98122', partial: '619 E. Pine Street' },
  { complete: '161 Erie Street, San Francisco, CA, 94103', partial: '161 Erie St' }
];

test('address rung 1: every run-20260722 pair resolves to the more complete form, in both directions', () => {
  const core = createCore();
  for (const { complete, partial } of RUN_20260722_ADDRESS_PAIRS) {
    assert.deepEqual(
      core.resolveConflictDeterministically('address', complete, partial),
      { winner: 'a', reason: SAME_ADDRESS_REASON }, `${complete} vs ${partial}`);
    assert.deepEqual(
      core.resolveConflictDeterministically('address', partial, complete),
      { winner: 'b', reason: SAME_ADDRESS_REASON }, `${partial} vs ${complete}`);
  }
  // The enrich-flow pair carries the same components on both sides — the
  // comma-separated (calendar-canonical) format counts as the more complete
  // form over the run-on one.
  assert.deepEqual(
    core.resolveConflictDeterministically('address', '619 E. PINE ST. SEATTLE, WA', '619 E. Pine St, Seattle, WA'),
    { winner: 'b', reason: SAME_ADDRESS_REASON });
});

test('run 20260722 (scraped-vs-calendar flow): same-address conflicts resolve with ZERO AI calls', async () => {
  for (const { complete, partial } of RUN_20260722_ADDRESS_PAIRS) {
    const core = createCore();
    const { scraped, existing } = buildAlignedArbitrationPair();
    scraped.address = partial;
    existing.notes = existing.notes.replace(
      'address: 3911 Cedar Springs Rd, Dallas, TX 75219', `address: ${complete}`);
    const adapter = buildArbitrationAdapter({});

    const logLines = [];
    const originalLog = console.log;
    console.log = (message) => { logLines.push(String(message)); };
    let finalEvent;
    try {
      finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
    } finally {
      console.log = originalLog;
    }

    assert.equal(adapter.calls.length, 0, `no AI request for "${partial}" vs "${complete}"`);
    assert.equal(finalEvent.address, complete, 'the more complete form wins');
    assert.deepEqual(finalEvent._original.aiArbitration.deterministic, ['address']);
    assert.ok(logLines.includes(
      `🔒 MERGE: "FURBALL DALLAS" field=address resolved deterministically — ${SAME_ADDRESS_REASON}`
    ), `stable 🔒 log line expected, got: ${JSON.stringify(logLines)}`);
  }
});

test('run 20260722 (enrich flow): "619 E. PINE ST. SEATTLE, WA" vs "619 E. Pine St, Seattle, WA" — AI never called', async () => {
  const core = createSeattleCore();
  const priorities = { address: { priority: ['ai-web'], merge: 'ai' } };
  const aiParserConfig = { ai: { provider: 'ollama', endpoint: 'http://ai.example', model: 'm' } };
  const existing = { title: 'BEARRACUDA SEATTLE', address: '619 E. PINE ST. SEATTLE, WA', city: 'seattle', source: 'ai-web', _fieldPriorities: priorities };
  const incoming = { title: 'BEARRACUDA SEATTLE', address: '619 E. Pine St, Seattle, WA', city: 'seattle', source: 'ai-web', _parserConfig: aiParserConfig, _fieldPriorities: priorities };
  const adapter = buildArbitrationAdapter({});

  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let merged;
  try {
    merged = await core.mergeParsedEvents(existing, incoming, { httpAdapter: adapter });
  } finally {
    console.log = originalLog;
  }

  assert.equal(adapter.calls.length, 0, 'same-address conflict resolves deterministically in the enrich flow');
  assert.equal(merged.address, '619 E. Pine St, Seattle, WA', 'the comma-separated form is the more complete one');
  assert.ok(logLines.includes(
    `🔒 MERGE: "BEARRACUDA SEATTLE" field=address resolved deterministically — ${SAME_ADDRESS_REASON}`
  ), `stable 🔒 log line expected, got: ${JSON.stringify(logLines)}`);
});

test('address rung 1: abbreviation/directional symmetry, case-insensitivity, punctuation', () => {
  const core = createCore();
  // RD NE ↔ Road Northeast (directionals fuse: "N.E." == "NE" == "Northeast")
  assert.deepEqual(
    core.resolveConflictDeterministically('address', '2069 Cheshire Bridge Road Northeast, Atlanta, GA, 30324', '2069 CHESHIRE BRIDGE RD N.E.'),
    { winner: 'a', reason: SAME_ADDRESS_REASON });
  // Symmetric in both abbreviation directions
  assert.deepEqual(
    core.resolveConflictDeterministically('address', '161 Erie St', '161 Erie Street, San Francisco, CA, 94103'),
    { winner: 'b', reason: SAME_ADDRESS_REASON });
  // Case and punctuation never block the match
  assert.deepEqual(
    core.resolveConflictDeterministically('address', '619 e pine st seattle wa', '619 E. Pine St., Seattle, WA, 98122'),
    { winner: 'b', reason: SAME_ADDRESS_REASON });
});

test('address rung 1 is conservative: genuinely different addresses still reach the AI', () => {
  const core = createCore();
  // Different street numbers, same street
  assert.equal(core.resolveConflictDeterministically('address', '617 E Pine St, Seattle, WA', '619 E Pine St, Seattle, WA'), null);
  // Same number, different streets
  assert.equal(core.resolveConflictDeterministically('address', '314 E Pike St, Seattle, WA', '314 E Pine St, Seattle, WA'), null);
  // Entirely different addresses (the fail-open cases from the task)
  assert.equal(core.resolveConflictDeterministically('address', '619 E Pine St', '1200 Canal Street'), null);
  assert.equal(core.resolveConflictDeterministically('address', '314 E Pike St', '619 E Pine St'), null);
  // A candidate without a leading street number never matches
  assert.equal(core.resolveConflictDeterministically('address', 'Massive Nightclub, Seattle', '619 E Pine St, Seattle, WA'), null);
  // Different explicit ZIPs are different places even with equal street lines
  assert.equal(core.resolveConflictDeterministically('address', '619 E Pine St, Seattle, WA 98122', '619 E Pine St, Tacoma, WA 98402'), null);
  // The Eventbrite doubled-address shape must keep arbitrating — repetition is
  // malformation, not completeness (the AI reliably picks the clean form)
  assert.equal(core.resolveConflictDeterministically('address',
    '3911 Cedar Springs Rd, Dallas, TX 75219', '3911 Cedar Springs Rd, Dallas, TX 75219, Dallas, TX'), null);
  // The ladder is scoped to the address field
  assert.equal(core.resolveConflictDeterministically('shortName', '619 E Pine St', '619 East Pine Street, Seattle'), null);
  // Empty candidates never resolve here (existing empty-field handling owns them)
  assert.equal(core.resolveConflictDeterministically('address', '', '619 E Pine St, Seattle, WA'), null);
});

test('address flow: an empty scraped address keeps the calendar value without AI (existing handling untouched)', async () => {
  const core = createCore();
  const { scraped, existing } = buildAlignedArbitrationPair();
  scraped.address = '';
  const adapter = buildArbitrationAdapter({});
  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  assert.equal(adapter.calls.length, 0, 'one-sided address is not a conflict');
  assert.equal(finalEvent.address, '3911 Cedar Springs Rd, Dallas, TX 75219', 'calendar address kept');
  const arbitration = finalEvent._original && finalEvent._original.aiArbitration;
  assert.ok(!arbitration || arbitration.deterministic.length === 0,
    'the empty-scrape rule, not the ladder, decided');
});

test('address rung 2: the curated bar address anchors the conflict when the event bar matches curated data', () => {
  const core = createSeattleCore({ seattle: [{ name: 'Massive', address: '619 E Pine St, Seattle, WA 98122' }] });
  const context = { cityKey: 'seattle', barNames: ['MASSIVE'] };
  // A curated-address variant beats a non-address candidate, in both directions
  assert.deepEqual(
    core.resolveConflictDeterministically('address', 'somewhere else entirely', '619 East Pine Street, Seattle, WA', context),
    { winner: 'b', reason: 'matches curated bar address (Massive)' });
  assert.deepEqual(
    core.resolveConflictDeterministically('address', '619 East Pine Street, Seattle, WA', 'somewhere else entirely', context),
    { winner: 'a', reason: 'matches curated bar address (Massive)' });
  // Contradiction: the other candidate is a DIFFERENT parseable address —
  // never silently resolved, the AI sees it
  assert.equal(
    core.resolveConflictDeterministically('address', '1200 Canal Street, New Orleans, LA', '619 East Pine Street, Seattle, WA', context),
    null, 'a parseable address contradicting curated data still arbitrates');
  // Both candidates differ from the curated address → AI
  assert.equal(
    core.resolveConflictDeterministically('address', 'somewhere else entirely', '2069 Cheshire Bridge Rd NE', context),
    null, 'both differing from curated → arbitrate');
  // No curated match for the event's bar, no bar context, or no curated
  // address on file → rung inert, AI path unchanged
  assert.equal(
    core.resolveConflictDeterministically('address', 'somewhere else entirely', '619 East Pine Street, Seattle, WA',
      { cityKey: 'seattle', barNames: ['Neighbours'] }),
    null);
  assert.equal(
    core.resolveConflictDeterministically('address', 'somewhere else entirely', '619 East Pine Street, Seattle, WA',
      { cityKey: 'seattle' }),
    null);
  const noAddressCore = createSeattleCore(); // curated Massive has no address field
  assert.equal(
    noAddressCore.resolveConflictDeterministically('address', 'somewhere else entirely', '619 East Pine Street, Seattle, WA', context),
    null);
});

test('address rung 2 (calendar flow): bar=Massive anchors the calendar address without AI', async () => {
  const core = createSeattleCore({ seattle: [{ name: 'Massive', address: '619 E Pine St, Seattle, WA 98122' }] });
  const scraped = {
    title: 'BEARRACUDA SEATTLE',
    bar: 'Massive',
    address: 'somewhere else entirely',
    city: 'seattle',
    startDate: new Date('2026-08-01T05:00:00.000Z'),
    endDate: new Date('2026-08-01T09:00:00.000Z'),
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: { ai: { provider: 'ollama', endpoint: 'http://ai.example/api/generate', model: 'test-model' } }
  };
  const existing = {
    title: 'BEARRACUDA SEATTLE',
    startDate: new Date(scraped.startDate.getTime()),
    endDate: new Date(scraped.endDate.getTime()),
    notes: ['bar: Massive', 'address: 619 East Pine Street, Seattle, WA'].join('\n')
  };
  const adapter = buildArbitrationAdapter({});

  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let finalEvent;
  try {
    finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  } finally {
    console.log = originalLog;
  }

  assert.equal(adapter.calls.length, 0, 'curated bar address settles the only conflict — no AI request');
  assert.equal(finalEvent.address, '619 East Pine Street, Seattle, WA', 'the curated-matching candidate wins');
  assert.deepEqual(finalEvent._original.aiArbitration.deterministic, ['address']);
  assert.ok(logLines.includes(
    '🔒 MERGE: "BEARRACUDA SEATTLE" field=address resolved deterministically — matches curated bar address (Massive)'
  ), `stable 🔒 log line expected, got: ${JSON.stringify(logLines)}`);
});

test('address completeness: component count wins, normalized length breaks ties, full ties fall through', () => {
  const core = createCore();
  // zip+state+city beats the bare street line (component count)
  assert.deepEqual(
    core.resolveConflictDeterministically('address', '161 Erie Street, San Francisco, CA, 94103', '161 Erie St'),
    { winner: 'a', reason: SAME_ADDRESS_REASON });
  // Equal component count → the longer normalized form wins
  assert.deepEqual(
    core.resolveConflictDeterministically('address', '619 E Pine St, Seattle, WA', '619 East Pine Street, Seattle, Washington'),
    { winner: 'b', reason: SAME_ADDRESS_REASON });
  // Pure case twins tie completely and fall through to the case-only rule
  assert.deepEqual(
    core.resolveConflictDeterministically('address', '619 E PINE ST, SEATTLE, WA', '619 E Pine St, Seattle, WA'),
    { winner: 'b', reason: 'case-only variants — kept less-uppercased form' });
  // Abbreviation-only twins with identical components and normalized length
  // are a genuine toss-up — stably deferred to the AI, exactly as today
  assert.equal(
    core.resolveConflictDeterministically('address', '619 E Pine St, Seattle, WA', '619 East Pine St, Seattle, WA'),
    null);
});

// ---------------------------------------------------------------------------
// Address evidence rung (rung 3): genuinely-different addresses decided by
// pins the pipeline already produced — one verified pin, city-center sanity,
// curated-bar proximity — before any AI arbitration. No network calls.
// ---------------------------------------------------------------------------

const EVIDENCE_CITIES = {
  seattle: { timezone: 'America/Los_Angeles', patterns: ['seattle'], coordinates: { lat: 47.6062, lng: -122.3321 } }
};
function createEvidenceCore(bars = null) {
  return new SharedCore(EVIDENCE_CITIES, { eventSchema: EventSchema, ...(bars ? { bars } : {}) });
}
// Two genuinely different addresses (different street AND number — rung 1
// can never match them, rung 2 never silently overrides a parseable pair).
const CANAL_ADDRESS = '1200 Canal Street, New Orleans, LA';
const PINE_ADDRESS = '619 E Pine St, Seattle, WA';
// Distances from the Seattle center above (haversine, precomputed):
const NEAR_CENTER_PIN = '47.6062, -122.3241';   // ~0.6 km from center
const ABSURD_PIN = '48.3249, -122.3321';        // ~79.9 km from center
const MASSIVE_PIN = '47.6152, -122.3225';       // curated Massive (~1.2 km from center)
const NEAR_MASSIVE_PIN = '47.6157, -122.3225';  // ~56 m from Massive (~1.3 km from center)
const FAR_MASSIVE_PIN = '47.6252, -122.3225';   // ~1.1 km from Massive (~2.2 km from center)

function evidenceContext(recordA, recordB, extra = {}) {
  return {
    cityKey: 'seattle',
    eventTitle: 'BEARRACUDA SEATTLE',
    sideLabels: { a: 'calendar', b: 'scraped' },
    records: { a: recordA, b: recordB },
    ...extra
  };
}

test('address evidence step 1: exactly one verified pin wins, in both directions', () => {
  const core = createEvidenceCore();
  assert.deepEqual(
    core.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS, location: NEAR_CENTER_PIN, pinSource: 'geocoded-exact' },
      { address: PINE_ADDRESS })),
    { winner: 'a', reason: 'only "calendar" has a verified pin' });
  assert.deepEqual(
    core.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS },
      { address: PINE_ADDRESS, location: NEAR_CENTER_PIN, pinSource: 'geocoded-exact' })),
    { winner: 'b', reason: 'only "scraped" has a verified pin' });
  // A curated pin stamped alongside a curated address is verified too
  assert.deepEqual(
    core.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS },
      { address: PINE_ADDRESS, location: MASSIVE_PIN, pinSource: 'curated', addressSource: 'curated' })),
    { winner: 'b', reason: 'only "scraped" has a verified pin' });
});

test('address evidence step 1 is conservative: unverified or unattributable pins never decide alone', () => {
  const core = createEvidenceCore();
  // The only pin is geocoded-approx (street grade / failed cross-check) → AI
  assert.equal(
    core.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS },
      { address: PINE_ADDRESS, location: NEAR_CENTER_PIN, pinSource: 'geocoded-approx' })),
    null);
  // A page pin was never derived from the address → no attribution → AI
  assert.equal(
    core.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS },
      { address: PINE_ADDRESS, location: NEAR_CENTER_PIN, pinSource: 'page' })),
    null);
  // A pin with no provenance at all (hand-fixed) → uncertain → AI
  assert.equal(
    core.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS },
      { address: PINE_ADDRESS, location: NEAR_CENTER_PIN })),
    null);
  // A curated pin WITHOUT a curated address was not derived from this address
  assert.equal(
    core.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS },
      { address: PINE_ADDRESS, location: MASSIVE_PIN, pinSource: 'curated', addressSource: 'page' })),
    null);
  // No records threaded (direct/legacy callers) → rung inert
  assert.equal(
    core.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS,
      { cityKey: 'seattle' }),
    null);
});

test('address evidence attribution: a pin not derived from the candidate address is treated as no-pin', () => {
  const core = createEvidenceCore();
  // The record carries a verified pin, but its own address is NOT the
  // candidate value being merged — attribution is uncertain, so the pin must
  // not count and the conflict falls through to the AI.
  assert.equal(
    core.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS },
      { address: '500 Somewhere Else Ave, Seattle, WA', location: NEAR_CENTER_PIN, pinSource: 'geocoded-exact' })),
    null);
});

test('address evidence step 2: a sane city-center distance beats an absurd one, in both directions', () => {
  const core = createEvidenceCore();
  assert.deepEqual(
    core.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS, location: ABSURD_PIN, pinSource: 'geocoded-approx' },
      { address: PINE_ADDRESS, location: NEAR_CENTER_PIN, pinSource: 'geocoded-exact' })),
    { winner: 'b', reason: 'only "scraped" pin is near the city center (1 km vs 80 km)' });
  assert.deepEqual(
    core.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS, location: NEAR_CENTER_PIN, pinSource: 'geocoded-exact' },
      { address: PINE_ADDRESS, location: ABSURD_PIN, pinSource: 'geocoded-exact' })),
    { winner: 'a', reason: 'only "calendar" pin is near the city center (1 km vs 80 km)' });
});

test('address evidence step 2 fails open: both sane, gray zone, or no city center → AI as today', () => {
  const core = createEvidenceCore();
  // Both pins within 30 km → ambiguous (no curated bar → nothing decides)
  assert.equal(
    core.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS, location: MASSIVE_PIN, pinSource: 'geocoded-exact' },
      { address: PINE_ADDRESS, location: FAR_MASSIVE_PIN, pinSource: 'geocoded-exact' })),
    null);
  // The 30–50 km band is ambiguous on purpose: ~40 km is neither sane nor absurd
  assert.equal(
    core.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS, location: '47.9659, -122.3321', pinSource: 'geocoded-exact' },
      { address: PINE_ADDRESS, location: NEAR_CENTER_PIN, pinSource: 'geocoded-exact' })),
    null);
  // No city-center coordinates in the cities config → step 2 inert
  const noCenterCore = new SharedCore(
    { seattle: { timezone: 'America/Los_Angeles', patterns: ['seattle'] } },
    { eventSchema: EventSchema });
  assert.equal(
    noCenterCore.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS, location: ABSURD_PIN, pinSource: 'geocoded-exact' },
      { address: PINE_ADDRESS, location: NEAR_CENTER_PIN, pinSource: 'geocoded-exact' })),
    null);
});

test('address evidence step 3: exactly one pin within 150 m of the curated bar pin wins', () => {
  const core = createEvidenceCore({ seattle: [{ name: 'Massive', coordinates: MASSIVE_PIN }] });
  const barContext = { barNames: ['MASSIVE'] };
  // Both pins are sane city distances (step 2 stays silent) — proximity decides
  assert.deepEqual(
    core.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS, location: FAR_MASSIVE_PIN, pinSource: 'geocoded-approx' },
      { address: PINE_ADDRESS, location: NEAR_MASSIVE_PIN, pinSource: 'geocoded-approx' }, barContext)),
    { winner: 'b', reason: 'pin matches curated bar "Massive"' });
  assert.deepEqual(
    core.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS, location: NEAR_MASSIVE_PIN, pinSource: 'geocoded-approx' },
      { address: PINE_ADDRESS, location: FAR_MASSIVE_PIN, pinSource: 'geocoded-approx' }, barContext)),
    { winner: 'a', reason: 'pin matches curated bar "Massive"' });
  // A lone geocoded-approx pin (too weak for step 1) matching the curated pin
  // still wins here — the curated coordinates ARE the verification
  assert.deepEqual(
    core.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS },
      { address: PINE_ADDRESS, location: NEAR_MASSIVE_PIN, pinSource: 'geocoded-approx' }, barContext)),
    { winner: 'b', reason: 'pin matches curated bar "Massive"' });
});

test('address evidence step 3 fails open: both pins near, both far, or no curated coordinates → AI', () => {
  const core = createEvidenceCore({ seattle: [{ name: 'Massive', coordinates: MASSIVE_PIN }] });
  const barContext = { barNames: ['MASSIVE'] };
  // Both within 150 m → ambiguous
  assert.equal(
    core.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS, location: MASSIVE_PIN, pinSource: 'geocoded-approx' },
      { address: PINE_ADDRESS, location: NEAR_MASSIVE_PIN, pinSource: 'geocoded-approx' }, barContext)),
    null);
  // Both outside 150 m → ambiguous
  assert.equal(
    core.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS, location: FAR_MASSIVE_PIN, pinSource: 'geocoded-approx' },
      { address: PINE_ADDRESS, location: NEAR_CENTER_PIN, pinSource: 'geocoded-approx' }, barContext)),
    null);
  // Curated bar with no coordinates on file → step 3 inert
  const noCoordsCore = createEvidenceCore({ seattle: [{ name: 'Massive' }] });
  assert.equal(
    noCoordsCore.resolveConflictDeterministically('address', CANAL_ADDRESS, PINE_ADDRESS, evidenceContext(
      { address: CANAL_ADDRESS, location: FAR_MASSIVE_PIN, pinSource: 'geocoded-approx' },
      { address: PINE_ADDRESS, location: NEAR_MASSIVE_PIN, pinSource: 'geocoded-approx' },
      { barNames: ['MASSIVE'] })),
    null);
});

function captureMergeLogs() {
  const lines = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (message) => { lines.push(String(message)); };
  console.warn = (message) => { lines.push(String(message)); };
  return { lines, restore: () => { console.log = originalLog; console.warn = originalWarn; } };
}

function buildEvidenceFlowScrape(core, overrides = {}) {
  return {
    title: 'BEARRACUDA SEATTLE',
    city: 'seattle',
    startDate: new Date('2026-08-01T05:00:00.000Z'),
    endDate: new Date('2026-08-01T09:00:00.000Z'),
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: { ai: { provider: 'ollama', endpoint: 'http://ai.example/api/generate', model: 'test-model' } },
    ...overrides
  };
}

test('address evidence (calendar flow): the scraped side\'s verified pin wins with ZERO AI calls', async () => {
  const core = createEvidenceCore();
  const scraped = buildEvidenceFlowScrape(core, {
    address: PINE_ADDRESS, location: MASSIVE_PIN, pinSource: 'geocoded-exact'
  });
  const existing = {
    title: 'BEARRACUDA SEATTLE',
    startDate: new Date(scraped.startDate.getTime()),
    endDate: new Date(scraped.endDate.getTime()),
    notes: `address: ${CANAL_ADDRESS}`
  };
  const adapter = buildArbitrationAdapter({});

  const capture = captureMergeLogs();
  let finalEvent;
  try {
    finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  } finally {
    capture.restore();
  }

  assert.equal(adapter.calls.length, 0, 'the verified pin settles the only conflict — no AI request');
  assert.equal(finalEvent.address, PINE_ADDRESS, 'the pinned scraped address wins');
  assert.deepEqual(finalEvent._original.aiArbitration.deterministic, ['address']);
  assert.ok(capture.lines.includes(
    '🔒 MERGE: "BEARRACUDA SEATTLE" field=address resolved deterministically — only "scraped" has a verified pin'
  ), `stable 🔒 log line expected, got: ${JSON.stringify(capture.lines)}`);
  assert.ok(!capture.lines.some(line => line.includes('street mismatch arbitrated by AI')),
    'a deterministically resolved mismatch never emits the manual-review warning');
});

test('address evidence (calendar flow): the calendar side\'s stored verified pin wins with ZERO AI calls', async () => {
  const core = createEvidenceCore();
  const scraped = buildEvidenceFlowScrape(core, { address: CANAL_ADDRESS });
  const existing = {
    title: 'BEARRACUDA SEATTLE',
    startDate: new Date(scraped.startDate.getTime()),
    endDate: new Date(scraped.endDate.getTime()),
    location: MASSIVE_PIN,
    notes: [`address: ${PINE_ADDRESS}`, 'pinSource: geocoded-exact'].join('\n')
  };
  const adapter = buildArbitrationAdapter({});

  const capture = captureMergeLogs();
  let finalEvent;
  try {
    finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  } finally {
    capture.restore();
  }

  assert.equal(adapter.calls.length, 0, 'the stored calendar pin settles the only conflict — no AI request');
  assert.equal(finalEvent.address, PINE_ADDRESS, 'the pinned calendar address wins');
  assert.equal(finalEvent.location, MASSIVE_PIN, 'the calendar pin is kept');
  assert.ok(capture.lines.includes(
    '🔒 MERGE: "BEARRACUDA SEATTLE" field=address resolved deterministically — only "calendar" has a verified pin'
  ), `stable 🔒 log line expected, got: ${JSON.stringify(capture.lines)}`);
});

test('address evidence (enrich flow): one verified pin decides in both directions with ZERO AI calls', async () => {
  const priorities = { address: { priority: ['ai-web'], merge: 'ai' } };
  const aiParserConfig = { ai: { provider: 'ollama', endpoint: 'http://ai.example', model: 'm' } };
  const buildPinned = () => ({
    title: 'BEARRACUDA SEATTLE', city: 'seattle', source: 'ai-web', _fieldPriorities: priorities,
    _parserConfig: aiParserConfig,
    address: PINE_ADDRESS, location: MASSIVE_PIN, pinSource: 'geocoded-exact'
  });
  const buildUnpinned = () => ({
    title: 'BEARRACUDA SEATTLE', city: 'seattle', source: 'ai-web', _fieldPriorities: priorities,
    _parserConfig: aiParserConfig,
    address: CANAL_ADDRESS
  });

  for (const [existing, incoming, winnerLabel] of [
    [buildPinned(), buildUnpinned(), 'existing'],
    [buildUnpinned(), buildPinned(), 'incoming']
  ]) {
    const core = createEvidenceCore();
    const adapter = buildArbitrationAdapter({});
    const capture = captureMergeLogs();
    let merged;
    try {
      merged = await core.mergeParsedEvents(existing, incoming, { httpAdapter: adapter });
    } finally {
      capture.restore();
    }
    assert.equal(adapter.calls.length, 0, `no AI request when "${winnerLabel}" carries the verified pin`);
    assert.equal(merged.address, PINE_ADDRESS, 'the pinned address wins');
    assert.ok(capture.lines.includes(
      `🔒 MERGE: "BEARRACUDA SEATTLE" field=address resolved deterministically — only "${winnerLabel}" has a verified pin`
    ), `stable 🔒 log line expected, got: ${JSON.stringify(capture.lines)}`);
  }
});

test('address evidence step 4: an undecidable street mismatch reaches the AI exactly as today, plus the ⚠️ warning', async () => {
  const core = createEvidenceCore();
  const scraped = buildEvidenceFlowScrape(core, { address: PINE_ADDRESS });
  const existing = {
    title: 'BEARRACUDA SEATTLE',
    startDate: new Date(scraped.startDate.getTime()),
    endDate: new Date(scraped.endDate.getTime()),
    notes: `address: ${CANAL_ADDRESS}`
  };
  const adapter = buildArbitrationAdapter({
    address: { pick: 'scraped', value: PINE_ADDRESS, reason: 'matches the event city' }
  });

  const capture = captureMergeLogs();
  let finalEvent;
  try {
    finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  } finally {
    capture.restore();
  }

  assert.equal(adapter.calls.length, 1, 'no evidence on either side → the AI arbitrates exactly as before');
  assert.match(adapter.calls[0].prompt, /field: address/, 'the address conflict reaches the prompt');
  assert.equal(finalEvent.address, PINE_ADDRESS, 'the AI pick still lands');
  assert.ok(capture.lines.includes(
    `⚠️ MERGE: "BEARRACUDA SEATTLE" field=address street mismatch arbitrated by AI ("${CANAL_ADDRESS}" vs "${PINE_ADDRESS}") — verify manually`
  ), `additive ⚠️ warning expected, got: ${JSON.stringify(capture.lines)}`);
});

test('resolveAiConfig defaults and the arbitrateMerges flag', () => {
  const core = createCore();
  const defaults = core.resolveAiConfig({});
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.arbitrateMerges, true);
  assert.equal(defaults.provider, 'openai');
  assert.equal(defaults.endpoint, 'http://rybook.taila7523c.ts.net:8000/v1/chat/completions');
  assert.equal(core.resolveAiConfig({ arbitrateMerges: false }).arbitrateMerges, false);

  // getMergeArbitrationConfig: parser ai wins, global ai is the fallback
  const fromParser = core.getMergeArbitrationConfig({ _parserConfig: { ai: { model: 'parser-model' } } }, { ai: { model: 'global-model' } });
  assert.equal(fromParser.model, 'parser-model');
  const fromGlobal = core.getMergeArbitrationConfig({ source: 'bearracuda' }, { ai: { model: 'global-model' } });
  assert.equal(fromGlobal.model, 'global-model');
});

// ---------------------------------------------------------------------------
// Degenerate ends, date arbitration routing, and the location=coordinates rule
// ---------------------------------------------------------------------------

const TEST_AI_PARSER_CONFIG = { ai: { provider: 'ollama', endpoint: 'http://ai.example/api/generate', model: 'test-model' } };

test('a degenerate scraped endDate (== startDate) never clobbers a positive-duration calendar end', async () => {
  const core = createCore();
  const scraped = {
    title: 'New Orleans',
    startDate: new Date('2026-09-05T02:00:00.000Z'),
    endDate: new Date('2026-09-05T02:00:00.000Z'), // zero duration — a normalization artifact, not data
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: TEST_AI_PARSER_CONFIG
  };
  const existing = {
    title: 'New Orleans',
    startDate: new Date('2026-09-05T02:00:00.000Z'),
    endDate: new Date('2026-09-05T07:00:00.000Z'), // "party until 2am" — 5h duration
    notes: ''
  };
  const adapter = buildArbitrationAdapter({});

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 0, 'a degenerate end must never even become an arbitration conflict');
  assert.equal(finalEvent.endDate.toISOString(), '2026-09-05T07:00:00.000Z', 'the calendar end must survive');
});

test('genuinely differing dates reach arbitration even under an explicit merge:"clobber" config', async () => {
  const core = createCore();
  // Bearracuda-style per-parser override: merge "clobber" for dates. This exact
  // config made date conflicts bypass isGenuineFieldConflict entirely and
  // silently overwrite calendar dates.
  const clobberPriorities = core.getResolvedFieldPriorities({
    fieldPriorities: {
      startDate: { priority: ['ai-web', 'bearracuda'], merge: 'clobber' },
      endDate: { priority: ['ai-web', 'bearracuda'], merge: 'clobber' }
    }
  });

  // Calendar endDate as a Date instance AND as an ISO string — both must route.
  for (const calendarEnd of [new Date('2026-09-05T07:00:00.000Z'), '2026-09-05T07:00:00.000Z']) {
    const scraped = {
      title: 'New Orleans',
      startDate: new Date('2026-09-05T01:00:00.000Z'),
      endDate: new Date('2026-09-05T06:00:00.000Z'), // valid positive duration, but differs from calendar
      source: 'ai-web',
      _fieldPriorities: clobberPriorities,
      _parserConfig: TEST_AI_PARSER_CONFIG
    };
    const existing = {
      title: 'New Orleans',
      startDate: new Date('2026-09-05T01:00:00.000Z'),
      endDate: calendarEnd,
      notes: ''
    };
    const adapter = buildArbitrationAdapter({
      endDate: { pick: 'calendar', value: '2026-09-05T07:00:00.000Z', reason: 'calendar end matches the flyer' }
    });

    const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

    assert.equal(adapter.calls.length, 1, 'the endDate conflict must reach the arbitration prompt despite merge:"clobber"');
    assert.match(adapter.calls[0].prompt, /endDate/);
    assert.match(adapter.calls[0].prompt, /2026-09-05T07:00:00\.000Z/, 'the calendar candidate is serialized as ISO in the prompt');
    assert.match(adapter.calls[0].prompt, /2026-09-05T06:00:00\.000Z/, 'the scraped candidate is serialized as ISO in the prompt');
    // The verbatim ISO answer is accepted and the picked side's ORIGINAL value is applied
    assert.equal(finalEvent.endDate, calendarEnd, 'the calendar side keeps its original value (Date or ISO string)');
  }
});

test('clobber fallback still applies when date arbitration is unavailable', async () => {
  const core = createCore();
  const clobberPriorities = core.getResolvedFieldPriorities({
    fieldPriorities: { endDate: { priority: ['ai-web'], merge: 'clobber' } }
  });
  const scraped = {
    title: 'New Orleans',
    startDate: new Date('2026-09-05T01:00:00.000Z'),
    endDate: new Date('2026-09-05T06:00:00.000Z'),
    source: 'ai-web',
    _fieldPriorities: clobberPriorities,
    _parserConfig: TEST_AI_PARSER_CONFIG
  };
  const existing = {
    title: 'New Orleans',
    startDate: new Date('2026-09-05T01:00:00.000Z'),
    endDate: new Date('2026-09-05T07:00:00.000Z'),
    notes: ''
  };
  const adapter = buildArbitrationAdapter({}, { fail: true });

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  assert.equal(finalEvent.endDate.toISOString(), '2026-09-05T06:00:00.000Z', 'failed arbitration degrades to exactly the clobber behavior');
});

test('isCoordinatePair recognizes lat/lng strings only', () => {
  const core = createCore();
  assert.equal(core.isCoordinatePair('45.52, -122.65'), true);
  assert.equal(core.isCoordinatePair('45.52,-122.65'), true);
  assert.equal(core.isCoordinatePair('722 East Burnside Street'), false);
  assert.equal(core.isCoordinatePair('portland'), false);
  assert.equal(core.isCoordinatePair(''), false);
  assert.equal(core.isCoordinatePair('91, 10'), false, 'latitude out of range');
  assert.equal(core.isCoordinatePair('45, 181'), false, 'longitude out of range');
  assert.equal(core.isCoordinatePair(null), false);
  assert.equal(core.isCoordinatePair(undefined), false);
});

test('location merge is deterministic: coordinates always beat text/empty and never reach the AI', async () => {
  const core = createCore();
  const buildScraped = (location) => ({
    title: 'FURBALL',
    startDate: new Date('2026-07-05T22:00:00.000Z'),
    endDate: new Date('2026-07-06T02:00:00.000Z'),
    location,
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: TEST_AI_PARSER_CONFIG
  });
  const buildExisting = (location) => ({
    title: 'FURBALL',
    startDate: new Date('2026-07-05T22:00:00.000Z'),
    endDate: new Date('2026-07-06T02:00:00.000Z'),
    location,
    notes: ''
  });

  // (a) calendar has address text, scraped has coordinates → coordinates win, no AI call
  const adapterA = buildArbitrationAdapter({});
  const a = await core.createFinalEventObject(
    buildExisting('722 East Burnside Street, Portland'),
    buildScraped('45.52, -122.65'),
    { httpAdapter: adapterA }
  );
  assert.equal(a.location, '45.52, -122.65');
  assert.equal(adapterA.calls.length, 0, 'location must never be AI-arbitrated');

  // (b) calendar coordinates are preserved against an empty scrape and a text scrape
  const adapterB = buildArbitrationAdapter({});
  const bEmpty = await core.createFinalEventObject(
    buildExisting('45.52,-122.65'),
    buildScraped(''),
    { httpAdapter: adapterB }
  );
  assert.equal(bEmpty.location, '45.52,-122.65', 'an empty scrape must not wipe calendar coordinates');
  const bText = await core.createFinalEventObject(
    buildExisting('45.52,-122.65'),
    buildScraped('portland'),
    { httpAdapter: adapterB }
  );
  assert.equal(bText.location, '45.52,-122.65', 'scraped text must not displace calendar coordinates');

  // (c) both sides are coordinates but differ → the scraped (fresher) fix wins
  const cResult = await core.createFinalEventObject(
    buildExisting('40.7128, -74.0060'),
    buildScraped('45.52, -122.65'),
    { httpAdapter: adapterB }
  );
  assert.equal(cResult.location, '45.52, -122.65', 'scraped coordinates win over differing calendar coordinates');
  assert.equal(adapterB.calls.length, 0, 'no location scenario may consult the AI');
});

test('location preserve-on-empty: an empty scrape never clears a calendar location (text or coords)', async () => {
  // 2026-07-12 run findings: only calendar COORDINATES were protected — an empty
  // scraped location CLEARED a calendar location holding text ("clobbered 4
  // fields (startDate, endDate, url, location)" on the Atlanta event).
  const core = createCore();
  const buildScraped = (location) => ({
    title: 'ATL BEAR NIGHT',
    startDate: new Date('2026-07-05T22:00:00.000Z'),
    endDate: new Date('2026-07-06T02:00:00.000Z'),
    location,
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: TEST_AI_PARSER_CONFIG
  });
  const buildExisting = (location) => ({
    title: 'ATL BEAR NIGHT',
    startDate: new Date('2026-07-05T22:00:00.000Z'),
    endDate: new Date('2026-07-06T02:00:00.000Z'),
    location,
    notes: ''
  });
  const adapter = buildArbitrationAdapter({});

  // Calendar TEXT survives an empty scrape
  const keptText = await core.createFinalEventObject(
    buildExisting('2069 Cheshire Bridge Rd NE, Atlanta'),
    buildScraped(''),
    { httpAdapter: adapter }
  );
  assert.equal(keptText.location, '2069 Cheshire Bridge Rd NE, Atlanta', 'an empty scrape must not clear a text location');

  // Whitespace-only counts as empty
  const keptWhitespace = await core.createFinalEventObject(
    buildExisting('2069 Cheshire Bridge Rd NE, Atlanta'),
    buildScraped('   '),
    { httpAdapter: adapter }
  );
  assert.equal(keptWhitespace.location, '2069 Cheshire Bridge Rd NE, Atlanta', 'a whitespace scrape must not clear a text location');

  // Calendar COORDINATES survive an empty scrape (existing rule, unchanged)
  const keptCoords = await core.createFinalEventObject(
    buildExisting('33.8226, -84.3510'),
    buildScraped(''),
    { httpAdapter: adapter }
  );
  assert.equal(keptCoords.location, '33.8226, -84.3510');

  // Non-empty scraped coordinates still win over calendar text (unchanged)
  const coordsWin = await core.createFinalEventObject(
    buildExisting('2069 Cheshire Bridge Rd NE, Atlanta'),
    buildScraped('33.8226, -84.3510'),
    { httpAdapter: adapter }
  );
  assert.equal(coordsWin.location, '33.8226, -84.3510', 'scraped coordinates must still replace calendar text');

  assert.equal(adapter.calls.length, 0, 'location is never AI-arbitrated');
});

// ---------------------------------------------------------------------------
// Location follows the address decision (2026-07-15 run: "scraped coordinates
// win" rewrote stored pins with whatever the geocoder produced that day and
// would overwrite human-corrected pins)
// ---------------------------------------------------------------------------

const PIN_TEST_ADDRESS = '3911 Cedar Springs Rd, Dallas, TX 75219';

function buildPinScraped(overrides = {}) {
  const core = createCore();
  return {
    title: 'FURBALL',
    startDate: new Date('2026-07-05T22:00:00.000Z'),
    endDate: new Date('2026-07-06T02:00:00.000Z'),
    address: PIN_TEST_ADDRESS,
    location: '32.810535, -96.8110709',
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: TEST_AI_PARSER_CONFIG,
    ...overrides
  };
}

function buildPinExisting(overrides = {}, address = PIN_TEST_ADDRESS) {
  return {
    title: 'FURBALL',
    startDate: new Date('2026-07-05T22:00:00.000Z'),
    endDate: new Date('2026-07-06T02:00:00.000Z'),
    location: '32.810535, -96.8110709',
    notes: address ? `address: ${address}` : '',
    ...overrides
  };
}

async function capturePinMerge(core, existing, scraped, options) {
  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let finalEvent;
  try {
    finalEvent = await core.createFinalEventObject(existing, scraped, options);
  } finally {
    console.log = originalLog;
  }
  return { finalEvent, logLines };
}

test('unchanged address keeps the calendar pin; a divergent fresh geocode is flagged, not applied', async () => {
  const core = createCore();
  const adapter = buildArbitrationAdapter({});

  // Geocode jitter (well under the 0.4km threshold): pin kept, logged, but not flagged
  const near = await capturePinMerge(core,
    buildPinExisting(),
    buildPinScraped({ location: '32.8106, -96.8110709' }),
    { httpAdapter: adapter });
  assert.equal(near.finalEvent.location, '32.810535, -96.8110709', 'the calendar pin must survive geocode jitter');
  assert.ok(near.logLines.includes('📍 MERGE: "FURBALL" location kept calendar pin (address unchanged)'),
    `the kept pin is logged, got: ${JSON.stringify(near.logLines)}`);
  assert.ok(!near.logLines.some(line => line.includes('verify pin')), 'sub-threshold jitter is not flagged');
  assert.ok(!near.logLines.some(line => line.startsWith('🔄 MERGE:')),
    `a kept pin must not count as clobbered, got: ${JSON.stringify(near.logLines)}`);

  // Fresh geocode ~0.6km away: beyond the 0.4km threshold — flagged. Fresh
  // geocodes are grade-gated + cross-checked, so sub-km disagreement matters.
  const mid = await capturePinMerge(core,
    buildPinExisting(),
    buildPinScraped({ location: '32.816, -96.8110709' }),
    { httpAdapter: adapter });
  assert.equal(mid.finalEvent.location, '32.810535, -96.8110709', 'a sub-km divergence still keeps the pin');
  assert.ok(mid.logLines.some(line =>
    /^📍 MERGE: "FURBALL" calendar pin is 0\.6km from fresh geocode of the same address — verify pin$/.test(line)),
    `a 0.6km divergence is flagged, got: ${JSON.stringify(mid.logLines)}`);

  // Fresh geocode ~2km away: pin STILL kept (flag, don't drop), divergence flagged
  const far = await capturePinMerge(core,
    buildPinExisting(),
    buildPinScraped({ location: '32.8285, -96.8110709' }),
    { httpAdapter: adapter });
  assert.equal(far.finalEvent.location, '32.810535, -96.8110709', 'a divergent geocode must not silently move the pin');
  assert.ok(far.logLines.some(line =>
    /^📍 MERGE: "FURBALL" calendar pin is 2\.0km from fresh geocode of the same address — verify pin$/.test(line)),
    `the divergence is flagged with its distance, got: ${JSON.stringify(far.logLines)}`);

  // Identical pins stay quiet: no kept-pin line, no flag
  const same = await capturePinMerge(core, buildPinExisting(), buildPinScraped(), { httpAdapter: adapter });
  assert.equal(same.finalEvent.location, '32.810535, -96.8110709');
  assert.ok(!same.logLines.some(line => line.includes('kept calendar pin')), 'identical pins log nothing');

  assert.equal(adapter.calls.length, 0, 'location never consults the AI');
});

test('a changed address means the venue moved — scraped coordinates are adopted', async () => {
  const core = createCore();
  const movedAddress = '5025 Bowser Ave, Dallas, TX 75209';
  const adapter = buildArbitrationAdapter({
    address: { pick: 'scraped', value: movedAddress, reason: 'venue moved' }
  });

  const { finalEvent, logLines } = await capturePinMerge(core,
    buildPinExisting(),
    buildPinScraped({ address: movedAddress, location: '32.8285, -96.8300' }),
    { httpAdapter: adapter });

  assert.equal(finalEvent.address, movedAddress);
  assert.equal(finalEvent.location, '32.8285, -96.8300', 'a changed address adopts the fresh geocode');
  assert.ok(logLines.some(line => line.startsWith('🔄 MERGE:') && line.includes('location')),
    `the adopted pin is tracked as clobbered, got: ${JSON.stringify(logLines)}`);

  // A calendar event without coordinates is always filled by scraped ones
  const filled = await core.createFinalEventObject(
    buildPinExisting({ location: '' }),
    buildPinScraped(),
    { httpAdapter: buildArbitrationAdapter({}) });
  assert.equal(filled.location, '32.810535, -96.8110709', 'an empty calendar location is filled by the scrape');
});

test('when arbitration keeps the calendar address, the calendar pin is kept too', async () => {
  // The Eventbrite doubled-address bug: the scraped address is malformed, the
  // AI keeps picking the clean calendar value — the venue did NOT move, so the
  // pin must not follow the (rejected) scraped geocode. This only works if the
  // location decision is deferred until the final merged address is known.
  const core = createCore();
  const doubledAddress = `${PIN_TEST_ADDRESS}, Dallas, TX`;
  const adapter = buildArbitrationAdapter({
    address: { pick: 'calendar', value: PIN_TEST_ADDRESS, reason: 'clean address' }
  });

  const { finalEvent, logLines } = await capturePinMerge(core,
    buildPinExisting(),
    buildPinScraped({ address: doubledAddress, location: '32.8285, -96.8110709' }),
    { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 1, 'the address conflict itself still arbitrates');
  assert.equal(finalEvent.address, PIN_TEST_ADDRESS);
  assert.equal(finalEvent.location, '32.810535, -96.8110709',
    'the AI keeping the calendar address means the venue did not move — keep the calendar pin');
  assert.ok(logLines.includes('📍 MERGE: "FURBALL" location kept calendar pin (address unchanged)'),
    `the kept pin is logged, got: ${JSON.stringify(logLines)}`);
});

test('mergeParsedEvents: an empty location loses to the non-empty side (text and coordinates)', async () => {
  const core = createCore();
  const priorities = core.getResolvedFieldPriorities({});
  const adapter = buildArbitrationAdapter({});
  const buildEvent = (location) => ({
    title: 'ATL BEAR NIGHT',
    location,
    startDate: new Date('2026-07-05T22:00:00.000Z'),
    endDate: new Date('2026-07-06T02:00:00.000Z'),
    source: 'ai-web',
    _parserConfig: TEST_AI_PARSER_CONFIG,
    _fieldPriorities: priorities
  });

  // Existing TEXT survives an empty incoming
  const keptText = await core.mergeParsedEvents(
    buildEvent('2069 Cheshire Bridge Rd NE, Atlanta'),
    buildEvent(''),
    { httpAdapter: adapter }
  );
  assert.equal(keptText.location, '2069 Cheshire Bridge Rd NE, Atlanta', 'an empty incoming location must not clear existing text');

  // An empty existing is filled by incoming text
  const filled = await core.mergeParsedEvents(
    buildEvent(''),
    buildEvent('2069 Cheshire Bridge Rd NE, Atlanta'),
    { httpAdapter: adapter }
  );
  assert.equal(filled.location, '2069 Cheshire Bridge Rd NE, Atlanta');

  // Existing COORDINATES survive an empty incoming (coordinate rule, unchanged)
  const keptCoords = await core.mergeParsedEvents(
    buildEvent('33.8226, -84.3510'),
    buildEvent(''),
    { httpAdapter: adapter }
  );
  assert.equal(keptCoords.location, '33.8226, -84.3510');

  assert.equal(adapter.calls.length, 0, 'location resolves deterministically without AI');
});

test('mergeParsedEvents: coordinates beat text and degenerate ends lose, without AI', async () => {
  const core = createCore();
  const priorities = core.getResolvedFieldPriorities({});
  const adapter = buildArbitrationAdapter({});

  const existing = {
    title: 'FURBALL',
    location: '45.52, -122.65',
    startDate: new Date('2026-07-05T22:00:00.000Z'),
    endDate: new Date('2026-07-05T22:00:00.000Z'), // degenerate: end == start
    source: 'ai-web',
    _fieldPriorities: priorities
  };
  const incoming = {
    title: 'FURBALL',
    location: '722 East Burnside Street',
    startDate: new Date('2026-07-05T22:00:00.000Z'),
    endDate: new Date('2026-07-06T02:00:00.000Z'),
    source: 'ai-web',
    _parserConfig: TEST_AI_PARSER_CONFIG,
    _fieldPriorities: priorities
  };

  const merged = await core.mergeParsedEvents(existing, incoming, { httpAdapter: adapter });
  assert.equal(merged.location, '45.52, -122.65', 'coordinates beat text regardless of which side has them');
  assert.equal(merged.endDate.toISOString(), '2026-07-06T02:00:00.000Z', 'the positive-duration end wins');
  assert.equal(adapter.calls.length, 0, 'both rules resolve deterministically without AI');
});

// ---------------------------------------------------------------------------
// Wall-clock vs timezone-anchored dates across merges (2026-07-13 run findings:
// "BEARS IN SPACE" — the segment record's wall-clock 22:00Z survived the merge
// with the detail page's JSON-LD-anchored 05:00Z, the _timezoneUnresolved flag
// was dropped, and nothing re-anchored after dedup)
// ---------------------------------------------------------------------------

test('mergeParsedEvents: timezone-anchored dates beat wall-clock dates in both directions', async () => {
  const core = createCore();
  const priorities = core.getResolvedFieldPriorities({});
  const adapter = buildArbitrationAdapter({});

  const wallClock = {
    title: 'BEARS IN SPACE',
    startDate: new Date('2026-07-25T22:00:00.000Z'), // flyer said 10PM PT; stored as wall-clock UTC
    endDate: new Date('2026-07-26T00:00:00.000Z'),
    source: 'ai-web',
    _timezoneUnresolved: true,
    _fieldPriorities: priorities
  };
  const anchored = {
    title: 'BEARS IN SPACE',
    startDate: new Date('2026-07-26T05:00:00.000Z'), // 10PM PT as the real instant
    endDate: new Date('2026-07-26T09:00:00.000Z'),
    city: 'sf',
    timezone: 'America/Los_Angeles',
    source: 'ai-web',
    _parserConfig: TEST_AI_PARSER_CONFIG,
    _fieldPriorities: priorities
  };

  // Flagged record is EXISTING (the real failure: the same-priority tie-break
  // kept the existing wall-clock dates)
  const mergedA = await core.mergeParsedEvents({ ...wallClock }, { ...anchored }, { httpAdapter: adapter });
  assert.equal(mergedA.startDate.toISOString(), '2026-07-26T05:00:00.000Z', 'anchored start wins over existing wall-clock');
  assert.equal(mergedA.endDate.toISOString(), '2026-07-26T09:00:00.000Z', 'anchored end wins over existing wall-clock');
  assert.equal(mergedA._timezoneUnresolved, undefined, 'the flag must not describe anchored dates');

  // Flagged record is INCOMING (base spread would otherwise carry both the
  // wall-clock dates and the flag)
  const mergedB = await core.mergeParsedEvents({ ...anchored }, { ...wallClock }, { httpAdapter: adapter });
  assert.equal(mergedB.startDate.toISOString(), '2026-07-26T05:00:00.000Z', 'anchored start wins over incoming wall-clock');
  assert.equal(mergedB.endDate.toISOString(), '2026-07-26T09:00:00.000Z', 'anchored end wins over incoming wall-clock');
  assert.equal(mergedB._timezoneUnresolved, undefined, 'the incoming flag must not survive onto anchored dates');

  assert.equal(adapter.calls.length, 0, 'the wall-clock rule resolves deterministically without AI');
});

test('mergeParsedEvents: the wall-clock flag follows the record that supplied the dates', async () => {
  const core = createCore();
  const priorities = core.getResolvedFieldPriorities({});
  const adapter = buildArbitrationAdapter({});

  // Both records flagged: the merged dates are still wall-clock → flag stays.
  const bothFlagged = await core.mergeParsedEvents(
    { title: 'BEARS IN SPACE', startDate: new Date('2026-07-25T22:00:00.000Z'), source: 'ai-web', _timezoneUnresolved: true, _fieldPriorities: priorities },
    { title: 'BEARS IN SPACE', startDate: new Date('2026-07-25T22:00:00.000Z'), source: 'ai-web', _timezoneUnresolved: true, _fieldPriorities: priorities },
    { httpAdapter: adapter }
  );
  assert.equal(bothFlagged._timezoneUnresolved, true, 'both-flagged merges must keep the flag for downstream re-anchoring');

  // Flagged side wins because the anchored side has no dates → flag propagates
  // even though the base record (incoming) was unflagged.
  const flaggedDatesWon = await core.mergeParsedEvents(
    { title: 'BEARS IN SPACE', startDate: new Date('2026-07-25T22:00:00.000Z'), source: 'ai-web', _timezoneUnresolved: true, _fieldPriorities: priorities },
    { title: 'BEARS IN SPACE', source: 'ai-web', _fieldPriorities: priorities },
    { httpAdapter: adapter }
  );
  assert.equal(flaggedDatesWon.startDate.toISOString(), '2026-07-25T22:00:00.000Z', 'the only available date wins');
  assert.equal(flaggedDatesWon._timezoneUnresolved, true, 'wall-clock dates keep their flag');
  assert.equal(adapter.calls.length, 0);
});

test('deduplicateEvents re-anchors wall-clock dates once the merged event has a resolvable city', async () => {
  const core = new SharedCore(
    { sf: { timezone: 'America/Los_Angeles', patterns: ['sf', 'san francisco'] } },
    { eventSchema: EventSchema }
  );
  // Two flagged records of the same event; only one knows the city (in the real
  // run the city was resolved during merge arbitration). The merge keeps the
  // wall-clock dates + flag, and the post-merge pass must convert them.
  const segmentA = {
    title: 'BEARS IN SPACE',
    bar: 'The Stud',
    startDate: new Date('2026-07-25T22:00:00.000Z'), // 10PM PT wall-clock
    endDate: new Date('2026-07-26T00:00:00.000Z'),
    source: 'ai-web',
    _timezoneUnresolved: true
  };
  const segmentB = { ...segmentA, city: 'sf' };

  const result = await core.deduplicateEvents([segmentA, segmentB], null);
  assert.equal(result.length, 1, 'same key merges');
  const merged = result[0];
  // 10PM wall-clock in America/Los_Angeles (PDT, UTC-7) is 05:00Z the next day
  assert.equal(merged.startDate.toISOString(), '2026-07-26T05:00:00.000Z');
  assert.equal(merged.endDate.toISOString(), '2026-07-26T07:00:00.000Z');
  assert.equal(merged.timezone, 'America/Los_Angeles');
  assert.equal(merged._timezoneUnresolved, undefined, 're-anchoring must clear the flag');
});

// ---------------------------------------------------------------------------
// Identity-verified cross-parser dedup (2026-07-12 run findings)
// ---------------------------------------------------------------------------

test('normalizeTicketUrlForIdentity ignores bare-domain promoter homepages', () => {
  const core = createCore();
  // Two DIFFERENT events by the same promoter both list "bearracuda.com" — a bare
  // domain must not act as an identity signal.
  assert.equal(core.normalizeTicketUrlForIdentity('https://bearracuda.com'), '');
  assert.equal(core.normalizeTicketUrlForIdentity('https://www.bearracuda.com/'), '');
  assert.equal(
    core.normalizeTicketUrlForIdentity('https://www.sickening.events/e/treasurechi/tickets'),
    'sickening.events/e/treasurechi/tickets'
  );
  assert.equal(core.normalizeTicketUrlForIdentity('https://site.example?eventid=5'), 'site.example?eventid=5');
});

test('deduplicateEvents keeps different-venue events separate despite a key collision', async () => {
  const core = createCore();
  // Real scenario: Bearracuda ran TWO events in Portland on the same night, and the
  // configured keyTemplate collapses to promoter+date+city for both.
  const parserConfig = { keyTemplate: 'bearracuda-${date}-${city}' };
  const treasureTrail = {
    title: 'TREASURE TRAIL Portland PRIDE',
    bar: 'Sanctuary',
    address: '33 Northwest 9th Avenue, Portland, OR, 97209',
    city: 'portland',
    timezone: 'America/Los_Angeles',
    startDate: new Date('2026-07-18T03:00:00.000Z'),
    source: 'ai-web',
    _parserConfig: parserConfig
  };
  const prideFriday = {
    title: 'Portland PRIDE FRIDAY | BEARRACUDA',
    bar: 'NOVA PDX',
    address: '722 East Burnside Street, Portland, OR, 97214',
    city: 'portland',
    timezone: 'America/Los_Angeles',
    startDate: new Date('2026-07-18T04:00:00.000Z'),
    source: 'ai-web',
    _parserConfig: parserConfig
  };

  const result = await core.deduplicateEvents([treasureTrail, prideFriday], null);
  assert.equal(result.length, 2, 'different venues on the same night are different events');
  assert.notEqual(result[0].key, result[1].key, 'the collision must be disambiguated');
});

test('deduplicateEvents merges the same event across parsers when keys diverge', async () => {
  const core = createCore();
  // Real scenario: the bearracuda.com scrape lost its start time (midnight default,
  // UTC date July 25) while the sickening.events version had 9pm (UTC date July 26)
  // — different keys, same event.
  const degraded = {
    title: 'Treasure Trail Chicago',
    bar: 'Cell Block',
    address: '3702 N Halsted',
    city: 'chicago',
    timezone: 'America/Chicago',
    startDate: new Date('2026-07-25T05:00:00.000Z'), // midnight CDT
    source: 'ai-web'
  };
  const complete = {
    title: 'Treasure Trail Chicago LAUNCH PARTY',
    bar: 'Cell Block',
    address: '3702 North Halsted Street, Chicago, IL, 60613',
    city: 'chicago',
    timezone: 'America/Chicago',
    startDate: new Date('2026-07-26T02:00:00.000Z'), // 9pm CDT, same local day
    source: 'ai-web'
  };

  assert.notEqual(core.createEventKey(degraded), core.createEventKey(complete), 'precondition: keys diverge');
  const result = await core.deduplicateEvents([degraded, complete], null);
  assert.equal(result.length, 1, 'same venue + same local day + similar names must merge');
});

test('deduplicateEvents merges same-venue variants that each collided with a different-venue holder', async () => {
  const core = createCore();
  // Real scenario: "Portland PRIDE FRIDAY | BEARRACUDA" (bearracuda.com) and
  // "Bearracuda Portland:PRIDE FRIDAY" (sickening.events) are the SAME event.
  // Each collided with TREASURE TRAIL (different venue, same promoter/night/city),
  // each got vetoed and suffixed — but they must still be compared to each other.
  const parserConfig = { keyTemplate: 'bearracuda-${date}-${city}' };
  const treasureTrail = {
    title: 'TREASURE TRAIL Portland PRIDE',
    bar: 'Sanctuary',
    address: '33 Northwest 9th Avenue, Portland, OR, 97209',
    city: 'portland',
    timezone: 'America/Los_Angeles',
    startDate: new Date('2026-07-18T03:00:00.000Z'),
    source: 'ai-web',
    _parserConfig: parserConfig
  };
  const prideFridayWeb = {
    title: 'Portland PRIDE FRIDAY | BEARRACUDA',
    bar: 'NOVA PDX',
    city: 'portland',
    timezone: 'America/Los_Angeles',
    startDate: new Date('2026-07-18T04:00:00.000Z'),
    source: 'ai-web',
    _parserConfig: parserConfig
  };
  const prideFridayTickets = {
    title: 'Bearracuda Portland:PRIDE FRIDAY',
    bar: 'Nova PDX',
    city: 'portland',
    timezone: 'America/Los_Angeles',
    startDate: new Date('2026-07-18T04:30:00.000Z'),
    source: 'sickening-events',
    _parserConfig: parserConfig
  };

  const result = await core.deduplicateEvents([treasureTrail, prideFridayWeb, prideFridayTickets], null);
  assert.equal(result.length, 2, 'the two Nova PDX records are one event; Treasure Trail stays separate');
  const treasure = result.find(event => event.bar === 'Sanctuary');
  assert.ok(treasure, 'the different-venue event must survive untouched');
  const merged = result.find(event => event !== treasure);
  assert.ok(/--2$/.test(merged.key), 'the merged event keeps the suffixed collision key');
});

test('deduplicateEvents merges a vetoed event into a suffixed holder via the identity scan', async () => {
  const core = createCore();
  // The venue text of the two same-event records is too different for the place
  // comparison, but they share a ticket URL — the identity scan must catch it.
  const parserConfig = { keyTemplate: 'bearracuda-${date}-${city}' };
  const treasureTrail = {
    title: 'TREASURE TRAIL Portland PRIDE',
    bar: 'Sanctuary',
    city: 'portland',
    timezone: 'America/Los_Angeles',
    startDate: new Date('2026-07-18T03:00:00.000Z'),
    source: 'ai-web',
    _parserConfig: parserConfig
  };
  const prideFridaySuffixed = {
    title: 'Portland PRIDE FRIDAY',
    bar: 'NOVA PDX',
    city: 'portland',
    timezone: 'America/Los_Angeles',
    startDate: new Date('2026-07-18T04:00:00.000Z'),
    ticketUrl: 'https://www.sickening.events/e/pridefriday/tickets',
    source: 'ai-web',
    _parserConfig: parserConfig
  };
  const prideFridayIncoming = {
    title: 'PRIDE FRIDAY',
    bar: '722 East Burnside Warehouse',
    city: 'portland',
    timezone: 'America/Los_Angeles',
    startDate: new Date('2026-07-18T05:00:00.000Z'),
    ticketUrl: 'https://www.sickening.events/e/pridefriday/tickets',
    source: 'sickening-events',
    _parserConfig: parserConfig
  };

  assert.equal(
    core.areEventsDistinctByPlace(prideFridayIncoming, prideFridaySuffixed),
    true,
    'precondition: the place comparison alone cannot pair these two records'
  );
  const result = await core.deduplicateEvents([treasureTrail, prideFridaySuffixed, prideFridayIncoming], null);
  assert.equal(result.length, 2, 'shared ticketUrl on the same local day must merge the vetoed event');
});

test('deduplicateEvents still merges plain key-collision duplicates', async () => {
  const core = createCore();
  const first = {
    title: 'FURBALL DALLAS',
    bar: 'STATION 4',
    city: 'dallas',
    timezone: 'America/Chicago',
    startDate: new Date('2026-07-05T22:00:00.000Z'),
    source: 'ai-web'
  };
  const second = { ...first, description: 'second copy' };
  const result = await core.deduplicateEvents([first, second], null);
  assert.equal(result.length, 1);
});

test('relaxed identity signal matches same-local-day despite degraded start times', () => {
  const core = createCore();
  const a = { title: 'Treasure Trail Chicago', bar: 'Cell Block', timezone: 'America/Chicago', startDate: new Date('2026-07-25T05:00:00.000Z') };
  const b = { title: 'Treasure Trail Chicago LAUNCH PARTY', bar: 'Cell Block', timezone: 'America/Chicago', startDate: new Date('2026-07-26T02:00:00.000Z') };
  assert.equal(core.getSameEventIdentitySignal(a, b), null, 'strict signal requires close start times');
  assert.equal(core.getSameEventIdentitySignal(a, b, { requireCloseStartTimes: false }), 'place-day-name');
});

test('filterEventsForExecution excludes events from dry-run parsers', () => {
  const live = { title: 'Live Event', _parserConfig: { name: 'Live Parser', dryRun: false } };
  const dry = { title: 'Dry Event', _parserConfig: { name: 'Dry Parser', dryRun: true } };
  const unstamped = { title: 'No Parser Config' };
  const result = SharedCore.filterEventsForExecution([live, dry, unstamped]);
  assert.deepEqual(result.map(e => e.title), ['Live Event', 'No Parser Config']);
});

test('filterEventsForExecution tolerates non-array input', () => {
  assert.deepEqual(SharedCore.filterEventsForExecution(null), []);
  assert.deepEqual(SharedCore.filterEventsForExecution(undefined), []);
});

// ---------------------------------------------------------------------------
// Automation filtering (resolveAutomationContext / evaluateAutomationForParser)
// ---------------------------------------------------------------------------

test('resolveAutomationContext detects automation runs from runtime flags', () => {
  const core = createCore();
  assert.deepEqual(
    core.resolveAutomationContext({ runtime: { automationRun: true } }),
    { automationRun: true, filterParsers: true }
  );
  assert.deepEqual(
    core.resolveAutomationContext({ runtime: { type: 'automated' } }),
    { automationRun: true, filterParsers: true }
  );
  // Legacy fallback: runContext is consulted when runtime is absent
  assert.deepEqual(
    core.resolveAutomationContext({ runContext: { automationRun: true } }),
    { automationRun: true, filterParsers: true }
  );
});

test('resolveAutomationContext: automationFilter false disables parser filtering', () => {
  const core = createCore();
  assert.deepEqual(
    core.resolveAutomationContext({ runtime: { automationRun: true, automationFilter: false } }),
    { automationRun: true, filterParsers: false }
  );
});

test('resolveAutomationContext treats manual and empty configs as non-automation', () => {
  const core = createCore();
  assert.deepEqual(core.resolveAutomationContext({}), { automationRun: false, filterParsers: false });
  assert.deepEqual(core.resolveAutomationContext(null), { automationRun: false, filterParsers: false });
  assert.deepEqual(
    core.resolveAutomationContext({ runtime: { automationRun: false } }),
    { automationRun: false, filterParsers: false }
  );
});

test('evaluateAutomationForParser defaults automationEnabled to true; explicit false opts out', () => {
  const core = createCore();
  const filtering = { automationRun: true, filterParsers: true };
  assert.deepEqual(
    core.evaluateAutomationForParser({ automationEnabled: true }, filtering),
    { shouldRun: true, reason: null }
  );
  assert.deepEqual(
    core.evaluateAutomationForParser({ automationEnabled: false }, filtering),
    { shouldRun: false, reason: 'automation-disabled' }
  );
  // Absence now means enabled (the default flipped from opt-in to opt-out)
  assert.deepEqual(
    core.evaluateAutomationForParser({ name: 'No Flag' }, filtering),
    { shouldRun: true, reason: null }
  );
  assert.deepEqual(
    core.evaluateAutomationForParser(null, filtering),
    { shouldRun: false, reason: 'automation-disabled' }
  );
});

test('evaluateAutomationForParser lets everything run when filtering is off', () => {
  const core = createCore();
  const noFiltering = { automationRun: false, filterParsers: false };
  assert.deepEqual(core.evaluateAutomationForParser({ automationEnabled: false }, noFiltering), { shouldRun: true, reason: null });
  assert.deepEqual(core.evaluateAutomationForParser({}, noFiltering), { shouldRun: true, reason: null });
  assert.deepEqual(core.evaluateAutomationForParser({}, null), { shouldRun: true, reason: null });
});

// ---------------------------------------------------------------------------
// Global → parser config inheritance (resolveEffectiveParserConfig)
// ---------------------------------------------------------------------------

test('resolveEffectiveParserConfig inherits global ai; per-parser keys win key-wise', () => {
  const core = createCore();
  const mainConfig = {
    config: {
      ai: {
        endpoint: 'http://global.example:8000/v1/chat/completions',
        model: 'global-model',
        numPredict: 2000,
        openai: { responseFormat: 'json_object' }
      }
    }
  };

  // Parser with no ai block inherits the whole global block
  const inherited = core.resolveEffectiveParserConfig({ name: 'Plain' }, mainConfig);
  assert.equal(inherited.ai.endpoint, 'http://global.example:8000/v1/chat/completions');
  assert.equal(inherited.ai.model, 'global-model');
  assert.equal(inherited.name, 'Plain');

  // Per-parser keys override while untouched global keys are retained,
  // including key-wise merges of nested objects (openai)
  const overridden = core.resolveEffectiveParserConfig(
    { name: 'Override', ai: { numPredict: 500, openai: { apiKey: 'k' } } },
    mainConfig
  );
  assert.equal(overridden.ai.numPredict, 500);
  assert.equal(overridden.ai.endpoint, 'http://global.example:8000/v1/chat/completions');
  assert.deepEqual(overridden.ai.openai, { responseFormat: 'json_object', apiKey: 'k' });
});

test('resolveEffectiveParserConfig inherits global ocr with the getOcrConfig precedence', () => {
  const core = createCore();
  const mainConfig = {
    config: {
      ocr: {
        provider: 'openai',
        endpoint: 'http://global.example:8001/v1/chat/completions',
        model: 'global-vision-model',
        maxImages: 2
      }
    }
  };

  // No parser ocr anywhere → global lands as the top-level ocr block
  const inherited = core.resolveEffectiveParserConfig({ name: 'Plain' }, mainConfig);
  assert.equal(inherited.ocr.endpoint, 'http://global.example:8001/v1/chat/completions');
  assert.equal(inherited.ai, undefined, 'no ai block should be fabricated');

  // Parser ai.ocr wins key-wise and stays in its canonical ai.ocr slot
  const viaAi = core.resolveEffectiveParserConfig(
    { name: 'AiOcr', ai: { ocr: { model: 'parser-model' } } },
    mainConfig
  );
  assert.equal(viaAi.ai.ocr.model, 'parser-model');
  assert.equal(viaAi.ai.ocr.endpoint, 'http://global.example:8001/v1/chat/completions');

  // Top-level parser ocr merges in place too
  const viaTop = core.resolveEffectiveParserConfig(
    { name: 'TopOcr', ocr: { maxImages: 4 } },
    mainConfig
  );
  assert.equal(viaTop.ocr.maxImages, 4);
  assert.equal(viaTop.ocr.model, 'global-vision-model');
});

test('resolveEffectiveParserConfig without global blocks returns the parser entry untouched', () => {
  const core = createCore();
  const parserEntry = { name: 'Plain', ai: { model: 'mine' }, discoveryBlockedPatterns: ['/x'] };
  assert.equal(core.resolveEffectiveParserConfig(parserEntry, { config: {} }), parserEntry);
  assert.equal(core.resolveEffectiveParserConfig(parserEntry, null), parserEntry);
});

test('top-level config.bearCheck is an alias for config.ai.bearCheck and reaches getBearCheckMode', () => {
  const core = createCore();

  // Top-level alias with NO global ai block at all (the real-world case):
  // it must still fold into the parser's ai.bearCheck and drive enforce mode.
  const aliasOnly = core.resolveEffectiveParserConfig(
    { name: 'Bearracuda', alwaysBear: false },
    { config: { bearCheck: { mode: 'enforce' } } }
  );
  assert.deepEqual(aliasOnly.ai.bearCheck, { mode: 'enforce' });
  assert.equal(core.getBearCheckMode(aliasOnly), 'enforce');

  // Canonical config.ai.bearCheck wins when BOTH are set.
  const both = core.resolveEffectiveParserConfig(
    { name: 'B' },
    { config: { bearCheck: { mode: 'enforce' }, ai: { bearCheck: { mode: 'off' }, model: 'm' } } }
  );
  assert.equal(core.getBearCheckMode(both), 'off');
  assert.equal(both.ai.model, 'm', 'the rest of the global ai block still inherits');

  // A per-parser ai.bearCheck still wins over the top-level alias.
  const perParser = core.resolveEffectiveParserConfig(
    { name: 'B', ai: { bearCheck: { mode: 'report' } } },
    { config: { bearCheck: { mode: 'enforce' } } }
  );
  assert.equal(core.getBearCheckMode(perParser), 'report');

  // The alias folds into an existing global ai block that lacks bearCheck.
  const intoExistingAi = core.resolveEffectiveParserConfig(
    { name: 'B' },
    { config: { bearCheck: { mode: 'enforce' }, ai: { model: 'global-m' } } }
  );
  assert.equal(core.getBearCheckMode(intoExistingAi), 'enforce');
  assert.equal(intoExistingAi.ai.model, 'global-m');
});

test('resolveEffectiveParserConfig unions global discoveryBlockedPatterns with the parser list', () => {
  const core = createCore();
  const globalPattern = /\/(shop|cart)(?:\/|[?#]|$)/;
  const mainConfig = { config: { discoveryBlockedPatterns: [globalPattern, '/_api/'] } };

  const merged = core.resolveEffectiveParserConfig(
    { name: 'Union', discoveryBlockedPatterns: ['example.com/?p='] },
    mainConfig
  );
  assert.deepEqual(merged.discoveryBlockedPatterns, [globalPattern, '/_api/', 'example.com/?p=']);

  const globalOnly = core.resolveEffectiveParserConfig({ name: 'NoOwn' }, mainConfig);
  assert.deepEqual(globalOnly.discoveryBlockedPatterns, [globalPattern, '/_api/']);
});

test('merge arbitration still resolves the global ai block through inherited parser configs', () => {
  const core = createCore();
  const globalConfig = { ai: { model: 'global-arbiter', arbitrateMerges: true } };
  const effective = core.resolveEffectiveParserConfig({ name: 'Plain' }, { config: globalConfig });
  const viaInheritance = core.getMergeArbitrationConfig({ _parserConfig: effective }, globalConfig);
  // Same resolution as the pre-inheritance global fallback path
  const viaFallback = core.getMergeArbitrationConfig({ _parserConfig: { name: 'Plain' } }, globalConfig);
  assert.deepEqual(viaInheritance, viaFallback);
  assert.equal(viaInheritance.model, 'global-arbiter');
});

test('detectParserFromUrl (the parser:"auto" resolver) maps scheme URLs and falls back to ai-web', () => {
  const core = createCore();
  assert.equal(core.detectParserFromUrl('scriptable-input://event'), 'scriptable-input');
  assert.equal(core.detectParserFromUrl('ai-web://https://example.com'), 'ai-web');
  // Former site-specific parser domains no longer dispatch anywhere special —
  // those parsers are deleted; every http(s) URL resolves to the generic parser.
  assert.equal(core.detectParserFromUrl('https://bearracuda.com'), 'ai-web');
  assert.equal(core.detectParserFromUrl('https://www.chunk-party.com'), 'ai-web');
  assert.equal(core.detectParserFromUrl('https://linktr.ee/cubhouse'), 'ai-web');
  assert.equal(core.detectParserFromUrl('https://www.eventbrite.com/o/some-org-123'), 'ai-web');
  assert.equal(core.detectParserFromUrl(''), 'ai-web');
});

test('detectSourceFromUrl keeps legacy source labels for dedup keys (never dispatch)', () => {
  const core = createCore();
  assert.equal(core.detectSourceFromUrl('https://bearracuda.com/events/portland'), 'bearracuda');
  assert.equal(core.detectSourceFromUrl('https://www.chunk-party.com'), 'chunk');
  assert.equal(core.detectSourceFromUrl('https://linktr.ee/cubhouse'), 'linktree');
  assert.equal(core.detectSourceFromUrl('https://redeyetickets.com/e/1'), 'redeyetickets');
  assert.equal(core.detectSourceFromUrl('scriptable-input://event'), 'scriptable-input');
  assert.equal(core.detectSourceFromUrl('https://www.eventbrite.com/o/some-org-123'), null);
  assert.equal(core.detectSourceFromUrl(''), null);
});

test('processParser: absent parser pins ai-web; parser:"auto" resolves schemes only (deleted-site URLs → ai-web)', async () => {
  const core = createCore();
  const display = createDisplayAdapterStub();
  const httpAdapter = {
    fetchData: async (url) => ({ html: '<html><body></body></html>', url, statusCode: 200, headers: {} })
  };
  const makeParsers = (parseCalls) => {
    const stubParser = (name) => ({
      parseEvents: () => {
        parseCalls.push(name);
        return { events: [], additionalLinks: [] };
      }
    });
    return {
      'ai-web': stubParser('ai-web'),
      'scriptable-input': stubParser('scriptable-input'),
      pinned: stubParser('pinned')
    };
  };
  const entry = (extra) => ({
    name: 'Dispatch',
    urls: ['https://www.chunk-party.com', 'https://linktr.ee/dispatch'],
    ai: { classifyPages: false }, // keep the crawl deterministic (no AI second opinion)
    ...extra
  });

  // Absent parser → pinned ai-web for every URL
  const absentCalls = [];
  const absent = await core.processParser(entry({}), {}, httpAdapter, display, makeParsers(absentCalls));
  assert.equal(absent.parserType, 'ai-web');
  assert.deepEqual(absentCalls, ['ai-web', 'ai-web'], 'no per-URL auto-switching without parser:"auto"');

  // parser: "auto" + former site-specific domains → ai-web now (those parsers
  // are deleted; their domains no longer resolve to anything special)
  const autoCalls = [];
  const auto = await core.processParser(entry({ parser: 'auto' }), {}, httpAdapter, display, makeParsers(autoCalls));
  assert.equal(auto.parserType, 'ai-web');
  assert.deepEqual(autoCalls, ['ai-web', 'ai-web']);

  // parser: "auto" + a scriptable-input:// URL (the share-sheet URL-input path)
  // still resolves to the scriptable-input parser
  const shareCalls = [];
  const share = await core.processParser(
    entry({ parser: 'auto', urls: ['scriptable-input://event'] }),
    {}, httpAdapter, display, makeParsers(shareCalls)
  );
  assert.equal(share.parserType, 'scriptable-input');
  assert.deepEqual(shareCalls, ['scriptable-input']);

  // Explicit parser names keep working unchanged (pinned, no switching)
  const explicitCalls = [];
  const explicit = await core.processParser(entry({ parser: 'pinned' }), {}, httpAdapter, display, makeParsers(explicitCalls));
  assert.equal(explicit.parserType, 'pinned');
  assert.deepEqual(explicitCalls, ['pinned', 'pinned']);
});

// ---------------------------------------------------------------------------
// processEvents automation behavior
// ---------------------------------------------------------------------------

function createDisplayAdapterStub() {
  const logs = [];
  const log = async (message) => { logs.push(message); };
  return { logs, logInfo: log, logWarn: log, logError: log, logSuccess: log };
}

// Parser configs with no URLs exercise the real processParser without HTTP:
// the crawl loop is a no-op, so only the enable/skip branching is under test.
// The 'ai-web' entry exists because parser-less configs fall back to it.
const STUB_PARSERS = { 'ai-web': {} };

test('processEvents: enabled:false + automationEnabled:true RUNS in automation mode (intentional rule)', async () => {
  const core = createCore();
  const display = createDisplayAdapterStub();
  const config = {
    runtime: { automationRun: true },
    parsers: [
      { name: 'Disabled But Automated', enabled: false, automationEnabled: true, urls: [] },
      { name: 'No Automation Flag', enabled: true, urls: [] },
      { name: 'Automation Opt-Out', enabled: true, automationEnabled: false, urls: [] }
    ]
  };

  const results = await core.processEvents(config, {}, display, STUB_PARSERS);

  assert.deepEqual(results.parserResults.map(r => r.name), ['Disabled But Automated', 'No Automation Flag'],
    '"enabled" is a manual-run switch; automation honors automationEnabled (default true, explicit false opts out)');
  assert.deepEqual(results.automationSkippedParsers,
    [{ name: 'Automation Opt-Out', reason: 'automation-disabled' }]);
});

test('processEvents: manual runs honor enabled and ignore automationEnabled', async () => {
  const core = createCore();
  const display = createDisplayAdapterStub();
  const config = {
    parsers: [
      { name: 'Disabled But Automated', enabled: false, automationEnabled: true, urls: [] },
      { name: 'Plain Manual Parser', urls: [] }
    ]
  };

  const results = await core.processEvents(config, {}, display, STUB_PARSERS);

  assert.deepEqual(results.parserResults.map(r => r.name), ['Plain Manual Parser']);
  assert.equal(results.automationSkippedParsers, undefined, 'no automation bookkeeping on manual runs');
});

test('processEvents: automationFilter false runs every parser except manually-disabled ones', async () => {
  const core = createCore();
  const display = createDisplayAdapterStub();
  const config = {
    runtime: { automationRun: true, automationFilter: false },
    parsers: [
      { name: 'No Automation Flag', urls: [] },
      { name: 'Manually Disabled', enabled: false, urls: [] }
    ]
  };

  const results = await core.processEvents(config, {}, display, STUB_PARSERS);
  assert.deepEqual(results.parserResults.map(r => r.name), ['No Automation Flag'],
    'with filtering off, enabled:false applies again and automationEnabled is not required');
});

test('processEvents returns empty results when no parsers are configured', async () => {
  const core = createCore();
  const display = createDisplayAdapterStub();
  const results = await core.processEvents({ parsers: [] }, {}, display, STUB_PARSERS);
  assert.equal(results.totalEvents, 0);
  assert.deepEqual(results.allProcessedEvents, []);
  assert.deepEqual(results.parserResults, []);
});

// ---------------------------------------------------------------------------
// createEventKey / keyTemplate
// ---------------------------------------------------------------------------

test('createEventKey substitutes ${date}, ${city}, ${venue}, and ${normalizedTitle}', () => {
  const core = createCore();
  const event = {
    title: 'MEGA WOOF! / Dallas',
    bar: ' The Eagle ',
    city: 'dallas',
    startDate: new Date('2026-08-01T21:00:00.000Z'),
    _parserConfig: { keyTemplate: 'promo-${date}-${city}-${venue}' }
  };
  assert.equal(core.createEventKey(event), 'promo-2026-08-01-dallas-the eagle');

  const normalized = core.createEventKey(event, '${normalizedTitle}');
  assert.equal(normalized, 'mega-woof-dallas', 'specials between words collapse to hyphens');
});

test('createEventKey falls back to normalizedTitle|date|venue without a keyTemplate', () => {
  const core = createCore();
  const event = {
    title: 'Bear Night',
    bar: 'The Eagle',
    city: 'dallas',
    startDate: new Date('2026-08-01T21:00:00.000Z')
  };
  assert.equal(core.createEventKey(event), 'bear-night|2026-08-01|the eagle');
});

test('createEventKey title normalization strips trailing punctuation and collapses runs', () => {
  const core = createCore();
  const key = (title) => core.createEventKey({ title, startDate: new Date('2026-08-01T00:00:00.000Z') }, '${normalizedTitle}');
  assert.equal(key('Party!!!'), 'party');
  assert.equal(key('BEARRACUDA:  Invasion'), 'bearracuda-invasion');
  assert.equal(key('  spaced   out  '), 'spaced-out');
  assert.equal(key('a...b'), 'a-b');
});

test('createEventKey uses originalTitle over title and the UTC date of startDate', () => {
  const core = createCore();
  const event = {
    title: 'Renamed Event',
    originalTitle: 'Original Name',
    bar: 'Somewhere',
    startDate: '2026-08-02T01:00:00.000Z' // string input; late-night UTC date is kept as-is
  };
  assert.equal(core.createEventKey(event), 'original-name|2026-08-02|somewhere');
});

// ---------------------------------------------------------------------------
// filterFutureEvents
// ---------------------------------------------------------------------------

test('filterFutureEvents drops past events unless allowPastEvents is set', () => {
  const core = createCore();
  const past = { title: 'Yesterday', startDate: new Date(Date.now() - 24 * 60 * 60 * 1000) };
  const future = { title: 'Tomorrow', startDate: new Date(Date.now() + 24 * 60 * 60 * 1000) };

  assert.deepEqual(core.filterFutureEvents([past, future]).map(e => e.title), ['Tomorrow']);
  assert.deepEqual(
    core.filterFutureEvents([past, future], null, true).map(e => e.title),
    ['Yesterday', 'Tomorrow'],
    'allowPastEvents keeps past events'
  );
});

test('filterFutureEvents enforces the daysToLookAhead cutoff', () => {
  const core = createCore();
  const inWindow = { title: 'Soon', startDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) };
  const beyond = { title: 'Too Far', startDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) };

  assert.deepEqual(core.filterFutureEvents([inWindow, beyond], 5).map(e => e.title), ['Soon']);
  assert.deepEqual(core.filterFutureEvents([inWindow, beyond]).map(e => e.title), ['Soon', 'Too Far'],
    'no cutoff without daysToLookAhead');
});

test('filterFutureEvents drops events with missing or invalid startDate', () => {
  const core = createCore();
  const events = [
    { title: 'No Date' },
    { title: 'Bad Date', startDate: 'not-a-date' },
    { title: 'Good', startDate: new Date(Date.now() + 60 * 60 * 1000) }
  ];
  assert.deepEqual(core.filterFutureEvents(events).map(e => e.title), ['Good']);
});

// ---------------------------------------------------------------------------
// filterBearEvents
// ---------------------------------------------------------------------------

test('filterBearEvents: alwaysBear keeps everything and stamps isBearEvent', async () => {
  const core = createCore();
  const events = [
    { title: 'Techno Tuesday' },
    { title: 'Wine Tasting' }
  ];
  const result = await core.filterBearEvents(events, { alwaysBear: true });
  assert.equal(result.length, 2);
  assert.ok(result.every(e => e.isBearEvent === true));
});

test('filterBearEvents matches bear keywords in title, description, or bar', async () => {
  const core = createCore();
  const events = [
    { title: 'Bear Night' },
    { title: 'Saturday Social', description: 'hosted by your favorite cub DJ' },
    { title: 'Happy Hour', bar: 'Woof Lounge' },
    { title: 'Techno Tuesday', description: 'four to the floor' }
  ];
  const result = await core.filterBearEvents(events, {});
  assert.deepEqual(result.map(e => e.title), ['Bear Night', 'Saturday Social', 'Happy Hour']);
});

test('filterBearEvents: requireKeywords + allowlist gates keyword matching', async () => {
  const core = createCore();
  const events = [
    { title: 'Bear Night at the Eagle' },
    { title: 'FURBALL Bear Bash' }
  ];
  // Both match bear keywords, but only the allowlisted one passes the gate —
  // in every mode, and without ever consulting the AI tier
  for (const mode of ['report', 'enforce', 'off']) {
    const adapter = buildBearVerdictAdapter({ verdict: 'bear', reason: 'should not be asked' });
    const result = await core.filterBearEvents(
      events,
      { allowlist: ['furball'], requireKeywords: true, ai: { provider: 'ollama', endpoint: 'http://ai.example/api/generate', model: 'm', bearCheck: { mode } } },
      adapter
    );
    assert.deepEqual(result.map(e => e.title), ['FURBALL Bear Bash'], `mode ${mode}`);
    assert.equal(adapter.calls.length, 0, `mode ${mode} must not call the AI`);
  }
});

// ---------------------------------------------------------------------------
// Bear-check cascade: matchBearKeywords → AI verdict → alwaysBear fallback
// ---------------------------------------------------------------------------

function buildBearVerdictAdapter(verdict, options = {}) {
  const calls = [];
  return {
    calls,
    postJson: async (endpoint, payload) => {
      calls.push(payload);
      if (options.fail) throw new Error('AI endpoint down');
      const body = options.raw !== undefined ? options.raw : JSON.stringify(verdict);
      return { ok: true, status: 200, text: JSON.stringify({ response: body }) };
    }
  };
}

function bearCheckConfig(mode, overrides = {}) {
  return {
    name: 'Test Promoter',
    urls: ['https://promoter.example/events'],
    ai: { provider: 'ollama', endpoint: 'http://ai.example/api/generate', model: 'test-model', bearCheck: { mode } },
    ...overrides
  };
}

test('matchBearKeywords: substring tier hits smooshed brand names', () => {
  const core = createCore();
  assert.ok(core.matchBearKeywords('CHUNKA GO').includes('chunk'));
  assert.ok(core.matchBearKeywords('CUBHOUSE presents').includes('cub'));
  assert.ok(core.matchBearKeywords('BEEFWITCH').includes('beef'));
  assert.ok(core.matchBearKeywords('Bearracuda Portland').includes('bearracuda'));
});

test('matchBearKeywords: boundary tier hits whole words, never substrings', () => {
  const core = createCore();
  const hits = core.matchBearKeywords('Fat dad happy hour');
  assert.ok(hits.includes('fat'));
  assert.ok(hits.includes('dad'));
  // "fatal" (fat), "furniture" (fur), "update" (dad), "puppet" (pup) must not fire
  assert.deepEqual(core.matchBearKeywords('fatal furniture update puppet'), []);
});

test('bear check report mode returns exactly what legacy returns', async () => {
  const events = [
    { title: 'Bear Night' },
    { title: 'HOT TAKE' },
    { title: 'Treasure Trail Seattle' }
  ];
  const notBearAdapter = () => buildBearVerdictAdapter({ verdict: 'not_bear', reason: 'drag show' });

  for (const alwaysBear of [true, false]) {
    const legacy = await createCore().filterBearEvents(events, bearCheckConfig('off', { alwaysBear }));
    const withAdapter = await createCore().filterBearEvents(events, bearCheckConfig('report', { alwaysBear }), notBearAdapter());
    const withoutAdapter = await createCore().filterBearEvents(events, bearCheckConfig('report', { alwaysBear }), null);
    assert.deepEqual(withAdapter, legacy, `alwaysBear:${alwaysBear} with adapter`);
    assert.deepEqual(withoutAdapter, legacy, `alwaysBear:${alwaysBear} without adapter`);
  }
});

test('bear check enforce: trusted promoter keeps AI-not_bear events with an unlikely flag', async () => {
  const core = createCore();
  const adapter = buildBearVerdictAdapter({ verdict: 'not_bear', reason: 'drag-headliner show' });
  const result = await core.filterBearEvents(
    [{ title: 'HOT TAKE' }],
    bearCheckConfig('enforce', { alwaysBear: true }),
    adapter
  );
  assert.equal(result.length, 1, 'alwaysBear sources never lose events');
  assert.equal(result[0].bearReview, 'unlikely — ai: drag-headliner show');
  // The trusted-promoter sentence is what makes prompt accuracy work
  assert.match(adapter.calls[0].prompt, /trusted bear-scene promoter/);
  assert.match(adapter.calls[0].prompt, /source entry "Test Promoter"/);
});

test('bear check enforce: untrusted sources rescue on bear, flag on unsure, drop on not_bear', async () => {
  const cases = [
    { verdict: { verdict: 'bear', reason: 'bear promoter event' }, kept: true, bearReview: undefined, isBearEvent: true },
    { verdict: { verdict: 'unsure', reason: 'cannot tell' }, kept: true, bearReview: 'unsure — ai: cannot tell', isBearEvent: undefined },
    { verdict: { verdict: 'not_bear', reason: 'lesbian night' }, kept: false }
  ];
  for (const testCase of cases) {
    const core = createCore();
    const adapter = buildBearVerdictAdapter(testCase.verdict);
    const result = await core.filterBearEvents(
      [{ title: 'Treasure Trail Seattle' }],
      bearCheckConfig('enforce'),
      adapter
    );
    if (!testCase.kept) {
      assert.equal(result.length, 0, `${testCase.verdict.verdict} must drop`);
      continue;
    }
    assert.equal(result.length, 1, `${testCase.verdict.verdict} must keep`);
    assert.equal(result[0].bearReview, testCase.bearReview);
    assert.equal(result[0].isBearEvent, testCase.isBearEvent);
  }
});

test('bear check enforce: AI failure falls back to alwaysBear or an unsure flag', async () => {
  // Trusted source + dead AI → kept as bear via config provenance, no flag
  const trustedCore = createCore();
  const trusted = await trustedCore.filterBearEvents(
    [{ title: 'DENVER @ Ophelia\'s' }],
    bearCheckConfig('enforce', { alwaysBear: true }),
    buildBearVerdictAdapter(null, { fail: true })
  );
  assert.equal(trusted.length, 1);
  assert.equal(trusted[0].isBearEvent, true);
  assert.equal(trusted[0].bearReview, undefined);

  // Untrusted source + unparseable AI response → kept with an unsure fallback flag
  const untrustedCore = createCore();
  const untrusted = await untrustedCore.filterBearEvents(
    [{ title: 'DENVER @ Ophelia\'s' }],
    bearCheckConfig('enforce'),
    buildBearVerdictAdapter(null, { raw: 'no json here' })
  );
  assert.equal(untrusted.length, 1);
  assert.equal(untrusted[0].bearReview, 'unsure — fallback: ai unavailable');
});

test('bear check: keyword hit short-circuits without any AI call', async () => {
  const core = createCore();
  const adapter = buildBearVerdictAdapter({ verdict: 'not_bear', reason: 'should never be asked' });
  const result = await core.filterBearEvents(
    [{ title: 'Bear Night' }, { title: 'CHUNKA GO' }],
    bearCheckConfig('enforce'),
    adapter
  );
  assert.equal(result.length, 2);
  assert.equal(adapter.calls.length, 0);
});

test('bear check: identical events share one memoized AI call per run', async () => {
  const core = createCore();
  const adapter = buildBearVerdictAdapter({ verdict: 'bear', reason: 'bear promoter' });
  const event = { title: 'Treasure Trail Seattle', description: 'promoter party', bar: 'Neighbours' };
  const result = await core.filterBearEvents(
    [{ ...event }, { ...event }],
    bearCheckConfig('enforce'),
    adapter
  );
  assert.equal(result.length, 2);
  assert.equal(adapter.calls.length, 1, 'second identical event must reuse the memoized verdict');
});

test('bearReview round-trips notes and an existing calendar value survives merges', async () => {
  const core = createCore();

  // Notes codec round-trip (value contains a colon — must escape/unescape)
  const notes = core.formatEventNotes({ bar: 'Eagle', bearReview: 'unlikely — ai: drag show' });
  assert.equal(core.parseNotesIntoFields(notes).bearReview, 'unlikely — ai: drag show');

  // Existing calendar bearReview (human-edited "confirmed") beats an incoming flag
  const scraped = buildScrapedEvent({ bearReview: 'unlikely — ai: drag show' });
  const existing = buildCalendarEvent({}, [
    'bar: STATION 4',
    'bearReview: confirmed'
  ].join('\n'));
  const finalEvent = await core.createFinalEventObject(existing, scraped, {});
  assert.equal(finalEvent.bearReview, 'confirmed');
  assert.equal(core.parseNotesIntoFields(finalEvent.notes).bearReview, 'confirmed');

  // With no calendar value, the incoming flag lands in the merged notes
  const freshFlag = await core.createFinalEventObject(
    buildCalendarEvent(),
    buildScrapedEvent({ bearReview: 'unsure — fallback: ai unavailable' }),
    {}
  );
  assert.equal(core.parseNotesIntoFields(freshFlag.notes).bearReview, 'unsure — fallback: ai unavailable');
});

// ---------------------------------------------------------------------------
// Manual bear/not-bear overrides: dropped events carried to results,
// bearSource provenance, and prep-time calendar-record overrides
// ---------------------------------------------------------------------------

test('filterBearEvents enforce: drops land in the collector with verdict info, kept behavior unchanged', async () => {
  const core = createCore();
  const adapter = buildBearVerdictAdapter({ verdict: 'not_bear', reason: 'drag show, no bear context' });
  const dropCollector = [];
  const result = await core.filterBearEvents(
    [
      { title: 'Bear Night', bar: 'The Eagle', startDate: new Date('2026-08-01T21:00:00.000Z') },
      { title: 'Twink Bash', bar: 'Neon Room', startDate: new Date('2026-08-02T21:00:00.000Z'), url: 'https://promoter.example/twink-bash' }
    ],
    bearCheckConfig('enforce'),
    adapter,
    dropCollector
  );

  // Kept behavior unchanged: the keyword event survives with its stamps
  assert.deepEqual(result.map(e => e.title), ['Bear Night']);
  assert.equal(result[0].isBearEvent, true);

  // The drop is carried through with its verdict info, not silently gone
  assert.equal(dropCollector.length, 1);
  const dropped = dropCollector[0];
  assert.equal(dropped.title, 'Twink Bash');
  assert.equal(dropped.venue, 'Neon Room');
  assert.equal(dropped.reason, 'ai: drag show, no bear context');
  assert.equal(dropped.host, 'promoter.example');
  assert.equal(dropped.event.title, 'Twink Bash');
  assert.ok(dropped.startDate instanceof Date);
});

test('filterBearEvents report/off modes never fill the drop collector', async () => {
  for (const mode of ['report', 'off']) {
    const core = createCore();
    const adapter = buildBearVerdictAdapter({ verdict: 'not_bear', reason: 'drag show' });
    const dropCollector = [];
    await core.filterBearEvents(
      [{ title: 'Twink Bash' }],
      bearCheckConfig(mode),
      adapter,
      dropCollector
    );
    assert.equal(dropCollector.length, 0, `mode ${mode} must not collect drops`);
  }
});

test('bearSource: stamped keyword/ai on enforce keeps and round-trips through notes', async () => {
  // keyword tier
  const keywordCore = createCore();
  const keywordKept = await keywordCore.filterBearEvents(
    [{ title: 'Bear Night' }],
    bearCheckConfig('enforce'),
    buildBearVerdictAdapter({ verdict: 'bear', reason: 'unused' })
  );
  assert.equal(keywordKept[0].bearSource, 'keyword');

  // ai tier
  const aiCore = createCore();
  const aiKept = await aiCore.filterBearEvents(
    [{ title: 'Treasure Trail Seattle' }],
    bearCheckConfig('enforce'),
    buildBearVerdictAdapter({ verdict: 'bear', reason: 'bear promoter event' })
  );
  assert.equal(aiKept[0].bearSource, 'ai');

  // config tier (trusted promoter, AI unavailable)
  const configCore = createCore();
  const configKept = await configCore.filterBearEvents(
    [{ title: 'DENVER @ Ophelia\'s' }],
    bearCheckConfig('enforce', { alwaysBear: true }),
    buildBearVerdictAdapter(null, { fail: true })
  );
  assert.equal(configKept[0].bearSource, 'config');

  // Notes codec round-trip (values contain colons — must escape/unescape)
  const core = createCore();
  for (const value of ['ai', 'manual-not-bear (overrode ai: drag show)', 'manual-bear (overrode ai: lesbian night)']) {
    const notes = core.formatEventNotes({ bar: 'Eagle', bearSource: value });
    assert.equal(core.parseNotesIntoFields(notes).bearSource, value);
  }
});

test('bearSource: excluded from arbitration and a scraped value never clobbers manual-*', async () => {
  const core = createCore();
  assert.equal(core.isArbitrationEligibleField('bearSource'), false);
  assert.equal(core.isArbitrationEligibleField('bearReview'), true, 'bearReview keeps its own dedicated rule');

  // A stored manual-* verdict survives a fresh automatic stamp
  const manualKept = await core.createFinalEventObject(
    buildCalendarEvent({}, 'bar: STATION 4\nbearSource: manual-bear (overrode ai: drag show)'),
    buildScrapedEvent({ bearSource: 'ai' }),
    {}
  );
  assert.equal(manualKept.bearSource, 'manual-bear (overrode ai: drag show)');
  assert.equal(core.parseNotesIntoFields(manualKept.notes).bearSource, 'manual-bear (overrode ai: drag show)');

  // A fresh automatic verdict follows this run over a stale automatic one
  const freshAuto = await core.createFinalEventObject(
    buildCalendarEvent({}, 'bar: STATION 4\nbearSource: ai'),
    buildScrapedEvent({ bearSource: 'keyword' }),
    {}
  );
  assert.equal(freshAuto.bearSource, 'keyword');

  // A freshly tapped manual override (scraped side) is the owner's newest word
  const freshManual = await core.createFinalEventObject(
    buildCalendarEvent({}, 'bar: STATION 4\nbearSource: manual-not-bear (overrode ai: x)\nbearReview: unlikely — manual\\: marked not-bear by calendar owner'),
    buildScrapedEvent({ bearSource: 'manual-bear (overrode ai: x)' }),
    {}
  );
  assert.equal(freshManual.bearSource, 'manual-bear (overrode ai: x)');
  // ...and it clears the tombstone's hide flag so the rescue is visible again
  assert.equal(core.parseNotesIntoFields(freshManual.notes).bearReview, undefined);
});

test('buildManualBearSource: one line, ai-prefix stripped, reason truncated ~80 chars', () => {
  assert.equal(
    SharedCore.buildManualBearSource('bear', 'ai: drag show'),
    'manual-bear (overrode ai: drag show)'
  );
  assert.equal(SharedCore.buildManualBearSource('not-bear', ''), 'manual-not-bear');
  const long = SharedCore.buildManualBearSource('not-bear', 'x'.repeat(200));
  assert.ok(long.startsWith('manual-not-bear (overrode ai: '));
  assert.ok(long.length <= 'manual-not-bear (overrode ai: )'.length + 80);
  assert.ok(!long.includes('\n'));
});

// Calendar adapter stub for prep-time override tests: every event search
// returns the same canned records, and calls are counted.
function buildPrepCalendarAdapter(records) {
  const calls = [];
  return {
    calls,
    getExistingEvents: async (event) => {
      calls.push(event.title);
      return records;
    }
  };
}

function buildOverrideContext(droppedEvents = []) {
  return { droppedEvents, demoted: [], rescued: [] };
}

test('prep-time override: dropped event with a manual-bear calendar match is rescued into the plan', async () => {
  const core = createCore();
  const calendarRecord = {
    title: 'OUTDRAG',
    startDate: new Date('2026-08-01T21:00:00.000Z'),
    endDate: new Date('2026-08-02T01:00:00.000Z'),
    location: '',
    notes: 'bar: The Eagle\nbearSource: manual-bear (overrode ai: drag show)'
  };
  const adapter = buildPrepCalendarAdapter([calendarRecord]);
  const droppedEntry = {
    title: 'OUTDRAG',
    reason: 'ai: drag show',
    event: { title: 'OUTDRAG', startDate: new Date('2026-08-01T21:00:00.000Z'), bar: 'The Eagle' }
  };
  const context = buildOverrideContext([droppedEntry]);

  const analyzed = await core.prepareEventsForCalendar([], adapter, {}, context);

  assert.equal(analyzed.length, 1, 'the dropped event is rescued into the plan');
  assert.equal(analyzed[0]._action, 'merge', 'rescue proceeds through the normal merge path');
  assert.equal(analyzed[0].isBearEvent, true);
  assert.equal(
    core.parseNotesIntoFields(analyzed[0].notes).bearSource,
    'manual-bear (overrode ai: drag show)',
    'the calendar record\'s manual verdict follows the merged event'
  );
  assert.equal(droppedEntry.rescued, true);
  assert.deepEqual(context.rescued, [droppedEntry]);
});

test('prep-time override: kept event with a manual-not-bear calendar match is demoted, record untouched', async () => {
  const core = createCore();
  const tombstoneNotes = 'bar: Neon Room\nbearSource: manual-not-bear (overrode ai: kept wrongly)\nbearReview: unlikely — manual\\: marked not-bear by calendar owner';
  const calendarRecord = {
    title: 'Bronze Babez',
    startDate: new Date('2026-08-05T21:00:00.000Z'),
    endDate: new Date('2026-08-06T01:00:00.000Z'),
    location: '',
    notes: tombstoneNotes
  };
  const adapter = buildPrepCalendarAdapter([calendarRecord]);
  const keptEvent = { title: 'Bronze Babez', startDate: new Date('2026-08-05T21:00:00.000Z'), bar: 'Neon Room', bearSource: 'ai' };
  const context = buildOverrideContext();

  const analyzed = await core.prepareEventsForCalendar([keptEvent], adapter, {}, context);

  assert.equal(analyzed.length, 0, 'demoted events never enter the write plan');
  assert.equal(context.demoted.length, 1);
  assert.equal(context.demoted[0].title, 'Bronze Babez');
  assert.equal(context.demoted[0].reason, 'manual-not-bear (manual override on calendar record)');
  assert.equal(calendarRecord.notes, tombstoneNotes, 'the calendar tombstone stays exactly as-is');
  assert.equal(adapter.calls.length, 1, 'the demote check reuses prep\'s one existing-event search');
});

test('prep-time override: no calendar match (or no manual verdict) leaves behavior unchanged', async () => {
  // Kept event, empty calendar → analyzed as new, nothing demoted
  const core = createCore();
  const emptyAdapter = buildPrepCalendarAdapter([]);
  const context = buildOverrideContext([
    { title: 'Twink Bash', reason: 'ai: drag show', event: { title: 'Twink Bash', startDate: new Date('2026-08-02T21:00:00.000Z') } }
  ]);
  const analyzed = await core.prepareEventsForCalendar(
    [{ title: 'Bear Night', startDate: new Date('2026-08-01T21:00:00.000Z'), bearSource: 'keyword' }],
    emptyAdapter,
    {},
    context
  );
  assert.equal(analyzed.length, 1);
  assert.equal(analyzed[0]._action, 'new');
  assert.equal(context.demoted.length, 0);
  assert.equal(context.rescued.length, 0, 'an unmatched drop stays dropped');

  // A matching record WITHOUT a manual verdict never rescues or demotes
  const autoCore = createCore();
  const autoRecord = {
    title: 'Twink Bash',
    startDate: new Date('2026-08-02T21:00:00.000Z'),
    endDate: new Date('2026-08-03T01:00:00.000Z'),
    location: '',
    notes: 'bar: Neon Room\nbearSource: ai'
  };
  const autoContext = buildOverrideContext([
    { title: 'Twink Bash', reason: 'ai: drag show', event: { title: 'Twink Bash', startDate: new Date('2026-08-02T21:00:00.000Z') } }
  ]);
  const autoAnalyzed = await autoCore.prepareEventsForCalendar([], buildPrepCalendarAdapter([autoRecord]), {}, autoContext);
  assert.equal(autoAnalyzed.length, 0);
  assert.equal(autoContext.rescued.length, 0);
});

test('prep-time override: a freshly tapped manual-bear event is never demoted by the old tombstone', async () => {
  const core = createCore();
  const calendarRecord = {
    title: 'Bronze Babez',
    startDate: new Date('2026-08-05T21:00:00.000Z'),
    endDate: new Date('2026-08-06T01:00:00.000Z'),
    location: '',
    notes: 'bar: Neon Room\nbearSource: manual-not-bear (overrode ai: kept wrongly)'
  };
  const adapter = buildPrepCalendarAdapter([calendarRecord]);
  const flippedEvent = {
    title: 'Bronze Babez',
    startDate: new Date('2026-08-05T21:00:00.000Z'),
    bar: 'Neon Room',
    bearSource: 'manual-bear (overrode ai: kept wrongly)'
  };
  const context = buildOverrideContext();

  const analyzed = await core.prepareEventsForCalendar([flippedEvent], adapter, {}, context);

  assert.equal(analyzed.length, 1, 'the owner\'s fresh verdict wins over the stored one');
  assert.equal(context.demoted.length, 0);
  assert.equal(
    core.parseNotesIntoFields(analyzed[0].notes).bearSource,
    'manual-bear (overrode ai: kept wrongly)'
  );
});

// ---------------------------------------------------------------------------
// logDebug / logAiPayloadDebug (two-tier logging)
// ---------------------------------------------------------------------------

function withStubbedConsole(fn, { withDebug = true } = {}) {
  const captured = { log: [], debug: [] };
  const originalLog = console.log;
  const originalDebug = console.debug;
  console.log = (message) => captured.log.push(String(message));
  if (withDebug) {
    console.debug = (message) => captured.debug.push(String(message));
  } else {
    console.debug = undefined;
  }
  try {
    fn();
  } finally {
    console.log = originalLog;
    console.debug = originalDebug;
  }
  return captured;
}

test('logDebug uses console.debug when present', () => {
  const core = createCore();
  const captured = withStubbedConsole(() => {
    core.logDebug('debug channel line');
  });
  assert.deepEqual(captured.debug, ['debug channel line']);
  assert.deepEqual(captured.log, []);
});

test('logDebug falls back to console.log when console.debug is missing', () => {
  const core = createCore();
  const captured = withStubbedConsole(() => {
    core.logDebug('fallback line');
  }, { withDebug: false });
  assert.deepEqual(captured.log, ['fallback line']);
});

test('logDebug mirrors to console.log when mirrorToConsole is set', () => {
  const core = createCore();
  const captured = withStubbedConsole(() => {
    core.logDebug('verbose line', true);
  });
  assert.deepEqual(captured.log, ['verbose line']);
  assert.deepEqual(captured.debug, []);
});

test('logAiPayloadDebug suppresses an identical payload logged twice', () => {
  const core = createCore();
  const payload = 'PROMPT BODY\nline two of the payload';
  const captured = withStubbedConsole(() => {
    core.logAiPayloadDebug('🤖 AI Web: Full prompt (context-prep pass)', payload);
    core.logAiPayloadDebug('🤖 AI Web: Full prompt (context-prep pass)', payload);
  });
  assert.equal(captured.debug.length, 2);
  // First emission carries the full body
  assert.ok(captured.debug[0].includes('PROMPT BODY'));
  assert.ok(captured.debug[0].includes(`(${payload.length} chars)`));
  // Second emission is the one-line suppression notice, no body
  assert.ok(captured.debug[1].includes('identical to payload logged earlier'));
  assert.ok(captured.debug[1].includes('suppressed'));
  assert.ok(captured.debug[1].includes(`${payload.length} chars`));
  assert.ok(!captured.debug[1].includes('PROMPT BODY'));
  assert.equal(captured.debug[1].split('\n').length, 1);
});

test('logAiPayloadDebug logs different payloads in full', () => {
  const core = createCore();
  const captured = withStubbedConsole(() => {
    core.logAiPayloadDebug('🤖 AI Web: Full prompt (extraction pass)', 'payload A');
    core.logAiPayloadDebug('🤖 AI Web: Full prompt (extraction pass)', 'payload B');
  });
  assert.equal(captured.debug.length, 2);
  assert.ok(captured.debug[0].includes('payload A'));
  assert.ok(captured.debug[1].includes('payload B'));
  assert.ok(!captured.debug[1].includes('suppressed'));
});

// ---------------------------------------------------------------------------
// Organizer context in merge arbitration + ai.extraContext resolution
// ---------------------------------------------------------------------------

test('arbitration prompt includes the organizer line when an event carries _organizer', async () => {
  const core = createCore();
  const { scraped, existing } = buildArbitrationPair();
  scraped._organizer = 'Bearracuda';
  const adapter = buildArbitrationAdapter({
    bar: { pick: 'calendar', value: 'STATION 4', reason: 'venue' }
  });

  await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 1);
  assert.match(
    adapter.calls[0].prompt,
    /- KNOWN ORGANIZER: "Bearracuda" — never pick a bar value equal to the organizer\./
  );
});

test('arbitration prompt carries the organizer-hallucination backstop rule with and without a known organizer', async () => {
  const backstopRule = /- Never reject a bar value as "the organizer" unless it is the SAME NAME as the known organizer — a venue sharing a page or flyer with the organizer is still the venue\./;

  // With a known organizer, the backstop follows the KNOWN ORGANIZER rule
  const core = createCore();
  const { scraped, existing } = buildArbitrationPair();
  scraped._organizer = 'Bearracuda';
  const adapter = buildArbitrationAdapter({
    bar: { pick: 'calendar', value: 'STATION 4', reason: 'venue' }
  });
  await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  assert.equal(adapter.calls.length, 1);
  assert.match(adapter.calls[0].prompt, backstopRule);
  assert.ok(
    adapter.calls[0].prompt.indexOf('KNOWN ORGANIZER') < adapter.calls[0].prompt.search(backstopRule),
    'the backstop rule follows the KNOWN ORGANIZER rule');

  // Without one, the backstop still guards the generic never-the-organizer rule
  const bareCore = createCore();
  const bare = buildArbitrationPair();
  const bareAdapter = buildArbitrationAdapter({
    bar: { pick: 'calendar', value: 'STATION 4', reason: 'venue' }
  });
  await bareCore.createFinalEventObject(bare.existing, bare.scraped, { httpAdapter: bareAdapter });
  assert.equal(bareAdapter.calls.length, 1);
  assert.match(bareAdapter.calls[0].prompt, backstopRule);
});

test('arbitration prompt omits the organizer line when no event carries _organizer', async () => {
  const core = createCore();
  const { scraped, existing } = buildArbitrationPair();
  const adapter = buildArbitrationAdapter({});

  await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 1);
  assert.ok(!/KNOWN ORGANIZER/.test(adapter.calls[0].prompt));
});

test('arbitration prompt carries the dates-are-not-descriptive title rule', async () => {
  const core = createCore();
  const { scraped, existing } = buildArbitrationPair(); // genuine title conflict reaches the AI
  const adapter = buildArbitrationAdapter({});

  await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 1);
  assert.match(
    adapter.calls[0].prompt,
    /- For "title", the event's own date is NOT descriptive — never prefer a variant because it contains a date; prefer the dateless variant of an otherwise-equal name\./,
    'the backstop rule guards dated titles the deterministic rung cannot settle');
});

test('mergeParsedEvents passes the organizer to arbitration and carries _organizer across merges', async () => {
  const core = createCore();
  const priorities = { title: { priority: ['ai-web'], merge: 'ai' } };
  const aiParserConfig = { ai: { provider: 'ollama', endpoint: 'http://ai.example', model: 'm' } };
  const existing = { title: 'FURBALL', source: 'ai-web', _organizer: 'Bearracuda', _fieldPriorities: priorities };
  const incoming = { title: 'FURBALL DALLAS', source: 'ai-web', _parserConfig: aiParserConfig, _fieldPriorities: priorities };
  const adapter = buildArbitrationAdapter({
    title: { pick: 'incoming', value: 'FURBALL DALLAS', reason: 'more specific' }
  });

  const merged = await core.mergeParsedEvents(existing, incoming, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 1);
  assert.match(adapter.calls[0].prompt, /- KNOWN ORGANIZER: "Bearracuda" — never pick a bar value equal to the organizer\./);
  assert.equal(merged._organizer, 'Bearracuda', 'an existing-only _organizer must survive the merge');
});

test('resolveAiConfig resolves extraContext (override-only, default empty)', () => {
  const core = createCore();
  assert.equal(core.resolveAiConfig({}).extraContext, '');
  assert.equal(core.resolveAiConfig({ extraContext: 'HINT' }).extraContext, 'HINT');
});

test('applyGlobalAiExtraContext: global applies unless the parser defines its own', () => {
  const core = createCore();
  const mainConfig = { config: { ai: { extraContext: 'GLOBAL HINT' } } };

  const inherited = core.applyGlobalAiExtraContext({ name: 'p' }, mainConfig);
  assert.equal(inherited.ai.extraContext, 'GLOBAL HINT');

  const overridden = core.applyGlobalAiExtraContext({ name: 'p', ai: { extraContext: 'MINE' } }, mainConfig);
  assert.equal(overridden.ai.extraContext, 'MINE');

  const optedOut = core.applyGlobalAiExtraContext({ name: 'p', ai: { extraContext: '' } }, mainConfig);
  assert.equal(optedOut.ai.extraContext, '', 'an explicit empty string opts out of the global');

  const untouched = { name: 'p' };
  assert.equal(core.applyGlobalAiExtraContext(untouched, {}), untouched, 'no global → config object passes through');
});

// ---------------------------------------------------------------------------
// Empty scraped bar must never clear a calendar venue (2026-07-13 run findings:
// the brand guard left extraction with NO bar and the ai-strategy merge's
// clear-on-empty-scrape semantics wiped the calendar's correct venue)
// ---------------------------------------------------------------------------

test('an empty scraped bar keeps the calendar venue and never reaches arbitration', async () => {
  const core = createCore();
  const scraped = {
    title: 'Treasure Trail Portland PRIDE',
    startDate: new Date('2026-07-18T21:00:00.000Z'),
    bar: '', // brand-guarded away, never recovered — an extraction gap, not data
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: TEST_AI_PARSER_CONFIG
  };
  const existing = {
    title: 'Treasure Trail Portland PRIDE',
    startDate: new Date('2026-07-18T21:00:00.000Z'),
    notes: 'bar: Sanctuary Club'
  };
  const adapter = buildArbitrationAdapter({});

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 0, 'empty vs non-empty bar is not a conflict — no arbitration request');
  assert.equal(core.parseNotesIntoFields(finalEvent.notes).bar, 'Sanctuary Club',
    'the calendar venue must survive an empty scrape');
});

test('a non-empty scraped bar keeps today\'s behavior: genuine conflicts still route to arbitration', async () => {
  const core = createCore();
  const scraped = {
    title: 'Treasure Trail Portland PRIDE',
    startDate: new Date('2026-07-18T21:00:00.000Z'),
    bar: 'Sanctuary',
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: TEST_AI_PARSER_CONFIG
  };
  const existing = {
    title: 'Treasure Trail Portland PRIDE',
    startDate: new Date('2026-07-18T21:00:00.000Z'),
    notes: 'bar: Sanctuary Club'
  };
  const adapter = buildArbitrationAdapter({
    bar: { pick: 'calendar', value: 'Sanctuary Club', reason: 'full venue name' }
  });

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 1, 'a genuine bar conflict still reaches arbitration exactly as today');
  assert.match(adapter.calls[0].prompt, /field: bar/);
  assert.equal(core.parseNotesIntoFields(finalEvent.notes).bar, 'Sanctuary Club');
});

test('mergeParsedEvents: an empty bar loses to the non-empty side regardless of priorities', async () => {
  const core = createCore();

  // No priority config at all: previously the incoming (empty) bar won via the
  // newEvent spread and wiped the existing venue.
  const merged = await core.mergeParsedEvents(
    { title: 'Treasure Trail', bar: 'Sanctuary Club', source: 'bearracuda', _fieldPriorities: {} },
    { title: 'Treasure Trail', bar: '', source: 'ai-web', _fieldPriorities: {} },
    {});
  assert.equal(merged.bar, 'Sanctuary Club', 'existing venue survives an empty incoming bar');

  // Reverse direction: an incoming venue fills an existing empty bar even when
  // only the existing source is in the priority list (previously kept empty).
  const priorities = { bar: { priority: ['bearracuda'], merge: 'upsert' } };
  const filled = await core.mergeParsedEvents(
    { title: 'Treasure Trail', bar: '', source: 'bearracuda', _fieldPriorities: priorities },
    { title: 'Treasure Trail', bar: 'Sanctuary', source: 'ai-web', _fieldPriorities: priorities },
    {});
  assert.equal(filled.bar, 'Sanctuary', 'a real venue fills an empty bar across parsers');
});

test('deduplicateEvents merges records sharing an identical event URL despite city/venue mismatch', async () => {
  const core = createCore();
  // Real scenario (chunk-party.com): OCR on a blurred homepage thumbnail hallucinated
  // a wrong city ("sitges") onto the homepage-segment record while the detail page
  // resolved "sf", and timezone anchoring put the start dates 2 days apart — the keys
  // never collide, so only the shared event URL can pair them.
  const homepageSegment = {
    title: 'CHUNK DORE ALLEY - Saturday July 25th',
    bar: 'SEBUCO', // hallucinated venue from the blurred thumbnail
    city: 'sitges',
    timezone: 'Europe/Madrid',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    url: 'https://www.chunk-party.com/dore-alley-2026',
    source: 'ai-web'
  };
  const detailPage = {
    title: 'CHUNK DORE ALLEY - Saturday July 25th',
    bar: 'Public Works',
    address: '161 Erie St, San Francisco, CA 94103',
    city: 'sf',
    timezone: 'America/Los_Angeles',
    startDate: new Date('2026-07-27T04:00:00.000Z'), // 2 days apart
    url: 'https://WWW.chunk-party.com/dore-alley-2026/', // host case + trailing slash must not matter
    source: 'ai-web'
  };
  assert.notEqual(core.createEventKey(homepageSegment), core.createEventKey(detailPage), 'precondition: keys diverge');

  const result = await core.deduplicateEvents([homepageSegment, detailPage], null);
  assert.equal(result.length, 1, 'an identical non-root event URL must merge the two records');
  assert.equal(result[0].city, 'sf', 'the surviving city comes from the address-bearing record');
  assert.equal(result[0].timezone, 'America/Los_Angeles', 'the surviving timezone comes from the address-bearing record');
  assert.equal(result[0].key, detailPage.key, 'the surviving key comes from the address-bearing record');
});

test('deduplicateEvents does not merge distinct events sharing a homepage-root URL', async () => {
  const core = createCore();
  // A multi-event homepage stamps the SAME root URL on every segment event —
  // that URL says where the events were found, not that they are one event.
  const eventA = {
    title: 'CHUNK DORE ALLEY',
    bar: 'Public Works',
    city: 'dallas',
    timezone: 'America/Chicago',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    url: 'https://www.chunk-party.com/',
    source: 'ai-web'
  };
  const eventB = {
    title: 'CHUNK SUMMER CAMP',
    bar: 'Eagle',
    city: 'dallas',
    timezone: 'America/Chicago',
    startDate: new Date('2026-07-26T21:00:00.000Z'),
    url: 'https://www.chunk-party.com/',
    source: 'ai-web'
  };

  const result = await core.deduplicateEvents([eventA, eventB], null);
  assert.equal(result.length, 2, 'a shared domain-root URL must never trigger the same-URL merge');
});

test('deduplicateEvents does not merge same-URL records with start dates far apart', async () => {
  const core = createCore();
  // Recurring events reuse their event page — a month apart means different nights.
  const july = {
    title: 'CHUNK MONTHLY',
    bar: 'Public Works',
    city: 'dallas',
    timezone: 'America/Chicago',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    url: 'https://www.chunk-party.com/chunk-monthly',
    source: 'ai-web'
  };
  const august = {
    title: 'CHUNK MONTHLY',
    bar: 'Public Works',
    city: 'dallas',
    timezone: 'America/Chicago',
    startDate: new Date('2026-08-24T21:00:00.000Z'), // 30 days apart
    url: 'https://www.chunk-party.com/chunk-monthly',
    source: 'ai-web'
  };

  const result = await core.deduplicateEvents([july, august], null);
  assert.equal(result.length, 2, 'same URL but 30 days apart must stay separate events');
});

test('deduplicateEvents treats a URL shared by 3+ events as a listing page (no same-URL merge)', async () => {
  const core = createCore();
  // A multi-event listing page without per-segment links stamps its OWN path'd URL
  // on every extracted event — fan-in of 3+ proves it's a hub, not an event page.
  const makeEvent = (title, bar, day) => ({
    title,
    bar,
    city: 'chicago',
    timezone: 'America/Chicago',
    startDate: new Date(`2026-07-${day}T21:00:00.000Z`),
    url: 'https://venue-site.com/events',
    source: 'ai-web'
  });
  const events = [
    makeEvent('BEAR NIGHT', 'Cell Block', '24'),
    makeEvent('UNDERWEAR PARTY', 'Cell Block', '25'),
    makeEvent('SUNDAY BEER BUST', 'Cell Block', '26')
  ];

  const result = await core.deduplicateEvents(events, null);
  assert.equal(result.length, 3, 'a URL shared by 3+ events must never trigger the same-URL merge');
});

test('deduplicateEvents merges venue-titled listing stubs with their same-URL detail twins', async () => {
  const core = createCore();
  // Battery run 20260728: three unmerged pairs where a listing stub (VENUE as
  // title, midnight date, unknown city — so no key/identity signal can fire)
  // shares the EXACT event-page URL with its detail twin. Pathed-URL equality
  // alone is identity; the old title-compatibility veto kept all three pairs
  // as duplicates.
  const pairs = [
    [
      { title: 'Nova PDX', startDate: new Date('2026-08-22T00:00:00.000Z'),
        url: 'https://www.chunk-party.com/event-details/chunk-portland-summer-blow-out', source: 'ai-web' },
      { title: 'CHUNK Portland - SUMMER BLOW OUT!', bar: 'Nova PDX', city: 'portland',
        address: '1035 SE Stark St, Portland, OR', timezone: 'America/Los_Angeles',
        startDate: new Date('2026-08-23T04:00:00.000Z'),
        url: 'https://www.chunk-party.com/event-details/chunk-portland-summer-blow-out', source: 'ai-web' }
    ],
    [
      { title: 'The Godfrey Rooftop', startDate: new Date('2026-08-22T00:00:00.000Z'),
        url: 'https://www.eventbrite.com/e/quenchd-tickets-1993587626256', source: 'ai-web' },
      { title: 'QUENCHD', bar: 'The Godfrey Rooftop', city: 'chicago',
        address: '127 W Huron St, Chicago, IL', timezone: 'America/Chicago',
        startDate: new Date('2026-08-22T20:00:00.000Z'),
        url: 'https://www.eventbrite.com/e/quenchd-tickets-1993587626256', source: 'ai-web' }
    ],
    [
      { title: 'CCBC Resort', startDate: new Date('2026-09-11T00:00:00.000Z'),
        url: 'https://www.eventbrite.com/e/club-chub-weekend-2026-the-ultimate-celebration-tickets-1975884326209', source: 'ai-web' },
      { title: 'Club Chub Weekend 2026 — The Ultimate Celebration!', bar: 'CCBC Resort', city: 'palm springs',
        address: '68300 Gay Resort Dr, Cathedral City, CA', timezone: 'America/Los_Angeles',
        startDate: new Date('2026-09-11T18:00:00.000Z'),
        url: 'https://www.eventbrite.com/e/club-chub-weekend-2026-the-ultimate-celebration-tickets-1975884326209', source: 'ai-web' }
    ]
  ];
  for (const [stub, detail] of pairs) {
    const result = await core.deduplicateEvents([stub, detail], null);
    assert.equal(result.length, 1, `"${stub.title}" / "${detail.title}" must merge on their shared event-page URL`);
    assert.equal(result[0].title, detail.title, 'the complete/dated detail record supplies the title');
  }
});

test('applyAggregatorWebsitePointers prefers the cross-host ticketUrl over the aggregator page copy', () => {
  const core = createCore();
  // Battery run 20260728: all 42 The Bear Calendar events carried
  // website=url=their thebearcalendar.com page while ticketUrl pointed at
  // the ORIGINAL ticketing host. Trust the pointer, not the copy.
  const urlClassifications = { 'https://thebearcalendar.com/events/': 'link-aggregator' };
  const aggregatorEvent = {
    title: 'D>U>R>O',
    website: 'https://thebearcalendar.com/events/d-u-r-o-2026/',
    ticketUrl: 'https://dice.fm/event/duro-la-2026',
    _sourcePageUrl: 'https://thebearcalendar.com/events/d-u-r-o-2026/'
  };
  // Non-aggregator page: untouched even with a cross-host ticketUrl.
  const venueEvent = {
    title: 'CUBSCOUT',
    website: 'https://eaglela.com/events/cub-scout-3/',
    ticketUrl: 'https://dice.fm/event/cubscout',
    _sourcePageUrl: 'https://eaglela.com/events/cub-scout-3/'
  };
  // Same-host ticketUrl on the aggregator: no better pointer exists — untouched.
  const sameHostEvent = {
    title: 'BEAR NIGHT',
    website: 'https://thebearcalendar.com/events/bear-night-2026/',
    ticketUrl: 'https://www.thebearcalendar.com/tickets/bear-night-2026',
    _sourcePageUrl: 'https://thebearcalendar.com/events/bear-night-2026/'
  };
  // Website already points off the aggregator: never clobbered.
  const alreadyOriginalEvent = {
    title: 'MEGAWOOF',
    website: 'https://megawoof.com/houston',
    ticketUrl: 'https://dice.fm/event/megawoof-houston',
    _sourcePageUrl: 'https://thebearcalendar.com/events/megawoof-houston-richs-2026/'
  };
  core.applyAggregatorWebsitePointers(
    [aggregatorEvent, venueEvent, sameHostEvent, alreadyOriginalEvent],
    urlClassifications
  );
  assert.equal(aggregatorEvent.website, 'https://dice.fm/event/duro-la-2026',
    'aggregator-page website is replaced by the original ticketing URL');
  assert.equal(venueEvent.website, 'https://eaglela.com/events/cub-scout-3/',
    'non-aggregator pages are unchanged');
  assert.equal(sameHostEvent.website, 'https://thebearcalendar.com/events/bear-night-2026/',
    'a same-host ticketUrl never rewrites website');
  assert.equal(alreadyOriginalEvent.website, 'https://megawoof.com/houston',
    'a website already pointing at the original source is untouched');
});

test('deduplicateEvents never same-URL-merges root-URL events or distinct per-event paths', async () => {
  const core = createCore();
  // Furball: every event carries the site ROOT as its url — where they were
  // found, not what they are. Zero path segments → no url identity key.
  const furball = ['FURBALL Asbury Park Beach', 'FURBALL Chicago', 'FURBALL MAD.BEAR', 'FURBALL CAMP', 'FURBALL']
    .map((title, index) => ({
      title,
      city: 'new york',
      timezone: 'America/New_York',
      startDate: new Date(`2026-08-${String(10 + index).padStart(2, '0')}T02:00:00.000Z`),
      url: 'https://www.furball.nyc',
      source: 'ai-web'
    }));
  const furballResult = await core.deduplicateEvents(furball, null);
  assert.equal(furballResult.length, 5, 'shared homepage-root URLs must never merge events');

  // Aggregator (The Bear Calendar): distinct per-event paths on one host must
  // not cross-merge even on close dates.
  const tbc = [
    { title: 'BEEFMINCE x RVT', city: 'london', timezone: 'Europe/London',
      startDate: new Date('2026-08-15T21:00:00.000Z'),
      url: 'https://thebearcalendar.com/events/beefmince-x-rvt-2026-4/', source: 'ai-web' },
    { title: 'MEGAWOOF HOUSTON @ RICHs', city: 'houston', timezone: 'America/Chicago',
      startDate: new Date('2026-08-16T03:00:00.000Z'),
      url: 'https://thebearcalendar.com/events/megawoof-houston-richs-2026/', source: 'ai-web' }
  ];
  const tbcResult = await core.deduplicateEvents(tbc, null);
  assert.equal(tbcResult.length, 2, 'distinct per-event paths must stay separate events');
});

test('deduplicateEvents merges same-URL records whose titles are prefixed variants', async () => {
  const core = createCore();
  // Segment vs detail-page records often title the same event with and without the
  // organizer prefix — containment after emoji/punctuation stripping must merge them.
  const segment = {
    title: 'SPRING THAW',
    bar: 'Cell Block',
    city: 'chicago',
    timezone: 'America/Chicago',
    startDate: new Date('2026-03-21T21:00:00.000Z'),
    url: 'https://www.chunk-party.com/event-details/chunk-chicago-presents-spring-thaw',
    source: 'ai-web'
  };
  const detail = {
    title: 'CHUNK CHICAGO presents SPRING THAW!',
    bar: 'Cell Block Chicago',
    address: '3702 N Halsted, Chicago, IL',
    city: 'chicago',
    timezone: 'America/Chicago',
    startDate: new Date('2026-03-22T02:00:00.000Z'),
    url: 'https://www.chunk-party.com/event-details/chunk-chicago-presents-spring-thaw',
    source: 'ai-web'
  };

  const result = await core.deduplicateEvents([segment, detail], null);
  assert.equal(result.length, 1, 'variant titles at the same event URL must merge');
});

// ---------------------------------------------------------------------------
// Empty side never displaces data (2026-07-14 run findings: with ai-web as the
// universal parser every dedup pair hits the same-priority branch, which
// "preserved existing" even when existing was EMPTY — wiping the detail page's
// cover/ticketUrl; the emptied cover then reached the calendar merge, whose
// clear-on-empty-scrape clobber semantics deleted the stored cover: notes line)
// ---------------------------------------------------------------------------

test('mergeParsedEvents: one-sided cover/ticketUrl survive a same-source dedup merge', async () => {
  const core = createCore();
  // Homepage segment record: flyers don't print prices — no cover, no ticketUrl
  const existing = {
    title: 'CHUNK DORE ALLEY',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    bar: 'SF Eagle',
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({})
  };
  // Detail-page record: JSON-LD carries the price and ticket link
  const incoming = {
    title: 'CHUNK DORE ALLEY',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    bar: 'SF Eagle',
    cover: '$46.13-$61.50',
    ticketUrl: 'https://tickets.example/chunk-dore-alley',
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: TEST_AI_PARSER_CONFIG
  };
  const adapter = buildArbitrationAdapter({});

  const merged = await core.mergeParsedEvents(existing, incoming, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 0, 'one-sided fields are not conflicts — no arbitration request');
  assert.equal(merged.cover, '$46.13-$61.50', 'the empty existing side must not wipe the incoming cover');
  assert.equal(merged.ticketUrl, 'https://tickets.example/chunk-dore-alley');
});

test('mergeParsedEvents: an existing cover survives an incoming record without one', async () => {
  const core = createCore();
  const existing = {
    title: 'CHUNK DORE ALLEY',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    cover: '$25.63 - $61.50',
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({})
  };
  const incoming = {
    title: 'CHUNK DORE ALLEY',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    cover: '',
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: TEST_AI_PARSER_CONFIG
  };
  const adapter = buildArbitrationAdapter({});

  const merged = await core.mergeParsedEvents(existing, incoming, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 0);
  assert.equal(merged.cover, '$25.63 - $61.50', 'the empty incoming side must not wipe the existing cover');
});

test('mergeParsedEvents: both-non-empty differing covers at the same priority still arbitrate', async () => {
  const core = createCore();
  const existing = {
    title: 'CHUNK DORE ALLEY',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    cover: '$25.63 - $61.50',
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({})
  };
  const incoming = {
    title: 'CHUNK DORE ALLEY',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    cover: '$46.13-$61.50',
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: TEST_AI_PARSER_CONFIG
  };
  const adapter = buildArbitrationAdapter({
    cover: { pick: 'incoming', value: '$46.13-$61.50', reason: 'detail page price' }
  });

  const merged = await core.mergeParsedEvents(existing, incoming, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 1, 'a genuine same-priority cover conflict must reach arbitration');
  assert.match(adapter.calls[0].prompt, /field: cover/);
  assert.equal(merged.cover, '$46.13-$61.50', 'the arbitration winner is applied');
});

test('an empty scraped cover keeps the calendar cover and never appears clobbered', async () => {
  const core = createCore();
  const scraped = {
    title: 'CHUNK DORE ALLEY',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    bar: 'SF Eagle',
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: TEST_AI_PARSER_CONFIG
  };
  const existing = {
    title: 'CHUNK DORE ALLEY',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    notes: 'bar: SF Eagle\ncover: $25.63 - $61.50'
  };
  const adapter = buildArbitrationAdapter({});

  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let finalEvent;
  try {
    finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  } finally {
    console.log = originalLog;
  }

  assert.equal(adapter.calls.length, 0, 'empty vs non-empty cover is not a conflict — no arbitration request');
  assert.equal(finalEvent.cover, '$25.63 - $61.50', 'the calendar cover must survive an empty scrape');
  assert.equal(core.parseNotesIntoFields(finalEvent.notes).cover, '$25.63 - $61.50',
    'the cover: notes line round-trips');
  assert.ok(!logLines.some(line => line.includes('clobbered') && line.includes('cover')),
    `cover must never be logged as clobbered, got: ${JSON.stringify(logLines)}`);
  assert.ok(logLines.some(line => line.includes('kept calendar values for empty-scraped field(s):') && line.includes('cover')),
    `expected the kept-calendar summary to list cover, got: ${JSON.stringify(logLines)}`);
});

test('cover formatting twins are not a conflict: calendar value kept, no AI, no clobber', async () => {
  // 2026-07-15 run: the old formatter spaced the range dash, the sticker-price
  // formatter doesn't — the SAME price burned an AI arbitration every run.
  const core = createCore();
  const scraped = {
    title: 'CHUNK DORE ALLEY',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    cover: '$22.10-$39.98',
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: TEST_AI_PARSER_CONFIG
  };
  const existing = {
    title: 'CHUNK DORE ALLEY',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    notes: 'cover: $22.10 - $39.98'
  };
  const adapter = buildArbitrationAdapter({});

  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let finalEvent;
  try {
    finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  } finally {
    console.log = originalLog;
  }

  assert.equal(adapter.calls.length, 0, 'a whitespace-only cover twin must never reach the AI');
  assert.equal(finalEvent.cover, '$22.10 - $39.98', 'the calendar formatting is kept — nothing churns');
  assert.equal(core.parseNotesIntoFields(finalEvent.notes).cover, '$22.10 - $39.98');
  assert.ok(!logLines.some(line => line.startsWith('🔄 MERGE:')),
    `a formatting twin must not be tracked as clobbered, got: ${JSON.stringify(logLines)}`);
});

test('a genuinely differing scraped cover wins deterministically — freshness, not arbitration', async () => {
  // Prices only ever come from the live ticket page; the calendar copy is last
  // scrape's snapshot, so arbitration (which has no freshness signal) is the
  // wrong tool for genuine cover differences.
  const core = createCore();
  const scraped = {
    title: 'CHUNK DORE ALLEY',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    cover: '$46.13-$61.50',
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: TEST_AI_PARSER_CONFIG
  };
  const existing = {
    title: 'CHUNK DORE ALLEY',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    notes: 'cover: $25.63 - $61.50'
  };
  const adapter = buildArbitrationAdapter({
    cover: { pick: 'calendar', value: '$25.63 - $61.50', reason: 'should never be asked' }
  });

  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let finalEvent;
  try {
    finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  } finally {
    console.log = originalLog;
  }

  assert.equal(adapter.calls.length, 0, 'genuine cover differences must never reach the AI');
  assert.equal(finalEvent.cover, '$46.13-$61.50', 'the live-page price wins');
  assert.equal(core.parseNotesIntoFields(finalEvent.notes).cover, '$46.13-$61.50');
  assert.ok(logLines.some(line => line.startsWith('🔒 MERGE:')
    && line.includes('field=cover')
    && line.includes('cover reflects the live ticket page — freshness wins')),
    `the deterministic decision must be logged, got: ${JSON.stringify(logLines)}`);
  assert.ok(finalEvent._original.aiArbitration.deterministic.includes('cover'),
    'the decision is recorded as deterministic for display/metrics');
});

test('PARSER MERGE summary lists only fields the merge actually changed on the outgoing record', async () => {
  const core = createCore();
  // bar: existing wins over the empty incoming side → the outgoing record changed.
  // cover: incoming wins (existing empty) → the base { ...newEvent } spread already
  // carried it, so nothing changed — it must NOT be listed as updated.
  const existing = {
    title: 'CHUNK DORE ALLEY',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    bar: 'SF Eagle',
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({})
  };
  const incoming = {
    title: 'CHUNK DORE ALLEY',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    bar: '',
    cover: '$46.13-$61.50',
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: TEST_AI_PARSER_CONFIG
  };

  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let merged;
  try {
    merged = await core.mergeParsedEvents(existing, incoming, {});
  } finally {
    console.log = originalLog;
  }

  assert.equal(merged.bar, 'SF Eagle');
  assert.equal(merged.cover, '$46.13-$61.50');
  const summary = logLines.find(line => line.includes('🔄 PARSER MERGE:'));
  assert.ok(summary, `expected a PARSER MERGE summary, got: ${JSON.stringify(logLines)}`);
  assert.match(summary, /1 field updated \(bar\)/, 'only the genuinely changed field is counted');
  assert.ok(!summary.includes('cover'), 'a preserved-from-base field must not be listed as updated');
});

// ---------------------------------------------------------------------------
// gmaps is DERIVED (a pure function of bar + address) — never arbitrated,
// always regenerated from the final merged values (2026-07-15 run: arbitrating
// gmaps independently let it disagree with the merged bar/address)
// ---------------------------------------------------------------------------

const GMAPS_TEST_ADDRESS = '10-90 Wyckoff Avenue, Queens, NY 11385';

function buildGmapsUrl(barName) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${barName}, ${GMAPS_TEST_ADDRESS}`)}`;
}

function buildGmapsScraped(overrides = {}) {
  const core = createCore();
  return {
    title: 'MEGAWOOF',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    bar: 'Basement',
    address: GMAPS_TEST_ADDRESS,
    gmaps: buildGmapsUrl('Basement'),
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({}),
    _parserConfig: TEST_AI_PARSER_CONFIG,
    ...overrides
  };
}

function buildGmapsExisting(barName, gmapsValue) {
  return {
    title: 'MEGAWOOF',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    notes: [
      `bar: ${barName}`,
      `address: ${GMAPS_TEST_ADDRESS}`,
      `gmaps: ${gmapsValue}`
    ].join('\n')
  };
}

test('gmaps is regenerated from the merged bar + address and never enters arbitration', async () => {
  const core = createCore();

  // AI picks the CALENDAR bar → gmaps is rebuilt around it
  const calendarWins = buildArbitrationAdapter({
    bar: { pick: 'calendar', value: 'HOLO', reason: 'official venue name' }
  });
  const holoEvent = await core.createFinalEventObject(
    buildGmapsExisting('HOLO', 'https://www.google.com/maps/search/?api=1&query=stale'),
    buildGmapsScraped(),
    { httpAdapter: calendarWins });
  assert.equal(calendarWins.calls.length, 1, 'only the bar conflict arbitrates');
  assert.ok(!/field: gmaps/.test(calendarWins.calls[0].prompt), 'gmaps must never be in the AI batch');
  assert.equal(holoEvent.bar, 'HOLO');
  assert.equal(holoEvent.gmaps, buildGmapsUrl('HOLO'), 'gmaps follows the merged bar + address');
  assert.equal(core.parseNotesIntoFields(holoEvent.notes).gmaps, buildGmapsUrl('HOLO'), 'the derived gmaps round-trips');

  // AI picks the SCRAPED bar → gmaps is rebuilt around that instead
  const scrapedWins = buildArbitrationAdapter({
    bar: { pick: 'scraped', value: 'Basement', reason: 'venue changed' }
  });
  const basementEvent = await core.createFinalEventObject(
    buildGmapsExisting('HOLO', buildGmapsUrl('HOLO')),
    buildGmapsScraped(),
    { httpAdapter: scrapedWins });
  assert.equal(basementEvent.bar, 'Basement');
  assert.equal(basementEvent.gmaps, buildGmapsUrl('Basement'), 'gmaps is rebuilt when the scraped bar wins');
});

test('gmaps clobber tracking: an unchanged regenerated URL is quiet, a changed one is reported', async () => {
  const core = createCore();
  const capture = async (existing, scraped) => {
    const logLines = [];
    const originalLog = console.log;
    console.log = (message) => { logLines.push(String(message)); };
    try {
      await core.createFinalEventObject(existing, scraped, { httpAdapter: buildArbitrationAdapter({}) });
    } finally {
      console.log = originalLog;
    }
    return logLines;
  };

  // Stored gmaps already equals the regenerated value → nothing reported, even
  // though the scraped side carried a different (e.g. coordinate-form) URL
  const quietLines = await capture(
    buildGmapsExisting('Basement', buildGmapsUrl('Basement')),
    buildGmapsScraped({ gmaps: 'https://www.google.com/maps/search/?api=1&query=40.7089%2C-73.9188' }));
  assert.ok(!quietLines.some(line => line.startsWith('🔄 MERGE:')),
    `an unchanged derived gmaps must not be reported clobbered, got: ${JSON.stringify(quietLines)}`);

  // Stale stored gmaps → the regenerated value replaces it and IS reported
  const changedLines = await capture(
    buildGmapsExisting('Basement', 'https://www.google.com/maps/search/?api=1&query=stale'),
    buildGmapsScraped());
  assert.ok(changedLines.some(line => line.startsWith('🔄 MERGE:') && line.includes('gmaps')),
    `a genuinely changed gmaps is tracked, got: ${JSON.stringify(changedLines)}`);
});

// ---------------------------------------------------------------------------
// Built-in page classification rules (platform defaults beneath config rules)
// ---------------------------------------------------------------------------

test('built-in classification rules are active with an empty config', () => {
  const core = createCore();
  assert.equal(core.classifyPage('https://www.eventbrite.com/e/party-123', null), 'event-page');
  assert.equal(core.classifyPage('https://www.eventbrite.com/o/org-456', null), 'multi-event-page');
  assert.equal(core.classifyPage('https://linktr.ee/somepromoter', null), 'link-aggregator');
  // They resolve at the deterministic url-rule tier (no HTML needed)
  assert.deepEqual(
    core.classifyPageWithSignal('https://linktr.ee/somepromoter', null),
    { classification: 'link-aggregator', signal: 'url-rule' }
  );
});

test('config classification rules are checked BEFORE built-ins (config overrides)', () => {
  const core = new SharedCore(CITIES, {
    eventSchema: EventSchema,
    pageClassificationRules: [
      { pattern: /eventbrite\.com\/e\//i, classification: 'multi-event-page' }
    ]
  });
  assert.equal(core.classifyPage('https://www.eventbrite.com/e/party-123', null), 'multi-event-page',
    'first match wins, and config rules come first');
  // Untouched built-ins still apply beneath the config rule
  assert.equal(core.classifyPage('https://www.eventbrite.com/o/org-456', null), 'multi-event-page');
  assert.equal(core.classifyPage('https://linktr.ee/x', null), 'link-aggregator');
});

// ---------------------------------------------------------------------------
// Built-in Eventbrite /e/ confidence defaults (merge-under config)
// ---------------------------------------------------------------------------

test('built-in Eventbrite confidence defaults apply without any config and sit beneath config defaults', () => {
  const core = createCore();

  // No global config at all → built-in urlPattern present
  const bare = core.applyGlobalAiConfidenceDefaults({ name: 'X' }, null);
  const barePatterns = bare.ai.confidence.expectations.urlPatterns;
  assert.equal(barePatterns.length, 1);
  assert.match(barePatterns[0].pattern, /eventbrite\\\.com\/e\//);
  assert.deepEqual(barePatterns[0].fields.cover, { expected: ['jsonld'], strong: ['jsonld'] });
  assert.deepEqual(barePatterns[0].fields.location, { expected: ['meta'], strong: ['meta'] });

  // Config-provided defaults come AFTER the built-in (later urlPatterns entries
  // win at consumption time, so config extends/overrides)
  const mainConfig = {
    config: {
      aiConfidenceDefaults: {
        confidence: {
          expectations: {
            urlPatterns: [{ pattern: 'custom-site', fields: { image: { expected: ['meta'] } } }]
          }
        }
      }
    }
  };
  const merged = core.applyGlobalAiConfidenceDefaults({ name: 'X' }, mainConfig);
  const mergedPatterns = merged.ai.confidence.expectations.urlPatterns;
  assert.equal(mergedPatterns.length, 2);
  assert.match(mergedPatterns[0].pattern, /eventbrite/);
  assert.equal(mergedPatterns[1].pattern, 'custom-site');

  // A parser's own confidence keys still win key-wise over both layers
  const parserEntry = {
    name: 'Y',
    ai: { confidence: { minScore: 42, expectations: { urlPatterns: [{ pattern: 'parser-own', fields: {} }] } } }
  };
  const parserMerged = core.applyGlobalAiConfidenceDefaults(parserEntry, mainConfig);
  assert.equal(parserMerged.ai.confidence.minScore, 42);
  const parserPatterns = parserMerged.ai.confidence.expectations.urlPatterns;
  assert.deepEqual(parserPatterns.map(p => p.pattern), [
    barePatterns[0].pattern, 'custom-site', 'parser-own'
  ], 'layering is built-in < global config < parser');
});

// ---------------------------------------------------------------------------
// Adaptive crawl depth (urlDiscoveryDepth absent)
// ---------------------------------------------------------------------------

// Harness: canned pages keyed by URL. `fail` throws on fetch; everything else
// returns 200 with empty HTML — classification is driven purely by URL rules.
function createCrawlHarness(pages) {
  const fetched = [];
  const parsedConfigs = {};
  const httpAdapter = {
    fetchData: async (url) => {
      const page = pages[url];
      if (page && page.fail) {
        throw new Error(page.fail);
      }
      fetched.push(url);
      return { html: (page && page.html) || '<html><body></body></html>', url, statusCode: 200, headers: {} };
    }
  };
  const parsers = {
    'ai-web': {
      parseEvents: (htmlData, parserConfig) => {
        const page = pages[htmlData.url] || {};
        parsedConfigs[htmlData.url] = parserConfig;
        const result = {
          events: page.events || [],
          additionalLinks: page.additionalLinks || []
        };
        if (page.discoveredSegments) result.discoveredSegments = page.discoveredSegments;
        if (page.discoveredSocialLinks) result.discoveredSocialLinks = page.discoveredSocialLinks;
        if (page.discoveredOrganizer) result.discoveredOrganizer = page.discoveredOrganizer;
        return result;
      }
    }
  };
  return { fetched, parsedConfigs, httpAdapter, parsers };
}

// Deterministic crawl entries: no AI classification second opinion, no bear-check chatter
const CRAWL_AI = { classifyPages: false, bearCheck: { mode: 'off' } };

test('adaptive crawl: aggregator and multi-event pages follow links; event pages follow only rule-classified event links + extracted ticketUrl', async () => {
  const core = createCore();
  const display = createDisplayAdapterStub();
  const pages = {
    'https://linktr.ee/newsite': { additionalLinks: ['https://www.eventbrite.com/o/newsite-123'] },
    'https://www.eventbrite.com/o/newsite-123': { additionalLinks: ['https://www.eventbrite.com/e/party-1'] },
    'https://www.eventbrite.com/e/party-1': {
      events: [{ title: 'Party One', startDate: new Date(Date.now() + 7 * 86400000), ticketUrl: 'https://tickets.example/party-1' }],
      additionalLinks: [
        'https://www.eventbrite.com/e/party-2',      // rule-classifiable event page → followed
        'https://newsite.example/press-and-media'     // valid but not an event page by URL rules → NOT followed
      ]
    },
    'https://www.eventbrite.com/e/party-2': {},
    'https://tickets.example/party-1': {}
  };
  const { fetched, parsedConfigs, httpAdapter, parsers } = createCrawlHarness(pages);

  await core.processParser(
    { name: 'Adaptive Chain', urls: ['https://linktr.ee/newsite'], ai: CRAWL_AI },
    {}, httpAdapter, display, parsers
  );

  assert.ok(display.logs.includes('SYSTEM: Adaptive Chain → adaptive crawl depth'), 'adaptive mode announced once per parser');
  assert.ok(fetched.includes('https://www.eventbrite.com/o/newsite-123'), 'link-aggregator links are followed');
  assert.ok(fetched.includes('https://www.eventbrite.com/e/party-1'), 'multi-event-page links are followed');
  assert.ok(fetched.includes('https://www.eventbrite.com/e/party-2'), 'event page follows sibling links pre-classifiable as event-page');
  assert.ok(fetched.includes('https://tickets.example/party-1'), 'event page follows its extracted ticketUrl');
  assert.ok(!fetched.includes('https://newsite.example/press-and-media'), 'nav/related links stay unfollowed on event pages');

  // Adaptive mode never stamps a numeric depth onto per-page configs
  assert.equal(parsedConfigs['https://www.eventbrite.com/e/party-1'].urlDiscoveryDepth, undefined);
});

test('adaptive crawl: ad and unknown pages follow nothing', async () => {
  const core = new SharedCore(CITIES, {
    eventSchema: EventSchema,
    pageClassificationRules: [{ pattern: /ads\.example/i, classification: 'ad' }]
  });
  const display = createDisplayAdapterStub();
  const pages = {
    // No URL rule + empty HTML → 'unknown'
    'https://mystery.example/': { additionalLinks: ['https://mystery.example/next'] },
    'https://mystery.example/next': {},
    'https://ads.example/': { additionalLinks: ['https://ads.example/promo'] },
    'https://ads.example/promo': {}
  };
  const { fetched, httpAdapter, parsers } = createCrawlHarness(pages);

  await core.processParser(
    { name: 'Unknown Root', urls: ['https://mystery.example/'], ai: CRAWL_AI },
    {}, httpAdapter, display, parsers
  );
  assert.deepEqual(fetched, ['https://mystery.example/'], 'unknown pages follow nothing');
  assert.ok(display.logs.includes('SYSTEM: Adaptive crawl: stopping at https://mystery.example/ (unknown)'));

  fetched.length = 0;
  await core.processParser(
    { name: 'Ad Root', urls: ['https://ads.example/'], ai: CRAWL_AI },
    {}, httpAdapter, display, parsers
  );
  assert.deepEqual(fetched, ['https://ads.example/'], 'ad pages skip the parser and follow nothing');
});

test('adaptive crawl: hard chain cap at 4 hops (logged when hit)', async () => {
  const core = new SharedCore(CITIES, {
    eventSchema: EventSchema,
    pageClassificationRules: [{ pattern: /chain\.example/i, classification: 'link-aggregator' }]
  });
  const display = createDisplayAdapterStub();
  const pages = {};
  for (let i = 1; i <= 6; i++) {
    pages[`https://chain.example/p${i}`] = i < 6
      ? { additionalLinks: [`https://chain.example/p${i + 1}`] }
      : {};
  }
  const { fetched, httpAdapter, parsers } = createCrawlHarness(pages);

  await core.processParser(
    { name: 'Chain', urls: ['https://chain.example/p1'], ai: CRAWL_AI },
    {}, httpAdapter, display, parsers
  );

  assert.deepEqual(fetched, [1, 2, 3, 4, 5].map(i => `https://chain.example/p${i}`),
    'pages 4 hops from the root never have their links followed');
  assert.ok(
    display.logs.some(line => line.includes('Adaptive crawl: chain cap (4 hops) reached at https://chain.example/p5')),
    `expected chain-cap log, got: ${JSON.stringify(display.logs.filter(l => l.includes('Adaptive')))}`
  );
});

test('explicit numeric urlDiscoveryDepth keeps legacy behavior byte-for-byte (including 0 = never crawl)', async () => {
  const core = new SharedCore(CITIES, {
    eventSchema: EventSchema,
    pageClassificationRules: [{ pattern: /fixed\.example/i, classification: 'link-aggregator' }]
  });
  const pages = {
    'https://fixed.example/root': { additionalLinks: ['https://fixed.example/a'] },
    'https://fixed.example/a': { additionalLinks: ['https://fixed.example/b'] },
    'https://fixed.example/b': {}
  };

  // depth 1: root + depth-1 pages, deeper links hit the legacy depth-limit log
  {
    const display = createDisplayAdapterStub();
    const { fetched, parsedConfigs, httpAdapter, parsers } = createCrawlHarness(pages);
    await core.processParser(
      { name: 'Depth One', urls: ['https://fixed.example/root'], urlDiscoveryDepth: 1, ai: CRAWL_AI },
      {}, httpAdapter, display, parsers
    );
    assert.deepEqual(fetched, ['https://fixed.example/root', 'https://fixed.example/a']);
    assert.ok(display.logs.includes('SYSTEM: Crawling 1 discovered URLs (depth 1/1)'), 'numeric crawl log keeps its exact shape');
    assert.ok(display.logs.includes(
      'SYSTEM: Crawl page https://fixed.example/a found 1 unique additional URLs, but depth limit (1) reached or URL discovery disabled - ignoring'
    ), 'legacy depth-limit log unchanged');
    assert.ok(!display.logs.some(line => line.includes('adaptive')), 'no adaptive logs in numeric mode');
    // Legacy remaining-depth math still stamped onto per-page configs
    assert.equal(parsedConfigs['https://fixed.example/a'].urlDiscoveryDepth, 0);
  }

  // depth 0: never crawl
  {
    const display = createDisplayAdapterStub();
    const { fetched, httpAdapter, parsers } = createCrawlHarness(pages);
    await core.processParser(
      { name: 'Depth Zero', urls: ['https://fixed.example/root'], urlDiscoveryDepth: 0, ai: CRAWL_AI },
      {}, httpAdapter, display, parsers
    );
    assert.deepEqual(fetched, ['https://fixed.example/root']);
    assert.ok(display.logs.some(line => line.includes('depth limit (0) reached')));
  }
});

// ---------------------------------------------------------------------------
// Suggested-config block (discoveryOnly onboarding output)
// ---------------------------------------------------------------------------

test('buildSuggestedParserConfig renders harvested fields and omits lines without data', () => {
  const core = createCore();

  const full = core.buildSuggestedParserConfig(
    { name: 'Twisted Bear', urls: ['https://www.eventbrite.com/o/nab-events-llc-51471535173'] },
    {
      socialLinks: { instagram: 'https://www.instagram.com/twistedbearparty' },
      organizer: { name: 'Twisted Bear Events', url: 'https://twistedbear.example' }
    }
  );
  assert.equal(full, [
    '📋 SUGGESTED CONFIG for "Twisted Bear" — paste into parsers[] in scraper-input.js:',
    '{',
    '  name: "Twisted Bear",',
    '  enabled: false, // flip on after a dry-run preview looks right',
    '  urls: ["https://www.eventbrite.com/o/nab-events-llc-51471535173"],',
    '  alwaysBear: false, // set true for trusted bear promoters (AI trust context)',
    '  metadata: {',
    '    shortName: { value: "TWISTED BEAR EVENTS" }, // add a hyphen where it should line-break',
    '    instagram: { value: "https://www.instagram.com/twistedbearparty" }, // found on page',
    '    website: { value: "https://twistedbear.example" }, // found on page',
    '  },',
    '},'
  ].join('\n'));

  // Nothing harvested → shortName falls back to the parser name; no social/website lines
  const minimal = core.buildSuggestedParserConfig(
    { name: 'Plain Site', urls: ['https://plain.example/events'] },
    { socialLinks: {}, organizer: null }
  );
  assert.ok(minimal.includes('    shortName: { value: "PLAIN SITE" }, // add a hyphen where it should line-break'));
  assert.ok(!minimal.includes('instagram:'));
  assert.ok(!minimal.includes('facebook:'));
  assert.ok(!minimal.includes('website:'));
});

test('discoveryOnly runs emit the suggested-config block with harvested social links', async () => {
  const core = createCore();
  const display = createDisplayAdapterStub();
  const pages = {
    'https://www.eventbrite.com/o/newsite-123': {
      additionalLinks: ['https://www.eventbrite.com/e/party-1'],
      discoveredSocialLinks: { instagram: 'https://www.instagram.com/newsite' }
    },
    'https://www.eventbrite.com/e/party-1': {
      discoveredOrganizer: { name: 'New Site Events', url: 'https://newsite.example' },
      discoveredSegments: [{ index: 1, lineCount: 2, preview: 'PARTY', imageUrls: [], resourceLines: [] }]
    }
  };
  const { httpAdapter, parsers } = createCrawlHarness(pages);

  const parserResult = await core.processParser(
    { name: 'New Site', urls: ['https://www.eventbrite.com/o/newsite-123'], discoveryOnly: true, ai: CRAWL_AI },
    {}, httpAdapter, display, parsers
  );

  assert.ok(display.logs.some(line => line.startsWith('SYSTEM: New Site → Discovery only mode (depth adaptive)')),
    'discoveryOnly startup line carries the adaptive marker when depth is absent');
  const block = display.logs.find(line => line.startsWith('📋 SUGGESTED CONFIG for "New Site"'));
  assert.ok(block, 'suggested config emitted after discovery');
  assert.equal(parserResult.suggestedConfig, block,
    'suggested config also carried on the parser result so the results UI can render it with a copy button');
  assert.ok(block.includes('    shortName: { value: "NEW SITE EVENTS" }, // add a hyphen where it should line-break'));
  assert.ok(block.includes('    instagram: { value: "https://www.instagram.com/newsite" }, // found on page'));
  assert.ok(block.includes('    website: { value: "https://newsite.example" }, // found on page'));
});

// ---------------------------------------------------------------------------
// Learned dead-end store (pure semantics — persistence lives in adapters)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function deadEndCore() {
  // hub.example → multi-event-page so its links are always followed in adaptive mode
  return new SharedCore(CITIES, {
    eventSchema: EventSchema,
    pageClassificationRules: [
      { pattern: /hub\.example/i, classification: 'multi-event-page' },
      { pattern: /ads\.example/i, classification: 'ad' }
    ]
  });
}

function deadEndConfig({ store = {}, retryDays, discoveryOnly = false, links, name = 'Dead End Run' } = {}) {
  return {
    config: retryDays === undefined ? {} : { deadEndRetryDays: retryDays },
    deadEndStore: store,
    parsers: [{
      name,
      urls: ['https://hub.example/'],
      discoveryOnly,
      ai: CRAWL_AI,
      _links: links
    }]
  };
}

test('dead-end store: barren discovered pages are learned; productive, failed-fetch, and root pages never are', async () => {
  const core = deadEndCore();
  const display = createDisplayAdapterStub();
  const pages = {
    'https://hub.example/': {
      additionalLinks: [
        'https://site.example/dead',
        'https://site.example/past-events',
        'https://site.example/broken'
      ]
    },
    'https://site.example/dead': {},                        // fetched fine, 0 events/segments/links → dead end
    'https://site.example/past-events': {
      // RAW parse output counts: all-past events are still events → NOT a dead end
      events: [{ title: 'Old Party', startDate: new Date('2020-01-01T00:00:00.000Z') }]
    },
    'https://site.example/broken': { fail: 'HTTP 503: unavailable' } // fetch failure → never dead-ended
  };
  const { httpAdapter, parsers } = createCrawlHarness(pages);
  const config = deadEndConfig({});

  const results = await core.processEvents(config, httpAdapter, display, parsers);

  assert.deepEqual(Object.keys(results.deadEndStore), ['https://site.example/dead']);
  const entry = results.deadEndStore['https://site.example/dead'];
  assert.equal(entry.misses, 1);
  assert.ok(Date.parse(entry.firstSeen) > 0 && entry.firstSeen === entry.lastSeen);
  assert.equal(results.deadEndStoreChanged, true);
  assert.ok(display.logs.includes('SYSTEM: Learned 1 new dead-end URL(s): https://site.example/dead'));
  // The barren ROOT of a barren site is still never stored
  assert.ok(!('https://hub.example/' in results.deadEndStore));
});

test('dead-end store: young entries are skipped before enqueueing, with the reset hint in the log', async () => {
  const core = deadEndCore();
  const display = createDisplayAdapterStub();
  const youngLastSeen = new Date(Date.now() - 1 * DAY_MS).toISOString();
  const store = {
    'https://site.example/dead': { firstSeen: youngLastSeen, lastSeen: youngLastSeen, misses: 1 }
  };
  const pages = {
    'https://hub.example/': { additionalLinks: ['https://site.example/dead'] },
    'https://site.example/dead': {}
  };
  const { fetched, httpAdapter, parsers } = createCrawlHarness(pages);

  const results = await core.processEvents(deadEndConfig({ store }), httpAdapter, display, parsers);

  assert.ok(!fetched.includes('https://site.example/dead'), 'young dead end is not fetched');
  assert.equal(results.deadEndStoreChanged, false, 'skipping does not touch the store');
  const skipLine = display.logs.find(line => line.startsWith('SYSTEM: Skipped 1 known dead-end URL(s)'));
  assert.ok(skipLine, `expected skip log, got: ${JSON.stringify(display.logs)}`);
  assert.ok(skipLine.includes('retry after 30d'), 'retry horizon in the log');
  assert.ok(skipLine.includes('delete dead-ends.json or set deadEndRetryDays: 0 to reset'), 'recovery hint in the log');
  assert.ok(skipLine.includes('https://site.example/dead'), 'sample URL in the log');
});

test('dead-end store: expired entries retry once — removed when productive, refreshed when still dead', async () => {
  const core = deadEndCore();
  const expiredLastSeen = new Date(Date.now() - 40 * DAY_MS).toISOString();

  // Now productive → removed from the store
  {
    const display = createDisplayAdapterStub();
    const store = {
      'https://site.example/revived': { firstSeen: expiredLastSeen, lastSeen: expiredLastSeen, misses: 2 }
    };
    const pages = {
      'https://hub.example/': { additionalLinks: ['https://site.example/revived'] },
      'https://site.example/revived': {
        events: [{ title: 'Comeback Party', startDate: new Date(Date.now() + 7 * DAY_MS) }]
      }
    };
    const { fetched, httpAdapter, parsers } = createCrawlHarness(pages);
    const results = await core.processEvents(deadEndConfig({ store }), httpAdapter, display, parsers);

    assert.ok(fetched.includes('https://site.example/revived'), 'expired entry is retried');
    assert.deepEqual(results.deadEndStore, {}, 'productive page self-heals out of the store');
    assert.equal(results.deadEndStoreChanged, true);
  }

  // Still dead → lastSeen refreshed + misses incremented (not re-learned)
  {
    const display = createDisplayAdapterStub();
    const store = {
      'https://site.example/still-dead': { firstSeen: expiredLastSeen, lastSeen: expiredLastSeen, misses: 2 }
    };
    const pages = {
      'https://hub.example/': { additionalLinks: ['https://site.example/still-dead'] },
      'https://site.example/still-dead': {}
    };
    const { fetched, httpAdapter, parsers } = createCrawlHarness(pages);
    const results = await core.processEvents(deadEndConfig({ store }), httpAdapter, display, parsers);

    assert.ok(fetched.includes('https://site.example/still-dead'));
    const entry = results.deadEndStore['https://site.example/still-dead'];
    assert.equal(entry.misses, 3);
    assert.ok(Date.parse(entry.lastSeen) > Date.now() - DAY_MS, 'lastSeen refreshed to now');
    assert.equal(entry.firstSeen, expiredLastSeen, 'firstSeen preserved');
    assert.ok(!display.logs.some(line => line.includes('Learned 1 new dead-end')), 'a refreshed miss is not re-learned');
  }
});

test('dead-end store: entries unseen for 2× the retry window are pruned at end of run', async () => {
  const core = deadEndCore();
  const display = createDisplayAdapterStub();
  const staleLastSeen = new Date(Date.now() - 90 * DAY_MS).toISOString();  // > 2×30d
  const freshLastSeen = new Date(Date.now() - 10 * DAY_MS).toISOString();
  const store = {
    'https://gone.example/forgotten': { firstSeen: staleLastSeen, lastSeen: staleLastSeen, misses: 4 },
    'https://site.example/recent': { firstSeen: freshLastSeen, lastSeen: freshLastSeen, misses: 1 }
  };
  const pages = { 'https://hub.example/': {} };
  const { httpAdapter, parsers } = createCrawlHarness(pages);

  const results = await core.processEvents(deadEndConfig({ store }), httpAdapter, display, parsers);

  assert.deepEqual(Object.keys(results.deadEndStore), ['https://site.example/recent']);
  assert.equal(results.deadEndStoreChanged, true);
  assert.ok(display.logs.some(line => line.includes('Pruned 1 stale dead-end URL(s)')));
});

test('dead-end store: deadEndRetryDays 0 is a kill switch — nothing skipped, nothing learned', async () => {
  const core = deadEndCore();
  const display = createDisplayAdapterStub();
  const youngLastSeen = new Date(Date.now() - 1 * DAY_MS).toISOString();
  const store = {
    'https://site.example/dead': { firstSeen: youngLastSeen, lastSeen: youngLastSeen, misses: 1 }
  };
  const pages = {
    'https://hub.example/': { additionalLinks: ['https://site.example/dead', 'https://site.example/newly-dead'] },
    'https://site.example/dead': {},
    'https://site.example/newly-dead': {}
  };
  const { fetched, httpAdapter, parsers } = createCrawlHarness(pages);

  const results = await core.processEvents(deadEndConfig({ store, retryDays: 0 }), httpAdapter, display, parsers);

  assert.ok(fetched.includes('https://site.example/dead'), 'young entry fetched anyway — no skipping when disabled');
  assert.ok(!('https://site.example/newly-dead' in results.deadEndStore), 'nothing new learned when disabled');
  assert.equal(results.deadEndStoreChanged, false);
  assert.ok(display.logs.some(line => line.includes('Dead-end store disabled')), 'one-liner announces the store is off');
});

test('dead-end store: discoveryOnly never skips, and a productive fetch removes the entry', async () => {
  const core = deadEndCore();
  const display = createDisplayAdapterStub();
  const youngLastSeen = new Date(Date.now() - 1 * DAY_MS).toISOString();
  const store = {
    'https://site.example/revived': { firstSeen: youngLastSeen, lastSeen: youngLastSeen, misses: 1 }
  };
  const pages = {
    'https://hub.example/': { additionalLinks: ['https://site.example/revived'] },
    'https://site.example/revived': { additionalLinks: ['https://site.example/deeper'] },
    'https://site.example/deeper': {}
  };
  const { fetched, httpAdapter, parsers } = createCrawlHarness(pages);

  const results = await core.processEvents(deadEndConfig({ store, discoveryOnly: true }), httpAdapter, display, parsers);

  assert.ok(fetched.includes('https://site.example/revived'), 'discovery mode always fetches, even young dead ends');
  assert.ok(!('https://site.example/revived' in results.deadEndStore), 'productive page removed from the store');
  assert.equal(results.deadEndStoreChanged, true);
});

test('dead-end store: ad-classified pages are stored regardless of links; unknown pages follow the strict output rule', async () => {
  const core = deadEndCore();

  // Unit-level force rule: 'ad' with plenty of valid links is still a dead end
  core.deadEndRunContext = core.createDeadEndRunContext({ deadEndStore: {} });
  core.recordDeadEndObservation({
    url: 'https://ads.example/promo',
    currentDepth: 1,
    parseResult: { events: [], additionalLinks: ['https://x.example/e/party'] },
    pageClassification: 'ad'
  });
  core.recordDeadEndObservation({
    url: 'https://mystery.example/links',
    currentDepth: 1,
    parseResult: { events: [], additionalLinks: ['https://x.example/e/party'] },
    pageClassification: 'unknown'
  });
  const store = core.deadEndRunContext.store;
  assert.ok('https://ads.example/promo' in store, 'ad page with valid links is a dead end');
  assert.ok(!('https://mystery.example/links' in store), 'unknown page with valid links is NOT force-stored');
  core.deadEndRunContext = null;

  // End-to-end: a discovered ad page lands in the store after the run
  const display = createDisplayAdapterStub();
  const pages = {
    'https://hub.example/': { additionalLinks: ['https://ads.example/promo'] },
    'https://ads.example/promo': {}
  };
  const { httpAdapter, parsers } = createCrawlHarness(pages);
  const results = await core.processEvents(deadEndConfig({}), httpAdapter, display, parsers);
  assert.ok('https://ads.example/promo' in results.deadEndStore);
});

test('dead-end store: maxAdditionalUrls 0 cannot fake a dead end when the parser tags uniqueValidCount', () => {
  const core = deadEndCore();
  core.deadEndRunContext = core.createDeadEndRunContext({ deadEndStore: {} });
  const budgetedLinks = [];
  Object.defineProperty(budgetedLinks, 'uniqueValidCount', { value: 7, enumerable: false });
  core.recordDeadEndObservation({
    url: 'https://site.example/budgeted',
    currentDepth: 1,
    parseResult: { events: [], additionalLinks: budgetedLinks },
    pageClassification: 'multi-event-page'
  });
  assert.deepEqual(core.deadEndRunContext.store, {}, 'valid-but-budget-capped links keep the page productive');
  core.deadEndRunContext = null;
});

// ---------------------------------------------------------------------------
// Crawl-queue hygiene (run 20260724-161423: raw CDN images fetched as pages,
// recorded dead ends refetched, www/non-www double-crawled, tixr 403 walls)
// ---------------------------------------------------------------------------

test('crawl queue: static-asset URLs that slip past discovery are skipped at processing time, never fetched', async () => {
  const core = deadEndCore();
  const display = createDisplayAdapterStub();
  // Literal asset URLs the phone run fetched as crawl pages
  const assetUrls = [
    'https://cdn.prod.website-files.com/659447a9dbb86fcea688b307/6765bd9509d17cbbf6cc31d5_massive-0016.avif',
    'https://cdn.prod.website-files.com/659447a9dbb86fcea688b307/675a769ae3ac8d25a81f9936_image-0001.webp',
    'https://cdn.prod.website-files.com/659447a9dbb86fcea688b307/659474124df37d0bd876efab_Massive-Seattle-Nightclub-Blog-Header-Introducing.jpg'
  ];
  const pages = {
    'https://hub.example/': { additionalLinks: [...assetUrls, 'https://site.example/party'] },
    'https://site.example/party': {}
  };
  const { fetched, httpAdapter, parsers } = createCrawlHarness(pages);

  await core.processEvents(deadEndConfig({}), httpAdapter, display, parsers);

  for (const assetUrl of assetUrls) {
    assert.ok(!fetched.includes(assetUrl), `static asset must not be fetched: ${assetUrl}`);
    assert.ok(
      display.logs.includes(`SYSTEM: Skipping static-asset URL in crawl queue: ${assetUrl}`),
      `skip log expected for ${assetUrl}`
    );
  }
  assert.ok(fetched.includes('https://site.example/party'), 'real pages still crawled');
});

test('crawl queue: a recorded dead end is skipped even when the queued string differs from the fetch-time URL', async () => {
  const core = deadEndCore();
  const display = createDisplayAdapterStub();
  const youngLastSeen = new Date(Date.now() - 1 * DAY_MS).toISOString();
  // dead-ends.json holds the CLEAN URL (recorded after the crawl loop's own
  // normalizeUrl pass)…
  const store = {
    'https://site.example/gallery': { firstSeen: youngLastSeen, lastSeen: youngLastSeen, misses: 3 }
  };
  const pages = {
    // …but the queued candidate carries an entity-mangled tail, so the
    // enqueue-time filter cannot see the match — only the processing-time
    // check against the fetch-time URL can.
    'https://hub.example/': { additionalLinks: ['https://site.example/gallery"'] },
    'https://site.example/gallery': {}
  };
  const { fetched, httpAdapter, parsers } = createCrawlHarness(pages);

  await core.processEvents(deadEndConfig({ store }), httpAdapter, display, parsers);

  assert.ok(!fetched.includes('https://site.example/gallery'), 'known dead end is not refetched');
  assert.ok(
    display.logs.includes('SYSTEM: Skipping known dead-end URL (3 prior misses): https://site.example/gallery'),
    `expected processing-time skip log, got: ${JSON.stringify(display.logs.filter(line => line.includes('dead-end')))}`
  );
});

test('crawl queue: HTTP 403 crawl pages are learned as dead ends (tixr bot wall) and skipped on the next run', async () => {
  const tixrUrl = 'https://tixr.com/e/199620';
  const failure = `HTTP request failed for ${tixrUrl}: HTTP 403 error from ${tixrUrl}`;

  // Run 1: the 403 is learned
  const core = deadEndCore();
  const display = createDisplayAdapterStub();
  const pages = {
    'https://hub.example/': { additionalLinks: [tixrUrl] },
    [tixrUrl]: { fail: failure }
  };
  const { httpAdapter, parsers } = createCrawlHarness(pages);
  const results = await core.processEvents(deadEndConfig({}), httpAdapter, display, parsers);

  const entry = results.deadEndStore[tixrUrl];
  assert.ok(entry, '403 page recorded in the dead-end store');
  assert.equal(entry.misses, 1);
  assert.equal(entry.lastStatus, 403);
  assert.ok(display.logs.includes(`SYSTEM: Learned 1 new dead-end URL(s): ${tixrUrl}`));
  assert.ok(display.logs.some(line => line.includes(`Failed to process crawl page ${tixrUrl}`)), 'run 1 still surfaces the fetch error');

  // Run 2 with the persisted store: the URL is skipped, no fetch error
  const core2 = deadEndCore();
  const display2 = createDisplayAdapterStub();
  const harness2 = createCrawlHarness(pages);
  await core2.processEvents(deadEndConfig({ store: results.deadEndStore }), harness2.httpAdapter, display2, harness2.parsers);

  assert.ok(!display2.logs.some(line => line.includes(`Failed to process crawl page ${tixrUrl}`)), 'run 2 does not retry the bot wall');
  assert.ok(display2.logs.some(line => line.startsWith('SYSTEM: Skipped 1 known dead-end URL(s)')), 'run 2 reports the skip');
});

test('crawl queue: non-bot-wall fetch failures (503) are still never dead-ended', async () => {
  const core = deadEndCore();
  const display = createDisplayAdapterStub();
  const pages = {
    'https://hub.example/': { additionalLinks: ['https://site.example/flaky'] },
    'https://site.example/flaky': { fail: 'HTTP request failed: HTTP 503 error' }
  };
  const { httpAdapter, parsers } = createCrawlHarness(pages);
  const results = await core.processEvents(deadEndConfig({}), httpAdapter, display, parsers);
  assert.ok(!('https://site.example/flaky' in results.deadEndStore), 'transient failure is not learned');
});

test('crawl queue: www and bare-host variants of the same path are one queue entry (first queued wins)', async () => {
  const core = deadEndCore();
  const display = createDisplayAdapterStub();
  // Literal pair from the phone run — both were separately fetched and AI-classified
  const pages = {
    'https://hub.example/': {
      additionalLinks: [
        'https://www.massive.club/monthly-events',
        'https://massive.club/monthly-events'
      ]
    },
    'https://www.massive.club/monthly-events': {},
    'https://massive.club/monthly-events': {}
  };
  const { fetched, httpAdapter, parsers } = createCrawlHarness(pages);

  await core.processEvents(deadEndConfig({}), httpAdapter, display, parsers);

  assert.ok(fetched.includes('https://www.massive.club/monthly-events'), 'first queued variant is fetched with its ORIGINAL URL string');
  assert.ok(!fetched.includes('https://massive.club/monthly-events'), 'second variant is deduplicated');

  // Unit level: only the dedup KEY is normalized
  assert.equal(
    core.getUrlDedupeKey('https://www.massive.club/monthly-events'),
    core.getUrlDedupeKey('https://massive.club/monthly-events')
  );
  assert.notEqual(
    core.getUrlDedupeKey('https://massive.club/monthly-events'),
    core.getUrlDedupeKey('https://massive.club/calendar')
  );
});

test('isStaticAssetUrl flags asset paths (including .avif) and leaves pages and bare hosts alone', () => {
  const core = deadEndCore();
  assert.equal(core.isStaticAssetUrl('https://cdn.prod.website-files.com/659447a9dbb86fcea688b307/6765bd9509d17cbbf6cc31d5_massive-0016.avif'), true);
  assert.equal(core.isStaticAssetUrl('https://cdn.prod.website-files.com/659447a9dbb86fcea688b302/css/massive-club.shared.98617f967.min.css'), true);
  assert.equal(core.isStaticAssetUrl('https://www.massive.club/monthly-events'), false);
  assert.equal(core.isStaticAssetUrl('https://tixr.com/e/199620'), false);
  // Bare CDN hosts are NOT asset paths — the learned 403 dead-end path handles those
  assert.equal(core.isStaticAssetUrl('https://cdn.prod.website-files.com'), false);
});

test('prepareParsedEvents threads the geocodeVerification knob into the normalizer pipeline', async () => {
  const core = createCore();
  let capturedOptions = null;
  const pipeline = {
    normalizeEventsAsync: async (events, httpAdapter, options) => {
      capturedOptions = options;
      return events;
    }
  };
  const mainConfig = { config: { geocodeVerification: { mode: 'enforce' } } };

  await core.prepareParsedEvents([{ title: 'CHUNK' }], {}, mainConfig, null, pipeline, {});

  assert.deepEqual(capturedOptions, { geocodeVerification: { mode: 'enforce' } });

  // No knob configured → the option is passed through as undefined (normalizers default to "report")
  await core.prepareParsedEvents([{ title: 'CHUNK' }], {}, {}, null, pipeline, {});
  assert.deepEqual(capturedOptions, { geocodeVerification: undefined });
});

// ---------------------------------------------------------------------------
// Calendar reviewer core: geocode check statuses, unique-address dedup,
// configurable pin-moved threshold, calendar-title → city mapping
// ---------------------------------------------------------------------------

// One exact-grade Nominatim candidate for the STATION 4 address.
const REVIEW_GEOCODE_RESULTS = [{
  lat: '32.810535',
  lon: '-96.8110709',
  class: 'amenity',
  type: 'nightclub',
  addresstype: 'amenity',
  display_name: 'Station 4, Cedar Springs Road, Dallas, TX 75219',
  address: { city: 'Dallas', house_number: '3911' }
}];

function buildReviewGeocodeAdapter(results = REVIEW_GEOCODE_RESULTS, extras = {}) {
  const calls = [];
  return {
    calls,
    async fetchData(url) {
      calls.push(url);
      return JSON.stringify(results);
    },
    ...extras
  };
}

function createReviewContext(core, adapter, overrides = {}) {
  const geocodeNormalizer = new OpenStreetMapNormalizer(core);
  geocodeNormalizer.delayForRateLimit = async () => {}; // keep the suite fast
  return { httpAdapter: adapter, geocodeNormalizer, ...overrides };
}

function buildReviewEvent(overrides = {}) {
  return {
    id: 'evt-1',
    calendarTitle: 'chunky-dad-dallas',
    title: 'FURBALL',
    startDate: new Date('2026-07-05T22:00:00.000Z'),
    location: '32.810535, -96.8110709',
    address: PIN_TEST_ADDRESS,
    bar: 'STATION 4',
    ...overrides
  };
}

async function captureReview(core, events, context) {
  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let findings;
  try {
    findings = await core.reviewCalendarEvents(events, context);
  } finally {
    console.log = originalLog;
  }
  return { findings, logLines };
}

test('review: calendar title maps to city via the cities config, then the chunky-dad prefix', () => {
  const core = new SharedCore({
    nyc: { timezone: 'America/New_York', calendar: 'NYC Bears', patterns: ['nyc'] },
    dallas: { timezone: 'America/Chicago', patterns: ['dallas'] }
  }, { eventSchema: EventSchema });
  assert.equal(core.cityForCalendarTitle('NYC Bears'), 'nyc');
  assert.equal(core.cityForCalendarTitle('chunky-dad-dallas'), 'dallas');
  assert.equal(core.cityForCalendarTitle('Personal'), '');
});

test('review: unique addresses are geocoded once, no matter how many events share them', async () => {
  const core = createCore();
  const adapter = buildReviewGeocodeAdapter();
  const events = [
    buildReviewEvent({ id: 'a' }),
    buildReviewEvent({ id: 'b', title: 'FURBALL: ROUND 2' }),
    buildReviewEvent({ id: 'c', title: 'FURBALL: NO PIN', location: '' })
  ];

  const { findings, logLines } = await captureReview(core, events, createReviewContext(core, adapter));

  assert.equal(adapter.calls.length, 1, `one shared address → one geocode fetch, got: ${JSON.stringify(adapter.calls)}`);
  assert.ok(logLines.includes('🔎 REVIEW: chunky-dad-dallas — 3 events, 1 unique addresses to geocode'),
    `per-calendar progress line logged, got: ${JSON.stringify(logLines)}`);

  const byId = new Map(findings.map(finding => [finding.id, finding]));
  assert.equal(byId.get('a').status, 'ok');
  assert.equal(byId.get('b').status, 'ok');
  assert.equal(byId.get('c').status, 'missing-pin');
  assert.equal(byId.get('c').proposed.location, '32.810535, -96.8110709');
});

// Apple placemark that agrees with PIN_TEST_ADDRESS — the reverse cross-check
// passes, so destructive pin-moved proposals stay allowed.
const STATION_4_PLACEMARK = {
  subThoroughfare: '3911',
  thoroughfare: 'Cedar Springs Road',
  locality: 'Dallas',
  postalCode: '75219'
};

test('review: pin-moved beyond the threshold proposes the fresh verified pin; below stays ok', async () => {
  const core = createCore();
  const adapter = buildReviewGeocodeAdapter(REVIEW_GEOCODE_RESULTS, {
    reverseGeocodePlacemark: async () => STATION_4_PLACEMARK
  });
  const events = [
    buildReviewEvent({ id: 'moved', location: '32.8285, -96.8110709' }), // ~2km off
    buildReviewEvent({ id: 'jitter', location: '32.8106, -96.8110709' }) // ~7m off
  ];

  const { findings } = await captureReview(core, events, createReviewContext(core, adapter));
  const byId = new Map(findings.map(finding => [finding.id, finding]));

  const moved = byId.get('moved');
  assert.equal(moved.status, 'pin-moved');
  assert.equal(moved.proposed.location, '32.810535, -96.8110709');
  assert.ok(moved.distanceKm > 1.9 && moved.distanceKm < 2.1, `distance carried on the finding, got ${moved.distanceKm}`);
  assert.equal(moved.check, 'geocode');
  assert.equal(moved.calendarTitle, 'chunky-dad-dallas');

  const jitter = byId.get('jitter');
  assert.equal(jitter.status, 'ok');
  assert.deepEqual(jitter.proposed, {}, 'ok findings carry no proposal');
});

test('review: pinMovedThresholdKm is configurable', async () => {
  const core = createCore();
  const adapter = buildReviewGeocodeAdapter();
  const events = [buildReviewEvent({ id: 'moved', location: '32.8285, -96.8110709' })];

  const { findings } = await captureReview(core, events,
    createReviewContext(core, adapter, { pinMovedThresholdKm: 5 }));

  assert.equal(findings[0].status, 'ok', 'a 2km divergence is ok under a 5km threshold');
});

test('review: an address the ladder cannot pin is surfaced as unpinnable', async () => {
  const core = createCore();
  const adapter = buildReviewGeocodeAdapter([]); // every rung (and Photon) returns nothing
  const events = [
    buildReviewEvent({ id: 'no-pin', location: '' }),
    buildReviewEvent({ id: 'has-pin' })
  ];

  const { findings } = await captureReview(core, events, createReviewContext(core, adapter));
  const byId = new Map(findings.map(finding => [finding.id, finding]));

  assert.equal(byId.get('no-pin').status, 'unpinnable');
  assert.deepEqual(byId.get('no-pin').proposed, {});
  assert.ok(byId.get('no-pin').detail.includes('no usable geocoordinate'));
  // A stored pin whose address no longer geocodes is also surfaced — kept, unverified
  assert.equal(byId.get('has-pin').status, 'unpinnable');
  assert.ok(byId.get('has-pin').detail.includes('stored pin kept'));
});

test('review: a pin without an address proposes the reverse-geocoded address', async () => {
  const core = createCore();
  const adapter = buildReviewGeocodeAdapter([], {
    reverseGeocode: async () => '3911 Cedar Springs Rd, Dallas, TX 75219'
  });
  const events = [
    buildReviewEvent({ id: 'pin-only', address: '', bar: '' }),
    buildReviewEvent({ id: 'nothing', address: '', bar: '', location: '' })
  ];

  const { findings } = await captureReview(core, events, createReviewContext(core, adapter));
  const byId = new Map(findings.map(finding => [finding.id, finding]));

  const pinOnly = byId.get('pin-only');
  assert.equal(pinOnly.status, 'missing-address');
  assert.equal(pinOnly.proposed.address, '3911 Cedar Springs Rd, Dallas, TX 75219');
  assert.equal(adapter.calls.length, 0, 'the native reverse path never spends Nominatim budget');

  assert.equal(byId.get('nothing').status, 'no-data');
  assert.deepEqual(byId.get('nothing').proposed, {});
});

test('review: summarizeReviewFindings counts statuses and proposals', () => {
  const summary = SharedCore.summarizeReviewFindings([
    { status: 'ok', proposed: {} },
    { status: 'ok', proposed: {} },
    { status: 'pin-moved', proposed: { location: '1, 2' } },
    { status: 'missing-pin', proposed: { location: '1, 2' } },
    { status: 'missing-address', proposed: { address: 'x' } },
    { status: 'unverified', proposed: {} },
    { status: 'unpinnable', proposed: {} }
  ]);
  assert.equal(summary.findings, 7);
  assert.equal(summary.ok, 2);
  assert.equal(summary.proposals, 3, 'unverified findings never carry a proposal');
  assert.equal(summary.missingProposals, 2);
  assert.deepEqual(summary.byStatus, {
    ok: 2, 'pin-moved': 1, 'missing-pin': 1, 'missing-address': 1, unverified: 1, unpinnable: 1
  });
});

// ---------------------------------------------------------------------------
// Reviewer proposal verification (2026-07-15 phone run findings: report-mode
// probes returned accept-and-flag pins as "fresh verified geocodes" and the
// reviewer proposed replacing CORRECT stored pins with them — e.g. "3796
// Fifth Avenue, San Diego" onto the Fifth Avenue street centroid 4.7 km away
// downtown). Probes now always run in enforce mode and only exact-grade,
// non-cross-check-failed pins may back a proposal.
// ---------------------------------------------------------------------------

const SAN_DIEGO_REVIEW_CITIES = {
  'san-diego': {
    timezone: 'America/Los_Angeles',
    calendar: 'chunky-dad-san-diego',
    patterns: ['san diego'],
    coordinates: { lat: 32.7157, lng: -117.1611 }
  }
};

const SD_ADDRESS = '3796 Fifth Avenue, San Diego, CA 92103';
const SD_STORED_PIN = '32.7481, -117.1609'; // correct hand-verified pin at house 3796

// Nominatim's only answer: the STREET "Fifth Avenue" itself (highway class),
// centroid kilometers from house 3796 but inside the 50 km city radius.
const SD_FIFTH_AVENUE_STREET_RESULT = {
  lat: '32.7150000',
  lon: '-117.1590000',
  class: 'highway',
  type: 'residential',
  addresstype: 'road',
  display_name: 'Fifth Avenue, San Diego, California, United States',
  address: { road: 'Fifth Avenue', city: 'San Diego' }
};

// What Apple's reverse geocoder said about that street centroid on the real
// run: a different street entirely.
const SD_MISMATCH_PLACEMARK = {
  subThoroughfare: '204',
  thoroughfare: 'Marina Park Way',
  locality: 'San Diego'
};

const SD_HOUSE_PLACEMARK = {
  subThoroughfare: '3796',
  thoroughfare: 'Fifth Avenue',
  locality: 'San Diego',
  postalCode: '92103'
};

// US Census house-number interpolation for the same address ({x: lon, y: lat}).
const SD_CENSUS_MATCH = {
  result: {
    addressMatches: [{
      matchedAddress: '3796 FIFTH AVE, SAN DIEGO, CA, 92103',
      coordinates: { x: -117.1609, y: 32.7481 }
    }]
  }
};

function buildSanDiegoReviewEvent(overrides = {}) {
  return {
    id: 'sd-1',
    calendarTitle: 'chunky-dad-san-diego',
    title: 'SD BEAR NIGHT',
    startDate: new Date('2026-08-01T04:00:00.000Z'),
    location: SD_STORED_PIN,
    address: SD_ADDRESS,
    bar: '',
    ...overrides
  };
}

test('review: San Diego regression — a street-grade-only probe never proposes; the stored pin is kept as unverified', async () => {
  const core = new SharedCore(SAN_DIEGO_REVIEW_CITIES, { eventSchema: EventSchema });
  // Nominatim only knows the street; Census/Photon URLs get the same array
  // body, which their parsers read as "no match"; the reverse placemark for
  // the street centroid mismatches the input address.
  const adapter = buildReviewGeocodeAdapter([SD_FIFTH_AVENUE_STREET_RESULT], {
    reverseGeocodePlacemark: async () => SD_MISMATCH_PLACEMARK
  });
  const events = [buildSanDiegoReviewEvent()];

  const { findings } = await captureReview(core, events, createReviewContext(core, adapter));

  assert.equal(findings.length, 1);
  const finding = findings[0];
  assert.equal(finding.status, 'unverified');
  assert.deepEqual(finding.proposed, {}, 'a street-grade probe must NEVER back a pin-replacement proposal');
  assert.equal(finding.current.location, SD_STORED_PIN, 'the stored pin is untouched');
  assert.ok(finding.detail.includes('stored pin kept'), `detail must say the pin was kept: ${finding.detail}`);

  // Probes ignore any caller-supplied verification mode: report mode from the
  // caller must not resurrect the accept-and-flag pin as a proposal.
  const reportAdapter = buildReviewGeocodeAdapter([SD_FIFTH_AVENUE_STREET_RESULT], {
    reverseGeocodePlacemark: async () => SD_MISMATCH_PLACEMARK
  });
  const { findings: reportFindings } = await captureReview(core, [buildSanDiegoReviewEvent()],
    createReviewContext(core, reportAdapter, { geocodeVerification: { mode: 'report' } }));
  assert.equal(reportFindings[0].status, 'unverified');
  assert.deepEqual(reportFindings[0].proposed, {}, 'the reviewer always probes in enforce mode');
});

test('review: San Diego regression — a Census house-level match restores verified exact-grade proposals', async () => {
  const core = new SharedCore(SAN_DIEGO_REVIEW_CITIES, { eventSchema: EventSchema });
  const calls = [];
  const adapter = {
    calls,
    async fetchData(url) {
      calls.push(url);
      if (url.includes('geocoding.geo.census.gov')) return JSON.stringify(SD_CENSUS_MATCH);
      if (url.includes('nominatim')) return JSON.stringify([SD_FIFTH_AVENUE_STREET_RESULT]);
      return JSON.stringify([]);
    },
    reverseGeocodePlacemark: async () => SD_HOUSE_PLACEMARK
  };
  const events = [
    buildSanDiegoReviewEvent({ id: 'no-pin', location: '' }),
    // The garbage street-centroid pin the old reviewer would have written
    buildSanDiegoReviewEvent({ id: 'moved', location: '32.7150, -117.1590' })
  ];

  const { findings } = await captureReview(core, events, createReviewContext(core, adapter));
  const byId = new Map(findings.map(finding => [finding.id, finding]));

  assert.equal(byId.get('no-pin').status, 'missing-pin');
  assert.equal(byId.get('no-pin').proposed.location, '32.7481, -117.1609', 'the verified Census pin is proposed');
  assert.equal(byId.get('moved').status, 'pin-moved');
  assert.equal(byId.get('moved').proposed.location, '32.7481, -117.1609');
  assert.ok(calls.some(url => url.includes('geocoding.geo.census.gov')), 'the Census rescue rung must have run');
});

test('review: a hyphenated house number that only street-grades stays unverified — hand-verified pins survive', async () => {
  // "10-90 Wyckoff Avenue, Queens": the house-number regex cannot parse the
  // hyphenated Queens number, so enforce mode accepts the street-grade pin —
  // but the reviewer must still refuse to propose it over the stored pin.
  const core = new SharedCore({
    nyc: {
      timezone: 'America/New_York',
      calendar: 'chunky-dad-nyc',
      patterns: ['new york', 'nyc'],
      coordinates: { lat: 40.7128, lng: -74.006 }
    }
  }, { eventSchema: EventSchema });
  const adapter = buildReviewGeocodeAdapter([{
    lat: '40.7069000',
    lon: '-73.9216000',
    class: 'highway',
    type: 'residential',
    addresstype: 'road',
    display_name: 'Wyckoff Avenue, Queens, City of New York, New York, United States',
    address: { road: 'Wyckoff Avenue', city: 'City of New York' }
  }]);
  const events = [{
    id: 'wyckoff',
    calendarTitle: 'chunky-dad-nyc',
    title: 'QUEENS BEAR BASH',
    startDate: new Date('2026-08-08T02:00:00.000Z'),
    location: '40.7002, -73.9070', // hand-verified pin at the venue itself
    address: '10-90 Wyckoff Avenue, Queens',
    bar: ''
  }];

  const { findings } = await captureReview(core, events, createReviewContext(core, adapter));

  assert.equal(findings[0].status, 'unverified');
  assert.deepEqual(findings[0].proposed, {}, 'the street-grade pin must not replace the hand-verified pin');
  assert.equal(findings[0].current.location, '40.7002, -73.9070');
  assert.ok(findings[0].detail.includes('street-grade'), findings[0].detail);
});

// ---------------------------------------------------------------------------
// Bar-data authority + input-specificity + cross-check tightening (2026-07-16
// phone run: Apple's reverse geocoder was rate-limited for the WHOLE run, so
// every cross-check silently became 'skipped' — and "FURBALL CAMP" with the
// vague address "Poconos, PA" got a pin-moved proposal 33 km off from a
// Nominatim POI that graded 'exact'. The correct answer only exists in the
// curated bars config.)
// ---------------------------------------------------------------------------

const CAMP_OUT_BAR = {
  name: 'Camp Out',
  address: '446 MT NEBO RD, EAST STROUDSBURG, PA, 18301',
  coordinates: '41.0219799, -75.1167816'
};

function createPoconosCore(withBars = true) {
  return new SharedCore({
    poconos: { timezone: 'America/New_York', calendar: 'chunky-dad-poconos', patterns: ['poconos'] }
  }, {
    eventSchema: EventSchema,
    bars: withBars ? { poconos: [CAMP_OUT_BAR] } : {}
  });
}

function buildPoconosEvent(overrides = {}) {
  return {
    id: 'furball-camp',
    calendarTitle: 'chunky-dad-poconos',
    title: 'FURBALL CAMP',
    startDate: new Date('2026-08-15T00:00:00.000Z'),
    location: '41.0, -75.5', // ~32 km west of the real Camp Out pin
    address: 'Poconos, PA',
    bar: 'Camp Out',
    ...overrides
  };
}

function createPoconosContext(core, adapter, overrides = {}) {
  return createReviewContext(core, adapter, {
    barDataNormalizer: new BarDataNormalizer(core),
    ...overrides
  });
}

test('review: Poconos regression — curated bar data backs the proposal and no geocode fetch is spent', async () => {
  const core = createPoconosCore();
  const adapter = buildReviewGeocodeAdapter([]); // must never be consulted
  const events = [buildPoconosEvent()];

  const { findings, logLines } = await captureReview(core, events, createPoconosContext(core, adapter));

  assert.equal(findings.length, 1);
  const finding = findings[0];
  assert.equal(finding.status, 'pin-moved');
  assert.equal(finding.proposed.location, '41.0219799, -75.1167816', 'the curated Camp Out pin is proposed');
  assert.equal(finding.proposed.address, CAMP_OUT_BAR.address, 'one Apply fixes the pin AND the vague address');
  assert.ok(finding.detail.includes('Camp Out'), `detail must name the bar: ${finding.detail}`);
  assert.ok(finding.distanceKm > 30 && finding.distanceKm < 35, `distance carried, got ${finding.distanceKm}`);
  assert.equal(adapter.calls.length, 0, 'bar-matched events never reach the geocoders');
  assert.ok(logLines.includes('🔎 REVIEW: 1 event(s) matched curated bar data — skipping geocode for them'),
    `skip log missing, got: ${JSON.stringify(logLines)}`);
});

test('review: bar-data missing pin proposes the curated pin and address together', async () => {
  const core = createPoconosCore();
  const adapter = buildReviewGeocodeAdapter([]);
  const events = [buildPoconosEvent({ location: '' })];

  const { findings } = await captureReview(core, events, createPoconosContext(core, adapter));

  assert.equal(findings[0].status, 'missing-pin');
  assert.equal(findings[0].proposed.location, '41.0219799, -75.1167816');
  assert.equal(findings[0].proposed.address, CAMP_OUT_BAR.address);
  assert.equal(findings[0].detail, 'pin + address from curated bar data (Camp Out)');
  assert.equal(adapter.calls.length, 0);
});

test('review: bar-data within the threshold is ok with a bar-named detail', async () => {
  const core = createPoconosCore();
  const adapter = buildReviewGeocodeAdapter([]);
  const events = [buildPoconosEvent({ location: '41.0220, -75.1168' })]; // a few meters off

  const { findings } = await captureReview(core, events, createPoconosContext(core, adapter));

  assert.equal(findings[0].status, 'ok');
  assert.equal(findings[0].detail, 'matches curated bar data (Camp Out)');
  assert.deepEqual(findings[0].proposed, {}, 'ok findings carry no proposal');
  assert.equal(adapter.calls.length, 0);
});

// Without the bars config, "Poconos, PA" reaches Nominatim, which happily
// returns an exact-grading POI for it — the real 2026-07-16 failure mode.
const POCONOS_POI_RESULT = [{
  lat: '41.3000000',
  lon: '-75.3000000',
  class: 'tourism',
  type: 'attraction',
  addresstype: 'tourism',
  display_name: 'Some Attraction, Poconos, Pennsylvania, United States',
  address: { county: 'Poconos' }
}];

test('review: input-specificity gate — a vague address is unverified no matter what the geocoder returns', async () => {
  const core = createPoconosCore(false); // no bar match available
  const adapter = buildReviewGeocodeAdapter(POCONOS_POI_RESULT);
  const events = [
    buildPoconosEvent(),                  // stored pin present → would have been pin-moved
    buildPoconosEvent({ id: 'no-pin', location: '' }) // absent → would have been missing-pin
  ];

  const { findings } = await captureReview(core, events, createPoconosContext(core, adapter));
  const byId = new Map(findings.map(finding => [finding.id, finding]));

  for (const id of ['furball-camp', 'no-pin']) {
    assert.equal(byId.get(id).status, 'unverified', `${id} must be unverified`);
    assert.ok(byId.get(id).detail.includes('too vague'), byId.get(id).detail);
    assert.ok(byId.get(id).detail.includes('add a bar field'), byId.get(id).detail);
    assert.deepEqual(byId.get(id).proposed, {}, 'a vague input never backs a proposal');
  }
  assert.ok(adapter.calls.length > 0, 'the geocode path ran — the input gate refused its answer');
});

test('review: cross-check policy — replacing a stored pin needs a PASSED cross-check; additive pins tolerate skipped', async () => {
  const core = createCore();
  // No reverseGeocodePlacemark hook → every cross-check is 'skipped'
  // (exactly what an Apple rate-limit outage looks like).
  const skippedAdapter = buildReviewGeocodeAdapter();
  const { findings } = await captureReview(core, [
    buildReviewEvent({ id: 'moved', location: '32.8285, -96.8110709' }), // ~2 km off
    buildReviewEvent({ id: 'missing', location: '' })
  ], createReviewContext(core, skippedAdapter));
  const byId = new Map(findings.map(finding => [finding.id, finding]));

  assert.equal(byId.get('moved').status, 'unverified');
  assert.equal(byId.get('moved').detail, 'reverse cross-check unavailable — re-run when Apple geocoding recovers');
  assert.deepEqual(byId.get('moved').proposed, {}, 'a skipped cross-check never backs a destructive replacement');
  assert.equal(byId.get('missing').status, 'missing-pin', 'additive proposals stay allowed on skipped');
  assert.equal(byId.get('missing').proposed.location, '32.810535, -96.8110709');

  // A passing cross-check restores the destructive proposal.
  const passAdapter = buildReviewGeocodeAdapter(REVIEW_GEOCODE_RESULTS, {
    reverseGeocodePlacemark: async () => STATION_4_PLACEMARK
  });
  const { findings: passFindings } = await captureReview(core,
    [buildReviewEvent({ id: 'moved', location: '32.8285, -96.8110709' })],
    createReviewContext(core, passAdapter));
  assert.equal(passFindings[0].status, 'pin-moved');
  assert.equal(passFindings[0].proposed.location, '32.810535, -96.8110709');
});

test('review: on a platform that CAN cross-check, an Apple outage rejects candidates with the recover hint', async () => {
  const core = createCore();
  // supportsReverseGeocode() true + no placemark = Apple rate-limited/down on
  // the phone: enforce probes now reject the exact-grade candidate outright
  // (skipped ≠ pass), leaving a { grade: 'exact', crossCheck: 'skipped' }
  // breadcrumb the finding renders as "re-run when Apple geocoding recovers".
  const adapter = buildReviewGeocodeAdapter(REVIEW_GEOCODE_RESULTS, {
    reverseGeocodePlacemark: async () => null,
    supportsReverseGeocode: () => true
  });
  const { findings } = await captureReview(core, [
    buildReviewEvent({ id: 'moved', location: '32.8285, -96.8110709' }), // ~2 km off
    buildReviewEvent({ id: 'missing', location: '' })
  ], createReviewContext(core, adapter));
  const byId = new Map(findings.map(finding => [finding.id, finding]));

  for (const id of ['moved', 'missing']) {
    assert.equal(byId.get(id).status, 'unverified', `${id} must be unverified`);
    assert.ok(byId.get(id).detail.includes('re-run when Apple geocoding recovers'), byId.get(id).detail);
    assert.deepEqual(byId.get(id).proposed, {}, 'no proposal may ride on an unavailable cross-check');
  }
  assert.equal(byId.get('moved').current.location, '32.8285, -96.8110709', 'the stored pin is untouched');
});

test('normalizeUrl: scheme-less flyer hosts become https URLs; relative paths keep resolving', () => {
  const core = createCore();
  // OCR ticket URLs ("ADVANCED TIX AT WWW.MASSIVE.CLUB") previously failed the
  // crawl fetch as "unsupported URL" and were stored verbatim as ticketUrl.
  assert.equal(core.normalizeUrl('WWW.MASSIVE.CLUB', 'https://bearracuda.com/events/treasure-trail-seattle/'), 'https://www.massive.club');
  assert.equal(core.normalizeUrl('BEARRACUDA.COM', ''), 'https://bearracuda.com');
  assert.equal(core.normalizeUrl('www.example.com/tickets?ref=1', ''), 'https://www.example.com/tickets?ref=1');
  // Ambiguous candidates keep today's behavior: relative resolution against the page.
  assert.equal(core.normalizeUrl('events/foo', 'https://bearracuda.com/'), 'https://bearracuda.com/events/foo');
  assert.equal(core.normalizeUrl('index.html', 'https://bearracuda.com/'), 'https://bearracuda.com/index.html');
  // Real absolute URLs pass through untouched.
  assert.equal(core.normalizeUrl('https://massive.club/x', ''), 'https://massive.club/x');
});

test('adaptive crawl follows a scheme-less OCR ticketUrl as a fetchable https URL', () => {
  const core = createCore();
  const links = core.selectAdaptiveFollowLinks(
    'event-page',
    [],
    { events: [{ ticketUrl: 'WWW.MASSIVE.CLUB' }] },
    'https://bearracuda.com/events/treasure-trail-seattle/'
  );
  assert.deepEqual(links, ['https://www.massive.club']);
});

test('merge arbitration prompt: descriptive subtitles/editions win for title; status text still loses', async () => {
  const core = createCore();
  let capturedPrompt = '';
  const httpAdapter = {
    postJson: async (endpoint, payload) => {
      capturedPrompt = Array.isArray(payload.messages)
        ? payload.messages.map(m => m.content).join('\n')
        : String(payload.prompt || '');
      const content = JSON.stringify({
        choices: { title: { pick: 'calendar', value: 'Treasure Trail Seattle: Summer Sausage', reason: 'richer name' } }
      });
      return { ok: true, text: JSON.stringify({ choices: [{ message: { content } }] }) };
    }
  };
  const result = await core.arbitrateMergeConflicts({
    conflicts: [{ field: 'title', values: { calendar: 'Treasure Trail Seattle: Summer Sausage', scraped: 'Treasure Trail Seattle' } }],
    labels: ['calendar', 'scraped'],
    aiConfig: { enabled: true, provider: 'openai', endpoint: 'http://test.local/v1/chat/completions', model: 'test-model' },
    httpAdapter,
    eventContext: '"Treasure Trail Seattle" starting 2026-08-16T04:00:00.000Z'
  });
  // The rule set must say richer variants win (2026-07-21 run stripped
  // ": Summer Sausage" and "Horse Meat Disco" from calendar titles)...
  assert.match(capturedPrompt, /MORE DESCRIPTIVE/);
  assert.match(capturedPrompt, /subtitle, theme, edition, or anniversary/);
  // ...while status text / branding / bare-city guards stay in place.
  assert.match(capturedPrompt, /status text \(e\.g\. sold-out notices\) or site branding/);
  assert.match(capturedPrompt, /bare city name is not an event name/);
  assert.deepEqual(result, { title: { pick: 'calendar', reason: 'richer name' } });
});

// ---------------------------------------------------------------------------
// Enrich-only ticket crawl: pages reached via an event-page's follow links may
// only enrich the originating event, never spawn new (sibling) events.
// ---------------------------------------------------------------------------

const ENRICH_RULES = [
  { pattern: /promoter\.example\/e\//i, classification: 'event-page' },
  { pattern: /venue\.example/i, classification: 'multi-event-page' }
];

test('enrich-only crawl: ticket link to a venue calendar keeps the matching event and drops siblings', async () => {
  const core = new SharedCore(CITIES, {
    eventSchema: EventSchema,
    pageClassificationRules: ENRICH_RULES
  });
  const display = createDisplayAdapterStub();
  const partyDate = new Date(Date.now() + 7 * 86400000);
  const pages = {
    'https://promoter.example/e/bear-party': {
      events: [{ title: 'Bear Party', bar: 'Venue Club', startDate: partyDate, ticketUrl: 'https://venue.example/calendar' }]
    },
    'https://venue.example/calendar': {
      events: [
        { title: 'Bear Party', bar: 'Venue Club', startDate: partyDate },
        { title: 'HOSTILE NOISE', bar: 'Venue Club', startDate: new Date(partyDate.getTime() + 86400000) },
        { title: 'Twink Bash', bar: 'Venue Club', startDate: new Date(partyDate.getTime() + 2 * 86400000) }
      ],
      additionalLinks: ['https://venue.example/other-page']
    },
    'https://venue.example/other-page': {}
  };
  const { fetched, httpAdapter, parsers } = createCrawlHarness(pages);

  const result = await core.processParser(
    { name: 'Bear Promoter', urls: ['https://promoter.example/e/bear-party'], alwaysBear: true, ai: CRAWL_AI },
    {}, httpAdapter, display, parsers
  );

  // The ticket link is followed and the venue calendar parsed...
  assert.ok(fetched.includes('https://venue.example/calendar'), 'ticket link is still followed');
  // ...but only the identity-matching event survives; siblings are dropped.
  assert.equal(result.totalEvents, 2, 'parent event + matching child event; siblings never ingested');
  assert.equal(result.events.length, 1, 'matching child merges into the parent through the existing dedup');
  assert.equal(result.events[0].title, 'Bear Party');
  assert.ok(
    display.logs.includes('SYSTEM: Enrich-only crawl: kept 1 matching event(s), dropped 2 sibling event(s) from venue.example (reached via ticket link from "Bear Party")'),
    `expected enrich-only drop log, got: ${JSON.stringify(display.logs.filter(l => l.includes('Enrich-only')))}`
  );

  // Dropped siblings are collected for the discovered-venue suggestion block.
  assert.equal(result.enrichOnlyDrops.length, 1);
  assert.equal(result.enrichOnlyDrops[0].host, 'venue.example');
  assert.equal(result.enrichOnlyDrops[0].parentTitle, 'Bear Party');
  assert.deepEqual(result.enrichOnlyDrops[0].droppedEvents.map(e => e.title), ['HOSTILE NOISE', 'Twink Bash']);

  // No fan-out from enrich-only pages: the venue calendar's own links stay unfollowed.
  assert.ok(!fetched.includes('https://venue.example/other-page'), 'no links are followed from an enrich-only page');
  assert.ok(
    display.logs.includes('SYSTEM: Enrich-only crawl: not following 1 link(s) from https://venue.example/calendar'),
    `expected enrich-only no-follow log, got: ${JSON.stringify(display.logs.filter(l => l.includes('Enrich-only')))}`
  );
});

test('enrich-only crawl: aggregator and multi-event-page crawls still ingest every event', async () => {
  const core = new SharedCore(CITIES, {
    eventSchema: EventSchema,
    pageClassificationRules: [
      { pattern: /venuehub\.example\/$/i, classification: 'multi-event-page' },
      { pattern: /venuehub\.example\/events\//i, classification: 'event-page' }
    ]
  });
  const display = createDisplayAdapterStub();
  const day = new Date(Date.now() + 7 * 86400000);
  const pages = {
    'https://venuehub.example/': {
      events: [
        { title: 'Bear Tea Dance', bar: 'Hub Hall', startDate: day },
        { title: 'Drag Brunch', bar: 'Hub Hall', startDate: new Date(day.getTime() + 86400000) }
      ],
      additionalLinks: ['https://venuehub.example/events/underwear-night', 'https://venuehub.example/events/leather-social']
    },
    'https://venuehub.example/events/underwear-night': {
      events: [{ title: 'Underwear Night', bar: 'Hub Hall', startDate: new Date(day.getTime() + 2 * 86400000) }]
    },
    'https://venuehub.example/events/leather-social': {
      events: [{ title: 'Leather Social', bar: 'Hub Hall', startDate: new Date(day.getTime() + 3 * 86400000) }]
    }
  };
  const { fetched, httpAdapter, parsers } = createCrawlHarness(pages);

  const result = await core.processParser(
    { name: 'Venue Hub', urls: ['https://venuehub.example/'], alwaysBear: true, ai: CRAWL_AI },
    {}, httpAdapter, display, parsers
  );

  assert.equal(fetched.length, 3, 'multi-event-page links are all followed');
  assert.equal(result.totalEvents, 4, 'every event from the multi-event page AND its detail pages is ingested');
  assert.equal(result.enrichOnlyDrops, undefined, 'nothing was dropped');
  assert.ok(!display.logs.some(l => l.includes('Enrich-only')), 'no enrich-only logs on aggregator/multi-event crawls');
});

test('bear-check provenance: same-host keeps legacy wording exactly; cross-host gets honest wording', async () => {
  // Same host (configured promoter.example, page on www.promoter.example)
  const sameHostAdapter = buildBearVerdictAdapter({ verdict: 'bear', reason: 'promoter party' });
  await createCore().filterBearEvents(
    [{ title: 'HOT TAKE', url: 'https://promoter.example/events/hot-take', _sourcePageUrl: 'https://www.promoter.example/events/hot-take' }],
    bearCheckConfig('enforce'),
    sameHostAdapter
  );
  assert.match(
    sameHostAdapter.calls[0].prompt,
    /- Provenance: Scraped from promoter\.example, source entry "Test Promoter"\./,
    'same-host events keep the legacy provenance wording byte-for-byte'
  );

  // No _sourcePageUrl at all → legacy wording (existing behavior untouched)
  const legacyAdapter = buildBearVerdictAdapter({ verdict: 'bear', reason: 'promoter party' });
  await createCore().filterBearEvents([{ title: 'HOT TAKE' }], bearCheckConfig('enforce'), legacyAdapter);
  assert.match(legacyAdapter.calls[0].prompt, /- Provenance: Scraped from promoter\.example, source entry "Test Promoter"\./);

  // Cross host (page on www.massive.club, configured promoter.example)
  const crossAdapter = buildBearVerdictAdapter({ verdict: 'not_bear', reason: 'punk show' });
  await createCore().filterBearEvents(
    [{ title: 'HOSTILE NOISE', _sourcePageUrl: 'https://www.massive.club/calendar' }],
    bearCheckConfig('enforce'),
    crossAdapter
  );
  const crossPrompt = crossAdapter.calls[0].prompt;
  assert.match(crossPrompt, /- Provenance: extracted from www\.massive\.club, a page discovered while crawling source entry "Test Promoter" \(promoter\.example\)\./);
  assert.match(crossPrompt, /The source entry's promoter did NOT necessarily produce this event — judge by the event content and the hosting site\./);
  assert.ok(!crossPrompt.includes('Scraped from'), 'cross-host events never claim to be scraped from the source entry');

  // Cross host + alwaysBear: trust is scoped to the promoter's own events
  const trustedCrossAdapter = buildBearVerdictAdapter({ verdict: 'not_bear', reason: 'punk show' });
  await createCore().filterBearEvents(
    [{ title: 'HOSTILE NOISE', _sourcePageUrl: 'https://www.massive.club/calendar' }],
    bearCheckConfig('enforce', { alwaysBear: true }),
    trustedCrossAdapter
  );
  assert.match(trustedCrossAdapter.calls[0].prompt, /trust only covers that promoter's own events/);
  assert.ok(!trustedCrossAdapter.calls[0].prompt.includes('has marked this promoter as a trusted bear-scene promoter'),
    'the unscoped trusted-promoter sentence never appears for cross-host events');
});

test('discovered-venue summary block renders only when siblings were dropped', () => {
  const core = createCore();

  // No drops → no block
  assert.equal(core.buildDiscoveredVenueSummaryText(core.buildDiscoveredVenueCalendars([])), '');
  assert.equal(core.buildDiscoveredVenueSummaryText(core.buildDiscoveredVenueCalendars([{ name: 'X' }])), '');

  const parserResults = [{
    name: 'Bearracuda Events',
    enrichOnlyDrops: [{
      host: 'www.massive.club',
      url: 'https://www.massive.club/calendar',
      parentTitle: 'BEARRACUDA: LA',
      parentUrl: 'https://bearracuda.com/events/la',
      keptCount: 1,
      droppedEvents: [
        { title: 'Butt Blast', startDate: new Date('2026-07-23T15:00:00.000Z') },
        { title: 'Twink Bash: Birthday Suit', startDate: new Date('2026-08-01T15:00:00.000Z') }
      ]
    }]
  }];
  const venues = core.buildDiscoveredVenueCalendars(parserResults);
  assert.equal(venues.length, 1);
  assert.equal(venues[0].droppedCount, 2);

  const text = core.buildDiscoveredVenueSummaryText(venues);
  assert.ok(text.includes('📋 DISCOVERED VENUE CALENDAR: www.massive.club'));
  assert.ok(text.includes('2 event(s) found but not ingested (enrich-only ticket crawl)'));
  assert.ok(text.includes('Titles: Butt Blast (Jul 23), Twink Bash: Birthday Suit (Aug 1)'));
  assert.ok(text.includes('To scrape this venue, add a parser entry to scraper-input.js:'));
  assert.ok(text.includes('{ name: "massive.club", enabled: false, urls: ["https://www.massive.club"], alwaysBear: false },'));
});

// ---------------------------------------------------------------------------
// __wireConsoleTee: on Scriptable every imported module has its own console
// binding, so the orchestrator wires the adapter's run-log tee into each
// module through this helper. In Node the module console IS the shared global
// console (which test-quiet-console also wraps), so every test here restores
// in a finally block.
// ---------------------------------------------------------------------------
const sharedCoreModule = require('./shared-core');
const normalizersModule = require('./normalizers');

function snapshotConsole() {
  return {
    log: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  };
}

function restoreConsole(saved) {
  console.log = saved.log;
  console.warn = saved.warn;
  console.error = saved.error;
  console.debug = saved.debug;
  delete console.__consoleTeeRestore;
}

test('__wireConsoleTee tees info/warn/error with echo preserved and debug without echo', () => {
  const saved = snapshotConsole();
  const teed = [];
  const echoed = [];
  console.log = (...args) => echoed.push(['log', args]);
  console.warn = (...args) => echoed.push(['warn', args]);
  console.error = (...args) => echoed.push(['error', args]);
  console.debug = (...args) => echoed.push(['debug', args]);
  try {
    const restore = sharedCoreModule.__wireConsoleTee((level, args) => teed.push([level, args]));
    assert.equal(typeof restore, 'function');

    console.log('🐻 line', 1);
    console.warn('careful');
    console.error('broken');
    console.debug('full AI payload');

    assert.deepEqual(teed, [
      ['info', ['🐻 line', 1]],
      ['warn', ['careful']],
      ['error', ['broken']],
      ['debug', ['full AI payload']]
    ]);
    // log/warn/error still reach the original console; debug is file-only
    // (the documented debug channel: payloads go to the run log, not screen).
    assert.deepEqual(echoed, [
      ['log', ['🐻 line', 1]],
      ['warn', ['careful']],
      ['error', ['broken']]
    ]);
  } finally {
    restoreConsole(saved);
  }
});

test('__wireConsoleTee is idempotent: double-wire (even cross-module) does not double-tee', () => {
  const saved = snapshotConsole();
  const teed = [];
  console.log = () => {};
  try {
    const tee = (level, args) => teed.push([level, args]);
    const restore1 = sharedCoreModule.__wireConsoleTee(tee);
    const restore2 = sharedCoreModule.__wireConsoleTee(tee);
    // In Node all modules share the global console, so a second module's shim
    // must also detect the existing wiring instead of stacking another tee.
    const restore3 = normalizersModule.__wireConsoleTee(tee);
    assert.equal(restore1, restore2);
    assert.equal(restore1, restore3);

    console.log('once');
    assert.equal(teed.length, 1);
  } finally {
    restoreConsole(saved);
  }
});

test('__wireConsoleTee restore() returns console to the exact original functions', () => {
  const saved = snapshotConsole();
  const spyLog = () => {};
  const spyWarn = () => {};
  const spyError = () => {};
  const spyDebug = () => {};
  console.log = spyLog;
  console.warn = spyWarn;
  console.error = spyError;
  console.debug = spyDebug;
  try {
    const restore = sharedCoreModule.__wireConsoleTee(() => {});
    assert.notEqual(console.log, spyLog, 'wiring replaced console.log');
    assert.notEqual(console.debug, spyDebug, 'wiring replaced console.debug');

    restore();
    assert.equal(console.log, spyLog);
    assert.equal(console.warn, spyWarn);
    assert.equal(console.error, spyError);
    assert.equal(console.debug, spyDebug);

    // After restore the console is re-wireable (marker cleared).
    const restoreAgain = sharedCoreModule.__wireConsoleTee(() => {});
    assert.equal(typeof restoreAgain, 'function');
    restoreAgain();
    assert.equal(console.log, spyLog);
  } finally {
    restoreConsole(saved);
  }
});

test('__wireConsoleTee no-ops (returns null) when tee is not a function', () => {
  const saved = snapshotConsole();
  try {
    assert.equal(sharedCoreModule.__wireConsoleTee(null), null);
    assert.equal(sharedCoreModule.__wireConsoleTee(undefined), null);
    assert.equal(sharedCoreModule.__wireConsoleTee('not a tee'), null);
    assert.equal(console.log, saved.log, 'console left untouched');
    assert.equal(console.debug, saved.debug, 'console left untouched');
  } finally {
    restoreConsole(saved);
  }
});

test('__wireConsoleTee keeps working when a tee throws (logging never breaks the app)', () => {
  const saved = snapshotConsole();
  const echoed = [];
  console.log = (...args) => echoed.push(args);
  try {
    sharedCoreModule.__wireConsoleTee(() => {
      throw new Error('sink failure');
    });
    assert.doesNotThrow(() => console.log('still logs'));
    assert.deepEqual(echoed, [['still logs']], 'echo survives a throwing tee');
  } finally {
    restoreConsole(saved);
  }
});

// ---------------------------------------------------------------------------
// Bar corroboration demotion rung (phase 2): a bar stamped `uncorroborated`
// at extraction (address in source, bar NOT near it) loses deterministically
// to a corroborated bar (page-adjacent/venue-site/curated stamp, or a curated
// bars match) — and an uncorroborated SCRAPED bar never clobbers ANY calendar
// bar, stamped or not. Attribution is strict like the image provenance rung;
// stamps missing keeps today's behavior byte-identical.
// ---------------------------------------------------------------------------

test('guardrail: corroborated bar beats uncorroborated in both directions; ambiguity falls through', () => {
  const core = createCore();
  const context = (recordA, recordB, sideLabels = { a: 'existing', b: 'incoming' }) => ({
    sideLabels,
    records: { a: recordA, b: recordB }
  });

  // page-adjacent beats uncorroborated in both directions
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'MASSIVE', 'Shore Thing',
      context({ bar: 'MASSIVE', barSource: 'page-adjacent' }, { bar: 'Shore Thing', barSource: 'uncorroborated' })),
    { winner: 'a', reason: 'corroborated bar beats uncorroborated' });
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'Shore Thing', 'MASSIVE',
      context({ bar: 'Shore Thing', barSource: 'uncorroborated' }, { bar: 'MASSIVE', barSource: 'page-adjacent' })),
    { winner: 'b', reason: 'corroborated bar beats uncorroborated' });

  // venue-site and curated stamps are corroborated too
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'MASSIVE', 'Shore Thing',
      context({ bar: 'MASSIVE', barSource: 'venue-site' }, { bar: 'Shore Thing', barSource: 'uncorroborated' })),
    { winner: 'a', reason: 'corroborated bar beats uncorroborated' });
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'MASSIVE', 'Shore Thing',
      context({ bar: 'MASSIVE', barSource: 'curated' }, { bar: 'Shore Thing', barSource: 'uncorroborated' })),
    { winner: 'a', reason: 'corroborated bar beats uncorroborated' });

  // Both uncorroborated → genuine question, arbitrate as today
  assert.equal(
    core.resolveConflictDeterministically('bar', 'MASSIVE', 'Shore Thing',
      context({ bar: 'MASSIVE', barSource: 'uncorroborated' }, { bar: 'Shore Thing', barSource: 'uncorroborated' })),
    null);

  // Enrich flow (two scraped records): uncorroborated vs UNSTAMPED falls
  // through — the calendar doctrine applies to the calendar flow only
  assert.equal(
    core.resolveConflictDeterministically('bar', 'MASSIVE', 'Shore Thing',
      context({ bar: 'MASSIVE' }, { bar: 'Shore Thing', barSource: 'uncorroborated' })),
    null);

  // Calendar flow: an unstamped (legacy) calendar bar still beats an
  // uncorroborated scraped bar — calendar records are curated-by-usage
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'MASSIVE', 'Shore Thing',
      context({ bar: 'MASSIVE' }, { bar: 'Shore Thing', barSource: 'uncorroborated' },
        { a: 'calendar', b: 'scraped' })),
    { winner: 'a', reason: 'corroborated bar beats uncorroborated' });
  // ...but an uncorroborated CALENDAR bar vs unstamped scraped is not decided here
  assert.equal(
    core.resolveConflictDeterministically('bar', 'Shore Thing', 'MASSIVE',
      context({ bar: 'Shore Thing', barSource: 'uncorroborated' }, { bar: 'MASSIVE' },
        { a: 'calendar', b: 'scraped' })),
    null);

  // Attribution caution: a stamp only speaks for the record's OWN bar value
  assert.equal(
    core.resolveConflictDeterministically('bar', 'MASSIVE', 'Shore Thing',
      context({ bar: 'Neighbours', barSource: 'page-adjacent' }, { bar: 'Shore Thing', barSource: 'uncorroborated' })),
    null, 'a stray stamp on a different bar value decides nothing');

  // Stamps missing entirely (or no records context) → byte-identical today
  assert.equal(
    core.resolveConflictDeterministically('bar', 'MASSIVE', 'Shore Thing',
      context({ bar: 'MASSIVE' }, { bar: 'Shore Thing' })),
    null);
  assert.equal(core.resolveConflictDeterministically('bar', 'MASSIVE', 'Shore Thing'), null);
});

test('guardrail: case-only bar twins resolve to the less-uppercased form regardless of barSource stamps', () => {
  const core = createCore();
  const context = (recordA, recordB, sideLabels = { a: 'existing', b: 'incoming' }) => ({
    sideLabels,
    records: { a: recordA, b: recordB }
  });
  const CASE_RULE_B = { winner: 'b', reason: 'case-only variants — kept less-uppercased form' };
  const CASE_RULE_A = { winner: 'a', reason: 'case-only variants — kept less-uppercased form' };

  // Matching stamps: both uncorroborated — the demotion rung falls through
  // and the case-only rule decides (regression lock)
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'AQUA EMPORIO', 'Aqua Emporio',
      context({ bar: 'AQUA EMPORIO', barSource: 'uncorroborated' }, { bar: 'Aqua Emporio', barSource: 'uncorroborated' })),
    CASE_RULE_B);
  // Matching stamps: both page-adjacent (enrich flow)
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'AQUA EMPORIO', 'Aqua Emporio',
      context({ bar: 'AQUA EMPORIO', barSource: 'page-adjacent' }, { bar: 'Aqua Emporio', barSource: 'page-adjacent' })),
    CASE_RULE_B);

  // DIFFERING stamps on case twins must never crown the shoutier twin via
  // the demotion rung — twins are the SAME venue, provenance decides nothing
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'AQUA EMPORIO', 'Aqua Emporio',
      context({ bar: 'AQUA EMPORIO', barSource: 'page-adjacent' }, { bar: 'Aqua Emporio', barSource: 'uncorroborated' })),
    CASE_RULE_B, 'a corroborated caps twin must not beat the uncorroborated mixed-case twin');
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'Aqua Emporio', 'AQUA EMPORIO',
      context({ bar: 'Aqua Emporio', barSource: 'uncorroborated' }, { bar: 'AQUA EMPORIO', barSource: 'page-adjacent' })),
    CASE_RULE_A, 'the less-uppercased side wins whichever side it sits on');

  // Calendar flow: an unstamped caps calendar bar vs an uncorroborated
  // mixed-case scrape is a case twin — the calendar-doctrine branch of the
  // demotion rung must not re-cement the shouty calendar form
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'AQUA EMPORIO', 'Aqua Emporio',
      context({ bar: 'AQUA EMPORIO' }, { bar: 'Aqua Emporio', barSource: 'uncorroborated' },
        { a: 'calendar', b: 'scraped' })),
    CASE_RULE_B);

  // Genuinely different bars keep the demotion rung untouched
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'MASSIVE', 'Shore Thing',
      context({ bar: 'MASSIVE', barSource: 'page-adjacent' }, { bar: 'Shore Thing', barSource: 'uncorroborated' })),
    { winner: 'a', reason: 'corroborated bar beats uncorroborated' });
});

test('barSource is never arbitration-eligible and round-trips through notes like imageSource', () => {
  const core = createCore();
  assert.equal(core.isArbitrationEligibleField('barSource'), false);
  assert.equal(core.isArbitrationEligibleField('bar'), true, 'the bar VALUE itself still arbitrates');

  const notes = core.formatEventNotes({ bar: 'MASSIVE', barSource: 'page-adjacent' });
  assert.match(notes, /barSource: page-adjacent/);
  const parsed = core.parseNotesIntoFields(notes);
  assert.equal(parsed.bar, 'MASSIVE');
  assert.equal(parsed.barSource, 'page-adjacent');
});

test('incident phase 2 (enrich flow): corroborated bar beats uncorroborated in both directions — zero AI calls, stamp follows the winner', async () => {
  const core = createCore();
  const priorities = { bar: { priority: ['ai-web'], merge: 'ai' } };
  const aiParserConfig = { ai: { provider: 'ollama', endpoint: 'http://ai.example', model: 'm' } };
  const base = { title: 'BEARRACUDA SEATTLE', city: 'seattle', source: 'ai-web', _fieldPriorities: priorities };

  const adapterA = buildArbitrationAdapter({});
  const logLinesA = [];
  const originalLog = console.log;
  console.log = (message) => { logLinesA.push(String(message)); };
  let mergedA;
  try {
    mergedA = await core.mergeParsedEvents(
      { ...base, bar: 'MASSIVE', barSource: 'page-adjacent' },
      { ...base, bar: 'Shore Thing', barSource: 'uncorroborated', _parserConfig: aiParserConfig },
      { httpAdapter: adapterA });
  } finally {
    console.log = originalLog;
  }
  assert.equal(adapterA.calls.length, 0, 'corroboration settles the bar without AI');
  assert.equal(mergedA.bar, 'MASSIVE');
  assert.equal(mergedA.barSource, 'page-adjacent', 'barSource follows the winning bar');
  assert.ok(logLinesA.includes(
    '🔒 MERGE: "BEARRACUDA SEATTLE" field=bar resolved deterministically — corroborated bar beats uncorroborated'
  ), `stable 🔒 log line expected, got: ${JSON.stringify(logLinesA)}`);

  const adapterB = buildArbitrationAdapter({});
  const mergedB = await core.mergeParsedEvents(
    { ...base, bar: 'Shore Thing', barSource: 'uncorroborated' },
    { ...base, bar: 'MASSIVE', barSource: 'page-adjacent', _parserConfig: aiParserConfig },
    { httpAdapter: adapterB });
  assert.equal(adapterB.calls.length, 0);
  assert.equal(mergedB.bar, 'MASSIVE');
  assert.equal(mergedB.barSource, 'page-adjacent',
    'the incoming base-spread stamp is replaced by the winning side\'s');

  // Both uncorroborated → the AI is consulted exactly as today
  const adapterC = buildArbitrationAdapter({
    bar: { pick: 'existing', value: 'MASSIVE', reason: 'venue' }
  });
  const mergedC = await core.mergeParsedEvents(
    { ...base, bar: 'MASSIVE', barSource: 'uncorroborated' },
    { ...base, bar: 'Shore Thing', barSource: 'uncorroborated', _parserConfig: aiParserConfig },
    { httpAdapter: adapterC });
  assert.equal(adapterC.calls.length, 1, 'both-uncorroborated is a genuine question');
  assert.equal(mergedC.bar, 'MASSIVE');
});

test('incident phase 2 (calendar flow): uncorroborated scraped bar never clobbers the calendar bar — stamped or legacy-unstamped', async () => {
  const core = createCore();

  // Calendar stamped page-adjacent (from a previous run's notes round-trip)
  const stamped = buildAlignedArbitrationPair();
  stamped.scraped.bar = 'Shore Thing';
  stamped.scraped.barSource = 'uncorroborated';
  stamped.existing.notes = stamped.existing.notes.replace('bar: S4', 'bar: MASSIVE\nbarSource: page-adjacent');
  const adapterA = buildArbitrationAdapter({});
  const finalA = await core.createFinalEventObject(stamped.existing, stamped.scraped, { httpAdapter: adapterA });
  assert.equal(adapterA.calls.length, 0, 'no AI request at all');
  assert.equal(finalA.bar, 'MASSIVE');
  assert.equal(finalA.barSource, 'page-adjacent', 'the notes-parsed calendar stamp participates and survives');
  assert.deepEqual(finalA._original.aiArbitration.deterministic, ['bar']);
  const parsedNotesA = core.parseNotesIntoFields(finalA.notes);
  assert.equal(parsedNotesA.bar, 'MASSIVE');
  assert.equal(parsedNotesA.barSource, 'page-adjacent', 'the stamp persists to notes for the next run');

  // Legacy calendar record with NO stamp still wins (curated-by-usage)
  const legacy = buildAlignedArbitrationPair();
  legacy.scraped.bar = 'Shore Thing';
  legacy.scraped.barSource = 'uncorroborated';
  legacy.existing.notes = legacy.existing.notes.replace('bar: S4', 'bar: MASSIVE');
  const adapterB = buildArbitrationAdapter({});
  const finalB = await core.createFinalEventObject(legacy.existing, legacy.scraped, { httpAdapter: adapterB });
  assert.equal(adapterB.calls.length, 0, 'the demotion doctrine needs no AI');
  assert.equal(finalB.bar, 'MASSIVE');
  assert.equal(finalB.barSource, undefined, 'an unstamped winner never inherits the loser\'s stamp');
  assert.deepEqual(finalB._original.aiArbitration.deterministic, ['bar']);

  // Reverse: a corroborated SCRAPED bar beats an uncorroborated calendar bar
  const reversed = buildAlignedArbitrationPair();
  reversed.scraped.bar = 'MASSIVE';
  reversed.scraped.barSource = 'page-adjacent';
  reversed.existing.notes = reversed.existing.notes.replace('bar: S4', 'bar: Shore Thing\nbarSource: uncorroborated');
  const adapterC = buildArbitrationAdapter({});
  const finalC = await core.createFinalEventObject(reversed.existing, reversed.scraped, { httpAdapter: adapterC });
  assert.equal(adapterC.calls.length, 0);
  assert.equal(finalC.bar, 'MASSIVE', 'the corroborated scraped bar wins');
  assert.equal(finalC.barSource, 'page-adjacent');

  // Both uncorroborated → AI arbitration exactly as today
  const contested = buildAlignedArbitrationPair();
  contested.scraped.bar = 'Shore Thing';
  contested.scraped.barSource = 'uncorroborated';
  contested.existing.notes = contested.existing.notes.replace('bar: S4', 'bar: MASSIVE\nbarSource: uncorroborated');
  const adapterD = buildArbitrationAdapter({
    bar: { pick: 'calendar', value: 'MASSIVE', reason: 'venue' }
  });
  const finalD = await core.createFinalEventObject(contested.existing, contested.scraped, { httpAdapter: adapterD });
  assert.equal(adapterD.calls.length, 1, 'both-uncorroborated still reaches the AI');
  assert.equal(finalD.bar, 'MASSIVE');
});

// ---------------------------------------------------------------------------
// Bar corroboration phase 3: `geo-poi` (a reverse/forward-geocode POI name
// matched the bar) counts as corroborated in the demotion rung — same tier
// as page-adjacent/venue-site/curated, both merge flows, zero AI calls.
// ---------------------------------------------------------------------------

test('phase 3: geo-poi counts as corroborated in the demotion rung', () => {
  const core = createCore();
  const context = (recordA, recordB, sideLabels = { a: 'existing', b: 'incoming' }) => ({
    sideLabels,
    records: { a: recordA, b: recordB }
  });

  // geo-poi beats uncorroborated in both directions
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'MASSIVE', 'Shore Thing',
      context({ bar: 'MASSIVE', barSource: 'geo-poi' }, { bar: 'Shore Thing', barSource: 'uncorroborated' })),
    { winner: 'a', reason: 'corroborated bar beats uncorroborated' });
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'Shore Thing', 'MASSIVE',
      context({ bar: 'Shore Thing', barSource: 'uncorroborated' }, { bar: 'MASSIVE', barSource: 'geo-poi' })),
    { winner: 'b', reason: 'corroborated bar beats uncorroborated' });

  // geo-poi vs a corroborated stamp is NOT a demotion case — falls through
  assert.equal(
    core.resolveConflictDeterministically('bar', 'MASSIVE', 'Shore Thing',
      context({ bar: 'MASSIVE', barSource: 'geo-poi' }, { bar: 'Shore Thing', barSource: 'page-adjacent' })),
    null, 'two corroborated bars stay a genuine question');
});

test('phase 3 (enrich flow): a geo-poi bar beats an uncorroborated bar with zero AI calls; stamp follows the winner', async () => {
  const core = createCore();
  const priorities = { bar: { priority: ['ai-web'], merge: 'ai' } };
  const aiParserConfig = { ai: { provider: 'ollama', endpoint: 'http://ai.example', model: 'm' } };
  const base = { title: 'BEARRACUDA SEATTLE', city: 'seattle', source: 'ai-web', _fieldPriorities: priorities };

  const adapter = buildArbitrationAdapter({});
  const merged = await core.mergeParsedEvents(
    { ...base, bar: 'MASSIVE', barSource: 'geo-poi' },
    { ...base, bar: 'Shore Thing', barSource: 'uncorroborated', _parserConfig: aiParserConfig },
    { httpAdapter: adapter });
  assert.equal(adapter.calls.length, 0, 'geo-poi corroboration settles the bar without AI (zero postJson)');
  assert.equal(merged.bar, 'MASSIVE');
  assert.equal(merged.barSource, 'geo-poi', 'the geo-poi stamp follows the winning bar');

  const adapterReversed = buildArbitrationAdapter({});
  const mergedReversed = await core.mergeParsedEvents(
    { ...base, bar: 'Shore Thing', barSource: 'uncorroborated' },
    { ...base, bar: 'MASSIVE', barSource: 'geo-poi', _parserConfig: aiParserConfig },
    { httpAdapter: adapterReversed });
  assert.equal(adapterReversed.calls.length, 0);
  assert.equal(mergedReversed.bar, 'MASSIVE');
  assert.equal(mergedReversed.barSource, 'geo-poi');
});

test('phase 3 (calendar flow): a geo-poi scraped bar beats an uncorroborated calendar bar with zero AI calls', async () => {
  const core = createCore();
  const pair = buildAlignedArbitrationPair();
  pair.scraped.bar = 'MASSIVE';
  pair.scraped.barSource = 'geo-poi';
  pair.existing.notes = pair.existing.notes.replace('bar: S4', 'bar: Shore Thing\nbarSource: uncorroborated');
  const adapter = buildArbitrationAdapter({});
  const final = await core.createFinalEventObject(pair.existing, pair.scraped, { httpAdapter: adapter });
  assert.equal(adapter.calls.length, 0, 'zero postJson');
  assert.equal(final.bar, 'MASSIVE', 'the map-corroborated scraped bar wins');
  assert.equal(final.barSource, 'geo-poi');
  assert.deepEqual(final._original.aiArbitration.deterministic, ['bar']);
  const parsedNotes = core.parseNotesIntoFields(final.notes);
  assert.equal(parsedNotes.barSource, 'geo-poi', 'the stamp persists to notes for the next run');

  // And an uncorroborated scraped bar still loses to a geo-poi calendar bar
  const reversed = buildAlignedArbitrationPair();
  reversed.scraped.bar = 'Shore Thing';
  reversed.scraped.barSource = 'uncorroborated';
  reversed.existing.notes = reversed.existing.notes.replace('bar: S4', 'bar: MASSIVE\nbarSource: geo-poi');
  const adapterB = buildArbitrationAdapter({});
  const finalB = await core.createFinalEventObject(reversed.existing, reversed.scraped, { httpAdapter: adapterB });
  assert.equal(adapterB.calls.length, 0);
  assert.equal(finalB.bar, 'MASSIVE');
  assert.equal(finalB.barSource, 'geo-poi', 'the notes-parsed geo-poi stamp participates and survives');
});

// ---------------------------------------------------------------------------
// Provenance companion fields: canonical list + trust-tier ranking
// (provenance-aware merge verification — upgrades are good news)
// ---------------------------------------------------------------------------

test('PROVENANCE_COMPANION_FIELDS is exported and matches the arbitration-exclusion set', () => {
  const { PROVENANCE_COMPANION_FIELDS } = require('./shared-core');
  assert.deepEqual(
    [...PROVENANCE_COMPANION_FIELDS].sort(),
    ['addressSource', 'barSource', 'bearSource', 'imageSource', 'pinSource']
  );
  assert.equal(PROVENANCE_COMPANION_FIELDS, SharedCore.PROVENANCE_COMPANION_FIELDS,
    'named export and the SharedCore static are the SAME canonical list');
  assert.ok(Object.isFrozen(PROVENANCE_COMPANION_FIELDS));

  const core = createCore();
  for (const field of PROVENANCE_COMPANION_FIELDS) {
    assert.equal(SharedCore.isProvenanceCompanionField(field), true);
    assert.equal(core.isArbitrationEligibleField(field), false,
      `${field} must stay excluded from AI arbitration`);
  }
  // The list is exactly the companion stamps — value fields and the other
  // non-arbitrable fields are NOT provenance companions.
  for (const field of ['location', 'image', 'bar', 'address', 'key', 'notes', 'source', 'gmaps']) {
    assert.equal(SharedCore.isProvenanceCompanionField(field), false);
  }
  // The rewrite kept the non-provenance exclusions byte-for-byte.
  for (const field of ['key', 'notes', 'source', 'location', 'gmaps']) {
    assert.equal(core.isArbitrationEligibleField(field), false);
  }
  assert.equal(core.isArbitrationEligibleField('bar'), true);
});

test('pinSource trust tiers: curated > geocoded-exact > geocoded-approx > page > unstamped', () => {
  const tier = (value) => SharedCore.getProvenanceTrustTier('pinSource', value);
  assert.ok(tier('curated') > tier('geocoded-exact'));
  assert.ok(tier('geocoded-exact') > tier('geocoded-approx'));
  assert.ok(tier('geocoded-approx') > tier('page'));
  assert.ok(tier('page') > tier(undefined), 'unstamped is the floor');
  assert.equal(tier(''), 0);
  assert.equal(tier(null), 0);
});

test('addressSource trust tiers: curated > page > inferred', () => {
  const tier = (value) => SharedCore.getProvenanceTrustTier('addressSource', value);
  assert.ok(tier('curated') > tier('page'));
  assert.ok(tier('page') > tier('inferred'));
  assert.ok(tier('inferred') > tier(undefined));
});

test('addressSource trust tier: venue-site ranks with page, below curated (curated machinery outranks the consensus fill)', () => {
  const tier = (value) => SharedCore.getProvenanceTrustTier('addressSource', value);
  assert.equal(tier('venue-site'), tier('page'));
  assert.ok(tier('curated') > tier('venue-site'));
  assert.ok(tier('venue-site') > tier('inferred'));
});

test('barSource trust tiers: curated > corroborated class (venue-site/page-adjacent/geo-poi) > uncorroborated > unstamped', () => {
  const tier = (value) => SharedCore.getProvenanceTrustTier('barSource', value);
  assert.ok(tier('curated') > tier('venue-site'));
  // The three corroborated stamps share a tier, matching isCorroboratedStamp's
  // one-class treatment — moves among them are never downgrades.
  assert.equal(tier('venue-site'), tier('page-adjacent'));
  assert.equal(tier('page-adjacent'), tier('geo-poi'));
  assert.ok(tier('geo-poi') > tier('uncorroborated'));
  assert.ok(tier('uncorroborated') > tier(undefined));
});

test('imageSource trust tiers: og-image and jsonld share the meta-artwork tier above page', () => {
  const tier = (value) => SharedCore.getProvenanceTrustTier('imageSource', value);
  assert.equal(tier('og-image'), tier('jsonld'));
  assert.ok(tier('og-image') > tier('page'));
  assert.ok(tier('page') > tier(undefined));
});

test('bearSource trust tiers: manual-* always outranks automatic (keyword/ai/config)', () => {
  const tier = (value) => SharedCore.getProvenanceTrustTier('bearSource', value);
  for (const automatic of ['keyword', 'ai', 'config']) {
    assert.ok(tier('manual-bear') > tier(automatic), `manual-bear > ${automatic}`);
    assert.ok(tier('manual-not-bear') > tier(automatic), `manual-not-bear > ${automatic}`);
  }
  assert.equal(tier('keyword'), tier('ai'));
  assert.equal(tier('ai'), tier('config'));
});

test('suffixed provenance values rank by their prefix at a word boundary', () => {
  const tier = (value) => SharedCore.getProvenanceTrustTier('bearSource', value);
  // The exact shape buildManualBearSource records.
  assert.equal(tier('manual-bear (overrode ai: drag show)'), tier('manual-bear'));
  assert.ok(tier('manual-bear (overrode ai: drag show)') > tier('ai'));
  // Longest prefix wins — a manual-not-bear record never ranks as manual-bear.
  assert.equal(tier('manual-not-bear (overrode ai: club night)'), tier('manual-not-bear'));
  // Case/whitespace-insensitive like the rest of the stamp handling.
  assert.equal(tier('  Manual-Bear (overrode ai: x)  '), tier('manual-bear'));
  // A prefix WITHOUT a word boundary is not a match — fail open.
  assert.equal(tier('aime'), null);
  assert.equal(SharedCore.getProvenanceTrustTier('pinSource', 'curatedish'), null);
});

test('unknown provenance values and unknown fields rank null so callers fail open', () => {
  assert.equal(SharedCore.getProvenanceTrustTier('pinSource', 'weird-stamp'), null);
  assert.equal(SharedCore.getProvenanceTrustTier('bearSource', 'manual'), null,
    'bare manual- prefix without a known verdict is unknown');
  assert.equal(SharedCore.getProvenanceTrustTier('title', 'curated'), null,
    'non-provenance fields have no tiers');
  assert.equal(SharedCore.getProvenanceTrustTier('', 'curated'), null);
});

// ---------------------------------------------------------------------------
// New venue candidates (gathering-only growth loop): detection builder
// ---------------------------------------------------------------------------

const SEATTLE_CUFF_BAR = {
  name: 'The Cuff Complex',
  city: 'seattle',
  address: '1533 13th Ave, Seattle, WA 98122',
  coordinates: '47.6142041, -122.3168539'
};

function createVenueDiscoveryCore(withBars = true) {
  return new SharedCore({
    seattle: { timezone: 'America/Los_Angeles', calendar: 'chunky-dad-seattle', patterns: ['seattle'] }
  }, {
    eventSchema: EventSchema,
    bars: withBars ? { seattle: [SEATTLE_CUFF_BAR] } : {}
  });
}

function buildVenueCandidateEvent(overrides = {}) {
  return {
    title: 'Bear Night',
    startDate: new Date('2026-08-01T02:00:00.000Z'),
    city: 'seattle',
    bar: 'Massive',
    barSource: 'venue-site',
    address: '1400 12th Ave, Seattle, WA 98122',
    location: '47.6135, -122.3163',
    pinSource: 'geocoded-exact',
    website: 'https://massiveseattle.com/events/bear-night',
    _sourcePageUrl: 'https://massiveseattle.com/events/bear-night',
    ...overrides
  };
}

test('corroborated bar + exact pin + uncurated name yields a new venue candidate', () => {
  const core = createVenueDiscoveryCore();
  const candidates = core.buildNewVenueCandidates([buildVenueCandidateEvent()]);

  assert.equal(candidates.length, 1);
  const candidate = candidates[0];
  assert.equal(candidate.key, 'seattle|massive');
  assert.equal(candidate.name, 'Massive');
  assert.equal(candidate.city, 'seattle');
  assert.equal(candidate.address, '1400 12th Ave, Seattle, WA 98122');
  assert.equal(candidate.coordinates, '47.6135, -122.3163');
  assert.deepEqual(candidate.signals, ['venue-site']);
  assert.equal(candidate.website, 'https://massiveseattle.com/events/bear-night');
  assert.equal(candidate.sourceEvents.length, 1);
  assert.equal(candidate.sourceEvents[0].title, 'Bear Night');
  assert.equal(candidate.sourceEvents[0].date, '2026-08-01T02:00:00.000Z');
  assert.equal(candidate.sourceEvents[0].sourcePageUrl, 'https://massiveseattle.com/events/bear-night');
});

test('curated, uncorroborated, and unstamped barSource are all excluded', () => {
  const core = createVenueDiscoveryCore();
  assert.deepEqual(core.buildNewVenueCandidates([
    buildVenueCandidateEvent({ barSource: 'curated' }),
    buildVenueCandidateEvent({ barSource: 'uncorroborated' }),
    buildVenueCandidateEvent({ barSource: undefined }),
    buildVenueCandidateEvent({ barSource: '' })
  ]), []);
});

test('non-exact pins and missing pins are excluded', () => {
  const core = createVenueDiscoveryCore();
  assert.deepEqual(core.buildNewVenueCandidates([
    buildVenueCandidateEvent({ pinSource: 'geocoded-approx' }),
    buildVenueCandidateEvent({ pinSource: 'curated' }),
    buildVenueCandidateEvent({ pinSource: 'page' }),
    buildVenueCandidateEvent({ pinSource: undefined }),
    buildVenueCandidateEvent({ location: undefined }),
    buildVenueCandidateEvent({ location: 'The Cuff, Seattle' })
  ]), []);
});

test('missing bar or missing resolved city fails open to no candidate', () => {
  const core = createVenueDiscoveryCore();
  assert.deepEqual(core.buildNewVenueCandidates([
    buildVenueCandidateEvent({ bar: undefined }),
    buildVenueCandidateEvent({ bar: '   ' }),
    buildVenueCandidateEvent({ city: undefined }),
    buildVenueCandidateEvent({ city: '' })
  ]), []);
  assert.deepEqual(core.buildNewVenueCandidates(null), []);
});

test('a bar matching the city\'s curated bars is excluded (already known)', () => {
  const core = createVenueDiscoveryCore();
  // Same normalization as findCuratedBarByName: leading "the" and
  // punctuation/case differences still match the curated entry.
  assert.deepEqual(core.buildNewVenueCandidates([
    buildVenueCandidateEvent({ bar: 'The Cuff Complex' }),
    buildVenueCandidateEvent({ bar: 'CUFF COMPLEX!' })
  ]), []);
  // Without curated bars data for the city, the same name IS a candidate
  // (nothing curated to match against).
  const bareCore = createVenueDiscoveryCore(false);
  assert.equal(bareCore.buildNewVenueCandidates([
    buildVenueCandidateEvent({ bar: 'The Cuff Complex' })
  ]).length, 1);
});

test('events of the same venue dedup into one candidate with unioned evidence', () => {
  const core = createVenueDiscoveryCore();
  const candidates = core.buildNewVenueCandidates([
    buildVenueCandidateEvent({
      bar: 'MASSIVE',
      barSource: 'page-adjacent',
      address: 'Seattle, WA',
      title: 'Underwear Party'
    }),
    buildVenueCandidateEvent({
      bar: 'Massive',
      barSource: 'geo-poi',
      address: '1400 12th Ave, Seattle, WA 98122',
      title: 'Bear Night'
    }),
    buildVenueCandidateEvent({
      bar: 'The Massive', // normalizes to the same venue key
      barSource: 'geo-poi',
      title: 'Furry Friday'
    })
  ]);

  assert.equal(candidates.length, 1);
  const candidate = candidates[0];
  assert.equal(candidate.key, 'seattle|massive');
  assert.equal(candidate.name, 'Massive', 'mixed-case observation beats ALL-CAPS');
  assert.deepEqual(candidate.signals, ['page-adjacent', 'geo-poi'], 'signals unioned and deduped');
  assert.equal(candidate.address, '1400 12th Ave, Seattle, WA 98122', 'most complete observed address kept');
  assert.equal(candidate.sourceEvents.length, 3);
});

test('sourceEvents cap at 5 per candidate', () => {
  const core = createVenueDiscoveryCore();
  const events = Array.from({ length: 8 }, (_, i) =>
    buildVenueCandidateEvent({ title: `Bear Night ${i + 1}` }));
  const candidates = core.buildNewVenueCandidates(events);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceEvents.length, 5);
});

test('new venue candidate log line has the documented shape', () => {
  const core = createVenueDiscoveryCore();
  const [candidate] = core.buildNewVenueCandidates([
    buildVenueCandidateEvent({ barSource: 'geo-poi' })
  ]);
  assert.equal(
    core.formatNewVenueCandidateLogLine(candidate),
    '📋 NEW VENUE CANDIDATE: "Massive" (seattle) — signals: geo-poi — 1400 12th Ave, Seattle, WA 98122'
  );
  assert.equal(
    core.formatNewVenueCandidateLogLine({ name: 'Massive', city: 'seattle', signals: ['venue-site'], address: '' }),
    '📋 NEW VENUE CANDIDATE: "Massive" (seattle) — signals: venue-site — no address observed'
  );
});

test('candidate dossier omits website/instagram unless the source page is the venue\'s own site', () => {
  const core = createVenueDiscoveryCore();

  // Organizer-page events (e.g. a promoter site like bearracuda.com): the
  // event's website/instagram are the ORGANIZER's metadata, not the venue's —
  // both fields must be omitted from the dossier entirely.
  const [organizer] = core.buildNewVenueCandidates([
    buildVenueCandidateEvent({
      barSource: 'page-adjacent',
      website: 'https://bearracuda.com/',
      instagram: 'https://instagram.com/bearracuda',
      url: 'https://bearracuda.com/events/seattle'
    })
  ]);
  assert.ok(!('website' in organizer), 'organizer website omitted from the dossier');
  assert.ok(!('instagram' in organizer), 'organizer instagram omitted from the dossier');

  // geo-poi corroborates the bar name via map placemarks — still not the
  // venue's own site, so links stay out.
  const [geoPoi] = core.buildNewVenueCandidates([
    buildVenueCandidateEvent({
      barSource: 'geo-poi',
      instagram: 'https://instagram.com/bearracuda'
    })
  ]);
  assert.ok(!('website' in geoPoi) && !('instagram' in geoPoi),
    'geo-poi events contribute no links');

  // venue-site events keep both: barSource 'venue-site' is only stamped when
  // the source page IS the venue's own site (siteRole venue + name match).
  const [venueSite] = core.buildNewVenueCandidates([
    buildVenueCandidateEvent({
      barSource: 'venue-site',
      website: 'https://massiveseattle.com',
      instagram: 'https://instagram.com/massiveseattle'
    })
  ]);
  assert.equal(venueSite.website, 'https://massiveseattle.com');
  assert.equal(venueSite.instagram, 'https://instagram.com/massiveseattle');

  // The event-page-url fallback for website also only applies to venue-site
  // events (a page on the venue's own site is venue-attributable).
  const [urlFallback] = core.buildNewVenueCandidates([
    buildVenueCandidateEvent({
      barSource: 'venue-site',
      website: undefined,
      url: 'https://massiveseattle.com/events/bear-night'
    })
  ]);
  assert.equal(urlFallback.website, 'https://massiveseattle.com/events/bear-night');
});

test('mixed-provenance dedup takes links only from the venue-site observation', () => {
  const core = createVenueDiscoveryCore();
  const [candidate] = core.buildNewVenueCandidates([
    buildVenueCandidateEvent({
      barSource: 'page-adjacent',
      website: 'https://bearracuda.com/',
      instagram: 'https://instagram.com/bearracuda',
      title: 'Bearracuda Seattle'
    }),
    buildVenueCandidateEvent({
      barSource: 'venue-site',
      website: 'https://massiveseattle.com',
      instagram: undefined,
      title: 'Bear Night'
    })
  ]);
  assert.equal(candidate.website, 'https://massiveseattle.com',
    'venue-site link lands; the organizer link never does');
  assert.ok(!('instagram' in candidate),
    'no venue-attributable instagram observed → field omitted');
});

// ---------------------------------------------------------------------------
// Computed evidence panel (results-UI): buildEventEvidenceLines
// ---------------------------------------------------------------------------

// Seattle with center coordinates plus one curated bar with a pin — the two
// config sources the evidence distances are computed against.
function createEvidencePanelCore() {
  return new SharedCore({
    seattle: {
      timezone: 'America/Los_Angeles',
      calendar: 'chunky-dad-seattle',
      patterns: ['seattle'],
      coordinates: { lat: 47.6062, lng: -122.3321 }
    }
  }, {
    eventSchema: EventSchema,
    bars: { seattle: [SEATTLE_CUFF_BAR] }
  });
}

test('evidence: pin ↔ curated bar distance in meters, ⚠️ beyond 150 m', () => {
  const core = createEvidencePanelCore();
  // ~3.5 m from the curated Cuff pin → meters, no warning.
  const near = core.buildEventEvidenceLines({
    bar: 'The Cuff Complex',
    city: 'seattle',
    location: '47.6142, -122.3169'
  });
  assert.ok(near.includes('pin is 3 m from curated "The Cuff Complex" pin'),
    `expected curated-distance line, got: ${JSON.stringify(near)}`);
  // ~1.76 km away → 1-decimal km with the warning prefix.
  const far = core.buildEventEvidenceLines({
    bar: 'The Cuff Complex',
    city: 'seattle',
    location: '47.63, -122.3168539'
  });
  assert.ok(far.includes('⚠️ pin is 1.8 km from curated "The Cuff Complex" pin'),
    `expected warned curated-distance line, got: ${JSON.stringify(far)}`);
  // Between 150 m and 1 km: warned, still meters.
  const mid = core.buildEventEvidenceLines({
    bar: 'The Cuff Complex',
    city: 'seattle',
    location: '47.6142041, -122.32'
  });
  assert.ok(mid.includes('⚠️ pin is 236 m from curated "The Cuff Complex" pin'),
    `expected warned meter line, got: ${JSON.stringify(mid)}`);
  // A non-curated bar has no curated pin to compare against → no line.
  const uncurated = core.buildEventEvidenceLines({
    bar: 'Massive',
    city: 'seattle',
    location: '47.6142, -122.3169'
  });
  assert.ok(!uncurated.some(line => line.includes('curated')),
    'no curated line for a bar absent from curated data');
});

test('evidence: pin ↔ city center distance in km, ⚠️ beyond 50 km', () => {
  const core = createEvidencePanelCore();
  const near = core.buildEventEvidenceLines({
    bar: 'Massive',
    city: 'seattle',
    location: '47.6142, -122.3169'
  });
  assert.ok(near.includes('pin is 1.4 km from seattle center'),
    `expected center-distance line, got: ${JSON.stringify(near)}`);
  const far = core.buildEventEvidenceLines({
    city: 'seattle',
    location: '48.5, -122.33'
  });
  assert.ok(far.includes('⚠️ pin is 99.4 km from seattle center'),
    `expected warned center-distance line, got: ${JSON.stringify(far)}`);
  // City without center coordinates (the discovery fixture) → no line.
  const noCenter = createVenueDiscoveryCore().buildEventEvidenceLines({
    city: 'seattle',
    location: '47.6142, -122.3169'
  });
  assert.ok(!noCenter.some(line => line.includes('center')),
    'no center line without city coordinates');
});

test('evidence: map POI line renders match, mismatch, and bar-less variants', () => {
  const core = createEvidencePanelCore();
  const match = core.buildEventEvidenceLines({
    bar: 'Massive',
    city: 'seattle',
    _geoPoiName: 'Massive Nightclub',
    _geoPoiBarMatch: true
  });
  assert.ok(match.includes('map POI at pin: "Massive Nightclub" — ✓ matches bar'),
    `expected POI match line, got: ${JSON.stringify(match)}`);
  const differ = core.buildEventEvidenceLines({
    bar: 'Massive',
    city: 'seattle',
    _geoPoiName: 'Corner Deli',
    _geoPoiBarMatch: false
  });
  assert.ok(differ.includes('map POI at pin: "Corner Deli" — ⚠️ differs from bar "Massive"'),
    `expected POI mismatch line, got: ${JSON.stringify(differ)}`);
  const noBar = core.buildEventEvidenceLines({
    city: 'seattle',
    _geoPoiName: 'Corner Deli'
  });
  assert.ok(noBar.includes('map POI at pin: "Corner Deli"'),
    `expected bare POI line, got: ${JSON.stringify(noBar)}`);
  // No harvested POI this run (cached/skipped geocode) → no POI line at all.
  const noPoi = core.buildEventEvidenceLines({ bar: 'Massive', city: 'seattle' });
  assert.ok(!noPoi.some(line => line.includes('map POI')), 'no POI line without a harvest');
});

test('evidence: barSource renders a corroboration verdict and a provenance summary', () => {
  const core = createEvidencePanelCore();
  for (const source of ['page-adjacent', 'venue-site', 'geo-poi', 'curated']) {
    const lines = core.buildEventEvidenceLines({ bar: 'Massive', city: 'seattle', barSource: source });
    assert.ok(lines.includes(`bar corroborated: ${source}`),
      `expected corroboration line for ${source}, got: ${JSON.stringify(lines)}`);
  }
  const flagged = core.buildEventEvidenceLines({
    bar: 'Massive',
    city: 'seattle',
    barSource: 'uncorroborated'
  });
  assert.ok(flagged.includes('⚠️ bar uncorroborated (not found near address in source)'),
    `expected uncorroborated warning, got: ${JSON.stringify(flagged)}`);

  const provenance = core.buildEventEvidenceLines({
    bar: 'Massive',
    city: 'seattle',
    barSource: 'page-adjacent',
    pinSource: 'geocoded-exact',
    addressSource: 'page',
    imageSource: 'jsonld',
    bearSource: 'ai'
  });
  assert.ok(provenance.includes(
    'provenance: bar=page-adjacent, pin=geocoded-exact, address=page, image=jsonld, bear=ai'),
    `expected full provenance line, got: ${JSON.stringify(provenance)}`);
  // Only the stamps that exist appear.
  const partial = core.buildEventEvidenceLines({ city: 'seattle', pinSource: 'geocoded-exact' });
  assert.ok(partial.includes('provenance: pin=geocoded-exact'),
    `expected partial provenance line, got: ${JSON.stringify(partial)}`);
});

test('evidence: nothing computable fails open to an empty array', () => {
  const core = createEvidencePanelCore();
  assert.deepEqual(core.buildEventEvidenceLines({}), []);
  assert.deepEqual(core.buildEventEvidenceLines(null), []);
  assert.deepEqual(core.buildEventEvidenceLines(undefined), []);
  assert.deepEqual(core.buildEventEvidenceLines({ title: 'Bear Night', city: 'nowhere' }), []);
  // A non-coordinate location contributes no distance lines.
  assert.deepEqual(core.buildEventEvidenceLines({ city: 'seattle', location: 'The Cuff, Seattle' }), []);
});

test('evidence: _geoPoiName and _geoPoiBarMatch never serialize into notes', () => {
  const core = createEvidencePanelCore();
  const notes = core.formatEventNotes({
    bar: 'Massive',
    barSource: 'geo-poi',
    _geoPoiName: 'Massive Nightclub',
    _geoPoiBarMatch: true,
    _evidenceLines: ['bar corroborated: geo-poi']
  });
  assert.ok(notes.includes('bar: Massive'), 'real fields serialize');
  assert.ok(!notes.includes('_geoPoiName'), 'underscore key excluded');
  assert.ok(!notes.includes('Massive Nightclub'), 'underscore value excluded');
  assert.ok(!notes.includes('_geoPoiBarMatch') && !notes.includes('_evidenceLines'),
    'companion underscore fields excluded too');
});

test('new venue candidates carry a computed evidence panel from the same builder', () => {
  const core = createEvidencePanelCore();
  const [candidate] = core.buildNewVenueCandidates([
    buildVenueCandidateEvent({
      location: '47.6142, -122.3169',
      _geoPoiName: 'Massive Nightclub',
      _geoPoiBarMatch: true
    })
  ]);
  assert.ok(Array.isArray(candidate.evidence), 'evidence array attached');
  assert.ok(candidate.evidence.includes('pin is 1.4 km from seattle center'),
    `center line from candidate coordinates, got: ${JSON.stringify(candidate.evidence)}`);
  assert.ok(candidate.evidence.includes('map POI at pin: "Massive Nightclub" — ✓ matches bar'),
    'geo-POI evidence rides over from the coordinate-donor event');
  assert.ok(candidate.evidence.includes('bar corroborated: venue-site'),
    'first observed signal is the corroboration verdict');
  assert.ok(candidate.evidence.includes('provenance: bar=venue-site, pin=geocoded-exact'),
    'candidate provenance is signal + the exact pin its detection required');
  assert.ok(!('_geoPoiName' in candidate),
    'raw POI underscore fields never land on the candidate itself');
});

// ---------------------------------------------------------------------------
// City-suffix append hole (run 20260723-140457: the calendar carried the
// pre-#1525 mutation "LA NOGALERA, Torremolinos" plus an unstamped pin, and
// AI arbitration re-cemented both every run)
// ---------------------------------------------------------------------------

function createCoreWithTorremolinos() {
  return new SharedCore(
    { torremolinos: { timezone: 'Europe/Madrid', patterns: ['torremolinos'] } },
    { eventSchema: EventSchema }
  );
}

test('address ladder: city-suffixed twins resolve deterministically to the unsuffixed address', () => {
  const core = createCoreWithTorremolinos();
  const context = { cityKey: 'torremolinos' };

  const suffixedCalendar = core.resolveConflictDeterministically(
    'address', 'LA NOGALERA, Torremolinos', 'LA NOGALERA', context);
  assert.ok(suffixedCalendar, 'the twin must resolve without AI');
  assert.equal(suffixedCalendar.winner, 'b', 'the unsuffixed side wins');
  assert.match(suffixedCalendar.reason, /city-suffixed twin/);

  const suffixedScraped = core.resolveConflictDeterministically(
    'address', 'LA NOGALERA', 'LA NOGALERA, Torremolinos', context);
  assert.ok(suffixedScraped);
  assert.equal(suffixedScraped.winner, 'a', 'direction-symmetric');

  // A tail naming some OTHER place is NOT the resolution fingerprint.
  assert.equal(
    core.resolveConflictDeterministically('address', 'LA NOGALERA, Marbella', 'LA NOGALERA', context),
    null,
    'a non-city tail falls through to evidence/AI exactly as before'
  );
  // No city context → fail open.
  assert.equal(
    core.resolveConflictDeterministically('address', 'LA NOGALERA, Torremolinos', 'LA NOGALERA', {}),
    null
  );
});

test('address ladder: house-numbered street twins keep the more complete (city-bearing) form as before', () => {
  const core = createCore();
  const resolved = core.resolveConflictDeterministically(
    'address', '3911 Cedar Springs Rd, Dallas', '3911 Cedar Springs Rd', { cityKey: 'dallas' });
  assert.ok(resolved, 'the same-address rung still settles street twins');
  assert.equal(resolved.winner, 'a', 'the more complete street address still wins');
  assert.match(resolved.reason, /more complete/);
});

test('merge regression (Mad.Bear): the appended calendar address loses, the kept append-path pin gets stamped approx', async () => {
  const core = createCoreWithTorremolinos();
  const adapter = buildArbitrationAdapter({});
  const scraped = {
    title: 'FURBALL MAD.BEAR',
    startDate: new Date('2026-08-15T23:00:00.000Z'),
    endDate: new Date('2026-08-15T23:00:00.000Z'),
    bar: 'Aqua Emporio',
    address: 'LA NOGALERA',
    addressSource: 'page',
    city: 'torremolinos',
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({})
  };
  const existing = {
    title: 'FURBALL MAD.BEAR',
    startDate: new Date('2026-08-15T23:00:00.000Z'),
    endDate: new Date('2026-08-15T23:00:00.000Z'),
    location: '36.6225097, -4.4987054',
    url: '',
    notes: ['bar: Aqua Emporio', 'address: LA NOGALERA, Torremolinos'].join('\n')
  };

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(finalEvent.address, 'LA NOGALERA', 'the unmutated address wins deterministically');
  assert.ok(
    adapter.calls.every(call => !String(call.prompt || '').includes('field: address')),
    'the address conflict never reaches AI arbitration'
  );
  assert.equal(finalEvent.location, '36.6225097, -4.4987054', 'the calendar pin is kept (scrape found none)');
  assert.equal(finalEvent.pinSource, 'geocoded-approx', 'append-path pins are stamped approx, never left stamp-less');
  assert.equal(finalEvent.addressSource, 'page', 'addressSource follows the winning scraped address');
  assert.match(core.parseNotesIntoFields(finalEvent.notes).pinSource || '', /geocoded-approx/);
});

test('merge: the approx stamp is scoped to the append fingerprint — a stored pinSource is never overwritten', async () => {
  const core = createCoreWithTorremolinos();
  const adapter = buildArbitrationAdapter({});
  const scraped = {
    title: 'FURBALL MAD.BEAR',
    startDate: new Date('2026-08-15T23:00:00.000Z'),
    endDate: new Date('2026-08-15T23:00:00.000Z'),
    address: 'LA NOGALERA',
    city: 'torremolinos',
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({})
  };
  const existing = {
    title: 'FURBALL MAD.BEAR',
    startDate: new Date('2026-08-15T23:00:00.000Z'),
    endDate: new Date('2026-08-15T23:00:00.000Z'),
    location: '36.6225097, -4.4987054',
    url: '',
    notes: ['address: LA NOGALERA, Torremolinos', 'pinSource: curated'].join('\n')
  };

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(finalEvent.address, 'LA NOGALERA');
  assert.equal(finalEvent.pinSource, 'curated', 'a stored stamp always wins over the guard');
});

// ---------------------------------------------------------------------------
// Curated Aqua Emporio (Torremolinos): non-parsing curated address anchors the
// merge, and the curated-upgraded scrape beats the stale district calendar value
// ---------------------------------------------------------------------------

const AQUA_EMPORIO_ADDRESS = 'Calle Danza Invisible, La Nogalera 710, 29620 Torremolinos';

function createCoreWithTorremolinosBars() {
  return new SharedCore(
    {
      torremolinos: {
        timezone: 'Europe/Madrid',
        patterns: ['torremolinos'],
        coordinates: { lat: 36.6213, lng: -4.4998 }
      }
    },
    {
      eventSchema: EventSchema,
      bars: {
        torremolinos: [{
          name: 'Aqua Emporio',
          city: 'torremolinos',
          address: AQUA_EMPORIO_ADDRESS,
          coordinates: '36.6218328, -4.4982728'
        }]
      }
    }
  );
}

test('address rung 2 fallback: a curated address without a leading house number anchors by token equality', () => {
  const core = createCoreWithTorremolinosBars();
  const context = { cityKey: 'torremolinos', barNames: ['AQUA EMPORIO'] };

  // The Spanish-format curated address never parses for the street rung
  // (number follows the street name) — token equality decides instead, in
  // both directions.
  assert.deepEqual(
    core.resolveConflictDeterministically('address', 'LA NOGALERA, Torremolinos', AQUA_EMPORIO_ADDRESS, context),
    { winner: 'b', reason: 'matches curated bar address (Aqua Emporio)' });
  assert.deepEqual(
    core.resolveConflictDeterministically('address', AQUA_EMPORIO_ADDRESS, 'LA NOGALERA, Torremolinos', context),
    { winner: 'a', reason: 'matches curated bar address (Aqua Emporio)' });
  // Format-tolerant: an abbreviation/case/punctuation twin of the curated
  // address still counts as the curated address.
  assert.deepEqual(
    core.resolveConflictDeterministically('address', 'LA NOGALERA', 'calle danza invisible la nogalera 710 29620 torremolinos', context),
    { winner: 'b', reason: 'matches curated bar address (Aqua Emporio)' });
  // Fail closed: a PARSEABLE street address contradicting curated data is
  // never silently resolved — the AI sees it.
  assert.equal(
    core.resolveConflictDeterministically('address', '5 Calle Casablanca, Torremolinos', AQUA_EMPORIO_ADDRESS, context),
    null, 'a parseable contradiction of curated data still arbitrates');
  // Neither candidate is the curated address → arbitrate as before.
  assert.equal(
    core.resolveConflictDeterministically('address', 'somewhere else entirely', 'LA NOGALERA', context),
    null);
  // No bar context → rung inert.
  assert.equal(
    core.resolveConflictDeterministically('address', 'LA NOGALERA, Torremolinos', AQUA_EMPORIO_ADDRESS,
      { cityKey: 'torremolinos' }),
    null);
});

test('merge survival (Mad.Bear): the curated-upgraded address beats the calendar\'s stale district address', async () => {
  const core = createCoreWithTorremolinosBars();
  const adapter = buildArbitrationAdapter({});
  // The scraped record as the normalizers now produce it: district address
  // upgraded to the curated street address, curated pin adopted.
  const scraped = {
    title: 'FURBALL MAD.BEAR',
    startDate: new Date('2026-08-15T23:00:00.000Z'),
    endDate: new Date('2026-08-16T05:00:00.000Z'),
    bar: 'AQUA EMPORIO',
    address: AQUA_EMPORIO_ADDRESS,
    addressSource: 'curated',
    location: '36.6218328, -4.4982728',
    pinSource: 'curated',
    city: 'torremolinos',
    source: 'ai-web',
    _fieldPriorities: core.getResolvedFieldPriorities({})
  };
  const existing = {
    title: 'FURBALL MAD.BEAR',
    startDate: new Date('2026-08-15T23:00:00.000Z'),
    endDate: new Date('2026-08-16T05:00:00.000Z'),
    location: '36.6225097, -4.4987054',
    url: '',
    notes: [
      'bar: AQUA EMPORIO',
      'address: LA NOGALERA, Torremolinos',
      'addressSource: page',
      'pinSource: geocoded-approx'
    ].join('\n')
  };

  const logLines = [];
  const originalLog = console.log;
  console.log = (message) => { logLines.push(String(message)); };
  let finalEvent;
  try {
    finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });
  } finally {
    console.log = originalLog;
  }

  assert.equal(adapter.calls.length, 0, 'the curated address settles the only conflict — no AI request');
  assert.equal(finalEvent.address, AQUA_EMPORIO_ADDRESS, 'the curated-upgraded address wins the merge');
  assert.equal(finalEvent.addressSource, 'curated', 'addressSource follows the winning scraped address');
  assert.deepEqual(finalEvent._original.aiArbitration.deterministic, ['address']);
  assert.ok(logLines.includes(
    '🔒 MERGE: "FURBALL MAD.BEAR" field=address resolved deterministically — matches curated bar address (Aqua Emporio)'
  ), `stable 🔒 log line expected, got: ${JSON.stringify(logLines)}`);
  // The address changed, so the fresh curated pin replaces the stale
  // neighborhood-centroid pin, and pinSource follows it.
  assert.equal(finalEvent.location, '36.6218328, -4.4982728');
  assert.equal(finalEvent.pinSource, 'curated');
});

test('merge survival (enrich flow): the curated-upgraded address beats a same-priority district scrape without AI', async () => {
  const core = createCoreWithTorremolinosBars();
  const priorities = { address: { priority: ['ai-web'], merge: 'ai' } };
  const aiParserConfig = { ai: { provider: 'ollama', endpoint: 'http://ai.example', model: 'm' } };
  const existing = {
    title: 'FURBALL MAD.BEAR',
    bar: 'AQUA EMPORIO',
    address: 'LA NOGALERA, Torremolinos',
    city: 'torremolinos',
    source: 'ai-web',
    _fieldPriorities: priorities
  };
  const incoming = {
    title: 'FURBALL MAD.BEAR',
    bar: 'AQUA EMPORIO',
    address: AQUA_EMPORIO_ADDRESS,
    city: 'torremolinos',
    source: 'ai-web',
    _parserConfig: aiParserConfig,
    _fieldPriorities: priorities
  };
  const adapter = buildArbitrationAdapter({});

  const merged = await core.mergeParsedEvents(existing, incoming, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 0, 'the curated rung decides the same-priority conflict — no AI request');
  assert.equal(merged.address, AQUA_EMPORIO_ADDRESS, 'the curated address wins in the enrich flow too');
});

test('curated bars: torremolinos.json carries Aqua Emporio and the generated scraper-bars twins are in sync', () => {
  const fs = require('fs');
  const path = require('path');
  const torremolinosBars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bars', 'torremolinos.json'), 'utf8'));
  const aqua = torremolinosBars.find(bar => bar && bar.name === 'Aqua Emporio');
  assert.ok(aqua, 'Aqua Emporio curated in data/bars/torremolinos.json');
  assert.equal(aqua.city, 'torremolinos');
  assert.equal(aqua.address, AQUA_EMPORIO_ADDRESS);
  assert.equal(aqua.coordinates, '36.6218328, -4.4982728');
  assert.equal(aqua.website, 'https://aquatorremolinos.com');
  assert.equal(aqua.instagram, 'https://www.instagram.com/aquatorremolinos');

  // Generated module twin (scripts/scraper-bars.js) is committed in sync.
  const scraperBars = require('./scraper-bars');
  assert.deepEqual(scraperBars.torremolinos, torremolinosBars, 'scripts/scraper-bars.js regenerated after the torremolinos.json edit');

  // Pure-JSON twin served by the site.
  const jsonTwin = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'scraper-bars.json'), 'utf8'));
  assert.deepEqual(jsonTwin.torremolinos, torremolinosBars, 'data/scraper-bars.json regenerated after the torremolinos.json edit');

  // The event's ALL-CAPS bar resolves to the curated record (normalizeBarNameKey).
  const core = new SharedCore({}, { eventSchema: EventSchema, bars: scraperBars });
  const match = core.findCuratedBarByName(core.getCuratedCityBars('torremolinos'), 'AQUA EMPORIO');
  assert.ok(match && match.name === 'Aqua Emporio', 'curated lookup resolves the ALL-CAPS event bar');
});

// ---------------------------------------------------------------------------
// geo-poi addressSource tier + fusion evidence line
// ---------------------------------------------------------------------------

test('addressSource trust tiers: geo-poi slots equal to page, below curated', () => {
  const tier = (value) => SharedCore.getProvenanceTrustTier('addressSource', value);
  assert.equal(tier('geo-poi'), 2, 'geo-poi is tier 2');
  assert.equal(tier('geo-poi'), tier('page'), 'equal to page');
  assert.ok(tier('curated') > tier('geo-poi'), 'below curated');
  assert.ok(tier('geo-poi') > tier('inferred'), 'above inferred');
});

test('evidence: a venue-name fusion flag renders its line and never serializes into notes', () => {
  const core = createCore();
  const event = {
    title: 'FURBALL MAD.BEAR',
    bar: 'Aqua Emporio',
    city: 'dallas',
    _geoPoiFusion: { poi: 'Aqua Club', prefix: 'Aqua' }
  };
  const lines = core.buildEventEvidenceLines(event);
  assert.ok(
    lines.includes('⚠️ bar "Aqua Emporio" may fuse venue names — map knows "Aqua Club" (matches "Aqua")'),
    `fusion evidence line expected, got: ${JSON.stringify(lines)}`
  );
  assert.ok(!/(_geoPoiFusion|Aqua Club)/.test(core.formatEventNotes(event)), 'underscore fields never serialize into notes');

  const barless = core.buildEventEvidenceLines({ title: 'X', _geoPoiFusion: { poi: 'Aqua Club', prefix: 'Aqua' } });
  assert.ok(!barless.some(line => line.includes('may fuse')), 'no bar → no fusion line (fail open)');
});

test('evidence: pointer-rescue candidates render their panel line and never serialize into notes', () => {
  const core = createCore();
  // LOG-ONLY observation phase: the gate dropped the field (the event shows
  // no value) — the line surfaces what the rescue WOULD have adopted so real
  // runs can prove or damn the heuristic before promotion.
  const event = {
    title: 'FURBALL Boston',
    city: 'dallas',
    _evidenceRescues: [
      { field: 'address', candidate: '79 WARRENTON', modelValue: '79 Warrenon', corpus: 'ocr' },
      { field: 'bar', candidate: 'The Alley Cantina', modelValue: 'Alley Cantena', corpus: 'page' }
    ]
  };
  const lines = core.buildEventEvidenceLines(event);
  assert.ok(
    lines.includes('address rescue candidate (log-only): "79 WARRENTON" — model wrote "79 Warrenon"'),
    `address rescue line expected, got: ${JSON.stringify(lines)}`
  );
  assert.ok(
    lines.includes('bar rescue candidate (log-only): "The Alley Cantina" — model wrote "Alley Cantena"'),
    'one compact line per rescue entry'
  );
  assert.ok(!/(_evidenceRescues|WARRENTON)/.test(core.formatEventNotes(event)), '_evidenceRescues never serializes into notes');

  // Malformed entries fail open: no line, no crash.
  const junk = core.buildEventEvidenceLines({
    title: 'X',
    _evidenceRescues: [null, 42, {}, { field: 'bar' }, { candidate: 'orphan' }]
  });
  assert.ok(!junk.some(line => line.includes('rescue candidate')), 'malformed rescue entries render nothing');
});

// ---------------------------------------------------------------------------
// Bar-convergence rescue: evidence panel rendering + curated Legacy (Boston)
// data sync (run 20260723-224434).
// ---------------------------------------------------------------------------

test('evidence: a rescued bar renders the signal-convergence line; _barRescue never serializes into notes', () => {
  const core = createEvidencePanelCore();
  const event = {
    bar: 'Legacy',
    barSource: 'curated',
    city: 'boston',
    _barRescue: { candidate: 'Legacy', signals: ['curated', 'page', 'ocr'] }
  };
  const lines = core.buildEventEvidenceLines(event);
  assert.ok(lines.includes('bar rescued by signal convergence (curated, page, ocr)'),
    `rescue evidence line expected, got: ${JSON.stringify(lines)}`);
  assert.ok(lines.includes('bar corroborated: curated'),
    'the ordinary barSource verdict still renders alongside the rescue line');

  const notes = core.formatEventNotes(event);
  assert.ok(notes.includes('bar: Legacy'), 'real fields serialize');
  assert.ok(!notes.includes('_barRescue') && !notes.includes('signal convergence'),
    'underscore rescue metadata never serializes into notes');

  // No bar (rescue metadata without an adopted bar) → no line (fail open).
  const barless = core.buildEventEvidenceLines({
    title: 'X',
    _barRescue: { candidate: 'Legacy', signals: ['ocr'] }
  });
  assert.ok(!barless.some(line => line.includes('rescued')), 'no bar → no rescue line');
});

test('curated bars: boston.json carries Legacy and the generated scraper-bars twins are in sync', () => {
  const fs = require('fs');
  const path = require('path');
  const bostonBars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bars', 'boston.json'), 'utf8'));
  const legacy = bostonBars.find(bar => bar && bar.name === 'Legacy');
  assert.ok(legacy, 'Legacy curated in data/bars/boston.json');
  assert.equal(legacy.city, 'boston');
  assert.equal(legacy.address, '79 Warrenton St, Boston, MA 02116');
  assert.equal(legacy.coordinates, '42.3499063, -71.0658453');

  // Generated module twin (scripts/scraper-bars.js) is committed in sync.
  const scraperBars = require('./scraper-bars');
  assert.deepEqual(scraperBars.boston, bostonBars, 'scripts/scraper-bars.js regenerated after the boston.json edit');

  // Pure-JSON twin served by the site.
  const jsonTwin = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'scraper-bars.json'), 'utf8'));
  assert.deepEqual(jsonTwin.boston, bostonBars, 'data/scraper-bars.json regenerated after the boston.json edit');

  // The curated record is what findCuratedBarByName resolves for the rescue.
  const core = new SharedCore({}, { eventSchema: EventSchema, bars: scraperBars });
  const match = core.findCuratedBarByName(core.getCuratedCityBars('boston'), 'LEGACY');
  assert.ok(match && match.name === 'Legacy', 'curated lookup resolves the rescue candidate');
});

// ---------------------------------------------------------------------------
// findCuratedBarCityByName — cross-city curated-bar lookup backing the
// LocationNormalizer city backfill (run 20260724-161423). Fail closed: one
// city → match, several cities → ambiguous, none/no-bars → null.
// ---------------------------------------------------------------------------

test('findCuratedBarCityByName: unique match, ambiguity, partial-name miss, and missing bars data', () => {
  const bars = {
    seattle: [{ name: 'Massive', city: 'seattle' }],
    dallas: [{ name: 'Dallas Eagle', city: 'dallas' }],
    nyc: [{ name: 'Eagle NYC', city: 'nyc' }]
  };
  const core = new SharedCore({}, { eventSchema: EventSchema, bars });

  // Unique full-name match (case-insensitive via normalizeBarNameKey)
  assert.deepEqual(core.findCuratedBarCityByName('MASSIVE'), { city: 'seattle', bar: bars.seattle[0] });

  // Partial names never match: "Eagle" claims neither "Dallas Eagle" nor "Eagle NYC"
  assert.equal(core.findCuratedBarCityByName('Eagle'), null);
  // Different keys never match: "Massive Club" is not "Massive"
  assert.equal(core.findCuratedBarCityByName('Massive Club'), null);

  // Same normalized name curated in two cities → ambiguous, never a pick
  const twoCities = new SharedCore({}, {
    eventSchema: EventSchema,
    bars: { seattle: [{ name: 'Massive' }], portland: [{ name: 'The Massive' }] }
  });
  assert.deepEqual(twoCities.findCuratedBarCityByName('Massive'), { ambiguousCities: ['seattle', 'portland'] });

  // No bars data at all → null (fail closed)
  const noBars = new SharedCore({}, { eventSchema: EventSchema });
  assert.equal(noBars.findCuratedBarCityByName('Massive'), null);
  assert.equal(core.findCuratedBarCityByName(''), null);
});

// ---------------------------------------------------------------------------
// findCuratedBarCityByName — generic-name-stem guard (run 20260725-170926:
// the truncated bar "Eagle" uniquely matched fort-lauderdale's curated
// "Eagle" and backfilled fort-lauderdale onto Dallas Eagle events).
// Uniqueness is NOT identity when the name is a franchise stem: the curated
// corpus itself flags it via containment, no word lists.
// ---------------------------------------------------------------------------

test('findCuratedBarCityByName: a unique match whose key is contained in another curated name is a generic stem', () => {
  const bars = {
    'fort-lauderdale': [{ name: 'Eagle', city: 'fort-lauderdale' }],
    dallas: [{ name: 'Dallas Eagle', city: 'dallas' }],
    seattle: [{ name: 'Massive', city: 'seattle' }]
  };
  const core = new SharedCore({}, { eventSchema: EventSchema, bars });

  // The literal repro: "Eagle" IS uniquely curated (fort-lauderdale) but its
  // key is contained in "dallaseagle" → refuse with the stem shape.
  assert.deepEqual(core.findCuratedBarCityByName('Eagle'), {
    genericStem: true,
    containedIn: ['Dallas Eagle']
  });

  // "Massive" is contained in no other curated name → still backfills.
  assert.deepEqual(core.findCuratedBarCityByName('Massive'), { city: 'seattle', bar: bars.seattle[0] });

  // Containment is one-way: the LONGER unique name "Dallas Eagle" contains
  // someone else's stem but is itself contained in nothing → exact match wins.
  assert.deepEqual(core.findCuratedBarCityByName('Dallas Eagle'), { city: 'dallas', bar: bars.dallas[0] });
});

// ---------------------------------------------------------------------------
// Cross-source duplicate detection (runs 20260724-155934 / 20260725-170926:
// the Dallas Eagle parser crawls both an Eventbrite organizer page and
// thedallaseagle.com/events, so the same event arrives twice with variant
// titles). Signal = venue identity + same event night + title-token subset;
// every step fails closed.
// ---------------------------------------------------------------------------

const DALLAS_CITIES = { dallas: { timezone: 'America/Chicago', patterns: ['dallas'] } };
const EAGLE_HOST = 'thedallaseagle.com';

function createDallasCore() {
  return new SharedCore(DALLAS_CITIES, { eventSchema: EventSchema });
}

test('getEventNightKey: anchored evenings, wee-hour rollover, midnight date-only default, wall-clock and missing dates', () => {
  const core = createDallasCore();
  // 2026-08-01T02:00Z = Jul 31 21:00 in America/Chicago → the night of Jul 31
  assert.equal(core.getEventNightKey({ startDate: new Date('2026-08-01T02:00:00.000Z'), timezone: 'America/Chicago' }), '2026-07-31');
  // 2026-07-26T07:00Z = Jul 26 02:00 local — a wee-hour start belongs to the PREVIOUS night
  assert.equal(core.getEventNightKey({ startDate: new Date('2026-07-26T07:00:00.000Z'), timezone: 'America/Chicago' }), '2026-07-25');
  // 2026-07-31T05:00Z = Jul 31 00:00 local EXACTLY — the missing-time midnight
  // default means "the event is ON July 31", so no rollover (literal "Thighs
  // out…" shape from run 20260725-170926)
  assert.equal(core.getEventNightKey({ startDate: new Date('2026-07-31T05:00:00.000Z'), timezone: 'America/Chicago' }), '2026-07-31');
  // A timezone resolved from the city works like an explicit timezone field
  assert.equal(core.getEventNightKey({ startDate: new Date('2026-08-01T02:00:00.000Z'), city: 'dallas' }), '2026-07-31');
  // Wall-clock (_timezoneUnresolved) components are already the local reading
  assert.equal(core.getEventNightKey({ startDate: new Date('2026-07-30T19:00:00.000Z'), _timezoneUnresolved: true, timezone: 'America/Chicago' }), '2026-07-30');
  // No/invalid start date → no night, never pairs
  assert.equal(core.getEventNightKey({}), '');
  assert.equal(core.getEventNightKey({ startDate: 'not a date' }), '');
});

test('cross-source signal: literal Singlet pair (run 20260725-170926) pairs across the midnight-default gap', () => {
  const core = createDallasCore();
  const singlet = {
    title: 'Singlet Night with DJ Drew G', bar: 'Dallas Eagle', city: 'dallas',
    timezone: 'America/Chicago', startDate: new Date('2026-08-01T02:00:00.000Z'), _venueSitePageHost: EAGLE_HOST
  };
  const thighs = {
    title: 'Thighs out for the guys yall, it’s Singlet Night at the Dallas Eagle 🤼‍♂️🦅',
    bar: 'Dallas Eagle', city: 'dallas', timezone: 'America/Chicago',
    startDate: new Date('2026-07-31T05:00:00.000Z'), _venueSitePageHost: EAGLE_HOST
  };
  assert.equal(core.getCrossSourceDuplicateSignal(singlet, thighs), 'venue+night+title-subset');
});

test('cross-source signal: venue identity via _venueSitePageHost when one record has no bar at all (literal Karaoke pair)', () => {
  const core = createDallasCore();
  const detail = {
    title: 'Karaoke featuring Stevie Licks', bar: 'Dallas Eagle', city: 'dallas',
    timezone: 'America/Chicago', startDate: new Date('2026-07-31T00:00:00.000Z'), _venueSitePageHost: EAGLE_HOST
  };
  const listing = {
    title: 'Eagle Karaoke featuring Stevie Licks', city: 'unknown',
    startDate: new Date('2026-07-30T19:00:00.000Z'), _timezoneUnresolved: true, _venueSitePageHost: EAGLE_HOST
  };
  assert.equal(core.getCrossSourceDuplicateSignal(detail, listing), 'venue+night+title-subset');
  // Without the host tag the barless record has NO venue identity — never pairs
  assert.equal(core.getCrossSourceDuplicateSignal(detail, { ...listing, _venueSitePageHost: undefined }), null);
});

test('cross-source signal: fails closed on disjoint titles, different nights, and empty titles', () => {
  const core = createDallasCore();
  const base = { bar: 'Dallas Eagle', city: 'dallas', timezone: 'America/Chicago', _venueSitePageHost: EAGLE_HOST };
  // Literal same-night same-venue pair that is TWO REAL events (early happy
  // hour + night party, run 20260725-170926) — disjoint significant tokens
  const underwearNight = { ...base, title: 'Underwear Night and Contest with DJ Michael Jon', startDate: new Date('2026-07-30T02:00:00.000Z') };
  const happyHour = { ...base, title: 'UNDERWEAR HAPPY HOUR', startDate: new Date('2026-07-30T00:00:00.000Z') };
  assert.equal(core.getCrossSourceDuplicateSignal(underwearNight, happyHour), null);
  // Literal 20260724-155934 Pet Night shapes: extraction put them on DIFFERENT
  // nights (Jul 24 wall-clock vs Jul 25 local) — fail closed, keep both
  const petListing = { ...base, title: 'It’s PET NIGHT at the Dallas Eagle! Get ready to unleash your inner pup…', startDate: new Date('2026-07-26T01:00:00.000Z') };
  const petDetail = { title: 'Pet Night with DJ Boost', startDate: new Date('2026-07-24T21:00:00.000Z'), _timezoneUnresolved: true, _venueSitePageHost: EAGLE_HOST };
  assert.equal(core.getCrossSourceDuplicateSignal(petListing, petDetail), null);
  // Titles that normalize to nothing never pair
  assert.equal(core.getCrossSourceDuplicateSignal({ ...base, title: '🔥🔥', startDate: new Date('2026-07-30T02:00:00.000Z') }, happyHour), null);
  // Missing start date never pairs
  assert.equal(core.getCrossSourceDuplicateSignal({ ...base, title: 'UNDERWEAR HAPPY HOUR' }, happyHour), null);
});

test('cross-source dedup: secondary ticketUrl/image enrich the primary through the existing merge machinery', async () => {
  const core = createDallasCore();
  const primary = {
    title: 'Karaoke featuring Stevie Licks', bar: 'Dallas Eagle', city: 'dallas',
    timezone: 'America/Chicago', source: 'ai-web',
    startDate: new Date('2026-07-31T00:00:00.000Z'), endDate: new Date('2026-07-31T03:00:00.000Z'),
    description: 'Join us for a very special Eagle Karaoke featuring Stevie Licks!',
    _venueSitePageHost: EAGLE_HOST
  };
  // Barless listing record (the existing identity pass cannot see its place —
  // only the host tag proves the venue), carrying fields the primary lacks.
  const secondary = {
    title: 'Eagle Karaoke featuring Stevie Licks', source: 'ai-web',
    startDate: new Date('2026-07-30T19:00:00.000Z'), _timezoneUnresolved: true,
    ticketUrl: 'https://www.thedallaseagle.com/events/karaoke-featuring-stevie-licks/',
    image: 'https://img.example/karaoke.jpg',
    _venueSitePageHost: EAGLE_HOST
  };
  let result = null;
  const originalLog = console.log;
  const lines = [];
  console.log = (message) => { lines.push(String(message)); };
  try {
    result = await core.deduplicateEvents([primary, secondary], null);
  } finally {
    console.log = originalLog;
  }
  assert.equal(result.length, 1, 'the pair collapses to one event');
  assert.equal(result[0].title, 'Karaoke featuring Stevie Licks', 'the richer record is the primary');
  assert.equal(result[0].ticketUrl, secondary.ticketUrl, 'secondary ticketUrl enriches the primary');
  assert.equal(result[0].image, secondary.image, 'secondary image enriches the primary');
  assert.ok(
    lines.includes('🔀 MERGE: cross-source duplicate "Eagle Karaoke featuring Stevie Licks" merged into "Karaoke featuring Stevie Licks" (venue+night+title-subset)'),
    `cross-source merge log expected, got:\n${lines.join('\n')}`
  );
});

test('cross-source dedup: the literal Dallas Eagle clusters collapse through the real dedup path (5 clusters → 5 events, non-duplicates stay)', async () => {
  const core = createDallasCore();
  const anchored = { city: 'dallas', timezone: 'America/Chicago', source: 'ai-web', _venueSitePageHost: EAGLE_HOST };
  const raw = [
    // Pet Night cluster (2) — night of Jul 25
    { ...anchored, title: 'It’s PET NIGHT at the Dallas Eagle! Get ready to unleash your inner pup and join us for a night of tail-wagging fun 🐶🦅', bar: 'Dallas Eagle', startDate: new Date('2026-07-26T01:00:00.000Z'), endDate: new Date('2026-07-26T07:00:00.000Z'), url: 'https://www.thedallaseagle.com' },
    { title: 'Pet Night with DJ Boost', source: 'ai-web', startDate: new Date('2026-07-25T21:00:00.000Z'), _timezoneUnresolved: true, _venueSitePageHost: EAGLE_HOST, url: 'https://www.thedallaseagle.com/events/pet-night-with-dj-boost/', image: 'https://img.example/pet.jpg' },
    // Gear Night cluster (3) — night of Jul 25; "GEAR NIGHT!" starts at
    // Jul 26 02:00 local, exercising the wee-hour rollover
    { ...anchored, title: 'Grab your gear, it’s time for GEAR NIGHT!', bar: 'Dallas Eagle', startDate: new Date('2026-07-26T02:00:00.000Z') },
    { ...anchored, title: 'GEAR NIGHT!', bar: 'Dallas Eagle', startDate: new Date('2026-07-26T07:00:00.000Z') },
    { title: 'Gear Night with DJ Drew G', source: 'ai-web', startDate: new Date('2026-07-25T21:00:00.000Z'), _timezoneUnresolved: true, _venueSitePageHost: EAGLE_HOST },
    // Karaoke cluster (2, literal 20260725-170926 shapes) — night of Jul 30
    { ...anchored, title: 'Karaoke featuring Stevie Licks', bar: 'Dallas Eagle', startDate: new Date('2026-07-31T00:00:00.000Z'), endDate: new Date('2026-07-31T03:00:00.000Z'), ticketUrl: 'https://www.thedallaseagle.com/events/karaoke-featuring-stevie-licks/', url: 'https://www.thedallaseagle.com/events/karaoke-featuring-stevie-licks/' },
    { title: 'Eagle Karaoke featuring Stevie Licks', source: 'ai-web', city: 'unknown', startDate: new Date('2026-07-30T19:00:00.000Z'), endDate: new Date('2026-07-30T22:00:00.000Z'), _timezoneUnresolved: true, _venueSitePageHost: EAGLE_HOST, cover: 'No cover', url: 'https://www.thedallaseagle.com' },
    // Literal "Karaoke" (run 20260724-155934): bar truncated to "Eagle", no
    // host tag, wall-clock Jul 24 — a DIFFERENT night, so fail-closed keeps it
    { title: 'Karaoke', source: 'ai-web', bar: 'Eagle', startDate: new Date('2026-07-24T21:00:00.000Z'), _timezoneUnresolved: true },
    // FREQUENCY cluster (2, literal bars "Eagle" vs "Dallas Eagle") — night of Jul 30
    { ...anchored, title: 'George Flores presents: FREQUENCY at the Dallas Eagle, every last Thursday of the month! 🔥', bar: 'Eagle', startDate: new Date('2026-07-31T03:00:00.000Z') },
    { ...anchored, title: 'FREQUENCY', bar: 'Dallas Eagle', startDate: new Date('2026-07-31T03:00:00.000Z') },
    // Singlet cluster (2, literal 20260725-170926 shapes) — night of Jul 31
    { ...anchored, title: 'Singlet Night with DJ Drew G', bar: 'Dallas Eagle', startDate: new Date('2026-08-01T02:00:00.000Z'), endDate: new Date('2026-08-01T07:00:00.000Z'), cover: 'free', ticketUrl: 'https://www.thedallaseagle.com/events/singlet-night/' },
    { ...anchored, title: 'Thighs out for the guys yall, it’s Singlet Night at the Dallas Eagle 🤼‍♂️🦅', bar: 'Dallas Eagle', startDate: new Date('2026-07-31T05:00:00.000Z'), endDate: new Date('2026-08-01T07:00:00.000Z') },
    // Legit non-duplicates: same venue, same night (Jul 29), disjoint titles
    { ...anchored, title: 'Underwear Night and Contest with DJ Michael Jon', bar: 'Dallas Eagle', startDate: new Date('2026-07-30T02:00:00.000Z') },
    { ...anchored, title: 'UNDERWEAR HAPPY HOUR', bar: 'Dallas Eagle', startDate: new Date('2026-07-30T00:00:00.000Z') }
  ];

  const result = await core.deduplicateEvents(raw, null);

  const titles = result.map(event => event.title).sort();
  assert.equal(result.length, 8, `5 collapsed clusters + 3 kept singles, got: ${titles.join(' | ')}`);
  // Every cluster collapsed to exactly one survivor
  assert.equal(result.filter(event => /pet night/i.test(event.title)).length, 1, 'Pet Night cluster → 1');
  assert.equal(result.filter(event => /gear night/i.test(event.title)).length, 1, 'Gear Night chain of 3 → 1');
  assert.equal(result.filter(event => /stevie licks/i.test(event.title)).length, 1, 'Karaoke pair → 1');
  assert.equal(result.filter(event => /frequency/i.test(event.title)).length, 1, 'FREQUENCY pair → 1');
  assert.equal(result.filter(event => /singlet|thighs/i.test(event.title)).length, 1, 'Singlet pair → 1');
  // Fail-closed keeps: the different-night "Karaoke" and the two real events
  assert.ok(titles.includes('Karaoke'), 'the Jul 24 "Karaoke" is a different night — kept');
  assert.ok(titles.includes('Underwear Night and Contest with DJ Michael Jon'), 'real event kept');
  assert.ok(titles.includes('UNDERWEAR HAPPY HOUR'), 'real same-night event with disjoint title kept');
  // Enrichment flowed through the existing merge machinery
  const karaoke = result.find(event => /stevie licks/i.test(event.title));
  assert.equal(karaoke.cover, 'No cover', 'secondary cover enriches the Karaoke primary');
  assert.equal(karaoke.startDate.toISOString(), '2026-07-31T00:00:00.000Z', 'timezone-anchored start wins over wall-clock');
  const pet = result.find(event => /pet night/i.test(event.title));
  assert.equal(pet.image, 'https://img.example/pet.jpg', 'secondary image enriches the Pet Night primary');
});

// ---------------------------------------------------------------------------
// venue-site-identity barSource plumbing: the stamp is corroborated in the
// merge demotion rung, and a correction renders its evidence line.
// ---------------------------------------------------------------------------

test('venue-site-identity: corroborated in the bar demotion rung and rendered in evidence lines', () => {
  const core = createCore();
  // Demotion rung: an identity-stamped bar beats an uncorroborated one
  const context = {
    records: {
      a: { bar: 'Massive', barSource: 'venue-site-identity' },
      b: { bar: 'Shore Thing', barSource: 'uncorroborated' }
    }
  };
  assert.deepEqual(
    core.resolveConflictDeterministically('bar', 'Massive', 'Shore Thing', context),
    { winner: 'a', reason: 'corroborated bar beats uncorroborated' });

  // Evidence panel: corroboration verdict + the correction line
  const lines = core.buildEventEvidenceLines({
    title: 'PERVERT',
    bar: 'Massive',
    barSource: 'venue-site-identity',
    _venueIdentityCorrection: {
      original: 'Villa Señor',
      originalSource: 'uncorroborated',
      signals: ['venue-role', 'curated-name', 'address-consensus']
    }
  }, { cityKey: 'seattle' });
  assert.ok(lines.includes('bar corroborated: venue-site-identity'), `got: ${JSON.stringify(lines)}`);
  assert.ok(lines.includes('bar corrected to venue-site identity — extracted "Villa Señor" (uncorroborated)'),
    `got: ${JSON.stringify(lines)}`);
  assert.ok(lines.includes('provenance: bar=venue-site-identity'));

  // A missing original source renders as unstamped, never as an empty label
  const unstampedLines = core.buildEventEvidenceLines({
    title: 'PACK',
    bar: 'Massive',
    _venueIdentityCorrection: { original: 'Shore Thing', originalSource: '', signals: [] }
  }, { cityKey: 'seattle' });
  assert.ok(unstampedLines.includes('bar corrected to venue-site identity — extracted "Shore Thing" (unstamped)'));
});

// ---------------------------------------------------------------------------
// Overlong-field trim pipeline: detection is pure, trimming is one batched AI
// call per event gated on VERBATIM contiguous substrings, and every outcome
// (trimmed / would-trim / failed-gate) is stamped on _fieldTrims and rendered
// in the evidence panel. Never a deterministic mid-word truncation.
// ---------------------------------------------------------------------------

// 74 characters, trims to the 7-char brand "D>U>R>O" (title p99=72, max=74).
const OVERLONG_TITLE = 'D>U>R>O — Precinct DTLA Los Angeles — Saturday — SOLD OUT — merch inside!!';

function buildTrimParserConfig(trimOverrides = {}) {
  return {
    name: 'Trim Test',
    ai: {
      enabled: true,
      provider: 'openai',
      endpoint: 'http://rybook.example:8000/v1/chat/completions',
      model: 'test-model',
      openai: {},
      trim: { mode: 'enforce', ...trimOverrides }
    }
  };
}

function buildTrimAnswerAdapter(content, calls = []) {
  return {
    postJson: async (endpoint, payload) => {
      calls.push({ endpoint, payload });
      return { ok: true, status: 200, text: buildOpenAiResponsePayload(content) };
    }
  };
}

test('getTrimConfig defaults: unset/invalid mode → report with the documented limits', () => {
  const core = createCore();
  assert.deepEqual(core.getTrimConfig(null), {
    mode: 'report',
    limits: { title: 60, description: 600, shortName: 30 }
  });
  assert.equal(core.getTrimConfig({ ai: { trim: { mode: 'ENFORCE' } } }).mode, 'enforce');
  assert.equal(core.getTrimConfig({ ai: { trim: { mode: 'bogus' } } }).mode, 'report');
  assert.equal(core.getTrimConfig({ ai: { trim: { mode: 'off' } } }).mode, 'off');
});

test('findOverlongFields: under-limit events are empty, overlong titles are detected, per-parser limits override', () => {
  const core = createCore();
  assert.equal(OVERLONG_TITLE.length, 74, 'fixture must match the real-world max');

  const defaults = core.getTrimConfig(buildTrimParserConfig());
  assert.deepEqual(core.findOverlongFields({ title: 'FURBALL', description: 'short', shortName: 'FUR' }, defaults), []);

  const overlong = core.findOverlongFields({ title: OVERLONG_TITLE }, defaults);
  assert.deepEqual(overlong, [{ field: 'title', value: OVERLONG_TITLE, maxChars: 60 }]);

  // A per-parser titleMaxChars above the value's length silences the finding
  const relaxed = core.getTrimConfig(buildTrimParserConfig({ titleMaxChars: 100 }));
  assert.deepEqual(core.findOverlongFields({ title: OVERLONG_TITLE }, relaxed), []);

  // shortName is the canonical target (shorttitle is only a notes alias)
  const shortNames = core.findOverlongFields({ shortName: 'AN ABSURDLY LONG SHORT NAME FOR A PARTY' }, defaults);
  assert.equal(shortNames.length, 1);
  assert.equal(shortNames[0].field, 'shortName');
  assert.equal(shortNames[0].maxChars, 30);
});

test('isVerbatimTrimAnswer: case-sensitive contiguous substring, non-empty, within limit, strictly shorter', () => {
  const core = createCore();
  assert.equal(core.isVerbatimTrimAnswer(OVERLONG_TITLE, 'D>U>R>O', 60), true);
  assert.equal(core.isVerbatimTrimAnswer(OVERLONG_TITLE, 'd>u>r>o', 60), false, 're-cased answers fail');
  assert.equal(core.isVerbatimTrimAnswer(OVERLONG_TITLE, '', 60), false, 'empty answers fail');
  assert.equal(core.isVerbatimTrimAnswer(OVERLONG_TITLE, OVERLONG_TITLE, 90), false, 'not-shorter answers fail');
  assert.equal(core.isVerbatimTrimAnswer(OVERLONG_TITLE, 'D>U>R>O — Precinct DTLA', 10), false, 'over-limit answers fail');
  assert.equal(core.isVerbatimTrimAnswer(OVERLONG_TITLE, 'DURO at Precinct', 60), false, 'paraphrases fail');
});

test('trimOverlongFieldsForEvent replaces a verbatim answer in enforce mode and stamps _fieldTrims', async () => {
  const core = createCore();
  const parserConfig = buildTrimParserConfig();
  const trimConfig = core.getTrimConfig(parserConfig);
  const calls = [];
  const adapter = buildTrimAnswerAdapter('{"trims":{"title":{"value":"D>U>R>O","reason":"brand name"}}}', calls);

  const event = { title: OVERLONG_TITLE, description: 'fine', city: 'dallas' };
  const records = await core.trimOverlongFieldsForEvent(event, trimConfig, buildAiTestConfig(), adapter);

  assert.equal(event.title, 'D>U>R>O', 'enforce mode replaces the value');
  assert.equal(calls.length, 1, 'one batched request per event');
  assert.ok(String(calls[0].payload.messages[0].content).includes('You are shortening overlong text fields for one event.'));
  assert.deepEqual(records, event._fieldTrims);
  assert.equal(records.length, 1);
  assert.equal(records[0].field, 'title');
  assert.equal(records[0].status, 'trimmed');
  assert.equal(records[0].originalLength, 74);
  assert.equal(records[0].trimmedLength, 7);
  assert.equal(records[0].trimmedValue, 'D>U>R>O');
});

test('trimOverlongFieldsForEvent keeps the original on paraphrased, re-cased, or over-limit answers (failed-gate)', async () => {
  const core = createCore();
  const trimConfig = core.getTrimConfig(buildTrimParserConfig());
  for (const badAnswer of ['DURO at Precinct DTLA', 'd>u>r>o', OVERLONG_TITLE]) {
    const adapter = buildTrimAnswerAdapter(JSON.stringify({ trims: { title: { value: badAnswer } } }));
    const event = { title: OVERLONG_TITLE };
    const records = await core.trimOverlongFieldsForEvent(event, trimConfig, buildAiTestConfig(), adapter);
    assert.equal(event.title, OVERLONG_TITLE, `original kept for answer ${JSON.stringify(badAnswer)}`);
    assert.equal(records[0].status, 'failed-gate');
    assert.equal(records[0].originalLength, 74);
    assert.equal(records[0].maxChars, 60);
  }

  // No usable response at all → failed-gate, original kept, never truncated
  const emptyAdapter = { postJson: async () => ({ ok: true, status: 200, text: buildOpenAiResponsePayload('') }) };
  const event = { title: OVERLONG_TITLE };
  const records = await core.trimOverlongFieldsForEvent(event, trimConfig, buildAiTestConfig(), emptyAdapter);
  assert.equal(event.title, OVERLONG_TITLE);
  assert.equal(records[0].status, 'failed-gate');
});

test('trimOverlongFieldsForEvent report mode records would-trim without changing the value', async () => {
  const core = createCore();
  const trimConfig = core.getTrimConfig(buildTrimParserConfig({ mode: 'report' }));
  const adapter = buildTrimAnswerAdapter('{"trims":{"title":{"value":"D>U>R>O"}}}');
  const event = { title: OVERLONG_TITLE };
  const records = await core.trimOverlongFieldsForEvent(event, trimConfig, buildAiTestConfig(), adapter);
  assert.equal(event.title, OVERLONG_TITLE, 'report mode never mutates');
  assert.equal(records[0].status, 'would-trim');
  assert.equal(records[0].trimmedValue, 'D>U>R>O');
});

test('applyOverlongFieldTrims: mode off and under-limit events make zero AI calls', async () => {
  const core = createCore();
  const calls = [];
  const adapter = buildTrimAnswerAdapter('{"trims":{}}', calls);

  const offEvents = [{ title: OVERLONG_TITLE }];
  await core.applyOverlongFieldTrims(offEvents, buildTrimParserConfig({ mode: 'off' }), adapter);
  assert.equal(calls.length, 0, 'mode off never calls the AI');
  assert.equal(offEvents[0]._fieldTrims, undefined);
  assert.equal(offEvents[0].title, OVERLONG_TITLE);

  await core.applyOverlongFieldTrims([{ title: 'FURBALL' }], buildTrimParserConfig(), adapter);
  assert.equal(calls.length, 0, 'nothing overlong never calls the AI');

  // AI unavailable (no adapter) → no calls, no records
  const noAdapterEvents = [{ title: OVERLONG_TITLE }];
  await core.applyOverlongFieldTrims(noAdapterEvents, buildTrimParserConfig(), null);
  assert.equal(noAdapterEvents[0]._fieldTrims, undefined);
});

test('applyOverlongFieldTrims shares the AI response cache: two identical runs, one transport call', async () => {
  const core = createCore();
  const store = new Map();
  core.aiResponseCache = {
    read: async (aiConfig, prompt) => store.get(prompt) || null,
    write: async (aiConfig, prompt, passLabel, text) => { store.set(prompt, text); },
    stats: { hits: 0, misses: 0, writes: 0 }
  };
  const calls = [];
  const adapter = buildTrimAnswerAdapter('{"trims":{"title":{"value":"D>U>R>O"}}}', calls);
  const parserConfig = buildTrimParserConfig();

  const firstRun = [{ title: OVERLONG_TITLE }];
  await core.applyOverlongFieldTrims(firstRun, parserConfig, adapter);
  assert.equal(firstRun[0].title, 'D>U>R>O');

  const secondRun = [{ title: OVERLONG_TITLE }];
  await core.applyOverlongFieldTrims(secondRun, parserConfig, adapter);
  assert.equal(secondRun[0].title, 'D>U>R>O');
  assert.equal(calls.length, 1, 'the second run must be served from the cache');
});

test('buildEventEvidenceLines renders the trimmed, would-trim, and failed-gate shapes', () => {
  const core = createCore();
  const lines = core.buildEventEvidenceLines({
    title: 'D>U>R>O',
    _fieldTrims: [
      { field: 'title', status: 'trimmed', originalLength: 74, trimmedLength: 7, trimmedValue: 'D>U>R>O', maxChars: 60 },
      { field: 'description', status: 'would-trim', originalLength: 846, trimmedLength: 491, trimmedValue: 'Doors at 9.', maxChars: 600 },
      { field: 'shortName', status: 'failed-gate', originalLength: 39, maxChars: 30 }
    ]
  }, { cityKey: 'dallas' });
  assert.ok(lines.includes('title trimmed: 74 → 7 chars — "D>U>R>O"'), `got: ${JSON.stringify(lines)}`);
  assert.ok(lines.includes('description would trim: 846 → 491 chars — "Doors at 9." (report mode)'), `got: ${JSON.stringify(lines)}`);
  assert.ok(lines.includes('⚠️ shortName overlong (39 > 30 chars) — trim failed verbatim gate, original kept'), `got: ${JSON.stringify(lines)}`);
});

test('_fieldTrims survives createFinalEventObject like _organizer', async () => {
  const core = createCore();
  const fieldTrims = [{ field: 'title', status: 'would-trim', originalLength: 74, trimmedLength: 7, trimmedValue: 'D>U>R>O', maxChars: 60 }];
  const scraped = buildScrapedEvent({ _fieldTrims: fieldTrims });
  const finalEvent = await core.createFinalEventObject(buildCalendarEvent(), scraped, {});
  assert.deepEqual(finalEvent._fieldTrims, fieldTrims);
});

test('_promoter and _organizer survive createFinalEventObject like _fieldTrims', async () => {
  const core = createCore();
  const scraped = buildScrapedEvent({ _promoter: 'Goldiloxx', _organizer: 'Goldiloxx' });
  const finalEvent = await core.createFinalEventObject(buildCalendarEvent(), scraped, {});
  assert.equal(finalEvent._promoter, 'Goldiloxx', 'enforce-mode registry stamp stays on the final analyzed event');
  assert.equal(finalEvent._organizer, 'Goldiloxx');
});

// ---------------------------------------------------------------------------
// Final trim pass (applyFinalOverlongFieldTrims): the per-parser trim runs
// BEFORE dedup/merge, so a merge that keeps the longer side resurrects the
// untrimmed value on the FINAL analyzed object — the final pass re-trims it.
// ---------------------------------------------------------------------------

const TRIMMED_TITLE_RECORD = Object.freeze({
  field: 'title', status: 'trimmed', originalLength: 74, trimmedLength: 7, trimmedValue: 'D>U>R>O', maxChars: 60
});

// Calendar adapter for final-trim tests: canned existing events plus a
// postJson transport that answers the trim prompt (and counts calls).
function buildFinalTrimAdapter(records, trimCalls = []) {
  const adapter = buildPrepCalendarAdapter(records);
  adapter.postJson = async (endpoint, payload) => {
    trimCalls.push({ endpoint, payload });
    return { ok: true, status: 200, text: buildOpenAiResponsePayload('{"trims":{"title":{"value":"D>U>R>O"}}}') };
  };
  return adapter;
}

function buildFinalTrimScrapedEvent(overrides = {}) {
  return {
    title: 'D>U>R>O',
    startDate: new Date('2026-08-08T02:00:00.000Z'),
    endDate: new Date('2026-08-08T07:00:00.000Z'),
    bar: 'Precinct DTLA',
    city: 'dallas',
    ticketUrl: 'https://tickets.example/duro-la',
    // shortName present so the shortName derivation pass stays inert —
    // these tests count TRIM AI calls only.
    shortName: 'DURO',
    _parserConfig: buildTrimParserConfig(),
    _fieldTrims: [{ ...TRIMMED_TITLE_RECORD }],
    ...overrides
  };
}

test('final trim pass: a merge that resurrects the untrimmed title is re-trimmed on the analyzed event', async () => {
  const core = createCore();
  const calendarRecord = {
    title: OVERLONG_TITLE, // upsert keeps the calendar title → 74 chars come back post-merge
    startDate: new Date('2026-08-08T02:00:00.000Z'),
    endDate: new Date('2026-08-08T07:00:00.000Z'),
    location: '',
    notes: 'bar: Precinct DTLA\nticketUrl: https://tickets.example/duro-la'
  };
  const trimCalls = [];
  const adapter = buildFinalTrimAdapter([calendarRecord], trimCalls);
  const scraped = buildFinalTrimScrapedEvent();

  const analyzed = await core.prepareEventsForCalendar([scraped], adapter, {});

  assert.equal(analyzed.length, 1);
  assert.equal(analyzed[0]._action, 'merge');
  assert.equal(analyzed[0].title, 'D>U>R>O', 'the final analyzed title is the trimmed form, within the limit');
  assert.equal(trimCalls.length, 1, 'one trim call for the resurrected overlong title');
  assert.ok(String(trimCalls[0].payload.messages[0].content).includes('You are shortening overlong text fields for one event.'));

  // The final-pass record REPLACES the pre-merge title record — never a duplicate
  const titleRecords = analyzed[0]._fieldTrims.filter(record => record.field === 'title');
  assert.equal(titleRecords.length, 1);
  assert.equal(titleRecords[0].status, 'trimmed');
  assert.equal(titleRecords[0].originalLength, 74);
  assert.equal(titleRecords[0].trimmedValue, 'D>U>R>O');
  assert.ok(analyzed[0]._evidenceLines.includes('title trimmed: 74 → 7 chars — "D>U>R>O"'),
    `got: ${JSON.stringify(analyzed[0]._evidenceLines)}`);
});

test('final trim pass is idempotent: a pre-merge trim that survived the merge makes zero AI calls and keeps one record', async () => {
  const core = createCore();
  const calendarRecord = {
    title: 'D>U>R>O', // calendar already carries the trimmed form — nothing overlong post-merge
    startDate: new Date('2026-08-08T02:00:00.000Z'),
    endDate: new Date('2026-08-08T07:00:00.000Z'),
    location: '',
    notes: 'bar: Precinct DTLA\nticketUrl: https://tickets.example/duro-la'
  };
  const trimCalls = [];
  const adapter = buildFinalTrimAdapter([calendarRecord], trimCalls);
  const scraped = buildFinalTrimScrapedEvent();

  const analyzed = await core.prepareEventsForCalendar([scraped], adapter, {});

  assert.equal(analyzed.length, 1);
  assert.equal(analyzed[0]._action, 'merge');
  assert.equal(analyzed[0].title, 'D>U>R>O');
  assert.equal(trimCalls.length, 0, 'an under-limit final value never calls the AI');
  assert.deepEqual(analyzed[0]._fieldTrims, [TRIMMED_TITLE_RECORD], 'the pre-merge record is kept, no duplicates');
});

test('final trim pass: NEW-path events keep their pre-merge trim untouched (no AI calls)', async () => {
  const core = createCore();
  const trimCalls = [];
  const adapter = buildFinalTrimAdapter([], trimCalls); // no existing events → action new
  const scraped = buildFinalTrimScrapedEvent();

  const analyzed = await core.prepareEventsForCalendar([scraped], adapter, {});

  assert.equal(analyzed.length, 1);
  assert.equal(analyzed[0]._action, 'new');
  assert.equal(analyzed[0].title, 'D>U>R>O');
  assert.equal(trimCalls.length, 0);
  assert.deepEqual(analyzed[0]._fieldTrims, [TRIMMED_TITLE_RECORD]);
});

test('final trim pass: an action without scraped contribution is flagged, never AI-trimmed', async () => {
  const core = createCore();
  const trimCalls = [];
  const adapter = buildFinalTrimAdapter([], trimCalls);
  // 'conflict' is the no-scraped-contribution shape at prep time (the pure
  // calendar-side preserve of the record's values): the final pass must not
  // fire — the detection-only evidence flag covers visibility.
  const event = {
    title: OVERLONG_TITLE,
    startDate: new Date('2026-08-08T02:00:00.000Z'),
    city: 'dallas',
    // shortName present so the shortName derivation pass stays inert —
    // this test counts TRIM AI calls only.
    shortName: 'DURO',
    _parserConfig: buildTrimParserConfig()
  };
  const analysis = { action: 'conflict', reason: 'Identifier match not found', sourceEvent: null, overrideIdentity: null };

  const analyzedEvent = await core.buildAnalyzedCalendarEvent(event, analysis, adapter, {});

  assert.equal(analyzedEvent._action, 'conflict');
  assert.equal(analyzedEvent.title, OVERLONG_TITLE, 'value untouched');
  assert.equal(trimCalls.length, 0, 'no AI call for a preserve-shaped action');
  assert.ok(analyzedEvent._evidenceLines.includes('⚠️ title overlong (74 > 60 chars) — calendar-sourced, not trimmed'),
    `got: ${JSON.stringify(analyzedEvent._evidenceLines)}`);
});

test('applyFinalOverlongFieldTrims merges records: a re-trim replaces the same field, other fields keep theirs', async () => {
  const core = createCore();
  const trimCalls = [];
  const adapter = buildTrimAnswerAdapter('{"trims":{"title":{"value":"D>U>R>O"}}}', trimCalls);
  const event = {
    title: OVERLONG_TITLE,
    _fieldTrims: [
      { field: 'title', status: 'trimmed', originalLength: 74, trimmedLength: 7, trimmedValue: 'D>U>R>O', maxChars: 60 },
      { field: 'shortName', status: 'trimmed', originalLength: 39, trimmedLength: 7, trimmedValue: 'D>U>R>O', maxChars: 30 }
    ]
  };

  const records = await core.applyFinalOverlongFieldTrims(event, buildTrimParserConfig(), adapter);

  assert.equal(event.title, 'D>U>R>O');
  assert.equal(records.length, 1);
  assert.equal(trimCalls.length, 1);
  assert.equal(event._fieldTrims.length, 2, 'shortName record kept, title record replaced');
  assert.equal(event._fieldTrims.filter(record => record.field === 'title').length, 1);
  assert.ok(event._fieldTrims.some(record => record.field === 'shortName' && record.trimmedLength === 7));
});

test('deterministic rung: trimmed title beats its own untrimmed superset, both directions', () => {
  const core = createCore();
  const trimRecords = [{ ...TRIMMED_TITLE_RECORD }];

  const scrapedSide = core.resolveConflictDeterministically('title', OVERLONG_TITLE, 'D>U>R>O',
    { records: { a: {}, b: { _fieldTrims: trimRecords } } });
  assert.deepEqual(scrapedSide, { winner: 'b', reason: 'trimmed title beats its own untrimmed superset' });

  const mirrored = core.resolveConflictDeterministically('title', 'D>U>R>O', OVERLONG_TITLE,
    { records: { a: { _fieldTrims: trimRecords }, b: {} } });
  assert.deepEqual(mirrored, { winner: 'a', reason: 'trimmed title beats its own untrimmed superset' });
});

test('deterministic rung: non-substring pairs and unattributed supersets fall through to arbitration', () => {
  const core = createCore();
  const trimRecords = [{ ...TRIMMED_TITLE_RECORD }];

  // The trimmed side's value is NOT a substring of the other title → no rung
  assert.equal(core.resolveConflictDeterministically('title', 'Completely different night', 'D>U>R>O',
    { records: { a: {}, b: { _fieldTrims: trimRecords } } }), null);

  // A superset pair WITHOUT a trim record never triggers the rung (strict attribution)
  assert.equal(core.resolveConflictDeterministically('title', OVERLONG_TITLE, 'D>U>R>O',
    { records: { a: {}, b: {} } }), null);

  // A trim record for a DIFFERENT value than the candidate does not vouch for it
  assert.equal(core.resolveConflictDeterministically('title', OVERLONG_TITLE, 'D>U>R>O — Precinct DTLA',
    { records: { a: {}, b: { _fieldTrims: trimRecords } } }), null);
});

// ---------------------------------------------------------------------------
// Active-config summary: pure builders behind the results-UI "Active config"
// section — effective global values, per-parser override diffs (only
// explicitly-set values that differ), and a secret-redacted copy payload.
// ---------------------------------------------------------------------------

function buildActiveConfigFixture() {
  return {
    config: {
      daysToLookAhead: 30,
      dryRun: true,
      pageCache: { enabled: true, ttlDays: 3 },
      geocodeVerification: { mode: 'enforce' },
      ai: {
        enabled: true,
        provider: 'openai',
        endpoint: 'http://rybook.example:8000/v1/chat/completions',
        model: 'global-model',
        apiKey: 'super-secret-global',
        bearCheck: { mode: 'enforce' },
        trim: { mode: 'report', titleMaxChars: 60 }
      },
      ocr: {
        enabled: true,
        endpoint: 'http://rybook.example:8001/v1/chat/completions',
        model: 'vision-model',
        maxImages: 2,
        cache: true,
        cacheRetentionDays: 90
      }
    },
    parsers: [
      {
        name: 'Megawoof America',
        enabled: true,
        parser: 'ai-web',
        urls: ['https://www.eventbrite.com/o/megawoof-america'],
        alwaysBear: true,
        ai: {
          model: 'parser-model',
          endpoint: 'http://rybook.example:8000/v1/chat/completions',
          apiKey: 'super-secret-parser'
        }
      },
      { name: 'Furball', enabled: false, urls: ['https://furball.nyc'] }
    ]
  };
}

test('buildActiveConfigSummary surfaces effective global values and parser identity', () => {
  const core = createCore();
  const summary = core.buildActiveConfigSummary(buildActiveConfigFixture());

  assert.equal(summary.global.daysToLookAhead, 30);
  assert.equal(summary.global.dryRun, true);
  assert.deepEqual(summary.global.pageCache, { enabled: true, ttlDays: 3 });
  assert.equal(summary.global.geocodeVerification.mode, 'enforce');
  assert.equal(summary.global.ai.model, 'global-model');
  assert.equal(summary.global.ai.provider, 'openai');
  assert.equal(summary.global.ai.bearCheck.mode, 'enforce');
  assert.deepEqual(summary.global.ai.trim, {
    mode: 'report',
    limits: { title: 60, description: 600, shortName: 30 }
  });
  assert.equal(summary.global.ocr.model, 'vision-model');
  assert.equal(summary.global.ocr.maxImages, 2);

  assert.equal(summary.parsers.length, 2);
  assert.equal(summary.parsers[0].name, 'Megawoof America');
  assert.equal(summary.parsers[0].enabled, true);
  assert.equal(summary.parsers[0].parser, 'ai-web');
  assert.deepEqual(summary.parsers[0].urls, ['https://www.eventbrite.com/o/megawoof-america']);
  assert.equal(summary.parsers[1].enabled, false);
});

test('buildActiveConfigSummary overrides contain ONLY explicitly-set values that differ from global', () => {
  const core = createCore();
  const summary = core.buildActiveConfigSummary(buildActiveConfigFixture());
  const overrides = summary.parsers[0].overrides;

  assert.deepEqual(overrides['ai.model'], { value: 'parser-model', globalValue: 'global-model' });
  assert.deepEqual(overrides.alwaysBear, { value: true, globalValue: undefined });
  assert.equal(overrides['ai.endpoint'], undefined, 'same-as-global values are not overrides');
  assert.equal(overrides['ai.provider'], undefined, 'unset parser keys are not overrides');
  assert.deepEqual(summary.parsers[1].overrides, {}, 'a parser with no explicit knobs has no overrides');
});

test('buildActiveConfigSummary redacts secrets from the rendered structures and the copy JSON', () => {
  const core = createCore();
  const summary = core.buildActiveConfigSummary(buildActiveConfigFixture());

  assert.ok(!summary.json.includes('super-secret-global'), 'global secrets never reach the copy payload');
  assert.ok(!summary.json.includes('super-secret-parser'), 'parser secrets never reach the copy payload');
  assert.equal(summary.parsers[0].overrides['ai.apiKey'], '•••', 'credential-shaped override keys are masked');

  // The recursive scrub itself: credential-shaped keys at any depth
  assert.deepEqual(
    core.redactConfigSecrets({ apiKey: 'x', nested: { authToken: 'y', list: [{ password: 'z' }] }, model: 'ok' }),
    { apiKey: '•••', nested: { authToken: '•••', list: [{ password: '•••' }] }, model: 'ok' }
  );
});

test('flattenConfigForDiff walks plain objects and stringifies arrays/regexes as leaves', () => {
  const core = createCore();
  assert.deepEqual(
    core.flattenConfigForDiff({ ai: { model: 'm', openai: { responseFormat: 'json_object' } }, list: [1, 2], pattern: /furball/i }),
    { 'ai.model': 'm', 'ai.openai.responseFormat': 'json_object', list: '1,2', pattern: '/furball/i' }
  );
  assert.deepEqual(core.flattenConfigForDiff(null), {});
});

// ---------------------------------------------------------------------------
// Curated promoter registry: SharedCore.matchEventToPromoter +
// applyPromoterRegistryMatches (data/promoters.json injected like bars).
// ---------------------------------------------------------------------------

const REGISTRY_FIXTURE = [
  {
    name: 'Bearracuda',
    aliases: ['Bearracuda Events'],
    shortName: 'Bear-rac-uda',
    instagram: 'https://www.instagram.com/bearracuda',
    website: 'https://bearracuda.com/',
    urlPatterns: ['bearracuda.com', 'eventbrite.com/o/bearracuda-21867032189'],
    bearAffinity: 'usually'
  },
  {
    name: 'Coach After Dark',
    shortName: 'COACH',
    instagram: 'https://www.instagram.com/coachafterdark',
    bearAffinity: 'always'
  },
  {
    name: 'BEEFWITCH',
    parent: 'Coach After Dark',
    keywords: ['beefwitch'],
    shortName: 'BEEFWITCH',
    instagram: 'https://www.instagram.com/thebeefwitch',
    bearAffinity: 'always'
  },
  {
    name: 'Goldiloxx',
    shortName: 'GOLDI-LOXX',
    shorterName: 'GLX',
    instagram: 'https://www.instagram.com/goldiloxx__',
    matchKey: 'goldiloxx*|${year}-${month}-*|*',
    urlPatterns: ['goldiloxx'],
    bearAffinity: 'always'
  },
  // Family-stem pair for the fail-closed guard: "Eagle Party" is contained in
  // "Dallas Eagle Party"'s key, so title containment must refuse the stem.
  { name: 'Eagle Party', bearAffinity: 'always' },
  { name: 'Dallas Eagle Party', bearAffinity: 'always' }
];

function createRegistryCore(promoters = REGISTRY_FIXTURE) {
  return new SharedCore(CITIES, { eventSchema: EventSchema, promoters });
}

const ENFORCE_REGISTRY_CONFIG = { config: { promoterRegistry: { mode: 'enforce' } } };
const REPORT_REGISTRY_CONFIG = { config: { promoterRegistry: { mode: 'report' } } };

test('promoter registry mode reader mirrors getBearCheckMode (unset/invalid → report)', () => {
  const core = createRegistryCore();
  assert.equal(core.getPromoterRegistryMode({}), 'report');
  assert.equal(core.getPromoterRegistryMode(null), 'report');
  assert.equal(core.getPromoterRegistryMode({ config: { promoterRegistry: { mode: 'ENFORCE' } } }), 'enforce');
  assert.equal(core.getPromoterRegistryMode({ config: { promoterRegistry: { mode: 'off' } } }), 'off');
  assert.equal(core.getPromoterRegistryMode({ config: { promoterRegistry: { mode: 'bogus' } } }), 'report');
});

test('the repo scraper-input config resolves the promoter registry to enforce mode', () => {
  // Flipped 2026-07-28 after the verification battery (37 matches, 0 false
  // positives): the shipped config must resolve to enforce, so a regression
  // back to report (or a typo'd mode falling back to report) fails here.
  const core = createCore();
  const repoConfig = require('./scraper-input');
  assert.equal(core.getPromoterRegistryMode(repoConfig), 'enforce');
});

test('matcher: padded-token title containment matches a full name, never a bare substring', () => {
  const core = createRegistryCore();
  const match = core.matchEventToPromoter({ title: 'Bearracuda Atlanta 17 Year Anniversary' });
  assert.equal(match.entry.name, 'Bearracuda');
  assert.equal(match.evidence, 'title');
  // Smooshed brand text is NOT a padded token hit
  assert.equal(core.matchEventToPromoter({ title: 'MEGABearracudathon' }), null);
});

test('matcher: alias equality on _organizer wins as organizer evidence (brand variants included)', () => {
  const core = createRegistryCore();
  const viaAlias = core.matchEventToPromoter({ title: 'PRIDE FRIDAY', _organizer: 'Bearracuda Events' });
  assert.equal(viaAlias.entry.name, 'Bearracuda');
  assert.equal(viaAlias.evidence, 'organizer');
  const viaSuffix = core.matchEventToPromoter({ title: 'PRIDE FRIDAY', _organizer: 'Bearracuda, Inc.' });
  assert.equal(viaSuffix.entry.name, 'Bearracuda');
  assert.equal(viaSuffix.evidence, 'organizer');
});

test('matcher: a family-stem name key fails closed for title containment but organizer equality still works', () => {
  const core = createRegistryCore();
  // "eagleparty" ⊂ "dallaseagleparty" → title containment refused for the stem
  assert.equal(core.matchEventToPromoter({ title: 'Eagle Party Karaoke Night' }), null);
  // The longer, unique name still title-matches
  const longMatch = core.matchEventToPromoter({ title: 'Dallas Eagle Party: Singlet Night' });
  assert.equal(longMatch.entry.name, 'Dallas Eagle Party');
  // Organizer equality is exempt from the stem guard
  const organizerMatch = core.matchEventToPromoter({ title: 'Karaoke', _organizer: 'Eagle Party' });
  assert.equal(organizerMatch.entry.name, 'Eagle Party');
  assert.equal(organizerMatch.evidence, 'organizer');
});

test('matcher: two unrelated entries matching → ambiguous, and the pass stamps nothing', () => {
  const core = createRegistryCore();
  const event = {
    title: 'Bearracuda x Goldiloxx Takeover',
    startDate: new Date('2026-08-01T21:00:00.000Z')
  };
  const match = core.matchEventToPromoter(event);
  assert.ok(match.ambiguous, 'unrelated double match must be ambiguous');
  assert.deepEqual([...match.ambiguous].sort(), ['Bearracuda', 'Goldiloxx']);

  const before = JSON.parse(JSON.stringify(event));
  core.applyPromoterRegistryMatches([event], { name: 'p' }, ENFORCE_REGISTRY_CONFIG);
  assert.deepEqual(JSON.parse(JSON.stringify(event)), before, 'ambiguity changes nothing');
});

test('matcher: BEEFWITCH keyword beats its matched parent (child wins)', () => {
  const core = createRegistryCore();
  const match = core.matchEventToPromoter({
    title: 'BEEFWITCH: Hex The Patriarchy',
    _organizer: 'Coach After Dark'
  });
  assert.equal(match.entry.name, 'BEEFWITCH');
});

test('matcher: URL evidence covers event URLs and _sourcePageUrl via urlPatterns and own-handle tokens', () => {
  const core = createRegistryCore();
  const viaPattern = core.matchEventToPromoter({
    title: 'Some Party',
    ticketUrl: 'https://www.eventbrite.com/o/bearracuda-21867032189'
  });
  assert.equal(viaPattern.entry.name, 'Bearracuda');
  assert.equal(viaPattern.evidence, 'url:eventbrite.com/o/bearracuda-21867032189');
  const viaInstagram = core.matchEventToPromoter({
    title: 'Some Party',
    instagram: 'https://www.instagram.com/coachafterdark'
  });
  assert.equal(viaInstagram.entry.name, 'Coach After Dark');
  // Description is never evidence
  assert.equal(core.matchEventToPromoter({ title: 'Some Party', description: 'by Bearracuda at bearracuda.com' }), null);
});

test('registry pass: no evidence leaves the event byte-untouched in enforce mode', () => {
  const core = createRegistryCore();
  const event = { title: 'Unrelated Concert', startDate: new Date('2026-08-01T21:00:00.000Z'), bar: 'Some Hall' };
  const before = JSON.parse(JSON.stringify(event));
  core.applyPromoterRegistryMatches([event], { name: 'p' }, ENFORCE_REGISTRY_CONFIG);
  assert.deepEqual(JSON.parse(JSON.stringify(event)), before);
});

test('registry pass: report mode matches but stamps nothing', () => {
  const core = createRegistryCore();
  const event = { title: 'Bearracuda Portland: PRIDE FRIDAY', startDate: new Date('2026-08-01T21:00:00.000Z') };
  const before = JSON.parse(JSON.stringify(event));
  core.applyPromoterRegistryMatches([event], { name: 'p' }, REPORT_REGISTRY_CONFIG);
  assert.deepEqual(JSON.parse(JSON.stringify(event)), before, 'report mode changes NOTHING');
  assert.equal(event._promoter, undefined);
});

test('registry pass: enforce stamps _promoter, curated metadata, and a title/url-evidence organizer', () => {
  const core = createRegistryCore();
  const event = { title: 'Bearracuda Portland: PRIDE FRIDAY', startDate: new Date('2026-08-01T21:00:00.000Z') };
  core.applyPromoterRegistryMatches([event], { name: 'p' }, ENFORCE_REGISTRY_CONFIG);
  assert.equal(event._promoter, 'Bearracuda');
  assert.equal(event._organizer, 'Bearracuda', 'empty organizer is backfilled on title/url evidence');
  assert.equal(event.shortName, 'Bear-rac-uda');
  assert.equal(event.instagram, 'https://www.instagram.com/bearracuda');
  assert.equal(event.url, 'https://bearracuda.com/', 'website maps to the canonical url field');
  assert.equal(event._staticFields.shortName, 'Bear-rac-uda');

  // A non-empty organizer is never overwritten
  const organizerEvent = { title: 'Bearracuda Portland', _organizer: 'Somebody Else', startDate: new Date('2026-08-01T21:00:00.000Z') };
  core.applyPromoterRegistryMatches([organizerEvent], { name: 'p' }, ENFORCE_REGISTRY_CONFIG);
  assert.equal(organizerEvent._organizer, 'Somebody Else');
});

test('registry application parity: registry stamp ≡ parser metadata through applyStaticMetadataBlock', () => {
  const core = createRegistryCore();
  const entry = REGISTRY_FIXTURE[0]; // Bearracuda
  const block = core.promoterEntryToMetadataBlock(entry);

  const baseEvent = () => ({ title: 'Portland PRIDE FRIDAY', startDate: new Date('2026-08-01T21:00:00.000Z') });

  // Parser path: the same facts as parser-config metadata
  const viaParser = core.applyFieldPriorities(baseEvent(), { name: 'p', metadata: block }, {});

  // Registry path: bare parser first (no metadata), then the registry stamp
  const viaRegistry = core.applyFieldPriorities(baseEvent(), { name: 'p' }, {});
  core.applyPromoterMetadata(viaRegistry, block);

  const publicFields = (event) => {
    const copy = {};
    Object.keys(event).filter((key) => !key.startsWith('_')).forEach((key) => { copy[key] = event[key]; });
    return copy;
  };
  assert.deepEqual(publicFields(viaRegistry), publicFields(viaParser), 'event fields identical');
  assert.deepEqual(viaRegistry._staticFields, viaParser._staticFields, '_staticFields identical');
  assert.deepEqual(viaRegistry._fieldPriorities, viaParser._fieldPriorities, '_fieldPriorities identical');
});

test('registry sub-brand inherits unspecified metadata fields from its parent', () => {
  const core = createRegistryCore();
  const block = core.promoterEntryToMetadataBlock(core.getPromoterEntryByName('BEEFWITCH'));
  assert.equal(block.shortName.value, 'BEEFWITCH', 'own field wins');
  assert.equal(block.instagram.value, 'https://www.instagram.com/thebeefwitch', 'own field wins');
});

test('registry Goldiloxx matchKey template resolves through the standard metadata machinery', () => {
  const core = createRegistryCore();
  const event = {
    title: 'GOLDILOXX: WOOF',
    startDate: new Date('2026-08-15T21:00:00.000Z'),
    city: 'dallas',
    timezone: 'America/Chicago'
  };
  core.applyPromoterRegistryMatches([event], { name: 'p' }, ENFORCE_REGISTRY_CONFIG);
  assert.equal(event._promoter, 'Goldiloxx');
  assert.equal(event.matchKey, 'goldiloxx*|2026-08-*|*');
  assert.equal(event.shorterName, 'GLX');
});

// Incident fixtures from real runs: platform-hosted events must resolve to the
// promoter their own content names — never to whoever's parser found them.
test('incident: a Goldiloxx-titled event from a redeyetickets URL matches Goldiloxx', () => {
  const registry = require('../data/promoters.json');
  const core = createRegistryCore(registry);
  const match = core.matchEventToPromoter({
    title: 'GOLDILOXX: WOOF',
    url: 'https://redeyetickets.com/events/goldiloxx-woof-dallas'
  });
  assert.equal(match.entry.name, 'Goldiloxx');
});

test('incident: a Bearracuda event found on sickening.events matches Bearracuda, never Goldiloxx', () => {
  const registry = require('../data/promoters.json');
  const core = createRegistryCore(registry);
  const match = core.matchEventToPromoter({
    title: 'Bearracuda New Orleans Halloween',
    _sourcePageUrl: 'https://sickening.events/events/bearracuda-new-orleans-halloween'
  });
  assert.equal(match.entry.name, 'Bearracuda');
});

test('bearAffinity precedence: "usually" overrides alwaysBear into per-event judgment', async () => {
  const core = createRegistryCore();
  const parserConfig = { name: 'p', alwaysBear: true, ai: { enabled: false, bearCheck: { mode: 'enforce' } } };
  // No bear vocabulary, no AI → the cascade falls through to config trust
  const matched = { title: 'HOT TAKE Anniversary', _promoter: 'Bearracuda' };
  const decision = await core.computeBearCheckDecision(matched, parserConfig, null);
  assert.equal(decision.result, 'unsure', 'a usually-promoter event is judged, never config-trusted');

  const unmatched = { title: 'Some Unmarked Rave' };
  const legacy = await core.computeBearCheckDecision(unmatched, parserConfig, null);
  assert.equal(legacy.result, 'bear');
  assert.equal(legacy.provenance, 'config: alwaysBear (ai unavailable)', 'unmatched events keep the exact legacy fallback');
});

test('bearAffinity precedence: "always" trusts a matched event on an untrusted parser (never-drop)', async () => {
  const core = createRegistryCore();
  const parserConfig = { name: 'p', alwaysBear: false, ai: { enabled: false, bearCheck: { mode: 'enforce' } } };
  const matched = { title: 'Hex The Patriarchy', _promoter: 'BEEFWITCH', startDate: new Date('2026-08-01T21:00:00.000Z') };
  const decision = await core.computeBearCheckDecision(matched, parserConfig, null);
  assert.equal(decision.result, 'bear');
  assert.equal(decision.provenance, 'config: promoter BEEFWITCH bearAffinity=always');

  // filterBearEvents: trusted per-event → kept, and never in the drop path
  const drops = [];
  const kept = await core.filterBearEvents([matched], parserConfig, null, drops);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].isBearEvent, true);
  assert.equal(drops.length, 0);

  const unmatchedLegacy = await core.computeBearCheckDecision({ title: 'Some Unmarked Rave' }, parserConfig, null);
  assert.equal(unmatchedLegacy.result, 'unsure', 'unmatched events on an untrusted parser stay judged');
});

test('bear-check provenance: matched promoters gain the ADDITIVE sentence, unmatched stays byte-identical', () => {
  const core = createRegistryCore();
  const parserConfig = { name: 'Bearracuda Events', alwaysBear: true, urls: ['https://bearracuda.com/'] };

  const unmatched = core.buildBearCheckProvenance({ title: 'x', url: 'https://bearracuda.com/events/pdx' }, parserConfig);
  assert.equal(unmatched,
    'Scraped from bearracuda.com, source entry "Bearracuda Events". The calendar owner has marked this promoter as a trusted bear-scene promoter.');

  const matchedAlways = core.buildBearCheckProvenance(
    { title: 'x', url: 'https://bearracuda.com/events/pdx', _promoter: 'BEEFWITCH' }, parserConfig);
  assert.ok(matchedAlways.startsWith(unmatched), 'existing sentences stay byte-identical; the registry sentence is appended');
  assert.ok(matchedAlways.endsWith(' This event\'s own content names the promoter BEEFWITCH, whom the calendar owner has marked as a trusted bear-scene promoter.'));

  const matchedUsually = core.buildBearCheckProvenance(
    { title: 'x', url: 'https://bearracuda.com/events/pdx', _promoter: 'Bearracuda' }, parserConfig);
  assert.ok(matchedUsually.includes('whom the calendar owner tracks as a usually-bear promoter'));
  assert.ok(!matchedUsually.includes('The calendar owner has marked this promoter as a trusted bear-scene promoter.'),
    'a matched "usually" promoter suppresses the parser-level trust claim for THIS event');
});

test('_promoter carries across dedup merges like _organizer', async () => {
  const core = createRegistryCore();
  const existing = { title: 'Bearracuda PDX', startDate: new Date('2026-08-01T21:00:00.000Z'), _promoter: 'Bearracuda', _organizer: 'Bearracuda' };
  const fresh = { title: 'Bearracuda PDX', startDate: new Date('2026-08-01T21:00:00.000Z') };
  const merged = await core.mergeParsedEvents(existing, fresh);
  assert.equal(merged._promoter, 'Bearracuda');
  assert.equal(merged._organizer, 'Bearracuda');
});

// ===========================================================================
// run 20260727-145617 fixes: diacritic folding in city resolution (Fix 1) and
// city-alias tokens in cross-source title dedup (Fix 3)
// ===========================================================================

const MONTREAL_CITIES = {
  montreal: { name: 'Montreal', timezone: 'America/Toronto', patterns: ['montreal', 'mtl'] },
  nyc: { timezone: 'America/New_York', patterns: ['new york', 'nyc'] }
};

function createMontrealCore() {
  return new SharedCore(MONTREAL_CITIES, { eventSchema: EventSchema });
}

test('foldDiacritics: accented city text folds to the config key; unaccented ASCII is byte-identical to lowercase+trim', () => {
  const core = createMontrealCore();
  assert.equal(core.foldDiacritics('montréal'), 'montreal');
  assert.equal(core.foldDiacritics('Montréal'), 'montreal');
  assert.equal(core.foldDiacritics('MONTRÉAL'), 'montreal');
  assert.equal(core.foldDiacritics('  Montreal  '), 'montreal');
  assert.equal(core.foldDiacritics('new york'), 'new york');
  assert.equal(core.foldDiacritics(null), '');
});

test('getCityTimezone: accented "montréal" resolves montreal timezone (literal run city value); unaccented unchanged', () => {
  const core = createMontrealCore();
  // Literal run 20260727-145617 value that failed: city "montréal"
  assert.equal(core.getCityTimezone('montréal'), 'America/Toronto');
  assert.equal(core.getCityTimezone('Montréal'), 'America/Toronto');
  assert.equal(core.getCityTimezone('MONTRÉAL'), 'America/Toronto');
  // Unaccented key and pattern lookups stay byte-identical
  assert.equal(core.getCityTimezone('montreal'), 'America/Toronto');
  assert.equal(core.getCityTimezone('mtl'), 'America/Toronto');
  assert.equal(core.getCityTimezone('nyc'), 'America/New_York');
  assert.equal(core.getCityTimezone('new york'), 'America/New_York');
  // Unknown cities still resolve nothing
  assert.equal(core.getCityTimezone('atlantis'), null);
  assert.equal(core.getCityTimezone(''), null);
});

// Brighton + Birmingham onboarding (BEEFMINCE runs monthly in both; runs
// logged `No timezone config for city "brighton"/"birmingham"`). The cities
// ship visible:false with an empty calendarId — off the website and out of CI
// calendar fetches — but the GENERATED scraper config must already resolve
// their keys, patterns, and timezone.
test('generated cities config: brighton and birmingham resolve to their keys and Europe/London', () => {
  const cities = require('./scraper-cities');
  const core = new SharedCore(cities, { eventSchema: EventSchema });
  for (const cityKey of ['brighton', 'birmingham']) {
    assert.ok(cities[cityKey], `generated scraper-cities carries the ${cityKey} key`);
    assert.equal(cities[cityKey].timezone, 'Europe/London');
    assert.ok(cities[cityKey].coordinates, `${cityKey} carries city-center coordinates`);
  }
  assert.deepEqual(cities.brighton.patterns, ['brighton', 'brighton and hove']);
  assert.deepEqual(cities.birmingham.patterns, ['birmingham']);
  // Key, pattern, and cased/alias variants all resolve the timezone
  assert.equal(core.getCityTimezone('brighton'), 'Europe/London');
  assert.equal(core.getCityTimezone('Brighton'), 'Europe/London');
  assert.equal(core.getCityTimezone('Brighton and Hove'), 'Europe/London');
  assert.equal(core.getCityTimezone('birmingham'), 'Europe/London');
  assert.equal(core.getCityTimezone('Birmingham'), 'Europe/London');
});

test('resolveWallClockDates: city "montréal" re-anchors wall-clock dates via the folded timezone lookup', () => {
  const core = createMontrealCore();
  const event = {
    title: 'Concours PUP MTL',
    city: 'montréal',
    startDate: new Date('2026-07-27T22:00:00.000Z'),
    endDate: new Date('2026-07-27T22:00:00.000Z'),
    _timezoneUnresolved: true
  };
  core.resolveWallClockDates(event);
  // 10pm EDT (UTC-4) = 2am UTC next day — no longer stuck wall-clock UTC
  assert.equal(event.startDate.toISOString(), '2026-07-28T02:00:00.000Z');
  assert.equal(event._timezoneUnresolved, undefined);
});

test('cross-source tokens: city-alias tokens (folded "montréal", "mtl") are stripped; other tokens untouched', () => {
  const core = createMontrealCore();
  // Diacritics fold BEFORE tokenization: "Montréal" is ONE token, then stripped as a city alias
  assert.deepEqual(core.getCrossSourceTitleTokens('Concours PUP Montréal'), ['concours', 'pup']);
  assert.deepEqual(core.getCrossSourceTitleTokens('Concours PUP MTL'), ['concours', 'pup']);
  // Multi-word city names are never token-stripped ("new" and "york" survive)
  assert.deepEqual(core.getCrossSourceTitleTokens('New York Underwear Party'), ['new', 'york', 'underwear', 'party']);
  // Unaffected titles are byte-identical to the pre-fix behavior
  assert.deepEqual(core.getCrossSourceTitleTokens('Singlet Night with DJ Drew G'), ['singlet', 'night']);
});

test('cross-source tokens: city stripping never EMPTIES the significant-token set (fail closed)', () => {
  const core = createMontrealCore();
  // A title that is NOTHING but city names keeps its tokens
  assert.deepEqual(core.getCrossSourceTitleTokens('Montréal'), ['montreal']);
  assert.deepEqual(core.getCrossSourceTitleTokens('MTL'), ['mtl']);
});

test('cross-source signal: literal Concours PUP pair (run 20260727-145617) pairs across the Montréal/MTL title gap', () => {
  const core = createMontrealCore();
  // Faithful shapes: one record carries the venue as its bar, the twin names
  // the venue INSIDE its address while its bar is a different extraction
  const montrealRecord = {
    title: 'Concours PUP Montréal', bar: 'Bain Mathieu', city: 'montreal',
    timezone: 'America/Toronto', startDate: new Date('2026-07-28T02:00:00.000Z')
  };
  const mtlRecord = {
    title: 'Concours PUP MTL', bar: 'Aigle Noir', city: 'montréal',
    address: 'Bain Mathieu, 2915 Rue Ontario E, Montréal, QC H2K 1X7',
    startDate: new Date('2026-07-28T02:00:00.000Z')
  };
  assert.equal(core.getCrossSourceVenueIdentity(montrealRecord, mtlRecord), 'bar-in-address');
  assert.equal(core.getCrossSourceDuplicateSignal(montrealRecord, mtlRecord), 'venue+night+title-subset');
});

test('cross-source venue identity: single-word bar names never match inside addresses (fail closed)', () => {
  const core = createMontrealCore();
  const barRecord = { title: 'Eagle Party', bar: 'Eagle', startDate: new Date('2026-07-28T02:00:00.000Z') };
  const addressRecord = {
    title: 'Eagle Party', address: '500 Eagle Street, Montreal',
    startDate: new Date('2026-07-28T02:00:00.000Z')
  };
  assert.equal(core.getCrossSourceVenueIdentity(barRecord, addressRecord), null);
});

// ---------------------------------------------------------------------------
// Hyphenated tracking params (Fix: Club Chub's Eventbrite links used
// utm-campaign/utm-content, so ticket-url identity never fired and the same
// eventbrite id 1975884326209 appeared twice unmerged)
// ---------------------------------------------------------------------------

test('normalizeTicketUrlForIdentity strips hyphenated utm params exactly like underscore forms', () => {
  const core = createCore();
  const hyphenated = core.normalizeTicketUrlForIdentity(
    'https://www.eventbrite.com/e/club-chub-weekend-2026-tickets-1975884326209?utm-campaign=x&aff=y');
  const underscore = core.normalizeTicketUrlForIdentity(
    'https://www.eventbrite.com/e/club-chub-weekend-2026-tickets-1975884326209?utm_campaign=x');
  assert.equal(hyphenated, 'eventbrite.com/e/club-chub-weekend-2026-tickets-1975884326209');
  assert.equal(hyphenated, underscore, 'both separator styles must normalize identically');
});

test('identity: literal CCBC pair (same eventbrite id, hyphenated tracking params) fires ticket-url', () => {
  const core = createCore();
  // Two records of the SAME Eventbrite event id 1975884326209 from the run —
  // different titles, one ticketUrl carrying hyphenated utm params + aff.
  const ccbcResort = {
    title: 'CCBC Resort',
    startDate: new Date('2026-05-23T03:00:00.000Z'), // May 22, 8pm in LA
    timezone: 'America/Los_Angeles',
    ticketUrl: 'https://www.eventbrite.com/e/club-chub-weekend-2026-tickets-1975884326209?utm-campaign=website&utm-content=attendeeshare&utm-medium=discovery&utm-source=cp&aff=ebdsshcopyurl',
    source: 'ai-web'
  };
  const clubChubWeekend = {
    title: 'Club Chub Weekend 2026 — The Ultimate Celebration!',
    startDate: new Date('2026-05-22T19:00:00.000Z'), // May 22, noon in LA
    timezone: 'America/Los_Angeles',
    ticketUrl: 'https://www.eventbrite.com/e/club-chub-weekend-2026-tickets-1975884326209',
    source: 'ai-web'
  };
  assert.equal(core.getSameEventIdentitySignal(ccbcResort, clubChubWeekend), 'ticket-url');
});

// ---------------------------------------------------------------------------
// Midnight-placeholder startDate guard (Fix: QUENCHD — a record whose start
// defaulted to local midnight beat the sibling's explicit 20:00Z start via
// PARSER MERGE priority)
// ---------------------------------------------------------------------------

test('mergeParsedEvents: explicit start time beats a midnight-placeholder startDate in both directions', async () => {
  const core = createCore();
  const explicitRecord = {
    title: 'QUENCHD BEER BUST', source: 'ai-web', city: 'dallas', timezone: 'America/Chicago',
    startDate: new Date('2026-07-05T18:00:00.000Z') // 13:00 local (CDT) — explicit time
  };
  const midnightRecord = {
    title: 'QUENCHD BEER BUST', source: 'ai-web', city: 'dallas', timezone: 'America/Chicago',
    startDate: new Date('2026-07-05T05:00:00.000Z') // 00:00 local — "no time stated" placeholder
  };

  const keptExisting = await core.mergeParsedEvents({ ...explicitRecord }, { ...midnightRecord }, {});
  assert.equal(keptExisting.startDate.toISOString(), '2026-07-05T18:00:00.000Z',
    'an incoming midnight placeholder must never clobber the explicit start');

  const keptIncoming = await core.mergeParsedEvents({ ...midnightRecord }, { ...explicitRecord }, {});
  assert.equal(keptIncoming.startDate.toISOString(), '2026-07-05T18:00:00.000Z',
    'an existing midnight placeholder must never beat the incoming explicit start');
});

test('mergeParsedEvents: two explicit non-midnight starts fall through the placeholder guard unchanged', async () => {
  const core = createCore();
  const eightPm = {
    title: 'QUENCHD BEER BUST', source: 'ai-web', city: 'dallas', timezone: 'America/Chicago',
    startDate: new Date('2026-07-05T18:00:00.000Z')
  };
  const ninePm = {
    title: 'QUENCHD BEER BUST', source: 'ai-web', city: 'dallas', timezone: 'America/Chicago',
    startDate: new Date('2026-07-05T19:00:00.000Z')
  };
  // Neither side is a placeholder: the pre-existing resolution keeps the
  // incoming/base value (no deterministic override fires).
  const merged = await core.mergeParsedEvents({ ...eightPm }, { ...ninePm }, {});
  assert.equal(merged.startDate.toISOString(), '2026-07-05T19:00:00.000Z');
});

// ---------------------------------------------------------------------------
// Greater Palm Springs aliases (real generated cities config)
// ---------------------------------------------------------------------------

test('greater palm springs aliases resolve the palm-springs timezone via the real cities config', () => {
  const realCities = require('./scraper-cities');
  const core = new SharedCore(realCities, { eventSchema: EventSchema });
  const aliases = ['cathedral city', 'palm desert', 'rancho mirage', 'indian wells',
    'la quinta', 'desert hot springs', 'greater palm springs'];
  for (const alias of aliases) {
    assert.equal(core.getCityTimezone(alias), 'America/Los_Angeles', `"${alias}" must resolve palm-springs' timezone`);
  }
  // Bare "coachella" is deliberately NOT an alias (festival-name collision)
  assert.equal(core.getCityTimezone('coachella'), null);
});

// Recurring events: display+export only, never auto-written (series wave)
// ---------------------------------------------------------------------------

test('getResolvedFieldPriorities: rrule is requested from AI extraction by default', () => {
  const core = createCore();
  const priorities = core.getResolvedFieldPriorities({});
  assert.ok(priorities.rrule, 'rrule default priority entry exists');
  assert.deepEqual(priorities.rrule.priority, ['ai-web'], 'rrule rides the ai-web extraction path');
  assert.equal(priorities.rrule.merge, 'ai', 'merge strategy parallels description');
  // Explicit parser config still overrides the default (hardcoded config is the override)
  const overridden = core.getResolvedFieldPriorities({
    fieldPriorities: { rrule: { priority: ['static'], merge: 'clobber' } }
  });
  assert.deepEqual(overridden.rrule.priority, ['static']);
});

test('isRecurringSeriesEvent: _recurring stamp or non-empty recurrenceRule', () => {
  assert.equal(SharedCore.isRecurringSeriesEvent({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR' }), true);
  assert.equal(SharedCore.isRecurringSeriesEvent({ _recurring: true }), true);
  assert.equal(SharedCore.isRecurringSeriesEvent({ recurrenceRule: '' }), false);
  assert.equal(SharedCore.isRecurringSeriesEvent({ recurrenceRule: '   ' }), false);
  assert.equal(SharedCore.isRecurringSeriesEvent({ title: 'plain' }), false);
  assert.equal(SharedCore.isRecurringSeriesEvent(null), false);
});

test('recurring events are excluded from calendar-write execution but present in results', async () => {
  const core = createCore();
  const adapter = buildPrepCalendarAdapter([]);
  const recurring = {
    title: 'FUZZY',
    startDate: new Date('2026-08-08T02:00:00.000Z'),
    endDate: new Date('2026-08-08T07:00:00.000Z'),
    bar: 'Dallas Eagle',
    city: 'dallas',
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=FR'
  };
  const plain = {
    title: 'ONE-OFF',
    startDate: new Date('2026-08-09T02:00:00.000Z'),
    city: 'dallas'
  };

  const analyzed = await core.prepareEventsForCalendar([recurring, plain], adapter, {});

  assert.equal(analyzed.length, 2, "flag-don't-drop: the recurring event stays in the results");
  const analyzedRecurring = analyzed.find(event => event.title === 'FUZZY');
  assert.equal(analyzedRecurring._recurring, true);
  assert.equal(analyzedRecurring._recurringExport, true, 'stamped display+export only');
  assert.equal(analyzedRecurring.recurrenceRule, 'FREQ=WEEKLY;BYDAY=FR', 'rrule survives for the ICS export');

  const executable = SharedCore.filterEventsForExecution(analyzed);
  assert.deepEqual(executable.map(event => event.title), ['ONE-OFF'],
    'recurring events never reach calendar writes');
});

test('dateless recurring event with a derived occurrence stays in results, withheld from execution, and keeps its no-start-time flag', async () => {
  const core = createCore();
  const adapter = buildPrepCalendarAdapter([]);
  // The shape normalizeAiEvent produces for a recurring+dateless page (The
  // Lumberyard): startDate derived from the rrule's next occurrence, no
  // stated start time (_recurringNoStartTime stamps the ICS gating).
  const derived = {
    title: 'DRINK AND DRAW',
    startDate: new Date('2026-07-28T00:00:00.000Z'),
    endDate: new Date('2026-07-28T00:00:00.000Z'),
    city: 'dallas',
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=TU',
    _recurringNoStartTime: true
  };

  const analyzed = await core.prepareEventsForCalendar([derived], adapter, {});
  assert.equal(analyzed.length, 1, 'the derived-date recurring event survives to the results');
  assert.equal(analyzed[0]._recurring, true);
  assert.equal(analyzed[0]._recurringExport, true);
  assert.equal(analyzed[0]._recurringNoStartTime, true,
    'the no-start-time flag rides through to the analyzed event for card gating');
  assert.deepEqual(SharedCore.filterEventsForExecution(analyzed), [],
    'derived-date recurring events are still withheld from calendar writes');
});

test('wide-window probe decision: ≥2 instances sharing the identifier → series', () => {
  const identifier = 'CAL-UUID:fuzzy-20260503T203532Z@chunky.dad';
  const one = SharedCore.resolveSeriesProbeDecision([{ identifier }], identifier);
  assert.deepEqual(one, { instanceCount: 1, isSeries: false }, 'a single instance is not a series');
  const many = SharedCore.resolveSeriesProbeDecision([
    { identifier },
    { identifier: 'CAL-UUID:other@chunky.dad' },
    { identifier },
    null
  ], identifier);
  assert.deepEqual(many, { instanceCount: 2, isSeries: true });
  assert.deepEqual(SharedCore.resolveSeriesProbeDecision(null, identifier), { instanceCount: 0, isSeries: false });
  assert.deepEqual(SharedCore.resolveSeriesProbeDecision([{ identifier }], ''), { instanceCount: 0, isSeries: false });
});

test('extractIcsUidFromIdentifier: UID suffix from both device identifier shapes', () => {
  assert.equal(
    SharedCore.extractIcsUidFromIdentifier('1A2B3C4D-5E6F:6thhos5ct3pllq5kmvsp7infd8@google.com'),
    '6thhos5ct3pllq5kmvsp7infd8@google.com'
  );
  assert.equal(
    SharedCore.extractIcsUidFromIdentifier('1A2B3C4D-5E6F:fuzzy-20260503T203532Z@chunky.dad'),
    'fuzzy-20260503T203532Z@chunky.dad'
  );
  assert.equal(SharedCore.extractIcsUidFromIdentifier('no-colon-identifier'), null);
  assert.equal(SharedCore.extractIcsUidFromIdentifier(''), null);
  assert.equal(SharedCore.extractIcsUidFromIdentifier(null), null);
});

test('extractRecurringUidsFromIcs: light scan maps UIDs to RRULE presence (folded lines included)', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:weekly-1@chunky.dad',
    'RRULE:FREQ=WEEKLY;BYD',
    ' AY=FR',
    'SUMMARY:Weekly thing',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:oneoff-2@chunky.dad',
    'SUMMARY:One off',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:folded-3@chunky.',
    ' dad',
    'RRULE:FREQ=MONTHLY;BYDAY=2SA',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const uids = SharedCore.extractRecurringUidsFromIcs(ics);
  assert.ok(uids instanceof Map);
  assert.equal(uids.get('weekly-1@chunky.dad'), true, 'folded RRULE still detected');
  assert.equal(uids.get('oneoff-2@chunky.dad'), false, 'UID present WITHOUT an RRULE');
  assert.equal(uids.get('folded-3@chunky.dad'), true, 'folded UID reassembled');
  assert.equal(SharedCore.extractRecurringUidsFromIcs(''), null, 'empty input fails open as null');
  assert.equal(SharedCore.extractRecurringUidsFromIcs(null), null);
});

test('series probe integration: a confirmed series flips a plain merge into the recurring hands-off path', async () => {
  const core = createCore();
  const startDate = new Date('2026-08-08T02:00:00.000Z');
  const calendarRecord = {
    title: 'FUZZY',
    startDate,
    endDate: new Date('2026-08-08T07:00:00.000Z'),
    location: '',
    identifier: 'CAL-UUID:fuzzy-uid@chunky.dad',
    notes: 'bar: Dallas Eagle'
  };
  const adapter = buildPrepCalendarAdapter([calendarRecord]);
  const probeCalls = [];
  adapter.probeRecurringSeries = async (existingEvent) => {
    probeCalls.push(existingEvent.identifier);
    return true;
  };
  const scraped = { title: 'FUZZY', startDate, bar: 'Dallas Eagle', city: 'dallas' };

  const analyzed = await core.prepareEventsForCalendar([scraped], adapter, {});

  assert.deepEqual(probeCalls, ['CAL-UUID:fuzzy-uid@chunky.dad'], 'the probe ran once for the merge match');
  assert.equal(analyzed.length, 1);
  assert.equal(analyzed[0]._action, 'new', 'series match creates an override instead of mutating the series');
  assert.match(String(analyzed[0]._existingKey || ''), /^fuzzy-uid@chunky\.dad::/,
    'the existing recurring hands-off path keyed an override for the confirmed series');
});

test('series probe integration: probe errors and negative probes fail open to a plain merge', async () => {
  const startDate = new Date('2026-08-08T02:00:00.000Z');
  const calendarRecord = {
    title: 'FUZZY',
    startDate,
    endDate: new Date('2026-08-08T07:00:00.000Z'),
    location: '',
    identifier: 'CAL-UUID:fuzzy-uid@chunky.dad',
    notes: 'bar: Dallas Eagle'
  };
  const scraped = { title: 'FUZZY', startDate, bar: 'Dallas Eagle', city: 'dallas' };

  const throwingCore = createCore();
  const throwingAdapter = buildPrepCalendarAdapter([{ ...calendarRecord }]);
  throwingAdapter.probeRecurringSeries = async () => { throw new Error('calendar unavailable'); };
  const throwingAnalyzed = await throwingCore.prepareEventsForCalendar([{ ...scraped }], throwingAdapter, {});
  assert.equal(throwingAnalyzed[0]._action, 'merge', 'probe error → today\'s behavior');

  const negativeCore = createCore();
  const negativeAdapter = buildPrepCalendarAdapter([{ ...calendarRecord }]);
  negativeAdapter.probeRecurringSeries = async () => false;
  const negativeAnalyzed = await negativeCore.prepareEventsForCalendar([{ ...scraped }], negativeAdapter, {});
  assert.equal(negativeAnalyzed[0]._action, 'merge', 'negative probe keeps the plain merge');
});

test('series decision ordering: an existing notes recurrence key fires before any adapter probe', async () => {
  const core = createCore();
  const startDate = new Date('2026-08-08T02:00:00.000Z');
  const calendarRecord = {
    title: 'FUZZY',
    startDate,
    endDate: new Date('2026-08-08T07:00:00.000Z'),
    location: '',
    identifier: 'CAL-UUID:fuzzy-uid@chunky.dad',
    notes: 'bar: Dallas Eagle\nrecurrence: FREQ=WEEKLY;BYDAY=FR'
  };
  const adapter = buildPrepCalendarAdapter([calendarRecord]);
  adapter.probeRecurringSeries = async () => {
    throw new Error('probe must not run when the notes key already fired');
  };
  const scraped = { title: 'FUZZY', startDate, bar: 'Dallas Eagle', city: 'dallas' };

  const analyzed = await core.prepareEventsForCalendar([scraped], adapter, {});

  assert.equal(analyzed[0]._action, 'new', 'notes key alone routes to the recurring hands-off path');
  assert.match(String(analyzed[0]._existingKey || ''), /^fuzzy-uid@chunky\.dad::/,
    'override identity derived without ever consulting the probe');
});

test('noteConfirmedRecurringSeries feeds shouldCreateOverrideFromRecurringMatch', () => {
  const core = createCore();
  const existingEvent = {
    title: 'FUZZY',
    identifier: 'CAL-UUID:fuzzy-uid@chunky.dad',
    startDate: new Date('2026-08-08T02:00:00.000Z'),
    notes: 'bar: Dallas Eagle'
  };
  assert.equal(core.shouldCreateOverrideFromRecurringMatch(existingEvent, [existingEvent]), false,
    'no series signal before confirmation');
  core.noteConfirmedRecurringSeries('CAL-UUID:fuzzy-uid@chunky.dad');
  assert.equal(core.shouldCreateOverrideFromRecurringMatch(existingEvent, [existingEvent]), true,
    'confirmed identifier flips the hands-off path');
});

// ---------------------------------------------------------------------------
// Published-calendar ICS parsing + RRULE expansion (Mac/Node merge fidelity)
// ---------------------------------------------------------------------------

// Fixture mirroring the real published-calendar shapes (Google Calendar
// export): TZID timed event, VALUE=DATE all-day, WEEKLY;BYDAY series with one
// EXDATE and one RECURRENCE-ID override, MONTHLY;BYDAY=1FR series, and one
// unsupported YEARLY rule. The plain event's DESCRIPTION is 75-octet folded.
const PUBLISHED_ICS_FIXTURE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Test//Test//EN',
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:plain-timed@test',
  'DTSTART;TZID=America/New_York:20260710T210000',
  'DTEND;TZID=America/New_York:20260711T010000',
  'SUMMARY:Plain Timed\\, Event',
  'DESCRIPTION:bar: The Eagle\\nwebsite: https://example.com/events?id=1\\ndesc',
  ' ription: Line one\; folded tail\\\\not-a-newline',
  'LOCATION:40.7\\, -73.9',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:allday@test',
  'DTSTART;VALUE=DATE:20260620',
  'DTEND;VALUE=DATE:20260621',
  'SUMMARY:All Day Fair',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:weekly@test',
  'DTSTART;TZID=America/New_York:20260705T170000',
  'DTEND;TZID=America/New_York:20260705T200000',
  'RRULE:FREQ=WEEKLY;BYDAY=SU',
  'EXDATE;TZID=America/New_York:20260719T170000',
  'SUMMARY:Weekly Beer Blast',
  'DESCRIPTION:bar: Rebar',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:weekly@test',
  'RECURRENCE-ID;TZID=America/New_York:20260726T170000',
  'DTSTART;TZID=America/New_York:20260726T180000',
  'DTEND;TZID=America/New_York:20260726T210000',
  'SUMMARY:Beer Blast (Special)',
  'DESCRIPTION:overrideUid: weekly@test\\noverrideRecurrenceId: 20260726T210000Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:monthly@test',
  'DTSTART;TZID=America/New_York:20250801T220000',
  'DTEND;TZID=America/New_York:20250802T020000',
  'RRULE:FREQ=MONTHLY;BYDAY=1FR',
  'SUMMARY:First Friday',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:unsupported@test',
  'DTSTART;TZID=America/New_York:20260701T190000',
  'DTEND;TZID=America/New_York:20260701T220000',
  'RRULE:FREQ=YEARLY;BYMONTH=7;BYDAY=1WE',
  'SUMMARY:Annual Gala',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

test('parsePublishedCalendarIcs: per-VEVENT fields, folding, unescaping, TZID and all-day dates', () => {
  const records = SharedCore.parsePublishedCalendarIcs(PUBLISHED_ICS_FIXTURE);
  assert.equal(records.length, 6, 'six VEVENTs (VTIMEZONE DST rules are not events)');

  const plain = records.find(record => record.uid === 'plain-timed@test');
  assert.equal(plain.summary, 'Plain Timed, Event', 'SUMMARY comma unescaped');
  assert.equal(plain.location, '40.7, -73.9', 'LOCATION comma unescaped');
  assert.equal(
    plain.description,
    'bar: The Eagle\nwebsite: https://example.com/events?id=1\ndescription: Line one; folded tail\\not-a-newline',
    'DESCRIPTION unfolded across the 75-octet break, \\n/\;/\\\\ unescaped in one pass'
  );
  // 21:00 America/New_York (EDT, UTC-4) → 01:00Z next day.
  assert.equal(plain.start.date.toISOString(), '2026-07-11T01:00:00.000Z', 'TZID wall clock → correct instant');
  assert.equal(plain.end.date.toISOString(), '2026-07-11T05:00:00.000Z');
  assert.equal(plain.isAllDay, false);
  assert.equal(plain.rrule, '');

  const allDay = records.find(record => record.uid === 'allday@test');
  assert.equal(allDay.isAllDay, true, 'VALUE=DATE → all-day');
  assert.equal(allDay.start.date.toISOString(), '2026-06-20T00:00:00.000Z');

  const weekly = records.find(record => record.uid === 'weekly@test' && record.rrule);
  assert.equal(weekly.rrule, 'FREQ=WEEKLY;BYDAY=SU');
  assert.equal(weekly.exdates.length, 1);
  assert.equal(weekly.exdates[0].date.toISOString(), '2026-07-19T21:00:00.000Z', 'EXDATE TZID-aware');

  const override = records.find(record => record.uid === 'weekly@test' && record.recurrenceId);
  assert.equal(override.recurrenceId.date.toISOString(), '2026-07-26T21:00:00.000Z');

  assert.equal(SharedCore.parsePublishedCalendarIcs(''), null, 'empty input fails open as null');
  assert.equal(SharedCore.parsePublishedCalendarIcs(null), null);
});

test('expandRruleOccurrencesInWindow: weekly, monthly-ordinal, daily, INTERVAL, COUNT/UNTIL, DST wall-clock', () => {
  const records = SharedCore.parsePublishedCalendarIcs(PUBLISHED_ICS_FIXTURE);
  const windowStart = new Date('2026-07-01T00:00:00.000Z');
  const windowEnd = new Date('2026-07-31T23:59:59.999Z');

  const weekly = records.find(record => record.uid === 'weekly@test' && record.rrule);
  const weeklyStarts = SharedCore.expandRruleOccurrencesInWindow(weekly.rrule, weekly.start, windowStart, windowEnd);
  assert.deepEqual(
    weeklyStarts.map(date => date.toISOString()),
    ['2026-07-05T21:00:00.000Z', '2026-07-12T21:00:00.000Z', '2026-07-19T21:00:00.000Z', '2026-07-26T21:00:00.000Z'],
    'every July Sunday at 17:00 New York (raw expansion; EXDATE applies at the event layer)'
  );

  const monthly = records.find(record => record.uid === 'monthly@test');
  const monthlyStarts = SharedCore.expandRruleOccurrencesInWindow(
    monthly.rrule, monthly.start, new Date('2026-08-01T00:00:00.000Z'), new Date('2026-08-31T23:59:59.999Z')
  );
  assert.deepEqual(
    monthlyStarts.map(date => date.toISOString()),
    ['2026-08-08T02:00:00.000Z'],
    'first Friday of August 2026 (Aug 7) at 22:00 New York'
  );

  // Weekly series crossing the March 2026 DST transition keeps its wall-clock
  // start: 17:00 EST (22:00Z) before, 17:00 EDT (21:00Z) after March 8.
  const dstStart = SharedCore.parseIcsDateValue(';TZID=America/New_York', '20260301T170000');
  const dstStarts = SharedCore.expandRruleOccurrencesInWindow(
    'FREQ=WEEKLY;BYDAY=SU', dstStart, new Date('2026-03-01T00:00:00.000Z'), new Date('2026-03-16T00:00:00.000Z')
  );
  assert.deepEqual(
    dstStarts.map(date => date.toISOString()),
    ['2026-03-01T22:00:00.000Z', '2026-03-08T21:00:00.000Z', '2026-03-15T21:00:00.000Z'],
    'wall-clock time preserved across the DST jump'
  );

  // INTERVAL=2 weekly: every other week from the series start's week.
  const biweeklyStarts = SharedCore.expandRruleOccurrencesInWindow(
    'FREQ=WEEKLY;INTERVAL=2', weekly.start, windowStart, windowEnd
  );
  assert.deepEqual(
    biweeklyStarts.map(date => date.toISOString()),
    ['2026-07-05T21:00:00.000Z', '2026-07-19T21:00:00.000Z'],
    'INTERVAL=2 skips alternate weeks (BYDAY defaults to the DTSTART weekday)'
  );

  const dailyStarts = SharedCore.expandRruleOccurrencesInWindow(
    'FREQ=DAILY', weekly.start, new Date('2026-07-05T00:00:00.000Z'), new Date('2026-07-07T23:59:59.999Z')
  );
  assert.equal(dailyStarts.length, 3, 'daily expansion');

  const countedStarts = SharedCore.expandRruleOccurrencesInWindow(
    'FREQ=WEEKLY;BYDAY=SU;COUNT=2', weekly.start, windowStart, windowEnd
  );
  assert.equal(countedStarts.length, 2, 'COUNT bounds the whole series from DTSTART');

  const untilStarts = SharedCore.expandRruleOccurrencesInWindow(
    'FREQ=WEEKLY;BYDAY=SU;UNTIL=20260713T000000Z', weekly.start, windowStart, windowEnd
  );
  assert.deepEqual(
    untilStarts.map(date => date.toISOString()),
    ['2026-07-05T21:00:00.000Z', '2026-07-12T21:00:00.000Z'],
    'UNTIL cuts the series'
  );

  // Unsupported shapes → null (callers treat the event as non-recurring).
  assert.equal(SharedCore.expandRruleOccurrencesInWindow('FREQ=YEARLY;BYMONTH=7;BYDAY=1WE', weekly.start, windowStart, windowEnd), null);
  assert.equal(SharedCore.expandRruleOccurrencesInWindow('FREQ=MONTHLY;BYDAY=1FR,3FR', weekly.start, windowStart, windowEnd), null);
  assert.equal(SharedCore.expandRruleOccurrencesInWindow('FREQ=MONTHLY;BYSETPOS=1;BYDAY=FR', weekly.start, windowStart, windowEnd), null);
  assert.equal(SharedCore.expandRruleOccurrencesInWindow('', weekly.start, windowStart, windowEnd), null);
});

test('expandPublishedCalendarEventsInWindow: EXDATE excluded, override replaces its occurrence, unsupported listed as non-recurring', () => {
  const records = SharedCore.parsePublishedCalendarIcs(PUBLISHED_ICS_FIXTURE);
  const windowStart = new Date('2026-07-01T00:00:00.000Z');
  const windowEnd = new Date('2026-07-31T23:59:59.999Z');
  const { events, unsupportedRrules } = SharedCore.expandPublishedCalendarEventsInWindow(records, windowStart, windowEnd);

  assert.deepEqual(unsupportedRrules, [{ uid: 'unsupported@test', rrule: 'FREQ=YEARLY;BYMONTH=7;BYDAY=1WE' }],
    'unsupported RRULE reported for the adapter to log');

  const titles = events.map(event => `${event.title}@${event.startDate.toISOString()}`).sort();
  assert.deepEqual(titles, [
    'Annual Gala@2026-07-01T23:00:00.000Z',            // unsupported series → plain one-off on its DTSTART
    'Beer Blast (Special)@2026-07-26T22:00:00.000Z',   // override replaces the Jul 26 occurrence, own start time
    'First Friday@2026-07-04T02:00:00.000Z',           // monthly 1FR: Jul 3 22:00 New York
    'Plain Timed, Event@2026-07-11T01:00:00.000Z',
    'Weekly Beer Blast@2026-07-05T21:00:00.000Z',
    'Weekly Beer Blast@2026-07-12T21:00:00.000Z'       // Jul 19 EXDATE excluded, Jul 26 replaced by the override
  ]);

  const occurrence = events.find(event => event.title === 'Weekly Beer Blast');
  assert.equal(occurrence.identifier, 'weekly@test', 'series occurrences share the raw ICS UID');
  assert.equal(occurrence.recurrence, 'FREQ=WEEKLY;BYDAY=SU', 'occurrences carry the series RRULE for the hands-off path');
  assert.equal(occurrence.notes, 'bar: Rebar', 'DESCRIPTION rides in notes (calendar-as-database format)');
  assert.equal(occurrence.endDate.toISOString(), '2026-07-06T00:00:00.000Z', 'series duration preserved per occurrence');

  const override = events.find(event => event.title === 'Beer Blast (Special)');
  assert.equal(override.identifier, 'weekly@test', 'override shares the series UID');
  assert.equal(override.recurrence, undefined, 'override instances are standalone events');
  assert.match(override.notes, /overrideUid: weekly@test/);

  const allDayWindow = SharedCore.expandPublishedCalendarEventsInWindow(
    records, new Date('2026-06-19T00:00:00.000Z'), new Date('2026-06-21T00:00:00.000Z')
  );
  const allDay = allDayWindow.events.find(event => event.identifier === 'allday@test');
  assert.equal(allDay.isAllDay, true);
  assert.equal(allDay.startDate.toISOString(), '2026-06-20T00:00:00.000Z');
});

test('expanded series occurrences drive the recurring hands-off path in analyzeEventAction', () => {
  const core = createCore();
  const records = SharedCore.parsePublishedCalendarIcs(PUBLISHED_ICS_FIXTURE);
  const { events } = SharedCore.expandPublishedCalendarEventsInWindow(
    records, new Date('2026-07-05T00:00:00.000Z'), new Date('2026-07-05T23:59:59.999Z')
  );
  const existing = events.filter(event => event.identifier === 'weekly@test');
  assert.equal(existing.length, 1, 'narrow window sees a single series instance');

  const scraped = {
    title: 'Weekly Beer Blast',
    startDate: new Date('2026-07-05T21:00:00.000Z'),
    endDate: new Date('2026-07-06T00:00:00.000Z')
  };
  const analysis = core.analyzeEventAction(scraped, existing, 'upsert');
  assert.equal(analysis.action, 'new', 'series match never merges into the series master');
  assert.match(analysis.reason, /creating override/, 'routes to override creation');
  assert.equal(analysis.overrideIdentity.overrideUid, 'weekly@test');
});

// ---------------------------------------------------------------------------
// Cross-host crawl scoping (BEEFMINCE run 20260729-100804: dice.fm's promoter
// page fanned out through platform chrome into the NYC browse catalog).
// ---------------------------------------------------------------------------

test('getRegistrableDomainFromUrl: registrable-domain approximation (www/port/subdomain/ccTLD)', () => {
  const core = createCore();
  assert.equal(core.getRegistrableDomainFromUrl('https://beefmince.com/events'), 'beefmince.com');
  assert.equal(core.getRegistrableDomainFromUrl('https://www.dice.fm/browse'), 'dice.fm');
  assert.equal(core.getRegistrableDomainFromUrl('https://link.dice.fm/T1d30c84b47d'), 'dice.fm');
  assert.equal(core.getRegistrableDomainFromUrl('https://tickets.example.co.uk:8080/x'), 'example.co.uk');
  assert.equal(core.getRegistrableDomainFromUrl('not a url'), '');
});

test('cross-host crawl scope: off-host pages follow only event-detail links and links back to the configured host', async () => {
  const core = new SharedCore(CITIES, {
    eventSchema: EventSchema,
    pageClassificationRules: [
      { pattern: /promoter\.example\/events/i, classification: 'multi-event-page' },
      { pattern: /platform\.example\/promoters\//i, classification: 'multi-event-page' }
    ]
  });
  const display = createDisplayAdapterStub();
  const promoterPage = 'https://platform.example/promoters/promo-1';
  const pages = {
    'https://promoter.example/events': { additionalLinks: [promoterPage] },
    [promoterPage]: {
      additionalLinks: [
        'https://platform.example/event/party-one-tickets',   // event-detail shape → followed
        'https://tickets.platform.example/event/party-two',   // same registrable domain + detail shape → followed
        'https://promoter.example/gallery',                   // back to the configured host → followed
        'https://platform.example/browse',                    // platform catalog chrome → rejected
        'https://platform.example/help/refunds',              // help chrome → rejected
        'https://elsewhere.example/whatever'                  // third host → rejected
      ]
    },
    'https://platform.example/event/party-one-tickets': {},
    'https://tickets.platform.example/event/party-two': {},
    'https://promoter.example/gallery': {},
    'https://platform.example/browse': {},
    'https://platform.example/help/refunds': {},
    'https://elsewhere.example/whatever': {}
  };
  const { fetched, httpAdapter, parsers } = createCrawlHarness(pages);

  await core.processParser(
    { name: 'Cross Host Scope', urls: ['https://promoter.example/events'], ai: CRAWL_AI },
    {}, httpAdapter, display, parsers
  );

  assert.ok(fetched.includes(promoterPage), 'the configured host may discover the off-host promoter page');
  assert.ok(fetched.includes('https://platform.example/event/party-one-tickets'), 'event-detail links on the off-host page are followed');
  assert.ok(fetched.includes('https://tickets.platform.example/event/party-two'), 'same registrable domain subdomain event links are followed');
  assert.ok(fetched.includes('https://promoter.example/gallery'), 'links back to the configured host are followed');
  assert.ok(!fetched.includes('https://platform.example/browse'), 'platform browse chrome is not followed');
  assert.ok(!fetched.includes('https://platform.example/help/refunds'), 'platform help chrome is not followed');
  assert.ok(!fetched.includes('https://elsewhere.example/whatever'), 'a cross-host page may not lead to another new host');

  assert.ok(display.logs.includes(
    `SYSTEM: Cross-host scope: rejecting https://platform.example/browse from ${promoterPage} — not event-detail-shaped on an off-host page (cross-host-scope)`
  ), `expected per-rejection cross-host-scope log, got: ${JSON.stringify(display.logs.filter(l => l.includes('Cross-host')))}`);
  assert.ok(display.logs.includes(
    `SYSTEM: Cross-host scope: rejecting https://elsewhere.example/whatever from ${promoterPage} — links to a third host (elsewhere.example) (cross-host-scope)`
  ), 'third-host rejections name the host');
  assert.ok(display.logs.includes(
    `SYSTEM: Cross-host crawl scope at ${promoterPage} (host platform.example, configured promoter.example): kept 3 of 6 link(s), rejected 3 (cross-host-scope)`
  ), 'summary line reports kept/rejected counts');
});

test('cross-host crawl scope: path-similar continuation on the off-host page is followed; configured-host pages are never scoped', () => {
  const core = createCore();
  // Off-host listing page whose detail pages share its first path segment
  const scoped = core.applyCrossHostCrawlScope(
    [
      'https://platform.example/whats-on/city/venue/123',
      'https://platform.example/venues/some-club'
    ],
    'https://platform.example/whats-on',
    { urls: ['https://promoter.example/events'] }
  );
  assert.equal(scoped.pageIsCrossHost, true);
  assert.deepEqual(scoped.allowed, ['https://platform.example/whats-on/city/venue/123']);
  assert.equal(scoped.rejected.length, 1);
  assert.equal(scoped.rejected[0].url, 'https://platform.example/venues/some-club');

  // Configured-host page: everything passes through untouched
  const unscoped = core.applyCrossHostCrawlScope(
    ['https://anywhere.example/anything', 'https://platform.example/browse'],
    'https://promoter.example/events',
    { urls: ['https://promoter.example/events'] }
  );
  assert.equal(unscoped.pageIsCrossHost, false);
  assert.equal(unscoped.allowed.length, 2);
  assert.equal(unscoped.rejected.length, 0);
});

// ---------------------------------------------------------------------------
// Bear keyword audit (Fix D, run 20260729-100804): "BASTID'S BBQ - NEW YORK
// '26" was kept bear via `keyword: bear` — the match came from the
// OCR-derived DESCRIPTION ("Good Music. Good Food. Good Bears."), not the
// title, and 'bbq' is deliberately NOT a bear keyword in either tier. Lock
// both directions.
// ---------------------------------------------------------------------------

test("bear keywords: 'bbq' alone is not a bear signal; explicit bear context is", () => {
  const core = createCore();
  // A bare BBQ party title matches NO keyword in either tier
  assert.deepEqual(core.matchBearKeywords("BASTID'S BBQ - NEW YORK '26"), []);
  assert.equal(core.isBearEvent({ title: "BASTID'S BBQ - NEW YORK '26" }, {}), false);
  // A real bear BBQ (community event with bear context) still passes
  assert.ok(core.matchBearKeywords('BEAR BBQ — a cookout for the bear community').includes('bear'));
  assert.equal(core.isBearEvent({ title: 'BEAR BBQ', description: 'Bears, cubs and friends cookout' }, {}), true);
  // The incident's actual trigger: 'bear' inside the OCR-derived description
  assert.deepEqual(
    core.matchBearKeywords("BASTID'S BBQ - NEW YORK '26 Good Music. Good Food. Good Bears."),
    ['bear']
  );
});

// ---------------------------------------------------------------------------
// Final-build field cleanups in buildAnalyzedCalendarEvent: description
// formatting sanitizer (run 20260729-125201, dice.fm/Wix markup in notes) and
// gmaps rebuild from settled facts (same run: text-search links next to
// geocode-verified coords).
// ---------------------------------------------------------------------------

const { NormalizerPipeline } = require('./normalizers');

function createFinalBuildCore(options = {}) {
  return new SharedCore(CITIES, {
    eventSchema: EventSchema,
    normalizerPipeline: new NormalizerPipeline(),
    ...options
  });
}

function captureFinalBuildLogs(lines) {
  const originalLog = console.log;
  console.log = (message) => { lines.push(String(message)); };
  return () => { console.log = originalLog; };
}

const NEW_ACTION_ANALYSIS = { action: 'new', reason: 'No existing event found', sourceEvent: null, overrideIdentity: null };

test('final build sanitizes description formatting markup and logs once', async () => {
  const core = createFinalBuildCore();
  const event = {
    title: 'BEEFMINCE',
    startDate: new Date('2026-08-01T21:00:00.000Z'),
    city: 'dallas',
    description: "**BEEFMINCE | The UK's Tastiest Bear Club** **\\*Now on Saturdays\\***"
  };
  const lines = [];
  const restore = captureFinalBuildLogs(lines);
  let analyzed;
  try {
    analyzed = await core.buildAnalyzedCalendarEvent(event, NEW_ACTION_ANALYSIS, {}, {});
  } finally {
    restore();
  }

  assert.ok(!analyzed.description.includes('**'), `markdown runs stripped: ${JSON.stringify(analyzed.description)}`);
  assert.ok(!analyzed.description.includes('\\*'), 'escaped asterisks stripped');
  assert.ok(analyzed.description.includes("BEEFMINCE | The UK's Tastiest Bear Club"), 'words kept');
  assert.ok(analyzed.notes.includes(analyzed.description), 'notes serialize the sanitized description');
  assert.deepEqual(
    lines.filter(line => line.startsWith('🧼 DESCRIPTION:')),
    ['🧼 DESCRIPTION: stripped formatting markup for "BEEFMINCE"']);
});

test('final build leaves a plain description byte-identical and stays silent', async () => {
  const core = createFinalBuildCore();
  const plain = 'Bears, beers, and DJs from 9pm. 21+ only.';
  const event = {
    title: 'CUB NIGHT',
    startDate: new Date('2026-08-01T21:00:00.000Z'),
    city: 'dallas',
    description: plain
  };
  const lines = [];
  const restore = captureFinalBuildLogs(lines);
  let analyzed;
  try {
    analyzed = await core.buildAnalyzedCalendarEvent(event, NEW_ACTION_ANALYSIS, {}, {});
  } finally {
    restore();
  }

  assert.equal(analyzed.description, plain, 'byte-identical passthrough');
  assert.equal(lines.some(line => line.startsWith('🧼 DESCRIPTION:')), false, 'no sanitizer log for clean text');
});

test('final build rebuilds a vague text-query gmaps link from verified coordinates', async () => {
  const core = createFinalBuildCore();
  const event = {
    title: 'HORIZON BEAR NIGHT',
    startDate: new Date('2026-08-01T21:00:00.000Z'),
    location: '50.8196107, -0.1315114',
    gmaps: 'https://www.google.com/maps/search/?api=1&query=Horizon%2C%20Brighton%20and%20Hove'
  };
  const lines = [];
  const restore = captureFinalBuildLogs(lines);
  let analyzed;
  try {
    analyzed = await core.buildAnalyzedCalendarEvent(event, NEW_ACTION_ANALYSIS, {}, {});
  } finally {
    restore();
  }

  assert.equal(analyzed.gmaps, 'https://www.google.com/maps/search/?api=1&query=50.8196107%2C-0.1315114');
  assert.ok(lines.includes('🗺️ GMAPS: rebuilt link from verified coordinates for "HORIZON BEAR NIGHT"'),
    `got: ${JSON.stringify(lines)}`);
});

test('final build prefers a curated bar googleMaps link over the coordinate rebuild', async () => {
  const CURATED_EAGLE_GMAPS = 'https://www.google.com/maps/place/?q=place_id:ChIJLwuhHU_HwoARdQQ1PfOn6B4';
  const core = createFinalBuildCore({
    bars: {
      la: [{
        name: 'Eagle LA',
        city: 'la',
        coordinates: '34.0912127, -118.2840632',
        googleMaps: CURATED_EAGLE_GMAPS
      }]
    }
  });
  const event = {
    title: 'CUBSCOUT LA',
    startDate: new Date('2026-08-01T21:00:00.000Z'),
    bar: 'Eagle LA',
    city: 'la',
    location: '34.0912127, -118.2840632',
    gmaps: 'https://www.google.com/maps/search/?api=1&query=Eagle%20LA'
  };
  const lines = [];
  const restore = captureFinalBuildLogs(lines);
  let analyzed;
  try {
    analyzed = await core.buildAnalyzedCalendarEvent(event, NEW_ACTION_ANALYSIS, {}, {});
  } finally {
    restore();
  }

  assert.equal(analyzed.gmaps, CURATED_EAGLE_GMAPS, 'curated link wins verbatim');
  assert.ok(lines.includes('🗺️ GMAPS: adopted curated googleMaps link for "CUBSCOUT LA"'));
});

test('final build never rebuilds a parser-static gmaps value or a coord-less event', async () => {
  const core = createFinalBuildCore();

  // Static-stamped gmaps is curated parser config — untouched even with coords.
  const staticEvent = {
    title: 'STATIC MAPS',
    startDate: new Date('2026-08-01T21:00:00.000Z'),
    location: '50.8196107, -0.1315114',
    gmaps: 'https://maps.example/curated-by-config',
    _staticFields: { gmaps: 'https://maps.example/curated-by-config' }
  };
  const lines = [];
  const restore = captureFinalBuildLogs(lines);
  let analyzedStatic;
  let analyzedNoCoords;
  try {
    analyzedStatic = await core.buildAnalyzedCalendarEvent(staticEvent, NEW_ACTION_ANALYSIS, {}, {});

    // No usable final coordinates → existing link stands.
    const noCoordsEvent = {
      title: 'NO COORDS',
      startDate: new Date('2026-08-01T21:00:00.000Z'),
      gmaps: 'https://www.google.com/maps/search/?api=1&query=Eden%20Birmingham'
    };
    analyzedNoCoords = await core.buildAnalyzedCalendarEvent(noCoordsEvent, NEW_ACTION_ANALYSIS, {}, {});
  } finally {
    restore();
  }

  assert.equal(analyzedStatic.gmaps, 'https://maps.example/curated-by-config', 'static gmaps untouched');
  assert.equal(analyzedNoCoords.gmaps, 'https://www.google.com/maps/search/?api=1&query=Eden%20Birmingham', 'no coords → untouched');
  assert.equal(lines.some(line => line.startsWith('🗺️ GMAPS:')), false, 'no rebuild logs fired');
});

test('final build drops a ticketUrl byte-identical to the canonical website', async () => {
  const core = createFinalBuildCore();
  const link = 'https://eaglela.com/events/cub-scout-3/';
  const event = {
    title: 'CUBSCOUT',
    startDate: new Date('2026-09-05T04:00:00.000Z'),
    city: 'la',
    website: link,
    url: link,
    ticketUrl: link
  };
  const lines = [];
  const restore = captureFinalBuildLogs(lines);
  let analyzed;
  try {
    analyzed = await core.buildAnalyzedCalendarEvent(event, NEW_ACTION_ANALYSIS, {}, {});
  } finally {
    restore();
  }

  assert.equal(analyzed.ticketUrl, undefined, 'duplicate ticketUrl deleted');
  assert.equal(analyzed.website, link, 'canonical website untouched');
  assert.ok(!analyzed.notes.includes('ticketUrl:'), `notes drop the duplicate line: ${JSON.stringify(analyzed.notes)}`);
  assert.ok(lines.includes('🔗 LINKS: dropped ticketUrl duplicating website for "CUBSCOUT"'),
    `got: ${JSON.stringify(lines)}`);
});

test('final build keeps a ticketUrl that differs from the website', async () => {
  const core = createFinalBuildCore();
  const event = {
    title: 'FURBALL',
    startDate: new Date('2026-08-07T02:00:00.000Z'),
    city: 'chicago',
    website: 'https://www.furball.nyc/',
    ticketUrl: 'https://www.eventbrite.com/e/furball-chicago-tickets-123'
  };
  const lines = [];
  const restore = captureFinalBuildLogs(lines);
  let analyzed;
  try {
    analyzed = await core.buildAnalyzedCalendarEvent(event, NEW_ACTION_ANALYSIS, {}, {});
  } finally {
    restore();
  }

  assert.equal(analyzed.ticketUrl, 'https://www.eventbrite.com/e/furball-chicago-tickets-123', 'real ticket link survives');
  assert.equal(lines.some(line => line.startsWith('🔗 LINKS:')), false, 'no dedup log');
});

// ---------------------------------------------------------------------------
// AI shortName derivation pass (final-build): events lacking a shortName make
// ugly city-page calendar chips (the site falls back to the full title).
// Derived from the title only, guarded by the deterministic verbatim gate in
// evaluateDerivedShortName. Unescaped `-` in shortName = line-break hint.
// ---------------------------------------------------------------------------

function createShortNameAdapter(content) {
  const adapter = { calls: [] };
  adapter.postJson = async (endpoint, payload) => {
    adapter.calls.push(payload);
    return { ok: true, status: 200, text: buildOpenAiResponsePayload(content) };
  };
  return adapter;
}

test('shortName gate: hyphen insertion and case-lift accepted, invented text rejected', () => {
  const core = createCore();

  // Hyphen insertion as a line-break hint (whole title + added hyphen stores)
  assert.deepEqual(core.evaluateDerivedShortName('CUBSCOUT', 'CUB-SCOUT', 16),
    { ok: true, value: 'CUB-SCOUT' });

  // Contiguous-substring rule: spaces count as characters — "BEEF MARKET"
  // splices two words together and must be rejected.
  assert.deepEqual(core.evaluateDerivedShortName('BEEFMINCE MEET MARKET', 'BEEF MARKET', 16),
    { ok: false, reason: 'not a verbatim substring' });
  assert.deepEqual(core.evaluateDerivedShortName('BEEFMINCE MEET MARKET', 'MEET MARKET', 16),
    { ok: true, value: 'MEET MARKET' });
  assert.deepEqual(core.evaluateDerivedShortName('BEEFMINCE MEET MARKET', 'BEEFMINCE', 16),
    { ok: true, value: 'BEEFMINCE' });

  // Too long: a verbatim substring over the cap is still rejected.
  assert.deepEqual(core.evaluateDerivedShortName('BEEFMINCE MEET MARKET', 'BEEFMINCE MEET MA', 16),
    { ok: false, reason: 'too long' });

  // Whole title unchanged adds nothing — the site fallback already shows it.
  assert.deepEqual(core.evaluateDerivedShortName('BEEFMINCE', 'BEEFMINCE', 16),
    { ok: false, reason: 'equals title' });

  // Case-lift IS a display change and is stored.
  assert.deepEqual(core.evaluateDerivedShortName('Beefmince', 'BEEFMINCE', 16),
    { ok: true, value: 'BEEFMINCE' });

  // Diacritic fold: the answer may drop accents the title carries.
  assert.deepEqual(core.evaluateDerivedShortName('OSOS Café Night', 'CAFE', 16),
    { ok: true, value: 'CAFE' });

  // Empty / non-string answers are unusable.
  assert.deepEqual(core.evaluateDerivedShortName('BEEFMINCE', '   ', 16),
    { ok: false, reason: 'unusable response' });
});

test('shortName prompt: identical across builds, title only — no volatile content', () => {
  const core = createCore();
  const first = core.buildShortNamePrompt({ eventTitle: 'BEEFMINCE MEET MARKET', maxChars: 16 });
  const second = core.buildShortNamePrompt({ eventTitle: 'BEEFMINCE MEET MARKET', maxChars: 16 });
  assert.equal(first, second, 'cache-key stability: byte-identical prompts');
  assert.ok(first.includes('BEEFMINCE MEET MARKET'), 'title present');
  assert.ok(!/\b20\d\d\b/.test(first), 'no year/date strings in the prompt');
  assert.ok(first.includes('16 characters'), 'max chars stated');
});

test('final build derives a shortName via AI for an event lacking one', async () => {
  const core = createFinalBuildCore();
  const adapter = createShortNameAdapter('{"shortName": {"value": "BEEFMINCE", "reason": "recognizable brand"}}');
  const event = {
    title: 'BEEFMINCE MEET MARKET',
    startDate: new Date('2026-08-01T21:00:00.000Z'),
    city: 'dallas'
  };
  const lines = [];
  const restore = captureFinalBuildLogs(lines);
  let analyzed;
  try {
    analyzed = await core.buildAnalyzedCalendarEvent(event, NEW_ACTION_ANALYSIS, adapter, { ai: {} });
  } finally {
    restore();
  }

  assert.equal(analyzed.shortName, 'BEEFMINCE');
  const noteFields = core.parseNotesIntoFields(analyzed.notes || '');
  assert.equal(noteFields.shortName, 'BEEFMINCE', 'notes serialize the derived shortName');
  assert.ok(lines.includes('🏷️ SHORTNAME: derived "BEEFMINCE" for "BEEFMINCE MEET MARKET"'),
    `got: ${JSON.stringify(lines.filter(line => line.includes('SHORTNAME')))}`);
  assert.equal(adapter.calls.length, 1, 'exactly one AI call');
  const prompt = adapter.calls[0].messages[0].content;
  assert.ok(prompt.includes('BEEFMINCE MEET MARKET'), 'prompt carries the title');
  assert.ok(!prompt.includes('2026'), 'prompt carries no dates');
  assert.ok(!prompt.toLowerCase().includes('dallas'), 'prompt carries no city');
});

test('final build makes no shortName AI call when one exists, is static, or the pass is off', async () => {
  const core = createFinalBuildCore();
  const explodingAdapter = { postJson: async () => { throw new Error('AI must not be called'); } };
  const lines = [];
  const restore = captureFinalBuildLogs(lines);
  let withShortName;
  let staticShortName;
  let passDisabled;
  try {
    withShortName = await core.buildAnalyzedCalendarEvent({
      title: 'BEEFMINCE MEET MARKET',
      shortName: 'BEEF-MINCE',
      startDate: new Date('2026-08-01T21:00:00.000Z')
    }, NEW_ACTION_ANALYSIS, explodingAdapter, { ai: {} });

    staticShortName = await core.buildAnalyzedCalendarEvent({
      title: 'STATIC SHORT NAME NIGHT',
      startDate: new Date('2026-08-01T21:00:00.000Z'),
      _staticFields: { shortName: 'CURATED' }
    }, NEW_ACTION_ANALYSIS, explodingAdapter, { ai: {} });

    passDisabled = await core.buildAnalyzedCalendarEvent({
      title: 'NO DERIVE NIGHT',
      startDate: new Date('2026-08-01T21:00:00.000Z')
    }, NEW_ACTION_ANALYSIS, explodingAdapter, { ai: { shortNames: false } });
  } finally {
    restore();
  }

  assert.equal(withShortName.shortName, 'BEEF-MINCE', 'existing shortName untouched');
  assert.equal(staticShortName.shortName, undefined, 'static-stamped field never derived over');
  assert.equal(passDisabled.shortName, undefined, 'ai.shortNames: false disables the pass');
  assert.equal(lines.some(line => line.startsWith('🏷️ SHORTNAME:')), false, 'no shortName logs fired');
});

test('final build survives shortName transport failure and gate rejection unchanged', async () => {
  const core = createFinalBuildCore();

  // Transport throws → callAiGenerate returns null → unusable response.
  const throwingAdapter = { postJson: async () => { throw new Error('connection refused'); } };
  const lines = [];
  const restore = captureFinalBuildLogs(lines);
  let transportFailed;
  let gateRejected;
  try {
    transportFailed = await core.buildAnalyzedCalendarEvent({
      title: 'BEEFMINCE MEET MARKET',
      startDate: new Date('2026-08-01T21:00:00.000Z')
    }, NEW_ACTION_ANALYSIS, throwingAdapter, { ai: {} });

    // Gate rejection: spliced words are not a contiguous substring.
    const splicedAdapter = createShortNameAdapter('{"shortName": {"value": "BEEF MARKET"}}');
    gateRejected = await core.buildAnalyzedCalendarEvent({
      title: 'BEEFMINCE MEET MARKET',
      startDate: new Date('2026-08-01T21:00:00.000Z')
    }, NEW_ACTION_ANALYSIS, splicedAdapter, { ai: {} });
  } finally {
    restore();
  }

  assert.equal(transportFailed.shortName, undefined, 'event ships without shortName');
  assert.ok(lines.includes('🏷️ SHORTNAME: rejected AI answer for "BEEFMINCE MEET MARKET" — unusable response'),
    `got: ${JSON.stringify(lines.filter(line => line.includes('SHORTNAME')))}`);
  assert.equal(gateRejected.shortName, undefined, 'gated answer not stored');
  assert.ok(lines.includes('🏷️ SHORTNAME: rejected AI answer for "BEEFMINCE MEET MARKET" — not a verbatim substring'));
});

test('shortName salvage: valid prefix of a rejected answer is kept', async () => {
  const core = createFinalBuildCore();
  const title = 'Club Chub Weekend 2026 — The Ultimate Celebration!';
  const calls = [];
  const baseAdapter = createShortNameAdapter('{"shortName": {"value": "CLUB CHUB 2026", "reason": "merged"}}');
  const adapter = { postJson: async (...args) => { calls.push(1); return baseAdapter.postJson(...args); } };
  const event = {
    title,
    startDate: new Date('2026-10-09T21:00:00.000Z'),
    city: 'fort lauderdale'
  };
  const lines = [];
  const restore = captureFinalBuildLogs(lines);
  let analyzed;
  try {
    analyzed = await core.buildAnalyzedCalendarEvent(event, NEW_ACTION_ANALYSIS, adapter, { ai: {} });
  } finally {
    restore();
  }
  assert.equal(analyzed.shortName, 'CLUB CHUB', 'trailing non-contiguous token dropped');
  assert.equal(calls.length, 1, 'no extra AI call for salvage');
  assert.ok(lines.includes(`🏷️ SHORTNAME: salvaged "CLUB CHUB" from rejected answer for "${title}"`),
    `got: ${JSON.stringify(lines.filter(l => l.includes('SHORTNAME')))}`);
});

test('shortName salvage: fully invented answer still rejects', async () => {
  const core = createFinalBuildCore();
  const title = 'Bear Happy Hour';
  const adapter = createShortNameAdapter('{"shortName": {"value": "BHH SOCIAL", "reason": "abbrev"}}');
  const event = {
    title,
    startDate: new Date('2026-08-01T21:00:00.000Z'),
    city: 'seattle'
  };
  const lines = [];
  const restore = captureFinalBuildLogs(lines);
  let analyzed;
  try {
    analyzed = await core.buildAnalyzedCalendarEvent(event, NEW_ACTION_ANALYSIS, adapter, { ai: {} });
  } finally {
    restore();
  }
  assert.equal(analyzed.shortName, undefined, 'nothing stored');
  assert.ok(lines.includes(`🏷️ SHORTNAME: rejected AI answer for "${title}" — not a verbatim substring`));
});

test('shortName salvage: hyphens-as-spaces answer is repaired to the spaced form', async () => {
  const core = createFinalBuildCore();
  const title = 'BEEFMINCE x RVT';
  const adapter = createShortNameAdapter('{"shortName": {"value": "BEEFMINCE-X-RVT"}}');
  const lines = [];
  const restore = captureFinalBuildLogs(lines);
  let analyzed;
  try {
    analyzed = await core.buildAnalyzedCalendarEvent({
      title,
      startDate: new Date('2026-09-19T21:00:00.000Z')
    }, NEW_ACTION_ANALYSIS, adapter, { ai: {} });
  } finally {
    restore();
  }
  assert.equal(analyzed.shortName, 'BEEFMINCE X RVT', 'hyphens turned back into spaces (case-lift stored)');
  assert.ok(lines.includes(`🏷️ SHORTNAME: salvaged "BEEFMINCE X RVT" from rejected answer for "${title}"`));
});

test('shortName salvage: overlong answer drops tokens past punctuation and stopwords', async () => {
  const core = createFinalBuildCore();
  const title = 'Saturday 12th September – BEEFMINCE: THE BIG BALL';
  const adapter = createShortNameAdapter('{"shortName": {"value": "BEEFMINCE: THE BIG BALL"}}');
  const lines = [];
  const restore = captureFinalBuildLogs(lines);
  let analyzed;
  try {
    analyzed = await core.buildAnalyzedCalendarEvent({
      title,
      startDate: new Date('2026-09-12T21:00:00.000Z')
    }, NEW_ACTION_ANALYSIS, adapter, { ai: {} });
  } finally {
    restore();
  }
  assert.equal(analyzed.shortName, 'BEEFMINCE', 'never ends on ": THE" — falls through to the brand');
  assert.ok(lines.includes(`🏷️ SHORTNAME: salvaged "BEEFMINCE" from rejected answer for "${title}"`));
});

test('shortName gate: mid-word cut is not a verbatim substring', () => {
  const core = createFinalBuildCore();
  assert.equal(core.evaluateDerivedShortName('BEEFMINCE MEET MARKET', 'BEEF', 16).ok, false, 'mid-word cut rejected');
  assert.equal(core.evaluateDerivedShortName('BEEFMINCE MEET MARKET', 'BEEFMINCE', 16).ok, true, 'word-aligned accepted');
});

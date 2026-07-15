const test = require('node:test');
const assert = require('node:assert/strict');

const { SharedCore } = require('./shared-core');
const { EventSchema } = require('./event-schema');

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

test('guardrail: cross-host root-vs-deep URLs still go to the AI', async () => {
  const core = createCore();
  const { scraped, existing } = buildAlignedArbitrationPair();
  scraped.website = 'https://ticketmaster.com/';
  existing.notes += '\nwebsite: https://bearracuda.com/events/portland-pridefriday/';
  const adapter = buildArbitrationAdapter({
    website: { pick: 'calendar', value: 'https://bearracuda.com/events/portland-pridefriday/' }
  });

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 1, 'different hosts are a genuine question for the AI');
  assert.match(adapter.calls[0].prompt, /field: website/);
  assert.equal(finalEvent.website, 'https://bearracuda.com/events/portland-pridefriday/');
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
  assert.equal(core.resolveConflictDeterministically('address', '722 E Burnside', '722 East Burnside Street'), null);
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

test('detectParserFromUrl (the parser:"auto" resolver) maps legacy sites and falls back to ai-web', () => {
  const core = createCore();
  assert.equal(core.detectParserFromUrl('https://www.chunk-party.com'), 'chunk');
  assert.equal(core.detectParserFromUrl('https://linktr.ee/cubhouse'), 'linktree');
  assert.equal(core.detectParserFromUrl('https://www.eventbrite.com/o/some-org-123'), 'ai-web');
  assert.equal(core.detectParserFromUrl(''), 'ai-web');
});

test('processParser: absent parser pins ai-web; parser:"auto" opts into legacy detection + auto-switching', async () => {
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
    return { 'ai-web': stubParser('ai-web'), chunk: stubParser('chunk'), linktree: stubParser('linktree') };
  };
  const entry = (extra) => ({
    name: 'Dispatch',
    urls: ['https://www.chunk-party.com', 'https://linktr.ee/dispatch'],
    ai: { classifyPages: false }, // keep the crawl deterministic (no AI second opinion)
    ...extra
  });

  // Absent parser → pinned ai-web for every URL, even ones matching legacy mappings
  const absentCalls = [];
  const absent = await core.processParser(entry({}), {}, httpAdapter, display, makeParsers(absentCalls));
  assert.equal(absent.parserType, 'ai-web');
  assert.deepEqual(absentCalls, ['ai-web', 'ai-web'], 'no per-URL auto-switching without parser:"auto"');

  // parser: "auto" → the old absence behavior: legacy detection from the first URL
  // plus per-URL parser auto-switching for the rest of the crawl
  const autoCalls = [];
  const auto = await core.processParser(entry({ parser: 'auto' }), {}, httpAdapter, display, makeParsers(autoCalls));
  assert.equal(auto.parserType, 'chunk');
  assert.deepEqual(autoCalls, ['chunk', 'linktree']);

  // Explicit parser names keep working unchanged (pinned, no switching)
  const explicitCalls = [];
  const explicit = await core.processParser(entry({ parser: 'chunk' }), {}, httpAdapter, display, makeParsers(explicitCalls));
  assert.equal(explicit.parserType, 'chunk');
  assert.deepEqual(explicitCalls, ['chunk', 'chunk']);
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

test('arbitration prompt omits the organizer line when no event carries _organizer', async () => {
  const core = createCore();
  const { scraped, existing } = buildArbitrationPair();
  const adapter = buildArbitrationAdapter({});

  await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 1);
  assert.ok(!/KNOWN ORGANIZER/.test(adapter.calls[0].prompt));
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

test('deduplicateEvents does not merge same-URL records with incompatible titles', async () => {
  const core = createCore();
  // Two DIFFERENT parties whose records both point at a shared path'd listing URL
  // (e.g. a weekend calendar) on close dates: titles disagree, so no merge.
  const friday = {
    title: 'BEAR NIGHT',
    bar: 'Cell Block',
    city: 'chicago',
    timezone: 'America/Chicago',
    startDate: new Date('2026-07-24T21:00:00.000Z'),
    url: 'https://venue-site.com/weekend-lineup',
    source: 'ai-web'
  };
  const saturday = {
    title: 'UNDERWEAR PARTY',
    bar: 'Cell Block',
    city: 'chicago',
    timezone: 'America/Chicago',
    startDate: new Date('2026-07-25T21:00:00.000Z'),
    url: 'https://venue-site.com/weekend-lineup',
    source: 'ai-web'
  };

  const result = await core.deduplicateEvents([friday, saturday], null);
  assert.equal(result.length, 2, 'same URL with unrelated titles must stay separate events');
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

test('a genuinely differing scraped cover still reaches arbitration and the winner is applied', async () => {
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
    cover: { pick: 'scraped', value: '$46.13-$61.50', reason: 'current listed price' }
  });

  const finalEvent = await core.createFinalEventObject(existing, scraped, { httpAdapter: adapter });

  assert.equal(adapter.calls.length, 1, 'a genuine cover conflict must reach arbitration');
  assert.match(adapter.calls[0].prompt, /field: cover/);
  assert.equal(finalEvent.cover, '$46.13-$61.50');
  assert.equal(core.parseNotesIntoFields(finalEvent.notes).cover, '$46.13-$61.50');
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

  await core.processParser(
    { name: 'New Site', urls: ['https://www.eventbrite.com/o/newsite-123'], discoveryOnly: true, ai: CRAWL_AI },
    {}, httpAdapter, display, parsers
  );

  assert.ok(display.logs.some(line => line.startsWith('SYSTEM: New Site → Discovery only mode (depth adaptive)')),
    'discoveryOnly startup line carries the adaptive marker when depth is absent');
  const block = display.logs.find(line => line.startsWith('📋 SUGGESTED CONFIG for "New Site"'));
  assert.ok(block, 'suggested config emitted after discovery');
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

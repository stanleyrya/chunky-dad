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

test('evaluateAutomationForParser requires an explicit automationEnabled: true under filtering', () => {
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
  assert.deepEqual(
    core.evaluateAutomationForParser({ name: 'No Flag' }, filtering),
    { shouldRun: false, reason: 'automation-disabled' }
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
      { name: 'No Automation Flag', enabled: true, urls: [] }
    ]
  };

  const results = await core.processEvents(config, {}, display, STUB_PARSERS);

  assert.deepEqual(results.parserResults.map(r => r.name), ['Disabled But Automated'],
    '"enabled" is a manual-run switch; automation only honors automationEnabled');
  assert.deepEqual(results.automationSkippedParsers,
    [{ name: 'No Automation Flag', reason: 'automation-disabled' }]);
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

test('filterBearEvents: alwaysBear keeps everything and stamps isBearEvent', () => {
  const core = createCore();
  const events = [
    { title: 'Techno Tuesday' },
    { title: 'Wine Tasting' }
  ];
  const result = core.filterBearEvents(events, { alwaysBear: true });
  assert.equal(result.length, 2);
  assert.ok(result.every(e => e.isBearEvent === true));
});

test('filterBearEvents matches bear keywords in title, description, or bar', () => {
  const core = createCore();
  const events = [
    { title: 'Bear Night' },
    { title: 'Saturday Social', description: 'hosted by your favorite cub DJ' },
    { title: 'Happy Hour', bar: 'Woof Lounge' },
    { title: 'Techno Tuesday', description: 'four to the floor' }
  ];
  const result = core.filterBearEvents(events, {});
  assert.deepEqual(result.map(e => e.title), ['Bear Night', 'Saturday Social', 'Happy Hour']);
});

test('filterBearEvents: requireKeywords + allowlist gates keyword matching', () => {
  const core = createCore();
  const events = [
    { title: 'Bear Night at the Eagle' },
    { title: 'FURBALL Bear Bash' }
  ];
  // Both match bear keywords, but only the allowlisted one passes the gate
  const result = core.filterBearEvents(events, { allowlist: ['furball'], requireKeywords: true });
  assert.deepEqual(result.map(e => e.title), ['FURBALL Bear Bash']);
});

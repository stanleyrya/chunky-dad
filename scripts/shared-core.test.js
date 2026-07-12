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

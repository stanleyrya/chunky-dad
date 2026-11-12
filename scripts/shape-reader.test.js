const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ---------------------------------------------------------------------------
// tools/shape-reader.js — the second reader of a deck card: the local text
// model proofreads the record and may name a problem only with the record's
// own words. Node-only tooling; never ships to the phone. No test here
// reaches a model: the fetch is a stub.
// ---------------------------------------------------------------------------
const reader = require('../tools/shape-reader');
const shape = require('../tools/event-shape');

function proposal(overrides = {}) {
  return {
    kind: 'new',
    key: 'event|furball nyc|rockbar|2030-10-03',
    title: 'FURBALL NYC',
    startDate: '2030-10-04T02:00:00.000Z',
    endDate: '2030-10-04T06:00:00.000Z',
    timezone: 'America/New_York',
    bar: 'Rockbar',
    address: '185 Christopher St, New York, NY',
    city: 'nyc',
    url: 'https://furball.nyc/',
    description: 'The bear dance party. Doors at 10pm.',
    ...overrides
  };
}

const AI = { endpoint: 'http://model.test/v1/chat/completions', model: 'test-model' };

function answering(problemsFor) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const record = body.messages[1].content;
    const result = problemsFor(record);
    if (result instanceof Error) throw result;
    if (result && result.status) return { ok: false, status: result.status, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: typeof result === 'string' ? result : JSON.stringify({ problems: result }) } }] }) };
  };
  return { fetchImpl, calls };
}

test('the record the reader sees: the card in words — local clock, flyer text, the changes an update makes; links, pins and pictures are left out', () => {
  const text = reader.buildReaderRecord(proposal(), { text: 'FURBALL\nTHURSDAY OCT 3\nDOORS 10PM' });
  assert.ok(text.includes('kind: a new event'));
  assert.ok(text.includes('name: FURBALL NYC'));
  assert.ok(text.includes('starts: Thursday, October 3, 2030 at 10:00 PM (America/New_York)'));
  assert.ok(text.includes('ends: Friday, October 4, 2030 at 2:00 AM'));
  assert.ok(text.includes('flyer text: """FURBALL\nTHURSDAY OCT 3\nDOORS 10PM"""'));
  assert.ok(!text.includes('furball.nyc'), 'a link is not the reader\'s to judge, and a new link does not ask it again');

  const update = reader.buildReaderRecord(proposal({ kind: 'merge', changes: {
    title: { from: 'FURBALL NYC', to: 'Load more' },
    url: { from: 'https://a.example/', to: 'https://b.example/' },
    location: { from: '1, 1', to: '2, 2' },
    startDate: { from: '2030-10-04T02:00:00.000Z', to: '2030-10-04T03:00:00.000Z' }
  } }), null);
  assert.ok(update.includes('kind: an update to a saved event'));
  assert.ok(update.includes('  title: saved "FURBALL NYC" becomes "Load more"'));
  assert.ok(update.includes('  startDate: saved "Thursday, October 3, 2030 at 10:00 PM" becomes "Thursday, October 3, 2030 at 11:00 PM"'));
  assert.ok(!update.includes('a.example') && !update.includes('location:'));

  // A record with no time of day says so, instead of showing midnight.
  const wholeDay = reader.buildReaderRecord(proposal({ startDate: '2030-10-03T04:00:00.000Z', endDate: '2030-10-04T03:59:00.000Z' }), null);
  assert.ok(wholeDay.includes('starts: Thursday, October 3, 2030 (no time of day is known for this record)'));
  assert.ok(!wholeDay.includes('ends:'));

  // The same words are the same question; any other words are another.
  assert.equal(reader.readerKey(text), reader.readerKey(reader.buildReaderRecord(proposal({ url: 'https://other.example/' }), { text: 'FURBALL\nTHURSDAY OCT 3\nDOORS 10PM' })));
  assert.notEqual(reader.readerKey(text), reader.readerKey(update));
});

test('an answer counts only with the record\'s own words: no quote, a quote from nowhere, an unknown field or "this is fine" is thrown away', () => {
  const text = reader.buildReaderRecord(proposal({ description: 'Doors at 9pm sharp.' }), { text: 'FURBALL — FRIDAY OCT 4' });
  const parsed = reader.parseReaderAnswer(JSON.stringify({ problems: [
    { field: 'time', problem: 'The description says doors at 9pm but the record starts at 10pm.', quote: 'Doors at 9pm sharp' },
    { field: 'date', problem: 'The flyer says Friday.', quote: 'FRIDAY, OCT 4' },
    { field: 'place', problem: 'The flyer names another venue.', quote: 'The Eagle' },
    { field: 'name', problem: 'The name is cut off.', quote: '' },
    { field: 'links', problem: 'The link looks wrong.', quote: 'FURBALL NYC' },
    { field: 'change', problem: 'The new name is not worse than the saved one.', quote: 'FURBALL NYC' },
    { field: 'time', problem: 'A second time problem.', quote: 'Doors at 9pm' }
  ] }), text);
  assert.equal(parsed.usable, true);
  assert.deepEqual(parsed.problems, [
    { field: 'time', problem: 'The description says doors at 9pm but the record starts at 10pm.', quote: 'Doors at 9pm sharp' },
    { field: 'date', problem: 'The flyer says Friday.', quote: 'FRIDAY, OCT 4' }
  ], 'punctuation and case in a quote do not matter; one problem per field');

  for (const fine of ['No discrepancy between the flyer and the record.', 'This is an improvement over the saved name.', 'The change is acceptable.', 'No time problem here.', 'The date is consistent with the record.']) {
    assert.deepEqual(reader.parseReaderAnswer(JSON.stringify({ problems: [{ field: 'date', problem: fine, quote: 'FURBALL NYC' }] }), text).problems, [], fine);
  }
  assert.deepEqual(reader.parseReaderAnswer('```json\n{"problems":[]}\n```', text), { usable: true, problems: [] });
  assert.deepEqual(reader.parseReaderAnswer('I think it is fine.', text), { usable: false, problems: [] });
  assert.deepEqual(reader.parseReaderAnswer('{"verdict":"ok"}', text), { usable: false, problems: [] });
});

test('the model asked is the run\'s own: a chat-completions endpoint with a model, or the reader is off', () => {
  const payload = (ai) => ({ config: { config: { ai } } });
  assert.deepEqual(reader.resolveReaderAi(payload({ enabled: true, endpoint: AI.endpoint, model: AI.model, temperature: 0 })), AI);
  assert.equal(reader.resolveReaderAi(payload({ enabled: false, endpoint: AI.endpoint, model: AI.model })), null);
  assert.equal(reader.resolveReaderAi(payload({ endpoint: 'http://model.test/api/generate', model: AI.model })), null);
  assert.equal(reader.resolveReaderAi(payload({ endpoint: AI.endpoint })), null);
  assert.equal(reader.resolveReaderAi({}), null);
  assert.equal(reader.resolveReaderAi(null), null);
});

test('the reader: a miss is queued and answered in the background, the answer is kept by the record\'s text, and the same card is never asked twice', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shape-reader-'));
  const cachePath = path.join(dir, 'server', reader.READER_CACHE_FILE_NAME);
  const { fetchImpl, calls } = answering((record) => (/Doors at 9pm/.test(record) ? [{ field: 'time', problem: 'Doors are at 9pm, the record says 10pm.', quote: 'Doors at 9pm' }] : []));
  const lines = [];
  const first = reader.createShapeReader({ cachePath, ai: AI, fetchImpl, log: (line) => lines.push(line) });
  const fine = proposal();
  const late = proposal({ key: 'event|furball nyc|rockbar|2030-10-10', description: 'Doors at 9pm.' });

  assert.equal(first.lookup(fine, null), null, 'not read yet');
  assert.equal(first.lookup(fine, null), null);
  assert.equal(first.lookup(late, null), null);
  assert.equal(first.pending(), 2, 'one question per record, however often the deck is built');
  assert.equal(first.lookup({ ...fine, kind: 'gone' }, null), undefined, 'only new events and updates are read');

  const both = first.drain();
  assert.equal(first.drain(), both, 'one drain at a time');
  await both;
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, AI.endpoint);
  assert.equal(calls[0].body.model, AI.model);
  assert.equal(calls[0].body.temperature, 0);
  assert.equal(calls[0].body.messages[0].content, reader.READER_SYSTEM_PROMPT);
  assert.ok(calls[0].body.messages[1].content.startsWith('RECORD\nkind: a new event'));
  assert.deepEqual(first.lookup(fine, null), { problems: [] });
  assert.deepEqual(first.lookup(late, null), { problems: [{ field: 'time', problem: 'Doors are at 9pm, the record says 10pm.', quote: 'Doors at 9pm' }] });
  assert.deepEqual(first.stats(), { asked: 2, flagged: 1, failed: 0, pending: 0 });
  assert.ok(lines.some((line) => /read 2 record/.test(line)));

  // A restarted server reads the file and asks nothing.
  const second = reader.createShapeReader({ cachePath, ai: AI, fetchImpl });
  assert.deepEqual(second.lookup(late, null).problems.map((problem) => problem.field), ['time']);
  assert.equal(second.pending(), 0);
  await second.drain();
  assert.equal(calls.length, 2);

  // No model, no reader: the card carries no reader check at all.
  const off = reader.createShapeReader({ cachePath, ai: null, fetchImpl });
  assert.equal(off.lookup(fine, null), undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the reader: a model that is down stops the round, keeps the queue and is left alone for five minutes; an unreadable answer is kept as unread and not asked again; old answers are forgotten', async () => {
  let clock = Date.UTC(2030, 8, 1);
  let down = true;
  const { fetchImpl, calls } = answering(() => (down ? { status: 503 } : 'not json at all'));
  const lines = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shape-reader-'));
  const cachePath = path.join(dir, reader.READER_CACHE_FILE_NAME);
  const subject = reader.createShapeReader({ cachePath, ai: AI, fetchImpl, now: () => clock, log: (line) => lines.push(line) });
  const card = proposal();
  assert.equal(subject.lookup(card, null), null);
  await subject.drain();
  assert.equal(calls.length, 1);
  assert.equal(subject.lookup(card, null), null, 'no answer is not "fine"');
  assert.equal(subject.pending(), 1);
  assert.ok(lines.some((line) => /stopped with 1 record\(s\) unread — the model answered HTTP 503/.test(line)));

  down = false;
  await subject.drain();
  assert.equal(calls.length, 1, 'not asked again inside the wait');
  clock += reader.READER_RETRY_AFTER_MS + 1;
  await subject.drain();
  assert.equal(calls.length, 2);
  assert.equal(subject.lookup(card, null), null, 'an answer nobody can read is not "fine"');
  assert.equal(subject.pending(), 0, 'and the same words are not asked again: they would get the same answer');
  assert.equal(JSON.parse(fs.readFileSync(cachePath, 'utf8')).entries[reader.readerKey(reader.buildReaderRecord(card, null))].unusable, true);

  // 46 days later the answer is gone from the file at the next save.
  const kept = reader.saveReaderCache(cachePath, reader.loadReaderCache(cachePath), clock + 46 * 86400000);
  assert.deepEqual(kept, {});
  fs.rmSync(dir, { recursive: true, force: true });
});

test('assessShape: the reader\'s answer joins the report — unread is "not checked", a clean read passes, each problem fails its own check', () => {
  const base = { proposal: proposal({ location: '40.7326, -74.0096' }), now: Date.UTC(2030, 8, 1) };
  const none = shape.assessShape(base);
  assert.ok(!none.checks.some((check) => String(check.code).startsWith('reader')), 'nobody asked: no reader check');
  assert.equal(shape.isReaderWaiting(none), false);

  const waiting = shape.assessShape({ ...base, reader: null });
  assert.deepEqual(waiting.checks.filter((check) => check.code === 'reader'), [{ code: 'reader', ok: null, detail: '' }]);
  assert.equal(waiting.ok, true, 'unread is never a failure');
  assert.equal(shape.isReaderWaiting(waiting), true);

  const clean = shape.assessShape({ ...base, reader: { problems: [] } });
  assert.equal(clean.ok, true);
  assert.equal(shape.isReaderWaiting(clean), false);

  const flagged = shape.assessShape({ ...base, reader: { problems: [{ field: 'time', problem: 'Doors are at 9pm, the record says 10pm.', quote: 'Doors at 9pm' }] } });
  assert.equal(flagged.ok, false);
  assert.deepEqual(flagged.failed, ['reader-time']);
  assert.equal(flagged.checks.find((check) => check.code === 'reader-time').detail, 'Doors are at 9pm, the record says 10pm. — "Doors at 9pm"');
  assert.equal(shape.classifyLowRisk({ proposal: { kind: 'override' }, shape: flagged }), null, 'a card the reader flagged is never low risk');
  assert.equal(shape.classifyLowRisk({ proposal: { kind: 'override' }, shape: clean }), 'series-night');
});

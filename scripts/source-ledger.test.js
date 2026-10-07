const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SharedCore } = require('./shared-core');
const { parseSourceLedger, assessSourceHealth, SOURCE_VERDICT_ORDER } = require('./metrics-sections');
const { backfill, listRunFiles } = require('../tools/backfill-source-ledger');
const { WebAdapter } = require('./adapters/web-adapter');
// Headless load of the Scriptable adapter (same stubs its own test file uses).
global.importModule = (name) => require(path.join(__dirname, name));
global.Calendar = { forEvents: async () => [] };
global.Device = { isUsingDarkAppearance: () => false };
global.FileManager = { iCloud: () => ({ documentsDirectory: () => '/docs', joinPath: (a, b) => `${a}/${b}`, fileExists: () => false, createDirectory: () => {}, readString: () => null, writeString: () => {}, downloadFileFromiCloud: async () => {} }) };
const { ScriptableAdapter } = require('./adapters/scriptable-adapter');

// ---------------------------------------------------------------------------
// The source ledger: one line per run per website host, written by every run.
// The old metrics record was per parser and only the phone wrote it, so the
// Mac's daily scrapes (the real ones) never showed up anywhere.
// ---------------------------------------------------------------------------

function samplePayload(overrides = {}) {
  const event = (title, day, extra = {}) => ({
    title, startDate: `${day}T22:00:00.000Z`, bar: 'Eagle LA', city: 'la', timezone: 'America/Los_Angeles',
    website: `https://eaglela.com/events/${title.toLowerCase().replace(/\s+/g, '-')}/`, isBearEvent: true, ...extra
  });
  return {
    summary: { runId: '20261006-052536', timestamp: '2026-10-06T09:25:36.063Z' },
    runContext: { type: 'manual', environment: 'scriptable', trigger: 'owner-review', original: { type: 'automated', environment: 'node', trigger: 'scheduled' } },
    parserResults: [
      {
        name: 'Eagle LA', totalEvents: 4, durationMs: 1200,
        config: { urls: ['https://eaglela.com/events/', 'https://eaglela.com/calendar/'] },
        urlClassifications: { 'https://eaglela.com/events/': 'multi-event-page', 'https://eaglela.com/events/bluf/': 'event-page', 'https://www.eventbrite.com/e/123': 'event-page' },
        events: [event('BLUF LA', '2026-11-20'), event('Beer Bust', '2026-10-11'), event('Old Night', '2026-09-01'), event('Karaoke', '2026-10-12', { isBearEvent: false })]
      },
      {
        name: 'Dead Bar', totalEvents: 0, durationMs: 300, config: { urls: ['https://deadbar.example/calendar/'] }, urlClassifications: {}, events: []
      },
      {
        name: 'Quiet Bar', totalEvents: 0, durationMs: 100, config: { urls: ['https://quietbar.example/'] }, urlClassifications: { 'https://quietbar.example/': 'other' }, events: []
      }
    ],
    analyzedEvents: [
      { ...event('BLUF LA', '2026-11-20'), _action: 'merge' },
      { ...event('Beer Bust', '2026-10-11'), _action: 'new' },
      { title: 'Unattributed', startDate: '2026-10-20T00:00:00.000Z', website: 'https://elsewhere.example/x/y', _action: 'new' }
    ],
    errors: ['SYSTEM: Failed to process URL https://deadbar.example/calendar/: HTTP request failed: HTTP 522: ', 'SYSTEM: something else'],
    ...overrides
  };
}

test('buildSourceLedger: one line per host, attributed by the pages actually fetched, scrape context unwrapped from a phone re-save', () => {
  const built = SharedCore.buildSourceLedger(samplePayload(), { now: new Date('2026-10-06T12:00:00Z') });
  assert.deepEqual(built.records.map((r) => r.host), ['deadbar.example', 'eaglela.com', 'quietbar.example']);
  const eagle = built.records.find((r) => r.host === 'eaglela.com');
  assert.equal(eagle.run_id, '20261006-052536');
  assert.equal(eagle.environment, 'node', 'the scrape happened on the Mac even though the phone re-saved the run');
  assert.equal(eagle.trigger, 'scheduled');
  assert.deepEqual(eagle.parsers, ['Eagle LA']);
  assert.equal(eagle.pages, 2, 'two eaglela.com pages fetched');
  assert.equal(eagle.outbound_pages, 1, 'the eventbrite page is an outbound crawl, not this host');
  assert.equal(eagle.extracted, 4);
  assert.equal(eagle.events, 4);
  assert.equal(eagle.bear, 3);
  assert.equal(eagle.upcoming, 3, 'Old Night already happened');
  assert.deepEqual(eagle.proposals, { new: 1, merge: 1 });
  assert.equal(eagle.duration_ms, 1200);
  assert.equal(eagle.status, 'ok');
  assert.equal(eagle.page_errors, 0);
  const dead = built.records.find((r) => r.host === 'deadbar.example');
  assert.equal(dead.status, 'dead');
  assert.equal(dead.page_errors, 1);
  assert.match(dead.errors[0], /HTTP 522/);
  const quiet = built.records.find((r) => r.host === 'quietbar.example');
  assert.equal(quiet.status, 'empty');
  assert.deepEqual(Object.keys(built.upcoming.hosts).sort(), ['deadbar.example', 'eaglela.com', 'quietbar.example']);
  assert.equal(Object.keys(built.upcoming.hosts['eaglela.com'].upcoming).length, 3);
  assert.ok(built.upcoming.hosts['eaglela.com'].upcoming['bluf la|eagle la|2026-11-20'], 'keys are title|place|local day');
});

test('buildSourceLedger: a working site that yields nothing bear is ok, not empty', () => {
  const payload = samplePayload();
  payload.parserResults[0].events = [];
  const built = SharedCore.buildSourceLedger(payload, { now: new Date('2026-10-06T12:00:00Z') });
  const eagle = built.records.find((r) => r.host === 'eaglela.com');
  assert.equal(eagle.extracted, 4);
  assert.equal(eagle.events, 0);
  assert.equal(eagle.status, 'ok');
});

test('buildSourceLedger: vanished = upcoming last time, still in the future, missing now; a dead site keeps its previous snapshot', () => {
  const first = SharedCore.buildSourceLedger(samplePayload(), { now: new Date('2026-10-06T12:00:00Z') });
  const second = samplePayload({ summary: { runId: '20261007-052536', timestamp: '2026-10-07T09:25:36.063Z' } });
  second.parserResults[0].events = second.parserResults[0].events.filter((e) => e.title !== 'BLUF LA');
  second.parserResults[0].totalEvents = 3;
  const next = SharedCore.buildSourceLedger(second, { now: new Date('2026-10-07T12:00:00Z'), previousUpcoming: first.upcoming });
  const eagle = next.records.find((r) => r.host === 'eaglela.com');
  assert.deepEqual(eagle.vanished, [{ key: 'bluf la|eagle la|2026-11-20', title: 'BLUF LA', day: '2026-11-20', bear: true, last_seen: '20261006-052536' }]);
  assert.equal(next.upcoming.hosts['eaglela.com'].run_id, '20261007-052536');

  // The dead site had an upcoming snapshot from an earlier good run: keep it.
  const withDeadHistory = { ...first.upcoming, hosts: { ...first.upcoming.hosts, 'deadbar.example': { run_id: '20261001-000000', finished_at: '2026-10-01T00:00:00Z', upcoming: { 'x|deadbar|2026-12-01': { title: 'X', day: '2026-12-01', bear: true } } } } };
  const afterDead = SharedCore.buildSourceLedger(second, { now: new Date('2026-10-07T12:00:00Z'), previousUpcoming: withDeadHistory });
  const dead = afterDead.records.find((r) => r.host === 'deadbar.example');
  assert.equal(dead.status, 'dead');
  assert.deepEqual(dead.vanished, [], 'unreachable is not "the events went away"');
  assert.equal(afterDead.upcoming.hosts['deadbar.example'].run_id, '20261001-000000', 'the last good snapshot survives a dead run');

  // Hosts that did not run this time keep their snapshot too.
  const partial = samplePayload({ summary: { runId: '20261008-000000', timestamp: '2026-10-08T00:00:00Z' } });
  partial.parserResults = partial.parserResults.slice(0, 1);
  const afterPartial = SharedCore.buildSourceLedger(partial, { now: new Date('2026-10-08T12:00:00Z'), previousUpcoming: afterDead.upcoming });
  assert.equal(afterPartial.records.length, 1);
  assert.ok(afterPartial.upcoming.hosts['quietbar.example'], 'a host that did not run keeps its snapshot');
});

test('buildSourceLedger: a parser without configured urls is keyed by the majority host of its events, then by its name', () => {
  const payload = samplePayload();
  payload.parserResults = [
    { name: 'Shared pages', totalEvents: 2, config: {}, events: [
      { title: 'A', startDate: '2026-11-01T00:00:00Z', website: 'https://inbox.chunky.dad/page/a', isBearEvent: true },
      { title: 'B', startDate: '2026-11-02T00:00:00Z', website: 'https://inbox.chunky.dad/page/b', isBearEvent: true }
    ] },
    { name: 'Local Import', totalEvents: 0, config: {}, events: [] }
  ];
  payload.analyzedEvents = [];
  payload.errors = [];
  const built = SharedCore.buildSourceLedger(payload, { now: new Date('2026-10-06T12:00:00Z') });
  assert.deepEqual(built.records.map((r) => r.host), ['inbox.chunky.dad', 'local-import']);
});

test('assessSourceHealth: verdicts, trouble-first order, since, baseline', () => {
  const line = (host, runId, extracted, extra = {}) => ({
    v: 1, run_id: runId, finished_at: `2026-10-${runId.slice(6, 8)}T05:00:00Z`, host, parsers: [host], extracted, events: extracted, bear: extracted, upcoming: extracted, proposals: { new: 0, merge: 0 }, status: extracted > 0 ? 'ok' : 'empty', vanished: [], page_errors: 0, duration_ms: 10, ...extra
  });
  const records = [
    ...['20261001-050000', '20261002-050000', '20261003-050000', '20261004-050000'].map((id) => line('steady.example', id, 20)),
    line('steady.example', '20261005-050000', 21),
    ...['20261001-050000', '20261002-050000', '20261003-050000'].map((id) => line('stopped.example', id, 12)),
    line('stopped.example', '20261005-050000', 0),
    ...['20261001-050000', '20261002-050000', '20261003-050000'].map((id) => line('shrunk.example', id, 30)),
    line('shrunk.example', '20261004-050000', 9),
    line('shrunk.example', '20261005-050000', 8),
    line('dead.example', '20261004-050000', 15),
    line('dead.example', '20261005-050000', 0, { status: 'dead', page_errors: 2, errors: ['HTTP 403'] }),
    line('never.example', '20261004-050000', 0),
    line('never.example', '20261005-050000', 0),
    line('gone.example', '20261005-050000', 9, { vanished: [{ key: 'k', title: 'Gone Night', day: '2026-11-01', bear: true, last_seen: '20261004-050000' }] }),
    line('old.example', '20260925-050000', 5, { finished_at: '2026-09-25T05:00:00Z' })
  ];
  const health = assessSourceHealth(records, { now: new Date('2026-10-05T12:00:00Z') });
  const verdictOf = (host) => health.rows.find((r) => r.host === host);
  assert.equal(verdictOf('steady.example').verdict, 'ok');
  assert.equal(verdictOf('steady.example').baseline, 20);
  assert.equal(verdictOf('stopped.example').verdict, 'stopped');
  assert.equal(verdictOf('stopped.example').since, '20261005-050000');
  assert.equal(verdictOf('shrunk.example').verdict, 'shrunk');
  assert.equal(verdictOf('shrunk.example').since, '20261004-050000', 'trouble began the first run under half the baseline');
  assert.equal(verdictOf('dead.example').verdict, 'dead');
  assert.equal(verdictOf('never.example').verdict, 'empty');
  assert.equal(verdictOf('gone.example').verdict, 'vanished');
  assert.equal(verdictOf('old.example').verdict, 'quiet');
  assert.deepEqual(health.rows.map((r) => r.verdict), ['dead', 'stopped', 'shrunk', 'empty', 'vanished', 'quiet', 'ok']);
  assert.deepEqual(health.rows.map((r) => r.verdict), SOURCE_VERDICT_ORDER);
  assert.equal(health.troubled, 6);
  assert.equal(health.hosts, 7);
  assert.equal(verdictOf('steady.example').series.length, 5);
});

test('parseSourceLedger tolerates torn lines', () => {
  const records = parseSourceLedger('{"host":"a.example","run_id":"1"}\n{"host":"b.exam\n\n{"nohost":true}\n{"host":"c.example"}\n');
  assert.deepEqual(records.map((r) => r.host), ['a.example', 'c.example']);
});

test('backfill rebuilds the ledger from runs/ and archive/runs/, oldest first, live copy winning over an archived twin', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-ledger-'));
  fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'archive', 'runs'), { recursive: true });
  const first = samplePayload();
  const second = samplePayload({ summary: { runId: '20261007-052536', timestamp: '2026-10-07T09:25:36.063Z' } });
  second.parserResults[0].events = second.parserResults[0].events.filter((e) => e.title !== 'BLUF LA');
  fs.writeFileSync(path.join(root, 'archive', 'runs', '20261006-052536.json'), JSON.stringify({ ...first, parserResults: [] }));
  fs.writeFileSync(path.join(root, 'runs', '20261006-052536.json'), JSON.stringify(first));
  fs.writeFileSync(path.join(root, 'runs', '20261007-052536.json'), JSON.stringify(second));
  fs.writeFileSync(path.join(root, 'runs', 'notes.txt'), 'ignored');
  assert.deepEqual(listRunFiles(root).map(([id, file]) => [id, path.relative(root, file)]), [
    ['20261006-052536', path.join('runs', '20261006-052536.json')],
    ['20261007-052536', path.join('runs', '20261007-052536.json')]
  ]);
  const logs = [];
  const result = backfill(root, { log: (line) => logs.push(line) });
  assert.equal(result.runs.length, 2);
  const records = parseSourceLedger(fs.readFileSync(path.join(root, 'metrics', 'sources.ndjson'), 'utf8'));
  assert.equal(records.length, 6);
  const secondEagle = records.find((r) => r.run_id === '20261007-052536' && r.host === 'eaglela.com');
  assert.equal(secondEagle.vanished.length, 1, 'vanished is derived run over run during the backfill');
  const upcoming = JSON.parse(fs.readFileSync(path.join(root, 'metrics', 'source-upcoming.json'), 'utf8'));
  assert.equal(upcoming.run_id, '20261007-052536');
  assert.match(logs[logs.length - 1], /wrote 6 line/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('WebAdapter.appendSourceLedger writes the ledger + snapshot under the shared root and is idempotent per run id', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-ledger-web-'));
  const adapter = new WebAdapter({});
  adapter.isNode = true;
  adapter.sharedStorageRoot = root;
  adapter.fs = fs;
  adapter.path = path;
  const payload = samplePayload();
  const built = await adapter.appendSourceLedger(payload, '20261006-052536');
  assert.equal(built.records.length, 3);
  const ledgerPath = path.join(root, 'metrics', 'sources.ndjson');
  assert.equal(parseSourceLedger(fs.readFileSync(ledgerPath, 'utf8')).length, 3);
  assert.ok(fs.existsSync(path.join(root, 'metrics', 'source-upcoming.json')));
  const again = await adapter.appendSourceLedger(payload, '20261006-052536');
  assert.equal(again, null, 'a phone execute re-saving the same run adds nothing');
  assert.equal(parseSourceLedger(fs.readFileSync(ledgerPath, 'utf8')).length, 3);
  const next = samplePayload({ summary: { runId: '20261007-052536', timestamp: '2026-10-07T09:25:36.063Z' } });
  next.parserResults[0].events = next.parserResults[0].events.filter((e) => e.title !== 'BLUF LA');
  await adapter.appendSourceLedger(next, '20261007-052536');
  const records = parseSourceLedger(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(records.length, 6);
  assert.equal(records.find((r) => r.run_id === '20261007-052536' && r.host === 'eaglela.com').vanished.length, 1, 'the second write reads the snapshot the first one left');
  fs.rmSync(root, { recursive: true, force: true });
});

test('ScriptableAdapter.appendSourceLedger writes through the file manager and is idempotent per run id', async () => {
  const adapter = new ScriptableAdapter({ cities: {} });
  const files = new Map();
  adapter.fm = {
    documentsDirectory: () => '/docs', joinPath: (a, b) => `${a}/${b}`,
    fileExists: (p) => files.has(p), isDirectory: () => false, createDirectory: () => {},
    readString: (p) => (files.has(p) ? files.get(p) : null), writeString: (p, s) => { files.set(p, s); },
    downloadFileFromiCloud: async () => {}
  };
  adapter.metricsDir = '/docs/chunky-dad-data/metrics';
  const payload = samplePayload();
  const built = await adapter.appendSourceLedger(payload, '20261006-052536');
  assert.equal(built.records.length, 3);
  assert.equal(parseSourceLedger(files.get('/docs/chunky-dad-data/metrics/sources.ndjson')).length, 3);
  assert.ok(files.get('/docs/chunky-dad-data/metrics/source-upcoming.json'));
  assert.equal(await adapter.appendSourceLedger(payload, '20261006-052536'), null);
  assert.equal(parseSourceLedger(files.get('/docs/chunky-dad-data/metrics/sources.ndjson')).length, 3);
});

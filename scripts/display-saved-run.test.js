const test = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// scripts/display-saved-run.js — the phone's saved-run script. Under Node the
// auto-run block is skipped (same guard as bear-event-scraper-unified.js), so
// the class and the launch-option parser can be exercised headlessly.
// ---------------------------------------------------------------------------
const { SavedRunDisplay, parseLaunchOptions } = require('./display-saved-run');

test('parseLaunchOptions: reviewExecute needs a runId; the display defaults are unchanged', () => {
  const review = parseLaunchOptions({ runId: '20260913-051750', reviewExecute: '1' });
  assert.equal(review.reviewExecute, true);
  assert.equal(review.runId, '20260913-051750');
  assert.equal(review.presentHistory, false);
  assert.equal(review.readOnly, true, 'readOnly is only lowered by the reviewed path itself');

  assert.equal(parseLaunchOptions({ reviewExecute: '1' }).reviewExecute, false, 'no runId → a plain display launch');
  const plain = parseLaunchOptions({});
  assert.deepEqual(plain, { snapshot: false, last: false, runId: null, presentHistory: true, readOnly: true, reviewExecute: false, runUrl: null });
  // The Mac's own copy of the run rides along, https only, and only for an execute.
  assert.equal(parseLaunchOptions({ runId: '20261029-205035', reviewExecute: '1', runUrl: 'https://mac.example.ts.net/review/run/20261029-205035.json' }).runUrl,
    'https://mac.example.ts.net/review/run/20261029-205035.json');
  assert.equal(parseLaunchOptions({ runId: '20261029-205035', reviewExecute: '1', runUrl: 'http://mac.local:8734/review/run/20261029-205035.json' }).runUrl, null, 'plain http is not trusted');
  assert.equal(parseLaunchOptions({ runId: '20261029-205035', runUrl: 'https://mac.example.ts.net/review/run/x.json' }).runUrl, null, 'a display launch never fetches');
  assert.equal(parseLaunchOptions({}, 'last').last, true);
  assert.equal(parseLaunchOptions({}, 'runid:20260101-000000').runId, '20260101-000000');
  assert.equal(parseLaunchOptions({ runid: '20260101-000000', readOnly: 'false' }).readOnly, false);
});

function savedPayload() {
  return {
    version: 2,
    summary: { runId: '20260913-051750', timestamp: '2026-09-13T03:17:50.000Z', totals: { totalEvents: 2, bearEvents: 2 } },
    runContext: { environment: 'node', type: 'automated' },
    config: { parsers: [{ name: 'Furball', dryRun: false }], config: { dryRun: true } },
    analyzedEvents: [{ title: 'FURBALL NYC', _action: 'new' }],
    bearDroppedEvents: [],
    parserResults: [{ name: 'Furball', totalEvents: 1, bearEvents: 1 }],
    errors: [],
    executions: [{ executedAt: '2026-09-13T12:00:00.000Z' }]
  };
}

test('buildResultsLike: readOnly forces parser dryRun; the reviewed path keeps the original parsers and threads executions back', () => {
  const display = new SavedRunDisplay();
  const readOnly = display.buildResultsLike(savedPayload(), { readOnly: true });
  assert.equal(readOnly._isDisplayingSavedRun, true);
  assert.equal(readOnly.config.parsers[0].dryRun, true, 'display safety: every parser dry');
  assert.equal(readOnly._savedRunOriginalConfig.parsers[0].dryRun, false, 'original config preserved for the re-save');
  assert.equal(readOnly.sourceRunId, '20260913-051750');
  assert.deepEqual(readOnly.savedRunExecutions, [{ executedAt: '2026-09-13T12:00:00.000Z' }]);

  const writable = display.buildResultsLike(savedPayload(), { readOnly: false });
  assert.equal(writable.config.parsers[0].dryRun, false, 'reviewed execute keeps the parsers writable');
  assert.equal(writable.runContext.trigger, 'saved-run');
});

test('executeReviewedRun loads the run and the owner decisions, then hands both to the adapter without presenting', async () => {
  const display = new SavedRunDisplay();
  const captured = { errors: [] };
  display.showError = async (title, message) => { captured.errors.push({ title, message }); };
  display.loadSavedRun = async (runId) => { captured.loadedRunId = runId; return savedPayload(); };
  display.createAdapter = () => ({
    loadOwnerDecisions: async () => [{ key: 'event|furball|rockbar|2026-10-16', verdict: 'approve' }],
    executeReviewedSavedRun: async (results, decisions) => {
      captured.results = results;
      captured.decisions = decisions;
      return { approved: 1, wrote: true };
    },
    displayResults: async () => { captured.displayed = true; }
  });

  const summary = await display.executeReviewedRun({ runId: '20260913-051750', reviewExecute: true });
  assert.equal(captured.loadedRunId, '20260913-051750');
  assert.equal(captured.decisions.length, 1);
  assert.equal(captured.results._isDisplayingSavedRun, true);
  assert.equal(captured.results.config.parsers[0].dryRun, false, 'readOnly: false on the reviewed path');
  assert.equal(captured.displayed, undefined, 'no results sheet');
  assert.deepEqual(summary, { approved: 1, wrote: true });
  assert.deepEqual(captured.errors, []);
});

test('executeReviewedRun degrades with an alert when the run is missing, syncing, or unnamed', async () => {
  const display = new SavedRunDisplay();
  const errors = [];
  display.showError = async (title) => { errors.push(title); };
  display.createAdapter = () => { throw new Error('must not build an adapter without a run'); };

  display.loadSavedRun = async () => null;
  assert.equal(await display.executeReviewedRun({ runId: '20260913-051750' }), null);
  display.loadSavedRun = async () => ({ __icloudSyncPending: true, runId: '20260913-051750' });
  assert.equal(await display.executeReviewedRun({ runId: '20260913-051750' }), null);
  assert.equal(await display.executeReviewedRun({}), null);
  assert.deepEqual(errors, ['Load failed', 'Still syncing from iCloud', 'No run named']);
});

test('a run iCloud has not delivered is fetched from the Mac when the link names it; without a copy the alert says what to do', async () => {
  const files = {};
  global.FileManager = fakeFileManager(files);
  const previousRequest = global.Request;
  const runPayload = { summary: { runId: '20261029-205035' }, analyzedEvents: [] };
  const requested = [];
  global.Request = function (url) {
    requested.push(url);
    this.response = { statusCode: 200 };
    this.loadString = async () => JSON.stringify(runPayload);
  };
  try {
    const display = new SavedRunDisplay();
    display.resolveDataRoot = () => '/icloud/chunky-dad-data';
    const notes = [];
    display.note = (line) => { notes.push(line); };

    // Missing on the phone: loadSavedRun says so instead of failing.
    const pending = await display.loadSavedRun('20261029-205035');
    assert.deepEqual(pending, { __icloudSyncPending: true, notOnPhone: true, runId: '20261029-205035' });

    // The Mac's copy fills the gap and is kept where iCloud would have put it.
    const fetched = await display.fetchRunFromMac('20261029-205035', 'https://mac.example.ts.net/review/run/20261029-205035.json');
    assert.deepEqual(fetched, runPayload);
    assert.deepEqual(requested, ['https://mac.example.ts.net/review/run/20261029-205035.json']);
    assert.equal(files['/icloud/chunky-dad-data/runs/20261029-205035.json'], JSON.stringify(runPayload), 'kept in the runs folder');
    assert.ok(notes.some((line) => /fetched from the Mac in \d+ms/.test(line)), notes.join('\n'));

    // A copy that names another run, a plain-http link: never used.
    global.Request = function () { this.response = { statusCode: 200 }; this.loadString = async () => JSON.stringify({ summary: { runId: '20261029-203750' } }); };
    assert.equal(await display.fetchRunFromMac('20261029-205035', 'https://mac.example.ts.net/review/run/20261029-205035.json'), null);
    assert.equal(await display.fetchRunFromMac('20261029-205035', 'http://mac.local/review/run/20261029-205035.json'), null);

    // The execute path: pending + runUrl → the fetch; no copy → the alert names the folder to pull from.
    const errors = [];
    display.showError = async (title, message) => { errors.push({ title, message }); };
    const asked = [];
    display.fetchRunFromMac = async (runId, runUrl) => { asked.push([runId, runUrl]); return null; };
    display.loadSavedRun = async (runId) => ({ __icloudSyncPending: true, notOnPhone: true, runId });
    assert.equal(await display.executeReviewedRun({ runId: '20261029-205035', runUrl: 'https://mac.example.ts.net/review/run/20261029-205035.json' }), null);
    assert.deepEqual(asked, [['20261029-205035', 'https://mac.example.ts.net/review/run/20261029-205035.json']]);
    assert.equal(errors[0].title, 'Still syncing from iCloud');
    assert.ok(errors[0].message.includes('has not reached this phone from iCloud yet') && errors[0].message.includes('Files › iCloud Drive › chunky-dad-data › runs'), errors[0].message);
  } finally {
    global.Request = previousRequest;
    delete global.FileManager;
  }
});

// A failed load leaves a note the Mac can read (2026-10-27: "Could not load
// saved run" on the phone, nothing in iCloud to diagnose it from).
function fakeFileManager(files) {
  const dirs = new Set(['/icloud', '/icloud/chunky-dad-data', '/icloud/chunky-dad-data/storage']);
  const fm = {
    documentsDirectory: () => '/icloud',
    joinPath: (a, b) => `${a}/${b}`,
    fileExists: (p) => dirs.has(p) || Object.prototype.hasOwnProperty.call(files, p),
    isDirectory: (p) => dirs.has(p),
    createDirectory: (p) => { dirs.add(p); },
    readString: (p) => files[p],
    writeString: (p, s) => { files[p] = s; },
    bookmarkedPath: () => '/icloud/chunky-dad-data',
    bookmarkExists: () => true
  };
  return { iCloud: () => fm, local: () => fm };
}

test('a failed reviewed execute appends a note with the Display trace to logs/phone-display-errors.ndjson, and the alert says so', async () => {
  const files = {};
  global.FileManager = fakeFileManager(files);
  try {
    const display = new SavedRunDisplay();
    display.resolveDataRoot = () => '/icloud/chunky-dad-data'; // the bookmarked folder (importModule is Scriptable-only)
    const errors = [];
    display.showError = async (title, message) => { errors.push({ title, message }); };
    display.loadSavedRun = async (runId) => { display.note(`📱 Display: Run file does not exist: /icloud/chunky-dad-data/runs/${runId}.json`); return null; };
    display.createAdapter = () => { throw new Error('no adapter without a run'); };

    assert.equal(await display.executeReviewedRun({ runId: '20261027-052842' }), null);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].title, 'Load failed');
    assert.match(errors[0].message, /noted in logs\/phone-display-errors\.ndjson in iCloud/);

    const file = '/icloud/chunky-dad-data/logs/phone-display-errors.ndjson';
    const notes = files[file].trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(notes.length, 1);
    assert.equal(notes[0].title, 'Load failed');
    assert.equal(notes[0].runId, '20261027-052842');
    assert.equal(notes[0].dataRoot, '/icloud/chunky-dad-data', 'the note says which folder the phone resolved');
    assert.ok(notes[0].trace.some((line) => /Run file does not exist/.test(line)), 'the Display trace rides along');
    assert.match(notes[0].at, /^\d{4}-\d{2}-\d{2}T/);

    // A second failure appends; the first line is kept.
    display.loadSavedRun = async () => ({ __icloudSyncPending: true, runId: '20261027-052842' });
    await display.executeReviewedRun({ runId: '20261027-052842' });
    assert.equal(files[file].trim().split('\n').length, 2);
    assert.equal(JSON.parse(files[file].trim().split('\n')[1]).title, 'Still syncing from iCloud');
  } finally {
    delete global.FileManager;
  }
});

test('recordFailure under Node (no FileManager) is a no-op and the alert stays as it was', async () => {
  const display = new SavedRunDisplay();
  const errors = [];
  display.showError = async (title, message) => { errors.push(message); };
  assert.equal(display.recordFailure('x', 'y'), null);
  await display.failLoud('Load failed', 'Could not load saved run: r');
  assert.deepEqual(errors, ['Could not load saved run: r']);
});

// ---------------------------------------------------------------------------
// Snapshot only: scriptable:///run?scriptName=display-saved-run&snapshot=1
// reads the calendars and writes the files the Mac needs — no scrape.
// ---------------------------------------------------------------------------
test('parseLaunchOptions: snapshot=1 (or the shortcut parameter "snapshot") asks for the snapshot only', () => {
  assert.equal(parseLaunchOptions({ snapshot: '1' }).snapshot, true);
  assert.equal(parseLaunchOptions({}, 'snapshot').snapshot, true);
  assert.equal(parseLaunchOptions({}, ' Snapshot ').snapshot, true);
  assert.equal(parseLaunchOptions({ snapshot: '0' }).snapshot, false);
  assert.equal(parseLaunchOptions({ runId: '20260913-051750', reviewExecute: '1' }).snapshot, false);
});

test('refreshCalendarSnapshots reads every configured city calendar, writes nothing else, and names the calendars the phone lacks', async () => {
  const display = new SavedRunDisplay();
  const asked = [];
  const cities = {
    nyc: { calendar: 'chunky-dad-nyc' }, sydney: { calendar: 'chunky-dad-sydney' }, oslo: { calendar: 'chunky-dad-oslo' }, broken: { timezone: 'UTC' }
  };
  display.createAdapter = () => ({
    cities,
    writeCalendarSnapshots: async (keys) => { asked.push(keys); return [{ cityKey: 'nyc', events: 212 }, { cityKey: 'sydney', events: 0 }]; }
  });
  const shown = [];
  global.Alert = class { addAction() {} async present() { shown.push([this.title, this.message]); } };
  let result;
  try {
    result = await display.refreshCalendarSnapshots();
  } finally {
    delete global.Alert;
  }
  assert.deepEqual(asked, [['nyc', 'sydney', 'oslo']], 'every city that names a calendar, once');
  assert.deepEqual(result.missing, ['chunky-dad-oslo']);
  assert.equal(shown.length, 1);
  assert.equal(shown[0][0], 'Snapshot refreshed — 1 calendar missing');
  assert.match(shown[0][1], /2 of 3 city calendars read, 212 events/);
  assert.match(shown[0][1], /Not on this phone: chunky-dad-oslo\./);
});

test('refreshCalendarSnapshots: nothing missing reads as a plain success; an old adapter says so', async () => {
  const summary = SavedRunDisplay.describeSnapshotRefresh(['nyc'], [{ cityKey: 'nyc', events: 1 }], { nyc: { calendar: 'chunky-dad-nyc' } }, 1234);
  assert.equal(summary.title, 'Snapshot refreshed');
  assert.match(summary.message, /1 of 1 city calendars read, 1 event, in 1\.2s\./);
  assert.deepEqual(summary.missing, []);
  const display = new SavedRunDisplay();
  display.createAdapter = () => ({ cities: {} });
  const errors = [];
  display.showError = async (title) => { errors.push(title); };
  assert.equal(await display.refreshCalendarSnapshots(), null);
  assert.deepEqual(errors, ['Adapter too old']);
});

test('buildResultsLike threads the run\'s gone-from-source cards through so the reviewed execute can act on approved removals', () => {
  const display = new SavedRunDisplay();
  const gone = { candidates: [{ key: 'gone|nyc|UID1', kind: 'gone', title: 'Gone Party' }], state: { nyc: { UID1: { misses: 2 } } }, summary: { candidates: 1 } };
  assert.deepEqual(display.buildResultsLike({ ...savedPayload(), goneFromSource: gone }, { readOnly: false }).goneFromSource, gone);
  assert.equal(display.buildResultsLike(savedPayload(), { readOnly: false }).goneFromSource, null, 'older runs have none');
});

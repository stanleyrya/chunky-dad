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
  assert.deepEqual(plain, { last: false, runId: null, presentHistory: true, readOnly: true, reviewExecute: false });
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

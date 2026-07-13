const test = require('node:test');
const assert = require('node:assert/strict');

// Requiring the orchestrator must NOT auto-execute a scrape: the auto-run IIFE is
// guarded by require.main === module. The fact this file loads without network or
// calendar side effects is itself part of the regression lock (see last test).
const { BearEventScraperOrchestrator } = require('./bear-event-scraper-unified');
const { SharedCore } = require('./shared-core');
const { EventSchema } = require('./event-schema');

const CITIES = {
  dallas: { timezone: 'America/Chicago', patterns: ['dallas'] }
};

class StubNormalizerPipeline {
  setCore() {}
}

function buildConfig(overrides = {}) {
  return {
    cities: CITIES,
    config: {},
    parsers: [],
    ...overrides
  };
}

// Adapter class factory: run() instantiates the class twice (bootstrap + final),
// so recorded calls live in a closure shared by all instances.
function createStubAdapter({ config, executeError = null, omitExecute = false } = {}) {
  const calls = { executeCalendarActions: [], displayResults: [], showError: [] };

  class StubAdapter {
    constructor(options = {}) {
      this.options = options;
    }
    async loadConfiguration() {
      return config;
    }
    async displayResults(results) {
      calls.displayResults.push(results);
    }
    async showError(title, message) {
      calls.showError.push({ title, message });
    }
  }

  if (!omitExecute) {
    StubAdapter.prototype.executeCalendarActions = async function executeCalendarActions(events, cfg) {
      calls.executeCalendarActions.push({ events, config: cfg });
      if (executeError) throw executeError;
      return events.length;
    };
  }

  return { StubAdapter, calls };
}

// Subclass (never prototype mutation) so each test gets an isolated SharedCore
// whose event-production stages are canned while run()'s real branching executes.
function createSharedCoreStub(events) {
  return class StubSharedCore extends SharedCore {
    async processEvents() {
      return {
        totalEvents: events.length,
        rawBearEvents: events.length,
        bearEvents: events.length,
        duplicatesRemoved: 0,
        errors: [],
        parserResults: [],
        allProcessedEvents: [...events]
      };
    }
    async deduplicateEvents(evts) {
      return evts;
    }
    async prepareEventsForCalendar(evts) {
      return evts;
    }
  };
}

function createOrchestrator({ config, events = [], adapterOptions = {}, isScriptable = true } = {}) {
  const { StubAdapter, calls } = createStubAdapter({ config, ...adapterOptions });
  const orch = new BearEventScraperOrchestrator();
  orch.isInitialized = true;
  orch.isScriptable = isScriptable;
  orch.isWeb = false;
  orch.modules = {
    SharedCore: createSharedCoreStub(events),
    EventSchema,
    NormalizerPipeline: StubNormalizerPipeline,
    adapter: StubAdapter,
    parsers: {}
  };
  return { orch, calls };
}

function buildEvents() {
  return [
    { title: 'Live Event', startDate: new Date('2026-08-01T21:00:00.000Z'), _parserConfig: { name: 'Live Parser', dryRun: false } },
    { title: 'Dry Event', startDate: new Date('2026-08-01T22:00:00.000Z'), _parserConfig: { name: 'Dry Parser', dryRun: true } }
  ];
}

test('automation run executes calendar actions, excluding dry-run-parser events', async () => {
  const config = buildConfig({ runtime: { automationRun: true }, config: { dryRun: false } });
  const { orch, calls } = createOrchestrator({ config, events: buildEvents() });

  const results = await orch.run();

  assert.equal(calls.executeCalendarActions.length, 1, 'automation executes without a UI prompt');
  assert.deepEqual(
    calls.executeCalendarActions[0].events.map(e => e.title),
    ['Live Event'],
    'filterEventsForExecution strips events from dryRun parsers'
  );
  assert.equal(results.calendarEvents, 1);
  assert.equal(results.analyzedEvents.length, 2, 'analysis still covers dry-run events');
  assert.equal(calls.displayResults.length, 1);
});

test('display mode (scriptable, manual) leaves execution to the display layer', async () => {
  const config = buildConfig({ config: { dryRun: false } });
  const { orch, calls } = createOrchestrator({ config, events: buildEvents() });

  const results = await orch.run();

  assert.equal(calls.executeCalendarActions.length, 0, 'orchestrator must not execute in display mode');
  assert.equal(results.calendarEvents, 0);
  assert.equal(results.analyzedEvents.length, 2, 'events are still analyzed for review');
  assert.equal(calls.displayResults.length, 1);
});

test('global dryRun true never executes calendar actions, even in automation', async () => {
  const config = buildConfig({ runtime: { automationRun: true }, config: { dryRun: true } });
  const { orch, calls } = createOrchestrator({ config, events: buildEvents() });

  const results = await orch.run();

  assert.equal(calls.executeCalendarActions.length, 0);
  assert.equal(results.calendarEvents, 0);
  assert.equal(results.analyzedEvents.length, 2, 'dry run still produces the analysis');
});

test('an adapter without executeCalendarActions is tolerated', async () => {
  const config = buildConfig({ runtime: { automationRun: true }, config: { dryRun: false } });
  const { orch, calls } = createOrchestrator({
    config,
    events: buildEvents(),
    adapterOptions: { omitExecute: true }
  });

  const results = await orch.run();

  assert.equal(results.calendarEvents, 0);
  assert.equal(calls.displayResults.length, 1, 'results are still displayed');
});

test('executeCalendarActions failures land in results.errors and run() still returns', async () => {
  const config = buildConfig({ runtime: { automationRun: true }, config: { dryRun: false } });
  const { orch, calls } = createOrchestrator({
    config,
    events: buildEvents(),
    adapterOptions: { executeError: new Error('calendar exploded') }
  });

  const results = await orch.run();

  assert.equal(calls.executeCalendarActions.length, 1, 'the attempt was made');
  assert.deepEqual(results.errors, ['Calendar processing failed: calendar exploded']);
  assert.equal(results.calendarEvents, 0, 'nothing was recorded as processed');
  assert.equal(calls.displayResults.length, 1, 'the run completes and displays results');
  assert.equal(calls.showError.length, 0, 'a calendar failure is not a fatal orchestrator error');
});

test('zero events found short-circuits the calendar stage', async () => {
  const config = buildConfig({ runtime: { automationRun: true }, config: { dryRun: false } });
  const { orch, calls } = createOrchestrator({ config, events: [] });

  const results = await orch.run();

  assert.equal(results.calendarEvents, 0);
  assert.deepEqual(results.analyzedEvents, []);
  assert.equal(calls.executeCalendarActions.length, 0);
  assert.equal(calls.displayResults.length, 1);
});

test('require() exports the orchestrator without auto-executing', () => {
  // If the guarded IIFE had fired on require, module load would have attempted the
  // real module loading + scrape and this file would have failed long before now.
  assert.equal(typeof BearEventScraperOrchestrator, 'function');
  assert.equal(typeof BearEventScraperOrchestrator.execute, 'function');
  const fresh = new BearEventScraperOrchestrator();
  assert.equal(fresh.isInitialized, false);
  assert.equal(fresh.isNode, true);
});

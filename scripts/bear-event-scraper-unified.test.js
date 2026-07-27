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
// so recorded calls live in a closure shared by all instances. refreshBars
// (optional) becomes the adapter's refreshRemoteBars implementation — omit it
// to model an adapter without the method (web-adapter-shaped tolerance).
function createStubAdapter({ config, executeError = null, omitExecute = false, refreshBars = null, refreshPromoters = null } = {}) {
  const calls = { executeCalendarActions: [], displayResults: [], showError: [], refreshRemoteBars: [], refreshRemotePromoters: [] };

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

  if (refreshBars) {
    StubAdapter.prototype.refreshRemoteBars = async function refreshRemoteBars(cityKeys, localBars) {
      calls.refreshRemoteBars.push({ cityKeys, localBars });
      return refreshBars(cityKeys, localBars);
    };
  }

  if (refreshPromoters) {
    StubAdapter.prototype.refreshRemotePromoters = async function refreshRemotePromoters(localPromoters) {
      calls.refreshRemotePromoters.push({ localPromoters });
      return refreshPromoters(localPromoters);
    };
  }

  return { StubAdapter, calls };
}

// Subclass (never prototype mutation) so each test gets an isolated SharedCore
// whose event-production stages are canned while run()'s real branching
// executes. coreOptionsLog (optional array) records the constructor options
// plus the core's bars AT processEvents TIME (`barsAtProcessEvents`) so tests
// can observe what run() wired into the core — the bar-data refresh happens
// after construction (it needs finalAdapter's pageCache config), so the
// processEvents-time value is the one BarDataNormalizer actually sees.
function createSharedCoreStub(events, coreOptionsLog = null) {
  return class StubSharedCore extends SharedCore {
    constructor(cities, options) {
      super(cities, options);
      if (coreOptionsLog) coreOptionsLog.push(options);
    }
    async processEvents() {
      if (coreOptionsLog && coreOptionsLog.length > 0) {
        coreOptionsLog[coreOptionsLog.length - 1].barsAtProcessEvents = this.bars;
        coreOptionsLog[coreOptionsLog.length - 1].promotersAtProcessEvents = this.promoters;
      }
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

function createOrchestrator({ config, events = [], adapterOptions = {}, isScriptable = true, coreOptionsLog = null } = {}) {
  const { StubAdapter, calls } = createStubAdapter({ config, ...adapterOptions });
  const orch = new BearEventScraperOrchestrator();
  orch.isInitialized = true;
  orch.isScriptable = isScriptable;
  orch.isWeb = false;
  orch.modules = {
    SharedCore: createSharedCoreStub(events, coreOptionsLog),
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

test('run() refreshes bar data with null cityKeys and wires the merged result into SharedCore', async () => {
  const localBars = { dallas: [{ name: 'Stale Station 4' }] };
  const remoteBars = { dallas: [{ name: 'Station 4' }], poconos: [{ name: 'Camp Out' }] };
  const config = buildConfig({ bars: localBars });
  const coreOptionsLog = [];
  const { orch, calls } = createOrchestrator({
    config,
    events: buildEvents(),
    coreOptionsLog,
    adapterOptions: {
      refreshBars: async () => ({ bars: remoteBars, counts: { remote: 2, local: 0, unavailable: 0 } })
    }
  });

  await orch.run();

  assert.equal(calls.refreshRemoteBars.length, 1, 'exactly one refresh per run');
  assert.equal(calls.refreshRemoteBars[0].cityKeys, null, 'the scraper cannot know its cities yet — all of them');
  assert.deepEqual(calls.refreshRemoteBars[0].localBars, localBars, 'local bars are offered as the fallback');
  assert.deepEqual(coreOptionsLog[0].barsAtProcessEvents, remoteBars,
    'the core carries the merged (refreshed) bars by the time events are processed');
});

test('run() tolerates an adapter without refreshRemoteBars and keeps the local bars', async () => {
  const localBars = { dallas: [{ name: 'Station 4' }] };
  const config = buildConfig({ bars: localBars });
  const coreOptionsLog = [];
  const { orch, calls } = createOrchestrator({ config, events: buildEvents(), coreOptionsLog });

  const results = await orch.run();

  assert.deepEqual(coreOptionsLog[0].barsAtProcessEvents, localBars, 'local bars flow through unchanged');
  assert.equal(results.analyzedEvents.length, 2, 'the run completes normally');
  assert.equal(calls.displayResults.length, 1);
});

test('run() wires config.promoters into SharedCore and refreshes the registry through the adapter', async () => {
  const localPromoters = [{ name: 'Bearracuda', shortName: 'STALE' }];
  const remotePromoters = [{ name: 'Bearracuda', shortName: 'Bear-rac-uda' }, { name: 'Goldiloxx' }];
  const config = buildConfig({ promoters: localPromoters });
  const coreOptionsLog = [];
  const { orch, calls } = createOrchestrator({
    config,
    events: buildEvents(),
    coreOptionsLog,
    adapterOptions: {
      refreshPromoters: async () => ({ promoters: remotePromoters, counts: { remote: 2, localOnly: 0 } })
    }
  });

  await orch.run();

  assert.deepEqual(coreOptionsLog[0].promoters, localPromoters, 'config.promoters reaches the SharedCore constructor');
  assert.equal(calls.refreshRemotePromoters.length, 1, 'exactly one registry refresh per run');
  assert.deepEqual(calls.refreshRemotePromoters[0].localPromoters, localPromoters, 'the local registry is offered as the fallback');
  assert.deepEqual(coreOptionsLog[0].promotersAtProcessEvents, remotePromoters,
    'the core carries the refreshed registry by the time events are processed');
});

test('run() tolerates an adapter without refreshRemotePromoters and keeps the local registry, and a throwing refresh is fail-soft', async () => {
  const localPromoters = [{ name: 'Bearracuda' }];
  const config = buildConfig({ promoters: localPromoters });

  // No refreshRemotePromoters on the adapter (web-adapter-shaped tolerance)
  const withoutMethod = [];
  const noMethod = createOrchestrator({ config, events: buildEvents(), coreOptionsLog: withoutMethod });
  const noMethodResults = await noMethod.orch.run();
  assert.deepEqual(withoutMethod[0].promotersAtProcessEvents, localPromoters, 'local registry flows through unchanged');
  assert.equal(noMethodResults.analyzedEvents.length, 2, 'the run completes normally');

  // Refresh throws → local registry kept, run continues, never fatal
  const withThrow = [];
  const throwing = createOrchestrator({
    config: buildConfig({ promoters: localPromoters }),
    events: buildEvents(),
    coreOptionsLog: withThrow,
    adapterOptions: { refreshPromoters: async () => { throw new Error('chunky.dad unreachable'); } }
  });
  const throwingResults = await throwing.orch.run();
  assert.equal(throwing.calls.refreshRemotePromoters.length, 1, 'the refresh was attempted');
  assert.deepEqual(withThrow[0].promotersAtProcessEvents, localPromoters, 'a refresh failure keeps the local registry');
  assert.equal(throwingResults.analyzedEvents.length, 2, 'the run continues');
  assert.equal(throwing.calls.showError.length, 0, 'a promoters refresh failure is never fatal');
});

test('run() keeps local bars and continues when the refresh throws', async () => {
  const localBars = { dallas: [{ name: 'Station 4' }] };
  const config = buildConfig({ bars: localBars });
  const coreOptionsLog = [];
  const { orch, calls } = createOrchestrator({
    config,
    events: buildEvents(),
    coreOptionsLog,
    adapterOptions: {
      refreshBars: async () => { throw new Error('chunky.dad unreachable'); }
    }
  });

  const results = await orch.run();

  assert.equal(calls.refreshRemoteBars.length, 1, 'the refresh was attempted');
  assert.deepEqual(coreOptionsLog[0].barsAtProcessEvents, localBars, 'a refresh failure keeps the local bars');
  assert.equal(results.analyzedEvents.length, 2, 'the run continues');
  assert.equal(calls.showError.length, 0, 'a bars refresh failure is never fatal');
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

// ---------------------------------------------------------------------------
// wireConsoleTees: the Scriptable-startup routine that routes each imported
// module's per-module console into the adapter's run-log tee. Pure stubs only
// — the real global console is never touched here.
// ---------------------------------------------------------------------------
const { wireConsoleTees } = require('./bear-event-scraper-unified');

test('wireConsoleTees wires every module exposing __wireConsoleTee and skips the rest', () => {
  const wired = [];
  const tee = () => {};
  const restoreA = () => {};
  const modA = { __wireConsoleTee: (t) => { wired.push(['a', t]); return restoreA; } };
  const modNoHelper = { SharedCore: class {} }; // e.g. event-schema (never logs)
  const modNull = null;
  const modDeclined = { __wireConsoleTee: (t) => { wired.push(['d', t]); return null; } };

  const restores = wireConsoleTees(tee, [modA, modNoHelper, modNull, modDeclined]);

  assert.deepEqual(wired.map((call) => call[0]), ['a', 'd']);
  assert.ok(wired.every((call) => call[1] === tee), 'each helper receives the tee');
  assert.deepEqual(restores, [restoreA], 'only real restore functions are collected');
});

test('wireConsoleTees is a no-op when no tee function is supplied', () => {
  let helperCalls = 0;
  const mod = { __wireConsoleTee: () => { helperCalls += 1; } };
  assert.deepEqual(wireConsoleTees(null, [mod]), []);
  assert.deepEqual(wireConsoleTees(undefined, [mod]), []);
  assert.deepEqual(wireConsoleTees('not a function', [mod]), []);
  assert.deepEqual(wireConsoleTees(() => {}, 'not an array'), []);
  assert.equal(helperCalls, 0, 'module helpers never invoked without a tee');
});

test('wireConsoleTees survives a module whose helper throws', () => {
  const wired = [];
  const throwing = { __wireConsoleTee: () => { throw new Error('boom'); } };
  const healthy = { __wireConsoleTee: () => { wired.push('ok'); return () => {}; } };

  const restores = wireConsoleTees(() => {}, [throwing, healthy]);

  assert.deepEqual(wired, ['ok'], 'later modules still get wired');
  assert.equal(restores.length, 1);
});

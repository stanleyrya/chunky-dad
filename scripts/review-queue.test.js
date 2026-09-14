const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ---------------------------------------------------------------------------
// tools/review-queue.js — the swipe deck's pure core: run listing, the
// decision store, and buildDeck (which proposals become cards, which are
// already decided). Node-only tooling; never ships to the phone.
// ---------------------------------------------------------------------------
const rq = require('../tools/review-queue');

const CITIES = { nyc: { timezone: 'America/New_York', patterns: ['nyc'] } };
const FUTURE = Date.UTC(2030, 9, 4, 2, 0, 0); // 2030-10-03 22:00 New York

function iso(ms) {
  return new Date(ms).toISOString();
}

function newEvent(overrides = {}) {
  return {
    title: 'FURBALL NYC',
    startDate: iso(FUTURE),
    endDate: iso(FUTURE + 4 * 3600 * 1000),
    bar: 'Rockbar',
    address: '185 Christopher St, New York, NY',
    city: 'nyc',
    timezone: 'America/New_York',
    url: 'https://furball.nyc/',
    image: 'https://furball.nyc/flyer.jpg',
    _parserConfig: { name: 'Furball', parser: 'ai-web', dryRun: false },
    _action: 'new',
    _analysis: { action: 'new', reason: 'No existing events found' },
    ...overrides
  };
}

function mergeEvent(overrides = {}) {
  const existing = {
    title: 'BEEFMINCE Brief Encounter',
    identifier: 'ABC',
    startDate: iso(FUTURE),
    endDate: iso(FUTURE + 4 * 3600 * 1000),
    location: '51.4863391, -0.1217784',
    notes: 'bar: Royal Vauxhall Tavern'
  };
  return {
    title: 'BEEFMINCE x RVT',
    startDate: iso(FUTURE),
    endDate: iso(FUTURE + 4 * 3600 * 1000),
    bar: 'Royal Vauxhall Tavern',
    city: 'nyc',
    timezone: 'America/New_York',
    location: '51.4863391, -0.1217784',
    url: 'https://beefmince.co.uk/',
    notes: 'bar: Royal Vauxhall Tavern\nwebsite: https://beefmince.co.uk/',
    _parserConfig: { name: 'The Bear Calendar', parser: 'ai-web', dryRun: false },
    _action: 'merge',
    _existingEvent: existing,
    _original: { scraper: {}, calendar: { ...existing, website: 'https://beefmince.co.uk/' } },
    _changes: ['title', 'notes'],
    _mergeNoOp: false,
    ...overrides
  };
}

function runPayload(overrides = {}) {
  return {
    version: 2,
    summary: { runId: '20300101-051500', timestamp: '2030-01-01T05:15:00.000Z', totals: {} },
    runContext: { environment: 'node', type: 'automated' },
    config: { cities: CITIES, config: { dryRun: true }, parsers: [] },
    analyzedEvents: [],
    bearDroppedEvents: [],
    parserResults: [],
    errors: [],
    calendarHygiene: [],
    ...overrides
  };
}

function deckOf(payload, store = rq.emptyDecisionStore(), options = {}) {
  return rq.buildDeck(payload, store, { now: Date.UTC(2030, 0, 2), curatedBars: {}, ...options });
}

// ---------------------------------------------------------------------------
// buildDeck: what becomes a card
// ---------------------------------------------------------------------------

test('buildDeck: new events and field-changing merges are cards; housekeeping, no-ops, withheld and past ones are not', () => {
  const deck = deckOf(runPayload({
    analyzedEvents: [
      newEvent(),
      mergeEvent(),
      mergeEvent({ title: 'BEEFMINCE Brief Encounter', _changes: ['notes'] }), // notes-only
      mergeEvent({ title: 'BEEFMINCE Brief Encounter', _changes: [], _mergeNoOp: true }),
      newEvent({ title: 'Withheld Party', _pastSpanWithheld: true }),
      newEvent({ title: 'Announcement Only', _announcementOnlyWithheld: true }),
      newEvent({ title: 'Already Happened', startDate: '2020-01-01T02:00:00.000Z', endDate: '2020-01-01T05:00:00.000Z' })
    ]
  }));
  assert.equal(deck.runId, '20300101-051500');
  assert.deepEqual(deck.cards.map((card) => [card.kind, card.proposal.title]), [
    ['new', 'FURBALL NYC'],
    ['merge', 'BEEFMINCE x RVT']
  ]);
  assert.equal(deck.counts.pending, 2);
  assert.equal(deck.counts.new, 1);
  assert.equal(deck.counts.merge, 1);
  assert.equal(deck.counts.pastSkipped, 1, 'the past event is dropped, not offered');
  const merge = deck.cards[1];
  assert.deepEqual(Object.keys(merge.proposal.changes), ['title'], 'only the stored-field change is shown, never notes');
  assert.equal(merge.proposal.changes.title.from, 'BEEFMINCE Brief Encounter');
  assert.equal(merge.proposal.changes.title.to, 'BEEFMINCE x RVT');
  assert.equal(merge.proposal.existingTitle, 'BEEFMINCE Brief Encounter');
  assert.match(deck.cards[0].key, /^event\|furball\|rockbar\|2030-10-03$/, 'key = title tokens | place | LOCAL day');
  assert.equal(deck.cards[0].proposal.source, 'Furball');
});

test('buildDeck: a stored decision moves the card to decided; a merge proposing a different value comes back', () => {
  const first = deckOf(runPayload({ analyzedEvents: [newEvent(), mergeEvent()] }));
  let store = rq.emptyDecisionStore();
  store = rq.upsertDecision(store, rq.buildDecision({
    key: first.cards[0].key, kind: 'new', verdict: 'approve', snapshot: first.cards[0].proposal
  }));
  store = rq.upsertDecision(store, rq.buildDecision({
    key: first.cards[1].key, kind: 'merge', verdict: 'reject',
    reason: { tags: ['wrong title'], text: 'aggregator renamed it' }, snapshot: first.cards[1].proposal
  }));

  const second = deckOf(runPayload({ analyzedEvents: [newEvent(), mergeEvent()] }), store);
  assert.equal(second.cards.length, 0, 'both decided');
  assert.equal(second.counts.approved, 1);
  assert.equal(second.counts.rejected, 1);
  assert.equal(second.decided[1].decision.reason.text, 'aggregator renamed it');

  // Same event, a different proposed title: the rejection does not cover it.
  const third = deckOf(runPayload({ analyzedEvents: [mergeEvent({ title: 'BEEFMINCE Brief Encounter (Sat)' })] }), store);
  assert.equal(third.cards.length, 1, 'a new value is a new card');
  assert.equal(third.cards[0].proposal.changes.title.to, 'BEEFMINCE Brief Encounter (Sat)');
});

test('buildDeck: new-venue candidates become bar cards unless the city already curates that bar', () => {
  const payload = runPayload({
    newVenueCandidates: [
      { key: 'nyc|rockbar', name: 'Rockbar', city: 'nyc', address: '185 Christopher St', coordinates: '40.7, -74.0', signals: ['venue-site'] },
      { key: 'nyc|thewoods', name: 'The Woods', city: 'nyc', address: '48 S 4th St', coordinates: '40.71, -73.96', signals: ['page-adjacent'],
        sourceEvents: [{ title: 'BEAR NIGHT', date: '2030-02-02T02:00:00.000Z' }] }
    ]
  });
  const deck = deckOf(payload, rq.emptyDecisionStore(), {
    curatedBars: { nyc: [{ name: 'Rockbar', city: 'nyc' }] }
  });
  assert.deepEqual(deck.cards.map((card) => [card.kind, card.proposal.name]), [['bar', 'The Woods']]);
  assert.equal(deck.cards[0].key, 'bar|nyc|thewoods');
  assert.equal(deck.counts.bar, 1);
});

// ---------------------------------------------------------------------------
// Decision store
// ---------------------------------------------------------------------------

test('decision store: atomic save, corrupt file reads as empty, upsert replaces by key, clear removes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-review-'));
  const decisionsPath = rq.getDecisionsPath(dir);
  assert.deepEqual(rq.loadDecisions(decisionsPath), { version: 1, decisions: [] }, 'missing file → empty store');

  const approve = rq.buildDecision({ key: 'event|a|b|2030-01-01', verdict: 'approve', snapshot: { title: 'A' } }, { now: new Date('2030-01-01T00:00:00Z') });
  assert.equal(approve.kind, 'new', 'kind defaults to new');
  assert.equal(approve.stampedAt, '2030-01-01T00:00:00.000Z');
  assert.equal(approve.reason, null);
  rq.saveDecisions(decisionsPath, rq.upsertDecision(rq.emptyDecisionStore(), approve));
  assert.ok(fs.existsSync(decisionsPath));
  assert.ok(!fs.readdirSync(dir).some((name) => name.includes('.tmp-')), 'no temp file left behind');

  const reject = rq.buildDecision({ key: 'event|a|b|2030-01-01', verdict: 'reject', reason: { tags: ['not bear', ''], text: '  no bears  ' } });
  const store = rq.upsertDecision(rq.loadDecisions(decisionsPath), reject);
  assert.equal(store.decisions.length, 1, 'same key replaces');
  assert.equal(store.decisions[0].verdict, 'reject');
  assert.deepEqual(store.decisions[0].reason, { tags: ['not bear'], text: 'no bears' });

  const cleared = rq.clearDecision(store, 'event|a|b|2030-01-01');
  assert.equal(cleared.removed, true);
  assert.equal(cleared.store.decisions.length, 0);
  assert.equal(rq.clearDecision(cleared.store, 'nope').removed, false);

  fs.writeFileSync(decisionsPath, '{not json');
  assert.deepEqual(rq.loadDecisions(decisionsPath), { version: 1, decisions: [] }, 'corrupt file never breaks the deck');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildDecision rejects malformed requests', () => {
  assert.throws(() => rq.buildDecision({ verdict: 'approve' }), /needs a key/);
  assert.throws(() => rq.buildDecision({ key: 'k', verdict: 'maybe' }), /approve or reject/);
  assert.throws(() => rq.buildDecision(null), /must be an object/);
});

test('normalizeDecisionStore accepts the wrapper or a bare array and drops junk entries', () => {
  const store = rq.normalizeDecisionStore([
    { key: 'k1', verdict: 'approve' },
    { key: '', verdict: 'approve' },
    { key: 'k2', verdict: 'later' },
    'junk'
  ]);
  assert.deepEqual(store.decisions.map((entry) => entry.key), ['k1']);
});

// ---------------------------------------------------------------------------
// Run files
// ---------------------------------------------------------------------------

test('run files: newest first, iCloud placeholders listed as unavailable, ids validated', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-review-runs-'));
  const runsDir = rq.getRunsDir(dir);
  fs.mkdirSync(runsDir);
  fs.writeFileSync(path.join(runsDir, '20300101-010000.json'), JSON.stringify(runPayload({ summary: { runId: '20300101-010000' } })));
  fs.writeFileSync(path.join(runsDir, '20300102-010000.json'), JSON.stringify(runPayload({ summary: { runId: '20300102-010000' } })));
  fs.writeFileSync(path.join(runsDir, '.20300103-010000.json.icloud'), '');
  fs.writeFileSync(path.join(runsDir, 'notes.txt'), 'x');

  const runs = rq.listRunFiles(dir);
  assert.deepEqual(runs.map((run) => [run.runId, run.available]), [
    ['20300103-010000', false],
    ['20300102-010000', true],
    ['20300101-010000', true]
  ]);
  assert.equal(rq.pickLatestRunId(dir), '20300102-010000', 'the syncing placeholder is skipped');
  assert.equal(rq.loadRun(dir, '20300101-010000').payload.summary.runId, '20300101-010000');
  assert.equal(rq.loadRun(dir, '../../etc/passwd'), null, 'only run-id shaped names are opened');
  assert.equal(rq.loadRun(dir, '20300109-010000'), null);
  assert.deepEqual(rq.listRunFiles(path.join(dir, 'missing')), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('resolveSharedRoot honours CHUNKY_SHARED_STORAGE_DIR and defaults to the iCloud tree', () => {
  assert.equal(rq.resolveSharedRoot({ CHUNKY_SHARED_STORAGE_DIR: '/tmp/x/../y' }), '/tmp/y');
  assert.equal(rq.resolveSharedRoot({}), rq.DEFAULT_SHARED_ROOT);
  assert.ok(rq.DEFAULT_SHARED_ROOT.endsWith(path.join('Documents', 'chunky-dad-scraper')));
});

test('formatRejectionsText lists every rejection with its tags, text and the values it refused', () => {
  const store = rq.upsertDecision(rq.emptyDecisionStore(), rq.buildDecision({
    key: 'event|x', kind: 'merge', verdict: 'reject',
    reason: { tags: ['wrong title'], text: 'aggregator renamed it' },
    snapshot: { kind: 'merge', title: 'BEEFMINCE x RVT', startDate: '2030-10-04T02:00:00.000Z', bar: 'RVT', source: 'The Bear Calendar',
      changes: { title: { from: 'BEEFMINCE Brief Encounter', to: 'BEEFMINCE x RVT' } } }
  }));
  const text = rq.formatRejectionsText(store);
  assert.match(text, /^- MERGE BEEFMINCE x RVT — 2030-10-04 @ RVT \[The Bear Calendar\] \{wrong title\} — aggregator renamed it \(title: BEEFMINCE Brief Encounter → BEEFMINCE x RVT\)$/m);
  assert.equal(rq.formatRejectionsText(rq.emptyDecisionStore()), '');
});

// ---------------------------------------------------------------------------
// Bear review: the verdict store the deck writes, and dropped-event cards
// ---------------------------------------------------------------------------

test('bear verdict store: upsert by party identity (last verdict wins), clear, atomic save in the phone\'s shape', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-review-bear-'));
  const verdictsPath = rq.getBearVerdictsPath(dir);
  const core = rq.createDeckCore({ config: { cities: CITIES } }, {});
  assert.deepEqual(rq.loadBearVerdicts(verdictsPath), []);
  const first = rq.upsertBearVerdict([], core, { title: 'MEAT RACK', bar: 'Eagle NYC', city: 'nyc' }, 'not_bear', { now: new Date('2030-01-01T00:00:00Z') });
  assert.deepEqual(first.entry, { verdict: 'not_bear', stampedAt: '2030-01-01T00:00:00.000Z', title: 'MEAT RACK', venue: 'Eagle NYC', address: '', location: '', city: 'nyc' });
  const second = rq.upsertBearVerdict(first.verdicts, core, { title: 'meat rack!', bar: 'The Eagle NYC', city: 'nyc' }, 'bear');
  assert.equal(second.verdicts.length, 1, 'same party at the same venue → one entry');
  assert.equal(second.verdicts[0].verdict, 'bear');
  const other = rq.upsertBearVerdict(second.verdicts, core, { title: 'MEAT RACK INFERNO', bar: 'Eagle NYC', city: 'nyc' }, 'bear');
  assert.equal(other.verdicts.length, 2, 'a different party never inherits');
  rq.saveBearVerdicts(verdictsPath, other.verdicts);
  const saved = JSON.parse(fs.readFileSync(verdictsPath, 'utf8'));
  assert.equal(saved.version, 1);
  assert.equal(saved.verdicts.length, 2);
  assert.ok(!fs.readdirSync(dir).some((name) => name.includes('.tmp-')));
  const cleared = rq.clearBearVerdict(rq.loadBearVerdicts(verdictsPath), core, { title: 'MEAT RACK', bar: 'Eagle NYC', city: 'nyc' });
  assert.equal(cleared.removed, true);
  assert.equal(cleared.verdicts.length, 1);
  assert.throws(() => rq.upsertBearVerdict([], core, { title: '', bar: 'x' }, 'bear'), /no title identity/);
  assert.throws(() => rq.upsertBearVerdict([], core, { title: 'x' }, 'maybe'), /bear or not_bear/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildDeck: dropped-as-not-bear events become one card per party (future only), decided once a verdict is stored', () => {
  const dropped = (title, start, reason = 'ai: no bear language') => ({
    title, startDate: start, venue: '3 Dollar Bill', reason, host: 'www.3dollarbillbk.com',
    event: { title, startDate: start, endDate: start, bar: '3 Dollar Bill', address: '260 Meserole St', city: 'nyc', timezone: 'America/New_York', source: 'ai-web', image: 'https://x/y.jpg' }
  });
  const payload = runPayload({
    analyzedEvents: [newEvent()],
    bearDroppedEvents: [
      dropped('Dolly Parton Tribute', iso(FUTURE)),
      dropped('Dolly Parton Tribute', iso(FUTURE + 7 * 86400000)),
      dropped('Charli Party', iso(FUTURE)),
      dropped('Ancient Party', '2020-01-01T02:00:00.000Z')
    ]
  });
  const deck = deckOf(payload);
  const droppedCards = deck.cards.filter((card) => card.kind === 'dropped');
  assert.deepEqual(droppedCards.map((card) => [card.proposal.title, card.proposal.occurrences]), [['Dolly Parton Tribute', 2], ['Charli Party', 1]]);
  assert.equal(droppedCards[0].key, 'dropped|dolly parton tribute|3dollarbill', 'dateless key: the verdict is about the party');
  assert.equal(droppedCards[0].proposal.dropReason, 'ai: no bear language');
  assert.deepEqual(droppedCards[0].display.bearIdentity, { title: 'Dolly Parton Tribute', bar: '3 Dollar Bill', address: '260 Meserole St', location: '', city: 'nyc' });
  assert.equal(deck.counts.dropped, 2);
  assert.equal(deck.counts.pending, 1, 'dropped cards do not count as pending proposals');

  const verdicts = [{ verdict: 'bear', stampedAt: '2030-01-01T00:00:00.000Z', title: 'Dolly Parton Tribute', venue: '3 Dollar Bill', address: '', location: '', city: 'nyc' }];
  const judged = deckOf(payload, rq.emptyDecisionStore(), { bearVerdicts: verdicts });
  assert.deepEqual(judged.cards.filter((card) => card.kind === 'dropped').map((card) => card.proposal.title), ['Charli Party']);
  const decided = judged.decided.find((entry) => entry.kind === 'dropped');
  assert.equal(decided.decision.verdict, 'approve');
  assert.equal(decided.decision.bearVerdict, 'bear');
  assert.equal(judged.counts.droppedDecided, 1);
  // The kept event card knows the store too.
  const keptWithVerdict = deckOf(runPayload({ analyzedEvents: [newEvent()] }), rq.emptyDecisionStore(), {
    bearVerdicts: [{ verdict: 'not_bear', stampedAt: '2030-01-01T00:00:00.000Z', title: 'FURBALL NYC', venue: 'Rockbar', city: 'nyc' }]
  });
  assert.equal(keptWithVerdict.cards[0].display.bearVerdict, 'not_bear');
});

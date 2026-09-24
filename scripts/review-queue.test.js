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
  assert.match(text, /^- \[REJECTED\] MERGE BEEFMINCE x RVT — 2030-10-04 @ RVT \[The Bear Calendar\] \{wrong title\} — aggregator renamed it \(title: BEEFMINCE Brief Encounter → BEEFMINCE x RVT\)$/m);
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

test('buildDeck: a not-bear card carries the event\'s own review key, so "bear, but needs a fix" parks its note where the next run\'s kept card looks', () => {
  const event = { title: 'Dolly Parton Tribute', startDate: iso(FUTURE), endDate: iso(FUTURE), bar: '3 Dollar Bill', address: '260 Meserole St', city: 'nyc', timezone: 'America/New_York', source: 'ai-web', image: 'https://x/y.jpg' };
  const payload = runPayload({ analyzedEvents: [], bearDroppedEvents: [{ title: event.title, startDate: event.startDate, venue: event.bar, reason: 'ai: no bear language', host: 'x', event }] });
  const card = deckOf(payload).cards.find((entry) => entry.kind === 'dropped');
  assert.ok(card.fixTarget.key.startsWith('event|dolly parton tribute|'), card.fixTarget.key);
  assert.equal(card.fixTarget.kind, 'new');
  assert.equal(card.fixTarget.image, 'https://x/y.jpg', 'the snapshot is the card as it stands today');

  // The owner answers "bear, but needs a fix": a bear verdict + a fix note under the event key.
  const note = rq.buildDecision({ key: card.fixTarget.key, kind: 'new', verdict: 'reject', snapshot: card.fixTarget, reason: { mode: 'fix', tags: ['bad image'], text: 'wrong flyer' } });
  const store = rq.upsertDecision(rq.emptyDecisionStore(), note);
  const verdicts = [{ verdict: 'bear', stampedAt: '2030-01-01T00:00:00.000Z', title: event.title, venue: event.bar, address: '', location: '', city: 'nyc' }];
  const sameRun = deckOf(payload, store, { bearVerdicts: verdicts });
  const decided = sameRun.decided.find((entry) => entry.kind === 'dropped');
  assert.equal(decided.noteKey, card.fixTarget.key, 'an undo clears the note with the verdict');
  assert.equal(decided.rejectionMode, 'fix');
  assert.equal(decided.decision.reason.text, 'wrong flyer');
  assert.deepEqual(sameRun.waitingGone, [], 'the event is in this run (dropped) — its note is not orphaned');

  // Next run keeps the party: the same card waits; a changed card comes back.
  const kept = (image) => runPayload({ analyzedEvents: [{ ...event, image, _action: 'new', _parserConfig: { name: 'ai-web', parser: 'ai-web', dryRun: false } }] });
  const waiting = deckOf(kept('https://x/y.jpg'), store, { bearVerdicts: verdicts });
  assert.equal(waiting.cards.filter((entry) => entry.kind === 'new').length, 0, 'unchanged: still waiting on the fix');
  assert.equal(waiting.counts.waiting, 1);
  const fixed = deckOf(kept('https://x/fixed.jpg'), store, { bearVerdicts: verdicts });
  // The note said 'bad image' and only the image changed: approved on the owner's behalf, no second swipe.
  assert.equal(fixed.cards.filter((entry) => entry.kind === 'new').length, 0, 'changed as asked: approved, not re-offered');
  assert.equal(fixed.autoApprovals.length, 1);
});

test('buildDeck: a card that comes back changed in exactly the fields a "needs a fix" note named is approved on the owner\'s behalf; answered notes are listed for pruning', () => {
  const day = iso(FUTURE);
  const before = { ...newEvent(), _action: 'new', _existingEvent: undefined, _original: undefined, _changes: undefined, title: 'Bear Tea', bar: 'The Yard', address: '', url: 'https://promoter.example/tea', image: 'https://x/wrong.jpg', startDate: day, endDate: day };
  const sentBack = deckOf(runPayload({ analyzedEvents: [before] })).cards[0];
  const note = rq.buildDecision({ key: sentBack.key, kind: 'new', verdict: 'reject', snapshot: sentBack.proposal, reason: { mode: 'fix', tags: ['bad image'], text: 'wrong flyer' } }, { now: new Date(Date.UTC(2029, 0, 1)) });
  const store = rq.upsertDecision(rq.emptyDecisionStore(), note);

  // Only the image changed → approved, note kept as audit.
  const imageFixed = deckOf(runPayload({ analyzedEvents: [{ ...before, image: 'https://x/right.jpg' }] }), store);
  assert.equal(imageFixed.cards.length, 0, 'no second swipe');
  const auto = imageFixed.decided.find((entry) => entry.autoApproved);
  assert.ok(auto, 'filed as decided');
  assert.equal(auto.decision.verdict, 'approve');
  assert.deepEqual(auto.autoApproved.fields, ['image']);
  assert.equal(imageFixed.autoApprovals.length, 1);
  assert.equal(imageFixed.autoApprovals[0].key, sentBack.key);

  // Image AND time changed → the time was not asked for: back on the stack with the note.
  const moreChanged = deckOf(runPayload({ analyzedEvents: [{ ...before, image: 'https://x/right.jpg', startDate: iso(FUTURE + 3600000), endDate: iso(FUTURE + 3600000) }] }), store);
  assert.equal(moreChanged.cards.length, 1);
  assert.ok(moreChanged.cards[0].prior, 'the note rides along');
  assert.equal(moreChanged.autoApprovals.length, 0);

  // An untagged note never auto-approves.
  const untagged = rq.upsertDecision(rq.emptyDecisionStore(), rq.buildDecision({ key: sentBack.key, kind: 'new', verdict: 'reject', snapshot: sentBack.proposal, reason: { mode: 'fix', tags: [], text: 'something is off' } }, { now: new Date(Date.UTC(2029, 0, 1)) }));
  assert.equal(deckOf(runPayload({ analyzedEvents: [{ ...before, image: 'https://x/right.jpg' }] }), untagged).cards.length, 1);

  // A note whose night has passed is answered: listed for pruning.
  const pastNote = rq.buildDecision({ key: 'event|old party|somewhere|2020-01-01', kind: 'new', verdict: 'reject', snapshot: { title: 'Old Party', startDate: '2020-01-01T02:00:00.000Z' }, reason: { mode: 'fix', tags: [], text: 'x' } });
  const pastDeck = deckOf(runPayload({ analyzedEvents: [] }), rq.upsertDecision(rq.emptyDecisionStore(), pastNote));
  assert.equal(pastDeck.answeredNoteKeys.length, 1);
  assert.ok(pastDeck.answeredNoteKeys[0].startsWith('event|old party|'));
});

test('buildDeck: a "needs a fix" note whose fix RENAMED the card rides on the renamed card; a note for a night already past is not waiting', () => {
  const day = iso(FUTURE);
  const before = { ...newEvent(), _action: 'new', _existingEvent: undefined, _original: undefined, _changes: undefined, title: 'The Bear Party', bar: '', address: '232 W 37th St, New York, NY', url: '', startDate: day, endDate: day };
  const after = { ...before, title: 'Lodge NY: The Bear Party' };
  const sentBack = deckOf(runPayload({ analyzedEvents: [before] })).cards[0];
  const note = rq.buildDecision({ key: sentBack.key, kind: 'new', verdict: 'reject', snapshot: sentBack.proposal, reason: { mode: 'fix', tags: ['wrong title'], text: 'not descriptive enough' } });
  const pastNote = rq.buildDecision({ key: 'event|old party|somewhere|2020-01-01', kind: 'new', verdict: 'reject', snapshot: { title: 'Old Party', startDate: '2020-01-01T02:00:00.000Z' }, reason: { mode: 'fix', tags: [], text: 'x' } });
  const goneNote = rq.buildDecision({ key: 'event|vanished party|elsewhere|2030-12-01', kind: 'new', verdict: 'reject', snapshot: { title: 'Vanished Party', startDate: '2030-12-01T02:00:00.000Z' }, reason: { mode: 'fix', tags: [], text: 'y' } });
  let store = rq.emptyDecisionStore();
  for (const decision of [note, pastNote, goneNote]) store = rq.upsertDecision(store, decision);

  const deck = deckOf(runPayload({ analyzedEvents: [after] }), store);
  const renamed = deck.cards.find((card) => card.proposal.title === 'Lodge NY: The Bear Party');
  assert.ok(renamed, 'the fixed card is back on the stack');
  assert.equal(renamed.prior.verdict, 'reject');
  assert.equal(renamed.prior.reason.text, 'not descriptive enough', 'your note rides on it');
  assert.deepEqual(renamed.prior.drift, ['title (was “The Bear Party”)']);
  assert.deepEqual(deck.waitingGone.map((entry) => entry.title), ['Vanished Party'], 'answered and past notes are not "waiting"; a truly missing future one still is');

  // The fixed night was approved and written: this run only proposes a no-op
  // merge for it, so there is no card — the note is answered all the same,
  // even when the old card had no place of its own (an aggregator's copy).
  const placeless = rq.buildDecision({ key: 'event|bear party|nyc|' + sentBack.key.split('|')[3], kind: 'new', verdict: 'reject', snapshot: { title: 'The Bear Party', city: 'nyc', startDate: day }, reason: { mode: 'fix', tags: [], text: 'merge with lodge?' } });
  const saved = { ...after, _action: 'merge', _mergeNoOp: true, _changes: ['notes'], _existingEvent: { title: after.title }, _original: { scraper: {}, calendar: { title: after.title } } };
  const settled = deckOf(runPayload({ analyzedEvents: [saved] }), rq.upsertDecision(store, placeless));
  assert.deepEqual(settled.waitingGone.map((entry) => entry.title), ['Vanished Party']);
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

test('buildDeck: a decided card the phone already wrote is marked with when and how', () => {
  const approved = newEvent({ _ownerReviewApproved: { key: 'event|furball|rockbar|2030-10-03', stampedAt: '2030-01-01T00:00:00.000Z' }, _action: 'merge', _existingEvent: { title: 'FURBALL', startDate: iso(FUTURE), endDate: iso(FUTURE + 4 * 3600 * 1000) }, _original: { scraper: {}, calendar: { title: 'FURBALL', startDate: iso(FUTURE), endDate: iso(FUTURE + 4 * 3600 * 1000), website: 'https://furball.nyc/' } }, _changes: ['title'], _mergeNoOp: false });
  const payload = runPayload({ analyzedEvents: [approved], executions: [{ executedAt: '2030-01-02T03:04:05.000Z', via: 'owner-review', processed: 1 }] });
  const store = rq.upsertDecision(rq.emptyDecisionStore(), rq.buildDecision({ key: 'event|furball|rockbar|2030-10-03', kind: 'merge', verdict: 'approve', snapshot: { changes: { title: { from: 'FURBALL NYC', to: 'FURBALL NYC' } } } }));
  const deck = deckOf(payload, store);
  assert.equal(deck.decided.length, 1);
  assert.deepEqual(deck.decided[0].executed, { at: '2030-01-02T03:04:05.000Z', as: 'updated' });
  assert.equal(deck.decided[0].pendingExecute, false, 'written → nothing left to execute');
  assert.equal(deck.lastExecution.processed, 1);
  assert.equal(deck.lastExecution.via, 'owner-review');
  const untouched = deckOf(runPayload({ analyzedEvents: [newEvent()] }), rq.upsertDecision(rq.emptyDecisionStore(), rq.buildDecision({ key: 'event|furball|rockbar|2030-10-03', verdict: 'approve' })));
  assert.equal(untouched.decided[0].executed, null, 'approved but not yet written → no mark');
  assert.equal(untouched.decided[0].pendingExecute, true, 'and still waiting for Execute on phone');
  assert.equal(untouched.lastExecution, null);
  // An approval OLDER than the run's last execution was already handed to
  // the phone (written or withheld there): not pending, even without a mark.
  const handed = deckOf(
    runPayload({ analyzedEvents: [newEvent()], executions: [{ executedAt: '2030-01-05T00:00:00.000Z', via: 'owner-review', processed: 0 }] }),
    rq.upsertDecision(rq.emptyDecisionStore(), rq.buildDecision({ key: 'event|furball|rockbar|2030-10-03', verdict: 'approve' }, { now: new Date('2030-01-04T00:00:00Z') }))
  );
  assert.equal(handed.decided[0].pendingExecute, false);
  const newer = deckOf(
    runPayload({ analyzedEvents: [newEvent()], executions: [{ executedAt: '2030-01-05T00:00:00.000Z', via: 'owner-review', processed: 0 }] }),
    rq.upsertDecision(rq.emptyDecisionStore(), rq.buildDecision({ key: 'event|furball|rockbar|2030-10-03', verdict: 'approve' }, { now: new Date('2030-01-06T00:00:00Z') }))
  );
  assert.equal(newer.decided[0].pendingExecute, true, 'approved after the last execution → pending');
});

test('buildDeck: a row the phone already wrote stays decided even when the fresh analysis changed its shape', () => {
  // Approved on the deck as NEW; the phone found it in the calendar and wrote
  // it as a merge with a title change. The approval's snapshot no longer
  // "covers" that proposal — but the write happened, so no new card.
  const written = newEvent({
    _ownerReviewApproved: { key: 'event|furball|rockbar|2030-10-03', stampedAt: '2030-01-01T00:00:00.000Z' },
    _action: 'merge',
    _existingEvent: { title: 'FURBALL', startDate: iso(FUTURE), endDate: iso(FUTURE + 4 * 3600 * 1000) },
    _original: { scraper: {}, calendar: { title: 'FURBALL', startDate: iso(FUTURE), endDate: iso(FUTURE + 4 * 3600 * 1000), website: 'https://furball.nyc/' } },
    _changes: ['title'],
    _mergeNoOp: false
  });
  const payload = runPayload({ analyzedEvents: [written], executions: [{ executedAt: '2030-01-02T03:04:05.000Z', via: 'owner-review' }] });
  const store = rq.upsertDecision(rq.emptyDecisionStore(), rq.buildDecision({ key: 'event|furball|rockbar|2030-10-03', kind: 'new', verdict: 'approve', snapshot: { kind: 'new', changes: {} } }));
  const deck = deckOf(payload, store);
  assert.equal(deck.cards.length, 0, 'not re-offered');
  assert.equal(deck.decided.length, 1);
  assert.equal(deck.decided[0].decision.verdict, 'approve');
  assert.deepEqual(deck.decided[0].executed, { at: '2030-01-02T03:04:05.000Z', as: 'updated' });
  // Even with the decision store cleared, the written row stays decided.
  const cleared = deckOf(payload, rq.emptyDecisionStore());
  assert.equal(cleared.cards.length, 0);
  assert.equal(cleared.decided[0].decision.stampedAt, '2030-01-01T00:00:00.000Z');
});

test('buildDeck: an execution recorded on an earlier run keeps the approval executed on a later run\'s deck', () => {
  const store = rq.upsertDecision(rq.emptyDecisionStore(), rq.buildDecision({ key: 'event|furball|rockbar|2030-10-03', verdict: 'approve' }, { now: new Date('2030-01-04T00:00:00Z') }));
  const later = runPayload({ analyzedEvents: [newEvent()] });
  const prior = [{ runId: '20300103-050000', executedAt: '2030-01-05T00:00:00.000Z', via: 'owner-review', processed: 6, failed: 0, actionCounts: { create: 1, update: 5 } }];
  const deck = rq.buildDeck(later, store, { runId: '20300106-050000', executions: prior });
  assert.equal(deck.decided[0].pendingExecute, false, 'handed to the phone from the earlier run → not pending again');
  assert.equal(deck.decided[0].executed, null, 'no written row on THIS run, so no mark');
  assert.equal(deck.lastExecution.runId, '20300103-050000');
  assert.equal(deck.lastExecution.at, '2030-01-05T00:00:00.000Z');
  assert.equal(deck.lastExecution.processed, 6);
  // An approval newer than every execution anywhere is still pending.
  const fresh = rq.upsertDecision(rq.emptyDecisionStore(), rq.buildDecision({ key: 'event|furball|rockbar|2030-10-03', verdict: 'approve' }, { now: new Date('2030-01-07T00:00:00Z') }));
  assert.equal(rq.buildDeck(later, fresh, { runId: '20300106-050000', executions: prior }).decided[0].pendingExecute, true);
  // The displayed run's own, newer execution wins the summary line.
  const own = runPayload({ analyzedEvents: [newEvent()], executions: [{ executedAt: '2030-01-08T00:00:00.000Z', via: 'owner-review', processed: 2 }] });
  const ownDeck = rq.buildDeck(own, fresh, { runId: '20300106-050000', executions: prior });
  assert.equal(ownDeck.lastExecution.runId, ownDeck.runId, 'tagged with the displayed run (its payload names the run)');
  assert.equal(ownDeck.decided[0].pendingExecute, false);
});

test('collectExecutions gathers every run file\'s executions newest-last, tagged with the run id, and caches by mtime', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-review-exec-'));
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(runsDir);
  const write = (runId, executions) => fs.writeFileSync(path.join(runsDir, `${runId}.json`), JSON.stringify({ summary: { runId }, analyzedEvents: [], executions }));
  write('20300101-050000', [{ executedAt: '2030-01-01T10:00:00.000Z', via: 'owner-review', processed: 1 }]);
  write('20300102-050000', []);
  write('20300103-050000', [{ executedAt: '2030-01-03T10:00:00.000Z', via: 'owner-review', processed: 2 }, { executedAt: '2030-01-02T23:00:00.000Z', via: 'owner-review', processed: 3 }]);
  fs.writeFileSync(path.join(runsDir, '.20300104-050000.json.icloud'), '');
  const all = rq.collectExecutions(dir);
  assert.deepEqual(all.map((entry) => [entry.runId, entry.executedAt, entry.processed]), [
    ['20300101-050000', '2030-01-01T10:00:00.000Z', 1],
    ['20300103-050000', '2030-01-02T23:00:00.000Z', 3],
    ['20300103-050000', '2030-01-03T10:00:00.000Z', 2]
  ]);
  assert.deepEqual(rq.collectExecutions(dir), all, 'stable on a second read');
  assert.deepEqual(rq.collectExecutions(path.join(dir, 'missing')), []);
});

// ---------------------------------------------------------------------------
// Rejections come back when the scraper changes what it shows (round 2,
// 2026-09-16): the card carries `prior`, "not bear" holds, and a 🐻 on the
// party reverses a "not bear" rejection.
// ---------------------------------------------------------------------------
const { SharedCore: ReviewSharedCore } = require('../scripts/shared-core');
const { EventSchema: ReviewEventSchema } = require('../scripts/event-schema');

test('buildDeck: a rejected new card returns with `prior` once its image (or any shown field) changes; "not bear" keeps it decided', () => {
  const first = deckOf(runPayload({ analyzedEvents: [newEvent()] }));
  assert.equal(first.cards.length, 1);
  let store = rq.upsertDecision(rq.emptyDecisionStore(), rq.buildDecision({
    key: first.cards[0].key, kind: 'new', verdict: 'reject', reason: { tags: [], text: 'Image seems wrong?' }, snapshot: first.cards[0].proposal
  }));

  const unchanged = deckOf(runPayload({ analyzedEvents: [newEvent()] }), store);
  assert.equal(unchanged.cards.length, 0, 'the same proposal stays decided');
  assert.equal(unchanged.counts.rejected, 1);

  const fixed = deckOf(runPayload({ analyzedEvents: [newEvent({ image: 'https://furball.nyc/flyer-2027.jpg' })] }), store);
  assert.equal(fixed.cards.length, 1, 'a changed card is back');
  assert.equal(fixed.decided.length, 0);
  assert.equal(fixed.cards[0].prior.verdict, 'reject');
  assert.equal(fixed.cards[0].prior.reason.text, 'Image seems wrong?');
  assert.deepEqual(fixed.cards[0].prior.drift, ['image']);
  assert.equal(first.cards[0].prior, undefined, 'a first-time card carries no prior');

  store = rq.upsertDecision(rq.emptyDecisionStore(), rq.buildDecision({
    key: first.cards[0].key, kind: 'new', verdict: 'reject', reason: { tags: ['not bear'], text: '' }, snapshot: first.cards[0].proposal
  }));
  const stillOut = deckOf(runPayload({ analyzedEvents: [newEvent({ image: 'https://furball.nyc/flyer-2027.jpg' })] }), store);
  assert.equal(stillOut.cards.length, 0, '"not bear" is about the party, whatever the card shows');
});

test('clearNotBearRejections: a 🐻 on the party removes its "not bear" rejections (any night), nothing else', () => {
  const core = new ReviewSharedCore(CITIES, { eventSchema: ReviewEventSchema });
  const first = deckOf(runPayload({ analyzedEvents: [newEvent()] }));
  const key = first.cards[0].key;
  const otherNight = key.replace(/\d{4}-\d{2}-\d{2}$/, '2030-10-10');
  let store = rq.emptyDecisionStore();
  store = rq.upsertDecision(store, rq.buildDecision({ key, kind: 'new', verdict: 'reject', reason: { tags: ['not bear'], text: '' }, snapshot: first.cards[0].proposal }));
  store = rq.upsertDecision(store, rq.buildDecision({ key: otherNight, kind: 'new', verdict: 'reject', reason: { tags: ['not bear'], text: '' }, snapshot: null }));
  store = rq.upsertDecision(store, rq.buildDecision({ key: 'event|other party|rockbar|2030-10-03', kind: 'new', verdict: 'reject', reason: { tags: ['not bear'], text: '' }, snapshot: null }));
  store = rq.upsertDecision(store, rq.buildDecision({ key: key.replace('2030-10-03', '2030-10-17'), kind: 'new', verdict: 'reject', reason: { tags: ['bad image'], text: '' }, snapshot: null }));

  const cleared = rq.clearNotBearRejections(store, core, { title: 'FURBALL NYC', bar: 'Rockbar', address: '185 Christopher St, New York, NY', city: 'nyc' });
  assert.deepEqual(cleared.removed.sort(), [key, otherNight].sort());
  assert.equal(cleared.store.decisions.length, 2, 'another party and a non-bear reason stay');
  assert.deepEqual(rq.clearNotBearRejections(store, core, { title: '' }).removed, [], 'no title identity: nothing removed');
});

test('buildDeck: pending nights of one party are one series card; a night decided covers its siblings (with `via`); a night that differs is back with the sibling as prior', () => {
  const nights = [0, 7, 14].map((days) => newEvent({
    title: 'DADDY POP', bar: 'Eagle Wilton Manors', city: 'fort-lauderdale', timezone: 'America/New_York',
    startDate: iso(FUTURE + days * 86400000), endDate: iso(FUTURE + days * 86400000 + 4 * 3600000),
    url: 'https://eaglebarwm.com/event/daddy-pop/' + days + '/', image: 'https://eaglebarwm.com/daddy-pop-1.png'
  }));
  const first = deckOf(runPayload({ analyzedEvents: nights }));
  assert.equal(first.cards.length, 3);
  assert.equal(first.cards[0].series.size, 3);
  assert.deepEqual(first.cards.map((c) => c.series.key), Array(3).fill(first.cards[0].series.key));
  assert.equal(first.cards[0].series.nights.length, 3);
  assert.match(first.cards[0].series.nights[0].label, /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/, 'nights are labelled in the event zone');
  assert.equal(deckOf(runPayload({ analyzedEvents: [nights[0]] })).cards[0].series, undefined, 'a lone night is no series');

  const store = rq.upsertDecision(rq.emptyDecisionStore(), rq.buildDecision({ key: first.cards[0].key, kind: 'new', verdict: 'approve', snapshot: first.cards[0].proposal }));
  const later = deckOf(runPayload({ analyzedEvents: nights }), store);
  assert.equal(later.cards.length, 0, 'the other nights inherit the decision');
  assert.equal(later.decided.length, 3);
  assert.deepEqual(later.decided.map((d) => d.via || null), [null, first.cards[0].key, first.cards[0].key]);
  assert.ok(later.decided.every((d) => d.pendingExecute), 'inherited approvals still wait for the phone');

  const newFlyer = nights.map((night, i) => (i === 2 ? { ...night, image: 'https://eaglebarwm.com/daddy-pop-halloween.png' } : night));
  const differs = deckOf(runPayload({ analyzedEvents: newFlyer }), store);
  assert.equal(differs.cards.length, 1);
  assert.equal(differs.cards[0].prior.verdict, 'approve');
  assert.equal(differs.cards[0].prior.night, first.cards[0].key.split('|')[3]);
  assert.deepEqual(differs.cards[0].prior.drift, ['image']);
});

test('buildDeck: merges saying the same thing about sibling nights fold into one series card; a different change stays apart', () => {
  const night = (days, title) => mergeEvent({
    title, bar: 'Nowhere', startDate: iso(FUTURE + days * 86400000), endDate: iso(FUTURE + days * 86400000 + 4 * 3600000),
    _existingEvent: { title: 'Fuzzy at Nowhere', identifier: 'F' + days, startDate: iso(FUTURE + days * 86400000), endDate: iso(FUTURE + days * 86400000 + 4 * 3600000), location: '40.7, -74.0', notes: 'bar: Nowhere' },
    _original: { scraper: {}, calendar: { title: 'Fuzzy at Nowhere', startDate: iso(FUTURE + days * 86400000), notes: 'bar: Nowhere' } },
    _changes: ['title', 'notes']
  });
  const deck = deckOf(runPayload({ analyzedEvents: [night(0, 'Fuzzy'), night(7, 'Fuzzy'), night(14, 'FUZZY!')] }));
  assert.equal(deck.cards.length, 3);
  assert.equal(deck.cards[0].series.size, 2, 'the two identical renames fold');
  assert.equal(deck.cards[1].series.key, deck.cards[0].series.key);
  assert.equal(deck.cards[2].series, undefined, 'the odd rename is its own card');
});

test('run picker: the deck defaults to the newest FULL run; a newer hand-run single parser is labelled and stays selectable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-review-shape-'));
  const runsDir = rq.getRunsDir(dir);
  fs.mkdirSync(runsDir);
  const parsers = Array.from({ length: 29 }, (_, i) => ({ name: 'Parser ' + i }));
  const full = runPayload({ summary: { runId: '20300101-051500' }, config: { cities: CITIES, config: { dryRun: true }, parsers }, parserResults: parsers.slice(0, 25).map((p) => ({ name: p.name })), runContext: { environment: 'node', type: 'automated', trigger: 'scheduled' } });
  const single = runPayload({ summary: { runId: '20300101-100554' }, config: { cities: CITIES, config: { dryRun: true }, parsers }, parserResults: [{ name: 'The Bear Calendar' }], runContext: { environment: 'scriptable', type: 'manual', trigger: 'app' } });
  fs.writeFileSync(path.join(runsDir, '20300101-051500.json'), JSON.stringify(full));
  fs.writeFileSync(path.join(runsDir, '20300101-100554.json'), JSON.stringify(single));
  try {
    assert.equal(rq.pickLatestRunId(dir), '20300101-051500', 'the full run, not the newer single-parser one');
    const described = rq.describeRunFiles(dir);
    assert.deepEqual(described.map((r) => [r.runId, rq.describeRunShapeLabel(r.shape)]), [['20300101-100554', 'The Bear Calendar only'], ['20300101-051500', '']]);
    assert.equal(rq.isCompleteRunShape(rq.describeRunShape(runPayload())), true, 'a run with no parser list is never excluded');
    assert.equal(rq.describeRunShapeLabel({ configured: 29, ran: ['A', 'B', 'C'] }), '3 of 29 parsers');
    fs.rmSync(path.join(runsDir, '20300101-051500.json'));
    assert.equal(rq.pickLatestRunId(dir), '20300101-100554', 'with no full run, the newest run');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildDeck: cards for a city whose calendar the phone lacks are listed with the exact calendar name to create', () => {
  const payload = runPayload({ analyzedEvents: [newEvent(), newEvent({ title: 'BEAR NIGHT BERLIN', city: 'berlin', bar: 'Woof', address: 'Fuggerstr 37', timezone: 'Europe/Berlin' })], config: { cities: { ...CITIES, berlin: { ...(CITIES.berlin || {}), name: 'Berlin', timezone: 'Europe/Berlin', calendar: 'chunky-dad-berlin', patterns: ['berlin'] } }, config: { dryRun: true }, parsers: [] } });
  const withPhone = deckOf(payload, rq.emptyDecisionStore(), { phoneCalendars: new Set(['nyc']) });
  assert.deepEqual(withPhone.missingCalendars, [{ city: 'berlin', calendarName: 'chunky-dad-berlin', events: 1 }]);
  assert.deepEqual(deckOf(payload).missingCalendars, [], 'no phone calendar list → nothing claimed');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-review-cal-'));
  try {
    const cities = { nyc: { calendar: 'chunky-dad-nyc' }, berlin: { calendar: 'chunky-dad-berlin' }, nola: { calendar: 'chunky-dad-new-orleans' } };
    assert.equal(rq.listPhoneCalendars(dir, cities), null, 'the phone has not listed its calendars → nothing is claimed');
    fs.mkdirSync(path.join(dir, 'calendar-snapshot'));
    fs.writeFileSync(path.join(dir, 'calendar-snapshot', 'berlin.json'), '{}');
    assert.equal(rq.listPhoneCalendars(dir, cities), null, 'per-city snapshots prove nothing about the phone\'s calendar list');
    fs.writeFileSync(path.join(dir, 'calendar-snapshot', 'calendars.json'), JSON.stringify({ version: 1, calendars: ['chunky-dad-nyc', 'chunky-dad-new-orleans', 'Holidays in United States'] }));
    assert.deepEqual([...rq.listPhoneCalendars(dir, cities)].sort(), ['nola', 'nyc'], 'calendar titles mapped to city keys');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildDeck: the phone\'s written ledger marks an approval written on any run, and a re-approval since the write is pending again', () => {
  const first = deckOf(runPayload({ analyzedEvents: [newEvent()] }));
  const key = first.cards[0].key;
  const store = rq.upsertDecision(rq.emptyDecisionStore(), { key, kind: 'new', verdict: 'approve', stampedAt: '2030-01-01T00:00:00.000Z', snapshot: first.cards[0].proposal, runId: null, reason: null });
  const ledger = { [key]: { executedAt: '2030-01-01T12:00:00.000Z', action: 'created', title: 'FURBALL NYC' } };
  const written = deckOf(runPayload({ analyzedEvents: [newEvent()] }), store, { writtenLedger: ledger });
  assert.equal(written.decided.length, 1);
  assert.deepEqual(written.decided[0].executed, { at: '2030-01-01T12:00:00.000Z', as: 'created' });
  assert.equal(written.decided[0].pendingExecute, false, 'written → nothing to execute');
  const reapproved = rq.upsertDecision(rq.emptyDecisionStore(), { key, kind: 'new', verdict: 'approve', stampedAt: '2030-01-02T00:00:00.000Z', snapshot: first.cards[0].proposal, runId: null, reason: null });
  const again = deckOf(runPayload({ analyzedEvents: [newEvent()] }), reapproved, { writtenLedger: ledger });
  assert.equal(again.decided[0].executed, null);
  assert.equal(again.decided[0].pendingExecute, true, 'approved after the write → pending');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chunky-ledger-'));
  try {
    assert.deepEqual(rq.loadWrittenLedger(dir), {});
    fs.writeFileSync(path.join(dir, 'written-ledger.json'), JSON.stringify({ version: 1, entries: ledger }));
    assert.deepEqual(rq.loadWrittenLedger(dir), ledger);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the left swipe\'s answers: "needs a fix" is counted as waiting and returns when the card changes; an orphaned note is named', () => {
  const payloadWith = (event) => runPayload({ analyzedEvents: event ? [event] : [] });
  const first = deckOf(payloadWith(newEvent()));
  const card = first.cards.find((entry) => entry.kind === 'new');
  assert.ok(card, 'the fixture has a new card');
  const decision = rq.buildDecision({ key: card.key, kind: 'new', verdict: 'reject', snapshot: card.proposal, reason: { tags: ['bad image'], text: 'wrong flyer', mode: 'fix' } });
  assert.deepEqual(decision.reason, { tags: ['bad image'], text: 'wrong flyer', mode: 'fix' }, 'the mode is stored');
  assert.equal(rq.buildDecision({ key: 'k', verdict: 'reject', reason: { mode: 'banana', tags: ['x'] } }).reason.mode, undefined, 'an unknown mode is dropped');
  const store = rq.upsertDecision(rq.emptyDecisionStore(), decision);

  const waiting = deckOf(payloadWith(newEvent()), store);
  assert.equal(waiting.counts.waiting, 1);
  assert.equal(waiting.decided.find((entry) => entry.key === card.key).rejectionMode, 'fix');
  assert.deepEqual(waiting.waitingGone, []);

  // The scraper now shows another image AND another title for the same card → the
  // title was not asked for, so it is back on the stack (only-the-image would be
  // approved on the owner's behalf — see the auto-approve test).
  const returned = deckOf(payloadWith(newEvent({ image: 'https://cdn.example/the-right-flyer.jpg', title: 'BEEFMINCE x RVT (new name)' })), store);
  assert.ok(returned.cards.some((entry) => entry.prior && entry.prior.reason && entry.prior.reason.text === 'wrong flyer'), 'the fixed card is pending again, carrying the note');
  assert.equal(returned.counts.waiting, 0);

  // The run no longer proposes that card at all → the note is named, not lost.
  const orphaned = deckOf(payloadWith(null), store);
  assert.deepEqual(orphaned.waitingGone.map((entry) => entry.key), [card.key]);
  assert.equal(orphaned.waitingGone[0].reason.text, 'wrong flyer');

  const text = rq.formatRejectionsText(rq.upsertDecision(store, rq.buildDecision({ key: 'event|junk|x|2030-01-01', verdict: 'reject', snapshot: { title: 'Junk' }, reason: { tags: ['fragment'], mode: 'never' } })));
  const lines = text.split('\n');
  assert.ok(lines[0].startsWith('- [NEEDS FIX]'), text);
  assert.ok(lines[1].startsWith('- [NOT AN EVENT]'), text);
});

// ---------------------------------------------------------------------------
// tools/apply-bar-approvals.js — planBarPromotions dedupes by DOOR, not only
// by name: "Locker Room" (Furball's party name, run 20260924-055217) was
// approved at Legacy's own pin and street line.
// ---------------------------------------------------------------------------
test('planBarPromotions: an approval at a curated bar\'s address or pin is a rename, not an addition', () => {
  const { planBarPromotions } = require('../tools/apply-bar-approvals');
  const legacy = { name: 'Legacy', city: 'boston', address: '79 Warrenton St, Boston, MA 02116', coordinates: '42.3499063, -71.0658453' };
  const approval = (snapshot) => ({ kind: 'bar', verdict: 'approve', key: `${snapshot.city}|${snapshot.name}`, snapshot });
  const plan = planBarPromotions({ decisions: [
    approval({ name: 'Locker Room', city: 'boston', address: '79 WARRENTON ST', coordinates: '42.3499063, -71.0658453' }),
    approval({ name: 'Club Cafe', city: 'boston', address: '209 Columbus Ave, Boston, MA 02116', coordinates: '42.3480, -71.0740' }),
    approval({ name: 'Club Café Boston', city: 'boston', address: '209 Columbus Avenue', coordinates: '42.3480100, -71.0740100' })
  ] }, { boston: [legacy] });
  assert.deepEqual(plan.additions.map((entry) => entry.bar.name), ['Club Cafe'], 'one new door; the pin twin in the same batch folds into it');
  assert.deepEqual(plan.skipped.map((entry) => `${entry.name}: ${entry.why}`), [
    'Locker Room: same address/pin as curated "Legacy"',
    'Club Café Boston: same address/pin as curated "Club Cafe"'
  ]);
  // A pin-only approval (no comparable street line) still folds on the pin alone.
  const pinOnly = planBarPromotions({ decisions: [
    approval({ name: 'The Locker Room', city: 'boston', address: 'Boston, MA', coordinates: '42.3499100, -71.0658500' })
  ] }, { boston: [legacy] });
  assert.deepEqual(pinOnly.additions, []);
  assert.equal(pinOnly.skipped[0].why, 'same address/pin as curated "Legacy"');
});

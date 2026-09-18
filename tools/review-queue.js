#!/usr/bin/env node
// ============================================================================
// OWNER REVIEW QUEUE — deck + decision store for the Mac server's swipe page
// (Node-only; lives in tools/ so it NEVER ships to the phone).
// ============================================================================
// The Mac's daily run (tools/run-once.js via launchd) saves its run JSON into
// the shared iCloud dir's runs/. This module turns one such run into a deck
// of cards — every proposal SharedCore.isOwnerReviewCandidate says is worth
// a decision (new events, merges that change a stored field, new bars) — and
// keeps the owner's swipes in <sharedRoot>/owner-decisions.json.
//
// Ownership: the MAC is the only writer of owner-decisions.json (atomic
// write-then-rename); the phone only reads it (ScriptableAdapter
// .loadOwnerDecisions) when a scriptable:///run?…&reviewExecute=1 link asks
// display-saved-run.js to execute the reviewed run. Decisions are keyed by
// SharedCore.getOwnerReviewKey, so a card decided on yesterday's run is
// already decided on today's, and a merge proposing DIFFERENT values comes
// back as a fresh card (SharedCore.ownerDecisionCovers).
//
// Shape of owner-decisions.json:
//   { version: 1, decisions: [ { key, kind: 'new'|'merge'|'bar',
//       verdict: 'approve'|'reject', stampedAt: ISO, runId,
//       reason: { tags: [..], text } | null, snapshot: <the proposal shown> } ] }
//
// Pure helpers are exported for scripts/review-queue.test.js.
// ============================================================================

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

// Same default the launchd installer uses (tools/schedule-mac-run.sh).
const DEFAULT_SHARED_ROOT = path.join(
    os.homedir(),
    'Library', 'Mobile Documents', 'iCloud~dk~simonbs~Scriptable', 'Documents', 'chunky-dad-scraper'
);
const DECISIONS_FILE_NAME = 'owner-decisions.json';
const RUN_ID_PATTERN = /^\d{8}-\d{6}$/;
const RUN_CACHE_LIMIT = 4;

// Reject-sheet chips. Free text rides alongside; these make rejections
// groupable when the log is read back.
const REVIEW_REASON_TAGS = [
    'wrong time', 'wrong date', 'wrong venue', 'wrong title',
    'not bear', 'duplicate', 'fragment', 'bad image', 'other'
];

function resolveSharedRoot(env = process.env) {
    const raw = env && env.CHUNKY_SHARED_STORAGE_DIR;
    return raw && String(raw).trim() ? path.resolve(String(raw).trim()) : DEFAULT_SHARED_ROOT;
}

function getRunsDir(sharedRoot) {
    return path.join(sharedRoot, 'runs');
}

function getDecisionsPath(sharedRoot) {
    return path.join(sharedRoot, DECISIONS_FILE_NAME);
}

// Runs in the shared dir, newest first by run id (YYYYMMDD-HHMMSS sorts
// chronologically). iCloud placeholders (".<name>.icloud", not yet local)
// are listed as unavailable — reading one would block on the download.
function listRunFiles(sharedRoot) {
    const runsDir = getRunsDir(sharedRoot);
    let names;
    try {
        names = fs.readdirSync(runsDir);
    } catch (error) {
        return [];
    }
    const entries = [];
    for (const name of names) {
        const placeholder = /^\.(\d{8}-\d{6})\.json\.icloud$/.exec(name);
        if (placeholder) {
            entries.push({ runId: placeholder[1], path: path.join(runsDir, name), available: false, mtimeMs: 0, size: 0 });
            continue;
        }
        const match = /^(\d{8}-\d{6})\.json$/.exec(name);
        if (!match) continue;
        const filePath = path.join(runsDir, name);
        let stat;
        try {
            stat = fs.statSync(filePath);
        } catch (error) {
            continue;
        }
        entries.push({ runId: match[1], path: filePath, available: true, mtimeMs: stat.mtimeMs, size: stat.size });
    }
    entries.sort((a, b) => b.runId.localeCompare(a.runId));
    return entries;
}

function pickLatestRunId(sharedRoot) {
    const first = listRunFiles(sharedRoot).find((entry) => entry.available);
    return first ? first.runId : null;
}

// Run files are large (a full Mac run is ~13 MB); keep the last few parsed
// payloads keyed by path + mtime + size so every deck request does not
// re-parse.
const runCache = new Map();
function readRunFile(filePath) {
    const stat = fs.statSync(filePath);
    const cached = runCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.payload;
    }
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    runCache.delete(filePath);
    runCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, payload });
    while (runCache.size > RUN_CACHE_LIMIT) {
        runCache.delete(runCache.keys().next().value);
    }
    return payload;
}

// Every phone execution recorded on ANY run file in the shared dir, newest
// last: [{ runId, executedAt, via, processed, failed, actionCounts, ownerReview }].
// A decision handed to the phone is executed for good, whichever run's deck
// shows it — run 20260914-214512's deck counted the seven approvals executed
// on run 164140 as pending again, because only the displayed run's own
// executions[] was consulted. Run files are large, so each file's
// executions are cached by path + mtime + size and re-read only on change.
const executionsCache = new Map();
function collectExecutions(sharedRoot) {
    const collected = [];
    for (const entry of listRunFiles(sharedRoot)) {
        if (!entry.available) continue;
        const cached = executionsCache.get(entry.path);
        let executions;
        if (cached && cached.mtimeMs === entry.mtimeMs && cached.size === entry.size) {
            executions = cached.executions;
        } else {
            try {
                const payload = readRunFile(entry.path);
                executions = Array.isArray(payload.executions) ? payload.executions : [];
            } catch (error) {
                executions = [];
            }
            executionsCache.set(entry.path, { mtimeMs: entry.mtimeMs, size: entry.size, executions });
        }
        for (const execution of executions) {
            if (!execution || typeof execution.executedAt !== 'string') continue;
            collected.push({ ...execution, runId: entry.runId });
        }
    }
    collected.sort((a, b) => a.executedAt.localeCompare(b.executedAt));
    return collected;
}

// { runId, payload } for a run id in the shared dir, or null. The id is
// validated against the run-id shape so a request can never name a path.
function loadRun(sharedRoot, runId) {
    const id = String(runId || '').trim();
    if (!RUN_ID_PATTERN.test(id)) return null;
    const filePath = path.join(getRunsDir(sharedRoot), `${id}.json`);
    try {
        if (!fs.existsSync(filePath)) return null;
        return { runId: id, payload: readRunFile(filePath) };
    } catch (error) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Decision store
// ---------------------------------------------------------------------------

function emptyDecisionStore() {
    return { version: 1, decisions: [] };
}

function isDecisionShaped(entry) {
    return Boolean(entry && typeof entry === 'object'
        && typeof entry.key === 'string' && entry.key
        && (entry.verdict === 'approve' || entry.verdict === 'reject'));
}

function normalizeDecisionStore(parsed) {
    const list = parsed && !Array.isArray(parsed) && Array.isArray(parsed.decisions)
        ? parsed.decisions
        : Array.isArray(parsed) ? parsed : [];
    return { version: 1, decisions: list.filter(isDecisionShaped) };
}

function loadDecisions(decisionsPath) {
    try {
        if (!fs.existsSync(decisionsPath)) return emptyDecisionStore();
        return normalizeDecisionStore(JSON.parse(fs.readFileSync(decisionsPath, 'utf8')));
    } catch (error) {
        console.warn(`review-queue: decision store unreadable (${error.message}) — treating as empty, the next decision rewrites it`);
        return emptyDecisionStore();
    }
}

// Atomic: the phone may be reading this file through iCloud at any moment,
// so it only ever sees a complete document.
function saveDecisions(decisionsPath, store) {
    const normalized = normalizeDecisionStore(store);
    fs.mkdirSync(path.dirname(decisionsPath), { recursive: true });
    const tmpPath = `${decisionsPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2));
    fs.renameSync(tmpPath, decisionsPath);
    return normalized;
}

function normalizeReason(reason) {
    if (!reason || typeof reason !== 'object') return null;
    const tags = Array.isArray(reason.tags)
        ? reason.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
        : [];
    const text = typeof reason.text === 'string' ? reason.text.trim() : '';
    if (tags.length === 0 && !text) return null;
    return { tags, text };
}

// One decision record from a swipe. Throws on a malformed request so the
// route can answer 400 instead of storing junk.
function buildDecision(input, options = {}) {
    if (!input || typeof input !== 'object') throw new Error('decision body must be an object');
    const key = typeof input.key === 'string' ? input.key.trim() : '';
    if (!key) throw new Error('decision needs a key');
    const verdict = input.verdict === 'approve' || input.verdict === 'reject' ? input.verdict : null;
    if (!verdict) throw new Error('verdict must be approve or reject');
    const kind = input.kind === 'merge' || input.kind === 'override' || input.kind === 'bar' ? input.kind : 'new';
    const snapshot = input.snapshot && typeof input.snapshot === 'object' ? input.snapshot : null;
    const now = options.now instanceof Date ? options.now : new Date();
    return {
        key,
        kind,
        verdict,
        stampedAt: now.toISOString(),
        runId: typeof input.runId === 'string' ? input.runId : null,
        reason: normalizeReason(input.reason),
        snapshot
    };
}

function upsertDecision(store, decision) {
    const normalized = normalizeDecisionStore(store);
    const index = normalized.decisions.findIndex((entry) => entry.key === decision.key);
    if (index >= 0) normalized.decisions[index] = decision;
    else normalized.decisions.push(decision);
    return normalized;
}

// A 🐻 on a dropped card reverses an earlier "not bear" rejection of the
// same party (title tokens + place, any night): that rejection would
// otherwise keep the party's next card off the deck for good —
// SharedCore.ownerDecisionCovers holds "not bear" rejections whatever
// changed. Returns the keys it removed.
function clearNotBearRejections(store, core, event) {
    const SharedCore = loadSharedCore();
    const normalized = normalizeDecisionStore(store);
    const titleKey = core.getBearVerdictTitleKey((event && (event.title || event.name)) || '', [event && (event.bar || event.venue)]);
    if (!titleKey) return { store: normalized, removed: [] };
    const prefix = `event|${titleKey}|${core.getOwnerReviewPlaceKey(event)}|`;
    const removed = normalized.decisions
        .filter((entry) => entry.verdict === 'reject' && String(entry.key || '').startsWith(prefix) && SharedCore.ownerDecisionSaysNotBear(entry))
        .map((entry) => entry.key);
    if (removed.length > 0) normalized.decisions = normalized.decisions.filter((entry) => !removed.includes(entry.key));
    return { store: normalized, removed };
}

function clearDecision(store, key) {
    const normalized = normalizeDecisionStore(store);
    const before = normalized.decisions.length;
    normalized.decisions = normalized.decisions.filter((entry) => entry.key !== key);
    return { store: normalized, removed: before !== normalized.decisions.length };
}

// ---------------------------------------------------------------------------
// Bear verdict store — bear-verdicts.json, the SAME file the phone's results
// sheet writes on a 🐻/🚫 tap (ScriptableAdapter.persistBearVerdictTap) and
// the scraper reads at run start (SharedCore.findStoredBearVerdict, tier 0
// of the bear cascade). The deck's bear buttons upsert into it with the
// same identity (title tokens + fail-closed place match), so a verdict
// swiped here is honoured by the next phone run exactly like a tapped one.
// ---------------------------------------------------------------------------

const BEAR_VERDICTS_FILE_NAME = 'bear-verdicts.json';

function getBearVerdictsPath(sharedRoot) {
    return path.join(sharedRoot, BEAR_VERDICTS_FILE_NAME);
}

function normalizeBearVerdicts(parsed) {
    const list = parsed && !Array.isArray(parsed) && Array.isArray(parsed.verdicts)
        ? parsed.verdicts
        : Array.isArray(parsed) ? parsed : [];
    return list.filter((entry) => entry && typeof entry === 'object'
        && (entry.verdict === 'bear' || entry.verdict === 'not_bear'));
}

function loadBearVerdicts(verdictsPath) {
    try {
        if (!fs.existsSync(verdictsPath)) return [];
        return normalizeBearVerdicts(JSON.parse(fs.readFileSync(verdictsPath, 'utf8')));
    } catch (error) {
        console.warn(`review-queue: bear verdict store unreadable (${error.message}) — treating as empty`);
        return [];
    }
}

function saveBearVerdicts(verdictsPath, verdicts) {
    const list = normalizeBearVerdicts(verdicts);
    fs.mkdirSync(path.dirname(verdictsPath), { recursive: true });
    const tmpPath = `${verdictsPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify({ version: 1, verdicts: list }, null, 2));
    fs.renameSync(tmpPath, verdictsPath);
    return list;
}

// The identity the deck posts back for a 🐻/🚫 tap: enough for
// SharedCore's verdict-store identity, nothing more.
function buildBearIdentity(event) {
    return {
        title: String((event && (event.title || event.name)) || ''),
        bar: String((event && (event.bar || event.venue)) || ''),
        address: typeof (event && event.address) === 'string' ? event.address : '',
        location: typeof (event && event.location) === 'string' ? event.location : '',
        city: typeof (event && event.city) === 'string' ? event.city : ''
    };
}

// Same entry shape and upsert rule as persistBearVerdictTap: one entry per
// party-at-venue, last tap wins. Returns { verdicts, entry } or throws on a
// record with no title identity.
function upsertBearVerdict(verdicts, core, identity, verdict, options = {}) {
    if (verdict !== 'bear' && verdict !== 'not_bear') throw new Error('verdict must be bear or not_bear');
    const id = buildBearIdentity(identity);
    const key = core.getBearVerdictTitleKey(id.title, [id.bar]);
    if (!key) throw new Error('event carries no title identity');
    const now = options.now instanceof Date ? options.now : new Date();
    const entry = { verdict, stampedAt: now.toISOString(), title: id.title, venue: id.bar, address: id.address, location: id.location, city: id.city };
    const list = normalizeBearVerdicts(verdicts).slice();
    const index = list.findIndex((existing) =>
        core.getBearVerdictTitleKey(existing.title, [existing.venue]) === key
        && core.bearVerdictPlaceMatches({ title: id.title, bar: id.bar, address: id.address, location: id.location, city: id.city }, existing));
    if (index >= 0) list[index] = entry;
    else list.push(entry);
    return { verdicts: list, entry };
}

function clearBearVerdict(verdicts, core, identity) {
    const id = buildBearIdentity(identity);
    const key = core.getBearVerdictTitleKey(id.title, [id.bar]);
    const list = normalizeBearVerdicts(verdicts);
    const kept = list.filter((existing) =>
        !(key && core.getBearVerdictTitleKey(existing.title, [existing.venue]) === key
            && core.bearVerdictPlaceMatches({ title: id.title, bar: id.bar, address: id.address, location: id.location, city: id.city }, existing)));
    return { verdicts: kept, removed: kept.length !== list.length };
}

// ---------------------------------------------------------------------------
// Curated bars (data/bars/<city>.json) — approved candidates already promoted
// (or hand-curated) must not come back as cards.
// ---------------------------------------------------------------------------

function loadCuratedBars(root = repoRoot) {
    const barsDir = path.join(root, 'data', 'bars');
    const bars = {};
    let names;
    try {
        names = fs.readdirSync(barsDir);
    } catch (error) {
        return bars;
    }
    for (const name of names) {
        if (!name.endsWith('.json')) continue;
        try {
            const parsed = JSON.parse(fs.readFileSync(path.join(barsDir, name), 'utf8'));
            if (Array.isArray(parsed)) bars[name.replace(/\.json$/, '')] = parsed;
        } catch (error) {
            /* a broken city file is the generator's problem, not the deck's */
        }
    }
    return bars;
}

// ---------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------

function loadSharedCore() {
    return require(path.join(repoRoot, 'scripts', 'shared-core')).SharedCore;
}

function loadEventSchema() {
    return require(path.join(repoRoot, 'scripts', 'event-schema')).EventSchema;
}

function createDeckCore(runPayload, options = {}) {
    if (options.core) return options.core;
    const SharedCore = loadSharedCore();
    const cities = (runPayload && runPayload.config && runPayload.config.cities) || {};
    return new SharedCore(cities, {
        eventSchema: loadEventSchema(),
        bars: options.curatedBars || {}
    });
}

function buildBarProposal(candidate) {
    return {
        kind: 'bar',
        key: `bar|${candidate.key}`,
        name: String(candidate.name || ''),
        city: String(candidate.city || ''),
        address: String(candidate.address || ''),
        coordinates: String(candidate.coordinates || ''),
        signals: Array.isArray(candidate.signals) ? candidate.signals.slice() : [],
        website: typeof candidate.website === 'string' ? candidate.website : '',
        instagram: typeof candidate.instagram === 'string' ? candidate.instagram : '',
        sourceEvents: Array.isArray(candidate.sourceEvents) ? candidate.sourceEvents.slice(0, 5) : [],
        evidence: Array.isArray(candidate.evidence) ? candidate.evidence.slice(0, 8) : []
    };
}

// Everything the CARD shows beyond the decision snapshot: read from the full
// analyzed event and the run payload at deck time, never persisted (the
// proposal is the decision contract and stays scalar — see
// SharedCore.ownerDecisionCovers). Missing on decided entries re-rendered
// from a stored snapshot; renderers must degrade without it.
function buildReviewDisplayContext(event, payload, core, extras = {}) {
    const SharedCore = loadSharedCore();
    const EventSchema = loadEventSchema();
    const parserNames = extras.parserNamesByKey || new Map();
    const parserConfigName = event._parserConfig && typeof event._parserConfig === 'object' && typeof event._parserConfig.name === 'string'
        ? event._parserConfig.name
        : '';
    const host = (url) => core.getHostFromUrl(url).replace(/^www\./i, '');
    const pageHost = (typeof event._venueSitePageHost === 'string' && event._venueSitePageHost)
        || host(event._sourcePageUrl)
        || host(event.url || event.website);
    const image = EventSchema.pickImageForOrientation(event, 'portrait', {
        classifyOrientation: (url) => core.classifyImageOrientation(url)
    }) || (typeof event.image === 'string' ? event.image : '');
    const seriesMatch = event._seriesMatch && typeof event._seriesMatch === 'object' ? event._seriesMatch : null;
    // The merge's own reason per changed stored field (one wording with the
    // results card: SharedCore.describeMergeDecision), and which notes keys
    // moved besides — minus the bookkeeping the scraper regenerates anyway.
    const bookkeepingKeys = new Set(['key', 'gmaps', 'favicon', 'timezone']
        .concat((SharedCore.PROVENANCE_COMPANION_FIELDS || []).filter((name) => name !== 'bearSource')));
    const changeContext = {};
    if (event._action === 'merge' && Array.isArray(event._mergeDecisions)) {
        const scraper = (event._original && event._original.scraper) || {};
        for (const field of SharedCore.getOwnerReviewChangeFields()) {
            const record = event._mergeDecisions.reduce((latest, entry) => (entry && entry.field === field ? entry : latest), null);
            if (!record) continue;
            const outcome = SharedCore.normalizeOwnerReviewValue(event[field]) === SharedCore.normalizeOwnerReviewValue(scraper[field])
                ? 'took-new'
                : 'rewrote';
            changeContext[field] = SharedCore.describeMergeDecision(record, outcome);
        }
    }
    const diff = event._mergeDiff && typeof event._mergeDiff === 'object' ? event._mergeDiff : {};
    const notesKeys = (list) => (Array.isArray(list) ? list : [])
        .map((entry) => (entry && typeof entry === 'object' ? entry.key : entry))
        .filter((key) => typeof key === 'string' && key && !bookkeepingKeys.has(key));
    // The notes-level changes WITH their values, minus bookkeeping — for an
    // update or override whose stored fields all match, these rows ARE the
    // diff (CUBSCOUT's four overrides differed only by a soft-hyphen in the
    // short name and one facebook link).
    const notesChanges = []
        .concat((Array.isArray(diff.updated) ? diff.updated : []).map((entry) => entry && typeof entry === 'object' && !bookkeepingKeys.has(entry.key)
            ? { key: entry.key, from: entry.from == null ? '' : String(entry.from), to: entry.to == null ? '' : String(entry.to) } : null))
        .concat((Array.isArray(diff.added) ? diff.added : []).map((entry) => entry && typeof entry === 'object' && !bookkeepingKeys.has(entry.key)
            ? { key: entry.key, from: '', to: entry.value == null ? '' : String(entry.value) } : null))
        .concat((Array.isArray(diff.removed) ? diff.removed : []).map((entry) => entry && typeof entry === 'object' && !bookkeepingKeys.has(entry.key)
            ? { key: entry.key, from: entry.value == null ? '' : String(entry.value), to: '' } : null))
        .filter(Boolean);
    const storedVerdict = Array.isArray(core.bearVerdicts) && core.bearVerdicts.length > 0
        ? core.findStoredBearVerdict(event)
        : null;
    return {
        bearVerdict: storedVerdict ? storedVerdict.verdict : null,
        bearVerdictStampedAt: storedVerdict ? storedVerdict.stampedAt || null : null,
        bearIdentity: buildBearIdentity(event),
        isBearEvent: event.isBearEvent === true,
        barSource: typeof event.barSource === 'string' ? event.barSource : '',
        favicon: typeof event.favicon === 'string' ? event.favicon : '',
        changeContext,
        notesChanges,
        notesAdded: notesKeys(diff.added),
        notesUpdated: notesKeys(diff.updated),
        notesRemoved: notesKeys(diff.removed),
        parserName: (typeof event.key === 'string' && parserNames.get(event.key)) || parserConfigName || '',
        pageHost,
        analysisReason: event._analysis && typeof event._analysis.reason === 'string' ? event._analysis.reason : '',
        bearSource: typeof event.bearSource === 'string' ? event.bearSource : '',
        bearReview: typeof event.bearReview === 'string' ? event.bearReview : '',
        linkHistory: event._calendarLinkHistory && typeof event._calendarLinkHistory === 'object' ? event._calendarLinkHistory : null,
        evidenceLines: Array.isArray(event._evidenceLines) ? event._evidenceLines.filter((line) => typeof line === 'string').slice(0, 6) : [],
        notes: typeof event.notes === 'string' ? event.notes : '',
        recurring: SharedCore.isRecurringSeriesEvent(event),
        seriesMatchTitle: seriesMatch ? String(seriesMatch.title || '') : '',
        sanityCodes: Array.isArray(event._sanityFlags) ? event._sanityFlags.map((flag) => flag && flag.code).filter(Boolean) : [],
        venueOverlaps: Array.isArray(event._venueOverlap) ? event._venueOverlap.map((entry) => entry && (entry.withTitle || entry.title)).filter(Boolean).slice(0, 3) : [],
        image,
        imageOrientation: image ? core.classifyImageOrientation(image) : 'unknown',
        imageDimensions: image ? core.getImageDimensionsFromUrl(image) : null,
        imageRepeatCount: image && extras.imageUseCounts ? (extras.imageUseCounts.get(image) || 0) : 0,
        gmaps: typeof event.gmaps === 'string' ? event.gmaps : '',
        instagram: typeof event.instagram === 'string' ? event.instagram : '',
        facebook: typeof event.facebook === 'string' ? event.facebook : '',
        website: typeof event.website === 'string' ? event.website : '',
        shortName: typeof event.shortName === 'string' ? event.shortName : '',
        notesOnlyAlso: Array.isArray(event._changes) && event._changes.includes('notes')
    };
}

// parserResults[].events[].key → parser name (the saved event's own
// _parserConfig is slimmed on save and can be "[Circular]").
function buildParserNamesByKey(payload) {
    const map = new Map();
    for (const result of Array.isArray(payload.parserResults) ? payload.parserResults : []) {
        if (!result || typeof result.name !== 'string') continue;
        for (const event of Array.isArray(result.events) ? result.events : []) {
            if (event && typeof event.key === 'string' && event.key && !map.has(event.key)) map.set(event.key, result.name);
        }
    }
    return map;
}

// Same census the results UI runs: an image reused by ≥3 records is a venue
// placeholder tile, not this event's flyer (flag, don't drop).
function buildImageUseCounts(payload) {
    const counts = new Map();
    const count = (event) => {
        const image = event && typeof event.image === 'string' ? event.image.trim() : '';
        if (image) counts.set(image, (counts.get(image) || 0) + 1);
    };
    (Array.isArray(payload.analyzedEvents) ? payload.analyzedEvents : []).forEach(count);
    (Array.isArray(payload.bearDroppedEvents) ? payload.bearDroppedEvents : []).forEach((entry) => count(entry && entry.event));
    return counts;
}

// The decision a re-surfacing NEW card is a second look after: one on its
// own key, else the newest on another night of the same party (with the
// night it was made on and what this night does differently).
function findPriorDecision(proposal, decisions, SharedCore) {
    const own = decisions.find((entry) => entry.key === proposal.key);
    if (own) return { verdict: own.verdict, stampedAt: own.stampedAt || null, reason: own.reason || null, drift: SharedCore.getOwnerReviewDrift(own, proposal) };
    if (proposal.kind !== 'new') return null;
    const series = SharedCore.getOwnerReviewSeriesKey(proposal.key);
    if (!series) return null;
    const sibling = decisions
        .filter((entry) => (entry.kind || 'new') === 'new' && SharedCore.getOwnerReviewSeriesKey(entry.key) === series)
        .sort((a, b) => String(b.stampedAt || '').localeCompare(String(a.stampedAt || '')))[0];
    if (!sibling) return null;
    return {
        verdict: sibling.verdict,
        stampedAt: sibling.stampedAt || null,
        reason: sibling.reason || null,
        drift: SharedCore.getOwnerReviewSeriesDrift(sibling, proposal),
        night: String(sibling.key).split('|')[3] || ''
    };
}

// Pending NEW nights of one party (same title and place) are one card on
// the deck — one swipe decides them all, each under its own key. Every
// member carries the group and its nights, labelled in the event's zone.
function formatNightLabel(proposal) {
    const ms = proposal ? loadSharedCore().toEpochMillis(proposal.startDate) : null;
    if (ms === null) return '';
    try {
        return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(proposal.timezone ? { timeZone: proposal.timezone } : {}) }).format(new Date(ms));
    } catch (_) {
        return new Date(ms).toISOString().slice(0, 10);
    }
}
function stampSeries(cards, SharedCore) {
    const groups = new Map();
    for (const card of cards) {
        if (card.kind !== 'new') continue;
        const series = SharedCore.getOwnerReviewSeriesKey(card.key);
        if (!series) continue;
        if (!groups.has(series)) groups.set(series, []);
        groups.get(series).push(card);
    }
    for (const [series, members] of groups) {
        if (members.length < 2) continue;
        const nights = members.map((card) => ({ key: card.key, day: String(card.key).split('|')[3] || '', label: formatNightLabel(card.proposal) }));
        for (const card of members) card.series = { key: series, size: members.length, nights };
    }
}

// One saved run + the decision store → { runId, cards, decided, counts }.
// cards = proposals with no covering decision (past events dropped);
// decided = proposals a stored decision already covers (with that decision).
function buildDeck(runPayload, store, options = {}) {
    const payload = runPayload && typeof runPayload === 'object' ? runPayload : {};
    const decisions = normalizeDecisionStore(store).decisions;
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const SharedCore = loadSharedCore();
    const core = createDeckCore(payload, options);
    core.bearVerdicts = Array.isArray(options.bearVerdicts) ? options.bearVerdicts : [];
    const runId = (payload.summary && payload.summary.runId) || options.runId || null;
    const cards = [];
    const decided = [];
    const counts = { pending: 0, decided: 0, approved: 0, rejected: 0, new: 0, merge: 0, override: 0, bar: 0, dropped: 0, droppedDecided: 0, pastSkipped: 0 };

    // A row the phone re-analyzed and wrote carries _ownerReviewApproved and
    // its fresh action; the run file's executions[] dates it. Executions
    // recorded on OTHER run files (options.executions, see collectExecutions)
    // count too: an approval handed to the phone from an earlier run's deck
    // is not pending again on today's.
    const ownExecutions = (Array.isArray(payload.executions) ? payload.executions : [])
        .map((entry) => (entry && typeof entry === 'object' ? { ...entry, runId: entry.runId || runId } : entry));
    const otherExecutions = (Array.isArray(options.executions) ? options.executions : [])
        .filter((entry) => entry && typeof entry === 'object' && entry.runId !== runId);
    const executions = ownExecutions.concat(otherExecutions)
        .filter((entry) => entry && typeof entry.executedAt === 'string')
        .sort((a, b) => a.executedAt.localeCompare(b.executedAt));
    const lastExecutedAt = executions.length > 0 ? executions[executions.length - 1].executedAt : '';
    const executedMark = (entry) => {
        const event = analyzed[entry.sourceIndex];
        if (!event || !event._ownerReviewApproved) return null;
        return { at: lastExecutedAt || null, as: event._action === 'merge' ? 'updated' : 'created' };
    };
    const file = (entry, decision) => {
        if (decision) {
            const isEventKind = entry.kind === 'new' || entry.kind === 'merge' || entry.kind === 'override';
            const executed = isEventKind ? executedMark(entry) : null;
            // Still waiting for "Execute on phone": an approval the phone has
            // not written, and that is newer than the run's last execution
            // (an older one was already handed to the phone — written or
            // withheld there).
            const pendingExecute = isEventKind && decision.verdict === 'approve' && !executed
                && (!lastExecutedAt || String(decision.stampedAt || '') > lastExecutedAt);
            // Decided on another night of the same party (series coverage —
            // SharedCore.ownerDecisionCovers): the phone has not written THIS
            // night until its row says so, whatever the decision's stamp.
            const via = decision.key !== entry.key ? decision.key : '';
            decided.push({ ...entry, decision, executed, pendingExecute: via ? isEventKind && decision.verdict === 'approve' && !executed : pendingExecute, ...(via ? { via } : {}) });
            counts.decided++;
            if (decision.verdict === 'approve') counts.approved++;
            else counts.rejected++;
        } else {
            cards.push(entry);
            counts.pending++;
            counts[entry.kind]++;
        }
    };

    const extras = { parserNamesByKey: buildParserNamesByKey(payload), imageUseCounts: buildImageUseCounts(payload) };
    const analyzed = Array.isArray(payload.analyzedEvents) ? payload.analyzedEvents : [];
    analyzed.forEach((event, index) => {
        if (!core.isOwnerReviewCandidate(event)) return;
        const proposal = core.buildOwnerReviewProposal(event);
        if (!proposal) return;
        const endMs = SharedCore.toEpochMillis(proposal.endDate);
        const startMs = SharedCore.toEpochMillis(proposal.startDate);
        const lastMs = endMs !== null ? endMs : startMs;
        if (lastMs !== null && lastMs < now) {
            counts.pastSkipped++;
            return;
        }
        // A row the phone already re-analyzed and WROTE (its executed run
        // rewrote the file with _ownerReviewApproved on that row) is done,
        // whatever the fresh analysis turned it into — a "new" approved on
        // the deck often comes back as a merge with changes once the phone
        // checked its real calendar, and that must not re-offer the card.
        const writtenDecision = event._ownerReviewApproved && typeof event._ownerReviewApproved === 'object'
            ? (decisions.find((decision) => decision.key === event._ownerReviewApproved.key && decision.verdict === 'approve')
                || { key: event._ownerReviewApproved.key || proposal.key, kind: proposal.kind, verdict: 'approve', stampedAt: event._ownerReviewApproved.stampedAt || null, reason: null, snapshot: null })
            : null;
        const decision = writtenDecision || SharedCore.findOwnerDecision(proposal, decisions);
        // A decision on this key that no longer covers the proposal (the
        // scraper changed what it shows — SharedCore.getOwnerReviewDrift)
        // rides on the card as `prior`, so the owner sees it is a second
        // look, what they said last time, and what changed since.
        const prior = decision ? null : findPriorDecision(proposal, decisions, SharedCore);
        file(
            {
                id: `e${index}`,
                kind: proposal.kind,
                key: proposal.key,
                sourceIndex: index,
                proposal,
                display: buildReviewDisplayContext(event, payload, core, extras),
                ...(prior ? { prior } : {})
            },
            decision
        );
    });
    stampSeries(cards, SharedCore);

    const candidates = Array.isArray(payload.newVenueCandidates) ? payload.newVenueCandidates : [];
    candidates.forEach((candidate, index) => {
        if (!candidate || typeof candidate !== 'object' || typeof candidate.key !== 'string' || !candidate.key) return;
        const cityBars = core.getCuratedCityBars(String(candidate.city || '').trim().toLowerCase());
        if (cityBars && core.findCuratedBarByName(cityBars, candidate.name)) return;
        const proposal = buildBarProposal(candidate);
        file(
            { id: `b${index}`, kind: 'bar', key: proposal.key, sourceIndex: index, proposal },
            SharedCore.findOwnerDecision(proposal, decisions)
        );
    });

    // Events the bear check DROPPED (flag, don't drop — they are in the run
    // file with their reason): one card per party-at-venue, so the owner can
    // say "that IS bear" (→ a stored verdict the next run honours) or confirm
    // the drop. Already-judged parties (a stored verdict) are decided.
    const dropped = Array.isArray(payload.bearDroppedEvents) ? payload.bearDroppedEvents : [];
    const droppedByKey = new Map();
    dropped.forEach((entry, index) => {
        const event = entry && entry.event && typeof entry.event === 'object' ? entry.event : null;
        if (!event) return;
        const endMs = SharedCore.toEpochMillis(event.endDate);
        const startMs = SharedCore.toEpochMillis(event.startDate);
        const lastMs = endMs !== null ? endMs : startMs;
        if (lastMs !== null && lastMs < now) return;
        const titleKey = core.getBearVerdictTitleKey(event.title || event.name, [event.bar || event.venue]);
        if (!titleKey) return;
        const key = `dropped|${titleKey}|${core.getOwnerReviewPlaceKey(event)}`;
        const existing = droppedByKey.get(key);
        if (existing) {
            existing.proposal.occurrences += 1;
            return;
        }
        const timezone = event.timezone || core.getCityTimezone(event.city) || null;
        const iso = (value) => {
            const ms = SharedCore.toEpochMillis(value);
            return ms === null ? null : new Date(ms).toISOString();
        };
        const description = String(event.description || '').trim();
        const proposal = {
            kind: 'dropped',
            key,
            title: String(event.title || ''),
            startDate: iso(event.startDate),
            endDate: iso(event.endDate),
            timezone,
            bar: String(event.bar || entry.venue || ''),
            address: String(event.address || ''),
            city: String(event.city || ''),
            location: typeof event.location === 'string' ? event.location : '',
            source: String(event.source || ''),
            url: String(event.url || event.website || ''),
            ticketUrl: String(event.ticketUrl || ''),
            image: String(event.image || ''),
            cover: String(event.cover || ''),
            description: description.length > 600 ? `${description.slice(0, 600)}…` : description,
            dropReason: String(entry.reason || ''),
            host: String(entry.host || ''),
            occurrences: 1,
            changes: {}
        };
        // A dropped card asks one question (bear or not), so it travels
        // without the notes table — 160 of them per run add up.
        const display = buildReviewDisplayContext(event, payload, core, extras);
        display.notes = '';
        const card = { id: `d${index}`, kind: 'dropped', key, sourceIndex: index, proposal, display };
        droppedByKey.set(key, card);
    });
    for (const card of droppedByKey.values()) {
        if (card.display.bearVerdict) {
            decided.push({ ...card, decision: { key: card.key, kind: 'dropped', verdict: card.display.bearVerdict === 'bear' ? 'approve' : 'reject', stampedAt: card.display.bearVerdictStampedAt, reason: null, bearVerdict: card.display.bearVerdict } });
            counts.decided++;
            counts.droppedDecided++;
        } else {
            cards.push(card);
            counts.dropped++;
        }
    }

    const lastExecution = executions.length > 0 ? executions[executions.length - 1] : null;
    return {
        runId,
        savedAt: (payload.summary && payload.summary.timestamp) || null,
        environment: (payload.runContext && payload.runContext.environment) || null,
        cards,
        decided,
        counts,
        lastExecution: lastExecution ? {
            at: lastExecution.executedAt || null,
            runId: lastExecution.runId || null,
            via: lastExecution.via || null,
            processed: Number(lastExecution.processed) || 0,
            failed: Number(lastExecution.failed) || 0,
            created: lastExecution.actionCounts ? Number(lastExecution.actionCounts.create) || 0 : null,
            updated: lastExecution.actionCounts ? Number(lastExecution.actionCounts.update) || 0 : null,
            ownerReview: lastExecution.ownerReview || null
        } : null
    };
}

// Copy-ready text of every rejection (reasons are the fix queue).
function formatRejectionsText(store) {
    const lines = [];
    for (const decision of normalizeDecisionStore(store).decisions) {
        if (decision.verdict !== 'reject') continue;
        const snap = decision.snapshot || {};
        const label = snap.kind === 'bar'
            ? `BAR ${snap.name || ''} (${snap.city || ''})`
            : `${(snap.kind || decision.kind || 'new').toUpperCase()} ${snap.title || ''} — ${String(snap.startDate || '').slice(0, 10)} @ ${snap.bar || snap.city || ''} [${snap.source || ''}]`;
        const tags = decision.reason && decision.reason.tags && decision.reason.tags.length > 0
            ? ` {${decision.reason.tags.join(', ')}}`
            : '';
        const text = decision.reason && decision.reason.text ? ` — ${decision.reason.text}` : '';
        const changes = snap.changes && typeof snap.changes === 'object'
            ? Object.keys(snap.changes).map((field) => `${field}: ${snap.changes[field].from || '∅'} → ${snap.changes[field].to || '∅'}`).join('; ')
            : '';
        lines.push(`- ${label}${tags}${text}${changes ? ` (${changes})` : ''}`);
    }
    return lines.join('\n');
}

module.exports = {
    DEFAULT_SHARED_ROOT,
    DECISIONS_FILE_NAME,
    REVIEW_REASON_TAGS,
    RUN_ID_PATTERN,
    resolveSharedRoot,
    getRunsDir,
    getDecisionsPath,
    listRunFiles,
    pickLatestRunId,
    readRunFile,
    loadRun,
    collectExecutions,
    emptyDecisionStore,
    normalizeDecisionStore,
    loadDecisions,
    saveDecisions,
    buildDecision,
    upsertDecision,
    clearDecision,
    clearNotBearRejections,
    loadCuratedBars,
    BEAR_VERDICTS_FILE_NAME,
    getBearVerdictsPath,
    normalizeBearVerdicts,
    loadBearVerdicts,
    saveBearVerdicts,
    buildBearIdentity,
    upsertBearVerdict,
    clearBearVerdict,
    createDeckCore,
    buildBarProposal,
    buildReviewDisplayContext,
    buildParserNamesByKey,
    buildImageUseCounts,
    buildDeck,
    formatRejectionsText
};

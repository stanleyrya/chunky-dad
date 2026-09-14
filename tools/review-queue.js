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
    const kind = input.kind === 'merge' || input.kind === 'bar' ? input.kind : 'new';
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

function clearDecision(store, key) {
    const normalized = normalizeDecisionStore(store);
    const before = normalized.decisions.length;
    normalized.decisions = normalized.decisions.filter((entry) => entry.key !== key);
    return { store: normalized, removed: before !== normalized.decisions.length };
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

// One saved run + the decision store → { runId, cards, decided, counts }.
// cards = proposals with no covering decision (past events dropped);
// decided = proposals a stored decision already covers (with that decision).
function buildDeck(runPayload, store, options = {}) {
    const payload = runPayload && typeof runPayload === 'object' ? runPayload : {};
    const decisions = normalizeDecisionStore(store).decisions;
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const SharedCore = loadSharedCore();
    const core = createDeckCore(payload, options);
    const runId = (payload.summary && payload.summary.runId) || options.runId || null;
    const cards = [];
    const decided = [];
    const counts = { pending: 0, decided: 0, approved: 0, rejected: 0, new: 0, merge: 0, bar: 0, pastSkipped: 0 };

    const file = (entry, decision) => {
        if (decision) {
            decided.push({ ...entry, decision });
            counts.decided++;
            if (decision.verdict === 'approve') counts.approved++;
            else counts.rejected++;
        } else {
            cards.push(entry);
            counts.pending++;
            counts[entry.kind]++;
        }
    };

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
        file(
            { id: `e${index}`, kind: proposal.kind, key: proposal.key, sourceIndex: index, proposal },
            SharedCore.findOwnerDecision(proposal, decisions)
        );
    });

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

    return {
        runId,
        savedAt: (payload.summary && payload.summary.timestamp) || null,
        environment: (payload.runContext && payload.runContext.environment) || null,
        cards,
        decided,
        counts
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
    emptyDecisionStore,
    normalizeDecisionStore,
    loadDecisions,
    saveDecisions,
    buildDecision,
    upsertDecision,
    clearDecision,
    loadCuratedBars,
    createDeckCore,
    buildBarProposal,
    buildDeck,
    formatRejectionsText
};

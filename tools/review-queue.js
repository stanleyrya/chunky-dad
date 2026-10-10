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

// Same default the launchd installer uses (tools/schedule-mac-run.sh): the
// data folder in iCloud Drive (chunky-dad-data — where the phone's
// ScriptableAdapter.resolveDataRoot looks through its file bookmark) once
// it holds the data (a storage/ subtree), else Scriptable's own folder.
function defaultSharedRoot(home = os.homedir(), fsLike = fs) {
    const moved = path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'chunky-dad-data');
    const legacy = path.join(home, 'Library', 'Mobile Documents', 'iCloud~dk~simonbs~Scriptable', 'Documents', 'chunky-dad-scraper');
    try {
        if (fsLike.statSync(path.join(moved, 'storage')).isDirectory()) return moved;
    } catch (_) { /* not moved yet */ }
    return legacy;
}
const DEFAULT_SHARED_ROOT = defaultSharedRoot();
const DECISIONS_FILE_NAME = 'owner-decisions.json';
const RUN_ID_PATTERN = /^\d{8}-\d{6}$/;
const RUN_CACHE_LIMIT = 4;

// Reject-sheet chips. Free text rides alongside; these make rejections
// groupable when the log is read back, and a field chip is what lets a
// "needs a fix" card come back by itself (FIX_TAG_FIELDS).
// The vocabulary is the owner's own (store of 2026-09-29: 96 rejections, 34
// with a typed note, not one chip used): his notes are about the link, the
// image, the title, the venue, a card that should have merged into a saved
// event, and a party that repeats. "wrong time" and "wrong date" matched
// nothing he wrote and are one chip now; "duplicate" and "fragment" are the
// sheet's own "Not an event" answer. Decisions stored with the older tags
// keep their meaning (FIX_TAG_FIELDS still names them).
const REVIEW_REASON_TAGS = [
    'wrong link', 'wrong image', 'wrong title', 'wrong venue',
    'should merge', 'recurring', 'wrong date or time', 'not bear', 'other'
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

// What a run covered: the parsers it was configured with, the ones that
// produced results, and how it was triggered. A hand-run single parser
// from the phone app ("app manual") is a look at that source, not the
// day's picture — it must not become the deck's default run.
function describeRunShape(payload) {
    const configured = payload && payload.config && Array.isArray(payload.config.parsers)
        ? payload.config.parsers.map((parser) => parser && parser.name).filter(Boolean)
        : [];
    const ran = Array.isArray(payload && payload.parserResults)
        ? payload.parserResults.map((result) => result && result.name).filter(Boolean)
        : [];
    const context = payload && payload.runContext && typeof payload.runContext === 'object' ? payload.runContext : {};
    // A run that could not read the saved calendars analysed every saved
    // event as new (SharedCore.describeCalendarReadHealth) — never the
    // deck's default, and labelled in the picker.
    const calendars = loadSharedCore().describeCalendarReadHealth(payload && payload.publishedCalendarSnapshots);
    return {
        calendarsUnread: calendars.degraded ? calendars.cities.length : 0,
        configured: configured.length,
        ran,
        trigger: context.trigger || null,
        type: context.type || null,
        environment: context.environment || null
    };
}

// A run that covered the sources: at least half of the configured parsers
// produced results (the daily run skips the automation-disabled ones and
// the template). Unknown shape never excludes a run.
function isCompleteRunShape(shape) {
    if (shape && shape.calendarsUnread > 0) return false;
    if (!shape || !Number.isFinite(shape.configured) || shape.configured === 0) return true;
    return shape.ran.length >= Math.ceil(shape.configured / 2);
}

function describeRunShapeLabel(shape) {
    if (shape && shape.calendarsUnread > 0) return `calendars unread (${shape.calendarsUnread}) — saved events show as new`;
    if (!shape || isCompleteRunShape(shape)) return '';
    if (shape.ran.length === 1) return `${shape.ran[0]} only`;
    if (shape.ran.length === 0) return 'no parser results';
    return `${shape.ran.length} of ${shape.configured} parsers`;
}

// listRunFiles plus, for each available file, its executions and shape —
// parsed once per path + mtime + size and cached, since every deck request
// and every pending-count asks.
const runInfoCache = new Map();
function describeRunFiles(sharedRoot) {
    const entries = [];
    for (const entry of listRunFiles(sharedRoot)) {
        if (!entry.available) {
            entries.push({ ...entry, executions: [], shape: null });
            continue;
        }
        const cached = runInfoCache.get(entry.path);
        let info;
        if (cached && cached.mtimeMs === entry.mtimeMs && cached.size === entry.size) {
            info = cached.info;
        } else {
            try {
                const payload = readRunFile(entry.path);
                info = {
                    executions: Array.isArray(payload.executions) ? payload.executions : [],
                    shape: describeRunShape(payload)
                };
            } catch (error) {
                info = { executions: [], shape: null };
            }
            runInfoCache.set(entry.path, { mtimeMs: entry.mtimeMs, size: entry.size, info });
        }
        entries.push({ ...entry, executions: info.executions, shape: info.shape });
    }
    return entries;
}

// The deck's default run: the newest FULL run; a newer single-parser run
// stays one click away in the picker (run 20260919-100554, The Bear
// Calendar run by hand, hid the whole day's deck behind 68 rows).
function pickLatestRunId(sharedRoot) {
    const available = describeRunFiles(sharedRoot).filter((entry) => entry.available);
    const complete = available.find((entry) => isCompleteRunShape(entry.shape));
    const chosen = complete || available[0];
    return chosen ? chosen.runId : null;
}

// The phone's written ledger (written-ledger.json, phone-owned): review
// key → { executedAt, action, title, runId } for every approved row the
// phone wrote. Empty map when absent.
function loadWrittenLedger(sharedRoot) {
    try {
        const parsed = JSON.parse(fs.readFileSync(path.join(sharedRoot, 'written-ledger.json'), 'utf8'));
        return parsed && parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {};
    } catch (error) {
        return {};
    }
}

// The calendars the phone has, as the phone lists them itself
// (calendar-snapshot/calendars.json, written with every snapshot pass),
// mapped to the city keys whose configured calendar name it holds. null
// when the phone has not written the list — then nothing is claimed
// missing. Never inferred from the per-city snapshot files: those exist
// only for cities a run touched.
// When the phone last wrote its calendar list (calendar-snapshot/
// calendars.json): an ISO instant, or '' when the file is absent.
function getPhoneCalendarListCapturedAt(sharedRoot) {
    try {
        const payload = JSON.parse(fs.readFileSync(path.join(sharedRoot, 'calendar-snapshot', 'calendars.json'), 'utf8'));
        return payload && typeof payload.capturedAt === 'string' ? payload.capturedAt : '';
    } catch (error) {
        return '';
    }
}

function listPhoneCalendars(sharedRoot, cities) {
    let payload;
    try {
        payload = JSON.parse(fs.readFileSync(path.join(sharedRoot, 'calendar-snapshot', 'calendars.json'), 'utf8'));
    } catch (error) {
        return null;
    }
    const titles = new Set((payload && Array.isArray(payload.calendars) ? payload.calendars : []).map((title) => String(title || '').trim()).filter(Boolean));
    if (titles.size === 0) return null;
    const keys = new Set();
    for (const [key, config] of Object.entries(cities && typeof cities === 'object' ? cities : {})) {
        if (config && typeof config.calendar === 'string' && titles.has(config.calendar.trim())) keys.add(key);
    }
    return keys;
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
function collectExecutions(sharedRoot) {
    const collected = [];
    for (const entry of describeRunFiles(sharedRoot)) {
        if (!entry.available) continue;
        for (const execution of entry.executions) {
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
    // The left swipe's answer (see SharedCore.getOwnerRejectionMode): 'fix'
    // waits for the card to change, 'never' is final. "Not bear" stays a tag —
    // older stores, the phone and the bear verdict all read it there.
    const rawMode = typeof reason.mode === 'string' ? reason.mode.trim().toLowerCase() : '';
    const mode = rawMode === 'fix' || rawMode === 'never' ? rawMode : '';
    if (tags.length === 0 && !text && !mode) return null;
    return mode ? { tags, text, mode } : { tags, text };
}

// One decision record from a swipe. Throws on a malformed request so the
// route can answer 400 instead of storing junk.
function buildDecision(input, options = {}) {
    if (!input || typeof input !== 'object') throw new Error('decision body must be an object');
    const key = typeof input.key === 'string' ? input.key.trim() : '';
    if (!key) throw new Error('decision needs a key');
    const verdict = input.verdict === 'approve' || input.verdict === 'reject' ? input.verdict : null;
    if (!verdict) throw new Error('verdict must be approve or reject');
    const kind = input.kind === 'merge' || input.kind === 'override' || input.kind === 'bar' || input.kind === 'series' ? input.kind : 'new';
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

// AN UNDO PUTS BACK WHAT THE SWIPE REPLACED. A card back for a second look
// already has a decision under its key — the approval of 2026-09-24, or a
// "needs a fix" note — and the new swipe overwrites it (one decision per
// key). Undoing that swipe by clearing the key threw the earlier decision
// away with it: a slip of the thumb and its undo deleted the note the card
// came back to answer, and with it the line in the fix queue. `previous` is
// the decision the server handed back when the swipe was stored
// (`replaced`); anything that is not a decision for this very key is
// refused and the caller falls back to a plain clear.
function restoreDecision(store, key, previous) {
    const normalized = normalizeDecisionStore(store);
    if (!isDecisionShaped(previous) || previous.key !== key) return { store: normalized, restored: false };
    return { store: upsertDecision(normalized, previous), restored: true };
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
    // The verdict this one overwrites, handed back so an undo can restore it.
    const replaced = index >= 0 ? list[index] : null;
    if (index >= 0) list[index] = entry;
    else list.push(entry);
    return { verdicts: list, entry, replaced };
}

// The undo of a verdict that overwrote an earlier one: the earlier entry
// goes back as it was stored (its own stamp, its own spelling). See
// restoreDecision. Refuses anything that is not a stored-verdict shape.
function restoreBearVerdict(verdicts, core, previous) {
    const valid = normalizeBearVerdicts([previous])[0];
    if (!valid || !core.getBearVerdictTitleKey(valid.title, [valid.venue])) return { verdicts: normalizeBearVerdicts(verdicts), restored: false };
    const result = upsertBearVerdict(verdicts, core, { title: valid.title, bar: valid.venue, address: valid.address, location: valid.location, city: valid.city }, valid.verdict);
    return { verdicts: result.verdicts.map((entry) => (entry === result.entry ? valid : entry)), restored: true };
}

// An undo clears the verdict on this title. When there is none and the card
// was covered through the party fold (the verdict sits on another spelling
// of the party — "🩲 JOCKSTRAP WEDNESDAY | 🎧 DJ …" for "Jockstrap
// Wednesday"), it clears the verdicts that cover it: otherwise the undo
// would say "undone" and the card would be decided again on the next load.
// `removedTitles` names what went.
function clearBearVerdict(verdicts, core, identity) {
    const id = buildBearIdentity(identity);
    const key = core.getBearVerdictTitleKey(id.title, [id.bar]);
    const list = normalizeBearVerdicts(verdicts);
    const place = { title: id.title, bar: id.bar, address: id.address, location: id.location, city: id.city };
    const exact = (existing) => Boolean(key) && core.getBearVerdictTitleKey(existing.title, [existing.venue]) === key
        && core.bearVerdictPlaceMatches(place, existing);
    let gone = list.filter(exact);
    if (gone.length === 0 && key) {
        const before = core.bearVerdicts;
        core.bearVerdicts = list;
        try {
            const partyKey = core.getBearVerdictPartyKey(id.title, [id.bar], core.getBearVerdictLearnedMarkers(place));
            gone = partyKey ? list.filter((existing) => core.bearVerdictPlaceMatches(place, existing)
                && core.getBearVerdictPartyKey(existing.title, [existing.venue], core.getBearVerdictLearnedMarkers(
                    { title: existing.title, bar: existing.venue, address: existing.address, location: existing.location, city: existing.city })) === partyKey) : [];
        } finally {
            core.bearVerdicts = before;
        }
    }
    const kept = list.filter((existing) => !gone.includes(existing));
    return { verdicts: kept, removed: gone.length > 0, removedTitles: gone.map((existing) => String(existing.title || '')) };
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
    }) || (typeof event.image === 'string' ? event.image : '')
        // Held back from the calendar (SharedCore.holdSharedPicturesBack):
        // still what the owner reviews.
        || (typeof event._sharedPicture === 'string' ? event._sharedPicture : '');
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
    // A verdict reached through the party fold (SharedCore
    // .findStoredBearVerdictMatch) was given on ANOTHER spelling of the
    // party — the card names it, so the owner sees whose verdict this is.
    const storedMatch = Array.isArray(core.bearVerdicts) && core.bearVerdicts.length > 0
        ? core.findStoredBearVerdictMatch(event)
        : null;
    const storedVerdict = storedMatch ? storedMatch.entry : null;
    // Big drift (shared-core assessMergeDrift, stamped at analysis): the
    // merge is withheld from every automatic write and the card carries
    // the facts — which identity fields move, the rung that matched the
    // two records, the hard facts that still agree, and the two pages.
    const drift = event._bigDriftWithheld && typeof event._bigDriftWithheld === 'object' ? event._bigDriftWithheld : null;
    const bigDrift = drift ? {
        reason: String(drift.reason || ''),
        rename: drift.rename === true,
        fields: (Array.isArray(drift.fields) ? drift.fields : [])
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => ({ field: String(entry.field || ''), from: String(entry.from || ''), to: String(entry.to || ''), ...(entry.kind ? { kind: String(entry.kind) } : {}), ...(Number.isFinite(entry.km) ? { km: entry.km } : {}) })),
        matchedBy: String(drift.matchedBy || ''),
        agree: (Array.isArray(drift.agree) ? drift.agree : []).map((line) => String(line)).filter(Boolean),
        sourcePageUrl: String(drift.sourcePageUrl || ''),
        calendarUrl: String(drift.calendarUrl || '')
    } : null;
    return {
        bigDrift,
        bearVerdict: storedVerdict ? storedVerdict.verdict : null,
        bearVerdictStampedAt: storedVerdict ? storedVerdict.stampedAt || null : null,
        bearVerdictOn: storedMatch && storedMatch.matchedBy === 'party' ? String(storedVerdict.title || '') : '',
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
        slotWins: Array.isArray(event._slotWins) ? event._slotWins.map((entry) => entry && entry.from ? `${entry.from} (${entry.fromCadence || 'unknown'})` : '').filter(Boolean).slice(0, 3) : [],
        slotTakeover: event._slotTakeover && typeof event._slotTakeover === 'object' ? { from: String(event._slotTakeover.from || ''), fromCadence: String(event._slotTakeover.fromCadence || '') } : null,
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
        notesOnlyAlso: Array.isArray(event._changes) && event._changes.includes('notes'),
        // The page stated no end: the end on this record is the one default
        // the pipeline writes so the calendar accepts the event
        // (SharedCore.applyDefaultEventEnd). The card says so instead of
        // printing it as the party's closing time.
        // Stamped on a create; carried in the notes (`endUnknown: true`)
        // for a saved record whose end is still the default.
        endDefaulted: event._endDateDefaulted === true || event.endUnknown === true || String(event.endUnknown || "").trim().toLowerCase() === "true"
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

// Which fields a "needs a fix" note's tags name — the deck's own vocabulary.
const FIX_TAG_FIELDS = {
    'wrong link': ['url', 'ticketUrl'],
    'wrong image': ['image'],
    'wrong title': ['title'],
    'wrong venue': ['bar', 'address', 'location'],
    'wrong date or time': ['startDate', 'endDate'],
    // The vocabulary before 2026-09-29, still read from stored decisions.
    'wrong time': ['startDate', 'endDate'],
    'wrong date': ['startDate', 'endDate'],
    'bad image': ['image']
};

// { tags, fields } when EVERY drifted field is one a tag of the note names
// (and at least one tag is a field tag); null otherwise. Fails closed on an
// untagged note, on a tag that names no field ("should merge",
// "recurring", "other", the older "duplicate"/"fragment"), and on any drift
// outside the named fields.
function driftCoveredByNoteTags(prior, proposal) {
    const tags = prior && prior.reason && Array.isArray(prior.reason.tags) ? prior.reason.tags : [];
    const named = new Set();
    for (const tag of tags) for (const field of FIX_TAG_FIELDS[String(tag).toLowerCase()] || []) named.add(field);
    if (named.size === 0) return null;
    if (tags.some((tag) => !FIX_TAG_FIELDS[String(tag).toLowerCase()])) return null;
    const drift = (Array.isArray(prior.drift) ? prior.drift : []).map((entry) => String(entry).replace(/\s*\(.*$/, ''));
    if (drift.length === 0) return null;
    if (!drift.every((field) => named.has(field))) return null;
    return { tags: tags.slice(), fields: drift };
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
// The fields a folded series compares night by night, in display order.
// Every night is written as ITS OWN calendar event with its own values —
// these are what may legitimately differ (a per-date ticket page, a new
// flyer, a one-off later start).
const NIGHT_COMPARE_FIELDS = [
    { key: 'time', label: 'time' },
    { key: 'title', label: 'title' },
    { key: 'bar', label: 'venue' },
    { key: 'address', label: 'address' },
    { key: 'url', label: 'link' },
    { key: 'ticketUrl', label: 'ticket link' },
    { key: 'image', label: 'image' },
    { key: 'cover', label: 'cover' },
    { key: 'description', label: 'description' }
];
function formatNightClock(proposal) {
    const core = loadSharedCore();
    const clock = (value) => {
        const ms = core.toEpochMillis(value);
        if (ms === null) return '';
        try {
            return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', ...(proposal.timezone ? { timeZone: proposal.timezone } : {}) }).format(new Date(ms));
        } catch (_) {
            return new Date(ms).toISOString().slice(11, 16);
        }
    };
    const start = clock(proposal.startDate);
    const end = clock(proposal.endDate);
    return end ? `${start} – ${end}` : start;
}
function nightCompareValues(proposal) {
    const p = proposal || {};
    const text = (value) => String(value === null || value === undefined ? '' : value).trim();
    return {
        time: formatNightClock(p), title: text(p.title), bar: text(p.bar), address: text(p.address), url: text(p.url),
        ticketUrl: text(p.ticketUrl), image: text(p.image), cover: text(p.cover), description: text(p.description)
    };
}
// What rhythm a party's nights show, read off their local days
// ('YYYY-MM-DD'): "every Wednesday" when three or more nights sit 7 days
// apart, "every other Wednesday" at 14; null otherwise (the nights are
// listed). Self-contained on purpose — the deck page runs this same
// function on the nights still on a card.
function describeSeriesCadence(days) {
    var list = (Array.isArray(days) ? days : []).filter(function (day) { return /^\d{4}-\d{2}-\d{2}$/.test(String(day)); });
    list = list.filter(function (day, index) { return list.indexOf(day) === index; }).sort();
    if (list.length < 3) return null;
    var noon = function (day) { return Date.parse(day + 'T12:00:00Z'); };
    var step = Math.round((noon(list[1]) - noon(list[0])) / 86400000);
    for (var i = 2; i < list.length; i++) {
        if (Math.round((noon(list[i]) - noon(list[i - 1])) / 86400000) !== step) return null;
    }
    if (step !== 7 && step !== 14) return null;
    var weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(noon(list[0])).getUTCDay()];
    return { text: (step === 7 ? 'every ' : 'every other ') + weekday, stepDays: step, weekday: weekday, from: list[0], to: list[list.length - 1], nights: list.length };
}

function stampSeries(cards, SharedCore) {
    const groups = new Map();
    for (const card of cards) {
        if (card.kind !== 'new' && card.kind !== 'merge') continue;
        let series = SharedCore.getOwnerReviewSeriesKey(card.key);
        if (!series) continue;
        // Merges fold only when they say the same thing about every night.
        if (card.kind === 'merge') {
            const signature = SharedCore.getOwnerReviewMergeSignature(card.proposal);
            if (!signature) continue;
            series = `${series}|merge|${signature}`;
        }
        if (!groups.has(series)) groups.set(series, []);
        groups.get(series).push(card);
    }
    for (const [series, members] of groups) {
        if (members.length < 2) continue;
        const nights = members.map((card) => ({ key: card.key, day: String(card.key).split('|')[3] || '', label: formatNightLabel(card.proposal), values: nightCompareValues(card.proposal) }));
        const differsOnFullText = NIGHT_COMPARE_FIELDS.filter((field) => new Set(nights.map((night) => night.values[field.key])).size > 1).map((field) => field.key);
        // Compared in full, shipped short: every card of the series carries
        // the whole table, so a long description rides as its opening.
        for (const night of nights) {
            if (night.values.description.length > 160) night.values.description = `${night.values.description.slice(0, 160).trim()}…`;
        }
        // What actually differs between the nights (the date aside): one
        // swipe decides them all, so the owner sees at a glance whether the
        // nights are copies or each carries its own link / flyer / time.
        const differs = differsOnFullText;
        const cadence = describeSeriesCadence(nights.map((night) => night.day));
        for (const card of members) card.series = { key: series, size: members.length, nights, differs, cadence };
    }
}

// THE SAME CHANGE ON DIFFERENT EVENTS is one card too (owner, 2026-09-29:
// six BeefDip parties each proposed the link change beefdip.com/tags/ →
// beefdip.com on a card of its own). Updates from one source whose change
// table is the same — the same fields, from the same saved value to the
// same new one — fold into one item: one swipe decides them all, each under
// its own key. Same shape as a folded party (card.series), marked
// type 'change'; "one at a time" unfolds it and "fold back" folds it again.
// A card already folded with its party's other nights stays with them, and
// an update that changes a date is never folded here: a start or an end is
// a fact about one event.
function getSameChangeSignature(proposal) {
    const SharedCore = loadSharedCore();
    const changes = proposal && proposal.changes && typeof proposal.changes === 'object' ? proposal.changes : {};
    let fields = Object.keys(changes).sort();
    // An event that becomes a WHOLE DAY (a real all-day event, or one whose
    // time is not known) says the same thing on every night it applies to
    // — "no time listed, saved as a day" — although each night's
    // end instant differs. Its end-date row is the conversion, so it folds
    // under that name; a start that moves is still one event's own fact.
    const becomesAllDay = proposal && Boolean(proposal.wholeDay) && fields.includes('endDate') && !fields.includes('startDate');
    if (becomesAllDay) fields = fields.filter((field) => field !== 'endDate');
    if ((fields.length === 0 && !becomesAllDay) || fields.includes('startDate') || fields.includes('endDate')) return '';
    const value = (raw) => SharedCore.normalizeOwnerReviewValue(raw);
    if (becomesAllDay) {
        return [`wholeDay=→${proposal.wholeDay}`].concat(fields.map((field) => `${field}=${value(changes[field] && changes[field].from)}→${value(changes[field] && changes[field].to)}`)).join(';');
    }
    return fields.map((field) => `${field}=${value(changes[field] && changes[field].from)}→${value(changes[field] && changes[field].to)}`).join(';');
}
function describeChangeRows(proposal) {
    const changes = proposal && proposal.changes && typeof proposal.changes === 'object' ? proposal.changes : {};
    const text = (value) => String(value === null || value === undefined ? '' : value).trim();
    const fields = Object.keys(changes).sort();
    // The all-day conversion is one row in words, not one member's end
    // instant (see getSameChangeSignature).
    const becomesAllDay = proposal && Boolean(proposal.wholeDay) && fields.includes('endDate') && !fields.includes('startDate');
    const rows = fields.filter((field) => !(becomesAllDay && field === 'endDate'))
        .map((field) => ({ field, from: text(changes[field] && changes[field].from), to: text(changes[field] && changes[field].to) }));
    if (becomesAllDay) {
        rows.unshift({ field: 'allDay', from: 'a time the page never stated',
            to: proposal.wholeDay === 'time-unknown' ? 'time not listed (saved as all-day)' : 'all day' });
    }
    return rows;
}
function stampSameChange(cards) {
    const groups = new Map();
    for (const card of cards) {
        if (card.kind !== 'merge' || card.series) continue;
        const signature = getSameChangeSignature(card.proposal);
        if (!signature) continue;
        const group = `change|${String(card.proposal && card.proposal.source || '')}|${signature}`;
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(card);
    }
    for (const [group, members] of groups) {
        if (members.length < 2) continue;
        const nights = members.map((card) => {
            const title = String(card.proposal && card.proposal.title || '').trim();
            const day = formatNightLabel(card.proposal);
            return { key: card.key, day: String(card.key).split('|')[3] || '', label: [title, day].filter(Boolean).join(' · '), values: nightCompareValues(card.proposal) };
        });
        for (const night of nights) {
            if (night.values.description.length > 160) night.values.description = `${night.values.description.slice(0, 160).trim()}…`;
        }
        const change = describeChangeRows(members[0].proposal);
        for (const card of members) card.series = { key: group, type: 'change', size: members.length, nights, differs: [], cadence: null, change };
    }
}

// Cities with cards on this deck whose calendar the phone does not have
// (the phone marks those rows MISSING CALENDAR and cannot write them):
// [{ city, calendarName, events }], most events first. Empty without a
// phone calendar list.
function findMissingPhoneCalendars(payload, entries, phoneCalendars) {
    if (!(phoneCalendars instanceof Set)) return [];
    const cities = (payload && payload.config && payload.config.cities) || {};
    const counts = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry || (entry.kind !== 'new' && entry.kind !== 'merge' && entry.kind !== 'override' && entry.kind !== 'series')) continue;
        const city = String((entry.proposal && entry.proposal.city) || '').trim();
        if (!city || phoneCalendars.has(city)) continue;
        const calendarName = cities[city] && typeof cities[city].calendar === 'string' ? cities[city].calendar : '';
        if (!calendarName) continue;
        const current = counts.get(city) || { city, calendarName, events: 0 };
        current.events++;
        counts.set(city, current);
    }
    return [...counts.values()].sort((a, b) => b.events - a.events || a.city.localeCompare(b.city));
}

// One saved run + the decision store → { runId, cards, decided, counts }.
// cards = proposals with no covering decision (past events dropped);
// decided = proposals a stored decision already covers (with that decision).
// The browser's address for a picture from the shared inbox
// (https://inbox.chunky.dad/file/<name>, a host that does not exist): the
// review server serves the file itself at /inbox/file/<name>. Any other
// address is returned as it is.
function reviewImageUrl(url) {
    const SharedCore = loadSharedCore();
    const parsed = SharedCore.parseSharedInboxUrl(url);
    return parsed && parsed.kind === 'file' ? `/inbox/file/${encodeURIComponent(parsed.name)}` : String(url || '');
}

// The bytes behind /inbox/file/<name>: the file as it sits in <shared
// root>/inbox/ or, once a run has consumed it, inbox/done/. Null when there
// is no such file. The name is one path segment (parseSharedInboxUrl's
// rule), so nothing outside the inbox is ever read.
function readSharedInboxFile(sharedRoot, name, fsLike = fs) {
    const clean = String(name || '');
    if (!clean || clean === '.' || clean === '..' || /[\\/]/.test(clean)) return null;
    for (const dir of [path.join(sharedRoot, 'inbox'), path.join(sharedRoot, 'inbox', 'done')]) {
        const file = path.join(dir, clean);
        try {
            if (fsLike.statSync(file).isFile()) return { file, buffer: fsLike.readFileSync(file) };
        } catch (_) { /* not here */ }
    }
    return null;
}

function isSharedInboxAddress(url) {
    return loadSharedCore().isSharedInboxUrl(url);
}

// PUBLISHING AN INBOX PICTURE (owner, 2026-10-02: "we save images to the
// website and locally host after processing" → "auto publish PR then").
// When a card whose picture lives in the inbox is approved, the picture
// is re-encoded to a web size (longest side PUBLISHED_PICTURE_MAX_SIDE,
// JPEG — a phone HEIC is 1.5 MB and the repo's history is already mostly
// images) and committed as img/inbox/<date>-<slug>-<hash>.jpg on the
// rolling branch PICTURES_BRANCH, with one pull request open for it
// (openPicturePullRequest). Git plumbing only: the site checkout's
// working tree and HEAD are never touched. The record in <shared
// root>/inbox/published.json starts PENDING (branch, pr, path); when the
// owner merges, the next deck build sees the PR merged (resolvePending
// Pictures) and fills in the website address — the one thing both the
// Mac run and the phone read (adapter.loadPublishedPictures →
// SharedCore.holdSharedPicturesBack), so an event is written with the
// picture only once the picture is on the website. Idempotent per
// address; a failed step records nothing and is tried again at the next
// deck build (publishApprovedPictures); the approval stands either way.
const PUBLISHED_PICTURES_FILE = path.join('inbox', 'published.json');
const PUBLISHED_PICTURE_MAX_SIDE = 1280;
const SITE_ORIGIN = 'https://chunky.dad';
const PICTURES_BRANCH = 'inbox-pictures';

function getPublishedPicturesPath(sharedRoot) {
    return path.join(sharedRoot, PUBLISHED_PICTURES_FILE);
}

function loadPublishedPictures(sharedRoot, fsLike = fs) {
    try {
        const parsed = JSON.parse(fsLike.readFileSync(getPublishedPicturesPath(sharedRoot), 'utf8'));
        return parsed && typeof parsed.pictures === 'object' && parsed.pictures ? { version: 1, pictures: parsed.pictures } : { version: 1, pictures: {} };
    } catch (_) {
        return { version: 1, pictures: {} };
    }
}

function savePublishedPictures(sharedRoot, store, fsLike = fs) {
    const file = getPublishedPicturesPath(sharedRoot);
    fsLike.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fsLike.writeFileSync(temp, JSON.stringify(store, null, 2));
    fsLike.renameSync(temp, file);
    return store;
}

function pictureSlug(text) {
    return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'event';
}

// Default tool runner — tests pass their own.
function runCommand(file, args, options = {}) {
    const { execFileSync } = require('child_process');
    return String(execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, ...options }));
}

// Re-encode `source` as a web-sized JPEG at `target` (sips, macOS).
function reencodePictureForWeb(source, target, run = runCommand) {
    run('/usr/bin/sips', ['-Z', String(PUBLISHED_PICTURE_MAX_SIDE), '-s', 'format', 'jpeg', '-s', 'formatOptions', '78', source, '--out', target]);
    return target;
}

// The open pull request for the pictures branch, { number, url } or null.
function findOpenPicturePullRequest(repoRoot, run = runCommand) {
    const text = run('gh', ['pr', 'list', '--head', PICTURES_BRANCH, '--state', 'open', '--json', 'number,url', '--limit', '1'], { cwd: repoRoot });
    let list = [];
    try { list = JSON.parse(text || '[]'); } catch (_) { list = []; }
    return Array.isArray(list) && list[0] && list[0].number ? { number: Number(list[0].number), url: String(list[0].url || '') } : null;
}

// Put ONE file on the pictures branch and make sure its PR exists.
// Plumbing: the blob is written into the object store, a temporary index
// is read from the branch tip (or main, when the branch has no open PR —
// a merged branch starts over), the path is added, a tree and a commit
// are written, and the commit is pushed to the branch. Returns
// { commit, branch, pr: { number, url } }.
function putPictureOnBranch(repoRoot, filePath, relativePath, message, run = runCommand) {
    const git = (args, options = {}) => run('git', ['-C', repoRoot, ...args], options).trim();
    git(['fetch', '--quiet', 'origin', 'main']);
    let openPr = findOpenPicturePullRequest(repoRoot, run);
    let base = 'refs/remotes/origin/main';
    if (openPr) {
        try {
            git(['fetch', '--quiet', 'origin', PICTURES_BRANCH]);
            base = `refs/remotes/origin/${PICTURES_BRANCH}`;
        } catch (_) {
            openPr = null;
        }
    }
    const blob = git(['hash-object', '-w', '--', filePath]);
    const indexFile = path.join(require('os').tmpdir(), `chunky-pictures-index-${process.pid}-${Date.now()}`);
    const env = { ...process.env, GIT_INDEX_FILE: indexFile };
    let tree;
    try {
        git(['read-tree', base], { env });
        git(['update-index', '--add', '--cacheinfo', `100644,${blob},${relativePath}`], { env });
        tree = git(['write-tree'], { env });
    } finally {
        try { fs.unlinkSync(indexFile); } catch (_) {}
    }
    const commit = git(['commit-tree', tree, '-p', base, '-m', message]);
    git(['push', '--quiet', 'origin', `${commit}:refs/heads/${PICTURES_BRANCH}`]);
    const pr = openPr || openPicturePullRequest(repoRoot, run);
    return { commit, branch: PICTURES_BRANCH, pr };
}

function openPicturePullRequest(repoRoot, run = runCommand) {
    const body = [
        'Pictures dropped into the shared inbox and approved on the review deck (tools/review-queue.js publishSharedPicture).',
        'Each is a web-sized JPEG under img/inbox/. Once merged, the next deck build records the website address and the phone writes the event with it.',
        '',
        '🤖 Generated with [Claude Code](https://claude.com/claude-code)'
    ].join('\n');
    const url = run('gh', ['pr', 'create', '--head', PICTURES_BRANCH, '--base', 'main', '--title', '🖼️ Inbox pictures', '--body', body], { cwd: repoRoot }).trim();
    const number = Number((url.match(/\/pull\/(\d+)/) || [])[1]) || null;
    return { number, url };
}

// Publish one inbox picture for an approved card: the record from
// published.json — pending ({ pr, branch, path, url: null }) right after
// the push, complete ({ url }) once resolvePendingPictures saw the PR
// merged. Throws when the file is gone, the re-encode fails or the push
// fails; nothing is recorded then.
function publishSharedPicture(options) {
    const { sharedRoot, repoRoot, address, title, startDate } = options;
    const fsLike = options.fs || fs;
    const run = options.run || runCommand;
    const SharedCore = loadSharedCore();
    const parsed = SharedCore.parseSharedInboxUrl(address);
    if (!parsed || parsed.kind !== 'file') throw new Error(`not an inbox picture address: ${address}`);
    const store = loadPublishedPictures(sharedRoot, fsLike);
    if (store.pictures[address] && (store.pictures[address].url || store.pictures[address].pr)) return store.pictures[address];
    const found = readSharedInboxFile(sharedRoot, parsed.name, fsLike);
    if (!found) throw new Error(`inbox picture is gone: ${parsed.name}`);
    const hash = require('crypto').createHash('sha1').update(found.buffer).digest('hex').slice(0, 8);
    const day = Number.isFinite(Date.parse(startDate)) ? new Date(startDate).toISOString().slice(0, 10) : 'undated';
    const fileName = `${day}-${pictureSlug(title)}-${hash}.jpg`;
    const relativePath = path.posix.join('img', 'inbox', fileName);
    const tmpDir = fsLike.mkdtempSync(path.join(require('os').tmpdir(), 'chunky-picture-'));
    const target = path.join(tmpDir, fileName);
    let put;
    try {
        reencodePictureForWeb(found.file, target, run);
        put = putPictureOnBranch(repoRoot, target, relativePath, `🖼️ Inbox picture: ${String(title || parsed.name).slice(0, 72)}`, run);
    } finally {
        try { fsLike.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
    const record = { url: null, path: relativePath, title: String(title || ''), from: parsed.name, branch: put.branch, commit: put.commit, pr: put.pr, pushedAt: new Date().toISOString(), publishedAt: null };
    store.pictures[address] = record;
    savePublishedPictures(sharedRoot, store, fsLike);
    return record;
}

// Pending records whose PR has been merged get their website address;
// one whose PR was closed unmerged is dropped (published again next time
// as a new PR). Returns the number of records changed.
function resolvePendingPictures(sharedRoot, options) {
    const fsLike = options.fs || fs;
    const run = options.run || runCommand;
    const store = loadPublishedPictures(sharedRoot, fsLike);
    const states = new Map();
    let changed = 0;
    for (const [address, record] of Object.entries(store.pictures)) {
        if (!record || record.url || !record.pr || !record.pr.number) continue;
        const number = record.pr.number;
        if (!states.has(number)) {
            try {
                const text = run('gh', ['pr', 'view', String(number), '--json', 'state,mergedAt'], { cwd: options.repoRoot });
                states.set(number, JSON.parse(text));
            } catch (error) {
                states.set(number, null);
            }
        }
        const state = states.get(number);
        if (!state) continue;
        if (state.state === 'MERGED') {
            record.url = `${SITE_ORIGIN}/${record.path}`;
            record.publishedAt = state.mergedAt || new Date().toISOString();
            changed++;
            console.log(`Review: inbox picture ${record.path} is on the website (PR #${number} merged)`);
        } else if (state.state === 'CLOSED') {
            delete store.pictures[address];
            changed++;
            console.log(`Review: inbox picture ${record.path} dropped — PR #${number} was closed unmerged; it will be offered again`);
        }
    }
    if (changed > 0) savePublishedPictures(sharedRoot, store, fsLike);
    return changed;
}

// The record is a cache of "inbox address → website address": a
// published entry is dropped PUBLISHED_PICTURE_KEEP_DAYS after it went
// up (the event is long past; a re-shared picture is simply published
// again), a pending one PENDING_PICTURE_KEEP_DAYS after its push (a PR
// nobody merged). Returns the number dropped.
const PUBLISHED_PICTURE_KEEP_DAYS = 120;
const PENDING_PICTURE_KEEP_DAYS = 60;
function prunePublishedPictures(sharedRoot, options = {}) {
    const fsLike = options.fs || fs;
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const store = loadPublishedPictures(sharedRoot, fsLike);
    let dropped = 0;
    for (const [address, record] of Object.entries(store.pictures)) {
        if (!record || typeof record !== 'object') { delete store.pictures[address]; dropped++; continue; }
        const stamp = Date.parse(record.url ? record.publishedAt : record.pushedAt);
        const keepMs = (record.url ? PUBLISHED_PICTURE_KEEP_DAYS : PENDING_PICTURE_KEEP_DAYS) * 86400000;
        if (Number.isFinite(stamp) && now - stamp > keepMs) { delete store.pictures[address]; dropped++; }
    }
    if (dropped > 0) {
        savePublishedPictures(sharedRoot, store, fsLike);
        console.log(`Review: dropped ${dropped} old inbox picture record(s)`);
    }
    return dropped;
}

// Every approved decision whose snapshot picture is an inbox address and
// has no record yet: publish it now; and every pending record: ask after
// its PR. Called at deck build, so a step that failed at approve time is
// retried; each address is tried at most once per PUBLISH_RETRY_MS per
// process. Returns { published, failed, resolved }.
const PUBLISH_RETRY_MS = 10 * 60 * 1000;
const publishAttempts = new Map();
function publishApprovedPictures(store, options) {
    const { sharedRoot, repoRoot } = options;
    const SharedCore = loadSharedCore();
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const attempts = options.attempts || publishAttempts;
    const result = { published: [], failed: [], resolved: 0 };
    prunePublishedPictures(sharedRoot, options);
    const pending = Object.values(loadPublishedPictures(sharedRoot, options.fs || fs).pictures).some((record) => record && !record.url && record.pr);
    if (pending && now - (attempts.get('resolve') || 0) >= PUBLISH_RETRY_MS) {
        attempts.set('resolve', now);
        try { result.resolved = resolvePendingPictures(sharedRoot, options); } catch (error) { console.log(`Review: could not ask after the pictures PR: ${error.message}`); }
    }
    const published = loadPublishedPictures(sharedRoot, options.fs || fs).pictures;
    for (const decision of normalizeDecisionStore(store).decisions) {
        if (!decision || decision.verdict !== 'approve' || !decision.snapshot) continue;
        const address = String(decision.snapshot.image || '');
        if (!SharedCore.isSharedInboxUrl(address) || published[address]) continue;
        if (now - (attempts.get(address) || 0) < PUBLISH_RETRY_MS) continue;
        attempts.set(address, now);
        try {
            const record = publishSharedPicture({ sharedRoot, repoRoot, address, title: decision.snapshot.title, startDate: decision.snapshot.startDate, fs: options.fs, run: options.run });
            result.published.push({ key: decision.key, ...record });
            console.log(`Review: inbox picture for ${decision.key} pushed → PR ${record.pr && record.pr.url ? record.pr.url : '?'}`);
        } catch (error) {
            result.failed.push({ key: decision.key, address, error: error.message });
            console.log(`Review: inbox picture for ${decision.key} NOT published (${error.message}) — tried again at the next deck build`);
        }
    }
    return result;
}

// PHONE A FRIEND (owner, 2026-10-02: "for the events I'm not sure of, I
// can flag them for a friend of mine… a website-hosted version that uses
// url parameters for saving state… the friends send me the link back").
// A card the owner flags with a friend's name is an ASK, kept here in
// <shared root>/friend-advice.json (Mac-only writer) and out of the stack.
// "Share with <friend>" builds ONE link to the static page
// chunky.dad/phone-a-friend/ (phone-a-friend/index.html, no backend): the cards ride in
// the hash as #j1.<base64url JSON>, trimmed to what the friend needs
// (title, when, where, link, a public picture, the question). That link
// is an EXPORT, recorded with its card keys so the reply — the page's
// own link back, #r1.<base64url JSON> with one answer per card index —
// resolves to keys again. A reply pasted into the deck becomes ADVICE
// rows on the cards (friend, yes/no/not sure, note); the card returns to
// the stack with the advice on it. The swipe stays the owner's.
const FRIEND_ADVICE_FILE_NAME = 'friend-advice.json';
const ADVICE_PAGE_DEFAULT_BASE = 'https://chunky.dad/phone-a-friend/';
const ADVICE_LINK_CARD_CAP = 25;

function getFriendAdvicePath(sharedRoot) {
    return path.join(sharedRoot, FRIEND_ADVICE_FILE_NAME);
}

// No phone numbers, anywhere (owner, 2026-10-04: "too risky"): the deck
// copies the link and opens Messages with it typed; the owner picks whom
// it goes to.
function emptyFriendAdviceStore() {
    return { version: 1, asks: [], exports: [], advice: [] };
}

function normalizeFriendAdviceStore(store) {
    const base = emptyFriendAdviceStore();
    if (!store || typeof store !== 'object') return base;
    for (const key of ['asks', 'exports', 'advice']) base[key] = Array.isArray(store[key]) ? store[key].filter((entry) => entry && typeof entry === 'object') : [];
    return base;
}

function loadFriendAdvice(file, fsLike = fs) {
    try {
        return normalizeFriendAdviceStore(JSON.parse(fsLike.readFileSync(file, 'utf8')));
    } catch (_) {
        return emptyFriendAdviceStore();
    }
}

function saveFriendAdvice(file, store, fsLike = fs) {
    const clean = normalizeFriendAdviceStore(store);
    fsLike.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fsLike.writeFileSync(temp, JSON.stringify(clean, null, 2));
    fsLike.renameSync(temp, file);
    return clean;
}

function cleanFriendName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

// Flag a card for a friend (one ask per card + friend; asking again
// refreshes the question). `snapshot` is the proposal as the deck shows it.
function recordFriendAsk(store, ask, now = Date.now()) {
    const clean = normalizeFriendAdviceStore(store);
    const key = typeof ask.key === 'string' ? ask.key.trim() : '';
    const friend = cleanFriendName(ask.friend);
    if (!key) throw new Error('an ask needs a key');
    if (!friend) throw new Error('an ask needs a friend');
    const question = typeof ask.question === 'string' ? ask.question.trim().slice(0, 300) : '';
    const existing = clean.asks.find((entry) => entry.key === key && entry.friend === friend);
    if (existing) {
        existing.question = question;
        existing.askedAt = new Date(now).toISOString();
        if (ask.snapshot && typeof ask.snapshot === 'object') existing.snapshot = ask.snapshot;
    } else {
        clean.asks.push({ key, kind: typeof ask.kind === 'string' ? ask.kind : 'new', friend, question, askedAt: new Date(now).toISOString(), snapshot: ask.snapshot && typeof ask.snapshot === 'object' ? ask.snapshot : null });
    }
    return clean;
}

// Take a card back from a friend (or from every friend when none is named).
function clearFriendAsk(store, key, friend = '') {
    const clean = normalizeFriendAdviceStore(store);
    const name = cleanFriendName(friend);
    const before = clean.asks.length;
    clean.asks = clean.asks.filter((entry) => !(entry.key === key && (!name || entry.friend === name)));
    return { store: clean, removed: before - clean.asks.length };
}

function base64UrlEncode(text) {
    return Buffer.from(String(text), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text) {
    const clean = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(clean + '==='.slice((clean.length + 3) % 4), 'base64').toString('utf8');
}

// What the friend's page needs of a card — nothing the page cannot show.
// A picture is included only when it is public (an inbox picture that
// has not reached the website yet is left out).
function friendCardPayload(index, ask) {
    const SharedCore = loadSharedCore();
    const p = ask.snapshot && typeof ask.snapshot === 'object' ? ask.snapshot : {};
    const image = typeof p.image === 'string' && /^https?:\/\//i.test(p.image) && !SharedCore.isSharedInboxUrl(p.image) ? p.image : '';
    const card = { i: index, t: String(p.title || p.name || '').slice(0, 120) };
    if (p.startDate) card.d = p.startDate;
    if (p.endDate) card.e = p.endDate;
    if (p.timezone) card.z = p.timezone;
    if (p.wholeDay) card.w = 1;
    if (p.bar) card.b = String(p.bar).slice(0, 80);
    if (p.address) card.a = String(p.address).slice(0, 120);
    if (p.city) card.y = String(p.city).slice(0, 40);
    if (p.url || p.website) card.u = String(p.url || p.website).slice(0, 300);
    if (image) card.p = image.slice(0, 300);
    if (p.source) card.s = String(p.source).slice(0, 60);
    if (ask.question) card.n = ask.question;
    return card;
}

// One link for everything a friend has been asked and has not answered,
// recorded as an export so the reply's card indexes resolve to keys.
// The link (#j2.) carries, per card, the deck's OWN card HTML
// (options.htmlByKey — serve-results renderFriendCardHtml), deflated: the
// friend sees exactly the owner's card. ~750 characters a card; cards are
// added until the link would pass ADVICE_LINK_MAX_CHARS, the rest wait for
// the next link. Returns { store, exportId, url, count, left }.
const ADVICE_LINK_MAX_CHARS = 24000;
function buildFriendLink(store, options) {
    const clean = normalizeFriendAdviceStore(store);
    const friend = cleanFriendName(options.friend);
    if (!friend) throw new Error('a link needs a friend');
    const base = String(options.base || ADVICE_PAGE_DEFAULT_BASE);
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const htmlByKey = options.htmlByKey instanceof Map ? options.htmlByKey : new Map();
    const answered = new Set(clean.advice.filter((entry) => entry.friend === friend).map((entry) => entry.key));
    const open = clean.asks.filter((entry) => entry.friend === friend && !answered.has(entry.key));
    if (open.length === 0) return { store: clean, exportId: '', url: '', count: 0, left: 0 };
    const exportId = `${new Date(now).toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 7)}`;
    const zlib = require('zlib');
    const head = { e: exportId, f: friend };
    if (options.to) head.to = String(options.to);
    if (options.question) head.q = String(options.question).slice(0, 300);
    // Where the reply goes: the owner's own deck (one tap opens it there).
    if (typeof options.back === 'string' && /^https?:\/\//i.test(options.back)) head.back = options.back;
    const encode = (cards) => `${base}#j2.${zlib.deflateRawSync(Buffer.from(JSON.stringify({ ...head, c: cards }), 'utf8'), { level: 9 }).toString('base64url')}`;
    const cards = [];
    const keys = [];
    let url = '';
    for (const ask of open.slice(0, ADVICE_LINK_CARD_CAP)) {
        const p = ask.snapshot && typeof ask.snapshot === 'object' ? ask.snapshot : {};
        const card = {
            k: ask.kind || 'new',
            t: String(p.title || p.name || '').slice(0, 120),
            p: { title: String(p.title || p.name || '').slice(0, 120), startDate: p.startDate || null, timezone: p.timezone || null, wholeDay: p.wholeDay || '', bar: p.bar || '', city: p.city || '' },
            h: htmlByKey.get(ask.key) || `<h2>${String(p.title || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}</h2>`
        };
        if (ask.question) {
            // The question tops the card, inside its padding.
            const line = `<div class="line"><b>❓ ${ask.question.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}</b></div>`;
            card.h = card.h.startsWith('<div class="card-body">') ? card.h.replace('<div class="card-body">', `<div class="card-body">${line}`) : line + card.h;
        }
        const next = encode(cards.concat([card]));
        if (cards.length > 0 && next.length > ADVICE_LINK_MAX_CHARS) break;
        cards.push(card);
        keys.push(ask.key);
        url = next;
    }
    clean.exports.push({ id: exportId, friend, at: new Date(now).toISOString(), keys });
    // Old exports go once their asks are long gone.
    clean.exports = clean.exports.filter((entry) => now - Date.parse(entry.at) < 120 * 86400000);
    return { store: clean, exportId, url, count: cards.length, left: open.length - cards.length };
}

// A reply as the friend's page makes it: a link (or just its hash, or the
// bare code). #r2.<base64url JSON { e, f, a: [[index, approve|reject,
// mode, tags, note], …] }> is the deck's own answer (mode: fix, not-bear,
// never, or '' ); #r1. (the first page, [[index, y|n|u, note, title]]) is
// still read. Null when it is not one.
function parseFriendReply(text) {
    const raw = String(text || '').trim();
    const match = raw.match(/(?:^|[#=])(r1|r2)\.([A-Za-z0-9_-]+)\s*$/);
    if (!match) return null;
    let parsed;
    try { parsed = JSON.parse(base64UrlDecode(match[2])); } catch (_) { return null; }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.a)) return null;
    const note = (value) => (typeof value === 'string' ? value.trim().slice(0, 300) : '');
    let answers;
    if (match[1] === 'r2') {
        const word = (verdict, mode) => verdict === 'approve' ? 'yes' : mode === 'not-bear' ? 'no' : mode === 'fix' ? 'fix' : mode === 'never' ? 'not-event' : 'off';
        answers = parsed.a
            .filter((row) => Array.isArray(row) && Number.isInteger(row[0]) && ['approve', 'reject'].includes(row[1]))
            .map((row) => ({ index: row[0], answer: word(row[1], row[2]), tags: Array.isArray(row[3]) ? row[3].filter((t) => typeof t === 'string').slice(0, 8) : [], note: note(row[4]), title: '' }));
    } else {
        answers = parsed.a
            .filter((row) => Array.isArray(row) && Number.isInteger(row[0]) && ['y', 'n', 'u'].includes(row[1]))
            .map((row) => ({ index: row[0], answer: row[1] === 'y' ? 'yes' : row[1] === 'n' ? 'no' : 'unsure', tags: [], note: note(row[2]), title: typeof row[3] === 'string' ? row[3] : '' }));
    }
    return { exportId: typeof parsed.e === 'string' ? parsed.e : '', friend: cleanFriendName(parsed.f), answers };
}

// A reply becomes advice rows (one per answered card), keyed through the
// export it answers. Returns { store, recorded: [{ key, friend, answer,
// note }], unknown: n } — unknown counts answers whose export is gone.
function recordFriendReply(store, reply, now = Date.now()) {
    const clean = normalizeFriendAdviceStore(store);
    const result = { store: clean, recorded: [], unknown: 0 };
    if (!reply || !Array.isArray(reply.answers)) return result;
    const exported = clean.exports.find((entry) => entry.id === reply.exportId);
    if (!exported) { result.unknown = reply.answers.length; return result; }
    const friend = reply.friend || exported.friend;
    for (const answer of reply.answers) {
        const key = exported.keys[answer.index];
        if (!key) { result.unknown++; continue; }
        clean.advice = clean.advice.filter((entry) => !(entry.key === key && entry.friend === friend));
        const row = { key, friend, answer: answer.answer, tags: Array.isArray(answer.tags) ? answer.tags : [], note: answer.note, receivedAt: new Date(now).toISOString(), exportId: exported.id };
        clean.advice.push(row);
        result.recorded.push(row);
    }
    return result;
}

// What the deck shows per card: who was asked (and has not answered) and
// what came back. Keyed by card key.
function friendAdviceByKey(store) {
    const clean = normalizeFriendAdviceStore(store);
    const byKey = new Map();
    const get = (key) => { if (!byKey.has(key)) byKey.set(key, { asked: [], advice: [] }); return byKey.get(key); };
    for (const row of clean.advice) get(row.key).advice.push({ friend: row.friend, answer: row.answer, tags: Array.isArray(row.tags) ? row.tags : [], note: row.note, receivedAt: row.receivedAt });
    for (const ask of clean.asks) {
        const entry = get(ask.key);
        if (entry.advice.some((row) => row.friend === ask.friend)) continue;
        entry.asked.push({ friend: ask.friend, askedAt: ask.askedAt, question: ask.question });
    }
    return byKey;
}

// Friends the owner has asked before, most recent first — the deck's
// suggestions. Never a hand-kept list.
function knownFriends(store) {
    const clean = normalizeFriendAdviceStore(store);
    const seen = new Map();
    for (const entry of clean.asks.concat(clean.advice)) {
        const at = Date.parse(entry.askedAt || entry.receivedAt) || 0;
        if (!seen.has(entry.friend) || seen.get(entry.friend) < at) seen.set(entry.friend, at);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

function buildDeck(runPayload, store, options = {}) {
    const payload = runPayload && typeof runPayload === 'object' ? runPayload : {};
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const SharedCore = loadSharedCore();
    const core = createDeckCore(payload, options);
    // Old keys re-keyed from their snapshots (SharedCore.rekeyOwnerDecisions)
    // — a title rule that changed must not strand a decision.
    const decisions = core.rekeyOwnerDecisions(normalizeDecisionStore(store).decisions);
    core.bearVerdicts = Array.isArray(options.bearVerdicts) ? options.bearVerdicts : [];
    const runId = (payload.summary && payload.summary.runId) || options.runId || null;
    const cards = [];
    const decided = [];
    const counts = { pending: 0, decided: 0, approved: 0, rejected: 0, waiting: 0, new: 0, merge: 0, override: 0, series: 0, bar: 0, dropped: 0, droppedDecided: 0, pastSkipped: 0 };

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
    const ledger = options.writtenLedger && typeof options.writtenLedger === 'object' ? options.writtenLedger : {};
    const executedMark = (entry, decision) => {
        // The phone's ledger: written since this approval was made, on any
        // run (a newer approval than the write is a re-approval, pending).
        const written = ledger[entry.key];
        if (written && typeof written === 'object' && written.executedAt
            && (!decision || String(written.executedAt) >= String(decision.stampedAt || ''))) {
            return { at: written.executedAt, as: written.action || 'created' };
        }
        const event = analyzed[entry.sourceIndex];
        if (!event || !event._ownerReviewApproved) return null;
        // A series the phone only reported (seriesWrites: report) or could
        // not write is not executed — the approval still waits.
        if (event._seriesWrite === true && event._seriesWriteOutcome !== 'created') return null;
        return { at: lastExecutedAt || null, as: event._action === 'merge' ? 'updated' : 'created' };
    };
    const file = (entry, decision) => {
        if (decision) {
            const isEventKind = entry.kind === 'new' || entry.kind === 'merge' || entry.kind === 'override' || entry.kind === 'series';
            const executed = isEventKind ? executedMark(entry, decision) : null;
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
            const rejectionMode = SharedCore.getOwnerRejectionMode(decision);
            decided.push({ ...entry, decision, executed, pendingExecute: via ? isEventKind && decision.verdict === 'approve' && !executed : pendingExecute, ...(via ? { via } : {}), ...(rejectionMode ? { rejectionMode } : {}) });
            if (rejectionMode === 'fix') counts.waiting++;
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
    // One series, one card: a run can list the same stated series on
    // several rows (one per page it appeared on); the first row carries
    // the card, the rest are the same decision.
    const seriesKeysSeen = new Set();
    analyzed.forEach((event, index) => {
        if (!core.isOwnerReviewCandidate(event)) return;
        const proposal = core.buildOwnerReviewProposal(event);
        if (!proposal) return;
        if (proposal.kind === 'series' && seriesKeysSeen.has(proposal.key)) return;
        const endMs = SharedCore.toEpochMillis(proposal.endDate);
        const startMs = SharedCore.toEpochMillis(proposal.startDate);
        // A series is as current as its next night, not its first.
        const nextNightMs = proposal.kind === 'series' && Array.isArray(proposal.seriesNights)
            ? proposal.seriesNights.map((night) => SharedCore.toEpochMillis(night)).filter((ms) => ms !== null && ms >= now)[0]
            : undefined;
        const lastMs = nextNightMs !== undefined ? nextNightMs : (endMs !== null ? endMs : startMs);
        if (lastMs !== null && lastMs < now) {
            counts.pastSkipped++;
            return;
        }
        // The first CURRENT row of a series carries its card.
        if (proposal.kind === 'series') seriesKeysSeen.add(proposal.key);
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
        // THE FIX YOU ASKED FOR ARRIVED. A card sent back "needs a fix" with
        // tags naming the wrong fields, whose ONLY changes since are those
        // fields, is what the owner asked to see — approved, with the note
        // as its audit trail, instead of a second swipe (audit 2026-09-22:
        // every fix cost two swipes). Untagged notes, "other", and any
        // change outside the named fields still come back for a look.
        const fixed = prior && prior.verdict === 'reject' && !prior.night && (proposal.kind === 'new')
            && SharedCore.getOwnerRejectionMode({ verdict: 'reject', reason: prior.reason }) === 'fix'
            ? driftCoveredByNoteTags(prior, proposal) : null;
        if (fixed) {
            file({ id: `e${index}`, kind: proposal.kind, key: proposal.key, sourceIndex: index, proposal,
                display: buildReviewDisplayContext(event, payload, core, extras), prior, autoApproved: fixed },
                { key: proposal.key, kind: proposal.kind, verdict: 'approve', stampedAt: new Date(now).toISOString(), reason: null, snapshot: proposal, autoApproved: fixed });
            return;
        }
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
    stampSameChange(cards);

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
            image: String(event.image || event._sharedPicture || ''),
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
        // "It IS bear, but the card is wrong" is a bear verdict PLUS a
        // needs-a-fix note — and the note has to sit where the next run's
        // kept card will look for it: under the event's own review key, with
        // the card as it stands today as its snapshot.
        const fixTarget = core.buildOwnerReviewProposal(event);
        if (fixTarget) fixTarget.kind = 'new';
        const card = { id: `d${index}`, kind: 'dropped', key, sourceIndex: index, proposal, display, fixTarget: fixTarget || null };
        droppedByKey.set(key, card);
    });
    for (const card of droppedByKey.values()) {
        if (card.display.bearVerdict) {
            // The note left with the verdict (under the event's own key)
            // rides along, so the decided row shows it and an undo clears both.
            const note = card.fixTarget ? decisions.find((entry) => entry.key === card.fixTarget.key && entry.verdict === 'reject' && ['fix', 'never'].includes(SharedCore.getOwnerRejectionMode(entry))) : null;
            decided.push({ ...card, noteKey: note ? note.key : '', rejectionMode: note ? SharedCore.getOwnerRejectionMode(note) : '', decision: { key: card.key, kind: 'dropped', verdict: card.display.bearVerdict === 'bear' ? 'approve' : 'reject', stampedAt: card.display.bearVerdictStampedAt, reason: note ? note.reason : null, bearVerdict: card.display.bearVerdict } });
            counts.decided++;
            counts.droppedDecided++;
        } else {
            cards.push(card);
            counts.dropped++;
        }
    }

    // "Needs a fix" rejections this run no longer proposes at all: the fix
    // changed the card's identity (its title, place or day — so it is back on
    // the stack as a new card), or the event went away. Named so a note is
    // never silently orphaned.
    // A note left on a not-bear card waits under the event's own key: the
    // event is in this run (dropped), so its note is not orphaned.
    const presentKeys = new Set(cards.concat(decided).flatMap((entry) => (entry.fixTarget && entry.fixTarget.key ? [entry.key, entry.fixTarget.key] : [entry.key])));
    const presentSeries = new Set(cards.concat(decided).map((entry) => SharedCore.getOwnerReviewSeriesKey(entry.key)).filter(Boolean));
    // A FIX OFTEN RENAMES THE CARD. The review key carries the title, so
    // "The Bear Party" sent back for a better name returns as "Lodge NY: The
    // Bear Party" — a brand-new card — while the note that asked for it sat
    // here as "waiting", unattached (2026-09-21: 20 of 20 waiting notes were
    // exactly this). A note whose place and day are on this deck under
    // another title has been ANSWERED: it rides on that card as its `prior`
    // ("you sent this back: …"), and is not listed as waiting. A note for a
    // night already past has nothing left to wait for either.
    const placeDayOf = (key) => { const parts = String(key || '').split('|'); return parts[0] === 'event' && parts.length >= 4 ? `${parts[2]}|${parts[3]}` : ''; };
    const presentByPlaceDay = new Map();
    for (const entry of cards.concat(decided)) {
        const placeDay = placeDayOf(entry.key);
        if (placeDay && !presentByPlaceDay.has(placeDay)) presentByPlaceDay.set(placeDay, entry);
    }
    // …and a note can be answered with NO card left to show it on: the fixed
    // event was approved and written, so this run only proposes a no-op
    // merge for it (2026-09-21: 16 "The Bear Party" notes waiting on nights
    // already saved as "Lodge NY: The Bear Party"). Same local day, same
    // city, a name that still reads as the same party → answered.
    const runEventsByDay = new Map();
    for (const event of Array.isArray(payload.analyzedEvents) ? payload.analyzedEvents : []) {
        const day = String(core.getOwnerReviewKey(event) || '').split('|')[3] || '';
        if (!day) continue;
        if (!runEventsByDay.has(day)) runEventsByDay.set(day, []);
        runEventsByDay.get(day).push(event);
    }
    const answeredByRunEvent = (decision) => {
        const snapshot = decision.snapshot && typeof decision.snapshot === 'object' ? decision.snapshot : {};
        const title = String(snapshot.title || '').trim();
        const day = String(decision.key || '').split('|')[3] || '';
        if (!title || !day) return false;
        return (runEventsByDay.get(day) || []).some((event) => String(event.title || '').trim() !== title
            && (!snapshot.city || !event.city || snapshot.city === event.city)
            && core.areTitlesSimilar(title, event.title));
    };
    // A note that has been ANSWERED — its night is past, or the fix is
    // already saved with no card left — has nothing to wait for; it is
    // listed here so the server can drop it from the store, and the fix
    // queue (/review/rejections) stops naming done work. A note riding on a
    // returned card as `prior` stays until that card is decided.
    const answeredNoteKeys = [];
    const unanswered = [];
    for (const decision of decisions) {
        if (SharedCore.getOwnerRejectionMode(decision) !== 'fix' || presentKeys.has(decision.key)) continue;
        const startMs = SharedCore.toEpochMillis(decision.snapshot && decision.snapshot.startDate);
        if (startMs !== null && startMs < now) { answeredNoteKeys.push(decision.key); continue; }
        const answer = presentByPlaceDay.get(placeDayOf(decision.key));
        if (answer) {
            if (!answer.prior && !answer.decision) {
                const wasTitle = (decision.snapshot && decision.snapshot.title) || '';
                answer.prior = { verdict: 'reject', stampedAt: decision.stampedAt || null, reason: decision.reason || null,
                    drift: wasTitle && wasTitle !== answer.proposal.title ? [`title (was “${wasTitle}”)`] : ['title'], key: decision.key };
            }
            continue;
        }
        if (answeredByRunEvent(decision)) { answeredNoteKeys.push(decision.key); continue; }
        unanswered.push(decision);
    }
    const waitingGone = unanswered
        .map((decision) => ({
            key: decision.key,
            kind: decision.kind || 'new',
            title: (decision.snapshot && (decision.snapshot.title || decision.snapshot.name)) || '',
            startDate: (decision.snapshot && decision.snapshot.startDate) || null,
            bar: (decision.snapshot && (decision.snapshot.bar || decision.snapshot.city)) || '',
            reason: decision.reason || null,
            stampedAt: decision.stampedAt || null,
            // Another night of the same party is on this deck: the party
            // lives on, this night is simply not in the run (past, or gone).
            seriesPresent: presentSeries.has(SharedCore.getOwnerReviewSeriesKey(decision.key))
        }));

    // Friends: who was asked about a card and what came back; a card
    // asked and unanswered waits in the Friends section, not the stack.
    const adviceByKey = friendAdviceByKey(options.friendAdvice || null);
    // Inbox pictures: where the card's picture is on its way to the website.
    const publishedPictures = options.publishedPictures && typeof options.publishedPictures === 'object' ? options.publishedPictures : {};
    for (const entry of cards.concat(decided)) {
        const friends = adviceByKey.get(entry.key);
        if (friends) { entry.asked = friends.asked; entry.advice = friends.advice; }
        const address = entry.proposal && SharedCore.isSharedInboxUrl(entry.proposal.image) ? entry.proposal.image : '';
        if (address) {
            const record = publishedPictures[address] || null;
            entry.picture = record && record.url ? { state: 'published', url: record.url }
                : record && record.pr ? { state: 'pr', pr: record.pr }
                : { state: 'review-only' };
        }
    }
    const lastExecution = executions.length > 0 ? executions[executions.length - 1] : null;
    // A picture that lives in the owner's inbox is served by this server.
    // The proposal keeps the inbox address (it is the snapshot the
    // approval records and publishSharedPicture publishes); the deck shows
    // the picture through imageView.
    for (const entry of cards.concat(decided)) {
        if (entry.display && SharedCore.isSharedInboxUrl(entry.display.image)) entry.display.image = reviewImageUrl(entry.display.image);
        if (entry.proposal && SharedCore.isSharedInboxUrl(entry.proposal.image)) entry.proposal = { ...entry.proposal, imageView: reviewImageUrl(entry.proposal.image) };
    }
    return {
        runId,
        waitingGone,
        answeredNoteKeys,
        // Approvals the deck made itself (a fix arrived exactly as asked) —
        // not yet in the store; the server writes them at deck build so the
        // phone's execute sees them like any swipe.
        autoApprovals: decided.filter((entry) => entry.autoApproved).map((entry) => ({ ...entry.decision, autoApproved: entry.autoApproved })),
        savedAt: (payload.summary && payload.summary.timestamp) || null,
        environment: (payload.runContext && payload.runContext.environment) || null,
        runShape: describeRunShape(payload),
        missingCalendars: findMissingPhoneCalendars(payload, cards.concat(decided), options.phoneCalendars),
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
// One note swiped onto a folded series is stored once per night (each
// night has its own key) — and is still ONE note: thirteen "Jockstrap
// Wednesday" lines with the same words read as thirteen problems
// (2026-09-27). Rejections of NEW nights of one party (same series key)
// that carry the same title, source and reason print as one line naming
// the nights. Updates fold only when they are the same update: one source,
// the same change table (getSameChangeSignature) and the same reason — the
// note swiped onto a folded same-change card.
// ---------------------------------------------------------------------------
// Source audit helpers shared with tools/source-audit.js: the ledger assessed
// the way the dashboard does, a cached page as readable text, the events the
// run extracted from one host.
// ---------------------------------------------------------------------------
const DEEP_CHECK_PAGE_TEXT_CAP = 6000;

// The source ledger assessed the way the dashboard does (with the owner's
// decisions joined for the rejections signal). null when there is no ledger.
function loadSourceHealth(sharedRoot, options = {}) {
    const fsLike = options.fs || fs;
    const ledgerPath = path.join(sharedRoot, 'metrics', 'sources.ndjson');
    let text = '';
    try { text = fsLike.readFileSync(ledgerPath, 'utf8'); } catch (_) { return null; }
    const MetricsSections = require(path.join(repoRoot, 'scripts', 'metrics-sections'));
    const records = MetricsSections.parseSourceLedger(text);
    if (!records.length) return null;
    const decisions = options.decisions || loadDecisions(getDecisionsPath(sharedRoot));
    let audit = options.audit || null;
    if (!audit) {
        try { audit = JSON.parse(fsLike.readFileSync(path.join(sharedRoot, 'source-audit.json'), 'utf8')); } catch (_) { audit = null; }
    }
    return { records, health: MetricsSections.assessSourceHealth(records, { now: options.now || new Date(), decisions, audit }) };
}

// Cached HTML → readable text: no scripts, styles or markup, block tags as
// line breaks, entities decoded, whitespace folded, capped.
function readableTextFromHtml(html, cap = DEEP_CHECK_PAGE_TEXT_CAP) {
    let text = String(html || '');
    text = text.replace(/<!--[\s\S]*?-->/g, ' ');
    text = text.replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ');
    text = text.replace(/<head\b[\s\S]*?<\/head>/gi, ' ');
    text = text.replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|nav|main|aside|ul|ol|table|form|td|th|dd|dt|blockquote|figcaption|summary|option)\s*>/gi, '\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<[^>]+>/g, ' ');
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: String.fromCharCode(39), nbsp: ' ', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c' };
    text = text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
        if (code[0] === '#') {
            const value = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
            return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : ' ';
        }
        return Object.prototype.hasOwnProperty.call(entities, code.toLowerCase()) ? entities[code.toLowerCase()] : match;
    });
    text = text.replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
    const full = text.length;
    if (cap > 0 && text.length > cap) text = `${text.slice(0, cap)}\u2026`;
    return { text, chars: full, truncated: cap > 0 && full > cap };
}

function normalizeListingUrl(url) {
    return String(url || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
}

// The host's listing page from the scraper's page cache
// (<sharedRoot>/storage/pages/<host>/*.json, each {url, fetchedAt, html}).
// The file whose url is one of the parser's configured urls wins, else the
// one with the fewest path segments (the landing/listing page), newest first.
// Files are sniffed by their first bytes so a 400 KB cache is not parsed
// just to learn its url.
function findCachedListingPage(sharedRoot, host, preferredUrls = [], fsLike = fs) {
    const hostKey = String(host || '').toLowerCase().replace(/^www\./, '');
    if (!hostKey) return null;
    const dirs = [hostKey, `www.${hostKey}`].map((name) => path.join(sharedRoot, 'storage', 'pages', name));
    const wanted = new Set((Array.isArray(preferredUrls) ? preferredUrls : []).map(normalizeListingUrl).filter(Boolean));
    const candidates = [];
    dirs.forEach((dir) => {
        let names = [];
        try { names = fsLike.readdirSync(dir); } catch (_) { return; }
        names.filter((name) => name.endsWith('.json') && !name.startsWith('.')).forEach((name) => {
            const file = path.join(dir, name);
            let head = '';
            try {
                const fd = fsLike.openSync(file, 'r');
                const buffer = Buffer.alloc(600);
                const read = fsLike.readSync(fd, buffer, 0, 600, 0);
                fsLike.closeSync(fd);
                head = buffer.slice(0, read).toString('utf8');
            } catch (_) { return; }
            const urlMatch = /"url"\s*:\s*"([^"]+)"/.exec(head);
            const fetchedMatch = /"fetchedAt"\s*:\s*"([^"]+)"/.exec(head);
            if (!urlMatch) return;
            const url = urlMatch[1];
            const normalized = normalizeListingUrl(url);
            const pathPart = normalized.slice(normalized.indexOf('/') >= 0 ? normalized.indexOf('/') : normalized.length);
            candidates.push({ file, url, fetchedAt: fetchedMatch ? fetchedMatch[1] : '', preferred: wanted.has(normalized), depth: pathPart.split('/').filter(Boolean).length, pathLength: pathPart.length });
        });
    });
    if (!candidates.length) return null;
    candidates.sort((a, b) => (b.preferred ? 1 : 0) - (a.preferred ? 1 : 0) || a.depth - b.depth || String(b.fetchedAt).localeCompare(String(a.fetchedAt)) || a.pathLength - b.pathLength);
    const best = candidates[0];
    try {
        const parsed = JSON.parse(fsLike.readFileSync(best.file, 'utf8'));
        return { url: parsed.url || best.url, fetchedAt: parsed.fetchedAt || best.fetchedAt, html: typeof parsed.html === 'string' ? parsed.html : '', statusCode: parsed.statusCode || null, file: best.file, preferred: best.preferred };
    } catch (_) {
        return null;
    }
}

// Events the latest run extracted from one host (attributed the way the
// ledger attributes them: the event's own page host when it is one of the
// parser's hosts, else the parser's first host), as plain rows.
// Everything the run extracted from one host — the events it kept AND the
// ones the bear gate dropped (the page lists those too) — attributed exactly
// as the ledger attributes its counts (SharedCore.sourceLedgerParserHosts /
// sourceLedgerEventHost / sourceLedgerDroppedHost), as plain rows.
function eventsForHost(payload, host) {
    const SharedCore = loadSharedCore();
    const hostKey = String(host || '').toLowerCase().replace(/^www\./, '');
    const rows = [];
    const allHomeHosts = new Set();
    const describe = (event, extra) => {
        const day = SharedCore.sourceLedgerLocalDay(event.startDate, event.timezone);
        let time = '';
        if (!(event.timeUnknown === true || event.allDay === true) && event.startDate) {
            try {
                time = new Intl.DateTimeFormat('en-US', Object.assign({ hour: 'numeric', minute: '2-digit' }, event.timezone ? { timeZone: event.timezone } : {})).format(new Date(event.startDate));
            } catch (_) { time = ''; }
        }
        return Object.assign({
            title: String(event.title || ''),
            day: day || '',
            time,
            place: String(event.bar || event.venue || event.city || ''),
            url: String(event.website || event.url || event.ticketUrl || ''),
            bear: event.isBearEvent === true,
            dropped: false,
            reason: '',
            source: String(event.source || ''),
            parser: ''
        }, extra);
    };
    const parsers = payload && Array.isArray(payload.parserResults) ? payload.parserResults : [];
    parsers.forEach((parser) => {
        if (!parser || typeof parser !== 'object') return;
        const hosts = SharedCore.sourceLedgerParserHosts(parser);
        hosts.homeHosts.forEach((home) => allHomeHosts.add(home));
        hosts.events.forEach((event) => {
            if (!event || typeof event !== 'object') return;
            if (SharedCore.sourceLedgerEventHost(event, hosts) !== hostKey) return;
            rows.push(describe(event, { parser: hosts.name }));
        });
    });
    const dropped = payload && Array.isArray(payload.bearDroppedEvents) ? payload.bearDroppedEvents : [];
    dropped.forEach((drop) => {
        if (!drop || typeof drop !== 'object') return;
        if (SharedCore.sourceLedgerDroppedHost(drop, allHomeHosts) !== hostKey) return;
        const event = drop.event && typeof drop.event === 'object' ? drop.event : { title: drop.title, startDate: drop.startDate, bar: drop.venue };
        rows.push(describe(event, { title: String(event.title || drop.title || ''), bear: false, dropped: true, reason: String(drop.reason || '').replace(/\s+/g, ' ').trim().slice(0, 120) }));
    });
    rows.sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title));
    return rows;
}

function formatRejectionsText(store) {
    const lines = [];
    const SharedCore = loadSharedCore();
    const rejections = normalizeDecisionStore(store).decisions.filter((decision) => decision.verdict === 'reject');
    const groupOf = (decision) => {
        const snap = decision.snapshot || {};
        const reason = decision.reason || {};
        const why = [reason.mode || '', (reason.tags || []).slice().sort(), reason.text || ''];
        if ((decision.kind || 'new') === 'merge') {
            const signature = getSameChangeSignature(snap);
            return signature ? JSON.stringify(['change', snap.source || '', signature].concat(why)) : '';
        }
        const series = (decision.kind || 'new') === 'new' && (snap.kind || 'new') === 'new' ? SharedCore.getOwnerReviewSeriesKey(decision.key) : '';
        if (!series) return '';
        return JSON.stringify([series, snap.title || '', snap.source || '', snap.bar || snap.city || ''].concat(why));
    };
    const groups = new Map();
    for (const decision of rejections) {
        const group = groupOf(decision);
        if (!group) continue;
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(decision);
    }
    for (const decision of rejections) {
        const mode = SharedCore.getOwnerRejectionMode(decision);
        const snap = decision.snapshot || {};
        const members = groups.get(groupOf(decision)) || [];
        if (members.length > 1 && members[0] !== decision) continue;
        let when = String(snap.startDate || '').slice(0, 10);
        const sameChange = members.length > 1 && (decision.kind || 'new') === 'merge';
        if (sameChange) {
            const others = members.slice(1).map((member) => `${(member.snapshot || {}).title || ''} ${String((member.snapshot || {}).startDate || '').slice(0, 10)}`.trim());
            when = `${when} + ${others.length} more with the same change (${others.join(', ')})`;
        } else if (members.length > 1) {
            const days = members.map((member) => String(member.key).split('|')[3] || '').filter(Boolean).sort();
            const cadence = describeSeriesCadence(days);
            when = `${members.length} nights (${cadence ? `${cadence.text}, ${cadence.from} … ${cadence.to}` : days.join(', ')})`;
        }
        const label = snap.kind === 'bar'
            ? `BAR ${snap.name || ''} (${snap.city || ''})`
            : `${(snap.kind || decision.kind || 'new').toUpperCase()} ${snap.title || ''} — ${when} @ ${snap.bar || snap.city || ''} [${snap.source || ''}]`;
        const tags = decision.reason && decision.reason.tags && decision.reason.tags.length > 0
            ? ` {${decision.reason.tags.join(', ')}}`
            : '';
        const text = decision.reason && decision.reason.text ? ` — ${decision.reason.text}` : '';
        const changes = snap.changes && typeof snap.changes === 'object'
            ? Object.keys(snap.changes).map((field) => `${field}: ${snap.changes[field].from || '∅'} → ${snap.changes[field].to || '∅'}`).join('; ')
            : '';
        const modeLabel = mode === 'fix' ? 'NEEDS FIX' : mode === 'never' ? 'NOT AN EVENT' : mode === 'not-bear' ? 'NOT BEAR' : 'REJECTED';
        lines.push({ rank: mode === 'fix' ? 0 : mode === '' ? 1 : 2, line: `- [${modeLabel}] ${label}${tags}${text}${changes ? ` (${changes})` : ''}` });
    }
    // What needs fixing first; final answers last.
    return lines.sort((a, b) => a.rank - b.rank).map((entry) => entry.line).join('\n');
}

module.exports = {
    NIGHT_COMPARE_FIELDS,
    FRIEND_ADVICE_FILE_NAME,
    ADVICE_PAGE_DEFAULT_BASE,
    ADVICE_LINK_CARD_CAP,
    ADVICE_LINK_MAX_CHARS,
    getFriendAdvicePath,
    emptyFriendAdviceStore,
    loadFriendAdvice,
    saveFriendAdvice,
    recordFriendAsk,
    clearFriendAsk,
    buildFriendLink,
    parseFriendReply,
    recordFriendReply,
    friendAdviceByKey,
    knownFriends,
    reviewImageUrl,
    isSharedInboxAddress,
    readSharedInboxFile,
    PUBLISHED_PICTURE_MAX_SIDE,
    getPublishedPicturesPath,
    loadPublishedPictures,
    savePublishedPictures,
    publishSharedPicture,
    publishApprovedPictures,
    resolvePendingPictures,
    prunePublishedPictures,
    PICTURES_BRANCH,
    DEFAULT_SHARED_ROOT,
    defaultSharedRoot,
    DECISIONS_FILE_NAME,
    REVIEW_REASON_TAGS,
    RUN_ID_PATTERN,
    resolveSharedRoot,
    getRunsDir,
    getDecisionsPath,
    listRunFiles,
    pickLatestRunId,
    describeRunShape,
    isCompleteRunShape,
    describeRunShapeLabel,
    describeRunFiles,
    listPhoneCalendars,
    getPhoneCalendarListCapturedAt,
    loadWrittenLedger,
    findMissingPhoneCalendars,
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
    restoreDecision,
    clearNotBearRejections,
    loadCuratedBars,
    BEAR_VERDICTS_FILE_NAME,
    getBearVerdictsPath,
    normalizeBearVerdicts,
    loadBearVerdicts,
    saveBearVerdicts,
    buildBearIdentity,
    upsertBearVerdict,
    restoreBearVerdict,
    clearBearVerdict,
    createDeckCore,
    buildBarProposal,
    buildReviewDisplayContext,
    buildParserNamesByKey,
    buildImageUseCounts,
    buildDeck,
    describeSeriesCadence,
    getSameChangeSignature,
    describeChangeRows,
    driftCoveredByNoteTags,
    stampSameChange,
    formatRejectionsText,
    loadSourceHealth,
    readableTextFromHtml,
    findCachedListingPage,
    eventsForHost
};

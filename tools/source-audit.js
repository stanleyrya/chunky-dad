#!/usr/bin/env node
// ============================================================================
// SOURCE AUDIT — the automated look every website gets (Mac only, never the phone)
// ============================================================================
// Runs at the end of every Mac run (tools/run-once.js, after the run's shared
// files are written). Answers, without the owner, the three questions the
// deep-check card used to ask a human:
//
//   1. "Still on the site?" — for every open lost series of the audited hosts
//      AND every loss confirmed in this run (all hosts): the host's listing
//      page is fetched through the web adapter (politeness, robots, the
//      browser route and the page cache all apply — one page per host) and
//      its readable text is searched for the series title. Verdicts:
//      still-listed (found → OUR miss), site-removed (not found), unknown
//      (page unreachable). The verdict is written into the loss state
//      (source-upcoming.json) so the next ledger line carries lost[].still,
//      and into source-audit.json for the dashboard today.
//   2. Missing / fake events — for the hosts in the day's rotation (cap 3,
//      troubled/lost first, every host roughly every two weeks) the local AI
//      reads the page text beside the events the run extracted from that host
//      and reports, as JSON, events on the page we did not extract, extracted
//      items that are not real events, and a one-line note. The model's
//      answer is a REPORT, never a write: it lands in source-audit.json and
//      the deck's Source audit page; nothing in the calendar moves.
//   3. The findings are the fix queue: GET /review/source-audit.json.
//
// Opt-out: CHUNKY_SOURCE_AUDIT=0. Budget: CHUNKY_SOURCE_AUDIT_BUDGET_MS
// (default 240000) — the audit stops starting new hosts past it and never
// throws into the run. CHUNKY_SOURCE_AUDIT_HOSTS=a.com,b.com forces the
// rotation (smokes).
//
// Store (<sharedRoot>/source-audit.json, Mac-only writer, atomic):
//   { version: 1, updatedAt,
//     hosts: { host: { date, run_id, verdict, badges: [chip], page: { url, fetchedAt, chars } | null,
//                      still: [{ title, verdict, checked_at, line }], missing: [{ title, date }],
//                      fake: [{ title, reason }], wrong: [{ title, issue }], note, ai: 'ok' | 'skipped' | 'failed' | 'no-page' } },
//     runs: [{ run_id, date, audited: [host], losses: [host], ms }] (newest last, capped) }
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const SOURCE_AUDIT_FILE_NAME = 'source-audit.json';
const SOURCE_AUDIT_PASS = 'source-audit';
const DEFAULT_CAP = 3;
const DEFAULT_BUDGET_MS = 240000;
const PAGE_TEXT_CAP = 6000;
const MAX_RUNS_KEPT = 60;
const STILL_VERDICTS = ['still-listed', 'site-removed', 'unknown'];

function loadSharedCore() {
    return require(path.join(repoRoot, 'scripts', 'shared-core')).SharedCore;
}

function getSourceAuditPath(sharedRoot) {
    return path.join(sharedRoot, SOURCE_AUDIT_FILE_NAME);
}

function emptySourceAuditStore() {
    return { version: 1, updatedAt: '', hosts: {}, runs: [] };
}

function normalizeSourceAuditStore(parsed) {
    const store = emptySourceAuditStore();
    if (!parsed || typeof parsed !== 'object') return store;
    store.updatedAt = String(parsed.updatedAt || '');
    const hosts = parsed.hosts && typeof parsed.hosts === 'object' ? parsed.hosts : {};
    Object.keys(hosts).forEach((host) => {
        const entry = hosts[host];
        if (!entry || typeof entry !== 'object') return;
        store.hosts[host] = {
            date: String(entry.date || ''),
            run_id: String(entry.run_id || ''),
            verdict: String(entry.verdict || ''),
            badges: Array.isArray(entry.badges) ? entry.badges.map(String) : [],
            page: entry.page && typeof entry.page === 'object' ? { url: String(entry.page.url || ''), fetchedAt: String(entry.page.fetchedAt || ''), chars: Number(entry.page.chars) || 0 } : null,
            still: Array.isArray(entry.still) ? entry.still.filter((item) => item && item.title && STILL_VERDICTS.includes(item.verdict)).map((item) => ({ title: String(item.title), verdict: String(item.verdict), checked_at: String(item.checked_at || ''), line: String(item.line || '') })) : [],
            missing: Array.isArray(entry.missing) ? entry.missing.filter((item) => item && item.title).map((item) => ({ title: String(item.title), date: String(item.date || '') })) : [],
            fake: Array.isArray(entry.fake) ? entry.fake.filter((item) => item && item.title).map((item) => ({ title: String(item.title), kind: String(item.kind || ''), reason: String(item.reason || '') })) : [],
            wrong: Array.isArray(entry.wrong) ? entry.wrong.filter((item) => item && item.title).map((item) => ({ title: String(item.title), issue: String(item.issue || '') })) : [],
            note: String(entry.note || ''),
            ai: String(entry.ai || 'skipped')
        };
    });
    if (Array.isArray(parsed.runs)) {
        store.runs = parsed.runs.filter((run) => run && typeof run === 'object' && run.run_id)
            .map((run) => ({ run_id: String(run.run_id), date: String(run.date || ''), audited: Array.isArray(run.audited) ? run.audited.map(String) : [], losses: Array.isArray(run.losses) ? run.losses.map(String) : [], ms: Number(run.ms) || 0 }))
            .slice(-MAX_RUNS_KEPT);
    }
    return store;
}

function loadSourceAudit(file, fsLike = fs) {
    try {
        if (!fsLike.existsSync(file)) return emptySourceAuditStore();
        return normalizeSourceAuditStore(JSON.parse(fsLike.readFileSync(file, 'utf8')));
    } catch (error) {
        console.warn(`source-audit: store unreadable (${error.message}) — treating as empty`);
        return emptySourceAuditStore();
    }
}

function saveSourceAudit(file, store, fsLike = fs) {
    const normalized = normalizeSourceAuditStore(store);
    normalized.updatedAt = new Date().toISOString();
    fsLike.mkdirSync(path.dirname(file), { recursive: true });
    const tmpPath = `${file}.tmp-${process.pid}`;
    fsLike.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2));
    fsLike.renameSync(tmpPath, file);
    return normalized;
}

// A host has open findings when the audit saw events we missed, items that
// are not events, or a lost series the site still lists (our miss).
function hostHasOpenFindings(entry) {
    if (!entry) return false;
    return (entry.missing || []).length > 0 || (entry.fake || []).length > 0 || (entry.wrong || []).length > 0 || (entry.still || []).some((item) => item.verdict === 'still-listed');
}

function findingsQueue(store) {
    const state = normalizeSourceAuditStore(store);
    return Object.keys(state.hosts)
        .map((host) => Object.assign({ host }, state.hosts[host]))
        .filter(hostHasOpenFindings)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.host.localeCompare(b.host));
}

// ---------------------------------------------------------------------------
// Rotation: troubled/lost hosts first, then hosts with two or more quality
// badges, then the rest — within a band the host audited longest ago (never
// first), alphabetical last. Companions are skipped. `cap` hosts per run,
// so 49 hosts come round every ~2 weeks of daily runs (3 × 14 = 42, with the
// troubled ones taking the front of the line more often).
// ---------------------------------------------------------------------------
function auditBand(row) {
    if (['dead', 'stopped', 'shrunk', 'lost'].includes(row.verdict)) return 0;
    if (row.quality && row.quality.offCount >= 2) return 1;
    return 2;
}

function pickAuditHosts(health, store, options = {}) {
    const cap = Number.isFinite(options.cap) && options.cap > 0 ? options.cap : DEFAULT_CAP;
    const today = String(options.today || new Date().toISOString().slice(0, 10));
    const rows = health && Array.isArray(health.rows) ? health.rows.filter((row) => row.verdict !== 'companion') : [];
    const state = normalizeSourceAuditStore(store);
    const forced = Array.isArray(options.hosts) ? options.hosts.map((host) => String(host).toLowerCase()).filter(Boolean) : [];
    if (forced.length) return rows.filter((row) => forced.includes(String(row.host).toLowerCase())).map((row) => ({ host: row.host, reason: 'forced' }));
    const auditedAt = (host) => (state.hosts[host] && state.hosts[host].date) || '';
    const ordered = rows.slice().sort((a, b) => auditBand(a) - auditBand(b)
        || auditedAt(a.host).localeCompare(auditedAt(b.host))
        || String(a.host).localeCompare(String(b.host)));
    const picks = ordered.filter((row) => auditedAt(row.host) !== today).slice(0, cap);
    return picks.map((row) => {
        const band = auditBand(row);
        const reason = band === 0 ? `${row.verdict}${row.since ? ` since ${row.since}` : ''}`
            : (band === 1 ? `${row.quality.offCount} quality signals off` : (auditedAt(row.host) ? `last audited ${auditedAt(row.host)}` : 'never audited'));
        return { host: row.host, reason };
    });
}

// ---------------------------------------------------------------------------
// "Still on the site?" — the series title against the page's readable text,
// line by line (a card's title sits on one line, sometimes two): found when
// ≥60% of the title's tokens (3+ chars) are on a line or a pair of adjacent
// lines; a one-token title needs its token on a line. Page text folded the
// way the ledger folds titles, so case, accents and punctuation never decide.
// ---------------------------------------------------------------------------
function foldAuditText(value) {
    return String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

function titleTokens(title) {
    return [...new Set(foldAuditText(title).split(' ').filter((word) => word.length > 2))];
}

function stillOnSite(title, pageText, options = {}) {
    const minOverlap = Number.isFinite(options.minOverlap) ? options.minOverlap : 0.6;
    const tokens = titleTokens(title);
    if (!tokens.length) return { verdict: 'unknown', line: '', overlap: 0 };
    const lines = String(pageText || '').split('\n').map(foldAuditText).filter(Boolean);
    if (!lines.length) return { verdict: 'unknown', line: '', overlap: 0 };
    let best = { overlap: 0, line: '' };
    const score = (text) => {
        const words = new Set(text.split(' '));
        let shared = 0;
        tokens.forEach((token) => { if (words.has(token)) shared += 1; });
        return shared / tokens.length;
    };
    const needed = tokens.length === 1 ? 1 : minOverlap;
    for (let index = 0; index < lines.length && best.overlap < needed; index += 1) {
        const single = score(lines[index]);
        if (single > best.overlap) best = { overlap: single, line: lines[index] };
    }
    for (let index = 0; index + 1 < lines.length && best.overlap < needed; index += 1) {
        const pair = score(`${lines[index]} ${lines[index + 1]}`);
        if (pair > best.overlap) best = { overlap: pair, line: `${lines[index]} / ${lines[index + 1]}` };
    }
    return { verdict: best.overlap >= needed ? 'still-listed' : 'site-removed', line: best.line.slice(0, 160), overlap: Math.round(best.overlap * 100) / 100 };
}

// ---------------------------------------------------------------------------
// The AI report: the page's text beside what we extracted. JSON only.
// ---------------------------------------------------------------------------
function buildAuditPrompt(host, pageText, events, options = {}) {
    const cap = Number.isFinite(options.pageTextCap) ? options.pageTextCap : PAGE_TEXT_CAP;
    const today = String(options.today || new Date().toISOString().slice(0, 10));
    const text = String(pageText || '').slice(0, cap);
    const list = (Array.isArray(events) ? events : []).slice(0, 120).map((event, index) => `${index + 1}. ${event.day || '????-??-??'}${event.time ? ` ${event.time}` : ''} — ${event.title || 'Untitled'}${event.place ? ` @ ${event.place}` : ''}`).join('\n');
    return [
        `You audit a scraper that collects events from ${host} for a gay bear community calendar. Today is ${today}.`,
        'Below is the readable text of the site\u2019s listing page(s), then everything the scraper extracted from this site in its latest run (one per line: date, time, title, place).',
        'Answer from the page text ONLY. Do not invent events; quote titles and date text as printed on the page. Use the event TITLE alone as "title" (never the whole extracted line).',
        `1. missing: events announced on the page for today or later (a dated party, show, night, bust, social, festival day) that are NOT in the extracted list. Ignore navigation, menus, shop items, generic headings, and anything dated before ${today}.`,
        '2. fake: extracted items whose TITLE is plainly not an event at all. Give each a kind: button (a link/CTA label like "Book", "View Event"), label (a status like "Happening Now", "Free"), menu (navigation), heading (a section or category heading), prompt (UI instructions), booking (hotel/ticket links), newsletter, duplicate (the same event twice), other. A real party, show, night, social or festival day is NEVER fake however it is named; an item simply absent from this page text is NOT fake either \u2014 the scraper read more pages than are shown.',
        '3. wrong: extracted items that ARE events on the page but whose date, time or place disagrees with the page. Say what the page says.',
        '4. note: one line on how well the extraction matches the page (or an empty string).',
        'Respond with JSON only, exactly this shape: {"missing":[{"title":"","date":""}],"fake":[{"title":"","kind":"","reason":""}],"wrong":[{"title":"","issue":""}],"note":""}',
        '',
        '=== PAGE TEXT ===',
        text,
        '=== END PAGE TEXT ===',
        '',
        `=== EXTRACTED EVENTS (${(Array.isArray(events) ? events : []).length}) ===`,
        list || '(nothing extracted)',
        '=== END EXTRACTED ===',
        '',
        `Now answer as the auditor, from the page text above only, for ${today} or later: which page events are missing from the extracted list, which extracted titles are not events, which extracted items have the wrong date/time/place, one note.`,
        'Reply with ONLY the JSON object, no prose: {"missing":[{"title":"","date":""}],"fake":[{"title":"","kind":"","reason":""}],"wrong":[{"title":"","issue":""}],"note":""}'
    ].join('\n');
}

function extractFirstJsonObject(text) {
    const value = String(text || '');
    const start = value.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    for (let index = start; index < value.length; index += 1) {
        const char = value[index];
        if (inString) {
            if (char === '\\') index += 1;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === '{') depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) return value.slice(start, index + 1);
        }
    }
    return null;
}

const FAKE_KINDS = ['button', 'label', 'menu', 'heading', 'prompt', 'booking', 'newsletter', 'duplicate', 'category', 'link'];

function fakeKind(item) {
    const kind = String(item && item.kind || '').toLowerCase().trim();
    if (FAKE_KINDS.includes(kind)) return kind;
    if (kind === 'other') return 'other';
    // No kind given (an older or a terse answer): read the reason.
    const reason = String(item && item.reason || '').toLowerCase();
    const found = FAKE_KINDS.find((name) => reason.includes(name)) || (/\bui\b|instruction|navigation|cta|status/.test(reason) ? 'label' : null);
    if (found) return found;
    return /generic|promo|descriptive|series name|performer|phras|named event|not a clean|mismatch|not fake|wrong/.test(reason) ? 'other' : 'label';
}

// A button, label, menu entry or heading is a few words; a real party name
// the model dislikes ("FALLEN ANGELS: A NIGHT OF PLEASURE, DANCE &
// VENGEANCE [heading]") is not. Four or more word tokens pass only as a
// UI prompt, a booking/newsletter link or a duplicate.
function looksLikeNonEvent(item) {
    const SharedCore = loadSharedCore();
    const title = String(item && item.title || '');
    if (SharedCore.junkTitleReason(title)) return true;
    if (!/\p{L}/u.test(title)) return true;
    if (['prompt', 'booking', 'newsletter', 'duplicate'].includes(item.kind)) return true;
    const tokens = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
    return tokens.length <= 3;
}

// The model's answer checked against what we hold: a "missing" title that
// matches an extracted title is not missing; a "fake" or "wrong" title that
// matches no extracted title is about nothing we did; an empty issue is no
// finding; duplicates collapse. options.extracted = the extracted titles.
// The date text as printed ("Oct 08", "October 8, 2026", "2026-10-08",
// "Sat, Oct 11 · 9PM") → YYYY-MM-DD, this year unless the text says one.
const MONTH_INDEX = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
function auditDateKey(text, year) {
    const value = String(text || '');
    const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i.exec(value);
    if (!named) return '';
    const month = MONTH_INDEX[named[1].toLowerCase()];
    const day = Number(named[2]);
    if (!month || !(day >= 1 && day <= 31)) return '';
    return `${named[3] || year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseAuditAnswer(text, options = {}) {
    const candidate = extractFirstJsonObject(text);
    if (!candidate) return null;
    let parsed;
    try { parsed = JSON.parse(candidate); } catch (_) { return null; }
    if (!parsed || typeof parsed !== 'object') return null;
    const clean = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
    const extractedFolds = (Array.isArray(options.extracted) ? options.extracted : []).map(foldAuditText).filter(Boolean);
    const SharedCore = loadSharedCore();
    // "missing" is suppressed generously (anything we hold that overlaps
    // the title); "fake"/"wrong" must name an extracted title exactly or by
    // containment — "Pride Saturday" is not "Pride 2026 Saturday Afternoon Show".
    const matchesExtracted = (title) => {
        const fold = foldAuditText(title);
        if (!fold) return false;
        return extractedFolds.some((known) => known === fold || known.includes(fold) || fold.includes(known) || SharedCore.sourceLedgerTitleOverlap(fold, known) >= 0.6);
    };
    const namesExtracted = (title) => {
        const fold = foldAuditText(title);
        if (!fold) return false;
        return extractedFolds.some((known) => known === fold || known.includes(fold) || fold.includes(known));
    };
    const checkAgainstExtracted = extractedFolds.length > 0;
    const today = String(options.today || '');
    const dateBeforeToday = (text) => {
        if (!today) return false;
        const day = auditDateKey(text, today.slice(0, 4));
        return !!day && day < today;
    };
    const seen = new Set();
    const once = (item) => { const key = foldAuditText(item.title); if (!key || seen.has(key)) return false; seen.add(key); return true; };
    const missing = (Array.isArray(parsed.missing) ? parsed.missing : []).map((item) => (typeof item === 'string' ? { title: item } : item))
        .filter((item) => item && typeof item === 'object' && clean(item.title, 160)).map((item) => ({ title: clean(item.title, 160), date: clean(item.date, 80) }))
        .filter((item) => !(checkAgainstExtracted && matchesExtracted(item.title))).filter((item) => !dateBeforeToday(item.date)).filter(once).slice(0, 40);
    seen.clear();
    // A "fake" is kept only when the model names a concrete kind of
    // non-event (a button, a status label, a menu entry, a heading, a UI
    // prompt, a booking link, a newsletter, a duplicate); an opinion about
    // how an event is named ("generic phrasing", "promo", "series name") is
    // not a finding and is dropped — the first live audit called 32 real
    // 3 Dollar Bill parties "not an event title".
    const fake = (Array.isArray(parsed.fake) ? parsed.fake : []).map((item) => (typeof item === 'string' ? { title: item } : item))
        .filter((item) => item && typeof item === 'object' && clean(item.title, 160))
        .map((item) => ({ title: clean(item.title, 160), kind: fakeKind(item), reason: clean(item.reason, 160) }))
        .filter((item) => item.kind !== 'other' && looksLikeNonEvent(item))
        .filter((item) => !checkAgainstExtracted || namesExtracted(item.title)).filter(once)
        .slice(0, 40);
    seen.clear();
    const wrong = (Array.isArray(parsed.wrong) ? parsed.wrong : []).map((item) => (typeof item === 'string' ? { title: item } : item))
        .filter((item) => item && typeof item === 'object' && clean(item.title, 160)).map((item) => ({ title: clean(item.title, 160), issue: clean(item.issue || item.reason, 200) }))
        .filter((item) => item.issue && (!checkAgainstExtracted || namesExtracted(item.title))).filter(once).slice(0, 40);
    return { missing, fake, wrong, note: clean(parsed.note, 300) };
}

// ---------------------------------------------------------------------------
// The run. Everything that can fail is caught per host; the function never
// throws into run-once (it returns a summary instead).
// ---------------------------------------------------------------------------
function isAuditEnabled(env = process.env) {
    return String((env && env.CHUNKY_SOURCE_AUDIT) || '').trim() !== '0';
}

function forcedHosts(env = process.env) {
    return String((env && env.CHUNKY_SOURCE_AUDIT_HOSTS) || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
}

function budgetMs(env = process.env) {
    const raw = Number(String((env && env.CHUNKY_SOURCE_AUDIT_BUDGET_MS) || '').trim());
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BUDGET_MS;
}

// The loss state in source-upcoming.json gets the verdict so the next
// ledger line carries lost[].still (the adapters do not change).
function stampStillIntoLossState(sharedRoot, host, verdicts, checkedAt, fsLike = fs) {
    const file = path.join(sharedRoot, 'metrics', 'source-upcoming.json');
    let snapshot;
    try { snapshot = JSON.parse(fsLike.readFileSync(file, 'utf8')); } catch (_) { return false; }
    const entry = snapshot && snapshot.hosts && snapshot.hosts[host];
    if (!entry || !entry.lost || typeof entry.lost !== 'object') return false;
    let touched = 0;
    verdicts.forEach((item) => {
        const key = foldAuditText(item.title);
        const series = entry.lost[key];
        if (!series) return;
        series.still = { verdict: item.verdict, at: checkedAt };
        touched += 1;
    });
    if (!touched) return false;
    const tmpPath = `${file}.tmp-${process.pid}`;
    fsLike.writeFileSync(tmpPath, JSON.stringify(snapshot));
    fsLike.renameSync(tmpPath, file);
    return true;
}

// The pages worth reading for a host: its configured listing url first, then
// the pages the run itself classified as multi-event pages on that host (the
// calendar behind a home page, a feed the parser reads) — at most three.
function listingUrlsForHost(results, host, configuredUrl) {
    const hostKey = String(host || '').toLowerCase().replace(/^www\./, '');
    const SharedCore = loadSharedCore();
    const urls = [];
    const push = (url) => { const value = String(url || '').trim(); if (value && !urls.includes(value)) urls.push(value); };
    if (configuredUrl) push(configuredUrl);
    const parsers = results && Array.isArray(results.parserResults) ? results.parserResults : [];
    parsers.forEach((parser) => {
        const classifications = parser && parser.urlClassifications && typeof parser.urlClassifications === 'object' ? parser.urlClassifications : {};
        Object.keys(classifications).forEach((url) => {
            if (String(classifications[url]) !== 'multi-event-page') return;
            if (SharedCore.hostOfUrl(url) !== hostKey) return;
            push(url);
        });
    });
    return urls.slice(0, 3);
}

async function fetchListingText(adapter, url, options = {}) {
    if (!adapter || typeof adapter.fetchData !== 'function' || !url) return { page: null, reason: 'no adapter or url' };
    const reviewQueue = require(path.join(__dirname, 'review-queue'));
    let page = null;
    try {
        page = await adapter.fetchData(url, options.fresh ? { fresh: true } : {});
    } catch (error) {
        return { page: null, reason: error && error.message ? error.message : String(error) };
    }
    if (!page || typeof page.html !== 'string' || !page.html) return { page: null, reason: 'empty page' };
    const readable = reviewQueue.readableTextFromHtml(page.html, options.pageTextCap || PAGE_TEXT_CAP);
    return { page: { url: page.url || url, fetchedAt: page.fetchedAt || new Date().toISOString(), chars: readable.chars, text: readable.text }, reason: '' };
}

async function askAi(options, prompt) {
    // options.ai = { generate(prompt) } (tests) or the real client:
    // SharedCore.callAiGenerate with the parser's response cache under
    // storage/ai-responses/source-audit/ — a re-run of the same page beside
    // the same events is free.
    if (options.ai && typeof options.ai.generate === 'function') return options.ai.generate(prompt);
    const aiConfig = options.aiConfig;
    if (!aiConfig || !aiConfig.endpoint || aiConfig.enabled === false) return null;
    const SharedCore = loadSharedCore();
    const core = options.core || new SharedCore({}, { eventSchema: require(path.join(repoRoot, 'scripts', 'event-schema')).EventSchema });
    if (!core.aiResponseCache) {
        try {
            const { AiWebParser } = require(path.join(repoRoot, 'scripts', 'parsers', 'ai-web-parser'));
            core.aiResponseCache = new AiWebParser({ normalizeUrl: (url) => SharedCore.normalizeUrl(url) }).getAiResponseCache();
        } catch (error) {
            console.log(`source-audit: AI response cache unavailable (${error.message}) — asking uncached`);
        }
    }
    return core.callAiGenerate(Object.assign({}, aiConfig, { timeoutSeconds: Number(aiConfig.timeoutSeconds) || 120 }), prompt, SOURCE_AUDIT_PASS, options.adapter);
}

async function runSourceAudit(options = {}) {
    const env = options.env || process.env;
    const log = typeof options.log === 'function' ? options.log : console.log;
    const started = Date.now();
    const summary = { enabled: true, audited: [], losses: [], skipped: [], errors: [] };
    if (!isAuditEnabled(env)) { summary.enabled = false; log('source-audit: disabled (CHUNKY_SOURCE_AUDIT=0)'); return summary; }
    const sharedRoot = options.sharedRoot;
    if (!sharedRoot) { summary.skipped.push('no shared root'); return summary; }
    const fsLike = options.fs || fs;
    const reviewQueue = require(path.join(__dirname, 'review-queue'));
    const loaded = reviewQueue.loadSourceHealth(sharedRoot, { fs: fsLike, now: options.now });
    if (!loaded) { summary.skipped.push('no source ledger'); log('source-audit: no source ledger yet — nothing to audit'); return summary; }
    const results = options.results || null;
    const runId = String(options.runId || (results && results.summary && results.summary.runId) || '');
    const today = String(options.today || new Date().toISOString().slice(0, 10));
    const storePath = getSourceAuditPath(sharedRoot);
    let store = loadSourceAudit(storePath, fsLike);
    const budget = Number.isFinite(options.budgetMs) ? options.budgetMs : budgetMs(env);
    const cap = Number.isFinite(options.cap) ? options.cap : DEFAULT_CAP;
    const rotation = pickAuditHosts(loaded.health, store, { cap, today, hosts: options.hosts || forcedHosts(env) });
    const rotationHosts = new Set(rotation.map((pick) => pick.host));
    // Every host whose loss was confirmed in THIS run gets the still-on-site
    // check even outside the rotation.
    const lossHosts = loaded.health.rows.filter((row) => row.latest && row.latest.run_id === runId && Array.isArray(row.lost) && row.lost.some((series) => (Number(series.new) || 0) > 0)).map((row) => row.host);
    const work = [...rotation.map((pick) => ({ host: pick.host, reason: pick.reason, full: true })), ...lossHosts.filter((host) => !rotationHosts.has(host)).map((host) => ({ host, reason: 'loss confirmed this run', full: false }))];
    log(`source-audit: ${rotation.length} host(s) in the rotation (${rotation.map((pick) => `${pick.host}: ${pick.reason}`).join('; ') || 'none'})${lossHosts.length ? `, ${lossHosts.length} with a loss confirmed this run` : ''}`);
    const checkedAt = new Date().toISOString();
    for (const item of work) {
        if (Date.now() - started > budget) { summary.skipped.push(`${item.host} (budget)`); continue; }
        const row = loaded.health.rows.find((entry) => entry.host === item.host);
        if (!row) continue;
        const entry = {
            date: today, run_id: runId, verdict: row.verdict,
            badges: row.quality && Array.isArray(row.quality.badges) ? row.quality.badges.map((badge) => badge.chip || badge.label) : [],
            page: null, still: [], missing: [], fake: [], wrong: [], note: '', ai: 'skipped'
        };
        try {
            const url = row.url || `https://${row.host}/`;
            // A cached page older than the loss cannot say whether the loss is
            // still listed: ask for a fresh one then.
            const newestLoss = (row.lost || []).map((series) => String(series.since || '')).sort().pop() || '';
            const lossDay = newestLoss ? `${newestLoss.slice(0, 4)}-${newestLoss.slice(4, 6)}-${newestLoss.slice(6, 8)}` : '';
            // Every listing page of the host (configured url + the run's own
            // multi-event pages) read through the adapter; their texts are
            // searched together and shown to the model together.
            const pages = [];
            let reason = '';
            for (const candidate of listingUrlsForHost(results, row.host, url)) {
                let fetched = await fetchListingText(options.adapter, candidate, { pageTextCap: options.pageTextCap });
                if (fetched.page && lossDay && String(fetched.page.fetchedAt).slice(0, 10) < lossDay) {
                    const fresh = await fetchListingText(options.adapter, candidate, { fresh: true, pageTextCap: options.pageTextCap });
                    if (fresh.page) fetched = fresh;
                }
                if (fetched.page) pages.push(fetched.page); else if (!reason) reason = fetched.reason;
            }
            const fetched = pages.length
                ? { page: { url: pages.map((page) => page.url).join(' + '), fetchedAt: pages.map((page) => page.fetchedAt).sort()[0] || '', chars: pages.reduce((sum, page) => sum + page.chars, 0), text: pages.map((page) => page.text).join('\n\n') }, reason: '' }
                : { page: null, reason };
            if (!fetched.page) {
                entry.ai = 'no-page';
                entry.note = `listing page unreachable: ${fetched.reason}`.slice(0, 300);
                entry.still = (row.lost || []).map((series) => ({ title: series.title, verdict: 'unknown', checked_at: checkedAt, line: '' }));
            } else {
                entry.page = { url: fetched.page.url, fetchedAt: fetched.page.fetchedAt, chars: fetched.page.chars };
                entry.still = (row.lost || []).map((series) => {
                    const match = stillOnSite(series.title, fetched.page.text);
                    return { title: series.title, verdict: match.verdict, checked_at: checkedAt, line: match.line };
                });
                if (item.full) {
                    // Only what is still ahead: a run a few days old carries nights
                    // that have passed, and the model would call them wrong.
                    const events = (results ? reviewQueue.eventsForHost(results, row.host) : []).filter((event) => !event.day || event.day >= today);
                    const prompt = buildAuditPrompt(row.host, fetched.page.text, events, { pageTextCap: options.pageTextCap, today });
                    let answer = null;
                    try { answer = await askAi(options, prompt); } catch (error) { summary.errors.push(`${row.host}: ai ${error.message}`); }
                    const extractedTitles = events.map((event) => event.title);
                    let parsed = parseAuditAnswer(answer, { extracted: extractedTitles, today });
                    if (!parsed && answer) {
                        // Prose instead of JSON: once more with half the page.
                        const shorter = buildAuditPrompt(row.host, fetched.page.text, events, { pageTextCap: Math.floor((Number.isFinite(options.pageTextCap) ? options.pageTextCap : PAGE_TEXT_CAP) / 2), today });
                        try { answer = await askAi(options, shorter); } catch (error) { summary.errors.push(`${row.host}: ai retry ${error.message}`); }
                        parsed = parseAuditAnswer(answer, { extracted: extractedTitles, today });
                    }
                    if (parsed) {
                        entry.missing = parsed.missing;
                        entry.fake = parsed.fake;
                        entry.wrong = parsed.wrong;
                        entry.note = parsed.note;
                        entry.ai = 'ok';
                    } else {
                        entry.ai = answer ? 'failed' : 'failed';
                        entry.note = answer ? 'the model’s answer was not the JSON asked for' : 'no answer from the model';
                    }
                }
            }
            if (entry.still.length) stampStillIntoLossState(sharedRoot, row.host, entry.still, checkedAt, fsLike);
            if (item.full) { store.hosts[row.host] = entry; summary.audited.push(row.host); } else {
                // Loss-only check: keep the host's last full audit, refresh its still list.
                const previous = store.hosts[row.host] || Object.assign({}, entry, { missing: [], fake: [], wrong: [], note: '', ai: 'skipped' });
                store.hosts[row.host] = Object.assign({}, previous, { still: entry.still, page: entry.page || previous.page });
                summary.losses.push(row.host);
            }
            const stillListed = entry.still.filter((check) => check.verdict === 'still-listed').length;
            log(`source-audit: ${row.host} — ${item.full ? `${entry.missing.length} missing, ${entry.fake.length} not events, ${entry.wrong.length} wrong, ai ${entry.ai}` : 'loss check'}${entry.still.length ? `, lost series: ${stillListed} still listed, ${entry.still.filter((check) => check.verdict === 'site-removed').length} removed by the site, ${entry.still.filter((check) => check.verdict === 'unknown').length} unknown` : ''}${entry.note ? ` — ${entry.note.slice(0, 120)}` : ''}`);
        } catch (error) {
            summary.errors.push(`${row.host}: ${error.message}`);
            log(`source-audit: ${row.host} failed — ${error.message}`);
        }
    }
    store.runs.push({ run_id: runId, date: today, audited: summary.audited, losses: summary.losses, ms: Date.now() - started });
    try { saveSourceAudit(storePath, store, fsLike); } catch (error) { summary.errors.push(`save: ${error.message}`); }
    summary.ms = Date.now() - started;
    log(`source-audit: done in ${Math.round(summary.ms / 1000)}s — ${summary.audited.length} audited, ${summary.losses.length} loss checks, ${findingsQueue(store).length} host(s) with open findings${summary.errors.length ? `, ${summary.errors.length} error(s)` : ''}`);
    return summary;
}

module.exports = {
    SOURCE_AUDIT_FILE_NAME,
    SOURCE_AUDIT_PASS,
    STILL_VERDICTS,
    getSourceAuditPath,
    emptySourceAuditStore,
    normalizeSourceAuditStore,
    loadSourceAudit,
    saveSourceAudit,
    hostHasOpenFindings,
    findingsQueue,
    pickAuditHosts,
    foldAuditText,
    stillOnSite,
    buildAuditPrompt,
    parseAuditAnswer,
    auditDateKey,
    stampStillIntoLossState,
    fetchListingText,
    listingUrlsForHost,
    isAuditEnabled,
    runSourceAudit
};

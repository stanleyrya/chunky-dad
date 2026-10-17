#!/usr/bin/env node
// ============================================================================
// SOURCE EXPECTATIONS DIFF — what the site publishes vs what one run extracted
// ============================================================================
// data/source-expectations/<slug>.json is hand-written ground truth (README
// there). This is the comparison tool that README promised, and it keeps the
// README's one rule: for every event, every materialized occurrence and every
// trap, compare `expect.extracted` against membership in the run's
// parserResults[].events[] ∪ bearDroppedEvents[], keyed on
// ${normalizedTitle}|${startDate}|${bar} with ticketUrl/website as fallback.
//
// It is a REPORT. It reads one run file, never fetches a site, never writes
// anywhere but the --json path you name, and always exits 0 — a red verdict
// is the finding, not a failure of the tool.
//
// Vocabulary (one row per source in the console table):
//   exact   expected record found by key (title key + day + bar) or by a
//           shared ticketUrl/website on the same day (±1 day: the run keys
//           late-night events on their UTC day).
//   fuzzy   same day, title tokens overlap ≥ 0.6 or one title contains the
//           other — a RENAME shows up here instead of as missing.
//   miss↑   expected, not found, dated on/after the run day — the site should
//           still list it, so this is the scraper-bug column.
//   miss↓   expected, not found, dated before the run day — recon is weeks
//           old; most of these are simply past.
//   leak    expect.extracted:false that IS in the run (traps and false events).
//   extra   run records inside the recon's occurrence window that no
//           expectation or trap accounts for — new since recon, or fakes.
//   unk     expect.extracted:"unknown" rows, shown as found/absent, no verdict.
//   age     days between recon.date and the run day.
//
// Verdict (worst first): no-parser-in-run > leaking > missing (miss↑ > 0)
// > stale (age > 21 days AND extra > 0) > clean.
//
// Series: the expectation file already materializes occurrences inside
// coverage.occurrenceWindow, so those rows are what is compared. The repo's
// RRULE helper (SharedCore.expandRruleOccurrencesInWindow) is run beside them
// only as a file-quality check (dates the rule predicts in the window that the
// file does not list); it returns null for shapes it does not support
// (multi-token monthly BYDAY) and the row says so.
//
// Traps carry a label and a quote, not a title and a date, so trap matching is
// best-effort: title candidates are cut from the label (and an ICS SUMMARY in
// the quote), dates are read from the label/quote/note. A trap with a date
// needs the same day plus a title match; one without a date needs the exact
// title key or full token containment. The match basis is printed so a false
// alarm can be read as one.
//
// Usage:
//   node tools/source-expectations-diff.js [--run <path|runId>] [--source <name,…>]
//                                          [--json <path>] [--verbose] [--dir <expectations dir>]
//   --run defaults to the newest runs/<runId>.json under CHUNKY_SHARED_STORAGE_DIR
//   (else the iCloud chunky-dad-data folder, same resolution as review-queue).
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const DEFAULT_EXPECTATIONS_DIR = path.join(repoRoot, 'data', 'source-expectations');
const RUN_ID_PATTERN = /^\d{8}-\d{6}$/;
const INHERITABLE = ['city', 'timezone', 'bar', 'address', 'location', 'website', 'instagram', 'facebook'];
const FUZZY_THRESHOLD = 0.6;
const STALE_AFTER_DAYS = 21;
const VERDICT_RANK = { 'no-parser-in-run': 0, leaking: 1, missing: 2, stale: 3, clean: 4 };
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

const slugify = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ── shared-core ──────────────────────────────────────────────────────────────
// The title key and the bar key come from SharedCore so this tool agrees with
// the scraper's own dedup about what "the same title" means. Construction logs
// a city-count line; that is noise in a report, so it is muted for the call.
let cachedCore = null;
function loadCore() {
    if (cachedCore) return cachedCore;
    const { SharedCore } = require(path.join(repoRoot, 'scripts', 'shared-core'));
    const { EventSchema } = require(path.join(repoRoot, 'scripts', 'event-schema'));
    let cities = {};
    try { cities = require(path.join(repoRoot, 'scripts', 'scraper-cities')); } catch (_) { /* tests may run without it */ }
    const originalLog = console.log;
    console.log = () => {};
    try {
        cachedCore = new SharedCore(cities || {}, { eventSchema: EventSchema });
    } finally {
        console.log = originalLog;
    }
    return cachedCore;
}

// The scraper's brand prefixer writes "<brand>: <party>" into the title of
// some sources ("Lodge NY: Blow Buddies NYC"); the brand is the source name
// or the bar. The recon wrote the page's own title. Both sides are keyed
// without that prefix so the party can meet itself.
function stripBrandPrefix(title, brands) {
    let text = String(title || '');
    for (const brand of (Array.isArray(brands) ? brands : [brands])) {
        const name = String(brand || '').trim();
        if (!name) continue;
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const stripped = text.replace(new RegExp(`^\\s*${escaped}\\s*[:\\-–—]\\s+`, 'i'), '');
        if (stripped.trim()) text = stripped;
    }
    return text;
}

function titleKeyOf(core, title, bar, brands = []) {
    const key = core.getBearVerdictTitleKey(stripBrandPrefix(title, [bar, ...brands]), bar ? [bar] : []);
    if (key) return key;
    // "L.U.R.E" folds to four one-letter tokens and an empty key, which could
    // never match anything; the letters run together ("lure") still can.
    return foldText(title).replace(/ /g, '');
}

// The same key with no venue words removed: when the run wrote the title into
// the bar slot ("Sunday Showtunes" at bar "SHOWTUNES") the venue-aware key
// strips the title to nothing, and only the plain spelling can still meet.
function plainKeyOf(core, title, bar, brands = []) {
    return titleKeyOf(core, stripBrandPrefix(title, [bar, ...brands]), '');
}

// The title before a numeric tail: an ICS SUMMARY like "Squeeze 457 W 56th
// St, 2nd Fl" names the party and then its street address, and the scraper
// keeps only the party. Empty when the title has no such tail.
function headKeyOf(core, title, bar, brands = []) {
    const text = String(title || '');
    const head = text.replace(/\s+\d.*$/, '');
    if (!head || head === text) return '';
    return plainKeyOf(core, head, bar, brands);
}

function foldText(value) {
    return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokensOf(titleKey) {
    return titleKey ? titleKey.split(' ').filter(Boolean) : [];
}

function normalizeUrl(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text || !/^https?:\/\//.test(text)) return '';
    return text.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
}

// Dice coefficient on title tokens, or containment: "DIRTY LITTLE SECRET" vs
// "DIRTY LITTLE SECRET ROCKSTRAP" is the same night with a guest name added.
// One shared token is never enough: the cadence word in "Sunday Bears" is
// dropped by the key, leaving "bears", which would otherwise score 0.67
// against "Alley Bears" at a different bar.
function titleSimilarity(tokensA, tokensB) {
    if (tokensA.length === 0 || tokensB.length === 0) return 0;
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    let shared = 0;
    for (const token of setA) if (setB.has(token)) shared += 1;
    if (shared < 2) return 0;
    const dice = (2 * shared) / (setA.size + setB.size);
    const smaller = Math.min(setA.size, setB.size);
    return shared === smaller ? Math.max(dice, 1) : dice;
}

// Bars agree when either side is blank, the keys nest ("Eagle" / "Eagle
// Bar"), or they share a naming word: the recon wrote the page's spelling
// ("Eagle Bar Manchester", "Hotel Delfin") and the run wrote the curated one
// ("Eagle Manchester", "Delfin Beach Resort"). Generic words carry nothing.
const GENERIC_BAR_WORDS = new Set(['the', 'bar', 'club', 'pub', 'hotel', 'lounge', 'resort', 'tavern', 'saloon', 'and', 'of', 'at']);
function barsAgree(core, barA, barB) {
    const keyA = core.normalizeBarNameKey(barA);
    const keyB = core.normalizeBarNameKey(barB);
    if (!keyA || !keyB || keyA === keyB || keyA.includes(keyB) || keyB.includes(keyA)) return true;
    const words = (bar) => new Set(foldText(bar).split(' ').filter((word) => word.length >= 3 && !GENERIC_BAR_WORDS.has(word)));
    const wordsA = words(barA);
    for (const word of words(barB)) if (wordsA.has(word)) return true;
    return false;
}

// ── dates ────────────────────────────────────────────────────────────────────
function isoDay(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function dayMs(day) {
    const text = isoDay(day);
    return text ? Date.UTC(Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10))) : NaN;
}

function daysBetween(fromDay, toDay) {
    const a = dayMs(fromDay);
    const b = dayMs(toDay);
    return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / DAY_MS) : null;
}

function addDays(day, delta) {
    const ms = dayMs(day);
    return Number.isFinite(ms) ? new Date(ms + (delta * DAY_MS)).toISOString().slice(0, 10) : '';
}

function runDayOf(run, fallbackName = '') {
    const runId = String((run && run.summary && run.summary.runId) || fallbackName || '');
    const fromId = runId.match(/^(\d{4})(\d{2})(\d{2})-\d{6}/);
    if (fromId) return `${fromId[1]}-${fromId[2]}-${fromId[3]}`;
    const stamp = run && run.summary && run.summary.timestamp;
    return typeof stamp === 'string' && stamp.length >= 10 ? stamp.slice(0, 10) : '';
}

// A run record's day: the local day in its own timezone (what the expectation
// files write) AND the UTC day (what the run's `key` writes — UNDERBEAR
// 2026-10-17T02:00Z keys as 10-17 though it is the 16th in New York). Both
// are indexed so neither convention can hide a match.
function recordDays(core, record) {
    const days = new Set();
    const start = record && record.startDate;
    if (typeof start !== 'string' || start.length < 10) return days;
    const utcDay = start.slice(0, 10);
    if (isoDay(utcDay)) days.add(utcDay);
    const timezone = record.timezone || (record.city && core.getCityTimezone ? core.getCityTimezone(record.city) : null) || null;
    if (timezone) {
        const local = core.normalizeEventDateLocal(start, timezone);
        if (isoDay(local)) days.add(local);
    }
    return days;
}

// ── run side ─────────────────────────────────────────────────────────────────
function hostOf(url) {
    try { return new URL(String(url || '')).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; }
}

function normalizeRunRecord(core, raw, kind, extra = {}) {
    const bar = typeof raw.bar === 'string' ? raw.bar : (typeof raw.venue === 'string' ? raw.venue : '');
    const brands = [extra.parserName];
    const titleKey = titleKeyOf(core, raw.title, bar, brands);
    const days = recordDays(core, raw);
    const urls = new Set([normalizeUrl(raw.ticketUrl), normalizeUrl(raw.website), normalizeUrl(raw.url)].filter(Boolean));
    const localDay = (() => {
        const timezone = raw.timezone || null;
        const local = timezone ? core.normalizeEventDateLocal(raw.startDate, timezone) : '';
        return isoDay(local) || (typeof raw.startDate === 'string' ? raw.startDate.slice(0, 10) : '');
    })();
    return {
        kind,
        title: String(raw.title || ''),
        titleKey,
        plainKey: plainKeyOf(core, raw.title, bar, brands),
        headKey: headKeyOf(core, raw.title, bar, brands),
        tokens: tokensOf(titleKey),
        bar,
        barKey: core.normalizeBarNameKey(bar),
        day: localDay,
        days,
        urls,
        reason: extra.reason || '',
        source: String(raw.source || ''),
        key: String(raw.key || ''),
        covered: false
    };
}

// The record set per parser: events[] (kept) ∪ bearDroppedEvents[] (dropped
// by the bear check, still extracted). Newer runs carry bearDroppedEvents
// per parserResults entry; older runs only have the top-level list, whose
// records name no parser — those are attributed by the host of their event
// page against the parser's configured urls, and only when the parser entry
// has no list of its own (so nothing is counted twice).
function buildRunIndex(core, run) {
    const index = new Map();
    const results = Array.isArray(run && run.parserResults) ? run.parserResults : [];
    // A run that writes per-parser lists writes one for every parser that
    // dropped anything, so a parser without the key dropped nothing; the
    // host fallback would hand it other parsers' Eventbrite drops.
    const perParserLists = results.some((result) => result && Array.isArray(result.bearDroppedEvents));
    const topLevelDropped = !perParserLists && Array.isArray(run && run.bearDroppedEvents) ? run.bearDroppedEvents : [];
    for (const result of results) {
        if (!result || typeof result !== 'object' || !result.name) continue;
        const records = [];
        for (const event of (Array.isArray(result.events) ? result.events : [])) {
            if (event && typeof event === 'object') records.push(normalizeRunRecord(core, event, 'kept', { parserName: result.name }));
        }
        if (Array.isArray(result.bearDroppedEvents)) {
            for (const drop of result.bearDroppedEvents) {
                const event = drop && drop.event && typeof drop.event === 'object' ? drop.event : drop;
                if (event && typeof event === 'object') records.push(normalizeRunRecord(core, event, 'dropped', { reason: drop && drop.reason, parserName: result.name }));
            }
        } else if (topLevelDropped.length > 0) {
            const hosts = new Set((result.config && Array.isArray(result.config.urls) ? result.config.urls : []).map(hostOf).filter(Boolean));
            for (const drop of topLevelDropped) {
                const event = drop && drop.event && typeof drop.event === 'object' ? drop.event : null;
                if (!event) continue;
                const host = String(drop.host || hostOf(event.website) || hostOf(event.ticketUrl) || '').replace(/^www\./, '').toLowerCase();
                if (hosts.has(host)) records.push(normalizeRunRecord(core, event, 'dropped', { reason: drop.reason, parserName: result.name }));
            }
        }
        // A link on more than two records (a listing stub and its crawled
        // page are two) is the site, not an event, and identifies nothing.
        const urlCounts = new Map();
        for (const record of records) for (const url of record.urls) urlCounts.set(url, (urlCounts.get(url) || 0) + 1);
        const sharedUrls = new Set(Array.from(urlCounts.entries()).filter(([, count]) => count > 2).map(([url]) => url));
        index.set(String(result.name), { name: String(result.name), records, sharedUrls });
    }
    return index;
}

function recordsOnDay(records, day) {
    return records.filter((record) => record.days.has(day));
}

// ── expectation side ─────────────────────────────────────────────────────────
function inherit(doc, event) {
    const defaults = doc && doc.defaults && typeof doc.defaults === 'object' ? doc.defaults : {};
    const merged = Object.assign({}, event);
    for (const field of INHERITABLE) {
        if (merged[field] === undefined && defaults[field] !== undefined) merged[field] = defaults[field];
    }
    return merged;
}

function expectedValue(entry) {
    const value = entry && entry.expect ? entry.expect.extracted : undefined;
    return value === true || value === false ? value : 'unknown';
}

// One row per thing the run should (or should not) contain: a single is one
// row; a series is one row per listed occurrence (cancelled ones excluded —
// the site itself says that night is off).
function materializeExpected(core, doc) {
    const rows = [];
    let cancelled = 0;
    const siteUrl = normalizeUrl(doc.defaults && doc.defaults.website);
    for (const raw of (Array.isArray(doc.events) ? doc.events : [])) {
        const event = inherit(doc, raw);
        const bar = typeof event.bar === 'string' ? event.bar : '';
        const brands = [doc.source];
        const titleKey = titleKeyOf(core, event.title, bar, brands);
        // Only the event's OWN links identify it; the inherited website is
        // the bar's homepage, shared by every row of the file.
        const ownUrls = [normalizeUrl(raw.ticketUrl), normalizeUrl(raw.website)].filter((url) => url && url !== siteUrl);
        const base = {
            eventId: String(event.id || ''),
            title: String(event.title || ''),
            titleKey,
            plainKey: plainKeyOf(core, event.title, bar, brands),
            headKey: headKeyOf(core, event.title, bar, brands),
            tokens: tokensOf(titleKey),
            bar,
            barKey: core.normalizeBarNameKey(bar),
            urls: new Set(ownUrls),
            extracted: expectedValue(event),
            note: (event.expect && event.expect.note) || '',
            confidence: event.confidence || '',
            belongsToSource: typeof event.belongsToSource === 'string' ? event.belongsToSource : '',
            kind: event.kind === 'series' ? 'series' : 'single'
        };
        if (base.kind === 'series') {
            for (const occurrence of (Array.isArray(event.occurrences) ? event.occurrences : [])) {
                if (!occurrence || !isoDay(occurrence.startDate)) continue;
                if (occurrence.cancelled === true) { cancelled += 1; continue; }
                const overrides = occurrence.overrides && typeof occurrence.overrides === 'object' ? occurrence.overrides : {};
                const title = typeof overrides.title === 'string' && overrides.title ? overrides.title : base.title;
                const overriddenKey = title === base.title ? titleKey : titleKeyOf(core, title, bar, brands);
                rows.push(Object.assign({}, base, {
                    title,
                    titleKey: overriddenKey,
                    plainKey: title === base.title ? base.plainKey : plainKeyOf(core, title, bar, brands),
                    headKey: title === base.title ? base.headKey : headKeyOf(core, title, bar, brands),
                    tokens: tokensOf(overriddenKey),
                    day: occurrence.startDate,
                    origin: occurrence.origin || 'listed'
                }));
            }
        } else if (isoDay(event.startDate)) {
            rows.push(Object.assign({}, base, { day: event.startDate, origin: 'single' }));
        }
    }
    return { rows, cancelled };
}

// File-quality check, not a comparison input: does the RRULE the file states
// predict the nights the file lists inside its window? Uses the repo's own
// expander; shapes it cannot read are reported as unsupported, not guessed.
function ruleCheck(core, doc) {
    const SharedCore = core.constructor;
    const window = doc.coverage && doc.coverage.occurrenceWindow;
    const result = { checked: 0, unsupported: 0, unlisted: [] };
    if (!window || !isoDay(window.start) || !isoDay(window.end) || typeof SharedCore.expandRruleOccurrencesInWindow !== 'function') return result;
    for (const event of (Array.isArray(doc.events) ? doc.events : [])) {
        if (event.kind !== 'series' || !event.recurrence) continue;
        const occurrences = (Array.isArray(event.occurrences) ? event.occurrences : []).filter((o) => o && isoDay(o.startDate));
        const anchorDay = isoDay(event.startDate) || (occurrences[0] && occurrences[0].startDate) || '';
        if (!anchorDay) continue;
        // Noon UTC as the wall clock: the helper iterates in the series' own
        // wall-clock domain and only the day matters here.
        const anchor = new Date(`${anchorDay}T12:00:00Z`);
        const expanded = SharedCore.expandRruleOccurrencesInWindow(event.recurrence, anchor, new Date(dayMs(window.start)), new Date(dayMs(window.end) + DAY_MS - 1));
        if (!Array.isArray(expanded)) { result.unsupported += 1; continue; }
        result.checked += 1;
        const listed = new Set(occurrences.map((o) => o.startDate));
        for (const instant of expanded) {
            const day = instant.toISOString().slice(0, 10);
            if (day < anchorDay) continue;
            if (!listed.has(day)) result.unlisted.push({ eventId: String(event.id || ''), title: String(event.title || ''), day });
        }
    }
    return result;
}

// ── trap probes ──────────────────────────────────────────────────────────────
function datesInText(text, options = {}) {
    const found = new Set();
    const source = String(text || '');
    for (const match of source.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)) found.add(`${match[1]}-${match[2]}-${match[3]}`);
    for (const match of source.matchAll(/\b(20\d\d)(\d\d)(\d\d)T\d{4}/g)) found.add(`${match[1]}-${match[2]}-${match[3]}`);
    const monthNames = Object.keys(MONTHS).join('|');
    const monthFirst = new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d\\d)\\b`, 'gi');
    for (const match of source.matchAll(monthFirst)) {
        const month = MONTHS[match[1].toLowerCase()];
        if (month) found.add(`${match[3]}-${String(month).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`);
    }
    const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})\\.?,?\\s+(20\\d\\d)\\b`, 'gi');
    for (const match of source.matchAll(dayFirst)) {
        const month = MONTHS[match[2].toLowerCase()];
        if (month) found.add(`${match[3]}-${String(month).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`);
    }
    // Prose states "November 27th" with no year. Read it against the recon
    // year — the year the site was read — rolling into the next year only
    // when the month sits well before the recon month (a January line read
    // in September is next January). A title match is still required.
    const reconDay = isoDay(options.reconDay);
    if (reconDay) {
        const reconYear = Number(reconDay.slice(0, 4));
        const reconMonth = Number(reconDay.slice(5, 7));
        const yearFor = (month) => (month < reconMonth - 1 ? reconYear + 1 : reconYear);
        const bareMonthFirst = new RegExp(`\\b(${monthNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!,?\\s*20\\d\\d)`, 'gi');
        for (const match of source.matchAll(bareMonthFirst)) {
            const month = MONTHS[match[1].toLowerCase()];
            if (month) found.add(`${yearFor(month)}-${String(month).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`);
        }
        const bareDayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames})\\b(?!\\.?,?\\s*20\\d\\d)`, 'gi');
        for (const match of source.matchAll(bareDayFirst)) {
            const month = MONTHS[match[2].toLowerCase()];
            if (month) found.add(`${yearFor(month)}-${String(month).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`);
        }
    }
    return Array.from(found).filter((day) => isoDay(day) && !isNaN(dayMs(day)));
}

// Title candidates cut from a trap's label. `cut` marks the short forms (the
// head before an em dash, a parenthesis, a slash or "at/on/in", and an ICS
// SUMMARY from the quote); the full label is kept only for traps that also
// carry a date, because a long label that quotes a parent event's name
// ("… Western Xposure XXL 'GOLD $180 …'") would otherwise claim that event.
function trapProbe(core, trap, bar, reconDay = '') {
    const label = String(trap.label || '').trim();
    const quote = trap.evidence && typeof trap.evidence.quote === 'string' ? trap.evidence.quote : '';
    const candidates = new Map();
    const push = (text, cut) => {
        const clean = String(text || '').replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '').trim();
        if (clean.length < 3) return;
        if (!candidates.has(clean) || cut) candidates.set(clean, cut);
    };
    push(label, false);
    const head = label.split(/\s+[—–]\s+/)[0];
    const noParen = head.replace(/\s*\(.*$/, '');
    push(noParen, true);
    push(noParen.split(/\s+(?:at|on|in)\s+/i)[0], true);
    push(noParen.split(/\s+\/\s+/)[0], true);
    for (const match of quote.matchAll(/SUMMARY[^:]*:([^\n/]+)/g)) push(match[1], true);
    const titles = Array.from(candidates.entries()).map(([text, cut]) => {
        const titleKey = titleKeyOf(core, text, bar);
        return { text, cut, titleKey, tokens: tokensOf(titleKey) };
    }).filter((entry) => entry.tokens.length > 0);
    // Dates: the label and quote are site text; the note may also carry the
    // dates a past run leaked, which is exactly what we want to look for.
    const dateOptions = { reconDay };
    const days = Array.from(new Set([...datesInText(label, dateOptions), ...datesInText(quote, dateOptions), ...datesInText(trap.note, dateOptions)]));
    return { titles, days };
}

// A dated trap: same day plus any title agreement (key, containment either
// way, or token overlap). An undated trap must match on the title alone, so
// only the exact key or a short cut candidate (≤ 6 tokens) that contains the
// record's title (≥ 2 tokens) counts.
function trapMatches(probe, records) {
    const hits = [];
    const titleHit = (record, dated) => {
        const recordText = foldText(record.title);
        for (const candidate of probe.titles) {
            if (record.titleKey && record.titleKey === candidate.titleKey) return `title "${candidate.text}"`;
            if (dated) {
                const containment = record.tokens.length >= 2 && record.tokens.every((token) => candidate.tokens.includes(token));
                if (containment) return `label contains "${record.title}"`;
                const sim = titleSimilarity(record.tokens, candidate.tokens);
                if (sim >= FUZZY_THRESHOLD) return `tokens ${sim.toFixed(2)} vs "${candidate.text}"`;
            } else if (candidate.cut && candidate.tokens.length <= 6 && record.tokens.length >= 2
                && recordText && ` ${foldText(candidate.text)} `.includes(` ${recordText} `)) {
                // Raw text, not tokens: the title key drops city words, so by
                // tokens "CHUNK Portland - The Return!" would contain "CHUNK
                // BROOKLYN - The Return!".
                return `label contains "${record.title}"`;
            }
        }
        return '';
    };
    if (probe.days.length > 0) {
        for (const day of probe.days) {
            for (const record of recordsOnDay(records, day)) {
                const basis = titleHit(record, true);
                if (basis) hits.push({ record, basis: `${day} + ${basis}` });
            }
        }
    } else {
        for (const record of records) {
            const basis = titleHit(record, false);
            if (basis) hits.push({ record, basis: `no date in trap; ${basis}` });
        }
    }
    return hits;
}

// ── matching ─────────────────────────────────────────────────────────────────
function matchRow(core, row, parser) {
    const records = parser.records;
    const sharedUrls = parser.sharedUrls || new Set();
    const sameDay = recordsOnDay(records, row.day);
    const barAgrees = (record) => barsAgree(core, row.bar, record.bar);
    // Same title key on the same day is the event. The bar is a preference,
    // not a gate: the run's bar is a curated rewrite ("Eagle Bar Manchester"
    // → "Eagle Manchester") and the recon wrote what the page said, so a
    // bar-only disagreement is flagged on the match rather than turned into
    // a missing event.
    // Except on a one-token key: the key also drops venue and cadence words,
    // so "Sunday Bears" and "Alley Bears" both key as "bears", and with the
    // bars apart that is two parties.
    const sameTitle = sameDay.filter((record) => (row.titleKey && record.titleKey === row.titleKey)
        || (row.plainKey && record.plainKey === row.plainKey)
        || (row.headKey && (record.plainKey === row.headKey || record.headKey === row.headKey))
        || (record.headKey && record.headKey === row.plainKey));
    const exact = sameTitle.find(barAgrees) || (row.tokens.length >= 2 ? sameTitle[0] : undefined);
    if (exact) return { tier: 'exact', record: exact, barDiffers: !barAgrees(exact) };
    if (row.urls.size > 0) {
        for (const record of records) {
            if (![...record.urls].some((url) => row.urls.has(url) && !sharedUrls.has(url))) continue;
            const near = [row.day, addDays(row.day, -1), addDays(row.day, 1)].some((day) => record.days.has(day));
            if (near) return { tier: 'url', record };
        }
    }
    let best = null;
    for (const record of sameDay) {
        if (!barAgrees(record)) continue;
        const sim = titleSimilarity(row.tokens, record.tokens);
        if (sim >= FUZZY_THRESHOLD && (!best || sim > best.sim)) best = { tier: 'fuzzy', record, sim };
    }
    return best;
}

function describeRecord(record) {
    return { title: record.title, day: record.day, bar: record.bar, kind: record.kind, reason: record.reason || undefined };
}

function emptyCounts() {
    return { expected: 0, exact: 0, fuzzy: 0, missingUpcoming: 0, missingUpcomingListed: 0, missingPast: 0, leaked: 0, extra: 0, unknownFound: 0, unknownAbsent: 0, trapsExpectedFound: 0, trapsExpectedAbsent: 0, runRecords: 0, kept: 0, dropped: 0 };
}

function verdictFor(summary) {
    if (!summary.parserInRun) return 'no-parser-in-run';
    if (summary.counts.leaked > 0) return 'leaking';
    if (summary.counts.missingUpcoming > 0) return 'missing';
    if (summary.reconAgeDays !== null && summary.reconAgeDays > STALE_AFTER_DAYS && summary.counts.extra > 0) return 'stale';
    return 'clean';
}

function diffSource(core, doc, runIndex, runDay) {
    const source = String(doc.source || '');
    const parser = runIndex.get(source) || null;
    const records = parser ? parser.records : [];
    const reconDay = isoDay(doc.recon && doc.recon.date);
    const window = doc.coverage && doc.coverage.occurrenceWindow && isoDay(doc.coverage.occurrenceWindow.start) && isoDay(doc.coverage.occurrenceWindow.end)
        ? { start: doc.coverage.occurrenceWindow.start, end: doc.coverage.occurrenceWindow.end }
        : null;
    const summary = {
        source,
        slug: slugify(source),
        status: String(doc.status || ''),
        parserInRun: Boolean(parser),
        reconDate: reconDay || null,
        reconAgeDays: reconDay && runDay ? daysBetween(reconDay, runDay) : null,
        window,
        counts: emptyCounts(),
        found: [],
        fuzzy: [],
        missing: [],
        missingPast: [],
        leaked: [],
        unknown: [],
        traps: [],
        extras: [],
        ruleCheck: ruleCheck(core, doc),
        cancelledSkipped: 0,
        verdict: ''
    };
    summary.counts.runRecords = records.length;
    summary.counts.kept = records.filter((r) => r.kind === 'kept').length;
    summary.counts.dropped = records.filter((r) => r.kind === 'dropped').length;

    const { rows, cancelled } = materializeExpected(core, doc);
    summary.cancelledSkipped = cancelled;

    for (const row of rows) {
        // An aggregator row that belongs to another parser may have folded
        // into that parser's own results; the README's "anywhere in a run"
        // means both sets count, and the via is reported.
        let match = matchRow(core, row, parser || { records: [] });
        let via = 'own';
        if (!match && row.belongsToSource && runIndex.has(row.belongsToSource)) {
            match = matchRow(core, row, runIndex.get(row.belongsToSource));
            via = row.belongsToSource;
        }
        if (match) {
            match.record.covered = true;
            // A record that satisfies a positive expectation is that event;
            // a trap whose label happens to quote the event's name must not
            // claim it afterwards.
            if (row.extracted === true) match.record.satisfiesExpectation = true;
        }
        const past = runDay ? row.day < runDay : false;
        const entry = { eventId: row.eventId, title: row.title, day: row.day, bar: row.bar, kind: row.kind, origin: row.origin, past, via,
            tier: match ? match.tier : null, barDiffers: Boolean(match && match.barDiffers), record: match ? describeRecord(match.record) : null, note: row.note || undefined };
        if (row.extracted === true) {
            summary.counts.expected += 1;
            if (!match) {
                if (past) {
                    summary.counts.missingPast += 1; summary.missingPast.push(entry);
                } else {
                    // A listed row (or a single) the site itself dated is the
                    // hard evidence; a rule-derived night past the site's own
                    // horizon is the file's arithmetic, counted apart.
                    summary.counts.missingUpcoming += 1;
                    if (row.origin !== 'rule') summary.counts.missingUpcomingListed += 1;
                    summary.missing.push(entry);
                }
            } else if (match.tier === 'fuzzy') {
                summary.counts.fuzzy += 1; summary.fuzzy.push(entry);
            } else {
                summary.counts.exact += 1; summary.found.push(entry);
            }
        } else if (row.extracted === false) {
            if (match) { summary.counts.leaked += 1; summary.leaked.push(Object.assign({ what: 'event', basis: `${row.day} ${match.tier}` }, entry)); }
        } else {
            if (match) summary.counts.unknownFound += 1; else summary.counts.unknownAbsent += 1;
            summary.unknown.push(entry);
        }
    }

    for (const trap of (Array.isArray(doc.traps) ? doc.traps : [])) {
        const defaults = doc.defaults && typeof doc.defaults === 'object' ? doc.defaults : {};
        const probe = trapProbe(core, trap, typeof defaults.bar === 'string' ? defaults.bar : '', reconDay);
        const hits = trapMatches(probe, records.filter((record) => !record.satisfiesExpectation));
        for (const hit of hits) hit.record.covered = true;
        const expected = expectedValue(trap);
        const entry = { id: String(trap.id || ''), kind: String(trap.kind || ''), label: String(trap.label || ''), extracted: expected,
            probeDays: probe.days, hits: hits.slice(0, 5).map((hit) => ({ basis: hit.basis, record: describeRecord(hit.record) })), hitCount: hits.length };
        summary.traps.push(entry);
        if (expected === false && hits.length > 0) {
            summary.counts.leaked += 1;
            summary.leaked.push({ what: 'trap', id: entry.id, kind: entry.kind, title: entry.label, basis: hits[0].basis, record: hits[0].record ? describeRecord(hits[0].record) : null, hitCount: hits.length });
        } else if (expected === true) {
            if (hits.length > 0) summary.counts.trapsExpectedFound += 1; else summary.counts.trapsExpectedAbsent += 1;
        }
    }

    // Extras: records in the recon's window that nothing above claimed. With
    // no window (publishes-nothing) anything dated from the recon day on is
    // unaccounted for.
    for (const record of records) {
        if (record.covered) continue;
        const inWindow = window ? (record.day >= window.start && record.day <= window.end) : (reconDay ? record.day >= reconDay : true);
        if (!inWindow) continue;
        summary.counts.extra += 1;
        summary.extras.push(describeRecord(record));
    }
    summary.extras.sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title));
    summary.verdict = verdictFor(summary);
    return summary;
}

function sortWorstFirst(sources) {
    return sources.slice().sort((a, b) => (VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict])
        || ((b.counts.missingUpcoming + b.counts.leaked) - (a.counts.missingUpcoming + a.counts.leaked))
        || (b.counts.extra - a.counts.extra)
        || a.source.localeCompare(b.source));
}

function diffAll(docs, run, options = {}) {
    const core = options.core || loadCore();
    const runDay = options.runDay || runDayOf(run, options.runName);
    const runIndex = buildRunIndex(core, run);
    const wanted = options.sources && options.sources.length > 0 ? new Set(options.sources.map((s) => slugify(s))) : null;
    const sources = [];
    for (const doc of docs) {
        if (!doc || typeof doc !== 'object' || !doc.source) continue;
        if (wanted && !wanted.has(slugify(doc.source))) continue;
        sources.push(diffSource(core, doc, runIndex, runDay));
    }
    const sorted = sortWorstFirst(sources);
    const totals = emptyCounts();
    const verdicts = {};
    for (const summary of sorted) {
        for (const key of Object.keys(totals)) totals[key] += summary.counts[key] || 0;
        verdicts[summary.verdict] = (verdicts[summary.verdict] || 0) + 1;
    }
    const documented = new Set(docs.map((doc) => doc && doc.source).filter(Boolean));
    const parsersWithoutFile = Array.from(runIndex.keys()).filter((name) => !documented.has(name));
    return {
        runId: String((run && run.summary && run.summary.runId) || options.runName || ''),
        runDay,
        generatedAt: new Date().toISOString(),
        sources: sorted,
        totals,
        verdicts,
        parsersWithoutFile
    };
}

// ── files ────────────────────────────────────────────────────────────────────
function loadExpectations(dir = DEFAULT_EXPECTATIONS_DIR) {
    return fs.readdirSync(dir).filter((file) => file.endsWith('.json')).sort().map((file) => {
        try {
            return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        } catch (error) {
            throw new Error(`${file}: ${error.message}`);
        }
    });
}

function resolveRunsDir(env = process.env) {
    const { resolveSharedRoot } = require(path.join(repoRoot, 'tools', 'review-queue'));
    return path.join(resolveSharedRoot(env), 'runs');
}

function newestRunFile(runsDir) {
    const files = fs.readdirSync(runsDir).filter((file) => RUN_ID_PATTERN.test(file.replace(/\.json$/, '')) && file.endsWith('.json')).sort();
    return files.length > 0 ? path.join(runsDir, files[files.length - 1]) : '';
}

function resolveRunPath(spec, env = process.env) {
    if (spec && fs.existsSync(spec) && fs.statSync(spec).isFile()) return path.resolve(spec);
    const runsDir = resolveRunsDir(env);
    if (spec) {
        const candidate = path.join(runsDir, spec.endsWith('.json') ? spec : `${spec}.json`);
        if (fs.existsSync(candidate)) return candidate;
        throw new Error(`run not found: ${spec} (looked in ${runsDir})`);
    }
    const newest = newestRunFile(runsDir);
    if (!newest) throw new Error(`no run files in ${runsDir}`);
    return newest;
}

// ── rendering ────────────────────────────────────────────────────────────────
function pad(value, width, right = false) {
    const text = String(value === null || value === undefined ? '' : value);
    if (text.length >= width) return text;
    return right ? ' '.repeat(width - text.length) + text : text + ' '.repeat(width - text.length);
}

function renderTable(report) {
    const columns = [
        { head: 'source', get: (s) => s.source, right: false },
        { head: 'verdict', get: (s) => s.verdict, right: false },
        { head: 'exp', get: (s) => s.counts.expected, right: true },
        { head: 'exact', get: (s) => s.counts.exact, right: true },
        { head: 'fuzzy', get: (s) => s.counts.fuzzy, right: true },
        { head: 'miss↑', get: (s) => s.counts.missingUpcoming, right: true },
        { head: 'listed↑', get: (s) => s.counts.missingUpcomingListed, right: true },
        { head: 'miss↓', get: (s) => s.counts.missingPast, right: true },
        { head: 'leak', get: (s) => s.counts.leaked, right: true },
        { head: 'extra', get: (s) => s.counts.extra, right: true },
        { head: 'unk', get: (s) => `${s.counts.unknownFound}/${s.counts.unknownFound + s.counts.unknownAbsent}`, right: true },
        { head: 'run', get: (s) => s.parserInRun ? `${s.counts.kept}+${s.counts.dropped}` : '—', right: true },
        { head: 'age', get: (s) => s.reconAgeDays === null ? '—' : `${s.reconAgeDays}d`, right: true }
    ];
    const rows = report.sources.map((s) => columns.map((c) => String(c.get(s))));
    const widths = columns.map((c, i) => Math.max(c.head.length, ...rows.map((r) => r[i].length)));
    const line = (cells) => cells.map((cell, i) => pad(cell, widths[i], columns[i].right)).join('  ');
    const out = [line(columns.map((c) => c.head)), line(widths.map((w) => '-'.repeat(w)))];
    for (const row of rows) out.push(line(row));
    return out.join('\n');
}

function renderSummaryLines(report) {
    const t = report.totals;
    const verdictText = Object.keys(VERDICT_RANK).filter((v) => report.verdicts[v]).map((v) => `${v} ${report.verdicts[v]}`).join(', ');
    const lines = [
        `Run ${report.runId || '?'} (${report.runDay || 'day unknown'}) vs ${report.sources.length} expectation files — ${verdictText || 'nothing compared'}`,
        `expected ${t.expected}: exact ${t.exact}, fuzzy ${t.fuzzy}, missing upcoming ${t.missingUpcoming} (${t.missingUpcomingListed} site-listed), missing past ${t.missingPast}; leaked ${t.leaked}; extra ${t.extra}; unknown found ${t.unknownFound}/${t.unknownFound + t.unknownAbsent}`,
        'exp = expect.extracted:true rows (singles + listed occurrences); miss↑ dated on/after the run day (scraper-bug column), listed↑ = the part of it the site dated itself (not RRULE arithmetic), miss↓ before the run day; run = kept+bearDropped records; unk = "unknown" rows found/total.'
    ];
    if (report.parsersWithoutFile.length > 0) lines.push(`parsers in the run with no expectations file: ${report.parsersWithoutFile.join(', ')}`);
    return lines;
}

function renderVerbose(report) {
    const out = [];
    const recordText = (record) => record ? `${record.title} @ ${record.day}${record.bar ? ` / ${record.bar}` : ''} [${record.kind}]` : '';
    for (const s of report.sources) {
        out.push('');
        out.push(`## ${s.source} — ${s.verdict} (recon ${s.reconDate || '?'}, ${s.reconAgeDays === null ? '?' : s.reconAgeDays} days before the run; window ${s.window ? `${s.window.start}..${s.window.end}` : 'none'}; run records ${s.counts.kept} kept + ${s.counts.dropped} dropped${s.parserInRun ? '' : '; PARSER NOT IN RUN'})`);
        if (s.missing.length > 0) {
            out.push(`  missing, still upcoming (${s.missing.length}):`);
            for (const m of s.missing) out.push(`    - ${m.day}  ${m.title}${m.bar ? ` / ${m.bar}` : ''}  (${m.kind}${m.origin && m.origin !== 'single' ? `, ${m.origin}` : ''}; #${m.eventId})`);
        }
        if (s.missingPast.length > 0) {
            out.push(`  missing, already past (${s.missingPast.length}):`);
            for (const m of s.missingPast) out.push(`    - ${m.day}  ${m.title}${m.bar ? ` / ${m.bar}` : ''}  (#${m.eventId})`);
        }
        if (s.fuzzy.length > 0) {
            out.push(`  fuzzy (${s.fuzzy.length}):`);
            for (const f of s.fuzzy) out.push(`    - ${f.day}  expected "${f.title}" → run "${f.record.title}"${f.record.bar && f.record.bar !== f.bar ? ` / ${f.record.bar}` : ''} [${f.record.kind}]`);
        }
        if (s.leaked.length > 0) {
            out.push(`  leaked (${s.leaked.length}):`);
            for (const l of s.leaked) out.push(`    - ${l.what} ${l.id || l.eventId || ''} "${l.title}" — ${l.basis}; run: ${recordText(l.record)}${l.hitCount > 1 ? ` (+${l.hitCount - 1} more)` : ''}`);
        }
        if (s.extras.length > 0) {
            out.push(`  extracted but not expected (${s.extras.length}):`);
            for (const e of s.extras) out.push(`    - ${e.day}  ${e.title}${e.bar ? ` / ${e.bar}` : ''} [${e.kind}]`);
        }
        if (s.found.length > 0) {
            out.push(`  found exact (${s.found.length}):`);
            for (const f of s.found) out.push(`    - ${f.day}  ${f.title}${f.tier !== 'exact' ? ` (${f.tier})` : ''}${f.via !== 'own' ? ` via ${f.via}` : ''}${f.barDiffers ? ` (bar differs: expected "${f.bar}", run "${f.record.bar}")` : ''}`);
        }
        if (s.unknown.length > 0) {
            out.push(`  unknown (${s.counts.unknownFound} found / ${s.unknown.length}):`);
            for (const u of s.unknown) out.push(`    - ${u.day}  ${u.title}  ${u.tier ? `found (${u.tier})` : 'absent'}`);
        }
        const trapsExpected = s.traps.filter((t) => t.extracted === true);
        if (trapsExpected.length > 0) {
            out.push(`  traps that should be extracted (${s.counts.trapsExpectedFound} found / ${trapsExpected.length}):`);
            for (const t of trapsExpected) out.push(`    - ${t.hitCount > 0 ? 'found ' : 'absent'}  ${t.kind}  ${t.label}${t.hitCount > 0 ? ` — ${t.hits[0].basis}` : ''}`);
        }
        if (s.ruleCheck.unlisted.length > 0 || s.ruleCheck.unsupported > 0) {
            out.push(`  rule check: ${s.ruleCheck.checked} series expanded, ${s.ruleCheck.unsupported} unsupported shape(s), ${s.ruleCheck.unlisted.length} rule-predicted night(s) the file does not list${s.ruleCheck.unlisted.length > 0 ? `: ${s.ruleCheck.unlisted.slice(0, 8).map((u) => `${u.day} ${u.title}`).join('; ')}${s.ruleCheck.unlisted.length > 8 ? '; …' : ''}` : ''}`);
        }
        if (s.cancelledSkipped > 0) out.push(`  cancelled occurrences skipped: ${s.cancelledSkipped}`);
    }
    return out.join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
    const args = { run: '', json: '', sources: [], verbose: false, dir: DEFAULT_EXPECTATIONS_DIR, help: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const next = () => { i += 1; return argv[i]; };
        if (arg === '--run') args.run = String(next() || '');
        else if (arg === '--json') args.json = String(next() || '');
        else if (arg === '--source') args.sources.push(...String(next() || '').split(',').map((s) => s.trim()).filter(Boolean));
        else if (arg === '--dir') args.dir = String(next() || '');
        else if (arg === '--verbose' || arg === '-v') args.verbose = true;
        else if (arg === '--help' || arg === '-h') args.help = true;
        else throw new Error(`unknown argument: ${arg}`);
    }
    return args;
}

function main(argv = process.argv.slice(2)) {
    let args;
    try {
        args = parseArgs(argv);
    } catch (error) {
        console.error(error.message);
        return 0;
    }
    if (args.help) {
        console.log('node tools/source-expectations-diff.js [--run <path|runId>] [--source <name,…>] [--json <path>] [--verbose] [--dir <expectations dir>]');
        return 0;
    }
    let runPath;
    try {
        runPath = resolveRunPath(args.run);
    } catch (error) {
        console.error(error.message);
        return 0;
    }
    const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
    const docs = loadExpectations(args.dir);
    const report = diffAll(docs, run, { sources: args.sources, runName: path.basename(runPath, '.json') });
    report.runPath = runPath;
    console.log(`run file: ${runPath}`);
    console.log(renderSummaryLines(report).join('\n'));
    console.log('');
    console.log(renderTable(report));
    if (args.verbose) console.log(renderVerbose(report));
    if (args.json) {
        fs.mkdirSync(path.dirname(path.resolve(args.json)), { recursive: true });
        fs.writeFileSync(args.json, JSON.stringify(report, null, 2));
        console.log(`\nfull report: ${args.json}`);
    }
    return 0;
}

module.exports = {
    FUZZY_THRESHOLD,
    STALE_AFTER_DAYS,
    buildRunIndex,
    datesInText,
    diffAll,
    diffSource,
    loadCore,
    loadExpectations,
    materializeExpected,
    matchRow,
    newestRunFile,
    recordDays,
    renderSummaryLines,
    renderTable,
    renderVerbose,
    resolveRunPath,
    ruleCheck,
    runDayOf,
    slugify,
    sortWorstFirst,
    titleSimilarity,
    trapMatches,
    trapProbe,
    verdictFor
};

if (require.main === module) {
    process.exitCode = main();
}

#!/usr/bin/env node
// ============================================================================
// EVENT SHAPE — one report per deck card, and the low-risk classes built on it
// (Node-only; lives in tools/ so it NEVER ships to the phone).
// ============================================================================
// The owner swipes ~30 cards a day and a third of them are cards he approved
// every single time (measured 2026-11-11 on 969 swipes): another night of a
// party he already approved at the same venue, one night of a weekly series
// getting its own details, an update that changes neither the name nor the
// link. His worry about taking those off the stack was the SHAPE of what the
// scraper made: "a malformed title or image", "malformed other data too".
//
// So every card gets one structured report — assessShape — that says, check
// by check, whether the record is well formed and whether it looks like the
// nights of this party he approved before:
//
//   { ok, checks: [ { code, ok: true | false | null, detail } ], failed: [codes] }
//
// `ok: null` is "could not be checked" (no flyer text, no earlier night to
// compare with) and is never a failure. The report is page- and
// history-derived only: no list of parties, venues or sites lives here.
//
// The flyer is a witness: the words the OCR pass read off the image
// (storage/ocr, written by the pipeline) are compared with the record — a
// flyer that prints another date or another weekday is either stale artwork
// or a wrong event date, and both are worth his eyes.
//
// classifyLowRisk names the class of a card whose report is clean. The deck
// (review-queue.js buildDeck) shows those on their own tab as a grid, and —
// only for a class whose toggle the owner turned on (deck-settings.json) —
// approves them on his behalf, listed with an undo.
//
// Pure helpers are exported for scripts/event-shape.test.js.
// ============================================================================

'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const DECK_SETTINGS_FILE_NAME = 'deck-settings.json';

// The classes, in the order the deck lists them. `label` and `blurb` are
// what the owner reads next to the toggle.
const LOW_RISK_CLASSES = {
    repeat: { label: 'Repeat nights', blurb: 'another night of a party you approved, at the same venue' },
    'series-night': { label: 'Series nights', blurb: 'one night of a weekly series getting its own details' },
    'quiet-merge': { label: 'Quiet updates', blurb: 'an update that changes neither the name nor the link' }
};

// How far a night may sit from the party's approved nights and still read
// as "the usual": start time within 90 minutes, door within 300 metres.
const USUAL_START_TOLERANCE_MINUTES = 90;
const USUAL_PLACE_TOLERANCE_METERS = 300;
// A start before this local hour belongs to the night before (the flyer for
// a 1am start prints the previous day's date).
const AFTER_MIDNIGHT_HOUR = 6;
const FLYER_TEXT_MAX_CHARS = 6000;
const FLYER_INDEX_TTL_MS = 10 * 60 * 1000;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Full weekday names only: "sat", "sun" and "wed" are words and name fragments.
const FLYER_WEEKDAY_PATTERNS = WEEKDAY_NAMES.map((name, index) => [index, new RegExp(`\\b${name}s?\\b`, 'gi')]);
// Month words that are also ordinary words: a month only when a day number
// sits next to them (readFlyerOcrDates `withDay`).
const AMBIGUOUS_MONTH_TOKENS = new Set(['may', 'mar', 'mai', 'mars', 'sep', 'jan', 'dec', 'jun', 'jul']);

let flyerDateReader = null;
function getFlyerDateReader() {
    if (!flyerDateReader) {
        flyerDateReader = require(path.join(repoRoot, 'scripts', 'parsers', 'ai-web-parser')).readFlyerOcrDates;
    }
    return flyerDateReader;
}

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

// The wall-clock parts of an instant in a timezone, or null when either is
// unusable. weekday is 0 (Sunday) … 6.
function localParts(iso, timezone) {
    const date = new Date(iso);
    if (!iso || Number.isNaN(date.getTime())) return null;
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone || 'UTC', year: 'numeric', month: 'numeric', day: 'numeric',
            weekday: 'long', hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
        }).formatToParts(date);
        const read = (type) => (parts.find((part) => part.type === type) || {}).value;
        const hour = parseInt(read('hour'), 10) % 24;
        return {
            year: parseInt(read('year'), 10),
            month: parseInt(read('month'), 10),
            day: parseInt(read('day'), 10),
            weekday: WEEKDAY_NAMES.indexOf(read('weekday')),
            minutes: (hour * 60) + parseInt(read('minute'), 10)
        };
    } catch (_) {
        return null;
    }
}

function isValidTimezone(timezone) {
    if (typeof timezone !== 'string' || !timezone.trim()) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
        return true;
    } catch (_) {
        return false;
    }
}

function formatDay(parts) {
    return parts ? `${WEEKDAY_NAMES[parts.weekday] || ''} ${MONTH_NAMES[parts.month - 1]} ${parts.day}`.trim() : '';
}

function formatClock(minutes) {
    const hour = Math.floor(minutes / 60) % 24;
    const minute = minutes % 60;
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    return `${twelve}${minute ? `:${String(minute).padStart(2, '0')}` : ''}${hour < 12 ? 'am' : 'pm'}`;
}

function normalizeTitle(value) {
    return String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseCoords(location) {
    const match = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(String(location || ''));
    if (!match) return null;
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
    return { lat, lng };
}

function distanceMeters(a, b) {
    const rad = (deg) => (deg * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = (Math.sin(dLat / 2) ** 2) + (Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * (Math.sin(dLng / 2) ** 2));
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function parseHttpUrl(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    try {
        const url = new URL(text);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
    } catch (_) {
        return null;
    }
}

function hostOf(value) {
    const url = parseHttpUrl(value);
    return url ? url.hostname.replace(/^www\./, '').toLowerCase() : '';
}

// What is wrong with a name, in the owner's words, or '' when it reads as a
// name. Shape only — never whether it is the RIGHT name.
function describeTitleProblem(title) {
    const raw = typeof title === 'string' ? title : '';
    const text = raw.trim();
    if (!text) return 'there is no name';
    if (/[\r\n\t]/.test(raw)) return 'the name has a line break in it';
    if (text.length < 3) return `the name is only ${text.length} character${text.length === 1 ? '' : 's'}`;
    if (text.length > 140) return `the name is ${text.length} characters long`;
    if (/<\/?[a-z][^>]*>/i.test(text)) return 'the name has page markup in it';
    if (/&(?:[a-z]{2,8}|#\d{2,5});/i.test(text)) return 'the name has a page code in it (like &amp;)';
    if (/�|Ã[\u0080-¿©¨¡³±]|â€[\u0090-¿™œ“”˜]?/.test(text)) return 'the name has broken characters';
    if (/^(?:undefined|null|nan|none|untitled|title|event|events|tbd|tba|n\/a)$/i.test(text)) return `the name is a placeholder ("${text}")`;
    if (/^(?:https?:\/\/|www\.)\S+$/i.test(text)) return 'the name is a link';
    if (!/\p{L}/u.test(text)) return 'the name has no words';
    if (/(?:\.\.\.|…)$/.test(text)) return 'the name looks cut off (it ends with …)';
    if (/^[-–—|:•·,;/\\]/.test(text) || /[-–—|:•·,;/\\]$/.test(text)) return 'the name starts or ends with a separator';
    return '';
}

// The weekdays a flyer prints (0 = Sunday), each once.
function readFlyerWeekdays(ocrText) {
    const text = String(ocrText || '');
    const found = [];
    for (const [index, pattern] of FLYER_WEEKDAY_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(text)) found.push(index);
    }
    return found;
}

// The local days a flyer for this start could print: the start's own day,
// and the day before when the start is after midnight.
function localDayCandidates(startDate, timezone) {
    const start = localParts(startDate, timezone);
    if (!start) return [];
    const out = [start];
    if (start.minutes < AFTER_MIDNIGHT_HOUR * 60) {
        const previous = localParts(new Date(new Date(startDate).getTime() - (24 * 60 * 60 * 1000)).toISOString(), timezone);
        if (previous) out.push(previous);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Flyer text: storage/ocr indexed by image address
// ---------------------------------------------------------------------------

function stripQuery(url) {
    const text = String(url || '');
    const at = text.search(/[?#]/);
    return at === -1 ? text : text.slice(0, at);
}

// One cache file → { url, text, classification, summary } or null. The
// pipeline stores the OCR answer as a JSON string inside response.text.
function readFlyerCacheEntry(parsed) {
    if (!parsed || typeof parsed !== 'object' || typeof parsed.url !== 'string' || !parsed.url) return null;
    const raw = parsed.response && typeof parsed.response.text === 'string' ? parsed.response.text : '';
    let answer = null;
    try { answer = JSON.parse(raw); } catch (_) { answer = null; }
    if (!answer || typeof answer !== 'object') return null;
    return {
        url: parsed.url,
        cachedAt: typeof parsed.cachedAt === 'string' ? parsed.cachedAt : '',
        text: typeof answer.text === 'string' ? answer.text.slice(0, FLYER_TEXT_MAX_CHARS) : '',
        classification: typeof answer.imageClassification === 'string' ? answer.imageClassification : '',
        summary: typeof answer.eventSummary === 'string' ? answer.eventSummary.slice(0, 400) : ''
    };
}

// Every OCR answer the pipeline has kept, by image address (and by the
// address without its query, for CDNs that re-sign their links). Read-only;
// an unreadable file is skipped. ~17k files read in well under a second.
function buildFlyerTextIndex(sharedRoot, fsLike = fs) {
    const byUrl = new Map();
    const byBare = new Map();
    const ocrDir = path.join(sharedRoot, 'storage', 'ocr');
    let hosts = [];
    try { hosts = fsLike.readdirSync(ocrDir); } catch (_) { hosts = []; }
    for (const host of hosts) {
        if (host.startsWith('.')) continue;
        let names = [];
        try { names = fsLike.readdirSync(path.join(ocrDir, host)); } catch (_) { continue; }
        for (const name of names) {
            if (!name.endsWith('.json') || name.startsWith('.')) continue;
            let entry = null;
            try { entry = readFlyerCacheEntry(JSON.parse(fsLike.readFileSync(path.join(ocrDir, host, name), 'utf8'))); } catch (_) { entry = null; }
            if (!entry) continue;
            const keep = (map, key) => {
                const held = map.get(key);
                if (!held || String(entry.cachedAt) > String(held.cachedAt)) map.set(key, entry);
            };
            keep(byUrl, entry.url);
            keep(byBare, stripQuery(entry.url));
        }
    }
    return {
        size: byUrl.size,
        lookup(imageUrl) {
            const url = String(imageUrl || '');
            if (!url) return null;
            return byUrl.get(url) || byBare.get(stripQuery(url)) || null;
        }
    };
}

const flyerIndexCache = new Map();
function getFlyerTextIndex(sharedRoot, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const ttl = Number.isFinite(options.ttlMs) ? options.ttlMs : FLYER_INDEX_TTL_MS;
    const held = flyerIndexCache.get(sharedRoot);
    if (held && now - held.builtAt < ttl) return held.index;
    const index = buildFlyerTextIndex(sharedRoot);
    flyerIndexCache.set(sharedRoot, { builtAt: now, index });
    return index;
}

// ---------------------------------------------------------------------------
// Party history: what the owner approved before
// ---------------------------------------------------------------------------

// event|<party>|<venue>|<night> → "<party>|<venue>" ('' for other keys).
function partyOf(key) {
    const parts = String(key || '').split('|');
    return parts[0] === 'event' && parts.length >= 4 && parts[1] ? `${parts[1]}|${parts[2]}` : '';
}

// party → { approved: [snapshots], lastApprovedAt, lastNotBearAt }
function buildPartyHistory(decisions) {
    const map = new Map();
    for (const decision of Array.isArray(decisions) ? decisions : []) {
        if (!decision || typeof decision !== 'object') continue;
        if (decision.kind !== 'new' && decision.kind !== 'merge' && decision.kind !== 'override') continue;
        const party = partyOf(decision.key);
        if (!party) continue;
        const entry = map.get(party) || { approved: [], lastApprovedAt: '', lastNotBearAt: '' };
        const at = String(decision.stampedAt || '');
        if (decision.verdict === 'approve') {
            // An approval the deck made for him teaches nothing: "the usual"
            // is what HE approved, or a slow drift would approve itself.
            if (readLowRiskAutoClass(decision.reason)) continue;
            if (decision.snapshot && typeof decision.snapshot === 'object') entry.approved.push({ key: decision.key, ...decision.snapshot });
            if (at > entry.lastApprovedAt) entry.lastApprovedAt = at;
        } else if (decision.verdict === 'reject' && decision.reason && Array.isArray(decision.reason.tags) && decision.reason.tags.includes('not bear')) {
            if (at > entry.lastNotBearAt) entry.lastNotBearAt = at;
        }
        map.set(party, entry);
    }
    return map;
}

// The approved nights of this card's party, without the card's own night.
function historyFor(partyHistory, key) {
    const entry = partyHistory && partyHistory.get(partyOf(key));
    if (!entry) return { approved: [], standingNotBear: false };
    return {
        approved: entry.approved.filter((snapshot) => snapshot.key !== key),
        standingNotBear: Boolean(entry.lastNotBearAt) && entry.lastNotBearAt > entry.lastApprovedAt
    };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

// input: { proposal, sanityCodes, flags: [words], clashes: [words], flyer: { text, classification } | null,
//          history: { approved: [snapshots] }, now }
function assessShape(input = {}) {
    const proposal = input.proposal && typeof input.proposal === 'object' ? input.proposal : {};
    const kind = String(proposal.kind || '');
    const checks = [];
    const add = (code, ok, detail) => checks.push({ code, ok, detail: detail || '' });
    const now = Number.isFinite(input.now) ? input.now : Date.now();

    // -- well formed, whatever the party --------------------------------
    const titleProblem = describeTitleProblem(proposal.title);
    add('name', !titleProblem, titleProblem);

    const startMs = new Date(proposal.startDate).getTime();
    const endMs = proposal.endDate ? new Date(proposal.endDate).getTime() : NaN;
    const timezoneOk = isValidTimezone(proposal.timezone);
    const start = timezoneOk ? localParts(proposal.startDate, proposal.timezone) : null;
    if (Number.isNaN(startMs)) add('start', false, 'the start date cannot be read');
    else if (startMs > now + (550 * 24 * 60 * 60 * 1000)) add('start', false, 'the start is more than 18 months away');
    else add('start', true, '');
    if (proposal.endDate) {
        if (Number.isNaN(endMs)) add('end', false, 'the end date cannot be read');
        else if (!Number.isNaN(startMs) && endMs <= startMs) add('end', false, 'the end is not after the start');
        else if (!Number.isNaN(startMs) && !proposal.wholeDay && endMs - startMs > 24 * 60 * 60 * 1000 && kind !== 'series') {
            add('end', false, `it runs ${Math.round((endMs - startMs) / 3600000)} hours`);
        } else add('end', true, '');
    } else add('end', null, 'no end stated');
    add('timezone', timezoneOk, timezoneOk ? '' : `the timezone cannot be read ("${String(proposal.timezone || '')}")`);

    const coords = parseCoords(proposal.location);
    // A party with no named venue is real (a neighbourhood-level address);
    // one with no venue, no address and no map point is placed nowhere.
    const placed = String(proposal.bar || '').trim() || String(proposal.address || '').trim() || coords;
    add('venue', Boolean(placed), placed ? '' : 'there is no venue, address or map point');
    if (!String(proposal.location || '').trim()) add('place', null, 'no map point');
    else add('place', Boolean(coords), coords ? '' : `the map point cannot be read ("${String(proposal.location).slice(0, 40)}")`);
    add('city', Boolean(String(proposal.city || '').trim()), String(proposal.city || '').trim() ? '' : 'there is no city');

    for (const [code, field, label] of [['link', 'url', 'link'], ['ticket-link', 'ticketUrl', 'ticket link'], ['picture-link', 'image', 'picture address']]) {
        const value = String(proposal[field] || '').trim();
        // A picture in the owner's inbox has its own address scheme.
        if (!value) add(code, null, `no ${label}`);
        else if (field === 'image' && !/^https?:/i.test(value)) add(code, null, 'a picture from the inbox');
        else add(code, Boolean(parseHttpUrl(value)), parseHttpUrl(value) ? '' : `the ${label} is not a web address`);
    }

    // -- what the pipeline already flagged --------------------------------
    const sanityCodes = Array.isArray(input.sanityCodes) ? input.sanityCodes.filter(Boolean) : [];
    add('pipeline-flags', sanityCodes.length === 0, sanityCodes.length ? `the run flagged it: ${sanityCodes.join(', ')}` : '');
    const flags = Array.isArray(input.flags) ? input.flags.filter(Boolean) : [];
    add('held-back', flags.length === 0, flags.length ? `held back by the run: ${flags.join(', ')}` : '');
    // Two events in one room at one time, or a night taking another's
    // slot: the card already says so in a badge, and it is never low risk.
    const clashes = Array.isArray(input.clashes) ? input.clashes.filter(Boolean) : [];
    add('slot-clash', clashes.length === 0, clashes.length ? clashes.join('; ') : '');

    // -- the flyer as a witness -------------------------------------------
    const flyer = input.flyer && typeof input.flyer === 'object' ? input.flyer : null;
    const flyerText = flyer && typeof flyer.text === 'string' ? flyer.text : '';
    const days = timezoneOk ? localDayCandidates(proposal.startDate, proposal.timezone) : [];
    if (!String(proposal.image || '').trim()) {
        add('flyer-date', null, 'no picture');
        add('flyer-weekday', null, 'no picture');
        add('flyer-name', null, 'no picture');
    } else if (!flyer) {
        add('flyer-date', null, 'the picture has not been read');
        add('flyer-weekday', null, 'the picture has not been read');
        add('flyer-name', null, 'the picture has not been read');
    } else if (days.length === 0) {
        add('flyer-date', null, 'no local date to compare');
        add('flyer-weekday', null, 'no local date to compare');
        add('flyer-name', null, '');
    } else {
        const stated = getFlyerDateReader()(flyerText);
        const dayText = formatDay(days[0]);
        const months = stated.months.filter((entry) => entry.withDay || !AMBIGUOUS_MONTH_TOKENS.has(String(entry.token).toLowerCase()));
        const pairText = () => Array.from(new Set(stated.monthDays.map((pair) => `${MONTH_NAMES[pair.month - 1]} ${pair.day}`))).slice(0, 3).join(', ');
        const printsThisDay = days.some((day) => stated.monthDays.some((pair) => pair.month === day.month && pair.day === day.day));
        // "October 30 – November 1" on a weekend's flyer covers the nights
        // between: two or more printed days at most two weeks apart, with
        // this night inside them.
        const ordinal = (entry) => (entry.month * 31) + entry.day;
        const printed = stated.monthDays.map(ordinal);
        const spansThisDay = printed.length >= 2 && Math.max(...printed) - Math.min(...printed) <= 14
            && days.some((day) => ordinal(day) >= Math.min(...printed) && ordinal(day) <= Math.max(...printed));
        if (stated.monthDays.length > 0 && !printsThisDay && !spansThisDay) {
            add('flyer-date', false, `the flyer says ${pairText()}; this card is ${dayText}`);
        } else if (stated.monthDays.length === 0 && months.length > 0 && !days.some((day) => months.some((entry) => entry.month === day.month))) {
            add('flyer-date', false, `the flyer says ${Array.from(new Set(months.map((entry) => MONTH_NAMES[entry.month - 1]))).slice(0, 3).join(', ')}; this card is ${dayText}`);
        } else if (stated.monthDays.length > 0 && stated.years.length > 0 && !days.some((day) => stated.years.includes(day.year))) {
            // A year alone is a founding year, a title year, a copyright
            // line; next to a printed day it is the flyer's own year.
            add('flyer-date', false, `the flyer says ${pairText()} ${stated.years.slice(0, 2).join(', ')}; this card is in ${days[0].year}`);
        } else if (stated.monthDays.length > 0) {
            add('flyer-date', true, `the flyer says ${pairText()}`);
        } else add('flyer-date', null, 'the flyer prints no date');

        const weekdays = readFlyerWeekdays(flyerText);
        if (weekdays.length === 0) add('flyer-weekday', null, 'the flyer prints no weekday');
        else if (days.some((day) => weekdays.includes(day.weekday))) add('flyer-weekday', true, `the flyer says ${weekdays.map((index) => WEEKDAY_NAMES[index]).join(', ')}`);
        else add('flyer-weekday', false, `the flyer says ${weekdays.map((index) => WEEKDAY_NAMES[index]).join(', ')}; this card is a ${WEEKDAY_NAMES[days[0].weekday]}`);

        // Positive evidence only: a flyer that prints the party's name backs
        // the pairing of picture and event. A flyer without it proves
        // nothing (logos, photos, a venue's standing artwork).
        const titleWords = normalizeTitle(proposal.title).split(' ').filter((word) => word.length >= 4);
        const flyerWords = new Set(normalizeTitle(flyerText).split(' '));
        if (titleWords.length === 0 || flyerWords.size < 2) add('flyer-name', null, '');
        else if (titleWords.some((word) => flyerWords.has(word))) add('flyer-name', true, 'the flyer prints the name');
        else add('flyer-name', null, 'the flyer does not print the name');
    }

    // -- like the nights he approved (new cards) ---------------------------
    const approved = input.history && Array.isArray(input.history.approved) ? input.history.approved : [];
    if (kind === 'new' && approved.length > 0) {
        const title = normalizeTitle(proposal.title);
        add('usual-name', approved.some((night) => normalizeTitle(night.title) === title),
            approved.some((night) => normalizeTitle(night.title) === title) ? '' : `this exact name is new for the party (approved before: "${String(approved[approved.length - 1].title || '').slice(0, 60)}")`);

        const usualStarts = approved.map((night) => localParts(night.startDate, night.timezone || proposal.timezone)).filter(Boolean).map((parts) => parts.minutes);
        if (!start || usualStarts.length === 0) add('usual-time', null, '');
        else {
            const gap = Math.min(...usualStarts.map((minutes) => { const diff = Math.abs(minutes - start.minutes); return Math.min(diff, 1440 - diff); }));
            const usual = Array.from(new Set(usualStarts)).slice(-3).map(formatClock).join(', ');
            add('usual-time', gap <= USUAL_START_TOLERANCE_MINUTES, gap <= USUAL_START_TOLERANCE_MINUTES ? '' : `it starts at ${formatClock(start.minutes)}; the approved nights started at ${usual}`);
        }

        const usualPlaces = approved.map((night) => parseCoords(night.location)).filter(Boolean);
        if (!coords || usualPlaces.length === 0) add('usual-place', null, '');
        else {
            const gap = Math.min(...usualPlaces.map((place) => distanceMeters(place, coords)));
            add('usual-place', gap <= USUAL_PLACE_TOLERANCE_METERS, gap <= USUAL_PLACE_TOLERANCE_METERS ? '' : `the map point is ${gap >= 1000 ? `${(gap / 1000).toFixed(1)} km` : `${Math.round(gap)} m`} from the approved nights`);
        }

        const usualHosts = new Set(approved.map((night) => hostOf(night.url)).filter(Boolean));
        const host = hostOf(proposal.url);
        if (!host && usualHosts.size > 0) add('usual-link', false, 'the approved nights had a link; this one has none');
        else if (!host || usualHosts.size === 0) add('usual-link', null, '');
        else add('usual-link', usualHosts.has(host), usualHosts.has(host) ? '' : `the link goes to ${host}; the approved nights went to ${Array.from(usualHosts).slice(0, 2).join(', ')}`);

        const hadPictures = approved.some((night) => String(night.image || '').trim());
        if (String(proposal.image || '').trim()) add('usual-picture', true, '');
        else add('usual-picture', hadPictures ? false : null, hadPictures ? 'the approved nights had a picture; this one has none' : 'the party never had a picture');
    }

    // -- what an update changes (updates and series nights) ----------------
    const changes = proposal.changes && typeof proposal.changes === 'object' ? proposal.changes : {};
    if (kind === 'merge' || kind === 'override') {
        const emptied = Object.keys(changes).filter((field) => {
            const change = changes[field] || {};
            return String(change.from == null ? '' : change.from).trim() && !String(change.to == null ? '' : change.to).trim();
        });
        add('update-keeps-values', emptied.length === 0, emptied.length ? `the update empties: ${emptied.join(', ')}` : '');
        const fromPlace = changes.location ? parseCoords(changes.location.from) : null;
        const toPlace = changes.location ? parseCoords(changes.location.to) : null;
        if (fromPlace && toPlace) {
            const gap = distanceMeters(fromPlace, toPlace);
            add('update-place', gap <= USUAL_PLACE_TOLERANCE_METERS, gap <= USUAL_PLACE_TOLERANCE_METERS ? '' : `the update moves the map point ${gap >= 1000 ? `${(gap / 1000).toFixed(1)} km` : `${Math.round(gap)} m`}`);
        }
        if (changes.startDate && changes.startDate.from && changes.startDate.to) {
            const gapMinutes = Math.abs(new Date(changes.startDate.to).getTime() - new Date(changes.startDate.from).getTime()) / 60000;
            add('update-start', gapMinutes <= USUAL_START_TOLERANCE_MINUTES, gapMinutes <= USUAL_START_TOLERANCE_MINUTES ? '' : `the update moves the start by ${gapMinutes >= 120 ? `${Math.round(gapMinutes / 60)} hours` : `${Math.round(gapMinutes)} minutes`}`);
        }
        if (changes.description && String(changes.description.from || '').length >= 80
            && String(changes.description.to || '').length < String(changes.description.from).length / 2) {
            add('update-text', false, 'the update cuts the description to less than half');
        }
    }

    const failed = checks.filter((check) => check.ok === false).map((check) => check.code);
    return { ok: failed.length === 0, failed, checks };
}

// The lines a card shows: what failed, in words.
function shapeNotices(shape) {
    return shape && Array.isArray(shape.checks)
        ? shape.checks.filter((check) => check.ok === false && check.detail).map((check) => check.detail)
        : [];
}

// ---------------------------------------------------------------------------
// The classes
// ---------------------------------------------------------------------------

// The class of a card that may leave the stack, or null. A card with a
// failed check, a second look at a card he already decided, or a party he
// since called not bear is never low risk.
//
// `prior` is what the deck found decided before: on this very card (it
// changed since — his second look, always his), or on another night of the
// party (`prior.night`). The second is what a repeat night IS: the deck
// only shows such a night when it differs from the approved one (a new
// flyer, a new link), and the "usual" checks in the shape report are what
// judged the difference. A sibling he rejected last is not a repeat.
function classifyLowRisk(input = {}) {
    const proposal = input.proposal && typeof input.proposal === 'object' ? input.proposal : {};
    const shape = input.shape;
    if (!shape || shape.ok !== true) return null;
    const kind = String(proposal.kind || '');
    const prior = input.prior || null;
    const siblingApproved = Boolean(prior) && Boolean(prior.night) && prior.verdict === 'approve';
    if (prior && !(kind === 'new' && siblingApproved)) return null;
    const history = input.history || { approved: [] };
    const changes = proposal.changes && typeof proposal.changes === 'object' ? Object.keys(proposal.changes) : [];
    if (kind === 'new') {
        if (!Array.isArray(history.approved) || history.approved.length === 0 || history.standingNotBear) return null;
        return 'repeat';
    }
    if (kind === 'override') return 'series-night';
    if (kind === 'merge') {
        if (changes.length === 0 || changes.includes('title') || changes.includes('url')) return null;
        return 'quiet-merge';
    }
    return null;
}

// The words stored with an approval the deck made under a toggle, and the
// way back from those words to the class (the decided list, the digest and
// the history all read it from the stored decision).
const LOW_RISK_AUTO_REASON_PREFIX = 'auto: low risk';

function lowRiskAutoReasonText(cls) {
    return `${LOW_RISK_AUTO_REASON_PREFIX} (${cls})`;
}

function readLowRiskAutoClass(reason) {
    const text = reason && typeof reason === 'object' ? String(reason.text || '') : '';
    if (!text.startsWith(LOW_RISK_AUTO_REASON_PREFIX)) return null;
    const match = /\(([a-z-]+)\)\s*$/.exec(text);
    return match && Object.prototype.hasOwnProperty.call(LOW_RISK_CLASSES, match[1]) ? match[1] : null;
}

// ---------------------------------------------------------------------------
// The report for a whole deck (GET /review/shape.json)
// ---------------------------------------------------------------------------
// One row per card that has a shape report, pending or decided, plus the
// totals: how many passed, which checks fail most, how many cards each
// class holds. This is what a second reader (a person or a model) reads to
// judge the shape of a run without opening every card.
function buildShapeReport(deck) {
    const rows = [];
    const failed = {};
    const lowRisk = {};
    for (const cls of Object.keys(LOW_RISK_CLASSES)) lowRisk[cls] = 0;
    let passed = 0;
    const take = (entry, pending) => {
        if (!entry || !entry.shape || !Array.isArray(entry.shape.checks)) return;
        const proposal = entry.proposal || {};
        const auto = !pending && entry.decision ? readLowRiskAutoClass(entry.decision.reason) : null;
        if (entry.shape.ok) passed++;
        for (const code of entry.shape.failed || []) failed[code] = (failed[code] || 0) + 1;
        if (pending && entry.lowRisk) lowRisk[entry.lowRisk]++;
        rows.push({
            key: entry.key,
            kind: entry.kind,
            title: String(proposal.title || ''),
            startDate: proposal.startDate || null,
            timezone: proposal.timezone || null,
            venue: String(proposal.bar || ''),
            city: String(proposal.city || ''),
            source: String(proposal.source || ''),
            state: pending ? 'pending' : String(entry.decision && entry.decision.verdict || 'decided'),
            lowRisk: pending ? (entry.lowRisk || null) : null,
            pulledOut: pending ? (entry.lowRiskHeld || null) : null,
            approvedForYou: auto,
            ok: entry.shape.ok === true,
            failed: entry.shape.failed || [],
            // The checks that say something: a failure, or a fact the flyer
            // or the history confirmed. A silent pass is left out.
            checks: entry.shape.checks.filter((check) => check.ok === false || (check.ok === true && check.detail))
                .map((check) => ({ code: check.code, ok: check.ok, detail: check.detail }))
        });
    };
    for (const entry of (deck && Array.isArray(deck.cards) ? deck.cards : [])) take(entry, true);
    for (const entry of (deck && Array.isArray(deck.decided) ? deck.decided : [])) take(entry, false);
    return {
        runId: (deck && deck.runId) || null,
        summary: {
            cards: rows.length,
            passed,
            flagged: rows.length - passed,
            failedByCheck: Object.fromEntries(Object.entries(failed).sort((a, b) => b[1] - a[1])),
            lowRisk,
            auto: deck && deck.lowRisk ? deck.lowRisk.auto : emptyDeckSettings().auto
        },
        cards: rows
    };
}

// ---------------------------------------------------------------------------
// Settings: which classes are approved for him, and the cards he pulled out
// ---------------------------------------------------------------------------
// <sharedRoot>/deck-settings.json — the Mac is its only writer (the server,
// on the owner's tap); the phone never reads it. An approval made under a
// toggle is an ordinary decision in owner-decisions.json.
//   { version: 1, auto: { repeat, 'series-night', 'quiet-merge' }, held: { <key>: ISO } }

function getDeckSettingsPath(sharedRoot) {
    return path.join(sharedRoot, DECK_SETTINGS_FILE_NAME);
}

function emptyDeckSettings() {
    const auto = {};
    for (const cls of Object.keys(LOW_RISK_CLASSES)) auto[cls] = false;
    return { version: 1, auto, held: {} };
}

function normalizeDeckSettings(parsed) {
    const out = emptyDeckSettings();
    if (!parsed || typeof parsed !== 'object') return out;
    const auto = parsed.auto && typeof parsed.auto === 'object' ? parsed.auto : {};
    for (const cls of Object.keys(LOW_RISK_CLASSES)) out.auto[cls] = auto[cls] === true;
    const held = parsed.held && typeof parsed.held === 'object' && !Array.isArray(parsed.held) ? parsed.held : {};
    for (const key of Object.keys(held)) {
        if (typeof key === 'string' && key && typeof held[key] === 'string') out.held[key] = held[key];
    }
    return out;
}

function loadDeckSettings(sharedRoot) {
    try {
        const file = getDeckSettingsPath(sharedRoot);
        if (!fs.existsSync(file)) return emptyDeckSettings();
        return normalizeDeckSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (error) {
        console.warn(`event-shape: deck settings unreadable (${error.message}) — every toggle reads as off`);
        return emptyDeckSettings();
    }
}

// A pulled-out card is remembered until its night has passed.
function pruneHeld(held, now = Date.now()) {
    const out = {};
    const cutoff = new Date(now - (2 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
    for (const key of Object.keys(held || {})) {
        const night = /(\d{4}-\d{2}-\d{2})$/.exec(key);
        if (night && night[1] < cutoff) continue;
        out[key] = held[key];
    }
    return out;
}

function saveDeckSettings(sharedRoot, settings, now = Date.now()) {
    const normalized = normalizeDeckSettings(settings);
    normalized.held = pruneHeld(normalized.held, now);
    const file = getDeckSettingsPath(sharedRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmpPath = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2));
    fs.renameSync(tmpPath, file);
    return normalized;
}

// One change from the page: { auto: { <class>: bool } }, { hold: key },
// { release: key }. Unknown classes and empty keys are refused.
function applyDeckSettingsChange(settings, change, now = Date.now()) {
    const next = normalizeDeckSettings(settings);
    if (!change || typeof change !== 'object') throw new Error('a settings change must be an object');
    let touched = false;
    if (change.auto && typeof change.auto === 'object') {
        for (const cls of Object.keys(change.auto)) {
            if (!Object.prototype.hasOwnProperty.call(LOW_RISK_CLASSES, cls)) throw new Error(`"${cls}" must be one of ${Object.keys(LOW_RISK_CLASSES).join(', ')}`);
            next.auto[cls] = change.auto[cls] === true;
            touched = true;
        }
    }
    for (const key of [].concat(change.hold || [])) {
        if (typeof key !== 'string' || !key.trim()) throw new Error('hold needs a key');
        next.held[key.trim()] = new Date(now).toISOString();
        touched = true;
    }
    for (const key of [].concat(change.release || [])) {
        if (typeof key !== 'string' || !key.trim()) throw new Error('release needs a key');
        delete next.held[key.trim()];
        touched = true;
    }
    if (!touched) throw new Error('a settings change needs auto, hold or release');
    return next;
}

module.exports = {
    DECK_SETTINGS_FILE_NAME,
    LOW_RISK_CLASSES,
    USUAL_START_TOLERANCE_MINUTES,
    USUAL_PLACE_TOLERANCE_METERS,
    localParts,
    normalizeTitle,
    parseCoords,
    distanceMeters,
    describeTitleProblem,
    readFlyerWeekdays,
    localDayCandidates,
    readFlyerCacheEntry,
    buildFlyerTextIndex,
    getFlyerTextIndex,
    partyOf,
    buildPartyHistory,
    historyFor,
    assessShape,
    shapeNotices,
    classifyLowRisk,
    lowRiskAutoReasonText,
    readLowRiskAutoClass,
    buildShapeReport,
    getDeckSettingsPath,
    emptyDeckSettings,
    normalizeDeckSettings,
    loadDeckSettings,
    saveDeckSettings,
    applyDeckSettingsChange,
    pruneHeld
};

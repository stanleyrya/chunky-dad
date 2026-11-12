#!/usr/bin/env node
// ============================================================================
// SHAPE READER — a second reader (the local text model) over one deck card
// (Node-only; lives in tools/ so it NEVER ships to the phone).
// ============================================================================
// The fixed checks in tools/event-shape.js catch what a rule can name: a
// name that is a button, a flyer that prints another date. What they miss
// is what a person sees at a glance — a name cut off mid-word, a page
// heading used as a name, a flyer whose door time is not the record's, an
// update that swaps a real name for another party's (owner 2026-11-11: "add
// checks wherever possible and make it easier for ai to validate the shape
// of events overall").
//
// So the model proofreads the record as the card shows it — name, start,
// venue, address, description, the flyer's own text, the changes an update
// makes — and may name a problem only with words copied from that record.
// A problem whose quote is not in the record is thrown away, and so is one
// that only says a value is fine.
//
// What an answer does (measured 2026-11-11 on 273 records: it found 11 of
// 37 cards the owner had sent back for their data, the fixed checks 7; a
// third to half of its flags are noise):
//   - a line on the card, marked as the reader's and fallible
//   - the card is not low risk (it stays on the stack for his own eyes)
//   - a card nobody has read yet is never approved under a switch
// It never blocks, drops or changes a record.
//
// Answers are kept by the record's own text in <server dir>/shape-reader.json
// (local to the Mac, never iCloud): the same card on tomorrow's deck is not
// asked again. The server asks in the background, one record at a time.
//
// Pure helpers are exported for scripts/shape-reader.test.js.
// ============================================================================

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Bump when the prompt or the record text changes: old answers are then
// answers to another question and are asked again.
const READER_VERSION = 1;
const READER_CACHE_FILE_NAME = 'shape-reader.json';
const READER_CACHE_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;
const READER_FIELDS = ['name', 'date', 'time', 'place', 'change'];
const READER_CARD_KINDS = ['new', 'merge', 'override'];
const READER_TEXT_MAX_CHARS = 1200;
const READER_TIMEOUT_MS = 120000;
// After a failed request nothing is asked for this long: a server that is
// down is not hammered by every deck view.
const READER_RETRY_AFTER_MS = 5 * 60 * 1000;

const READER_SYSTEM_PROMPT = [
    'You proofread ONE record of a nightlife events calendar before it is saved.',
    'You do not judge whether the event is good or belongs on the calendar. You only look for a record that is malformed or that disagrees with itself.',
    'Look for exactly these problems:',
    '- name: the name is not the name of an event. It is a button or menu label (such as a "load more" or "buy tickets" control), a page heading, a question or slogan, a line that only says a venue is open tonight, an opening-hours notice, or a word cut off mid-way.',
    '- date: the description or the flyer text states a date or weekday for THIS event that differs from the record\'s start day.',
    '- time: the description or the flyer text states a start or end time for THIS event that differs from the record\'s start or end time by more than 30 minutes.',
    '- place: the description or the flyer text gives a different street address, or a clearly different venue or city, than the record. The same venue written a little differently is not a problem.',
    '- change: for an update, the new name or venue is plainly worse than the saved one: a real name replaced by a fragment, by a different party\'s name or by page furniture; a real venue replaced by a street, a sentence or a placeholder. A shorter name that only drops the venue is fine.',
    'Flyer text was read by a machine from a picture: it is noisy, may list other events and other dates, and may be an old flyer. Only use a flyer line that clearly speaks about this event.',
    'A missing field is not a problem. Do not report links, map coordinates, style, emoji, capital letters or a short description.',
    'If two values agree, that is not a problem: leave it out. Never list something only to say it is fine.',
    'Every problem needs a quote: the exact words, copied from the record, that show it. No quote, no problem.',
    'Answer with JSON only: {"problems":[{"field":"name|date|time|place|change","problem":"one short plain sentence","quote":"exact words from the record"}]}',
    'Answer {"problems":[]} when the record is fine. Most records are fine.'
].join('\n');

// A "problem" that says there is none (the model listing what it checked).
const SAYS_IT_IS_FINE = /no (time |date |place |name )?(problem|discrepancy|mismatch|issue)|not a (problem|mismatch|discrepancy)|this matches|is consistent|not (plainly )?worse|is better|an improvement|is acceptable|is fine\b/i;
// The fields of an update the reader is not shown: it is told not to judge
// links, map points or pictures, and a description change is in the
// description it already reads.
const UNREAD_CHANGE_FIELDS = new Set(['location', 'url', 'ticketUrl', 'image', 'cover', 'description']);

function readerClock(iso, timezone) {
    if (!iso) return '';
    try {
        return new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
    } catch (_) {
        return String(iso);
    }
}

// The record as the model reads it: the card's own fields, in words.
function buildReaderRecord(proposal, flyer) {
    const p = proposal && typeof proposal === 'object' ? proposal : {};
    const lines = [];
    lines.push(`kind: ${p.kind === 'new' ? 'a new event' : 'an update to a saved event'}`);
    lines.push(`name: ${p.title || ''}`);
    const startClock = readerClock(p.startDate, p.timezone);
    const endClock = readerClock(p.endDate, p.timezone);
    const wholeDay = / 12:00 AM$/.test(startClock) && (!p.endDate || / 11:59 PM$/.test(endClock));
    if (wholeDay) {
        lines.push(`starts: ${startClock.replace(/ at 12:00 AM$/, '')} (no time of day is known for this record)`);
    } else {
        lines.push(`starts: ${startClock} (${p.timezone || 'no timezone'})`);
        if (p.endDate) lines.push(`ends: ${endClock}`);
    }
    lines.push(`venue: ${p.bar || ''}`);
    lines.push(`address: ${p.address || ''}`);
    lines.push(`city: ${p.city || ''}`);
    lines.push(`description: """${String(p.description || '').slice(0, READER_TEXT_MAX_CHARS)}"""`);
    if (flyer && flyer.text) lines.push(`flyer text: """${String(flyer.text).slice(0, READER_TEXT_MAX_CHARS)}"""`);
    const changes = p.changes && typeof p.changes === 'object' ? p.changes : null;
    const shown = changes ? Object.keys(changes).filter((field) => !UNREAD_CHANGE_FIELDS.has(field)) : [];
    if (shown.length > 0) {
        lines.push('changes this update makes to the saved event:');
        for (const field of shown) {
            const change = changes[field] || {};
            const isDate = field === 'startDate' || field === 'endDate';
            const from = isDate ? readerClock(change.from, p.timezone) : String(change.from == null ? '' : change.from).slice(0, 300);
            const to = isDate ? readerClock(change.to, p.timezone) : String(change.to == null ? '' : change.to).slice(0, 300);
            lines.push(`  ${field}: saved "${from}" becomes "${to}"`);
        }
    }
    return lines.join('\n');
}

function readerKey(recordText) {
    return crypto.createHash('sha1').update(`${READER_VERSION}\n${recordText}`).digest('hex');
}

const squash = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// { usable, problems: [{ field, problem, quote }] } — only problems the
// record itself backs: a known field, a quote of 3+ characters that occurs
// in the record text, and words that state a problem.
function parseReaderAnswer(raw, recordText) {
    const text = String(raw || '');
    let parsed = null;
    try {
        parsed = JSON.parse(text.replace(/^\s*```(?:json)?|```\s*$/g, '').trim());
    } catch (_) {
        const match = text.match(/\{[\s\S]*\}/);
        try { parsed = match ? JSON.parse(match[0]) : null; } catch (__) { parsed = null; }
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.problems)) return { usable: false, problems: [] };
    const haystack = squash(recordText);
    const seen = new Set();
    const problems = [];
    for (const item of parsed.problems) {
        if (!item || typeof item !== 'object') continue;
        const field = String(item.field || '').trim().toLowerCase();
        const problem = String(item.problem || '').trim();
        const quote = String(item.quote || '').trim();
        if (!READER_FIELDS.includes(field) || !problem || SAYS_IT_IS_FINE.test(problem)) continue;
        const needle = squash(quote);
        if (needle.length < 3 || !haystack.includes(needle)) continue;
        if (seen.has(field)) continue;
        seen.add(field);
        problems.push({ field, problem: problem.slice(0, 240), quote: quote.slice(0, 160) });
    }
    return { usable: true, problems };
}

// The run's own AI settings (payload.config.config.ai): the reader asks the
// model the pipeline asked. Null when the run had no chat-completions model.
function resolveReaderAi(payload) {
    const ai = payload && payload.config && payload.config.config && payload.config.config.ai;
    if (!ai || typeof ai !== 'object' || ai.enabled === false) return null;
    const endpoint = String(ai.endpoint || '').trim();
    const model = String(ai.model || '').trim();
    if (!endpoint || !model || !/\/chat\/completions$/.test(endpoint)) return null;
    return { endpoint, model };
}

function loadReaderCache(cachePath, fsLike = fs) {
    try {
        const parsed = JSON.parse(fsLike.readFileSync(cachePath, 'utf8'));
        if (parsed && parsed.version === 1 && parsed.entries && typeof parsed.entries === 'object') return parsed.entries;
    } catch (_) { /* no file yet, or unreadable: start empty */ }
    return {};
}

function saveReaderCache(cachePath, entries, now = Date.now(), fsLike = fs) {
    const kept = {};
    for (const [key, entry] of Object.entries(entries)) {
        const readAt = new Date(entry && entry.readAt).getTime();
        if (Number.isFinite(readAt) && now - readAt <= READER_CACHE_MAX_AGE_MS) kept[key] = entry;
    }
    fsLike.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmpPath = `${cachePath}.tmp`;
    fsLike.writeFileSync(tmpPath, JSON.stringify({ version: 1, entries: kept }));
    fsLike.renameSync(tmpPath, cachePath);
    return kept;
}

// options: { cachePath, ai: { endpoint, model } | null, fetchImpl, now: () => ms, log, fsLike }
//   lookup(proposal, flyer) — sync: { problems } when read, null when not
//     yet (the record is queued) or when the model's answer could not be
//     read, undefined when the reader is off or the card is not one it
//     reads.
//   drain() — asks the queue, one record at a time; resolves when empty.
//     Safe to call on every deck view: one drain runs at a time.
function createShapeReader(options = {}) {
    const fsLike = options.fsLike || fs;
    const cachePath = options.cachePath || null;
    const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    const clockNow = typeof options.now === 'function' ? options.now : () => Date.now();
    const log = typeof options.log === 'function' ? options.log : () => {};
    let ai = options.ai || null;
    let entries = cachePath ? loadReaderCache(cachePath, fsLike) : {};
    const queue = new Map();
    let draining = null;
    let failedAt = 0;
    const stats = { asked: 0, flagged: 0, failed: 0 };

    const lookup = (proposal, flyer) => {
        if (!ai || !fetchImpl || !proposal || !READER_CARD_KINDS.includes(String(proposal.kind || ''))) return undefined;
        const text = buildReaderRecord(proposal, flyer);
        const key = readerKey(text);
        const entry = entries[key];
        // An answer that could not be read stays "not read": the same words
        // would get the same answer, so it is not asked again, and nothing
        // is approved under a switch on the strength of it.
        if (entry && entry.unusable) return null;
        if (entry && Array.isArray(entry.problems)) return { problems: entry.problems };
        if (!queue.has(key)) queue.set(key, text);
        return null;
    };

    const askOne = async (text) => {
        const body = {
            model: ai.model,
            temperature: 0,
            max_tokens: 500,
            response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: READER_SYSTEM_PROMPT }, { role: 'user', content: `RECORD\n${text}` }]
        };
        const response = await fetchImpl(ai.endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(READER_TIMEOUT_MS) : undefined
        });
        if (!response.ok) throw new Error(`the model answered HTTP ${response.status}`);
        const json = await response.json();
        const raw = json && json.choices && json.choices[0] && json.choices[0].message ? json.choices[0].message.content : '';
        return parseReaderAnswer(raw, text);
    };

    const drain = () => {
        if (draining) return draining;
        if (!ai || !fetchImpl || queue.size === 0) return Promise.resolve(stats);
        if (failedAt && clockNow() - failedAt < READER_RETRY_AFTER_MS) return Promise.resolve(stats);
        draining = (async () => {
            let read = 0;
            try {
                while (queue.size > 0) {
                    const [key, text] = queue.entries().next().value;
                    let answer;
                    try {
                        answer = await askOne(text);
                    } catch (error) {
                        // The model is down or slow: stop, keep the queue, try
                        // again on a later deck view. Nothing is guessed.
                        failedAt = clockNow();
                        stats.failed += 1;
                        log(`Shape reader: stopped with ${queue.size} record(s) unread — ${error.message}`);
                        break;
                    }
                    queue.delete(key);
                    failedAt = 0;
                    stats.asked += 1;
                    // An answer that cannot be read is stored too (lookup keeps
                    // calling it unread): asking the same words again gives the
                    // same answer.
                    entries[key] = { readAt: new Date(clockNow()).toISOString(), problems: answer.problems, ...(answer.usable ? {} : { unusable: true }) };
                    if (answer.problems.length > 0) stats.flagged += 1;
                    read += 1;
                    if (cachePath && read % 10 === 0) entries = saveReaderCache(cachePath, entries, clockNow(), fsLike);
                }
                if (cachePath && read > 0) entries = saveReaderCache(cachePath, entries, clockNow(), fsLike);
                if (read > 0) log(`Shape reader: read ${read} record(s); ${stats.flagged} flagged so far`);
            } finally {
                draining = null;
            }
            return stats;
        })();
        return draining;
    };

    return {
        lookup,
        drain,
        setAi(next) { ai = next || null; },
        pending: () => queue.size,
        stats: () => ({ ...stats, pending: queue.size })
    };
}

module.exports = {
    READER_VERSION,
    READER_CACHE_FILE_NAME,
    READER_FIELDS,
    READER_CARD_KINDS,
    READER_SYSTEM_PROMPT,
    READER_RETRY_AFTER_MS,
    buildReaderRecord,
    readerKey,
    parseReaderAnswer,
    resolveReaderAi,
    loadReaderCache,
    saveReaderCache,
    createShapeReader
};

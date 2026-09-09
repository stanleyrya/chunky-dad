// ============================================================================
// AI EVAL — pure logic for the local-model evaluation harness
// ============================================================================
// Replays REAL prompts (harvested from the scraper's own AI response cache)
// against a local rapid-mlx server and scores what comes back, so a model or
// server-setting change can be judged on evidence instead of vibes.
//
// Three scores per case, deliberately kept apart:
//
//   accepted  — would PRODUCTION's own gate have taken this answer? Five passes
//               already enforce verbatim/substring rules (merge-arbitration,
//               field-trim, short-name, segment-boundaries, bear-check quotes),
//               so this is objective and needs no golden data at all.
//   agreement — does it match what the model that filled the cache said?
//               This is DRIFT, not correctness: the cached answer is an older
//               model's output, not ground truth. Never report it as accuracy.
//   accuracy  — vs a human-blessed `expected`. Only present on blessed cases.
//
// This module does NO network I/O and starts no servers; tools/ai-eval.js owns
// the transport, the corpus paths and the CLI. Scorers here take (case, text)
// and are pure, which is what makes them unit-testable offline.
//
// IMPORTANT: the gates are REUSED from production (SharedCore), never
// reimplemented — a copied gate would drift from the real one and quietly
// score answers production would reject. Prompts are replayed byte-for-byte;
// nothing here may edit a prompt (that would invalidate the scraper's cache
// repo-wide).
// ============================================================================

const fs = require('fs');
const path = require('path');

const PASSES = [
    'extraction',
    'ocr',
    'context-prep',
    'bear-check',
    'merge-arbitration',
    'classify-page',
    'short-name',
    'field-trim',
    'segment-boundaries'
];

// Per-pass completion caps, mirroring the production call sites so a replay
// costs the model exactly what the real request would.
const PASS_NUM_PREDICT = {
    'extraction': 2000,
    'ocr': 2000,
    'context-prep': 2000,
    'bear-check': 400,
    'merge-arbitration': 800,
    'classify-page': 300,
    'short-name': 200,
    'field-trim': 200,
    'segment-boundaries': 1200
};

const OCR_CLASSIFICATIONS = new Set([
    'ad-banner', 'event-flyer', 'multi-event-flyer', 'logo', 'thumbnail', 'hero-banner'
]);

const PAGE_CLASSIFICATIONS = new Set([
    'event-page', 'multi-event-page', 'link-aggregator', 'ad', 'unknown'
]);

const BEAR_VERDICTS = new Set(['bear', 'not_bear', 'unsure']);

// Extraction fields whose value must appear VERBATIM in the source material.
// Everything else the prompt asks for is normalised or derived on the way out,
// so its absence from the prompt proves nothing.
const LITERAL_COPY_FIELDS = new Set([
    'title', 'name', 'bar', 'venue', 'description', 'desc',
    'address', 'addr', 'cover', 'short', 'shortname'
]);

// ---------------------------------------------------------------------------
// Production gates
// ---------------------------------------------------------------------------

// SharedCore needs a cities object and an event schema; this mirrors the wiring
// in calendar-contract.test.js. An under-wired instance fails OPEN and would
// manufacture false results, so build it the same way the tests do.
function createGates() {
    const { SharedCore } = require('./shared-core');
    const { EventSchema } = require('./event-schema');
    // scraper-cities.js exports the city map itself (not a `.cities` key) —
    // the same shape normalizers.test.js passes straight through.
    const cities = require('./scraper-cities');
    const core = new SharedCore(cities, { eventSchema: EventSchema });
    return { core };
}

// ---------------------------------------------------------------------------
// Response parsing (same tolerance ladder production uses)
// ---------------------------------------------------------------------------

function parseJsonLoose(text, gates) {
    const raw = String(text === null || text === undefined ? '' : text).trim();
    if (!raw) return { ok: false, value: null, reason: 'empty response' };
    try {
        return { ok: true, value: JSON.parse(raw), reason: 'direct' };
    } catch (_) { /* fall through */ }
    // Arrays (context-prep answers with one) are not covered by
    // extractFirstJsonObject, which scans from the first '{'.
    const firstBracket = raw.indexOf('[');
    const firstBrace = raw.indexOf('{');
    if (firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace)) {
        const lastBracket = raw.lastIndexOf(']');
        if (lastBracket > firstBracket) {
            try {
                return { ok: true, value: JSON.parse(raw.slice(firstBracket, lastBracket + 1)), reason: 'array-slice' };
            } catch (_) { /* fall through */ }
        }
    }
    if (gates && gates.core && typeof gates.core.extractFirstJsonObject === 'function') {
        const extracted = gates.core.extractFirstJsonObject(raw);
        if (extracted) {
            try {
                return { ok: true, value: JSON.parse(extracted), reason: 'brace-scan' };
            } catch (_) { /* fall through */ }
        }
    }
    return { ok: false, value: null, reason: 'unparseable' };
}

// ---------------------------------------------------------------------------
// Prompt readers — every scorer's ground rules live in the prompt itself, which
// is why a case needs nothing but its prompt to be scored.
// ---------------------------------------------------------------------------

// "- field: title\n  version-one: \"A\"\n  version-two: \"B\"" blocks.
function parseArbitrationConflicts(prompt) {
    const out = [];
    const re = /^- field: (.+)\n {2}version-one: "([\s\S]*?)"\n {2}version-two: "([\s\S]*?)"$/gm;
    let m;
    while ((m = re.exec(String(prompt))) !== null) {
        out.push({ field: m[1].trim(), one: m[2], two: m[3] });
    }
    return out;
}

// Swap the two candidate values in place, keeping the slot LABELS where they
// are. Re-running a case through this and comparing which CONTENT wins is how
// position bias is measured without any golden data.
function swapArbitrationPrompt(prompt) {
    return String(prompt).replace(
        /^(- field: .+\n {2}version-one: ")([\s\S]*?)("\n {2}version-two: ")([\s\S]*?)(")$/gm,
        (_all, head, one, mid, two, tail) => head + two + mid + one + tail
    );
}

// The trim pass has had TWO prompt shapes. The live one (buildFieldTrimPrompt,
// shared-core.js) presents the value pre-split into numbered PARTS and asks for
// a RANGE — the model never writes text, which makes the answer verbatim and
// within-limit by construction. The older shape handed over the raw value and
// asked for a substring; entries from it are still in the cache and are what a
// naive harvest picks up. Both are read here so a stale case scores honestly
// rather than silently reporting "no fields found".
function parseTrimFields(prompt) {
    const text = String(prompt);
    const out = [];
    const legacy = /^- field: (.+)\n {2}max_chars: (\d+)\n {2}value: "([\s\S]*?)"$/gm;
    let m;
    while ((m = legacy.exec(text)) !== null) {
        out.push({ shape: 'text', field: m[1].trim(), maxChars: Number(m[2]), value: m[3] });
    }
    if (out.length > 0) return out;

    // FIELD: description — limit 600 characters, currently 679
    // PARTS (6):
    // 1. (174 chars) "…"
    const headers = /^FIELD: (.+?) — limit (\d+) characters, currently (\d+)$/gm;
    let header;
    while ((header = headers.exec(text)) !== null) {
        const rest = text.slice(header.index + header[0].length);
        const countMatch = /^\nPARTS \((\d+)\):/.exec(rest);
        if (!countMatch) continue;
        const partChars = [];
        const partLine = /^(\d+)\. \((\d+) chars\) /gm;
        let part;
        const block = rest.slice(0, rest.indexOf('\nFIELD: ') === -1 ? rest.length : rest.indexOf('\nFIELD: '));
        while ((part = partLine.exec(block)) !== null) partChars.push(Number(part[2]));
        out.push({
            shape: 'parts',
            field: header[1].trim(),
            maxChars: Number(header[2]),
            originalLength: Number(header[3]),
            partCount: Number(countMatch[1]),
            partChars
        });
    }
    return out;
}

function parseShortNameTitle(prompt) {
    const m = /^TITLE: (.+)$/m.exec(String(prompt));
    return m ? m[1] : '';
}

function parseSegmentLines(prompt) {
    const text = String(prompt);
    const start = text.indexOf('PAGE LINES (one per line, exactly as extracted):');
    if (start < 0) return [];
    const after = text.slice(start).split('\n').slice(1);
    const lines = [];
    for (const line of after) {
        if (line.startsWith('TASK:')) break;
        if (line.trim() === '') continue;
        lines.push(line);
    }
    return lines;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function normalizeForCompare(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function tokenize(value) {
    return normalizeForCompare(value).split(/[^a-z0-9]+/).filter(Boolean);
}

// Multiset token F1 — a repeated word counts as many times as it appears, so
// OCR that drops one of three "BEAR"s is scored as a partial miss.
function tokenF1(a, b) {
    const left = tokenize(a);
    const right = tokenize(b);
    if (left.length === 0 && right.length === 0) return 1;
    if (left.length === 0 || right.length === 0) return 0;
    const counts = new Map();
    for (const t of left) counts.set(t, (counts.get(t) || 0) + 1);
    let overlap = 0;
    for (const t of right) {
        const n = counts.get(t) || 0;
        if (n > 0) { overlap += 1; counts.set(t, n - 1); }
    }
    const precision = overlap / right.length;
    const recall = overlap / left.length;
    if (precision + recall === 0) return 0;
    return (2 * precision * recall) / (precision + recall);
}

// Does this claimed value actually occur in the material the model was given?
// Approximates production's evidence gate well enough to rank models on
// invention, which is the failure mode that silently corrupts the calendar.
function occursInPrompt(prompt, value) {
    const needle = normalizeForCompare(value);
    if (!needle) return true;
    return normalizeForCompare(prompt).includes(needle);
}

// ---------------------------------------------------------------------------
// Scorers
// ---------------------------------------------------------------------------
// Each returns { accepted, acceptDetail, agreement, agreementDetail }.
// `agreement` is null when there is nothing comparable to measure against.

function scoreExtraction(kase, parsed, baselineParsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { accepted: false, acceptDetail: 'not an object', agreement: null };
    }
    const prompt = kase.prompt;
    let kept = 0;
    let invented = 0;
    const inventedFields = [];
    for (const [field, entry] of Object.entries(parsed)) {
        if (!entry || typeof entry !== 'object') continue;
        const value = entry.value;
        const confidence = Number(entry.confidence);
        if (value === '' || value === null || value === undefined) continue;
        if (!Number.isFinite(confidence) || confidence < 50) continue;
        kept += 1;
        // Only fields the model is required to COPY can be checked by looking
        // for the value in the prompt. Dates and times are emitted as ISO/24h
        // ("13 Aug" -> "2026-08-13"), city is canonicalised ("Eagle LA" ->
        // "los angeles"), and URLs/coordinates are reformatted — a literal
        // search flags every one of those as invented when they are correct.
        // Production's real evidence gate (validateAiEventEvidence) handles
        // them with per-field logic and a page-wide evidence context that a
        // bare prompt cannot supply, so this stays deliberately narrow:
        // prose and names only, where a false positive is not possible.
        if (!LITERAL_COPY_FIELDS.has(String(field).toLowerCase())) continue;
        if (!occursInPrompt(prompt, value)) {
            invented += 1;
            inventedFields.push(field);
        }
    }
    // Acceptance here is about INVENTION, not yield. An empty answer is a
    // legitimate outcome — plenty of snippets genuinely carry no event fields,
    // and production simply gets nothing from them. What must never happen is
    // a confident value the source never contained, so that is what is scored;
    // yield is reported separately as keptFields.
    const accepted = invented === 0;
    let agreement = null;
    let agreementDetail = '';
    if (baselineParsed && typeof baselineParsed === 'object' && !Array.isArray(baselineParsed)) {
        const fields = new Set([...Object.keys(parsed), ...Object.keys(baselineParsed)]);
        let compared = 0;
        let same = 0;
        for (const field of fields) {
            const a = parsed[field] && typeof parsed[field] === 'object' ? parsed[field].value : undefined;
            const b = baselineParsed[field] && typeof baselineParsed[field] === 'object' ? baselineParsed[field].value : undefined;
            const aEmpty = a === undefined || a === null || a === '';
            const bEmpty = b === undefined || b === null || b === '';
            if (aEmpty && bEmpty) continue;
            compared += 1;
            if (normalizeForCompare(a) === normalizeForCompare(b)) same += 1;
        }
        agreement = compared === 0 ? 1 : same / compared;
        agreementDetail = same + '/' + compared + ' fields';
    }
    return {
        accepted,
        acceptDetail: accepted
            ? kept + ' fields >=50 confidence, none invented'
            : invented + ' invented (' + inventedFields.join(', ') + ')',
        agreement,
        agreementDetail,
        extra: { keptFields: kept, inventedFields: invented, inventedFieldNames: inventedFields }
    };
}

function scoreOcr(kase, parsed, baselineParsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { accepted: false, acceptDetail: 'not an object', agreement: null };
    }
    const text = String(parsed.text || '');
    const classification = String(parsed.imageClassification || '');
    const classOk = OCR_CLASSIFICATIONS.has(classification);
    // Production salvages text out of truncated JSON but loses the
    // classification when it does — an empty/unknown class is that failure.
    // Empty TEXT is not a failure by itself: a logo, thumbnail or photo can
    // legitimately carry no words, and demanding text there would mark a
    // correct read as broken.
    const textBearing = classification === 'event-flyer'
        || classification === 'multi-event-flyer'
        || classification === 'ad-banner';
    const accepted = classOk && (!textBearing || Boolean(text.trim()));
    let agreement = null;
    let agreementDetail = '';
    if (baselineParsed && typeof baselineParsed === 'object') {
        const f1 = tokenF1(baselineParsed.text || '', text);
        const sameClass = String(baselineParsed.imageClassification || '') === classification;
        agreement = f1;
        agreementDetail = 'text F1 ' + f1.toFixed(2) + ', class ' + (sameClass ? 'match' : 'differs');
    }
    return {
        accepted,
        acceptDetail: accepted
            ? classification + (text.trim() ? '' : ' (no text, as expected for this class)')
            : (classOk ? 'no text on a ' + classification : 'classification "' + classification + '" not in vocabulary'),
        agreement,
        agreementDetail,
        extra: { classification, textChars: text.length }
    };
}

// context-prep is the one pass with NO JSON contract. Its prompt asks for a
// free-text "CORRECTIONS:" block, and ai-web-parser injects the raw response
// verbatim as [PRE-PARSED HELPER DATA]; the only gate is
// `response.replace(/[^a-z0-9]/gi,'').trim().length >= 5`. The cached baseline
// happens to be a JSON array only because response_format forces JSON — that
// is an artefact of the request, not the contract, so requiring an array here
// would fail every model that follows the prompt as written.
function scoreContextPrepText(kase, responseText, baselineText) {
    const stripped = String(responseText || '').replace(/[^a-z0-9]/gi, '').trim();
    const accepted = stripped.length >= 5;
    let agreement = null;
    let agreementDetail = '';
    if (baselineText) {
        agreement = tokenF1(baselineText, responseText);
        agreementDetail = 'text F1 ' + agreement.toFixed(2);
    }
    return {
        accepted,
        acceptDetail: accepted
            ? stripped.length + ' usable chars'
            : 'too thin to inject (' + stripped.length + ' chars, production needs 5)',
        agreement,
        agreementDetail
    };
}

function scoreBearCheck(kase, parsed, baselineParsed) {
    if (!parsed || typeof parsed !== 'object') {
        return { accepted: false, acceptDetail: 'not an object', agreement: null };
    }
    const verdict = String(parsed.verdict || '');
    if (!BEAR_VERDICTS.has(verdict)) {
        return { accepted: false, acceptDetail: 'verdict "' + verdict + '" not in vocabulary', agreement: null };
    }
    // Production verifies every quoted piece of evidence against the event's
    // own text before trusting a "bear" verdict.
    const quotes = Array.isArray(parsed.eventEvidence) ? parsed.eventEvidence : [];
    const bogus = quotes.filter(q => !occursInPrompt(kase.prompt, q));
    const accepted = bogus.length === 0;
    let agreement = null;
    let agreementDetail = '';
    if (baselineParsed && typeof baselineParsed === 'object') {
        const same = String(baselineParsed.verdict || '') === verdict;
        agreement = same ? 1 : 0;
        agreementDetail = same ? verdict : String(baselineParsed.verdict) + ' -> ' + verdict;
    }
    return {
        accepted,
        acceptDetail: accepted ? verdict + ', ' + quotes.length + ' quotes verified' : bogus.length + ' fabricated quote(s)',
        agreement,
        agreementDetail,
        extra: { verdict, fabricatedQuotes: bogus.length }
    };
}

function scoreMergeArbitration(kase, parsed, baselineParsed, gates) {
    if (!parsed || typeof parsed !== 'object') {
        return { accepted: false, acceptDetail: 'not an object', agreement: null };
    }
    const choices = parsed.choices && typeof parsed.choices === 'object' ? parsed.choices : parsed;
    const conflicts = parseArbitrationConflicts(kase.prompt);
    if (conflicts.length === 0) {
        return { accepted: false, acceptDetail: 'no conflicts found in prompt', agreement: null };
    }
    let verbatim = 0;
    const picked = {};
    for (const conflict of conflicts) {
        const entry = choices[conflict.field];
        if (!entry || typeof entry !== 'object') continue;
        const answer = String(entry.value === null || entry.value === undefined ? '' : entry.value).trim();
        const matchesOne = gates.core.arbitrationValuesEqual(conflict.field, answer, conflict.one);
        const matchesTwo = gates.core.arbitrationValuesEqual(conflict.field, answer, conflict.two);
        if (matchesOne || matchesTwo) verbatim += 1;
        // Record the CONTENT chosen, not the slot — that is what a swapped
        // re-run has to reproduce.
        if (matchesOne && !matchesTwo) picked[conflict.field] = 'one';
        else if (matchesTwo && !matchesOne) picked[conflict.field] = 'two';
        else picked[conflict.field] = 'ambiguous';
    }
    const accepted = verbatim === conflicts.length;
    let agreement = null;
    let agreementDetail = '';
    if (baselineParsed && typeof baselineParsed === 'object') {
        const baseChoices = baselineParsed.choices && typeof baselineParsed.choices === 'object'
            ? baselineParsed.choices : baselineParsed;
        let same = 0;
        for (const conflict of conflicts) {
            const a = choices[conflict.field];
            const b = baseChoices[conflict.field];
            const av = a && typeof a === 'object' ? a.value : undefined;
            const bv = b && typeof b === 'object' ? b.value : undefined;
            if (normalizeForCompare(av) === normalizeForCompare(bv)) same += 1;
        }
        agreement = same / conflicts.length;
        agreementDetail = same + '/' + conflicts.length + ' picks';
    }
    return {
        accepted,
        acceptDetail: verbatim + '/' + conflicts.length + ' verbatim',
        agreement,
        agreementDetail,
        extra: { picked, conflictCount: conflicts.length }
    };
}

function scoreClassifyPage(kase, parsed, baselineParsed) {
    if (!parsed || typeof parsed !== 'object') {
        return { accepted: false, acceptDetail: 'not an object', agreement: null };
    }
    const classification = String(parsed.classification || '');
    const accepted = PAGE_CLASSIFICATIONS.has(classification);
    let agreement = null;
    let agreementDetail = '';
    if (baselineParsed && typeof baselineParsed === 'object') {
        const same = String(baselineParsed.classification || '') === classification;
        agreement = same ? 1 : 0;
        agreementDetail = same ? classification : String(baselineParsed.classification) + ' -> ' + classification;
    }
    return {
        accepted,
        acceptDetail: accepted ? classification : 'classification "' + classification + '" not in vocabulary',
        agreement,
        agreementDetail,
        extra: { classification }
    };
}

function scoreShortName(kase, parsed, baselineParsed, gates) {
    if (!parsed || typeof parsed !== 'object') {
        return { accepted: false, acceptDetail: 'not an object', agreement: null };
    }
    const entry = parsed.shortName && typeof parsed.shortName === 'object' ? parsed.shortName : parsed;
    const answer = String(entry.value === null || entry.value === undefined ? '' : entry.value);
    const title = parseShortNameTitle(kase.prompt);
    // 16 = shortNameDeriveMaxChars, the production default.
    const verdict = gates.core.evaluateDerivedShortName(title, answer, 16);
    // "equals title" is not a failure: shared-core's own comment says a title
    // short enough that its short name IS the title "should ship NO shortName
    // (the display falls back to the title)", and the salvage ladder
    // deliberately skips this reason. Scoring it as a rejection would blame
    // the model for doing the right thing.
    const benign = Boolean(verdict && !verdict.ok && verdict.reason === 'equals title');
    let agreement = null;
    let agreementDetail = '';
    if (baselineParsed && typeof baselineParsed === 'object') {
        const baseEntry = baselineParsed.shortName && typeof baselineParsed.shortName === 'object'
            ? baselineParsed.shortName : baselineParsed;
        const same = normalizeForCompare(baseEntry.value) === normalizeForCompare(answer);
        agreement = same ? 1 : 0;
        agreementDetail = same ? 'same' : String(baseEntry.value) + ' -> ' + answer;
    }
    return {
        accepted: Boolean(verdict && verdict.ok) || benign,
        acceptDetail: verdict && verdict.ok
            ? answer
            : (benign ? 'equals title — no chip needed' : (verdict && verdict.reason) || 'rejected'),
        agreement,
        agreementDetail
    };
}

function scoreFieldTrim(kase, parsed, baselineParsed, gates) {
    if (!parsed || typeof parsed !== 'object') {
        return { accepted: false, acceptDetail: 'not an object', agreement: null };
    }
    const trims = parsed.trims && typeof parsed.trims === 'object' ? parsed.trims : parsed;
    const fields = parseTrimFields(kase.prompt);
    if (fields.length === 0) {
        return { accepted: false, acceptDetail: 'no fields found in prompt', agreement: null };
    }
    let passed = 0;
    for (const field of fields) {
        const entry = trims[field.field];
        const answer = entry && typeof entry === 'object' ? entry.value : entry;
        if (field.shape === 'parts') {
            // Production resolves the range by slicing the ORIGINAL and dropping
            // parts off the end until the limit fits, so it succeeds exactly
            // when the range parses and the FIRST requested part fits alone.
            // The prompt states each part's length, which is all that check
            // needs — the original text is not in the prompt to reconstruct.
            const range = gates.core.parseTrimPartRange(answer);
            if (!range) continue;
            const from = Math.max(1, Math.min(range.from, field.partCount));
            const firstLength = field.partChars[from - 1];
            if (Number.isFinite(firstLength) && firstLength <= field.maxChars) passed += 1;
            continue;
        }
        if (gates.core.isVerbatimTrimAnswer(field.value, answer, field.maxChars)) passed += 1;
    }
    let agreement = null;
    let agreementDetail = '';
    if (baselineParsed && typeof baselineParsed === 'object') {
        const baseTrims = baselineParsed.trims && typeof baselineParsed.trims === 'object'
            ? baselineParsed.trims : baselineParsed;
        let same = 0;
        for (const field of fields) {
            const a = trims[field.field];
            const b = baseTrims[field.field];
            const av = a && typeof a === 'object' ? a.value : a;
            const bv = b && typeof b === 'object' ? b.value : b;
            if (normalizeForCompare(av) === normalizeForCompare(bv)) same += 1;
        }
        agreement = same / fields.length;
        agreementDetail = same + '/' + fields.length + ' trims';
    }
    return {
        accepted: passed === fields.length,
        acceptDetail: passed + '/' + fields.length + ' verbatim',
        agreement,
        agreementDetail
    };
}

function scoreSegmentBoundaries(kase, parsed, baselineParsed) {
    if (!parsed || typeof parsed !== 'object') {
        return { accepted: false, acceptDetail: 'not an object', agreement: null };
    }
    const boundaries = Array.isArray(parsed.boundaries) ? parsed.boundaries : null;
    if (!boundaries) return { accepted: false, acceptDetail: 'no boundaries array', agreement: null };
    const lines = parseSegmentLines(kase.prompt);
    const known = new Set(lines.map(normalizeForCompare));
    const strays = boundaries.filter(b => !known.has(normalizeForCompare(b)));
    let agreement = null;
    let agreementDetail = '';
    if (baselineParsed && Array.isArray(baselineParsed.boundaries)) {
        const a = new Set(boundaries.map(normalizeForCompare));
        const b = new Set(baselineParsed.boundaries.map(normalizeForCompare));
        let overlap = 0;
        for (const v of a) if (b.has(v)) overlap += 1;
        const precision = a.size ? overlap / a.size : 0;
        const recall = b.size ? overlap / b.size : 0;
        // "This page describes ONE event" is a real answer the prompt asks for,
        // and two empty lists agree completely — scoring that 0 would punish
        // the correct call on every single-event page.
        if (a.size === 0 && b.size === 0) agreement = 1;
        else agreement = (precision + recall) === 0 ? 0 : (2 * precision * recall) / (precision + recall);
        agreementDetail = 'set F1 ' + agreement.toFixed(2) + ' (' + a.size + ' vs ' + b.size + ')';
    }
    return {
        accepted: strays.length === 0,
        acceptDetail: strays.length === 0 ? boundaries.length + ' boundaries, all verbatim' : strays.length + ' invented line(s)',
        agreement,
        agreementDetail,
        extra: { boundaryCount: boundaries.length, strayCount: strays.length }
    };
}

const SCORERS = {
    'extraction': scoreExtraction,
    'ocr': scoreOcr,
    'bear-check': scoreBearCheck,
    'merge-arbitration': scoreMergeArbitration,
    'classify-page': scoreClassifyPage,
    'short-name': scoreShortName,
    'field-trim': scoreFieldTrim,
    'segment-boundaries': scoreSegmentBoundaries
};

// ---------------------------------------------------------------------------
// Public scoring entry point
// ---------------------------------------------------------------------------

function scoreCase(kase, responseText, gates) {
    const baselineText = kase.baseline && kase.baseline.text ? kase.baseline.text : null;

    // context-prep has no JSON contract at all — score the raw text.
    if (kase.pass === 'context-prep') {
        return {
            id: kase.id,
            pass: kase.pass,
            jsonOk: true,
            jsonMode: 'n/a (free text)',
            ...scoreContextPrepText(kase, responseText, baselineText)
        };
    }

    const scorer = SCORERS[kase.pass];
    if (!scorer) throw new Error('No scorer for pass "' + kase.pass + '"');
    const parsedResponse = parseJsonLoose(responseText, gates);
    const base = {
        id: kase.id,
        pass: kase.pass,
        jsonOk: parsedResponse.ok,
        jsonMode: parsedResponse.reason
    };
    if (!parsedResponse.ok) {
        return { ...base, accepted: false, acceptDetail: 'JSON ' + parsedResponse.reason, agreement: null, agreementDetail: '' };
    }
    const baselineParsed = baselineText ? parseJsonLoose(baselineText, gates).value : null;
    const result = scorer(kase, parsedResponse.value, baselineParsed, gates);
    return { ...base, ...result, parsed: parsedResponse.value };
}

// ---------------------------------------------------------------------------
// Request building — must mirror SharedCore.buildAiPayload's openai branch
// ---------------------------------------------------------------------------

function buildPayload(kase, options = {}) {
    const model = options.model;
    if (!model) throw new Error('buildPayload requires a model');
    const numPredict = Number(options.numPredict)
        || (kase.options && Number(kase.options.numPredict))
        || PASS_NUM_PREDICT[kase.pass]
        || 2000;
    const content = kase.imageBase64
        ? [
            { type: 'text', text: kase.prompt },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + kase.imageBase64 } }
        ]
        : kase.prompt;
    const payload = {
        model,
        messages: [{ role: 'user', content }],
        temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0,
        max_tokens: Math.floor(numPredict)
    };
    const responseFormat = options.responseFormat
        || (kase.options && kase.options.responseFormat)
        || 'json_object';
    if (responseFormat !== 'none') payload.response_format = { type: responseFormat };
    return payload;
}

// ---------------------------------------------------------------------------
// Aggregation and reporting
// ---------------------------------------------------------------------------

function percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[index];
}

function aggregate(rows) {
    const byPass = new Map();
    for (const row of rows) {
        if (!byPass.has(row.pass)) byPass.set(row.pass, []);
        byPass.get(row.pass).push(row);
    }
    const summary = [];
    for (const pass of PASSES) {
        const list = byPass.get(pass);
        if (!list || list.length === 0) continue;
        const latencies = list.map(r => Number(r.latencyMs) || 0).sort((a, b) => a - b);
        const agreements = list.map(r => r.agreement).filter(v => typeof v === 'number');
        const truncated = list.filter(r => r.finishReason === 'length').length;
        const errors = list.filter(r => r.error).length;
        summary.push({
            pass,
            cases: list.length,
            errors,
            jsonOkRate: list.filter(r => r.jsonOk).length / list.length,
            acceptRate: list.filter(r => r.accepted).length / list.length,
            agreementMean: agreements.length ? agreements.reduce((a, b) => a + b, 0) / agreements.length : null,
            truncationRate: truncated / list.length,
            latencyP50: percentile(latencies, 50),
            latencyP95: percentile(latencies, 95),
            promptTokens: list.reduce((a, r) => a + (Number(r.promptTokens) || 0), 0),
            completionTokens: list.reduce((a, r) => a + (Number(r.completionTokens) || 0), 0),
            wallMs: list.reduce((a, r) => a + (Number(r.latencyMs) || 0), 0),
            // Yield is tracked apart from acceptance: a model that answers
            // "nothing here" to everything would score a perfect accept rate.
            yieldMean: list.reduce((a, r) => a + ((r.extra && r.extra.keptFields) || 0), 0) / list.length,
            inventedFields: list.reduce((a, r) => a + ((r.extra && r.extra.inventedFields) || 0), 0),
            fabricatedQuotes: list.reduce((a, r) => a + ((r.extra && r.extra.fabricatedQuotes) || 0), 0),
            strayBoundaries: list.reduce((a, r) => a + ((r.extra && r.extra.strayCount) || 0), 0)
        });
    }
    return summary;
}

// Position bias: for each arbitration case run twice (original + swapped
// candidates), the model should choose the same CONTENT both times. A flip
// means it answered by slot.
function positionBiasRate(pairs) {
    let compared = 0;
    let flipped = 0;
    for (const pair of pairs) {
        const a = (pair.original && pair.original.extra && pair.original.extra.picked) || {};
        const b = (pair.swapped && pair.swapped.extra && pair.swapped.extra.picked) || {};
        for (const field of Object.keys(a)) {
            if (!(field in b)) continue;
            if (a[field] === 'ambiguous' || b[field] === 'ambiguous') continue;
            compared += 1;
            // After the swap, choosing the same content means the recorded slot
            // must be the OPPOSITE label.
            const expected = a[field] === 'one' ? 'two' : 'one';
            if (b[field] !== expected) flipped += 1;
        }
    }
    return { compared, flipped, rate: compared === 0 ? null : flipped / compared };
}

function pct(value) {
    return value === null || value === undefined ? '   -  ' : (value * 100).toFixed(1).padStart(5) + '%';
}

function formatSummaryTable(summary, label) {
    const lines = [];
    lines.push('');
    lines.push('  ' + (label || 'ai-eval'));
    lines.push('  ' + '-'.repeat(104));
    lines.push('  pass                 cases   json%  accept%   agree%   trunc%    p50ms    p95ms    yield  invented');
    lines.push('  ' + '-'.repeat(104));
    for (const row of summary) {
        lines.push('  '
            + row.pass.padEnd(20)
            + String(row.cases).padStart(5)
            + '  ' + pct(row.jsonOkRate)
            + '  ' + pct(row.acceptRate)
            + '  ' + pct(row.agreementMean)
            + '  ' + pct(row.truncationRate)
            + String(Math.round(row.latencyP50)).padStart(9)
            + String(Math.round(row.latencyP95)).padStart(9)
            + (row.yieldMean ? row.yieldMean.toFixed(1) : '-').padStart(9)
            + String(row.inventedFields + row.fabricatedQuotes + row.strayBoundaries).padStart(10));
    }
    lines.push('  ' + '-'.repeat(104));
    const totalCases = summary.reduce((a, r) => a + r.cases, 0);
    const totalWall = summary.reduce((a, r) => a + r.wallMs, 0);
    lines.push('  ' + totalCases + ' cases, ' + (totalWall / 1000).toFixed(1) + 's of model time');
    lines.push('');
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Case loading
// ---------------------------------------------------------------------------

function loadCases(dir, options = {}) {
    const wanted = options.passes && options.passes.length ? new Set(options.passes) : null;
    const cases = [];
    if (!fs.existsSync(dir)) return cases;
    for (const pass of fs.readdirSync(dir)) {
        const passDir = path.join(dir, pass);
        if (!fs.statSync(passDir).isDirectory()) continue;
        if (pass === 'images') continue;
        if (wanted && !wanted.has(pass)) continue;
        for (const file of fs.readdirSync(passDir)) {
            if (!file.endsWith('.json')) continue;
            const kase = JSON.parse(fs.readFileSync(path.join(passDir, file), 'utf8'));
            if (kase.image) {
                const imagePath = path.join(dir, kase.image);
                if (fs.existsSync(imagePath)) {
                    kase.imageBase64 = fs.readFileSync(imagePath).toString('base64');
                }
            }
            cases.push(kase);
        }
    }
    return cases;
}

module.exports = {
    PASSES,
    PASS_NUM_PREDICT,
    OCR_CLASSIFICATIONS,
    LITERAL_COPY_FIELDS,
    PAGE_CLASSIFICATIONS,
    BEAR_VERDICTS,
    createGates,
    parseJsonLoose,
    parseArbitrationConflicts,
    swapArbitrationPrompt,
    parseTrimFields,
    parseShortNameTitle,
    parseSegmentLines,
    normalizeForCompare,
    tokenize,
    tokenF1,
    occursInPrompt,
    scoreCase,
    scoreContextPrepText,
    buildPayload,
    aggregate,
    positionBiasRate,
    formatSummaryTable,
    loadCases
};

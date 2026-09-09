// ============================================================================
// AI EVAL SCORING TESTS
// ============================================================================
// Covers scripts/ai-eval.js — the scoring half of the local-model eval
// harness. Everything here is OFFLINE: prompts and responses are embedded
// constants, no server is contacted, no fixture file is read. The harness
// itself (tools/ai-eval.js) needs a live GPU and is deliberately not tested
// here.
//
// What these assertions are FOR: proving that "accepted" means what
// production means by it. The scorers call SharedCore's real gates rather
// than reimplementing them, so these tests mostly pin the PROMPT READERS
// (which recover a case's ground rules from the prompt text) and the
// bookkeeping around them.
//
// What they must NOT assert on: prompt wording beyond the structural markers
// the readers key off, or any live model's answers. A prompt reword in the
// scraper should break these only if it changed the structure the reader
// depends on — which is exactly when we want to know.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');

const ev = require('./ai-eval.js');

const gates = ev.createGates();

const ARBITRATION_PROMPT = [
    'You are resolving merge conflicts between two records of the SAME event.',
    'CONFLICTS:',
    '- field: title',
    '  version-one: "GOLDILOXX Chicago"',
    '  version-two: "Staycation LLC"',
    '- field: website',
    '  version-one: "https://a.example/one"',
    '  version-two: "https://b.example/two"',
    'Rules:'
].join('\n');

const TRIM_PROMPT = [
    'You are shortening overlong text fields for one event.',
    'FIELDS:',
    '- field: description',
    '  max_chars: 20',
    '  value: "the quick brown fox jumps over the lazy dog"'
].join('\n');

const SEGMENT_PROMPT = [
    'You are segmenting a web page that lists MULTIPLE distinct events.',
    '',
    'PAGE LINES (one per line, exactly as extracted):',
    'Monday',
    'Taco Tuesday',
    'BRUNCH 11-2pm',
    '',
    'TASK: Identify where each distinct event starts.'
].join('\n');

// --- prompt readers ---------------------------------------------------------

test('ai-eval: parseArbitrationConflicts recovers every field and both candidates', () => {
    const conflicts = ev.parseArbitrationConflicts(ARBITRATION_PROMPT);
    assert.equal(conflicts.length, 2);
    assert.deepEqual(conflicts[0], { field: 'title', one: 'GOLDILOXX Chicago', two: 'Staycation LLC' });
    assert.equal(conflicts[1].field, 'website');
});

test('ai-eval: swapArbitrationPrompt exchanges the values but keeps the slot labels', () => {
    const swapped = ev.swapArbitrationPrompt(ARBITRATION_PROMPT);
    const conflicts = ev.parseArbitrationConflicts(swapped);
    assert.equal(conflicts[0].one, 'Staycation LLC');
    assert.equal(conflicts[0].two, 'GOLDILOXX Chicago');
    // Labels must survive, or the model would be answering a different question.
    assert.ok(swapped.includes('version-one: "Staycation LLC"'));
    assert.ok(swapped.includes('version-two: "GOLDILOXX Chicago"'));
});

test('ai-eval: swapping twice returns the original prompt', () => {
    assert.equal(ev.swapArbitrationPrompt(ev.swapArbitrationPrompt(ARBITRATION_PROMPT)), ARBITRATION_PROMPT);
});

test('ai-eval: parseTrimFields recovers field, limit and original value', () => {
    const fields = ev.parseTrimFields(TRIM_PROMPT);
    assert.equal(fields.length, 1);
    assert.equal(fields[0].field, 'description');
    assert.equal(fields[0].maxChars, 20);
    assert.ok(fields[0].value.startsWith('the quick brown'));
});

test('ai-eval: parseShortNameTitle reads the TITLE line', () => {
    assert.equal(ev.parseShortNameTitle('You are naming a chip.\nTITLE: JUKE BOX HEROES\nRules:'), 'JUKE BOX HEROES');
});

test('ai-eval: parseSegmentLines stops at the TASK marker and drops blanks', () => {
    assert.deepEqual(ev.parseSegmentLines(SEGMENT_PROMPT), ['Monday', 'Taco Tuesday', 'BRUNCH 11-2pm']);
});

// --- text helpers -----------------------------------------------------------

test('ai-eval: tokenF1 is 1 for identical text and 0 for disjoint text', () => {
    assert.equal(ev.tokenF1('BEAR NIGHT', 'bear   night'), 1);
    assert.equal(ev.tokenF1('BEAR NIGHT', 'karaoke bingo'), 0);
});

test('ai-eval: tokenF1 counts repeats as a multiset, so a dropped duplicate is a partial miss', () => {
    const score = ev.tokenF1('bear bear bear', 'bear bear');
    assert.ok(score > 0 && score < 1, 'expected a partial score, got ' + score);
});

test('ai-eval: occursInPrompt ignores case and whitespace but not invention', () => {
    const prompt = 'VENUE:  Eagle   LA\nCITY: los angeles';
    assert.equal(ev.occursInPrompt(prompt, 'eagle la'), true);
    assert.equal(ev.occursInPrompt(prompt, 'Precinct DTLA'), false);
    assert.equal(ev.occursInPrompt(prompt, ''), true, 'an empty value cannot be invented');
});

// --- response parsing -------------------------------------------------------

test('ai-eval: parseJsonLoose reads clean JSON, wrapped JSON, and bare arrays', () => {
    assert.equal(ev.parseJsonLoose('{"a":1}', gates).value.a, 1);
    assert.equal(ev.parseJsonLoose('Sure!\n{"a":2}\nHope that helps', gates).value.a, 2);
    assert.deepEqual(ev.parseJsonLoose('["3:00 PM"]', gates).value, ['3:00 PM']);
    assert.equal(ev.parseJsonLoose('not json at all', gates).ok, false);
    assert.equal(ev.parseJsonLoose('', gates).ok, false);
});

// --- scorers ----------------------------------------------------------------

test('ai-eval: arbitration is accepted only when every answer is a verbatim candidate', () => {
    const kase = { id: 'merge-arbitration/t1', pass: 'merge-arbitration', prompt: ARBITRATION_PROMPT };
    const good = JSON.stringify({ choices: {
        title: { pick: 'version-one', value: 'GOLDILOXX Chicago' },
        website: { pick: 'version-two', value: 'https://b.example/two' }
    } });
    assert.equal(ev.scoreCase(kase, good, gates).accepted, true);

    const edited = JSON.stringify({ choices: {
        title: { pick: 'version-one', value: 'Goldiloxx Chicago (Sickening)' },
        website: { pick: 'version-two', value: 'https://b.example/two' }
    } });
    assert.equal(ev.scoreCase(kase, edited, gates).accepted, false,
        'a reworded value is exactly what production refuses');
});

test('ai-eval: arbitration records which CONTENT won, so a swap can be compared', () => {
    const kase = { id: 'merge-arbitration/t2', pass: 'merge-arbitration', prompt: ARBITRATION_PROMPT };
    const scored = ev.scoreCase(kase, JSON.stringify({ choices: {
        title: { pick: 'version-one', value: 'GOLDILOXX Chicago' },
        website: { pick: 'version-one', value: 'https://a.example/one' }
    } }), gates);
    assert.equal(scored.extra.picked.title, 'one');
    assert.equal(scored.extra.picked.website, 'one');
});

test('ai-eval: positionBiasRate counts a flip only when the same slot wins twice', () => {
    // Content-stable: picked "one" before the swap, "two" after — same value.
    const stable = ev.positionBiasRate([{
        original: { extra: { picked: { title: 'one' } } },
        swapped: { extra: { picked: { title: 'two' } } }
    }]);
    assert.equal(stable.flipped, 0);
    assert.equal(stable.rate, 0);

    // Slot-stable: picked "one" both times, so the chosen VALUE changed.
    const biased = ev.positionBiasRate([{
        original: { extra: { picked: { title: 'one' } } },
        swapped: { extra: { picked: { title: 'one' } } }
    }]);
    assert.equal(biased.flipped, 1);
    assert.equal(biased.rate, 1);
});

test('ai-eval: field-trim accepts a verbatim substring and rejects a rewrite', () => {
    const kase = { id: 'field-trim/t1', pass: 'field-trim', prompt: TRIM_PROMPT };
    const verbatim = JSON.stringify({ trims: { description: { value: 'the quick brown fox' } } });
    assert.equal(ev.scoreCase(kase, verbatim, gates).accepted, true);
    const rewritten = JSON.stringify({ trims: { description: { value: 'a fast brown fox' } } });
    assert.equal(ev.scoreCase(kase, rewritten, gates).accepted, false);
    const tooLong = JSON.stringify({ trims: { description: { value: 'the quick brown fox jumps over' } } });
    assert.equal(ev.scoreCase(kase, tooLong, gates).accepted, false, 'over the stated max_chars');
});

const TRIM_PARTS_PROMPT = [
    'You pick which numbered PARTS of an overlong event field to keep. You never write text.',
    'EVENT: MX. ROCKBAR SEMI-FINALS',
    'FIELD: description — limit 600 characters, currently 679',
    'PARTS (3):',
    '1. (174 chars) "opening hype"',
    '2. (274 chars) "the actual details"',
    '3. (700 chars) "a very long tail"',
    'Rules:'
].join('\n');

test('ai-eval: parseTrimFields reads the live PARTS prompt as well as the legacy one', () => {
    const legacy = ev.parseTrimFields(TRIM_PROMPT);
    assert.equal(legacy[0].shape, 'text');
    const parts = ev.parseTrimFields(TRIM_PARTS_PROMPT);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].shape, 'parts');
    assert.equal(parts[0].field, 'description');
    assert.equal(parts[0].maxChars, 600);
    assert.equal(parts[0].partCount, 3);
    assert.deepEqual(parts[0].partChars, [174, 274, 700]);
});

test('ai-eval: a PARTS range is accepted when its first part fits, rejected when it cannot', () => {
    const kase = { id: 'field-trim/p1', pass: 'field-trim', prompt: TRIM_PARTS_PROMPT };
    // Production slices the original and drops parts off the END until the
    // limit fits, so a range starting at a part that fits always resolves.
    assert.equal(ev.scoreCase(kase, JSON.stringify({ trims: { description: '1-3' } }), gates).accepted, true);
    assert.equal(ev.scoreCase(kase, JSON.stringify({ trims: { description: '2-2' } }), gates).accepted, true);
    // Part 3 alone is over the limit — nothing can be dropped to save it.
    assert.equal(ev.scoreCase(kase, JSON.stringify({ trims: { description: '3-3' } }), gates).accepted, false);
    // Writing text instead of naming a range is what this prompt forbids.
    assert.equal(ev.scoreCase(kase, JSON.stringify({ trims: { description: 'the actual details' } }), gates).accepted, false);
});

test('ai-eval: segment-boundaries rejects a line that was never on the page', () => {
    const kase = { id: 'segment-boundaries/t1', pass: 'segment-boundaries', prompt: SEGMENT_PROMPT };
    const real = JSON.stringify({ boundaries: ['Monday', 'Taco Tuesday'] });
    assert.equal(ev.scoreCase(kase, real, gates).accepted, true);
    const invented = JSON.stringify({ boundaries: ['Monday', 'Bear Happy Hour'] });
    const scored = ev.scoreCase(kase, invented, gates);
    assert.equal(scored.accepted, false);
    assert.equal(scored.extra.strayCount, 1);
});

test('ai-eval: context-prep is scored as free text, because production injects it raw', () => {
    // ai-web-parser drops the answer into [PRE-PARSED HELPER DATA] verbatim and
    // gates only on >=5 alphanumeric characters. The prompt asks for a
    // "CORRECTIONS:" block, not JSON — a cached array baseline is an artefact
    // of response_format, not the contract.
    const kase = {
        id: 'context-prep/t1',
        pass: 'context-prep',
        prompt: 'Analyze this raw event data.\nOutput ONLY this format:\nCORRECTIONS:',
        baseline: { text: '["9:00 PM"]' }
    };
    const prose = ev.scoreCase(kase, 'CORRECTIONS:\n- Cleaned Times: 9:00 PM\n- Core Event Date: 2026-09-06', gates);
    assert.equal(prose.accepted, true, 'following the prompt must not be scored as a failure');
    assert.equal(prose.jsonOk, true, 'this pass has no JSON contract to fail');

    const array = ev.scoreCase(kase, '["9:00 PM"]', gates);
    assert.equal(array.accepted, true, 'the older array shape is equally usable');

    const tooThin = ev.scoreCase(kase, '- -', gates);
    assert.equal(tooThin.accepted, false, 'production skips a response this thin');
});

test('ai-eval: bear-check rejects a quote the event text never contained', () => {
    const prompt = 'TITLE: Karaoke Night\nDESCRIPTION: Sing your heart out at the Eagle.';
    const kase = { id: 'bear-check/t1', pass: 'bear-check', prompt };
    const honest = JSON.stringify({ verdict: 'not_bear', eventEvidence: ['Sing your heart out'], reason: 'x' });
    assert.equal(ev.scoreCase(kase, honest, gates).accepted, true);
    const fabricated = JSON.stringify({ verdict: 'bear', eventEvidence: ['bear community welcome'], reason: 'x' });
    const scored = ev.scoreCase(kase, fabricated, gates);
    assert.equal(scored.accepted, false);
    assert.equal(scored.extra.fabricatedQuotes, 1);
});

test('ai-eval: bear-check refuses a verdict outside the prompt vocabulary', () => {
    const kase = { id: 'bear-check/t2', pass: 'bear-check', prompt: 'TITLE: x' };
    assert.equal(ev.scoreCase(kase, JSON.stringify({ verdict: 'maybe' }), gates).accepted, false);
});

test('ai-eval: classify-page accepts only the five known labels', () => {
    const kase = { id: 'classify-page/t1', pass: 'classify-page', prompt: 'URL: https://x.example' };
    assert.equal(ev.scoreCase(kase, JSON.stringify({ classification: 'multi-event-page' }), gates).accepted, true);
    assert.equal(ev.scoreCase(kase, JSON.stringify({ classification: 'calendar' }), gates).accepted, false);
});

test('ai-eval: ocr needs a known classification, and text only where text is expected', () => {
    const kase = { id: 'ocr/t1', pass: 'ocr', prompt: 'You are performing OCR on an event flyer.' };
    const good = JSON.stringify({ text: 'CUBSCOUT\nEAGLE LA', imageClassification: 'event-flyer' });
    assert.equal(ev.scoreCase(kase, good, gates).accepted, true);
    // This is the shape a truncation-salvaged answer has: text but no class.
    const salvaged = JSON.stringify({ text: 'CUBSCOUT', imageClassification: '' });
    assert.equal(ev.scoreCase(kase, salvaged, gates).accepted, false);
    // A wordless logo is a correct read, not a failure.
    const logo = JSON.stringify({ text: '', imageClassification: 'logo' });
    assert.equal(ev.scoreCase(kase, logo, gates).accepted, true);
    // A flyer with no text read off it, however, is a miss.
    const blankFlyer = JSON.stringify({ text: '', imageClassification: 'event-flyer' });
    assert.equal(ev.scoreCase(kase, blankFlyer, gates).accepted, false);
});

test('ai-eval: extraction accepts a confident field and flags an invented one', () => {
    const prompt = 'SEGMENT_LISTING_TITLE: "BRUNCH 11-2pm"\nOCR_IMAGE_TEXT: "LUMBER YARD BAR"';
    const kase = { id: 'extraction/t1', pass: 'extraction', prompt };
    const grounded = JSON.stringify({
        title: { value: 'BRUNCH 11-2pm', evidence: 'x', confidence: 100 },
        bar: { value: 'Lumber Yard Bar', evidence: 'x', confidence: 90 }
    });
    const okScore = ev.scoreCase(kase, grounded, gates);
    assert.equal(okScore.accepted, true);
    assert.equal(okScore.extra.inventedFields, 0);

    const invented = JSON.stringify({
        title: { value: 'BRUNCH 11-2pm', evidence: 'x', confidence: 100 },
        bar: { value: 'Precinct DTLA', evidence: 'x', confidence: 90 }
    });
    const badScore = ev.scoreCase(kase, invented, gates);
    assert.equal(badScore.accepted, false, 'invention is the failure extraction is scored on');
    assert.equal(badScore.extra.inventedFields, 1);
    assert.deepEqual(badScore.extra.inventedFieldNames, ['bar']);
});

test('ai-eval: extraction does not flag normalised fields as invented', () => {
    // The prompt says "13 Aug" and "Eagle LA"; the model correctly answers
    // with an ISO date and a canonical city. Neither string is in the prompt,
    // and neither is an invention.
    const prompt = 'OCR_IMAGE_TEXT: "GEAR NIGHT — 13 Aug — Eagle LA"';
    const kase = { id: 'extraction/t5', pass: 'extraction', prompt };
    const normalised = JSON.stringify({
        startdate: { value: '2026-08-13', evidence: '13 Aug', confidence: 90 },
        city: { value: 'los angeles', evidence: 'Eagle LA', confidence: 95 },
        website: { value: 'https://eaglela.example/gear', evidence: 'x', confidence: 90 }
    });
    const scored = ev.scoreCase(kase, normalised, gates);
    assert.equal(scored.extra.inventedFields, 0, 'dates, cities and URLs are derived, not copied');
    assert.equal(scored.accepted, true);
    assert.equal(scored.extra.keptFields, 3, 'they still count toward yield');
});

test('ai-eval: an empty extraction is acceptable — plenty of snippets hold no event', () => {
    const kase = { id: 'extraction/t4', pass: 'extraction', prompt: 'navigation menu, cookie banner' };
    const scored = ev.scoreCase(kase, JSON.stringify({}), gates);
    assert.equal(scored.accepted, true, 'yield is reported separately, not scored as a failure');
    assert.equal(scored.extra.keptFields, 0);
});

test('ai-eval: short-name treats "equals title" as the correct no-chip outcome', () => {
    const prompt = 'You are naming a compact calendar chip for one event.\nTITLE: BEAR NIGHT\nRules:';
    const kase = { id: 'short-name/t1', pass: 'short-name', prompt };
    // shared-core: a title whose short name IS the title should ship no chip.
    const echo = JSON.stringify({ shortName: { value: 'BEAR NIGHT', reason: 'x' } });
    assert.equal(ev.scoreCase(kase, echo, gates).accepted, true);
    // Something the title never said is still a rejection.
    const invented = JSON.stringify({ shortName: { value: 'GRIZZLY', reason: 'x' } });
    assert.equal(ev.scoreCase(kase, invented, gates).accepted, false);
});

test('ai-eval: two empty boundary lists agree completely', () => {
    const kase = {
        id: 'segment-boundaries/t2',
        pass: 'segment-boundaries',
        prompt: SEGMENT_PROMPT,
        baseline: { text: JSON.stringify({ boundaries: [] }) }
    };
    const scored = ev.scoreCase(kase, JSON.stringify({ boundaries: [] }), gates);
    assert.equal(scored.accepted, true);
    assert.equal(scored.agreement, 1, 'agreeing that a page holds one event is agreement');
});

test('ai-eval: extraction ignores fields below the production confidence floor', () => {
    const kase = { id: 'extraction/t2', pass: 'extraction', prompt: 'nothing useful here' };
    const lowConfidence = JSON.stringify({ bar: { value: 'Somewhere', evidence: '', confidence: 20 } });
    const scored = ev.scoreCase(kase, lowConfidence, gates);
    assert.equal(scored.extra.keptFields, 0, 'nothing survived the >=50 floor');
    assert.equal(scored.extra.inventedFields, 0, 'a discarded field cannot count as invention');
});

test('ai-eval: an unparseable response is never accepted by a pass that needs JSON', () => {
    // context-prep is deliberately excluded: it has no JSON contract, so free
    // text is its correct output, not a parse failure.
    for (const pass of ev.PASSES.filter(p => p !== 'context-prep')) {
        const kase = { id: pass + '/t', pass, prompt: 'x' };
        const scored = ev.scoreCase(kase, 'I could not complete that request.', gates);
        assert.equal(scored.accepted, false, pass + ' accepted unparseable output');
        assert.equal(scored.jsonOk, false);
    }
});

// --- payload + aggregation --------------------------------------------------

test('ai-eval: buildPayload mirrors the production OpenAI request shape', () => {
    const kase = { id: 'extraction/t3', pass: 'extraction', prompt: 'hello', options: { numPredict: 2000 } };
    const payload = ev.buildPayload(kase, { model: 'm' });
    assert.deepEqual(Object.keys(payload).sort(), ['max_tokens', 'messages', 'model', 'response_format', 'temperature']);
    assert.equal(payload.messages[0].content, 'hello', 'text prompts are sent as a plain string');
    assert.equal(payload.temperature, 0);
    assert.equal(payload.max_tokens, 2000);
    assert.deepEqual(payload.response_format, { type: 'json_object' });
});

test('ai-eval: buildPayload attaches an image as a base64 data URL content part', () => {
    const kase = { id: 'ocr/t2', pass: 'ocr', prompt: 'read this', imageBase64: 'QUJD' };
    const payload = ev.buildPayload(kase, { model: 'vl' });
    assert.equal(Array.isArray(payload.messages[0].content), true);
    assert.equal(payload.messages[0].content[0].text, 'read this');
    assert.equal(payload.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,QUJD');
});

test('ai-eval: buildPayload falls back to the per-pass completion cap', () => {
    assert.equal(ev.buildPayload({ pass: 'short-name', prompt: 'x' }, { model: 'm' }).max_tokens, 200);
    assert.equal(ev.buildPayload({ pass: 'segment-boundaries', prompt: 'x' }, { model: 'm' }).max_tokens, 1200);
});

test('ai-eval: aggregate reports rates per pass and keeps agreement separate from acceptance', () => {
    const summary = ev.aggregate([
        { pass: 'short-name', jsonOk: true, accepted: true, agreement: 1, latencyMs: 100, finishReason: 'stop' },
        { pass: 'short-name', jsonOk: true, accepted: false, agreement: 0, latencyMs: 300, finishReason: 'length' },
        { pass: 'classify-page', jsonOk: true, accepted: true, agreement: null, latencyMs: 50, finishReason: 'stop' }
    ]);
    const shortName = summary.find(s => s.pass === 'short-name');
    assert.equal(shortName.cases, 2);
    assert.equal(shortName.acceptRate, 0.5);
    assert.equal(shortName.agreementMean, 0.5);
    assert.equal(shortName.truncationRate, 0.5);
    const classify = summary.find(s => s.pass === 'classify-page');
    assert.equal(classify.agreementMean, null, 'no baseline means no agreement number, not zero');
});

test('ai-eval: aggregate orders passes the way PASSES declares them', () => {
    const summary = ev.aggregate([
        { pass: 'short-name', jsonOk: true, accepted: true, agreement: null, latencyMs: 1 },
        { pass: 'extraction', jsonOk: true, accepted: true, agreement: null, latencyMs: 1 }
    ]);
    assert.deepEqual(summary.map(s => s.pass), ['extraction', 'short-name']);
});

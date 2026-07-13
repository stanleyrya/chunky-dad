const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseLog,
  annotateUrls,
  buildSummary,
  extractAiPayloads,
  formatSummary,
  filterByUrl
} = require('../tools/analyze-scraper-log');

// Representative slice of a run log in the adapter's FileLogger format
// (ISO timestamp + [LEVEL]); the Full prompt debug entry spans multiple lines.
const FIXTURE = [
  '2026-07-13T09:12:01.000Z [INFO] 🤖 AI Web: Fields for https://furball.example/events/blackout: 14 selected (skipped: instagram; mode: split+ocr)',
  '2026-07-13T09:12:02.000Z [INFO] 🤖 AI Web: Running AI extraction for https://furball.example/events/blackout (14 fields)',
  '2026-07-13T09:12:03.000Z [INFO] 🤖 AI Web: Sending AI request (context-prep pass) to http://rybook.example:8000/v1/chat/completions — model: qwen, provider: openai, prompt: 812 chars',
  '2026-07-13T09:12:03.100Z [DEBUG] 🤖 AI Web: Full prompt (context-prep pass) (812 chars)',
  'Analyze this raw event data. Find any hidden times.',
  'TEXT:',
  'FURBALL BLACKOUT July 10 2026 at 3 Dollar Bill',
  '2026-07-13T09:12:05.000Z [INFO] 🤖 AI Web: AI request (context-prep pass) succeeded in 1893ms — response: 140 chars',
  '2026-07-13T09:12:06.000Z [INFO] 🤖 AI Web: Sending AI request (extraction pass) to http://rybook.example:8000/v1/chat/completions — model: qwen, provider: openai, prompt: 5210 chars',
  '2026-07-13T09:12:06.100Z [DEBUG] 🤖 AI Web: Full prompt (extraction pass) (5210 chars)',
  'Extract the event fields from the content below.',
  'CONTENT: FURBALL BLACKOUT ...',
  '2026-07-13T09:12:09.000Z [INFO] 🤖 AI Web: AI request (extraction pass) succeeded in 3120ms — response: 512 chars',
  '2026-07-13T09:12:09.100Z [DEBUG] 🤖 AI Web: Model response text (extraction pass) (512 chars)',
  '{"title": "FURBALL BLACKOUT"}',
  '2026-07-13T09:12:09.500Z [WARN] 🤖 AI Web: Dropped 1 field(s) lacking source evidence: shortName',
  '2026-07-13T09:12:10.000Z [INFO] 🤖 AI Web: Extracted https://furball.example/events/blackout → title="FURBALL BLACKOUT", bar="3 Dollar Bill", startDate=2026-07-10T22:00:00.000Z, city=nyc',
  '2026-07-13T09:12:11.000Z [INFO] 🤖 AI Web: Running AI extraction for https://megawoof.example/la (12 fields)',
  '2026-07-13T09:12:12.000Z [INFO] 🤖 AI Web: Sending AI request (extraction pass) to http://rybook.example:8000/v1/chat/completions — model: qwen, provider: openai, prompt: 4100 chars',
  '2026-07-13T09:12:14.000Z [INFO] 🤖 AI Web: AI request (extraction pass) succeeded in 2000ms — response: 400 chars',
  '2026-07-13T09:12:15.000Z [INFO] 🤖 AI Web: Extracted https://megawoof.example/la → title="MEGAWOOF", bar="Catch One", startDate=2026-08-01T05:00:00.000Z, city=la',
  '2026-07-13T09:12:16.000Z [INFO] 🤝 AI MERGE: "FURBALL BLACKOUT" field=bar chose scraped ("3 Dollar Bill") over existing ("3 Dollar Bill Bar") — fresher source',
  '2026-07-13T09:12:17.000Z [INFO] 🔄 PARSER MERGE: "MEGAWOOF" (ai-web) + "MEGAWOOF" (bearracuda) → 2 fields updated (bar, ticketUrl)',
  '2026-07-13T09:12:18.000Z [INFO] 🔄 SharedCore: Deduplicated 5 → 4 (1 duplicate merged)',
  '2026-07-13T09:12:19.000Z [ERROR] 🚨 AI Web: AI request (ocr pass) to http://desktop.example:11434/api/generate with model qwen3-vl failed after 120000ms (TimeoutError): timed out',
  '2026-07-13T09:12:20.000Z [INFO] 📅 CALENDAR SUMMARY',
  '2026-07-13T09:12:21.000Z [INFO] 📊 Events: 4 total'
].join('\n');

test('parseLog groups multi-line messages under their entry', () => {
  const entries = parseLog(FIXTURE);
  assert.equal(entries.length, 21);
  const promptEntry = entries.find(e => e.message.includes('Full prompt (context-prep pass)'));
  assert.equal(promptEntry.level, 'debug');
  assert.ok(promptEntry.message.includes('FURBALL BLACKOUT July 10 2026 at 3 Dollar Bill'));
});

test('parseLog tolerates raw console-paste format', () => {
  const entries = parseLog([
    '2026-07-13 09:12:13: 🤖 AI Web: Running AI extraction for https://x.example/a (5 fields)',
    '2026-07-13 09:12:14: ⚠️ SharedCore: Filtering out event "Old" - missing startDate'
  ].join('\n'));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].level, 'info');
  assert.equal(entries[1].level, 'warn');
});

test('buildSummary counts pages, events, AI passes and timings', () => {
  const summary = buildSummary(parseLog(FIXTURE));

  assert.equal(summary.pages.length, 2);
  const blackout = summary.pages.find(p => p.url.includes('blackout'));
  assert.equal(blackout.events, 1);
  assert.equal(blackout.aiRequests, 2);
  assert.deepEqual(blackout.passes.sort(), ['context-prep', 'extraction']);
  assert.equal(blackout.aiMs, 1893 + 3120);

  const extraction = summary.aiRequestsByPass.find(p => p.pass === 'extraction');
  assert.equal(extraction.sent, 2);
  assert.equal(extraction.succeeded, 2);
  assert.equal(extraction.totalMs, 3120 + 2000);

  assert.equal(summary.merges.length, 2);
  assert.equal(summary.droppedFields.length, 1);
  assert.equal(summary.dedupe.length, 1);
  assert.equal(summary.calendar.length, 2);
  // WARN (dropped field) + ERROR (OCR timeout)
  assert.equal(summary.problems.length, 2);
  assert.equal(summary.problems.filter(p => p.level === 'error').length, 1);

  const text = formatSummary(summary);
  assert.ok(text.includes('=== PAGES ==='));
  assert.ok(text.includes('https://megawoof.example/la → 1 event(s)'));
});

test('filterByUrl restricts entries to lines about a URL', () => {
  const entries = annotateUrls(parseLog(FIXTURE));
  const filtered = filterByUrl(entries, 'megawoof.example');
  assert.ok(filtered.length >= 3);
  // The blackout page's prompt payload must not leak in
  assert.ok(!filtered.some(e => e.message.includes('Full prompt (context-prep pass)')));
  const summary = buildSummary(filtered);
  assert.equal(summary.pages.length, 1);
  assert.equal(summary.pages[0].url, 'https://megawoof.example/la');
});

test('extractAiPayloads returns full payload bodies, filterable by pass type', () => {
  const entries = annotateUrls(parseLog(FIXTURE));
  const all = extractAiPayloads(entries);
  assert.equal(all.length, 3); // 2 prompts + 1 response

  const contextPrep = extractAiPayloads(entries, 'context-prep');
  assert.equal(contextPrep.length, 1);
  assert.equal(contextPrep[0].kind, 'Full prompt');
  assert.ok(contextPrep[0].text.includes('FURBALL BLACKOUT July 10 2026'));
  assert.equal(contextPrep[0].url, 'https://furball.example/events/blackout');
});

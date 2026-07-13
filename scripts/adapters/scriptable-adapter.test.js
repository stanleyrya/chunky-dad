const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Headless load of the Scriptable adapter: stub the Scriptable globals the
// module touches at require time (importModule, FileManager) so the pure
// HTML-builder methods can be exercised under Node. WebView/Calendar/Device
// are NOT stubbed on purpose — the methods under test must never touch them.
// ---------------------------------------------------------------------------
global.importModule = (name) => require(path.join(__dirname, '..', name));

const fileManagerStub = {
  documentsDirectory: () => '/tmp/chunky-dad-adapter-test',
  joinPath: (a, b) => `${a}/${b}`,
  fileExists: () => false,
  isDirectory: () => false,
  createDirectory: () => {},
  fileName: (filePath) => String(filePath).split('/').pop(),
  readString: () => null,
  writeString: () => {},
  downloadFileFromiCloud: async () => {}
};
global.FileManager = {
  iCloud: () => fileManagerStub,
  local: () => fileManagerStub
};

const { ScriptableAdapter } = require('./scriptable-adapter');

const LOG_FIXTURE = [
  '2026-07-12T03:00:00.000Z [INFO] SYSTEM: Bearracuda → bearracuda (1 URL): https://bearracuda.com/',
  '2026-07-12T03:00:01.000Z [INFO] SYSTEM: Classified https://bearracuda.com/ → eventlist',
  '2026-07-12T03:00:02.000Z [INFO] SYSTEM: Parsed https://bearracuda.com/ → 0 events, 2 links',
  '2026-07-12T03:00:03.000Z [INFO] SYSTEM: Following 2 discovered URLs → 2 unique for crawl depth 1',
  '2026-07-12T03:00:04.000Z [INFO] SYSTEM: Crawling 2 discovered URLs (depth 1/1)',
  '2026-07-12T03:00:05.000Z [INFO] SYSTEM: Classified https://bearracuda.com/events/atlanta → event',
  '2026-07-12T03:00:06.000Z [INFO] 🤖 AI Web: Running AI extraction for https://bearracuda.com/events/atlanta (12 fields)',
  '2026-07-12T03:00:07.000Z [INFO] 🤖 AI Web: Sending AI request (extraction pass) to http://rybook.example:8000/v1/chat/completions — model: qwen, provider: openai, prompt: 4000 chars',
  '2026-07-12T03:00:07.100Z [DEBUG] 🤖 AI Web: Full prompt (extraction pass) (4000 chars)',
  'SECRET PAYLOAD BODY that must never be embedded in the display HTML',
  '2026-07-12T03:00:09.000Z [INFO] 🤖 AI Web: AI request (extraction pass) succeeded in 2000ms — response: 400 chars',
  '2026-07-12T03:00:10.000Z [INFO] SYSTEM: Parsed https://bearracuda.com/events/atlanta → 1 event',
  '2026-07-12T03:00:11.000Z [INFO] SYSTEM: Classified https://bearracuda.com/events/seattle → event',
  '2026-07-12T03:00:12.000Z [INFO] SYSTEM: Parsed https://bearracuda.com/events/seattle → 1 event',
  '2026-07-12T03:00:13.000Z [INFO] SYSTEM: Event filtering complete: 2 → 2 future → 2 bear → 2 final',
  '2026-07-12T03:00:14.000Z [INFO] 🤝 AI MERGE: "BEARRACUDA: Atlanta" field=bar chose scraped ("Heretic") over existing ("Heretic Atlanta") — fresher source',
  '2026-07-12T03:00:15.000Z [WARN] 🤖 AI Web: Dropped 1 field(s) lacking source evidence: shortName'
].join('\n');

function buildResultsStub() {
  return {
    analyzedEvents: [
      {
        title: 'Bear <b>Night</b>',
        _action: 'new',
        startDate: '2026-08-01T02:00:00.000Z'
      },
      {
        title: 'BEARRACUDA: Atlanta',
        _action: 'merge',
        _analysis: { reason: 'matched existing calendar event' }
      }
    ]
  };
}

function buildAdapter() {
  return new ScriptableAdapter({ cities: {} });
}

test('buildRunInsightSectionsHtml renders both collapsed sections from a run log', () => {
  const adapter = buildAdapter();
  const insights = adapter.buildRunInsightsFromLogText(LOG_FIXTURE);
  assert.equal(insights.available, true);

  const html = adapter.buildRunInsightSectionsHtml(insights, buildResultsStub());

  // Both sections exist, with <details> collapsed by default
  assert.ok(html.includes('What Happened'));
  assert.ok(html.includes('What We Did'));
  assert.equal((html.match(/<details class="log-details">/g) || []).length, 2);
  assert.ok(!html.includes('<details open'));

  // Crawl tree content: source, root and followed pages
  assert.ok(html.includes('Bearracuda (bearracuda parser)'));
  assert.ok(html.includes('https://bearracuda.com/ [eventlist]'));
  assert.ok(html.includes('├─ https://bearracuda.com/events/atlanta'));

  // Decisions: structured event actions + log-derived merge reason
  assert.ok(html.includes('NEW → CREATE: &quot;Bear &lt;b&gt;Night&lt;/b&gt;&quot;'));
  assert.ok(html.includes('MERGE → UPDATE: &quot;BEARRACUDA: Atlanta&quot; — matched existing calendar event'));
  assert.ok(html.includes('fresher source'));
  assert.ok(html.includes('Dropped 1 field(s)'));
});

test('run-insight HTML escapes markup and never embeds AI payload bodies', () => {
  const adapter = buildAdapter();
  const insights = adapter.buildRunInsightsFromLogText(LOG_FIXTURE);
  const html = adapter.buildRunInsightSectionsHtml(insights, buildResultsStub());

  assert.ok(!html.includes('SECRET PAYLOAD BODY'));
  assert.ok(!html.includes('<b>Night</b>'));
});

test('saved run without a log file renders sections with a graceful note', () => {
  const adapter = buildAdapter();
  const insights = adapter.loadRunInsightsForDisplay(
    { _isDisplayingSavedRun: true },
    { runId: '20260101-000000', exists: false, reason: 'missing-log-file' }
  );

  assert.equal(insights.available, false);
  assert.ok(insights.reason.includes('Log not found for run 20260101-000000'));

  const html = adapter.buildRunInsightSectionsHtml(insights, buildResultsStub());
  assert.ok(html.includes('What Happened'));
  assert.ok(html.includes('What We Did'));
  assert.ok(html.includes('Log not found for run 20260101-000000'));
  // Structured event actions still render from the saved-run JSON
  assert.ok(html.includes('NEW → CREATE: &quot;Bear &lt;b&gt;Night&lt;/b&gt;&quot;'));
});

test('saved run with a log file feeds its full text through the summary', () => {
  const adapter = buildAdapter();
  const insights = adapter.loadRunInsightsForDisplay(
    { _isDisplayingSavedRun: true },
    { runId: '20260101-000000', exists: true, fullText: LOG_FIXTURE, text: '' }
  );

  assert.equal(insights.available, true);
  assert.equal(insights.summary.crawl.length, 1);
  assert.equal(insights.summary.crawl[0].roots[0].children.length, 2);
});

test('long crawl lists are capped in the rendered HTML', () => {
  const adapter = buildAdapter();
  const manyPages = [
    '2026-07-12T05:00:00.000Z [INFO] SYSTEM: Big source → ai-web (1 URL): https://big.example/',
    '2026-07-12T05:00:01.000Z [INFO] SYSTEM: Parsed https://big.example/ → 0 events, 80 links',
    '2026-07-12T05:00:02.000Z [INFO] SYSTEM: Crawling 80 discovered URLs (depth 1/1)'
  ];
  for (let i = 0; i < 80; i += 1) {
    manyPages.push(`2026-07-12T05:00:03.000Z [INFO] SYSTEM: Parsed https://big.example/page-${i} → 1 event`);
  }
  const insights = adapter.buildRunInsightsFromLogText(manyPages.join('\n'));
  const html = adapter.buildRunInsightSectionsHtml(insights, buildResultsStub());

  assert.ok(html.includes('more page(s) not shown'));
  assert.ok(!html.includes('page-79'));
});

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RunLogSummary,
  parseLog,
  buildSummary,
  buildCrawlTree,
  countCrawlNodes,
  formatCrawlTreeText,
  summarizeLogText
} = require('./run-log-summary');

// Bearracuda-shaped run: one source URL classified as an event list, which links
// to per-event pages crawled at depth 1 (adapted from the analyze-scraper-log
// fixture, extended with the shared-core SYSTEM crawl lines).
const CRAWL_FIXTURE = [
  '2026-07-12T03:00:00.000Z [INFO] SYSTEM: Bearracuda → bearracuda (1 URL): https://bearracuda.com/',
  '2026-07-12T03:00:01.000Z [INFO] SYSTEM: Classified https://bearracuda.com/ → eventlist',
  '2026-07-12T03:00:02.000Z [INFO] SYSTEM: Parsed https://bearracuda.com/ → 0 events, 3 links',
  '2026-07-12T03:00:03.000Z [INFO] SYSTEM: Following 3 discovered URLs → 3 unique for crawl depth 1',
  '2026-07-12T03:00:04.000Z [INFO] SYSTEM: Crawling 3 discovered URLs (depth 1/1)',
  '2026-07-12T03:00:05.000Z [INFO] SYSTEM: Classified https://bearracuda.com/events/atlanta → event',
  '2026-07-12T03:00:06.000Z [INFO] 🤖 AI Web: Running AI extraction for https://bearracuda.com/events/atlanta (12 fields)',
  '2026-07-12T03:00:07.000Z [INFO] 🤖 AI Web: Sending AI request (extraction pass) to http://rybook.example:8000/v1/chat/completions — model: qwen, provider: openai, prompt: 4000 chars',
  '2026-07-12T03:00:07.100Z [DEBUG] 🤖 AI Web: Full prompt (extraction pass) (4000 chars)',
  'SECRET PAYLOAD BODY that must never reach the summary',
  '2026-07-12T03:00:09.000Z [INFO] 🤖 AI Web: AI request (extraction pass) succeeded in 2000ms — response: 400 chars',
  '2026-07-12T03:00:09.500Z [INFO] 🤖 AI Web: Extracted https://bearracuda.com/events/atlanta → title="BEARRACUDA: Atlanta", bar="Heretic", startDate=2026-08-01T02:00:00.000Z, city=atlanta',
  '2026-07-12T03:00:10.000Z [INFO] SYSTEM: Parsed https://bearracuda.com/events/atlanta → 1 event',
  '2026-07-12T03:00:11.000Z [INFO] SYSTEM: Classified https://bearracuda.com/events/seattle → event',
  '2026-07-12T03:00:12.000Z [INFO] SYSTEM: Parsed https://bearracuda.com/events/seattle → 1 event',
  '2026-07-12T03:00:13.000Z [ERROR] SYSTEM: Failed to process crawl page https://bearracuda.com/events/broken: HTTP 500',
  '2026-07-12T03:00:14.000Z [INFO] SYSTEM: Event filtering complete: 2 → 2 future → 2 bear → 2 final',
  '2026-07-12T03:00:15.000Z [INFO] 🤝 AI MERGE: "BEARRACUDA: Atlanta" field=bar chose scraped ("Heretic") over existing ("Heretic Atlanta") — fresher source',
  '2026-07-12T03:00:16.000Z [INFO] 🔄 PARSER MERGE: "BEARRACUDA: Atlanta" (ai-web) + "BEARRACUDA: Atlanta" (bearracuda) → 2 fields updated (bar, ticketUrl)',
  '2026-07-12T03:00:17.000Z [WARN] 🤖 AI Web: Dropped 1 field(s) lacking source evidence: shortName',
  '2026-07-12T03:00:18.000Z [INFO] 🔄 SharedCore: Deduplicated 3 → 2 (1 duplicate merged)',
  '2026-07-12T03:00:19.000Z [INFO] 🤖 AI Web: Extracted OCR from 4 image(s)'
].join('\n');

// Discovery-only run at depth 2: the tree must nest a depth-2 page under its
// depth-1 parent, then correctly return to depth 1 for the next sibling.
const DISCOVERY_FIXTURE = [
  '2026-07-12T04:00:00.000Z [INFO] SYSTEM: Sitges discovery → ai-web (1 URL): https://sitges.example/',
  '2026-07-12T04:00:01.000Z [INFO] SYSTEM: Sitges discovery → Discovery only mode (depth 2)',
  '2026-07-12T04:00:02.000Z [INFO] SYSTEM: Classified https://sitges.example/ → eventlist',
  '2026-07-12T04:00:03.000Z [INFO] SYSTEM: Parsed https://sitges.example/ → 0 events, 2 links, 2 segments',
  '2026-07-12T04:00:04.000Z [INFO] SYSTEM: Following 2 discovered URLs → 2 unique for crawl depth 1',
  '2026-07-12T04:00:05.000Z [INFO] SYSTEM: Crawling 2 discovered URLs (depth 1/2)',
  '2026-07-12T04:00:06.000Z [INFO] SYSTEM: Classified https://sitges.example/a → event',
  '2026-07-12T04:00:07.000Z [INFO] SYSTEM: Parsed https://sitges.example/a → 0 events, 1 link',
  '2026-07-12T04:00:08.000Z [INFO] SYSTEM: Crawl page https://sitges.example/a found 1 URLs → 1 unique for depth 2',
  '2026-07-12T04:00:09.000Z [INFO] SYSTEM: Crawling 1 discovered URLs (depth 2/2)',
  '2026-07-12T04:00:10.000Z [INFO] SYSTEM: Parsed https://sitges.example/a/tickets → 0 events',
  '2026-07-12T04:00:11.000Z [INFO] SYSTEM: Classified https://sitges.example/b → event',
  '2026-07-12T04:00:12.000Z [INFO] SYSTEM: Parsed https://sitges.example/b → 0 events',
  '2026-07-12T04:00:13.000Z [INFO] SYSTEM: Discovery complete: 4 URL(s) found across 3 link(s), 2 segment(s) on 1 multi-event page(s)'
].join('\n');

test('buildCrawlTree nests followed links under their source page', () => {
  const sources = buildCrawlTree(parseLog(CRAWL_FIXTURE));

  assert.equal(sources.length, 1);
  const source = sources[0];
  assert.equal(source.name, 'Bearracuda');
  assert.equal(source.parserType, 'bearracuda');
  assert.equal(source.urlCount, 1);
  assert.equal(source.discoveryOnly, false);

  assert.equal(source.roots.length, 1);
  const root = source.roots[0];
  assert.equal(root.url, 'https://bearracuda.com/');
  assert.equal(root.classification, 'eventlist');
  assert.equal(root.events, 0);
  assert.equal(root.links, 3);
  assert.equal(root.depth, 0);

  assert.equal(root.children.length, 2);
  const [atlanta, seattle] = root.children;
  assert.equal(atlanta.url, 'https://bearracuda.com/events/atlanta');
  assert.equal(atlanta.classification, 'event');
  assert.equal(atlanta.events, 1);
  assert.equal(atlanta.depth, 1);
  assert.equal(seattle.url, 'https://bearracuda.com/events/seattle');

  assert.deepEqual(source.failures, [
    { url: 'https://bearracuda.com/events/broken', error: 'HTTP 500' }
  ]);
  assert.deepEqual(source.filtering, { total: 2, future: 2, bear: 2, final: 2 });
  assert.equal(countCrawlNodes(sources), 3);
});

test('buildSummary annotates tree nodes with per-page AI stats and collects OCR', () => {
  const summary = summarizeLogText(CRAWL_FIXTURE);

  const atlanta = summary.crawl[0].roots[0].children[0];
  assert.equal(atlanta.aiRequests, 1);
  assert.deepEqual(atlanta.passes, ['extraction']);
  assert.equal(atlanta.aiMs, 2000);

  assert.equal(summary.ocr.length, 1);
  assert.ok(summary.ocr[0].includes('Extracted OCR from 4 image(s)'));

  // Debug payload bodies must never leak into the structured summary
  assert.ok(!JSON.stringify(summary).includes('SECRET PAYLOAD BODY'));
});

test('buildSummary extracts merge decisions with their reasons', () => {
  const summary = summarizeLogText(CRAWL_FIXTURE);

  assert.equal(summary.merges.length, 2);
  assert.ok(summary.merges[0].includes('chose scraped ("Heretic")'));
  assert.ok(summary.merges[0].includes('fresher source'));
  assert.ok(summary.merges[1].includes('2 fields updated (bar, ticketUrl)'));
  assert.equal(summary.droppedFields.length, 1);
  assert.equal(summary.dedupe.length, 1);
});

test('buildSummary collects warnings and errors', () => {
  const summary = summarizeLogText(CRAWL_FIXTURE);

  assert.equal(summary.problems.length, 2);
  assert.equal(summary.problems.filter(p => p.level === 'error').length, 1);
  assert.ok(summary.problems.some(p => p.line.includes('Failed to process crawl page')));
  assert.ok(summary.problems.some(p => p.line.includes('Dropped 1 field(s)')));
});

test('buildCrawlTree handles discovery-only runs across depths', () => {
  const sources = buildCrawlTree(parseLog(DISCOVERY_FIXTURE));

  assert.equal(sources.length, 1);
  const source = sources[0];
  assert.equal(source.discoveryOnly, true);
  assert.equal(source.maxDepth, 2);
  assert.deepEqual(source.discovery, {
    urls: 4,
    links: 3,
    note: '2 segment(s) on 1 multi-event page(s)'
  });

  const root = source.roots[0];
  assert.equal(root.segments, 2);
  assert.equal(root.children.length, 2);

  const [a, b] = root.children;
  assert.equal(a.url, 'https://sitges.example/a');
  assert.equal(a.children.length, 1);
  assert.equal(a.children[0].url, 'https://sitges.example/a/tickets');
  assert.equal(a.children[0].depth, 2);
  // After the depth-2 recursion, /b must return to depth 1 as a sibling of /a
  assert.equal(b.url, 'https://sitges.example/b');
  assert.equal(b.depth, 1);
  assert.equal(b.children.length, 0);
});

test('formatCrawlTreeText renders a nested tree and caps node count', () => {
  const sources = buildCrawlTree(parseLog(CRAWL_FIXTURE));
  const text = formatCrawlTreeText(sources);

  assert.ok(text.includes('Bearracuda (bearracuda parser)'));
  assert.ok(text.includes('https://bearracuda.com/ [eventlist]'));
  assert.ok(text.includes('├─ https://bearracuda.com/events/atlanta'));
  assert.ok(text.includes('└─ https://bearracuda.com/events/seattle'));
  assert.ok(text.includes('✗ failed: https://bearracuda.com/events/broken'));
  assert.ok(text.includes('filtering: 2 → 2 future → 2 bear → 2 final'));

  const capped = formatCrawlTreeText(sources, { maxNodes: 2 });
  assert.ok(capped.includes('… +1 more page(s) not shown'));
  assert.ok(!capped.includes('events/seattle'));
});

test('formatSummary includes the crawl tree section', () => {
  const text = RunLogSummary.formatSummary(summarizeLogText(CRAWL_FIXTURE));
  assert.ok(text.includes('=== CRAWL TREE ==='));
  assert.ok(text.includes('=== PAGES ==='));
  assert.ok(text.includes('=== OCR ACTIVITY (1) ==='));
});

test('gracefully handles empty and garbage input', () => {
  for (const input of ['', null, undefined, 'random garbage\nno timestamps here\n{]']) {
    const summary = buildSummary(parseLog(input));
    assert.deepEqual(summary.crawl, []);
    assert.deepEqual(summary.pages, []);
    assert.deepEqual(summary.merges, []);
    assert.equal(typeof RunLogSummary.formatSummary(summary), 'string');
    assert.equal(formatCrawlTreeText(summary.crawl), '');
  }
});

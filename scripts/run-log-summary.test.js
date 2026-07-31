const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RunLogSummary,
  parseLog,
  buildSummary,
  buildCrawlTree,
  countCrawlNodes,
  formatCrawlTreeText,
  summarizeLogText,
  buildRunSignals,
  evaluateRunHealth,
  formatRunHealthBadge
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

// ---------------------------------------------------------------------------
// Signals + run health (metrics 2.0)
// ---------------------------------------------------------------------------

// Representative production lines for every guard/AI/arbitration/funnel signal.
// Line shapes match the emitters exactly: ai-web-parser organizer-brand and
// site-tagline guards, normalizers geocode validation, shared-core merge
// guards and AI arbitration, shared-core dedup/filter summaries.
const SIGNALS_FIXTURE = [
  '2026-07-13T09:00:00.000Z [INFO] SYSTEM: Bearracuda → bearracuda (1 URL): https://bearracuda.com/',
  // AI requests: two extraction-bucket passes (free-form labels), one context-prep,
  // one failed merge-arbitration, one ocr
  '2026-07-13T09:00:01.000Z [INFO] 🤖 AI Web: Sending AI request (best meta 1/1 pass) to http://rybook.example:8000/v1/chat/completions — model: qwen, provider: openai, prompt: 4000 chars',
  '2026-07-13T09:00:02.000Z [INFO] 🤖 AI Web: AI request (best meta 1/1 pass) succeeded in 1500ms — response: 400 chars',
  '2026-07-13T09:00:03.000Z [INFO] 🤖 AI Web: Sending AI request (content 1/2 pass) to http://rybook.example:8000/v1/chat/completions — model: qwen, provider: openai, prompt: 6000 chars',
  '2026-07-13T09:00:04.000Z [INFO] 🤖 AI Web: AI request (content 1/2 pass) succeeded in 2500ms — response: 500 chars',
  '2026-07-13T09:00:05.000Z [INFO] 🤖 AI Web: Sending AI request (context-prep pass) to http://rybook.example:8000/v1/chat/completions — model: qwen, provider: openai, prompt: 2000 chars',
  '2026-07-13T09:00:06.000Z [INFO] 🤖 AI Web: AI request (context-prep pass) succeeded in 800ms — response: 200 chars',
  '2026-07-13T09:00:07.000Z [INFO] 🤖 AI Web: Sending AI request (merge-arbitration pass) to http://rybook.example:8000/v1/chat/completions — model: qwen, provider: openai, prompt: 1500 chars',
  '2026-07-13T09:00:08.000Z [WARN] 🤖 AI Web: AI request (merge-arbitration pass) to http://rybook.example:8000/v1/chat/completions with model qwen failed after 30000ms (timeout): request timed out',
  '2026-07-13T09:00:09.000Z [INFO] 🤖 AI Web: Sending AI request (ocr pass) to http://rybook.example:8000/v1/chat/completions — model: qwen, provider: openai, prompt: 900 chars',
  '2026-07-13T09:00:10.000Z [INFO] 🤖 AI Web: AI request (ocr pass) succeeded in 1200ms — response: 300 chars',
  // Organizer-brand guards: pass-result-time rejection, end-of-pipeline drop, title strip
  '2026-07-13T09:00:11.000Z [INFO] 🤖 AI Web: Rejecting bar "BEARRACUDA" from best meta 1/1 pass — matches page organizer/brand; keeping field open for later passes',
  '2026-07-13T09:00:12.000Z [INFO] 🤖 AI Web: Dropping bar "BEARRACUDA" — matches the page\'s organizer/site name, not a venue',
  '2026-07-13T09:00:13.000Z [INFO] 🤖 AI Web: Stripping page brand from title "Portland PRIDE FRIDAY | BEARRACUDA" → "Portland PRIDE FRIDAY"',
  '2026-07-13T09:00:14.000Z [INFO] 🤖 AI Web: Rejecting title "BEARRACUDA" from content 1/2 pass — the whole title is the page organizer/brand; keeping field open for later passes',
  // Site-tagline guard
  '2026-07-13T09:00:15.000Z [INFO] 🤖 AI Web: Rejecting description from best meta 1/1 pass — identical to the site\'s own tagline, not event-specific',
  // Geocode validation: distance-ranked pick, outside-city rejection, all-candidates rejection
  '2026-07-13T09:00:16.000Z [INFO] 🗺️ OpenStreetMapNormalizer: 5 candidates for "922 E. BURNSIDE"; picked #1 (1.9 km from portland center)',
  '2026-07-13T09:00:17.000Z [WARN] 🗺️ OpenStreetMapNormalizer: Geocode for "Sanctuary" resolved outside event city "portland" ("Sanctuary, Denver, Colorado") — ignoring coordinates',
  '2026-07-13T09:00:18.000Z [WARN] 🗺️ OpenStreetMapNormalizer: All 3 geocode candidates for "123 Main St" fall outside 15 km of atlanta center (nearest is 42.0 km away) — ignoring coordinates',
  // Geocode retry-ladder exhaustion (address unresolvable after all variants)
  '2026-07-13T09:00:18.500Z [WARN] 🗺️ OpenStreetMapNormalizer: No geocode results for "2069 CHESHIRE BRIDGE RD NE" (atlanta) after 3 queries — leaving location empty',
  // Maps-link pin rung (verbatim shapes from the dice.fm evidence run)
  '2026-07-13T09:00:18.600Z [INFO] 🗺️ OpenStreetMapNormalizer: No curated or geocoded pin for "BEEFMINCE x BRIGHTON" — using the page\'s maps link for "Concorde 2" -> 50.8172448,-0.122510799999986',
  '2026-07-13T09:00:18.700Z [WARN] 🗺️ MAPS LINK CONFLICT: "BOATMINCE" accepted pin 51.5022544, -0.1231736 (curated) is 936 m from the page\'s maps link 51.5099822,-0.117819 for "Westminster Pier" — accepted pin kept; verify which is the real venue',
  // Merge-time guards: degenerate end, coordinate/bar/location preservation
  '2026-07-13T09:00:19.000Z [WARN] ⚠️ MERGE: "BEARRACUDA: Portland" scraped endDate <= startDate (zero duration) — treating as missing, keeping calendar end',
  '2026-07-13T09:00:20.000Z [INFO] 📍 MERGE: "BEARRACUDA: Portland" location kept calendar coordinates over scraped text/empty value',
  '2026-07-13T09:00:21.000Z [INFO] 📍 MERGE: "BEARRACUDA: Portland" bar kept from calendar (scrape found no venue)',
  '2026-07-13T09:00:21.300Z [INFO] 📍 MERGE: "BEARRACUDA: Atlanta" location kept from calendar (scrape found none)',
  '2026-07-13T09:00:21.600Z [INFO] 📍 MERGE: "BEARRACUDA: Atlanta" location kept from existing (incoming scrape found none)',
  // AI merge arbitration: one calendar pick, one scraped pick, one bulk fallback
  '2026-07-13T09:00:22.000Z [INFO] 🤝 AI MERGE: "BEARRACUDA: Portland" field=bar chose calendar ("Sanctuary") over scraped ("BEARRACUDA") — venue, not the organizer',
  '2026-07-13T09:00:23.000Z [INFO] 🤝 AI MERGE: "BEARRACUDA: Portland" field=description chose scraped ("Doors at 9") over calendar ("TBD") — fresher source',
  '2026-07-13T09:00:24.000Z [WARN] 🤝 AI MERGE: no arbitration result for "Other Event" — falling back to scraped values for 2 conflicted field(s)',
  // Deterministic pre-arbitration resolutions (🔒): counted as a guard, never
  // as AI arbitration conflicts/picks
  '2026-07-13T09:00:24.300Z [INFO] 🔒 MERGE: "BEARRACUDA: Portland" field=website resolved deterministically — same-host deeper URL beats domain root',
  '2026-07-13T09:00:24.600Z [INFO] 🔒 MERGE: "New Orleans⚜️" field=title resolved deterministically — emoji title variant beats its emoji-stripped twin',
  // Dedup funnel
  '2026-07-13T09:00:25.000Z [INFO] SYSTEM: Event filtering complete: 18 → 16 future → 16 bear → 9 final',
  '2026-07-13T09:00:26.000Z [INFO] 🔄 SharedCore: Deduplicated 16 → 9 (removed 7)'
].join('\n');

test('buildSummary counts each guard line type', () => {
  const summary = summarizeLogText(SIGNALS_FIXTURE);

  assert.deepEqual(summary.guards, {
    brandBarRejected: 2,      // "Rejecting bar" (pass-time) + "Dropping bar" (pipeline-end)
    brandTitleStripped: 2,    // "Stripping page brand" + "Rejecting title"
    taglineRejected: 1,
    geocodePicked: 1,
    geocodeRejected: 2,       // outside-city + all-candidates-outside
    geocodeNoResults: 1,      // retry-ladder exhaustion warn
    degenerateEndCaught: 1,
    coordsPreserved: 1,
    barPreserved: 1,
    locationPreserved: 2,     // "kept from calendar" + "kept from existing"
    arbitrationDeterministic: 2, // 🔒 website root-vs-deep + 🔒 emoji-twin title
    mapsLinkPin: 1,           // pin taken from the page's maps link
    mapsLinkConflict: 1       // maps-link pin vs accepted pin, ≥ 300 m apart
  });

  // 🔒 lines are merge decisions too: they must show up in the merges list
  // (for --merges analysis) while only counting toward the guard above.
  assert.equal(summary.merges.filter(line => line.includes('🔒 MERGE')).length, 2);
});

test('buildSummary tracks failed AI requests per pass', () => {
  const summary = summarizeLogText(SIGNALS_FIXTURE);
  const arbitration = summary.aiRequestsByPass.find(stats => stats.pass === 'merge-arbitration');

  assert.equal(arbitration.sent, 1);
  assert.equal(arbitration.succeeded, 0);
  assert.equal(arbitration.failed, 1);
});

test('buildRunSignals aggregates ai, guards, arbitration, funnel and quality', () => {
  const summary = summarizeLogText(SIGNALS_FIXTURE);
  const results = {
    duplicatesRemoved: 7,
    analyzedEvents: [
      // bar + coordinates object + real duration
      {
        title: 'A', bar: 'Sanctuary',
        coordinates: { lat: 45.52, lng: -122.65 },
        startDate: '2026-08-01T02:00:00.000Z', endDate: '2026-08-01T06:00:00.000Z'
      },
      // bar + "lat,lng" location string + degenerate (zero) duration
      {
        title: 'B', bar: 'Heretic', location: '33.79, -84.32',
        startDate: '2026-08-02T02:00:00.000Z', endDate: '2026-08-02T02:00:00.000Z'
      },
      // no bar, no coords, no end date
      { title: 'C', startDate: '2026-08-03T02:00:00.000Z' }
    ]
  };

  const signals = buildRunSignals(summary, results);

  assert.deepEqual(signals.ai, {
    requests: 5,
    failures: 1,
    totalMs: 6000,
    byPass: {
      // "best meta 1/1" and "content 1/2" are free-form extraction partitions
      extraction: { n: 2, ms: 4000 },
      'context-prep': { n: 1, ms: 800 },
      'merge-arbitration': { n: 1, ms: 0 },
      ocr: { n: 1, ms: 1200 }
    }
  });
  assert.equal(signals.guards.brandBarRejected, 2);
  assert.equal(signals.guards.geocodeRejected, 2);
  assert.equal(signals.guards.arbitrationDeterministic, 2);
  // The two 🔒 lines count ONLY toward the guard above — the AI arbitration
  // conflict/pick/fallback counters must not move.
  assert.deepEqual(signals.arbitration, {
    conflicts: 4,       // 2 decided picks + 2 fields in the bulk fallback
    calendarPicks: 1,
    scrapedPicks: 1,
    fallbacks: 2
  });
  assert.deepEqual(signals.funnel, {
    found: 18, future: 16, bear: 16, final: 9, duplicatesRemoved: 7
  });
  assert.deepEqual(signals.quality, {
    events: 3, withBar: 2, withCoords: 2, withEndDuration: 1
  });
});

test('buildRunSignals derives duplicatesRemoved from the log when results omit it', () => {
  const signals = buildRunSignals(summarizeLogText(SIGNALS_FIXTURE), null);
  assert.equal(signals.funnel.duplicatesRemoved, 7);
  assert.deepEqual(signals.quality, { events: 0, withBar: 0, withCoords: 0, withEndDuration: 0 });
});

test('buildRunSignals tolerates a missing summary', () => {
  const signals = buildRunSignals(null, null);
  assert.deepEqual(signals.ai, { requests: 0, failures: 0, totalMs: 0, byPass: {} });
  assert.equal(signals.guards.brandBarRejected, 0);
  assert.deepEqual(signals.arbitration, { conflicts: 0, calendarPicks: 0, scrapedPicks: 0, fallbacks: 0 });
});

function buildHealthySignals(overrides = {}) {
  const base = buildRunSignals(null, null);
  base.funnel = { found: 10, future: 10, bear: 10, final: 8, duplicatesRemoved: 2 };
  base.quality = { events: 8, withBar: 8, withCoords: 6, withEndDuration: 7 };
  return Object.assign(base, overrides);
}

test('evaluateRunHealth: clean run is ok', () => {
  const health = evaluateRunHealth(buildHealthySignals(), { errorsCount: 0 });
  assert.deepEqual(health, { status: 'ok', reasons: [] });
  assert.equal(formatRunHealthBadge(health), '🟢 Run healthy');
});

test('evaluateRunHealth: each warn trigger fires independently', () => {
  // errors > 0
  let health = evaluateRunHealth(buildHealthySignals(), { errorsCount: 2 });
  assert.equal(health.status, 'warn');
  assert.deepEqual(health.reasons, ['2 errors']);

  // AI failures at/above threshold (a single failure stays ok)
  const oneFailure = buildHealthySignals();
  oneFailure.ai = { requests: 5, failures: 1, totalMs: 0, byPass: {} };
  assert.equal(evaluateRunHealth(oneFailure, { errorsCount: 0 }).status, 'ok');
  const twoFailures = buildHealthySignals();
  twoFailures.ai = { requests: 5, failures: 2, totalMs: 0, byPass: {} };
  health = evaluateRunHealth(twoFailures, { errorsCount: 0 });
  assert.deepEqual(health.reasons, ['AI failures ×2']);

  // geocode rejections
  const geocode = buildHealthySignals();
  geocode.guards = Object.assign({}, geocode.guards, { geocodeRejected: 1 });
  health = evaluateRunHealth(geocode, { errorsCount: 0 });
  assert.deepEqual(health.reasons, ['geocode rejected ×1']);

  // geocode retry-ladder exhaustion (address unresolvable)
  const noResults = buildHealthySignals();
  noResults.guards = Object.assign({}, noResults.guards, { geocodeNoResults: 2 });
  health = evaluateRunHealth(noResults, { errorsCount: 0 });
  assert.deepEqual(health.reasons, ['geocode no-results ×2']);

  // low venue coverage (only with >2 events)
  const lowVenue = buildHealthySignals();
  lowVenue.quality = { events: 5, withBar: 2, withCoords: 0, withEndDuration: 0 };
  health = evaluateRunHealth(lowVenue, { errorsCount: 0 });
  assert.deepEqual(health.reasons, ['no venue on 3 of 5 events']);
  const tinyRun = buildHealthySignals();
  tinyRun.quality = { events: 2, withBar: 0, withCoords: 0, withEndDuration: 0 };
  assert.equal(evaluateRunHealth(tinyRun, { errorsCount: 0 }).status, 'ok');

  // everything filtered out
  const filteredOut = buildHealthySignals();
  filteredOut.funnel = { found: 12, future: 0, bear: 0, final: 0, duplicatesRemoved: 0 };
  health = evaluateRunHealth(filteredOut, { errorsCount: 0 });
  assert.deepEqual(health.reasons, ['0 of 12 found events survived filtering']);
});

test('evaluateRunHealth: null signals warn only on errors; badge lists reasons', () => {
  assert.equal(evaluateRunHealth(null, { errorsCount: 0 }).status, 'ok');
  const health = evaluateRunHealth(null, { errorsCount: 1 });
  assert.deepEqual(health, { status: 'warn', reasons: ['1 error'] });

  const multi = evaluateRunHealth(buildHealthySignals({
    guards: Object.assign(buildRunSignals(null, null).guards, { geocodeRejected: 1 }),
    quality: { events: 5, withBar: 2, withCoords: 0, withEndDuration: 0 }
  }), { errorsCount: 0 });
  assert.equal(
    formatRunHealthBadge(multi),
    '🟡 2 warnings: geocode rejected ×1, no venue on 3 of 5 events'
  );
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

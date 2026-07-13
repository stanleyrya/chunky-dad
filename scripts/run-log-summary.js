// ============================================================================
// RUN LOG SUMMARY - PURE JAVASCRIPT LOG PARSING/SUMMARIZING
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE JavaScript business logic
//
// 🚨 CRITICAL RESTRICTIONS - NEVER ADD THESE TO THIS FILE:
// ❌ NO Node-only APIs (fs, path, process) - the CLI wrapper in tools/ owns those
// ❌ NO Scriptable APIs (FileManager, WebView, Alert) - adapters own those
// ❌ NO DOM APIs (document, window)
//
// ✅ THIS FILE SHOULD ONLY CONTAIN:
// ✅ Plain functions that take log text / entry arrays and return structured data
//
// Parses a run log written by the Scriptable adapter's FileLogger
// (Documents/chunky-dad-scraper/logs/<runId>.log, format:
//   2026-07-13T09:12:13.123Z [INFO] message
// with multi-line messages) and also tolerates raw console-paste lines
// (2026-07-13 09:12:13: message).
//
// Consumed by:
//   - tools/analyze-scraper-log.js (Node CLI wrapper)
//   - scripts/adapters/scriptable-adapter.js (run-insight sections in the
//     results / saved-run WebView displays)
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

const FILE_ENTRY_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) \[([A-Z]+)\] (.*)$/;
const PASTE_ENTRY_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\.\d+)?: (.*)$/;

// Parse log text into entries: { ts, level, message } — message may be multi-line.
function parseLog(text) {
    const entries = [];
    const lines = String(text || '').split(/\r?\n/);
    for (const line of lines) {
        let match = line.match(FILE_ENTRY_RE);
        if (match) {
            entries.push({ ts: match[1], level: match[2].toLowerCase(), message: match[3] });
            continue;
        }
        match = line.match(PASTE_ENTRY_RE);
        if (match) {
            const message = match[2];
            // Raw console pastes carry no level — infer warnings from emoji markers.
            const level = /^(⚠️|🚨|❌)/.test(message) ? 'warn' : 'info';
            entries.push({ ts: match[1], level, message });
            continue;
        }
        if (entries.length > 0) {
            entries[entries.length - 1].message += `\n${line}`;
        } else if (line.trim()) {
            entries.push({ ts: '', level: 'info', message: line });
        }
    }
    return entries;
}

const URL_CONTEXT_RES = [
    /🤖 AI Web: Running AI extraction for (\S+)/,
    /🤖 AI Web: Fields for (\S+): \d+ selected/,
    /🤖 AI Web: URL discovery stats for (\S+)/
];

// Annotate each entry with the page URL it belongs to (last URL-setting line wins).
function annotateUrls(entries) {
    let currentUrl = '';
    for (const entry of entries) {
        for (const re of URL_CONTEXT_RES) {
            const match = entry.message.match(re);
            if (match && match[1] && match[1] !== 'extraction' && match[1] !== 'unknown') {
                currentUrl = match[1];
                break;
            }
        }
        entry.url = currentUrl;
    }
    return entries;
}

function normalizePass(raw) {
    return String(raw || 'extraction').replace(/\s*pass$/i, '').trim() || 'extraction';
}

// ---------------------------------------------------------------------------
// Crawl tree — reconstructed from shared-core's SYSTEM crawl/discovery lines
// ---------------------------------------------------------------------------
// Source start:   SYSTEM: <name> → <parserType> (N URLs)[: <url>]
// Discovery mode: SYSTEM: <name> → Discovery only mode (depth N)
// Classification: SYSTEM: Classified <url> → <type>
// Page parsed:    SYSTEM: Parsed <url> → N events[, M links][, K segments]
// Depth marker:   SYSTEM: Crawling N discovered URLs (depth d/max)
// Failures:       SYSTEM: Failed to process URL <url>: msg
//                 SYSTEM: Failed to process crawl page <url>: msg
// Discovery end:  SYSTEM: Discovery complete: N URL(s) found across M link(s)...
// Filter summary: SYSTEM: Event filtering complete: A → B future → C bear → D final
const DISCOVERY_MODE_RE = /^SYSTEM: (.+?) → Discovery only mode \(depth (\d+)\)$/;
const SOURCE_LINE_RE = /^SYSTEM: (.+?) → ([A-Za-z0-9_-]+) \((\d+) URLs?\)(?:: (\S+))?$/;
const CLASSIFIED_RE = /^SYSTEM: Classified (\S+) → (\S+)$/;
const PARSED_RE = /^SYSTEM: Parsed (\S+) → (\d+) events?(?:, (\d+) links?)?(?:, (\d+) segments?)?$/;
const CRAWLING_RE = /^SYSTEM: Crawling (\d+) discovered URLs \(depth (\d+)\/(\d+)\)$/;
const FAILED_URL_RE = /^SYSTEM: Failed to process (?:URL|crawl page) (\S+): (.*)$/;
const DISCOVERY_COMPLETE_RE = /^SYSTEM: Discovery complete: (\d+) URL\(s\) found across (\d+) link\(s\)(.*)$/;
const FILTERING_RE = /^SYSTEM: Event filtering complete: (\d+) → (\d+) future → (\d+) bear → (\d+) final$/;

// Build per-source crawl trees. Returns an array of sources:
// { name, parserType, urlCount, discoveryOnly, maxDepth, roots: [node],
//   failures: [{url, error}], discovery: {urls, links, note} | null,
//   filtering: {total, future, bear, final} | null }
// where node = { url, classification, events, links, segments, depth, children: [node] }
//
// Depth attribution uses a frame stack keyed off the "Crawling N discovered URLs
// (depth d/max)" markers: the crawl is depth-first, so the N pages parsed after a
// depth-d marker are children of the page parsed immediately before it. Pages that
// fail before their "Parsed" line make a frame under-consume; frames are also popped
// whenever a shallower depth marker or a new source line arrives, so a lost page can
// only mis-nest its own siblings, never a different source.
function buildCrawlTree(entries) {
    const sources = [];
    const classifications = new Map();
    let current = null;
    let frames = null; // stack of { depth, remaining, parent }
    let lastParsedNode = null;

    const startFallbackSource = () => {
        current = {
            name: '(run)',
            parserType: null,
            urlCount: 0,
            discoveryOnly: false,
            maxDepth: null,
            roots: [],
            failures: [],
            discovery: null,
            filtering: null
        };
        sources.push(current);
        frames = [{ depth: 0, remaining: Infinity, parent: null }];
        lastParsedNode = null;
    };

    for (const entry of entries) {
        const line = entry.message.split('\n', 1)[0];

        let match = line.match(DISCOVERY_MODE_RE);
        if (match) {
            if (current && current.name === match[1]) {
                current.discoveryOnly = true;
                current.maxDepth = Number(match[2]);
            }
            continue;
        }
        match = line.match(SOURCE_LINE_RE);
        if (match) {
            current = {
                name: match[1],
                parserType: match[2],
                urlCount: Number(match[3]),
                discoveryOnly: false,
                maxDepth: null,
                roots: [],
                failures: [],
                discovery: null,
                filtering: null
            };
            sources.push(current);
            frames = [{ depth: 0, remaining: Infinity, parent: null }];
            lastParsedNode = null;
            continue;
        }
        match = line.match(CLASSIFIED_RE);
        if (match) {
            classifications.set(match[1], match[2]);
            continue;
        }
        match = line.match(CRAWLING_RE);
        if (match) {
            if (!current) continue;
            const depth = Number(match[2]);
            while (frames.length > 1 && frames[frames.length - 1].depth >= depth) {
                frames.pop();
            }
            frames.push({ depth, remaining: Number(match[1]), parent: lastParsedNode });
            if (current.maxDepth === null) current.maxDepth = Number(match[3]);
            continue;
        }
        match = line.match(PARSED_RE);
        if (match) {
            if (!current) startFallbackSource();
            while (frames.length > 1 && frames[frames.length - 1].remaining <= 0) {
                frames.pop();
            }
            const frame = frames[frames.length - 1];
            const node = {
                url: match[1],
                classification: classifications.get(match[1]) || null,
                events: Number(match[2]),
                links: match[3] ? Number(match[3]) : 0,
                segments: match[4] ? Number(match[4]) : 0,
                depth: frame.depth,
                children: []
            };
            if (frame.parent) {
                frame.parent.children.push(node);
            } else {
                current.roots.push(node);
            }
            frame.remaining -= 1;
            lastParsedNode = node;
            continue;
        }
        match = line.match(FAILED_URL_RE);
        if (match) {
            if (current) current.failures.push({ url: match[1], error: match[2] });
            continue;
        }
        match = line.match(DISCOVERY_COMPLETE_RE);
        if (match) {
            if (current) {
                current.discovery = {
                    urls: Number(match[1]),
                    links: Number(match[2]),
                    note: (match[3] || '').replace(/^,\s*/, '')
                };
            }
            continue;
        }
        match = line.match(FILTERING_RE);
        if (match) {
            if (current) {
                current.filtering = {
                    total: Number(match[1]),
                    future: Number(match[2]),
                    bear: Number(match[3]),
                    final: Number(match[4])
                };
            }
            continue;
        }
    }

    return sources;
}

function countCrawlNodes(sources) {
    let count = 0;
    const walk = (node) => {
        count += 1;
        for (const child of node.children || []) walk(child);
    };
    for (const source of Array.isArray(sources) ? sources : []) {
        for (const root of source.roots || []) walk(root);
    }
    return count;
}

// Curated OCR activity lines (per-image cache/similarity chatter is excluded).
const OCR_ACTIVITY_RES = [
    /🤖 AI Web: Extracted OCR from \d+ image/,
    /🤖 AI Web: Skipping OCR for /,
    /🤖 AI Web: OCR skipped \d+ uninteresting/,
    /🤖 AI Web: OCR image cap /,
    /🤖 AI Web: Including OCR results /,
    /🤖 AI Web: OCR top-up for /,
    /🤖 AI Web: Skipped \d+ OCR result/,
    /🤖 AI Web: Consolidated \d+ text-containing OCR results/
];

function buildSummary(entries) {
    annotateUrls(entries);
    const pages = new Map(); // url -> { events, passes:Set, aiMs, requests }
    const aiByPass = new Map(); // pass -> { sent, succeeded, totalMs }
    const merges = [];
    const droppedFields = [];
    const dedupe = [];
    const filtered = [];
    const calendar = [];
    const ocr = [];
    const problems = [];

    const pageFor = (url) => {
        const key = url || '(no url)';
        if (!pages.has(key)) pages.set(key, { events: 0, passes: new Set(), aiMs: 0, requests: 0 });
        return pages.get(key);
    };

    for (const entry of entries) {
        const msg = entry.message;
        const firstLine = msg.split('\n', 1)[0];

        if (entry.level === 'warn' || entry.level === 'error') {
            problems.push({ level: entry.level, line: firstLine });
        }

        let match = firstLine.match(/🤖 AI Web: Sending AI request(?: \(([^)]+)\))? to /);
        if (match) {
            const pass = normalizePass(match[1]);
            if (!aiByPass.has(pass)) aiByPass.set(pass, { sent: 0, succeeded: 0, totalMs: 0 });
            aiByPass.get(pass).sent += 1;
            const page = pageFor(entry.url);
            page.requests += 1;
            page.passes.add(pass);
            continue;
        }
        match = firstLine.match(/🤖 AI Web: AI request(?: \(([^)]+)\))? succeeded in (\d+)ms/);
        if (match) {
            const pass = normalizePass(match[1]);
            if (!aiByPass.has(pass)) aiByPass.set(pass, { sent: 0, succeeded: 0, totalMs: 0 });
            const stats = aiByPass.get(pass);
            stats.succeeded += 1;
            stats.totalMs += Number(match[2]);
            pageFor(entry.url).aiMs += Number(match[2]);
            continue;
        }
        match = firstLine.match(/🤖 AI Web: Extracted (\S+) →/);
        if (match) {
            pageFor(match[1]).events += 1;
            continue;
        }
        if (firstLine.includes('🤖 AI Web: Running AI extraction for')) {
            pageFor(entry.url);
            continue;
        }
        if (/🤝 AI MERGE|🔄 PARSER MERGE|🔄 MERGE/.test(firstLine)) {
            merges.push(firstLine);
            continue;
        }
        if (/Dropped \d+ field\(s\) lacking source evidence|Dropping field .* low confidence/.test(firstLine)) {
            droppedFields.push(firstLine);
            continue;
        }
        match = firstLine.match(/🔄 SharedCore: Deduplicated (\d+) → (\d+)/);
        if (match) {
            dedupe.push(firstLine);
            continue;
        }
        if (firstLine.includes('SharedCore: Filtering out event')) {
            filtered.push(firstLine);
            continue;
        }
        if (OCR_ACTIVITY_RES.some((re) => re.test(firstLine))) {
            ocr.push(firstLine);
            continue;
        }
        if (/^(📅|📊|🌍|🕐|✅ Found calendars|❌ Missing calendars)/.test(firstLine)) {
            calendar.push(firstLine);
        }
    }

    const crawl = buildCrawlTree(entries);
    // Annotate tree nodes with per-page AI stats gathered above.
    const annotateNode = (node) => {
        const page = pages.get(node.url);
        if (page) {
            node.aiRequests = page.requests;
            node.passes = Array.from(page.passes);
            node.aiMs = page.aiMs;
        }
        for (const child of node.children || []) annotateNode(child);
    };
    for (const source of crawl) {
        for (const root of source.roots || []) annotateNode(root);
    }

    return {
        pages: Array.from(pages.entries()).map(([url, data]) => ({
            url,
            events: data.events,
            aiRequests: data.requests,
            passes: Array.from(data.passes),
            aiMs: data.aiMs
        })),
        aiRequestsByPass: Array.from(aiByPass.entries()).map(([pass, s]) => ({
            pass,
            sent: s.sent,
            succeeded: s.succeeded,
            totalMs: s.totalMs,
            avgMs: s.succeeded > 0 ? Math.round(s.totalMs / s.succeeded) : 0
        })),
        crawl,
        ocr,
        merges,
        droppedFields,
        dedupe,
        filtered,
        calendar,
        problems
    };
}

// Convenience: raw log text → structured summary.
function summarizeLogText(text) {
    return buildSummary(parseLog(text));
}

// Full AI payload dumps (debug channel): Full prompt / Model response text blocks.
function extractAiPayloads(entries, passType = null) {
    const payloads = [];
    for (const entry of entries) {
        const match = entry.message.match(/^🤖 AI Web: (Full prompt|Model response text)(?: \(([^)]+)\))?/);
        if (!match) continue;
        const pass = normalizePass(match[2]);
        if (passType && pass !== normalizePass(passType)) continue;
        payloads.push({ kind: match[1], pass, url: entry.url || '', text: entry.message });
    }
    return payloads;
}

// Render crawl trees as indented plain text (used by the CLI and, HTML-escaped,
// by the Scriptable results display). options.maxNodes caps the total page nodes
// rendered across all sources; the remainder collapses to a "+N more" line.
function formatCrawlTreeText(sources, options = {}) {
    const maxNodes = Number.isFinite(options.maxNodes) && options.maxNodes > 0
        ? options.maxNodes
        : Infinity;
    const lines = [];
    let rendered = 0;
    let skipped = 0;

    const nodeLabel = (node) => {
        const parts = [];
        parts.push(`${node.events} event${node.events === 1 ? '' : 's'}`);
        if (node.links > 0) parts.push(`${node.links} link${node.links === 1 ? '' : 's'}`);
        if (node.segments > 0) parts.push(`${node.segments} segment${node.segments === 1 ? '' : 's'}`);
        if (node.aiRequests > 0) {
            const passes = Array.isArray(node.passes) && node.passes.length > 0
                ? `: ${node.passes.join(', ')}`
                : '';
            parts.push(`${node.aiRequests} AI call${node.aiRequests === 1 ? '' : 's'} (${node.aiMs}ms${passes})`);
        }
        const classification = node.classification ? ` [${node.classification}]` : '';
        return `${node.url}${classification} → ${parts.join(', ')}`;
    };

    const walk = (node, prefix, isLast) => {
        if (rendered >= maxNodes) {
            skipped += 1 + countCrawlNodes([{ roots: node.children }]);
            return;
        }
        rendered += 1;
        const connector = prefix === '' ? '' : (isLast ? '└─ ' : '├─ ');
        lines.push(`${prefix}${connector}${nodeLabel(node)}`);
        const childPrefix = prefix === '' ? '   ' : `${prefix}${isLast ? '   ' : '│  '}`;
        const children = node.children || [];
        children.forEach((child, index) => walk(child, childPrefix, index === children.length - 1));
    };

    (Array.isArray(sources) ? sources : []).forEach((source, sourceIndex) => {
        if (sourceIndex > 0) lines.push('');
        const parserLabel = source.parserType ? ` (${source.parserType} parser)` : '';
        const modeLabel = source.discoveryOnly
            ? ` [discovery-only${source.maxDepth !== null ? `, depth ${source.maxDepth}` : ''}]`
            : '';
        lines.push(`${source.name}${parserLabel}${modeLabel}`);
        (source.roots || []).forEach((root) => walk(root, '', true));
        for (const failure of source.failures || []) {
            lines.push(`   ✗ failed: ${failure.url} — ${failure.error}`);
        }
        if (source.discovery) {
            lines.push(`   discovery: ${source.discovery.urls} URL(s) via ${source.discovery.links} link(s)${source.discovery.note ? `, ${source.discovery.note}` : ''}`);
        }
        if (source.filtering) {
            lines.push(`   filtering: ${source.filtering.total} → ${source.filtering.future} future → ${source.filtering.bear} bear → ${source.filtering.final} final`);
        }
    });

    if (skipped > 0) {
        lines.push(`… +${skipped} more page(s) not shown`);
    }
    return lines.join('\n');
}

function formatSummary(summary) {
    const out = [];
    if (Array.isArray(summary.crawl) && summary.crawl.length > 0) {
        out.push('=== CRAWL TREE ===');
        out.push(formatCrawlTreeText(summary.crawl));
        out.push('');
    }
    out.push('=== PAGES ===');
    if (summary.pages.length === 0) out.push('  (none found)');
    for (const page of summary.pages) {
        out.push(`  ${page.url} → ${page.events} event(s), ${page.aiRequests} AI request(s) [${page.passes.join(', ')}], ${page.aiMs}ms AI time`);
    }
    out.push('', '=== AI REQUESTS BY PASS ===');
    if (summary.aiRequestsByPass.length === 0) out.push('  (none found)');
    for (const stats of summary.aiRequestsByPass) {
        out.push(`  ${stats.pass}: ${stats.sent} sent, ${stats.succeeded} succeeded, total ${stats.totalMs}ms, avg ${stats.avgMs}ms`);
    }
    if (Array.isArray(summary.ocr) && summary.ocr.length > 0) {
        out.push('', `=== OCR ACTIVITY (${summary.ocr.length}) ===`);
        summary.ocr.forEach(line => out.push(`  ${line}`));
    }
    out.push('', `=== MERGE DECISIONS (${summary.merges.length}) ===`);
    summary.merges.forEach(line => out.push(`  ${line}`));
    if (summary.droppedFields.length > 0) {
        out.push('', `=== DROPPED FIELDS (${summary.droppedFields.length}) ===`);
        summary.droppedFields.forEach(line => out.push(`  ${line}`));
    }
    if (summary.dedupe.length > 0 || summary.filtered.length > 0) {
        out.push('', '=== DEDUP / FILTER ===');
        summary.dedupe.forEach(line => out.push(`  ${line}`));
        summary.filtered.forEach(line => out.push(`  ${line}`));
    }
    if (summary.calendar.length > 0) {
        out.push('', '=== CALENDAR ===');
        summary.calendar.forEach(line => out.push(`  ${line}`));
    }
    out.push('', `=== WARNINGS / ERRORS (${summary.problems.length}) ===`);
    summary.problems.forEach(problem => out.push(`  [${problem.level.toUpperCase()}] ${problem.line}`));
    return out.join('\n');
}

function filterByUrl(entries, urlSubstring) {
    const needle = String(urlSubstring || '');
    return entries.filter(entry =>
        (entry.url && entry.url.includes(needle)) || entry.message.includes(needle)
    );
}

const RunLogSummary = {
    parseLog,
    annotateUrls,
    buildSummary,
    summarizeLogText,
    buildCrawlTree,
    countCrawlNodes,
    formatCrawlTreeText,
    extractAiPayloads,
    formatSummary,
    filterByUrl
};

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        RunLogSummary,
        parseLog,
        annotateUrls,
        buildSummary,
        summarizeLogText,
        buildCrawlTree,
        countCrawlNodes,
        formatCrawlTreeText,
        extractAiPayloads,
        formatSummary,
        filterByUrl
    };
} else if (typeof window !== 'undefined') {
    window.RunLogSummary = RunLogSummary;
} else {
    // Scriptable environment
    this.RunLogSummary = RunLogSummary;
}

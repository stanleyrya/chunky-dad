#!/usr/bin/env node
// ============================================================================
// analyze-scraper-log.js - Summarize a bear-event-scraper run log
//
// Reads a run log written by the Scriptable adapter's FileLogger
// (Documents/chunky-dad-scraper/logs/<runId>.log, format:
//   2026-07-13T09:12:13.123Z [INFO] message
// with multi-line messages) and also tolerates raw console-paste lines
// (2026-07-13 09:12:13: message).
//
// Usage:
//   node tools/analyze-scraper-log.js <logfile>                 run summary
//   node tools/analyze-scraper-log.js <logfile> --ai [passType] full AI payloads
//   node tools/analyze-scraper-log.js <logfile> --url <substr>  only lines for URL
//   node tools/analyze-scraper-log.js <logfile> --errors        warnings/errors only
//   node tools/analyze-scraper-log.js <logfile> --merges        merge decisions only
//   node tools/analyze-scraper-log.js <logfile> --grep <regex>  raw filtered lines
//   node tools/analyze-scraper-log.js <logfile> --json          machine-readable summary
// ============================================================================

'use strict';

const fs = require('fs');

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

function buildSummary(entries) {
    annotateUrls(entries);
    const pages = new Map(); // url -> { events, passes:Set, aiMs, requests }
    const aiByPass = new Map(); // pass -> { sent, succeeded, totalMs }
    const merges = [];
    const droppedFields = [];
    const dedupe = [];
    const filtered = [];
    const calendar = [];
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
        if (/^(📅|📊|🌍|🕐|✅ Found calendars|❌ Missing calendars)/.test(firstLine)) {
            calendar.push(firstLine);
        }
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
        merges,
        droppedFields,
        dedupe,
        filtered,
        calendar,
        problems
    };
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

function formatSummary(summary) {
    const out = [];
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

const HELP = `Analyze a bear-event-scraper run log.

Usage: node tools/analyze-scraper-log.js <logfile> [options]

Log files live in Scriptable's Documents/chunky-dad-scraper/logs/<runId>.log;
raw console pastes ("2026-07-13 09:12:13: message") are also accepted.

Options:
  (none)            run summary: pages, AI timings, merges, dropped fields,
                    dedup/filter results, calendar section, warnings/errors
  --ai [passType]   print full AI prompt/response payloads (debug lines),
                    optionally only one pass type (extraction, context-prep,
                    repair, ocr, ...)
  --url <substr>    restrict everything to lines about matching URL
  --errors          only warnings and errors
  --merges          only merge/arbitration decisions
  --grep <regex>    raw lines matching regex
  --json            machine-readable summary object
  --help            this help
`;

function main(argv) {
    const args = argv.slice(2);
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.log(HELP);
        return args.length === 0 ? 1 : 0;
    }

    const filePath = args[0];
    if (!fs.existsSync(filePath)) {
        console.error(`Log file not found: ${filePath}`);
        return 1;
    }

    const getFlagValue = (flag) => {
        const index = args.indexOf(flag);
        if (index < 0) return undefined;
        const next = args[index + 1];
        return next && !next.startsWith('--') ? next : null; // null = flag without value
    };

    let entries = parseLog(fs.readFileSync(filePath, 'utf8'));
    annotateUrls(entries);

    const urlFilter = getFlagValue('--url');
    if (urlFilter) {
        entries = filterByUrl(entries, urlFilter);
    }

    if (args.includes('--ai')) {
        const passType = getFlagValue('--ai');
        const payloads = extractAiPayloads(entries, passType || null);
        if (payloads.length === 0) {
            console.log('No AI payloads found. Payload dumps are debug-channel lines — the log capture mode must include them (default "all").');
            return 0;
        }
        payloads.forEach((payload, index) => {
            console.log(`--- [${index + 1}/${payloads.length}] ${payload.kind} (${payload.pass})${payload.url ? ` — ${payload.url}` : ''} ---`);
            console.log(payload.text);
            console.log('');
        });
        return 0;
    }

    if (args.includes('--errors')) {
        entries
            .filter(entry => entry.level === 'warn' || entry.level === 'error')
            .forEach(entry => console.log(`[${entry.level.toUpperCase()}] ${entry.message}`));
        return 0;
    }

    if (args.includes('--merges')) {
        entries
            .filter(entry => /🤝 AI MERGE|🔄 PARSER MERGE|🔄 MERGE/.test(entry.message))
            .forEach(entry => console.log(entry.message.split('\n', 1)[0]));
        return 0;
    }

    const grepPattern = getFlagValue('--grep');
    if (grepPattern) {
        const regex = new RegExp(grepPattern);
        entries
            .filter(entry => regex.test(entry.message))
            .forEach(entry => console.log(entry.message));
        return 0;
    }

    const summary = buildSummary(entries);
    if (args.includes('--json')) {
        console.log(JSON.stringify(summary, null, 2));
    } else {
        console.log(formatSummary(summary));
    }
    return 0;
}

module.exports = { parseLog, annotateUrls, buildSummary, extractAiPayloads, formatSummary, filterByUrl };

if (require.main === module) {
    process.exitCode = main(process.argv);
}

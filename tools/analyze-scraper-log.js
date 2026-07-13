#!/usr/bin/env node
// ============================================================================
// analyze-scraper-log.js - Summarize a bear-event-scraper run log (CLI)
//
// Thin Node wrapper (fs + args + printing) around the environment-agnostic
// parsing/summarizing core in scripts/run-log-summary.js — the same module the
// Scriptable displays use for their run-insight sections.
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
const {
    parseLog,
    annotateUrls,
    buildSummary,
    extractAiPayloads,
    formatSummary,
    filterByUrl
} = require('../scripts/run-log-summary');

const HELP = `Analyze a bear-event-scraper run log.

Usage: node tools/analyze-scraper-log.js <logfile> [options]

Log files live in Scriptable's Documents/chunky-dad-scraper/logs/<runId>.log;
raw console pastes ("2026-07-13 09:12:13: message") are also accepted.

Options:
  (none)            run summary: crawl tree, pages, AI timings, merges, dropped
                    fields, dedup/filter results, calendar section, warnings/errors
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

// Re-export the shared core so existing consumers/tests of this module keep working.
module.exports = { parseLog, annotateUrls, buildSummary, extractAiPayloads, formatSummary, filterByUrl };

if (require.main === module) {
    process.exitCode = main(process.argv);
}

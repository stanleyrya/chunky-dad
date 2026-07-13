#!/usr/bin/env node
// ============================================================================
// replay-run.js - Replay a saved scraper run's merge/dedup layer (CLI)
//
// Takes a run JSON written by the Scriptable adapter's saveRun()
// (Documents/chunky-dad-scraper/runs/<runId>.json, shape:
//   { version, summary, runContext, config, analyzedEvents, parserResults, errors })
// and re-runs the DETERMINISTIC merge/dedup layer over the saved scraped
// events:
//
//   1. SharedCore.deduplicateEvents over the scraped event records
//      (parserResults[].events, falling back to analyzedEvents' _original.scraper)
//   2. SharedCore.createFinalEventObject against the saved calendar snapshot
//      (_original.calendar) for events the run merged into the calendar
//
// AI arbitration is DISABLED (no HTTP adapter → arbitration returns null →
// the deterministic fallback paths run), so the replay needs no network and
// no model. The tool then diffs the replayed outcome against what the saved
// run recorded, making it a regression harness for merge changes against
// real historical runs.
//
// Usage:
//   node tools/replay-run.js <run.json>          readable diff
//   node tools/replay-run.js <run.json> --json   machine-readable diff
//   node tools/replay-run.js --help
// ============================================================================

'use strict';

const fs = require('fs');
const { SharedCore } = require('../scripts/shared-core');
const { EventSchema } = require('../scripts/event-schema');

const HELP = `Replay the deterministic merge/dedup layer of a saved scraper run.

Usage: node tools/replay-run.js <run.json> [options]

The input is a run record written by the Scriptable adapter (saveRun):
Documents/chunky-dad-scraper/runs/<runId>.json.

The scraped events saved in the run are pushed back through
SharedCore.deduplicateEvents and (for events the run merged into the calendar)
SharedCore.createFinalEventObject, with AI arbitration disabled, and the
result is diffed against the outcome the run recorded. Zero differences means
the current merge code reproduces the historical run.

Options:
  --json    print the diff as JSON
  --help    show this help
`;

// Fields compared between the saved outcome and the replayed outcome.
// notes is included deliberately: it is the calendar-as-database payload.
const COMPARED_FIELDS = [
  'title', 'startDate', 'endDate', 'location', 'bar', 'address', 'city',
  'timezone', 'ticketUrl', 'url', 'website', 'description', 'shortName',
  'image', 'cover', 'gmaps', 'instagram', 'facebook', 'notes'
];

function createCore(run) {
  const cities = run && run.config && run.config.cities && typeof run.config.cities === 'object'
    ? run.config.cities
    : {};
  return new SharedCore(cities, { eventSchema: EventSchema });
}

// Saved runs are JSON, so Dates arrive as ISO strings. Revive the two date
// fields the merge layer compares as instants.
function reviveEventDates(event) {
  if (!event || typeof event !== 'object') return event;
  const revived = { ...event };
  for (const field of ['startDate', 'endDate']) {
    const value = revived[field];
    if (typeof value === 'string' && value) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) revived[field] = date;
    }
  }
  return revived;
}

function stripAnalysisFields(event) {
  const cleaned = {};
  for (const key of Object.keys(event || {})) {
    if (key.startsWith('_')) continue;
    cleaned[key] = event[key];
  }
  return cleaned;
}

// Collect the scraped (pre-cross-parser-dedup) event records from a saved run.
// Newer runs carry them in parserResults[].events; older/partial runs fall
// back to the merge snapshots on analyzedEvents (_original.scraper), and
// finally to the analyzed events themselves.
function collectScrapedEvents(run) {
  const fromParserResults = [];
  if (run && Array.isArray(run.parserResults)) {
    for (const parserResult of run.parserResults) {
      if (parserResult && Array.isArray(parserResult.events)) {
        fromParserResults.push(...parserResult.events.filter(Boolean));
      }
    }
  }
  if (fromParserResults.length > 0) {
    return { events: fromParserResults.map(reviveEventDates), source: 'parserResults' };
  }

  const analyzed = run && Array.isArray(run.analyzedEvents) ? run.analyzedEvents.filter(Boolean) : [];
  if (analyzed.length > 0) {
    const events = analyzed.map(event => {
      const scraper = event && event._original && event._original.scraper;
      return reviveEventDates(scraper && typeof scraper === 'object' ? scraper : stripAnalysisFields(event));
    });
    return { events, source: 'analyzedEvents' };
  }

  return { events: [], source: 'none' };
}

// Rebuild the existing-calendar event that createFinalEventObject expects from
// the calendar snapshot the run saved in _original.calendar.
function buildCalendarEventFromSnapshot(calendarSnapshot) {
  if (!calendarSnapshot || typeof calendarSnapshot !== 'object') return null;
  return reviveEventDates({
    title: calendarSnapshot.title,
    startDate: calendarSnapshot.startDate,
    endDate: calendarSnapshot.endDate,
    location: calendarSnapshot.location,
    url: calendarSnapshot.url,
    notes: calendarSnapshot.notes || ''
  });
}

function serializeFieldValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Normalize date-like strings so Date-object vs ISO-string is not a diff
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
      const date = new Date(trimmed);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    return trimmed;
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }
  return String(value);
}

function matchIdentity(core, event) {
  const title = String(event && (event.title || event.name) || '').trim().toLowerCase();
  const day = core.normalizeEventDate(event && event.startDate);
  return `${title}|${day}`;
}

// Pair saved outcome events with replayed events: by saved key first, then by
// normalized title + start day.
function pairEvents(core, savedEvents, replayedEvents) {
  const pairs = [];
  const unmatchedReplayed = [...replayedEvents];

  for (const saved of savedEvents) {
    let index = -1;
    if (saved && saved.key) {
      index = unmatchedReplayed.findIndex(candidate => candidate && candidate.key === saved.key);
    }
    if (index === -1) {
      const identity = matchIdentity(core, saved);
      index = unmatchedReplayed.findIndex(candidate => matchIdentity(core, candidate) === identity);
    }
    if (index === -1) {
      pairs.push({ saved, replayed: null });
    } else {
      pairs.push({ saved, replayed: unmatchedReplayed[index] });
      unmatchedReplayed.splice(index, 1);
    }
  }

  return { pairs, unmatchedReplayed };
}

function diffEvents(saved, replayed) {
  const differences = [];
  for (const field of COMPARED_FIELDS) {
    const savedValue = serializeFieldValue(saved ? saved[field] : undefined);
    const replayedValue = serializeFieldValue(replayed ? replayed[field] : undefined);
    if (savedValue !== replayedValue) {
      differences.push({ field, saved: savedValue, replayed: replayedValue });
    }
  }
  return differences;
}

// Re-run the deterministic merge/dedup layer over a saved run and diff the
// replayed outcome against the recorded one.
// Returns { ok, scrapedSource, counts, events, unmatchedSaved, unmatchedReplayed, warnings }
async function replayRun(run) {
  const warnings = [];
  if (!run || typeof run !== 'object') {
    throw new Error('Run record is empty or not an object');
  }

  const core = createCore(run);
  if (!run.config || !run.config.cities) {
    warnings.push('Run has no saved cities config — keys and local-day matching may differ from the original run.');
  }

  const { events: scrapedEvents, source: scrapedSource } = collectScrapedEvents(run);
  if (scrapedEvents.length === 0) {
    warnings.push('Run contains no scraped events (no parserResults[].events and no analyzedEvents).');
  }

  // 1. Deterministic cross-parser dedup. No httpAdapter → AI arbitration is
  //    skipped and every conflict takes its deterministic fallback.
  const globalConfig = run.config && run.config.config ? run.config.config : null;
  const deduplicated = await core.deduplicateEvents(scrapedEvents.map(event => ({ ...event })), null, globalConfig);

  // 2. Replay the calendar merge for events the run compared against an
  //    existing calendar event (saved snapshot in _original.calendar).
  const savedEvents = Array.isArray(run.analyzedEvents) ? run.analyzedEvents.filter(Boolean) : [];
  const calendarSnapshotsByIdentity = new Map();
  for (const saved of savedEvents) {
    const snapshot = saved && saved._original && saved._original.calendar;
    const calendarEvent = buildCalendarEventFromSnapshot(snapshot);
    if (calendarEvent) {
      calendarSnapshotsByIdentity.set(matchIdentity(core, saved), calendarEvent);
      if (saved.key) calendarSnapshotsByIdentity.set(`key:${saved.key}`, calendarEvent);
    }
  }

  const replayedEvents = [];
  for (const event of deduplicated) {
    const calendarEvent = (event.key && calendarSnapshotsByIdentity.get(`key:${event.key}`))
      || calendarSnapshotsByIdentity.get(matchIdentity(core, event));
    if (calendarEvent) {
      replayedEvents.push(await core.createFinalEventObject(calendarEvent, event, {}));
    } else {
      const finalEvent = { ...event };
      if (!finalEvent.notes) finalEvent.notes = core.formatEventNotes(finalEvent);
      replayedEvents.push(finalEvent);
    }
  }

  // 3. Diff replayed outcome vs the saved outcome.
  const { pairs, unmatchedReplayed } = pairEvents(core, savedEvents, replayedEvents);
  const eventReports = [];
  const unmatchedSaved = [];
  for (const { saved, replayed } of pairs) {
    if (!replayed) {
      unmatchedSaved.push({ title: saved.title || saved.name || '(untitled)', key: saved.key || null });
      continue;
    }
    const differences = diffEvents(saved, replayed);
    eventReports.push({
      title: saved.title || saved.name || '(untitled)',
      key: saved.key || replayed.key || null,
      action: saved._action || null,
      mergedWithCalendar: Boolean(saved._original && saved._original.calendar),
      differences
    });
  }

  const differingEvents = eventReports.filter(report => report.differences.length > 0);
  return {
    ok: unmatchedSaved.length === 0 && unmatchedReplayed.length === 0 && differingEvents.length === 0,
    scrapedSource,
    counts: {
      scraped: scrapedEvents.length,
      replayed: replayedEvents.length,
      saved: savedEvents.length,
      matched: eventReports.length,
      withDifferences: differingEvents.length
    },
    events: eventReports,
    unmatchedSaved,
    unmatchedReplayed: unmatchedReplayed.map(event => ({ title: event.title || '(untitled)', key: event.key || null })),
    warnings
  };
}

function formatReplayReport(report) {
  const lines = [];
  lines.push(`Replayed ${report.counts.scraped} scraped event(s) (${report.scrapedSource}) → ${report.counts.replayed} after dedup/merge; run recorded ${report.counts.saved}.`);
  for (const warning of report.warnings) {
    lines.push(`⚠ ${warning}`);
  }
  if (report.ok) {
    lines.push('✓ Replay matches the saved run — no differences.');
    return lines.join('\n');
  }
  for (const entry of report.unmatchedSaved) {
    lines.push(`✖ Saved event has no replayed counterpart: "${entry.title}"${entry.key ? ` (key: ${entry.key})` : ''}`);
  }
  for (const entry of report.unmatchedReplayed) {
    lines.push(`✖ Replay produced an event the run did not record: "${entry.title}"${entry.key ? ` (key: ${entry.key})` : ''}`);
  }
  for (const eventReport of report.events) {
    if (eventReport.differences.length === 0) continue;
    lines.push(`✖ "${eventReport.title}"${eventReport.action ? ` [${eventReport.action}]` : ''} — ${eventReport.differences.length} field difference(s):`);
    for (const diff of eventReport.differences) {
      lines.push(`    ${diff.field}:`);
      lines.push(`      saved:    ${JSON.stringify(diff.saved)}`);
      lines.push(`      replayed: ${JSON.stringify(diff.replayed)}`);
    }
  }
  const unchanged = report.events.filter(entry => entry.differences.length === 0).length;
  lines.push(`${unchanged} event(s) identical, ${report.counts.withDifferences} with differences.`);
  return lines.join('\n');
}

function loadRunFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

async function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return args.length === 0 ? 1 : 0;
  }
  const jsonOutput = args.includes('--json');
  const filePath = args.find(arg => !arg.startsWith('--'));
  if (!filePath) {
    process.stderr.write('Missing run file path.\n\n');
    process.stderr.write(HELP);
    return 1;
  }

  let run;
  try {
    run = loadRunFile(filePath);
  } catch (error) {
    process.stderr.write(`Failed to read run file: ${error.message}\n`);
    return 1;
  }

  // The merge layer logs heavily via console.log/warn; keep the CLI output to
  // the diff itself. Set VERBOSE_REPLAY=1 to see the merge-layer logging.
  const silenced = {};
  if (!process.env.VERBOSE_REPLAY) {
    for (const level of ['log', 'info', 'debug', 'warn']) {
      silenced[level] = console[level];
      console[level] = () => {};
    }
  }
  let report;
  try {
    report = await replayRun(run);
  } finally {
    for (const level of Object.keys(silenced)) {
      console[level] = silenced[level];
    }
  }
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReplayReport(report)}\n`);
  }
  return report.ok ? 0 : 2;
}

if (require.main === module) {
  main(process.argv).then(
    code => { process.exitCode = code; },
    error => {
      process.stderr.write(`replay-run failed: ${error.message}\n`);
      process.exitCode = 1;
    }
  );
}

module.exports = {
  replayRun,
  collectScrapedEvents,
  buildCalendarEventFromSnapshot,
  reviveEventDates,
  diffEvents,
  formatReplayReport,
  COMPARED_FIELDS
};

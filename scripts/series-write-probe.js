// SERIES WRITE PROBE — tap it once in Scriptable. No questions asked.
//
// The one fact the recurring-events roadmap turns on (owner, 2026-09-30,
// "think ahead to where we are going"): when Scriptable saves ONE
// occurrence of a recurring CalendarEvent, does EventKit detach that
// occurrence (title / end time change on that night only), or does the
// change land on the whole series? Scriptable's CalendarEvent.save() has
// no "span" argument; the answer decides whether a themed night can be a
// detached occurrence of a written series or must stay its own event.
//
// Uses the calendar named exactly "chunky-dad" (the one with no city on
// it — owner, 2026-10-01), writes only events titled "CHUNKY PROBE …",
// and removes them again before it finishes:
//   1. a weekly series "CHUNKY PROBE series", next Monday 8–11 PM, four
//      occurrences;
//   2. reads the occurrences back, edits the SECOND one (title + end +2h)
//      and saves it;
//   3. reads them back again and counts how many carry the edit;
//   4. removes what it created and says if anything survived;
//   5. shows the verdict and writes it to
//      iCloud/Scriptable/chunky-dad-scraper/probes/series-write-probe.json
//      for the Mac to read.
// Not part of the scraper; not in the updater; delete the script after.

const CALENDAR_TITLE = 'chunky-dad';
const PROBE = /CHUNKY PROBE/;

async function main() {
  const findings = { ranAt: new Date().toISOString(), steps: [] };
  const note = (line) => { findings.steps.push(line); console.log(line); };

  const calendars = await Calendar.forEvents();
  const calendar = calendars.find((entry) => entry.title === CALENDAR_TITLE);
  if (!calendar) {
    const names = calendars.map((entry) => entry.title).join(', ');
    note(`no calendar titled "${CALENDAR_TITLE}" (have: ${names})`);
    await finish(findings, 'No "chunky-dad" calendar found');
    return;
  }
  findings.calendar = calendar.title;
  note(`calendar: ${calendar.title}`);

  // Anything a crashed earlier run left behind goes first.
  const leftover = await readProbes(calendar);
  if (leftover.length) {
    for (const event of leftover) { try { event.remove(); } catch (_) { /* best effort */ } }
    note(`removed ${leftover.length} probe event(s) left by an earlier run`);
  }

  // 1. the series: next Monday 20:00–23:00, weekly, four occurrences
  const start = new Date();
  start.setDate(start.getDate() + ((8 - start.getDay()) % 7 || 7));
  start.setHours(20, 0, 0, 0);
  const series = new CalendarEvent();
  series.calendar = calendar;
  series.title = 'CHUNKY PROBE series';
  series.notes = 'series-write-probe: delete me';
  series.startDate = start;
  series.endDate = new Date(start.getTime() + 3 * 3600000);
  series.addRecurrenceRule(RecurrenceRule.weeklyOccurrenceCount(1, 4));
  series.save();
  findings.seriesIdentifier = series.identifier;
  note(`series saved: ${series.identifier} (${start.toDateString()} weekly ×4)`);

  // 2. the occurrences, as the scraper's snapshot would read them
  let occurrences = await readProbes(calendar);
  findings.occurrencesRead = occurrences.length;
  findings.identifiers = occurrences.map((event) => event.identifier);
  findings.sameIdentifier = new Set(findings.identifiers).size === 1;
  note(`occurrences read: ${occurrences.length}; identifiers ${findings.sameIdentifier ? 'all the same' : 'differ'}`);
  if (occurrences.length < 2) {
    await cleanup(calendar, series, note, findings);
    await finish(findings, `Only ${occurrences.length} occurrence(s) read — see notes`);
    return;
  }

  // 3. edit the SECOND occurrence only
  occurrences.sort((a, b) => a.startDate - b.startDate);
  const second = occurrences[1];
  const secondDay = second.startDate.toDateString();
  second.title = 'CHUNKY PROBE night 2 (edited)';
  second.endDate = new Date(second.endDate.getTime() + 2 * 3600000);
  try {
    second.save();
    note(`edited occurrence saved: ${secondDay}`);
  } catch (error) {
    findings.saveError = error.message;
    note(`edited occurrence save FAILED: ${error.message}`);
  }
  occurrences = await readProbes(calendar);
  const edited = occurrences.filter((event) => /edited/.test(event.title || ''));
  findings.editedCount = edited.length;
  findings.editedDays = edited.map((event) => event.startDate.toDateString());
  findings.totalAfterEdit = occurrences.length;
  findings.verdict = edited.length === 1 ? 'single-occurrence edit DETACHES that night only'
    : edited.length === occurrences.length ? 'the edit landed on EVERY occurrence (whole series)'
    : edited.length === 0 ? 'the edit did not land at all'
    : `the edit landed on ${edited.length} of ${occurrences.length} (this and future?)`;
  note(`after the edit: ${occurrences.length} occurrences, ${edited.length} edited (${findings.editedDays.join(', ') || 'none'}) → ${findings.verdict}`);
  if (edited.length === 1) {
    findings.editedIdentifier = edited[0].identifier;
    findings.editedIdentifierDiffers = edited[0].identifier !== series.identifier;
    note(`edited night identifier ${findings.editedIdentifierDiffers ? 'DIFFERS from' : 'equals'} the series identifier`);
  }

  // 4. clean up
  await cleanup(calendar, series, note, findings);
  await finish(findings, findings.verdict);
}

async function readProbes(calendar) {
  const from = new Date(Date.now() - 86400000);
  const to = new Date(Date.now() + 60 * 86400000);
  const events = await CalendarEvent.between(from, to, [calendar]);
  return events.filter((event) => PROBE.test(event.title || ''));
}

async function cleanup(calendar, series, note, findings) {
  let removed = 0;
  for (const event of await readProbes(calendar)) {
    try { event.remove(); removed++; } catch (error) { note(`remove failed on ${event.startDate.toDateString()}: ${error.message}`); }
  }
  try { series.remove(); removed++; } catch (_) { /* already gone with its occurrences */ }
  const left = await readProbes(calendar);
  findings.removed = removed;
  findings.leftBehind = left.length;
  note(`cleanup: ${removed} remove() call(s), ${left.length} probe event(s) left behind${left.length ? ' — delete them by hand' : ''}`);
}

async function finish(findings, headline) {
  try {
    const fm = FileManager.iCloud();
    const dir = fm.joinPath(fm.documentsDirectory(), 'chunky-dad-scraper/probes');
    if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
    fm.writeString(fm.joinPath(dir, 'series-write-probe.json'), JSON.stringify(findings, null, 2));
    findings.steps.push('findings written to chunky-dad-scraper/probes/series-write-probe.json');
  } catch (error) {
    findings.steps.push(`could not write findings: ${error.message}`);
  }
  const alert = new Alert();
  alert.title = headline;
  alert.message = findings.steps.join('\n');
  alert.addAction('OK');
  await alert.present();
}

await main();
Script.complete();

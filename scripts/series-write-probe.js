// SERIES WRITE PROBE — run ONCE on the phone, by hand, in Scriptable.
//
// The one fact the recurring-events roadmap turns on (owner, 2026-09-30,
// "think ahead to where we are going"): when Scriptable saves ONE
// occurrence of a recurring CalendarEvent, does EventKit detach that
// occurrence (title / end time change on that night only), or does the
// change land on the whole series? Scriptable's CalendarEvent.save() has
// no "span" argument; the answer decides whether a themed night can be a
// detached occurrence of a written series or must stay its own event.
//
// What it does, all inside ONE calendar you pick (make a scratch calendar
// first — "probe" — nothing here touches a real event):
//   1. creates a weekly series "CHUNKY PROBE series" starting next
//      Monday, four occurrences;
//   2. reads the occurrences back, edits the SECOND one (title + end
//      +2h) and saves it;
//   3. reads them back again and counts how many carry the edit;
//   4. removes what it created (and says if anything survived);
//   5. shows an alert with the findings and writes them to
//      iCloud/Scriptable/chunky-dad-scraper/probes/series-write-probe.json
//      so the Mac can read them.
// Not part of the scraper; not in the updater; delete the script after.

async function main() {
  const findings = { ranAt: new Date().toISOString(), steps: [] };
  const note = (line) => { findings.steps.push(line); console.log(line); };

  let calendars = [];
  try {
    calendars = await Calendar.presentPicker(false);
  } catch (error) {
    note(`picker failed: ${error.message}`);
  }
  const calendar = Array.isArray(calendars) ? calendars[0] : calendars;
  if (!calendar) { await say('No calendar picked', 'Pick a scratch calendar (make one called "probe" first).'); return; }
  if (/chunky/i.test(calendar.title) && !/probe|test|scratch/i.test(calendar.title)) {
    await say('Not that one', `"${calendar.title}" looks like a real chunky.dad calendar. Make a scratch calendar called "probe" and run again.`);
    return;
  }
  findings.calendar = calendar.title;
  note(`calendar: ${calendar.title}`);

  // 1. the series: next Monday 20:00–23:00, weekly, four occurrences
  const start = new Date();
  start.setDate(start.getDate() + ((8 - start.getDay()) % 7 || 7));
  start.setHours(20, 0, 0, 0);
  const end = new Date(start.getTime() + 3 * 3600000);
  const series = new CalendarEvent();
  series.calendar = calendar;
  series.title = 'CHUNKY PROBE series';
  series.notes = 'series-write-probe: delete me';
  series.startDate = start;
  series.endDate = end;
  series.addRecurrenceRule(RecurrenceRule.weeklyOccurrenceCount(1, 4));
  series.save();
  findings.seriesIdentifier = series.identifier;
  note(`series saved: ${series.identifier} (${start.toDateString()} weekly ×4)`);

  // 2. the occurrences, as the scraper's snapshot would read them
  const windowStart = new Date(start.getTime() - 86400000);
  const windowEnd = new Date(start.getTime() + 35 * 86400000);
  const read = () => CalendarEvent.between(windowStart, windowEnd, [calendar]).filter((event) => /CHUNKY PROBE/.test(event.title || ''));
  let occurrences = await read();
  findings.occurrencesRead = occurrences.length;
  findings.identifiers = occurrences.map((event) => event.identifier);
  findings.sameIdentifier = new Set(findings.identifiers).size === 1;
  note(`occurrences read: ${occurrences.length}; identifiers ${findings.sameIdentifier ? 'all the same' : 'differ'}: ${findings.identifiers.join(' | ')}`);
  if (occurrences.length < 2) { await cleanup(occurrences, series, note); await finish(findings, 'Too few occurrences read — see notes'); return; }

  // 3. edit the SECOND occurrence only
  const second = occurrences.sort((a, b) => a.startDate - b.startDate)[1];
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
  occurrences = await read();
  const edited = occurrences.filter((event) => /edited/.test(event.title || ''));
  findings.editedCount = edited.length;
  findings.editedDays = edited.map((event) => event.startDate.toDateString());
  findings.totalAfterEdit = occurrences.length;
  findings.verdict = edited.length === 1 ? 'single-occurrence edit DETACHES that night only'
    : edited.length === occurrences.length ? 'the edit landed on EVERY occurrence (whole series)'
    : edited.length === 0 ? 'the edit did not land at all'
    : `the edit landed on ${edited.length} of ${occurrences.length} (this and future?)`;
  note(`after the edit: ${occurrences.length} occurrences, ${edited.length} edited (${findings.editedDays.join(', ')}) → ${findings.verdict}`);
  if (edited.length === 1) {
    findings.editedIdentifier = edited[0].identifier;
    findings.editedIdentifierDiffers = edited[0].identifier !== series.identifier;
    note(`edited night identifier ${findings.editedIdentifierDiffers ? 'DIFFERS from' : 'equals'} the series identifier: ${edited[0].identifier}`);
  }

  // 4. clean up
  await cleanup(occurrences, series, note, findings);
  await finish(findings, findings.verdict);
}

async function cleanup(occurrences, series, note, findings = {}) {
  let removed = 0;
  for (const event of occurrences) {
    try { event.remove(); removed++; } catch (error) { note(`remove failed on ${event.startDate.toDateString()}: ${error.message}`); }
  }
  try { series.remove(); removed++; } catch (_) { /* already gone with its occurrences */ }
  const left = CalendarEvent.between(new Date(Date.now() - 86400000), new Date(Date.now() + 60 * 86400000), [series.calendar]).filter((event) => /CHUNKY PROBE/.test(event.title || ''));
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
  await say(headline, findings.steps.join('\n'));
}

async function say(title, message) {
  const alert = new Alert();
  alert.title = title;
  alert.message = message;
  alert.addAction('OK');
  await alert.present();
}

await main();
Script.complete();

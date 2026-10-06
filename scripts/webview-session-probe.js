// DATA FOLDER PROBE — tap it once in Scriptable. No questions asked.
// (This file keeps the name of the earlier WebView probe on purpose: the
// owner reuses the script he already has on the phone instead of adding
// another — "I don't really mind if their names don't match anymore.")
//
// Why Scriptable opens slowly (owner, 2026-10-04): its iCloud folder holds
// 2.0 GB in 34,000 files, nearly all of it chunky-dad-scraper/ (runs, logs,
// caches) — the scripts are a rounding error. The way out is to keep the
// SCRIPTS where they are (the updater writes them there) and move the DATA
// to a folder of its own in iCloud Drive that scripts reach through a
// Scriptable FILE BOOKMARK. This probe answers whether that works on this
// phone before anything is moved:
//   1. how long listing the Scriptable folder takes, and how many files
//      it holds (the symptom, measured);
//   2. whether a bookmark named "chunky-dad-data" exists — if not, it says
//      how to add one (Scriptable › Settings › File Bookmarks › + › pick
//      a NEW, EMPTY folder in iCloud Drive called chunky-dad-data) and
//      stops;
//   3. with the bookmark: which FileManager can use it (local, iCloud, or
//      both) — write a file, read it back, list the folder, make a
//      subfolder, delete the file — and how long each takes;
//   4. the verdict, shown and written to
//      chunky-dad-scraper/probes/data-folder-probe.json for the Mac.
// Nothing is moved, nothing else is written. Not part of the scraper.

const BOOKMARK = 'chunky-dad-data';

async function main() {
  const findings = { ranAt: new Date().toISOString(), bookmark: BOOKMARK, steps: [] };
  const note = (line) => { findings.steps.push(line); console.log(line); };
  const icloud = FileManager.iCloud();
  const local = FileManager.local();

  // 1. the symptom
  const docs = icloud.documentsDirectory();
  let t = Date.now();
  const top = icloud.listContents(docs);
  findings.topLevelEntries = top.length;
  findings.topLevelListMs = Date.now() - t;
  note(`Scriptable folder: ${top.length} entries at the top, listed in ${findings.topLevelListMs} ms`);
  const dataDir = icloud.joinPath(docs, 'chunky-dad-scraper');
  if (icloud.fileExists(dataDir)) {
    t = Date.now();
    const counts = {};
    let total = 0;
    for (const sub of icloud.listContents(dataDir)) {
      const p = icloud.joinPath(dataDir, sub);
      if (!icloud.isDirectory(p)) { total += 1; continue; }
      const n = countFiles(icloud, p, 3);
      counts[sub] = n;
      total += n;
    }
    findings.dataFiles = total;
    findings.dataCounts = counts;
    findings.dataCountMs = Date.now() - t;
    note(`chunky-dad-scraper/: ${total} files (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}), counted in ${findings.dataCountMs} ms`);
  }

  // 2. the bookmark
  const bookmarks = typeof local.allFileBookmarks === 'function' ? local.allFileBookmarks().map((b) => (b && b.name) || String(b)) : [];
  findings.bookmarks = bookmarks;
  const exists = typeof local.bookmarkExists === 'function' && local.bookmarkExists(BOOKMARK);
  findings.bookmarkExists = exists;
  if (!exists) {
    note(`no file bookmark named "${BOOKMARK}" (bookmarks: ${bookmarks.join(', ') || 'none'})`);
    note('To add it: Files app → iCloud Drive → new EMPTY folder "chunky-dad-data". Then Scriptable → Settings → File Bookmarks → + → Pick Folder → that folder → name it chunky-dad-data. Run this probe again.');
    await finish(findings, 'Add the chunky-dad-data bookmark, then run again');
    return;
  }

  // 3. which manager can use it
  findings.managers = {};
  for (const [label, fm] of [['local', local], ['iCloud', icloud]]) {
    const result = { ok: false };
    try {
      const t0 = Date.now();
      const base = fm.bookmarkedPath(BOOKMARK);
      result.path = base;
      result.isDirectory = fm.isDirectory(base);
      const file = fm.joinPath(base, 'probe.json');
      const sub = fm.joinPath(base, 'probe-sub');
      fm.writeString(file, JSON.stringify({ hello: 'from ' + label, at: new Date().toISOString() }));
      result.writeMs = Date.now() - t0;
      const back = JSON.parse(fm.readString(file));
      result.readBack = back.hello;
      result.listed = fm.listContents(base);
      if (!fm.fileExists(sub)) fm.createDirectory(sub, true);
      result.subfolder = fm.isDirectory(sub);
      if (typeof fm.isFileDownloaded === 'function') { try { result.isFileDownloaded = fm.isFileDownloaded(file); } catch (e) { result.isFileDownloaded = `error: ${e.message}`; } }
      fm.remove(file);
      try { fm.remove(sub); } catch (_) {}
      result.totalMs = Date.now() - t0;
      result.ok = back.hello === 'from ' + label;
      note(`${label} manager: write/read/list/mkdir OK in ${result.totalMs} ms at ${base}`);
    } catch (error) {
      result.error = error.message;
      note(`${label} manager: ${error.message}`);
    }
    findings.managers[label] = result;
  }
  const working = Object.entries(findings.managers).filter(([, r]) => r.ok).map(([k]) => k);
  findings.verdict = working.length
    ? `the bookmarked folder works through ${working.join(' and ')} — the data can move out of Scriptable's folder`
    : 'neither manager could use the bookmarked folder — the data must stay where it is';
  note(`verdict: ${findings.verdict}`);
  await finish(findings, findings.verdict);
}

function countFiles(fm, dir, depth) {
  let n = 0;
  for (const name of fm.listContents(dir)) {
    const p = fm.joinPath(dir, name);
    if (fm.isDirectory(p)) n += depth > 0 ? countFiles(fm, p, depth - 1) : 0;
    else n += 1;
  }
  return n;
}

async function finish(findings, headline) {
  try {
    const fm = FileManager.iCloud();
    const dir = fm.joinPath(fm.documentsDirectory(), 'chunky-dad-scraper/probes');
    if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
    fm.writeString(fm.joinPath(dir, 'data-folder-probe.json'), JSON.stringify(findings, null, 2));
    findings.steps.push('findings written to chunky-dad-scraper/probes/data-folder-probe.json');
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

// SEND TO CHUNKY.DAD — the share-sheet inbox, phone side (owner, 2026-10-02:
// Shortcuts' Save File action would not cooperate; Scriptable writes the
// file instead).
//
// Shortcut "Send to chunky.dad", two actions:
//   1. Run JavaScript on Web Page (on the Shortcut Input, a Safari page):
//        completion(JSON.stringify({ url: location.href, title: document.title,
//          html: document.documentElement.outerHTML, savedAt: new Date().toISOString() }));
//   2. Scriptable › Run Script — script "send-to-chunky", Input = the
//      JavaScript Result (Show When Run off).
//
// This script takes that JSON (as text or already parsed), checks it has a
// url and a page, and writes it to
//   iCloud/Scriptable/chunky-dad-scraper/inbox/<timestamp>.json
// — the one inbox folder the next Mac run sorts by file type
// (tools/run-once.js addSharedPagesParser): a .json is a saved page, a
// picture (.png/.jpg/.heic…, saved there straight from Files or the share
// sheet) is a flyer to read, a .txt is links. Nothing else is touched. Not
// part of the scraper's updater set unless the owner adds it.

function readInput() {
  const raw = typeof args !== 'undefined' ? args.shortcutParameter : undefined;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try { return JSON.parse(raw); } catch (_) { return { parseError: true, text: raw }; }
  }
  if (Array.isArray(raw) && raw.length) return readFrom(raw[0]);
  // Run by hand with a page shared straight to Scriptable (URLs enabled in
  // the script settings): only the URL is known, no logged-in HTML.
  if (typeof args !== 'undefined' && Array.isArray(args.urls) && args.urls.length) return { url: args.urls[0], html: '', title: '', onlyUrl: true };
  return null;
}
function readFrom(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') { try { return JSON.parse(value); } catch (_) { return { parseError: true, text: value }; } }
  return null;
}

function stamp() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
}

async function main() {
  const entry = readInput();
  let outcome = '';
  if (!entry) {
    outcome = 'Nothing to save — run this from the "Send to chunky.dad" shortcut on a Safari page.';
  } else if (entry.parseError) {
    outcome = `The shortcut handed over text that is not JSON (${String(entry.text).slice(0, 60)}…) — check the JavaScript action.`;
  } else if (typeof entry.url !== 'string' || !/^https?:\/\//i.test(entry.url)) {
    outcome = 'The page has no URL — nothing saved.';
  } else if (entry.onlyUrl || typeof entry.html !== 'string' || entry.html.length < 200) {
    outcome = `${entry.url}\n\nOnly the address arrived, not the page. Share from Safari through the shortcut (its JavaScript step reads the logged-in page).`;
  } else {
    const fm = FileManager.iCloud();
    const dir = fm.joinPath(fm.documentsDirectory(), 'chunky-dad-scraper/inbox');
    if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
    const file = fm.joinPath(dir, `${stamp()}.json`);
    const record = { url: entry.url, title: String(entry.title || ''), html: entry.html, savedAt: entry.savedAt || new Date().toISOString(), via: 'share-sheet' };
    fm.writeString(file, JSON.stringify(record));
    outcome = `Saved for the next run:\n${record.title || record.url}\n(${Math.round(entry.html.length / 1024)} KB)`;
  }
  console.log(outcome);
  if (typeof Notification !== 'undefined') {
    const note = new Notification();
    note.title = 'chunky.dad';
    note.body = outcome.split('\n')[0];
    try { await note.schedule(); } catch (_) { /* no notification permission: the log has it */ }
  }
  if (typeof Script !== 'undefined' && typeof Script.setShortcutOutput === 'function') Script.setShortcutOutput(outcome);
}

await main();
Script.complete();

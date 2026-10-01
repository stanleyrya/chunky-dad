// WEBVIEW SESSION PROBE — tap it in Scriptable; tap it again tomorrow.
//
// Decides whether a logged-in site (dilf.uk) can be read by the nightly
// phone script without an account on the Mac: does a Scriptable WebView
// keep its cookies between runs, and can a WebView that is never
// presented load a page, run its JavaScript and hand the HTML back?
//
// No questions asked. Every run:
//   1. a never-presented WebView loads PAGE_URL and reads it: did the
//      page render, is it logged in (no password field, a sign-out or
//      account link);
//   2. only when that read says NOT logged in: a web view opens on
//      LOGIN_URL — log in, close it — and step 1 runs again;
//   3. the verdict is shown and written to
//      iCloud/Scriptable/chunky-dad-scraper/probes/webview-session-probe.json.
// The first run answers "can it read headlessly"; a run a day later that
// comes up logged in without opening the login view answers "do cookies
// persist". Nothing is scraped, nothing else is written.
//
// Instagram and Facebook are deliberately not what this reads: automated
// logged-in reads there are how accounts get banned; they stay
// share-sheet sources.

const PAGE_URL = 'https://dilf.uk/events';
const LOGIN_URL = 'https://dilf.uk/login';

async function main() {
  const findings = { ranAt: new Date().toISOString(), pageUrl: PAGE_URL, steps: [] };
  const note = (line) => { findings.steps.push(line); console.log(line); };
  const fm = FileManager.iCloud();
  const dir = fm.joinPath(fm.documentsDirectory(), 'chunky-dad-scraper/probes');
  const file = fm.joinPath(dir, 'webview-session-probe.json');
  let previous = null;
  try { if (fm.fileExists(file)) { await fm.downloadFileFromiCloud(file); previous = JSON.parse(fm.readString(file)); } } catch (_) { previous = null; }
  findings.previousRunAt = previous ? previous.ranAt : null;
  findings.previousLoggedIn = previous ? previous.loggedIn === true : null;

  findings.firstRead = await headlessRead(note, 'first headless read');
  let loggedIn = isLoggedIn(findings.firstRead);
  findings.openedLogin = false;
  if (!loggedIn) {
    note('not logged in — opening the login page; log in, then close the web view');
    const shown = new WebView();
    await shown.loadURL(LOGIN_URL);
    await shown.present(false);
    findings.openedLogin = true;
    findings.secondRead = await headlessRead(note, 'headless read after login');
    loggedIn = isLoggedIn(findings.secondRead);
  }
  const last = findings.secondRead || findings.firstRead;
  findings.loggedIn = loggedIn;
  findings.pageRendered = Boolean(last && last.textChars > 500);
  findings.cookiesPersisted = previous && previous.loggedIn === true ? !findings.openedLogin && loggedIn : null;
  findings.verdict = [
    findings.pageRendered ? 'headless read renders the page' : `headless read did NOT render the page (${last ? last.textChars : 0} text chars)`,
    loggedIn ? 'logged in' : 'NOT logged in',
    findings.cookiesPersisted === null ? (findings.openedLogin ? 'run again tomorrow for the cookie answer' : 'first run') : (findings.cookiesPersisted ? 'cookies PERSIST between runs' : 'cookies did NOT persist')
  ].join('; ');
  note(`verdict: ${findings.verdict}`);
  try {
    if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
    fm.writeString(file, JSON.stringify(findings, null, 2));
    note('findings written to chunky-dad-scraper/probes/webview-session-probe.json');
  } catch (error) {
    note(`could not write findings: ${error.message}`);
  }
  const alert = new Alert();
  alert.title = findings.verdict;
  alert.message = findings.steps.join('\n');
  alert.addAction('OK');
  await alert.present();
}

const PROBE_JS = `
  (function () {
    var text = document.body ? document.body.innerText : '';
    var html = document.documentElement ? document.documentElement.outerHTML : '';
    var links = Array.prototype.map.call(document.querySelectorAll('a[href]'), function (a) { return (a.textContent || '').trim().toLowerCase() + ' → ' + a.getAttribute('href'); });
    var signOut = links.filter(function (l) { return /log ?out|sign ?out|my account|profile/.test(l); }).slice(0, 5);
    var loginForm = Boolean(document.querySelector('input[type="password"]'));
    return JSON.stringify({ title: document.title, textChars: text.length, htmlChars: html.length, links: links.length, signOut: signOut, loginForm: loginForm, cookieChars: (document.cookie || '').length, sample: text.slice(0, 300) });
  })()`;

// Load, then read three times (right away, 4 s, 10 s): a page that needs
// its JavaScript shows up in the later reads. Returns the fullest read.
async function headlessRead(note, label) {
  const view = new WebView();
  const startedAt = Date.now();
  try {
    await view.loadURL(PAGE_URL);
  } catch (error) {
    note(`${label}: loadURL failed — ${error.message}`);
    return null;
  }
  note(`${label}: loadURL resolved in ${Date.now() - startedAt} ms`);
  let best = null;
  for (const delay of [0, 4000, 6000]) {
    if (delay) await wait(delay);
    try {
      const result = JSON.parse(await view.evaluateJavaScript(PROBE_JS, false));
      note(`${label} +${Math.round((Date.now() - startedAt) / 1000)}s: "${result.title}", ${result.textChars} text chars, ${result.links} links, password field ${result.loginForm ? 'PRESENT' : 'absent'}, account links ${result.signOut.length ? result.signOut.join(' ; ') : 'none'}, document.cookie ${result.cookieChars} chars`);
      if (!best || result.textChars >= best.textChars) best = result;
    } catch (error) {
      note(`${label}: evaluateJavaScript failed — ${error.message}`);
    }
  }
  return best;
}

function isLoggedIn(read) { return Boolean(read && !read.loginForm && read.signOut.length > 0); }
function wait(ms) { return new Promise((resolve) => Timer.schedule(ms, false, resolve)); }

await main();
Script.complete();

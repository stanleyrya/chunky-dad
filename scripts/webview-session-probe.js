// WEBVIEW SESSION PROBE — run by hand on the phone, twice.
//
// Decides whether a logged-in site (dilf.uk; never Instagram — see the
// note below) can be read by the nightly phone script without an account
// on the Mac: does a Scriptable WebView keep its cookies between runs,
// and can a WebView that is never presented load a page, run its
// JavaScript and hand the HTML back?
//
// Run 1: asks for the site's login page URL, presents a WebView, you log
//        in and close it. Then, in the SAME run, a second, never-presented
//        WebView loads the page URL you give and reports whether it is
//        logged in (a sign-out link, your name, no login form).
// Run 2 (tomorrow): same script, answer "no" to logging in — it only
//        does the headless read. Logged in on run 2 = cookies persist.
// Findings land in chunky-dad-scraper/probes/webview-session-probe.json.
// Nothing is written anywhere else; nothing is scraped.
//
// Instagram: do not point this at it. Automated reads of a logged-in
// Instagram session are how accounts get banned; Instagram stays a
// share-sheet source.

async function main() {
  const findings = { ranAt: new Date().toISOString(), steps: [] };
  const note = (line) => { findings.steps.push(line); console.log(line); };
  const fm = FileManager.iCloud();
  const dir = fm.joinPath(fm.documentsDirectory(), 'chunky-dad-scraper/probes');
  const file = fm.joinPath(dir, 'webview-session-probe.json');
  let previous = null;
  try { if (fm.fileExists(file)) { await fm.downloadFileFromiCloud(file); previous = JSON.parse(fm.readString(file)); } } catch (_) { previous = null; }

  const pageUrl = await ask('Page to read (logged in)', previous && previous.pageUrl ? previous.pageUrl : 'https://dilf.uk/events', previous && previous.pageUrl);
  if (!pageUrl || /instagram\.com|facebook\.com/i.test(pageUrl)) { await say('Not that site', 'Instagram and Facebook stay share-sheet sources. Point the probe at dilf.uk or another small site.'); return; }
  findings.pageUrl = pageUrl;

  const doLogin = await choose('Log in first?', 'Run 1: yes — a web view opens, log in, then close it.\nRun 2 (a day later): no — just the headless read.', ['Yes, log in', 'No, just read']);
  if (doLogin === 0) {
    const loginUrl = await ask('Login page URL', pageUrl, pageUrl);
    const shown = new WebView();
    await shown.loadURL(loginUrl);
    await shown.present(false);
    note('login web view closed');
  }

  // The headless read: never presented.
  const quiet = new WebView();
  const startedAt = Date.now();
  await quiet.loadURL(pageUrl);
  note(`headless loadURL resolved in ${Date.now() - startedAt} ms`);
  const probeJs = `
    (function () {
      var text = document.body ? document.body.innerText : '';
      var html = document.documentElement ? document.documentElement.outerHTML : '';
      var links = Array.prototype.map.call(document.querySelectorAll('a[href]'), function (a) { return (a.textContent || '').trim().toLowerCase() + ' → ' + a.getAttribute('href'); });
      var signOut = links.filter(function (l) { return /log ?out|sign ?out|my account|profile/.test(l); }).slice(0, 5);
      var loginForm = Boolean(document.querySelector('input[type="password"]'));
      return JSON.stringify({ title: document.title, textChars: text.length, htmlChars: html.length, links: links.length, signOut: signOut, loginForm: loginForm, cookieChars: (document.cookie || '').length, sample: text.slice(0, 300) });
    })()`;
  const readAt = async (label) => {
    try {
      const raw = await quiet.evaluateJavaScript(probeJs, false);
      const result = JSON.parse(raw);
      note(`${label}: title "${result.title}", ${result.textChars} text chars, ${result.htmlChars} html chars, ${result.links} links, password field ${result.loginForm ? 'PRESENT (not logged in)' : 'absent'}, sign-out/account links ${result.signOut.length ? result.signOut.join(' ; ') : 'none'}, document.cookie ${result.cookieChars} chars`);
      return result;
    } catch (error) {
      note(`${label}: evaluateJavaScript failed — ${error.message}`);
      return null;
    }
  };
  findings.readImmediately = await readAt('right after load');
  await wait(4000);
  findings.readAfter4s = await readAt('4 s later');
  await wait(6000);
  findings.readAfter10s = await readAt('10 s later');
  const last = findings.readAfter10s || findings.readAfter4s || findings.readImmediately;
  findings.loggedIn = Boolean(last && !last.loginForm && last.signOut.length > 0);
  findings.pageRendered = Boolean(last && last.textChars > 500);
  findings.verdict = !last ? 'headless read failed'
    : `${findings.pageRendered ? 'page rendered headlessly' : 'page did NOT render headlessly (' + last.textChars + ' chars)'}; ${findings.loggedIn ? 'LOGGED IN' : 'not logged in'}${doLogin === 0 ? ' (same run as the login)' : ' (a later run — ' + (findings.loggedIn ? 'cookies PERSIST' : 'cookies did not persist') + ')'}`;
  findings.loginThisRun = doLogin === 0;
  findings.previousRunAt = previous ? previous.ranAt : null;
  note(`verdict: ${findings.verdict}`);
  try {
    if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
    fm.writeString(file, JSON.stringify(findings, null, 2));
    note('findings written to chunky-dad-scraper/probes/webview-session-probe.json');
  } catch (error) {
    note(`could not write findings: ${error.message}`);
  }
  await say(findings.verdict, findings.steps.join('\n'));
}

function wait(ms) { return new Promise((resolve) => Timer.schedule(ms, false, resolve)); }

async function ask(title, placeholder, defaultValue) {
  const alert = new Alert();
  alert.title = title;
  alert.addTextField(placeholder, defaultValue || '');
  alert.addAction('OK');
  alert.addCancelAction('Cancel');
  const choice = await alert.present();
  if (choice === -1) return '';
  return alert.textFieldValue(0).trim();
}

async function choose(title, message, actions) {
  const alert = new Alert();
  alert.title = title;
  alert.message = message;
  actions.forEach((label) => alert.addAction(label));
  return alert.present();
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

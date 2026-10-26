#!/usr/bin/env node
// The deck out of reach, in real Chrome: the worker serves the saved deck
// when the server is gone, a swipe made then waits in the outbox, and it is
// sent once the server is back. Dev only (not in the test suite): needs
// Google Chrome and a run file.
//
//   node tools/deck-offline-check.js [path/to/run.json]
//
// Starts its own scratch server (a copy of the run file in a temp shared
// dir, so your real decisions are never touched), drives Chrome over the
// DevTools protocol on localhost (a secure context, so the worker runs),
// and prints what it saw. Exit code 1 when a step did not hold.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8790 + Math.floor(Math.random() * 100);
const CDP = 9500 + Math.floor(Math.random() * 100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reviewQueue = require('./review-queue');

function getJson(url) { return new Promise((resolve, reject) => http.get(url, (res) => { let s = ''; res.on('data', (d) => s += d); res.on('end', () => resolve(JSON.parse(s))); }).on('error', reject)); }
function getText(url) { return new Promise((resolve, reject) => http.get(url, (res) => { let s = ''; res.on('data', (d) => s += d); res.on('end', () => resolve({ status: res.statusCode, body: s })); }).on('error', reject)); }

async function main() {
    const sharedRoot = reviewQueue.resolveSharedRoot();
    const runsDir = path.join(sharedRoot, 'runs');
    const runFile = process.argv[2] || (fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((f) => f.endsWith('.json')).sort().reverse().map((f) => path.join(runsDir, f))[0] : null);
    if (!runFile) throw new Error('no run file found — pass one');
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-offline-'));
    fs.mkdirSync(path.join(scratch, 'runs'));
    fs.copyFileSync(runFile, path.join(scratch, 'runs', path.basename(runFile)));
    console.log(`run ${path.basename(runFile)} → scratch ${scratch}`);
    const failures = [];
    const check = (label, ok, detail) => { console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) failures.push(label); };

    let server = null;
    const startServer = async () => {
        server = spawn(process.execPath, [path.join(__dirname, 'serve-results.js'), '--port', String(PORT)], { env: { ...process.env, CHUNKY_SHARED_STORAGE_DIR: scratch }, stdio: 'ignore' });
        for (let i = 0; i < 60; i++) { await sleep(500); try { const r = await getText(`http://127.0.0.1:${PORT}/review/deck.json`); if (r.status === 200) return; } catch (_) {} }
        throw new Error('scratch server did not start');
    };
    const stopServer = async () => { if (server) { server.kill('SIGKILL'); server = null; } await sleep(500); };
    await startServer();

    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-offline-chrome-'));
    const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--no-first-run', '--window-size=400,900', 'about:blank'], { stdio: 'ignore' });
    let targets = [];
    for (let i = 0; i < 40 && !targets.length; i++) { await sleep(250); try { targets = (await getJson(`http://127.0.0.1:${CDP}/json`)).filter((t) => t.type === 'page'); } catch (_) {} }
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0; const waiting = new Map(); const errors = [];
    ws.addEventListener('message', (m) => { const msg = JSON.parse(m.data); if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } if (msg.method === 'Runtime.exceptionThrown') errors.push((msg.params.exceptionDetails.exception || {}).description); });
    const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; waiting.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
    const evalJs = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? 'EXC ' + (r.result.exceptionDetails.exception || {}).description : r.result.result.value; };
    await send('Page.enable'); await send('Runtime.enable');
    const url = `http://localhost:${PORT}/review`;
    const go = async () => { await send('Page.navigate', { url }); await sleep(4000); };
    // `left` is the stack's own count ("12 left"); the stage only draws the top few cards.
    const state = () => evalJs("JSON.stringify({ run: (window.__reviewDeck || {}).runId, cards: Number((((document.getElementById('left') || {}).textContent || '').match(/\\d+/) || [0])[0]), outbox: (document.getElementById('outbox') || {}).textContent || '', hidden: !!(document.getElementById('outbox') || {}).hidden, waiting: JSON.parse(localStorage.getItem('chunky-deck-outbox') || '[]').length, decidedWaiting: document.querySelectorAll('#decided li').length })");

    try {
        await go();
        for (let i = 0; i < 40; i++) { if ((await evalJs("navigator.serviceWorker.getRegistration().then(r => !!(r && r.active))")) === true) break; await sleep(250); }
        await sleep(2500);
        const online = JSON.parse(await state());
        check('deck loaded with the worker active', online.cards > 0 && (await evalJs("navigator.serviceWorker.getRegistration().then(r => !!(r && r.active))")) === true, `${online.cards} cards on the stack, run ${online.run}`);
        const saved = await evalJs("caches.open('deck-pages-v1').then(c => c.keys()).then(k => k.map(r => new URL(r.url).pathname))");
        check('the first load was saved by the handshake', Array.isArray(saved) && saved.includes('/review'), JSON.stringify(saved));

        await stopServer();
        await go();
        const offline = JSON.parse(await state());
        check('with the server gone, the saved deck opens', offline.cards > 0 && offline.run === online.run, `${offline.cards} cards`);
        check('and says the Mac is out of reach', !offline.hidden && /out of reach/.test(offline.outbox), offline.outbox.slice(0, 90));

        await evalJs("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); 1");
        await sleep(1500);
        const swiped = JSON.parse(await state());
        check('a swipe made offline waits in the outbox', swiped.waiting === 1 && swiped.cards === offline.cards - 1 && /1 swipe waiting/.test(swiped.outbox), `${offline.cards} → ${swiped.cards} left; ${swiped.outbox.slice(0, 120)}`);
        const waitingKey = await evalJs("JSON.parse(localStorage.getItem('chunky-deck-outbox'))[0].body.key");
        await go();
        const reloaded = JSON.parse(await state());
        check('after a reload the swiped card stays decided (waiting)', reloaded.waiting === 1 && reloaded.cards === offline.cards - 1 && reloaded.decidedWaiting >= 1, `${reloaded.cards} cards, ${reloaded.decidedWaiting} decided`);

        await startServer();
        await evalJs("window.dispatchEvent(new Event('online')); 1");
        let sentOk = false;
        for (let i = 0; i < 30; i++) { await sleep(500); if (JSON.parse(await state()).waiting === 0) { sentOk = true; break; } }
        check('back online, the waiting swipe is sent by itself', sentOk);
        const decisions = JSON.parse((await getText(`http://127.0.0.1:${PORT}/review/decisions.json`)).body);
        check('and the server has it', (decisions.decisions || []).some((d) => d.key === waitingKey), waitingKey);
        const after = JSON.parse(await state());
        check('the amber line is gone', after.hidden, after.outbox);
        check('no page errors', errors.length === 0, JSON.stringify(errors).slice(0, 300));
    } finally {
        ws.close(); chrome.kill('SIGKILL'); await stopServer();
        fs.rmSync(profile, { recursive: true, force: true });
        fs.rmSync(scratch, { recursive: true, force: true });
    }
    if (failures.length) { console.log(`\n${failures.length} check(s) failed`); process.exit(1); }
    console.log('\nall checks held');
}

main().catch((e) => { console.error(e); process.exit(1); });

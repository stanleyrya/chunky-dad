#!/usr/bin/env node
// Fit check in real Chrome: every built-in plan renders with its pieces and
// no overlaps, a shared link opened by a friend is kept the moment it is
// changed (fractions of an inch included), duplicate and delete work, and
// a screenshot of each plan lands next to this script's output dir. Dev
// only (not in the test suite): needs Google Chrome.
//
//   node tools/fit-check-check.js [--out DIR] [--width 1200]
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const OUT = opt('--out', os.tmpdir());
const WIDTH = Number(opt('--width', 1200));
const SITE = path.join(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 5100 + Math.floor(Math.random() * 100), CDP = 9600 + Math.floor(Math.random() * 100);
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', png: 'image/png', jpg: 'image/jpeg' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const file = path.join(SITE, p);
    if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).slice(1)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
});
function getJson(url) { return new Promise((resolve, reject) => http.get(url, (res) => { let s = ''; res.on('data', (d) => s += d); res.on('end', () => resolve(JSON.parse(s))); }).on('error', reject)); }

(async () => {
    await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-check-chrome-'));
    const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--no-first-run', `--window-size=${WIDTH},1100`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
    let targets = [];
    for (let i = 0; i < 40 && !targets.length; i++) { await sleep(250); try { targets = (await getJson(`http://127.0.0.1:${CDP}/json`)).filter((t) => t.type === 'page'); } catch (_) {} }
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0; const waiting = new Map(); const errors = [];
    ws.addEventListener('message', (m) => { const msg = JSON.parse(m.data); if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } if (msg.method === 'Runtime.exceptionThrown') errors.push((msg.params.exceptionDetails.exception || {}).description); });
    const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; waiting.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
    const evalJs = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result.exceptionDetails ? 'EXC ' + (r.result.exceptionDetails.exception || {}).description : r.result.result.value; };
    await send('Page.enable'); await send('Runtime.enable');
    // Headless Chrome will not open a window narrower than ~500px; a phone width needs emulation.
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1100, deviceScaleFactor: 1, mobile: WIDTH < 600 });
    const url = `http://localhost:${PORT}/testing/fit-check.html`;
    const go = async (u) => { await send('Page.navigate', { url: 'about:blank' }); await sleep(200); await send('Page.navigate', { url: u }); await sleep(2500); };
    const failures = [];
    const check = (label, ok, detail) => { console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) failures.push(label); };
    const shot = async (name) => {
        const height = Math.min(6000, Number(await evalJs('document.documentElement.scrollHeight')) || 1100);
        const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: WIDTH, height, scale: 1 } });
        const file = path.join(OUT, `fit-check-${WIDTH}-${name}.png`); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); return file;
    };
    try {
        await go(url);
        const ids = await evalJs('BUILT_IN.map(b => b.id)');
        for (const planId of ids) {
            await evalJs(`localStorage.setItem('fitcheck-active', JSON.stringify(${JSON.stringify(planId)})); 1`);
            await go(url);
            const info = JSON.parse(await evalJs("JSON.stringify({ sel: document.getElementById('aptSel').value, scale: document.getElementById('scaleInfo').textContent, items: document.querySelectorAll('g.item').length, bad: document.querySelectorAll('g.item.bad').length, groups: [...document.querySelectorAll('#aptSel optgroup')].map(g => g.label) })"));
            check(`${planId}: renders with its pieces, no overlaps`, info.sel === planId && info.items > 0 && info.bad === 0 && /px per inch/.test(info.scale), `${info.items} pieces, ${info.scale}, groups ${info.groups.join(' / ')}`);
            console.log('   screenshot', await shot(planId));
        }
        // A friend opens a share link, adds a mirror with fractions, reloads.
        const hash = await evalJs(`encodeShare(apts[${JSON.stringify(ids[0])}])`);
        await evalJs('localStorage.clear(); 1');
        await go(url + hash);
        const seen = JSON.parse(await evalJs("JSON.stringify({ name: apt().name, shared: !!apt().shared, pieces: apt().furniture.length, banner: document.getElementById('shareBanner').textContent.trim() })"));
        check('a share link opens as a shared plan', seen.shared && seen.pieces > 0, seen.banner.slice(0, 70));
        await evalJs("document.getElementById('fName').value = 'Mirror'; document.getElementById('fW').value = '30.75'; document.getElementById('fD').value = '2.375'; document.getElementById('addForm').requestSubmit(); 1");
        await sleep(800);
        await go(url);
        const kept = JSON.parse(await evalJs("JSON.stringify({ name: apt().name, shared: !!apt().shared, pieces: apt().furniture.length, hasMirror: apt().furniture.some(f => f.w === 30.75 && f.d === 2.375), group: (document.getElementById('aptSel').selectedOptions[0].parentNode.label || '') })"));
        check('changing it keeps it as the friend\'s own (fractions and all), listed under Yours', !kept.shared && kept.hasMirror && kept.pieces === seen.pieces + 1 && kept.group === 'Yours', `${kept.pieces} pieces in "${kept.group}"`);
        // Duplicate, then delete the duplicate with the confirm.
        await evalJs("document.getElementById('dupApt').click(); 1"); await sleep(600);
        const dup = JSON.parse(await evalJs("JSON.stringify({ name: apt().name, pieces: apt().furniture.length, count: Object.keys(apts).length })"));
        check('Duplicate makes a second layout', / · layout 2$/.test(dup.name) && dup.pieces === kept.pieces, dup.name);
        await evalJs("document.getElementById('delApt').click(); 1"); await sleep(300);
        const confirmShown = await evalJs("!document.getElementById('delConfirm').hidden && document.getElementById('delConfirm').textContent.includes('Delete')");
        await evalJs("document.getElementById('delYes').click(); 1"); await sleep(600);
        const afterDelete = JSON.parse(await evalJs("JSON.stringify({ count: Object.keys(apts).length, name: apt().name })"));
        check('Delete asks in place, then removes the plan', confirmShown === true && afterDelete.count === dup.count - 1, `now on "${afterDelete.name}"`);
        // × on a row removes that piece.
        const before = Number(await evalJs('apt().furniture.length'));
        await evalJs("document.querySelector('#list .row .x').click(); 1"); await sleep(300);
        check('× on a row removes the piece', Number(await evalJs('apt().furniture.length')) === before - 1);
        // Nothing wider than the screen: the widest elements past the viewport, by selector.
        const overflow = JSON.parse(await evalJs("JSON.stringify((() => { const vw = document.documentElement.clientWidth; const wide = []; for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect(); if (r.right > vw + 1 && r.width > 0) wide.push([Math.round(r.right - vw), el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : '')]); } wide.sort((a, b) => b[0] - a[0]); return { scrollWidth: document.documentElement.scrollWidth, vw, wide: wide.slice(0, 6) }; })())"));
        check(`nothing wider than the ${WIDTH}px screen`, overflow.scrollWidth <= overflow.vw && overflow.wide.length === 0, overflow.wide.map(([px, sel]) => `${sel} +${px}px`).join(', ') || `scrollWidth ${overflow.scrollWidth}`);
        check('no page errors', errors.length === 0, JSON.stringify(errors).slice(0, 300));
    } finally {
        ws.close(); chrome.kill('SIGKILL'); server.close();
        await sleep(500);
        try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) { /* Chrome still letting go of its profile */ }
    }
    if (failures.length) { console.log(`\n${failures.length} check(s) failed`); process.exit(1); }
    console.log('\nall checks held');
})().catch((e) => { console.error(e); process.exit(1); });

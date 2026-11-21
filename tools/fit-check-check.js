#!/usr/bin/env node
// Fit check in real Chrome: every built-in plan renders with its pieces and
// no overlaps, a shared link opened by a friend is kept the moment it is
// changed (fractions of an inch included), duplicate and delete work, and
// a screenshot of each plan lands next to this script's output dir. Dev
// only (not in the test suite): needs Google Chrome. At a phone width (--width 390) it also
// drives a pinch and a touch drag, so pinch zoom and the loupe are checked for real.
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
        // Diagonals: a piece turns a few degrees in place, is drawn turned, and overlap follows its real outline, not its box.
        await evalJs('localStorage.clear(); 1'); await go(url);
        const diag = JSON.parse(await evalJs(`JSON.stringify((() => {
            const a = apt(); a.furniture = withIds([{ name: 'Long', w: 60, d: 10, x: 40, y: 40, r: 0 }, { name: 'Corner', w: 10, d: 10, x: 41, y: 41, r: 0 }, { name: 'Far', w: 20, d: 20, x: 200, y: 200, r: 0 }]);
            const long = a.furniture[0], corner = a.furniture[1], far = a.furniture[2]; selected = long; renderStage(); renderPanel();
            const mid = it => { const D = dims(it); return [it.x + D.w / 2, it.y + D.h / 2]; };
            const m0 = mid(long), flatOverlap = overlaps(long, corner);
            const press = sel => { const b = document.querySelector(sel); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); };
            for (let i = 0; i < 9; i++) press('.selbar .turn button[data-turn="5"]');
            const m1 = mid(long), D = dims(long);
            // In the empty top-right corner of the turned piece's box: no overlap. On its middle: overlap.
            corner.x = long.x + D.w - 11; corner.y = long.y + 1; const boxOnly = overlaps(long, corner);
            corner.x = m1[0] - 5; corner.y = m1[1] - 5; const onIt = overlaps(long, corner);
            renderStage(); renderPanel();
            const g = [...document.querySelectorAll('g.item')].find(x => x._item === long), rect = g.querySelector('rect:not(.hit)');
            const out = { r: long.r, moved: Math.hypot(m1[0] - m0[0], m1[1] - m0[1]), box: [D.w, D.h], flatOverlap, boxOnly, onIt, transform: rect.getAttribute('transform') || '', bar: document.getElementById('selWho').textContent, badMarks: document.querySelectorAll('g.item.bad').length, status: document.getElementById('status').textContent };
            press('.selbar .turn button[data-turn="-5"]'); out.back = long.r;
            document.getElementById('fR').value = '30'; document.getElementById('updatePiece').click(); out.typed = long.r; out.typedMoved = Math.hypot(mid(long)[0] - m0[0], mid(long)[1] - m0[1]);
            long.r = 90; long.x = 40; long.y = 40; const q = dims(long); out.quarter = [q.w, q.h];
            long.r = 30; far.r = 12.5; return out;
        })())`));
        const side = 70 / Math.SQRT2;
        check('↻ turns a piece 5° at a time about its middle', diag.r === 45 && diag.moved < 0.02 && diag.back === 40, `nine presses: ${diag.r}°, middle moved ${diag.moved.toFixed(3)}", one back: ${diag.back}°`);
        check('a diagonal piece is drawn turned and the bar shows its angle', /^rotate\(45 /.test(diag.transform) && /45°/.test(diag.bar) && Math.abs(diag.box[0] - side) < 0.01 && Math.abs(diag.box[1] - side) < 0.01, `${diag.transform.slice(0, 24)} · "${diag.bar}"`);
        check('overlap follows the turned outline, not the box around it', diag.flatOverlap === true && diag.boxOnly === false && diag.onIt === true && diag.badMarks === 2 && /2 pieces overlapping/.test(diag.status), `in the box corner: ${diag.boxOnly}, on the piece: ${diag.onIt}, ${diag.status}`);
        check('an exact angle can be typed, and a quarter turn still swaps width and depth', diag.typed === 30 && diag.typedMoved < 0.02 && diag.quarter[0] === 10 && diag.quarter[1] === 60, `typed ${diag.typed}°, quarter turn box ${diag.quarter.join(' × ')}`);
        const diagHash = await evalJs('encodeShare(apt())');
        await evalJs('localStorage.clear(); 1'); await go(url + diagHash);
        const diagSeen = JSON.parse(await evalJs("JSON.stringify({ angles: apt().furniture.map(f => f.r), turned: [...document.querySelectorAll('g.item rect:not(.hit)')].filter(r => /^rotate\\(/.test(r.getAttribute('transform') || '')).length })"));
        check('a share link carries the angles', diagSeen.angles.join(',') === '30,0,12.5' && diagSeen.turned === 2, `angles ${diagSeen.angles.join(', ')}; ${diagSeen.turned} drawn turned`);
        await evalJs('selected = apt().furniture[0]; renderStage(); renderPanel(); 1'); await sleep(300);
        console.log('   screenshot', await shot('diagonals'));
        await evalJs('localStorage.clear(); 1');
        // Phone handling: fingertip-sized grab areas, nudge arrows, new pieces in view, pinch zoom, the loupe.
        await go(url);
        const hits = JSON.parse(await evalJs("JSON.stringify((() => { const rs = [...document.querySelectorAll('g.item rect.hit')].map(r => r.getBoundingClientRect()); return { n: rs.length, pieces: document.querySelectorAll('g.item').length, small: rs.filter(r => r.width < 43 || r.height < 43).length }; })())"));
        check('every piece has a grab area at least a fingertip wide', hits.n === hits.pieces && hits.small === 0, `${hits.n} areas, ${hits.small} under 43px`);
        await evalJs("selected = apt().furniture[0]; renderStage(); renderPanel(); 1");
        const nudged = JSON.parse(await evalJs("JSON.stringify((() => { const x0 = selected.x; const b = document.querySelector('.selbar .nudge button[data-nudge=\"1,0\"]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' })); return { moved: selected.x - x0, undo: !document.getElementById('undo').disabled, barPos: getComputedStyle(document.getElementById('selbar')).position, shown: document.getElementById('selbar').classList.contains('show') }; })())"));
        check('the ▶ arrow nudges the selected piece one inch and can be undone', nudged.moved === 1 && nudged.undo, `moved ${nudged.moved}", bar ${nudged.barPos}`);
        if (WIDTH < 600) check('the selected-piece bar rides along the bottom on a phone', nudged.shown && nudged.barPos === 'sticky', nudged.barPos);
        const placed = JSON.parse(await evalJs("JSON.stringify((() => { setZoom(3); const st = document.querySelector('.stage'); st.scrollLeft = st.scrollWidth * 0.4; st.scrollTop = st.scrollHeight * 0.4; document.getElementById('fName').value = 'Nightstand'; document.getElementById('fW').value = '20'; document.getElementById('fD').value = '16'; document.getElementById('addForm').requestSubmit(); const it = apt().furniture[apt().furniture.length - 1]; const g = [...document.querySelectorAll('g.item')].find(x => x._item === it); const r = g.querySelector('rect:not(.hit)').getBoundingClientRect(), b = document.querySelector('.stage').getBoundingClientRect(); return { name: it.name, x: it.x, y: it.y, inView: r.left >= b.left && r.right <= b.right && r.top >= b.top && r.bottom <= b.bottom, zoom }; })())"));
        check('a new piece lands inside the part of the plan on screen', placed.name === 'Nightstand' && placed.inView && placed.x > 12, `at ${placed.x}", ${placed.y}" with zoom ${placed.zoom}`);
        // Zoom keeps the plan picture: the same <image> node before and after. A rebuilt node loads the picture again, which is the blink.
        const steady = JSON.parse(await evalJs(`JSON.stringify((() => {
            const picture = () => document.querySelector('#plan image'); picture()._kept = 1;
            setZoom(2); const z = document.getElementById('zoom'); z.value = '2.6'; z.dispatchEvent(new Event('input', { bubbles: true }));
            const afterZoom = picture()._kept === 1;
            selected = apt().furniture[0]; renderStage(); renderPanel();
            const b = document.querySelector('.selbar .nudge button[data-nudge="1,0"]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
            return { afterZoom, afterNudge: picture()._kept === 1, zoom, width: Math.round(document.querySelector('#plan').getBoundingClientRect().width), fit: Math.round(apt().img.w * fitScale * zoom) };
        })())`));
        check('zooming and nudging keep the plan picture in place (no rebuild, so no blink)', steady.afterZoom === true && steady.afterNudge === true && Math.abs(steady.zoom - 2.6) < 0.01 && steady.width === steady.fit, `kept through zoom ${steady.afterZoom}, through a nudge ${steady.afterNudge}; zoom ${steady.zoom}, plan ${steady.width}px wide`);
        // A held turn always ends: two presses before one lift, a lift that never arrives, a lift somewhere else on the page.
        const held = JSON.parse(await evalJs(`(async () => {
            const wait = ms => new Promise(r => setTimeout(r, ms));
            selected = apt().furniture[0]; selected.r = 0; renderStage(); renderPanel();
            const b = document.querySelector('.selbar .turn button[data-turn="5"]');
            const down = id => b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: id }));
            down(11); down(12); await wait(900);
            const during = selected.r;
            b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 12 }));
            const atLift = selected.r; await wait(500); const afterLift = selected.r;
            down(13); await wait(700); window.dispatchEvent(new Event('blur'));
            const atBlur = selected.r; await wait(500); const afterBlur = selected.r;
            down(14); await wait(700); document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 14 }));
            const atElsewhere = selected.r; await wait(500);
            return JSON.stringify({ during, atLift, afterLift, atBlur, afterBlur, atElsewhere, afterElsewhere: selected.r, picture: document.querySelector('#plan image')._kept === 1 });
        })()`));
        check('a held ↻ keeps turning and always stops: after a double press, a lift that never came, a lift elsewhere', held.during >= 10 && held.afterLift === held.atLift && held.afterBlur === held.atBlur && held.afterElsewhere === held.atElsewhere && held.picture === true, `turned to ${held.during}° while held; after the lift ${held.atLift}° then ${held.afterLift}°; page left ${held.atBlur}° then ${held.afterBlur}°; lift elsewhere ${held.atElsewhere}° then ${held.afterElsewhere}°`);
        // The round handle: a real mouse drags it around the piece. The piece follows by the degree and catches on 15° steps.
        const knob = JSON.parse(await evalJs(`JSON.stringify((() => {
            setZoom(1); const it = apt().furniture[0]; it.r = 0; selected = it; renderStage(); renderPanel();
            const k = document.querySelector('.turner .knob'); if (!k) return { none: true };
            k.scrollIntoView({ block: 'center', inline: 'center' });
            const r = k.getBoundingClientRect(), g = [...document.querySelectorAll('g.item')].find(x => x._item === it).querySelector('rect:not(.hit)').getBoundingClientRect(), D = dims(it);
            return { kx: r.left + r.width / 2, ky: r.top + r.height / 2, cx: g.left + g.width / 2, cy: g.top + g.height / 2, mx: it.x + D.w / 2, my: it.y + D.h / 2 };
        })())`));
        if (knob.none) check('the selected piece has a round handle to turn it', false, 'no handle drawn');
        else {
            const at = (deg) => { const t = deg * Math.PI / 180, vx = knob.kx - knob.cx, vy = knob.ky - knob.cy; return { x: knob.cx + vx * Math.cos(t) - vy * Math.sin(t), y: knob.cy + vx * Math.sin(t) + vy * Math.cos(t) }; };
            const mouse = (type, deg) => send('Input.dispatchMouseEvent', { type, ...at(deg), button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' });
            await mouse('mouseMoved', 0); await mouse('mousePressed', 0);
            for (let d = 4; d <= 36; d += 4) await mouse('mouseMoved', d);
            await mouse('mouseMoved', 37); await sleep(50);
            const free = Number(await evalJs('selected.r'));
            for (let d = 40; d <= 84; d += 4) await mouse('mouseMoved', d);
            await mouse('mouseMoved', 88.4); await sleep(50);
            const caught = Number(await evalJs('selected.r'));
            await mouse('mouseReleased', 88.4); await sleep(150);
            const turned = JSON.parse(await evalJs(`JSON.stringify((() => { const it = selected, D = dims(it); return { r: it.r, moved: Math.hypot(it.x + D.w / 2 - ${knob.mx}, it.y + D.h / 2 - ${knob.my}), bar: document.getElementById('selWho').textContent, undo: !document.getElementById('undo').disabled, handle: !!document.querySelector('.turner .knob'), turning: !!turning, picture: document.querySelector('#plan image')._kept === 1 }; })())`));
            check('dragging the round handle turns the piece about its middle, by the degree, catching on 15° steps', Math.abs(free - 37) <= 1 && free % 15 !== 0 && caught === 90 && turned.r === 90 && turned.moved < 0.02 && /90°/.test(turned.bar) && turned.undo && turned.handle && !turned.turning && turned.picture === true, `at 37° of travel: ${free}°; at 88.4°: ${caught}°; let go at ${turned.r}°, middle moved ${turned.moved.toFixed(3)}", bar "${turned.bar}"`);
        }
        await evalJs("setZoom(1); localStorage.clear(); 1");
        if (WIDTH < 600) {
            await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
            await go(url);
            const box = JSON.parse(await evalJs("JSON.stringify(document.querySelector('.stage').getBoundingClientRect())"));
            await evalJs("document.querySelector('#plan image')._kept = 1; 1");
            await send('Input.synthesizePinchGesture', { x: box.x + box.width / 2, y: box.y + box.height / 2, scaleFactor: 2.2, relativeSpeed: 400, gestureSourceType: 'touch' });
            await sleep(600);
            const pinched = JSON.parse(await evalJs("JSON.stringify({ zoom, page: window.visualViewport ? window.visualViewport.scale : 1, slider: document.getElementById('zoom').value, picture: document.querySelector('#plan image')._kept === 1 })"));
            check('a pinch on the plan zooms the plan, not the page', pinched.zoom > 1.4 && Math.abs(pinched.page - 1) < 0.01, `zoom ${pinched.zoom.toFixed(2)}, page scale ${pinched.page}, slider ${pinched.slider}`);
            check('the plan picture stays in place through a pinch and the lift after it', pinched.picture === true);
            await evalJs("setZoom(1); 1");
            const piece = JSON.parse(await evalJs("JSON.stringify((() => { const r = document.querySelector('g.item rect:not(.hit)').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())"));
            await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: piece.x, y: piece.y, id: 1 }] });
            for (let i = 1; i <= 6; i++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: piece.x + i * 6, y: piece.y + i * 5, id: 1 }] }); await sleep(30); }
            const loupe = JSON.parse(await evalJs("JSON.stringify((() => { const l = document.getElementById('loupe'), r = l.getBoundingClientRect(); return { shown: l.classList.contains('show'), viewBox: (l.querySelector('svg') || {}).getAttribute ? l.querySelector('svg').getAttribute('viewBox') : '', above: r.bottom <= " + piece.y + ", dragging: !!drag }; })())"));
            console.log('   screenshot', await shot('loupe'));
            await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await sleep(200);
            const after = JSON.parse(await evalJs("JSON.stringify({ shown: document.getElementById('loupe').classList.contains('show'), dragging: !!drag })"));
            check('dragging a piece by touch shows the loupe above the finger, lifting hides it', loupe.shown && loupe.dragging && loupe.above && !!loupe.viewBox && !after.shown && !after.dragging, `during ${JSON.stringify(loupe)} after ${JSON.stringify(after)}`);
            await send('Emulation.setTouchEmulationEnabled', { enabled: false });
        }
        // Saved layouts: three old layouts on the tape-measured plan (kept at the size its picture
        // used to be) and one on the scanned plan.
        await evalJs(`(() => { localStorage.clear();
            const site = id => BUILT_IN.find(b => b.id === id), old = site('measured-apartment'), scan = site('scanned-apartment');
            const piece = (n, x) => ({ id: 'p' + n + x, name: 'Sofa', w: 80, d: 36, x, y: 20, r: 0 });
            const saved = {};
            ['a', 'b', 'c'].forEach((k, i) => { saved['apt-old' + k] = { id: 'apt-old' + k, name: 'Old try ' + (i + 1), ppi: 4.27, img: { src: old.img.src, w: old.img.w, h: old.img.h + 144 }, furniture: [piece(k, 20 + i * 10)], t: Date.now() - (i + 2) * 864e5 }; });
            saved['apt-new1'] = { id: 'apt-new1', name: 'Scan try', ppi: scan.ppi, img: { ...scan.img }, furniture: [piece('n', 30), piece('n', 130)], t: Date.now() };
            localStorage.setItem('fitcheck-apts', JSON.stringify(saved)); localStorage.setItem('fitcheck-active', JSON.stringify('apt-new1')); })(); 1`);
        await go(url);
        const savesJs = (body) => evalJs(`JSON.stringify((() => { const box = document.getElementById('saves'); const plans = [...box.querySelectorAll('.plan')]; const planOf = t => plans.find(p => p.querySelector('.plan-name').textContent.includes(t)); const row = id => [...box.querySelectorAll('.lay')].find(r => r._id === id); const btn = (el, t) => [...el.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(t)); const stored = () => JSON.parse(localStorage.getItem('fitcheck-apts') || '{}'); ${body} })())`).then(JSON.parse);
        const listed = await savesJs(`const old = BUILT_IN.find(b => b.id === 'measured-apartment'), o = apts['apt-olda']; const m = planOf('as measured'), sc = planOf('3D scan');
            return { built: BUILT_IN.length, fresh: o.img.h === old.img.h && o.ppi === old.ppi, plans: plans.length, first: plans[0].querySelector('.plan-name').textContent, measured: m && m.querySelector('small').textContent, all: !!(m && btn(m, 'Delete all 3')), scanAll: !!btn(sc, 'Delete all'), meta: row('apt-new1').querySelector('.meta').textContent, noDelOnSite: !btn(row('scanned-apartment'), '🗑') };`);
        check('a layout saved on a site plan takes that plan\'s current size', listed.fresh === true);
        check('Saved layouts lists every plan with its layouts, the open one first, with pieces and the day it changed', listed.plans === listed.built && /3D scan/.test(listed.first) && /^3 layouts of yours/.test(listed.measured) && listed.all && !listed.scanAll && /^2 pieces · changed today/.test(listed.meta) && listed.noDelOnSite, `${listed.plans} plans; "${listed.measured}"; "${listed.meta}"`);
        await savesJs(`row('apt-oldb').querySelector('.nm').click(); return 1;`); await sleep(400);
        const opened = await savesJs(`return { id: activeId, on: row('apt-oldb').classList.contains('on'), sel: document.getElementById('aptSel').value, first: plans[0].querySelector('.plan-name').textContent };`);
        check('tapping a layout opens it', opened.id === 'apt-oldb' && opened.on && opened.sel === 'apt-oldb' && /as measured/.test(opened.first), opened.id);
        await savesJs(`btn(row('apt-oldb'), '✎').click(); return 1;`); await sleep(200);
        await savesJs(`const i = row('apt-oldb').querySelector('input'); i.value = 'Couch by the window'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 1;`); await sleep(200);
        const renamed = await savesJs(`return { stored: stored()['apt-oldb'].name, row: row('apt-oldb').querySelector('b').textContent, sel: document.getElementById('aptSel').selectedOptions[0].textContent, form: document.getElementById('aptName').value };`);
        check('✎ renames a layout in place, everywhere it is shown', renamed.stored === 'Couch by the window' && renamed.row.startsWith('Couch by the window') && renamed.sel.includes('Couch by the window') && renamed.form === 'Couch by the window', JSON.stringify(renamed).slice(0, 160));
        await savesJs(`btn(row('apt-oldc'), '🗑').click(); return 1;`); await sleep(200);
        const asked = await savesJs(`const c = box.querySelector('.confirm'); const shown = !!c && c.textContent.includes('Old try 3'); btn(c, 'Keep').click(); return { shown, kept: !!stored()['apt-oldc'] && !box.querySelector('.confirm') };`);
        await savesJs(`btn(row('apt-oldc'), '🗑').click(); return 1;`); await sleep(200);
        await savesJs(`btn(box.querySelector('.confirm'), 'Delete').click(); return 1;`); await sleep(600);
        const one = await savesJs(`return { gone: !stored()['apt-oldc'] && !apts['apt-oldc'], rest: Object.keys(stored()).sort().join(','), active: activeId };`);
        check('🗑 asks in place; Keep keeps it, Delete removes that one layout only', asked.shown && asked.kept && one.gone && one.rest === 'apt-new1,apt-olda,apt-oldb' && one.active === 'apt-oldb', one.rest);
        await savesJs(`btn(planOf('as measured'), 'Delete all 2').click(); return 1;`); await sleep(200);
        await savesJs(`btn(box.querySelector('.confirm'), 'Delete 2').click(); return 1;`); await sleep(600);
        const cleared = await savesJs(`return { rest: Object.keys(stored()).join(','), active: activeId, has: !!apts[activeId], small: planOf('as measured').querySelector('small').textContent };`);
        check('"Delete all" clears every layout of yours on one plan and leaves the rest', cleared.rest === 'apt-new1' && cleared.has && !/^apt-old/.test(cleared.active) && /^no layouts of yours/.test(cleared.small), `left: ${cleared.rest}; now on ${cleared.active}`);
        await savesJs(`btn(planOf('as measured'), 'Hide').click(); return 1;`); await sleep(400);
        const hid = await savesJs(`const ids = [...document.getElementById('aptSel').options].map(o => o.value); return { inPicker: ids.includes('measured-apartment'), still: !!apts['measured-apartment'], show: !!btn(planOf('as measured'), 'Show'), last: plans[plans.length - 1].querySelector('.plan-name').textContent, active: activeId };`);
        await go(url);
        const hidAfter = await savesJs(`const ids = [...document.getElementById('aptSel').options].map(o => o.value); const out = { inPicker: ids.includes('measured-apartment'), active: activeId }; btn(planOf('as measured'), 'Show').click(); out.back = [...document.getElementById('aptSel').options].map(o => o.value).includes('measured-apartment'); return out;`);
        check('Hide takes a site plan off the list, a reload keeps it off, Show puts it back', !hid.inPicker && hid.still && hid.show && /as measured/.test(hid.last) && hid.active !== 'measured-apartment' && !hidAfter.inPicker && hidAfter.back, `hidden: picker ${hid.inPicker}, after reload ${hidAfter.inPicker}, shown again ${hidAfter.back}`);
        await savesJs(`row('apt-new1').querySelector('.nm').click(); return 1;`); await sleep(300);
        await evalJs("document.getElementById('saveAs').click(); 1"); await sleep(500);
        const asNew = await savesJs(`const a = apt(); const i = row(a.id) && row(a.id).querySelector('input'); return { name: a.name, pieces: a.furniture.length, naming: !!i && i.value === a.name, own: !a.builtIn && a.id !== 'apt-new1', stored: !!stored()[a.id], count: Object.keys(stored()).length };`);
        check('"Save this as a new layout" keeps a second layout and asks for its name', / · layout 2$/.test(asNew.name) && asNew.pieces === 2 && asNew.naming && asNew.own && asNew.stored && asNew.count === 2, asNew.name);
        await shot('saved-layouts');
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

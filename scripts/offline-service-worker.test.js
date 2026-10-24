// sw.js + js/offline.js: the site works in a tunnel.
//
// The worker is loaded into a fake worker global (a Map-backed cache, a fetch
// the test controls, a client that records messages), and its fetch handler
// is driven through the shapes that matter: network fine, network gone with a
// saved copy, network stalling with a saved copy, nothing saved (an event page
// standing in for its city page, then the offline page), a data file served
// from its saved copy, images cache-first with a cap, old caches dropped on
// activate. Then: every served page carries the registration tag.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://chunky.dad';

class FakeCache {
    constructor() { this.store = new Map(); }
    key(req, ignoreSearch) {
        const url = new URL(typeof req === 'string' ? req : req.url, ORIGIN);
        if (ignoreSearch) url.search = '';
        return url.href;
    }
    async match(req, opts = {}) {
        const wanted = this.key(req, opts.ignoreSearch);
        for (const [k, res] of this.store) {
            const stored = opts.ignoreSearch ? this.key(k, true) : k;
            if (stored === wanted) return res.clone();
        }
        return undefined;
    }
    async put(req, res) { this.store.set(this.key(req, false), res); }
    async keys() { return [...this.store.keys()].map((k) => new Request(k)); }
    async delete(req) { return this.store.delete(this.key(req, false)); }
}
class FakeCacheStorage {
    constructor() { this.caches = new Map(); }
    async open(name) { if (!this.caches.has(name)) this.caches.set(name, new FakeCache()); return this.caches.get(name); }
    async keys() { return [...this.caches.keys()]; }
    async delete(name) { return this.caches.delete(name); }
    async has(name) { return this.caches.has(name); }
}

const messages = [];
const listeners = {};
let fetchImpl = async () => { throw new Error('offline'); };
global.self = {
    location: { origin: ORIGIN },
    addEventListener: (name, fn) => { listeners[name] = fn; },
    skipWaiting: () => {},
    clients: { get: async (id) => ({ postMessage: (m) => messages.push({ id, ...m }) }), claim: async () => {} }
};
global.caches = new FakeCacheStorage();
global.fetch = (req, init) => fetchImpl(req, init);

const sw = require('../sw.js');
sw._setNetworkWait(60);

function req(url, extra = {}) {
    return { url: new URL(url, ORIGIN).href, method: 'GET', mode: 'cors', destination: '', ...extra };
}
function nav(url) { return req(url, { mode: 'navigate', destination: 'document' }); }
function html(text) { return new Response(text, { status: 200, headers: { 'Content-Type': 'text/html' } }); }
function fetchEvent(request, extra = {}) {
    const event = { request, clientId: 'c1', resultingClientId: 'c1', pending: [], response: null, ...extra };
    event.waitUntil = (p) => { event.pending.push(Promise.resolve(p).catch(() => {})); };
    event.respondWith = (p) => { event.response = p; };
    return event;
}
// The response the page gets, then (unless told otherwise) the background
// work the worker registered — the save, the late refresh — so cache
// contents can be checked. In a browser the two are independent.
async function run(request, extra = {}) {
    const { settle = true, ...rest } = extra;
    const event = fetchEvent(request, rest);
    sw.handleFetch(event);
    const response = event.response ? await event.response : null;
    if (settle) await Promise.all(event.pending);
    return { event, response };
}
function reset() {
    global.caches = new FakeCacheStorage();
    messages.length = 0;
    fetchImpl = async () => { throw new Error('offline'); };
}

test('classify: what each request shape is', () => {
    const c = (r) => sw.classify(r, ORIGIN);
    assert.equal(c(nav('/london/')), 'page');
    assert.equal(c(nav('/testing/event-builder.html')), 'page');
    assert.equal(c(req('/data/calendars/london.ics')), 'data');
    assert.equal(c(req('/data/bars/london.json')), 'data');
    assert.equal(c(req('/testing/manifest.json')), 'data');
    assert.equal(c(req('/img/events/thumbs.json')), 'data');
    assert.equal(c(req('/js/app.js', { destination: 'script' })), 'assets');
    assert.equal(c(req('/styles.css', { destination: 'style' })), 'assets');
    assert.equal(c(req('/img/events/london/x.jpg', { destination: 'image' })), 'image');
    assert.equal(c(req('/favicons/favicon-96x96.png')), 'image');
    assert.equal(c(req('https://atlantaeagle.com/wp-content/uploads/flyer.webp', { destination: 'image' })), 'image', 'a flyer from a source site');
    assert.equal(c(req('https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js', { destination: 'script' })), 'cdn');
    assert.equal(c(req('https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css')), 'cdn');
    assert.equal(c(req('https://fonts.gstatic.com/s/poppins/v20/x.woff2', { destination: 'font' })), 'cdn');
    assert.equal(c(req('https://www.googletagmanager.com/gtag/js?id=G-1')), 'bypass');
    assert.equal(c(req('https://calendar.google.com/calendar/ical/x/public/basic.ics')), 'bypass', 'the live fallback stays live');
    assert.equal(c(req('https://api.allorigins.win/raw?url=x')), 'bypass');
    assert.equal(c(req('https://tiles.openfreemap.org/styles/liberty')), 'bypass', 'map tiles are not hoarded');
    assert.equal(c(req('https://example.com/anything.json')), 'bypass', 'unknown origins are left alone');
    assert.equal(c(req('/review/rejections')), 'bypass', "the friend page's Mac-only fetch");
    assert.equal(c(req('/data/calendars/london.ics', { method: 'POST' })), 'bypass');
});

test('parentPagePath: an event page stands in for its city page, nothing else has a stand-in', () => {
    assert.equal(sw.parentPagePath('/atlanta/leather-slut-3b91b082/'), '/atlanta/');
    assert.equal(sw.parentPagePath('/atlanta/leather-slut-3b91b082'), '/atlanta/');
    assert.equal(sw.parentPagePath('/atlanta/'), null);
    assert.equal(sw.parentPagePath('/'), null);
    assert.equal(sw.parentPagePath('/testing/event-builder.html'), null);
    assert.equal(sw.parentPagePath('/a/b/c/'), null);
});

test('page: network fine → the live page, saved with a stamp; network gone → the saved copy, marked, and the page is told', async () => {
    reset();
    fetchImpl = async () => html('<h1>London live</h1>');
    const live = await run(nav('/london/?event=x&view=week'));
    assert.equal(await live.response.text(), '<h1>London live</h1>');
    assert.equal(live.response.headers.get(sw.SERVED_FROM_HEADER), null);
    const pages = await global.caches.open(sw.CACHES.pages);
    const saved = await pages.match(req('/london/'), { ignoreSearch: true });
    assert.ok(saved, 'saved under the page, whatever the query was');
    assert.match(saved.headers.get(sw.CACHED_AT_HEADER), /^\d{4}-\d{2}-\d{2}T/);

    fetchImpl = async () => { throw new TypeError('Load failed'); };
    const offline = await run(nav('/london/?event=y'));
    assert.equal(await offline.response.text(), '<h1>London live</h1>', 'the saved copy, query ignored');
    assert.equal(offline.response.headers.get(sw.SERVED_FROM_HEADER), 'cache');
    assert.deepEqual(messages.map((m) => [m.id, m.type, m.what]), [['c1', 'served-from-cache', 'page']]);
    assert.ok(messages[0].cachedAt, 'with when it was saved');
});

test('page: a network that only stalls is treated as gone once a copy exists; the late response still refreshes the cache', async () => {
    reset();
    fetchImpl = async () => html('v1');
    await run(nav('/sydney/'));
    let release;
    fetchImpl = () => new Promise((resolve) => { release = resolve; });
    const started = Date.now();
    const stalled = run(nav('/sydney/'), { settle: false });
    // the saved copy must answer well before any real network wait
    const settled = await Promise.race([stalled.then(() => 'answered'), new Promise((r) => setTimeout(() => r('too slow'), 1500))]);
    assert.equal(settled, 'answered');
    assert.ok(Date.now() - started < 1500);
    const { event, response } = await stalled;
    assert.equal(await response.text(), 'v1');
    assert.equal(response.headers.get(sw.SERVED_FROM_HEADER), 'cache');
    release(html('v2'));
    await Promise.all(event.pending);
    const pages = await global.caches.open(sw.CACHES.pages);
    assert.equal(await (await pages.match(req('/sydney/'))).text(), 'v2', 'the late response is kept for next time');
});

test('page: nothing saved → the network gets all the time it needs; gone with nothing saved → the city page stands in for an event page, else the offline page, else the error', async () => {
    reset();
    let release;
    fetchImpl = () => new Promise((resolve) => { release = resolve; });
    const slow = run(nav('/berlin/'), { settle: false });
    await new Promise((r) => setTimeout(r, 150));
    release(html('Berlin, eventually'));
    const first = await slow;
    assert.equal(await first.response.text(), 'Berlin, eventually', 'no false offline on a first load');
    await Promise.all(first.event.pending);

    fetchImpl = async () => { throw new Error('offline'); };
    const standIn = await run(nav('/berlin/bear-pride-2027-abc123/'));
    assert.equal(await standIn.response.text(), 'Berlin, eventually', 'an unsaved event page opens as its city page');
    assert.equal(standIn.response.headers.get(sw.SERVED_FROM_HEADER), 'cache');

    const pages = await global.caches.open(sw.CACHES.pages);
    await pages.put(sw.OFFLINE_PAGE, html('offline page'));
    const unknown = await run(nav('/testing/event-builder.html'));
    assert.equal(await unknown.response.text(), 'offline page', 'a never-opened tool page gets the offline page, not the tool shed');

    await pages.delete(sw.OFFLINE_PAGE);
    await assert.rejects(run(nav('/nowhere/')), /offline/, 'with nothing at all, the browser shows its own error');
});

test('data: the calendar file comes from the network, then from its saved copy when the network is gone — and the page hears which', async () => {
    reset();
    fetchImpl = async () => new Response('BEGIN:VCALENDAR', { status: 200, headers: { 'Content-Type': 'text/calendar' } });
    await run(req('/data/calendars/london.ics'));
    fetchImpl = async () => { throw new Error('offline'); };
    const { response } = await run(req('/data/calendars/london.ics'), { resultingClientId: '', clientId: 'page-1' });
    assert.equal(await response.text(), 'BEGIN:VCALENDAR');
    assert.equal(response.headers.get(sw.SERVED_FROM_HEADER), 'cache');
    assert.deepEqual(messages.map((m) => [m.id, m.what]), [['page-1', 'data']]);
    await assert.rejects(run(req('/data/calendars/never.ics')), /offline/, 'nothing saved and no network: the fetch fails as it would without a worker, and the loader falls through to its own fallbacks');
});

test('data and assets: a 404 is a 404 (not saved, not replaced by an old copy)', async () => {
    reset();
    fetchImpl = async () => new Response('gone', { status: 404 });
    const { response } = await run(req('/js/app.js', { destination: 'script' }));
    assert.equal(response.status, 404);
    const assets = await global.caches.open(sw.CACHES.assets);
    assert.equal(await assets.match(req('/js/app.js')), undefined);
});

test('images: saved copy first, refreshed behind it; the cache is capped at the newest IMAGE_LIMIT', async () => {
    reset();
    let hits = 0;
    fetchImpl = async () => { hits++; return new Response('png', { status: 200, headers: { 'Content-Type': 'image/png' } }); };
    const first = await run(req('/img/events/london/a.png', { destination: 'image' }));
    assert.equal(await first.response.text(), 'png');
    assert.equal(hits, 1);
    fetchImpl = async () => { hits++; throw new Error('offline'); };
    const again = await run(req('/img/events/london/a.png', { destination: 'image' }));
    assert.equal(await again.response.text(), 'png', 'served from the cache while the refresh fails quietly');
    assert.equal(hits, 2, 'a refresh was attempted');

    const images = await global.caches.open(sw.CACHES.images);
    for (let i = 0; i < 5; i++) await images.put(`/img/${i}.png`, new Response('x'));
    await sw.trim(images, 3);
    const left = (await images.keys()).map((k) => new URL(k.url).pathname);
    assert.deepEqual(left, ['/img/2.png', '/img/3.png', '/img/4.png'], 'the oldest go first');
    assert.ok(sw.IMAGE_LIMIT >= 200 && sw.IMAGE_LIMIT <= 1000);
});

test('install precaches the home page and the offline page one by one (a missing file does not fail the install); activate drops old chunky caches only', async () => {
    reset();
    fetchImpl = async (url) => (String(url) === '/styles.css' ? Promise.reject(new Error('nope')) : html(`ok ${url}`));
    await sw.precache();
    const pages = await global.caches.open(sw.CACHES.pages);
    assert.ok(await pages.match('/'), 'home');
    assert.ok(await pages.match(sw.OFFLINE_PAGE), 'offline page');
    assert.equal(await pages.match('/styles.css'), undefined, 'the one that failed is simply absent');
    for (const p of sw.PRECACHE) {
        const file = p === '/' ? 'index.html' : p.slice(1);
        assert.ok(fs.existsSync(path.join(ROOT, file)), `${p} exists in the repo`);
    }

    await global.caches.open('chunky-pages-v0');
    await global.caches.open('someone-elses-cache');
    await sw.activate();
    const names = await global.caches.keys();
    assert.ok(!names.includes('chunky-pages-v0'), 'the old version is gone');
    assert.ok(names.includes('someone-elses-cache'), 'other caches are not ours to drop');
    for (const name of sw.CACHE_NAMES) assert.ok(name.endsWith(`-${sw.VERSION}`));
});

test('save-page: the page that installed the worker sends its address and what it loaded; each is fetched again and saved under its own rule, the page without its query', async () => {
    reset();
    const fetched = [];
    fetchImpl = async (url, init) => { fetched.push([String(url), init && init.mode]); return html(`ok ${url}`); };
    const event = { data: { type: 'save-page', url: `${ORIGIN}/london/?event=x&view=week`, resources: [
        `${ORIGIN}/js/app.js`, `${ORIGIN}/styles.css`, `${ORIGIN}/data/calendars/london.ics`, `${ORIGIN}/img/events/thumbs.json`,
        `${ORIGIN}/favicons/favicon-96x96.png`, 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js',
        'https://www.googletagmanager.com/gtag/js?id=G-1', 'https://tiles.openfreemap.org/styles/liberty', `${ORIGIN}/review/rejections`
    ] }, pending: [] };
    event.waitUntil = (p) => event.pending.push(p);
    sw.handleMessage(event);
    await Promise.all(event.pending);
    const names = async (cacheName) => (await (await global.caches.open(cacheName)).keys()).map((k) => new URL(k.url).pathname + new URL(k.url).search).sort();
    assert.deepEqual(await names(sw.CACHES.pages), ['/london/'], 'the page, query dropped');
    assert.deepEqual(await names(sw.CACHES.assets), ['/js/app.js', '/styles.css']);
    assert.deepEqual(await names(sw.CACHES.data), ['/data/calendars/london.ics', '/img/events/thumbs.json']);
    assert.deepEqual(await names(sw.CACHES.images), ['/favicons/favicon-96x96.png']);
    assert.deepEqual(await names(sw.CACHES.cdn), ['/maplibre-gl@5.24.0/dist/maplibre-gl.js']);
    assert.ok(!fetched.some(([u]) => u.includes('googletagmanager') || u.includes('openfreemap') || u.includes('/review/')), 'bypassed shapes are not fetched');
    assert.ok(fetched.some(([u, mode]) => u.includes('unpkg.com') && mode === 'no-cors'), 'cross-origin files are fetched the way a tag would');
    sw.handleMessage({ data: { type: 'something-else' } });
    sw.handleMessage({ data: null });
});

test('every served page registers the worker: the hand-written pages, the tool shed, every generated city page, the bear-runs calendar and the friend page', () => {
    const TAG = '<script src="/js/offline.js" defer></script>';
    const served = ['index.html', 'city.html', 'about.html', 'bear-directory.html', 'bear-runs/index.html', 'phone-a-friend/index.html'];
    for (const f of fs.readdirSync(path.join(ROOT, 'testing'))) if (f.endsWith('.html')) served.push(`testing/${f}`);
    for (const dir of fs.readdirSync(ROOT)) {
        const file = path.join(ROOT, dir, 'index.html');
        if (!fs.existsSync(file)) continue;
        const head = fs.readFileSync(file, 'utf8').slice(0, 200);
        if (head.includes('generated: chunky.dad city page')) served.push(`${dir}/index.html`);
    }
    assert.ok(served.filter((f) => /^[a-z-]+\/index\.html$/.test(f)).length > 60, 'the generated city pages are in the list');
    const missing = served.filter((f) => !fs.readFileSync(path.join(ROOT, f), 'utf8').includes(TAG));
    assert.deepEqual(missing, [], 'pages without the registration tag');
    // event pages redirect from their <head> and never paint: no tag there
    const eventPage = fs.readFileSync(path.join(ROOT, 'atlanta', 'leather-slut-3b91b082', 'index.html'), 'utf8');
    assert.ok(!eventPage.includes(TAG));
    // the Mac's own deck page is not on chunky.dad and has no sw.js: no tag
    const { renderReviewPage } = require('../tools/serve-results.js');
    const mac = renderReviewPage({ runId: 'r', cards: [], decided: [], counts: {}, friends: [] }, { runs: [], scriptName: 'display-saved-run', ctx: {} });
    assert.ok(!mac.includes(TAG));
});

test('js/offline.js registers /sw.js at the root scope, speaks only when working from saved copies, and runs on the oldest Safari (no modules, no arrows)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js', 'offline.js'), 'utf8');
    assert.ok(src.includes("register('/sw.js', { scope: '/' })"));
    assert.ok(src.includes("'served-from-cache'"), 'listens for the worker');
    assert.ok(src.includes("addEventListener('offline'") && src.includes("addEventListener('online'"));
    assert.ok(!/=>/.test(src) && !/\bconst\b|\blet\b/.test(src), 'ES5 only');
    assert.doesNotThrow(() => new Function(src));
    const offlinePage = fs.readFileSync(path.join(ROOT, 'offline.html'), 'utf8');
    assert.ok(!/<link[^>]+rel="stylesheet"/.test(offlinePage), 'the offline page needs no other file to paint');
    assert.ok(!offlinePage.includes('offline.js'), 'and does not announce what it already says');
    assert.ok(/<a[^>]+href="\/"/.test(offlinePage), 'and leads home');
});

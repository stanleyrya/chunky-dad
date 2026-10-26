// tools/review-sw.js — the deck opens with no connection to the Mac.
const test = require('node:test');
const assert = require('node:assert');

const ORIGIN = 'https://rybook.pumpkinseed-rainbow.ts.net';

class FakeCache {
    constructor() { this.store = new Map(); }
    key(req) { return new URL(typeof req === 'string' ? req : req.url, ORIGIN).href; }
    async match(req) { const r = this.store.get(this.key(req)); return r ? r.clone() : undefined; }
    async put(req, res) { this.store.set(this.key(req), res); }
    async keys() { return [...this.store.keys()].map((k) => new Request(k)); }
    async delete(req) { return this.store.delete(this.key(req)); }
}
class FakeCacheStorage {
    constructor() { this.caches = new Map(); }
    async open(name) { if (!this.caches.has(name)) this.caches.set(name, new FakeCache()); return this.caches.get(name); }
    async keys() { return [...this.caches.keys()]; }
    async delete(name) { return this.caches.delete(name); }
}
const messages = [];
let fetchImpl = async () => { throw new TypeError('offline'); };
global.self = { location: { origin: ORIGIN }, addEventListener: () => {}, skipWaiting: () => {}, clients: { get: async (id) => ({ postMessage: (m) => messages.push({ id, ...m }) }), claim: async () => {} } };
global.caches = new FakeCacheStorage();
global.fetch = (req, init) => fetchImpl(req, init);
const sw = require('../tools/review-sw.js');
sw._setNetworkWait(60);

const req = (url, extra = {}) => ({ url: new URL(url, ORIGIN).href, method: 'GET', mode: 'cors', destination: '', ...extra });
const nav = (url) => req(url, { mode: 'navigate', destination: 'document' });
const html = (t) => new Response(t, { status: 200, headers: { 'Content-Type': 'text/html' } });
async function run(request, extra = {}) {
    const { settle = true, ...rest } = extra;
    const event = { request, clientId: 'c1', resultingClientId: 'c1', pending: [], response: null, ...rest };
    event.waitUntil = (p) => event.pending.push(Promise.resolve(p).catch(() => {}));
    event.respondWith = (p) => { event.response = p; };
    sw.handleFetch(event);
    const response = event.response ? await event.response : null;
    if (settle) await Promise.all(event.pending);
    return { event, response };
}
const reset = () => { global.caches = new FakeCacheStorage(); messages.length = 0; fetchImpl = async () => { throw new TypeError('offline'); }; };

test('classify: the deck page, its data, favicons, flyers; POSTs and other sites untouched', () => {
    const c = (r) => sw.classify(r, ORIGIN);
    assert.equal(c(nav('/review?run=20261026-051500')), 'page');
    assert.equal(c(req('/review/deck.json')), 'data');
    assert.equal(c(req('/review/decisions.json')), 'data');
    assert.equal(c(req('/review-outbox.js', { destination: 'script' })), 'data');
    assert.equal(c(req('/review/manifest.webmanifest')), 'data');
    assert.equal(c(req('/favicons/review-icon-180.png', { destination: 'image' })), 'static');
    assert.equal(c(req('https://atlantaeagle.com/flyer.webp', { destination: 'image' })), 'image');
    assert.equal(c(req('/review/decide', { method: 'POST' })), 'bypass', 'the outbox handles swipes');
    assert.equal(c(req('https://example.com/x.json')), 'bypass');
    assert.equal(sw.pageKey(`${ORIGIN}/review?run=x#y`), `${ORIGIN}/review`);
});

test('the deck page: live when the Mac answers, saved under one key whatever the run query; from the saved copy, marked and announced, when the Mac is gone or slow', async () => {
    reset();
    fetchImpl = async () => html('deck v1');
    assert.equal(await (await run(nav('/review?run=a'))).response.text(), 'deck v1');
    const pages = await global.caches.open(sw.CACHES.pages);
    assert.deepEqual((await pages.keys()).map((k) => k.url), [`${ORIGIN}/review`]);
    fetchImpl = async () => { throw new TypeError('Load failed'); };
    const gone = await run(nav('/review?run=b'));
    assert.equal(await gone.response.text(), 'deck v1');
    assert.equal(gone.response.headers.get(sw.SERVED_FROM_HEADER), 'cache');
    assert.deepEqual(messages.map((m) => [m.id, m.type, m.what]), [['c1', 'served-from-cache', 'page']]);
    assert.ok(messages[0].cachedAt);
    let release;
    fetchImpl = () => new Promise((r) => { release = r; });
    const slow = run(nav('/review'), { settle: false });
    const outcome = await Promise.race([slow.then(() => 'answered'), new Promise((r) => setTimeout(() => r('too slow'), 1500))]);
    assert.equal(outcome, 'answered', 'a stalled Mac is treated as gone once a copy exists');
    const { event, response } = await slow;
    assert.equal(response.headers.get(sw.SERVED_FROM_HEADER), 'cache');
    release(html('deck v2'));
    await Promise.all(event.pending);
    assert.equal(await (await pages.match(`${ORIGIN}/review`)).text(), 'deck v2', 'the late answer is kept for next time');
});

test('nothing saved and the Mac gone: a plain "out of reach" page for a navigation, the error itself for data', async () => {
    reset();
    const page = await run(nav('/review'));
    assert.equal(page.response.status, 503);
    assert.match(await page.response.text(), /out of reach/);
    await assert.rejects(run(req('/review/deck.json')), /offline/);
});

test('data and scripts: network first, saved copy when gone; favicons and flyers saved copy first with a cap; activate drops old deck caches only; save-page stores the first load', async () => {
    reset();
    fetchImpl = async () => new Response('{"cards":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    await run(req('/review/deck.json'));
    fetchImpl = async () => { throw new TypeError('offline'); };
    const data = await run(req('/review/deck.json'), { clientId: 'p9', resultingClientId: '' });
    assert.equal(await data.response.text(), '{"cards":[]}');
    assert.deepEqual(messages.map((m) => [m.id, m.what]), [['p9', 'data']]);

    let hits = 0;
    fetchImpl = async () => { hits++; return new Response('png', { status: 200 }); };
    await run(req('https://x.test/flyer.png', { destination: 'image' }));
    fetchImpl = async () => { hits++; throw new TypeError('offline'); };
    assert.equal(await (await run(req('https://x.test/flyer.png', { destination: 'image' }))).response.text(), 'png');
    assert.equal(hits, 2);
    assert.ok(sw.IMAGE_LIMIT >= 300);

    await global.caches.open('deck-pages-v0');
    await global.caches.open('chunky-pages-v1');
    await sw.activate();
    const names = await global.caches.keys();
    assert.ok(!names.includes('deck-pages-v0') && names.includes('chunky-pages-v1'));

    fetchImpl = async (url) => html(`saved ${url}`);
    const event = { data: { type: 'save-page', url: `${ORIGIN}/review?run=first#x`, resources: [`${ORIGIN}/review-outbox.js`, `${ORIGIN}/favicons/review-icon-180.png`, 'https://atlantaeagle.com/flyer.webp', 'not a url'] }, pending: [] };
    event.waitUntil = (p) => event.pending.push(p);
    sw.handleMessage(event);
    await Promise.all(event.pending);
    const pages = await global.caches.open(sw.CACHES.pages);
    assert.equal(await (await pages.match(`${ORIGIN}/review`)).text(), `saved ${ORIGIN}/review`, 'the first page load is saved under the search-less key');
    assert.ok(await pages.match(`${ORIGIN}/review-outbox.js`), 'and the outbox script it loaded, so the saved deck has one');
    assert.ok(await pages.match(`${ORIGIN}/favicons/review-icon-180.png`));
    assert.equal(await pages.match('https://atlantaeagle.com/flyer.webp'), undefined, 'cross-origin flyers are not fetched here');
    sw.handleMessage({ data: null });
});

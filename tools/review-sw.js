/* The review deck's service worker (served at /review-sw.js by
 * tools/serve-results.js; registered by the deck page when it is reached
 * over HTTPS — https://rybook.<tailnet>.ts.net/review — or localhost).
 *
 * The deck is one page with every card inlined, so keeping the last loaded
 * copy means the deck opens in a tunnel with no connection to the Mac:
 *   page   — a navigation to /review (any query): the network first, but
 *            at most NETWORK_WAIT_MS once a saved copy exists; then the
 *            saved copy, and the page is told so it can say "as of 07:42".
 *            Stored under the search-less URL, so one copy, not one per run.
 *   same-origin GET (deck.json, decisions.json, the manifest, the two
 *            scripts, /log, /metrics…): the network first, saved copy after.
 *   favicons — saved copy first.
 *   image  — flyers from any site: saved copy first, refreshed behind it,
 *            capped at IMAGE_LIMIT.
 *   POST   — never touched: tools/review-outbox.js is what waits for the Mac.
 * The page that installs the worker loaded before the worker could see it;
 * it sends a "save-page" message and the worker fetches and saves it.
 *
 * Exported for scripts/review-service-worker.test.js, which drives
 * handleFetch against a fake cache and a fetch that fails or stalls.
 */
'use strict';

const VERSION = 'v1';
const CACHES = { pages: `deck-pages-${VERSION}`, images: `deck-images-${VERSION}` };
const CACHE_NAMES = Object.values(CACHES);
const NETWORK_WAIT_MS = 6000;
let networkWaitMs = NETWORK_WAIT_MS;
const IMAGE_LIMIT = 600;
const CACHED_AT_HEADER = 'X-Chunky-Cached-At';
const SERVED_FROM_HEADER = 'X-Chunky-Served-From';

function classify(request, origin) {
    let url;
    try { url = new URL(request.url); } catch (_) { return 'bypass'; }
    if (request.method !== 'GET') return 'bypass';
    if (url.origin !== origin) return request.destination === 'image' ? 'image' : 'bypass';
    if (request.mode === 'navigate' || request.destination === 'document') return 'page';
    if (url.pathname.startsWith('/favicons/')) return 'static';
    if (request.destination === 'image') return 'image';
    return 'data';
}

function pageKey(url) { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; }

function cacheable(response) {
    if (!response) return false;
    if (response.type === 'opaque') return true;
    return response.ok && response.status !== 206;
}

async function stamped(response) {
    if (response.type === 'opaque' || response.status === 0) return response;
    const headers = new Headers(response.headers);
    headers.set(CACHED_AT_HEADER, new Date().toISOString());
    return new Response(await response.clone().arrayBuffer(), { status: response.status, statusText: response.statusText, headers });
}

async function fromCache(response) {
    if (!response || response.type === 'opaque' || response.status === 0) return response;
    const headers = new Headers(response.headers);
    headers.set(SERVED_FROM_HEADER, 'cache');
    return new Response(await response.arrayBuffer(), { status: response.status, statusText: response.statusText, headers });
}

async function save(cacheName, key, response, limit) {
    try {
        const cache = await caches.open(cacheName);
        await cache.put(key, await stamped(response));
        if (limit) {
            const keys = await cache.keys();
            if (keys.length > limit) await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)));
        }
    } catch (_) { /* quota — the page still got its answer */ }
}

function extend(event, promise) {
    try { if (event && typeof event.waitUntil === 'function') event.waitUntil(promise); } catch (_) { /* the event is done; the promise still runs */ }
}

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('network wait over')), ms);
        promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
}

async function findClient(clientId, tries) {
    for (let i = 0; i < tries; i++) {
        const client = await self.clients.get(clientId).catch(() => null);
        if (client) return client;
        await new Promise((r) => setTimeout(r, 250));
    }
    return null;
}

function tell(event, clientId, message) {
    if (!clientId || !self.clients || typeof self.clients.get !== 'function') return;
    extend(event, findClient(clientId, 20).then((client) => { if (client) client.postMessage(message); }).catch(() => {}));
}

async function networkFirst(event, request, options = {}) {
    const cache = await caches.open(CACHES.pages);
    const key = options.page ? pageKey(request.url) : request.url;
    const saved = await cache.match(key);
    const network = fetch(request);
    extend(event, network.then((response) => (cacheable(response) ? save(CACHES.pages, key, response.clone()) : null)).catch(() => {}));
    if (!saved) {
        try {
            return await network;
        } catch (error) {
            if (options.page) return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>No connection</title><body style="font-family:-apple-system,system-ui,sans-serif;padding:32px;text-align:center"><h1>The Mac is out of reach, and no deck is saved here yet</h1><p>Open the deck once with the VPN on; after that it opens here with no connection.</p><p><a href="javascript:location.reload()">Try again</a></p></body>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            throw error;
        }
    }
    try {
        const response = await withTimeout(network, networkWaitMs);
        if (cacheable(response) || response.status < 500) return response;
        throw new Error(`status ${response.status}`);
    } catch (_) {
        tell(event, options.clientId, { type: 'served-from-cache', what: options.page ? 'page' : 'data', url: request.url, cachedAt: saved.headers.get(CACHED_AT_HEADER) || '' });
        return fromCache(saved);
    }
}

async function cacheFirst(event, request, cacheName, limit) {
    const cache = await caches.open(cacheName);
    const saved = await cache.match(request);
    const refresh = fetch(request).then((response) => (cacheable(response) ? save(cacheName, request, response.clone(), limit).then(() => response) : response));
    extend(event, refresh.catch(() => {}));
    return saved || refresh;
}

function handleFetch(event) {
    const request = event.request;
    const kind = classify(request, self.location.origin);
    if (kind === 'bypass') return;
    const clientId = event.resultingClientId || event.clientId || '';
    if (kind === 'page') event.respondWith(networkFirst(event, request, { page: true, clientId }));
    else if (kind === 'data') event.respondWith(networkFirst(event, request, { clientId }));
    else if (kind === 'static') event.respondWith(cacheFirst(event, request, CACHES.pages));
    else if (kind === 'image') event.respondWith(cacheFirst(event, request, CACHES.images, IMAGE_LIMIT));
}

// The page that installed the worker, and the same-origin files it loaded
// (the outbox script, favicons, the manifest): without them a saved deck
// would open with no outbox. Flyers are cross-origin and lazy; they are
// saved as they are seen.
async function savePage(url, resources) {
    const origin = self.location.origin;
    const list = [pageKey(url)].concat((Array.isArray(resources) ? resources : []).map(String).filter((r) => { try { return new URL(r).origin === origin; } catch (_) { return false; } }).slice(0, 50));
    for (const item of list) {
        try {
            const response = await fetch(item, { cache: 'no-cache' });
            if (cacheable(response)) await save(CACHES.pages, item, response);
        } catch (_) { /* saved on its next load */ }
    }
}

function handleMessage(event) {
    const data = event && event.data;
    if (data && data.type === 'save-page' && data.url) extend(event, savePage(data.url, data.resources));
}

async function activate() {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('deck-') && !CACHE_NAMES.includes(n)).map((n) => caches.delete(n)));
    if (self.clients && typeof self.clients.claim === 'function') await self.clients.claim();
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function' && typeof caches !== 'undefined') {
    self.addEventListener('install', () => { if (typeof self.skipWaiting === 'function') self.skipWaiting(); });
    self.addEventListener('activate', (event) => { event.waitUntil(activate()); });
    self.addEventListener('fetch', handleFetch);
    self.addEventListener('message', handleMessage);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VERSION, CACHES, CACHE_NAMES, NETWORK_WAIT_MS, IMAGE_LIMIT, CACHED_AT_HEADER, SERVED_FROM_HEADER, classify, pageKey, handleFetch, handleMessage, savePage, activate, _setNetworkWait: (ms) => { networkWaitMs = ms; } };
}

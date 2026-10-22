/* chunky.dad service worker — the site keeps working in a tunnel.
 *
 * Registered by js/offline.js from every page (the city pages through the
 * city.html template, the friend page through the deck's template). It sits
 * between each page and the network and keeps a copy of what the page loads,
 * so a page you opened before opens again with no signal, with the calendar
 * it last showed, and refreshes itself when the signal returns.
 *
 * The rules, by what is being fetched:
 *   page   — a navigation to a chunky.dad page: network first, but only wait
 *            NETWORK_WAIT_MS for it when a saved copy exists; then the saved
 *            copy. An event page (/<city>/<slug>/) never saved falls back to
 *            its city page (the event page only redirects there anyway), and
 *            the last resort is /offline.html.
 *   data   — data/calendars/<city>.ics, data/*.json, thumbs.json, the tool
 *            shed's manifest: network first with the same wait, then the saved
 *            copy, stamped with when it was saved so the page can say so.
 *   asset  — our js and css: network first with the wait, then the saved copy.
 *            (Network first, not cache first, so a deploy reaches the next
 *            page load and a fresh page never runs stale scripts.)
 *   image  — flyers, favicons, logos, map markers, from any origin: the saved
 *            copy at once, refreshed in the background; capped at IMAGE_LIMIT
 *            entries so a hundred city pages do not fill the phone.
 *   cdn    — unpkg / jsdelivr / Google Fonts (versioned URLs that never
 *            change under their name): saved copy at once, else fetched and
 *            saved.
 *   bypass — analytics, Google Calendar and the CORS proxies (the live
 *            fallbacks the calendar loader tries after our own data file),
 *            map tiles, the Mac server's /review routes: never touched.
 *
 * The page that installs the worker loaded before the worker could see it;
 * js/offline.js sends that page's address and the files it loaded in a
 * "save-page" message, and the worker fetches and saves them (savePage).
 *
 * Nothing here is chunky.dad-specific beyond the path shapes; the rules are
 * exported for the test (scripts/offline-service-worker.test.js), which runs
 * the fetch handler against a fake cache and a fetch that fails or stalls.
 */
'use strict';

const VERSION = 'v1';
const CACHES = {
    pages: `chunky-pages-${VERSION}`,
    data: `chunky-data-${VERSION}`,
    assets: `chunky-assets-${VERSION}`,
    images: `chunky-images-${VERSION}`,
    cdn: `chunky-cdn-${VERSION}`
};
const CACHE_NAMES = Object.values(CACHES);
const NETWORK_WAIT_MS = 4000;
let networkWaitMs = NETWORK_WAIT_MS; // the test shortens it
const IMAGE_LIMIT = 400;
const OFFLINE_PAGE = '/offline.html';
// Enough to paint the home page and the offline page with no signal on the
// very first return; everything else is saved as it is loaded.
const PRECACHE = ['/', OFFLINE_PAGE, '/styles.css', '/js/offline.js', '/Rising_Star_Ryan_Head_Compressed.png', '/favicons/favicon-96x96.png'];
const CACHED_AT_HEADER = 'X-Chunky-Cached-At';
const SERVED_FROM_HEADER = 'X-Chunky-Served-From';

const CDN_HOSTS = ['unpkg.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const BYPASS_HOSTS = ['www.googletagmanager.com', 'www.google-analytics.com', 'analytics.google.com', 'calendar.google.com', 'api.allorigins.win', 'corsproxy.io', 'api.codetabs.com', 'tiles.openfreemap.org', 'docs.google.com', 'sheets.googleapis.com'];
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg|ico|avif|bmp)$/i;
const DATA_EXT = /\.(ics|json)$/i;
const ASSET_EXT = /\.(js|css|webmanifest|woff2?|ttf|otf)$/i;

// What kind of request this is → which rule applies. Pure, so the test can
// check every shape without a browser.
function classify(request, origin) {
    let url;
    try { url = new URL(request.url); } catch (_) { return 'bypass'; }
    if (request.method !== 'GET') return 'bypass';
    const sameOrigin = url.origin === origin;
    if (!sameOrigin) {
        if (BYPASS_HOSTS.includes(url.hostname)) return 'bypass';
        if (CDN_HOSTS.includes(url.hostname)) return 'cdn';
        if (request.destination === 'image' || IMAGE_EXT.test(url.pathname)) return 'image';
        if (request.destination === 'font') return 'cdn';
        return 'bypass';
    }
    if (request.mode === 'navigate' || request.destination === 'document') return 'page';
    const p = url.pathname;
    if (p.startsWith('/review/') || p === '/review') return 'bypass';
    if (p.startsWith('/data/') || DATA_EXT.test(p)) return 'data';
    if (request.destination === 'image' || IMAGE_EXT.test(p) || p.startsWith('/img/') || p.startsWith('/favicons/')) return 'image';
    if (request.destination === 'font' || ASSET_EXT.test(p)) return 'assets';
    if (p.endsWith('/') || p.endsWith('.html')) return 'page';
    return 'assets';
}

// The city page a never-saved event page can stand in for: /atlanta/<slug>/ →
// /atlanta/ (the event page only redirects there). A file under a directory
// (/testing/event-builder.html) is its own page and has no stand-in.
function parentPagePath(pathname) {
    const m = /^(\/[^/]+\/)[^/.]+\/?$/.exec(pathname || '');
    return m ? m[1] : null;
}

function cacheable(response) {
    if (!response) return false;
    if (response.type === 'opaque') return true; // cross-origin no-cors (CDN scripts, flyers)
    return response.ok && response.status !== 206;
}

// A copy for the cache that remembers when it was saved. Opaque bodies
// cannot be rebuilt, so they are stored as they are (no stamp).
async function stamped(response) {
    if (response.type === 'opaque' || response.status === 0) return response;
    const headers = new Headers(response.headers);
    headers.set(CACHED_AT_HEADER, new Date().toISOString());
    const body = await response.clone().arrayBuffer();
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

async function fromCache(response) {
    if (!response || response.type === 'opaque' || response.status === 0) return response;
    const headers = new Headers(response.headers);
    headers.set(SERVED_FROM_HEADER, 'cache');
    const body = await response.arrayBuffer();
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

async function save(cacheName, request, response, limit) {
    try {
        const cache = await caches.open(cacheName);
        await cache.put(request, await stamped(response));
        if (limit) await trim(cache, limit);
    } catch (_) { /* quota or a request the cache refuses — the page still got its answer */ }
}

// Keep the newest `limit` entries (cache.keys() is insertion order).
async function trim(cache, limit) {
    const keys = await cache.keys();
    if (keys.length <= limit) return;
    const extra = keys.slice(0, keys.length - limit);
    await Promise.all(extra.map((key) => cache.delete(key)));
}

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('network wait over')), ms);
        promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
    });
}

function extend(event, promise) {
    try { if (event && typeof event.waitUntil === 'function') event.waitUntil(promise); } catch (_) { /* the event is already done; the promise still runs */ }
}

// A navigation's client does not exist until the browser has committed the
// new document, which is after the response went out — so look for it a
// few times before giving up.
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

// The page that installed the worker loaded before the worker could see it,
// so js/offline.js sends its address and what it loaded; everything is
// fetched again and saved under the rule it would have had. Also sent when
// a new worker version takes over, since activate dropped the old caches.
async function savePage(url, resources) {
    const origin = self.location.origin;
    const list = [url].concat(Array.isArray(resources) ? resources.slice(0, 150) : []);
    for (const item of list) {
        const request = { url: String(item), method: 'GET', mode: 'cors', destination: '' };
        const kind = item === url ? 'page' : classify(request, origin);
        if (kind === 'bypass') continue;
        const cacheName = kind === 'page' ? CACHES.pages : kind === 'data' ? CACHES.data : kind === 'image' ? CACHES.images : kind === 'cdn' ? CACHES.cdn : CACHES.assets;
        try {
            const target = new URL(item, origin);
            const sameOrigin = target.origin === origin;
            if (kind === 'page') target.search = '';
            const response = await fetch(target.href, sameOrigin ? { cache: 'no-cache' } : { mode: 'no-cors' });
            if (cacheable(response)) await save(cacheName, target.href, response, kind === 'image' ? IMAGE_LIMIT : undefined);
        } catch (_) { /* saved on its next load instead */ }
    }
}

function handleMessage(event) {
    const data = event && event.data;
    if (!data || data.type !== 'save-page' || !data.url) return;
    extend(event, savePage(data.url, data.resources));
}

// Network first, with a bounded wait when a saved copy exists. A slow
// network (the tunnel's half-signal) is treated like no network: the saved
// copy answers now and the slow response, if it ever lands, refreshes the
// cache for next time. With nothing saved, the network gets all the time it
// needs — a wrong "offline" is worse than a slow first load.
async function networkFirst(event, request, cacheName, options = {}) {
    const cache = await caches.open(cacheName);
    const matchOptions = options.ignoreSearch ? { ignoreSearch: true } : undefined;
    const saved = await cache.match(request, matchOptions);
    const network = fetch(request);
    // Registered before anything is awaited: a waitUntil added after the
    // response has gone out is refused by the browser, and the save would
    // be cut short with the worker.
    extend(event, network.then((response) => (cacheable(response) ? save(cacheName, request, response.clone(), options.limit) : null)).catch(() => {}));
    if (!saved) {
        try {
            return await network;
        } catch (error) {
            const fallback = options.fallback ? await options.fallback(cache) : null;
            if (fallback) return fallback;
            throw error;
        }
    }
    try {
        const response = await withTimeout(network, networkWaitMs);
        if (cacheable(response) || response.status < 500) return response;
        throw new Error(`status ${response.status}`);
    } catch (_) {
        const cachedAt = saved.headers.get(CACHED_AT_HEADER) || '';
        tell(event, options.clientId, { type: 'served-from-cache', what: options.kind, url: request.url, cachedAt });
        return fromCache(saved);
    }
}

// The saved copy at once, refreshed behind it; fetched and saved when new.
async function cacheFirst(event, request, cacheName, limit) {
    const cache = await caches.open(cacheName);
    const saved = await cache.match(request);
    const refresh = fetch(request).then((response) => {
        if (cacheable(response)) return save(cacheName, request, response.clone(), limit).then(() => response);
        return response;
    });
    extend(event, refresh.catch(() => {}));
    if (saved) return saved;
    return refresh;
}

async function pageFallback(cache, request) {
    const url = new URL(request.url);
    const parent = parentPagePath(url.pathname);
    if (parent) {
        const city = await cache.match(new Request(url.origin + parent), { ignoreSearch: true });
        if (city) return fromCache(city);
    }
    const offline = await cache.match(new Request(url.origin + OFFLINE_PAGE));
    return offline ? fromCache(offline) : null;
}

function handleFetch(event) {
    const request = event.request;
    const kind = classify(request, self.location.origin);
    if (kind === 'bypass') return;
    const clientId = event.resultingClientId || event.clientId || '';
    if (kind === 'page') {
        event.respondWith(networkFirst(event, request, CACHES.pages, { ignoreSearch: true, kind, clientId, fallback: (cache) => pageFallback(cache, request) }));
    } else if (kind === 'data') {
        event.respondWith(networkFirst(event, request, CACHES.data, { kind, clientId }));
    } else if (kind === 'assets') {
        event.respondWith(networkFirst(event, request, CACHES.assets, { kind, clientId }));
    } else if (kind === 'image') {
        event.respondWith(cacheFirst(event, request, CACHES.images, IMAGE_LIMIT));
    } else if (kind === 'cdn') {
        event.respondWith(cacheFirst(event, request, CACHES.cdn));
    }
}

async function precache() {
    const cache = await caches.open(CACHES.pages);
    // One at a time and each on its own: a missing file must not fail the install.
    for (const path of PRECACHE) {
        try {
            const response = await fetch(path, { cache: 'no-cache' });
            if (cacheable(response)) await cache.put(path, await stamped(response));
        } catch (_) { /* saved on first use instead */ }
    }
}

async function activate() {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('chunky-') && !CACHE_NAMES.includes(name)).map((name) => caches.delete(name)));
    if (self.clients && typeof self.clients.claim === 'function') await self.clients.claim();
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function' && typeof caches !== 'undefined') {
    self.addEventListener('install', (event) => {
        if (typeof self.skipWaiting === 'function') self.skipWaiting();
        event.waitUntil(precache());
    });
    self.addEventListener('activate', (event) => { event.waitUntil(activate()); });
    self.addEventListener('fetch', handleFetch);
    self.addEventListener('message', handleMessage);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VERSION, CACHES, CACHE_NAMES, NETWORK_WAIT_MS, IMAGE_LIMIT, OFFLINE_PAGE, PRECACHE, CACHED_AT_HEADER, SERVED_FROM_HEADER, classify, parentPagePath, cacheable, handleFetch, handleMessage, savePage, networkFirst, cacheFirst, trim, precache, activate, _setNetworkWait: (ms) => { networkWaitMs = ms; } };
}

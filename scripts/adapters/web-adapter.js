// ============================================================================
// WEB ADAPTER - BROWSER ENVIRONMENT SPECIFIC CODE
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains Browser/Web ONLY code
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Web APIs (fetch, DOMParser, localStorage, document, window)
// ✅ Browser-specific HTTP requests and DOM operations
// ✅ Web-specific UI and display functionality
//
// ❌ NEVER ADD THESE TO THIS FILE:
// ❌ Scriptable APIs (Request, Calendar, FileManager, Alert, Notification)
// ❌ Business logic (that belongs in shared-core.js)
// ❌ Parsing logic (that belongs in parsers/)
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

const PAGE_CACHE_MAX_FILE_BASENAME = 120;
const PAGE_CACHE_TRUNCATED_PREFIX_LENGTH = 80;
// Sentinel for bounded shared-root fs operations (dataless iCloud stubs).
// Originally only the cache read was bounded; the 2026-08 scheduled-run hang
// proved EVERY fs op against an evicted file can wedge (see boundedSharedFsOp).
const SHARED_CACHE_READ_TIMED_OUT = Symbol('shared-cache-read-timed-out');
// Copy of the Scriptable adapter's SIMPLE_URL_PARSE_REGEX (device-parity page
// cache keys — see getDeviceParityPageCachePathParts).
// Captures: 1=scheme, 2=authority, 3=path, 4=query (without fragment).
const DEVICE_PARITY_URL_PARSE_REGEX = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i;

class WebAdapter {
    constructor(config = {}) {
        this.config = {
            timeout: config.timeout || 30000,
            userAgent: config.userAgent || 'chunky-dad-scraper/1.0',
            ...config
        };
        
        // Store cities configuration for calendar mapping
        this.cities = config.cities || {};
        // Learned dead-end store: Node runs persist dead-ends.json (shared
        // storage root when active, local state dir otherwise — see
        // getDeadEndsFilePath); this in-memory copy is the browser fallback.
        this.deadEndStore = {};
        this.isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node);
        this.fs = null;
        this.path = null;
        this.pageStorageDir = null;
        // Local state dir for adapter-owned JSON stores (bear-verdicts.json);
        // Node-only, same root the page cache lives under.
        this.localStateDir = null;

        this.sharedStorageRoot = null;

        if (this.isNode) {
            try {
                this.fs = require('fs');
                this.path = require('path');
                const os = require('os');
                this.localStateDir = this.path.join(os.homedir(), '.chunky-dad-scraper');
                this.pageStorageDir = this.path.join(this.localStateDir, 'storage', 'pages');
            } catch (error) {
                console.log(`🟢 Node.js: Page cache setup unavailable: ${error.message}`);
            }

            // Shared Mac↔phone cache root (opt-in): CHUNKY_SHARED_STORAGE_DIR
            // points at the phone's `chunky-dad-scraper` tree (the directory
            // that CONTAINS storage/, runs/ and logs/ — on the real device
            // dir that is .../iCloud~dk~simonbs~Scriptable/Documents/
            // chunky-dad-scraper). The on-disk key derivation and JSON
            // envelopes are already byte-identical across platforms, so
            // repointing the roots makes device entries and Mac entries
            // interchangeable. Validation is deliberately OUTSIDE the
            // try/catch above: an unreachable shared root must ABORT the run
            // loudly (no-partial-runs doctrine) — a silent fallback to the
            // local cache would produce a degraded run that later syncs
            // confusing state.
            const sharedRoot = this.resolveSharedStorageRootSetting();
            if (sharedRoot) {
                this.assertSharedStorageRootUsable(sharedRoot);
                this.sharedStorageRoot = sharedRoot;
                this.pageStorageDir = this.path.join(sharedRoot, 'storage', 'pages');
                console.log(`🟢 Node.js: Shared storage root active: ${sharedRoot} — caches, runs and logs read/write the phone's tree; retention pruning is deferred to the cache owner (the phone)`);
            }
        }
    }

    // The raw CHUNKY_SHARED_STORAGE_DIR setting (trimmed), or '' when the
    // feature is off. Node-only by construction: browsers have no process.env.
    resolveSharedStorageRootSetting() {
        if (!this.isNode || typeof process === 'undefined' || !process.env) return '';
        return String(process.env.CHUNKY_SHARED_STORAGE_DIR || '').trim();
    }

    // NO PARTIAL RUNS: the shared root must already exist AND contain the
    // phone-created storage/ subtree. Never mkdir here — if iCloud is signed
    // out or the path is wrong, creating the tree would silently fork a local
    // orphan that later syncs confusing state into the real cache.
    assertSharedStorageRootUsable(sharedRoot) {
        if (!this.fs || !this.path) {
            throw new Error(`CHUNKY_SHARED_STORAGE_DIR is set but Node fs/path are unavailable — aborting instead of running with a local cache`);
        }
        let rootStat = null;
        try {
            rootStat = this.fs.statSync(sharedRoot);
        } catch (_) {
            rootStat = null;
        }
        if (!rootStat || !rootStat.isDirectory()) {
            throw new Error(`Shared storage root unreachable: ${sharedRoot} does not exist or is not a directory (iCloud signed out? wrong path?) — aborting the run instead of silently falling back to the local cache`);
        }
        const storageDir = this.path.join(sharedRoot, 'storage');
        let storageStat = null;
        try {
            storageStat = this.fs.statSync(storageDir);
        } catch (_) {
            storageStat = null;
        }
        if (!storageStat || !storageStat.isDirectory()) {
            throw new Error(`Shared storage root ${sharedRoot} has no storage/ subtree — expected the phone's chunky-dad-scraper directory (did you point at .../Documents instead of .../Documents/chunky-dad-scraper?) — aborting the run`);
        }
    }

    // Cache writes under an iCloud-synced tree must never leave a torn file
    // for the sync engine to ship: write the full payload to a temp file in
    // the SAME directory, then rename over the final name (atomic on APFS).
    //
    // DATALESS-TARGET HAZARD (2026-08 scheduled-run hang): renaming a temp
    // file OVER a dataless (evicted) iCloud placeholder deadlocks inside
    // fileproviderd — the rename syscall never returns and the awaited
    // promise never settles, silently hanging the whole run. So when the
    // shared root is active, the destination is unlinked FIRST. The unlink
    // itself can also wedge on a dataless file, which is why (a) the startup
    // materialization sweep in tools/run-once.js downloads every evicted file
    // before parser work begins, and (b) every op here is bounded by
    // boundedSharedFsOp as belt-and-braces on top of that sweep.
    async writeFileAtomicallyNode(filePath, contents) {
        const tmpPath = `${filePath}.tmp-${process.pid.toString(36)}-${Date.now().toString(36)}`;
        await this.boundedSharedFsOp(() => this.fs.promises.writeFile(tmpPath, contents, 'utf8'), `write ${tmpPath}`);
        if (this.sharedStorageRoot) {
            // Never rename over a possibly-dataless target (fileproviderd
            // deadlock). ENOENT is the normal first-write case.
            try {
                await this.boundedSharedFsOp(() => this.fs.promises.unlink(filePath), `unlink ${filePath}`);
            } catch (error) {
                if (!error || error.code !== 'ENOENT') {
                    throw error;
                }
            }
        }
        await this.boundedSharedFsOp(() => this.fs.promises.rename(tmpPath, filePath), `rename ${tmpPath} -> ${filePath}`);
    }

    // Run a shared-root fs operation with an upper bound. When the shared
    // root is OFF this is a pure passthrough (no timers, byte-identical
    // behavior for local-cache runs).
    //
    // WHY THIS EXISTS: syscalls against dataless (evicted) iCloud files can
    // block in the kernel indefinitely (open/read/stat/rename/unlink alike —
    // the 2026-08 incident sampled two of them wedged for 22+ minutes). A
    // JS-side timeout CANNOT cancel the syscall: the libuv threadpool slot
    // stays hostage even after this helper gives up, and four wedged ops
    // exhaust the default 4-slot pool and starve every later fs/dns call.
    // That is why (1) tools/run-once.js materializes the whole tree BEFORE
    // parser work — this helper is only the last line of defense — and
    // (2) run-once bumps UV_THREADPOOL_SIZE so a few leaked slots cannot
    // stall the loop. On timeout the op is treated as FAILED (reads report a
    // miss, writes are skipped by the caller's catch) with a loud log line,
    // and the run keeps moving.
    async boundedSharedFsOp(startOp, label, options = {}) {
        if (!this.sharedStorageRoot) {
            return startOp();
        }
        const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : this.config.timeout;
        const opPromise = startOp();
        let timer = null;
        const timeoutPromise = new Promise((resolve) => {
            timer = setTimeout(() => resolve(SHARED_CACHE_READ_TIMED_OUT), timeoutMs);
        });
        try {
            const result = await Promise.race([opPromise, timeoutPromise]);
            if (result === SHARED_CACHE_READ_TIMED_OUT) {
                // The abandoned promise may still settle (or reject) later;
                // never let it surface as an unhandled rejection.
                opPromise.catch(() => {});
                if (!options.quiet) {
                    console.log(`🟢 Node.js: Shared storage fs op timed out after ${timeoutMs}ms (dataless iCloud stub? fileproviderd wedge?) — treating as failed: ${label}`);
                }
                const error = new Error(`Shared storage fs op timed out after ${timeoutMs}ms: ${label}`);
                error.code = 'ESHAREDFSTIMEOUT';
                error.sharedFsTimeout = true;
                throw error;
            }
            return result;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    // -----------------------------------------------------------------------
    // PERSISTENT MANUAL BEAR VERDICTS — web/Node twin of the Scriptable
    // store (bear-verdicts.json, same shape: { version, verdicts: [...] }).
    // The phone's results UI is where verdicts are tapped; here the store is
    // honored when the file exists under the local state dir (e.g. synced
    // for Mac-server runs) and fails soft to empty everywhere else. Browser
    // runs have no local file access and report an empty store.
    // -----------------------------------------------------------------------
    getBearVerdictsFilePath() {
        if (!this.isNode || !this.path || !this.localStateDir) return null;
        return this.path.join(this.localStateDir, 'bear-verdicts.json');
    }

    async loadBearVerdicts() {
        const filePath = this.getBearVerdictsFilePath();
        if (!filePath || !this.fs) return [];
        try {
            if (!this.fs.existsSync(filePath)) return [];
            const parsed = JSON.parse(await this.fs.promises.readFile(filePath, 'utf8'));
            const verdicts = parsed && !Array.isArray(parsed) && Array.isArray(parsed.verdicts)
                ? parsed.verdicts
                : Array.isArray(parsed) ? parsed : null;
            if (!verdicts) {
                console.log('🟢 Node.js: Bear verdict store has unexpected shape — starting empty');
                return [];
            }
            return verdicts.filter(entry => entry && typeof entry === 'object');
        } catch (error) {
            console.log(`🟢 Node.js: Bear verdict store read failed (${error.message}) — starting empty`);
            return [];
        }
    }

    async saveBearVerdicts(verdicts) {
        const filePath = this.getBearVerdictsFilePath();
        if (!filePath || !this.fs || !Array.isArray(verdicts)) return;
        try {
            await this.fs.promises.mkdir(this.localStateDir, { recursive: true });
            await this.fs.promises.writeFile(filePath, JSON.stringify({ version: 1, verdicts }, null, 2), 'utf8');
            console.log(`🟢 Node.js: ✓ Saved bear verdict store (${verdicts.length} entries) to ${filePath}`);
        } catch (error) {
            console.log(`🟢 Node.js: Bear verdict store write failed: ${error.message}`);
        }
    }

    // Apple's native reverse geocoder is a Scriptable-only capability; Node has
    // no equivalent, so this honestly reports absence and the normalizer skips
    // its geocode-verification cross-check.
    async reverseGeocodePlacemark() {
        return null;
    }

    // Adapter self-description for normalizers' enforce mode: Node has no
    // Apple geocoding service, so the reverse cross-check capability is
    // structurally absent — a skipped cross-check here is not a failure and
    // enforce mode accepts it as before.
    supportsReverseGeocode() {
        return false;
    }

    // On Scriptable the reviewer refreshes bar data from the live site; on
    // Node the repo checkout IS the source the site deploys from, so the
    // local bars are already current — pass them through honestly.
    async refreshRemoteBars(cityKeys, localBars) {
        const bars = localBars && typeof localBars === 'object' ? localBars : {};
        return {
            bars,
            counts: { remote: 0, local: Object.keys(bars).length, unavailable: 0 }
        };
    }

    // Same honest pass-through for the curated promoter registry: on Node the
    // repo checkout IS the source chunky.dad deploys data/promoters.json
    // from, so the local registry is already current.
    async refreshRemotePromoters(localPromoters) {
        const promoters = Array.isArray(localPromoters) ? localPromoters : [];
        return {
            promoters,
            counts: { remote: 0, localOnly: promoters.length }
        };
    }

    getPageCacheConfig() {
        const pageCache = this.config.pageCache || {};
        const ttlDays = Number(pageCache.ttlDays);
        return {
            enabled: pageCache.enabled === true && this.isNode && !!this.fs && !!this.path && !!this.pageStorageDir,
            ttlDays: Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 3
        };
    }

    normalizePageCacheUrl(url) {
        try {
            const normalized = new URL(String(url));
            normalized.hash = '';
            normalized.protocol = normalized.protocol.toLowerCase();
            normalized.hostname = normalized.hostname.toLowerCase();

            const searchEntries = Array.from(normalized.searchParams.entries())
                .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
                    if (leftKey === rightKey) {
                        return leftValue.localeCompare(rightValue);
                    }
                    return leftKey.localeCompare(rightKey);
                });

            normalized.search = '';
            searchEntries.forEach(([key, value]) => normalized.searchParams.append(key, value));

            return normalized.toString();
        } catch (_) {
            return String(url || '').trim();
        }
    }

    sanitizePageCacheSegment(segment) {
        return String(segment || 'index')
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'index';
    }

    hashPageCacheValue(value) {
        // FNV-1a 32-bit hash for compact deterministic cache keys.
        let hash = 2166136261;
        const input = String(value || '');
        for (let i = 0; i < input.length; i++) {
            hash ^= input.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    // Device-parity page cache keys. The phone's JavaScriptCore has no
    // URL/URLSearchParams, so ScriptableAdapter.normalizePageCacheUrl ALWAYS
    // lands in its catch (raw trimmed URL, query order preserved) and
    // parsePageCacheUrl always takes its regex fallback. Node's `new URL`
    // branch re-sorts and re-encodes the query, so the SAME page would get a
    // DIFFERENT filename (verified against the real device entry
    // api__v1__events__search--q-1b8y3s1.json — the sorted-query hash is
    // 10f5jmh). When the shared root is active the phone's derivation is
    // canonical, so this replicates its regex path byte-for-byte.
    getDeviceParityPageCachePathParts(url) {
        // Device normalizePageCacheUrl: `new URL` throws (undefined) → catch.
        const normalizedUrl = String(url || '').trim();
        const match = normalizedUrl.match(DEVICE_PARITY_URL_PARSE_REGEX);
        if (!match) {
            return {
                normalizedUrl,
                hostDir: 'unknown-host',
                fileName: `${this.hashPageCacheValue(normalizedUrl || url)}.json`
            };
        }

        // Device parsePageCacheUrl regex path: lowercase authority, strip
        // userinfo, keep the port in `host` (which names the host dir).
        const authority = String(match[2] || '').toLowerCase();
        let host = authority;
        const authSeparatorIndex = host.lastIndexOf('@');
        if (authSeparatorIndex >= 0) {
            host = host.slice(authSeparatorIndex + 1);
        }
        let hostname = host;
        if (host.startsWith('[')) {
            const ipv6EndIndex = host.indexOf(']');
            hostname = ipv6EndIndex > 0 ? host.slice(0, ipv6EndIndex + 1) : host;
        } else {
            hostname = host.split(':')[0] || '';
        }
        const pathname = match[3] || '/';
        const search = match[4] || '';

        const hostDir = this.sanitizePageCacheSegment(host || hostname || 'unknown-host');
        const pathSegments = pathname
            .split('/')
            .filter(Boolean)
            .map(segment => this.sanitizePageCacheSegment(segment));

        let fileBase = pathSegments.length > 0 ? pathSegments.join('__') : 'index';
        if (search) {
            fileBase += `--q-${this.hashPageCacheValue(search)}`;
        }
        if (fileBase.length > PAGE_CACHE_MAX_FILE_BASENAME) {
            fileBase = `${fileBase.slice(0, PAGE_CACHE_TRUNCATED_PREFIX_LENGTH)}--${this.hashPageCacheValue(fileBase)}`;
        }

        return {
            normalizedUrl,
            hostDir,
            fileName: `${fileBase}.json`
        };
    }

    getPageCachePathParts(url) {
        if (this.sharedStorageRoot) {
            return this.getDeviceParityPageCachePathParts(url);
        }
        const normalizedUrl = this.normalizePageCacheUrl(url);

        try {
            const parsed = new URL(normalizedUrl);
            const hostDir = this.sanitizePageCacheSegment(parsed.host || parsed.hostname || 'unknown-host');
            const pathSegments = parsed.pathname
                .split('/')
                .filter(Boolean)
                .map(segment => this.sanitizePageCacheSegment(segment));

            let fileBase = pathSegments.length > 0 ? pathSegments.join('__') : 'index';
            if (parsed.search) {
                fileBase += `--q-${this.hashPageCacheValue(parsed.search)}`;
            }
            if (fileBase.length > PAGE_CACHE_MAX_FILE_BASENAME) {
                fileBase = `${fileBase.slice(0, PAGE_CACHE_TRUNCATED_PREFIX_LENGTH)}--${this.hashPageCacheValue(fileBase)}`;
            }

            return {
                normalizedUrl,
                hostDir,
                fileName: `${fileBase}.json`
            };
        } catch (_) {
            const fallbackName = `${this.hashPageCacheValue(normalizedUrl || url)}.json`;
            return {
                normalizedUrl,
                hostDir: 'unknown-host',
                fileName: fallbackName
            };
        }
    }

    async readCachedPage(url, pageCacheConfig) {
        if (!pageCacheConfig.enabled) {
            return null;
        }

        const { hostDir, fileName, normalizedUrl } = this.getPageCachePathParts(url);
        const cachePath = this.path.join(this.pageStorageDir, hostDir, fileName);

        try {
            // stat can also wedge against a dataless stub (the incident's
            // kernel samples were open() and rename(), but any path-based
            // syscall on an evicted file qualifies) — bounded like the read;
            // a timeout throws, lands in the catch below, and reads as a miss.
            const stats = await this.boundedSharedFsOp(() => this.fs.promises.stat(cachePath), `stat ${cachePath}`);
            const maxAgeMs = pageCacheConfig.ttlDays * 24 * 60 * 60 * 1000;
            if ((Date.now() - stats.mtimeMs) > maxAgeMs) {
                return null;
            }

            const cachedText = await this.readCacheFileBounded(cachePath);
            // Dataless-file handling: macOS evicts iCloud files to placeholder
            // stubs, and an evicted/timed-out/empty entry is a cache MISS, not
            // a crash — the run refetches and rewrites it (fail open).
            if (typeof cachedText !== 'string' || cachedText.trim().length === 0) {
                return null;
            }
            const cached = JSON.parse(cachedText);
            const fetchState = typeof cached.fetchState === 'string' ? cached.fetchState.toLowerCase() : '';
            if (fetchState === 'failed' && cached.failure && cached.failure.nonRetryable === true) {
                const failureMessage = typeof cached.failure.error === 'string'
                    ? cached.failure.error
                    : (cached.failure.error && typeof cached.failure.error.message === 'string'
                        ? cached.failure.error.message
                        : `Cached non-retryable failure for ${normalizedUrl}`);
                const failureError = new Error(failureMessage);
                failureError.retryable = false;
                failureError.cachedFailure = true;
                if (Number.isFinite(cached.statusCode)) {
                    failureError.statusCode = cached.statusCode;
                }
                throw failureError;
            }
            if (fetchState !== 'downloaded') {
                return null;
            }
            if (!cached || typeof cached.html !== 'string' || cached.html.length === 0) {
                return null;
            }

            return {
                html: cached.html,
                url: cached.url || normalizedUrl,
                statusCode: cached.statusCode || 200,
                headers: cached.headers || {},
                fetchedAt: cached.fetchedAt || null,
                modifiedAtMs: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : null,
                cachePath
            };
        } catch (error) {
            if (error?.cachedFailure) {
                throw error;
            }
            if (error && error.code !== 'ENOENT') {
                console.log(`🟢 Node.js: Page cache read failed for ${url}: ${error.message}`);
            }
            return null;
        }
    }

    // Read a cache file with an upper bound when the shared root is active:
    // opening a dataless iCloud stub normally blocks while fileproviderd
    // downloads the bytes (which IS the cheap materialization trigger), but a
    // dead network could park that read forever, so it is raced against the
    // adapter's existing timeout and a timeout is reported as a miss.
    // Built on boundedSharedFsOp (quiet: this path keeps its own miss line).
    async readCacheFileBounded(cachePath) {
        const timeoutMs = this.config.timeout;
        try {
            return await this.boundedSharedFsOp(
                () => this.fs.promises.readFile(cachePath, 'utf8'),
                `read ${cachePath}`,
                { timeoutMs, quiet: true }
            );
        } catch (error) {
            if (error && error.sharedFsTimeout) {
                console.log(`🟢 Node.js: Shared cache read timed out after ${timeoutMs}ms (dataless iCloud stub still downloading?) — treating ${cachePath} as a cache miss`);
                return null;
            }
            throw error;
        }
    }

    // Hours below 24h ("5.3h"), days otherwise ("2.1d"); null when unknown.
    formatPageCacheAge(ageMs) {
        if (!Number.isFinite(ageMs) || ageMs < 0) {
            return null;
        }
        const hours = ageMs / (60 * 60 * 1000);
        return hours < 24 ? `${hours.toFixed(1)}h` : `${(hours / 24).toFixed(1)}d`;
    }

    // Cache hits were previously silent, hiding why a page showed stale content.
    logPageCacheHit(url, cachedPage, pageCacheConfig) {
        const fetchedAtMs = cachedPage.fetchedAt ? Date.parse(cachedPage.fetchedAt) : NaN;
        const baseMs = Number.isFinite(fetchedAtMs) ? fetchedAtMs : Number(cachedPage.modifiedAtMs);
        const age = Number.isFinite(baseMs) && baseMs > 0 ? this.formatPageCacheAge(Date.now() - baseMs) : null;
        const agePart = age ? `age ${age}, ` : '';
        console.log(`🟢 Node.js: Page cache hit (${agePart}ttl ${pageCacheConfig.ttlDays}d) for ${url}`);
    }

    async writeCachedPage(url, responseData, pageCacheConfig) {
        if (!pageCacheConfig.enabled || !responseData || typeof responseData.html !== 'string' || responseData.html.length === 0) {
            return;
        }

        const { hostDir, fileName, normalizedUrl } = this.getPageCachePathParts(url);
        const cacheDir = this.path.join(this.pageStorageDir, hostDir);
        const cachePath = this.path.join(cacheDir, fileName);
        const payload = {
            url: normalizedUrl,
            fetchedAt: new Date().toISOString(),
            statusCode: responseData.statusCode || 200,
            headers: responseData.headers || {},
            fetchState: 'downloaded',
            html: responseData.html
        };

        try {
            await this.fs.promises.mkdir(cacheDir, { recursive: true });
            // temp-file-then-rename: under the shared iCloud root a plain
            // writeFile can be synced mid-write; the rename is atomic.
            await this.writeFileAtomicallyNode(cachePath, JSON.stringify(payload, null, 2));
        } catch (error) {
            console.log(`🟢 Node.js: Page cache write failed for ${url}: ${error.message}`);
        }
    }
    
    // Learned dead-end store persistence — the Node twin of the Scriptable
    // adapter's dead-ends.json. Before run 20260815-083809 this was
    // in-memory only, so scheduled Mac runs re-crawled the same 403'd
    // eventim deep-links on every run: the store learned them and threw
    // them away at process exit. Location mirrors the phone's contract:
    // at the shared storage root when active (the phone's tree keeps ONE
    // dead-ends.json both devices read and write), under the local state
    // dir otherwise. Browser runs keep the old in-memory fallback.
    getDeadEndsFilePath() {
        if (!this.isNode || !this.path) return null;
        if (this.sharedStorageRoot) {
            return this.path.join(this.sharedStorageRoot, 'dead-ends.json');
        }
        if (!this.localStateDir) return null;
        return this.path.join(this.localStateDir, 'dead-ends.json');
    }

    async loadDeadEnds() {
        const filePath = this.getDeadEndsFilePath();
        if (!filePath || !this.fs) {
            if (!this.deadEndStore || typeof this.deadEndStore !== 'object' || Array.isArray(this.deadEndStore)) {
                this.deadEndStore = {};
            }
            return this.deadEndStore;
        }
        try {
            if (!this.fs.existsSync(filePath)) return {};
            const raw = await this.boundedSharedFsOp(
                () => this.fs.promises.readFile(filePath, 'utf8'),
                `read ${filePath}`
            );
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                console.log('🟢 Node.js: Dead-end store has unexpected shape — starting with empty store');
                return {};
            }
            return parsed;
        } catch (error) {
            // Corrupt or unreadable file must never break a run — the store
            // is a pure optimization and rebuilds itself over later runs.
            console.log(`🟢 Node.js: Dead-end store read failed (${error.message}) — starting with empty store`);
            return {};
        }
    }

    async saveDeadEnds(store) {
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return;
        }
        const filePath = this.getDeadEndsFilePath();
        if (!filePath || !this.fs) {
            this.deadEndStore = store;
            return;
        }
        try {
            if (!this.sharedStorageRoot) {
                // Never mkdir under the shared root (the phone owns that
                // tree); the local state dir is ours to create.
                await this.fs.promises.mkdir(this.localStateDir, { recursive: true });
            }
            await this.writeFileAtomicallyNode(filePath, JSON.stringify(store, null, 2));
            console.log(`🟢 Node.js: ✓ Saved dead-end store (${Object.keys(store).length} entries) to ${filePath}`);
        } catch (error) {
            console.log(`🟢 Node.js: Dead-end store write failed: ${error.message}`);
        }
    }

    getRunContext() {
        const isNode = typeof window === 'undefined';
        const environment = isNode ? 'node' : 'web';
        // Scheduled Mac runs (tools/schedule-mac-run.sh → tools/run-once.js
        // with CHUNKY_RUN_AUTOMATION set) mirror the phone's automation runs:
        // the run context says so, so saved runs and the results header report
        // the honest trigger instead of "manual".
        if (this.isAutomationRunRequested()) {
            return {
                type: 'automated',
                environment,
                trigger: 'scheduled',
                automationRun: true
            };
        }
        return {
            type: 'manual',
            environment,
            trigger: environment
        };
    }

    // Truthy CHUNKY_RUN_AUTOMATION (Node only) marks this process's run as an
    // automation run — same meaning as the phone's scheduled automation.
    isAutomationRunRequested() {
        if (!this.isNode || typeof process === 'undefined' || !process.env) return false;
        const raw = String(process.env.CHUNKY_RUN_AUTOMATION || '').trim().toLowerCase();
        return raw === '1' || raw === 'true' || raw === 'yes';
    }

    // ------------------------------------------------------------------
    // Shared runs/logs (Mac↔phone). When the shared storage root is active,
    // Mac runs persist into the SAME runs/ and logs/ dirs the phone writes,
    // with the phone's YYYYMMDD-HHMMSS naming and version-2 run envelope, so
    // the phone's saved-run browser (display-saved-run.js) and the tailnet
    // server list Mac runs exactly like phone runs. Timestamp-second ids
    // keep Mac and phone writes from colliding. The phone's "save before UI"
    // ordering maps here to "save before the caller renders/publishes":
    // tools/run-once.js calls this FIRST, before writing its own
    // latest-run.json for the server to render.
    // ------------------------------------------------------------------

    // Same filesystem-friendly local-time id the Scriptable adapter mints.
    getRunId(timestamp = new Date()) {
        const pad = (n) => String(n).padStart(2, '0');
        const y = timestamp.getFullYear();
        const m = pad(timestamp.getMonth() + 1);
        const d = pad(timestamp.getDate());
        const hh = pad(timestamp.getHours());
        const mm = pad(timestamp.getMinutes());
        const ss = pad(timestamp.getSeconds());
        return `${y}${m}${d}-${hh}${mm}${ss}`;
    }

    // Node copy of ScriptableAdapter.sanitizeEventForRunSave — same slimming
    // rules so a Mac-saved run renders identically in the phone's browser.
    sanitizeEventForRunSave(event) {
        if (!event || typeof event !== 'object') return event;
        const seen = new WeakSet();
        try {
            return JSON.parse(JSON.stringify(event, (key, value) => {
                if (key === '_parserConfig' && value) {
                    return {
                        name: value.name,
                        parser: value.parser,
                        dryRun: value.dryRun,
                        city: value.city,
                        calendarSearchRangeDays: value.calendarSearchRangeDays
                    };
                }
                if (key === '_existingEvent' && value) {
                    return {
                        title: value.title,
                        identifier: value.identifier,
                        startDate: value.startDate,
                        endDate: value.endDate,
                        location: value.location,
                        url: value.url
                    };
                }
                if (key === '_conflicts' && value && Array.isArray(value)) {
                    return value.map((conflict) => ({
                        title: conflict.title,
                        startDate: conflict.startDate,
                        endDate: conflict.endDate,
                        identifier: conflict.identifier
                    }));
                }
                if (key === 'calendar' && value && value.title && value.identifier) {
                    return {
                        title: value.title,
                        identifier: value.identifier
                    };
                }
                if (typeof value === 'function') {
                    return undefined;
                }
                if (value && typeof value === 'object') {
                    if (seen.has(value)) {
                        return undefined;
                    }
                    seen.add(value);
                }
                return value;
            }));
        } catch (error) {
            console.log(`🟢 Node.js: Failed to serialize event "${event.title || event.name || 'unknown'}" for run save: ${error.message}`);
            return {
                title: event.title || event.name || '',
                startDate: event.startDate || null,
                endDate: event.endDate || null,
                location: event.location || event.venue || '',
                // url/website are ONE field — website is canonical; the url
                // key is kept for older saved-run readers as a view of it.
                url: event.website || event.url || '',
                city: event.city || '',
                _action: event._action || null,
                _analysis: event._analysis || null,
                _mergeDiff: event._mergeDiff || null,
                _original: event._original || null
            };
        }
    }

    sanitizeEventsForRunSave(events) {
        if (!Array.isArray(events)) return [];
        return events
            .map((event) => this.sanitizeEventForRunSave(event))
            .filter(Boolean);
    }

    // Node copy of ScriptableAdapter.sanitizeDroppedEntriesForRunSave.
    sanitizeDroppedEntriesForRunSave(entries) {
        if (!Array.isArray(entries)) return [];
        return entries.map((entry) => {
            if (!entry || typeof entry !== 'object') return entry;
            const copy = { ...entry };
            delete copy._parserConfig;
            if (copy.event && typeof copy.event === 'object') {
                const event = {};
                for (const key of Object.keys(copy.event)) {
                    if (key.startsWith('_')) continue;
                    event[key] = copy.event[key];
                }
                copy.event = event;
            }
            return copy;
        });
    }

    // The phone stringifies its run payload plainly (and a cycle fails the
    // save); Node results occasionally self-reference, so try the identical
    // plain stringify first and only fall back to dropping repeated object
    // branches — the same semantics sanitizeEventForRunSave already applies
    // per event.
    stringifyRunPayload(payload) {
        try {
            return JSON.stringify(payload);
        } catch (_) {
            const seen = new WeakSet();
            return JSON.stringify(payload, (key, value) => {
                if (value && typeof value === 'object') {
                    if (seen.has(value)) return undefined;
                    seen.add(value);
                }
                return value;
            });
        }
    }

    // Persist this run's JSON and log into the shared root's runs/ and logs/
    // dirs. `results` may be null for a FAILED run — the log (the evidence of
    // what went wrong) is still written; the run JSON is not. Returns the
    // runId, or null when the shared root is off or the save failed.
    async saveRunToSharedStorage(results, options = {}) {
        if (!this.isNode || !this.sharedStorageRoot || !this.fs || !this.path) return null;
        try {
            const ts = new Date();
            const runId = this.getRunId(ts);
            const runsDir = this.path.join(this.sharedStorageRoot, 'runs');
            const logsDir = this.path.join(this.sharedStorageRoot, 'logs');
            await this.fs.promises.mkdir(runsDir, { recursive: true });
            await this.fs.promises.mkdir(logsDir, { recursive: true });

            const runContext = (results && results.runContext) || this.getRunContext();
            const totals = {
                totalEvents: (results && results.totalEvents) || 0,
                bearEvents: (results && results.bearEvents) || 0,
                calendarEvents: (results && results.calendarEvents) || 0,
                errors: ((results && results.errors) || []).length
            };

            if (results && typeof results === 'object') {
                const summary = {
                    runId,
                    timestamp: ts.toISOString(),
                    runContext,
                    totals,
                    parserSummaries: (results.parserResults || []).map((r) => ({
                        name: r.name,
                        bearEvents: r.bearEvents,
                        totalEvents: r.totalEvents
                    }))
                };
                const payload = {
                    version: 2,
                    summary,
                    runContext,
                    config: results.config || null,
                    analyzedEvents: this.sanitizeEventsForRunSave(results.analyzedEvents || []),
                    bearDroppedEvents: this.sanitizeDroppedEntriesForRunSave(results.bearDroppedEvents),
                    parserResults: results.parserResults || [],
                    errors: results.errors || [],
                    calendarHygiene: Array.isArray(results.calendarHygiene)
                        ? results.calendarHygiene
                        : []
                };
                const runFilePath = this.path.join(runsDir, `${runId}.json`);
                await this.writeFileAtomicallyNode(runFilePath, this.stringifyRunPayload(payload));
                results.savedRunId = runId;
                results.savedRunPath = runFilePath;
                console.log(`🟢 Node.js: 💾 Saved run ${runId} to ${runFilePath} (shared storage — the phone's saved-run browser lists it like a phone run)`);
            }

            // Same first-line shape as the phone's appendLogSummary, so log
            // tooling can parse phone and Mac logs identically.
            const logSummary = {
                timestamp: new Date().toISOString(),
                runId,
                runContext,
                totals,
                ...(options.failure ? { failure: String(options.failure) } : {})
            };
            const summaryLine = `${new Date().toISOString()} - ${JSON.stringify(logSummary)}`;
            const logText = typeof options.logText === 'string' ? options.logText : '';
            const content = logText ? `${summaryLine}\n${logText}` : `${summaryLine}\n`;
            const logFilePath = this.path.join(logsDir, `${runId}.log`);
            await this.writeFileAtomicallyNode(logFilePath, content);
            console.log(`🟢 Node.js: 💾 Log for run ${runId} written to ${logFilePath} (shared storage)`);
            return runId;
        } catch (error) {
            console.log(`🟢 Node.js: ✗ Failed to save run to shared storage: ${error.message}`);
            return null;
        }
    }

    // Get calendar name for a city (matching scriptable-adapter pattern)
    getCalendarName(city) {
        if (city && this.cities[city] && this.cities[city].calendar) {
            return this.cities[city].calendar;
        }
        // Fail closed — same contract as the Scriptable adapter: an
        // unrecognized city never mints `chunky-dad-<raw string>` (run
        // 2026-07-31 produced "chunky-dad-wilton manors", a target with a
        // space in it). Routes to the one unknown target, logged once.
        const core = this.getSharedCoreRef();
        const target = core && typeof core.resolveCalendarTarget === 'function'
            ? core.resolveCalendarTarget(this.cities, city)
            : { name: 'chunky-dad-unknown', recognized: false, requested: String(city == null ? '' : city).trim() };
        this.logUnrecognizedCalendarCity(target);
        return target.name;
    }

    // Additive, once per distinct unrecognized city.
    logUnrecognizedCalendarCity(target) {
        if (!target || target.recognized) return;
        if (!this._unrecognizedCalendarCities) {
            this._unrecognizedCalendarCities = new Set();
        }
        const key = target.requested || '(empty)';
        if (this._unrecognizedCalendarCities.has(key)) return;
        this._unrecognizedCalendarCities.add(key);
        console.log(`🖥️ WebAdapter: ⚠️ Unrecognized city "${key}" has no configured calendar — routed to "${target.name}" (no calendar name is ever invented from a city string)`);
    }

    // HTTP Adapter Implementation
    async fetchData(url, options = {}) {
        try {
            const pageCacheConfig = this.getPageCacheConfig();
            const canUseCache = pageCacheConfig.enabled && (options.method || 'GET').toUpperCase() === 'GET' && !options.body;
            // Optional caller hook (options.isCacheableResponse): a response it
            // rejects is neither served from the disk cache nor written to it —
            // used by the geocode path so an empty Nominatim body can't poison a
            // venue for the whole TTL. Callers that don't pass it are unaffected.
            const isCacheableResponse = (responseData) =>
                typeof options.isCacheableResponse !== 'function' || options.isCacheableResponse(responseData) !== false;
            if (canUseCache) {
                const cachedPage = await this.readCachedPage(url, pageCacheConfig);
                if (cachedPage && isCacheableResponse(cachedPage)) {
                    this.logPageCacheHit(url, cachedPage, pageCacheConfig);
                    return cachedPage;
                }
            }

            const fetchUrl = this.config.corsProxy
                ? `${this.config.corsProxy}${encodeURIComponent(url)}`
                : url;

            const fetchOptions = {
                method: options.method || 'GET',
                headers: {
                    'User-Agent': this.config.userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    ...options.headers
                },
                signal: AbortSignal.timeout(this.config.timeout)
            };
            
            if (options.body) {
                fetchOptions.body = options.body;
            }
            
            const response = await fetch(fetchUrl, fetchOptions);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const html = await response.text();
            
            if (html && html.length > 0) {
                const responseData = {
                    html: html,
                    url: url,
                    statusCode: response.status,
                    headers: Object.fromEntries(response.headers.entries())
                };

                if (canUseCache && isCacheableResponse(responseData)) {
                    await this.writeCachedPage(url, responseData, pageCacheConfig);
                }

                return responseData;
            } else {
                console.error(`🌐 Web: ✗ Empty response from ${url}`);
                throw new Error(`Empty response from ${url}`);
            }
            
        } catch (error) {
            if (error?.cachedFailure) {
                throw error;
            }
            const errorMessage = `🌐 Web: ✗ HTTP request failed for ${url}: ${error.message}`;
            console.log(errorMessage);
            throw new Error(`HTTP request failed for ${url}: ${error.message}`);
        }
    }

    extractHttpStatusCodeFromError(error) {
        const message = error && typeof error.message === 'string' ? error.message : '';
        const match = message.match(/HTTP\s+(\d{3})/i);
        if (!match) {
            return null;
        }
        const statusCode = Number(match[1]);
        return Number.isFinite(statusCode) ? statusCode : null;
    }


    async fetchImageAsBase64(url, timeoutSeconds = 30) {
        if (this.isNode) {
            try {
                const response = await fetch(url, { signal: AbortSignal.timeout(timeoutSeconds * 1000) });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const buffer = await response.arrayBuffer();
                return Buffer.from(buffer).toString('base64');
            } catch (error) {
                throw new Error(`Failed to fetch image as base64: ${error.message}`);
            }
        } else {
            try {
                const response = await fetch(url, { signal: AbortSignal.timeout(timeoutSeconds * 1000) });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const buffer = await response.arrayBuffer();
                let binary = '';
                const bytes = new Uint8Array(buffer);
                for (let i = 0; i < bytes.length; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                return btoa(binary);
            } catch (error) {
                throw new Error(`Failed to fetch image as base64: ${error.message}`);
            }
        }
    }

    // Mirror of ScriptableAdapter.throwIfRetryableHttpStatus so the two POST
    // methods keep one contract on both platforms: transient statuses
    // (5xx/429 — SharedCore.isRetryableHttpStatus, the same list
    // isRetryableFailure classifies stamped statuses by) THROW with
    // `error.statusCode` stamped; client rejections (4xx) keep the
    // {ok: false} return shape callers already branch on. If SharedCore is
    // unavailable (browser page without the script tag) the pre-fix
    // {ok: false} return survives unchanged.
    throwIfRetryableHttpStatus(label, url, statusCode, responseText) {
        if (!Number.isFinite(statusCode)) return;
        if (statusCode >= 200 && statusCode < 300) return;
        const core = this.getSharedCoreRef();
        if (!core || typeof core.isRetryableHttpStatus !== 'function') return;
        if (!core.isRetryableHttpStatus(statusCode)) return;
        const error = new Error(`${label} failed: HTTP ${statusCode} from ${url}`);
        error.statusCode = statusCode;
        error.responseText = typeof responseText === 'string' ? responseText : '';
        throw error;
    }

    async postJson(url, payload, options = {}) {
        const timeout = options.timeoutSeconds ? options.timeoutSeconds * 1000 : this.config.timeout;
        let result;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(timeout)
            });
            result = {
                ok: response.ok,
                status: response.status,
                text: await response.text()
            };
        } catch (error) {
            throw new Error(`POST request failed: ${error.message}`);
        }
        this.throwIfRetryableHttpStatus('POST request', url, result.status, result.text);
        return result;
    }

    // Node-side mirror of ScriptableAdapter.postForm: form-encoded POST (the
    // shape WordPress admin-ajax endpoints expect) with the same optional
    // cacheUrl contract — a stable synthetic URL the response is remembered
    // as in the page cache (POSTs can never ride fetchData's GET-only cache).
    async postForm(url, body, options = {}) {
        const pageCacheConfig = this.getPageCacheConfig();
        const cacheUrl = typeof options.cacheUrl === 'string' && options.cacheUrl ? options.cacheUrl : null;
        const canUseCache = pageCacheConfig.enabled && cacheUrl !== null;
        if (canUseCache) {
            const cachedPage = await this.readCachedPage(cacheUrl, pageCacheConfig);
            if (cachedPage) {
                this.logPageCacheHit(cacheUrl, cachedPage, pageCacheConfig);
                return {
                    ok: true,
                    status: cachedPage.statusCode || 200,
                    text: cachedPage.html
                };
            }
        }
        const timeout = options.timeoutSeconds ? options.timeoutSeconds * 1000 : this.config.timeout;
        let result;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'User-Agent': this.config.userAgent,
                    ...options.headers
                },
                body: String(body == null ? '' : body),
                signal: AbortSignal.timeout(timeout)
            });
            result = {
                ok: response.ok,
                status: response.status,
                text: await response.text()
            };
        } catch (error) {
            throw new Error(`Form POST request failed: ${error.message}`);
        }
        // Same transient-status contract as postJson: 5xx/429 throw with the
        // status stamped, everything else keeps the {ok:false} shape.
        this.throwIfRetryableHttpStatus('Form POST request', url, result.status, result.text);
        if (canUseCache && result.ok && typeof result.text === 'string' && result.text.length > 0) {
            await this.writeCachedPage(
                cacheUrl,
                { html: result.text, url: cacheUrl, statusCode: result.status, headers: {} },
                pageCacheConfig
            );
        }
        return result;
    }

async saveFailureNote(url, error, metadata = {}) {
        if (metadata && metadata.retryable === true) {
            return false;
        }
        if (!this.isNode || !this.fs || !this.path || !this.pageStorageDir) {
            return false;
        }

        const { hostDir, fileName, normalizedUrl } = this.getPageCachePathParts(url);
        const cacheDir = this.path.join(this.pageStorageDir, hostDir);
        const cachePath = this.path.join(cacheDir, fileName);
        const statusCode = Number.isFinite(metadata.statusCode)
            ? metadata.statusCode
            : this.extractHttpStatusCodeFromError(error);
        const payload = {
            url: normalizedUrl,
            fetchedAt: new Date().toISOString(),
            statusCode: Number.isFinite(statusCode) ? statusCode : null,
            headers: {},
            fetchState: 'failed',
            failure: {
                nonRetryable: true,
                context: metadata.context || 'crawl',
                error: error && error.message ? error.message : 'Unknown error'
            }
        };

        await this.fs.promises.mkdir(cacheDir, { recursive: true });
        await this.writeFileAtomicallyNode(cachePath, JSON.stringify(payload, null, 2));
        console.log(`🌐 Web: 📝 Saved non-retryable failure cache entry to ${cachePath}`);
        return true;
    }

    // Configuration Loading
    async loadConfiguration() {
        try {
            let config;
            let cities;
            
            // Check if we're in Node.js environment
            if (typeof window === 'undefined' && typeof require !== 'undefined') {
                // Node.js environment - use require to load JS module
                const configPath = require('path').join(__dirname, '..', 'scraper-input.js');
                delete require.cache[require.resolve(configPath)]; // Clear cache for fresh load
                config = require(configPath);
                
                const citiesPath = require('path').join(__dirname, '..', 'scraper-cities.js');
                delete require.cache[require.resolve(citiesPath)]; // Clear cache for fresh load
                cities = require(citiesPath);

                const barsPath = require('path').join(__dirname, '..', 'scraper-bars.js');
                if (require('fs').existsSync(barsPath)) {
                    delete require.cache[require.resolve(barsPath)]; // Clear cache for fresh load
                    config.bars = require(barsPath);
                } else {
                    config.bars = {};
                }

                const promotersPath = require('path').join(__dirname, '..', 'scraper-promoters.js');
                if (require('fs').existsSync(promotersPath)) {
                    delete require.cache[require.resolve(promotersPath)]; // Clear cache for fresh load
                    config.promoters = require(promotersPath);
                } else {
                    config.promoters = [];
                }
            } else {
                // Browser environment - use pre-loaded globals if available (loaded via script tags),
                // otherwise fall back to fetching (only works when page is served from scripts/ directory)
                if (typeof window.scraperConfig !== 'undefined') {
                    config = window.scraperConfig;
                } else {
                    const response = await fetch('./scraper-input.js');
                    
                    if (!response.ok) {
                        throw new Error(`Configuration file not found: ${response.status} ${response.statusText}`);
                    }
                    
                    const configText = await response.text();
                    
                    if (!configText || configText.trim().length === 0) {
                        throw new Error('Configuration file is empty');
                    }
                    
                    // Execute the JS file to get the configuration
                    eval(configText);
                    config = window.scraperConfig;
                }
                
                if (typeof window.scraperCities !== 'undefined') {
                    cities = window.scraperCities;
                } else {
                    const citiesResponse = await fetch('./scraper-cities.js');
                    
                    if (!citiesResponse.ok) {
                        throw new Error(`City configuration file not found: ${citiesResponse.status} ${citiesResponse.statusText}`);
                    }
                    
                    const citiesText = await citiesResponse.text();
                    
                    if (!citiesText || citiesText.trim().length === 0) {
                        throw new Error('City configuration file is empty');
                    }
                    
                    eval(citiesText);
                    cities = window.scraperCities;
                }

                if (typeof window.scraperBars !== 'undefined') {
                    config.bars = window.scraperBars;
                } else {
                    try {
                        const barsResponse = await fetch('./scraper-bars.js');
                        if (barsResponse.ok) {
                            const barsText = await barsResponse.text();
                            if (barsText && barsText.trim().length > 0) {
                                eval(barsText);
                                config.bars = window.scraperBars || {};
                            } else {
                                config.bars = {};
                            }
                        } else {
                            config.bars = {};
                        }
                    } catch (e) {
                        config.bars = {};
                    }
                }

                if (typeof window.scraperPromoters !== 'undefined') {
                    config.promoters = window.scraperPromoters;
                } else {
                    try {
                        const promotersResponse = await fetch('./scraper-promoters.js');
                        if (promotersResponse.ok) {
                            const promotersText = await promotersResponse.text();
                            if (promotersText && promotersText.trim().length > 0) {
                                eval(promotersText);
                                config.promoters = window.scraperPromoters || [];
                            } else {
                                config.promoters = [];
                            }
                        } else {
                            config.promoters = [];
                        }
                    } catch (e) {
                        config.promoters = [];
                    }
                }
            }
            
            // Validate configuration structure
            if (!config.parsers || !Array.isArray(config.parsers)) {
                throw new Error('Configuration missing parsers array');
            }
            
            if (!cities || typeof cities !== 'object') {
                throw new Error('Configuration missing cities data');
            }
            
            config.cities = cities;
            
            return config;
            
        } catch (error) {
            console.log(`🌐 Web: ✗ Failed to load configuration: ${error.message}`);
            throw new Error(`Configuration loading failed: ${error.message}`);
        }
    }

    // Calendar Integration (Web version - display only, no actual calendar writes)
    async addToCalendar(events, parserConfig) {
        if (!events || events.length === 0) {

            return 0;
        }

        try {
            // In web environment, we can't actually write to calendar
            // Instead, we could generate .ics files or display the events
            this.displayCalendarEvents(events, parserConfig);
            
            // Return the count as if we added them (for consistency with Scriptable)
            return events.length;
            
        } catch (error) {
            console.log(`🌐 Web: ✗ Calendar display error: ${error.message}`);
            throw new Error(`Calendar display failed: ${error.message}`);
        }
    }

    displayCalendarEvents(events, parserConfig) {
        console.log(`🌐 Web: Calendar Events for ${parserConfig.name}:`);
        
        // Show summary for large batches, details for small batches
        if (events.length > 5) {
            console.log(`📅 Summary: ${events.length} events found`);
            const venues = [...new Set(events.map(e => e.venue).filter(Boolean))];
            if (venues.length > 0) {
                console.log(`📍 Venues: ${venues.slice(0, 3).join(', ')}${venues.length > 3 ? ` + ${venues.length - 3} more` : ''}`);
            }
            const dateRange = events.length > 1 ? 
                `${events[0].startDate} to ${events[events.length - 1].startDate}` : 
                events[0].startDate;
            console.log(`📅 Date range: ${dateRange}`);
            console.log('   ---');
        } else {
            events.forEach((event, index) => {
                console.log(`📅 Event ${index + 1}:`);
                console.log(`   Title: ${event.title}`);
                console.log(`   Date: ${event.startDate}`);
                console.log(`   Venue: ${event.venue || 'N/A'}`);
                console.log(`   URL: ${event.website || event.url || 'N/A'}`);
                // Additive line: report-only sanity flags stamped by
                // SharedCore.getEventSanityFlags (absent → nothing printed).
                if (Array.isArray(event._sanityFlags) && event._sanityFlags.length > 0) {
                    console.log(`   ⚠️ Sanity: ${event._sanityFlags.map(flag => flag.code).join(', ')}`);
                }
                console.log('   ---');
            });
        }
    }

    // Generate downloadable .ics file for calendar import
    generateICSFile(events, filename = 'bear-events.ics') {
        const icsContent = this.eventsToICS(events);
        const blob = new Blob([icsContent], { type: 'text/calendar' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    eventsToICS(events) {
        const lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Chunky Dad//Bear Event Scraper//EN'
        ];
        
        events.forEach(event => {
            const startDate = new Date(event.startDate).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            const endDate = event.endDate ? 
                new Date(event.endDate).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z' :
                startDate;
            
            lines.push(
                'BEGIN:VEVENT',
                `DTSTART:${startDate}`,
                `DTEND:${endDate}`,
                `SUMMARY:${event.title}`,
                `DESCRIPTION:${event.description || ''}`,
                `LOCATION:${event.venue || ''}`,
                (event.website || event.url) ? `URL:${event.website || event.url}` : '',
                `UID:${event.title}-${startDate}@chunkydad.com`,
                'END:VEVENT'
            );
        });
        
        lines.push('END:VCALENDAR');
        return lines.filter(line => line).join('\r\n');
    }

    // SharedCore class reference: browser runs load it as a script-tag global;
    // Node runs require it lazily (never at module load, so browser bundling
    // of this file stays require-free on the hot path).
    getSharedCoreRef() {
        if (typeof SharedCore !== 'undefined') return SharedCore;
        if (this.isNode && typeof require !== 'undefined') {
            try {
                return require('../shared-core').SharedCore;
            } catch (error) {
                console.log(`🖥️ WebAdapter: SharedCore unavailable: ${error.message}`);
                return null;
            }
        }
        return null;
    }

    // Fetch + parse the published calendar ICS for one city
    // (https://chunky.dad/data/calendars/<cityKey>.ics, refreshed ~2-hourly).
    // Mirrors ScriptableAdapter.getPublishedRecurringUids' fetch/cache shape:
    // per-run memo + the Node page cache with a short TTL (0.25 days). Returns
    // { records, fetchedAt } or null on any failure (callers degrade to NEW,
    // with one warn per city per run).
    async getPublishedCalendarEvents(cityKey) {
        const key = String(cityKey || '').trim();
        if (!key) return null;
        if (!this._publishedCalendarByCity) this._publishedCalendarByCity = {};
        if (Object.prototype.hasOwnProperty.call(this._publishedCalendarByCity, key)) {
            return this._publishedCalendarByCity[key];
        }
        if (!this._publishedCalendarSnapshots) this._publishedCalendarSnapshots = {};
        let entry = null;
        try {
            const core = this.getSharedCoreRef();
            const url = `https://chunky.dad/data/calendars/${encodeURIComponent(key)}.ics`;
            const icsCacheConfig = {
                enabled: this.getPageCacheConfig().enabled,
                ttlDays: 0.25
            };
            let body = null;
            let fetchedAt = null;
            const cached = await this.readCachedPage(url, icsCacheConfig);
            if (cached && typeof cached.html === 'string') {
                body = cached.html;
                fetchedAt = cached.fetchedAt ||
                    (Number.isFinite(cached.modifiedAtMs) ? new Date(cached.modifiedAtMs).toISOString() : null);
            } else {
                const responseData = await this.fetchData(url, {
                    headers: { Accept: 'text/calendar' },
                    isCacheableResponse: () => false
                });
                if (responseData && typeof responseData.html === 'string') {
                    body = responseData.html;
                    fetchedAt = new Date().toISOString();
                    await this.writeCachedPage(url, responseData, icsCacheConfig);
                }
            }
            const records = (body && core) ? core.parsePublishedCalendarIcs(body) : null;
            if (Array.isArray(records)) {
                entry = { records, fetchedAt };
            }
        } catch (error) {
            entry = null;
        }
        if (entry) {
            this._publishedCalendarSnapshots[key] = { status: 'ok', fetchedAt: entry.fetchedAt };
        } else {
            console.warn(`🖥️ WebAdapter: published calendar unavailable for ${key} — merge analysis degraded to NEW`);
            this._publishedCalendarSnapshots[key] = { status: 'unavailable', fetchedAt: null };
        }
        this._publishedCalendarByCity[key] = entry;
        return entry;
    }

    // Get existing events for a specific event (called by shared-core for
    // analysis). Node/Mac runs have no EventKit, so the published per-city
    // calendar ICS is the existing-events source: fetch + parse the event's
    // city file, expand recurring series into the same search window the
    // Scriptable adapter uses, and return plain event objects in the shape
    // the merge machinery consumes. Read-only by design — this adapter never
    // gains executeCalendarActions, so no write path exists.
    async getExistingEvents(event) {
        try {
            const city = event.city || 'default';

            const coerceDate = (value) => {
                if (!value) return null;
                if (value instanceof Date) {
                    return isNaN(value.getTime()) ? null : value;
                }
                const parsed = new Date(value);
                return isNaN(parsed.getTime()) ? null : parsed;
            };

            const identifierRaw = event && (event.identifier || event.id)
                ? String(event.identifier || event.id).trim()
                : '';
            const hasIdentifier = Boolean(identifierRaw);

            const startDate = coerceDate(event.startDate);
            const endDate = coerceDate(event.endDate || event.startDate);
            const searchStartDate = coerceDate(event.searchStartDate);
            const searchEndDate = coerceDate(event.searchEndDate);
            const dateCandidates = hasIdentifier
                ? [searchStartDate, searchEndDate].filter(Boolean)
                : [startDate, endDate].filter(Boolean);

            if (dateCandidates.length === 0) {
                return [];
            }

            // Same window math as ScriptableAdapter.getExistingEvents: one
            // day-aligned window around the event dates (expanded only when
            // the parser configures calendarSearchRangeDays) for scraper
            // events; per-date windows of ±rangeDays for identifier edits.
            const configuredRangeDays = Number(event._parserConfig?.calendarSearchRangeDays || 0);
            const rangeDays = Number.isFinite(configuredRangeDays) && configuredRangeDays > 0
                ? configuredRangeDays
                : 2;
            const buildWindow = (date, days) => {
                const start = new Date(date);
                start.setHours(0, 0, 0, 0);
                start.setDate(start.getDate() - days);
                const end = new Date(date);
                end.setHours(23, 59, 59, 999);
                end.setDate(end.getDate() + days);
                return { start, end };
            };

            const windows = [];
            if (!hasIdentifier) {
                const earliestTime = Math.min(...dateCandidates.map((date) => date.getTime()));
                const latestTime = Math.max(...dateCandidates.map((date) => date.getTime()));
                const searchStart = new Date(earliestTime);
                searchStart.setHours(0, 0, 0, 0);
                const searchEnd = new Date(latestTime);
                searchEnd.setHours(23, 59, 59, 999);
                if (Number.isFinite(configuredRangeDays) && configuredRangeDays > 0) {
                    searchStart.setDate(searchStart.getDate() - configuredRangeDays);
                    searchEnd.setDate(searchEnd.getDate() + configuredRangeDays);
                }
                windows.push({ start: searchStart, end: searchEnd });
            } else {
                const windowKeys = new Set();
                dateCandidates.forEach((date) => {
                    const windowKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
                    if (windowKeys.has(windowKey)) return;
                    windowKeys.add(windowKey);
                    windows.push(buildWindow(date, rangeDays));
                });
            }
            if (windows.length === 0) {
                return [];
            }

            const published = await this.getPublishedCalendarEvents(city);
            if (!published) {
                return [];
            }

            const core = this.getSharedCoreRef();
            if (!core) {
                return [];
            }

            const overallStart = new Date(Math.min(...windows.map((w) => w.start.getTime())));
            const overallEnd = new Date(Math.max(...windows.map((w) => w.end.getTime())));
            const expansion = core.expandPublishedCalendarEventsInWindow(
                published.records, overallStart, overallEnd
            );

            // Unsupported RRULE shapes degrade to non-recurring; log once per uid.
            if (!this._unsupportedRruleLoggedUids) this._unsupportedRruleLoggedUids = new Set();
            for (const unsupported of expansion.unsupportedRrules) {
                if (this._unsupportedRruleLoggedUids.has(unsupported.uid)) continue;
                this._unsupportedRruleLoggedUids.add(unsupported.uid);
                console.log(`🖥️ WebAdapter: unsupported RRULE for uid ${unsupported.uid} — treated as non-recurring`);
            }

            const inAnyWindow = (existingEvent) => windows.some((w) => {
                const eventStart = existingEvent.startDate;
                const eventEnd = existingEvent.endDate || existingEvent.startDate;
                return eventStart.getTime() <= w.end.getTime() && eventEnd.getTime() >= w.start.getTime();
            });
            const matched = expansion.events.filter(inAnyWindow);
            console.log(
                `🖥️ WebAdapter: Existing event search city=${city} window=${overallStart.toISOString()} → ${overallEnd.toISOString()} found=${matched.length} (published VEVENTs=${published.records.length})`
            );
            return matched;
        } catch (error) {
            console.log(`🖥️ WebAdapter: ✗ Failed to get existing events: ${error.message}`);
            return [];
        }
    }

    // Node-side mirror of ScriptableAdapter.getWideWindowCalendarEvents (the
    // saved-series lookup's candidate source): expand the published city
    // calendar over the same now-anchored -35d..+70d window the identifier
    // probe uses. Expanded series occurrences carry `recurrence`, which the
    // lookup reads as the candidate's series evidence. Fails open to null.
    async getWideWindowCalendarEvents(event) {
        try {
            const city = (event && event.city) || 'default';
            const published = await this.getPublishedCalendarEvents(city);
            const core = this.getSharedCoreRef();
            if (!published || !core) return null;
            const now = new Date();
            const windowStart = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
            const windowEnd = new Date(now.getTime() + 70 * 24 * 60 * 60 * 1000);
            const expansion = core.expandPublishedCalendarEventsInWindow(
                published.records, windowStart, windowEnd
            );
            return { calendarName: city, events: expansion.events };
        } catch (error) {
            return null;
        }
    }

    // Node-side mirror of ScriptableAdapter.getPublishedCalendarRecords: the
    // parsed VEVENT records already fetched for getExistingEvents. Null on
    // any failure (callers fail open).
    async getPublishedCalendarRecords(cityKey) {
        try {
            const published = await this.getPublishedCalendarEvents(cityKey || '');
            return published && Array.isArray(published.records) ? published.records : null;
        } catch (error) {
            return null;
        }
    }

    // Display/Logging Adapter Implementation
    async logInfo(message) {
        console.log(`%cℹ️ ${message}`, 'color: #2196F3');
    }

    async logSuccess(message) {
        console.log(`%c✅ ${message}`, 'color: #4CAF50');
    }

    async logWarn(message) {
        console.warn(`%c⚠️ ${message}`, 'color: #FF9800');
    }

    async logError(message) {
        console.error(`%c❌ ${message}`, 'color: #F44336');
    }

    // Results Display - Enhanced with detailed analysis
    async displayResults(results) {
        try {
            // Store results for use in other methods
            this.lastResults = results;
            results.runContext = results.runContext || this.getRunContext();
            // Published-calendar snapshot info (which city ICS files fed the
            // merge analysis, and how fresh each fetch was) rides along in the
            // results so the Mac server header can surface staleness.
            if (this._publishedCalendarSnapshots && Object.keys(this._publishedCalendarSnapshots).length > 0) {
                results.publishedCalendarSnapshots = { ...this._publishedCalendarSnapshots };
            }
            console.log(`Run Type: ${results.runContext.type} (${results.runContext.trigger})`);
            
            // Show enhanced display features in console for debugging
            await this.displayEventAnalysis(results);
            await this.displayParserBreakdown(results);
            
            // Show console summary
            console.log('\n' + '='.repeat(60));
            console.log('%c🐻 BEAR EVENT SCRAPER RESULTS', 'font-size: 16px; font-weight: bold; color: #FF6B35');
            console.log('='.repeat(60));
            
            console.log(`📊 Total Events Found: ${results.totalEvents} (all events from all sources)`);
            console.log(`🐻 Raw Bear Events: ${results.rawBearEvents || 'N/A'} (after bear filtering)`);
            if (results.duplicatesRemoved > 0) {
                console.log(`🔄 Duplicates Removed: ${results.duplicatesRemoved}`);
                console.log(`🐻 Final Bear Events: ${results.bearEvents} (${results.rawBearEvents} - ${results.duplicatesRemoved} dupes)`);
            } else {
                console.log(`🐻 Final Bear Events: ${results.bearEvents} (no duplicates found)`);
            }
            console.log(`📅 Calendar Events: ${results.calendarEvents}${results.calendarEvents === 0 ? ' (dry run/preview mode - no events written)' : ''}`);
            
            // Explain the math breakdown
            if (results.totalEvents > results.bearEvents) {
                const pastEvents = results.totalEvents - (results.rawBearEvents || results.bearEvents);
                if (pastEvents > 0) {
                    console.log(`💡 Math Breakdown: ${results.totalEvents} total → ${pastEvents} past events filtered out → ${results.rawBearEvents || results.bearEvents} future bear events${results.duplicatesRemoved > 0 ? ` → ${results.duplicatesRemoved} duplicates removed → ${results.bearEvents} final` : ''}`);
                }
            }
            
            // Show event actions summary if available
            const allEvents = this.getAllEventsFromResults(results);
            if (allEvents && allEvents.length > 0) {
                const actionsCount = {
                    new: 0, add: 0, merge: 0, conflict: 0, enriched: 0
                };
                
                let hasActions = false;
                allEvents.forEach(event => {
                    if (event._action) {
                        hasActions = true;
                        const action = event._action.toLowerCase();
                        if (actionsCount.hasOwnProperty(action)) {
                            actionsCount[action]++;
                        }
                    }
                });
                
                if (hasActions) {
                    console.log('\n🎯 Event Actions:');
                    Object.entries(actionsCount).forEach(([action, count]) => {
                        if (count > 0) {
                            const actionIcon = {
                                'new': '➕', 'add': '➕', 'merge': '🔄',
                                'conflict': '⚠️', 'enriched': '✨'
                            }[action] || '❓';
                            console.log(`   ${actionIcon} ${action.toUpperCase()}: ${count}`);
                        }
                    });
                }
            }
            
            if (results.errors.length > 0) {
                console.log(`❌ Errors: ${results.errors.length}`);
                results.errors.forEach(error => console.log(`   • ${error}`));
            }
            
            console.log('\n📋 Parser Results:');
            results.parserResults.forEach(result => {
                console.log(`   • ${result.name}: ${result.bearEvents} bear events`);
            });

            // Node-side mirror of the Scriptable results-UI hygiene section:
            // report-only checklist, additive lines only, absent when empty.
            if (Array.isArray(results.calendarHygiene) && results.calendarHygiene.length > 0) {
                console.log(`\n🧹 Calendar hygiene: ${results.calendarHygiene.length} event(s) look superseded by saved series (report-only — deletion stays manual):`);
                results.calendarHygiene.forEach(finding => {
                    if (!finding) return;
                    const series = finding.series || {};
                    const label = finding.kind === 'off-pattern' ? 'off-pattern vs' : 'covered by';
                    const caution = finding.caution ? ` [CAUTION: ${finding.cautionReason}]` : '';
                    console.log(`   • "${finding.title}" ${finding.day || ''} [${finding.calendarName}] — ${label} series "${series.title || ''}" (${series.rrule || '?'}; ${series.instances || 0} instance(s)) — ${finding.reason || ''}${caution}`);
                });
            }

            if (results.discoveredVenueSummary) {
                console.log('\n' + results.discoveredVenueSummary);
            }

            if (results.foreignOrgCrawlSummary) {
                console.log('\n' + results.foreignOrgCrawlSummary);
            }

            // New venue candidates: read-only display on web. Queueing lives
            // in the Scriptable adapter only, and that queue is gathering-only
            // evidence — it never affects scraping behavior.
            if (Array.isArray(results.newVenueCandidates) && results.newVenueCandidates.length > 0) {
                console.log(`\n🆕 New venue candidates (${results.newVenueCandidates.length}) — read-only here (queueing is Scriptable-only):`);
                results.newVenueCandidates.forEach(candidate => {
                    const signals = Array.isArray(candidate.signals) ? candidate.signals.join(', ') : '';
                    const addressSuffix = candidate.address ? ` — ${candidate.address}` : '';
                    console.log(`   • "${candidate.name}" (${candidate.city}) — signals: ${signals}${addressSuffix}`);
                    // Computed evidence lines (SharedCore.buildNewVenueCandidates
                    // attaches candidate.evidence); absent → nothing printed.
                    if (Array.isArray(candidate.evidence)) {
                        candidate.evidence.forEach(line => console.log(`     evidence: ${line}`));
                    }
                });
            }

            // Show summary and recommended actions
            await this.displaySummaryAndActions(results);
            
            console.log('\n' + '='.repeat(60));
            
            // Create results display in DOM if possible
            this.createResultsDisplay(results);
            
            // Offer to download .ics file if events found
            if (results.bearEvents > 0) {
                const allEvents = results.parserResults.flatMap(r => r.events || []);
                console.log('🌐 Web: Events available for .ics download');
                
                // You could automatically trigger download or show a button
                // this.generateICSFile(allEvents);
            }
            
        } catch (error) {
            console.log(`🌐 Web: Error displaying results: ${error.message}`);
        }
    }

    createResultsDisplay(results) {
        try {
            // Skip DOM manipulation in Node.js environment
            if (typeof document === 'undefined') {
                console.log('🟢 Node.js: Skipping DOM results display (not available in Node.js)');
                return;
            }
            
            // Create or update results display in DOM
            let resultsDiv = document.getElementById('scraper-results');
            if (!resultsDiv) {
                resultsDiv = document.createElement('div');
                resultsDiv.id = 'scraper-results';
                resultsDiv.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: #fff;
                    border: 2px solid #FF6B35;
                    border-radius: 8px;
                    padding: 16px;
                    max-width: 300px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    z-index: 9999;
                    font-family: monospace;
                    font-size: 12px;
                `;
                document.body.appendChild(resultsDiv);
            }
            
            const deduplicationInfo = results.duplicatesRemoved > 0 ? 
                `<div style="font-size: 12px; color: #666;"><strong>Raw Bear Events:</strong> ${results.rawBearEvents} | <strong>Duplicates removed:</strong> ${results.duplicatesRemoved}</div>` : 
                `<div style="font-size: 12px; color: #666;"><strong>Raw Bear Events:</strong> ${results.rawBearEvents || 'N/A'}</div>`;
            resultsDiv.innerHTML = `
                <h3 style="margin: 0 0 12px 0; color: #FF6B35;">🐻 Bear Events Found</h3>
                <div><strong>Total Events Found:</strong> ${results.totalEvents} (all sources)</div>
                ${deduplicationInfo}
                <div><strong>Final Bear Events:</strong> ${results.bearEvents}${results.duplicatesRemoved > 0 ? ` (${results.rawBearEvents} - ${results.duplicatesRemoved} dupes)` : ''}</div>
                <div><strong>Calendar Events:</strong> ${results.calendarEvents}</div>
                ${results.errors.length > 0 ? `<div style="color: #F44336;"><strong>Errors:</strong> ${results.errors.length}</div>` : ''}
                <div style="margin-top: 12px; font-size: 10px;">
                    ${results.parserResults.map(r => `• ${r.name}: ${r.bearEvents} events`).join('<br>')}
                </div>
                <button onclick="this.parentElement.remove()" style="
                    position: absolute;
                    top: 4px;
                    right: 8px;
                    background: none;
                    border: none;
                    font-size: 16px;
                    cursor: pointer;
                ">×</button>
            `;
            
        } catch (error) {
            console.log(`🌐 Web: Error creating results display: ${error.message}`);
        }
    }

    // Error handling with browser alerts
    async showError(title, message) {
        try {
            // Skip alert in Node.js environment
            if (typeof alert !== 'undefined') {
                alert(`${title}\n\n${message}`);
            } else {
                console.log(`🟢 Node.js: ${title} - ${message}`);
            }
            
            // Could also create a custom modal here
            console.error(`🌐 Web: ${title} - ${message}`);
        } catch (error) {
            console.log(`Failed to show error alert: ${error.message}`);
        }
    }

    // Enhanced Display Methods
    async displayEventAnalysis(results) {
        console.log('\n' + '='.repeat(60));
        console.log('📊 EVENT ANALYSIS & BREAKDOWN');
        console.log('='.repeat(60));
        
        const allEvents = this.getAllEventsFromResults(results);
        if (!allEvents || !allEvents.length) {
            console.log('❌ No event data available for analysis');
            return;
        }

        // Analyze events by city
        const cityBreakdown = {};
        const venueBreakdown = {};
        const dateBreakdown = {};
        
        allEvents.forEach(event => {
            // City analysis
            const city = event.city || 'unknown';
            cityBreakdown[city] = (cityBreakdown[city] || 0) + 1;
            
            // Venue analysis
            const venue = event.venue || 'unknown';
            venueBreakdown[venue] = (venueBreakdown[venue] || 0) + 1;
            
            // Date analysis (by month)
            if (event.startDate) {
                const date = new Date(event.startDate);
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                dateBreakdown[monthKey] = (dateBreakdown[monthKey] || 0) + 1;
            }
        });
        
        console.log('🏙️ Events by City:');
        Object.entries(cityBreakdown)
            .sort(([,a], [,b]) => b - a)
            .forEach(([city, count]) => {
                console.log(`   • ${city}: ${count} events`);
            });
        
        console.log('\n📍 Top Venues:');
        Object.entries(venueBreakdown)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)
            .forEach(([venue, count]) => {
                console.log(`   • ${venue}: ${count} events`);
            });
        
        console.log('\n📅 Events by Month:');
        Object.entries(dateBreakdown)
            .sort(([a], [b]) => a.localeCompare(b))
            .forEach(([month, count]) => {
                console.log(`   • ${month}: ${count} events`);
            });
    }

    async displayParserBreakdown(results) {
        console.log('\n' + '='.repeat(60));
        console.log('🔧 PARSER PERFORMANCE BREAKDOWN');
        console.log('='.repeat(60));
        
        if (!results.parserResults || !results.parserResults.length) {
            console.log('❌ No parser results available');
            return;
        }
        
        results.parserResults.forEach((result, index) => {
            console.log(`\n📋 Parser ${index + 1}: ${result.name}`);
            console.log(`   • Total Events: ${result.totalEvents || 0}`);
            console.log(`   • Bear Events: ${result.bearEvents || 0}`);
            console.log(`   • Success Rate: ${result.totalEvents > 0 ? Math.round((result.bearEvents / result.totalEvents) * 100) : 0}%`);
            
            if (result.errors && result.errors.length > 0) {
                console.log(`   • Errors: ${result.errors.length}`);
                result.errors.forEach(error => {
                    console.log(`     - ${error}`);
                });
            }
        });
    }

    async displaySummaryAndActions(results) {
        console.log('\n' + '='.repeat(60));
        console.log('📋 SUMMARY & RECOMMENDED ACTIONS');
        console.log('='.repeat(60));
        
        const allEvents = this.getAllEventsFromResults(results);
        
        if (results.bearEvents === 0) {
            console.log('⚠️ No bear events found. Consider:');
            console.log('   • Checking bear keyword filters');
            console.log('   • Verifying event sources are active');
            console.log('   • Expanding date range');
            console.log('   • Reviewing parser configurations');
        } else if (results.calendarEvents === 0) {
            console.log('🔒 Dry run mode - events found but not written to calendar');
            console.log('   • Set dryRun: false to enable calendar writes');
            console.log('   • Review event details before enabling writes');
        } else {
            console.log('✅ Events successfully processed');
            console.log(`   • ${results.bearEvents} bear events found`);
            console.log(`   • ${results.calendarEvents} events written to calendar`);
        }
        
        if (results.errors.length > 0) {
            console.log('\n⚠️ Issues to address:');
            results.errors.forEach(error => {
                console.log(`   • ${error}`);
            });
        }
        
        // Show next steps
        console.log('\n🎯 Next Steps:');
        if (results.bearEvents > 0) {
            console.log('   • Review events in calendar app');
            console.log('   • Share .ics file with others');
            console.log('   • Set up automated runs');
        } else {
            console.log('   • Check parser configurations');
            console.log('   • Verify event sources');
            console.log('   • Review bear detection keywords');
        }
    }

    // Helper method to extract all events from parser results
    getAllEventsFromResults(results) {
        // Events must be analyzed to have action types - no fallback to raw parser results
        if (!results || !results.analyzedEvents || !Array.isArray(results.analyzedEvents)) {
            throw new Error('No analyzed events available - event analysis must succeed for the system to function');
        }
        
        return results.analyzedEvents;
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WebAdapter };
} else if (typeof window !== 'undefined') {
    window.WebAdapter = WebAdapter;
} else {
    // Scriptable environment
    this.WebAdapter = WebAdapter;
}

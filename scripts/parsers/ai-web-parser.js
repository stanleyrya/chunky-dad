// ============================================================================
// AI WEB PARSER
// ============================================================================
// Handles AI extraction + event normalization for pages that don't parse well
// with deterministic selectors.
// ============================================================================

const ImportedEventSchema = (() => {
    try {
        if (typeof importModule === 'function') {
            const schemaModule = importModule('event-schema');
            if (schemaModule && schemaModule.EventSchema) {
                return schemaModule.EventSchema;
            }
        }
    } catch (_) {}
    try {
        if (typeof require === 'function') {
            const schemaModule = require('../event-schema');
            if (schemaModule && schemaModule.EventSchema) {
                return schemaModule.EventSchema;
            }
        }
    } catch (_) {}
    return null;
})();

class AiWebParser {
    constructor(config = {}) {
        this.config = {
            source: 'ai-web',
            maxAdditionalUrls: 15,
            ...config
        };
        this.cachedEventSchemaPromptFields = [];
        this.cachedEventSchemaPromptFieldDescriptions = new Map();
        this.eventSchemaPromptFieldsLoaded = false;
        this.extractionLimits = {
            yearWindowPastDays: 45,
            yearWindowFutureDays: 210,
            // Small iteration limit for timezone offset convergence around DST boundaries.
            timezoneConvergenceIterations: 4,
            millisPerDay: 24 * 60 * 60 * 1000,
            maxMetaParts: 30,
            maxJsonLdParts: 8,
            maxLinkParts: 40,
            maxBodyParts: 300,
            jsonLdFullnessMinSignals: 4,
            metaFullnessMinSignals: 4,
            noisyLinePrefixes: [
                'share',
                'follow',
                'menu',
                'navigation',
                'recommended',
                'related',
                'you may also like',
                'sign up',
                'subscribe',
                'read more',
                'get tickets',
                'buy tickets'
            ]
        };
        const noisePrefixPattern = this.extractionLimits.noisyLinePrefixes
            .map(prefix => this.escapeRegex(prefix).replace(/\s+/g, '\\s+'))
            .join('|');
        this.noiseLineRegex = new RegExp(`^(${noisePrefixPattern})\\b`, 'i');
        this.excludedMetaKeyRegexes = [
            /^apple-mobile-web-app-title$/i,
            /^keywords$/i,
            /^og:(site_name|locale|determiner)$/i,
            /^twitter:site$/i,
            /^twitter:app:/i,
            /^twitter:(label\d+|data\d+)$/i
        ];
        this.jsonLdDropKeyPattern = /^(speakable|breadcrumb|itemListElement|potentialAction)$/i;
        this.proxyImagePathPrefixes = ['/e/_next/image?', '/_next/image?'];
        this.jsonLdCandidatePoolSizeMultiplier = 2;
        this.relativeUrlParsingBase = 'https://placeholder.example';
        this.maxUrlUnwrapDepth = 3;
        this.maxRejectedSamplesPerReason = 3;
        this.maxRejectedSampleLength = 120;
        this.structuredUrlKeys = [
            'url',
            'event_url',
            'eventUrl',
            'public_url',
            'vanity_url',
            'canonical_url',
            'href',
            'link'
        ];
    }

    async parseEvents(htmlData, parserConfig = {}, cityConfig = null) {
        try {
            const html = htmlData && htmlData.html ? htmlData.html : '';
            const sourceUrl = htmlData && htmlData.url ? htmlData.url : '';

            if (parserConfig.urlDiscoveryDepth > 0) {
                const additionalLinks = this.extractAdditionalUrls(html, sourceUrl, parserConfig);
                console.log(`🤖 AI Web: Discovery mode found ${additionalLinks.length} additional links`);
                return {
                    events: [],
                    additionalLinks: additionalLinks,
                    source: this.config.source,
                    url: sourceUrl
                };
            }

            const promptFields = this.getAiPromptFields(parserConfig);
            const aiEvent = await this.getAiEvent(htmlData, parserConfig, cityConfig, promptFields);
            if (!aiEvent) {
                return this.buildEmptyResult(htmlData);
            }

            const event = this.normalizeAiEvent(aiEvent, parserConfig, htmlData, cityConfig, promptFields);
            if (!event || !event.title || !event.startDate) {
                console.warn('🤖 AI Web: AI output missing required title/startDate after normalization');
                return this.buildEmptyResult(htmlData);
            }

            return {
                events: [event],
                additionalLinks: [],
                source: this.config.source,
                url: htmlData && htmlData.url ? htmlData.url : ''
            };
        } catch (error) {
            console.warn(`🤖 AI Web: Failed to parse AI event: ${error}`);
            return this.buildEmptyResult(htmlData);
        }
    }

    extractAdditionalUrls(html, sourceUrl, parserConfig) {
        const urls = new Map();
        const discoveryStats = {
            hrefCandidates: 0,
            configuredPatternMatches: 0,
            rawHtmlCandidates: 0,
            jsonLdCandidates: 0,
            nextDataCandidates: 0,
            serverDataCandidates: 0,
            jsonLdDiagnostics: {},
            serverDataDiagnostics: {},
            nextDataDiagnostics: {},
            rejectedCandidates: 0,
            rejectedReasons: {},
            rejectedSamples: {}
        };

        try {
            const hrefCandidates = this.extractHrefCandidates(html);
            discoveryStats.hrefCandidates = hrefCandidates.length;
            for (const candidate of hrefCandidates) {
                this.addAdditionalUrlCandidate(urls, candidate.url, sourceUrl, candidate.context, discoveryStats);
            }

            const configuredPatterns = parserConfig.urlPatterns;
            const patterns = Array.isArray(configuredPatterns) && configuredPatterns.length > 0
                ? configuredPatterns
                : [];

            for (const pattern of patterns) {
                const regex = new RegExp(pattern.regex, 'gi');
                let match;
                let matchCount = 0;
                const maxMatches = Number.isFinite(Number(pattern.maxMatches))
                    ? Number(pattern.maxMatches)
                    : 250;

                while ((match = regex.exec(html)) !== null && matchCount < maxMatches) {
                    const matchedUrl = match[1] || match[0];
                    if (this.addAdditionalUrlCandidate(urls, matchedUrl, sourceUrl, match[0], discoveryStats)) {
                        matchCount++;
                    }
                }
                discoveryStats.configuredPatternMatches += matchCount;
            }

            const rawUrlCandidates = this.extractUrlCandidatesFromRawHtml(html);
            discoveryStats.rawHtmlCandidates = rawUrlCandidates.length;
            for (const candidate of rawUrlCandidates) {
                this.addAdditionalUrlCandidate(urls, candidate.url || candidate, sourceUrl, candidate.context || '', discoveryStats);
            }

            const jsonLdDiagnostics = {};
            const jsonLdUrlCandidates = this.extractUrlsFromJsonLd(html, jsonLdDiagnostics);
            discoveryStats.jsonLdCandidates = jsonLdUrlCandidates.length;
            discoveryStats.jsonLdDiagnostics = jsonLdDiagnostics;
            for (const candidate of jsonLdUrlCandidates) {
                this.addAdditionalUrlCandidate(urls, candidate, sourceUrl, 'json-ld', discoveryStats);
            }

            // Extract from common JS-embedded data objects (window.__SERVER_DATA__, __INITIAL_STATE__, etc.)
            const serverDataDiagnostics = {};
            const serverDataUrls = this.extractUrlsFromServerData(html, sourceUrl, serverDataDiagnostics);
            discoveryStats.serverDataCandidates = serverDataUrls.length;
            discoveryStats.serverDataDiagnostics = serverDataDiagnostics;
            for (const candidate of serverDataUrls) {
                this.addAdditionalUrlCandidate(urls, candidate, sourceUrl, '__server-data__', discoveryStats);
            }

            // Extract from __NEXT_DATA__ (Next.js pages)
            const nextDataDiagnostics = {};
            const nextDataUrls = this.extractUrlsFromNextData(html, sourceUrl, nextDataDiagnostics);
            discoveryStats.nextDataCandidates = nextDataUrls.length;
            discoveryStats.nextDataDiagnostics = nextDataDiagnostics;
            for (const candidate of nextDataUrls) {
                this.addAdditionalUrlCandidate(urls, candidate, sourceUrl, '__next-data__', discoveryStats);
            }
        } catch (error) {
            console.warn(`🤖 AI Web: Error extracting additional URLs: ${error}`);
        }

        const rankedUrls = this.rankAdditionalUrls(urls, sourceUrl);
        const maxAdditionalUrls = this.resolveMaxAdditionalUrls(parserConfig);
        const hasFiniteLimit = Number.isFinite(maxAdditionalUrls) && maxAdditionalUrls >= 0;
        const limitedUrls = hasFiniteLimit
            ? rankedUrls.slice(0, maxAdditionalUrls)
            : rankedUrls;
        const limitText = hasFiniteLimit ? `${maxAdditionalUrls}` : 'none';
        const rejectedTopReasons = this.formatTopRejectedReasons(discoveryStats.rejectedReasons);
        const extraSources = discoveryStats.serverDataCandidates > 0 || discoveryStats.nextDataCandidates > 0
            ? `, serverDataCandidates=${discoveryStats.serverDataCandidates}, nextDataCandidates=${discoveryStats.nextDataCandidates}`
            : '';
        console.log(
            `🤖 AI Web: URL discovery stats for ${sourceUrl || 'unknown URL'} -> hrefCandidates=${discoveryStats.hrefCandidates}, configuredPatternMatches=${discoveryStats.configuredPatternMatches}, rawHtmlCandidates=${discoveryStats.rawHtmlCandidates}, jsonLdCandidates=${discoveryStats.jsonLdCandidates}${extraSources}, rejected=${discoveryStats.rejectedCandidates}, rejectedTopReasons=${rejectedTopReasons}, uniqueValid=${rankedUrls.length}, limit=${limitText}, returned=${limitedUrls.length}`
        );
        if (discoveryStats.rejectedCandidates > 0) {
            const rejectedPreview = this.formatRejectedSamples(discoveryStats.rejectedSamples);
            if (rejectedPreview) {
                console.log(`🤖 AI Web: URL discovery rejected samples: ${rejectedPreview}`);
            }
        }
        if (limitedUrls.length > 0) {
            const previewLinks = limitedUrls
                .slice(0, 5)
                .map(url => this.trimToMaxLength(url, 120))
                .join(', ');
            console.log(`🤖 AI Web: URL discovery top links: ${previewLinks}`);
        }
        const structuredDiag = this.formatStructuredDiscoveryDiagnostics(discoveryStats);
        if (structuredDiag) {
            console.log(`🤖 AI Web: URL discovery structured diagnostics: ${structuredDiag}`);
        }

        return limitedUrls;
    }

    getDefaultMaxAdditionalUrls() {
        const defaultLimit = Number(this.config.maxAdditionalUrls);
        if (Number.isFinite(defaultLimit) && defaultLimit >= 0) {
            return defaultLimit;
        }
        return Infinity;
    }

    resolveMaxAdditionalUrls(parserConfig = {}) {
        const hasConfiguredLimit = Object.prototype.hasOwnProperty.call(parserConfig, 'maxAdditionalUrls');
        if (hasConfiguredLimit && parserConfig.maxAdditionalUrls === null) {
            return Infinity;
        }

        const configuredValue = hasConfiguredLimit ? parserConfig.maxAdditionalUrls : undefined;
        if (typeof configuredValue === 'string' && configuredValue.trim().length === 0) {
            return this.getDefaultMaxAdditionalUrls();
        }
        if (configuredValue !== undefined && configuredValue !== null) {
            const parsedConfigured = Number(configuredValue);
            if (Number.isFinite(parsedConfigured) && parsedConfigured >= 0) {
                return parsedConfigured;
            }
        }

        return this.getDefaultMaxAdditionalUrls();
    }

    extractHrefCandidates(html) {
        if (!html) return [];
        const candidates = [];
        const anchorRegex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = anchorRegex.exec(html)) !== null) {
            candidates.push({
                url: match[1],
                context: `${match[0]} ${this.stripTags(match[2] || '')}`
            });
        }

        const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
        while ((match = hrefRegex.exec(html)) !== null) {
            candidates.push({ url: match[1], context: match[0] });
        }
        return candidates;
    }

    addAdditionalUrlCandidate(urls, rawUrl, sourceUrl, context = '', discoveryStats = null) {
        const url = this.normalizeUrl(rawUrl, sourceUrl);
        const validation = this.validateEventUrl(url, sourceUrl);
        if (!validation.valid) {
            if (discoveryStats && typeof discoveryStats === 'object') {
                this.recordRejectedCandidate(discoveryStats, validation.reason, rawUrl, url);
            }
            return false;
        }

        const key = this.getUrlDedupeKey(url);
        const score = this.scoreAdditionalUrl(url, sourceUrl, context);
        const existing = urls.get(key);
        if (!existing) {
            urls.set(key, { url, score, index: urls.size });
            return true;
        }
        if (score > existing.score) {
            existing.url = url;
            existing.score = score;
        }
        return false;
    }

    rankAdditionalUrls(urls, sourceUrl) {
        return Array.from(urls.values())
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return a.index - b.index;
            })
            .map(item => item.url);
    }

    getUrlDedupeKey(url) {
        try {
            const parsed = new URL(url);
            parsed.hash = '';
            return parsed.toString().replace(/\/$/, '').toLowerCase();
        } catch (_) {
            return String(url || '').replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();
        }
    }

    parseUrlComponents(url) {
        if (!url || typeof url !== 'string') return null;
        try {
            if (typeof URL === 'function') {
                const parsed = new URL(url);
                return {
                    protocol: String(parsed.protocol || '').toLowerCase(),
                    hostname: String(parsed.hostname || '').toLowerCase(),
                    pathname: parsed.pathname || '/',
                    search: parsed.search || '',
                    hash: parsed.hash || '',
                    href: parsed.toString()
                };
            }
        } catch (_) {}

        const match = String(url).match(/^(https?:)\/\/([^\/?#]+)([^?#]*)?(\?[^#]*)?(#.*)?$/i);
        if (!match) return null;
        const [, protocol = '', host = '', pathname = '', search = '', hash = ''] = match;
        return {
            protocol: String(protocol || '').toLowerCase(),
            hostname: String(host || '').toLowerCase().split(':')[0],
            pathname: pathname || '/',
            search: search || '',
            hash: hash || '',
            href: `${protocol}//${host}${pathname || ''}${search || ''}${hash || ''}`
        };
    }

    scoreAdditionalUrl(url, sourceUrl, context = '') {
        let score = 0;
        const parsedUrl = this.parseUrlComponents(url);
        const parsedSource = sourceUrl ? this.parseUrlComponents(sourceUrl) : null;
        const path = String(parsedUrl?.pathname || '').toLowerCase();
        const search = String(parsedUrl?.search || '').toLowerCase();
        const contextText = this.normalizeWhitespace(this.stripTags(context)).toLowerCase();
        const haystack = `${path} ${search}`;

        if (parsedSource && parsedUrl && parsedUrl.hostname === parsedSource.hostname) score += 10;
        if (parsedUrl && /(eventbrite|ticketleap|redeyetickets|tickets?|dice|ra|residentadvisor)\./i.test(parsedUrl.hostname)) score += 15;
        if (/\/e\/[^/?#]+/i.test(path)) score += 95;
        if (/\/events?\/[^/?#]+/i.test(path)) score += 85;
        if (/\/(?:party|parties|show|shows|ticket|tickets|calendar)\/[^/?#]+/i.test(path)) score += 60;
        if (/(event|ticket|party|show|festival|concert|dance|night|rsvp|register)/i.test(haystack)) score += 40;
        if (/(event|ticket|party|show|festival|concert|dance|night|rsvp|register|details|learn more)/i.test(contextText)) score += 30;
        if (/\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2})\b/.test(haystack)) score += 25;
        if (/[?&](?:event|event_id|eventid|eid|id|ticket|ticket_id)=/i.test(search)) score += 20;
        if (/^\/(?:events?|calendar|tickets?|shows?)\/?$/i.test(path) && !search) score -= 45;
        if (/\/(?:about|contact|privacy|terms|login|signin|signup|search|tag|category|blog)(?:\/|$)/i.test(path)) score -= 35;
        return score;
    }

    isValidEventUrl(url, sourceUrl) {
        return this.validateEventUrl(url, sourceUrl).valid;
    }

    validateEventUrl(url, sourceUrl) {
        if (!url || typeof url !== 'string') return { valid: false, reason: 'missing-or-invalid-url' };

        const parsedUrl = this.parseUrlComponents(url);
        if (!parsedUrl) return { valid: false, reason: 'invalid-url' };
        if (!/^https?:$/.test(parsedUrl.protocol)) return { valid: false, reason: 'invalid-protocol' };
        if (sourceUrl && this.getUrlDedupeKey(url) === this.getUrlDedupeKey(this.normalizeUrl(sourceUrl, sourceUrl))) {
            return { valid: false, reason: 'same-as-source' };
        }
        const lowerPath = (parsedUrl.pathname || '').toLowerCase();
        if (parsedUrl.hash && (!parsedUrl.search || parsedUrl.search.length === 0) && (lowerPath === '' || lowerPath === '/')) {
            return { valid: false, reason: 'fragment-only-root-url' };
        }
        const staticAssetExtensions = [
            '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.tif', '.tiff',
            '.css', '.js', '.mjs', '.map', '.json', '.xml', '.txt', '.pdf', '.zip', '.gz', '.tgz',
            '.mp3', '.m4a', '.wav', '.mp4', '.webm', '.mov', '.avi', '.woff', '.woff2', '.ttf'
        ];
        if (staticAssetExtensions.some(ext => lowerPath.endsWith(ext))) return { valid: false, reason: 'static-asset-extension' };
        const staticAssetPathHints = ['/touch_icons/', '/images/', '/image/', '/img/', '/assets/', '/static/'];
        if (staticAssetPathHints.some(segment => lowerPath.includes(segment))) return { valid: false, reason: 'static-asset-path' };

        const invalidUrlPatterns = [
            '/admin', '/login', '/wp-admin', '/wp-login', '/user/', '/profile/',
            'javascript:', 'mailto:', 'tel:', 'sms:',
            'facebook.com', 'twitter.com', 'instagram.com', 'youtube.com'
        ];

        const lowerUrl = url.toLowerCase();
        const blockedPattern = invalidUrlPatterns.find(invalid => lowerUrl.includes(invalid));
        if (blockedPattern) return { valid: false, reason: `blocked-pattern:${blockedPattern}` };
        return { valid: true, reason: 'valid' };
    }

    recordRejectedCandidate(discoveryStats, reason, rawUrl, normalizedUrl = null) {
        discoveryStats.rejectedCandidates += 1;
        const rejectionReason = reason || 'unknown';
        discoveryStats.rejectedReasons[rejectionReason] = (discoveryStats.rejectedReasons[rejectionReason] || 0) + 1;

        if (!(rejectionReason in discoveryStats.rejectedSamples)) {
            discoveryStats.rejectedSamples[rejectionReason] = [];
        }
        const samples = discoveryStats.rejectedSamples[rejectionReason];
        if (samples.length < this.maxRejectedSamplesPerReason) {
            const rawStr = String(rawUrl || '');
            const normalizedStr = normalizedUrl && normalizedUrl !== rawStr ? String(normalizedUrl) : null;
            const sampleRaw = this.trimToMaxLength(rawStr, this.maxRejectedSampleLength);
            const sample = normalizedStr
                ? `${sampleRaw} → ${this.trimToMaxLength(normalizedStr, this.maxRejectedSampleLength)}`
                : sampleRaw;
            if (sample && !samples.includes(sample)) {
                samples.push(sample);
            }
        }
    }

    formatTopRejectedReasons(rejectedReasons = {}) {
        const entries = Object.entries(rejectedReasons);
        if (entries.length === 0) return 'none';
        return entries
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([reason, count]) => `${reason}:${count}`)
            .join(', ');
    }

    formatRejectedSamples(rejectedSamples = {}) {
        const entries = Object.entries(rejectedSamples);
        if (entries.length === 0) return '';
        return entries
            .sort((a, b) => b[1].length - a[1].length)
            .slice(0, 3)
            .map(([reason, samples]) => `${reason}=[${(samples || []).join(' | ')}]`)
            .join('; ');
    }

    normalizeUrl(url, baseUrl) {
        if (!url) return null;

        url = this.decodeBasicEntities(this.decodeUrlEscapes(url)).replace(/&amp;/g, '&');
        url = url.replace(/[),.;]+$/, '');
        url = url.trim();

        if (/^(#|javascript:|mailto:|tel:|sms:)/i.test(url)) {
            return null;
        }

        if (url.startsWith('//')) {
            const urlPattern = /^(https?:)/;
            const match = String(baseUrl || '').match(urlPattern);
            if (match) {
                const [, protocol] = match;
                return `${protocol}${url}`;
            }
        }

        try {
            if (baseUrl) {
                return new URL(url, baseUrl).toString();
            }
            return new URL(url).toString();
        } catch (_) {}

        if (url.startsWith('/')) {
            const urlPattern = /^(https?:)\/\/([^\/]+)/;
            const match = String(baseUrl || '').match(urlPattern);
            if (match) {
                const [, protocol, host] = match;
                return `${protocol}//${host}${url}`;
            }
        }

        return url;
    }

    decodeUrlEscapes(url) {
        return String(url || '')
            .replace(/\\u002f/gi, '/')
            .replace(/\\u0026/gi, '&')
            .replace(/\\u003a/gi, ':')
            .replace(/\\\//g, '/')
            .replace(/^['"]+|['"]+$/g, '')
            .trim();
    }

    extractUrlCandidatesFromRawHtml(html) {
        if (!html) return [];
        const candidates = new Set();
        const patterns = [
            /https?:\/\/[^\s"'<>\\]+/gi,
            /https?:\\\/\\\/[^\s"'<>]+/gi,
            /https?:\\u002f\\u002f[^\s"'<>]+/gi,
            /["'](?:url|href|link|eventUrl|event_url|ticketUrl|ticket_url|publicUrl|public_url)["']\s*:\s*["']([^"']+)["']/gi,
            /\b(?:url|href|link|eventUrl|event_url|ticketUrl|ticket_url)\s*=\s*["']([^"']+)["']/gi
        ];

        for (const pattern of patterns) {
            for (const match of html.matchAll(pattern)) {
                const candidate = match[1] || match[0];
                if (candidate) candidates.add(candidate);
            }
        }

        return Array.from(candidates);
    }

    extractUrlsFromJsonLd(html, diagnostics = null) {
        if (!html) return [];
        const urls = [];
        const regex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let match;
        const localDiagnostics = diagnostics && typeof diagnostics === 'object'
            ? diagnostics
            : null;
        if (localDiagnostics) {
            localDiagnostics.scriptsFound = 0;
            localDiagnostics.scriptsParsed = 0;
            localDiagnostics.parseErrors = 0;
            localDiagnostics.scriptSamples = [];
        }
        while ((match = regex.exec(html)) !== null) {
            const content = (match[1] || '').trim();
            if (!content) continue;
            if (localDiagnostics) {
                localDiagnostics.scriptsFound += 1;
                if (localDiagnostics.scriptSamples.length < 2) {
                    localDiagnostics.scriptSamples.push(this.trimToMaxLength(content, 240));
                }
            }
            try {
                const parsed = JSON.parse(content);
                if (localDiagnostics) localDiagnostics.scriptsParsed += 1;
                this.collectUrlsFromObject(parsed, urls);
            } catch (_) {
                if (localDiagnostics) localDiagnostics.parseErrors += 1;
            }
        }
        if (localDiagnostics) {
            localDiagnostics.urlSamples = urls.slice(0, 5).map(url => this.trimToMaxLength(url, 140));
        }
        return urls;
    }

    collectUrlsFromObject(obj, urls) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
            obj.forEach(item => this.collectUrlsFromObject(item, urls));
            return;
        }
        if (typeof obj.url === 'string' && obj.url) urls.push(obj.url);
        Object.values(obj).forEach(value => {
            if (value && typeof value === 'object') this.collectUrlsFromObject(value, urls);
        });
    }

    extractUrlsFromServerData(html, sourceUrl, diagnostics = null) {
        if (!html) return [];
        const urls = [];
        const localDiagnostics = diagnostics && typeof diagnostics === 'object'
            ? diagnostics
            : null;
        if (localDiagnostics) {
            localDiagnostics.containersFound = [];
            localDiagnostics.containersParsed = [];
            localDiagnostics.parseErrors = [];
            localDiagnostics.regexFallbackCandidates = 0;
            localDiagnostics.urlSamples = [];
        }
        const patterns = [
            { name: '__SERVER_DATA__', regex: /window\.__SERVER_DATA__\s*=\s*/ },
            { name: '__INITIAL_STATE__', regex: /window\.__INITIAL_STATE__\s*=\s*/ },
            { name: '__PRELOADED_STATE__', regex: /window\.__PRELOADED_STATE__\s*=\s*/ },
            { name: '__APP_INITIAL_STATE__', regex: /window\.__APP_INITIAL_STATE__\s*=\s*/ },
            { name: '__APP_STATE__', regex: /window\.__APP_STATE__\s*=\s*/ },
            { name: '__REDUX_STATE__', regex: /window\.__REDUX_STATE__\s*=\s*/ },
            { name: '__STATE__', regex: /window\.__STATE__\s*=\s*/ },
        ];
        for (const patternEntry of patterns) {
            const startPattern = patternEntry.regex;
            const startMatch = html.match(startPattern);
            if (!startMatch) continue;
            const varName = patternEntry.name || 'unknown';
            if (localDiagnostics) localDiagnostics.containersFound.push(varName);
            try {
                const startIndex = startMatch.index + startMatch[0].length;
                const jsonString = this.extractJsonObject(html, startIndex);
                if (!jsonString) continue;
                const data = JSON.parse(jsonString);
                this.collectEventUrlsFromDataObject(data, sourceUrl, urls, new Set(), 0);
                const fallbackUrls = this.extractLikelyEventUrlsFromSerializedJson(jsonString, sourceUrl);
                fallbackUrls.forEach(url => urls.push(url));
                if (localDiagnostics) {
                    localDiagnostics.containersParsed.push(varName);
                    localDiagnostics.regexFallbackCandidates += fallbackUrls.length;
                }
            } catch (error) {
                console.warn(`🤖 AI Web: Error extracting URLs from window.${varName}: ${error}`);
                if (localDiagnostics) {
                    localDiagnostics.parseErrors.push(`${varName}:${this.trimToMaxLength(String(error), 120)}`);
                }
            }
        }
        if (localDiagnostics) {
            localDiagnostics.urlSamples = urls.slice(0, 5).map(url => this.trimToMaxLength(url, 140));
        }
        return urls;
    }

    extractUrlsFromNextData(html, sourceUrl, diagnostics = null) {
        if (!html) return [];
        const urls = [];
        const localDiagnostics = diagnostics && typeof diagnostics === 'object'
            ? diagnostics
            : null;
        if (localDiagnostics) {
            localDiagnostics.found = false;
            localDiagnostics.parsed = false;
            localDiagnostics.parseError = '';
            localDiagnostics.regexFallbackCandidates = 0;
            localDiagnostics.scriptSample = '';
            localDiagnostics.urlSamples = [];
        }
        try {
            const scriptMatch = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
            if (!scriptMatch) return [];
            if (localDiagnostics) {
                localDiagnostics.found = true;
                localDiagnostics.scriptSample = this.trimToMaxLength((scriptMatch[1] || '').trim(), 240);
            }
            const nextDataRaw = (scriptMatch[1] || '').trim();
            const nextData = JSON.parse(nextDataRaw);
            if (localDiagnostics) localDiagnostics.parsed = true;
            this.collectEventUrlsFromDataObject(nextData, sourceUrl, urls, new Set(), 0);
            const fallbackUrls = this.extractLikelyEventUrlsFromSerializedJson(nextDataRaw, sourceUrl);
            fallbackUrls.forEach(url => urls.push(url));
            if (localDiagnostics) localDiagnostics.regexFallbackCandidates = fallbackUrls.length;
        } catch (error) {
            console.warn(`🤖 AI Web: Error extracting URLs from __NEXT_DATA__: ${error}`);
            if (localDiagnostics) localDiagnostics.parseError = this.trimToMaxLength(String(error), 120);
        }
        if (localDiagnostics) {
            localDiagnostics.urlSamples = urls.slice(0, 5).map(url => this.trimToMaxLength(url, 140));
        }
        return urls;
    }

    collectEventUrlsFromDataObject(node, sourceUrl, urls, visited, depth) {
        if (!node || typeof node !== 'object' || depth > 30) return;
        if (visited.has(node)) return;
        visited.add(node);

        if (Array.isArray(node)) {
            for (const item of node) {
                this.collectEventUrlsFromDataObject(item, sourceUrl, urls, visited, depth + 1);
            }
            return;
        }

        const rawUrl = node.url || node.event_url || node.vanity_url || node.public_url ||
            node.eventUrl || node.eventURL || node.event_link || node.eventLink ||
            node.href || node.link || node.canonical_url || node.canonicalUrl || '';
        // Include both eventUrl and eventURL because upstream payloads are inconsistent.
        const hasName = !!(node.name || node.title || node.event_name);
        const hasDate = !!(node.start || node.starts_at || node.start_date || node.startDate ||
            node.start_time || node.date || node.datetime || node.start_utc || node.start_local ||
            node.startDateTime || node.start_datetime || node.event_date || node.eventDate);
        const looksLikeEventUrl = this.isLikelyEventPath(rawUrl, sourceUrl);
        if (rawUrl && typeof rawUrl === 'string' && (looksLikeEventUrl || (hasName && hasDate))) {
            const resolved = this.normalizeUrl(String(rawUrl), sourceUrl);
            if (resolved) urls.push(resolved);
        }

        for (const key of Object.keys(node)) {
            const value = node[key];
            if (value && typeof value === 'object') {
                this.collectEventUrlsFromDataObject(value, sourceUrl, urls, visited, depth + 1);
            }
        }
    }

    isLikelyEventPath(rawUrl, sourceUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') return false;
        const normalized = this.normalizeUrl(rawUrl, sourceUrl);
        if (!normalized) return false;
        const parsed = this.parseUrlComponents(normalized);
        if (!parsed) return false;
        const path = String(parsed.pathname || '').toLowerCase();
        return /^\/e\/[^/?#]+/.test(path) || /\/(?:events?|part(?:y|ies)|shows?|tickets?)\/[^/?#]+/.test(path);
    }

    extractLikelyEventUrlsFromSerializedJson(rawJson, sourceUrl) {
        if (!rawJson) return [];
        const urls = new Set();
        const keyPattern = this.structuredUrlKeys
            .map(key => this.escapeRegex(key))
            .join('|');
        const patterns = [
            new RegExp(`"(?:${keyPattern})"\\s*:\\s*"([^"]+)"`, 'gi'),
            // Handles double-escaped JSON strings embedded in script payloads.
            new RegExp(`\\\\?"(?:${keyPattern})\\\\?"\\s*:\\s*\\\\?"([^"\\\\]+)\\\\?"`, 'gi')
        ];
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(rawJson)) !== null) {
                const candidate = this.normalizeUrl(match[1], sourceUrl);
                if (!candidate) continue;
                if (this.isLikelyEventPath(candidate, sourceUrl)) {
                    urls.add(candidate);
                }
            }
        }
        return Array.from(urls);
    }

    formatStructuredDiscoveryDiagnostics(discoveryStats = {}) {
        const parts = [];
        const jsonLd = discoveryStats.jsonLdDiagnostics || {};
        const serverData = discoveryStats.serverDataDiagnostics || {};
        const nextData = discoveryStats.nextDataDiagnostics || {};

        if (Object.keys(jsonLd).length > 0) {
            parts.push(`jsonLd{${this.formatDiagnosticsPairs({
                scriptsFound: jsonLd.scriptsFound || 0,
                parsed: jsonLd.scriptsParsed || 0,
                parseErrors: jsonLd.parseErrors || 0,
                candidates: discoveryStats.jsonLdCandidates || 0,
                samples: (jsonLd.urlSamples || []).join(' | ') || 'none',
                scriptSamples: (jsonLd.scriptSamples || []).join(' | ') || 'none'
            })}}`);
        }
        if (Object.keys(serverData).length > 0) {
            parts.push(`serverData{${this.formatDiagnosticsPairs({
                found: (serverData.containersFound || []).join(',') || 'none',
                parsed: (serverData.containersParsed || []).join(',') || 'none',
                parseErrors: (serverData.parseErrors || []).join(' | ') || 'none',
                regexFallbackCandidates: serverData.regexFallbackCandidates || 0,
                candidates: discoveryStats.serverDataCandidates || 0,
                samples: (serverData.urlSamples || []).join(' | ') || 'none'
            })}}`);
        }
        if (Object.keys(nextData).length > 0) {
            parts.push(`nextData{${this.formatDiagnosticsPairs({
                found: nextData.found ? 'yes' : 'no',
                parsed: nextData.parsed ? 'yes' : 'no',
                parseError: nextData.parseError || 'none',
                regexFallbackCandidates: nextData.regexFallbackCandidates || 0,
                candidates: discoveryStats.nextDataCandidates || 0,
                samples: (nextData.urlSamples || []).join(' | ') || 'none',
                scriptSample: nextData.scriptSample || 'none'
            })}}`);
        }
        return parts.join('; ');
    }

    formatDiagnosticsPairs(values = {}) {
        return Object.entries(values)
            .map(([key, value]) => `${key}=${value}`)
            .join(', ');
    }

    escapeRegex(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    extractJsonObject(html, startIndex) {
        let braceCount = 0;
        let inString = false;
        let i = html.indexOf('{', startIndex);
        if (i === -1) return null;
        braceCount = 1;
        i++;

        while (i < html.length && braceCount > 0) {
            const char = html[i];
            if (char === '"') {
                let backslashCount = 0;
                let j = i - 1;
                while (j >= 0 && html[j] === '\\') { backslashCount++; j--; }
                if (backslashCount % 2 === 0) inString = !inString;
            } else if (!inString) {
                if (char === '{') braceCount++;
                else if (char === '}') braceCount--;
            }
            i++;
        }

        if (braceCount !== 0) return null;
        const rawSubstring = html.substring(startIndex, i);
        const cleanedJson = this.escapeJsonControlCharacters(rawSubstring);
        return cleanedJson;
    }

    escapeJsonControlCharacters(jsonString) {
        let result = '';
        let inString = false;
        for (let i = 0; i < jsonString.length; i++) {
            const char = jsonString[i];
            const code = char.charCodeAt(0);
            if (char === '"') {
                let backslashCount = 0;
                let j = i - 1;
                while (j >= 0 && jsonString[j] === '\\') { backslashCount++; j--; }
                if (backslashCount % 2 === 0) inString = !inString;
            }
            if (inString && code < 32) {
                switch (code) {
                    case 8: result += '\\b'; break;
                    case 9: result += '\\t'; break;
                    case 10: result += '\\n'; break;
                    case 12: result += '\\f'; break;
                    case 13: result += '\\r'; break;
                    default: result += '\\u' + code.toString(16).padStart(4, '0'); break;
                }
            } else {
                result += char;
            }
        }
        return result;
    }

    buildEmptyResult(htmlData) {
        return {
            events: [],
            additionalLinks: [],
            source: this.config.source,
            url: htmlData && htmlData.url ? htmlData.url : ''
        };
    }

    async getAiEvent(htmlData, parserConfig, cityConfig, selectedPromptFields = null) {
        if (!htmlData || typeof htmlData !== 'object') return null;
        if (htmlData.aiEvent && typeof htmlData.aiEvent === 'object') return htmlData.aiEvent;
        if (htmlData.aiExtraction && typeof htmlData.aiExtraction.event === 'object') {
            return htmlData.aiExtraction.event;
        }
        const aiConfig = this.getAiConfig(parserConfig);
        if (!aiConfig.enabled || !htmlData.html) {
            return null;
        }
        const promptFields = Array.isArray(selectedPromptFields) && selectedPromptFields.length > 0
            ? selectedPromptFields
            : this.getAiPromptFields(parserConfig);
        if (promptFields.length === 0) {
            console.warn('🤖 AI Web: No eligible AI prompt fields configured - skipping extraction');
            return null;
        }
        console.log(`🤖 AI Web: Prompt fields selected (${promptFields.length}): ${promptFields.join(', ')}`);
        console.log(`🤖 AI Web: Running AI extraction for ${htmlData.url || 'unknown URL'} (${promptFields.length} field${promptFields.length === 1 ? '' : 's'})`);
        const sectionBundle = this.getPromptSectionBundle(htmlData.html, aiConfig);
        const previewSnippet = this.buildPromptSnippets(
            [],
            [sectionBundle.jsonLd, sectionBundle.metaFallback, sectionBundle.content].filter(Boolean),
            Math.max(500, Number(aiConfig.maxHtmlChars))
        )[0] || '';
        console.log(`🤖 AI Web: Page data sent to AI for ${htmlData.url || 'unknown URL'} (${previewSnippet.length} chars)\n${previewSnippet}`);
        return await this.extractEventWithAiStrategy(htmlData, aiConfig, cityConfig, parserConfig, promptFields);
    }

    getAiConfig(parserConfig = {}) {
        const aiConfig = parserConfig && typeof parserConfig.ai === 'object' ? parserConfig.ai : {};
        return {
            enabled: aiConfig.enabled !== false,
            endpoint: String(aiConfig.endpoint || 'http://desktop.taila7523c.ts.net:11434/api/generate'),
            model: String(aiConfig.model || 'qwen3.5:4b'),
            payloadMode: this.normalizePayloadMode(aiConfig.payloadMode),
            maxHtmlChars: Number.isFinite(Number(aiConfig.maxHtmlChars)) ? Number(aiConfig.maxHtmlChars) : 6000,
            numCtx: Number.isFinite(Number(aiConfig.numCtx)) ? Number(aiConfig.numCtx) : 8192,
            numPredict: Number.isFinite(Number(aiConfig.numPredict)) ? Number(aiConfig.numPredict) : 512,
            temperature: Number.isFinite(Number(aiConfig.temperature)) ? Number(aiConfig.temperature) : 0,
            think: Object.prototype.hasOwnProperty.call(aiConfig, 'think') ? Boolean(aiConfig.think) : false,
            timeoutSeconds: Number.isFinite(Number(aiConfig.timeoutSeconds)) ? Number(aiConfig.timeoutSeconds) : 120,
            keepAlive: Object.prototype.hasOwnProperty.call(aiConfig, 'keepAlive') ? String(aiConfig.keepAlive) : '5m'
        };
    }

    normalizePayloadMode(mode) {
        const normalized = String(mode || '').trim().toLowerCase();
        if (normalized === 'exhaustive' || normalized === 'jsonld' || normalized === 'meta') return normalized;
        return 'best';
    }

    createPromptSection(label, parts) {
        const values = Array.isArray(parts) ? parts : [parts];
        const lines = values
            .map(value => this.normalizeWhitespace(String(value || '')))
            .filter(Boolean);
        if (lines.length === 0) return null;
        return { label, lines };
    }

    sectionToText(section) {
        if (!section || !section.label || !Array.isArray(section.lines) || section.lines.length === 0) return '';
        return `${section.label}\n${section.lines.join('\n')}`;
    }

    getPromptSectionBundle(html, aiConfig = {}) {
        const source = String(html || '').slice(0, 500000);
        const title = this.extractTitlePart(source);
        const metaParts = this.extractMetaParts(source);
        const jsonLdParts = this.extractJsonLdParts(source);
        const bodyParts = this.extractBodyParts(source);
        return {
            title: this.createPromptSection('TITLE', title),
            jsonLd: this.createPromptSection('JSON_LD_PRIMARY', jsonLdParts),
            metaPrimary: this.createPromptSection('META_PRIMARY', metaParts),
            metaFallback: this.createPromptSection('META_FALLBACK', metaParts),
            content: this.createPromptSection('CONTENT', bodyParts),
            jsonLdScore: this.scoreJsonLdParts(jsonLdParts),
            metaScore: this.scoreMetaParts(metaParts),
            payloadMode: this.normalizePayloadMode(aiConfig.payloadMode)
        };
    }

    splitSectionForPrompt(section, maxChars, repeatedSections = []) {
        if (!section) return [];
        const repeatedText = repeatedSections
            .map(candidate => this.sectionToText(candidate))
            .filter(Boolean)
            .join('\n\n');
        const repeatedLength = repeatedText.length > 0 ? repeatedText.length + 2 : 0;
        const availableChars = Math.max(120, Number(maxChars) - repeatedLength);
        const fullText = this.sectionToText(section);
        if (fullText.length <= availableChars) return [section];
        const headerLength = String(section.label || '').length + 1;
        const lineBudget = Math.max(40, availableChars - headerLength);
        const chunks = [];
        let currentLines = [];
        for (const rawLine of section.lines) {
            const normalizedLine = String(rawLine || '').length > lineBudget
                ? this.trimToMaxLength(rawLine, lineBudget)
                : String(rawLine || '');
            const candidateLines = currentLines.concat(normalizedLine);
            const candidateText = `${section.label}\n${candidateLines.join('\n')}`;
            if (candidateText.length <= availableChars) {
                currentLines = candidateLines;
                continue;
            }
            if (currentLines.length > 0) {
                chunks.push({ label: section.label, lines: currentLines });
            }
            currentLines = [normalizedLine];
        }
        if (currentLines.length > 0) {
            chunks.push({ label: section.label, lines: currentLines });
        }
        return chunks;
    }

    buildPromptSnippets(repeatedSections, variableSections, maxChars) {
        const baseSections = Array.isArray(repeatedSections) ? repeatedSections.filter(Boolean) : [];
        const sections = Array.isArray(variableSections) ? variableSections.filter(Boolean) : [];
        const baseText = baseSections
            .map(section => this.sectionToText(section))
            .filter(Boolean)
            .join('\n\n');
        if (sections.length === 0) {
            return baseText ? [baseText.slice(0, maxChars)] : [];
        }
        const chunks = [];
        let currentSections = [];
        let currentText = baseText;
        const pushCurrent = () => {
            if (currentText) chunks.push(currentText);
            currentSections = [];
            currentText = baseText;
        };
        for (const section of sections) {
            const sectionChunks = this.splitSectionForPrompt(section, maxChars, baseSections);
            for (const sectionChunk of sectionChunks) {
                const sectionText = this.sectionToText(sectionChunk);
                const candidateText = currentText ? `${currentText}\n\n${sectionText}` : sectionText;
                if (candidateText.length <= maxChars) {
                    currentSections.push(sectionChunk);
                    currentText = candidateText;
                    continue;
                }
                if (currentSections.length > 0) {
                    pushCurrent();
                }
                currentSections = [sectionChunk];
                currentText = baseText ? `${baseText}\n\n${sectionText}` : sectionText;
                if (currentText.length > maxChars) {
                    currentText = currentText.slice(0, maxChars);
                }
            }
        }
        if (currentText) {
            chunks.push(currentText);
        }
        return chunks.filter(Boolean);
    }

    isUsableAiFieldValue(value, depth = 0) {
        if (depth > 4) return false;
        if (value === null || value === undefined) return false;
        if (typeof value === 'string') return value.trim().length > 0;
        if (Array.isArray(value)) return value.some(item => this.isUsableAiFieldValue(item, depth + 1));
        if (typeof value === 'object') {
            return Object.values(value).some(item => this.isUsableAiFieldValue(item, depth + 1));
        }
        return true;
    }

    hasResolvedFieldValue(aiEvent, normalizedFieldName) {
        if (!aiEvent || typeof aiEvent !== 'object') return false;
        return Object.keys(aiEvent).some(key => {
            if (this.normalizePromptFieldName(key) !== normalizedFieldName) return false;
            return this.isUsableAiFieldValue(aiEvent[key]);
        });
    }

    getRemainingPromptFields(fields, aiEvent) {
        const requestedFields = Array.isArray(fields) ? fields : [];
        return requestedFields.filter(field => !this.hasResolvedFieldValue(aiEvent, this.normalizePromptFieldName(field)));
    }

    mergeAiEventFields(currentEvent, nextEvent) {
        const merged = currentEvent && typeof currentEvent === 'object' ? { ...currentEvent } : {};
        if (!nextEvent || typeof nextEvent !== 'object') return merged;
        Object.keys(nextEvent).forEach(key => {
            const value = nextEvent[key];
            if (!this.isUsableAiFieldValue(value)) return;
            const normalizedName = this.normalizePromptFieldName(key);
            if (this.hasResolvedFieldValue(merged, normalizedName)) return;
            merged[key] = value;
        });
        return merged;
    }

    getBestModePromptGroups(sectionBundle) {
        const jsonGroup = sectionBundle && sectionBundle.jsonLd
            ? { label: 'jsonld', sections: [sectionBundle.jsonLd] }
            : null;
        const metaGroup = sectionBundle && sectionBundle.metaPrimary
            ? { label: 'meta', sections: [sectionBundle.metaPrimary] }
            : null;
        const contentGroup = sectionBundle && sectionBundle.content
            ? { label: 'content', sections: [sectionBundle.content] }
            : null;
        const groups = [];
        if (jsonGroup && metaGroup) {
            if (sectionBundle.jsonLdScore >= sectionBundle.metaScore) {
                groups.push(jsonGroup, metaGroup);
            } else {
                groups.push(metaGroup, jsonGroup);
            }
        } else if (jsonGroup || metaGroup) {
            groups.push(jsonGroup || metaGroup);
        }
        if (contentGroup) groups.push(contentGroup);
        return groups.filter(Boolean);
    }

    async extractFieldsAcrossSnippets(htmlData, aiConfig, cityConfig, parserConfig, fields, snippets, passLabelPrefix) {
        let merged = {};
        const promptFields = Array.isArray(fields) ? fields : [];
        const promptSnippets = Array.isArray(snippets) ? snippets.filter(Boolean) : [];
        for (let index = 0; index < promptSnippets.length; index++) {
            const remainingFields = this.getRemainingPromptFields(promptFields, merged);
            if (remainingFields.length === 0) break;
            const partial = await this.extractEventWithTwoPassAi(
                htmlData,
                aiConfig,
                cityConfig,
                parserConfig,
                remainingFields,
                promptSnippets[index],
                `${passLabelPrefix} ${index + 1}/${promptSnippets.length}`.trim()
            );
            merged = this.mergeAiEventFields(merged, partial);
        }
        return merged;
    }

    async extractEventWithAiStrategy(htmlData, aiConfig, cityConfig, parserConfig, fields) {
        const promptFields = Array.isArray(fields) ? fields : [];
        const maxHtmlChars = Math.max(500, Number(aiConfig.maxHtmlChars));
        const sectionBundle = this.getPromptSectionBundle(htmlData && htmlData.html ? htmlData.html : '', aiConfig);
        const payloadMode = this.normalizePayloadMode(aiConfig.payloadMode);

        if (payloadMode === 'jsonld') {
            const snippets = this.buildPromptSnippets([], sectionBundle.jsonLd ? [sectionBundle.jsonLd] : [], maxHtmlChars);
            return await this.extractFieldsAcrossSnippets(htmlData, aiConfig, cityConfig, parserConfig, promptFields, snippets, 'jsonld');
        }
        if (payloadMode === 'meta') {
            const snippets = this.buildPromptSnippets([], sectionBundle.metaPrimary ? [sectionBundle.metaPrimary] : [], maxHtmlChars);
            return await this.extractFieldsAcrossSnippets(htmlData, aiConfig, cityConfig, parserConfig, promptFields, snippets, 'meta');
        }
        if (payloadMode === 'exhaustive') {
            let merged = {};
            const sharedSections = [sectionBundle.jsonLd, sectionBundle.metaFallback].filter(Boolean);
            const snippets = this.buildPromptSnippets(sharedSections, sectionBundle.content ? [sectionBundle.content] : [], maxHtmlChars);
            const fallbackSnippets = snippets.length > 0
                ? snippets
                : this.buildPromptSnippets([], [sectionBundle.jsonLd, sectionBundle.metaFallback, sectionBundle.content].filter(Boolean), maxHtmlChars);
            for (const field of promptFields) {
                const remainingField = this.getRemainingPromptFields([field], merged);
                if (remainingField.length === 0) continue;
                const partial = await this.extractFieldsAcrossSnippets(
                    htmlData,
                    aiConfig,
                    cityConfig,
                    parserConfig,
                    remainingField,
                    fallbackSnippets,
                    `exhaustive ${field}`
                );
                merged = this.mergeAiEventFields(merged, partial);
            }
            return merged;
        }

        let merged = {};
        const promptGroups = this.getBestModePromptGroups(sectionBundle);
        for (const group of promptGroups) {
            const remainingFields = this.getRemainingPromptFields(promptFields, merged);
            if (remainingFields.length === 0) break;
            const snippets = this.buildPromptSnippets([], group.sections, maxHtmlChars);
            const partial = await this.extractFieldsAcrossSnippets(
                htmlData,
                aiConfig,
                cityConfig,
                parserConfig,
                remainingFields,
                snippets,
                `best ${group.label}`
            );
            merged = this.mergeAiEventFields(merged, partial);
        }
        return merged;
    }

    cleanHtml(html, aiConfig = {}) {
        if (!html) return '';
        const payloadMode = this.normalizePayloadMode(aiConfig.payloadMode);
        const source = String(html).slice(0, 500000);
        const title = this.extractTitlePart(source);
        const metaParts = this.extractMetaParts(source);
        const jsonLdParts = this.extractJsonLdParts(source);
        const bodyParts = this.extractBodyParts(source);
        const sections = [];
        if (title) sections.push(`TITLE\n${title}`);
        if (payloadMode === 'jsonld') {
            if (jsonLdParts.length > 0) {
                sections.push(`JSON_LD_PRIMARY\n${jsonLdParts.join('\n')}`);
            }
        } else if (payloadMode === 'meta') {
            if (metaParts.length > 0) {
                sections.push(`META_PRIMARY\n${metaParts.join('\n')}`);
            }
        } else if (payloadMode === 'best') {
            const jsonLdLooksFull = jsonLdParts.length > 0 && this.isSnippetSourceFull(
                this.scoreJsonLdParts(jsonLdParts),
                this.extractionLimits.jsonLdFullnessMinSignals
            );
            const metaLooksFull = metaParts.length > 0 && this.isSnippetSourceFull(
                this.scoreMetaParts(metaParts),
                this.extractionLimits.metaFullnessMinSignals
            );
            if (jsonLdLooksFull && metaLooksFull) {
                sections.push(`JSON_LD_PRIMARY\n${jsonLdParts.join('\n')}`);
                sections.push(`META_FALLBACK\n${metaParts.join('\n')}`);
            } else {
                if (jsonLdParts.length > 0) sections.push(`JSON_LD_PRIMARY\n${jsonLdParts.join('\n')}`);
                if (metaParts.length > 0) sections.push(`META_FALLBACK\n${metaParts.join('\n')}`);
                if (bodyParts.length > 0) sections.push(`CONTENT\n${bodyParts.join('\n')}`);
            }
        } else {
            if (jsonLdParts.length > 0) sections.push(`JSON_LD_PRIMARY\n${jsonLdParts.join('\n')}`);
            if (metaParts.length > 0) sections.push(`META_FALLBACK\n${metaParts.join('\n')}`);
            if (bodyParts.length > 0) sections.push(`CONTENT\n${bodyParts.join('\n')}`);
        }
        return sections.join('\n\n').trim();
    }

    isSnippetSourceFull(score, minSignals) {
        return Number.isFinite(score) && score >= minSignals;
    }

    scoreJsonLdParts(parts) {
        if (!Array.isArray(parts) || parts.length === 0) return 0;
        const keyRegexes = [
            /"name"\s*:/i,
            /"description"\s*:/i,
            /"(startdate|enddate|doorstime|datetime|datepublished)"\s*:/i,
            /"location"\s*:/i,
            /"organizer"\s*:/i,
            /"(url|sameas)"\s*:/i,
            /"(offers|price|pricecurrency|lowprice|highprice)"\s*:/i
        ];
        const joined = parts.join('\n');
        return keyRegexes.reduce((score, regex) => score + (regex.test(joined) ? 1 : 0), 0);
    }

    scoreMetaParts(parts) {
        if (!Array.isArray(parts) || parts.length === 0) return 0;
        const keySet = new Set(parts.map(part => {
            const line = String(part || '').trim().toLowerCase();
            const separatorIndex = line.indexOf(': ');
            return separatorIndex >= 0 ? line.slice(0, separatorIndex).trim() : line;
        }).filter(Boolean));
        const hasAny = candidates => candidates.some(candidate => keySet.has(candidate));
        const hasPrefix = prefixes => Array.from(keySet).some(key => prefixes.some(prefix => key.startsWith(prefix)));
        let score = 0;
        if (hasAny(['title', 'description', 'keywords'])) score++;
        if (hasPrefix(['og:'])) score++;
        if (hasPrefix(['twitter:'])) score++;
        if (hasPrefix(['event:'])) score++;
        if (hasAny(['geo.position', 'geo.placename', 'apple-mobile-web-app-title'])) score++;
        if (hasAny(['location', 'venue', 'address'])) score++;
        return score;
    }

    getEventSchema() {
        const localEventSchema = typeof EventSchema !== 'undefined' ? EventSchema : null;
        const globalEventSchema = typeof globalThis !== 'undefined' ? (globalThis.EventSchema || null) : null;
        return localEventSchema || globalEventSchema || ImportedEventSchema || null;
    }

    normalizePromptFieldName(field) {
        const normalized = String(field || '').trim().toLowerCase();
        const schema = this.getEventSchema();
        if (!schema || typeof schema.canonicalizeEventKey !== 'function') {
            return normalized;
        }
        const canonical = schema.canonicalizeEventKey(normalized);
        return String(canonical || normalized).toLowerCase();
    }

    getEventSchemaPromptFields() {
        if (this.eventSchemaPromptFieldsLoaded) {
            return this.cachedEventSchemaPromptFields;
        }
        const schema = this.getEventSchema();
        if (!schema || !Array.isArray(schema.AI_PROMPT_FIELDS)) {
            this.cachedEventSchemaPromptFields = [];
            this.cachedEventSchemaPromptFieldDescriptions = new Map();
            this.eventSchemaPromptFieldsLoaded = true;
            console.warn('🤖 AI Web: EventSchema.AI_PROMPT_FIELDS unavailable - extraction fields will be empty');
            return this.cachedEventSchemaPromptFields;
        }
        this.cachedEventSchemaPromptFields = schema.AI_PROMPT_FIELDS
            .filter(field => field && typeof field.param === 'string' && typeof field.desc === 'string')
            .map(field => {
                const promptFieldName = String(field.param).trim();
                return {
                    promptFieldName,
                    normalizedName: this.normalizePromptFieldName(promptFieldName),
                    description: field.desc.trim()
                };
            });
        this.cachedEventSchemaPromptFieldDescriptions = new Map(
            this.cachedEventSchemaPromptFields.map(field => [field.normalizedName, field.description])
        );
        this.eventSchemaPromptFieldsLoaded = true;
        return this.cachedEventSchemaPromptFields;
    }

    getEventSchemaPromptFieldDescription(fieldName) {
        if (!this.eventSchemaPromptFieldsLoaded) {
            this.getEventSchemaPromptFields();
        }
        return this.cachedEventSchemaPromptFieldDescriptions.get(fieldName) || null;
    }

    getDefaultExtractionFields() {
        return this.getEventSchemaPromptFields().map(field => field.promptFieldName);
    }

    getAiPromptFields(parserConfig = {}) {
        const priorities = parserConfig && parserConfig.fieldPriorities && typeof parserConfig.fieldPriorities === 'object'
            ? parserConfig.fieldPriorities
            : {};
        const metadata = parserConfig && parserConfig.metadata && typeof parserConfig.metadata === 'object'
            ? parserConfig.metadata
            : {};
        const skippedFieldReasons = [];
        const selected = Object.keys(priorities).filter(field => {
            const rule = priorities[field];
            if (!rule || !Array.isArray(rule.priority)) {
                skippedFieldReasons.push({ field, reason: 'missing-priority-array' });
                return false;
            }
            if (!rule.priority.includes('ai-web')) {
                skippedFieldReasons.push({ field, reason: 'ai-web-not-in-priority', priority: rule.priority });
                return false;
            }
            if (Object.prototype.hasOwnProperty.call(metadata, field)) {
                skippedFieldReasons.push({ field, reason: 'metadata-overrides-field' });
                return false;
            }
            return true;
        });
        const aiPromptFields = selected;
        const manuallyScrapedFields = new Set(['instagram', 'facebook', 'gmaps']);
        const filteredPromptFields = aiPromptFields.filter(field => !manuallyScrapedFields.has(this.normalizePromptFieldName(field)));
        const removedManualFields = aiPromptFields.filter(field => manuallyScrapedFields.has(this.normalizePromptFieldName(field)));
        console.log(`🤖 AI Web: Field priority filter selected ${selected.length} field(s) from ${Object.keys(priorities).length}`);
        if (skippedFieldReasons.length > 0) {
            console.log(`🤖 AI Web: Skipped priority fields => ${JSON.stringify(skippedFieldReasons)}`);
        }
        if (removedManualFields.length > 0) {
            console.log(`🤖 AI Web: Removed manually scraped fields => ${removedManualFields.join(', ')}`);
        }
        if (filteredPromptFields.length === 0) {
            console.warn('🤖 AI Web: No AI prompt fields selected from fieldPriorities; skipping AI extraction for this parser');
        }
        return filteredPromptFields;
    }

    getFieldContext(field, cityConfig) {
        const normalized = this.normalizePromptFieldName(field);
        const schemaDescription = this.getEventSchemaPromptFieldDescription(normalized);
        let description = schemaDescription || 'Event field';
        if (normalized === 'city' && cityConfig && typeof cityConfig === 'object') {
            const cityKeys = this.getCityKeys(cityConfig);
            if (cityKeys.length > 0) {
                description += `. Must be one of: ${cityKeys.join(', ')}`;
            }
        }
        return description;
    }

    getCityKeys(cityConfig) {
        if (!cityConfig || typeof cityConfig !== 'object') return [];
        const candidateMap = cityConfig.cities && typeof cityConfig.cities === 'object'
            ? cityConfig.cities
            : cityConfig;
        const keys = Object.keys(candidateMap);
        if (keys.length === 0) return [];
        const inferredKeys = keys.filter(key => {
            const value = candidateMap[key];
            return value && typeof value === 'object' && (
                'timezone' in value ||
                'state' in value ||
                'country' in value ||
                'aliases' in value ||
                'label' in value
            );
        });
        return inferredKeys.length > 0 ? inferredKeys : keys;
    }

    buildFieldContextText(fields, cityConfig) {
        const allFields = Array.isArray(fields) ? [...fields] : [];
        const normalizedFields = allFields.map(f => this.normalizePromptFieldName(f));
        if (!normalizedFields.includes('city')) {
            allFields.push('city');
        }
        return allFields.map(field => `- ${field}: ${this.getFieldContext(field, cityConfig)}`).join('\n');
    }

    buildExtractionPrompt(htmlData, aiConfig, cityConfig, parserConfig, fields, snippet) {
        const promptFields = Array.isArray(fields) && fields.length > 0
            ? fields
            : this.getAiPromptFields(parserConfig);
        const fieldContext = this.buildFieldContextText(promptFields, cityConfig);
        return `You are a data scraper. You are being provided part of a website that includes information about an event. You must check if any of the requested keys are within the provided scraped data and return it as ONLY valid JSON. If a requested key is not explicitly in the source text, skip and omit it.
Preferred keys:
${fieldContext}
Rules:
- Return a single JSON object only
- Return only keys from the Preferred keys list
- Omit unknown fields; do not invent details and do not estimate. ONLY use data from the source material.

${String(snippet || '')}`;
    }

    buildJsonRepairPrompt(rawResponse, aiConfig, cityConfig, parserConfig, fields) {
        const promptFields = Array.isArray(fields) && fields.length > 0
            ? fields
            : this.getAiPromptFields(parserConfig);
        const fieldContext = this.buildFieldContextText(promptFields, cityConfig);
        return `Convert this text into one strict JSON object for an event.
Preferred keys:
${fieldContext}
Rules:
- JSON object only
- Use only the preferred keys
- No markdown
- No commentary
- Omit unknown fields
- Do not infer missing facts; keep only details explicitly supported by source text

TEXT:
${String(rawResponse || '')}`;
    }

    async extractEventWithTwoPassAi(htmlData, aiConfig, cityConfig, parserConfig, fields, snippet, passLabel = '') {
        const passSuffix = passLabel ? ` ${passLabel}` : '';
        const extractPrompt = this.buildExtractionPrompt(htmlData, aiConfig, cityConfig, parserConfig, fields, snippet);
        const firstPass = await this.callAiGenerate(aiConfig, extractPrompt, 'extraction');
        if (!firstPass) return null;
        const parsedFirstPass = this.parseAiEventResponse(firstPass);
        if (parsedFirstPass) {
            console.log(`🤖 AI Web: Extraction pass${passSuffix} returned parseable JSON`);
            return parsedFirstPass;
        }
        console.warn(`🤖 AI Web: Extraction pass${passSuffix} was not parseable JSON; running repair pass`);
        const repairPrompt = this.buildJsonRepairPrompt(firstPass, aiConfig, cityConfig, parserConfig, fields);
        const secondPass = await this.callAiGenerate(aiConfig, repairPrompt, 'repair');
        if (!secondPass) return null;
        const parsedSecondPass = this.parseAiEventResponse(secondPass);
        if (parsedSecondPass) {
            console.log(`🤖 AI Web: Repair pass${passSuffix} returned parseable JSON`);
            return parsedSecondPass;
        }
        console.warn(`🤖 AI Web: Repair pass${passSuffix} output was still not parseable JSON`);
        return null;
    }

    async callAiGenerate(aiConfig, prompt, passLabel) {
        if (!prompt) return null;
        const label = passLabel ? ` (${passLabel} pass)` : '';
        const promptChars = prompt.length;
        const payload = {
            model: aiConfig.model,
            prompt,
            format: 'json',
            stream: false,
            think: aiConfig.think,
            keep_alive: aiConfig.keepAlive,
            options: {
                num_ctx: aiConfig.numCtx,
                num_predict: aiConfig.numPredict,
                temperature: aiConfig.temperature
            }
        };
        console.log(`🤖 AI Web: Sending AI request${label} to ${aiConfig.endpoint} — model: ${aiConfig.model}, stream: ${payload.stream}, prompt: ${promptChars} chars`);
        console.log(`🤖 AI Web: Full prompt${label} (${promptChars} chars)\n${prompt}`);
        const startTime = Date.now();
        try {
            let responseText = null;
            let responseJson = null;
            if (typeof Request !== 'undefined') {
                const request = new Request(aiConfig.endpoint);
                request.method = 'POST';
                request.headers = { 'Content-Type': 'application/json' };
                request.body = JSON.stringify(payload);
                request.timeoutInterval = aiConfig.timeoutSeconds;
                responseText = await request.loadString();
            } else if (typeof fetch === 'function') {
                const response = await fetch(aiConfig.endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(aiConfig.timeoutSeconds * 1000)
                });
                if (!response.ok) {
                    console.warn(`🤖 AI Web: AI request${label} returned HTTP ${response.status} after ${Date.now() - startTime}ms`);
                    return null;
                }
                responseText = await response.text();
            } else {
                console.warn(`🤖 AI Web: AI request${label} failed - no HTTP client available (Request/fetch missing)`);
                return null;
            }
            if (responseText) {
                try {
                    responseJson = JSON.parse(responseText);
                } catch (parseError) {
                    console.warn(`🤖 AI Web: AI request${label} returned non-JSON payload (${responseText.length} chars)`);
                    console.log(`🤖 AI Web: Raw response payload${label}\n${responseText}`);
                    return null;
                }
            }
            const elapsed = Date.now() - startTime;
            if (responseJson && typeof responseJson.response === 'string' && responseJson.response.length > 0) {
                console.log(`🤖 AI Web: AI request${label} succeeded in ${elapsed}ms — response: ${responseJson.response.length} chars`);
                console.log(`🤖 AI Web: Model response text${label}\n${responseJson.response}`);
                return responseJson.response;
            }
            const doneReason = responseJson && typeof responseJson.done_reason === 'string' ? responseJson.done_reason : 'n/a';
            console.warn(`🤖 AI Web: AI request${label} completed in ${elapsed}ms with empty response (done_reason: ${doneReason})`);
            if (responseText) {
                console.log(`🤖 AI Web: Raw response payload${label}\n${responseText}`);
            }
            return null;
        } catch (error) {
            const elapsed = Date.now() - startTime;
            const errorType = error && error.name ? error.name : 'Error';
            console.warn(`🤖 AI Web: AI request${label} to ${aiConfig.endpoint} with model ${aiConfig.model} failed after ${elapsed}ms (${errorType}): ${error.message}`);
            return null;
        }
    }

    extractFirstJsonObject(text) {
        if (!text) return null;
        const source = String(text).trim();
        const firstBrace = source.indexOf('{');
        if (firstBrace < 0) return null;
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = firstBrace; i < source.length; i++) {
            const ch = source[i];
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (ch === '\\') {
                    escaped = true;
                } else if (ch === '"') {
                    inString = false;
                }
                continue;
            }
            if (ch === '"') {
                inString = true;
                continue;
            }
            if (ch === '{') depth++;
            if (ch === '}') {
                depth--;
                if (depth === 0) {
                    return source.slice(firstBrace, i + 1);
                }
            }
        }
        return null;
    }

    parseAiEventResponse(rawText) {
        if (!rawText) return null;
        try {
            const parsed = JSON.parse(rawText);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (parseError) {
            const jsonObject = this.extractFirstJsonObject(rawText);
            if (!jsonObject) return null;
            try {
                const parsed = JSON.parse(jsonObject);
                return parsed && typeof parsed === 'object' ? parsed : null;
            } catch (jsonError) {
                return null;
            }
        }
    }

    normalizeRruleValue(value) {
        const raw = this.firstNonEmpty(value, '');
        if (!raw) return '';
        const withoutPrefix = raw.replace(/^RRULE\s*:/i, '').trim();
        if (!withoutPrefix) return '';
        if (/\s/.test(withoutPrefix)) return '';
        const normalized = withoutPrefix.toUpperCase();
        if (!normalized.includes('FREQ=')) return '';
        if (!/^[A-Z0-9;=,_:+.-]+$/.test(normalized)) return '';
        return normalized;
    }

    isPromptFieldRequested(fieldName, parserConfig = {}, promptFields = null) {
        const requestedFields = Array.isArray(promptFields) && promptFields.length > 0
            ? promptFields
            : this.getAiPromptFields(parserConfig);
        const requestedSet = new Set(requestedFields.map(field => this.normalizePromptFieldName(field)));
        return requestedSet.has(this.normalizePromptFieldName(fieldName));
    }

    normalizeAiEvent(aiEvent, parserConfig, htmlData = null, cityConfig = null, promptFields = null) {
        const scrapedLinks = this.extractLinksFromPage(
            htmlData && typeof htmlData.html === 'string' ? htmlData.html : '',
            htmlData && typeof htmlData.url === 'string' ? htmlData.url : ''
        );
        const title = this.firstNonEmpty(aiEvent.title, aiEvent.name, aiEvent.summary);
        const description = this.firstNonEmpty(aiEvent.description, aiEvent.desc, '');
        const bar = this.firstNonEmpty(aiEvent.bar, aiEvent.venue, '');
        const address = this.firstNonEmpty(aiEvent.address, aiEvent.addr, '');
        const location = this.firstNonEmpty(aiEvent.location, aiEvent.coords, '');
        const city = this.firstNonEmpty(aiEvent.city, parserConfig && parserConfig.city, '');
        const timezone = this.firstNonEmpty(
            aiEvent.timezone,
            this.getTimezoneForCity(city, cityConfig),
            this.getTimezoneForCity(parserConfig && parserConfig.city, cityConfig),
            ''
        );
        const url = this.firstNonEmpty(aiEvent.url, aiEvent.web, aiEvent.website, '');
        const ticketUrl = this.firstNonEmpty(aiEvent.ticketUrl, aiEvent.tickets, '');
        const instagram = this.firstNonEmpty(scrapedLinks.instagram, aiEvent.instagram, aiEvent.insta, '');
        const facebook = this.firstNonEmpty(scrapedLinks.facebook, aiEvent.facebook, aiEvent.fb, '');
        const gmaps = this.firstNonEmpty(scrapedLinks.gmaps, aiEvent.gmaps, '');
        const image = this.firstNonEmpty(aiEvent.image, aiEvent.img, '');
        const cover = this.firstNonEmpty(aiEvent.cover, '');
        const shortName = this.firstNonEmpty(aiEvent.shortName, aiEvent.short, '');
        const recurrenceRule = this.isPromptFieldRequested('rrule', parserConfig, promptFields)
            ? this.normalizeRruleValue(this.firstNonEmpty(aiEvent.recurrenceRule, aiEvent.rrule, ''))
            : '';

        const startDateRaw = this.parseDateValue(this.firstNonEmpty(aiEvent.startDate, aiEvent.start, ''), timezone);
        const endDateRaw = this.parseDateValue(this.firstNonEmpty(aiEvent.endDate, aiEvent.end, ''), timezone);
        const { startDate, endDate } = this.normalizeEventDates(startDateRaw, endDateRaw);

        if (!title || !startDate) {
            return null;
        }

        const event = {
            title,
            description,
            startDate,
            endDate: endDate || new Date(startDate),
            bar,
            location,
            address,
            city,
            timezone,
            url,
            ticketUrl,
            instagram,
            facebook,
            gmaps,
            image,
            cover,
            shortName,
            recurrenceRule,
            source: this.config.source,
            isBearEvent: false
        };

        if (parserConfig && parserConfig.metadata && typeof parserConfig.metadata === 'object') {
            Object.keys(parserConfig.metadata).forEach(key => {
                const metaValue = parserConfig.metadata[key];
                if (typeof metaValue === 'object' && metaValue !== null && 'value' in metaValue) {
                    event[key] = metaValue.value;
                }
            });
        }

        return event;
    }

    firstNonEmpty(...values) {
        for (const value of values) {
            if (value === null || value === undefined) continue;
            const text = String(value).trim();
            if (text.length > 0) return text;
        }
        return '';
    }

    getCityConfigMap(cityConfig) {
        if (!cityConfig || typeof cityConfig !== 'object') return null;
        if (cityConfig.cities && typeof cityConfig.cities === 'object') {
            return cityConfig.cities;
        }
        return cityConfig;
    }

    getTimezoneForCity(city, cityConfig) {
        const map = this.getCityConfigMap(cityConfig);
        if (!map || typeof map !== 'object') return '';
        const cityText = String(city || '').trim();
        if (!cityText) return '';

        const direct = map[cityText];
        if (direct && typeof direct === 'object' && typeof direct.timezone === 'string' && direct.timezone.trim()) {
            return direct.timezone.trim();
        }

        const normalizedCity = cityText.toLowerCase();
        const matchedKey = Object.keys(map).find(key => String(key).toLowerCase() === normalizedCity);
        if (!matchedKey) return '';
        const matched = map[matchedKey];
        if (!matched || typeof matched !== 'object' || typeof matched.timezone !== 'string') return '';
        return matched.timezone.trim();
    }

    hasExplicitTimezoneInfo(dateValue) {
        const valueText = String(dateValue || '').trim();
        if (!valueText) return false;
        return /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(valueText) || /\b(?:UTC|GMT)\b/i.test(valueText);
    }

    getTimezoneOffsetMinutes(date, timezone) {
        if (!date || !timezone) return null;
        try {
            const formatter = new Intl.DateTimeFormat('en', {
                timeZone: timezone,
                timeZoneName: 'longOffset'
            });
            const parts = formatter.formatToParts(date);
            const offsetPart = parts.find(part => part.type === 'timeZoneName');
            const offsetText = offsetPart && typeof offsetPart.value === 'string' ? offsetPart.value : '';
            const offsetMatch = offsetText.match(/GMT([+-])(\d{2}):(\d{2})/);
            if (!offsetMatch) return null;
            const sign = offsetMatch[1] === '+' ? 1 : -1;
            const hours = parseInt(offsetMatch[2], 10);
            const minutes = parseInt(offsetMatch[3], 10);
            return sign * ((hours * 60) + minutes);
        } catch (_) {
            return null;
        }
    }

    convertLocalDateTimeToUtc(localDateTimeValue, timezone) {
        if (!localDateTimeValue || !timezone || typeof localDateTimeValue !== 'string') {
            return null;
        }

        const valueText = localDateTimeValue.trim();
        // Supports "YYYY-MM-DD", "YYYY-MM-DD HH:mm", "YYYY-MM-DDTHH:mm:ss".
        const match = valueText.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2})(?::?(\d{2}))?(?::?(\d{2}))?)?$/);
        if (!match) {
            return null;
        }

        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10);
        const day = parseInt(match[3], 10);
        const hour = parseInt(match[4] || '0', 10);
        const minute = parseInt(match[5] || '0', 10);
        const second = parseInt(match[6] || '0', 10);

        // Build an initial UTC guess from local components, then iteratively converge
        // to the UTC instant whose timezone offset maps back to the requested local time.
        // Iteration is needed near DST transitions where the first offset guess can be wrong.
        const baseUtcMillis = Date.UTC(year, month - 1, day, hour, minute, second);
        let utcMillis = baseUtcMillis;
        for (let i = 0; i < this.extractionLimits.timezoneConvergenceIterations; i++) {
            const offsetMinutes = this.getTimezoneOffsetMinutes(new Date(utcMillis), timezone);
            if (!Number.isFinite(offsetMinutes)) {
                return null;
            }
            const nextUtcMillis = baseUtcMillis - (offsetMinutes * 60 * 1000);
            if (nextUtcMillis === utcMillis) {
                break;
            }
            utcMillis = nextUtcMillis;
        }

        return new Date(utcMillis);
    }

    parseDateValue(value, timezoneHint = null) {
        if (value === null || value === undefined || value === '') return null;
        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : value;
        }
        if (typeof value === 'number') {
            const numericDate = new Date(value);
            return Number.isNaN(numericDate.getTime()) ? null : numericDate;
        }

        const valueText = String(value).trim();
        if (!valueText) return null;

        if (timezoneHint && !this.hasExplicitTimezoneInfo(valueText) && /\d{1,2}:\d{2}/.test(valueText)) {
            const converted = this.convertLocalDateTimeToUtc(valueText, timezoneHint);
            if (converted && !Number.isNaN(converted.getTime())) {
                return converted;
            }
        }

        const parsed = new Date(valueText);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
        return null;
    }

    normalizeEventDates(startDate, endDate) {
        const adjustedStart = this.adjustLikelyEventYear(startDate);
        const adjustedEnd = this.adjustLikelyEventYear(endDate);
        if (!adjustedStart) {
            return { startDate: null, endDate: null };
        }
        let normalizedEnd = adjustedEnd || new Date(adjustedStart);
        if (normalizedEnd < adjustedStart) {
            normalizedEnd = new Date(adjustedStart);
        }
        return { startDate: adjustedStart, endDate: normalizedEnd };
    }

    adjustLikelyEventYear(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
        const now = new Date();
        const dayMs = this.extractionLimits.millisPerDay;
        const windowStart = new Date(now.getTime() - (this.extractionLimits.yearWindowPastDays * dayMs));
        const windowEnd = new Date(now.getTime() + (this.extractionLimits.yearWindowFutureDays * dayMs));
        if (date >= windowStart && date <= windowEnd) {
            return new Date(date);
        }

        const year = date.getFullYear();
        const candidates = [year - 1, year, year + 1].map(candidateYear => {
            const candidate = new Date(date);
            candidate.setFullYear(candidateYear);
            return candidate;
        });
        const inWindow = candidates.filter(candidate => candidate >= windowStart && candidate <= windowEnd);
        const candidateSet = inWindow.length > 0 ? inWindow : candidates;
        return candidateSet.reduce((best, candidate) => {
            if (!best) return candidate;
            return Math.abs(candidate.getTime() - now.getTime()) < Math.abs(best.getTime() - now.getTime())
                ? candidate
                : best;
        }, null);
    }

    extractTitlePart(html) {
        const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
        if (!match) return '';
        return this.normalizeWhitespace(this.stripTags(match[1]));
    }

    extractMetaParts(html) {
        const results = [];
        const seen = new Set();
        const regex = /<meta\b[^>]*>/gi;
        let match;
        while ((match = regex.exec(html)) !== null) {
            const tag = match[0];
            const nameMatch = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i);
            const contentMatch = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i);
            if (!nameMatch || !contentMatch) continue;
            const key = this.normalizeWhitespace(nameMatch[1]).toLowerCase();
            if (this.excludedMetaKeyRegexes.some(regexPattern => regexPattern.test(key))) continue;
            const allowedMetaKeys = new Set([
                'description',
                'title',
                'location',
                'venue',
                'address',
                'geo.position',
                'geo.placename'
            ]);
            const hasAllowedPrefix = key.startsWith('og:') || key.startsWith('twitter:') || key.startsWith('event:');
            if (!hasAllowedPrefix && !allowedMetaKeys.has(key)) continue;
            const value = this.sanitizeMetaContent(key, contentMatch[1]);
            if (!value) continue;
            const line = `${key}: ${value}`;
            const dedupeKey = line.toLowerCase();
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            results.push(line);
            if (results.length >= this.extractionLimits.maxMetaParts) break;
        }
        return results;
    }

    extractJsonLdParts(html) {
        const results = [];
        const eventResults = [];
        const regex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let match;
        while ((match = regex.exec(html)) !== null) {
            const text = this.normalizeJsonLdPayload(match[1] || '');
            if (!text) continue;
            results.push(text);
            if (this.containsEventType(text)) {
                eventResults.push(text);
            }
            if (results.length >= this.extractionLimits.maxJsonLdParts * this.jsonLdCandidatePoolSizeMultiplier) break;
        }
        const selected = eventResults.length > 0 ? eventResults : results;
        return selected.slice(0, this.extractionLimits.maxJsonLdParts);
    }

    extractLinkParts(html) {
        const results = [];
        const seen = new Set();
        const regex = /href=["']([^"']+)["']/gi;
        let match;
        while ((match = regex.exec(html)) !== null) {
            const rawUrl = match[1];
            if (!rawUrl || rawUrl.startsWith('#')) continue;
            const normalized = this.normalizeWhitespace(rawUrl);
            if (!/^https?:\/\//i.test(normalized)) continue;
            const dedupeKey = normalized.toLowerCase();
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            results.push(normalized);
            if (results.length >= this.extractionLimits.maxLinkParts) break;
        }
        return results;
    }

    extractBodyParts(html) {
        let text = String(html);
        text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi, ' ');
        text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style[^>]*>/gi, ' ');
        text = text.replace(/<!--[\s\S]*?-->/g, ' ');
        text = text.replace(/<(nav|header|footer|aside|noscript|form|button)\b[^>]*>[\s\S]*?<\/\1[^>]*>/gi, ' ');
        text = text.replace(/<[a-z0-9]+\b[^>]*(?:class|id)=["'][^"']*(nav|menu|footer|header|share|social|recommend|carousel|cta|newsletter|breadcrumb)[^"']*["'][^>]*>[\s\S]{0,12000}?<\/[a-z0-9]+>/gi, ' ');
        text = text.replace(/<(br|\/p|\/div|\/li|\/section|\/article|\/h[1-6]|\/tr|\/td)\b[^>]*>/gi, '\n');
        text = text.replace(/<[^>]+>/g, ' ');

        const lines = text
            .split('\n')
            .map(line => this.normalizeWhitespace(this.decodeBasicEntities(line)))
            .filter(Boolean);

        const seen = new Set();
        const results = [];
        for (const line of lines) {
            const lower = line.toLowerCase();
            if (line.length < 3) continue;
            if (this.noiseLineRegex.test(line)) continue;
            if (seen.has(lower)) continue;
            seen.add(lower);
            results.push(line);
            if (results.length >= this.extractionLimits.maxBodyParts) break;
        }
        return results;
    }

    decodeBasicEntities(text) {
        return String(text || '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>');
    }

    stripTags(text) {
        return String(text || '').replace(/<[^>]+>/g, ' ');
    }

    normalizeWhitespace(text) {
        return String(text || '').replace(/\s+/g, ' ').trim();
    }

    sanitizeMetaContent(key, value) {
        const normalizedKey = String(key || '').toLowerCase();
        const normalizedValue = this.normalizeWhitespace(this.decodeBasicEntities(value || ''));
        if (!normalizedValue) return '';
        const likelyUrlKey = /(url|image|video|audio)/.test(normalizedKey);
        if (likelyUrlKey || this.isLikelyUrlValue(normalizedValue)) {
            return this.simplifyUrlValue(normalizedValue, { stripQuery: true });
        }
        return this.trimToMaxLength(normalizedValue, 320);
    }

    normalizeJsonLdPayload(rawText) {
        const normalized = this.normalizeWhitespace(this.decodeBasicEntities(rawText || ''));
        if (!normalized) return '';
        let parsed = null;
        try {
            parsed = JSON.parse(normalized);
        } catch (_) {
            return this.trimToMaxLength(normalized, 2000);
        }
        const compact = this.compactJsonLdValue(parsed);
        if (compact === null || compact === undefined || compact === '') return '';
        try {
            return JSON.stringify(compact);
        } catch (_) {
            return this.trimToMaxLength(normalized, 2000);
        }
    }

    compactJsonLdValue(value, keyName = '') {
        if (value === null || value === undefined) return null;
        if (Array.isArray(value)) {
            const compacted = value
                .map(item => this.compactJsonLdValue(item, keyName))
                .filter(item => item !== null && item !== undefined && item !== '');
            return compacted.length > 0 ? compacted : null;
        }
        if (typeof value === 'object') {
            const result = {};
            Object.keys(value).forEach(key => {
                if (this.jsonLdDropKeyPattern.test(key)) return;
                const compacted = this.compactJsonLdValue(value[key], key);
                if (compacted === null || compacted === undefined || compacted === '') return;
                result[key] = compacted;
            });
            return Object.keys(result).length > 0 ? result : null;
        }
        if (typeof value === 'string') {
            const normalized = this.normalizeWhitespace(this.decodeBasicEntities(value));
            if (!normalized) return '';
            const lowerKey = String(keyName || '').toLowerCase();
            if (this.isLikelyUrlValue(normalized) || /(url|image|logo|sameas|@id)/.test(lowerKey)) {
                return this.simplifyUrlValue(normalized, { stripQuery: true });
            }
            const maxLength = /(description)/.test(lowerKey) ? 500 : 240;
            return this.trimToMaxLength(normalized, maxLength);
        }
        return value;
    }

    containsEventType(jsonText) {
        try {
            const parsed = JSON.parse(jsonText);
            return this.hasEventTypeValue(parsed);
        } catch (_) {
            return /"@type"\s*:\s*(?:"[^"]*event[^"]*"|\[[^\]]*event[^\]]*\])/i.test(String(jsonText || ''));
        }
    }

    hasEventTypeValue(node) {
        if (!node) return false;
        if (Array.isArray(node)) return node.some(item => this.hasEventTypeValue(item));
        if (typeof node !== 'object') return false;
        const typeValue = node['@type'];
        if (typeof typeValue === 'string' && /event/i.test(typeValue)) return true;
        if (Array.isArray(typeValue) && typeValue.some(type => typeof type === 'string' && /event/i.test(type))) {
            return true;
        }
        return Object.keys(node).some(key => this.hasEventTypeValue(node[key]));
    }

    isLikelyUrlValue(value) {
        const text = String(value || '').trim();
        return /^https?:\/\//i.test(text) || /^\/[^\s]/.test(text);
    }

    simplifyUrlValue(value, options = {}, unwrapDepth = 0) {
        const stripQuery = options?.stripQuery ?? true;
        let text = this.decodeUrlEscapes(this.decodeBasicEntities(value || ''));
        text = this.normalizeWhitespace(text);
        if (!text) return '';
        if (unwrapDepth > this.maxUrlUnwrapDepth) {
            return this.trimToMaxLength(text, 320);
        }

        if (this.proxyImagePathPrefixes.some(prefix => text.startsWith(prefix))) {
            try {
                const proxyUrl = new URL(`${this.relativeUrlParsingBase}${text}`);
                const wrapped = proxyUrl.searchParams.get('url');
                if (wrapped) {
                    const decodedWrapped = this.decodeUrlEscapes(this.decodeBasicEntities(wrapped));
                    return this.simplifyUrlValue(decodedWrapped, options, unwrapDepth + 1);
                }
            } catch (_) {}
        }

        if (!/^https?:\/\//i.test(text) && !/^\/[^\s]/.test(text)) {
            return this.trimToMaxLength(text, 320);
        }

        try {
            const baseUrl = text.startsWith('/') ? this.relativeUrlParsingBase : undefined;
            const parsed = new URL(text, baseUrl);
            if (stripQuery) {
                parsed.search = '';
                parsed.hash = '';
            }
            const normalized = parsed.toString();
            if (text.startsWith('/')) {
                return normalized.replace(new RegExp(`^${this.relativeUrlParsingBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), '');
            }
            return normalized;
        } catch (_) {
            return this.trimToMaxLength(text, 320);
        }
    }

    trimToMaxLength(text, maxLength) {
        const normalized = this.normalizeWhitespace(text || '');
        if (!Number.isFinite(maxLength) || maxLength <= 0 || normalized.length <= maxLength) {
            return normalized;
        }
        return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
    }

    extractLinksFromPage(html, sourceUrl) {
        if (!html) return { instagram: '', facebook: '', gmaps: '' };
        const links = [];
        const hrefRegex = /href=["']([^"']+)["']/gi;
        const contentUrlRegex = /<meta\b[^>]*content=["']([^"']+)["'][^>]*>/gi;
        let match;
        while ((match = hrefRegex.exec(html)) !== null) {
            links.push(match[1]);
        }
        while ((match = contentUrlRegex.exec(html)) !== null) {
            links.push(match[1]);
        }
        let instagram = '';
        let facebook = '';
        let gmaps = '';

        for (const link of links) {
            const normalized = this.normalizeUrl(link, sourceUrl);
            if (!normalized || !/^https?:\/\//i.test(normalized)) continue;
            let parsedUrl = null;
            try {
                parsedUrl = new URL(normalized);
            } catch (_) {
                continue;
            }
            const host = String(parsedUrl.hostname || '').toLowerCase();
            const path = String(parsedUrl.pathname || '').toLowerCase();
            const isInstagram = host === 'instagram.com' || host.endsWith('.instagram.com');
            const isFacebook = host === 'facebook.com' || host.endsWith('.facebook.com');
            const isGoogleMaps = host === 'maps.app.goo.gl' || host.endsWith('.maps.app.goo.gl') || (
                (host === 'google.com' || host.endsWith('.google.com')) &&
                path.startsWith('/maps')
            );
            if (!instagram && isInstagram) instagram = normalized;
            if (!facebook && isFacebook) facebook = normalized;
            if (!gmaps && isGoogleMaps) gmaps = normalized;
            if (instagram && facebook && gmaps) break;
        }

        return { instagram, facebook, gmaps };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AiWebParser };
} else if (typeof window !== 'undefined') {
    window.AiWebParser = AiWebParser;
} else {
    this.AiWebParser = AiWebParser;
}

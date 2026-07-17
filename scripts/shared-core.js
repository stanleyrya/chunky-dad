// ============================================================================
// SHARED CORE - PURE JAVASCRIPT BUSINESS LOGIC
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE JavaScript business logic
// 
// 🚨 CRITICAL RESTRICTIONS - NEVER ADD THESE TO THIS FILE:
// ❌ NO environment detection (typeof importModule, typeof window, typeof DOMParser)
// ❌ NO Scriptable APIs (Request, Calendar, FileManager, Alert, Notification)
// ❌ NO DOM APIs (DOMParser, document, window, fetch)
// ❌ NO HTTP requests (parsers receive data, they don't fetch it)
// ❌ NO calendar operations (return event objects, don't save them)
//
// ✅ THIS FILE SHOULD ONLY CONTAIN:
// ✅ Pure JavaScript functions that work in any environment
// ✅ Event processing, filtering, deduplication logic
// ✅ Date/string utilities and validation
// ✅ Business logic that calls adapter interfaces
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

// Sentinel maxDepth for adaptive crawling (urlDiscoveryDepth absent): each
// page's classification decides whether its links are followed, bounded by a
// hard chain cap instead of a fixed numeric depth.
const ADAPTIVE_CRAWL_DEPTH = 'adaptive';
// Hard cap on adaptive crawl chains: pages this many hops from a root never
// have their links followed, no matter how they classify.
const ADAPTIVE_CRAWL_MAX_HOPS = 4;
// Stored-pin vs fresh-geocode divergence (km) that warrants human review.
// Fresh geocodes are grade-gated and cross-checked (normalizers.js), so
// sub-km disagreement is meaningful. Shared by the merge-time STEP 3c flag
// and the calendar reviewer's pin-moved check.
const PIN_MOVED_THRESHOLD_KM = 0.4;

class SharedCore {
    constructor(cities, options = {}) {
        if (!cities || typeof cities !== 'object') {
            throw new Error('SharedCore requires cities configuration - pass config.cities from scraper-cities.js');
        }
        const schema = options.eventSchema;
        if (!schema) {
            throw new Error('SharedCore requires eventSchema dependency');
        }
        const requiredSchemaFunctions = [
            'parseNotesIntoFields',
            'formatEventNotes',
            'findUnescaped',
            'unescapeText',
            'escapeText',
            'isValidMetadataKey',
            'isUrlLikeField'
        ];
        requiredSchemaFunctions.forEach(fnName => {
            if (typeof schema[fnName] !== 'function') {
                throw new Error(`SharedCore requires eventSchema.${fnName} function`);
            }
        });
        if (!schema.DEFAULT_NOTES_EXCLUDED_FIELDS || typeof schema.DEFAULT_NOTES_EXCLUDED_FIELDS.has !== 'function') {
            throw new Error('SharedCore requires eventSchema.DEFAULT_NOTES_EXCLUDED_FIELDS Set');
        }

        this.visitedUrls = new Set();
        // Two-tier bear keyword lists (see matchBearKeywords): substring terms
        // are distinctive enough to hit smooshed brand names (CHUNKA GO,
        // CUBHOUSE, BEEFWITCH, Bearracuda); common words that misfire as
        // substrings ("fatal", "furniture", "update", "puppet") require word
        // boundaries.
        this.bearSubstringKeywords = [
            'bear', 'woof', 'grr', 'furry', 'hairy', 'daddy', 'cub', 'otter',
            'leather', 'bearracuda', 'furball', 'megawoof', 'grizzly', 'chunk',
            'chub', 'beef', 'scruff', 'jock'
        ];
        this.bearWordBoundaryKeywords = [
            'dad', 'dads', 'fat', 'fur', 'pup', 'pig', 'wolf', 'wolves',
            'thick', 'burly', 'stocky', 'husky', 'beard', 'bearded', 'harness'
        ];
        
        // Store cities config for timezone assignment
        this.cities = cities;
        this.eventSchema = schema;
        this.normalizerPipeline = options.normalizerPipeline || null;
        this.bars = options.bars || {};
        this.notesExcludedFields = new Set([
            ...this.eventSchema.DEFAULT_NOTES_EXCLUDED_FIELDS,
            ...(options.additionalExcludedFields || [])
        ]);
        
        // Initialize city mappings from centralized cities config
        this.cityMappings = this.convertCitiesConfigToCityMappings(this.cities);
        this.loggedWarnings = new Set();
        // Per-run learned dead-end context (created by processEvents from the
        // store the orchestrator loaded; null outside a run = feature inert)
        this.deadEndRunContext = null;
        this.trackingParamPattern = /^(aff|affix|affiliate|utm_source|utm_medium|utm_campaign|utm_content|utm_term|ref|referral|fbclid|gclid|msclkid|dclid|source|mc_cid|mc_eid)$/i;
        
        // URL-to-parser mapping for automatic parser detection
        this.urlParserMappings = [
            {
                pattern: /^scriptable-input:\/\//i,
                parser: 'scriptable-input'
            },
            {
                pattern: /^ai-web:\/\//i,
                parser: 'ai-web'
            },
            {
                pattern: /bearracuda\.com/i,
                parser: 'bearracuda'
            },
            {
                pattern: /chunk-party\.com/i,
                parser: 'chunk'
            },
            {
                pattern: /linktr\.ee/i,
                parser: 'linktree'
            },
            {
                pattern: /redeyetickets\.com/i,
                parser: 'redeyetickets'
            }
            // Generic parser will be used as fallback if no pattern matches
        ];

        // URL pattern rules for page classification (checked in order, first match wins).
        // Built-in platform rules are appended AFTER config rules so config always overrides.
        this.pageClassificationRules = [
            ...this.normalizePageClassificationRules(options.pageClassificationRules || []),
            ...this.normalizePageClassificationRules(this.getBuiltInPageClassificationRules())
        ];

        // Compiled regex and thresholds for HTML heuristics in classifyPage
        this.pageClassificationMonthPattern = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/gi;
        this.pageClassificationNumericDatePattern = /\b\d{1,2}\/\d{1,2}\b/g;
        this.pageClassificationMultiEventThreshold = 3;  // >= 3 month mentions → multi-event-page
        this.pageClassificationEventPageThreshold = 1;   // >= 1 month mention  → event-page
    }

    // Convert cities config format to internal cityMappings format
    convertCitiesConfigToCityMappings(cities) {
        const cityMappings = {};
        
        for (const [cityKey, cityConfig] of Object.entries(cities)) {
            if (cityConfig.patterns && Array.isArray(cityConfig.patterns)) {
                // Convert array of patterns to pipe-separated string format
                const pipePatterns = cityConfig.patterns.join('|');
                cityMappings[pipePatterns] = cityKey;
            }
        }
        
        const cityCount = Object.keys(cities).length;
        const patternCount = Object.values(cities).reduce((count, cityConfig) => {
            return count + (Array.isArray(cityConfig.patterns) ? cityConfig.patterns.length : 0);
        }, 0);
        console.log(`🗺️ SharedCore: Loaded ${cityCount} cities (${patternCount} patterns)`);
        return cityMappings;
    }

    warnOnce(key, message) {
        if (!this.loggedWarnings) {
            this.loggedWarnings = new Set();
        }
        if (this.loggedWarnings.has(key)) {
            return;
        }
        this.loggedWarnings.add(key);
        console.warn(message);
    }

    // Detect parser type from URL - allows automatic parser selection based on URL patterns
    // This enables configurations to omit the 'parser' field and have it auto-detected
    detectParserFromUrl(url) {
        if (!url) {
            return 'ai-web';
        }
        
        for (const mapping of this.urlParserMappings) {
            if (mapping.pattern.test(url)) {
                return mapping.parser;
            }
        }
        
        // Default to ai-web parser if no pattern matches
        return 'ai-web';
    }

    /**
     * Classify a page URL/HTML into one of: 'event-page', 'link-aggregator', 'multi-event-page', 'ad', 'unknown'.
     *
     * Priority order:
     *   1. pageClassificationRules — deterministic URL pattern match (no HTML required).
     *   2. HTML heuristics — count month-name occurrences and numeric date (M/D) occurrences to distinguish single vs. multi-event pages.
     *   3. Default — returns 'unknown' when no rule or heuristic applies.
     *
     * @param {string|null} url  - Absolute URL of the page being classified.
     * @param {string|null} html - Raw HTML of the page (used only when URL patterns don't match).
     * @returns {'event-page'|'link-aggregator'|'multi-event-page'|'ad'|'unknown'}
     */
    classifyPage(url, html) {
        return this.classifyPageWithSignal(url, html).classification;
    }

    // Like classifyPage, but also reports WHICH tier decided ('url-rule', 'json-ld',
    // 'heuristic', 'none') so callers can treat text-heuristic results as weak and
    // optionally re-check them with AI.
    classifyPageWithSignal(url, html) {
        // 1. URL pattern rules (deterministic, no HTML needed)
        const ruleClassification = this.classifyUrlByRules(url);
        if (ruleClassification) {
            return { classification: ruleClassification, signal: 'url-rule' };
        }

        // 2. Schema.org Event JSON-LD (deterministic). Ticketing pages (sickening.events,
        //    tryst.events) describe exactly one event in structured data but trip the
        //    month-count heuristic below with related-event footers and calendars,
        //    landing in the segment-discovery path that finds nothing.
        if (html) {
            const jsonLdEventCount = this.extractJsonLdEventNodes(html).length;
            if (jsonLdEventCount === 1) return { classification: 'event-page', signal: 'json-ld' };
            if (jsonLdEventCount >= 2) return { classification: 'multi-event-page', signal: 'json-ld' };
        }

        // 3. HTML heuristics for unknown URLs
        if (html) {
            // Reset lastIndex since the patterns are reused across calls (global flag)
            this.pageClassificationMonthPattern.lastIndex = 0;
            const monthMatches = html.match(this.pageClassificationMonthPattern) || [];

            // Numeric short-date patterns like "7/25" or "8/15" (common on listing pages like Furball)
            this.pageClassificationNumericDatePattern.lastIndex = 0;
            const numericDateMatches = html.match(this.pageClassificationNumericDatePattern) || [];

            if (monthMatches.length >= this.pageClassificationMultiEventThreshold ||
                numericDateMatches.length >= this.pageClassificationMultiEventThreshold) {
                return { classification: 'multi-event-page', signal: 'heuristic' };
            }
            if (monthMatches.length >= this.pageClassificationEventPageThreshold ||
                numericDateMatches.length >= this.pageClassificationEventPageThreshold) {
                return { classification: 'event-page', signal: 'heuristic' };
            }
        }

        return { classification: 'unknown', signal: 'none' };
    }

    // Compact text summary of a page for the AI classification prompt: title, meta
    // description, and the first chunk of visible body text.
    summarizePageForClassification(html, maxTextChars = 2500) {
        const source = String(html || '');
        const titleMatch = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const metaMatch = source.match(/<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["']/i)
            || source.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["']/i);
        const bodyMatch = source.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        const cleanText = (value) => String(value || '')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return {
            title: cleanText(titleMatch ? titleMatch[1] : ''),
            metaDescription: cleanText(metaMatch ? metaMatch[1] : ''),
            bodyText: cleanText(bodyMatch ? bodyMatch[1] : source).slice(0, maxTextChars)
        };
    }

    // Ask the text model to classify a page. Used only when the deterministic tiers
    // (URL rules, JSON-LD) had no answer and the month-count heuristic is all we have.
    // Returns { classification, confidence, reason } or null when the response is
    // unusable — callers should keep their heuristic answer in that case.
    // `cache` is an optional { read(url, signature), write(url, signature, outcome) }
    // provider (persistence lives in the adapter/parser layer — this file stays pure);
    // outcomes are cached per URL + page-summary + model so repeat runs over unchanged
    // pages cost nothing.
    async classifyPageWithAi(url, html, aiConfig, httpAdapter, cache = null) {
        if (!aiConfig || aiConfig.enabled === false || !httpAdapter) return null;
        const validLabels = ['event-page', 'multi-event-page', 'link-aggregator', 'ad', 'unknown'];
        const summary = this.summarizePageForClassification(html);
        if (!summary.bodyText && !summary.title) return null;

        const cacheSignature = {
            model: String(aiConfig.model || ''),
            title: summary.title,
            metaDescription: summary.metaDescription,
            bodyText: summary.bodyText
        };
        if (cache && typeof cache.read === 'function') {
            try {
                const cachedOutcome = await cache.read(url, cacheSignature);
                if (cachedOutcome && typeof cachedOutcome === 'object') {
                    console.log(`🗂️ SharedCore: AI classification cache hit for ${url} → ${cachedOutcome.rejected ? 'rejected' : cachedOutcome.classification}`);
                    return cachedOutcome.rejected ? null : cachedOutcome;
                }
            } catch (error) {
                console.log(`🗂️ SharedCore: AI classification cache read failed for ${url}: ${error.message}`);
            }
        }

        const prompt = [
            'You are classifying a web page for an event scraper.',
            '',
            `URL: ${url || 'unknown'}`,
            `PAGE_TITLE: ${summary.title || 'none'}`,
            `META_DESCRIPTION: ${summary.metaDescription || 'none'}`,
            `PAGE_TEXT (truncated): ${summary.bodyText || 'none'}`,
            '',
            'Classify the page into exactly ONE category:',
            '- event-page: describes ONE event (one date or continuous range, one venue, one ticket flow)',
            '- multi-event-page: lists TWO OR MORE distinct events with different dates or tickets',
            '- link-aggregator: a hub of links (linktree-style, venue/city hub) without event details of its own',
            '- ad: advertisement or promo page with no concrete event details',
            '- unknown: cannot tell from the text',
            '',
            'Return JSON only: {"classification": "<category>", "confidence": 0-100, "reason": "<one sentence>"}'
        ].join('\n');

        // Classification needs a short answer — cap generation regardless of the
        // extraction config's budget.
        const classifyConfig = { ...aiConfig, numPredict: Math.min(Number(aiConfig.numPredict) || 300, 300) };
        const rawResponse = await this.callAiGenerate(classifyConfig, prompt, 'classify-page', httpAdapter);
        if (!rawResponse) return null;

        let parsed = null;
        try {
            parsed = JSON.parse(this.extractFirstJsonObject(rawResponse) || rawResponse);
        } catch (_) {
            // Unparseable response — could be a transient server problem, don't cache
            return null;
        }
        if (!parsed || typeof parsed !== 'object') return null;

        // The model answered; both accepted and rejected outcomes are deterministic
        // for this page+model (temperature 0) and worth caching.
        const classification = String(parsed.classification || '').trim().toLowerCase();
        const confidence = Number(parsed.confidence);
        let outcome;
        if (!validLabels.includes(classification) || classification === 'unknown'
            || (Number.isFinite(confidence) && confidence < 60)) {
            outcome = { rejected: true };
        } else {
            outcome = {
                classification,
                confidence: Number.isFinite(confidence) ? confidence : null,
                reason: typeof parsed.reason === 'string' ? parsed.reason : ''
            };
        }
        if (cache && typeof cache.write === 'function') {
            try {
                await cache.write(url, cacheSignature, outcome);
            } catch (error) {
                console.log(`🗂️ SharedCore: AI classification cache write failed for ${url}: ${error.message}`);
            }
        }
        return outcome.rejected ? null : outcome;
    }

    // ============================================================================
    // AI MERGE ARBITRATION
    // ============================================================================
    // When two records of the same event both have a value for a field and the
    // values differ, the AI picks the better one. The pick is only trusted when
    // the returned value is a VERBATIM copy of one of the candidates — anything
    // else falls back to the deterministic strategy, so a hallucinating (or dead)
    // model can never make a merge worse than today.

    isArbitrationEligibleField(fieldName) {
        const name = String(fieldName || '');
        if (!name || name.startsWith('_')) return false;
        // location is never arbitrated: it is ALWAYS coordinates (the calendar is
        // used as a database), so merges resolve it deterministically via
        // isCoordinatePair — human-readable text belongs in address/bar.
        // gmaps is never arbitrated either: it is DERIVED (a pure function of
        // bar + address), so arbitrating it independently let it disagree with
        // the merged bar/address — createFinalEventObject regenerates it from
        // the final merged values instead.
        return name !== 'key' && name !== 'notes' && name !== 'source'
            && name !== 'location' && name !== 'gmaps';
    }

    // "lat, lng" / "lat,lng": two finite floats with lat in [-90, 90] and lng in
    // [-180, 180]. The location field is ALWAYS coordinates — the normalization
    // layer fills it with coordinates, and merges must never let address text or
    // an empty scrape displace them.
    isCoordinatePair(value) {
        if (typeof value !== 'string') return false;
        const match = value.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
        if (!match) return false;
        const lat = Number(match[1]);
        const lng = Number(match[2]);
        return Number.isFinite(lat) && Number.isFinite(lng)
            && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    }

    // "lat, lng" string → { lat, lng } numbers, or null when not a pair.
    parseCoordinatePair(value) {
        if (!this.isCoordinatePair(value)) return null;
        const [lat, lng] = String(value).split(',').map(part => Number(part.trim()));
        return { lat, lng };
    }

    // Great-circle distance in km between two "lat, lng" strings (haversine —
    // pure math, no platform APIs). Null when either side isn't a pair.
    coordinatePairDistanceKm(valueA, valueB) {
        const a = this.parseCoordinatePair(valueA);
        const b = this.parseCoordinatePair(valueB);
        if (!a || !b) return null;
        const toRadians = (degrees) => degrees * Math.PI / 180;
        const sinHalfLat = Math.sin(toRadians(b.lat - a.lat) / 2);
        const sinHalfLng = Math.sin(toRadians(b.lng - a.lng) / 2);
        const h = sinHalfLat * sinHalfLat
            + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sinHalfLng * sinHalfLng;
        const earthRadiusKm = 6371;
        return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    // Date-or-ISO-string → epoch milliseconds, or null when absent/unparseable.
    toEpochMillis(value) {
        if (value === null || value === undefined || value === '') return null;
        const date = value instanceof Date ? value : new Date(value);
        const time = date.getTime();
        return Number.isNaN(time) ? null : time;
    }

    // Value equality for clobber TRACKING/logging only — never for choosing a
    // winner. Two Dates (or a Date vs ISO string) naming the same instant are
    // the same value; everything else compares strictly. Keeps identical-instant
    // startDate/endDate re-reads out of the `🔄 MERGE: ... clobbered N fields`
    // log, which previously listed them on every run because each run builds
    // fresh Date objects that fail the `!==` identity check.
    mergeValuesEqualForTracking(a, b) {
        if (a === b) return true;
        if (a instanceof Date || b instanceof Date) {
            const aMs = this.toEpochMillis(a);
            const bMs = this.toEpochMillis(b);
            return aMs !== null && aMs === bMs;
        }
        return false;
    }

    // endDate <= startDate (compared as instants) is a normalization artifact
    // (e.g. an evidence-dropped end date collapsing an event to zero duration),
    // not data. Degenerate ends must never displace a positive-duration end.
    hasDegenerateEnd(event) {
        const startMs = this.toEpochMillis(event && event.startDate);
        const endMs = this.toEpochMillis(event && event.endDate);
        return startMs !== null && endMs !== null && endMs <= startMs;
    }

    isEmptyArbitrationValue(value) {
        return value === null || value === undefined || String(value).trim() === '';
    }

    serializeArbitrationValue(fieldName, value) {
        if (value instanceof Date) return value.toISOString();
        if ((fieldName === 'startDate' || fieldName === 'endDate') && value) {
            const date = new Date(value);
            if (!Number.isNaN(date.getTime())) return date.toISOString();
        }
        return String(value === null || value === undefined ? '' : value).trim();
    }

    // Cover values that differ only in whitespace are the SAME price: the old
    // formatter spaced the range dash ("$22.10 - $39.98"), the sticker-price
    // formatter doesn't ("$22.10-$39.98"), and that formatting twin burned an
    // AI arbitration on every run.
    coverValuesEquivalent(valueA, valueB) {
        const stripWhitespace = (value) => String(value === null || value === undefined ? '' : value).replace(/\s+/g, '');
        const strippedA = stripWhitespace(valueA);
        return strippedA !== '' && strippedA === stripWhitespace(valueB);
    }

    // A genuine conflict: both sides non-empty primitives whose serialized forms
    // differ. Same-instant Date vs ISO string is NOT a conflict, and neither are
    // whitespace-only cover formatting twins.
    isGenuineFieldConflict(fieldName, valueA, valueB) {
        if (this.isEmptyArbitrationValue(valueA) || this.isEmptyArbitrationValue(valueB)) return false;
        const isPrimitive = (v) => v instanceof Date || typeof v !== 'object';
        if (!isPrimitive(valueA) || !isPrimitive(valueB)) return false;
        const serializedA = this.serializeArbitrationValue(fieldName, valueA);
        const serializedB = this.serializeArbitrationValue(fieldName, valueB);
        if (fieldName === 'cover' && this.coverValuesEquivalent(serializedA, serializedB)) return false;
        return serializedA !== serializedB;
    }

    arbitrationValuesEqual(fieldName, answerText, candidateText) {
        if (answerText === candidateText) return true;
        if (fieldName === 'startDate' || fieldName === 'endDate') {
            const answerDate = new Date(answerText);
            const candidateDate = new Date(candidateText);
            return !Number.isNaN(answerDate.getTime()) && !Number.isNaN(candidateDate.getTime())
                && answerDate.getTime() === candidateDate.getTime();
        }
        if (fieldName === 'cover') {
            return this.coverValuesEquivalent(answerText, candidateText);
        }
        return false;
    }

    // ------------------------------------------------------------------
    // Deterministic pre-arbitration rules. Production runs showed the
    // arbitration model systematically misjudging three conflict shapes (with
    // confabulated reasons); these generic signals — URL shape and string
    // identity, never per-site rules — resolve them BEFORE the AI sees them:
    // fewer AI calls and no model dependency. Everything else still arbitrates.
    // ------------------------------------------------------------------

    // Lowercased host without "www." plus path segments (trailing slashes
    // ignored) for an http(s) URL string, or null when the value isn't one.
    // Built on parseUrl (Scriptable-safe regex parsing — no URL global).
    getUrlRuleParts(value) {
        if (typeof value !== 'string') return null;
        const parsed = this.parseUrl(value.trim());
        if (!parsed || !parsed.host) return null;
        const host = String(parsed.hostname || parsed.host).toLowerCase().replace(/^www\./, '');
        if (!host) return null;
        const segments = String(parsed.pathname || '/').split('/').filter(Boolean);
        const hasQuery = String(parsed.search || '').length > 1;
        return { host, segments, hasQuery };
    }

    // Emoji/pictograph-stripped view of a title: pictograph blocks, variation
    // selectors, the keycap combiner and ZWJ removed, whitespace collapsed.
    // Conservative on purpose: ASCII and real punctuation are never stripped.
    stripEmojiForTitleTwin(value) {
        return String(value)
            .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0E}\u{FE0F}\u{20E3}\u{200D}]/gu, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // A bare city name is not an event name (bearracuda.com titles its event
    // pages after the city: og:title "New Orleans⚜️ | BEARRACUDA" → the brand
    // strip leaves "New Orleans⚜️"). True when the title — after stripping
    // emoji (stripEmojiForTitleTwin), collapsing whitespace, and case-folding —
    // exactly equals the resolved city's key (dashes/underscores read as
    // spaces), its display name, or ANY configured pattern/alias ("new
    // orleans", "nola"). Whole-title match only: "Hot Take Portland" is a real
    // event name. Missing/unknown cities are never city-only.
    isCityOnlyTitle(title, cityKey) {
        if (!title || !cityKey || !this.cities || typeof this.cities !== 'object') return false;
        const normalizedKey = String(cityKey).trim().toLowerCase();
        const cityData = this.cities[cityKey] || this.cities[normalizedKey];
        if (!cityData || typeof cityData !== 'object') return false;
        const normalizedTitle = this.stripEmojiForTitleTwin(title).replace(/\s+/g, ' ').trim().toLowerCase();
        if (!normalizedTitle) return false;
        const candidates = new Set();
        const addCandidate = value => {
            const text = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (!text) return;
            candidates.add(text);
            candidates.add(text.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim());
        };
        addCandidate(normalizedKey);
        addCandidate(cityData.name);
        if (Array.isArray(cityData.patterns)) cityData.patterns.forEach(addCandidate);
        if (Array.isArray(cityData.aliases)) cityData.aliases.forEach(addCandidate);
        return candidates.has(normalizedTitle);
    }

    // Deterministic conflict resolution consulted by BOTH merge paths
    // (createFinalEventObject and mergeParsedEvents) before a field is queued
    // for AI arbitration. Returns { winner: 'a'|'b', reason } or null (→
    // arbitrate as usual). Callers map a/b onto their own labels and thread
    // event context (currently { cityKey }) for the city-aware title rule.
    resolveConflictDeterministically(fieldName, valueA, valueB, context = null) {
        const urlA = this.getUrlRuleParts(valueA);
        const urlB = this.getUrlRuleParts(valueB);
        if (urlA && urlB) {
            // Same-host root URL never beats a deeper path: the deeper URL is
            // the event-specific one (observed: the model picked
            // "https://bearracuda.com/" over ".../events/portland-pridefriday/").
            // Different hosts, both deep, or both root still arbitrate.
            if (urlA.host === urlB.host) {
                const rootA = urlA.segments.length === 0 && !urlA.hasQuery;
                const rootB = urlB.segments.length === 0 && !urlB.hasQuery;
                if (rootA && !rootB && urlB.segments.length > 0) {
                    return { winner: 'b', reason: 'same-host deeper URL beats domain root' };
                }
                if (rootB && !rootA && urlA.segments.length > 0) {
                    return { winner: 'a', reason: 'same-host deeper URL beats domain root' };
                }
            }
            // A logo-path image never beats a non-logo image: ticketing
            // services attach their own ".../saas/logos/..." asset, which the
            // model picked over the actual event poster. Matches path
            // components only (never hostname or query); both-or-neither
            // logo-ish still arbitrates (with a prompt rule as backstop).
            if (fieldName === 'image') {
                const hasLogoSegment = (parts) => parts.segments.some(segment => /logo/i.test(segment));
                const logoA = hasLogoSegment(urlA);
                const logoB = hasLogoSegment(urlB);
                if (logoA !== logoB) {
                    return { winner: logoA ? 'b' : 'a', reason: 'event artwork beats logo-path image' };
                }
            }
        }
        // Emoji-stripped title twins are not a conflict: calendar titles
        // deliberately carry emoji (canonical per the calendar contract), so
        // when both titles are identical after stripping emoji (case-sensitive
        // otherwise) the variant WITH the emoji — the longer one — wins.
        // Titles differing in real text still arbitrate.
        if (fieldName === 'title' && typeof valueA === 'string' && typeof valueB === 'string') {
            const strippedA = this.stripEmojiForTitleTwin(valueA);
            if (strippedA && strippedA === this.stripEmojiForTitleTwin(valueB) && valueA.length !== valueB.length) {
                return {
                    winner: valueA.length > valueB.length ? 'a' : 'b',
                    reason: 'emoji title variant beats its emoji-stripped twin'
                };
            }
            // A bare city is not an event name: when exactly one side's title is
            // just the event's city (per isCityOnlyTitle), the named side wins.
            // MUST run after the emoji-twin rule above — twins like "New Orleans"
            // vs "New Orleans⚜️" are BOTH city-only, and the emoji variant should
            // win there rather than tie through this rule. Two named titles (or
            // two bare-city titles) still arbitrate.
            const cityKey = context && context.cityKey;
            if (cityKey) {
                const cityOnlyA = this.isCityOnlyTitle(valueA, cityKey);
                const cityOnlyB = this.isCityOnlyTitle(valueB, cityKey);
                if (cityOnlyA !== cityOnlyB) {
                    return {
                        winner: cityOnlyA ? 'b' : 'a',
                        reason: 'named title beats bare city title'
                    };
                }
            }
        }
        // Case-only variants are not a real conflict: production runs burned
        // 1.5–7s AI arbitrations on bar="NOVA PDX" vs "Nova PDX" and
        // title="TREASURE TRAIL Portland PRIDE" vs "Treasure Trail Portland
        // PRIDE" — and the model picked inconsistently between runs. When the
        // two strings are identical after trimming, collapsing whitespace, and
        // case-folding, keep the LESS-uppercased (less shouty) variant; on an
        // uppercase-count tie keep valueA (the existing/calendar side, for
        // stability). MUST run after the more specific rules above (URL depth,
        // emoji-twin, city-only title, image logo) so those keep priority.
        // Genuinely different text still arbitrates.
        if (typeof valueA === 'string' && typeof valueB === 'string') {
            const collapseWhitespace = value => value.replace(/\s+/g, ' ').trim();
            const collapsedA = collapseWhitespace(valueA);
            const collapsedB = collapseWhitespace(valueB);
            if (collapsedA && collapsedB && collapsedA.toLowerCase() === collapsedB.toLowerCase()) {
                const countUppercase = value => (value.match(/\p{Lu}/gu) || []).length;
                return {
                    winner: countUppercase(collapsedB) < countUppercase(collapsedA) ? 'b' : 'a',
                    reason: 'case-only variants — kept less-uppercased form'
                };
            }
        }
        return null;
    }

    // One batched request per merged event. conflicts: [{ field, values: { <labelA>:
    // raw, <labelB>: raw } }]. Returns { [field]: { pick, reason } } containing only
    // fields whose answer survived the verbatim gate, or null when no usable response
    // was obtained at all (caller falls back for everything).
    async arbitrateMergeConflicts({ conflicts, labels, aiConfig, httpAdapter, eventContext = '', organizer = '' }) {
        const list = Array.isArray(conflicts) ? conflicts.filter(Boolean) : [];
        if (list.length === 0) return null;
        if (!aiConfig || aiConfig.enabled === false || aiConfig.arbitrateMerges === false) return null;
        if (!httpAdapter || typeof httpAdapter.postJson !== 'function') return null;
        const [labelA, labelB] = labels;

        const serializedByField = {};
        const conflictLines = [];
        for (const conflict of list) {
            const serializedA = this.serializeArbitrationValue(conflict.field, conflict.values[labelA]);
            const serializedB = this.serializeArbitrationValue(conflict.field, conflict.values[labelB]);
            serializedByField[conflict.field] = { [labelA]: serializedA, [labelB]: serializedB };
            conflictLines.push(`- field: ${conflict.field}\n  ${labelA}: ${JSON.stringify(serializedA)}\n  ${labelB}: ${JSON.stringify(serializedB)}`);
        }

        const prompt = [
            'You are resolving merge conflicts between two records of the SAME event.',
            eventContext ? `EVENT: ${eventContext}` : '',
            `Record "${labelA}" and record "${labelB}" each provide a value for the fields below.`,
            '',
            'For each field, pick the value that is more correct, complete, and canonical',
            '(official names, full addresses, complete URLs, correctly formatted values).',
            '',
            'CONFLICTS:',
            ...conflictLines,
            '',
            'Rules:',
            '- You MUST copy one of the two provided values EXACTLY. Never invent, edit, merge, or reformat a value.',
            '- "bar" must be the physical venue where the event takes place — never the promoter, organizer, or brand whose name appears in page titles.',
            organizer ? `- KNOWN ORGANIZER: ${JSON.stringify(String(organizer))} — never pick a bar value equal to the organizer.` : '',
            '- For "title", prefer the actual event name — do not prefer a variant just because it appends status text (e.g. sold-out notices) or site branding.',
            '- For "title", a bare city name is not an event name — prefer the variant that names the event or its organizer.',
            '- For "image", prefer event-specific promotional artwork over site or ticketing-service logos.',
            `- "pick" must be "${labelA}" or "${labelB}".`,
            'Return JSON only:',
            `{"choices": {"<field>": {"pick": "${labelA}" or "${labelB}", "value": "<exact copy of the chosen value>", "reason": "<one short sentence>"}}}`
        ].filter(line => line !== '').join('\n');

        const arbitrationConfig = { ...aiConfig, numPredict: Math.min(Number(aiConfig.numPredict) || 800, 800) };
        const rawResponse = await this.callAiGenerate(arbitrationConfig, prompt, 'merge-arbitration', httpAdapter);
        if (!rawResponse) return null;

        let parsed = null;
        try {
            parsed = JSON.parse(this.extractFirstJsonObject(rawResponse) || rawResponse);
        } catch (_) {
            return null;
        }
        if (!parsed || typeof parsed !== 'object') return null;
        const choices = parsed.choices && typeof parsed.choices === 'object' ? parsed.choices : parsed;

        const results = {};
        for (const conflict of list) {
            const field = conflict.field;
            const entry = choices[field];
            const serialized = serializedByField[field];
            if (!entry || typeof entry !== 'object') {
                console.warn(`🤝 AI MERGE: no answer for field "${field}" — falling back`);
                continue;
            }
            const answer = String(entry.value === null || entry.value === undefined ? '' : entry.value).trim();
            const pick = String(entry.pick || '').trim();
            const reason = typeof entry.reason === 'string' ? entry.reason : '';
            const matchesA = this.arbitrationValuesEqual(field, answer, serialized[labelA]);
            const matchesB = this.arbitrationValuesEqual(field, answer, serialized[labelB]);

            if (labels.includes(pick) && this.arbitrationValuesEqual(field, answer, serialized[pick])) {
                results[field] = { pick, reason };
            } else if (matchesA !== matchesB) {
                // Wrong/missing pick label but the value is provably one of the options
                const recoveredPick = matchesA ? labelA : labelB;
                console.warn(`🤝 AI MERGE: pick/value mismatch for "${field}" — trusting the verbatim value (${recoveredPick})`);
                results[field] = { pick: recoveredPick, reason };
            } else {
                console.warn(`🤝 AI MERGE: rejected answer for "${field}" — not a verbatim copy of either option ("${answer.slice(0, 80)}") — falling back`);
            }
        }
        return results;
    }

    // Schema.org Event and its subtypes (MusicEvent, DanceEvent, Festival, ...).
    // EventSeries is excluded: a series node describes many dates, not one event.
    isJsonLdEventType(typeValue) {
        const types = Array.isArray(typeValue) ? typeValue : [typeValue];
        return types.some(value => {
            const name = String(value || '').replace(/^https?:\/\/schema\.org\//i, '').trim();
            if (!name || /^EventSeries$/i.test(name)) return false;
            return /Event$/i.test(name) || /^Festival$/i.test(name);
        });
    }

    // Collect JSON-LD nodes that describe a concrete event: an Event-typed node
    // with both a name and a startDate. Walks @graph/list containers so wrapped
    // and nested markup (WordPress @graph, ItemList, festival subEvents) is found.
    extractJsonLdEventNodes(html) {
        const nodes = [];
        const source = String(html || '');
        if (!source.includes('ld+json')) return nodes;
        const scriptPattern = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let match;
        while ((match = scriptPattern.exec(source)) !== null) {
            let parsed;
            try {
                parsed = JSON.parse(match[1].trim());
            } catch (_) {
                continue;
            }
            this.collectJsonLdEventNodes(parsed, nodes, 0);
        }
        return nodes;
    }

    collectJsonLdEventNodes(node, results, depth) {
        if (!node || depth > 6) return;
        if (Array.isArray(node)) {
            for (const child of node) this.collectJsonLdEventNodes(child, results, depth + 1);
            return;
        }
        if (typeof node !== 'object') return;
        const hasName = typeof node.name === 'string' && node.name.trim().length > 0;
        const hasStartDate = typeof node.startDate === 'string' && node.startDate.trim().length > 0;
        if (this.isJsonLdEventType(node['@type']) && hasName && hasStartDate) {
            results.push(node);
        }
        for (const key of ['@graph', 'mainEntity', 'subEvent', 'itemListElement', 'item', 'events']) {
            if (node[key]) this.collectJsonLdEventNodes(node[key], results, depth + 1);
        }
    }

    // Baked-in platform knowledge: URL shapes that are the same on every site.
    // These sit BENEATH config rules (config is checked first), so a config rule
    // matching the same URL always wins.
    getBuiltInPageClassificationRules() {
        return [
            { pattern: /eventbrite\.com\/e\//i, classification: 'event-page' },
            { pattern: /eventbrite\.com\/o\//i, classification: 'multi-event-page' },
            { pattern: /linktr\.ee/i, classification: 'link-aggregator' }
        ];
    }

    // Classify a URL using ONLY the URL pattern rules (config + built-ins, first
    // match wins) — no HTML heuristics. Returns null when no rule matches.
    classifyUrlByRules(url) {
        if (!url) return null;
        for (const rule of this.pageClassificationRules) {
            if (this.pageClassificationRuleMatchesUrl(rule, url)) {
                return rule.classification;
            }
        }
        return null;
    }

    normalizePageClassificationRules(rules) {
        if (!Array.isArray(rules)) {
            return [];
        }
        const normalized = [];
        for (let i = 0; i < rules.length; i++) {
            const rule = rules[i];
            if (!rule || typeof rule !== 'object' || typeof rule.classification !== 'string') {
                this.warnOnce(`page-classification-rule-invalid-${i}`, `⚠️ SharedCore: Skipping invalid page classification rule at index ${i}`);
                continue;
            }
            let pattern = rule.pattern;
            if (typeof pattern === 'string') {
                try {
                    const regexLiteralMatch = pattern.match(/^\/([\s\S]*)\/([a-z]*)$/);
                    if (regexLiteralMatch) {
                        pattern = new RegExp(regexLiteralMatch[1], regexLiteralMatch[2]);
                    } else {
                        pattern = new RegExp(pattern, 'i');
                    }
                } catch (error) {
                    this.warnOnce(`page-classification-rule-pattern-${i}`, `⚠️ SharedCore: Invalid page classification pattern at index ${i}: ${error.message}`);
                    continue;
                }
            } else if (pattern instanceof RegExp || Object.prototype.toString.call(pattern) === '[object RegExp]') {
                try {
                    pattern = new RegExp(pattern.source, pattern.flags);
                } catch (error) {
                    this.warnOnce(`page-classification-rule-pattern-${i}`, `⚠️ SharedCore: Failed to compile page classification regex at index ${i}: ${error.message}`);
                    continue;
                }
            } else {
                this.warnOnce(`page-classification-rule-pattern-type-${i}`, `⚠️ SharedCore: Skipping page classification rule ${i} - pattern must be RegExp or string`);
                continue;
            }
            normalized.push({
                classification: rule.classification,
                pattern: pattern
            });
        }
        return normalized;
    }

    pageClassificationRuleMatchesUrl(rule, url) {
        if (!rule || !(rule.pattern instanceof RegExp)) {
            return false;
        }
        if (rule.pattern.global || rule.pattern.sticky) {
            rule.pattern.lastIndex = 0;
        }
        return rule.pattern.test(url);
    }

    normalizeParserName(parserName) {
        if (parserName === null || parserName === undefined) return null;
        const normalized = String(parserName).trim().toLowerCase();
        return normalized.length > 0 ? normalized : null;
    }

    resolveAutomationContext(config) {
        const runtime = config && typeof config === 'object'
            ? (config.runtime || config.runContext || {})
            : {};
        const automationRun = runtime.automationRun === true || runtime.type === 'automated';
        const filterParsers = automationRun && runtime.automationFilter !== false;
        return {
            automationRun,
            filterParsers
        };
    }

    evaluateAutomationForParser(parserConfig, automationContext) {
        if (!automationContext || !automationContext.filterParsers) {
            return { shouldRun: true, reason: null };
        }
        // automationEnabled defaults to true — only an explicit false opts a
        // parser out of automation runs (absence used to mean "opted out").
        if (!parserConfig || parserConfig.automationEnabled === false) {
            return { shouldRun: false, reason: 'automation-disabled' };
        }
        return { shouldRun: true, reason: null };
    }

    // Pure business logic for processing events
    async processEvents(config, httpAdapter, displayAdapter, parsers) {
        const parserCount = config.parsers?.length || 0;
        await displayAdapter.logInfo(`SYSTEM: Starting event processing (${parserCount} parsers)`);
        
        const results = {
            totalEvents: 0,
            rawBearEvents: 0,
            bearEvents: 0,
            duplicatesRemoved: 0,
            errors: [],
            parserResults: [],
            allProcessedEvents: [] // All events ready for calendar
        };
        const disabledParsers = [];
        const automationContext = this.resolveAutomationContext(config);
        const automationSkipped = [];

        // Learned dead-end store: orchestrator loads it into config.deadEndStore
        // and saves results.deadEndStore back when results.deadEndStoreChanged.
        this.deadEndRunContext = this.createDeadEndRunContext(config);
        if (this.deadEndRunContext.disabledExplicitly) {
            await displayAdapter.logInfo('SYSTEM: Dead-end store disabled (deadEndRetryDays ≤ 0) — no URLs skipped or learned');
        }

        if (!config.parsers || config.parsers.length === 0) {
            await displayAdapter.logWarn('SYSTEM: No parser configurations found in config');
            await this.finalizeDeadEndRun(displayAdapter, results);
            return results;
        }

        // Global URL tracking across all parsers to prevent duplicate processing
        const globalProcessedUrls = new Set();

        for (let i = 0; i < config.parsers.length; i++) {
            const parserConfig = config.parsers[i];
            
            // "enabled" is for manual runs only; automation runs use automation.automationEnabled
            if (!automationContext.filterParsers && parserConfig.enabled === false) {
                disabledParsers.push(parserConfig.name);
                continue;
            }

            const automationDecision = this.evaluateAutomationForParser(parserConfig, automationContext);
            if (!automationDecision.shouldRun) {
                const reason = automationDecision.reason || 'unspecified';
                automationSkipped.push({ name: parserConfig.name, reason });
                continue;
            }
            
            try {
                await displayAdapter.logInfo(`SYSTEM: Parser ${i + 1}/${parserCount}: ${parserConfig.name}`);
                
                const parserResult = await this.processParser(parserConfig, config, httpAdapter, displayAdapter, parsers, globalProcessedUrls);
                results.parserResults.push(parserResult);
                results.totalEvents += parserResult.totalEvents;
                results.rawBearEvents += parserResult.rawBearEvents;
                results.bearEvents += parserResult.bearEvents;
                results.duplicatesRemoved += parserResult.duplicatesRemoved;
                
                // Collect all processed events
                if (parserResult.events && parserResult.events.length > 0) {
                    // Add parser config reference to each event for later use — the
                    // effective config, so inherited global ai/ocr blocks travel with
                    // the event into cross-parser dedupe and merge arbitration
                    const stampedConfig = parserResult.config || parserConfig;
                    parserResult.events.forEach((event, index, arr) => {
                        if (!Object.isExtensible(event)) {
                            event = { ...event };
                            arr[index] = event;
                        }
                        event._parserConfig = stampedConfig;
                    });
                    results.allProcessedEvents.push(...parserResult.events);
                }
                
                await displayAdapter.logSuccess(`SYSTEM: ${parserConfig.name}: ${parserResult.bearEvents} bear events`);
                
            } catch (error) {
                const errorMsg = `SYSTEM: Failed to process ${parserConfig.name}: ${error.message || 'Unknown error'}`;
                results.errors.push(errorMsg);
                await displayAdapter.logError(errorMsg);
                // Only log stack trace if it exists and is meaningful
                if (error.stack && error.stack.trim()) {
                    await displayAdapter.logError(`SYSTEM: Stack trace for ${parserConfig.name}: ${error.stack}`);
                }
            }
        }

        if (disabledParsers.length > 0) {
            await displayAdapter.logInfo(`SYSTEM: Skipped disabled parsers: ${disabledParsers.join(', ')}`);
        }

        if (automationContext.filterParsers) {
            if (automationSkipped.length > 0) {
                const skippedLabel = automationSkipped
                    .map(item => `${item.name} (${item.reason})`)
                    .join(', ');
                await displayAdapter.logInfo(`SYSTEM: Skipped parsers (automation): ${skippedLabel}`);
            } else {
                await displayAdapter.logInfo('SYSTEM: Running all automation-enabled parsers');
            }
            results.automationSkippedParsers = automationSkipped;
        }

        await this.finalizeDeadEndRun(displayAdapter, results);

        const duplicateSummary = results.duplicatesRemoved > 0
            ? ` (removed ${results.duplicatesRemoved} dupes)`
            : ' (no duplicates)';
        await displayAdapter.logInfo(`SYSTEM: Processing complete. Total ${results.totalEvents}; bear ${results.bearEvents}${duplicateSummary}`);
        return results;
    }

    async processParser(parserConfig, mainConfig, httpAdapter, displayAdapter, parsers, globalProcessedUrls = new Set()) {
        const effectiveParserConfig = this.applyGlobalAiExtraContext(
            this.applyGlobalAiConfidenceDefaults(
                this.resolveEffectiveParserConfig(parserConfig, mainConfig),
                mainConfig
            ),
            mainConfig
        );

        // Parser dispatch contract: an explicit parser name pins EVERY crawled URL
        // (including discovered ones) to that parser, and omitting `parser` defaults
        // to 'ai-web', equally pinned. The legacy absence behavior is opt-in via
        // parser: "auto" — detectParserFromUrl picks a site-specific parser
        // (bearracuda/chunk/linktree/redeyetickets/scriptable-input) from the first
        // URL, and discovered URLs may auto-SWITCH parser per URL during the crawl.
        const configuredParserName = this.normalizeParserName(effectiveParserConfig && effectiveParserConfig.parser);
        const autoDetectParser = configuredParserName === 'auto';
        const allowParserAutoSwitch = autoDetectParser;
        let parserName = autoDetectParser ? null : configuredParserName;
        if (autoDetectParser && effectiveParserConfig.urls && effectiveParserConfig.urls.length > 0) {
            parserName = this.detectParserFromUrl(effectiveParserConfig.urls[0]);
        }

        // Default to the generic parser (absent/empty parser, or "auto" without URLs)
        if (!parserName) {
            parserName = 'ai-web';
        }
        
        const parser = parsers[parserName];
        
        if (!parser) {
            await displayAdapter.logError(`SYSTEM: Parser '${parserName}' not found in available parsers: ${Object.keys(parsers).join(', ')}`);
            throw new Error(`Parser '${parserName}' not found`);
        }

        const urlCount = effectiveParserConfig.urls?.length || 0;
        const urlSuffix = urlCount === 1 ? `: ${effectiveParserConfig.urls[0]}` : '';
        await displayAdapter.logInfo(`SYSTEM: ${effectiveParserConfig.name} → ${parserName} (${urlCount} URL${urlCount === 1 ? '' : 's'})${urlSuffix}`);
        
        const parserStartedAt = Date.now();
        const allEvents = [];
        const urlClassifications = {};
        const hasInlineInput = effectiveParserConfig.input && typeof effectiveParserConfig.input === 'object';
        // Use global processedUrls to prevent duplicate processing across all parsers

        const discoveryOnly = effectiveParserConfig.discoveryOnly === true;
        // Absent urlDiscoveryDepth → adaptive crawling: each page's classification
        // decides whether its links are followed. An explicit numeric depth
        // (including 0) keeps the exact legacy fixed-depth behavior.
        const configuredDepth = effectiveParserConfig.urlDiscoveryDepth;
        const adaptiveDepth = configuredDepth === undefined || configuredDepth === null;
        const maxDepth = adaptiveDepth ? ADAPTIVE_CRAWL_DEPTH : configuredDepth;
        if (discoveryOnly) {
            await displayAdapter.logInfo(`SYSTEM: ${effectiveParserConfig.name} → Discovery only mode (depth ${adaptiveDepth ? 'adaptive' : maxDepth})`);
        } else if (adaptiveDepth) {
            await displayAdapter.logInfo(`SYSTEM: ${effectiveParserConfig.name} → adaptive crawl depth`);
        }

        const discoveryTreeCollector = discoveryOnly
            ? {
                rootUrls: [],
                rootUrlSet: new Set(),
                allNodes: new Set(),
                edges: [],
                segmentsByUrl: {},
                socialLinks: {},
                organizer: null
            }
            : null;

        await this.crawlUrlsForEvents({
            urls: effectiveParserConfig.urls || [],
            allEvents,
            parsers,
            parserConfig: effectiveParserConfig,
            httpAdapter,
            displayAdapter,
            processedUrls: globalProcessedUrls,
            maxDepth,
            currentDepth: 0,
            parserName,
            allowParserAutoSwitch,
            mainConfig,
            urlClassifications,
            includeInlineInput: hasInlineInput,
            discoveryOnly,
            discoveryTreeCollector
        });

        // Metadata is applied dynamically by parsers using the {value, merge} format

        // Filter and process events
        const futureEvents = this.filterFutureEvents(allEvents, effectiveParserConfig.daysToLookAhead, effectiveParserConfig.allowPastEvents);
        const bearEvents = await this.filterBearEvents(futureEvents, effectiveParserConfig, httpAdapter);
        const deduplicatedEvents = await this.deduplicateEvents(bearEvents, httpAdapter, mainConfig?.config || mainConfig || null);
        
        // Calculate deduplication stats
        const duplicatesRemoved = bearEvents.length - deduplicatedEvents.length;
        
        await displayAdapter.logInfo(`SYSTEM: Event filtering complete: ${allEvents.length} → ${futureEvents.length} future → ${bearEvents.length} bear → ${deduplicatedEvents.length} final`);

        const result = {
            name: effectiveParserConfig.name,
            parserType: parserName,
            urlCount,
            totalEvents: allEvents.length,
            rawBearEvents: bearEvents.length,
            bearEvents: deduplicatedEvents.length,
            duplicatesRemoved: duplicatesRemoved,
            durationMs: Date.now() - parserStartedAt,
            events: deduplicatedEvents,
            urlClassifications,
            config: effectiveParserConfig // Include config for orchestrator to use
        };

        if (discoveryOnly && discoveryTreeCollector) {
            const discoveryTree = {
                rootUrls: discoveryTreeCollector.rootUrls,
                edges: discoveryTreeCollector.edges,
                allNodes: [...discoveryTreeCollector.allNodes],
                segmentsByUrl: discoveryTreeCollector.segmentsByUrl
            };
            result.discoveryOnly = true;
            result.discoveryTree = discoveryTree;
            result.mermaidGraph = this.buildMermaidGraph(discoveryTree);
            result.asciiTree = this.buildAsciiTree(discoveryTree);
            const segmentUrlCount = Object.keys(discoveryTree.segmentsByUrl).length;
            const totalSegmentCount = Object.values(discoveryTree.segmentsByUrl).reduce((sum, segs) => sum + segs.length, 0);
            const segmentSuffix = segmentUrlCount > 0 ? `, ${totalSegmentCount} segment(s) on ${segmentUrlCount} multi-event page(s)` : '';
            await displayAdapter.logInfo(`SYSTEM: Discovery complete: ${discoveryTree.allNodes.length} URL(s) found across ${discoveryTree.edges.length} link(s)${segmentSuffix}`);
            const suggestedConfig = this.buildSuggestedParserConfig(effectiveParserConfig, discoveryTreeCollector);
            result.suggestedConfig = suggestedConfig;
            await displayAdapter.logInfo(suggestedConfig);
        }

        return result;
    }

    // Paste-ready parser entry printed after discoveryOnly runs. Only
    // high-confidence lines are included: configured root URLs always; social
    // links and organizer website only when harvested from the crawled pages.
    buildSuggestedParserConfig(parserConfig, collector = null) {
        const name = parserConfig && typeof parserConfig.name === 'string' && parserConfig.name.trim()
            ? parserConfig.name.trim()
            : 'New Site';
        const rootUrls = Array.isArray(parserConfig && parserConfig.urls) ? parserConfig.urls : [];
        const organizer = collector && collector.organizer && typeof collector.organizer === 'object'
            ? collector.organizer
            : null;
        const socialLinks = collector && collector.socialLinks && typeof collector.socialLinks === 'object'
            ? collector.socialLinks
            : {};
        const organizerName = organizer && typeof organizer.name === 'string' ? organizer.name.trim() : '';
        const organizerUrl = organizer && typeof organizer.url === 'string' ? organizer.url.trim() : '';
        const shortName = (organizerName || name).toUpperCase();

        const lines = [];
        lines.push(`📋 SUGGESTED CONFIG for "${name}" — paste into parsers[] in scraper-input.js:`);
        lines.push('{');
        lines.push(`  name: ${JSON.stringify(name)},`);
        lines.push('  enabled: false, // flip on after a dry-run preview looks right');
        lines.push(`  urls: [${rootUrls.map(url => JSON.stringify(url)).join(', ')}],`);
        lines.push('  alwaysBear: false, // set true for trusted bear promoters (AI trust context)');
        lines.push('  metadata: {');
        lines.push(`    shortName: { value: ${JSON.stringify(shortName)} }, // add a hyphen where it should line-break`);
        if (socialLinks.instagram) {
            lines.push(`    instagram: { value: ${JSON.stringify(socialLinks.instagram)} }, // found on page`);
        }
        if (socialLinks.facebook) {
            lines.push(`    facebook: { value: ${JSON.stringify(socialLinks.facebook)} }, // found on page`);
        }
        if (organizerUrl) {
            lines.push(`    website: { value: ${JSON.stringify(organizerUrl)} }, // found on page`);
        }
        lines.push('  },');
        lines.push('},');
        return lines.join('\n');
    }

    // Baked-in platform confidence expectations: Eventbrite /e/ event pages ship
    // complete JSON-LD (offers → cover, image, ticketUrl) and reliable location
    // meta tags. Merged BENEATH config-provided aiConfidenceDefaults, which are in
    // turn beneath per-parser blocks — later urlPatterns entries win in
    // getAiConfidenceExpectations, so config extends/overrides the built-ins.
    getBuiltInAiConfidenceDefaults() {
        return {
            confidence: {
                expectations: {
                    urlPatterns: [
                        {
                            pattern: '^https?://(?:www\\.)?eventbrite\\.com/e/',
                            fields: {
                                cover: { expected: ['jsonld'], strong: ['jsonld'] },
                                image: { expected: ['jsonld'], strong: ['jsonld'] },
                                ticketUrl: { expected: ['jsonld'], strong: ['jsonld'] },
                                location: { expected: ['meta'], strong: ['meta'] }
                            }
                        }
                    ]
                }
            }
        };
    }

    // Merge one confidence block beneath another: override keys win key-wise for
    // confidence/expectations/fields; urlPatterns concatenate base-first (later
    // entries win at consumption time, so override extends/overrides base).
    mergeAiConfidenceLayers(baseConfidence, overrideConfidence) {
        const base = baseConfidence && typeof baseConfidence === 'object' ? baseConfidence : {};
        const override = overrideConfidence && typeof overrideConfidence === 'object' ? overrideConfidence : {};

        const baseExpectations = base.expectations && typeof base.expectations === 'object'
            ? base.expectations
            : {};
        const overrideExpectations = override.expectations && typeof override.expectations === 'object'
            ? override.expectations
            : {};
        const baseFields = baseExpectations.fields && typeof baseExpectations.fields === 'object'
            ? baseExpectations.fields
            : {};
        const overrideFields = overrideExpectations.fields && typeof overrideExpectations.fields === 'object'
            ? overrideExpectations.fields
            : {};

        const baseUrlPatterns = Array.isArray(baseExpectations.urlPatterns) ? baseExpectations.urlPatterns : [];
        const overrideUrlPatterns = Array.isArray(overrideExpectations.urlPatterns) ? overrideExpectations.urlPatterns : [];

        const mergedExpectations = {
            ...baseExpectations,
            ...overrideExpectations
        };
        if (Object.keys(baseFields).length > 0 || Object.keys(overrideFields).length > 0) {
            mergedExpectations.fields = {
                ...baseFields,
                ...overrideFields
            };
        }
        if (baseUrlPatterns.length > 0 || overrideUrlPatterns.length > 0) {
            mergedExpectations.urlPatterns = [...baseUrlPatterns, ...overrideUrlPatterns];
        }

        return {
            ...base,
            ...override,
            expectations: mergedExpectations
        };
    }

    applyGlobalAiConfidenceDefaults(parserConfig, mainConfig) {
        const parser = parserConfig && typeof parserConfig === 'object' ? parserConfig : {};
        const globalDefaults = mainConfig
            && mainConfig.config
            && mainConfig.config.aiConfidenceDefaults
            && typeof mainConfig.config.aiConfidenceDefaults === 'object'
            ? mainConfig.config.aiConfidenceDefaults
            : null;

        const builtInConfidence = this.getBuiltInAiConfidenceDefaults().confidence;
        const globalConfidence = globalDefaults
            && globalDefaults.confidence
            && typeof globalDefaults.confidence === 'object'
            ? globalDefaults.confidence
            : null;

        // Layering (lowest first): built-in platform defaults < global config < parser
        const effectiveGlobalConfidence = globalConfidence
            ? this.mergeAiConfidenceLayers(builtInConfidence, globalConfidence)
            : builtInConfidence;

        const parserAi = parser.ai && typeof parser.ai === 'object' ? parser.ai : {};
        const parserConfidence = parserAi.confidence && typeof parserAi.confidence === 'object'
            ? parserAi.confidence
            : {};

        const mergedConfidence = this.mergeAiConfidenceLayers(effectiveGlobalConfidence, parserConfidence);

        return {
            ...parser,
            ai: {
                ...parserAi,
                confidence: mergedConfidence
            }
        };
    }

    // Global ai.extraContext default (config.ai.extraContext): extra text appended
    // verbatim to every extraction prompt. A parser's own ai.extraContext — even an
    // explicit empty string — overrides the global value.
    applyGlobalAiExtraContext(parserConfig, mainConfig) {
        const parser = parserConfig && typeof parserConfig === 'object' ? parserConfig : {};
        const globalAi = mainConfig && mainConfig.config && mainConfig.config.ai && typeof mainConfig.config.ai === 'object'
            ? mainConfig.config.ai
            : null;
        const globalExtraContext = globalAi && typeof globalAi.extraContext === 'string' ? globalAi.extraContext : '';
        if (!globalExtraContext) return parser;
        const parserAi = parser.ai && typeof parser.ai === 'object' ? parser.ai : {};
        if (typeof parserAi.extraContext === 'string') return parser;
        return {
            ...parser,
            ai: {
                ...parserAi,
                extraContext: globalExtraContext
            }
        };
    }

    // Defensive deep merge for config blocks: override keys win, nested plain
    // objects merge key-wise, and everything else (arrays, primitives, RegExp,
    // null) replaces as-is rather than merging.
    deepMergeConfig(base, override) {
        const isPlainObject = value => Boolean(value)
            && typeof value === 'object'
            && !Array.isArray(value)
            && !(value instanceof RegExp);
        if (!isPlainObject(base)) {
            return override === undefined ? base : override;
        }
        if (!isPlainObject(override)) {
            return override === undefined ? { ...base } : override;
        }
        const merged = { ...base };
        Object.keys(override).forEach(key => {
            merged[key] = isPlainObject(merged[key]) && isPlainObject(override[key])
                ? this.deepMergeConfig(merged[key], override[key])
                : override[key];
        });
        return merged;
    }

    // Global → parser config inheritance: every parser inherits the global
    // config.ai and config.ocr blocks (per-parser keys win key-wise; arrays
    // replace, not concat), and the global config.discoveryBlockedPatterns list
    // is unioned with the parser's own. When no global block exists the parser
    // entry is returned untouched, so behavior without global config is
    // identical to the pre-inheritance code paths (parser defaults unchanged).
    resolveEffectiveParserConfig(parserConfig, mainConfig) {
        const parser = parserConfig && typeof parserConfig === 'object' ? parserConfig : {};
        const globalConfig = mainConfig && mainConfig.config && typeof mainConfig.config === 'object'
            ? mainConfig.config
            : {};
        const globalAi = globalConfig.ai && typeof globalConfig.ai === 'object' ? globalConfig.ai : null;
        const globalOcr = globalConfig.ocr && typeof globalConfig.ocr === 'object' ? globalConfig.ocr : null;
        const globalBlockedPatterns = Array.isArray(globalConfig.discoveryBlockedPatterns) && globalConfig.discoveryBlockedPatterns.length > 0
            ? globalConfig.discoveryBlockedPatterns
            : null;
        if (!globalAi && !globalOcr && !globalBlockedPatterns) return parser;

        const parserAi = parser.ai && typeof parser.ai === 'object' ? parser.ai : null;
        const effective = { ...parser };
        if (globalAi) {
            effective.ai = this.deepMergeConfig(globalAi, parserAi || {});
        }
        if (globalOcr) {
            // Same precedence getOcrConfig uses: a parser's ai.ocr wins over its
            // top-level ocr block; the merged result lands in the slot the parser
            // used (or top-level ocr when it configured neither).
            const parserAiOcr = parserAi && parserAi.ocr && typeof parserAi.ocr === 'object' ? parserAi.ocr : null;
            const parserTopOcr = parser.ocr && typeof parser.ocr === 'object' ? parser.ocr : null;
            const mergedOcr = this.deepMergeConfig(globalOcr, parserAiOcr || parserTopOcr || {});
            if (parserAiOcr) {
                effective.ai = { ...(effective.ai || parserAi), ocr: mergedOcr };
            } else {
                effective.ocr = mergedOcr;
            }
        }
        if (globalBlockedPatterns) {
            const parserPatterns = Array.isArray(parser.discoveryBlockedPatterns)
                ? parser.discoveryBlockedPatterns
                : [];
            effective.discoveryBlockedPatterns = [...globalBlockedPatterns, ...parserPatterns];
        }
        return effective;
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

    isRetryableFailure(error) {
        if (error && typeof error.retryable === 'boolean') {
            return error.retryable;
        }

        const statusCode = this.extractHttpStatusCodeFromError(error);
        if (typeof statusCode === 'number') {
            return [408, 425, 429, 500, 502, 503, 504].includes(statusCode);
        }

        const message = error && typeof error.message === 'string'
            ? error.message.toLowerCase()
            : '';
        const retryablePatterns = [
            /time(d)?\s*out/i,
            /network request failed/i,
            /failed to fetch/i,
            /connection\s+(lost|reset|refused)/i,
            /dns/i,
            /socket/i,
            /temporary/i,
            /unavailable/i,
            /econnreset/i,
            /enotfound/i,
            /eai_again/i
        ];
        return retryablePatterns.some(pattern => pattern.test(message));
    }

    async saveNonRetryableFailureNote(httpAdapter, url, error, context) {
        if (this.isRetryableFailure(error)) {
            return false;
        }
        if (!httpAdapter || typeof httpAdapter.saveFailureNote !== 'function') {
            return false;
        }
        await httpAdapter.saveFailureNote(url, error, {
            context,
            retryable: false,
            statusCode: this.extractHttpStatusCodeFromError(error)
        });
        return true;
    }

    async crawlUrlsForEvents({
        urls,
        allEvents,
        parsers,
        parserConfig,
        httpAdapter,
        displayAdapter,
        processedUrls,
        maxDepth = 1,
        currentDepth = 0,
        mainConfig = null,
        parserName = null,
        allowParserAutoSwitch = true,
        urlClassifications = null,
        includeInlineInput = false,
        discoveryOnly = false,
        discoveryTreeCollector = null
    }) {
        const adaptiveCrawl = maxDepth === ADAPTIVE_CRAWL_DEPTH;
        const urlsToProcess = currentDepth > 0
            ? this.limitAdditionalUrls(urls, parserConfig)
            : (Array.isArray(urls) ? urls : []);

        if (currentDepth > 0) {
            await displayAdapter.logInfo(adaptiveCrawl
                ? `SYSTEM: Crawling ${urlsToProcess.length} discovered URLs (depth ${currentDepth}, adaptive)`
                : `SYSTEM: Crawling ${urlsToProcess.length} discovered URLs (depth ${currentDepth}/${maxDepth})`);
        }

        for (let i = 0; i < urlsToProcess.length; i++) {
            const rawUrl = urlsToProcess[i];
            const url = this.normalizeUrl(rawUrl, rawUrl);
            if (!url) {
                if (currentDepth === 0) {
                    await displayAdapter.logWarn(`SYSTEM: Skipping invalid URL: ${rawUrl}`);
                }
                continue;
            }

            if (discoveryTreeCollector) {
                if (currentDepth === 0 && !discoveryTreeCollector.rootUrlSet.has(url)) {
                    discoveryTreeCollector.rootUrlSet.add(url);
                    discoveryTreeCollector.rootUrls.push(url);
                }
                discoveryTreeCollector.allNodes.add(url);
            }
            if (this.hasProcessedUrl(processedUrls, url)) {
                if (currentDepth === 0) {
                    await displayAdapter.logWarn(`SYSTEM: Skipping duplicate URL (already processed globally): ${url}`);
                }
                continue;
            }

            this.markProcessedUrl(processedUrls, url);

            try {
                const shouldUseInlineInput = includeInlineInput &&
                    currentDepth === 0 &&
                    i === 0 &&
                    parserConfig.input &&
                    typeof parserConfig.input === 'object';
                if (shouldUseInlineInput) {
                    await displayAdapter.logInfo('SYSTEM: Using inline URL input payload');
                }

                const htmlData = shouldUseInlineInput
                    ? { html: '', url, statusCode: 200, headers: {}, input: parserConfig.input }
                    : await httpAdapter.fetchData(url);

                // Adaptive mode keeps urlDiscoveryDepth ABSENT on per-page configs
                // (absence is what signals adaptive to parsers); numeric mode passes
                // the remaining depth budget down exactly as before.
                const perPageParserConfig = currentDepth === 0 || adaptiveCrawl
                    ? parserConfig
                    : {
                        ...parserConfig,
                        urlDiscoveryDepth: Math.max(0, maxDepth - currentDepth)
                    };

                const { pageClassification, parseResult, urlParserName } = await this.parsePageForCrawl({
                    url,
                    htmlData,
                    parsers,
                    parserName,
                    allowParserAutoSwitch,
                    parserConfig: perPageParserConfig,
                    mainConfig,
                    displayAdapter,
                    httpAdapter
                });

                if (currentDepth === 0 && urlClassifications && typeof urlClassifications === 'object') {
                    urlClassifications[url] = pageClassification;
                }

                const eventCount = discoveryOnly ? 0 : (parseResult?.events?.length || 0);
                const linkCount = parseResult?.additionalLinks?.length || 0;
                const segmentCount = discoveryOnly && Array.isArray(parseResult?.discoveredSegments) ? parseResult.discoveredSegments.length : 0;
                const linkSuffix = linkCount > 0 ? `, ${linkCount} link${linkCount === 1 ? '' : 's'}` : '';
                const segmentSuffix = segmentCount > 0 ? `, ${segmentCount} segment${segmentCount === 1 ? '' : 's'}` : '';
                await displayAdapter.logInfo(`SYSTEM: Parsed ${url} → ${eventCount} event${eventCount === 1 ? '' : 's'}${linkSuffix}${segmentSuffix}`);

                if (discoveryTreeCollector && segmentCount > 0) {
                    discoveryTreeCollector.segmentsByUrl[url] = parseResult.discoveredSegments;
                }

                // Harvested onboarding hints (discoveryOnly runs): first-seen wins
                // for each social host and for the JSON-LD organizer.
                if (discoveryTreeCollector) {
                    const harvestedSocial = parseResult?.discoveredSocialLinks;
                    if (harvestedSocial && typeof harvestedSocial === 'object') {
                        for (const [host, link] of Object.entries(harvestedSocial)) {
                            if (link && !discoveryTreeCollector.socialLinks[host]) {
                                discoveryTreeCollector.socialLinks[host] = link;
                            }
                        }
                    }
                    const harvestedOrganizer = parseResult?.discoveredOrganizer;
                    if (harvestedOrganizer && typeof harvestedOrganizer === 'object' && !discoveryTreeCollector.organizer) {
                        discoveryTreeCollector.organizer = harvestedOrganizer;
                    }
                }

                // Learned dead-end store: the page fetched successfully, so record
                // whether it was productive (raw pre-filter counts) or a dead end.
                this.recordDeadEndObservation({ url, currentDepth, parseResult, pageClassification, discoveryOnly });

                if (!discoveryOnly) {
                    const parsedEvents = await this.prepareParsedEvents(parseResult?.events, parserConfig, mainConfig, pageClassification, this.normalizerPipeline, httpAdapter);
                    if (parsedEvents.length > 0) {
                        allEvents.push(...parsedEvents);
                    }
                }

                const additionalLinks = parseResult?.additionalLinks || [];
                let linksToConsider = additionalLinks;
                if (adaptiveCrawl) {
                    // The page's own classification decides which links (if any)
                    // are followed; a hard hop cap bounds runaway chains.
                    linksToConsider = this.selectAdaptiveFollowLinks(pageClassification, additionalLinks, parseResult, url);
                    if (linksToConsider.length > 0 && currentDepth >= ADAPTIVE_CRAWL_MAX_HOPS) {
                        await displayAdapter.logInfo(`SYSTEM: Adaptive crawl: chain cap (${ADAPTIVE_CRAWL_MAX_HOPS} hops) reached at ${url} — not following ${linksToConsider.length} link(s)`);
                        linksToConsider = [];
                    } else if (linksToConsider.length > 0) {
                        await displayAdapter.logInfo(`SYSTEM: Adaptive crawl: following ${linksToConsider.length} links from ${url} (${pageClassification})`);
                    } else if (additionalLinks.length > 0) {
                        await displayAdapter.logInfo(`SYSTEM: Adaptive crawl: stopping at ${url} (${pageClassification})`);
                    }
                }
                if (linksToConsider.length === 0) {
                    continue;
                }

                const deduplicatedUrls = this.deduplicateUrls(linksToConsider, processedUrls);
                const shouldFollowLinks = adaptiveCrawl || currentDepth < maxDepth;

                if (shouldFollowLinks) {
                    if (discoveryTreeCollector) {
                        for (const discoveredUrl of deduplicatedUrls) {
                            discoveryTreeCollector.allNodes.add(discoveredUrl);
                            discoveryTreeCollector.edges.push({ from: url, to: discoveredUrl });
                        }
                    }
                    await displayAdapter.logInfo(
                        currentDepth === 0
                            ? `SYSTEM: Following ${linksToConsider.length} discovered URLs → ${deduplicatedUrls.length} unique for crawl depth ${currentDepth + 1}`
                            : `SYSTEM: Crawl page ${url} found ${linksToConsider.length} URLs → ${deduplicatedUrls.length} unique for depth ${currentDepth + 1}`
                    );
                    // Known dead ends younger than the retry window are skipped
                    // before enqueueing (discoveryOnly always fetches everything).
                    const enqueueUrls = this.filterKnownDeadEndUrls(deduplicatedUrls, discoveryOnly);
                    if (enqueueUrls.length > 0) {
                        await this.crawlUrlsForEvents({
                            urls: enqueueUrls,
                            allEvents,
                            parsers,
                            parserConfig,
                            httpAdapter,
                            displayAdapter,
                            processedUrls,
                            maxDepth,
                            currentDepth: currentDepth + 1,
                            mainConfig,
                            parserName: urlParserName,
                            allowParserAutoSwitch,
                            urlClassifications: null,
                            includeInlineInput: false,
                            discoveryOnly,
                            discoveryTreeCollector
                        });
                    }
                } else {
                    await displayAdapter.logInfo(`SYSTEM: Crawl page ${url} found ${deduplicatedUrls.length} unique additional URLs, but depth limit (${maxDepth}) reached or URL discovery disabled - ignoring`);
                }
            } catch (error) {
                const message = error?.message || 'Unknown error';
                try {
                    if (!(error && error.cachedFailure === true)) {
                        await this.saveNonRetryableFailureNote(
                            httpAdapter,
                            url,
                            error,
                            currentDepth === 0 ? 'root-page' : 'crawl-page'
                        );
                    }
                } catch (noteError) {
                    await displayAdapter.logWarn(`SYSTEM: Failed to save cache entry for non-retryable error at ${url}: ${noteError.message}`);
                }
                if (currentDepth === 0) {
                    await displayAdapter.logError(`SYSTEM: Failed to process URL ${url}: ${message}`);
                    if (error.stack && error.stack.trim()) {
                        await displayAdapter.logError(`SYSTEM: URL processing stack trace: ${error.stack}`);
                    }
                } else {
                    await displayAdapter.logError(`SYSTEM: Failed to process crawl page ${url}: ${message}`);
                    if (error.stack && error.stack.trim()) {
                        await displayAdapter.logError(`SYSTEM: Crawl URL processing stack trace: ${error.stack}`);
                    }
                }
            }
        }
    }

    limitAdditionalUrls(additionalLinks, parserConfig) {
        if (!Array.isArray(additionalLinks) || additionalLinks.length === 0) {
            return [];
        }
        const configuredMaxUrls = parserConfig.maxAdditionalUrls;
        let maxUrls = 12;
        if (configuredMaxUrls === null) {
            maxUrls = Infinity;
        } else if (Number.isInteger(configuredMaxUrls) && configuredMaxUrls >= 0) {
            maxUrls = configuredMaxUrls;
        }
        return Number.isFinite(maxUrls)
            ? additionalLinks.slice(0, maxUrls)
            : additionalLinks;
    }

    // Adaptive crawl follow rules — the parent page's classification decides:
    //   link-aggregator   → follow every valid link (links ARE the payload)
    //   multi-event-page  → follow every valid link (detail pages carry the data)
    //   event-page        → follow ONLY links pre-classifiable as event-page via
    //                       URL rules, plus the page's own extracted ticketUrl(s)
    //   ad / unknown      → follow nothing
    selectAdaptiveFollowLinks(pageClassification, additionalLinks, parseResult, pageUrl) {
        const links = Array.isArray(additionalLinks) ? additionalLinks : [];
        if (pageClassification === 'link-aggregator' || pageClassification === 'multi-event-page') {
            return links;
        }
        if (pageClassification !== 'event-page') {
            return [];
        }
        const selected = [];
        const seen = new Set();
        const push = (candidate) => {
            const normalized = this.normalizeUrl(candidate, pageUrl || candidate);
            if (!normalized || seen.has(normalized)) return;
            seen.add(normalized);
            selected.push(normalized);
        };
        for (const link of links) {
            if (this.classifyUrlByRules(link) === 'event-page') {
                push(link);
            }
        }
        const events = Array.isArray(parseResult?.events) ? parseResult.events : [];
        for (const event of events) {
            const ticketUrl = event && typeof event.ticketUrl === 'string' ? event.ticketUrl.trim() : '';
            if (ticketUrl) {
                push(ticketUrl);
            }
        }
        return selected;
    }

    // ------------------------------------------------------------------
    // Learned dead-end store (pure logic — persistence lives in adapters).
    // A URL is a dead end only if it FETCHED successfully AND produced 0 raw
    // events (pre future/bear filtering), 0 segments, AND 0 valid discovered
    // links. Fetch failures and configured root URLs are never dead-ended.
    // ------------------------------------------------------------------

    createDeadEndRunContext(config) {
        const globalConfig = config && config.config && typeof config.config === 'object' ? config.config : {};
        const raw = globalConfig.deadEndRetryDays;
        let retryDays = 30;
        let disabledExplicitly = false;
        if (raw !== undefined && raw !== null) {
            const parsed = Number(raw);
            if (Number.isFinite(parsed)) {
                if (parsed <= 0) {
                    // Kill switch: non-positive disables the store entirely
                    disabledExplicitly = true;
                } else {
                    retryDays = parsed;
                }
            }
        }
        const store = config && config.deadEndStore && typeof config.deadEndStore === 'object' && !Array.isArray(config.deadEndStore)
            ? config.deadEndStore
            : {};
        return {
            enabled: !disabledExplicitly,
            disabledExplicitly,
            retryDays,
            store,
            dirty: false,
            skippedCount: 0,
            skippedSamples: [],
            learned: [],
            recovered: [],
            prunedCount: 0
        };
    }

    // Drop discovered URLs whose dead-end entry is younger than the retry
    // window. Older entries pass through and get retried once. discoveryOnly
    // runs never skip — discovery is the mapping/debugging mode and must fetch
    // everything (productive pages then self-heal out of the store).
    filterKnownDeadEndUrls(urls, discoveryOnly = false, nowMs = Date.now()) {
        const context = this.deadEndRunContext;
        const list = Array.isArray(urls) ? urls : [];
        if (!context || !context.enabled || discoveryOnly) {
            return list;
        }
        const retryMs = context.retryDays * 24 * 60 * 60 * 1000;
        const allowed = [];
        for (const url of list) {
            const entry = context.store[url];
            const lastSeenMs = entry && entry.lastSeen ? Date.parse(entry.lastSeen) : NaN;
            if (entry && Number.isFinite(lastSeenMs) && (nowMs - lastSeenMs) < retryMs) {
                context.skippedCount += 1;
                if (context.skippedSamples.length < 3 && !context.skippedSamples.includes(url)) {
                    context.skippedSamples.push(url);
                }
                continue;
            }
            allowed.push(url);
        }
        return allowed;
    }

    // Record the outcome of a successfully-fetched page. Productive pages are
    // removed from the store (self-heal); dead pages refresh an existing entry
    // (retry miss) or are learned as new dead ends — never for root URLs.
    // Pages classified 'ad' are ALWAYS dead ends (ads never get extraction or
    // link-following, so re-fetching them is pure waste); 'unknown' pages stay
    // under the strict output rule — that classification is too weak a signal.
    recordDeadEndObservation({ url, currentDepth, parseResult, pageClassification = null, discoveryOnly = false, nowMs = Date.now() }) {
        const context = this.deadEndRunContext;
        if (!context || !context.enabled || !url) {
            return;
        }
        // RAW pre-filter counts: a page whose events are all in the past still
        // produced events — it is NOT a dead end.
        const rawEventCount = Array.isArray(parseResult?.events) ? parseResult.events.length : 0;
        const segmentCount = Array.isArray(parseResult?.discoveredSegments) ? parseResult.discoveredSegments.length : 0;
        const links = parseResult?.additionalLinks;
        // uniqueValidCount (when the parser tags it) counts valid links BEFORE
        // the maxAdditionalUrls budget, so a budget of 0 can't fake a dead end.
        const taggedUniqueValid = Array.isArray(links) ? Number(links.uniqueValidCount) : NaN;
        const uniqueValidLinkCount = Number.isFinite(taggedUniqueValid)
            ? taggedUniqueValid
            : (Array.isArray(links) ? links.length : 0);
        const productive = pageClassification !== 'ad'
            && (rawEventCount > 0 || segmentCount > 0 || uniqueValidLinkCount > 0);

        const store = context.store;
        const entry = store[url];
        if (productive) {
            if (entry) {
                delete store[url];
                context.dirty = true;
                context.recovered.push(url);
            }
            return;
        }
        if (currentDepth === 0) {
            // Configured root URLs are never dead-ended
            return;
        }
        const nowIso = new Date(nowMs).toISOString();
        if (entry) {
            entry.lastSeen = nowIso;
            entry.misses = (Number(entry.misses) || 0) + 1;
            context.dirty = true;
        } else {
            store[url] = { firstSeen: nowIso, lastSeen: nowIso, misses: 1 };
            context.dirty = true;
            context.learned.push(url);
        }
    }

    // End-of-run retention pass: entries unseen for 2× the retry window are
    // stale (their page has been retried and confirmed dead at least once
    // without ever recovering) and get dropped.
    pruneDeadEndStore(context, nowMs = Date.now()) {
        if (!context || !context.enabled) {
            return;
        }
        const horizonMs = 2 * context.retryDays * 24 * 60 * 60 * 1000;
        for (const [url, entry] of Object.entries(context.store)) {
            const lastSeenMs = entry && entry.lastSeen ? Date.parse(entry.lastSeen) : NaN;
            if (!Number.isFinite(lastSeenMs) || (nowMs - lastSeenMs) > horizonMs) {
                delete context.store[url];
                context.prunedCount += 1;
                context.dirty = true;
            }
        }
    }

    async finalizeDeadEndRun(displayAdapter, results, nowMs = Date.now()) {
        const context = this.deadEndRunContext;
        this.deadEndRunContext = null;
        if (!context) {
            return;
        }
        if (context.enabled) {
            this.pruneDeadEndStore(context, nowMs);
            if (context.skippedCount > 0) {
                const samples = context.skippedSamples.length > 0 ? `: ${context.skippedSamples.join(', ')}` : '';
                await displayAdapter.logInfo(`SYSTEM: Skipped ${context.skippedCount} known dead-end URL(s) (retry after ${context.retryDays}d; delete dead-ends.json or set deadEndRetryDays: 0 to reset)${samples}`);
            }
            if (context.learned.length > 0) {
                await displayAdapter.logInfo(`SYSTEM: Learned ${context.learned.length} new dead-end URL(s): ${context.learned.join(', ')}`);
            }
            if (context.recovered.length > 0) {
                await displayAdapter.logInfo(`SYSTEM: Removed ${context.recovered.length} recovered URL(s) from dead-end store: ${context.recovered.join(', ')}`);
            }
            if (context.prunedCount > 0) {
                await displayAdapter.logInfo(`SYSTEM: Pruned ${context.prunedCount} stale dead-end URL(s) (last seen more than ${2 * context.retryDays}d ago)`);
            }
        }
        if (results && typeof results === 'object') {
            results.deadEndStore = context.store;
            results.deadEndStoreChanged = context.dirty;
        }
    }

    async prepareParsedEvents(events, parserConfig, mainConfig, pageClassification, normalizerPipeline, httpAdapter) {
        if (!Array.isArray(events) || events.length === 0) {
            return [];
        }
        const filteredEvents = events.map(event => {
            // Ensure event is extensible before mutating it in applyFieldPriorities
            if (!Object.isExtensible(event)) {
                event = { ...event };
            }
            return this.applyFieldPriorities(event, parserConfig, mainConfig);
        });

        // Pass events through normalizer pipeline if provided
        // Use the passed pipeline or the instance property
        const pipelineToUse = normalizerPipeline || this.normalizerPipeline;

        const globalConfig = mainConfig && mainConfig.config && typeof mainConfig.config === 'object' ? mainConfig.config : {};
        const enrichedEvents = pipelineToUse
            ? await pipelineToUse.normalizeEventsAsync(filteredEvents, httpAdapter, { geocodeVerification: globalConfig.geocodeVerification })
            : filteredEvents.map(event => this.normalizeEventTextFields(event));

        enrichedEvents.forEach((event, index) => {
            if (!Object.isExtensible(event)) {
                event = { ...event };
                enrichedEvents[index] = event;
            }
            event._pageClassification = pageClassification;
        });
        return enrichedEvents;
    }

    async parsePageForCrawl({
        url,
        htmlData,
        parsers,
        parserName = null,
        allowParserAutoSwitch = true,
        parserConfig,
        mainConfig = null,
        displayAdapter,
        logClassification = true,
        logParserSwitch = true,
        httpAdapter
    }) {
        let { classification: pageClassification, signal: classificationSignal } = this.classifyPageWithSignal(url, htmlData.html);

        // AI second opinion (default on; disable with parserConfig.ai.classifyPages: false)
        // — only when the deterministic tiers (URL rules, JSON-LD) had no answer and we
        // are relying on the crude month-count heuristic. Costs one small text-model
        // request per weak-signal page.
        const aiClassifyEnabled = !(parserConfig && parserConfig.ai && parserConfig.ai.classifyPages === false);
        const weakSignal = classificationSignal === 'heuristic' || classificationSignal === 'none';
        if (aiClassifyEnabled && weakSignal) {
            const aiParser = parsers && parsers['ai-web'];
            const aiConfig = aiParser && typeof aiParser.getAiConfig === 'function'
                ? aiParser.getAiConfig(parserConfig)
                : null;
            const classificationCache = aiParser && typeof aiParser.getAiClassificationCache === 'function'
                ? aiParser.getAiClassificationCache()
                : null;
            try {
                const aiResult = await this.classifyPageWithAi(url, htmlData.html, aiConfig, httpAdapter, classificationCache);
                if (aiResult && aiResult.classification && aiResult.classification !== pageClassification) {
                    await displayAdapter.logInfo(`SYSTEM: AI reclassified ${url} → ${aiResult.classification} (was ${pageClassification} via ${classificationSignal}, confidence ${aiResult.confidence === null ? 'n/a' : aiResult.confidence}: ${aiResult.reason})`);
                    pageClassification = aiResult.classification;
                    classificationSignal = 'ai';
                } else if (aiResult && aiResult.classification) {
                    classificationSignal = 'ai-confirmed';
                }
            } catch (error) {
                console.warn(`⚠️ SharedCore: AI page classification failed for ${url}: ${error.message}`);
            }
        }

        if (logClassification) {
            await displayAdapter.logInfo(`SYSTEM: Classified ${url} → ${pageClassification}`);
        }
        if (pageClassification === 'ad') {
            await displayAdapter.logInfo(`SYSTEM: Skipping parser for ad page: ${url}`);
            return { pageClassification, parseResult: { events: [], additionalLinks: [] }, urlParserName: null };
        }
        const detectedParserName = this.detectParserFromUrl(url);
        const baseParserName = parserName || 'ai-web';
        const urlParserName = allowParserAutoSwitch
            ? (detectedParserName || baseParserName)
            : baseParserName;
        if (logParserSwitch && allowParserAutoSwitch && urlParserName !== baseParserName) {
            await displayAdapter.logInfo(`SYSTEM: Switching to ${urlParserName} parser for URL: ${url}`);
        }
        const urlParser = parsers[urlParserName];
        if (!urlParser) {
            throw new Error(`Parser '${urlParserName}' not found`);
        }
        const parseResult = await Promise.resolve(
            urlParser.parseEvents(htmlData, parserConfig, mainConfig?.cities || null, pageClassification, httpAdapter)
        );
        return { pageClassification, parseResult, urlParserName };
    }

    // Strip protocol prefix from a URL for compact display labels.
    stripUrlProtocol(url) {
        return String(url || '').replace(/^https?:\/\//, '');
    }

    // Build a Mermaid graph LR string from a URL tree.
    buildMermaidGraph(treeData) {
        const { allNodes, edges } = treeData;
        if (!allNodes || allNodes.length === 0) return 'graph LR\n    A["No URLs discovered"]';

        const nodeIds = new Map();
        allNodes.forEach((url, i) => nodeIds.set(url, `N${i}`));

        const truncate = (s, max) => s.length > max ? s.substring(0, max - 1) + '…' : s;

        const lines = ['graph LR'];
        for (const url of allNodes) {
            const id = nodeIds.get(url);
            const label = truncate(this.stripUrlProtocol(url), 70).replace(/"/g, "'");
            lines.push(`    ${id}["${label}"]`);
        }
        for (const { from, to } of (edges || [])) {
            const fromId = nodeIds.get(from);
            const toId = nodeIds.get(to);
            if (fromId && toId) lines.push(`    ${fromId} --> ${toId}`);
        }
        return lines.join('\n');
    }

    // Build an ASCII tree from a URL tree.
    buildAsciiTree(treeData) {
        const { rootUrls, edges } = treeData;
        if (!rootUrls || rootUrls.length === 0) return '(no URLs discovered)';

        const children = new Map();
        for (const { from, to } of (edges || [])) {
            if (!children.has(from)) children.set(from, []);
            children.get(from).push(to);
        }

        const lines = [];

        const printNode = (url, prefix, isLast) => {
            const connector = isLast ? '└── ' : '├── ';
            lines.push(`${prefix}${connector}${this.stripUrlProtocol(url)}`);
            const kids = children.get(url) || [];
            const newPrefix = prefix + (isLast ? '    ' : '│   ');
            kids.forEach((kid, i) => printNode(kid, newPrefix, i === kids.length - 1));
        };

        rootUrls.forEach(root => {
            lines.push(this.stripUrlProtocol(root));
            const kids = children.get(root) || [];
            kids.forEach((kid, i) => printNode(kid, '', i === kids.length - 1));
        });

        return lines.join('\n');
    }

    // Generic URL deduplication utility
    deduplicateUrls(urls, processedUrls = new Set()) {
        if (!urls || !Array.isArray(urls)) {
            return [];
        }
        
        const uniqueUrls = new Set();
        const result = [];
        
        for (const url of urls) {
            if (!url || typeof url !== 'string') {
                continue;
            }
            const key = this.getUrlDedupeKey(url);
            if (!key) {
                continue;
            }
            
            // Skip if already processed globally
            if (processedUrls.has(key)) {
                continue;
            }
            
            // Skip if already in this batch
            if (uniqueUrls.has(key)) {
                continue;
            }
            
            uniqueUrls.add(key);
            result.push(url);
        }
        
        return result;
    }

    hasProcessedUrl(processedUrls, url) {
        const key = this.getUrlDedupeKey(url);
        return !!key && processedUrls.has(key);
    }

    markProcessedUrl(processedUrls, url) {
        const key = this.getUrlDedupeKey(url);
        if (key) {
            processedUrls.add(key);
        }
    }

    getUrlDedupeKey(url) {
        if (!url || typeof url !== 'string') return '';

        const normalized = this.normalizeUrl(url) || String(url);
        const parsed = this.parseUrl(normalized);
        if (!parsed) {
            const trimmed = String(normalized).trim().replace(/#.*$/, '');
            const queryIndex = trimmed.indexOf('?');
            const path = (queryIndex >= 0 ? trimmed.slice(0, queryIndex) : trimmed).replace(/\/$/, '');
            const search = queryIndex >= 0 ? this.stripTrackingSearch(trimmed.slice(queryIndex)) : '';
            return `${path || '/'}${search}`.toLowerCase();
        }

        const protocol = String(parsed.protocol || '').toLowerCase();
        const host = String(parsed.host || parsed.hostname || '').toLowerCase();
        let pathname = String(parsed.pathname || '/');
        pathname = pathname.replace(/\/+$/, '');
        if (!pathname) pathname = '/';
        const search = this.stripTrackingSearch(parsed.search || '');
        return `${protocol}//${host}${pathname}${search}`.toLowerCase();
    }

    stripTrackingSearch(search) {
        if (!search) return '';

        const parts = String(search)
            .replace(/^\?/, '')
            .split('&')
            .filter(Boolean);
        const filtered = parts.filter(part => {
            const [rawKey = ''] = String(part).split('=');
            const normalizedKey = this.decodeQueryComponent(rawKey).toLowerCase();
            return !this.trackingParamPattern.test(normalizedKey);
        });
        return filtered.length > 0 ? `?${filtered.join('&')}` : '';
    }

    decodeQueryComponent(value) {
        try {
            return decodeURIComponent(String(value || '').replace(/\+/g, '%20'));
        } catch (_) {
            return String(value || '');
        }
    }

    // Pure utility functions
    filterFutureEvents(events, daysToLookAhead = null, allowPastEvents = false) {
        const now = new Date();
        const cutoffDate = daysToLookAhead ? 
            new Date(now.getTime() + (daysToLookAhead * 24 * 60 * 60 * 1000)) : 
            null;

        return events.filter(event => {
            if (!event.startDate) {
                console.log(`⚠️ SharedCore: Filtering out event "${event.title || 'Unknown'}" - missing startDate`);
                return false;
            }
            
            const eventDate = event.startDate instanceof Date ? event.startDate : new Date(event.startDate);
            if (Number.isNaN(eventDate.getTime())) {
                console.log(`⚠️ SharedCore: Filtering out event "${event.title || 'Unknown'}" - invalid startDate "${event.startDate}"`);
                return false;
            }
            
            // Skip past events unless explicitly allowed
            if (!allowPastEvents && eventDate.getTime() <= now.getTime()) {
                console.log(`⚠️ SharedCore: Filtering out event "${event.title || 'Unknown'}" - eventDate (${eventDate.toISOString()}) is past or equal to now (${now.toISOString()})`);
                return false;
            }
            
            if (cutoffDate && eventDate.getTime() > cutoffDate.getTime()) {
                console.log(`⚠️ SharedCore: Filtering out event "${event.title || 'Unknown'}" - eventDate (${eventDate.toISOString()}) is beyond cutoffDate (${cutoffDate.toISOString()}) [daysToLookAhead: ${daysToLookAhead}]`);
                return false;
            }
            
            return true;
        });
    }

    // Bear-check cascade: keyword match → AI verdict with promoter context →
    // alwaysBear as trusted-promoter fallback. Mode knob
    // (parserConfig.ai.bearCheck.mode): 'report' (default) logs each event's
    // would-be decision while returning exactly today's behavior; 'enforce'
    // keeps/flags/rescues/drops on the cascade's decisions; 'off' is exact
    // legacy behavior (alwaysBear bypass, keyword filter) with no new logs.
    async filterBearEvents(events, parserConfig, httpAdapter = null) {
        const legacyFilter = () => parserConfig.alwaysBear
            ? events.map(event => ({...event, isBearEvent: true}))
            : events.filter(event => this.isBearEvent(event, parserConfig));

        const mode = this.getBearCheckMode(parserConfig);
        if (mode === 'off') return legacyFilter();

        const trusted = parserConfig.alwaysBear === true;
        const tag = mode === 'report' ? ' [report]' : '';
        const counts = { bear: 0, keyword: 0, ai: 0, flagged: 0, dropped: 0 };
        const kept = [];
        for (const event of events) {
            const decision = await this.computeBearCheckDecision(event, parserConfig, httpAdapter);
            const title = event.title || 'Unknown';
            if (decision.result === 'bear') {
                counts.bear++;
                if (decision.provenance.startsWith('keyword:')) counts.keyword++;
                if (decision.provenance.startsWith('ai:')) counts.ai++;
                // In report mode an AI-bear verdict on an untrusted source is a
                // rescue the legacy keyword filter still drops — say so, or the
                // calibration logs claim the event was kept when it wasn't.
                const rescueNote = tag && !trusted && decision.provenance.startsWith('ai:')
                    ? ' (would-rescue — legacy keyword filter still drops it)'
                    : '';
                console.log(`🐻 BEAR CHECK${tag}: "${title}" → bear (${decision.provenance})${rescueNote}`);
                kept.push({...event, isBearEvent: true});
            } else if (decision.result === 'not_bear' && !trusted) {
                counts.dropped++;
                console.log(`🐻 BEAR CHECK${tag}: "${title}" → DROP (${decision.provenance})`);
            } else {
                // alwaysBear sources never lose events: not_bear/unsure is kept
                // with a review flag; untrusted unsure is likewise kept+flagged.
                counts.flagged++;
                console.log(`🐻 BEAR CHECK${tag}: "${title}" → FLAG (${decision.provenance})`);
                const label = decision.result === 'not_bear' ? 'unlikely' : 'unsure';
                kept.push({...event, bearReview: `${label} — ${decision.provenance}`});
            }
        }
        const flagLabel = mode === 'report' ? 'would-flag' : 'flagged';
        const dropLabel = mode === 'report' ? 'would-drop' : 'dropped';
        console.log(`🐻 BEAR CHECK${tag}: ${counts.bear} bear (${counts.keyword} keyword, ${counts.ai} ai), ${counts.flagged} ${flagLabel}, ${counts.dropped} ${dropLabel}`);

        return mode === 'report' ? legacyFilter() : kept;
    }

    getBearCheckMode(parserConfig) {
        const bearCheck = parserConfig && parserConfig.ai && parserConfig.ai.bearCheck && typeof parserConfig.ai.bearCheck === 'object'
            ? parserConfig.ai.bearCheck
            : null;
        const mode = bearCheck ? String(bearCheck.mode || '').trim().toLowerCase() : '';
        return mode === 'enforce' || mode === 'off' ? mode : 'report';
    }

    // One cascade decision per event: { result: 'bear'|'not_bear'|'unsure',
    // provenance: 'keyword: ...' | 'allowlist: ...' | 'ai: ...' | 'config/fallback: ...' }.
    async computeBearCheckDecision(event, parserConfig, httpAdapter) {
        const searchText = `${event.title || ''} ${event.description || ''} ${event.bar || ''}`;

        // Existing allowlist gate keeps its exact legacy semantics: for
        // non-alwaysBear sources with requireKeywords, an allowlist miss
        // rejects the event before any other tier.
        if (!parserConfig.alwaysBear
            && parserConfig.allowlist && parserConfig.allowlist.length > 0
            && parserConfig.requireKeywords) {
            const lowered = searchText.toLowerCase();
            const hasAllowlistKeyword = parserConfig.allowlist.some(keyword =>
                lowered.includes(String(keyword).toLowerCase())
            );
            if (!hasAllowlistKeyword) {
                return { result: 'not_bear', provenance: 'allowlist: required keyword missing' };
            }
        }

        const matched = this.matchBearKeywords(searchText);
        if (matched.length > 0) {
            return { result: 'bear', provenance: `keyword: ${matched.join(', ')}` };
        }

        const aiVerdict = await this.getAiBearVerdict(event, parserConfig, httpAdapter);
        if (aiVerdict) {
            return { result: aiVerdict.verdict, provenance: `ai: ${aiVerdict.reason || 'no reason given'}` };
        }

        if (parserConfig.alwaysBear === true) {
            return { result: 'bear', provenance: 'config: alwaysBear (ai unavailable)' };
        }
        return { result: 'unsure', provenance: 'fallback: ai unavailable' };
    }

    isBearEvent(event, parserConfig) {
        if (parserConfig.alwaysBear) return true;

        const searchText = `${event.title || ''} ${event.description || ''} ${event.bar || ''}`;

        // Check allowlist first (if provided)
        if (parserConfig.allowlist && parserConfig.allowlist.length > 0) {
            const lowered = searchText.toLowerCase();
            const hasAllowlistKeyword = parserConfig.allowlist.some(keyword =>
                lowered.includes(keyword.toLowerCase())
            );
            if (parserConfig.requireKeywords && !hasAllowlistKeyword) {
                return false;
            }
        }

        // Check bear keywords
        return this.matchBearKeywords(searchText).length > 0;
    }

    // Returns the list of bear keywords the text hits (empty array = no match).
    matchBearKeywords(text) {
        const source = String(text || '').toLowerCase();
        if (!source) return [];
        const matched = [];
        for (const keyword of this.bearSubstringKeywords) {
            if (source.includes(keyword)) matched.push(keyword);
        }
        for (const keyword of this.bearWordBoundaryKeywords) {
            const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (new RegExp(`\\b${escaped}\\b`, 'i').test(source)) matched.push(keyword);
        }
        return matched;
    }

    // Provenance context for the bear-check prompt: where the event was scraped
    // from, plus the owner's trusted-promoter marking when alwaysBear is set —
    // that promoter context is what lets the model keep promoter events with
    // zero bear vocabulary (validated against real calendar data).
    buildBearCheckProvenance(event, parserConfig) {
        const sourceUrl = String(event.url || event.website || (parserConfig.urls && parserConfig.urls[0]) || '');
        const hostMatch = sourceUrl.match(/^https?:\/\/([^/?#]+)/i);
        const origin = hostMatch ? hostMatch[1] : (sourceUrl || 'unknown source');
        let provenance = `Scraped from ${origin}, source entry "${parserConfig.name || 'unknown'}".`;
        if (parserConfig.alwaysBear === true) {
            provenance += ' The calendar owner has marked this promoter as a trusted bear-scene promoter.';
        }
        return provenance;
    }

    // AI verdict tier of the bear-check cascade. Returns
    // { verdict: 'bear'|'not_bear'|'unsure', reason, provenance } or null when
    // AI is unavailable or the response is unusable (caller falls back).
    // Memoized per run by title+description+bar so duplicate records and
    // repeat titles cost one request.
    async getAiBearVerdict(event, parserConfig, httpAdapter) {
        if (!httpAdapter || typeof httpAdapter.postJson !== 'function') return null;
        const rawAi = parserConfig && parserConfig.ai && typeof parserConfig.ai === 'object' ? parserConfig.ai : {};
        if (rawAi.enabled === false) return null;
        const resolved = this.resolveAiConfig(rawAi);
        if (!resolved.enabled || !resolved.endpoint) return null;

        const title = String(event.title || '').trim();
        const description = String(event.description || '').trim();
        const bar = String(event.bar || '').trim();
        const memoKey = `${title}|${description}|${bar}`;
        if (!this._bearVerdictMemo) {
            this._bearVerdictMemo = new Map();
        }
        if (this._bearVerdictMemo.has(memoKey)) {
            return this._bearVerdictMemo.get(memoKey);
        }

        const provenance = this.buildBearCheckProvenance(event, parserConfig);
        const prompt = [
            'You are curating a calendar for the gay bear community. Decide whether the event below belongs on a BEAR calendar.',
            '',
            "Bear events include: bear/cub/chub/otter parties, bear happy hours, bear-run dance parties, leather/kink nights with bear crowds, and cruise/underwear/jockstrap parties thrown by bear promoters. Events thrown by a bear-scene promoter are almost always bear events even when the event text has no bear words — the promoter's crowd follows the promoter.",
            '',
            'NOT bear events: shows or parties aimed at a clearly different audience (e.g. a drag-headliner show, a lesbian night, a general-audience concert) even when a bear promoter produces them, and generic events with no connection to the bear scene.',
            '',
            'Event:',
            `- Title: ${title}`,
            `- Venue: ${bar || 'unknown'}`,
            `- City: ${event.city || 'unknown'}`,
            `- Description: ${description ? description.slice(0, 500) : '(none)'}`,
            `- Provenance: ${provenance}`,
            '',
            'Respond with ONLY a JSON object, no other text:',
            '{"verdict": "bear" | "not_bear" | "unsure", "reason": "<one short sentence>"}',
            '',
            'Rules: answer "bear" when the promoter is bear-scene and nothing signals a different target audience. When the calendar owner has marked the promoter as trusted, default to "bear" — but still answer "not_bear" when the event itself clearly targets a different audience (e.g. a drag-headliner show). Answer "not_bear" only when you are confident. Answer "unsure" only when you genuinely cannot tell.'
        ].join('\n');

        const verdictConfig = { ...resolved, temperature: 0, numPredict: Math.min(Number(resolved.numPredict) || 200, 200) };
        const pending = (async () => {
            const rawResponse = await this.callAiGenerate(verdictConfig, prompt, 'bear-check', httpAdapter);
            if (!rawResponse) return null;
            let parsed = null;
            try {
                parsed = JSON.parse(this.extractFirstJsonObject(rawResponse) || rawResponse);
            } catch (_) {
                return null;
            }
            const verdict = parsed && typeof parsed.verdict === 'string' ? parsed.verdict.trim().toLowerCase() : '';
            if (verdict !== 'bear' && verdict !== 'not_bear' && verdict !== 'unsure') return null;
            return {
                verdict,
                reason: typeof parsed.reason === 'string' ? parsed.reason.trim() : '',
                provenance
            };
        })().catch(() => null);
        this._bearVerdictMemo.set(memoKey, pending);
        return pending;
    }

    async deduplicateEvents(events, httpAdapter, globalConfig = null) {
        const seen = new Map();
        const deduplicated = [];
        
        // Log progress for large batches
        const logProgress = events.length > 10;

        for (const event of events) {
            const key = this.createEventKey(event);

            // Set the key on the event for later use
            event.key = key;

            const mergeIntoExisting = async (existing) => {
                const merged = await this.mergeParsedEvents(existing, event, { httpAdapter, globalConfig });
                merged.key = existing.key;
                seen.set(existing.key, merged);
                const index = deduplicated.indexOf(existing);
                if (index !== -1) {
                    deduplicated[index] = merged;
                }
            };

            const keyMatch = seen.get(key);
            if (keyMatch) {
                // A key collision is a hint, not proof — loose key templates (e.g.
                // "bearracuda-${date}-${city}") collide for two DIFFERENT events by the
                // same promoter on the same night. Veto the merge when both records
                // carry place info and the places don't match; merge otherwise
                // (identity match or inconclusive = previous behavior).
                if (this.areEventsDistinctByPlace(event, keyMatch)) {
                    // The base-key holder is at a different venue, but a previous veto may
                    // have parked another record of THIS event under a suffixed key
                    // ("key--2", "key--3", ...). Walk the whole collision chain before
                    // declaring the event new, otherwise two records of the same event
                    // that each collided with a different-venue holder never meet.
                    let chainMatch = null;
                    for (const [existingKey, holder] of seen) {
                        if (holder === keyMatch) continue;
                        if (existingKey !== key && !existingKey.startsWith(`${key}--`)) continue;
                        if (!this.areEventsDistinctByPlace(event, holder)) {
                            chainMatch = holder;
                            break;
                        }
                    }
                    if (chainMatch) {
                        console.log(`🔄 SharedCore: Key collision variant match — merging "${event.title || 'event'}" into "${chainMatch.title || 'event'}"`);
                        await mergeIntoExisting(chainMatch);
                        continue;
                    }

                    // Degraded fields hide chain matches too (same reasoning as the
                    // no-key-match scan below): a vetoed event may still be identical to
                    // an existing event by ticketUrl/identity, so run the identity scan
                    // before pushing it as new. The vetoed base-key holder is excluded —
                    // its place mismatch already proved it is a different event.
                    const identityMatch = deduplicated.find(existing =>
                        existing !== keyMatch &&
                        this.getSameEventIdentitySignal(event, existing, { requireCloseStartTimes: false }));
                    if (identityMatch) {
                        console.log(`🔄 SharedCore: Key collision variant match — merging "${event.title || 'event'}" into "${identityMatch.title || 'event'}" via identity scan`);
                        await mergeIntoExisting(identityMatch);
                        continue;
                    }

                    console.warn(`🔄 SharedCore: Key collision but different venues — keeping "${keyMatch.title || 'event'}" and "${event.title || 'event'}" as separate events`);
                    let uniqueKey = key;
                    let suffix = 2;
                    while (seen.has(uniqueKey)) uniqueKey = `${key}--${suffix++}`;
                    event.key = uniqueKey;
                    seen.set(uniqueKey, event);
                    deduplicated.push(event);
                } else {
                    await mergeIntoExisting(keyMatch);
                }
                continue;
            }

            // No key match — degraded fields (e.g. a missing start time defaulting to
            // midnight) make keys brittle, so scan for a same-event identity match
            // before accepting the event as new.
            const identityMatch = deduplicated.find(existing =>
                this.getSameEventIdentitySignal(event, existing, { requireCloseStartTimes: false }));
            if (identityMatch) {
                console.log(`🔄 SharedCore: Identity match without key match — merging "${event.title || 'event'}" into "${identityMatch.title || 'event'}"`);
                await mergeIntoExisting(identityMatch);
                continue;
            }

            seen.set(key, event);
            deduplicated.push(event);
        }

        // Second pass: two records of the SAME event can survive the key-bucket
        // pass under entirely different keys when corrupted fields changed the key
        // (e.g. OCR on a blurred thumbnail hallucinated a wrong city, or timezone
        // anchoring shifted the date) — they never collide, so the veto/identity
        // logic above never even compares them. An identical non-root event URL is
        // a strong same-event signal: index by normalized URL and merge those
        // pairs even when city/venue/date disagree, with a 7-day date sanity
        // window so recurring events that reuse their event page don't collapse.
        // A URL shared by 3+ records in one run is a listing/hub page (an events
        // calendar, a linktree with a path), not an event page — never merge on it.
        // Event-detail URLs are one-per-event; only a listing produces that fan-in.
        const urlKeyCounts = new Map();
        for (const event of deduplicated) {
            const urlKey = this.getEventUrlIdentityKey(event && event.url);
            if (urlKey) urlKeyCounts.set(urlKey, (urlKeyCounts.get(urlKey) || 0) + 1);
        }
        const eventsByUrl = new Map();
        const urlDeduplicated = [];
        for (const event of deduplicated) {
            const urlKey = this.getEventUrlIdentityKey(event && event.url);
            if (!urlKey) {
                urlDeduplicated.push(event);
                continue;
            }
            if ((urlKeyCounts.get(urlKey) || 0) >= 3) {
                if (!eventsByUrl.has(urlKey)) {
                    console.log(`🔄 SharedCore: URL shared by ${urlKeyCounts.get(urlKey)} events — treating as listing page, skipping same-URL merge: ${urlKey}`);
                    eventsByUrl.set(urlKey, event);
                }
                urlDeduplicated.push(event);
                continue;
            }
            const holder = eventsByUrl.get(urlKey);
            if (holder && this.areStartDatesWithinDays(holder, event, 7)
                && this.areTitlesCompatibleForUrlMerge(holder.title, event.title)) {
                console.log(`🔄 SharedCore: Same event URL — merging "${holder.title || 'event'}" and "${event.title || 'event'}" despite city/venue mismatch`);
                // Identity fields (key/city/timezone) must come from the richer
                // record — corrupted identity fields are exactly why these records
                // escaped the key-based pass, so field priorities can't be trusted
                // to pick them. Mirrors how key-collision merges keep existing.key.
                const richer = this.pickRicherIdentityRecord(holder, event);
                const merged = await this.mergeParsedEvents(holder, event, { httpAdapter, globalConfig });
                merged.key = richer.key;
                if (richer.city) merged.city = richer.city;
                if (richer.timezone) merged.timezone = richer.timezone;
                eventsByUrl.set(urlKey, merged);
                const index = urlDeduplicated.indexOf(holder);
                if (index !== -1) urlDeduplicated[index] = merged;
                continue;
            }
            if (!holder) eventsByUrl.set(urlKey, event);
            urlDeduplicated.push(event);
        }

        // Post-merge re-anchor: a merge can resolve the city (e.g. AI arbitration
        // picked the detail page's "sf") for an event whose dates are still
        // wall-clock components labeled UTC (_timezoneUnresolved) — the normal
        // LocationNormalizer re-anchor already ran before dedup and could not
        // help. Convert those dates now that the timezone is knowable; events
        // that stay unresolved keep the flag (and its warning).
        for (const event of urlDeduplicated) {
            if (event && event._timezoneUnresolved) {
                this.resolveWallClockDates(event);
            }
        }

        // Log results for large batches
        if (logProgress) {
            const duplicatesFound = events.length - urlDeduplicated.length;
            const duplicateSummary = duplicatesFound > 0 ? ` (removed ${duplicatesFound})` : '';
            console.log(`🔄 SharedCore: Deduplicated ${events.length} → ${urlDeduplicated.length}${duplicateSummary}`);
        }

        return urlDeduplicated;
    }

    createEventKey(event, format = null) {
        // Validate event structure
        if (typeof event.title !== 'string') {
            console.error(`⚠️ SharedCore: Invalid event.title type: ${typeof event.title} for event: ${event.title}`);
        }
        
        // Determine the format to use
        let keyFormat = format;
        if (!keyFormat && event._parserConfig && event._parserConfig.keyTemplate) {
            keyFormat = event._parserConfig.keyTemplate;
        }
        
        // Default format is the pipe-separated format (no source segment)
        if (!keyFormat) {
            keyFormat = '${normalizedTitle}|${date}|${venue}';
        }
        
        const key = this.generateKeyFromFormat(event, keyFormat);
        
        return key;
    }

    // Generate key from format string using event data
    generateKeyFromFormat(event, format, options = {}) {
        if (!format) {
            throw new Error('Format is required for generateKeyFromFormat');
        }
        
        // Use resolved city from normalizers pipeline
        const city = event.city || 'unknown';
        
        // Handle normalized title (with the original title normalization logic)
        let normalizedTitle = String(event.originalTitle || event.title || '').toLowerCase().trim();
        const originalTitle = normalizedTitle; // Store original value before normalization
        
        // Apply the original title normalization for ${normalizedTitle}
        if (format.includes('${normalizedTitle}')) {
            // Generic text normalization for better deduplication
            normalizedTitle = normalizedTitle
                // Replace sequences of special chars between letters with a single hyphen
                .replace(/([a-z])[\s\>\<\-\.\,\!\@\#\$\%\^\&\*\(\)\_\+\=\{\}\[\]\|\\\:\;\"\'\?\/]+([a-z])/gi, '$1-$2')
                // Remove trailing special characters after words
                .replace(/([a-z])[\!\@\#\$\%\^\&\*\(\)\_\+\=\{\}\[\]\|\\\:\;\"\'\?\,\.]+(?=\s|$)/gi, '$1')
                // Collapse multiple spaces/hyphens into single hyphen
                .replace(/[\s\-]+/g, '-')
                // Remove leading/trailing hyphens
                .replace(/^-+|-+$/g, '');
            
            if (normalizedTitle !== originalTitle) {
                // Title was normalized for deduplication
            }
        }
        
        // Initialize key from format template
        let key = format;
        
        const useLocalDate = options.useLocalDate === true;
        const eventTimezone = event.timezone || (event.city && this.cities[event.city]?.timezone) || null;
        const dateValue = useLocalDate
            ? this.normalizeEventDateLocal(event.startDate, eventTimezone)
            : this.normalizeEventDate(event.startDate);
        
        // Replace template variables
        key = key.replace(/\$\{title\}/g, String(event.title || '').toLowerCase().trim());
        key = key.replace(/\$\{normalizedTitle\}/g, normalizedTitle);
        key = key.replace(/\$\{startDate\}/g, dateValue);
        key = key.replace(/\$\{date\}/g, dateValue);
        key = key.replace(/\$\{venue\}/g, String(event.bar || '').toLowerCase().trim());
        key = key.replace(/\$\{source\}/g, String(event.source || '').toLowerCase().trim());
        key = key.replace(/\$\{city\}/g, city.toLowerCase().trim());
        
        // Clean up the key
        key = key.toLowerCase().trim();
        
        return key;
    }

    // Merge two parsed events based on field priorities (for deduplication)
    async mergeParsedEvents(existingEvent, newEvent, options = {}) {
        const fieldPriorities = newEvent._fieldPriorities || existingEvent._fieldPriorities || {};

        // Start with newEvent as base to preserve metadata
        const mergedEvent = { ...newEvent };

        // Carry the derived organizer across merges: underscore fields are skipped
        // by the field loop below, so an existing-only _organizer would be lost.
        if (!mergedEvent._organizer && existingEvent && typeof existingEvent._organizer === 'string' && existingEvent._organizer) {
            mergedEvent._organizer = existingEvent._organizer;
        }

        // Helper function to check if a value is empty/null/undefined
        const isEmpty = (value) => {
            return value === null || value === undefined || value === '' ||
                   (typeof value === 'string' && value.trim() === '');
        };

        // Get all field names from both events
        const allFields = new Set([
            ...Object.keys(existingEvent),
            ...Object.keys(newEvent)
        ]);

        // Track merge decisions for important fields
        const mergeDecisions = [];
        // Conflicts where the priority arrays are non-decisive — deferred to AI.
        // Each carries the deterministic fallback so a failed arbitration reproduces
        // today's behavior exactly.
        const pendingAiConflicts = [];

        // Deterministic pre-arbitration rules (URL shape / emoji-twin titles)
        // run before a conflict is queued for AI — both merge paths consult
        // resolveConflictDeterministically so behavior is identical.
        const mergeEventTitle = newEvent.title || existingEvent.title || 'event';
        // City context for the city-aware title rule (a bare city title loses
        // to a named title) — both records describe the same event, so either
        // side's resolved city works.
        const mergeContext = { cityKey: newEvent.city || existingEvent.city || '' };
        const queueArbitrationConflict = (fieldName, existingValue, newValue, fallbackPick, fallbackReason) => {
            const resolved = this.resolveConflictDeterministically(fieldName, existingValue, newValue, mergeContext);
            if (!resolved) {
                pendingAiConflicts.push({
                    field: fieldName,
                    values: { existing: existingValue, incoming: newValue },
                    fallbackPick,
                    fallbackReason
                });
                return;
            }
            const chosenValue = resolved.winner === 'a' ? existingValue : newValue;
            mergedEvent[fieldName] = chosenValue;
            console.log(`🔒 MERGE: "${mergeEventTitle}" field=${fieldName} resolved deterministically — ${resolved.reason}`);
            mergeDecisions.push({
                field: fieldName,
                existingValue: existingValue,
                newValue: newValue,
                chosenValue: chosenValue,
                reason: `deterministic: ${resolved.reason}`
            });
        };

        // Apply field priorities for each field
        allFields.forEach(fieldName => {
            if (fieldName.startsWith('_')) return; // Skip metadata fields

            const priorityConfig = fieldPriorities[fieldName];
            const existingValue = existingEvent[fieldName];
            const newValue = newEvent[fieldName];
            const existingSource = existingEvent.source;
            const newSource = newEvent.source;

            // location is ALWAYS coordinates: when exactly one side has a
            // coordinate pair it wins deterministically — text or an empty value
            // never displaces coordinates. Both-or-neither coordinates falls
            // through to the normal priority resolution below (never AI:
            // location is excluded from arbitration eligibility).
            if (fieldName === 'location') {
                const existingIsCoordinates = this.isCoordinatePair(existingValue);
                const newIsCoordinates = this.isCoordinatePair(newValue);
                if (existingIsCoordinates !== newIsCoordinates) {
                    const chosenValue = existingIsCoordinates ? existingValue : newValue;
                    mergedEvent[fieldName] = chosenValue;
                    if (existingValue !== newValue) {
                        mergeDecisions.push({
                            field: fieldName,
                            existingValue: existingValue,
                            newValue: newValue,
                            chosenValue: chosenValue,
                            reason: 'location must be coordinates — coordinates win over text/empty'
                        });
                    }
                    return;
                }
                // Neither side is coordinates: an empty side is an extraction
                // gap, not data — it must never clear a non-empty location
                // (observed 2026-07-12: an empty scrape wiped a calendar's text
                // location). Mirrors the bar rule below; both-non-empty text
                // still falls through to the normal priority resolution.
                const existingLocationEmpty = isEmpty(existingValue);
                const newLocationEmpty = isEmpty(newValue);
                if (existingLocationEmpty !== newLocationEmpty) {
                    const chosenValue = existingLocationEmpty ? newValue : existingValue;
                    mergedEvent[fieldName] = chosenValue;
                    if (!existingLocationEmpty) {
                        console.log(`📍 MERGE: "${newEvent.title || existingEvent.title || 'event'}" location kept from existing (incoming scrape found none)`);
                    }
                    mergeDecisions.push({
                        field: fieldName,
                        existingValue: existingValue,
                        newValue: newValue,
                        chosenValue: chosenValue,
                        reason: 'location kept from the non-empty side — an empty scrape must not clear a location'
                    });
                    return;
                }
            }

            // bar mirrors the location rule in spirit: an empty side is an
            // extraction gap, not data — when exactly one record has a venue it
            // wins deterministically, regardless of source priority. (The
            // priority path below only prefers the non-empty side when BOTH
            // sources are in the priority list; without that, an empty incoming
            // bar could clear a venue.) Both-non-empty falls through to the
            // normal resolution below.
            if (fieldName === 'bar') {
                const existingBarEmpty = isEmpty(existingValue);
                const newBarEmpty = isEmpty(newValue);
                if (existingBarEmpty !== newBarEmpty) {
                    const chosenValue = existingBarEmpty ? newValue : existingValue;
                    mergedEvent[fieldName] = chosenValue;
                    if (existingValue !== newValue) {
                        mergeDecisions.push({
                            field: fieldName,
                            existingValue: existingValue,
                            newValue: newValue,
                            chosenValue: chosenValue,
                            reason: 'bar kept from the non-empty side — an empty scrape must not clear a venue'
                        });
                    }
                    return;
                }
            }

            // A degenerate end (endDate <= that record's own startDate) is a
            // normalization artifact, not data — when exactly one side's end is
            // degenerate, the positive-duration end wins deterministically.
            if (fieldName === 'endDate' && !isEmpty(existingValue) && !isEmpty(newValue)) {
                const existingEndDegenerate = this.hasDegenerateEnd(existingEvent);
                const newEndDegenerate = this.hasDegenerateEnd(newEvent);
                if (existingEndDegenerate !== newEndDegenerate) {
                    const chosenValue = existingEndDegenerate ? newValue : existingValue;
                    mergedEvent[fieldName] = chosenValue;
                    console.warn(`⚠️ MERGE: "${newEvent.title || existingEvent.title || 'event'}" ${existingEndDegenerate ? 'existing' : 'incoming'} endDate <= startDate (zero duration) — treating as missing, keeping the positive-duration end`);
                    mergeDecisions.push({
                        field: fieldName,
                        existingValue: existingValue,
                        newValue: newValue,
                        chosenValue: chosenValue,
                        reason: 'degenerate end (endDate <= startDate) treated as missing'
                    });
                    return;
                }
            }

            // A record flagged _timezoneUnresolved stores wall-clock components
            // labeled UTC (a possibly wrong instant); an unflagged record's dates
            // are real timezone-anchored instants. When exactly one side is
            // flagged, the anchored side's date wins deterministically — source
            // priority/tie-breaks must never let a wall-clock value clobber a
            // correct instant (observed 2026-07-13: a segment record's wall-clock
            // 22:00Z beat the detail page's JSON-LD-anchored 05:00Z).
            if ((fieldName === 'startDate' || fieldName === 'endDate')
                && !isEmpty(existingValue) && !isEmpty(newValue)) {
                const existingWallClock = Boolean(existingEvent._timezoneUnresolved);
                const newWallClock = Boolean(newEvent._timezoneUnresolved);
                if (existingWallClock !== newWallClock && String(existingValue) !== String(newValue)) {
                    const chosenValue = existingWallClock ? newValue : existingValue;
                    mergedEvent[fieldName] = chosenValue;
                    console.log(`⏰ MERGE: "${mergeEventTitle}" kept timezone-anchored ${fieldName} over wall-clock value`);
                    mergeDecisions.push({
                        field: fieldName,
                        existingValue: existingValue,
                        newValue: newValue,
                        chosenValue: chosenValue,
                        reason: 'timezone-anchored date wins over wall-clock (_timezoneUnresolved) date'
                    });
                    return;
                }
            }

            // Universal empty-loses rule: when exactly one side has a value it
            // wins, regardless of source priority — an empty side is an
            // extraction gap, never data. Without this, the same-priority
            // branch below (every dedup pair now that ai-web is the universal
            // parser) "preserved existing" even when existing was EMPTY,
            // wiping one-sided values the { ...newEvent } base already carried
            // (observed 2026-07-14: cover/ticketUrl from a detail page erased
            // by the coverless homepage-segment record).
            const existingSideEmpty = isEmpty(existingValue);
            const newSideEmpty = isEmpty(newValue);
            if (existingSideEmpty !== newSideEmpty) {
                const chosenValue = existingSideEmpty ? newValue : existingValue;
                mergedEvent[fieldName] = chosenValue;
                mergeDecisions.push({
                    field: fieldName,
                    existingValue: existingValue,
                    newValue: newValue,
                    chosenValue: chosenValue,
                    reason: 'kept the non-empty side — an empty side never displaces data'
                });
                return;
            }

            const canArbitrate = this.isArbitrationEligibleField(fieldName)
                && this.isGenuineFieldConflict(fieldName, existingValue, newValue);

            if (!priorityConfig || !priorityConfig.priority) {
                // No priority config: keep newEvent value — unless it's a genuine
                // conflict, in which case the AI gets to pick.
                if (canArbitrate) {
                    queueArbitrationConflict(fieldName, existingValue, newValue,
                        'incoming', 'no priority config - keeping incoming');
                }
                return;
            }

            // Find which source has higher priority
            const existingIndex = priorityConfig.priority.indexOf(existingSource);
            const newIndex = priorityConfig.priority.indexOf(newSource);

            let chosenValue = newValue; // Default
            let reason = 'default';

            // If both sources are in the priority list, use the one with lower index (higher priority)
            if (existingIndex !== -1 && newIndex !== -1) {
                if (existingIndex < newIndex) {
                    // Existing source has higher priority
                    // But if existing value is empty and new value is not empty, use new value
                    if (isEmpty(existingValue) && !isEmpty(newValue)) {
                        chosenValue = newValue;
                        reason = `${newSource} value used because ${existingSource} value is empty`;
                    } else {
                        chosenValue = existingValue;
                        reason = `${existingSource} has higher priority (index ${existingIndex} vs ${newIndex})`;
                    }
                } else if (newIndex < existingIndex) {
                    // New source has higher priority
                    // But if new value is empty and existing value is not empty, use existing value
                    if (isEmpty(newValue) && !isEmpty(existingValue)) {
                        chosenValue = existingValue;
                        reason = `${existingSource} value used because ${newSource} value is empty`;
                    } else {
                        chosenValue = newValue;
                        reason = `${newSource} has higher priority (index ${newIndex} vs ${existingIndex})`;
                    }
                } else {
                    // Same priority — the priority array cannot decide. Defer genuine
                    // conflicts to AI; otherwise preserve existing (today's behavior).
                    if (canArbitrate) {
                        queueArbitrationConflict(fieldName, existingValue, newValue,
                            'existing', `same priority (index ${existingIndex} vs ${newIndex}) - preserving existing`);
                        return;
                    }
                    chosenValue = existingValue;
                    reason = `same priority (index ${existingIndex} vs ${newIndex}) - preserving existing`;
                }
            } else if (existingIndex !== -1) {
                // Only existing source is in priority list
                chosenValue = existingValue;
                reason = `only ${existingSource} in priority list`;
            } else if (newIndex !== -1) {
                // Only new source is in priority list
                chosenValue = newValue;
                reason = `only ${newSource} in priority list`;
            } else if (canArbitrate) {
                // Neither source in the priority list — non-decisive, defer to AI
                queueArbitrationConflict(fieldName, existingValue, newValue,
                    'incoming', 'neither source in priority list - keeping incoming');
                return;
            }

            mergedEvent[fieldName] = chosenValue;

            // Log decisions when values differ
            if (existingValue !== newValue) {
                mergeDecisions.push({
                    field: fieldName,
                    existingValue: existingValue,
                    newValue: newValue,
                    chosenValue: chosenValue,
                    reason: reason
                });
            }
        });

        // AI arbitration for the non-decisive conflicts — one batched request
        if (pendingAiConflicts.length > 0) {
            const eventTitle = newEvent.title || existingEvent.title || 'event';
            const aiConfig = this.getMergeArbitrationConfig(newEvent, options.globalConfig);
            let arbitration = null;
            try {
                arbitration = await this.arbitrateMergeConflicts({
                    conflicts: pendingAiConflicts,
                    labels: ['existing', 'incoming'],
                    aiConfig,
                    httpAdapter: options.httpAdapter,
                    eventContext: `"${eventTitle}" starting ${this.serializeArbitrationValue('startDate', newEvent.startDate || existingEvent.startDate) || 'unknown'} (record "existing" from ${existingEvent.source || 'unknown'}, record "incoming" from ${newEvent.source || 'unknown'})`,
                    organizer: this.getKnownOrganizer(newEvent, existingEvent)
                });
            } catch (error) {
                console.warn(`🤝 AI MERGE: arbitration failed for "${eventTitle}": ${error.message}`);
            }
            for (const conflict of pendingAiConflicts) {
                const decision = arbitration ? arbitration[conflict.field] : null;
                const pick = decision ? decision.pick : conflict.fallbackPick;
                const chosenValue = conflict.values[pick];
                mergedEvent[conflict.field] = chosenValue;
                if (decision) {
                    console.log(`🤝 AI MERGE: "${eventTitle}" field=${conflict.field} chose ${pick}${decision.reason ? ` — ${decision.reason}` : ''}`);
                }
                mergeDecisions.push({
                    field: conflict.field,
                    existingValue: conflict.values.existing,
                    newValue: conflict.values.incoming,
                    chosenValue: chosenValue,
                    reason: decision ? `ai: ${decision.reason || `chose ${pick}`}` : conflict.fallbackReason
                });
            }
        }

        // _timezoneUnresolved must describe the merged event's DATES, not the base
        // record: the `{ ...newEvent }` spread above copies newEvent's flag even
        // when existing's anchored dates won, and drops existing's flag even when
        // its wall-clock dates won (underscore fields are skipped by the field
        // loop). Recompute the flag from whichever record supplied the final
        // startDate/endDate so downstream re-anchoring still knows.
        {
            const existingWallClock = Boolean(existingEvent._timezoneUnresolved);
            const newWallClock = Boolean(newEvent._timezoneUnresolved);
            if (existingWallClock || newWallClock) {
                const finalDateIsWallClock = (fieldName) => {
                    const value = mergedEvent[fieldName];
                    if (isEmpty(value)) return false;
                    const fromExisting = value === existingEvent[fieldName];
                    const fromNew = value === newEvent[fieldName];
                    if (fromExisting && fromNew) return existingWallClock && newWallClock;
                    if (fromExisting) return existingWallClock;
                    if (fromNew) return newWallClock;
                    // Values always come from one of the two records; fall back to
                    // the base record's flag (mergedEvent started as { ...newEvent }).
                    return newWallClock;
                };
                if (finalDateIsWallClock('startDate') || finalDateIsWallClock('endDate')) {
                    mergedEvent._timezoneUnresolved = true;
                } else {
                    delete mergedEvent._timezoneUnresolved;
                }
            }
        }

        if (mergeDecisions.length > 0) {
            // "updated" means the merge changed the outgoing record: only count
            // fields whose final value differs from what the { ...newEvent }
            // base spread put there. Decisions that PRESERVED the base value
            // stay in mergeDecisions (display/metrics) but not in this line —
            // listing them here as "updated" is how the empty-side wipe hid.
            const changedFields = Array.from(new Set(mergeDecisions
                .filter(decision => !this.mergeValuesEqualForTracking(mergedEvent[decision.field], newEvent[decision.field]))
                .map(decision => decision.field)));
            if (changedFields.length > 0) {
                const previewFields = changedFields.slice(0, 6);
                const extraCount = changedFields.length - previewFields.length;
                const previewText = extraCount > 0
                    ? `${previewFields.join(', ')}, +${extraCount} more`
                    : previewFields.join(', ');
                const existingTitle = existingEvent.title || 'event';
                const newTitle = newEvent.title || 'event';
                console.log(`🔄 PARSER MERGE: "${existingTitle}" (${existingEvent.source}) + "${newTitle}" (${newEvent.source}) → ${changedFields.length} field${changedFields.length === 1 ? '' : 's'} updated (${previewText})`);
            }
        }
        
        return mergedEvent;
    }

    // Create complete merged event object that represents exactly what will be saved
    // Following the 6-step process: 1) scraper object, 2) calendar object, 3) simple merge, 4) gmaps, 5) notes, 6) display
    //
    // url vs website: they are ONE logical field. Notes persist only a "website:"
    // line (url is notes-excluded) and Scriptable cannot read or write the native
    // CalendarEvent.url property, so `website` is the canonical field that merges
    // and round-trips; `url` is just an output view of it (set after the merge).
    // Merging url as a separate field made every Scriptable run see an "empty"
    // calendar url vs a scraped url and flag/clobber url forever.
    async createFinalEventObject(existingEvent, newEvent, options = {}) {
        // STEP 1: Build scraper object using priority list (already done - newEvent)
        const scraperObject = { ...newEvent };
        // Fold a scraped url into the canonical website field when the parser
        // found no website, so the one canonical field carries it into the merge.
        if (this.isEmptyArbitrationValue(scraperObject.website) && scraperObject.url) {
            scraperObject.website = scraperObject.url;
        }

        // STEP 2: Build calendar object using calendar data
        const calendarObject = {
            // Parse existing notes first so native fields below take precedence
            ...this.parseNotesIntoFields(existingEvent.notes || ''),
            // Native calendar fields override any notes-parsed equivalents
            title: existingEvent.title,
            startDate: existingEvent.startDate,
            endDate: existingEvent.endDate,
            location: existingEvent.location,
            notes: existingEvent.notes,
            url: existingEvent.url,
        };
        // The notes-parsed website is canonical. A native url (readable on the
        // web/Node adapter) only fills in when the notes carry no website —
        // Scriptable always reports url as empty, and that empty value must not
        // shadow the notes-parsed website.
        if (this.isEmptyArbitrationValue(calendarObject.website) && existingEvent.url) {
            calendarObject.website = existingEvent.url;
        }

        // STEP 3: Simple merge - respect merge logic, grab from correct object
        const fieldPriorities = newEvent._fieldPriorities || {};
        const mergedObject = {};

        // Get all possible field names from both objects
        const allFields = new Set([
            ...Object.keys(scraperObject),
            ...Object.keys(calendarObject)
        ]);

        // Track clobbered fields for summary logging
        const clobberedFields = [];
        // Fields where an empty scrape kept the calendar value (summary log)
        const calendarKeptFields = [];
        // Genuine conflicts deferred to AI arbitration (strategy "ai")
        const pendingAiConflicts = [];
        // Arbitration outcomes (deterministic, ai, fallback) for display/metrics
        const aiDecisionRecords = [];
        // Both-coordinates location conflict, resolved AFTER arbitration when
        // the final merged address is known (see the location block below).
        let deferredCoordinateDecision = null;

        const mergeTitle = scraperObject.title || calendarObject.title || 'event';

        // Deterministic pre-arbitration rules (URL shape / emoji-twin titles)
        // run before a conflict is queued for AI — both merge paths consult
        // resolveConflictDeterministically so behavior is identical.
        // City context for the city-aware title rule (a bare city title loses
        // to a named title) — the scraper object carries the resolved city; the
        // calendar object may carry one parsed from its notes.
        const mergeContext = { cityKey: scraperObject.city || calendarObject.city || '' };
        const queueArbitrationConflict = (fieldName, calendarValue, scraperValue) => {
            const resolved = this.resolveConflictDeterministically(fieldName, calendarValue, scraperValue, mergeContext);
            if (!resolved) {
                pendingAiConflicts.push({
                    field: fieldName,
                    values: { calendar: calendarValue, scraped: scraperValue }
                });
                return;
            }
            const chosenValue = resolved.winner === 'a' ? calendarValue : scraperValue;
            mergedObject[fieldName] = chosenValue;
            if (resolved.winner === 'b' && !this.mergeValuesEqualForTracking(scraperValue, calendarValue)) {
                clobberedFields.push(fieldName);
            }
            console.log(`🔒 MERGE: "${mergeTitle}" field=${fieldName} resolved deterministically — ${resolved.reason}`);
            aiDecisionRecords.push({
                field: fieldName,
                existingValue: calendarValue,
                newValue: scraperValue,
                chosenValue: chosenValue,
                reason: resolved.reason,
                source: 'deterministic'
            });
        };

        // A scraped endDate that is <= the scraped startDate (zero/negative duration)
        // is a normalization artifact, not data — it must never replace a calendar
        // end that yields positive duration, and it never even becomes a conflict.
        const calendarStartMs = this.toEpochMillis(calendarObject.startDate);
        const calendarEndMs = this.toEpochMillis(calendarObject.endDate);
        const keepCalendarEndOverDegenerateScrape = this.hasDegenerateEnd(scraperObject)
            && calendarStartMs !== null && calendarEndMs !== null && calendarEndMs > calendarStartMs;
        if (keepCalendarEndOverDegenerateScrape) {
            console.warn(`⚠️ MERGE: "${mergeTitle}" scraped endDate <= startDate (zero duration) — treating as missing, keeping calendar end`);
        }

        // Apply merge logic for each field
        for (const fieldName of allFields) {
            // Skip internal fields. 'url' is an alias/view of 'website' (folded
            // into website above) — it must never merge, clobber, or be logged
            // as a separate field; website is the only field that merges.
            if (fieldName.startsWith('_') || fieldName === 'notes' || fieldName === 'url') continue;

            // gmaps is DERIVED (a pure function of the merged bar + address) —
            // it never merges or arbitrates; STEP 4 below regenerates it from
            // the final merged bar/address so it can never disagree with them.
            if (fieldName === 'gmaps') continue;

            const priorityConfig = fieldPriorities[fieldName];
            const mergeStrategy = priorityConfig?.merge || 'upsert';
            const scraperValue = scraperObject[fieldName];
            const calendarValue = calendarObject[fieldName];

            if (fieldName === 'endDate' && keepCalendarEndOverDegenerateScrape) {
                mergedObject[fieldName] = calendarValue;
                continue;
            }

            if (fieldName === 'location') {
                // location is ALWAYS coordinates (the calendar is the database; the
                // normalization layer fills this field with coordinates). Resolve it
                // deterministically — never via AI: scraped coordinates win over a
                // non-coordinate calendar value; else calendar coordinates are KEPT
                // (an empty or text scrape must not wipe them); when neither side is
                // coordinates, fall through to the configured merge strategy
                // (clobber semantics today).
                if (this.isCoordinatePair(scraperValue)) {
                    if (this.isCoordinatePair(calendarValue)) {
                        // Both sides are coordinates: whether the fresh geocode may
                        // replace the stored pin depends on whether this event's
                        // ADDRESS actually changed this run — and the address may
                        // still be pending AI arbitration at this point in the
                        // loop, so the decision is deferred until after
                        // arbitration, when the final merged address is known.
                        deferredCoordinateDecision = { scraperValue, calendarValue };
                        continue;
                    }
                    mergedObject[fieldName] = scraperValue;
                    if (!this.mergeValuesEqualForTracking(scraperValue, calendarValue)) {
                        clobberedFields.push(fieldName);
                    }
                    continue;
                }
                if (this.isCoordinatePair(calendarValue)) {
                    mergedObject[fieldName] = calendarValue;
                    if (scraperValue !== calendarValue) {
                        console.log(`📍 MERGE: "${mergeTitle}" location kept calendar coordinates over scraped text/empty value`);
                    }
                    continue;
                }
                // Neither side is coordinates: an empty/whitespace scraped
                // location is an extraction gap, not data — under clobber
                // semantics it wiped a calendar's text location (observed
                // 2026-07-12: "clobbered 4 fields (… location)" on the Atlanta
                // event). Text-vs-text still falls through to the configured
                // merge strategy below.
                if (this.isEmptyArbitrationValue(scraperValue)
                    && !this.isEmptyArbitrationValue(calendarValue)) {
                    mergedObject[fieldName] = calendarValue;
                    console.log(`📍 MERGE: "${mergeTitle}" location kept from calendar (scrape found none)`);
                    continue;
                }
            }

            // bearReview is a human-owned review flag: the bear-check cascade
            // writes it, the calendar owner edits it (e.g. to "confirmed") —
            // the calendar's value ALWAYS wins over a fresh scrape's flag, and
            // the field never enters clobber/arbitration tracking (a fresh flag
            // differing from the human's edit would otherwise churn every run).
            if (fieldName === 'bearReview') {
                mergedObject[fieldName] = !this.isEmptyArbitrationValue(calendarValue)
                    ? calendarValue
                    : scraperValue;
                continue;
            }

            // An empty scraped value is an extraction gap, never a deletion
            // instruction — deleting data is the calendar owner's job. Any
            // field the scrape came back empty on keeps the calendar's value,
            // ending clear-on-empty-scrape semantics for clobber/ai strategies
            // (upsert/preserve already kept the calendar value). startDate/
            // endDate are excluded: their own rules above/below own them
            // (degenerate-end, routeDateConflictToAi); key is scraper-owned.
            // location and bearReview never reach here empty-vs-non-empty —
            // their special cases above already continue.
            if (fieldName !== 'startDate' && fieldName !== 'endDate' && fieldName !== 'key'
                && this.isEmptyArbitrationValue(scraperValue)
                && !this.isEmptyArbitrationValue(calendarValue)) {
                mergedObject[fieldName] = calendarValue;
                if (fieldName === 'bar') {
                    console.log(`📍 MERGE: "${mergeTitle}" bar kept from calendar (scrape found no venue)`);
                } else {
                    calendarKeptFields.push(fieldName);
                }
                continue;
            }

            // Cover is priced by the LIVE ticket page: the calendar copy is just
            // last run's snapshot, so AI arbitration (which has no freshness
            // signal) is the wrong tool. Under the default "ai" strategy
            // (explicit parser-config strategies still win):
            // - formatting twins (whitespace-only difference, e.g.
            //   "$22.10 - $39.98" vs "$22.10-$39.98") are the SAME price — the
            //   calendar value is kept: no conflict, no AI call, no clobber entry;
            // - genuinely different prices take the scraped (fresh) value
            //   deterministically. An empty scraped cover never reaches here —
            //   the empty-scrape rule above already kept the calendar value.
            if (fieldName === 'cover' && mergeStrategy === 'ai'
                && !this.isEmptyArbitrationValue(scraperValue)
                && !this.isEmptyArbitrationValue(calendarValue)) {
                const serializedScraped = this.serializeArbitrationValue(fieldName, scraperValue);
                const serializedCalendar = this.serializeArbitrationValue(fieldName, calendarValue);
                if (this.coverValuesEquivalent(serializedScraped, serializedCalendar)) {
                    mergedObject[fieldName] = calendarValue;
                    continue;
                }
                if (serializedScraped !== serializedCalendar) {
                    const freshnessReason = 'cover reflects the live ticket page — freshness wins';
                    mergedObject[fieldName] = scraperValue;
                    clobberedFields.push(fieldName);
                    console.log(`🔒 MERGE: "${mergeTitle}" field=${fieldName} resolved deterministically — ${freshnessReason}`);
                    aiDecisionRecords.push({
                        field: fieldName,
                        existingValue: calendarValue,
                        newValue: scraperValue,
                        chosenValue: scraperValue,
                        reason: freshnessReason,
                        source: 'deterministic'
                    });
                    continue;
                }
                // Identical values fall through to the configured strategy (no-op).
            }

            // Dates are calendar-critical: a genuinely different startDate/endDate is
            // arbitrated even when a parser config says clobber — silently overwriting
            // a differing calendar date is how good ends get destroyed. A failed
            // arbitration still falls back to the scraped value (exactly clobber).
            const routeDateConflictToAi = (fieldName === 'startDate' || fieldName === 'endDate')
                && mergeStrategy === 'clobber'
                && this.isArbitrationEligibleField(fieldName)
                && this.isGenuineFieldConflict(fieldName, calendarValue, scraperValue);
            if (routeDateConflictToAi) {
                queueArbitrationConflict(fieldName, calendarValue, scraperValue);
                continue;
            }

            switch (mergeStrategy) {
                case 'ai':
                    if (this.isArbitrationEligibleField(fieldName)
                        && this.isGenuineFieldConflict(fieldName, calendarValue, scraperValue)) {
                        queueArbitrationConflict(fieldName, calendarValue, scraperValue);
                        break;
                    }
                    // No genuine conflict → clobber semantics (today's default),
                    // including clear-on-empty-scrape
                    mergedObject[fieldName] = scraperValue;
                    if (!this.mergeValuesEqualForTracking(scraperValue, calendarValue)) {
                        clobberedFields.push(fieldName);
                    }
                    break;
                case 'clobber':
                    mergedObject[fieldName] = scraperValue;
                    // Track when clobber actually changes a value
                    if (!this.mergeValuesEqualForTracking(scraperValue, calendarValue)) {
                        clobberedFields.push(fieldName);
                    }
                    break;
                case 'upsert':
                    mergedObject[fieldName] = calendarValue || scraperValue;
                    break;
                case 'preserve':
                default:
                    mergedObject[fieldName] = calendarValue;
                    break;
            }
        }

        // STEP 3b: AI arbitration for genuine conflicts — one batched request.
        // Any field the AI can't decide (or a dead/hallucinating model) falls back
        // to clobber, i.e. exactly the pre-arbitration behavior.
        if (pendingAiConflicts.length > 0) {
            const eventTitle = scraperObject.title || calendarObject.title || 'event';
            const aiConfig = this.getMergeArbitrationConfig(newEvent, options.globalConfig);
            const eventContext = `"${eventTitle}" starting ${this.serializeArbitrationValue('startDate', scraperObject.startDate || calendarObject.startDate) || 'unknown'}`;
            let arbitration = null;
            try {
                arbitration = await this.arbitrateMergeConflicts({
                    conflicts: pendingAiConflicts,
                    labels: ['calendar', 'scraped'],
                    aiConfig,
                    httpAdapter: options.httpAdapter,
                    eventContext,
                    organizer: this.getKnownOrganizer(scraperObject, calendarObject)
                });
            } catch (error) {
                console.warn(`🤝 AI MERGE: arbitration failed for "${eventTitle}": ${error.message}`);
            }
            if (!arbitration) {
                console.warn(`🤝 AI MERGE: no arbitration result for "${eventTitle}" — falling back to scraped values for ${pendingAiConflicts.length} conflicted field(s)`);
            }
            const preview = (value) => {
                const text = this.serializeArbitrationValue('', value);
                return text.length > 60 ? `${text.slice(0, 57)}...` : text;
            };
            for (const conflict of pendingAiConflicts) {
                const decision = arbitration ? arbitration[conflict.field] : null;
                if (decision) {
                    const otherPick = decision.pick === 'calendar' ? 'scraped' : 'calendar';
                    mergedObject[conflict.field] = conflict.values[decision.pick];
                    if (decision.pick === 'scraped' && !this.mergeValuesEqualForTracking(conflict.values.scraped, conflict.values.calendar)) {
                        clobberedFields.push(conflict.field);
                    }
                    console.log(`🤝 AI MERGE: "${eventTitle}" field=${conflict.field} chose ${decision.pick} ("${preview(conflict.values[decision.pick])}") over ${otherPick} ("${preview(conflict.values[otherPick])}")${decision.reason ? ` — ${decision.reason}` : ''}`);
                    aiDecisionRecords.push({
                        field: conflict.field,
                        existingValue: conflict.values.calendar,
                        newValue: conflict.values.scraped,
                        chosenValue: conflict.values[decision.pick],
                        reason: decision.reason || `ai chose ${decision.pick}`,
                        source: 'ai'
                    });
                } else {
                    mergedObject[conflict.field] = conflict.values.scraped;
                    if (!this.mergeValuesEqualForTracking(conflict.values.scraped, conflict.values.calendar)) {
                        clobberedFields.push(conflict.field);
                    }
                    aiDecisionRecords.push({
                        field: conflict.field,
                        existingValue: conflict.values.calendar,
                        newValue: conflict.values.scraped,
                        chosenValue: conflict.values.scraped,
                        reason: 'ai unavailable/rejected — clobber fallback',
                        source: 'fallback'
                    });
                }
            }
        }

        // STEP 3c: deferred both-coordinates location decision — resolved only
        // now because the final address may have been decided by arbitration
        // above. The stored pin may be human-corrected, so it is only replaced
        // when the venue actually MOVED (the final merged address differs from
        // the calendar's stored address). When the address is unchanged the
        // calendar pin is kept, and a large divergence from the fresh geocode
        // is FLAGGED for review — never silently applied or dropped.
        if (deferredCoordinateDecision) {
            const { scraperValue, calendarValue } = deferredCoordinateDecision;
            const normalizeAddressForComparison = (value) =>
                String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase();
            const calendarAddress = normalizeAddressForComparison(calendarObject.address);
            const finalAddress = normalizeAddressForComparison(
                Object.prototype.hasOwnProperty.call(mergedObject, 'address') ? mergedObject.address : calendarObject.address
            );
            // "Unchanged" requires a stored calendar address to compare against:
            // with no address on record there is no venue-stability signal, and
            // the scraped (fresher) coordinates win as they always have.
            const addressUnchanged = calendarAddress !== '' && finalAddress === calendarAddress;
            if (addressUnchanged) {
                mergedObject.location = calendarValue;
                if (scraperValue !== calendarValue) {
                    console.log(`📍 MERGE: "${mergeTitle}" location kept calendar pin (address unchanged)`);
                    const distanceKm = this.coordinatePairDistanceKm(calendarValue, scraperValue);
                    if (distanceKm !== null && distanceKm > PIN_MOVED_THRESHOLD_KM) {
                        console.log(`📍 MERGE: "${mergeTitle}" calendar pin is ${distanceKm.toFixed(1)}km from fresh geocode of the same address — verify pin`);
                    }
                }
            } else {
                mergedObject.location = scraperValue;
                if (!this.mergeValuesEqualForTracking(scraperValue, calendarValue)) {
                    clobberedFields.push('location');
                }
            }
        }

        // STEP 4: regenerate gmaps from the FINAL merged bar + address. gmaps
        // is a derived field — a pure function of bar + address — so merging or
        // arbitrating it independently let it disagree with the merged
        // bar/address (and churn arbitration every run). Regeneration happens
        // only when the field is actually in play (either side carries a
        // non-empty gmaps — the normalizer builds one for every scraped event)
        // AND there is a bar or address to derive from; otherwise whatever
        // existed is kept (calendar first), and an absent field stays absent.
        {
            const finalBar = typeof mergedObject.bar === 'string' ? mergedObject.bar.trim() : '';
            const finalAddressForGmaps = typeof mergedObject.address === 'string' ? mergedObject.address.trim() : '';
            const calendarHasGmaps = !this.isEmptyArbitrationValue(calendarObject.gmaps);
            const scraperHasGmaps = !this.isEmptyArbitrationValue(scraperObject.gmaps);
            let finalGmaps = calendarHasGmaps
                ? calendarObject.gmaps
                : (scraperHasGmaps ? scraperObject.gmaps : '');
            if ((calendarHasGmaps || scraperHasGmaps) && (finalBar || finalAddressForGmaps)) {
                const regenerated = SharedCore.generateGoogleMapsUrl({
                    coordinates: null,
                    placeId: null,
                    address: finalAddressForGmaps || null,
                    venueName: finalBar || null,
                    cityName: null
                });
                if (regenerated) finalGmaps = regenerated;
            }
            if (finalGmaps !== '' || allFields.has('gmaps')) {
                mergedObject.gmaps = finalGmaps;
            }
            // Clobber tracking stays honest: gmaps counts as changed only when
            // the final value actually differs from the calendar's.
            const calendarGmaps = calendarHasGmaps ? String(calendarObject.gmaps).trim() : '';
            if (String(finalGmaps || '').trim() !== calendarGmaps) {
                clobberedFields.push('gmaps');
            }
        }

        if (calendarKeptFields.length > 0) {
            console.log(`📍 MERGE: "${mergeTitle}" kept calendar values for empty-scraped field(s): ${calendarKeptFields.join(', ')}`);
        }

        // Log summary of clobbered fields
        if (clobberedFields.length > 0) {
            const previewFields = clobberedFields.slice(0, 6);
            const extraCount = clobberedFields.length - previewFields.length;
            const previewText = extraCount > 0
                ? `${previewFields.join(', ')}, +${extraCount} more`
                : previewFields.join(', ');
            console.log(`🔄 MERGE: "${mergedObject.title || 'event'}" clobbered ${clobberedFields.length} field${clobberedFields.length === 1 ? '' : 's'} (${previewText})`);
        }
        
        // STEP 5: Build new notes from merged object
        const newNotes = this.formatEventNotes(mergedObject);
        
        // Create the final event object that represents exactly what will be saved
        const finalEvent = {
            // Core calendar fields
            title: mergedObject.title || calendarObject.title,
            startDate: mergedObject.startDate || calendarObject.startDate,
            endDate: mergedObject.endDate || calendarObject.endDate,
            location: mergedObject.location || calendarObject.location,
            notes: newNotes,
            // url is a VIEW of the canonical merged website (one logical field) —
            // kept because the web adapter and display read event.url; it is
            // never independently stored ('url' is skipped by the merge loop, so
            // the mergedObject spread below cannot override this).
            url: mergedObject.website || '',
            
            // Copy all merged fields to final event
            ...mergedObject,
            
            // Override notes with the newly built ones
            notes: newNotes,
            
            // Preserve existing event reference for saving
            _existingEvent: existingEvent,
            _action: 'merge',
            
            // Keep metadata for display and comparison tables
            city: newEvent.city,
            source: newEvent.source,
            _parserConfig: newEvent._parserConfig,
            _fieldPriorities: newEvent._fieldPriorities
        };
        
        // STEP 6: Pass all three objects to rich display for comparison
        
        // Store the three objects for display comparison
        finalEvent._original = {
            scraper: scraperObject,    // What the scraper found
            calendar: calendarObject,  // What was in the calendar
            merged: mergedObject       // What the merge logic produced
        };

        // Expose AI arbitration outcomes for display/metrics
        if (aiDecisionRecords.length > 0) {
            finalEvent._mergeDecisions = aiDecisionRecords;
            finalEvent._original.aiArbitration = {
                arbitrated: aiDecisionRecords.filter(record => record.source === 'ai').map(record => record.field),
                fallbacks: aiDecisionRecords.filter(record => record.source === 'fallback').map(record => record.field),
                deterministic: aiDecisionRecords.filter(record => record.source === 'deterministic').map(record => record.field)
            };
        }
        
        // Simple change detection for display
        const changes = [];
        if (finalEvent.title !== existingEvent.title) changes.push('title');
        if (!this.datesEqualForDisplay(finalEvent.startDate, existingEvent.startDate)) changes.push('startDate');
        if (!this.datesEqualForDisplay(finalEvent.endDate, existingEvent.endDate)) changes.push('endDate');
        if (finalEvent.location !== existingEvent.location) changes.push('location');
        // url is an output view of website (one logical field): compare the
        // canonical merged website against the calendar's canonical website
        // (which already folds in a real native url when the notes had none).
        // The 'url' label is kept for display continuity. Comparing a scraped
        // url against Scriptable's always-empty native url flagged 'url' on
        // every run.
        if (finalEvent.url !== (calendarObject.website || '')) changes.push('url');
        if (finalEvent.notes !== existingEvent.notes) changes.push('notes');
        
        finalEvent._changes = changes;
        
        return finalEvent;
    }

    // ============================================================================
    // ESCAPE CHARACTER UTILITIES - Handle escaped colons in text
    // ============================================================================
    // 
    // Problem: Time formats like "Doors open at 9:00" were being parsed as metadata
    // Solution: Use backslash (\) to escape colons that should not be treated as separators
    // 
    // Examples:
    //   "Doors open at 9\:00 PM"     -> Not parsed as metadata (colon is escaped)
    //   "venue: The Bear Den"         -> Parsed as metadata (single-word key)
    //   "doors open at 9: 00"         -> Not parsed as metadata (multi-word key rejected)
    //   "description: Show at 8\:30"  -> Parsed as metadata, value = "Show at 8:30"
    // 
    // Escape Rules:
    //   \: -> :     (escaped colon becomes literal colon)
    //   \\ -> \     (escaped backslash becomes literal backslash)
    //   
    // Key Validation:
    //   - Must be single word (no spaces)
    //   - Must start with letter
    //   - Must be 2-20 characters long
    //   - Must be alphanumeric only
    // ============================================================================
    
    // Find first unescaped occurrence of a character in text
    findUnescaped(text, char, startIndex = 0) {
        return this.eventSchema.findUnescaped(text, char, startIndex);
    }
    
    // Remove escape characters from text
    unescapeText(text) {
        return this.eventSchema.unescapeText(text);
    }
    
    // Add escape characters to text to prevent parsing issues
    escapeText(text) {
        return this.eventSchema.escapeText(text);
    }
    
    // Check if a key is valid for metadata (words with spaces allowed, reasonable length)
    isValidMetadataKey(key) {
        return this.eventSchema.isValidMetadataKey(key);
    }
    
    // Parse notes back into field/value pairs
    parseNotesIntoFields(notes) {
        return this.eventSchema.parseNotesIntoFields(notes);
    }
    
    // Build notes from field/value pairs
    buildNotesFromFields(fields) {
        if (!fields || typeof fields !== 'object') return '';
        const lines = [];
        
        // Just add all fields that have values
        Object.keys(fields).forEach(key => {
            const value = fields[key];
            if (value !== undefined && value !== null && value !== '') {
                // Escape selectively: do not escape URL-like fields
                const valueString = String(value);
                const valueForNotes = this.eventSchema.isUrlLikeField(key, valueString)
                    ? valueString
                    : this.eventSchema.escapeText(valueString);
                lines.push(`${key}: ${valueForNotes}`);
            }
        });
        
        return lines.join('\n');
    }

    // Normalize multi-line text to ensure consistent formatting
    // This helps prevent subtle whitespace differences between scraper runs
    normalizeMultilineText(text) {
        if (!text || typeof text !== 'string') {
            return text;
        }
        
        // Comprehensive text normalization to prevent whitespace differences from causing merge issues
        return text
            .trim()                           // Remove leading/trailing whitespace
            .replace(/\s+\n/g, '\n')         // Remove trailing spaces before newlines
            .replace(/\n\s+/g, '\n')         // Remove leading spaces after newlines
            .replace(/\s{2,}/g, ' ')         // Collapse multiple spaces into single spaces
            .replace(/\n{3,}/g, '\n\n');     // Collapse multiple newlines into double newlines
    }

    // Normalize text fields in an event object to ensure consistent comparison
    // This centralizes all text normalization logic in shared-core
    normalizeEventTextFields(event) {
        if (!event) return event;
        
        // Create a copy to avoid modifying the original
        const normalizedEvent = { ...event };
        
        // Remove empty/whitespace-only strings so undefined/"" don't diverge
        Object.keys(normalizedEvent).forEach(key => {
            if (key.startsWith('_')) return;
            const value = normalizedEvent[key];
            if (typeof value === 'string' && value.trim() === '') {
                delete normalizedEvent[key];
            }
        });
        
        // Description field is now saved and read literally - no normalization
        // We could normalize other text fields here if needed in the future
        // For example: title, bar, address, etc.

        // Allow source descriptions to carry override identity metadata.
        // This keeps website-sourced override events aligned with URL-input behavior.
        this.applyDescriptionOverrideIdentity(normalizedEvent);
        
        return normalizedEvent;
    }

    applyDescriptionOverrideIdentity(event) {
        if (!event || typeof event !== 'object') {
            return event;
        }

        const explicitOverrideUid = this.normalizeOverrideUid(event.overrideUid);
        const explicitOverrideRecurrenceId = this.normalizeOverrideRecurrenceId(event.overrideRecurrenceId);
        const hasExplicitOverrideUid = Boolean(explicitOverrideUid);
        const hasExplicitOverrideRecurrenceId = Boolean(explicitOverrideRecurrenceId);

        if (hasExplicitOverrideUid !== hasExplicitOverrideRecurrenceId) {
            throw new Error('Event override identity requires both overrideUid and overrideRecurrenceId');
        }

        let resolvedOverrideUid = explicitOverrideUid;
        let resolvedOverrideRecurrenceId = explicitOverrideRecurrenceId;

        if (!resolvedOverrideUid && !resolvedOverrideRecurrenceId) {
            const description = typeof event.description === 'string' ? event.description.trim() : '';
            if (description) {
                const descriptionFields = this.parseNotesIntoFields(description);
                const descriptionOverrideUid = this.normalizeOverrideUid(descriptionFields.overrideUid);
                const descriptionOverrideRecurrenceId = this.normalizeOverrideRecurrenceId(descriptionFields.overrideRecurrenceId);
                const hasDescriptionOverrideUid = Boolean(descriptionOverrideUid);
                const hasDescriptionOverrideRecurrenceId = Boolean(descriptionOverrideRecurrenceId);

                if (hasDescriptionOverrideUid !== hasDescriptionOverrideRecurrenceId) {
                    throw new Error('Description override identity requires both override uid and override recurrence id');
                }

                if (hasDescriptionOverrideUid && hasDescriptionOverrideRecurrenceId) {
                    resolvedOverrideUid = descriptionOverrideUid;
                    resolvedOverrideRecurrenceId = descriptionOverrideRecurrenceId;
                }
            }
        }

        if (resolvedOverrideUid && resolvedOverrideRecurrenceId) {
            event.overrideUid = resolvedOverrideUid;
            event.overrideRecurrenceId = resolvedOverrideRecurrenceId;
        }

        return event;
    }

    // Helper method to normalize event dates for consistent comparison across timezones
    normalizeEventDate(dateInput) {
        return SharedCore.normalizeEventDate(dateInput);
    }

    // Offset (in minutes) of `timezone` from UTC at the given instant
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

    // Reinterpret a date whose UTC components actually hold local wall-clock time in `timezone`
    // (the ai-web parser's timezone-less fallback stores dates that way, flagged via
    // event._timezoneUnresolved) as the real UTC instant. Iterates because the offset guess
    // can be wrong near DST transitions.
    convertWallClockDateToUtc(dateInput, timezone) {
        if (!dateInput || !timezone) return null;
        const date = new Date(dateInput);
        if (isNaN(date.getTime())) return null;
        const baseUtcMillis = date.getTime();
        let utcMillis = baseUtcMillis;
        for (let i = 0; i < 4; i++) {
            const offsetMinutes = this.getTimezoneOffsetMinutes(new Date(utcMillis), timezone);
            if (!Number.isFinite(offsetMinutes)) return null;
            const nextUtcMillis = baseUtcMillis - (offsetMinutes * 60 * 1000);
            if (nextUtcMillis === utcMillis) break;
            utcMillis = nextUtcMillis;
        }
        return new Date(utcMillis);
    }

    // The ai-web parser stores extracted local times as wall-clock components labeled
    // UTC when it cannot resolve a timezone at parse time (flagged via
    // event._timezoneUnresolved). Once a timezone/city is known — during normalization
    // or resolved later by a merge — convert those wall-clock values to real UTC
    // instants and clear the flag. Shared seam: LocationNormalizer.resolveWallClockDates
    // delegates here, and deduplicateEvents runs it post-merge for events whose city
    // was only resolved during merge arbitration. Log strings intentionally keep the
    // LocationNormalizer prefix so existing log consumers keep working.
    resolveWallClockDates(event) {
        if (!event || !event._timezoneUnresolved) return event;

        const timezone = event.timezone
            || (event.city && this.cities && this.cities[event.city]?.timezone)
            || '';
        if (!timezone) {
            const title = event.title || 'unknown';
            this.warnOnce(
                `wallclock:${title}`,
                `🚨 LocationNormalizer: Could not resolve timezone for "${title}" (city: "${event.city || 'unknown'}") — dates remain wall-clock UTC and may be wrong`
            );
            return event;
        }

        const reanchor = (value) => {
            if (!value) return value;
            const converted = this.convertWallClockDateToUtc(value, timezone);
            if (!converted || isNaN(converted.getTime())) return value;
            return value instanceof Date ? converted : converted.toISOString();
        };

        const originalStart = event.startDate;
        event.startDate = reanchor(event.startDate);
        event.endDate = reanchor(event.endDate);
        event.timezone = timezone;
        delete event._timezoneUnresolved;

        const format = (value) => value instanceof Date ? value.toISOString() : String(value);
        console.log(`🗺️ LocationNormalizer: Re-anchored wall-clock dates to ${timezone} — start ${format(originalStart)} → ${format(event.startDate)}`);
        return event;
    }

    // Normalize event date using local or specified timezone
    normalizeEventDateLocal(dateInput, timezone = null) {
        if (!dateInput) return '';
        
        try {
            const date = new Date(dateInput);
            if (isNaN(date.getTime())) return '';
            
            if (timezone && typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
                try {
                    const formatter = new Intl.DateTimeFormat('en-CA', {
                        timeZone: timezone,
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit'
                    });
                    const parts = formatter.formatToParts(date);
                    const year = parts.find(part => part.type === 'year')?.value;
                    const month = parts.find(part => part.type === 'month')?.value;
                    const day = parts.find(part => part.type === 'day')?.value;
                    if (year && month && day) {
                        return `${year}-${month}-${day}`;
                    }
                } catch (error) {
                    console.warn(`⚠️ SharedCore: Failed to format date for timezone "${timezone}": ${error.message}`);
                }
            }
            
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            
            return `${year}-${month}-${day}`;
        } catch (error) {
            console.warn(`⚠️ SharedCore: Failed to normalize local date: ${dateInput}`);
            return '';
        }
    }

    // Compare two date inputs for display equality, avoiding timezone-related false diffs
    datesEqualForDisplay(a, b) {
        if (a === b) return true;
        if (!a || !b) return false;
        const da = new Date(a);
        const db = new Date(b);
        if (isNaN(da.getTime()) || isNaN(db.getTime())) {
            return String(a) === String(b);
        }
        if (da.getTime() === db.getTime()) return true;
        try {
            return da.toLocaleString() === db.toLocaleString();
        } catch (e) {
            return da.toString() === db.toString();
        }
    }

    // URL processing utilities
    
    // Scriptable-compatible URL parsing utility
    parseUrl(url) {
        if (!url || typeof url !== 'string') return null;
        
        try {
            // Simple regex-based URL parsing that works in Scriptable
            const urlPattern = /^(https?:)\/\/([^\/]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/;
            const match = url.match(urlPattern);
            
            if (!match) return null;
            
            const [, protocol, host, pathname = '/', search = '', hash = ''] = match;
            
            return {
                protocol,
                host,
                hostname: host.split(':')[0], // Remove port if present
                pathname,
                search,
                hash,
                href: url
            };
        } catch (error) {
            return null;
        }
    }
    
    extractUrls(html, patterns, baseUrl) {
        const urls = new Set();
        
        for (const pattern of patterns) {
            const regex = new RegExp(pattern.regex, 'gi');
            let match;
            
            while ((match = regex.exec(html)) !== null && urls.size < (pattern.maxMatches || 10)) {
                const url = this.normalizeUrl(match[1], baseUrl);
                if (this.isValidUrl(url)) {
                    urls.add(url);
                }
            }
        }
        
        return Array.from(urls);
    }

    normalizeUrl(url, baseUrl) {
        if (!url) return null;

        let normalized = this.decodeBasicEntities(this.decodeUrlEscapes(String(url))).replace(/&amp;/gi, '&');
        normalized = normalized.replace(/[),.;]+$/, '').trim();
        if (!normalized) return null;

        if (/^(#|javascript:|mailto:|tel:|sms:)/i.test(normalized)) {
            return null;
        }

        if (normalized.startsWith('//')) {
            const base = this.parseUrl(baseUrl);
            if (base && base.protocol) {
                return `${base.protocol}${normalized}`;
            }
            return `https:${normalized}`;
        }

        try {
            const resolved = new URL(normalized, baseUrl).toString();
            return resolved;
        } catch (_) {}

        if (normalized.startsWith('/')) {
            const base = this.parseUrl(baseUrl);
            if (base && base.protocol && base.host) {
                return `${base.protocol}//${base.host}${normalized}`;
            }
        }

        return normalized;
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

    decodeBasicEntities(text) {
        return String(text || '')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'");
    }

    isValidUrl(url) {
        if (!url || typeof url !== 'string') return false;
        
        const parsed = this.parseUrl(url);
        return parsed !== null;
    }

    // Date utilities
    parseDate(dateString) {
        if (!dateString) return null;
        
        // Try various date formats
        const formats = [
            // ISO formats
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
            // Common formats
            /^\d{1,2}\/\d{1,2}\/\d{4}/,
            /^\d{4}-\d{2}-\d{2}/,
        ];
        
        for (const format of formats) {
            if (format.test(dateString)) {
                const date = new Date(dateString);
                if (!isNaN(date.getTime())) {
                    return date;
                }
            }
        }
        
        // Fallback to Date constructor
        const date = new Date(dateString);
        return isNaN(date.getTime()) ? null : date;
    }

    parseAppleRecurrenceId(value) {
        const seconds = Number(value);
        if (!Number.isFinite(seconds)) return null;
        const baseMillis = Date.UTC(2001, 0, 1, 0, 0, 0, 0);
        const millis = baseMillis + seconds * 1000;
        const date = new Date(millis);
        return isNaN(date.getTime()) ? null : date;
    }

    parseScriptableIdentifier(value) {
        if (!value) return { uid: null, recurrenceDate: null };
        const raw = String(value).trim();
        if (!raw) return { uid: null, recurrenceDate: null };
        const colonIndex = raw.indexOf(':');
        const afterColon = colonIndex >= 0 ? raw.slice(colonIndex + 1) : raw;
        const ridMatch = afterColon.match(/\/RID=(\d+)/i);
        const uid = ridMatch ? afterColon.slice(0, ridMatch.index) : afterColon;
        const recurrenceDate = ridMatch ? this.parseAppleRecurrenceId(ridMatch[1]) : null;
        return {
            uid: uid && uid.length > 0 ? uid : null,
            recurrenceDate
        };
    }

    formatOverrideRecurrenceIdFromDate(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
            return '';
        }
        const year = String(date.getUTCFullYear());
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        const hour = String(date.getUTCHours()).padStart(2, '0');
        const minute = String(date.getUTCMinutes()).padStart(2, '0');
        const second = String(date.getUTCSeconds()).padStart(2, '0');
        return `${year}${month}${day}T${hour}${minute}${second}Z`;
    }

    findEventByOverrideKey(existingEventsData, overrideUid, overrideRecurrenceId) {
        if (!Array.isArray(existingEventsData) || existingEventsData.length === 0) {
            return null;
        }
        const normalizedUid = this.normalizeOverrideUid(overrideUid);
        const normalizedRecurrenceId = this.normalizeOverrideRecurrenceId(overrideRecurrenceId);
        if (!normalizedUid || !normalizedRecurrenceId) {
            return null;
        }
        const targetOverrideKey = `${normalizedUid.toLowerCase()}::${normalizedRecurrenceId}`;
        for (const existingEvent of existingEventsData) {
            const fields = this.parseNotesIntoFields(existingEvent.notes || '');
            const existingOverrideUid = this.normalizeOverrideUid(fields.overrideUid);
            const existingOverrideRecurrenceId = this.normalizeOverrideRecurrenceId(fields.overrideRecurrenceId);
            if (!existingOverrideUid || !existingOverrideRecurrenceId) {
                continue;
            }
            const existingOverrideKey = `${existingOverrideUid.toLowerCase()}::${existingOverrideRecurrenceId}`;
            if (existingOverrideKey === targetOverrideKey) {
                return {
                    event: existingEvent,
                    existingKey: targetOverrideKey
                };
            }
        }
        return null;
    }

    // Find all existing events with a matching identifier UID, regardless of date.
    // Used as a fallback when findEventByKey fails due to a date mismatch — for example
    // when an existing override event was saved with a user-edited start time that differs
    // from the searchStartDate derived from the original recurring occurrence.
    findEventsByIdentifier(existingEvents, identifier) {
        if (!Array.isArray(existingEvents) || existingEvents.length === 0) return [];
        if (!identifier) return [];
        const normalizedIdentifier = String(identifier).trim();
        if (!normalizedIdentifier) return [];
        const targetInfo = this.parseScriptableIdentifier(normalizedIdentifier);
        const targetUid = targetInfo.uid || normalizedIdentifier;
        if (!targetUid) return [];
        const normalizeValue = (value) => {
            if (value === null || value === undefined) return null;
            const normalized = String(value).trim();
            return normalized.length > 0 ? normalized : null;
        };
        return existingEvents.filter(event => {
            if (!event) return false;
            const fields = this.parseNotesIntoFields(event.notes || '');
            const eventIdentifierRaw = normalizeValue(event.identifier || '');
            const eventIdentifierInfo = this.parseScriptableIdentifier(eventIdentifierRaw || '');
            const notesIdentifierRaw = normalizeValue(fields.uid || fields.identifier || fields.id || '');
            const notesIdentifierInfo = this.parseScriptableIdentifier(notesIdentifierRaw || '');
            const eventUid = eventIdentifierInfo.uid || notesIdentifierInfo.uid || notesIdentifierRaw || null;
            return Boolean(eventUid && eventUid === targetUid);
        });
    }

    buildOverrideKey(overrideUid, overrideRecurrenceId) {
        return SharedCore.buildOverrideKey(overrideUid, overrideRecurrenceId);
    }

    getOverrideIdentityFromEvent(existingEvent) {
        if (!existingEvent || typeof existingEvent !== 'object') {
            return null;
        }
        const fields = this.parseNotesIntoFields(existingEvent.notes || '');
        const overrideUid = this.normalizeOverrideUid(
            fields.overrideUid || existingEvent.overrideUid || ''
        );
        const overrideRecurrenceId = this.normalizeOverrideRecurrenceId(
            fields.overrideRecurrenceId || existingEvent.overrideRecurrenceId || ''
        );
        if (!overrideUid || !overrideRecurrenceId) {
            return null;
        }
        return {
            overrideUid,
            overrideRecurrenceId,
            overrideKey: this.buildOverrideKey(overrideUid, overrideRecurrenceId)
        };
    }

    finalizeAnalysisResult(event, analysis) {
        const result = analysis && typeof analysis === 'object'
            ? { ...analysis }
            : { action: 'conflict', reason: 'Invalid analysis result' };

        const existingOverrideIdentity = this.getOverrideIdentityFromEvent(result.existingEvent);

        if (existingOverrideIdentity && existingOverrideIdentity.overrideKey) {
            result.existingKey = existingOverrideIdentity.overrideKey;
        } else if (typeof result.existingKey === 'string' && result.existingKey.includes('::')) {
            const [rawUid, ...rawRecurrenceParts] = result.existingKey.split('::');
            const rawRecurrenceId = rawRecurrenceParts.join('::');
            const normalizedExistingOverrideKey = this.buildOverrideKey(rawUid, rawRecurrenceId);
            if (normalizedExistingOverrideKey) {
                result.existingKey = normalizedExistingOverrideKey;
            }
        }

        return result;
    }

    deriveOverrideIdentityFromSourceEvent(existingEvent) {
        if (!existingEvent || typeof existingEvent !== 'object') {
            return null;
        }
        const fields = this.parseNotesIntoFields(existingEvent.notes || '');
        const normalizeIdentifier = (value) => {
            if (value === null || value === undefined) return null;
            const normalized = String(value).trim();
            return normalized.length > 0 ? normalized : null;
        };
        const eventIdentifierRaw = normalizeIdentifier(existingEvent.identifier || '');
        const eventIdentifierInfo = this.parseScriptableIdentifier(eventIdentifierRaw);
        const notesIdentifierRaw = normalizeIdentifier(fields.uid || fields.identifier || fields.id || '');
        const notesIdentifierInfo = this.parseScriptableIdentifier(notesIdentifierRaw);
        const uid = eventIdentifierInfo.uid || notesIdentifierInfo.uid || notesIdentifierRaw || null;
        if (!uid) {
            return null;
        }

        const recurrenceDate = eventIdentifierInfo.recurrenceDate ||
            notesIdentifierInfo.recurrenceDate ||
            (existingEvent.startDate instanceof Date ? existingEvent.startDate : this.parseDate(existingEvent.startDate));
        const overrideRecurrenceId = this.normalizeOverrideRecurrenceId(this.formatOverrideRecurrenceIdFromDate(recurrenceDate));
        if (!overrideRecurrenceId) {
            return null;
        }

        return {
            overrideUid: uid,
            overrideRecurrenceId: overrideRecurrenceId
        };
    }

    shouldCreateOverrideFromRecurringMatch(existingEvent, existingEventsData = null) {
        if (!existingEvent || typeof existingEvent !== 'object') {
            return false;
        }
        const fields = this.parseNotesIntoFields(existingEvent.notes || '');
        const existingOverrideUid = this.normalizeOverrideUid(fields.overrideUid);
        const existingOverrideRecurrenceId = this.normalizeOverrideRecurrenceId(fields.overrideRecurrenceId);
        if (existingOverrideUid && existingOverrideRecurrenceId) {
            // Existing event is already an override event - merge should remain allowed.
            return false;
        }

        const normalizeIdentifier = (value) => {
            if (value === null || value === undefined) return null;
            const normalized = String(value).trim();
            return normalized.length > 0 ? normalized : null;
        };
        const eventIdentifierRaw = normalizeIdentifier(existingEvent.identifier || '');
        const eventIdentifierInfo = this.parseScriptableIdentifier(eventIdentifierRaw);
        if (eventIdentifierInfo.recurrenceDate) {
            return true;
        }
        const notesIdentifierRaw = normalizeIdentifier(fields.uid || fields.identifier || fields.id || '');
        const notesIdentifierInfo = this.parseScriptableIdentifier(notesIdentifierRaw);
        if (notesIdentifierInfo.recurrenceDate) {
            return true;
        }
        const recurrenceRule = fields.recurrence || existingEvent.recurrence;
        if (recurrenceRule) {
            return true;
        }

        // Scriptable can return recurring instances without explicit recurrence fields.
        // If multiple events in the current candidate set share a UID on different dates,
        // treat this as recurring so edits create overrides instead of mutating originals.
        const sourceUid = eventIdentifierInfo.uid || notesIdentifierInfo.uid || notesIdentifierRaw || null;
        const normalizedSourceUid = this.normalizeOverrideUid(sourceUid);
        if (!normalizedSourceUid || !Array.isArray(existingEventsData) || existingEventsData.length === 0) {
            return false;
        }

        const sourceStartDate = existingEvent.startDate instanceof Date
            ? existingEvent.startDate
            : this.parseDate(existingEvent.startDate);
        const sourceDateKey = sourceStartDate ? this.normalizeEventDate(sourceStartDate) : '';
        for (const candidateEvent of existingEventsData) {
            if (!candidateEvent || candidateEvent === existingEvent) {
                continue;
            }
            const candidateFields = this.parseNotesIntoFields(candidateEvent.notes || '');
            const candidateIdentifierRaw = normalizeIdentifier(candidateEvent.identifier || '');
            const candidateIdentifierInfo = this.parseScriptableIdentifier(candidateIdentifierRaw);
            const candidateNotesIdentifierRaw = normalizeIdentifier(
                candidateFields.uid || candidateFields.identifier || candidateFields.id || ''
            );
            const candidateNotesIdentifierInfo = this.parseScriptableIdentifier(candidateNotesIdentifierRaw);
            const candidateUid = this.normalizeOverrideUid(
                candidateIdentifierInfo.uid || candidateNotesIdentifierInfo.uid || candidateNotesIdentifierRaw || ''
            );
            if (!candidateUid || candidateUid !== normalizedSourceUid) {
                continue;
            }

            const candidateStartDate = candidateEvent.startDate instanceof Date
                ? candidateEvent.startDate
                : this.parseDate(candidateEvent.startDate);
            const candidateDateKey = candidateStartDate ? this.normalizeEventDate(candidateStartDate) : '';
            if (!sourceDateKey || !candidateDateKey || candidateDateKey !== sourceDateKey) {
                return true;
            }
        }

        return false;
    }

    resolveRecurringMergeCandidate(existingEventsData, existingEvent) {
        if (!this.shouldCreateOverrideFromRecurringMatch(existingEvent, existingEventsData)) {
            return null;
        }

        const overrideIdentity = this.deriveOverrideIdentityFromSourceEvent(existingEvent);
        if (!overrideIdentity) {
            return {
                action: 'new',
                reason: 'Recurring source match found - creating standalone event',
                sourceEvent: existingEvent
            };
        }

        const existingOverrideMatch = this.findEventByOverrideKey(
            existingEventsData,
            overrideIdentity.overrideUid,
            overrideIdentity.overrideRecurrenceId
        );
        if (existingOverrideMatch) {
            return {
                action: 'merge',
                reason: 'Recurring source mapped to existing override',
                existingEvent: existingOverrideMatch.event,
                existingKey: existingOverrideMatch.existingKey
            };
        }

        const overrideKey = `${overrideIdentity.overrideUid.toLowerCase()}::${overrideIdentity.overrideRecurrenceId}`;
        return {
            action: 'new',
            reason: 'Recurring source match found - creating override',
            sourceEvent: existingEvent,
            existingKey: overrideKey,
            overrideIdentity: overrideIdentity
        };
    }

    normalizeOverrideUid(value) {
        return SharedCore.normalizeOverrideUid(value);
    }

    normalizeOverrideRecurrenceId(value) {
        return SharedCore.normalizeOverrideRecurrenceId(value);
    }

    // -------------------------------------------------------------------------
    // Static utility methods — pure functions with no instance state.
    // These are also used by ScriptableAdapter (which delegates to them) so that
    // business logic lives in exactly one place.
    // -------------------------------------------------------------------------

    // Events from parsers marked dryRun must never reach calendar writes,
    // regardless of which path (automation or interactive prompt) executes them
    static filterEventsForExecution(analyzedEvents) {
        if (!Array.isArray(analyzedEvents)) return [];
        return analyzedEvents.filter(event => event?._parserConfig?.dryRun !== true);
    }

    static normalizeOverrideUid(value) {
        if (value === null || value === undefined) return '';
        return String(value).trim();
    }

    static normalizeOverrideRecurrenceId(value) {
        if (value === null || value === undefined) return '';
        const trimmed = String(value).trim();
        if (!trimmed) return '';

        const withTimezoneMatch = trimmed.match(/^TZID=([^:]+):(\d{8}(?:T\d{4,6}Z?)?)$/i);
        if (withTimezoneMatch) {
            const timezone = withTimezoneMatch[1].trim();
            const recurrenceValue = withTimezoneMatch[2].toUpperCase();
            if (!timezone) return '';
            return `TZID=${timezone}:${recurrenceValue}`;
        }

        const withoutTimezoneMatch = trimmed.match(/^(\d{8}(?:T\d{4,6}Z?)?)$/i);
        if (withoutTimezoneMatch) {
            return withoutTimezoneMatch[1].toUpperCase();
        }

        return '';
    }

    static buildOverrideKey(overrideUid, overrideRecurrenceId) {
        const normalizedUid = SharedCore.normalizeOverrideUid(overrideUid);
        const normalizedRecurrenceId = SharedCore.normalizeOverrideRecurrenceId(overrideRecurrenceId);
        if (!normalizedUid || !normalizedRecurrenceId) {
            return '';
        }
        return `${normalizedUid.toLowerCase()}::${normalizedRecurrenceId}`;
    }

    static normalizeEventDate(dateInput) {
        if (!dateInput) return '';
        try {
            const date = new Date(dateInput);
            if (isNaN(date.getTime())) return '';
            const year = date.getUTCFullYear();
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const day = String(date.getUTCDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        } catch (error) {
            return '';
        }
    }

    parseOverrideRecurrenceDate(value) {
        const normalized = this.normalizeOverrideRecurrenceId(value);
        if (!normalized) return null;

        const rawValue = normalized.startsWith('TZID=')
            ? normalized.split(':').slice(1).join(':')
            : normalized;
        const match = rawValue.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?Z?$/);
        if (!match) return null;

        const year = Number(match[1]);
        const month = Number(match[2]) - 1;
        const day = Number(match[3]);
        const hour = Number(match[4] || 0);
        const minute = Number(match[5] || 0);
        const second = Number(match[6] || 0);
        const date = new Date(Date.UTC(year, month, day, hour, minute, second));
        return Number.isNaN(date.getTime()) ? null : date;
    }

    findOverrideSourceEvent(existingEventsData, overrideUid, overrideRecurrenceId) {
        if (!Array.isArray(existingEventsData) || existingEventsData.length === 0) {
            return null;
        }

        const normalizeIdentifier = (value) => {
            if (value === null || value === undefined) return null;
            const normalized = String(value).trim();
            return normalized.length > 0 ? normalized : null;
        };

        const targetUid = this.normalizeOverrideUid(overrideUid);
        if (!targetUid) return null;
        const targetDate = this.parseOverrideRecurrenceDate(overrideRecurrenceId);
        const targetDateKey = targetDate ? this.normalizeEventDate(targetDate) : null;
        let fallbackUidMatch = null;

        for (const existingEvent of existingEventsData) {
            const fields = this.parseNotesIntoFields(existingEvent.notes || '');
            const existingOverrideUid = this.normalizeOverrideUid(fields.overrideUid);
            const existingOverrideRecurrenceId = this.normalizeOverrideRecurrenceId(fields.overrideRecurrenceId);
            if (existingOverrideUid && existingOverrideRecurrenceId) {
                continue;
            }

            const eventIdentifierRaw = normalizeIdentifier(existingEvent.identifier || '');
            const eventIdentifierInfo = this.parseScriptableIdentifier(eventIdentifierRaw);
            const notesIdentifierRaw = normalizeIdentifier(fields.uid || fields.identifier || fields.id || '');
            const notesIdentifierInfo = this.parseScriptableIdentifier(notesIdentifierRaw);
            const eventUid = eventIdentifierInfo.uid || notesIdentifierInfo.uid || notesIdentifierRaw || null;
            if (!eventUid || eventUid !== targetUid) {
                continue;
            }

            if (!fallbackUidMatch) {
                fallbackUidMatch = existingEvent;
            }

            if (!targetDateKey) {
                continue;
            }

            const eventStartDate = existingEvent.startDate instanceof Date
                ? existingEvent.startDate
                : this.parseDate(existingEvent.startDate);
            if (!eventStartDate) {
                continue;
            }

            const eventDateKey = this.normalizeEventDate(eventStartDate);
            if (eventDateKey && eventDateKey === targetDateKey) {
                return existingEvent;
            }
        }

        return fallbackUidMatch;
    }

    formatDateForCalendar(date) {
        if (!date) return null;
        if (typeof date === 'string') date = new Date(date);
        return date.toISOString();
    }

    
    // ============================================================================
    // GOOGLE MAPS URL GENERATION - iOS-compatible URL construction
    // ============================================================================
    
    // Static method to generate iOS-compatible Google Maps URLs
    // Works on Android, iOS (including iOS 11+), and web without API tokens
    static generateGoogleMapsUrl({ coordinates, placeId, address, venueName, cityName }) {
        const lat = coordinates ? parseFloat(coordinates.lat) : null;
        const lng = coordinates ? parseFloat(coordinates.lng) : null;
        const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng);
        const normalizedAddress = typeof address === 'string' ? address.trim() : '';
        const hasAddress = normalizedAddress.length > 0;
        const normalizedVenue = typeof venueName === 'string' ? venueName.trim() : '';
        const hasVenue = normalizedVenue.length > 0;
        const normalizedCity = typeof cityName === 'string' ? cityName.trim() : '';
        const hasCity = normalizedCity.length > 0;
        const shouldCombineVenue = hasAddress &&
            hasVenue &&
            !normalizedAddress.toLowerCase().includes(normalizedVenue.toLowerCase());
        const addressQuery = shouldCombineVenue ? `${normalizedVenue}, ${normalizedAddress}` : normalizedAddress;
        const shouldCombineCity = hasVenue &&
            hasCity &&
            !normalizedVenue.toLowerCase().includes(normalizedCity.toLowerCase());
        const fallbackQuery = shouldCombineCity ? `${normalizedVenue}, ${normalizedCity}` :
            (hasVenue ? normalizedVenue : normalizedCity);
        const hasFallbackQuery = (hasVenue || hasCity) && fallbackQuery.length > 0;
        const encodedCoordinates = hasCoordinates ? encodeURIComponent(`${lat},${lng}`) : null;
        const encodedAddress = hasAddress ? encodeURIComponent(addressQuery) : null;
        const encodedFallbackQuery = hasFallbackQuery ? encodeURIComponent(fallbackQuery) : null;

        if (placeId && hasCoordinates) {
            // Best case: use coordinates with place_id for maximum compatibility
            return `https://www.google.com/maps/search/?api=1&query=${encodedCoordinates}&query_place_id=${placeId}`;
        } else if (placeId && hasAddress) {
            // Fallback: use address with place_id (graceful degradation if place_id doesn't exist)
            return `https://www.google.com/maps/search/?api=1&query=${encodedAddress}&query_place_id=${placeId}`;
        } else if (hasAddress) {
            // Fallback: address only
            return `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
        } else if (hasCoordinates) {
            // Final fallback: coordinates only
            return `https://www.google.com/maps/search/?api=1&query=${encodedCoordinates}`;
        } else if (encodedFallbackQuery) {
            // Final fallback: venue/city only (useful when no address or coordinates)
            const placeIdParam = placeId ? `&query_place_id=${placeId}` : '';
            return `https://www.google.com/maps/search/?api=1&query=${encodedFallbackQuery}${placeIdParam}`;
        }
        return null;
    }
    
    getResolvedFieldPriorities(parserConfig) {
        const explicitPriorities = parserConfig?.fieldPriorities || {};

        // Auto-infer "static" with "clobber" for fields present in metadata but missing from explicitPriorities
        const inferredPriorities = {};
        if (parserConfig?.metadata) {
            Object.keys(parserConfig.metadata).forEach(key => {
                if (!explicitPriorities[key]) {
                    inferredPriorities[key] = { priority: ["static"], merge: "clobber" };
                }
            });
        }

        // "ai" = AI-arbitrated on genuine conflicts, clobber semantics otherwise.
        // Explicit fieldPriorities entries in the parser config override these —
        // hardcoded config is the override, automation is the default.
        const defaultPriorities = {
            title: { priority: ["ai-web"], merge: "ai" },
            instagram: { priority: ["ai-web"], merge: "ai" },
            facebook: { priority: ["ai-web"], merge: "ai" },
            website: { priority: ["ai-web"], merge: "ai" },
            description: { priority: ["ai-web"], merge: "ai" },
            bar: { priority: ["ai-web"], merge: "ai" },
            address: { priority: ["ai-web"], merge: "ai" },
            startDate: { priority: ["ai-web"], merge: "ai" },
            endDate: { priority: ["ai-web"], merge: "ai" },
            url: { priority: ["ai-web"], merge: "ai" },
            location: { priority: ["ai-web"], merge: "ai" },
            gmaps: { priority: ["ai-web"], merge: "ai" },
            image: { priority: ["ai-web"], merge: "ai" },
            cover: { priority: ["ai-web"], merge: "ai" },
            ticketUrl: { priority: ["ai-web"], merge: "ai" }
        };
        return { ...defaultPriorities, ...inferredPriorities, ...explicitPriorities };
    }

    // Apply field-level priority strategies from the parser config
    // This determines which parser's data to trust for each field
    applyFieldPriorities(event, parserConfig, mainConfig) {
        // Always attach parser config
        event._parserConfig = parserConfig;

        // Get the field priorities configuration from this parser's config
        const fieldPriorities = this.getResolvedFieldPriorities(parserConfig);
        
        // Field priorities loaded from parser configuration
        
        // Store field priorities for later use during merging
        if (!event._fieldPriorities) {
            event._fieldPriorities = {};
        }
        
        // Copy field priorities to event for later use
        Object.keys(fieldPriorities).forEach(fieldName => {
            event._fieldPriorities[fieldName] = fieldPriorities[fieldName];
        });

        // Ensure key updates reflect current key format unless explicitly configured
        if (!event._fieldPriorities.key) {
            event._fieldPriorities.key = { merge: 'clobber' };
        }
        
        // Apply static metadata values based on priority system
        if (parserConfig?.metadata) {
            Object.keys(parserConfig.metadata).forEach(key => {
                const metaValue = parserConfig.metadata[key];
                if (typeof metaValue === 'object' && metaValue !== null) {
                    const hasDirectValue = Object.prototype.hasOwnProperty.call(metaValue, 'value');
                    const hasDefaultValue = Object.prototype.hasOwnProperty.call(metaValue, 'defaultValue');
                    const hasConditionalValues = Array.isArray(metaValue.conditionalValues);
                    if (!hasDirectValue && !hasDefaultValue && !hasConditionalValues) {
                        return;
                    }
                    const priorityConfig = fieldPriorities[key];
                    const selectedValue = this.resolveStaticMetadataValue(metaValue, event);
                    if (selectedValue === undefined) {
                        return;
                    }
                    const resolvedValue = this.applyMetadataTemplate(selectedValue, event);
                    
                    // Check if "static" has priority for this field
                    if (priorityConfig && priorityConfig.priority && priorityConfig.priority.includes('static')) {
                        // Apply static value since it's in the priority list
                        event[key] = resolvedValue;
                        // Mark this field as coming from static source
                        if (!event._staticFields) event._staticFields = {};
                        event._staticFields[key] = resolvedValue;
                    } else {
                        // Fallback: if no priority config, apply static value (backward compatibility)
                        event[key] = resolvedValue;
                        if (!event._staticFields) event._staticFields = {};
                        event._staticFields[key] = resolvedValue;
                    }
                }
            });
        }
        
        
        // Return the event with all fields intact
        // The actual priority logic will be handled later during event merging
        return event;
    }
    
    // Format event notes with all metadata in key-value format
    formatEventNotes(event) {
        return this.eventSchema.formatEventNotes(event, {
            excludeFields: this.notesExcludedFields
        });
    }

    // Get event date ranges with optional expansion
    getEventDateRange(event, expandRange = false) {
        const startDate = event.startDate;
        const endDate = event.endDate || event.startDate;
        
        if (expandRange) {
            const searchStart = new Date(startDate);
            searchStart.setHours(0, 0, 0, 0);
            const searchEnd = new Date(endDate);
            searchEnd.setHours(23, 59, 59, 999);
            return { startDate, endDate, searchStart, searchEnd };
        }
        
        return { startDate, endDate };
    }

    // Prepare events for calendar integration with conflict analysis
    async prepareEventsForCalendar(events, calendarAdapter, config = {}) {
        // Events are already properly formatted - no need for additional formatting
        
        // Analyze each event against existing calendar events
        const analyzedEvents = [];
        
        for (const event of events) {
            // Use default merge mode since parser-level mergeMode is handled by field priorities
            const mergeMode = config.mergeMode || 'upsert';
            
            // Get existing events from the adapter
            const existingEvents = await calendarAdapter.getExistingEvents(event);
            
            // Analyze what action to take
            const analysis = this.analyzeEventAction(event, existingEvents, mergeMode);
            
            // Create a new object with all properties to avoid readonly errors
            let analyzedEvent = { ...event };
            
            // Add analysis to the new event object
            analyzedEvent._analysis = {
                action: analysis.action,
                reason: analysis.reason,
                sourceEvent: Boolean(analysis.sourceEvent),
                hasOverrideIdentity: Boolean(analysis.overrideIdentity)
            };
            analyzedEvent._action = analysis.action;
            
            // Handle merge action by creating complete final event object
            if (analysis.action === 'merge' && analysis.existingEvent) {
                // Create final merged event that represents exactly what will be saved
                analyzedEvent = await this.createFinalEventObject(analysis.existingEvent, event, { httpAdapter: calendarAdapter, globalConfig: config });
                
                // Calculate merge diff for display purposes
                const originalFields = this.parseNotesIntoFields(analysis.existingEvent.notes || '');
                const mergedFields = this.parseNotesIntoFields(analyzedEvent.notes || '');
                
                analyzedEvent._mergeDiff = {
                    preserved: [],
                    added: [],
                    updated: [],
                    removed: []
                };
                
                // Analyze what changed
                Object.keys(originalFields).forEach(key => {
                    // Check the merge strategy for this field
                    if (mergedFields[key] === originalFields[key]) {
                        analyzedEvent._mergeDiff.preserved.push(key);
                    } else if (!mergedFields[key]) {
                        // Check if this is preserve strategy - if so, undefined should be preserved, not removed
                        const fieldPriorities = analyzedEvent._fieldPriorities || {};
                        const priorityConfig = fieldPriorities[key];
                        const mergeStrategy = priorityConfig?.merge || 'preserve';
                        
                        if (mergeStrategy === 'preserve' && originalFields[key] === undefined) {
                            // For preserve strategy, if original was undefined and merged is undefined, it's preserved
                            analyzedEvent._mergeDiff.preserved.push(key);
                        } else {
                            // Otherwise it's truly removed
                            analyzedEvent._mergeDiff.removed.push({ key, value: originalFields[key] });
                        }
                    } else {
                        analyzedEvent._mergeDiff.updated.push({ 
                            key, 
                            from: originalFields[key], 
                            to: mergedFields[key] 
                        });
                    }
                });
                
                // Check for added fields - but handle preserve strategy correctly
                Object.keys(mergedFields).forEach(key => {
                    if (!originalFields[key]) {
                        // Check if this field has preserve strategy and should be treated as preserved
                        const fieldPriorities = analyzedEvent._fieldPriorities || {};
                        const priorityConfig = fieldPriorities[key];
                        const mergeStrategy = priorityConfig?.merge || 'preserve';
                        
                        if (mergeStrategy === 'preserve') {
                            // For preserve strategy, if the field wasn't in original notes but is now present,
                            // it should be marked as preserved (the undefined existing value was preserved)
                            analyzedEvent._mergeDiff.preserved.push(key);
                        } else {
                            // For other strategies (clobber, upsert), it's truly added
                            analyzedEvent._mergeDiff.added.push({ key, value: mergedFields[key] });
                        }
                    }
                });
            } else if (analysis.action === 'new' && analysis.sourceEvent) {
                const sourceMergeEvent = analysis.overrideIdentity
                    ? { ...event, ...analysis.overrideIdentity }
                    : event;
                analyzedEvent = await this.createFinalEventObject(analysis.sourceEvent, sourceMergeEvent, { httpAdapter: calendarAdapter, globalConfig: config });
                delete analyzedEvent._existingEvent;
                analyzedEvent._action = 'new';

                // Compute a merge diff comparing the base recurring event to the new override
                // being created. This enables diff display for intent:merge + action:new cases.
                const originalFields = this.parseNotesIntoFields(analysis.sourceEvent.notes || '');
                const mergedFields = this.parseNotesIntoFields(analyzedEvent.notes || '');
                analyzedEvent._mergeDiff = {
                    preserved: [],
                    added: [],
                    updated: [],
                    removed: []
                };
                Object.keys(originalFields).forEach(key => {
                    if (mergedFields[key] === originalFields[key]) {
                        analyzedEvent._mergeDiff.preserved.push(key);
                    } else if (!mergedFields[key]) {
                        analyzedEvent._mergeDiff.removed.push({ key, value: originalFields[key] });
                    } else {
                        analyzedEvent._mergeDiff.updated.push({ key, from: originalFields[key], to: mergedFields[key] });
                    }
                });
                Object.keys(mergedFields).forEach(key => {
                    if (!originalFields[key]) {
                        analyzedEvent._mergeDiff.added.push({ key, value: mergedFields[key] });
                    }
                });
            } else if (analysis.existingEvent) {
                analyzedEvent._existingEvent = analysis.existingEvent;
            }
            
            if (analysis.existingKey) {
                analyzedEvent._existingKey = analysis.existingKey;
            }
            if (analysis.conflicts) {
                analyzedEvent._conflicts = analysis.conflicts;
                // Process conflicts to extract important information
                analyzedEvent = this.processEventWithConflicts(analyzedEvent);
            }
            
            // Generate notes for ALL events to ensure consistent preview display
            // This ensures new, merge, and conflict events all have notes for the preview
            if (!analyzedEvent.notes) {
                analyzedEvent.notes = this.formatEventNotes(analyzedEvent);
            }
            
            analyzedEvents.push(analyzedEvent);
        }
        
        return analyzedEvents;
    }
    
    // Analyze events against existing calendar events and determine actions
    // This is pure business logic - adapters provide the existing events data
    analyzeEventActions(newEvents, existingEventsData) {
        const actions = {
            newEvents: [],
            mergeEvents: [],
            conflictEvents: []
        };
        
        for (const event of newEvents) {
            const analysis = this.analyzeEventAction(event, existingEventsData);
            
            switch (analysis.action) {
                case 'new':
                    actions.newEvents.push({ event, analysis });
                    break;
                case 'merge':
                    actions.mergeEvents.push({ event, analysis });
                    break;
                case 'conflict':
                    actions.conflictEvents.push({ event, analysis });
                    break;
            }
        }
        
        return actions;
    }
    
    // Analyze a single event against existing events
    analyzeEventAction(event, existingEventsData, mergeMode = 'upsert') {
        const finalize = (result) => this.finalizeAnalysisResult(event, result);
        const hasIdentifier = Boolean(event && (event.identifier || event.id));
        const incomingOverrideUid = this.normalizeOverrideUid(event && event.overrideUid);
        const incomingOverrideRecurrenceId = this.normalizeOverrideRecurrenceId(event && event.overrideRecurrenceId);
        const hasOverrideIdentity = Boolean(incomingOverrideUid || incomingOverrideRecurrenceId);
        if (hasOverrideIdentity) {
            if (!incomingOverrideUid || !incomingOverrideRecurrenceId) {
                throw new Error('Incoming event override identity requires both overrideUid and overrideRecurrenceId');
            }

            if (!existingEventsData || existingEventsData.length === 0) {
                return finalize({ action: 'new', reason: 'Override match not found' });
            }

            const existingOverrideMatch = this.findEventByOverrideKey(
                existingEventsData,
                incomingOverrideUid,
                incomingOverrideRecurrenceId
            );
            if (existingOverrideMatch) {
                return finalize({
                    action: 'merge',
                    reason: 'Override match found',
                    existingEvent: existingOverrideMatch.event,
                    existingKey: existingOverrideMatch.existingKey
                });
            }

            // If the incoming event has a Scriptable identifier, find the calendar event
            // it references and check whether it is recurring. Non-recurring events are
            // always safe to merge directly — do not trust the input; scan to verify.
            if (hasIdentifier) {
                const keyMatch = this.findEventByKey(existingEventsData, event);
                if (keyMatch && keyMatch.matchType === 'identifier') {
                    const identifierMatchedEvent = keyMatch.event;
                    const recurringDecision = this.resolveRecurringMergeCandidate(existingEventsData, identifierMatchedEvent);
                    if (recurringDecision) {
                        return finalize(recurringDecision);
                    }
                    return finalize({
                        action: 'merge',
                        reason: 'Override target found by identifier (non-recurring)',
                        existingEvent: identifierMatchedEvent,
                        existingKey: keyMatch.matchedKey || null
                    });
                }
                // Fallback: the identifier date comparison may fail when an existing override
                // event was saved with a user-edited start time that differs from the original
                // occurrence time used as searchStartDate. Scan all candidate events with the
                // same UID (ignoring date) to determine recursiveness, as instructed.
                const identifierCandidates = this.findEventsByIdentifier(existingEventsData, event.identifier || event.id);
                if (identifierCandidates.length > 0) {
                    const candidate = identifierCandidates[0];
                    const recurringDecision = this.resolveRecurringMergeCandidate(existingEventsData, candidate);
                    if (recurringDecision) {
                        return finalize(recurringDecision);
                    }
                    // Non-recurring — always safe to merge directly.
                    return finalize({
                        action: 'merge',
                        reason: 'Override target found by identifier scan (non-recurring)',
                        existingEvent: candidate,
                        existingKey: event.identifier || event.id || null
                    });
                }
            }

            const sourceEvent = this.findOverrideSourceEvent(
                existingEventsData,
                incomingOverrideUid,
                incomingOverrideRecurrenceId
            );
            const targetOverrideKey = `${incomingOverrideUid.toLowerCase()}::${incomingOverrideRecurrenceId}`;
            if (sourceEvent) {
                return finalize({
                    action: 'new',
                    reason: 'Override source match found',
                    sourceEvent,
                    existingKey: targetOverrideKey
                });
            }

            return finalize({ action: 'new', reason: 'Override match not found', existingKey: targetOverrideKey });
        }

        if (hasIdentifier) {
            if (!existingEventsData || existingEventsData.length === 0) {
                return finalize({ action: 'conflict', reason: 'Identifier match not found' });
            }
            const keyMatch = this.findEventByKey(existingEventsData, event);
            if (keyMatch && keyMatch.matchType === 'identifier') {
                const existingEvent = keyMatch.event;
                const matchedKey = keyMatch.matchedKey || null;
                const recurringMergeDecision = this.resolveRecurringMergeCandidate(existingEventsData, existingEvent);
                if (recurringMergeDecision) {
                    return finalize(recurringMergeDecision);
                }
                return finalize({
                    action: 'merge',
                    reason: 'Identifier match found',
                    existingEvent: existingEvent,
                    existingKey: matchedKey
                });
            }
            return finalize({ action: 'conflict', reason: 'Identifier match not found' });
        }
        
        if (!existingEventsData || existingEventsData.length === 0) {
            return finalize({ action: 'new', reason: 'No existing events found' });
        }
        
        // Check for key-based merging first (exact or wildcard)
        const keyMatch = this.findEventByKey(existingEventsData, event);
        
        if (keyMatch) {
            const existingEvent = keyMatch.event;
            const matchedKey = keyMatch.matchedKey || null;
            const recurringMergeDecision = this.resolveRecurringMergeCandidate(existingEventsData, existingEvent);
            if (recurringMergeDecision) {
                return finalize(recurringMergeDecision);
            }
            
            if (keyMatch.matchType === 'exact') {
                return finalize({
                    action: 'merge',
                    reason: 'Key match found',
                    existingEvent: existingEvent,
                    existingKey: matchedKey
                });
            }
            
            if (keyMatch.matchType === 'wildcard') {
                return finalize({
                    action: 'merge',
                    reason: 'Wildcard key match found',
                    existingEvent: existingEvent,
                    existingKey: matchedKey
                });
            }
        }
        
        // Check for exact or similar duplicates
        const exactMatch = existingEventsData.find(existing =>
            this.areTitlesSimilar(existing.title || existing.name, event.title) &&
            this.areDatesEqual(existing.startDate, event.startDate, 1)
        );

        if (exactMatch) {
            const recurringMergeDecision = this.resolveRecurringMergeCandidate(existingEventsData, exactMatch);
            if (recurringMergeDecision) {
                return finalize(recurringMergeDecision);
            }
            return finalize({
                action: 'merge',
                reason: 'Similar event found',
                existingEvent: exactMatch
            });
        }

        // Identity-based match: catches renamed events ("FURBALL" vs "DALLAS FREEDOM TEA")
        // and zero-duration or hour-shifted records that the interval-overlap check below
        // misses (a start==end range can never satisfy doDatesOverlap).
        for (const existing of existingEventsData) {
            const identitySignal = this.getSameEventIdentitySignal(event, existing);
            if (!identitySignal) continue;
            const recurringMergeDecision = this.resolveRecurringMergeCandidate(existingEventsData, existing);
            if (recurringMergeDecision) {
                return finalize(recurringMergeDecision);
            }
            return finalize({
                action: 'merge',
                reason: `Same event identity (${identitySignal})`,
                existingEvent: existing
            });
        }

        // Check for overlapping events - only merge when time and title/venue are similar
        const timeConflicts = existingEventsData.filter(existing => 
            this.doDatesOverlap(existing.startDate, existing.endDate, 
                               event.startDate, event.endDate || event.startDate)
        );
        
        if (timeConflicts.length > 0) {
            const normalizeVenue = (value) => {
                if (!value) return '';
                return String(value).toLowerCase().replace(/[^a-z0-9]/g, '').trim();
            };
            const newVenue = normalizeVenue(event.bar || event.venue || event.location);
            const venuesSimilar = (existing) => {
                if (!newVenue) return false;
                const existingVenue = normalizeVenue(existing.location);
                return existingVenue && existingVenue === newVenue;
            };
            
            const timeSimilar = (existing) => this.areDatesEqual(existing.startDate, event.startDate, 60);
            
            const mergeableConflict = timeConflicts.find(existing =>
                timeSimilar(existing) &&
                (this.areTitlesSimilar(existing.title || existing.name, event.title) || venuesSimilar(existing))
            );
            
            if (mergeableConflict) {
                const recurringMergeDecision = this.resolveRecurringMergeCandidate(existingEventsData, mergeableConflict);
                if (recurringMergeDecision) {
                    return finalize(recurringMergeDecision);
                }
                return finalize({
                    action: 'merge',
                    reason: 'Mergeable overlap detected',
                    existingEvent: mergeableConflict
                });
            }
            
            return finalize({
                action: 'new',
                reason: 'Overlapping event with different title/venue'
            });
        }
        
        return finalize({ action: 'new', reason: 'No conflicts found' });
    }
    
    // Check if a key matches a pattern with simple wildcards (pure logic)
    // Supports * wildcards that get converted to .* for regex matching
    // Example: "chunk-chicago-presents-sausage-party|2025-10-*|*|chunk" matches "chunk-chicago-presents-sausage-party|2025-10-15|cell-block|chunk"
    matchesKeyPattern(pattern, key) {
        if (!pattern || !key) return false;
        
        // Convert * to .* for simple wildcards, but escape pipe characters
        const regexPattern = pattern.replace(/\*/g, '.*').replace(/\|/g, '\\|');
        
        try {
            const regex = new RegExp('^' + regexPattern + '$');
            return regex.test(key);
        } catch (error) {
            // If pattern is not valid regex, fall back to exact match
            return pattern === key;
        }
    }
    
    // Apply simple template tokens in metadata values using event date
    // Supported tokens: ${year}, ${month}, ${day}, ${date} (YYYY-MM-DD)
    resolveStaticMetadataValue(metaValue, event) {
        if (!metaValue || typeof metaValue !== 'object') {
            return undefined;
        }

        const hasValue = Object.prototype.hasOwnProperty.call(metaValue, 'value');
        const hasDefaultValue = Object.prototype.hasOwnProperty.call(metaValue, 'defaultValue');
        const fallbackValue = hasDefaultValue ? metaValue.defaultValue : (hasValue ? metaValue.value : undefined);

        if (!Array.isArray(metaValue.conditionalValues) || metaValue.conditionalValues.length === 0) {
            return fallbackValue;
        }

        const searchText = this.buildStaticMetadataSearchText(event);
        if (!searchText) {
            return fallbackValue;
        }

        for (const condition of metaValue.conditionalValues) {
            if (!condition || typeof condition !== 'object') continue;
            if (!Object.prototype.hasOwnProperty.call(condition, 'value')) continue;
            const keywords = this.normalizeStaticMetadataKeywords(condition.keywords || []);
            if (keywords.length === 0) continue;
            if (keywords.some(keyword => searchText.includes(keyword))) {
                return condition.value;
            }
        }

        return fallbackValue;
    }

    normalizeStaticMetadataKeywords(keywords) {
        const keywordList = Array.isArray(keywords) ? keywords : [keywords];
        return keywordList
            .map(keyword => String(keyword || '').trim().toLowerCase())
            .filter(Boolean);
    }

    buildStaticMetadataSearchText(event) {
        // Keep traversal bounded to avoid deep/cyclic payload costs while still covering nested parser data.
        const MAX_SEARCH_DEPTH = 10;
        const INTERNAL_FIELD_PREFIX = '_';
        const parts = [];
        const visited = new Set();

        const collect = (value, depth = 0) => {
            if (value === null || value === undefined || depth > MAX_SEARCH_DEPTH) return;
            const valueType = typeof value;

            if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
                const normalized = String(value).trim().toLowerCase();
                if (normalized) {
                    parts.push(normalized);
                }
                return;
            }

            if (valueType !== 'object') {
                return;
            }

            if (visited.has(value)) {
                return;
            }
            visited.add(value);

            if (Array.isArray(value)) {
                value.forEach(item => collect(item, depth + 1));
                return;
            }

            Object.keys(value).forEach(key => {
                // Internal shared-core metadata keys are underscore-prefixed and should not drive matching.
                if (String(key).startsWith(INTERNAL_FIELD_PREFIX)) return;
                collect(value[key], depth + 1);
            });
        };

        collect(event, 0);
        return parts.join(' ');
    }

    applyMetadataTemplate(value, event) {
        if (typeof value !== 'string' || !value.includes('${')) {
            return value;
        }
        
        const fallbackDate = this.normalizeEventDate(event?.startDate);
        const timezone = event?.timezone || (event?.city && this.cities[event.city]?.timezone) || null;
        const localDate = this.normalizeEventDateLocal(event?.startDate, timezone);
        const date = localDate || fallbackDate;
        
        if (!date) {
            return value;
        }
        
        const [year, month, day] = date.split('-');
        const replacements = {
            '${year}': year,
            '${month}': month,
            '${day}': day,
            '${date}': date
        };
        
        let result = value;
        Object.keys(replacements).forEach(token => {
            result = result.split(token).join(replacements[token]);
        });
        
        return result;
    }
    
    // Build a key for existing events using their fields (no notes required)
    // Uses the default key format: normalizedTitle|date|venue(|source)
    buildDefaultEventKey(event) {
        if (!event) return null;
        
        let normalizedTitle = String(event.originalTitle || event.title || '').toLowerCase().trim();
        
        // Apply the same normalization as generateKeyFromFormat for ${normalizedTitle}
        normalizedTitle = normalizedTitle
            .replace(/([a-z])[\s\>\<\-\.\,\!\@\#\$\%\^\&\*\(\)\_\+\=\{\}\[\]\|\\\:\;\"\'\?\/]+([a-z])/gi, '$1-$2')
            .replace(/([a-z])[\!\@\#\$\%\^\&\*\(\)\_\+\=\{\}\[\]\|\\\:\;\"\'\?\,\.]+(?=\s|$)/gi, '$1')
            .replace(/[\s\-]+/g, '-')
            .replace(/^-+|-+$/g, '');
        
        const date = this.normalizeEventDate(event.startDate);
        const venue = String(event.bar || '').toLowerCase().trim();
        if (!normalizedTitle || !date) return null;
        
        return `${normalizedTitle}|${date}|${venue}`.toLowerCase().trim();
    }
    
    // Build a key using local date components (timezone-aware when available)
    buildDefaultEventKeyLocal(event) {
        if (!event) return null;
        
        let normalizedTitle = String(event.originalTitle || event.title || '').toLowerCase().trim();
        
        // Apply the same normalization as generateKeyFromFormat for ${normalizedTitle}
        normalizedTitle = normalizedTitle
            .replace(/([a-z])[\s\>\<\-\.\,\!\@\#\$\%\^\&\*\(\)\_\+\=\{\}\[\]\|\\\:\;\"\'\?\/]+([a-z])/gi, '$1-$2')
            .replace(/([a-z])[\!\@\#\$\%\^\&\*\(\)\_\+\=\{\}\[\]\|\\\:\;\"\'\?\,\.]+(?=\s|$)/gi, '$1')
            .replace(/[\s\-]+/g, '-')
            .replace(/^-+|-+$/g, '');
        
        const eventTimezone = event.timezone || (event.city && this.cities[event.city]?.timezone) || null;
        const date = this.normalizeEventDateLocal(event.startDate, eventTimezone);
        const venue = String(event.bar || '').toLowerCase().trim();
        if (!normalizedTitle || !date) return null;
        
        return `${normalizedTitle}|${date}|${venue}`.toLowerCase().trim();
    }
    
    // Build a best-effort key for existing calendar events using their fields
    buildComputedKeyForExistingEvent(existingEvent, fields, targetSource = '', keyFormat = null, options = {}) {
        if (!existingEvent || !existingEvent.title || !existingEvent.startDate) {
            return null;
        }
        
        const urlCandidate = fields.url || fields.ticketUrl || existingEvent.url || '';
        let source = fields.source || existingEvent.source || '';
        
        if (!source && urlCandidate) {
            const detectedSource = this.detectParserFromUrl(urlCandidate);
            if (detectedSource && detectedSource !== 'ai-web') {
                source = detectedSource;
            }
        }
        
        if (!source && targetSource) {
            source = targetSource;
        }
        
        const bar = fields.bar || fields.venue || fields.location || existingEvent.location || '';
        const address = fields.address || '';
        const city = fields.city || existingEvent.city || '';
        const timezone = existingEvent.timezone || existingEvent.timeZone || '';
        
        const computedEvent = {
            title: existingEvent.title,
            originalTitle: existingEvent.originalTitle || existingEvent.title,
            startDate: existingEvent.startDate,
            bar: bar,
            address: address,
            city: city,
            source: source,
            timezone: timezone
        };
        
        const useLocalDate = options.useLocalDate === true;
        if (keyFormat) {
            return this.generateKeyFromFormat(computedEvent, keyFormat, { useLocalDate });
        }
        
        if (useLocalDate) {
            return this.buildDefaultEventKeyLocal(computedEvent);
        }
        
        return this.buildDefaultEventKey(computedEvent);
    }
    
    // Find event by key in existing events (pure logic, no calendar APIs)
    // First tries exact match (key/matchKey), then computed keys, then wildcard matching
    findEventByKey(existingEvents, targetEventOrKey) {
        let targetKey = null;
        let targetMatchKey = null;
        let targetSource = '';
        let targetKeyFormat = null;
        let targetIdentifier = null;
        
        if (typeof targetEventOrKey === 'string') {
            targetKey = targetEventOrKey;
        } else if (targetEventOrKey && typeof targetEventOrKey === 'object') {
            targetKey = targetEventOrKey.key || null;
            targetMatchKey = targetEventOrKey.matchKey || null;
            targetSource = targetEventOrKey.source || '';
            targetKeyFormat = targetEventOrKey._parserConfig?.keyTemplate || null;
            targetIdentifier = targetEventOrKey.identifier || targetEventOrKey.id || null;
            
            if (!targetSource && targetEventOrKey.url) {
                const detectedSource = this.detectParserFromUrl(targetEventOrKey.url);
                if (detectedSource && detectedSource !== 'ai-web') {
                    targetSource = detectedSource;
                }
            }
        }
        
        const normalizeIdentifier = (value) => {
            if (value === null || value === undefined) return null;
            const normalized = String(value).trim();
            return normalized.length > 0 ? normalized : null;
        };
        
        const normalizedIdentifier = normalizeIdentifier(targetIdentifier);
        const targetIdentifierInfo = this.parseScriptableIdentifier(normalizedIdentifier);
        const targetUid = targetIdentifierInfo.uid || normalizedIdentifier;
        const targetSearchStartDate = targetEventOrKey && typeof targetEventOrKey === 'object'
            ? (targetEventOrKey.searchStartDate instanceof Date
                ? targetEventOrKey.searchStartDate
                : this.parseDate(targetEventOrKey.searchStartDate))
            : null;
        const targetSearchEndDate = targetEventOrKey && typeof targetEventOrKey === 'object'
            ? (targetEventOrKey.searchEndDate instanceof Date
                ? targetEventOrKey.searchEndDate
                : this.parseDate(targetEventOrKey.searchEndDate))
            : null;
        const targetSearchDate = targetSearchStartDate || targetSearchEndDate || null;
        
        const hasDirectIdentifier = Boolean(targetUid);
        const hasKeyMatch = Boolean(targetKey || targetMatchKey);
        
        if (!hasDirectIdentifier && !hasKeyMatch) return null;
        
        const wantsWildcardMatch = Boolean(targetMatchKey && targetMatchKey.includes('*'));
        
        const parsedEvents = existingEvents.map(event => {
            const fields = this.parseNotesIntoFields(event.notes || '');
            const computedKey = this.buildComputedKeyForExistingEvent(event, fields, targetSource, targetKeyFormat);
            const localComputedKey = wantsWildcardMatch
                ? this.buildComputedKeyForExistingEvent(event, fields, targetSource, targetKeyFormat, { useLocalDate: true })
                : null;
            return { event, fields, computedKey, localComputedKey };
        });
        
        if (hasDirectIdentifier) {
            if (!targetSearchDate) {
                console.log(`🔎 SharedCore: Identifier match missing search date uid="${targetUid}"`);
                return null;
            }
            const candidates = [];
            for (const { event, fields } of parsedEvents) {
                const eventIdentifierRaw = normalizeIdentifier(event.identifier || '');
                const eventIdentifierInfo = this.parseScriptableIdentifier(eventIdentifierRaw);
                const notesIdentifierRaw = normalizeIdentifier(fields.uid || fields.identifier || fields.id || '');
                const notesIdentifierInfo = this.parseScriptableIdentifier(notesIdentifierRaw);
                const eventUid = eventIdentifierInfo.uid || notesIdentifierInfo.uid || notesIdentifierRaw || null;
                if (!eventUid || eventUid !== targetUid) {
                    continue;
                }
                const eventStartDate = event.startDate instanceof Date
                    ? event.startDate
                    : this.parseDate(event.startDate);
                candidates.push({ event, eventUid, eventStartDate });
            }

            if (candidates.length > 0) {
                const targetSearchLabel = targetSearchDate ? targetSearchDate.toISOString() : '';
                console.log(`🔎 SharedCore: Identifier candidates=${candidates.length} uid="${targetUid}" search="${targetSearchLabel}"`);
                const searchStartMatch = candidates.find(candidate =>
                    candidate.eventStartDate && this.areDatesEqual(candidate.eventStartDate, targetSearchDate, 1)
                );
                if (searchStartMatch) {
                    console.log(`🔎 SharedCore: Matched by UID + search date uid="${targetUid}"`);
                    return { event: searchStartMatch.event, matchedKey: targetUid, matchType: 'identifier' };
                }
            }
            return null;
        }
        
        if (!hasKeyMatch) return null;
        
        // First pass: exact match on key or matchKey (from notes)
        for (const { event, fields } of parsedEvents) {
            const eventKey = fields.key || null;
            const matchKey = fields.matchKey || null;
            if (targetKey && eventKey === targetKey) {
                return { event, matchedKey: eventKey, matchType: 'exact' };
            }
            if (targetKey && matchKey === targetKey) {
                return { event, matchedKey: matchKey, matchType: 'exact' };
            }
        }
        
        // Second pass: exact match using computed key
        for (const { event, computedKey } of parsedEvents) {
            if (targetKey && computedKey && computedKey === targetKey) {
                return { event, matchedKey: computedKey, matchType: 'exact' };
            }
        }
        
        // Third pass: exact match using target matchKey when it's not a wildcard
        if (targetMatchKey && !targetMatchKey.includes('*')) {
            for (const { event, fields, computedKey } of parsedEvents) {
                const eventKey = fields.key || null;
                const matchKey = fields.matchKey || null;
                if (eventKey === targetMatchKey || matchKey === targetMatchKey || computedKey === targetMatchKey) {
                    return { event, matchedKey: eventKey || matchKey || computedKey, matchType: 'exact' };
                }
            }
        }
        
        // Fourth pass: wildcard pattern matching on existing key or matchKey
        for (const { event, fields } of parsedEvents) {
            const eventKey = fields.key || null;
            const matchKey = fields.matchKey || null;
            
            if (targetKey && eventKey && eventKey.includes('*') && this.matchesKeyPattern(eventKey, targetKey)) {
                return { event, matchedKey: eventKey, matchType: 'wildcard' };
            }
            
            if (targetKey && matchKey && matchKey.includes('*') && this.matchesKeyPattern(matchKey, targetKey)) {
                return { event, matchedKey: matchKey, matchType: 'wildcard' };
            }
        }
        
        // Fifth pass: wildcard matching using target matchKey against existing keys or computed key
        if (targetMatchKey && targetMatchKey.includes('*')) {
            // First, prefer timezone-aware local computed keys.
            // This avoids UTC date rollover picking the wrong month instance.
            for (const { event, localComputedKey } of parsedEvents) {
                if (localComputedKey && this.matchesKeyPattern(targetMatchKey, localComputedKey)) {
                    return { event, matchedKey: localComputedKey, matchType: 'wildcard' };
                }
            }

            // Fallback to persisted/computed keys when no local-date match exists.
            for (const { event, fields, computedKey } of parsedEvents) {
                const eventKey = fields.key || null;
                const matchKey = fields.matchKey || null;
                const candidates = [...new Set([eventKey, matchKey, computedKey].filter(Boolean))];
                if (candidates.some(candidate => this.matchesKeyPattern(targetMatchKey, candidate))) {
                    const matchedKey = candidates.find(candidate => this.matchesKeyPattern(targetMatchKey, candidate));
                    return { event, matchedKey: matchedKey, matchType: 'wildcard' };
                }
            }
        }
        
        return null;
    }
    
    // Check if two dates are equal within a tolerance (pure logic)
    areDatesEqual(date1, date2, toleranceMinutes) {
        const diff = Math.abs(date1.getTime() - date2.getTime());
        return diff <= (toleranceMinutes * 60 * 1000);
    }
    
    // Check if two date ranges overlap (pure logic)
    doDatesOverlap(start1, end1, start2, end2) {
        return start1 < end2 && end1 > start2;
    }
    
    // Fuzzy title matching to handle variations
    areTitlesSimilar(title1, title2) {
        if (!title1 || !title2) return false;
        
        // Normalize titles for comparison
        const normalize = (str) => {
            return str
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '') // Remove special chars
                .replace(/\s+/g, ''); // Remove spaces
        };
        
        const norm1 = normalize(title1);
        const norm2 = normalize(title2);
        
        // Exact match after normalization
        if (norm1 === norm2) return true;
        
        // Check if one contains the other (handles "Megawoof" vs "Megawoof: DURO")
        if (norm1.includes(norm2) || norm2.includes(norm1)) return true;
        
        // Check for common event name patterns
        const extractEventName = (title) => {
            // Extract before colon or dash
            const match = title.match(/^([^:\-–—]+)/);
            return match ? normalize(match[1]) : normalize(title);
        };
        
        const eventName1 = extractEventName(title1);
        const eventName2 = extractEventName(title2);

        return eventName1 === eventName2;
    }

    // === Same-event identity detection ===
    // Decides whether a newly scraped event and an existing record describe the same
    // underlying event even when their titles differ (e.g. "DALLAS FREEDOM TEA" vs
    // "FURBALL"). Used by analyzeEventAction and the scriptable adapter so the merge
    // decision and the calendar-check report can never disagree.

    normalizeIdentityText(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    normalizeTicketUrlForIdentity(url) {
        const text = String(url || '').trim().toLowerCase();
        if (!text) return '';
        const withoutProtocol = text.replace(/^https?:\/\//, '').replace(/^www\./, '');
        const withoutHash = withoutProtocol.split('#')[0];
        const [path, query] = withoutHash.split('?');
        const cleanPath = path.replace(/\/+$/, '');
        // A bare-domain "ticket URL" (promoter homepage like bearracuda.com) carries no
        // event-specific identity — two DIFFERENT events by the same promoter share it,
        // so treating it as an identity signal causes false merges.
        const hasEventSpecificPath = cleanPath.includes('/');
        if (!query) return hasEventSpecificPath ? cleanPath : '';
        const keptParams = query.split('&').filter(param => {
            const key = param.split('=')[0];
            return key && !this.trackingParamPattern.test(key);
        });
        if (keptParams.length > 0) return `${cleanPath}?${keptParams.sort().join('&')}`;
        return hasEventSpecificPath ? cleanPath : '';
    }

    parseCoordinatesForIdentity(event, fields) {
        const fromObject = event && event.coordinates;
        if (fromObject && Number.isFinite(fromObject.lat) && Number.isFinite(fromObject.lng)) {
            return { lat: fromObject.lat, lng: fromObject.lng };
        }
        const candidates = [event && event.location, fields && fields.location];
        for (const candidate of candidates) {
            const text = String(candidate || '').trim();
            const match = text.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
            if (match) {
                return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
            }
        }
        return null;
    }

    // Normalize scraped events and calendar events (which carry `name` instead of `title`
    // and stash extra fields in notes) into one comparable shape.
    buildIdentityComparisonShape(event) {
        const fields = this.parseNotesIntoFields((event && (event.notes || event.unprocessedDescription)) || '');
        const names = [event.title, event.name, event.originalTitle, event.shortName, fields.shortName]
            .map(value => String(value || '').trim())
            .filter(Boolean);
        return {
            startDate: event.startDate instanceof Date ? event.startDate : this.parseDate(event.startDate),
            timezone: event.timezone
                || fields.timezone
                || event.calendarTimezone
                || (event.city && this.cities[event.city]?.timezone)
                || null,
            ticketUrl: this.normalizeTicketUrlForIdentity(event.ticketUrl || fields.ticketUrl),
            names: [...new Set(names)],
            bar: String(event.bar || fields.bar || '').trim(),
            address: String(event.address || fields.address || '').trim(),
            locationText: typeof event.location === 'string' ? event.location : '',
            coordinates: this.parseCoordinatesForIdentity(event, fields)
        };
    }

    areIdentityDatesOnSameLocalDay(shapeA, shapeB) {
        if (!shapeA.startDate || !shapeB.startDate) return false;
        const timezone = shapeA.timezone || shapeB.timezone || null;
        const dayA = this.normalizeEventDateLocal(shapeA.startDate, timezone);
        const dayB = this.normalizeEventDateLocal(shapeB.startDate, timezone);
        return Boolean(dayA) && dayA === dayB;
    }

    areIdentityNamesSimilar(shapeA, shapeB) {
        for (const nameA of shapeA.names) {
            for (const nameB of shapeB.names) {
                if (this.areTitlesSimilar(nameA, nameB)) return true;
            }
        }
        return false;
    }

    areIdentityPlacesSimilar(shapeA, shapeB) {
        const barA = this.normalizeIdentityText(shapeA.bar);
        const barB = this.normalizeIdentityText(shapeB.bar);
        if (barA && barB) {
            if (barA === barB) return true;
            if (barA.length >= 4 && barB.length >= 4 && (barA.includes(barB) || barB.includes(barA))) return true;
        }

        // Calendar events often carry the venue inside a free-form location string
        // ("STATION 4\n3911 Cedar Springs Rd...") rather than a bar field.
        const locationA = this.normalizeIdentityText(shapeA.locationText);
        const locationB = this.normalizeIdentityText(shapeB.locationText);
        if (barA && barA.length >= 4 && locationB.includes(barA)) return true;
        if (barB && barB.length >= 4 && locationA.includes(barB)) return true;

        const addressA = this.normalizeIdentityText(shapeA.address);
        const addressB = this.normalizeIdentityText(shapeB.address);
        if (addressA.length >= 10 && addressB.length >= 10 &&
            (addressA === addressB || addressA.includes(addressB) || addressB.includes(addressA))) {
            return true;
        }

        if (shapeA.coordinates && shapeB.coordinates &&
            Math.abs(shapeA.coordinates.lat - shapeB.coordinates.lat) <= 0.002 &&
            Math.abs(shapeA.coordinates.lng - shapeB.coordinates.lng) <= 0.002) {
            return true;
        }

        return false;
    }

    // Returns the name of the matched identity signal for logging, or null when the
    // events look distinct. Signals are ordered strongest-first.
    // options.requireCloseStartTimes (default true): the place-time-name signal demands
    // start times within 2 hours. Cross-parser dedup relaxes this to same-local-day,
    // because a degraded scrape (missing start time → midnight default) must still
    // match its properly-timed twin from another source.
    getSameEventIdentitySignal(newEvent, existingEvent, options = {}) {
        if (!newEvent || typeof newEvent !== 'object' || !existingEvent || typeof existingEvent !== 'object') {
            return null;
        }
        const requireCloseStartTimes = options.requireCloseStartTimes !== false;
        const incoming = this.buildIdentityComparisonShape(newEvent);
        const existing = this.buildIdentityComparisonShape(existingEvent);

        // Every signal requires the same local calendar day — even a shared ticket URL
        // could otherwise refer to a different night of the same run.
        if (!this.areIdentityDatesOnSameLocalDay(incoming, existing)) return null;

        // A shared ticket URL is a near-unique event identifier.
        if (incoming.ticketUrl && existing.ticketUrl && incoming.ticketUrl === existing.ticketUrl) {
            return 'ticket-url';
        }

        // Same place, roughly the same start time (tolerant of legacy wall-clock offsets),
        // and any pair of name-ish fields (title/name/shortName) similar.
        if ((!requireCloseStartTimes || this.areDatesEqual(incoming.startDate, existing.startDate, 120)) &&
            this.areIdentityPlacesSimilar(incoming, existing) &&
            this.areIdentityNamesSimilar(incoming, existing)) {
            return requireCloseStartTimes ? 'place-time-name' : 'place-day-name';
        }

        return null;
    }

    // Normalize an event's `url` into a same-event identity key: trimmed,
    // case-insensitive host, trailing slash ignored, fragment dropped. Returns
    // null for empty/unparseable URLs, non-http(s) URLs, and domain roots — a
    // shared homepage URL is where events were FOUND, not what they ARE, so it
    // must never make two events "the same".
    getEventUrlIdentityKey(url) {
        const raw = String(url || '').trim();
        if (!raw) return null;
        // parseUrl, not the URL global — this must work in Scriptable (see parseUrl).
        const parsed = this.parseUrl(raw);
        if (!parsed || !/^https?:$/i.test(parsed.protocol)) return null;
        const path = String(parsed.pathname || '').replace(/\/+$/, '');
        if (!path) return null; // domain root — no meaningful path segment
        return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${path}${parsed.search || ''}`;
    }

    // Same-URL merges additionally require compatible titles: two records of one
    // event title it the same way or one is a prefixed/suffixed variant of the
    // other ("SPRING THAW" vs "CHUNK CHICAGO presents SPRING THAW!"), while two
    // DIFFERENT parties that happen to share a listing-page URL name themselves
    // differently. Empty titles stay conservative (no merge).
    areTitlesCompatibleForUrlMerge(titleA, titleB) {
        const normalize = (value) => this.stripEmojiForTitleTwin(String(value || ''))
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const a = normalize(titleA);
        const b = normalize(titleB);
        if (!a || !b) return false;
        return a === b || a.includes(b) || b.includes(a);
    }

    // Sanity window for same-URL dedup: recurring events reuse their event page,
    // so records far apart in time are different nights, not duplicates. Returns
    // false when either start date is missing or unparseable (stay conservative).
    areStartDatesWithinDays(eventA, eventB, days) {
        const toDate = (value) => value instanceof Date ? value : this.parseDate(value);
        const dateA = toDate(eventA && eventA.startDate);
        const dateB = toDate(eventB && eventB.startDate);
        if (!dateA || !dateB || Number.isNaN(dateA.getTime()) || Number.isNaN(dateB.getTime())) return false;
        return Math.abs(dateA.getTime() - dateB.getTime()) <= days * 24 * 60 * 60 * 1000;
    }

    // When two records of the same event disagree on identity fields (city/key),
    // trust the richer one: an address means the detail page was scraped (vs a
    // homepage segment whose city may come from hallucinated OCR); failing that,
    // coordinates beat no coordinates. Ties keep the first record.
    pickRicherIdentityRecord(eventA, eventB) {
        const hasAddress = (event) => Boolean(String((event && event.address) || '').trim());
        if (hasAddress(eventA) !== hasAddress(eventB)) return hasAddress(eventA) ? eventA : eventB;
        const hasCoordinates = (event) => Boolean(this.parseCoordinatesForIdentity(event, null));
        if (hasCoordinates(eventA) !== hasCoordinates(eventB)) return hasCoordinates(eventA) ? eventA : eventB;
        return eventA;
    }

    // Positive evidence that two records describe DIFFERENT events: both carry place
    // information and the places do not match. Used to veto key-collision merges —
    // a missing venue on either side stays inconclusive (returns false).
    areEventsDistinctByPlace(eventA, eventB) {
        const shapeA = this.buildIdentityComparisonShape(eventA);
        const shapeB = this.buildIdentityComparisonShape(eventB);
        const hasPlace = (shape) => Boolean(shape.bar || shape.address || shape.coordinates || shape.locationText);
        if (!hasPlace(shapeA) || !hasPlace(shapeB)) return false;
        return !this.areIdentityPlacesSimilar(shapeA, shapeB);
    }

    areEventsSameIdentity(newEvent, existingEvent) {
        return Boolean(this.getSameEventIdentitySignal(newEvent, existingEvent));
    }

    // Process event with conflicts - extract and merge based on strategies
    processEventWithConflicts(event) {
        if (!event._conflicts || event._conflicts.length === 0) {
            return event;
        }
        
        // Store original event data before processing (use canonical comparison shape)
        const conflictEvent = event._conflicts[0] || {};
        const scraperObject = { ...event };
        const calendarObject = {
            title: conflictEvent.title,
            startDate: conflictEvent.startDate,
            endDate: conflictEvent.endDate,
            location: conflictEvent.location,
            notes: conflictEvent.notes,
            url: conflictEvent.url,
            // Parse existing notes for metadata fields
            ...this.parseNotesIntoFields(conflictEvent.notes || '')
        };
        
        // Get merge strategies
        const mergeStrategies = event._fieldMergeStrategies || {};
        
        // Track what was merged and from where
        event._mergeInfo = {
            extractedFields: {},
            mergedFields: {},
            strategy: mergeStrategies
        };
        
        // Helper function to apply merge strategy
        const applyMergeStrategy = (fieldName, existingValue, newValue) => {
            const strategy = mergeStrategies[fieldName] || 'preserve';
            
            switch (strategy) {
                case 'preserve':
                    // Always use calendar value, even if undefined
                    event[fieldName] = existingValue;
                    event._mergeInfo.mergedFields[fieldName] = 'existing';
                    return true;
                    
                case 'upsert':
                    // Prefer calendar if exists, otherwise add scraped
                    if (existingValue !== undefined && existingValue !== null && existingValue !== '') {
                        // Calendar has value, use it
                        event[fieldName] = existingValue;
                        event._mergeInfo.mergedFields[fieldName] = 'existing';
                        return true;
                    } else if (newValue !== undefined && newValue !== null && newValue !== '') {
                        // Calendar doesn't have value, use scraped
                        event[fieldName] = newValue;
                        event._mergeInfo.mergedFields[fieldName] = 'new';
                        return true;
                    } else {
                        // Neither has value, use calendar (undefined)
                        event[fieldName] = existingValue;
                        event._mergeInfo.mergedFields[fieldName] = 'existing';
                        return true;
                    }
                    
                case 'clobber':
                    // Always use scraped value
                    event[fieldName] = newValue;
                    event._mergeInfo.mergedFields[fieldName] = 'new';
                    return true;
            }
            
            return false;
        };
        
        // Process each conflict (usually the existing calendar event)
        event._conflicts.forEach(conflict => {
            // First, parse fields from existing event's notes
            const existingFieldsFromNotes = conflict.notes ? this.parseNotesIntoFields(conflict.notes) : {};
            
            // Process fields from notes
            Object.entries(existingFieldsFromNotes).forEach(([fieldName, value]) => {
                // Track extraction
                event._mergeInfo.extractedFields[fieldName] = {
                    value: value,
                    source: 'existing.notes'
                };
                
                // Apply merge strategy
                applyMergeStrategy(fieldName, value, event[fieldName]);
            });
            
            // Process direct fields from conflict object
            // Handle 'location' -> 'bar' mapping
            if (conflict.location && !existingFieldsFromNotes.bar) {
                applyMergeStrategy('bar', conflict.location, event.bar);
            }
            
            // Process other direct fields that might exist on conflict
            const directFields = ['title', 'description', 'startDate', 'endDate', 'recurrence', 'eventType', 'recurring'];
            directFields.forEach(fieldName => {
                if (conflict[fieldName] && !existingFieldsFromNotes[fieldName]) {
                    applyMergeStrategy(fieldName, conflict[fieldName], event[fieldName]);
                }
            });
        });
        
        // Build merged object for rich comparison (exclude internal fields/notes)
        const mergedObject = {};
        Object.keys(event).forEach(fieldName => {
            if (fieldName.startsWith('_') || fieldName === 'notes') return;
            mergedObject[fieldName] = event[fieldName];
        });
        
        // Store original event data for display comparisons
        event._original = {
            scraper: scraperObject,
            calendar: calendarObject,
            merged: mergedObject
        };
        
        return event;
    }



    // ============================================================================
    // AI ORCHESTRATION HELPERS
    // ============================================================================

    // Debug log channel: full payload dumps go here so the Scriptable adapter can
    // capture them into the run log file without spamming the visible console.
    // In Node console.debug === console.log, so behavior there is unchanged.
    // Pass mirrorToConsole=true (ai.verboseConsoleLogs) to force payloads onto the
    // visible console while actively debugging.
    logDebug(message, mirrorToConsole = false) {
        if (!mirrorToConsole && typeof console.debug === 'function') {
            console.debug(message);
            return;
        }
        console.log(message);
    }

    // djb2 string hash (environment-agnostic — no Node crypto). Used to detect
    // identical AI payloads so repeated dumps can be suppressed in the logs.
    hashString(text) {
        const source = String(text || '');
        let hash = 5381;
        for (let i = 0; i < source.length; i++) {
            hash = (((hash << 5) + hash) + source.charCodeAt(i)) >>> 0;
        }
        return hash.toString(16);
    }

    // Log a full AI payload (prompt or response) on the debug channel, suppressing
    // exact repeats: the context-prep pass and confidence retries would otherwise
    // dump the identical multi-KB payload twice per page.
    logAiPayloadDebug(header, body, aiConfig = null) {
        const payload = String(body || '');
        const mirrorToConsole = Boolean(aiConfig && aiConfig.verboseConsoleLogs);
        if (!this._loggedAiPayloadHashes) {
            this._loggedAiPayloadHashes = new Set();
        }
        const hash = this.hashString(payload);
        if (this._loggedAiPayloadHashes.has(hash)) {
            this.logDebug(`${header} — identical to payload logged earlier (hash ${hash}, ${payload.length} chars), suppressed`, mirrorToConsole);
            return;
        }
        this._loggedAiPayloadHashes.add(hash);
        this.logDebug(`${header} (${payload.length} chars)\n${payload}`, mirrorToConsole);
    }

    normalizePayloadMode(mode) {
        const normalized = String(mode || '').trim().toLowerCase();
        if (normalized === 'exhaustive' || normalized === 'jsonld' || normalized === 'meta') return normalized;
        return 'best';
    }

    // Canonical AI config resolution (single source of truth — AiWebParser.getAiConfig
    // delegates here). Takes the raw `ai` block from a parser or global config and
    // returns the normalized shape callAiGenerate expects.
    resolveAiConfig(rawAiConfig = {}) {
        const aiConfig = rawAiConfig && typeof rawAiConfig === 'object' ? rawAiConfig : {};
        const provider = String(aiConfig.provider || 'openai');
        const defaultEndpoint = provider === 'openai'
            ? 'http://rybook.taila7523c.ts.net:8000/v1/chat/completions'
            : 'http://desktop.taila7523c.ts.net:11434/api/generate';
        const defaultModel = provider === 'openai'
            ? 'lmstudio-community/Qwen3-Coder-Next-MLX-6bit'
            : 'qwen3.5:4b';

        return {
            enabled: aiConfig.enabled !== false,
            provider: provider,
            endpoint: String(aiConfig.endpoint || defaultEndpoint),
            model: String(aiConfig.model || defaultModel),
            payloadMode: this.normalizePayloadMode(aiConfig.payloadMode),
            maxHtmlChars: Number.isFinite(Number(aiConfig.maxHtmlChars)) ? Number(aiConfig.maxHtmlChars) : 6000,
            numCtx: Number.isFinite(Number(aiConfig.numCtx)) ? Number(aiConfig.numCtx) : 8192,
            numPredict: Number.isFinite(Number(aiConfig.numPredict)) ? Number(aiConfig.numPredict) : 2000,
            temperature: Number.isFinite(Number(aiConfig.temperature)) ? Number(aiConfig.temperature) : 0,
            think: Object.prototype.hasOwnProperty.call(aiConfig, 'think') ? Boolean(aiConfig.think) : false,
            timeoutSeconds: Number.isFinite(Number(aiConfig.timeoutSeconds)) ? Number(aiConfig.timeoutSeconds) : 120,
            keepAlive: Object.prototype.hasOwnProperty.call(aiConfig, 'keepAlive') ? String(aiConfig.keepAlive) : '5m',
            arbitrateMerges: aiConfig.arbitrateMerges !== false,
            // Override-only: extra text appended verbatim to extraction prompt
            // context. Organizer context is normally derived from page metadata.
            extraContext: typeof aiConfig.extraContext === 'string' ? aiConfig.extraContext : '',
            verboseConsoleLogs: aiConfig.verboseConsoleLogs === true,
            ollama: aiConfig.ollama && typeof aiConfig.ollama === 'object' ? aiConfig.ollama : {},
            openai: aiConfig.openai && typeof aiConfig.openai === 'object' ? aiConfig.openai : {}
        };
    }

    // The organizer brand a parser derived from page metadata and stamped as
    // internal metadata (_organizer, excluded from notes/merge field loops).
    // First non-empty value across the given event records wins.
    getKnownOrganizer(...events) {
        for (const event of events) {
            const organizer = event && typeof event._organizer === 'string' ? event._organizer.trim() : '';
            if (organizer) return organizer;
        }
        return '';
    }

    // AI config for merge arbitration: the event's own parser config wins, the global
    // config.ai block covers events from non-AI parsers (bearracuda etc.).
    getMergeArbitrationConfig(event, globalConfig = null) {
        const rawAi = (event && event._parserConfig && event._parserConfig.ai && typeof event._parserConfig.ai === 'object' && event._parserConfig.ai)
            || (globalConfig && globalConfig.ai && typeof globalConfig.ai === 'object' && globalConfig.ai)
            || {};
        return this.resolveAiConfig(rawAi);
    }

    // Detect the image mime type from base64 magic bytes so OpenAI-compatible servers
    // that trust the data-URL label (instead of sniffing bytes) decode correctly.
    detectBase64ImageMimeType(base64Image) {
        const text = String(base64Image || '');
        if (text.startsWith('/9j/')) return 'image/jpeg';
        if (text.startsWith('iVBOR')) return 'image/png';
        if (text.startsWith('R0lGO')) return 'image/gif';
        if (text.startsWith('UklGR')) return 'image/webp';
        return 'image/png';
    }

    buildAiPayload(aiConfig, prompt, base64Image = null) {
        if (aiConfig.provider === 'ollama') {
            const payload = {
                model: aiConfig.model,
                prompt: prompt,
                format: "json",
                stream: false,
                think: aiConfig.think,
                keep_alive: aiConfig.keepAlive,
                options: {
                    num_ctx: aiConfig.numCtx,
                    num_predict: aiConfig.numPredict,
                    temperature: aiConfig.temperature
                }
            };
            if (base64Image) {
                payload.images = [base64Image];
            }
            return payload;
        }

        if (aiConfig.provider === 'openai') {
            let userContent;
            if (base64Image) {
                userContent = [
                    { type: "text", text: prompt },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:${this.detectBase64ImageMimeType(base64Image)};base64,${base64Image}`
                        }
                    }
                ];
            } else {
                userContent = prompt;
            }

            const payload = {
                model: aiConfig.model,
                messages: [
                    { role: "user", content: userContent }
                ],
                temperature: aiConfig.temperature,
                max_tokens: Math.floor(aiConfig.numPredict)
            };

            const responseFormat = aiConfig.openai?.responseFormat;
            if (responseFormat !== 'none') {
                payload.response_format = { type: responseFormat || "json_object" };
            }

            return payload;
        }

        throw new Error(`Unsupported AI provider: ${aiConfig.provider}`);
    }

    extractAiResponse(aiConfig, responseBody) {
        if (!responseBody) return null;

        if (aiConfig.provider === 'ollama') {
            return responseBody.response;
        }

        if (aiConfig.provider === 'openai') {
            return responseBody.choices?.[0]?.message?.content;
        }

        throw new Error(`Unsupported AI provider: ${aiConfig.provider}`);
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
        // Arrays are rejected: a garbage response like "[0]" would otherwise be
        // processed as an event object with numeric field keys.
        const isUsableEventObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
        if (!rawText) return null;
        try {
            const parsed = JSON.parse(rawText);
            return isUsableEventObject(parsed) ? parsed : null;
        } catch (parseError) {
            const jsonObject = this.extractFirstJsonObject(rawText);
            if (!jsonObject) return null;
            try {
                const parsed = JSON.parse(jsonObject);
                return isUsableEventObject(parsed) ? parsed : null;
            } catch (jsonError) {
                return null;
            }
        }
    }

    async callAiGenerate(aiConfig, prompt, passLabel, httpAdapter, promptHistoryRecorder = null, base64Image = null, diagnostics = null) {
        if (!prompt) return null;
        const payload = this.buildAiPayload(aiConfig, prompt, base64Image);
        const label = passLabel ? ` (${passLabel} pass)` : '';
        const promptChars = prompt.length;

        if (promptHistoryRecorder) {
            promptHistoryRecorder(prompt, passLabel, aiConfig);
        }

        console.log(`🤖 AI Web: Sending AI request${label} to ${aiConfig.endpoint} — model: ${aiConfig.model}, provider: ${aiConfig.provider}, prompt: ${promptChars} chars`);
        this.logAiPayloadDebug(`🤖 AI Web: Full prompt${label}`, prompt, aiConfig);

        const startTime = Date.now();
        try {
            if (!httpAdapter || typeof httpAdapter.postJson !== 'function') {
                throw new Error('No HTTP adapter available for AI request');
            }

            const response = await httpAdapter.postJson(aiConfig.endpoint, payload, {
                timeoutSeconds: aiConfig.timeoutSeconds
            });

            if (!response.ok) {
                console.warn(`🤖 AI Web: AI request${label} returned HTTP ${response.status} after ${Date.now() - startTime}ms`);
                if (response.text) {
                    console.log(`🤖 AI Web: Error response body${label}\n${response.text}`);
                }
                return null;
            }

            let responseJson = null;
            if (response.text) {
                try {
                    responseJson = JSON.parse(response.text);
                } catch (parseError) {
                    console.warn(`🤖 AI Web: AI request${label} returned non-JSON payload (${response.text.length} chars)`);
                    console.log(`🤖 AI Web: Raw response payload${label}\n${response.text}`);
                    return null;
                }
            }

            const elapsed = Date.now() - startTime;
            const responseContent = this.extractAiResponse(aiConfig, responseJson);

            if (responseContent && typeof responseContent === 'string' && responseContent.length > 0) {
                console.log(`🤖 AI Web: AI request${label} succeeded in ${elapsed}ms — response: ${responseContent.length} chars`);
                this.logAiPayloadDebug(`🤖 AI Web: Model response text${label}`, responseContent, aiConfig);
                return responseContent;
            }

            const doneReason = responseJson && typeof responseJson.done_reason === 'string' ? responseJson.done_reason : 'n/a';
            // OpenAI-compatible servers (rapid-mlx) report finish_reason "length" with zero
            // tokens generated when the prompt+image alone overflow the model context —
            // a deterministic failure that will recur on every retry with the same image.
            const choice = responseJson && Array.isArray(responseJson.choices) ? responseJson.choices[0] : null;
            const finishReason = choice && typeof choice.finish_reason === 'string' ? choice.finish_reason : null;
            const completionTokens = responseJson && responseJson.usage ? Number(responseJson.usage.completion_tokens) : NaN;
            if (base64Image && finishReason === 'length' && !(completionTokens > 0)) {
                if (diagnostics && typeof diagnostics === 'object') {
                    diagnostics.failureKind = 'context-overflow';
                }
                console.warn(`🚨 AI Web: AI request${label} generated 0 tokens with finish_reason "length" — the image (${base64Image.length} base64 chars) likely exceeds the model's context window. Downscale the image or raise the server's context limit.`);
            }
            console.warn(`🤖 AI Web: AI request${label} completed in ${elapsed}ms with empty response (done_reason: ${doneReason})`);
            if (response.text) {
                console.log(`🤖 AI Web: Raw response payload${label}\n${response.text}`);
            }
            return null;
        } catch (error) {
            const elapsed = Date.now() - startTime;
            const errorType = error && error.name ? error.name : 'Error';
            console.warn(`🤖 AI Web: AI request${label} to ${aiConfig.endpoint} with model ${aiConfig.model} failed after ${elapsed}ms (${errorType}): ${error.message}`);
            return null;
        }
    }

    // ------------------------------------------------------------------
    // CALENDAR REVIEWER — pure review core. Each check is a named async
    // function (events, context) → findings; register future checks
    // (missing fields, duplicates, ...) in getCalendarReviewChecks.
    // Events are plain objects mapped by the adapter:
    //   { id, calendarTitle, title, startDate, location, address, bar,
    //     description }
    // Findings (one per event; 'ok' ones are countable for the summary):
    //   { id, calendarTitle, eventTitle, startDate, check, status,
    //     current: {location, address}, proposed: {location?, address?},
    //     distanceKm?, detail }
    // Network only via context.httpAdapter and the injected geocode
    // normalizer — no Scriptable APIs, no env detection.
    // ------------------------------------------------------------------

    getCalendarReviewChecks() {
        return {
            geocode: (events, context) => this.runGeocodeReviewCheck(events, context)
        };
    }

    async reviewCalendarEvents(events, context = {}) {
        const list = Array.isArray(events) ? events : [];
        const checks = context.checks && typeof context.checks === 'object'
            ? context.checks
            : this.getCalendarReviewChecks();
        const findings = [];
        for (const [checkName, runCheck] of Object.entries(checks)) {
            const checkFindings = await runCheck(list, context);
            if (Array.isArray(checkFindings)) {
                findings.push(...checkFindings);
            } else {
                console.warn(`🔎 REVIEW: Check "${checkName}" returned no findings array — skipped`);
            }
        }
        return findings;
    }

    // Reverse of the adapter's getCalendarName: calendar title → city key,
    // via the cities config first, then the `chunky-dad-<city>` convention.
    cityForCalendarTitle(calendarTitle) {
        const title = String(calendarTitle || '').trim();
        if (!title) return '';
        for (const [cityKey, cityConfig] of Object.entries(this.cities)) {
            if (cityConfig && cityConfig.calendar === title) return cityKey;
        }
        const match = /^chunky-dad-(.+)$/.exec(title);
        return match ? match[1] : '';
    }

    static summarizeReviewFindings(findings) {
        const summary = { findings: 0, ok: 0, byStatus: {}, proposals: 0, missingProposals: 0 };
        (Array.isArray(findings) ? findings : []).forEach(finding => {
            if (!finding) return;
            summary.findings += 1;
            const status = String(finding.status || 'unknown');
            summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;
            if (status === 'ok') summary.ok += 1;
            if (finding.proposed && Object.keys(finding.proposed).length > 0) {
                summary.proposals += 1;
                if (status === 'missing-pin' || status === 'missing-address') {
                    summary.missingProposals += 1;
                }
            }
        });
        return summary;
    }

    // v1 geocode check: verify stored pins against a fresh grade-gated
    // geocode of each event's address, propose pins/addresses for events
    // missing one side, and surface addresses that refuse to geocode.
    // context.geocodeNormalizer must be an OpenStreetMapNormalizer instance —
    // the scraper's forward ladder / grade gate / verification is reused, not
    // reimplemented. context.barDataNormalizer (optional, a BarDataNormalizer
    // instance whose core carries the bars config) makes curated bar data the
    // authoritative source before any geocoding happens. Unique addresses are
    // geocoded once: venues repeat across events and every Nominatim call
    // costs 1.1s of throttle.
    async runGeocodeReviewCheck(events, context = {}) {
        const httpAdapter = context.httpAdapter || null;
        const geocoder = context.geocodeNormalizer;
        if (!geocoder || typeof geocoder.normalizeAsync !== 'function') {
            throw new Error('Geocode review check requires context.geocodeNormalizer (OpenStreetMapNormalizer instance)');
        }
        const thresholdRaw = Number(context.pinMovedThresholdKm);
        const thresholdKm = Number.isFinite(thresholdRaw) && thresholdRaw > 0 ? thresholdRaw : PIN_MOVED_THRESHOLD_KM;
        // Probes ALWAYS run in enforce mode — any caller-supplied
        // context.geocodeVerification is deliberately ignored. The scraper's
        // report mode accepts-and-flags suspect pins (right for scraping: a
        // flagged pin beats no pin on a brand-new event), but the reviewer
        // proposes DESTRUCTIVE replacements of stored pins, so a pin that
        // failed the reverse cross-check or is only street-grade for a
        // house-numbered address must reject and continue the ladder instead
        // of coming back as a "fresh verified geocode" (2026-07 run:
        // report-mode probes proposed moving correct pins 4.7 km onto a
        // street centroid).
        const geocodeOptions = { geocodeVerification: { mode: 'enforce' } };
        const normalizeAddressKey = (address) => String(address || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const forwardKeyFor = (city, address) => `${city}|${normalizeAddressKey(address)}`;
        const reverseKeyFor = (pin) => `${pin.lat.toFixed(5)},${pin.lng.toFixed(5)}`;

        // Pass 0: curated bar data is the AUTHORITATIVE location source — a
        // vague address like "Poconos, PA" can never geocode to the venue, but
        // the bars config knows it exactly (2026-07-16 run: "FURBALL CAMP" at
        // Camp Out got a pin-moved proposal 33 km off from a Nominatim POI).
        // Each event's probe (location stripped so the bar's own coordinates
        // must fill it) runs through the REAL BarDataNormalizer — the same
        // name/title/address/coordinates/description matching the scraper
        // pipeline applies. A match only counts when it yielded coordinates;
        // matched events skip the geocode pool entirely.
        const barNormalizer = context.barDataNormalizer && typeof context.barDataNormalizer.normalize === 'function'
            ? context.barDataNormalizer
            : null;
        const barMatchByEvent = new Map();
        if (barNormalizer) {
            for (const event of events) {
                if (!event) continue;
                const city = this.cityForCalendarTitle(String(event.calendarTitle || ''));
                const eventAddress = typeof event.address === 'string' ? event.address.trim() : '';
                const probe = {
                    title: event.title,
                    address: eventAddress,
                    city,
                    bar: typeof event.bar === 'string' ? event.bar.trim() : '',
                    description: typeof event.description === 'string' ? event.description : ''
                };
                barNormalizer.normalize(probe);
                if (this.isCoordinatePair(probe.location)) {
                    const curatedAddress = typeof probe.address === 'string' ? probe.address.trim() : '';
                    barMatchByEvent.set(event, {
                        barName: typeof probe.bar === 'string' && probe.bar.trim() ? probe.bar.trim() : 'curated bar',
                        location: probe.location.trim(),
                        // The normalizer already applied its own address heuristic
                        // (missing or shorter event address loses to the curated
                        // one), so any difference here IS a material upgrade.
                        address: curatedAddress && curatedAddress !== eventAddress ? curatedAddress : ''
                    });
                }
            }
            if (barMatchByEvent.size > 0) {
                console.log(`🔎 REVIEW: ${barMatchByEvent.size} event(s) matched curated bar data — skipping geocode for them`);
            }
        }

        // Pass 1: unique forward jobs (per city + address) and unique reverse
        // jobs (per stored pin), plus per-calendar counts for the progress log.
        // Bar-matched events never enter the pools — curated data needs no
        // external verification.
        const forwardJobs = new Map();
        const reverseJobs = new Map();
        const calendarCounts = new Map();
        for (const event of events) {
            if (!event) continue;
            const calendarTitle = String(event.calendarTitle || '');
            const counts = calendarCounts.get(calendarTitle) || { events: 0, addresses: new Set() };
            counts.events += 1;
            calendarCounts.set(calendarTitle, counts);
            if (barMatchByEvent.has(event)) continue;
            const city = this.cityForCalendarTitle(calendarTitle);
            const address = typeof event.address === 'string' ? event.address.trim() : '';
            const title = event.title || address || event.location || 'unknown';
            if (address) {
                const key = forwardKeyFor(city, address);
                counts.addresses.add(key);
                if (!forwardJobs.has(key)) {
                    forwardJobs.set(key, {
                        address,
                        city,
                        bar: typeof event.bar === 'string' ? event.bar.trim() : '',
                        title
                    });
                }
            } else if (this.isCoordinatePair(event.location)) {
                const pin = this.parseCoordinatePair(event.location);
                const key = reverseKeyFor(pin);
                if (!reverseJobs.has(key)) {
                    reverseJobs.set(key, { location: event.location.trim(), title });
                }
            }
        }
        for (const [calendarTitle, counts] of calendarCounts) {
            console.log(`🔎 REVIEW: ${calendarTitle || '(unknown calendar)'} — ${counts.events} events, ${counts.addresses.size} unique addresses to geocode`);
        }

        // Pass 2: geocode. Probes carry only {title, address, city, bar} with
        // location stripped so the normalizer's forward path runs exactly as
        // it does for scraped events (the normalizer's own 🗺️ lines show the
        // ladder detail).
        const freshPinByKey = new Map();
        let jobIndex = 0;
        for (const [key, job] of forwardJobs) {
            jobIndex += 1;
            console.log(`🔎 REVIEW: Geocoding "${job.address}"${job.city ? ` (${job.city})` : ''} — ${jobIndex}/${forwardJobs.size}`);
            const probe = { title: job.title, address: job.address, city: job.city, bar: job.bar };
            try {
                await geocoder.normalizeAsync(probe, httpAdapter, geocodeOptions);
            } catch (error) {
                console.warn(`🔎 REVIEW: Geocode failed for "${job.address}": ${error.message}`);
            }
            // Keep the normalizer's verdict alongside the pin: only exact-grade,
            // non-cross-check-failed pins may back a proposal. The grade/crossCheck
            // breadcrumb also survives when NO pin resolved (enforce rejected a
            // street-grade or cross-check-failed candidate) so findings can say
            // "unverifiable" instead of "won't geocode".
            freshPinByKey.set(key, {
                location: this.isCoordinatePair(probe.location) ? probe.location.trim() : null,
                grade: typeof probe._geocodeGrade === 'string' ? probe._geocodeGrade : null,
                crossCheck: typeof probe._geocodeCrossCheck === 'string' ? probe._geocodeCrossCheck : null
            });
        }
        // Reverse path (pin → address) is nearly free: the normalizer prefers
        // the adapter's native reverse geocoder over Nominatim.
        const addressByPinKey = new Map();
        for (const [key, job] of reverseJobs) {
            const probe = { title: job.title, location: job.location };
            try {
                await geocoder.normalizeAsync(probe, httpAdapter, geocodeOptions);
            } catch (error) {
                console.warn(`🔎 REVIEW: Reverse geocode failed for "${job.location}": ${error.message}`);
            }
            const address = typeof probe.address === 'string' ? probe.address.trim() : '';
            addressByPinKey.set(key, address || null);
        }

        // Pass 3: one finding per event.
        const findings = [];
        for (const event of events) {
            if (!event) continue;
            const calendarTitle = String(event.calendarTitle || '');
            const city = this.cityForCalendarTitle(calendarTitle);
            const address = typeof event.address === 'string' ? event.address.trim() : '';
            const location = typeof event.location === 'string' ? event.location.trim() : '';
            const hasPin = this.isCoordinatePair(location);
            const finding = {
                id: event.id,
                calendarTitle,
                eventTitle: event.title || '(untitled)',
                startDate: event.startDate || null,
                check: 'geocode',
                status: 'ok',
                current: { location, address },
                proposed: {},
                detail: ''
            };
            const barMatch = barMatchByEvent.get(event) || null;
            if (barMatch) {
                // Curated bar data: grade 'exact' + crossCheck 'pass' by fiat —
                // hand-maintained coordinates need no external verification, so
                // the specificity gate and cross-check policy below never apply.
                // The source tag lets the UI show which events bar data vouched
                // for (summary count + 🍺 notes on collapsed ok entries).
                finding.source = 'bar-data';
                const withAddress = barMatch.address ? ' + address' : '';
                if (!hasPin) {
                    finding.status = 'missing-pin';
                    finding.proposed.location = barMatch.location;
                    if (barMatch.address) finding.proposed.address = barMatch.address;
                    finding.detail = `pin${withAddress} from curated bar data (${barMatch.barName})`;
                } else {
                    const distanceKm = this.coordinatePairDistanceKm(location, barMatch.location);
                    finding.distanceKm = distanceKm;
                    if (distanceKm !== null && distanceKm > thresholdKm) {
                        finding.status = 'pin-moved';
                        finding.proposed.location = barMatch.location;
                        if (barMatch.address) finding.proposed.address = barMatch.address;
                        finding.detail = `stored pin is ${distanceKm.toFixed(1)}km off — pin${withAddress} from curated bar data (${barMatch.barName})`;
                    } else {
                        finding.detail = `matches curated bar data (${barMatch.barName})`;
                    }
                }
                findings.push(finding);
                continue;
            }
            if (address) {
                const fresh = freshPinByKey.get(forwardKeyFor(city, address)) || null;
                const freshLocation = fresh && fresh.location ? fresh.location : null;
                // Belt-and-suspenders proposal gate: only an exact-grade pin whose
                // reverse cross-check did not fail may be proposed. Enforce-mode
                // probes should already have rejected failures; street-grade pins
                // still reach here for addresses without a parseable house number
                // (e.g. hyphenated Queens numbers like "10-90 Wyckoff Avenue").
                const proposalGrade = !!(freshLocation && fresh.grade === 'exact' && fresh.crossCheck !== 'fail');
                // Input-specificity gate: geocoder answers for a vague input
                // ("Poconos, PA") are arbitrary no matter their grade or
                // cross-check — never proposal material (2026-07-16 run:
                // Nominatim's POI candidate for "Poconos, PA" graded 'exact'
                // and was proposed 33 km from the venue).
                const streetSpecific = typeof geocoder.isStreetSpecificAddress === 'function'
                    ? geocoder.isStreetSpecificAddress(address)
                    : true;
                if (!freshLocation && !(fresh && fresh.grade)) {
                    finding.status = 'unpinnable';
                    finding.detail = hasPin
                        ? 'address no longer geocodes to a usable pin — stored pin kept but unverified'
                        : 'no usable geocoordinate for this address (grade gate/ladder found nothing)';
                } else if (!streetSpecific) {
                    finding.status = 'unverified';
                    finding.detail = 'address too vague to geocode reliably — fix the address or add a bar field first';
                } else if (!proposalGrade) {
                    // A pin resolved (or a candidate was rejected by enforce) but
                    // it is not proposal-grade — never propose it, never touch the
                    // stored pin. An exact-grade candidate that ended UNPINNED
                    // with a 'skipped' breadcrumb was rejected because the
                    // reverse cross-check could not run (Apple rate-limited/
                    // down) — surface the recover hint, not a grade complaint.
                    finding.status = 'unverified';
                    const reason = fresh.crossCheck === 'fail'
                        ? 'address geocode failed the reverse cross-check'
                        : (!freshLocation && fresh.grade === 'exact')
                            ? 'reverse cross-check unavailable — re-run when Apple geocoding recovers'
                            : 'address only resolves to a street-grade pin';
                    finding.detail = hasPin
                        ? `${reason} — stored pin kept, verify manually`
                        : `${reason} — not proposing it`;
                } else if (!hasPin) {
                    finding.status = 'missing-pin';
                    finding.proposed.location = freshLocation;
                    finding.detail = location
                        ? `location "${location}" is not a coordinate pair — fresh geocode proposed`
                        : 'address geocodes but no pin is stored — fresh geocode proposed';
                } else {
                    const distanceKm = this.coordinatePairDistanceKm(location, freshLocation);
                    finding.distanceKm = distanceKm;
                    if (distanceKm !== null && distanceKm > thresholdKm) {
                        // Destructively replacing a stored pin demands a PASSED
                        // reverse cross-check. A 'skipped' cross-check (Apple
                        // reverse geocoding rate-limited/unavailable) silently
                        // removed the whole safety layer on the 2026-07-16 run —
                        // additive missing-pin proposals stay allowed on
                        // 'skipped', destructive pin-moved ones do not.
                        if (fresh.crossCheck === 'pass') {
                            finding.status = 'pin-moved';
                            finding.proposed.location = freshLocation;
                            finding.detail = `stored pin is ${distanceKm.toFixed(1)}km from the fresh verified geocode of this address`;
                        } else {
                            finding.status = 'unverified';
                            finding.detail = 'reverse cross-check unavailable — re-run when Apple geocoding recovers';
                        }
                    } else {
                        finding.detail = 'stored pin matches a fresh geocode of the address';
                    }
                }
            } else if (hasPin) {
                const reverse = addressByPinKey.get(reverseKeyFor(this.parseCoordinatePair(location))) || null;
                finding.status = 'missing-address';
                if (reverse) {
                    finding.proposed.address = reverse;
                    finding.detail = 'pin has no address — reverse-geocoded address proposed';
                } else {
                    finding.detail = 'pin has no address and reverse geocoding returned nothing';
                }
            } else {
                finding.status = 'no-data';
                finding.detail = 'no coordinates and no address on this event';
            }
            findings.push(finding);
        }
        return findings;
    }

}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SharedCore };
} else if (typeof window !== 'undefined') {
    window.SharedCore = SharedCore;
} else {
    // Scriptable environment
    this.SharedCore = SharedCore;


}

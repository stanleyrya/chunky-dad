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

// New-venue-candidate detection (gathering-only growth loop): barSource
// stamps that positively corroborate an extracted bar name without meaning
// "already curated". Candidate evidence caps sourceEvents per venue.
const NEW_VENUE_CANDIDATE_BAR_SOURCES = Object.freeze(['page-adjacent', 'venue-site', 'geo-poi']);
const NEW_VENUE_CANDIDATE_SOURCE_EVENT_CAP = 5;

// Merge-time address comparison: street-type abbreviations and directionals
// expanded on BOTH sides so "619 E. Pine St" and "619 East Pine Street"
// tokenize identically. Modeled on normalizers.js
// GEOCODE_ABBREVIATION_EXPANSIONS (the geocode reverse cross-check) and the
// ai-web-parser street-line matcher — both of those maps are deliberately
// narrower (each tuned to its own run-verified check), and both modules sit
// DOWNSTREAM of shared-core (they receive a core instance; shared-core can
// import from neither), so the merge ladder carries its own superset map.
const ADDRESS_ABBREVIATION_EXPANSIONS = {
    st: 'street', ave: 'avenue', rd: 'road', blvd: 'boulevard', dr: 'drive',
    ln: 'lane', pl: 'place', ct: 'court', hwy: 'highway', pkwy: 'parkway',
    n: 'north', s: 'south', e: 'east', w: 'west',
    ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest'
};
// Generic street-type designators: a street line that only ADDS one of these
// ("619 E. Pine" vs "619 E. Pine Street") is the same street line; any other
// surplus token ("Pine Street" vs "Pine Avenue", or a different street name)
// is a real difference and must still arbitrate.
const ADDRESS_STREET_TYPE_TOKENS = [
    'street', 'avenue', 'road', 'boulevard', 'drive', 'lane', 'place',
    'court', 'highway', 'parkway', 'way'
];

// Known ticketing platforms for the cross-host ticketUrl merge rung. This is a
// PREFERENCE HEURISTIC, not a gate: a ticketing-platform URL only beats a BARE
// domain root on a non-ticketing host; hosts missing from this list (or any
// non-ticketing candidate with a real path) simply fall through to AI
// arbitration — nothing is ever dropped or blocked for not being listed here.
const TICKETING_PLATFORM_HOSTS = [
    'sickening.events', 'eventbrite.com', 'tixr.com', 'ticketmaster.com',
    'ticketleap.com', 'dice.fm', 'eventeny.com', 'showclix.com'
];

// Multi-orientation image slots. `image` stays the primary (unchanged
// semantics); imageVertical/imageHorizontal are the best PORTRAIT and
// LANDSCAPE candidates so different surfaces can pick the right shape. The
// slots are NOT exclusive of `image` — when the primary is portrait, an event
// carries both `image: X` and `imageVertical: X`. An absent slot means "no
// candidate is known to be that shape" (including "the primary's shape is
// unknown"), never "there is no image".
const IMAGE_ORIENTATION_SLOT_FIELDS = new Set(['imageVertical', 'imageHorizontal']);
// Every field the deterministic image merge rung owns: the primary plus its
// orientation slots. They are all bare image URLs, so the logo-path,
// og-grade-provenance and resolution-margin rules apply to them identically.
// Hosts whose URLs identify a PLATFORM, not the event's own presence:
// ticketing/listing services and social networks. A link like
// eventbrite.com/e/… tells you where to buy, never who is throwing the party,
// so it must not displace a promoter's identity link (observed 2026-07-30:
// Cubhouse's curated https://linktr.ee/cubhouse was clobbered by an Eventbrite
// listing URL, which also broke the icon derived from that field).
// Data only — shared-core stays platform-pure.
const PLATFORM_IDENTITY_HOSTS = [
    'eventbrite.com', 'eventbrite.co.uk', 'eventbrite.ca', 'eventbrite.com.au',
    'dice.fm', 'ra.co', 'residentadvisor.net', 'ticketweb.com', 'ticketweb.co.uk',
    'seetickets.com', 'seetickets.us', 'universe.com', 'posh.vip', 'withfriends.co',
    'tickettailor.com', 'sickening.events', 'redeyetickets.com',
    'ticketmaster.com', 'shotgun.live', 'fatsoma.com', 'meetup.com',
    'partiful.com', 'luma.com', 'lu.ma', 'instagram.com', 'facebook.com',
    'twitter.com', 'x.com', 'tiktok.com',
    // Review 2026-07-30: hosts present in TICKETING_PLATFORM_HOSTS or the
    // site-side PLATFORM_FAVICON_HOSTNAMES but missing here, so the rung
    // silently failed to protect identity links against them.
    'ticketleap.com', 'eventeny.com', 'showclix.com'
]


// Exact host or subdomain of a platform whose URL identifies the PLATFORM,
// not the event's own presence. Suffix matching mirrors
// isKnownTicketingPlatformHost: review 2026-07-30 showed exact-match crowning
// link.dice.fm and m.facebook.com as "identity links" (they differed from the
// canonical entry) while business.facebook.com slipped past entirely.
function isPlatformIdentityHost(host) {
    const normalized = String(host || '').toLowerCase();
    if (!normalized) return false;
    return PLATFORM_IDENTITY_HOSTS.some(platform =>
        normalized === platform || normalized.endsWith(`.${platform}`));
}

const IMAGE_MERGE_FIELDS = new Set(['image', 'imageVertical', 'imageHorizontal']);

// The ONE calendar target an unrecognized city may produce. See
// SharedCore.resolveCalendarTarget — the fallback must never be derived from
// the city string itself, or a page's free text becomes a calendar name.
const UNKNOWN_CALENDAR_NAME = 'chunky-dad-unknown';

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
        // Curated promoter registry (data/promoters.json via the adapters —
        // injected like bars; shared-core never loads files itself).
        this.promoters = options.promoters || [];
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
        // Persistent AI-response cache provider (read/write/stats), injected by
        // the orchestrator from AiWebParser.getAiResponseCache() — persistence
        // stays out of shared-core. Null = no caching.
        this.aiResponseCache = null;
        this.trackingParamPattern = /^(aff|affix|affiliate|utm[-_](?:source|medium|campaign|content|term)|ref|referral|fbclid|gclid|msclkid|dclid|source|mc_cid|mc_eid)$/i;
        
        // URL-to-parser mapping for automatic parser detection (parser: "auto").
        // Only scheme URLs resolve to a specific parser; every http(s) URL falls
        // back to the generic ai-web parser. (The deleted site-specific parsers
        // — bearracuda/chunk/linktree/redeyetickets — used to be detected here;
        // their URL patterns live on in urlSourceMappings below for dedup only.)
        this.urlParserMappings = [
            {
                pattern: /^scriptable-input:\/\//i,
                parser: 'scriptable-input'
            },
            {
                pattern: /^ai-web:\/\//i,
                parser: 'ai-web'
            }
            // Generic parser will be used as fallback if no pattern matches
        ];

        // URL-to-source labels for dedup/key reconstruction ONLY — never parser
        // dispatch. Existing calendar events created by the deleted site-specific
        // parsers carry keys whose ${source} segment was derived from these URL
        // patterns; keeping the labels lets computed keys for those events still
        // match (see buildComputedKeyForExistingEvent / findEventByKey).
        this.urlSourceMappings = [
            {
                pattern: /^scriptable-input:\/\//i,
                source: 'scriptable-input'
            },
            {
                pattern: /bearracuda\.com/i,
                source: 'bearracuda'
            },
            {
                pattern: /chunk-party\.com/i,
                source: 'chunk'
            },
            {
                pattern: /linktr\.ee/i,
                source: 'linktree'
            },
            {
                pattern: /redeyetickets\.com/i,
                source: 'redeyetickets'
            }
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

    // Diacritic-folded lowercase view of city-ish text: NFD-decompose, strip
    // combining marks (U+0300–U+036F), lowercase, trim — "Montréal"/"MONTRÉAL"
    // → "montreal" so accented page/address text matches the unaccented city
    // config patterns (run 20260727-145617: city "montréal" failed the
    // montreal key lookup and timezone resolution). Unaccented ASCII input is
    // byte-identical to plain lowercase+trim. String.prototype.normalize is
    // ES6 and available on iOS JavaScriptCore. ai-web-parser.js duplicates
    // this as foldDiacritics (parsers are standalone and cannot import shared
    // code; keep the two in sync); normalizers.js reaches it via this.core.
    foldDiacritics(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    }

    // Timezone for a city value that may be a config KEY, an accented/cased
    // variant of one ("Montréal"), or any configured name/pattern/alias.
    // Diacritic-folded comparison on BOTH sides. Null when unknown — callers
    // keep their own fallbacks (this is the shared timezone-config-lookup-by-
    // city rung behind every `event.city → timezone` resolution).
    getCityTimezone(city) {
        if (!city || !this.cities || typeof this.cities !== 'object') return null;
        const direct = this.cities[city];
        if (direct && typeof direct === 'object' && typeof direct.timezone === 'string' && direct.timezone.trim()) {
            return direct.timezone.trim();
        }
        const folded = this.foldDiacritics(city);
        if (!folded) return null;
        for (const [key, cityData] of Object.entries(this.cities)) {
            if (!cityData || typeof cityData !== 'object') continue;
            const names = [key, cityData.name]
                .concat(Array.isArray(cityData.patterns) ? cityData.patterns : [])
                .concat(Array.isArray(cityData.aliases) ? cityData.aliases : []);
            if (!names.some(name => this.foldDiacritics(name) === folded)) continue;
            return typeof cityData.timezone === 'string' && cityData.timezone.trim()
                ? cityData.timezone.trim()
                : null;
        }
        return null;
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

    // Detect a legacy source LABEL from a URL — dedup/key logic only, never
    // parser dispatch (the site-specific parsers these labels once named are
    // deleted). Returns null when no pattern matches.
    detectSourceFromUrl(url) {
        if (!url) {
            return null;
        }

        for (const mapping of this.urlSourceMappings) {
            if (mapping.pattern.test(url)) {
                return mapping.source;
            }
        }

        return null;
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

        // 2.5 Raw JSON API bodies (deterministic). A body that IS a JSON document
        //     with recognizable event-shaped objects classifies by object count —
        //     month-name heuristics and the AI second opinion are meaningless on a
        //     payload that contains no prose.
        if (html) {
            const jsonApiEventCount = this.countJsonApiEventObjects(html);
            if (jsonApiEventCount === 1) return { classification: 'event-page', signal: 'json-api' };
            if (jsonApiEventCount >= 2) return { classification: 'multi-event-page', signal: 'json-api' };
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

    // Count event-shaped objects in a raw JSON API response body (non-JSON or
    // unrecognizable shapes → 0). Deterministic and platform-pure. Compact
    // mirror of the ai-web parser's JSON-API recognizer (detectJsonApiPayload +
    // collectJsonApiEventCandidates) — keep the two in sync: an object is
    // event-like when it carries a name/title key plus a start/date-ish key
    // holding an ISO-8601-ish string; candidates come from the payload itself
    // (array), a data/events/items/results wrapper key, or any top-level array
    // of event-like objects; a detail-shaped single object counts as one.
    countJsonApiEventObjects(html) {
        const text = String(html || '').trim();
        if (!text || (text[0] !== '{' && text[0] !== '[')) return 0;
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (_) {
            return 0;
        }
        const normalizeKey = (key) => String(key || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
        const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
        const isArrayOfObjects = (value) => Array.isArray(value) && value.length > 0 && value.every(isPlainObject);
        const isIsoDateish = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value.trim());
        const looksEventLike = (obj) => {
            if (!isPlainObject(obj)) return false;
            const keys = Object.keys(obj);
            const hasTitle = keys.some(key => /^(name|title)$/.test(normalizeKey(key))
                && typeof obj[key] === 'string' && obj[key].trim() !== '');
            if (!hasTitle) return false;
            return keys.some(key => /(^|_)(start|date|datetime)/.test(normalizeKey(key)) && isIsoDateish(obj[key]));
        };
        if (isArrayOfObjects(parsed)) {
            return parsed.filter(looksEventLike).length;
        }
        if (!isPlainObject(parsed)) return 0;
        for (const key of Object.keys(parsed)) {
            if (!/^(data|events|items|results)$/.test(normalizeKey(key))) continue;
            const value = parsed[key];
            if (isArrayOfObjects(value)) return value.filter(looksEventLike).length;
            if (isPlainObject(value) && looksEventLike(value)) return 1;
        }
        for (const value of Object.values(parsed)) {
            if (!isArrayOfObjects(value)) continue;
            const eventLikeCount = value.filter(looksEventLike).length;
            if (eventLikeCount > 0) return eventLikeCount;
        }
        return 0;
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
        // pinSource/addressSource are provenance metadata that must FOLLOW the
        // finalized location/address deterministically (see setProvenanceSource
        // in createFinalEventObject) — never sent to the AI, so a hand-fixed
        // pin/address is never relabeled with a source the scrape didn't produce.
        // bearSource is bear-verdict provenance (keyword/ai/config or a
        // manual-* owner override) — like pinSource it is metadata about how a
        // value was decided, never content the AI may arbitrate; its merge is
        // resolved deterministically in createFinalEventObject so a manual
        // override can never be relabeled by a scraped verdict.
        // imageSource is image provenance (og-image/jsonld/page — where the
        // image value came from at extraction); like pinSource it must FOLLOW
        // the finalized image deterministically (setProvenanceSource), never
        // be arbitrated as content.
        // barSource is bar provenance (page-adjacent/venue-site/curated/
        // geo-poi/uncorroborated — whether the extracted venue was
        // corroborated by the source page or a map POI); like imageSource it
        // must FOLLOW the finalized bar
        // deterministically (setProvenanceSource), never be arbitrated as
        // content.
        if (SharedCore.isProvenanceCompanionField(name)) return false;
        return name !== 'key' && name !== 'notes' && name !== 'source'
            && name !== 'location' && name !== 'gmaps';
    }

    // True for the provenance companion fields (the canonical list lives on
    // SharedCore.PROVENANCE_COMPANION_FIELDS) — metadata that FOLLOWS its value
    // field deterministically (setProvenanceSource / the bearSource merge rule)
    // and is never arbitrated as content.
    static isProvenanceCompanionField(fieldName) {
        return SharedCore.PROVENANCE_COMPANION_FIELDS.indexOf(String(fieldName || '')) !== -1;
    }

    // Trust tier for a provenance companion field's value — higher number =
    // higher authority (per-family vocabularies live on
    // SharedCore.PROVENANCE_TRUST_TIERS). Used by merge verification to tell a
    // legitimate provenance UPGRADE (a higher authority now vouches for the
    // same value, e.g. pinSource geocoded-exact → curated once the bar joins
    // the curated data) apart from a genuine DOWNGRADE.
    //   - unstamped (null/undefined/blank) → 0, the floor of every family
    //     (a fresh stamp where the calendar had none is an upgrade)
    //   - recorded suffixes rank by their prefix at a word boundary, so
    //     `manual-bear (overrode ai: ...)` ranks as `manual-bear`
    //   - unknown/unparseable values (and unknown field names) → null, so
    //     callers FAIL OPEN to today's behavior
    static getProvenanceTrustTier(fieldName, value) {
        const tiers = SharedCore.PROVENANCE_TRUST_TIERS[String(fieldName || '')];
        if (!tiers) return null;
        const normalized = (value === null || value === undefined) ? '' : String(value).trim().toLowerCase();
        if (!normalized) return 0;
        if (Object.prototype.hasOwnProperty.call(tiers, normalized)) return tiers[normalized];
        // Longest prefix wins so 'manual-not-bear ...' can never rank as
        // 'manual-bear'; the prefix must end at a word boundary (space or an
        // opening paren, the shapes buildManualBearSource records).
        const keys = Object.keys(tiers).sort((a, b) => b.length - a.length);
        for (const key of keys) {
            if (normalized.length > key.length && normalized.startsWith(key)) {
                const boundary = normalized.charAt(key.length);
                if (boundary === ' ' || boundary === '(' || boundary === '\t') return tiers[key];
            }
        }
        return null;
    }

    // True when a bearSource value records the calendar owner's manual verdict
    // ("manual-bear ..." / "manual-not-bear ..." as stamped by the results UI).
    isManualBearSource(value) {
        return typeof value === 'string' && value.trim().toLowerCase().startsWith('manual-');
    }

    // The owner's manual verdict stored on a calendar record's notes, or null.
    // Accepts any object carrying `notes` (Scriptable CalendarEvent or plain).
    getManualBearVerdictFromRecord(record) {
        if (!record || typeof record !== 'object') return null;
        const fields = this.parseNotesIntoFields(record.notes || '');
        const value = typeof fields.bearSource === 'string' ? fields.bearSource.trim().toLowerCase() : '';
        if (value.startsWith('manual-not-bear')) return 'manual-not-bear';
        if (value.startsWith('manual-bear')) return 'manual-bear';
        return null;
    }

    // One-line manual bearSource value: `manual-bear (overrode ai: <reason>)` /
    // `manual-not-bear (overrode ai: <reason>)`, reason truncated to ~80 chars.
    static buildManualBearSource(direction, overriddenReason) {
        const label = direction === 'bear' ? 'manual-bear' : 'manual-not-bear';
        let reason = String(overriddenReason || '').replace(/\s+/g, ' ').trim();
        // The stored verdict reasons are prefixed with their cascade tier
        // ("ai: drag show") — the label already says "overrode ai", so strip it.
        reason = reason.replace(/^ai:\s*/i, '');
        if (!reason) return label;
        if (reason.length > 80) reason = `${reason.slice(0, 77)}...`;
        return `${label} (overrode ai: ${reason})`;
    }

    // Provenance (pinSource/addressSource) follows the finalized value: whichever
    // side's value the merge kept for `valueField`, copy that side's `sourceField`
    // onto the merged object. A value the merge produced fresh from the scrape
    // carries the scrape's source; a value KEPT from the calendar carries the
    // calendar's stored source (absent → left absent, so a hand-fixed pin/address
    // is never relabeled with a source the scrape didn't produce for it). Purely
    // deterministic value comparison — never AI-arbitrated.
    setProvenanceSource(mergedObject, valueField, sourceField, scraperObject, calendarObject) {
        const finalValue = mergedObject[valueField];
        if (finalValue === undefined || finalValue === null || finalValue === '') return;
        const scraperMatches = this.mergeValuesEqualForTracking(finalValue, scraperObject[valueField]);
        const calendarMatches = this.mergeValuesEqualForTracking(finalValue, calendarObject[valueField]);
        const isUsableSource = (value) => typeof value === 'string' && value.trim().length > 0;
        let source;
        if (scraperMatches && isUsableSource(scraperObject[sourceField])) {
            source = scraperObject[sourceField].trim();
        } else if (calendarMatches && isUsableSource(calendarObject[sourceField])) {
            source = calendarObject[sourceField].trim();
        }
        if (source) mergedObject[sourceField] = source;
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

    // Exact host or subdomain of a known ticketing platform (host must already
    // be lowercased/www-stripped, as getUrlRuleParts returns it). Subdomain
    // matching covers e.g. events.ticketleap.com.
    isKnownTicketingPlatformHost(host) {
        const normalized = String(host || '').toLowerCase();
        if (!normalized) return false;
        return TICKETING_PLATFORM_HOSTS.some(platform =>
            normalized === platform || normalized.endsWith(`.${platform}`));
    }

    // Query-string parameter lookup built on plain string splitting —
    // URLSearchParams does not exist in iOS JavaScriptCore (Scriptable).
    extractSearchParamValue(search, key) {
        if (!search || !key) return '';
        const normalizedKey = String(key).trim().toLowerCase();
        const searchText = String(search).replace(/^\?/, '');
        if (!normalizedKey || !searchText) return '';
        for (const pair of searchText.split('&')) {
            if (!pair) continue;
            const separatorIndex = pair.indexOf('=');
            const rawKey = separatorIndex >= 0 ? pair.slice(0, separatorIndex) : pair;
            const rawValue = separatorIndex >= 0 ? pair.slice(separatorIndex + 1) : '';
            let decodedKey = rawKey;
            try {
                decodedKey = decodeURIComponent(rawKey.replace(/\+/g, ' '));
            } catch (_) {}
            if (String(decodedKey || '').trim().toLowerCase() !== normalizedKey) continue;
            try {
                return decodeURIComponent(rawValue.replace(/\+/g, ' '));
            } catch (_) {
                return rawValue;
            }
        }
        return '';
    }

    // Pure size score for an image URL — higher means larger. Canonical home of
    // the scoring the ai-web-parser previously owned (its getImageSizeFromUrl
    // now delegates here) so the deterministic image merge rung below and OCR
    // dedup in the parser rank candidates on the SAME scale. No network calls:
    // the score reads width/height/scale query params and resolution-ish path
    // segments; when a URL advertises nothing, the URL length is a weak
    // fallback signal (kept for parser parity — the merge rung's margin guard
    // deliberately ignores that noise floor).
    getImageSizeScoreFromUrl(url) {
        if (!url || typeof url !== 'string') return -1;

        const parsed = this.parseUrl(url);
        if (!parsed) {
            // Fallback: longer URL often means higher quality
            return url.length;
        }

        let score = 0;
        const search = String(parsed.search || '').toLowerCase();
        const path = String(parsed.pathname || '').toLowerCase();
        const getParam = (key) => this.extractSearchParamValue(search, key);

        // Width/height parameters (e.g., ?w=1920, ?width=1080, ?h=1080)
        const width = getParam('w') || getParam('width') || getParam('wpx');
        const height = getParam('h') || getParam('height') || getParam('hpx');
        if (width) {
            const w = parseInt(width, 10);
            if (!isNaN(w)) score += w;
        }
        if (height) {
            const h = parseInt(height, 10);
            if (!isNaN(h)) score += h;
        }

        // Size scale parameters (e.g., ?scale=2, ?size=large)
        const scale = getParam('scale') || getParam('size');
        if (scale) {
            const s = scale.toLowerCase();
            if (s === 'large' || s === 'big' || s === 'max' || s === 'original' || s === 'full') {
                score += 5000;
            } else if (s === 'medium' || s === 'mid') {
                score += 2500;
            } else if (s === 'small' || s === 'tiny') {
                score += 500;
            } else {
                const num = parseInt(s, 10);
                if (!isNaN(num)) score += num;
            }
        }

        // Path resolution indicators (e.g., /1920x1080/, /large/, /original/)
        for (const segment of path.split('/').filter(Boolean)) {
            const resolutionMatch = segment.match(/(\d+)x(\d+)/);
            if (resolutionMatch) {
                score += parseInt(resolutionMatch[1], 10) * parseInt(resolutionMatch[2], 10);
            }
            const pxMatch = segment.match(/(\d+)px/);
            if (pxMatch) {
                score += parseInt(pxMatch[1], 10);
            }
            if (segment === 'large' || segment === 'big' || segment === 'max' || segment === 'original' || segment === 'full' || segment === 'high') {
                score += 5000;
            } else if (segment === 'medium' || segment === 'mid') {
                score += 2500;
            } else if (segment === 'small' || segment === 'tiny') {
                score += 500;
            }
        }

        // Fallback: longer URL often means higher quality
        if (score === 0) {
            score = url.length;
        }
        return score;
    }

    // Width/height advertised BY the URL itself — { width, height } or null.
    // Companion to getImageSizeScoreFromUrl above and bound by the same rules:
    // no network, and no `new URL` / URLSearchParams (neither exists in iOS
    // JavaScriptCore) — parseUrl + extractSearchParamValue only.
    //
    // It answers SHAPE rather than size, so it is stricter than the scorer in
    // three ways:
    //   - both dimensions must be present (one alone says nothing about
    //     orientation) and inside believable bounds;
    //   - it reads Wix's comma-joined transform segment
    //     (…/v1/fill/w_792,h_990,al_c,q_85,enc_avif/… and the …/v1/crop/
    //     x_0,y_0,w_…,h_… twin), which the scorer cannot see at all — on real
    //     chunky.dad data that is the dimension token that actually appears;
    //   - it REJECTS img.evbuc.com's ?w=&h= (see below).
    // Returns null far more often than not — only a minority of real event
    // image URLs advertise anything — so callers must treat null as "unknown",
    // never as "not an image".
    getImageDimensionsFromUrl(url) {
        if (!url || typeof url !== 'string') return null;
        const parsed = this.parseUrl(url.trim());
        if (!parsed) return null;
        const host = String(parsed.hostname || parsed.host || '').toLowerCase().replace(/^www\./, '');
        const path = String(parsed.pathname || '');
        const toDimensions = (rawWidth, rawHeight, minimum = 10) => {
            const width = parseInt(rawWidth, 10);
            const height = parseInt(rawHeight, 10);
            if (!isFinite(width) || !isFinite(height)) return null;
            if (width < minimum || height < minimum || width > 20000 || height > 20000) return null;
            return { width, height };
        };

        // Path forms first — they describe the rendition being served, so they
        // are the trustworthy signal. Wix's comma form, then the generic
        // NNNxNNN token (a /1920x1080/ path segment or a "-820x1024.jpg"
        // filename suffix, both real shapes in data/calendars).
        //
        // Wix chains transforms (…/v1/crop/x_0,y_0,w_2000,h_1000/v1/fill/
        // w_400,h_800/…) and the LAST transform is the rendition actually
        // served, so the last w_/h_ pair in the path wins — never the crop
        // region's shape. A Wix pair, being an explicit dimension syntax,
        // also outranks any generic NNNxNNN token elsewhere in the path.
        //
        // The generic token scan is pattern-matching inside opaque tokens, so
        // it demands ≥100 on BOTH dimensions: "ab12x34cd.jpg" and
        // "os-windows-10x64-download.png" are not renditions, and no real
        // flyer (nor even a 96px favicon) should drive orientation below
        // that. The Wix and query-param paths keep the loose ≥10 bound —
        // they are explicit dimension syntaxes, not guesses.
        let wixDimensions = null;
        let genericDimensions = null;
        for (const segment of path.split('/').filter(Boolean)) {
            const wixWidth = segment.match(/(?:^|,)w_(\d{1,5})(?=,|$)/i);
            const wixHeight = segment.match(/(?:^|,)h_(\d{1,5})(?=,|$)/i);
            if (wixWidth && wixHeight) {
                const dimensions = toDimensions(wixWidth[1], wixHeight[1]);
                if (dimensions) wixDimensions = dimensions;
            }
            const resolution = segment.match(/(?:^|[^\d])(\d{2,5})x(\d{2,5})(?![\dx])/i);
            if (resolution && !genericDimensions) {
                genericDimensions = toDimensions(resolution[1], resolution[2], 100);
            }
        }
        if (wixDimensions) return wixDimensions;
        if (genericDimensions) return genericDimensions;

        // Eventbrite's wrapper never gets to describe the artwork's shape:
        // img.evbuc.com's "?crop=focalpoint&fit=crop&h=230&w=460" is its fixed
        // 2:1 LISTING THUMBNAIL crop of an arbitrary flyer — tools/
        // download-images.js (adjustEventbriteImageUrl) strips exactly these
        // params to recover the original. Reading them would label every
        // Eventbrite flyer landscape.
        if (host === 'img.evbuc.com') return null;

        const search = String(parsed.search || '');
        const width = this.extractSearchParamValue(search, 'w') || this.extractSearchParamValue(search, 'width');
        const height = this.extractSearchParamValue(search, 'h') || this.extractSearchParamValue(search, 'height');
        if (width && height) return toDimensions(width, height);
        return null;
    }

    // 'portrait' | 'landscape' | 'square' | 'unknown' for an image URL.
    // 'unknown' is the COMMON answer (most image URLs advertise no dimensions),
    // so every consumer must degrade to today's behavior when it comes back —
    // orientation is a refinement, never a gate. The 1.1 ratio dead band keeps
    // near-squares (e.g. Wix w_1344,h_1345) out of both buckets and matches
    // ai-web-parser's imageOrientationRatioThreshold (parsers are standalone
    // and cannot import shared code — keep the two in sync).
    classifyImageOrientation(url) {
        const dimensions = this.getImageDimensionsFromUrl(url);
        if (!dimensions) return 'unknown';
        const ratio = dimensions.width / dimensions.height;
        if (ratio >= 1.1) return 'landscape';
        if (ratio <= 1 / 1.1) return 'portrait';
        return 'square';
    }

    // Normalized view of a description for the strict-superset merge rule:
    // lowercased, basic HTML entities decoded, whitespace collapsed. BOTH
    // candidates pass through this, so entity/whitespace differences never
    // block a genuine containment.
    normalizeDescriptionForContainment(value) {
        return String(value || '')
            .replace(/&amp;/gi, '&')
            .replace(/&(?:rsquo|lsquo|apos|#8217|#8216|#39);/gi, "'")
            .replace(/&(?:rdquo|ldquo|quot|#8221|#8220|#34);/gi, '"')
            .replace(/&(?:nbsp|#160);/gi, ' ')
            .replace(/&(?:ndash|mdash|#8211|#8212);/gi, '-')
            .replace(/&(?:hellip|#8230);/gi, '...')
            // Fold the literal unicode twins of those entities too, so an
            // entity-encoded copy contains its decoded (curly-quote) twin.
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/\u00A0/g, ' ')
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/\u2026/g, '...')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
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
        // Accented city values ("Montréal") fold to the config key (Fix: run 20260727-145617)
        const cityData = this.cities[cityKey] || this.cities[normalizedKey] || this.cities[this.foldDiacritics(cityKey)];
        if (!cityData || typeof cityData !== 'object') return false;
        const normalizedTitle = this.foldDiacritics(this.stripEmojiForTitleTwin(title).replace(/\s+/g, ' '));
        if (!normalizedTitle) return false;
        const candidates = new Set();
        const addCandidate = value => {
            const text = this.foldDiacritics(String(value || '').replace(/\s+/g, ' '));
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

    // A leading or trailing DATE-ONLY title segment ("CHUNK DORE ALLEY -
    // Saturday July 25th", "Sept. 19 | CHUNK Chicago", "CHUNK - 7/25"):
    // separator ([-–—|:•] or comma) + optional weekday + month name (full or
    // 3-letter, optional period) + day number with optional ordinal + optional
    // year — or a pure numeric M/D(/YYYY) form attached by separator. On a
    // calendar the printed date is pure redundancy (startDate carries it), and
    // a dated variant could beat the clean one in title merges under the
    // more-descriptive rule. Edition years attached to words ("DECADENCE
    // 2026", "Pride 2027") are NOT date segments — a bare year without a
    // month+day never matches. Returns { base, month, day, year } — base is
    // the remainder with leftover separators/whitespace collapsed, guaranteed
    // non-empty and ≥3 chars; year is null when the title prints none — or
    // null when no such segment exists (fail open on any parse uncertainty).
    // Static + pure string logic so the ai-web parser's extraction-time strip
    // shares this ONE implementation via the module export (shared-core is
    // upstream of the parsers).
    static detectTitleDateSegment(title) {
        if (typeof title !== 'string') return null;
        const text = title.replace(/\s+/g, ' ').trim();
        if (!text) return null;
        const MONTH_NUMBERS = {
            jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
            apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
            aug: 8, august: 8, sep: 9, sept: 9, september: 9,
            oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
        };
        const weekdayPart = '(?:(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\\.?,?\\s+)?';
        const monthPart = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
        const dayPart = '(\\d{1,2})(?:st|nd|rd|th)?';
        const yearPart = '(?:,?\\s+(\\d{4}))?';
        const wordySegment = `${weekdayPart}${monthPart}\\s+${dayPart}${yearPart}`;
        const numericSegment = '(\\d{1,2})\\s*\\/\\s*(\\d{1,2})(?:\\s*\\/\\s*(\\d{4}))?';
        const separatorPart = '\\s*(?:[-–—|:•]|,)\\s*';
        const attempts = [
            { regex: new RegExp(`^(.*?)${separatorPart}${wordySegment}$`, 'i'), wordy: true, base: 1, month: 2, day: 3, year: 4 },
            { regex: new RegExp(`^(.*?)${separatorPart}${numericSegment}$`, 'i'), wordy: false, base: 1, month: 2, day: 3, year: 4 },
            { regex: new RegExp(`^${wordySegment}${separatorPart}(.*)$`, 'i'), wordy: true, base: 4, month: 1, day: 2, year: 3 },
            { regex: new RegExp(`^${numericSegment}${separatorPart}(.*)$`, 'i'), wordy: false, base: 4, month: 1, day: 2, year: 3 }
        ];
        for (const attempt of attempts) {
            const match = text.match(attempt.regex);
            if (!match) continue;
            const month = attempt.wordy
                ? (MONTH_NUMBERS[String(match[attempt.month] || '').toLowerCase()] || null)
                : parseInt(match[attempt.month], 10);
            const day = parseInt(match[attempt.day], 10);
            const year = match[attempt.year] ? parseInt(match[attempt.year], 10) : null;
            if (!month || month < 1 || month > 12) continue;
            if (!day || day < 1 || day > 31) continue;
            if (year !== null && (year < 1900 || year > 2100)) continue;
            const base = String(match[attempt.base] || '')
                .replace(/^[\s\-–—|:•,]+|[\s\-–—|:•,]+$/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (!base || base.length < 3) continue;
            return { base, month, day, year };
        }
        return null;
    }

    // Instance view of the static detector — merge rungs and downstream
    // callers hold a SharedCore instance.
    detectTitleDateSegment(title) {
        return SharedCore.detectTitleDateSegment(title);
    }

    // A value shaped like a street address is NEVER a venue name. Anchored on
    // a leading house number (incl. hyphenated Queens style "10-90") with a
    // street-type word appearing somewhere after it. The leading-number anchor
    // is what keeps real venue names out: "9th Avenue Saloon" (ordinal, not a
    // house number), "3 Dollar Bill" (number but no street word), "Rockbar" /
    // "Eagle NYC" / "The Rail" (no leading number) all classify as NOT
    // address-shaped.
    looksLikeStreetAddress(value) {
        if (typeof value !== 'string') return false;
        const text = value.trim();
        // Leading house number: digits (optionally hyphenated) followed by
        // whitespace — "9th" never anchors because the digits run straight
        // into the ordinal suffix instead of a space.
        const houseNumber = text.match(/^\d{1,6}(?:-\d{1,6})?\s+/);
        if (!houseNumber) return false;
        // A street-type word after the house number ("Wyckoff Ave", "MT NEBO
        // RD"): whole word, optional trailing period, case-insensitive.
        const afterNumber = text.slice(houseNumber[0].length);
        return /(?:^|[\s,])(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Pl|Place|Ct|Court|Pkwy|Hwy)\.?(?:$|[\s,])/i.test(afterNumber);
    }

    // Lowercased, punctuation-free address tokens with street abbreviations
    // and directionals expanded (see ADDRESS_ABBREVIATION_EXPANSIONS), so
    // every spelling of the same address compares equal token-for-token.
    normalizeAddressTokens(text) {
        const expanded = String(text || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .map(token => Object.prototype.hasOwnProperty.call(ADDRESS_ABBREVIATION_EXPANSIONS, token)
                ? ADDRESS_ABBREVIATION_EXPANSIONS[token]
                : token);
        // Compound directionals: "N. E." / "North East" → "northeast", so
        // every compound spelling matches the fused "NE"/"Northeast" forms.
        const fused = [];
        for (const token of expanded) {
            const previous = fused[fused.length - 1];
            if ((previous === 'north' || previous === 'south') && (token === 'east' || token === 'west')) {
                fused[fused.length - 1] = previous + token;
            } else {
                fused.push(token);
            }
        }
        return fused;
    }

    // Parse an address candidate for the same-address merge rung. Returns
    // null unless the value leads with a house number (incl. hyphenated
    // Queens style) — a candidate without one is never comparable here.
    parseAddressForComparison(value) {
        if (typeof value !== 'string') return null;
        const text = value.trim();
        const numberMatch = text.match(/^(\d{1,6}(?:-\d{1,6})?)\s+\S/);
        if (!numberMatch) return null;
        const rest = text.slice(numberMatch[1].length);
        const tokens = this.normalizeAddressTokens(rest);
        if (tokens.length === 0) return null;
        return {
            streetNumber: numberMatch[1].toLowerCase(),
            tokens,
            // First comma-separated segment: the street line proper (comma-less
            // formats fold the city in here; the full-token prefix rule covers
            // those).
            streetLineTokens: this.normalizeAddressTokens(rest.split(',')[0]),
            zips: tokens.filter(token => /^\d{5}$/.test(token))
        };
    }

    // Same-address detection for two parseAddressForComparison results.
    // Conservative on purpose: equal street numbers AND (one full token
    // sequence a prefix of the other — the longer just adds city/state/zip —
    // OR equal street lines, tolerating only a trailing generic street-type
    // designator). Anything else — differing numbers, differing streets,
    // differing explicit ZIPs — is NOT the same address (no fuzzy scoring),
    // and the conflict falls through to AI arbitration.
    isSameStreetAddress(parsedA, parsedB) {
        if (!parsedA || !parsedB) return false;
        if (parsedA.streetNumber !== parsedB.streetNumber) return false;
        // A candidate with repeated tokens is malformed, not more complete —
        // the Eventbrite doubled-address bug ("3911 Cedar Springs Rd, Dallas,
        // TX 75219, Dallas, TX") would otherwise OUTSCORE the clean form on
        // components. Repetition is malformation, not information: those
        // conflicts keep arbitrating (the AI reliably picks the clean form).
        const hasDuplicateTokens = parsed => new Set(parsed.tokens).size !== parsed.tokens.length;
        if (hasDuplicateTokens(parsedA) || hasDuplicateTokens(parsedB)) return false;
        if (parsedA.zips.length > 0 && parsedB.zips.length > 0
            && !parsedA.zips.some(zip => parsedB.zips.includes(zip))) return false;
        const isPrefix = (shorter, longer) => shorter.length <= longer.length
            && shorter.every((token, index) => token === longer[index]);
        if (isPrefix(parsedA.tokens, parsedB.tokens) || isPrefix(parsedB.tokens, parsedA.tokens)) return true;
        const lineA = parsedA.streetLineTokens;
        const lineB = parsedB.streetLineTokens;
        if (lineA.length === 0 || lineB.length === 0) return false;
        const [shorterLine, longerLine] = lineA.length <= lineB.length ? [lineA, lineB] : [lineB, lineA];
        if (!isPrefix(shorterLine, longerLine)) return false;
        return longerLine.slice(shorterLine.length).every(token => ADDRESS_STREET_TYPE_TOKENS.includes(token));
    }

    // Completeness score for the same-address winner: comma-separated
    // components beyond the street line (city, state, zip each usually get
    // their own segment) plus an explicit ZIP bonus. Comma-formatted
    // candidates deliberately outscore comma-less twins carrying the same
    // components — the calendar's canonical address format is comma-separated.
    scoreAddressCompleteness(value, parsed) {
        const segments = String(value).split(',').map(segment => segment.trim()).filter(Boolean);
        return Math.max(0, segments.length - 1) + (parsed.zips.length > 0 ? 1 : 0);
    }

    // True when a comma-separated address tail names the event's resolved
    // city: the raw key itself (dashes/underscores as spaces) or any
    // configured name/pattern/alias via isCityOnlyTitle. Pure string logic;
    // an unknown city fails open (false).
    addressTailNamesCity(tail, cityKey) {
        const text = String(tail || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const key = String(cityKey || '').trim().toLowerCase();
        if (!text || !key) return false;
        if (text === key || text === key.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()) return true;
        return this.isCityOnlyTitle(tail, cityKey);
    }

    // City-suffix twin detection for the deterministic address ladder: when
    // exactly one candidate equals the other plus a trailing ", <city>"
    // segment naming the event's own city, the UNSUFFIXED candidate wins —
    // a resolution-derived city appended to an address is query decoration,
    // never data (see #1525; the persisted address must stay unmutated).
    // Returns { winner, reason } or null (fail open: no city context, no
    // suffix relationship, or both/neither side suffixed).
    resolveCitySuffixedAddressTwin(valueA, valueB, context) {
        const cityKey = context && context.cityKey ? String(context.cityKey) : '';
        if (!cityKey) return null;
        const collapse = value => String(value === null || value === undefined ? '' : value)
            .replace(/\s+/g, ' ').trim().toLowerCase();
        const stripCitySuffix = (value) => {
            const parts = String(value === null || value === undefined ? '' : value)
                .split(',').map(part => part.trim()).filter(Boolean);
            if (parts.length < 2) return null;
            if (!this.addressTailNamesCity(parts[parts.length - 1], cityKey)) return null;
            return parts.slice(0, -1).join(', ');
        };
        const collapsedA = collapse(valueA);
        const collapsedB = collapse(valueB);
        if (!collapsedA || !collapsedB || collapsedA === collapsedB) return null;
        const reason = 'city-suffixed twin — a resolution-appended city is query decoration, kept the unsuffixed address';
        const strippedA = stripCitySuffix(valueA);
        if (strippedA !== null && collapse(strippedA) === collapsedB) {
            return { winner: 'b', reason };
        }
        const strippedB = stripCitySuffix(valueB);
        if (strippedB !== null && collapse(strippedB) === collapsedA) {
            return { winner: 'a', reason };
        }
        return null;
    }

    // Curated bars for a merge-context city — shared by the curated-bar-name
    // rule and the curated-address rung in resolveConflictDeterministically.
    // Returns a non-empty array or null (missing city/bars data fails open).
    getCuratedCityBars(cityKey) {
        const key = cityKey ? String(cityKey) : '';
        if (!key || !this.bars) return null;
        const cityBars = this.bars[key] || this.bars[key.trim().toLowerCase()];
        return Array.isArray(cityBars) && cityBars.length > 0 ? cityBars : null;
    }

    // Same normalization BarDataNormalizer matches with (lowercase, strip
    // non-alphanumerics) so curated matching agrees everywhere, plus a leading
    // "the " is dropped on BOTH sides ("The Eagle" is the curated "Eagle" and
    // vice versa). Full-name equality only — never substring — so "Eagle"
    // can't claim "Eagle Bar" vs "Dallas Eagle" ambiguously within a city.
    findCuratedBarByName(cityBars, value) {
        const normalized = this.normalizeBarNameKey(value);
        if (!normalized) return null;
        return cityBars.find(bar => bar && typeof bar.name === 'string'
            && this.normalizeBarNameKey(bar.name) === normalized) || null;
    }

    // Cross-city curated-bar lookup for city backfill: when an event's city is
    // unknown we don't know WHICH city's bars to search, so scan every city's
    // curated bars for a full-name match (normalizeBarNameKey equality — the
    // exact same strictness as findCuratedBarByName above; never substring).
    // Fail closed everywhere:
    //   { city, bar }              — exactly one city curates this bar name
    //   { ambiguousCities: [...] } — the name is curated in MORE than one city
    //   { genericStem: true, containedIn: [...] } — the name is a generic
    //     franchise stem (run 20260725-170926: the extracted bar "Eagle"
    //     uniquely matched fort-lauderdale's curated "Eagle" and backfilled
    //     that city onto Dallas Eagle events). Uniqueness is NOT identity when
    //     the matched name key is a contained substring of ANOTHER curated
    //     bar's name key anywhere in the data ("eagle" ⊂ "dallaseagle") — the
    //     name is a family stem that exists in cities we merely don't curate
    //     yet. Data-driven: no hardcoded word list, the curated corpus itself
    //     decides. One-way only — a LONGER unique name ("Dallas Eagle") that
    //     happens to contain someone else's stem still matches exactly.
    //   null                       — no match anywhere, or bars data missing
    findCuratedBarCityByName(barName) {
        const normalized = this.normalizeBarNameKey(barName);
        if (!normalized || !this.bars || typeof this.bars !== 'object') return null;
        const matches = [];
        for (const cityKey of Object.keys(this.bars)) {
            const cityBars = this.bars[cityKey];
            if (!Array.isArray(cityBars) || cityBars.length === 0) continue;
            const curatedBar = this.findCuratedBarByName(cityBars, barName);
            if (curatedBar) matches.push({ city: cityKey, bar: curatedBar });
        }
        if (matches.length === 0) return null;
        const cities = [...new Set(matches.map(match => match.city))];
        if (cities.length > 1) return { ambiguousCities: cities };
        const containedIn = [];
        for (const cityKey of Object.keys(this.bars)) {
            const cityBars = this.bars[cityKey];
            if (!Array.isArray(cityBars)) continue;
            for (const bar of cityBars) {
                if (!bar || typeof bar.name !== 'string') continue;
                const otherKey = this.normalizeBarNameKey(bar.name);
                if (otherKey && otherKey !== normalized && otherKey.includes(normalized)
                    && !containedIn.includes(bar.name)) {
                    containedIn.push(bar.name);
                }
            }
        }
        if (containedIn.length > 0) return { genericStem: true, containedIn };
        return matches[0];
    }

    // The bar-name identity key shared by curated matching (above) and the
    // new-venue-candidate dedup key: lowercase, drop a leading "the ", strip
    // non-alphanumerics — so "The Eagle" / "EAGLE!" collapse to one venue.
    normalizeBarNameKey(name) {
        return String(name || '')
            .toLowerCase()
            .replace(/^\s*the\s+/, '')
            .replace(/[^a-z0-9]/g, '');
    }

    // ------------------------------------------------------------------
    // Curated promoter registry (data/promoters.json, injected as
    // this.promoters like bars): match events to curated promoter identities
    // from the event's OWN fields only, fail closed on any ambiguity.
    // Mode knob: config.promoterRegistry.mode (top-level, like
    // geocodeVerification) — 'report' (default) logs would-stamp decisions,
    // 'enforce' stamps _promoter + curated metadata, 'off' skips the pass.
    // ------------------------------------------------------------------

    // Promoter-name identity key — the exact normalization curated bar
    // matching uses (lowercase, drop a leading "the ", strip
    // non-alphanumerics) so promoter identity agrees with the rest of the
    // curated machinery.
    normalizePromoterNameKey(name) {
        return this.normalizeBarNameKey(name);
    }

    // Mirrors getBearCheckMode: unset/invalid → 'report'. Reads the top-level
    // global config block (config.promoterRegistry), accepting either the
    // full scraper config ({ config: {...} }) or the inner block itself.
    getPromoterRegistryMode(mainConfig) {
        const globalConfig = mainConfig && mainConfig.config && typeof mainConfig.config === 'object'
            ? mainConfig.config
            : (mainConfig && typeof mainConfig === 'object' ? mainConfig : {});
        const registry = globalConfig && globalConfig.promoterRegistry && typeof globalConfig.promoterRegistry === 'object'
            ? globalConfig.promoterRegistry
            : null;
        const mode = registry ? String(registry.mode || '').trim().toLowerCase() : '';
        return mode === 'enforce' || mode === 'off' ? mode : 'report';
    }

    // Padded-token title text for promoter matching — mirrors the ai-web
    // parser's titleContainsPageBrandName normalization (word containment,
    // never bare substring): "BEARRACUDA-Atlanta!" → " bearracuda atlanta ".
    buildPaddedPromoterTitleText(title) {
        const normalized = String(title || '')
            .toLowerCase()
            .replace(/[^a-z0-9&\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return normalized ? ` ${normalized} ` : '';
    }

    // Word-token phrase of a promoter name/keyword for padded-token
    // containment ("Coach After Dark" → "coach after dark").
    buildPromoterTokenPhrase(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9&\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Brand-variant identity keys of a scraped organizer value: the plain
    // compact key plus a copy without a trailing corporate suffix, so
    // "Bearracuda, Inc." matches the curated "Bearracuda" (mirrors the ai-web
    // parser's getBrandNameVariants).
    getPromoterOrganizerKeys(organizer) {
        const stripped = this.buildPromoterTokenPhrase(organizer);
        if (!stripped) return [];
        const keys = new Set();
        keys.add(this.normalizePromoterNameKey(stripped));
        const withoutSuffix = stripped.replace(/\s+(inc|incorporated|llc|ltd|co|corp|corporation|company)$/, '').trim();
        if (withoutSuffix) keys.add(this.normalizePromoterNameKey(withoutSuffix));
        return [...keys].filter(Boolean);
    }

    // URL-evidence token from an entry's own website/instagram value: scheme,
    // leading "www." and trailing slashes stripped, host+path kept — so a
    // linktree website contributes "linktr.ee/megawoof_america" (self-naming),
    // never the bare platform host.
    getPromoterWebsiteToken(website) {
        const raw = String(website || '').trim().toLowerCase();
        if (!raw) return '';
        return raw
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .replace(/\/+$/, '');
    }

    getPromoterInstagramToken(instagram) {
        const token = this.getPromoterWebsiteToken(instagram);
        return token.includes('instagram.com/') ? token : '';
    }

    // Registry entry lookup by curated name (identity-key equality).
    getPromoterEntryByName(name) {
        const key = this.normalizePromoterNameKey(name);
        if (!key || !Array.isArray(this.promoters)) return null;
        return this.promoters.find(entry => entry && this.normalizePromoterNameKey(entry.name) === key) || null;
    }

    // The registry entry an enforce-mode match stamped onto the event
    // (event._promoter), or null. Report mode stamps nothing, so registry
    // bearAffinity can only ever act in enforce mode.
    getEventPromoterEntry(event) {
        const name = event && typeof event._promoter === 'string' ? event._promoter.trim() : '';
        return name ? this.getPromoterEntryByName(name) : null;
    }

    // Per-run match index over this.promoters (rebuilt when the registry
    // array is replaced, e.g. by the remote refresh). Precomputes:
    //   - nameKeys: identity keys of name + aliases (organizer equality)
    //   - titlePhrases: padded-token phrases for title containment, minus any
    //     key the data-driven generic-stem guard refuses (a name key contained
    //     in ANOTHER entry's key is a family stem — title containment is
    //     refused for it; organizer-equality/urlPattern evidence still works)
    //   - keywordPhrases: sub-brand keywords (title containment only)
    //   - urlTokens: urlPatterns + tokens derived from the entry's own
    //     instagram handle and website host/path
    getPromoterRegistryIndex() {
        if (this._promoterRegistryIndex && this._promoterRegistryIndex.source === this.promoters) {
            return this._promoterRegistryIndex;
        }
        const list = Array.isArray(this.promoters) ? this.promoters : [];
        const keysByEntry = list.map(entry => {
            const names = [entry && entry.name, ...(entry && Array.isArray(entry.aliases) ? entry.aliases : [])];
            return names.map(name => this.normalizePromoterNameKey(name)).filter(Boolean);
        });
        const entries = [];
        list.forEach((entry, index) => {
            if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) return;
            const names = [entry.name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])];
            const titlePhrases = [];
            for (const name of names) {
                const phrase = this.buildPromoterTokenPhrase(name);
                const key = this.normalizePromoterNameKey(name);
                if (!phrase || key.length < 4) continue;
                const isGenericStem = list.some((other, otherIndex) => otherIndex !== index
                    && keysByEntry[otherIndex].some(otherKey => otherKey !== key && otherKey.includes(key)));
                if (isGenericStem) continue;
                titlePhrases.push(phrase);
            }
            const keywordPhrases = (Array.isArray(entry.keywords) ? entry.keywords : [])
                .map(keyword => this.buildPromoterTokenPhrase(keyword))
                .filter(Boolean);
            const urlTokens = [];
            for (const pattern of Array.isArray(entry.urlPatterns) ? entry.urlPatterns : []) {
                const token = String(pattern || '').trim().toLowerCase();
                if (token && !urlTokens.includes(token)) urlTokens.push(token);
            }
            const instagramToken = this.getPromoterInstagramToken(entry.instagram);
            if (instagramToken && !urlTokens.includes(instagramToken)) urlTokens.push(instagramToken);
            const websiteToken = this.getPromoterWebsiteToken(entry.website);
            if (websiteToken && !urlTokens.includes(websiteToken)) urlTokens.push(websiteToken);
            entries.push({ entry, nameKeys: keysByEntry[index], titlePhrases, keywordPhrases, urlTokens });
        });
        this._promoterRegistryIndex = { source: this.promoters, entries };
        return this._promoterRegistryIndex;
    }

    // One entry's evidence against one event (event's OWN fields only —
    // description is never evidence): organizer brand-variant equality, then
    // padded-token title containment of a full name/alias (or sub-brand
    // keyword), then URL substring evidence. Returns
    // { evidence: 'organizer'|'title'|'url:<token>' } or null.
    evaluatePromoterEntryMatch(event, indexed) {
        const organizerKeys = this.getPromoterOrganizerKeys(event && event._organizer);
        if (organizerKeys.some(key => indexed.nameKeys.includes(key))) {
            return { evidence: 'organizer' };
        }
        const paddedTitle = this.buildPaddedPromoterTitleText(event && event.title);
        if (paddedTitle) {
            for (const phrase of indexed.titlePhrases) {
                if (paddedTitle.includes(` ${phrase} `)) return { evidence: 'title' };
            }
            for (const phrase of indexed.keywordPhrases) {
                if (paddedTitle.includes(` ${phrase} `)) return { evidence: 'title' };
            }
        }
        // De-circularization (battery run 20260728, Club Chub): parser static
        // metadata stamps url-ish fields (instagram/website/url/facebook) onto
        // EVERY event the parser emits — matching a registry entry on a value
        // the pipeline itself stamped is circular, not evidence. Statically
        // stamped fields (tracked in _staticFields by applyStaticMetadataBlock)
        // are excluded; only organically-extracted URLs count. ticketUrl and
        // _sourcePageUrl always come from the page, never from static
        // metadata, so they remain valid evidence. url/website are ONE field
        // (aliases), so a stamp under either key covers both.
        const staticFields = event && event._staticFields && typeof event._staticFields === 'object'
            ? event._staticFields
            : {};
        const isStaticStamped = (...keys) => keys.some(key => Object.prototype.hasOwnProperty.call(staticFields, key));
        const urlValues = [
            isStaticStamped('url', 'website') ? '' : (event && event.url),
            event && event.ticketUrl,
            isStaticStamped('website', 'url') ? '' : (event && event.website),
            isStaticStamped('instagram') ? '' : (event && event.instagram),
            isStaticStamped('facebook') ? '' : (event && event.facebook),
            event && event._sourcePageUrl
        ];
        for (const value of urlValues) {
            const lowered = typeof value === 'string' ? value.toLowerCase() : '';
            if (!lowered) continue;
            for (const token of indexed.urlTokens) {
                if (lowered.includes(token)) return { evidence: `url:${token}` };
            }
        }
        return null;
    }

    // Match one event to at most one curated promoter. Fail closed:
    //   { entry, evidence }        — exactly one promoter identity matched
    //                                (parent+child both matching → child wins)
    //   { ambiguous: [names] }     — two unrelated entries matched
    //   null                       — no evidence anywhere
    matchEventToPromoter(event) {
        const index = this.getPromoterRegistryIndex();
        if (!index.entries.length) return null;
        const matches = [];
        for (const indexed of index.entries) {
            const hit = this.evaluatePromoterEntryMatch(event, indexed);
            if (hit) matches.push({ entry: indexed.entry, evidence: hit.evidence });
        }
        if (matches.length === 0) return null;
        if (matches.length === 1) return matches[0];
        // Parent+child both matched → the more specific sub-brand wins.
        const matchedNames = new Set(matches.map(match => match.entry.name));
        const withoutMatchedParents = matches.filter(match =>
            !matches.some(other => other.entry !== match.entry
                && typeof other.entry.parent === 'string'
                && other.entry.parent === match.entry.name
                && matchedNames.has(other.entry.name)));
        if (withoutMatchedParents.length === 1) return withoutMatchedParents[0];
        return { ambiguous: withoutMatchedParents.map(match => match.entry.name) };
    }

    // Registry entry → static-metadata block in the exact {field: {value}}
    // shape parser metadata uses, so curated facts flow through the SAME
    // application machinery (applyStaticMetadataBlock). Sub-brands inherit
    // unspecified fields from their parent entry; website maps to the
    // canonical url field (url and website are ONE field).
    promoterEntryToMetadataBlock(entry) {
        if (!entry || typeof entry !== 'object') return {};
        const parent = typeof entry.parent === 'string' && entry.parent
            ? this.getPromoterEntryByName(entry.parent)
            : null;
        const pick = (field) => {
            const own = typeof entry[field] === 'string' && entry[field].trim() ? entry[field] : '';
            if (own) return own;
            const inherited = parent && typeof parent[field] === 'string' && parent[field].trim() ? parent[field] : '';
            return inherited;
        };
        const block = {};
        for (const field of ['shortName', 'shorterName', 'instagram', 'facebook', 'favicon', 'matchKey']) {
            const value = pick(field);
            if (value) block[field] = { value };
        }
        const website = pick('website');
        if (website) block.url = { value: website };
        return block;
    }

    // Enforce-mode stamp: curated promoter facts through the same
    // static-metadata machinery as parser metadata (registry runs after the
    // parser-time application, so its static clobber wins on match; parser
    // metadata remains the no-match fallback).
    applyPromoterMetadata(event, metadataBlock) {
        const fieldPriorities = this.getResolvedFieldPriorities({ metadata: metadataBlock });
        if (!event._fieldPriorities) {
            event._fieldPriorities = {};
        }
        Object.keys(metadataBlock).forEach(key => {
            event._fieldPriorities[key] = fieldPriorities[key];
        });
        const stamped = this.applyStaticMetadataBlock(event, metadataBlock, fieldPriorities);
        // Favicon GUARANTEE, deliberately outside the static machinery. An
        // explicit registry `favicon:` above stamps with static clobber like
        // any curated fact — but the fallback ("no explicit favicon, use the
        // promoter's identity link so the event isn't iconless") must only
        // ever FILL A BLANK. Review 2026-07-30 showed the clobber version
        // replacing a venue's favicon on every registry-matched event and
        // silently reverting hand-fixed calendar favicons on every run —
        // curated beats derived, and a fallback is not curated. Stamped as a
        // plain value with 'upsert' merge (calendar wins), so a stored or
        // scraped favicon always survives it.
        if (!metadataBlock.favicon
            && this.isEmptyArbitrationValue(event.favicon)
            && metadataBlock.url && metadataBlock.url.value) {
            event.favicon = metadataBlock.url.value;
            event._fieldPriorities.favicon = { priority: ['ai-web'], merge: 'upsert' };
        }
        return stamped;
    }

    // One registry pass over a parser's events (processParser: after
    // filterFutureEvents, before filterBearEvents). Report mode logs
    // would-stamp decisions and changes NOTHING; enforce stamps _promoter,
    // curated metadata, and (when the organizer was empty and the match came
    // from title/url evidence) _organizer.
    applyPromoterRegistryMatches(events, parserConfig, mainConfig) {
        const mode = this.getPromoterRegistryMode(mainConfig);
        if (mode === 'off') return;
        if (!Array.isArray(this.promoters) || this.promoters.length === 0) return;
        if (!Array.isArray(events) || events.length === 0) return;
        const tag = mode === 'report' ? '[report]' : '';
        const counts = { matched: 0, organizer: 0, title: 0, url: 0 };
        for (const event of events) {
            const match = this.matchEventToPromoter(event);
            if (!match) continue;
            const title = event.title || 'Unknown';
            if (match.ambiguous) {
                console.log(`🪪 PROMOTER REGISTRY${tag}: "${title}" -> no match (ambiguous: ${match.ambiguous.join(', ')})`);
                continue;
            }
            counts.matched++;
            if (match.evidence === 'organizer') counts.organizer++;
            else if (match.evidence === 'title') counts.title++;
            else counts.url++;
            const metadataBlock = this.promoterEntryToMetadataBlock(match.entry);
            const stampKeys = Object.keys(metadataBlock);
            if (mode === 'enforce') {
                event._promoter = match.entry.name;
                if (!event._organizer && match.evidence !== 'organizer') {
                    event._organizer = match.entry.name;
                }
                if (stampKeys.length > 0) {
                    this.applyPromoterMetadata(event, metadataBlock);
                }
            }
            const stampLabel = mode === 'enforce' ? 'stamped' : 'would-stamp';
            console.log(`🪪 PROMOTER REGISTRY${tag}: "${title}" -> ${match.entry.name} (evidence: ${match.evidence}) ${stampLabel}: ${stampKeys.join(', ') || '(none)'}`);
        }
        if (counts.matched > 0 || mode === 'report') {
            console.log(`🪪 PROMOTER REGISTRY${tag}: ${counts.matched} of ${events.length} event(s) matched (${counts.organizer} organizer, ${counts.title} title, ${counts.url} url)`);
        }
    }

    // City-center coordinates from the cities config as a "lat, lng" pair
    // string (same source OpenStreetMapNormalizer.getCityCenterCoordinates
    // reads — cityConfig.coordinates from js/city-config.js via
    // tools/generate-scraper-cities.js). Null when the city is unknown or has
    // no coordinates — pure config lookup, never a network call.
    getCityCenterCoordinatePair(cityKey) {
        const key = cityKey ? String(cityKey).trim() : '';
        if (!key || !this.cities || typeof this.cities !== 'object') return null;
        const cityConfig = this.cities[key] || this.cities[key.toLowerCase()] || this.cities[this.foldDiacritics(key)];
        const coords = cityConfig && cityConfig.coordinates;
        if (!coords) return null;
        const lat = Number(coords.lat);
        const lng = Number(coords.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return `${lat}, ${lng}`;
    }

    // The pin evidence one merge side contributes to the address evidence rung:
    // { location: "lat, lng", verified } or null when the record carries no pin
    // ATTRIBUTABLE to that address candidate. Attribution is strict — the pin
    // must have been produced FROM this address by the pipeline:
    //   - pinSource geocoded-exact / geocoded-approx: OpenStreetMapNormalizer
    //     forward-geocoded record.address (BarDataNormalizer runs BEFORE
    //     geocoding, so the geocoded address IS the record's final address);
    //     exact = accepted exact-grade pin (verified), approx = street/census
    //     grade or failed cross-check (usable for distance checks only).
    //   - pinSource curated WITH addressSource curated: pin and address both
    //     came from the same curated bar entry (verified). A curated pin next
    //     to a non-curated address was not derived from that address.
    // Everything else — page pins, absent provenance, or a record whose own
    // address is not this candidate value — is uncertain attribution and
    // counts as NO PIN (fail open). Calendar records satisfy the same shape:
    // their stored pin/address/pinSource were finalized together by a previous
    // run's merge (setProvenanceSource keeps them coherent).
    getAddressPinEvidence(record, addressValue) {
        if (!record || typeof record !== 'object') return null;
        const location = typeof record.location === 'string' ? record.location.trim() : '';
        if (!this.isCoordinatePair(location)) return null;
        const recordAddress = typeof record.address === 'string' ? record.address.trim() : '';
        const candidate = typeof addressValue === 'string' ? addressValue.trim() : '';
        if (!recordAddress || !candidate || recordAddress !== candidate) return null;
        const pinSource = typeof record.pinSource === 'string' ? record.pinSource.trim() : '';
        if (pinSource === 'geocoded-exact') return { location, verified: true };
        if (pinSource === 'geocoded-approx') return { location, verified: false };
        if (pinSource === 'curated') {
            const addressSource = typeof record.addressSource === 'string' ? record.addressSource.trim() : '';
            return addressSource === 'curated' ? { location, verified: true } : null;
        }
        return null;
    }

    // Evidence rung for GENUINELY DIFFERENT address candidates (the cases the
    // same-address and curated-address rungs could not settle). Uses ONLY
    // evidence the pipeline already computed — verified pins on the two merge
    // records, the city center from the cities config, curated bar
    // coordinates — never a network call. Steps, in order:
    //   1. exactly one candidate has a VERIFIED pin derived from its address
    //      (the other side is unpinned: geocode refused / found nothing) → it
    //      wins;
    //   2. both pinned and the city center is known: exactly one pin within a
    //      sane radius (≤ 30 km) while the other is absurd (> 50 km) → the
    //      sane one wins (the 30–50 km band is ambiguous on purpose);
    //   3. the event's bar matches a curated bar with coordinates and exactly
    //      one candidate's pin is within 150 m of the curated pin → it wins.
    // Any ambiguity — no attributable pins, no city center, both distances
    // sane/absurd, both pins near the curated bar — FAILS OPEN (null → AI
    // arbitration exactly as before).
    resolveAddressMismatchByEvidence(valueA, valueB, context) {
        if (!context || !context.records || typeof context.records !== 'object') return null;
        const labels = context.sideLabels && typeof context.sideLabels === 'object'
            ? context.sideLabels
            : { a: 'a', b: 'b' };
        const evidenceA = this.getAddressPinEvidence(context.records.a, valueA);
        const evidenceB = this.getAddressPinEvidence(context.records.b, valueB);

        // Step 1: exactly one side carries a pin at all, and it is verified.
        if (evidenceA && !evidenceB && evidenceA.verified) {
            return { winner: 'a', reason: `only "${labels.a}" has a verified pin` };
        }
        if (evidenceB && !evidenceA && evidenceB.verified) {
            return { winner: 'b', reason: `only "${labels.b}" has a verified pin` };
        }

        // Step 2: both pinned + known city center — sane beats absurd.
        if (evidenceA && evidenceB) {
            const center = this.getCityCenterCoordinatePair(context.cityKey);
            if (center) {
                const distanceA = this.coordinatePairDistanceKm(evidenceA.location, center);
                const distanceB = this.coordinatePairDistanceKm(evidenceB.location, center);
                if (distanceA !== null && distanceB !== null) {
                    const saneBeatsAbsurd = (sane, absurd) => sane <= 30 && absurd > 50;
                    if (saneBeatsAbsurd(distanceA, distanceB)) {
                        return { winner: 'a', reason: `only "${labels.a}" pin is near the city center (${Math.round(distanceA)} km vs ${Math.round(distanceB)} km)` };
                    }
                    if (saneBeatsAbsurd(distanceB, distanceA)) {
                        return { winner: 'b', reason: `only "${labels.b}" pin is near the city center (${Math.round(distanceB)} km vs ${Math.round(distanceA)} km)` };
                    }
                }
            }
        }

        // Step 3: curated bar proximity. Same bar selection as the
        // curated-address rung (first barNames match wins), then the curated
        // coordinates must exist and exactly one pin must sit within 150 m.
        const cityBars = this.getCuratedCityBars(context.cityKey);
        const barNames = Array.isArray(context.barNames) ? context.barNames : [];
        let curatedBar = null;
        if (cityBars) {
            for (const barName of barNames) {
                curatedBar = this.findCuratedBarByName(cityBars, barName);
                if (curatedBar) break;
            }
        }
        if (curatedBar && this.isCoordinatePair(curatedBar.coordinates)) {
            const isNearCuratedPin = evidence => {
                if (!evidence) return false;
                const km = this.coordinatePairDistanceKm(evidence.location, curatedBar.coordinates);
                return km !== null && km <= 0.15;
            };
            const nearA = isNearCuratedPin(evidenceA);
            const nearB = isNearCuratedPin(evidenceB);
            if (nearA !== nearB) {
                return { winner: nearA ? 'a' : 'b', reason: `pin matches curated bar "${curatedBar.name}"` };
            }
        }
        return null;
    }

    // Deterministic conflict resolution consulted by BOTH merge paths
    // (createFinalEventObject and mergeParsedEvents) before a field is queued
    // for AI arbitration. Returns { winner: 'a'|'b', reason } or null (→
    // arbitrate as usual). Callers map a/b onto their own labels and thread
    // event context (currently { cityKey, barNames, eventTitle, sideLabels,
    // records }) for the city-aware title, curated-bar, curated-address, and
    // address-evidence rules.
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
            // Cross-host website/url rungs. Rung 1: a bare homepage never
            // beats an event-specific page even ACROSS hosts — the deeper URL
            // is the one that describes THIS event. Rung 2: both pathed —
            // prefer the candidate that is a page this run actually crawled:
            // its host matches its own record's _sourcePageUrl (stamped at
            // fetch time) AND that record's own website/url field IS the
            // candidate value (strict attribution, like the image/bar
            // provenance rungs). Both bare roots, both/neither crawled, or no
            // records context → fall through to AI arbitration (fail open).
            // Rung 0: a TICKETING/social platform URL never displaces a
            // non-platform one for the identity fields. Which platform sells
            // the tickets is not who throws the party, and this field feeds
            // the event's icon — so losing the promoter's own link visibly
            // breaks the card and the map marker. The reverse (a real site
            // replacing a platform link) is allowed, and platform-vs-platform
            // falls through to the rungs below.
            if (fieldName === 'website' || fieldName === 'url') {
                const platformA = isPlatformIdentityHost(urlA.host);
                const platformB = isPlatformIdentityHost(urlB.host);
                // Deliberately narrow: the non-platform side must itself be a
                // real page, not a bare homepage. A bare root still loses to a
                // deep event page (the older cross-host rung below owns that
                // case, and reversing it would send people to a front door
                // instead of the event).
                const nonPlatformIsPathed = platformB
                    ? (urlA.segments.length > 0 || urlA.hasQuery)
                    : (urlB.segments.length > 0 || urlB.hasQuery);
                if (platformA !== platformB && nonPlatformIsPathed) {
                    return platformB
                        ? { winner: 'a', reason: 'identity link beats a ticketing/social platform URL' }
                        : { winner: 'b', reason: 'identity link beats a ticketing/social platform URL' };
                }
            }
            if ((fieldName === 'website' || fieldName === 'url') && urlA.host !== urlB.host) {
                const bareRootA = urlA.segments.length === 0 && !urlA.hasQuery;
                const bareRootB = urlB.segments.length === 0 && !urlB.hasQuery;
                if (bareRootA && !bareRootB && urlB.segments.length > 0) {
                    return { winner: 'b', reason: 'event-specific URL beats bare homepage' };
                }
                if (bareRootB && !bareRootA && urlA.segments.length > 0) {
                    return { winner: 'a', reason: 'event-specific URL beats bare homepage' };
                }
                if (urlA.segments.length > 0 && urlB.segments.length > 0) {
                    const urlContextRecords = context && context.records && typeof context.records === 'object'
                        ? context.records : null;
                    if (urlContextRecords) {
                        const isOwnCrawledPage = (record, parts, value) => {
                            if (!record || typeof record !== 'object') return false;
                            const candidate = typeof value === 'string' ? value.trim() : '';
                            if (!candidate) return false;
                            const ownWebsite = typeof record.website === 'string' ? record.website.trim() : '';
                            const ownUrl = typeof record.url === 'string' ? record.url.trim() : '';
                            if (ownWebsite !== candidate && ownUrl !== candidate) return false;
                            const sourceHost = this.getHostFromUrl(record._sourcePageUrl)
                                .toLowerCase().replace(/^www\./, '');
                            return Boolean(sourceHost) && parts.host === sourceHost;
                        };
                        const crawledA = isOwnCrawledPage(urlContextRecords.a, urlA, valueA);
                        const crawledB = isOwnCrawledPage(urlContextRecords.b, urlB, valueB);
                        if (crawledA !== crawledB) {
                            return { winner: crawledA ? 'a' : 'b', reason: 'URL is a page this run actually crawled' };
                        }
                    }
                }
            }
            // Cross-host ticketUrl: a candidate on a known ticketing platform
            // (TICKETING_PLATFORM_HOSTS — a preference heuristic, not a gate)
            // beats a BARE domain root on a non-ticketing host: the root of an
            // organizer/venue site is never the ticket page. Conservative on
            // purpose: a non-ticketing candidate WITH a real path could itself
            // be the event page, and two ticketing candidates are a genuine
            // question — both still arbitrate (fail open).
            if (fieldName === 'ticketUrl' && urlA.host !== urlB.host) {
                const ticketingA = this.isKnownTicketingPlatformHost(urlA.host);
                const ticketingB = this.isKnownTicketingPlatformHost(urlB.host);
                if (ticketingA !== ticketingB) {
                    const isBareRoot = (parts) => parts.segments.length === 0 && !parts.hasQuery;
                    if (ticketingA && isBareRoot(urlB)) {
                        return { winner: 'a', reason: 'ticketing-platform URL beats bare non-ticketing domain root' };
                    }
                    if (ticketingB && isBareRoot(urlA)) {
                        return { winner: 'b', reason: 'ticketing-platform URL beats bare non-ticketing domain root' };
                    }
                }
            }
            // A logo-path image never beats a non-logo image: ticketing
            // services attach their own ".../saas/logos/..." asset, which the
            // model picked over the actual event poster. Matches path
            // components only (never hostname or query); both-or-neither
            // logo-ish still arbitrates (with a prompt rule as backstop).
            // Applies to the primary AND to the imageVertical/imageHorizontal
            // orientation slots (IMAGE_MERGE_FIELDS): they hold the same kind
            // of value — a bare image URL — so the logo-path, provenance and
            // resolution rules below are correct for them unchanged. Note the
            // provenance rung's strict attribution means a slot only picks up
            // an og-grade stamp when it EQUALS the record's own image (the
            // common "primary is portrait" case); a slot holding a different
            // URL is unattributable and falls through, which is the intended
            // conservative behavior — imageSource stays a companion of `image`
            // alone, with no per-slot provenance.
            if (IMAGE_MERGE_FIELDS.has(fieldName)) {
                const hasLogoSegment = (parts) => parts.segments.some(segment => /logo/i.test(segment));
                const logoA = hasLogoSegment(urlA);
                const logoB = hasLogoSegment(urlB);
                if (logoA !== logoB) {
                    return { winner: logoA ? 'b' : 'a', reason: 'event artwork beats logo-path image' };
                }
                // Provenance rung: an image that IS the event page's own
                // artwork — its og:image/twitter:image meta ('og-image') or
                // its published structured data ('jsonld'), as stamped at
                // extraction — beats a merely page-derived candidate (content/
                // OCR/segment images, 'page' or unstamped). The arbitration
                // model flip-flopped between runs on exactly this shape.
                // Attribution is strict like the address evidence rung: a
                // record's imageSource only vouches for the candidate when the
                // record's own image field IS that candidate value. Both
                // og-grade, neither, or unattributable → fall through to the
                // resolution-margin rung / AI (fail open).
                const contextRecords = context && context.records && typeof context.records === 'object'
                    ? context.records : null;
                if (contextRecords) {
                    const getOgGradeImageProvenance = (record, value) => {
                        if (!record || typeof record !== 'object') return '';
                        const recordImage = typeof record.image === 'string' ? record.image.trim() : '';
                        const candidate = typeof value === 'string' ? value.trim() : '';
                        if (!recordImage || !candidate || recordImage !== candidate) return '';
                        const imageSource = typeof record.imageSource === 'string' ? record.imageSource.trim() : '';
                        return (imageSource === 'og-image' || imageSource === 'jsonld') ? imageSource : '';
                    };
                    const provenanceA = getOgGradeImageProvenance(contextRecords.a, valueA);
                    const provenanceB = getOgGradeImageProvenance(contextRecords.b, valueB);
                    // For the ORIENTATION SLOTS, one-sided attribution must
                    // not decide. imageSource describes the PRIMARY image
                    // only, so a slot holding a URL different from its own
                    // record's primary is STRUCTURALLY unattributable — a
                    // curated calendar slot (portrait next to a landscape
                    // primary) can never present provenance, and letting the
                    // scraper's attributed side win by default clobbered
                    // curated slots deterministically with the AI never
                    // consulted (review 2026-07-30). The primary image keeps
                    // one-sided decisions: for `image`, no attribution
                    // genuinely means "not the page's own artwork".
                    const slotContest = fieldName !== 'image';
                    const bothSidesPresent = !this.isEmptyArbitrationValue(valueA) && !this.isEmptyArbitrationValue(valueB);
                    const oneSidedOnSlot = slotContest && bothSidesPresent
                        && (Boolean(provenanceA) !== Boolean(provenanceB));
                    if (!oneSidedOnSlot && Boolean(provenanceA) !== Boolean(provenanceB)) {
                        const provenanceLabels = context.sideLabels && typeof context.sideLabels === 'object'
                            ? context.sideLabels : { a: 'a', b: 'b' };
                        return {
                            winner: provenanceA ? 'a' : 'b',
                            reason: `"${provenanceA ? provenanceLabels.a : provenanceLabels.b}" image is the event page's own artwork (${provenanceA || provenanceB})`
                        };
                    }
                }
                // Resolution rung: when one URL advertises a clearly larger
                // image (same scoring the parser uses for OCR dedup —
                // getImageSizeScoreFromUrl), prefer it deterministically; the
                // arbitration model contradicted itself between runs on exactly
                // this shape (called a real og:image flyer "a generic
                // placeholder", then reversed). Requires a meaningful margin
                // (winner >= 2x loser or +500) so near-ties still arbitrate,
                // and the winner must score above the URL-length noise floor —
                // a score that could just be a long URL decides nothing.
                const scoreA = this.getImageSizeScoreFromUrl(String(valueA).trim());
                const scoreB = this.getImageSizeScoreFromUrl(String(valueB).trim());
                const winnerScore = Math.max(scoreA, scoreB);
                const loserScore = Math.min(scoreA, scoreB);
                if (winnerScore >= 500 && loserScore >= 0 && winnerScore > loserScore
                    && (winnerScore >= 2 * loserScore || winnerScore - loserScore >= 500)) {
                    return { winner: scoreA > scoreB ? 'a' : 'b', reason: 'clearly higher-resolution image URL' };
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
            // Trim persistence rung: when one side's title IS the AI-trimmed
            // form of the other — strict attribution: that side's own
            // _fieldTrims carries a status 'trimmed' title record whose
            // trimmedValue is exactly this candidate, and the other side is a
            // longer verbatim superset containing it — the trimmed side wins
            // deterministically. Without this, arbitration's more-descriptive
            // preference resurrects the untrimmed superset the field-trim
            // pass already shortened (observed 2026-07-28: club-chub "DURO"
            // merged back to 73 chars after a 73 → 55 enforce trim). MUST run
            // after the emoji-twin rule (twins keep the emoji doctrine). No
            // trim record, non-substring pairs, or both sides trimmed → fall
            // through (AI arbitrates as before).
            const trimContextRecords = context && context.records && typeof context.records === 'object'
                ? context.records : null;
            if (trimContextRecords) {
                const hasOwnTitleTrimRecord = (record, value) => {
                    if (!record || !Array.isArray(record._fieldTrims)) return false;
                    const candidate = typeof value === 'string' ? value.trim() : '';
                    if (!candidate) return false;
                    return record._fieldTrims.some(trim => trim && trim.field === 'title'
                        && trim.status === 'trimmed' && trim.trimmedValue === candidate);
                };
                const isUntrimmedSuperset = (supersetValue, trimmedValue) => {
                    const superset = typeof supersetValue === 'string' ? supersetValue.trim() : '';
                    const trimmed = typeof trimmedValue === 'string' ? trimmedValue.trim() : '';
                    return Boolean(superset && trimmed) && superset.length > trimmed.length
                        && superset.includes(trimmed);
                };
                const trimmedWinsA = hasOwnTitleTrimRecord(trimContextRecords.a, valueA)
                    && isUntrimmedSuperset(valueB, valueA);
                const trimmedWinsB = hasOwnTitleTrimRecord(trimContextRecords.b, valueB)
                    && isUntrimmedSuperset(valueA, valueB);
                if (trimmedWinsA !== trimmedWinsB) {
                    return {
                        winner: trimmedWinsA ? 'a' : 'b',
                        reason: 'trimmed title beats its own untrimmed superset'
                    };
                }
            }
            // A date-only segment welded onto the title ("CHUNK Chicago -
            // September 19th" vs "CHUNK Chicago") is pure redundancy on a
            // calendar — the date lives in startDate — and the arbitration
            // model's more-descriptive preference could otherwise let the
            // dated variant win. When the two candidates are IDENTICAL after
            // removing such a segment (detectTitleDateSegment, the SAME
            // detector the ai-web parser's extraction-time strip uses) and
            // exactly one side carries it, the DATELESS side wins. The
            // identical-after-removal requirement is the whole justification:
            // both sides already agree on the base name, so no startDate
            // validation is needed here (merge-side startDates are combined,
            // possibly past-midnight-rolled UTC instants that cannot be
            // compared to the printed local date reliably). Both dated, both
            // dateless, or genuinely different base names fall through (AI
            // arbitrates, with a prompt rule as backstop). MUST run before
            // the bare-city rule below: a dated bare-city twin ("New Orleans
            // - July 25" vs "New Orleans") should resolve dateless-first,
            // not count as a "named" title.
            const dateSegmentA = SharedCore.detectTitleDateSegment(valueA);
            const dateSegmentB = SharedCore.detectTitleDateSegment(valueB);
            if (Boolean(dateSegmentA) !== Boolean(dateSegmentB)) {
                const datedSegment = dateSegmentA || dateSegmentB;
                const datelessTitle = (dateSegmentA ? valueB : valueA).replace(/\s+/g, ' ').trim();
                if (datedSegment.base === datelessTitle) {
                    return {
                        winner: dateSegmentA ? 'b' : 'a',
                        reason: 'date-only suffix is redundant, kept the dateless title'
                    };
                }
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
            // Title doctrine rung: the venue's name belongs in the bar field,
            // not the title (run 20260725-170926: "…Singlet Night at the
            // Dallas Eagle" vs "Singlet Night with DJ Drew G" — the venue-free
            // title is the event's name). When exactly one side's compact
            // title contains a FULL venue-name key (normalizeBarNameKey of a
            // context bar name, ≥ 4 chars — full-key containment only, never a
            // stem, so "Eagle Karaoke" does not contain "dallaseagle") and the
            // venue-free side still has at least one significant token, the
            // venue-free side wins. Calendar merges are exempt — calendar
            // titles are curated-by-usage and may deliberately carry the
            // venue. Both/neither containing → fall through (AI arbitrates).
            const titleSideLabels = context && context.sideLabels && typeof context.sideLabels === 'object'
                ? context.sideLabels : null;
            const titleVenueKeys = (context && Array.isArray(context.barNames) ? context.barNames : [])
                .map(name => this.normalizeBarNameKey(name))
                .filter(key => key.length >= 4);
            if ((!titleSideLabels || titleSideLabels.a !== 'calendar') && titleVenueKeys.length > 0) {
                const compactTitle = value => this.stripEmojiForTitleTwin(String(value || ''))
                    .toLowerCase().replace(/[^a-z0-9]/g, '');
                const containsVenueKey = value => {
                    const compact = compactTitle(value);
                    return Boolean(compact) && titleVenueKeys.some(key => compact.includes(key));
                };
                const venueInA = containsVenueKey(valueA);
                const venueInB = containsVenueKey(valueB);
                if (venueInA !== venueInB) {
                    const venueFreeValue = venueInA ? valueB : valueA;
                    if (this.getCrossSourceTitleTokens(venueFreeValue, titleVenueKeys).length > 0) {
                        return {
                            winner: venueInA ? 'b' : 'a',
                            reason: 'title doctrine: venue name belongs in bar, not title'
                        };
                    }
                }
            }
        }
        // A street address is never a venue name: Eventbrite JSON-LD shipped
        // location.name as the street line ("10-90 Wyckoff Ave") and AI
        // arbitration picked it over the calendar's real venue ("HOLO") with
        // exactly backwards reasoning (observed 2026-07-17). Decidable
        // deterministically, in order: 1) exactly one side matching a curated
        // bar name for the event's city wins — curated bar data OUTRANKS
        // anything derived, so the bar field must never reach AI arbitration
        // when curated data settles it (observed 2026-07-22: arbitration
        // hallucinated "'MASSIVE' is the organizer (BEARRACUDA)" and picked a
        // flyer subtitle "Shore Thing" over the curated Seattle venue Massive,
        // in BOTH the enrich and calendar merges); 2) exactly one
        // address-shaped side LOSES. Both sides curated, both address-shaped,
        // or neither rule applying still arbitrate (with a prompt rule as
        // backstop) — this path FAILS OPEN to today's behavior, as do a
        // missing city and missing bars data.
        if (fieldName === 'bar') {
            const cityBars = this.getCuratedCityBars(context && context.cityKey);
            if (cityBars) {
                const curatedA = this.findCuratedBarByName(cityBars, valueA);
                const curatedB = this.findCuratedBarByName(cityBars, valueB);
                if (Boolean(curatedA) !== Boolean(curatedB)) {
                    const matched = curatedA || curatedB;
                    return {
                        winner: curatedA ? 'a' : 'b',
                        reason: `matches curated bar data (${matched.name})`
                    };
                }
            }
            const addressShapedA = this.looksLikeStreetAddress(valueA);
            const addressShapedB = this.looksLikeStreetAddress(valueB);
            if (addressShapedA !== addressShapedB) {
                return {
                    winner: addressShapedA ? 'b' : 'a',
                    reason: 'a street address is not a venue name'
                };
            }
            // Corroboration demotion rung: barSource provenance stamped at
            // extraction (page-adjacent = bar found next to the address in the
            // source; venue-site = the venue's own site; curated = curated
            // bars data; geo-poi = a reverse/forward-geocode POI name matched
            // the bar (OpenStreetMapNormalizer, phase 3); uncorroborated =
            // the address was in the source but the bar was NOT near it — the
            // flyer-subtitle failure shape).
            // Exactly one candidate stamped uncorroborated while the other is
            // corroborated → the corroborated one wins without AI. Attribution
            // is strict like the image provenance rung: a record's barSource
            // only speaks for the candidate when the record's own bar field IS
            // that candidate value. Both uncorroborated, both corroborated, or
            // stamps missing → fall through to today's behavior (fail open).
            const barContextRecords = context && context.records && typeof context.records === 'object'
                ? context.records : null;
            // Case-only twins are the SAME venue spelled louder — provenance
            // stamps must never pick between them, or the demotion rung
            // crowns the SHOUTIER twin (e.g. a corroborated "AQUA EMPORIO"
            // over an uncorroborated "Aqua Emporio") before the case-only
            // rule below can keep the less-uppercased form. Skipping the
            // rung for twins applies in BOTH merge flows and regardless of
            // which stamps the two sides carry.
            const collapseBarForTwinCheck = value => typeof value === 'string'
                ? value.replace(/\s+/g, ' ').trim() : '';
            const caseOnlyBarTwins = collapseBarForTwinCheck(valueA) !== ''
                && collapseBarForTwinCheck(valueA).toLowerCase() === collapseBarForTwinCheck(valueB).toLowerCase();
            if (barContextRecords && !caseOnlyBarTwins) {
                const getBarProvenance = (record, value) => {
                    if (!record || typeof record !== 'object') return '';
                    const recordBar = typeof record.bar === 'string' ? record.bar.trim() : '';
                    const candidate = typeof value === 'string' ? value.trim() : '';
                    if (!recordBar || !candidate || recordBar !== candidate) return '';
                    return typeof record.barSource === 'string' ? record.barSource.trim() : '';
                };
                const isCorroboratedStamp = stamp =>
                    stamp === 'page-adjacent' || stamp === 'venue-site' || stamp === 'curated'
                    || stamp === 'geo-poi' || stamp === 'venue-site-identity';
                const matchesCuratedBar = value =>
                    Boolean(cityBars && this.findCuratedBarByName(cityBars, value));
                const provenanceA = getBarProvenance(barContextRecords.a, valueA);
                const provenanceB = getBarProvenance(barContextRecords.b, valueB);
                const uncorroboratedA = provenanceA === 'uncorroborated';
                const uncorroboratedB = provenanceB === 'uncorroborated';
                if (uncorroboratedA !== uncorroboratedB) {
                    const corroboratedA = isCorroboratedStamp(provenanceA) || matchesCuratedBar(valueA);
                    const corroboratedB = isCorroboratedStamp(provenanceB) || matchesCuratedBar(valueB);
                    if (uncorroboratedA && corroboratedB) {
                        return { winner: 'b', reason: 'corroborated bar beats uncorroborated' };
                    }
                    if (uncorroboratedB && corroboratedA) {
                        return { winner: 'a', reason: 'corroborated bar beats uncorroborated' };
                    }
                    // Demotion doctrine: an uncorroborated SCRAPED bar never
                    // clobbers ANY calendar bar deterministically — calendar
                    // records are curated-by-usage, so an unstamped (legacy)
                    // calendar bar still outranks a flagged scrape. Calendar
                    // flow only (side "a" is the calendar record there); the
                    // enrich flow's two scraped records keep today's behavior.
                    const sideLabels = context.sideLabels && typeof context.sideLabels === 'object'
                        ? context.sideLabels : null;
                    if (sideLabels && sideLabels.a === 'calendar' && uncorroboratedB && !provenanceA) {
                        return { winner: 'a', reason: 'corroborated bar beats uncorroborated' };
                    }
                }
            }
        }
        // Deterministic address ladder: EVERY address conflict in run
        // 20260722-124758 (all six) was the SAME address in two formats
        // ("619 East Pine Street, Seattle, WA, 98122" vs "619 E. Pine St,
        // Seattle, WA"), each burning an AI arbitration with coin-flip risk.
        // Rung 1: same-address detection — equal street numbers plus a
        // normalized-token prefix/street-line match (isSameStreetAddress) means
        // the two candidates denote one address, and the MORE COMPLETE form
        // wins (component count, then normalized length; a full tie falls
        // through so the case-only rule below can still settle pure case
        // twins). Rung 2: when either record's bar matches a curated bar for
        // the event's city and exactly one candidate is that bar's curated
        // address (in any format), the curated one wins — but ONLY when the
        // other candidate is not itself a parseable street address: a
        // parseable candidate that failed the same-address check is a genuine
        // CONTRADICTION of curated data and is never silently resolved.
        // Rung 3: evidence — for candidates rungs 1–2 found genuinely
        // different (or unparseable but both present), pins the pipeline
        // ALREADY produced decide when they can (see
        // resolveAddressMismatchByEvidence: one verified pin, city-center
        // sanity, curated-bar proximity — no network calls). Everything not
        // decided above FAILS OPEN to AI arbitration exactly as today, but a
        // true street mismatch reaching the AI is warned about first so it is
        // never silent.
        if (fieldName === 'address' && typeof valueA === 'string' && typeof valueB === 'string') {
            const parsedA = this.parseAddressForComparison(valueA);
            const parsedB = this.parseAddressForComparison(valueB);
            if (parsedA && parsedB && this.isSameStreetAddress(parsedA, parsedB)) {
                const scoreA = this.scoreAddressCompleteness(valueA, parsedA);
                const scoreB = this.scoreAddressCompleteness(valueB, parsedB);
                const lengthA = parsedA.tokens.join(' ').length;
                const lengthB = parsedB.tokens.join(' ').length;
                if (scoreA !== scoreB || lengthA !== lengthB) {
                    return {
                        winner: scoreA !== scoreB
                            ? (scoreA > scoreB ? 'a' : 'b')
                            : (lengthA > lengthB ? 'a' : 'b'),
                        reason: 'same address, kept the more complete form'
                    };
                }
                // Full tie → fall through (case-only rule below, else AI).
            } else {
                const cityBars = this.getCuratedCityBars(context && context.cityKey);
                const barNames = context && Array.isArray(context.barNames) ? context.barNames : [];
                let curatedBar = null;
                if (cityBars) {
                    for (const barName of barNames) {
                        curatedBar = this.findCuratedBarByName(cityBars, barName);
                        if (curatedBar) break;
                    }
                }
                const curatedAddress = curatedBar && typeof curatedBar.address === 'string'
                    ? curatedBar.address.trim() : '';
                const parsedCurated = curatedAddress ? this.parseAddressForComparison(curatedAddress) : null;
                if (parsedCurated) {
                    const matchesCuratedA = this.isSameStreetAddress(parsedA, parsedCurated);
                    const matchesCuratedB = this.isSameStreetAddress(parsedB, parsedCurated);
                    if (matchesCuratedA !== matchesCuratedB && !(matchesCuratedA ? parsedB : parsedA)) {
                        return {
                            winner: matchesCuratedA ? 'a' : 'b',
                            reason: `matches curated bar address (${curatedBar.name})`
                        };
                    }
                } else if (curatedAddress) {
                    // A curated address WITHOUT a leading house number (e.g.
                    // Spanish "Calle Danza Invisible, La Nogalera 710, 29620
                    // Torremolinos") never parses for the street rung above,
                    // which left the curated street address losing to a stale
                    // district-only calendar value via AI coin flips. Fall
                    // back to normalized-token equality (the same
                    // normalizeAddressTokens family): exactly one candidate
                    // IS the curated bar's address token-for-token → it wins,
                    // with the SAME fail-closed guard — the other candidate
                    // must not itself be a parseable street address (a
                    // parseable contradiction of curated data is never
                    // silently resolved).
                    const curatedTokenKey = this.normalizeAddressTokens(curatedAddress).join(' ');
                    const equalsCurated = value => curatedTokenKey !== ''
                        && this.normalizeAddressTokens(value).join(' ') === curatedTokenKey;
                    const equalsCuratedA = equalsCurated(valueA);
                    const equalsCuratedB = equalsCurated(valueB);
                    if (equalsCuratedA !== equalsCuratedB && !(equalsCuratedA ? parsedB : parsedA)) {
                        return {
                            winner: equalsCuratedA ? 'a' : 'b',
                            reason: `matches curated bar address (${curatedBar.name})`
                        };
                    }
                }
                // City-suffix twin rung: one candidate is EXACTLY the other
                // plus a trailing ", <city>" naming the event's own resolved
                // city ("LA NOGALERA, Torremolinos" vs "LA NOGALERA"). The
                // suffixed form is the fingerprint of the pre-#1525 append bug
                // (city RESOLUTION leaking into the persisted address) and the
                // suffix adds nothing the city field doesn't already carry —
                // city-qualified strings are QUERIES only. The unsuffixed form
                // wins deterministically so AI arbitration can never re-cement
                // the mutation ("more complete" reasoning did exactly that on
                // run 20260723-140457). House-numbered street addresses never
                // reach here — the same-address rung above already resolved
                // them (keeping the more complete, city-bearing form).
                const citySuffixTwin = this.resolveCitySuffixedAddressTwin(valueA, valueB, context);
                if (citySuffixTwin) return citySuffixTwin;
                // Rung 3 (evidence). Case-only twins are NOT a street
                // mismatch — they fall through untouched so the case-only
                // rule below keeps deciding them; empty candidates belong to
                // the existing empty-field handling.
                const collapseForTwinCheck = value => String(value).replace(/\s+/g, ' ').trim().toLowerCase();
                const collapsedMismatchA = collapseForTwinCheck(valueA);
                const collapsedMismatchB = collapseForTwinCheck(valueB);
                if (collapsedMismatchA && collapsedMismatchB && collapsedMismatchA !== collapsedMismatchB) {
                    const evidenceResolution = this.resolveAddressMismatchByEvidence(valueA, valueB, context);
                    if (evidenceResolution) return evidenceResolution;
                    // Nothing decidable from evidence: the AI arbitrates
                    // exactly as before, but never silently — a genuine
                    // street mismatch always leaves a manual-review trail.
                    const mismatchEventTitle = context && context.eventTitle ? context.eventTitle : 'event';
                    console.warn(`⚠️ MERGE: "${mismatchEventTitle}" field=address street mismatch arbitrated by AI ("${valueA}" vs "${valueB}") — verify manually`);
                }
            }
        }
        // Description strict superset: when one candidate's normalized text
        // (lowercased, entities decoded, whitespace collapsed — see
        // normalizeDescriptionForContainment) CONTAINS the other's ENTIRE
        // normalized text and is longer, the superset carries strictly more
        // information — keep it without burning an AI arbitration. Partial
        // overlap is a genuine conflict and still arbitrates; equal-after-
        // normalization pairs fall through to the case-only rule below.
        if (fieldName === 'description' && typeof valueA === 'string' && typeof valueB === 'string') {
            const containA = this.normalizeDescriptionForContainment(valueA);
            const containB = this.normalizeDescriptionForContainment(valueB);
            if (containA && containB && containA !== containB) {
                if (containA.includes(containB)) {
                    return { winner: 'a', reason: 'description contains the other candidate\'s full text' };
                }
                if (containB.includes(containA)) {
                    return { winner: 'b', reason: 'description contains the other candidate\'s full text' };
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
            '- A street address (e.g. "10-90 Wyckoff Ave") is never a venue name — for "bar", prefer a named venue over an address.',
            organizer ? `- KNOWN ORGANIZER: ${JSON.stringify(String(organizer))} — never pick a bar value equal to the organizer.` : '',
            '- Never reject a bar value as "the organizer" unless it is the SAME NAME as the known organizer — a venue sharing a page or flyer with the organizer is still the venue.',
            '- For "title", when both variants name the same event, prefer the MORE DESCRIPTIVE one — a subtitle, theme, edition, or anniversary (e.g. "Treasure Trail Seattle: Summer Sausage" over "Treasure Trail Seattle") is part of the event\'s identity, not noise.',
            '- For "title", extra text does NOT count as descriptive when it is only status text (e.g. sold-out notices) or site branding — never prefer a variant for those.',
            '- For "title", a bare city name is not an event name — prefer the variant that names the event or its organizer.',
            '- For "title", the event\'s own date is NOT descriptive — never prefer a variant because it contains a date; prefer the dateless variant of an otherwise-equal name.',
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
            allProcessedEvents: [], // All events ready for calendar
            // Enforce-mode bear-check drops, surfaced for the results UI and the
            // prep-time manual-override check. Never enter the write plan,
            // dedup, or calendar analysis by default.
            bearDroppedEvents: []
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

                // Aggregate enforce-mode bear-check drops. Their event objects
                // carry the effective parser config too — a prep-time manual
                // rescue needs calendar assignment and dry-run filtering to
                // behave exactly like a normally kept event.
                if (Array.isArray(parserResult.bearDroppedEvents) && parserResult.bearDroppedEvents.length > 0) {
                    const stampedConfig = parserResult.config || parserConfig;
                    for (const dropped of parserResult.bearDroppedEvents) {
                        if (dropped && dropped.event && Object.isExtensible(dropped.event)) {
                            dropped.event._parserConfig = stampedConfig;
                        }
                    }
                    results.bearDroppedEvents.push(...parserResult.bearDroppedEvents);
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

        // Discovered venue calendars (enrich-only ticket crawl drops): logged
        // here and attached to results so the UI summaries can render the same
        // block with a paste-ready parser entry.
        const discoveredVenueCalendars = this.buildDiscoveredVenueCalendars(results.parserResults);
        if (discoveredVenueCalendars.length > 0) {
            results.discoveredVenueCalendars = discoveredVenueCalendars;
            results.discoveredVenueSummary = this.buildDiscoveredVenueSummaryText(discoveredVenueCalendars);
            await displayAdapter.logInfo(results.discoveredVenueSummary);
        }

        // New venue candidates (GATHERING-ONLY): corroborated + exactly-pinned
        // venues absent from curated bars data, aggregated once per run per
        // venue. Evidence for out-of-band curation; the pipeline NEVER reads
        // this list (or the adapter's venue queue file) back.
        const newVenueCandidates = this.buildNewVenueCandidates(results.allProcessedEvents);
        if (newVenueCandidates.length > 0) {
            results.newVenueCandidates = newVenueCandidates;
            for (const candidate of newVenueCandidates) {
                await displayAdapter.logInfo(this.formatNewVenueCandidateLogLine(candidate));
            }
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
        // to 'ai-web', equally pinned. parser: "auto" (used by the share-sheet
        // URL-input path) resolves via detectParserFromUrl — today that only maps
        // scriptable-input:// (and ai-web://) scheme URLs to their parsers; any
        // other URL, discovered ones included, resolves to the generic 'ai-web'.
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

        // Sibling events dropped by the enrich-only ticket crawl (flag, don't
        // drop silently): surfaced as a discovered-venue suggestion block.
        const enrichDropCollector = [];

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
            discoveryTreeCollector,
            enrichOnlyByUrl: null,
            enrichDropCollector
        });

        // Venue-site address consensus (deterministic, parser-derived): the
        // ai-web parser harvested map-directions addresses per registrable
        // site during the crawl; with every page of the run now seen, fill
        // blank address/city on the site's own events ('venue-site'
        // provenance, enrich-only — the curated machinery still outranks
        // downstream). Judged only here because a later page's conflicting
        // address must be able to veto the whole site (fail closed).
        const aiWebParser = parsers && parsers['ai-web'];
        if (aiWebParser && typeof aiWebParser.applyVenueSiteAddressConsensus === 'function') {
            aiWebParser.applyVenueSiteAddressConsensus(allEvents, mainConfig?.cities || null);
        }
        // Venue-site identity corrections (deterministic, curated-anchored):
        // when a crawled site's identity is established — venue role seen,
        // unique curated-bar name match, address agreement — flyer-subtitle
        // bars on that site's events are corrected to the curated venue name
        // ('venue-site-identity' provenance). Consensus first, identity
        // second: the pass consumes the consensus stash the call above left.
        if (aiWebParser && typeof aiWebParser.applyVenueSiteIdentityCorrections === 'function') {
            aiWebParser.applyVenueSiteIdentityCorrections(allEvents, mainConfig?.cities || null);
        }

        // Aggregator website pointer (trust the pointer, not the copy —
        // battery run 20260728: all 42 The Bear Calendar events carried
        // website = the aggregator's own event page): when a configured root
        // classified 'link-aggregator', an event whose website still points
        // at its own source page on that aggregator's host but whose
        // ticketUrl points at a DIFFERENT host gets website = ticketUrl (the
        // original source). Generic signal only — no per-site rules.
        this.applyAggregatorWebsitePointers(allEvents, urlClassifications);

        // Metadata is applied dynamically by parsers using the {value, merge} format

        // Filter and process events. Enforce-mode bear-check drops are carried
        // through to results (flag, don't drop) — never into the write plan.
        const bearDropCollector = [];
        // allowPastEvents can now be set once globally (config.allowPastEvents)
        // as well as per parser — Stanley 2026-07-30: keep past events so the
        // website reads as full, rather than dropping them at scrape time.
        const keepPastEvents = effectiveParserConfig.allowPastEvents
            || Boolean(mainConfig && mainConfig.config && mainConfig.config.allowPastEvents);
        const futureEvents = this.filterFutureEvents(allEvents, effectiveParserConfig.daysToLookAhead, keepPastEvents);
        // Curated promoter registry pass (before the bear check so a matched
        // promoter's bearAffinity can steer per-event trust): match each
        // event's own evidence to data/promoters.json and — in enforce mode —
        // stamp the curated identity + metadata.
        this.applyPromoterRegistryMatches(futureEvents, effectiveParserConfig, mainConfig);
        const bearEvents = await this.filterBearEvents(futureEvents, effectiveParserConfig, httpAdapter, bearDropCollector);
        // Overlong-field trims run before dedup so trimmed values feed the
        // dedup keys/merges (report mode by default; see getTrimConfig).
        await this.applyOverlongFieldTrims(bearEvents, effectiveParserConfig, httpAdapter);
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

        if (enrichDropCollector.length > 0) {
            result.enrichOnlyDrops = enrichDropCollector;
        }

        if (bearDropCollector.length > 0) {
            result.bearDroppedEvents = bearDropCollector;
        }

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

    // Aggregator website pointer pass (see the processParser call site): for
    // events extracted from a site whose configured root classified as
    // 'link-aggregator', a website that merely points back at the event's own
    // aggregator page is a copy, not the pointer — prefer the ticketUrl when
    // it leads OFF the aggregator's host. Fails closed on any missing piece:
    // no website, no ticketUrl, same-host ticketUrl, or a website that is not
    // the event's own source page all leave the event untouched.
    applyAggregatorWebsitePointers(events, urlClassifications) {
        if (!Array.isArray(events) || events.length === 0) return;
        const classifications = urlClassifications && typeof urlClassifications === 'object' ? urlClassifications : {};
        const aggregatorHosts = new Set();
        for (const url of Object.keys(classifications)) {
            if (classifications[url] !== 'link-aggregator') continue;
            const host = this.getHostFromUrl(url).toLowerCase().replace(/^www\./, '');
            if (host) aggregatorHosts.add(host);
        }
        if (aggregatorHosts.size === 0) return;
        for (const event of events) {
            if (!event || typeof event !== 'object') continue;
            const website = typeof event.website === 'string' ? event.website.trim() : '';
            const ticketUrl = typeof event.ticketUrl === 'string' ? event.ticketUrl.trim() : '';
            const sourcePageUrl = typeof event._sourcePageUrl === 'string' ? event._sourcePageUrl.trim() : '';
            if (!website || !ticketUrl || !sourcePageUrl) continue;
            const sourceHost = this.getHostFromUrl(sourcePageUrl).toLowerCase().replace(/^www\./, '');
            if (!sourceHost || !aggregatorHosts.has(sourceHost)) continue;
            if (this.getUrlDedupeKey(website) !== this.getUrlDedupeKey(sourcePageUrl)) continue;
            const ticketHost = this.getHostFromUrl(ticketUrl);
            if (!ticketHost || this.areUrlHostsSameSite(ticketHost, sourceHost)) continue;
            event.website = ticketUrl;
            console.log(`🤖 AI Web: website set to original source ${ticketHost} (aggregator page pointer)`);
        }
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

    // ------------------------------------------------------------------
    // Discovered venue calendars (flag, don't drop): siblings dropped by the
    // enrich-only ticket crawl are surfaced as a paste-ready parser entry
    // suggestion instead of being silently discarded.
    // ------------------------------------------------------------------

    // Aggregate per-parser enrichOnlyDrops into one entry per host.
    buildDiscoveredVenueCalendars(parserResults) {
        const byHost = new Map();
        for (const parserResult of Array.isArray(parserResults) ? parserResults : []) {
            const drops = parserResult && Array.isArray(parserResult.enrichOnlyDrops) ? parserResult.enrichOnlyDrops : [];
            for (const drop of drops) {
                if (!drop || !drop.host) continue;
                const hostKey = String(drop.host).toLowerCase();
                if (!byHost.has(hostKey)) {
                    byHost.set(hostKey, {
                        host: drop.host,
                        origin: `https://${drop.host}`,
                        suggestedName: String(drop.host).replace(/^www\./i, ''),
                        parentTitle: drop.parentTitle || '',
                        sourceEntryName: parserResult && parserResult.name ? parserResult.name : '',
                        droppedCount: 0,
                        droppedEvents: []
                    });
                }
                const entry = byHost.get(hostKey);
                const dropped = Array.isArray(drop.droppedEvents) ? drop.droppedEvents : [];
                entry.droppedCount += dropped.length;
                entry.droppedEvents.push(...dropped);
            }
        }
        const venues = [];
        for (const entry of byHost.values()) {
            if (entry.droppedCount === 0) continue;
            entry.sampleTitles = entry.droppedEvents.slice(0, 8).map(event => {
                const dateLabel = this.formatDiscoveredVenueDateLabel(event.startDate);
                return dateLabel ? `${event.title} (${dateLabel})` : event.title;
            });
            entry.parserEntrySnippet = `{ name: ${JSON.stringify(entry.suggestedName)}, enabled: false, urls: [${JSON.stringify(entry.origin)}], alwaysBear: false },`;
            delete entry.droppedEvents;
            venues.push(entry);
        }
        return venues;
    }

    // Short "Jul 23" label for a dropped sibling's start date ('' when unknown).
    formatDiscoveredVenueDateLabel(startDate) {
        const date = startDate instanceof Date ? startDate : this.parseDate(startDate);
        if (!date || Number.isNaN(date.getTime())) return '';
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[date.getMonth()]} ${date.getDate()}`;
    }

    // Text block for the results summary ('' when nothing was dropped).
    buildDiscoveredVenueSummaryText(venues) {
        const list = Array.isArray(venues) ? venues : [];
        if (list.length === 0) return '';
        const blocks = list.map(venue => {
            const extraCount = venue.droppedCount - venue.sampleTitles.length;
            const titlesLine = venue.sampleTitles.join(', ') + (extraCount > 0 ? `, … (+${extraCount} more)` : '');
            return [
                `📋 DISCOVERED VENUE CALENDAR: ${venue.host}`,
                `   ${venue.droppedCount} event(s) found but not ingested (enrich-only ticket crawl)`,
                `   Titles: ${titlesLine}`,
                '   To scrape this venue, add a parser entry to scraper-input.js:',
                `   ${venue.parserEntrySnippet}`
            ].join('\n');
        });
        return blocks.join('\n\n');
    }

    // ------------------------------------------------------------------
    // New venue candidates (growth loop, GATHERING-ONLY): venues this run's
    // own evidence corroborates (vouched-for bar name + exact geocoded pin)
    // that curated bars data does not know yet. This is information
    // collection, NOT authority: the candidate list is displayed and
    // optionally queued by the adapter as evidence for out-of-band curation,
    // and NOTHING in the scraping pipeline ever reads it back.
    // ------------------------------------------------------------------

    // An event vouches for a NEW venue only when every signal is positive
    // (fail open — any missing field means "not a candidate"):
    //   - bar present with corroborated non-curated provenance: page-adjacent
    //     / venue-site (extraction-time corroboration) or geo-poi (map
    //     placemark corroboration). curated = already known; uncorroborated
    //     or unstamped = nothing vouched for the name.
    //   - pin present with pinSource geocoded-exact (a curated pin also means
    //     already-known; approx/page pins are not location proof).
    //   - resolved city, and the bar name does NOT match that city's curated
    //     bars (findCuratedBarByName's normalization).
    isNewVenueCandidateEvent(event) {
        if (!event || typeof event !== 'object') return false;
        const bar = typeof event.bar === 'string' ? event.bar.trim() : '';
        if (!bar) return false;
        const barSource = typeof event.barSource === 'string' ? event.barSource.trim() : '';
        if (!NEW_VENUE_CANDIDATE_BAR_SOURCES.includes(barSource)) return false;
        const pinSource = typeof event.pinSource === 'string' ? event.pinSource.trim() : '';
        if (pinSource !== 'geocoded-exact') return false;
        const location = typeof event.location === 'string' ? event.location.trim() : '';
        if (!this.isCoordinatePair(location)) return false;
        const cityKey = typeof event.city === 'string' ? event.city.trim() : '';
        if (!cityKey) return false;
        const cityBars = this.getCuratedCityBars(cityKey);
        if (cityBars && this.findCuratedBarByName(cityBars, bar)) return false;
        return true;
    }

    // Aggregate qualifying events into one candidate per unique
    // (cityKey, normalized bar name). Pure: reads only data already on the
    // events; timestamps/file I/O belong to the adapter.
    buildNewVenueCandidates(events, options = {}) {
        const runId = options && options.runId ? String(options.runId) : null;
        const byKey = new Map();
        const poiByKey = new Map();
        for (const event of Array.isArray(events) ? events : []) {
            if (!this.isNewVenueCandidateEvent(event)) continue;
            const bar = event.bar.trim();
            const cityKey = event.city.trim().toLowerCase();
            const key = `${cityKey}|${this.normalizeBarNameKey(bar)}`;
            const barSource = event.barSource.trim();
            const address = typeof event.address === 'string' ? event.address.trim() : '';
            // Organizer-link pollution guard: an event's website/instagram
            // describe whatever entity the SOURCE PAGE is about — on
            // promoter-scraped events that's the ORGANIZER (e.g.
            // bearracuda.com / @bearracuda), not the venue hosting the party.
            // The only stamp proving the page IS the venue's own site is
            // barSource === 'venue-site' (siteRole=venue + page-name match at
            // extraction time — see ai-web-parser's stampBarSourceProvenance),
            // so the dossier carries website/instagram only from those events.
            // Otherwise both fields are omitted entirely: in a curation
            // dossier, missing data beats wrong data (and the adapter's
            // fill-blanks-only queue merge means an omission here never
            // re-adds organizer links to entries that lack them).
            const linksAreVenueAttributable = barSource === 'venue-site';
            const website = linksAreVenueAttributable
                ? (typeof event.website === 'string' && event.website.trim()
                    ? event.website.trim()
                    : (typeof event.url === 'string' ? event.url.trim() : ''))
                : '';
            const instagram = linksAreVenueAttributable && typeof event.instagram === 'string'
                ? event.instagram.trim()
                : '';

            let candidate = byKey.get(key);
            if (!candidate) {
                candidate = {
                    key,
                    name: bar,
                    city: cityKey,
                    address: '',
                    coordinates: event.location.trim(),
                    signals: [],
                    sourceEvents: [],
                    runId
                };
                byKey.set(key, candidate);
                // Geo-POI evidence rides with the coordinate-donor event (the
                // candidate's coordinates come from this first event, so its
                // harvested POI name is the one naming THAT pin). Kept in a
                // side map — never on the candidate itself, which is written
                // verbatim into results/venue-queue files.
                poiByKey.set(key, {
                    _geoPoiName: typeof event._geoPoiName === 'string' ? event._geoPoiName : '',
                    _geoPoiBarMatch: event._geoPoiBarMatch
                });
            }
            candidate.name = this.pickBetterCasedVenueName(candidate.name, bar);
            if (this.isMoreCompleteVenueAddress(address, candidate.address)) {
                candidate.address = address;
            }
            if (!candidate.signals.includes(barSource)) candidate.signals.push(barSource);
            if (website && !candidate.website) candidate.website = website;
            if (instagram && !candidate.instagram) candidate.instagram = instagram;
            if (candidate.sourceEvents.length < NEW_VENUE_CANDIDATE_SOURCE_EVENT_CAP) {
                candidate.sourceEvents.push({
                    title: typeof event.title === 'string' ? event.title : '',
                    date: this.formatNewVenueCandidateDate(event.startDate),
                    sourcePageUrl: typeof event._sourcePageUrl === 'string' && event._sourcePageUrl
                        ? event._sourcePageUrl
                        : (typeof event.url === 'string' ? event.url : '')
                });
            }
        }
        // Computed evidence panel per candidate (results-UI display only):
        // the candidate re-shaped as an event drives the same pure builder
        // the event cards use. pinSource is 'geocoded-exact' by construction
        // (isNewVenueCandidateEvent requires it) and the barSource shown is
        // the first observed signal.
        for (const candidate of byKey.values()) {
            const poi = poiByKey.get(candidate.key) || {};
            candidate.evidence = this.buildEventEvidenceLines({
                bar: candidate.name,
                city: candidate.city,
                address: candidate.address,
                location: candidate.coordinates,
                barSource: candidate.signals[0] || '',
                pinSource: 'geocoded-exact',
                _geoPoiName: poi._geoPoiName,
                _geoPoiBarMatch: poi._geoPoiBarMatch
            }, { cityKey: candidate.city });
        }
        return Array.from(byKey.values());
    }

    // Prefer a mixed-case observation of the venue name over an ALL-CAPS or
    // all-lowercase one ("Massive" beats "MASSIVE"); otherwise first wins.
    pickBetterCasedVenueName(current, next) {
        const isMixedCase = value => /[a-z]/.test(value) && /[A-Z]/.test(value);
        return isMixedCase(next) && !isMixedCase(current) ? next : current;
    }

    // Candidate ISO date string ('' when absent/unparseable) — durable
    // conversion of data already on the event, not a clock read.
    formatNewVenueCandidateDate(startDate) {
        const date = startDate instanceof Date ? startDate : this.parseDate(startDate);
        if (!date || Number.isNaN(date.getTime())) return '';
        return date.toISOString();
    }

    // "Most complete observed address" order: more comma segments + a ZIP
    // outrank fewer; ties go to the longer string; first observation wins
    // exact ties. Static so the adapter's queue merge reuses the same rule.
    static scoreVenueCandidateAddress(value) {
        const text = typeof value === 'string' ? value.trim() : '';
        if (!text) return -1;
        const segments = text.split(',').map(segment => segment.trim()).filter(Boolean);
        return segments.length + (/\b\d{5}\b/.test(text) ? 1 : 0);
    }

    static isMoreCompleteVenueAddressStatic(next, current) {
        const nextScore = SharedCore.scoreVenueCandidateAddress(next);
        const currentScore = SharedCore.scoreVenueCandidateAddress(current);
        if (nextScore !== currentScore) return nextScore > currentScore;
        return String(next || '').trim().length > String(current || '').trim().length;
    }

    isMoreCompleteVenueAddress(next, current) {
        return SharedCore.isMoreCompleteVenueAddressStatic(next, current);
    }

    // One additive log line per run per candidate venue.
    formatNewVenueCandidateLogLine(candidate) {
        const signals = Array.isArray(candidate.signals) ? candidate.signals.join(', ') : '';
        const address = candidate.address || 'no address observed';
        return `📋 NEW VENUE CANDIDATE: "${candidate.name}" (${candidate.city}) — signals: ${signals} — ${address}`;
    }

    // ------------------------------------------------------------------
    // Computed evidence panel (results-UI only). Short human-readable
    // consistency checks derived ONLY from data already on the event plus
    // the threaded config context (cities / curated bars) — no lookups, no
    // network. Every line is independent and every guard fails open: when
    // an input is absent its line is simply omitted, and an event with
    // nothing computable yields []. Rendered by the adapters as a muted
    // "Evidence" block; never serialized into notes (the builder writes
    // nothing onto the event).
    // ------------------------------------------------------------------

    // Distance label for evidence lines: <1 km → whole meters, else 1-decimal
    // km ("42 m", "1.3 km").
    formatEvidenceDistance(km) {
        return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
    }

    // Evidence lines for one event (or an event-shaped venue candidate).
    // context.cityKey overrides event.city for the config lookups (candidates
    // carry their own city key). Returns an array of short strings; [] when
    // nothing is computable.
    buildEventEvidenceLines(event, context = {}) {
        const lines = [];
        if (!event || typeof event !== 'object') return lines;
        const cityKey = typeof context.cityKey === 'string' && context.cityKey.trim()
            ? context.cityKey.trim()
            : (typeof event.city === 'string' ? event.city.trim() : '');
        const bar = typeof event.bar === 'string' ? event.bar.trim() : '';
        const pin = this.isCoordinatePair(event.location) ? String(event.location).trim() : '';

        // Pin ↔ curated bar: the pinned coordinates against the curated city
        // bar the event's bar name matches. Same venue → tens of meters; >150 m
        // means the pin and the curated record disagree about where this bar is.
        if (pin && bar) {
            const cityBars = this.getCuratedCityBars(cityKey);
            const curated = cityBars ? this.findCuratedBarByName(cityBars, bar) : null;
            if (curated && this.isCoordinatePair(curated.coordinates)) {
                const km = this.coordinatePairDistanceKm(pin, curated.coordinates);
                if (km !== null) {
                    const warn = km > 0.15 ? '⚠️ ' : '';
                    lines.push(`${warn}pin is ${this.formatEvidenceDistance(km)} from curated "${curated.name}" pin`);
                }
            }
        }

        // Pin ↔ city center: a sanity radius, not an identity check — venues
        // sit within a metro, so >50 km says the pin landed in the wrong place
        // (same-named venue in another city, geocoder mishap).
        if (pin) {
            const center = this.getCityCenterCoordinatePair(cityKey);
            const km = center ? this.coordinatePairDistanceKm(pin, center) : null;
            if (km !== null) {
                const warn = km > 50 ? '⚠️ ' : '';
                lines.push(`${warn}pin is ${km.toFixed(1)} km from ${cityKey} center`);
            }
        }

        // Map POI at the pin: the place name the geocoder reported AT the
        // accepted coordinates, harvested this run by OpenStreetMapNormalizer
        // (_geoPoiName / _geoPoiBarMatch — underscore fields, never serialized;
        // the match verdict comes from the normalizer's poiNameMatchesBar at
        // harvest time). Cached/skipped geocodes carry no POI → no line.
        const poiName = typeof event._geoPoiName === 'string' ? event._geoPoiName.trim() : '';
        if (poiName) {
            if (bar && event._geoPoiBarMatch === true) {
                lines.push(`map POI at pin: "${poiName}" — ✓ matches bar`);
            } else if (bar && event._geoPoiBarMatch === false) {
                lines.push(`map POI at pin: "${poiName}" — ⚠️ differs from bar "${bar}"`);
            } else {
                lines.push(`map POI at pin: "${poiName}"`);
            }
        }

        // Venue-name fusion flag from the geocode venue lookup
        // (_geoPoiFusion — underscore field, never serialized; set by
        // OpenStreetMapNormalizer.maybeFlagVenueNameFusion when a map POI
        // matched only a PREFIX of the bar name). Flag-only: verify manually.
        const fusion = event._geoPoiFusion && typeof event._geoPoiFusion === 'object' ? event._geoPoiFusion : null;
        const fusionPoi = fusion && typeof fusion.poi === 'string' ? fusion.poi.trim() : '';
        if (bar && fusionPoi) {
            const fusionPrefix = typeof fusion.prefix === 'string' ? fusion.prefix.trim() : '';
            lines.push(`⚠️ bar "${bar}" may fuse venue names — map knows "${fusionPoi}"${fusionPrefix ? ` (matches "${fusionPrefix}")` : ''}`);
        }

        // Bar corroboration verdict from barSource provenance.
        const barSource = typeof event.barSource === 'string' ? event.barSource.trim() : '';
        if (bar && barSource) {
            if (['page-adjacent', 'venue-site', 'geo-poi', 'curated', 'venue-site-identity'].includes(barSource)) {
                lines.push(`bar corroborated: ${barSource}`);
            } else if (barSource === 'uncorroborated') {
                lines.push('⚠️ bar uncorroborated (not found near address in source)');
            }
        }

        // Evidence-pointer rescue candidates from the AI evidence gate
        // (_evidenceRescues — underscore field, never serialized; stamped by
        // AiWebParser.extractSingleEvent). LOG-ONLY observation phase: the
        // gate dropped these fields, so the event shows no value — each line
        // surfaces what the rescue WOULD have adopted so real runs can prove
        // or damn the heuristic before promotion.
        const evidenceRescues = Array.isArray(event._evidenceRescues) ? event._evidenceRescues : [];
        evidenceRescues.forEach(rescue => {
            if (!rescue || typeof rescue !== 'object') return;
            const rescueField = typeof rescue.field === 'string' ? rescue.field.trim() : '';
            const rescueCandidate = typeof rescue.candidate === 'string' ? rescue.candidate.trim() : '';
            if (!rescueField || !rescueCandidate) return;
            const rescueModelValue = typeof rescue.modelValue === 'string' ? rescue.modelValue.trim() : '';
            lines.push(`${rescueField} rescue candidate (log-only): "${rescueCandidate}"${rescueModelValue ? ` — model wrote "${rescueModelValue}"` : ''}`);
        });

        // Overlong-field trim outcomes (_fieldTrims — underscore field, never
        // serialized; stamped by trimOverlongFieldsForEvent). Rendered so
        // every trim / would-trim / failed-gate outcome stays visible in the
        // results UI next to the value it describes.
        const fieldTrims = Array.isArray(event._fieldTrims) ? event._fieldTrims : [];
        fieldTrims.forEach(trim => {
            if (!trim || typeof trim !== 'object') return;
            const trimField = typeof trim.field === 'string' ? trim.field.trim() : '';
            if (!trimField) return;
            if (trim.status === 'trimmed') {
                lines.push(`${trimField} trimmed: ${trim.originalLength} → ${trim.trimmedLength} chars — "${trim.trimmedValue}"`);
            } else if (trim.status === 'would-trim') {
                lines.push(`${trimField} would trim: ${trim.originalLength} → ${trim.trimmedLength} chars — "${trim.trimmedValue}" (report mode)`);
            } else if (trim.status === 'failed-gate') {
                lines.push(`⚠️ ${trimField} overlong (${trim.originalLength} > ${trim.maxChars} chars) — trim failed verbatim gate, original kept`);
            }
        });

        // Deterministic bar-convergence rescue (_barRescue — underscore
        // field, never serialized; stamped by ai-web-parser's
        // applyBarConvergenceRescue when extraction produced no bar and a
        // candidate converged on >= 2 independent signals out of curated /
        // page / ocr). Rendered so a rescued bar is always visible in the
        // results UI.
        const barRescue = event._barRescue && typeof event._barRescue === 'object' ? event._barRescue : null;
        if (bar && barRescue) {
            const rescueSignals = Array.isArray(barRescue.signals)
                ? barRescue.signals.filter(signal => typeof signal === 'string' && signal.trim())
                : [];
            const suffix = rescueSignals.length > 0 ? ` (${rescueSignals.join(', ')})` : '';
            lines.push(`bar rescued by signal convergence${suffix}`);
        }

        // Venue-site identity correction (_venueIdentityCorrection —
        // underscore field, never serialized; stamped by ai-web-parser's
        // applyVenueSiteIdentityCorrections when an established site identity
        // replaced an extracted flyer-subtitle bar) — rendered so every
        // correction stays visible in the results UI.
        const identityCorrection = event._venueIdentityCorrection && typeof event._venueIdentityCorrection === 'object'
            ? event._venueIdentityCorrection : null;
        if (bar && identityCorrection) {
            const correctedOriginal = typeof identityCorrection.original === 'string'
                ? identityCorrection.original.trim() : '';
            const correctedSource = typeof identityCorrection.originalSource === 'string' && identityCorrection.originalSource.trim()
                ? identityCorrection.originalSource.trim() : 'unstamped';
            if (correctedOriginal) {
                lines.push(`bar corrected to venue-site identity — extracted "${correctedOriginal}" (${correctedSource})`);
            }
        }

        // Compact provenance summary of whichever companion stamps exist.
        const provenance = [
            ['bar', 'barSource'],
            ['pin', 'pinSource'],
            ['address', 'addressSource'],
            ['image', 'imageSource'],
            ['bear', 'bearSource']
        ]
            .map(([label, field]) => {
                const value = typeof event[field] === 'string' ? event[field].trim() : '';
                return value ? `${label}=${value}` : '';
            })
            .filter(Boolean);
        if (provenance.length > 0) {
            lines.push(`provenance: ${provenance.join(', ')}`);
        }

        return lines;
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
        const globalOcr = globalConfig.ocr && typeof globalConfig.ocr === 'object' ? globalConfig.ocr : null;
        const globalBlockedPatterns = Array.isArray(globalConfig.discoveryBlockedPatterns) && globalConfig.discoveryBlockedPatterns.length > 0
            ? globalConfig.discoveryBlockedPatterns
            : null;

        // bearCheck is read from `<parser>.ai.bearCheck`, but geocodeVerification
        // (a sibling {mode} knob) is read from the top-level `config`, so a
        // top-level `config.bearCheck` is an easy and reasonable mistake. Accept
        // it as an alias for `config.ai.bearCheck`: fold it into the global ai
        // block when the canonical nested location didn't set one. Canonical
        // `config.ai.bearCheck` wins over the top-level alias; a per-parser
        // `ai.bearCheck` still wins over both via the deepMergeConfig below.
        const rawGlobalAi = globalConfig.ai && typeof globalConfig.ai === 'object' ? globalConfig.ai : null;
        const topLevelBearCheck = globalConfig.bearCheck && typeof globalConfig.bearCheck === 'object'
            ? globalConfig.bearCheck
            : null;
        let globalAi = rawGlobalAi;
        if (topLevelBearCheck && !(rawGlobalAi && rawGlobalAi.bearCheck)) {
            globalAi = { ...(rawGlobalAi || {}), bearCheck: topLevelBearCheck };
        }

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

    // ------------------------------------------------------------------
    // Active-config summary for the results UI: pure builders that turn the
    // loaded scraper config into (a) the effective global run settings, (b)
    // per-parser override diffs against those settings, and (c) a redacted
    // JSON payload for the copy button. No I/O, no platform APIs.
    // ------------------------------------------------------------------

    // Recursive secret scrub: any key that looks credential-shaped is masked.
    // Applied before render AND before the copy payload is built.
    redactConfigSecrets(obj) {
        if (Array.isArray(obj)) {
            return obj.map(item => this.redactConfigSecrets(item));
        }
        if (!obj || typeof obj !== 'object' || obj instanceof RegExp) {
            return obj;
        }
        const redacted = {};
        for (const [key, value] of Object.entries(obj)) {
            redacted[key] = /key|secret|token|password|authorization/i.test(key)
                ? '•••'
                : this.redactConfigSecrets(value);
        }
        return redacted;
    }

    // Dotted-key flattener for override diffs: plain objects are walked,
    // everything else (arrays, regexes) is stringified into a single leaf.
    flattenConfigForDiff(obj, prefix = '') {
        const flat = {};
        if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj instanceof RegExp) {
            return flat;
        }
        for (const [key, value] of Object.entries(obj)) {
            const dottedKey = prefix ? `${prefix}.${key}` : key;
            if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RegExp)) {
                Object.assign(flat, this.flattenConfigForDiff(value, dottedKey));
            } else if (Array.isArray(value) || value instanceof RegExp) {
                flat[dottedKey] = String(value);
            } else {
                flat[dottedKey] = value;
            }
        }
        return flat;
    }

    // { global, parsers, json }: global = values-only effective run settings,
    // parsers = per-entry override diffs (ONLY explicitly-set values that
    // differ from the global effective value), json = the redacted copy
    // payload. Both returned structures are already redacted.
    buildActiveConfigSummary(scraperConfig) {
        const globalConfig = scraperConfig && scraperConfig.config && typeof scraperConfig.config === 'object'
            ? scraperConfig.config
            : {};
        const rawGlobalAi = globalConfig.ai && typeof globalConfig.ai === 'object' ? globalConfig.ai : {};
        const rawGlobalOcr = globalConfig.ocr && typeof globalConfig.ocr === 'object' ? globalConfig.ocr : {};
        const resolvedAi = this.resolveAiConfig(rawGlobalAi);
        const pageCache = globalConfig.pageCache && typeof globalConfig.pageCache === 'object' ? globalConfig.pageCache : {};
        const pageCacheTtl = Number(pageCache.ttlDays);
        const geocodeVerification = globalConfig.geocodeVerification && typeof globalConfig.geocodeVerification === 'object'
            ? globalConfig.geocodeVerification
            : {};
        // Same top-level bearCheck alias fold resolveEffectiveParserConfig does
        const bearCheckAi = rawGlobalAi.bearCheck || !globalConfig.bearCheck
            ? rawGlobalAi
            : { ...rawGlobalAi, bearCheck: globalConfig.bearCheck };

        const global = {
            daysToLookAhead: globalConfig.daysToLookAhead !== undefined ? globalConfig.daysToLookAhead : null,
            dryRun: globalConfig.dryRun === true,
            pageCache: {
                enabled: pageCache.enabled === true,
                ttlDays: Number.isFinite(pageCacheTtl) && pageCacheTtl > 0 ? pageCacheTtl : 3
            },
            geocodeVerification: {
                mode: String(geocodeVerification.mode || 'report')
            },
            ai: {
                enabled: resolvedAi.enabled,
                endpoint: resolvedAi.endpoint,
                model: resolvedAi.model,
                provider: resolvedAi.provider,
                payloadMode: resolvedAi.payloadMode,
                numCtx: resolvedAi.numCtx,
                numPredict: resolvedAi.numPredict,
                temperature: resolvedAi.temperature,
                timeoutSeconds: resolvedAi.timeoutSeconds,
                cacheEnabled: resolvedAi.cacheEnabled,
                arbitrateMerges: resolvedAi.arbitrateMerges,
                bearCheck: { mode: this.getBearCheckMode({ ai: bearCheckAi }) },
                trim: this.getTrimConfig({ ai: rawGlobalAi })
            },
            ocr: {
                enabled: rawGlobalOcr.enabled === true,
                endpoint: typeof rawGlobalOcr.endpoint === 'string' ? rawGlobalOcr.endpoint : '',
                model: typeof rawGlobalOcr.model === 'string' ? rawGlobalOcr.model : '',
                maxImages: Number.isFinite(Number(rawGlobalOcr.maxImages)) ? Number(rawGlobalOcr.maxImages) : null,
                cache: rawGlobalOcr.cache !== false,
                cacheRetentionDays: Number.isFinite(Number(rawGlobalOcr.cacheRetentionDays)) ? Number(rawGlobalOcr.cacheRetentionDays) : 90
            }
        };

        // Comparison base for override diffs: raw global keys win (they share
        // the parser blocks' key space exactly); the resolved effective values
        // fill in for keys the raw global config never set.
        const globalComparisonFlat = {
            ...this.flattenConfigForDiff({ ai: global.ai, ocr: global.ocr }),
            ...this.flattenConfigForDiff({ ai: rawGlobalAi, ocr: rawGlobalOcr })
        };
        const scalarKnobs = ['alwaysBear', 'siteRole', 'dryRun', 'daysToLookAhead', 'urlDiscoveryDepth',
            'maxAdditionalUrls', 'discoveryOnly', 'calendarSearchRangeDays'];

        const parsers = (Array.isArray(scraperConfig && scraperConfig.parsers) ? scraperConfig.parsers : [])
            .filter(entry => entry && typeof entry === 'object')
            .map(entry => {
                const overrides = {};
                for (const knob of scalarKnobs) {
                    if (!Object.prototype.hasOwnProperty.call(entry, knob)) continue;
                    const value = entry[knob];
                    const globalValue = Object.prototype.hasOwnProperty.call(globalConfig, knob)
                        ? globalConfig[knob]
                        : undefined;
                    if (value === globalValue) continue;
                    overrides[knob] = { value, globalValue };
                }
                const parserBlockFlat = {
                    ...this.flattenConfigForDiff(entry.ai && typeof entry.ai === 'object' ? entry.ai : {}, 'ai'),
                    ...this.flattenConfigForDiff(entry.ocr && typeof entry.ocr === 'object' ? entry.ocr : {}, 'ocr')
                };
                for (const [key, value] of Object.entries(parserBlockFlat)) {
                    const globalValue = globalComparisonFlat[key];
                    if (value === globalValue) continue;
                    overrides[key] = { value, globalValue };
                }
                return {
                    name: typeof entry.name === 'string' ? entry.name : '',
                    enabled: entry.enabled === true,
                    urls: Array.isArray(entry.urls) ? entry.urls.map(url => String(url)) : [],
                    parser: typeof entry.parser === 'string' ? entry.parser : '',
                    overrides
                };
            });

        const redacted = this.redactConfigSecrets({ global, parsers });
        return {
            global: redacted.global,
            parsers: redacted.parsers,
            json: JSON.stringify(redacted, null, 2)
        };
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
        discoveryTreeCollector = null,
        // Enrich-only ticket crawl: pages reached via an event-page's follow
        // links (rule-classified event links + extracted ticketUrls) may only
        // ENRICH the originating event, never spawn new events. Keyed by URL
        // dedupe key → { parentEvents, parentTitle, parentUrl }.
        enrichOnlyByUrl = null,
        enrichDropCollector = null
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

            // Processing-time hygiene for DISCOVERED URLs (configured roots are
            // left alone): both checks run against the normalized URL that is
            // about to be fetched, because enqueue-time filtering sees the raw
            // discovered string, which can differ (entity-mangled tails).
            if (currentDepth > 0 && this.isStaticAssetUrl(url)) {
                await displayAdapter.logInfo(`SYSTEM: Skipping static-asset URL in crawl queue: ${url}`);
                continue;
            }
            if (currentDepth > 0) {
                const deadEndEntry = this.getSkippableDeadEndEntry(url, discoveryOnly);
                if (deadEndEntry) {
                    await displayAdapter.logInfo(`SYSTEM: Skipping known dead-end URL (${Number(deadEndEntry.misses) || 0} prior misses): ${url}`);
                    continue;
                }
            }

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

                // Observability: which extraction pathway produced this page's
                // events (structured json-api/jsonld fast path vs AI), with the
                // AI-pass and OCR-image counts the parser reported. Additive —
                // parsers that don't report a summary log nothing extra.
                const extractionSummary = !discoveryOnly
                    && parseResult && parseResult.extractionSummary && typeof parseResult.extractionSummary === 'object'
                    ? parseResult.extractionSummary
                    : null;
                if (extractionSummary && extractionSummary.source) {
                    await displayAdapter.logInfo(`SYSTEM: ${url} extraction summary: source=${extractionSummary.source}, aiPasses=${Number(extractionSummary.aiPasses) || 0}, ocrImages=${Number(extractionSummary.ocrImages) || 0} → ${eventCount} event${eventCount === 1 ? '' : 's'}`);
                }

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

                const enrichContext = !discoveryOnly && enrichOnlyByUrl
                    ? (enrichOnlyByUrl[this.getUrlDedupeKey(url)] || null)
                    : null;

                let pageEventsForEnrich = [];
                if (!discoveryOnly) {
                    let parsedEvents = await this.prepareParsedEvents(parseResult?.events, parserConfig, mainConfig, pageClassification, this.normalizerPipeline, httpAdapter);
                    // Each event remembers the page it was actually extracted from
                    // (underscore field: never serialized into notes/schema). The
                    // bear-check provenance uses it for honest cross-host wording.
                    parsedEvents.forEach(event => {
                        if (!event._sourcePageUrl) {
                            event._sourcePageUrl = url;
                        }
                    });
                    if (enrichContext && parsedEvents.length > 0) {
                        // Enrich-only page: keep ONLY events that are the same event
                        // as the originating (parent) event — same identity predicate
                        // the parser-level dedup uses — and drop the venue's sibling
                        // events (they belong to the venue calendar, not this source).
                        const keptEvents = [];
                        const droppedEvents = [];
                        for (const childEvent of parsedEvents) {
                            const matchesParent = enrichContext.parentEvents.some(parentEvent =>
                                this.getSameEventIdentitySignal(childEvent, parentEvent, { requireCloseStartTimes: false }));
                            (matchesParent ? keptEvents : droppedEvents).push(childEvent);
                        }
                        if (droppedEvents.length > 0) {
                            const childHost = this.getHostFromUrl(url) || url;
                            await displayAdapter.logInfo(`SYSTEM: Enrich-only crawl: kept ${keptEvents.length} matching event(s), dropped ${droppedEvents.length} sibling event(s) from ${childHost} (reached via ticket link from "${enrichContext.parentTitle}")`);
                            if (enrichDropCollector) {
                                enrichDropCollector.push({
                                    host: childHost,
                                    url,
                                    parentTitle: enrichContext.parentTitle,
                                    parentUrl: enrichContext.parentUrl,
                                    keptCount: keptEvents.length,
                                    droppedEvents: droppedEvents.map(event => ({
                                        title: event.title || 'Untitled event',
                                        startDate: event.startDate
                                    }))
                                });
                            }
                        }
                        parsedEvents = keptEvents;
                    }
                    if (parsedEvents.length > 0) {
                        allEvents.push(...parsedEvents);
                    }
                    pageEventsForEnrich = parsedEvents;
                }

                const additionalLinks = parseResult?.additionalLinks || [];
                let linksToConsider = additionalLinks;
                // Tracks whether an adaptive-mode branch below already logged WHY
                // links are not being followed (enrich-only / chain cap), so the
                // following/stopping logs further down don't double-report.
                let adaptiveFollowBlocked = false;
                if (adaptiveCrawl) {
                    // The page's own classification decides which links (if any)
                    // are followed; a hard hop cap bounds runaway chains.
                    linksToConsider = this.selectAdaptiveFollowLinks(pageClassification, additionalLinks, parseResult, url);
                    if (enrichContext) {
                        // No fan-out from enrich-only pages: a venue calendar reached
                        // through a ticket link must never seed further crawling.
                        if (linksToConsider.length > 0) {
                            await displayAdapter.logInfo(`SYSTEM: Enrich-only crawl: not following ${linksToConsider.length} link(s) from ${url}`);
                        }
                        linksToConsider = [];
                        adaptiveFollowBlocked = true;
                    } else if (linksToConsider.length > 0 && currentDepth >= ADAPTIVE_CRAWL_MAX_HOPS) {
                        await displayAdapter.logInfo(`SYSTEM: Adaptive crawl: chain cap (${ADAPTIVE_CRAWL_MAX_HOPS} hops) reached at ${url} — not following ${linksToConsider.length} link(s)`);
                        linksToConsider = [];
                        adaptiveFollowBlocked = true;
                    }
                }
                const shouldFollowLinks = adaptiveCrawl || currentDepth < maxDepth;
                // Cross-host crawl scoping (generic — BEEFMINCE run 20260729-100804:
                // dice.fm's promoter page exposed platform chrome that the adaptive
                // crawl followed to the geolocated NYC browse catalog): crossing to
                // a registrable domain outside the parser's configured URLs consumes
                // the crawl's trust — see applyCrossHostCrawlScope for the rule.
                // Adaptive event-pages whose links go enrich-only are exempt: their
                // selection is already narrowed to rule-classified event links plus
                // their own ticketUrls, and enrich-only children can neither spawn
                // events nor fan out.
                const adaptiveEnrichOnlyEventPage = adaptiveCrawl && pageClassification === 'event-page'
                    && (discoveryOnly || pageEventsForEnrich.length > 0);
                if (linksToConsider.length > 0 && shouldFollowLinks && !adaptiveEnrichOnlyEventPage) {
                    const scope = this.applyCrossHostCrawlScope(linksToConsider, url, parserConfig);
                    if (scope.rejected.length > 0) {
                        for (const rejection of scope.rejected) {
                            await displayAdapter.logInfo(`SYSTEM: Cross-host scope: rejecting ${rejection.url} from ${url} — ${rejection.detail} (cross-host-scope)`);
                        }
                        await displayAdapter.logInfo(`SYSTEM: Cross-host crawl scope at ${url} (host ${scope.pageDomain}, configured ${scope.configuredDomains.join(', ')}): kept ${scope.allowed.length} of ${linksToConsider.length} link(s), rejected ${scope.rejected.length} (cross-host-scope)`);
                        linksToConsider = scope.allowed;
                    }
                }
                if (adaptiveCrawl && !adaptiveFollowBlocked) {
                    if (linksToConsider.length > 0) {
                        await displayAdapter.logInfo(`SYSTEM: Adaptive crawl: following ${linksToConsider.length} links from ${url} (${pageClassification})`);
                    } else if (additionalLinks.length > 0) {
                        await displayAdapter.logInfo(`SYSTEM: Adaptive crawl: stopping at ${url} (${pageClassification})`);
                    }
                }
                if (linksToConsider.length === 0) {
                    continue;
                }

                const deduplicatedUrls = this.deduplicateUrls(linksToConsider, processedUrls);

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
                        // Links followed FROM an event-page (rule-classified event
                        // links + extracted ticketUrls) are enrich-only for the
                        // page's own event(s): child pages may confirm/enrich that
                        // event but never contribute unrelated sibling events.
                        let childEnrichOnlyByUrl = null;
                        if (adaptiveCrawl && !discoveryOnly && pageClassification === 'event-page' && pageEventsForEnrich.length > 0) {
                            childEnrichOnlyByUrl = {};
                            const parentTitle = pageEventsForEnrich[0].title || 'event';
                            for (const enqueueUrl of enqueueUrls) {
                                const enqueueKey = this.getUrlDedupeKey(enqueueUrl);
                                if (enqueueKey) {
                                    childEnrichOnlyByUrl[enqueueKey] = {
                                        parentEvents: pageEventsForEnrich,
                                        parentTitle,
                                        parentUrl: url
                                    };
                                }
                            }
                        }
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
                            discoveryTreeCollector,
                            enrichOnlyByUrl: childEnrichOnlyByUrl,
                            enrichDropCollector
                        });
                    }
                } else {
                    await displayAdapter.logInfo(`SYSTEM: Crawl page ${url} found ${deduplicatedUrls.length} unique additional URLs, but depth limit (${maxDepth}) reached or URL discovery disabled - ignoring`);
                }
            } catch (error) {
                const message = error?.message || 'Unknown error';
                // Bot-wall responses (401/403) are permanent for this client:
                // learn them as dead ends so later runs skip the fetch entirely.
                // Generic status check — no host list. Cached-failure replays
                // count too (the failure cache would otherwise mask the store
                // from ever learning the URL).
                const failureStatusCode = this.extractHttpStatusCodeFromError(error);
                if (failureStatusCode === 403 || failureStatusCode === 401) {
                    this.recordDeadEndFetchFailure({ url, currentDepth, statusCode: failureStatusCode });
                }
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
    // Cross-host crawl scoping (generic — no per-site rules).
    // Crossing to a registrable domain outside the parser's configured URLs
    // consumes the crawl's trust: pages on a configured domain may discover
    // anything (that hop IS discovery), but on a page whose registrable
    // domain matches no configured URL only links that
    //   (a) point BACK to a configured domain, or
    //   (b) stay on the page's own domain AND are event-DETAIL-shaped —
    //       URL-rule classified 'event-page', an event-detail path
    //       (/event/<slug> and friends), or sharing the page's own first
    //       path segment (path-similar continuation)
    // may be followed. A cross-host page can never lead to ANOTHER new
    // registrable domain. Evidence: BEEFMINCE run 20260729-100804, where
    // dice.fm's promoter page (correct, 9 real events) fanned out through
    // help/terms chrome into the geolocated NYC browse catalog (~14
    // unrelated events in the CREATE plan).
    // ------------------------------------------------------------------

    // Registrable-domain approximation (platform-pure, no URL global):
    // hostname lowercased, port and leading www. stripped; last two labels,
    // or three when the second-level label is a common short registry suffix
    // under a 2-letter ccTLD (co.uk, com.au, ...). Duplicated in
    // ai-web-parser (parsers are standalone and cannot import shared code) —
    // keep the two in sync.
    getRegistrableDomainFromUrl(url) {
        const host = String(this.getHostFromUrl(url) || '')
            .toLowerCase()
            .split(':')[0]
            .replace(/^www\./, '')
            .replace(/\.$/, '');
        if (!host || !host.includes('.')) return host;
        // IP literals have no registrable domain — compare them whole
        if (/^[\d.]+$/.test(host) || host.includes('[')) return host;
        const labels = host.split('.').filter(Boolean);
        if (labels.length <= 2) return labels.join('.');
        const tld = labels[labels.length - 1];
        const sld = labels[labels.length - 2];
        const compoundSuffix = tld.length === 2 && /^(?:co|com|net|org|gov|edu|ac|mil|sch)$/.test(sld);
        return labels.slice(compoundSuffix ? -3 : -2).join('.');
    }

    // First path segment of an absolute http(s) URL, lowercased ('' when the
    // URL has no path or is not absolute http(s)).
    getFirstPathSegmentFromUrl(url) {
        const match = String(url || '').match(/^https?:\/\/[^/?#]+\/([^/?#]+)/i);
        return match ? match[1].toLowerCase() : '';
    }

    // Generic event-detail URL shape: an absolute http(s) URL whose path is
    // an event noun segment followed by a concrete slug (/event/<slug>,
    // /events/<slug>, /e/<id>, /show/<slug>, /tickets/<slug>). Platform-
    // agnostic on purpose — no host names.
    isEventDetailShapedUrl(url) {
        const match = String(url || '').match(/^https?:\/\/[^/?#]+(\/[^?#]*)/i);
        const path = match ? match[1] : '';
        return /^\/(?:events?|e|shows?|tickets?)\/[^/?#]+/i.test(path);
    }

    // Apply the cross-host crawl scope to a page's follow candidates.
    // Returns { pageIsCrossHost, pageDomain, configuredDomains, allowed,
    // rejected: [{ url, detail }] }. Pages on a configured registrable domain
    // (or runs with no configured URLs, e.g. inline input) pass everything
    // through untouched.
    applyCrossHostCrawlScope(links, pageUrl, parserConfig) {
        const list = Array.isArray(links) ? links : [];
        const configuredUrls = Array.isArray(parserConfig && parserConfig.urls) ? parserConfig.urls : [];
        const configuredDomains = [];
        for (const configuredUrl of configuredUrls) {
            const domain = this.getRegistrableDomainFromUrl(configuredUrl);
            if (domain && !configuredDomains.includes(domain)) {
                configuredDomains.push(domain);
            }
        }
        const pageDomain = this.getRegistrableDomainFromUrl(pageUrl);
        const result = {
            pageIsCrossHost: false,
            pageDomain,
            configuredDomains,
            allowed: list,
            rejected: []
        };
        if (!pageDomain || configuredDomains.length === 0 || configuredDomains.includes(pageDomain)) {
            return result;
        }
        result.pageIsCrossHost = true;
        const pageFirstSegment = this.getFirstPathSegmentFromUrl(this.normalizeUrl(pageUrl, pageUrl) || pageUrl);
        const allowed = [];
        const rejected = [];
        for (const link of list) {
            const normalized = this.normalizeUrl(link, pageUrl || link) || String(link || '');
            const linkDomain = this.getRegistrableDomainFromUrl(normalized);
            if (linkDomain && configuredDomains.includes(linkDomain)) {
                // Pointing back to a configured host is always in scope
                allowed.push(link);
                continue;
            }
            if (linkDomain !== pageDomain) {
                rejected.push({ url: link, detail: `links to a third host (${linkDomain || 'unknown host'})` });
                continue;
            }
            const ruleClassification = this.classifyUrlByRules(normalized);
            const eventDetailShaped = ruleClassification === 'event-page'
                || this.isEventDetailShapedUrl(normalized)
                || (Boolean(pageFirstSegment) && this.getFirstPathSegmentFromUrl(normalized) === pageFirstSegment);
            if (eventDetailShaped) {
                allowed.push(link);
            } else {
                rejected.push({ url: link, detail: 'not event-detail-shaped on an off-host page' });
            }
        }
        result.allowed = allowed;
        result.rejected = rejected;
        return result;
    }

    // ------------------------------------------------------------------
    // Learned dead-end store (pure logic — persistence lives in adapters).
    // A URL is a dead end only if it FETCHED successfully AND produced 0 raw
    // events (pre future/bear filtering), 0 segments, AND 0 valid discovered
    // links. Fetch failures are never dead-ended, with one exception: bot-wall
    // statuses (401/403) are recorded via recordDeadEndFetchFailure below.
    // Configured root URLs are never dead-ended.
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

    // Processing-time twin of filterKnownDeadEndUrls for a single URL: the
    // enqueue-time filter keys the store by the QUEUED string, but the crawl
    // loop fetches the string after another normalizeUrl pass — when the two
    // differ (entity-mangled candidates), a recorded dead end sails through
    // the enqueue filter. Re-checking here against the fetch-time URL closes
    // that gap (run 20260724-161423: dead-ends.json held the exact .webp URLs
    // with misses: 3 and they were still refetched every run).
    getSkippableDeadEndEntry(url, discoveryOnly = false, nowMs = Date.now()) {
        const context = this.deadEndRunContext;
        if (!context || !context.enabled || discoveryOnly || !url) {
            return null;
        }
        const entry = context.store[url];
        const lastSeenMs = entry && entry.lastSeen ? Date.parse(entry.lastSeen) : NaN;
        const retryMs = context.retryDays * 24 * 60 * 60 * 1000;
        if (entry && Number.isFinite(lastSeenMs) && (nowMs - lastSeenMs) < retryMs) {
            context.skippedCount += 1;
            if (context.skippedSamples.length < 3 && !context.skippedSamples.includes(url)) {
                context.skippedSamples.push(url);
            }
            return entry;
        }
        return null;
    }

    // Learned dead ends from FETCH FAILURES are limited to statuses that are
    // effectively permanent for this client (bot walls: 401/403 — e.g. tixr.com
    // 403'd every one of its event pages in run 20260724-161423 and always
    // will). Other failures stay un-learned: they may be transient and the
    // non-retryable failure cache already throttles them. Entries share the
    // normal store retention (retryDays window, pruned at 2×), so a page that
    // ever recovers self-heals out via recordDeadEndObservation. This only
    // stops CRAWLING such URLs — ticketUrl fields on events are untouched.
    recordDeadEndFetchFailure({ url, currentDepth, statusCode, nowMs = Date.now() }) {
        const context = this.deadEndRunContext;
        if (!context || !context.enabled || !url) {
            return;
        }
        if (currentDepth === 0) {
            // Configured root URLs are never dead-ended
            return;
        }
        const nowIso = new Date(nowMs).toISOString();
        const entry = context.store[url];
        if (entry) {
            entry.lastSeen = nowIso;
            entry.misses = (Number(entry.misses) || 0) + 1;
            entry.lastStatus = statusCode;
            context.dirty = true;
        } else {
            context.store[url] = { firstSeen: nowIso, lastSeen: nowIso, misses: 1, lastStatus: statusCode };
            context.dirty = true;
            context.learned.push(url);
        }
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

    // Host portion of an http(s) URL ('' when absent). Regex, not `new URL`
    // (iOS JavaScriptCore has no URL global).
    getHostFromUrl(url) {
        const match = String(url || '').match(/^https?:\/\/([^/?#]+)/i);
        return match ? match[1] : '';
    }

    // Hosts compared case-insensitively with a leading "www." ignored, so
    // www.bearracuda.com and bearracuda.com count as the same site.
    areUrlHostsSameSite(hostA, hostB) {
        const normalize = (host) => String(host || '').toLowerCase().replace(/^www\./, '');
        const a = normalize(hostA);
        const b = normalize(hostB);
        return Boolean(a) && a === b;
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
            const trimmed = String(normalized).trim().replace(/#.*$/, '').replace(/^(https?:\/\/)www\./i, '$1');
            const queryIndex = trimmed.indexOf('?');
            const path = (queryIndex >= 0 ? trimmed.slice(0, queryIndex) : trimmed).replace(/\/$/, '');
            const search = queryIndex >= 0 ? this.stripTrackingSearch(trimmed.slice(queryIndex)) : '';
            return `${path || '/'}${search}`.toLowerCase();
        }

        const protocol = String(parsed.protocol || '').toLowerCase();
        // www and bare-host variants of the same page are the same page —
        // the crawl queue must not fetch https://www.X/p and https://X/p twice
        // (run 20260724-161423 crawled both massive.club variants separately).
        // Only the DEDUP KEY is normalized; callers keep the original URL
        // string for fetching and cache keys.
        const host = String(parsed.host || parsed.hostname || '').toLowerCase().replace(/^www\./, '');
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
    async filterBearEvents(events, parserConfig, httpAdapter = null, dropCollector = null) {
        const legacyFilter = () => parserConfig.alwaysBear
            ? events.map(event => ({...event, isBearEvent: true}))
            : events.filter(event => this.isBearEvent(event, parserConfig));

        const mode = this.getBearCheckMode(parserConfig);
        if (mode === 'off') return legacyFilter();

        const tag = mode === 'report' ? ' [report]' : '';
        const counts = { bear: 0, keyword: 0, ai: 0, flagged: 0, dropped: 0 };
        const kept = [];
        for (const event of events) {
            // Trust is per-event: a registry-matched promoter's bearAffinity
            // wins over parserConfig.alwaysBear in both directions; unmatched
            // events resolve to parserConfig.alwaysBear exactly as before.
            const trusted = this.getEventBearTrust(event, parserConfig).trusted;
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
                // bearSource provenance stamp (notes-serialized like pinSource):
                // records which cascade tier produced the bear verdict so a
                // later manual override can say what it overrode.
                const bearSource = decision.provenance.startsWith('keyword:') ? 'keyword'
                    : decision.provenance.startsWith('ai:') ? 'ai'
                        : decision.provenance.startsWith('config:') ? 'config'
                            : '';
                kept.push(bearSource
                    ? {...event, isBearEvent: true, bearSource}
                    : {...event, isBearEvent: true});
            } else if (decision.result === 'not_bear' && !trusted) {
                counts.dropped++;
                console.log(`🐻 BEAR CHECK${tag}: "${title}" → DROP (${decision.provenance})`);
                // Flag, don't drop silently: enforce-mode drops are surfaced to
                // the results UI (and prep-time manual-override rescue) via the
                // caller's collector. Report mode changes nothing.
                if (dropCollector && mode === 'enforce') {
                    dropCollector.push({
                        title,
                        startDate: event.startDate || event.date || null,
                        venue: event.bar || event.venue || '',
                        reason: decision.provenance,
                        host: this.getHostFromUrl(event._sourcePageUrl || event.url || event.website || '') || '',
                        event: { ...event }
                    });
                }
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

    // Per-event trusted-promoter resolution for the bear check. A promoter
    // the registry matched (enforce-mode _promoter stamp) carries its own
    // bearAffinity, which WINS over parserConfig.alwaysBear in both
    // directions: "usually" on an alwaysBear parser → judged; "always" on an
    // untrusted parser → trusted (never-drop). Events without a matched
    // promoter (or a matched entry without bearAffinity) resolve exactly to
    // parserConfig.alwaysBear — byte-identical to the pre-registry behavior.
    getEventBearTrust(event, parserConfig) {
        const entry = this.getEventPromoterEntry(event);
        const affinity = entry && typeof entry.bearAffinity === 'string' ? entry.bearAffinity.trim().toLowerCase() : '';
        if (entry && affinity === 'always') {
            return { trusted: true, promoter: entry.name, affinity };
        }
        if (entry && affinity === 'usually') {
            return { trusted: false, promoter: entry.name, affinity };
        }
        return { trusted: parserConfig && parserConfig.alwaysBear === true, promoter: entry ? entry.name : '', affinity: '' };
    }

    // One cascade decision per event: { result: 'bear'|'not_bear'|'unsure',
    // provenance: 'keyword: ...' | 'allowlist: ...' | 'ai: ...' | 'config/fallback: ...' }.
    async computeBearCheckDecision(event, parserConfig, httpAdapter) {
        const searchText = `${event.title || ''} ${event.description || ''} ${event.bar || ''}`;

        // Per-event trust: a registry-matched promoter's bearAffinity
        // overrides parserConfig.alwaysBear (see getEventBearTrust);
        // unmatched events keep the exact legacy alwaysBear semantics.
        const trust = this.getEventBearTrust(event, parserConfig);
        const trustBypassesAllowlist = trust.affinity ? trust.trusted : Boolean(parserConfig.alwaysBear);

        // Existing allowlist gate keeps its exact legacy semantics: for
        // non-alwaysBear sources with requireKeywords, an allowlist miss
        // rejects the event before any other tier.
        if (!trustBypassesAllowlist
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

        if (trust.affinity === 'always') {
            return { result: 'bear', provenance: `config: promoter ${trust.promoter} bearAffinity=always` };
        }
        if (parserConfig.alwaysBear === true && trust.affinity !== 'usually') {
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
        // ADDITIVE matched-promoter sentence (enforce-mode registry match
        // only): the event's own content named a curated promoter, so the
        // model gets that promoter's trust context regardless of which source
        // entry the event was found through. Every pre-existing sentence
        // below stays byte-identical; this is appended after them.
        const trust = this.getEventBearTrust(event, parserConfig);
        const matchedPromoterSentence = trust.affinity === 'always'
            ? ` This event's own content names the promoter ${trust.promoter}, whom the calendar owner has marked as a trusted bear-scene promoter.`
            : trust.affinity === 'usually'
                ? ` This event's own content names the promoter ${trust.promoter}, whom the calendar owner tracks as a usually-bear promoter — judge this event on its own content.`
                : '';

        // Honest cross-host provenance: when the event was actually extracted
        // from a page on a DIFFERENT site than the parser's configured host(s)
        // (e.g. a venue calendar reached via a ticket link), say so — otherwise
        // the model wrongly trusts the source entry's promoter framing for
        // events that promoter never produced.
        const actualPageUrl = typeof event._sourcePageUrl === 'string' ? event._sourcePageUrl : '';
        const actualHost = this.getHostFromUrl(actualPageUrl);
        const configuredUrls = Array.isArray(parserConfig.urls) ? parserConfig.urls : [];
        const configuredHosts = configuredUrls.map(configuredUrl => this.getHostFromUrl(configuredUrl)).filter(Boolean);
        const isCrossHost = Boolean(actualHost) && configuredHosts.length > 0 &&
            !configuredHosts.some(configuredHost => this.areUrlHostsSameSite(actualHost, configuredHost));
        if (isCrossHost) {
            let crossProvenance = `extracted from ${actualHost}, a page discovered while crawling source entry "${parserConfig.name || 'unknown'}" (${configuredHosts[0]}). The source entry's promoter did NOT necessarily produce this event — judge by the event content and the hosting site.`;
            if (parserConfig.alwaysBear === true) {
                crossProvenance += " The calendar owner has marked the source entry's promoter as a trusted bear-scene promoter, but that trust only covers that promoter's own events.";
            }
            return crossProvenance + matchedPromoterSentence;
        }

        const sourceUrl = String(event.url || event.website || (parserConfig.urls && parserConfig.urls[0]) || '');
        const hostMatch = sourceUrl.match(/^https?:\/\/([^/?#]+)/i);
        const origin = hostMatch ? hostMatch[1] : (sourceUrl || 'unknown source');
        let provenance = `Scraped from ${origin}, source entry "${parserConfig.name || 'unknown'}".`;
        // A matched "usually" promoter overrides the parser-level trust in the
        // judged direction — asserting owner trust here would defeat the
        // per-event judgment. Unmatched events keep the sentence exactly as
        // before; the sentence's wording never changes.
        if (parserConfig.alwaysBear === true && trust.affinity !== 'usually') {
            provenance += ' The calendar owner has marked this promoter as a trusted bear-scene promoter.';
        }
        return provenance + matchedPromoterSentence;
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
        // The actual source host is part of the key: provenance wording differs
        // for cross-host events, so verdicts must not be shared across hosts.
        const memoHost = this.getHostFromUrl(typeof event._sourcePageUrl === 'string' ? event._sourcePageUrl : '');
        // Provenance wording also depends on a matched promoter's bearAffinity
        // (the additive registry sentence), so matched events get their own
        // memo basis; unmatched events keep the exact pre-registry key.
        const memoTrust = this.getEventBearTrust(event, parserConfig);
        const memoPromoterPart = memoTrust.affinity ? `|promoter:${memoTrust.promoter}:${memoTrust.affinity}` : '';
        const memoKey = `${title}|${description}|${bar}|${memoHost}${memoPromoterPart}`;
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

    // ------------------------------------------------------------------
    // Overlong-field trim pipeline: scraped title/description/shortName
    // values that exceed their display limits are shortened by ONE batched
    // AI call per event — answers are accepted only when they are VERBATIM
    // contiguous substrings of the original (never paraphrase, never a
    // deterministic mid-word truncation). Mode knob (parserConfig.ai.trim.mode):
    // 'report' (default) logs would-trim decisions without changing values;
    // 'enforce' replaces the value; 'off' disables the pipeline entirely.
    // Calendar-sourced values are never AI-trimmed (see
    // buildAnalyzedCalendarEvent's detection-only evidence line).
    // ------------------------------------------------------------------

    // { mode, limits: { title, description, shortName } } from
    // parserConfig.ai.trim. Mirrors getBearCheckMode: unset/invalid → 'report'.
    getTrimConfig(parserConfig) {
        const trim = parserConfig && parserConfig.ai && parserConfig.ai.trim && typeof parserConfig.ai.trim === 'object'
            ? parserConfig.ai.trim
            : null;
        const mode = trim ? String(trim.mode || '').trim().toLowerCase() : '';
        const limitOf = (raw, fallback) => {
            const value = Number(raw);
            return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
        };
        return {
            mode: mode === 'enforce' || mode === 'off' ? mode : 'report',
            limits: {
                title: limitOf(trim && trim.titleMaxChars, 60),
                description: limitOf(trim && trim.descriptionMaxChars, 600),
                shortName: limitOf(trim && trim.shortNameMaxChars, 30)
            }
        };
    }

    // Pure detection: [{ field, value, maxChars }] for every trim-target field
    // whose trimmed string value exceeds its limit. Targets are the canonical
    // schema fields only — 'shorttitle' is a notes alias of shortName
    // (event-schema.js), so shortName is the field that exists on events.
    findOverlongFields(event, trimConfig) {
        const overlong = [];
        if (!event || typeof event !== 'object' || !trimConfig || !trimConfig.limits) return overlong;
        for (const field of ['title', 'description', 'shortName']) {
            const maxChars = trimConfig.limits[field];
            if (!Number.isFinite(maxChars) || maxChars <= 0) continue;
            const raw = event[field];
            if (raw === null || raw === undefined) continue;
            const value = String(raw).trim();
            if (value.length > maxChars) {
                overlong.push({ field, value, maxChars });
            }
        }
        return overlong;
    }

    // Prompt for one event's batched trim request. EVENT carries the title
    // only (no dates) so the AI-response cache key stays stable across runs.
    buildFieldTrimPrompt({ eventTitle, entries }) {
        const fieldLines = (Array.isArray(entries) ? entries : []).map(entry =>
            `- field: ${entry.field}\n  max_chars: ${entry.maxChars}\n  value: ${JSON.stringify(entry.value)}`
        );
        return [
            'You are shortening overlong text fields for one event.',
            `EVENT: ${eventTitle}`,
            'Each field below exceeds its maximum display length. Return a shorter version of each.',
            'FIELDS:',
            ...fieldLines,
            'Rules:',
            '- Each answer MUST be an EXACT contiguous substring of that field\'s original value — copy characters verbatim; never paraphrase, reorder, re-case, merge parts, or add words.',
            '- Each answer must be at most max_chars characters long.',
            '- For "title", keep the portion that names the event itself — drop venue, city, date, status text, and marketing phrases.',
            '- For "description", keep the most informative complete sentences; start at a sentence start and end at a natural boundary.',
            '- For "shortName", keep the shortest recognizable brand name.',
            '- Never cut a word in the middle.',
            'Return JSON only:',
            '{"trims": {"<field>": {"value": "<exact contiguous substring>", "reason": "<one short sentence>"}}}'
        ].join('\n');
    }

    // Deterministic anti-hallucination gate: an answer is usable only when it
    // is non-empty, fits the limit, is strictly shorter than the original, and
    // is a case-sensitive contiguous substring of the original value.
    isVerbatimTrimAnswer(originalValue, answerText, maxChars) {
        const answer = String(answerText === null || answerText === undefined ? '' : answerText).trim();
        if (!answer) return false;
        return answer.length <= maxChars
            && answer.length < String(originalValue).trim().length
            && String(originalValue).includes(answer);
    }

    // ONE AI call per event batching all overlong fields (passLabel
    // 'field-trim', same callAiGenerate path arbitration uses — so the
    // response cache applies). Gate pass + mode 'enforce' → value replaced;
    // mode 'report' → value kept; gate fail / no answer → value kept. Every
    // outcome is recorded on event._fieldTrims for evidence-line rendering.
    // NEVER falls back to deterministic mid-word truncation.
    async trimOverlongFieldsForEvent(event, trimConfig, aiConfig, httpAdapter) {
        const overlong = this.findOverlongFields(event, trimConfig);
        if (overlong.length === 0) return [];

        const title = String(event.title || 'Unknown');
        const prompt = this.buildFieldTrimPrompt({ eventTitle: title, entries: overlong });
        const trimAiConfig = { ...aiConfig, numPredict: Math.min(Number(aiConfig.numPredict) || 800, 800) };
        const rawResponse = await this.callAiGenerate(trimAiConfig, prompt, 'field-trim', httpAdapter);

        let parsed = null;
        if (rawResponse) {
            try {
                parsed = JSON.parse(this.extractFirstJsonObject(rawResponse) || rawResponse);
            } catch (_) {
                parsed = null;
            }
        }
        const trims = parsed && typeof parsed === 'object'
            ? (parsed.trims && typeof parsed.trims === 'object' ? parsed.trims : parsed)
            : {};

        const records = [];
        for (const entry of overlong) {
            const answerEntry = trims[entry.field];
            const answerText = answerEntry && typeof answerEntry === 'object' ? answerEntry.value : answerEntry;
            const answer = String(answerText === null || answerText === undefined ? '' : answerText).trim();
            if (this.isVerbatimTrimAnswer(entry.value, answer, entry.maxChars)) {
                if (trimConfig.mode === 'enforce') {
                    event[entry.field] = answer;
                    records.push({
                        field: entry.field,
                        status: 'trimmed',
                        originalLength: entry.value.length,
                        trimmedLength: answer.length,
                        trimmedValue: answer,
                        maxChars: entry.maxChars
                    });
                    console.log(`✂️ TRIM: "${title}" — ${entry.field} ${entry.value.length} → ${answer.length} chars (verbatim substring)`);
                } else {
                    records.push({
                        field: entry.field,
                        status: 'would-trim',
                        originalLength: entry.value.length,
                        trimmedLength: answer.length,
                        trimmedValue: answer,
                        maxChars: entry.maxChars
                    });
                    console.log(`✂️ TRIM [report]: "${title}" — ${entry.field} would trim ${entry.value.length} → ${answer.length} chars`);
                }
            } else {
                records.push({
                    field: entry.field,
                    status: 'failed-gate',
                    originalLength: entry.value.length,
                    maxChars: entry.maxChars
                });
                console.log(`✂️ TRIM: "${title}" — ${entry.field} answer failed verbatim gate ("${answer.slice(0, 80)}") — original kept`);
            }
        }
        event._fieldTrims = records;
        return records;
    }

    // Trim pass over one parser's bear events (processParser: after the bear
    // filter, before dedup — so trimmed values feed dedup keys and merges).
    // Zero AI calls when mode is 'off', AI is unavailable, or nothing is
    // overlong. NOTE: report mode still fires AI calls for overlong values —
    // a future golden-fixture text exceeding a limit would fire AI calls
    // against the fixture transport in report mode.
    async applyOverlongFieldTrims(events, parserConfig, httpAdapter) {
        const list = Array.isArray(events) ? events : [];
        if (list.length === 0) return list;
        const trimConfig = this.getTrimConfig(parserConfig);
        if (trimConfig.mode === 'off') return list;
        const rawAi = parserConfig && parserConfig.ai && typeof parserConfig.ai === 'object' ? parserConfig.ai : {};
        if (rawAi.enabled === false) return list;
        if (!httpAdapter || typeof httpAdapter.postJson !== 'function') return list;
        const aiConfig = this.resolveAiConfig(rawAi);
        if (!aiConfig.enabled || !aiConfig.endpoint) return list;

        let overlongCount = 0;
        let trimmedCount = 0;
        let flaggedCount = 0;
        for (const event of list) {
            const records = await this.trimOverlongFieldsForEvent(event, trimConfig, aiConfig, httpAdapter);
            for (const record of records) {
                overlongCount++;
                if (record.status === 'trimmed') {
                    trimmedCount++;
                } else {
                    flaggedCount++;
                }
            }
        }
        if (overlongCount > 0) {
            console.log(`✂️ TRIM: ${list.length} event(s) checked, ${overlongCount} overlong field(s), ${trimmedCount} trimmed, ${flaggedCount} flagged`);
        }
        return list;
    }

    // Final trim pass over ONE analyzed event (post-merge/calendar analysis).
    // The per-parser pass above runs BEFORE dedup/merge, so a merge that
    // keeps the longer side (calendar value, or arbitration's more-
    // descriptive pick) can resurrect an untrimmed value on the FINAL
    // object. Same config, same AI path as the pre-merge pass —
    // callAiGenerate responses are cached, so repeating an identical prompt
    // is deterministic and free. Idempotent: when the pre-merge trim
    // survived (nothing overlong on the final object),
    // trimOverlongFieldsForEvent returns before touching _fieldTrims — no
    // AI call, no duplicate records. When it does re-trim, this pass's
    // record REPLACES the earlier record for the same field (the value that
    // record described did not survive the merge) and every other field's
    // record is kept, so evidence lines describe each final value exactly
    // once. The batch summary line reuses the pre-merge shape — it can fire
    // once per re-trimmed event in addition to the per-parser summary.
    async applyFinalOverlongFieldTrims(event, parserConfig, httpAdapter) {
        if (!event || typeof event !== 'object') return [];
        const trimConfig = this.getTrimConfig(parserConfig);
        if (trimConfig.mode === 'off') return [];
        const rawAi = parserConfig && parserConfig.ai && typeof parserConfig.ai === 'object' ? parserConfig.ai : {};
        if (rawAi.enabled === false) return [];
        if (!httpAdapter || typeof httpAdapter.postJson !== 'function') return [];
        const aiConfig = this.resolveAiConfig(rawAi);
        if (!aiConfig.enabled || !aiConfig.endpoint) return [];

        const priorRecords = Array.isArray(event._fieldTrims) ? event._fieldTrims : [];
        const records = await this.trimOverlongFieldsForEvent(event, trimConfig, aiConfig, httpAdapter);
        if (records.length === 0) return records;
        const finalPassFields = new Set(records.map(record => record && record.field).filter(Boolean));
        event._fieldTrims = [
            ...priorRecords.filter(record => record && record.field && !finalPassFields.has(record.field)),
            ...records
        ];
        const trimmedCount = records.filter(record => record.status === 'trimmed').length;
        console.log(`✂️ TRIM: 1 event(s) checked, ${records.length} overlong field(s), ${trimmedCount} trimmed, ${records.length - trimmedCount} flagged`);
        return records;
    }

    // ------------------------------------------------------------------
    // AI shortName DERIVATION pass: events without a shortName make ugly
    // city-page calendar chips (dynamic-calendar-loader falls back to the
    // full title). The promoter registry stamps curated shortNames for
    // matched promoters; this pass covers everything else (venue one-offs,
    // aggregator finds) at the FINAL analyzed-event build, guarded by a
    // deterministic anti-hallucination gate. Convention: an unescaped `-`
    // in shortName is a LINE-BREAK HINT (rendered as a soft hyphen), e.g.
    // curated "BEEF-MINCE", "CUB-HOUSE", "MEGA-WOOF".
    // ------------------------------------------------------------------

    // Prompt for one event's shortName derivation. Carries the TITLE only —
    // no dates/venue/city — so the AI-response cache key stays stable
    // across runs (passLabel 'short-name').
    buildShortNamePrompt({ eventTitle, maxChars }) {
        return [
            'You are naming a compact calendar chip for one event.',
            `TITLE: ${eventTitle}`,
            'Return the shortest recognizable display name for this event.',
            'Rules:',
            '- The answer MUST be taken verbatim from the title: one contiguous run of characters — never paraphrase, reorder, merge parts, or add words.',
            `- At most ${maxChars} characters.`,
            '- UPPERCASE preferred (you may uppercase the copied characters).',
            '- You MAY insert hyphens inside a long word as line-break hints, e.g. "CUBSCOUT" → "CUB-SCOUT".',
            'Return JSON only:',
            '{"shortName": {"value": "<display name>", "reason": "<one short sentence>"}}'
        ].join('\n');
    }

    // Deterministic anti-hallucination gate for a derived shortName. Pure.
    // Usable only when ALL hold: non-empty after trim; length ≤ maxChars;
    // after removing hyphens and case/diacritic-folding BOTH sides, the
    // answer is a CONTIGUOUS substring of the title (spaces count as
    // characters — "BEEFMINCE MEET MARKET" can yield "MEET MARKET" or
    // "BEEFMINCE" but never "BEEF MARKET") — this permits hyphen insertion
    // and case-lifting but forbids invented/reordered words; and the answer
    // is not the title verbatim (an exact copy adds nothing — the site
    // fallback already shows the title — but a case-lift or an added
    // line-break hyphen IS a display change and is stored).
    // Returns { ok: true, value } or { ok: false, reason } where reason is
    // one of 'unusable response' | 'too long' | 'not a verbatim substring'
    // | 'equals title'.
    evaluateDerivedShortName(title, answerText, maxChars) {
        const answer = typeof answerText === 'string' ? answerText.trim() : '';
        if (!answer) return { ok: false, reason: 'unusable response' };
        if (answer.length > maxChars) return { ok: false, reason: 'too long' };
        const strippedFoldedAnswer = this.foldDiacritics(answer.replace(/-/g, ''));
        const strippedFoldedTitle = this.foldDiacritics(String(title).replace(/-/g, ''));
        // The occurrence must align on WORD BOUNDARIES in the title: "BEEF"
        // inside "BEEFMINCE" is a contiguous substring but a mid-word cut
        // that makes a wrong-looking chip ("Never cut a word in the middle",
        // same rule as the trim pipeline). Any one aligned occurrence
        // suffices.
        const isWordChar = (ch) => /[a-z0-9]/.test(ch);
        let aligned = false;
        if (strippedFoldedAnswer) {
            let from = 0;
            for (;;) {
                const at = strippedFoldedTitle.indexOf(strippedFoldedAnswer, from);
                if (at === -1) break;
                const beforeOk = at === 0 || !isWordChar(strippedFoldedTitle[at - 1]) || !isWordChar(strippedFoldedAnswer[0]);
                const endIndex = at + strippedFoldedAnswer.length;
                const afterOk = endIndex === strippedFoldedTitle.length
                    || !isWordChar(strippedFoldedTitle[endIndex])
                    || !isWordChar(strippedFoldedAnswer[strippedFoldedAnswer.length - 1]);
                if (beforeOk && afterOk) { aligned = true; break; }
                from = at + 1;
            }
        }
        if (!aligned) {
            return { ok: false, reason: 'not a verbatim substring' };
        }
        if (answer === String(title).trim()) {
            return { ok: false, reason: 'equals title' };
        }
        return { ok: true, value: answer };
    }

    // Derive a shortName for one FINAL analyzed event that lacks one. All
    // trigger guards live here: existing/static shortName, empty title, AI
    // disabled (`ai: { shortNames: false }` or `enabled: false`), or no
    // transport → no AI call, event untouched. Resilient by design: AI
    // transport error / non-JSON / missing field → rejected log (reason
    // 'unusable response') and the event ships without shortName exactly as
    // today. No retry ladder — the pass is cheap and optional. Returns true
    // only when a gated value was stored (caller rebuilds notes).
    async deriveShortNameForEvent(event, parserConfig, httpAdapter) {
        if (!event || typeof event !== 'object') return false;
        const existing = event.shortName === null || event.shortName === undefined
            ? ''
            : String(event.shortName).trim();
        if (existing) return false;
        const staticFields = event._staticFields && typeof event._staticFields === 'object'
            ? event._staticFields
            : {};
        if (Object.prototype.hasOwnProperty.call(staticFields, 'shortName')) return false;
        const title = typeof event.title === 'string' ? event.title.trim() : '';
        if (!title) return false;
        const rawAi = parserConfig && parserConfig.ai && typeof parserConfig.ai === 'object' ? parserConfig.ai : {};
        if (rawAi.enabled === false) return false;
        if (!httpAdapter || typeof httpAdapter.postJson !== 'function') return false;
        const aiConfig = this.resolveAiConfig(rawAi);
        if (!aiConfig.enabled || !aiConfig.endpoint || !aiConfig.shortNamesEnabled) return false;

        const maxChars = aiConfig.shortNameDeriveMaxChars;
        const prompt = this.buildShortNamePrompt({ eventTitle: title, maxChars });
        const shortNameAiConfig = { ...aiConfig, numPredict: Math.min(Number(aiConfig.numPredict) || 200, 200) };

        let rawResponse = null;
        try {
            rawResponse = await this.callAiGenerate(shortNameAiConfig, prompt, 'short-name', httpAdapter);
        } catch (_) {
            rawResponse = null;
        }

        let parsed = null;
        if (rawResponse) {
            try {
                parsed = JSON.parse(this.extractFirstJsonObject(rawResponse) || rawResponse);
            } catch (_) {
                parsed = null;
            }
        }
        const answerEntry = parsed && typeof parsed === 'object' ? parsed.shortName : null;
        const answerText = answerEntry && typeof answerEntry === 'object' ? answerEntry.value : answerEntry;
        if (typeof answerText !== 'string') {
            console.log(`🏷️ SHORTNAME: rejected AI answer for "${title}" — unusable response`);
            return false;
        }

        const verdict = this.evaluateDerivedShortName(title, answerText, maxChars);
        if (!verdict.ok) {
            // Deterministic salvage before giving up — every real rejection
            // class from the live batteries (2026-07-29) has a mechanical
            // repair that stays inside the verbatim gate (no extra AI call,
            // no new trust):
            //   - hyphens used as SPACE replacements ("BEEFMINCE-X-RVT",
            //     "BEEFMINCE-BRIGHTON") → try the answer with hyphens turned
            //     back into spaces first;
            //   - merged/invented tails ("CLUB CHUB 2026", "CLUB CHUB
            //     FT-LA") and overlong answers ("BEEFMINCE: THE BIG BALL")
            //     → drop trailing whitespace tokens until the remainder
            //     passes, stripping trailing punctuation and never ending on
            //     a stopword ("BEEFMINCE: THE" must fall through to
            //     "BEEFMINCE").
            if (verdict.reason === 'not a verbatim substring' || verdict.reason === 'too long') {
                const trailingStopwords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'at', 'in', 'on', 'for', 'with', 'x', 'y', 'en', 'de', 'la', 'el', 'les', 'los']);
                const candidates = [];
                const spaced = answerText.trim().replace(/-/g, ' ').replace(/\s+/g, ' ');
                if (spaced !== answerText.trim()) candidates.push(spaced);
                for (const base of [spaced, answerText.trim()]) {
                    const tokens = base.split(/\s+/);
                    for (let keep = tokens.length - 1; keep >= 1; keep--) {
                        candidates.push(tokens.slice(0, keep).join(' '));
                    }
                }
                const seenCandidates = new Set();
                for (const rawCandidate of candidates) {
                    const candidate = rawCandidate.replace(/[\s:;,.!–—-]+$/, '');
                    if (!candidate || seenCandidates.has(candidate)) continue;
                    seenCandidates.add(candidate);
                    const lastToken = candidate.split(/\s+/).pop().toLowerCase();
                    if (trailingStopwords.has(lastToken)) continue;
                    const salvage = this.evaluateDerivedShortName(title, candidate, maxChars);
                    if (salvage.ok) {
                        event.shortName = salvage.value;
                        console.log(`🏷️ SHORTNAME: salvaged "${salvage.value}" from rejected answer for "${title}"`);
                        return true;
                    }
                }
            }
            console.log(`🏷️ SHORTNAME: rejected AI answer for "${title}" — ${verdict.reason}`);
            return false;
        }

        event.shortName = verdict.value;
        console.log(`🏷️ SHORTNAME: derived "${verdict.value}" for "${title}"`);
        return true;
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
        // Pathed-URL equality alone is the identity — no title compatibility
        // check (battery run 20260728: listing stubs titled with the VENUE —
        // "Nova PDX", "The Godfrey Rooftop", "CCBC Resort" — shared the exact
        // event-page URL with their properly-titled detail twins and the old
        // title veto kept all three pairs as duplicates). Homepage-root URLs
        // never qualify (getEventUrlIdentityKey requires a path segment), so a
        // parser whose events all carry the site root (e.g. furball.nyc) is
        // untouched.
        // The key comes from getEventIdentityUrlKey: `url`, falling back to the
        // canonical `website` alias only when the url yields no key at all.
        const urlKeyCounts = new Map();
        for (const event of deduplicated) {
            const urlKey = this.getEventIdentityUrlKey(event);
            if (urlKey) urlKeyCounts.set(urlKey, (urlKeyCounts.get(urlKey) || 0) + 1);
        }
        const eventsByUrl = new Map();
        const urlDeduplicated = [];
        for (const event of deduplicated) {
            const urlKey = this.getEventIdentityUrlKey(event);
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
            if (holder && this.areStartDatesWithinDays(holder, event, 7)) {
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

        // Third pass: cross-source duplicates WITHIN one parser run (runs
        // 20260724-155934 / 20260725-170926: a parser crawling both a venue
        // site and a ticketing/organizer page received the same event twice
        // with variant titles — "Thighs out for the guys yall, it's Singlet
        // Night…" vs "Singlet Night with DJ Drew G" — and the passes above
        // missed them: keys diverge, name similarity is containment-based,
        // and one record may carry its venue only as a _venueSitePageHost
        // tag). Pair only on same venue identity + same event night +
        // title-token subset (see getCrossSourceDuplicateSignal — every step
        // fails closed), then MERGE (never drop) through the same
        // mergeParsedEvents machinery as the passes above so per-field
        // conflict rules and arbitration apply. Runs AFTER the wall-clock
        // re-anchor so nights are computed on the best-known instants, and
        // iterates until stable so chains (A⊂B, B⊂C) collapse to one event.
        let crossSourceDeduplicated = urlDeduplicated;
        let crossSourcePassMerged = true;
        let crossSourcePassCount = 0;
        while (crossSourcePassMerged && crossSourcePassCount <= events.length) {
            crossSourcePassMerged = false;
            crossSourcePassCount++;
            const kept = [];
            for (const event of crossSourceDeduplicated) {
                const match = kept.find(existing => this.getCrossSourceDuplicateSignal(event, existing));
                if (!match) {
                    kept.push(event);
                    continue;
                }
                const primary = this.pickCrossSourcePrimary(match, event);
                const secondary = primary === match ? event : match;
                console.log(`🔀 MERGE: cross-source duplicate "${secondary.title || 'event'}" merged into "${primary.title || 'event'}" (venue+night+title-subset)`);
                const merged = await this.mergeParsedEvents(secondary, primary, { httpAdapter, globalConfig });
                merged.key = primary.key;
                if (merged._timezoneUnresolved) {
                    this.resolveWallClockDates(merged);
                }
                kept[kept.indexOf(match)] = merged;
                crossSourcePassMerged = true;
            }
            crossSourceDeduplicated = kept;
        }

        // Log results for large batches
        if (logProgress) {
            const duplicatesFound = events.length - crossSourceDeduplicated.length;
            const duplicateSummary = duplicatesFound > 0 ? ` (removed ${duplicatesFound})` : '';
            console.log(`🔄 SharedCore: Deduplicated ${events.length} → ${crossSourceDeduplicated.length}${duplicateSummary}`);
        }

        return crossSourceDeduplicated;
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
        const eventTimezone = event.timezone || this.getCityTimezone(event.city) || null;
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
        // Same carry for the matched-promoter identity stamp (_promoter).
        if (!mergedEvent._promoter && existingEvent && typeof existingEvent._promoter === 'string' && existingEvent._promoter) {
            mergedEvent._promoter = existingEvent._promoter;
        }
        // Same carry for field-trim records: an existing-only _fieldTrims
        // would otherwise be lost before evidence lines render.
        if (!mergedEvent._fieldTrims && existingEvent && Array.isArray(existingEvent._fieldTrims) && existingEvent._fieldTrims.length > 0) {
            mergedEvent._fieldTrims = existingEvent._fieldTrims;
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
        // side's resolved city works. barNames feeds the curated-address rung:
        // either record's bar matching a curated bar anchors the address.
        // records/sideLabels feed the address evidence rung: each side's
        // already-computed pin (+ pinSource provenance) is attributed to its
        // own address candidate; eventTitle is for the mismatch warning only.
        const mergeContext = {
            cityKey: newEvent.city || existingEvent.city || '',
            barNames: [existingEvent.bar, newEvent.bar],
            eventTitle: mergeEventTitle,
            sideLabels: { a: 'existing', b: 'incoming' },
            records: { a: existingEvent, b: newEvent }
        };
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

            // imageSource is image provenance that must FOLLOW the finalized
            // image (recomputed after the loop + arbitration via
            // setProvenanceSource) — merging it as its own field could pair the
            // winning image with the LOSING side's provenance stamp.
            if (fieldName === 'imageSource') return;

            // barSource is bar provenance and must FOLLOW the finalized bar
            // the same way (recomputed after the loop + arbitration).
            if (fieldName === 'barSource') return;

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

            // A startDate at EXACT local midnight on a record without an
            // explicit start time is the parser's "no time stated" placeholder
            // (see isInventedMidnight in normalizeAiEvent) — it must never
            // displace a sibling record's explicit non-midnight start time for
            // the same local day, regardless of source priority (run finding:
            // QUENCHD's placeholder-midnight record beat the 20:00Z record via
            // PARSER MERGE priority). Records whose local wall clock cannot be
            // resolved fall through unchanged (fail open).
            if (fieldName === 'startDate' && !isEmpty(existingValue) && !isEmpty(newValue)
                && String(existingValue) !== String(newValue)) {
                const existingLocalStart = this.getMergeLocalStartParts(existingEvent);
                const newLocalStart = this.getMergeLocalStartParts(newEvent);
                if (existingLocalStart && newLocalStart
                    && existingLocalStart.localDay === newLocalStart.localDay) {
                    const existingIsMidnightPlaceholder = existingLocalStart.minutesOfDay === 0
                        && !existingEvent.startTime && newLocalStart.minutesOfDay !== 0;
                    const newIsMidnightPlaceholder = newLocalStart.minutesOfDay === 0
                        && !newEvent.startTime && existingLocalStart.minutesOfDay !== 0;
                    if (existingIsMidnightPlaceholder !== newIsMidnightPlaceholder) {
                        const chosenValue = existingIsMidnightPlaceholder ? newValue : existingValue;
                        mergedEvent[fieldName] = chosenValue;
                        console.log(`⏰ MERGE: "${mergeEventTitle}" kept explicit start time over midnight-placeholder startDate`);
                        mergeDecisions.push({
                            field: fieldName,
                            existingValue: existingValue,
                            newValue: newValue,
                            chosenValue: chosenValue,
                            reason: 'explicit start time wins over local-midnight placeholder (no stated time)'
                        });
                        return;
                    }
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

        // imageSource follows the finalized image (deterministic, never AI-
        // arbitrated): the `{ ...newEvent }` base spread copied newEvent's
        // stamp regardless of which side's image won, so recompute it from
        // whichever record supplied the final value. A final image neither
        // side stamped (or no image at all) carries no imageSource (fail open).
        delete mergedEvent.imageSource;
        this.setProvenanceSource(mergedEvent, 'image', 'imageSource', newEvent, existingEvent);

        // barSource follows the finalized bar exactly like imageSource above:
        // the corroboration stamp must always describe the WINNING bar value —
        // a final bar neither side stamped carries no barSource (fail open).
        delete mergedEvent.barSource;
        this.setProvenanceSource(mergedEvent, 'bar', 'barSource', newEvent, existingEvent);

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
        // calendar object may carry one parsed from its notes. barNames feeds
        // the curated-address rung: either record's bar matching a curated bar
        // anchors the address. records/sideLabels feed the address evidence
        // rung: the scraper object carries this run's geocode-verified pin
        // (location + pinSource from the normalizers), the calendar object its
        // stored pin (native location + notes-parsed pinSource); eventTitle is
        // for the mismatch warning only.
        const mergeContext = {
            cityKey: scraperObject.city || calendarObject.city || '',
            barNames: [calendarObject.bar, scraperObject.bar],
            eventTitle: mergeTitle,
            sideLabels: { a: 'calendar', b: 'scraped' },
            records: { a: calendarObject, b: scraperObject }
        };
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

            // pinSource/addressSource/imageSource/barSource are provenance
            // metadata that must FOLLOW the finalized location/address/image/
            // bar (set by setProvenanceSource after STEP 3c) — they never merge
            // or arbitrate on their own, or the generic loop could clobber a
            // kept value's source with a stale one.
            if (fieldName === 'pinSource' || fieldName === 'addressSource'
                || fieldName === 'imageSource' || fieldName === 'barSource') continue;

            const priorityConfig = fieldPriorities[fieldName];
            const mergeStrategy = priorityConfig?.merge || 'upsert';
            const scraperValue = scraperObject[fieldName];
            const calendarValue = calendarObject[fieldName];

            if (fieldName === 'endDate' && keepCalendarEndOverDegenerateScrape) {
                mergedObject[fieldName] = calendarValue;
                continue;
            }

            // Orientation image slots are NEVER cleared by a run that found no
            // candidate of that shape. URL-derived orientation is knowable for
            // only a minority of image URLs, so an empty imageVertical/
            // imageHorizontal means "nothing this run could prove is that
            // shape" — never "delete the curated one". Stated explicitly at the
            // slot level (the generic empty-scrape rule further down happens to
            // cover it today, but that rule carries per-field exclusions and
            // this invariant must not depend on staying off that list).
            if (IMAGE_ORIENTATION_SLOT_FIELDS.has(fieldName)
                && this.isEmptyArbitrationValue(scraperValue)
                && !this.isEmptyArbitrationValue(calendarValue)) {
                mergedObject[fieldName] = calendarValue;
                calendarKeptFields.push(fieldName);
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
                // Exception to calendar-wins: a fresh manual-bear override from
                // the results UI is the owner's newest verdict — it must clear a
                // stored hide/review flag (e.g. a manual-not-bear tombstone's
                // "unlikely — …" flag), or the rescued event stays hidden.
                const scraperBearSource = typeof scraperObject.bearSource === 'string'
                    ? scraperObject.bearSource.trim().toLowerCase()
                    : '';
                if (scraperBearSource.startsWith('manual-bear')) {
                    if (!this.isEmptyArbitrationValue(scraperValue)) {
                        mergedObject[fieldName] = scraperValue;
                    }
                    continue;
                }
                mergedObject[fieldName] = !this.isEmptyArbitrationValue(calendarValue)
                    ? calendarValue
                    : scraperValue;
                continue;
            }

            // bearSource is bear-verdict provenance, resolved deterministically
            // (never arbitrated, see isArbitrationEligibleField): a freshly
            // tapped manual-* override (scraped side) is the owner's newest
            // word and wins; otherwise a stored manual-* value is never
            // clobbered by an automatic keyword/ai/config stamp; otherwise the
            // fresh automatic verdict follows this run's cascade decision.
            if (fieldName === 'bearSource') {
                if (this.isManualBearSource(scraperValue)) {
                    mergedObject[fieldName] = scraperValue;
                } else if (this.isManualBearSource(calendarValue) || this.isEmptyArbitrationValue(scraperValue)) {
                    mergedObject[fieldName] = calendarValue;
                } else {
                    mergedObject[fieldName] = scraperValue;
                }
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

        // Provenance follows the finalized value (deterministic, never AI-
        // arbitrated): now that location and address are final, stamp
        // pinSource/addressSource to match whichever side's value won. A fresh
        // scraped value carries the scrape's source; a kept calendar value keeps
        // the calendar's stored source (absent → absent) so a hand-fixed pin or
        // address is never mislabeled with a source the scrape didn't produce.
        this.setProvenanceSource(mergedObject, 'location', 'pinSource', scraperObject, calendarObject);
        this.setProvenanceSource(mergedObject, 'address', 'addressSource', scraperObject, calendarObject);
        this.setProvenanceSource(mergedObject, 'image', 'imageSource', scraperObject, calendarObject);
        this.setProvenanceSource(mergedObject, 'bar', 'barSource', scraperObject, calendarObject);

        // Stamp guard for the city-append fingerprint: when the address was
        // settled by the city-suffix twin rung, the calendar record was
        // machine-written by the pre-#1525 append path — and that path also
        // accepted its pin WITHOUT a pinSource stamp (run 20260723-140457
        // persisted 36.6225097, -4.4987054 stamp-less). Such a pin's real
        // provenance is a geocode of a vague place name, which grades approx
        // — never exact — so stamp it geocoded-approx instead of letting it
        // round-trip unstamped forever. Deliberately NARROW: an unstamped pin
        // on a record without the append fingerprint may be a hand-fixed pin
        // and stays absent → absent (see setProvenanceSource).
        const citySuffixTwinResolvedAddress = aiDecisionRecords.some(record => record
            && record.field === 'address' && typeof record.reason === 'string'
            && record.reason.startsWith('city-suffixed twin'));
        if (citySuffixTwinResolvedAddress
            && this.isCoordinatePair(mergedObject.location)
            && !(typeof mergedObject.pinSource === 'string' && mergedObject.pinSource.trim().length > 0)) {
            mergedObject.pinSource = 'geocoded-approx';
            console.log(`📍 MERGE: "${mergeTitle}" kept pin from a city-suffixed record had no pinSource stamp — stamped geocoded-approx (append-path pins are never exact)`);
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

        // Carry field-trim records across the calendar merge (like _organizer
        // in mergeParsedEvents): underscore fields are skipped by the merge
        // loop, so the scraped side's _fieldTrims would otherwise be lost
        // before the evidence lines render.
        if (Array.isArray(newEvent._fieldTrims) && newEvent._fieldTrims.length > 0) {
            finalEvent._fieldTrims = newEvent._fieldTrims;
        }
        // Same carry for the registry identity stamp and derived organizer
        // (mirrors mergeParsedEvents): the enforce-mode _promoter stamp must
        // stay visible on the FINAL analyzed event for display/metrics, not
        // just on the pre-merge scraped record.
        if (typeof newEvent._promoter === 'string' && newEvent._promoter) {
            finalEvent._promoter = newEvent._promoter;
        }
        if (typeof newEvent._organizer === 'string' && newEvent._organizer) {
            finalEvent._organizer = newEvent._organizer;
        }
        
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

    // Local wall-clock view of a record's startDate for the merge midnight-
    // placeholder rung: { minutesOfDay, localDay } or null when the local
    // clock cannot be resolved. A _timezoneUnresolved record's UTC components
    // ARE its wall clock; otherwise the record's own timezone (or its city's)
    // anchors the conversion.
    getMergeLocalStartParts(event) {
        const value = event && event.startDate;
        if (!value) return null;
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        if (event._timezoneUnresolved) {
            return {
                minutesOfDay: (date.getUTCHours() * 60) + date.getUTCMinutes(),
                localDay: date.toISOString().split('T')[0]
            };
        }
        const timezone = event.timezone || this.getCityTimezone(event.city) || null;
        if (!timezone) return null;
        const offsetMinutes = this.getTimezoneOffsetMinutes(date, timezone);
        if (!Number.isFinite(offsetMinutes)) return null;
        const localView = new Date(date.getTime() + (offsetMinutes * 60 * 1000));
        return {
            minutesOfDay: (localView.getUTCHours() * 60) + localView.getUTCMinutes(),
            localDay: localView.toISOString().split('T')[0]
        };
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
            || this.getCityTimezone(event.city)
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
    
    // Crawl-queue guard: obvious static assets are never pages, so the crawl
    // loop must never fetch them. URL discovery (ai-web-parser validateEventUrl)
    // already rejects these, but a candidate whose entity-mangled tail hides the
    // extension at validation time (e.g. "….webp&quot;" → validated as "….webp\"")
    // only becomes a clean asset URL after the crawl loop's own normalizeUrl
    // pass — so the check is re-applied here against the URL actually fetched
    // (run 20260724-161423 fetched .avif/.webp/.jpg CDN images as crawl pages).
    isStaticAssetUrl(url) {
        const staticAssetExtensions = [
            '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.heic', '.heif',
            '.ico', '.bmp', '.tif', '.tiff',
            '.css', '.js', '.mjs', '.map', '.json', '.xml', '.txt', '.pdf', '.zip', '.gz', '.tgz',
            '.mp3', '.m4a', '.wav', '.mp4', '.webm', '.mov', '.avi', '.woff', '.woff2', '.ttf'
        ];
        const parsed = this.parseUrl(url);
        const path = parsed
            ? String(parsed.pathname || '')
            : String(url || '').replace(/[?#].*$/, '');
        const lowerPath = path.toLowerCase();
        return staticAssetExtensions.some(ext => lowerPath.endsWith(ext));
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

        // Flyer OCR and AI-extracted fields carry scheme-less URLs ("WWW.MASSIVE.CLUB",
        // "BEARRACUDA.COM") that would otherwise be resolved as relative paths (or, on
        // iOS, returned verbatim and fail to fetch as "unsupported URL"). Must run
        // BEFORE relative resolution, which would silently misresolve them.
        const schemelessHost = this.normalizeSchemelessHostUrl(normalized);
        if (schemelessHost) {
            return schemelessHost;
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

    // A candidate is treated as a scheme-less host only when unambiguous:
    // it starts with "www." (path allowed), or it is a bare dotted domain with
    // NO path whose final label is a plausible TLD — never a path-bearing
    // relative href like "events/foo" or a filename like "index.html".
    normalizeSchemelessHostUrl(candidate) {
        const text = String(candidate || '').trim();
        if (!text || /\s/.test(text)) return null;
        if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return null; // already has a scheme

        const hostEnd = text.search(/[/?#]/);
        const host = hostEnd === -1 ? text : text.slice(0, hostEnd);
        const rest = hostEnd === -1 ? '' : text.slice(hostEnd);
        const hostPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
        if (!hostPattern.test(host)) return null;

        if (!/^www\./i.test(host)) {
            if (rest !== '') return null; // path-bearing non-www stays relative
            const tld = host.slice(host.lastIndexOf('.') + 1).toLowerCase();
            if (!/^[a-z]{2,24}$/.test(tld)) return null;
            // Dotted filenames are relative paths, not hosts ("index.html")
            const fileExtensions = ['html', 'htm', 'shtml', 'php', 'asp', 'aspx', 'jsp',
                'xml', 'json', 'txt', 'pdf', 'md', 'css', 'js',
                'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico'];
            if (fileExtensions.includes(tld)) return null;
        }

        return `https://${host.toLowerCase()}${rest}`;
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
        // Adapter-confirmed series (published-ICS lookup or wide-window
        // identifier probe): the identifier was positively established as a
        // recurring series this run — hands off, create overrides instead.
        if (eventIdentifierRaw &&
            this._confirmedSeriesIdentifiers &&
            this._confirmedSeriesIdentifiers.has(eventIdentifierRaw)) {
            return true;
        }
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

    // Record an identifier positively confirmed as a recurring series this
    // run (published-ICS lookup or wide-window probe). Consulted by
    // shouldCreateOverrideFromRecurringMatch so series never masquerade as
    // normal events when the narrow search window saw only one instance.
    noteConfirmedRecurringSeries(identifier) {
        const normalized = identifier === null || identifier === undefined
            ? ''
            : String(identifier).trim();
        if (!normalized) return;
        if (!this._confirmedSeriesIdentifiers) {
            this._confirmedSeriesIdentifiers = new Set();
        }
        this._confirmedSeriesIdentifiers.add(normalized);
    }

    // Analyze one event, then — when it merge-matched an existing calendar
    // event WITHOUT any series signal firing — ask the adapter for a targeted
    // series probe (published calendar ICS first, wide-window identifier
    // probe as fallback; both adapter-side). A confirmed series feeds back
    // into the existing shouldCreateOverrideFromRecurringMatch hands-off path
    // via noteConfirmedRecurringSeries + re-analysis. Fail open: probe
    // absence or errors leave today's behavior untouched.
    async resolveCalendarAnalysisWithSeriesProbe(event, existingEventsData, mergeMode, calendarAdapter) {
        let analysis = this.analyzeEventAction(event, existingEventsData, mergeMode);
        if (analysis.action !== 'merge' || !analysis.existingEvent) {
            return analysis;
        }
        if (!calendarAdapter || typeof calendarAdapter.probeRecurringSeries !== 'function') {
            return analysis;
        }
        try {
            const isSeries = await calendarAdapter.probeRecurringSeries(analysis.existingEvent, event);
            if (isSeries === true) {
                const identifier = analysis.existingEvent.identifier || analysis.existingEvent.id || '';
                this.noteConfirmedRecurringSeries(identifier);
                analysis = this.analyzeEventAction(event, existingEventsData, mergeMode);
            }
        } catch (error) {
            // Fail open — probe errors never change merge behavior.
        }
        return analysis;
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
    // regardless of which path (automation or interactive prompt) executes them.
    // Recurring series events are equally withheld: they are display+export
    // only (owner imports the ICS; the scraper never writes recurring series).
    static filterEventsForExecution(analyzedEvents) {
        if (!Array.isArray(analyzedEvents)) return [];
        return analyzedEvents.filter(event =>
            event?._parserConfig?.dryRun !== true &&
            !SharedCore.isRecurringSeriesEvent(event));
    }

    // An event that DEFINES a recurring series: stamped _recurring in
    // normalization, or carrying a non-empty extracted RRULE.
    static isRecurringSeriesEvent(event) {
        if (!event || typeof event !== 'object') return false;
        if (event._recurring === true) return true;
        return typeof event.recurrenceRule === 'string' && event.recurrenceRule.trim() !== '';
    }

    // Scriptable identifiers look like `<calendarUUID>:<icsUid>` — the suffix
    // after the FIRST colon is the ICS UID verbatim (device-verified for both
    // `…:6thhos5ct3pllq5kmvsp7infd8@google.com` and
    // `…:fuzzy-20260503T203532Z@chunky.dad`). Returns null when there is no
    // colon-separated suffix to extract.
    static extractIcsUidFromIdentifier(identifier) {
        if (identifier === null || identifier === undefined) return null;
        const text = String(identifier).trim();
        const colonIndex = text.indexOf(':');
        if (colonIndex < 0) return null;
        const uid = text.slice(colonIndex + 1).trim();
        return uid.length > 0 ? uid : null;
    }

    // Light regex-level scan of a published calendar ICS (no full parser):
    // walks BEGIN:VEVENT blocks after unfolding continuation lines and maps
    // each UID to whether that block carries an RRULE. Returns null for
    // non-string/empty input (callers fail open).
    static extractRecurringUidsFromIcs(icsText) {
        if (typeof icsText !== 'string' || icsText.trim() === '') return null;
        // Unfold RFC 5545 folded lines (CRLF/LF followed by space or tab).
        const unfolded = icsText.replace(/\r?\n[ \t]/g, '');
        const uids = new Map();
        const blockRegex = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
        let match;
        while ((match = blockRegex.exec(unfolded)) !== null) {
            const block = match[1];
            const uidMatch = block.match(/^UID[^:]*:(.+)$/m);
            if (!uidMatch) continue;
            const uid = uidMatch[1].trim();
            if (!uid) continue;
            const hasRrule = /^RRULE[:;]/m.test(block);
            // A series' own VEVENT wins over override instances that share
            // the UID but carry no RRULE.
            uids.set(uid, hasRrule || uids.get(uid) === true);
        }
        return uids;
    }

    // -------------------------------------------------------------------------
    // Published-calendar ICS parsing + RRULE expansion (pure string/date work).
    // The Mac/Node web adapter reads the published per-city calendar files
    // (https://chunky.dad/data/calendars/<cityKey>.ics) as its "existing
    // events" source so merge/enrich/conflict analysis works without EventKit.
    // Everything here is dependency-free (Intl + Date only) and platform-pure.
    // -------------------------------------------------------------------------

    // RFC 5545 TEXT unescaping: \\ -> \, \n or \N -> newline, \, -> comma,
    // \; -> semicolon. Single pass so "\\n" correctly yields "\n" (literal).
    static unescapeIcsText(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/\\([\\;,nN])/g, (match, escaped) =>
            (escaped === 'n' || escaped === 'N') ? '\n' : escaped);
    }

    // Offset (minutes) of an IANA timezone from UTC at an instant. Static
    // sibling of the instance getTimezoneOffsetMinutes (which stays untouched)
    // for the pure ICS helpers below. Bare "GMT" (UTC's longOffset) → 0.
    static getIcsTimezoneOffsetMinutes(date, timezone) {
        try {
            const formatter = new Intl.DateTimeFormat('en', {
                timeZone: timezone,
                timeZoneName: 'longOffset'
            });
            const parts = formatter.formatToParts(date);
            const offsetPart = parts.find(part => part.type === 'timeZoneName');
            const offsetText = offsetPart && typeof offsetPart.value === 'string' ? offsetPart.value : '';
            if (/^(GMT|UTC)$/i.test(offsetText.trim())) return 0;
            const offsetMatch = offsetText.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
            if (!offsetMatch) return null;
            const sign = offsetMatch[1] === '+' ? 1 : -1;
            return sign * ((parseInt(offsetMatch[2], 10) * 60) + (offsetMatch[3] ? parseInt(offsetMatch[3], 10) : 0));
        } catch (_) {
            return null;
        }
    }

    // Wall-clock components in an IANA timezone → the UTC instant they name.
    // Iterates because the offset guess can be wrong near DST transitions
    // (same algorithm as the instance convertWallClockDateToUtc).
    static zonedWallClockToUtc(wall, timezone) {
        if (!wall || typeof wall !== 'object') return null;
        const base = Date.UTC(
            wall.year, (wall.month || 1) - 1, wall.day || 1,
            wall.hour || 0, wall.minute || 0, wall.second || 0
        );
        if (!Number.isFinite(base)) return null;
        if (!timezone || /^(UTC|GMT|Z)$/i.test(String(timezone))) return new Date(base);
        let utcMillis = base;
        for (let i = 0; i < 4; i++) {
            const offsetMinutes = SharedCore.getIcsTimezoneOffsetMinutes(new Date(utcMillis), timezone);
            if (!Number.isFinite(offsetMinutes)) return null;
            const nextUtcMillis = base - (offsetMinutes * 60 * 1000);
            if (nextUtcMillis === utcMillis) break;
            utcMillis = nextUtcMillis;
        }
        return new Date(utcMillis);
    }

    // One ICS date/date-time property value → { date, wall, tzid, isDateOnly }.
    // `params` is the raw parameter run between the property name and ':'
    // (e.g. ";TZID=America/Los_Angeles" or ";VALUE=DATE"); `value` the text
    // after ':'. Handles the three published shapes: TZID wall clock, UTC "Z",
    // and VALUE=DATE (all-day, midnight UTC). Floating times are read as UTC.
    static parseIcsDateValue(params, value) {
        const text = String(value === null || value === undefined ? '' : value).trim();
        const paramText = String(params || '');
        const tzidMatch = paramText.match(/TZID=([^;:]+)/i);
        const tzid = tzidMatch ? tzidMatch[1].trim() : null;
        if (/VALUE=DATE(?!-TIME)/i.test(paramText) || /^\d{8}$/.test(text)) {
            const dateMatch = text.match(/^(\d{4})(\d{2})(\d{2})$/);
            if (!dateMatch) return null;
            const wall = {
                year: parseInt(dateMatch[1], 10), month: parseInt(dateMatch[2], 10), day: parseInt(dateMatch[3], 10),
                hour: 0, minute: 0, second: 0
            };
            const date = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
            return isNaN(date.getTime()) ? null : { date, wall, tzid: null, isDateOnly: true };
        }
        const dateTimeMatch = text.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
        if (!dateTimeMatch) return null;
        const wall = {
            year: parseInt(dateTimeMatch[1], 10), month: parseInt(dateTimeMatch[2], 10), day: parseInt(dateTimeMatch[3], 10),
            hour: parseInt(dateTimeMatch[4], 10), minute: parseInt(dateTimeMatch[5], 10),
            second: dateTimeMatch[6] ? parseInt(dateTimeMatch[6], 10) : 0
        };
        const isUtc = Boolean(dateTimeMatch[7]);
        const date = (isUtc || !tzid)
            ? new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second))
            : SharedCore.zonedWallClockToUtc(wall, tzid);
        if (!date || isNaN(date.getTime())) return null;
        return { date, wall, tzid: isUtc ? 'UTC' : tzid, isDateOnly: false };
    }

    // Fuller (but still light) VEVENT scanner than extractRecurringUidsFromIcs:
    // per VEVENT extracts UID, SUMMARY, DTSTART/DTEND (TZID= and VALUE=DATE
    // variants), RRULE, DESCRIPTION (unfolded + unescaped), LOCATION, URL,
    // EXDATE list and RECURRENCE-ID. Returns an array of plain records, or
    // null for non-string/empty input (callers fail open). VTIMEZONE blocks
    // (whose DST rules also say "RRULE:") are naturally skipped because only
    // BEGIN:VEVENT…END:VEVENT blocks are walked.
    static parsePublishedCalendarIcs(icsText) {
        if (typeof icsText !== 'string' || icsText.trim() === '') return null;
        // Unfold RFC 5545 folded lines (CRLF/LF followed by space or tab).
        const unfolded = icsText.replace(/\r?\n[ \t]/g, '');
        const records = [];
        const blockRegex = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
        let match;
        while ((match = blockRegex.exec(unfolded)) !== null) {
            // VALARM sub-blocks carry DESCRIPTION lines of their own — strip them.
            const block = match[1].replace(/BEGIN:VALARM[\s\S]*?END:VALARM/g, '');
            const record = {
                uid: '', summary: '', description: '', location: '', url: '',
                rrule: '', start: null, end: null, exdates: [], recurrenceId: null
            };
            for (const rawLine of block.split(/\r?\n/)) {
                const line = rawLine.trim() === '' ? null : rawLine;
                if (!line) continue;
                const propMatch = line.match(/^([A-Za-z0-9-]+)((?:;[^:]*)?):(.*)$/);
                if (!propMatch) continue;
                const name = propMatch[1].toUpperCase();
                const params = propMatch[2] || '';
                const value = propMatch[3];
                switch (name) {
                    case 'UID': record.uid = value.trim(); break;
                    case 'SUMMARY': record.summary = SharedCore.unescapeIcsText(value).trim(); break;
                    case 'DESCRIPTION': record.description = SharedCore.unescapeIcsText(value); break;
                    case 'LOCATION': record.location = SharedCore.unescapeIcsText(value).trim(); break;
                    case 'URL': record.url = value.trim(); break;
                    case 'RRULE': record.rrule = value.trim(); break;
                    case 'DTSTART': record.start = SharedCore.parseIcsDateValue(params, value); break;
                    case 'DTEND': record.end = SharedCore.parseIcsDateValue(params, value); break;
                    case 'RECURRENCE-ID': record.recurrenceId = SharedCore.parseIcsDateValue(params, value); break;
                    case 'EXDATE':
                        for (const exValue of value.split(',')) {
                            const parsed = SharedCore.parseIcsDateValue(params, exValue);
                            if (parsed) record.exdates.push(parsed);
                        }
                        break;
                    default: break;
                }
            }
            if (!record.uid || !record.start) continue;
            record.isAllDay = Boolean(record.start.isDateOnly);
            records.push(record);
        }
        return records;
    }

    // RRULE text → uppercase part map ({ FREQ, BYDAY, … }), or null when empty.
    static parseRruleParts(rrule) {
        const text = String(rrule || '').replace(/^RRULE[:;]/i, '').trim();
        if (!text) return null;
        const parts = {};
        for (const chunk of text.split(';')) {
            const eqIndex = chunk.indexOf('=');
            if (eqIndex <= 0) continue;
            parts[chunk.slice(0, eqIndex).trim().toUpperCase()] = chunk.slice(eqIndex + 1).trim().toUpperCase();
        }
        return Object.keys(parts).length > 0 ? parts : null;
    }

    // Expand a recurring series' occurrence START instants into a window.
    // Supports exactly the shapes the published calendars contain (verified
    // inventory: FREQ=WEEKLY[;BYDAY=…], FREQ=MONTHLY;BYDAY=nXX) plus DAILY,
    // plain MONTHLY (day-of-month), INTERVAL, COUNT and UNTIL. Anything else
    // returns null and the caller treats the event as non-recurring.
    //
    // `seriesStart` is a parsed date record from parseIcsDateValue ({ date,
    // wall, tzid, isDateOnly }) or a plain Date (read as UTC wall clock).
    // Iteration happens in the series' own wall-clock domain and each
    // occurrence converts wall clock + TZID → instant, so weekly series keep
    // their local start time across DST transitions.
    static expandRruleOccurrencesInWindow(rrule, seriesStart, windowStart, windowEnd) {
        const startRecord = seriesStart instanceof Date
            ? {
                date: seriesStart,
                wall: {
                    year: seriesStart.getUTCFullYear(), month: seriesStart.getUTCMonth() + 1, day: seriesStart.getUTCDate(),
                    hour: seriesStart.getUTCHours(), minute: seriesStart.getUTCMinutes(), second: seriesStart.getUTCSeconds()
                },
                tzid: 'UTC', isDateOnly: false
            }
            : seriesStart;
        if (!startRecord || !(startRecord.date instanceof Date) || isNaN(startRecord.date.getTime()) || !startRecord.wall) {
            return null;
        }
        const parts = SharedCore.parseRruleParts(rrule);
        if (!parts || !parts.FREQ) return null;
        const supportedKeys = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'COUNT', 'UNTIL', 'WKST']);
        for (const key of Object.keys(parts)) {
            if (!supportedKeys.has(key)) return null;
        }
        const freq = parts.FREQ;
        if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') return null;
        const interval = parts.INTERVAL === undefined ? 1 : parseInt(parts.INTERVAL, 10);
        if (!Number.isFinite(interval) || interval < 1) return null;
        const count = parts.COUNT === undefined ? null : parseInt(parts.COUNT, 10);
        if (count !== null && (!Number.isFinite(count) || count < 1)) return null;
        let untilMs = null;
        if (parts.UNTIL !== undefined) {
            const untilRecord = SharedCore.parseIcsDateValue('', parts.UNTIL);
            if (!untilRecord) return null;
            // Date-only UNTIL bounds the whole final day.
            untilMs = untilRecord.date.getTime() + (untilRecord.isDateOnly ? (24 * 60 * 60 * 1000) - 1 : 0);
        }

        const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
        const DAY_MS = 24 * 60 * 60 * 1000;
        const wall = startRecord.wall;
        const startDayMs = Date.UTC(wall.year, wall.month - 1, wall.day);
        const startWeekday = new Date(startDayMs).getUTCDay();

        // BYDAY handling per FREQ.
        let weeklyWeekdays = null;   // sorted array of weekday numbers (0=SU)
        let monthlyOrdinal = null;   // { ordinal, weekday } or null (day-of-month monthly)
        if (parts.BYDAY !== undefined) {
            const tokens = parts.BYDAY.split(',').map(token => token.trim()).filter(Boolean);
            if (tokens.length === 0) return null;
            if (freq === 'WEEKLY' || freq === 'DAILY') {
                const weekdays = [];
                for (const token of tokens) {
                    const weekday = WEEKDAY_CODES.indexOf(token);
                    if (weekday === -1) return null; // ordinal BYDAY is not a weekly shape
                    weekdays.push(weekday);
                }
                if (freq === 'DAILY') {
                    // BYDAY on DAILY is out of published scope — unsupported.
                    return null;
                }
                weeklyWeekdays = Array.from(new Set(weekdays)).sort((a, b) => a - b);
            } else {
                if (tokens.length !== 1) return null;
                const ordinalMatch = tokens[0].match(/^(-?\d)(SU|MO|TU|WE|TH|FR|SA)$/);
                if (!ordinalMatch) return null;
                const ordinal = parseInt(ordinalMatch[1], 10);
                if (!Number.isFinite(ordinal) || ordinal === 0 || Math.abs(ordinal) > 5) return null;
                monthlyOrdinal = { ordinal, weekday: WEEKDAY_CODES.indexOf(ordinalMatch[2]) };
            }
        }
        if (freq === 'WEEKLY' && !weeklyWeekdays) {
            weeklyWeekdays = [startWeekday];
        }

        const windowStartMs = (windowStart instanceof Date ? windowStart : new Date(windowStart)).getTime();
        const windowEndMs = (windowEnd instanceof Date ? windowEnd : new Date(windowEnd)).getTime();
        if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs) || windowEndMs < windowStartMs) {
            return [];
        }

        // Candidate wall-clock DAYS (ms at UTC midnight of the wall date), in
        // order from the series start. Generation stops past the window end
        // (with a 2-day margin for timezone skew) or at the iteration cap.
        const marginMs = 2 * DAY_MS;
        const maxCandidates = 5000;
        const candidateDays = [];
        if (freq === 'DAILY') {
            for (let i = 0; ; i++) {
                const dayMs = startDayMs + (i * interval * DAY_MS);
                if (dayMs > windowEndMs + marginMs || candidateDays.length >= maxCandidates) break;
                candidateDays.push(dayMs);
            }
        } else if (freq === 'WEEKLY') {
            // Weeks count from the series start's week (WKST=MO, Google's default).
            const weekStartMs = startDayMs - ((((startWeekday - 1) % 7) + 7) % 7) * DAY_MS;
            outerWeekly:
            for (let week = 0; ; week++) {
                const thisWeekStartMs = weekStartMs + (week * interval * 7 * DAY_MS);
                if (thisWeekStartMs > windowEndMs + marginMs) break;
                for (const weekday of weeklyWeekdays) {
                    // Offset of `weekday` within a MO-started week.
                    const offsetDays = (((weekday - 1) % 7) + 7) % 7;
                    const dayMs = thisWeekStartMs + (offsetDays * DAY_MS);
                    if (dayMs < startDayMs) continue; // before DTSTART
                    if (dayMs > windowEndMs + marginMs) continue;
                    if (candidateDays.length >= maxCandidates) break outerWeekly;
                    candidateDays.push(dayMs);
                }
            }
        } else { // MONTHLY
            const monthIndexOf = (year, month) => (year * 12) + (month - 1);
            const startMonthIndex = monthIndexOf(wall.year, wall.month);
            for (let step = 0; ; step++) {
                const monthIndex = startMonthIndex + (step * interval);
                const year = Math.floor(monthIndex / 12);
                const month = (monthIndex % 12) + 1;
                const monthStartMs = Date.UTC(year, month - 1, 1);
                if (monthStartMs > windowEndMs + marginMs || candidateDays.length >= maxCandidates) break;
                const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
                let day = null;
                if (monthlyOrdinal) {
                    const { ordinal, weekday } = monthlyOrdinal;
                    if (ordinal > 0) {
                        const firstWeekday = new Date(monthStartMs).getUTCDay();
                        day = 1 + ((weekday - firstWeekday + 7) % 7) + ((ordinal - 1) * 7);
                    } else {
                        const lastWeekday = new Date(Date.UTC(year, month - 1, daysInMonth)).getUTCDay();
                        day = daysInMonth - ((lastWeekday - weekday + 7) % 7) + ((ordinal + 1) * 7);
                    }
                    if (day < 1 || day > daysInMonth) continue; // no such ordinal this month
                } else {
                    day = wall.day;
                    if (day > daysInMonth) continue; // RFC: skip months without the day
                }
                const dayMs = Date.UTC(year, month - 1, day);
                if (dayMs < startDayMs) continue;
                candidateDays.push(dayMs);
            }
        }

        // Wall date → occurrence instant; apply COUNT/UNTIL from the series
        // start (both bound the whole series, not just the window slice).
        const occurrences = [];
        let occurrenceIndex = 0;
        for (const dayMs of candidateDays) {
            const dayDate = new Date(dayMs);
            const occurrenceWall = {
                year: dayDate.getUTCFullYear(), month: dayDate.getUTCMonth() + 1, day: dayDate.getUTCDate(),
                hour: wall.hour || 0, minute: wall.minute || 0, second: wall.second || 0
            };
            const instant = startRecord.isDateOnly
                ? new Date(Date.UTC(occurrenceWall.year, occurrenceWall.month - 1, occurrenceWall.day))
                : SharedCore.zonedWallClockToUtc(occurrenceWall, startRecord.tzid);
            if (!instant || isNaN(instant.getTime())) continue;
            occurrenceIndex += 1;
            if (count !== null && occurrenceIndex > count) break;
            if (untilMs !== null && instant.getTime() > untilMs) break;
            const instantMs = instant.getTime();
            if (instantMs >= windowStartMs && instantMs <= windowEndMs) {
                occurrences.push(instant);
            }
        }
        return occurrences;
    }

    // Parsed VEVENT records + a window → the flat existing-event objects the
    // merge machinery consumes (same shape ScriptableAdapter.getExistingEvents
    // returns from EventKit): identifier (raw ICS UID; series occurrences all
    // share their series UID, matching how EventKit surfaces instances),
    // title, startDate/endDate (Date instants), notes (DESCRIPTION — the
    // calendar-as-database key:value format), location, isAllDay, url, plus
    // `recurrence` on series occurrences so the hands-off recurring path fires
    // even when the window holds a single instance. EXDATEs are excluded and
    // RECURRENCE-ID override VEVENTs replace their matching occurrence.
    // Series with an unsupported RRULE are listed in `unsupportedRrules` and
    // included as plain one-off events (fail toward today's behavior).
    static expandPublishedCalendarEventsInWindow(records, windowStart, windowEnd) {
        const result = { events: [], unsupportedRrules: [] };
        if (!Array.isArray(records)) return result;
        const windowStartDate = windowStart instanceof Date ? windowStart : new Date(windowStart);
        const windowEndDate = windowEnd instanceof Date ? windowEnd : new Date(windowEnd);
        if (isNaN(windowStartDate.getTime()) || isNaN(windowEndDate.getTime())) return result;

        const overlapsWindow = (start, end) => {
            if (!(start instanceof Date) || isNaN(start.getTime())) return false;
            const effectiveEnd = end instanceof Date && !isNaN(end.getTime()) ? end : start;
            return start.getTime() <= windowEndDate.getTime() && effectiveEnd.getTime() >= windowStartDate.getTime();
        };
        const toEvent = (record, startDate, endDate, extra) => ({
            identifier: record.uid,
            title: record.summary || '',
            startDate,
            endDate,
            location: record.location || '',
            notes: record.description || '',
            url: record.url || '',
            isAllDay: Boolean(record.isAllDay),
            ...(extra || {})
        });
        const recordEnd = (record) => (record.end && record.end.date) ? record.end.date : record.start.date;

        // Override instants per series UID (RECURRENCE-ID VEVENTs replace the
        // matching expanded occurrence).
        const overrideInstantsByUid = new Map();
        for (const record of records) {
            if (!record || !record.uid || !record.recurrenceId || !record.recurrenceId.date) continue;
            if (!overrideInstantsByUid.has(record.uid)) overrideInstantsByUid.set(record.uid, new Set());
            overrideInstantsByUid.get(record.uid).add(record.recurrenceId.date.getTime());
        }

        for (const record of records) {
            if (!record || !record.uid || !record.start || !(record.start.date instanceof Date)) continue;

            if (record.recurrenceId) {
                // Override instance: stands on its own dates (its expanded
                // source occurrence is suppressed via overrideInstantsByUid).
                if (overlapsWindow(record.start.date, recordEnd(record))) {
                    result.events.push(toEvent(record, record.start.date, recordEnd(record)));
                }
                continue;
            }

            if (record.rrule) {
                const occurrenceStarts = SharedCore.expandRruleOccurrencesInWindow(
                    record.rrule, record.start, windowStartDate, windowEndDate
                );
                if (occurrenceStarts === null) {
                    result.unsupportedRrules.push({ uid: record.uid, rrule: record.rrule });
                    if (overlapsWindow(record.start.date, recordEnd(record))) {
                        result.events.push(toEvent(record, record.start.date, recordEnd(record)));
                    }
                    continue;
                }
                const durationMs = Math.max(0, recordEnd(record).getTime() - record.start.date.getTime());
                const excludedInstants = new Set((record.exdates || [])
                    .filter(exdate => exdate && exdate.date)
                    .map(exdate => exdate.date.getTime()));
                const overrideInstants = overrideInstantsByUid.get(record.uid) || new Set();
                for (const occurrenceStart of occurrenceStarts) {
                    const startMs = occurrenceStart.getTime();
                    if (excludedInstants.has(startMs) || overrideInstants.has(startMs)) continue;
                    result.events.push(toEvent(
                        record, occurrenceStart, new Date(startMs + durationMs), { recurrence: record.rrule }
                    ));
                }
                continue;
            }

            if (overlapsWindow(record.start.date, recordEnd(record))) {
                result.events.push(toEvent(record, record.start.date, recordEnd(record)));
            }
        }
        return result;
    }

    // Pure decision for the wide-window identifier probe: ≥2 calendar
    // instances sharing the matched identifier means the identifier belongs
    // to a recurring series (occurrences of a series share one identifier).
    static resolveSeriesProbeDecision(events, identifier) {
        const normalized = identifier === null || identifier === undefined
            ? ''
            : String(identifier).trim();
        if (!normalized || !Array.isArray(events)) {
            return { instanceCount: 0, isSeries: false };
        }
        let instanceCount = 0;
        for (const candidate of events) {
            if (!candidate) continue;
            const candidateIdentifier = candidate.identifier === null || candidate.identifier === undefined
                ? ''
                : String(candidate.identifier).trim();
            if (candidateIdentifier === normalized) {
                instanceCount += 1;
            }
        }
        return { instanceCount, isSeries: instanceCount >= 2 };
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
            // rrule → event.recurrenceRule: extraction is anti-hallucination
            // gated in the schema prompt line (explicit repeat schedules only).
            // Recurring events are display+export only — never auto-written to
            // the calendar (see prepareEventsForCalendar RECURRING withhold).
            rrule: { priority: ["ai-web"], merge: "ai" },
            bar: { priority: ["ai-web"], merge: "ai" },
            address: { priority: ["ai-web"], merge: "ai" },
            startDate: { priority: ["ai-web"], merge: "ai" },
            endDate: { priority: ["ai-web"], merge: "ai" },
            url: { priority: ["ai-web"], merge: "ai" },
            location: { priority: ["ai-web"], merge: "ai" },
            gmaps: { priority: ["ai-web"], merge: "ai" },
            image: { priority: ["ai-web"], merge: "ai" },
            // Orientation slots merge exactly like the primary image. Without
            // an entry here they would inherit the "upsert" default
            // (calendarValue || scraperValue) — write-once, stale forever: the
            // first portrait ever stored could never be replaced by a better
            // one. "ai" routes them through the deterministic image rung first
            // (logo-path / og-grade provenance / resolution margin), and the
            // never-clear guard in createFinalEventObject keeps a curated slot
            // when a run finds no candidate of that shape.
            imageVertical: { priority: ["ai-web"], merge: "ai" },
            imageHorizontal: { priority: ["ai-web"], merge: "ai" },
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
        this.applyStaticMetadataBlock(event, parserConfig?.metadata, fieldPriorities);


        // Return the event with all fields intact
        // The actual priority logic will be handled later during event merging
        return event;
    }

    // The static-metadata application loop (factored from applyFieldPriorities
    // so the promoter registry can stamp curated facts through the exact same
    // machinery as parser metadata — parser behavior is byte-identical).
    applyStaticMetadataBlock(event, metadataBlock, fieldPriorities) {
        if (metadataBlock) {
            Object.keys(metadataBlock).forEach(key => {
                const metaValue = metadataBlock[key];
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
    async prepareEventsForCalendar(events, calendarAdapter, config = {}, bearOverrideContext = null) {
        // Events are already properly formatted - no need for additional formatting

        // Use default merge mode since parser-level mergeMode is handled by field priorities
        const mergeMode = config.mergeMode || 'upsert';

        // Analyze each event against existing calendar events
        const analyzedEvents = [];

        for (const event of events) {
            // Get existing events from the adapter
            const existingEvents = await calendarAdapter.getExistingEvents(event);

            // Analyze what action to take (with the adapter-side recurring
            // series probe when a merge match carries no series signal yet)
            const analysis = await this.resolveCalendarAnalysisWithSeriesProbe(event, existingEvents, mergeMode, calendarAdapter);

            // Manual override, demote direction: a kept event whose identity-
            // matched calendar record carries `bearSource: manual-not-bear…` is
            // NOT merged/written — the calendar record stays as-is (the hidden
            // tombstone) and the event surfaces as an overridden drop instead.
            // A scraped manual-* verdict (a fresh owner tap from the results
            // UI) is newer than the stored one and is never demoted by it.
            // Reuses the existing-event search prep just performed — no extra
            // calendar scans.
            if (bearOverrideContext && !this.isManualBearSource(event.bearSource)) {
                const matchedRecord = analysis.existingEvent || analysis.sourceEvent || null;
                if (matchedRecord && this.getManualBearVerdictFromRecord(matchedRecord) === 'manual-not-bear') {
                    console.log(`🐻 BEAR CHECK: "${event.title || 'Unknown'}" → not_bear (manual override on calendar record)`);
                    if (Array.isArray(bearOverrideContext.demoted)) {
                        bearOverrideContext.demoted.push({
                            title: event.title || 'Unknown',
                            startDate: event.startDate || null,
                            venue: event.bar || event.venue || '',
                            reason: 'manual-not-bear (manual override on calendar record)',
                            host: this.getHostFromUrl(event._sourcePageUrl || event.url || event.website || '') || '',
                            event: { ...event },
                            demoted: true
                        });
                    }
                    continue;
                }
            }

            analyzedEvents.push(await this.buildAnalyzedCalendarEvent(event, analysis, calendarAdapter, config));
        }

        // Manual override, rescue direction: an enforce-mode dropped event whose
        // identity-matched calendar record carries `bearSource: manual-bear…`
        // is treated as kept and proceeds through the normal merge/write path.
        // Only ambiguous (dropped) events get this one extra existing-event
        // search — absence of a match simply means the drop stands.
        if (bearOverrideContext && Array.isArray(bearOverrideContext.droppedEvents)) {
            for (const dropped of bearOverrideContext.droppedEvents) {
                const droppedEvent = dropped && dropped.event;
                if (!droppedEvent || dropped.rescued) continue;
                const existingEvents = await calendarAdapter.getExistingEvents(droppedEvent);
                const analysis = await this.resolveCalendarAnalysisWithSeriesProbe(droppedEvent, existingEvents, mergeMode, calendarAdapter);
                const matchedRecord = analysis.existingEvent || analysis.sourceEvent || null;
                if (!matchedRecord || this.getManualBearVerdictFromRecord(matchedRecord) !== 'manual-bear') continue;
                console.log(`🐻 BEAR CHECK: "${droppedEvent.title || 'Unknown'}" → bear (manual override on calendar record)`);
                const rescuedEvent = { ...droppedEvent, isBearEvent: true };
                analyzedEvents.push(await this.buildAnalyzedCalendarEvent(rescuedEvent, analysis, calendarAdapter, config));
                dropped.rescued = true;
                if (Array.isArray(bearOverrideContext.rescued)) {
                    bearOverrideContext.rescued.push(dropped);
                }
            }
        }

        return analyzedEvents;
    }

    // One event's calendar-prep analysis (extracted from prepareEventsForCalendar
    // so manually rescued events run the exact same merge/diff pipeline).
    async buildAnalyzedCalendarEvent(event, analysis, calendarAdapter, config = {}) {
        // (Block wrapper keeps the extracted loop body byte-identical to its
        // original prepareEventsForCalendar form — minimal, reviewable diff.)
        {
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

            // Final-stage field cleanups. Both run at the FINAL analyzed-event
            // build (so every parser, merge result, and cached AI response
            // passes through them) and BEFORE the notes generation/rebuild
            // below, so the cleaned values are what notes serialize.
            let notesNeedRebuild = false;

            // Description formatting sanitizer (run 20260729-125201: dice.fm
            // shipped markdown "**BEEFMINCE ...**" and a Wix site shipped raw
            // HTML + a literal "\n" — both reached notes verbatim). Pure
            // function lives in normalizers.js; reached via the injected
            // pipeline (shared-core never loads modules itself).
            if (this.normalizerPipeline
                && typeof this.normalizerPipeline.sanitizeDescriptionFormatting === 'function'
                && typeof analyzedEvent.description === 'string' && analyzedEvent.description) {
                const sanitizedDescription = this.normalizerPipeline.sanitizeDescriptionFormatting(analyzedEvent.description);
                if (sanitizedDescription !== analyzedEvent.description) {
                    analyzedEvent.description = sanitizedDescription;
                    notesNeedRebuild = true;
                    console.log(`🧼 DESCRIPTION: stripped formatting markup for "${analyzedEvent.title || 'event'}"`);
                }
            }

            // ticketUrl dedup (run 20260729-125247: CubScout's notes carried
            // the same eaglela.com link three ways — url, website, ticketUrl).
            // url/website are ONE canonical field by design; a ticketUrl that
            // is byte-identical to it adds nothing and reads as clutter, so
            // it is dropped. A ticketUrl pointing anywhere else is a real
            // ticketing link and always survives.
            {
                const canonicalWebsite = typeof analyzedEvent.website === 'string' && analyzedEvent.website.trim()
                    ? analyzedEvent.website.trim()
                    : (typeof analyzedEvent.url === 'string' ? analyzedEvent.url.trim() : '');
                const ticketUrl = typeof analyzedEvent.ticketUrl === 'string' ? analyzedEvent.ticketUrl.trim() : '';
                if (ticketUrl && canonicalWebsite && ticketUrl === canonicalWebsite) {
                    delete analyzedEvent.ticketUrl;
                    notesNeedRebuild = true;
                    console.log(`🔗 LINKS: dropped ticketUrl duplicating website for "${analyzedEvent.title || 'event'}"`);
                }
            }

            // gmaps rebuild from settled facts (run 20260729-125201: events
            // finished with precise geocode-verified coords in `location`
            // while gmaps still carried the EARLY text-search form built from
            // vague venue text, e.g. query=Horizon%2C%20Brighton%20and%20Hove
            // — Google renders a wide multi-result area for those). Curated
            // data beats derived: a curated bar's googleMaps link wins, then
            // final coordinates; with neither, the existing value stands.
            // Parser-stamped static gmaps (tracked in _staticFields by
            // applyStaticMetadataBlock) is curated config and never rebuilt;
            // a link already anchored to a place_id is more precise than bare
            // coords and is never downgraded (curated adoption still applies).
            {
                const staticFields = analyzedEvent._staticFields && typeof analyzedEvent._staticFields === 'object'
                    ? analyzedEvent._staticFields
                    : {};
                const existingGmaps = typeof analyzedEvent.gmaps === 'string' ? analyzedEvent.gmaps.trim() : '';
                if (!Object.prototype.hasOwnProperty.call(staticFields, 'gmaps')) {
                    const cityBars = this.getCuratedCityBars(analyzedEvent.city);
                    const curatedBar = cityBars && typeof analyzedEvent.bar === 'string' && analyzedEvent.bar.trim()
                        ? this.findCuratedBarByName(cityBars, analyzedEvent.bar)
                        : null;
                    const curatedGmaps = curatedBar && typeof curatedBar.googleMaps === 'string'
                        ? curatedBar.googleMaps.trim()
                        : '';
                    const finalCoordinates = this.parseCoordinatePair(analyzedEvent.location);
                    if (curatedGmaps && curatedGmaps !== existingGmaps) {
                        analyzedEvent.gmaps = curatedGmaps;
                        notesNeedRebuild = true;
                        console.log(`🗺️ GMAPS: adopted curated googleMaps link for "${analyzedEvent.title || 'event'}"`);
                    } else if (!curatedGmaps && finalCoordinates && !existingGmaps.includes('place_id')) {
                        const coordinateGmaps = SharedCore.generateGoogleMapsUrl({
                            coordinates: finalCoordinates,
                            placeId: null,
                            address: null,
                            venueName: null,
                            cityName: null
                        }) || '';
                        if (coordinateGmaps && coordinateGmaps !== existingGmaps) {
                            analyzedEvent.gmaps = coordinateGmaps;
                            notesNeedRebuild = true;
                            console.log(`🗺️ GMAPS: rebuilt link from verified coordinates for "${analyzedEvent.title || 'event'}"`);
                        }
                    }
                }
            }

            // AI shortName derivation: an event that reaches the final build
            // without a shortName renders its full title on the city-page
            // calendar chip. Derive one from the title (passLabel
            // 'short-name', cached — the prompt carries the title only, so
            // repeat runs hit the cache), guarded by the deterministic
            // verbatim gate in evaluateDerivedShortName. Parser-stamped
            // static shortNames (_staticFields) are curated config and never
            // derived over; every gate/transport failure leaves the event
            // exactly as today.
            {
                const shortNameParserConfig = analyzedEvent._parserConfig || (config && config.ai ? { ai: config.ai } : null);
                if (await this.deriveShortNameForEvent(analyzedEvent, shortNameParserConfig, calendarAdapter)) {
                    notesNeedRebuild = true;
                }
            }

            if (notesNeedRebuild && analyzedEvent.notes) {
                analyzedEvent.notes = this.formatEventNotes(analyzedEvent);
            }

            // Generate notes for ALL events to ensure consistent preview display
            // This ensures new, merge, and conflict events all have notes for the preview
            if (!analyzedEvent.notes) {
                analyzedEvent.notes = this.formatEventNotes(analyzedEvent);
            }

            // Final overlong-field trim pass: field-trim runs in processParser
            // BEFORE dedup/merge, so the final object can carry an untrimmed
            // value back (observed 2026-07-28: goldiloxx final title 72 chars
            // despite a logged 72 → 58 enforce trim — the merge kept the
            // longer side). Re-apply the trim to whatever the FINAL value is,
            // but ONLY for actions with a scraped contribution ('merge' and
            // 'new', both built by createFinalEventObject from the scraped
            // record). Any other action is treated as a pure calendar-side
            // preserve of the record's values (conservative: 'conflict'
            // carries exactly the scraped values the pre-merge pass already
            // handled) — those stay flag-only via the detection loop below,
            // never AI-trimmed here. Runs BEFORE _evidenceLines so the
            // updated _fieldTrims records render on the card.
            const trimParserConfig = analyzedEvent._parserConfig || (config && config.ai ? { ai: config.ai } : null);
            if (analyzedEvent._action === 'merge' || analyzedEvent._action === 'new') {
                const finalTrimRecords = await this.applyFinalOverlongFieldTrims(analyzedEvent, trimParserConfig, calendarAdapter);
                // title lives in a native calendar field, but description/
                // shortName are serialized INTO notes — and notes were built
                // from the pre-trim values above, so an enforce trim of a
                // notes-carried field must rebuild them or the untrimmed
                // value would still be written to the calendar.
                if (finalTrimRecords.some(record => record && record.status === 'trimmed' && record.field !== 'title')) {
                    analyzedEvent.notes = this.formatEventNotes(analyzedEvent);
                }
            }

            // Computed evidence panel for the results-UI event card (underscore
            // field: display-only, systematically excluded from notes/merge
            // serialization). Computed AFTER the final merged object exists so
            // the lines describe exactly what will be written.
            analyzedEvent._evidenceLines = this.buildEventEvidenceLines(analyzedEvent, { cityKey: analyzedEvent.city });

            // Detection-only overlong flag for calendar-sourced values: the
            // trim pipeline only ever sees scraped values (and stamps them
            // with _fieldTrims), so a final value that exceeds its limit on a
            // field WITHOUT a trim record came through the calendar side —
            // which is never AI-trimmed. No AI call here, just visibility.
            const overlongTrimConfig = this.getTrimConfig(trimParserConfig);
            if (overlongTrimConfig.mode !== 'off') {
                const recordedTrimFields = new Set(
                    (Array.isArray(analyzedEvent._fieldTrims) ? analyzedEvent._fieldTrims : [])
                        .map(trim => trim && trim.field)
                        .filter(Boolean)
                );
                for (const overlong of this.findOverlongFields(analyzedEvent, overlongTrimConfig)) {
                    if (recordedTrimFields.has(overlong.field)) continue;
                    analyzedEvent._evidenceLines.push(`⚠️ ${overlong.field} overlong (${overlong.value.length} > ${overlong.maxChars} chars) — calendar-sourced, not trimmed`);
                }
            }

            // Recurring series are display+export only: keep the card in the
            // results UI (flag-don't-drop) but withhold it from calendar
            // execution — the owner saves the series via the ICS export
            // button instead (the scraper never writes recurring series).
            if (SharedCore.isRecurringSeriesEvent(event)) {
                analyzedEvent._recurring = true;
                analyzedEvent._recurringExport = true;
                if (!analyzedEvent.recurrenceRule && typeof event.recurrenceRule === 'string') {
                    analyzedEvent.recurrenceRule = event.recurrenceRule;
                }
                // No stated start time (derived-occurrence series): the ICS
                // export needs a real time — the card gates the 💾 button off
                // and leaves the Event Builder link (scriptable-adapter).
                if (event._recurringNoStartTime === true) {
                    analyzedEvent._recurringNoStartTime = true;
                }
                // Override identity is WRITE identity: it names a single
                // occurrence to replace inside an existing series. A series we
                // are withholding will never be written by the scraper, so
                // stamping it is incoherent — and it leaked into the merge plan
                // and the stored notes (CubScout 2026-07-30: overrideUid +
                // overrideRecurrenceId appeared as ADDED fields on an event the
                // same run refused to write). The series still round-trips
                // through the ICS export, which mints its own UID.
                if (analyzedEvent.overrideUid || analyzedEvent.overrideRecurrenceId) {
                    delete analyzedEvent.overrideUid;
                    delete analyzedEvent.overrideRecurrenceId;
                    if (analyzedEvent.notes) {
                        analyzedEvent.notes = this.formatEventNotes(analyzedEvent);
                    }
                    console.log(`🔁 RECURRING: "${event.title || 'Unknown'}" dropped override identity — the scraper never writes series occurrences`);
                }
                console.log(`🔁 RECURRING: "${event.title || 'Unknown'}" withheld from calendar write — save via ICS export`);
            }

            return analyzedEvent;
        }
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
        const timezone = event?.timezone || this.getCityTimezone(event ? event.city : null) || null;
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
        
        const eventTimezone = event.timezone || this.getCityTimezone(event.city) || null;
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
            const detectedSource = this.detectSourceFromUrl(urlCandidate);
            if (detectedSource) {
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
                const detectedSource = this.detectSourceFromUrl(targetEventOrKey.url);
                if (detectedSource) {
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
    // Tolerant date comparison. Accepts Dates, ISO strings and epoch numbers,
    // and returns FALSE (not equal → no match, the conservative answer) when a
    // side is missing or unparseable.
    //
    // It used to call .getTime() straight on both arguments, so one non-Date
    // anywhere in the candidate set threw and killed the entire run
    // ("TypeError: date2.getTime is not a function", 2026-07-30, surfaced once
    // allowPastEvents opened up far more calendar candidates). A matching
    // helper is the wrong place to end a run: the worst it should do is
    // decline a match. The one-time warn names the offending value so the real
    // source is findable in the next log instead of guessed at.
    areDatesEqual(date1, date2, toleranceMinutes) {
        const ms1 = this.toEpochMillis(date1);
        const ms2 = this.toEpochMillis(date2);
        if (ms1 === null || ms2 === null) {
            if (!this._warnedNonDateComparison) {
                this._warnedNonDateComparison = true;
                const describe = (value) => {
                    if (value === null || value === undefined) return String(value);
                    return `${typeof value}:${String(value).slice(0, 40)}`;
                };
                console.warn(`⚠️ SharedCore: areDatesEqual got a non-date — a=${describe(date1)} b=${describe(date2)} (treated as not equal)`);
            }
            return false;
        }
        return Math.abs(ms1 - ms2) <= (toleranceMinutes * 60 * 1000);
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
                || this.getCityTimezone(event.city)
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

    // Same-event URL identity for the second dedup pass. `url` first — byte
    // for byte what this pass has always used — and ONLY when the url yields
    // no key at all (empty, non-http, or a bare domain root) does the
    // canonical `website` field get a turn. url and website are ONE field in
    // this project (aliases; canonical `website:` in notes), so the event
    // page can arrive under either key: run 20260731-120505 split "CHUNK
    // BROOKLYN - The Return!" into two calendar events because the detail
    // record carried the event page as `url` while its junk twin carried the
    // SITE ROOT as url and the byte-identical event page as `website`.
    // Because the website is consulted only where the url produced nothing,
    // this can add merges but can never redirect or remove an existing one.
    // One exclusion: a statically stamped `website` is curated parser/promoter
    // metadata pasted onto EVERY event this parser emits, so a shared value
    // there is branding, not same-event evidence. The stamp on `url` is NOT an
    // exclusion — the opposite, in fact: in run 20260731-120505 the junk twin's
    // _staticFields carried url = the chunk-party.com ROOT while `website`
    // still held the organically extracted event page, which is precisely the
    // value this fallback needs. The caller's listing-page (>= 3 events per
    // key) and 7-day-window guards apply to the resulting key unchanged.
    getEventIdentityUrlKey(event) {
        const urlKey = this.getEventUrlIdentityKey(event && event.url);
        if (urlKey) return urlKey;
        const staticFields = event && event._staticFields && typeof event._staticFields === 'object'
            ? event._staticFields
            : {};
        if (Object.prototype.hasOwnProperty.call(staticFields, 'website')) return null;
        return this.getEventUrlIdentityKey(event && event.website);
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

    // === Cross-source duplicate detection (within one parser run) ===
    // A parser that crawls BOTH a venue site and a ticketing/organizer page
    // receives the same real-world event twice with variant titles ("Pet Night
    // with DJ Boost" vs "It's PET NIGHT at the Dallas Eagle! …" — runs
    // 20260724-155934 / 20260725-170926). The identity signals above miss those
    // pairs: name similarity is containment-based and one record may carry no
    // bar/address at all (only a _venueSitePageHost tag). These helpers add a
    // stricter-scoped signal — same venue identity AND same event night AND
    // title-token subset — used ONLY by the cross-source pass inside
    // deduplicateEvents, never for scraped-vs-calendar decisions.

    // The local "night" an event belongs to, as YYYY-MM-DD, or '' when the
    // start date is missing/unparseable (fail closed: nightless events never
    // pair). Convention mirrors the #1540 end-marker rollover: a start in the
    // wee hours (strictly after local midnight, before 04:00) belongs to the
    // PREVIOUS night. A start at exactly local midnight is the missing-time
    // default (extraction found only a date), so it stays on its stated date —
    // the site said "July 31", meaning the night of July 31. Events flagged
    // _timezoneUnresolved store wall-clock components labeled UTC, so their
    // UTC components ARE the local reading; the same applies when no timezone
    // is resolvable at all.
    getEventNightKey(event) {
        if (!event || typeof event !== 'object') return '';
        const date = event.startDate instanceof Date ? event.startDate : this.parseDate(event.startDate);
        if (!date || isNaN(date.getTime())) return '';
        const timezone = event._timezoneUnresolved
            ? null
            : (event.timezone || this.getCityTimezone(event.city) || null);
        let year = date.getUTCFullYear();
        let month = date.getUTCMonth() + 1;
        let day = date.getUTCDate();
        let hour = date.getUTCHours();
        let minute = date.getUTCMinutes();
        if (timezone && typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
            try {
                const formatter = new Intl.DateTimeFormat('en-CA', {
                    timeZone: timezone,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    hourCycle: 'h23'
                });
                const parts = formatter.formatToParts(date);
                const read = (type) => {
                    const part = parts.find(entry => entry.type === type);
                    return part ? parseInt(part.value, 10) : NaN;
                };
                const localYear = read('year');
                const localMonth = read('month');
                const localDay = read('day');
                const localHour = read('hour');
                const localMinute = read('minute');
                if ([localYear, localMonth, localDay, localHour, localMinute].every(Number.isFinite)) {
                    year = localYear;
                    month = localMonth;
                    day = localDay;
                    hour = localHour % 24;
                    minute = localMinute;
                }
            } catch (_) {
                // Unresolvable timezone → fall through to the UTC components.
            }
        }
        let nightUtc = Date.UTC(year, month - 1, day);
        if ((hour > 0 || minute > 0) && hour < 4) {
            nightUtc -= 24 * 60 * 60 * 1000;
        }
        const night = new Date(nightUtc);
        const pad = (value) => String(value).padStart(2, '0');
        return `${night.getUTCFullYear()}-${pad(night.getUTCMonth() + 1)}-${pad(night.getUTCDate())}`;
    }

    // Positive same-venue identity for the cross-source pass. Requires the SAME
    // axis populated on BOTH sides — missing-vs-present is never a match (fail
    // closed). Axes: equal bar-name keys, equal normalized address token
    // strings, or the same venue-site page host tag (#1539's
    // _venueSitePageHost — the run's "Eagle Karaoke" record carried no bar at
    // all but was scraped from thedallaseagle.com just like its twin).
    // A fourth axis, bar-in-address, covers one side's MULTI-WORD bar name
    // appearing verbatim as a contiguous token run inside the other side's
    // address (run 20260727-145617: bar "Bain Mathieu" vs an address that
    // literally named the venue — "Bain Mathieu, 2915 Rue Ontario E").
    // Multi-token names only, fail closed: single-word bar names like
    // "Eagle" collide with street names.
    getCrossSourceVenueIdentity(eventA, eventB) {
        if (!eventA || !eventB) return null;
        const barA = this.normalizeBarNameKey(eventA.bar);
        const barB = this.normalizeBarNameKey(eventB.bar);
        if (barA && barB && barA === barB) return 'bar';
        const addressTokensA = this.normalizeAddressTokens(eventA.address);
        const addressTokensB = this.normalizeAddressTokens(eventB.address);
        const addressA = addressTokensA.join(' ');
        const addressB = addressTokensB.join(' ');
        if (addressA && addressB && addressA === addressB) return 'address';
        const containsTokenRun = (haystack, needle) => {
            if (needle.length < 2 || haystack.length < needle.length) return false;
            for (let start = 0; start + needle.length <= haystack.length; start++) {
                if (needle.every((token, offset) => haystack[start + offset] === token)) return true;
            }
            return false;
        };
        if (containsTokenRun(addressTokensB, this.normalizeAddressTokens(eventA.bar))
            || containsTokenRun(addressTokensA, this.normalizeAddressTokens(eventB.bar))) {
            return 'bar-in-address';
        }
        const hostA = String(eventA._venueSitePageHost || '').trim().toLowerCase();
        const hostB = String(eventB._venueSitePageHost || '').trim().toLowerCase();
        if (hostA && hostB && hostA === hostB) return 'venue-site';
        return null;
    }

    // Significant title tokens for the cross-source subset test: HTML-entity
    // leftovers and emoji stripped, lowercased, punctuation collapsed; a
    // trailing performer clause ("with DJ Boost", "featuring Stevie Licks",
    // "w/ Hyeonje") is cut at its lexical marker; stopwords, single-character
    // debris, and the venue's own name tokens are dropped. venueKeys are
    // normalizeBarNameKey-style strings ("dallaseagle", "thedallaseagle") —
    // a token is a venue token when a key contains it.
    // City-name tokens are ALSO dropped (run 20260727-145617: "Concours PUP
    // Montréal" vs "Concours PUP MTL" failed the subset test on montréal ≠
    // mtl — the city suffix is branding, not identity). Diacritics are folded
    // BEFORE tokenization so "Montréal" is one token ("montreal"), and city
    // stripping never empties the set (a title that is nothing but city names
    // keeps its tokens — fail closed).
    getCrossSourceTitleTokens(title, venueKeys = []) {
        const text = this.foldDiacritics(this.stripEmojiForTitleTwin(
            String(title || '').replace(/&#?[0-9a-z]+;/gi, '')
        )).replace(/[^a-z0-9]+/g, ' ').trim();
        if (!text) return [];
        const rawTokens = text.split(/\s+/);
        const performerMarkers = new Set(['with', 'featuring', 'feat', 'ft', 'w']);
        const markerIndex = rawTokens.findIndex(token => performerMarkers.has(token));
        const scopedTokens = markerIndex > 0 ? rawTokens.slice(0, markerIndex) : rawTokens;
        const stopwords = new Set([
            'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in',
            'into', 'is', 'it', 'its', 'of', 'on', 'or', 'our', 'the', 'this',
            'to', 'too', 'with', 'yall', 'you', 'your'
        ]);
        const keys = (Array.isArray(venueKeys) ? venueKeys : []).filter(Boolean);
        const cityTokens = this.getCityAliasTokenSet();
        const tokens = [];
        const tokensWithCity = [];
        for (const token of scopedTokens) {
            if (token.length <= 1) continue;
            if (stopwords.has(token)) continue;
            if (token.length >= 3 && keys.some(key => key.includes(token))) continue;
            if (!tokensWithCity.includes(token)) tokensWithCity.push(token);
            if (token.length >= 3 && cityTokens.has(token)) continue;
            if (!tokens.includes(token)) tokens.push(token);
        }
        return tokens.length > 0 ? tokens : tokensWithCity;
    }

    // Folded single-word city-name tokens from the configured cities: every
    // key, display name, pattern, and alias that reduces to ONE token of >= 3
    // chars after diacritic folding ("montreal", "mtl", "nyc"). Multi-word
    // names ("new york", "fire-island") are skipped so generic words like
    // "new" are never treated as city tokens, and 2-char forms ("la") are
    // skipped so French/Spanish articles in titles survive. Cached per cities
    // object (set once in the constructor).
    getCityAliasTokenSet() {
        const source = this.cities && typeof this.cities === 'object' ? this.cities : null;
        if (!source) return new Set();
        if (this._cityAliasTokenSet && this._cityAliasTokenSetSource === source) {
            return this._cityAliasTokenSet;
        }
        const tokens = new Set();
        for (const [key, cityData] of Object.entries(source)) {
            const names = [key]
                .concat(cityData && typeof cityData === 'object' ? [cityData.name] : [])
                .concat(cityData && Array.isArray(cityData.patterns) ? cityData.patterns : [])
                .concat(cityData && Array.isArray(cityData.aliases) ? cityData.aliases : []);
            for (const name of names) {
                const folded = this.foldDiacritics(name).replace(/[^a-z0-9]+/g, ' ').trim();
                if (folded && folded.length >= 3 && !folded.includes(' ')) tokens.add(folded);
            }
        }
        this._cityAliasTokenSet = tokens;
        this._cityAliasTokenSetSource = source;
        return tokens;
    }

    // Returns 'venue+night+title-subset' when two records from ONE parser run
    // describe the same event across sources, else null. Every step fails
    // closed: no venue identity, no/mismatched night, or an empty/disjoint
    // token set never pairs — same venue + same night with disjoint titles is
    // two REAL events (an early show and a late party are common).
    getCrossSourceDuplicateSignal(eventA, eventB) {
        if (!eventA || typeof eventA !== 'object' || !eventB || typeof eventB !== 'object') return null;
        if (!this.getCrossSourceVenueIdentity(eventA, eventB)) return null;
        const nightA = this.getEventNightKey(eventA);
        if (!nightA) return null;
        const nightB = this.getEventNightKey(eventB);
        if (!nightB || nightA !== nightB) return null;
        const venueKeys = [
            this.normalizeBarNameKey(eventA.bar),
            this.normalizeBarNameKey(eventB.bar),
            String(eventA._venueSitePageHost || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
            String(eventB._venueSitePageHost || '').toLowerCase().replace(/[^a-z0-9]/g, '')
        ].filter(Boolean);
        const tokensA = this.getCrossSourceTitleTokens(eventA.title, venueKeys);
        if (tokensA.length === 0) return null;
        const tokensB = this.getCrossSourceTitleTokens(eventB.title, venueKeys);
        if (tokensB.length === 0) return null;
        const [shorter, longer] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
        const longerSet = new Set(longer);
        if (!shorter.every(token => longerSet.has(token))) return null;
        return 'venue+night+title-subset';
    }

    // Primary designation for a cross-source merge: the record with more
    // populated (evidence-gate-surviving) fields wins; tie → the one whose
    // start carries an explicit time of day (not the midnight missing-time
    // default); further tie → the longer normalized title; final tie → the
    // first argument (the already-kept record).
    pickCrossSourcePrimary(eventA, eventB) {
        const populatedFields = (event) => {
            const fields = ['title', 'description', 'startDate', 'endDate', 'bar', 'address',
                'location', 'city', 'url', 'ticketUrl', 'image', 'cover', 'instagram',
                'facebook', 'website', 'gmaps', 'timezone'];
            return fields.filter(field => {
                const value = event[field];
                if (value === null || value === undefined) return false;
                const text = String(value).trim();
                if (!text) return false;
                if (field === 'city' && text.toLowerCase() === 'unknown') return false;
                return true;
            }).length;
        };
        const countA = populatedFields(eventA);
        const countB = populatedFields(eventB);
        if (countA !== countB) return countA > countB ? eventA : eventB;
        const hasExplicitStartTime = (event) => {
            const date = event.startDate instanceof Date ? event.startDate : this.parseDate(event.startDate);
            if (!date || isNaN(date.getTime())) return false;
            const timezone = event._timezoneUnresolved
                ? null
                : (event.timezone || this.getCityTimezone(event.city) || null);
            if (timezone && typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
                try {
                    const formatter = new Intl.DateTimeFormat('en-CA', {
                        timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
                    });
                    const parts = formatter.formatToParts(date);
                    const read = (type) => {
                        const part = parts.find(entry => entry.type === type);
                        return part ? parseInt(part.value, 10) : NaN;
                    };
                    const hour = read('hour');
                    const minute = read('minute');
                    if (Number.isFinite(hour) && Number.isFinite(minute)) {
                        return (hour % 24) !== 0 || minute !== 0;
                    }
                } catch (_) { /* fall through to UTC components */ }
            }
            return date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0;
        };
        const explicitA = hasExplicitStartTime(eventA);
        const explicitB = hasExplicitStartTime(eventB);
        if (explicitA !== explicitB) return explicitA ? eventA : eventB;
        const titleLength = (event) => this.stripEmojiForTitleTwin(String(event.title || ''))
            .replace(/\s+/g, ' ').trim().length;
        if (titleLength(eventA) !== titleLength(eventB)) {
            return titleLength(eventA) > titleLength(eventB) ? eventA : eventB;
        }
        return eventA;
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
            cacheEnabled: aiConfig.cache !== false,
            arbitrateMerges: aiConfig.arbitrateMerges !== false,
            // shortName derivation pass (default ON, like the response cache):
            // `ai: { shortNames: false }` disables it. shortNameDeriveMaxChars
            // caps DERIVED values (16) — separate from the trim pipeline's
            // shortNameMaxChars (30), which governs trimming existing values.
            shortNamesEnabled: aiConfig.shortNames !== false,
            shortNameDeriveMaxChars: Number.isFinite(Number(aiConfig.shortNameDeriveMaxChars)) && Number(aiConfig.shortNameDeriveMaxChars) > 0
                ? Math.floor(Number(aiConfig.shortNameDeriveMaxChars))
                : 16,
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
    // config.ai block covers events whose parser config carries no ai block
    // (e.g. the scriptable-input URL parser).
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

        // Image requests bypass the response cache — the prompt alone does not
        // identify them (the image bytes do), and OCR has its own URL-keyed cache.
        if (!base64Image && this.aiResponseCache) {
            const cachedText = await this.aiResponseCache.read(aiConfig, prompt, passLabel);
            if (typeof cachedText === 'string' && cachedText.length > 0) {
                console.log(`🤖 AI Web: AI response cache hit${label} — response: ${cachedText.length} chars`);
                return cachedText;
            }
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
                if (!base64Image && this.aiResponseCache) {
                    await this.aiResponseCache.write(aiConfig, prompt, passLabel, responseContent);
                }
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

    // Calendar target for a city — the single decision both adapters'
    // getCalendarName delegates to. A configured city returns its configured
    // calendar. EVERYTHING else routes to the one UNKNOWN_CALENDAR_NAME
    // target: run 2026-07-31 (Club Chub) resolved a Wilton Manors address to
    // no configured city, and the old `chunky-dad-${city}` fallback minted the
    // target "chunky-dad-wilton manors" — a calendar name with a SPACE in it
    // that names no calendar that exists or ever could. Fail closed the way
    // the AI parser's city cross-check already documents ("unknown routes to
    // chunky-dad-unknown, the safe path"): one known-bad target a human owns,
    // never a per-string name invented from whatever the page said. Pure
    // (cities injected, no I/O); the caller does the logging so each adapter
    // keeps its own log prefix.
    // Returns { name, recognized, requested }.
    static resolveCalendarTarget(cities, city) {
        const requested = String(city == null ? '' : city).trim();
        const map = cities && typeof cities === 'object' ? cities : {};
        const configured = requested && map[requested] && map[requested].calendar;
        if (configured) return { name: configured, recognized: true, requested };
        return { name: UNKNOWN_CALENDAR_NAME, recognized: false, requested };
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
                    const probeAddress = typeof probe.address === 'string' ? probe.address.trim() : '';
                    // The scraper normalizer only fills a MISSING address or
                    // upgrades a district FRAGMENT of the curated address (its
                    // rung is deliberately fail-closed), but review findings
                    // are human-approved proposals — here curated bar data
                    // stays authoritative for vague stored addresses too
                    // ("Poconos, PA" can never geocode to the venue): when the
                    // event's bar resolves to a curated bar, propose the
                    // curated address whenever the stored one is missing or
                    // shorter (the review pass's own heuristic, unchanged
                    // behavior for Apply).
                    const cityBars = this.getCuratedCityBars(city);
                    const curatedBar = cityBars && typeof probe.bar === 'string' && probe.bar.trim()
                        ? this.findCuratedBarByName(cityBars, probe.bar) : null;
                    const curatedBarAddress = curatedBar && typeof curatedBar.address === 'string'
                        ? curatedBar.address.trim() : '';
                    let proposedAddress = probeAddress && probeAddress !== eventAddress ? probeAddress : '';
                    if (!proposedAddress && curatedBarAddress && curatedBarAddress !== eventAddress
                        && eventAddress.length < curatedBarAddress.length) {
                        proposedAddress = curatedBarAddress;
                    }
                    barMatchByEvent.set(event, {
                        barName: typeof probe.bar === 'string' && probe.bar.trim() ? probe.bar.trim() : 'curated bar',
                        location: probe.location.trim(),
                        address: proposedAddress
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
                    // Carry the geocode verdict so applyReviewFinding can stamp
                    // the pin's provenance (geocoded-exact vs geocoded-approx).
                    finding.grade = fresh.grade;
                    finding.crossCheck = fresh.crossCheck;
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
                            // Carry the geocode verdict so applyReviewFinding can
                            // stamp the pin's provenance (geocoded-exact/approx).
                            finding.grade = fresh.grade;
                            finding.crossCheck = fresh.crossCheck;
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

// Canonical list of provenance companion fields — metadata stamps that record
// WHERE a value field's content came from (pinSource↔location,
// addressSource↔address, imageSource↔image, barSource↔bar,
// bearSource↔bear verdict). They follow their value field deterministically
// (setProvenanceSource / the bearSource merge rule), are excluded from AI
// arbitration (isArbitrationEligibleField), and legitimately CHANGE under a
// preserve merge when a higher authority vouches for the kept value. This is
// the ONE list — do not scatter per-file copies.
SharedCore.PROVENANCE_COMPANION_FIELDS = Object.freeze([
    'pinSource', 'addressSource', 'imageSource', 'barSource', 'bearSource'
]);

// Trust tiers per provenance family (higher = more authoritative). Values are
// the REAL vocabularies stamped by the pipeline:
//   - pinSource:     normalizers.js (page/geocoded-exact/geocoded-approx,
//                    curated via bar-data), scriptable-adapter review-apply
//   - addressSource: normalizers.js (page/curated/inferred, plus geo-poi
//                    from the venue-POI adoption rung — a map POI whose name
//                    matched the bar supplied the street address; tiered
//                    with 'page', below 'curated'),
//                    scriptable-adapter review-apply (curated/inferred),
//                    ai-web-parser.js venue-site consensus fill (the site's
//                    own map-directions address filled a blank — tiered with
//                    'page', below 'curated')
//   - barSource:     ai-web-parser.js (curated/venue-site/page-adjacent/
//                    uncorroborated), normalizers.js (geo-poi); the three
//                    corroborated stamps share a tier, matching
//                    isCorroboratedStamp's one-class treatment in the bar
//                    demotion rung
//   - imageSource:   ai-web-parser.js (og-image/jsonld/page); og-image and
//                    jsonld share a tier, matching the meta-artwork class in
//                    the image provenance rung
//   - bearSource:    shared-core bear cascade (keyword/ai/config) and the
//                    results-UI manual override (manual-bear/manual-not-bear
//                    — manual always outranks automatic)
// Values absent from a family rank null (fail open); blank ranks 0 (unstamped).
SharedCore.PROVENANCE_TRUST_TIERS = Object.freeze({
    pinSource: Object.freeze({ 'curated': 4, 'geocoded-exact': 3, 'geocoded-approx': 2, 'page': 1 }),
    addressSource: Object.freeze({ 'curated': 3, 'geo-poi': 2, 'page': 2, 'venue-site': 2, 'inferred': 1 }),
    barSource: Object.freeze({ 'curated': 3, 'venue-site': 2, 'venue-site-identity': 2, 'page-adjacent': 2, 'geo-poi': 2, 'uncorroborated': 1 }),
    imageSource: Object.freeze({ 'og-image': 2, 'jsonld': 2, 'page': 1 }),
    bearSource: Object.freeze({ 'manual-bear': 2, 'manual-not-bear': 2, 'keyword': 1, 'ai': 1, 'config': 1 })
});

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SharedCore,
        PROVENANCE_COMPANION_FIELDS: SharedCore.PROVENANCE_COMPANION_FIELDS,
        // Pure title date-segment detector, shared with the ai-web parser's
        // extraction-time strip (one implementation, defined upstream here).
        detectTitleDateSegment: SharedCore.detectTitleDateSegment
    };
} else if (typeof window !== 'undefined') {
    window.SharedCore = SharedCore;
} else {
    // Scriptable environment
    this.SharedCore = SharedCore;


}

// Scriptable gives every imported module its own console binding, so the
// adapter's console capture (run-log file) can't see this module's output.
// The orchestrator wires the adapter's file logger in here at startup.
// Returns a restore function; no-ops (returns null) if tee is not a function.
// log/warn/error keep echoing to the visible console; debug becomes file-only
// (full AI payload dumps belong in the run log, not on screen). Idempotent per
// console object: re-wiring returns the existing restore instead of stacking.
function __wireConsoleTee(tee) {
    if (typeof tee !== 'function' || typeof console === 'undefined' || !console) {
        return null;
    }
    if (typeof console.__consoleTeeRestore === 'function') {
        return console.__consoleTeeRestore;
    }
    const original = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        debug: console.debug
    };
    const wrap = (level, method, echo) => function (...args) {
        try {
            tee(level, args);
        } catch (teeError) {
            // Log capture must never break the caller.
        }
        if (echo && typeof method === 'function') {
            method.apply(console, args);
        }
    };
    console.log = wrap('info', original.log, true);
    console.warn = wrap('warn', original.warn, true);
    console.error = wrap('error', original.error, true);
    console.debug = wrap('debug', original.debug, false);
    const restore = function () {
        console.log = original.log;
        console.warn = original.warn;
        console.error = original.error;
        console.debug = original.debug;
        delete console.__consoleTeeRestore;
    };
    console.__consoleTeeRestore = restore;
    return restore;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports.__wireConsoleTee = __wireConsoleTee;
}

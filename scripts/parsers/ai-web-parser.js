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

// SharedCore's title date-segment detector (ONE implementation, shared with
// the deterministic merge rung — defined upstream in shared-core.js and
// exported from there). The wired this.core reference is preferred at the
// call site; this import is the fallback for isolated construction (tests).
// Missing both → the title date-strip fails open (title kept).
const ImportedDetectTitleDateSegment = (() => {
    try {
        if (typeof importModule === 'function') {
            const sharedCoreModule = importModule('shared-core');
            if (sharedCoreModule && typeof sharedCoreModule.detectTitleDateSegment === 'function') {
                return sharedCoreModule.detectTitleDateSegment;
            }
        }
    } catch (_) {}
    try {
        if (typeof require === 'function') {
            const sharedCoreModule = require('../shared-core');
            if (sharedCoreModule && typeof sharedCoreModule.detectTitleDateSegment === 'function') {
                return sharedCoreModule.detectTitleDateSegment;
            }
        }
    } catch (_) {}
    return null;
})();

// Persistent cache entries (OCR, classification) are retained by LAST USE, not
// write date: cache hits refresh a `lastUsedAt` payload field so recurring
// flyers survive the adapter's end-of-run pruning. Refreshes are rate-limited
// to once per this many days so steady-state runs do zero extra writes (and no
// iCloud sync churn).
const CACHE_TOUCH_INTERVAL_DAYS = 7;

// Evidence-pointer rescue (LOG-ONLY observation phase): the extraction model
// is a good FINDER and a bad COPIER. When the evidence gate drops a field
// because the VALUE is not verbatim in the corpus, but the model's own
// EVIDENCE string IS a verbatim corpus quote, the model located the right
// text and fumbled the transcription — run 20260723-224434, FURBALL Boston:
// value "79 Warrenon" cited evidence "79 WARRENTON TICKETS: ..." which sits
// verbatim in the OCR corpus. "Trust the pointer, not the copy."
// Scope: text-identity fields ONLY. Date/time fields are excluded on purpose
// (format conversion is not transcription, and their gates encode inference-
// safety), city is excluded (normalized key values, not transcriptions) and
// URL fields are excluded (different validation entirely). Widen HERE once
// the observation phase proves the heuristic.
const EVIDENCE_RESCUE_FIELDS = new Set(['bar', 'address', 'cover']);

// End-marker misattribution (run 20260724-155934, Dallas Eagle):
// thedallaseagle.com listings print "End at: August 1, 2026 - 2:00 am" and
// the extraction model repeatedly assigned those END values to START fields
// (events shipped starting at the 2:00 AM closing time, plus zero-duration
// start==end pairs). The value is usually VERBATIM in the corpus, so plain
// corroboration cannot catch it — this is its own rejection class. The gate
// drops the start copy and reassignEndMarkerStartFields moves the value to
// the corresponding EMPTY end field (reassign, don't discard — it is, after
// all, evidence-cited end data). Keys: normalized start field → normalized
// end field it reassigns to.
const END_MARKER_CITED_REASON = 'end-marker-cited-evidence';
const END_MARKER_START_FIELDS = new Map([
    ['startdate', 'enddate'],
    ['starttime', 'endtime']
]);

// ============================================================================
// NORMALIZATION HELPERS
// ============================================================================

/**
 * Normalize city value: lowercase, trim, handle common aliases
 */
function normalizeCityValue(value) {
    if (!value || typeof value !== 'string') return '';
    return value.trim().toLowerCase();
}

/**
 * Normalize time value to HH:MM 24-hour format
 * Handles formats like: "01H", "10PM", "22:30", "10:30pm", "3:30 AM", "2026-05-12T22:30", etc.
 */
function normalizeStartTimeValue(value) {
    if (!value || typeof value !== 'string') return '';

    let timeStr = value.trim();

    // Handle ISO datetime format like "2026-05-12T22:30" or "2026-05-12T22:30:00"
    const isoDateTimeMatch = timeStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (isoDateTimeMatch) {
        const hour = parseInt(isoDateTimeMatch[4], 10);
        const minute = parseInt(isoDateTimeMatch[5], 10);
        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
            return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
        }
    }

    // Handle "01H" format (military time with H suffix)
    const militaryMatch = timeStr.match(/^(\d{1,2})H$/i);
    if (militaryMatch) {
        const hour = parseInt(militaryMatch[1], 10);
        if (hour >= 0 && hour <= 23) {
            return String(hour).padStart(2, '0') + ':00';
        }
    }

    // Handle "10PM" format (no colon, AM/PM attached)
    const attachedAmPmMatch = timeStr.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
    if (attachedAmPmMatch) {
        let hour = parseInt(attachedAmPmMatch[1], 10);
        const minute = attachedAmPmMatch[2] ? parseInt(attachedAmPmMatch[2], 10) : 0;
        const ampm = attachedAmPmMatch[3].toUpperCase();

        if (ampm === 'PM' && hour !== 12) hour += 12;
        if (ampm === 'AM' && hour === 12) hour = 0;

        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
            return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
        }
    }

    // Handle "3:30 AM" format (space-separated AM/PM)
    const separateAmPmMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (separateAmPmMatch) {
        let hour = parseInt(separateAmPmMatch[1], 10);
        const minute = parseInt(separateAmPmMatch[2], 10);
        const ampm = separateAmPmMatch[3].toUpperCase();

        if (ampm === 'PM' && hour !== 12) hour += 12;
        if (ampm === 'AM' && hour === 12) hour = 0;

        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
            return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
        }
    }

    // Handle "22:30" format (already HH:MM)
    const hhmmMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (hhmmMatch) {
        const hour = parseInt(hhmmMatch[1], 10);
        const minute = parseInt(hhmmMatch[2], 10);
        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
            return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
        }
    }

    // Handle "10:30pm" format (lowercase ampm attached or separate)
    const lowercaseMatch = timeStr.match(/^(\d{1,2}):?(\d{2})?\s*(am|pm)$/i);
    if (lowercaseMatch) {
        let hour = parseInt(lowercaseMatch[1], 10);
        const minute = lowercaseMatch[2] ? parseInt(lowercaseMatch[2], 10) : 0;
        const ampm = lowercaseMatch[3].toUpperCase();

        if (ampm === 'PM' && hour !== 12) hour += 12;
        if (ampm === 'AM' && hour === 12) hour = 0;

        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
            return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
        }
    }

    // If all parsing fails, return empty string
    return '';
}

/**
 * Combine date (YYYY-MM-DD) and time (HH:MM) into a full UTC Date object
 * Returns Date object or null if inputs are invalid
 */
function combineDateAndTime(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;

    let dateValue = dateStr;
    if (dateStr instanceof Date && !isNaN(dateStr.getTime())) {
        dateValue = dateStr.toISOString().split('T')[0];
    }

    // Validate date format (YYYY-MM-DD)
    const dateMatch = String(dateValue).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) return null;

    // Validate time format (HH:MM)
    const timeMatch = String(timeStr).match(/^(\d{2}):(\d{2})$/);
    if (!timeMatch) return null;

    const year = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10) - 1; // JS months are 0-indexed
    const day = parseInt(dateMatch[3], 10);
    const hour = parseInt(timeMatch[1], 10);
    const minute = parseInt(timeMatch[2], 10);

    if (month < 0 || month > 11 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return null;
    }

    const date = new Date(Date.UTC(year, month, day, hour, minute));
    return isNaN(date.getTime()) ? null : date;
}

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
        this.cachedEventSchemaFieldSignalRegexMap = new Map();
        this.eventSchemaFieldSignalRegexMapLoaded = false;
        this.invalidFieldSignalPatternWarnings = new Set();
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
            ],
            evidenceCompactMinLength: 4,
            fuzzyDescriptionMinTokenLength: 4,
            fuzzyDescriptionMinTokenMatches: 2,
            fuzzyDescriptionTokenMatchRatio: 0.45,
            validationReportValueMaxLength: 140,
            multiEventScanLineLimit: 500,
            multiEventMaxSegments: 12,
            multiEventMinSegmentLines: 2,
            multiEventMaxSegmentLines: 24,
            multiEventMinSegmentChars: 25,
            multiEventMaxSegmentChars: 3200,
            multiEventContextMetaParts: 4,
            multiEventLineMaxChars: 240,
            multiEventTitleMinChars: 8,
            multiEventTitleMaxChars: 140,
            multiEventTitleMinWords: 2,
            multiEventPartialLineMinChars: 20
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
        this.trackingParamPattern = /^(aff|affix|affiliate|utm_source|utm_medium|utm_campaign|utm_content|utm_term|ref|referral|fbclid|gclid|msclkid|dclid|source|mc_cid|mc_eid)$/i;
        // Detects lines that are primarily CSS content (e.g. leaked from unclosed or inline <style> blocks).
        // Matches 3+ occurrences of a CSS property name immediately followed by ":" with no space before the colon.
        this.cssContentLineRegex = /\b(cursor|color|background-color|background-image|background-size|font-size|font-weight|font-family|font-style|border-radius|border-color|border-width|border-style|margin|margin-top|margin-bottom|margin-left|margin-right|padding|padding-top|padding-bottom|padding-left|padding-right|display|position|overflow|z-index|box-sizing|box-shadow|flex|flex-shrink|flex-grow|flex-basis|align-items|justify-content|line-height|text-decoration|text-align|text-transform|opacity|min-width|max-width|min-height|max-height|width|height|top|left|right|bottom|transform|transition|animation|white-space|word-break|word-wrap|outline|visibility|pointer-events|vertical-align|letter-spacing|gap):/gi;
        this.proxyImagePathPrefixes = ['/e/_next/image?', '/_next/image?'];
        this.jsonLdCandidatePoolSizeMultiplier = 2;
        this.relativeUrlParsingBase = 'https://placeholder.example';
        this.maxUrlUnwrapDepth = 3;
        this.maxRejectedSamplesPerReason = 3;
        this.maxRejectedSampleLength = 120;
        this.supportedImageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.tif', '.tiff'];
        this.likelyImagePathRegex = /(^|\/)(image|images|img|photo|photos|poster)(\/|$)/i;
        // Common CDN/image-transform query keys (w=width, h=height, q=quality, fit/crop/auto/fm/format, s=signature).
        this.likelyImageQueryRegex = /(?:^|[?&])(w|h|q|fit|crop|auto|fm|format|s)=/;
        this.inlineUrlPattern = /(?:https?:\/\/|\/)[^\s"'<>]+/gi;
        // Wix static-media transform URLs (/media/<asset>/v1/fill/<params>/<name>) —
        // recognized so degraded thumbnails can be upgraded to the original asset.
        this.wixMediaTransformPattern = /^(https?:\/\/static\.wixstatic\.com\/media\/([^/?#]+))\/v1\/(?:fill|fit|crop)\/([^/?#]+)(?:[/?#]|$)/i;
        // URLs already logged by upgradeCdnThumbnailUrl — log each upgrade once per run.
        this.upgradedCdnThumbnailUrls = new Set();
        this.aiPromptHistory = [];
        // Context-prep responses keyed by prompt hash: confidence retries rebuild a
        // byte-identical context-prep prompt, so the HTTP round-trip can be reused.
        // In-memory only, scoped to this parser instance (one run).
        this.contextPrepResponseCache = new Map();
        this.aiResponseCacheStats = { hits: 0, misses: 0, writes: 0 };
        this.defaultOcrModel = 'qwen3-vl:4b-instruct';
        this.defaultOcrPrompt = "You are performing OCR on an event flyer.\n\nSTEP 1: OCR\nExtract ALL visible text from the image.\n\nRules:\n- Copy text exactly as shown.\n- Preserve line breaks when possible.\n- Do not summarize.\n- Do not interpret.\n- Do not correct spelling.\n- Do not infer missing words.\n\nSTEP 2: Classification\n\nClassify the image into ONE category:\n\nad-banner: Advertisement or promotional banner (usually has \"buy\", \"get tickets\", \"sale\")\nevent-flyer: Single event poster/flyer - ONE primary event with ONE title, ONE venue, and ONE date or continuous date range. May contain schedules, activities, DJs, performers, or sub-events that are clearly part of the same event. Examples: Bear Week, Bear Weekend, Pride Festival, Camp Weekend, Resort Weekend Package.\nmulti-event-flyer: Two or more independent events with different titles, different dates/times, and separate ticketing. Often appears as a calendar, event listing, or monthly schedule.\nlogo: Brand or organization logo (minimal text, just brand name)\nthumbnail: Small preview image (low detail)\nhero-banner: Large header/banner image (prominent on page)\n\nDecision rule: If there is ONE overarching event name and the listed activities appear to belong to that event, classify as event-flyer. Only classify as multi-event-flyer when multiple independent events are advertised that require separate tickets.\n\nIMPORTANT CONTEXT: This is for a gay bear community travel guide. Events may be part of:\n- \"Bear Week\" or \"Bear Weekend\" themed events\n- Annual bear gatherings (e.g., \"Puerto Vallarta Bear Week\", \"Sitges Bear Week\")\n- Regular bear-themed parties or meetups\n- Events at bear-owned businesses or bear-friendly venues\n\nSTEP 3: Event Analysis\n\nDetermine:\n- eventName: The primary event title\n- venue: The venue or venue group name\n- startDate: Start date/time if visible\n- endDate: End date/time if visible\n\nUse only information visible in the image.\n\nSTEP 4: Summary\n\nCreate a concise summary describing:\n- event name\n- venue\n- date/time\n- why it may be relevant to the bear community\n\nReturn JSON only with these fields:\n{\n  \"text\": \"full extracted text\",\n  \"imageClassification\": \"ad-banner|event-flyer|multi-event-flyer|logo|thumbnail|hero-banner\",\n  \"eventSummary\": \"a concise 1-2 sentence summary of the event including: event name, venue, date/time, and any bear-week context if applicable. Focus on what makes this event notable for the bear community.\",\n  \"confidence\": 0-100,\n  \"reason\": \"brief explanation for classification\"\n}";
        // When an image overflows the vision model's context, retry once at this
        // longest-side cap. The adapter's default first-pass cap is 1024px (the
        // value overflow retries used to succeed at), so this safety net steps
        // down further and should rarely fire.
        this.ocrOverflowRetryMaxDimension = 768;
        this.defaultOcrRequestConfig = {
            // With requests serialized (maxConcurrentRequests), anything slower than
            // 2 minutes on the local vision model is stuck, not slow.
            timeoutSeconds: 120,
            keepAlive: '5m',
            numCtx: 8192,
            numPredict: 2000,
            temperature: 0,
            think: false
        };
        this.urlParsePattern = /^(https?:)\/\/([^\/?#]+)([^?#]*)?(\?[^#]*)?(#.*)?$/i;
        // NOTE/TODO: If we need to support additional structured payload URL fields,
        // add alias keys here and mirror them in collectEventUrlsFromDataObject().
        // Keep this URL-discovery focused (schema-agnostic) and avoid deterministic
        // per-field event extraction fallbacks from __NEXT_DATA__/__SERVER_DATA__.
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
        // JSON-LD fast-path gap-fill signals: normalized prompt field → regexes a
        // VISIBLE-page-text match of which justifies one targeted AI extraction for
        // that field. Data-driven so future fields just add an entry; only plain
        // string event fields may appear here (never startDate/endDate — those are
        // Date-typed on JSON-LD events).
        this.jsonLdGapFillSignals = {
            cover: [/[$€£]\s?\d/, /\b\d+(?:\.\d{2})?\s?(?:USD|EUR|GBP)\b/i]
        };
        if (typeof this.config.normalizeUrl !== 'function') {
            throw new Error('AiWebParser requires config.normalizeUrl from SharedCore');
        }
    }

    // Debug channel: detailed per-URL diagnostics land in the captured log file
    // (via SharedCore.logDebug) without spamming the visible console. Falls back
    // to console.log when no core reference is wired up (e.g. isolated tests).
    logDebug(message) {
        if (this.core && typeof this.core.logDebug === 'function') {
            this.core.logDebug(message);
            return;
        }
        console.log(message);
    }

    async parseEvents(htmlData = {}, parserConfig = {}, cityConfig = null, pageClassification = null, httpAdapter = null) {

        var discoveredSegments = null;
        var ocrResults = [];
        try {
            this.aiPromptHistory = [];
            const html = htmlData && htmlData.html ? htmlData.html : '';
            const sourceUrl = htmlData && htmlData.url ? htmlData.url : '';
            const additionalLinks = this.extractAdditionalUrls(html, sourceUrl, parserConfig);

            // Derive the page's organizer/site brand ONCE per page (from JSON-LD
            // Organization/WebSite and og:site_name). Extraction prompts, the
            // post-extraction guard in normalizeAiEvent, and downstream merge
            // arbitration all reuse this cached result instead of re-parsing HTML.
            const pageBrandNames = this.getPageBrandNames(htmlData);
            if (pageBrandNames.length > 0) {
                console.log(`🤖 AI Web: Page organizer/brand derived from metadata: ${pageBrandNames.map(name => `"${name}"`).join(', ')}`);
            }

            // Classify who this SITE is (venue vs organizer) from hard facts
            // only — parser config override, then the page's own JSON-LD types
            // (segment-derived facts are layered in on multi-event pages).
            // 'venue' switches extraction steering from KNOWN ORGANIZER to
            // KNOWN VENUE; undetermined changes nothing (fail open).
            this.resolvePageSiteRole(htmlData, parserConfig);

            // Deterministic venue-site address harvest (no AI): map-directions
            // links (Google/Apple) on ANY fetched page of a site feed a
            // per-host consensus that can later fill blank address/city on the
            // site's own events — applyVenueSiteAddressConsensus judges it
            // after the whole crawl (fail closed: two distinct addresses, or
            // siteRole 'organizer', derive nothing).
            this.harvestVenueSiteAddresses(htmlData);

            // Deterministic extraction from schema.org Event JSON-LD. Ticketing pages
            // (sickening.events, tryst.events, Eventbrite) hand us complete structured
            // data — when it covers title + start + venue, OCR and AI extraction add
            // cost without adding trust, so use the structured data directly.
            const jsonLdEvents = this.extractEventsFromJsonLd(html, sourceUrl, cityConfig);
            const completeJsonLdEvents = jsonLdEvents.filter(event => event.bar || event.address);
            const useJsonLdEvents = parserConfig.discoveryOnly !== true
                && pageClassification !== 'link-aggregator'
                && completeJsonLdEvents.length > 0
                // A multi-event page with a single JSON-LD node likely marks up only its
                // featured event — fall through to segment extraction for full coverage.
                && (pageClassification !== 'multi-event-page' || completeJsonLdEvents.length >= 2);
            if (useJsonLdEvents) {
                console.log(`🤖 AI Web: Extracted ${completeJsonLdEvents.length} event(s) from JSON-LD structured data — skipping OCR and AI extraction`);
                if (pageBrandNames.length > 0) {
                    completeJsonLdEvents.forEach(event => {
                        event._organizer = pageBrandNames[0];
                        // JSON-LD events skip normalizeAiEvent, so the bare-city
                        // title rule (organizer prefix) is applied here too.
                        const prefixedTitle = this.buildOrganizerPrefixedTitle(
                            event.title, event.city, pageBrandNames, htmlData, cityConfig);
                        if (prefixedTitle) {
                            console.log(`🤖 AI Web: Title "${event.title}" is just the event's city — prefixed known organizer → "${prefixedTitle}"`);
                            event.title = prefixedTitle;
                        }
                    });
                }
                // Enrichment only: fills empty fields from the Wix warmup blob,
                // never skips or replaces an extraction step.
                this.applyWixServerDataEnrichment(completeJsonLdEvents, htmlData, cityConfig);
                await this.applyJsonLdGapFill(completeJsonLdEvents, htmlData, parserConfig, cityConfig, httpAdapter);
                // A single JSON-LD event whose node carried no image adopts
                // the page's own og:image artwork (multi-event pages never do:
                // one shared meta image cannot be attributed to one event).
                if (completeJsonLdEvents.length === 1) {
                    this.fillImageFromPageMetaArtwork(completeJsonLdEvents[0], htmlData);
                }
                // Images the JSON-LD nodes carried are already stamped 'jsonld';
                // an image the gap-fill pulled from page content gets its own
                // og-image/page provenance here (no image → no stamp).
                completeJsonLdEvents.forEach(event => this.stampImageProvenance(event, htmlData));
                // Bar provenance for the structured-data path: curated/
                // venue-site stamps only — there is no extraction evidence
                // corpus here, so the adjacency check never runs (fail open).
                completeJsonLdEvents.forEach(event => this.stampBarSourceProvenance(event, null, htmlData));
                // Attribute the events to this page's site so the post-crawl
                // venue-site address consensus can fill their blanks.
                this.tagEventsWithVenueSitePage(completeJsonLdEvents, htmlData);
                return {
                    events: completeJsonLdEvents,
                    additionalLinks: additionalLinks,
                    discoveredSegments: null,
                    ocrResults: [],
                    source: this.config.source,
                    url: sourceUrl
                };
            }

            // Extract OCR from ALL images FIRST - we need it for consistent segment-to-image
            // mapping. Multi-event pages always need OCR (segment pairing runs even in
            // discoveryOnly mode); pages whose extraction will be skipped (link-aggregators,
            // or any page in discoveryOnly mode) have no OCR consumer, so skip the expense.
            const ocrConfig = this.getOcrConfig(parserConfig);
            const runOcr = ocrConfig.enabled && this.shouldRunOcrForPage(parserConfig, pageClassification);
            if (ocrConfig.enabled && !runOcr) {
                console.log(`🤖 AI Web: Skipping OCR for ${pageClassification || 'unclassified'} page — no extraction will run (link-finding mode)`);
            }
            // Multi-event pages need broad coverage (one flyer per segment, with the
            // segment top-up as backstop); single-event pages only need the main flyer,
            // so respect the configured per-page image budget there.
            const ocrImageCap = pageClassification === 'multi-event-page' ? 10 : ocrConfig.maxImages;
            ocrResults = runOcr
                ? await this.extractOcrFromAllImages(htmlData, ocrConfig, httpAdapter, ocrImageCap)
                : [];
            if (ocrResults.length > 0) {
                console.log(`🤖 AI Web: Extracted OCR from ${ocrResults.length} image(s)`);
            }

            // Build segments for multi-event pages - we need this for consistent segment-to-image mapping
            // and for UI discovery mode. Pass OCR results for proper image-segment pairing.
            if (pageClassification === 'multi-event-page') {
                const segments = this.buildMultiEventSegments(html, sourceUrl, ocrResults);
                if (segments.length === 0) {
                    console.warn('🤖 AI Web: Segment discovery found no valid segments on multi-event page (check date/title signals and extraction limits)');
                } else {
                    discoveredSegments = segments.map((segment, i) => {
                        const diagnostics = this.describeMultiEventSegment(segment, sourceUrl);
                        return {
                            index: i + 1,
                            lineCount: diagnostics.lineCount,
                            preview: diagnostics.preview,
                            imageUrls: diagnostics.imageUrls,
                            resourceLines: diagnostics.resourceLines
                        };
                    });
                    console.log(`🤖 AI Web: Segment discovery found ${segments.length} segment(s) on multi-event page`);
                    for (let i = 0; i < segments.length; i++) {
                        const diagnostics = this.describeMultiEventSegment(segments[i], sourceUrl);
                        const resourceSummary = diagnostics.resourceLines.length > 0
                            ? `\n${diagnostics.resourceLines.join('\n')}`
                            : '';
                        console.log(`🤖 AI Web: Segment ${i + 1}/${segments.length} (${diagnostics.lineCount} lines, images=${diagnostics.imageUrls.length}):\n${segments[i].lines.join('\n')}${resourceSummary}`);
                    }
                }
            }

            // Skip AI extraction in discoveryOnly mode or for link-aggregator pages
            if (parserConfig.discoveryOnly === true || pageClassification === 'link-aggregator') {
                // Discovery drops events, but JSON-LD event data still tells the user
                // what the page is about — surface it as segments in the discovery tree.
                if (!discoveredSegments && jsonLdEvents.length > 0) {
                    discoveredSegments = this.describeJsonLdEventsAsSegments(jsonLdEvents);
                    console.log(`🤖 AI Web: JSON-LD provided ${discoveredSegments.length} event segment(s) for discovery`);
                }
                console.log(`🤖 AI Web: Link-finding mode (${parserConfig.discoveryOnly ? 'discoveryOnly' : 'link-aggregator'}) found ${additionalLinks.length} additional links`);
                // Onboarding harvest — discoveryOnly mode ONLY (inert everywhere
                // else): social profile links + JSON-LD organizer feed the
                // suggested-config block printed after discovery.
                let discoveredSocialLinks = null;
                let discoveredOrganizer = null;
                if (parserConfig.discoveryOnly === true) {
                    const socialLinks = this.collectDiscoverySocialLinks(html, sourceUrl);
                    if (Object.keys(socialLinks).length > 0) {
                        discoveredSocialLinks = socialLinks;
                        console.log(`🤖 AI Web: Discovery harvested social link(s): ${Object.values(socialLinks).join(', ')}`);
                    }
                    discoveredOrganizer = this.extractJsonLdOrganizer(html);
                    if (discoveredOrganizer) {
                        console.log(`🤖 AI Web: Discovery harvested JSON-LD organizer: ${discoveredOrganizer.name || '(no name)'}${discoveredOrganizer.url ? ` (${discoveredOrganizer.url})` : ''}`);
                    }
                }
                return {
                    events: [],
                    additionalLinks: additionalLinks,
                    discoveredSegments,
                    discoveredSocialLinks,
                    discoveredOrganizer,
                    ocrResults: ocrResults,
                    source: this.config.source,
                    url: sourceUrl
                };
            }

            // Compute dataFlags based on HTML content to determine which date fields to use
            const sectionBundle = this.getPromptSectionBundle(html, parserConfig);
            const aiConfig = this.getAiConfig(parserConfig);
            const payloadMode = this.normalizePayloadMode(aiConfig.payloadMode);
            const dataFlags = this.getDataFlagsForPartition(sectionBundle, payloadMode, '');
            const promptFields = this.getAiPromptFields(parserConfig, dataFlags, sourceUrl);
            const events = pageClassification === 'multi-event-page'
                ? await this.extractEventsFromMultiEventPage(htmlData, parserConfig, cityConfig, promptFields, ocrResults, httpAdapter)
                : await this.extractEventsFromSinglePage(htmlData, parserConfig, cityConfig, promptFields, ocrResults, httpAdapter);

            // Enrichment only: fills empty fields on the finished AI/OCR events
            // from the Wix warmup blob, never skips or replaces an extraction step.
            this.applyWixServerDataEnrichment(events, htmlData, cityConfig);

            // Attribute the events to this page's site so the post-crawl
            // venue-site address consensus can fill their blanks.
            this.tagEventsWithVenueSitePage(events, htmlData);

            return {
                events,
                additionalLinks,
                discoveredSegments,
                ocrResults: ocrResults,
                source: this.config.source,
                url: htmlData && htmlData.url ? htmlData.url : ''
            };
        } catch (error) {
            console.warn(`🤖 AI Web: Failed to parse AI event: ${error}`);
            console.warn(`🤖 AI Web: Stack trace:\n${error && error.stack ? error.stack : 'No stack trace'}`);
            const html = htmlData && htmlData.html ? htmlData.html : '';
            const sourceUrl = htmlData && htmlData.url ? htmlData.url : '';
            return {
                events: [],
                additionalLinks: this.extractAdditionalUrls(html, sourceUrl, parserConfig),
                discoveredSegments,
                ocrResults: ocrResults,
                source: this.config.source,
                url: sourceUrl
            };
        }
    }

    async extractEventsFromSinglePage(htmlData, parserConfig, cityConfig, promptFields, ocrResults = [], httpAdapter = null) {
        // Site role (venue/organizer/undetermined) was resolved page-level in
        // parseEvents; announce it once before extraction prompts are built.
        this.resolvePageSiteRole(htmlData, parserConfig);
        this.logPageSiteRoleOnce(htmlData);
        const segmentHtmlData = {
            ...htmlData,
            ocrResults: ocrResults
        };
        // For single-page events, combine OCR flags with any existing structured data flags
        // If OCR is present, add ocr flag; preserve htmlData.dataFlags if present
        const dataFlags = {
            ...(ocrResults && ocrResults.length > 0 ? { ocr: true } : {}),
            ...(htmlData.dataFlags || {})
        };

        // Recalculate prompt fields because OCR results might have changed the preferred date format (e.g. from start/end to split fields)
        const adjustedPromptFields = this.getAiPromptFields(parserConfig, dataFlags, htmlData && htmlData.url ? htmlData.url : '');

        const event = await this.extractSingleEvent(segmentHtmlData, parserConfig, cityConfig, adjustedPromptFields, dataFlags, httpAdapter);
        return event ? [event] : [];
    }

    async extractEventsFromMultiEventPage(htmlData, parserConfig, cityConfig, promptFields, ocrResults = [], httpAdapter = null) {
        const html = htmlData && htmlData.html ? htmlData.html : '';
        const sourceUrl = htmlData && typeof htmlData.url === 'string' ? htmlData.url : '';

        const segments = this.buildMultiEventSegments(html, sourceUrl, ocrResults);
        if (segments.length === 0) {
            console.warn('🤖 AI Web: multi-event-page classification produced no valid segments; returning no events');
            return [];
        }
        console.log(`🤖 AI Web: multi-event-page split into ${segments.length} candidate segment${segments.length === 1 ? '' : 's'}`);

        // OCR any segment images the capped page-level pass missed
        await this.ensureSegmentOcrCoverage(segments, ocrResults, parserConfig, sourceUrl, httpAdapter);

        // Title↔OCR consistency gate: with OCR coverage complete, correct
        // flyer↔segment pairings whose flyer text names a sibling listing —
        // BEFORE any per-segment prompt content is built below.
        this.applySegmentOcrConsistencyGate(segments, ocrResults, sourceUrl);

        // Segment-derived site-role facts (multiple distinct addresses →
        // organizer; one recurring address that also appears outside the
        // listings → venue) can settle what the JSON-LD types alone could not.
        // Must run BEFORE the per-segment htmlData copies are spread below so
        // every segment inherits the page-level determination.
        this.resolvePageSiteRole(htmlData, parserConfig, segments);
        this.logPageSiteRoleOnce(htmlData);

        // Segments are unstructured data (page content + OCR), so always use split fields
        const segmentDataFlags = { ocr: true, segment: true };
        const segmentPromptFields = this.getAiPromptFields(parserConfig, segmentDataFlags, sourceUrl);

        const events = [];
        for (let i = 0; i < segments.length; i++) {
            try {
                const segment = segments[i];
                const segmentHtmlData = this.buildMultiEventSegmentHtmlData(htmlData, segment, i, segments.length, ocrResults);
                const event = await this.extractSingleEvent(segmentHtmlData, parserConfig, cityConfig, segmentPromptFields, segmentDataFlags, httpAdapter);
                if (!event) continue;
                event._multiEventSegment = {
                    index: i + 1,
                    total: segments.length,
                    lineCount: segment.lines.length
                };
                events.push(event);
            } catch (err) {
                console.warn(`🤖 AI Web: Segment ${i + 1}/${segments.length} extraction failed: ${err.message}`);
            }
        }
        return events;
    }

    async extractSingleEvent(htmlData, parserConfig, cityConfig, promptFields, dataFlags = null, httpAdapter = null) {
        // Add OCR results to prompt context by prepending to HTML
        const ocrResults = htmlData && htmlData.ocrResults;
        let promptHtmlData = htmlData;
        if (ocrResults && ocrResults.length > 0) {
            console.log(`🤖 AI Web: Including OCR results (${ocrResults.length} images) in extraction`);
            // Build OCR snippet text to prepend to the prompt
            const ocrLines = [];
            for (let i = 0; i < ocrResults.length; i++) {
                const ocr = ocrResults[i];
                const ocrSnippet = this.buildOcrSnippet(ocr.url, ocr.text, ocr.eventSummary);
                ocrLines.push(ocrSnippet);
            }
            // Prepend OCR to the HTML so it's included in the prompt
            const ocrText = ocrLines.join('\n\n');
            const originalHtml = htmlData && typeof htmlData.html === 'string' ? htmlData.html : '';
            promptHtmlData = {
                ...htmlData,
                html: ocrText ? `${ocrText}\n\n${originalHtml}` : originalHtml
            };
        }

        // Use pre-computed dataFlags if available (e.g., from segments), otherwise compute from htmlData
        const computedDataFlags = htmlData.dataFlags || dataFlags || {};

        this.logDebug(`🤖 AI Web: Using extraction fields: ${Array.isArray(promptFields) ? promptFields.join(', ') : 'none'}`);

        const aiEvent = await this.getAiEvent(promptHtmlData, parserConfig, cityConfig, promptFields, computedDataFlags, httpAdapter);
        if (!aiEvent) {
            return null;
        }

        // Build evidence context from promptHtmlData.html (the actual content passed to AI)
        const evidenceContext = this.buildAiEvidenceContext(promptHtmlData, parserConfig);
        const imageEvidenceUrls = this.buildImageEvidenceContextFromText(
            promptHtmlData && typeof promptHtmlData.html === 'string' ? promptHtmlData.html : '',
            promptHtmlData && typeof promptHtmlData.url === 'string' ? promptHtmlData.url : ''
        );

        const validationResult = this.validateAiEventEvidence(aiEvent, promptHtmlData, parserConfig, promptFields, {
            trustedFields: aiEvent && Array.isArray(aiEvent.__preValidatedFields) ? aiEvent.__preValidatedFields : [],
            evidenceContext: evidenceContext,
            validationContext: {
                imageEvidenceUrls: imageEvidenceUrls,
                cityConfig: cityConfig
            }
        });
        const event = this.normalizeAiEvent(validationResult.event, parserConfig, promptHtmlData, cityConfig, promptFields);
        if (!event || !event.title || !event.startDate) {
            console.warn('🤖 AI Web: AI output missing required title/startDate after normalization');
            return null;
        }
        // Venue-hours notice guard (runs 20260724-161423 / 20260725-170031:
        // massive.club's "Hours … Tuesday Closed …" block became a segment,
        // and extraction bound a startDate hallucinated from the adjacent
        // listing — a calendar-bound "event" titled "Tuesday Closed"). A
        // schedule notice is not an event; reject it here at the single
        // normalization choke point so every extraction path (segments,
        // single pages, detail crawls) is covered.
        if (this.isVenueHoursNoticeTitle(event.title)) {
            console.log(`🤖 AI Web: Skipped venue-hours notice "${event.title}" — not an event`);
            return null;
        }
        // Address plausibility gate: a venue name is not an address (run
        // 20260723-140457: extraction stored address "Legacy" — the bar's own
        // name — and it sailed through to geocoding). Runs BEFORE the bar
        // corroboration stamp so a dropped address never feeds adjacency.
        this.applyAddressPlausibilityGate(event, promptHtmlData);
        // Bar plausibility gate: an address-shaped bar is never a valid
        // extraction (run 20260724-115423: bar "79 Warren" — the flyer's
        // street line — survived and blocked the convergence rescue). Runs
        // AFTER the address gate (so a matching address twin still drops via
        // "matches venue name") and BEFORE the convergence rescue (so a
        // dropped bar frees the rescue to adopt the real venue).
        this.applyBarPlausibilityGate(event);
        // Deterministic bar-convergence rescue: only when extraction left NO
        // bar (including a gate-dropped one). Every plausible name line from
        // the page text, the OCR text, and the curated bars corpus is a
        // candidate; adoption requires >= 2 independent signals (curated,
        // page, ocr, url) — position is only a tie-breaker, never an anchor.
        // Runs BEFORE the barSource stamp so an adopted bar carries its own
        // provenance; a model-returned surviving bar makes this a no-op.
        this.applyBarConvergenceRescue(event, htmlData, parserConfig, cityConfig);
        // Bar corroboration stamp (barSource): checks the final bar+address
        // pair against the same corpora the evidence gate uses (page text,
        // OCR text, segment text). Flag-don't-drop: values are never changed.
        this.stampBarSourceProvenance(event, evidenceContext, promptHtmlData);
        // Deterministic page-location cross-check: an explicit "<Place>, <Place>"
        // line next to the venue/address outranks weaker city evidence. A city
        // the evidence gate dropped (context/branding-cited evidence) still
        // anchors the comparison via the validation report.
        const droppedCityEntry = validationResult.report && Array.isArray(validationResult.report.dropped)
            ? validationResult.report.dropped.find(entry => entry && entry.field === 'city')
            : null;
        const memoDroppedCity = aiEvent.__droppedFieldValues && typeof aiEvent.__droppedFieldValues === 'object'
            && typeof aiEvent.__droppedFieldValues.city === 'string'
            ? aiEvent.__droppedFieldValues.city
            : '';
        this.crossCheckCityAgainstAdjacentLocation(event, evidenceContext, cityConfig, droppedCityEntry ? droppedCityEntry.value : memoDroppedCity);
        console.log(this.formatExtractionSummary(event, htmlData && htmlData.url ? htmlData.url : 'unknown URL'));
        const confidenceDiagnostics = aiEvent && aiEvent.__confidenceDiagnostics && typeof aiEvent.__confidenceDiagnostics === 'object'
            ? aiEvent.__confidenceDiagnostics
            : null;
        if (validationResult.report || confidenceDiagnostics) {
            const report = validationResult.report && typeof validationResult.report === 'object'
                ? { ...validationResult.report }
                : { strict: null, sourceChars: 0, kept: [], dropped: [], bypassed: [] };
            if (confidenceDiagnostics) {
                const finalValidatedFields = Object.keys(validationResult.event || {})
                    .filter(key => !this.isInternalAiFieldKey(key))
                    .map(key => this.normalizePromptFieldName(key))
                    .filter(Boolean);
                report.confidence = {
                    ...confidenceDiagnostics,
                    extractionOutcome: {
                        ...(confidenceDiagnostics.extractionOutcome || {}),
                        finalValidatedFields: Array.from(new Set(finalValidatedFields))
                    }
                };
            }
            event._aiValidation = report;
        }
        // Evidence-pointer rescue candidates (LOG-ONLY observation phase):
        // stash on the event as an underscore field (never serialized into
        // notes — same systematic exclusion as _geoPoi*) so the results-UI
        // evidence panel can show what the rescue WOULD have adopted. Sources:
        // snippet-pass memos (__evidenceRescues) plus the final gate's report.
        const evidenceRescues = []
            .concat(aiEvent && Array.isArray(aiEvent.__evidenceRescues) ? aiEvent.__evidenceRescues : [])
            .concat(validationResult.report && Array.isArray(validationResult.report.evidenceRescues) ? validationResult.report.evidenceRescues : []);
        if (evidenceRescues.length > 0) {
            const seenRescues = new Set();
            const dedupedRescues = evidenceRescues.filter(entry => {
                if (!entry || typeof entry !== 'object') return false;
                const dedupeKey = `${entry.field}|${entry.candidate}|${entry.modelValue}`;
                if (seenRescues.has(dedupeKey)) return false;
                seenRescues.add(dedupeKey);
                return true;
            });
            if (dedupedRescues.length > 0) {
                event._evidenceRescues = dedupedRescues;
            }
        }
        return event;
    }

    // Deterministic venue-hours notice detector: true when a title consists of
    // NOTHING but weekday name(s)/abbreviation(s) (day ranges like "Mon-Tue"
    // tokenize into two weekday tokens) plus a closed-notice word — "closed",
    // "dark" (the theater term), or the phrase "no events". Any other
    // significant token keeps the event (fail closed: "Closed Party" and
    // "Dark Disco" are real event names), and a closed-word alone without a
    // weekday is not a notice either. Token classes only — no per-venue rules,
    // no position heuristics.
    isVenueHoursNoticeTitle(title) {
        const normalized = String(title || '')
            .toLowerCase()
            .replace(/&#?[0-9a-z]+;/gi, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\bno\s+events?\b/g, ' closed ')
            .trim();
        if (!normalized) return false;
        const weekdayPattern = /^(?:mon|monday|mondays|tue|tues|tuesday|tuesdays|wed|weds|wednesday|wednesdays|thu|thur|thurs|thursday|thursdays|fri|friday|fridays|sat|saturday|saturdays|sun|sunday|sundays)$/;
        const closedPattern = /^(?:closed|dark)$/;
        let weekdayCount = 0;
        let closedCount = 0;
        for (const token of normalized.split(/\s+/)) {
            if (weekdayPattern.test(token)) {
                weekdayCount++;
                continue;
            }
            if (closedPattern.test(token)) {
                closedCount++;
                continue;
            }
            return false;
        }
        return weekdayCount > 0 && closedCount > 0;
    }

    // One-line info summary of a finalized extraction: only fields that are set,
    // each value truncated so a page's outcome is readable at a glance.
    formatExtractionSummary(event, sourceUrl) {
        const formatValue = (value) => {
            let text;
            if (value instanceof Date && !isNaN(value.getTime())) {
                text = value.toISOString();
            } else {
                text = String(value);
            }
            return text.length > 50 ? `${text.slice(0, 50)}…` : text;
        };
        const parts = [];
        ['title', 'bar', 'startDate', 'endDate', 'address', 'city'].forEach(field => {
            const value = event ? event[field] : null;
            if (value === null || value === undefined || value === '') return;
            const bareValue = field === 'startDate' || field === 'endDate' || field === 'city';
            parts.push(`${field}=${bareValue ? formatValue(value) : `"${formatValue(value)}"`}`);
        });
        return `🤖 AI Web: Extracted ${sourceUrl} → ${parts.join(', ')}`;
    }

    // The page's own listing title for a segment: the first non-empty page-text
    // line that is not a date/time line, not a SEGMENT_*/OCR marker line, and
    // not a URL. Multi-event listings put the event name first (segment
    // discovery splits on exactly that title/date structure), so this recovers
    // the site's title even when flyer OCR is stylized taglines/DJ names.
    // Returns '' when no plausible listing title exists.
    deriveSegmentListingTitle(segment) {
        const lines = segment && Array.isArray(segment.lines) ? segment.lines : [];
        for (const rawLine of lines) {
            const line = this.normalizeWhitespace(rawLine);
            if (!line) continue;
            if (/^(SEGMENT_[A-Z_]+|OCR_IMAGE_TEXT)/i.test(line)) continue;
            if (this.hasMultiEventDateSignal(line)) continue;
            if (/^\d{1,2}(:\d{2})?\s*(am|pm)?(\s*[-–]\s*\d{1,2}(:\d{2})?\s*(am|pm)?)?$/i.test(line)) continue;
            if (/^https?:\/\//i.test(line)) continue;
            // First candidate decides: a plausible title is short; a long first
            // line is prose/description, so no hint is derived at all.
            return line.length <= this.extractionLimits.multiEventTitleMaxChars ? line : '';
        }
        return '';
    }

    // A segment whose listing title is a venue-hours notice ("Tuesday Closed")
    // describes no event — it must never claim a page image, or a real
    // sibling's flyer gets attached to the phantom row and the real event goes
    // imageless. Gates BOTH image matchers; a segment with no derivable title
    // stays eligible (fail open).
    isSegmentEligibleForImagePairing(segment) {
        return !this.isVenueHoursNoticeTitle(this.deriveSegmentListingTitle(segment));
    }

    buildMultiEventSegmentHtmlData(htmlData, segment, index, totalSegments, ocrResults = []) {
        const sourceUrl = htmlData && typeof htmlData.url === 'string' ? htmlData.url : '';
        const segmentHtml = segment && typeof segment.html === 'string' ? segment.html : '';

        // Extract OCR results specific to this segment
        const segmentOcrResults = ocrResults && ocrResults.length > 0
            ? this.filterOcrResultsForSegment(ocrResults, segment, sourceUrl)
            : [];

        const resourceLines = this.extractMultiEventSegmentResourceLines(
            segmentHtml,
            sourceUrl,
            segment && Array.isArray(segment.imageHintUrls) ? segment.imageHintUrls : [],
            segmentOcrResults,
            segment && segment.ocrExcludedUrlKeys instanceof Set ? segment.ocrExcludedUrlKeys : null
        );
        const contextLines = [
            `SEGMENT_INDEX: ${index + 1}/${totalSegments}`,
            ...resourceLines
        ].filter(Boolean);
        const segmentContent = segmentHtml || (segment && Array.isArray(segment.lines) ? segment.lines.join('\n') : '');
        return {
            ...htmlData,
            html: contextLines.length > 0 ? `${contextLines.join('\n')}\n${segmentContent}` : segmentContent,
            // The segment's own page text WITHOUT the resource/OCR context
            // lines — the bar-convergence rescue's PAGE corpus, so OCR text
            // stays an independent signal instead of leaking into the page.
            segmentText: segmentContent,
            aiEvent: null,
            aiExtraction: null,
            ocrResults: segmentOcrResults,
            segmentListingTitle: this.deriveSegmentListingTitle(segment),
            dataFlags: { ocr: true, segment: true }  // Segments are unstructured data
        };
    }

    buildMultiEventSegments(html, sourceUrl = '', ocrResults = []) {
        const structuredSegments = this.buildStructuredMultiEventSegments(html);
        if (structuredSegments.length >= 2) {
            return this.attachSequentialImageHintsToSegments(html, structuredSegments, sourceUrl, ocrResults);
        }

        const bodyParts = this.trimLeadingMultiEventNoise(
            this.extractBodyParts(html).slice(0, this.extractionLimits.multiEventScanLineLimit)
        );
        if (bodyParts.length === 0) return [];
        const rawSegments = [];
        let currentLines = [];
        const minSegmentLines = this.extractionLimits.multiEventMinSegmentLines;
        const maxSegmentLines = this.extractionLimits.multiEventMaxSegmentLines;

        const pushCurrent = () => {
            if (currentLines.length > 0) {
                rawSegments.push(currentLines);
                currentLines = [];
            }
        };

        for (const rawLine of bodyParts) {
            const line = this.trimToMaxLength(this.normalizeWhitespace(rawLine), this.extractionLimits.multiEventLineMaxChars);
            if (!line) continue;
            // Compact event lines (date + event name in one line) can start a new segment
            // with just 1 prior line that has a date signal, rather than minSegmentLines.
            const effectiveSplitMin = this.isCompactEventLine(line) ? 1 : minSegmentLines;
            const startsNewByDate = this.hasMultiEventDateSignal(line) &&
                currentLines.length >= effectiveSplitMin &&
                this.segmentHasDateSignal(currentLines);
            const startsNewByTitle = this.isStrongMultiEventTitleLine(line) &&
                currentLines.length >= minSegmentLines &&
                this.segmentHasDateSignal(currentLines) &&
                !this.hasMultiEventDateSignal(currentLines[currentLines.length - 1]);
            if (startsNewByDate) {
                const trailingStartIndex = this.findTrailingMultiEventStartIndex(currentLines);
                if (trailingStartIndex > 0) {
                    rawSegments.push(currentLines.slice(0, trailingStartIndex));
                    currentLines = currentLines.slice(trailingStartIndex);
                } else {
                    pushCurrent();
                }
            } else if (startsNewByTitle) {
                pushCurrent();
            }
            currentLines.push(line);
            if (currentLines.length >= maxSegmentLines) {
                pushCurrent();
            }
        }
        pushCurrent();

        const uniqueSegments = [];
        const seen = new Set();
        for (const lines of rawSegments) {
            const normalizedLines = Array.isArray(lines)
                ? lines.map(line => this.normalizeWhitespace(line)).filter(Boolean)
                : [];
            // Compact-only segments (every line is a self-contained dated event) require
            // only 1 line; regular segments require minSegmentLines.
            const isCompactOnly = normalizedLines.length > 0 &&
                normalizedLines.every(l => this.isCompactEventLine(l));
            const effectiveMinLines = isCompactOnly ? 1 : minSegmentLines;
            if (normalizedLines.length < effectiveMinLines) continue;
            if (!this.segmentHasDateSignal(normalizedLines)) continue;
            if (!this.segmentHasTitleSignal(normalizedLines)) continue;
            const trimmedLines = this.trimSegmentLinesToChars(normalizedLines, this.extractionLimits.multiEventMaxSegmentChars);
            const segmentText = trimmedLines.join('\n');
            if (segmentText.length < this.extractionLimits.multiEventMinSegmentChars) continue;
            const dedupeKey = segmentText.toLowerCase();
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            uniqueSegments.push({
                lines: trimmedLines,
                html: this.extractRawHtmlForMultiEventSegment(html, trimmedLines)
            });
            if (uniqueSegments.length >= this.extractionLimits.multiEventMaxSegments) break;
        }
        return this.attachSequentialImageHintsToSegments(html, uniqueSegments, sourceUrl, ocrResults);
    }


    buildStructuredMultiEventSegments(html) {
        const groups = this.extractRepeatedMultiEventStructureGroups(html);
        for (const group of groups) {
            const segments = this.buildSegmentsFromStructureGroup(group);
            if (segments.length >= 2) return segments;
        }
        return [];
    }


    extractRepeatedMultiEventStructureGroups(html) {
        const source = String(html || '');
        if (!source) return [];

        const grouped = new Map();
        const addCandidate = (signature, entry) => {
            if (!signature || !entry || !entry.html) return;
            if (!grouped.has(signature)) grouped.set(signature, []);
            grouped.get(signature).push(entry);
        };

        const containerPatterns = [
            /<(section|article|li)\b([^>]*)>[\s\S]*?<\/\1>/gi,
            /<(div)\b([^>]*)>[\s\S]*?<\/\1>/gi
        ];

        for (const pattern of containerPatterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(source)) !== null) {
                const tagName = String(match[1] || '').toLowerCase();
                const attrs = match[2] || '';
                if (tagName === 'div' && !this.hasMultiEventStructureHint(attrs)) continue;
                const containerHtml = match[0];
                if (containerHtml.length > this.extractionLimits.multiEventMaxSegmentChars * 4) continue;
                const signature = this.getMultiEventStructureSignature(tagName, attrs);
                addCandidate(`container:${signature}`, {
                    html: containerHtml,
                    start: match.index,
                    end: match.index + containerHtml.length,
                    kind: 'container'
                });
            }
        }

        for (const resourceGroup of this.extractRepeatedMultiEventResourceGroups(source)) {
            grouped.set(resourceGroup.signature, resourceGroup.entries);
        }

        return Array.from(grouped.entries())
            .map(([signature, entries]) => ({
                signature,
                entries: entries.sort((a, b) => a.start - b.start),
                eventLikeCount: entries.filter(entry => this.isMultiEventLikeHtml(entry.html)).length
            }))
            .filter(group => group.entries.length >= 2 && group.eventLikeCount >= 2)
            .sort((a, b) => {
                if (b.eventLikeCount !== a.eventLikeCount) return b.eventLikeCount - a.eventLikeCount;
                if (b.entries.length !== a.entries.length) return b.entries.length - a.entries.length;
                return a.entries[0].start - b.entries[0].start;
            });
    }


    buildSegmentsFromStructureGroup(group) {
        const entries = group && Array.isArray(group.entries) ? group.entries : [];
        const uniqueSegments = [];
        const seen = new Set();
        const addSegment = (segment) => {
            if (!segment || !Array.isArray(segment.lines)) return;
            const segmentText = segment.lines.join('\n');
            if (segmentText.length < this.extractionLimits.multiEventMinSegmentChars) return;
            const dedupeKey = segmentText.toLowerCase();
            if (seen.has(dedupeKey)) return;
            seen.add(dedupeKey);
            uniqueSegments.push(segment);
        };

        for (const entry of entries) {
            const normalizedLines = this.extractBodyParts(entry.html)
                .map(line => this.normalizeWhitespace(line))
                .filter(Boolean);
            if (normalizedLines.length < this.extractionLimits.multiEventMinSegmentLines) continue;
            if (this.hasMultiEventScriptLikeText(normalizedLines)) continue;
            if (this.countMultiEventDateSignals(normalizedLines) > 2) continue;
            if (!this.segmentHasDateSignal(normalizedLines)) continue;
            if (!this.segmentHasTitleSignal(normalizedLines)) continue;

            const splitSegments = this.buildTextMultiEventSegmentsFromLines(normalizedLines, entry.html);
            if (splitSegments.length > 1) {
                splitSegments.forEach(addSegment);
            } else {
                const segmentLines = splitSegments.length === 1 ? splitSegments[0].lines : normalizedLines;
                const trimmedLines = this.trimSegmentLinesToChars(
                    this.trimLinesAfterTerminalCallToAction(segmentLines),
                    this.extractionLimits.multiEventMaxSegmentChars
                );
                addSegment({ lines: trimmedLines, html: entry.html });
            }
            if (uniqueSegments.length >= this.extractionLimits.multiEventMaxSegments) break;
        }
        return uniqueSegments;
    }

    buildTextMultiEventSegmentsFromLines(lines, html = '') {
        const rawSegments = [];
        let currentLines = [];
        const minSegmentLines = this.extractionLimits.multiEventMinSegmentLines;
        const maxSegmentLines = this.extractionLimits.multiEventMaxSegmentLines;
        const pushCurrent = () => {
            if (currentLines.length > 0) {
                rawSegments.push(currentLines);
                currentLines = [];
            }
        };

        for (const rawLine of Array.isArray(lines) ? lines : []) {
            const line = this.trimToMaxLength(this.normalizeWhitespace(rawLine), this.extractionLimits.multiEventLineMaxChars);
            if (!line) continue;
            const effectiveSplitMin = this.isCompactEventLine(line) ? 1 : minSegmentLines;
            const startsNewByDate = this.hasMultiEventDateSignal(line) &&
                currentLines.length >= effectiveSplitMin &&
                this.segmentHasDateSignal(currentLines);
            const startsNewByTitle = this.isStrongMultiEventTitleLine(line) &&
                currentLines.length >= minSegmentLines &&
                this.segmentHasDateSignal(currentLines) &&
                !this.hasMultiEventDateSignal(currentLines[currentLines.length - 1]);
            if (startsNewByDate) {
                const trailingStartIndex = this.findTrailingMultiEventStartIndex(currentLines);
                if (trailingStartIndex > 0) {
                    rawSegments.push(currentLines.slice(0, trailingStartIndex));
                    currentLines = currentLines.slice(trailingStartIndex);
                } else {
                    pushCurrent();
                }
            } else if (startsNewByTitle) {
                pushCurrent();
            }
            currentLines.push(line);
            if (currentLines.length >= maxSegmentLines) pushCurrent();
        }
        pushCurrent();

        const segments = [];
        for (const segmentLines of rawSegments) {
            const normalizedLines = segmentLines.map(line => this.normalizeWhitespace(line)).filter(Boolean);
            if (normalizedLines.length < minSegmentLines) continue;
            if (!this.segmentHasDateSignal(normalizedLines)) continue;
            if (!this.segmentHasTitleSignal(normalizedLines)) continue;
            const trimmedLines = this.trimSegmentLinesToChars(
                this.trimLinesAfterTerminalCallToAction(normalizedLines),
                this.extractionLimits.multiEventMaxSegmentChars
            );
            const segmentHtml = html ? this.extractRawHtmlForMultiEventSegment(html, trimmedLines) : trimmedLines.join('\n');
            segments.push({
                lines: trimmedLines,
                html: segmentHtml || html || trimmedLines.join('\n')
            });
        }
        return segments;
    }

    countMultiEventDateSignals(lines) {
        return (Array.isArray(lines) ? lines : []).filter(line => this.hasMultiEventDateSignal(line)).length;
    }

    hasMultiEventScriptLikeText(lines) {
        return (Array.isArray(lines) ? lines : []).some(line => {
            const text = String(line || '');
            return text.length > this.extractionLimits.multiEventLineMaxChars * 2 ||
                /=>|function\s*\(|\b(var|let|const)\s+[a-z_$][\w$]*\s*=|webpack|rspack|strict";var/i.test(text);
        });
    }

    isMultiEventLikeHtml(html) {
        const lines = this.extractBodyParts(html);
        return this.segmentHasDateSignal(lines) && this.segmentHasTitleSignal(lines);
    }

    hasMultiEventStructureHint(attrs) {
        const text = String(attrs || '').toLowerCase();
        return /(?:^|[\s_-])(event|events|card|item|poster|photo|media|gallery|listing|list|slide|repeater|image|img)(?:[\s_-]|$)/i.test(text);
    }

    getMultiEventStructureSignature(tagName, attrs) {
        const tag = String(tagName || '').toLowerCase() || 'node';
        const tokens = this.extractStructureTokens(attrs);
        const semanticParts = new Set();
        tokens.forEach(token => {
            token.split(/[-_]+/).forEach(part => {
                if (/^(event|events|card|item|poster|photo|media|gallery|listing|list|slide|repeater|image|img)$/.test(part)) {
                    semanticParts.add(part);
                }
            });
            if (/image|img|poster|photo|media|gallery/.test(token)) semanticParts.add('image');
            if (/event|card|listing|repeater|slide/.test(token)) semanticParts.add('event');
        });
        const semanticTokens = Array.from(semanticParts).sort();
        if (semanticTokens.length > 0) return `${tag}:${semanticTokens.join('.')}`;

        const reusableTokens = tokens
            .filter(token => !/^comp[-_]/i.test(token))
            .filter(token => !/[a-f0-9]{8,}/i.test(token))
            .slice(0, 4);
        return `${tag}:${reusableTokens.join('.') || 'plain'}`;
    }

    extractStructureTokens(attrs) {
        const text = String(attrs || '');
        const tokens = [];
        const attrRegex = /\b(?:class|data-testid|data-hook|role)\s*=\s*["']([^"']+)["']/gi;
        let match;
        while ((match = attrRegex.exec(text)) !== null) {
            String(match[1] || '')
                .split(/\s+/)
                .map(token => token.toLowerCase().replace(/[^a-z0-9_-]+/g, ''))
                .filter(token => token.length >= 2 && token.length <= 40)
                .forEach(token => tokens.push(token));
        }
        return Array.from(new Set(tokens)).sort();
    }

    extractRepeatedMultiEventResourceGroups(html) {
        const source = String(html || '');
        const anchors = [];
        const addAnchorsForPattern = (pattern, fallbackTag) => {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(source)) !== null) {
                const openTag = match[0];
                const tagMatch = openTag.match(/^<([a-z0-9]+)\b([^>]*)>/i);
                const tagName = tagMatch ? tagMatch[1] : fallbackTag;
                const attrs = tagMatch ? tagMatch[2] : '';
                const signature = `resource:${this.getMultiEventStructureSignature(tagName, attrs)}`;
                const start = match.index;
                if (anchors.some(anchor => Math.abs(anchor.start - start) < 200)) continue;
                anchors.push({ start, signature });
            }
        };

        addAnchorsForPattern(this.multiEventImageContainerRegex(), 'div');
        if (anchors.length < 2) {
            addAnchorsForPattern(/<a\b[^>]*>\s*<img\b[^>]*>/gi, 'a');
            addAnchorsForPattern(/<img\b[^>]*>/gi, 'img');
        }

        const bySignature = new Map();
        anchors.sort((a, b) => a.start - b.start).forEach(anchor => {
            if (!bySignature.has(anchor.signature)) bySignature.set(anchor.signature, []);
            bySignature.get(anchor.signature).push(anchor);
        });

        const groups = [];
        for (const [signature, groupAnchors] of bySignature.entries()) {
            if (groupAnchors.length < 2) continue;
            const entries = groupAnchors.map((anchor, index) => {
                const nextAnchor = groupAnchors[index + 1];
                const end = nextAnchor
                    ? nextAnchor.start
                    : Math.min(source.length, anchor.start + this.extractionLimits.multiEventMaxSegmentChars * 4);
                return {
                    html: source.slice(anchor.start, end),
                    start: anchor.start,
                    end,
                    kind: 'resource'
                };
            });
            groups.push({ signature, entries });
        }
        return groups;
    }

    describeMultiEventSegment(segment, sourceUrl = '') {
        const lines = segment && Array.isArray(segment.lines) ? segment.lines : [];
        const resourceLines = this.extractMultiEventSegmentResourceLines(
            segment && typeof segment.html === 'string' ? segment.html : '',
            sourceUrl,
            segment && Array.isArray(segment.imageHintUrls) ? segment.imageHintUrls : []
        );
        const imageUrls = resourceLines
            .filter(line => /^SEGMENT_IMAGE(?:_HINT)?_URL:/i.test(line))
            .map(line => line.replace(/^SEGMENT_IMAGE(?:_HINT)?_URL:\s*/i, '').trim())
            .filter(Boolean);
        return {
            lineCount: lines.length,
            preview: lines.slice(0, 3).join(' | '),
            imageUrls,
            resourceLines
        };
    }

    attachSequentialImageHintsToSegments(html, segments, sourceUrl = '', ocrResults = []) {
        const source = String(html || '');
        const sourceSegments = Array.isArray(segments) ? segments : [];
        if (!source || sourceSegments.length < 2) return sourceSegments;
        const pageImageRecords = this.extractOrderedImageRecordsFromHtml(
            source,
            sourceUrl,
            Math.max(sourceSegments.length * 4, sourceSegments.length + 6)
        );
        // Even if there's only 1 image on the page, we still want to match it to a segment using OCR
        if (pageImageRecords.length === 0) return sourceSegments;

        const primarySegmentImages = sourceSegments.map(segment => {
            const images = this.extractOrderedImageUrlsFromHtml(
                segment && typeof segment.html === 'string' ? segment.html : '',
                sourceUrl,
                1
            );
            return images[0] || '';
        });
        const nonEmptyPrimaryImages = primarySegmentImages.filter(Boolean);
        const hasMissingPrimaryImages = primarySegmentImages.some(url => !url);
        const hasDuplicatePrimaryImages = new Set(nonEmptyPrimaryImages).size < nonEmptyPrimaryImages.length;
        if (!hasMissingPrimaryImages && !hasDuplicatePrimaryImages) {
            return sourceSegments;
        }

        const pageTextRecords = this.extractBodyPartRecords(source);
        const segmentBounds = sourceSegments.map((segment, index) => {
            const bounds = this.findMultiEventSegmentTextBounds(
                source,
                segment && Array.isArray(segment.lines) ? segment.lines : [],
                pageTextRecords
            );
            if (!bounds) {
                console.log(`🤖 AI Web: Failed to find exact text bounds for segment ${index + 1}. Will use fallback text for OCR similarity.`);
            }
            return bounds;
        });

        // Venue-hours notice segments ("Tuesday Closed") never take part in
        // image pairing — a claimed flyer would be stolen from a real sibling.
        const segmentEligibility = sourceSegments.map((segment, index) => {
            const eligible = this.isSegmentEligibleForImagePairing(segment);
            if (!eligible) {
                console.log(`🤖 AI Web: Segment ${index + 1} ("${this.deriveSegmentListingTitle(segment)}") is a venue-hours notice — not eligible for image pairing`);
            }
            return eligible;
        });

        // Use OCR results for better image-segment pairing if available
        const matchedImageUrls = ocrResults && ocrResults.length > 0
            ? this.matchOrderedImagesToSegmentsWithOcr(sourceSegments, segmentBounds, pageImageRecords, ocrResults, segmentEligibility)
            : this.matchOrderedImagesToSegments(segmentBounds, pageImageRecords, segmentEligibility);

        // Deduplicate matchedImageUrls by stripped URL to prevent same image at different sizes
        // from being assigned to different segments. This is a safety net since pageImageRecords
        // is already deduplicated, but OCR results or matching edge cases could still produce duplicates.
        const seenStrippedUrls = new Set();
        const dedupedMatchedImageUrls = matchedImageUrls.map(url => {
            if (!url) return url;
            const strippedUrl = this.stripSizeParams(url);
            if (seenStrippedUrls.has(strippedUrl)) {
                // This image (at some size) was already assigned, return null to skip
                return null;
            }
            seenStrippedUrls.add(strippedUrl);
            return url;
        });

        return sourceSegments.map((segment, index) => {
            const orderedImage = dedupedMatchedImageUrls[index];
            // Skip if this image was already assigned to an earlier segment
            if (!orderedImage || !segment || typeof segment !== 'object') return segment;
            const existingImages = this.extractOrderedImageUrlsFromHtml(
                segment && typeof segment.html === 'string' ? segment.html : '',
                sourceUrl,
                2
            );
            // Check if this image (at any size) is already in the segment
            const strippedOrderedImage = this.stripSizeParams(orderedImage);
            const hasDuplicateSize = existingImages.some(img => {
                const strippedImg = this.stripSizeParams(img);
                return strippedImg && strippedOrderedImage === strippedImg;
            });
            if (hasDuplicateSize) return segment;
            return {
                ...segment,
                imageHintUrls: [orderedImage]
            };
        });
    }

    matchOrderedImagesToSegments(segmentBounds, imageRecords, segmentEligibility = null) {
        const boundsList = Array.isArray(segmentBounds) ? segmentBounds : [];
        const records = Array.isArray(imageRecords) ? imageRecords : [];
        const eligibility = Array.isArray(segmentEligibility) ? segmentEligibility : null;
        if (boundsList.length === 0 || records.length === 0) return [];
        if (!boundsList.some(bounds => bounds && Number.isFinite(bounds.rawStart) && Number.isFinite(bounds.rawEnd))) {
            return [];
        }

        const betterState = (current, candidate) => {
            if (!candidate) return current;
            if (!current) return candidate;
            if (candidate.matches !== current.matches) {
                return candidate.matches > current.matches ? candidate : current;
            }
            if (candidate.cost !== current.cost) {
                return candidate.cost < current.cost ? candidate : current;
            }
            return candidate.steps < current.steps ? candidate : current;
        };

        const dp = Array.from({ length: boundsList.length + 1 }, () => Array(records.length + 1).fill(null));
        dp[0][0] = { matches: 0, cost: 0, steps: 0, prev: null, action: '' };

        for (let segmentIndex = 0; segmentIndex <= boundsList.length; segmentIndex++) {
            for (let imageIndex = 0; imageIndex <= records.length; imageIndex++) {
                const state = dp[segmentIndex][imageIndex];
                if (!state) continue;

                if (segmentIndex < boundsList.length) {
                    dp[segmentIndex + 1][imageIndex] = betterState(dp[segmentIndex + 1][imageIndex], {
                        matches: state.matches,
                        cost: state.cost,
                        steps: state.steps + 1,
                        prev: [segmentIndex, imageIndex],
                        action: 'skip-segment'
                    });
                }

                if (imageIndex < records.length) {
                    dp[segmentIndex][imageIndex + 1] = betterState(dp[segmentIndex][imageIndex + 1], {
                        matches: state.matches,
                        cost: state.cost,
                        steps: state.steps + 1,
                        prev: [segmentIndex, imageIndex],
                        action: 'skip-image'
                    });
                }

                // An ineligible (venue-hours notice) segment may be skipped but
                // never takes the 'match' action — it cannot claim an image.
                if (segmentIndex < boundsList.length && imageIndex < records.length
                    && (!eligibility || eligibility[segmentIndex] !== false)) {
                    const pairingCost = this.getSegmentImagePairingCost(boundsList[segmentIndex], records[imageIndex]);
                    if (Number.isFinite(pairingCost)) {
                        dp[segmentIndex + 1][imageIndex + 1] = betterState(dp[segmentIndex + 1][imageIndex + 1], {
                            matches: state.matches + 1,
                            cost: state.cost + pairingCost,
                            steps: state.steps + 1,
                            prev: [segmentIndex, imageIndex],
                            action: 'match'
                        });
                    }
                }
            }
        }

        const matchedUrls = [];
        let segmentIndex = boundsList.length;
        let imageIndex = records.length;
        let state = dp[segmentIndex][imageIndex];
        while (state && state.prev) {
            if (state.action === 'match') {
                matchedUrls[segmentIndex - 1] = records[imageIndex - 1].url;
            }
            const [prevSegmentIndex, prevImageIndex] = state.prev;
            segmentIndex = prevSegmentIndex;
            imageIndex = prevImageIndex;
            state = dp[segmentIndex][imageIndex];
        }
        return matchedUrls;
    }

    matchOrderedImagesToSegmentsWithOcr(segments, segmentBounds, imageRecords, ocrResults, segmentEligibility = null) {
        const sourceSegments = Array.isArray(segments) ? segments : [];
        const boundsList = Array.isArray(segmentBounds) ? segmentBounds : [];
        const records = Array.isArray(imageRecords) ? imageRecords : [];
        const eligibility = Array.isArray(segmentEligibility) ? segmentEligibility : null;
        if (boundsList.length === 0 || records.length === 0) return [];
        if (!boundsList.some(bounds => bounds && Number.isFinite(bounds.rawStart) && Number.isFinite(bounds.rawEnd))) {
            return [];
        }

        // Deduplicate OCR results by stripped URL to prevent same image at different sizes
        // from being matched multiple times. Select the largest image from each group.
        const dedupedOcrResults = this.deduplicateOcrResultsByUrl(ocrResults || []);

        // Create a map of stripped image URL to OCR result for quick lookup
        const ocrMap = new Map();
        if (Array.isArray(dedupedOcrResults)) {
            for (const result of dedupedOcrResults) {
                if (result && result.url) {
                    const normalizedUrl = this.normalizeHttpUrlValue(result.url);
                    const strippedUrl = this.stripSizeParams(normalizedUrl);
                    if (strippedUrl) ocrMap.set(strippedUrl, result);
                }
            }
        }

        const pairings = [];
        for (let i = 0; i < boundsList.length; i++) {
            // Ineligible (venue-hours notice) segments never enter the pairing
            // pool at all — the similarity override in
            // getSegmentImagePairingCostWithOcr could otherwise hand a phantom
            // row a real sibling's flyer.
            if (eligibility && eligibility[i] === false) continue;
            for (let j = 0; j < records.length; j++) {
                const imageRecord = records[j];
                const normalizedUrl = this.normalizeHttpUrlValue(imageRecord.url);
                const ocrResult = ocrMap.get(this.stripSizeParams(normalizedUrl));

                const segment = sourceSegments[i];
                const fallbackText = segment && Array.isArray(segment.lines) ? segment.lines.join('\n') : '';

                const pairingResult = this.getSegmentImagePairingCostWithOcr(
                    boundsList[i],
                    imageRecord,
                    ocrResult,
                    fallbackText
                );

                if (Number.isFinite(pairingResult.cost)) {
                    pairings.push({
                        segmentIndex: i,
                        imageIndex: j,
                        score: pairingResult.score,
                        cost: pairingResult.cost,
                        url: imageRecord.url
                    });
                }
            }
        }

        pairings.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.cost - b.cost;
        });

        const matchedUrls = new Array(boundsList.length).fill(null);
        const usedImages = new Set();
        const usedSegments = new Set();

        for (const pair of pairings) {
            if (!usedSegments.has(pair.segmentIndex) && !usedImages.has(pair.imageIndex)) {
                matchedUrls[pair.segmentIndex] = pair.url;
                usedSegments.add(pair.segmentIndex);
                usedImages.add(pair.imageIndex);
                console.log(`🤖 AI Web: Successfully matched OCR image to segment ${pair.segmentIndex + 1} (score: ${pair.score.toFixed(1)}, cost: ${pair.cost})`);
            }
        }

        return matchedUrls;
    }

    getSegmentImagePairingCostWithOcr(segmentBounds, imageRecord, ocrResult, fallbackText = '') {
        // Base cost from HTML proximity
        const proximityCost = this.getSegmentImagePairingCost(segmentBounds, imageRecord);

        // Only allow event-flyer classification - other image types don't contain event details
        if (ocrResult?.imageClassification !== 'event-flyer') {
            return { cost: Infinity, score: -Infinity };
        }

        // Start with proximity-based cost and base score for valid event-flyer
        let cost = proximityCost;
        let score = 100;  // Base score for valid event-flyer classification

        // Text similarity bonus - compare OCR text with segment content
        let similarity = 0;
        let segmentText = fallbackText;
        if (segmentBounds && Array.isArray(segmentBounds.matchedRecords) && segmentBounds.matchedRecords.length > 0) {
            segmentText = segmentBounds.matchedRecords.map(r => r.text).join('\n');
        }

        if (ocrResult.text && segmentText) {
            similarity = this.computeTextSimilarity(ocrResult.text, segmentText);

            console.log(`🤖 AI Web: OCR similarity for image vs segment text -> ${similarity.toFixed(3)} (threshold: 0.15)`);

            if (similarity >= 0.15) {
                score += similarity * 100;  // Up to 100 points for good similarity

                // If similarity is good but proximity is Infinity (e.g. absolute positioning),
                // override proximity cost so it can still match
                if (!Number.isFinite(cost)) {
                    cost = 20000; // Arbitrary high finite cost, but beatable by a good score
                }
            }
        }

        if (!Number.isFinite(cost)) {
            return { cost: Infinity, score: -Infinity };
        }

        return { cost, score };
    }

    getSegmentImagePairingCost(segmentBounds, imageRecord) {
        if (!segmentBounds || !imageRecord) return Infinity;
        const segmentStart = Number(segmentBounds.rawStart);
        const segmentEnd = Number(segmentBounds.rawEnd);
        const imageStart = Number(imageRecord.start);
        const rawImageEnd = Number(imageRecord.end);
        const imageEnd = Number.isFinite(rawImageEnd) && rawImageEnd >= imageStart ? rawImageEnd : imageStart;
        if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd) || !Number.isFinite(imageStart)) {
            return Infinity;
        }

        if (imageStart <= segmentEnd && imageEnd >= segmentStart) {
            return 0;
        }
        if (imageEnd <= segmentStart) {
            const gap = segmentStart - imageEnd;
            return gap <= 12000 ? gap : Infinity;
        }
        if (imageStart >= segmentEnd) {
            const gap = imageStart - segmentEnd;
            return gap <= 5000 ? gap + 2000 : Infinity;
        }
        return Infinity;
    }

    extractOrderedImageRecordsFromHtml(html, sourceUrl = '', maxUrls = Infinity) {
        const source = String(html || '');
        if (!source) return [];
        const limit = Number.isFinite(Number(maxUrls)) ? Math.max(0, Math.floor(Number(maxUrls))) : Infinity;
        if (limit === 0) return [];

        const results = [];
        const seen = new Set();
        const addImageRecord = (rawUrl, start, end) => {
            const normalized = this.normalizeUrl(String(rawUrl || '').trim(), sourceUrl);
            if (!normalized) return;
            const unwrapped = this.unwrapImageProxyUrl(normalized);
            const finalUrl = this.normalizeHttpUrlValue(unwrapped || normalized);
            if (!finalUrl) return;
            // Use stripped URL for deduplication to handle same image at different sizes
            const strippedUrl = this.stripSizeParams(finalUrl);
            if (seen.has(strippedUrl)) return;
            if (!this.hasSupportedImageFilenameAtEnd(finalUrl) && !this.hasLikelyImageUrl(finalUrl)) return;
            seen.add(strippedUrl);
            results.push({
                url: finalUrl,
                start: Number.isFinite(Number(start)) ? Number(start) : -1,
                end: Number.isFinite(Number(end)) ? Number(end) : (Number.isFinite(Number(start)) ? Number(start) : -1)
            });
        };

        const attrPatterns = [
            /\b(?:src|data-src|data-lazy-src|poster|content)=["']([^"']+)["']/gi,
            /\bsrcset=["']([^"']+)["']/gi
        ];
        for (const pattern of attrPatterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(source)) !== null) {
                const attributeValue = String(match[1] || '').trim();
                if (!attributeValue) continue;
                if (pattern.source.includes('srcset')) {
                    attributeValue.split(',').forEach(part => {
                        const candidate = String(part || '').trim().split(/\s+/)[0];
                        if (candidate) addImageRecord(candidate, match.index, pattern.lastIndex);
                    });
                } else {
                    addImageRecord(attributeValue, match.index, pattern.lastIndex);
                }
                if (results.length >= limit) return results.slice(0, limit);
            }
        }

        const rawCandidates = this.extractUrlCandidatesFromRawHtml(source);
        for (const candidate of rawCandidates) {
            const rawUrl = candidate && typeof candidate === 'object' ? candidate.url : candidate;
            addImageRecord(rawUrl, -1, -1);
            if (results.length >= limit) break;
        }
        return results.slice(0, limit);
    }

    extractOrderedImageUrlsFromHtml(html, sourceUrl = '', maxUrls = Infinity) {
        return this.extractOrderedImageRecordsFromHtml(html, sourceUrl, maxUrls)
            .map(record => record.url)
            .filter(Boolean);
    }
    trimLeadingMultiEventNoise(lines) {
        const normalizedLines = (Array.isArray(lines) ? lines : [])
            .map(line => this.normalizeWhitespace(line))
            .filter(Boolean);
        const firstStrongTitleIndex = normalizedLines.findIndex(line => this.isStrongMultiEventTitleLine(line));
        return firstStrongTitleIndex > 0
            ? normalizedLines.slice(firstStrongTitleIndex)
            : normalizedLines;
    }
    trimLinesAfterTerminalCallToAction(lines) {
        const normalizedLines = (Array.isArray(lines) ? lines : [])
            .map(line => this.normalizeWhitespace(line))
            .filter(Boolean);
        const ctaIndex = normalizedLines.findIndex(line => this.isMultiEventCallToActionLine(line));
        return ctaIndex >= 0 ? normalizedLines.slice(0, ctaIndex + 1) : normalizedLines;
    }

    isMultiEventCallToActionLine(value) {
        const line = this.normalizeWhitespace(value);
        if (!line) return false;
        return /^(get|buy|book|register|learn|more)\b.*\b(ticket|tickets|spot|today|here)\b/i.test(line) ||
            /^(ticket|tickets|buy tickets|get tickets)$/i.test(line);
    }

    isStrongMultiEventTitleLine(value) {
        const line = this.normalizeWhitespace(String(value || '').replace(/[\u200b\u00a0]/g, ' '));
        if (!line) return false;
        if (this.isMultiEventCallToActionLine(line)) return false;
        if (this.hasMultiEventDateSignal(line)) return false;
        if (/^@/.test(line)) return false;
        if (/[.!?]$/.test(line)) return false;
        if (line.includes('|')) return false;
        if (this.isLikelyMultiEventLocationLine(line)) return false;
        const words = line.split(/\s+/).filter(Boolean);
        const lowerCaseLetterMatches = line.match(/[a-z]/g) || [];
        const upperCaseLetterMatches = line.match(/[A-Z]/g) || [];
        if (upperCaseLetterMatches.length === 0 && lowerCaseLetterMatches.length > 0) return false;
        if (words.length > 8) return false;
        if (/\b(party|parties|festival|weekend|week|night|social|dance|disco|debut|camp|celebration|anniversary|opening|pride)\b/i.test(line)) return true;
        const letterMatches = line.match(/[A-Za-z]/g) || [];
        const uppercaseMatches = line.match(/[A-Z]/g) || [];
        const uppercaseRatio = letterMatches.length > 0 ? uppercaseMatches.length / letterMatches.length : 0;
        const hasBrandedToken = words.some(word => /[A-Z]{2,}/.test(word));
        return hasBrandedToken || uppercaseRatio >= 0.55;
    }

    isLikelyMultiEventLocationLine(value) {
        const line = this.normalizeWhitespace(value);
        if (!line) return false;
        if (/, ?[A-Z]{2}(?:\b|$)/.test(line)) return true;
        if (/,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?$/.test(line) && line.split(/\s+/).length <= 5) return true;
        return /^[A-Z][A-Za-z .'-]+\s+-\s+[A-Z][A-Za-z .'-]+(?:,\s*[A-Z]{2})?$/.test(line);

    }

    findTrailingMultiEventStartIndex(lines) {
        const normalizedLines = (Array.isArray(lines) ? lines : [])
            .map(line => this.normalizeWhitespace(line))
            .filter(Boolean);
        const lastDateIndex = this.lastMultiEventDateSignalIndex(normalizedLines);
        if (lastDateIndex < 0 || lastDateIndex >= normalizedLines.length - 1) return -1;
        for (let i = lastDateIndex + 1; i < normalizedLines.length; i++) {
            if (this.isStrongMultiEventTitleLine(normalizedLines[i])) {
                return i;
            }
        }
        return -1;
    }

    lastMultiEventDateSignalIndex(lines) {
        for (let i = (Array.isArray(lines) ? lines.length : 0) - 1; i >= 0; i--) {
            if (this.hasMultiEventDateSignal(lines[i])) return i;
        }
        return -1;
    }

    computeTextSimilarity(text1, text2) {
        // Normalize texts, replacing punctuation with spaces before compressing spaces
        const normalize = t => String(t || '').toLowerCase().replace(/[^\w\s]|_/g, ' ').replace(/\s+/g, ' ').trim();
        const t1 = normalize(text1);
        const t2 = normalize(text2);

        if (!t1 || !t2) return 0;

        // Create token sets
        const tokens1 = new Set(t1.split(/\s+/).filter(t => t.length >= 3));
        const tokens2 = new Set(t2.split(/\s+/).filter(t => t.length >= 3));

        if (tokens1.size === 0 || tokens2.size === 0) return 0;

        // Calculate intersection
        let intersection = 0;
        for (const token of tokens1) {
            if (tokens2.has(token)) intersection++;
        }

        // Jaccard-like similarity: intersection over min size
        const minSize = Math.min(tokens1.size, tokens2.size);
        const similarity = intersection / minSize;

        return similarity;
    }

    extractRawHtmlForMultiEventSegment(html, lines) {
        const source = String(html || '');
        const segmentLines = (Array.isArray(lines) ? lines : [])
            .map(line => this.normalizeWhitespace(line))
            .filter(Boolean);
        if (!source || segmentLines.length === 0) return '';

        const textBounds = this.findMultiEventSegmentTextBounds(source, segmentLines);
        if (!textBounds) {
            return segmentLines.join('\n');
        }

        const firstStart = textBounds.rawStart;
        const lastEnd = textBounds.rawEnd;
        const rawStart = this.findMultiEventSegmentResourceStart(source, firstStart);
        // If we already captured an image block before the segment text, stop at the
        // text boundary so we do not accidentally absorb the next segment's image.
        const rawEnd = rawStart < firstStart
            ? lastEnd
            : this.findMultiEventSegmentResourceEnd(source, lastEnd);
        return source.slice(rawStart, rawEnd);
    }

    findMultiEventSegmentTextBounds(html, lines, records = null) {
        const source = String(html || '');
        const segmentLines = (Array.isArray(lines) ? lines : [])
            .map(line => this.normalizeWhitespace(line))
            .filter(Boolean);
        if (!source || segmentLines.length === 0) return null;

        const bodyPartRecords = Array.isArray(records) ? records : this.extractBodyPartRecords(source);
        const matchedRecords = this.findBodyPartRecordsForLines(bodyPartRecords, segmentLines);
        if (matchedRecords.length === 0) return null;

        const firstStart = Math.min(...matchedRecords.map(record => record.rawStart).filter(value => Number.isFinite(value)));
        const lastEnd = Math.max(...matchedRecords.map(record => record.rawEnd).filter(value => Number.isFinite(value)));
        if (!Number.isFinite(firstStart) || !Number.isFinite(lastEnd) || lastEnd <= firstStart) {
            return null;
        }

        return {
            rawStart: firstStart,
            rawEnd: lastEnd,
            matchedRecords
        };
    }

    findBodyPartRecordsForLines(records, lines) {
        const sourceRecords = Array.isArray(records) ? records : [];
        const targetLines = (Array.isArray(lines) ? lines : [])
            .map(line => this.normalizeWhitespace(line).toLowerCase())
            .filter(Boolean);
        if (sourceRecords.length === 0 || targetLines.length === 0) return [];

        for (let start = 0; start < sourceRecords.length; start++) {
            if (this.normalizeWhitespace(sourceRecords[start].text).toLowerCase() !== targetLines[0]) continue;
            const matched = [sourceRecords[start]];
            let cursor = start + 1;
            for (let targetIndex = 1; targetIndex < targetLines.length; targetIndex++) {
                let found = false;
                while (cursor < sourceRecords.length) {
                    const recordText = this.normalizeWhitespace(sourceRecords[cursor].text).toLowerCase();
                    const isMatch = recordText === targetLines[targetIndex];
                    const isTooFar = matched.length > 0 &&
                        Number.isFinite(sourceRecords[cursor].rawStart) &&
                        Number.isFinite(matched[matched.length - 1].rawEnd) &&
                        sourceRecords[cursor].rawStart - matched[matched.length - 1].rawEnd > 12000;
                    if (isMatch) {
                        matched.push(sourceRecords[cursor]);
                        cursor++;
                        found = true;
                        break;
                    }
                    if (isTooFar) break;
                    cursor++;
                }
                if (!found) break;
            }
            if (matched.length === targetLines.length) return matched;
        }
        return [];
    }

    findMultiEventSegmentResourceStart(html, firstTextStart) {
        const source = String(html || '');
        const textStart = Number(firstTextStart);
        const start = Math.max(0, textStart - 6000);
        const prefix = source.slice(start, textStart);
        const candidates = [
            this.findLastRegexIndex(prefix, this.multiEventImageContainerRegex()),
            this.findLastRegexIndex(prefix, /<a\b[^>]*>\s*<img\b/gi),
            this.findLastRegexIndex(prefix, /<img\b/gi)
        ].filter(index => index >= 0);
        if (candidates.length === 0) return textStart;

        const candidateStart = start + Math.max(...candidates);
        const interveningText = this.extractBodyParts(source.slice(candidateStart, textStart));
        const crossesPriorEvent = interveningText.some(line => this.isStrongMultiEventTitleLine(line)) &&
            interveningText.some(line => this.hasMultiEventDateSignal(line));
        return crossesPriorEvent ? textStart : candidateStart;
    }

    findMultiEventSegmentResourceEnd(html, lastTextEnd) {
        const source = String(html || '');
        const textEnd = Number(lastTextEnd);
        const endLimit = Math.min(source.length, textEnd + 8000);
        const suffix = source.slice(textEnd, endLimit);
        const candidates = [];
        const nextImageIndex = this.findFirstRegexIndex(suffix, this.multiEventImageContainerRegex());
        if (nextImageIndex >= 0) candidates.push(textEnd + nextImageIndex);

        const suffixRecords = this.extractBodyPartRecords(suffix);
        const nextTitleRecord = suffixRecords.find(record => this.isStrongMultiEventTitleLine(record.text));
        if (nextTitleRecord && Number.isFinite(nextTitleRecord.rawStart)) {
            candidates.push(textEnd + nextTitleRecord.rawStart);
        }

        if (candidates.length === 0) return textEnd;
        const rawEnd = Math.min(...candidates.filter(value => value > textEnd));
        return Number.isFinite(rawEnd) && rawEnd > textEnd ? rawEnd : textEnd;
    }

    multiEventImageContainerRegex() {
        return /<(?:div|figure|picture|a)\b[^>]*(?:class|id)=["'][^"']*(?:image|img|poster|photo|media|gallery)[^"']*["'][^>]*>/gi;
    }

    findLastRegexIndex(text, pattern) {
        let lastIndex = -1;
        let match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(text)) !== null) {
            lastIndex = match.index;
            if (match.index === pattern.lastIndex) pattern.lastIndex++;
        }
        return lastIndex;
    }

    findFirstRegexIndex(text, pattern) {
        pattern.lastIndex = 0;
        const match = pattern.exec(text);
        return match ? match.index : -1;
    }

    extractMultiEventSegmentResourceLines(html, sourceUrl = '', hintedImageUrls = [], ocrResults = [], excludedUrlKeys = null) {
        const source = String(html || '');
        const lines = [];
        const seen = new Set();
        const seenStripped = new Set();
        const addLine = (label, rawUrl) => {
            const normalized = this.normalizeUrl(rawUrl, sourceUrl);
            if (!normalized || !/^https?:\/\//i.test(normalized)) return;
            const finalUrl = this.normalizeHttpUrlValue(this.unwrapImageProxyUrl(normalized) || normalized);
            if (!finalUrl) return;
            // Check for duplicates using stripped URL to handle same image at different sizes
            const strippedUrl = this.stripSizeParams(finalUrl);
            // Consistency-gate exclusions: an image reassigned/detached from
            // this segment never lands in its SEGMENT_IMAGE_* prompt lines
            // (checked in both stripped and CDN-upgraded key forms, matching
            // getSegmentImageUrlKeys).
            if (excludedUrlKeys instanceof Set && excludedUrlKeys.size > 0) {
                if (excludedUrlKeys.has(strippedUrl)) return;
                const upgraded = this.upgradeCdnThumbnailUrl(finalUrl);
                if (upgraded && upgraded !== finalUrl && excludedUrlKeys.has(this.stripSizeParams(upgraded))) return;
            }
            if (seenStripped.has(strippedUrl)) return;
            seen.add(finalUrl);
            seenStripped.add(strippedUrl);
            lines.push(`${label}: ${finalUrl}`);
        };

        // Add OCR results as SEGMENT_IMAGE_TEXT
        const ocrList = Array.isArray(ocrResults) ? ocrResults : [];
        for (let i = 0; i < ocrList.length; i++) {
            const ocrResult = ocrList[i];
            const ocrSnippet = this.buildOcrSnippet(ocrResult.url, ocrResult.text, ocrResult.eventSummary);
            lines.push(ocrSnippet);
        }

        for (const imageUrl of Array.isArray(hintedImageUrls) ? hintedImageUrls : []) {
            addLine('SEGMENT_IMAGE_HINT_URL', imageUrl);
            if (lines.length >= 4) break;
        }

        if (lines.length === 0) {
            for (const imageUrl of this.extractOrderedImageUrlsFromHtml(source, sourceUrl, 4)) {
                addLine('SEGMENT_IMAGE_URL', imageUrl);
                if (lines.length >= 4) break;
            }
        }

        let linkCount = 0;
        const candidates = this.extractUrlCandidatesFromRawHtml(source);
        for (const candidate of candidates) {
            if (lines.length >= 10 || linkCount >= 1) break;
            const normalized = this.normalizeUrl(candidate, sourceUrl);
            if (!normalized || !/^https?:\/\//i.test(normalized)) continue;
            if (this.hasSupportedImageFilenameAtEnd(normalized) || this.hasLikelyImageUrl(normalized)) continue;
            const beforeCount = lines.length;
            addLine('SEGMENT_LINK_URL', normalized);
            if (lines.length > beforeCount) linkCount++;
        }

        return lines;
    }

    trimSegmentLinesToChars(lines, maxChars) {
        const numericMaxChars = Number(maxChars);
        const hasExplicitLimit = maxChars !== null && maxChars !== undefined && Number.isFinite(numericMaxChars);
        const limit = hasExplicitLimit
            ? Math.max(0, numericMaxChars)
            : this.extractionLimits.multiEventMinSegmentChars;
        if (limit <= 0) return [];
        const kept = [];
        let used = 0;
        for (const line of Array.isArray(lines) ? lines : []) {
            if (!line) continue;
            const separator = kept.length === 0 ? 0 : 1;
            if (used + separator + line.length <= limit) {
                kept.push(line);
                used += separator + line.length;
                continue;
            }
            const remaining = limit - used - separator;
            if (remaining >= this.extractionLimits.multiEventPartialLineMinChars) {
                kept.push(this.trimToMaxLength(line, remaining));
            }
            break;
        }
        return kept;
    }

    segmentHasDateSignal(lines) {
        return (Array.isArray(lines) ? lines : []).some(line => this.hasMultiEventDateSignal(line));
    }

    segmentHasTitleSignal(lines) {
        return (Array.isArray(lines) ? lines : []).some(
            line => this.isLikelyEventTitleLine(line) || this.isCompactEventLine(line) || this.isStrongMultiEventTitleLine(line)
        );
    }

    // A compact event line combines date + event name (and often venue) in a single line,
    // e.g. "7/25 Pride Dance @ Eagle Bar" or "Aug 8 - Summer Party @ Metro".
    isCompactEventLine(value) {
        const line = this.normalizeWhitespace(value);
        if (!line || !this.hasMultiEventDateSignal(line)) return false;
        if (line.length < 20) return false; // bare dates like "July 25" are too short to be an event line
        if (/^https?:\/\//i.test(line)) return false;
        if (!/[a-z]/i.test(line)) return false;
        const wordCount = line.split(/\s+/).length;
        return wordCount >= 4; // needs date + event name (e.g. "7/25 Pride Dance @ Eagle Bar" = 5 words)
    }

    hasMultiEventDateSignal(value) {
        const line = String(value || '');
        if (!line) return false;
        const monthDatePattern = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{1,2})?(?:,?\s+\d{4})?\b/i;
        if (monthDatePattern.test(line)) return true;
        const numericDatePattern = /\b(?:0?[1-9]|1[0-2])[\/.-](?:0?[1-9]|[12]\d|3[01])(?:[\/.-](?:\d{2}|\d{4}))?\b/;
        return numericDatePattern.test(line);
    }

    isLikelyEventTitleLine(value) {
        const line = this.normalizeWhitespace(value);
        if (!line || line.length < this.extractionLimits.multiEventTitleMinChars || line.length > this.extractionLimits.multiEventTitleMaxChars) return false;
        if (this.hasMultiEventDateSignal(line)) return false;
        if (/^https?:\/\//i.test(line)) return false;
        if (!/[a-z]/i.test(line)) return false;
        if (/^(ticket|tickets|buy|register|details|learn more)\b/i.test(line)) return false;
        const wordCount = line.split(/\s+/).length;
        if (wordCount < this.extractionLimits.multiEventTitleMinWords) return false;
        return !/^[^a-z0-9]+$/i.test(line);
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
                this.addAdditionalUrlCandidate(urls, candidate.url, sourceUrl, candidate.context, discoveryStats, parserConfig);
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
                    if (this.addAdditionalUrlCandidate(urls, matchedUrl, sourceUrl, match[0], discoveryStats, parserConfig)) {
                        matchCount++;
                    }
                }
                discoveryStats.configuredPatternMatches += matchCount;
            }

            const rawUrlCandidates = this.extractUrlCandidatesFromRawHtml(html);
            discoveryStats.rawHtmlCandidates = rawUrlCandidates.length;
            for (const candidate of rawUrlCandidates) {
                this.addAdditionalUrlCandidate(urls, candidate.url || candidate, sourceUrl, candidate.context || '', discoveryStats, parserConfig);
            }

            const jsonLdDiagnostics = {};
            const jsonLdUrlCandidates = this.extractUrlsFromJsonLd(html, jsonLdDiagnostics);
            discoveryStats.jsonLdCandidates = jsonLdUrlCandidates.length;
            discoveryStats.jsonLdDiagnostics = jsonLdDiagnostics;
            for (const candidate of jsonLdUrlCandidates) {
                this.addAdditionalUrlCandidate(urls, candidate, sourceUrl, 'json-ld', discoveryStats, parserConfig);
            }

            // Extract from common JS-embedded data objects (window.__SERVER_DATA__, __INITIAL_STATE__, etc.)
            const serverDataUrls = this.extractUrlsFromServerData(html, sourceUrl, discoveryStats.serverDataDiagnostics || null);
            discoveryStats.serverDataCandidates = serverDataUrls.length;
            for (const candidate of serverDataUrls) {
                this.addAdditionalUrlCandidate(urls, candidate, sourceUrl, '__server-data__', discoveryStats, parserConfig);
            }

            // Extract from __NEXT_DATA__ (Next.js pages)
            const nextDataUrls = this.extractUrlsFromNextData(html, sourceUrl, discoveryStats.nextDataDiagnostics || null);
            discoveryStats.nextDataCandidates = nextDataUrls.length;
            for (const candidate of nextDataUrls) {
                this.addAdditionalUrlCandidate(urls, candidate, sourceUrl, '__next-data__', discoveryStats, parserConfig);
            }
        } catch (error) {
            console.warn(`🤖 AI Web: Error extracting additional URLs: ${error}`);
        }

        const rankedUrls = this.rankAdditionalUrls(urls);
        const maxAdditionalUrls = this.resolveMaxAdditionalUrls(parserConfig);
        const hasFiniteLimit = Number.isFinite(maxAdditionalUrls) && maxAdditionalUrls >= 0;

        // Deduplicate by canonical key before slicing so the limit applies to unique URLs only
        const seenKeys = new Set();
        const dedupedRankedUrls = rankedUrls.filter(url => {
            const key = this.getUrlDedupeKey(url);
            if (seenKeys.has(key)) return false;
            seenKeys.add(key);
            return true;
        });

        const limitedUrls = hasFiniteLimit
            ? dedupedRankedUrls.slice(0, maxAdditionalUrls)
            : dedupedRankedUrls;
        // Non-enumerable tag: valid unique links BEFORE the maxAdditionalUrls
        // budget. The dead-end detector reads this so a budget of 0 (e.g.
        // Furball) can never make a link-rich page look like a dead end.
        Object.defineProperty(limitedUrls, 'uniqueValidCount', {
            value: dedupedRankedUrls.length,
            enumerable: false,
            configurable: true
        });
        const limitText = hasFiniteLimit ? `${maxAdditionalUrls}` : 'none';
        const rejectedTopReasons = this.formatTopRejectedReasons(discoveryStats.rejectedReasons);
        const extraSources = discoveryStats.serverDataCandidates > 0 || discoveryStats.nextDataCandidates > 0
            ? `, serverDataCandidates=${discoveryStats.serverDataCandidates}, nextDataCandidates=${discoveryStats.nextDataCandidates}`
            : '';
        console.log(
            `🤖 AI Web: URL discovery stats for ${sourceUrl || 'unknown URL'} -> hrefCandidates=${discoveryStats.hrefCandidates}, configuredPatternMatches=${discoveryStats.configuredPatternMatches}, rawHtmlCandidates=${discoveryStats.rawHtmlCandidates}, jsonLdCandidates=${discoveryStats.jsonLdCandidates}${extraSources}, rejected=${discoveryStats.rejectedCandidates}, rejectedTopReasons=${rejectedTopReasons}, uniqueValid=${dedupedRankedUrls.length}, limit=${limitText}, returned=${limitedUrls.length}`
        );
        if (discoveryStats.rejectedCandidates > 0) {
            const rejectedPreview = this.formatRejectedSamples(discoveryStats.rejectedSamples);
            if (rejectedPreview) {
                this.logDebug(`🤖 AI Web: URL discovery rejected samples: ${rejectedPreview}`);
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
            this.logDebug(`🤖 AI Web: URL discovery structured diagnostics: ${structuredDiag}`);
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

    // Onboarding harvest (discoveryOnly runs only): instagram/facebook links are
    // scanned during URL discovery but rejected as blocked hosts — here the FIRST
    // profile-like link per host is collected instead, for the suggested-config
    // block. Profile-like = non-empty path whose first segment is not a
    // share/login/interstitial endpoint.
    collectDiscoverySocialLinks(html, sourceUrl) {
        const results = {};
        if (!html) return results;
        const hostKeys = [
            { key: 'instagram', host: 'instagram.com' },
            { key: 'facebook', host: 'facebook.com' }
        ];
        const excludedFirstSegments = /^(?:sharer(?:\.php)?|share|login|intent|plugins)$/i;
        for (const candidate of this.extractHrefCandidates(html)) {
            const url = this.stripTrackingParams(this.normalizeUrl(candidate.url, sourceUrl));
            const parsedUrl = this.parseUrlComponents(url);
            if (!parsedUrl || !/^https?:$/.test(parsedUrl.protocol)) continue;
            const hostname = String(parsedUrl.hostname || '').toLowerCase();
            const hostEntry = hostKeys.find(entry => hostname === entry.host || hostname.endsWith(`.${entry.host}`));
            if (!hostEntry || results[hostEntry.key]) continue;
            const pathSegments = String(parsedUrl.pathname || '').split('/').filter(Boolean);
            if (pathSegments.length === 0) continue;
            if (excludedFirstSegments.test(pathSegments[0])) continue;
            results[hostEntry.key] = url;
            if (Object.keys(results).length === hostKeys.length) break;
        }
        return results;
    }

    // Onboarding harvest (discoveryOnly runs only): the organizer name/url from
    // the page's schema.org Event JSON-LD, seeding shortName and website in the
    // suggested-config block. First Event node with an organizer wins.
    extractJsonLdOrganizer(html) {
        if (!this.core || typeof this.core.extractJsonLdEventNodes !== 'function') return null;
        let nodes = [];
        try {
            nodes = this.core.extractJsonLdEventNodes(html);
        } catch (error) {
            console.warn(`🤖 AI Web: JSON-LD organizer extraction failed: ${error.message}`);
            return null;
        }
        for (const node of nodes) {
            const organizers = Array.isArray(node.organizer) ? node.organizer : [node.organizer];
            for (const organizer of organizers) {
                if (!organizer || typeof organizer !== 'object') continue;
                const name = typeof organizer.name === 'string'
                    ? this.normalizeWhitespace(this.decodeBasicEntities(organizer.name))
                    : '';
                const url = this.normalizeHttpUrlValue(organizer.url) || '';
                if (name || url) {
                    return { name, url };
                }
            }
        }
        return null;
    }

    addAdditionalUrlCandidate(urls, rawUrl, sourceUrl, context = '', discoveryStats = null, parserConfig = {}) {
        if (this.looksLikeNonUrlJsFragment(rawUrl)) {
            if (discoveryStats && typeof discoveryStats === 'object') {
                this.recordRejectedCandidate(discoveryStats, 'non-url-js-fragment', rawUrl);
            }
            return false;
        }
        const url = this.stripTrackingParams(this.normalizeUrl(rawUrl, sourceUrl));
        const validation = this.validateEventUrl(url, sourceUrl, parserConfig);
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

    looksLikeNonUrlJsFragment(rawUrl) {
        const text = String(rawUrl || '').trim();
        if (!text) return false;
        if (/^https?:\/\//i.test(text) || /^\/[^\s]/.test(text)) return false;

        const hasJsConfigTokens = /(beforesend|attachstacktrace|function\s*\(|\bvar\b|\bconst\b|\blet\b)/i.test(text);
        const hasRegexTokens = /\\[dDsSwWbB.]|\[[^\]]+\]\+/.test(text) || (text.includes('\\.') && /[+*?]/.test(text));
        const hasConfigDelimiter = /],\s*[a-z_$][\w$]*\s*:/.test(text);

        return hasJsConfigTokens || (hasRegexTokens && hasConfigDelimiter);
    }

    rankAdditionalUrls(urls) {
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
            // www and bare-host variants of the same page are the same page
            parsed.hostname = String(parsed.hostname || '').replace(/^www\./i, '');
            // Strip tracking/affiliate params so the same event with different tracking
            // suffixes (e.g. ?aff=ebdsoporgprofile, ?utm_source=…) deduplicates correctly.
            for (const key of [...parsed.searchParams.keys()]) {
                if (this.trackingParamPattern.test(key)) {
                    parsed.searchParams.delete(key);
                }
            }
            return parsed.toString().replace(/\/$/, '').toLowerCase();
        } catch (_) {
            // iOS JavaScriptCore has no URL global, so this fallback is the
            // ONLY path on-device — it must apply the same www-stripping the
            // URL branch does or www/bare-host variants dedupe differently on
            // the phone than in Node (run 20260724-161423 crawled both
            // massive.club variants because of exactly that gap).
            return String(url || '')
                .replace(/#.*$/, '')
                .replace(/^(https?:\/\/)www\./i, '$1')
                .replace(/\/$/, '')
                .toLowerCase();
        }
    }

    stripTrackingParams(url) {
        if (!url) return url;
        try {
            const parsed = new URL(url);
            for (const key of [...parsed.searchParams.keys()]) {
                if (this.trackingParamPattern.test(key)) {
                    parsed.searchParams.delete(key);
                }
            }
            return parsed.toString();
        } catch (_) {
            return url;
        }
    }

    /**
     * Strip size-related parameters from image URLs for deduplication.
     * Removes width/height parameters like w=1920, h=1080, w_296,h_370, etc.
     * to identify the same image at different resolutions.
     * Built entirely on string/regex parsing — the URL global does not exist in
     * Scriptable (iOS JavaScriptCore), and a URL-based implementation silently
     * no-oped there, which broke OCR↔segment image matching (every segment
     * logged "failed to match any of the N OCR results").
     */
    stripSizeParams(url, unwrapDepth = 0) {
        if (!url) return url;
        const text = String(url);

        // Split hash and query off the scheme://host/path part manually.
        let withoutHash = text;
        let hash = '';
        const hashIndex = withoutHash.indexOf('#');
        if (hashIndex >= 0) {
            hash = withoutHash.slice(hashIndex);
            withoutHash = withoutHash.slice(0, hashIndex);
        }
        let base = withoutHash;
        let queryText = '';
        const queryIndex = base.indexOf('?');
        if (queryIndex >= 0) {
            queryText = base.slice(queryIndex + 1);
            base = base.slice(0, queryIndex);
        }

        const baseMatch = base.match(/^(https?:\/\/[^/]+)(\/.*)?$/i);
        if (!baseMatch) {
            // Not an absolute http(s) URL — nothing safe to strip.
            return url;
        }
        const origin = baseMatch[1];
        let pathname = baseMatch[2] || '';

        // Image proxies like img.evbuc.com wrap the source URL inside the path
        // (img.evbuc.com/https%3A%2F%2Fcdn.evbuc.com%2F...) with per-variant crop
        // and signature query params, so no amount of param stripping makes two
        // variants equal. Dedup on the decoded inner URL instead.
        if (unwrapDepth < this.maxUrlUnwrapDepth) {
            const encodedPathMatch = pathname.match(/^\/(https?%3a%2f%2f.+)$/i);
            if (encodedPathMatch) {
                try {
                    const innerUrl = decodeURIComponent(encodedPathMatch[1]);
                    return this.stripSizeParams(innerUrl, unwrapDepth + 1);
                } catch (_) {}
            }
        }

        // Remove size patterns from pathname (e.g., /w_296,h_370/ or /1920x1080/)
        // Handle Wix-style /v1/fill/w_296,h_370,.../<name> transform paths: everything
        // from /v1/fill/ onward is transform params plus a duplicate filename, so the
        // whole tail is stripped and the bare asset URL remains.
        pathname = pathname.replace(/\/v1\/(?:fill|crop|fit)\/.*$/i, '');  // Wix transform path
        pathname = pathname.replace(/\/\d+[xX]\d+\/?/g, '/');  // 1920x1080 patterns
        pathname = pathname.replace(/\/w_\d+(?:,h_\d+)?\/?/i, '/');  // w_296,h_370 patterns
        pathname = pathname.replace(/\/h_\d+(?:,w_\d+)?\/?/i, '/');  // h_370,w_296 patterns
        pathname = pathname.replace(/\/(?:w|h|width|height|wpx|hpx)=\d+\/?/gi, '/');  // /w=1920/ patterns

        // Remove size query parameters (both w=1920 and w_296,h_370 formats).
        const keptPairs = [];
        if (queryText) {
            for (const pair of queryText.split('&')) {
                if (!pair) continue;
                const separatorIndex = pair.indexOf('=');
                const rawKey = separatorIndex >= 0 ? pair.slice(0, separatorIndex) : pair;
                const rawValue = separatorIndex >= 0 ? pair.slice(separatorIndex + 1) : '';
                let key = rawKey;
                try {
                    key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
                } catch (_) {}
                let value = rawValue;
                try {
                    value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
                } catch (_) {}
                // Match standard size params: w, h, width, height, wpx, hpx, scale, size, res, resolution
                if (/^(w|h|width|height|wpx|hpx|scale|size|res|resolution|x|y)$/.test(key.toLowerCase())) {
                    continue;
                }
                // Match Wix-style params like w_296,h_370 (the key is 'v1' or similar, value contains size info)
                // Check if the value contains size patterns like w_\d+, h_\d+, or \d+x\d+
                if (value && (/\d+[xX]\d+/.test(value) || /w_\d+(?:,h_\d+)?/.test(value) || /h_\d+(?:,w_\d+)?/.test(value))) {
                    continue;
                }
                keptPairs.push(pair);
            }
        }

        const search = keptPairs.length > 0 ? `?${keptPairs.join('&')}` : '';
        return `${origin}${pathname}${search}${hash}`;
    }

    /**
     * Upgrade degraded CDN thumbnail URLs to the original full-size asset.
     * Wix listing pages serve deliberately blurred low-res previews
     * (e.g. .../media/<asset>/v1/fill/w_147,h_184,...,blur_2,enc_auto/<name>)
     * of the same asset the detail page carries at full size — OCR on the blurred
     * 147px preview hallucinates, and events must never store it as their image.
     * This is a CDN-infrastructure pattern (like the parastorage/wixapps blocked
     * hosts), not a per-site scraping rule.
     * Only rewrites when the transform params prove degradation (blur_<n> with
     * n > 0, or w_<width> with width < 600); large/high-quality transforms and
     * non-matching URLs are returned unchanged. Conservative: any parse failure
     * returns the input unchanged.
     */
    upgradeCdnThumbnailUrl(url) {
        if (!url || typeof url !== 'string') return url;
        try {
            const raw = url.trim();
            const match = raw.match(this.wixMediaTransformPattern);
            if (!match) return url;
            // match[2] is the asset name (may contain a URL-encoded tilde, %7E) —
            // kept verbatim so the upgraded URL still strips/dedupes consistently
            // against thumbnail variants of the same asset.
            const originalAssetUrl = match[1];
            const params = String(match[3]).split(',');
            let width = null;
            let blur = null;
            for (const param of params) {
                const widthMatch = param.match(/^w_(\d+)$/i);
                if (widthMatch) width = parseInt(widthMatch[1], 10);
                const blurMatch = param.match(/^blur_(\d+(?:\.\d+)?)$/i);
                if (blurMatch) blur = parseFloat(blurMatch[1]);
            }
            const isDegraded = (Number.isFinite(blur) && blur > 0)
                || (Number.isFinite(width) && width < 600);
            if (!isDegraded) return url;
            if (!this.upgradedCdnThumbnailUrls.has(raw)) {
                this.upgradedCdnThumbnailUrls.add(raw);
                console.log(`🤖 AI Web: Upgraded CDN thumbnail to original asset: ${raw} → ${originalAssetUrl}`);
            }
            return originalAssetUrl;
        } catch (_) {
            return url;
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

        // Capture groups: protocol, hostname[:port], pathname, query string, hash fragment.
        const match = String(url).match(this.urlParsePattern);
        if (!match) return null;
        const [, protocol = '', hostname = '', pathname = '', search = '', hash = ''] = match;
        const normalizedPathname = pathname || '/';
        return {
            protocol: String(protocol || '').toLowerCase(),
            hostname: String(hostname || '').toLowerCase(),
            pathname: normalizedPathname,
            search: search || '',
            hash: hash || '',
            href: `${protocol}//${hostname}${normalizedPathname}${search}${hash}`
        };
    }

    sanitizeCacheSegment(segment) {
        return String(segment || 'index')
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'index';
    }

    hashCacheValue(value) {
        let hash = 2166136261;
        const input = String(value || '');
        for (let i = 0; i < input.length; i++) {
            hash ^= input.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    getOcrCacheRuntime() {
        return this.getCacheRuntime('ocr', this.config.ocrCacheDir);
    }

    getAiClassificationCacheRuntime() {
        return this.getCacheRuntime('classification', this.config.classificationCacheDir);
    }

    getAiResponseCacheRuntime() {
        return this.getCacheRuntime('ai-responses', this.config.aiResponseCacheDir);
    }

    getCacheRuntime(subdir, overrideDir = null) {
        if (typeof FileManager !== 'undefined') {
            try {
                const fm = FileManager.iCloud();
                const documentsDir = fm.documentsDirectory();
                const baseDir = overrideDir
                    ? String(overrideDir)
                    : fm.joinPath(fm.joinPath(fm.joinPath(documentsDir, 'chunky-dad-scraper'), 'storage'), subdir);
                return {
                    type: 'scriptable',
                    fm,
                    baseDir
                };
            } catch (error) {
                console.log(`🤖 AI Web: ${subdir} cache setup unavailable in Scriptable: ${error.message}`);
                return null;
            }
        }
        if (typeof require === 'function') {
            try {
                const fs = require('fs');
                const path = require('path');
                const os = require('os');
                const baseDir = overrideDir
                    ? String(overrideDir)
                    : path.join(os.homedir(), '.chunky-dad-scraper', 'storage', subdir);
                return {
                    type: 'node',
                    fs,
                    path,
                    baseDir
                };
            } catch (error) {
                console.log(`🤖 AI Web: ${subdir} cache setup unavailable in Node: ${error.message}`);
                return null;
            }
        }
        return null;
    }

    // "Touch" a cache entry on a hit so pruning can work from last USE instead
    // of write date. Scriptable's FileManager has no utimes, so the mechanism is
    // a `lastUsedAt` payload field (ISO day precision) plus an occasional full
    // rewrite — Node deliberately uses the same payload field (not fs.utimes) so
    // both platforms share one code path. Rate-limited: the file is only
    // rewritten when the stored marker is absent or older than
    // CACHE_TOUCH_INTERVAL_DAYS, so entries hit on every run cost nothing.
    // Because a touch rewrites the file, mtime tracks last use to within the
    // interval — the adapter's auto-prune reads mtime alone, no payloads.
    async touchCacheEntryOnHit(runtime, cachePath, cached) {
        if (!runtime || !cachePath || !cached || typeof cached !== 'object') return;
        const lastUsedMs = Date.parse(String(cached.lastUsedAt || ''));
        const staleMs = CACHE_TOUCH_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
        if (Number.isFinite(lastUsedMs) && (Date.now() - lastUsedMs) <= staleMs) return;
        cached.lastUsedAt = new Date().toISOString().slice(0, 10);
        try {
            if (runtime.type === 'scriptable') {
                runtime.fm.writeString(cachePath, JSON.stringify(cached, null, 2));
            } else {
                await runtime.fs.promises.writeFile(cachePath, JSON.stringify(cached, null, 2), 'utf8');
            }
        } catch (_) {
            // A failed touch is harmless — the entry just keeps aging by mtime
        }
    }

    getOcrCachePathParts(imageUrl, ocrConfig = {}) {
        const rawUrl = String(imageUrl || '').trim();
        const normalizedSource = this.normalizeHttpUrlValue(this.unwrapImageProxyUrl(rawUrl) || rawUrl);
        let normalizedUrl = normalizedSource || rawUrl;
        try {
            if (typeof URL === 'function' && normalizedUrl) {
                const parsed = new URL(normalizedUrl);
                parsed.hash = '';
                parsed.protocol = String(parsed.protocol || '').toLowerCase();
                parsed.hostname = String(parsed.hostname || '').toLowerCase();
                const searchEntries = Array.from(parsed.searchParams.entries())
                    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
                        if (leftKey === rightKey) return leftValue.localeCompare(rightValue);
                        return leftKey.localeCompare(rightKey);
                    });
                parsed.search = '';
                searchEntries.forEach(([key, value]) => parsed.searchParams.append(key, value));
                normalizedUrl = parsed.toString();
            }
        } catch (_) {}
        const parsed = this.parseUrlComponents(normalizedUrl);
        const requestSignature = JSON.stringify({
            model: String(ocrConfig.model || ''),
            prompt: String(ocrConfig.prompt || ''),
            options: {
                numCtx: Number.isFinite(Number(ocrConfig.numCtx)) ? Number(ocrConfig.numCtx) : null,
                numPredict: Number.isFinite(Number(ocrConfig.numPredict)) ? Number(ocrConfig.numPredict) : null,
                temperature: Number.isFinite(Number(ocrConfig.temperature)) ? Number(ocrConfig.temperature) : null,
                think: Boolean(ocrConfig.think),
                keepAlive: String(ocrConfig.keepAlive || '')
            }
        });
        const signatureHash = this.hashCacheValue(requestSignature);

        if (parsed) {
            const hostDir = this.sanitizeCacheSegment(parsed.hostname || 'unknown-host');
            const pathSegments = String(parsed.pathname || '/')
                .split('/')
                .filter(Boolean)
                .map(segment => this.sanitizeCacheSegment(segment))
                .filter(Boolean);
            let fileBase = pathSegments.length > 0 ? pathSegments.join('__') : 'index';
            if (parsed.search) {
                fileBase += `--q-${this.hashCacheValue(parsed.search)}`;
            }
            fileBase += `--ocr-${signatureHash}`;
            if (fileBase.length > 140) {
                fileBase = `${fileBase.slice(0, 96)}--${this.hashCacheValue(fileBase)}`;
            }
            return {
                normalizedUrl,
                hostDir,
                fileName: `${fileBase}.json`,
                signatureHash
            };
        }

        return {
            normalizedUrl,
            hostDir: 'unknown-host',
            fileName: `${this.hashCacheValue(`${normalizedUrl}|${signatureHash}`)}.json`,
            signatureHash
        };
    }

    // Persistent cache for AI page-classification outcomes. SharedCore stays free of
    // filesystem access (see its header rules), so parsePageForCrawl injects this
    // provider the same way it borrows getAiConfig. Keyed by URL + a signature of the
    // page summary and model, so content or model changes invalidate naturally.
    getAiClassificationCache() {
        return {
            read: (url, signature) => this.readCachedAiClassification(url, signature),
            write: (url, signature, outcome) => this.writeCachedAiClassification(url, signature, outcome)
        };
    }

    getAiClassificationCachePathParts(url, signature) {
        const signatureHash = this.hashCacheValue(JSON.stringify(signature || {}));
        const normalizedUrl = this.normalizeHttpUrlValue(url) || String(url || '');
        const parsed = this.parseUrlComponents(normalizedUrl);
        if (parsed) {
            const hostDir = this.sanitizeCacheSegment(parsed.hostname || 'unknown-host');
            const pathSegments = String(parsed.pathname || '/')
                .split('/')
                .filter(Boolean)
                .map(segment => this.sanitizeCacheSegment(segment))
                .filter(Boolean);
            let fileBase = pathSegments.length > 0 ? pathSegments.join('__') : 'index';
            if (parsed.search) {
                fileBase += `--q-${this.hashCacheValue(parsed.search)}`;
            }
            fileBase += `--cls-${signatureHash}`;
            if (fileBase.length > 140) {
                fileBase = `${fileBase.slice(0, 96)}--${this.hashCacheValue(fileBase)}`;
            }
            return { normalizedUrl, hostDir, fileName: `${fileBase}.json` };
        }
        return {
            normalizedUrl,
            hostDir: 'unknown-host',
            fileName: `${this.hashCacheValue(`${normalizedUrl}|${signatureHash}`)}.json`
        };
    }

    async readCachedAiClassification(url, signature) {
        const runtime = this.getAiClassificationCacheRuntime();
        if (!runtime) return null;
        const { hostDir, fileName } = this.getAiClassificationCachePathParts(url, signature);
        try {
            let cachePath;
            let rawPayload = null;
            if (runtime.type === 'scriptable') {
                cachePath = runtime.fm.joinPath(runtime.fm.joinPath(runtime.baseDir, hostDir), fileName);
                if (!runtime.fm.fileExists(cachePath)) return null;
                try {
                    await runtime.fm.downloadFileFromiCloud(cachePath);
                } catch (_) {}
                rawPayload = runtime.fm.readString(cachePath);
            } else {
                cachePath = runtime.path.join(runtime.baseDir, hostDir, fileName);
                rawPayload = await runtime.fs.promises.readFile(cachePath, 'utf8');
            }
            const cached = JSON.parse(rawPayload);
            const outcome = cached && cached.outcome && typeof cached.outcome === 'object' ? cached.outcome : null;
            if (outcome) await this.touchCacheEntryOnHit(runtime, cachePath, cached);
            return outcome;
        } catch (error) {
            const missingFile = error && (error.code === 'ENOENT' || /does not exist/i.test(String(error.message || '')));
            if (!missingFile) {
                console.log(`🤖 AI Web: classification cache read failed for ${url}: ${error.message}`);
            }
            return null;
        }
    }

    async writeCachedAiClassification(url, signature, outcome) {
        if (!outcome || typeof outcome !== 'object') return null;
        const runtime = this.getAiClassificationCacheRuntime();
        if (!runtime) return null;
        const { normalizedUrl, hostDir, fileName } = this.getAiClassificationCachePathParts(url, signature);
        const payload = {
            url: normalizedUrl,
            cachedAt: new Date().toISOString(),
            signature: signature || {},
            outcome
        };
        try {
            if (runtime.type === 'scriptable') {
                const hostDirPath = runtime.fm.joinPath(runtime.baseDir, hostDir);
                if (!runtime.fm.fileExists(runtime.baseDir)) runtime.fm.createDirectory(runtime.baseDir, true);
                if (!runtime.fm.fileExists(hostDirPath)) runtime.fm.createDirectory(hostDirPath, true);
                const cachePath = runtime.fm.joinPath(hostDirPath, fileName);
                runtime.fm.writeString(cachePath, JSON.stringify(payload, null, 2));
                return cachePath;
            }
            const hostDirPath = runtime.path.join(runtime.baseDir, hostDir);
            await runtime.fs.promises.mkdir(hostDirPath, { recursive: true });
            const cachePath = runtime.path.join(hostDirPath, fileName);
            await runtime.fs.promises.writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf8');
            return cachePath;
        } catch (error) {
            console.log(`🤖 AI Web: classification cache write failed for ${url}: ${error.message}`);
            return null;
        }
    }

    async readCachedOcrResult(imageUrl, ocrConfig = {}) {
        if (!ocrConfig.cacheEnabled) return null;
        const runtime = this.getOcrCacheRuntime();
        if (!runtime) return null;
        const { normalizedUrl, hostDir, fileName } = this.getOcrCachePathParts(imageUrl, ocrConfig);

        try {
            let cachePath;
            let rawPayload = null;
            if (runtime.type === 'scriptable') {
                const hostDirPath = runtime.fm.joinPath(runtime.baseDir, hostDir);
                cachePath = runtime.fm.joinPath(hostDirPath, fileName);
                if (!runtime.fm.fileExists(cachePath)) return null;
                try {
                    await runtime.fm.downloadFileFromiCloud(cachePath);
                } catch (_) {}
                rawPayload = runtime.fm.readString(cachePath);
            } else {
                cachePath = runtime.path.join(runtime.baseDir, hostDir, fileName);
                rawPayload = await runtime.fs.promises.readFile(cachePath, 'utf8');
            }
            const cached = JSON.parse(rawPayload);
            const responseText = cached && cached.response && typeof cached.response.text === 'string'
                ? cached.response.text
                : (typeof cached.text === 'string' ? cached.text : '');
            if (responseText === undefined || responseText === null) return null;

            const parsed = JSON.parse(responseText);
            // A parseable payload is a hit either way — negative-cached failures
            // included — so refresh its last-use marker before branching
            await this.touchCacheEntryOnHit(runtime, cachePath, cached);
            if (parsed && typeof parsed === 'object' && parsed.failureKind) {
                return {
                    imageUrl: cached.url || normalizedUrl,
                    failureKind: String(parsed.failureKind),
                    cachePath,
                    cached: true
                };
            }
            const normalized = this.normalizeOcrResult(parsed);

            return {
                imageUrl: cached.url || normalizedUrl,
                text: normalized.text,
                imageClassification: normalized.imageClassification,
                eventSummary: normalized.eventSummary,
                confidence: normalized.confidence,
                reason: normalized.reason,
                cachePath,
                cached: true
            };
        } catch (error) {
            const missingFile = error && (error.code === 'ENOENT' || /does not exist/i.test(String(error.message || '')));
            if (!missingFile) {
                console.log(`🤖 AI Web: OCR cache read failed for ${imageUrl}: ${error.message}`);
            }
            return null;
        }
    }

    async writeCachedOcrResult(imageUrl, ocrConfig = {}, text = '') {
        if (!ocrConfig.cacheEnabled) return null;
        const resultText = String(text || '').trim();
        if (resultText === undefined || resultText === null) return null;
        const runtime = this.getOcrCacheRuntime();
        if (!runtime) return null;
        const { normalizedUrl, hostDir, fileName, signatureHash } = this.getOcrCachePathParts(imageUrl, ocrConfig);
        const payload = {
            url: normalizedUrl,
            cachedAt: new Date().toISOString(),
            cacheKeyVersion: 1,
            request: {
                endpoint: String(ocrConfig.endpoint || ''),
                model: String(ocrConfig.model || ''),
                prompt: String(ocrConfig.prompt || ''),
                signatureHash,
                options: {
                    numCtx: Number.isFinite(Number(ocrConfig.numCtx)) ? Number(ocrConfig.numCtx) : null,
                    numPredict: Number.isFinite(Number(ocrConfig.numPredict)) ? Number(ocrConfig.numPredict) : null,
                    temperature: Number.isFinite(Number(ocrConfig.temperature)) ? Number(ocrConfig.temperature) : null,
                    think: Boolean(ocrConfig.think),
                    keepAlive: String(ocrConfig.keepAlive || '')
                }
            },
            response: {
                text: resultText
            }
        };

        try {
            let cachePath;
            if (runtime.type === 'scriptable') {
                const hostDirPath = runtime.fm.joinPath(runtime.baseDir, hostDir);
                if (!runtime.fm.fileExists(runtime.baseDir)) runtime.fm.createDirectory(runtime.baseDir, true);
                if (!runtime.fm.fileExists(hostDirPath)) runtime.fm.createDirectory(hostDirPath, true);
                cachePath = runtime.fm.joinPath(hostDirPath, fileName);
                runtime.fm.writeString(cachePath, JSON.stringify(payload, null, 2));
            } else {
                const hostDirPath = runtime.path.join(runtime.baseDir, hostDir);
                await runtime.fs.promises.mkdir(hostDirPath, { recursive: true });
                cachePath = runtime.path.join(hostDirPath, fileName);
                await runtime.fs.promises.writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf8');
            }
            return cachePath;
        } catch (error) {
            console.log(`🤖 AI Web: OCR cache write failed for ${imageUrl}: ${error.message}`);
            return null;
        }
    }

    // Persistent cache of raw AI response text keyed by request content (not URL —
    // extraction prompts embed the page content, so the prompt IS the identity).
    // SharedCore stays free of filesystem access, so callAiGenerate consumes this
    // via the injected getAiResponseCache() provider, same as classification.
    getAiResponseCache() {
        return {
            read: (aiConfig, prompt, passLabel) => this.readCachedAiResponse(aiConfig, prompt, passLabel),
            write: (aiConfig, prompt, passLabel, text) => this.writeCachedAiResponse(aiConfig, prompt, passLabel, text),
            stats: this.aiResponseCacheStats
        };
    }

    getAiResponseCachePathParts(aiConfig, prompt, passLabel) {
        const config = aiConfig && typeof aiConfig === 'object' ? aiConfig : {};
        // Endpoint deliberately excluded from the signature (recorded in the
        // payload only) so re-homing the same model still hits.
        const responseFormat = config.provider === 'openai'
            ? String((config.openai && config.openai.responseFormat) || 'json_object')
            : 'json';
        const options = {
            numCtx: Number.isFinite(Number(config.numCtx)) ? Number(config.numCtx) : null,
            numPredict: Number.isFinite(Number(config.numPredict)) ? Number(config.numPredict) : null,
            temperature: Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : null,
            think: Boolean(config.think),
            keepAlive: String(config.keepAlive || ''),
            responseFormat
        };
        const requestSignature = JSON.stringify({
            provider: String(config.provider || ''),
            model: String(config.model || ''),
            prompt: String(prompt),
            options
        });
        const signatureHash = this.hashCacheValue(requestSignature);
        return {
            dirSegments: [passLabel ? this.sanitizeCacheSegment(passLabel) : 'general'],
            fileName: `${signatureHash}.json`,
            signatureHash,
            options
        };
    }

    async readCachedAiResponse(aiConfig, prompt, passLabel) {
        if (!aiConfig || aiConfig.cacheEnabled === false) return null;
        const runtime = this.getAiResponseCacheRuntime();
        if (!runtime) return null;
        const { dirSegments, fileName } = this.getAiResponseCachePathParts(aiConfig, prompt, passLabel);

        try {
            let cachePath;
            let rawPayload = null;
            if (runtime.type === 'scriptable') {
                const passDirPath = runtime.fm.joinPath(runtime.baseDir, dirSegments[0]);
                cachePath = runtime.fm.joinPath(passDirPath, fileName);
                if (!runtime.fm.fileExists(cachePath)) {
                    this.aiResponseCacheStats.misses += 1;
                    return null;
                }
                try {
                    await runtime.fm.downloadFileFromiCloud(cachePath);
                } catch (_) {}
                rawPayload = runtime.fm.readString(cachePath);
            } else {
                cachePath = runtime.path.join(runtime.baseDir, dirSegments[0], fileName);
                rawPayload = await runtime.fs.promises.readFile(cachePath, 'utf8');
            }
            const cached = JSON.parse(rawPayload);
            const responseText = cached && cached.response && typeof cached.response.text === 'string'
                ? cached.response.text
                : '';
            // The filename is only a 32-bit hash — verify the stored prompt so a
            // hash collision can never serve another request's response.
            const promptMatches = cached && cached.request && cached.request.prompt === String(prompt);
            if (!responseText || !promptMatches) {
                this.aiResponseCacheStats.misses += 1;
                return null;
            }
            await this.touchCacheEntryOnHit(runtime, cachePath, cached);
            this.aiResponseCacheStats.hits += 1;
            return responseText;
        } catch (error) {
            const missingFile = error && (error.code === 'ENOENT' || /does not exist/i.test(String(error.message || '')));
            if (!missingFile) {
                console.log(`🤖 AI Web: AI response cache read failed: ${error.message}`);
            }
            this.aiResponseCacheStats.misses += 1;
            return null;
        }
    }

    async writeCachedAiResponse(aiConfig, prompt, passLabel, responseText) {
        if (!aiConfig || aiConfig.cacheEnabled === false) return null;
        const text = typeof responseText === 'string' ? responseText : '';
        if (!text) return null;
        const runtime = this.getAiResponseCacheRuntime();
        if (!runtime) return null;
        const { dirSegments, fileName, signatureHash, options } = this.getAiResponseCachePathParts(aiConfig, prompt, passLabel);
        const payload = {
            cachedAt: new Date().toISOString(),
            cacheKeyVersion: 1,
            passLabel: String(passLabel || ''),
            request: {
                endpoint: String(aiConfig.endpoint || ''),
                provider: String(aiConfig.provider || ''),
                model: String(aiConfig.model || ''),
                signatureHash,
                prompt: String(prompt),
                options
            },
            response: {
                text
            },
            lastUsedAt: new Date().toISOString().slice(0, 10)
        };

        try {
            let cachePath;
            if (runtime.type === 'scriptable') {
                const passDirPath = runtime.fm.joinPath(runtime.baseDir, dirSegments[0]);
                if (!runtime.fm.fileExists(runtime.baseDir)) runtime.fm.createDirectory(runtime.baseDir, true);
                if (!runtime.fm.fileExists(passDirPath)) runtime.fm.createDirectory(passDirPath, true);
                cachePath = runtime.fm.joinPath(passDirPath, fileName);
                runtime.fm.writeString(cachePath, JSON.stringify(payload, null, 2));
            } else {
                const passDirPath = runtime.path.join(runtime.baseDir, dirSegments[0]);
                await runtime.fs.promises.mkdir(passDirPath, { recursive: true });
                cachePath = runtime.path.join(passDirPath, fileName);
                await runtime.fs.promises.writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf8');
            }
            this.aiResponseCacheStats.writes += 1;
            return cachePath;
        } catch (error) {
            console.log(`🤖 AI Web: AI response cache write failed: ${error.message}`);
            return null;
        }
    }


    parseOcrResponseWithClassification(rawText) {
        const parsed = this.core.parseAiEventResponse(rawText);
        if (!parsed) return this.salvageTruncatedOcrResponse(rawText);

        return {
            text: parsed.text,
            imageClassification: parsed.imageClassification,
            eventSummary: parsed.eventSummary,
            confidence: parsed.confidence,
            reason: parsed.reason
        };
    }

    // Vision models sometimes emit valid OCR text and then degenerate (e.g. endless
    // newlines) until the token limit cuts the JSON off mid-string. The braces never
    // balance so JSON.parse fails, but the "text" field is complete — pull it out
    // rather than discarding a successful OCR pass.
    salvageTruncatedOcrResponse(rawText) {
        const source = String(rawText || '');
        if (!source.includes('"text"')) return null;
        const textMatch = source.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)/);
        if (!textMatch || !textMatch[1]) return null;
        let text;
        try {
            text = JSON.parse(`"${textMatch[1].replace(/\r?\n/g, '\\n')}"`);
        } catch (_) {
            text = textMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }
        text = text.replace(/\n{3,}/g, '\n\n').trim();
        if (!text) return null;

        const classificationMatch = source.match(/"imageClassification"\s*:\s*"([^"\\]*)"/);
        const summaryMatch = source.match(/"eventSummary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        const confidenceMatch = source.match(/"confidence"\s*:\s*(\d+)/);
        console.warn(`🤖 AI Web: Salvaged OCR text (${text.length} chars) from a truncated/malformed JSON response`);
        return {
            text,
            imageClassification: classificationMatch ? classificationMatch[1] : '',
            eventSummary: summaryMatch ? summaryMatch[1] : null,
            confidence: confidenceMatch ? Number(confidenceMatch[1]) : null,
            reason: 'salvaged-from-truncated-response'
        };
    }

    // ============================================================================
    // JSON-LD DETERMINISTIC EVENT EXTRACTION
    // ============================================================================

    // Build parser events from schema.org Event JSON-LD nodes. Ticketing pages
    // describe their event completely in structured data; using it directly is
    // exact (ISO dates carry timezone offsets) and costs no AI/OCR requests.
    extractEventsFromJsonLd(html, sourceUrl, cityConfig = null) {
        if (!this.core || typeof this.core.extractJsonLdEventNodes !== 'function') return [];
        let nodes = [];
        try {
            nodes = this.core.extractJsonLdEventNodes(html);
        } catch (error) {
            console.warn(`🤖 AI Web: JSON-LD event extraction failed: ${error.message}`);
            return [];
        }
        const events = [];
        const seen = new Set();
        for (const node of nodes) {
            const event = this.buildEventFromJsonLdNode(node, sourceUrl, cityConfig);
            if (!event) continue;
            const key = `${event.title.toLowerCase()}|${event.startDate.toISOString()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            events.push(event);
        }
        return events;
    }

    buildEventFromJsonLdNode(node, sourceUrl, cityConfig = null) {
        if (!node || typeof node !== 'object') return null;
        const clean = (value) => this.normalizeWhitespace(
            this.decodeBasicEntities(this.stripTags(String(value || ''))).replace(/&amp;/gi, '&')
        );
        const title = clean(node.name);
        const start = this.parseJsonLdDateValue(node.startDate);
        if (!title || !start.date) return null;
        const end = this.parseJsonLdDateValue(node.endDate);

        const place = this.pickJsonLdPlace(node.location);
        const address = place ? this.formatJsonLdAddress(place.address, clean) : '';
        let bar = place ? clean(place.name) : '';
        // Ticketing JSON-LD sometimes fills the venue NAME with the street
        // address (observed 2026-07-17: Eventbrite location.name was "10-90
        // Wyckoff Ave" for an event at HOLO) — an address-shaped bar then
        // fights the calendar's curated venue name in merge. Drop it: an
        // absent bar is a gap that bar-data normalization or the calendar
        // fills, never a conflict. The address field is unaffected.
        if (bar && this.venueNameLooksLikeStreetAddress(bar, address)) {
            console.log(`🤖 AI Web: JSON-LD venue name "${bar}" looks like a street address — not using it as bar`);
            bar = '';
        }

        const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers;
        const offerUrl = offer && typeof offer === 'object' ? this.normalizeHttpUrlValue(offer.url) : '';
        const ticketUrl = offerUrl || this.normalizeHttpUrlValue(node.url) || '';
        const cover = this.formatJsonLdOffersCover(node.offers);

        const event = {
            title,
            description: clean(node.description),
            startDate: start.date,
            endDate: end.date || null,
            bar,
            address,
            url: sourceUrl,
            ticketUrl,
            image: this.pickJsonLdImage(node.image),
            source: this.config.source
        };
        // The page's own structured data named this venue and it survived the
        // address-shaped-name gate above — the venue-site identity pass never
        // overrides a structured-data bar (underscore field, internal only).
        if (event.bar) {
            event._barFromJsonLd = true;
        }
        // imageSource provenance (notes-serialized like pinSource): structured
        // data the page itself published — its own value, distinct from
        // 'og-image'/'page', but og-grade in shared-core's image provenance
        // merge rung. Absent image → no stamp (fail open).
        if (event.image) {
            event.imageSource = 'jsonld';
        }
        if (cover) {
            event.cover = cover;
            // Wix JSON-LD offers only publish fee-inclusive totals ("46.13" =
            // $45.00 + service fee). Flag the cover so Wix warmup enrichment —
            // the same system's data at base-sticker-price fidelity — may
            // upgrade it. Underscore fields are internal metadata (excluded
            // from calendar notes and merge field loops).
            event._coverFromJsonLdOffers = true;
        }
        // The JSON-LD address carries the locality (e.g. "Portland, OR") — resolve city
        // and timezone from it directly so nothing downstream has to guess. Address only:
        // bar names produce false city matches ("Brooklyn Bowl" in Vegas).
        if (address && cityConfig) {
            const cityKey = this.findCityKeyInText(address, cityConfig);
            if (cityKey) {
                event.city = cityKey;
                const timezone = this.getTimezoneForCity(cityKey, cityConfig);
                if (timezone) event.timezone = timezone;
            }
        }
        // Dates without an explicit offset are wall-clock times anchored as UTC;
        // LocationNormalizer re-anchors them once the city/timezone is known.
        if (start.timezoneUnresolved || (end.date && end.timezoneUnresolved)) {
            event._timezoneUnresolved = true;
        }
        return event;
    }

    parseJsonLdDateValue(value) {
        const raw = String(value || '').trim();
        if (!raw) return { date: null, timezoneUnresolved: false };
        // Explicit offset or UTC marker → exact instant
        if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
            const date = new Date(raw);
            return Number.isNaN(date.getTime())
                ? { date: null, timezoneUnresolved: false }
                : { date, timezoneUnresolved: false };
        }
        // No offset → wall-clock local time. Anchor as UTC (never the device timezone,
        // which JS would otherwise silently use) and flag for normalizer re-anchoring.
        const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
        if (!match) return { date: null, timezoneUnresolved: false };
        const date = new Date(Date.UTC(
            Number(match[1]), Number(match[2]) - 1, Number(match[3]),
            Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)
        ));
        return Number.isNaN(date.getTime())
            ? { date: null, timezoneUnresolved: false }
            : { date, timezoneUnresolved: true };
    }

    pickJsonLdPlace(location) {
        const candidates = Array.isArray(location) ? location : [location];
        for (const candidate of candidates) {
            if (candidate && typeof candidate === 'object') {
                if (/virtual/i.test(String(candidate['@type'] || ''))) continue;
                return candidate;
            }
            if (typeof candidate === 'string' && candidate.trim()) {
                return { name: candidate };
            }
        }
        return null;
    }

    formatJsonLdAddress(address, clean) {
        if (!address) return '';
        if (typeof address === 'string') return clean(address);
        if (Array.isArray(address)) return this.formatJsonLdAddress(address[0], clean);
        if (typeof address === 'object') {
            // Eventbrite (and other ticketing) JSON-LD often packs the FULL
            // address into streetAddress ("10-90 Wyckoff Avenue, Queens, NY
            // 11385") while still supplying addressLocality/addressRegion —
            // naive joining doubled the city/state ("..., Queens, NY, Queens,
            // NY"), which churned merge arbitration every run and degraded
            // geocoding. Skip a part that already appears in the address
            // accumulated so far. Bear-site pages with a bare streetAddress
            // ("123 Main St") still get locality/region/postal appended,
            // because those parts are genuinely absent from the street text.
            const parts = [address.streetAddress, address.addressLocality, address.addressRegion, address.postalCode]
                .map(part => clean(part))
                .filter(Boolean);
            const accumulated = [];
            for (const part of parts) {
                if (!this.addressAlreadyContainsPart(accumulated.join(', '), part)) {
                    accumulated.push(part);
                }
            }
            return accumulated.join(', ');
        }
        return '';
    }

    // True when `part` already appears in the address text built so far,
    // compared case-insensitively on whitespace/punctuation-normalized word
    // sequences. Whole word-boundary matching only — the region "NY" must not
    // be considered "present" just because the street contains "SUNNYSIDE".
    addressAlreadyContainsPart(builtSoFar, part) {
        if (!builtSoFar || !part) return false;
        const tokenize = (value) => String(value)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
        const needle = tokenize(part);
        if (!needle) return false;
        return ` ${tokenize(builtSoFar)} `.includes(` ${needle} `);
    }

    // True when a JSON-LD venue NAME is really a street address: either shaped
    // like one (shared-core's looksLikeStreetAddress heuristic), or a
    // normalized duplicate of the address's street line — lowercase,
    // punctuation collapsed to token boundaries, common street-type
    // abbreviations expanded so "10-90 Wyckoff Ave" duplicates the street line
    // of "10-90 Wyckoff Avenue, Queens, NY 11385".
    venueNameLooksLikeStreetAddress(name, address) {
        if (this.core && typeof this.core.looksLikeStreetAddress === 'function'
            && this.core.looksLikeStreetAddress(name)) {
            return true;
        }
        const streetLine = String(address || '').split(',')[0];
        const expandAbbreviation = {
            st: 'street', ave: 'avenue', blvd: 'boulevard', rd: 'road',
            dr: 'drive', ln: 'lane', pl: 'place', ct: 'court',
            pkwy: 'parkway', hwy: 'highway', mt: 'mount'
        };
        const normalizeStreetText = (value) => String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .split(' ')
            .filter(Boolean)
            .map(token => expandAbbreviation[token] || token)
            .join(' ');
        const normalizedName = normalizeStreetText(name);
        return normalizedName.length > 0 && normalizedName === normalizeStreetText(streetLine);
    }

    pickJsonLdImage(image) {
        const candidates = Array.isArray(image) ? image : [image];
        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim()) {
                // JSON-LD events skip normalizeAiEvent, so upgrade degraded CDN
                // thumbnails here — the stored image must never be a blurred preview.
                return this.upgradeCdnThumbnailUrl(this.normalizeHttpUrlValue(candidate) || '') || '';
            }
            if (candidate && typeof candidate === 'object' && typeof candidate.url === 'string') {
                return this.upgradeCdnThumbnailUrl(this.normalizeHttpUrlValue(candidate.url) || '') || '';
            }
        }
        return '';
    }

    // Cover (price) from schema.org offers: a single offer object, a plain offer
    // array, or an AggregateOffer wrapping tier offers. Tiers still on sale
    // (availability without "SoldOut") define the honest walk-up range; when every
    // tier is sold out or unpriced, fall back to all tier prices, then to the
    // AggregateOffer lowPrice/highPrice. Defensive like the sibling pickJsonLd*
    // helpers: malformed offers must never break the JSON-LD fast path.
    formatJsonLdOffersCover(offers) {
        try {
            const tierOffers = [];
            const aggregateOffers = [];
            const collect = (node, depth) => {
                if (!node || depth > 3) return;
                if (Array.isArray(node)) {
                    node.forEach(item => collect(item, depth + 1));
                    return;
                }
                if (typeof node !== 'object') return;
                if (node.offers || /aggregate/i.test(String(node['@type'] || ''))) {
                    aggregateOffers.push(node);
                    collect(node.offers, depth + 1);
                    return;
                }
                tierOffers.push(node);
            };
            collect(offers, 0);

            // Prices of 0, negative, or unparseable never make a cover.
            const parsePrice = (value) => {
                if (value === null || value === undefined || value === '') return null;
                const amount = Number(String(value).trim());
                return Number.isFinite(amount) && amount > 0 ? amount : null;
            };
            const priced = tierOffers
                .map(offer => ({
                    amount: parsePrice(offer.price),
                    currency: offer.priceCurrency,
                    soldOut: /soldout/i.test(String(offer.availability || ''))
                }))
                .filter(entry => entry.amount !== null);
            let selected = priced.filter(entry => !entry.soldOut);
            if (selected.length === 0) selected = priced;
            if (selected.length === 0) {
                for (const aggregate of aggregateOffers) {
                    const amounts = [parsePrice(aggregate.lowPrice), parsePrice(aggregate.highPrice)]
                        .filter(amount => amount !== null);
                    if (amounts.length > 0) {
                        selected = amounts.map(amount => ({ amount, currency: aggregate.priceCurrency }));
                        break;
                    }
                }
            }
            if (selected.length === 0) return '';

            const amounts = selected.map(entry => entry.amount);
            const min = Math.min(...amounts);
            const max = Math.max(...amounts);
            // Whole-dollar values render without trailing ".00"; anything with cents
            // always gets two decimals ("20.5" → "$20.50").
            const formatAmount = (amount) => Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
            const firstCurrency = selected.find(entry => entry.currency && String(entry.currency).trim());
            const currency = firstCurrency ? String(firstCurrency.currency).trim().toUpperCase() : '';
            if (!currency || currency === 'USD' || currency === '$') {
                return min === max ? `$${formatAmount(min)}` : `$${formatAmount(min)}-$${formatAmount(max)}`;
            }
            return min === max
                ? `${formatAmount(min)} ${currency}`
                : `${formatAmount(min)}-${formatAmount(max)} ${currency}`;
        } catch (error) {
            console.warn(`🤖 AI Web: JSON-LD offers→cover mapping failed: ${error && error.message ? error.message : error}`);
            return '';
        }
    }

    // Discovery mode drops events, but the discovery tree should still show what a
    // page is about — surface JSON-LD events in the same shape as discovered segments.
    describeJsonLdEventsAsSegments(jsonLdEvents) {
        const events = Array.isArray(jsonLdEvents) ? jsonLdEvents : [];
        return events.map((event, i) => {
            const lines = [
                event.title,
                event.startDate ? event.startDate.toISOString() : '',
                event.bar,
                event.address,
                event.ticketUrl ? `TICKET_URL: ${event.ticketUrl}` : ''
            ].filter(Boolean);
            return {
                index: i + 1,
                lineCount: lines.length,
                preview: lines.slice(0, 3).join(' | '),
                imageUrls: event.image ? [event.image] : [],
                resourceLines: event.image ? [`SEGMENT_IMAGE_URL: ${event.image}`] : []
            };
        });
    }

    // ============================================================================
    // WIX SERVER-DATA (warmup-data) EVENT ENRICHMENT
    // ============================================================================

    // Wix event pages embed authoritative server state in
    // <script type="application/json" id="wix-warmup-data">: exact UTC instants,
    // an IANA timezone, venue coordinates and ticket prices. Returns a normalized
    // record or null; any absent/unparseable/odd-shaped blob means "no server
    // data" and leaves the extraction flow untouched.
    extractWixServerEventData(html) {
        if (!html || typeof html !== 'string') return null;
        try {
            const startMatch = html.match(/<script\b[^>]*\bid=["']wix-warmup-data["'][^>]*>/i);
            if (!startMatch) return null;
            const jsonString = this.extractJsonObject(html, startMatch.index + startMatch[0].length);
            if (!jsonString) return null;
            const found = this.findWixWarmupEventNode(JSON.parse(jsonString));
            return found ? this.buildWixServerEventRecord(found.event, found.tickets) : null;
        } catch (error) {
            return null;
        }
    }

    // The events-app GUID key inside appsWarmupData is deployment-specific —
    // iterate every app's state and take the first EventsPageInitialState event.
    // Returns { event, tickets }: the per-ticket array (state.tickets, a sibling
    // of state.event) is the only Wix surface carrying BASE sticker prices.
    findWixWarmupEventNode(warmup) {
        if (!warmup || typeof warmup !== 'object') return null;
        const apps = warmup.appsWarmupData && typeof warmup.appsWarmupData === 'object'
            ? Object.values(warmup.appsWarmupData)
            : [warmup];
        for (const app of apps) {
            if (!app || typeof app !== 'object') continue;
            const state = app.EventsPageInitialState;
            if (!state || typeof state !== 'object') continue;
            const wrapper = state.event;
            if (!wrapper || typeof wrapper !== 'object') continue;
            const tickets = Array.isArray(state.tickets) ? state.tickets : [];
            // Observed shape nests the event once more (state.event.event); accept
            // the flat shape too in case other app versions skip the wrapper.
            if (wrapper.event && typeof wrapper.event === 'object') return { event: wrapper.event, tickets };
            if (wrapper.title || wrapper.scheduling) return { event: wrapper, tickets };
        }
        return null;
    }

    buildWixServerEventRecord(node, tickets) {
        const clean = (value) => typeof value === 'string' ? this.normalizeWhitespace(value) : '';
        const location = node.location && typeof node.location === 'object' ? node.location : {};
        const fullAddress = location.fullAddress && typeof location.fullAddress === 'object' ? location.fullAddress : {};
        const geocode = fullAddress.geocode && typeof fullAddress.geocode === 'object' ? fullAddress.geocode : {};
        const coords = location.coordinates && typeof location.coordinates === 'object' ? location.coordinates : {};

        const pickCoordinatePair = (latValue, lngValue) => {
            const lat = Number(latValue);
            const lng = Number(lngValue);
            return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
        };
        const pair = pickCoordinatePair(coords.lat, coords.lng)
            || pickCoordinatePair(geocode.latitude, geocode.longitude);

        const scheduling = node.scheduling && node.scheduling.config && typeof node.scheduling.config === 'object'
            ? node.scheduling.config
            : {};
        const timeZoneId = clean(scheduling.timeZoneId);

        const record = {
            title: clean(node.title) || null,
            slug: clean(node.slug) || null,
            // OpenStreetMapNormalizer stores event.location as `${lat}, ${lng}` —
            // match it byte-for-byte so merge comparisons treat both the same.
            coordinates: pair ? `${pair.lat}, ${pair.lng}` : null,
            timezone: /^[A-Za-z]+\/[A-Za-z_\-+0-9]+/.test(timeZoneId) ? timeZoneId : null,
            startDateUtc: this.parseWixExactInstant(scheduling.startDate),
            endDateUtc: this.parseWixExactInstant(scheduling.endDate),
            address: clean(location.address) || clean(fullAddress.formattedAddress) || null,
            city: clean(fullAddress.city).toLowerCase() || null,
            cover: this.formatWixTicketPriceRange(tickets)
        };
        return Object.values(record).some(value => value !== null) ? record : null;
    }

    // Only explicit-offset/Z timestamps are exact instants; wall-clock strings
    // are ignored (the normal pipeline handles those with re-anchoring).
    parseWixExactInstant(value) {
        const raw = String(value || '').trim();
        if (!raw || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return null;
        const date = new Date(raw);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    // "$45-$60" from the warmup tickets[] array — the only Wix surface with BASE
    // sticker prices. Both JSON-LD offers and the registration.ticketing summary
    // publish fee-inclusive totals only ("46.13" = $45.00 + $1.13 service fee).
    // Tiers still purchasable define the walk-up range; when EVERY tier is sold
    // out, the full range across all tiers backs the cover instead (mirroring
    // formatJsonLdOffersCover). Sold-out signal, verified empirically against
    // the live chunk-party.com Dore Alley page (2026-07-14) by cross-checking
    // each warmup ticket with the JSON-LD offer of the same name: every SoldOut
    // offer had `limitPerCheckout: 0` and every InStock offer had
    // `limitPerCheckout > 0` (1 and 50), while `saleStatus` was 1 on ALL
    // tickets regardless of availability — so `limitPerCheckout === 0` is the
    // reliable signal and saleStatus is useless. Only an explicit 0 counts as
    // sold out; an absent limit never hides a purchasable tier.
    formatWixTicketPriceRange(tickets) {
        const list = Array.isArray(tickets) ? tickets : [];
        // Prices of 0, negative, or unparseable never make a cover (free
        // tickets are RSVPs, not a "$0" cover) — same rule as JSON-LD offers.
        const parsePrice = (price) => {
            if (!price || typeof price !== 'object') return null;
            const amount = Number(String(price.amount || '').trim());
            return Number.isFinite(amount) && amount > 0 ? amount : null;
        };
        const priced = [];
        for (const ticket of list) {
            if (!ticket || typeof ticket !== 'object') continue;
            const base = ticket.price && typeof ticket.price === 'object' ? ticket.price : null;
            const fixed = ticket.pricing && ticket.pricing.fixedPrice && typeof ticket.pricing.fixedPrice === 'object'
                ? ticket.pricing.fixedPrice
                : null;
            const source = parsePrice(base) !== null ? base : fixed;
            const amount = parsePrice(source);
            if (amount === null) continue;
            priced.push({
                amount,
                currency: String(source.currency || '').trim().toUpperCase(),
                soldOut: ticket.limitPerCheckout === 0
            });
        }
        let selected = priced.filter(entry => !entry.soldOut);
        if (selected.length === 0) selected = priced;
        if (selected.length === 0) return null;

        const amounts = selected.map(entry => entry.amount);
        const min = Math.min(...amounts);
        const max = Math.max(...amounts);
        // Same conventions as formatJsonLdOffersCover: whole dollars drop the
        // trailing ".00", real cents keep two decimals ("45.5" → "$45.50").
        const formatAmount = (amount) => Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
        const firstCurrency = selected.find(entry => entry.currency);
        const currency = firstCurrency ? firstCurrency.currency : '';
        if (!currency || currency === 'USD' || currency === '$') {
            return min === max ? `$${formatAmount(min)}` : `$${formatAmount(min)}-$${formatAmount(max)}`;
        }
        return min === max
            ? `${formatAmount(min)} ${currency}`
            : `${formatAmount(min)}-${formatAmount(max)} ${currency}`;
    }

    // ENRICHMENT ONLY — runs on the parser's finished events just before they
    // are returned (both the JSON-LD fast path and the AI-extraction path) and
    // never influences which extraction steps run. Each field fills only when
    // currently empty; values from JSON-LD/AI/OCR are never overwritten. The
    // sole date exception: wall-clock dates (_timezoneUnresolved) are unanchored
    // guesses, so the blob's exact UTC instants replace them and clear the flag.
    applyWixServerDataEnrichment(events, htmlData, cityConfig) {
        try {
            if (!Array.isArray(events) || events.length === 0) return events;
            const html = htmlData && typeof htmlData.html === 'string' ? htmlData.html : '';
            const sourceUrl = htmlData && typeof htmlData.url === 'string' ? htmlData.url : '';
            const record = this.extractWixServerEventData(html);
            if (!record) return events;

            const filledFields = new Set();
            const upgradedFields = new Set();
            let enrichedCount = 0;
            for (const event of events) {
                if (!event || typeof event !== 'object') continue;
                if (!this.wixServerRecordMatchesEvent(record, event, sourceUrl, events.length)) continue;
                const { filled, upgraded } = this.fillEventFromWixServerRecord(event, record, cityConfig);
                if (filled.length > 0 || upgraded.length > 0) {
                    enrichedCount += 1;
                    filled.forEach(field => filledFields.add(field));
                    upgraded.forEach(field => upgradedFields.add(field));
                }
            }
            if (filledFields.size > 0 || upgradedFields.size > 0) {
                const upgradedSuffix = upgradedFields.size > 0
                    ? ` upgraded=[${Array.from(upgradedFields).join(', ')}]`
                    : '';
                console.log(`🤖 AI Web: Wix server data enriched ${enrichedCount} event(s) for ${sourceUrl}: filled=[${Array.from(filledFields).join(', ')}]${upgradedSuffix}`);
            } else {
                console.log(`🤖 AI Web: Wix server data present for ${sourceUrl} but no empty fields to fill`);
            }
        } catch (error) {
            console.warn(`🤖 AI Web: Wix server data enrichment failed — events unchanged: ${error.message}`);
        }
        return events;
    }

    // Conservative same-event check: the warmup blob describes ONE event, so it
    // applies only when the slug appears in the page URL, the titles match, or a
    // single-event event-details page leaves no other candidate. Ambiguity means
    // no enrichment.
    wixServerRecordMatchesEvent(record, event, sourceUrl, eventCount) {
        const url = String(sourceUrl || '').toLowerCase();
        const slug = record.slug ? record.slug.toLowerCase() : '';
        if (slug && url.includes(slug)) return true;
        if (record.title && event && event.title
            && this.normalizeEvidenceText(record.title) === this.normalizeEvidenceText(event.title)) return true;
        // An event-details URL naming a DIFFERENT slug is a mismatch, not ambiguity.
        if (slug && /\/event-details\//.test(url)) return false;
        return eventCount === 1 && /\/event-details\//.test(url);
    }

    fillEventFromWixServerRecord(event, record, cityConfig) {
        const filled = [];
        const upgraded = [];
        const isEmpty = (value) => value === null || value === undefined || String(value).trim() === '';
        const fill = (field, value) => {
            if (value && isEmpty(event[field])) {
                event[field] = value;
                filled.push(field);
            }
        };
        fill('location', record.coordinates);
        fill('timezone', record.timezone);
        // Cover exception to fill-only-empty: a cover flagged _coverFromJsonLdOffers
        // came from the SAME Wix system as the warmup blob, just at lower fidelity —
        // JSON-LD offers only publish fee-inclusive totals while the warmup tickets
        // carry base sticker prices. Upgrading it follows the same precedent as
        // exact UTC instants replacing _timezoneUnresolved wall-clock dates below.
        // A cover extracted by OCR/AI (no flag) is independent evidence and is
        // NEVER overridden.
        if (record.cover && (isEmpty(event.cover) || event._coverFromJsonLdOffers)) {
            (isEmpty(event.cover) ? filled : upgraded).push('cover');
            event.cover = record.cover;
            delete event._coverFromJsonLdOffers;
        }
        fill('address', record.address);
        if (record.city && isEmpty(event.city)) {
            // Only configured city keys, resolved through the same alias matching
            // the rest of the parser uses — never invent a key from raw Wix text.
            const cityKey = this.findCityKeyInText(record.city, cityConfig);
            if (cityKey) {
                event.city = cityKey;
                filled.push('city');
            }
        }
        // Replacing wall-clock dates needs an end instant whenever the event has
        // an end date, so the pair is never split across anchoring schemes. When
        // instants are missing but the timezone was filled above, the flag stays
        // set and LocationNormalizer re-anchors with that timezone as usual.
        if (event._timezoneUnresolved && record.startDateUtc
            && (record.endDateUtc || isEmpty(event.endDate))) {
            event.startDate = record.startDateUtc;
            filled.push('startDate');
            if (record.endDateUtc) {
                event.endDate = record.endDateUtc;
                filled.push('endDate');
            }
            delete event._timezoneUnresolved;
        }
        return { filled, upgraded };
    }

    // Event property that carries a prompt field on JSON-LD-built events: split
    // and full date fields all land in startDate/endDate, and the page URL
    // satisfies website. Everything else maps through the schema's canonical key.
    getJsonLdEventKeyForPromptField(promptField) {
        const normalized = this.normalizePromptFieldName(promptField);
        if (normalized === 'start' || normalized === 'startdate' || normalized === 'starttime') return 'startDate';
        if (normalized === 'end' || normalized === 'enddate' || normalized === 'endtime') return 'endDate';
        if (normalized === 'website') return 'url';
        const schema = this.getEventSchema();
        if (schema && typeof schema.canonicalizeEventKey === 'function') {
            const canonical = schema.canonicalizeEventKey(normalized);
            if (canonical) return canonical;
        }
        return normalized;
    }

    hasJsonLdEventValue(event, eventKey) {
        const value = event ? event[eventKey] : null;
        if (value instanceof Date) return !Number.isNaN(value.getTime());
        if (typeof value === 'string') return value.trim().length > 0;
        return value !== null && value !== undefined;
    }

    // First usable value in an AI pass result for a prompt field, tolerating the
    // lowercased key echoes the retry-style prompts produce.
    getUsableAiFieldValueForPromptField(aiEvent, promptField) {
        if (!aiEvent || typeof aiEvent !== 'object') return null;
        const normalizedField = this.normalizePromptFieldName(promptField);
        for (const key of Object.keys(aiEvent)) {
            if (this.isInternalAiFieldKey(key)) continue;
            if (this.normalizePromptFieldName(key) !== normalizedField) continue;
            if (this.isUsableAiFieldValue(aiEvent[key])) return aiEvent[key];
        }
        return null;
    }

    // JSON-LD fast-path coverage + targeted gap-fill. The fast path skips AI
    // entirely, so fields the structured data never carries (cover on most
    // ticketing pages) were silently lost even when the visible page shows them.
    // A missing field triggers ONE restricted AI extraction only when the page
    // text matches its jsonLdGapFillSignals entry; validated results fill ONLY
    // empty fields — a JSON-LD-provided value is never overwritten. Any failure
    // degrades to the previous behavior (events returned unchanged).
    async applyJsonLdGapFill(events, htmlData, parserConfig, cityConfig, httpAdapter) {
        const sourceUrl = htmlData && htmlData.url ? htmlData.url : '';
        try {
            const promptFields = this.getAiPromptFields(parserConfig, { jsonLd: true }, sourceUrl);
            const seenKeys = new Set();
            const entries = [];
            for (const promptField of promptFields) {
                const eventKey = this.getJsonLdEventKeyForPromptField(promptField);
                if (seenKeys.has(eventKey)) continue;
                seenKeys.add(eventKey);
                entries.push({
                    promptField,
                    eventKey,
                    provided: events.every(event => this.hasJsonLdEventValue(event, eventKey))
                });
            }
            const provided = entries.filter(entry => entry.provided).map(entry => entry.eventKey);
            const missing = entries.filter(entry => !entry.provided).map(entry => entry.eventKey);
            console.log(`🤖 AI Web: JSON-LD coverage for ${sourceUrl}: provided=[${provided.join(', ')}], missing=[${missing.join(', ')}]`);
            if (missing.length === 0) return;

            // A page-level text match can't be attributed to a specific event when
            // the fast path returned several — gap-fill only for single-event pages.
            if (events.length !== 1) return;

            const pageText = this.extractBodyParts(htmlData && htmlData.html ? htmlData.html : '').join('\n');
            const requested = entries.filter(entry => {
                if (entry.provided) return false;
                // Date fields are Date-typed on JSON-LD events; gap-fill writes plain
                // strings, so they can never be requested even if signal-mapped.
                if (entry.eventKey === 'startDate' || entry.eventKey === 'endDate') return false;
                const signals = this.jsonLdGapFillSignals[this.normalizePromptFieldName(entry.promptField)];
                return Array.isArray(signals) && pageText && signals.some(regex => regex.test(pageText));
            });
            if (requested.length === 0) return;
            const requestedNames = requested.map(entry => entry.eventKey);

            const aiConfig = this.getAiConfig(parserConfig);
            const maxHtmlChars = Math.max(500, Number(aiConfig.maxHtmlChars));
            const sectionBundle = this.getPromptSectionBundle(htmlData && htmlData.html ? htmlData.html : '', aiConfig);
            // One targeted request: first content snippet only. dataFlags carry
            // jsonLd (true for this page) so the two-pass extractor skips its
            // context-prep round-trip.
            const contentSnippets = sectionBundle.content
                ? this.buildPromptSnippets([], [sectionBundle.content], maxHtmlChars).slice(0, 1)
                : [];
            if (!aiConfig.enabled || contentSnippets.length === 0) {
                console.log(`🤖 AI Web: JSON-LD gap-fill for ${sourceUrl}: requested=[${requestedNames.join(', ')}], filled=[] (${aiConfig.enabled ? 'no page text to extract from' : 'AI disabled'})`);
                return;
            }
            const partial = await this.extractFieldsAcrossSnippets(
                htmlData,
                aiConfig,
                cityConfig,
                parserConfig,
                requested.map(entry => entry.promptField),
                contentSnippets,
                'jsonld gap-fill',
                null,
                { partitionLabel: 'content', dataFlags: { jsonLd: true, content: true } },
                httpAdapter
            );

            const filled = [];
            for (const entry of requested) {
                const value = this.getUsableAiFieldValueForPromptField(partial, entry.promptField);
                if (typeof value !== 'string' || !value.trim()) continue;
                let filledAny = false;
                for (const event of events) {
                    if (this.hasJsonLdEventValue(event, entry.eventKey)) continue;
                    event[entry.eventKey] = value.trim();
                    filledAny = true;
                }
                if (filledAny) filled.push(entry.eventKey);
            }
            console.log(`🤖 AI Web: JSON-LD gap-fill for ${sourceUrl}: requested=[${requestedNames.join(', ')}], filled=[${filled.join(', ')}]`);
        } catch (error) {
            console.warn(`🤖 AI Web: JSON-LD gap-fill failed for ${sourceUrl} — keeping JSON-LD events unchanged: ${error && error.message ? error.message : error}`);
        }
    }

    // OCR is only worth paying for when something consumes it: segment pairing on
    // multi-event pages (which runs even in discoveryOnly mode), or AI extraction.
    // Link-aggregators never extract, and discoveryOnly skips extraction everywhere.
    shouldRunOcrForPage(parserConfig = {}, pageClassification = null) {
        if (pageClassification === 'multi-event-page') return true;
        if (pageClassification === 'link-aggregator') return false;
        return parserConfig.discoveryOnly !== true;
    }

    isLikelyEmptyOcrText(text) {
        const normalized = this.normalizeWhitespace(String(text || '')).toLowerCase();
        if (!normalized) return true;
        return normalized === 'text' || normalized === 'ocr text';
    }

    isLikelyUninterestingImageUrl(url) {
        const lowerUrl = String(url || '').toLowerCase();
        // Skip images that are clearly not event-related
        const uninterestingPatterns = [
            'logo',           // Brand logos
            'favicon',        // Favicon icons
            'icon',           // Generic icons
            'avatar',         // User avatars
            'button',         // UI buttons
            'spacer',         // Spacer images
            'divider',        // Divider images
            'bullet',         // Bullet points
            'sprite',         // Sprite images
            'share-',         // Share icons (share-facebook, share-twitter, etc.)
            'social-',        // Social media icons
            'newsletter',     // Newsletter icons
            'subscribe',      // Subscribe buttons
            'download',       // Download buttons
            'arrow-',         // Arrow icons
            'chevron-',       // Chevron icons
            'caret-',         // Caret icons
            'menu-',          // Menu icons
            'close-',         // Close/X icons
            'search-',        // Search icons
            'cart-',          // Cart icons
            'user-',          // User icons
            'account-',       // Account icons
            'profile-',       // Profile icons
            'settings-',      // Settings icons
            'help-',          // Help icons
            'info-',          // Info icons
            'warning-',       // Warning icons
            'error-',         // Error icons
            'success-',       // Success icons
            'check-',         // Check icons
            'star-',          // Star icons
            'rating',         // Rating stars
            'badge',          // Badges
            'tag',            // Tags
            'flag-',          // Flag icons
            'language',       // Language selectors
            'currency',       // Currency selectors
            'loading',        // Loading spinners
            'spinner',        // Loading spinners
            'placeholder',    // Placeholder images
            'empty',          // Empty state images
            'null',           // Null state images
            'missing',        // Missing state images
            'coming-soon',    // Coming soon images
            'under-construction',
            'maintenance',    // Maintenance pages
            'temp-',          // Temp images
            'tmp-',           // Temp images
            'cache-',         // Cached images
            'thumb',          // Thumbnails (already handled by classification)
            'thumbnail',      // Thumbnails
            '/_next/static/', // Next.js build assets (map placeholders, UI chrome)
            'maps.google.com', // Embedded map iframes picked up as image candidates
            'output=embed',   // Google Maps embed URLs — not images, always fail download
        ];
        for (const pattern of uninterestingPatterns) {
            if (lowerUrl.includes(pattern)) return true;
        }
        // '404' only counts when it stands alone between non-alphanumerics
        // ("/404.png", "error-404.jpg") — as a bare substring it matches
        // random hex asset IDs (a Wix flyer named "238fae_c4047c55…" was
        // flagged as a 404 image and never OCR'd) and pixel sizes ("w_1404").
        if (/(^|[^0-9a-z])404(?![0-9a-z])/.test(lowerUrl)) return true;
        return false;
    }

    // Run an async task over items with at most `limit` in flight. Local vision models
    // serve one request well; parallel requests just push each other into timeouts.
    async mapWithConcurrencyLimit(items, limit, task) {
        const list = Array.isArray(items) ? items : [];
        const results = new Array(list.length);
        let nextIndex = 0;
        const workerCount = Math.max(1, Math.min(Math.floor(Number(limit) || 1), list.length || 1));
        const workers = Array.from({ length: workerCount }, async () => {
            while (nextIndex < list.length) {
                const index = nextIndex++;
                results[index] = await task(list[index], index);
            }
        });
        await Promise.all(workers);
        return results;
    }

    async extractOcrFromAllImages(htmlData, ocrConfig = {}, httpAdapter = null, maxImages = 10) {
        const sourceUrl = htmlData && typeof htmlData.url === 'string' ? htmlData.url : '';
        const html = htmlData && typeof htmlData.html === 'string' ? htmlData.html : '';

        // Gather more candidates than we intend to OCR so uninteresting images
        // (logos, icons, static assets) don't consume slots meant for real flyers.
        const maxCandidates = Math.max(10, maxImages);
        const candidateUrls = this.extractOrderedImageUrlsFromHtml(html, sourceUrl, maxCandidates);

        // Pre-filter out uninteresting images before OCR
        const interestingUrls = candidateUrls.filter(url => !this.isLikelyUninterestingImageUrl(url));
        if (interestingUrls.length < candidateUrls.length) {
            console.log(`🤖 AI Web: OCR skipped ${candidateUrls.length - interestingUrls.length} uninteresting images`);
        }

        const imageUrls = interestingUrls.slice(0, maxImages);
        if (imageUrls.length < interestingUrls.length || candidateUrls.length >= maxCandidates) {
            console.log(`🤖 AI Web: OCR image cap (${maxImages}) applied — images beyond the cap rely on segment top-up`);
        }

        // Batch OCR requests with limited concurrency
        const results = await this.mapWithConcurrencyLimit(imageUrls, ocrConfig.maxConcurrentRequests || 1, url =>
            this.getOcrTextForImage(url, ocrConfig, 'ocr-all', httpAdapter).catch(err => null)
        );

        const ocrResults = results
            .filter(r => r !== undefined)
            .map(result => this.normalizeOcrResult(result))
            .filter(r => r !== null);

        // Deduplicate OCR results by stripped URL to prevent same image at different sizes
        // from being processed multiple times. This runs before consolidation which groups
        // by text+classification.
        const dedupedByUrl = this.deduplicateOcrResultsByUrl(ocrResults || []);

        // Consolidate duplicate images (same text + classification, different URLs)
        // Only consolidate images that have actual text content (event fliers, flyers, etc.)
        const resultsWithText = dedupedByUrl.filter(r => r && r.text && r.text.trim().length > 0);
        const consolidatedResults = this.consolidateDuplicateOcrResults(resultsWithText);

        if (ocrResults.length > 0) {
            const skipped = ocrResults.length - resultsWithText.length;
            if (skipped > 0) {
                console.log(`🤖 AI Web: Skipped ${skipped} OCR result(s) without text`);
            }
        }

        if (consolidatedResults.length < resultsWithText.length) {
            console.log(`🤖 AI Web: Consolidated ${resultsWithText.length} text-containing OCR results to ${consolidatedResults.length} unique images`);
        }

        return consolidatedResults;
    }

    normalizeOcrResult(rawResult) {
        if (!rawResult || typeof rawResult !== 'object') return null;

        // Map possible field names to canonical names
        const classification = rawResult.imageClassification
            || rawResult.classification
            || rawResult.type
            || rawResult.category
            || '';

        const text = rawResult.text
            || rawResult.content
            || rawResult.extracted_text
            || '';

        const eventSummary = rawResult.eventSummary
            || rawResult.summary
            || rawResult.event_summary
            || null;

        let confidence = Number(rawResult.confidence)
            || Number(rawResult.score)
            || Number(rawResult.certainty)
            || 0;

        // Clamp confidence to 0-100 range
        if (Number.isFinite(confidence)) {
            confidence = Math.max(0, Math.min(100, Math.round(confidence)));
        } else {
            confidence = null;
        }

        const reason = rawResult.reason
            || rawResult.explanation
            || rawResult.notes
            || '';

        // Normalize text: trim and handle empty/invalid OCR text
        const normalizedText = String(text || '')
            .replace(/\r\n?/g, '\n')
            .trim();

        return {
            url: rawResult.imageUrl || rawResult.url || '',
            text: this.isLikelyEmptyOcrText(normalizedText) ? '' : normalizedText,
            imageClassification: classification,
            eventSummary,
            confidence,
            reason,
            cacheHit: rawResult.cached || false
        };
    }

    // The page-level OCR pass caps how many images it reads, so flyers for later segments on
    // long multi-event pages can miss OCR entirely. Top up: OCR the first usable image of any
    // segment that has no OCR coverage yet, so every segment can contribute image text.
    // Mutates ocrResults in place so callers holding the array see the new entries.
    async ensureSegmentOcrCoverage(segments, ocrResults, parserConfig, sourceUrl = '', httpAdapter = null) {
        if (!Array.isArray(segments) || segments.length === 0 || !Array.isArray(ocrResults)) {
            return ocrResults;
        }
        const ocrConfig = this.getOcrConfig(parserConfig);
        if (!ocrConfig.enabled) return ocrResults;

        const coveredStrippedUrls = new Set(
            ocrResults
                .map(ocr => this.stripSizeParams(this.normalizeHttpUrlValue(ocr && ocr.url)))
                .filter(Boolean)
        );

        const targets = [];
        const targetStrippedUrls = new Set();
        for (const segment of segments) {
            const segmentImageUrls = [
                ...this.extractOrderedImageUrlsFromHtml(
                    segment && typeof segment.html === 'string' ? segment.html : '',
                    sourceUrl,
                    2
                ),
                ...(Array.isArray(segment && segment.imageHintUrls) ? segment.imageHintUrls : [])
            ];
            const normalizedUrls = segmentImageUrls
                .map(url => this.normalizeHttpUrlValue(url))
                .filter(Boolean);
            const hasCoverage = normalizedUrls.some(url => coveredStrippedUrls.has(this.stripSizeParams(url)));
            if (hasCoverage) continue;

            const candidate = normalizedUrls.find(url => !this.isLikelyUninterestingImageUrl(url));
            if (!candidate) {
                // A segment whose images ALL look uninteresting gets no OCR at
                // all — say so instead of silently skipping (this hid the run
                // where a flyer's hex asset ID tripped the old '404' pattern).
                if (normalizedUrls.length > 0) {
                    console.log(`🤖 AI Web: OCR top-up skipped a segment — all ${normalizedUrls.length} of its image(s) look uninteresting (first: ${normalizedUrls[0]})`);
                }
                continue;
            }
            const strippedCandidate = this.stripSizeParams(candidate);
            if (targetStrippedUrls.has(strippedCandidate)) continue;
            targetStrippedUrls.add(strippedCandidate);
            targets.push(candidate);
        }
        if (targets.length === 0) return ocrResults;

        console.log(`🤖 AI Web: OCR top-up for ${targets.length} segment image(s) missed by the page-level cap`);
        const rawResults = await this.mapWithConcurrencyLimit(targets, ocrConfig.maxConcurrentRequests || 1, url =>
            this.getOcrTextForImage(url, ocrConfig, 'ocr-segment', httpAdapter).catch(() => null)
        );
        for (const rawResult of rawResults) {
            const normalized = this.normalizeOcrResult(rawResult);
            if (!normalized || !normalized.text || normalized.text.trim().length === 0) continue;
            ocrResults.push(normalized);
        }
        return ocrResults;
    }

    // The URL keys a segment claims OCR results with — normalized exact URLs
    // plus size-stripped (and CDN-upgraded) keys. Shared by
    // filterOcrResultsForSegment and the OCR-consistency gate so both judge
    // image ownership identically.
    getSegmentImageUrlKeys(segment, sourceUrl = '') {
        if (!segment || typeof segment !== 'object') {
            return { normalized: new Set(), stripped: new Set() };
        }

        // Extract segment's image URLs
        const segmentImageUrls = new Set([
            ...this.extractOrderedImageUrlsFromHtml(
                segment && typeof segment.html === 'string' ? segment.html : '',
                sourceUrl,
                2
            ),
            ...Array.isArray(segment.imageHintUrls) ? segment.imageHintUrls : []
        ]);

        // Normalize segment image URLs for comparison
        const normalized = new Set(
            Array.from(segmentImageUrls)
                .map(u => this.normalizeHttpUrlValue(u))
                .filter(Boolean)
        );

        // Strip sizes for more robust comparison. Each URL is also run through
        // upgradeCdnThumbnailUrl first: OCR results are keyed by the upgraded bare
        // asset URL, so segment thumbnail variants must collapse to the same key
        // even if a future transform shape slips past stripSizeParams.
        const stripped = new Set();
        for (const u of normalized) {
            const strippedUrl = this.stripSizeParams(u);
            if (strippedUrl) stripped.add(strippedUrl);
            const upgraded = this.upgradeCdnThumbnailUrl(u);
            if (upgraded && upgraded !== u) {
                const strippedUpgraded = this.stripSizeParams(upgraded);
                if (strippedUpgraded) stripped.add(strippedUpgraded);
            }
        }

        return { normalized, stripped };
    }

    filterOcrResultsForSegment(ocrResults, segment, sourceUrl = '') {
        if (!Array.isArray(ocrResults) || ocrResults.length === 0) return [];
        if (!segment || typeof segment !== 'object') return [];

        const { normalized: normalizedSegmentImageSet, stripped: strippedSegmentImageSet } =
            this.getSegmentImageUrlKeys(segment, sourceUrl);
        const excludedUrlKeys = segment.ocrExcludedUrlKeys instanceof Set ? segment.ocrExcludedUrlKeys : null;

        console.log(`🤖 AI Web: Filtering OCR results against ${normalizedSegmentImageSet.size} segment images (${strippedSegmentImageSet.size} stripped)`);

        // Filter OCR results to match segment images
        const matchedOcrResults = ocrResults.filter(ocr => {
            const ocrUrl = this.normalizeHttpUrlValue(ocr.url);
            const strippedOcrUrl = this.stripSizeParams(ocrUrl);

            // Consistency-gate exclusions first: an image the gate reassigned
            // or detached from this segment never matches, even via exact URL.
            if (excludedUrlKeys && strippedOcrUrl && excludedUrlKeys.has(strippedOcrUrl)) return false;

            const exactMatch = normalizedSegmentImageSet.has(ocrUrl);
            const strippedMatch = strippedOcrUrl && strippedSegmentImageSet.has(strippedOcrUrl);

            if (exactMatch) {
                console.log(`🤖 AI Web: Segment matched OCR result via exact URL: ${ocrUrl}`);
                return true;
            } else if (strippedMatch) {
                console.log(`🤖 AI Web: Segment matched OCR result via stripped URL: ${ocrUrl} -> ${strippedOcrUrl}`);
                return true;
            }
            return false;
        });

        if (matchedOcrResults.length === 0 && ocrResults.length > 0 && normalizedSegmentImageSet.size > 0) {
            console.log(`🤖 AI Web: Segment failed to match any of the ${ocrResults.length} OCR results.`);
            console.log(`🤖 AI Web: First segment image (stripped): ${Array.from(strippedSegmentImageSet)[0] || 'none'}`);
            console.log(`🤖 AI Web: First OCR image (stripped): ${this.stripSizeParams(this.normalizeHttpUrlValue(ocrResults[0].url)) || 'none'}`);
        }

        return matchedOcrResults;
    }

    // Post-pairing title↔OCR consistency gate: once segment OCR coverage is
    // complete, every OCR flyer's text is checked against its owner segment's
    // listing title. A flyer sharing NO title token with its owner that
    // clearly names exactly one ELIGIBLE sibling (≥ 2 matched title tokens, or
    // full coverage of a 1-token title) is reassigned there; one matching
    // several siblings equally is detached (assigned to nobody). A flyer that
    // matches its owner at all — or matches nobody — is left alone, so correct
    // exact-URL pairings can never thrash (fail open). Ownership is judged by
    // getSegmentImageUrlKeys, the SAME keys filterOcrResultsForSegment uses.
    applySegmentOcrConsistencyGate(segments, ocrResults, sourceUrl = '') {
        const sourceSegments = Array.isArray(segments) ? segments : [];
        const ocrList = Array.isArray(ocrResults) ? ocrResults : [];
        if (sourceSegments.length < 2 || ocrList.length === 0) return sourceSegments;
        if (!this.core || typeof this.core.getCrossSourceTitleTokens !== 'function') return sourceSegments;

        const segmentInfos = sourceSegments.map(segment => {
            const title = this.deriveSegmentListingTitle(segment);
            return {
                segment,
                title,
                titleTokens: this.core.getCrossSourceTitleTokens(title),
                eligible: this.isSegmentEligibleForImagePairing(segment),
                keys: this.getSegmentImageUrlKeys(segment, sourceUrl)
            };
        });

        for (const ocr of ocrList) {
            if (!ocr || typeof ocr.text !== 'string' || ocr.text.trim() === '') continue;
            const ocrUrl = this.normalizeHttpUrlValue(ocr.url);
            const strippedOcrUrl = this.stripSizeParams(ocrUrl);
            if (!strippedOcrUrl) continue;
            const ocrTokens = new Set(this.core.getCrossSourceTitleTokens(
                `${String(ocr.text || '')} ${String(ocr.eventSummary || '')}`));
            const matchedCount = info => info.titleTokens.filter(token => ocrTokens.has(token)).length;

            for (let i = 0; i < segmentInfos.length; i++) {
                const owner = segmentInfos[i];
                const ownsImage = owner.keys.normalized.has(ocrUrl) || owner.keys.stripped.has(strippedOcrUrl);
                if (!ownsImage) continue;
                // Any title-token overlap corroborates the current pairing.
                if (matchedCount(owner) > 0) continue;
                const candidates = [];
                for (let j = 0; j < segmentInfos.length; j++) {
                    if (j === i) continue;
                    const sibling = segmentInfos[j];
                    if (!sibling.eligible) continue;
                    const matched = matchedCount(sibling);
                    const coversSingleTokenTitle = sibling.titleTokens.length === 1 && matched === 1;
                    if (matched >= 2 || coversSingleTokenTitle) {
                        candidates.push({ index: j, matched });
                    }
                }
                if (candidates.length === 0) continue; // names nobody → leave alone
                const maxMatched = Math.max(...candidates.map(candidate => candidate.matched));
                const topCandidates = candidates.filter(candidate => candidate.matched === maxMatched);
                if (!(owner.segment.ocrExcludedUrlKeys instanceof Set)) {
                    owner.segment.ocrExcludedUrlKeys = new Set();
                }
                owner.segment.ocrExcludedUrlKeys.add(strippedOcrUrl);
                if (topCandidates.length === 1) {
                    const target = segmentInfos[topCandidates[0].index];
                    if (!Array.isArray(target.segment.imageHintUrls)) {
                        target.segment.imageHintUrls = [];
                    }
                    if (!target.segment.imageHintUrls.includes(ocr.url)) {
                        target.segment.imageHintUrls.push(ocr.url);
                    }
                    // Refresh the target's ownership keys so later OCR results
                    // judge the moved image against its NEW owner.
                    target.keys = this.getSegmentImageUrlKeys(target.segment, sourceUrl);
                    console.log(`🤖 AI Web: Reassigned OCR image ${ocr.url} from segment ${i + 1} ("${owner.title}") to segment ${topCandidates[0].index + 1} ("${target.title}") — flyer text matches sibling listing title`);
                } else {
                    console.log(`🤖 AI Web: Detached OCR image ${ocr.url} from segment ${i + 1} ("${owner.title}") — flyer text matches multiple sibling titles`);
                }
            }
        }
        return sourceSegments;
    }

    buildOcrSnippet(imageUrl, text, eventSummary = null) {
        const parts = [
            `OCR_IMAGE_URL: ${String(imageUrl || '').trim()}`,
            'OCR_IMAGE_TEXT',
            String(text || '').trim()
        ];
        // Note: OCR_IMAGE_SUMMARY is purposefully omitted here so it doesn't get swept into
        // evidence checks. It is injected into the prompt separately via buildExtractionPrompt.
        return parts.filter(Boolean).join('\n');
    }

    /**
     * Normalize OCR text for comparison (case-insensitive, whitespace-normalized)
     */
    normalizeOcrTextForComparison(text) {
        if (!text || typeof text !== 'string') return '';
        return text.trim().toLowerCase().replace(/\s+/g, ' ');
    }

    /**
     * Extract a size score from a URL to determine which image is larger.
     * Returns a numeric score - higher means larger image.
     * The scoring itself lives in SharedCore.getImageSizeScoreFromUrl so the
     * merge's deterministic image rung ranks candidates on the SAME scale as
     * the OCR dedup here. Core is always wired in production; the URL-length
     * fallback only covers stubbed cores in isolated tests.
     */
    getImageSizeFromUrl(url) {
        if (!url || typeof url !== 'string') return -1;
        if (this.core && typeof this.core.getImageSizeScoreFromUrl === 'function') {
            return this.core.getImageSizeScoreFromUrl(url);
        }
        return url.length;
    }

    /**
     * Deduplicate OCR results by stripped URL to prevent same image at different sizes
     * from being processed multiple times. Selects the largest image from each group.
     */
    deduplicateOcrResultsByUrl(ocrResults) {
        if (!Array.isArray(ocrResults)) {
            return [];
        }
        if (ocrResults.length <= 1) {
            return ocrResults;
        }

        // Filter out null/undefined elements
        const filteredResults = ocrResults.filter(r => r !== null && r !== undefined);
        if (filteredResults.length <= 1) {
            return filteredResults;
        }

        // Group results by stripped URL (same image at different sizes)
        const groups = new Map();
        for (const result of filteredResults) {
            if (!result || !result.url) continue;
            const strippedUrl = this.stripSizeParams(result.url);
            if (!strippedUrl) continue;
            if (!groups.has(strippedUrl)) {
                groups.set(strippedUrl, []);
            }
            groups.get(strippedUrl).push(result);
        }

        // For each group, select the largest image
        const deduped = [];
        for (const group of groups.values()) {
            if (group.length === 1) {
                deduped.push(group[0]);
            } else {
                // Sort by size score (descending) and pick the largest
                group.sort((a, b) => this.getImageSizeFromUrl(b.url) - this.getImageSizeFromUrl(a.url));
                deduped.push(group[0]);
                console.log(`🤖 AI Web: Deduplicated ${group.length} size variant(s) to largest: ${group[0].url}`);
            }
        }

        return deduped;
    }

    /**
     * Consolidate duplicate OCR results by selecting the largest image from groups
     * with identical text + classification.
     *
     * Only call this with results that have actual text content.
     * Empty-text results should be filtered out before consolidation.
     */
    consolidateDuplicateOcrResults(ocrResults) {
        if (!Array.isArray(ocrResults) || ocrResults.length <= 1) {
            return ocrResults;
        }

        // Filter out results without text (we only care about event fliers with readable text)
        const resultsWithText = ocrResults.filter(r => r && r.text && r.text.trim().length > 0);
        if (resultsWithText.length === 0) {
            return [];
        }
        if (resultsWithText.length < ocrResults.length) {
            console.log(`🤖 AI Web: Filtered out ${ocrResults.length - resultsWithText.length} result(s) without text before consolidation`);
        }
        ocrResults = resultsWithText;

        // Group results by normalized text + classification
        const groups = new Map();
        for (const result of ocrResults) {
            const key = this.getOcrResultDuplicateKey(result);
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(result);
        }

        // For each group, select the largest image
        const consolidated = [];
        for (const group of groups.values()) {
            if (group.length === 1) {
                consolidated.push(group[0]);
            } else {
                // Sort by size score (descending) and pick the largest
                group.sort((a, b) => this.getImageSizeFromUrl(b.url) - this.getImageSizeFromUrl(a.url));
                consolidated.push(group[0]);
                console.log(`🤖 AI Web: Consolidated ${group.length} duplicate image(s) to largest: ${group[0].url}`);
            }
        }

        return consolidated;
    }

    /**
     * Generate a key for grouping OCR results by content (text + classification).
     * Results with the same key are considered duplicates (same content, different URLs).
     */
    getOcrResultDuplicateKey(result) {
        if (!result) return '';
        const text = this.normalizeOcrTextForComparison(result.text || '');
        const classification = (result.imageClassification || '').toLowerCase().trim();
        return `${text}||${classification}`;
    }

    async getOcrTextForImage(imageUrl, ocrConfig = {}, passLabel = 'ocr', httpAdapter = null) {
        // Upgrade degraded CDN thumbnails (blurred/low-res Wix previews) to the
        // original asset BEFORE the cache lookup so both the vision model and the
        // OCR cache key see the full-size flyer, never the blurry preview.
        imageUrl = this.upgradeCdnThumbnailUrl(imageUrl);
        const cached = await this.readCachedOcrResult(imageUrl, ocrConfig);
        if (cached) {
            if (cached.failureKind) {
                console.log(`🤖 AI Web: OCR negative cache hit (${cached.failureKind}) for ${cached.imageUrl || imageUrl} — skipping known-bad image`);
                return null;
            }
            console.log(`🤖 AI Web: OCR cache hit for ${cached.imageUrl || imageUrl}`);
            return cached;
        }

        const rawUrl = String(imageUrl || '').trim();
        const normalizedUrl = this.normalizeHttpUrlValue(this.unwrapImageProxyUrl(rawUrl) || rawUrl);
        if (!normalizedUrl) {
            throw new Error('Missing image URL');
        }
        const downloadStart = Date.now();
        let base64Image;
        try {
            base64Image = await httpAdapter.fetchImageAsBase64(normalizedUrl, ocrConfig.timeoutSeconds);
        } catch (error) {
            console.warn(`🚨 AI Web: OCR image download failed for ${normalizedUrl} after ${Date.now() - downloadStart}ms: ${error.message}`);
            throw error;
        }
        console.log(`🤖 AI Web: OCR image attached via base64 payload (${base64Image.length} chars) for ${normalizedUrl} (downloaded in ${Date.now() - downloadStart}ms)`);
        const diagnostics = {};
        let rawResponse = await this.core.callAiGenerate(ocrConfig, ocrConfig.prompt, passLabel, httpAdapter, this.recordAiPrompt.bind(this), base64Image, diagnostics);
        if (!rawResponse && diagnostics.failureKind === 'context-overflow') {
            // Vision tokens scale with pixels — retry once at a harder downscale before
            // writing the image off (adapters without resize support return the same
            // bytes, in which case we skip the pointless retry).
            let retrySucceeded = false;
            try {
                const retryImage = await httpAdapter.fetchImageAsBase64(normalizedUrl, ocrConfig.timeoutSeconds, this.ocrOverflowRetryMaxDimension);
                if (retryImage && retryImage.length < base64Image.length) {
                    console.log(`🤖 AI Web: Retrying OCR at reduced resolution (${retryImage.length} chars, was ${base64Image.length}) for ${normalizedUrl}`);
                    const retryDiagnostics = {};
                    rawResponse = await this.core.callAiGenerate(ocrConfig, ocrConfig.prompt, passLabel, httpAdapter, this.recordAiPrompt.bind(this), retryImage, retryDiagnostics);
                    retrySucceeded = Boolean(rawResponse);
                    diagnostics.failureKind = retryDiagnostics.failureKind || (rawResponse ? null : diagnostics.failureKind);
                }
            } catch (error) {
                console.warn(`🤖 AI Web: Reduced-resolution OCR retry failed for ${normalizedUrl}: ${error.message}`);
            }
            if (retrySucceeded) {
                console.log(`🤖 AI Web: Reduced-resolution OCR retry succeeded for ${normalizedUrl}`);
            }
        }
        if (!rawResponse) {
            // Context overflow is deterministic for a given image+model — cache the
            // failure so the same image is not re-downloaded and re-sent on every
            // page (and every run) that references it.
            if (diagnostics.failureKind === 'context-overflow') {
                const cachePath = await this.writeCachedOcrResult(imageUrl, ocrConfig, JSON.stringify({ failureKind: diagnostics.failureKind }));
                if (cachePath) {
                    console.warn(`🤖 AI Web: Cached OCR failure (${diagnostics.failureKind}) for ${normalizedUrl} so it is not retried`);
                }
            }
            return null;
        }
        const parsed = this.parseOcrResponseWithClassification(rawResponse);
        if (!parsed) {
            console.warn(`🤖 AI Web: OCR response for ${imageUrl} did not include text`);
            return null;
        }
        if (!parsed.text) {
            console.log(`🤖 AI Web: OCR response for ${imageUrl} has no text (imageClassification: ${parsed.imageClassification})`);
        }
        const normalized = this.normalizeOcrResult(parsed);
        const cachePath = await this.writeCachedOcrResult(imageUrl, ocrConfig, JSON.stringify(parsed));
        return {
            imageUrl,
            text: normalized.text,
            imageClassification: normalized.imageClassification,
            eventSummary: normalized.eventSummary,
            confidence: normalized.confidence,
            reason: normalized.reason,
            cachePath,
            cached: false
        };
    }

    scoreAdditionalUrl(url, sourceUrl, context = '') {
        let score = 0;
        const parsedUrl = this.parseUrlComponents(url);
        if (!parsedUrl) return score;
        const parsedSource = sourceUrl ? this.parseUrlComponents(sourceUrl) : null;
        const path = String(parsedUrl.pathname || '').toLowerCase();
        const search = String(parsedUrl.search || '').toLowerCase();
        const contextText = this.normalizeWhitespace(this.stripTags(context)).toLowerCase();
        const haystack = `${path} ${search}`;

        if (parsedSource && parsedUrl.hostname === parsedSource.hostname) score += 10;
        if (/(eventbrite|ticketleap|redeyetickets|tickets?|dice|ra|residentadvisor|sickening)\./i.test(parsedUrl.hostname)) score += 15;
        if (/\/e\/[^/?#]+/i.test(path)) score += 95;
        if (/\/events?\/[^/?#]+/i.test(path)) score += 85;
        if (/\/(?:party|parties|show|shows|ticket|tickets|calendar)\/[^/?#]+/i.test(path)) score += 60;
        if (/(event|ticket|party|show|festival|concert|dance|night|rsvp|register)/i.test(haystack)) score += 40;
        if (/(event|ticket|party|show|festival|concert|dance|night|rsvp|register|details|learn more)/i.test(contextText)) score += 30;
        if (/\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2})\b/.test(haystack)) score += 25;
        if (/[?&](?:event|event_id|eventid|eid|id|ticket|ticket_id)=/i.test(search)) score += 20;
        if (/^\/(?:events?|calendar|tickets?|shows?)\/?$/i.test(path) && !search) score -= 45;
        if (/\/(?:about|contact|privacy|terms|login|signin|signup|search|tag|category|blog)(?:\/|$)/i.test(path)) score -= 35;
        // Eventbrite /l/ paths are marketing/landing pages, not event detail or listing pages
        if (/eventbrite\./i.test(parsedUrl.hostname) && /^\/l\//i.test(path)) score -= 100;
        return score;
    }

    validateEventUrl(url, sourceUrl, parserConfig = {}) {
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
            '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.heic', '.heif',
            '.ico', '.bmp', '.tif', '.tiff',
            '.css', '.js', '.mjs', '.map', '.json', '.xml', '.txt', '.pdf', '.zip', '.gz', '.tgz',
            '.mp3', '.m4a', '.wav', '.mp4', '.webm', '.mov', '.avi', '.woff', '.woff2', '.ttf'
        ];
        if (staticAssetExtensions.some(ext => lowerPath.endsWith(ext))) return { valid: false, reason: 'static-asset-extension' };
        const staticAssetPathHints = ['/touch_icons/', '/images/', '/image/', '/img/', '/assets/', '/static/'];
        if (staticAssetPathHints.some(segment => lowerPath.includes(segment))) return { valid: false, reason: 'static-asset-path' };

        // WordPress infrastructure paths — not event pages (feeds, REST API, XML-RPC, sitemaps)
        const wordpressInfraPaths = ['/feed', '/comments/feed', '/wp-json', '/wp-sitemap', '/wp-sitemap.xml', '/xmlrpc.php'];
        const isWordPressInfra = wordpressInfraPaths.some(p => {
            const lp = p.toLowerCase();
            return lowerPath === lp || lowerPath.startsWith(lp + '/');
        });
        if (isWordPressInfra) return { valid: false, reason: 'wordpress-infrastructure' };
        // Template/placeholder URLs (e.g. ?s={search_term_string}) — not real pages
        if (/\{[^}]+\}/.test(url)) {
            return { valid: false, reason: 'template-url' };
        }

        const invalidUrlPatterns = [
            '/admin', '/login', '/wp-admin', '/wp-login', '/user/', '/profile/',
            '/wp-content', '/terms', '/privacy',
            'javascript:', 'mailto:', 'tel:', 'sms:', 'localhost:',
            /^https?:\/\/(?:[^/]+\.)?soundcloud\.com\/player\//i,
            // Block email-like path segments (e.g. /8c4075...@sentry.io/1865790) found in telemetry artifacts.
            /\/[^/?#\s]+@[^/?#\s]+\.[a-z]{2,}(?:[/?#]|$)/i,
            // Block Wix auto-frontend module paths including malformed static./services variant.
            /\/static\.?\/services\/auto-frontend-modules\//i,
            // Generic non-event site sections, anchored to WHOLE path segments so
            // event slugs containing these words survive (e.g. /events/all-about-bears).
            // /login is already covered by the substring list above.
            /\/(?:shop|store|merch|cart|checkout|contact|about|faq|account|signin|signup)(?:\/|[?#]|$)/i,
            // Wix internal API endpoints (e.g. chunk-party.com/_api/...)
            '/_api/',
            // WordPress ?p=<digits> shortlinks (e.g. bearracuda.com/?p=8724)
            /[?&]p=\d+(?:[&#]|$)/,
            'googletagmanager.com', 'google-analytics.com', 'doubleclick.net',
            'analytics.google.com'
        ];
        const blockedHosts = [
            'facebook.com',
            'twitter.com',
            'x.com',
            'instagram.com',
            'youtube.com',
            'linkedin.com',
            'tiktok.com',
            'soundcloud.com',
            't.me',
            'telegram.me',
            'telegram.org',
            'whatsapp.com',
            'fonts.googleapis.com',
            'fonts.gstatic.com',
            'eventbritecareers.com',
            'eventbritestatus.com',
            'cdn.evbstatic.com',
            'img.evbuc.com',
            'w3.org',
            'dot.cards',
            'gmpg.org',
            'yoast.com',
            'api.w.org',
            'schema.org',
            'cocomo.dev',
            'wordpress.org',
            'elementor.com',
            'gravity.com',
            'crocoblock.com',
            'advancedcustomfields.com',
            'greengeeks.com',
            'trello.com',
            'wordfence.com',
            // Email newsletter / marketing services — not event pages
            'constantcontact.com',
            'mailchimp.com',
            'list-manage.com',
            'campaign-archive.com',
            'linksynergy.com',
            'calendar.google.com',
            'sellticketsapp.com',
            'wix.com',
            'wixapps.net',
            'wixevents.com',
            'wix-code.com',
            'wixpress.com',
            'wixstatic.com',
            'filesusr.com',
            'parastorage.com',
            'editorx.io',
            'sentry.io',
            'localhost',
            'samsclub.com',
            'fabfitfun.com',
            'pixieset.com',
            // Social media platforms not already listed above
            'bsky.app',
            'snapchat.com',
            // Affiliate / monetization tracking networks — never event pages
            'thanks.is',
            'kqzyfj.com',
            'sjv.io',
            'pxf.io',
            // Bot-walled ticketing sites — always return HTTP 401/403 to non-browser
            // clients, so crawling them only produces failure-cache entries
            'ticketmaster.com',
            'livenation.com',
            // External promotional / artist sites that are not event listing pages
            'jphardyofficial.com',
            'heymistr.com',
            'pinterest.com',
            'mixcloud.com',
            'light-tech.online',
            'rolloverfx.com',
            'armra.com',
            'camplife.com',
            'madbear.org',
            'cloudbeds.com'
        ];

        const lowerUrl = url.toLowerCase();
        if (lowerPath === '/empty' || lowerUrl.endsWith('/empty')) {
            return { valid: false, reason: 'empty-placeholder-url' };
        }
        const blockedPattern = invalidUrlPatterns.find(invalid => {
            if (invalid instanceof RegExp) return invalid.test(lowerUrl);
            return lowerUrl.includes(String(invalid || '').toLowerCase());
        });
        if (blockedPattern) {
            const blockedPatternReason = typeof blockedPattern === 'string'
                ? blockedPattern
                : blockedPattern.source;
            return { valid: false, reason: `blocked-pattern:${blockedPatternReason}` };
        }
        const hostname = String(parsedUrl.hostname || '').toLowerCase();
        if (this.isGoogleMapsUrl(parsedUrl)) return { valid: false, reason: 'google-maps-url' };
        const blockedHost = blockedHosts.find(host => hostname === host || hostname.endsWith(`.${host}`));
        if (blockedHost) return { valid: false, reason: `blocked-pattern:${blockedHost}` };
        // Per-config discovery blocked hosts (e.g. discoveryBlockedHosts: ["bearracuda.com"])
        const configBlockedHosts = Array.isArray(parserConfig.discoveryBlockedHosts) ? parserConfig.discoveryBlockedHosts : [];
        const configBlockedHost = configBlockedHosts.find(host => hostname === host.toLowerCase() || hostname.endsWith(`.${host.toLowerCase()}`));
        if (configBlockedHost) return { valid: false, reason: `config-blocked-host:${configBlockedHost}` };
        // Per-config discovery blocked patterns (global config.discoveryBlockedPatterns is
        // unioned in). Strings match as case-insensitive substrings; RegExp entries test
        // against the lowercased URL (same dual semantics as invalidUrlPatterns above),
        // which allows anchoring — e.g. /\/shop(\/|$)/ without swallowing "/shop-party".
        const configBlockedPatterns = Array.isArray(parserConfig.discoveryBlockedPatterns) ? parserConfig.discoveryBlockedPatterns : [];
        const configBlockedPattern = configBlockedPatterns.find(pattern => {
            if (pattern instanceof RegExp) return pattern.test(lowerUrl);
            if (typeof pattern !== 'string') return false;
            const normalizedPattern = pattern.trim().toLowerCase();
            if (!normalizedPattern) return false;
            return lowerUrl.includes(normalizedPattern);
        });
        if (configBlockedPattern) {
            const configBlockedPatternReason = typeof configBlockedPattern === 'string'
                ? configBlockedPattern
                : configBlockedPattern.source;
            return { valid: false, reason: `config-blocked-pattern:${configBlockedPatternReason}` };
        }
        const lowerSearch = String(parsedUrl.search || '').toLowerCase();
        if (/^\/(?:sharer(?:\.php)?|share(?:\/url)?|dialog\/send)$/i.test(lowerPath)) {
            return { valid: false, reason: 'share-endpoint-path' };
        }
        if (/^\/send$/i.test(lowerPath) && /(?:^|[?&])text=/.test(lowerSearch)) {
            return { valid: false, reason: 'share-endpoint-path' };
        }

        // For Eventbrite URLs, only allow /e/ (event detail) and /o/ (organizer) paths
        if (/eventbrite\./i.test(parsedUrl.hostname)) {
            const path = String(parsedUrl.pathname || '');
            if (!/^\/[eo]\//i.test(path)) {
                return { valid: false, reason: 'eventbrite-non-eo-path' };
            }
        }

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
        return this.config.normalizeUrl(url, baseUrl);
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

        // Scan both the raw HTML and the entity-decoded version so that URLs embedded
        // inside HTML-entity-encoded attributes (e.g. data-settings="...&quot;url&quot;:
        // &quot;https://sickening.events/...&quot;...") are correctly extracted.
        // In the raw HTML the &quot; sequences are not quote delimiters, so the pattern
        // [^\s"'<>\\] overshoots and produces a garbage URL that fails validation.
        // Decoding entities first restores the real " delimiters and lets the same
        // patterns stop at the right place.
        const htmlSources = [html];
        const decodedHtml = this.decodeBasicEntities(html);
        if (decodedHtml !== html) htmlSources.push(decodedHtml);

        for (const source of htmlSources) {
            for (const pattern of patterns) {
                for (const match of source.matchAll(pattern)) {
                    const candidate = this.truncateAtEncodedDelimiter(match[1] || match[0]);
                    if (candidate) candidates.add(candidate);
                }
            }
        }

        return Array.from(candidates);
    }

    // In the RAW (undecoded) scan the quote that ends an attribute value is
    // "&quot;" (or &#34;/&#39;/&lt;/…), which the bare-URL patterns treat as
    // URL characters — the candidate then bleeds past the attribute boundary
    // into the following markup (run 20260724-161423 captured
    // "…&destination=…98122\" target=\"_blank\">Get Directions…" this way, and
    // an image URL's "….webp&quot;" tail hid its extension from the
    // static-asset filter). Cut candidates at the first entity-encoded
    // delimiter so they stop at the same " / ' / whitespace / < boundaries the
    // literal characters already enforce; &amp; is NOT a delimiter and is
    // still decoded exactly once downstream (normalizeUrl).
    truncateAtEncodedDelimiter(candidate) {
        const text = String(candidate || '');
        if (text.indexOf('&') === -1) return text;
        const match = text.match(/&(?:quot|apos|lt|gt|#0*3[49]|#0*6[02]|#x0*2[27]|#x0*3[ce]);/i);
        return match ? text.slice(0, match.index) : text;
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

    extractUrlsFromScriptData(html, sourceUrl, diagnostics, pattern, patternName) {
        if (!html || !pattern) return [];
        const urls = [];
        const localDiagnostics = diagnostics && typeof diagnostics === 'object'
            ? diagnostics
            : null;
        let containersFound = [];
        let containersParsed = [];
        let parseErrors = [];

        const startMatch = html.match(pattern);
        if (!startMatch) {
            if (localDiagnostics && localDiagnostics.urlSamples !== undefined) {
                localDiagnostics.urlSamples = [];
            }
            return urls;
        }
        if (localDiagnostics) {
            if (Array.isArray(localDiagnostics.containersFound)) {
                containersFound = localDiagnostics.containersFound;
                containersParsed = localDiagnostics.containersParsed || [];
                parseErrors = localDiagnostics.parseErrors || [];
            }
            containersFound.push(patternName);
        }
        try {
            const startIndex = startMatch.index + startMatch[0].length;
            const jsonString = this.extractJsonObject(html, startIndex);
            if (!jsonString) {
                if (localDiagnostics && localDiagnostics.urlSamples !== undefined) {
                    localDiagnostics.urlSamples = [];
                }
                return urls;
            }
            const data = JSON.parse(jsonString);
            this.collectEventUrlsFromDataObject(data, sourceUrl, urls, new Set(), 0);
            const fallbackUrls = this.extractLikelyEventUrlsFromSerializedJson(jsonString, sourceUrl);
            fallbackUrls.forEach(url => urls.push(url));
            if (localDiagnostics) {
                containersParsed.push(patternName);
                if (Array.isArray(localDiagnostics.parseErrors)) {
                    parseErrors.push(`${patternName}:${this.trimToMaxLength(String(jsonString), 120)}`);
                }
            }
        } catch (error) {
            console.warn(`🤖 AI Web: Error extracting URLs from ${patternName}: ${error}`);
            if (localDiagnostics && Array.isArray(localDiagnostics.parseErrors)) {
                parseErrors.push(`${patternName}:${this.trimToMaxLength(String(error), 120)}`);
            }
        }
        if (localDiagnostics) {
            if (Array.isArray(localDiagnostics.containersFound)) {
                localDiagnostics.containersFound = containersFound;
                localDiagnostics.containersParsed = containersParsed;
                localDiagnostics.parseErrors = parseErrors;
            }
            if (localDiagnostics.regexFallbackCandidates !== undefined) {
                localDiagnostics.regexFallbackCandidates = fallbackUrls.length;
            }
            if (localDiagnostics.urlSamples !== undefined) {
                localDiagnostics.urlSamples = urls.slice(0, 5).map(url => this.trimToMaxLength(url, 140));
            }
        }
        return urls;
    }

    extractUrlsFromServerData(html, sourceUrl, diagnostics = null) {
        if (!html) return [];
        const urls = [];
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
            const patternUrls = this.extractUrlsFromScriptData(
                html, sourceUrl, diagnostics, patternEntry.regex, patternEntry.name
            );
            patternUrls.forEach(url => urls.push(url));
        }
        return urls;
    }

    extractUrlsFromNextData(html, sourceUrl, diagnostics = null) {
        if (!html) return [];
        const pattern = /<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
        const patternName = '__NEXT_DATA__';
        return this.extractUrlsFromScriptData(html, sourceUrl, diagnostics, pattern, patternName);
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
        const jsonLd = discoveryStats.jsonLdDiagnostics || {};
        const serverData = discoveryStats.serverDataDiagnostics || {};
        const nextData = discoveryStats.nextDataDiagnostics || {};
        const entries = [];

        if (Object.keys(jsonLd).length > 0) {
            entries.push(['jsonLd', {
                scriptsFound: jsonLd.scriptsFound || 0,
                parsed: jsonLd.scriptsParsed || 0,
                parseErrors: jsonLd.parseErrors || 0,
                candidates: discoveryStats.jsonLdCandidates || 0,
                samples: (jsonLd.urlSamples || []).join(' | ') || 'none',
                scriptSamples: (jsonLd.scriptSamples || []).join(' | ') || 'none'
            }]);
        }
        if (Object.keys(serverData).length > 0) {
            entries.push(['serverData', {
                found: (serverData.containersFound || []).join(',') || 'none',
                parsed: (serverData.containersParsed || []).join(',') || 'none',
                parseErrors: (serverData.parseErrors || []).join(' | ') || 'none',
                regexFallbackCandidates: serverData.regexFallbackCandidates || 0,
                candidates: discoveryStats.serverDataCandidates || 0,
                samples: (serverData.urlSamples || []).join(' | ') || 'none'
            }]);
        }
        if (Object.keys(nextData).length > 0) {
            entries.push(['nextData', {
                found: nextData.found ? 'yes' : 'no',
                parsed: nextData.parsed ? 'yes' : 'no',
                parseError: nextData.parseError || 'none',
                regexFallbackCandidates: nextData.regexFallbackCandidates || 0,
                candidates: discoveryStats.nextDataCandidates || 0,
                samples: (nextData.urlSamples || []).join(' | ') || 'none',
                scriptSample: nextData.scriptSample || 'none'
            }]);
        }
        return entries.map(([label, data]) => `${label}{${this.formatDiagnosticsPairs(data)}}`).join('; ');
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
        return this.escapeJsonControlCharacters(rawSubstring);
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

    async getAiEvent(htmlData, parserConfig, cityConfig, selectedPromptFields = null, dataFlags = {}, httpAdapter = null) {
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
            : this.getAiPromptFields(parserConfig, dataFlags, htmlData.url || '');
        if (promptFields.length === 0) {
            console.warn('🤖 AI Web: No eligible AI prompt fields configured - skipping extraction');
            return null;
        }
        this.logDebug(`🤖 AI Web: Prompt fields selected (${promptFields.length}): ${promptFields.join(', ')}`);
        console.log(`🤖 AI Web: Running AI extraction for ${htmlData.url || 'unknown URL'} (${promptFields.length} field${promptFields.length === 1 ? '' : 's'})`);
        const extracted = await this.extractEventWithAiStrategy(htmlData, aiConfig, cityConfig, parserConfig, promptFields, httpAdapter);
        if (!extracted || typeof extracted !== 'object') {
            return extracted;
        }
        const promptHistory = this.consumeAiPromptHistory();
        if (promptHistory.length > 0) {
            extracted.__aiPrompts = promptHistory;
        }
        return extracted;
    }

    recordAiPrompt(prompt, passLabel, aiConfig = {}) {
        if (!prompt) return;
        const normalizedPassLabel = String(passLabel || 'extraction').trim() || 'extraction';
        this.aiPromptHistory.push({
            pass: normalizedPassLabel,
            model: String(aiConfig.model || ''),
            endpoint: String(aiConfig.endpoint || ''),
            chars: prompt.length,
            prompt: String(prompt)
        });
    }

    consumeAiPromptHistory() {
        if (!Array.isArray(this.aiPromptHistory) || this.aiPromptHistory.length === 0) {
            this.aiPromptHistory = [];
            return [];
        }
        const prompts = this.aiPromptHistory
            .map(entry => {
                if (!entry || typeof entry !== 'object') return null;
                const promptText = String(entry.prompt || '');
                if (!promptText) return null;
                return {
                    pass: String(entry.pass || 'extraction'),
                    model: String(entry.model || ''),
                    endpoint: String(entry.endpoint || ''),
                    chars: Number.isFinite(Number(entry.chars)) ? Number(entry.chars) : promptText.length,
                    prompt: promptText
                };
            })
            .filter(Boolean);
        this.aiPromptHistory = [];
        return prompts;
    }

    // AI config resolution lives in SharedCore (resolveAiConfig) so the merge
    // arbitration path can build the same config without reaching into the parser.
    getAiConfig(parserConfig = {}) {
        const rawAi = parserConfig && typeof parserConfig.ai === 'object' ? parserConfig.ai : {};
        return this.core.resolveAiConfig(rawAi);
    }

    getOcrConfig(parserConfig = {}, aiConfig = null) {
        const baseAiConfig = aiConfig && typeof aiConfig === 'object' ? aiConfig : this.getAiConfig(parserConfig);
        const parserAiConfig = parserConfig && parserConfig.ai && typeof parserConfig.ai === 'object'
            ? parserConfig.ai
            : {};
        // Canonical location is parserConfig.ai.ocr; accept a top-level parserConfig.ocr
        // as fallback so a mis-nested block configures OCR instead of being silently ignored.
        const rawOcr = parserAiConfig.ocr && typeof parserAiConfig.ocr === 'object'
            ? parserAiConfig.ocr
            : (parserConfig && parserConfig.ocr && typeof parserConfig.ocr === 'object' ? parserConfig.ocr : {});
        const maxImages = Number.isFinite(Number(rawOcr.maxImages))
            ? Math.max(1, Math.min(4, Math.floor(Number(rawOcr.maxImages))))
            : 2;
        const maxTextChars = Number.isFinite(Number(rawOcr.maxTextChars))
            ? Math.max(250, Math.floor(Number(rawOcr.maxTextChars)))
            : 4000;
        // Concurrent vision requests contend for the same local GPU and push each other
        // into timeouts, so requests are serialized by default.
        const maxConcurrentRequests = Number.isFinite(Number(rawOcr.concurrency))
            ? Math.max(1, Math.min(4, Math.floor(Number(rawOcr.concurrency))))
            : 1;
        const ocrConfigTemplate = {
            timeoutSeconds: this.defaultOcrRequestConfig.timeoutSeconds,
            keepAlive: this.defaultOcrRequestConfig.keepAlive,
            numCtx: this.defaultOcrRequestConfig.numCtx,
            numPredict: this.defaultOcrRequestConfig.numPredict,
            temperature: this.defaultOcrRequestConfig.temperature,
            think: this.defaultOcrRequestConfig.think
        };
        // Default provider is the rybook rapid-mlx vision server — desktop
        // ollama is explicit opt-in only (provider: "ollama").
        const provider = String(rawOcr.provider || 'openai');

        let defaultEndpoint;
        if (provider === 'openai') {
            // Port 8001 is the VISION (VLM) server; 8000 serves the text/coder
            // model and rejects image input.
            defaultEndpoint = 'http://rybook.taila7523c.ts.net:8001/v1/chat/completions';
        } else {
            // If the base AI config is also ollama, inherit its endpoint so custom endpoints aren't lost
            defaultEndpoint = baseAiConfig.provider === 'ollama' && baseAiConfig.endpoint
                ? baseAiConfig.endpoint
                : 'http://desktop.taila7523c.ts.net:11434/api/generate';
        }

        // OCR requires a VISION model. OpenAI-compatible servers (rapid-mlx) reject image
        // content on text models ("Model ... does not support image, video, or audio inputs"),
        // so never default to the text/coder model used for extraction.
        const defaultModel = provider === 'openai'
            ? 'mlx-community/Qwen3-VL-4B-Instruct-4bit'
            : this.defaultOcrModel;

        return {
            enabled: rawOcr.enabled !== false,
            provider: provider,
            endpoint: String(rawOcr.endpoint || defaultEndpoint),
            model: String(rawOcr.model || defaultModel),
            prompt: String(rawOcr.prompt || this.defaultOcrPrompt),
            ...Object.fromEntries(
                Object.entries(ocrConfigTemplate).map(([key, defaultValue]) => [
                    key,
                    Number.isFinite(Number(rawOcr[key])) ? Number(rawOcr[key]) : defaultValue
                ])
            ),
            maxImages,
            maxTextChars,
            maxConcurrentRequests,
            cacheEnabled: rawOcr.cache !== false,
            requireMissingFields: rawOcr.requireMissingFields !== false,
            ollama: rawOcr.ollama && typeof rawOcr.ollama === 'object' ? rawOcr.ollama : (baseAiConfig.ollama || {}),
            openai: rawOcr.openai && typeof rawOcr.openai === 'object' ? rawOcr.openai : (baseAiConfig.openai || {})
        };
    }

    normalizePayloadMode(mode) {
        return this.core.normalizePayloadMode(mode);
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

    normalizeConfidencePartition(partition) {
        const normalized = String(partition || '').trim().toLowerCase();
        if (normalized === 'jsonld' || normalized === 'meta' || normalized === 'content' || normalized === 'mixed') {
            return normalized;
        }
        return 'unknown';
    }

    normalizeConfidencePartitionList(partitions, fallback = []) {
        const source = Array.isArray(partitions) ? partitions : fallback;
        const normalized = source
            .map(partition => this.normalizeConfidencePartition(partition))
            .filter(partition => partition === 'jsonld' || partition === 'meta' || partition === 'content');
        return Array.from(new Set(normalized));
    }

    getAiConfidenceRuntimeConfig(parserConfig = {}) {
        const aiConfig = parserConfig && parserConfig.ai && typeof parserConfig.ai === 'object'
            ? parserConfig.ai
            : {};
        const confidence = aiConfig.confidence && typeof aiConfig.confidence === 'object'
            ? aiConfig.confidence
            : {};
        return {
            maxRetryCycles: Number.isFinite(Number(confidence.maxRetryCycles))
                ? Math.max(0, Math.min(3, Number(confidence.maxRetryCycles)))
                : 1,
            maxRetryPasses: Number.isFinite(Number(confidence.maxRetryPasses))
                ? Math.max(0, Math.min(12, Number(confidence.maxRetryPasses)))
                : 6
        };
    }

    getGlobalFieldExpectations(promptFields = []) {
        const defaults = {};
        const normalizedFields = Array.from(
            new Set((Array.isArray(promptFields) ? promptFields : []).map(field => this.normalizePromptFieldName(field)).filter(Boolean))
        );
        normalizedFields.forEach(field => {
            const expected = this.normalizeConfidencePartitionList(
                null,
                ['content']
            );
            const strong = this.normalizeConfidencePartitionList(
                null,
                expected
            );
            defaults[field] = {
                expected,
                strong,
                applied: [{
                    source: 'global-defaults',
                    expected: [...expected],
                    strong: [...strong]
                }]
            };
        });
        return defaults;
    }

    normalizeFieldExpectationRule(rawRule, currentRule = null) {
        const fallbackExpected = currentRule && Array.isArray(currentRule.expected) ? currentRule.expected : [];
        const fallbackStrong = currentRule && Array.isArray(currentRule.strong) ? currentRule.strong : fallbackExpected;
        if (Array.isArray(rawRule)) {
            const expected = this.normalizeConfidencePartitionList(rawRule, fallbackExpected);
            return {
                expected,
                strong: expected
            };
        }
        if (!rawRule || typeof rawRule !== 'object') {
            return {
                expected: [...fallbackExpected],
                strong: [...fallbackStrong]
            };
        }
        const expected = this.normalizeConfidencePartitionList(rawRule.expected, fallbackExpected);
        const strong = this.normalizeConfidencePartitionList(rawRule.strong, expected);
        return {
            expected,
            strong
        };
    }

    matchesConfidenceUrlPattern(patternEntry, sourceUrl) {
        const url = String(sourceUrl || '');
        if (!url || !patternEntry || typeof patternEntry !== 'object') return false;
        const contains = String(patternEntry.contains || '').trim();
        if (contains && url.includes(contains)) return true;
        const patternText = String(patternEntry.pattern || patternEntry.regex || '').trim();
        if (!patternText) return false;
        try {
            const flags = String(patternEntry.flags || patternEntry.regexFlags || 'i').trim() || 'i';
            const regex = new RegExp(patternText, flags);
            return regex.test(url);
        } catch (_) {
            return url.includes(patternText);
        }
    }

    normalizeConfidenceExpectationFieldMap(rawFields) {
        const source = rawFields && typeof rawFields === 'object' ? rawFields : {};
        const normalized = {};
        Object.keys(source).forEach(fieldName => {
            const normalizedField = this.normalizePromptFieldName(fieldName);
            if (!normalizedField) return;
            normalized[normalizedField] = source[fieldName];
        });
        return normalized;
    }

    getAiConfidenceExpectations(parserConfig = {}, sourceUrl = '', promptFields = []) {
        const aiConfig = parserConfig && parserConfig.ai && typeof parserConfig.ai === 'object'
            ? parserConfig.ai
            : {};
        const confidence = aiConfig.confidence && typeof aiConfig.confidence === 'object'
            ? aiConfig.confidence
            : {};
        const rootExpectations = confidence.expectations && typeof confidence.expectations === 'object'
            ? confidence.expectations
            : (aiConfig.expectations && typeof aiConfig.expectations === 'object'
                ? aiConfig.expectations
                : {});
        const parserDefaultsRaw = rootExpectations.fields && typeof rootExpectations.fields === 'object'
            ? rootExpectations.fields
            : {};
        const parserDefaults = this.normalizeConfidenceExpectationFieldMap(parserDefaultsRaw);
        const urlPatternOverrides = Array.isArray(rootExpectations.urlPatterns)
            ? rootExpectations.urlPatterns
            : [];
        const normalizedFields = Array.from(
            new Set((Array.isArray(promptFields) ? promptFields : []).map(field => this.normalizePromptFieldName(field)).filter(Boolean))
        );
        const expectationMap = this.getGlobalFieldExpectations(normalizedFields);
        const matchedOverrides = urlPatternOverrides
            .filter(entry => this.matchesConfidenceUrlPattern(entry, sourceUrl))
            .map(entry => {
                const patternLabel = String(entry.pattern || entry.regex || entry.contains || '').trim() || 'unknown-pattern';
                return {
                    source: `url-pattern:${patternLabel}`,
                    fields: this.normalizeConfidenceExpectationFieldMap(
                        entry.fields && typeof entry.fields === 'object' ? entry.fields : {}
                    )
                };
            });

        normalizedFields.forEach(field => {
            const current = expectationMap[field] || {
                expected: [],
                strong: [],
                applied: []
            };
            const parserRuleRaw = Object.prototype.hasOwnProperty.call(parserDefaults, field)
                ? parserDefaults[field]
                : null;
            if (parserRuleRaw !== null) {
                const parserRule = this.normalizeFieldExpectationRule(parserRuleRaw, current);
                current.expected = parserRule.expected;
                current.strong = parserRule.strong;
                current.applied.push({
                    source: 'parser-defaults',
                    expected: [...parserRule.expected],
                    strong: [...parserRule.strong]
                });
            }
            matchedOverrides.forEach(override => {
                if (!Object.prototype.hasOwnProperty.call(override.fields, field)) return;
                const overrideRule = this.normalizeFieldExpectationRule(override.fields[field], current);
                current.expected = overrideRule.expected;
                current.strong = overrideRule.strong;
                current.applied.push({
                    source: override.source,
                    expected: [...overrideRule.expected],
                    strong: [...overrideRule.strong]
                });
            });
            expectationMap[field] = current;
        });

        return expectationMap;
    }

    getPartitionSectionMap(sectionBundle) {
        return {
            jsonld: sectionBundle && sectionBundle.jsonLd ? [sectionBundle.jsonLd] : [],
            meta: sectionBundle && sectionBundle.metaPrimary ? [sectionBundle.metaPrimary] : [],
            content: sectionBundle && sectionBundle.content ? [sectionBundle.content] : []
        };
    }

    getPartitionSourceText(sectionBundle) {
        const partitionSections = this.getPartitionSectionMap(sectionBundle);
        const partitionText = {};
        Object.keys(partitionSections).forEach(partition => {
            partitionText[partition] = partitionSections[partition]
                .map(section => this.sectionToText(section))
                .filter(Boolean)
                .join('\n\n');
        });
        return partitionText;
    }

    getPartitionStrengths(sectionBundle) {
        const contentLineCount = sectionBundle && sectionBundle.content && Array.isArray(sectionBundle.content.lines)
            ? sectionBundle.content.lines.length
            : 0;
        return {
            jsonld: sectionBundle && sectionBundle.jsonLd
                ? this.isSnippetSourceFull(sectionBundle.jsonLdScore, this.extractionLimits.jsonLdFullnessMinSignals)
                : false,
            meta: sectionBundle && sectionBundle.metaPrimary
                ? this.isSnippetSourceFull(sectionBundle.metaScore, this.extractionLimits.metaFullnessMinSignals)
                : false,
            content: contentLineCount >= 20
        };
    }

    getFieldSignalRegexes(normalizedField) {
        const compiledRegexes = [];
        const addRegex = patternText => {
            const normalizedPattern = String(patternText || '').trim();
            if (!normalizedPattern) return;
            try {
                compiledRegexes.push(new RegExp(normalizedPattern, 'i'));
            } catch (error) {
                if (!this.invalidFieldSignalPatternWarnings.has(normalizedPattern)) {
                    this.invalidFieldSignalPatternWarnings.add(normalizedPattern);
                    console.warn('🤖 AI Web: Invalid EventSchema AI field signal regex pattern skipped', {
                        pattern: normalizedPattern,
                        error: error && error.message ? error.message : String(error || '')
                    });
                }
            }
        };

        const configuredPatterns = this.getEventSchemaFieldSignalRegexes(normalizedField);
        configuredPatterns.forEach(addRegex);
        addRegex(`\\b${this.escapeRegex(normalizedField)}\\b`);
        return compiledRegexes;
    }

    detectFieldSignalInText(normalizedField, text) {
        const sourceText = String(text || '');
        if (!sourceText) return false;
        const regexes = this.getFieldSignalRegexes(normalizedField);
        return regexes.some(regex => regex.test(sourceText));
    }

    collectPartitionFieldSignals(sectionBundle, promptFields = []) {
        const partitionText = this.getPartitionSourceText(sectionBundle);
        const normalizedFields = Array.from(
            new Set((Array.isArray(promptFields) ? promptFields : []).map(field => this.normalizePromptFieldName(field)).filter(Boolean))
        );
        const signals = {};
        normalizedFields.forEach(field => {
            signals[field] = {
                jsonld: this.detectFieldSignalInText(field, partitionText.jsonld),
                meta: this.detectFieldSignalInText(field, partitionText.meta),
                content: this.detectFieldSignalInText(field, partitionText.content)
            };
        });
        return signals;
    }

    buildPartitionStatusesForField(fieldSignals = {}, expectation = {}) {
        const expected = new Set(Array.isArray(expectation.expected) ? expectation.expected : []);
        const statuses = {};
        ['jsonld', 'meta', 'content'].forEach(partition => {
            const observed = Boolean(fieldSignals[partition]);
            if (expected.has(partition) && observed) {
                statuses[partition] = 'expected-and-found';
            } else if (expected.has(partition) && !observed) {
                statuses[partition] = 'expected-but-missing';
            } else if (!expected.has(partition) && observed) {
                statuses[partition] = 'found-without-expectation';
            } else {
                statuses[partition] = 'not-expected';
            }
        });
        return statuses;
    }

    evaluateFieldConfidence(fieldName, statuses, extractionSource, extracted, expectation, partitionStrengths) {
        const expectedSet = new Set(Array.isArray(expectation.expected) ? expectation.expected : []);
        const strongSet = new Set(Array.isArray(expectation.strong) ? expectation.strong : []);
        const sourcePartition = this.normalizeConfidencePartition(extractionSource);
        if (extracted) {
            if (expectedSet.has(sourcePartition)) {
                return {
                    level: 'high',
                    reason: 'expected-source-produced-validated-value',
                    sourcePartition
                };
            }
            return {
                level: 'medium',
                reason: sourcePartition === 'mixed'
                    ? 'validated-value-from-mixed-source'
                    : 'validated-value-from-non-expected-source',
                sourcePartition
            };
        }

        const retryCandidates = [];
        ['jsonld', 'meta', 'content'].forEach(partition => {
            if (!expectedSet.has(partition)) return;
            if (!strongSet.has(partition)) return;
            if (!partitionStrengths[partition]) return;
            if (statuses[partition] !== 'expected-and-found') return;
            retryCandidates.push(partition);
        });
        if (retryCandidates.length > 0) {
            return {
                level: 'low',
                reason: 'expected-strong-signal-missing-validated-value',
                sourcePartition: null,
                retryCandidates
            };
        }

        return {
            level: 'low',
            reason: 'no-validated-value',
            sourcePartition: null
        };
    }

    buildConfidenceDiagnostics(sectionBundle, promptFields, parserConfig, htmlData, mergedEvent, extractionTrace) {
        const normalizedFields = Array.from(
            new Set((Array.isArray(promptFields) ? promptFields : []).map(field => this.normalizePromptFieldName(field)).filter(Boolean))
        );
        const sourceUrl = htmlData && typeof htmlData.url === 'string' ? htmlData.url : '';
        const fieldSignals = this.collectPartitionFieldSignals(sectionBundle, normalizedFields);
        const expectations = this.getAiConfidenceExpectations(parserConfig, sourceUrl, normalizedFields);
        const partitionStrengths = this.getPartitionStrengths(sectionBundle);
        const extractionSources = extractionTrace && extractionTrace.fieldSources && typeof extractionTrace.fieldSources === 'object'
            ? extractionTrace.fieldSources
            : {};

        const partitionStatuses = {};
        const fieldConfidence = {};
        const resolvedFields = [];
        const missingFields = [];

        normalizedFields.forEach(field => {
            const extracted = this.hasResolvedFieldValue(mergedEvent, field);
            if (extracted) resolvedFields.push(field);
            else missingFields.push(field);
            const expectation = expectations[field] || { expected: [], strong: [], applied: [] };
            const statuses = this.buildPartitionStatusesForField(fieldSignals[field] || {}, expectation);
            partitionStatuses[field] = statuses;
            fieldConfidence[field] = this.evaluateFieldConfidence(
                field,
                statuses,
                extractionSources[field] && extractionSources[field].partition,
                extracted,
                expectation,
                partitionStrengths
            );
        });

        return {
            version: 1,
            partitionStrengths,
            observedSignals: fieldSignals,
            expectedSignals: Object.fromEntries(
                normalizedFields.map(field => [field, {
                    expected: expectations[field] && Array.isArray(expectations[field].expected) ? expectations[field].expected : [],
                    strong: expectations[field] && Array.isArray(expectations[field].strong) ? expectations[field].strong : [],
                    applied: expectations[field] && Array.isArray(expectations[field].applied) ? expectations[field].applied : []
                }])
            ),
            partitionStatuses,
            fieldConfidence,
            extractionOutcome: {
                resolvedFields: Array.from(new Set(resolvedFields)),
                missingFields: Array.from(new Set(missingFields)),
                fieldSources: extractionSources
            },
            parserConfig,
            sourceUrl,
            retry: {
                decisions: [],
                summary: {
                    cycles: 0,
                    passes: 0,
                    attempted: 0,
                    recoveredFields: []
                }
            }
        };
    }

    planConfidenceRetries(confidenceDiagnostics, promptFields = []) {
        if (!confidenceDiagnostics || typeof confidenceDiagnostics !== 'object') {
            return [];
        }
        const confidenceByField = confidenceDiagnostics.fieldConfidence && typeof confidenceDiagnostics.fieldConfidence === 'object'
            ? confidenceDiagnostics.fieldConfidence
            : {};
        // Reuse expectedSignals from buildConfidenceDiagnostics to avoid redundant expectations lookup
        const expectations = confidenceDiagnostics.expectedSignals || {};
        const grouped = {
            jsonld: new Set(),
            meta: new Set(),
            content: new Set()
        };
        let excludedLocation = false;
        Object.keys(confidenceByField).forEach(field => {
            const confidence = confidenceByField[field];
            const expectation = expectations[field] || { expected: [], strong: [] };
            const hasContentExpected = expectation.expected && expectation.expected.includes('content');
            if (!confidence || confidence.level !== 'low') return;
            // Never retry location (coordinates): across production runs the
            // retry pass never legitimately recovered coordinates — the model
            // fabricated them from the street address every time and the
            // evidence gate dropped them. Main extraction passes still request
            // location (a page could legitimately embed coordinates).
            if (field === 'location') {
                if (confidence.retryCandidates?.length || hasContentExpected) excludedLocation = true;
                return;
            }
            if (!confidence.retryCandidates?.length) {
                // No retry candidates - if content is expected, add to content since OCR content might still have the field
                if (hasContentExpected && grouped.content !== undefined) {
                    grouped.content.add(field);
                }
            } else {
                // Has retry candidates - use existing logic
                confidence.retryCandidates.forEach(partition => {
                    if (!grouped[partition]) return;
                    grouped[partition].add(field);
                });
            }
        });
        if (excludedLocation) {
            console.log('🤖 AI Web: Skipping location in confidence retry — never legitimately recovered on retry');
        }
        return ['jsonld', 'meta', 'content']
            .map(partition => ({
                partition,
                fields: Array.from(grouped[partition])
            }))
            .filter(entry => entry.fields.length > 0);
    }

    getSectionsForPartition(sectionBundle, partition) {
        const normalized = this.normalizeConfidencePartition(partition);
        if (normalized === 'jsonld') return sectionBundle && sectionBundle.jsonLd ? [sectionBundle.jsonLd] : [];
        if (normalized === 'meta') return sectionBundle && sectionBundle.metaPrimary ? [sectionBundle.metaPrimary] : [];
        if (normalized === 'content') return sectionBundle && sectionBundle.content ? [sectionBundle.content] : [];
        return [];
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

    isInternalAiFieldKey(key) {
        return String(key || '').startsWith('__');
    }

    getRemainingPromptFields(fields, aiEvent) {
        const requestedFields = Array.isArray(fields) ? fields : [];
        return requestedFields.filter(field => !this.hasResolvedFieldValue(aiEvent, this.normalizePromptFieldName(field)));
    }

    mergeAiEventFields(currentEvent, nextEvent) {
        const merged = currentEvent && typeof currentEvent === 'object' ? { ...currentEvent } : {};
        if (!nextEvent || typeof nextEvent !== 'object') return merged;
        const schema = this.getEventSchema();
        Object.keys(nextEvent).forEach(key => {
            const value = nextEvent[key];
            // Weekday-pin flags from different passes cover different date fields
            // (e.g. startDate from one pass, endDate from a retry) — union them
            // instead of letting the first pass's flags shadow later ones.
            if (key === '__weekdayPinnedYears' && value && typeof value === 'object') {
                merged.__weekdayPinnedYears = {
                    ...(merged.__weekdayPinnedYears && typeof merged.__weekdayPinnedYears === 'object' ? merged.__weekdayPinnedYears : {}),
                    ...value
                };
                return;
            }
            // Per-field model evidence strings (see parseAndFilterConfidence): union
            // across passes like the pin flags — each pass's evidence covers the
            // fields that pass extracted. Consumed by the evidence gate at pass time;
            // harmless (and internal-only) afterwards.
            if (key === '__fieldEvidence' && value && typeof value === 'object') {
                merged.__fieldEvidence = {
                    ...(merged.__fieldEvidence && typeof merged.__fieldEvidence === 'object' ? merged.__fieldEvidence : {}),
                    ...value
                };
                return;
            }
            // Evidence-pointer rescue memos (LOG-ONLY observation) concatenate
            // across passes in order — every candidate is surfaced.
            if (key === '__evidenceRescues' && Array.isArray(value)) {
                merged.__evidenceRescues = (Array.isArray(merged.__evidenceRescues) ? merged.__evidenceRescues : [])
                    .concat(value);
                return;
            }
            // Dropped-value memos union across passes like the evidence strings
            // above, except EARLIER passes win (the first drop is the one the
            // page-location cross-check anchors on).
            if (key === '__droppedFieldValues' && value && typeof value === 'object') {
                merged.__droppedFieldValues = {
                    ...value,
                    ...(merged.__droppedFieldValues && typeof merged.__droppedFieldValues === 'object' ? merged.__droppedFieldValues : {})
                };
                return;
            }
            // The parallel reason memo follows the same earlier-passes-win
            // union so a field's reason always describes its recorded value.
            if (key === '__droppedFieldReasons' && value && typeof value === 'object') {
                merged.__droppedFieldReasons = {
                    ...value,
                    ...(merged.__droppedFieldReasons && typeof merged.__droppedFieldReasons === 'object' ? merged.__droppedFieldReasons : {})
                };
                return;
            }
            if (!this.isUsableAiFieldValue(value)) return;
            const normalizedName = this.normalizePromptFieldName(key);
            if (this.hasResolvedFieldValue(merged, normalizedName)) return;
            // Retry passes prompt with lowercased field names ("startdate") and the model echoes
            // them back; store under the canonical schema key so downstream readers that expect
            // camelCase (normalizeAiEvent) still find the value when the primary pass failed.
            let targetKey = key;
            if (!key.startsWith('__') && schema && typeof schema.canonicalizeEventKey === 'function') {
                const lowered = String(key).trim().toLowerCase();
                const canonical = schema.canonicalizeEventKey(lowered);
                if (canonical && canonical !== lowered) {
                    targetKey = canonical;
                }
            }
            merged[targetKey] = value;
        });
        return merged;
    }

    // Per-pass organizer-brand / site-tagline guard. Values rejected here never
    // enter the accumulated event, so the field stays in later passes' request
    // lists. Deliberately narrow:
    // - bar: rejected when it matches a page brand name (same test as the
    //   normalizeAiEvent backstop).
    // - title: rejected ONLY when the WHOLE title is a brand name — a title
    //   merely containing the brand ("Provincetown⚓ | BEARRACUDA") is kept;
    //   the suffix strip happens at the end (stripPageBrandFromTitle).
    // - description: rejected ONLY when exactly equal (trimmed, whitespace-
    //   collapsed, case-insensitive) to the site's own JSON-LD
    //   WebSite.description. No fuzzy matching — genuine event taglines must
    //   never be dropped.
    rejectBrandLikePassFields(partial, htmlData, passLabel = '') {
        if (!partial || typeof partial !== 'object') return partial;
        const brandNames = this.getPageBrandNames(htmlData);
        const siteTaglines = this.getPageSiteTaglines(htmlData);
        if (brandNames.length === 0 && siteTaglines.length === 0) return partial;
        const guarded = { ...partial };
        const passName = String(passLabel || '').trim() || 'extraction';
        Object.keys(guarded).forEach(key => {
            if (this.isInternalAiFieldKey(key)) return;
            const value = guarded[key];
            if (typeof value !== 'string' || !value.trim()) return;
            const normalizedField = this.normalizePromptFieldName(key);
            // On a venue's own site the brand IS the venue — a bar equal to
            // the site name is the correct answer there, never a leak.
            if (normalizedField === 'bar' && brandNames.length > 0
                && this.getPageSiteRole(htmlData) !== 'venue'
                && this.matchesPageBrandName(value, brandNames)) {
                console.log(`🤖 AI Web: Rejecting bar "${value}" from ${passName} pass — matches page organizer/brand; keeping field open for later passes`);
                delete guarded[key];
                return;
            }
            if (normalizedField === 'title' && brandNames.length > 0 && this.matchesPageBrandName(value, brandNames)) {
                console.log(`🤖 AI Web: Rejecting title "${value}" from ${passName} pass — the whole title is the page organizer/brand; keeping field open for later passes`);
                delete guarded[key];
                return;
            }
            if (normalizedField === 'description' && this.matchesSiteTagline(value, siteTaglines)) {
                console.log(`🤖 AI Web: Rejecting description from ${passName} pass — identical to the site's own tagline, not event-specific`);
                delete guarded[key];
            }
        });
        return guarded;
    }

    // A jsonld extraction pass on a page whose JSON-LD carries no Event-typed node
    // (WebPage/ImageObject/BreadcrumbList/Organization boilerplate) is a wasted AI
    // request — the model has nothing to extract and returns {}. Detect Event-typed
    // nodes (any @type containing "Event", schema.org URL prefixes included) over the
    // same extractJsonLdParts output the jsonld pass would send, and cache the
    // determination on htmlData (like getPageBrandNames) so re-parses are free.
    // Pages WITH Event nodes keep today's behavior exactly: the deterministic
    // JSON-LD path may not have fully extracted them, so the AI pass still runs.
    pageHasEventTypedJsonLd(htmlData) {
        if (!htmlData || typeof htmlData !== 'object') return false;
        if (typeof htmlData.hasEventTypedJsonLd === 'boolean') return htmlData.hasEventTypedJsonLd;
        const html = typeof htmlData.html === 'string' ? htmlData.html : '';
        const result = this.extractJsonLdParts(String(html).slice(0, 500000))
            .some(part => this.containsEventType(part));
        if (Object.isExtensible(htmlData)) {
            htmlData.hasEventTypedJsonLd = result;
        }
        return result;
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

    // === Main: Extract Fields Across Multiple Snippets ===

    async extractFieldsAcrossSnippets(htmlData, aiConfig, cityConfig, parserConfig, fields, snippets, passLabelPrefix, validationState = null, options = {}, httpAdapter = null) {
        // === STEP 1: Setup ===
        let merged = {};
        const promptFields = Array.isArray(fields) ? fields : [];
        const promptSnippets = Array.isArray(snippets) ? snippets.filter(Boolean) : [];
        const extractionTrace = options && options.extractionTrace && typeof options.extractionTrace === 'object'
            ? options.extractionTrace
            : { fieldSources: {} };
        if (extractionTrace && (!extractionTrace.fieldSources || typeof extractionTrace.fieldSources !== 'object')) {
            extractionTrace.fieldSources = {};
        }
        if (validationState && !(validationState.validatedFields instanceof Set)) {
            validationState.validatedFields = new Set();
        }
        const dataFlags = options && options.dataFlags && typeof options.dataFlags === 'object' ? options.dataFlags : {};

        // === STEP 2: Process Each Snippet ===
        for (let index = 0; index < promptSnippets.length; index++) {
            const remainingFields = this.getRemainingPromptFields(promptFields, merged);
            if (remainingFields.length === 0) break; // All fields extracted

            const snippetText = String(promptSnippets[index] || '');
            const passLabel = `${passLabelPrefix} ${index + 1}/${promptSnippets.length}`.trim();

            // === Build Evidence Context ===
            // We use the snippet text directly as evidence - this is what we sent to the AI
            const snippetEvidenceContext = this.buildAiEvidenceContextFromText(snippetText);
            const snippetImageEvidence = this.buildImageEvidenceContextFromText(snippetText, htmlData && typeof htmlData.url === 'string' ? htmlData.url : '');

            // === Include OCR Evidence if Available ===
            // OCR results are attached to htmlData.ocrResults and should be included in evidence
            const ocrResults = htmlData && htmlData.ocrResults;
            if (ocrResults && ocrResults.length > 0) {
                const ocrLines = [];
                const seenOcrUrls = new Set();
                for (const ocrResult of ocrResults) {
                    if (!ocrResult || !ocrResult.url) continue;
                    const normalizedUrl = this.normalizeHttpUrlValue(ocrResult.url);
                    if (!normalizedUrl || seenOcrUrls.has(normalizedUrl)) continue;
                    seenOcrUrls.add(normalizedUrl);
                    const ocrSnippet = this.buildOcrSnippet(ocrResult.url, ocrResult.text, ocrResult.eventSummary);
                    ocrLines.push(ocrSnippet);
                }
                if (ocrLines.length > 0) {
                    // Merge OCR text with snippet text for evidence
                    const ocrText = ocrLines.join('\n\n');
                    const combinedText = ocrText ? `${ocrText}\n\n${snippetText}` : snippetText;
                    const snippetEvidenceContextWithOcr = this.buildAiEvidenceContextFromText(combinedText);
                    // Replace evidence context with OCR-inclusive version
                    Object.assign(snippetEvidenceContext, snippetEvidenceContextWithOcr);
                    // Also update image evidence with OCR image URLs
                    for (const url of seenOcrUrls) {
                        snippetImageEvidence.add(url);
                    }
                }
            }

            // Extract from snippet using two-pass strategy
            const partial = await this.extractEventWithTwoPassAi(htmlData, aiConfig, cityConfig, parserConfig, remainingFields, snippetText, passLabel, { ...options, dataFlags }, httpAdapter);

            // Validate extracted fields
            const partialValidation = this.validateAiEventEvidence(partial, htmlData, parserConfig, remainingFields, {
                evidenceContext: snippetEvidenceContext,
                validationContext: { imageEvidenceUrls: snippetImageEvidence, cityConfig: cityConfig }
            });
            let validatedPartial = partialValidation.event || {};
            // Dropped-value memo (internal, additive): per-snippet reports are
            // otherwise discarded, but the page-location cross-check in
            // extractSingleEvent still needs the city value the gate dropped
            // (weaker evidence) to anchor its comparison. First drop wins.
            const partialDropped = partialValidation.report && Array.isArray(partialValidation.report.dropped)
                ? partialValidation.report.dropped
                : [];
            partialDropped.forEach(entry => {
                if (!entry || !entry.field || entry.value === undefined) return;
                if (!validatedPartial.__droppedFieldValues || typeof validatedPartial.__droppedFieldValues !== 'object') {
                    validatedPartial.__droppedFieldValues = {};
                }
                if (!(entry.field in validatedPartial.__droppedFieldValues)) {
                    validatedPartial.__droppedFieldValues[entry.field] = entry.value;
                }
                // Parallel reason memo (same first-drop-wins rule): the
                // confidence-retry feedback needs to tell plain
                // not-verbatim drops (reason untagged → '') apart from
                // evidence-quality drops (tagged reason) — only the former
                // are worth echoing back to the retry prompt.
                if (!validatedPartial.__droppedFieldReasons || typeof validatedPartial.__droppedFieldReasons !== 'object') {
                    validatedPartial.__droppedFieldReasons = {};
                }
                if (!(entry.field in validatedPartial.__droppedFieldReasons)) {
                    validatedPartial.__droppedFieldReasons[entry.field] = typeof entry.reason === 'string' ? entry.reason : '';
                }
            });
            // Evidence-pointer rescue memo (internal, additive, LOG-ONLY):
            // per-snippet reports are discarded, so rescue candidates ride an
            // internal field through the merge; extractSingleEvent stamps them
            // onto the final event as _evidenceRescues for the evidence panel.
            const partialRescues = partialValidation.report && Array.isArray(partialValidation.report.evidenceRescues)
                ? partialValidation.report.evidenceRescues
                : [];
            if (partialRescues.length > 0) {
                validatedPartial.__evidenceRescues = (Array.isArray(validatedPartial.__evidenceRescues) ? validatedPartial.__evidenceRescues : [])
                    .concat(partialRescues);
            }

            // Reject organizer-brand / site-tagline values AT PASS-RESULT TIME:
            // an accepted value consumes the field slot (later passes only ask for
            // still-missing fields via getRemainingPromptFields), so a junk meta
            // answer like bar:"BEARRACUDA" would permanently block the correct
            // value even when a later content pass could find it. Rejecting here
            // keeps the field open; normalizeAiEvent keeps the same guards as an
            // end-of-pipeline backstop.
            validatedPartial = this.rejectBrandLikePassFields(validatedPartial, htmlData, passLabel);

            // Track field sources for traceability
            const validatedFields = validationState ? validationState.validatedFields : new Set();
            Object.keys(validatedPartial).forEach(key => {
                if (this.isInternalAiFieldKey(key)) return;
                const normalizedField = this.normalizePromptFieldName(key);
                validatedFields.add(normalizedField);
                if (extractionTrace && extractionTrace.fieldSources && !extractionTrace.fieldSources[normalizedField]) {
                    extractionTrace.fieldSources[normalizedField] = {
                        partition: passLabel,
                        pass: passLabel,
                        snippet: index + 1
                    };
                }
            });

            merged = this.mergeAiEventFields(merged, validatedPartial);
        }

        // === STEP 3: Return Merged Results ===
        return merged;
    }

    // Confidence-retry feedback map ({ field: droppedValue }) for the fields
    // being retried, sourced from the dropped-value/reason memos the earlier
    // passes accumulated. Only PLAIN not-verbatim drops qualify (reason
    // untagged — the value pointed at real text but wasn't copied exactly);
    // evidence-quality drops (context-cited/brand-cited) mean the value
    // itself is rotten, so echoing it back would steer the retry wrong.
    // null when no target field has a qualifying drop.
    buildRetryDropFeedback(fields, merged) {
        const values = merged && merged.__droppedFieldValues && typeof merged.__droppedFieldValues === 'object'
            ? merged.__droppedFieldValues
            : null;
        if (!values) return null;
        const reasons = merged.__droppedFieldReasons && typeof merged.__droppedFieldReasons === 'object'
            ? merged.__droppedFieldReasons
            : {};
        const feedback = {};
        (Array.isArray(fields) ? fields : []).forEach(field => {
            const normalizedField = this.normalizePromptFieldName(field);
            if (!normalizedField) return;
            const matchKey = Object.keys(values).find(key => this.normalizePromptFieldName(key) === normalizedField);
            if (matchKey === undefined) return;
            const value = values[matchKey];
            if (typeof value !== 'string' || !value.trim()) return;
            if (reasons[matchKey]) {
                // End-marker drops are the one tagged class still worth
                // echoing: the value itself is real (it is the event's END) —
                // the retry just must not put it in a start field again.
                // Rides as { value, reason } so the prompt renders the
                // end-marker correction line instead of the not-verbatim one.
                if (reasons[matchKey] === END_MARKER_CITED_REASON) {
                    feedback[normalizedField] = { value, reason: END_MARKER_CITED_REASON };
                }
                return; // tagged reason = evidence-quality drop
            }
            feedback[normalizedField] = value;
        });
        return Object.keys(feedback).length > 0 ? feedback : null;
    }

    // Deterministic startDate backstop for the end-marker rejection class
    // (run 20260724-155934): fires only when (1) a start field was dropped as
    // end-marker-cited (the __droppedFieldReasons memo carries the tag),
    // (2) no pass or retry produced a startDate, and (3) a usable endDate
    // exists (typically the reassigned one). An end at 02:59 or earlier
    // belongs to the PREVIOUS evening — the inverse of normalizeAiEvent's
    // past-midnight end rollover; a later or unknown end time keeps the end's
    // own date. startTime is never derived. The derived field is marked
    // pre-validated (it is arithmetic on evidence-cited data, never verbatim
    // on the page). Fails closed: any non-YYYY-MM-DD endDate is left alone
    // and normalizeAiEvent's existing start=end fallback still keeps the
    // event alive.
    applyEndMarkerStartDateRecovery(merged, validationState) {
        if (!merged || typeof merged !== 'object') return merged;
        const reasons = merged.__droppedFieldReasons && typeof merged.__droppedFieldReasons === 'object'
            ? merged.__droppedFieldReasons
            : {};
        const endMarkerHit = Object.keys(reasons).some(field =>
            reasons[field] === END_MARKER_CITED_REASON
            && END_MARKER_START_FIELDS.has(this.normalizePromptFieldName(field)));
        if (!endMarkerHit) return merged;
        if (this.hasResolvedFieldValue(merged, 'startdate')) return merged;
        const endDateKey = Object.keys(merged).find(key =>
            !this.isInternalAiFieldKey(key)
            && this.normalizePromptFieldName(key) === 'enddate'
            && this.isUsableAiFieldValue(merged[key]));
        if (endDateKey === undefined) return merged;
        const endDateMatch = String(merged[endDateKey]).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!endDateMatch) return merged;
        const endTimeKey = Object.keys(merged).find(key =>
            !this.isInternalAiFieldKey(key)
            && this.normalizePromptFieldName(key) === 'endtime'
            && this.isUsableAiFieldValue(merged[key]));
        const endTimeValue = endTimeKey !== undefined ? String(merged[endTimeKey]).trim() : '';
        const timeParts = endTimeValue ? this.extractDateEvidenceParts(endTimeValue) : null;
        const endMinutes = timeParts && timeParts.hasTime
            ? (Number(timeParts.hour) * 60) + Number(timeParts.minute)
            : null;
        const rollBack = endMinutes !== null && endMinutes <= (2 * 60) + 59;
        let derived;
        if (rollBack) {
            const previousDayUtc = new Date(Date.UTC(
                Number(endDateMatch[1]),
                Number(endDateMatch[2]) - 1,
                Number(endDateMatch[3])
            ) - (24 * 60 * 60 * 1000));
            const pad = value => String(value).length < 2 ? `0${value}` : String(value);
            derived = `${previousDayUtc.getUTCFullYear()}-${pad(previousDayUtc.getUTCMonth() + 1)}-${pad(previousDayUtc.getUTCDate())}`;
        } else {
            derived = `${endDateMatch[1]}-${endDateMatch[2]}-${endDateMatch[3]}`;
        }
        const schema = this.getEventSchema();
        let targetKey = 'startDate';
        if (schema && typeof schema.canonicalizeEventKey === 'function') {
            const canonical = schema.canonicalizeEventKey('startdate');
            if (canonical) targetKey = canonical;
        }
        const updated = { ...merged, [targetKey]: derived };
        if (validationState && validationState.validatedFields instanceof Set) {
            validationState.validatedFields.add('startdate');
        }
        console.log(`🤖 AI Web: Derived startDate "${derived}" from end-marker-reassigned end (${endTimeValue ? `end ${endTimeValue} ${rollBack ? 'rolls back to the previous evening' : 'stays on the end date'}` : 'no end time, staying on the end date'}) — startTime left empty`);
        return updated;
    }

    async extractEventWithAiStrategy(htmlData, aiConfig, cityConfig, parserConfig, fields, httpAdapter = null) {
        const promptFields = Array.isArray(fields) ? fields : [];
        const maxHtmlChars = Math.max(500, Number(aiConfig.maxHtmlChars));
        const sectionBundle = this.getPromptSectionBundle(htmlData && htmlData.html ? htmlData.html : '', aiConfig);
        const payloadMode = this.normalizePayloadMode(aiConfig.payloadMode);
        const validationState = { validatedFields: new Set() };
        const extractionTrace = { fieldSources: {} };
        const confidenceRuntime = this.getAiConfidenceRuntimeConfig(parserConfig);
        let merged = {};

        const runPartitionExtraction = async (fieldsToExtract, partition, passLabel, extractionOptions = {}) => {
            // Skip the jsonld pass entirely when the page's JSON-LD has no Event-typed
            // node: the payload is WebPage/Organization boilerplate the model can only
            // answer with {} (observed on every bearracuda.com event page).
            if (partition === 'jsonld' && sectionBundle.jsonLd && !this.pageHasEventTypedJsonLd(htmlData)) {
                console.log('🤖 AI Web: Skipping jsonld extraction pass — no Event-typed JSON-LD on page');
                return {};
            }
            const sections = this.getSectionsForPartition(sectionBundle, partition);
            const snippets = this.buildPromptSnippets([], sections, maxHtmlChars);
            // Determine data flags based on partition and snippet content
            const dataFlags = this.getDataFlagsForPartition(sectionBundle, partition, snippets[0] || '');
            return this.extractFieldsAcrossSnippets(
                htmlData,
                aiConfig,
                cityConfig,
                parserConfig,
                fieldsToExtract,
                snippets,
                passLabel,
                validationState,
                {
                    partitionLabel: partition,
                    extractionTrace,
                    dataFlags,
                    ...extractionOptions
                },
                httpAdapter
            );
        };

        if (payloadMode === 'jsonld') {
            const partial = await runPartitionExtraction(promptFields, 'jsonld', 'jsonld');
            merged = this.mergeAiEventFields(merged, partial);
        } else if (payloadMode === 'meta') {
            const partial = await runPartitionExtraction(promptFields, 'meta', 'meta');
            merged = this.mergeAiEventFields(merged, partial);
        } else if (payloadMode === 'exhaustive') {
            // In exhaustive mode, clearly separate structured data passes from unstructured passes.
            // First, try structured data if available.
            const structuredSections = [sectionBundle.jsonLd, sectionBundle.metaFallback].filter(Boolean);
            if (structuredSections.length > 0) {
                const structuredSnippets = this.buildPromptSnippets([], structuredSections, maxHtmlChars);
                const structuredFlags = {
                    jsonLd: !!sectionBundle.jsonLd,
                    meta: !!sectionBundle.metaFallback
                };
                for (const field of promptFields) {
                    const remainingField = this.getRemainingPromptFields([field], merged);
                    if (remainingField.length === 0) continue;
                    const partial = await this.extractFieldsAcrossSnippets(
                        htmlData,
                        aiConfig,
                        cityConfig,
                        parserConfig,
                        remainingField,
                        structuredSnippets,
                        `exhaustive-structured ${field}`,
                        validationState,
                        { partitionLabel: 'structured', extractionTrace, dataFlags: structuredFlags },
                        httpAdapter
                    );
                    merged = this.mergeAiEventFields(merged, partial);
                }
            }

            // Second, try unstructured data (content) for remaining fields.
            if (sectionBundle.content) {
                const unstructuredSnippets = this.buildPromptSnippets([], [sectionBundle.content], maxHtmlChars);
                const unstructuredFlags = {
                    content: true
                };
                for (const field of promptFields) {
                    const remainingField = this.getRemainingPromptFields([field], merged);
                    if (remainingField.length === 0) continue;
                    const partial = await this.extractFieldsAcrossSnippets(
                        htmlData,
                        aiConfig,
                        cityConfig,
                        parserConfig,
                        remainingField,
                        unstructuredSnippets,
                        `exhaustive-unstructured ${field}`,
                        validationState,
                        { partitionLabel: 'unstructured', extractionTrace, dataFlags: unstructuredFlags },
                        httpAdapter
                    );
                    merged = this.mergeAiEventFields(merged, partial);
                }
            }
        } else {
            const promptGroups = this.getBestModePromptGroups(sectionBundle);
            for (const group of promptGroups) {
                const remainingFields = this.getRemainingPromptFields(promptFields, merged);
                if (remainingFields.length === 0) break;
                const partial = await runPartitionExtraction(remainingFields, group.label, `best ${group.label}`);
                merged = this.mergeAiEventFields(merged, partial);
            }
        }

        const retryDecisions = [];
        let retryPasses = 0;
        let retryCycles = 0;
        for (let cycle = 0; cycle < confidenceRuntime.maxRetryCycles; cycle++) {
            const confidenceDiagnostics = this.buildConfidenceDiagnostics(
                sectionBundle,
                promptFields,
                parserConfig,
                htmlData,
                merged,
                extractionTrace
            );
            const retryPlan = this.planConfidenceRetries(confidenceDiagnostics, promptFields);
            if (retryPlan.length === 0) break;
            const cycleMissingFields = this.getRemainingPromptFields(promptFields, merged).map(field => this.normalizePromptFieldName(field));
            if (cycleMissingFields.length === 0) break;
            retryCycles++;
            for (const entry of retryPlan) {
                if (retryPasses >= confidenceRuntime.maxRetryPasses) break;
                const missingNow = this.getRemainingPromptFields(promptFields, merged)
                    .map(field => this.normalizePromptFieldName(field));
                const targetFields = entry.fields.filter(field => missingNow.includes(field));
                if (targetFields.length === 0) continue;
                // Feed the retry what the last roll got wrong: each target
                // field's previously dropped not-verbatim value rides into
                // the alternate prompt as an additive correction line
                // instead of re-rolling blind (buildRetryDropFeedback).
                const retryFeedback = this.buildRetryDropFeedback(targetFields, merged);
                const partial = await runPartitionExtraction(
                    targetFields,
                    entry.partition,
                    `confidence retry ${cycle + 1} ${entry.partition}`,
                    retryFeedback
                        ? { promptVariant: 'alternate', retryFeedback }
                        : { promptVariant: 'alternate' }
                );
                const beforeMissing = this.getRemainingPromptFields(promptFields, merged)
                    .map(field => this.normalizePromptFieldName(field));
                merged = this.mergeAiEventFields(merged, partial);
                const afterMissing = this.getRemainingPromptFields(promptFields, merged)
                    .map(field => this.normalizePromptFieldName(field));
                const recoveredFields = beforeMissing.filter(field => !afterMissing.includes(field));
                retryDecisions.push({
                    cycle: cycle + 1,
                    partition: entry.partition,
                    targetedFields: targetFields,
                    missingBefore: beforeMissing,
                    missingAfter: afterMissing,
                    recoveredFields
                });
                retryPasses++;
            }
            if (retryPasses >= confidenceRuntime.maxRetryPasses) break;
        }

        // End-marker startDate recovery (deterministic backstop, runs LAST):
        // when the gate reassigned an end-marker-cited start and the retries
        // above still found no stated start, derive startDate from the
        // reassigned end instead of letting normalizeAiEvent's missing-start
        // fallback adopt the END date/time wholesale. Inverse of the
        // past-midnight end rollover in normalizeAiEvent: an end at 02:59 or
        // earlier belongs to the PREVIOUS evening. startTime is deliberately
        // left empty — never guessed.
        merged = this.applyEndMarkerStartDateRecovery(merged, validationState);

        const confidenceDiagnostics = this.buildConfidenceDiagnostics(
            sectionBundle,
            promptFields,
            parserConfig,
            htmlData,
            merged,
            extractionTrace
        );
        confidenceDiagnostics.retry = {
            decisions: retryDecisions,
            summary: {
                cycles: retryCycles,
                passes: retryPasses,
                attempted: retryDecisions.length,
                recoveredFields: Array.from(new Set(
                    retryDecisions.reduce((all, entry) => all.concat(Array.isArray(entry.recoveredFields) ? entry.recoveredFields : []), [])
                ))
            },
            limits: {
                maxRetryCycles: confidenceRuntime.maxRetryCycles,
                maxRetryPasses: confidenceRuntime.maxRetryPasses
            }
        };

        if (merged && typeof merged === 'object' && validationState.validatedFields.size > 0) {
            merged.__preValidatedFields = Array.from(validationState.validatedFields);
        }
        if (merged && typeof merged === 'object') {
            merged.__confidenceDiagnostics = confidenceDiagnostics;
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
        if (payloadMode === 'jsonld' && jsonLdParts.length > 0) {
            sections.push(`JSON_LD_PRIMARY\n${jsonLdParts.join('\n')}`);
        } else if (payloadMode === 'meta' && metaParts.length > 0) {
            sections.push(`META_PRIMARY\n${metaParts.join('\n')}`);
        } else if (payloadMode === 'best') {
            const jsonLdLooksFull = this.isSnippetSourceFull(this.scoreJsonLdParts(jsonLdParts), this.extractionLimits.jsonLdFullnessMinSignals);
            const metaLooksFull = this.isSnippetSourceFull(this.scoreMetaParts(metaParts), this.extractionLimits.metaFullnessMinSignals);
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

    getEventSchemaFieldSignalRegexes(fieldName) {
        const normalizedField = this.normalizePromptFieldName(fieldName);
        if (!normalizedField) return [];
        if (!this.eventSchemaFieldSignalRegexMapLoaded) {
            const schema = this.getEventSchema();
            const rawMap = schema && schema.AI_FIELD_SIGNAL_REGEXES && typeof schema.AI_FIELD_SIGNAL_REGEXES === 'object'
                ? schema.AI_FIELD_SIGNAL_REGEXES
                : {};
            this.cachedEventSchemaFieldSignalRegexMap = new Map();
            Object.keys(rawMap).forEach(rawFieldName => {
                const normalizedMapField = this.normalizePromptFieldName(rawFieldName);
                if (!normalizedMapField) return;
                const rawPatterns = rawMap[rawFieldName];
                const patterns = (Array.isArray(rawPatterns) ? rawPatterns : [rawPatterns])
                    .map(pattern => String(pattern || '').trim())
                    .filter(Boolean);
                if (patterns.length > 0) {
                    this.cachedEventSchemaFieldSignalRegexMap.set(normalizedMapField, patterns);
                }
            });
            this.eventSchemaFieldSignalRegexMapLoaded = true;
        }
        return this.cachedEventSchemaFieldSignalRegexMap.get(normalizedField) || [];
    }

    getAiPromptFields(parserConfig = {}, dataFlags = {}, sourceUrl = '') {
        const priorities = this.core.getResolvedFieldPriorities(parserConfig);
        const metadata = parserConfig && parserConfig.metadata && typeof parserConfig.metadata === 'object'
            ? parserConfig.metadata
            : {};
        const skippedFieldReasons = [];
        let selected = Object.keys(priorities).filter(field => {
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
        const hasCitySelected = selected.some(field => this.normalizePromptFieldName(field) === 'city');
        const cityOverriddenByMetadata = !hasCitySelected
            && Object.keys(metadata).some(field => this.normalizePromptFieldName(field) === 'city');
        if (!hasCitySelected && !cityOverriddenByMetadata) {
            selected.push('city');
            this.logDebug('🤖 AI Web: Added special prompt field => city');
        }
        const hasOcr = !!dataFlags.ocr || !!dataFlags.segment;
        const hasJsonLd = !!dataFlags.jsonLd;
        const hasMeta = !!dataFlags.meta;
        let fieldMode = 'split-default';

        // For structured data (JSON-LD/meta), prefer start/end fields over split fields
        // For unstructured data (OCR/content/segments), use split fields
        // IMPORTANT: OCR/Segment context (unstructured) takes precedence over structured data flags
        // because segments/OCR text are often mixed into pages that otherwise have structured data.
        if (hasOcr) {
            fieldMode = 'split+ocr';
            this.logDebug(`🤖 AI Web: Using split fields (startDate/startTime/etc) because OCR or segment data is present (hasOcr=${!!dataFlags.ocr}, hasSegment=${!!dataFlags.segment})`);
            // Unstructured data - prefer split fields, remove start/end
            const fullDateFields = ['start', 'end'];
            const originalSelected = [...selected];
            const hasStartRequested = selected.some(field => this.normalizePromptFieldName(field) === 'start');
            const hasEndRequested = selected.some(field => this.normalizePromptFieldName(field) === 'end');

            selected = selected.filter(field => !fullDateFields.includes(field));
            if (selected.length !== originalSelected.length) {
                this.logDebug('🤖 AI Web: Removed full datetime fields (using split fields for unstructured data)');
            }

            // Ensure split fields are present if full fields were requested or if only one of the split pair is present
            const hasStartDateSelected = selected.some(field => this.normalizePromptFieldName(field) === 'startdate');
            const hasStartTimeSelected = selected.some(field => this.normalizePromptFieldName(field) === 'starttime');
            if ((hasStartRequested || hasStartDateSelected) && !hasStartTimeSelected) {
                selected.push('startTime');
                this.logDebug(`🤖 AI Web: Added split field => startTime (because ${hasStartRequested ? 'start' : 'startDate'} was selected)`);
            }
            if (hasStartRequested && !hasStartDateSelected) {
                selected.push('startDate');
                this.logDebug('🤖 AI Web: Added split field => startDate (because start was selected)');
            }

            const hasEndDateSelected = selected.some(field => this.normalizePromptFieldName(field) === 'enddate');
            const hasEndTimeSelected = selected.some(field => this.normalizePromptFieldName(field) === 'endtime');
            if ((hasEndRequested || hasEndDateSelected) && !hasEndTimeSelected) {
                selected.push('endTime');
                this.logDebug(`🤖 AI Web: Added split field => endTime (because ${hasEndRequested ? 'end' : 'endDate'} was selected)`);
            }
            if (hasEndRequested && !hasEndDateSelected) {
                selected.push('endDate');
                this.logDebug('🤖 AI Web: Added split field => endDate (because end was selected)');
            }
        } else if (hasJsonLd || hasMeta) {
            fieldMode = 'full+structured';
            this.logDebug(`🤖 AI Web: Using full datetime fields (start/end) because structured data is present (hasJsonLd=${hasJsonLd}, hasMeta=${hasMeta})`);
            // Structured data - prefer start/end, remove split fields
            const splitDateFields = ['startDate', 'startTime', 'endDate', 'endTime'];
            const originalSelected = [...selected];
            const hasStartDateRequested = selected.some(field => this.normalizePromptFieldName(field) === 'startdate');
            const hasStartTimeRequested = selected.some(field => this.normalizePromptFieldName(field) === 'starttime');
            const hasEndDateRequested = selected.some(field => this.normalizePromptFieldName(field) === 'enddate');
            const hasEndTimeRequested = selected.some(field => this.normalizePromptFieldName(field) === 'endtime');

            selected = selected.filter(field => !splitDateFields.includes(field));
            if (selected.length !== originalSelected.length) {
                this.logDebug('🤖 AI Web: Removed split date fields (using start/end for structured data)');
            }

            // Ensure start/end are present if any split fields were requested
            const hasStartSelected = selected.some(field => this.normalizePromptFieldName(field) === 'start');
            if (!hasStartSelected && (hasStartDateRequested || hasStartTimeRequested)) {
                selected.push('start');
                this.logDebug('🤖 AI Web: Added full datetime field => start (because split fields were requested)');
            }

            const hasEndSelected = selected.some(field => this.normalizePromptFieldName(field) === 'end');
            if (!hasEndSelected && (hasEndDateRequested || hasEndTimeRequested || hasStartSelected)) {
                selected.push('end');
                this.logDebug('🤖 AI Web: Added full datetime field => end (because split fields or start was requested)');
            }
        } else {
            this.logDebug('🤖 AI Web: Defaulting to split fields (no structured data or OCR context detected)');
            // Default to split fields (same as unstructured)
            const fullDateFields = ['start', 'end'];
            const hasStartRequested = selected.some(field => this.normalizePromptFieldName(field) === 'start');
            const hasEndRequested = selected.some(field => this.normalizePromptFieldName(field) === 'end');
            selected = selected.filter(field => !fullDateFields.includes(field));

            // Same time companions as the OCR branch — plain page text can still carry
            // times ("Doors Open at 9:00 pm") even when no OCR/structured signals exist.
            // Without these, events from this branch get midnight defaults.
            const hasStartDateSelected = selected.some(field => this.normalizePromptFieldName(field) === 'startdate');
            const hasStartTimeSelected = selected.some(field => this.normalizePromptFieldName(field) === 'starttime');
            if ((hasStartRequested || hasStartDateSelected) && !hasStartTimeSelected) {
                selected.push('startTime');
                this.logDebug(`🤖 AI Web: Added split field => startTime (because ${hasStartRequested ? 'start' : 'startDate'} was selected)`);
            }
            if (hasStartRequested && !hasStartDateSelected) {
                selected.push('startDate');
                this.logDebug('🤖 AI Web: Added split field => startDate (because start was selected)');
            }
            const hasEndDateSelected = selected.some(field => this.normalizePromptFieldName(field) === 'enddate');
            const hasEndTimeSelected = selected.some(field => this.normalizePromptFieldName(field) === 'endtime');
            if ((hasEndRequested || hasEndDateSelected) && !hasEndTimeSelected) {
                selected.push('endTime');
                this.logDebug(`🤖 AI Web: Added split field => endTime (because ${hasEndRequested ? 'end' : 'endDate'} was selected)`);
            }
            if (hasEndRequested && !hasEndDateSelected) {
                selected.push('endDate');
                this.logDebug('🤖 AI Web: Added split field => endDate (because end was selected)');
            }
        }

        // Ensure fields follow the canonical order from EventSchema
        const schemaFields = this.getEventSchemaPromptFields();
        const schemaOrderMap = new Map(schemaFields.map((field, index) => [field.normalizedName, index]));

        selected.sort((a, b) => {
            const indexA = schemaOrderMap.get(this.normalizePromptFieldName(a));
            const indexB = schemaOrderMap.get(this.normalizePromptFieldName(b));

            // If a field is not in the schema (e.g. city added manually), put it at the end
            const sortA = indexA !== undefined ? indexA : 999;
            const sortB = indexB !== undefined ? indexB : 999;

            return sortA - sortB;
        });

        const aiPromptFields = selected;
        const manuallyScrapedFields = new Set(['instagram', 'facebook', 'gmaps']);
        const filteredPromptFields = aiPromptFields.filter(field => !manuallyScrapedFields.has(this.normalizePromptFieldName(field)));
        const removedManualFields = aiPromptFields.filter(field => manuallyScrapedFields.has(this.normalizePromptFieldName(field)));
        this.logDebug(`🤖 AI Web: Field priority filter selected ${selected.length} field(s) from ${Object.keys(priorities).length}`);
        if (skippedFieldReasons.length > 0) {
            this.logDebug(`🤖 AI Web: Skipped priority fields => ${JSON.stringify(skippedFieldReasons)}`);
        }
        if (removedManualFields.length > 0) {
            this.logDebug(`🤖 AI Web: Removed manually scraped fields => ${removedManualFields.join(', ')}`);
        }
        // One compact console line per extraction setup replaces the per-field chatter
        // above (which stays visible in the debug/file log).
        const skippedNames = [
            ...skippedFieldReasons.map(entry => entry.field),
            ...removedManualFields
        ];
        const skippedText = skippedNames.length > 0 ? `skipped: ${skippedNames.join(', ')}; ` : '';
        const summaryLine = `🤖 AI Web: Fields for ${sourceUrl || 'extraction'}: ${filteredPromptFields.length} selected (${skippedText}mode: ${fieldMode})`;
        if (sourceUrl) {
            console.log(summaryLine);
        } else {
            // No URL context (e.g. per-field requested checks) — keep it off the console.
            this.logDebug(summaryLine);
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
        // Prompt-only steering (run 20260723 findings): source sites lead the
        // description with the event's own date line ("CHUNK returns to PDX…
        // Saturday AUGUST 22nd!"), which is redundant next to startDate/
        // startTime. Appended to the schema line so the schema text itself
        // stays byte-identical.
        if (normalized === 'description') {
            description += ` Do not lead with the event's date/time (those are captured separately) — start from the actual description text.`;
        }
        // Prompt-only steering (run 20260723-123149 findings): a promoter's
        // home-city branding (WWW.FURBALL.NYC on a flyer) was extracted as the
        // event city for an event in Torremolinos. Appended to the schema line
        // so the schema text itself stays byte-identical.
        if (normalized === 'city') {
            description += ` The promoter's home city in branding, logos, or website domains (e.g. a .nyc domain) is NOT the event city — use explicit location statements (e.g. "Torremolinos, Spain") near the venue/address.`;
        }
        // Prompt-only steering (run 20260724-122902 findings): the model
        // returned the flyer's street line ("79 WARRENTON") as the bar. The
        // organizer/promoter/brand rule is already part of the schema
        // description; the address-shape rule is the addition. Appended to
        // the schema line so the schema text itself stays byte-identical.
        if (normalized === 'bar') {
            description += ` A street address is never a venue name.`;
        }
        // Prompt-only steering (run 20260725-205217 findings): sources whose
        // listing "title" is a flyer/social caption got adopted wholesale
        // ("D>U>R>O is back NEW OUTDOOR LOCATION _ NIGHT FOAM PARTY and
        // SPECIAL GUEST"; "Thighs out for the guys yall, it's Singlet Night
        // at the Dallas Eagle 🤼‍♂️🦅"). Appended to the schema line so the
        // schema text itself stays byte-identical.
        if (normalized === 'title') {
            description += ` The title is the event's NAME — short and reusable, exactly as it appears in the source. When the source text is an announcement sentence or caption that contains the event name, extract just the name portion (it must still appear verbatim within the source). Never include venue, city, date, or marketing phrases in the title.`;
        }
        // Prompt-only steering (run 20260724-155934 findings): thedallaseagle.com
        // listings print "End at: August 1, 2026 - 2:00 am" and extraction kept
        // assigning those END values to start fields (events shipped starting
        // at the 2:00 AM closing time). Appended to the schema line so the
        // schema text itself stays byte-identical.
        if (normalized === 'startdate' || normalized === 'starttime') {
            description += ` Text following "End at", "Ends", "Until", or "Doors close" is the event's END, never its start — if no start is stated, leave this field empty.`;
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
        return allFields.map(field => `- ${field}: ${this.getFieldContext(field, cityConfig)}`).join('\n');
    }


    buildContextPrePrompt(snippet) {
        return `Analyze this raw event data. Find any hidden times or confusing dates and format them explicitly.
- If you see a time like "01H" or "20h30", rewrite it as "01:00 AM" or "8:30 PM".
- Identify the Main Event Name, its Specific Date, and whether there is a larger festival date range mentioned.

Output ONLY this format:
CORRECTIONS:
- Cleaned Times: [List them here]
- Core Event Date: [The single specific date]
- Parent Festival Dates: [If any, otherwise 'None']

TEXT:
${String(snippet || '')}`;
    }

    buildExtractionPrompt(htmlData, aiConfig, cityConfig, parserConfig, fields, snippet, variant = 'default', dataFlags = {}, retryFeedback = null) {
        const promptFields = Array.isArray(fields) && fields.length > 0
            ? fields
            : this.getAiPromptFields(parserConfig, dataFlags, htmlData && htmlData.url ? htmlData.url : '');
        const fieldContext = this.buildFieldContextText(promptFields, cityConfig);

        // Build DATA PROVIDED section based on flags
        const hasOcr = !!dataFlags.ocr;
        const hasSegment = !!dataFlags.segment;
        const hasJsonLd = !!dataFlags.jsonLd;
        const hasMeta = !!dataFlags.meta;
        const hasContent = !!dataFlags.content;

        let dataProvided = '';
        if (hasOcr || hasSegment) {
            dataProvided += `DATA PROVIDED:\n`;
            if (hasOcr) {
                dataProvided += `- OCR_IMAGE_TEXT: Raw text extracted from event images\n`;
            }
            if (hasSegment) {
                dataProvided += `- SEGMENT_IMAGE_URL: Image URLs associated with this segment
- SEGMENT_LINK_URL: Link URLs from the page\n`;
            }
            dataProvided += `\n`;
        }

        let additionalContext = '';
        if (hasOcr && htmlData && Array.isArray(htmlData.ocrResults) && htmlData.ocrResults.length > 0) {
            const summaries = htmlData.ocrResults
                .filter(r => r && typeof r.eventSummary === 'string' && r.eventSummary.trim().length > 0)
                .map(r => r.eventSummary.trim());
            if (summaries.length > 0) {
                additionalContext += `ADDITIONAL CONTEXT (DO NOT EXTRACT FROM THIS — for disambiguation only, e.g. resolving festival vs. event name conflicts — never cite it as evidence):\n`;
                summaries.forEach(s => {
                    additionalContext += `- ${s}\n`;
                });
                additionalContext += `\n`;
            }
        }

        // Build SOURCE DATA section based on what's actually provided
        let sourceData = '';
        if (hasJsonLd || hasMeta || hasContent) {
            sourceData += `SOURCE DATA:
`;
            if (hasJsonLd) sourceData += `- JSON-LD structured data
`;
            if (hasMeta) sourceData += `- OpenGraph and other meta tags
`;
            if (hasContent) sourceData += `- Page body text (unformatted)
`;
            sourceData += `
`;
        }

        // Page-level steering context, present in every extraction variant
        // (default/alternate/repair): the organizer brand derived from the page's
        // own metadata (prevention up front, complementing the post-extraction
        // guard in normalizeAiEvent) plus any configured ai.extraContext override,
        // which is appended verbatim.
        let steeringContext = '';
        const pageBrandNames = this.getPageBrandNames(htmlData);
        // A page classified as the VENUE's own site gets the KNOWN VENUE
        // steering line instead of KNOWN ORGANIZER: on a venue site the brand
        // IS the venue, and telling the model "never return it as bar" is
        // exactly backwards there. Organizer/undetermined pages keep today's
        // organizer line verbatim.
        const siteRole = this.getPageSiteRole(htmlData);
        const knownVenueName = siteRole === 'venue' ? this.getPageVenueName(htmlData) : '';
        if (knownVenueName) {
            steeringContext += `KNOWN VENUE (this is the venue's own site): "${knownVenueName}" — events on this page take place AT this venue unless the page states another location; DJ names, taglines, and edition subtitles are NOT the venue.\n`;
            // Additive strengthening line, only when the venue name uniquely
            // matches ONE curated bar (never for ambiguous cities or generic
            // franchise stems) — guest-host brand names on flyers must not
            // displace the site's own venue.
            const curatedVenueMatch = this.core && typeof this.core.findCuratedBarCityByName === 'function'
                ? this.core.findCuratedBarCityByName(knownVenueName)
                : null;
            if (curatedVenueMatch && curatedVenueMatch.city && curatedVenueMatch.bar) {
                steeringContext += `KNOWN VENUE (curated match): "${knownVenueName}" is the venue for every event on this site. Other bar or brand names printed on a flyer are guest hosts or co-presenters, NOT the venue — never return them as "bar" unless the page states the event happens at a different street address.\n`;
            }
        } else if (pageBrandNames.length > 0 && siteRole !== 'venue') {
            const aliasSuffix = pageBrandNames.length > 1
                ? ` (also appears as ${pageBrandNames.slice(1).map(name => `"${name}"`).join(', ')})`
                : '';
            steeringContext += `KNOWN ORGANIZER (derived from page metadata): "${pageBrandNames[0]}"${aliasSuffix} — this is the event promoter/site brand, NOT the venue. Never return it as "bar", and do not treat its name in page titles as part of the event name.\n`;
        }
        const extraContext = aiConfig && typeof aiConfig.extraContext === 'string' ? aiConfig.extraContext.trim() : '';
        if (extraContext) {
            steeringContext += `${extraContext}\n`;
        }
        if (steeringContext) {
            steeringContext += `\n`;
        }

        // Multi-event segment listing title: the site's own name for this event,
        // taken from the listing text. Anchors "title" so stylized flyer OCR
        // (taglines, DJ names) can't displace the page's own title.
        const segmentListingTitle = htmlData && typeof htmlData.segmentListingTitle === 'string'
            ? htmlData.segmentListingTitle.trim()
            : '';
        const segmentListingContext = segmentListingTitle
            ? `SEGMENT_LISTING_TITLE (the page's own listing title for this event): ${JSON.stringify(segmentListingTitle)}\n\n`
            : '';
        const segmentListingTitleRule = segmentListingTitle
            ? `\n- For "title", prefer SEGMENT_LISTING_TITLE or a fuller variant of the same name from the flyer; flyer text that does not contain it (taglines, DJ names, stylized graphics text) is NOT the title.`
            : '';

        // Confidence-retry feedback (additive, alternate template only —
        // retries always run the alternate variant): one correction line per
        // retried field naming the previously rejected not-verbatim value,
        // so the retry copies exact source text instead of re-rolling blind.
        // Empty when no feedback rides in — existing prompts stay
        // byte-identical.
        let retryFeedbackContext = '';
        if (retryFeedback && typeof retryFeedback === 'object') {
            Object.entries(retryFeedback).forEach(([field, value]) => {
                // End-marker corrections ride as { value, reason } objects
                // (see buildRetryDropFeedback): the dropped value is real END
                // data, so this line steers the retry away from the start
                // field instead of asking for a verbatim copy.
                if (value && typeof value === 'object' && value.reason === END_MARKER_CITED_REASON) {
                    if (typeof value.value !== 'string' || !value.value.trim()) return;
                    retryFeedbackContext += `Your previous value "${value.value}" for ${field} came from an "End at" line — that is the event's END, not its start. Find the START, or leave it blank.\n`;
                    return;
                }
                if (typeof value !== 'string' || !value.trim()) return;
                retryFeedbackContext += `Your previous value "${value}" for ${field} was rejected — it is not verbatim in the source. Copy the exact text.\n`;
            });
            if (retryFeedbackContext) retryFeedbackContext += `\n`;
        }

        const exampleOutput = `EXAMPLE OUTPUT FORMAT (structure only, not real data):\n{"city": {"value": "miami", "evidence": "Miami, FL", "confidence": 90}, "bar": {"value": "Eagle Bar", "evidence": "@ Eagle Bar", "confidence": 95}}`;

        const templates = {
            default: `You are a data scraper. You are being provided part of a website that includes information about an event. You must check if any of the requested keys are within the provided scraped data and return it as ONLY valid JSON. If a requested key is not explicitly in the source text, skip and omit it.

Format the output as a single JSON object where each requested key maps to an object containing "value", "evidence", and "confidence".

${dataProvided}${sourceData}${additionalContext}${steeringContext}${segmentListingContext}Preferred keys:
${fieldContext}
Rules:
- Return a single JSON object only
- Return only keys from the Preferred keys list, formatted as objects with value, evidence, and confidence (0-100)
- Omit unknown fields; do not invent details and do not estimate. ONLY use data from the source material.${segmentListingTitleRule}

${exampleOutput}

`,
            alternate: `You are extracting specific event fields from web page source data. Carefully search the entire provided text for the listed fields — they may appear in metadata, structured data, or body text. Return only what you find as a single valid JSON object.

Format the output as a single JSON object where each requested key maps to an object containing "value", "evidence", and "confidence".

${dataProvided}${sourceData}${additionalContext}${steeringContext}${segmentListingContext}${retryFeedbackContext}Fields to find:
${fieldContext}
Rules:
- Return a single JSON object only
- Include only fields whose values are found verbatim in the text below, formatted as objects with value, evidence, and confidence (0-100)
- Do not guess, invent, or infer missing values
- Omit any field not explicitly present in the source${segmentListingTitleRule}

${exampleOutput}

`,
            repair: `Convert this text into one strict JSON object for an event.

Format the output as a single JSON object where each requested key maps to an object containing "value", "evidence", and "confidence".

${additionalContext}${steeringContext}Preferred keys:
${fieldContext}
Rules:
- JSON object only
- Use only the preferred keys, formatted as objects with value, evidence, and confidence (0-100)
- No markdown
- No commentary
- Omit unknown fields
- Do not infer missing facts; keep only details explicitly supported by source text

${exampleOutput}

TEXT:
`
        };

        return `${templates[variant]}${String(snippet || '')}`;
    }

    buildAlternateExtractionPrompt(htmlData, aiConfig, cityConfig, parserConfig, fields, snippet, dataFlags = {}) {
        return this.buildExtractionPrompt(htmlData, aiConfig, cityConfig, parserConfig, fields, snippet, 'alternate', dataFlags);
    }

    buildJsonRepairPrompt(rawResponse, aiConfig, cityConfig, parserConfig, fields, dataFlags = {}, htmlData = null) {
        // The repair pass sees only the broken JSON text, but still needs the
        // page-level steering context (organizer brand or known venue,
        // ai.extraContext). Pass the cached brand names + site-role
        // determination through WITHOUT the page html so the repair prompt
        // stays free of page/OCR payload.
        const contextHtmlData = htmlData ? {
            pageBrandNames: this.getPageBrandNames(htmlData),
            pageSiteRole: this.getPageSiteRole(htmlData),
            pageVenueName: this.getPageSiteRole(htmlData) === 'venue' ? this.getPageVenueName(htmlData) : ''
        } : null;
        return this.buildExtractionPrompt(contextHtmlData, aiConfig, cityConfig, parserConfig, fields, rawResponse, 'repair', dataFlags);
    }

    /**
     * Get data flags for a given partition based on what data is available in the section bundle.
     * This tells the prompt what kind of data the AI will actually see.
     * Also checks the snippet for OCR/segment markers to handle multi-event segments.
     */
    getDataFlagsForPartition(sectionBundle, partition, snippet) {
        const flags = {};
        const snippetStr = String(snippet || '');

        // Check for OCR/segment markers in the snippet (for multi-event segments)
        flags.ocr = snippetStr.includes('OCR_IMAGE_TEXT');
        flags.segment = snippetStr.includes('SEGMENT_INDEX') || snippetStr.includes('SEGMENT_IMAGE_URL');

        // Check section bundle for other data sources
        switch (partition) {
            case 'jsonld':
                flags.jsonLd = true;
                break;
            case 'meta':
                flags.meta = true;
                break;
            case 'content':
                flags.content = true;
                break;
            case 'best':
            case 'mixed':
            case 'exhaustive':
                // These modes may use multiple data sources
                flags.jsonLd = !!sectionBundle?.jsonLd;
                flags.meta = !!sectionBundle?.metaPrimary || !!sectionBundle?.metaFallback;
                flags.content = !!sectionBundle?.content;
                break;
            default:
                // For unknown partitions, try to detect from sectionBundle
                flags.jsonLd = !!sectionBundle?.jsonLd;
                flags.meta = !!sectionBundle?.metaPrimary || !!sectionBundle?.metaFallback;
                flags.content = !!sectionBundle?.content;
                break;
        }
        return flags;
    }

    // === Main: Two-Pass Extraction with Fallback ===

    async extractEventWithTwoPassAi(htmlData, aiConfig, cityConfig, parserConfig, fields, snippet, passLabel = '', options = {}, httpAdapter = null) {
        // Setup
        const passSuffix = passLabel ? ` ${passLabel}` : '';
        const dataFlags = options && options.dataFlags && typeof options.dataFlags === 'object' ? options.dataFlags : {};
        const useAlternate = options && options.promptVariant === 'alternate';

        const parseAndFilterConfidence = (rawResponse) => {
            if (!rawResponse) return null;
            let event = this.core.parseAiEventResponse(rawResponse);
            if (!event) return null;

            const filteredEvent = {};
            for (const key in event) {
                if (!Object.prototype.hasOwnProperty.call(event, key)) continue;
                if (this.isInternalAiFieldKey(key)) {
                    filteredEvent[key] = event[key];
                    continue;
                }

                const fieldData = event[key];
                if (fieldData && typeof fieldData === 'object' && 'value' in fieldData) {
                    const confidence = fieldData.confidence;
                    if (typeof confidence === 'number' && confidence < 50) {
                        console.log(`🤖 AI Web: Dropping field ${key} due to low confidence (${confidence})`);
                        continue; // Drop it
                    }
                    let value = fieldData.value;
                    // Carry the model's per-field evidence string forward as internal
                    // metadata: the evidence gate (validateAiEventEvidence) uses it to
                    // reject time values whose evidence admits inference ("interpreted
                    // as ~3am (common club close time)") instead of quoting the source.
                    // Internal __ keys never reach calendar notes or merge field loops.
                    if (typeof fieldData.evidence === 'string' && fieldData.evidence.trim()) {
                        if (!filteredEvent.__fieldEvidence || typeof filteredEvent.__fieldEvidence !== 'object') {
                            filteredEvent.__fieldEvidence = {};
                        }
                        filteredEvent.__fieldEvidence[key] = fieldData.evidence.trim();
                    }
                    // Weekday-pinned year inference: the evidence string is only
                    // available here (it is discarded when field objects flatten to
                    // scalars), so this is the seam where "Sat, Aug 22" can pin the
                    // year the model hallucinated. See resolveWeekdayPinnedYear.
                    const pinBucket = this.getDateFieldPinBucket(key);
                    if (pinBucket) {
                        // Pass the raw source content (not processedSnippet — the
                        // helper-pass prefix is model output) so pinning can fall
                        // back to a weekday the flyer states on the line above the
                        // date when the model's evidence omits it.
                        const pinResult = this.resolveWeekdayPinnedYear(value, fieldData.evidence, snippet);
                        if (pinResult) {
                            value = pinResult.value;
                            if (!filteredEvent.__weekdayPinnedYears || typeof filteredEvent.__weekdayPinnedYears !== 'object') {
                                filteredEvent.__weekdayPinnedYears = {};
                            }
                            filteredEvent.__weekdayPinnedYears[pinBucket] = true;
                        }
                    }
                    filteredEvent[key] = value;
                } else {
                    // Fallback in case AI doesn't follow the format perfectly
                    filteredEvent[key] = fieldData;
                }
            }
            return filteredEvent;
        };

        let processedSnippet = snippet;

        const hasStructuredData = !!dataFlags.jsonLd || !!dataFlags.meta;
        const hasUnstructuredData = !!dataFlags.ocr || !!dataFlags.segment || !!dataFlags.content;

        if (hasUnstructuredData && !hasStructuredData) {
            console.log(`🤖 AI Web: Running context pre-extraction pass${passSuffix}`);
            const contextPrompt = this.buildContextPrePrompt(snippet);
            // Confidence retries re-run this pass with a byte-identical prompt (~1.2s
            // each): reuse the previous successful response instead of paying twice.
            const contextPromptHash = this.core && typeof this.core.hashString === 'function'
                ? this.core.hashString(contextPrompt)
                : null;
            let contextResponse;
            if (contextPromptHash !== null && this.contextPrepResponseCache.has(contextPromptHash)) {
                contextResponse = this.contextPrepResponseCache.get(contextPromptHash);
                console.log(`🤖 AI Web: context-prep cache hit (hash ${contextPromptHash}) — reusing previous result`);
            } else {
                contextResponse = await this.core.callAiGenerate(aiConfig, contextPrompt, 'context-prep', httpAdapter, this.recordAiPrompt.bind(this));
                if (contextPromptHash !== null && contextResponse) {
                    this.contextPrepResponseCache.set(contextPromptHash, contextResponse);
                }
            }
            if (contextResponse) {
                const strippedContext = contextResponse.replace(/[^a-z0-9]/gi, '').trim();
                if (strippedContext.length >= 5) {
                    processedSnippet = `[PRE-PARSED HELPER DATA - HIGHEST PRIORITY]\n${contextResponse.trim()}\n\nCONTENT\n${snippet}`;
                } else {
                    console.log(`🤖 AI Web: Skipping empty context response (${strippedContext.length} chars)`);
                }
            }
        }

        // PASS 1: Try standard extraction
        console.log(`🤖 AI Web: Starting extraction pass${passSuffix}`);
        const retryFeedback = options && options.retryFeedback && typeof options.retryFeedback === 'object'
            ? options.retryFeedback
            : null;
        let extractPrompt = this.buildExtractionPrompt(htmlData, aiConfig, cityConfig, parserConfig, fields, processedSnippet, useAlternate ? 'alternate' : 'default', dataFlags, retryFeedback);
        let rawResponse = await this.core.callAiGenerate(aiConfig, extractPrompt, 'extraction', httpAdapter, this.recordAiPrompt.bind(this));
        if (!rawResponse) return null;
        let event = parseAndFilterConfidence(rawResponse);
        if (event) {
            console.log(`🤖 AI Web: Extraction pass${passSuffix} succeeded`);
            return event;
        }

        // PASS 2: Try alternate extraction if first pass failed and alternate is enabled
        if (useAlternate) {
            console.log(`🤖 AI Web: Standard pass${passSuffix} failed; trying alternate prompt`);
            extractPrompt = this.buildExtractionPrompt(htmlData, aiConfig, cityConfig, parserConfig, fields, processedSnippet, 'alternate', dataFlags, retryFeedback);
            rawResponse = await this.core.callAiGenerate(aiConfig, extractPrompt, 'extraction', httpAdapter, this.recordAiPrompt.bind(this));
            if (!rawResponse) return null;
            event = parseAndFilterConfidence(rawResponse);
            if (event) {
                console.log(`🤖 AI Web: Alternate pass${passSuffix} succeeded`);
                return event;
            }
        }

        // PASS 2.5: Deterministic salvage before paying for an AI repair round-trip.
        // Most unparseable responses fail JSON.parse only because the model put raw
        // quotes inside `evidence` strings — the values themselves are fine.
        const salvagedEvent = this.salvageUnparseableAiResponse(rawResponse, fields);
        if (salvagedEvent) {
            const salvagedFieldCount = Object.keys(salvagedEvent).length;
            console.log(`🤖 AI Web: Salvaged ${salvagedFieldCount} field(s) from unparseable response — skipping repair pass`);
            event = parseAndFilterConfidence(JSON.stringify(salvagedEvent));
            if (event) return event;
        }

        // PASS 3: Try repair if extraction returned unparseable JSON
        console.warn(`🤖 AI Web: Extraction pass${passSuffix} returned unparseable JSON; attempting repair`);
        const repairPrompt = this.buildJsonRepairPrompt(rawResponse, aiConfig, cityConfig, parserConfig, fields, dataFlags, htmlData);
        const repairResponse = await this.core.callAiGenerate(aiConfig, repairPrompt, 'repair', httpAdapter, this.recordAiPrompt.bind(this));
        if (!repairResponse) return null;
        event = parseAndFilterConfidence(repairResponse);
        if (event) {
            console.log(`🤖 AI Web: Repair pass${passSuffix} succeeded`);
            return event;
        }

        console.warn(`🤖 AI Web: Extraction pass${passSuffix} failed (both standard and repair)`);
        return null;
    }

    // === Deterministic salvage of unparseable extraction responses ===
    //
    // Extraction responses frequently fail JSON.parse only because the model copies
    // raw quotes into `evidence` strings, e.g.
    //   "evidence": "name":"Treasure Trail Portland PRIDE | BEARRACUDA",
    //   "evidence": "📅 August 15, 2026" and "SAT, AUG 15 / 9PM - LATE",
    // The `value`/`confidence` entries are well-formed; only evidence is mangled.
    // Recover per-field {value, evidence?, confidence} objects with a tolerant
    // scanner instead of a full AI repair round-trip. Conservative by design:
    // - only field keys among the requested prompt fields are accepted;
    // - the value must be a strict JSON scalar terminated by an "evidence"/
    //   "confidence" boundary (a value containing raw quotes is NOT trusted);
    // - a numeric confidence must be present;
    // - everything between "evidence": and the confidence entry is kept as
    //   opaque best-effort evidence text.
    // Returns null (fall through to the AI repair pass) unless at least one field
    // salvages cleanly.
    salvageUnparseableAiResponse(rawResponse, promptFields) {
        const source = String(rawResponse || '');
        if (!source) return null;
        const knownFields = new Set(
            (Array.isArray(promptFields) ? promptFields : [])
                .map(field => this.normalizePromptFieldName(field))
                .filter(Boolean)
        );
        if (knownFields.size === 0) return null;

        // Field entries look like `"key": {"value": ...` — requiring the "value"
        // key right after the brace keeps evidence garbage (e.g. quoted JSON-LD
        // fragments) from being mistaken for a field boundary.
        const anchorRegex = /"([A-Za-z][A-Za-z0-9_]*)"\s*:\s*\{\s*"value"\s*:/g;
        const anchors = [];
        let match;
        while ((match = anchorRegex.exec(source)) !== null) {
            anchors.push({ key: match[1], start: match.index, valueStart: anchorRegex.lastIndex });
        }
        if (anchors.length === 0) return null;

        const salvaged = {};
        const seenFields = new Set();
        for (let i = 0; i < anchors.length; i++) {
            const anchor = anchors[i];
            const normalizedKey = this.normalizePromptFieldName(anchor.key);
            if (!knownFields.has(normalizedKey) || seenFields.has(normalizedKey)) continue;
            const chunkEnd = i + 1 < anchors.length ? anchors[i + 1].start : source.length;
            const fieldData = this.salvageAiFieldChunk(source.slice(anchor.valueStart, chunkEnd));
            if (!fieldData) continue;
            seenFields.add(normalizedKey);
            salvaged[anchor.key] = fieldData;
        }
        return seenFields.size >= 1 ? salvaged : null;
    }

    // Parse one field body starting right after `"value":`. Returns
    // {value, evidence?, confidence} or null when the chunk is not trustworthy.
    salvageAiFieldChunk(chunk) {
        const scalarMatch = chunk.match(/^\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)/);
        if (!scalarMatch) return null;
        let value;
        try {
            value = JSON.parse(scalarMatch[1]);
        } catch (_) {
            return null;
        }
        if (value === null) return null;

        // The scalar must terminate at a proper field boundary — otherwise the
        // value itself may contain raw quotes and the capture is a truncation.
        const afterValue = chunk.slice(scalarMatch[0].length);
        const boundaryMatch = afterValue.match(/^\s*,\s*"(evidence|confidence)"\s*:/);
        if (!boundaryMatch) return null;

        const confidenceMatches = Array.from(chunk.matchAll(/"confidence"\s*:\s*(-?\d+(?:\.\d+)?)/g));
        if (confidenceMatches.length === 0) return null;
        const lastConfidence = confidenceMatches[confidenceMatches.length - 1];
        const confidence = Number(lastConfidence[1]);
        if (!Number.isFinite(confidence)) return null;

        const fieldData = { value, confidence };
        const evidenceMatch = afterValue.match(/^\s*,\s*"evidence"\s*:/);
        if (evidenceMatch) {
            // Best-effort: keep the mangled evidence text (minus wrapping quotes and
            // the trailing comma) rather than discarding it.
            const evidenceStart = scalarMatch[0].length + evidenceMatch[0].length;
            const evidenceEnd = lastConfidence.index;
            if (evidenceEnd > evidenceStart) {
                const evidenceText = chunk.slice(evidenceStart, evidenceEnd)
                    .trim()
                    .replace(/[\s,]+$/, '')
                    .replace(/^"|"$/g, '')
                    .trim();
                if (evidenceText) fieldData.evidence = evidenceText;
            }
        }
        return fieldData;
    }


    getAiValidationConfig(parserConfig = {}) {
        const aiConfig = parserConfig && parserConfig.ai && typeof parserConfig.ai === 'object'
            ? parserConfig.ai
            : {};
        const rawValidation = aiConfig.validation && typeof aiConfig.validation === 'object'
            ? aiConfig.validation
            : {};
        const allowWithoutEvidence = new Set(
            (Array.isArray(rawValidation.allowWithoutEvidence) ? rawValidation.allowWithoutEvidence : [])
                .map(field => this.normalizePromptFieldName(field))
                .filter(Boolean)
        );
        return {
            enabled: rawValidation.enabled !== false,
            strictDefault: rawValidation.strict !== false,
            fuzzyDescription: rawValidation.fuzzyDescription === true,
            perField: rawValidation.perField && typeof rawValidation.perField === 'object'
                ? rawValidation.perField
                : {},
            allowWithoutEvidence
        };
    }

    buildAiEvidenceContext(htmlData, parserConfig = {}) {
        const html = htmlData && typeof htmlData.html === 'string' ? htmlData.html : '';
        if (!html) {
            return {
                raw: '',
                normalized: '',
                compact: '',
                tokenSet: new Set()
            };
        }
        const aiConfig = this.getAiConfig(parserConfig);
        const bundle = this.getPromptSectionBundle(html, aiConfig);
        const sections = [bundle.title, bundle.jsonLd, bundle.metaPrimary, bundle.metaFallback, bundle.content].filter(Boolean);
        const seen = new Set();
        const sectionText = sections
            .map(section => this.sectionToText(section))
            .filter(Boolean)
            .filter(text => {
                if (seen.has(text)) return false;
                seen.add(text);
                return true;
            })
            .join('\n\n');
        const raw = sectionText || this.cleanHtml(html, aiConfig) || html;
        const normalized = this.normalizeEvidenceText(raw);
        const compact = normalized.replace(/[^a-z0-9]+/g, '');
        return {
            raw,
            normalized,
            compact,
            tokenSet: new Set(
                normalized
                    .split(' ')
                    .map(token => token.replace(/[^a-z0-9]/g, ''))
                    .filter(Boolean)
            )
        };
    }

    buildAiEvidenceContextFromText(text) {
        const raw = String(text || '');
        const normalized = this.normalizeEvidenceText(raw);
        const compact = normalized.replace(/[^a-z0-9]+/g, '');
        return {
            raw,
            normalized,
            compact,
            tokenSet: new Set(
                normalized
                    .split(' ')
                    .map(token => token.replace(/[^a-z0-9]/g, ''))
                    .filter(Boolean)
            )
        };
    }

    normalizeEvidenceText(value) {
        const htmlEntityMap = {
            amp: '&',
            nbsp: ' ',
            '#39': '\'',
            apos: '\'',
            quot: '"'
        };
        return String(value || '')
            .toLowerCase()
            .replace(/&(amp|nbsp|#39|apos|quot);/g, (match, token) => htmlEntityMap[token] || match)
            .replace(/\s+/g, ' ')
            .trim();
    }

    getFieldValidationRule(fieldName, validationConfig) {
        const normalizedField = this.normalizePromptFieldName(fieldName);
        const rawRule = validationConfig.perField && validationConfig.perField[normalizedField] && typeof validationConfig.perField[normalizedField] === 'object'
            ? validationConfig.perField[normalizedField]
            : {};
        const strict = validationConfig.allowWithoutEvidence.has(normalizedField)
            ? false
            : (Object.prototype.hasOwnProperty.call(rawRule, 'strict')
                ? Boolean(rawRule.strict)
                : Boolean(validationConfig.strictDefault));

        let mode = typeof rawRule.mode === 'string' ? rawRule.mode.trim().toLowerCase() : '';
        if (!mode) {
            if (normalizedField === 'startdate' || normalizedField === 'enddate') mode = 'date';
            else if (normalizedField === 'starttime' || normalizedField === 'endtime') mode = 'time';
            else if (normalizedField === 'location') mode = 'coords';
            else if (normalizedField === 'cover') mode = 'cover';
            else if (normalizedField === 'description') mode = validationConfig.fuzzyDescription ? 'fuzzy' : 'exact';
            else if (normalizedField === 'city') mode = 'city';
            else if (normalizedField === 'image') mode = 'image';
            else if (normalizedField === 'url' || normalizedField === 'website' || normalizedField === 'ticketurl' || normalizedField === 'instagram' || normalizedField === 'facebook' || normalizedField === 'gmaps') mode = 'url';
            else mode = 'exact';
        }

        return {
            field: normalizedField,
            strict,
            mode
        };
    }

    normalizePriceText(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/\b(us\$|usd|us dollars?|dollars?)\b/g, ' usd ')
            .replace(/\$/g, ' usd ')
            .replace(/\s*-\s*/g, '-')
            .replace(/[^a-z0-9.\- ]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    extractNumberTokens(text) {
        const matches = String(text || '').match(/-?\d+(?:\.\d+)?/g) || [];
        return Array.from(new Set(matches));
    }

    coordinateVariants(value) {
        const text = String(value || '').trim();
        if (!text) return [];
        const variants = new Set([text]);
        if (text.includes('.')) {
            variants.add(text.replace(/0+$/, '').replace(/\.$/, ''));
        }
        return Array.from(variants).filter(Boolean);
    }

    hasCoordinateEvidence(evidenceContext, value) {
        const coords = this.extractNumberTokens(value);
        if (coords.length < 2) return false;
        const raw = String(evidenceContext.raw || '');
        const firstTwo = coords.slice(0, 2);
        return firstTwo.every(coord => this.coordinateVariants(coord).some(candidate => raw.includes(candidate)));
    }

    hasExactEvidence(evidenceContext, value) {
        const normalizedValue = this.normalizeEvidenceText(value);
        if (!normalizedValue) return false;
        if (this.corpusIncludesOnWordBoundary(evidenceContext.normalized, normalizedValue)) return true;
        const compactValue = normalizedValue.replace(/[^a-z0-9]+/g, '');
        if (compactValue.length < this.extractionLimits.evidenceCompactMinLength) return false;
        // Cheap pre-check against the precomputed compact corpus before the
        // boundary-mapped scan.
        if (!evidenceContext.compact.includes(compactValue)) return false;
        return this.compactIncludesOnWordBoundary(evidenceContext.normalized, compactValue);
    }

    // Truncation is not verbatim (run 20260724-115423: model bar "79 Warren"
    // passed the gate because it is a PREFIX of the corpus's "79 WARRENTON
    // TICKETS: ..." — a copy that stops mid-word counted as verbatim). A
    // containment hit only counts when the matched span sits on WORD
    // BOUNDARIES in the corpus: no alphanumeric-to-alphanumeric junction at
    // either edge of the span. A span edge that is itself non-alphanumeric
    // (quotes, apostrophes) needs no boundary on that side. So "legacy" in
    // "legacy's" passes (apostrophe bounds), "eagle" in "eagle bar" passes
    // (space bounds), "79 warren" in "79 warrenton" fails (the span runs
    // straight into "ton"). Case-insensitivity and whitespace flexibility are
    // unchanged — both strings are already normalizeEvidenceText output.
    corpusIncludesOnWordBoundary(corpus, needle) {
        const haystack = String(corpus || '');
        const target = String(needle || '');
        if (!target) return false;
        const wordChar = /[a-z0-9]/;
        const needsLeftBoundary = wordChar.test(target[0]);
        const needsRightBoundary = wordChar.test(target[target.length - 1]);
        let from = 0;
        let index;
        while ((index = haystack.indexOf(target, from)) !== -1) {
            const leftOk = !needsLeftBoundary || index === 0 || !wordChar.test(haystack[index - 1]);
            const end = index + target.length;
            const rightOk = !needsRightBoundary || end === haystack.length || !wordChar.test(haystack[end]);
            if (leftOk && rightOk) return true;
            from = index + 1;
        }
        return false;
    }

    // The compact fallback (all non-alphanumerics stripped) must not
    // reintroduce the truncation hole: every compact hit is mapped back to
    // its span in the NORMALIZED corpus — where separators still exist — and
    // the same word-boundary rule is applied at the span's edges there.
    // "79warren" inside "79warrenton..." maps to a normalized span followed
    // by "t" and fails; "rockbar" matching the corpus's "rock bar" still
    // passes (the mapped span is space-bounded).
    compactIncludesOnWordBoundary(normalizedCorpus, compactValue) {
        const corpus = String(normalizedCorpus || '');
        const target = String(compactValue || '');
        if (!target) return false;
        const wordChar = /[a-z0-9]/;
        // Map every compact character back to its index in the normalized
        // corpus (compact is normalized with [^a-z0-9] stripped, by
        // construction — see buildAiEvidenceContext).
        const map = [];
        let compact = '';
        for (let i = 0; i < corpus.length; i++) {
            if (wordChar.test(corpus[i])) {
                compact += corpus[i];
                map.push(i);
            }
        }
        let from = 0;
        let index;
        while ((index = compact.indexOf(target, from)) !== -1) {
            const start = map[index];
            const end = map[index + target.length - 1];
            const leftOk = start === 0 || !wordChar.test(corpus[start - 1]);
            const rightOk = end === corpus.length - 1 || !wordChar.test(corpus[end + 1]);
            if (leftOk && rightOk) return true;
            from = index + 1;
        }
        return false;
    }

    hasFuzzyEvidence(evidenceContext, value) {
        if (this.hasExactEvidence(evidenceContext, value)) return true;
        const rawTokens = this.normalizeEvidenceText(value).split(' ');
        let tokenCount = 0;
        let matched = 0;
        for (const rawToken of rawTokens) {
            const token = String(rawToken || '').replace(/[^a-z0-9]/g, '');
            if (token.length < this.extractionLimits.fuzzyDescriptionMinTokenLength) continue;
            tokenCount++;
            if (evidenceContext.tokenSet.has(token)) {
                matched++;
            }
        }
        if (tokenCount === 0) return false;
        const required = Math.max(
            this.extractionLimits.fuzzyDescriptionMinTokenMatches,
            Math.ceil(tokenCount * this.extractionLimits.fuzzyDescriptionTokenMatchRatio)
        );
        return matched >= required;
    }

    hasCoverEvidence(evidenceContext, value) {
        const text = this.normalizeEvidenceText(value);
        if (!text) return false;

        const freePattern = /\bfree\b/i;
        const containsFree = freePattern.test(text);
        if (containsFree && !freePattern.test(evidenceContext.normalized)) {
            return false;
        }

        if (this.hasExactEvidence(evidenceContext, text)) {
            return true;
        }

        const normalizedPrice = this.normalizePriceText(text);
        const normalizedEvidencePrice = this.normalizePriceText(evidenceContext.raw);
        if (normalizedPrice && normalizedEvidencePrice.includes(normalizedPrice)) {
            return true;
        }

        const nums = this.extractNumberTokens(text)
            .map(num => String(num || '').replace(/^-/, ''))
            .filter(Boolean);
        if (nums.length > 0) {
            const raw = String(evidenceContext.raw || '');
            const variantCache = new Map();
            const allNumbersFound = nums.every(num => {
                if (!variantCache.has(num)) {
                    variantCache.set(num, this.coordinateVariants(num));
                }
                return variantCache.get(num).some(candidate => raw.includes(candidate));
            });
            if (allNumbersFound) {
                if (!containsFree) return true;
                return freePattern.test(evidenceContext.normalized);
            }
        }

        return false;
    }

    hasUrlEvidence(evidenceContext, value) {
        const rawText = String(value || '').trim();
        if (!rawText) return false;
        // Bare-domain values ("WWW.MASSIVE.CLUB", "bearracuda.com") fail strict URL
        // normalization but are still verifiable verbatim against the source —
        // normalize them by prefixing a scheme instead of rejecting outright.
        const normalized = this.normalizeHttpUrlValue(rawText)
            || this.normalizeHttpUrlValue(`https://${rawText}`);
        if (normalized && this.hasExactEvidence(evidenceContext, normalized)) {
            return true;
        }
        if (typeof normalized === 'string') {
            const withoutProtocol = normalized.replace(/^https?:\/\//i, '');
            if (this.hasExactEvidence(evidenceContext, withoutProtocol)) {
                return true;
            }
            if (withoutProtocol.startsWith('www.')) {
                const withoutWww = withoutProtocol.replace(/^www\./i, '');
                if (this.hasExactEvidence(evidenceContext, withoutWww)) {
                    return true;
                }
            }
        }
        return this.hasExactEvidence(evidenceContext, rawText);
    }

    extractDateEvidenceParts(value) {
        const rawValue = String(value || '').trim();
        if (!rawValue) return null;
        const isoMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2})(?::?(\d{2}))?(?::?(\d{2}))?)?/);
        if (isoMatch) {
            return {
                year: parseInt(isoMatch[1], 10),
                month: parseInt(isoMatch[2], 10),
                day: parseInt(isoMatch[3], 10),
                hour: parseInt(isoMatch[4] || '0', 10),
                minute: parseInt(isoMatch[5] || '0', 10),
                hasTime: Boolean(isoMatch[4])
            };
        }
        const parsed = this.parseDateValue(rawValue);
        if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
            return {
                year: parsed.getFullYear(),
                month: parsed.getMonth() + 1,
                day: parsed.getDate(),
                hour: parsed.getHours(),
                minute: parsed.getMinutes(),
                hasTime: /\d{1,2}:\d{2}|\b\d{1,2}\s*(?:am|pm)\b/i.test(rawValue)
            };
        }
        // Handle time-only strings (e.g., "22:00", "10pm", "10:30pm") that parseDateValue can't parse
        // Extract hour and minute using regex for formats like HH:MM, HH:MMpm, HHpm
        const timeOnlyMatch = rawValue.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
        if (timeOnlyMatch) {
            let hour = parseInt(timeOnlyMatch[1], 10);
            const minute = timeOnlyMatch[2] ? parseInt(timeOnlyMatch[2], 10) : 0;
            const suffix = timeOnlyMatch[3] ? timeOnlyMatch[3].toLowerCase() : null;

            // Convert to 24-hour format
            if (suffix === 'pm' && hour !== 12) hour += 12;
            if (suffix === 'am' && hour === 12) hour = 0;

            if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                return {
                    year: null,
                    month: null,
                    day: null,
                    hour: hour,
                    minute: minute,
                    hasTime: true
                };
            }
        }
        return null;
    }

    buildDateEvidenceVariants(dateParts) {
        if (!dateParts) return [];
        const monthIndex = Number(dateParts.month) - 1;
        if (!Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) return [];
        const day = Number(dateParts.day);
        if (!Number.isFinite(day) || day <= 0 || day > 31) return [];
        const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const monthShortNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const month = Number(dateParts.month);
        const year = Number(dateParts.year);
        const variants = new Set([
            `${monthNames[monthIndex]} ${day}`,
            `${monthShortNames[monthIndex]} ${day}`,
            `${month}/${day}`,
            `${String(month).padStart(2, '0')}/${day}`,
            `${month}/${String(day).padStart(2, '0')}`,
            `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`,
            `${month}-${day}`,
            `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        ]);
        if (Number.isFinite(year) && year > 0) {
            variants.add(`${monthNames[monthIndex]} ${day}, ${year}`);
            variants.add(`${monthShortNames[monthIndex]} ${day}, ${year}`);
            variants.add(`${month}/${day}/${year}`);
            variants.add(`${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`);
        }
        // Add range variants for dates that might appear in a range format (e.g., "Aug 21-23")
        // These help match cases like "AUG 21-23, 2026" when we're validating a specific date
        if (Number.isFinite(year) && year > 0) {
            variants.add(`${monthNames[monthIndex]} ${day}-${year}`);
            variants.add(`${monthShortNames[monthIndex]} ${day}-${year}`);
            variants.add(`${month}/${day}-${year}`);
            variants.add(`${String(month).padStart(2, '0')}/${day}-${year}`);
            // Add variants with dash prefix for range format (e.g., "21-23" contains "23")
            variants.add(`-${day}`);
            variants.add(`-${String(day).padStart(2, '0')}`);
            // Add variants with comma suffix for format like "Aug 23, 2026"
            variants.add(`${monthNames[monthIndex]} ${day},`);
            variants.add(`${monthShortNames[monthIndex]} ${day},`);
            variants.add(`${String(day).padStart(2, '0')},`);
        }
        return Array.from(variants).filter(Boolean);
    }

    buildTimeEvidenceVariants(dateParts) {
        if (!dateParts || !dateParts.hasTime) return [];
        const hour24 = Number(dateParts.hour);
        const minute = Number(dateParts.minute);
        if (!Number.isFinite(hour24) || !Number.isFinite(minute)) return [];
        const suffix = hour24 >= 12 ? 'pm' : 'am';
        const hour12Base = hour24 % 12;
        const hour12 = hour12Base === 0 ? 12 : hour12Base;
        const paddedMinute = String(Math.max(0, minute)).padStart(2, '0');
        const variants = new Set([
            `${hour24}:${paddedMinute}`,
            `${String(hour24).padStart(2, '0')}:${paddedMinute}`
        ]);
        if (minute === 0) {
            variants.add(`${hour12}${suffix}`);
            variants.add(`${hour12} ${suffix}`);
            variants.add(`${hour12}:00${suffix}`);
            variants.add(`${hour12}:00 ${suffix}`);
        } else {
            variants.add(`${hour12}:${paddedMinute}${suffix}`);
            variants.add(`${hour12}:${paddedMinute} ${suffix}`);
        }
        return Array.from(variants).filter(Boolean);
    }

    hasDateEvidence(evidenceContext, value) {
        const dateParts = this.extractDateEvidenceParts(value);
        if (!dateParts) {
            return this.hasExactEvidence(evidenceContext, value);
        }
        const normalizedEvidence = String(evidenceContext && evidenceContext.normalized ? evidenceContext.normalized : '');
        if (!normalizedEvidence) return false;
        const hasDateMatch = this.buildDateEvidenceVariants(dateParts)
            .some(variant => normalizedEvidence.includes(variant));
        if (!hasDateMatch) return false;
        if (!dateParts.hasTime) return true;
        // T00:00 is the pipeline's "no time stated" placeholder (see
        // isInventedMidnight in normalizeAiEvent) — not a time claim.
        if (Number(dateParts.hour) === 0 && Number(dateParts.minute) === 0) return true;
        const timeVariants = this.buildTimeEvidenceVariants(dateParts);
        if (timeVariants.length === 0) return true;
        if (timeVariants.some(variant => normalizedEvidence.includes(variant))) return true;
        // The claimed time component must appear somewhere in the source in a
        // recognized format — hasTimeEvidence also understands OCR forms ("01H",
        // "@10", "noon"/"midnight"). Times are never merge-arbitrated downstream
        // (scraped clobbers), so an invented time here would flow straight into
        // calendars; if the source never states it, drop the field.
        const timeComponent = `${String(Number(dateParts.hour)).padStart(2, '0')}:${String(Math.max(0, Number(dateParts.minute) || 0)).padStart(2, '0')}`;
        return this.hasTimeEvidence(evidenceContext, timeComponent);
    }

    hasTimeEvidence(evidenceContext, value) {
        const normalizedEvidence = String(evidenceContext && evidenceContext.normalized ? evidenceContext.normalized : '');
        if (!normalizedEvidence) return false;

        // Normalize the value to HH:MM format
        const normalizedTime = normalizeStartTimeValue(value);
        if (!normalizedTime) return false;

        // Build time format variants (22:00, 10pm, 10:00pm, etc.)
        const timeParts = this.extractDateEvidenceParts(normalizedTime);
        if (!timeParts || !timeParts.hasTime) return false;
        const variants = this.buildTimeEvidenceVariants(timeParts);
        if (variants.length === 0) return false;

        // Check if any variant exists in the evidence context (case-insensitive)
        const lowerEvidence = normalizedEvidence.toLowerCase();
        if (variants.some(variant => lowerEvidence.includes(variant.toLowerCase()))) {
            return true;
        }

        // Midnight and noon are written as words, not digits
        if (normalizedTime === '00:00' && /\bmidnight\b/.test(lowerEvidence)) return true;
        if (normalizedTime === '12:00' && /\bnoon\b/.test(lowerEvidence)) return true;

        // Also check for OCR-specific formats in raw evidence
        const rawEvidence = String(evidenceContext && evidenceContext.raw ? evidenceContext.raw : '');
        const lowerRaw = rawEvidence.toLowerCase();

        // Extract hour from normalized time for matching
        const hour24 = parseInt(normalizedTime.split(':')[0], 10);
        const hour12 = hour24 % 12 || 12;

        // Pattern 1: @HH, @HHmm, @HH H, 01H, 10PM (OCR time indicators).
        // A BARE number is NOT time evidence — "MAY 3", "$3" or a street number
        // must never corroborate an invented "03:00" (observed on-device: endTime
        // 03:00 whose evidence said "interpreted as ~3am" passed on a stray
        // digit). Require an explicit time marker: an @/"at" prefix or an
        // H/am/pm suffix. Colon forms ("22:00", "10:30pm") are covered by the
        // variant path above and the standalone path below.
        const ocrTimePattern = /(?:(@|\bat\s+)|^|[\s,"'`(])(\d{1,2})(?::?(\d{2}))?\s*(h\b|[ap]m)?/gi;
        let ocrMatch;
        while ((ocrMatch = ocrTimePattern.exec(lowerRaw)) !== null) {
            const hasTimeMarkerPrefix = Boolean(ocrMatch[1]);
            const ocrHour = parseInt(ocrMatch[2], 10);
            const ocrSuffix = ocrMatch[4] ? ocrMatch[4].trim().toLowerCase() : null;
            if (!hasTimeMarkerPrefix && !ocrSuffix) continue; // bare number — not a time

            // Convert OCR hour to 24-hour format
            let ocrHour24 = ocrHour;
            if (ocrSuffix === 'pm' && ocrHour !== 12) ocrHour24 += 12;
            if (ocrSuffix === 'am' && ocrHour === 12) ocrHour24 = 0;
            if (ocrSuffix === 'h') ocrHour24 = ocrHour; // military format

            if (ocrHour24 === hour24) {
                return true;
            }
        }

        // Pattern 2: Standalone time formats (e.g., "10pm", "10:00pm", "22:00")
        // Use word boundary instead of end-of-string anchor for OCR text
        const standaloneTimePattern = /(?:^|[\s,;"'`(])(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/gi;
        let standaloneMatch;
        while ((standaloneMatch = standaloneTimePattern.exec(lowerRaw)) !== null) {
            const ocrTime = standaloneMatch[1];
            const ocrNormalized = normalizeStartTimeValue(ocrTime);
            if (ocrNormalized === normalizedTime) {
                return true;
            }
        }

        return false;
    }

    normalizeHttpUrlValue(value) {
        const normalized = this.normalizeUrl(String(value || '').trim(), '');
        if (!normalized) return '';
        const parsed = this.parseUrlComponents(normalized);
        if (!parsed) return '';
        if (!/^https?:$/.test(String(parsed.protocol || '').toLowerCase())) return '';
        return String(parsed.href || '').trim();
    }

    extractSearchParamValue(search, key) {
        if (!search || !key) return '';
        const normalizedKey = String(key).trim().toLowerCase();
        const searchText = String(search).replace(/^\?/, '');
        if (!normalizedKey || !searchText) return '';
        const pairs = searchText.split('&');
        for (const pair of pairs) {
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

    unwrapImageProxyUrl(url, unwrapDepth = 0) {
        const normalized = this.normalizeHttpUrlValue(url);
        if (!normalized) return '';
        if (unwrapDepth > this.maxUrlUnwrapDepth) return normalized;

        const parsed = this.parseUrlComponents(normalized);
        if (!parsed) return normalized;
        const path = String(parsed.pathname || '');
        const search = String(parsed.search || '');
        const isProxyPath = this.proxyImagePathPrefixes.some(prefix => {
            const normalizedPrefix = String(prefix || '').replace(/\?.*$/, '');
            return normalizedPrefix && path.startsWith(normalizedPrefix);
        });
        if (!isProxyPath) return normalized;

        const wrapped = this.extractSearchParamValue(search, 'url');
        if (!wrapped) return normalized;
        const decodedWrapped = this.decodeUrlEscapes(this.decodeBasicEntities(wrapped));
        const wrappedNormalized = this.normalizeUrl(decodedWrapped, normalized);
        if (!wrappedNormalized) return normalized;
        return this.unwrapImageProxyUrl(wrappedNormalized, unwrapDepth + 1);
    }

    hasSupportedImageFilenameAtEnd(url) {
        const parsed = this.parseUrlComponents(url);
        if (!parsed) return false;
        const pathname = String(parsed.pathname || '').toLowerCase();
        if (!pathname || pathname.endsWith('/')) return false;
        return this.supportedImageExtensions.some(ext => pathname.endsWith(ext));
    }

    buildImageEvidenceContext(htmlData) {
        const html = htmlData && typeof htmlData.html === 'string' ? htmlData.html : '';
        const sourceUrl = htmlData && typeof htmlData.url === 'string' ? htmlData.url : '';
        const imageUrls = new Set();
        if (!html) return imageUrls;

        const rawCandidates = new Set(this.extractUrlCandidatesFromRawHtml(html));
        const attrPatterns = [
            /\b(?:src|data-src|data-lazy-src|poster|content)=["']([^"']+)["']/gi,
            /\bsrcset=["']([^"']+)["']/gi
        ];
        for (const pattern of attrPatterns) {
            for (const match of html.matchAll(pattern)) {
                const attributeValue = String(match[1] || '').trim();
                if (!attributeValue) continue;
                if (pattern.source.includes('srcset')) {
                    attributeValue.split(',').forEach(part => {
                        const candidate = String(part || '').trim().split(/\s+/)[0];
                        if (candidate) rawCandidates.add(candidate);
                    });
                } else {
                    rawCandidates.add(attributeValue);
                }
            }
        }

        rawCandidates.forEach(candidate => {
            const normalized = this.normalizeUrl(candidate, sourceUrl);
            if (!normalized) return;
            const unwrapped = this.unwrapImageProxyUrl(normalized);
            const finalUrl = this.normalizeHttpUrlValue(unwrapped || normalized);
            if (!finalUrl) return;
            if (!this.hasSupportedImageFilenameAtEnd(finalUrl) && !this.hasLikelyImageUrl(finalUrl)) return;
            imageUrls.add(finalUrl);
        });

        return imageUrls;
    }

    buildImageEvidenceContextFromText(text, sourceUrl = '') {
        const source = String(text || '');
        const imageUrls = new Set();
        if (!source) return imageUrls;
        const rawCandidates = new Set(this.extractUrlCandidatesFromRawHtml(source));
        for (const match of source.matchAll(this.inlineUrlPattern)) {
            const candidate = String(match[0] || '').trim();
            if (candidate) rawCandidates.add(candidate);
        }
        rawCandidates.forEach(candidate => {
            const normalized = this.normalizeUrl(candidate, sourceUrl);
            if (!normalized) return;
            const unwrapped = this.unwrapImageProxyUrl(normalized);
            const finalUrl = this.normalizeHttpUrlValue(unwrapped || normalized);
            if (!finalUrl) return;
            if (!this.hasSupportedImageFilenameAtEnd(finalUrl) && !this.hasLikelyImageUrl(finalUrl)) return;
            imageUrls.add(finalUrl);
        });
        return imageUrls;
    }

    hasLikelyImageUrl(url) {
        const parsed = this.parseUrlComponents(String(url || ''));
        if (!parsed) return false;
        const path = String(parsed.pathname || '').toLowerCase();
        const search = String(parsed.search || '').toLowerCase();
        if (this.proxyImagePathPrefixes.some(prefix => {
            const normalizedPrefix = String(prefix || '').replace(/\?.*$/, '').toLowerCase();
            return normalizedPrefix && path.startsWith(normalizedPrefix);
        })) {
            return true;
        }
        if (this.likelyImagePathRegex.test(path)) {
            return true;
        }
        return this.likelyImageQueryRegex.test(search);

    }

    hasImageEvidence(validationContext, value) {
        const imageContext = validationContext && validationContext.imageEvidenceUrls instanceof Set
            ? validationContext.imageEvidenceUrls
            : null;
        if (!imageContext || imageContext.size === 0) return false;

        const normalized = this.normalizeHttpUrlValue(value);
        if (!normalized) return false;
        const unwrapped = this.unwrapImageProxyUrl(normalized);
        const finalUrl = this.normalizeHttpUrlValue(unwrapped || normalized);
        if (!finalUrl) return false;
        if (!this.hasSupportedImageFilenameAtEnd(finalUrl) && !this.hasLikelyImageUrl(finalUrl)) return false;
        return imageContext.has(finalUrl);
    }

    hasFieldEvidence(evidenceContext, value, mode, validationContext = null) {
        if (value === null || value === undefined) return false;
        const valueText = String(value).trim();
        if (!valueText) return false;
        switch (mode) {
            case 'none':
                return true;
            case 'coords':
                return this.hasCoordinateEvidence(evidenceContext, valueText);
            case 'date':
                return this.hasDateEvidence(evidenceContext, valueText);
            case 'time':
                return this.hasTimeEvidence(evidenceContext, valueText);
            case 'cover':
                return this.hasCoverEvidence(evidenceContext, valueText);
            case 'fuzzy':
                return this.hasFuzzyEvidence(evidenceContext, valueText);
            case 'city':
                return this.hasCityEvidence(evidenceContext, valueText, validationContext);
            case 'url':
                return this.hasUrlEvidence(evidenceContext, valueText);
            case 'image':
                return this.hasImageEvidence(validationContext, valueText);
            case 'exact':
            default:
                return this.hasExactEvidence(evidenceContext, valueText);
        }
    }

    // === Validation Helper Methods ===

    /**
     * Check if a field should be validated at all.
     * Returns null if valid to continue, or a drop/bypass reason string.
     */
    getFieldValidationStatus(key, aiEvent, rule, requestedFields, trustedFields, report) {
        if (this.isInternalAiFieldKey(key)) {
            return 'skip-internal';
        }

        const value = aiEvent[key];
        if (!this.isUsableAiFieldValue(value)) {
            report.dropped.push({ field: rule.field, key, mode: rule.mode, reason: 'not-usable' });
            return 'drop-not-usable';
        }

        if (requestedFields && !requestedFields.has(rule.field)) {
            report.dropped.push({ field: rule.field, key, mode: rule.mode, reason: 'not-requested' });
            return 'drop-not-requested';
        }

        if (!rule.strict) {
            report.bypassed.push({ field: rule.field, key, reason: 'override-allow-without-evidence' });
            return 'bypass-strictness';
        }

        if (trustedFields.has(rule.field)) {
            report.bypassed.push({ field: rule.field, key, reason: 'previous-step-validated' });
            return 'bypass-trusted';
        }

        return null; // Continue to evidence check
    }

    /**
     * True when the value claims a specific time of day: time-mode fields
     * (startTime/endTime) always do; date-mode fields (start/end/startDate/
     * endDate) only when they carry a non-midnight time component — T00:00 is
     * the pipeline's "no time stated" placeholder (see isInventedMidnight in
     * normalizeAiEvent) and must never be treated as a time claim.
     */
    valueClaimsTimeOfDay(mode, value) {
        if (mode === 'time') return true;
        if (mode !== 'date') return false;
        const parts = this.extractDateEvidenceParts(String(value === null || value === undefined ? '' : value));
        if (!parts || !parts.hasTime) return false;
        return !(Number(parts.hour) === 0 && Number(parts.minute) === 0);
    }

    /**
     * Tell-tale inference language in a model evidence string: the model is
     * admitting it derived the value ("interpreted as ~3am (common club close
     * time)", "no explicit end time") instead of quoting the source. Used to
     * fail time-value corroboration even when some time-like token matches.
     */
    evidenceAdmitsInference(evidence) {
        const text = String(evidence || '').toLowerCase();
        if (!text) return false;
        return /\b(?:interpret(?:ed|s|ing)?|assum(?:e|ed|es|ing|ption)|typical(?:ly)?|common(?:ly)?|inferr?(?:ed|ing)?|infers?|guess(?:ed|ing)?|estimat(?:e|ed|es|ing)|presum(?:e|ed|es|ing|ably)|probabl[ey]|likely|usually|implie[ds]|implicit(?:ly)?)\b|no explicit|not (?:stated|shown|specified|listed|visible|explicit)/.test(text);
    }

    /**
     * END-marker-cited evidence for a START field: the model quotes an
     * "End at:" / "Ends" / "until" / "doors close" line as the source of a
     * start value — that text states the event's END, so the start value is
     * misattributed end data (run 20260724-155934: startTime "02:00" with
     * evidence "End at: July 26, 2026 - 2:00 am" at confidence 90).
     * Deliberately fails open when the evidence also carries a start-side
     * signal: a time stated BEFORE the marker ("9PM TIL LATE", "Doors 8pm
     * until 2am") or an explicit start/doors-open/from phrase means the cited
     * value may genuinely be the start, so today's behavior is kept.
     */
    evidenceCitesEndMarker(evidence) {
        const text = String(evidence || '').trim();
        if (!text) return false;
        const endMarker = text.match(/\bend(?:s|ed|ing)?\s*(?:at\b|:|by\b)|\bdoors?\s+clos(?:e|es|ed|ing)\b|\bclos(?:e|es|ed|ing)\s+at\b|\buntil\b|\btill?\b|'til+\b/i);
        if (!endMarker) return false;
        // A time of day stated BEFORE the end marker is the start portion of
        // a range — the cited value may be that start. Fail open.
        const beforeMarker = text.slice(0, endMarker.index);
        if (/\d{1,2}:\d{2}|\b\d{1,2}\s*(?:am|pm|h)\b/i.test(beforeMarker)) return false;
        // An explicit start-side phrase anywhere is likewise disqualifying.
        const startMarker = /\bstart(?:s|ed|ing)?\s*(?:at\b|:|@)|\bbegin(?:s|ning)?\s*(?:at\b|:|@)|\bdoors?\s*(?:open\b|@|at\b)|\bfrom\s*\d/i;
        return !startMarker.test(text);
    }

    /**
     * Evidence citing the ADDITIONAL CONTEXT block. That block is injected
     * with an explicit DO-NOT-EXTRACT instruction, so evidence referencing it
     * is a violation by definition — for ANY field. Observed in run
     * 20260723-123149: city "new york" kept on evidence ending "additional
     * context specifies NYC" after a hallucinated vision summary poisoned the
     * context block.
     */
    evidenceCitesAdditionalContext(evidence) {
        const text = String(evidence || '').toLowerCase();
        if (!text) return false;
        return text.includes('additional context')
            || text.includes('context specifies')
            || text.includes('per the context')
            || text.includes('disambiguation context');
    }

    // Brand/domain token corpus for the city evidence gate: the page's derived
    // organizer/brand names (the same data the KNOWN ORGANIZER steering line
    // uses — see getPageBrandNames), their individual words, plus the source
    // host and its labels ("furball.nyc" → "furball.nyc", "furball", "nyc").
    // www and generic infrastructure TLD labels are excluded so evidence
    // merely containing "com"/"org" never classifies as brand-citing; tokens
    // under 3 chars are skipped. Cached per page on htmlData like
    // getPageBrandNames.
    getPageBrandDomainTokens(htmlData) {
        if (!htmlData || typeof htmlData !== 'object') return [];
        if (Array.isArray(htmlData.pageBrandDomainTokens)) return htmlData.pageBrandDomainTokens;
        const tokens = new Set();
        const add = value => {
            const text = this.normalizeEvidenceText(value);
            if (text && text.length >= 3) tokens.add(text);
        };
        this.getPageBrandNames(htmlData).forEach(name => {
            add(name);
            String(name || '').split(/\s+/).forEach(add);
        });
        const components = this.parseUrlComponents(typeof htmlData.url === 'string' ? htmlData.url : '');
        const host = components && components.hostname
            ? components.hostname.split(':')[0].replace(/^www\./, '')
            : '';
        if (host) {
            add(host);
            const genericLabels = new Set(['www', 'com', 'org', 'net', 'edu', 'gov', 'mil', 'info', 'biz', 'app', 'dev', 'web', 'site', 'online', 'html', 'htm']);
            host.split('.').forEach(label => {
                if (!genericLabels.has(label)) add(label);
            });
        }
        const list = Array.from(tokens);
        if (Object.isExtensible(htmlData)) {
            htmlData.pageBrandDomainTokens = list;
        }
        return list;
    }

    /**
     * Promoter branding is not a location: city evidence that cites the
     * page's organizer/brand or its domain labels ("WWW.FURBALL.NYC", bare
     * "NYC" on a .nyc host) and nothing else location-like fails
     * corroboration. An explicit "<Place>, <Place>" form in the same evidence
     * string ("Torremolinos, Spain", "Asbury Park, NJ") rescues it — the
     * evidence is then citing a real location statement, not just branding.
     * Unclassifiable evidence fails open (returns false → today's behavior).
     */
    cityEvidenceCitesBrandOnly(evidence, brandTokens) {
        const evidenceText = String(evidence || '');
        if (!evidenceText || !Array.isArray(brandTokens) || brandTokens.length === 0) return false;
        const normalized = this.normalizeEvidenceText(evidenceText);
        if (!normalized) return false;
        const citesBrand = brandTokens.some(token => this.textContainsCityAlias(normalized, token));
        if (!citesBrand) return false;
        const locationForm = /[A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*)*,\s+[A-Z][A-Za-z]/.test(evidenceText);
        return !locationForm;
    }

    /**
     * Validate a single field value against evidence.
     * Returns true if valid, false if should be dropped.
     */
    validateFieldValueAgainstEvidence(key, value, rule, evidenceContext, validationContext, report, modelEvidence = '', brandTokens = null, rescueContext = null) {
        // The ADDITIONAL CONTEXT block carries an explicit DO-NOT-EXTRACT
        // instruction, so evidence citing it fails corroboration for ANY field
        // (see evidenceCitesAdditionalContext).
        const citesForbiddenContext = this.evidenceCitesAdditionalContext(modelEvidence);
        // Promoter branding is not a location: city evidence citing only the
        // page's organizer/brand or domain labels fails corroboration (see
        // cityEvidenceCitesBrandOnly).
        const brandOnlyCityEvidence = !citesForbiddenContext
            && rule.field === 'city'
            && this.cityEvidenceCitesBrandOnly(modelEvidence, brandTokens);
        // Times are never merge-arbitrated downstream (scraped clobbers), so an
        // invented time here flows straight into calendars. A time value whose
        // own evidence string admits inference fails corroboration outright —
        // even if some time-like token in the source happens to match (observed
        // on-device: endTime "03:00" with evidence "LATE in OCR_IMAGE_TEXT —
        // interpreted as ~3am (common club close time)" passed the gate).
        const inventedTime = this.valueClaimsTimeOfDay(rule.mode, value)
            && this.evidenceAdmitsInference(modelEvidence);
        // START fields whose model-cited evidence is an END-marker line
        // ("End at: August 1, 2026 - 2:00 am" — run 20260724-155934) carry
        // misattributed END data: the value is often verbatim in the corpus
        // (the 2:00 am IS on the page), so corroboration alone cannot catch
        // it. Its own rejection class; the value is not kept as start.
        const endMarkerStart = !citesForbiddenContext
            && END_MARKER_START_FIELDS.has(rule.field)
            && this.evidenceCitesEndMarker(modelEvidence);
        const hasEvidence = !citesForbiddenContext
            && !brandOnlyCityEvidence
            && !inventedTime
            && !endMarkerStart
            && this.hasFieldEvidence(evidenceContext, value, rule.mode, validationContext);
        if (!hasEvidence) {
            const droppedEntry = {
                field: rule.field,
                key,
                mode: rule.mode,
                value: this.trimToMaxLength(String(value), this.extractionLimits.validationReportValueMaxLength)
            };
            // Additive diagnostics for the new evidence-quality drops only —
            // pre-existing drop entries keep their exact shape.
            if (citesForbiddenContext) droppedEntry.reason = 'context-cited-evidence';
            else if (brandOnlyCityEvidence) droppedEntry.reason = 'brand-cited-evidence';
            else if (endMarkerStart) droppedEntry.reason = END_MARKER_CITED_REASON;
            report.dropped.push(droppedEntry);
            // Reassignment candidate (reassign, don't discard): the dropped
            // start value is evidence-cited END data — but only when the
            // value itself is corroborated by the corpus under the SAME mode
            // (date/time modes are identical for start and end fields). An
            // uncorroborated value stays dropped: reassigning it would smuggle
            // an invented time past the gate into the end field.
            if (endMarkerStart && this.hasFieldEvidence(evidenceContext, value, rule.mode, validationContext)) {
                if (!Array.isArray(report.endMarkerReassignments)) report.endMarkerReassignments = [];
                report.endMarkerReassignments.push({ field: rule.field, key, value: String(value) });
            }
            // Evidence-pointer rescue (LOG-ONLY observation, additive): runs
            // AFTER the drop is recorded and never changes it. Eligible only
            // when the drop's sole cause is "value not verbatim in corpus" —
            // evidence-quality rejections (context-citing, brand-citing,
            // invented-time) mean the pointer itself is rotten.
            this.maybeCollectEvidencePointerRescue(value, rule, report, modelEvidence, evidenceContext, rescueContext, {
                citesForbiddenContext,
                brandOnlyCityEvidence,
                inventedTime,
                endMarkerStart
            });
            return false;
        }
        report.kept.push({ field: rule.field, key, mode: rule.mode });
        return true;
    }

    // === Evidence-Pointer Rescue (LOG-ONLY observation phase) ===
    // "Trust the pointer, not the copy": when the gate drops a scoped field
    // (EVIDENCE_RESCUE_FIELDS) because the VALUE is not verbatim in the
    // corpus, but the model's EVIDENCE string IS a verbatim corpus quote, a
    // candidate value is derived from the CORPUS'S OWN characters/casing and
    // logged + stashed for the results-UI evidence panel. Nothing is adopted
    // and no event data changes — the gate's accept/reject decisions are
    // untouched. Bear-website reality shapes this code: broken markup,
    // ALL-CAPS flyers, OCR noise, curly quotes and typos IN THE SOURCE are
    // all normal, so matching is case-insensitive and whitespace-flexible,
    // only raw text corpora are consulted (never structured data), and
    // "cannot locate the evidence" is a silent no-op — the common case, not
    // an error.

    // Collect a rescue candidate for a just-dropped field. Additive only:
    // appends to report.evidenceRescues (lazily created) and logs one line.
    // Any internal failure is swallowed — observation must never affect the
    // gate.
    maybeCollectEvidencePointerRescue(value, rule, report, modelEvidence, evidenceContext, rescueContext, dropFlags = {}) {
        try {
            if (!EVIDENCE_RESCUE_FIELDS.has(rule.field)) return;
            // ONLY the plain "value not verbatim" rejection class qualifies.
            if (dropFlags && (dropFlags.citesForbiddenContext || dropFlags.brandOnlyCityEvidence || dropFlags.inventedTime || dropFlags.endMarkerStart)) return;
            const evidence = String(modelEvidence || '').trim();
            if (!evidence) return;
            // Inference language or context citations anywhere in the
            // evidence = untrustworthy pointer (the first-pass FURBALL shape:
            // 'OCR_IMAGE_TEXT: "79 WARRENTON"; Additional context clarifies
            // as "79 Warrenon" — likely a typo for "Warren"'). No rescue.
            if (this.evidenceAdmitsInference(evidence)) return;
            if (this.evidenceCitesAdditionalContext(evidence)) return;
            const rescue = this.deriveEvidencePointerRescue(String(value), evidence, evidenceContext, rescueContext);
            if (!rescue || !rescue.candidate) return;
            // An address-shaped candidate is useless FOR THE BAR FIELD (a
            // bar rescue candidate "79 WARRENTON" could never be adopted —
            // the bar plausibility gate would drop it): suppress silently.
            // Address-field candidates are unaffected.
            if (rule.field === 'bar' && this.isAddressShapedBarValue(rescue.candidate)) return;
            const entry = {
                field: rule.field,
                candidate: this.trimToMaxLength(rescue.candidate, this.extractionLimits.validationReportValueMaxLength),
                modelValue: this.trimToMaxLength(String(value), this.extractionLimits.validationReportValueMaxLength),
                corpus: rescue.corpus
            };
            if (!Array.isArray(report.evidenceRescues)) report.evidenceRescues = [];
            report.evidenceRescues.push(entry);
            console.log(`🤖 AI Web: Evidence-pointer rescue (log-only) for ${entry.field}: corpus has "${entry.candidate}" where model wrote "${entry.modelValue}" (evidence located in ${entry.corpus} text)`);
        } catch (err) {
            this.logDebug(`🤖 AI Web: Evidence-pointer rescue observation failed silently: ${err && err.message ? err.message : err}`);
        }
    }

    // Derive the candidate from the first evidence fragment that locates in a
    // corpus: token-align the model's mangled value inside the located span
    // (corpus casing wins), falling back to the whole located fragment when no
    // alignment is found. Returns { candidate, corpus } or null.
    deriveEvidencePointerRescue(modelValue, modelEvidence, evidenceContext, rescueContext) {
        const fragments = this.extractEvidenceQuoteFragments(modelEvidence);
        for (const fragment of fragments) {
            const located = this.locateEvidenceRescueSpan(fragment, evidenceContext, rescueContext);
            if (!located) continue;
            const span = located.span.replace(/\s+/g, ' ').trim();
            if (!span) continue;
            const aligned = this.alignValueTokensInSpan(modelValue, span);
            return { candidate: aligned || span, corpus: located.corpus };
        }
        return null;
    }

    // Unwrap citation envelopes: models wrap the real quote in prefixes like
    // 'OCR_IMAGE_TEXT: "..."', straight AND curly quotes (bear websites and
    // models are both sloppy), escaped \n, ellipses, and multi-fragment
    // citations ('"X" and "Y"'). Quoted fragments win; with no quoting the
    // whole (label-stripped) evidence string is the single fragment. Ellipses
    // split a fragment into independently-locatable parts.
    extractEvidenceQuoteFragments(evidence) {
        const raw = String(evidence || '')
            .replace(/\\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!raw) return [];
        const quoted = [];
        const quotePattern = /"([^"]+)"|“([^”]+)”/g;
        let match;
        while ((match = quotePattern.exec(raw)) !== null) {
            const fragment = String(match[1] || match[2] || '').trim();
            if (fragment) quoted.push(fragment);
        }
        const source = quoted.length > 0 ? quoted : [this.stripEvidenceEnvelopeLabel(raw)];
        const fragments = [];
        source.forEach(fragment => {
            String(fragment || '')
                .split(/\.{3}|…/)
                .map(part => part.trim())
                .filter(Boolean)
                .forEach(part => fragments.push(part));
        });
        return fragments;
    }

    // Strip a LEADING data-marker label ("OCR_IMAGE_TEXT: ", "SEGMENT_LINK_URL: ")
    // from an unquoted evidence string. Deliberately anchored and uppercase-only
    // so real content like "79 WARRENTON TICKETS: ..." is never eaten (the
    // label must be the known marker vocabulary, not any capitalized word).
    stripEvidenceEnvelopeLabel(text) {
        return String(text || '').replace(/^(?:OCR|SEGMENT|PAGE|META|JSONLD|JSON_LD|HTML)[A-Z0-9_]*\s*:\s*/, '').trim();
    }

    // Locate one evidence fragment in the corpora the gate already checks,
    // most-specific label first: the raw OCR texts (label 'ocr'), then the
    // gate's own evidence corpus (label 'segment' when it is a multi-event
    // segment corpus, else 'page'). Returns { span, corpus } or null.
    locateEvidenceRescueSpan(fragment, evidenceContext, rescueContext) {
        const ocrCorpus = this.getRescueOcrCorpus(rescueContext);
        if (ocrCorpus) {
            const span = this.locateEvidenceFragmentSpan(fragment, ocrCorpus);
            if (span) return { span, corpus: 'ocr' };
        }
        const raw = evidenceContext && typeof evidenceContext.raw === 'string' ? evidenceContext.raw : '';
        if (raw) {
            const span = this.locateEvidenceFragmentSpan(fragment, raw);
            if (span) return { span, corpus: /^SEGMENT_[A-Z_]+/m.test(raw) ? 'segment' : 'page' };
        }
        return null;
    }

    // Raw OCR text corpus for rescue labeling (cached on the rescueContext).
    // Raw text ONLY — structured data is never consulted for rescues.
    getRescueOcrCorpus(rescueContext) {
        if (!rescueContext || typeof rescueContext !== 'object') return '';
        if (typeof rescueContext.ocrCorpus === 'string') return rescueContext.ocrCorpus;
        const htmlData = rescueContext.htmlData;
        const ocrResults = htmlData && Array.isArray(htmlData.ocrResults) ? htmlData.ocrResults : [];
        const corpus = ocrResults
            .map(result => result && typeof result.text === 'string' ? result.text : '')
            .filter(Boolean)
            .join('\n\n');
        rescueContext.ocrCorpus = corpus;
        return corpus;
    }

    // Case-insensitive, whitespace-flexible verbatim location of a fragment in
    // a raw corpus — the same matching class the gate's hasExactEvidence uses
    // (normalizeEvidenceText containment), implemented as a regex so the
    // CORPUS'S OWN characters/casing can be recovered. Apostrophe/quote
    // variants are tolerated char-for-char (curly vs straight). Returns the
    // corpus-cased span or null. HTML-entity-encoded corpus occurrences are a
    // known acceptable miss (silent no-op) in this log-only phase.
    // A fragment located mid-word is NOT located: the same word-boundary rule
    // the gate applies (see corpusIncludesOnWordBoundary) guards both edges,
    // so "79 WARREN" never locates inside "79 WARRENTON". Guards apply only
    // where the fragment's own edge is alphanumeric — a fragment starting or
    // ending in punctuation carries its own boundary.
    locateEvidenceFragmentSpan(fragment, rawCorpus) {
        const corpus = String(rawCorpus || '');
        if (!corpus) return null;
        const tokens = this.normalizeEvidenceText(fragment).split(' ').filter(Boolean);
        if (tokens.length === 0 || tokens.length > 40) return null;
        if (tokens.join(' ').length < 4) return null; // too short to be a meaningful pointer
        let matcher;
        try {
            const pattern = tokens
                .map(token => this.escapeRegex(token).replace(/['’‘]/g, "['’‘]").replace(/["“”]/g, '["“”]'))
                .join('\\s+');
            const leftGuard = /^[a-z0-9]/.test(tokens[0]) ? '(?:^|[^A-Za-z0-9])' : '';
            const rightGuard = /[a-z0-9]$/.test(tokens[tokens.length - 1]) ? '(?=$|[^A-Za-z0-9])' : '';
            matcher = new RegExp(`${leftGuard}(${pattern})${rightGuard}`, 'i');
        } catch (_) {
            return null;
        }
        const match = matcher.exec(corpus);
        return match ? match[1] : null;
    }

    // Simple deterministic token alignment of the model's mangled value inside
    // the located corpus span: slide a window of the value's token count over
    // the span's tokens; every value token must match its counterpart (exact,
    // or near for longer tokens — "Warrenon" ≈ "WARRENTON") and at least one
    // token must match EXACTLY (the anchor, e.g. "79"). Leftmost full window
    // wins. Returns the corpus-cased sub-span, or '' when nothing aligns (the
    // caller then logs the whole fragment — acceptable for log-only).
    alignValueTokensInSpan(modelValue, span) {
        const valueTokens = String(modelValue || '').split(/\s+/).filter(Boolean);
        const spanTokens = String(span || '').split(/\s+/).filter(Boolean);
        if (valueTokens.length === 0 || spanTokens.length === 0) return '';
        if (valueTokens.length > spanTokens.length) return '';
        for (let start = 0; start + valueTokens.length <= spanTokens.length; start++) {
            let exactAnchors = 0;
            let allMatch = true;
            for (let i = 0; i < valueTokens.length; i++) {
                const kind = this.classifyRescueTokenMatch(valueTokens[i], spanTokens[start + i]);
                if (kind === 'exact') exactAnchors++;
                else if (kind !== 'near') { allMatch = false; break; }
            }
            if (allMatch && exactAnchors > 0) {
                return spanTokens.slice(start, start + valueTokens.length).join(' ');
            }
        }
        return '';
    }

    // Token comparison for alignment: 'exact' on normalized equality; 'near'
    // when both tokens are 4+ chars and within a small bounded edit distance
    // (≤ length/4, minimum 1 — covers OCR/transcription slips like
    // "warrenon" vs "warrenton"); short tokens must anchor exactly.
    classifyRescueTokenMatch(valueToken, corpusToken) {
        const a = this.normalizeRescueToken(valueToken);
        const b = this.normalizeRescueToken(corpusToken);
        if (!a || !b) return 'none';
        if (a === b) return 'exact';
        if (a.length < 4 || b.length < 4) return 'none';
        const maxDistance = Math.max(1, Math.floor(Math.max(a.length, b.length) / 4));
        return this.boundedEditDistance(a, b, maxDistance) >= 0 ? 'near' : 'none';
    }

    normalizeRescueToken(token) {
        return String(token || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    // Levenshtein distance capped at maxDistance: returns the distance when
    // within the cap, -1 otherwise. Inputs are short normalized tokens, so the
    // classic DP is plenty.
    boundedEditDistance(a, b, maxDistance) {
        if (Math.abs(a.length - b.length) > maxDistance) return -1;
        let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
        for (let i = 1; i <= a.length; i++) {
            const current = [i];
            for (let j = 1; j <= b.length; j++) {
                current[j] = Math.min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
                );
            }
            previous = current;
        }
        const distance = previous[b.length];
        return distance <= maxDistance ? distance : -1;
    }

    // === Main Validation Entry Point ===

    validateAiEventEvidence(aiEvent, htmlData, parserConfig = {}, promptFields = null, options = {}) {
        // === STEP 1: Guard Clauses ===
        if (!aiEvent || typeof aiEvent !== 'object') {
            return { event: aiEvent, report: null };
        }

        const validationConfig = this.getAiValidationConfig(parserConfig);
        if (!validationConfig.enabled) {
            return { event: aiEvent, report: null };
        }

        // STRICT MODE: Require snippet-based evidence context - no fallback to full HTML
        // This ensures AI validation only passes on data that was found in the snippet passed to AI
        const evidenceContext = options && options.evidenceContext && typeof options.evidenceContext === 'object'
            ? options.evidenceContext
            : null;
        if (!evidenceContext) {
            console.warn('🤖 AI Web: Validation failed - snippet-based evidenceContext not provided. Returning event without validation.');
            return { event: aiEvent, report: null };
        }

        const validationContext = options && options.validationContext && typeof options.validationContext === 'object'
            ? options.validationContext
            : null;
        if (!validationContext || !validationContext.imageEvidenceUrls) {
            console.warn('🤖 AI Web: Validation failed - validationContext.imageEvidenceUrls not provided. Returning event without validation.');
            return { event: aiEvent, report: null };
        }

        // === STEP 2: Setup Validation Context ===
        const validated = { ...aiEvent };
        const trustedFields = new Set(
            (Array.isArray(options && options.trustedFields) ? options.trustedFields : [])
                .map(field => this.normalizePromptFieldName(field))
                .filter(Boolean)
        );
        const report = {
            strict: validationConfig.strictDefault,
            sourceChars: evidenceContext.raw.length,
            kept: [],
            dropped: [],
            bypassed: []
        };
        const requestedFields = Array.isArray(promptFields) && promptFields.length > 0
            ? new Set(promptFields.map(field => this.normalizePromptFieldName(field)))
            : null;

        // === STEP 3: Validate Each Field ===
        // Model-provided per-field evidence strings (captured at confidence-
        // filter time; see parseAndFilterConfidence) — consulted for time
        // fields so inference-language evidence fails corroboration.
        const modelFieldEvidence = aiEvent.__fieldEvidence && typeof aiEvent.__fieldEvidence === 'object'
            ? aiEvent.__fieldEvidence
            : {};
        // Brand/domain tokens of the source page — consulted for the city
        // field so branding-citing evidence fails corroboration (run
        // 20260723-123149: WWW.FURBALL.NYC flyer branding produced city
        // "new york" for an event in Torremolinos).
        const brandTokens = this.getPageBrandDomainTokens(htmlData);
        // Evidence-pointer rescue context (LOG-ONLY observation): carries the
        // htmlData so the rescue can consult the raw OCR texts for corpus
        // labeling. Never influences accept/reject decisions.
        const rescueContext = { htmlData };
        Object.keys(aiEvent).forEach(key => {
            const rule = this.getFieldValidationRule(key, validationConfig);

            // Check if field should be skipped/dropped/bypassed
            const status = this.getFieldValidationStatus(key, aiEvent, rule, requestedFields, trustedFields, report);
            if (status === 'skip-internal' || status === 'bypass-strictness' || status === 'bypass-trusted') {
                // Keep these fields without further evidence checks
                return;
            }
            if (status === 'drop-not-usable' || status === 'drop-not-requested') {
                delete validated[key];
                return;
            }

            // Validate field value against evidence
            const value = aiEvent[key];
            const isValid = this.validateFieldValueAgainstEvidence(key, value, rule, evidenceContext, validationContext, report, modelFieldEvidence[key], brandTokens, rescueContext);
            if (!isValid) {
                delete validated[key];
            }
        });

        // === STEP 3.5: End-marker reassignment ===
        // START values the gate just dropped for citing an "End at" line are
        // evidence-cited END data — move each to the corresponding EMPTY end
        // field instead of losing it. An already-populated end field always
        // wins (the start copy stays dropped).
        this.reassignEndMarkerStartFields(validated, report, aiEvent);

        // === STEP 4: Return Result ===
        if (report.dropped.length > 0) {
            console.warn(`🤖 AI Web: Dropped ${report.dropped.length} field(s) lacking source evidence: ${report.dropped.map(entry => entry.key).join(', ')}`);
        }
        return { event: validated, report };
    }

    // Apply the end-marker reassignment candidates collected by
    // validateFieldValueAgainstEvidence (reason 'end-marker-cited-evidence'):
    // - end field empty → the value moves there (stored under the canonical
    //   schema key so normalizeAiEvent's camelCase readers find it);
    // - end field holds the SAME value → the start copy is simply dropped;
    // - end field holds a DIFFERENT value → the end field wins, the
    //   misattributed start stays dropped.
    // Never throws and never removes anything from `validated` — the gate's
    // own drop already happened; this step only ever ADDS the end value.
    reassignEndMarkerStartFields(validated, report, aiEvent) {
        const entries = report && Array.isArray(report.endMarkerReassignments) ? report.endMarkerReassignments : [];
        if (entries.length === 0) return;
        const schema = this.getEventSchema();
        const title = aiEvent && typeof aiEvent.title === 'string' && aiEvent.title.trim()
            ? aiEvent.title.trim()
            : 'untitled event';
        entries.forEach(entry => {
            const endField = END_MARKER_START_FIELDS.get(entry.field);
            if (!endField) return;
            let targetKey = endField === 'enddate' ? 'endDate' : 'endTime';
            if (schema && typeof schema.canonicalizeEventKey === 'function') {
                const canonical = schema.canonicalizeEventKey(endField);
                if (canonical) targetKey = canonical;
            }
            const existingKey = Object.keys(validated).find(key =>
                !this.isInternalAiFieldKey(key)
                && this.normalizePromptFieldName(key) === endField
                && this.isUsableAiFieldValue(validated[key]));
            if (existingKey === undefined) {
                validated[targetKey] = entry.value;
                console.log(`🤖 AI Web: Reassigned end-marker-cited ${entry.key} "${entry.value}" to ${targetKey} for "${title}"`);
            } else if (String(validated[existingKey]).trim() === String(entry.value).trim()) {
                console.log(`🤖 AI Web: Dropped end-marker-cited ${entry.key} "${entry.value}" — ${existingKey} already holds the same value for "${title}"`);
            } else {
                console.log(`🤖 AI Web: Dropped end-marker-cited ${entry.key} "${entry.value}" — ${existingKey} already has "${validated[existingKey]}" for "${title}"`);
            }
        });
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

    isPromptFieldRequested(fieldName, parserConfig = {}, promptFields = null, dataFlags = {}) {
        const requestedFields = Array.isArray(promptFields) && promptFields.length > 0
            ? promptFields
            : this.getAiPromptFields(parserConfig, dataFlags);
        const requestedSet = new Set(requestedFields.map(field => this.normalizePromptFieldName(field)));
        return requestedSet.has(this.normalizePromptFieldName(fieldName));
    }

    normalizeAiEvent(aiEvent, parserConfig, htmlData = null, cityConfig = null, promptFields = null) {
        const scrapedLinks = this.extractLinksFromPage(
            htmlData && typeof htmlData.html === 'string' ? htmlData.html : '',
            htmlData && typeof htmlData.url === 'string' ? htmlData.url : ''
        );
        let title = this.firstNonEmpty(
            aiEvent.title,
            aiEvent.name,
            aiEvent.summary,
            this.getResolvedParserMetadataFieldValue(parserConfig, ['title', 'name', 'summary'], aiEvent)
        );
        const aiDescription = this.firstNonEmpty(aiEvent.description, aiEvent.desc, '');
        const configDescription = this.firstNonEmpty(
            this.getResolvedParserMetadataFieldValue(parserConfig, ['description', 'desc'], aiEvent),
            ''
        );
        let description = aiDescription || configDescription;
        const aiBar = this.firstNonEmpty(aiEvent.bar, aiEvent.venue, '');
        const configBar = this.firstNonEmpty(
            this.getResolvedParserMetadataFieldValue(parserConfig, ['bar', 'venue'], aiEvent),
            ''
        );
        let bar = aiBar || configBar;

        // Organizer/site-brand guard: promoter pages surface the brand in og:title
        // ("Portland PRIDE FRIDAY | BEARRACUDA") and extraction leaks it into
        // bar/title. The brand names are derived from the page's own markup —
        // see extractPageBrandNames — never from a hardcoded organizer list.
        // (Cached per page; parseEvents primes the cache on the original html.)
        const pageBrandNames = this.getPageBrandNames(htmlData);
        // A page classified as the venue's own site (siteRole 'venue') is the
        // one case where the site brand IS the venue: the organizer bar-drop
        // guard must not fire there, and the merge-side organizer stamp would
        // wrongly veto the venue as bar.
        const pageIsVenueSite = this.getPageSiteRole(htmlData) === 'venue';
        if (pageBrandNames.length > 0) {
            // Only AI-extracted values are guarded: an explicitly configured bar is a
            // deliberate override and must survive even when it matches the site brand
            // (venue sites ARE their own brand, e.g. a bar scraping its own homepage).
            if (!pageIsVenueSite && bar && bar === aiBar && this.matchesPageBrandName(bar, pageBrandNames)) {
                console.log(`🤖 AI Web: Dropping bar "${bar}" — matches the page's organizer/site name, not a venue`);
                bar = configBar;
            }
            const strippedTitle = this.stripPageBrandFromTitle(title, pageBrandNames);
            if (strippedTitle !== title) {
                console.log(`🤖 AI Web: Stripping page brand from title "${title}" → "${strippedTitle}"`);
                title = strippedTitle;
            }
        }
        // Site-tagline backstop (the primary guard runs at pass-result time in
        // rejectBrandLikePassFields): an AI-extracted description that exactly
        // equals the site's own JSON-LD WebSite.description is the site blurb,
        // not an event description. Only the AI value is guarded — a configured
        // metadata description is a deliberate override and survives.
        if (description && description === aiDescription
            && this.matchesSiteTagline(description, this.getPageSiteTaglines(htmlData))) {
            console.log(`🤖 AI Web: Rejecting description from final normalization — identical to the site's own tagline, not event-specific`);
            description = configDescription;
        }
        const address = this.firstNonEmpty(
            aiEvent.address,
            aiEvent.addr,
            this.getResolvedParserMetadataFieldValue(parserConfig, ['address', 'addr'], aiEvent),
            ''
        );
        const location = this.firstNonEmpty(
            aiEvent.location,
            aiEvent.coords,
            this.getResolvedParserMetadataFieldValue(parserConfig, ['location', 'coords'], aiEvent),
            ''
        );
        const city = normalizeCityValue(
            this.firstNonEmpty(
                aiEvent.city,
                this.getResolvedParserMetadataFieldValue(parserConfig, ['city'], aiEvent),
                parserConfig && parserConfig.city,
                ''
            )
        );
        // A bare city is not an event name — after the brand strip above (which
        // is what exposes the bare city), prefix the page's known organizer:
        // "New Orleans⚜️" → "BEARRACUDA: New Orleans⚜️". Titles already naming
        // the organizer or a real event are untouched.
        if (pageBrandNames.length > 0 && city) {
            const prefixedTitle = this.buildOrganizerPrefixedTitle(title, city, pageBrandNames, htmlData, cityConfig);
            if (prefixedTitle) {
                console.log(`🤖 AI Web: Title "${title}" is just the event's city — prefixed known organizer → "${prefixedTitle}"`);
                title = prefixedTitle;
            }
        }
        const timezone = this.firstNonEmpty(
            aiEvent.timezone,
            this.getResolvedParserMetadataFieldValue(parserConfig, ['timezone'], aiEvent),
            this.getTimezoneForCity(city, cityConfig),
            this.getTimezoneForCity(parserConfig && parserConfig.city, cityConfig),
            // Fallback: the address often names the city even when the city field was
            // dropped by evidence validation (e.g. flyer only says "NYC").
            this.getTimezoneForCity(this.findCityKeyInText(address, cityConfig), cityConfig),
            ''
        );
        const url = this.firstNonEmpty(
            aiEvent.url,
            aiEvent.web,
            aiEvent.website,
            this.getResolvedParserMetadataFieldValue(parserConfig, ['url', 'web', 'website'], aiEvent),
            ''
        );
        const ticketUrl = this.firstNonEmpty(
            aiEvent.ticketUrl,
            aiEvent.tickets,
            this.getResolvedParserMetadataFieldValue(parserConfig, ['ticketUrl', 'tickets'], aiEvent),
            ''
        );
        const instagram = this.firstNonEmpty(
            scrapedLinks.instagram,
            aiEvent.instagram,
            aiEvent.insta,
            this.getResolvedParserMetadataFieldValue(parserConfig, ['instagram', 'insta'], aiEvent),
            ''
        );
        const facebook = this.firstNonEmpty(
            scrapedLinks.facebook,
            aiEvent.facebook,
            aiEvent.fb,
            this.getResolvedParserMetadataFieldValue(parserConfig, ['facebook', 'fb'], aiEvent),
            ''
        );
        const gmaps = this.firstNonEmpty(
            scrapedLinks.gmaps,
            aiEvent.gmaps,
            this.getResolvedParserMetadataFieldValue(parserConfig, ['gmaps'], aiEvent),
            ''
        );
        // Upgrade degraded CDN thumbnails so the stored image is never a blurred preview.
        const image = this.upgradeCdnThumbnailUrl(this.firstNonEmpty(
            aiEvent.image,
            aiEvent.img,
            this.getResolvedParserMetadataFieldValue(parserConfig, ['image', 'img'], aiEvent),
            ''
        ));
        const cover = this.firstNonEmpty(
            aiEvent.cover,
            this.getResolvedParserMetadataFieldValue(parserConfig, ['cover'], aiEvent),
            ''
        );
        const shortName = this.firstNonEmpty(
            aiEvent.shortName,
            aiEvent.short,
            this.getResolvedParserMetadataFieldValue(parserConfig, ['shortName', 'short'], aiEvent),
            ''
        );
        const aiPrompts = Array.isArray(aiEvent.__aiPrompts) ? aiEvent.__aiPrompts.filter(entry => entry && entry.prompt) : [];
        // Pass dataFlags from htmlData if available, otherwise default to empty object
        const dataFlags = htmlData && htmlData.dataFlags ? htmlData.dataFlags : {};
        const recurrenceRule = this.isPromptFieldRequested('rrule', parserConfig, promptFields, dataFlags)
            ? this.normalizeRruleValue(this.firstNonEmpty(
                aiEvent.recurrenceRule,
                aiEvent.rrule,
                this.getResolvedParserMetadataFieldValue(parserConfig, ['recurrenceRule', 'rrule'], aiEvent),
                ''
            ))
            : '';

        const startDateRaw = this.parseDateValue(this.firstNonEmpty(aiEvent.startDate, aiEvent.start, ''), timezone);
        const startTimeRaw = normalizeStartTimeValue(this.firstNonEmpty(aiEvent.startTime, aiEvent.start, ''));
        const endDateRaw = this.parseDateValue(this.firstNonEmpty(aiEvent.endDate, aiEvent.end, ''), timezone);
        const endTimeRaw = normalizeStartTimeValue(this.firstNonEmpty(aiEvent.endTime, aiEvent.end, ''));

        console.log(`🤖 AI Web: Date normalization — rawStartDate=${aiEvent.startDate}, rawStartTime=${aiEvent.startTime}, rawStart=${aiEvent.start}, rawEndDate=${aiEvent.endDate}, rawEndTime=${aiEvent.endTime}, rawEnd=${aiEvent.end}`);
        console.log(`🤖 AI Web: Parsed raw values — startDateRaw=${startDateRaw instanceof Date ? startDateRaw.toISOString() : startDateRaw}, startTimeRaw=${startTimeRaw}, endDateRaw=${endDateRaw instanceof Date ? endDateRaw.toISOString() : endDateRaw}, endTimeRaw=${endTimeRaw}`);

        // Check if start/end were explicitly provided (full datetime format)
        // These contain full datetime like "2026-05-12T22:30" or "2026-05-12 22:30" - use directly without combining
        const startProvided = aiEvent.start && this.parseDateValue(aiEvent.start, timezone) !== null;
        const endProvided = aiEvent.end && this.parseDateValue(aiEvent.end, timezone) !== null;

        // Combine date and time if we have split fields
        // If start/end was provided, use them directly; otherwise combine split fields
        // Use timezone-aware combination when both date and time are available from split fields

        let combinedStartDate = null;
        if (startProvided) {
            combinedStartDate = this.parseDateValue(aiEvent.start, timezone);
        } else if (startDateRaw) {
            // Default to local midnight if no start time provided
            const timeStr = startTimeRaw || '00:00:00';
            combinedStartDate = this.convertLocalDateTimeToUtc(startDateRaw.toISOString().split('T')[0] + ' ' + timeStr, timezone) || combineDateAndTime(startDateRaw, startTimeRaw || '00:00') || startDateRaw;
        } else if (startTimeRaw) {
            combinedStartDate = this.parseDateValue(startTimeRaw, timezone);
        }

        let combinedEndDate = null;
        if (endProvided) {
            combinedEndDate = this.parseDateValue(aiEvent.end, timezone);
        } else if (endDateRaw) {
            const isDifferentDay = startDateRaw && endDateRaw.getTime() !== startDateRaw.getTime();
            if (endTimeRaw) {
                combinedEndDate = this.convertLocalDateTimeToUtc(endDateRaw.toISOString().split('T')[0] + ' ' + endTimeRaw, timezone) || combineDateAndTime(endDateRaw, endTimeRaw) || endDateRaw;
            } else if (isDifferentDay) {
                // Multi-day event with no end time: use 23:59:59 local time
                combinedEndDate = this.convertLocalDateTimeToUtc(endDateRaw.toISOString().split('T')[0] + ' 23:59:59', timezone) || combineDateAndTime(endDateRaw, '23:59') || endDateRaw;
            } else {
                // Same day with no end time: exactly match start time to represent ambiguous end
                combinedEndDate = combinedStartDate ? new Date(combinedStartDate) : endDateRaw;
            }
        } else if (endTimeRaw) {
            // End time with no end date ("Party Goes Until 2:00 am!" — the next-day
            // endDate is never verbatim on the page, so the evidence gate drops it):
            // anchor the end time to the START's date. The past-midnight rollover
            // below moves it to the next day when it lands before the start.
            if (startDateRaw) {
                combinedEndDate = this.convertLocalDateTimeToUtc(startDateRaw.toISOString().split('T')[0] + ' ' + endTimeRaw, timezone) || combineDateAndTime(startDateRaw, endTimeRaw) || null;
            }
            if (!combinedEndDate) {
                combinedEndDate = this.parseDateValue(endTimeRaw, timezone);
            }
        }

        // If we only have a start date and no end date info at all, match the end exactly to the start
        if (!endProvided && !endDateRaw && !endTimeRaw && combinedStartDate) {
            combinedEndDate = new Date(combinedStartDate);
        }

        // Past-midnight ends ("Party Goes Until 2:00 am!") usually arrive with the
        // START's date because the next-day endDate isn't verbatim in the source and
        // gets evidence-dropped. When an explicit end time lands before the start,
        // roll it to the next day instead of collapsing the event to zero duration.
        if (endTimeRaw && !endProvided
            && combinedStartDate instanceof Date && !Number.isNaN(combinedStartDate.getTime())
            && combinedEndDate instanceof Date && !Number.isNaN(combinedEndDate.getTime())
            && combinedEndDate.getTime() < combinedStartDate.getTime()
            && combinedStartDate.getTime() - combinedEndDate.getTime() < 24 * 60 * 60 * 1000) {
            combinedEndDate = new Date(combinedEndDate.getTime() + 24 * 60 * 60 * 1000);
            console.log(`🤖 AI Web: End time precedes start — assuming past-midnight end (+1 day): ${combinedEndDate.toISOString()}`);
        }

        // Without a timezone, combineDateAndTime stored the extracted local time as wall-clock
        // components labeled UTC (a wrong instant). Flag the event so LocationNormalizer can
        // re-anchor it once the city/timezone resolve downstream. Full datetime strings
        // (startProvided/endProvided) are excluded because Date parsing already anchored them.
        const usedWallClockFallback = !timezone && !startProvided && !endProvided && Boolean(startDateRaw || endDateRaw);
        if (usedWallClockFallback) {
            console.warn(`🚨 AI Web: No timezone resolved for "${title}" — storing local time as wall-clock UTC and flagging for downstream re-anchoring (startTime=${startTimeRaw || 'none'})`);
        } else if (!timezone && (startProvided || endProvided)) {
            console.warn(`🚨 AI Web: No timezone resolved for "${title}" — full datetime was parsed in the host timezone and may be wrong`);
        }

        console.log(`🤖 AI Web: Combined dates — combinedStartDate=${combinedStartDate instanceof Date ? combinedStartDate.toISOString() : combinedStartDate}, combinedEndDate=${combinedEndDate instanceof Date ? combinedEndDate.toISOString() : combinedEndDate}`);

        // For single-day events, if startDate is missing but endDate exists, use endDate as start
        let finalStartDate = combinedStartDate || combinedEndDate;
        let finalEndDate = combinedEndDate || combinedStartDate;

        const hasStructuredData = !!dataFlags.jsonLd || !!dataFlags.meta;
        const hasUnstructuredData = !!dataFlags.ocr || !!dataFlags.segment || !!dataFlags.content;

        if (hasUnstructuredData && !hasStructuredData && finalStartDate instanceof Date && !Number.isNaN(finalStartDate.getTime())) {
            const localHour = this.getLocalHour(finalStartDate, timezone);
            // If the local hour is explicitly 0 (midnight), only shift it if it was explicitly extracted from unstructured text.
            // If it was "invented" as a default because no time was provided, leave it alone.
            const isInventedMidnight = localHour === 0 && !startTimeRaw;
            if (localHour !== null && localHour >= 0 && localHour < 6 && !isInventedMidnight) {
                console.log(`🤖 AI Web: Adjusting late night event (+1 day) for unstructured data. Original start: ${finalStartDate.toISOString()}`);
                finalStartDate = new Date(finalStartDate.getTime() + 24 * 60 * 60 * 1000);
                if (finalEndDate instanceof Date && !Number.isNaN(finalEndDate.getTime())) {
                    finalEndDate = new Date(finalEndDate.getTime() + 24 * 60 * 60 * 1000);
                }
            }
        }

        // Weekday-pinned years (see resolveWeekdayPinnedYear) are deterministic and
        // must not be re-adjusted toward the window. An end that was derived from
        // the start (no end info of its own) inherits the start's pin so the pair
        // cannot be split across years, and vice versa for a start that fell back
        // to the end value.
        const weekdayPinnedYears = aiEvent.__weekdayPinnedYears && typeof aiEvent.__weekdayPinnedYears === 'object'
            ? aiEvent.__weekdayPinnedYears
            : {};
        const effectivePinnedYears = {
            start: Boolean(weekdayPinnedYears.start) || (!combinedStartDate && Boolean(weekdayPinnedYears.end)),
            end: Boolean(weekdayPinnedYears.end) || (!endProvided && !endDateRaw && Boolean(weekdayPinnedYears.start))
        };

        const { startDate, endDate } = this.normalizeEventDates(finalStartDate, finalEndDate, effectivePinnedYears);
        console.log(`🤖 AI Web: Normalized dates — startDate=${startDate instanceof Date ? startDate.toISOString() : startDate}, endDate=${endDate instanceof Date ? endDate.toISOString() : endDate}`);

        if (!title || !startDate) {
            console.warn(`🤖 AI Web: Normalization failed — title=${title}, startDate=${startDate}`);
            return null;
        }

        // Deterministic title date-strip: source sites bake the date into the
        // title ("CHUNK DORE ALLEY - Saturday July 25th") — on a calendar that
        // date is pure redundancy (startDate carries it), and a dated variant
        // could beat the clean one in title merges under the more-descriptive
        // rule. Strip ONLY when the printed date provably matches the event's
        // own startDate, compared against the ORIGINAL extracted date string
        // (aiEvent.startDate / aiEvent.start — pre-normalization): the
        // combined startDate above may have rolled past midnight in UTC (late
        // local start times) or been year-adjusted, so its ISO date can
        // legitimately differ from the printed local date. startDateRaw's ISO
        // date part is the same local-date view the combination logic itself
        // uses, so it is a safe fallback. The detector lives in SharedCore
        // (detectTitleDateSegment — one implementation, shared with the merge
        // rung); a mismatching printed date keeps the title and leaves a
        // manual-review trail. Any parse uncertainty fails open (title kept).
        const detectTitleDateSegment = this.core && typeof this.core.detectTitleDateSegment === 'function'
            ? (value) => this.core.detectTitleDateSegment(value)
            : ImportedDetectTitleDateSegment;
        const titleDateSegment = typeof detectTitleDateSegment === 'function' ? detectTitleDateSegment(title) : null;
        if (titleDateSegment) {
            const extractLocalDateParts = (value) => {
                if (typeof value !== 'string') return null;
                const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/);
                if (!match) return null;
                return { year: parseInt(match[1], 10), month: parseInt(match[2], 10), day: parseInt(match[3], 10) };
            };
            const expectedDate = extractLocalDateParts(aiEvent.startDate)
                || extractLocalDateParts(aiEvent.start)
                || (startDateRaw instanceof Date && !Number.isNaN(startDateRaw.getTime())
                    ? extractLocalDateParts(startDateRaw.toISOString())
                    : null);
            if (expectedDate) {
                const monthDayMatches = titleDateSegment.month === expectedDate.month && titleDateSegment.day === expectedDate.day;
                const yearMatches = titleDateSegment.year === null || titleDateSegment.year === expectedDate.year;
                if (monthDayMatches && yearMatches) {
                    console.log(`🤖 AI Web: Stripped redundant date from title ("${title}" → "${titleDateSegment.base}")`);
                    title = titleDateSegment.base;
                } else {
                    const expectedIso = `${expectedDate.year}-${String(expectedDate.month).padStart(2, '0')}-${String(expectedDate.day).padStart(2, '0')}`;
                    console.log(`🤖 AI Web: Title contains a date that does not match startDate ("${title}" vs ${expectedIso}) — kept, verify manually`);
                }
            }
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
        if (usedWallClockFallback) {
            event._timezoneUnresolved = true;
        }

        // Stamp the derived organizer as internal metadata (underscore fields are
        // excluded from calendar notes and merge field loops) so downstream merge
        // arbitration can warn the model off picking the organizer as the venue.
        // Never on a venue's own site: there the brand IS the venue, and the
        // organizer stamp would make arbitration veto the correct bar.
        if (pageBrandNames.length > 0 && !pageIsVenueSite) {
            event._organizer = pageBrandNames[0];
        }

        if (aiPrompts.length > 0) {
            event._aiPrompts = aiPrompts;
        }

        if (parserConfig && parserConfig.metadata && typeof parserConfig.metadata === 'object') {
            Object.keys(parserConfig.metadata).forEach(key => {
                const metaValue = parserConfig.metadata[key];
                const resolvedValue = this.resolveParserMetadataValue(metaValue, event);
                if (resolvedValue !== null && resolvedValue !== undefined && String(resolvedValue).trim()) {
                    event[key] = resolvedValue;
                }
            });
        }

        // A single-event page (never a multi-event segment — one shared meta
        // image cannot be attributed to one segment) whose extraction found no
        // image adopts the page's own og:image artwork.
        if (!dataFlags.segment) {
            this.fillImageFromPageMetaArtwork(event, htmlData);
        }

        // Provenance stamp for the FINAL image value (after any parser-config
        // metadata override): 'og-image' when it is the page's own artwork,
        // 'page' otherwise; no image → no stamp.
        this.stampImageProvenance(event, htmlData);

        return event;
    }

    getResolvedParserMetadataFieldValue(parserConfig, fieldNames, eventContext = null) {
        const metadata = parserConfig && parserConfig.metadata && typeof parserConfig.metadata === 'object'
            ? parserConfig.metadata
            : null;
        if (!metadata) return '';
        const candidates = Array.isArray(fieldNames) ? fieldNames : [fieldNames];
        for (const fieldName of candidates) {
            if (!Object.prototype.hasOwnProperty.call(metadata, fieldName)) continue;
            const resolved = this.resolveParserMetadataValue(metadata[fieldName], eventContext);
            if (resolved === null || resolved === undefined) continue;
            const text = String(resolved).trim();
            if (text) return text;
        }
        return '';
    }

    resolveParserMetadataValue(metaValue, eventContext = null) {
        if (metaValue === null || metaValue === undefined) return undefined;
        if (typeof metaValue !== 'object') return metaValue;
        const hasValue = Object.prototype.hasOwnProperty.call(metaValue, 'value');
        const hasDefaultValue = Object.prototype.hasOwnProperty.call(metaValue, 'defaultValue');
        const fallbackValue = hasDefaultValue ? metaValue.defaultValue : (hasValue ? metaValue.value : undefined);
        if (!Array.isArray(metaValue.conditionalValues) || metaValue.conditionalValues.length === 0) {
            return fallbackValue;
        }
        const searchText = this.buildParserMetadataSearchText(eventContext);
        if (!searchText) return fallbackValue;
        for (const condition of metaValue.conditionalValues) {
            if (!condition || typeof condition !== 'object') continue;
            if (!Object.prototype.hasOwnProperty.call(condition, 'value')) continue;
            const keywords = this.normalizeParserMetadataKeywords(condition.keywords || []);
            if (keywords.length === 0) continue;
            if (keywords.some(keyword => searchText.includes(keyword))) {
                return condition.value;
            }
        }
        return fallbackValue;
    }

    normalizeParserMetadataKeywords(keywords) {
        const keywordList = Array.isArray(keywords) ? keywords : [keywords];
        return keywordList
            .map(keyword => String(keyword || '').trim().toLowerCase())
            .filter(Boolean);
    }

    buildParserMetadataSearchText(eventContext) {
        const visited = new Set();
        const parts = [];
        const collect = value => {
            if (value === null || value === undefined) return;
            const valueType = typeof value;
            if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
                const normalized = String(value).trim().toLowerCase();
                if (normalized) parts.push(normalized);
                return;
            }
            if (valueType !== 'object' || visited.has(value)) return;
            visited.add(value);
            if (Array.isArray(value)) {
                value.forEach(collect);
                return;
            }
            Object.keys(value).forEach(key => {
                if (String(key || '').startsWith('_')) return;
                collect(value[key]);
            });
        };
        collect(eventContext);
        return parts.join(' ');
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
        const matchedKey = Object.keys(map).find(key => {
            if (String(key).toLowerCase() === normalizedCity) return true;
            const cityData = map[key];
            if (!cityData || typeof cityData !== 'object') return false;
            if (cityData.name && String(cityData.name).toLowerCase() === normalizedCity) return true;
            if (Array.isArray(cityData.patterns) && cityData.patterns.some(p => String(p).toLowerCase() === normalizedCity)) return true;
            if (Array.isArray(cityData.aliases) && cityData.aliases.some(a => String(a).toLowerCase() === normalizedCity)) return true;
            return false;
        });
        if (!matchedKey) return '';
        const matched = map[matchedKey];
        if (!matched || typeof matched !== 'object' || typeof matched.timezone !== 'string') return '';
        return matched.timezone.trim();
    }

    // All names that refer to a configured city: its key, display name, patterns, and aliases.
    getCityAliasList(cityKey, cityData) {
        const aliases = new Set();
        const add = value => {
            const text = String(value || '').trim().toLowerCase();
            if (text) aliases.add(text);
        };
        add(cityKey);
        if (cityData && typeof cityData === 'object') {
            add(cityData.name);
            if (Array.isArray(cityData.patterns)) cityData.patterns.forEach(add);
            if (Array.isArray(cityData.aliases)) cityData.aliases.forEach(add);
        }
        return Array.from(aliases);
    }

    findCityConfigEntry(cityValue, cityConfig) {
        const map = this.getCityConfigMap(cityConfig);
        if (!map || typeof map !== 'object') return null;
        const normalizedCity = String(cityValue || '').trim().toLowerCase();
        if (!normalizedCity) return null;
        for (const [key, cityData] of Object.entries(map)) {
            const aliases = this.getCityAliasList(key, cityData);
            if (aliases.includes(normalizedCity)) {
                return { key, aliases };
            }
        }
        return null;
    }

    textContainsCityAlias(normalizedText, alias) {
        const normalizedAlias = this.normalizeEvidenceText(alias);
        if (!normalizedAlias) return false;
        const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`);
        return pattern.test(normalizedText);
    }

    // The AI canonicalizes city names (e.g. "NYC" -> "new york"), so verbatim evidence
    // matching fails whenever the page only uses an alias. Accept evidence for any
    // configured alias of the same city. Aliases under 3 chars are skipped to avoid
    // substring-style false positives from short codes.
    hasCityEvidence(evidenceContext, value, validationContext = null) {
        if (this.hasExactEvidence(evidenceContext, value)) return true;
        const cityConfig = validationContext && validationContext.cityConfig ? validationContext.cityConfig : null;
        const entry = this.findCityConfigEntry(value, cityConfig);
        if (!entry) return false;
        return entry.aliases.some(alias =>
            alias.length >= 3 && this.textContainsCityAlias(evidenceContext.normalized, alias)
        );
    }

    // Find a configured city referenced inside free text (e.g. a street address).
    findCityKeyInText(text, cityConfig) {
        const map = this.getCityConfigMap(cityConfig);
        if (!map || typeof map !== 'object') return '';
        const normalizedText = this.normalizeEvidenceText(text);
        if (!normalizedText) return '';
        for (const [key, cityData] of Object.entries(map)) {
            const matched = this.getCityAliasList(key, cityData).some(alias =>
                alias.length >= 3 && this.textContainsCityAlias(normalizedText, alias)
            );
            if (matched) return key;
        }
        return '';
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

    getLocalHour(dateObj, timezone) {
        if (!dateObj || Number.isNaN(dateObj.getTime())) return null;
        if (!timezone) return dateObj.getUTCHours();
        try {
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone,
                hour: 'numeric',
                hourCycle: 'h23'
            });
            const hourStr = formatter.format(dateObj);
            return parseInt(hourStr, 10);
        } catch (e) {
            return dateObj.getUTCHours();
        }
    }

    // Clock hook — production always uses the real clock; tests override this to
    // freeze "now" for deterministic year-window and weekday-pinning assertions.
    now() {
        return new Date();
    }

    // Which weekday-pin bucket an AI date field key belongs to ('start'/'end'),
    // or null for non-date fields. Keys arrive canonical ("startDate") or
    // lowercased ("startdate") depending on the pass that produced them.
    getDateFieldPinBucket(key) {
        const normalized = String(key || '').trim().toLowerCase();
        if (normalized === 'startdate' || normalized === 'start') return 'start';
        if (normalized === 'enddate' || normalized === 'end') return 'end';
        return null;
    }

    // Extract a weekday stated adjacent to a date in free text ("Sat, Aug 22",
    // "Aug 22, Saturday", "Sat 8/22"). Returns the JS day index (0=Sunday) or
    // null when no weekday sits next to a date-looking token.
    extractStatedWeekdayAdjacentToDate(text) {
        const raw = String(text || '');
        if (!raw) return null;
        const weekday = '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)';
        const month = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
        const dayNum = '\\d{1,2}(?:st|nd|rd|th)?';
        const dateToken = `(?:${month}\\.?\\s*${dayNum}|${dayNum}\\s*(?:of\\s+)?${month}|\\d{1,2}[\\/.\\-]\\d{1,2})`;
        const weekdayThenDate = new RegExp(`\\b${weekday}\\b\\.?,?\\s*${dateToken}`, 'i');
        const dateThenWeekday = new RegExp(`${dateToken}\\s*,?\\s*\\(?\\b${weekday}\\b`, 'i');
        const match = raw.match(weekdayThenDate) || raw.match(dateThenWeekday);
        if (!match) return null;
        const dayIndexByPrefix = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
        const prefix = String(match[1] || '').slice(0, 3).toLowerCase();
        return Object.prototype.hasOwnProperty.call(dayIndexByPrefix, prefix) ? dayIndexByPrefix[prefix] : null;
    }

    // Build one candidate for weekday pinning: the field value with its 4-digit
    // year replaced by `year`. Date-only/ISO-leading values use UTC weekday math;
    // other parseable strings use the host-local weekday (matching how they will
    // later be parsed). Returns { year, text, date, weekday, iso } or null.
    buildWeekdayPinCandidate(valueText, yearMatch, year) {
        const candidateText = valueText.slice(0, yearMatch.index)
            + String(year)
            + valueText.slice(yearMatch.index + yearMatch[0].length);
        const isoMatch = candidateText.match(/^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]|$)/);
        if (isoMatch) {
            const month = Number(isoMatch[2]);
            const day = Number(isoMatch[3]);
            const utcDate = new Date(Date.UTC(year, month - 1, day));
            if (utcDate.getUTCFullYear() !== year || utcDate.getUTCMonth() !== month - 1 || utcDate.getUTCDate() !== day) {
                return null; // e.g. Feb 29 in a non-leap candidate year
            }
            return {
                year,
                text: candidateText,
                date: utcDate,
                weekday: utcDate.getUTCDay(),
                iso: utcDate.toISOString().slice(0, 10)
            };
        }
        const parsed = new Date(candidateText);
        if (Number.isNaN(parsed.getTime()) || parsed.getFullYear() !== year) return null;
        return {
            year,
            text: candidateText,
            date: parsed,
            weekday: parsed.getDay(),
            iso: `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
        };
    }

    // Month/day (1-based) of a date field value, for locating its token in source
    // text. ISO-leading values are read positionally; other parseable strings go
    // through Date (month/day are stable regardless of host timezone at noon-less
    // date strings' local-midnight parse).
    getMonthDayFromDateText(valueText) {
        const raw = String(valueText || '').trim();
        if (!raw) return null;
        const isoMatch = raw.match(/^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]|$)/);
        if (isoMatch) {
            return { month: Number(isoMatch[2]), day: Number(isoMatch[3]) };
        }
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return null;
        return { month: parsed.getMonth() + 1, day: parsed.getDate() };
    }

    // Source-content fallback for weekday pinning: flyers often put the weekday on
    // its own line directly above the date ("SATURDAY\nJANUARY 17TH"), and the
    // model's evidence string quotes only the date line — no weekday, no pin.
    // Search the pass's source content for the extracted month+day token and
    // accept a weekday named in the preceding ~2 lines / ~40 chars, with nothing
    // date-like (digits or another month name) between the weekday and the date.
    // Conservative by design: pins only when the token match is unambiguous — the
    // month+day appears exactly once, or every occurrence agrees on the adjacent
    // weekday. Returns the JS day index (0=Sunday) or null.
    extractWeekdayNearDateInSource(sourceText, valueText) {
        const source = String(sourceText || '');
        if (!source.trim()) return null;
        const monthDay = this.getMonthDayFromDateText(valueText);
        if (!monthDay || monthDay.month < 1 || monthDay.month > 12) return null;

        const monthPatterns = [
            'jan(?:uary)?', 'feb(?:ruary)?', 'mar(?:ch)?', 'apr(?:il)?', 'may', 'jun(?:e)?',
            'jul(?:y)?', 'aug(?:ust)?', 'sep(?:t(?:ember)?)?', 'oct(?:ober)?', 'nov(?:ember)?', 'dec(?:ember)?'
        ];
        const monthPattern = monthPatterns[monthDay.month - 1];
        const dayPattern = `${monthDay.day}(?:st|nd|rd|th)?`;
        const dateTokenRegex = new RegExp(
            `\\b(?:${monthPattern}\\.?\\s*${dayPattern}|${dayPattern}\\s*(?:of\\s+)?${monthPattern}|${monthDay.month}[\\/.\\-]${monthDay.day})\\b`,
            'gi'
        );
        const weekdayPattern = '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)';
        const anyMonthRegex = new RegExp(`\\b(?:${monthPatterns.join('|')})\\b`, 'i');
        const dayIndexByPrefix = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

        const adjacentWeekdays = [];
        let occurrenceCount = 0;
        let tokenMatch;
        while ((tokenMatch = dateTokenRegex.exec(source)) !== null) {
            occurrenceCount++;
            // Preceding window: tail of the current line plus up to two lines
            // above, capped at 40 chars.
            const before = source.slice(0, tokenMatch.index);
            const context = before.split(/\r?\n/).slice(-3).join('\n').slice(-40);
            // The weekday closest to the date token wins; require only non-date
            // filler between them (no digits, no other month name).
            const weekdayRegex = new RegExp(`\\b${weekdayPattern}\\b`, 'gi');
            let lastWeekdayMatch = null;
            let weekdayMatch;
            while ((weekdayMatch = weekdayRegex.exec(context)) !== null) {
                lastWeekdayMatch = weekdayMatch;
            }
            let adjacentWeekday = null;
            if (lastWeekdayMatch) {
                const between = context.slice(lastWeekdayMatch.index + lastWeekdayMatch[0].length);
                if (!/\d/.test(between) && !anyMonthRegex.test(between)) {
                    const prefix = String(lastWeekdayMatch[1] || '').slice(0, 3).toLowerCase();
                    if (Object.prototype.hasOwnProperty.call(dayIndexByPrefix, prefix)) {
                        adjacentWeekday = dayIndexByPrefix[prefix];
                    }
                }
            }
            adjacentWeekdays.push(adjacentWeekday);
        }

        if (occurrenceCount === 0) return null;
        if (occurrenceCount === 1) return adjacentWeekdays[0];
        const first = adjacentWeekdays[0];
        if (first === null) return null;
        return adjacentWeekdays.every(weekday => weekday === first) ? first : null;
    }

    // Deterministic weekday→year pinning. Listing/flyer text often states a
    // weekday but no year ("Sat, Aug 22"); the extraction model then hallucinates
    // one, and window-based repair (adjustLikelyEventYear) can land on the wrong
    // weekday (2025-08-22 is a Friday). When a weekday is stated adjacent to the
    // date — in the field's own evidence, or (fallback) in the pass's source
    // content just above the date token — the year is derivable:
    //   - evidence carries an explicit 4-digit year too: verify weekday against
    //     the value as extracted; on agreement pin it as-is (protects a correct
    //     past date from window repair), on contradiction the weekday wins
    //     (flyers state weekdays reliably; years leak from helper-pass output)
    //     and the year is recomputed below;
    //   - no explicit year: try currentYear−1…currentYear+2 and keep candidates
    //     whose actual weekday matches; prefer one inside the year window, else
    //     the nearest to now.
    // Past dates are intentionally allowed — past events must stay datable so the
    // downstream past-filter can drop them (never force future).
    // Returns { value, pinnedYear, aiYear } or null when pinning does not apply
    // (no weekday anywhere, unparseable value, or no candidate matches the stated
    // weekday — e.g. bad OCR).
    resolveWeekdayPinnedYear(rawValue, evidenceText, sourceText = '') {
        if (typeof rawValue !== 'string') return null;
        const valueText = rawValue.trim();
        if (!valueText) return null;
        const yearMatch = valueText.match(/\b(?:19|20)\d{2}\b/);
        if (!yearMatch) return null;
        const evidence = String(evidenceText || '').trim();
        if (!evidence) return null;
        let statedWeekday = this.extractStatedWeekdayAdjacentToDate(evidence);
        if (statedWeekday === null) {
            statedWeekday = this.extractWeekdayNearDateInSource(sourceText, valueText);
            if (statedWeekday !== null) {
                console.log(`🤖 AI Web: Weekday for "${this.trimToMaxLength(valueText, 40)}" found in source content (evidence had none)`);
            }
        }
        if (statedWeekday === null) return null;

        const aiYear = Number(yearMatch[0]);
        if (/\b(?:19|20)\d{2}\b/.test(evidence)) {
            // Explicit year in evidence + stated weekday: verify them against each
            // other instead of refusing to pin (helper-pass output leaks years into
            // evidence strings). Agreement pins the date exactly as extracted.
            const asExtracted = this.buildWeekdayPinCandidate(valueText, yearMatch, aiYear);
            if (asExtracted && asExtracted.weekday === statedWeekday) {
                return { value: asExtracted.text, pinnedYear: aiYear, aiYear };
            }
            // Contradiction (or unparseable value): fall through — the weekday
            // recomputes the year via the candidate loop below.
        }
        const now = this.now();
        const currentYear = now.getFullYear();
        const matches = [];
        for (let year = currentYear - 1; year <= currentYear + 2; year++) {
            const candidate = this.buildWeekdayPinCandidate(valueText, yearMatch, year);
            if (candidate && candidate.weekday === statedWeekday) {
                matches.push(candidate);
            }
        }
        if (matches.length === 0) return null;

        let chosen = matches[0];
        if (matches.length > 1) {
            const dayMs = this.extractionLimits.millisPerDay;
            const windowStart = new Date(now.getTime() - (this.extractionLimits.yearWindowPastDays * dayMs));
            const windowEnd = new Date(now.getTime() + (this.extractionLimits.yearWindowFutureDays * dayMs));
            const inWindow = matches.filter(candidate => candidate.date >= windowStart && candidate.date <= windowEnd);
            const pool = inWindow.length > 0 ? inWindow : matches;
            chosen = pool.reduce((best, candidate) => {
                if (!best) return candidate;
                return Math.abs(candidate.date.getTime() - now.getTime()) < Math.abs(best.date.getTime() - now.getTime())
                    ? candidate
                    : best;
            }, null);
        }
        if (chosen.year !== aiYear) {
            console.log(`🤖 AI Web: Weekday-pinned year: "${this.trimToMaxLength(evidence, 80)}" → ${chosen.iso} (AI said ${aiYear})`);
        }
        return { value: chosen.text, pinnedYear: chosen.year, aiYear };
    }

    normalizeEventDates(startDate, endDate, weekdayPinnedYears = null) {
        const pinned = weekdayPinnedYears && typeof weekdayPinnedYears === 'object' ? weekdayPinnedYears : {};
        // A weekday-pinned year is deterministic — never "repair" it toward the
        // window (that is exactly the wrong-weekday failure pinning prevents).
        const adjustedStart = pinned.start && startDate instanceof Date && !Number.isNaN(startDate.getTime())
            ? new Date(startDate)
            : this.adjustLikelyEventYear(startDate);
        const adjustedEnd = pinned.end && endDate instanceof Date && !Number.isNaN(endDate.getTime())
            ? new Date(endDate)
            : this.adjustLikelyEventYear(endDate);
        if (!adjustedStart) {
            return { startDate: null, endDate: null };
        }
        let normalizedEnd = adjustedEnd || new Date(adjustedStart);
        if (normalizedEnd < adjustedStart) {
            // NYE year-jump: a Dec 31 event ending "2am Jan 1" can arrive with
            // the end on the SAME year's Jan 1 — eleven months BEFORE the start
            // — when the model reuses the start's year and the window repair
            // leaves it (e.g. it falls inside the past window). Bump the end
            // one year forward, but ONLY when that lands it within a week
            // AFTER the start (a genuine overnight/multi-day tail across the
            // year boundary); anything else keeps today's collapse-to-start.
            // Weekday-pinned ends are deterministic and never bumped.
            if (!pinned.end) {
                const bumpedEnd = new Date(normalizedEnd);
                bumpedEnd.setFullYear(bumpedEnd.getFullYear() + 1);
                const tailMs = bumpedEnd.getTime() - adjustedStart.getTime();
                if (tailMs >= 0 && tailMs <= 7 * this.extractionLimits.millisPerDay) {
                    console.log(`🤖 AI Web: End predates start by ~a year — rolled end across the year boundary: ${bumpedEnd.toISOString()}`);
                    normalizedEnd = bumpedEnd;
                }
            }
            if (normalizedEnd < adjustedStart) {
                normalizedEnd = new Date(adjustedStart);
            }
        }
        return { startDate: adjustedStart, endDate: normalizedEnd };
    }

    adjustLikelyEventYear(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
        const now = this.now();
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
        let inWindow = candidates.filter(candidate => candidate >= windowStart && candidate <= windowEnd);
        if (inWindow.length === 0) {
            // Hallucinated years can be more than ±1 off ("Sat, Aug 22" guessed as
            // 2024 when the window wants 2026) — re-anchor candidates on the current
            // year before giving up.
            const currentYear = now.getFullYear();
            const currentYearCandidates = [];
            for (let candidateYear = currentYear - 1; candidateYear <= currentYear + 2; candidateYear++) {
                if (candidateYear >= year - 1 && candidateYear <= year + 1) continue; // already tried
                const candidate = new Date(date);
                candidate.setFullYear(candidateYear);
                currentYearCandidates.push(candidate);
            }
            inWindow = currentYearCandidates.filter(candidate => candidate >= windowStart && candidate <= windowEnd);
        }
        if (inWindow.length === 0) {
            console.warn(`🤖 AI Web: Date ${date.toISOString()} is outside window [${windowStart.toISOString()}, ${windowEnd.toISOString()}] and no candidate year was in window.`);
        }
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

    // Derive the page's own brand names — the organizer/site identity the page
    // declares about itself: JSON-LD Organization name + alternateName, JSON-LD
    // WebSite name, and the og:site_name meta tag. Promoter pages (e.g.
    // bearracuda.com) put the brand in og:title/page titles and extraction leaks
    // it into bar/title; deriving the brand from the page keeps the guard generic
    // (no hardcoded organizer lists). og:site_name is deliberately excluded from
    // prompt meta parts (excludedMetaKeyRegexes), so it is read from the raw HTML.
    // Cached per-page brand lookup: brand extraction re-parses the page's JSON-LD,
    // so it is computed once per parsed page and carried on htmlData (segment and
    // OCR copies spread htmlData, inheriting the cache). parseEvents primes the
    // cache on the original page html before any per-pass copies are made.
    getPageBrandNames(htmlData) {
        if (!htmlData || typeof htmlData !== 'object') return [];
        if (Array.isArray(htmlData.pageBrandNames)) return htmlData.pageBrandNames;
        const names = this.extractPageBrandNames(typeof htmlData.html === 'string' ? htmlData.html : '');
        if (Object.isExtensible(htmlData)) {
            htmlData.pageBrandNames = names;
        }
        return names;
    }

    extractPageBrandNames(html) {
        const source = String(html || '').slice(0, 500000);
        const names = new Set();
        const addName = value => {
            const text = this.normalizeWhitespace(this.decodeBasicEntities(String(value || '')));
            if (text) names.add(text);
        };
        const collectBrandNodes = (node, depth) => {
            if (!node || depth > 6) return;
            if (Array.isArray(node)) {
                node.forEach(child => collectBrandNodes(child, depth + 1));
                return;
            }
            if (typeof node !== 'object') return;
            const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
            const isBrandType = types.some(type =>
                /^(Organization|WebSite)$/i.test(String(type || '').replace(/^https?:\/\/schema\.org\//i, '').trim()));
            if (isBrandType) {
                if (typeof node.name === 'string') addName(node.name);
                const alternates = Array.isArray(node.alternateName) ? node.alternateName : [node.alternateName];
                alternates.forEach(alternate => {
                    if (typeof alternate === 'string') addName(alternate);
                });
            }
            // Only descend through graph containers: an Organization nested inside an
            // Event (e.g. as location) may legitimately be the venue, not the brand.
            if (node['@graph']) collectBrandNodes(node['@graph'], depth + 1);
        };
        const scriptRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let match;
        while ((match = scriptRegex.exec(source)) !== null) {
            const text = this.normalizeWhitespace(this.decodeBasicEntities(match[1] || ''));
            if (!text) continue;
            let parsed = null;
            try {
                parsed = JSON.parse(text);
            } catch (_) {
                continue;
            }
            collectBrandNodes(parsed, 0);
        }
        const metaRegex = /<meta\b[^>]*>/gi;
        while ((match = metaRegex.exec(source)) !== null) {
            const tag = match[0];
            const nameMatch = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i);
            if (!nameMatch || this.normalizeWhitespace(nameMatch[1]).toLowerCase() !== 'og:site_name') continue;
            const contentMatch = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i);
            if (contentMatch) addName(this.sanitizeMetaContent('og:site_name', contentMatch[1]));
        }
        return Array.from(names);
    }

    // The page's site-level tagline(s): JSON-LD WebSite.description ONLY.
    // Promoter sites repeat the same site blurb on every event page (e.g.
    // bearracuda.com's "A Safe and Inclusive Space for Furry Friends and Their
    // Admirers!") and extraction can return it as the event description.
    // og:description and Event/WebPage-level descriptions are deliberately NOT
    // collected — those can legitimately be event-specific, and genuine event
    // taglines must never be dropped. Cached per page like getPageBrandNames.
    getPageSiteTaglines(htmlData) {
        if (!htmlData || typeof htmlData !== 'object') return [];
        if (Array.isArray(htmlData.pageSiteTaglines)) return htmlData.pageSiteTaglines;
        const taglines = this.extractPageSiteTaglines(typeof htmlData.html === 'string' ? htmlData.html : '');
        if (Object.isExtensible(htmlData)) {
            htmlData.pageSiteTaglines = taglines;
        }
        return taglines;
    }

    extractPageSiteTaglines(html) {
        const source = String(html || '').slice(0, 500000);
        const taglines = new Set();
        const addTagline = value => {
            const text = this.normalizeWhitespace(this.decodeBasicEntities(String(value || '')));
            if (text) taglines.add(text);
        };
        const collectWebSiteNodes = (node, depth) => {
            if (!node || depth > 6) return;
            if (Array.isArray(node)) {
                node.forEach(child => collectWebSiteNodes(child, depth + 1));
                return;
            }
            if (typeof node !== 'object') return;
            const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
            const isWebSite = types.some(type =>
                /^WebSite$/i.test(String(type || '').replace(/^https?:\/\/schema\.org\//i, '').trim()));
            if (isWebSite && typeof node.description === 'string') addTagline(node.description);
            // Same traversal rule as extractPageBrandNames: only descend through
            // graph containers — descriptions nested inside Event nodes are the
            // event's own data, never a site tagline.
            if (node['@graph']) collectWebSiteNodes(node['@graph'], depth + 1);
        };
        const scriptRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let match;
        while ((match = scriptRegex.exec(source)) !== null) {
            const text = this.normalizeWhitespace(this.decodeBasicEntities(match[1] || ''));
            if (!text) continue;
            let parsed = null;
            try {
                parsed = JSON.parse(text);
            } catch (_) {
                continue;
            }
            collectWebSiteNodes(parsed, 0);
        }
        return Array.from(taglines);
    }

    // Exact match only, after trimming + whitespace-collapsing (case-insensitive).
    // No fuzzy or substring matching whatsoever: an event tagline that merely
    // resembles the site blurb must survive.
    matchesSiteTagline(value, taglines) {
        const normalized = this.normalizeWhitespace(String(value || '')).toLowerCase();
        if (!normalized) return false;
        return (Array.isArray(taglines) ? taglines : []).some(tagline =>
            this.normalizeWhitespace(String(tagline || '')).toLowerCase() === normalized);
    }

    // Comparable variants of a brand-ish name: lowercased, punctuation stripped,
    // plus a copy without a trailing corporate suffix so "Bearracuda, Inc." matches
    // both "bearracuda inc" and "Bearracuda".
    getBrandNameVariants(value) {
        const variants = new Set();
        const stripped = String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9&\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!stripped) return variants;
        variants.add(stripped);
        const withoutSuffix = stripped.replace(/\s+(inc|incorporated|llc|ltd|co|corp|corporation|company)$/, '').trim();
        if (withoutSuffix) variants.add(withoutSuffix);
        return variants;
    }

    matchesPageBrandName(value, brandNames) {
        const valueVariants = this.getBrandNameVariants(value);
        if (valueVariants.size === 0) return false;
        return (Array.isArray(brandNames) ? brandNames : []).some(brand => {
            for (const variant of this.getBrandNameVariants(brand)) {
                if (valueVariants.has(variant)) return true;
            }
            return false;
        });
    }

    // Strip a leading/trailing site-brand segment from pipe-delimited titles
    // ("Portland PRIDE FRIDAY | BEARRACUDA" → "Portland PRIDE FRIDAY"). Only exact
    // brand matches are stripped, and at least one non-brand segment must remain.
    stripPageBrandFromTitle(title, brandNames) {
        const text = String(title || '');
        if (!text.includes('|') || !Array.isArray(brandNames) || brandNames.length === 0) return text;
        const parts = text.split('|').map(part => part.trim()).filter(Boolean);
        if (parts.length < 2) return text;
        const kept = parts.slice();
        while (kept.length > 1 && this.matchesPageBrandName(kept[kept.length - 1], brandNames)) kept.pop();
        while (kept.length > 1 && this.matchesPageBrandName(kept[0], brandNames)) kept.shift();
        if (kept.length === parts.length) return text;
        return kept.join(' | ');
    }

    // Emoji/pictograph-stripped view of a title — identical to SharedCore's
    // stripEmojiForTitleTwin (parsers are standalone and cannot import shared
    // code, so the regex is deliberately duplicated; keep the two in sync).
    // Conservative on purpose: ASCII and real punctuation are never stripped.
    stripEmojiFromTitle(value) {
        return String(value)
            .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0E}\u{FE0F}\u{20E3}\u{200D}]/gu, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // First og-style meta content for a key (e.g. 'og:title', 'og:site_name'),
    // entity-decoded and whitespace-collapsed. '' when absent.
    extractOgMetaContent(html, keyName) {
        const source = String(html || '').slice(0, 500000);
        const metaRegex = /<meta\b[^>]*>/gi;
        let match;
        while ((match = metaRegex.exec(source)) !== null) {
            const tag = match[0];
            const nameMatch = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i);
            if (!nameMatch || this.normalizeWhitespace(nameMatch[1]).toLowerCase() !== keyName) continue;
            const contentMatch = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i);
            if (!contentMatch) continue;
            const value = this.normalizeWhitespace(this.decodeBasicEntities(contentMatch[1]));
            if (value) return value;
        }
        return '';
    }

    // Cached per page like getPageBrandNames (segment/OCR copies spread
    // htmlData and inherit the cache).
    getPageOgTitle(htmlData) {
        if (!htmlData || typeof htmlData !== 'object') return '';
        if (typeof htmlData.pageOgTitle === 'string') return htmlData.pageOgTitle;
        const ogTitle = this.extractOgMetaContent(typeof htmlData.html === 'string' ? htmlData.html : '', 'og:title');
        if (Object.isExtensible(htmlData)) {
            htmlData.pageOgTitle = ogTitle;
        }
        return ogTitle;
    }

    getPageOgSiteName(htmlData) {
        if (!htmlData || typeof htmlData !== 'object') return '';
        if (typeof htmlData.pageOgSiteName === 'string') return htmlData.pageOgSiteName;
        const siteName = this.extractOgMetaContent(typeof htmlData.html === 'string' ? htmlData.html : '', 'og:site_name');
        if (Object.isExtensible(htmlData)) {
            htmlData.pageOgSiteName = siteName;
        }
        return siteName;
    }

    // Canonical identity form for comparing an extracted image value against the
    // page's own og:image/twitter:image meta URLs: the existing URL
    // normalization (normalizeHttpUrlValue) first, then trailing-slash and case
    // differences collapsed. Identity comparison ONLY — never stored on events.
    canonicalizeImageUrlForComparison(url) {
        const normalized = this.normalizeHttpUrlValue(url);
        if (!normalized) return '';
        return normalized.replace(/\/+$/, '').toLowerCase();
    }

    // The page's own social-artwork meta URLs (og:image / twitter:image and
    // their variants) in canonical comparison form. Each raw meta value is also
    // added in its CDN-upgraded form because the final extracted image went
    // through upgradeCdnThumbnailUrl. Cached per page like getPageOgTitle
    // (segment/OCR copies spread htmlData and inherit the cache).
    getPageMetaImageUrls(htmlData) {
        if (!htmlData || typeof htmlData !== 'object') return [];
        if (Array.isArray(htmlData.pageMetaImageUrls)) return htmlData.pageMetaImageUrls;
        const html = typeof htmlData.html === 'string' ? htmlData.html : '';
        const metaKeys = ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'];
        const urls = new Set();
        for (const metaKey of metaKeys) {
            // extractOgMetaContent entity-decodes except &amp; — same explicit
            // second decode as buildEventFromJsonLdNode's clean().
            const content = this.extractOgMetaContent(html, metaKey).replace(/&amp;/gi, '&');
            if (!content) continue;
            const canonical = this.canonicalizeImageUrlForComparison(content);
            if (canonical) urls.add(canonical);
            const upgraded = this.canonicalizeImageUrlForComparison(this.upgradeCdnThumbnailUrl(content));
            if (upgraded) urls.add(upgraded);
        }
        const list = Array.from(urls);
        if (Object.isExtensible(htmlData)) {
            htmlData.pageMetaImageUrls = list;
        }
        return list;
    }

    // imageSource provenance stamp (notes-serialized like pinSource, excluded
    // from AI arbitration — see shared-core's image provenance rung):
    //   - 'og-image' when the extracted image IS the source page's own
    //     og:image/twitter:image artwork (compared by canonical URL, robust to
    //     which extraction pass produced the value);
    //   - 'page' for everything else the AI-web pipeline extracted from page
    //     content/OCR/segments (the default for AI-web extracted images).
    // An already-stamped or absent image is left untouched (fail open), so the
    // JSON-LD path's 'jsonld' stamp and other parsers' unstamped images are
    // never relabeled.
    // og:image fill for imageless single-event pages: when a page produced
    // EXACTLY ONE event and extraction found no image, the page's own
    // og:image/twitter:image meta IS that event's artwork — adopt it. Uses the
    // RAW meta value run through the standard storage pipeline
    // (normalizeHttpUrlValue → unwrapImageProxyUrl → upgradeCdnThumbnailUrl),
    // never the lowercased comparison form getPageMetaImageUrls builds.
    // Obvious non-artwork URLs (logos/icons per isLikelyUninterestingImageUrl)
    // are skipped; an event that already has an image is left untouched.
    fillImageFromPageMetaArtwork(event, htmlData) {
        if (!event || typeof event !== 'object') return event;
        const existingImage = typeof event.image === 'string' ? event.image.trim() : '';
        if (existingImage) return event;
        const html = htmlData && typeof htmlData.html === 'string' ? htmlData.html : '';
        if (!html) return event;
        const metaKeys = ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'];
        for (const metaKey of metaKeys) {
            // Same explicit &amp; second decode as getPageMetaImageUrls.
            const content = this.extractOgMetaContent(html, metaKey).replace(/&amp;/gi, '&');
            if (!content) continue;
            const normalized = this.normalizeHttpUrlValue(content);
            if (!normalized) continue;
            const unwrapped = this.unwrapImageProxyUrl(normalized) || normalized;
            const upgraded = this.upgradeCdnThumbnailUrl(unwrapped);
            if (!upgraded || this.isLikelyUninterestingImageUrl(upgraded)) continue;
            event.image = upgraded;
            event.imageSource = 'og-image';
            console.log(`🤖 AI Web: Filled image from page og:image for "${event.title}"`);
            return event;
        }
        return event;
    }

    stampImageProvenance(event, htmlData) {
        if (!event || typeof event !== 'object') return event;
        if (event.imageSource) return event;
        const image = typeof event.image === 'string' ? event.image.trim() : '';
        if (!image) return event;
        const canonical = this.canonicalizeImageUrlForComparison(image);
        const metaImageUrls = this.getPageMetaImageUrls(htmlData);
        event.imageSource = canonical && metaImageUrls.includes(canonical) ? 'og-image' : 'page';
        return event;
    }

    // ========================================================================
    // SITE ROLE (venue vs organizer) + BAR CORROBORATION (barSource)
    // ========================================================================
    // Page-derived trust signals for the extracted bar, protecting venues the
    // curated bars data has never seen. All determinations are hard facts
    // (config override, the page's own JSON-LD types, observed addresses) —
    // no AI tiebreak. Everything fails open: undetermined role injects no
    // context, an unverifiable bar gets no stamp.

    // 'venue' | 'organizer' | '' — normalized siteRole value.
    normalizeSiteRoleValue(value) {
        const text = String(value || '').trim().toLowerCase();
        return text === 'venue' || text === 'organizer' ? text : '';
    }

    // Cache-only reader for the page's resolved site role. Segment/OCR
    // htmlData copies spread the original object, so the page-level
    // determination (resolvePageSiteRole) is inherited everywhere.
    getPageSiteRole(htmlData) {
        return htmlData && typeof htmlData === 'object' && typeof htmlData.pageSiteRole === 'string'
            ? this.normalizeSiteRoleValue(htmlData.pageSiteRole)
            : '';
    }

    // Resolve who this SITE is, hard facts in precedence order:
    //   1) parser config override `siteRole: "venue" | "organizer"`;
    //   2) the page's own JSON-LD @type being venue-ish (NightClub/BarOrPub/
    //      EventVenue/MusicVenue) → venue;
    //   3) segment-derived facts when segments are provided (multi-event
    //      pages): a JSON-LD Organization/PerformingGroup whose listings sit
    //      at MULTIPLE distinct street addresses → organizer; a single
    //      recurring street address that ALSO appears outside the listings
    //      (footer/contact) → venue.
    // Anything else stays '' (undetermined — no steering context injected).
    // The result is cached on htmlData so every downstream copy inherits it.
    resolvePageSiteRole(htmlData, parserConfig = {}, segments = null) {
        const configRole = this.normalizeSiteRoleValue(parserConfig && parserConfig.siteRole);
        if (configRole) {
            if (htmlData && typeof htmlData === 'object' && Object.isExtensible(htmlData)) {
                htmlData.pageSiteRole = configRole;
                htmlData.pageSiteRoleReason = 'parser config siteRole';
                if (configRole === 'venue') this.getPageVenueName(htmlData);
            }
            return configRole;
        }
        if (!htmlData || typeof htmlData !== 'object') return '';
        if (typeof htmlData.pageSiteRole !== 'string') {
            const signals = this.getJsonLdSiteSignals(htmlData);
            const role = signals.venueType ? 'venue' : '';
            if (Object.isExtensible(htmlData)) {
                htmlData.pageSiteRole = role;
                htmlData.pageSiteRoleReason = role ? `json-ld @type ${signals.venueType}` : '';
            }
        }
        if (htmlData.pageSiteRole === '' && Array.isArray(segments) && segments.length > 0
            && !htmlData.pageSiteRoleSegmentsChecked && Object.isExtensible(htmlData)) {
            htmlData.pageSiteRoleSegmentsChecked = true;
            const derived = this.deriveSiteRoleFromSegments(htmlData, segments);
            if (derived.role) {
                htmlData.pageSiteRole = derived.role;
                htmlData.pageSiteRoleReason = derived.reason;
            }
        }
        // Prime the venue-name cache on the ORIGINAL htmlData while its full
        // html (meta tags, JSON-LD) is still present — segment copies replace
        // html with segment text and could no longer derive it.
        if (htmlData.pageSiteRole === 'venue') this.getPageVenueName(htmlData);
        return this.getPageSiteRole(htmlData);
    }

    // One line per page describing the site-role outcome (determined or not).
    logPageSiteRoleOnce(htmlData) {
        if (!htmlData || typeof htmlData !== 'object' || htmlData.pageSiteRoleLogged) return;
        if (Object.isExtensible(htmlData)) htmlData.pageSiteRoleLogged = true;
        const components = this.parseUrlComponents(typeof htmlData.url === 'string' ? htmlData.url : '');
        const host = components && components.hostname ? components.hostname : 'unknown-host';
        const role = this.getPageSiteRole(htmlData);
        if (!role) {
            console.log(`🤖 AI Web: siteRole for ${host} undetermined`);
            return;
        }
        const reason = typeof htmlData.pageSiteRoleReason === 'string' && htmlData.pageSiteRoleReason
            ? ` (${htmlData.pageSiteRoleReason})`
            : '';
        console.log(`🤖 AI Web: siteRole for ${host}: ${role}${reason}`);
    }

    // ------------------------------------------------------------------------
    // VENUE-SITE ADDRESS CONSENSUS (deterministic, no AI)
    // ------------------------------------------------------------------------
    // A venue's own website knows its address in machine-readable form: the
    // site footer's map-directions links carry it on every page (run
    // 20260724-161423: massive.club shipped events with city "unknown" while
    // its footer linked google.com/maps/dir/?api=1&destination=619+E+Pine+
    // St%2C+Seattle%2C+WA+98122 on every fetched page). Every page that flows
    // through parseEvents contributes candidates keyed by registrable host
    // (host without www); once the whole crawl has been seen, the site has a
    // venue address ONLY if exactly one distinct normalized address was
    // observed (fail closed: two or more distinct addresses — or a siteRole
    // 'organizer' determination, config or page-derived — derive nothing).
    // The consensus fills BLANKS only (address with addressSource
    // 'venue-site', city via the configured city patterns) on events produced
    // from that site's pages. An event already carrying a DIFFERENT address
    // is a party at another venue announced on this site and is never
    // relocated (multi-venue safety) — its city is left alone too.

    // Registrable host key for a page URL: hostname, lowercased, port and
    // leading www. stripped ('' when unparseable).
    getVenueSiteHostKey(url) {
        const components = this.parseUrlComponents(typeof url === 'string' ? url : '');
        const hostname = components && components.hostname ? components.hostname : '';
        return hostname.split(':')[0].replace(/^www\./, '').toLowerCase();
    }

    // Comparison key for consensus: shared-core's address-token normalizer
    // (case/whitespace/punctuation-insensitive, "St"/"Street" and
    // directionals expanded) when wired; a plain lowercase-alphanumeric
    // token join otherwise. The fallback is stricter (no abbreviation
    // expansion), so at worst two spellings of one address count as distinct
    // and consensus fails closed.
    normalizeVenueSiteAddressKey(address) {
        if (this.core && typeof this.core.normalizeAddressTokens === 'function') {
            return this.core.normalizeAddressTokens(address).join(' ');
        }
        return String(address || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .join(' ');
    }

    // Street addresses from map-directions links in raw page HTML:
    // google.com/maps destination=/daddr= and maps.apple.com address=/q=
    // query params. String/regex parsing only (no URL global on iOS
    // JavaScriptCore); &amp;-entity-encoded hrefs — the form raw HTML
    // attributes actually carry — are decoded first. Only address-shaped
    // values survive (isAddressShapedBarValue): a venue name or coordinate
    // pair in q= is not an address (fail closed).
    extractMapsDirectionsAddresses(html) {
        const source = String(html || '');
        const addresses = [];
        const urlMatches = source.match(/https?:\/\/[^\s"'<>]+/gi) || [];
        for (const rawUrl of urlMatches) {
            const url = rawUrl.replace(/&amp;/gi, '&').replace(/&#0*38;/g, '&');
            let paramKeys = null;
            if (/^https?:\/\/(?:[a-z0-9-]+\.)*google\.[a-z.]{2,10}\/maps(?:[/?]|$)/i.test(url)
                || /^https?:\/\/maps\.google\.[a-z.]{2,10}\//i.test(url)) {
                paramKeys = ['destination', 'daddr'];
            } else if (/^https?:\/\/maps\.apple\.com\//i.test(url)) {
                paramKeys = ['address', 'q'];
            }
            if (!paramKeys) continue;
            const queryIndex = url.indexOf('?');
            if (queryIndex < 0) continue;
            const search = url.slice(queryIndex).replace(/#[\s\S]*$/, '');
            for (const key of paramKeys) {
                const value = this.extractSearchParamValue(search, key).replace(/\s+/g, ' ').trim();
                if (!value || !this.isAddressShapedBarValue(value)) continue;
                addresses.push(value);
                break;
            }
        }
        return addresses;
    }

    // Per-run harvest state: host → { addresses: {normKey → {display,
    // pages: Set}}, pages: Set, blocked }. Lazily created; consumed and reset
    // by applyVenueSiteAddressConsensus at the end of each parser run.
    getVenueSiteHarvestEntry(host) {
        if (!this.venueSiteHarvest) this.venueSiteHarvest = Object.create(null);
        if (!this.venueSiteHarvest[host]) {
            this.venueSiteHarvest[host] = {
                addresses: Object.create(null),
                pages: new Set(),
                blocked: false,
                venueRoleSeen: false,
                venueName: ''
            };
        }
        return this.venueSiteHarvest[host];
    }

    // Identity facts for the venue-site identity pass: remember that SOME page
    // of this host resolved siteRole 'venue', and the venue name the host
    // declares (first non-empty wins). The name is harvested from ANY
    // non-organizer page — most venue sites never positively resolve 'venue'
    // (run 20260727-123001: massive.club stayed "undetermined" on every page,
    // which starved the identity guard of a name it had plainly published).
    // Recording a name asserts nothing by itself; organizer pages record
    // nothing and still block via the existing veto.
    recordVenueSiteRoleFacts(entry, htmlData) {
        if (!entry) return;
        const role = this.getPageSiteRole(htmlData);
        if (role === 'organizer') return;
        if (role === 'venue') entry.venueRoleSeen = true;
        if (!entry.venueName) entry.venueName = this.getPageVenueName(htmlData);
    }

    // Collect this page's map-directions addresses into the per-host harvest
    // (once per page URL). A page whose resolved siteRole is 'organizer'
    // permanently blocks venue derivation for its host — the parser config
    // override lands here via resolvePageSiteRole, which runs first in
    // parseEvents.
    harvestVenueSiteAddresses(htmlData) {
        if (!htmlData || typeof htmlData !== 'object') return;
        const pageUrl = typeof htmlData.url === 'string' ? htmlData.url : '';
        const host = this.getVenueSiteHostKey(pageUrl);
        if (!host) return;
        const entry = this.getVenueSiteHarvestEntry(host);
        if (this.getPageSiteRole(htmlData) === 'organizer') entry.blocked = true;
        this.recordVenueSiteRoleFacts(entry, htmlData);
        if (entry.pages.has(pageUrl)) return;
        entry.pages.add(pageUrl);
        const seenKeys = new Set();
        const html = typeof htmlData.html === 'string' ? htmlData.html : '';
        for (const address of this.extractMapsDirectionsAddresses(html)) {
            const key = this.normalizeVenueSiteAddressKey(address);
            if (!key || seenKeys.has(key)) continue;
            seenKeys.add(key);
            if (!entry.addresses[key]) entry.addresses[key] = { display: address, pages: new Set() };
            entry.addresses[key].pages.add(pageUrl);
        }
    }

    // Stamp each produced event with its page's registrable host (internal
    // _venueSitePageHost — underscore fields are excluded from notes/merge
    // field loops, matching _organizer) so the post-crawl consensus can find
    // the site's events. Also re-checks the page's siteRole: segment-derived
    // 'organizer' determinations land AFTER the page-entry harvest ran.
    tagEventsWithVenueSitePage(events, htmlData) {
        if (!Array.isArray(events) || events.length === 0) return;
        const pageUrl = htmlData && typeof htmlData.url === 'string' ? htmlData.url : '';
        const host = this.getVenueSiteHostKey(pageUrl);
        if (!host) return;
        if (this.getPageSiteRole(htmlData) === 'organizer') {
            this.getVenueSiteHarvestEntry(host).blocked = true;
        }
        this.recordVenueSiteRoleFacts(this.getVenueSiteHarvestEntry(host), htmlData);
        for (const event of events) {
            if (event && typeof event === 'object' && !event._venueSitePageHost) {
                event._venueSitePageHost = host;
            }
        }
    }

    // End-of-run consensus + enrich-only application (called by shared-core's
    // processParser once every page of the run has been crawled — consensus
    // cannot be judged mid-crawl without risking fills a later page's
    // conflicting address would have vetoed). Per host: exactly one distinct
    // normalized address → fill BLANK address (addressSource 'venue-site')
    // and blank/"unknown" city on that host's events; two or more distinct →
    // one log line, derive nothing (fail closed); siteRole 'organizer' →
    // derive nothing. Fill-blanks-only keeps this subordinate to the curated
    // machinery: BarDataNormalizer's curated fills/upgrades run later and
    // outrank 'venue-site' (addressSource trust tier 2, below curated's 3).
    // Harvest state resets afterwards (per-run scope).
    applyVenueSiteAddressConsensus(events, cityConfig = null) {
        const harvest = this.venueSiteHarvest;
        this.venueSiteHarvest = null;
        if (!harvest) return;
        // Stash the per-host harvest outcomes for the identity pass that runs
        // right after this one (applyVenueSiteIdentityCorrections consumes and
        // clears it) — consensus first, identity second.
        this.lastVenueSiteConsensus = Object.create(null);
        for (const host of Object.keys(harvest)) {
            const entry = harvest[host];
            const hostKeys = Object.keys(entry.addresses);
            const consensusKey = !entry.blocked && hostKeys.length === 1 ? hostKeys[0] : '';
            this.lastVenueSiteConsensus[host] = {
                consensusKey,
                consensusAddress: consensusKey ? entry.addresses[consensusKey].display : '',
                blocked: entry.blocked === true,
                venueRoleSeen: entry.venueRoleSeen === true,
                venueName: typeof entry.venueName === 'string' ? entry.venueName : ''
            };
        }
        const eventList = Array.isArray(events) ? events : [];
        for (const host of Object.keys(harvest)) {
            const entry = harvest[host];
            const keys = Object.keys(entry.addresses);
            if (entry.blocked || keys.length === 0) continue;
            if (keys.length > 1) {
                console.log(`🤖 AI Web: No venue-site address consensus for ${host}: ${keys.length} distinct addresses observed`);
                continue;
            }
            const consensusKey = keys[0];
            const candidate = entry.addresses[consensusKey];
            const consensusAddress = candidate.display;
            console.log(`🤖 AI Web: Venue-site address consensus for ${host}: "${consensusAddress}" (${candidate.pages.size} page(s))`);
            const cityKey = this.findCityKeyInText(consensusAddress, cityConfig);
            for (const event of eventList) {
                if (!event || typeof event !== 'object' || event._venueSitePageHost !== host) continue;
                const title = typeof event.title === 'string' && event.title.trim() ? event.title.trim() : 'unknown';
                const existingAddress = typeof event.address === 'string' ? event.address.trim() : '';
                if (existingAddress
                    && this.normalizeVenueSiteAddressKey(existingAddress) !== consensusKey) {
                    // Multi-venue safety: a party at ANOTHER venue announced
                    // on this site keeps its own address AND city untouched —
                    // never relocated to the site's home address.
                    continue;
                }
                if (!existingAddress) {
                    event.address = consensusAddress;
                    event.addressSource = 'venue-site';
                    console.log(`🤖 AI Web: Filled address from venue-site consensus for "${title}"`);
                }
                const existingCity = typeof event.city === 'string' ? event.city.trim().toLowerCase() : '';
                if (cityKey && (!existingCity || existingCity === 'unknown')) {
                    event.city = cityKey;
                    console.log(`🤖 AI Web: Filled city "${cityKey}" from venue-site consensus for "${title}"`);
                }
            }
        }
    }

    // Same-address test for identity establishment and its multi-venue skip:
    // parsed street-line comparison first (parseAddressForComparison +
    // isSameStreetAddress), with normalized-token join equality as the
    // fallback when either side does not parse. Fails closed on blanks.
    venueSiteIdentityAddressesAgree(addressA, addressB) {
        const a = String(addressA || '').trim();
        const b = String(addressB || '').trim();
        if (!a || !b || !this.core) return false;
        const parsedA = this.core.parseAddressForComparison(a);
        const parsedB = this.core.parseAddressForComparison(b);
        if (parsedA && parsedB) return this.core.isSameStreetAddress(parsedA, parsedB);
        const tokensA = this.core.normalizeAddressTokens(a).join(' ');
        const tokensB = this.core.normalizeAddressTokens(b).join(' ');
        return Boolean(tokensA) && tokensA === tokensB;
    }

    // WHO a crawled site is — established only when independent hard facts
    // converge, failing closed on ANY miss:
    //   1. no page of the host ever resolved siteRole 'organizer' (blocked —
    //      the same veto the address consensus honors). A positive 'venue'
    //      resolution is NOT required for host-level identity: most venue
    //      sites stay "undetermined" (run 20260727-123001 — massive.club
    //      never resolved 'venue' while its curated name and 7-page address
    //      consensus both held), and the two hard facts below are already
    //      independent and specific.
    //   2. the harvested venue name uniquely matches ONE curated bar
    //      (findCuratedBarCityByName — ambiguous cities and generic franchise
    //      stems never establish identity);
    //   3. address agreement, either level: the host's address consensus IS
    //      the curated bar's address (whole-host identity, hostLevel: true),
    //      or — when the host produced no consensus at all — identity applies
    //      per-event only (hostLevel: false; the caller requires the event's
    //      own _geoPoiName to equal the bar's name key), and THIS weaker path
    //      still requires an explicit venue-role page. A consensus that
    //      CONTRADICTS the curated address establishes nothing.
    // Ticketing-platform org pages (eventbrite.com) can never establish
    // identity: the registrable host is the platform's, so its venue name
    // resolves to the platform brand ("Eventbrite") and matches no curated
    // bar — the curated-name condition is the structural guard.
    getEstablishedVenueSiteIdentity(entry, consensusKey = '') {
        if (!entry || typeof entry !== 'object') return null;
        if (entry.blocked !== false) return null;
        const venueName = typeof entry.venueName === 'string' ? entry.venueName.trim() : '';
        if (!venueName) return null;
        if (!this.core || typeof this.core.findCuratedBarCityByName !== 'function') return null;
        const match = this.core.findCuratedBarCityByName(venueName);
        if (!match || !match.city || !match.bar) return null;
        const curatedBar = match.bar;
        const roleSignals = entry.venueRoleSeen === true ? ['venue-role'] : [];
        if (consensusKey) {
            const consensusAddress = typeof entry.consensusAddress === 'string' ? entry.consensusAddress.trim() : '';
            const curatedAddress = typeof curatedBar.address === 'string' ? curatedBar.address.trim() : '';
            if (!curatedAddress || !this.venueSiteIdentityAddressesAgree(consensusAddress, curatedAddress)) {
                return null;
            }
            return {
                name: curatedBar.name, city: match.city, curatedBar, hostLevel: true,
                signals: [...roleSignals, 'curated-name', 'address-consensus']
            };
        }
        if (entry.venueRoleSeen !== true) return null;
        return {
            name: curatedBar.name, city: match.city, curatedBar, hostLevel: false,
            signals: ['venue-role', 'curated-name', 'geo-poi']
        };
    }

    // Deterministic KNOWN-VENUE replacement pass, run by shared-core's
    // processParser immediately AFTER applyVenueSiteAddressConsensus (which
    // stashes lastVenueSiteConsensus for it). On a host whose identity is
    // established, an event's bar that is really a flyer subtitle or guest
    // brand is corrected to the curated venue name — with per-event skips
    // that keep multi-venue announcements (off-site street address), bars the
    // curated data or the page's own structured data corroborates, and the
    // venue's own name (casing normalized only) untouched.
    applyVenueSiteIdentityCorrections(events, cityConfig = null) {
        const consensusByHost = this.lastVenueSiteConsensus;
        this.lastVenueSiteConsensus = null;
        if (!consensusByHost || !this.core) return;
        const eventList = Array.isArray(events) ? events : [];
        for (const host of Object.keys(consensusByHost)) {
            const entry = consensusByHost[host];
            const identity = this.getEstablishedVenueSiteIdentity(entry, entry.consensusKey);
            if (!identity) continue;
            const curatedBar = identity.curatedBar;
            const identityKey = this.core.normalizeBarNameKey(curatedBar.name);
            const cityBars = typeof this.core.getCuratedCityBars === 'function'
                ? this.core.getCuratedCityBars(identity.city)
                : null;
            const signals = identity.signals;
            let identityLogged = false;
            const logIdentityOnce = () => {
                if (identityLogged) return;
                identityLogged = true;
                console.log(`🤖 AI Web: Venue-site identity for ${host} established: "${curatedBar.name}" (${identity.city}) — signals: ${signals.join(', ')}`);
            };
            if (identity.hostLevel) logIdentityOnce();
            for (const event of eventList) {
                if (!event || typeof event !== 'object' || event._venueSitePageHost !== host) continue;
                if (!identity.hostLevel) {
                    // POI promotion: without an address consensus, identity
                    // applies only to events whose accepted pin's map POI IS
                    // this venue.
                    const poiName = typeof event._geoPoiName === 'string' ? event._geoPoiName.trim() : '';
                    if (!poiName || this.core.normalizeBarNameKey(poiName) !== identityKey) continue;
                }
                // Multi-venue skip: a party at ANOTHER street address
                // announced on this site keeps its own bar untouched.
                const existingAddress = typeof event.address === 'string' ? event.address.trim() : '';
                if (existingAddress
                    && this.normalizeVenueSiteAddressKey(existingAddress) !== entry.consensusKey
                    && !this.venueSiteIdentityAddressesAgree(existingAddress, curatedBar.address)) {
                    continue;
                }
                logIdentityOnce();
                const title = typeof event.title === 'string' && event.title.trim() ? event.title.trim() : 'unknown';
                const bar = typeof event.bar === 'string' ? event.bar.trim() : '';
                const barSource = typeof event.barSource === 'string' ? event.barSource.trim() : '';
                // Already the venue: normalize casing to the curated name only.
                if (bar && this.core.normalizeBarNameKey(bar) === identityKey) {
                    if (bar !== curatedBar.name) event.bar = curatedBar.name;
                    continue;
                }
                // Corroborated elsewhere: a DIFFERENT curated bar of this
                // city, or a curated stamp, outranks identity — flag only.
                const otherCurated = bar && cityBars ? this.core.findCuratedBarByName(cityBars, bar) : null;
                if (bar && (otherCurated || barSource === 'curated')) {
                    console.log(`🤖 AI Web: Kept bar "${bar}" for "${title}" — matches another curated ${identity.city} bar; venue-site identity not applied`);
                    continue;
                }
                // The page's own structured data named this bar — never
                // overridden here.
                if (event._barFromJsonLd === true) continue;
                if (!bar) {
                    event.bar = curatedBar.name;
                    event.barSource = 'venue-site-identity';
                    console.log(`🤖 AI Web: Filled bar "${curatedBar.name}" from venue-site identity for "${title}"`);
                } else {
                    event._venueIdentityCorrection = {
                        original: bar,
                        originalSource: barSource,
                        signals
                    };
                    // A convergence rescue that adopted the replaced value is
                    // stale evidence for a bar that no longer exists.
                    if (event._barRescue && typeof event._barRescue === 'object'
                        && this.core.normalizeBarNameKey(event._barRescue.candidate) === this.core.normalizeBarNameKey(bar)) {
                        delete event._barRescue;
                    }
                    event.bar = curatedBar.name;
                    event.barSource = 'venue-site-identity';
                    console.log(`🤖 AI Web: Replaced bar "${bar}" with venue-site identity "${curatedBar.name}" for "${title}" (was ${barSource || 'unstamped'})`);
                }
                // City knock-on: the dedup re-anchor pass then resolves any
                // timezone-unresolved dates — no new timezone code here.
                const existingCity = typeof event.city === 'string' ? event.city.trim().toLowerCase() : '';
                if (!existingCity || existingCity === 'unknown') {
                    event.city = identity.city;
                }
            }
        }
    }

    // JSON-LD facts about the page's own identity. Same traversal rule as
    // extractPageBrandNames: top-level nodes and @graph containers only — a
    // venue-typed Place nested inside an Event is that EVENT's location, not
    // the page's identity. Cached per page.
    getJsonLdSiteSignals(htmlData) {
        if (!htmlData || typeof htmlData !== 'object') {
            return { venueType: '', venueName: '', organizationTypeFound: false };
        }
        if (htmlData.pageJsonLdSiteSignals && typeof htmlData.pageJsonLdSiteSignals === 'object') {
            return htmlData.pageJsonLdSiteSignals;
        }
        const signals = this.extractJsonLdSiteSignals(typeof htmlData.html === 'string' ? htmlData.html : '');
        if (Object.isExtensible(htmlData)) {
            htmlData.pageJsonLdSiteSignals = signals;
        }
        return signals;
    }

    extractJsonLdSiteSignals(html) {
        const source = String(html || '').slice(0, 500000);
        const signals = { venueType: '', venueName: '', organizationTypeFound: false };
        const venueTypePattern = /^(NightClub|BarOrPub|EventVenue|MusicVenue)$/i;
        const organizerTypePattern = /^(Organization|PerformingGroup)$/i;
        const collect = (node, depth) => {
            if (!node || depth > 6) return;
            if (Array.isArray(node)) {
                node.forEach(child => collect(child, depth + 1));
                return;
            }
            if (typeof node !== 'object') return;
            const types = (Array.isArray(node['@type']) ? node['@type'] : [node['@type']])
                .map(type => String(type || '').replace(/^https?:\/\/schema\.org\//i, '').trim());
            const venueType = types.find(type => venueTypePattern.test(type));
            if (venueType) {
                if (!signals.venueType) signals.venueType = venueType;
                if (!signals.venueName && typeof node.name === 'string') {
                    signals.venueName = this.normalizeWhitespace(this.decodeBasicEntities(node.name));
                }
            }
            if (types.some(type => organizerTypePattern.test(type))) {
                signals.organizationTypeFound = true;
            }
            if (node['@graph']) collect(node['@graph'], depth + 1);
        };
        const scriptRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let match;
        while ((match = scriptRegex.exec(source)) !== null) {
            const text = this.normalizeWhitespace(this.decodeBasicEntities(match[1] || ''));
            if (!text) continue;
            let parsed = null;
            try {
                parsed = JSON.parse(text);
            } catch (_) {
                continue;
            }
            collect(parsed, 0);
        }
        return signals;
    }

    // Segment-derived site-role facts for multi-event pages (hard facts only).
    deriveSiteRoleFromSegments(htmlData, segments) {
        const streetCounts = new Map();
        for (const segment of Array.isArray(segments) ? segments : []) {
            const text = segment && Array.isArray(segment.lines) ? segment.lines.join('\n') : '';
            for (const street of this.extractStreetLineCandidates(text)) {
                const normalized = this.normalizeAdjacencyText(street);
                if (!normalized) continue;
                streetCounts.set(normalized, (streetCounts.get(normalized) || 0) + 1);
            }
        }
        if (streetCounts.size >= 2 && this.getJsonLdSiteSignals(htmlData).organizationTypeFound) {
            return { role: 'organizer', reason: `json-ld organization with events at ${streetCounts.size} distinct addresses` };
        }
        if (streetCounts.size === 1) {
            const [streetNormalized, segmentCount] = streetCounts.entries().next().value;
            const pageText = this.normalizeAdjacencyText(
                this.getPageTextForSiteRole(htmlData && typeof htmlData.html === 'string' ? htmlData.html : ''));
            if (this.countOccurrences(pageText, streetNormalized) > segmentCount) {
                return { role: 'venue', reason: 'single recurring address also appears outside the event listings' };
            }
        }
        return { role: '', reason: '' };
    }

    // Full-page text INCLUDING footer/contact regions (extractBodyParts strips
    // them, but "the venue's address in the site footer" is exactly the
    // signal the single-recurring-address fact needs).
    getPageTextForSiteRole(html) {
        let text = String(html || '').slice(0, 500000);
        text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi, ' ');
        text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style[^>]*>/gi, ' ');
        text = text.replace(/<!--[\s\S]*?-->/g, ' ');
        text = text.replace(/<[^>]+>/g, ' ');
        return this.decodeBasicEntities(text);
    }

    // Street-line shapes in free text: house number + 1-4 name words + a
    // street-type word ("619 E. PINE ST"). Suffix-less styles ("3702 N
    // Halsted") are deliberately not matched here — this feeds the site-role
    // facts, which fail open when nothing matches.
    extractStreetLineCandidates(text) {
        const results = [];
        // [ \t] only — a street line never spans corpus lines here, and \s+
        // would glue a date line's trailing number onto the next line's street.
        const pattern = /\b\d{1,6}(?:-\d{1,4})?(?:[ \t]+[\w][\w.'’-]*){1,4}[ \t]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Hwy|Highway|Pl|Place|Ct|Court|Pkwy|Parkway|Sq|Square|Ter|Terrace)\b\.?/gi;
        let match;
        while ((match = pattern.exec(String(text || ''))) !== null) {
            results.push(match[0]);
        }
        return results;
    }

    countOccurrences(text, needle) {
        if (!text || !needle) return 0;
        let count = 0;
        let from = 0;
        let position;
        while ((position = text.indexOf(needle, from)) !== -1) {
            count += 1;
            from = position + needle.length;
        }
        return count;
    }

    // The venue's display name for a venue-role page, best declared source
    // first: og:site_name → the JSON-LD venue node's name → the page brand
    // name → the host's base label ("massive" from massive.club). Cached per
    // page (resolvePageSiteRole primes it before segment copies are made).
    getPageVenueName(htmlData) {
        if (!htmlData || typeof htmlData !== 'object') return '';
        if (typeof htmlData.pageVenueName === 'string') return htmlData.pageVenueName;
        let name = this.getPageOgSiteName(htmlData)
            || this.getJsonLdSiteSignals(htmlData).venueName
            || (this.getPageBrandNames(htmlData)[0] || '');
        if (!name) {
            const components = this.parseUrlComponents(typeof htmlData.url === 'string' ? htmlData.url : '');
            const host = components && components.hostname
                ? components.hostname.split(':')[0].replace(/^www\./, '')
                : '';
            name = host ? host.split('.')[0] : '';
        }
        if (Object.isExtensible(htmlData)) {
            htmlData.pageVenueName = name;
        }
        return name;
    }

    // Comparison view for bar/address adjacency: lowercased, emoji and
    // punctuation noise stripped (the 🪩 marker etc.), whitespace collapsed.
    normalizeAdjacencyText(value) {
        return String(value || '')
            .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0E}\u{FE0F}\u{20E3}\u{200D}]/gu, ' ')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    // The address's street line: the first comma/newline segment that starts
    // with a house number and contains letters ("619 E. Pine St" from
    // "619 E. Pine St, Seattle, WA 98122"). '' when none (fail open).
    getAddressStreetLine(address) {
        const segments = String(address || '').split(/[,\n]/);
        for (const segment of segments) {
            const text = segment.trim();
            if (!text) continue;
            if (/^\d{1,6}(?:-\d{1,6})?\s+/.test(text) && /[a-z]/i.test(text)) return text;
        }
        return '';
    }

    // Deterministic adjacency test: does the bar name appear within ±2 lines
    // (or ~150 characters) of ANY occurrence of the address street line in
    // the source corpus? Case/whitespace-insensitive containment on the
    // normalized (emoji/punctuation-stripped) view.
    checkBarAddressAdjacency(bar, streetLine, corpusText) {
        const barNormalized = this.normalizeAdjacencyText(bar);
        const streetNormalized = this.normalizeAdjacencyText(streetLine);
        if (!barNormalized || !streetNormalized) {
            return { addressFound: false, adjacent: false, rawLines: [], occurrenceLines: [] };
        }
        const rawLines = String(corpusText || '').split('\n');
        const normalizedLines = rawLines.map(line => this.normalizeAdjacencyText(line));
        const occurrenceLines = [];
        normalizedLines.forEach((line, index) => {
            if (line && line.includes(streetNormalized)) occurrenceLines.push(index);
        });
        let adjacent = false;
        for (const index of occurrenceLines) {
            const windowText = normalizedLines.slice(Math.max(0, index - 2), index + 3).join(' ');
            if (windowText.includes(barNormalized)) {
                adjacent = true;
                break;
            }
        }
        // ~150-character fallback on the flattened text: catches street lines
        // broken across corpus lines, which per-line containment cannot see.
        let addressFound = occurrenceLines.length > 0;
        if (!adjacent) {
            const flatText = normalizedLines.filter(Boolean).join(' ');
            let from = 0;
            let position;
            while ((position = flatText.indexOf(streetNormalized, from)) !== -1) {
                addressFound = true;
                const windowText = flatText.slice(Math.max(0, position - 150), position + streetNormalized.length + 150);
                if (windowText.includes(barNormalized)) {
                    adjacent = true;
                    break;
                }
                from = position + 1;
            }
        }
        return { addressFound, adjacent, rawLines, occurrenceLines };
    }

    // Deterministic rescue signal (log only, never auto-applied): when the
    // extracted bar was NOT adjacent to the address, look for exactly one
    // OTHER capitalized token-run directly adjacent (±1 line) to the address
    // — the shape of "MASSIVE: 619 E. PINE ST". Runs that are the organizer,
    // part of the address, address-shaped, or boilerplate words are excluded;
    // anything other than exactly one surviving candidate returns '' (a noisy
    // window proves nothing).
    findAdjacentVenueCandidate(event, adjacency, htmlData) {
        const occurrenceLines = adjacency && Array.isArray(adjacency.occurrenceLines)
            ? adjacency.occurrenceLines : [];
        const rawLines = adjacency && Array.isArray(adjacency.rawLines) ? adjacency.rawLines : [];
        if (occurrenceLines.length === 0 || rawLines.length === 0) return '';
        const barNormalized = this.normalizeAdjacencyText(event && event.bar);
        const addressNormalized = this.normalizeAdjacencyText(event && event.address);
        const brandNames = this.getPageBrandNames(htmlData);
        const organizer = event && typeof event._organizer === 'string' ? event._organizer : '';
        const stopwords = new Set([
            'doors', 'tickets', 'presents', 'free', 'rsvp', 'vip', 'info', 'ages',
            'admission', 'cover', 'at', 'the', 'and', 'door', 'pm', 'am',
            'ocr', 'image', 'text', 'url', 'segment', 'index'
        ]);
        const runPattern = /[A-Z][A-Za-z0-9&'’.-]*(?:[ \t]+[A-Z][A-Za-z0-9&'’.-]*)*/g;
        const windowLineIndexes = new Set();
        occurrenceLines.forEach(lineIndex => {
            for (let delta = -1; delta <= 1; delta += 1) {
                const index = lineIndex + delta;
                if (index >= 0 && index < rawLines.length) windowLineIndexes.add(index);
            }
        });
        const candidates = new Map();
        for (const index of windowLineIndexes) {
            const line = String(rawLines[index] || '');
            let match;
            runPattern.lastIndex = 0;
            while ((match = runPattern.exec(line)) !== null) {
                const run = match[0].replace(/[.,:;|]+$/, '').trim();
                if (run.length < 2 || run.length > 30) continue;
                const runNormalized = this.normalizeAdjacencyText(run);
                if (!runNormalized) continue;
                if (barNormalized && (runNormalized.includes(barNormalized) || barNormalized.includes(runNormalized))) continue;
                if (addressNormalized && addressNormalized.includes(runNormalized)) continue;
                const tokens = runNormalized.split(' ');
                if (tokens.every(token => stopwords.has(token) || /^\d+$/.test(token))) continue;
                if (organizer && this.matchesPageBrandName(run, [organizer])) continue;
                if (brandNames.length > 0 && this.matchesPageBrandName(run, brandNames)) continue;
                if (this.core && typeof this.core.looksLikeStreetAddress === 'function'
                    && this.core.looksLikeStreetAddress(run)) continue;
                if (/\d/.test(run)
                    && /(?:^|\s)(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Hwy|Pl|Place|Ct|Court)\.?(?:\s|$)/i.test(run)) continue;
                if (!candidates.has(runNormalized)) candidates.set(runNormalized, run);
                if (candidates.size > 1) return '';
            }
        }
        return candidates.size === 1 ? candidates.values().next().value : '';
    }

    // Address-shape plausibility for the post-extraction gate. A value counts
    // as address-shaped when ANY of these hold (fail open — keep when unsure):
    //   - it looks like a street address (shared-core's looksLikeStreetAddress:
    //     leading house number + street-type word);
    //   - it carries a standalone house-number token anywhere ("Calle X 12");
    //   - it contains a street-type word on its own boundary ("Warrenton St");
    //   - it is a comma-separated "Place, Place"/"Place, ST" form;
    //   - it is a multi-word value with none of the above — a place name like
    //     "LA NOGALERA" (vague but real; the geocode grade gate handles it).
    // Only a single bare word with no address signal at all ("Legacy") fails —
    // that shape is a name, never an address.
    isPlausiblyAddressShaped(value) {
        const text = String(value || '').trim();
        if (!text) return false;
        if (this.core && typeof this.core.looksLikeStreetAddress === 'function'
            && this.core.looksLikeStreetAddress(text)) return true;
        // Standalone (house) number token anywhere in the value.
        if (/(^|[\s,])\d{1,6}[a-z]?(?:-\d{1,6})?(?=$|[\s,])/i.test(text)) return true;
        // Street-type word on a word boundary.
        if (/(?:^|[\s,])(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Pl|Place|Ct|Court|Pkwy|Parkway|Hwy|Highway)\.?(?:$|[\s,])/i.test(text)) return true;
        // "Place, Place" / "Place, ST" comma form.
        if (text.split(',').map(part => part.trim()).filter(Boolean).length >= 2) return true;
        // Multi-word place name — vague but real, keep (fail open).
        return text.split(/\s+/).filter(Boolean).length >= 2;
    }

    // Post-extraction address plausibility gate (flag-and-drop, additive log):
    // the extracted address is removed when it is (a) normalized-equal to the
    // bar name or the page's derived organizer/brand (a venue name is not an
    // address), or (b) not address-shaped per isPlausiblyAddressShaped. The
    // event is otherwise untouched; downstream the venue-POI adoption rung in
    // the geocode flow can rebuild a real address from the bar name. Fails
    // open: no address, no signals, or any uncertainty → left as-is.
    applyAddressPlausibilityGate(event, htmlData) {
        if (!event || typeof event !== 'object') return event;
        const address = typeof event.address === 'string' ? event.address.trim() : '';
        if (!address) return event;
        const normalizedAddress = this.normalizeAdjacencyText(address);
        if (!normalizedAddress) return event;
        let reason = '';
        const bar = typeof event.bar === 'string' ? event.bar.trim() : '';
        if (bar && this.normalizeAdjacencyText(bar) === normalizedAddress) {
            reason = 'matches venue name';
        }
        if (!reason) {
            const organizer = typeof event._organizer === 'string' ? event._organizer.trim() : '';
            const brandNames = this.getPageBrandNames(htmlData);
            const knownNames = [organizer, ...(Array.isArray(brandNames) ? brandNames : [])]
                .filter(name => typeof name === 'string' && name.trim());
            if (knownNames.some(name => this.normalizeAdjacencyText(name) === normalizedAddress)) {
                reason = 'matches organizer/brand name';
            }
        }
        if (!reason && !this.isPlausiblyAddressShaped(address)) {
            reason = 'not address-shaped';
        }
        if (!reason) return event;
        console.log(`🤖 AI Web: Dropped implausible address "${address}" (${reason})`);
        delete event.address;
        return event;
    }

    // Address-shape test for a BAR value (run 20260724-115423: extraction
    // returned bar "79 Warren" off the flyer's street line and no gate
    // guarded the bar the way applyAddressPlausibilityGate guards the
    // address). Address-shaped means a street-address pattern, NEVER merely
    // "contains a digit" — venue names legitimately carry numbers ("Bar 32",
    // "Studio 54", "700 Club" all keep). True when ANY of:
    //   - shared-core's looksLikeStreetAddress: leading house number +
    //     street-type word ("79 Warrenton St");
    //   - the digit + street-type-word shape the convergence rescue's
    //     candidate filter rejects (getVenueLineCandidateRejection);
    //   - a leading house number followed by a SINGLE bare word that is not
    //     a venue-type word — the truncated street line off a flyer
    //     ("79 WARRENTON"); a venue-type word stays a name ("700 Club").
    isAddressShapedBarValue(value) {
        const text = String(value || '').trim();
        if (!text) return false;
        if (this.core && typeof this.core.looksLikeStreetAddress === 'function'
            && this.core.looksLikeStreetAddress(text)) return true;
        if (/\d/.test(text)
            && /(?:^|\s)(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Hwy|Pl|Place|Ct|Court)\.?(?:\s|$)/i.test(text)) return true;
        const truncatedStreetLine = text.match(/^\d{1,6}(?:-\d{1,6})?\s+([A-Za-z][A-Za-z'’.-]*)$/);
        if (truncatedStreetLine) {
            const venueTypeWord = /^(?:club|bar|lounge|pub|tavern|saloon|cafe|café|grill|restaurant|studio|hall|house|room|theater|theatre|cabaret|hotel|inn|brewery|taproom|eatery|bistro|diner|kitchen)$/i;
            return !venueTypeWord.test(truncatedStreetLine[1]);
        }
        return false;
    }

    // Post-extraction bar plausibility gate (mirror of
    // applyAddressPlausibilityGate: flag-and-drop, additive log): an
    // address-shaped bar VALUE is never a valid extraction. Run
    // 20260724-115423 kept bar "79 Warren" (a truncated street line that
    // slipped the verbatim gate) and the surviving garbage then — correctly,
    // by design — blocked the bar-convergence rescue from adopting the real
    // venue "Legacy". Runs BEFORE applyBarConvergenceRescue so a dropped bar
    // frees the rescue to fire. Fails open: no bar, or not address-shaped →
    // untouched.
    applyBarPlausibilityGate(event) {
        if (!event || typeof event !== 'object') return event;
        const bar = typeof event.bar === 'string' ? event.bar.trim() : '';
        if (!bar) return event;
        if (!this.isAddressShapedBarValue(bar)) return event;
        console.log(`🤖 AI Web: Dropped implausible bar "${bar}" (address-shaped)`);
        delete event.bar;
        return event;
    }

    // Slug tokens from a URL's path — tiny local tokenizer (normalizers'
    // tokenizePoiBarName is out of reach: platform purity only allows the
    // normalizers→core direction, and no new URL() anywhere): strip
    // query/hash, split every path segment on non-alphanumerics, lowercase,
    // drop empties. Returns every single token plus every joined run of two
    // adjacent tokens within a segment ("legacy"; "bearweek" from
    // ".../furball-boston-725-bear-week-legacy-tickets/14269444") — the
    // same identity space as normalizeBarNameKey output.
    buildUrlSlugTokens(url) {
        const text = String(url || '').split(/[?#]/)[0];
        const schemeIndex = text.indexOf('://');
        const pathStart = text.indexOf('/', schemeIndex >= 0 ? schemeIndex + 3 : 0);
        if (pathStart < 0) return [];
        const tokens = [];
        for (const segment of text.slice(pathStart).split('/')) {
            const segmentTokens = segment.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
            for (let i = 0; i < segmentTokens.length; i++) {
                tokens.push(segmentTokens[i]);
                if (i + 1 < segmentTokens.length) tokens.push(segmentTokens[i] + segmentTokens[i + 1]);
            }
        }
        return tokens;
    }

    // Deterministic bar-convergence rescue (run 20260723-224434: the FURBALL
    // Boston segment plainly listed its venue "Legacy", the flyer OCR read
    // "LEGACY", and Legacy is a curated Boston bar — but the model returned
    // the street address as the bar and the verbatim gate dropped it,
    // leaving no bar, no venue-POI address, no pin). When extraction
    // produced NO bar, three independent corpora vote:
    //   - PAGE:    every line of the segment's page text (single-page events
    //              fall back to the page evidence text — never the OCR
    //              prepend, so OCR stays an independent signal);
    //   - OCR:     every line of the event's OCR image text;
    //   - CURATED: every curated bar name for the event's city (event.city,
    //              else any city key resolvable from the page text).
    // PAGE/OCR lines become candidates only when the deterministic
    // could-be-a-name filter passes (getVenueLineCandidateRejection);
    // curated names are always candidates. Candidates that normalize to the
    // same bar-name key (normalizeBarNameKey: "LEGACY"/"Legacy"/"The
    // Legacy") are ONE candidate. Each candidate then carries up to four
    // signals — curated match, whole-word presence in PAGE, whole-word
    // presence in OCR, bar-name key present in a ticket-link URL slug
    // (URL) — and is adopted only with >= 2 of them. Never one
    // signal alone: core doctrine, a bar is never invented from a single
    // corpus. No positional anchor anywhere; position appears only as a
    // ranking tie-breaker (proximity to a location/address-shaped PAGE
    // line), so layout changes — venue below the city line, venue only on
    // the flyer, extra noise — cannot break the rescue. A still-tied top
    // pair adopts nothing (ambiguity is logged, never guessed). Never runs
    // when a model-returned bar survived the gate (a surviving extraction is
    // not second-guessed), and operates purely on the scraped event
    // pre-merge — calendar-side bars are untouched.
    applyBarConvergenceRescue(event, htmlData, parserConfig, cityConfig) {
        if (!event || typeof event !== 'object') return event;
        const existingBar = typeof event.bar === 'string' ? event.bar.trim() : '';
        if (existingBar) return event;

        // Corpus PAGE — the segment's own text, page evidence text fallback.
        const segmentText = htmlData && typeof htmlData.segmentText === 'string' ? htmlData.segmentText : '';
        const pageText = segmentText.trim()
            ? segmentText
            : (this.buildAiEvidenceContext(htmlData, parserConfig).raw || '');
        // Corpus OCR — every OCR result's text for this event.
        const ocrResults = htmlData && Array.isArray(htmlData.ocrResults) ? htmlData.ocrResults : [];
        const ocrCorpus = ocrResults
            .map(ocr => (ocr && typeof ocr.text === 'string' ? ocr.text : ''))
            .filter(text => text.trim())
            .join('\n');
        if (!pageText.trim() && !ocrCorpus) return event;
        const pageLines = pageText.split('\n').map(line => line.trim());
        const ocrLines = ocrCorpus.split('\n').map(line => line.trim());

        // Corpus CURATED — the event's city first, else any city key the
        // page text itself resolves to (best-effort: no city, no curated
        // corpus, but PAGE+OCR convergence still works).
        const curatedCityKey = (typeof event.city === 'string' && event.city.trim())
            ? event.city.trim()
            : this.findCityKeyInText(pageText, cityConfig);
        let cityBars = null;
        if (this.core && typeof this.core.getCuratedCityBars === 'function'
            && typeof this.core.findCuratedBarByName === 'function') {
            try {
                cityBars = this.core.getCuratedCityBars(curatedCityKey);
            } catch (_) {
                cityBars = null; // curated corpus is best-effort — fail open
            }
        }

        // Corpus URL — deterministic slug signal (run 20260724-122902: the
        // ticket link ".../furball-boston-725-bear-week-legacy-tickets"
        // plainly named the venue but reached nothing): slug tokens come
        // from the segment's SEGMENT_LINK_URL resource lines and the
        // event's extracted ticketUrl; a candidate whose bar-name key
        // equals a single slug token or a joined run of two adjacent
        // tokens ("legacy"; "bearweek") carries the 'url' signal. Adoption
        // still requires >= 2 signals — a slug alone never invents a bar.
        const slugUrls = (htmlData && typeof htmlData.html === 'string' ? htmlData.html.split('\n') : [])
            .map(line => {
                const match = line.match(/^SEGMENT_LINK_URL:\s*(\S+)/);
                return match ? match[1] : '';
            })
            .filter(Boolean);
        if (event && typeof event.ticketUrl === 'string' && event.ticketUrl.trim()) {
            slugUrls.push(event.ticketUrl.trim());
        }
        const slugTokenKeys = new Set();
        slugUrls.forEach(url => this.buildUrlSlugTokens(url).forEach(token => slugTokenKeys.add(token)));

        // Candidate pool, deduped on the shared bar-name identity key so
        // "LEGACY" (OCR) + "Legacy" (page) + curated "Legacy" are ONE
        // candidate accumulating all of its signals.
        const normalizeKey = value => (this.core && typeof this.core.normalizeBarNameKey === 'function'
            ? this.core.normalizeBarNameKey(value)
            : String(value || '').toLowerCase().replace(/^\s*the\s+/, '').replace(/[^a-z0-9]/g, ''));
        const candidates = new Map();
        const addCandidate = (text, origin) => {
            const form = String(text || '').trim();
            const key = normalizeKey(form);
            if (!key) return;
            let entry = candidates.get(key);
            if (!entry) {
                entry = { forms: [], pageForm: '', ocrForm: '' };
                candidates.set(key, entry);
            }
            if (!entry.forms.includes(form)) entry.forms.push(form);
            if (origin === 'page' && !entry.pageForm) entry.pageForm = form;
            if (origin === 'ocr' && !entry.ocrForm) entry.ocrForm = form;
        };
        // The could-be-a-name filter runs BEFORE signals: an organizer brand
        // or address line never becomes a candidate no matter how many
        // corpora repeat it. Curated names are trusted venue names, so the
        // shape rejections don't apply to them — but the organizer/brand and
        // event-title guards are absolute: the promoter is never rescued as
        // the venue, curated or not.
        pageLines.forEach(line => {
            if (line && !this.getVenueLineCandidateRejection(line, event, htmlData, cityConfig, parserConfig)) addCandidate(line, 'page');
        });
        ocrLines.forEach(line => {
            if (line && !this.getVenueLineCandidateRejection(line, event, htmlData, cityConfig, parserConfig)) addCandidate(line, 'ocr');
        });
        (Array.isArray(cityBars) ? cityBars : []).forEach(bar => {
            if (!bar || typeof bar.name !== 'string') return;
            const rejection = this.getVenueLineCandidateRejection(bar.name, event, htmlData, cityConfig, parserConfig);
            if (rejection === 'matches organizer/brand' || rejection === 'matches event title') return;
            addCandidate(bar.name, 'curated');
        });
        if (candidates.size === 0) return event;

        // Whole-word, case-insensitive, flexible-whitespace presence test —
        // every surface form of the candidate counts, so a curated "The
        // Eagle" still finds the page's plain "Eagle" line.
        const buildWholeWordPattern = form => {
            const escaped = form
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/\s+/g, '\\s+');
            return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, 'i');
        };

        // Proximity anchors for the tie-break: location-form or
        // address-shaped PAGE lines. Position's ONLY appearance.
        const anchorIndexes = [];
        pageLines.forEach((line, index) => {
            if (line && this.isLocationAnchorLine(line, event)) anchorIndexes.push(index);
        });

        const scored = [];
        for (const [candidateKey, entry] of candidates.entries()) {
            const patterns = entry.forms.map(buildWholeWordPattern);
            const pageIndexes = [];
            pageLines.forEach((line, index) => {
                if (line && patterns.some(pattern => pattern.test(line))) pageIndexes.push(index);
            });
            const curatedBar = cityBars ? this.core.findCuratedBarByName(cityBars, entry.forms[0]) : null;
            const signals = [];
            if (curatedBar) signals.push('curated');
            if (pageIndexes.length > 0) signals.push('page');
            if (ocrCorpus && patterns.some(pattern => pattern.test(ocrCorpus))) signals.push('ocr');
            if (slugTokenKeys.has(candidateKey)) signals.push('url');
            scored.push({
                curatedBar,
                signals,
                // Fewest lines from any anchor, over every PAGE occurrence;
                // candidates absent from PAGE rank last here.
                proximity: (pageIndexes.length > 0 && anchorIndexes.length > 0)
                    ? Math.min(...pageIndexes.map(i => Math.min(...anchorIndexes.map(a => Math.abs(i - a)))))
                    : Infinity,
                firstPageIndex: pageIndexes.length > 0 ? pageIndexes[0] : Infinity,
                // Adopted casing: curated wins, else the page's, else OCR's.
                name: curatedBar ? curatedBar.name : (entry.pageForm || entry.ocrForm || entry.forms[0]),
                // The raw observed text (page first) for provenance.
                candidateForm: entry.pageForm || entry.ocrForm || entry.forms[0]
            });
        }
        // Ranking: curated signal, then signal count, then anchor proximity,
        // then earliest PAGE appearance. 0 = genuinely indistinguishable.
        const compareCandidates = (a, b) => {
            if ((a.curatedBar ? 1 : 0) !== (b.curatedBar ? 1 : 0)) return (b.curatedBar ? 1 : 0) - (a.curatedBar ? 1 : 0);
            if (a.signals.length !== b.signals.length) return b.signals.length - a.signals.length;
            if (a.proximity !== b.proximity) return a.proximity - b.proximity;
            if (a.firstPageIndex !== b.firstPageIndex) return a.firstPageIndex - b.firstPageIndex;
            return 0;
        };
        scored.sort(compareCandidates);
        const qualified = scored.filter(candidate => candidate.signals.length >= 2);
        if (qualified.length === 0) {
            // Log-only (flag-don't-drop): name the best candidate actually
            // observed in a text corpus. A curated name absent from both
            // texts is not worth naming — the page never hinted at it.
            const observed = scored.find(candidate =>
                candidate.signals.includes('page') || candidate.signals.includes('ocr'));
            if (observed) {
                console.log(`🤖 AI Web: Bar rescue candidate "${observed.name}" carries only one signal (${observed.signals.join(', ')}) — not adopted`);
            }
            return event;
        }
        const top = qualified[0];
        if (qualified.length > 1 && compareCandidates(top, qualified[1]) === 0) {
            console.log(`🤖 AI Web: Bar rescue ambiguous between "${top.name}" and "${qualified[1].name}" — not adopted`);
            return event;
        }
        event.bar = top.name;
        event.barSource = top.curatedBar ? 'curated' : 'page-adjacent';
        // Underscore field — internal metadata, never serialized into notes;
        // shared-core's buildEventEvidenceLines renders it in the evidence
        // panel so a rescued bar is always visible in the results UI.
        event._barRescue = {
            candidate: top.candidateForm,
            signals: top.signals
        };
        console.log(`🤖 AI Web: Rescued bar "${event.bar}" via signal convergence (signals: ${top.signals.join(', ')})`);
        return event;
    }

    // A PAGE line that anchors the bar-rescue proximity tie-break: an
    // explicit "<Place>, <Place>" location line or an address-shaped line
    // (same shapes getVenueLineCandidateRejection rejects as candidates).
    isLocationAnchorLine(line, event) {
        const text = String(line || '').trim();
        if (!text) return false;
        if (this.extractAdjacentLocationPlacePair(text, event)) return true;
        if (this.core && typeof this.core.looksLikeStreetAddress === 'function'
            && this.core.looksLikeStreetAddress(text)) return true;
        return /\d/.test(text)
            && /(?:^|\s)(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Hwy|Pl|Place|Ct|Court)\.?(?:\s|$)/i.test(text);
    }

    // Conservative brand-stem containment for the venue-candidate guard
    // (matchesPageBrandName is whole-value equality, so the flyer's bare
    // "FURBALL" slipped past the page brand "furballnyc" — run
    // 20260724-122902): compact each brand variant (spaces stripped) and
    // match when one is a prefix of the other with a remainder of <= 4
    // chars ("furball" ⊂ "furballnyc", remainder "nyc"). A minimum 4-char
    // stem keeps short fragments from ever matching.
    matchesBrandNameStem(value, brandNames) {
        const valueVariants = Array.from(this.getBrandNameVariants(value))
            .map(variant => variant.replace(/\s+/g, ''))
            .filter(Boolean);
        if (valueVariants.length === 0) return false;
        return (Array.isArray(brandNames) ? brandNames : []).some(brand => {
            for (const brandVariant of this.getBrandNameVariants(brand)) {
                const compactBrand = brandVariant.replace(/\s+/g, '');
                if (!compactBrand) continue;
                for (const compactValue of valueVariants) {
                    const shorter = compactValue.length <= compactBrand.length ? compactValue : compactBrand;
                    const longer = compactValue.length <= compactBrand.length ? compactBrand : compactValue;
                    if (shorter.length >= 4
                        && longer.startsWith(shorter)
                        && longer.length - shorter.length <= 4) return true;
                }
            }
            return false;
        });
    }

    // '' when a corpus line could plausibly be a venue name; otherwise the
    // deterministic reason it can never be one. Rejection is silent — an
    // unusable line is the common case in any corpus, not a signal worth
    // logging. cityConfig/parserConfig are optional context (threaded from
    // applyBarConvergenceRescue): configured city names and the parser's own
    // configured name are never venue candidates.
    getVenueLineCandidateRejection(candidate, event, htmlData, cityConfig = null, parserConfig = null) {
        const text = String(candidate || '').trim();
        if (!text) return 'empty';
        if (text.length > 40) return 'too long';
        if (/(?:https?:\/\/|www\.)/i.test(text)) return 'url';
        if (/[$€£]\s*\d/.test(text) || /\b\d+\s*(?:dollars|usd)\b/i.test(text)) return 'price';
        if (/\b\d{1,2}:\d{2}\b/.test(text) || /\b\d{1,2}\s*(?:am|pm)\b/i.test(text)) return 'time';
        if (/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b[\s.,]*\d{1,2}/i.test(text)
            || /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(text)
            || /\b(?:mon|tues?|wednes|thurs?|fri|satur|sun)day\b/i.test(text)
            || /\b20\d{2}\b/.test(text)) return 'date';
        const normalized = this.normalizeAdjacencyText(text);
        if (!normalized) return 'empty';
        // Bare calendar words join the date rejection (run 20260724-122902:
        // flyer lines "SAT" and "JULY" qualified as venue candidates): a
        // candidate made ONLY of month names, weekday names/abbreviations
        // (including plurals like "SATURDAYS"), and digits is a date line.
        const calendarWord = /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|(?:mon|tues?|wednes|thurs?|fri|satur|sun)days?|mon|tues?|wed|thur?s?|fri|sat|sun)$/;
        if (normalized.split(' ').every(token => calendarWord.test(token) || /^\d+$/.test(token))) {
            return 'date';
        }
        const stopwords = new Set([
            'tickets', 'ticket', 'info', 'rsvp', 'free', 'doors', 'details',
            'presents', 'vip', 'admission', 'cover', 'ages', 'buy', 'get',
            'more', 'here', 'tba', 'tbd',
            // Hype/status words observed qualifying on real flyers — never
            // venue names on their own.
            'tonight', 'live', 'party', 'presale'
        ]);
        if (normalized.split(' ').every(token => stopwords.has(token) || /^\d+$/.test(token))) {
            return 'generic';
        }
        // "sold out" as a phrase (the bare tokens stay off the stopword set
        // so a venue actually named "Out" is never a casualty).
        if (normalized === 'sold out') return 'generic';
        const title = this.normalizeAdjacencyText(event && event.title);
        if (title && normalized === title) return 'matches event title';
        // A bare city is never a venue: reject a candidate whose WHOLE value
        // resolves to a configured city (key/name/pattern/alias equality —
        // containment would reject legitimate names like "SF Eagle") or to
        // the event's own city (run 20260724-122902: flyer line "BOSTON"
        // tied the rescue into refusing).
        if (this.findCityConfigEntry(normalized, cityConfig)) return 'city name';
        const barNameKey = value => (this.core && typeof this.core.normalizeBarNameKey === 'function'
            ? this.core.normalizeBarNameKey(value)
            : String(value || '').toLowerCase().replace(/^\s*the\s+/, '').replace(/[^a-z0-9]/g, ''));
        const eventCity = event && typeof event.city === 'string' ? event.city.trim() : '';
        if (eventCity && barNameKey(text) && barNameKey(text) === barNameKey(eventCity)) {
            return 'city name';
        }
        const organizer = event && typeof event._organizer === 'string' ? event._organizer.trim() : '';
        const brandNames = this.getPageBrandNames(htmlData);
        const parserName = parserConfig && typeof parserConfig.name === 'string' ? parserConfig.name.trim() : '';
        const knownNames = [organizer, parserName, ...(Array.isArray(brandNames) ? brandNames : [])]
            .filter(name => typeof name === 'string' && name.trim());
        if (knownNames.length > 0
            && (this.matchesPageBrandName(text, knownNames) || this.matchesBrandNameStem(text, knownNames))) {
            return 'matches organizer/brand';
        }
        if (this.core && typeof this.core.looksLikeStreetAddress === 'function'
            && this.core.looksLikeStreetAddress(text)) return 'address-shaped';
        if (/\d/.test(text)
            && /(?:^|\s)(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Hwy|Pl|Place|Ct|Court)\.?(?:\s|$)/i.test(text)) {
            return 'address-shaped';
        }
        if (this.extractAdjacentLocationPlacePair(text, event)) return 'location line';
        return '';
    }

    // barSource provenance stamp (notes-serialized like imageSource, excluded
    // from AI arbitration — see shared-core's corroboration demotion rung):
    //   - 'curated'       the bar matches curated bars data for its city
    //                     (only when bars data is reachable via this.core);
    //   - 'venue-site'    the bar IS the venue whose own site this page is;
    //   - 'page-adjacent' the bar sits next to the address in the source;
    //   - 'uncorroborated' the address is in the source but the bar is NOT
    //                     near it (flag-don't-drop: the value is kept).
    // No bar, no address, address not locatable in the corpus, or an already
    // stamped event → left untouched (fail open).
    stampBarSourceProvenance(event, evidenceContext, htmlData) {
        if (!event || typeof event !== 'object' || event.barSource) return event;
        const bar = typeof event.bar === 'string' ? event.bar.trim() : '';
        if (!bar) return event;
        if (this.core && typeof this.core.getCuratedCityBars === 'function'
            && typeof this.core.findCuratedBarByName === 'function') {
            try {
                const cityBars = this.core.getCuratedCityBars(event.city);
                if (cityBars && this.core.findCuratedBarByName(cityBars, bar)) {
                    event.barSource = 'curated';
                    return event;
                }
            } catch (_) {
                // curated matching is best-effort — fail open to the checks below
            }
        }
        if (this.getPageSiteRole(htmlData) === 'venue') {
            const venueName = this.getPageVenueName(htmlData);
            if (venueName && this.matchesPageBrandName(bar, [venueName])) {
                event.barSource = 'venue-site';
                return event;
            }
        }
        const address = typeof event.address === 'string' ? event.address.trim() : '';
        const corpus = evidenceContext && typeof evidenceContext.raw === 'string' ? evidenceContext.raw : '';
        if (!address || !corpus) return event;
        const streetLine = this.getAddressStreetLine(address);
        if (!streetLine) return event;
        const adjacency = this.checkBarAddressAdjacency(bar, streetLine, corpus);
        if (!adjacency.addressFound) return event;
        if (adjacency.adjacent) {
            event.barSource = 'page-adjacent';
            return event;
        }
        event.barSource = 'uncorroborated';
        console.log(`🤖 AI Web: Bar "${bar}" not found near address "${streetLine}" in source — flagging as uncorroborated`);
        const candidate = this.findAdjacentVenueCandidate(event, adjacency, htmlData);
        if (candidate) {
            console.log(`🤖 AI Web: Adjacent venue candidate: "${candidate}"`);
        }
        return event;
    }

    // An explicit "<Place>, <Place>" location line ("Torremolinos, Spain",
    // "Asbury Park, NJ"): 2–3 comma-separated segments, every word of every
    // segment capitalized (title-case or ALL-CAPS proper-noun runs, never
    // sentence text like "Doors open, free entry"), the last segment allowed a
    // trailing postal code. The first segment must not be a street address (no
    // leading digits, by construction of the place form) and must not be the
    // venue/bar itself. Returns { line, place } or null.
    extractAdjacentLocationPlacePair(rawLine, event) {
        const line = String(rawLine || '').trim();
        if (!line || line.length > 80) return null;
        const parts = line.split(',').map(part => part.trim());
        if (parts.length < 2 || parts.length > 3) return null;
        const placeForm = /^[A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*)*$/;
        const first = parts[0];
        if (/^\d/.test(first) || !placeForm.test(first)) return null;
        const rest = parts.slice(1);
        const lastForm = /^[A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*)*(?:\s+\d{4,6})?$/;
        if (!rest.every((part, index) => (index === rest.length - 1 ? lastForm : placeForm).test(part))) return null;
        const firstNormalized = this.normalizeAdjacencyText(first);
        if (!firstNormalized) return null;
        const barNormalized = this.normalizeAdjacencyText(event && event.bar);
        if (barNormalized
            && (firstNormalized.includes(barNormalized) || barNormalized.includes(firstNormalized))) return null;
        if (this.core && typeof this.core.looksLikeStreetAddress === 'function'
            && this.core.looksLikeStreetAddress(first)) return null;
        return { line, place: first };
    }

    // Deterministic location-line cross-check (run 20260723-123149: the page
    // segment plainly said "@ MAD.BEAR Beach" / "Torremolinos, Spain" while
    // flyer branding produced city "new york"). Looks for an explicit
    // "<Place>, <Place>" line within ±2 lines of the venue/address occurrence
    // in the evidence corpus:
    //   - the first such line resolving to a configured city that DIFFERS from
    //     the extracted city → override + _citySource 'page-adjacent';
    //   - a line that does NOT resolve and shares no tokens with the extracted
    //     city → clear the city (unknown routes to chunky-dad-unknown, the
    //     safe path) — never guess;
    //   - no adjacent location line, or the line matches the extracted city →
    //     untouched (fail open, no stamp, no log).
    // droppedCityValue lets a city the evidence gate already dropped (weaker
    // evidence) still anchor the comparison, so the page's own location line
    // can restore the correct city.
    crossCheckCityAgainstAdjacentLocation(event, evidenceContext, cityConfig, droppedCityValue = '') {
        if (!event || typeof event !== 'object') return event;
        const liveCity = typeof event.city === 'string' ? event.city.trim() : '';
        const extractedCity = liveCity || String(droppedCityValue || '').trim();
        if (!extractedCity) return event;
        const corpus = evidenceContext && typeof evidenceContext.raw === 'string' ? evidenceContext.raw : '';
        if (!corpus) return event;
        const anchors = [
            event.bar,
            this.getAddressStreetLine(event.address) || event.address
        ]
            .map(value => this.normalizeAdjacencyText(value))
            .filter(anchor => anchor && anchor.length >= 3);
        if (anchors.length === 0) return event;
        const rawLines = corpus.split('\n');
        const normalizedLines = rawLines.map(line => this.normalizeAdjacencyText(line));
        const windowIndexes = new Set();
        normalizedLines.forEach((line, index) => {
            if (!line || !anchors.some(anchor => line.includes(anchor))) return;
            for (let delta = -2; delta <= 2; delta += 1) {
                const candidate = index + delta;
                if (candidate >= 0 && candidate < rawLines.length) windowIndexes.add(candidate);
            }
        });
        let pair = null;
        for (const index of Array.from(windowIndexes).sort((a, b) => a - b)) {
            pair = this.extractAdjacentLocationPlacePair(rawLines[index], event);
            if (pair) break;
        }
        if (!pair) return event;
        const extractedEntry = this.findCityConfigEntry(extractedCity, cityConfig);
        const extractedKey = extractedEntry ? extractedEntry.key : extractedCity.toLowerCase();
        const resolvedKey = this.findCityKeyInText(pair.place, cityConfig);
        if (resolvedKey) {
            if (resolvedKey === extractedKey) return event; // page agrees — nothing to do
            event.city = resolvedKey;
            event._citySource = 'page-adjacent';
            console.log(`🤖 AI Web: City corrected to "${resolvedKey}" from location line "${pair.line}" (extracted "${extractedCity}" came from weaker evidence)`);
            return event;
        }
        // Unresolvable place (not a configured city): if the line still names
        // the extracted city (any alias), the page corroborates it — keep. If
        // it names somewhere else entirely, never guess: clear the city.
        const normalizedLine = this.normalizeEvidenceText(pair.line);
        const lineMatchesExtracted = extractedEntry
            ? extractedEntry.aliases.some(alias => alias.length >= 3 && this.textContainsCityAlias(normalizedLine, alias))
            : this.textContainsCityAlias(normalizedLine, extractedCity);
        if (lineMatchesExtracted) return event;
        if (liveCity) delete event.city;
        console.log(`🤖 AI Web: Extracted city "${extractedCity}" contradicts adjacent location line "${pair.line}" — city cleared, event will need manual review`);
        return event;
    }

    // A bare city name is not an event name. True when the title — after
    // stripping emoji, collapsing whitespace, and case-folding — exactly equals
    // any configured name of the event's resolved city (key, display name,
    // patterns, aliases; dashes/underscores in a candidate read as spaces).
    // Whole-title match only: "Hot Take Portland" is a real event name.
    // Missing/unknown cities are never city-only. Mirrors
    // SharedCore.isCityOnlyTitle, which drives the deterministic merge rule.
    isCityOnlyTitle(title, cityValue, cityConfig) {
        if (!title || !cityValue) return false;
        const entry = this.findCityConfigEntry(cityValue, cityConfig);
        if (!entry) return false;
        const normalizedTitle = this.stripEmojiFromTitle(title).toLowerCase();
        if (!normalizedTitle) return false;
        return entry.aliases.some(alias => {
            const collapsed = this.normalizeWhitespace(alias).toLowerCase();
            return collapsed === normalizedTitle
                || collapsed.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() === normalizedTitle;
        });
    }

    // Word-level brand containment (matchesPageBrandName is whole-value
    // equality only): "Bearracuda Atlanta 17 Year Anniversary" CONTAINS the
    // "Bearracuda" brand and must never be organizer-prefixed again.
    titleContainsPageBrandName(title, brandNames) {
        const normalizedTitle = String(title || '')
            .toLowerCase()
            .replace(/[^a-z0-9&\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!normalizedTitle) return false;
        const paddedTitle = ` ${normalizedTitle} `;
        return (Array.isArray(brandNames) ? brandNames : []).some(brand => {
            for (const variant of this.getBrandNameVariants(brand)) {
                if (paddedTitle.includes(` ${variant} `)) return true;
            }
            return false;
        });
    }

    // A bare city is not an event name: bearracuda.com names its event pages
    // after the city (og:title "New Orleans⚜️ | BEARRACUDA" → brand strip
    // leaves "New Orleans⚜️"). When the extracted title is exactly the event's
    // resolved city and the page declares a known organizer, return
    // "<ORGANIZER>: <city title>" so the calendar title names the party; ''
    // when the rule doesn't apply. Everything is derived from page metadata +
    // the cities config — no per-site rules.
    // - organizerDisplay: og:site_name (how the site displays its own brand,
    //   e.g. "BEARRACUDA") when present, else the primary extracted brand name
    //   (the same value the _organizer stamp uses).
    // - baseTitle: models often strip emoji ("New Orleans" from og:title
    //   "New Orleans⚜️ | BEARRACUDA"), so when the brand-stripped og:title is
    //   an emoji-richer variant of the title (equal after emoji-strip +
    //   case-fold), the og:title variant is used to preserve the emoji.
    buildOrganizerPrefixedTitle(title, cityValue, pageBrandNames, htmlData, cityConfig) {
        if (!title || !cityValue) return '';
        if (!Array.isArray(pageBrandNames) || pageBrandNames.length === 0) return '';
        if (!this.isCityOnlyTitle(title, cityValue, cityConfig)) return '';
        if (this.titleContainsPageBrandName(title, pageBrandNames)) return '';
        const ogSiteName = this.getPageOgSiteName(htmlData);
        const organizerDisplay = ogSiteName && this.matchesPageBrandName(ogSiteName, pageBrandNames)
            ? ogSiteName
            : pageBrandNames[0];
        let baseTitle = title;
        const ogTitle = this.getPageOgTitle(htmlData);
        if (ogTitle) {
            const ogStripped = this.stripPageBrandFromTitle(ogTitle, pageBrandNames);
            const ogWithoutEmoji = this.stripEmojiFromTitle(ogStripped);
            if (ogStripped !== ogWithoutEmoji
                && ogWithoutEmoji.toLowerCase() === this.stripEmojiFromTitle(title).toLowerCase()) {
                baseTitle = ogStripped;
            }
        }
        return `${organizerDisplay}: ${baseTitle}`;
    }

    // Split a combined OCR+page stream into ordered corpus chunks so the
    // dedup in extractBodyParts can scope itself per corpus. OCR snippets
    // (buildOcrSnippet) are machine-embedded into the stream: prepended
    // ahead of the page text (extractSingleEvent) and inside segment
    // resource lines (extractMultiEventSegmentResourceLines). An OCR region
    // starts at an OCR_IMAGE_URL:/OCR_IMAGE_TEXT marker line and ends at
    // the next SEGMENT_* marker line or the first line that contains an
    // HTML tag — both boundaries are machine-emitted, so detection is
    // reliable. A plain-text page tail directly after an OCR block with no
    // marker between them is indistinguishable and stays in the OCR region
    // (same corpus-sharing behavior as before this split — never worse).
    // Inputs without OCR markers return one page chunk, byte-identical to
    // the un-split processing.
    splitOcrAndPageChunks(text) {
        const source = String(text);
        if (!/^OCR_IMAGE_(?:URL:|TEXT)/m.test(source)) {
            return [{ corpus: 'page', text: source }];
        }
        const chunks = [];
        let currentCorpus = 'page';
        let currentLines = [];
        const push = () => {
            if (currentLines.length > 0) {
                chunks.push({ corpus: currentCorpus, text: currentLines.join('\n') });
                currentLines = [];
            }
        };
        for (const line of source.split('\n')) {
            let corpus = currentCorpus;
            if (/^OCR_IMAGE_(?:URL:|TEXT)/.test(line)) {
                corpus = 'ocr';
            } else if (currentCorpus === 'ocr') {
                if (/^SEGMENT_[A-Z_]+/.test(line) || /<[a-zA-Z!/]/.test(line)) {
                    corpus = 'page';
                }
            }
            if (corpus !== currentCorpus) {
                push();
                currentCorpus = corpus;
            }
            currentLines.push(line);
        }
        push();
        return chunks;
    }

    extractBodyParts(html) {
        // Dedup is scoped PER CORPUS (OCR vs page): flyer OCR text is
        // prepended ahead of the page text, so a single shared seen-set let
        // OCR lines evict the page's own lines — run 20260724-122902 lost
        // the page lines "Legacy" / "Bear Week Return" to the flyer's
        // "LEGACY" / "BEAR WEEK RETURN" and the model never saw the venue
        // in page context. OCR lines dedup only against OCR lines, page
        // lines only against page lines; intra-corpus duplicates (repeated
        // boilerplate, the segment's embedded second OCR copy) still
        // collapse, and the maxBodyParts cap stays global.
        const seenByCorpus = { ocr: new Set(), page: new Set() };
        const results = [];
        for (const chunk of this.splitOcrAndPageChunks(String(html))) {
            const seen = seenByCorpus[chunk.corpus];
            let text = chunk.text;
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

            for (const line of lines) {
                const lower = line.toLowerCase();
                if (line.length < 3) continue;
                if (this.noiseLineRegex.test(line)) continue;
                if (this.looksLikeCssContent(line)) continue;
                if (seen.has(lower)) continue;
                seen.add(lower);
                results.push(line);
                if (results.length >= this.extractionLimits.maxBodyParts) return results;
            }
        }
        return results;
    }

    extractBodyPartRecords(html) {
        const source = String(html || '');
        if (!source) return [];

        const bodyOpen = /<body\b[^>]*>/i.exec(source);
        const bodyClose = /<\/body\s*>/i.exec(source);
        const scanStart = bodyOpen ? bodyOpen.index + bodyOpen[0].length : 0;
        const scanEnd = bodyClose ? bodyClose.index : source.length;
        if (scanEnd <= scanStart) return [];

        const skipRanges = [
            ...this.collectHtmlRanges(source, /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi),
            ...this.collectHtmlRanges(source, /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi),
            ...this.collectHtmlRanges(source, /<!--[\s\S]*?-->/g),
            ...this.collectHtmlRanges(source, /<(nav|header|footer|aside|noscript|form|button)\b[^>]*>[\s\S]*?<\/\1\s*>/gi),
            ...this.collectHtmlRanges(source, /<[a-z0-9]+\b[^>]*(?:class|id)=["'][^"']*(nav|menu|footer|header|share|social|recommend|carousel|cta|newsletter|breadcrumb)[^"']*["'][^>]*>[\s\S]{0,12000}?<\/[a-z0-9]+>/gi)
        ].sort((a, b) => a[0] - b[0]);

        const records = [];
        const seen = new Set();
        const tagPattern = /<[^>]+>/g;
        let lastIndex = scanStart;
        let blockStart = scanStart;
        let pendingText = '';

        const flush = (rawEnd) => {
            const rawLines = this.decodeBasicEntities(pendingText)
                .split('\n')
                .map(line => this.normalizeWhitespace(line))
                .filter(Boolean);
            pendingText = '';
            for (const line of rawLines) {
                if (!line || line.length < 3) continue;
                if (this.noiseLineRegex.test(line)) continue;
                if (this.looksLikeCssContent(line)) continue;
                const dedupeKey = line.toLowerCase();
                if (seen.has(dedupeKey)) continue;
                seen.add(dedupeKey);
                records.push({
                    text: line,
                    rawStart: blockStart,
                    rawEnd
                });
            }
        };

        tagPattern.lastIndex = scanStart;
        let match;
        while ((match = tagPattern.exec(source)) !== null && match.index < scanEnd) {
            const textStart = lastIndex;
            const textEnd = match.index;
            if (
                textEnd > textStart &&
                !this.isPositionInRanges(textStart, skipRanges) &&
                !this.isPositionInRanges(textEnd - 1, skipRanges)
            ) {
                const text = source.slice(textStart, textEnd);
                if (text.trim()) pendingText += text;
            }

            const tag = match[0];
            const isLineBreak = /<(?:br|\/p|\/div|\/li|\/section|\/article|\/h[1-6]|\/tr|\/td)\b[^>]*>/i.test(tag);
            if (isLineBreak) {
                if (pendingText.trim()) {
                    flush(match.index + tag.length);
                }
                blockStart = match.index + tag.length;
            }
            lastIndex = tagPattern.lastIndex;
        }

        if (
            lastIndex < scanEnd &&
            !this.isPositionInRanges(lastIndex, skipRanges) &&
            !this.isPositionInRanges(scanEnd - 1, skipRanges)
        ) {
            const text = source.slice(lastIndex, scanEnd);
            if (text.trim()) pendingText += text;
        }
        if (pendingText.trim()) {
            flush(scanEnd);
        }

        return records;
    }

    collectHtmlRanges(source, pattern) {
        const ranges = [];
        let match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(source)) !== null) {
            ranges.push([match.index, pattern.lastIndex]);
            if (match.index === pattern.lastIndex) pattern.lastIndex++;
        }
        return ranges;
    }

    isPositionInRanges(position, ranges) {
        if (!Array.isArray(ranges) || ranges.length === 0) return false;
        let low = 0;
        let high = ranges.length - 1;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const range = ranges[mid];
            if (position < range[0]) {
                high = mid - 1;
            } else if (position >= range[1]) {
                low = mid + 1;
            } else {
                return true;
            }
        }
        return false;
    }

    looksLikeCssContent(line) {
        if (!line.includes(':')) return false;
        this.cssContentLineRegex.lastIndex = 0;
        let hits = 0;
        while (this.cssContentLineRegex.exec(line) !== null) {
            hits++;
            if (hits >= 3) return true;
        }
        return false;
    }

    // Single decoding layer for page text (prompt sections, segment lines, meta
    // content) AND the evidence corpus — both derive from extractBodyParts /
    // getPromptSectionBundle, so extending the decode here keeps the verbatim
    // evidence gate symmetric: values the model copies from the decoded prompt
    // match the identically-decoded corpus. Numeric references (&#8217;/&#x2019;)
    // and the common named typographic entities are covered so titles like
    // "It&#8217;s PET NIGHT at the Dallas Eagle!" (run 20260724-155934) no
    // longer ship with raw entities. &amp; deliberately stays encoded here
    // (URL-candidate scanning depends on it; normalizeUrl decodes it exactly
    // once), so its numeric forms (&#38;/&#x26;) are skipped too.
    decodeBasicEntities(text) {
        return String(text || '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&apos;/gi, "'")
            .replace(/&lsquo;/gi, '‘')
            .replace(/&rsquo;/gi, '’')
            .replace(/&ldquo;/gi, '“')
            .replace(/&rdquo;/gi, '”')
            .replace(/&ndash;/gi, '–')
            .replace(/&mdash;/gi, '—')
            .replace(/&hellip;/gi, '…')
            .replace(/&#(\d{1,7});/g, (entity, dec) => this.decodeNumericEntity(Number(dec), entity))
            .replace(/&#x([0-9a-f]{1,6});/gi, (entity, hex) => this.decodeNumericEntity(parseInt(hex, 16), entity));
    }

    // Numeric character reference → character, decoded at most once. Invalid
    // code points, surrogates, and the ampersand itself (38/0x26 — kept
    // encoded, same as &amp;) fall back to the original entity text.
    decodeNumericEntity(code, fallback) {
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return fallback;
        if (code === 38) return fallback;
        if (code >= 0xd800 && code <= 0xdfff) return fallback;
        try {
            return String.fromCodePoint(code);
        } catch (_) {
            return fallback;
        }
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
            return this.simplifyUrlValue(normalizedValue, { stripQuery: false });
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
                return this.simplifyUrlValue(normalized, { stripQuery: false });
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

    isGoogleMapsUrl(parsedUrl) {
        if (!parsedUrl) return false;
        const host = String(parsedUrl.hostname || '').toLowerCase();
        const path = String(parsedUrl.pathname || '').toLowerCase();
        const isMapsGoogleHost = host === 'maps.google.com' || host.endsWith('.maps.google.com');
        const isMapsAppHost = host === 'maps.app.goo.gl' || host.endsWith('.maps.app.goo.gl');
        const isGoogleMapsPath = (host === 'google.com' || host.endsWith('.google.com')) && path.startsWith('/maps');
        return isMapsGoogleHost || isMapsAppHost || isGoogleMapsPath;
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
            const isInstagram = host === 'instagram.com' || host.endsWith('.instagram.com');
            const isFacebook = host === 'facebook.com' || host.endsWith('.facebook.com');
            const isGoogleMaps = this.isGoogleMapsUrl(parsedUrl);
            if (!instagram && isInstagram) instagram = normalized;
            if (!facebook && isFacebook) facebook = normalized;
            if (!gmaps && isGoogleMaps) gmaps = normalized;
            if (instagram && facebook && gmaps) break;
        }

        return { instagram, facebook, gmaps };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AiWebParser, normalizeCityValue, normalizeStartTimeValue, combineDateAndTime };
} else if (typeof window !== 'undefined') {
    window.AiWebParser = AiWebParser;
    window.normalizeCityValue = normalizeCityValue;
    window.normalizeStartTimeValue = normalizeStartTimeValue;
    window.combineDateAndTime = combineDateAndTime;
} else {
    this.AiWebParser = AiWebParser;
    this.normalizeCityValue = normalizeCityValue;
    this.normalizeStartTimeValue = normalizeStartTimeValue;
    this.combineDateAndTime = combineDateAndTime;
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

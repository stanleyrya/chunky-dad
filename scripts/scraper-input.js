// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: purple; icon-glyph: magic;
// Bear Event Scraper Configuration
// This file contains the runtime configuration for the bear event scraper system.
//
// USAGE RESTRICTIONS:
// - This is a pure JavaScript configuration file
// - Must export a default configuration object
// - Can be imported in both Scriptable and web environments
// - Keep this file environment-agnostic (no Scriptable or DOM APIs)

const scraperConfig = {
  config: {
    daysToLookAhead: null,
    // dryRun: true, // Preview mode: analyze + display without writing to the calendar (default: false)
    pickParsers: true, // Parser picker at run start (manual runs only; automation/widget runs skip it; selection is session-scoped — never edits this file) (default: false)
    pageCache: {
      enabled: true,
      ttlDays: 3,
    },
    // deadEndRetryDays: 30, // Learned dead-end URLs (fetched fine but yielded nothing) are skipped for this many days, then retried once; 0 disables the store (default: 30)
    geocodeVerification: { mode: "enforce" }, // verify geocoded pins: grade-gate + Apple reverse cross-check. "report" (default) flags suspects in logs, "enforce" refuses suspect pins, "off" skips extra checks. Generic city-level pins are always refused.
    promoterRegistry: { mode: "report" }, // Curated promoter identity matching — see data/promoters.json; "enforce" stamps matched metadata + bearAffinity
    // NOTE: Eventbrite /e/ confidence defaults (JSON-LD cover/image/ticketUrl,
    // meta location) are built into shared-core now — an aiConfidenceDefaults
    // block here is only needed to extend or override them.
    // Global AI extraction defaults — inherited by EVERY parser (extraction +
    // merge arbitration). The effective per-parser block is a deep merge of this
    // block with the parser's own `ai`, so per-parser keys override key-wise.
    // Keys mirror what SharedCore.resolveAiConfig reads.
    ai: {
      enabled: true,
      endpoint: "http://rybook.taila7523c.ts.net:8000/v1/chat/completions",
      provider: "openai",
      openai: {
        responseFormat: "json_object",
      },
      model: "lmstudio-community/Qwen3-Coder-Next-MLX-6bit",
      payloadMode: "best",
      maxHtmlChars: 6000,
      numCtx: 2048,
      numPredict: 2000,
      temperature: 0,
      think: false,
      timeoutSeconds: 120,
      keepAlive: "5m",
      cache: true, // AI response cache — key is model+prompt+options; set false to disable
      // AI merge arbitration (default: true). When two records of the same event
      // genuinely conflict on a field (both non-empty, different), the AI picks the
      // better value — accepted only when its answer is a VERBATIM copy of one of
      // the candidates; anything else falls back to the deterministic strategy
      // (scraped clobbers). This global block also serves events from non-AI
      // parsers; per-parser ai.arbitrateMerges overrides. Set false to disable.
      arbitrateMerges: true,
      bearCheck: { mode: "enforce" }, // Bear-check cascade: keywords → AI verdict with promoter context. "report" logs decisions without changing behavior; "enforce" flags/rescues/drops; "off" = legacy alwaysBear/keyword behavior. (Also accepted as a top-level config.bearCheck, like geocodeVerification; canonical location is here under ai.)
      // Overlong-field trim pipeline: one AI call per event batches every
      // overlong scraped field (title/description/shortName); answers are
      // accepted only as VERBATIM contiguous substrings of the original.
      // "report" logs would-trim decisions without changing values;
      // "enforce" replaces; "off" disables. Calendar-sourced values are never
      // AI-trimmed — they are only flagged in the event evidence panel.
      // Enforce since battery run 20260728: every proposal was clean and the
      // verbatim gate correctly rejected non-substring description trims.
      trim: {
        mode: "enforce", // "report" | "enforce" | "off"
        titleMaxChars: 60, // data: title p95=48, p99=72, max=74
        descriptionMaxChars: 600, // data: description p95=491, max=846
        shortNameMaxChars: 30, // data: shortName max=20
      },
      // extraContext (override-only): free-form text appended VERBATIM to the
      // context of every AI extraction prompt. Organizer/brand context is
      // normally derived automatically from each page's own metadata (JSON-LD
      // Organization/WebSite nodes and og:site_name) — set this only when a
      // page's markup declares nothing useful and the model needs a hint.
      // Per-parser ai.extraContext overrides this global value ("" opts out).
      // Default: "" (no extra context).
      // extraContext: "",
      // Full AI prompt/response payloads normally go to the debug channel only:
      // captured into the run log file (logs/<runId>.log) but hidden from the
      // visible console. Set true to also mirror them to the live console while
      // actively debugging. Default: false.
      verboseConsoleLogs: false,
    },
    // Global OCR defaults — inherited by EVERY parser the same way as `ai`
    // (a parser's own `ai.ocr` — or top-level `ocr` — block overrides key-wise).
    // rapid-mlx (OpenAI-compatible, Apple Silicon) serving a VISION model on its
    // own port, alongside the text/extraction server on :8000.
    ocr: {
      enabled: true,
      provider: "openai",
      endpoint: "http://rybook.taila7523c.ts.net:8001/v1/chat/completions",
      model: "mlx-community/Qwen3-VL-4B-Instruct-4bit", // OCR requires a VISION model
      timeoutSeconds: 120,
      numCtx: 8192,
      numPredict: 2000,
      temperature: 0,
      think: false,
      keepAlive: "5m",
      maxImages: 2, // Per-page OCR budget on single-event pages (multi-event pages use 10 + segment top-up)
      concurrency: 1, // Concurrent OCR requests; keep 1 for a single local GPU
      maxTextChars: 4000,
      cache: true, // OCR result cache (key is `cache`, not `cacheEnabled`)
      // End-of-run auto-prune: cached OCR results unused for this many days
      // are deleted (cache hits refresh an entry's last-use marker, so
      // recurring flyers are kept indefinitely). Default: 90.
      cacheRetentionDays: 90,
      requireMissingFields: true,
    },
    // NOTE: Generic junk URLs (/shop, /cart, /contact, /_api/, ?p=<digits>
    // shortlinks, /privacy, /terms, ...) are blocked built-in now, and pages
    // that fetch fine but yield nothing are learned as dead ends and skipped
    // automatically. A discoveryBlockedPatterns list (global here, or
    // per-parser) is only for deliberate exclusions — "never fetch, not even
    // once". String entries are case-insensitive URL substrings; RegExp
    // entries test against the lowercased URL, which allows anchoring.
    // URL pattern rules for page classification. Checked in order — first match wins.
    // More specific patterns (e.g. /events/:slug) must come before broader ones (e.g. domain root).
    // Built-in platform rules apply automatically BENEATH these (config wins):
    // eventbrite.com/e/ → event-page, eventbrite.com/o/ → multi-event-page,
    // linktr.ee → link-aggregator. Only site-specific rules belong here.
    pageClassificationRules: [
      { pattern: /furball\.nyc/i, classification: "multi-event-page" },
      {
        pattern: /bearracuda\.com\/events\/[^/?&#\s]+/i,
        classification: "event-page",
      },
      { pattern: /bearracuda\.com/i, classification: "link-aggregator" },
      {
        pattern: /thebearcalendar\.com\/events\/[^/?&#\s]+/i,
        classification: "event-page",
      },
      // The listing host is a link hub, never a venue site.
      { pattern: /thebearcalendar\.com/i, classification: "link-aggregator" },
    ],
  },
  parsers: [
    {
      name: "Megawoof America",
      enabled: false,
      urls: ["https://www.eventbrite.com/o/megawoof-america-18118978189"],
      alwaysBear: true,
      metadata: {
        shortName: { value: "MEGA-WOOF" },
        instagram: { value: "https://www.instagram.com/megawoof_america" },
        url: { value: "https://linktr.ee/megawoof_america" },
      },
    },
    {
      name: "Coach After Dark",
      enabled: false,
      urls: ["https://www.eventbrite.com/o/bear-happy-hour-87043830313"],
      alwaysBear: true,
      metadata: {
        shortName: {
          value: "COACH",
          conditionalValues: [{ keywords: ["beefwitch"], value: "BEEFWITCH" }],
        },
        instagram: {
          value: "https://www.instagram.com/coachafterdark",
          conditionalValues: [
            { keywords: ["beefwitch"], value: "https://www.instagram.com/thebeefwitch" },
          ],
        },
      },
    },
    {
      name: "Bearracuda Events",
      enabled: false,
      urls: [
        "https://bearracuda.com/",
        "https://www.eventbrite.com/o/bearracuda-21867032189",
      ],
      // NOT alwaysBear: Bearracuda also throws non-bear events (e.g. HOT TAKE) —
      // enforce-mode bear check judges each event with promoter context instead.
      alwaysBear: false,
      metadata: {
        shortName: {
          value: "Bear-rac-uda",
          conditionalValues: [
            { keywords: ["hot take"], value: "HOT TAKE" },
            { keywords: ["treasure trail"], value: "TREAS-URE TRAIL" },
          ],
        },
        instagram: { value: "https://www.instagram.com/bearracuda" },
        url: { value: "https://bearracuda.com/" },
      },
    },
    {
      name: "CHUNK",
      enabled: false,
      urls: ["https://www.chunk-party.com"],
      // Deliberate exclusions only — /shop, /contact, /_api/ are blocked built-in
      discoveryBlockedPatterns: [
        "chunk-party.com/chunkbearandcubsocial",
        "chunk-party.com/chunk",
      ],
      alwaysBear: true,
      metadata: {
        shortName: { value: "CHUNK" },
        instagram: { value: "https://www.instagram.com/chunkparty" },
        website: { value: "https://www.chunk-party.com" },
      },
    },
    {
      name: "Furball",
      enabled: false,
      urls: ["https://www.furball.nyc"],
      alwaysBear: true,
      urlDiscoveryDepth: 0,
      metadata: {
        shortName: { value: "FUR-BALL" },
        instagram: { value: "https://instagram.com/furballnyc/" },
        url: { value: "https://www.furball.nyc" },
        favicon: { value: "https://linktr.ee/furballnyc" },
      },
    },
    {
      name: "Cubhouse",
      enabled: false,
      urls: ["https://linktr.ee/cubhouse"],
      discoveryBlockedPatterns: ["www.eventbrite.com/o/", "linktr.ee"],
      alwaysBear: true,
      metadata: {
        shortName: { value: "CUB-HOUSE" },
        instagram: { value: "https://www.instagram.com/cubhouse.philly" },
        url: { value: "https://linktr.ee/cubhouse" },
      },
    },
    {
      name: "Goldiloxx",
      enabled: false,
      // Homeless promoter — events scatter across ticketing platforms (links
      // rotate in their Instagram bio). Stable doors: the RedEye JSON API
      // search (self-refreshing; JSON-API pathway extracts it structurally)
      // and Sickening's all-platform listing filtered to goldiloxx links.
      urls: [
        "https://api.redeyetickets.com/api/v1/events/search?q=goldiloxx&per_page=25",
        "https://sickening.events/events",
      ],
      // Only follow discovered links naming the promoter — the listing has
      // ~900 events. Note: sickening JSON-LD "organizer" is the VENUE, and
      // the site soft-404s (every URL returns 200 with an empty shell).
      discoveryAllowedPatterns: ["goldiloxx"],
      alwaysBear: true,
      calendarSearchRangeDays: 40, // Look +/- days for wildcard key matches
      metadata: {
        shortName: { value: "GOLDI-LOXX" },
        shorterName: { value: "GLX" },
        instagram: { value: "https://www.instagram.com/goldiloxx__" },
        matchKey: { value: "goldiloxx*|${year}-${month}-*|*" },
      },
    },
    {
      name: "3 Dollar Bill",
      enabled: false,
      // Brooklyn queer venue (260 Meserole St; second space The Yard @ 270
      // Meserole Ave — per-event JSON-LD location is authoritative).
      // Squarespace, server-rendered listing, JSON-LD Event on event pages.
      // Heavy queer programming, bear events (Bear Tea) are a subset —
      // bear check filters, not alwaysBear.
      urls: ["https://www.3dollarbillbk.com/rsvp"],
      alwaysBear: false,
      metadata: {
        website: { value: "https://www.3dollarbillbk.com" },
        instagram: { value: "https://www.instagram.com/3dollarbillbk" },
      },
    },
    {
      name: "Twisted Bear",
      enabled: false,
      // discoveryOnly: true,
      urls: [
        "https://www.eventbrite.com/o/nab-events-llc-51471535173",
        "https://www.eventbrite.com/o/121474797695",
      ],
      alwaysBear: true,
      metadata: {
        shortName: { value: "TWIST-ED BEAR" },
        instagram: { value: "https://www.instagram.com/twistedbearparty" },
        facebook: { value: "https://www.facebook.com/twistedglobal/" },
      },
    },
    {
      name: "Dallas Eagle",
      enabled: false,
      urls: ["https://www.eventbrite.com/o/77139864473"],
      metadata: {
        website: { value: "https://www.thedallaseagle.com" },
        facebook: { value: "https://www.facebook.com/lonestareagle" },
        instagram: { value: "https://www.instagram.com/thedallaseagle/" },
        mastodon: { value: "https://mastodon.social/@dallaseagle" },
      },
    },
    { name: "massive.club", enabled: true, urls: ["https://www.massive.club"], alwaysBear: false },
    // ── Onboarding batch 2026-07-27 (recon-verified) — each ships disabled;
    // run one at a time via the parser picker, review, then enable. ──────
    {
      name: "The Lumberyard",
      enabled: false,
      urls: ["https://www.thelumberyardbar.com/events"],
      // Seattle bear-friendly bar (9630 16th Ave SW) with general weekly
      // programming — bear check filters, not alwaysBear.
      alwaysBear: false,
      metadata: {
        website: { value: "https://www.thelumberyardbar.com" },
      },
    },
    {
      name: "CubScout LA",
      enabled: false,
      // Eagle LA's recurring bear party page (The Events Calendar, JSON-LD).
      urls: ["https://eaglela.com/events/cub-scout-3/"],
      alwaysBear: true,
    },
    {
      name: "BEEFMINCE",
      enabled: false,
      // Multi-city UK (London/Brighton/Manchester/Birmingham + Sitges);
      // per-event city comes from event text; tickets link out to dice.fm.
      urls: ["https://beefmince.com/events"],
      alwaysBear: true,
      metadata: {
        website: { value: "https://beefmince.com" },
      },
    },
    {
      name: "BeefDip",
      enabled: false,
      // Puerto Vallarta bear week; single schedule page, venues appear as
      // Google Maps links (maps-link address harvesting applies).
      urls: ["https://beefdip.com/planned-events/"],
      alwaysBear: true,
      metadata: {
        website: { value: "https://beefdip.com" },
      },
    },
    {
      name: "Bear it MTL",
      enabled: false,
      // Montreal (Sugar Bear Weekend organizer); The Events Calendar with
      // JSON-LD + Offers; also lists Toronto/Paris events — city per event.
      urls: ["https://www.bearitmtl.com/events/"],
      alwaysBear: true,
      metadata: {
        website: { value: "https://www.bearitmtl.com" },
      },
    },
    {
      name: "Club Chub",
      enabled: false,
      // Touring chub/chaser series; Eventbrite links sit in the site's own
      // static HTML. Do NOT use the Eventbrite org page — it's CCBC Resort's
      // venue account and would pull non-Club-Chub events.
      urls: ["https://www.clubchubusa.com/event-list"],
      alwaysBear: true,
      metadata: {
        instagram: { value: "https://www.instagram.com/clubchubparty" },
      },
    },
    {
      name: "The Bear Calendar",
      enabled: false,
      automationEnabled: false,
      // Aggregator (Astro, server-rendered; ~52 events). Per-event pages carry
      // complete JSON-LD; offers.url IS the original ticketing/promoter URL.
      // First-run verification: Megawoof/Twisted Bear dupes must dedup via
      // ticket-url identity; websites must be original URLs, never this host.
      urls: ["https://thebearcalendar.com/events/"],
      alwaysBear: true,
      urlDiscoveryDepth: 1,
      maxAdditionalUrls: 60,
    },
    {
      // ── New Site Template ─────────────────────────────────────────────
      // Copy this entry, fill in the live fields, and you're done — depth,
      // URL blocking, AI/OCR settings, and field merging are all automatic.
      // Tip: run once with discoveryOnly: true and the scraper prints a
      // 📋 SUGGESTED CONFIG block (with harvested instagram/facebook/website)
      // you can paste right back here.
      name: "New Site Template",
      enabled: false, // flip on after a dry-run preview looks right
      urls: ["https://example.com/events"],
      alwaysBear: false, // set true for trusted bear promoters (AI trust context)
      metadata: {
        shortName: { value: "NEW-SITE" }, // add a hyphen where it should line-break
        instagram: { value: "https://www.instagram.com/example" },
      },
      // ── Optional fields — exhaustive reference (defaults noted) ────────
      //
      // Crawl & discovery:
      // discoveryOnly: true, // First-run mapping: crawl + print/save the 📋 SUGGESTED CONFIG block, extract no events (default: false)
      // urlDiscoveryDepth: 2, // Omit → adaptive crawling (each page's type decides what gets followed); set a number to pin exact depth, 0 = never crawl (default: adaptive)
      // maxAdditionalUrls: 15, // Budget of discovered URLs followed per page (default: 15)
      // discoveryBlockedPatterns: ["example.com/members-only"], // Deliberate exclusions only — generic junk is blocked built-in and dead ends are learned + auto-retried (default: none)
      // discoveryAllowedPatterns: ["promoter-name"], // When set, ONLY follow discovered links matching an entry (string substring or RegExp) — for promoter searches on big platform listings; start URLs unaffected; blocks win over allows (default: none)
      // discoveryBlockedHosts: ["example.com"], // Suppress ALL discovered links to these hostnames (default: none)
      //
      // Extraction steering:
      // siteRole: "venue", // "venue" | "organizer" — who this SITE is (top precedence over page-derived detection). "venue": events on the page happen AT this venue — its own name may be returned as bar, and the KNOWN VENUE extraction context is injected. "organizer": promoter/brand site — the site name is never the bar. Omit → derived from page facts (JSON-LD types, observed addresses); undetermined changes nothing.
      //
      // Run behavior:
      // dryRun: true, // Preview this parser's events without writing to the calendar (default: false — global config.dryRun also applies)
      // automationEnabled: false, // Skip this parser in scheduled automation runs (default: true)
      // daysToLookAhead: 90, // Only keep events starting within N days (default: global config.daysToLookAhead, null = no limit)
      // allowPastEvents: true, // Keep events whose start date already passed (default: false)
      // calendarSearchRangeDays: 40, // ± days searched for wildcard matchKey calendar matches (default: unset)
      //
      // AI extraction override — merged key-wise over the global `ai` block.
      // Normally omit entirely: the built-in default is the local rybook text
      // server. Shown exhaustively for reference:
      // ai: {
      //   enabled: true,
      //   provider: "openai", // "openai" (OpenAI-compatible, e.g. rapid-mlx/LM Studio/hosted) or "ollama"
      //   endpoint: "http://rybook.taila7523c.ts.net:8000/v1/chat/completions",
      //   model: "lmstudio-community/Qwen3-Coder-Next-MLX-6bit",
      //   // Hosted OpenAI variant:
      //   // provider: "openai", endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-4o", openai: { responseFormat: "json_object" },
      //   // Ollama variant:
      //   // provider: "ollama", endpoint: "http://desktop.taila7523c.ts.net:11434/api/generate", model: "qwen3.5:4b",
      //   payloadMode: "best", // "best" | "html" | "text" — what gets sent to the model
      //   maxHtmlChars: 6000,
      //   numCtx: 2048,
      //   numPredict: 2000,
      //   temperature: 0,
      //   think: false,
      //   timeoutSeconds: 120,
      //   keepAlive: "5m",
      //   cache: true, // AI response cache — key is model+prompt+options; set false to disable
      //   classifyPages: true, // AI second opinion when URL rules/JSON-LD can't classify a page (default: true)
      //   // OCR override lives INSIDE `ai` (canonical spot: ai.ocr). Default is
      //   // the rybook VISION server on :8001 — text models reject images.
      //   ocr: {
      //     enabled: true,
      //     provider: "openai",
      //     endpoint: "http://rybook.taila7523c.ts.net:8001/v1/chat/completions",
      //     model: "mlx-community/Qwen3-VL-4B-Instruct-4bit", // OCR requires a VISION model
      //     // Ollama vision variant:
      //     // provider: "ollama", endpoint: "http://desktop.taila7523c.ts.net:11434/api/generate", model: "qwen3-vl:4b-instruct",
      //     timeoutSeconds: 120,
      //     numCtx: 8192,
      //     numPredict: 2000,
      //     temperature: 0,
      //     think: false,
      //     keepAlive: "5m",
      //     maxImages: 2, // Per-page OCR budget on single-event pages (multi-event pages use 10 + segment top-up)
      //     concurrency: 1, // Concurrent OCR requests; keep 1 for a single local GPU
      //     maxTextChars: 4000,
      //     cache: true, // OCR result cache (key is `cache`, not `cacheEnabled`)
      //     cacheRetentionDays: 90,
      //     requireMissingFields: true, // Only OCR when fields are still missing
      //   },
      // },
      //
      // Merging & identity:
      // fieldPriorities: { title: { priority: ["ai-web", "static"], merge: "clobber" }, shortName: { priority: ["static"], merge: "upsert" } }, // Per-field override (default: every field ai-web + AI arbitration; metadata keys auto-static)
      //
      // Metadata extras (all static-upserted into events automatically):
      // metadata: {
      //   shortName: { value: "MAIN", conditionalValues: [{ keywords: ["subbrand"], value: "SUB-BRAND" }] }, // sub-brands sharing one parser
      //   shorterName: { value: "MN" }, // ultra-compact display name
      //   website: { value: "https://example.com" }, // `url` is an alias — website and url are ONE field
      //   facebook: { value: "https://www.facebook.com/example" },
      //   favicon: { value: "https://linktr.ee/example" }, // icon-source override, resolved dynamically by the website
      //   matchKey: { value: "example*|${year}-${month}-*|*" }, // wildcard calendar-dedup key (pair with calendarSearchRangeDays)
      // },
    },
  ],
};

// Export for different environments
// Scriptable environment
if (typeof module !== "undefined" && module.exports) {
  module.exports = scraperConfig;
}

// ES6 module environment
if (typeof window === "undefined" && typeof importModule !== "undefined") {
  // Scriptable environment - make available for importModule
  scraperConfig;
} else if (typeof window !== "undefined") {
  // Browser environment - attach to window
  window.scraperConfig = scraperConfig;
}

// Default export for ES6 modules
scraperConfig;

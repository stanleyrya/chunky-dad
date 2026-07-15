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
    pageCache: {
      enabled: true,
      ttlDays: 3,
    },
    // deadEndRetryDays: 30, // Learned dead-end URLs (fetched fine but yielded nothing) are skipped for this many days, then retried once; 0 disables the store (default: 30)
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
      // AI merge arbitration (default: true). When two records of the same event
      // genuinely conflict on a field (both non-empty, different), the AI picks the
      // better value — accepted only when its answer is a VERBATIM copy of one of
      // the candidates; anything else falls back to the deterministic strategy
      // (scraped clobbers). This global block also serves events from non-AI
      // parsers; per-parser ai.arbitrateMerges overrides. Set false to disable.
      arbitrateMerges: true,
      bearCheck: { mode: "report" }, // Bear-check cascade: keywords → AI verdict with promoter context. "report" logs decisions without changing behavior; "enforce" flags/rescues/drops; "off" = legacy alwaysBear/keyword behavior.
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
    ],
  },
  parsers: [
    {
      name: "Megawoof America",
      enabled: true,
      automationEnabled: true,
      urls: ["https://www.eventbrite.com/o/megawoof-america-18118978189"],
      alwaysBear: true,
      fieldPriorities: {
        shortName: { priority: ["static"], merge: "upsert" },
      },
      metadata: {
        title: { value: "MEGAWOOF" },
        shortName: { value: "MEGA-WOOF" },
        instagram: { value: "https://www.instagram.com/megawoof_america" },
        url: { value: "https://linktr.ee/megawoof_america" },
      },
    },
    {
      name: "Coach After Dark",
      enabled: true,
      automationEnabled: true,
      parser: "ai-web",
      urls: ["https://www.eventbrite.com/o/bear-happy-hour-87043830313"],
      alwaysBear: true,
      urlDiscoveryDepth: 1, // Depth 1: discover /e/ event links from the /o/ organizer listing
      fieldPriorities: {
        shortName: { priority: ["static"], merge: "upsert" },
      },
      metadata: {
        shortName: {
          value: "COACH",
          conditionalValues: [
            {
              keywords: ["beefwitch"],
              value: "BEEFWITCH",
            },
          ],
        },
        instagram: {
          value: "https://www.instagram.com/coachafterdark",
          conditionalValues: [
            {
              keywords: ["beefwitch"],
              value: "https://www.instagram.com/thebeefwitch",
            },
          ],
        },
      },
    },
    {
      name: "Bearracuda Events",
      enabled: true,
      parser: "ai-web",
      automationEnabled: true,
      urls: [
        "https://bearracuda.com/",
        //"https://www.eventbrite.com/o/bearracuda-21867032189"
      ],
      alwaysBear: true,
      urlDiscoveryDepth: 2,
      discoveryBlockedPatterns: ["bearracuda.com/?p="],
      keyTemplate: "bearracuda-${date}-${city}",
      fieldPriorities: {
        title: { priority: ["ai-web", "bearracuda"], merge: "clobber" },
        shortName: { priority: ["static"], merge: "upsert" },
        description: { priority: ["bearracuda", "ai-web"], merge: "clobber" },
        bar: { priority: ["ai-web", "bearracuda"], merge: "clobber" },
        address: { priority: ["ai-web", "bearracuda"], merge: "clobber" },
        startDate: { priority: ["ai-web", "bearracuda"], merge: "clobber" },
        endDate: { priority: ["ai-web", "bearracuda"], merge: "clobber" },
        url: { priority: ["bearracuda", "ai-web"], merge: "clobber" },
        location: { priority: ["ai-web", "bearracuda"], merge: "clobber" },
        gmaps: { priority: ["ai-web", "bearracuda"], merge: "clobber" },
        image: { priority: ["bearracuda", "ai-web"], merge: "clobber" },
        cover: { priority: ["ai-web", "bearracuda"], merge: "clobber" },
        facebook: { priority: ["bearracuda", "ai-web"], merge: "clobber" },
        ticketUrl: { priority: ["bearracuda", "ai-web"], merge: "clobber" },
        key: { priority: ["bearracuda", "ai-web"], merge: "clobber" },
      },
      metadata: {
        shortName: { value: "Bear-rac-uda" },
        instagram: { value: "https://www.instagram.com/bearracuda" },
      },
    },
    {
      name: "CHUNK",
      enabled: true,
      automationEnabled: true,
      parser: "auto", // chunk-party.com auto-detects the chunk parser (absent = pinned ai-web)
      urls: ["https://www.chunk-party.com"],
      alwaysBear: true, // Trusted bear-scene promoter: prompt context + fallback for the bear-check cascade (still a full bypass while bearCheck mode is report/off)
      urlDiscoveryDepth: 1, // Depth 1 to find detail pages from main page // No limit on additional URLs discovered           // Override global dryRun if needed
      discoveryBlockedPatterns: [
        "chunk-party.com/chunkbearandcubsocial",
        "chunk-party.com/shop",
        "chunk-party.com/chunk",
        "chunk-party.com/_api/",
        "chunk-party.com/contact",
      ],

      // Field priorities for merging data from different sources
      fieldPriorities: {
        title: { priority: ["chunk"], merge: "clobber" },
        shortName: { priority: ["static"], merge: "upsert" },
        description: { priority: ["chunk"], merge: "clobber" },
        bar: { priority: ["chunk"], merge: "clobber" },
        address: { priority: ["chunk"], merge: "clobber" },
        startDate: { priority: ["chunk"], merge: "clobber" },
        endDate: { priority: ["chunk"], merge: "clobber" },
        url: { priority: ["chunk"], merge: "clobber" },
        location: { priority: ["chunk"], merge: "clobber" },
        gmaps: { priority: ["chunk"], merge: "clobber" },
        image: { priority: ["chunk"], merge: "clobber" },
        cover: { priority: ["chunk"], merge: "clobber" },
        ticketUrl: { priority: ["chunk"], merge: "clobber" },
      },

      // Static metadata to add to all Chunk events
      metadata: {
        shortName: { value: "CHUNK" },
        instagram: { value: "https://www.instagram.com/chunkparty" },
      },
    },
    {
      name: "Furball",
      enabled: true,
      automationEnabled: false,
      parser: "ai-web",
      urls: ["https://www.furball.nyc"],
      alwaysBear: true,
      maxAdditionalUrls: 0,
      discoveryBlockedPatterns: ["furball.nyc/"],
      fieldPriorities: {
        title: { priority: ["ai-web", "static"], merge: "clobber" },
        shortName: { priority: ["static"], merge: "upsert" },
      },
      metadata: {
        title: { value: "FURBALL" },
        shortName: { value: "FUR-BALL" },
        instagram: { value: "https://instagram.com/furballnyc/" },
      },
    },
    {
      name: "Cubhouse",
      enabled: true,
      automationEnabled: true,
      urls: ["https://linktr.ee/cubhouse"],
      parser: "auto", // linktr.ee auto-detects the linktree parser; discovered ticket links auto-switch to ai-web
      alwaysBear: true, // Cubhouse events are always bear events
      urlDiscoveryDepth: 2, // Depth 2 to follow ticket links and their detail pages
      maxAdditionalUrls: 10, // Limit additional URLs discovered
      discoveryBlockedPatterns: ["www.eventbrite.com/o/", "linktr.ee"], // Override global dryRun if needed

      // Field priorities for merging data from different sources
      // AI-web extraction from discovered links takes priority for most fields
      fieldPriorities: {
        title: { priority: ["ai-web", "linktree"], merge: "clobber" },
        shortName: { priority: ["static"], merge: "upsert" },
        description: { priority: ["ai-web", "linktree"], merge: "clobber" },
        bar: { priority: ["ai-web", "linktree"], merge: "clobber" },
        address: { priority: ["ai-web", "linktree"], merge: "clobber" },
        startDate: { priority: ["ai-web", "linktree"], merge: "clobber" },
        endDate: { priority: ["ai-web", "linktree"], merge: "clobber" },
        url: { priority: ["static"], merge: "clobber" }, // Always use static Linktree URL
        location: { priority: ["ai-web", "linktree"], merge: "clobber" },
        gmaps: { priority: ["ai-web", "linktree"], merge: "clobber" },
        image: { priority: ["ai-web", "linktree"], merge: "clobber" },
        cover: { priority: ["ai-web", "linktree"], merge: "clobber" },
        ticketUrl: { priority: ["ai-web", "linktree"], merge: "clobber" },
      },

      // Static metadata to add to all Cubhouse events
      metadata: {
        shortName: { value: "CUB-HOUSE" },
        instagram: { value: "https://www.instagram.com/cubhouse.philly" },
        url: { value: "https://linktr.ee/cubhouse" },
      },
    },
    {
      name: "Goldiloxx",
      enabled: true,
      automationEnabled: true,
      parser: "auto", // api.redeyetickets.com auto-detects the redeyetickets parser (absent = pinned ai-web)
      urls: [
        "https://api.redeyetickets.com/api/v1/events/search?q=goldiloxx&per_page=25",
      ],
      alwaysBear: true, // Goldiloxx is a bear party
      urlDiscoveryDepth: 1, // Follow API search results to event detail endpoints           // Override global dryRun if needed
      calendarSearchRangeDays: 40, // Look +/- days for wildcard key matches

      // Field priorities for merging data from different sources
      fieldPriorities: {
        title: { priority: ["redeyetickets"], merge: "clobber" },
        description: { priority: ["redeyetickets"], merge: "clobber" },
        bar: { priority: ["redeyetickets"], merge: "clobber" },
        address: { priority: ["redeyetickets"], merge: "clobber" },
        startDate: { priority: ["redeyetickets"], merge: "clobber" },
        endDate: { priority: ["redeyetickets"], merge: "clobber" },
        url: { priority: ["redeyetickets"], merge: "clobber" },
        location: { priority: ["redeyetickets"], merge: "upsert" },
        gmaps: { priority: ["redeyetickets"], merge: "clobber" },
        image: { priority: ["redeyetickets"], merge: "clobber" },
        cover: { priority: ["redeyetickets"], merge: "clobber" },
        ticketUrl: { priority: ["redeyetickets"], merge: "clobber" },
        matchKey: { priority: ["static"], merge: "upsert" },
      },

      // Static metadata to add to all Goldiloxx events
      metadata: {
        shortName: { value: "GOLDI-LOXX" },
        shorterName: { value: "GLX" },
        instagram: { value: "https://www.instagram.com/goldiloxx__" },
        matchKey: { value: "goldiloxx*|${year}-${month}-*|*" },
      },
    },
    {
      name: "Twisted Bear",
      enabled: true,
      automationEnabled: true,
      urls: ["https://www.eventbrite.com/o/nab-events-llc-51471535173"],
      alwaysBear: true,
      fieldPriorities: {
        shortName: { priority: ["static"], merge: "upsert" },
      },
      metadata: {
        shortName: { value: "TWIST-ED BEAR" },
        instagram: { value: "https://www.instagram.com/twistedbearparty" },
        facebook: { value: "https://www.facebook.com/twistedglobal/" },
      },
    },
    {
      name: "Dallas Eagle",
      enabled: true,
      automationEnabled: false,
      urls: ["https://www.eventbrite.com/o/77139864473"],
      alwaysBear: false,
      fieldPriorities: {},
      metadata: {
        website: { value: "https://www.thedallaseagle.com" },
        facebook: { value: "https://www.facebook.com/lonestareagle" },
        instagram: { value: "https://www.instagram.com/thedallaseagle/" },
      },
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
      // ── Optional fields (shown with their defaults) ───────────────────
      // discoveryOnly: true, // First-run mapping: crawl + print the 📋 SUGGESTED CONFIG block, extract no events (default: false)
      // urlDiscoveryDepth: 2, // Omit → adaptive crawling (each page's type decides what gets followed); set a number to pin exact depth, 0 = never crawl (default: adaptive)
      // discoveryBlockedPatterns: ["example.com/members-only"], // Rarely needed: generic junk is blocked built-in and dead ends are learned + auto-retried; set only for deliberate exclusions (default: none)
      // dryRun: true, // Preview this parser's events without writing to the calendar (default: false — global config.dryRun also applies)
      // automationEnabled: false, // Skip this parser in scheduled automation runs (default: true)
      // ai: { endpoint: "...", model: "..." }, // Per-parser AI override, merged over the global `ai` block (default: global block — normally omit)
      // fieldPriorities: { title: { priority: ["ai-web", "static"], merge: "clobber" } }, // Per-field merge override (default: all fields ai-web + AI arbitration; metadata keys auto-static)
      // conditionalValues example for sub-brands sharing one parser:
      // metadata: { shortName: { value: "MAIN", conditionalValues: [{ keywords: ["subbrand"], value: "SUB-BRAND" }] } },
    },
    {
      name: "AI Web Parser (OpenAI Sample)",
      enabled: false,
      automationEnabled: false,
      parser: "ai-web",
      urls: ["https://example.com/openai-events"],
      alwaysBear: false,
      urlDiscoveryDepth: 1,
      maxAdditionalUrls: 15,
      dryRun: true,
      ai: {
        enabled: true,
        provider: "openai",
        endpoint: "https://api.openai.com/v1/chat/completions",
        model: "gpt-4o",
        numPredict: 2000,
        temperature: 0,
        openai: {
          responseFormat: "json_object",
        },
      },
      ocr: {
        enabled: true,
        provider: "openai",
        endpoint: "https://api.openai.com/v1/chat/completions",
        model: "gpt-4o-mini",
        numPredict: 2000,
        temperature: 0,
        openai: {
          responseFormat: "json_object",
        },
      },
      metadata: {},
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

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
  // ───────────────────────────────────────────────────────────────────────
  // PARSERS FIRST — the list you actually browse on the phone. Run settings
  // (config) moved below the parser list; nothing else changed.
  // ───────────────────────────────────────────────────────────────────────
  parsers: [
    // NOTE: Promoter identity (shortName/socials/matchKey) and bear trust
    // (bearAffinity) live in data/promoters.json now — the enforce-mode
    // promoter registry stamps them on matched events. Parser entries here
    // are pure SOURCES (name/urls/crawl knobs); only VENUE parsers still
    // carry a metadata block (venue facts, not promoter identity).
    {
      name: "Megawoof America",
      urls: ["https://www.eventbrite.com/o/megawoof-america-18118978189"],
    },
    {
      name: "Coach After Dark",
      urls: ["https://www.eventbrite.com/o/bear-happy-hour-87043830313"],
    },
    {
      name: "Bearracuda Events",
      urls: [
        "https://bearracuda.com/",
        "https://www.eventbrite.com/o/bearracuda-21867032189",
      ],
    },
    {
      name: "CHUNK",
      urls: ["https://www.chunk-party.com"],
      // Deliberate exclusions only — /shop, /contact, /_api/ are blocked built-in
      discoveryBlockedPatterns: [
        "chunk-party.com/chunkbearandcubsocial",
        "chunk-party.com/chunk",
      ],
    },
    {
      name: "Furball",
      urls: ["https://www.furball.nyc"],
      urlDiscoveryDepth: 0,
    },
    {
      name: "Cubhouse",
      urls: ["https://linktr.ee/cubhouse"],
      discoveryBlockedPatterns: ["www.eventbrite.com/o/", "linktr.ee"],
    },
    {
      name: "Goldiloxx",
      // Homeless promoter — events scatter across ticketing platforms (links
      // rotate in their Instagram bio). Stable doors: the RedEye JSON API
      // search (self-refreshing; JSON-API pathway extracts it structurally)
      // and Sickening's own server-side search, scoped to the promoter.
      urls: [
        "https://api.redeyetickets.com/api/v1/events/search?q=goldiloxx&per_page=25",
        // `?q=` is Sickening's real search input (`<input name="q">` on the
        // events page, GET to the same path) and it filters SERVER-side —
        // verified 2026-08-04: unfiltered = 1,227,723 bytes / 453 distinct
        // /e/ links, `?q=goldiloxx` = 61,756 bytes / 2 links (both
        // goldiloxx), `?q=<nonsense>` = 0 links. Same 2 events either way,
        // 20x less page, and segmentation drops from 485 segments to ~2.
        // JSON-LD and the visible date strings both survive the filter.
        "https://sickening.events/events?q=goldiloxx",
      ],
      // Kept as a safety net for the RedEye door and any followed link. NOTE:
      // now that the sickening URL itself contains the pattern, the allowlist
      // treats that page as the promoter's own and stops filtering it — which
      // is correct (the page IS scoped to goldiloxx) but means the net is only
      // as tight as Sickening's search. Verified non-fuzzy: q=goldiloxx
      // returns goldiloxx links only. Note also that sickening JSON-LD
      // "organizer" is the VENUE, and the site soft-404s (every URL returns
      // 200 with an empty shell), so "no events" and "site broken" look alike.
      discoveryAllowedPatterns: ["goldiloxx"],
    },
    {
      name: "3 Dollar Bill",
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
      // discoveryOnly: true,
      urls: [
        "https://www.eventbrite.com/o/nab-events-llc-51471535173",
        "https://www.eventbrite.com/o/121474797695",
      ],
    },
    {
      name: "Dallas Eagle",
      // Venue-site repoint (2026-08-02, same shape as the Eagle LA fix in
      // #1609): the Eventbrite org page /o/77139864473 is structurally dry —
      // it lists nothing while the real events (dated "Start from:/End at:"
      // listings plus "Every Wednesday" weeklies) live on the venue's own
      // /events/ page, whose links the org-page crawl rejected as cross-host.
      // The "End at:" start-time trap is covered by #1540's end-marker gate;
      // dateless weeklies flow into the #1616 ICS-only recurrence path.
      urls: ["https://www.thedallaseagle.com/events/"],
      metadata: {
        website: { value: "https://www.thedallaseagle.com" },
        facebook: { value: "https://www.facebook.com/lonestareagle" },
        instagram: { value: "https://www.instagram.com/thedallaseagle/" },
        mastodon: { value: "https://mastodon.social/@dallaseagle" },
      },
    },
    { name: "massive.club", urls: ["https://www.massive.club"], alwaysBear: false },
    // ── Festival-week schedules 2026-07-28 (recon-verified) ─────────────
    {
      name: "Bears Sitges Week",
      automationEnabled: false,
      // Official Bears Sitges Club programme — one long WordPress page,
      // ~45 timed activities Sept 3-13 with venues inline. Spanish text;
      // day headers carry day-of-month only (month/year stated once).
      urls: ["https://bearssitges.org/bears-sitges-week/"],
      urlDiscoveryDepth: 0, // everything on one page; discovery wanders into store/news
      ai: { classifyPages: false }, // heuristic multi-event-page is CORRECT here; the AI
      // second opinion sees "one overarching event" (festival-programme trap) and
      // reroutes to single-event extraction, whose payload window misses the schedule
    },
    {
      name: "Spooky Bear",
      automationEnabled: false,
      // Northeast Ursamen's Provincetown Halloween weekend. 2026 schedule
      // publishes on THIS url ~Sept/Oct (2025 precedent: full text schedule,
      // venues inline, weekday-only headers — dates anchor to the announced
      // range). Idles harmlessly until then.
      urls: ["https://www.ursamen.org/spookybear"],
      urlDiscoveryDepth: 1, // follow Zeffy/ThunderTix ticket links
      discoveryBlockedPatterns: ["ursamen.org/about", "ursamen.org/contact", "ursamen.org/the-board", "ursamen.org/our-sponsors", "ursamen.org/general-events", "coming-soon", "zeffy.com/donation-form"],
    },
    // ── Onboarding batch 2026-07-27 (recon-verified) — run each one alone
    // via the parser picker and review before including it in bigger runs. ──
    {
      name: "The Lumberyard",
      urls: ["https://www.thelumberyardbar.com/events"],
      // Seattle bear-friendly bar (9630 16th Ave SW) with general weekly
      // programming — bear check filters, not alwaysBear.
      alwaysBear: false,
      metadata: {
        website: { value: "https://www.thelumberyardbar.com" },
      },
    },
    {
      name: "Eagle LA",
      // Venue parser, not a promoter one: eaglela.com is Eagle LA's own site
      // (The Events Calendar, JSON-LD) and it hosts many bear parties, not
      // just CubScout. This used to point at the single event page
      // /events/cub-scout-3/, which meant (a) every other Eagle LA night was
      // invisible — the archive lists BEAR HAPPY HOUR, SUNDAY BEER BUST, MEAT
      // RACK, ONYX, CUBSCOUT and more in August 2026 alone — and (b) the slug
      // was a hardcoded guess: a renamed series (cub-scout-4) would 404 and
      // the parser would go quiet without failing. The listing archive is the
      // stable entry point; the crawler reaches each occurrence from there.
      //
      // "Eagle LA" is a curated bar (data/bars/la.json), so the venue-site
      // identity path resolves the site to the venue and events keep their own
      // party names (CUBSCOUT, ONYX, …) with bar="Eagle LA" — the brand
      // prefixer is a no-op on venue-role sites. The CubScout LA PROMOTER
      // entry in scraper-promoters.js is unchanged and still claims the
      // CUBSCOUT title alias.
      //
      // /calendar/ is the MEC month grid — it lists MORE of the month than
      // the /events/ archive (25 vs 12 in Aug 2026) and is where the
      // month-feed lookahead fetches next month's grid from.
      //
      // NOT alwaysBear (owner call, 2026-08-11): the venue hosts many
      // non-bear nights, so trusted-source keep-everything would flood the
      // review pile. The bear check does over-drop flagship parties here
      // (run 20260811-132948 dropped MEAT RACK, ONYX, SUNDAY BEER BUST as
      // "no bear-specific vocabulary") — the intended remedy is persistent
      // manual bear verdicts, not alwaysBear.
      urls: ["https://eaglela.com/events/", "https://eaglela.com/calendar/"],
    },
    {
      name: "BEEFMINCE",
      // Multi-city UK (London/Brighton/Manchester/Birmingham + Sitges);
      // per-event city comes from event text; tickets link out to dice.fm.
      urls: ["https://beefmince.com/events"],
    },
    {
      name: "BeefDip",
      // Puerto Vallarta bear week; single schedule page, venues appear as
      // Google Maps links (maps-link address harvesting applies).
      urls: ["https://beefdip.com/planned-events/"],
    },
    {
      name: "Bear it MTL",
      // Montreal (Sugar Bear Weekend organizer); The Events Calendar with
      // JSON-LD + Offers; also lists Toronto/Paris events — city per event.
      urls: ["https://www.bearitmtl.com/events/"],
    },
    {
      name: "Club Chub",
      // Touring chub/chaser series; Eventbrite links sit in the site's own
      // static HTML. Do NOT use the Eventbrite org page — it's CCBC Resort's
      // venue account and would pull non-Club-Chub events.
      urls: ["https://www.clubchubusa.com/event-list"],
    },
    {
      name: "The Bear Calendar",
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
      // template: documentation-only entry. The parser picker, parser-name
      // matching, and scheduled automation runs all skip entries carrying
      // template: true — remove the marker (or copy the entry) to go live.
      template: true,
      urls: ["https://example.com/events"],
      alwaysBear: false, // set true for trusted bear promoters (AI trust context)
      metadata: {
        shortName: { value: "NEW-SITE" }, // use a soft hyphen (\u00ad) where it may line-break; it stays invisible until needed
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
  config: {
    daysToLookAhead: null,
    // Keep events whose start date already passed instead of dropping them at
    // scrape time — the website reads fuller with history on it. Applies to
    // every parser; flip to false (or remove) to go back to future-only.
    allowPastEvents: true,
    // Companion knob (owner 2026-08-20): keep WRITING updates to past events
    // up to a year back, so recent-past cards with script-format diffs write
    // once instead of re-showing the same diff forever. Only spans that ended
    // MORE than this many days ago are withheld from calendar writes
    // (span-fully-past). Remove to fall back to the 30-day default.
    sanity: { pastSpanWithholdDays: 365 },
    // dryRun: true, // Preview mode: analyze + display without writing to the calendar (default: false)
    // Parser picker at run start OWNS run selection (default: false).
    // Manual Scriptable runs only; the selection is session-scoped and never
    // edits this file. It pre-selects the previous run's confirmed picks
    // (persisted in picker-state.json); dismissing the picker CANCELS the run.
    // ⚠️ Parser entries carry NO static enabled flags anymore: with this set
    // to false — or on manual runs outside Scriptable (web/server) — a manual
    // run executes ALL parsers. Scheduled automation is unaffected (no picker;
    // per-parser automationEnabled governs what automation runs).
    pickParsers: true,
    pageCache: {
      enabled: true,
      ttlDays: 3,
    },
    // deadEndRetryDays: 30, // Learned dead-end URLs (fetched fine but yielded nothing) are skipped for this many days, then retried once; 0 disables the store (default: 30)
    geocodeVerification: { mode: "enforce" }, // verify geocoded pins: grade-gate + Apple reverse cross-check. "report" (default) flags suspects in logs, "enforce" refuses suspect pins, "off" skips extra checks. Generic city-level pins are always refused.
    promoterRegistry: { mode: "enforce" }, // Curated promoter identity matching — see data/promoters.json; enforce stamps matched metadata + bearAffinity (flipped 2026-07-28: verification battery — 37 matches, 0 false positives, 100% precision)
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
      // Calendar stickiness (default: false = REPORT-ONLY). The merge arbiter is
      // position-biased — in run 20260801-172321 the enrich path picked `incoming`
      // 72% of the time while the calendar path picked `calendar` 66% of the time,
      // and the identical value pair was arbitrated twice 11 seconds apart with
      // opposite verdicts. The result is the same events being rewritten every run
      // ("BEEFMINCE x RVT" clobbered 21×). With this false, every field where an
      // AI-ONLY decision would overwrite a non-empty saved calendar value is logged
      // (`🧊 STICKY:`) and the change is still applied. Set true to actually keep
      // the saved value. Date/time fields and empty/TBA calendar values are always
      // exempt — a rescheduled event must still move.
      calendarStickinessEnforced: false,
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

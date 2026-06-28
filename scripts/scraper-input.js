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
    dryRun: false,
    daysToLookAhead: null,
    pageCache: {
      enabled: true,
      ttlDays: 3
    },
    aiConfidenceDefaults: {
      confidence: {
        expectations: {
          urlPatterns: [
            {
              pattern: "^https?://(?:www\\.)?eventbrite\\.com/e/",
              fields: {
                cover: { expected: ["jsonld"], strong: ["jsonld"] },
                image: { expected: ["jsonld"], strong: ["jsonld"] },
                ticketUrl: { expected: ["jsonld"], strong: ["jsonld"] },
                location: { expected: ["meta"], strong: ["meta"] }
              }
            }
          ]
        }
      }
    },
    ai: {
      enabled: true,
      endpoint: "http://rybook.taila7523c.ts.net:8000/v1/chat/completions",
      provider: "openai",
      openai: {
        responseFormat: "json_object"
      },
      model: "lmstudio-community/Qwen3-Coder-Next-MLX-6bit",
      payloadMode: "best",
      maxHtmlChars: 6000,
      numCtx: 2048,
      numPredict: 512,
      temperature: 0,
      think: false,
      timeoutSeconds: 120,
      keepAlive: "5m"
    },
    ocr: {
      enabled: true,
      endpoint: "http://desktop.taila7523c.ts.net:11434/api/generate",
      model: "qwen3-vl:4b-instruct",
      timeoutSeconds: 300,
      numCtx: 8192,
      numPredict: 2000,
      temperature: 0,
      think: false,
      keepAlive: "5m",
      maxImages: 2,
      maxTextChars: 4000,
      cacheEnabled: true,
      requireMissingFields: true
    },
    // URL pattern rules for page classification. Checked in order — first match wins.
    // More specific patterns (e.g. /events/:slug) must come before broader ones (e.g. domain root).
    pageClassificationRules: [
      { pattern: /eventbrite\.com\/e\//i,                classification: "event-page" },
      { pattern: /eventbrite\.com\/o\//i,                classification: "multi-event-page" },
      { pattern: /furball\.nyc/i,                        classification: "multi-event-page" },
      { pattern: /bearracuda\.com\/events\/[^/?&#\s]+/i, classification: "event-page" },
      { pattern: /bearracuda\.com/i,                     classification: "link-aggregator" },
      { pattern: /linktr\.ee/i,                          classification: "link-aggregator" }
    ]
  },
  parsers: [
    {
      name: "Megawoof America",
      enabled: true,
      automation: {
        automationEnabled: true
      },
      urls: ["https://www.eventbrite.com/o/megawoof-america-18118978189"],
      alwaysBear: true,
      urlDiscoveryDepth: 0,
      maxAdditionalUrls: null,
      dryRun: false,
      fieldPriorities: {
        shortName: { priority: ["static"], merge: "upsert" },
      },
      metadata: {
        title: { value: "MEGAWOOF" },
        shortName: { value: "MEGA-WOOF" },
        instagram: { value: "https://www.instagram.com/megawoof_america" },
        url: { value: "https://linktr.ee/megawoof_america" }
      }
    },
    {
      name: "Coach After Dark",
      enabled: true,
      automation: {
        automationEnabled: true
      },
      parser: "ai-web",
      urls: ["https://www.eventbrite.com/o/bear-happy-hour-87043830313"],
      alwaysBear: true,
      urlDiscoveryDepth: 1,    // Depth 1: discover /e/ event links from the /o/ organizer listing
      dryRun: false,
      fieldPriorities: {
        shortName: { priority: ["static"], merge: "upsert" },
      },
      metadata: {
        shortName: {
          value: "COACH",
          conditionalValues: [
            {
              keywords: ["beefwitch"],
              value: "BEEFWITCH"
            }
          ]
        },
        instagram: {
          value: "https://www.instagram.com/coachafterdark",
          conditionalValues: [
            {
              keywords: ["beefwitch"],
              value: "https://www.instagram.com/thebeefwitch"
            }
          ]
        }
      }
    },
    {
      name: "Bearracuda Events",
      enabled: true,
      parser: "ai-web",
      automation: {
        automationEnabled: true
      },
      urls: [
        "https://bearracuda.com/",
        //"https://www.eventbrite.com/o/bearracuda-21867032189"
      ],
      alwaysBear: true,
      urlDiscoveryDepth: 2,
      discoveryBlockedPatterns: ["bearracuda.com/?p="],
      dryRun: false,
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
        key: { priority: ["bearracuda", "ai-web"], merge: "clobber" }
      },
      metadata: {
        shortName: { value: "Bear-rac-uda" },
        instagram: { value: "https://www.instagram.com/bearracuda" }
      }
    },
    {
      name: "CHUNK",
      enabled: true,
      automation: {
        automationEnabled: true
      },
      urls: ["https://www.chunk-party.com"],
      alwaysBear: true,        // Chunk parties are always bear events
      urlDiscoveryDepth: 1,    // Depth 1 to find detail pages from main page
      maxAdditionalUrls: null, // No limit on additional URLs discovered
      dryRun: false,           // Override global dryRun if needed
      discoveryBlockedPatterns: [
        "chunk-party.com/chunkbearandcubsocial",
        "chunk-party.com/shop",
        "chunk-party.com/chunk",
        "chunk-party.com/_api/",
        "chunk-party.com/contact"
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
        ticketUrl: { priority: ["chunk"], merge: "clobber" }
      },
      
      // Static metadata to add to all Chunk events
      metadata: {
        shortName: { value: "CHUNK" },
        instagram: { value: "https://www.instagram.com/chunkparty" }
      }
    },
    {
      name: "Furball",
      enabled: true,
      automation: {
        automationEnabled: false
      },
      parser: "ai-web",
      urls: [
        "https://www.furball.nyc"
      ],
      alwaysBear: true,
      urlDiscoveryDepth: 0,
      maxAdditionalUrls: 0,
      discoveryBlockedPatterns: ["furball.nyc/"],
      dryRun: false,
      fieldPriorities: {
        title: { priority: ["ai-web", "static"], merge: "clobber" },
        shortName: { priority: ["static"], merge: "upsert" },
      },
      metadata: {
        title: { value: "FURBALL" },
        shortName: { value: "FUR-BALL" },
        instagram: { value: "https://instagram.com/furballnyc/" }
      }
    },
    {
      name: "Cubhouse",
      enabled: true,
      automation: {
        automationEnabled: true
      },
      urls: ["https://linktr.ee/cubhouse"],
      // parser: "linktree",    // Auto-detected from URL pattern
      alwaysBear: true,        // Cubhouse events are always bear events
      urlDiscoveryDepth: 2,    // Depth 2 to follow ticket links and their detail pages
      maxAdditionalUrls: 10,   // Limit additional URLs discovered
      discoveryBlockedPatterns: ["www.eventbrite.com/o/", "linktr.ee"],
      dryRun: false,           // Override global dryRun if needed
      
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
        ticketUrl: { priority: ["ai-web", "linktree"], merge: "clobber" }
      },
      
      // Static metadata to add to all Cubhouse events
      metadata: {
        shortName: { value: "CUB-HOUSE" },
        instagram: { value: "https://www.instagram.com/cubhouse.philly" },
        url: { value: "https://linktr.ee/cubhouse" }
      }
    },
    {
      name: "Goldiloxx",
      enabled: true,
      automation: {
        automationEnabled: true
      },
      urls: ["https://api.redeyetickets.com/api/v1/events/search?q=goldiloxx&per_page=25"],
      alwaysBear: true,        // Goldiloxx is a bear party
      urlDiscoveryDepth: 1,    // Follow API search results to event detail endpoints
      dryRun: false,           // Override global dryRun if needed
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
        matchKey: { priority: ["static"], merge: "upsert" }
      },
      
      // Static metadata to add to all Goldiloxx events
      metadata: {
        shortName: { value: "GOLDI-LOXX" },
        shorterName: { value: "GLX" },
        instagram: { value: "https://www.instagram.com/goldiloxx__" },
        matchKey: { value: "goldiloxx*|${year}-${month}-*|*" }
      }
    },
    {
      name: "Twisted Bear",
      enabled: true,
      automation: {
        automationEnabled: true
      },
      urls: ["https://www.eventbrite.com/o/nab-events-llc-51471535173"],
      alwaysBear: true,
      urlDiscoveryDepth: 0,
      maxAdditionalUrls: null,
      dryRun: false,
      fieldPriorities: {
        shortName: { priority: ["static"], merge: "upsert" },
      },
      metadata: {
        shortName: { value: "TWIST-ED BEAR" },
        instagram: { value: "https://www.instagram.com/twistedbearparty" },
        facebook: { value: "https://www.facebook.com/twistedglobal/" }
      }
    },
    {
      name: "Dallas Eagle",
      enabled: true,
      automation: {
        automationEnabled: false
      },
      urls: ["https://www.eventbrite.com/o/77139864473"],
      alwaysBear: false,
      urlDiscoveryDepth: 0,
      maxAdditionalUrls: null,
      dryRun: false,
      fieldPriorities: {
      },
      metadata: {
        website: { value: "https://www.thedallaseagle.com" },
        facebook: { value: "https://www.facebook.com/lonestareagle" },
        instagram: { value: "https://www.instagram.com/thedallaseagle/" },
      }
    },
    {
      name: "AI Web Parser (Sample)",
      enabled: false,
      automation: {
        automationEnabled: false
      },
      parser: "ai-web",
      urls: ["https://example.com/events"],
      alwaysBear: false,
      urlDiscoveryDepth: 1,
      maxAdditionalUrls: 15,
      discoveryOnly: false,  // Set true to run normal crawl/discovery flow while skipping event extraction
      discoveryBlockedHosts: [],  // Hostnames to suppress during URL discovery (e.g. ["example.com"] blocks links back to the source site)
      discoveryBlockedPatterns: [],  // Case-insensitive URL substrings to suppress during discovery (e.g. ["example.com/?p="])
      dryRun: true,
      ai: {
        enabled: true,
        endpoint: "http://desktop.taila7523c.ts.net:11434/api/generate",
        model: "qwen3.5:4b",  // Main AI model for parsing
        payloadMode: "best",
        maxHtmlChars: 6000,
        numCtx: 2048,
        numPredict: 512,
        temperature: 0,
        think: false,
        timeoutSeconds: 120,
        keepAlive: "5m"
      },
      ocr: {
        enabled: true,
        endpoint: "http://desktop.taila7523c.ts.net:11434/api/generate",
        model: "qwen3-vl:4b-instruct",  // OCR model - defaults to qwen3-vl:4b-instruct
        timeoutSeconds: 300,
        numCtx: 8192,
        numPredict: 2000,
        temperature: 0,
        think: false,
        keepAlive: "5m",
        maxImages: 2,
        maxTextChars: 4000,
        cacheEnabled: true,
        requireMissingFields: true
      },
      metadata: {}
    },
    {
      name: "AI Web Parser (OpenAI Sample)",
      enabled: false,
      automation: {
        automationEnabled: false
      },
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
        numPredict: 1024,
        temperature: 0,
        openai: {
          responseFormat: "json_object"
        }
      },
      ocr: {
        enabled: true,
        provider: "openai",
        endpoint: "https://api.openai.com/v1/chat/completions",
        model: "gpt-4o-mini",
        numPredict: 2000,
        temperature: 0,
        openai: {
          responseFormat: "json_object"
        }
      },
      metadata: {}
    }
  ]
};

// Export for different environments
// Scriptable environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = scraperConfig;
}

// ES6 module environment
if (typeof window === 'undefined' && typeof importModule !== 'undefined') {
  // Scriptable environment - make available for importModule
  scraperConfig;
} else if (typeof window !== 'undefined') {
  // Browser environment - attach to window
  window.scraperConfig = scraperConfig;
}

// Default export for ES6 modules
scraperConfig;

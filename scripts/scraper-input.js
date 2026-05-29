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
    }
  },
  parsers: [
    {
      name: "Megawoof America",
      iconUrl: "https://ugc.production.linktr.ee/YY9vP9AGQ9OTFY9iXiDi_hcmot5ynjOsfwPWJ?io=true&size=avatar-v3_0",
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
        title: { priority: ["static"], merge: "clobber" },
        shortName: { priority: ["static"], merge: "upsert" },
        instagram: { priority: ["static"], merge: "clobber" },
        description: { priority: ["ai-web"], merge: "clobber" },
        bar: { priority: ["ai-web"], merge: "clobber" },
        address: { priority: ["ai-web"], merge: "clobber" },
        startDate: { priority: ["ai-web"], merge: "clobber" },
        endDate: { priority: ["ai-web"], merge: "clobber" },
        url: { priority: ["static"], merge: "clobber" },
        location: { priority: ["ai-web"], merge: "clobber" },
        gmaps: { priority: ["ai-web"], merge: "clobber" },
        image: { priority: ["ai-web"], merge: "clobber" },
        cover: { priority: ["ai-web"], merge: "clobber" },
        ticketUrl: { priority: ["ai-web"], merge: "clobber" }
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
      iconUrl: "https://www.google.com/s2/favicons?domain=www.eventbrite.com&sz=64",
      enabled: true,
      automation: {
        automationEnabled: true
      },
      parser: "ai-web",
      urls: ["https://www.eventbrite.com/o/bear-happy-hour-87043830313"],
      alwaysBear: true,
      urlDiscoveryDepth: 1,    // Depth 1: discover /e/ event links from the /o/ organizer listing
      dryRun: false,
      ai: {
        enabled: true,
        endpoint: "http://desktop.taila7523c.ts.net:11434/api/generate",
        model: "qwen3.5:4b",
        maxHtmlChars: 12000,
        numCtx: 8192,
        numPredict: 512,
        timeoutSeconds: 120,
        keepAlive: "5m"
      },
      fieldPriorities: {
        title: { priority: ["ai-web"], merge: "clobber" },
        shortName: { priority: ["static"], merge: "upsert" },
        instagram: { priority: ["static"], merge: "clobber" },
        description: { priority: ["ai-web"], merge: "clobber" },
        bar: { priority: ["ai-web"], merge: "clobber" },
        address: { priority: ["ai-web"], merge: "clobber" },
        startDate: { priority: ["ai-web"], merge: "clobber" },
        endDate: { priority: ["ai-web"], merge: "clobber" },
        location: { priority: ["ai-web"], merge: "clobber" },
        gmaps: { priority: ["ai-web"], merge: "clobber" },
        image: { priority: ["ai-web"], merge: "clobber" },
        cover: { priority: ["ai-web"], merge: "clobber" },
        ticketUrl: { priority: ["ai-web"], merge: "clobber" }
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
      iconUrl: "https://www.google.com/s2/favicons?domain=bearracuda.com&sz=64",
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
        instagram: { priority: ["static"], merge: "clobber" },
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
      iconUrl: "https://www.google.com/s2/favicons?domain=www.chunk-party.com&sz=64",
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
        instagram: { priority: ["static"], merge: "clobber" },
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
      iconUrl: "https://www.google.com/s2/favicons?domain=www.furball.nyc&sz=64",
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
      defaultCity: "nyc",
      dryRun: false,
      fieldPriorities: {
        title: { priority: ["ai-web", "static"], merge: "clobber" },
        shortName: { priority: ["static"], merge: "upsert" },
        instagram: { priority: ["static"], merge: "clobber" },
        description: { priority: ["ai-web"], merge: "clobber" },
        bar: { priority: ["ai-web"], merge: "clobber" },
        address: { priority: ["ai-web"], merge: "clobber" },
        startDate: { priority: ["ai-web"], merge: "clobber" },
        endDate: { priority: ["ai-web"], merge: "clobber" },
        url: { priority: ["ai-web"], merge: "clobber" },
        location: { priority: ["ai-web"], merge: "clobber" },
        ticketUrl: { priority: ["ai-web"], merge: "clobber" },
        gmaps: { priority: ["ai-web"], merge: "clobber" },
        image: { priority: ["ai-web"], merge: "clobber" },
        cover: { priority: ["ai-web"], merge: "clobber" }
      },
      metadata: {
        title: { value: "FURBALL" },
        shortName: { value: "FUR-BALL" },
        instagram: { value: "https://instagram.com/furballnyc/" }
      }
    },
    {
      name: "Cubhouse",
      iconUrl: "https://ugc.production.linktr.ee/48e9facd-5c7d-41e3-a7d0-04752baa27f1_IMG-5519.jpeg?io=true&size=avatar-v3_0",
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
        instagram: { priority: ["static"], merge: "clobber" },
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
      iconUrl: "https://www.google.com/s2/favicons?domain=redeyetickets.com&sz=64",
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
        shortName: { priority: ["static"], merge: "clobber" },
        shorterName: { priority: ["static"], merge: "clobber" },
        instagram: { priority: ["static"], merge: "clobber" },
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
      iconUrl: "https://www.google.com/s2/favicons?domain=www.eventbrite.com&sz=64",
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
        title: { priority: ["ai-web"], merge: "clobber" },
        shortName: { priority: ["static"], merge: "upsert" },
        instagram: { priority: ["static"], merge: "clobber" },
        facebook: { priority: ["static"], merge: "clobber" },
        description: { priority: ["ai-web"], merge: "clobber" },
        bar: { priority: ["ai-web"], merge: "clobber" },
        address: { priority: ["ai-web"], merge: "clobber" },
        startDate: { priority: ["ai-web"], merge: "clobber" },
        endDate: { priority: ["ai-web"], merge: "clobber" },
        url: { priority: ["ai-web"], merge: "clobber" },
        location: { priority: ["ai-web"], merge: "clobber" },
        gmaps: { priority: ["ai-web"], merge: "clobber" },
        image: { priority: ["ai-web"], merge: "clobber" },
        cover: { priority: ["ai-web"], merge: "clobber" },
        ticketUrl: { priority: ["ai-web"], merge: "clobber" }
      },
      metadata: {
        shortName: { value: "TWIST-ED BEAR" },
        instagram: { value: "https://www.instagram.com/twistedbearparty" },
        facebook: { value: "https://www.facebook.com/twistedglobal/" }
      }
    },
    {
      name: "Dallas Eagle",
      iconUrl: "https://www.google.com/s2/favicons?domain=www.eventbrite.com&sz=64",
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
        title: { priority: ["ai-web"], merge: "clobber" },
        instagram: { priority: ["static"], merge: "clobber" },
        facebook: { priority: ["static"], merge: "clobber" },
        website: { priority: ["static"], merge: "clobber" },
        mastodon: { priority: ["static"], merge: "clobber" },
        description: { priority: ["ai-web"], merge: "clobber" },
        bar: { priority: ["ai-web"], merge: "clobber" },
        address: { priority: ["ai-web"], merge: "clobber" },
        startDate: { priority: ["ai-web"], merge: "clobber" },
        endDate: { priority: ["ai-web"], merge: "clobber" },
        url: { priority: ["ai-web"], merge: "clobber" },
        location: { priority: ["ai-web"], merge: "clobber" },
        gmaps: { priority: ["ai-web"], merge: "clobber" },
        image: { priority: ["ai-web"], merge: "clobber" },
        cover: { priority: ["ai-web"], merge: "clobber" },
        ticketUrl: { priority: ["ai-web"], merge: "clobber" }
      },
      metadata: {
        website: { value: "https://www.thedallaseagle.com" },
        facebook: { value: "https://www.facebook.com/lonestareagle" },
        instagram: { value: "https://www.instagram.com/thedallaseagle/" },
        mastodon: { value: "https://mastodon.social/@dallaseagle" }
      }
    },
    {
      name: "AI Web Parser (Sample)",
      iconUrl: "https://www.google.com/s2/favicons?domain=example.com&sz=64",
      enabled: false,
      automation: {
        automationEnabled: false
      },
      parser: "ai-web",
      urls: ["https://example.com/events"],
      alwaysBear: false,
      urlDiscoveryDepth: 1,
      maxAdditionalUrls: 15,
      discoveryOnly: false,  // Set true to map the URL tree without extracting events (useful for debugging discovery)
      discoveryBlockedHosts: [],  // Hostnames to suppress during URL discovery (e.g. ["example.com"] blocks links back to the source site)
      discoveryBlockedPatterns: [],  // Case-insensitive URL substrings to suppress during discovery (e.g. ["example.com/?p="])
      dryRun: true,
      ai: {
        enabled: true,
        endpoint: "http://desktop.taila7523c.ts.net:11434/api/generate",
        model: "qwen3.5:4b",
        payloadMode: "best",
        maxHtmlChars: 6000,
        numCtx: 2048,
        numPredict: 512,
        temperature: 0,
        think: false,
        timeoutSeconds: 120,
        keepAlive: "5m"
      },
      fieldPriorities: {
        title: { priority: ["ai-web"], merge: "clobber" },
        description: { priority: ["ai-web"], merge: "clobber" },
        bar: { priority: ["ai-web"], merge: "clobber" },
        address: { priority: ["ai-web"], merge: "clobber" },
        startDate: { priority: ["ai-web"], merge: "clobber" },
        endDate: { priority: ["ai-web"], merge: "clobber" },
        city: { priority: ["ai-web"], merge: "clobber" },
        url: { priority: ["ai-web"], merge: "clobber" },
        image: { priority: ["ai-web"], merge: "clobber" },
        cover: { priority: ["ai-web"], merge: "clobber" },
        ticketUrl: { priority: ["ai-web"], merge: "clobber" }
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

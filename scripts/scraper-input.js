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
    daysToLookAhead: null
  },
  parsers: [
    {
      name: "Megawoof America",
      enabled: true,
      automation: {
        enabled: true,
        days: ["mon"],
        timeWindow: { startHour: 4, endHour: 5 }
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
        description: { priority: ["eventbrite"], merge: "clobber" },
        bar: { priority: ["eventbrite"], merge: "clobber" },
        address: { priority: ["eventbrite"], merge: "clobber" },
        startDate: { priority: ["eventbrite"], merge: "clobber" },
        endDate: { priority: ["eventbrite"], merge: "clobber" },
        url: { priority: ["static"], merge: "clobber" },
        location: { priority: ["eventbrite"], merge: "clobber" },
        gmaps: { priority: ["eventbrite"], merge: "clobber" },
        image: { priority: ["eventbrite"], merge: "clobber" },
        cover: { priority: ["eventbrite"], merge: "clobber" }
      },
      metadata: {
        title: { value: "MEGAWOOF" },
        shortName: { value: "MEGA-WOOF" },
        instagram: { value: "https://www.instagram.com/megawoof_america" },
        url: { value: "https://linktr.ee/megawoof_america" }
      }
    },
    {
      name: "Bear Happy Hour",
      enabled: false,
      automation: {
        enabled: false,
        days: ["wed"],
        timeWindow: { startHour: 5, endHour: 6 }
      },
      urls: ["https://www.eventbrite.com/o/bear-happy-hour-87043830313"],
      alwaysBear: true,
      urlDiscoveryDepth: 0,
      dryRun: false,
      fieldPriorities: {
        title: { priority: ["eventbrite"], merge: "clobber" },
        shortName: { priority: ["static"], merge: "upsert" },
        instagram: { priority: ["static"], merge: "clobber" },
        description: { priority: ["eventbrite"], merge: "clobber" },
        bar: { priority: ["eventbrite"], merge: "clobber" },
        address: { priority: ["eventbrite"], merge: "clobber" },
        startDate: { priority: ["eventbrite"], merge: "clobber" },
        endDate: { priority: ["eventbrite"], merge: "clobber" },
        url: { priority: ["eventbrite"], merge: "clobber" },
        location: { priority: ["eventbrite"], merge: "clobber" },
        gmaps: { priority: ["eventbrite"], merge: "clobber" },
        image: { priority: ["eventbrite"], merge: "clobber" },
        cover: { priority: ["eventbrite"], merge: "clobber" }
      },
      metadata: {
        instagram: { value: "https://www.instagram.com/coachafterdark" }
      }
    },
    {
      name: "Bearracuda Events",
      enabled: false,
      automation: {
        enabled: false,
        days: ["wed"],
        timeWindow: { startHour: 6, endHour: 7 }
      },
      urls: [
        "https://bearracuda.com/",
        //"https://www.eventbrite.com/o/bearracuda-21867032189"
      ],
      alwaysBear: true,
      urlDiscoveryDepth: 2,
      dryRun: false,
      keyTemplate: "bearracuda-${date}-${city}",
      fieldPriorities: {
        title: { priority: ["eventbrite", "bearracuda"], merge: "clobber" },
        shortName: { priority: ["static"], merge: "upsert" },
        instagram: { priority: ["static"], merge: "clobber" },
        description: { priority: ["bearracuda", "eventbrite"], merge: "clobber" },
        bar: { priority: ["eventbrite", "bearracuda"], merge: "clobber" },
        address: { priority: ["eventbrite", "bearracuda"], merge: "clobber" },
        startDate: { priority: ["eventbrite", "bearracuda"], merge: "clobber" },
        endDate: { priority: ["eventbrite", "bearracuda"], merge: "clobber" },
        url: { priority: ["bearracuda", "eventbrite"], merge: "clobber" },
        location: { priority: ["eventbrite", "bearracuda"], merge: "clobber" },
        gmaps: { priority: ["eventbrite", "bearracuda"], merge: "clobber" },
        image: { priority: ["bearracuda", "eventbrite"], merge: "clobber" },
        cover: { priority: ["eventbrite", "bearracuda"], merge: "clobber" },
        facebook: { priority: ["bearracuda", "eventbrite"], merge: "clobber" },
        ticketUrl: { priority: ["bearracuda", "eventbrite"], merge: "clobber" },
        key: { priority: ["bearracuda", "eventbrite"], merge: "clobber" }
      },
      metadata: {
        shortName: { value: "Bear-rac-uda" },
        instagram: { value: "https://www.instagram.com/bearracuda" }
      }
    },
    {
      name: "CHUNK",
      enabled: false,
      automation: {
        enabled: false,
        days: ["fri"],
        timeWindow: { startHour: 4, endHour: 5 }
      },
      urls: ["https://www.chunk-party.com"],
      alwaysBear: true,        // Chunk parties are always bear events
      urlDiscoveryDepth: 1,    // Depth 1 to find detail pages from main page
      maxAdditionalUrls: null, // No limit on additional URLs discovered
      dryRun: false,           // Override global dryRun if needed
      
      // Field priorities for merging data from different sources
      fieldPriorities: {
        title: { priority: ["chunk", "static"], merge: "clobber" },
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
    }
    ,
    {
      name: "Furball",
      enabled: false,
      automation: {
        enabled: false,
        days: ["fri"],
        timeWindow: { startHour: 6, endHour: 7 }
      },
      urls: [
        "https://www.furball.nyc"
      ],
      alwaysBear: true,
      urlDiscoveryDepth: 0,
      maxAdditionalUrls: 0,
      defaultCity: "nyc",
      dryRun: false,
      fieldPriorities: {
        title: { priority: ["eventbrite", "ticketleap", "furball"], merge: "clobber" },
        shortName: { priority: ["static"], merge: "upsert" },
        instagram: { priority: ["static"], merge: "clobber" },
        description: { priority: ["eventbrite", "ticketleap", "furball"], merge: "clobber" },
        bar: { priority: ["eventbrite", "ticketleap", "furball"], merge: "clobber" },
        address: { priority: ["eventbrite", "ticketleap", "furball"], merge: "clobber" },
        startDate: { priority: ["eventbrite", "ticketleap", "furball"], merge: "clobber" },
        endDate: { priority: ["eventbrite", "ticketleap", "furball"], merge: "clobber" },
        url: { priority: ["furball", "eventbrite", "ticketleap"], merge: "clobber" },
        location: { priority: ["eventbrite", "ticketleap", "furball"], merge: "clobber" },
        ticketUrl: { priority: ["eventbrite", "ticketleap", "linktree", "furball"], merge: "clobber" },
        gmaps: { priority: ["eventbrite", "ticketleap", "furball"], merge: "clobber" },
        image: { priority: ["eventbrite", "ticketleap", "furball"], merge: "clobber" },
        cover: { priority: ["eventbrite", "ticketleap", "furball"], merge: "clobber" }
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
        enabled: true,
        days: ["mon"],
        timeWindow: { startHour: 5, endHour: 6 }
      },
      urls: ["https://linktr.ee/cubhouse"],
      // parser: "linktree",    // Auto-detected from URL pattern
      alwaysBear: true,        // Cubhouse events are always bear events
      urlDiscoveryDepth: 2,    // Depth 2 to follow ticket links and their detail pages
      maxAdditionalUrls: 10,   // Limit additional URLs discovered
      dryRun: false,           // Override global dryRun if needed
      
      // Field priorities for merging data from different sources
      // Eventbrite takes priority for most fields since that's where the actual event data comes from
      fieldPriorities: {
        title: { priority: ["eventbrite", "linktree"], merge: "clobber" },
        shortName: { priority: ["static"], merge: "upsert" },
        instagram: { priority: ["static"], merge: "clobber" },
        description: { priority: ["eventbrite", "linktree"], merge: "clobber" },
        bar: { priority: ["eventbrite", "linktree"], merge: "clobber" },
        address: { priority: ["eventbrite", "linktree"], merge: "clobber" },
        startDate: { priority: ["eventbrite", "linktree"], merge: "clobber" },
        endDate: { priority: ["eventbrite", "linktree"], merge: "clobber" },
        url: { priority: ["static"], merge: "clobber" }, // Always use static Linktree URL
        location: { priority: ["eventbrite", "linktree"], merge: "clobber" },
        gmaps: { priority: ["eventbrite", "linktree"], merge: "clobber" },
        image: { priority: ["eventbrite", "linktree"], merge: "clobber" },
        cover: { priority: ["eventbrite", "linktree"], merge: "clobber" },
        ticketUrl: { priority: ["eventbrite", "linktree"], merge: "clobber" }
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
        enabled: true,
        days: ["mon"],
        timeWindow: { startHour: 6, endHour: 7 }
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
      enabled: true,
      automation: {
        enabled: true,
        days: ["wed"],
        timeWindow: { startHour: 4, endHour: 5 }
      },
      urls: ["https://www.eventbrite.com/o/nab-events-llc-51471535173"],
      alwaysBear: true,
      urlDiscoveryDepth: 0,
      maxAdditionalUrls: null,
      dryRun: false,
      fieldPriorities: {
        title: { priority: ["eventbrite"], merge: "clobber" },
        shortName: { priority: ["static"], merge: "upsert" },
        instagram: { priority: ["static"], merge: "clobber" },
        facebook: { priority: ["static"], merge: "clobber" },
        description: { priority: ["eventbrite"], merge: "clobber" },
        bar: { priority: ["eventbrite"], merge: "clobber" },
        address: { priority: ["eventbrite"], merge: "clobber" },
        startDate: { priority: ["eventbrite"], merge: "clobber" },
        endDate: { priority: ["eventbrite"], merge: "clobber" },
        url: { priority: ["eventbrite"], merge: "clobber" },
        location: { priority: ["eventbrite"], merge: "clobber" },
        gmaps: { priority: ["eventbrite"], merge: "clobber" },
        image: { priority: ["eventbrite"], merge: "clobber" },
        cover: { priority: ["eventbrite"], merge: "clobber" }
      },
      metadata: {
        shortName: { value: "TWIST-ED BEAR" },
        instagram: { value: "https://www.instagram.com/twistedbearparty" },
        facebook: { value: "https://www.facebook.com/twistedglobal/" }
      }
    },
    {
      name: "Dallas Eagle",
      enabled: false,
      automation: {
        enabled: false,
        days: ["fri"],
        timeWindow: { startHour: 5, endHour: 6 }
      },
      urls: ["https://www.eventbrite.com/o/77139864473"],
      alwaysBear: false,
      urlDiscoveryDepth: 0,
      maxAdditionalUrls: null,
      dryRun: false,
      fieldPriorities: {
        title: { priority: ["eventbrite"], merge: "clobber" },
        instagram: { priority: ["static"], merge: "clobber" },
        facebook: { priority: ["static"], merge: "clobber" },
        website: { priority: ["static"], merge: "clobber" },
        mastodon: { priority: ["static"], merge: "clobber" },
        description: { priority: ["eventbrite"], merge: "clobber" },
        bar: { priority: ["eventbrite"], merge: "clobber" },
        address: { priority: ["eventbrite"], merge: "clobber" },
        startDate: { priority: ["eventbrite"], merge: "clobber" },
        endDate: { priority: ["eventbrite"], merge: "clobber" },
        url: { priority: ["eventbrite"], merge: "clobber" },
        location: { priority: ["eventbrite"], merge: "clobber" },
        gmaps: { priority: ["eventbrite"], merge: "clobber" },
        image: { priority: ["eventbrite"], merge: "clobber" },
        cover: { priority: ["eventbrite"], merge: "clobber" }
      },
      metadata: {
        website: { value: "https://www.thedallaseagle.com" },
        facebook: { value: "https://www.facebook.com/lonestareagle" },
        instagram: { value: "https://www.instagram.com/thedallaseagle/" },
        mastodon: { value: "https://mastodon.social/@dallaseagle" }
      }
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

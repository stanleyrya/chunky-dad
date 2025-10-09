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
      urls: ["https://www.furball.nyc/ticket-information"],
      alwaysBear: true,
      urlDiscoveryDepth: 0,
      dryRun: false,
      fieldPriorities: {
        title: { priority: ["furball"], merge: "clobber" },
        shortName: { priority: ["static"], merge: "upsert" },
        instagram: { priority: ["static"], merge: "clobber" },
        description: { priority: ["furball"], merge: "clobber" },
        bar: { priority: ["furball"], merge: "clobber" },
        address: { priority: ["furball"], merge: "clobber" },
        startDate: { priority: ["furball"], merge: "clobber" },
        endDate: { priority: ["furball"], merge: "clobber" },
        url: { priority: ["furball"], merge: "clobber" },
        location: { priority: ["furball"], merge: "clobber" },
        ticketUrl: { priority: ["furball"], merge: "clobber" },
        gmaps: { priority: ["furball"], merge: "clobber" },
        image: { priority: ["furball"], merge: "clobber" },
        cover: { priority: ["furball"], merge: "clobber" }
      },
      metadata: {
        title: { value: "FURBALL" },
        shortName: { value: "FUR-BALL" },
        instagram: { value: "https://instagram.com/furballnyc/" }
      }
    },
    {
      name: "Bears Sitges Week",
      enabled: false,
      urls: ["https://bearssitges.org/bears-sitges-week/"],
      alwaysBear: true,
      urlDiscoveryDepth: 0,
      dryRun: false,
      maxDays: 1,  // Process 1 day to avoid memory issues
      allowPastEvents: true,  // TEMPORARY: Allow processing past events for testing
      fieldPriorities: {
        title: { priority: ["bears-sitges"], merge: "clobber" },
        instagram: { priority: ["static"], merge: "clobber" },
        description: { priority: ["bears-sitges"], merge: "clobber" },
        bar: { priority: ["bears-sitges"], merge: "clobber" },
        address: { priority: ["bears-sitges"], merge: "clobber" },
        startDate: { priority: ["bears-sitges"], merge: "clobber" },
        endDate: { priority: ["bears-sitges"], merge: "clobber" },
        url: { priority: ["bears-sitges"], merge: "clobber" },
        location: { priority: ["bears-sitges"], merge: "clobber" },
        gmaps: { priority: ["bears-sitges"], merge: "clobber" },
        image: { priority: ["bears-sitges"], merge: "clobber" },
        cover: { priority: ["bears-sitges"], merge: "clobber" }
      },
      metadata: {
        instagram: { value: "https://www.instagram.com/bearssitges" }
      }
    },
    {
      name: "Cubhouse",
      enabled: true,
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
      urls: ["https://www.redeyetickets.com/goldiloxx/"],
      alwaysBear: true,        // Goldiloxx is a bear party
      urlDiscoveryDepth: 0,    // No additional URL discovery needed for single event page
      dryRun: false,           // Override global dryRun if needed
      
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
        location: { priority: ["redeyetickets"], merge: "clobber" },
        gmaps: { priority: ["redeyetickets"], merge: "clobber" },
        image: { priority: ["redeyetickets"], merge: "clobber" },
        cover: { priority: ["redeyetickets"], merge: "clobber" },
        ticketUrl: { priority: ["redeyetickets"], merge: "clobber" }
      },
      
      // Static metadata to add to all Goldiloxx events
      metadata: {
        shortName: { value: "GOLDI-LOXX" },
        shorterName: { value: "GLX" },
        instagram: { value: "https://www.instagram.com/goldiloxx__" }
      }
    }
  ],
  // Centralized city configuration
  cities: {
    "nyc": {
      calendar: "chunky-dad-nyc",
      timezone: "America/New_York",
      patterns: ["new york", "nyc", "manhattan", "brooklyn", "queens", "bronx"]
    },
    "la": {
      calendar: "chunky-dad-la", 
      timezone: "America/Los_Angeles",
      patterns: ["los angeles", "hollywood", "west hollywood", "weho", "dtla", "downtown los angeles", "long beach", "santa monica"]
    },
    "sf": {
      calendar: "chunky-dad-sf",
      timezone: "America/Los_Angeles", 
      patterns: ["san francisco", "sf", "castro", "san jose", "oakland"]
    },
    "atlanta": {
      calendar: "chunky-dad-atlanta",
      timezone: "America/New_York",
      patterns: ["atlanta", "atl"]
    },
    "miami": {
      calendar: "chunky-dad-miami",
      timezone: "America/New_York",
      patterns: ["miami", "south beach", "miami beach", "fort lauderdale", "key west"]
    },
    "denver": {
      calendar: "chunky-dad-denver",
      timezone: "America/Denver",
      patterns: ["denver"]
    },
    "vegas": {
      calendar: "chunky-dad-vegas",
      timezone: "America/Los_Angeles",
      patterns: ["las vegas", "vegas"]
    },
    "palm-springs": {
      calendar: "chunky-dad-palm-springs",
      timezone: "America/Los_Angeles",
      patterns: ["palm springs"]
    },
    "sitges": {
      calendar: "chunky-dad-sitges",
      timezone: "Europe/Madrid",
      patterns: ["sitges"]
    },
    "seattle": {
      calendar: "chunky-dad-seattle",
      timezone: "America/Los_Angeles",
      patterns: ["seattle"]
    },
    "portland": {
      calendar: "chunky-dad-portland",
      timezone: "America/Los_Angeles",
      patterns: ["portland"]
    },
    "chicago": {
      calendar: "chunky-dad-chicago",
      timezone: "America/Chicago",
      patterns: ["chicago", "chi"]
    },
    "new-orleans": {
      calendar: "chunky-dad-new-orleans",
      timezone: "America/Chicago",
      patterns: ["new orleans"]
    },
    "boston": {
      calendar: "chunky-dad-boston",
      timezone: "America/New_York",
      patterns: ["boston", "boton", "bostom", "bostun", "bostan"]
    },
    "philadelphia": {
      calendar: "chunky-dad-philadelphia",
      timezone: "America/New_York",
      patterns: ["philadelphia", "philly"]
    },
    "austin": {
      calendar: "chunky-dad-austin",
      timezone: "America/Chicago",
      patterns: ["austin"]
    },
    "dallas": {
      calendar: "chunky-dad-dallas",
      timezone: "America/Chicago",
      patterns: ["dallas"]
    },
    "houston": {
      calendar: "chunky-dad-houston",
      timezone: "America/Chicago",
      patterns: ["houston"]
    },
    "phoenix": {
      calendar: "chunky-dad-phoenix",
      timezone: "America/Phoenix",
      patterns: ["phoenix"]
    },
    "san-diego": {
      calendar: "chunky-dad-san-diego",
      timezone: "America/Los_Angeles",
      patterns: ["san diego"]
    },
    "sacramento": {
      calendar: "chunky-dad-sacramento",
      timezone: "America/Los_Angeles",
      patterns: ["sacramento"]
    },
    "toronto": {
      calendar: "chunky-dad-toronto",
      timezone: "America/Toronto",
      patterns: ["toronto"]
    },
    "london": {
      calendar: "chunky-dad-london",
      timezone: "Europe/London",
      patterns: ["london"]
    },
    "berlin": {
      calendar: "chunky-dad-berlin",
      timezone: "Europe/Berlin",
      patterns: ["berlin"]
    }
  }
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

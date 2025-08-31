// Chunk Party Event Scraper Configuration
// This file contains the runtime configuration for scraping Chunk party events.
// 
// USAGE RESTRICTIONS:
// - This is a pure JavaScript configuration file
// - Must export a default configuration object
// - Can be imported in both Scriptable and web environments
// - Keep this file environment-agnostic (no Scriptable or DOM APIs)

const chunkScraperConfig = {
  config: {
    dryRun: false,           // Set to true to test without modifying calendars
    daysToLookAhead: null    // null = unlimited, or specify number of days
  },
  parsers: [
    {
      name: "Chunk Parties",
      enabled: true,
      urls: [
        "https://www.chunk-party.com",                                      // Main page with upcoming events
        "https://www.chunk-party.com/event-details/chunk-presents-folsom-25" // Example detail page
      ],
      alwaysBear: true,        // Chunk parties are always bear events
      urlDiscoveryDepth: 1,    // Depth 1 to find detail pages from main page
      maxAdditionalUrls: 20,   // Limit additional URLs discovered
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
        gmaps: { priority: ["chunk"], merge: "clobber" },
        image: { priority: ["chunk"], merge: "clobber" },
        cover: { priority: ["chunk"], merge: "clobber" },
        ticketUrl: { priority: ["chunk"], merge: "clobber" }
      },
      
      // Static metadata to add to all Chunk events
      metadata: {
        shortName: { value: "CHUNK" },
        instagram: { value: "https://www.instagram.com/chunkparty" },
        organizer: { value: "CHUNK" }
      }
    }
  ],
  
  // City configurations for calendar routing and timezone handling
  cities: {
    "sf": {
      calendar: "chunky-dad-sf",
      timezone: "America/Los_Angeles",
      patterns: ["san francisco", "sf", "folsom", "castro", "soma"]
    },
    "nyc": {
      calendar: "chunky-dad-nyc",
      timezone: "America/New_York",
      patterns: ["new york", "nyc", "manhattan", "brooklyn", "queens", "bronx", "hell's kitchen", "chelsea"]
    },
    "la": {
      calendar: "chunky-dad-la",
      timezone: "America/Los_Angeles",
      patterns: ["los angeles", "la", "hollywood", "west hollywood", "weho", "dtla", "downtown los angeles", "long beach", "santa monica", "silver lake"]
    },
    "chicago": {
      calendar: "chunky-dad-chicago",
      timezone: "America/Chicago",
      patterns: ["chicago", "chi", "boystown", "andersonville"]
    },
    "portland": {
      calendar: "chunky-dad-portland",
      timezone: "America/Los_Angeles",
      patterns: ["portland", "pdx"]
    },
    "seattle": {
      calendar: "chunky-dad-seattle",
      timezone: "America/Los_Angeles",
      patterns: ["seattle", "capitol hill"]
    },
    "denver": {
      calendar: "chunky-dad-denver",
      timezone: "America/Denver",
      patterns: ["denver", "rino"]
    },
    "atlanta": {
      calendar: "chunky-dad-atlanta",
      timezone: "America/New_York",
      patterns: ["atlanta", "atl", "midtown atlanta"]
    },
    "miami": {
      calendar: "chunky-dad-miami",
      timezone: "America/New_York",
      patterns: ["miami", "south beach", "miami beach", "wynwood"]
    },
    "boston": {
      calendar: "chunky-dad-boston",
      timezone: "America/New_York",
      patterns: ["boston", "cambridge", "somerville"]
    },
    "philadelphia": {
      calendar: "chunky-dad-philadelphia",
      timezone: "America/New_York",
      patterns: ["philadelphia", "philly"]
    },
    "austin": {
      calendar: "chunky-dad-austin",
      timezone: "America/Chicago",
      patterns: ["austin", "atx"]
    },
    "dallas": {
      calendar: "chunky-dad-dallas",
      timezone: "America/Chicago",
      patterns: ["dallas", "oak lawn"]
    },
    "houston": {
      calendar: "chunky-dad-houston",
      timezone: "America/Chicago",
      patterns: ["houston", "montrose"]
    },
    "phoenix": {
      calendar: "chunky-dad-phoenix",
      timezone: "America/Phoenix",
      patterns: ["phoenix", "scottsdale"]
    },
    "dc": {
      calendar: "chunky-dad-dc",
      timezone: "America/New_York",
      patterns: ["washington", "dc", "dupont circle"]
    },
    "orlando": {
      calendar: "chunky-dad-orlando",
      timezone: "America/New_York",
      patterns: ["orlando"]
    },
    "tampa": {
      calendar: "chunky-dad-tampa",
      timezone: "America/New_York",
      patterns: ["tampa", "ybor city"]
    },
    "vegas": {
      calendar: "chunky-dad-vegas",
      timezone: "America/Los_Angeles",
      patterns: ["vegas", "las vegas"]
    }
  }
};

// Export for different environments
// Scriptable environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = chunkScraperConfig;
}

// ES6 module environment
if (typeof window === 'undefined' && typeof importModule !== 'undefined') {
  // Scriptable environment - make available for importModule
  chunkScraperConfig;
} else if (typeof window !== 'undefined') {
  // Browser environment - attach to window
  window.chunkScraperConfig = chunkScraperConfig;
}

// Default export for ES6 modules
chunkScraperConfig;
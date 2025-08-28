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
      urlDiscoveryDepth: 1,
      maxAdditionalUrls: 20,
      dryRun: false,
      fieldPriorities: {
        title: { priority: ["static"], merge: "clobber" },
        shortName: { priority: ["static"], merge: "upsert" },
        instagram: { priority: ["static"], merge: "clobber" },
        description: { priority: ["eventbrite"], merge: "upsert" },
        bar: { priority: ["eventbrite"], merge: "preserve" },
        address: { priority: ["eventbrite"], merge: "upsert" },
        startDate: { priority: ["eventbrite"], merge: "clobber" },
        endDate: { priority: ["eventbrite"], merge: "clobber" },
        url: { priority: ["eventbrite"], merge: "clobber" },
        gmaps: { priority: ["eventbrite"], merge: "clobber" },
        image: { priority: ["eventbrite"], merge: "clobber" },
        cover: { priority: ["eventbrite"], merge: "preserve" }
      },
      metadata: {
        title: { value: "MEGAWOOF" },
        shortName: { value: "MEGA-WOOF" },
        instagram: { value: "https://www.instagram.com/megawoof_america" }
      }
    },
    {
      name: "Bear Happy Hour",
      enabled: false,
      urls: ["https://www.eventbrite.com/o/bear-happy-hour-87043830313"],
      alwaysBear: true,
      urlDiscoveryDepth: 1,
      dryRun: false,
      fieldPriorities: {
        title: { priority: ["eventbrite"], merge: "upsert" },
        shortName: { priority: ["static"], merge: "upsert" },
        instagram: { priority: ["static"], merge: "upsert" },
        description: { priority: ["eventbrite"], merge: "upsert" },
        bar: { priority: ["eventbrite"], merge: "clobber" },
        address: { priority: ["eventbrite"], merge: "upsert" },
        startDate: { priority: ["eventbrite"], merge: "clobber" },
        endDate: { priority: ["eventbrite"], merge: "clobber" },
        website: { priority: ["eventbrite"], merge: "clobber" },
        gmaps: { priority: ["eventbrite"], merge: "clobber" },
        image: { priority: ["eventbrite"], merge: "clobber" },
        cover: { priority: ["eventbrite"], merge: "clobber" }
      },
      metadata: {
        shortName: { value: "Coach After Dark" },
        instagram: { value: "https://www.instagram.com/coachafterdark" }
      }
    },
    {
      name: "Bearracuda Events",
      enabled: true,
      urls: [
        "https://bearracuda.com/"
      ],
      alwaysBear: true,
      urlDiscoveryDepth: 1,
      dryRun: false,
      keyTemplate: "bearracuda-${date}-${city}",
      fieldPriorities: {
        title: { priority: ["eventbrite", "bearracuda"], merge: "upsert" },
        shortName: { priority: ["bearracuda", "eventbrite"], merge: "upsert" },
        instagram: { priority: ["bearracuda", "eventbrite"], merge: "upsert" },
        description: { priority: ["eventbrite", "bearracuda"], merge: "upsert" },
        bar: { priority: ["eventbrite", "bearracuda"], merge: "clobber" },
        address: { priority: ["eventbrite", "bearracuda"], merge: "upsert" },
        startDate: { priority: ["eventbrite", "bearracuda"], merge: "clobber" },
        endDate: { priority: ["eventbrite", "bearracuda"], merge: "clobber" },
        website: { priority: ["eventbrite", "bearracuda"], merge: "clobber" },
        gmaps: { priority: ["eventbrite", "bearracuda"], merge: "clobber" },
        image: { priority: ["eventbrite", "bearracuda"], merge: "clobber" },
        cover: { priority: ["eventbrite"], merge: "clobber" },
        facebook: { priority: ["bearracuda", "eventbrite"], merge: "upsert" },
        ticketUrl: { priority: ["bearracuda", "eventbrite"], merge: "upsert" },
        key: { priority: ["bearracuda", "eventbrite"], merge: "clobber" }
      },
      metadata: {
        shortName: { value: "Bear-rac-uda" },
        instagram: { value: "https://www.instagram.com/bearracuda" }
      }
    },
    {
      name: "Bearracuda Eventbrite",
      enabled: true,
      urls: ["https://www.eventbrite.com/o/bearracuda-21867032189"],
      alwaysBear: true,
      urlDiscoveryDepth: 1,
      dryRun: false,
      keyTemplate: "bearracuda-${date}-${city}",
      fieldPriorities: {
        title: { priority: ["eventbrite"], merge: "upsert" },
        shortName: { priority: ["bearracuda", "eventbrite"], merge: "upsert" },
        instagram: { priority: ["bearracuda", "eventbrite"], merge: "upsert" },
        description: { priority: ["eventbrite"], merge: "upsert" },
        bar: { priority: ["eventbrite"], merge: "clobber" },
        address: { priority: ["eventbrite"], merge: "upsert" },
        startDate: { priority: ["eventbrite"], merge: "clobber" },
        endDate: { priority: ["eventbrite"], merge: "clobber" },
        website: { priority: ["eventbrite"], merge: "clobber" },
        gmaps: { priority: ["eventbrite"], merge: "clobber" },
        image: { priority: ["eventbrite"], merge: "clobber" },
        cover: { priority: ["eventbrite"], merge: "clobber" },
        facebook: { priority: ["bearracuda", "eventbrite"], merge: "upsert" },
        ticketUrl: { priority: ["bearracuda", "eventbrite"], merge: "upsert" },
        key: { priority: ["bearracuda", "eventbrite"], merge: "clobber" }
      },
      metadata: {
        shortName: { value: "Bear-rac-uda" },
        instagram: { value: "https://www.instagram.com/bearracuda" }
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
      patterns: ["boston"]
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
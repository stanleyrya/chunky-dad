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
    dryRun: true,
    daysToLookAhead: null
  },
  parsers: [
    {
      name: "Megawoof America",
      parser: "eventbrite",
      enabled: false,
      urls: ["https://www.eventbrite.com/o/megawoof-america-18118978189"],
      alwaysBear: true,
      requireDetailPages: true,
      maxAdditionalUrls: 20,
      urlDiscoveryDepth: 1,
      dryRun: true,
      daysToLookAhead: null,
      mergeMode: "upsert",
      urlFilters: {
        include: ["eventbrite\\.com\\/e\\/"]
      },
      metadata: {
        title: {
          value: "MEGAWOOF",
          merge: "clobber"
        },
        shortName: {
          value: "MEGA-WOOF",
          merge: "upsert"
        },
        instagram: {
          value: "https://www.instagram.com/megawoof_america",
          merge: "clobber"
        },
        description: {
          merge: "upsert"
        },
        bar: {
          merge: "clobber"
        },
        address: {
          merge: "clobber"
        },
        startDate: {
          merge: "clobber"
        },
        endDate: {
          merge: "clobber"
        },
        website: {
          merge: "clobber"
        },
        gmaps: {
          merge: "clobber"
        },
        image: {
          merge: "clobber"
        },
        cover: {
          merge: "clobber"
        }
      }
    },
    {
      name: "Bear Happy Hour",
      parser: "eventbrite",
      enabled: false,
      urls: ["https://www.eventbrite.com/o/bear-happy-hour-87043830313"],
      alwaysBear: true,
      requireDetailPages: true,
      maxAdditionalUrls: 20,
      urlDiscoveryDepth: 1,
      dryRun: true,
      daysToLookAhead: null,
      mergeMode: "upsert",
      urlFilters: {
        include: ["eventbrite\\.com\\/e\\/"]
      },
      metadata: {
        title: {
          merge: "upsert"
        },
        shortName: {
          value: "Coach After Dark",
          merge: "upsert"
        },
        instagram: {
          value: "https://www.instagram.com/coachafterdark",
          merge: "upsert"
        },
        description: {
          merge: "upsert"
        },
        bar: {
          merge: "clobber"
        },
        address: {
          merge: "clobber"
        },
        startDate: {
          merge: "clobber"
        },
        endDate: {
          merge: "clobber"
        },
        website: {
          merge: "clobber"
        },
        gmaps: {
          merge: "clobber"
        },
        image: {
          merge: "clobber"
        },
        cover: {
          merge: "clobber"
        }
      }
    },
    {
      name: "Bearracuda Events",
      parser: "bearracuda",
      enabled: true,
      urls: [
        "https://bearracuda.com/"
      ],
      alwaysBear: true,
      requireDetailPages: true,
      maxAdditionalUrls: 20,
      urlDiscoveryDepth: 1,
      dryRun: true,
      daysToLookAhead: null,
      mergeMode: "upsert",
      urlFilters: {
        include: ["bearracuda\\.com\\/events\\/"]
      },
      keyTemplate: "bearracuda-${date}-${city}",
      metadata: {
        title: {
          merge: "upsert"
        },
        shortName: {
          value: "Bear-rac-uda",
          merge: "upsert"
        },
        instagram: {
          value: "https://www.instagram.com/bearracuda",
          merge: "upsert"
        },
        description: {
          merge: "upsert"
        },
        bar: {
          merge: "clobber"
        },
        address: {
          merge: "clobber"
        },
        startDate: {
          merge: "clobber"
        },
        endDate: {
          merge: "clobber"
        },
        website: {
          merge: "clobber"
        },
        gmaps: {
          merge: "clobber"
        },
        image: {
          merge: "clobber"
        },
        cover: {
          merge: "clobber"
        },
        key: {
          merge: "clobber"
        }
      }
    },
    {
      name: "Bearracuda Eventbrite",
      parser: "eventbrite",
      enabled: true,
      urls: ["https://www.eventbrite.com/o/bearracuda-21867032189"],
      alwaysBear: true,
      requireDetailPages: true,
      maxAdditionalUrls: 20,
      urlDiscoveryDepth: 1,
      dryRun: true,
      daysToLookAhead: null,
      mergeMode: "upsert",
      urlFilters: {
        include: ["eventbrite\\.com\\/e\\/"]
      },
      keyTemplate: "bearracuda-${date}-${city}",
      metadata: {
        title: {
          merge: "upsert"
        },
        shortName: {
          value: "Bear-rac-uda",
          merge: "upsert"
        },
        instagram: {
          value: "https://www.instagram.com/bearracuda",
          merge: "upsert"
        },
        description: {
          merge: "upsert"
        },
        bar: {
          merge: "clobber"
        },
        address: {
          merge: "clobber"
        },
        startDate: {
          merge: "clobber"
        },
        endDate: {
          merge: "clobber"
        },
        website: {
          merge: "clobber"
        },
        gmaps: {
          merge: "clobber"
        },
        image: {
          merge: "clobber"
        },
        cover: {
          merge: "clobber"
        },
        key: {
          merge: "clobber"
        }
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
  },
  
  // Legacy calendar mappings for backward compatibility
  calendarMappings: {
    "nyc": "chunky-dad-nyc",
    "la": "chunky-dad-la",
    "sf": "chunky-dad-sf",
    "atlanta": "chunky-dad-atlanta",
    "miami": "chunky-dad-miami",
    "denver": "chunky-dad-denver",
    "vegas": "chunky-dad-vegas",
    "palm-springs": "chunky-dad-palm-springs",
    "sitges": "chunky-dad-sitges",
    "seattle": "chunky-dad-seattle",
    "portland": "chunky-dad-portland",
    "chicago": "chunky-dad-chicago",
    "new-orleans": "chunky-dad-new-orleans",
    "boston": "chunky-dad-boston",
    "philadelphia": "chunky-dad-philadelphia",
    "austin": "chunky-dad-austin",
    "dallas": "chunky-dad-dallas",
    "houston": "chunky-dad-houston",
    "phoenix": "chunky-dad-phoenix",
    "san-diego": "chunky-dad-san-diego",
    "sacramento": "chunky-dad-sacramento",
    "toronto": "chunky-dad-toronto",
    "london": "chunky-dad-london",
    "berlin": "chunky-dad-berlin",
    "default": "chunky-dad-events"
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
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
  },
  
  // City mapping patterns for consistent location detection (consolidated from shared-core)
  cityMappings: {
    'new york|nyc|manhattan|brooklyn|queens|bronx': 'nyc',
    'los angeles|hollywood|west hollywood|weho|dtla|downtown los angeles': 'la',
    'san francisco|sf|castro': 'sf',
    'chicago|chi': 'chicago',
    'atlanta|atl': 'atlanta',
    'miami|south beach|miami beach': 'miami',
    'seattle': 'seattle',
    'portland': 'portland',
    'denver': 'denver',
    'las vegas|vegas': 'vegas',
    'boston': 'boston',
    'philadelphia|philly': 'philadelphia',
    'austin': 'austin',
    'dallas': 'dallas',
    'houston': 'houston',
    'phoenix': 'phoenix',
    'long beach': 'la',
    'santa monica': 'la',
    'palm springs': 'palm-springs',
    'sitges': 'sitges',
    'san diego': 'san-diego',
    'sacramento': 'sacramento',
    'san jose': 'sf',
    'oakland': 'sf',
    'fort lauderdale': 'miami',
    'key west': 'miami',
    'toronto': 'toronto',
    'london': 'london',
    'berlin': 'berlin'
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
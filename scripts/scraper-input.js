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
  
  // City configuration data - consolidated from js/city-config.js
  cities: {
    'new-york': { name: 'New York', emoji: '🗽', tagline: 'What\'s the bear 411?', calendarId: '128e456dab59e8db2466c6eecd151decd20315e7d6b1058f063aa1fea610eeb1@group.calendar.google.com', coordinates: { lat: 40.7831, lng: -73.9712 }, mapZoom: 10, visible: true },
    'seattle': { name: 'Seattle', emoji: '🌲', tagline: 'Emerald City bears unite!', calendarId: '57d74fed7a20f9bb98d918650caeecf1cb664d7f508ff965126b5e54e28b527f@group.calendar.google.com', coordinates: { lat: 47.6062, lng: -122.3321 }, mapZoom: 10, visible: true },
    'los-angeles': { name: 'Los Angeles', emoji: '🌴', tagline: 'West Coast bear vibes', calendarId: '4b97d66d56b8bc0cf6a667f5b11879fbfe4a17e671055772e9849a68e905923f@group.calendar.google.com', coordinates: { lat: 34.0522, lng: -118.2437 }, mapZoom: 10, visible: true },
    'toronto': { name: 'Toronto', emoji: '🍁', tagline: 'Great White North bears', calendarId: '05d2674eb64cd2aaefbf8b2832d4301eaae46b29ee9c63a0294a64199c0bc228@group.calendar.google.com', coordinates: { lat: 43.6532, lng: -79.3832 }, mapZoom: 10, visible: true },
    'london': { name: 'London', emoji: '🇬🇧', tagline: 'British bears welcome', calendarId: '665e9d4b3db568b67b15b7a7a256a9dfe5aa538ca6efec9eceeab4fb8fa1139a@group.calendar.google.com', coordinates: { lat: 51.5074, lng: -0.1278 }, mapZoom: 10, visible: true },
    'chicago': { name: 'Chicago', emoji: '🏙️', tagline: 'Windy City bears', calendarId: '5b9e403fecaf30c69fb1715ee79d893cc1e653ac8cc9386656bca1cea510e6d6@group.calendar.google.com', coordinates: { lat: 41.8781, lng: -87.6298 }, mapZoom: 10, visible: true },
    'berlin': { name: 'Berlin', emoji: '🇩🇪', tagline: 'European bear capital', calendarId: 'c4ced7d335c727f9852627373d28252b5ad58f58dee5d21a9526b89814b84e60@group.calendar.google.com', coordinates: { lat: 52.5200, lng: 13.4050 }, mapZoom: 10, visible: true },
    'palm-springs': { name: 'Palm Springs', emoji: '🌴', tagline: 'Desert bear oasis', calendarId: '80d296cd29b21c9b88e6b01123d2f9bd9c1776b702a51cc7a60767e44f177e7b@group.calendar.google.com', coordinates: { lat: 33.8303, lng: -116.5453 }, mapZoom: 10, visible: true },
    'denver': { name: 'Denver', emoji: '🏔️', tagline: 'Mile High bears', calendarId: 'f3307ec83ddf4121f09dfa98258a6c1d5dd8ed2de085229f37cb872ef8618b21@group.calendar.google.com', coordinates: { lat: 39.7392, lng: -104.9903 }, mapZoom: 10, visible: true },
    'vegas': { name: 'Las Vegas', emoji: '🎰', tagline: 'Sin City bears', calendarId: '20f1119eed191bee892ccf0410942cc2e78382997086e0124683c4f2542fabff@group.calendar.google.com', coordinates: { lat: 36.1699, lng: -115.1398 }, mapZoom: 10, visible: true },
    'atlanta': { name: 'Atlanta', emoji: '🍑', tagline: 'Southern bear hospitality', calendarId: '98595c7c2e4db0e6fa1384cf3184e0fb302b5a9886499f3a222f19e5004800bc@group.calendar.google.com', coordinates: { lat: 33.7490, lng: -84.3880 }, mapZoom: 10, visible: true },
    'new-orleans': { name: 'New Orleans', emoji: '🎷', tagline: 'Big Easy bears', calendarId: '8bf2d8417df78aa8b7f852e5a0a301d1ea3cef7547bd5d8b638bdfe61c8dd3e9@group.calendar.google.com', coordinates: { lat: 29.9511, lng: -90.0715 }, mapZoom: 10, visible: true },
    'sf': { name: 'San Francisco', emoji: '🌉', tagline: 'Golden Gate bears', calendarId: '2f2e6cde722236a41a43325818baaa3775288bd2b4796a98b943e158bf62eb81@group.calendar.google.com', coordinates: { lat: 37.7749, lng: -122.4194 }, mapZoom: 10, visible: true },
    'portland': { name: 'Portland', emoji: '🌲', tagline: 'Keep Portland beary', calendarId: '53033822a075eb914e2958dfa7aea363aac4084d29043bc5490761cbf8bf08dd@group.calendar.google.com', coordinates: { lat: 45.5152, lng: -122.6784 }, mapZoom: 10, visible: true },
    'sitges': { name: 'Sitges', emoji: '🏖️', tagline: 'Mediterranean bear paradise', calendarId: 'b06b7387f73b91fad4d0dd4bd4413acd62424356482d7e59092d4a61c5803088@group.calendar.google.com', coordinates: { lat: 41.2379, lng: 1.8057 }, mapZoom: 10, visible: true }
  },
  
  // City mapping patterns for consistent location detection
  cityMappings: {
    'new york|nyc|manhattan|brooklyn|queens|bronx': 'nyc',
    'los angeles|hollywood|west hollywood|weho|dtla|downtown los angeles': 'la',
    'san francisco|sf|castro': 'sf',
    'chicago|chi': 'chicago',
    'atlanta|atl': 'atlanta',
    'miami|south beach': 'miami',
    'denver|boulder': 'denver',
    'vegas|las vegas|sin city': 'vegas',
    'seattle|emerald city': 'seattle',
    'portland|pdx': 'portland',
    'boston|beantown': 'boston',
    'philadelphia|philly': 'philadelphia',
    'washington|dc|washington dc': 'dc',
    'austin|atx': 'austin',
    'dallas|dfw': 'dallas',
    'houston|htx': 'houston',
    'phoenix|phx': 'phoenix',
    'san diego|sd': 'san-diego',
    'sacramento|sac': 'sacramento',
    'toronto|to': 'toronto',
    'london|uk': 'london',
    'berlin|deutschland': 'berlin',
    'palm springs|desert': 'palm-springs',
    'new orleans|nola|big easy': 'new-orleans',
    'sitges|catalunya': 'sitges',
    'orlando|orl': 'orlando',
    'tampa|tpa': 'tampa'
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
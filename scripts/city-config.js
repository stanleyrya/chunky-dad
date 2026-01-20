// City Configuration for Scriptable/Web Scraper
// Pure configuration data (no environment APIs)

const SCRAPER_CITY_CONFIG = {
  "new-york": {
    calendar: "chunky-dad-nyc",
    timezone: "America/New_York",
    patterns: ["new york", "nyc", "manhattan", "brooklyn", "queens", "bronx"]
  },
  "los-angeles": {
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
  "dc": {
    calendar: "chunky-dad-dc",
    timezone: "America/New_York",
    patterns: ["dc", "washington, dc", "washington dc", "district of columbia"]
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
};

// Export for different environments
if (typeof module !== "undefined" && module.exports) {
  module.exports = SCRAPER_CITY_CONFIG;
}

if (typeof window !== "undefined") {
  window.scraperCityConfig = SCRAPER_CITY_CONFIG;
}

// Scriptable importModule compatibility
SCRAPER_CITY_CONFIG;

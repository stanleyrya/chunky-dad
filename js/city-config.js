// City Configuration - Maps cities to their data and calendar IDs
// Scraper config lives alongside city fields (calendar/timezone/patterns) and is used to generate scripts/scraper-cities.js.
const CITY_CONFIG = {
    'nyc': {
        name: 'New York',
        emoji: '🗽',
        tagline: 'What\'s the bear 411?',
        aliases: ['new-york'],
        calendarId: '128e456dab59e8db2466c6eecd151decd20315e7d6b1058f063aa1fea610eeb1@group.calendar.google.com',
        calendar: 'chunky-dad-nyc',
        timezone: 'America/New_York',
        patterns: ['new york', 'nyc', 'manhattan', 'brooklyn', 'queens', 'bronx'],
        coordinates: { lat: 40.7831, lng: -73.9712 },
        mapZoom: 10,
        visible: true
    },
    'seattle': {
        name: 'Seattle',
        emoji: '🌲',
        tagline: 'Emerald City bears unite!',
        calendarId: '57d74fed7a20f9bb98d918650caeecf1cb664d7f508ff965126b5e54e28b527f@group.calendar.google.com',
        calendar: 'chunky-dad-seattle',
        timezone: 'America/Los_Angeles',
        patterns: ['seattle'],
        coordinates: { lat: 47.6062, lng: -122.3321 },
        mapZoom: 10,
        visible: true
    },
    'la': {
        name: 'Los Angeles',
        emoji: '☀️',
        tagline: 'West Coast bear vibes',
        aliases: ['los-angeles'],
        calendarId: '4b97d66d56b8bc0cf6a667f5b11879fbfe4a17e671055772e9849a68e905923f@group.calendar.google.com',
        calendar: 'chunky-dad-la',
        timezone: 'America/Los_Angeles',
        patterns: ['los angeles', 'hollywood', 'west hollywood', 'weho', 'dtla', 'downtown los angeles', 'long beach', 'santa monica', 'd>u>r>o'],
        coordinates: { lat: 34.0522, lng: -118.2437 },
        mapZoom: 10,
        visible: true
    },
    'toronto': {
        name: 'Toronto',
        emoji: '🍁',
        tagline: 'Great White North bears',
        calendarId: '05d2674eb64cd2aaefbf8b2832d4301eaae46b29ee9c63a0294a64199c0bc228@group.calendar.google.com',
        calendar: 'chunky-dad-toronto',
        timezone: 'America/Toronto',
        patterns: ['toronto'],
        coordinates: { lat: 43.6532, lng: -79.3832 },
        mapZoom: 10,
        visible: true
    },
    'london': {
        name: 'London',
        emoji: '🇬🇧',
        tagline: 'British bears welcome',
        calendarId: '665e9d4b3db568b67b15b7a7a256a9dfe5aa538ca6efec9eceeab4fb8fa1139a@group.calendar.google.com',
        calendar: 'chunky-dad-london',
        timezone: 'Europe/London',
        patterns: ['london'],
        coordinates: { lat: 51.5074, lng: -0.1278 },
        mapZoom: 10,
        visible: true
    },
    'chicago': {
        name: 'Chicago',
        emoji: '💨',
        tagline: 'Windy City bears',
        calendarId: '5b9e403fecaf30c69fb1715ee79d893cc1e653ac8cc9386656bca1cea510e6d6@group.calendar.google.com',
        calendar: 'chunky-dad-chicago',
        timezone: 'America/Chicago',
        patterns: ['chicago', 'chi'],
        coordinates: { lat: 41.8781, lng: -87.6298 },
        mapZoom: 10,
        visible: true
    },
    'berlin': {
        name: 'Berlin',
        emoji: '🇩🇪',
        tagline: 'European bear capital',
        calendarId: 'c4ced7d335c727f9852627373d28252b5ad58f58dee5d21a9526b89814b84e60@group.calendar.google.com',
        calendar: 'chunky-dad-berlin',
        timezone: 'Europe/Berlin',
        patterns: ['berlin'],
        coordinates: { lat: 52.5200, lng: 13.4050 },
        mapZoom: 10,
        visible: true
    },
    'palm-springs': {
        name: 'Palm Springs',
        emoji: '🌴',
        tagline: 'Desert bear oasis',
        calendarId: '80d296cd29b21c9b88e6b01123d2f9bd9c1776b702a51cc7a60767e44f177e7b@group.calendar.google.com',
        calendar: 'chunky-dad-palm-springs',
        timezone: 'America/Los_Angeles',
        patterns: ['palm springs'],
        coordinates: { lat: 33.8303, lng: -116.5453 },
        mapZoom: 10,
        visible: true
    },
    'denver': {
        name: 'Denver',
        emoji: '🏔️',
        tagline: 'Mile High bears',
        calendarId: 'f3307ec83ddf4121f09dfa98258a6c1d5dd8ed2de085229f37cb872ef8618b21@group.calendar.google.com',
        calendar: 'chunky-dad-denver',
        timezone: 'America/Denver',
        patterns: ['denver'],
        coordinates: { lat: 39.7392, lng: -104.9903 },
        mapZoom: 10,
        visible: true
    },
    'dallas': {
        name: 'Dallas',
        emoji: '🤠',
        tagline: 'Lone Star bears',
        calendarId: 'ed9a243b491c0017e3076aee250a4a5ca7a5abe8abcd688aea8ada3bf80ed5fc@group.calendar.google.com',
        calendar: 'chunky-dad-dallas',
        timezone: 'America/Chicago',
        patterns: ['dallas'],
        coordinates: { lat: 32.7767, lng: -96.7970 },
        mapZoom: 10,
        visible: true
    },
    'dc': {
        name: 'DC',
        emoji: '🏛️',
        tagline: 'Capital bears unite',
        calendarId: '8ef7301344feb8234b7ea704ac66f9dc627dae5452e410206f356618cc7a81c7@group.calendar.google.com',
        calendar: 'chunky-dad-dc',
        timezone: 'America/New_York',
        patterns: ['dc', 'washington, dc', 'washington dc', 'district of columbia'],
        coordinates: { lat: 38.9072, lng: -77.0369 },
        mapZoom: 10,
        visible: true
    },
    'vegas': {
        name: 'Las Vegas',
        emoji: '🎰',
        tagline: 'Sin City bears',
        calendarId: '20f1119eed191bee892ccf0410942cc2e78382997086e0124683c4f2542fabff@group.calendar.google.com',
        calendar: 'chunky-dad-vegas',
        timezone: 'America/Los_Angeles',
        patterns: ['las vegas', 'vegas'],
        coordinates: { lat: 36.1699, lng: -115.1398 },
        mapZoom: 10,
        visible: true
    },
    'atlanta': {
        name: 'Atlanta',
        emoji: '🍑',
        tagline: 'Southern bear hospitality',
        calendarId: '98595c7c2e4db0e6fa1384cf3184e0fb302b5a9886499f3a222f19e5004800bc@group.calendar.google.com',
        calendar: 'chunky-dad-atlanta',
        timezone: 'America/New_York',
        patterns: ['atlanta', 'atl'],
        coordinates: { lat: 33.7490, lng: -84.3880 },
        mapZoom: 10,
        visible: true
    },
    'nola': {
        name: 'New Orleans',
        emoji: '🎷',
        tagline: 'Big Easy bears',
        aliases: ['new-orleans'],
        calendarId: '8bf2d8417df78aa8b7f852e5a0a301d1ea3cef7547bd5d8b638bdfe61c8dd3e9@group.calendar.google.com',
        calendar: 'chunky-dad-new-orleans',
        timezone: 'America/Chicago',
        patterns: ['new orleans'],
        coordinates: { lat: 29.9511, lng: -90.0715 },
        mapZoom: 10,
        visible: true
    },
    'sf': {
        name: 'San Francisco',
        emoji: '🌉',
        tagline: 'Golden Gate bears',
        calendarId: '2f2e6cde722236a41a43325818baaa3775288bd2b4796a98b943e158bf62eb81@group.calendar.google.com',
        calendar: 'chunky-dad-sf',
        timezone: 'America/Los_Angeles',
        patterns: ['san francisco', 'sf', 'castro', 'san jose', 'oakland'],
        coordinates: { lat: 37.7749, lng: -122.4194 },
        mapZoom: 10,
        visible: true
    },
    'portland': {
        name: 'Portland',
        emoji: '🌹',
        tagline: 'Keep Portland beary',
        calendarId: '53033822a075eb914e2958dfa7aea363aac4084d29043bc5490761cbf8bf08dd@group.calendar.google.com',
        calendar: 'chunky-dad-portland',
        timezone: 'America/Los_Angeles',
        patterns: ['portland'],
        coordinates: { lat: 45.5152, lng: -122.6784 },
        mapZoom: 10,
        visible: true
    },
    'sitges': {
        name: 'Sitges',
        emoji: '🏖️',
        tagline: 'Mediterranean bear paradise',
        calendarId: 'b06b7387f73b91fad4d0dd4bd4413acd62424356482d7e59092d4a61c5803088@group.calendar.google.com',
        calendar: 'chunky-dad-sitges',
        timezone: 'Europe/Madrid',
        patterns: ['sitges'],
        coordinates: { lat: 41.2379, lng: 1.8057 },
        mapZoom: 10,
        visible: true
    },
    'boston': {
        name: 'Boston',
        emoji: '🎓',
        tagline: 'Beantown bears',
        calendarId: '88700f4c5744ed3c069399d8e3e8dbcae27bb7034049171718c0bcba2e4d5f09@group.calendar.google.com',
        calendar: 'chunky-dad-boston',
        timezone: 'America/New_York',
        patterns: ['boston', 'boton', 'bostom', 'bostun', 'bostan'],
        coordinates: { lat: 42.3601, lng: -71.0589 },
        mapZoom: 10,
        visible: true
    },
    'phoenix': {
        name: 'Phoenix',
        emoji: '🌵',
        tagline: 'Desert bear heat',
        calendarId: '7293db43546e6b7dd38620d8d078258480694866435de62f28272ea0527e922e@group.calendar.google.com',
        calendar: 'chunky-dad-phoenix',
        timezone: 'America/Phoenix',
        patterns: ['phoenix'],
        coordinates: { lat: 33.4484, lng: -112.0740 },
        mapZoom: 10,
        visible: true
    },
    'ptown': {
        name: 'Provincetown',
        emoji: '⚓',
        tagline: 'Cape Cod bear paradise',
        aliases: ['provincetown'],
        calendarId: '3b7c4ed1606370c70125e378cb3435fe8ab168161593b0f7dd3112ae56bc4db9@group.calendar.google.com',
        coordinates: { lat: 42.0526, lng: -70.1865 },
        mapZoom: 12,
        visible: true
    },
    'san-diego': {
        name: 'San Diego',
        emoji: '🌊',
        tagline: 'SoCal bear vibes',
        calendarId: '49674e3c4b41bb7164b4455db26b589e7b6dfaf66cf5bc32650a3deae1055237@group.calendar.google.com',
        calendar: 'chunky-dad-san-diego',
        timezone: 'America/Los_Angeles',
        patterns: ['san diego'],
        coordinates: { lat: 32.7157, lng: -117.1611 },
        mapZoom: 10,
        visible: true
    },
    'philly': {
        name: 'Philadelphia',
        emoji: '🔔',
        tagline: 'City of Brotherly Love bears',
        aliases: ['philadelphia'],
        calendarId: '63b74fff1a9f872730ed4d49bbd60bba3e1faa73778636944687f5949d8a435d@group.calendar.google.com',
        calendar: 'chunky-dad-philadelphia',
        timezone: 'America/New_York',
        patterns: ['philadelphia', 'philly'],
        coordinates: { lat: 39.9526, lng: -75.1652 },
        mapZoom: 10,
        visible: true
    },
    'miami': {
        name: 'Miami',
        emoji: '🌴',
        tagline: 'Miami bear heat',
        calendarId: null,
        calendar: 'chunky-dad-miami',
        timezone: 'America/New_York',
        patterns: ['miami', 'south beach', 'miami beach', 'fort lauderdale', 'key west'],
        coordinates: { lat: 25.7617, lng: -80.1918 },
        mapZoom: 10,
        visible: false
    },
    'puerto-vallarta': {
        name: 'Puerto Vallarta',
        emoji: '🏝️',
        tagline: 'Pacific coast bear getaway',
        aliases: ['puerto-vallarta'],
        calendarId: null,
        calendar: 'chunky-dad-puerto-vallarta',
        timezone: 'America/Mexico_City',
        patterns: ['puerto vallarta', 'vallarta'],
        coordinates: { lat: 20.6534, lng: -105.2253 },
        mapZoom: 11,
        visible: false
    },
    'austin': {
        name: 'Austin',
        emoji: '🎸',
        tagline: 'Austin bear scene',
        calendarId: null,
        calendar: 'chunky-dad-austin',
        timezone: 'America/Chicago',
        patterns: ['austin'],
        coordinates: { lat: 30.2672, lng: -97.7431 },
        mapZoom: 10,
        visible: false
    },
    'houston': {
        name: 'Houston',
        emoji: '🚀',
        tagline: 'Houston bear scene',
        calendarId: null,
        calendar: 'chunky-dad-houston',
        timezone: 'America/Chicago',
        patterns: ['houston'],
        coordinates: { lat: 29.7604, lng: -95.3698 },
        mapZoom: 10,
        visible: false
    },
    'sacramento': {
        name: 'Sacramento',
        emoji: '🌳',
        tagline: 'Sacramento bear scene',
        calendarId: null,
        calendar: 'chunky-dad-sacramento',
        timezone: 'America/Los_Angeles',
        patterns: ['sacramento'],
        coordinates: { lat: 38.5816, lng: -121.4944 },
        mapZoom: 10,
        visible: false
    }
};

// Helper function to get city config
function getCityConfig(cityKey) {
    return CITY_CONFIG[cityKey] || null;
}

// Helper function to get all available cities
function getAvailableCities() {
    return Object.keys(CITY_CONFIG)
        .map(key => ({
            key,
            ...CITY_CONFIG[key]
        }))
        .filter(city => city.visible !== false);
}

// Check if city has calendar configured
function hasCityCalendar(cityKey) {
    const config = getCityConfig(cityKey);
    return config && config.calendarId;
}


// Make functions globally available for browser use
if (typeof window !== 'undefined') {
  window.CITY_CONFIG = CITY_CONFIG;
  window.getCityConfig = getCityConfig;
  window.getAvailableCities = getAvailableCities;
  window.hasCityCalendar = hasCityCalendar;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CITY_CONFIG,
        getCityConfig,
        getAvailableCities,
        hasCityCalendar
    };
}
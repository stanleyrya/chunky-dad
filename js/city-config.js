// City Configuration - Maps cities to their data and calendar IDs
const CITY_CONFIG = {
    'new-york': {
        name: 'New York',
        emoji: '🗽',
        tagline: 'What\'s the bear 411?',
        calendarId: '128e456dab59e8db2466c6eecd151decd20315e7d6b1058f063aa1fea610eeb1@group.calendar.google.com',
        coordinates: { lat: 40.7831, lng: -73.9712 },
        mapZoom: 10,
        visible: true
    },
    'seattle': {
        name: 'Seattle',
        emoji: '🌲',
        tagline: 'Emerald City bears unite!',
        calendarId: '57d74fed7a20f9bb98d918650caeecf1cb664d7f508ff965126b5e54e28b527f@group.calendar.google.com',
        coordinates: { lat: 47.6062, lng: -122.3321 },
        mapZoom: 10,
        visible: true
    },
    'los-angeles': {
        name: 'Los Angeles', 
        emoji: '🌴',
        tagline: 'West Coast bear vibes',
        calendarId: '4b97d66d56b8bc0cf6a667f5b11879fbfe4a17e671055772e9849a68e905923f@group.calendar.google.com',
        coordinates: { lat: 34.0522, lng: -118.2437 },
        mapZoom: 10,
        visible: true
    },
    'toronto': {
        name: 'Toronto',
        emoji: '🍁',
        tagline: 'Great White North bears',
        calendarId: '05d2674eb64cd2aaefbf8b2832d4301eaae46b29ee9c63a0294a64199c0bc228@group.calendar.google.com',
        coordinates: { lat: 43.6532, lng: -79.3832 },
        mapZoom: 10,
        visible: true
    },
    'london': {
        name: 'London',
        emoji: '🇬🇧',
        tagline: 'British bears welcome',
        calendarId: '665e9d4b3db568b67b15b7a7a256a9dfe5aa538ca6efec9eceeab4fb8fa1139a@group.calendar.google.com',
        coordinates: { lat: 51.5074, lng: -0.1278 },
        mapZoom: 10,
        visible: true
    },
    'chicago': {
        name: 'Chicago',
        emoji: '🏙️',
        tagline: 'Windy City bears',
        calendarId: '5b9e403fecaf30c69fb1715ee79d893cc1e653ac8cc9386656bca1cea510e6d6@group.calendar.google.com',
        coordinates: { lat: 41.8781, lng: -87.6298 },
        mapZoom: 10,
        visible: true
    },
    'berlin': {
        name: 'Berlin',
        emoji: '🇩🇪',
        tagline: 'European bear capital',
        calendarId: 'c4ced7d335c727f9852627373d28252b5ad58f58dee5d21a9526b89814b84e60@group.calendar.google.com',
        coordinates: { lat: 52.5200, lng: 13.4050 },
        mapZoom: 10,
        visible: true
    },
    'palm-springs': {
        name: 'Palm Springs',
        emoji: '🌴',
        tagline: 'Desert bear oasis',
        calendarId: '80d296cd29b21c9b88e6b01123d2f9bd9c1776b702a51cc7a60767e44f177e7b@group.calendar.google.com',
        coordinates: { lat: 33.8303, lng: -116.5453 },
        mapZoom: 10,
        visible: true
    },
    'denver': {
        name: 'Denver',
        emoji: '🏔️',
        tagline: 'Mile High bears',
        calendarId: 'f3307ec83ddf4121f09dfa98258a6c1d5dd8ed2de085229f37cb872ef8618b21@group.calendar.google.com',
        coordinates: { lat: 39.7392, lng: -104.9903 },
        mapZoom: 10,
        visible: true
    },
    'vegas': {
        name: 'Las Vegas',
        emoji: '🎰',
        tagline: 'Sin City bears',
        calendarId: '20f1119eed191bee892ccf0410942cc2e78382997086e0124683c4f2542fabff@group.calendar.google.com',
        coordinates: { lat: 36.1699, lng: -115.1398 },
        mapZoom: 10,
        visible: true
    },
    'atlanta': {
        name: 'Atlanta',
        emoji: '🍑',
        tagline: 'Southern bear hospitality',
        calendarId: '98595c7c2e4db0e6fa1384cf3184e0fb302b5a9886499f3a222f19e5004800bc@group.calendar.google.com',
        coordinates: { lat: 33.7490, lng: -84.3880 },
        mapZoom: 10,
        visible: true
    },
    'new-orleans': {
        name: 'New Orleans',
        emoji: '🎷',
        tagline: 'Big Easy bears',
        calendarId: '8bf2d8417df78aa8b7f852e5a0a301d1ea3cef7547bd5d8b638bdfe61c8dd3e9@group.calendar.google.com',
        coordinates: { lat: 29.9511, lng: -90.0715 },
        mapZoom: 10,
        visible: true
    },
    'sf': {
        name: 'San Francisco',
        emoji: '🌉',
        tagline: 'Golden Gate bears',
        calendarId: '2f2e6cde722236a41a43325818baaa3775288bd2b4796a98b943e158bf62eb81@group.calendar.google.com',
        coordinates: { lat: 37.7749, lng: -122.4194 },
        mapZoom: 10,
        visible: true
    },
    'portland': {
        name: 'Portland',
        emoji: '🌲',
        tagline: 'Keep Portland beary',
        calendarId: '53033822a075eb914e2958dfa7aea363aac4084d29043bc5490761cbf8bf08dd@group.calendar.google.com',
        coordinates: { lat: 45.5152, lng: -122.6784 },
        mapZoom: 10,
        visible: true
    },
    'sitges': {
        name: 'Sitges',
        emoji: '🏖️',
        tagline: 'Mediterranean bear paradise',
        calendarId: 'b06b7387f73b91fad4d0dd4bd4413acd62424356482d7e59092d4a61c5803088@group.calendar.google.com',
        coordinates: { lat: 41.2379, lng: 1.8057 },
        mapZoom: 10,
        visible: true
    },
    'boston': {
        name: 'Boston',
        emoji: '🎓',
        tagline: 'Beantown bears',
        calendarId: '88700f4c5744ed3c069399d8e3e8dbcae27bb7034049171718c0bcba2e4d5f09@group.calendar.google.com',
        coordinates: { lat: 42.3601, lng: -71.0589 },
        mapZoom: 10,
        visible: true
    },
    'phoenix': {
        name: 'Phoenix',
        emoji: '🌵',
        tagline: 'Desert bear heat',
        calendarId: '7293db43546e6b7dd38620d8d078258480694866435de62f28272ea0527e922e@group.calendar.google.com',
        coordinates: { lat: 33.4484, lng: -112.0740 },
        mapZoom: 10,
        visible: true
    },
    'provincetown': {
        name: 'Provincetown',
        emoji: '⚓',
        tagline: 'Cape Cod bear paradise',
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
        coordinates: { lat: 32.7157, lng: -117.1611 },
        mapZoom: 10,
        visible: true
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
    module.exports = { CITY_CONFIG, getCityConfig, getAvailableCities, hasCityCalendar };
}
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
        calendarId: 'placeholder-palm-springs-calendar-id@group.calendar.google.com',
        coordinates: { lat: 33.8303, lng: -116.5453 },
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
window.CITY_CONFIG = CITY_CONFIG;
window.getCityConfig = getCityConfig;
window.getAvailableCities = getAvailableCities;
window.hasCityCalendar = hasCityCalendar;

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CITY_CONFIG, getCityConfig, getAvailableCities, hasCityCalendar };
}
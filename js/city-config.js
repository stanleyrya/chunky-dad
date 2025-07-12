// City Configuration - Maps cities to their data and calendar IDs
const CITY_CONFIG = {
    'new-york': {
        name: 'New York',
        emoji: '🗽',
        tagline: 'What\'s the bear 411?',
        calendarId: 'a5c9d5609f72549a8c66be0bade4255f0cdd619fa35d009c7de2c1f38ac775e9@group.calendar.google.com',
        coordinates: { lat: 40.7831, lng: -73.9712 },
        mapZoom: 12
    },
    'seattle': {
        name: 'Seattle',
        emoji: '🌲',
        tagline: 'Emerald City bears unite!',
        calendarId: 'c266bcaea1603ca1a9763edbfe51a34f57e9c46d92c246e737e4ae3608bce2da@group.calendar.google.com',
        coordinates: { lat: 47.6062, lng: -122.3321 },
        mapZoom: 12
    },
    'los-angeles': {
        name: 'Los Angeles', 
        emoji: '🌴',
        tagline: 'West Coast bear vibes',
        calendarId: null, // To be added when available
        coordinates: { lat: 34.0522, lng: -118.2437 },
        mapZoom: 11
    }
};

// Helper function to get city config
function getCityConfig(cityKey) {
    return CITY_CONFIG[cityKey] || null;
}

// Helper function to get all available cities
function getAvailableCities() {
    return Object.keys(CITY_CONFIG).map(key => ({
        key,
        ...CITY_CONFIG[key]
    }));
}

// Check if city has calendar configured
function hasCityCalendar(cityKey) {
    const config = getCityConfig(cityKey);
    return config && config.calendarId;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CITY_CONFIG, getCityConfig, getAvailableCities, hasCityCalendar };
}
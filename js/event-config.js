// Bear Events Configuration - Maps bear events to their data and calendar IDs
const BEAR_EVENTS_CONFIG = {
    'puerto-vallarta-beef-dip': {
        name: 'Puerto Vallarta Beef Dip',
        emoji: '🌮',
        tagline: 'Mexican bear paradise',
        dates: '2024-12-14 to 2024-12-21',
        location: 'Puerto Vallarta, Mexico',
        calendarId: 'example_beef_dip@group.calendar.google.com',
        coordinates: { lat: 20.6534, lng: -105.2253 },
        mapZoom: 12
    },
    'sitges-bear-week': {
        name: 'Sitges Bear Week',
        emoji: '🏖️',
        tagline: 'Mediterranean bear celebration',
        dates: '2024-09-08 to 2024-09-15',
        location: 'Sitges, Spain',
        calendarId: 'example_sitges@group.calendar.google.com',
        coordinates: { lat: 41.2379, lng: 1.8057 },
        mapZoom: 12
    },
    'chicago-market-days': {
        name: 'Chicago Market Days',
        emoji: '🎪',
        tagline: 'Windy City street festival',
        dates: '2024-08-10 to 2024-08-11',
        location: 'Chicago, IL',
        calendarId: 'example_market_days@group.calendar.google.com',
        coordinates: { lat: 41.9534, lng: -87.6491 },
        mapZoom: 12
    },
    'provincetown-bear-week': {
        name: 'Provincetown Bear Week',
        emoji: '🦞',
        tagline: 'Cape Cod bear gathering',
        dates: '2024-07-14 to 2024-07-21',
        location: 'Provincetown, MA',
        calendarId: 'example_ptown_bear@group.calendar.google.com',
        coordinates: { lat: 42.0526, lng: -70.1826 },
        mapZoom: 12
    },
    'provincetown-spooky-bear': {
        name: 'Provincetown Spooky Bear',
        emoji: '🎃',
        tagline: 'Halloween bear festivities',
        dates: '2024-10-26 to 2024-11-03',
        location: 'Provincetown, MA',
        calendarId: 'example_spooky_bear@group.calendar.google.com',
        coordinates: { lat: 42.0526, lng: -70.1826 },
        mapZoom: 12
    }
};

// Helper function to get bear event config
function getBearEventConfig(eventKey) {
    return BEAR_EVENTS_CONFIG[eventKey] || null;
}

// Helper function to get all available bear events
function getAvailableBearEvents() {
    return Object.keys(BEAR_EVENTS_CONFIG).map(key => ({
        key,
        ...BEAR_EVENTS_CONFIG[key]
    }));
}

// Check if bear event has calendar configured
function hasBearEventCalendar(eventKey) {
    const config = getBearEventConfig(eventKey);
    return config && config.calendarId;
}

// Make functions globally available for browser use
window.BEAR_EVENTS_CONFIG = BEAR_EVENTS_CONFIG;
window.getBearEventConfig = getBearEventConfig;
window.getAvailableBearEvents = getAvailableBearEvents;
window.hasBearEventCalendar = hasBearEventCalendar;

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BEAR_EVENTS_CONFIG, getBearEventConfig, getAvailableBearEvents, hasBearEventCalendar };
}
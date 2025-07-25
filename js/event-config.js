// Bear Events Configuration - Maps bear events to their data and calendar IDs
const BEAR_EVENTS_CONFIG = {
    'beef-dip': {
        name: 'Beef Dip',
        emoji: '🌮',
        tagline: 'Mexican bear paradise',
        startDate: '2025-12-13',
        endDate: '2025-12-20',
        location: 'Puerto Vallarta',
        calendarId: 'example_beef_dip@group.calendar.google.com',
        coordinates: { lat: 20.6534, lng: -105.2253 },
        mapZoom: 12,
        visible: true
    },
    'bear-week': {
        name: 'Bear Week',
        emoji: '🏖️',
        tagline: 'Mediterranean bear celebration',
        startDate: '2025-09-07',
        endDate: '2025-09-14',
        location: 'Sitges',
        calendarId: 'example_sitges@group.calendar.google.com',
        coordinates: { lat: 41.2379, lng: 1.8057 },
        mapZoom: 12,
        visible: true
    },
    'market-days': {
        name: 'Market Days',
        emoji: '🎪',
        tagline: 'Windy City street festival',
        startDate: '2025-08-09',
        endDate: '2025-08-10',
        location: 'Chicago',
        calendarId: 'example_market_days@group.calendar.google.com',
        coordinates: { lat: 41.9534, lng: -87.6491 },
        mapZoom: 12,
        visible: true
    },
    'bear-week-ptown': {
        name: 'Bear Week',
        emoji: '🦞',
        tagline: 'Cape Cod bear gathering',
        startDate: '2025-07-13',
        endDate: '2025-07-20',
        location: 'Provincetown',
        calendarId: 'example_ptown_bear@group.calendar.google.com',
        coordinates: { lat: 42.0526, lng: -70.1826 },
        mapZoom: 12,
        visible: true
    },
    'spooky-bear': {
        name: 'Spooky Bear',
        emoji: '🎃',
        tagline: 'Halloween bear festivities',
        startDate: '2025-10-25',
        endDate: '2025-11-02',
        location: 'Provincetown',
        calendarId: 'example_spooky_bear@group.calendar.google.com',
        coordinates: { lat: 42.0526, lng: -70.1826 },
        mapZoom: 12,
        visible: true
    }
};

// Helper function to get bear event config
function getBearEventConfig(eventKey) {
    return BEAR_EVENTS_CONFIG[eventKey] || null;
}

// Check if event should be visible based on date and visibility settings
function shouldShowEvent(event) {
    // First check explicit visibility setting
    if (event.visible === false) {
        return false;
    }
    
    // Check if event has passed the hide threshold (1 week after end)
    if (event.endDate) {
        const eventEnd = new Date(event.endDate);
        const now = new Date();
        const hideThreshold = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds
        
        if (eventEnd.getTime() + hideThreshold < now.getTime()) {
            return false;
        }
    }
    
    return true;
}

// Helper function to get all available bear events (filtered and sorted)
function getAvailableBearEvents() {
    const now = new Date();
    
    return Object.keys(BEAR_EVENTS_CONFIG)
        .map(key => ({
            key,
            ...BEAR_EVENTS_CONFIG[key]
        }))
        .filter(event => shouldShowEvent(event))
        .map(event => {
            // Add upcoming dates for sorting
            const upcomingDates = getUpcomingEventDates(event);
            return {
                ...event,
                upcomingStartDate: upcomingDates.startDate,
                upcomingEndDate: upcomingDates.endDate
            };
        })
        .sort((a, b) => {
            // Sort by upcoming start date
            const dateA = new Date(a.upcomingStartDate);
            const dateB = new Date(b.upcomingStartDate);
            return dateA.getTime() - dateB.getTime();
        });
}

// Check if bear event has calendar configured
function hasBearEventCalendar(eventKey) {
    const config = getBearEventConfig(eventKey);
    return config && config.calendarId;
}

// Get upcoming event dates (shows next year if current year has passed)
function getUpcomingEventDates(event) {
    if (!event.startDate || !event.endDate) return { startDate: event.startDate, endDate: event.endDate };
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const eventEnd = new Date(event.endDate);
    
    // If event has passed (end date + 1 week buffer), show next year's dates
    const bufferTime = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds
    if (eventEnd.getTime() + bufferTime < now.getTime()) {
        const nextYear = currentYear + 1;
        const startDate = event.startDate.replace(/^\d{4}/, nextYear.toString());
        const endDate = event.endDate.replace(/^\d{4}/, nextYear.toString());
        return { startDate, endDate };
    }
    
    return { startDate: event.startDate, endDate: event.endDate };
}

// Format event dates for display
function formatEventDates(event) {
    const upcomingDates = getUpcomingEventDates(event);
    if (!upcomingDates.startDate || !upcomingDates.endDate) return '';
    
    const start = new Date(upcomingDates.startDate);
    const end = new Date(upcomingDates.endDate);
    
    const options = { month: 'short', day: 'numeric' };
    const startFormatted = start.toLocaleDateString('en-US', options);
    const endFormatted = end.toLocaleDateString('en-US', options);
    
    // If same year, show it once at the end
    const year = start.getFullYear();
    
    if (start.getTime() === end.getTime()) {
        return `${startFormatted}, ${year}`;
    }
    
    return `${startFormatted} - ${endFormatted}, ${year}`;
}

// Make functions globally available for browser use
window.BEAR_EVENTS_CONFIG = BEAR_EVENTS_CONFIG;
window.getBearEventConfig = getBearEventConfig;
window.getAvailableBearEvents = getAvailableBearEvents;
window.hasBearEventCalendar = hasBearEventCalendar;
window.getUpcomingEventDates = getUpcomingEventDates;
window.formatEventDates = formatEventDates;
window.shouldShowEvent = shouldShowEvent;

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BEAR_EVENTS_CONFIG, getBearEventConfig, getAvailableBearEvents, hasBearEventCalendar, getUpcomingEventDates, formatEventDates, shouldShowEvent };
}
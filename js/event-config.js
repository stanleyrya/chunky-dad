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

// Per-category default emoji for festivals (per-entry `emoji` overrides these)
const FESTIVAL_CATEGORY_EMOJI = {
    'bear-run': '🐻',
    'pride': '🏳️‍🌈',
    'kink': '⛓️',
    'festival': '🎉'
};

// Convert a festivals.json entry to the BEAR_EVENTS_CONFIG entry shape
function festivalToBearEvent(festival) {
    return {
        key: festival.key,
        name: festival.name,
        emoji: festival.emoji || FESTIVAL_CATEGORY_EMOJI[festival.category] || '🐻',
        tagline: festival.typicalTiming || '',
        typicalTiming: festival.typicalTiming || '',
        startDate: (festival.nextDates && festival.nextDates.start) ? festival.nextDates.start : null,
        endDate: (festival.nextDates && festival.nextDates.end) ? festival.nextDates.end : null,
        location: festival.location || '',
        website: festival.website || null,
        instagram: festival.instagram || null,
        cityKey: festival.cityKey || null,
        category: festival.category || null,
        visible: true
    };
}

// Resolve the festivals.json path relative to the current page location
function resolveFestivalsDataPath() {
    if (typeof window !== 'undefined' && window.pathUtils) {
        return window.pathUtils.resolvePath('data/festivals.json');
    }
    return 'data/festivals.json';
}

// Load festivals.json and convert entries to the bear-event shape.
// The promise is cached so the file is fetched at most once per page load.
// On fetch failure, falls back to the inline BEAR_EVENTS_CONFIG (resilience).
let festivalsConfigPromise = null;
function loadFestivalsConfig() {
    if (festivalsConfigPromise) {
        return festivalsConfigPromise;
    }
    festivalsConfigPromise = fetch(resolveFestivalsDataPath(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.json();
        })
        .then(data => {
            if (!data || !Array.isArray(data.festivals) || data.festivals.length === 0) {
                throw new Error('festivals.json has no festivals array');
            }
            return data.festivals.map(festivalToBearEvent);
        })
        .catch(error => {
            console.warn('Failed to load data/festivals.json, falling back to inline BEAR_EVENTS_CONFIG', error);
            return Object.keys(BEAR_EVENTS_CONFIG).map(key => ({
                key,
                ...BEAR_EVENTS_CONFIG[key]
            }));
        });
    return festivalsConfigPromise;
}

// Helper function to get bear event config
function getBearEventConfig(eventKey) {
    return BEAR_EVENTS_CONFIG[eventKey] || null;
}

// Check if event should be visible based on visibility settings.
// Note: festivals are recurring, so entries whose dates have passed degrade to the
// undated (typicalTiming) display in getAvailableBearEvents() instead of disappearing.
function shouldShowEvent(event) {
    return event.visible !== false;
}

// Check if the event's configured dates are current (i.e. the event has not ended
// more than 1 week ago). Events failing this degrade to the undated display.
function hasCurrentEventDates(event) {
    if (!event.startDate || !event.endDate) {
        return false;
    }
    const eventEnd = new Date(event.endDate);
    if (Number.isNaN(eventEnd.getTime())) {
        return false;
    }
    const hideThreshold = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds
    return eventEnd.getTime() + hideThreshold >= Date.now();
}

// Helper function to get all available bear events (filtered and sorted).
// Async: sourced from data/festivals.json (with inline fallback).
// - Entries with current/future dates come first, sorted chronologically.
// - Entries with past-or-no dates stay visible after the dated ones, sorted
//   alphabetically, and display typicalTiming instead of a date range.
async function getAvailableBearEvents() {
    const allEvents = await loadFestivalsConfig();

    const dated = [];
    const undated = [];
    allEvents
        .filter(event => shouldShowEvent(event))
        .forEach(event => {
            if (hasCurrentEventDates(event)) {
                dated.push({ ...event });
            } else {
                // Recurring festival whose dates passed (or were never set):
                // show it undated with typicalTiming as the date line.
                undated.push({ ...event, startDate: null, endDate: null });
            }
        });

    dated.sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    undated.sort((a, b) => a.name.localeCompare(b.name));

    return dated.concat(undated);
}

// Check if bear event has calendar configured
function hasBearEventCalendar(eventKey) {
    const config = getBearEventConfig(eventKey);
    return config && config.calendarId;
}

// Get upcoming event dates (shows next year if current year has passed)
function getUpcomingEventDates(event) {
    if (!event.startDate || !event.endDate) return { startDate: event.startDate, endDate: event.endDate };

    // Date objects (e.g. revived calendar events) can't be year-rolled via string
    // replacement — return them as-is
    if (typeof event.startDate !== 'string' || typeof event.endDate !== 'string') {
        return { startDate: event.startDate, endDate: event.endDate };
    }

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
    
    // Format as M/D (e.g., 8/11, 12/3)
    const startFormatted = `${start.getMonth() + 1}/${start.getDate()}`;
    const endFormatted = `${end.getMonth() + 1}/${end.getDate()}`;
    
    if (start.getTime() === end.getTime()) {
        return startFormatted;
    }
    
    return `${startFormatted}-${endFormatted}`;
}

// Make functions globally available for browser use
if (typeof window !== 'undefined') {
    window.BEAR_EVENTS_CONFIG = BEAR_EVENTS_CONFIG;
    window.getBearEventConfig = getBearEventConfig;
    window.getAvailableBearEvents = getAvailableBearEvents;
    window.hasBearEventCalendar = hasBearEventCalendar;
    window.getUpcomingEventDates = getUpcomingEventDates;
    window.formatEventDates = formatEventDates;
    window.shouldShowEvent = shouldShowEvent;
    window.hasCurrentEventDates = hasCurrentEventDates;
    window.loadFestivalsConfig = loadFestivalsConfig;
    window.festivalToBearEvent = festivalToBearEvent;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BEAR_EVENTS_CONFIG, FESTIVAL_CATEGORY_EMOJI, festivalToBearEvent, loadFestivalsConfig, getBearEventConfig, getAvailableBearEvents, hasBearEventCalendar, hasCurrentEventDates, getUpcomingEventDates, formatEventDates, shouldShowEvent };
}
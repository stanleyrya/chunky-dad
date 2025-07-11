// Calendar Manager Module - Coordinates all calendar-related modules
class CalendarManager {
    constructor() {
        this.debugMode = true;
        this.allEvents = [];
        this.initialized = false;
        
        // Initialize sub-modules
        this.dataLoader = new CalendarDataLoader();
        this.eventParser = new EventParser();
        this.ui = new CalendarUI();
        this.mapManager = new MapManager();
        this.controls = new CalendarControls();
        this.citySelector = new CitySelector();
    }

    log(message, data = null) {
        if (this.debugMode) {
            console.log(`[CalendarManager] ${message}`, data || '');
        }
    }

    error(message, data = null) {
        console.error(`[CalendarManager ERROR] ${message}`, data || '');
    }

    // Initialize the calendar manager
    async initialize() {
        if (this.initialized) return;

        try {
            // Initialize city selector first
            this.citySelector.initialize();
            
            // Only proceed if we have a valid city with calendar
            if (!this.citySelector.hasCalendar()) {
                this.error('Current city has no calendar configured');
                return;
            }

            // Initialize controls
            this.controls.initialize();
            
            // Load calendar data
            await this.loadCalendarData();
            
            // Initialize map if we have events
            if (this.allEvents.length > 0) {
                this.mapManager.initializeMap(
                    this.citySelector.getCurrentCityConfig(),
                    this.allEvents
                );
            }
            
            this.initialized = true;
            this.log('Calendar manager initialized successfully');
            
        } catch (error) {
            this.error('Failed to initialize calendar manager:', error);
            this.showError();
        }
    }

    // Load calendar data
    async loadCalendarData() {
        const cityKey = this.citySelector.getCurrentCity();
        
        try {
            const calendarData = await this.dataLoader.loadCalendarData(cityKey);
            
            if (!calendarData) {
                throw new Error('No calendar data received');
            }
            
            // Parse events
            this.allEvents = this.eventParser.parseEvents(calendarData.events, cityKey);
            
            // Update display
            this.updateDisplay();
            
            this.log(`Loaded ${this.allEvents.length} events for ${cityKey}`);
            
        } catch (error) {
            this.error('Failed to load calendar data:', error);
            this.showError();
        }
    }

    // Update the calendar display
    updateDisplay() {
        if (!this.initialized) return;

        try {
            const currentView = this.controls.getCurrentView();
            const currentDate = this.controls.getCurrentDate();
            
            // Filter events for current period
            const filteredEvents = this.getFilteredEvents();
            
            // Generate calendar HTML
            const calendarHtml = this.ui.generateCalendarView(
                filteredEvents,
                currentView,
                currentDate
            );
            
            // Generate events list HTML
            const eventsListHtml = this.generateEventsListHtml(filteredEvents);
            
            // Update UI
            this.ui.updateCalendarDisplay(calendarHtml, eventsListHtml);
            
            // Update controls
            this.controls.updateCalendarTitle();
            this.controls.updateDateRangeDisplay();
            
            this.log('Calendar display updated');
            
        } catch (error) {
            this.error('Failed to update display:', error);
        }
    }

    // Get filtered events for current period
    getFilteredEvents() {
        const bounds = this.controls.getCurrentPeriodBounds();
        return this.eventParser.filterEventsByDateRange(
            this.allEvents,
            bounds.start,
            bounds.end
        );
    }

    // Generate events list HTML
    generateEventsListHtml(events) {
        if (events.length === 0) {
            return '<div class="no-events">No events found for this period.</div>';
        }

        return events.map(event => this.ui.generateEventCard(event)).join('');
    }

    // Get events for a specific day
    getEventsForDay(dateString) {
        const date = new Date(dateString);
        
        return this.allEvents.filter(event => {
            if (!event.startDate) return false;
            
            if (event.recurring) {
                return this.eventParser.isEventOccurringOnDate(event, date);
            }
            
            const eventDate = new Date(event.startDate);
            eventDate.setHours(0, 0, 0, 0);
            const checkDate = new Date(date);
            checkDate.setHours(0, 0, 0, 0);
            
            return eventDate.getTime() === checkDate.getTime();
        });
    }

    // Switch to week view for specific date
    switchToWeekView(dateString) {
        this.controls.switchToWeekView(dateString);
    }

    // Handle city change
    onCityChange(cityKey, cityConfig) {
        this.log(`City changed to ${cityKey}`);
        
        // Clear existing data
        this.allEvents = [];
        
        // Clean up map
        this.mapManager.cleanup();
        
        // Load new data
        this.loadCalendarData();
    }

    // Show error state
    showError() {
        const cityName = this.citySelector.getCurrentCityConfig()?.name;
        this.ui.showCalendarError(cityName);
    }

    // Get all events
    getAllEvents() {
        return this.allEvents;
    }

    // Get current city info
    getCurrentCity() {
        return this.citySelector.getCurrentCity();
    }

    // Get current city config
    getCurrentCityConfig() {
        return this.citySelector.getCurrentCityConfig();
    }

    // Refresh calendar data
    async refresh() {
        this.log('Refreshing calendar data...');
        await this.loadCalendarData();
    }

    // Clean up resources
    cleanup() {
        this.mapManager.cleanup();
        this.allEvents = [];
        this.initialized = false;
        this.log('Calendar manager cleaned up');
    }
}

// Legacy compatibility - create a simplified version of the old DynamicCalendarLoader
class DynamicCalendarLoader {
    constructor() {
        this.calendarManager = new CalendarManager();
    }

    async init() {
        await this.calendarManager.initialize();
    }

    // Expose methods for backward compatibility
    switchToWeekView(dateString) {
        this.calendarManager.switchToWeekView(dateString);
    }

    getEventsForDay(dateString) {
        return this.calendarManager.getEventsForDay(dateString);
    }

    async renderCityPage() {
        await this.calendarManager.initialize();
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.CalendarManager = CalendarManager;
    window.DynamicCalendarLoader = DynamicCalendarLoader; // For backward compatibility
}
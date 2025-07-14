// Modular Calendar Loader - Uses the new event display system
class ModularCalendarLoader {
    constructor() {
        this.currentCity = null;
        this.currentCityConfig = null;
        
        // Initialize the modular components
        this.eventDataManager = new EventDataManager();
        this.displayComponents = new EventDisplayComponents();
        this.viewController = new EventViewController(this.eventDataManager, this.displayComponents);
        
        // View state management
        this.currentView = 'week'; // 'week' or 'month'
        this.currentDate = new Date();
        
        logger.componentInit('CALENDAR', 'Modular CalendarLoader initialized');
    }

    // Get city from URL parameters
    getCityFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        const cityParam = urlParams.get('city');
        
        // If no city parameter, try to get from hash or default to new-york
        if (!cityParam) {
            const hash = window.location.hash.replace('#', '');
            return hash || 'new-york';
        }
        
        return cityParam;
    }

    // Set up city selector and populate with available cities
    setupCitySelector() {
        const availableCitiesList = document.getElementById('available-cities-list');
        
        // Populate available cities list for error page
        if (availableCitiesList) {
            availableCitiesList.innerHTML = getAvailableCities()
                .filter(city => hasCityCalendar(city.key))
                .map(city => `
                    <a href="city.html?city=${city.key}" class="city-link">
                        ${city.emoji} ${city.name}
                    </a>
                `).join('');
        }
    }

    // Show error when city is not found or unavailable
    showCityNotFound() {
        const cityNotFound = document.querySelector('.city-not-found');
        const cityPage = document.querySelector('.city-page');
        
        if (cityNotFound && cityPage) {
            cityNotFound.style.display = 'block';
            cityPage.style.display = 'none';
        }
        
        document.title = 'City Not Found - chunky.dad';
    }

    // Load calendar data for specific city
    async loadCalendarData(cityKey) {
        const cityConfig = getCityConfig(cityKey);
        if (!cityConfig || !cityConfig.calendarId) {
            logger.componentError('CALENDAR', `No calendar configuration found for city: ${cityKey}`);
            return null;
        }
        
        logger.time('CALENDAR', `Loading ${cityConfig.name} calendar data`);
        logger.apiCall('CALENDAR', `Loading calendar data for ${cityConfig.name}`, {
            cityKey,
            calendarId: cityConfig.calendarId
        });
        
        try {
            const icalUrl = `https://calendar.google.com/calendar/ical/${cityConfig.calendarId}/public/basic.ics`;
            const corsProxy = 'https://api.allorigins.win/raw?url=';
            const fullUrl = corsProxy + encodeURIComponent(icalUrl);
            
            const response = await fetch(fullUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const icalText = await response.text();
            logger.apiCall('CALENDAR', 'Successfully fetched iCal data', {
                dataLength: icalText.length,
                city: cityConfig.name,
                url: icalUrl
            });
            
            // Log sample of the fetched data for debugging
            if (icalText.length > 0) {
                logger.debug('CALENDAR', 'Raw iCal data sample', {
                    firstLine: icalText.split('\n')[0],
                    hasEvents: icalText.includes('BEGIN:VEVENT'),
                    eventCount: (icalText.match(/BEGIN:VEVENT/g) || []).length,
                    calendarName: icalText.match(/X-WR-CALNAME:(.+)/)?.[1]?.trim() || 'Unknown',
                    encoding: icalText.includes('BEGIN:VCALENDAR') ? 'Valid iCal' : 'Invalid format'
                });
            } else {
                logger.warn('CALENDAR', 'Empty iCal data received', {
                    city: cityConfig.name,
                    url: icalUrl
                });
            }
            
            const events = this.eventDataManager.parseICalData(icalText);
            
            // Add city-specific data to events
            events.forEach(event => {
                event.citySlug = cityKey;
            });
            
            // Store events in the data manager
            this.eventDataManager.setEventsData(events, cityConfig);
            
            logger.timeEnd('CALENDAR', `Loading ${cityConfig.name} calendar data`);
            logger.componentLoad('CALENDAR', `Successfully processed calendar data for ${cityConfig.name}`, {
                eventCount: events.length,
                cityKey
            });
            
            return { cityConfig, events };
        } catch (error) {
            logger.componentError('CALENDAR', 'Error loading calendar data', error);
            this.showCalendarError();
            return null;
        }
    }

    // Show calendar error
    showCalendarError() {
        const errorMessage = `
            <div class="error-message">
                <h3>📅 Calendar Temporarily Unavailable</h3>
                <p>We're having trouble loading the latest events for ${this.currentCityConfig?.name || 'this city'}.</p>
                <p><strong>Try:</strong> Refreshing the page in a few minutes, or check our social media for updates.</p>
            </div>
        `;
        
        const calendarGrid = document.querySelector('.calendar-grid');
        if (calendarGrid) {
            calendarGrid.innerHTML = errorMessage;
        }
        
        const eventsList = document.querySelector('.events-list');
        if (eventsList) {
            eventsList.innerHTML = errorMessage;
        }
    }

    // Update calendar display using the modular system
    updateCalendarDisplay() {
        const calendarGrid = document.querySelector('.calendar-grid');
        const eventsList = document.querySelector('.events-list');
        
        if (!calendarGrid && !eventsList) {
            logger.warn('CALENDAR', 'No calendar containers found');
            return;
        }
        
        // Update date range display
        const dateRange = document.getElementById('date-range');
        if (dateRange) {
            dateRange.textContent = this.viewController.formatDateRange();
        }
        
        // Update calendar title
        const calendarTitle = document.getElementById('calendar-title');
        if (calendarTitle) {
            const viewInfo = this.viewController.getCurrentViewInfo();
            calendarTitle.textContent = `${viewInfo.name} - ${this.viewController.formatDateRange()}`;
        }
        
        // Render the appropriate view
        if (calendarGrid) {
            this.viewController.render(calendarGrid);
        }
        
        if (eventsList) {
            // For the events list section, use a different view
            const allEvents = this.eventDataManager.getAllEvents();
            eventsList.innerHTML = this.displayComponents.generateGridView(allEvents, {
                columns: 2,
                compact: true
            });
        }
        
        // Initialize map if available
        if (this.currentCityConfig) {
            this.initializeMap(this.currentCityConfig, this.eventDataManager.getAllEvents());
        }
    }

    // Setup calendar controls
    setupCalendarControls() {
        // View toggle buttons
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                this.viewController.setView(view);
                this.updateCalendarDisplay();
            });
        });
        
        // Navigation buttons
        const prevBtn = document.getElementById('prev-period');
        const nextBtn = document.getElementById('next-period');
        const todayBtn = document.getElementById('today-btn');
        
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                this.viewController.navigatePrevious();
                this.updateCalendarDisplay();
            });
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                this.viewController.navigateNext();
                this.updateCalendarDisplay();
            });
        }
        
        if (todayBtn) {
            todayBtn.addEventListener('click', () => {
                this.viewController.goToToday();
                this.updateCalendarDisplay();
            });
        }
        
        logger.componentLoad('CALENDAR', 'Calendar controls setup complete');
    }

    // Initialize map (reuse existing map logic)
    initializeMap(cityConfig, events) {
        const mapContainer = document.getElementById('events-map');
        if (!mapContainer || !window.L) {
            logger.warn('CALENDAR', 'Map container or Leaflet not available');
            return;
        }
        
        try {
            // Clear existing map
            if (window.eventsMap) {
                window.eventsMap.remove();
            }
            
            // Create new map
            const mapCenter = cityConfig.coordinates || { lat: 40.7128, lng: -74.0060 };
            window.eventsMap = L.map('events-map').setView([mapCenter.lat, mapCenter.lng], 13);
            
            // Add tile layer
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(window.eventsMap);
            
            // Add markers for events with coordinates
            const eventsWithCoords = events.filter(event => event.coordinates);
            
            eventsWithCoords.forEach(event => {
                const marker = L.marker([event.coordinates.lat, event.coordinates.lng])
                    .addTo(window.eventsMap)
                    .bindPopup(`
                        <div class="map-popup">
                            <h4>${event.name}</h4>
                            <p><strong>Venue:</strong> ${event.bar}</p>
                            <p><strong>Time:</strong> ${event.time}</p>
                            <p><strong>Day:</strong> ${event.day}</p>
                            ${event.tea ? `<p><strong>Details:</strong> ${event.tea}</p>` : ''}
                        </div>
                    `);
            });
            
            // Fit map to show all markers
            if (eventsWithCoords.length > 0) {
                const group = new L.featureGroup(eventsWithCoords.map(event => 
                    L.marker([event.coordinates.lat, event.coordinates.lng])
                ));
                window.eventsMap.fitBounds(group.getBounds().pad(0.1));
            }
            
            logger.componentLoad('CALENDAR', 'Map initialized', {
                eventCount: eventsWithCoords.length,
                city: cityConfig.name
            });
        } catch (error) {
            logger.componentError('CALENDAR', 'Error initializing map', error);
        }
    }

    // Update page content
    updatePageContent(cityConfig, events) {
        // Update page title
        document.title = `${cityConfig.name} Bear Guide - chunky.dad`;
        
        // Update CTA text
        const cityCtaText = document.getElementById('city-cta-text');
        if (cityCtaText) {
            cityCtaText.textContent = `Know about other bear events or venues in ${cityConfig.name}? Help us keep this guide current!`;
        }
        
        // Update header if header manager is available
        if (window.headerManager) {
            window.headerManager.updateForCity(cityConfig.key);
        }
        
        logger.componentLoad('CALENDAR', 'Page content updated', {
            city: cityConfig.name,
            eventCount: events.length
        });
    }

    // Attach calendar interactions
    attachCalendarInteractions() {
        // Make view controller globally accessible for modal interactions
        window.eventViewController = this.viewController;
        
        logger.componentLoad('CALENDAR', 'Calendar interactions attached');
    }

    // Main render method for city page
    async renderCityPage() {
        try {
            // Get city from URL
            this.currentCity = this.getCityFromURL();
            this.currentCityConfig = getCityConfig(this.currentCity);
            
            if (!this.currentCityConfig) {
                this.showCityNotFound();
                return;
            }
            
            if (!hasCityCalendar(this.currentCity)) {
                this.showCityNotFound();
                return;
            }
            
            // Setup city selector
            this.setupCitySelector();
            
            // Load calendar data
            const calendarData = await this.loadCalendarData(this.currentCity);
            if (!calendarData) {
                return;
            }
            
            // Update page content
            this.updatePageContent(calendarData.cityConfig, calendarData.events);
            
            // Setup calendar controls
            this.setupCalendarControls();
            
            // Update calendar display
            this.updateCalendarDisplay();
            
            // Attach interactions
            this.attachCalendarInteractions();
            
            logger.componentLoad('CALENDAR', 'City page rendering complete', {
                city: this.currentCityConfig.name,
                eventCount: calendarData.events.length
            });
            
        } catch (error) {
            logger.componentError('CALENDAR', 'Error rendering city page', error);
        }
    }

    // Initialize the calendar loader
    async init() {
        try {
            await this.renderCityPage();
            logger.componentLoad('CALENDAR', 'Modular CalendarLoader initialization complete');
        } catch (error) {
            logger.componentError('CALENDAR', 'Modular CalendarLoader initialization failed', error);
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ModularCalendarLoader;
} else {
    window.ModularCalendarLoader = ModularCalendarLoader;
}
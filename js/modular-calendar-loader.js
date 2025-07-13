// Modular Calendar Loader - Uses the new event view system
class ModularCalendarLoader extends CalendarCore {
    constructor() {
        super();
        this.currentCity = null;
        this.currentCityConfig = null;
        this.viewManager = new EventViewManager();
        this.allEvents = [];
        this.eventsData = null;
        
        logger.componentInit('CALENDAR', 'Modular Calendar Loader initialized');
        
        this.setupEventViews();
    }

    setupEventViews() {
        // Register all available views
        this.viewManager.registerView('calendar', new CalendarView('#calendar-view-container'));
        this.viewManager.registerView('eventlist', new EventListView('#eventlist-view-container'));
        this.viewManager.registerView('map', new MapView('#events-map'));
        
        // Check HTML for which views are enabled
        this.configureViewsFromHTML();
        
        logger.componentLoad('CALENDAR', 'Event views configured', {
            totalViews: this.viewManager.views.size,
            activeViews: Array.from(this.viewManager.activeViews)
        });
    }

    configureViewsFromHTML() {
        // Check HTML data attributes to determine which views should be active
        const viewSections = document.querySelectorAll('[data-event-view]');
        
        viewSections.forEach(section => {
            const viewName = section.dataset.eventView;
            const isEnabled = section.dataset.viewEnabled === 'true';
            
            if (isEnabled) {
                this.viewManager.enableView(viewName);
            } else {
                this.viewManager.disableView(viewName);
            }
        });
    }

    // Get city from URL parameters
    getCityFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        const cityParam = urlParams.get('city');
        
        if (!cityParam) {
            const hash = window.location.hash.replace('#', '');
            return hash || 'new-york';
        }
        
        return cityParam;
    }

    // Set up city selector and populate with available cities
    setupCitySelector() {
        const citySelect = document.getElementById('city-select');
        const cityButtons = document.getElementById('city-buttons');
        const availableCitiesList = document.getElementById('available-cities-list');
        
        // Setup city buttons (for larger screens)
        if (cityButtons) {
            cityButtons.innerHTML = getAvailableCities().map(city => {
                const isActive = city.key === this.currentCity;
                const hasCalendar = hasCityCalendar(city.key);
                const href = hasCalendar ? `city.html?city=${city.key}` : '#';
                const extraClass = hasCalendar ? '' : ' coming-soon';
                const activeClass = isActive ? ' active' : '';
                
                return `
                    <a href="${href}" class="city-button${activeClass}${extraClass}" data-city="${city.key}">
                        <div class="city-emoji">${city.emoji}</div>
                        <div class="city-name">${city.name}</div>
                        ${!hasCalendar ? '<div style="font-size: 0.7rem; margin-top: 4px; opacity: 0.8;">Coming Soon</div>' : ''}
                    </a>
                `;
            }).join('');

            // Add click handlers for city buttons
            cityButtons.addEventListener('click', (e) => {
                const cityButton = e.target.closest('.city-button');
                if (cityButton && !cityButton.classList.contains('coming-soon')) {
                    const cityKey = cityButton.dataset.city;
                    if (cityKey && cityKey !== this.currentCity) {
                        window.location.href = `city.html?city=${cityKey}`;
                    }
                }
            });
        }
        
        // Setup dropdown (for smaller screens)
        if (citySelect) {
            citySelect.innerHTML = '<option value="">Select a city...</option>';
            
            getAvailableCities().forEach(city => {
                const option = document.createElement('option');
                option.value = city.key;
                const hasCalendar = hasCityCalendar(city.key);
                option.textContent = `${city.emoji} ${city.name}${!hasCalendar ? ' (Coming Soon)' : ''}`;
                if (city.key === this.currentCity) {
                    option.selected = true;
                }
                if (!hasCalendar) {
                    option.disabled = true;
                }
                citySelect.appendChild(option);
            });

            citySelect.addEventListener('change', (e) => {
                if (e.target.value) {
                    window.location.href = `city.html?city=${e.target.value}`;
                }
            });
        }

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
        
        document.title = 'City Not Found - Chunky Dad';
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
                city: cityConfig.name
            });
            
            const events = this.parseICalData(icalText);
            
            // Store all events
            this.allEvents = events;
            
            this.eventsData = {
                cityConfig,
                events
            };
            
            logger.timeEnd('CALENDAR', `Loading ${cityConfig.name} calendar data`);
            logger.componentLoad('CALENDAR', `Successfully processed calendar data for ${cityConfig.name}`, {
                eventCount: events.length,
                cityKey
            });
            
            return this.eventsData;
        } catch (error) {
            logger.componentError('CALENDAR', 'Error loading calendar data', error);
            this.showCalendarError();
            return null;
        }
    }

    // Override parseEventData to add city-specific data
    parseEventData(calendarEvent) {
        const eventData = super.parseEventData(calendarEvent);
        if (eventData) {
            eventData.citySlug = this.currentCity;
        }
        return eventData;
    }

    // Show calendar error for all views
    showCalendarError() {
        const errorMessage = `
            <div class="error-message">
                <h3>📅 Calendar Temporarily Unavailable</h3>
                <p>We're having trouble loading the latest events for ${this.currentCityConfig?.name || 'this city'}.</p>
                <p><strong>Try:</strong> Refreshing the page in a few minutes, or check our social media for updates.</p>
            </div>
        `;
        
        this.viewManager.showErrorAll(errorMessage);
    }

    // Update page content for city
    updatePageContent(cityConfig, events) {
        // Store city config
        this.currentCityConfig = cityConfig;
        
        // Update page title and metadata
        this.updatePageMetadata(cityConfig);
        
        // Update city header information
        this.updateCityHeader(cityConfig);
        
        // Update all event views
        this.viewManager.updateAllViews(events, cityConfig);
        
        // Show content sections
        this.showContentSections();
        
        logger.componentLoad('CITY', `Page content updated for ${cityConfig.name}`, {
            eventCount: events.length,
            activeViews: Array.from(this.viewManager.activeViews)
        });
    }

    updatePageMetadata(cityConfig) {
        document.title = `${cityConfig.name} - Chunky Dad Bear Guide`;
        
        const metaDescription = document.querySelector('meta[name="description"]');
        if (metaDescription) {
            metaDescription.setAttribute('content', 
                `Complete gay bear guide to ${cityConfig.name} - events, bars, and the hottest bear scene`
            );
        }
    }

    updateCityHeader(cityConfig) {
        const cityTitle = document.getElementById('city-title');
        const cityTagline = document.getElementById('city-tagline');
        const cityCTAText = document.getElementById('city-cta-text');
        
        if (cityTitle) {
            cityTitle.classList.add('city-title-loading');
            setTimeout(() => {
                cityTitle.textContent = `${cityConfig.emoji} ${cityConfig.name}`;
                cityTitle.classList.remove('city-title-loading');
                cityTitle.classList.add('city-title-loaded');
            }, 100);
        }
        
        if (cityTagline) {
            cityTagline.classList.add('city-tagline-loading');
            setTimeout(() => {
                cityTagline.textContent = cityConfig.tagline;
                cityTagline.classList.remove('city-tagline-loading');
                cityTagline.classList.add('city-tagline-loaded');
            }, 300);
        }
        
        if (cityCTAText) {
            cityCTAText.textContent = `Know about other bear events or venues in ${cityConfig.name}? Help us keep this guide current!`;
        }
    }

    showContentSections() {
        // Show content sections that have active views
        const sections = ['.weekly-calendar', '.events', '.events-map-section'];
        
        sections.forEach(selector => {
            const section = document.querySelector(selector);
            if (section) {
                section.classList.remove('content-hidden');
            }
        });
    }

    // Main render function
    async renderCityPage() {
        this.currentCity = this.getCityFromURL();
        this.currentCityConfig = getCityConfig(this.currentCity);
        
        logger.info('CITY', `Rendering city page for: ${this.currentCity}`);
        
        // Set up city selector
        this.setupCitySelector();
        
        // Check if city exists and has calendar
        if (!this.currentCityConfig) {
            logger.componentError('CITY', `City configuration not found: ${this.currentCity}`);
            this.showCityNotFound();
            return;
        }
        
        if (!hasCityCalendar(this.currentCity)) {
            logger.info('CITY', `City ${this.currentCity} doesn't have calendar configured yet`);
            this.updatePageContent(this.currentCityConfig, []);
            return;
        }
        
        // Show loading state
        this.viewManager.showLoadingAll('📅 Getting latest events...');
        
        // Load calendar data
        const data = await this.loadCalendarData(this.currentCity);
        if (data) {
            this.updatePageContent(data.cityConfig, data.events);
        }
    }

    // Public API methods for view management
    enableView(viewName) {
        this.viewManager.enableView(viewName);
        
        // Update HTML data attribute
        const section = document.querySelector(`[data-event-view="${viewName}"]`);
        if (section) {
            section.dataset.viewEnabled = 'true';
        }
        
        logger.userInteraction('EVENT', `View enabled: ${viewName}`);
    }

    disableView(viewName) {
        this.viewManager.disableView(viewName);
        
        // Update HTML data attribute
        const section = document.querySelector(`[data-event-view="${viewName}"]`);
        if (section) {
            section.dataset.viewEnabled = 'false';
        }
        
        logger.userInteraction('EVENT', `View disabled: ${viewName}`);
    }

    // Get specific view for external access
    getView(viewName) {
        return this.viewManager.getView(viewName);
    }

    // Get all active views
    getActiveViews() {
        return this.viewManager.getActiveViews();
    }

    // Initialize
    async init() {
        logger.info('CALENDAR', 'Initializing Modular Calendar Loader...');
        await this.renderCityPage();
    }
}

// Global functions for backward compatibility
function showOnMap(lat, lng, eventName, barName) {
    // Scroll to map section first
    const mapSection = document.querySelector('.events-map-section');
    if (mapSection) {
        mapSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    
    // Focus on event in map
    setTimeout(() => {
        const mapView = window.calendarLoader?.getView('map');
        if (mapView) {
            mapView.focusOnEvent(lat, lng, eventName, barName);
        }
    }, 300);
    
    logger.userInteraction('MAP', 'showOnMap called', { lat, lng, eventName, barName });
}

function fitAllMarkers() {
    if (window.eventsMap && window.eventsMapMarkers && window.eventsMapMarkers.length > 0) {
        const group = new L.featureGroup(window.eventsMapMarkers);
        window.eventsMap.fitBounds(group.getBounds().pad(0.1));
        logger.userInteraction('MAP', 'Fit all markers clicked', { markerCount: window.eventsMapMarkers.length });
    }
}

function showMyLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                
                if (window.eventsMap) {
                    // Remove existing location circle
                    if (window.myLocationCircle) {
                        window.eventsMap.removeLayer(window.myLocationCircle);
                    }
                    
                    // Add location circle
                    window.myLocationCircle = L.circle([lat, lng], {
                        color: '#4285f4',
                        fillColor: '#4285f4',
                        fillOpacity: 0.2,
                        radius: 500,
                        weight: 3
                    }).addTo(window.eventsMap).bindPopup('📍 Your Location');
                    
                    // Calculate bounds that include both user location and all event markers
                    const bounds = L.latLngBounds([[lat, lng]]);
                    
                    if (window.eventsMapMarkers && window.eventsMapMarkers.length > 0) {
                        window.eventsMapMarkers.forEach(marker => {
                            bounds.extend(marker.getLatLng());
                        });
                        
                        window.eventsMap.fitBounds(bounds, {
                            padding: [50, 50],
                            maxZoom: 14
                        });
                    } else {
                        window.eventsMap.setView([lat, lng], 14);
                    }
                    
                    logger.userInteraction('MAP', 'My location shown', { lat, lng });
                }
            },
            (error) => {
                logger.componentError('MAP', 'Location access denied', error);
                alert('Location access denied or unavailable. Please enable location services to use this feature.');
            }
        );
    } else {
        alert('Geolocation is not supported by this browser.');
    }
}

// Export for use in app.js
window.ModularCalendarLoader = ModularCalendarLoader;
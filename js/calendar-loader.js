// Google Calendar iCal Loader
class CalendarEventsLoader {
    constructor() {
        this.eventsData = null;
        this.calendarId = 'a5c9d5609f72549a8c66be0bade4255f0cdd619fa35d009c7de2c1f38ac775e9@group.calendar.google.com';
        this.icalUrl = `https://calendar.google.com/calendar/ical/${this.calendarId}/public/basic.ics`;
        this.debugMode = true; // Enable detailed logging
        this.log('CalendarEventsLoader initialized');
    }

    log(message, data = null) {
        if (this.debugMode) {
            console.log(`[CalendarLoader] ${message}`, data || '');
        }
    }

    error(message, data = null) {
        console.error(`[CalendarLoader ERROR] ${message}`, data || '');
    }

    // Parse iCal format
    parseICalData(icalText) {
        this.log('Starting to parse iCal data', `Text length: ${icalText.length}`);
        const events = [];
        const lines = icalText.split('\n');
        let currentEvent = null;
        let inEvent = false;
        let eventCount = 0;
        
        for (let line of lines) {
            line = line.trim();
            
            if (line === 'BEGIN:VEVENT') {
                inEvent = true;
                currentEvent = {};
                eventCount++;
            } else if (line === 'END:VEVENT' && currentEvent) {
                if (currentEvent.title) {
                    this.log(`Processing event: ${currentEvent.title}`);
                    
                    // Create event data using calendar event fields
                    const eventData = this.parseEventData(currentEvent);
                    
                    if (eventData) {
                        events.push(eventData);
                        this.log(`✅ Successfully parsed event: ${eventData.name}`);
                    } else {
                        this.log(`❌ Failed to parse event data for: ${currentEvent.title}`);
                    }
                } else {
                    this.log(`⚠️ Skipping event missing title: ${currentEvent.title || 'Untitled'}`);
                }
                currentEvent = null;
                inEvent = false;
            } else if (inEvent && currentEvent) {
                if (line.startsWith('SUMMARY:')) {
                    currentEvent.title = line.substring(8).replace(/\\,/g, ',').replace(/\\;/g, ';');
                } else if (line.startsWith('DESCRIPTION:')) {
                    currentEvent.description = line.substring(12).replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
                } else if (line.startsWith('LOCATION:')) {
                    currentEvent.location = line.substring(9).replace(/\\,/g, ',').replace(/\\;/g, ';');
                } else if (line.startsWith('DTSTART')) {
                    const dateMatch = line.match(/DTSTART[^:]*:(.+)/);
                    if (dateMatch) {
                        currentEvent.start = this.parseICalDate(dateMatch[1]);
                    }
                }
            }
        }
        
        this.log(`📊 Finished parsing iCal. Found ${eventCount} total events, ${events.length} with valid data`);
        return events;
    }

    // Simplified event parsing using calendar event fields
    parseEventData(calendarEvent) {
        try {
            // Start with calendar event data
            const eventData = {
                name: calendarEvent.title,
                bar: calendarEvent.location || 'TBD',
                day: this.getDayFromDate(calendarEvent.start),
                time: this.getTimeFromDate(calendarEvent.start),
                cover: 'Check event details',
                eventType: 'weekly'
            };

            // Parse additional details from description JSON if available
            if (calendarEvent.description) {
                const additionalData = this.parseJSONFromDescription(calendarEvent.description);
                if (additionalData) {
                    // Override with JSON data where available, but keep calendar fields as fallback
                    eventData.cover = additionalData.cover || eventData.cover;
                    eventData.tea = additionalData.tea;
                    eventData.links = additionalData.links;
                    eventData.eventType = additionalData.eventType || eventData.eventType;
                    // Only use coordinates if no location is provided in calendar
                    if (!calendarEvent.location && additionalData.coordinates) {
                        eventData.coordinates = additionalData.coordinates;
                    }
                }
            }

            this.log(`✅ Event data parsed successfully`, eventData);
            return eventData;
        } catch (error) {
            this.error(`❌ Failed to parse event data:`, error.message);
            return null;
        }
    }

    // Simple JSON parsing from description
    parseJSONFromDescription(description) {
        try {
            // Look for JSON object in description
            const jsonMatch = description.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const jsonData = JSON.parse(jsonMatch[0]);
                this.log(`✅ JSON parsed from description successfully`);
                return jsonData;
            }
        } catch (error) {
            this.log(`⚠️ No valid JSON found in description:`, error.message);
        }
        return null;
    }

    // Get day of week from date
    getDayFromDate(date) {
        if (!date) return 'TBD';
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[date.getDay()];
    }

    // Get formatted time from date
    getTimeFromDate(date) {
        if (!date) return 'TBD';
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        const displayMinutes = minutes > 0 ? `:${minutes.toString().padStart(2, '0')}` : '';
        return `${displayHours}${displayMinutes}${ampm}`;
    }

    parseICalDate(icalDate) {
        // Handle both timezone and non-timezone formats
        if (icalDate.includes('T')) {
            const dateStr = icalDate.replace(/[TZ]/g, ' ').trim();
            return new Date(dateStr.substring(0, 4) + '-' + 
                          dateStr.substring(4, 6) + '-' + 
                          dateStr.substring(6, 8) + 'T' + 
                          dateStr.substring(9, 11) + ':' + 
                          dateStr.substring(11, 13) + ':' + 
                          dateStr.substring(13, 15));
        }
        return new Date();
    }

    // Fetch calendar data using CORS proxy
    async loadCalendarData() {
        this.log('Starting to load calendar data from Google Calendar');
        try {
            // Use a CORS proxy to fetch the iCal data
            const corsProxy = 'https://api.allorigins.win/raw?url=';
            const fullUrl = corsProxy + encodeURIComponent(this.icalUrl);
            this.log('Fetching from URL:', fullUrl);
            
            const response = await fetch(fullUrl);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const icalText = await response.text();
            this.log('Successfully fetched iCal data', `Length: ${icalText.length} chars`);
            
            const events = this.parseICalData(icalText);
            
            // Group events by city (you could extend this logic)
            this.eventsData = {
                cities: {
                    'new-york': {
                        name: 'New York',
                        emoji: '🗽',
                        tagline: 'What\'s the bear 411?',
                        weeklyEvents: events.filter(e => e.eventType === 'weekly' || !e.eventType),
                        routineEvents: events.filter(e => e.eventType === 'routine')
                    }
                }
            };
            
            this.log('Successfully processed calendar data', {
                weeklyEvents: this.eventsData.cities['new-york'].weeklyEvents.length,
                routineEvents: this.eventsData.cities['new-york'].routineEvents.length
            });
            
            return this.eventsData;
        } catch (error) {
            this.error('Error loading calendar data:', error);
            
            // Fallback to local JSON file
            this.log('Attempting fallback to local JSON file');
            try {
                const response = await fetch('data/events.json');
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                this.eventsData = await response.json();
                this.log('Successfully loaded fallback data', this.eventsData);
                return this.eventsData;
            } catch (fallbackError) {
                this.error('Fallback to local JSON also failed:', fallbackError);
                
                // Show user-friendly error message
                this.showCalendarError();
                return null;
            }
        }
    }

    showCalendarError() {
        const calendarGrid = document.querySelector('.calendar-grid');
        const weeklyEventsList = document.querySelector('.weekly-events .events-list');
        const routineEventsList = document.querySelector('.routine-events .events-list');
        
        const errorMessage = `
            <div class="error-message" style="padding: 20px; background: #ffe6e6; border: 1px solid #ff9999; border-radius: 8px; margin: 10px 0;">
                <h3>📅 Calendar Temporarily Unavailable</h3>
                <p>We're having trouble loading the latest events from our calendar. This might be due to:</p>
                <ul>
                    <li>Temporary network issues</li>
                    <li>Calendar service maintenance</li>
                    <li>CORS proxy limitations</li>
                </ul>
                <p><strong>Try:</strong> Refreshing the page in a few minutes, or check our <a href="https://www.instagram.com/bearhappyhournyc" target="_blank">Instagram</a> for the latest updates.</p>
            </div>
        `;
        
        if (calendarGrid) calendarGrid.innerHTML = errorMessage;
        if (weeklyEventsList) weeklyEventsList.innerHTML = errorMessage;
        if (routineEventsList) routineEventsList.innerHTML = '<p>No routine events available at the moment.</p>';
    }

    getCityFromUrl() {
        const path = window.location.pathname;
        const filename = path.split('/').pop().replace('.html', '');
        const cityKey = filename === 'index' ? null : filename;
        this.log('Detected city from URL:', cityKey);
        return cityKey;
    }

    generateEventCard(event) {
        const linksHtml = event.links ? event.links.map(link => 
            `<a href="${link.url}" target="_blank" rel="noopener">${link.label}</a>`
        ).join('') : '';

        const teaHtml = event.tea ? `
            <div class="detail-row tea">
                <span class="label">Tea:</span>
                <span class="value">${event.tea}</span>
            </div>
        ` : '';

        const locationHtml = event.coordinates ? 
            `<div class="detail-row">
                <span class="label">Location:</span>
                <span class="value">
                    <a href="#" onclick="showOnMap(${event.coordinates.lat}, ${event.coordinates.lng}, '${event.name}', '${event.bar}')" class="map-link">
                        📍 ${event.bar}
                    </a>
                </span>
            </div>` :
            `<div class="detail-row">
                <span class="label">Bar:</span>
                <span class="value">${event.bar}</span>
            </div>`;

        return `
            <div class="event-card detailed" data-lat="${event.coordinates?.lat || ''}" data-lng="${event.coordinates?.lng || ''}">
                <div class="event-header">
                    <h3>${event.name}</h3>
                    <div class="event-day">${event.day} ${event.time}</div>
                </div>
                <div class="event-details">
                    ${locationHtml}
                    <div class="detail-row">
                        <span class="label">Cover:</span>
                        <span class="value">${event.cover}</span>
                    </div>
                    ${teaHtml}
                    <div class="event-links">
                        ${linksHtml}
                    </div>
                </div>
            </div>
        `;
    }

    generateCalendarEvents(events) {
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const eventsByDay = {};

        // Initialize all days
        daysOfWeek.forEach(day => {
            eventsByDay[day] = [];
        });

        // Group events by day
        [...events.weeklyEvents, ...events.routineEvents].forEach(event => {
            if (eventsByDay[event.day]) {
                eventsByDay[event.day].push(event.name);
            }
        });

        return daysOfWeek.map(day => {
            const eventsHtml = eventsByDay[day].length > 0 
                ? eventsByDay[day].map(eventName => `<div class="event-item">${eventName}</div>`).join('')
                : '<!-- No events -->';

            const isToday = new Date().getDay() === daysOfWeek.indexOf(day);
            const currentClass = isToday ? ' current' : '';

            return `
                <div class="calendar-day${currentClass}">
                    <h3>${day}</h3>
                    <div class="events">
                        ${eventsHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    async renderCityPage(cityKey) {
        this.log(`Starting to render city page for: ${cityKey}`);
        
        if (!this.eventsData) {
            this.log('No events data loaded, attempting to load...');
            await this.loadCalendarData();
        }

        if (!this.eventsData) {
            this.error('Failed to load any events data');
            return;
        }

        if (!this.eventsData.cities[cityKey]) {
            this.error(`City data not found for: ${cityKey}`, Object.keys(this.eventsData.cities));
            return;
        }

        const cityData = this.eventsData.cities[cityKey];
        this.log(`Rendering city data for ${cityData.name}`, {
            weeklyEvents: cityData.weeklyEvents?.length || 0,
            routineEvents: cityData.routineEvents?.length || 0
        });

        // Update city header
        const cityHeader = document.querySelector('.city-header h1');
        const cityTagline = document.querySelector('.city-tagline');
        
        if (cityHeader) {
            cityHeader.textContent = `${cityData.emoji} ${cityData.name}`;
            this.log('Updated city header');
        } else {
            this.log('City header element not found');
        }
        
        if (cityTagline) {
            cityTagline.textContent = cityData.tagline;
            this.log('Updated city tagline');
        } else {
            this.log('City tagline element not found');
        }

        // Update calendar
        const calendarGrid = document.querySelector('.calendar-grid');
        if (calendarGrid) {
            calendarGrid.innerHTML = this.generateCalendarEvents(cityData);
            this.log('Updated calendar grid');
        } else {
            this.log('Calendar grid element not found');
        }

        // Update weekly events
        const weeklyEventsList = document.querySelector('.weekly-events .events-list');
        if (weeklyEventsList && cityData.weeklyEvents) {
            weeklyEventsList.innerHTML = cityData.weeklyEvents.map(event => 
                this.generateEventCard(event)
            ).join('');
            this.log(`Updated weekly events list with ${cityData.weeklyEvents.length} events`);
        } else {
            this.log('Weekly events list element not found or no weekly events');
        }

        // Update routine events
        const routineEventsList = document.querySelector('.routine-events .events-list');
        if (routineEventsList && cityData.routineEvents) {
            routineEventsList.innerHTML = cityData.routineEvents.map(event => 
                this.generateEventCard(event)
            ).join('');
            this.log(`Updated routine events list with ${cityData.routineEvents.length} events`);
        } else {
            this.log('Routine events list element not found or no routine events');
        }

        // Initialize map with all events
        this.initializeMap(cityData);

        // Update page title
        document.title = `${cityData.name} - Chunky Dad Bear Guide`;
        
        // Update meta description
        const metaDescription = document.querySelector('meta[name="description"]');
        if (metaDescription) {
            metaDescription.setAttribute('content', 
                `Complete gay bear guide to ${cityData.name} - events, bars, and the hottest bear scene`
            );
        }
        
        this.log('City page rendering completed successfully');
    }

    initializeMap(cityData) {
        const mapContainer = document.querySelector('#events-map');
        if (!mapContainer) {
            this.log('Map container not found - skipping map initialization');
            return;
        }

        this.log('Initializing map...');
        
        try {
            // Check if Leaflet is available
            if (typeof L === 'undefined') {
                this.error('Leaflet library not loaded - cannot initialize map');
                mapContainer.innerHTML = '<p>Map temporarily unavailable. Please refresh the page.</p>';
                return;
            }

            // Initialize Leaflet map
            const map = L.map('events-map').setView([40.7831, -73.9712], 12); // NYC center

            // Add OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);

            // Add markers for events with coordinates
            const allEvents = [...(cityData.weeklyEvents || []), ...(cityData.routineEvents || [])];
            let markersAdded = 0;
            
            allEvents.forEach(event => {
                if (event.coordinates && event.coordinates.lat && event.coordinates.lng) {
                    const marker = L.marker([event.coordinates.lat, event.coordinates.lng])
                        .addTo(map)
                        .bindPopup(`
                            <div class="map-popup">
                                <h4>${event.name}</h4>
                                <p><strong>${event.bar}</strong></p>
                                <p>${event.day} ${event.time}</p>
                                <p>Cover: ${event.cover}</p>
                            </div>
                        `);
                    markersAdded++;
                }
            });

            this.log(`Map initialized successfully with ${markersAdded} markers`);

            // Store map reference globally for showOnMap function
            window.eventsMap = map;
        } catch (error) {
            this.error('Failed to initialize map:', error);
            mapContainer.innerHTML = '<p>Map temporarily unavailable. Please refresh the page.</p>';
        }
    }

    async init() {
        this.log('Initializing CalendarEventsLoader...');
        const cityKey = this.getCityFromUrl();
        if (cityKey) {
            this.log(`City detected: ${cityKey} - starting page render`);
            await this.renderCityPage(cityKey);
        } else {
            this.log('No city detected from URL - likely on homepage');
        }
    }
}

// Global function to show location on map
function showOnMap(lat, lng, eventName, barName) {
    if (window.eventsMap) {
        window.eventsMap.setView([lat, lng], 16);
        // Find and open the popup for this location
        window.eventsMap.eachLayer(layer => {
            if (layer instanceof L.Marker) {
                const latLng = layer.getLatLng();
                if (Math.abs(latLng.lat - lat) < 0.0001 && Math.abs(latLng.lng - lng) < 0.0001) {
                    layer.openPopup();
                }
            }
        });
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const calendarLoader = new CalendarEventsLoader();
    calendarLoader.init();
});

// Export for potential use in other scripts
window.CalendarEventsLoader = CalendarEventsLoader;
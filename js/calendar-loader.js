// Enhanced Google Calendar Loader - Now uses native calendar fields + key/value parsing
class CalendarEventsLoader {
    constructor() {
        this.eventsData = null;
        this.calendarId = 'a5c9d5609f72549a8c66be0bade4255f0cdd619fa35d009c7de2c1f38ac775e9@group.calendar.google.com';
        this.icalUrl = `https://calendar.google.com/calendar/ical/${this.calendarId}/public/basic.ics`;
        this.debugMode = true;
        this.locationCache = new Map(); // Cache for location geocoding
        this.log('Enhanced CalendarEventsLoader initialized');
    }

    log(message, data = null) {
        if (this.debugMode) {
            console.log(`[CalendarLoader] ${message}`, data || '');
        }
    }

    error(message, data = null) {
        console.error(`[CalendarLoader ERROR] ${message}`, data || '');
    }

    // Enhanced iCal parsing with full calendar field support
    parseICalData(icalText) {
        this.log('Starting enhanced iCal parsing', `Text length: ${icalText.length}`);
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
                    
                    const eventData = this.parseEventData(currentEvent);
                    
                    if (eventData) {
                        events.push(eventData);
                        this.log(`✅ Successfully parsed event: ${eventData.name}`);
                    } else {
                        this.log(`❌ Failed to parse event data for: ${currentEvent.title}`);
                    }
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
                } else if (line.startsWith('DTEND')) {
                    const dateMatch = line.match(/DTEND[^:]*:(.+)/);
                    if (dateMatch) {
                        currentEvent.end = this.parseICalDate(dateMatch[1]);
                    }
                } else if (line.startsWith('RRULE:')) {
                    currentEvent.recurrence = line.substring(6);
                }
            }
        }
        
        this.log(`📊 Enhanced parsing complete. Found ${eventCount} total events, ${events.length} with valid data`);
        return events;
    }

    // Enhanced event parsing using calendar fields as primary source
    parseEventData(calendarEvent) {
        try {
            // Start with Google Calendar native fields as primary source
            const eventData = {
                name: calendarEvent.title,
                bar: calendarEvent.location || 'TBD',
                day: this.getDayFromDate(calendarEvent.start),
                time: this.getTimeRange(calendarEvent.start, calendarEvent.end),
                cover: 'Check event details',
                eventType: this.getEventType(calendarEvent.recurrence),
                recurring: !!calendarEvent.recurrence,
                location: calendarEvent.location || '',
                originalDate: calendarEvent.start,
                coordinates: null // Will be resolved later if needed
            };

            // Parse key/value pairs from description
            if (calendarEvent.description) {
                const additionalData = this.parseKeyValueDescription(calendarEvent.description);
                
                // Merge additional data, but keep calendar fields as primary
                if (additionalData) {
                    eventData.cover = additionalData.cover || eventData.cover;
                    eventData.tea = additionalData.tea || additionalData.description;
                    eventData.links = this.parseLinks(additionalData);
                    eventData.website = additionalData.website;
                    eventData.instagram = additionalData.instagram;
                    eventData.facebook = additionalData.facebook;
                    
                    // Override eventType if specified in description
                    if (additionalData.type || additionalData.eventType) {
                        eventData.eventType = additionalData.type || additionalData.eventType;
                    }
                }
            }

            // Add routing support
            eventData.slug = this.generateSlug(eventData.name);
            eventData.citySlug = this.getCityFromUrl();

            this.log(`✅ Enhanced event data parsed successfully`, eventData);
            return eventData;
        } catch (error) {
            this.error(`❌ Failed to parse event data:`, error.message);
            return null;
        }
    }

    // Parse key/value pairs from description (as shown in user's examples)
    parseKeyValueDescription(description) {
        const data = {};
        const lines = description.split('\n');
        
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            
            // Support multiple key-value formats: Key: Value, Key = Value, Key - Value
            const keyValueMatch = line.match(/^([^:=\-]+)[:=\-]\s*(.+)$/);
            if (keyValueMatch) {
                const key = keyValueMatch[1].trim().toLowerCase();
                const value = keyValueMatch[2].trim();
                
                // Map common variations to standard keys
                const keyMap = {
                    'cover': 'cover',
                    'cost': 'cover',
                    'price': 'cover',
                    'tea': 'tea',
                    'info': 'tea',
                    'description': 'tea',
                    'website': 'website',
                    'instagram': 'instagram',
                    'facebook': 'facebook',
                    'type': 'type',
                    'eventtype': 'type',
                    'recurring': 'recurring'
                };
                
                const mappedKey = keyMap[key] || key;
                data[mappedKey] = value;
                
                this.log(`📝 Parsed key-value: ${key} -> ${mappedKey}: ${value}`);
            }
        }
        
        return Object.keys(data).length > 0 ? data : null;
    }

    // Parse social links from key/value data
    parseLinks(data) {
        const links = [];
        
        if (data.website) {
            links.push({
                type: 'website',
                url: data.website,
                label: '🌐 Website'
            });
        }
        
        if (data.instagram) {
            links.push({
                type: 'instagram',
                url: data.instagram,
                label: '📷 Instagram'
            });
        }
        
        if (data.facebook) {
            links.push({
                type: 'facebook',
                url: data.facebook,
                label: '📘 Facebook'
            });
        }
        
        return links.length > 0 ? links : null;
    }

    // Generate URL-friendly slug
    generateSlug(name) {
        return name.toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
    }

    // Enhanced day parsing
    getDayFromDate(date) {
        if (!date) return 'TBD';
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[date.getDay()];
    }

    // Enhanced time range formatting
    getTimeRange(startDate, endDate) {
        if (!startDate) return 'TBD';
        
        const formatTime = (date) => {
            const hours = date.getHours();
            const minutes = date.getMinutes();
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours % 12 || 12;
            const displayMinutes = minutes > 0 ? `:${minutes.toString().padStart(2, '0')}` : '';
            return `${displayHours}${displayMinutes}${ampm}`;
        };
        
        const startTime = formatTime(startDate);
        
        if (endDate) {
            const endTime = formatTime(endDate);
            return `${startTime} - ${endTime}`;
        }
        
        return startTime;
    }

    // Determine event type from recurrence
    getEventType(recurrence) {
        if (!recurrence) return 'routine';
        
        if (recurrence.includes('WEEKLY')) return 'weekly';
        if (recurrence.includes('MONTHLY')) return 'monthly';
        if (recurrence.includes('DAILY')) return 'daily';
        
        return 'recurring';
    }

    // Enhanced date parsing
    parseICalDate(icalDate) {
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

    // Geocode location using OpenStreetMap Nominatim
    async geocodeLocation(location) {
        if (!location || location === 'TBD') return null;
        
        // Check cache first
        if (this.locationCache.has(location)) {
            return this.locationCache.get(location);
        }
        
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(location + ' New York')}&limit=1`;
            const response = await fetch(url);
            const data = await response.json();
            
            if (data && data.length > 0) {
                const result = {
                    lat: parseFloat(data[0].lat),
                    lng: parseFloat(data[0].lon),
                    display_name: data[0].display_name
                };
                
                // Cache the result
                this.locationCache.set(location, result);
                this.log(`🗺️ Geocoded location: ${location} -> ${result.lat}, ${result.lng}`);
                return result;
            }
        } catch (error) {
            this.error(`Failed to geocode location: ${location}`, error);
        }
        
        return null;
    }

    // Enhanced calendar data loading
    async loadCalendarData() {
        this.log('Starting enhanced calendar data loading');
        try {
            const corsProxy = 'https://api.allorigins.win/raw?url=';
            const fullUrl = corsProxy + encodeURIComponent(this.icalUrl);
            
            const response = await fetch(fullUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const icalText = await response.text();
            this.log('Successfully fetched iCal data', `Length: ${icalText.length} chars`);
            
            const events = this.parseICalData(icalText);
            
            // Geocode locations for events that don't have coordinates
            for (let event of events) {
                if (event.location && !event.coordinates) {
                    const coords = await this.geocodeLocation(event.location);
                    if (coords) {
                        event.coordinates = { lat: coords.lat, lng: coords.lng };
                        event.locationDisplayName = coords.display_name;
                    }
                }
            }
            
            // Group events by city with enhanced structure
            this.eventsData = {
                cities: {
                    'new-york': {
                        name: 'New York',
                        emoji: '🗽',
                        tagline: 'What\'s the bear 411?',
                        weeklyEvents: events.filter(e => e.eventType === 'weekly'),
                        routineEvents: events.filter(e => e.eventType === 'routine'),
                        monthlyEvents: events.filter(e => e.eventType === 'monthly'),
                        allEvents: events
                    }
                }
            };
            
            this.log('Successfully processed enhanced calendar data', {
                total: events.length,
                weekly: this.eventsData.cities['new-york'].weeklyEvents.length,
                routine: this.eventsData.cities['new-york'].routineEvents.length,
                monthly: this.eventsData.cities['new-york'].monthlyEvents.length
            });
            
            return this.eventsData;
        } catch (error) {
            this.error('Error loading calendar data:', error);
            return await this.loadFallbackData();
        }
    }

    // Load fallback data
    async loadFallbackData() {
        this.log('Attempting fallback to local JSON file');
        try {
            const response = await fetch('data/events.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.eventsData = await response.json();
            this.log('Successfully loaded fallback data');
            return this.eventsData;
        } catch (fallbackError) {
            this.error('Fallback to local JSON also failed:', fallbackError);
            this.showCalendarError();
            return null;
        }
    }

    // Enhanced error display
    showCalendarError() {
        const errorMessage = `
            <div class="error-message">
                <h3>📅 Calendar Temporarily Unavailable</h3>
                <p>We're having trouble loading the latest events. This might be due to:</p>
                <ul>
                    <li>Temporary network issues</li>
                    <li>Calendar service maintenance</li>
                    <li>CORS proxy limitations</li>
                </ul>
                <p><strong>Try:</strong> Refreshing the page in a few minutes, or check our social media for updates.</p>
            </div>
        `;
        
        document.querySelectorAll('.calendar-grid, .events-list').forEach(el => {
            if (el) el.innerHTML = errorMessage;
        });
    }

    // Get city from URL with enhanced routing support
    getCityFromUrl() {
        const path = window.location.pathname;
        const filename = path.split('/').pop().replace('.html', '');
        
        // Support various URL formats
        const cityMap = {
            'new-york': 'new-york',
            'nyc': 'new-york',
            'newyork': 'new-york',
            'san-francisco': 'san-francisco',
            'sf': 'san-francisco',
            'sanfrancisco': 'san-francisco'
        };
        
        const cityKey = cityMap[filename] || filename;
        this.log('Detected city from URL:', cityKey);
        return cityKey === 'index' ? null : cityKey;
    }

    // Enhanced event card generation
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

        const recurringBadge = event.recurring ? 
            `<span class="recurring-badge">🔄 ${event.eventType}</span>` : '';

        return `
            <div class="event-card detailed" data-event-slug="${event.slug}" data-lat="${event.coordinates?.lat || ''}" data-lng="${event.coordinates?.lng || ''}">
                <div class="event-header">
                    <h3>${event.name}</h3>
                    <div class="event-meta">
                        <div class="event-day">${event.day} ${event.time}</div>
                        ${recurringBadge}
                    </div>
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

    // Enhanced calendar generation
    generateCalendarEvents(events) {
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const eventsByDay = {};
        const today = new Date();
        const todayDayName = daysOfWeek[today.getDay()];

        // Initialize all days
        daysOfWeek.forEach(day => {
            eventsByDay[day] = [];
        });

        // Group events by day
        [...events.weeklyEvents, ...events.routineEvents, ...(events.monthlyEvents || [])].forEach(event => {
            if (eventsByDay[event.day]) {
                eventsByDay[event.day].push(event);
            }
        });

        return daysOfWeek.map(day => {
            const dayEvents = eventsByDay[day];
            const eventsHtml = dayEvents.length > 0 
                ? dayEvents.map(event => `
                    <div class="event-item" data-event-slug="${event.slug}">
                        <div class="event-name">${event.name}</div>
                        <div class="event-time">${event.time}</div>
                        <div class="event-venue">${event.bar}</div>
                    </div>
                `).join('')
                : '<div class="no-events">No events</div>';

            const isToday = day === todayDayName;
            const currentClass = isToday ? ' current' : '';
            const dayNumber = today.getDate();

            return `
                <div class="calendar-day${currentClass}" data-day="${day}">
                    <div class="day-header">
                        <h3>${day}</h3>
                        ${isToday ? `<span class="day-indicator">Today</span>` : ''}
                    </div>
                    <div class="events">
                        ${eventsHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    // Enhanced city page rendering
    async renderCityPage(cityKey) {
        this.log(`Starting enhanced city page render for: ${cityKey}`);
        
        if (!this.eventsData) {
            await this.loadCalendarData();
        }

        if (!this.eventsData?.cities[cityKey]) {
            this.error(`City data not found for: ${cityKey}`);
            return;
        }

        const cityData = this.eventsData.cities[cityKey];
        this.log(`Rendering enhanced city data for ${cityData.name}`);

        // Update city header
        const cityHeader = document.querySelector('.city-header h1');
        const cityTagline = document.querySelector('.city-tagline');
        
        if (cityHeader) cityHeader.textContent = `${cityData.emoji} ${cityData.name}`;
        if (cityTagline) cityTagline.textContent = cityData.tagline;

        // Update enhanced calendar
        const calendarGrid = document.querySelector('.calendar-grid');
        if (calendarGrid) {
            calendarGrid.innerHTML = this.generateCalendarEvents(cityData);
            this.attachCalendarInteractions();
        }

        // Update event sections
        this.updateEventSection('.weekly-events .events-list', cityData.weeklyEvents);
        this.updateEventSection('.routine-events .events-list', cityData.routineEvents);
        
        // Add monthly events section if exists
        if (cityData.monthlyEvents?.length > 0) {
            this.addMonthlyEventsSection(cityData.monthlyEvents);
        }

        // Initialize enhanced map
        this.initializeEnhancedMap(cityData);

        // Update page metadata
        this.updatePageMetadata(cityData);
        
        this.log('Enhanced city page rendering completed');
    }

    // Update event section helper
    updateEventSection(selector, events) {
        const section = document.querySelector(selector);
        if (section && events?.length > 0) {
            section.innerHTML = events.map(event => this.generateEventCard(event)).join('');
        }
    }

    // Add monthly events section if needed
    addMonthlyEventsSection(monthlyEvents) {
        const routineSection = document.querySelector('.routine-events');
        if (routineSection && monthlyEvents.length > 0) {
            const monthlySection = document.createElement('section');
            monthlySection.className = 'monthly-events';
            monthlySection.innerHTML = `
                <div class="container">
                    <h2>Monthly Events</h2>
                    <div class="events-list">
                        ${monthlyEvents.map(event => this.generateEventCard(event)).join('')}
                    </div>
                </div>
            `;
            routineSection.parentNode.insertBefore(monthlySection, routineSection.nextSibling);
        }
    }

    // Add calendar interactions
    attachCalendarInteractions() {
        document.querySelectorAll('.event-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const eventSlug = item.dataset.eventSlug;
                const eventCard = document.querySelector(`.event-card[data-event-slug="${eventSlug}"]`);
                if (eventCard) {
                    eventCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    eventCard.classList.add('highlight');
                    setTimeout(() => eventCard.classList.remove('highlight'), 2000);
                }
            });
        });
    }

    // Enhanced map initialization
    initializeEnhancedMap(cityData) {
        const mapContainer = document.querySelector('#events-map');
        if (!mapContainer || typeof L === 'undefined') return;

        try {
            const map = L.map('events-map').setView([40.7831, -73.9712], 12);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);

            const allEvents = [
                ...(cityData.weeklyEvents || []), 
                ...(cityData.routineEvents || []),
                ...(cityData.monthlyEvents || [])
            ];
            
            let markersAdded = 0;
            
            allEvents.forEach(event => {
                if (event.coordinates?.lat && event.coordinates?.lng) {
                    const marker = L.marker([event.coordinates.lat, event.coordinates.lng])
                        .addTo(map)
                        .bindPopup(`
                            <div class="map-popup">
                                <h4>${event.name}</h4>
                                <p><strong>${event.bar}</strong></p>
                                <p>${event.day} ${event.time}</p>
                                <p>Cover: ${event.cover}</p>
                                ${event.recurring ? `<p>🔄 ${event.eventType}</p>` : ''}
                            </div>
                        `);
                    markersAdded++;
                }
            });

            this.log(`Enhanced map initialized with ${markersAdded} markers`);
            window.eventsMap = map;
        } catch (error) {
            this.error('Failed to initialize enhanced map:', error);
        }
    }

    // Update page metadata
    updatePageMetadata(cityData) {
        document.title = `${cityData.name} - Chunky Dad Bear Guide`;
        
        const metaDescription = document.querySelector('meta[name="description"]');
        if (metaDescription) {
            metaDescription.setAttribute('content', 
                `Complete gay bear guide to ${cityData.name} - events, bars, and the hottest bear scene`
            );
        }
    }

    // Initialize the enhanced system
    async init() {
        this.log('Initializing enhanced CalendarEventsLoader...');
        const cityKey = this.getCityFromUrl();
        if (cityKey) {
            await this.renderCityPage(cityKey);
        }
    }
}

// Enhanced map interaction function
function showOnMap(lat, lng, eventName, barName) {
    if (window.eventsMap) {
        window.eventsMap.setView([lat, lng], 16);
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

// Initialize enhanced system
document.addEventListener('DOMContentLoaded', () => {
    const calendarLoader = new CalendarEventsLoader();
    calendarLoader.init();
});

window.CalendarEventsLoader = CalendarEventsLoader;
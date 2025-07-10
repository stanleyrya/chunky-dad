// Dynamic Google Calendar Loader - Supports multiple cities and calendars
class DynamicCalendarLoader {
    constructor() {
        this.eventsData = null;
        this.currentCity = null;
        this.currentCityConfig = null;
        this.debugMode = true;
        this.locationCache = new Map();
        this.log('Dynamic CalendarLoader initialized');
    }

    log(message, data = null) {
        if (this.debugMode) {
            console.log(`[DynamicCalendarLoader] ${message}`, data || '');
        }
    }

    error(message, data = null) {
        console.error(`[DynamicCalendarLoader ERROR] ${message}`, data || '');
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
            // Clear existing options except the first one
            citySelect.innerHTML = '<option value="">Select a city...</option>';
            
            // Add available cities to selector
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

            // Add change event listener
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

    // Enhanced iCal parsing (same as original but with dynamic calendar ID)
    parseICalData(icalText) {
        this.log('Starting iCal parsing', `Text length: ${icalText.length}`);
        const events = [];
        const lines = icalText.split('\n');
        let currentEvent = null;
        let inEvent = false;
        let eventCount = 0;
        
        for (let line of lines) {
            line = line.slice(0, -1); // Remove trailing character
            
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
                    }
                }
                currentEvent = null;
                inEvent = false;
            } else if (inEvent && currentEvent) {
                if (line.startsWith('SUMMARY:')) {
                    currentEvent.title = line.substring(8).replace(/\\,/g, ',').replace(/\\;/g, ';');
                } else if (line.startsWith('DESCRIPTION:')) {
                    currentEvent.description = line.substring(12).replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
                } else if (line.startsWith(' ') && currentEvent.description) {
                    currentEvent.description += line.substring(1);
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
        
        this.log(`📊 Parsing complete. Found ${eventCount} total events, ${events.length} with valid data`);
        return events;
    }

    // Parse event data (same logic as original)
    parseEventData(calendarEvent) {
        try {
            const eventData = {
                name: calendarEvent.title,
                day: this.getDayFromDate(calendarEvent.start),
                time: this.getTimeRange(calendarEvent.start, calendarEvent.end),
                cover: 'Check event details',
                eventType: this.getEventType(calendarEvent.recurrence),
                recurring: !!calendarEvent.recurrence,
                coordinates: calendarEvent.location
            };

            // Parse description for additional data
            if (calendarEvent.description) {
                const additionalData = this.parseKeyValueDescription(calendarEvent.description);
                if (additionalData) {
                    eventData.bar = additionalData.bar || 'TBD';
                    eventData.cover = additionalData.cover || eventData.cover;
                    eventData.tea = additionalData.tea || additionalData.description;
                    eventData.website = additionalData.website;
                    eventData.instagram = additionalData.instagram;
                    eventData.facebook = additionalData.facebook;
                    eventData.gmaps = additionalData.gmaps;
                    eventData.links = this.parseLinks(additionalData);
                    
                    if (additionalData.type || additionalData.eventType) {
                        eventData.eventType = additionalData.type || additionalData.eventType;
                    }
                }
            }
            
            // Parse coordinates
            if (calendarEvent.location) {
                const latlong = calendarEvent.location.split(",");
                eventData.coordinates = { 
                    lat: parseFloat(latlong[0]?.trim()), 
                    lng: parseFloat(latlong[1]?.trim()) 
                };
            }

            eventData.slug = this.generateSlug(eventData.name);
            eventData.citySlug = this.currentCity;

            return eventData;
        } catch (error) {
            this.error(`Failed to parse event data:`, error.message);
            return null;
        }
    }

    // Helper methods (same as original)
    parseKeyValueDescription(description) {
        const data = {};
        const keyMap = {
            'bar': 'bar', 'location': 'bar', 'host': 'bar',
            'cover': 'cover', 'cost': 'cover', 'price': 'cover',
            'tea': 'tea', 'info': 'tea', 'description': 'tea',
            'website': 'website', 'instagram': 'instagram', 'facebook': 'facebook',
            'type': 'type', 'eventtype': 'type', 'recurring': 'recurring',
            'gmaps': 'gmaps', 'google maps': 'gmaps'
        };

        let textBlock = description;
        if (textBlock.includes("<br>")) {
            textBlock = textBlock.replace(/<br\s?\/?>/gi, "\n");
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = textBlock;
            textBlock = tempDiv.textContent || tempDiv.innerText || '';
        }
        
        const lines = textBlock.replace("\\n", "\n").split("\n");
        
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            
            const keyValueMatch = line.match(/([^:=\-]+)[:=\-]\s*(.+)/);
            if (keyValueMatch) {
                const key = keyValueMatch[1].trim().toLowerCase();
                const value = keyValueMatch[2].trim();
                const mappedKey = keyMap[key] || key;
                data[mappedKey] = value;
            }
        }
        
        return Object.keys(data).length > 0 ? data : null;
    }

    parseLinks(data) {
        const links = [];
        
        if (data.website) {
            links.push({ type: 'website', url: data.website, label: '🌐 Website' });
        }
        if (data.instagram) {
            links.push({ type: 'instagram', url: data.instagram, label: '📷 Instagram' });
        }
        if (data.facebook) {
            links.push({ type: 'facebook', url: data.facebook, label: '📘 Facebook' });
        }
        if (data.gmaps) {
            links.push({ type: 'gmaps', url: data.gmaps, label: '🗺️ Google Maps' });
        }
        
        return links.length > 0 ? links : null;
    }

    generateSlug(name) {
        return name.toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
    }

    getDayFromDate(date) {
        if (!date) return 'TBD';
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[date.getDay()];
    }

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

    getEventType(recurrence) {
        if (!recurrence) return 'routine';
        if (recurrence.includes('WEEKLY')) return 'weekly';
        if (recurrence.includes('MONTHLY')) return 'monthly';
        if (recurrence.includes('DAILY')) return 'daily';
        return 'recurring';
    }

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

    // Load calendar data for specific city
    async loadCalendarData(cityKey) {
        const cityConfig = getCityConfig(cityKey);
        if (!cityConfig || !cityConfig.calendarId) {
            this.error(`No calendar configuration found for city: ${cityKey}`);
            return null;
        }

        this.log(`Loading calendar data for ${cityConfig.name}`);
        
        try {
            const icalUrl = `https://calendar.google.com/calendar/ical/${cityConfig.calendarId}/public/basic.ics`;
            const corsProxy = 'https://api.allorigins.win/raw?url=';
            const fullUrl = corsProxy + encodeURIComponent(icalUrl);
            
            const response = await fetch(fullUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const icalText = await response.text();
            this.log('Successfully fetched iCal data', `Length: ${icalText.length} chars`);
            
            const events = this.parseICalData(icalText);
            
            this.eventsData = {
                cityConfig,
                events
            };
            
            this.log(`Successfully processed calendar data for ${cityConfig.name}`, events);
            return this.eventsData;
        } catch (error) {
            this.error('Error loading calendar data:', error);
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
        
        document.querySelectorAll('.calendar-grid, .events-list').forEach(el => {
            if (el) el.innerHTML = errorMessage;
        });
    }

    // Generate event card (same as original)
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

        const locationHtml = event.coordinates && event.coordinates.lat && event.coordinates.lng ? 
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

    // Generate calendar events (same as original)
    generateCalendarEvents(events) {
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const eventsByDay = {};
        const today = new Date();
        const todayDayName = daysOfWeek[today.getDay()];

        daysOfWeek.forEach(day => {
            eventsByDay[day] = [];
        });

        (events || []).forEach(event => {
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

            return `
                <div class="calendar-day${currentClass}" data-day="${day}">
                    <div class="day-header">
                        <h3>${day}</h3>
                        ${isToday ? `<span class="day-indicator">Today</span>` : ''}
                    </div>
                    <div class="daily-events">
                        ${eventsHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    // Initialize map
    initializeMap(cityConfig, events) {
        const mapContainer = document.querySelector('#events-map');
        if (!mapContainer || typeof L === 'undefined') return;

        try {
            const map = L.map('events-map').setView([
                cityConfig.coordinates.lat, 
                cityConfig.coordinates.lng
            ], cityConfig.mapZoom);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);
            
            let markersAdded = 0;
            
            events.forEach(event => {
                if (event.coordinates?.lat && event.coordinates?.lng && 
                    !isNaN(event.coordinates.lat) && !isNaN(event.coordinates.lng)) {
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

            this.log(`Map initialized with ${markersAdded} markers for ${cityConfig.name}`);
            window.eventsMap = map;
        } catch (error) {
            this.error('Failed to initialize map:', error);
        }
    }

    // Update page content for city
    updatePageContent(cityConfig, events) {
        // Update title and tagline immediately without typing animation
        const cityTitle = document.getElementById('city-title');
        const cityTagline = document.getElementById('city-tagline');
        const cityCTAText = document.getElementById('city-cta-text');
        
        if (cityTitle) {
            cityTitle.classList.remove('city-title-hidden');
            cityTitle.textContent = `${cityConfig.emoji} ${cityConfig.name}`;
        }
        if (cityTagline) {
            cityTagline.classList.remove('city-tagline-hidden');
            cityTagline.textContent = cityConfig.tagline;
        }
        if (cityCTAText) {
            cityCTAText.textContent = `Know about other bear events or venues in ${cityConfig.name}? Help us keep this guide current!`;
        }

        // Update calendar immediately
        const calendarGrid = document.querySelector('.calendar-grid');
        const calendarSection = document.querySelector('.weekly-calendar');
        if (calendarGrid) {
            calendarGrid.innerHTML = this.generateCalendarEvents(events);
            this.attachCalendarInteractions();
            calendarSection?.classList.remove('content-hidden');
        }

        // Update events list immediately
        const eventsList = document.querySelector('.events-list');
        const eventsSection = document.querySelector('.events');
        if (eventsList) {
            if (events?.length > 0) {
                eventsList.innerHTML = events.map(event => this.generateEventCard(event)).join('');
            } else {
                eventsList.innerHTML = `
                    <div class="no-events-message">
                        <h3>📅 No Events Yet</h3>
                        <p>We're still gathering event information for ${cityConfig.name}.</p>
                        <p>Check back soon or help us by submitting events you know about!</p>
                    </div>
                `;
            }
            eventsSection?.classList.remove('content-hidden');
        }

        // Initialize map immediately
        const mapSection = document.querySelector('.events-map-section');
        this.initializeMap(cityConfig, events);
        mapSection?.classList.remove('content-hidden');

        // Update page metadata
        document.title = `${cityConfig.name} - Chunky Dad Bear Guide`;
        const metaDescription = document.querySelector('meta[name="description"]');
        if (metaDescription) {
            metaDescription.setAttribute('content', 
                `Complete gay bear guide to ${cityConfig.name} - events, bars, and the hottest bear scene`
            );
        }
    }

    // Attach calendar interactions
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

    // Main render function
    async renderCityPage() {
        this.currentCity = this.getCityFromURL();
        this.currentCityConfig = getCityConfig(this.currentCity);
        
        this.log(`Rendering city page for: ${this.currentCity}`);
        
        // Set up city selector
        this.setupCitySelector();
        
        // Check if city exists and has calendar
        if (!this.currentCityConfig) {
            this.error(`City configuration not found: ${this.currentCity}`);
            this.showCityNotFound();
            return;
        }
        
        if (!hasCityCalendar(this.currentCity)) {
            this.log(`City ${this.currentCity} doesn't have calendar configured yet`);
            this.updatePageContent(this.currentCityConfig, []);
            return;
        }
        
        // Load calendar data
        const data = await this.loadCalendarData(this.currentCity);
        if (data) {
            this.updatePageContent(data.cityConfig, data.events);
        }
    }

    // Initialize
    async init() {
        this.log('Initializing DynamicCalendarLoader...');
        await this.renderCityPage();
    }
}

// Map interaction function
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

// Initialize system
document.addEventListener('DOMContentLoaded', () => {
    const calendarLoader = new DynamicCalendarLoader();
    calendarLoader.init();
});

window.DynamicCalendarLoader = DynamicCalendarLoader;
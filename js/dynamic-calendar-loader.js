// Dynamic Google Calendar Loader - Supports multiple cities and calendars
class DynamicCalendarLoader {
    constructor() {
        this.eventsData = null;
        this.currentCity = null;
        this.currentCityConfig = null;
        this.debugMode = true;
        this.locationCache = new Map();
        
        // View state management - enhanced with new calendar overview
        this.currentView = 'week'; // 'week' or 'month'
        this.currentDate = new Date();
        this.allEvents = []; // Store all parsed events with dates
        
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

    // Parse event data (enhanced with actual dates)
    parseEventData(calendarEvent) {
        try {
            const eventData = {
                name: calendarEvent.title,
                day: this.getDayFromDate(calendarEvent.start),
                time: this.getTimeRange(calendarEvent.start, calendarEvent.end),
                cover: 'Check event details',
                eventType: this.getEventType(calendarEvent.recurrence),
                recurring: !!calendarEvent.recurrence,
                recurrence: calendarEvent.recurrence, // Store the RRULE string
                coordinates: calendarEvent.location,
                startDate: calendarEvent.start, // Store actual date
                endDate: calendarEvent.end
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
        if (!icalDate) return new Date();
        
        if (icalDate.includes('T')) {
            // DateTime format: YYYYMMDDTHHMMSS[Z]
            const cleanDate = icalDate.replace(/[TZ]/g, '');
            if (cleanDate.length >= 8) {
                const year = cleanDate.substring(0, 4);
                const month = cleanDate.substring(4, 6);
                const day = cleanDate.substring(6, 8);
                const hour = cleanDate.substring(8, 10) || '00';
                const minute = cleanDate.substring(10, 12) || '00';
                const second = cleanDate.substring(12, 14) || '00';
                
                return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
            }
        } else if (icalDate.length === 8) {
            // Date only format: YYYYMMDD (all-day event)
            const year = icalDate.substring(0, 4);
            const month = icalDate.substring(4, 6);
            const day = icalDate.substring(6, 8);
            
            return new Date(`${year}-${month}-${day}T00:00:00`);
        }
        
        return new Date();
    }

    // Date utility methods
    getWeekBounds(date) {
        const start = new Date(date);
        const day = start.getDay();
        // Fix: Properly calculate days to subtract to get to Sunday
        start.setDate(start.getDate() - day);
        start.setHours(0, 0, 0, 0);
        
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        
        return { start, end };
    }

    getMonthBounds(date) {
        const start = new Date(date.getFullYear(), date.getMonth(), 1);
        start.setHours(0, 0, 0, 0);
        
        const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
        
        return { start, end };
    }

    getCurrentPeriodBounds() {
        return this.currentView === 'week' 
            ? this.getWeekBounds(this.currentDate)
            : this.getMonthBounds(this.currentDate);
    }

    // Show events for a specific day (used by calendar overview)
    showDayEvents(dateString, events) {
        const date = new Date(dateString);
        
        // Create modal or popup to show events
        const modal = document.createElement('div');
        modal.className = 'day-events-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Events for ${date.toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        month: 'long', 
                        day: 'numeric' 
                    })}</h3>
                    <button class="modal-close" onclick="this.closest('.day-events-modal').remove()">&times;</button>
                </div>
                <div class="modal-body">
                    ${events.length > 0 
                        ? events.map(event => `
                            <div class="modal-event-item" data-event-slug="${event.slug}">
                                <div class="event-name">${event.name}</div>
                                <div class="event-details">
                                    <span class="event-time">${event.time}</span>
                                    <span class="event-venue">${event.bar}</span>
                                    <span class="event-cover">${event.cover}</span>
                                </div>
                            </div>
                        `).join('')
                        : '<p class="no-modal-events">No events scheduled for this day.</p>'
                    }
                </div>
                <div class="modal-footer">
                    <button class="switch-to-week" onclick="window.calendarLoader.switchToWeekView('${dateString}')">
                        View Week
                    </button>
                </div>
            </div>
        `;
        
        // Add modal to page
        document.body.appendChild(modal);
        
        // Add click handler to close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    // Switch to week view for a specific date
    switchToWeekView(dateString) {
        this.currentDate = new Date(dateString);
        this.currentView = 'week';
        
        // Update active button
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.view-btn[data-view="week"]').classList.add('active');
        
        // Remove modal
        document.querySelector('.day-events-modal')?.remove();
        
        this.updateCalendarDisplay();
    }

    navigatePeriod(direction) {
        const delta = direction === 'next' ? 1 : -1;
        
        if (this.currentView === 'week') {
            this.currentDate.setDate(this.currentDate.getDate() + (delta * 7));
        } else {
            this.currentDate.setMonth(this.currentDate.getMonth() + delta);
        }
        
        this.updateCalendarDisplay();
    }

    goToToday() {
        this.currentDate = new Date();
        this.updateCalendarDisplay();
    }

    formatDateRange(start, end) {
        const options = { month: 'short', day: 'numeric' };
        
        if (this.currentView === 'week') {
            if (start.getMonth() === end.getMonth()) {
                return `${start.toLocaleDateString('en-US', { month: 'short' })} ${start.getDate()}-${end.getDate()}`;
            } else {
                return `${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}`;
            }
        } else {
            return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        }
    }

    isEventInPeriod(eventDate, start, end) {
        return eventDate >= start && eventDate <= end;
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
            
            // Store all events for filtering
            this.allEvents = events;
            
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

    // Filter events by current period
    getFilteredEvents() {
        const { start, end } = this.getCurrentPeriodBounds();
        
        return this.allEvents.filter(event => {
            if (!event.startDate) return false;
            
            // For recurring events, check if they occur in this period
            if (event.recurring) {
                return this.isRecurringEventInPeriod(event, start, end);
            }
            
            // For one-time events, check if they fall within the period
            return this.isEventInPeriod(event.startDate, start, end);
        });
    }

    isRecurringEventInPeriod(event, start, end) {
        if (!event.startDate) return false;
        
        const current = new Date(start);
        
        // Check each day in the period
        while (current <= end) {
            if (this.isEventOccurringOnDate(event, current)) {
                return true;
            }
            current.setDate(current.getDate() + 1);
        }
        
        return false;
    }

    // Helper function to determine if a recurring event occurs on a specific date
    isEventOccurringOnDate(event, date) {
        if (!event.recurring || !event.startDate) return false;
        
        const eventDate = new Date(event.startDate);
        const checkDate = new Date(date);
        
        // Normalize dates to compare only date parts, not time
        eventDate.setHours(0, 0, 0, 0);
        checkDate.setHours(0, 0, 0, 0);
        
        // Make sure we're not checking before the event started
        if (checkDate < eventDate) return false;
        
        // Parse the recurrence rule to determine the pattern
        const recurrence = event.recurrence || '';
        
        if (recurrence.includes('FREQ=WEEKLY')) {
            // Weekly events: occur on the same day of the week
            return eventDate.getDay() === checkDate.getDay();
        } else if (recurrence.includes('FREQ=MONTHLY')) {
            // Monthly events: check for BYMONTHDAY pattern
            if (recurrence.includes('BYMONTHDAY=')) {
                const dayMatch = recurrence.match(/BYMONTHDAY=(\d+)/);
                if (dayMatch) {
                    const targetDay = parseInt(dayMatch[1]);
                    // Check if this month has that many days
                    const lastDayOfMonth = new Date(checkDate.getFullYear(), checkDate.getMonth() + 1, 0).getDate();
                    return checkDate.getDate() === Math.min(targetDay, lastDayOfMonth);
                }
            }
            // Fallback: same day of month as original event, but handle month lengths
            const originalDay = eventDate.getDate();
            const lastDayOfMonth = new Date(checkDate.getFullYear(), checkDate.getMonth() + 1, 0).getDate();
            const targetDay = Math.min(originalDay, lastDayOfMonth);
            return checkDate.getDate() === targetDay;
        } else if (recurrence.includes('FREQ=DAILY')) {
            // Daily events: occur every day
            return true;
        } else if (recurrence.includes('FREQ=YEARLY')) {
            // Yearly events: same month and day
            return eventDate.getMonth() === checkDate.getMonth() && 
                   eventDate.getDate() === checkDate.getDate();
        }
        
        // Default fallback for other recurring patterns - use day of week
        return eventDate.getDay() === checkDate.getDay();
    }

    // Generate calendar events (enhanced for week/month/calendar view)
    generateCalendarEvents(events) {
        const { start, end } = this.getCurrentPeriodBounds();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (this.currentView === 'week') {
            return this.generateWeekView(events, start, end, today);
        } else {
            return this.generateMonthView(events, start, end, today);
        }
    }

    generateWeekView(events, start, end, today) {
        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const days = [];
        
        for (let i = 0; i < 7; i++) {
            const currentDay = new Date(start);
            currentDay.setDate(start.getDate() + i);
            days.push(currentDay);
        }

        return days.map(day => {
            const dayEvents = events.filter(event => {
                if (!event.startDate) return false;
                
                if (event.recurring) {
                    return this.isEventOccurringOnDate(event, day);
                }
                
                const eventDate = new Date(event.startDate);
                eventDate.setHours(0, 0, 0, 0);
                const dayDate = new Date(day);
                dayDate.setHours(0, 0, 0, 0);
                
                return eventDate.getTime() === dayDate.getTime();
            });

            const eventsHtml = dayEvents.length > 0 
                ? dayEvents.map(event => `
                    <div class="event-item enhanced" data-event-slug="${event.slug}">
                        <div class="event-name">${event.name}</div>
                        <div class="event-time">${event.time}</div>
                        <div class="event-venue">${event.bar}</div>
                        <div class="event-cover">${event.cover}</div>
                    </div>
                `).join('')
                : '<div class="no-events">No events</div>';

            const isToday = day.getTime() === today.getTime();
            const currentClass = isToday ? ' current' : '';
            const dayName = daysOfWeek[day.getDay()];
            const eventCount = dayEvents.length;

            return `
                <div class="calendar-day week-view${currentClass}" data-day="${dayName}" data-date="${day.toISOString().split('T')[0]}">
                    <div class="day-header">
                        <h3>${dayName}</h3>
                        <div class="day-meta">
                            <div class="day-date">${day.getDate()}</div>
                            ${eventCount > 0 ? `<div class="event-count">${eventCount} event${eventCount > 1 ? 's' : ''}</div>` : ''}
                            ${isToday ? `<span class="day-indicator">Today</span>` : ''}
                        </div>
                    </div>
                    <div class="daily-events">
                        ${eventsHtml}
                    </div>
                </div>
            `;
        }).join('');
    }



    generateMonthView(events, start, end, today) {
        // Add day headers first
        const dayHeaders = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const headerHtml = dayHeaders.map(day => `
            <div class="calendar-day-header">
                <h4>${day}</h4>
            </div>
        `).join('');
        
        // For month view, create a grid including days from previous/next month to fill the calendar
        const firstDay = new Date(start);
        const lastDay = new Date(end);
        
        // Get the first day of the calendar grid (might be from previous month)
        const calendarStart = new Date(firstDay);
        calendarStart.setDate(firstDay.getDate() - firstDay.getDay());
        
        // Get the last day of the calendar grid (might be from next month)
        const calendarEnd = new Date(lastDay);
        const daysToAdd = 6 - lastDay.getDay();
        calendarEnd.setDate(lastDay.getDate() + daysToAdd);
        
        const days = [];
        const current = new Date(calendarStart);
        
        while (current <= calendarEnd) {
            days.push(new Date(current));
            current.setDate(current.getDate() + 1);
        }

        const daysHtml = days.map(day => {
            const dayEvents = events.filter(event => {
                if (!event.startDate) return false;
                
                if (event.recurring) {
                    return this.isEventOccurringOnDate(event, day);
                }
                
                const eventDate = new Date(event.startDate);
                eventDate.setHours(0, 0, 0, 0);
                const dayDate = new Date(day);
                dayDate.setHours(0, 0, 0, 0);
                
                return eventDate.getTime() === dayDate.getTime();
            });

            const isToday = day.getTime() === today.getTime();
            const isCurrentMonth = day.getMonth() === start.getMonth();
            const currentClass = isToday ? ' current' : '';
            const otherMonthClass = isCurrentMonth ? '' : ' other-month';
            const hasEventsClass = dayEvents.length > 0 ? ' has-events' : '';

            // Show up to 3 events with more info, and indicate if there are more
            const eventsToShow = dayEvents.slice(0, 3);
            const additionalEventsCount = Math.max(0, dayEvents.length - 3);
            
            const eventsHtml = eventsToShow.length > 0 
                ? eventsToShow.map(event => `
                    <div class="event-item month-event" data-event-slug="${event.slug}" title="${event.name} at ${event.bar} - ${event.time} - ${event.cover}">
                        <div class="event-name">${event.name.length > 20 ? event.name.substring(0, 17) + '...' : event.name}</div>
                        <div class="event-details">
                            <span class="event-time">${event.time}</span>
                            <span class="event-venue">${event.bar && event.bar.length > 15 ? event.bar.substring(0, 12) + '...' : event.bar || 'TBD'}</span>
                        </div>
                    </div>
                `).join('') + (additionalEventsCount > 0 ? `<div class="more-events">+${additionalEventsCount} more</div>` : '')
                : '';

            return `
                <div class="calendar-day month-day${currentClass}${otherMonthClass}${hasEventsClass}" data-date="${day.toISOString().split('T')[0]}">
                    <div class="day-header">
                        <span class="day-number">${day.getDate()}</span>
                        ${isToday ? `<span class="day-indicator">Today</span>` : ''}
                    </div>
                    <div class="day-events">
                        ${eventsHtml}
                    </div>
                </div>
            `;
        }).join('');

        return headerHtml + daysHtml;
    }

    // Initialize map
    initializeMap(cityConfig, events) {
        const mapContainer = document.querySelector('#events-map');
        if (!mapContainer || typeof L === 'undefined') return;

        try {
            // Calculate dynamic center and zoom based on event coordinates
            const eventsWithCoords = events.filter(event => 
                event.coordinates?.lat && event.coordinates?.lng && 
                !isNaN(event.coordinates.lat) && !isNaN(event.coordinates.lng)
            );

            let mapCenter, mapZoom;
            
            if (eventsWithCoords.length === 0) {
                // Fallback to city config if no events have coordinates
                mapCenter = [cityConfig.coordinates.lat, cityConfig.coordinates.lng];
                mapZoom = cityConfig.mapZoom;
            } else if (eventsWithCoords.length === 1) {
                // Single event - center on it with moderate zoom (reduced from 14 to 12)
                mapCenter = [eventsWithCoords[0].coordinates.lat, eventsWithCoords[0].coordinates.lng];
                mapZoom = 12;
            } else {
                // Multiple events - calculate bounding box
                const lats = eventsWithCoords.map(e => e.coordinates.lat);
                const lngs = eventsWithCoords.map(e => e.coordinates.lng);
                
                const minLat = Math.min(...lats);
                const maxLat = Math.max(...lats);
                const minLng = Math.min(...lngs);
                const maxLng = Math.max(...lngs);
                
                // Calculate center point
                mapCenter = [
                    (minLat + maxLat) / 2,
                    (minLng + maxLng) / 2
                ];
                
                // Calculate zoom level based on bounding box size with padding
                const latDiff = maxLat - minLat;
                const lngDiff = maxLng - minLng;
                const maxDiff = Math.max(latDiff, lngDiff);
                
                // Add padding factor to ensure events aren't at map edges
                const paddedDiff = maxDiff * 1.3;
                
                // Determine zoom level based on coordinate spread (reduced by 2-3 levels for better overview)
                if (paddedDiff > 0.5) mapZoom = 8;
                else if (paddedDiff > 0.2) mapZoom = 9;
                else if (paddedDiff > 0.1) mapZoom = 10;
                else if (paddedDiff > 0.05) mapZoom = 11;
                else if (paddedDiff > 0.02) mapZoom = 12;
                else mapZoom = 13;
            }

            const map = L.map('events-map', {
                scrollWheelZoom: false,
                doubleClickZoom: true,
                touchZoom: true,
                dragging: true,
                zoomControl: true
            }).setView(mapCenter, mapZoom);

            // Use clean US-based OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 18
            }).addTo(map);

            // Add map interaction notice
            const notice = L.control({position: 'bottomleft'});
            notice.onAdd = function() {
                const div = L.DomUtil.create('div', 'map-interaction-notice');
                div.innerHTML = '🖱️ Use Ctrl+Scroll to zoom';
                div.style.cssText = `
                    background: rgba(0,0,0,0.8);
                    color: white;
                    padding: 8px 12px;
                    border-radius: 6px;
                    font-size: 12px;
                    font-family: 'Poppins', sans-serif;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    border: 1px solid rgba(255,255,255,0.2);
                `;
                return div;
            };
            notice.addTo(map);

            // Enable scroll wheel zoom only when Ctrl is pressed
            map.on('wheel', function(e) {
                if (e.originalEvent.ctrlKey) {
                    map.scrollWheelZoom.enable();
                } else {
                    map.scrollWheelZoom.disable();
                }
            });

            // Disable scroll wheel zoom when mouse leaves map
            map.on('mouseout', function() {
                map.scrollWheelZoom.disable();
            });
            
            let markersAdded = 0;
            
            // Create custom marker icon
            const customIcon = L.divIcon({
                className: 'custom-marker',
                html: `
                    <div class="marker-pin">
                        <div class="marker-icon">🐻</div>
                    </div>
                `,
                iconSize: [40, 50],
                iconAnchor: [20, 50],
                popupAnchor: [0, -50]
            });

            events.forEach(event => {
                if (event.coordinates?.lat && event.coordinates?.lng && 
                    !isNaN(event.coordinates.lat) && !isNaN(event.coordinates.lng)) {
                    const marker = L.marker([event.coordinates.lat, event.coordinates.lng], {
                        icon: customIcon
                    })
                        .addTo(map)
                        .bindPopup(`
                            <div class="map-popup">
                                <h4>${event.name}</h4>
                                <p><strong>📍 ${event.bar}</strong></p>
                                <p>📅 ${event.day} ${event.time}</p>
                                <p>💰 ${event.cover}</p>
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

    // Update calendar display with filtered events
    updateCalendarDisplay() {
        const filteredEvents = this.getFilteredEvents();
        
        // Update calendar title
        const calendarTitle = document.getElementById('calendar-title');
        if (calendarTitle) {
            const titleText = this.currentView === 'week' 
                ? "This Week's Schedule" 
                : "This Month's Schedule";
            calendarTitle.textContent = titleText;
        }
        
        // Update date range
        const dateRange = document.getElementById('date-range');
        if (dateRange) {
            const { start, end } = this.getCurrentPeriodBounds();
            dateRange.textContent = this.formatDateRange(start, end);
        }
        
        // Update calendar grid
        const calendarGrid = document.querySelector('.calendar-grid');
        if (calendarGrid) {
            calendarGrid.innerHTML = this.generateCalendarEvents(filteredEvents);
            this.attachCalendarInteractions();
            
            // Update grid layout based on view
            if (this.currentView === 'month') {
                calendarGrid.className = 'calendar-grid month-view-grid';
                calendarGrid.style.gridTemplateColumns = 'repeat(7, 1fr)';
                calendarGrid.style.gridTemplateRows = 'auto repeat(6, minmax(120px, auto))';
            } else {
                calendarGrid.className = 'calendar-grid week-view-grid';
                calendarGrid.style.gridTemplateColumns = 'repeat(7, 1fr)';
                calendarGrid.style.gridTemplateRows = 'auto';
                calendarGrid.style.minHeight = 'auto';
            }
        }
        
        // Update events list (show for both week and month views)
        const eventsList = document.querySelector('.events-list');
        const eventsSection = document.querySelector('.events');
        if (eventsList && eventsSection) {
            eventsSection.style.display = 'block';
            if (filteredEvents?.length > 0) {
                eventsList.innerHTML = filteredEvents.map(event => this.generateEventCard(event)).join('');
            } else {
                const { start, end } = this.getCurrentPeriodBounds();
                const periodText = this.currentView === 'week' ? 'this week' : 'this month';
                eventsList.innerHTML = `
                    <div class="no-events-message">
                        <h3>📅 No Events ${this.currentView === 'week' ? 'This Week' : 'This Month'}</h3>
                        <p>No events scheduled for ${periodText}.</p>
                        <p>Check other weeks/months or help us by submitting events you know about!</p>
                    </div>
                `;
            }
        }
        
        // Update map (show for both week and month views)
        const mapSection = document.querySelector('.events-map-section');
        if (mapSection) {
            mapSection.style.display = 'block';
            this.initializeMap(this.currentCityConfig, filteredEvents);
        }
    }

    // Set up calendar controls
    setupCalendarControls() {
        // View toggle buttons
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const newView = e.target.dataset.view;
                if (newView !== this.currentView) {
                    this.currentView = newView;
                    
                    // Update active button
                    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    
                    this.updateCalendarDisplay();
                }
            });
        });
        
        // Navigation buttons
        const prevBtn = document.getElementById('prev-period');
        const nextBtn = document.getElementById('next-period');
        const todayBtn = document.getElementById('today-btn');
        
        if (prevBtn) {
            prevBtn.addEventListener('click', () => this.navigatePeriod('prev'));
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.navigatePeriod('next'));
        }
        
        if (todayBtn) {
            todayBtn.addEventListener('click', () => this.goToToday());
        }
        
        // Set up creative scroll-based header interactions
        this.setupScrollInteractions();
        
        // Initialize date range display
        this.updateCalendarDisplay();
    }

    // Creative scroll-based header interactions
    setupScrollInteractions() {
        const header = document.querySelector('header');
        const headerCityTitle = document.getElementById('header-city-title');
        const headerCitySelector = document.getElementById('header-city-selector');
        const headerCityButtons = document.getElementById('header-city-buttons');
        const cityHero = document.querySelector('.city-hero');
        let isHeaderExpanded = false;
        let lastScrollY = window.scrollY;
        
        // Populate header city buttons
        if (headerCityButtons) {
            headerCityButtons.innerHTML = getAvailableCities().map(city => {
                const isActive = city.key === this.currentCity;
                const hasCalendar = hasCityCalendar(city.key);
                const href = hasCalendar ? `city.html?city=${city.key}` : '#';
                const extraClass = hasCalendar ? '' : ' coming-soon';
                const activeClass = isActive ? ' active' : '';
                
                return `
                    <a href="${href}" class="header-city-button${activeClass}${extraClass}" data-city="${city.key}">
                        <span class="header-city-emoji">${city.emoji}</span>
                        <span class="header-city-name">${city.name}</span>
                    </a>
                `;
            }).join('');
        }
        
        // Set header city title text
        if (headerCityTitle && this.currentCityConfig) {
            headerCityTitle.textContent = `${this.currentCityConfig.emoji} ${this.currentCityConfig.name}`;
        }
        
        const handleScroll = () => {
            const currentScrollY = window.scrollY;
            const scrollDirection = currentScrollY > lastScrollY ? 'down' : 'up';
            const cityHeroRect = cityHero ? cityHero.getBoundingClientRect() : null;
            const heroVisible = cityHeroRect ? cityHeroRect.bottom > 0 : false;
            
            // Enhanced header background on scroll
            if (currentScrollY > 100) {
                header.classList.add('scrolled-header');
            } else {
                header.classList.remove('scrolled-header');
            }
            
            // Show city title in header when hero is not visible
            if (!heroVisible && headerCityTitle) {
                headerCityTitle.classList.add('visible');
                headerCityTitle.classList.remove('hidden');
            } else if (headerCityTitle) {
                headerCityTitle.classList.remove('visible');
                headerCityTitle.classList.add('hidden');
            }
            
            // Show city selector on deeper scroll or when scrolling up with hero not visible
            const shouldShowSelector = (currentScrollY > 300) || (scrollDirection === 'up' && !heroVisible && currentScrollY > 150);
            
            if (shouldShowSelector && !isHeaderExpanded) {
                isHeaderExpanded = true;
                header.classList.add('header-expanded');
                if (headerCitySelector) {
                    headerCitySelector.classList.add('visible');
                }
            } else if (!shouldShowSelector && isHeaderExpanded) {
                isHeaderExpanded = false;
                header.classList.remove('header-expanded');
                if (headerCitySelector) {
                    headerCitySelector.classList.remove('visible');
                }
            }
            
            lastScrollY = currentScrollY;
        };
        
        // Throttled scroll handler for better performance
        let scrollTimeout;
        const throttledScroll = () => {
            if (scrollTimeout) return;
            scrollTimeout = setTimeout(() => {
                handleScroll();
                scrollTimeout = null;
            }, 16); // ~60fps
        };
        
        // Add scroll listener
        window.addEventListener('scroll', throttledScroll, { passive: true });
        
        // Initial call to set correct state
        handleScroll();
        
        // Store scroll handler for cleanup if needed
        this.scrollHandler = throttledScroll;
    }

    // Update page content for city
    updatePageContent(cityConfig, events) {
        // Store city config for later use
        this.currentCityConfig = cityConfig;
        
        // Update title and tagline with smooth animations
        const cityTitle = document.getElementById('city-title');
        const cityTagline = document.getElementById('city-tagline');
        const cityCTAText = document.getElementById('city-cta-text');
        
        if (cityTitle) {
            // Add smooth entrance animation for city title
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

        // Set up calendar controls
        this.setupCalendarControls();

        // Update calendar with initial display
        const calendarSection = document.querySelector('.weekly-calendar');
        calendarSection?.classList.remove('content-hidden');
        
        // Update events section
        const eventsSection = document.querySelector('.events');
        eventsSection?.classList.remove('content-hidden');

        // Initialize map section
        const mapSection = document.querySelector('.events-map-section');
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
    window.calendarLoader = calendarLoader; // Make it globally accessible
    calendarLoader.init();
});

window.DynamicCalendarLoader = DynamicCalendarLoader;
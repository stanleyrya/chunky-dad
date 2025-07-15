// Dynamic Google Calendar Loader - Supports multiple cities and calendars
class DynamicCalendarLoader extends CalendarCore {
    constructor() {
        super();
        this.currentCity = null;
        this.currentCityConfig = null;
        
        // View state management - enhanced with new calendar overview
        this.currentView = 'week'; // 'week' or 'month'
        this.currentDate = new Date();
        
        logger.componentInit('CALENDAR', 'Dynamic CalendarLoader initialized');
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


    // Override parseEventData to add city-specific data and short-name
    parseEventData(calendarEvent) {
        const eventData = super.parseEventData(calendarEvent);
        if (eventData) {
            eventData.citySlug = this.currentCity;
            
            // Add short-name if not provided, generate from bar name or event name
            if (!eventData.shortName) {
                eventData.shortName = this.generateShortName(eventData.bar, eventData.name);
            }
        }
        return eventData;
    }

    // Generate short name from bar name or event name
    generateShortName(barName, eventName) {
        // Prefer bar name if available, otherwise use event name
        const sourceName = barName || eventName;
        if (!sourceName) return '';
        
        // Remove common words and abbreviate while preserving original casing
        const stopWords = ['the', 'and', 'or', 'at', 'in', 'on', 'with', 'for', 'of', 'to', 'a', 'an'];
        const words = sourceName.split(' ');
        const filteredWords = words.filter(word => !stopWords.includes(word.toLowerCase()));
        
        // Take first 2-3 meaningful words and abbreviate if too long
        const shortWords = filteredWords.slice(0, 3);
        let shortName = shortWords.join(' ');
        
        // If still too long, try abbreviating
        if (shortName.length > 15) {
            shortName = shortWords.map(word => 
                word.length > 6 ? word.substring(0, 6) + '.' : word
            ).join(' ');
        }
        
        // If still too long, just take first word
        if (shortName.length > 15) {
            shortName = filteredWords[0] || sourceName.split(' ')[0];
        }
        
        return shortName;
    }

    // Format time for mobile display with simplified format (4a-5p)
    formatTimeForMobile(timeString) {
        if (!timeString) return '';
        
        // Check if it's a time range
        const timeRangeRegex = /(\d{1,2}(?::\d{2})?(?:AM|PM))-(\d{1,2}(?::\d{2})?(?:AM|PM))/i;
        const match = timeString.match(timeRangeRegex);
        
        if (match) {
            const startTime = match[1];
            const endTime = match[2];
            return this.simplifyTimeFormat(startTime) + '-' + this.simplifyTimeFormat(endTime);
        }
        
        // For single times, just simplify
        return this.simplifyTimeFormat(timeString);
    }

    // Convert time format to simplified version (4 AM -> 4a, 5 PM -> 5p)
    simplifyTimeFormat(timeString) {
        if (!timeString) return '';
        
        return timeString.replace(/(\d{1,2}(?::\d{2})?)\s*(AM|PM)/gi, (match, time, period) => {
            return time + (period.toLowerCase() === 'am' ? 'a' : 'p');
        });
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
                        : ''
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

    // Load calendar data for specific city (override to use CORS proxy)
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
            
            const events = this.parseICalData(icalText);
            
            // Store all events for filtering
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







    // Generate event card
    generateEventCard(event) {
        const linksHtml = event.links ? event.links.map(link => {
            // Add appropriate emoji based on link type
            let emoji = '🔗'; // default link emoji
            const label = link.label.toLowerCase();
            
            if (label.includes('facebook')) emoji = '📘';
            else if (label.includes('instagram')) emoji = '📷';
            else if (label.includes('twitter')) emoji = '🐦';
            else if (label.includes('website') || label.includes('site')) emoji = '🔗';
            else if (label.includes('tickets') || label.includes('ticket')) emoji = '🎫';
            else if (label.includes('rsvp')) emoji = '✅';
            else if (label.includes('more info')) emoji = 'ℹ️';
            
            return `<a href="${link.url}" target="_blank" rel="noopener" class="event-link">${link.label}</a>`;
        }).join(' ') : '';

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
                    <a href="#" onclick="showOnMap(${event.coordinates.lat}, ${event.coordinates.lng}, '${event.name}', '${event.bar || ''}')" class="map-link">
                        📍 ${event.bar || 'Location'}
                    </a>
                </span>
            </div>` :
            (event.bar ? `<div class="detail-row">
                <span class="label">Bar:</span>
                <span class="value">${event.bar}</span>
            </div>` : '');

        // Only show cover if it exists and has meaningful content
        const coverHtml = event.cover && event.cover.trim() && event.cover.toLowerCase() !== 'free' && event.cover.toLowerCase() !== 'no cover' ? `
            <div class="detail-row">
                <span class="label">Cover:</span>
                <span class="value">${event.cover}</span>
            </div>
        ` : '';

        const recurringBadge = event.recurring ? 
            `<span class="recurring-badge">🔄 ${event.eventType}</span>` : '';

        // Format day/time more concisely (e.g., "Thu 5pm-9pm")
        const formatDayTime = (day, time) => {
            // Convert day to 3-letter format if it's longer
            const shortDay = day.length > 3 ? day.substring(0, 3) : day;
            return `${shortDay} ${time}`;
        };

        return `
            <div class="event-card detailed" data-event-slug="${event.slug}" data-lat="${event.coordinates?.lat || ''}" data-lng="${event.coordinates?.lng || ''}">
                <div class="event-header">
                    <h3>${event.name}</h3>
                    <div class="event-meta">
                        <div class="event-day">${formatDayTime(event.day, event.time)}</div>
                        ${recurringBadge}
                    </div>
                </div>
                <div class="event-details">
                    ${locationHtml}
                    ${coverHtml}
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
            // Monthly events: handle both BYMONTHDAY and BYDAY patterns
            if (recurrence.includes('BYMONTHDAY=')) {
                const dayMatch = recurrence.match(/BYMONTHDAY=(\d+)/);
                if (dayMatch) {
                    const targetDay = parseInt(dayMatch[1]);
                    // Check if this month has that many days
                    const lastDayOfMonth = new Date(checkDate.getFullYear(), checkDate.getMonth() + 1, 0).getDate();
                    return checkDate.getDate() === Math.min(targetDay, lastDayOfMonth);
                }
            } else if (recurrence.includes('BYDAY=')) {
                // Handle BYDAY patterns like BYDAY=3TH (third Thursday) or BYDAY=-1SA (last Saturday)
                const dayMatch = recurrence.match(/BYDAY=(-?\d+)([A-Z]{2})/);
                if (dayMatch) {
                    const occurrence = parseInt(dayMatch[1]); // 3 or -1 (negative means from end of month)
                    const dayCode = dayMatch[2]; // TH, SA, etc.
                    
                    // Convert day code to day number (0 = Sunday, 6 = Saturday)
                    const dayCodeToDayNumber = {
                        'SU': 0, 'MO': 1, 'TU': 2, 'WE': 3, 'TH': 4, 'FR': 5, 'SA': 6
                    };
                    
                    const targetDayOfWeek = dayCodeToDayNumber[dayCode];
                    if (targetDayOfWeek === undefined) return false;
                    
                    // Check if the check date is the correct day of the week
                    if (checkDate.getDay() !== targetDayOfWeek) return false;
                    
                    // Calculate the target date for this occurrence
                    const targetDate = this.calculateByDayOccurrence(
                        checkDate.getFullYear(), 
                        checkDate.getMonth(), 
                        occurrence, 
                        targetDayOfWeek
                    );
                    
                    return targetDate && checkDate.getTime() === targetDate.getTime();
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

    // Helper function to calculate the specific occurrence of a day in a month
    // occurrence: positive number (1-5) for nth occurrence, negative (-1) for last occurrence
    // dayOfWeek: 0=Sunday, 1=Monday, ..., 6=Saturday
    calculateByDayOccurrence(year, month, occurrence, dayOfWeek) {
        try {
            if (occurrence > 0) {
                // Find the nth occurrence of the day (e.g., 3rd Thursday)
                const firstOfMonth = new Date(year, month, 1);
                const firstDayOfWeek = firstOfMonth.getDay();
                
                // Calculate days to add to get to the first occurrence of the target day
                let daysToAdd = (dayOfWeek - firstDayOfWeek + 7) % 7;
                
                // Add weeks to get to the nth occurrence
                daysToAdd += (occurrence - 1) * 7;
                
                const targetDate = new Date(year, month, 1 + daysToAdd);
                
                // Verify it's still in the same month
                if (targetDate.getMonth() !== month) {
                    return null;
                }
                
                return targetDate;
            } else if (occurrence === -1) {
                // Find the last occurrence of the day (e.g., last Saturday)
                const lastOfMonth = new Date(year, month + 1, 0);
                const lastDayOfWeek = lastOfMonth.getDay();
                
                // Calculate days to subtract to get to the last occurrence of the target day
                let daysToSubtract = (lastDayOfWeek - dayOfWeek + 7) % 7;
                
                const targetDate = new Date(year, month + 1, 0 - daysToSubtract);
                
                // Verify it's still in the same month
                if (targetDate.getMonth() !== month) {
                    return null;
                }
                
                return targetDate;
            }
            
            return null;
        } catch (error) {
            logger.componentError('CALENDAR', 'Error calculating BYDAY occurrence', {
                year, month, occurrence, dayOfWeek, error
            });
            return null;
        }
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
        const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const days = [];
        
        for (let i = 0; i < 7; i++) {
            const currentDay = new Date(start);
            currentDay.setDate(start.getDate() + i);
            days.push(currentDay);
        }

        logger.debug('CALENDAR', `Generating week view with mobile-optimized event display`, {
            eventCount: events.length,
            weekStart: start.toISOString().split('T')[0],
            weekEnd: end.toISOString().split('T')[0]
        });

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
                ? dayEvents.map(event => {
                    // Mobile-friendly shortened versions
                    const shortName = event.shortName || (event.name.length > 20 ? event.name.substring(0, 17) + '...' : event.name);
                    const mobileTime = this.formatTimeForMobile(event.time);
                    
                    return `
                        <div class="event-item" data-event-slug="${event.slug}" title="${event.name} at ${event.bar || 'Location'} - ${event.time}">
                            <div class="event-name">${event.name}</div>
                            <div class="event-name-mobile">${shortName}</div>
                            <div class="event-time">${mobileTime}</div>
                            <div class="event-venue">${event.bar || ''}</div>
                        </div>
                    `;
                }).join('')
                : '';

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
        const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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
        
        // Calculate the minimum number of weeks needed to display the month
        const totalDays = Math.ceil((lastDay.getTime() - calendarStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        const weeksNeeded = Math.ceil(totalDays / 7);
        
        // Get the last day of the calendar grid (optimized to avoid extra rows)
        const calendarEnd = new Date(calendarStart);
        calendarEnd.setDate(calendarStart.getDate() + (weeksNeeded * 7) - 1);
        
        const days = [];
        const current = new Date(calendarStart);
        
        while (current <= calendarEnd) {
            days.push(new Date(current));
            current.setDate(current.getDate() + 1);
        }
        
        logger.debug('CALENDAR', `Generated month view with ${weeksNeeded} weeks (${days.length} days)`, {
            monthStart: start.toISOString().split('T')[0],
            monthEnd: end.toISOString().split('T')[0],
            calendarStart: calendarStart.toISOString().split('T')[0],
            calendarEnd: calendarEnd.toISOString().split('T')[0],
            weeksNeeded: weeksNeeded,
            totalDays: days.length
        });

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

            // Ultra-simplified month view: show only 2 events with shortened names for better mobile viewing
            const eventsToShow = dayEvents.slice(0, 2);
            const additionalEventsCount = Math.max(0, dayEvents.length - 2);
            
            const eventsHtml = eventsToShow.length > 0 
                ? eventsToShow.map(event => {
                    const shortName = event.shortName || (event.name.length > 20 ? event.name.substring(0, 17) + '...' : event.name);
                    const mobileTime = this.formatTimeForMobile(event.time);
                    
                    return `
                        <div class="event-item" data-event-slug="${event.slug}" title="${event.name} at ${event.bar || 'Location'} - ${event.time}">
                            <div class="event-name">${event.name}</div>
                            <div class="event-name-mobile">${shortName}</div>
                            <div class="event-time">${mobileTime}</div>
                            <div class="event-venue">${event.bar || ''}</div>
                        </div>
                    `;
                }).join('') + (additionalEventsCount > 0 ? `<div class="more-events">+${additionalEventsCount}</div>` : '')
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
            // Remove existing map if it exists
            if (window.eventsMap) {
                window.eventsMap.remove();
                window.eventsMap = null;
            }

            // Filter events with valid coordinates
            const eventsWithCoords = events.filter(event => 
                event.coordinates?.lat && event.coordinates?.lng && 
                !isNaN(event.coordinates.lat) && !isNaN(event.coordinates.lng)
            );

            // Set up default map center and zoom (lower zoom to show more area)
            let mapCenter = [cityConfig.coordinates.lat, cityConfig.coordinates.lng];
            let mapZoom = cityConfig.mapZoom || 11; // Increased from 10 to 11 for better detail on desktop

            const map = L.map('events-map', {
                scrollWheelZoom: false,
                doubleClickZoom: true,
                touchZoom: true,
                dragging: true,
                zoomControl: true,
                fullscreenControl: false
            }).setView(mapCenter, mapZoom);

            // Use clean US-based OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 18
            }).addTo(map);



            // Add "fit all markers" control
            const fitMarkersControl = L.control({position: 'topleft'});
            fitMarkersControl.onAdd = function() {
                const div = L.DomUtil.create('div', 'leaflet-control-fit-markers');
                div.innerHTML = `
                    <button class="map-control-btn" onclick="fitAllMarkers()" title="Show All Events">
                        🎯
                    </button>
                `;
                return div;
            };
            fitMarkersControl.addTo(map);

            // Add "my location" control
            const myLocationControl = L.control({position: 'topleft'});
            myLocationControl.onAdd = function() {
                const div = L.DomUtil.create('div', 'leaflet-control-my-location');
                div.innerHTML = `
                    <button class="map-control-btn" onclick="showMyLocation()" title="Show My Location">
                        📍
                    </button>
                `;
                return div;
            };
            myLocationControl.addTo(map);

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
            const markers = []; // Store markers for fit all function
            
            // Create custom marker icon
            const customIcon = L.divIcon({
                className: 'custom-marker',
                html: `
                    <div class="marker-pin">
                        <div class="marker-icon">🐻</div>
                    </div>
                `,
                iconSize: [44, 56],
                iconAnchor: [22, 56],
                popupAnchor: [0, -56]
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
                                <p><strong>📍 ${event.bar || 'Location'}</strong></p>
                                <p>📅 ${event.day} ${event.time}</p>
                                <p>💰 ${event.cover}</p>
                                ${event.recurring ? `<p>🔄 ${event.eventType}</p>` : ''}
                            </div>
                        `);
                    markers.push(marker);
                    markersAdded++;
                }
            });

            // Fit map to show all markers using Leaflet's built-in bounds calculation
            if (markers.length > 0) {
                const group = new L.featureGroup(markers);
                map.fitBounds(group.getBounds(), {
                    padding: [20, 20],
                    maxZoom: 12 // Reduced from 13 to 12 for better overview when markers overlap
                });
            }

            logger.componentLoad('MAP', `Map initialized with ${markersAdded} markers for ${cityConfig.name}`, {
                markersAdded,
                cityName: cityConfig.name,
                mapCenter,
                mapZoom
            });
            window.eventsMap = map;
            window.eventsMapMarkers = markers; // Store markers globally for controls
        } catch (error) {
            logger.componentError('MAP', 'Failed to initialize map', error);
        }
    }

    // Update calendar display with filtered events
    updateCalendarDisplay() {
        logger.time('CALENDAR', 'Calendar display update');
        const filteredEvents = this.getFilteredEvents();
        
        logger.debug('CALENDAR', `Updating calendar display`, {
            view: this.currentView,
            eventCount: filteredEvents.length,
            city: this.currentCity
        });
        
        // Update calendar title
        const calendarTitle = document.getElementById('calendar-title');
        if (calendarTitle) {
            calendarTitle.textContent = `What's the vibe?`;
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
                
                // Calculate the optimal number of rows based on the actual content
                const dayElements = calendarGrid.querySelectorAll('.calendar-day, .calendar-day-header');
                const headerRows = calendarGrid.querySelectorAll('.calendar-day-header').length > 0 ? 1 : 0;
                const dayRows = Math.ceil((dayElements.length - (headerRows * 7)) / 7);
                const totalRows = headerRows + dayRows;
                
                calendarGrid.style.gridTemplateRows = `repeat(${headerRows}, auto) repeat(${dayRows}, minmax(90px, auto))`;
                
                logger.debug('CALENDAR', `Updated month view grid layout`, {
                    totalElements: dayElements.length,
                    headerRows: headerRows,
                    dayRows: dayRows,
                    totalRows: totalRows
                });
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
                eventsList.innerHTML = '';
            }
        }
        
        // Update map (show for both week and month views)
        const mapSection = document.querySelector('.events-map-section');
        if (mapSection) {
            mapSection.style.display = 'block';
            this.initializeMap(this.currentCityConfig, filteredEvents);
        }
        
        logger.timeEnd('CALENDAR', 'Calendar display update');
        logger.performance('CALENDAR', `Calendar display updated successfully`, {
            view: this.currentView,
            eventsDisplayed: filteredEvents.length,
            city: this.currentCity
        });
    }

    // Set up calendar controls
    setupCalendarControls() {
        logger.componentInit('CALENDAR', 'Setting up calendar controls');
        
        // View toggle buttons
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const newView = e.target.dataset.view;
                if (newView !== this.currentView) {
                    logger.userInteraction('CALENDAR', `View changed from ${this.currentView} to ${newView}`);
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
            prevBtn.addEventListener('click', () => {
                logger.userInteraction('CALENDAR', 'Previous period clicked');
                this.navigatePeriod('prev');
            });
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                logger.userInteraction('CALENDAR', 'Next period clicked');
                this.navigatePeriod('next');
            });
        }
        
        if (todayBtn) {
            todayBtn.addEventListener('click', () => {
                logger.userInteraction('CALENDAR', 'Today button clicked');
                this.goToToday();
            });
        }
        
        logger.componentLoad('CALENDAR', 'Calendar controls setup complete', {
            hasNavigation: !!(prevBtn && nextBtn && todayBtn),
            viewButtons: document.querySelectorAll('.view-btn').length
        });
        
        // Initialize date range display
        this.updateCalendarDisplay();
    }



    // Update page content for city
    updatePageContent(cityConfig, events) {
        // Store city config for later use
        this.currentCityConfig = cityConfig;
        
        // Update CTA text
        const cityCTAText = document.getElementById('city-cta-text');
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
        document.title = `${cityConfig.name} - chunky.dad Bear Guide`;
        const metaDescription = document.querySelector('meta[name="description"]');
        if (metaDescription) {
            metaDescription.setAttribute('content', 
                `Complete gay bear guide to ${cityConfig.name} - events, bars, and the hottest bear scene`
            );
        }
    }

    // Attach calendar interactions
    attachCalendarInteractions() {
        const eventItems = document.querySelectorAll('.event-item');
        
        eventItems.forEach(item => {
            item.addEventListener('click', (e) => {
                const eventSlug = item.dataset.eventSlug;
                logger.userInteraction('EVENT', `Calendar event clicked: ${eventSlug}`, {
                    eventSlug,
                    city: this.currentCity
                });
                
                const eventCard = document.querySelector(`.event-card[data-event-slug="${eventSlug}"]`);
                if (eventCard) {
                    eventCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    eventCard.classList.add('highlight');
                    setTimeout(() => eventCard.classList.remove('highlight'), 2000);
                    logger.debug('EVENT', `Scrolled to event card: ${eventSlug}`);
                } else {
                    logger.warn('EVENT', `Event card not found for: ${eventSlug}`);
                }
            });
        });
        
        logger.debug('CALENDAR', `Attached interactions to ${eventItems.length} calendar items`);
    }

    // Main render function
    async renderCityPage() {
        this.currentCity = this.getCityFromURL();
        this.currentCityConfig = getCityConfig(this.currentCity);
        
        logger.info('CITY', `Rendering city page for: ${this.currentCity}`);
        
        // Update header for current city
        if (window.chunkyApp) {
            window.chunkyApp.updateHeaderForCity(this.currentCity);
        }
        
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
        
        // Load calendar data
        const data = await this.loadCalendarData(this.currentCity);
        if (data) {
            logger.componentLoad('CITY', `City page rendered successfully for ${this.currentCity}`, {
                eventCount: data.events.length
            });
            this.updatePageContent(data.cityConfig, data.events);
        }
    }

    // Initialize
    async init() {
        logger.info('CALENDAR', 'Initializing DynamicCalendarLoader...');
        await this.renderCityPage();
    }
}

// Map interaction function
function showOnMap(lat, lng, eventName, barName) {
    if (window.eventsMap) {
        // First scroll to the map section
        const mapSection = document.querySelector('.events-map-section');
        if (mapSection) {
            mapSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        // Then center the map on the location with a slight delay
        setTimeout(() => {
            window.eventsMap.setView([lat, lng], 16);
            window.eventsMap.eachLayer(layer => {
                if (layer instanceof L.Marker) {
                    const latLng = layer.getLatLng();
                    if (Math.abs(latLng.lat - lat) < 0.0001 && Math.abs(latLng.lng - lng) < 0.0001) {
                        layer.openPopup();
                    }
                }
            });
        }, 300);
        
        logger.userInteraction('MAP', 'showOnMap called', { lat, lng, eventName, barName });
    }
}

// Map control functions
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
                    
                    // Add location circle instead of marker
                    window.myLocationCircle = L.circle([lat, lng], {
                        color: '#4285f4',
                        fillColor: '#4285f4',
                        fillOpacity: 0.2,
                        radius: 500,
                        weight: 3
                    }).addTo(window.eventsMap).bindPopup('📍 Your Location');
                    
                    // Calculate bounds that include both user location and all event markers
                    const bounds = L.latLngBounds([[lat, lng]]);
                    
                    // Add all event markers to bounds
                    if (window.eventsMapMarkers && window.eventsMapMarkers.length > 0) {
                        window.eventsMapMarkers.forEach(marker => {
                            bounds.extend(marker.getLatLng());
                        });
                        
                        // Fit map to show both user location and all events
                        window.eventsMap.fitBounds(bounds, {
                            padding: [50, 50],
                            maxZoom: 14
                        });
                    } else {
                        // If no event markers, just center on user location
                        window.eventsMap.setView([lat, lng], 14);
                    }
                    
                    logger.userInteraction('MAP', 'My location shown with events visible', { lat, lng });
                }
            },
            (error) => {
                console.warn('Location access denied or unavailable:', error);
                alert('Location access denied or unavailable. Please enable location services to use this feature.');
            }
        );
    } else {
        alert('Geolocation is not supported by this browser.');
    }
}

// Export class for use in app.js - no auto-initialization
window.DynamicCalendarLoader = DynamicCalendarLoader;
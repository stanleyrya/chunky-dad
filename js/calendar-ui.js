// Calendar UI Module - Handles calendar view rendering and event card generation
class CalendarUI {
    constructor() {
        this.debugMode = true;
    }

    log(message, data = null) {
        if (this.debugMode) {
            console.log(`[CalendarUI] ${message}`, data || '');
        }
    }

    error(message, data = null) {
        console.error(`[CalendarUI ERROR] ${message}`, data || '');
    }

    // Generate event card HTML
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
                    <a href="#" onclick="showOnMap(${event.coordinates.lat}, ${event.coordinates.lng}, '${event.name}', '${event.bar || 'TBD'}')" class="map-link">
                        📍 ${event.bar || 'TBD'}
                    </a>
                </span>
            </div>` :
            `<div class="detail-row">
                <span class="label">Bar:</span>
                <span class="value">${event.bar || 'TBD'}</span>
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

    // Generate calendar view based on current view type
    generateCalendarView(events, currentView, currentDate) {
        const bounds = this.getCurrentPeriodBounds(currentView, currentDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (currentView === 'week') {
            return this.generateWeekView(events, bounds.start, bounds.end, today);
        } else {
            return this.generateMonthView(events, bounds.start, bounds.end, today);
        }
    }

    // Generate week view HTML
    generateWeekView(events, start, end, today) {
        const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const days = [];
        
        for (let i = 0; i < 7; i++) {
            const currentDay = new Date(start);
            currentDay.setDate(start.getDate() + i);
            days.push(currentDay);
        }

        return days.map(day => {
            const dayEvents = this.getEventsForDay(events, day);

            const eventsHtml = dayEvents.length > 0 
                ? dayEvents.map(event => `
                    <div class="event-item enhanced" data-event-slug="${event.slug}">
                        <div class="event-name">${event.name}</div>
                        <div class="event-time">${event.time}</div>
                        <div class="event-venue">${event.bar || 'TBD'}</div>
                    </div>
                `).join('')
                : '<div class="no-events">No events</div>';

            const isToday = day.getTime() === today.getTime();
            const currentClass = isToday ? ' current' : '';
            const dayName = daysOfWeek[day.getDay()];

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

    // Generate month view HTML
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
            const dayEvents = this.getEventsForDay(events, day);

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
                    // Show only first word of event name to save space
                    const shortName = event.name.split(' ')[0];
                    return `
                        <div class="event-item month-event" data-event-slug="${event.slug}" title="${event.name} at ${event.bar || 'TBD'} - ${event.time} - ${event.cover}">
                            <div class="event-name">${shortName}</div>
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

    // Get events for a specific day
    getEventsForDay(events, day, eventParser = null) {
        return events.filter(event => {
            if (!event.startDate) return false;
            
            if (event.recurring) {
                // Use the event parser to check if recurring event occurs on this day
                if (eventParser) {
                    return eventParser.isEventOccurringOnDate(event, day);
                } else if (window.eventParser) {
                    return window.eventParser.isEventOccurringOnDate(event, day);
                }
                return false;
            }
            
            const eventDate = new Date(event.startDate);
            eventDate.setHours(0, 0, 0, 0);
            const dayDate = new Date(day);
            dayDate.setHours(0, 0, 0, 0);
            
            return eventDate.getTime() === dayDate.getTime();
        });
    }

    // Get current period bounds for given view and date
    getCurrentPeriodBounds(currentView, currentDate) {
        if (currentView === 'week') {
            return this.getWeekBounds(currentDate);
        } else {
            return this.getMonthBounds(currentDate);
        }
    }

    // Get week bounds for a given date
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

    // Get month bounds for a given date
    getMonthBounds(date) {
        const start = new Date(date.getFullYear(), date.getMonth(), 1);
        start.setHours(0, 0, 0, 0);
        
        const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
        
        return { start, end };
    }

    // Format date range for display
    formatDateRange(start, end, currentView) {
        const options = { month: 'short', day: 'numeric' };
        
        if (currentView === 'week') {
            if (start.getMonth() === end.getMonth()) {
                return `${start.toLocaleDateString('en-US', { month: 'short' })} ${start.getDate()}-${end.getDate()}`;
            } else {
                return `${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}`;
            }
        } else {
            return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        }
    }

    // Show day events modal
    showDayEventsModal(dateString, events) {
        const date = new Date(dateString);
        
        // Create modal
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

    // Show calendar error
    showCalendarError(cityName) {
        const errorMessage = `
            <div class="error-message">
                <h3>📅 Calendar Temporarily Unavailable</h3>
                <p>We're having trouble loading the latest events for ${cityName || 'this city'}.</p>
                <p><strong>Try:</strong> Refreshing the page in a few minutes, or check our social media for updates.</p>
            </div>
        `;
        
        document.querySelectorAll('.calendar-grid, .events-list').forEach(el => {
            if (el) el.innerHTML = errorMessage;
        });
    }

    // Update calendar display
    updateCalendarDisplay(calendarHtml, eventsListHtml) {
        const calendarGrid = document.querySelector('.calendar-grid');
        const eventsList = document.querySelector('.events-list');
        
        if (calendarGrid) {
            calendarGrid.innerHTML = calendarHtml;
        }
        
        if (eventsList) {
            eventsList.innerHTML = eventsListHtml;
        }
    }

    // Update date range display
    updateDateRangeDisplay(dateRangeText) {
        const dateRangeElement = document.getElementById('date-range');
        if (dateRangeElement) {
            dateRangeElement.textContent = dateRangeText;
        }
    }

    // Update calendar title
    updateCalendarTitle(title) {
        const titleElement = document.getElementById('calendar-title');
        if (titleElement) {
            titleElement.textContent = title;
        }
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.CalendarUI = CalendarUI;
}
// Event Display Components - Modular event rendering system
class EventDisplayComponents {
    constructor() {
        logger.componentInit('EVENT', 'Event Display Components initialized');
    }

    // Generate a standard event card
    generateEventCard(event, options = {}) {
        const {
            showMapLink = true,
            showLinks = true,
            showRecurringBadge = true,
            cardClass = 'event-card',
            compact = false
        } = options;

        const recurringBadge = event.recurring && showRecurringBadge ? 
            '<span class="recurring-badge">🔄 Recurring</span>' : '';
        
        const mapLink = showMapLink && event.coordinates ? 
            `<a href="#" onclick="showOnMap(${event.coordinates.lat}, ${event.coordinates.lng}, '${event.name}', '${event.bar}'); return false;" class="map-link">📍</a>` : '';
        
        const links = showLinks && event.links ? this.generateEventLinks(event.links) : '';
        
        const cardClasses = [cardClass];
        if (compact) cardClasses.push('compact');
        if (event.recurring) cardClasses.push('recurring');
        
        return `
            <div class="${cardClasses.join(' ')}" data-event-slug="${event.slug}">
                <div class="event-header">
                    <h3 class="event-name">${event.name}</h3>
                    ${recurringBadge}
                    ${mapLink}
                </div>
                <div class="event-details">
                    <div class="event-time">🕒 ${event.time}</div>
                    <div class="event-venue">🏢 ${event.bar}</div>
                    <div class="event-cover">💰 ${event.cover}</div>
                    ${event.tea ? `<div class="event-description">ℹ️ ${event.tea}</div>` : ''}
                </div>
                ${links}
            </div>
        `;
    }

    // Generate event links section
    generateEventLinks(links) {
        const linkElements = [];
        
        if (links.website) {
            linkElements.push(`<a href="${links.website}" target="_blank" class="event-link website">🌐 Website</a>`);
        }
        if (links.instagram) {
            linkElements.push(`<a href="${links.instagram}" target="_blank" class="event-link instagram">📷 Instagram</a>`);
        }
        if (links.facebook) {
            linkElements.push(`<a href="${links.facebook}" target="_blank" class="event-link facebook">📘 Facebook</a>`);
        }
        if (links.gmaps) {
            linkElements.push(`<a href="${links.gmaps}" target="_blank" class="event-link gmaps">🗺️ Directions</a>`);
        }
        
        return linkElements.length > 0 ? 
            `<div class="event-links">${linkElements.join('')}</div>` : '';
    }

    // Generate a compact event item for lists
    generateEventListItem(event, options = {}) {
        const {
            showDay = true,
            showTime = true,
            showVenue = true,
            showRecurringBadge = true
        } = options;

        const recurringBadge = event.recurring && showRecurringBadge ? 
            '<span class="recurring-badge">🔄</span>' : '';
        
        const dayDisplay = showDay ? `<span class="event-day">${event.day}</span>` : '';
        const timeDisplay = showTime ? `<span class="event-time">${event.time}</span>` : '';
        const venueDisplay = showVenue ? `<span class="event-venue">${event.bar}</span>` : '';

        return `
            <div class="event-list-item" data-event-slug="${event.slug}">
                ${recurringBadge}
                <div class="event-info">
                    <div class="event-name">${event.name}</div>
                    <div class="event-meta">
                        ${dayDisplay}
                        ${timeDisplay}
                        ${venueDisplay}
                    </div>
                </div>
            </div>
        `;
    }

    // Generate a calendar day cell
    generateCalendarDayCell(date, events, options = {}) {
        const {
            isToday = false,
            isCurrentMonth = true,
            showEventCount = true,
            maxEvents = 3
        } = options;

        const dayNumber = date.getDate();
        const dayEvents = events.filter(event => this.isEventOnDate(event, date));
        const eventCount = dayEvents.length;
        
        const cellClasses = ['calendar-day'];
        if (isToday) cellClasses.push('today');
        if (!isCurrentMonth) cellClasses.push('other-month');
        if (eventCount > 0) cellClasses.push('has-events');
        
        const eventCountDisplay = showEventCount && eventCount > 0 ? 
            `<div class="event-count">${eventCount}</div>` : '';
        
        const eventPreviews = dayEvents.slice(0, maxEvents).map(event => 
            `<div class="event-preview" data-event-slug="${event.slug}">${event.name}</div>`
        ).join('');
        
        const moreEvents = eventCount > maxEvents ? 
            `<div class="more-events">+${eventCount - maxEvents} more</div>` : '';

        return `
            <div class="${cellClasses.join(' ')}" data-date="${date.toISOString().split('T')[0]}">
                <div class="day-number">${dayNumber}</div>
                ${eventCountDisplay}
                <div class="day-events">
                    ${eventPreviews}
                    ${moreEvents}
                </div>
            </div>
        `;
    }

    // Generate a week view row
    generateWeekViewRow(dayName, events, options = {}) {
        const {
            showTime = true,
            showVenue = true,
            showRecurringBadge = true
        } = options;

        const dayEvents = events.filter(event => event.day === dayName);
        
        if (dayEvents.length === 0) {
            return `
                <div class="week-day-row">
                    <div class="day-header">${dayName}</div>
                    <div class="day-events">
                        <div class="no-events">No events</div>
                    </div>
                </div>
            `;
        }

        const eventItems = dayEvents.map(event => {
            const recurringBadge = event.recurring && showRecurringBadge ? 
                '<span class="recurring-badge">🔄</span>' : '';
            const timeDisplay = showTime ? `<span class="event-time">${event.time}</span>` : '';
            const venueDisplay = showVenue ? `<span class="event-venue">${event.bar}</span>` : '';

            return `
                <div class="week-event-item" data-event-slug="${event.slug}">
                    ${recurringBadge}
                    <div class="event-name">${event.name}</div>
                    <div class="event-meta">
                        ${timeDisplay}
                        ${venueDisplay}
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="week-day-row">
                <div class="day-header">${dayName}</div>
                <div class="day-events">
                    ${eventItems}
                </div>
            </div>
        `;
    }

    // Generate a month view grid
    generateMonthViewGrid(startDate, endDate, events, options = {}) {
        const {
            showEventCount = true,
            maxEventsPerDay = 3,
            highlightToday = true
        } = options;

        const today = new Date();
        const grid = [];
        
        // Generate calendar grid
        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            const isToday = highlightToday && 
                currentDate.toDateString() === today.toDateString();
            const isCurrentMonth = currentDate.getMonth() === startDate.getMonth();
            
            const dayEvents = events.filter(event => this.isEventOnDate(event, currentDate));
            
            const dayCell = this.generateCalendarDayCell(currentDate, dayEvents, {
                isToday,
                isCurrentMonth,
                showEventCount,
                maxEvents: maxEventsPerDay
            });
            
            grid.push(dayCell);
            currentDate.setDate(currentDate.getDate() + 1);
        }

        return grid.join('');
    }

    // Generate a week view layout
    generateWeekViewLayout(startDate, endDate, events, options = {}) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const weekRows = [];

        for (let i = 0; i < 7; i++) {
            const dayName = dayNames[i];
            const dayEvents = events.filter(event => event.day === dayName);
            const weekRow = this.generateWeekViewRow(dayName, dayEvents, options);
            weekRows.push(weekRow);
        }

        return weekRows.join('');
    }

    // Generate a list view
    generateListView(events, options = {}) {
        const {
            showDay = true,
            showTime = true,
            showVenue = true,
            showRecurringBadge = true,
            sortBy = 'day' // 'day', 'time', 'name'
        } = options;

        // Sort events
        const sortedEvents = [...events].sort((a, b) => {
            switch (sortBy) {
                case 'day':
                    const dayOrder = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                    return dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
                case 'time':
                    return a.time.localeCompare(b.time);
                case 'name':
                    return a.name.localeCompare(b.name);
                default:
                    return 0;
            }
        });

        const eventItems = sortedEvents.map(event => 
            this.generateEventListItem(event, {
                showDay,
                showTime,
                showVenue,
                showRecurringBadge
            })
        ).join('');

        return `
            <div class="events-list-view">
                ${eventItems}
            </div>
        `;
    }

    // Generate a grid view
    generateGridView(events, options = {}) {
        const {
            columns = 3,
            showMapLink = true,
            showLinks = true,
            showRecurringBadge = true,
            compact = false
        } = options;

        const eventCards = events.map(event => 
            this.generateEventCard(event, {
                showMapLink,
                showLinks,
                showRecurringBadge,
                compact
            })
        ).join('');

        return `
            <div class="events-grid-view" style="grid-template-columns: repeat(${columns}, 1fr);">
                ${eventCards}
            </div>
        `;
    }

    // Generate a timeline view
    generateTimelineView(events, options = {}) {
        const {
            showDay = true,
            showTime = true,
            showVenue = true,
            showRecurringBadge = true,
            groupByDay = true
        } = options;

        if (groupByDay) {
            const dayGroups = {};
            events.forEach(event => {
                if (!dayGroups[event.day]) {
                    dayGroups[event.day] = [];
                }
                dayGroups[event.day].push(event);
            });

            const timelineItems = Object.entries(dayGroups).map(([day, dayEvents]) => {
                const dayEventsHtml = dayEvents.map(event => 
                    this.generateTimelineEvent(event, {
                        showTime,
                        showVenue,
                        showRecurringBadge
                    })
                ).join('');

                return `
                    <div class="timeline-day-group">
                        <div class="timeline-day-header">${day}</div>
                        <div class="timeline-day-events">
                            ${dayEventsHtml}
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div class="events-timeline-view">
                    ${timelineItems}
                </div>
            `;
        } else {
            const timelineItems = events.map(event => 
                this.generateTimelineEvent(event, {
                    showDay,
                    showTime,
                    showVenue,
                    showRecurringBadge
                })
            ).join('');

            return `
                <div class="events-timeline-view">
                    ${timelineItems}
                </div>
            `;
        }
    }

    // Generate a single timeline event
    generateTimelineEvent(event, options = {}) {
        const {
            showDay = false,
            showTime = true,
            showVenue = true,
            showRecurringBadge = true
        } = options;

        const recurringBadge = event.recurring && showRecurringBadge ? 
            '<span class="recurring-badge">🔄</span>' : '';
        const dayDisplay = showDay ? `<span class="event-day">${event.day}</span>` : '';
        const timeDisplay = showTime ? `<span class="event-time">${event.time}</span>` : '';
        const venueDisplay = showVenue ? `<span class="event-venue">${event.bar}</span>` : '';

        return `
            <div class="timeline-event" data-event-slug="${event.slug}">
                <div class="timeline-marker"></div>
                <div class="timeline-content">
                    ${recurringBadge}
                    <div class="event-name">${event.name}</div>
                    <div class="event-meta">
                        ${dayDisplay}
                        ${timeDisplay}
                        ${venueDisplay}
                    </div>
                </div>
            </div>
        `;
    }

    // Helper method to check if an event occurs on a specific date
    isEventOnDate(event, date) {
        if (event.recurring) {
            // For recurring events, check if the day of week matches
            const eventDay = event.day;
            const dateDay = date.toLocaleDateString('en-US', { weekday: 'long' });
            return eventDay === dateDay;
        } else {
            // For one-off events, check if the date matches
            return event.startDate && 
                   event.startDate.toDateString() === date.toDateString();
        }
    }

    // Generate loading state
    generateLoadingState(message = 'Loading events...') {
        return `
            <div class="events-loading">
                <div class="loading-spinner"></div>
                <div class="loading-message">${message}</div>
            </div>
        `;
    }

    // Generate empty state
    generateEmptyState(message = 'No events found', icon = '📅') {
        return `
            <div class="events-empty">
                <div class="empty-icon">${icon}</div>
                <div class="empty-message">${message}</div>
            </div>
        `;
    }

    // Generate error state
    generateErrorState(message = 'Error loading events', icon = '⚠️') {
        return `
            <div class="events-error">
                <div class="error-icon">${icon}</div>
                <div class="error-message">${message}</div>
            </div>
        `;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EventDisplayComponents;
} else {
    window.EventDisplayComponents = EventDisplayComponents;
}
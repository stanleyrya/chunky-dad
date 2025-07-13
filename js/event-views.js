// Modular Event Views System
// Allows plug-and-play event displays for different sections of the city page

class EventViewsManager {
    constructor() {
        this.views = new Map();
        this.activeViews = new Map();
        
        logger.componentInit('EVENT_VIEWS', 'Event Views Manager initialized');
    }

    // Register a new event view
    registerView(viewName, viewConfig) {
        if (!viewConfig.render || typeof viewConfig.render !== 'function') {
            logger.componentError('EVENT_VIEWS', `Invalid view config for ${viewName} - missing render function`);
            return false;
        }

        this.views.set(viewName, {
            name: viewName,
            render: viewConfig.render,
            setup: viewConfig.setup || (() => {}),
            cleanup: viewConfig.cleanup || (() => {}),
            config: viewConfig.config || {}
        });

        logger.componentLoad('EVENT_VIEWS', `Event view registered: ${viewName}`, viewConfig);
        return true;
    }

    // Activate a view for a specific container
    activateView(containerId, viewName, options = {}) {
        const view = this.views.get(viewName);
        if (!view) {
            logger.componentError('EVENT_VIEWS', `View not found: ${viewName}`);
            this.showViewError(containerId, `View type "${viewName}" is not available.`);
            return false;
        }

        const container = document.getElementById(containerId);
        if (!container) {
            logger.componentError('EVENT_VIEWS', `Container not found: ${containerId}`);
            return false;
        }

        try {
            // Cleanup previous view if exists
            this.deactivateView(containerId);

            // Store active view info
            this.activeViews.set(containerId, {
                viewName,
                container,
                options
            });

            // Setup the view
            view.setup(container, options);

            logger.userInteraction('EVENT_VIEWS', `View activated: ${viewName} for container ${containerId}`, options);
            return true;
        } catch (error) {
            logger.componentError('EVENT_VIEWS', `Error activating view ${viewName}`, error);
            this.showViewError(containerId, `Unable to activate view "${viewName}". Please try refreshing the page.`);
            return false;
        }
    }

    // Deactivate a view
    deactivateView(containerId) {
        const activeView = this.activeViews.get(containerId);
        if (activeView) {
            const view = this.views.get(activeView.viewName);
            if (view) {
                view.cleanup(activeView.container);
            }
            this.activeViews.delete(containerId);
            logger.debug('EVENT_VIEWS', `View deactivated: ${activeView.viewName} from container ${containerId}`);
        }
    }

    // Render events in a specific view
    renderEvents(containerId, events, options = {}) {
        const activeView = this.activeViews.get(containerId);
        if (!activeView) {
            logger.componentError('EVENT_VIEWS', `No active view for container: ${containerId}`);
            this.showViewError(containerId, 'No view is currently active for this section.');
            return false;
        }

        const view = this.views.get(activeView.viewName);
        if (!view) {
            logger.componentError('EVENT_VIEWS', `View not found: ${activeView.viewName}`);
            this.showViewError(containerId, `View type "${activeView.viewName}" is not available.`);
            return false;
        }

        try {
            view.render(activeView.container, events, { ...activeView.options, ...options });
            logger.debug('EVENT_VIEWS', `Events rendered in ${activeView.viewName}`, {
                containerId,
                eventCount: events.length
            });
            return true;
        } catch (error) {
            logger.componentError('EVENT_VIEWS', `Error rendering events in ${activeView.viewName}`, error);
            this.showViewError(containerId, 'Unable to display events. Please try refreshing the page.');
            return false;
        }
    }

    // Show error message for a specific container
    showViewError(containerId, message) {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = `
                <div class="error-message">
                    <h3>⚠️ Display Error</h3>
                    <p>${message}</p>
                    <button onclick="location.reload()" class="cta-button">🔄 Refresh Page</button>
                </div>
            `;
        }
    }

    // Get all registered view names
    getAvailableViews() {
        return Array.from(this.views.keys());
    }

    // Get active view for a container
    getActiveView(containerId) {
        return this.activeViews.get(containerId);
    }
}

// Built-in Event Views

// 1. Calendar View - Weekly/Monthly calendar display
const CalendarView = {
    render: (container, events, options) => {
        const { view = 'week', startDate, endDate } = options;
        
        if (view === 'week') {
            container.innerHTML = generateWeekCalendar(events, startDate, endDate);
        } else {
            container.innerHTML = generateMonthCalendar(events, startDate, endDate);
        }
    },
    
    setup: (container, options) => {
        container.classList.add('calendar-view');
        container.setAttribute('data-view-type', 'calendar');
    },
    
    cleanup: (container) => {
        container.classList.remove('calendar-view');
        container.removeAttribute('data-view-type');
    }
};

// 2. List View - Simple list of events
const ListView = {
    render: (container, events, options) => {
        const { showMapLinks = true, showVenue = true } = options;
        
        if (events.length === 0) {
            container.innerHTML = `
                <div class="no-events-message">
                    <h3>📅 No Events Found</h3>
                    <p>No events scheduled for this period.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = events.map(event => `
            <div class="event-card" data-event-slug="${event.slug}">
                <div class="event-header">
                    <h3 class="event-name">${event.name}</h3>
                    <div class="event-time">${event.time}</div>
                </div>
                ${showVenue ? `<div class="event-venue">📍 ${event.bar}</div>` : ''}
                ${event.cover ? `<div class="event-cover">💰 ${event.cover}</div>` : ''}
                ${showMapLinks && event.coordinates ? `
                    <button class="map-link" onclick="showOnMap(${event.coordinates.lat}, ${event.coordinates.lng}, '${event.name}', '${event.bar}')">
                        📍 Show on Map
                    </button>
                ` : ''}
            </div>
        `).join('');
    },
    
    setup: (container, options) => {
        container.classList.add('list-view');
        container.setAttribute('data-view-type', 'list');
    },
    
    cleanup: (container) => {
        container.classList.remove('list-view');
        container.removeAttribute('data-view-type');
    }
};

// 3. Grid View - Card-based grid layout
const GridView = {
    render: (container, events, options) => {
        const { columns = 3, showMapLinks = true } = options;
        
        if (events.length === 0) {
            container.innerHTML = `
                <div class="no-events-message">
                    <h3>📅 No Events Found</h3>
                    <p>No events scheduled for this period.</p>
                </div>
            `;
            return;
        }

        container.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
        container.innerHTML = events.map(event => `
            <div class="event-card grid-card" data-event-slug="${event.slug}">
                <div class="card-header">
                    <h3 class="event-name">${event.name}</h3>
                    <div class="event-time">${event.time}</div>
                </div>
                <div class="card-body">
                    <div class="event-venue">📍 ${event.bar}</div>
                    ${event.cover ? `<div class="event-cover">💰 ${event.cover}</div>` : ''}
                </div>
                ${showMapLinks && event.coordinates ? `
                    <div class="card-footer">
                        <button class="map-link" onclick="showOnMap(${event.coordinates.lat}, ${event.coordinates.lng}, '${event.name}', '${event.bar}')">
                            📍 Show on Map
                        </button>
                    </div>
                ` : ''}
            </div>
        `).join('');
    },
    
    setup: (container, options) => {
        container.classList.add('grid-view');
        container.setAttribute('data-view-type', 'grid');
    },
    
    cleanup: (container) => {
        container.classList.remove('grid-view');
        container.removeAttribute('data-view-type');
    }
};

// 4. Timeline View - Chronological timeline
const TimelineView = {
    render: (container, events, options) => {
        const { showMapLinks = true } = options;
        
        if (events.length === 0) {
            container.innerHTML = `
                <div class="no-events-message">
                    <h3>📅 No Events Found</h3>
                    <p>No events scheduled for this period.</p>
                </div>
            `;
            return;
        }

        // Group events by date
        const eventsByDate = {};
        events.forEach(event => {
            const date = new Date(event.startDate).toDateString();
            if (!eventsByDate[date]) {
                eventsByDate[date] = [];
            }
            eventsByDate[date].push(event);
        });

        container.innerHTML = Object.entries(eventsByDate).map(([date, dayEvents]) => `
            <div class="timeline-day">
                <div class="timeline-date">
                    <h3>${new Date(date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
                </div>
                <div class="timeline-events">
                    ${dayEvents.map(event => `
                        <div class="timeline-event" data-event-slug="${event.slug}">
                            <div class="event-time">${event.time}</div>
                            <div class="event-content">
                                <h4 class="event-name">${event.name}</h4>
                                <div class="event-venue">📍 ${event.bar}</div>
                                ${event.cover ? `<div class="event-cover">💰 ${event.cover}</div>` : ''}
                                ${showMapLinks && event.coordinates ? `
                                    <button class="map-link" onclick="showOnMap(${event.coordinates.lat}, ${event.coordinates.lng}, '${event.name}', '${event.bar}')">
                                        📍 Show on Map
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
    },
    
    setup: (container, options) => {
        container.classList.add('timeline-view');
        container.setAttribute('data-view-type', 'timeline');
    },
    
    cleanup: (container) => {
        container.classList.remove('timeline-view');
        container.removeAttribute('data-view-type');
    }
};

// 5. Map View - Map-focused display
const MapView = {
    render: (container, events, options) => {
        const { showEventList = true } = options;
        
        if (events.length === 0) {
            container.innerHTML = `
                <div class="no-events-message">
                    <h3>📅 No Events Found</h3>
                    <p>No events scheduled for this period.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="map-view-container">
                <div id="map-container" class="map-container"></div>
                ${showEventList ? `
                    <div class="map-events-list">
                        <h3>Events on Map</h3>
                        ${events.map(event => `
                            <div class="map-event-item" data-event-slug="${event.slug}">
                                <div class="event-name">${event.name}</div>
                                <div class="event-details">
                                    <span class="event-time">${event.time}</span>
                                    <span class="event-venue">${event.bar}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    },
    
    setup: (container, options) => {
        container.classList.add('map-view');
        container.setAttribute('data-view-type', 'map');
    },
    
    cleanup: (container) => {
        container.classList.remove('map-view');
        container.removeAttribute('data-view-type');
    }
};

// Helper functions for calendar views
function generateWeekCalendar(events, startDate, endDate) {
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = [];
    
    for (let i = 0; i < 7; i++) {
        const currentDay = new Date(startDate);
        currentDay.setDate(startDate.getDate() + i);
        days.push(currentDay);
    }

    return days.map(day => {
        const dayEvents = events.filter(event => {
            if (!event.startDate) return false;
            
            if (event.recurring) {
                // This would need the isEventOccurringOnDate logic from the original
                return false; // Simplified for now
            }
            
            const eventDate = new Date(event.startDate);
            eventDate.setHours(0, 0, 0, 0);
            const dayDate = new Date(day);
            dayDate.setHours(0, 0, 0, 0);
            
            return eventDate.getTime() === dayDate.getTime();
        });

        const eventsHtml = dayEvents.length > 0 
            ? dayEvents.map(event => `
                <div class="event-item enhanced" data-event-slug="${event.slug}" title="${event.name} at ${event.bar} - ${event.time}">
                    <div class="event-name">${event.name}</div>
                    <div class="event-time">${event.time}</div>
                    <div class="event-venue">${event.bar}</div>
                </div>
            `).join('')
            : '<div class="no-events">No events</div>';

        const dayName = daysOfWeek[day.getDay()];
        const isToday = day.toDateString() === new Date().toDateString();
        const currentClass = isToday ? ' current' : '';

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

function generateMonthCalendar(events, startDate, endDate) {
    // Simplified month view - would need more complex logic for full month grid
    return `
        <div class="month-calendar-placeholder">
            <h3>Month View</h3>
            <p>Month calendar view would be implemented here</p>
        </div>
    `;
}

// Initialize the global event views manager
window.eventViewsManager = new EventViewsManager();

// Register built-in views
window.eventViewsManager.registerView('calendar', CalendarView);
window.eventViewsManager.registerView('list', ListView);
window.eventViewsManager.registerView('grid', GridView);
window.eventViewsManager.registerView('timeline', TimelineView);
window.eventViewsManager.registerView('map', MapView);

logger.componentLoad('EVENT_VIEWS', 'Built-in event views registered', {
    views: window.eventViewsManager.getAvailableViews()
});
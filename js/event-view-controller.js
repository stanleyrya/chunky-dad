// Event View Controller - Manages different event view types and their interactions
class EventViewController {
    constructor(eventDataManager, displayComponents) {
        this.eventDataManager = eventDataManager;
        this.displayComponents = displayComponents;
        this.currentView = 'week'; // 'week', 'month', 'list', 'grid', 'timeline'
        this.currentDate = new Date();
        this.viewOptions = {};
        
        logger.componentInit('EVENT', 'Event View Controller initialized');
    }

    // Set the current view type
    setView(viewType, options = {}) {
        this.currentView = viewType;
        this.viewOptions = { ...this.viewOptions, ...options };
        logger.userInteraction('EVENT', `Switched to ${viewType} view`, { viewType, options });
    }

    // Set the current date
    setDate(date) {
        this.currentDate = new Date(date);
        logger.userInteraction('EVENT', 'Date changed', { date: this.currentDate });
    }

    // Get current period bounds based on view type
    getCurrentPeriodBounds() {
        switch (this.currentView) {
            case 'week':
                return this.eventDataManager.getWeekBounds(this.currentDate);
            case 'month':
                return this.eventDataManager.getMonthBounds(this.currentDate);
            default:
                // For other views, return a wider range
                const start = new Date(this.currentDate);
                start.setDate(start.getDate() - 7);
                const end = new Date(this.currentDate);
                end.setDate(end.getDate() + 30);
                return { start, end };
        }
    }

    // Render the current view
    render(container, events = null) {
        if (!container) {
            logger.warn('EVENT', 'No container provided for rendering');
            return;
        }

        // Get events if not provided
        if (!events) {
            const bounds = this.getCurrentPeriodBounds();
            events = this.eventDataManager.getEventsForPeriod(bounds.start, bounds.end);
        }

        logger.time('EVENT', `Rendering ${this.currentView} view`);
        
        try {
            let html = '';
            
            switch (this.currentView) {
                case 'week':
                    html = this.renderWeekView(events);
                    break;
                case 'month':
                    html = this.renderMonthView(events);
                    break;
                case 'list':
                    html = this.renderListView(events);
                    break;
                case 'grid':
                    html = this.renderGridView(events);
                    break;
                case 'timeline':
                    html = this.renderTimelineView(events);
                    break;
                default:
                    html = this.renderWeekView(events);
            }

            container.innerHTML = html;
            this.attachViewInteractions(container);
            
            logger.timeEnd('EVENT', `Rendering ${this.currentView} view`);
            logger.componentLoad('EVENT', `Successfully rendered ${this.currentView} view`, {
                eventCount: events.length,
                viewType: this.currentView
            });
        } catch (error) {
            logger.componentError('EVENT', `Error rendering ${this.currentView} view`, error);
            container.innerHTML = this.displayComponents.generateErrorState(
                `Error rendering ${this.currentView} view`
            );
        }
    }

    // Render week view
    renderWeekView(events) {
        const bounds = this.getCurrentPeriodBounds();
        const weekLayout = this.displayComponents.generateWeekViewLayout(
            bounds.start, 
            bounds.end, 
            events, 
            this.viewOptions
        );

        return `
            <div class="calendar-week-view">
                ${weekLayout}
            </div>
        `;
    }

    // Render month view
    renderMonthView(events) {
        const bounds = this.getCurrentPeriodBounds();
        const monthGrid = this.displayComponents.generateMonthViewGrid(
            bounds.start, 
            bounds.end, 
            events, 
            this.viewOptions
        );

        return `
            <div class="calendar-month-view">
                <div class="calendar-grid">
                    ${monthGrid}
                </div>
            </div>
        `;
    }

    // Render list view
    renderListView(events) {
        return this.displayComponents.generateListView(events, this.viewOptions);
    }

    // Render grid view
    renderGridView(events) {
        return this.displayComponents.generateGridView(events, this.viewOptions);
    }

    // Render timeline view
    renderTimelineView(events) {
        return this.displayComponents.generateTimelineView(events, this.viewOptions);
    }

    // Render loading state
    renderLoading(container, message = 'Loading events...') {
        if (container) {
            container.innerHTML = this.displayComponents.generateLoadingState(message);
        }
    }

    // Render empty state
    renderEmpty(container, message = 'No events found') {
        if (container) {
            container.innerHTML = this.displayComponents.generateEmptyState(message);
        }
    }

    // Render error state
    renderError(container, message = 'Error loading events') {
        if (container) {
            container.innerHTML = this.displayComponents.generateErrorState(message);
        }
    }

    // Attach interactions to the rendered view
    attachViewInteractions(container) {
        // Event card interactions
        container.querySelectorAll('[data-event-slug]').forEach(element => {
            element.addEventListener('click', (e) => {
                const eventSlug = element.dataset.eventSlug;
                this.handleEventClick(eventSlug, e);
            });
        });

        // Calendar day interactions
        container.querySelectorAll('.calendar-day').forEach(dayElement => {
            dayElement.addEventListener('click', (e) => {
                const dateString = dayElement.dataset.date;
                this.handleDayClick(dateString, e);
            });
        });

        // Week event interactions
        container.querySelectorAll('.week-event-item').forEach(eventElement => {
            eventElement.addEventListener('click', (e) => {
                const eventSlug = eventElement.dataset.eventSlug;
                this.handleEventClick(eventSlug, e);
            });
        });

        // Timeline event interactions
        container.querySelectorAll('.timeline-event').forEach(eventElement => {
            eventElement.addEventListener('click', (e) => {
                const eventSlug = eventElement.dataset.eventSlug;
                this.handleEventClick(eventSlug, e);
            });
        });

        logger.debug('EVENT', 'Attached view interactions', {
            viewType: this.currentView,
            eventElements: container.querySelectorAll('[data-event-slug]').length,
            dayElements: container.querySelectorAll('.calendar-day').length
        });
    }

    // Handle event click
    handleEventClick(eventSlug, event) {
        event.preventDefault();
        event.stopPropagation();
        
        const eventData = this.eventDataManager.getAllEvents().find(e => e.slug === eventSlug);
        if (eventData) {
            this.showEventDetails(eventData);
            logger.userInteraction('EVENT', 'Event clicked', {
                eventSlug,
                eventName: eventData.name
            });
        }
    }

    // Handle day click
    handleDayClick(dateString, event) {
        event.preventDefault();
        event.stopPropagation();
        
        const date = new Date(dateString);
        const bounds = { start: date, end: date };
        const dayEvents = this.eventDataManager.getEventsForPeriod(bounds.start, bounds.end);
        
        this.showDayEvents(date, dayEvents);
        logger.userInteraction('EVENT', 'Day clicked', {
            date: dateString,
            eventCount: dayEvents.length
        });
    }

    // Show event details modal
    showEventDetails(event) {
        const modal = document.createElement('div');
        modal.className = 'event-details-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>${event.name}</h3>
                    <button class="modal-close" onclick="this.closest('.event-details-modal').remove()">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="event-detail-item">
                        <strong>Day:</strong> ${event.day}
                    </div>
                    <div class="event-detail-item">
                        <strong>Time:</strong> ${event.time}
                    </div>
                    <div class="event-detail-item">
                        <strong>Venue:</strong> ${event.bar}
                    </div>
                    <div class="event-detail-item">
                        <strong>Cover:</strong> ${event.cover}
                    </div>
                    ${event.tea ? `
                        <div class="event-detail-item">
                            <strong>Details:</strong> ${event.tea}
                        </div>
                    ` : ''}
                    ${event.recurring ? `
                        <div class="event-detail-item">
                            <strong>Type:</strong> 🔄 Recurring Event
                        </div>
                    ` : ''}
                    ${event.coordinates ? `
                        <div class="event-detail-item">
                            <button onclick="showOnMap(${event.coordinates.lat}, ${event.coordinates.lng}, '${event.name}', '${event.bar}')" class="map-button">
                                📍 Show on Map
                            </button>
                        </div>
                    ` : ''}
                </div>
                <div class="modal-footer">
                    ${event.links ? this.displayComponents.generateEventLinks(event.links) : ''}
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    // Show day events modal
    showDayEvents(date, events) {
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
                    <button class="switch-to-week" onclick="this.closest('.day-events-modal').remove(); window.eventViewController.setView('week'); window.eventViewController.render(document.querySelector('.calendar-grid'));">
                        View Week
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Add click handlers for event items
        modal.querySelectorAll('.modal-event-item').forEach(item => {
            item.addEventListener('click', () => {
                const eventSlug = item.dataset.eventSlug;
                const event = events.find(e => e.slug === eventSlug);
                if (event) {
                    modal.remove();
                    this.showEventDetails(event);
                }
            });
        });
        
        // Close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    // Navigate to previous period
    navigatePrevious() {
        switch (this.currentView) {
            case 'week':
                this.currentDate.setDate(this.currentDate.getDate() - 7);
                break;
            case 'month':
                this.currentDate.setMonth(this.currentDate.getMonth() - 1);
                break;
            default:
                this.currentDate.setDate(this.currentDate.getDate() - 7);
        }
        
        logger.userInteraction('EVENT', 'Navigated to previous period', {
            viewType: this.currentView,
            newDate: this.currentDate
        });
    }

    // Navigate to next period
    navigateNext() {
        switch (this.currentView) {
            case 'week':
                this.currentDate.setDate(this.currentDate.getDate() + 7);
                break;
            case 'month':
                this.currentDate.setMonth(this.currentDate.getMonth() + 1);
                break;
            default:
                this.currentDate.setDate(this.currentDate.getDate() + 7);
        }
        
        logger.userInteraction('EVENT', 'Navigated to next period', {
            viewType: this.currentView,
            newDate: this.currentDate
        });
    }

    // Go to today
    goToToday() {
        this.currentDate = new Date();
        logger.userInteraction('EVENT', 'Navigated to today');
    }

    // Format date range for display
    formatDateRange() {
        const bounds = this.getCurrentPeriodBounds();
        const options = { month: 'short', day: 'numeric' };
        
        if (this.currentView === 'week') {
            if (bounds.start.getMonth() === bounds.end.getMonth()) {
                return `${bounds.start.toLocaleDateString('en-US', { month: 'short' })} ${bounds.start.getDate()}-${bounds.end.getDate()}`;
            } else {
                return `${bounds.start.toLocaleDateString('en-US', options)} - ${bounds.end.toLocaleDateString('en-US', options)}`;
            }
        } else if (this.currentView === 'month') {
            return bounds.start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        } else {
            return 'Events';
        }
    }

    // Get available view types
    getAvailableViews() {
        return [
            { key: 'week', name: 'Week View', icon: '📅' },
            { key: 'month', name: 'Month View', icon: '📊' },
            { key: 'list', name: 'List View', icon: '📋' },
            { key: 'grid', name: 'Grid View', icon: '🔲' },
            { key: 'timeline', name: 'Timeline View', icon: '⏰' }
        ];
    }

    // Get current view info
    getCurrentViewInfo() {
        const views = this.getAvailableViews();
        return views.find(v => v.key === this.currentView) || views[0];
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EventViewController;
} else {
    window.EventViewController = EventViewController;
}
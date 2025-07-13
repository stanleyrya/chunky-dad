// Modular Event View System
// Base class for all event view types
class EventView {
    constructor(containerId, viewType) {
        this.containerId = containerId;
        this.viewType = viewType;
        this.container = document.getElementById(containerId) || document.querySelector(containerId);
        this.events = [];
        this.cityConfig = null;
        this.isVisible = true;
        
        logger.componentInit('EVENT', `${viewType} view initialized`, {
            containerId,
            viewType,
            hasContainer: !!this.container
        });
    }

    // Abstract methods to be implemented by subclasses
    render(events, cityConfig) {
        throw new Error('render() must be implemented by subclass');
    }

    update(events, cityConfig) {
        this.events = events;
        this.cityConfig = cityConfig;
        if (this.isVisible && this.container) {
            this.render(events, cityConfig);
        }
    }

    show() {
        this.isVisible = true;
        if (this.container) {
            this.container.style.display = 'block';
            this.render(this.events, this.cityConfig);
        }
    }

    hide() {
        this.isVisible = false;
        if (this.container) {
            this.container.style.display = 'none';
        }
    }

    showLoading(message = 'Loading...') {
        if (this.container) {
            this.container.innerHTML = `<div class="loading-message">${message}</div>`;
        }
    }

    showError(message = 'Error loading data') {
        if (this.container) {
            this.container.innerHTML = `<div class="error-message">${message}</div>`;
        }
    }

    // Utility methods
    formatEventTime(event) {
        return `${event.day} ${event.time}`;
    }

    formatEventLocation(event) {
        return event.coordinates && event.coordinates.lat && event.coordinates.lng 
            ? `<a href="#" onclick="showOnMap(${event.coordinates.lat}, ${event.coordinates.lng}, '${event.name}', '${event.bar}')" class="map-link">📍 ${event.bar}</a>`
            : event.bar;
    }

    createEventLinks(event) {
        return event.links ? event.links.map(link => 
            `<a href="${link.url}" target="_blank" rel="noopener" class="event-link">${link.label}</a>`
        ).join(' ') : '';
    }
}

// Calendar Grid View
class CalendarView extends EventView {
    constructor(containerId = '.calendar-grid') {
        super(containerId, 'Calendar');
        this.currentView = 'week';
        this.currentDate = new Date();
        this.setupControls();
    }

    setupControls() {
        // Set up view toggle buttons
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const newView = e.target.dataset.view;
                if (newView !== this.currentView) {
                    this.switchView(newView);
                    logger.userInteraction('CALENDAR', `View changed to ${newView}`);
                }
            });
        });

        // Set up navigation buttons
        const prevBtn = document.getElementById('prev-period');
        const nextBtn = document.getElementById('next-period');
        const todayBtn = document.getElementById('today-btn');

        if (prevBtn) prevBtn.addEventListener('click', () => this.navigatePeriod('prev'));
        if (nextBtn) nextBtn.addEventListener('click', () => this.navigatePeriod('next'));
        if (todayBtn) todayBtn.addEventListener('click', () => this.goToToday());
    }

    switchView(newView) {
        this.currentView = newView;
        
        // Update active button
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`.view-btn[data-view="${newView}"]`).classList.add('active');
        
        // Update calendar title
        const calendarTitle = document.getElementById('calendar-title');
        if (calendarTitle) {
            calendarTitle.textContent = newView === 'week' ? "This Week's Schedule" : "This Month's Schedule";
        }
        
        this.render(this.events, this.cityConfig);
    }

    navigatePeriod(direction) {
        const delta = direction === 'next' ? 1 : -1;
        
        if (this.currentView === 'week') {
            this.currentDate.setDate(this.currentDate.getDate() + (delta * 7));
        } else {
            this.currentDate.setMonth(this.currentDate.getMonth() + delta);
        }
        
        this.render(this.events, this.cityConfig);
    }

    goToToday() {
        this.currentDate = new Date();
        this.render(this.events, this.cityConfig);
    }

    getCurrentPeriodBounds() {
        if (this.currentView === 'week') {
            return this.getWeekBounds(this.currentDate);
        } else {
            return this.getMonthBounds(this.currentDate);
        }
    }

    getWeekBounds(date) {
        const start = new Date(date);
        start.setDate(date.getDate() - date.getDay());
        start.setHours(0, 0, 0, 0);
        
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        
        return { start, end };
    }

    getMonthBounds(date) {
        const start = new Date(date.getFullYear(), date.getMonth(), 1);
        const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
        
        return { start, end };
    }

    render(events, cityConfig) {
        if (!this.container) return;
        
        this.events = events;
        this.cityConfig = cityConfig;
        
        const filteredEvents = this.getFilteredEvents();
        
        // Update date range display
        this.updateDateRangeDisplay();
        
        // Generate calendar content
        if (this.currentView === 'week') {
            this.container.innerHTML = this.generateWeekView(filteredEvents);
            this.container.className = 'calendar-grid week-view-grid';
        } else {
            this.container.innerHTML = this.generateMonthView(filteredEvents);
            this.container.className = 'calendar-grid month-view-grid';
        }
        
        this.attachEventHandlers();
        
        logger.componentLoad('CALENDAR', `Calendar view rendered (${this.currentView})`, {
            eventCount: filteredEvents.length,
            view: this.currentView
        });
    }

    updateDateRangeDisplay() {
        const dateRange = document.getElementById('date-range');
        if (dateRange) {
            const { start, end } = this.getCurrentPeriodBounds();
            dateRange.textContent = this.formatDateRange(start, end);
        }
    }

    formatDateRange(start, end) {
        if (this.currentView === 'week') {
            if (start.getMonth() === end.getMonth()) {
                return `${start.toLocaleDateString('en-US', { month: 'short' })} ${start.getDate()}-${end.getDate()}`;
            } else {
                return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
            }
        } else {
            return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        }
    }

    getFilteredEvents() {
        const { start, end } = this.getCurrentPeriodBounds();
        
        return this.events.filter(event => {
            if (!event.startDate) return false;
            
            if (event.recurring) {
                return this.isRecurringEventInPeriod(event, start, end);
            }
            
            return this.isEventInPeriod(event.startDate, start, end);
        });
    }

    isEventInPeriod(eventDate, start, end) {
        const eventTime = new Date(eventDate).getTime();
        return eventTime >= start.getTime() && eventTime <= end.getTime();
    }

    isRecurringEventInPeriod(event, start, end) {
        const current = new Date(start);
        
        while (current <= end) {
            if (this.isEventOccurringOnDate(event, current)) {
                return true;
            }
            current.setDate(current.getDate() + 1);
        }
        
        return false;
    }

    isEventOccurringOnDate(event, date) {
        if (!event.recurring || !event.startDate) return false;
        
        const eventDate = new Date(event.startDate);
        const checkDate = new Date(date);
        
        eventDate.setHours(0, 0, 0, 0);
        checkDate.setHours(0, 0, 0, 0);
        
        if (checkDate < eventDate) return false;
        
        const recurrence = event.recurrence || '';
        
        if (recurrence.includes('FREQ=WEEKLY')) {
            return eventDate.getDay() === checkDate.getDay();
        } else if (recurrence.includes('FREQ=MONTHLY')) {
            return eventDate.getDate() === checkDate.getDate();
        } else if (recurrence.includes('FREQ=DAILY')) {
            return true;
        }
        
        return eventDate.getDay() === checkDate.getDay();
    }

    generateWeekView(events) {
        const { start } = this.getCurrentPeriodBounds();
        const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        return Array.from({ length: 7 }, (_, i) => {
            const currentDay = new Date(start);
            currentDay.setDate(start.getDate() + i);
            
            const dayEvents = events.filter(event => 
                event.recurring ? this.isEventOccurringOnDate(event, currentDay) : 
                this.isEventInPeriod(event.startDate, currentDay, currentDay)
            );
            
            const isToday = currentDay.getTime() === today.getTime();
            const dayName = daysOfWeek[currentDay.getDay()];
            
            return `
                <div class="calendar-day week-view${isToday ? ' current' : ''}" data-date="${currentDay.toISOString().split('T')[0]}">
                    <div class="day-header">
                        <h3>${dayName}</h3>
                        <div class="day-date">${currentDay.getDate()}</div>
                    </div>
                    <div class="daily-events">
                        ${dayEvents.length > 0 ? dayEvents.map(event => `
                            <div class="event-item" data-event-slug="${event.slug}">
                                <div class="event-name">${event.name}</div>
                                <div class="event-time">${event.time}</div>
                                <div class="event-venue">${event.bar}</div>
                            </div>
                        `).join('') : '<div class="no-events">No events</div>'}
                    </div>
                </div>
            `;
        }).join('');
    }

    generateMonthView(events) {
        const { start, end } = this.getCurrentPeriodBounds();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Generate day headers
        const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const headerHtml = dayHeaders.map(day => `
            <div class="calendar-day-header">
                <h4>${day}</h4>
            </div>
        `).join('');
        
        // Generate calendar grid
        const calendarStart = new Date(start);
        calendarStart.setDate(start.getDate() - start.getDay());
        
        const calendarEnd = new Date(end);
        calendarEnd.setDate(end.getDate() + (6 - end.getDay()));
        
        const days = [];
        const current = new Date(calendarStart);
        
        while (current <= calendarEnd) {
            days.push(new Date(current));
            current.setDate(current.getDate() + 1);
        }
        
        const daysHtml = days.map(day => {
            const dayEvents = events.filter(event => 
                event.recurring ? this.isEventOccurringOnDate(event, day) : 
                this.isEventInPeriod(event.startDate, day, day)
            );
            
            const isToday = day.getTime() === today.getTime();
            const isCurrentMonth = day.getMonth() === start.getMonth();
            
            return `
                <div class="calendar-day month-day${isToday ? ' current' : ''}${isCurrentMonth ? '' : ' other-month'}${dayEvents.length > 0 ? ' has-events' : ''}" data-date="${day.toISOString().split('T')[0]}">
                    <div class="day-header">
                        <span class="day-number">${day.getDate()}</span>
                    </div>
                    <div class="day-events">
                        ${dayEvents.slice(0, 2).map(event => `
                            <div class="event-item month-event" data-event-slug="${event.slug}">
                                <div class="event-name">${event.name.split(' ')[0]}</div>
                            </div>
                        `).join('')}
                        ${dayEvents.length > 2 ? `<div class="more-events">+${dayEvents.length - 2}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
        
        return headerHtml + daysHtml;
    }

    attachEventHandlers() {
        const eventItems = this.container.querySelectorAll('.event-item');
        
        eventItems.forEach(item => {
            item.addEventListener('click', (e) => {
                const eventSlug = item.dataset.eventSlug;
                this.highlightEventInList(eventSlug);
                logger.userInteraction('EVENT', `Calendar event clicked: ${eventSlug}`);
            });
        });
    }

    highlightEventInList(eventSlug) {
        const eventCard = document.querySelector(`.event-card[data-event-slug="${eventSlug}"]`);
        if (eventCard) {
            eventCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            eventCard.classList.add('highlight');
            setTimeout(() => eventCard.classList.remove('highlight'), 2000);
        }
    }
}

// Events List View
class EventListView extends EventView {
    constructor(containerId = '.events-list') {
        super(containerId, 'EventList');
        this.currentFilter = 'all';
        this.currentSort = 'date';
    }

    render(events, cityConfig) {
        if (!this.container) return;
        
        this.events = events;
        this.cityConfig = cityConfig;
        
        if (events.length === 0) {
            this.container.innerHTML = this.generateEmptyState();
            return;
        }
        
        // Sort and filter events
        const processedEvents = this.processEvents(events);
        
        // Generate event cards
        this.container.innerHTML = processedEvents.map(event => 
            this.generateEventCard(event)
        ).join('');
        
        this.attachEventHandlers();
        
        logger.componentLoad('EVENT', 'Event list rendered', {
            eventCount: processedEvents.length,
            totalEvents: events.length
        });
    }

    processEvents(events) {
        // Filter events based on current filter
        let filteredEvents = events;
        
        if (this.currentFilter === 'upcoming') {
            const now = new Date();
            filteredEvents = events.filter(event => {
                if (!event.startDate) return false;
                return new Date(event.startDate) >= now;
            });
        } else if (this.currentFilter === 'recurring') {
            filteredEvents = events.filter(event => event.recurring);
        }
        
        // Sort events
        if (this.currentSort === 'date') {
            filteredEvents.sort((a, b) => {
                const dateA = new Date(a.startDate || 0);
                const dateB = new Date(b.startDate || 0);
                return dateA - dateB;
            });
        } else if (this.currentSort === 'name') {
            filteredEvents.sort((a, b) => a.name.localeCompare(b.name));
        }
        
        return filteredEvents;
    }

    generateEventCard(event) {
        const linksHtml = this.createEventLinks(event);
        const locationHtml = this.formatEventLocation(event);
        const teaHtml = event.tea ? `
            <div class="detail-row tea">
                <span class="label">Tea:</span>
                <span class="value">${event.tea}</span>
            </div>
        ` : '';
        
        const recurringBadge = event.recurring ? 
            `<span class="recurring-badge">🔄 ${event.eventType}</span>` : '';

        return `
            <div class="event-card detailed" data-event-slug="${event.slug}" data-lat="${event.coordinates?.lat || ''}" data-lng="${event.coordinates?.lng || ''}">
                <div class="event-header">
                    <h3>${event.name}</h3>
                    <div class="event-meta">
                        <div class="event-day">${this.formatEventTime(event)}</div>
                        ${recurringBadge}
                    </div>
                </div>
                <div class="event-details">
                    <div class="detail-row">
                        <span class="label">Location:</span>
                        <span class="value">${locationHtml}</span>
                    </div>
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

    generateEmptyState() {
        return `
            <div class="no-events-message">
                <h3>📅 No Events Found</h3>
                <p>No events are currently scheduled.</p>
                <p>Check back later or help us by submitting events you know about!</p>
            </div>
        `;
    }

    attachEventHandlers() {
        // Add click handlers for event cards if needed
        const eventCards = this.container.querySelectorAll('.event-card');
        eventCards.forEach(card => {
            card.addEventListener('click', (e) => {
                const eventSlug = card.dataset.eventSlug;
                logger.userInteraction('EVENT', `Event card clicked: ${eventSlug}`);
            });
        });
    }

    setFilter(filter) {
        this.currentFilter = filter;
        this.render(this.events, this.cityConfig);
    }

    setSort(sort) {
        this.currentSort = sort;
        this.render(this.events, this.cityConfig);
    }
}

// Map View
class MapView extends EventView {
    constructor(containerId = '#events-map') {
        super(containerId, 'Map');
        this.map = null;
        this.markers = [];
    }

    render(events, cityConfig) {
        if (!this.container || typeof L === 'undefined') return;
        
        this.events = events;
        this.cityConfig = cityConfig;
        
        this.initializeMap(events, cityConfig);
        
        logger.componentLoad('MAP', 'Map view rendered', {
            eventCount: events.length,
            markersCount: this.markers.length
        });
    }

    initializeMap(events, cityConfig) {
        try {
            // Remove existing map if it exists
            if (this.map) {
                this.map.remove();
                this.map = null;
            }

            // Filter events with valid coordinates
            const eventsWithCoords = events.filter(event => 
                event.coordinates?.lat && event.coordinates?.lng && 
                !isNaN(event.coordinates.lat) && !isNaN(event.coordinates.lng)
            );

            // Set up map
            const mapCenter = [cityConfig.coordinates.lat, cityConfig.coordinates.lng];
            const mapZoom = cityConfig.mapZoom || 11;

            this.map = L.map(this.container, {
                scrollWheelZoom: false,
                doubleClickZoom: true,
                touchZoom: true,
                dragging: true,
                zoomControl: true
            }).setView(mapCenter, mapZoom);

            // Add tile layer
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 18
            }).addTo(this.map);

            // Add control buttons
            this.addMapControls();

            // Add event markers
            this.addEventMarkers(eventsWithCoords);

            // Fit map to show all markers
            if (this.markers.length > 0) {
                const group = new L.featureGroup(this.markers);
                this.map.fitBounds(group.getBounds(), {
                    padding: [20, 20],
                    maxZoom: 13
                });
            }

            // Enable scroll wheel zoom only when Ctrl is pressed
            this.setupScrollZoom();

            // Make map globally accessible
            window.eventsMap = this.map;
            window.eventsMapMarkers = this.markers;

        } catch (error) {
            logger.componentError('MAP', 'Failed to initialize map', error);
        }
    }

    addMapControls() {
        // Fit all markers button
        const fitMarkersControl = L.control({position: 'topleft'});
        fitMarkersControl.onAdd = () => {
            const div = L.DomUtil.create('div', 'leaflet-control-fit-markers');
            div.innerHTML = `
                <button class="map-control-btn" onclick="fitAllMarkers()" title="Show All Events">
                    🎯
                </button>
            `;
            return div;
        };
        fitMarkersControl.addTo(this.map);

        // My location button
        const myLocationControl = L.control({position: 'topleft'});
        myLocationControl.onAdd = () => {
            const div = L.DomUtil.create('div', 'leaflet-control-my-location');
            div.innerHTML = `
                <button class="map-control-btn" onclick="showMyLocation()" title="Show My Location">
                    📍
                </button>
            `;
            return div;
        };
        myLocationControl.addTo(this.map);
    }

    addEventMarkers(events) {
        this.markers = [];
        
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
            const marker = L.marker([event.coordinates.lat, event.coordinates.lng], {
                icon: customIcon
            })
                .addTo(this.map)
                .bindPopup(`
                    <div class="map-popup">
                        <h4>${event.name}</h4>
                        <p><strong>📍 ${event.bar}</strong></p>
                        <p>📅 ${event.day} ${event.time}</p>
                        <p>💰 ${event.cover}</p>
                        ${event.recurring ? `<p>🔄 ${event.eventType}</p>` : ''}
                    </div>
                `);
            
            this.markers.push(marker);
        });
    }

    setupScrollZoom() {
        this.map.on('wheel', (e) => {
            if (e.originalEvent.ctrlKey) {
                this.map.scrollWheelZoom.enable();
            } else {
                this.map.scrollWheelZoom.disable();
            }
        });

        this.map.on('mouseout', () => {
            this.map.scrollWheelZoom.disable();
        });
    }

    focusOnEvent(lat, lng, eventName, barName) {
        if (this.map) {
            this.map.setView([lat, lng], 16);
            this.map.eachLayer(layer => {
                if (layer instanceof L.Marker) {
                    const latLng = layer.getLatLng();
                    if (Math.abs(latLng.lat - lat) < 0.0001 && Math.abs(latLng.lng - lng) < 0.0001) {
                        layer.openPopup();
                    }
                }
            });
        }
    }
}

// Event View Manager - Coordinates all views
class EventViewManager {
    constructor() {
        this.views = new Map();
        this.activeViews = new Set();
        this.events = [];
        this.cityConfig = null;
        
        logger.componentInit('EVENT', 'Event View Manager initialized');
    }

    // Register a new view
    registerView(name, view) {
        this.views.set(name, view);
        this.activeViews.add(name);
        
        logger.componentLoad('EVENT', `View registered: ${name}`, {
            viewType: view.viewType,
            totalViews: this.views.size
        });
    }

    // Remove a view
    unregisterView(name) {
        const view = this.views.get(name);
        if (view) {
            view.hide();
            this.views.delete(name);
            this.activeViews.delete(name);
            
            logger.info('EVENT', `View unregistered: ${name}`);
        }
    }

    // Enable/disable specific views
    enableView(name) {
        if (this.views.has(name)) {
            this.activeViews.add(name);
            this.views.get(name).show();
            this.updateView(name);
        }
    }

    disableView(name) {
        if (this.views.has(name)) {
            this.activeViews.delete(name);
            this.views.get(name).hide();
        }
    }

    // Update all active views
    updateAllViews(events, cityConfig) {
        this.events = events;
        this.cityConfig = cityConfig;
        
        logger.time('EVENT', 'Update all views');
        
        this.activeViews.forEach(name => {
            this.updateView(name);
        });
        
        logger.timeEnd('EVENT', 'Update all views');
        logger.componentLoad('EVENT', 'All views updated', {
            eventCount: events.length,
            activeViews: Array.from(this.activeViews)
        });
    }

    // Update specific view
    updateView(name) {
        const view = this.views.get(name);
        if (view && this.activeViews.has(name)) {
            view.update(this.events, this.cityConfig);
        }
    }

    // Show loading state for all views
    showLoadingAll(message) {
        this.activeViews.forEach(name => {
            const view = this.views.get(name);
            if (view) {
                view.showLoading(message);
            }
        });
    }

    // Show error state for all views
    showErrorAll(message) {
        this.activeViews.forEach(name => {
            const view = this.views.get(name);
            if (view) {
                view.showError(message);
            }
        });
    }

    // Get specific view
    getView(name) {
        return this.views.get(name);
    }

    // Get all active views
    getActiveViews() {
        return Array.from(this.activeViews).map(name => ({
            name,
            view: this.views.get(name)
        }));
    }
}

// Export classes for use in other modules
window.EventView = EventView;
window.CalendarView = CalendarView;
window.EventListView = EventListView;
window.MapView = MapView;
window.EventViewManager = EventViewManager;
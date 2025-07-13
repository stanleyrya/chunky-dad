// Event View Configuration Demo
// This script demonstrates how to easily configure event views

// Wait for the calendar loader to be available
window.addEventListener('load', function() {
    // Give the app time to initialize
    setTimeout(function() {
        if (window.calendarLoader && window.calendarLoader.viewManager) {
            setupViewConfigurationDemo();
        }
    }, 1000);
});

function setupViewConfigurationDemo() {
    const calendarLoader = window.calendarLoader;
    const viewManager = calendarLoader.viewManager;
    
    // Create a demo control panel (hidden by default)
    const demoPanel = document.createElement('div');
    demoPanel.id = 'view-config-demo';
    demoPanel.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: white;
        border: 2px solid #333;
        border-radius: 8px;
        padding: 15px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        z-index: 9999;
        font-family: monospace;
        font-size: 12px;
        max-width: 300px;
        display: none;
    `;
    
    demoPanel.innerHTML = `
        <h3 style="margin: 0 0 10px 0;">🔧 View Configuration Demo</h3>
        <div style="margin-bottom: 10px;">
            <strong>Current Views:</strong>
            <div id="current-views" style="margin: 5px 0; padding: 5px; background: #f0f0f0; border-radius: 4px;"></div>
        </div>
        <div style="margin-bottom: 10px;">
            <strong>Toggle Views:</strong><br>
            <button onclick="toggleView('calendar')" style="margin: 2px;">📅 Calendar</button>
            <button onclick="toggleView('eventlist')" style="margin: 2px;">📝 Event List</button>
            <button onclick="toggleView('map')" style="margin: 2px;">🗺️ Map</button>
        </div>
        <div style="margin-bottom: 10px;">
            <strong>Quick Configurations:</strong><br>
            <button onclick="setConfiguration('calendar-only')" style="margin: 2px;">Calendar Only</button>
            <button onclick="setConfiguration('list-only')" style="margin: 2px;">List Only</button>
            <button onclick="setConfiguration('map-only')" style="margin: 2px;">Map Only</button>
            <button onclick="setConfiguration('all-views')" style="margin: 2px;">All Views</button>
        </div>
        <div style="margin-bottom: 10px;">
            <strong>Demo Views:</strong><br>
            <button onclick="addCustomView()" style="margin: 2px;">➕ Add Custom View</button>
            <button onclick="removeCustomView()" style="margin: 2px;">➖ Remove Custom View</button>
        </div>
        <div>
            <button onclick="closeDemo()" style="margin: 2px; background: #ff4444; color: white; border: none; padding: 5px 10px; border-radius: 4px;">Close Demo</button>
        </div>
    `;
    
    document.body.appendChild(demoPanel);
    
    // Add toggle button to show/hide demo
    const toggleButton = document.createElement('button');
    toggleButton.id = 'demo-toggle';
    toggleButton.innerHTML = '🔧 View Config Demo';
    toggleButton.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #007cba;
        color: white;
        border: none;
        padding: 10px 15px;
        border-radius: 6px;
        cursor: pointer;
        z-index: 9998;
        font-size: 12px;
        font-weight: bold;
    `;
    
    toggleButton.onclick = function() {
        const panel = document.getElementById('view-config-demo');
        if (panel.style.display === 'none') {
            panel.style.display = 'block';
            toggleButton.style.display = 'none';
            updateCurrentViewsDisplay();
        }
    };
    
    document.body.appendChild(toggleButton);
    
    // Update the current views display
    updateCurrentViewsDisplay();
    
    logger.info('SYSTEM', 'View configuration demo initialized');
}

function updateCurrentViewsDisplay() {
    const currentViewsDiv = document.getElementById('current-views');
    if (currentViewsDiv && window.calendarLoader) {
        const activeViews = window.calendarLoader.getActiveViews();
        currentViewsDiv.innerHTML = activeViews.length > 0 
            ? activeViews.map(v => `• ${v.name} (${v.view.viewType})`).join('<br>')
            : '<em>No active views</em>';
    }
}

function toggleView(viewName) {
    const calendarLoader = window.calendarLoader;
    const viewManager = calendarLoader.viewManager;
    
    if (viewManager.activeViews.has(viewName)) {
        calendarLoader.disableView(viewName);
        logger.userInteraction('DEMO', `View disabled: ${viewName}`);
    } else {
        calendarLoader.enableView(viewName);
        logger.userInteraction('DEMO', `View enabled: ${viewName}`);
    }
    
    updateCurrentViewsDisplay();
}

function setConfiguration(configName) {
    const calendarLoader = window.calendarLoader;
    
    // First disable all views
    ['calendar', 'eventlist', 'map'].forEach(viewName => {
        calendarLoader.disableView(viewName);
    });
    
    // Then enable based on configuration
    switch (configName) {
        case 'calendar-only':
            calendarLoader.enableView('calendar');
            break;
        case 'list-only':
            calendarLoader.enableView('eventlist');
            break;
        case 'map-only':
            calendarLoader.enableView('map');
            break;
        case 'all-views':
            calendarLoader.enableView('calendar');
            calendarLoader.enableView('eventlist');
            calendarLoader.enableView('map');
            break;
    }
    
    logger.userInteraction('DEMO', `Configuration set to: ${configName}`);
    updateCurrentViewsDisplay();
}

function addCustomView() {
    const calendarLoader = window.calendarLoader;
    const viewManager = calendarLoader.viewManager;
    
    // Create a simple custom view for demonstration
    class SimpleTextView extends EventView {
        constructor() {
            super('.city-cta', 'SimpleText'); // Use CTA section as container
            this.originalContent = this.container ? this.container.innerHTML : '';
        }
        
        render(events, cityConfig) {
            if (!this.container) return;
            
            this.container.innerHTML = `
                <div class="container">
                    <div style="background: #e8f4f8; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3>📊 Custom Text View Demo</h3>
                        <p><strong>City:</strong> ${cityConfig.name}</p>
                        <p><strong>Total Events:</strong> ${events.length}</p>
                        <p><strong>Recurring Events:</strong> ${events.filter(e => e.recurring).length}</p>
                        <p><strong>One-time Events:</strong> ${events.filter(e => !e.recurring).length}</p>
                        <p><em>This is a demonstration of how easy it is to add custom views!</em></p>
                        <button onclick="removeCustomView()" style="background: #ff4444; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Remove This View</button>
                    </div>
                </div>
            `;
        }
        
        restore() {
            if (this.container) {
                this.container.innerHTML = this.originalContent;
            }
        }
    }
    
    if (!viewManager.views.has('demo-text')) {
        const customView = new SimpleTextView();
        viewManager.registerView('demo-text', customView);
        
        logger.userInteraction('DEMO', 'Custom text view added');
        updateCurrentViewsDisplay();
    }
}

function removeCustomView() {
    const calendarLoader = window.calendarLoader;
    const viewManager = calendarLoader.viewManager;
    
    if (viewManager.views.has('demo-text')) {
        const customView = viewManager.views.get('demo-text');
        customView.restore(); // Restore original content
        viewManager.unregisterView('demo-text');
        
        logger.userInteraction('DEMO', 'Custom text view removed');
        updateCurrentViewsDisplay();
    }
}

function closeDemo() {
    const demoPanel = document.getElementById('view-config-demo');
    const toggleButton = document.getElementById('demo-toggle');
    
    if (demoPanel) {
        demoPanel.style.display = 'none';
    }
    
    if (toggleButton) {
        toggleButton.style.display = 'block';
    }
}

// Examples of how to create new view types:

// Example 1: Summary View
class EventSummaryView extends EventView {
    constructor(containerId) {
        super(containerId, 'EventSummary');
    }
    
    render(events, cityConfig) {
        if (!this.container) return;
        
        const upcomingEvents = events.filter(e => e.startDate && new Date(e.startDate) > new Date());
        const recurringEvents = events.filter(e => e.recurring);
        
        this.container.innerHTML = `
            <div class="event-summary">
                <h3>📊 Event Summary for ${cityConfig.name}</h3>
                <div class="summary-stats">
                    <div class="stat">
                        <strong>${events.length}</strong>
                        <span>Total Events</span>
                    </div>
                    <div class="stat">
                        <strong>${upcomingEvents.length}</strong>
                        <span>Upcoming</span>
                    </div>
                    <div class="stat">
                        <strong>${recurringEvents.length}</strong>
                        <span>Recurring</span>
                    </div>
                </div>
            </div>
        `;
    }
}

// Example 2: Compact List View
class CompactEventListView extends EventView {
    constructor(containerId) {
        super(containerId, 'CompactEventList');
    }
    
    render(events, cityConfig) {
        if (!this.container) return;
        
        const sortedEvents = events.sort((a, b) => {
            const dateA = new Date(a.startDate || 0);
            const dateB = new Date(b.startDate || 0);
            return dateA - dateB;
        });
        
        this.container.innerHTML = `
            <div class="compact-event-list">
                <h3>📝 Compact Event List</h3>
                <div class="events">
                    ${sortedEvents.map(event => `
                        <div class="compact-event" data-event-slug="${event.slug}">
                            <span class="event-name">${event.name}</span>
                            <span class="event-time">${event.day} ${event.time}</span>
                            <span class="event-venue">${event.bar}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
}

// Example 3: Filter View
class EventFilterView extends EventView {
    constructor(containerId) {
        super(containerId, 'EventFilter');
        this.currentFilter = 'all';
    }
    
    render(events, cityConfig) {
        if (!this.container) return;
        
        const filteredEvents = this.filterEvents(events);
        
        this.container.innerHTML = `
            <div class="event-filter">
                <h3>🔍 Event Filter</h3>
                <div class="filter-controls">
                    <button onclick="this.setFilter('all')" class="${this.currentFilter === 'all' ? 'active' : ''}">All</button>
                    <button onclick="this.setFilter('recurring')" class="${this.currentFilter === 'recurring' ? 'active' : ''}">Recurring</button>
                    <button onclick="this.setFilter('upcoming')" class="${this.currentFilter === 'upcoming' ? 'active' : ''}">Upcoming</button>
                </div>
                <div class="filtered-events">
                    ${filteredEvents.map(event => `
                        <div class="filtered-event">${event.name} - ${event.bar}</div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    filterEvents(events) {
        switch (this.currentFilter) {
            case 'recurring':
                return events.filter(e => e.recurring);
            case 'upcoming':
                return events.filter(e => e.startDate && new Date(e.startDate) > new Date());
            default:
                return events;
        }
    }
    
    setFilter(filter) {
        this.currentFilter = filter;
        this.render(this.events, this.cityConfig);
    }
}

// Make examples available globally for testing
window.EventSummaryView = EventSummaryView;
window.CompactEventListView = CompactEventListView;
window.EventFilterView = EventFilterView;
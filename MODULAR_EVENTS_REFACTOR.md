# Modular Events Display System Refactor

## Overview

This refactor separates event data management from display logic, creating a modular system that allows for different event views while maintaining backward compatibility with existing functionality.

## New Architecture

### 1. Event Data Manager (`js/event-data-manager.js`)
- **Purpose**: Handles all event data parsing, filtering, and management
- **Responsibilities**:
  - iCal data parsing and event extraction
  - Event filtering by date range, type, etc.
  - Event search functionality
  - Data storage and retrieval
- **Key Methods**:
  - `parseICalData(icalText)` - Parse iCal format
  - `getEventsForPeriod(startDate, endDate)` - Filter events by date range
  - `searchEvents(query)` - Search events by text
  - `getEventsByType(type)` - Filter by event type

### 2. Event Display Components (`js/event-display-components.js`)
- **Purpose**: Provides different ways to render events
- **Responsibilities**:
  - Generate HTML for different event display types
  - Handle loading, empty, and error states
  - Provide consistent styling and interactions
- **Available Views**:
  - **Week View**: Day-by-day layout with events grouped by day
  - **Month View**: Calendar grid with event previews
  - **List View**: Simple list of events with sorting options
  - **Grid View**: Card-based layout with configurable columns
  - **Timeline View**: Chronological timeline with day grouping

### 3. Event View Controller (`js/event-view-controller.js`)
- **Purpose**: Manages view state and user interactions
- **Responsibilities**:
  - Handle view switching and navigation
  - Manage date ranges and period navigation
  - Attach event handlers and interactions
  - Show event details modals
- **Key Features**:
  - View state management
  - Date navigation (previous/next/today)
  - Event click handling
  - Modal management

### 4. Modular Calendar Loader (`js/modular-calendar-loader.js`)
- **Purpose**: Coordinates the modular system for city pages
- **Responsibilities**:
  - Initialize all modular components
  - Load calendar data from Google Calendar
  - Handle city-specific functionality
  - Maintain backward compatibility
- **Compatibility**: Works alongside existing `DynamicCalendarLoader`

## Benefits

### 1. **Modularity**
- Clear separation of concerns
- Easy to add new view types
- Reusable components across different pages

### 2. **Flexibility**
- Multiple display options for different use cases
- Configurable view options
- Easy to experiment with new layouts

### 3. **Maintainability**
- Smaller, focused modules
- Easier to test individual components
- Clear interfaces between modules

### 4. **Backward Compatibility**
- Existing `city.html` functionality preserved
- Test pages continue to work
- Gradual migration path

## Usage Examples

### Basic Usage
```javascript
// Initialize components
const eventDataManager = new EventDataManager();
const displayComponents = new EventDisplayComponents();
const viewController = new EventViewController(eventDataManager, displayComponents);

// Set events data
eventDataManager.setEventsData(events);

// Render a specific view
viewController.setView('grid');
viewController.render(container);
```

### Custom View Options
```javascript
// Grid view with custom options
viewController.setView('grid', {
    columns: 2,
    compact: true,
    showMapLink: false
});

// List view with sorting
viewController.setView('list', {
    sortBy: 'time',
    showDay: false
});
```

### Event Filtering
```javascript
// Get events for a specific period
const bounds = viewController.getCurrentPeriodBounds();
const periodEvents = eventDataManager.getEventsForPeriod(bounds.start, bounds.end);

// Search events
const searchResults = eventDataManager.searchEvents('bear night');

// Filter by type
const recurringEvents = eventDataManager.getRecurringEvents();
```

## File Structure

```
js/
├── event-data-manager.js          # Event data parsing and management
├── event-display-components.js    # Display component generation
├── event-view-controller.js       # View state and interaction management
├── modular-calendar-loader.js     # Main coordinator for city pages
├── calendar-core.js               # Legacy (maintained for compatibility)
└── dynamic-calendar-loader.js     # Legacy (maintained for compatibility)
```

## Testing

### Test Pages
- `testing/test-modular-events.html` - Demonstrates all view types
- `testing/test-calendar-logging.html` - Uses legacy system (unchanged)

### View Types Available
1. **Week View** - Day-by-day layout
2. **Month View** - Calendar grid
3. **List View** - Simple list with sorting
4. **Grid View** - Card-based layout
5. **Timeline View** - Chronological timeline

## Migration Path

### Current State
- `city.html` uses new modular system
- Test pages use legacy system
- Both systems coexist

### Future Enhancements
- Add more view types (map view, agenda view)
- Implement event filtering UI
- Add export functionality
- Create mobile-optimized views

## CSS Classes Added

### Loading States
- `.events-loading` - Loading container
- `.loading-spinner` - Animated spinner
- `.loading-message` - Loading text

### Empty/Error States
- `.events-empty` - Empty state container
- `.empty-icon` - Empty state icon
- `.events-error` - Error state container
- `.error-icon` - Error state icon

### View-Specific Classes
- `.events-list-view` - List view container
- `.events-grid-view` - Grid view container
- `.events-timeline-view` - Timeline view container
- `.calendar-week-view` - Week view container
- `.calendar-month-view` - Month view container

### Interactive Elements
- `.event-list-item` - List view items
- `.week-event-item` - Week view items
- `.timeline-event` - Timeline items
- `.event-preview` - Month view event previews

## Logging

All components use the centralized logging system with appropriate component tags:
- `EVENT` - Event data management
- `CALENDAR` - Calendar loading and coordination
- `TEST` - Testing and debugging

## Performance Considerations

- Event data is cached in the data manager
- Views are rendered on-demand
- Interactions are debounced where appropriate
- CSS animations are hardware-accelerated

## Browser Compatibility

- ES6+ features used throughout
- Modern CSS Grid and Flexbox
- Fallbacks for older browsers via existing CSS
- Progressive enhancement approach
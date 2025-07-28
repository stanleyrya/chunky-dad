# Scriptable API Documentation

This document contains comprehensive API information for Scriptable, an iOS automation app, extracted from official documentation and real-world usage patterns from the bear event scraper project.

## Overview

Scriptable is an automation app for iOS that allows you to write JavaScript to interact with iOS features and APIs. This documentation focuses on the classes and methods most relevant for automation scripts, particularly for calendar management, web scraping, and file operations.

## Core Classes

### Calendar

Provides access to iOS calendar functionality for reading and managing calendar events.

**Key Static Methods:**
- `Calendar.forEvents()` - Returns calendars that can contain events
- `Calendar.forReminders()` - Returns calendars that can contain reminders
- `Calendar.defaultForEvents()` - Returns the default calendar for events
- `Calendar.presentPicker()` - Presents a picker for selecting calendars

**Key Properties:**
- `title` - The title of the calendar
- `identifier` - Unique identifier for the calendar
- `allowsContentModifications` - Whether the calendar can be modified
- `color` - The color associated with the calendar

**Usage Example:**
```javascript
// Get all event calendars
let calendars = await Calendar.forEvents();
let targetCalendar = calendars.find(cal => cal.title === "chunky-dad-nyc");

// Create new calendar if needed
if (!targetCalendar) {
    targetCalendar = new Calendar();
    targetCalendar.title = "chunky-dad-nyc";
    targetCalendar.save();
}
```

---

### CalendarEvent

Represents a calendar event with full CRUD capabilities.

**Constructor:** `new CalendarEvent()`

**Key Static Methods:**
- `CalendarEvent.today()` - Returns today's events
- `CalendarEvent.tomorrow()` - Returns tomorrow's events
- `CalendarEvent.thisWeek()` - Returns this week's events
- `CalendarEvent.between(startDate, endDate)` - Returns events in date range

**Key Instance Methods:**
- `save()` - Saves the event to the calendar
- `remove()` - Removes the event from the calendar
- `addRecurrenceRule(rule)` - Adds a recurrence rule

**Key Properties:**
- `title` - Event title
- `startDate` - Start date and time
- `endDate` - End date and time
- `location` - Event location
- `notes` - Event notes/description
- `calendar` - The calendar containing the event
- `isAllDay` - Whether the event is all-day
- `url` - URL associated with the event

**Usage Example:**
```javascript
// Create new bear event
let event = new CalendarEvent();
event.title = "FURBALL NYC";
event.startDate = new Date("2025-07-25T21:00:00");
event.endDate = new Date("2025-07-26T03:00:00");
event.location = "Eagle Bar - NYC";
event.notes = "Bear dance party with DJ sets";
event.calendar = targetCalendar;
event.url = "https://www.furball.nyc";
event.save();
```

---

### Request

Handles HTTP requests for web scraping and API calls.

**Constructor:** `new Request(url)`

**Key Properties:**
- `url` - The request URL
- `method` - HTTP method (GET, POST, etc.)
- `headers` - Request headers object
- `body` - Request body for POST requests
- `timeoutInterval` - Request timeout in seconds

**Key Instance Methods:**
- `loadString()` - Returns response as string
- `loadJSON()` - Returns response as parsed JSON
- `load()` - Returns response as Data object
- `loadImage()` - Returns response as Image object

**Usage Example:**
```javascript
// Fetch bear event website
let request = new Request("https://www.furball.nyc");
request.headers = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)"
};
request.timeoutInterval = 30;

try {
    let html = await request.loadString();
    // Parse HTML for events...
} catch (error) {
    console.error("Request failed:", error);
}
```

---

### FileManager

Provides file system access for reading, writing, and managing files.

**Key Static Methods:**
- `FileManager.local()` - Returns local file manager
- `FileManager.iCloud()` - Returns iCloud file manager

**Key Instance Methods:**
- `documentsDirectory()` - Returns documents directory path
- `readString(filePath)` - Reads file as string
- `writeString(filePath, content)` - Writes string to file
- `readJSON(filePath)` - Reads and parses JSON file
- `writeJSON(filePath, object)` - Writes object as JSON
- `fileExists(filePath)` - Checks if file exists
- `joinPath(path1, path2)` - Joins path components

**Usage Example:**
```javascript
// Cache parsed events
let fm = FileManager.iCloud();
let docPath = fm.documentsDirectory();
let cachePath = fm.joinPath(docPath, "bear-events-cache.json");

// Save events to cache
let eventsData = { events: parsedEvents, lastUpdate: new Date() };
fm.writeString(cachePath, JSON.stringify(eventsData, null, 2));

// Read from cache
if (fm.fileExists(cachePath)) {
    let cached = JSON.parse(fm.readString(cachePath));
    console.log(`Loaded ${cached.events.length} cached events`);
}
```

---

### Alert

Creates and displays alert dialogs to the user.

**Constructor:** `new Alert()`

**Key Instance Methods:**
- `addAction(title)` - Adds an action button
- `addTextField(placeholder, text)` - Adds a text input field
- `present()` - Shows the alert and returns selected action index
- `presentAlert()` - Shows alert without waiting for response
- `presentSheet()` - Shows as action sheet on iPad

**Key Properties:**
- `title` - Alert title
- `message` - Alert message

**Usage Example:**
```javascript
// Confirm calendar sync
let alert = new Alert();
alert.title = "Bear Event Sync";
alert.message = `Found ${newEvents.length} new events. Sync to calendar?`;
alert.addAction("Sync");
alert.addAction("Preview Only");
alert.addAction("Cancel");

let response = await alert.present();
if (response === 0) {
    // Sync events
} else if (response === 1) {
    // Preview mode
}
```

---

### Notification

Creates and schedules local notifications.

**Constructor:** `new Notification()`

**Key Instance Methods:**
- `schedule()` - Schedules the notification
- `setTriggerDate(date)` - Sets when to trigger
- `addAction(title, url)` - Adds action button

**Key Properties:**
- `title` - Notification title
- `body` - Notification message
- `sound` - Notification sound
- `badge` - App badge number

**Usage Example:**
```javascript
// Notify about new events
let notification = new Notification();
notification.title = "New Bear Events";
notification.body = `${newEvents.length} new events added to calendar`;
notification.sound = "default";
await notification.schedule();
```

---

### Device

Provides information about the iOS device.

**Key Static Properties:**
- `Device.name()` - Device name
- `Device.systemName()` - iOS system name
- `Device.systemVersion()` - iOS version
- `Device.model()` - Device model
- `Device.screenBrightness()` - Screen brightness level
- `Device.isCharging()` - Whether device is charging
- `Device.batteryLevel()` - Battery level (0-1)

**Usage Example:**
```javascript
// Log device info for debugging
console.log(`Running on ${Device.name()} (${Device.model()})`);
console.log(`iOS ${Device.systemVersion()}, Battery: ${Math.round(Device.batteryLevel() * 100)}%`);
```

---

### XMLParser

Parses XML/HTML content for data extraction.

**Constructor:** `new XMLParser(xmlString)`

**Key Instance Methods:**
- `parse()` - Parses the XML content
- `didStartElement(name, attributes)` - Override for element start
- `didEndElement(name)` - Override for element end
- `foundCharacters(string)` - Override for text content

**Usage Example:**
```javascript
// Parse HTML for event data
let parser = new XMLParser(htmlContent);
let events = [];
let currentEvent = {};

parser.didStartElement = (name, attributes) => {
    if (name === "div" && attributes.class === "event-card") {
        currentEvent = {};
    }
};

parser.foundCharacters = (text) => {
    if (text.trim()) {
        currentEvent.text = (currentEvent.text || "") + text.trim();
    }
};

parser.parse();
```

---

### Data

Handles binary data operations.

**Key Static Methods:**
- `Data.fromString(string)` - Creates Data from string
- `Data.fromBase64String(base64)` - Creates Data from base64
- `Data.fromFile(filePath)` - Reads file as Data

**Key Instance Methods:**
- `toBase64String()` - Converts to base64 string
- `toRawString()` - Converts to raw string

---

### WebView

Displays web content and executes JavaScript in web context.

**Constructor:** `new WebView()`

**Key Instance Methods:**
- `loadHTML(html)` - Loads HTML content
- `loadURL(url)` - Loads URL
- `evaluateJavaScript(script)` - Executes JavaScript
- `present()` - Shows the web view

**Usage Example:**
```javascript
// Scrape dynamic content
let webView = new WebView();
await webView.loadURL("https://www.eventbrite.com/o/megawoof-america-18118978189");

// Execute JavaScript to extract event data
let events = await webView.evaluateJavaScript(`
    Array.from(document.querySelectorAll('.event-card')).map(card => ({
        title: card.querySelector('.event-title')?.textContent,
        date: card.querySelector('.event-date')?.textContent,
        location: card.querySelector('.event-location')?.textContent
    }));
`);
```

---

## Common Usage Patterns

### Calendar Integration Pattern
```javascript
// Standard calendar sync workflow
async function syncEventsToCalendar(events, calendarName) {
    // Get or create target calendar
    let calendars = await Calendar.forEvents();
    let targetCalendar = calendars.find(cal => cal.title === calendarName);
    
    if (!targetCalendar) {
        targetCalendar = new Calendar();
        targetCalendar.title = calendarName;
        targetCalendar.save();
    }
    
    // Get existing events to avoid duplicates
    let startDate = new Date();
    let endDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days
    let existingEvents = await CalendarEvent.between(startDate, endDate);
    
    for (let eventData of events) {
        // Check for duplicates
        let duplicate = existingEvents.find(existing => 
            existing.title === eventData.title && 
            Math.abs(existing.startDate - eventData.startDate) < 60000 // 1 minute tolerance
        );
        
        if (!duplicate) {
            let event = new CalendarEvent();
            event.title = eventData.title;
            event.startDate = eventData.startDate;
            event.endDate = eventData.endDate;
            event.location = eventData.location;
            event.notes = eventData.description;
            event.calendar = targetCalendar;
            if (eventData.url) event.url = eventData.url;
            event.save();
        }
    }
}
```

### Web Scraping Pattern
```javascript
// Robust web scraping with error handling
async function scrapeWebsite(url, parser) {
    let request = new Request(url);
    request.headers = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15"
    };
    request.timeoutInterval = 30;
    
    try {
        let html = await request.loadString();
        return parser(html);
    } catch (error) {
        console.error(`Failed to scrape ${url}:`, error);
        return [];
    }
}
```

### File Caching Pattern
```javascript
// Cache data with expiration
class CacheManager {
    constructor(filename, expirationHours = 24) {
        this.fm = FileManager.iCloud();
        this.filename = filename;
        this.expirationMs = expirationHours * 60 * 60 * 1000;
    }
    
    async read() {
        let path = this.fm.joinPath(this.fm.documentsDirectory(), this.filename);
        if (!this.fm.fileExists(path)) return null;
        
        let data = JSON.parse(this.fm.readString(path));
        let age = Date.now() - new Date(data.timestamp).getTime();
        
        if (age > this.expirationMs) {
            return null; // Expired
        }
        
        return data.content;
    }
    
    async write(content) {
        let data = {
            content: content,
            timestamp: new Date().toISOString()
        };
        let path = this.fm.joinPath(this.fm.documentsDirectory(), this.filename);
        this.fm.writeString(path, JSON.stringify(data, null, 2));
    }
}
```

### Error Handling Pattern
```javascript
// Comprehensive error handling
async function safeExecute(operation, operationName) {
    try {
        console.log(`Starting ${operationName}...`);
        let result = await operation();
        console.log(`✅ ${operationName} completed successfully`);
        return result;
    } catch (error) {
        console.error(`❌ ${operationName} failed:`, error);
        
        // Send error notification
        let notification = new Notification();
        notification.title = "Script Error";
        notification.body = `${operationName} failed: ${error.message}`;
        await notification.schedule();
        
        return null;
    }
}
```

## Integration with Bear Event Scraper

The bear event scraper project demonstrates practical usage of these APIs:

### Key Integration Points

1. **Calendar Management**: Uses `Calendar.forEvents()` and `CalendarEvent` for managing bear event calendars across multiple cities
2. **Web Scraping**: Uses `Request` class to fetch HTML from bear event websites  
3. **Data Persistence**: Uses `FileManager` for caching parsed events and configuration
4. **Error Reporting**: Uses `console.log()` and `Notification` for debugging and status updates
5. **Date Handling**: JavaScript `Date` objects integrate seamlessly with calendar APIs

### Safety Features Implementation

```javascript
// Safety configuration used in bear event scraper
const SAFETY_CONFIG = {
    dryRun: true,              // Don't modify calendars
    preview: true,             // Show what would be done
    calendarSync: false,       // Disable calendar sync
    maxEvents: 100,           // Limit processing
    timeout: 30000,           // Request timeout
    retryAttempts: 3          // Retry failed requests
};

// Preview mode implementation
if (SAFETY_CONFIG.preview) {
    console.log(`PREVIEW: Would create ${newEvents.length} events`);
    newEvents.forEach(event => {
        console.log(`  - ${event.title} on ${event.startDate}`);
    });
} else if (!SAFETY_CONFIG.dryRun && SAFETY_CONFIG.calendarSync) {
    // Actually sync to calendar
    await syncEventsToCalendar(newEvents, calendarName);
}
```

### Performance Monitoring

```javascript
// Performance tracking implementation
class PerformanceTracker {
    constructor() {
        this.metrics = [];
        this.timers = {};
    }
    
    startTimer(operation) {
        this.timers[operation] = Date.now();
    }
    
    endTimer(operation) {
        if (this.timers[operation]) {
            let duration = Date.now() - this.timers[operation];
            this.metrics.push({
                operation: operation,
                duration: duration,
                timestamp: new Date().toISOString()
            });
            console.log(`⏱️ ${operation}: ${duration}ms`);
            delete this.timers[operation];
        }
    }
    
    async saveMetrics() {
        let fm = FileManager.iCloud();
        let path = fm.joinPath(fm.documentsDirectory(), "performance-metrics.json");
        fm.writeString(path, JSON.stringify(this.metrics, null, 2));
    }
}
```

## Best Practices

### Security and Privacy
- Always validate URLs before making requests
- Don't log sensitive information like calendar details
- Use iCloud file storage for user data
- Handle permission requests gracefully

### Performance
- Cache frequently accessed data using `FileManager`
- Use appropriate timeout values for network requests
- Implement retry logic for failed operations
- Monitor performance with timing metrics

### Error Handling
- Always wrap async operations in try-catch blocks
- Provide meaningful error messages to users
- Log errors for debugging purposes
- Implement graceful fallbacks

### Calendar Integration
- Check for existing events before creating duplicates
- Use consistent naming for calendar titles
- Validate date/time data before creating events
- Handle timezone considerations properly

### Testing and Development
- Use dry-run mode during development
- Implement preview functionality
- Test with small data sets first
- Use console logging for debugging

This documentation provides a comprehensive reference for using Scriptable APIs effectively, with real-world examples from the bear event scraper project demonstrating practical implementation patterns.


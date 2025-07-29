# Bear Event Scraper Scripts

This directory contains Scriptable automation scripts for parsing bear community events and calendar management.

## Current Script

### bear-event-scraper-unified.js
The unified event scraper that parses bear events from multiple websites and formats them for calendar integration.

**Features:**
- Multi-site parsing (Furball, Rockbar, Bearracuda, Megawoof, SF Eagle, Eagle NY, Precinct)
- Smart bear event detection using keywords and allowlists
- Duplicate prevention and event merging
- City detection and calendar routing
- Simple safety mode with dry run protection
- Performance tracking and detailed reporting

## Core Components

The `core/` directory contains modular components:
- `input-adapters.js` - Input processing and validation
- `event-processor.js` - Event parsing and formatting logic  
- `display-adapters.js` - Output formatting and display

## Configuration

### Input Configuration
Use `scraper-input.json` as your main configuration file. Key settings:

```json
{
  "config": {
    "dryRun": true,           // When false, allows calendar modifications
    "timeout": 30000,         // HTTP request timeout in milliseconds
    "retryAttempts": 3        // Number of retry attempts for failed requests
  },
  "parsers": [
    {
      "name": "Venue Name",
      "parser": "parser-type",
      "urls": ["https://venue.com/events"],
      "city": "nyc",
      "allowlist": ["keyword1", "keyword2"],
      "requireKeywords": true,
      "description": "Venue description"
    }
  ],
  "calendarMappings": {
    "nyc": "chunky-dad-nyc",
    "la": "chunky-dad-la"
  }
}
```

### Safety Mode
- **Dry Run**: When `dryRun: true`, no calendar modifications occur. Set to `false` to enable calendar writes.

### Event Filtering
- **Future Events Only**: Automatically filters out events in the past
- **Optional Date Range**: Use `daysToLookAhead` parameter to limit how far ahead to look (unlimited by default)

## Enhanced Features (V7 - Additional Link Processing)

### 🔗 Additional Link Processing
The event parser now supports processing additional links for event pages that require deeper scraping:

#### Supported Parsers with Detail Pages:
- **Bearracuda** - Processes city-specific pages (`/sf/`, `/atlanta/`, `/vancouver-pride/`)
- **Megawoof** - Processes individual Eventbrite event pages
- **Generic parsers** - Looks for `/events/`, `/shows/`, `/calendar/` links

#### Configuration:
```json
{
  "name": "Bearracuda",
  "parser": "bearracuda", 
  "urls": ["https://bearracuda.com/#events"],
  "requireDetailPages": true,  // ← Enables additional link processing
  "alwaysBear": true
}
```

#### How It Works:
1. **Main Page**: Parser extracts initial events and discovers additional URLs
2. **URL Extraction**: Finds city-specific or event-specific detail pages
3. **Detail Processing**: Fetches and parses each additional URL
4. **Event Merging**: Combines events from main page and detail pages
5. **Deduplication**: Removes duplicate events based on title/date/venue

#### Bearracuda-Specific Enhancements:
- **City Detection**: Automatically maps cities (NEW ORLEANS → nola, San Francisco → sf)
- **Date Parsing**: Handles various date formats ("August 23, 2025")
- **Multi-City Support**: Processes events across multiple cities
- **Calendar Mapping**: Maps events to appropriate city calendars

#### URL Extraction Patterns:
```javascript
// Bearracuda city pages
/href="([^"]*\/(?:sf|atlanta|denver|la|nyc|seattle|portland|vancouver|chicago|new-orleans)[^"]*)"[^>]*>/gi

// Generic event pages  
/href="([^"]*\/event[s]?\/[^"]*)"[^>]*>/gi
/href="([^"]*\/show[s]?\/[^"]*)"[^>]*>/gi
/href="([^"]*\/calendar\/[^"]*)"[^>]*>/gi
```

#### Performance Considerations:
- **Rate Limiting**: Limited to 8-15 additional URLs per parser
- **Timeout Protection**: 10-second timeout per request
- **Error Handling**: Graceful failure - continues if detail pages fail
- **Logging**: Detailed progress logging for debugging

#### Example Output:
```
Processing: Bearracuda
  → Fetching data from https://bearracuda.com/#events
  ✓ Fetched 15,234 characters of HTML
  → Processing events with bearracuda parser
  → Found 4 additional URLs to process
    → Processing detail page: https://bearracuda.com/sf/
    ✓ Processed 1 events from detail page
    → Processing detail page: https://bearracuda.com/atlanta/
    ✓ Processed 1 events from detail page
  ✓ Bearracuda: 6 events found (6 bear events)
```

## Installation & Usage

### For Scriptable (iOS)
1. Install [Scriptable](https://scriptable.app/) on iOS
2. Copy `bear-event-scraper-unified.js` to Scriptable
3. Copy `scraper-input.json` to **iCloud Drive/Scriptable/** folder
4. Run the script - it will automatically load the JSON configuration
5. Set `dryRun: false` in the JSON config when ready for live calendar updates

### For Web Testing
1. Open `../testing/test-unified-scraper.html` in a browser
2. The script will automatically load `scraper-input.json` from the scripts folder
3. Use the web interface to test different configurations

### Configuration Loading
- **Scriptable**: Requires `scraper-input.json` in iCloud Drive/Scriptable/ folder
- **Web**: Requires `scraper-input.json` in the scripts directory
- **Required**: Script will fail if JSON configuration file is not found

## Scriptable API Reference

Complete Scriptable API documentation is available in `scriptable-complete-api.md` with 54+ documented classes including:
- HTTP requests (Request class)
- Calendar integration (Calendar, CalendarEvent classes)  
- File operations (FileManager class)
- Data parsing (Data, XMLParser classes)
- UI components (Alert, Notification classes)

## Testing

Use the testing environment at `../testing/test-unified-scraper.html` for development and validation. This provides a web-based interface for testing scraper functionality without requiring iOS.

## Supported Venues

The scraper currently supports these bear-friendly venues:
- **Furball NYC** - Joe Fiore's dance parties (all events are bear-related)
- **Rockbar NYC** - Leather/bear bar with keyword filtering
- **Bearracuda** - Multi-city bear dance parties
- **Megawoof America** - Bear weekend events via Eventbrite
- **SF Eagle** - San Francisco's legendary leather/bear bar
- **Eagle NY** - New York's Eagle Bar with keyword filtering
- **Precinct DTLA** - Los Angeles downtown leather/bear venue

## Calendar Integration

Events are automatically mapped to city-specific calendars:
- NYC events → `chunky-dad-nyc`
- LA events → `chunky-dad-la`
- SF events → `chunky-dad-sf`
- And more cities as configured in `calendarMappings`
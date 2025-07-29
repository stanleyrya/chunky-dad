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

## Enhanced Features (V7 - Scalable URL Processing)

### 🔗 Scalable Additional Link Processing
The event parser now supports a **hybrid scalable system** that combines intelligent auto-detection with configurable patterns and parser-specific overrides for maximum flexibility:

#### 🎯 **Four Configuration Levels** (Choose Based on Complexity):

1. **Auto-Detection (Recommended)** - Just add `"requireDetailPages": true`
   - System automatically detects website type (Eagle, Eventbrite, Facebook, etc.)
   - Uses intelligent default patterns based on URL structure
   - Works out-of-the-box for most websites

2. **Custom Patterns** - Define `urlPatterns` array for unique structures
   - Perfect for sites with non-standard URL structures
   - Flexible regex patterns with individual limits
   - Pattern-specific filtering options

3. **URL Filtering** - Use `urlFilters` to include/exclude specific patterns
   - Fine-tune which URLs get processed
   - Prevent processing admin, login, or irrelevant pages
   - Include only URLs matching specific criteria

4. **Parser-Specific** - Use `"urlExtractionMethod": "parser-specific"` for complex logic
   - Custom extraction logic for sites like Bearracuda
   - Handles complex multi-page structures
   - Full programmatic control over URL discovery

#### 🚀 **Intelligent Auto-Detection**
The system automatically recognizes common website patterns:

- **Eagle Sites** (`eagle.com`) → Event pages, party pages, calendar links
- **Eventbrite** (`eventbrite.com`) → Individual event pages (`/e/event-name`)
- **Facebook** (`facebook.com`) → Event pages (`/events/123456`)
- **WordPress** (generic) → Event posts, category pages, calendar pages
- **Generic Sites** → Standard `/events/`, `/shows/`, `/calendar/` patterns

#### 📋 **Configuration Examples**:

```json
// 1. AUTO-DETECTION (Recommended)
{
  "name": "SF Eagle",
  "parser": "sf-eagle",
  "urls": ["https://sf-eagle.com/events/"],
  "requireDetailPages": true,
  "maxAdditionalUrls": 12
}

// 2. CUSTOM PATTERNS
{
  "name": "Custom Event Site",
  "parser": "generic",
  "urls": ["https://example.com/calendar"],
  "requireDetailPages": true,
  "urlPatterns": [
    {
      "name": "Monthly Pages",
      "regex": "href=\"([^\"]*\\/calendar\\/\\d{4}-\\d{2}[^\"]*)\">",
      "maxMatches": 12,
      "description": "Monthly calendar pages"
    }
  ]
}

// 3. URL FILTERING
{
  "name": "Eventbrite Organizer",
  "parser": "eventbrite",
  "urls": ["https://www.eventbrite.com/o/organizer-12345"],
  "requireDetailPages": true,
  "urlFilters": {
    "include": ["eventbrite\\.com\\/e\\/.*bear"],
    "exclude": ["\\?discount=", "\\/register", "\\/tickets"]
  }
}

// 4. PARSER-SPECIFIC
{
  "name": "Bearracuda",
  "parser": "bearracuda",
  "urls": ["https://bearracuda.com/#events"],
  "requireDetailPages": true,
  "urlExtractionMethod": "parser-specific"
}
```

#### ⚡ **Performance & Safety Features**:
- **Rate Limiting**: Configurable limits (8-25 URLs per parser)
- **Timeout Protection**: 10-second timeout per request
- **Error Handling**: Graceful failure - continues if detail pages fail
- **URL Validation**: Automatic filtering of invalid/irrelevant URLs
- **Deduplication**: Removes duplicate URLs automatically
- **Smart Filtering**: Excludes admin, login, social media, and anchor links

#### 📊 **Example Output**:
```
Processing: SF Eagle
  → Fetching data from https://sf-eagle.com/events/
  ✓ Fetched 12,847 characters of HTML
  → Processing events with sf-eagle parser
  → Using 6 URL patterns for extraction
    → Pattern "Event Pages" found 3 URLs
    → Pattern "Eagle Events" found 5 URLs
    → Pattern "Calendar Pages" found 2 URLs
  → Found 10 additional URLs to process
    → Processing detail page: https://sf-eagle.com/event/bear-night
    ✓ Processed 1 events from detail page
  ✓ SF Eagle: 8 events found (6 bear events)
```

#### 🔄 **Migration Path**:
1. **Existing parsers**: Add `"requireDetailPages": true` → Auto-detection activates
2. **Test results**: Run scraper to see what URLs are discovered
3. **Fine-tune**: Add `urlFilters` or `urlPatterns` if needed
4. **Complex cases**: Use `"urlExtractionMethod": "parser-specific"` only if required

#### 🎛️ **Available Configuration Options**:
- `requireDetailPages`: Enable additional URL processing
- `maxAdditionalUrls`: Limit number of URLs processed (default: 12)
- `urlPatterns`: Array of custom regex patterns
- `urlFilters.include`: Only process URLs matching these patterns
- `urlFilters.exclude`: Skip URLs matching these patterns
- `urlExtractionMethod`: Use "parser-specific" for custom logic

This scalable system **works out-of-the-box** for most websites while providing **infinite customization** for unique cases, ensuring the parser can handle any website structure efficiently and reliably.

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
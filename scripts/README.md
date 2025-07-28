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
- Safety modes (dry run, preview, calendar sync controls)
- Performance tracking and detailed reporting

## Core Components

The `core/` directory contains modular components:
- `input-adapters.js` - Input processing and validation
- `event-processor.js` - Event parsing and formatting logic  
- `display-adapters.js` - Output formatting and display

## Configuration

### Input Example
Use `bear-event-parser-input-example.json` as a template for configuration. Key settings:

```json
{
  "config": {
    "dryRun": true,           // Prevents calendar changes
    "preview": true,          // Shows preview of operations
    "calendarSync": false,    // Must enable to allow calendar sync
    "safetyMode": true        // Enables all safety features
  },
  "parsers": [
    {
      "name": "Venue Name",
      "parser": "parser-type",
      "urls": ["https://venue.com/events"],
      "allowlist": ["keyword1", "keyword2"],
      "description": "Venue description"
    }
  ]
}
```

### Safety Modes
- **Dry Run**: When enabled, no calendar modifications occur
- **Preview Mode**: Shows detailed preview of operations
- **Calendar Sync**: Must be explicitly enabled for calendar integration
- **Safety Mode**: Enables all protective features

## Installation & Usage

1. Install [Scriptable](https://scriptable.app/) on iOS
2. Copy `bear-event-scraper-unified.js` to Scriptable
3. Configure using `bear-event-parser-input-example.json` as template
4. Run with safety modes enabled for testing
5. Enable calendar sync only when ready for live updates

## Scriptable API Reference

Complete Scriptable API documentation is available in `scriptable-complete-api.md` with 54+ documented classes including:
- HTTP requests (Request class)
- Calendar integration (Calendar, CalendarEvent classes)  
- File operations (FileManager class)
- Data parsing (Data, XMLParser classes)
- UI components (Alert, Notification classes)

## Testing

Use the testing environment at `../testing/test-unified-scraper.html` for development and validation. This provides a web-based interface for testing scraper functionality without requiring iOS.

## Configuration Files

- `scraper-config.json` - Base scraper configuration
- `bear-event-parser-input-example.json` - Input template with all supported venues
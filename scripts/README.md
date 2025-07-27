# Bear Event Scraper for Scriptable

A Scriptable-based tool that automatically checks bear event websites, parses event information, and syncs them to Google Calendars organized by city.

## Overview

The Bear Event Scraper automates the process of:
- Fetching event listings from various bear-focused venues and event organizers
- Parsing event details (title, date, location, description)
- Filtering events based on bear-related keywords
- Syncing events to city-specific Google Calendars (chunky-dad-nyc, chunky-dad-la, etc.)
- Avoiding duplicate events
- Flagging low-confidence parsed events for manual review

## Files

- `bear-event-scraper.js` - Main scraper script with embedded dependencies
- `scraper-config.json` - Configuration file for event sources and settings
- `minified-json-file-manager.js` - JSON file management utilities
- `minified-file-logger.js` - Logging functionality
- `minified-performance-debugger.js` - Performance monitoring

## Installation

1. Install [Scriptable](https://scriptable.app/) on your iOS device
2. Copy `bear-event-scraper.js` to your Scriptable folder in iCloud Drive
3. Copy `scraper-config.json` to the same folder (optional - will use defaults if missing)
4. Ensure you have the target Google Calendars created:
   - chunky-dad-nyc
   - chunky-dad-la
   - chunky-dad-sf
   - (and other cities as configured)

## Usage

### Running the Scraper

1. Open Scriptable app
2. Tap on "Bear Event Scraper"
3. The script will:
   - Load configuration
   - Fetch events from all configured sources
   - Filter based on keywords
   - Sync to appropriate calendars
   - Show a summary of results

### Widget Mode

Add the script as a widget to see event sync status at a glance:
1. Add a Scriptable widget to your home screen
2. Configure it to run "Bear Event Scraper"
3. The widget shows:
   - Total events found
   - Events created
   - Events updated
   - Any errors

### Automation

Set up iOS Shortcuts to run the scraper automatically:
1. Create a new Shortcut
2. Add "Run Script" action
3. Select "Bear Event Scraper"
4. Schedule to run daily/weekly

## Configuration

Edit `scraper-config.json` to customize:

### Event Sources

```json
{
  "sources": [
    {
      "name": "Source Name",
      "city": "nyc",  // or "multi" for sources with events in multiple cities
      "url": "https://example.com/events",
      "urls": ["url1", "url2"],  // alternative: multiple URLs for one source
      "alwaysBear": true,  // all events from this source are bear-related
      "requireKeywords": true,  // filter events by keywords
      "requireDetailPages": true,  // fetch individual event pages for details
      "allowlist": ["keyword1", "keyword2"]  // additional keywords to match
    }
  ]
}
```

### Settings

```json
{
  "settings": {
    "maxEventsPerSource": 50,
    "daysToLookAhead": 90,
    "logRetentionDays": 30,
    "enablePerformanceLogging": true,
    "enableDebugMode": true
  }
}
```

### Calendar Mappings

Maps city identifiers to Google Calendar names:

```json
{
  "calendarMappings": {
    "nyc": "chunky-dad-nyc",
    "la": "chunky-dad-la",
    "sf": "chunky-dad-sf"
  }
}
```

## Event Parsing

The scraper looks for:
- **Title**: In `<h1>`, `<h2>`, `<h3>` tags
- **Date**: Various formats (MM/DD/YYYY, Month DD YYYY, etc.)
- **Location**: In address tags, location/venue classes
- **Description**: From meta tags or page content

Events are marked with confidence levels:
- **High**: Successfully parsed title and date
- **Low**: Missing critical information (flagged with `[not-checked]`)

## Keyword Filtering

Default bear-related keywords:
- bear, bears, cub, cubs, otter, otters
- woof, grr, furball, bearracuda, megawoof
- rockstrap, underbear, bearnight, bearpride
- bearweek, tbru, bearcrazy, bearparty

Sources can add custom keywords via the `allowlist` configuration.

## Duplicate Prevention

The scraper checks for existing events by:
1. Exact title match on the same date
2. Fuzzy title matching (80% similarity threshold)
3. Updates existing events with missing information rather than creating duplicates

## Logging

Logs are saved to:
- `bear-event-scraper.log` - General operation logs
- `bear-scraper-performance.log` - Performance metrics

View logs:
1. After running, tap "View Logs" in the results dialog
2. Or use Scriptable's file browser to view log files

## Output Format

Events are synced to Google Calendar with:
- **Title**: Event name
- **Date/Time**: Start and end times
- **Location**: Venue address
- **Notes**: Description, source URL, and confidence flags

Results are also saved to timestamped JSON files:
- `bear-events-results-YYYY-MM-DD.json`

## Troubleshooting

### No events found
- Check source URLs are accessible
- Verify keyword filtering isn't too restrictive
- Review logs for parsing errors

### Calendar not found
- Ensure calendar names match exactly (case-sensitive)
- Verify calendar permissions in iOS Settings

### Parsing errors
- Some sites may require custom parsing logic
- Check logs for specific error messages
- Low-confidence events are flagged for manual review

## Integration with chunky.dad

This scraper follows the data format used by:
- `js/calendar-core.js` - Core calendar data structures
- `js/dynamic-calendar-loader.js` - Calendar UI components

Events synced by this tool will appear in the chunky.dad calendar views for each city.

## Development

To add a new event source:

1. Add source configuration to `scraper-config.json`
2. If needed, customize parsing logic in `parseEventFromHTML()`
3. Test with a single source first
4. Monitor logs for parsing accuracy

## Privacy & Permissions

The script requires:
- Calendar access (read/write)
- Network access (fetch event pages)
- File system access (logs and config)

No personal data is transmitted outside your device.
# Bear Event Parser for Scriptable

This directory contains scripts for parsing bear event data from various websites and updating Google Calendar automatically using Scriptable on iOS.

## Available Scripts

### 1. bear-event-parser.js (Original)
The original implementation with basic parsing capabilities.

### 2. bear-event-scraper-v2.js (Enhanced Version)
An improved version with:
- Enhanced HTML parsing with structured data support
- Better date parsing (handles relative dates, multiple formats)
- Improved city detection with expanded mappings
- More comprehensive bear keyword list
- Better error handling and performance tracking
- Detailed reporting capabilities

### 3. bear-event-scraper-v3.js (Precise Parsing Version)
The most accurate version based on actual website analysis:
- **Furball**: Parses `<h2>` date tags followed by `<h2>` title and `<h3>` location
- **Rockbar**: Extracts `<h3>` titles with adjacent `<div>` for details, follows "View Event" links
- **Megawoof**: Handles Eventbrite's structured data and event cards
- **Bearracuda**: Maintains V2 approach (not analyzed in detail)
- Includes precise date parsing for formats like "JULY 25, 2025"
- Better venue extraction with default addresses
- Enhanced bear keyword list including "diaper happy hour" and "bears night out"

### 4. bear-event-scraper-safe.js (Safe Testing Version)
A safety-focused version for testing without affecting calendars:
- **DRY RUN MODE**: Enabled by default - no calendar modifications
- **PREVIEW MODE**: Shows exactly what would be created/updated
- **CALENDAR SYNC**: Disabled by default - must explicitly enable
- Generates detailed safety reports showing planned operations
- Perfect for testing and validating parser improvements
- Based on V3 parsing with added safety layers

## Overview

The Bear Event Parser is a Scriptable script that:
- Fetches event data from multiple bear event websites
- Parses and extracts relevant event information
- Formats events according to the Chunky Dad calendar structure
- Merges with existing calendar events to avoid duplicates
- Supports multiple cities and calendars
- Includes a "not-checked" flag for new events until validated

## Features

1. **Multi-site parsing**: Supports parsing from Furball, Rockbar, Bearracuda, and Megawoof
2. **Smart event detection**: Uses bear-related keywords and allowlists to filter relevant events
3. **Duplicate prevention**: Checks for existing events and merges information
4. **City detection**: Automatically determines which city calendar to use
5. **Flexible configuration**: JSON-based input for easy customization
6. **Performance tracking**: Built-in performance debugging and logging
7. **Comparison reports**: Generates reports for validation

## Installation

1. Install [Scriptable](https://scriptable.app/) on your iOS device
2. Choose which version to use:
   - Copy `bear-event-parser.js` for the original version
   - Copy `bear-event-scraper-v2.js` for the enhanced version
   - Copy `bear-event-scraper-v3.js` for the precise parsing version
   - Copy `bear-event-scraper-safe.js` for safe testing (recommended for first-time users)
3. The scripts include all necessary dependencies (minified)

## Usage

### Input Configuration

Create a file named `bear-event-parser-input.json` in Scriptable with your parser configuration:

```json
{
  "parsers": [
    {
      "name": "Furball",
      "parser": "furball",
      "urls": [
        "https://www.furball.nyc",
        "https://www.furball.nyc/ticket-information",
        "https://www.furball.nyc/upcoming-schedule"
      ]
    },
    {
      "name": "Rockbar",
      "parser": "rockbar",
      "urls": ["https://www.rockbarnyc.com/calendar"],
      "allowlist": ["rockstrap", "underbear"]
    },
    {
      "name": "Bearracuda",
      "parser": "bearracuda",
      "urls": ["https://bearracuda.com/#events"]
    },
    {
      "name": "Megawoof",
      "parser": "megawoof",
      "urls": ["https://www.eventbrite.com/o/megawoof-america-18118978189"]
    }
  ]
}
```

### Running the Script

1. Open Scriptable
2. Run the `bear-event-parser` script
3. The script will:
   - Load the input configuration
   - Parse events from each configured website
   - Save events to calendar cache files
   - Generate logs and reports

### Output Files

The original script generates:
- `calendar-cache-{city}.json`: Cached events for each city calendar
- `bear-event-parser-logs.txt`: Detailed execution logs
- `bear-event-parser-performance.csv`: Performance metrics
- `bear-event-parser-report-{date}.txt`: Comparison report for validation
- `bear-event-parser-config.json`: Saved configuration and last run time

The V2 script generates:
- `bear-events-v2-{date}.json`: Parsed events organized by city
- `bear-event-scraper-v2-logs.txt`: Detailed execution logs
- `bear-event-scraper-v2-performance.csv`: Performance metrics
- `bear-event-scraper-v2-report-{date}.txt`: Comprehensive report with event details

The V3 script generates:
- `bear-events-v3-{date}.json`: Parsed events with precise extraction
- `bear-event-scraper-v3-logs.txt`: Detailed parsing logs
- `bear-event-scraper-v3-performance.csv`: Performance metrics
- `bear-event-scraper-v3-report-{date}.txt`: Detailed report with all event fields

## Parser Configurations

### Furball
- **URLs**: Main site, ticket info, and schedule pages
- **Special**: Merges information across multiple pages
- **Cities**: Multiple cities
- **Filter**: Always bear events

### Rockbar
- **URLs**: Calendar page
- **Special**: Filters non-bear events
- **Cities**: NYC only
- **Filter**: Bear keywords + allowlist (Rockstrap, Underbear)

### Bearracuda
- **URLs**: Events section
- **Special**: Follows individual event links
- **Cities**: Multiple cities
- **Filter**: Always bear events

### Megawoof
- **URLs**: Eventbrite organizer page
- **Special**: Parses Eventbrite event pages
- **Cities**: Multiple cities
- **Filter**: Always bear events

## Event Data Structure

Events are formatted to match the Chunky Dad calendar structure:

```javascript
{
  name: "Event Name",
  startDate: Date,
  endDate: Date,
  day: "Monday",
  time: "9PM-2AM",
  bar: "Venue Name",
  cover: "$20",
  tea: "Event description",
  coordinates: { lat: 40.7128, lng: -74.0060 },
  links: [
    { type: "website", url: "...", label: "🌐 Website" }
  ],
  eventType: "special",
  recurring: false,
  notChecked: true,  // New events are marked as not-checked
  city: "nyc"
}
```

## City Calendar Mapping

The script automatically maps cities to calendar IDs:

- NYC → chunky-dad-nyc
- LA → chunky-dad-la
- Chicago → chunky-dad-chicago
- SF → chunky-dad-sf
- Seattle → chunky-dad-seattle
- DC → chunky-dad-dc
- Boston → chunky-dad-boston
- Atlanta → chunky-dad-atlanta
- Miami → chunky-dad-miami
- Dallas → chunky-dad-dallas
- Denver → chunky-dad-denver
- Portland → chunky-dad-portland
- Philadelphia → chunky-dad-philadelphia
- Phoenix → chunky-dad-phoenix
- Austin → chunky-dad-austin

## Integration with Dynamic Calendar Loader

To integrate with `dynamic-calendar-loader.js`, update it to check for the `notChecked` flag:

```javascript
// In dynamic-calendar-loader.js, when filtering events:
if (event.notChecked && this.config.hideUncheckedEvents) {
  return false; // Skip unchecked events
}
```

## Validation Workflow

1. Run the parser to fetch new events
2. Review the comparison report
3. Check events against source websites
4. Remove the `notChecked` flag from validated events
5. Update the calendar cache files

## Bear Keywords

The script uses these keywords to identify bear events:
- bear, bears, cub, cubs
- otter, otters, daddy, daddies
- woof, grr, furry, hairy
- beef, chunk, chub, muscle bear
- leather bear, polar bear, grizzly
- bearracuda, furball, megawoof

## Troubleshooting

### No events found
- Check the website URLs are correct
- Verify the HTML structure hasn't changed
- Review logs for parsing errors

### Wrong city assignment
- Check location/venue text in events
- Add city patterns if needed
- Manually specify city in unmapped events

### Performance issues
- Check performance CSV for slow operations
- Reduce number of concurrent requests
- Add delays between requests if needed

## Development

### Adding a New Parser

1. Create a new parser method in `BearEventParser` class
2. Add parser type to the switch statement in `parseEvents()`
3. Implement HTML parsing logic for the specific site
4. Add to input configuration

### Modifying Event Structure

1. Update `formatEventForCalendar()` method
2. Ensure compatibility with `calendar-core.js`
3. Update merge logic if needed

## Dependencies

The script includes minified versions of:
- JSONFileManager: File-based JSON storage
- FileLogger: Logging to files
- PerformanceDebugger: Performance tracking

All dependencies are included in the script file.

## Version Comparison

### Original (bear-event-parser.js)
- Basic HTML parsing
- Standard date formats
- Core city mappings
- Simple keyword matching
- Basic logging

### V2 (bear-event-scraper-v2.js)
- **Enhanced HTML parsing**: Extracts structured data (JSON-LD) when available
- **Advanced date parsing**: Handles relative dates ("next Friday"), multiple formats, times
- **Expanded city detection**: More city aliases, state abbreviations, neighborhood names
- **Comprehensive keywords**: Extended bear-related keyword list
- **Better error handling**: Graceful fallbacks, detailed error reporting
- **Improved performance tracking**: Wrapped function calls with timing metrics
- **Rich reporting**: Detailed event breakdowns by source and city
- **Widget support**: Can display summary as iOS widget

### Which Version to Use?

- **Use V3** (Recommended) if you want:
  - Most accurate parsing based on actual website structures
  - Precise extraction of dates, venues, and event details
  - Best handling of Furball's multi-page structure
  - Accurate Rockbar event filtering with detail page support
  
- **Use V2** if you want:
  - Good general-purpose parsing
  - Structured data extraction when available
  - Comprehensive city coverage
  - Fallback for sites not yet analyzed
  
- **Use Original** if you want:
  - Simpler, more straightforward parsing
  - Compatibility with existing cache files
  - Less complex output format

### Version Comparison Summary

| Feature | Original | V2 | V3 | Safe |
|---------|----------|-----|-----|------|
| HTML Parsing | Basic | Enhanced with JSON-LD | Precise per-site patterns | Same as V3 |
| Date Parsing | Standard | Advanced + relative | Specific formats (JULY 25, 2025) | Same as V3 |
| City Detection | Basic | Expanded | Expanded + location parsing | Same as V3 |
| Furball Support | Generic | Better | Precise h2/h3 structure | Same as V3 |
| Rockbar Support | Generic | Keyword filtering | h3 + div pattern, detail pages | Same as V3 |
| Eventbrite | Basic | Good | Structured data + fallbacks | Same as V3 |
| Performance | Basic logging | Detailed metrics | Detailed metrics | Detailed metrics |
| Accuracy | Medium | Good | Excellent | Excellent |
| Safety Features | ✅ Added | ✅ Added | ✅ Added | ✅ Enhanced reporting |
| Dry Run Mode | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| Preview Mode | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes + detailed report |

## Safety and Testing

**All versions (Original, V2, V3, and Safe) now include safety features!**

### Safe Mode Configuration

All versions use these config options:
```json
{
  "config": {
    "dryRun": true,        // Don't modify calendars
    "preview": true,       // Show what would be done
    "calendarSync": false, // Disable calendar sync
    "safetyMode": true    // Enable all safety features
  }
}
```

To enable calendar sync (USE WITH CAUTION):
```json
{
  "config": {
    "safetyMode": false,
    "calendarSync": true
  }
}
```

### Testing Workflow

1. Choose any version to test (all have safety features enabled by default)
2. Run with default settings to see parsed events
3. Compare results between versions:
   - Original: Basic parsing
   - V2: Enhanced with structured data
   - V3: Precise HTML patterns
   - Safe: Same as V3 with extra safety reporting
4. Check the generated JSON files for accuracy
5. Review logs to see what each version found
6. Only enable calendar sync after validating results

## For Future AI Agents

### Current State

As of this implementation, we have:
- 4 versions of the scraper (Original, V2, V3, Safe)
- Precise parsing patterns for Furball and Rockbar based on actual HTML analysis
- Basic parsing for Bearracuda and Megawoof (needs improvement)
- Safety features to prevent calendar corruption during testing

### Areas for Improvement

1. **Bearracuda Parser**: 
   - Needs actual HTML analysis like we did for Furball/Rockbar
   - Current implementation is generic
   - Should analyze the #events section structure

2. **Megawoof/Eventbrite Parser**:
   - Could be improved with better Eventbrite-specific parsing
   - Should handle pagination if events span multiple pages
   - Better extraction of multi-day events

3. **Calendar Integration**:
   - Currently only simulated in the Safe version
   - Original V1 attempted real calendar sync but was incomplete
   - Need to implement actual Calendar API calls with proper error handling

4. **Additional Sources to Add**:
   - The Eagle (various cities)
   - Precinct LA
   - SF Eagle
   - Local bear bar websites

5. **Enhanced Features**:
   - Duplicate detection based on fuzzy matching
   - Event image extraction
   - Ticket link preservation
   - Price range parsing
   - Age restriction detection

### Code Architecture

The codebase follows this pattern:
1. **Minified dependencies** embedded at the top
2. **Configuration** loaded from JSON files
3. **Parser methods** specific to each source
4. **Safety features** in the Safe version
5. **Reporting** in multiple formats (JSON, text, preview)

### Key Files and Their Purposes

- `bear-event-parser-input.json`: Configuration for sources to scrape
- `bear-event-parser-input-example.json`: Example configuration with notes
- Output files follow pattern: `bear-events-{version}-{date}.json`
- Logs follow pattern: `bear-event-scraper-{version}-logs.txt`

### HTML Parsing Patterns Discovered

**Furball**:
```html
<h2>JULY 25, 2025</h2>
<h2>FURBALL NYC</h2>
<h3>Eagle Bar - NYC</h3>
```

**Rockbar**:
```html
<h3>BEARS NIGHT OUT</h3>
<div>Friday, January 10 · 10:00 PM...</div>
```

### Next Steps

1. **Complete Calendar Integration**: Implement actual calendar sync in a new version
2. **Add More Sources**: Analyze and add parsers for other bear event websites
3. **Improve Existing Parsers**: Use actual HTML analysis for Bearracuda/Megawoof
4. **Add Unit Tests**: Create test cases with sample HTML
5. **Error Recovery**: Better handling of network failures and parsing errors
6. **Scheduling**: Add support for recurring events
7. **Notifications**: Alert when new events are found

### Important Notes

- Always test with Safe mode first
- The cityCalendarMap determines which calendar events go to
- Bear keywords are case-insensitive
- Date parsing handles multiple formats but may need expansion
- Performance metrics help identify slow parsers
# Bear Event Parser for Scriptable

This directory contains scripts for parsing bear event data from various websites and updating Google Calendar automatically using Scriptable on iOS.

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
2. Copy `bear-event-parser.js` to Scriptable
3. The script includes all necessary dependencies (minified)

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

The script generates several files:

- `calendar-cache-{city}.json`: Cached events for each city calendar
- `bear-event-parser-logs.txt`: Detailed execution logs
- `bear-event-parser-performance.csv`: Performance metrics
- `bear-event-parser-report-{date}.txt`: Comparison report for validation
- `bear-event-parser-config.json`: Saved configuration and last run time

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
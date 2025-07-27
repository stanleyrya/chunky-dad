# Website Samples for Bear Event Parser

This directory contains minimal HTML samples and data structures used by the bear event parser. These samples are extracted from real websites to ensure the parser works with actual website structures.

## Files

### HTML Pattern Samples
- **`furball-patterns.html`** - Furball/Wix website parsing patterns
- **`rockbar-patterns.html`** - Rockbar/Squarespace calendar patterns  
- **`megawoof-patterns.html`** - Megawoof/Eventbrite data attribute patterns
- **`eagle-patterns.html`** - Eagle bars/Tribe Events calendar patterns

### Data Structure
- **`event-data-structure.json`** - Standardized event format for repeatability
- **`platform-patterns.json`** - Website platforms and reusable parsing patterns

## Purpose

These samples serve multiple purposes:

1. **Parser Development** - Provide concrete HTML structures to test parsing logic against
2. **Repeatability** - Ensure consistent data output format across all parsers
3. **Documentation** - Show exactly what HTML patterns each parser expects
4. **Testing** - Enable unit testing without relying on live websites
5. **Maintenance** - Quick reference when websites change their structure
6. **Scalability** - Identify platform patterns to easily add new websites

## Data Structure Consistency

All parsers output events in the standardized format defined in `event-data-structure.json`:

```javascript
{
  name: "Event Name",
  startDate: Date,
  endDate: Date, 
  day: "Monday",
  time: "9PM",
  bar: "Venue Name",
  city: "nyc",
  // ... additional fields
}
```

This ensures compatibility with the chunky-dad calendar system and enables reliable data processing.

## Usage

The V5 parser (`bear-event-scraper-v5.js`) uses these patterns to:

1. **Match HTML structures** using the documented regex patterns
2. **Extract event data** following the standardized format
3. **Validate output** against the defined data structure
4. **Map venues** to consistent city codes and addresses

## Maintenance

When websites change their HTML structure:

1. Update the relevant pattern file with new HTML examples
2. Modify the corresponding parser method in `bear-event-scraper-v5.js`
3. Test against the updated patterns
4. Update the data structure if new fields are needed

This approach ensures the parser remains maintainable and testable over time.

## Platform Patterns for Scaling

The `platform-patterns.json` file documents the underlying technologies:

### Supported Platforms
- **Squarespace** - Calendar sites with `fc-event-title` classes (like Rockbar)
- **Wix** - Sites with `wixui-rich-text` structures (like Furball)  
- **Eventbrite** - Organizer pages with `data-event-*` attributes (like Megawoof)
- **WordPress + Tribe Events** - Sites with `tribe-events-calendar-list` (like Eagles)
- **WordPress + Elementor** - Sites with `elementor-frontend` (like Bearracuda)
- **Custom Systems** - Fallback patterns for proprietary calendars

### Adding New Sites
When you find a new bear event website:

1. **Identify the platform** using the detection methods in `platform-patterns.json`
2. **Use the existing parser** for that platform type
3. **Customize as needed** (allowlists, venue info, etc.)
4. **Test and document** the new site

For example, if you find a new Squarespace bar website, you can immediately use the Rockbar parser pattern by looking for `fc-event-title` classes.
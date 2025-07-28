# Bear Event Scraper - New Modular Architecture

## Overview

The new architecture follows the **Input → Processing → Display** pattern you requested, with modular components that work in both Scriptable and web environments.

## Architecture Components

### 1. Input Layer (`core/input-adapters.js`)
**Responsibility:** Fetch data from websites
**Environment-Specific:** Different implementations for Scriptable vs Web

- **ScriptableInputAdapter:** Uses Scriptable's `Request` class
- **WebInputAdapter:** Uses browser `fetch()` API or mock data for testing
- **Auto-detection:** Automatically chooses the right adapter based on environment

### 2. Processing Layer (`core/event-processor.js`)
**Responsibility:** Parse and standardize event data
**Environment-Agnostic:** Same logic works everywhere

- **Website-specific parsers:** Furball, Rockbar, SF Eagle, etc.
- **Bear event detection:** Keyword matching and allowlists
- **Data standardization:** Consistent output format
- **Validation:** Date ranges, required fields, deduplication

### 3. Display Layer (`core/display-adapters.js`)
**Responsibility:** Show results to user
**Environment-Specific:** Different UI approaches

- **ScriptableDisplayAdapter:** Uses `Alert`, `Notification`, console output
- **WebDisplayAdapter:** Creates HTML elements, tables, JSON views
- **Multiple formats:** HTML cards, tables, raw JSON

### 4. Main Orchestrator (`bear-event-scraper-unified.js`)
**Responsibility:** Coordinate all components
**Environment-Agnostic:** Same orchestration logic

- **Module loading:** Dynamic loading with fallbacks
- **Configuration management:** Dry-run, mock mode, safety features
- **Error handling:** Graceful failures with appropriate user feedback
- **Result combination:** Merge and deduplicate events from multiple sources

## Key Benefits

### ✅ Modular Design
- Each component has a single responsibility
- Easy to test individual components
- Clear separation of concerns

### ✅ Dual Environment Support
- Same core logic works in Scriptable and web browsers
- Environment-specific adapters handle platform differences
- Automatic environment detection

### ✅ Testable Architecture
- Mock mode for safe testing without hitting real websites
- Web test page for development and debugging
- Consistent behavior across environments

### ✅ Extensible Structure
- Easy to add new website parsers
- Simple to add new display formats
- Straightforward to support new environments

### ✅ Safety Features
- Dry-run mode prevents unintended changes
- Mock mode for development
- Error handling with user-friendly messages
- Configuration validation

## File Structure

```
scripts/
├── core/                           # Modular components
│   ├── input-adapters.js          # Environment-specific data fetching
│   ├── event-processor.js         # Core parsing and processing logic
│   └── display-adapters.js        # Environment-specific result display
├── bear-event-scraper-unified.js  # Main orchestrator
├── scraper-config.json            # Website configurations
└── [legacy files...]              # Old monolithic versions (v1-v5)

testing/
└── test-unified-scraper.html      # Web test page demonstrating architecture
```

## Usage Examples

### Scriptable Environment
```javascript
// Just run the script - it auto-detects environment
// Uses Scriptable APIs: Request, Alert, FileManager
```

### Web Environment
```javascript
// Load modules via script tags, then:
const scraper = new BearEventScraper({
    mockMode: true,  // Safe testing
    displayFormat: 'html'
});

const results = await scraper.scrapeEvents(sources);
```

### Configuration
```javascript
const config = {
    dryRun: true,        // Don't modify calendars
    mockMode: true,      // Use mock data for testing
    maxEvents: 50,       // Limit results
    displayFormat: 'html' // html, table, json, alert, notification
};
```

## Migration from Legacy Versions

### What's Different
- **v1-v5:** Monolithic scripts with embedded dependencies
- **Unified:** Modular components with clear interfaces
- **Legacy:** Environment-specific code mixed throughout
- **New:** Environment detection with appropriate adapters

### What's the Same
- **Bear keyword detection:** Same logic and keywords
- **Website parsing:** Same parsing strategies (improved)
- **Safety features:** Dry-run, preview mode, error handling
- **Configuration:** Similar website and parser configs

### Migration Path
1. **Test new architecture** using the web test page
2. **Verify parsing accuracy** against known working versions
3. **Update website-specific parsers** as needed
4. **Gradually replace legacy scripts** with unified version

## Development Workflow

### For Web Testing
1. Open `testing/test-unified-scraper.html`
2. Enable mock mode for safe testing
3. Try different display formats
4. Check browser console for detailed logs

### For Scriptable Development
1. Copy `bear-event-scraper-unified.js` to Scriptable
2. Set `mockMode: false` for real scraping
3. Use `dryRun: true` to prevent calendar changes
4. Check Scriptable console for logs

### Adding New Websites
1. Add parser configuration to `scraper-config.json`
2. Add website-specific parsing logic to `event-processor.js`
3. Test with mock data first
4. Verify with real website data

## Next Steps

### Immediate
- [ ] Test with real website data to verify parsing accuracy
- [ ] Compare results with working legacy versions (v3, v5)
- [ ] Refine website-specific parsers based on testing

### Future Enhancements
- [ ] Add more sophisticated date parsing
- [ ] Implement caching for better performance
- [ ] Add calendar sync capabilities (when needed)
- [ ] Create parser plugins for easy website additions
- [ ] Add automated testing suite

## Questions & Considerations

### Version Compatibility
- **v5 works for SF:** Can migrate SF Eagle parsing logic
- **v3 works for Rockbar/Furball:** Can migrate those parsing strategies
- **Should we worry about version differences?** Probably not initially - focus on getting one clean approach working

### Testing Strategy
- Start with mock mode to verify architecture
- Test individual website parsers
- Compare results with known-good legacy versions
- Gradually increase confidence in real-world usage

### Calendar Integration
- Current architecture supports calendar sync
- Disabled by default for safety
- Can be enabled when ready for production use

This architecture provides a solid foundation for maintainable, testable bear event scraping that works across environments while keeping the successful parsing logic from your existing versions.
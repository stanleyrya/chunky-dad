# Bear Event Scraper Scripts

This directory contains Scriptable automation scripts for parsing bear community events and calendar management.

## 🏗️ ARCHITECTURE OVERVIEW

**CRITICAL: This codebase uses STRICT SEPARATION OF CONCERNS. Read this section before making ANY changes.**

### Directory Structure
```
scripts/
├── README.md                           # This file - READ BEFORE EDITING
├── scriptable-complete-api.md          # Scriptable API reference
├── scraper-input.js                    # Runtime configuration
├── bear-event-scraper-unified.js       # Lightweight orchestrator (environment detection only)
├── shared-core.js                      # Pure JavaScript business logic (NO environment code)
├── adapters/                           # Environment-specific implementations
│   ├── scriptable-adapter.js           # iOS/Scriptable ONLY code
│   └── web-adapter.js                  # Browser/Web ONLY code
└── parsers/                            # Pure parsing logic (NO environment code)
    ├── ai-web-parser.js                # AI-based parsing and URL discovery
    ├── bearracuda-parser.js            # Bearracuda venue parsing
    ├── chunk-parser.js                 # Chunk venue parsing
    ├── linktree-parser.js              # Linktree ticket-link parsing
    ├── redeyetickets-parser.js         # Red Eye Tickets API parsing
    └── scriptable-url-parser.js        # Scriptable URL-input parsing
```

## 🚨 CRITICAL RULES - AI ASSISTANTS MUST FOLLOW

### ❌ NEVER DO THESE:
1. **NO environment detection in shared files** - No `typeof importModule`, `typeof window`, `typeof DOMParser` checks in `shared-core.js` or `parsers/`
2. **NO Scriptable APIs in shared files** - No `Request`, `Calendar`, `FileManager`, `Alert` in `shared-core.js` or `parsers/`
3. **NO DOM APIs in shared files** - No `DOMParser`, `document`, `window` in `shared-core.js` or `parsers/`
4. **NO HTTP requests in parsers** - Parsers receive HTML/JSON, they don't fetch it
5. **NO calendar operations in parsers** - Parsers return event objects, they don't save them
6. **NO multi-parameter console calls** - Scriptable console methods only accept ONE parameter

### ✅ ALWAYS DO THESE:
1. **Keep business logic pure** - `shared-core.js` and `parsers/` contain only pure JavaScript functions
2. **Use adapters for environment code** - All Scriptable/web-specific code goes in `adapters/`
3. **Pass dependencies as parameters** - Don't import environment-specific modules in shared code
4. **Read file headers** - Each file has a header explaining its purpose and restrictions

## 📁 FILE RESPONSIBILITIES

### `bear-event-scraper-unified.js` (Orchestrator)
- **Purpose**: Environment detection and module coordination
- **Size**: ~100 lines (lightweight)
- **Contains**: Environment detection, module loading, configuration passing
- **Cannot contain**: Business logic, parsing logic, HTTP requests, calendar operations

### `shared-core.js` (Pure Business Logic)
- **Purpose**: Core event processing, filtering, deduplication, utilities
- **Environment**: Pure JavaScript - works everywhere
- **Contains**: Event filtering, bear detection, date utilities, URL processing, city location detection using centralized cities config
- **Cannot contain**: HTTP requests, calendar operations, DOM manipulation, environment detection
- **Cities Config**: Requires cities configuration from scraper-input.js for location detection

### `adapters/scriptable-adapter.js` (iOS Only)
- **Purpose**: Scriptable-specific implementations
- **Contains**: `Request` class usage, `Calendar` operations, `FileManager`, `Alert`, `Notification`
- **Cannot contain**: Web APIs, DOM manipulation, `fetch()`, `DOMParser`

### `adapters/web-adapter.js` (Browser Only)
- **Purpose**: Web browser implementations  
- **Contains**: `fetch()` requests, DOM manipulation, `localStorage`, web UI
- **Cannot contain**: Scriptable APIs, iOS-specific code

### `parsers/*.js` (Pure Parsing Logic)
- **Purpose**: Venue-specific HTML/JSON parsing
- **Environment**: Pure JavaScript - works everywhere
- **Contains**: Regex patterns, JSON parsing, text extraction, date parsing
- **Cannot contain**: HTTP requests, environment detection, calendar operations, DOM APIs

## 🔄 DATA FLOW

```
Configuration → Orchestrator → Shared Core → Adapters & Parsers
                     ↓              ↓             ↓
               Environment    Business Logic   Implementation
               Detection      Processing       Details
```

1. **Orchestrator** detects environment and loads appropriate modules
2. **Shared Core** coordinates business logic using abstract interfaces
3. **Adapters** implement environment-specific operations (HTTP, calendar, display)
4. **Parsers** process raw HTML/JSON into standardized event objects

## 🛡️ AI-PROOFING GUIDELINES

### Before Editing ANY File:
1. **Read the file header** - Every file has usage restrictions
2. **Check the directory** - `shared-core.js` and `parsers/` have strict rules
3. **Verify dependencies** - Shared files cannot import environment-specific modules
4. **Test cross-platform** - Shared code must work in both Scriptable and web

### When Adding New Features:
1. **Business logic** → Add to `shared-core.js`
2. **New venue parsing** → Add to `parsers/[venue]-parser.js`
3. **Scriptable features** → Add to `adapters/scriptable-adapter.js`
4. **Web features** → Add to `adapters/web-adapter.js`

### Code Review Checklist:
- [ ] No environment detection in shared files
- [ ] No Scriptable APIs in shared files  
- [ ] No DOM APIs in shared files
- [ ] Parsers receive data, don't fetch it
- [ ] Adapters implement abstract interfaces
- [ ] Business logic is environment-agnostic
- [ ] All console calls use single parameter (Scriptable compatibility)

## 📋 CURRENT FUNCTIONALITY

### Supported Venues
- **AI Web** (including Eventbrite pages) - Uses `ai-web-parser.js`
- **Bearracuda** - Multi-city bear dance parties - Uses `bearracuda-parser.js`
- **CHUNK** - Uses `chunk-parser.js`
- **Linktree** - Uses `linktree-parser.js`
- **RedEyeTickets** - Uses `redeyetickets-parser.js`
- **Scriptable URL Input** - Uses `scriptable-url-parser.js`

### Features
- Multi-site parsing with venue-specific logic
- Smart bear event detection using keywords and allowlists
- Duplicate prevention and event merging
- City detection and calendar routing
- Unified recursive URL crawl (single fetch/parse flow for root + discovered pages)
- Performance tracking and detailed reporting
- Parser enable/disable functionality for selective processing

## 🔧 CONFIGURATION

### Merge Modes
Merge strategies can be configured at multiple levels:

1. **Per-field** (most specific): Each metadata field can have its own merge strategy
2. **Global**: Default fallback if not specified elsewhere

#### Available Merge Strategies:
- **`preserve`** (default): Keep existing value, only add if field doesn't exist
- **`upsert`**: Add if missing, keep existing if present
- **`clobber`**: Always replace with new value

The most specific merge strategy wins. Field-level merge strategies take precedence over global defaults.

### Main Configuration (`scraper-input.js`)

**Note**: Configuration is now in JavaScript format instead of JSON, allowing for better maintainability and comments. The file exports a configuration object that works in both Scriptable and web environments.

const scraperConfig = {
  config: {
    dryRun: true,           // When false, allows calendar modifications
    daysToLookAhead: null   // Limit future events (null = unlimited)
  },
  parsers: [
    {
      name: "Venue Name",
      enabled: true,         // Set to false to temporarily disable parser
      urls: ["https://venue.com/events"],
      alwaysBear: true,      // Skip bear keyword filtering
      urlDiscoveryDepth: 1,  // Recursive crawl depth for discovered URLs (0 = no discovery crawl)
      maxAdditionalUrls: 20, // Optional: per-page cap for discovered URLs (uses parser default if omitted)
      dryRun: false,         // Optional: override global dryRun setting for this parser
      allowlist: ["keyword1", "keyword2"],
      city: "nyc"
    }
  ],
  cities: {
    "nyc": {
      calendar: "chunky-dad-nyc",
      timezone: "America/New_York",
      patterns: ["new york", "nyc", "manhattan", "brooklyn", "queens", "bronx"]
    },
    "la": {
      calendar: "chunky-dad-la", 
      timezone: "America/Los_Angeles",
      patterns: ["los angeles", "hollywood", "west hollywood", "weho", "dtla", "downtown los angeles", "long beach", "santa monica"]
    },
    "chicago": {
      calendar: "chunky-dad-chicago",
      timezone: "America/Chicago",
      patterns: ["chicago", "chi"]
    }
    // ... additional cities
  }
};

// Export the configuration
scraperConfig;
```

### Metadata Fields
The `metadata` object in parser configuration requires explicit merge strategies for each field. All fields must use the object format with `merge` property.

#### Field Format:
```javascript
{
  fieldName: {
    value: "field value",    // Optional - can be omitted for preserve
    merge: "strategy"        // Required - defaults to "preserve" if omitted
  }
}
```

#### Merge Strategies:
- **`preserve`** (default): Do nothing - don't add, don't update
- **`upsert`**: Add if missing, keep existing if present  
- **`clobber`**: Always replace existing value with new value

Example:
```javascript
metadata: {
  title: {
    value: "MEGAWOOF",
    merge: "clobber"        // Always replace title
  },
  description: {
    merge: "preserve"       // Keep existing, no value needed
  },
  instagram: {
    value: "https://www.instagram.com/megawoof_america",
    merge: "clobber"        // Always update Instagram
  },
  shortName: {
    value: "MEGA-WOOF",
    merge: "upsert"         // Add if missing
  }
}
```

### Adding New Parsers
1. Create `parsers/[venue]-parser.js` with pure parsing logic
2. Add parser to orchestrator's parser registry
3. Update configuration with new parser name
4. Test in both Scriptable and web environments

## 🚀 INSTALLATION & USAGE

### For Scriptable (iOS)
1. Install [Scriptable](https://scriptable.app/) on iOS
2. Copy ALL scriptable files to Scriptable:
   - `bear-event-scraper-unified.js`
   - `display-saved-run.js`
   - `page-cache-maintenance.js`
   - `shared-core.js`
   - `adapters/scriptable-adapter.js`
   - `adapters/web-adapter.js` (needed for unified script)
   - `parsers/ai-web-parser.js`
   - `parsers/bearracuda-parser.js`
   - `parsers/chunk-parser.js`
   - `parsers/linktree-parser.js`
   - `parsers/redeyetickets-parser.js`
   - `parsers/scriptable-url-parser.js`
3. Copy `scraper-input.js` to **iCloud Drive/Scriptable/** folder
4. Run `bear-event-scraper-unified.js`, `display-saved-run.js`, or `page-cache-maintenance.js`
5. Set `dryRun: false` when ready for live calendar updates

### Scriptable URL Input (x-callback-url)
You can pass a single event via URL parameters (Scriptable input parser).

Examples (query params only):
```
scriptable:///run?scriptName=Bear%20Event%20Scraper&title=Bear%20Night&startDate=2026-02-05T20:00:00-05:00&endDate=2026-02-05T23:00:00-05:00&identifier=ABC123
```

Notes:
- Query params are the only supported input format (JSON payloads are not parsed).
- All provided params are treated as explicit and clobber existing fields.
- Send the full set of params every time; empty values clear fields.

Supported fields (aliases accepted): title/name/summary, startDate/start/date, endDate/end,
startTime/endTime (with date), description, bar/venue, location/address, city, timezone,
url, ticketUrl, gmaps, image, cover, shortName, instagram, facebook, website,
key/matchKey, identifier/id, recurrence, recurrenceId, sequence, lat/lng.

Optional control params: dryRun, daysToLookAhead, allowPastEvents, alwaysBear, keyTemplate.
If URL input is present, `scraper-input.js` is optional, but `scraper-cities.js` is still required.

**IMPORTANT**: All scriptable files are now in the ROOT directory for proper Scriptable compatibility. The `chunky-dad/` folder contains backup/development copies but Scriptable should use the root files.

### For Web Testing
1. Load all script files in HTML with proper script tags
2. Ensure `scraper-input.js` is accessible via HTTP
3. Use web adapter for browser-specific functionality

## 📖 DEVELOPMENT GUIDELINES

### Maintaining Clean Architecture
1. **Always use dependency injection** - Pass adapters to shared code
2. **Keep interfaces abstract** - Shared code calls adapter methods, not specific APIs
3. **Test both environments** - Verify shared code works in Scriptable and web
4. **Document environment restrictions** - Update file headers when adding features

### Performance Considerations
- **Minimize file count** - Fewer files = easier Scriptable deployment
- **Optimize for mobile** - Scriptable runs on iOS devices
- **Rate limiting** - Built into adapters to prevent API abuse
- **Error handling** - Graceful failure with detailed logging

## 🔍 DEBUGGING

### Scriptable Environment
- Check Scriptable app console for colored log output
- Verify `scraper-input.js` exists in iCloud Drive/Scriptable/
- Test calendar permissions and access
- **CRITICAL**: Scriptable console methods (log, warn, error) only accept ONE parameter
  - ❌ `console.log('message:', error)` - BREAKS in Scriptable
  - ✅ `console.log(`message: ${error}`)` - Works in Scriptable
  - ✅ `console.log(`data: ${JSON.stringify(obj)}`)` - Works for objects

### Web Environment  
- Open browser DevTools → Console
- Check network tab for HTTP request failures
- Verify CORS settings for cross-origin requests

---

**⚠️ REMEMBER: This architecture prevents environment-specific code from contaminating shared business logic. Maintain this separation to ensure the codebase remains maintainable and testable across both Scriptable and web environments.**
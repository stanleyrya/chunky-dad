# Bear Event Scraper Scripts

This directory contains Scriptable automation scripts for parsing bear community events and calendar management.

## 🏗️ ARCHITECTURE OVERVIEW

**CRITICAL: This codebase uses STRICT SEPARATION OF CONCERNS. Read this section before making ANY changes.**

### Directory Structure
```
scripts/
├── README.md                           # This file - READ BEFORE EDITING
├── scriptable-complete-api.md          # Scriptable API reference
├── scraper-input.json                  # Runtime configuration
├── bear-event-scraper-unified.js       # Lightweight orchestrator (environment detection only)
├── shared-core.js                      # Pure JavaScript business logic (NO environment code)
├── adapters/                           # Environment-specific implementations
│   ├── scriptable-adapter.js           # iOS/Scriptable ONLY code
│   └── web-adapter.js                  # Browser/Web ONLY code
└── parsers/                            # Pure parsing logic (NO environment code)
    ├── eventbrite-parser.js            # Eventbrite venue parsing
    ├── bearracuda-parser.js            # Bearracuda venue parsing
    └── generic-parser.js               # Generic/fallback parsing
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
- **Contains**: Event filtering, bear detection, date utilities, URL processing, city mapping and location detection
- **Cannot contain**: HTTP requests, calendar operations, DOM manipulation, environment detection

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
- **Eventbrite** (including Megawoof America) - Uses `eventbrite-parser.js`
- **Bearracuda** - Multi-city bear dance parties - Uses `bearracuda-parser.js`
- **Generic venues** - Fallback parsing - Uses `generic-parser.js`

### Features
- Multi-site parsing with venue-specific logic
- Smart bear event detection using keywords and allowlists
- Duplicate prevention and event merging
- City detection and calendar routing
- Scalable URL processing with detail page support
- Performance tracking and detailed reporting

## 🔧 CONFIGURATION

### Merge Modes
- **`upsert`** (default): Intelligently merges new data with existing events
  - Adds missing metadata fields without overwriting existing ones
  - Preserves existing data while adding new information
  - Updates coordinates only if new ones are available
- **`clobber`**: Completely replaces existing events with new data
  - Overwrites all fields with new data
  - Useful for fixing corrupted data or forcing updates

### Main Configuration (`scraper-input.json`)
```json
{
  "config": {
    "dryRun": true,           // When false, allows calendar modifications
    "daysToLookAhead": null   // Limit future events (null = unlimited)
  },
  "parsers": [
    {
      "name": "Venue Name",
      "parser": "eventbrite",  // Must match parser filename
      "urls": ["https://venue.com/events"],
      "alwaysBear": true,      // Skip bear keyword filtering
      "requireDetailPages": true,
      "maxAdditionalUrls": 20,
      "allowlist": ["keyword1", "keyword2"],
      "city": "nyc",
      "mergeMode": "upsert"   // Per-parser merge mode: "upsert" or "clobber"
    }
  ],
  "calendarMappings": {
    "nyc": "chunky-dad-nyc",
    "la": "chunky-dad-la",
    "palm-springs": "chunky-dad-palm-springs",
    "seattle": "chunky-dad-seattle",
    "chicago": "chunky-dad-chicago",
    "toronto": "chunky-dad-toronto",
    "london": "chunky-dad-london",
    "berlin": "chunky-dad-berlin",
    "default": "chunky-dad-events"
  }
}
```

### Metadata Fields
The `metadata` object in parser configuration supports any custom fields. All fields are passed through to the event and added to the event notes.

Example:
```json
"metadata": {
  "title": "MEGAWOOF",
  "instagram": "https://www.instagram.com/megawoof_america",
  "shortTitle": "MEGA-WOOF",
  "customField": "Any value you want"
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
2. Copy ALL files to Scriptable (7 files total):
   - `bear-event-scraper-unified.js`
   - `shared-core.js`
   - `adapters/scriptable-adapter.js`
   - `adapters/web-adapter.js` (needed for unified script)
   - `parsers/eventbrite-parser.js`
   - `parsers/bearracuda-parser.js`
   - `parsers/generic-parser.js`
3. Copy `scraper-input.json` to **iCloud Drive/Scriptable/** folder
4. Run `bear-event-scraper-unified.js`
5. Set `dryRun: false` when ready for live calendar updates

### For Web Testing
1. Load all script files in HTML with proper script tags
2. Ensure `scraper-input.json` is accessible via HTTP
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
- Verify `scraper-input.json` exists in iCloud Drive/Scriptable/
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
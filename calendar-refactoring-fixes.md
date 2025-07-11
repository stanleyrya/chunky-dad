# Calendar Refactoring Issues and Fixes

## Problem Summary
After refactoring scripts into separate modules, the calendar events were no longer showing up in the week or calendar views, and the date navigation was not displaying properly. Events were still visible in logs and maps, indicating the data was being loaded but not properly displayed in the calendar UI.

## Root Causes Identified

### 1. Module Initialization Timing Issues
- **Problem**: The `page-init.js` only waited for basic modules (`navigationManager`, `uiEffectsManager`, `formHandler`) before initializing, but didn't ensure calendar-specific modules were loaded first.
- **Impact**: Calendar manager was trying to initialize before all its dependencies were available.

### 2. Module Dependencies Not Properly Checked
- **Problem**: `CalendarManager` constructor immediately tried to instantiate all sub-modules without checking if the classes were available.
- **Impact**: JavaScript errors when calendar modules weren't loaded in the correct order.

### 3. Global Function Access Issues
- **Problem**: The `showOnMap` function was defined in `map-manager.js` but not exposed globally for inline onclick handlers in the calendar UI.
- **Impact**: Map integration from calendar events was broken.

### 4. Missing Global References
- **Problem**: Various modules expected global references to other modules that weren't being set properly.
- **Impact**: Inter-module communication was failing.

## Fixes Applied

### 1. Enhanced Module Loading Check
**File**: `js/page-init.js`
- Enhanced `waitForModules()` to check for all calendar-related modules on city pages
- Added verification for: `CalendarManager`, `CalendarUI`, `CalendarControls`, `CalendarDataLoader`, `CitySelector`, `EventParser`, and `getCityConfig` function

### 2. Improved Calendar Manager Initialization  
**File**: `js/calendar-manager.js`
- Added null checks before instantiating sub-modules
- Added module availability verification in `initialize()` method
- Set up global references for inter-module communication:
  - `window.calendarManager`
  - `window.calendarUI` 
  - `window.mapManager`
  - `window.eventParser`

### 3. Updated Page Initialization
**File**: `js/page-init.js`
- Changed city page setup to use the new `CalendarManager` directly instead of the legacy `DynamicCalendarLoader`
- Added proper error handling for calendar initialization

### 4. Fixed Global Function Export
**File**: `js/map-manager.js`
- Added `window.showOnMap = showOnMap` to export the function globally
- This enables the inline onclick handlers in calendar event cards to work properly

## Testing and Verification

### Debug Page Created
- **File**: `debug.html` - A comprehensive debug page to verify:
  - All modules are loading correctly
  - City configuration is available
  - Calendar initialization works
  - Console output for troubleshooting

### Expected Results After Fixes
1. ✅ Events should now appear in calendar week and month views
2. ✅ Date navigation should display current week/month properly
3. ✅ Calendar controls (prev/next, today button) should work
4. ✅ Map integration from calendar events should function
5. ✅ All calendar modules should load in correct order

## File Structure Verification
The refactored calendar system consists of:
- `calendar-manager.js` - Main coordinator
- `calendar-ui.js` - View rendering  
- `calendar-controls.js` - Navigation controls
- `calendar-data.js` - Data loading
- `event-parser.js` - Event processing
- `city-selector.js` - City management
- `map-manager.js` - Map integration

All modules are properly imported in `city.html` but the initialization timing and inter-module communication were the main issues resolved.

## Next Steps
1. Test the fixes by visiting `city.html?city=new-york` or `city.html?city=seattle`
2. Use `debug.html` to verify all modules load correctly
3. Check browser console for any remaining errors
4. Verify that events appear in both week and month calendar views
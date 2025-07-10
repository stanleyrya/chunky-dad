# Map Update Issue Fix Summary

## Problem
The map wasn't updating when switching between week and month views on the city pages. Users would see stale event markers that didn't reflect the current time period selection.

## Root Cause
In the `initializeMap()` function in `js/dynamic-calendar-loader.js`, a new Leaflet map instance was being created every time the view changed, but the previous map instance wasn't being properly cleaned up. This resulted in:

1. Multiple map instances stacked on top of each other
2. Event listeners and interactions getting mixed up  
3. The map appearing to "not update" because old markers were still visible underneath

## Solution
Added proper cleanup logic to the `initializeMap()` function:

```javascript
// Remove existing map if it exists
if (window.eventsMap) {
    window.eventsMap.remove();
    window.eventsMap = null;
}
```

This fix ensures that:
- Any existing map instance is properly removed using Leaflet's `remove()` method
- The global reference is cleared 
- A fresh map is created with only the current period's events

## Files Modified
- `js/dynamic-calendar-loader.js` - Added map cleanup logic in the `initializeMap()` function (around line 850)

## Testing
After this fix, switching between week and month views should now properly update the map to show only the events for the selected time period, with correct positioning and markers.
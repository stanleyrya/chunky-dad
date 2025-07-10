# City and Calendar Refactoring - Implementation Notes

## Overview
Successfully refactored the codebase to support multiple cities and calendars with dynamic URL parameters instead of separate HTML files for each city.

## Changes Made

### 1. New City Configuration System
- **File**: `js/city-config.js`
- **Purpose**: Centralized configuration for all cities, including calendar IDs and metadata
- **Cities Configured**:
  - New York: `a5c9d5609f72549a8c66be0bade4255f0cdd619fa35d009c7de2c1f38ac775e9@group.calendar.google.com`
  - Seattle: `c266bcaea1603ca1a9763edbfe51a34f57e9c46d92c246e737e4ae3608bce2da@group.calendar.google.com` ✨ NEW
  - Los Angeles: (calendar not yet configured)

### 2. Dynamic City Page
- **File**: `city.html`
- **Purpose**: Single template that works for all cities using URL parameters
- **URL Format**: `city.html?city=CITY_KEY`
- **Features**:
  - Dynamic content loading based on city parameter
  - City selector dropdown for easy switching
  - Error handling for invalid/unavailable cities
  - Loading states while fetching calendar data

### 3. Enhanced Calendar Loader
- **File**: `js/dynamic-calendar-loader.js`
- **Purpose**: Supports multiple cities and dynamic calendar loading
- **Features**:
  - URL parameter parsing for city selection
  - Dynamic calendar ID resolution from city config
  - Enhanced error handling and user feedback
  - Graceful handling of cities without calendars

### 4. Updated Main Site Navigation
- **File**: `index.html` (updated)
- **Changes**: 
  - NYC card now links to `city.html?city=new-york`
  - Added Seattle card linking to `city.html?city=seattle`
  - LA card updated to use new URL structure

### 5. Backward Compatibility
- **File**: `new-york.html` (updated)
- **Purpose**: Automatic redirect from old URL to new structure
- **Implementation**: JavaScript redirect with loading indicator

### 6. Enhanced Styling
- **File**: `styles.css` (updated)
- **Added**: CSS for city selector, error pages, loading states, and responsive behavior

## URL Structure

### New Dynamic URLs:
- New York: `city.html?city=new-york`
- Seattle: `city.html?city=seattle` 
- Los Angeles: `city.html?city=los-angeles`

### Backward Compatibility:
- Old `new-york.html` automatically redirects to `city.html?city=new-york`

## Adding New Cities

To add a new city:

1. **Add city configuration** in `js/city-config.js`:
```javascript
'new-city': {
    name: 'City Name',
    emoji: '🏙️',
    tagline: 'City tagline',
    calendarId: 'your-calendar-id@group.calendar.google.com', // or null if not ready
    coordinates: { lat: XX.XXXX, lng: -XX.XXXX },
    mapZoom: 12
}
```

2. **Add city card** to `index.html`:
```html
<div class="city-card" onclick="location.href='city.html?city=new-city'">
    <div class="city-image">🏙️</div>
    <div class="city-info">
        <h3>City Name</h3>
        <p>Description of the city</p>
        <div class="city-highlights">
            <span class="highlight">Feature 1</span>
            <span class="highlight">Feature 2</span>
            <span class="highlight">Status</span>
        </div>
    </div>
</div>
```

That's it! The system will automatically handle the new city.

## Current Status

✅ **Working Cities**:
- New York (calendar configured and working)
- Seattle (calendar configured and working) 

⏳ **Pending Cities**:
- Los Angeles (city config exists, calendar needs to be configured)

## Calendar Setup Requirements

For each city calendar, ensure:
1. Calendar is public and published
2. Calendar ID is correctly formatted: `xxxxx@group.calendar.google.com`
3. Events include location coordinates for map functionality
4. Event descriptions follow key:value format for enhanced parsing

## Testing

Test the new system by:
1. Visiting `city.html?city=new-york` - should load NYC events
2. Visiting `city.html?city=seattle` - should load Seattle events
3. Visiting `city.html?city=invalid` - should show error page
4. Visiting `new-york.html` - should redirect to new URL
5. Using city selector dropdown to switch between cities

## Benefits

✅ Single maintainable city template  
✅ Easy addition of new cities  
✅ Dynamic calendar loading  
✅ Backward compatibility  
✅ Enhanced error handling  
✅ Mobile-responsive design  
✅ SEO-friendly URLs
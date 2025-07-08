# Google Calendar & Map Integration Guide

## 🗓️ Overview
Your website now dynamically loads events from a Google Calendar and displays them on interactive maps using OpenStreetMap and Leaflet. This allows for easy collaborative editing via mobile devices and visual location mapping.

## 📅 Google Calendar Integration

### Calendar Details
- **Calendar ID**: `a5c9d5609f72549a8c66be0bade4255f0cdd619fa35d009c7de2c1f38ac775e9@group.calendar.google.com`
- **Public iCal URL**: Automatically generated from calendar ID
- **No API Keys Required**: Uses public iCal feed with CORS proxy

### How It Works
1. **Calendar Events**: Create events in Google Calendar with event details
2. **JSON in Description**: Include full event JSON object in the event description
3. **Automatic Sync**: Website fetches latest data from calendar every page load
4. **Fallback**: If calendar is unavailable, falls back to local `data/events.json`

### Event Format in Google Calendar

Your calendar system now supports **multiple formats** for event descriptions! You can use any of these formats in your Google Calendar event descriptions:

#### 1. JSON Format (Advanced)
```json
{
  "name": "Bear Happy Hour",
  "bar": "Rotating", 
  "day": "Thursday",
  "time": "5PM - 9PM",
  "cover": "N/A",
  "tea": "Popular happy hour that changes location every week in Manhattan.",
  "eventType": "weekly",
  "coordinates": {
    "lat": 40.7505,
    "lng": -73.9934
  },
  "links": [
    {
      "type": "instagram",
      "url": "https://www.instagram.com/bearhappyhournyc",
      "label": "📷 Instagram"
    }
  ]
}
```

#### 2. Key-Value Format (User-Friendly)
```
Name: Bear Happy Hour
Bar: Rotating
Day: Thursday
Time: 5PM - 9PM
Cover: N/A
Tea: Popular happy hour that changes location every week in Manhattan.
Type: weekly
Instagram: https://www.instagram.com/bearhappyhournyc
```

#### 3. Structured Text (Natural)
```
Bear Happy Hour at Rotating on Thursday from 5PM - 9PM
Cover: N/A
Popular happy hour that changes location every week in Manhattan.
```

📚 **For complete format documentation, see: [EVENT_FORMATS_GUIDE.md](EVENT_FORMATS_GUIDE.md)**

### Event Properties Explained

**Required Fields:**
- `name`: Event name
- `bar`: Venue name
- `day`: Day of week (Sunday, Monday, Tuesday, etc.)
- `time`: Time range (e.g., "5PM - 9PM")
- `cover`: Cover charge info

**Optional Fields:**
- `tea`: Gossip/additional info about the event
- `eventType`: "weekly" or "routine" (defaults to "weekly")
- `coordinates`: GPS coordinates for mapping
  - `lat`: Latitude (decimal degrees)
  - `lng`: Longitude (decimal degrees)
- `links`: Array of links with type, url, and label

**Link Types:**
- `website`: Official website
- `instagram`: Instagram page
- `facebook`: Facebook page
- `twitter`: Twitter page
- `tickets`: Ticket purchasing

## 🗺️ Map Integration

### Features
- **Interactive Map**: Powered by Leaflet and OpenStreetMap
- **Event Markers**: Shows all events with GPS coordinates
- **Clickable Markers**: Display event details in popups
- **Location Links**: Click 📍 links in events to zoom to location
- **Mobile Responsive**: Optimized for all screen sizes

### Adding GPS Coordinates

To add locations to the map:

1. **Find Coordinates**: Use Google Maps, click on location, coordinates appear
2. **Format**: Use decimal degrees (e.g., 40.7505, -73.9934)
3. **Add to JSON**: Include in event's `coordinates` object
4. **Update Calendar**: Paste updated JSON into event description

### Example Coordinate Sources
- **Google Maps**: Right-click → "What's here?"
- **GPS Apps**: Many smartphone apps show coordinates
- **Online Tools**: GPS coordinate finder websites

## 📱 Mobile Editing Workflow

### For Event Organizers:
1. **Open Google Calendar** on phone/computer
2. **Create New Event** or edit existing
3. **Set Basic Info**: Title, time, location (optional)
4. **Add JSON**: Paste/edit JSON in description field
5. **Save Event**: Changes appear on website automatically

### For Venue Updates:
1. **Find Event** in calendar
2. **Edit Description**: Update JSON with new info
3. **Common Updates**: Cover charges, times, special notes
4. **Save**: Website reflects changes on next page load

## 🔧 Technical Implementation

### Files Structure
```
/
├── js/
│   ├── calendar-loader.js    # Google Calendar integration
│   └── city-events.js        # Original JSON loader (fallback)
├── data/
│   └── events.json          # Fallback/backup data
├── templates/
│   └── city-template.html   # Updated template with map
└── CALENDAR_INTEGRATION_GUIDE.md
```

### CORS Proxy
- **Service**: api.allorigins.win
- **Purpose**: Bypass browser CORS restrictions
- **Fallback**: If proxy fails, uses local JSON file
- **No Cost**: Free service, no registration required

### Map Libraries
- **Leaflet**: Lightweight, mobile-friendly mapping library
- **OpenStreetMap**: Free, open-source map tiles
- **CDN Hosted**: No local files needed, always up-to-date

## 🚀 Benefits

### For Content Managers:
- ✅ **Mobile Editing**: Update events from anywhere
- ✅ **Collaborative**: Multiple people can edit calendar
- ✅ **Real-time**: Changes appear immediately
- ✅ **User-Friendly**: Familiar Google Calendar interface

### For Website Users:
- ✅ **Visual Maps**: See event locations at a glance
- ✅ **Interactive**: Click markers and location links
- ✅ **Always Current**: Data stays up-to-date automatically
- ✅ **Mobile Optimized**: Works great on phones

### For Developers:
- ✅ **No Backend**: Purely client-side solution
- ✅ **No API Keys**: Public calendar access
- ✅ **Fallback System**: Graceful degradation
- ✅ **Extensible**: Easy to add new cities/features

## 🛠️ Troubleshooting & Debugging

### Recent Fixes Applied
**1. Contact Form Error Fixed** (December 2024)
- **Issue**: `TypeError: null is not an object (evaluating 'contactForm.addEventListener')`
- **Cause**: `script.js` loaded on all pages but contact form only exists on homepage
- **Solution**: Added null check before adding event listener
- **Code**: Now checks `if (contactForm)` before accessing

**2. Enhanced Calendar Logging** (December 2024)
- **Added**: Comprehensive debug logging throughout calendar loader
- **Features**: 
  - Load status tracking
  - Event parsing details
  - Error categorization
  - User-friendly error messages
- **Access**: Open browser console to see `[CalendarLoader]` messages

**3. Multiple Format Support** (December 2024)
- **Added**: Support for JSON, key-value, and structured text formats
- **Features**: 
  - Robust JSON parsing with balanced brace detection
  - Key-value format for non-technical users
  - Natural language structured text parsing
  - Automatic fallback between formats
  - Enhanced validation and error reporting
- **Benefits**: Makes event creation accessible to all users

### Debug Mode
The calendar loader now includes detailed console logging:

```javascript
// Enable/disable in calendar-loader.js
this.debugMode = true; // Set to false to reduce console output
```

**Log Categories:**
- `[CalendarLoader]` - Info messages
- `[CalendarLoader ERROR]` - Error messages
- `🔍 Parsing description for: [Event Name]` - Format detection
- `✅ JSON/Key-value/Structured text parsing successful` - Success messages
- `⚠️ Validation failed - missing required fields` - Validation errors
- `❌ All parsing methods failed` - Complete parsing failures
- Track: Loading, parsing, rendering, map initialization

### Common Issues & Solutions

**1. Calendar Not Loading**
- **Check Console**: Look for `[CalendarLoader]` messages
- **CORS Issues**: If proxy fails, should fallback to local data
- **Network**: Verify internet connection
- **Privacy**: Ensure Google Calendar is public

**2. No Events Showing**
- **Format Issues**: Check event descriptions use supported formats (JSON, key-value, or structured text)
- **Required Fields**: Verify all required fields present (name, bar, day, time, cover)
- **Event Type**: Confirm `eventType` is "weekly" or "routine" (or omit for default "weekly")
- **Day Format**: Use full day names (e.g., "Thursday", not "Thu")
- **Parsing Logs**: Check console for specific parsing failure messages

**3. Map Issues**
- **Leaflet Loading**: Check if Leaflet CSS/JS loaded properly
- **Coordinates**: Verify lat/lng format (decimal degrees)
- **Container**: Ensure `#events-map` element exists
- **JavaScript**: Check browser console for map errors

**4. Contact Form Errors**
- **Fixed**: Now includes null checks for missing form elements
- **Safe**: Won't crash on pages without contact forms
- **Logging**: Console shows if contact form found or skipped

### Error Messages Explained

**Calendar Temporarily Unavailable**
- Shown when both Google Calendar and local fallback fail
- Includes user-friendly explanation and suggestions
- Automatically retries on page refresh

**Map Temporarily Unavailable**
- Shown when Leaflet fails to initialize
- Usually indicates script loading issues
- Check network connection and CDN availability

### Debugging Checklist

**When Calendar Shows No Events:**
1. Open browser console (F12)
2. Refresh page
3. Look for `[CalendarLoader]` messages
4. Check which data source loaded (Google vs local)
5. Verify event count in logs
6. Look for parsing method messages (JSON, key-value, structured text)
7. Check for validation errors (missing required fields)
8. Verify format-specific issues (JSON syntax, key-value structure, etc.)

**When Events Load But Don't Display:**
1. Check console for DOM element messages
2. Verify HTML structure matches expected selectors:
   - `.calendar-grid`
   - `.weekly-events .events-list`
   - `.routine-events .events-list`
3. Check CSS display properties

**When Map Doesn't Work:**
1. Verify Leaflet script loaded: `typeof L !== 'undefined'`
2. Check for coordinate data in events
3. Look for map initialization messages
4. Verify `#events-map` element exists

### Performance Notes
- **Cache**: Browser caches calendar data briefly
- **Proxy**: CORS proxy may have occasional delays
- **Fallback**: Local JSON loads faster than calendar
- **Mobile**: Touch interactions work on mobile devices

## 🔮 Future Enhancements

### Potential Additions:
- **Multiple Calendars**: Support different calendars for different cities
- **Event Categories**: Color-coding by event type
- **Search/Filter**: Filter events by day, venue, or type
- **Route Planning**: Directions between venues
- **Social Integration**: Share events on social media

### Calendar Features to Explore:
- **Recurring Events**: Leverage Google Calendar's recurrence
- **Event Images**: Upload photos to calendar events
- **Attendee Tracking**: Who's going functionality
- **Reminders**: Calendar notifications for events

### Recent Improvements (December 2024):
- ✅ **Fixed contact form errors** on city pages
- ✅ **Added comprehensive logging** for debugging
- ✅ **Enhanced error handling** with user-friendly messages
- ✅ **Improved robustness** with null checks and fallbacks

This integration makes your website dynamic, collaborative, and visually appealing while maintaining the simplicity of GitHub Pages hosting!
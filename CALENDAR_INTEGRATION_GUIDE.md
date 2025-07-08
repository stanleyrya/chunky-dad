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

When creating events in Google Calendar, include this JSON structure in the **Description** field:

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

## 🛠️ Troubleshooting

### Calendar Not Loading
1. **Check Calendar Privacy**: Ensure calendar is public
2. **Verify JSON**: Validate JSON syntax in event descriptions
3. **CORS Proxy**: If proxy fails, falls back to local JSON
4. **Browser Console**: Check for error messages

### Map Issues
1. **GPS Coordinates**: Verify lat/lng format (decimal degrees)
2. **Internet Connection**: Maps require internet access
3. **JavaScript Enabled**: Ensure JS is enabled in browser
4. **Mobile Viewport**: Check on different screen sizes

### Event Not Appearing
1. **JSON Format**: Ensure valid JSON in description
2. **Required Fields**: Check all required fields are present
3. **Event Type**: Verify eventType is "weekly" or "routine"
4. **Day Format**: Use full day names (e.g., "Thursday")

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

This integration makes your website dynamic, collaborative, and visually appealing while maintaining the simplicity of GitHub Pages hosting!
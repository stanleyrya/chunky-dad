# City Events Management Guide

## Overview
The website now uses a dynamic system for managing events across different cities. Events are stored in a JSON file and automatically loaded into city pages, making it easy to update events and create new city pages.

## Managing Events

### Events Data File
All events are stored in `data/events.json`. This file contains data for all cities and their events.

### Structure
```json
{
  "cities": {
    "city-key": {
      "name": "Display Name",
      "emoji": "🏙️",
      "tagline": "City tagline",
      "weeklyEvents": [...],
      "routineEvents": [...]
    }
  }
}
```

### Event Structure
Each event has the following properties:
- `name`: Event name
- `bar`: Venue name
- `day`: Day of the week (e.g., "Thursday", "Sunday")
- `time`: Time range (e.g., "5PM - 9PM")
- `cover`: Cover charge information
- `tea`: Optional gossip/description about the event
- `links`: Array of links with `type`, `url`, and `label`

### Adding/Editing Events for New York

1. Open `data/events.json`
2. Find the `"new-york"` section
3. Add events to either `weeklyEvents` or `routineEvents` arrays
4. Save the file

Example new event:
```json
{
  "name": "New Bear Night",
  "bar": "Example Bar",
  "day": "Friday",
  "time": "8PM - 2AM", 
  "cover": "$10",
  "tea": "Hot new event with great music",
  "links": [
    {
      "type": "website",
      "url": "https://example.com",
      "label": "🌐 Website"
    },
    {
      "type": "instagram",
      "url": "https://instagram.com/example",
      "label": "📷 Instagram"
    }
  ]
}
```

## Creating a New City Page

### Step 1: Copy the Template
1. Copy `templates/city-template.html` 
2. Rename it to `city-name.html` (use lowercase with hyphens, e.g., `san-francisco.html`)
3. Place it in the root directory

### Step 2: Add City Data to events.json
1. Open `data/events.json`
2. Add a new city section under `"cities"`
3. Use the same key as your HTML filename (without .html)

Example:
```json
"san-francisco": {
  "name": "San Francisco",
  "emoji": "🌉",
  "tagline": "Bear city by the bay",
  "weeklyEvents": [
    {
      "name": "Bear Happy Hour SF",
      "bar": "Lone Star Saloon", 
      "day": "Friday",
      "time": "6PM - 9PM",
      "cover": "N/A",
      "links": [
        {
          "type": "website",
          "url": "https://lonestarsf.com",
          "label": "🌐 Website"
        }
      ]
    }
  ],
  "routineEvents": []
}
```

### Step 3: Test Your New City Page
1. Open your new HTML file in a browser
2. Verify that the city name, emoji, and tagline load correctly
3. Check that events appear in the calendar and event sections

## Link Types
Supported link types with recommended labels:
- `website`: "🌐 Website"
- `instagram`: "📷 Instagram" 
- `facebook`: "📘 Facebook"
- `twitter`: "🐦 Twitter"
- `tickets`: "🎫 Tickets"

## Tips
- Use consistent day names: "Sunday", "Monday", "Tuesday", etc.
- Keep times in 12-hour format: "5PM - 9PM"
- The `tea` field is optional but adds personality to events
- City keys should match the HTML filename (without .html)
- Use descriptive cover charge information: "No cover till 9PM, $20 after"

## File Structure
```
/
├── data/
│   └── events.json          # All events data
├── js/
│   └── city-events.js       # Dynamic loading script
├── templates/
│   └── city-template.html   # Template for new cities
├── new-york.html           # Example city page
└── CITY_EVENTS_GUIDE.md    # This guide
```
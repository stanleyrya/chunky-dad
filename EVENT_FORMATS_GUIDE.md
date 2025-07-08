# Event Formats Guide

## 📋 Overview

Your calendar system now supports **multiple formats** for event descriptions, making it easier for everyone to contribute! You can use any of these formats in your Google Calendar event descriptions:

1. **JSON Format** (most powerful, for technical users)
2. **Key-Value Format** (user-friendly, easy to type)
3. **Structured Text** (most natural, for quick entries)

## 🔧 Enhanced Features

### ✅ What's New
- **Multiple format support** - Use JSON, key-value pairs, or structured text
- **Better error handling** - Detailed logging shows exactly what went wrong
- **Robust JSON parsing** - Handles complex nested structures properly
- **Fallback parsing** - If one format fails, automatically tries others
- **Validation** - Ensures all required fields are present

### 🐛 Fixed Issues
- **Improved JSON regex** - No longer gets confused by multiple braces
- **Better error messages** - Console shows exactly why parsing failed
- **Graceful fallbacks** - If JSON fails, tries simpler formats

## 🎯 Format Options

### 1. JSON Format (Advanced)
**Best for:** Technical users who want full control over all features

```json
{
  "name": "Beer Blast",
  "bar": "Eagle NYC",
  "day": "Sunday",
  "time": "5PM - 4AM",
  "cover": "No cover till 9PM, $20 cover at 9PM",
  "tea": "Amazing event with great energy!",
  "eventType": "weekly",
  "coordinates": {
    "lat": 40.7420,
    "lng": -73.9570
  },
  "links": [
    {
      "type": "website",
      "url": "https://eagle-ny.com",
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

### 2. Key-Value Format (User-Friendly)
**Best for:** Non-technical users who want structured data

```
Name: Beer Blast
Bar: Eagle NYC
Day: Sunday
Time: 5PM - 4AM
Cover: No cover till 9PM, $20 cover at 9PM
Tea: Amazing event with great energy!
Type: weekly
Website: https://eagle-ny.com
Instagram: https://instagram.com/example
```

**Alternative formats supported:**
```
Name = Beer Blast
Bar = Eagle NYC
Day = Sunday
...
```

```
Name - Beer Blast
Bar - Eagle NYC  
Day - Sunday
...
```

### 3. Structured Text (Natural)
**Best for:** Quick entries, natural language

```
Beer Blast at Eagle NYC on Sunday from 5PM - 4AM
Cover: No cover till 9PM, $20 cover at 9PM
Amazing event with great energy!
```

The system will automatically extract:
- Event name from the first line
- Day of week from anywhere in the text
- Time patterns (5PM - 4AM)
- Venue name after "at" or "@"
- Cover information after "cover", "cost", or "price"

## 🔑 Required Fields

All formats must include these fields:
- **name** - Event name
- **bar** - Venue name
- **day** - Day of week (Monday, Tuesday, etc.)
- **time** - Time range (e.g., "5PM - 9PM")
- **cover** - Cover charge information

## 📱 Field Mapping

The system automatically maps common variations:

| You Can Type | Maps To |
|-------------|---------|
| name, event, title | name |
| bar, venue, location | bar |
| day | day |
| time | time |
| cover, cost, price | cover |
| tea, info, description | tea |
| type | eventType |
| website | website link |
| instagram | instagram link |
| facebook | facebook link |

## 🎨 Usage Examples

### Example 1: JSON (Full Featured)
```json
{
  "name": "Bear Happy Hour",
  "bar": "Rotating Location",
  "day": "Thursday",
  "time": "5PM - 9PM",
  "cover": "Free",
  "tea": "Changes location weekly - check Instagram for updates",
  "eventType": "weekly",
  "coordinates": {
    "lat": 40.7505,
    "lng": -73.9934
  },
  "links": [
    {
      "type": "instagram",
      "url": "https://instagram.com/bearhappyhournyc",
      "label": "📷 Instagram"
    }
  ]
}
```

### Example 2: Key-Value (Simple)
```
Name: Bear Happy Hour
Bar: Rotating Location
Day: Thursday
Time: 5PM - 9PM
Cover: Free
Tea: Changes location weekly - check Instagram for updates
Instagram: https://instagram.com/bearhappyhournyc
```

### Example 3: Structured Text (Quick)
```
Bear Happy Hour at Rotating Location on Thursday from 5PM - 9PM
Cover: Free
Changes location weekly - check Instagram for updates
```

## 🚀 Migration Tips

### Converting Existing Events
1. **JSON users**: Your events will work exactly as before
2. **New users**: Start with key-value format - it's the easiest
3. **Quick entries**: Use structured text for fast event creation

### Best Practices
- **Always include required fields** - name, bar, day, time, cover
- **Use consistent day names** - "Sunday", "Monday", etc. (not "Sun", "Mon")
- **Include complete time ranges** - "5PM - 9PM" (not just "5PM")
- **Be specific about cover charges** - "Free", "$10", "No cover till 9PM"

## 🔍 Debugging & Troubleshooting

### Console Logging
The system provides detailed logging. Open your browser console (F12) to see:
- `🔍 Parsing description for: [Event Name]`
- `✅ JSON/Key-value/Structured text parsing successful`
- `⚠️ Validation failed - missing required fields`
- `❌ All parsing methods failed`

### Common Issues & Solutions

**Event not showing up:**
1. Check console for parsing errors
2. Verify all required fields are present
3. Check day name spelling (use full names)
4. Ensure time format includes AM/PM

**JSON parsing fails:**
- Check for balanced braces { }
- Validate JSON syntax using online tools
- Watch for special characters in strings

**Key-value parsing fails:**
- Use consistent format (Key: Value)
- Avoid special characters in keys
- One key-value pair per line

**Structured text parsing fails:**
- Include day of week in text
- Use clear time patterns with AM/PM
- Mention venue with "at" or "@"

### Testing Your Events
1. Add your event to Google Calendar
2. Open the website in a browser
3. Press F12 to open console
4. Refresh the page
5. Look for parsing messages with your event name

## 📊 Format Comparison

| Feature | JSON | Key-Value | Structured Text |
|---------|------|-----------|-----------------|
| Ease of use | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Full features | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| Coordinates | ✅ | ❌ | ❌ |
| Multiple links | ✅ | ✅ | ❌ |
| Custom fields | ✅ | ❌ | ❌ |
| Error prone | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

## 🎯 Recommendations

- **New users**: Start with **Key-Value format**
- **Quick updates**: Use **Structured Text format**
- **Full features**: Use **JSON format**
- **Mobile editing**: **Key-Value** works best on phone keyboards

## 🔮 Future Enhancements

Coming soon:
- **YAML format support**
- **Drag-and-drop event creation**
- **Template library**
- **Bulk import tools**

---

*This enhanced system makes event management accessible to everyone while maintaining the power and flexibility that technical users need!*
# Enhanced Sample Events

## 🎯 How to Create Events in Google Calendar

Here are examples of how to create events using the new enhanced system:

## Example 1: Bear Happy Hour

**Google Calendar Fields:**
- **Title**: Bear Happy Hour
- **Location**: Rotating Location
- **Start Time**: Thursday 5:00 PM
- **End Time**: Thursday 9:00 PM
- **Recurring**: Weekly (every Thursday)

**Description (Key/Value Pairs):**
```
Cover: N/A
Tea: Popular happy hour that changes location every week in Manhattan.
Instagram: https://www.instagram.com/bearhappyhournyc
```

---

## Example 2: Bears Are Animals

**Google Calendar Fields:**
- **Title**: Bears Are Animals
- **Location**: Animal NYC
- **Start Time**: Thursday 7:00 PM
- **End Time**: Thursday 10:00 PM
- **Recurring**: Weekly (every Thursday)

**Description (Key/Value Pairs):**
```
Cover: N/A
Website: https://animal.nyc
Instagram: https://www.instagram.com/animal.nyc
```

---

## Example 3: Beer Blast

**Google Calendar Fields:**
- **Title**: Beer Blast
- **Location**: Eagle NYC
- **Start Time**: Sunday 5:00 PM
- **End Time**: Monday 4:00 AM
- **Recurring**: Weekly (every Sunday)

**Description (Key/Value Pairs):**
```
Cover: No cover till 9PM, $20 cover at 9PM
Website: https://eagle-ny.com
```

---

## Example 4: Goldiloxx (Monthly Event)

**Google Calendar Fields:**
- **Title**: Goldiloxx
- **Location**: Red Eye NY
- **Start Time**: Saturday 9:00 PM
- **End Time**: Sunday 4:00 AM
- **Recurring**: Monthly (first Saturday of each month)

**Description (Key/Value Pairs):**
```
Cover: Varies, ~$25 tickets
Type: monthly
Instagram: https://www.instagram.com/goldiloxx__
```

---

## Example 5: Special Event with Multiple Social Links

**Google Calendar Fields:**
- **Title**: Pride Bear Party
- **Location**: 554 W 28th St, New York, NY
- **Start Time**: Saturday 8:00 PM
- **End Time**: Sunday 2:00 AM
- **Recurring**: None (one-time event)

**Description (Key/Value Pairs):**
```
Cover: $15 advance, $20 door
Tea: Special Pride celebration with DJs and drink specials
Instagram: https://www.instagram.com/example
Facebook: https://www.facebook.com/example
Website: https://example.com
Type: routine
```

---

## Key Benefits of the New System

### ✅ Before (Complex JSON)
```json
{
  "name": "Bear Happy Hour",
  "bar": "Rotating Location",
  "day": "Thursday",
  "time": "5PM - 9PM",
  "cover": "N/A",
  "tea": "Popular happy hour that changes location every week in Manhattan.",
  "eventType": "weekly",
  "links": [
    {
      "type": "instagram",
      "url": "https://www.instagram.com/bearhappyhournyc",
      "label": "📷 Instagram"
    }
  ]
}
```

### ✅ After (Simple Key/Value)
- **Title**: Bear Happy Hour
- **Location**: Rotating Location
- **Time**: Thursday 5:00 PM - 9:00 PM
- **Recurring**: Weekly
- **Description**: 
  ```
  Cover: N/A
  Tea: Popular happy hour that changes location every week in Manhattan.
  Instagram: https://www.instagram.com/bearhappyhournyc
  ```

---

## Migration Tips

### For Event Organizers:

1. **Use Google Calendar's Native Fields**: 
   - Put event name in the title
   - Use the location field for venue
   - Set proper start/end times
   - Use Google Calendar's recurrence feature

2. **Simplify Descriptions**:
   - Replace JSON with simple key/value pairs
   - Use format: `Key: Value` (one per line)
   - No need for complex formatting

3. **Location Handling**:
   - Use recognizable venue names like "Eagle NYC"
   - System will automatically geocode locations
   - Full addresses work too: "554 W 28th St, New York, NY"

### For Users:

1. **Interactive Calendar**: Click events in the calendar to scroll to full details
2. **Enhanced Map**: Locations are automatically placed on the map
3. **Mobile Friendly**: Everything works great on phones
4. **Better Navigation**: Improved URL routing and page structure

---

## Supported Key Formats

All these formats work the same way:

```
Cover: $15
Cover = $15
Cover - $15
```

```
Tea: This is a great event
Tea = This is a great event
Tea - This is a great event
```

---

## Complete Event Creation Checklist

### In Google Calendar:
- [ ] **Title**: Clear, descriptive event name
- [ ] **Location**: Venue name or address
- [ ] **Start Time**: When event begins
- [ ] **End Time**: When event ends (optional)
- [ ] **Recurring**: Set up recurrence if needed
- [ ] **Description**: Add key/value pairs for extra details

### Common Keys to Use:
- [ ] **Cover**: Cover charge information
- [ ] **Tea**: Event description or gossip
- [ ] **Instagram**: Instagram URL
- [ ] **Website**: Website URL
- [ ] **Facebook**: Facebook URL
- [ ] **Type**: Event type (weekly, monthly, routine)

---

*This enhanced system makes event management much easier while providing a better experience for everyone!*
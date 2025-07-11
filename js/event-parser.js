// Event Parser Module - Handles parsing raw calendar events into structured event objects
class EventParser {
    constructor() {
        this.debugMode = true;
    }

    log(message, data = null) {
        if (this.debugMode) {
            console.log(`[EventParser] ${message}`, data || '');
        }
    }

    error(message, data = null) {
        console.error(`[EventParser ERROR] ${message}`, data || '');
    }

    // Parse raw calendar events into structured event objects
    parseEvents(rawEvents, cityKey) {
        return rawEvents.map(event => this.parseEventData(event, cityKey))
                       .filter(event => event !== null);
    }

    // Parse individual event data
    parseEventData(calendarEvent, cityKey) {
        try {
            const eventData = {
                name: calendarEvent.title,
                day: this.getDayFromDate(calendarEvent.start),
                time: this.getTimeRange(calendarEvent.start, calendarEvent.end),
                cover: 'Check event details',
                eventType: this.getEventType(calendarEvent.recurrence),
                recurring: !!calendarEvent.recurrence,
                recurrence: calendarEvent.recurrence, // Store the RRULE string
                coordinates: calendarEvent.location,
                startDate: calendarEvent.start, // Store actual date
                endDate: calendarEvent.end
            };

            // Parse description for additional data
            if (calendarEvent.description) {
                const additionalData = this.parseKeyValueDescription(calendarEvent.description);
                if (additionalData) {
                    eventData.bar = additionalData.bar || 'TBD';
                    eventData.cover = additionalData.cover || eventData.cover;
                    eventData.tea = additionalData.tea || additionalData.description;
                    eventData.website = additionalData.website;
                    eventData.instagram = additionalData.instagram;
                    eventData.facebook = additionalData.facebook;
                    eventData.gmaps = additionalData.gmaps;
                    eventData.links = this.parseLinks(additionalData);
                    
                    if (additionalData.type || additionalData.eventType) {
                        eventData.eventType = additionalData.type || additionalData.eventType;
                    }
                }
            }
            
            // Parse coordinates
            if (calendarEvent.location) {
                const latlong = calendarEvent.location.split(",");
                eventData.coordinates = { 
                    lat: parseFloat(latlong[0]?.trim()), 
                    lng: parseFloat(latlong[1]?.trim()) 
                };
            }

            eventData.slug = this.generateSlug(eventData.name);
            eventData.citySlug = cityKey;

            this.log(`✅ Successfully parsed event: ${eventData.name}`);
            return eventData;
        } catch (error) {
            this.error(`Failed to parse event data:`, error.message);
            return null;
        }
    }

    // Parse key-value pairs from description
    parseKeyValueDescription(description) {
        const data = {};
        const keyMap = {
            'bar': 'bar', 'location': 'bar', 'host': 'bar',
            'cover': 'cover', 'cost': 'cover', 'price': 'cover',
            'tea': 'tea', 'info': 'tea', 'description': 'tea',
            'website': 'website', 'instagram': 'instagram', 'facebook': 'facebook',
            'type': 'type', 'eventtype': 'type', 'recurring': 'recurring',
            'gmaps': 'gmaps', 'google maps': 'gmaps'
        };

        let textBlock = description;
        if (textBlock.includes("<br>")) {
            textBlock = textBlock.replace(/<br\s?\/?>/gi, "\n");
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = textBlock;
            textBlock = tempDiv.textContent || tempDiv.innerText || '';
        }
        
        const lines = textBlock.replace("\\n", "\n").split("\n");
        
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            
            const keyValueMatch = line.match(/([^:=\-]+)[:=\-]\s*(.+)/);
            if (keyValueMatch) {
                const key = keyValueMatch[1].trim().toLowerCase();
                const value = keyValueMatch[2].trim();
                const mappedKey = keyMap[key] || key;
                data[mappedKey] = value;
            }
        }
        
        return Object.keys(data).length > 0 ? data : null;
    }

    // Parse links from event data
    parseLinks(data) {
        const links = [];
        
        if (data.website) {
            links.push({ type: 'website', url: data.website, label: '🌐 Website' });
        }
        if (data.instagram) {
            links.push({ type: 'instagram', url: data.instagram, label: '📷 Instagram' });
        }
        if (data.facebook) {
            links.push({ type: 'facebook', url: data.facebook, label: '📘 Facebook' });
        }
        if (data.gmaps) {
            links.push({ type: 'gmaps', url: data.gmaps, label: '🗺️ Google Maps' });
        }
        
        return links.length > 0 ? links : null;
    }

    // Generate URL-friendly slug from event name
    generateSlug(name) {
        return name.toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
    }

    // Get day name from date
    getDayFromDate(date) {
        if (!date) return 'TBD';
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[date.getDay()];
    }

    // Get time range string
    getTimeRange(startDate, endDate) {
        if (!startDate) return 'TBD';
        
        const formatTime = (date) => {
            const hours = date.getHours();
            const minutes = date.getMinutes();
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours % 12 || 12;
            const displayMinutes = minutes > 0 ? `:${minutes.toString().padStart(2, '0')}` : '';
            return `${displayHours}${displayMinutes}${ampm}`;
        };
        
        const startTime = formatTime(startDate);
        
        if (endDate) {
            const endTime = formatTime(endDate);
            return `${startTime} - ${endTime}`;
        }
        
        return startTime;
    }

    // Get event type from recurrence rule
    getEventType(recurrence) {
        if (!recurrence) return 'routine';
        if (recurrence.includes('WEEKLY')) return 'weekly';
        if (recurrence.includes('MONTHLY')) return 'monthly';
        if (recurrence.includes('DAILY')) return 'daily';
        return 'recurring';
    }

    // Check if a recurring event occurs on a specific date
    isEventOccurringOnDate(event, date) {
        if (!event.recurring || !event.startDate) return false;
        
        const eventDate = new Date(event.startDate);
        const checkDate = new Date(date);
        
        // Normalize dates to compare only date parts, not time
        eventDate.setHours(0, 0, 0, 0);
        checkDate.setHours(0, 0, 0, 0);
        
        // Make sure we're not checking before the event started
        if (checkDate < eventDate) return false;
        
        // Parse the recurrence rule to determine the pattern
        const recurrence = event.recurrence || '';
        
        if (recurrence.includes('FREQ=WEEKLY')) {
            // Weekly events: occur on the same day of the week
            return eventDate.getDay() === checkDate.getDay();
        } else if (recurrence.includes('FREQ=MONTHLY')) {
            // Monthly events: check for BYMONTHDAY pattern
            if (recurrence.includes('BYMONTHDAY=')) {
                const dayMatch = recurrence.match(/BYMONTHDAY=(\d+)/);
                if (dayMatch) {
                    const targetDay = parseInt(dayMatch[1]);
                    // Check if this month has that many days
                    const lastDayOfMonth = new Date(checkDate.getFullYear(), checkDate.getMonth() + 1, 0).getDate();
                    return checkDate.getDate() === Math.min(targetDay, lastDayOfMonth);
                }
            }
            // Fallback: same day of month as original event, but handle month lengths
            const originalDay = eventDate.getDate();
            const lastDayOfMonth = new Date(checkDate.getFullYear(), checkDate.getMonth() + 1, 0).getDate();
            const targetDay = Math.min(originalDay, lastDayOfMonth);
            return checkDate.getDate() === targetDay;
        } else if (recurrence.includes('FREQ=DAILY')) {
            // Daily events: occur every day
            return true;
        } else if (recurrence.includes('FREQ=YEARLY')) {
            // Yearly events: same month and day
            return eventDate.getMonth() === checkDate.getMonth() && 
                   eventDate.getDate() === checkDate.getDate();
        }
        
        // Default fallback for other recurring patterns - use day of week
        return eventDate.getDay() === checkDate.getDay();
    }

    // Filter events by date range
    filterEventsByDateRange(events, startDate, endDate) {
        return events.filter(event => {
            if (!event.startDate) return false;
            
            // For recurring events, check if they occur in this period
            if (event.recurring) {
                return this.isRecurringEventInPeriod(event, startDate, endDate);
            }
            
            // For one-time events, check if they fall within the period
            return this.isEventInPeriod(event.startDate, startDate, endDate);
        });
    }

    isRecurringEventInPeriod(event, start, end) {
        if (!event.startDate) return false;
        
        const current = new Date(start);
        
        // Check each day in the period
        while (current <= end) {
            if (this.isEventOccurringOnDate(event, current)) {
                return true;
            }
            current.setDate(current.getDate() + 1);
        }
        
        return false;
    }

    isEventInPeriod(eventDate, start, end) {
        return eventDate >= start && eventDate <= end;
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.EventParser = EventParser;
}
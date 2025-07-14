// Event Data Manager - Handles event data parsing, filtering, and management
class EventDataManager {
    constructor() {
        this.eventsData = null;
        this.allEvents = [];
        this.locationCache = new Map();
        logger.componentInit('EVENT', 'Event Data Manager initialized');
    }

    // Parse iCal data and extract events
    parseICalData(icalText) {
        logger.time('EVENT', 'iCal parsing');
        logger.info('EVENT', 'Starting iCal parsing', {
            textLength: icalText.length
        });
        
        // Log the beginning of the calendar file for debugging
        const filePreview = icalText.substring(0, 500);
        logger.debug('EVENT', 'Calendar file preview (first 500 chars):', {
            preview: filePreview,
            totalLength: icalText.length
        });
        
        // Log calendar metadata
        const calendarNameMatch = icalText.match(/X-WR-CALNAME:(.+)/);
        const calendarTimezoneMatch = icalText.match(/X-WR-TIMEZONE:(.+)/);
        const versionMatch = icalText.match(/VERSION:(.+)/);
        
        if (calendarNameMatch || calendarTimezoneMatch || versionMatch) {
            logger.info('EVENT', 'Calendar metadata found', {
                calendarName: calendarNameMatch ? calendarNameMatch[1].trim() : 'Not specified',
                timezone: calendarTimezoneMatch ? calendarTimezoneMatch[1].trim() : 'Not specified',
                version: versionMatch ? versionMatch[1].trim() : 'Not specified'
            });
        }
        
        const events = [];
        const lines = icalText.split('\n');
        let currentEvent = null;
        let inEvent = false;
        let eventCount = 0;
        let invalidLines = [];
        
        logger.debug('EVENT', `Processing ${lines.length} lines from calendar file`);
        
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            
            // Handle line continuation (RFC 5545 - lines starting with space or tab)
            while (i + 1 < lines.length && (lines[i + 1].startsWith(' ') || lines[i + 1].startsWith('\t'))) {
                i++;
                // Remove leading space/tab and trailing \r from continuation line
                const continuationLine = lines[i].substring(1).replace(/\r$/, '');
                line += continuationLine;
            }
            
            // Remove trailing \r if present
            line = line.replace(/\r$/, '');
            
            if (line === 'BEGIN:VEVENT') {
                inEvent = true;
                currentEvent = {};
                eventCount++;
                logger.debug('EVENT', `Starting to parse event #${eventCount}`);
            } else if (line === 'END:VEVENT' && currentEvent) {
                if (currentEvent.title) {
                    logger.debug('EVENT', `Processing event: ${currentEvent.title}`, {
                        eventNumber: eventCount,
                        hasDescription: !!currentEvent.description,
                        hasLocation: !!currentEvent.location,
                        hasStart: !!currentEvent.start,
                        hasEnd: !!currentEvent.end,
                        hasRecurrence: !!currentEvent.recurrence
                    });
                    
                    const eventData = this.parseEventData(currentEvent);
                    
                    if (eventData) {
                        events.push(eventData);
                        logger.debug('EVENT', `✅ Successfully parsed event: ${eventData.name}`, {
                            eventType: eventData.eventType,
                            day: eventData.day,
                            time: eventData.time,
                            venue: eventData.bar,
                            recurring: eventData.recurring
                        });
                    } else {
                        logger.warn('EVENT', `❌ Failed to parse event: ${currentEvent.title}`, {
                            eventNumber: eventCount,
                            rawEvent: currentEvent
                        });
                    }
                } else {
                    logger.warn('EVENT', `❌ Event #${eventCount} has no title, skipping`, {
                        rawEvent: currentEvent
                    });
                }
                currentEvent = null;
                inEvent = false;
            } else if (inEvent && currentEvent) {
                const parsed = this.parseEventLine(line, currentEvent);
                if (!parsed && line.trim() !== '') {
                    invalidLines.push({ line, eventNumber: eventCount });
                }
            }
        }
        
        // Log any lines that couldn't be parsed
        if (invalidLines.length > 0) {
            logger.warn('EVENT', `Found ${invalidLines.length} unparseable lines`, {
                sampleInvalidLines: invalidLines.slice(0, 5), // Show first 5 invalid lines
                totalInvalidLines: invalidLines.length
            });
        }
        
        logger.timeEnd('EVENT', 'iCal parsing');
        logger.info('EVENT', `📊 Parsing complete. Found ${eventCount} total events, ${events.length} with valid data`, {
            successRate: `${Math.round((events.length / eventCount) * 100)}%`,
            invalidLinesCount: invalidLines.length,
            averageEventDataPoints: events.length > 0 ? Math.round(events.reduce((acc, event) => {
                let points = 0;
                if (event.name) points++;
                if (event.time) points++;
                if (event.bar) points++;
                if (event.cover) points++;
                if (event.tea) points++;
                if (event.coordinates) points++;
                if (event.links) points++;
                return acc + points;
            }, 0) / events.length) : 0
        });
        
        return events;
    }

    parseEventLine(line, currentEvent) {
        let parsed = true;
        
        if (line.startsWith('SUMMARY:')) {
            currentEvent.title = line.substring(8).replace(/\\,/g, ',').replace(/\\;/g, ';');
        } else if (line.startsWith('DESCRIPTION:')) {
            currentEvent.description = line.substring(12).replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
        } else if (line.startsWith('LOCATION:')) {
            currentEvent.location = line.substring(9).replace(/\\,/g, ',').replace(/\\;/g, ';');
        } else if (line.startsWith('DTSTART')) {
            const dateMatch = line.match(/DTSTART[^:]*:(.+)/);
            if (dateMatch) {
                currentEvent.start = this.parseICalDate(dateMatch[1]);
            }
        } else if (line.startsWith('DTEND')) {
            const dateMatch = line.match(/DTEND[^:]*:(.+)/);
            if (dateMatch) {
                currentEvent.end = this.parseICalDate(dateMatch[1]);
            }
        } else if (line.startsWith('RRULE:')) {
            currentEvent.recurrence = line.substring(6);
        } else if (line.startsWith('UID:') || line.startsWith('DTSTAMP:') || line.startsWith('CREATED:') || 
                   line.startsWith('LAST-MODIFIED:') || line.startsWith('SEQUENCE:') || line.startsWith('STATUS:') || 
                   line.startsWith('TRANSP:') || line.startsWith('ORGANIZER:') || line.startsWith('ATTENDEE:') ||
                   line.startsWith('CLASS:') || line.startsWith('PRIORITY:') || line.startsWith('CATEGORIES:') ||
                   line.startsWith('COMMENT:') || line.startsWith('CONTACT:') || line.startsWith('REQUEST-STATUS:') ||
                   line.startsWith('RELATED-TO:') || line.startsWith('RESOURCES:') || line.startsWith('RDATE:') ||
                   line.startsWith('EXDATE:') || line.startsWith('EXRULE:') || line.startsWith('ATTACH:') ||
                   line.startsWith('ALARM:') || line.startsWith('VALARM:') || line.startsWith('FREEBUSY:') ||
                   line.startsWith('DURATION:') || line.startsWith('TZID:') || line.startsWith('TZOFFSETFROM:') ||
                   line.startsWith('TZOFFSETTO:') || line.startsWith('TZNAME:') || line.startsWith('DTSTART:') ||
                   line.startsWith('FREQ:') || line.startsWith('UNTIL:') || line.startsWith('COUNT:') ||
                   line.startsWith('INTERVAL:') || line.startsWith('BYSECOND:') || line.startsWith('BYMINUTE:') ||
                   line.startsWith('BYHOUR:') || line.startsWith('BYDAY:') || line.startsWith('BYMONTHDAY:') ||
                   line.startsWith('BYYEARDAY:') || line.startsWith('BYWEEKNO:') || line.startsWith('BYMONTH:') ||
                   line.startsWith('BYSETPOS:') || line.startsWith('WKST:') || line.trim() === '') {
            // These are known iCalendar properties that we don't need to parse but are valid
            parsed = true;
        } else {
            parsed = false;
        }
        
        return parsed;
    }

    // Parse individual event data
    parseEventData(calendarEvent) {
        try {
            const eventData = {
                name: calendarEvent.title,
                day: this.getDayFromDate(calendarEvent.start),
                time: this.getTimeRange(calendarEvent.start, calendarEvent.end),
                cover: 'Check event details',
                eventType: this.getEventType(calendarEvent.recurrence),
                recurring: !!calendarEvent.recurrence,
                recurrence: calendarEvent.recurrence,
                coordinates: calendarEvent.location,
                startDate: calendarEvent.start,
                endDate: calendarEvent.end,
                unprocessedDescription: calendarEvent.description || null // Store raw description for debugging
            };

            // Parse description for additional data
            if (calendarEvent.description) {
                logger.debug('EVENT', 'Processing event description', {
                    eventName: eventData.name,
                    descriptionLength: calendarEvent.description.length,
                    descriptionPreview: calendarEvent.description.substring(0, 100) + '...'
                });
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

            return eventData;
        } catch (error) {
            logger.componentError('EVENT', 'Failed to parse event data', error);
            return null;
        }
    }

    // Parse description for key-value pairs
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

        const lines = description.split('\n');
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            // Check for key-value format (key: value)
            const colonIndex = trimmedLine.indexOf(':');
            if (colonIndex > 0) {
                const key = trimmedLine.substring(0, colonIndex).trim().toLowerCase();
                const value = trimmedLine.substring(colonIndex + 1).trim();
                
                if (keyMap[key] && value) {
                    data[keyMap[key]] = value;
                }
            }
        }

        return Object.keys(data).length > 0 ? data : null;
    }

    parseLinks(data) {
        const links = {};
        if (data.website) links.website = data.website;
        if (data.instagram) links.instagram = data.instagram;
        if (data.facebook) links.facebook = data.facebook;
        if (data.gmaps) links.gmaps = data.gmaps;
        return Object.keys(links).length > 0 ? links : null;
    }

    generateSlug(name) {
        return name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    getDayFromDate(date) {
        return date.toLocaleDateString('en-US', { weekday: 'long' });
    }

    getTimeRange(startDate, endDate) {
        const formatTime = (date) => {
            return date.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit',
                hour12: true 
            });
        };
        
        const startTime = formatTime(startDate);
        const endTime = formatTime(endDate);
        
        return startTime === endTime ? startTime : `${startTime} - ${endTime}`;
    }

    getEventType(recurrence) {
        return recurrence ? 'Recurring' : 'One-off';
    }

    parseICalDate(icalDate) {
        // Handle different iCal date formats
        if (icalDate.includes('T')) {
            // Date-time format: 20231201T190000Z or 20231201T190000
            const dateStr = icalDate.replace(/[TZ]/g, '');
            const year = parseInt(dateStr.substring(0, 4));
            const month = parseInt(dateStr.substring(4, 6)) - 1; // Month is 0-indexed
            const day = parseInt(dateStr.substring(6, 8));
            const hour = parseInt(dateStr.substring(9, 11));
            const minute = parseInt(dateStr.substring(11, 13));
            const second = parseInt(dateStr.substring(13, 15));
            
            return new Date(year, month, day, hour, minute, second);
        } else {
            // Date-only format: 20231201
            const year = parseInt(icalDate.substring(0, 4));
            const month = parseInt(icalDate.substring(4, 6)) - 1;
            const day = parseInt(icalDate.substring(6, 8));
            
            return new Date(year, month, day);
        }
    }

    getWeekBounds(date) {
        const start = new Date(date);
        start.setDate(start.getDate() - start.getDay());
        start.setHours(0, 0, 0, 0);
        
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        
        return { start, end };
    }

    getMonthBounds(date) {
        const start = new Date(date.getFullYear(), date.getMonth(), 1);
        const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
        
        return { start, end };
    }

    isEventInPeriod(eventDate, start, end) {
        return eventDate >= start && eventDate <= end;
    }

    isRecurringEventInPeriod(event, start, end) {
        if (!event.recurrence) return false;
        
        try {
            const rrule = event.recurrence;
            const freqMatch = rrule.match(/FREQ=([^;]+)/);
            const untilMatch = rrule.match(/UNTIL=([^;]+)/);
            const countMatch = rrule.match(/COUNT=([^;]+)/);
            const intervalMatch = rrule.match(/INTERVAL=([^;]+)/);
            const byDayMatch = rrule.match(/BYDAY=([^;]+)/);
            
            if (!freqMatch) return false;
            
            const frequency = freqMatch[1];
            const interval = intervalMatch ? parseInt(intervalMatch[1]) : 1;
            
            // Parse until date if present
            let untilDate = null;
            if (untilMatch) {
                untilDate = this.parseICalDate(untilMatch[1]);
                if (untilDate < start) return false;
            }
            
            // Check if event occurs within the period
            const eventStart = event.startDate;
            if (!eventStart) return false;
            
            // For weekly recurring events
            if (frequency === 'WEEKLY') {
                const dayOfWeek = eventStart.getDay();
                const byDay = byDayMatch ? byDayMatch[1] : this.getDayAbbreviation(dayOfWeek);
                
                // Check each week in the period
                let currentDate = new Date(start);
                while (currentDate <= end) {
                    if (this.isDayOfWeek(currentDate, byDay)) {
                        return true;
                    }
                    currentDate.setDate(currentDate.getDate() + 7 * interval);
                }
            }
            
            // For monthly recurring events
            if (frequency === 'MONTHLY') {
                const dayOfMonth = eventStart.getDate();
                let currentDate = new Date(start);
                
                while (currentDate <= end) {
                    const testDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), dayOfMonth);
                    if (testDate >= start && testDate <= end) {
                        return true;
                    }
                    currentDate.setMonth(currentDate.getMonth() + interval);
                }
            }
            
            return false;
        } catch (error) {
            logger.componentError('EVENT', 'Error checking recurring event period', error);
            return false;
        }
    }

    getDayAbbreviation(dayOfWeek) {
        const days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
        return days[dayOfWeek];
    }

    isDayOfWeek(date, dayAbbreviation) {
        const dayMap = {
            'SU': 0, 'MO': 1, 'TU': 2, 'WE': 3, 'TH': 4, 'FR': 5, 'SA': 6
        };
        return date.getDay() === dayMap[dayAbbreviation];
    }

    filterEventsByDateRange(events, startDate, endDate) {
        return events.filter(event => {
            if (event.recurring) {
                return this.isRecurringEventInPeriod(event, startDate, endDate);
            } else {
                return this.isEventInPeriod(event.startDate, startDate, endDate);
            }
        });
    }

    // Set events data
    setEventsData(events, cityConfig = null) {
        this.allEvents = events;
        this.eventsData = {
            cityConfig,
            events
        };
        logger.componentLoad('EVENT', 'Events data set', {
            eventCount: events.length,
            cityConfig: cityConfig?.name || 'Unknown'
        });
    }

    // Get all events
    getAllEvents() {
        return this.allEvents;
    }

    // Get events data
    getEventsData() {
        return this.eventsData;
    }

    // Get filtered events for a date range
    getEventsForPeriod(startDate, endDate) {
        return this.filterEventsByDateRange(this.allEvents, startDate, endDate);
    }

    // Get events by type
    getEventsByType(type) {
        return this.allEvents.filter(event => event.eventType === type);
    }

    // Get recurring events
    getRecurringEvents() {
        return this.allEvents.filter(event => event.recurring);
    }

    // Get one-off events
    getOneOffEvents() {
        return this.allEvents.filter(event => !event.recurring);
    }

    // Search events
    searchEvents(query) {
        const searchTerm = query.toLowerCase();
        return this.allEvents.filter(event => {
            const searchableText = `${event.name} ${event.bar} ${event.tea || ''}`.toLowerCase();
            return searchableText.includes(searchTerm);
        });
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EventDataManager;
} else {
    window.EventDataManager = EventDataManager;
}
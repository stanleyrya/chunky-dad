// Calendar Data Module - Handles fetching and parsing calendar data
class CalendarDataLoader {
    constructor() {
        this.debugMode = true;
    }

    log(message, data = null) {
        if (this.debugMode) {
            console.log(`[CalendarDataLoader] ${message}`, data || '');
        }
    }

    error(message, data = null) {
        console.error(`[CalendarDataLoader ERROR] ${message}`, data || '');
    }

    // Load calendar data for specific city
    async loadCalendarData(cityKey) {
        const cityConfig = getCityConfig(cityKey);
        if (!cityConfig || !cityConfig.calendarId) {
            this.error(`No calendar configuration found for city: ${cityKey}`);
            return null;
        }

        this.log(`Loading calendar data for ${cityConfig.name}`);
        
        try {
            const icalUrl = `https://calendar.google.com/calendar/ical/${cityConfig.calendarId}/public/basic.ics`;
            const corsProxy = 'https://api.allorigins.win/raw?url=';
            const fullUrl = corsProxy + encodeURIComponent(icalUrl);
            
            const response = await fetch(fullUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const icalText = await response.text();
            this.log('Successfully fetched iCal data', `Length: ${icalText.length} chars`);
            
            const events = this.parseICalData(icalText);
            
            return {
                cityConfig,
                events
            };
        } catch (error) {
            this.error('Error loading calendar data:', error);
            return null;
        }
    }

    // Parse iCal data into events
    parseICalData(icalText) {
        this.log('Starting iCal parsing', `Text length: ${icalText.length}`);
        const events = [];
        const lines = icalText.split('\n');
        let currentEvent = null;
        let inEvent = false;
        let eventCount = 0;
        
        for (let line of lines) {
            line = line.slice(0, -1); // Remove trailing character
            
            if (line === 'BEGIN:VEVENT') {
                inEvent = true;
                currentEvent = {};
                eventCount++;
            } else if (line === 'END:VEVENT' && currentEvent) {
                if (currentEvent.title) {
                    this.log(`Processing event: ${currentEvent.title}`);
                    events.push(currentEvent);
                }
                currentEvent = null;
                inEvent = false;
            } else if (inEvent && currentEvent) {
                this.parseEventLine(line, currentEvent);
            }
        }
        
        this.log(`📊 Parsing complete. Found ${eventCount} total events, ${events.length} with valid data`);
        return events;
    }

    parseEventLine(line, currentEvent) {
        if (line.startsWith('SUMMARY:')) {
            currentEvent.title = line.substring(8).replace(/\\,/g, ',').replace(/\\;/g, ';');
        } else if (line.startsWith('DESCRIPTION:')) {
            currentEvent.description = line.substring(12).replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
        } else if (line.startsWith(' ') && currentEvent.description) {
            currentEvent.description += line.substring(1);
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
        }
    }

    parseICalDate(icalDate) {
        if (!icalDate) return new Date();
        
        if (icalDate.includes('T')) {
            // DateTime format: YYYYMMDDTHHMMSS[Z]
            const cleanDate = icalDate.replace(/[TZ]/g, '');
            if (cleanDate.length >= 8) {
                const year = cleanDate.substring(0, 4);
                const month = cleanDate.substring(4, 6);
                const day = cleanDate.substring(6, 8);
                const hour = cleanDate.substring(8, 10) || '00';
                const minute = cleanDate.substring(10, 12) || '00';
                const second = cleanDate.substring(12, 14) || '00';
                
                return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
            }
        } else if (icalDate.length === 8) {
            // Date only format: YYYYMMDD (all-day event)
            const year = icalDate.substring(0, 4);
            const month = icalDate.substring(4, 6);
            const day = icalDate.substring(6, 8);
            
            return new Date(`${year}-${month}-${day}T00:00:00`);
        }
        
        return new Date();
    }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.CalendarDataLoader = CalendarDataLoader;
}
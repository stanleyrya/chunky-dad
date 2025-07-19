// Calendar Core Module - Handles calendar data parsing, iCal processing, and event data management
class CalendarCore {
    constructor() {
        this.eventsData = null;
        this.allEvents = [];
        this.locationCache = new Map();
        this.calendarTimezone = null; // Store calendar's default timezone
        this.timezoneData = null; // Store detailed timezone information
        logger.componentInit('CALENDAR', 'Calendar core initialized');
    }

    // Parse iCal data and extract events
    parseICalData(icalText) {
        logger.time('CALENDAR', 'iCal parsing');
        logger.info('CALENDAR', 'Starting iCal parsing', {
            textLength: icalText.length
        });
        
        // Log the beginning of the calendar file for debugging
        const filePreview = icalText.substring(0, 500);
        logger.debug('CALENDAR', 'Calendar file preview (first 500 chars):', {
            preview: filePreview,
            totalLength: icalText.length
        });
        
        // Log calendar metadata
        const calendarNameMatch = icalText.match(/X-WR-CALNAME:(.+)/);
        const calendarTimezoneMatch = icalText.match(/X-WR-TIMEZONE:(.+)/);
        const versionMatch = icalText.match(/VERSION:(.+)/);
        
        if (calendarNameMatch || calendarTimezoneMatch || versionMatch) {
            logger.info('CALENDAR', 'Calendar metadata found', {
                calendarName: calendarNameMatch ? calendarNameMatch[1].trim() : 'Not specified',
                timezone: calendarTimezoneMatch ? calendarTimezoneMatch[1].trim() : 'Not specified',
                version: versionMatch ? versionMatch[1].trim() : 'Not specified'
            });
            
            // Store the calendar's default timezone
            if (calendarTimezoneMatch) {
                this.calendarTimezone = calendarTimezoneMatch[1].trim();
            }
        }
        
        // Extract and parse VTIMEZONE data
        this.timezoneData = this.parseVTimezone(icalText);
        if (this.timezoneData) {
            logger.info('CALENDAR', 'Timezone data extracted', {
                tzid: this.timezoneData.tzid,
                hasDaylight: !!this.timezoneData.daylight,
                hasStandard: !!this.timezoneData.standard
            });
        }
        
        const events = [];
        const lines = icalText.split('\n');
        let currentEvent = null;
        let inEvent = false;
        let eventCount = 0;
        let invalidLines = [];
        
        logger.debug('CALENDAR', `Processing ${lines.length} lines from calendar file`);
        
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
                logger.debug('CALENDAR', `Starting to parse event #${eventCount}`);
            } else if (line === 'END:VEVENT' && currentEvent) {
                if (currentEvent.title) {
                    logger.debug('CALENDAR', `Processing event: ${currentEvent.title}`, {
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
                        logger.debug('CALENDAR', `✅ Successfully parsed event: ${eventData.name}`, {
                            eventType: eventData.eventType,
                            day: eventData.day,
                            time: eventData.time,
                            venue: eventData.bar,
                            recurring: eventData.recurring
                        });
                    } else {
                        logger.warn('CALENDAR', `❌ Failed to parse event: ${currentEvent.title}`, {
                            eventNumber: eventCount,
                            rawEvent: currentEvent
                        });
                    }
                } else {
                    logger.warn('CALENDAR', `❌ Event #${eventCount} has no title, skipping`, {
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
            logger.warn('CALENDAR', `Found ${invalidLines.length} unparseable lines`, {
                sampleInvalidLines: invalidLines.slice(0, 5), // Show first 5 invalid lines
                totalInvalidLines: invalidLines.length
            });
        }
        
        logger.timeEnd('CALENDAR', 'iCal parsing');
        logger.info('CALENDAR', `📊 Parsing complete. Found ${eventCount} total events, ${events.length} with valid data`, {
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

    // Parse VTIMEZONE data from iCal text
    parseVTimezone(icalText) {
        const vtimezoneMatch = icalText.match(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE/);
        if (!vtimezoneMatch) {
            logger.debug('CALENDAR', 'No VTIMEZONE data found in calendar');
            return null;
        }
        
        const vtimezoneText = vtimezoneMatch[0];
        const timezoneData = {
            tzid: null,
            location: null,
            daylight: null,
            standard: null
        };
        
        // Extract TZID
        const tzidMatch = vtimezoneText.match(/TZID:(.+)/);
        if (tzidMatch) {
            timezoneData.tzid = tzidMatch[1].trim();
        }
        
        // Extract X-LIC-LOCATION
        const locationMatch = vtimezoneText.match(/X-LIC-LOCATION:(.+)/);
        if (locationMatch) {
            timezoneData.location = locationMatch[1].trim();
        }
        
        // Extract DAYLIGHT section
        const daylightMatch = vtimezoneText.match(/BEGIN:DAYLIGHT[\s\S]*?END:DAYLIGHT/);
        if (daylightMatch) {
            timezoneData.daylight = this.parseTimezoneSection(daylightMatch[0]);
        }
        
        // Extract STANDARD section
        const standardMatch = vtimezoneText.match(/BEGIN:STANDARD[\s\S]*?END:STANDARD/);
        if (standardMatch) {
            timezoneData.standard = this.parseTimezoneSection(standardMatch[0]);
        }
        
        return timezoneData;
    }
    
    // Parse individual timezone section (DAYLIGHT or STANDARD)
    parseTimezoneSection(sectionText) {
        const section = {};
        
        // Extract timezone offset from
        const offsetFromMatch = sectionText.match(/TZOFFSETFROM:(.+)/);
        if (offsetFromMatch) {
            section.offsetFrom = offsetFromMatch[1].trim();
        }
        
        // Extract timezone offset to
        const offsetToMatch = sectionText.match(/TZOFFSETTO:(.+)/);
        if (offsetToMatch) {
            section.offsetTo = offsetToMatch[1].trim();
        }
        
        // Extract timezone name
        const nameMatch = sectionText.match(/TZNAME:(.+)/);
        if (nameMatch) {
            section.name = nameMatch[1].trim();
        }
        
        // Extract start date
        const startMatch = sectionText.match(/DTSTART:(.+)/);
        if (startMatch) {
            section.dtstart = startMatch[1].trim();
        }
        
        // Extract recurrence rule
        const rruleMatch = sectionText.match(/RRULE:(.+)/);
        if (rruleMatch) {
            section.rrule = rruleMatch[1].trim();
        }
        
        return section;
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
            // Handle DTSTART with potential timezone information
            // Examples: DTSTART:20240315T190000Z or DTSTART;TZID=America/New_York:20240315T190000
            if (line.includes(';TZID=')) {
                // Has timezone parameter
                const match = line.match(/DTSTART;TZID=([^:]+):(.+)/);
                if (match) {
                    currentEvent.startTimezone = match[1];
                    currentEvent.start = this.parseICalDate(`TZID=${match[1]}:${match[2]}`);
                }
            } else {
                // No timezone parameter
                const dateMatch = line.match(/DTSTART:(.+)/);
                if (dateMatch) {
                    currentEvent.start = this.parseICalDate(dateMatch[1]);
                }
            }
        } else if (line.startsWith('DTEND')) {
            // Handle DTEND with potential timezone information
            if (line.includes(';TZID=')) {
                // Has timezone parameter
                const match = line.match(/DTEND;TZID=([^:]+):(.+)/);
                if (match) {
                    currentEvent.endTimezone = match[1];
                    currentEvent.end = this.parseICalDate(`TZID=${match[1]}:${match[2]}`);
                }
            } else {
                // No timezone parameter
                const dateMatch = line.match(/DTEND:(.+)/);
                if (dateMatch) {
                    currentEvent.end = this.parseICalDate(dateMatch[1]);
                }
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
                eventType: this.getEventType(calendarEvent.recurrence),
                recurring: !!calendarEvent.recurrence,
                recurrence: calendarEvent.recurrence,
                coordinates: calendarEvent.location,
                startDate: calendarEvent.start,
                endDate: calendarEvent.end,
                unprocessedDescription: calendarEvent.description || null, // Store raw description for debugging
                // Store timezone information if available
                startTimezone: calendarEvent.startTimezone || null,
                endTimezone: calendarEvent.endTimezone || null,
                // Store calendar default timezone as fallback
                calendarTimezone: this.calendarTimezone || null
            };

            // Parse description for additional data
            if (calendarEvent.description) {
                logger.debug('CALENDAR', 'Processing event description', {
                    eventName: eventData.name,
                    descriptionLength: calendarEvent.description.length,
                    descriptionPreview: calendarEvent.description.substring(0, 100) + '...'
                });
                const additionalData = this.parseKeyValueDescription(calendarEvent.description);
                if (additionalData) {
                    eventData.bar = additionalData.bar;
                    if (additionalData.cover) {
                        eventData.cover = additionalData.cover;
                    }
                    eventData.tea = additionalData.tea || additionalData.description;
                    eventData.website = additionalData.website;
                    eventData.instagram = additionalData.instagram;
                    eventData.facebook = additionalData.facebook;
                    eventData.gmaps = additionalData.gmaps;
                    eventData.shortName = additionalData.shortName;
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

            // Log timezone usage for debugging
            if (eventData.startTimezone || eventData.calendarTimezone) {
                logger.debug('CALENDAR', 'Event timezone information', {
                    eventName: eventData.name,
                    eventTimezone: eventData.startTimezone,
                    calendarDefaultTimezone: eventData.calendarTimezone,
                    usingTimezone: eventData.startTimezone || eventData.calendarTimezone
                });
            }

            return eventData;
        } catch (error) {
            logger.componentError('CALENDAR', 'Failed to parse event data', error);
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
            'gmaps': 'gmaps', 'google maps': 'gmaps',
            'shortname': 'shortName', 'short name': 'shortName', 'short': 'shortName', 'nickname': 'shortName', 'nick name': 'shortName', 'nick': 'shortName'
        };

        // Clean up any remaining carriage returns that might interfere with parsing
        const carriageReturnCount = (description.match(/\r/g) || []).length;
        if (carriageReturnCount > 0) {
            logger.debug('CALENDAR', 'Removing carriage returns from description', {
                count: carriageReturnCount,
                sampleBefore: description.substring(0, 100).replace(/\r/g, '\\r').replace(/\n/g, '\\n')
            });
        }
        let textBlock = description.replace(/\r/g, '');
        
        // First, handle HTML content - extract URLs from anchor tags and convert to plain text
        if (textBlock.includes("<a href=") || textBlock.includes("<br>")) {
            // Extract URLs from anchor tags before converting to plain text
            const linkMatches = textBlock.match(/<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi);
            if (linkMatches) {
                linkMatches.forEach(linkMatch => {
                    const urlMatch = linkMatch.match(/href=["']([^"']+)["']/);
                    if (urlMatch) {
                        const url = urlMatch[1];
                        // Replace the HTML anchor tag with just the URL
                        textBlock = textBlock.replace(linkMatch, url);
                    }
                });
            }
            
            // Convert HTML breaks to newlines
            textBlock = textBlock.replace(/<br\s?\/?>/gi, "\n");
            
            // Remove any remaining HTML tags
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = textBlock;
            textBlock = tempDiv.textContent || tempDiv.innerText || '';
        }
        
        // Replace escaped newlines with actual newlines
        textBlock = textBlock.replace(/\\n/g, "\n");
        
        const lines = textBlock.split("\n");
        
        logger.debug('CALENDAR', 'Parsing event description', {
            originalLength: description.length,
            processedLength: textBlock.length,
            linesCount: lines.length,
            containsHTML: description.includes('<'),
            extractedLines: lines.slice(0, 3) // Show first 3 lines for debugging
        });
        
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            
            // Match key-value pairs with various separators
            const keyValueMatch = line.match(/([^:=\-]+)[:=\-]\s*(.+)/);
            if (keyValueMatch) {
                const key = keyValueMatch[1].trim().toLowerCase();
                const value = keyValueMatch[2].trim();
                const mappedKey = keyMap[key] || key;
                
                // Additional validation for URLs
                if (['website', 'instagram', 'facebook', 'gmaps'].includes(mappedKey)) {
                    // Ensure we have a valid URL
                    if (value.startsWith('http://') || value.startsWith('https://')) {
                        data[mappedKey] = value;
                        logger.debug('CALENDAR', `Extracted ${mappedKey} URL: ${value}`);
                    } else {
                        logger.warn('CALENDAR', `Invalid URL format for ${mappedKey}: ${value}`);
                    }
                } else {
                    data[mappedKey] = value;
                }
            }
        }
        
        logger.debug('CALENDAR', 'Description parsing complete', {
            extractedKeys: Object.keys(data),
            hasWebsite: !!data.website,
            hasInstagram: !!data.instagram,
            hasFacebook: !!data.facebook,
            hasGmaps: !!data.gmaps
        });
        
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

    // Generate URL slug from event name
    generateSlug(name) {
        return name.toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
    }

    // Date and time utility methods
    getDayFromDate(date) {
        if (!date) return 'TBD';
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[date.getDay()];
    }

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
                            return `${startTime}-${endTime}`;
        }
        
        return startTime;
    }

    getEventType(recurrence) {
        if (!recurrence) return 'routine';
        if (recurrence.includes('WEEKLY')) return 'weekly';
        if (recurrence.includes('MONTHLY')) return 'monthly';
        if (recurrence.includes('DAILY')) return 'daily';
        return 'recurring';
    }

    parseICalDate(icalDate) {
        if (!icalDate) return new Date();
        
        // Check if the date has timezone information
        let timezone = null;
        let dateStr = icalDate;
        
        // Check for TZID parameter (e.g., TZID=America/New_York:20240315T190000)
        if (icalDate.includes('TZID=')) {
            const tzMatch = icalDate.match(/TZID=([^:]+):(.+)/);
            if (tzMatch) {
                timezone = tzMatch[1];
                dateStr = tzMatch[2];
            }
        }
        
        if (dateStr.includes('T')) {
            // DateTime format: YYYYMMDDTHHMMSS[Z]
            const isUTC = dateStr.endsWith('Z');
            const cleanDate = dateStr.replace(/[TZ]/g, '');
            
            if (cleanDate.length >= 8) {
                const year = cleanDate.substring(0, 4);
                const month = cleanDate.substring(4, 6);
                const day = cleanDate.substring(6, 8);
                const hour = cleanDate.substring(8, 10) || '00';
                const minute = cleanDate.substring(10, 12) || '00';
                const second = cleanDate.substring(12, 14) || '00';
                
                let date;
                if (isUTC) {
                    // UTC time - create date in UTC
                    date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
                } else if (timezone && this.timezoneData && this.timezoneData.tzid === timezone) {
                    // We have timezone data for this specific timezone
                    date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
                    // Apply timezone offset if needed
                    date = this.applyTimezoneOffset(date, year, month, day);
                } else if (!timezone && this.calendarTimezone) {
                    // No specific timezone, use calendar's default timezone
                    date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
                    logger.debug('CALENDAR', 'Using calendar default timezone for date', {
                        date: dateStr,
                        calendarTimezone: this.calendarTimezone
                    });
                } else {
                    // Local time
                    date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
                }
                
                return date;
            }
        } else if (dateStr.length === 8) {
            // Date only format: YYYYMMDD (all-day event)
            const year = dateStr.substring(0, 4);
            const month = dateStr.substring(4, 6);
            const day = dateStr.substring(6, 8);
            
            return new Date(`${year}-${month}-${day}T00:00:00`);
        }
        
        return new Date();
    }
    
    // Apply timezone offset based on timezone data
    applyTimezoneOffset(date, year, month, day) {
        if (!this.timezoneData) return date;
        
        // Determine if we're in daylight or standard time
        const isDaylight = this.isInDaylightTime(date);
        const timezoneSection = isDaylight ? this.timezoneData.daylight : this.timezoneData.standard;
        
        if (!timezoneSection) return date;
        
        // Log timezone application
        logger.debug('CALENDAR', 'Applying timezone offset', {
            date: date.toISOString(),
            isDaylight,
            offset: timezoneSection.offsetTo,
            timezoneName: timezoneSection.name
        });
        
        return date;
    }
    
    // Check if a date is in daylight saving time based on VTIMEZONE data
    isInDaylightTime(date) {
        if (!this.timezoneData || !this.timezoneData.daylight) return false;
        
        const daylight = this.timezoneData.daylight;
        if (!daylight.rrule) return false;
        
        // Parse the RRULE to determine daylight saving rules
        // Example: FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
        const rules = {};
        daylight.rrule.split(';').forEach(rule => {
            const [key, value] = rule.split('=');
            rules[key] = value;
        });
        
        if (rules.FREQ !== 'YEARLY') return false;
        
        const year = date.getFullYear();
        const month = date.getMonth() + 1; // JavaScript months are 0-based
        
        // Check if we have the necessary rules
        if (!rules.BYMONTH || !rules.BYDAY) return false;
        
        // Calculate daylight start date
        const daylightStartMonth = parseInt(rules.BYMONTH);
        const daylightStartDate = this.calculateByDayDate(year, daylightStartMonth, rules.BYDAY);
        
        // Calculate standard start date (from standard section)
        if (!this.timezoneData.standard || !this.timezoneData.standard.rrule) return false;
        
        const standardRules = {};
        this.timezoneData.standard.rrule.split(';').forEach(rule => {
            const [key, value] = rule.split('=');
            standardRules[key] = value;
        });
        
        const standardStartMonth = parseInt(standardRules.BYMONTH);
        const standardStartDate = this.calculateByDayDate(year, standardStartMonth, standardRules.BYDAY);
        
        // Check if date falls within daylight saving time
        if (daylightStartDate && standardStartDate) {
            if (daylightStartMonth < standardStartMonth) {
                // Northern hemisphere (daylight in middle of year)
                return date >= daylightStartDate && date < standardStartDate;
            } else {
                // Southern hemisphere (daylight at start/end of year)
                return date >= daylightStartDate || date < standardStartDate;
            }
        }
        
        return false;
    }
    
    // Calculate the specific date for a BYDAY rule (e.g., 2SU = second Sunday)
    calculateByDayDate(year, month, bydayRule) {
        // Parse BYDAY rule (e.g., "2SU" = second Sunday, "-1SU" = last Sunday)
        const match = bydayRule.match(/^(-?\d+)([A-Z]{2})$/);
        if (!match) return null;
        
        const occurrence = parseInt(match[1]);
        const dayCode = match[2];
        
        // Convert day code to day number
        const dayCodeToDayNumber = {
            'SU': 0, 'MO': 1, 'TU': 2, 'WE': 3, 'TH': 4, 'FR': 5, 'SA': 6
        };
        
        const targetDayOfWeek = dayCodeToDayNumber[dayCode];
        if (targetDayOfWeek === undefined) return null;
        
        // Use the existing method from the class
        const calculatedDate = this.calculateByDayOccurrence(year, month - 1, occurrence, targetDayOfWeek);
        
        // Add time component from DTSTART if available
        if (calculatedDate && this.timezoneData.daylight && this.timezoneData.daylight.dtstart) {
            const timeMatch = this.timezoneData.daylight.dtstart.match(/T(\d{2})(\d{2})(\d{2})/);
            if (timeMatch) {
                calculatedDate.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), parseInt(timeMatch[3]));
            }
        }
        
        return calculatedDate;
    }

    // Date range utility methods
    getWeekBounds(date) {
        const start = new Date(date);
        const day = start.getDay();
        start.setDate(start.getDate() - day);
        start.setHours(0, 0, 0, 0);
        
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        
        return { start, end };
    }

    getMonthBounds(date) {
        const start = new Date(date.getFullYear(), date.getMonth(), 1);
        start.setHours(0, 0, 0, 0);
        
        const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
        
        return { start, end };
    }

    // Check if event falls within a date range
    isEventInPeriod(eventDate, start, end) {
        return eventDate >= start && eventDate <= end;
    }

    // Handle recurring events
    isRecurringEventInPeriod(event, start, end) {
        if (!event.recurring || !event.recurrence) return false;
        
        const eventStartDate = new Date(event.startDate);
        if (eventStartDate > end) return false;
        
        // Check if the recurrence pattern matches the period
        const rules = event.recurrence.split(';');
        let freq = null;
        let interval = 1;
        
        for (const rule of rules) {
            const [key, value] = rule.split('=');
            if (key === 'FREQ') freq = value;
            if (key === 'INTERVAL') interval = parseInt(value);
        }
        
        if (!freq) return false;
        
        // Simple recurring event check
        let current = new Date(eventStartDate);
        while (current <= end) {
            if (current >= start && current <= end) {
                return true;
            }
            
            switch (freq) {
                case 'DAILY':
                    current.setDate(current.getDate() + interval);
                    break;
                case 'WEEKLY':
                    current.setDate(current.getDate() + (7 * interval));
                    break;
                case 'MONTHLY':
                    current.setMonth(current.getMonth() + interval);
                    break;
                default:
                    return false;
            }
        }
        
        return false;
    }

    // Filter events by date range
    filterEventsByDateRange(events, startDate, endDate) {
        return events.filter(event => {
            const eventDate = new Date(event.startDate);
            return this.isEventInPeriod(eventDate, startDate, endDate) ||
                   this.isRecurringEventInPeriod(event, startDate, endDate);
        });
    }

    // Load calendar data from iCal URL
    async loadCalendarData(calendarId) {
        try {
            logger.time('CALENDAR', 'Calendar data loading');
            logger.apiCall('CALENDAR', `Loading calendar data for ID: ${calendarId}`);
            
            const icalUrl = `https://calendar.google.com/calendar/ical/${calendarId}/public/basic.ics`;
            const response = await fetch(icalUrl);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const icalData = await response.text();
            const events = this.parseICalData(icalData);
            
            this.eventsData = events;
            this.allEvents = events;
            
            logger.timeEnd('CALENDAR', 'Calendar data loading');
            logger.componentLoad('CALENDAR', 'Calendar data loaded successfully', {
                eventCount: events.length,
                calendarId: calendarId
            });
            
            return events;
        } catch (error) {
            logger.componentError('CALENDAR', 'Failed to load calendar data', error);
            throw error;
        }
    }

    // Get the effective timezone for an event
    getEventTimezone(event) {
        // Priority order:
        // 1. Event-specific timezone (from DTSTART;TZID=...)
        // 2. Calendar default timezone (from X-WR-TIMEZONE)
        // 3. System default (browser timezone)
        
        if (event.startTimezone) {
            return {
                tzid: event.startTimezone,
                source: 'event',
                data: this.timezoneData && this.timezoneData.tzid === event.startTimezone ? this.timezoneData : null
            };
        }
        
        if (event.calendarTimezone || this.calendarTimezone) {
            const timezone = event.calendarTimezone || this.calendarTimezone;
            return {
                tzid: timezone,
                source: 'calendar',
                data: this.timezoneData && this.timezoneData.tzid === timezone ? this.timezoneData : null
            };
        }
        
        // Fallback to browser timezone
        return {
            tzid: Intl.DateTimeFormat().resolvedOptions().timeZone,
            source: 'system',
            data: null
        };
    }
    
    // Get timezone offset for a specific date
    getTimezoneOffset(date, timezoneInfo) {
        if (!timezoneInfo || !timezoneInfo.data) {
            // Use standard JavaScript timezone handling
            return date.getTimezoneOffset();
        }
        
        const tzData = timezoneInfo.data;
        const isDaylight = this.isInDaylightTime(date);
        const section = isDaylight ? tzData.daylight : tzData.standard;
        
        if (!section || !section.offsetTo) {
            return date.getTimezoneOffset();
        }
        
        // Parse offset string (e.g., "-0500" or "-0400")
        const offsetMatch = section.offsetTo.match(/^([+-])(\d{2})(\d{2})$/);
        if (!offsetMatch) {
            return date.getTimezoneOffset();
        }
        
        const sign = offsetMatch[1] === '+' ? 1 : -1;
        const hours = parseInt(offsetMatch[2]);
        const minutes = parseInt(offsetMatch[3]);
        
        // Return offset in minutes (negative for timezones ahead of UTC)
        return -(sign * (hours * 60 + minutes));
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CalendarCore;
} else {
    window.CalendarCore = CalendarCore;
}
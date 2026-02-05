// Calendar Core Module - Handles calendar data parsing, iCal processing, and event data management
class CalendarCore {
    constructor() {
        this.eventsData = null;
        this.allEvents = [];
        this.locationCache = new Map();
        this.calendarTimezone = null; // Store calendar's default timezone
        this.timezoneData = null; // Store detailed timezone information
        
        // Day name arrays for consistent formatting
        this.dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        this.dayAbbrevs = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        
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
        
        logger.info('CALENDAR', `📊 Event parsing complete. Found ${events.length} events`, {
            eventCount: events.length
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
            currentEvent.title = line.substring(8).replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\:/g, ':');
        } else if (line.startsWith('DESCRIPTION:')) {
            currentEvent.description = line.substring(12).replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\:/g, ':');
        } else if (line.startsWith('LOCATION:')) {
            currentEvent.location = line.substring(9).replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\:/g, ':');
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
        } else if (line.startsWith('UID:')) {
            currentEvent.uid = line.substring(4).trim();
            parsed = true;
        } else if (line.startsWith('RECURRENCE-ID')) {
            // Handle RECURRENCE-ID with potential timezone information
            if (line.includes(';TZID=')) {
                const match = line.match(/RECURRENCE-ID;TZID=([^:]+):(.+)/);
                if (match) {
                    currentEvent.recurrenceIdTimezone = match[1];
                    currentEvent.recurrenceId = this.parseICalDate(`TZID=${match[1]}:${match[2]}`);
                }
            } else {
                const dateMatch = line.match(/RECURRENCE-ID:(.+)/);
                if (dateMatch) {
                    currentEvent.recurrenceId = this.parseICalDate(dateMatch[1]);
                }
            }
            parsed = true;
        } else if (line.startsWith('SEQUENCE:')) {
            const rawValue = line.substring(9).trim();
            const parsedSeq = parseInt(rawValue, 10);
            currentEvent.sequence = Number.isFinite(parsedSeq) ? parsedSeq : null;
            parsed = true;
        } else if (line.startsWith('DTSTAMP:') || line.startsWith('CREATED:') || 
                   line.startsWith('LAST-MODIFIED:') || line.startsWith('STATUS:') || 
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
                // Store timezone information if available (for debugging)
                startTimezone: calendarEvent.startTimezone || null,
                endTimezone: calendarEvent.endTimezone || null,
                // Store calendar default timezone as fallback
                calendarTimezone: this.calendarTimezone || null,
                // Store whether the original time was in UTC format (for debugging)
                wasUTC: calendarEvent.start?._wasUTC || false,
                // Store UID and recurrence ID for event merging
                uid: calendarEvent.uid || null,
                recurrenceId: calendarEvent.recurrenceId || null,
                sequence: calendarEvent.sequence ?? null
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
                    if (additionalData.image) {
                        eventData.image = additionalData.image;
                    }
                    eventData.tea = additionalData.tea || additionalData.description;
                    eventData.website = additionalData.website;
                    eventData.instagram = additionalData.instagram;
                    eventData.facebook = additionalData.facebook;
                    eventData.gmaps = additionalData.gmaps;
                    eventData.ticketUrl = additionalData.ticketUrl;
                    eventData.shortName = additionalData.shortName;
                    eventData.shorterName = additionalData.shorterName;
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

            eventData.slug = this.generateSlug(eventData.name, calendarEvent.uid);

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

    // ============================================================================
    // ESCAPE CHARACTER UTILITIES - Handle escaped colons in text
    // ============================================================================
    // 
    // Problem: Time formats like "Doors open at 9:00" were being parsed as metadata
    // Solution: Use backslash (\) to escape colons that should not be treated as separators
    // 
    // Examples:
    //   "Doors open at 9\:00 PM"     -> Not parsed as metadata (colon is escaped)
    //   "venue: The Bear Den"         -> Parsed as metadata (single-word key)
    //   "doors open at 9: 00"         -> Not parsed as metadata (multi-word key rejected)
    //   "description: Show at 8\:30"  -> Parsed as metadata, value = "Show at 8:30"
    // 
    // Escape Rules:
    //   \: -> :     (escaped colon becomes literal colon)
    //   \\ -> \     (escaped backslash becomes literal backslash)
    //   
    // Key Validation:
    //   - Must be single word (no spaces)
    //   - Must start with letter
    //   - Must be 2-20 characters long
    //   - Must be alphanumeric only
    // ============================================================================
    
    // Find first unescaped occurrence of a character in text
    findUnescaped(text, char, startIndex = 0) {
        for (let i = startIndex; i < text.length; i++) {
            if (text[i] === char) {
                // Count preceding backslashes to determine if this character is escaped
                let backslashCount = 0;
                for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) {
                    backslashCount++;
                }
                
                // If even number of backslashes (including 0), the character is not escaped
                if (backslashCount % 2 === 0) {
                    return i;
                }
            }
        }
        return -1;
    }
    
    // Remove escape characters from text
    unescapeText(text) {
        if (!text || typeof text !== 'string') {
            return text;
        }
        
        return text
            .replace(/\\:/g, ':')      // Unescape colons (\: -> :)
            .replace(/\\\\/g, '\\');   // Unescape backslashes (\\ -> \)
    }
    
    // Check if a key is valid for metadata (words with spaces allowed, reasonable length)
    isValidMetadataKey(key) {
        if (!key || typeof key !== 'string') {
            return false;
        }
        
        const trimmedKey = key.trim();
        
        // Must be words (spaces allowed between words) and reasonable length
        return /^[a-zA-Z][a-zA-Z0-9\s]*[a-zA-Z0-9]$/.test(trimmedKey) && 
               trimmedKey.length >= 2 && 
               trimmedKey.length <= 30;
    }

    // Parse description for key-value pairs
    parseKeyValueDescription(description) {
        const data = {};
        const keyMap = {
            'bar': 'bar', 'location': 'bar', 'host': 'bar',
            'cover': 'cover', 'cost': 'cover', 'price': 'cover',
            'tea': 'tea', 'info': 'tea', 'description': 'tea',
            'website': 'website', 'url': 'website', 'instagram': 'instagram', 'facebook': 'facebook',
            'ticketurl': 'ticketUrl', 'ticket url': 'ticketUrl', 'tickets': 'ticketUrl', 'ticket': 'ticketUrl',
            'type': 'type', 'eventtype': 'type', 'recurring': 'recurring',
            'gmaps': 'gmaps', 'google maps': 'gmaps',
            'shortname': 'shortName', 'short name': 'shortName', 'short': 'shortName', 'nickname': 'shortName', 'nick name': 'shortName', 'nick': 'shortName',
            'shortername': 'shorterName', 'shorter name': 'shorterName', 'shorter': 'shorterName',
            'image': 'image'
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
            textBlock = textBlock.replace(/<br\s?\/?>(?=\s*\n?)/gi, "\n");
            
            // Remove any remaining HTML tags - use DOM when available, else regex fallback
            if (typeof document !== 'undefined' && document.createElement) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = textBlock;
                textBlock = tempDiv.textContent || tempDiv.innerText || '';
            } else {
                // Basic fallback: strip tags
                textBlock = textBlock.replace(/<[^>]+>/g, '');
            }
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
            
            
            // Use escape-aware parsing to find the first unescaped colon
            const colonIndex = this.findUnescaped(line, ':');
            
            if (colonIndex > 0) {
                // Extract key and value, then unescape them
                const rawKey = line.substring(0, colonIndex).trim();
                const rawValue = line.substring(colonIndex + 1).trim();
                
                const unescapedKey = this.unescapeText(rawKey);
                const unescapedValue = this.unescapeText(rawValue);
                
                // Only process if it's a valid metadata key
                if (this.isValidMetadataKey(unescapedKey)) {
                    const key = unescapedKey.toLowerCase();
                    const value = unescapedValue;
                    // Use case-insensitive lookup in keyMap
                    const mappedKey = keyMap[key] || key;
                    
                    
                    // Additional validation for URLs
                    if (['website', 'instagram', 'facebook', 'gmaps', 'image', 'ticketUrl'].includes(mappedKey)) {
                        // Ensure we have a valid URL
                        if (value.startsWith('http://') || value.startsWith('https://')) {
                            data[mappedKey] = value;
                            logger.debug('CALENDAR', `Extracted ${mappedKey} URL: ${value}`);
                        } else {
                            logger.warn('CALENDAR', `Invalid URL format for ${mappedKey}: ${value}`);
                        }
                    } else {
                        data[mappedKey] = value;
                        logger.debug('CALENDAR', `Extracted metadata: ${mappedKey} = ${value}`);
                    }
                } else {
                    // Invalid key - this line is not treated as metadata
                    logger.debug('CALENDAR', `Ignored invalid metadata key: "${unescapedKey}" in line: "${line}"`);
                }
            } else {
                // No unescaped colon found - this is not a metadata line
                logger.debug('CALENDAR', `No unescaped colon found in line: "${line}"`);
            }
        }
        
        logger.debug('CALENDAR', 'Description parsing complete', {
            extractedKeys: Object.keys(data),
            hasWebsite: !!data.website,
            hasInstagram: !!data.instagram,
            hasFacebook: !!data.facebook,
            hasGmaps: !!data.gmaps,
            hasTicketUrl: !!data.ticketUrl,
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
        if (data.ticketUrl) {
            links.push({ type: 'tickets', url: data.ticketUrl, label: '🎫 Tickets' });
        }
        
        return links.length > 0 ? links : null;
    }

    // Generate URL slug from event name and UID
    generateSlug(name, uid = null) {
        const baseSlug = name.toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
        
        // Add UID hash suffix to ensure uniqueness for events with same name
        if (uid) {
            // Create a short hash from the UID for clean URLs
            const uidHash = this.hashUID(uid);
            return `${baseSlug}-${uidHash}`;
        }
        
        return baseSlug;
    }

    // Create a short hash from UID for clean URLs
    hashUID(uid) {
        // Simple hash function that creates a consistent 8-character hash
        let hash = 0;
        for (let i = 0; i < uid.length; i++) {
            const char = uid.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        // Convert to positive hex string and take first 8 characters
        return Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8);
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

    // Enhanced recurrence parsing for better display
    parseRecurrencePattern(recurrence) {
        if (!recurrence) return null;
        
        const rules = {};
        recurrence.split(';').forEach(rule => {
            const [key, value] = rule.split('=');
            rules[key] = value;
        });
        
        const pattern = {
            frequency: rules.FREQ || null,
            interval: parseInt(rules.INTERVAL) || 1,
            byDay: rules.BYDAY ? rules.BYDAY.split(',') : null,
            byMonthDay: rules.BYMONTHDAY ? rules.BYMONTHDAY.split(',').map(d => parseInt(d)) : null,
            bySetPos: rules.BYSETPOS ? rules.BYSETPOS.split(',').map(p => parseInt(p)) : null,
            until: rules.UNTIL || null,
            count: rules.COUNT ? parseInt(rules.COUNT) : null
        };
        
        return pattern;
    }

    // Get human-readable recurrence description
    getRecurrenceDescription(recurrence, eventDate) {
        if (!recurrence) return null;
        
        const pattern = this.parseRecurrencePattern(recurrence);
        if (!pattern) return null;
        
        // Handle weekly events
        if (pattern.frequency === 'WEEKLY') {
            if (pattern.byDay && pattern.byDay.length === 1) {
                const dayCode = pattern.byDay[0];
                const dayIndex = this.getDayIndexFromCode(dayCode);
                if (dayIndex !== -1) {
                    return `Every ${this.dayAbbrevs[dayIndex]}`;
                }
            }
            return pattern.interval === 1 ? 'Weekly' : `Every ${pattern.interval} weeks`;
        }
        
        // Handle monthly events
        if (pattern.frequency === 'MONTHLY') {
            if (pattern.byDay && pattern.byDay.length === 1) {
                const dayCode = pattern.byDay[0];
                const dayIndex = this.getDayIndexFromCode(dayCode);
                if (dayIndex !== -1) {
                    const occurrence = this.getOccurrenceFromDayCode(dayCode);
                    if (occurrence > 0) {
                        const ordinal = this.getOrdinal(occurrence);
                        return `${ordinal} ${this.dayAbbrevs[dayIndex]}`;
                    } else if (occurrence < 0) {
                        return `Last ${this.dayAbbrevs[dayIndex]}`;
                    }
                }
            }
            if (pattern.byMonthDay && pattern.byMonthDay.length === 1) {
                const day = pattern.byMonthDay[0];
                const ordinal = this.getOrdinal(day);
                return `${ordinal} of month`;
            }
            return pattern.interval === 1 ? 'Monthly' : `Every ${pattern.interval} months`;
        }
        
        // Handle daily events
        if (pattern.frequency === 'DAILY') {
            return pattern.interval === 1 ? 'Daily' : `Every ${pattern.interval} days`;
        }
        
        return 'Recurring';
    }

    // Helper method to get day index from day code (e.g., "MO" -> 1, "-1SA" -> 6)
    getDayIndexFromCode(dayCode) {
        const dayMap = {
            'SU': 0, 'MO': 1, 'TU': 2, 'WE': 3, 'TH': 4, 'FR': 5, 'SA': 6
        };
        
        // Extract just the day part if the dayCode includes occurrence (e.g., "-1SA" -> "SA")
        const dayPart = dayCode.replace(/^-?\d+/, '');
        return dayMap[dayPart] || -1;
    }

    // Helper method to get occurrence number from day code (e.g., "2TU" -> 2)
    getOccurrenceFromDayCode(dayCode) {
        const match = dayCode.match(/^(-?\d+)([A-Z]{2})$/);
        return match ? parseInt(match[1]) : 0;
    }

    // Helper method to get ordinal suffix (e.g., 1 -> "1st", 2 -> "2nd", 3 -> "3rd")
    getOrdinal(num) {
        const suffixes = ['th', 'st', 'nd', 'rd'];
        const v = num % 100;
        return num + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
    }

    // Get day difference between two dates (date-only, UTC-safe)
    getDayDifference(startDate, endDate) {
        const startUTC = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        const endUTC = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
        return Math.floor((endUTC - startUTC) / 86400000);
    }


    // Enhanced day/time formatting with context - always uses pattern-first approach
    getEnhancedDayTimeDisplay(event, calendarView = 'week', calendarPeriod = null) {
        const { day, time } = event;
        
        // Convert full day names to abbreviations
        const dayAbbrevMap = {
            'Sunday': 'Sun',
            'Monday': 'Mon', 
            'Tuesday': 'Tue',
            'Wednesday': 'Wed',
            'Thursday': 'Thu',
            'Friday': 'Fri',
            'Saturday': 'Sat'
        };
        
        const abbreviatedDay = dayAbbrevMap[day] || day;
        const baseDisplay = `${abbreviatedDay} ${time}`;
        
        logger.debug('CALENDAR', 'Enhanced day/time display (simplified)', {
            eventName: event.name,
            day,
            abbreviatedDay,
            time,
            baseDisplay,
            calendarView
        });
        
        return baseDisplay;
    }

    // Get recurring badge content for the event badge system
    getRecurringBadgeContent(event) {
        const { recurring, eventType, recurrence, startDate } = event;
        
        if (!recurring || !recurrence) {
            return null;
        }

        const recurrenceDesc = this.getRecurrenceDescription(recurrence, startDate);
        
        logger.debug('CALENDAR', 'Recurring badge content', {
            eventName: event.name,
            eventType,
            recurrenceDesc
        });
        
        return recurrenceDesc;
    }

    // Get date badge content for the event badge system
    getDateBadgeContent(event, calendarPeriod = null) {
        const { recurring, startDate } = event;
        
        // For weekly events, never show date badge (too many events to be useful)
        if (event.eventType === 'weekly') {
            return null;
        }
        
        if (!recurring) {
            // One-off event - show the date (same as calendar)
            const startDateStr = startDate instanceof Date ? 
                startDate.toISOString().split('T')[0] : startDate;
            const parts = startDateStr.split('-');
            const month = parseInt(parts[1]);
            const date = parseInt(parts[2]);
            return `${month}/${date}`;
        }
        
        // Recurring event - show dates if we have calendar period context
        if (calendarPeriod && calendarPeriod.start && calendarPeriod.end) {
            const visibleDates = this.getVisibleEventDates(event, calendarPeriod.start, calendarPeriod.end);
            
            if (visibleDates.length === 0) {
                return null;
            }
            
            // For recurring events, show a cleaner format
            if (visibleDates.length === 1) {
                const d = visibleDates[0];
                return `${d.getMonth() + 1}/${d.getDate()}`;
            } else if (visibleDates.length <= 3) {
                // Show up to 3 dates cleanly
                const dateStrings = visibleDates.map(d => `${d.getMonth() + 1}/${d.getDate()}`);
                return dateStrings.join(', ');
            } else {
                // 4+ dates: show first date + count
                const first = visibleDates[0];
                const remaining = visibleDates.length - 1;
                return `${first.getMonth() + 1}/${first.getDate()} +${remaining} more`;
            }
        }
        
        // For monthly events without calendar context, show next occurrence
        const startDateStr = startDate instanceof Date ? 
            startDate.toISOString().split('T')[0] : startDate;
        const parts = startDateStr.split('-');
        const month = parseInt(parts[1]);
        const date = parseInt(parts[2]);
        return `${month}/${date}`;
    }

    // Get all dates when an event occurs within a given period
    getVisibleEventDates(event, periodStart, periodEnd) {
        const dates = [];
        
        if (!event.recurring || !event.recurrence) {
            // One-off event - check if it falls within the period
            const startDateStr = event.startDate instanceof Date ? 
                event.startDate.toISOString().split('T')[0] : event.startDate;
            const parts = startDateStr.split('-');
            const eventDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            if (eventDate >= periodStart && eventDate <= periodEnd) {
                dates.push(eventDate);
            }
            return dates;
        }
        
        // Recurring event - generate all occurrences within the period
        const pattern = this.parseRecurrencePattern(event.recurrence);
        if (!pattern) return dates;
        
        logger.debug('CALENDAR', 'Generating visible event dates for recurring event', {
            eventName: event.name,
            recurrence: event.recurrence,
            pattern: pattern,
            periodStart: periodStart.toISOString().split('T')[0],
            periodEnd: periodEnd.toISOString().split('T')[0]
        });
        
        const startDateStr = event.startDate instanceof Date ? 
            event.startDate.toISOString().split('T')[0] : event.startDate;
        const parts = startDateStr.split('-');
        const eventStartDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        if (eventStartDate > periodEnd) return dates;
        
        // For weekly events, check each day in the period with interval handling
        if (pattern.frequency === 'WEEKLY') {
            const interval = pattern.interval || 1;
            const targetDays = pattern.byDay && pattern.byDay.length > 0
                ? pattern.byDay
                    .map(dayCode => this.getDayIndexFromCode(dayCode))
                    .filter(dayIndex => dayIndex !== -1)
                : [eventStartDate.getDay()];
            
            if (targetDays.length === 0) {
                logger.warn('CALENDAR', 'Invalid BYDAY values in weekly recurrence', {
                    eventName: event.name,
                    byDay: pattern.byDay
                });
                return dates;
            }
            
            // Check each day in the period to see if it matches the target days and interval
            const current = new Date(periodStart);
            while (current <= periodEnd) {
                if (current >= eventStartDate && targetDays.includes(current.getDay())) {
                    const daysSinceStart = this.getDayDifference(eventStartDate, current);
                    const weeksSinceStart = Math.floor(daysSinceStart / 7);
                    if (weeksSinceStart % interval === 0) {
                        dates.push(new Date(current));
                    }
                }
                current.setDate(current.getDate() + 1);
            }
            
            logger.debug('CALENDAR', 'Weekly event dates found', {
                eventName: event.name,
                targetDays: targetDays.map(dayIndex => this.dayNames[dayIndex]),
                interval,
                datesFound: dates.map(d => d.toISOString().split('T')[0])
            });
            
            return dates;
        }
        
        // For other frequencies, use the original iterative approach
        let current = new Date(eventStartDate);
        const maxIterations = 100; // Safety limit
        let iterations = 0;
        
        while (current <= periodEnd && iterations < maxIterations) {
            if (current >= periodStart) {
                dates.push(new Date(current));
            }
            
            // Advance to next occurrence
            switch (pattern.frequency) {
                case 'DAILY':
                    current.setDate(current.getDate() + pattern.interval);
                    break;
                case 'MONTHLY':
                    current.setMonth(current.getMonth() + pattern.interval);
                    break;
                default:
                    throw new Error(`Unsupported recurrence frequency: ${pattern.frequency}`);
            }
            
            iterations++;
        }
        
        return dates;
    }

    parseICalDate(icalDate) {
        if (!icalDate) return new Date();
        
        // Check if the date has timezone information
        let timezone = null;
        let dateStr = icalDate;
        let wasUTC = false; // Track if the original date was in UTC format
        
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
            wasUTC = isUTC; // Store for debugging
            const cleanDate = dateStr.replace(/[TZ]/g, '');
            
            if (cleanDate.length >= 8) {
                const year = parseInt(cleanDate.substring(0, 4));
                const month = parseInt(cleanDate.substring(4, 6));
                const day = parseInt(cleanDate.substring(6, 8));
                const hour = parseInt(cleanDate.substring(8, 10) || '00');
                const minute = parseInt(cleanDate.substring(10, 12) || '00');
                const second = parseInt(cleanDate.substring(12, 14) || '00');
                
                let date;
                
                if (isUTC) {
                    // UTC time - create date in UTC first
                    date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
                    
                    // Convert UTC to calendar timezone if we have timezone data
                    if (this.timezoneData && this.calendarTimezone === this.timezoneData.tzid) {
                        // Get the appropriate offset (daylight or standard) for this date
                        const offset = this.getTimezoneOffsetForDate(date);
                        if (offset !== null) {
                            // Convert from UTC to calendar timezone
                            const calendarOffset = this.parseOffsetString(offset);
                            
                            // Calculate the local time by applying the offset
                            const utcTime = date.getTime();
                            const localTime = utcTime + (calendarOffset * 60 * 1000);
                            
                            // Create a new local Date object with the converted time components
                            const tempDate = new Date(localTime);
                            
                            // Extract the converted time components
                            const localYear = tempDate.getUTCFullYear();
                            const localMonth = tempDate.getUTCMonth();
                            const localDay = tempDate.getUTCDate();
                            const localHour = tempDate.getUTCHours();
                            const localMinute = tempDate.getUTCMinutes();
                            const localSecond = tempDate.getUTCSeconds();
                            
                            // Create a LOCAL date object (not UTC) with these components
                            date = new Date(localYear, localMonth, localDay, localHour, localMinute, localSecond);
                            
                            logger.debug('CALENDAR', 'Converted UTC to calendar timezone (creating local date object)', {
                                originalUTC: `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} UTC`,
                                calendarTimezone: this.calendarTimezone,
                                calendarOffset: offset,
                                offsetMinutes: calendarOffset,
                                convertedLocal: `${localYear}-${(localMonth + 1).toString().padStart(2, '0')}-${localDay.toString().padStart(2, '0')} ${localHour.toString().padStart(2, '0')}:${localMinute.toString().padStart(2, '0')}`,
                                resultDate: date.toString(),
                                resultISO: date.toISOString(),
                                note: 'Created local Date object for display in user\'s timezone'
                            });
                        }
                    } else if (this.calendarTimezone) {
                        // No VTIMEZONE data but we have calendar timezone from X-WR-TIMEZONE
                        // Convert UTC to calendar timezone using browser's Intl API
                        try {
                            // Use Intl.DateTimeFormat to convert UTC time to calendar timezone
                            const formatter = new Intl.DateTimeFormat('en-CA', {
                                timeZone: this.calendarTimezone,
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                hour12: false
                            });
                            
                            const parts = formatter.formatToParts(date);
                            const localYear = parseInt(parts.find(p => p.type === 'year').value);
                            const localMonth = parseInt(parts.find(p => p.type === 'month').value) - 1; // JavaScript months are 0-based
                            const localDay = parseInt(parts.find(p => p.type === 'day').value);
                            const localHour = parseInt(parts.find(p => p.type === 'hour').value);
                            const localMinute = parseInt(parts.find(p => p.type === 'minute').value);
                            const localSecond = parseInt(parts.find(p => p.type === 'second').value);
                            
                            // Create a new local Date object with the converted time components
                            date = new Date(localYear, localMonth, localDay, localHour, localMinute, localSecond);
                            
                            logger.debug('CALENDAR', 'Converted UTC to calendar timezone using Intl API', {
                                originalUTC: `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} UTC`,
                                calendarTimezone: this.calendarTimezone,
                                convertedLocal: `${localYear}-${(localMonth + 1).toString().padStart(2, '0')}-${localDay.toString().padStart(2, '0')} ${localHour.toString().padStart(2, '0')}:${localMinute.toString().padStart(2, '0')}`,
                                resultDate: date.toString(),
                                resultISO: date.toISOString(),
                                note: 'Used Intl API for timezone conversion'
                            });
                            
                        } catch (error) {
                            logger.warn('CALENDAR', 'Failed to convert timezone using Intl API, using UTC date', {
                                error: error.message,
                                calendarTimezone: this.calendarTimezone
                            });
                        }
                    } else {
                        // No timezone data available at all
                        logger.debug('CALENDAR', 'UTC date without timezone conversion (no timezone info)', {
                            utcTime: `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} UTC`,
                            resultDate: date.toString(),
                            resultISO: date.toISOString(),
                            note: 'No calendar timezone data available for conversion'
                        });
                    }
                } else {
                    // Non-UTC time - this is already in the calendar's timezone, create as local date
                    date = new Date(year, month - 1, day, hour, minute, second);
                    
                    // No conversion needed - JavaScript will display this correctly in user's local timezone
                    logger.debug('CALENDAR', 'Calendar timezone time (created as local date object)', {
                        calendarTime: `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
                        timezone: timezone || this.calendarTimezone || 'Floating (no timezone)',
                        localDisplay: date.toLocaleString(),
                        resultDate: date.toString(),
                        note: 'Time is in calendar timezone, created as local date for correct display'
                    });
                }
                
                // Store wasUTC flag on the date object for debugging
                date._wasUTC = wasUTC;
                
                return date;
            }
        } else if (dateStr.length === 8) {
            // Date only format: YYYYMMDD (all-day event)
            const year = dateStr.substring(0, 4);
            const month = dateStr.substring(4, 6);
            const day = dateStr.substring(6, 8);
            
            const date = new Date(`${year}-${month}-${day}T00:00:00`);
            date._wasUTC = false; // All-day events are not UTC
            
            return date;
        }
        
        const fallbackDate = new Date();
        fallbackDate._wasUTC = false;
        return fallbackDate;
    }
    
    // Get the timezone offset for a specific date (returns the offset string like "-0700" or "-0800")
    getTimezoneOffsetForDate(date) {
        if (!this.timezoneData) return null;
        
        // Determine if we're in daylight or standard time
        const isDaylight = this.isInDaylightTime(date);
        const timezoneSection = isDaylight ? this.timezoneData.daylight : this.timezoneData.standard;
        
        return timezoneSection ? timezoneSection.offsetTo : null;
    }
    
    // Parse offset string (e.g., "-0700") to minutes
    parseOffsetString(offsetStr) {
        if (!offsetStr) return 0;
        
        const match = offsetStr.match(/^([+-])(\d{2})(\d{2})$/);
        if (!match) return 0;
        
        const sign = match[1] === '+' ? 1 : -1;
        const hours = parseInt(match[2]);
        const minutes = parseInt(match[3]);
        
        // Return offset in minutes
        // For -0700: returns -420 (7 hours behind UTC)
        // For +0530: returns +330 (5.5 hours ahead of UTC)
        return sign * (hours * 60 + minutes);
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
        
        // Calculate the date
        const firstDay = new Date(year, month - 1, 1);
        const firstDayOfWeek = firstDay.getDay();
        
        let targetDate;
        if (occurrence > 0) {
            // Positive occurrence (1st, 2nd, 3rd, etc.)
            let daysUntilTarget = (targetDayOfWeek - firstDayOfWeek + 7) % 7;
            if (daysUntilTarget === 0 && occurrence > 1) daysUntilTarget = 7;
            
            targetDate = new Date(year, month - 1, 1 + daysUntilTarget + (occurrence - 1) * 7);
        } else {
            // Negative occurrence (last, second-to-last, etc.)
            const lastDay = new Date(year, month, 0);
            const lastDayOfWeek = lastDay.getDay();
            
            let daysFromEnd = (lastDayOfWeek - targetDayOfWeek + 7) % 7;
            if (daysFromEnd === 0 && occurrence < -1) daysFromEnd = 7;
            
            targetDate = new Date(year, month - 1, lastDay.getDate() - daysFromEnd + (occurrence + 1) * 7);
        }
        
        // Add time component from DTSTART if available
        if (this.timezoneData.daylight && this.timezoneData.daylight.dtstart) {
            const timeMatch = this.timezoneData.daylight.dtstart.match(/T(\d{2})(\d{2})(\d{2})/);
            if (timeMatch) {
                targetDate.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), parseInt(timeMatch[3]));
            }
        }
        
        return targetDate;
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
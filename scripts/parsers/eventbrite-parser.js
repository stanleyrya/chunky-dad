// ============================================================================
// EVENTBRITE PARSER - PURE PARSING LOGIC
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE parsing logic only
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Pure JavaScript parsing functions (HTML/JSON processing)
// ✅ Venue-specific extraction logic
// ✅ Date/time parsing and formatting
// ✅ Event object creation and validation
//
// ❌ NEVER ADD THESE TO THIS FILE:
// ❌ Environment detection (typeof importModule, typeof window, typeof DOMParser)
// ❌ HTTP requests (receive HTML data, don't fetch it)
// ❌ Calendar operations (return event objects, don't save them)
// ❌ Scriptable APIs (Request, Calendar, FileManager, Alert)
// ❌ DOM APIs that don't work in all environments
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

class EventbriteParser {
    constructor(config = {}) {
        this.config = {
            source: 'eventbrite',
            maxAdditionalUrls: 20,
            ...config
        };
        
        this.bearKeywords = [
            'megawoof', 'bear', 'bears', 'woof', 'grr', 'furry', 'hairy',
            'daddy', 'cub', 'otter', 'leather', 'muscle bear', 'bearracuda',
            'furball', 'leather bears', 'bear night', 'bear party'
        ];
    }

    // Main parsing method - receives HTML data and returns events + additional links
    parseEvents(htmlData, parserConfig = {}, cityConfig = null) {
        try {
            const events = [];
            const html = htmlData.html;
            
            if (!html) {
                console.warn('🎫 Eventbrite: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }
            
            // Extract events from embedded JSON data (modern Eventbrite approach - JSON only)
            const jsonEvents = this.extractEventsFromJson(html, parserConfig, htmlData, cityConfig);
            if (jsonEvents.length > 0) {
                console.log(`🎫 Eventbrite: Found ${jsonEvents.length} events in embedded JSON data`);
                events.push(...jsonEvents);
            } else {
                console.log('🎫 Eventbrite: No events found in JSON data - checking __NEXT_DATA__');
                const nextDataEvents = this.extractEventsFromNextData(html, parserConfig, htmlData, cityConfig);
                if (nextDataEvents.length > 0) {
                    console.log(`🎫 Eventbrite: Found ${nextDataEvents.length} events in __NEXT_DATA__ payload`);
                    events.push(...nextDataEvents);
                } else {
                    console.log('🎫 Eventbrite: No events found in __NEXT_DATA__ - checking JSON-LD');
                    const jsonLdEvents = this.extractEventsFromJsonLd(html, parserConfig, htmlData, cityConfig);
                    if (jsonLdEvents.length > 0) {
                        console.log(`🎫 Eventbrite: Found ${jsonLdEvents.length} events in JSON-LD data`);
                        events.push(...jsonLdEvents);
                    } else {
                        console.log('🎫 Eventbrite: No events found in JSON-LD data - this may be an individual event page with unsupported data');
                    }
                }
            }
            
            // Extract additional URLs if urlDiscoveryDepth > 0 (depth checking is handled by shared-core)
            let additionalLinks = [];
            if (parserConfig.urlDiscoveryDepth > 0) {
                additionalLinks = this.extractAdditionalUrls(html, htmlData.url, parserConfig);
            }
            
            console.log(`🎫 Eventbrite: Found ${events.length} events, ${additionalLinks.length} additional links`);
            
            return {
                events: events,
                additionalLinks: additionalLinks,
                source: this.config.source,
                url: htmlData.url
            };
            
        } catch (error) {
            console.error(`🎫 Eventbrite: Error parsing events: ${error}`);
            return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
        }
    }

    // Helper method to extract a complete JSON object by matching braces
    extractJsonObject(html, startIndex) {
        let braceCount = 0;
        let inString = false;
        let i = startIndex;
        
        // Find the opening brace
        while (i < html.length && html[i] !== '{') {
            i++;
        }
        
        if (i >= html.length) {
            return null;
        }
        braceCount = 1;
        i++;
        
        // Track through the JSON to find the matching closing brace
        while (i < html.length && braceCount > 0) {
            const char = html[i];
            const prevChar = i > 0 ? html[i - 1] : '';
            
            // Handle string state more carefully
            if (char === '"') {
                // Count the number of preceding backslashes
                let backslashCount = 0;
                let j = i - 1;
                while (j >= 0 && html[j] === '\\') {
                    backslashCount++;
                    j--;
                }
                
                // If there's an even number of backslashes (including 0), the quote is not escaped
                if (backslashCount % 2 === 0) {
                    inString = !inString;
                }
            } else if (!inString) {
                if (char === '{') {
                    braceCount++;
                } else if (char === '}') {
                    braceCount--;
                }
            }
            
            i++;
        }
        
        if (braceCount === 0) {
            // Find the semicolon that ends the statement
            let endIndex = i;
            while (endIndex < html.length && html[endIndex] !== ';') {
                endIndex++;
            }
            
            let jsonString = html.substring(startIndex, i);
            
            // Clean up control characters that can break JSON parsing
            // Properly escape control characters that need to be escaped in JSON strings
            jsonString = this.escapeJsonControlCharacters(jsonString);
            
            return jsonString;
        }
        
        return null;
    }

    // Properly escape control characters in JSON strings
    escapeJsonControlCharacters(jsonString) {
        let result = '';
        let inString = false;
        let i = 0;
        
        while (i < jsonString.length) {
            const char = jsonString[i];
            const code = char.charCodeAt(0);
            
            // Track string state
            if (char === '"') {
                // Count preceding backslashes to determine if this quote is escaped
                let backslashCount = 0;
                let j = i - 1;
                while (j >= 0 && jsonString[j] === '\\') {
                    backslashCount++;
                    j--;
                }
                // If even number of backslashes (including 0), quote is not escaped
                if (backslashCount % 2 === 0) {
                    inString = !inString;
                }
            }
            
            // If we're inside a string, escape control characters
            if (inString && code < 32) {
                switch (code) {
                    case 8: result += '\\b'; break;  // backspace
                    case 9: result += '\\t'; break;  // tab
                    case 10: result += '\\n'; break; // newline
                    case 12: result += '\\f'; break; // form feed
                    case 13: result += '\\r'; break; // carriage return
                    default:
                        // Other control characters - use unicode escape
                        result += '\\u' + code.toString(16).padStart(4, '0');
                        break;
                }
            } else {
                result += char;
            }
            
            i++;
        }
        
        return result;
    }

    // Extract events from embedded JSON data (modern Eventbrite)
    extractEventsFromJson(html, parserConfig = {}, htmlData = null, cityConfig = null) {
        const events = [];
        
        try {
            // Look for window.__SERVER_DATA__ which contains the event information
            // Use a more robust approach to extract the JSON by finding the start and matching braces
            const startPattern = /window\.__SERVER_DATA__\s*=\s*/;
            const startMatch = html.match(startPattern);
            
            if (startMatch) {
                const startIndex = startMatch.index + startMatch[0].length;
                const jsonString = this.extractJsonObject(html, startIndex);
                
                if (jsonString) {
                    try {
                        const serverData = JSON.parse(jsonString);
                        console.log('🎫 Eventbrite: Found window.__SERVER_DATA__');
                    
                    // Check for events in view_data.events.future_events (organizer pages)
                    if (serverData.view_data && serverData.view_data.events && serverData.view_data.events.future_events) {
                        const futureEvents = serverData.view_data.events.future_events;
                        console.log(`🎫 Eventbrite: Found ${futureEvents.length} future events in JSON data (organizer page)`);
                        
                        futureEvents.forEach(eventData => {
                            if (eventData.url && eventData.name && (eventData.name.text || typeof eventData.name === 'string')) {
                                // Double-check that it's actually a future event
                                if (this.isFutureEvent(eventData)) {
                                    const event = this.parseJsonEvent(eventData, null, parserConfig, serverData, cityConfig);
                                    if (event) {
                                        events.push(event);
                                        console.log(`🎫 Eventbrite: Parsed future event: ${event.title} (${event.startDate || event.date})`);
                                    }
                                } else {
                                    const eventName = eventData.name?.text || eventData.name || 'Unknown';
                                    console.log(`🎫 Eventbrite: Skipping non-future event from future_events: ${eventName}`);
                                }
                            }
                        });
                        
                        // If we found future events, return them and skip other patterns
                        if (events.length > 0) {
                            console.log(`🎫 Eventbrite: Successfully extracted ${events.length} future events from JSON data`);
                            return events;
                        }
                    }
                    
                    // Check for individual event data (individual event pages)
                    console.log('🎫 Eventbrite: Debug - serverData top-level keys:', Object.keys(serverData));
                    
                    if (serverData.event) {
                        console.log('🎫 Eventbrite: Found individual event data in JSON');
                        const eventData = serverData.event;
                        
                        // Detail pages have different field structure - adapt the event data
                        const adaptedEventData = {
                            ...eventData,
                            // Ensure we have the required fields for validation
                            url: eventData.url || htmlData.url, // fallback to current page URL
                            name: eventData.name || eventData.title || '', // detail pages have name as string
                            // Map date fields from detail page format
                            start: eventData.start || eventData.startDate,
                            end: eventData.end || eventData.endDate
                        };
                        
                        // More lenient validation for detail pages
                        const hasRequiredFields = adaptedEventData.name && (adaptedEventData.url || htmlData.url);
                        const isFuture = this.isFutureEvent(adaptedEventData);
                        
                        console.log(`🎫 Eventbrite: Detail page validation - hasFields: ${hasRequiredFields}, isFuture: ${isFuture}, name: "${adaptedEventData.name}"`);
                        
                        if (hasRequiredFields && isFuture) {
                            const event = this.parseJsonEvent(adaptedEventData, null, parserConfig, serverData, cityConfig);
                            if (event) {
                                events.push(event);
                                console.log(`🎫 Eventbrite: Parsed individual event: ${event.title} (${event.startDate || event.date})`);
                            } else {
                                console.log('🎫 Eventbrite: parseJsonEvent returned null for detail page event');
                            }
                        } else {
                            const reasons = [];
                            if (!hasRequiredFields) reasons.push('missing required fields');
                            if (!isFuture) reasons.push('not a future event');
                            console.log(`🎫 Eventbrite: Skipping individual event: ${reasons.join(', ')}`);
                        }
                        
                        if (events.length > 0) {
                            console.log(`🎫 Eventbrite: Successfully extracted individual event from JSON data`);
                            return events;
                        }
                    } else {
                        console.log('🎫 Eventbrite: No serverData.event found in detail page');
                        
                        // Check for alternative event data locations in detail pages
                        if (serverData.event_listing_response) {
                            console.log('🎫 Eventbrite: Found event_listing_response, keys:', Object.keys(serverData.event_listing_response));
                        }
                        
                        // Check if event data is nested elsewhere
                        if (serverData.components && serverData.components.eventDetails) {
                            console.log('🎫 Eventbrite: Found components.eventDetails, keys:', Object.keys(serverData.components.eventDetails));
                        }
                        
                        // Log a sample of available data for debugging
                        console.log('🎫 Eventbrite: Available serverData structure for debugging:');
                        console.log('🎫 Eventbrite: - event:', !!serverData.event);
                        console.log('🎫 Eventbrite: - event_listing_response:', !!serverData.event_listing_response);
                        console.log('🎫 Eventbrite: - components:', !!serverData.components);
                        if (serverData.components) {
                            console.log('🎫 Eventbrite: - components keys:', Object.keys(serverData.components));
                        }
                    }
                    
                    // Also check for past events if needed for debugging (but don't include them)
                    if (serverData.view_data && serverData.view_data.events && serverData.view_data.events.past_events) {
                        const pastEvents = serverData.view_data.events.past_events;
                        console.log(`🎫 Eventbrite: Found ${pastEvents.length} past events in JSON data (not included)`);
                    }
                    
                    } catch (parseError) {
                        console.warn(`🎫 Eventbrite: Failed to parse window.__SERVER_DATA__: ${parseError.message}`);
                        console.warn(`🎫 Eventbrite: JSON parse error at position: ${parseError.message.includes('position') ? parseError.message : 'unknown'}`);
                    }
                } else {
                    console.warn('🎫 Eventbrite: Could not extract valid JSON from window.__SERVER_DATA__');
                                }
            }
        } catch (error) {
            console.warn(`🎫 Eventbrite: Error extracting JSON events: ${error}`);
        }
        
        return events;
    }

    // Extract events from Next.js __NEXT_DATA__ payload (detail pages)
    extractEventsFromNextData(html, parserConfig = {}, htmlData = null, cityConfig = null) {
        const events = [];
        
        try {
            const scriptMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
            if (!scriptMatch) {
                return events;
            }
            
            const jsonText = (scriptMatch[1] || '').trim();
            if (!jsonText) {
                return events;
            }
            
            let nextData;
            try {
                nextData = JSON.parse(jsonText);
            } catch (error) {
                console.warn(`🎫 Eventbrite: Failed to parse __NEXT_DATA__ payload: ${error}`);
                return events;
            }
            
            const context = nextData?.props?.pageProps?.context;
            const basicInfo = context?.basicInfo;
            if (!basicInfo || !basicInfo.name) {
                return events;
            }
            
            const description = this.extractNextDataDescription(context) || basicInfo.summary || '';
            const venueAddress = this.buildNextDataVenueAddress(basicInfo.venue?.address);
            const imageUrl = this.extractNextDataImage(context);
            
            const eventData = {
                name: basicInfo.name || '',
                description: description,
                url: basicInfo.url || (htmlData ? htmlData.url : ''),
                start: basicInfo.startDate || null,
                end: basicInfo.endDate || null,
                venue: basicInfo.venue ? {
                    name: basicInfo.venue.name || '',
                    ...(venueAddress ? { address: venueAddress } : {})
                } : undefined,
                ...(imageUrl ? { image: { url: imageUrl } } : {})
            };
            
            const event = this.parseJsonEvent(eventData, null, parserConfig, null, cityConfig);
            if (event) {
                events.push(event);
                console.log(`🎫 Eventbrite: Parsed event from __NEXT_DATA__ payload: ${event.title}`);
            } else {
                console.log('🎫 Eventbrite: parseJsonEvent returned null for __NEXT_DATA__ event');
            }
        } catch (error) {
            console.warn(`🎫 Eventbrite: Error extracting __NEXT_DATA__ events: ${error}`);
        }
        
        return events;
    }

    extractNextDataDescription(context) {
        if (!context || typeof context !== 'object') {
            return '';
        }
        
        const modules = context.structuredContent?.modules;
        if (!Array.isArray(modules)) {
            return '';
        }
        
        const textBlocks = modules
            .filter(module => module && module.type === 'text' && module.text)
            .map(module => this.stripHtml(module.text))
            .filter(text => text);
        
        return textBlocks.join('\n\n').trim();
    }

    extractNextDataImage(context) {
        if (!context || typeof context !== 'object') {
            return '';
        }
        
        const images = context.gallery?.images;
        if (!Array.isArray(images) || images.length === 0) {
            return '';
        }
        
        const image = images[0] || {};
        return image.croppedLogoUrl600 || image.croppedLogoUrl480 || image.url || '';
    }

    buildNextDataVenueAddress(venueAddress) {
        if (!venueAddress || typeof venueAddress !== 'object') {
            return null;
        }
        
        const lines = Array.isArray(venueAddress.localizedMultiLineAddressDisplay) ?
            venueAddress.localizedMultiLineAddressDisplay.filter(Boolean) : [];
        
        const address = {
            address_1: lines[0] || '',
            city: venueAddress.city || '',
            region: venueAddress.region || '',
            postal_code: '',
            localized_address_display: lines.length > 0 ? lines.join(', ') : ''
        };
        
        if (lines[1]) {
            const parsedLine = this.parseCityRegionLine(lines[1]);
            if (parsedLine.city && !address.city) {
                address.city = parsedLine.city;
            }
            if (parsedLine.region && !address.region) {
                address.region = parsedLine.region;
            }
            if (parsedLine.postalCode && !address.postal_code) {
                address.postal_code = parsedLine.postalCode;
            }
        }
        
        if (venueAddress.latitude && venueAddress.longitude) {
            address.latitude = parseFloat(venueAddress.latitude);
            address.longitude = parseFloat(venueAddress.longitude);
        }
        
        return address;
    }

    parseCityRegionLine(line) {
        const result = { city: '', region: '', postalCode: '' };
        if (!line || typeof line !== 'string') {
            return result;
        }
        
        const match = line.match(/^(.+?),\s*([A-Za-z]{2})\s*(\d{5})?/);
        if (match) {
            result.city = match[1].trim();
            result.region = match[2].trim();
            if (match[3]) {
                result.postalCode = match[3].trim();
            }
        }
        
        return result;
    }

    extractMetaDescription(html) {
        if (!html || typeof html !== 'string') {
            return '';
        }
        
        const ogDescription = this.extractMetaTagContent(html, 'property', 'og:description');
        if (ogDescription) {
            return ogDescription;
        }
        
        return this.extractMetaTagContent(html, 'name', 'description');
    }

    extractMetaTagContent(html, attribute, value) {
        const metaRegex = new RegExp(`<meta[^>]*${attribute}=["']${value}["'][^>]*>`, 'i');
        const metaMatch = html.match(metaRegex);
        if (!metaMatch) {
            return '';
        }
        
        const tag = metaMatch[0];
        const contentMatch = tag.match(/content=["']([^"']+)["']/i);
        if (!contentMatch) {
            return '';
        }
        
        return this.decodeHtmlEntities(contentMatch[1]).trim();
    }

    stripHtml(html) {
        if (!html || typeof html !== 'string') {
            return '';
        }
        
        let text = html
            .replace(/<\s*br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<\/div>/gi, '\n')
            .replace(/<[^>]+>/g, '');
        
        text = this.decodeHtmlEntities(text);
        text = text.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
        
        return text.trim();
    }

    decodeHtmlEntities(text) {
        if (!text || typeof text !== 'string') {
            return '';
        }
        
        return text
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'");
    }

    // Extract events from JSON-LD data (fallback for detail pages without __SERVER_DATA__)
    extractEventsFromJsonLd(html, parserConfig = {}, htmlData = null, cityConfig = null) {
        const events = [];
        
        try {
            const metaDescription = this.extractMetaDescription(html);
            const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
            let match;
            
            while ((match = scriptRegex.exec(html)) !== null) {
                const jsonText = (match[1] || '').trim();
                if (!jsonText) {
                    continue;
                }
                
                let data;
                try {
                    data = JSON.parse(jsonText);
                } catch (error) {
                    console.warn(`🎫 Eventbrite: Failed to parse JSON-LD block: ${error}`);
                    continue;
                }
                
                const items = this.collectJsonLdItems(data);
                items.forEach(item => {
                    const event = this.parseJsonLdEvent(item, parserConfig, htmlData, cityConfig, metaDescription);
                    if (event) {
                        events.push(event);
                    }
                });
            }
        } catch (error) {
            console.warn(`🎫 Eventbrite: Error extracting JSON-LD events: ${error}`);
        }
        
        return events;
    }

    // Flatten JSON-LD structures into a list of items
    collectJsonLdItems(data) {
        const items = [];
        
        if (!data) {
            return items;
        }
        
        if (Array.isArray(data)) {
            data.forEach(item => {
                items.push(...this.collectJsonLdItems(item));
            });
            return items;
        }
        
        if (data['@graph']) {
            return this.collectJsonLdItems(data['@graph']);
        }
        
        items.push(data);
        return items;
    }

    // Parse JSON-LD event data into standard format
    parseJsonLdEvent(jsonLd, parserConfig = {}, htmlData = null, cityConfig = null, metaDescription = '') {
        try {
            if (!jsonLd || typeof jsonLd !== 'object') {
                return null;
            }
            
            const rawType = jsonLd['@type'];
            const types = Array.isArray(rawType) ? rawType : [rawType].filter(Boolean);
            const isEventType = types.some(type => String(type).toLowerCase().includes('event'));
            
            if (!isEventType) {
                return null;
            }
            
            const title = jsonLd.name || jsonLd.headline || '';
            const url = jsonLd.url || (htmlData ? htmlData.url : '');
            const startDate = jsonLd.startDate || '';
            const endDate = jsonLd.endDate || '';
            const jsonLdDescription = this.normalizeText(jsonLd.description || '');
            const fallbackDescription = this.normalizeText(metaDescription);
            const description = jsonLdDescription.length > 60 ? jsonLdDescription : (fallbackDescription || jsonLdDescription);
            
            if (!title || !url) {
                console.log(`🎫 Eventbrite: JSON-LD event missing title or URL (title: "${title}", url: "${url}")`);
                return null;
            }
            
            const isFuture = this.isFutureEvent({ startDate: startDate });
            if (!isFuture) {
                console.log(`🎫 Eventbrite: Skipping JSON-LD event (not future): "${title}"`);
                return null;
            }
            
            const location = Array.isArray(jsonLd.location) ? jsonLd.location[0] : jsonLd.location;
            const address = location && location.address ? location.address : null;
            const geo = location && location.geo ? location.geo : null;
            
            let streetAddress = address ? address.streetAddress || '' : '';
            if (streetAddress && streetAddress.includes(',')) {
                streetAddress = streetAddress.split(',')[0].trim();
            }
            
            const venueAddress = address ? {
                address_1: streetAddress || address.streetAddress || '',
                city: address.addressLocality || '',
                region: address.addressRegion || '',
                postal_code: address.postalCode || ''
            } : null;
            
            const imageValue = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;
            
            const eventData = {
                name: title,
                description: description,
                url: url,
                startDate: startDate,
                endDate: endDate,
                venue: location ? {
                    name: location.name || '',
                    ...(venueAddress ? { address: venueAddress } : {})
                } : undefined,
                ...(imageValue ? { image: { url: imageValue } } : {})
            };
            
            if (geo && geo.latitude && geo.longitude) {
                eventData.venue = eventData.venue || { name: location ? location.name || '' : '' };
                eventData.venue.latitude = parseFloat(geo.latitude);
                eventData.venue.longitude = parseFloat(geo.longitude);
            }
            
            const event = this.parseJsonEvent(eventData, null, parserConfig, null, cityConfig);
            if (!event) {
                console.log(`🎫 Eventbrite: parseJsonEvent returned null for JSON-LD event "${title}"`);
            }
            
            return event;
        } catch (error) {
            console.warn(`🎫 Eventbrite: Failed to parse JSON-LD event: ${error}`);
            return null;
        }
    }

    normalizeText(text) {
        if (!text || typeof text !== 'string') {
            return '';
        }
        
        return this.decodeHtmlEntities(text)
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Check if an event is in the future (not past)
    isFutureEvent(eventData) {
        const now = new Date();
        let startDate = eventData.start?.utc || eventData.start_date || eventData.startDate || eventData.start;
        
        // Handle detail page timezone format: {timezone: "America/Denver", local: "...", utc: "..."}
        if (typeof startDate === 'object' && startDate.utc) {
            startDate = startDate.utc;
        }
        
        if (!startDate) {
            // If no start date, assume it might be future and let it through
            console.warn(`🎫 Eventbrite: No start date found for event, assuming future`);
            return true;
        }
        
        try {
            const eventDate = new Date(startDate);
            const isFuture = eventDate > now;
            console.log(`🎫 Eventbrite: Date check - event: ${eventDate.toISOString()}, now: ${now.toISOString()}, isFuture: ${isFuture}`);
            return isFuture;
        } catch (error) {
            console.warn(`🎫 Eventbrite: Invalid date format: ${startDate}, error: ${error}`);
            return true; // If we can't parse the date, let it through
        }
    }

    // Parse a JSON event object into our standard format
    parseJsonEvent(eventData, htmlContext = null, parserConfig = {}, serverData = null, cityConfig = null) {
        try {
            // Handle both organizer page format (name.text) and detail page format (name as string)
            const title = eventData.name?.text || eventData.name || eventData.title || '';
            
            // Get description from multiple sources, including detail page components
            let description = eventData.description || eventData.summary || '';
            if (!description && serverData && serverData.components && serverData.components.eventDescription && serverData.components.eventDescription.summary) {
                description = serverData.components.eventDescription.summary;
            }
            
            // Handle both organizer page format (start.utc) and detail page format (start as string)
            // Detail pages may have start/end as timezone objects with utc field
            let startDate = eventData.start?.utc || eventData.start_date || eventData.startDate || eventData.start;
            let endDate = eventData.end?.utc || eventData.end_date || eventData.endDate || eventData.end;
            
            // Extract original timezone from event data (preserve Eventbrite's timezone)
            let originalTimezone = null;
            if (eventData.start?.timezone) {
                originalTimezone = eventData.start.timezone;
                console.log(`🎫 Eventbrite: Found original timezone in event data: ${originalTimezone}`);
            } else if (eventData.end?.timezone) {
                originalTimezone = eventData.end.timezone;
                console.log(`🎫 Eventbrite: Found original timezone in end data: ${originalTimezone}`);
            }
            
            // Handle detail page timezone format: {timezone: "America/Denver", local: "...", utc: "..."}
            if (typeof startDate === 'object' && startDate.utc) {
                startDate = startDate.utc;
            }
            if (typeof endDate === 'object' && endDate.utc) {
                endDate = endDate.utc;
            }
            
            console.log(`🎫 Eventbrite: Date processing for "${title}": start="${startDate}", end="${endDate}"`);
            const url = eventData.url || eventData.vanity_url || '';
            
            // Enhanced venue processing - get both name and address from multiple sources
            let venue = null;
            let address = null;
            let coordinates = null;
            
            // First try detail page venue data (from serverData.components.eventMap)
            if (serverData && serverData.components && serverData.components.eventMap) {
                const eventMap = serverData.components.eventMap;
                venue = eventMap.venueName || venue;
                address = eventMap.venueAddress || address;
                
                // Extract coordinates from detail page location data
                if (eventMap.location && eventMap.location.latitude && eventMap.location.longitude) {
                    coordinates = {
                        lat: eventMap.location.latitude,
                        lng: eventMap.location.longitude
                    };
                    console.log(`🎫 Eventbrite: Found coordinates in detail page eventMap for "${title}": ${coordinates.lat}, ${coordinates.lng}`);
                }
                
                if (venue || address) {
                    console.log(`🎫 Eventbrite: Detail page venue data for "${title}": venue="${venue}", address="${address}"`);
                }
            }
            
            // Fallback to standard event venue data if not found in detail page components
            if (eventData.venue) {
                venue = venue || eventData.venue.name;
                
                if (eventData.venue.address && !address) {
                    // Use full structured address if available, fallback to localized display
                    const addr = eventData.venue.address;
                    if (addr.address_1 && addr.city && addr.region) {
                        address = `${addr.address_1}, ${addr.city}, ${addr.region} ${addr.postal_code || ''}`.trim();
                    } else {
                        address = addr.localized_address_display || null;
                    }
                    console.log(`🎫 Eventbrite: Venue details for "${title}": venue="${venue}", address="${address}"`);
                    
                    // Extract coordinates if available and not already found; shared-core will later suppress for placeholders
                    if (!coordinates && eventData.venue.address.latitude && eventData.venue.address.longitude) {
                        coordinates = {
                            lat: eventData.venue.address.latitude,
                            lng: eventData.venue.address.longitude
                        };
                        console.log(`🎫 Eventbrite: Found coordinates in venue.address for "${title}": ${coordinates.lat}, ${coordinates.lng}`);
                    }
                    
                    // Also check venue-level coordinates (sometimes more accurate)
                    if (!coordinates && eventData.venue.latitude && eventData.venue.longitude) {
                        coordinates = {
                            lat: parseFloat(eventData.venue.latitude),
                            lng: parseFloat(eventData.venue.longitude)
                        };
                        console.log(`🎫 Eventbrite: Found coordinates in venue root for "${title}": ${coordinates.lat}, ${coordinates.lng}`);
                    }
                }
            }
            
            // Enhanced price extraction with availability info
            let price = '';
            
            // DEBUG: Log the pricing condition checks
            console.log(`🎫 Eventbrite: Price extraction debug for "${title}":`);
            console.log(`🎫 Eventbrite:   - eventData.is_free: ${eventData.is_free}`);
            console.log(`🎫 Eventbrite:   - eventData.price_range: ${eventData.price_range}`);
            console.log(`🎫 Eventbrite:   - serverData exists: ${!!serverData}`);
            console.log(`🎫 Eventbrite:   - event_listing_response exists: ${!!(serverData && serverData.event_listing_response)}`);
            console.log(`🎫 Eventbrite:   - tickets exists: ${!!(serverData && serverData.event_listing_response && serverData.event_listing_response.tickets)}`);
            console.log(`🎫 Eventbrite:   - ticketClasses exists: ${!!(serverData && serverData.event_listing_response && serverData.event_listing_response.tickets && serverData.event_listing_response.tickets.ticketClasses)}`);
            if (serverData && serverData.event_listing_response && serverData.event_listing_response.tickets && serverData.event_listing_response.tickets.ticketClasses) {
                console.log(`🎫 Eventbrite:   - ticketClasses length: ${serverData.event_listing_response.tickets.ticketClasses.length}`);
            }
            
            if (eventData.is_free) {
                price = 'Free';
                console.log(`🎫 Eventbrite: Taking is_free path for "${title}"`);
            } else if (eventData.price_range) {
                price = eventData.price_range;
                console.log(`🎫 Eventbrite: Taking price_range path for "${title}": ${price}`);
                
                // Add availability hint based on inventory type (applies to all ticket tiers)
                if (eventData.inventory_type === 'limited') {
                    const now = new Date();
                    const month = now.getMonth() + 1;
                    const day = now.getDate();
                    price += ` (as of ${month}/${day})`;
                }
            } else if (serverData && serverData.event_listing_response && serverData.event_listing_response.tickets && serverData.event_listing_response.tickets.ticketClasses) {
                console.log(`🎫 Eventbrite: Taking ticketClasses path for "${title}"`);
                // Detail pages have pricing in tickets.ticketClasses - extract price range
                const ticketClasses = serverData.event_listing_response.tickets.ticketClasses;
                const prices = ticketClasses
                    .filter(tc => tc.totalCost && tc.totalCost.display)
                    .map(tc => parseFloat(tc.totalCost.majorValue))
                    .filter(p => !isNaN(p))
                    .sort((a, b) => a - b);
                
                if (prices.length > 0) {
                    const minPrice = prices[0];
                    const maxPrice = prices[prices.length - 1];
                    const currency = ticketClasses[0]?.totalCost?.currency || 'USD';
                    
                    if (minPrice === maxPrice) {
                        price = `$${minPrice.toFixed(2)}`;
                    } else {
                        price = `$${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`;
                    }
                    
                    // Add availability hint for detail pages
                    const now = new Date();
                    const month = now.getMonth() + 1;
                    const day = now.getDate();
                    price += ` (as of ${month}/${day})`;
                    
                    console.log(`🎫 Eventbrite: Extracted price range from detail page for "${title}": ${price}`);
                } else {
                    console.log(`🎫 Eventbrite: Detail page ticketClasses found but no valid prices extracted for "${title}"`);
                }
            } else {
                console.log(`🎫 Eventbrite: Taking else path (no pricing conditions met) for "${title}"`);
                
                // Try alternative pricing sources in detail pages
                let foundAlternativePrice = false;
                
                // Check if pricing info is in components.eventDetails or other locations
                if (serverData?.components?.eventDetails) {
                    console.log(`🎫 Eventbrite: Checking components.eventDetails for pricing info for "${title}"`);
                    // This is where we might find alternative pricing data in the future
                }
                
                if (!foundAlternativePrice) {
                    console.log(`🎫 Eventbrite: No pricing information found in detail page for "${title}" - returning empty price`);
                }
            }
            
            console.log(`🎫 Eventbrite: Final price result for "${title}": "${price}"`);
            let image = eventData.logo?.url || eventData.image?.url;
            
            // NEW: Try to get image from eventHero if not found in eventData
            if (!image && serverData && serverData.event_listing_response && serverData.event_listing_response.eventHero && serverData.event_listing_response.eventHero.items && serverData.event_listing_response.eventHero.items[0]) {
                const heroItem = serverData.event_listing_response.eventHero.items[0];
                image = heroItem.croppedLogoUrl600 || heroItem.croppedLogoUrl480 || heroItem.croppedLogoUrl940;
                console.log(`🎫 Eventbrite: Found image in eventHero for "${title}": ${image}`);
            }
            
            // Don't generate Google Maps URL here - let SharedCore handle it with iOS-compatible logic
            // Just pass the place_id data to SharedCore for processing
            // Leave gmaps undefined so SharedCore will generate the URL
            if (eventData.venue?.google_place_id) {
                console.log(`🎫 Eventbrite: Passing place_id "${eventData.venue.google_place_id}" to SharedCore for iOS-compatible URL generation for "${title}"`);
            }
            
            // NEW: Try to get venue data from components if not found in eventData
            let finalVenue = venue;
            let finalAddress = address;
            let finalCoordinates = coordinates;
            let finalPlaceId = eventData.venue?.google_place_id || null;
            
            // Check components.eventMap for venue data
            if (serverData && serverData.components && serverData.components.eventMap) {
                const mapData = serverData.components.eventMap;
                if (!finalVenue && mapData.venueName) {
                    finalVenue = mapData.venueName;
                    console.log(`🎫 Eventbrite: Found venue name in components.eventMap: "${finalVenue}"`);
                }
                if (!finalAddress && mapData.venueAddress) {
                    finalAddress = mapData.venueAddress;
                    console.log(`🎫 Eventbrite: Found venue address in components.eventMap: "${finalAddress}"`);
                }
                if (!finalCoordinates && mapData.location) {
                    finalCoordinates = {
                        lat: mapData.location.latitude,
                        lng: mapData.location.longitude
                    };
                    console.log(`🎫 Eventbrite: Found coordinates in components.eventMap for "${title}": ${finalCoordinates.lat}, ${finalCoordinates.lng}`);
                }
            }
            
            // Check components.eventDetails.location for additional venue data
            if (serverData && serverData.components && serverData.components.eventDetails && serverData.components.eventDetails.location) {
                const detailsLocation = serverData.components.eventDetails.location;
                if (detailsLocation.localityPlaceId && !finalPlaceId) {
                    finalPlaceId = detailsLocation.localityPlaceId;
                    console.log(`🎫 Eventbrite: Found place_id in components.eventDetails.location: "${finalPlaceId}"`);
                }
            }
            
            // Detect city using centralized city config (scraper-cities.js).
            // Eventbrite timezones are frequently incorrect, so we detect city here
            // to allow timezone correction before SharedCore enrichment.
            const city = this.detectCityFromEventData({
                title: title,
                description: description,
                venue: finalVenue,
                address: finalAddress,
                url: url,
                venueAddress: eventData.venue?.address || null
            }, cityConfig);
            if (city) {
                console.log(`🎫 Eventbrite: Detected city "${city}" from event data for "${title}"`);
            }

            // Determine timezone: prefer city-based timezone when available, fallback to original Eventbrite timezone
            // This fixes cases where Eventbrite has incorrect timezone but parser correctly detects city
            let eventTimezone = null;
            let needsTimeConversion = false;
            
            if (city) {
                eventTimezone = this.getTimezoneForCity(city, cityConfig);
                if (eventTimezone) {
                    console.log(`🎫 Eventbrite: Using city-based timezone for "${title}": ${eventTimezone}`);
                    if (originalTimezone && originalTimezone !== eventTimezone) {
                        console.log(`🎫 Eventbrite: Overriding Eventbrite timezone "${originalTimezone}" with city-based timezone "${eventTimezone}" for "${title}"`);
                        needsTimeConversion = true;
                    }
                }
            }
            
            // When timezone is overridden, convert time assuming the original local time should be preserved
            if (needsTimeConversion && startDate && originalTimezone && eventTimezone) {
                try {
                    console.log(`🎫 Eventbrite: Converting time from ${originalTimezone} to ${eventTimezone} for "${title}"`);
                    console.log(`🎫 Eventbrite: Original UTC times - start: ${startDate}, end: ${endDate}`);
                    
                    // Parse the original UTC time
                    const originalStartUTC = new Date(startDate);
                    const originalEndUTC = endDate ? new Date(endDate) : null;
                    
                    // Get what the local time would be in the original timezone
                    const originalLocalFormatted = new Intl.DateTimeFormat('en-CA', {
                        timeZone: originalTimezone,
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    }).format(originalStartUTC);
                    
                    console.log(`🎫 Eventbrite: Original would be ${originalLocalFormatted} in ${originalTimezone}`);
                    
                    // Create a new date with the same local time but in the target timezone
                    // Parse the local time components (handle comma separator)
                    const [datePart, timePart] = originalLocalFormatted.split(', ');
                    const localDateTime = `${datePart}T${timePart}`;
                    
                    // Use proper timezone conversion without hardcoded offsets
                    // The goal: interpret the local time string as if it were in the target timezone
                    
                    // Method: Use the Intl.DateTimeFormat to reverse-engineer the UTC time
                    // that would produce the desired local time in the target timezone
                    
                    const [year, month, day] = datePart.split('-').map(Number);
                    const [hour, minute, second] = timePart.split(':').map(Number);
                    
                    // Create a test date and iteratively find the UTC time that gives us the desired local time
                    let testUTC = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
                    let iterations = 0;
                    const maxIterations = 24; // Should converge quickly
                    let correctedStartUTC;
                    
                    while (iterations < maxIterations) {
                        // Check what local time this UTC time produces in the target timezone
                        const testLocalFormatted = new Intl.DateTimeFormat('en-CA', {
                            timeZone: eventTimezone,
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: false
                        }).format(testUTC);
                        
                        // If it matches our desired local time, we're done
                        if (testLocalFormatted === originalLocalFormatted) {
                            correctedStartUTC = testUTC;
                            break;
                        }
                        
                        // Calculate the difference and adjust
                        const [testDatePart, testTimePart] = testLocalFormatted.split(', ');
                        const testDate = new Date(`${testDatePart}T${testTimePart}`);
                        const targetDate = new Date(`${datePart}T${timePart}`);
                        const diff = targetDate.getTime() - testDate.getTime();
                        
                        testUTC = new Date(testUTC.getTime() + diff);
                        iterations++;
                    }
                    
                    if (iterations >= maxIterations) {
                        console.log(`🎫 Eventbrite: Could not converge on timezone conversion after ${maxIterations} iterations`);
                        // Fallback to original time
                        correctedStartUTC = originalStartUTC;
                    } else {
                        console.log(`🎫 Eventbrite: Converged after ${iterations} iterations`);
                    }
                    
                    startDate = correctedStartUTC.toISOString();
                    
                    // Apply same adjustment to end time if it exists
                    if (originalEndUTC) {
                        const timeDiff = originalEndUTC.getTime() - originalStartUTC.getTime();
                        const correctedEnd = new Date(correctedStartUTC.getTime() + timeDiff);
                        endDate = correctedEnd.toISOString();
                    }
                    
                    console.log(`🎫 Eventbrite: Time converted - start: ${startDate}, end: ${endDate}`);
                    console.log(`🎫 Eventbrite: Local time ${originalLocalFormatted} now properly in ${eventTimezone}`);
                    
                } catch (error) {
                    console.log(`🎫 Eventbrite: Error during time conversion: ${error.message}`);
                }
            }
            
            // Fallback to original Eventbrite timezone if no city-based timezone found
            if (!eventTimezone && originalTimezone) {
                eventTimezone = originalTimezone;
                console.log(`🎫 Eventbrite: Using original Eventbrite timezone for "${title}": ${eventTimezone}`);
            }
            
            if (!eventTimezone) {
                console.log(`🎫 Eventbrite: No timezone found for "${title}"`);
            }
            
            const event = {
                title: title,
                description: description,
                startDate: startDate ? new Date(startDate) : null,
                endDate: endDate ? new Date(endDate) : null,
                bar: finalVenue, // Use 'bar' field name that calendar-core.js expects
                location: finalCoordinates ? `${finalCoordinates.lat}, ${finalCoordinates.lng}` : null, // Store coordinates as "lat, lng" string in location field
                address: finalAddress,
                city: city,
                timezone: eventTimezone,
                // Don't set url field to null - let other parsers (like linktree) provide the URL
                // Only set url if we have a meaningful value, otherwise omit the field entirely
                ticketUrl: url, // For Eventbrite events, the event URL IS the ticket URL
                cover: price, // Use 'cover' field name that calendar-core.js expects
                ...(image && { image: image }), // Only include image if we found one
                // Don't include gmaps here - let SharedCore generate it from placeId
                placeId: finalPlaceId || null, // Pass place_id to SharedCore for iOS-compatible URL generation
                source: this.config.source,
                // Properly handle bear event detection based on configuration
                isBearEvent: this.config.alwaysBear || this.isBearEvent({
                    title: title,
                    description: '',
                    venue: finalVenue,
                    url: url
                })
            };
            
            // Apply source-specific metadata values from config
            if (parserConfig.metadata) {
                Object.keys(parserConfig.metadata).forEach(key => {
                    const metaValue = parserConfig.metadata[key];
                    
                    // Apply value if it exists (source-specific overrides)
                    if (typeof metaValue === 'object' && metaValue !== null && 'value' in metaValue) {
                        event[key] = metaValue.value;
                    }
                });
            }
            
            // Log event creation with URL for verification
            console.log(`🎫 Eventbrite: Created event "${title}" with ticketUrl: ${url}`);
            
            return event;
            
        } catch (error) {
            console.warn(`🎫 Eventbrite: Failed to parse JSON event: ${error}`);
            return null;
        }
    }

    // Extract additional URLs for detail page processing (from JSON data, not HTML links)
    extractAdditionalUrls(html, sourceUrl, parserConfig) {
        const urls = new Set();
        
        try {
            console.log(`🎫 Eventbrite: Extracting additional event URLs from JSON data`);
            
            // Look for window.__SERVER_DATA__ which contains the event information
            // Use the same robust JSON extraction approach
            const startPattern = /window\.__SERVER_DATA__\s*=\s*/;
            const startMatch = html.match(startPattern);
            
            if (startMatch) {
                const startIndex = startMatch.index + startMatch[0].length;
                const jsonString = this.extractJsonObject(html, startIndex);
                
                if (jsonString) {
                    try {
                        const serverData = JSON.parse(jsonString);
                    
                    // Extract URLs from future_events
                    if (serverData.view_data && serverData.view_data.events && serverData.view_data.events.future_events) {
                        const futureEvents = serverData.view_data.events.future_events;
                        console.log(`🎫 Eventbrite: Found ${futureEvents.length} future events in JSON data for URL extraction`);
                        
                        futureEvents.forEach(eventData => {
                            if (eventData.url) {
                                let eventUrl = eventData.url;
                                
                                // Ensure it's a full URL
                                if (!eventUrl.startsWith('http')) {
                                    eventUrl = `https://www.eventbrite.com${eventUrl}`;
                                }
                                
                                // Only add if it's actually an event URL and passes validation
                                if (eventUrl.includes('/e/') && this.isValidEventUrl(eventUrl, parserConfig)) {
                                    urls.add(eventUrl);
                                    console.log(`🎫 Eventbrite: Found event detail URL: ${eventUrl}`);
                                }
                            }
                        });
                    }
                    
                    // Note: We only extract URLs from future events that we actually found
                    // Past events are not relevant for detail page processing
                    
                    } catch (error) {
                        console.warn('🎫 Eventbrite: Failed to parse window.__SERVER_DATA__ for URL extraction:', error);
                    }
                } else {
                    console.warn('🎫 Eventbrite: Could not extract valid JSON from window.__SERVER_DATA__ for URL extraction');
                }
            }
            
            console.log(`🎫 Eventbrite: Extracted ${urls.size} additional event links from JSON data`);
            
        } catch (error) {
            console.warn(`🎫 Eventbrite: Error extracting additional URLs: ${error}`);
        }
        
        return Array.from(urls).slice(0, 20); // Limit to 20 additional links per page
    }
 
     // Validate if URL is a valid event URL
     isValidEventUrl(url, parserConfig) {
         if (!url || typeof url !== 'string') return false;
         
                 try {
            // Use simple URL parsing that works in Scriptable
            const urlPattern = /^(https?:)\/\/([^\/]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/;
            const match = url.match(urlPattern);
            
            if (!match) return false;
            
            const [, protocol, host, pathname = '/', search = '', hash = ''] = match;
            const hostname = host.split(':')[0]; // Remove port if present
            
            // Must be Eventbrite domain
            if (!hostname.includes('eventbrite.com')) return false;
            
            // Must be event page
            if (!pathname.includes('/e/')) return false;
             
             // URL filtering is now handled automatically by parser selection
             
             return true;
             
         } catch (error) {
             return false;
         }
     }
 
    // Detect city using centralized city configuration (scraper-cities.js)
    detectCityFromEventData(eventDetails, cityConfig) {
        if (!eventDetails || !cityConfig || typeof cityConfig !== 'object') {
            return null;
        }

        // Prefer the explicit venue city if Eventbrite provides it
        const venueAddress = eventDetails.venueAddress;
        if (venueAddress) {
            const venueCityText = venueAddress.city || venueAddress.localized_area_display || '';
            const cityFromVenue = this.findCityFromText(venueCityText, cityConfig);
            if (cityFromVenue) {
                return cityFromVenue;
            }
        }

        // Fall back to scanning other event text fields using configured patterns
        const searchText = [
            eventDetails.address,
            eventDetails.venue,
            eventDetails.title,
            eventDetails.description,
            eventDetails.url
        ].filter(Boolean).join(' ');

        return this.findCityFromText(searchText, cityConfig);
    }

    // Find city key from text using centralized pattern list
    findCityFromText(text, cityConfig) {
        if (!text || !cityConfig || typeof cityConfig !== 'object') {
            return null;
        }

        const haystack = String(text).toLowerCase();
        for (const [cityKey, cityData] of Object.entries(cityConfig)) {
            const patterns = cityData?.patterns;
            if (!Array.isArray(patterns)) {
                continue;
            }

            for (const pattern of patterns) {
                const normalizedPattern = String(pattern || '').trim().toLowerCase();
                if (!normalizedPattern) {
                    continue;
                }

                const escapedPattern = normalizedPattern
                    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                    .replace(/\s+/g, '\\s+');
                const regex = new RegExp(`\\b${escapedPattern}\\b`);

                if (regex.test(haystack)) {
                    return cityKey;
                }
            }
        }

        return null;
    }
 
     // Normalize URLs
     normalizeUrl(url, baseUrl) {
         if (!url) return null;
         
         // Remove HTML entities
         url = url.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
         
                 // Handle relative URLs
        if (url.startsWith('/')) {
            // Simple URL parsing for Scriptable compatibility
            const urlPattern = /^(https?:)\/\/([^\/]+)/;
            const match = baseUrl.match(urlPattern);
            if (match) {
                const [, protocol, host] = match;
                return `${protocol}//${host}${url}`;
            }
        }
        
        // Handle protocol-relative URLs
        if (url.startsWith('//')) {
            // Simple URL parsing for Scriptable compatibility
            const urlPattern = /^(https?:)/;
            const match = baseUrl.match(urlPattern);
            if (match) {
                const [, protocol] = match;
                return `${protocol}${url}`;
            }
        }
         
         return url;
     }
 
     // Check if an event is a bear event based on keywords and title
     isBearEvent(event) {
         // Handle title objects (from Eventbrite JSON) vs strings
         const title = typeof event.title === 'object' && event.title.text ? event.title.text : (event.title || '');
         const description = event.description || '';
         const venue = event.venue || '';
         const url = event.url || '';

         // Check if the title, description, venue, or URL contains bear keywords
         if (this.bearKeywords.some(keyword => 
             title.toLowerCase().includes(keyword) || 
             description.toLowerCase().includes(keyword) || 
             venue.toLowerCase().includes(keyword) || 
             url.toLowerCase().includes(keyword)
         )) {
             return true;
         }

                 return false;
    }
    
    // Get timezone identifier for a city using centralized configuration
    getTimezoneForCity(city, cityConfig = null) {
        // City config must be provided - no fallbacks
        if (!cityConfig || !cityConfig[city]) {
            console.log(`🎫 Eventbrite: No timezone configuration found for city: ${city}`);
            console.log(`🎫 Eventbrite: Available cities in config:`, Object.keys(cityConfig || {}));
            console.log(`🎫 Eventbrite: This error is coming from Eventbrite parser`);
            return null;
        }
        
        return cityConfig[city].timezone;
    }
}

// Export for both environments
 if (typeof module !== 'undefined' && module.exports) {
     module.exports = { EventbriteParser };
 } else if (typeof window !== 'undefined') {
     window.EventbriteParser = EventbriteParser;
 } else {
     // Scriptable environment
     this.EventbriteParser = EventbriteParser;
 }

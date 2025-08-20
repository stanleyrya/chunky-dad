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
            requireDetailPages: false,
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
            console.log(`🎫 Eventbrite: Parsing events from ${htmlData.url}`);
            
            const events = [];
            const html = htmlData.html;
            
            if (!html) {
                console.warn('🎫 Eventbrite: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }
            
            // Extract events from embedded JSON data (modern Eventbrite approach - JSON only)
            const jsonEvents = this.extractEventsFromJson(html, parserConfig, htmlData);
            if (jsonEvents.length > 0) {
                console.log(`🎫 Eventbrite: Found ${jsonEvents.length} events in embedded JSON data`);
                events.push(...jsonEvents);
            } else {
                console.log('🎫 Eventbrite: No events found in JSON data - this may be an individual event page or empty organizer page');
            }
            
            // Extract additional URLs if required (regardless of JSON vs HTML parsing)
            let additionalLinks = [];
            if (parserConfig.requireDetailPages) {
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

    // Extract events from embedded JSON data (modern Eventbrite)
    extractEventsFromJson(html, parserConfig = {}, htmlData = null) {
        const events = [];
        
        try {
            // Look for window.__SERVER_DATA__ which contains the event information
            const serverDataMatch = html.match(/window\.__SERVER_DATA__\s*=\s*({[\s\S]*?});/);
            
            if (serverDataMatch && serverDataMatch[1]) {
                try {
                    const serverData = JSON.parse(serverDataMatch[1]);
                    console.log('🎫 Eventbrite: Found window.__SERVER_DATA__');
                    
                    // Check for events in view_data.events.future_events (organizer pages)
                    if (serverData.view_data && serverData.view_data.events && serverData.view_data.events.future_events) {
                        const futureEvents = serverData.view_data.events.future_events;
                        console.log(`🎫 Eventbrite: Found ${futureEvents.length} future events in JSON data (organizer page)`);
                        
                        futureEvents.forEach(eventData => {
                            if (eventData.url && eventData.name && (eventData.name.text || typeof eventData.name === 'string')) {
                                // Double-check that it's actually a future event
                                if (this.isFutureEvent(eventData)) {
                                    const event = this.parseJsonEvent(eventData, null, parserConfig, serverData);
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
                            const event = this.parseJsonEvent(adaptedEventData, null, parserConfig, serverData);
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
                        let eventData = null;
                        
                        // Try event_listing_response first
                        if (serverData.event_listing_response && serverData.event_listing_response.events) {
                            console.log('🎫 Eventbrite: Found event_listing_response.events, checking for event data');
                            const events = serverData.event_listing_response.events;
                            if (Array.isArray(events) && events.length > 0) {
                                eventData = events[0]; // Take first event from listing
                                console.log('🎫 Eventbrite: Using event from event_listing_response.events[0]');
                            } else if (events && typeof events === 'object') {
                                // events might be an object with event data directly
                                eventData = events;
                                console.log('🎫 Eventbrite: Using event data from event_listing_response.events object');
                            }
                        }
                        
                        // Try components.eventDetails if event_listing_response didn't work
                        if (!eventData && serverData.components && serverData.components.eventDetails) {
                            console.log('🎫 Eventbrite: Trying components.eventDetails for event data');
                            eventData = serverData.components.eventDetails;
                        }
                        
                        // Try other possible locations in components
                        if (!eventData && serverData.components) {
                            const componentKeys = Object.keys(serverData.components);
                            console.log('🎫 Eventbrite: Searching components for event data, keys:', componentKeys.join(', '));
                            
                            // Look for any component that might contain event data
                            for (const key of componentKeys) {
                                const component = serverData.components[key];
                                if (component && typeof component === 'object') {
                                    // Check if this component has event-like data
                                    if (component.name || component.title || component.start || component.startDate) {
                                        console.log(`🎫 Eventbrite: Found potential event data in components.${key}`);
                                        eventData = component;
                                        break;
                                    }
                                    
                                    // Also check nested properties for event data
                                    if (component.event && typeof component.event === 'object') {
                                        console.log(`🎫 Eventbrite: Found nested event data in components.${key}.event`);
                                        eventData = component.event;
                                        break;
                                    }
                                    
                                    // Check for event data in props or data properties
                                    if (component.props && component.props.event) {
                                        console.log(`🎫 Eventbrite: Found event data in components.${key}.props.event`);
                                        eventData = component.props.event;
                                        break;
                                    }
                                }
                            }
                        }
                        
                        // Try to find event data anywhere in the serverData structure as a last resort
                        if (!eventData) {
                            console.log('🎫 Eventbrite: Performing deep search for event data in serverData');
                            eventData = this.findEventDataRecursively(serverData);
                            if (eventData) {
                                console.log('🎫 Eventbrite: Found event data via recursive search');
                            }
                        }
                        
                        // If we found event data in an alternative location, process it
                        if (eventData) {
                            console.log('🎫 Eventbrite: Found alternative event data structure, attempting to parse');
                            
                            // Adapt the event data to our expected format
                            const adaptedEventData = {
                                ...eventData,
                                url: eventData.url || (htmlData ? htmlData.url : ''),
                                name: eventData.name || eventData.title || '',
                                start: eventData.start || eventData.startDate,
                                end: eventData.end || eventData.endDate
                            };
                            
                            // Validate and process
                            const hasRequiredFields = adaptedEventData.name && (adaptedEventData.url || htmlData.url);
                            const isFuture = this.isFutureEvent(adaptedEventData);
                            
                            console.log(`🎫 Eventbrite: Alternative event validation - hasFields: ${hasRequiredFields}, isFuture: ${isFuture}, name: "${adaptedEventData.name}"`);
                            
                            if (hasRequiredFields && isFuture) {
                                const event = this.parseJsonEvent(adaptedEventData, null, parserConfig, serverData);
                                if (event) {
                                    events.push(event);
                                    console.log(`🎫 Eventbrite: Parsed event from alternative location: ${event.title} (${event.startDate || event.date})`);
                                }
                            }
                        } else {
                            // Log debugging info if no event data found
                            console.log('🎫 Eventbrite: Available serverData structure for debugging:');
                            console.log('🎫 Eventbrite: - event:', !!serverData.event);
                            console.log('🎫 Eventbrite: - event_listing_response:', !!serverData.event_listing_response);
                            console.log('🎫 Eventbrite: - components:', !!serverData.components);
                            if (serverData.components) {
                                console.log('🎫 Eventbrite: - components keys:', Object.keys(serverData.components));
                            }
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
                    
                    // Try to extract at least basic event information from the HTML as fallback
                    console.log('🎫 Eventbrite: Attempting HTML fallback parsing for detail page');
                    const fallbackEvent = this.extractEventFromHtmlFallback(html, htmlData.url, parserConfig);
                    if (fallbackEvent) {
                        events.push(fallbackEvent);
                        console.log(`🎫 Eventbrite: Successfully extracted event via HTML fallback: ${fallbackEvent.title}`);
                    }
                }
            }
            

            
        } catch (error) {
            console.warn(`🎫 Eventbrite: Error extracting JSON events: ${error}`);
        }
        
        return events;
    }



    // Recursively search for event data in serverData structure
    findEventDataRecursively(obj, depth = 0, maxDepth = 3) {
        if (depth > maxDepth || !obj || typeof obj !== 'object') {
            return null;
        }
        
        // Check if current object has event-like properties
        if (obj.name && (obj.start || obj.startDate || obj.start_date)) {
            return obj;
        }
        
        // Search nested objects
        for (const key of Object.keys(obj)) {
            const value = obj[key];
            if (typeof value === 'object' && value !== null) {
                const found = this.findEventDataRecursively(value, depth + 1, maxDepth);
                if (found) {
                    return found;
                }
            }
        }
        
        return null;
    }

    // Fallback HTML parsing when JSON fails (for detail pages)
    extractEventFromHtmlFallback(html, url, parserConfig) {
        try {
            console.log('🎫 Eventbrite: Attempting to extract basic event info from HTML structure');
            
            // Extract title from page title or h1
            let title = '';
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch) {
                title = titleMatch[1].replace(/\s*\|\s*Eventbrite$/, '').trim();
            }
            
            if (!title) {
                const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
                if (h1Match) {
                    title = h1Match[1].trim();
                }
            }
            
            // Extract basic meta information
            let description = '';
            const descMatch = html.match(/<meta\s+(?:name|property)=["'](?:description|og:description)["']\s+content=["']([^"']+)["']/i);
            if (descMatch) {
                description = descMatch[1].trim();
            }
            
            // If we have at least a title, create a basic event
            if (title) {
                console.log(`🎫 Eventbrite: HTML fallback found title: "${title}"`);
                
                const event = {
                    title: title,
                    description: description,
                    website: url,
                    source: this.config.source,
                    isBearEvent: this.config.alwaysBear || this.isBearEvent({
                        title: title,
                        description: description,
                        venue: '',
                        url: url
                    })
                };
                
                // Apply metadata if available
                if (parserConfig.metadata) {
                    Object.keys(parserConfig.metadata).forEach(key => {
                        const metaValue = parserConfig.metadata[key];
                        if (typeof metaValue === 'object' && metaValue !== null && 'merge' in metaValue) {
                            if ('value' in metaValue && metaValue.value !== undefined) {
                                event[key] = metaValue.value;
                            }
                            if (!event._fieldMergeStrategies) {
                                event._fieldMergeStrategies = {};
                            }
                            event._fieldMergeStrategies[key] = metaValue.merge || 'preserve';
                        }
                    });
                }
                
                return event;
            }
            
        } catch (error) {
            console.warn(`🎫 Eventbrite: HTML fallback parsing failed: ${error.message}`);
        }
        
        return null;
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
    parseJsonEvent(eventData, htmlContext = null, parserConfig = {}, serverData = null) {
        try {
            // Handle both organizer page format (name.text) and detail page format (name as string)
            const title = eventData.name?.text || eventData.name || eventData.title || '';
            
            // Get description from multiple sources, including detail page components
            let description = eventData.description || eventData.summary || '';
            if (!description && serverData?.components?.eventDescription?.summary) {
                description = serverData.components.eventDescription.summary;
            }
            
            // Handle both organizer page format (start.utc) and detail page format (start as string)
            // Detail pages may have start/end as timezone objects with utc field
            let startDate = eventData.start?.utc || eventData.start_date || eventData.startDate || eventData.start;
            let endDate = eventData.end?.utc || eventData.end_date || eventData.endDate || eventData.end;
            
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
            if (serverData?.components?.eventMap) {
                const eventMap = serverData.components.eventMap;
                venue = eventMap.venueName || venue;
                address = eventMap.venueAddress || address;
                
                // Extract coordinates from detail page location data
                if (eventMap.location && eventMap.location.latitude && eventMap.location.longitude) {
                    coordinates = {
                        lat: eventMap.location.latitude,
                        lng: eventMap.location.longitude
                    };
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
                    }
                    
                    // Also check venue-level coordinates (sometimes more accurate)
                    if (!coordinates && eventData.venue.latitude && eventData.venue.longitude) {
                        coordinates = {
                            lat: parseFloat(eventData.venue.latitude),
                            lng: parseFloat(eventData.venue.longitude)
                        };
                    }
                }
            }
            
            // Enhanced price extraction with availability info
            let price = '';
            if (eventData.is_free) {
                price = 'Free';
            } else if (eventData.price_range) {
                price = eventData.price_range;
                
                // Add availability hint based on inventory type (applies to all ticket tiers)
                if (eventData.inventory_type === 'limited') {
                    const now = new Date();
                    const month = now.getMonth() + 1;
                    const day = now.getDate();
                    price += ` (as of ${month}/${day})`;
                }
            }
            const image = eventData.logo?.url || eventData.image?.url || '';
            
            // Extract city from event title for better event organization
            let city = null;
            
            // Generic city extraction from title - useful for events that include city in their name
            if (title) {
                // Check if title contains a specific city
                if (/(atlanta)/i.test(title)) city = 'atlanta';
                else if (/(denver)/i.test(title)) city = 'denver';
                else if (/(vegas|las vegas)/i.test(title)) city = 'vegas';
                else if (/(long beach)/i.test(title)) city = 'la'; // Long Beach is part of LA area
                else if (/(new york|nyc)/i.test(title)) city = 'nyc';
                else if (/(chicago)/i.test(title)) city = 'chicago';
                else if (/(miami)/i.test(title)) city = 'miami';
                else if (/(san francisco|sf)/i.test(title)) city = 'sf';
                else if (/(seattle)/i.test(title)) city = 'seattle';
                else if (/(portland)/i.test(title)) city = 'portland';
                else if (/(austin)/i.test(title)) city = 'austin';
                else if (/(dallas)/i.test(title)) city = 'dallas';
                else if (/(houston)/i.test(title)) city = 'houston';
                else if (/(phoenix)/i.test(title)) city = 'phoenix';
                else if (/(boston)/i.test(title)) city = 'boston';
                else if (/(philadelphia|philly)/i.test(title)) city = 'philadelphia';
                else if (/(los angeles|la)/i.test(title)) city = 'la';
                else if (/(washington|dc)/i.test(title)) city = 'dc';
                else if (/(orlando)/i.test(title)) city = 'orlando';
                else if (/(tampa)/i.test(title)) city = 'tampa';
                
                if (city) {
                    console.log(`🎫 Eventbrite: Extracted city "${city}" from title: "${title}"`);
                }
            }
            
            // Don't generate Google Maps URL here - let SharedCore handle it with iOS-compatible logic
            // Just pass the place_id data to SharedCore for processing
            let gmapsUrl = '';
            console.log(`🎫 Eventbrite: Passing place_id "${eventData.venue?.google_place_id}" to SharedCore for iOS-compatible URL generation for "${title}"`)
            
            const event = {
                title: title,
                description: description,
                startDate: startDate ? new Date(startDate) : null,
                endDate: endDate ? new Date(endDate) : null,
                bar: venue, // Use 'bar' field name that calendar-core.js expects
                location: coordinates ? `${coordinates.lat}, ${coordinates.lng}` : null, // Store coordinates as "lat,lng" string in location field
                address: address,
                city: city,
                website: url, // Use 'website' field name that calendar-core.js expects
                cover: price, // Use 'cover' field name that calendar-core.js expects
                image: image,
                gmaps: gmapsUrl, // Google Maps URL for enhanced location access
                placeId: eventData.venue?.google_place_id || null, // Pass place_id to SharedCore for iOS-compatible URL generation
                source: this.config.source,
                // Properly handle bear event detection based on configuration
                isBearEvent: this.config.alwaysBear || this.isBearEvent({
                    title: title,
                    description: '',
                    venue: venue,
                    url: url
                })
            };
            
            // Apply all metadata fields from config
            if (parserConfig.metadata) {
                // Pass through all metadata fields to the event
                Object.keys(parserConfig.metadata).forEach(key => {
                    const metaValue = parserConfig.metadata[key];
                    
                    // All fields must use {value, merge} format
                    if (typeof metaValue === 'object' && metaValue !== null && 'merge' in metaValue) {
                        // Only set value if it's defined (allows preserve without value)
                        if ('value' in metaValue && metaValue.value !== undefined) {
                            event[key] = metaValue.value;
                        }
                        
                        // Store merge strategy for later use
                        if (!event._fieldMergeStrategies) {
                            event._fieldMergeStrategies = {};
                        }
                        event._fieldMergeStrategies[key] = metaValue.merge || 'preserve';
                    }
                    // Ignore non-object values since we require explicit format
                });
            }
            
            // Log event creation with URL for verification
            console.log(`🎫 Eventbrite: Created event "${title}" with URL: ${url}`);
            
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
            const serverDataMatch = html.match(/window\.__SERVER_DATA__\s*=\s*({[\s\S]*?});/);
            
            if (serverDataMatch && serverDataMatch[1]) {
                try {
                    const serverData = JSON.parse(serverDataMatch[1]);
                    
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
             
             // Apply URL filters if configured
             if (parserConfig.urlFilters) {
                 if (parserConfig.urlFilters.include) {
                     const includePatterns = Array.isArray(parserConfig.urlFilters.include) ? 
                         parserConfig.urlFilters.include : [parserConfig.urlFilters.include];
                     
                     const matchesInclude = includePatterns.some(pattern => 
                         new RegExp(pattern, 'i').test(url)
                     );
                     
                     if (!matchesInclude) return false;
                 }
                 
                 if (parserConfig.urlFilters.exclude) {
                     const excludePatterns = Array.isArray(parserConfig.urlFilters.exclude) ? 
                         parserConfig.urlFilters.exclude : [parserConfig.urlFilters.exclude];
                     
                     const matchesExclude = excludePatterns.some(pattern => 
                         new RegExp(pattern, 'i').test(url)
                     );
                     
                     if (matchesExclude) return false;
                 }
             }
             
             return true;
             
         } catch (error) {
             return false;
         }
     }
 
     // Extract city from event data or URL
     extractCityFromEvent(eventData, url) {
         // Try venue address first
         if (eventData.venue?.address) {
             const address = eventData.venue.address;
             const cityFromAddress = address.city || address.localized_area_display || '';
             if (cityFromAddress) {
                 return this.normalizeCityName(cityFromAddress);
             }
         }
         
         // Try extracting from text
         const searchText = `${eventData.name?.text || eventData.name || ''} ${eventData.description || ''} ${url || ''}`;
         return this.extractCityFromText(searchText);
     }



     // Normalize city names
     normalizeCityName(cityName) {
         const normalizations = {
             'new york': 'nyc',
             'new york city': 'nyc',
             'manhattan': 'nyc',
             'los angeles': 'la',
             'san francisco': 'sf',
             'las vegas': 'vegas'
         };
         
         const lower = cityName.toLowerCase();
         return normalizations[lower] || lower;
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
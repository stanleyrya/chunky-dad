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
            const jsonEvents = this.extractEventsFromJson(html, parserConfig);
            if (jsonEvents.length > 0) {
                console.log(`🎫 Eventbrite: Found ${jsonEvents.length} events in embedded JSON data`);
                events.push(...jsonEvents);
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
    extractEventsFromJson(html, parserConfig = {}) {
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
                            if (eventData.url && eventData.name && eventData.name.text) {
                                // Double-check that it's actually a future event
                                if (this.isFutureEvent(eventData)) {
                                    const event = this.parseJsonEvent(eventData, null, parserConfig);
                                    if (event) {
                                        events.push(event);
                                        console.log(`🎫 Eventbrite: Parsed future event: ${event.title} (${event.startDate || event.date})`);
                                    }
                                } else {
                                    console.log(`🎫 Eventbrite: Skipping non-future event from future_events: ${eventData.name.text}`);
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
                    if (serverData.event) {
                        console.log('🎫 Eventbrite: Found individual event data in JSON');
                        const eventData = serverData.event;
                        
                        if (eventData.url && eventData.name && this.isFutureEvent(eventData)) {
                            // Add venue info from components for detail pages (minimal enhancement)
                            if (serverData.components?.eventMap && !eventData.venue?.name) {
                                const mapData = serverData.components.eventMap;
                                eventData.venue = {
                                    name: mapData.venueName,
                                    address: mapData.venueAddress,
                                    latitude: mapData.location?.latitude,
                                    longitude: mapData.location?.longitude
                                };
                            }
                            
                            const event = this.parseJsonEvent(eventData, null, parserConfig);
                            if (event) {
                                events.push(event);
                                console.log(`🎫 Eventbrite: Parsed individual event: ${event.title} (${event.startDate || event.date})`);
                            }
                        }
                        
                        if (events.length > 0) {
                            console.log(`🎫 Eventbrite: Successfully extracted individual event from JSON data`);
                            return events;
                        }
                    }
                    
                    // Also check for past events if needed for debugging (but don't include them)
                    if (serverData.view_data && serverData.view_data.events && serverData.view_data.events.past_events) {
                        const pastEvents = serverData.view_data.events.past_events;
                        console.log(`🎫 Eventbrite: Found ${pastEvents.length} past events in JSON data (not included)`);
                        

                    }
                    

                    
                } catch (parseError) {
                    console.warn('🎫 Eventbrite: Failed to parse JSON data:', parseError);
                }
            }
            

            
        } catch (error) {
            console.warn(`🎫 Eventbrite: Error extracting JSON events: ${error}`);
        }
        
        return events;
    }





    // Check if an object looks like an event
    isEventObject(obj) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
            return false;
        }
        
        // Check for name/title
        const hasName = obj.name || obj.title || (obj.name && obj.name.text);
        
        // Check for date/time fields (be more flexible)
        const hasDate = obj.start || obj.start_date || obj.startDate || obj.start_time || 
                       obj.event_start || obj.date || obj.datetime ||
                       (obj.start && obj.start.utc) ||
                       (obj.dates && (obj.dates.start || obj.dates.startDate));
        
        // Also check for URL as an indicator this might be an event
        const hasUrl = obj.url || obj.vanity_url || obj.event_url;
        
        // More flexible matching - need name and either date or URL
        return hasName && (hasDate || hasUrl);
    }

    // Check if an event is in the future (not past)
    isFutureEvent(eventData) {
        const now = new Date();
        
        // Handle both date formats: detail pages use start.utc, organizer pages use start: {utc: ...}
        let startDate;
        if (eventData.start && typeof eventData.start === 'object' && eventData.start.utc) {
            // Organizer page format: start: {utc: "2025-08-24T03:00:00Z"}
            startDate = eventData.start.utc;
        } else if (typeof eventData.start === 'string') {
            // Detail page format: start: "2025-08-24T03:00:00Z" or start_date
            startDate = eventData.start || eventData.start_date || eventData.startDate;
        } else {
            startDate = eventData.start_date || eventData.startDate || eventData.start;
        }
        
        if (!startDate) {
            // If no start date, assume it might be future and let it through
            return true;
        }
        
        try {
            const eventDate = new Date(startDate);
            return eventDate > now;
        } catch (error) {
            console.warn(`🎫 Eventbrite: Invalid date format: ${startDate}`);
            return true; // If we can't parse the date, let it through
        }
    }

    // Parse a JSON event object into our standard format
    parseJsonEvent(eventData, htmlContext = null, parserConfig = {}) {
        try {
            // Handle both organizer page format (name.text) and detail page format (name as string)
            const title = eventData.name?.text || eventData.name || eventData.title || '';
            const description = eventData.description || eventData.summary || '';
            
            // Handle both date formats: detail pages use start.utc, organizer pages use start: {utc: ...}
            let startDate, endDate;
            if (eventData.start && typeof eventData.start === 'object' && eventData.start.utc) {
                // Organizer page format: start: {utc: "2025-08-24T03:00:00Z"}
                startDate = eventData.start.utc;
            } else if (typeof eventData.start === 'string') {
                // Detail page format: start: "2025-08-24T03:00:00Z" or start_date
                startDate = eventData.start || eventData.start_date || eventData.startDate;
            } else {
                startDate = eventData.start_date || eventData.startDate || eventData.start;
            }
            
            if (eventData.end && typeof eventData.end === 'object' && eventData.end.utc) {
                // Organizer page format: end: {utc: "2025-08-24T10:30:00Z"}
                endDate = eventData.end.utc;
            } else if (typeof eventData.end === 'string') {
                // Detail page format: end: "2025-08-24T10:30:00Z" or end_date
                endDate = eventData.end || eventData.end_date || eventData.endDate;
            } else {
                endDate = eventData.end_date || eventData.endDate || eventData.end;
            }
            
            const url = eventData.url || eventData.vanity_url || '';
            

            
            // Enhanced venue processing - get both name and address
            let venue = null;
            let address = null;
            let coordinates = null;
            
            if (eventData.venue) {
                venue = eventData.venue.name || null;
                if (eventData.venue.address) {
                    // Use full structured address if available, fallback to localized display
                    const addr = eventData.venue.address;
                    if (addr.address_1 && addr.city && addr.region) {
                        address = `${addr.address_1}, ${addr.city}, ${addr.region} ${addr.postal_code || ''}`.trim();
                    } else {
                        address = addr.localized_address_display || null;
                    }
                    console.log(`🎫 Eventbrite: Venue details for "${title}": venue="${venue}", address="${address}"`);
                    console.log(`🎫 Eventbrite: Full address data:`, JSON.stringify(eventData.venue.address, null, 2));
                    
                    // Extract coordinates if available; shared-core will later suppress for placeholders
                    if (eventData.venue.address.latitude && eventData.venue.address.longitude) {
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
            
            // Fallback: Try to extract URLs from JSON-LD structured data
            if (urls.size === 0) {
                console.log('🎫 Eventbrite: No URLs found in server data, trying JSON-LD fallback');
                const jsonLdMatch = html.match(/"url":"(https:\/\/www\.eventbrite\.com\/e\/[^\"]+)"/g);
                
                if (jsonLdMatch) {
                    jsonLdMatch.forEach(match => {
                        const urlMatch = match.match(/"url":"([^\"]+)"/);
                        if (urlMatch && urlMatch[1]) {
                            const eventUrl = urlMatch[1];
                            if (this.isValidEventUrl(eventUrl, parserConfig)) {
                                urls.add(eventUrl);
                                console.log(`🎫 Eventbrite: Found event URL in JSON-LD: ${eventUrl}`);
                            }
                        }
                    });
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
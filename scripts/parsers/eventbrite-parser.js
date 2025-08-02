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
        
        // Shared city utilities will be injected by shared-core
        this.sharedCore = null;
    }
    
    // Initialize with shared-core instance for city utilities
    initialize(sharedCore) {
        this.sharedCore = sharedCore;
    }

    // Main parsing method - receives HTML data and returns events + additional links
    parseEvents(htmlData, parserConfig = {}) {
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
    extractEventsFromJson(html, parserConfig = {}) {
        const events = [];
        
        try {
            // Look for window.__SERVER_DATA__ which contains the event information (from old working script)
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
                            const event = this.parseJsonEvent(eventData, null, parserConfig);
                            if (event) {
                                events.push(event);
                                console.log(`🎫 Eventbrite: Parsed individual event: ${event.title} (${event.startDate || event.date})`);
                            }
                        } else {
                            console.log('🎫 Eventbrite: Individual event is not a future event or missing required data');
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
                    console.warn('🎫 Eventbrite: Failed to parse window.__SERVER_DATA__:', parseError);
                }
            }
            
            // Fallback: Look for other JSON patterns if __SERVER_DATA__ didn't work
            const jsonPatterns = [
                /__INITIAL_STATE__\s*=\s*({.+?});/,
                /"events":\s*(\[.+?\])/,
                /"future_events":\s*(\[.+?\])/
            ];
            
            for (const pattern of jsonPatterns) {
                const match = html.match(pattern);
                if (match) {
                    try {
                        const jsonData = JSON.parse(match[1]);
                        const extractedEvents = this.extractEventsFromJsonData(jsonData, [], parserConfig);
                        if (extractedEvents.length > 0) {
                            events.push(...extractedEvents);
                            console.log(`🎫 Eventbrite: Extracted ${extractedEvents.length} events from JSON pattern`);
                            break;
                        }
                    } catch (parseError) {
                        console.warn(`🎫 Eventbrite: Failed to parse JSON data: ${parseError}`);
                    }
                }
            }
            
        } catch (error) {
            console.warn(`🎫 Eventbrite: Error extracting JSON events: ${error}`);
        }
        
        return events;
    }

    // Recursively search JSON data for event objects
    extractEventsFromJsonData(data, events = [], parserConfig = {}) {
        if (!data || typeof data !== 'object') return events;
        
        // Check if this object looks like an event
        if (this.isEventObject(data)) {
            // Only process future events
            if (this.isFutureEvent(data)) {
                const event = this.parseJsonEvent(data, null, parserConfig);
                if (event) {
                    events.push(event);
                }
            } else {
                console.log(`🎫 Eventbrite: Skipping past event: ${data.name || data.title || 'Unknown'}`);
            }
        }
        
        // Recursively search nested objects and arrays
        if (Array.isArray(data)) {
            for (const item of data) {
                this.extractEventsFromJsonData(item, events, parserConfig);
            }
        } else if (typeof data === 'object') {
            for (const value of Object.values(data)) {
                this.extractEventsFromJsonData(value, events, parserConfig);
            }
        }
        
        return events;
    }

    // Check if an object looks like an event
    isEventObject(obj) {
        return obj && 
               typeof obj === 'object' && 
               (obj.name || obj.title) &&
               (obj.start || obj.start_date || obj.startDate) &&
               !Array.isArray(obj);
    }

    // Check if an event is in the future (not past)
    isFutureEvent(eventData) {
        const now = new Date();
        const startDate = eventData.start?.utc || eventData.start_date || eventData.startDate || eventData.start;
        
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
            const title = eventData.name?.text || eventData.name || eventData.title || '';
            const description = eventData.description || eventData.summary || '';
            const startDate = eventData.start?.utc || eventData.start_date || eventData.startDate || eventData.start;
            const endDate = eventData.end?.utc || eventData.end_date || eventData.endDate || eventData.end;
            const url = eventData.url || eventData.vanity_url || '';
            
            // Enhanced venue processing - get both name and address
            let venue = null;
            let address = null;
            let coordinates = null;
            let googleMapsLink = null;
            
            if (eventData.venue) {
                venue = eventData.venue.name || null;
                if (eventData.venue.address) {
                    address = eventData.venue.address.localized_address_display || null;
                    console.log(`🎫 Eventbrite: Venue details for "${title}": venue="${venue}", address="${address}"`);
                    console.log(`🎫 Eventbrite: Full address data:`, JSON.stringify(eventData.venue.address, null, 2));
                    
                    // Extract coordinates if available
                    if (eventData.venue.address.latitude && eventData.venue.address.longitude) {
                        coordinates = {
                            lat: eventData.venue.address.latitude,
                            lng: eventData.venue.address.longitude
                        };
                        
                        // Create Google Maps link
                        googleMapsLink = `https://maps.google.com/?q=${coordinates.lat},${coordinates.lng}`;
                    } else if (address) {
                        // Create Google Maps link from address
                        googleMapsLink = `https://maps.google.com/?q=${encodeURIComponent(address)}`;
                    }
                }
            }
            
            // HTML address extraction fallback if JSON address is not available
            if (!address && htmlContext) {
                console.log(`🎫 Eventbrite: No address in JSON data, trying HTML extraction for "${title}"`);
                address = this.extractAddressFromHtml(htmlContext, venue);
                if (address) {
                    console.log(`🎫 Eventbrite: Found address via HTML extraction: "${address}"`);
                    // Create Google Maps link from extracted address
                    googleMapsLink = `https://maps.google.com/?q=${encodeURIComponent(address)}`;
                }
            }
            
            const price = eventData.ticket_availability?.minimum_ticket_price?.display || '';
            const image = eventData.logo?.url || eventData.image?.url || '';
            
            // Enhanced city extraction using shared city utilities
            let city = null;
            
            if (this.sharedCore) {
                // Use shared city utilities for consistent extraction
                city = this.sharedCore.extractCityFromEvent(eventData, url);
                
                if (address && !city) {
                    city = this.sharedCore.extractCityFromAddress(address);
                }
                
                if (!city) {
                    const searchText = `${title} ${venue || ''}`;
                    city = this.sharedCore.extractCityFromText(searchText);
                }
                
                if (!city && url) {
                    city = this.sharedCore.extractCityFromText(url);
                }
            } else {
                // Fallback to simple text extraction if shared-core not available
                city = this.extractCityFromText(`${title} ${venue || ''} ${url || ''}`);
            }
            
            // Special handling for Megawoof America events without explicit city
            if (!city && title && /megawoof|d[\>\s]*u[\>\s]*r[\>\s]*o/i.test(title) && !/(atlanta|denver|vegas|las vegas|long beach|new york|chicago|miami|san francisco|seattle|portland|austin|dallas|houston|phoenix|boston|philadelphia)/i.test(title)) {
                console.log(`🎫 Eventbrite: Megawoof event without explicit city, defaulting to LA: "${title}"`);
                city = 'la';
            }
            
            const event = {
                title: title,
                description: description,
                startDate: startDate,
                endDate: endDate,
                venue: venue,
                location: venue, // For backward compatibility
                address: address,
                coordinates: coordinates,
                googleMapsLink: googleMapsLink,
                city: city,
                url: url,
                website: url, // Add website property for calendar integrations
                price: price,
                image: image,
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
            
            // Apply field merge strategies to filter out preserved fields
            const filteredEvent = this.sharedCore ? 
                this.sharedCore.applyFieldMergeStrategies(event, parserConfig) : 
                event;
            
            // Log event creation with URL for verification
            console.log(`🎫 Eventbrite: Created event "${title}" with URL: ${url}`);
            
            return filteredEvent;
            
        } catch (error) {
            console.warn(`🎫 Eventbrite: Failed to parse JSON event: ${error}`);
            return null;
        }
    }

    // Parse HTML events using regex (environment-agnostic)
    parseHTMLEvents(html, sourceUrl) {
        const events = [];
        
        try {
            // Multiple selector strategies for different Eventbrite layouts
            const eventPatterns = [
                // Modern Eventbrite event cards
                /<div[^>]*data-testid="event-card[^>]*>.*?<\/div>/gs,
                /<div[^>]*class="[^"]*event-card[^>]*>.*?<\/div>/gs,
                /<article[^>]*class="[^"]*event[^>]*>.*?<\/article>/gs,
                // Event links
                /<a[^>]*href="[^"]*\/e\/[^"]*"[^>]*>.*?<\/a>/gs
            ];
            
            for (const pattern of eventPatterns) {
                const matches = html.match(pattern) || [];
                
                for (const match of matches) {
                    try {
                        const event = this.parseHTMLEventElement(match, sourceUrl);
                        if (event) {
                            events.push(event);
                        }
                    } catch (error) {
                        console.warn(`🎫 Eventbrite: Failed to parse HTML event element: ${error}`);
                    }
                }
                
                if (events.length > 0) {
                    console.log(`🎫 Eventbrite: Found ${events.length} events using HTML pattern`);
                    break;
                }
            }
            
        } catch (error) {
            console.warn(`🎫 Eventbrite: Error parsing HTML events: ${error}`);
        }
        
        return events;
    }

    // Parse individual HTML event element
    parseHTMLEventElement(htmlElement, sourceUrl) {
        try {
            // Extract title
            const titleMatch = htmlElement.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/) ||
                              htmlElement.match(/title="([^"]+)"/) ||
                              htmlElement.match(/>([^<]+)</);
            const title = titleMatch ? titleMatch[1].trim() : '';
            
            // Extract URL
            const urlMatch = htmlElement.match(/href="([^"]*\/e\/[^"]*)"/) ||
                            htmlElement.match(/href="([^"]*eventbrite\.com[^"]*)"/) ||
                            htmlElement.match(/href="([^"]+)"/);
            const url = urlMatch ? this.normalizeUrl(urlMatch[1], sourceUrl) : '';
            
            // Extract date/time
            const dateMatch = htmlElement.match(/datetime="([^"]+)"/) ||
                             htmlElement.match(/data-date="([^"]+)"/) ||
                             htmlElement.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
            const startDate = dateMatch ? dateMatch[1] : null;
            
            // Extract venue/location
            const venueMatch = htmlElement.match(/<span[^>]*class="[^"]*location[^>]*>([^<]+)<\/span>/) ||
                              htmlElement.match(/<div[^>]*class="[^"]*venue[^>]*>([^<]+)<\/div>/) ||
                              htmlElement.match(/location[^>]*>([^<]+)</i);
            const venue = venueMatch ? venueMatch[1].trim() : '';
            
            if (!title) {
                return null;
            }
            
            // Extract city using shared utilities
            let city = null;
            if (this.sharedCore) {
                city = this.sharedCore.extractCityFromText(title + ' ' + venue + ' ' + url);
            } else {
                city = this.extractCityFromText(title + ' ' + venue + ' ' + url);
            }
            
            return {
                title: title,
                description: '',
                startDate: startDate,
                endDate: null,
                venue: venue,
                city: city,
                url: url,
                price: '',
                image: '',
                source: this.config.source,
                setDescription: parserConfig.metadata?.setDescription !== false, // Default to true unless explicitly false
                // Properly handle bear event detection based on configuration
                isBearEvent: this.config.alwaysBear || this.isBearEvent({
                    title: title,
                    description: '',
                    venue: venue,
                    url: url
                })
            };
            
            // Apply field merge strategies to filter out preserved fields
            const filteredEvent = this.sharedCore ? 
                this.sharedCore.applyFieldMergeStrategies(event, this.config) : 
                event;
            
            return filteredEvent;
            
        } catch (error) {
            console.warn(`🎫 Eventbrite: Failed to parse HTML event element: ${error}`);
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
                const jsonLdMatch = html.match(/"url":"(https:\/\/www\.eventbrite\.com\/e\/[^"]+)"/g);
                
                if (jsonLdMatch) {
                    jsonLdMatch.forEach(match => {
                        const urlMatch = match.match(/"url":"([^"]+)"/);
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
            const urlObj = new URL(url);
            
            // Must be Eventbrite domain
            if (!urlObj.hostname.includes('eventbrite.com')) return false;
            
            // Must be event page
            if (!urlObj.pathname.includes('/e/')) return false;
            
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

    // Extract city from text content
    extractCityFromText(text) {
        if (!this.sharedCore) {
            console.warn('🎫 Eventbrite: SharedCore not initialized, using basic city extraction.');
            // Very basic fallback - just look for common city names
            const lowerText = text.toLowerCase();
            if (lowerText.includes('new york') || lowerText.includes('nyc')) return 'nyc';
            if (lowerText.includes('los angeles') || lowerText.includes('hollywood')) return 'la';
            if (lowerText.includes('san francisco') || lowerText.includes(' sf ')) return 'sf';
            if (lowerText.includes('chicago')) return 'chicago';
            if (lowerText.includes('atlanta')) return 'atlanta';
            if (lowerText.includes('miami')) return 'miami';
            if (lowerText.includes('seattle')) return 'seattle';
            if (lowerText.includes('denver')) return 'denver';
            if (lowerText.includes('las vegas') || lowerText.includes('vegas')) return 'vegas';
            return null;
        }

        return this.sharedCore.extractCityFromText(text);
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
            const base = new URL(baseUrl);
            return `${base.protocol}//${base.host}${url}`;
        }
        
        // Handle protocol-relative URLs
        if (url.startsWith('//')) {
            const base = new URL(baseUrl);
            return `${base.protocol}${url}`;
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

        // Check if the title or description contains bear keywords
        if (this.bearKeywords.some(keyword => 
            title.toLowerCase().includes(keyword) || 
            description.toLowerCase().includes(keyword) || 
            venue.toLowerCase().includes(keyword) || 
            url.toLowerCase().includes(keyword)
        )) {
            return true;
        }

        // Check if the URL itself contains bear keywords (e.g., megawoof.com)
        if (url.toLowerCase().includes('megawoof.com')) {
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
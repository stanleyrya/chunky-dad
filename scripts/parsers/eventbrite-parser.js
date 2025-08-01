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
// ❌ DOM APIs (DOMParser, document, window) - use regex instead
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

class EventbriteParser {
    constructor(config = {}) {
        this.config = {
            source: 'Eventbrite',
            baseUrl: 'https://www.eventbrite.com',
            alwaysBear: false,
            requireDetailPages: false,
            maxAdditionalUrls: 20,
            ...config
        };
        
        // Initialize city utilities
        this.initializeCityUtils();
        
        this.bearKeywords = [
            'megawoof', 'bear', 'bears', 'woof', 'grr', 'furry', 'hairy',
            'daddy', 'cub', 'otter', 'leather', 'muscle bear', 'bearracuda',
            'furball', 'leather bears', 'bear night', 'bear party'
        ];
        
        // URL patterns for additional link extraction
        this.urlPatterns = [
            {
                name: 'Event Pages',
                regex: 'href="([^"]*\\/e\\/[^"]*)"',
                maxMatches: 15,
                description: 'Individual event pages'
            },
            {
                name: 'Eventbrite Events',
                regex: 'href="(https?:\\/\\/[^"]*eventbrite\\.com\\/e\\/[^"]*)"',
                maxMatches: 15,
                description: 'Full Eventbrite event URLs'
            }
        ];
    }

    // Initialize city utilities based on environment
    initializeCityUtils() {
        try {
            // Try to load CityUtils based on environment
            if (typeof require !== 'undefined') {
                // Node.js environment
                const { CityUtils } = require('../utils/city-utils');
                this.cityUtils = new CityUtils();
            } else if (typeof importModule !== 'undefined') {
                // Scriptable environment
                const cityUtilsModule = importModule('utils/city-utils');
                this.cityUtils = new cityUtilsModule.CityUtils();
            } else if (typeof window !== 'undefined' && window.CityUtils) {
                // Web environment
                this.cityUtils = new window.CityUtils();
            } else {
                throw new Error('CityUtils not available');
            }
        } catch (error) {
            console.warn('🎫 Eventbrite: Could not load CityUtils, using fallback city extraction');
            this.cityUtils = null;
        }
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
            
            // First try to extract events from embedded JSON data (modern Eventbrite approach)
            const jsonEvents = this.extractEventsFromJson(html);
            if (jsonEvents.length > 0) {
                console.log(`🎫 Eventbrite: Found ${jsonEvents.length} events in embedded JSON data`);
                events.push(...jsonEvents);
            } else {
                // Fallback to HTML parsing if no JSON data found
                console.log('🎫 Eventbrite: No JSON data found, falling back to HTML parsing');
                
                // Parse HTML using regex (works in all environments)
                const htmlEvents = this.parseHTMLEvents(html, htmlData.url);
                events.push(...htmlEvents);
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
    extractEventsFromJson(html) {
        const events = [];
        
        try {
            // Look for window.__SERVER_DATA__ which contains the event information (from old working script)
            const serverDataMatch = html.match(/window\.__SERVER_DATA__\s*=\s*({[\s\S]*?});/);
            
            if (serverDataMatch && serverDataMatch[1]) {
                try {
                    const serverData = JSON.parse(serverDataMatch[1]);
                    console.log('🎫 Eventbrite: Found window.__SERVER_DATA__');
                    
                    // Check for events in view_data.events.future_events (prioritize future events)
                    if (serverData.view_data && serverData.view_data.events && serverData.view_data.events.future_events) {
                        const futureEvents = serverData.view_data.events.future_events;
                        console.log(`🎫 Eventbrite: Found ${futureEvents.length} future events in JSON data`);
                        
                        futureEvents.forEach(eventData => {
                            if (eventData.url && eventData.name && eventData.name.text) {
                                // Double-check that it's actually a future event
                                if (this.isFutureEvent(eventData)) {
                                    const event = this.parseJsonEvent(eventData);
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
                        const extractedEvents = this.extractEventsFromJsonData(jsonData);
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
    extractEventsFromJsonData(data, events = []) {
        if (!data || typeof data !== 'object') return events;
        
        // Check if this object looks like an event
        if (this.isEventObject(data)) {
            // Only process future events
            if (this.isFutureEvent(data)) {
                const event = this.parseJsonEvent(data);
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
                this.extractEventsFromJsonData(item, events);
            }
        } else if (typeof data === 'object') {
            for (const value of Object.values(data)) {
                this.extractEventsFromJsonData(value, events);
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
    parseJsonEvent(eventData) {
        try {
            const title = eventData.name || eventData.title || '';
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
                    console.log(`🎫 Eventbrite: Venue details for "${title}":`, {
                        venue: venue,
                        address: address,
                        fullAddressData: eventData.venue.address
                    });
                    
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
            
            const price = eventData.ticket_availability?.minimum_ticket_price?.display || '';
            const image = eventData.logo?.url || eventData.image?.url || '';
            
            // Enhanced city extraction using shared city utilities
            let city = null;
            
            if (this.cityUtils) {
                // Use shared city utilities for consistent extraction
                city = this.cityUtils.extractCityFromEvent(eventData, url);
                
                if (address && !city) {
                    city = this.cityUtils.extractCityFromAddress(address);
                }
                
                if (!city) {
                    const searchText = `${title} ${venue || ''}`;
                    city = this.cityUtils.extractCityFromText(searchText);
                }
                
                if (!city && url) {
                    city = this.cityUtils.extractCityFromText(url);
                }
            } else {
                // Fallback to old method if city utils not available
                if (address) {
                    city = this.extractCityFromAddress(address);
                }
                
                if (!city) {
                    const searchText = `${title} ${venue || ''}`;
                    city = this.extractCityFromText(searchText);
                }
                
                if (!city && url) {
                    city = this.extractCityFromText(url);
                }
            }
            
            // Special handling for Megawoof America events without explicit city
            if (!city && title && /megawoof|d[\>\s]*u[\>\s]*r[\>\s]*o/i.test(title) && !/(atlanta|denver|vegas|las vegas|long beach|new york|chicago|miami|san francisco|seattle|portland|austin|dallas|houston|phoenix|boston|philadelphia)/i.test(title)) {
                console.log(`🎫 Eventbrite: Megawoof event without explicit city, defaulting to LA: "${title}"`);
                city = 'la';
            }
            
            return {
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
                price: price,
                image: image,
                source: this.config.source,
                // Since alwaysBear is true in config, this will be overridden by shared-core anyway
                isBearEvent: this.config.alwaysBear
            };
            
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
            if (this.cityUtils) {
                city = this.cityUtils.extractCityFromText(title + ' ' + venue + ' ' + url);
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
                // Since alwaysBear is true in config, this will be overridden by shared-core anyway
                isBearEvent: this.config.alwaysBear
            };
            
        } catch (error) {
            console.warn(`🎫 Eventbrite: Failed to parse HTML event element: ${error}`);
            return null;
        }
    }

    // Extract additional URLs for detail page processing
    extractAdditionalUrls(html, sourceUrl, parserConfig) {
        const urls = new Set();
        
        try {
            console.log(`🎫 Eventbrite: Extracting additional links using regex patterns`);
            
            // More comprehensive patterns for Eventbrite event links (from old working script)
            const linkPatterns = [
                // Direct eventbrite.com/e/ links
                /href="([^"]*eventbrite\.com\/e\/[^"]*?)"/gi,
                // Relative /e/ links
                /href="(\/e\/[^"]*?)"/gi,
                // Links with event IDs
                /href="([^"]*\/events\/[^"]*?)"/gi,
                // Additional patterns for various link formats
                /href="([^"]*\/e\/[^"]*?)"[^>]*>/gi,
                /href='([^']*eventbrite\.com\/e\/[^']*?)'/gi,
                /href='(\/e\/[^']*?)'/gi
            ];
            
            linkPatterns.forEach((pattern, index) => {
                let match;
                let matchCount = 0;
                const maxMatches = parserConfig.maxAdditionalUrls || this.config.maxAdditionalUrls || 20;
                
                while ((match = pattern.exec(html)) !== null && matchCount < maxMatches) {
                    const href = match[1];
                    if (href) {
                        try {
                            let fullUrl;
                            if (href.startsWith('http')) {
                                fullUrl = href;
                            } else if (href.startsWith('/')) {
                                fullUrl = `https://www.eventbrite.com${href}`;
                            } else {
                                fullUrl = `${sourceUrl}/${href}`;
                            }
                            
                            // Clean up URL - remove query parameters except event ID
                            if (fullUrl.includes('?')) {
                                const [baseEventUrl] = fullUrl.split('?');
                                fullUrl = baseEventUrl;
                            }
                            
                            // Only add if it's actually an event URL and not already included
                            if ((fullUrl.includes('/e/') || fullUrl.includes('/events/')) && this.isValidEventUrl(fullUrl, parserConfig)) {
                                urls.add(fullUrl);
                                matchCount++;
                                console.log(`🎫 Eventbrite: Found event link (pattern ${index + 1}): ${fullUrl}`);
                            }
                        } catch (error) {
                            console.warn(`🎫 Eventbrite: Invalid link found: ${href}`);
                        }
                    }
                }
            });
            
            console.log(`🎫 Eventbrite: Extracted ${urls.size} additional URLs`);
            
        } catch (error) {
            console.warn(`🎫 Eventbrite: Error extracting additional URLs: ${error}`);
        }
        
        return Array.from(urls).slice(0, parserConfig.maxAdditionalUrls || this.config.maxAdditionalUrls || 20);
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
        const searchText = `${eventData.name || ''} ${eventData.description || ''} ${url || ''}`;
        return this.extractCityFromText(searchText);
    }

    // Extract city from text content
    extractCityFromText(text) {
        if (!this.cityUtils) {
            console.warn('🎫 Eventbrite: CityUtils not initialized, falling back to simple text extraction.');
            const cityMappings = {
                'new york|nyc|manhattan|brooklyn|queens|bronx': 'nyc',
                'los angeles|la|hollywood|west hollywood|weho': 'la',
                'san francisco|sf|castro': 'sf',
                'chicago|chi': 'chicago',
                'atlanta|atl': 'atlanta',
                'miami|south beach': 'miami',
                'seattle': 'seattle',
                'portland': 'portland',
                'denver': 'denver',
                'las vegas|vegas': 'vegas',
                'boston': 'boston',
                'philadelphia|philly': 'philadelphia',
                'austin': 'austin',
                'dallas': 'dallas',
                'houston': 'houston',
                'phoenix': 'phoenix'
            };
            
            const lowerText = text.toLowerCase();
            
            for (const [patterns, city] of Object.entries(cityMappings)) {
                const patternList = patterns.split('|');
                if (patternList.some(pattern => lowerText.includes(pattern))) {
                    return city;
                }
            }
            
            return null;
        }

        return this.cityUtils.extractCityFromText(text);
    }

    // Extract city from address (fallback method)
    extractCityFromAddress(address) {
        if (!this.cityUtils) {
            // Simple fallback extraction
            return this.extractCityFromText(address);
        }
        
        return this.cityUtils.extractCityFromAddress(address);
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
        const title = event.title || '';
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
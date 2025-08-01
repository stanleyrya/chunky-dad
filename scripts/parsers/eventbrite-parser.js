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
                
                return {
                    events: events,
                    additionalLinks: [], // JSON data already contains full event details
                    source: this.config.source,
                    url: htmlData.url
                };
            }
            
            // Fallback to HTML parsing if no JSON data found
            console.log('🎫 Eventbrite: No JSON data found, falling back to HTML parsing');
            
            // Parse HTML using regex (works in all environments)
            const htmlEvents = this.parseHTMLEvents(html, htmlData.url);
            events.push(...htmlEvents);
            
            // Extract additional URLs if required
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
            // Look for various JSON data patterns in Eventbrite pages
            const jsonPatterns = [
                /__SERVER_DATA__\s*=\s*({.+?});/,
                /window\.__INITIAL_STATE__\s*=\s*({.+?});/,
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
            const event = this.parseJsonEvent(data);
            if (event) {
                events.push(event);
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

    // Parse a JSON event object into our standard format
    parseJsonEvent(eventData) {
        try {
            const title = eventData.name || eventData.title || '';
            const description = eventData.description || eventData.summary || '';
            const startDate = eventData.start?.utc || eventData.start_date || eventData.startDate || eventData.start;
            const endDate = eventData.end?.utc || eventData.end_date || eventData.endDate || eventData.end;
            const url = eventData.url || eventData.vanity_url || '';
            const venue = eventData.venue?.name || eventData.venue?.address?.localized_area_display || '';
            const price = eventData.ticket_availability?.minimum_ticket_price?.display || '';
            const image = eventData.logo?.url || eventData.image?.url || '';
            
            // Extract city from venue or URL
            let city = this.extractCityFromEvent(eventData, url);
            
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
                city: city,
                url: url,
                price: price,
                image: image,
                source: this.config.source,
                isBearEvent: true // Assume bear event for Megawoof organizer
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
            
            // Extract city
            const city = this.extractCityFromText(title + ' ' + venue + ' ' + url);
            
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
                isBearEvent: false // Will be filtered later
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
            // Use configured URL patterns or defaults
            const patterns = parserConfig.urlPatterns || this.urlPatterns;
            
            for (const pattern of patterns) {
                const regex = new RegExp(pattern.regex, 'gi');
                let match;
                let matchCount = 0;
                
                while ((match = regex.exec(html)) !== null && matchCount < (pattern.maxMatches || 10)) {
                    const url = this.normalizeUrl(match[1], sourceUrl);
                    if (this.isValidEventUrl(url, parserConfig)) {
                        urls.add(url);
                        matchCount++;
                    }
                }
            }
            
            console.log(`🎫 Eventbrite: Extracted ${urls.size} additional URLs`);
            
        } catch (error) {
            console.warn(`🎫 Eventbrite: Error extracting additional URLs: ${error}`);
        }
        
        return Array.from(urls);
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
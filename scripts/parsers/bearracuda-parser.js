// ============================================================================
// BEARRACUDA PARSER - PURE PARSING LOGIC
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

class BearraccudaParser {
    constructor(config = {}) {
        this.config = {
            source: 'bearracuda',
            requireDetailPages: false,
            maxAdditionalUrls: 20,
            ...config
        };
        
        this.bearKeywords = [
            'bear', 'bears', 'woof', 'grr', 'furry', 'hairy',
            'daddy', 'cub', 'otter', 'leather', 'muscle bear', 'bearracuda',
            'furball', 'leather bears', 'bear night', 'bear party'
        ];
    }

    // Main parsing method - receives HTML data and returns events + additional links
    parseEvents(htmlData, parserConfig = {}) {
        try {
            console.log(`🐻 Bearracuda: Parsing events from ${htmlData.url}`);
            
            const events = [];
            const html = htmlData.html;
            
            if (!html) {
                console.warn('🐻 Bearracuda: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }
            
            // Try JSON parsing first (similar to eventbrite parser)
            const jsonEvents = this.extractEventsFromJson(html, parserConfig);
            if (jsonEvents.length > 0) {
                console.log(`🐻 Bearracuda: Found ${jsonEvents.length} events in JSON data`);
                events.push(...jsonEvents);
            } else {
                console.log('🐻 Bearracuda: No events found in JSON data, trying HTML parsing');
                // Fallback to HTML parsing
                const htmlEvents = this.parseHTMLEvents(html, htmlData.url, parserConfig);
                events.push(...htmlEvents);
            }
            
            // Extract additional URLs if required
            let additionalLinks = [];
            if (parserConfig.requireDetailPages) {
                additionalLinks = this.extractAdditionalUrls(html, htmlData.url, parserConfig);
            }
            
            console.log(`🐻 Bearracuda: Found ${events.length} events, ${additionalLinks.length} additional links`);
            
            return {
                events: events,
                additionalLinks: additionalLinks,
                source: this.config.source,
                url: htmlData.url
            };
            
        } catch (error) {
            console.error(`🐻 Bearracuda: Error parsing events: ${error}`);
            return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
        }
    }

    // Extract events from embedded JSON data (similar to eventbrite approach)
    extractEventsFromJson(html, parserConfig = {}) {
        const events = [];
        
        try {
            // Look for various JSON patterns that might contain event data
            const jsonPatterns = [
                // WordPress/Elementor data
                /var\s+wp_data\s*=\s*({[\s\S]*?});/,
                /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});/,
                /window\.__APP_DATA__\s*=\s*({[\s\S]*?});/,
                // Generic JSON-LD structured data
                /<script[^>]*type=["\']application\/ld\+json["\'][^>]*>([\s\S]*?)<\/script>/gi,
                // Event data arrays
                /"events":\s*(\[[\s\S]*?\])/,
                /"eventList":\s*(\[[\s\S]*?\])/,
                // Individual event objects
                /"event":\s*({[\s\S]*?})/
            ];
            
            for (const pattern of jsonPatterns) {
                const matches = html.match(pattern);
                if (matches) {
                    for (const match of matches) {
                        try {
                            // For script tags, extract the content
                            let jsonContent = match;
                            if (pattern.source.includes('script')) {
                                const contentMatch = match.match(/<script[^>]*>([\s\S]*?)<\/script>/);
                                if (contentMatch) {
                                    jsonContent = contentMatch[1];
                                }
                            } else if (pattern.source.includes('var\\s+') || pattern.source.includes('window')) {
                                // Extract the JSON part from variable assignments
                                const jsonMatch = match.match(/=\s*({[\s\S]*?});?$/);
                                if (jsonMatch) {
                                    jsonContent = jsonMatch[1];
                                }
                            }
                            
                            const jsonData = JSON.parse(jsonContent);
                            const extractedEvents = this.extractEventsFromJsonData(jsonData, [], parserConfig);
                            if (extractedEvents.length > 0) {
                                events.push(...extractedEvents);
                                console.log(`🐻 Bearracuda: Extracted ${extractedEvents.length} events from JSON pattern`);
                            }
                        } catch (parseError) {
                            console.warn(`🐻 Bearracuda: Failed to parse JSON data: ${parseError}`);
                        }
                    }
                }
            }
            
        } catch (error) {
            console.warn(`🐻 Bearracuda: Error extracting JSON events: ${error}`);
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
                console.log(`🐻 Bearracuda: Skipping past event: ${data.name || data.title || 'Unknown'}`);
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
               (obj.date || obj.startDate || obj.start_date || obj.start || obj.datetime) &&
               !Array.isArray(obj);
    }

    // Check if an event is in the future (not past)
    isFutureEvent(eventData) {
        const now = new Date();
        const startDate = eventData.date || eventData.startDate || eventData.start_date || eventData.start || eventData.datetime;
        
        if (!startDate) {
            // If no start date, assume it might be future and let it through
            return true;
        }
        
        try {
            const eventDate = new Date(startDate);
            return eventDate > now;
        } catch (error) {
            console.warn(`🐻 Bearracuda: Invalid date format: ${startDate}`);
            return true; // If we can't parse the date, let it through
        }
    }

    // Parse a JSON event object into our standard format
    parseJsonEvent(eventData, htmlContext = null, parserConfig = {}) {
        try {
            const title = eventData.name || eventData.title || 'Bearracuda Event';
            const description = eventData.description || eventData.summary || eventData.content || '';
            const startDate = eventData.date || eventData.startDate || eventData.start_date || eventData.start || eventData.datetime;
            const endDate = eventData.endDate || eventData.end_date || eventData.end;
            const url = eventData.url || eventData.link || eventData.permalink || '';
            
            // Enhanced venue processing
            let venue = null;
            let address = null;
            let coordinates = null;
            
            if (eventData.venue) {
                venue = typeof eventData.venue === 'string' ? eventData.venue : eventData.venue.name;
                if (eventData.venue.address) {
                    address = typeof eventData.venue.address === 'string' ? 
                        eventData.venue.address : 
                        `${eventData.venue.address.street || ''} ${eventData.venue.address.city || ''} ${eventData.venue.address.state || ''}`.trim();
                }
                
                // Extract coordinates if available
                if (eventData.venue.latitude && eventData.venue.longitude) {
                    coordinates = {
                        lat: parseFloat(eventData.venue.latitude),
                        lng: parseFloat(eventData.venue.longitude)
                    };
                }
            } else if (eventData.location) {
                venue = typeof eventData.location === 'string' ? eventData.location : eventData.location.name;
                if (eventData.location.address) {
                    address = eventData.location.address;
                }
            }
            
            // Extract price information
            let price = '';
            if (eventData.price !== undefined) {
                if (eventData.price === 0 || eventData.price === '0') {
                    price = 'Free';
                } else {
                    price = eventData.price.toString();
                    if (!price.includes('$')) {
                        price = '$' + price;
                    }
                }
            } else if (eventData.ticket_price) {
                price = eventData.ticket_price;
            }
            
            const image = eventData.image || eventData.featured_image || eventData.thumbnail || '';
            
            // Extract city from event data
            let city = this.extractCityFromEvent(eventData, url);
            
            const event = {
                title: title,
                description: description,
                startDate: startDate ? new Date(startDate) : null,
                endDate: endDate ? new Date(endDate) : null,
                bar: venue, // Use 'bar' field name that calendar-core.js expects
                location: coordinates ? `${coordinates.lat}, ${coordinates.lng}` : null, // Store coordinates as "lat,lng" string
                address: address,
                city: city,
                website: url, // Use 'website' field name that calendar-core.js expects
                cover: price, // Use 'cover' field name that calendar-core.js expects
                image: image,
                source: this.config.source,
                // Bearracuda events are always bear events
                isBearEvent: true
            };
            
            // Apply all metadata fields from config
            if (parserConfig.metadata) {
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
                });
            }
            
            console.log(`🐻 Bearracuda: Created event "${title}" with URL: ${url}`);
            
            return event;
            
        } catch (error) {
            console.warn(`🐻 Bearracuda: Failed to parse JSON event: ${error}`);
            return null;
        }
    }

    // Parse HTML events using regex (environment-agnostic)
    parseHTMLEvents(html, sourceUrl, parserConfig = {}) {
        const events = [];
        
        try {
            // Bearracuda-specific event patterns - updated for better detection
            const eventPatterns = [
                // WordPress post/event containers
                /<article[^>]*class="[^"]*post[^>]*>.*?<\/article>/gs,
                /<div[^>]*class="[^"]*event[^>]*>.*?<\/div>/gs,
                /<div[^>]*class="[^"]*party[^>]*>.*?<\/div>/gs,
                // Elementor widgets (common on bearracuda.com)
                /<div[^>]*class="[^"]*elementor-widget[^>]*>.*?<\/div>/gs,
                /<section[^>]*class="[^"]*elementor-section[^>]*>.*?<\/section>/gs,
                // Event cards or listings
                /<div[^>]*class="[^"]*card[^>]*>.*?<\/div>/gs,
                /<li[^>]*class="[^"]*event[^>]*>.*?<\/li>/gs,
                // Generic containers that might contain events
                /<div[^>]*id="[^"]*event[^>]*>.*?<\/div>/gs
            ];
            
            for (const pattern of eventPatterns) {
                const matches = html.match(pattern) || [];
                
                for (const match of matches) {
                    try {
                        const event = this.parseHTMLEventElement(match, sourceUrl, parserConfig);
                        if (event && this.isFutureEvent(event)) {
                            events.push(event);
                        }
                    } catch (error) {
                        console.warn(`🐻 Bearracuda: Failed to parse HTML event element: ${error}`);
                    }
                }
                
                if (events.length > 0) {
                    console.log(`🐻 Bearracuda: Found ${events.length} events using HTML pattern`);
                    break;
                }
            }
            
        } catch (error) {
            console.warn(`🐻 Bearracuda: Error parsing HTML events: ${error}`);
        }
        
        return events;
    }

    // Parse individual HTML event element
    parseHTMLEventElement(htmlElement, sourceUrl, parserConfig = {}) {
        try {
            // Extract title - Bearracuda often has distinctive naming
            const titleMatch = htmlElement.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/) ||
                              htmlElement.match(/class="[^"]*title[^>]*>([^<]+)</) ||
                              htmlElement.match(/class="[^"]*event-title[^>]*>([^<]+)</) ||
                              htmlElement.match(/class="[^"]*party-title[^>]*>([^<]+)</) ||
                              htmlElement.match(/<a[^>]*>([^<]*(?:bearracuda|bear|party)[^<]*)<\/a>/i);
            
            const title = titleMatch ? titleMatch[1].trim() : 'Bearracuda Event';
            
            // Skip if title doesn't seem event-related
            if (!this.isEventTitle(title)) {
                return null;
            }
            
            // Extract date/time with more patterns
            const dateMatch = htmlElement.match(/class="[^"]*date[^>]*>([^<]+)</) ||
                             htmlElement.match(/datetime="([^"]+)"/) ||
                             htmlElement.match(/data-date="([^"]+)"/) ||
                             htmlElement.match(/(\d{1,2}\/\d{1,2}\/\d{4})/) ||
                             htmlElement.match(/(\d{4}-\d{2}-\d{2})/) ||
                             htmlElement.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}/i);
            
            const dateString = dateMatch ? dateMatch[1].trim() : '';
            const startDate = this.parseDate(dateString);
            
            // Extract venue/location - Bearracuda parties are often at specific venues
            const venueMatch = htmlElement.match(/class="[^"]*venue[^>]*>([^<]+)</) ||
                              htmlElement.match(/class="[^"]*location[^>]*>([^<]+)</) ||
                              htmlElement.match(/class="[^"]*club[^>]*>([^<]+)</) ||
                              htmlElement.match(/<address[^>]*>([^<]+)<\/address>/) ||
                              htmlElement.match(/(?:at|@)\s+([^<\n,]+)/i);
            
            const venue = venueMatch ? venueMatch[1].trim() : '';
            
            // Extract description/details
            const descMatch = htmlElement.match(/class="[^"]*description[^>]*>([^<]+)</) ||
                             htmlElement.match(/class="[^"]*details[^>]*>([^<]+)</) ||
                             htmlElement.match(/class="[^"]*content[^>]*>([^<]+)</) ||
                             htmlElement.match(/<p[^>]*>([^<]+)<\/p>/);
            
            const description = descMatch ? descMatch[1].trim() : '';
            
            // Extract DJ/performer info if available
            let performers = '';
            const performerMatch = htmlElement.match(/class="[^"]*dj[^>]*>([^<]+)</) ||
                                  htmlElement.match(/class="[^"]*performer[^>]*>([^<]+)</) ||
                                  htmlElement.match(/class="[^"]*artist[^>]*>([^<]+)</) ||
                                  htmlElement.match(/(?:dj|featuring|with)\s+([^<\n,]+)/i);
            
            if (performerMatch) {
                performers = performerMatch[1].trim();
            }
            
            // Extract URL if available
            const urlMatch = htmlElement.match(/href="([^"]+)"/) ||
                            htmlElement.match(/data-url="([^"]+)"/);
            
            const eventUrl = urlMatch ? this.normalizeUrl(urlMatch[1], sourceUrl) : sourceUrl;
            
            // Extract city from venue or title
            const city = this.extractCityFromText(`${title} ${venue} ${description}`);
            
            // Combine description with performer info
            let fullDescription = description;
            if (performers) {
                fullDescription = fullDescription ? `${fullDescription}\n\nPerformers: ${performers}` : `Performers: ${performers}`;
            }
            
            const event = {
                title: title,
                description: fullDescription,
                startDate: startDate,
                endDate: null,
                bar: venue, // Use 'bar' field name that calendar-core.js expects
                location: null, // No coordinates available in HTML parsing
                address: '', // Address would need to be extracted separately
                city: city,
                website: eventUrl, // Use 'website' field name that calendar-core.js expects
                cover: '', // Use 'cover' field name that calendar-core.js expects
                image: '',
                source: this.config.source,
                isBearEvent: true // Bearracuda events are always bear events
            };
            
            // Apply all metadata fields from config
            if (parserConfig.metadata) {
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
                });
            }
            
            return event;
            
        } catch (error) {
            console.warn(`🐻 Bearracuda: Failed to parse HTML event element: ${error}`);
            return null;
        }
    }

    // Check if a title looks like an event title
    isEventTitle(title) {
        const eventKeywords = ['bearracuda', 'party', 'event', 'bear', 'night', 'pride', 'dance', 'club'];
        const titleLower = title.toLowerCase();
        return eventKeywords.some(keyword => titleLower.includes(keyword)) || titleLower.length > 5;
    }

    // Extract additional URLs for detail page processing
    extractAdditionalUrls(html, sourceUrl, parserConfig) {
        const urls = new Set();
        
        try {
            console.log(`🐻 Bearracuda: Extracting additional event URLs from HTML`);
            
            // Look for event-specific URLs
            const urlPatterns = [
                // Event detail page links
                /href="([^"]*\/events\/[^"]*)">/gi,
                /href="([^"]*\/event\/[^"]*)">/gi,
                // WordPress post links that might be events
                /href="([^"]*\/\d{4}\/\d{2}\/[^"]*)">/gi,
                // Any link with bear-related keywords
                /href="([^"]*(?:bear|party|pride|dance)[^"]*)">/gi
            ];
            
            for (const pattern of urlPatterns) {
                let match;
                while ((match = pattern.exec(html)) !== null) {
                    const url = this.normalizeUrl(match[1], sourceUrl);
                    if (this.isValidEventUrl(url, parserConfig)) {
                        urls.add(url);
                        console.log(`🐻 Bearracuda: Found event detail URL: ${url}`);
                    }
                    
                    // Limit to prevent infinite loops
                    if (urls.size >= (this.config.maxAdditionalUrls || 20)) {
                        break;
                    }
                }
            }
            
            console.log(`🐻 Bearracuda: Extracted ${urls.size} additional event links`);
            
        } catch (error) {
            console.warn(`🐻 Bearracuda: Error extracting additional URLs: ${error}`);
        }
        
        return Array.from(urls);
    }

    // Validate if URL is a valid event URL
    isValidEventUrl(url, parserConfig) {
        if (!url || typeof url !== 'string') return false;
        
        try {
            const urlObj = new URL(url);
            
            // Must be Bearracuda domain or related
            if (!urlObj.hostname.includes('bearracuda.com')) return false;
            
            // Avoid admin, login, or social media links
            const invalidPaths = ['/admin', '/login', '/wp-admin', '/wp-login', '#', 'javascript:', 'mailto:'];
            if (invalidPaths.some(invalid => url.includes(invalid))) return false;
            
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
        
        // Try location field
        if (eventData.location) {
            const location = typeof eventData.location === 'string' ? eventData.location : eventData.location.name || '';
            const cityFromLocation = this.extractCityFromText(location);
            if (cityFromLocation) {
                return cityFromLocation;
            }
        }
        
        // Try extracting from text
        const searchText = `${eventData.name || eventData.title || ''} ${eventData.description || ''} ${url || ''}`;
        return this.extractCityFromText(searchText);
    }

    // Extract city from text content
    extractCityFromText(text) {
        if (!text) return null;
        
        const cityPatterns = {
            'atlanta': /(atlanta|atl)/i,
            'denver': /(denver)/i,
            'vegas': /(vegas|las vegas)/i,
            'la': /(los angeles|la|long beach)/i,
            'nyc': /(new york|nyc|manhattan)/i,
            'chicago': /(chicago)/i,
            'miami': /(miami)/i,
            'sf': /(san francisco|sf)/i,
            'seattle': /(seattle)/i,
            'portland': /(portland)/i,
            'austin': /(austin)/i,
            'dallas': /(dallas)/i,
            'houston': /(houston)/i,
            'phoenix': /(phoenix)/i,
            'boston': /(boston)/i,
            'philadelphia': /(philadelphia|philly)/i,
            'dc': /(washington|dc)/i,
            'orlando': /(orlando)/i,
            'tampa': /(tampa)/i
        };
        
        for (const [city, pattern] of Object.entries(cityPatterns)) {
            if (pattern.test(text)) {
                console.log(`🐻 Bearracuda: Extracted city "${city}" from text: "${text.substring(0, 100)}..."`);
                return city;
            }
        }
        
        return null;
    }

    // Parse date string into ISO format
    parseDate(dateString) {
        if (!dateString) return null;
        
        try {
            // Clean up the date string
            dateString = dateString.replace(/\s+/g, ' ').trim();
            
            // Try various date formats common in event listings
            const formats = [
                // MM/DD/YYYY
                /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
                // Month DD, YYYY
                /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})/i,
                // DD Month YYYY
                /(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i,
                // ISO format
                /(\d{4})-(\d{2})-(\d{2})/
            ];
            
            for (const format of formats) {
                const match = dateString.match(format);
                if (match) {
                    let date;
                    
                    if (format.source.includes('january|february')) {
                        // Month name format
                        const months = {
                            'january': '01', 'february': '02', 'march': '03', 'april': '04',
                            'may': '05', 'june': '06', 'july': '07', 'august': '08',
                            'september': '09', 'october': '10', 'november': '11', 'december': '12'
                        };
                        
                        if (match[3]) {
                            // Month DD, YYYY format
                            const month = months[match[1].toLowerCase()];
                            const day = match[2].padStart(2, '0');
                            const year = match[3];
                            date = new Date(`${year}-${month}-${day}`);
                        } else {
                            // DD Month YYYY format
                            const day = match[1].padStart(2, '0');
                            const month = months[match[2].toLowerCase()];
                            const year = match[3];
                            date = new Date(`${year}-${month}-${day}`);
                        }
                    } else {
                        // Numeric formats
                        date = new Date(dateString);
                    }
                    
                    if (!isNaN(date.getTime())) {
                        return date;
                    }
                }
            }
            
            // Fallback to Date constructor
            const date = new Date(dateString);
            if (!isNaN(date.getTime())) {
                return date;
            }
            
        } catch (error) {
            console.warn(`🐻 Bearracuda: Failed to parse date "${dateString}": ${error}`);
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
        
        // Handle anchor links (skip them)
        if (url.startsWith('#')) {
            return null;
        }
        
        return url;
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { BearraccudaParser };
} else if (typeof window !== 'undefined') {
    window.BearraccudaParser = BearraccudaParser;
} else {
    // Scriptable environment
    this.BearraccudaParser = BearraccudaParser;
}
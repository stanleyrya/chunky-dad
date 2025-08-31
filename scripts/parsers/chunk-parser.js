// ============================================================================
// CHUNK PARSER - PURE PARSING LOGIC
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE parsing logic only
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Pure JavaScript parsing functions (HTML/JSON processing)
// ✅ Venue-specific extraction logic for Chunk parties
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

class ChunkParser {
    constructor(config = {}) {
        this.config = {
            source: 'chunk',
            maxAdditionalUrls: null, // No limit by default
            ...config
        };
        
        // Note: Chunk parties are always bear events, so no keyword filtering needed
        // This is handled by setting alwaysBear: true in the scraper configuration
    }

    // Main parsing method - receives HTML data and returns events + additional links
    parseEvents(htmlData, parserConfig = {}, cityConfig = null) {
        try {
            const events = [];
            const html = htmlData.html;
            const url = htmlData.url;
            
            if (!html) {
                console.warn('🎉 Chunk: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: url };
            }
            
            console.log(`🎉 Chunk: Parsing URL: ${url}`);
            
            // Check if this is a detail page or main page
            const isDetailPage = url.includes('/event-details/');
            
            if (isDetailPage) {
                // Parse detail page using JSON-LD schema
                const detailEvent = this.parseDetailPage(html, url, parserConfig, cityConfig);
                if (detailEvent) {
                    events.push(detailEvent);
                    console.log(`🎉 Chunk: Parsed detail page event: ${detailEvent.title}`);
                }
            } else {
                // Parse main page for upcoming events
                const mainPageEvents = this.parseMainPage(html, url, parserConfig, cityConfig);
                events.push(...mainPageEvents);
                console.log(`🎉 Chunk: Found ${mainPageEvents.length} events on main page`);
            }
            
            // Extract additional URLs if urlDiscoveryDepth > 0
            let additionalLinks = [];
            if (parserConfig.urlDiscoveryDepth > 0) {
                additionalLinks = this.extractAdditionalUrls(html, url, parserConfig);
                console.log(`🎉 Chunk: Found ${additionalLinks.length} additional links`);
            }
            
            return {
                events: events,
                additionalLinks: additionalLinks,
                source: this.config.source,
                url: url
            };
            
        } catch (error) {
            console.error(`🎉 Chunk: Error parsing events: ${error}`);
            return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
        }
    }

    // Parse detail page using JSON-LD schema
    parseDetailPage(html, url, parserConfig, cityConfig) {
        try {
            // Extract JSON-LD schema data
            const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
            
            if (jsonLdMatch && jsonLdMatch[1]) {
                try {
                    // Clean up the JSON string
                    let jsonString = jsonLdMatch[1].trim();
                    
                    // Replace HTML entities
                    jsonString = jsonString
                        .replace(/&quot;/g, '"')
                        .replace(/&#010;/g, '\n')
                        .replace(/&#x27;/g, "'")
                        .replace(/&amp;/g, '&')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>');
                    
                    const jsonData = JSON.parse(jsonString);
                    
                    if (jsonData['@type'] === 'Event') {
                        return this.parseJsonLdEvent(jsonData, url, parserConfig, cityConfig);
                    }
                } catch (error) {
                    console.warn(`🎉 Chunk: Failed to parse JSON-LD: ${error}`);
                }
            }
            
            // Fallback to parsing HTML content if JSON-LD fails
            return this.parseDetailPageHtml(html, url, parserConfig, cityConfig);
            
        } catch (error) {
            console.warn(`🎉 Chunk: Error parsing detail page: ${error}`);
            return null;
        }
    }

    // Parse JSON-LD event data
    parseJsonLdEvent(jsonData, url, parserConfig, cityConfig) {
        try {
            const title = jsonData.name || 'Untitled Event';
            const description = jsonData.description || '';
            const startDate = jsonData.startDate ? new Date(jsonData.startDate) : null;
            const endDate = jsonData.endDate ? new Date(jsonData.endDate) : null;
            
            // Extract venue information
            let venue = '';
            let address = '';
            let city = null;
            
            if (jsonData.location) {
                venue = jsonData.location.name || '';
                address = jsonData.location.address || '';
                
                // Extract city from venue name or address
                city = this.extractCityFromText(`${venue} ${address} ${title}`);
            }
            
            // Extract price information from offers
            let price = '';
            if (jsonData.offers) {
                if (jsonData.offers.lowPrice && jsonData.offers.highPrice) {
                    const low = parseFloat(jsonData.offers.lowPrice);
                    const high = parseFloat(jsonData.offers.highPrice);
                    if (low === high) {
                        price = `$${low.toFixed(2)}`;
                    } else {
                        price = `$${low.toFixed(2)} - $${high.toFixed(2)}`;
                    }
                } else if (jsonData.offers.price) {
                    price = `$${parseFloat(jsonData.offers.price).toFixed(2)}`;
                }
            }
            
            // Extract image URL if available
            let image = jsonData.image || '';
            if (Array.isArray(image) && image.length > 0) {
                image = image[0];
            }
            
            // Get ticket URL from offers or use the detail page URL
            const ticketUrl = (jsonData.offers && jsonData.offers.url) || url;
            
            const event = {
                title: title,
                description: description,
                startDate: startDate,
                endDate: endDate,
                bar: venue,
                location: null, // No coordinates in JSON-LD
                address: address,
                city: city,
                timezone: this.getTimezoneForCity(city, cityConfig),
                url: url,
                ticketUrl: ticketUrl,
                cover: price,
                image: image,
                source: this.config.source,
                isBearEvent: true // Chunk parties are always bear events
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
            
            console.log(`🎉 Chunk: Created event from JSON-LD: ${title} on ${startDate}`);
            
            return event;
            
        } catch (error) {
            console.warn(`🎉 Chunk: Failed to parse JSON-LD event: ${error}`);
            return null;
        }
    }

    // Fallback HTML parsing for detail page
    parseDetailPageHtml(html, url, parserConfig, cityConfig) {
        try {
            // Extract title from meta tags or page title
            let title = '';
            const titleMatch = html.match(/<title>([^<]+)<\/title>/i) ||
                              html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
            if (titleMatch) {
                title = titleMatch[1].replace(' | CHUNK', '').trim();
            }
            
            // Extract description from meta tags
            let description = '';
            const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i) ||
                             html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
            if (descMatch) {
                description = descMatch[1];
            }
            
            // Extract date and time
            let startDate = null;
            let endDate = null;
            
            // Look for date patterns in the description
            const dateMatch = description.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i);
            const timeMatch = description.match(/(\d{1,2}):(\d{2})\s*(PM|AM)/gi);
            
            if (dateMatch) {
                const monthNames = {
                    'january': 0, 'february': 1, 'march': 2, 'april': 3,
                    'may': 4, 'june': 5, 'july': 6, 'august': 7,
                    'september': 8, 'october': 9, 'november': 10, 'december': 11
                };
                
                const month = monthNames[dateMatch[1].toLowerCase()];
                const day = parseInt(dateMatch[2]);
                const year = parseInt(dateMatch[3]);
                
                if (timeMatch && timeMatch.length > 0) {
                    // Parse start time
                    const startTimeMatch = timeMatch[0].match(/(\d{1,2}):(\d{2})\s*(PM|AM)/i);
                    if (startTimeMatch) {
                        let hours = parseInt(startTimeMatch[1]);
                        const minutes = parseInt(startTimeMatch[2]);
                        const ampm = startTimeMatch[3].toUpperCase();
                        
                        if (ampm === 'PM' && hours !== 12) hours += 12;
                        if (ampm === 'AM' && hours === 12) hours = 0;
                        
                        startDate = new Date(year, month, day, hours, minutes);
                    }
                    
                    // Parse end time if available
                    if (timeMatch.length > 1) {
                        const endTimeMatch = timeMatch[1].match(/(\d{1,2}):(\d{2})\s*(PM|AM)/i);
                        if (endTimeMatch) {
                            let hours = parseInt(endTimeMatch[1]);
                            const minutes = parseInt(endTimeMatch[2]);
                            const ampm = endTimeMatch[3].toUpperCase();
                            
                            if (ampm === 'PM' && hours !== 12) hours += 12;
                            if (ampm === 'AM' && hours === 12) hours = 0;
                            
                            // If end time is in AM and start time was PM, it's next day
                            let endDay = day;
                            if (ampm === 'AM' && startDate && startDate.getHours() > 12) {
                                endDay = day + 1;
                            }
                            
                            endDate = new Date(year, month, endDay, hours, minutes);
                        }
                    }
                } else {
                    // No time found, set to evening by default
                    startDate = new Date(year, month, day, 22, 0); // 10 PM default
                }
            }
            
            // Extract venue and address
            let venue = '';
            let address = '';
            
            // Look for venue patterns in description
            const venuePatterns = [
                /([A-Z0-9][A-Z0-9\s&]+(?:NIGHTCLUB|CLUB|BAR|LOUNGE|VENUE))/,
                /at\s+([^\/\n]+)/i
            ];
            
            for (const pattern of venuePatterns) {
                const match = description.match(pattern);
                if (match) {
                    venue = match[1].trim();
                    break;
                }
            }
            
            // Look for address pattern
            const addressMatch = description.match(/(\d+\s+[A-Z][A-Za-z\s]+(?:ST|STREET|AVE|AVENUE|RD|ROAD|BLVD|BOULEVARD))/i);
            if (addressMatch) {
                address = addressMatch[1].trim();
            }
            
            // Extract city
            const city = this.extractCityFromText(`${title} ${description} ${venue} ${address}`);
            
            // Extract price
            let price = '';
            const priceMatches = html.match(/\$(\d+(?:\.\d{2})?)/g);
            if (priceMatches && priceMatches.length > 0) {
                if (priceMatches.length === 1) {
                    price = priceMatches[0];
                } else {
                    // Find min and max prices
                    const prices = priceMatches.map(p => parseFloat(p.replace('$', ''))).sort((a, b) => a - b);
                    price = `$${prices[0].toFixed(2)} - $${prices[prices.length - 1].toFixed(2)}`;
                }
            }
            
            // Extract image URL from og:image
            let image = '';
            const imageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
            if (imageMatch) {
                image = imageMatch[1];
            }
            
            const event = {
                title: title,
                description: description,
                startDate: startDate,
                endDate: endDate,
                bar: venue,
                location: null,
                address: address,
                city: city,
                timezone: this.getTimezoneForCity(city, cityConfig),
                url: url,
                ticketUrl: url, // Detail page is also the ticket page
                cover: price,
                image: image,
                source: this.config.source,
                isBearEvent: true // Chunk parties are always bear events
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
            
            console.log(`🎉 Chunk: Created event from HTML: ${title}`);
            
            return event;
            
        } catch (error) {
            console.warn(`🎉 Chunk: Failed to parse detail page HTML: ${error}`);
            return null;
        }
    }

    // Parse main page for upcoming events
    parseMainPage(html, url, parserConfig, cityConfig) {
        const events = [];
        
        try {
            // Look for "Upcoming Events" section
            // The main page shows event cards with dates and titles
            
            // Extract event titles and dates from the HTML
            // Pattern: Look for date patterns followed by event names
            const eventPatterns = [
                /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})[^<]*?([A-Z][^<]+)/gi
            ];
            
            for (const pattern of eventPatterns) {
                let match;
                while ((match = pattern.exec(html)) !== null) {
                    const monthName = match[1];
                    const day = parseInt(match[2]);
                    const year = parseInt(match[3]);
                    let title = match[4].trim();
                    
                    // Clean up title
                    title = title.replace(/["\n\r]/g, '').trim();
                    
                    // Skip if title is too short or looks like HTML
                    if (title.length < 5 || title.includes('<') || title.includes('>')) {
                        continue;
                    }
                    
                    const monthNames = {
                        'january': 0, 'february': 1, 'march': 2, 'april': 3,
                        'may': 4, 'june': 5, 'july': 6, 'august': 7,
                        'september': 8, 'october': 9, 'november': 10, 'december': 11
                    };
                    
                    const month = monthNames[monthName.toLowerCase()];
                    const startDate = new Date(year, month, day, 22, 0); // Default to 10 PM
                    
                    // Extract city from title
                    const city = this.extractCityFromText(title);
                    
                    const event = {
                        title: `CHUNK ${title}`,
                        description: '',
                        startDate: startDate,
                        endDate: null,
                        bar: '',
                        location: null,
                        address: '',
                        city: city,
                        timezone: this.getTimezoneForCity(city, cityConfig),
                        url: url,
                        ticketUrl: url,
                        cover: '',
                        image: '',
                        source: this.config.source,
                        isBearEvent: true
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
                    
                    events.push(event);
                    console.log(`🎉 Chunk: Found main page event: ${title} on ${monthName} ${day}, ${year}`);
                }
            }
            
        } catch (error) {
            console.warn(`🎉 Chunk: Error parsing main page events: ${error}`);
        }
        
        return events;
    }

    // Extract additional URLs for detail page processing
    extractAdditionalUrls(html, sourceUrl, parserConfig) {
        const urls = new Set();
        
        try {
            // Look for event detail page links
            const linkPatterns = [
                /href="(\/event-details\/[^"]+)"/gi,
                /href="(https?:\/\/[^"]*chunk-party\.com\/event-details\/[^"]+)"/gi
            ];
            
            for (const pattern of linkPatterns) {
                let match;
                while ((match = pattern.exec(html)) !== null) {
                    let url = match[1];
                    
                    // Make relative URLs absolute
                    if (url.startsWith('/')) {
                        url = `https://www.chunk-party.com${url}`;
                    }
                    
                    // Validate URL
                    if (this.isValidEventUrl(url)) {
                        urls.add(url);
                    }
                }
            }
            
            console.log(`🎉 Chunk: Extracted ${urls.size} additional event detail URLs`);
            
        } catch (error) {
            console.warn(`🎉 Chunk: Error extracting additional URLs: ${error}`);
        }
        
        // Limit to configured max (if specified)
        const maxUrls = parserConfig.maxAdditionalUrls !== undefined ? parserConfig.maxAdditionalUrls : this.config.maxAdditionalUrls;
        
        if (maxUrls === null) {
            // No limit
            return Array.from(urls);
        } else {
            // Apply limit
            return Array.from(urls).slice(0, maxUrls);
        }
    }

    // Validate if URL is a valid event URL
    isValidEventUrl(url) {
        if (!url || typeof url !== 'string') return false;
        
        try {
            // Must be a Chunk party domain
            if (!url.includes('chunk-party.com')) return false;
            
            // Should be an event details page
            if (!url.includes('/event-details/')) return false;
            
            // Avoid duplicate or invalid patterns
            if (url.includes('#') || url.includes('?')) return false;
            
            return true;
            
        } catch (error) {
            return false;
        }
    }

    // Extract city from text
    extractCityFromText(text) {
        const cityPatterns = {
            'sf': /san francisco|sf|folsom/i,
            'chicago': /chicago/i,
            'portland': /portland/i,
            'nyc': /new york|nyc|manhattan|brooklyn/i,
            'la': /los angeles|la|hollywood|weho/i,
            'seattle': /seattle/i,
            'denver': /denver/i,
            'atlanta': /atlanta/i,
            'miami': /miami/i,
            'boston': /boston/i,
            'philadelphia': /philadelphia|philly/i,
            'austin': /austin/i,
            'dallas': /dallas/i,
            'houston': /houston/i,
            'phoenix': /phoenix/i,
            'dc': /washington|dc/i,
            'orlando': /orlando/i,
            'tampa': /tampa/i,
            'vegas': /vegas|las vegas/i
        };
        
        for (const [city, pattern] of Object.entries(cityPatterns)) {
            if (pattern.test(text)) {
                return city;
            }
        }
        
        return null;
    }

    // Get timezone for a city using centralized configuration
    getTimezoneForCity(city, cityConfig = null) {
        // City config must be provided - no fallbacks
        if (!cityConfig || !cityConfig[city]) {
            console.log(`🎉 Chunk: No timezone configuration found for city: ${city}`);
            return null;
        }
        
        return cityConfig[city].timezone;
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ChunkParser };
} else if (typeof window !== 'undefined') {
    window.ChunkParser = ChunkParser;
} else {
    // Scriptable environment
    this.ChunkParser = ChunkParser;
}
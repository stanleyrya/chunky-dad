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
            
            // ONLY TWO PATHS: Detail page with JSON-LD, or main page for URL extraction
            const isDetailPage = url.includes('/event-details/');
            
            if (isDetailPage) {
                // Detail pages ALWAYS have JSON-LD - this is the ONLY way we parse them
                const event = this.parseDetailPageJsonLD(html, url, parserConfig, cityConfig);
                if (event) {
                    events.push(event);
                    console.log(`🎉 Chunk: Parsed event from JSON-LD: ${event.title}`);
                }
            }
            
            // Extract additional event detail URLs (works on both main and detail pages)
            let additionalLinks = [];
            if (parserConfig.urlDiscoveryDepth > 0) {
                additionalLinks = this.extractEventDetailUrls(html);
                if (additionalLinks.length > 0) {
                    console.log(`🎉 Chunk: Found ${additionalLinks.length} event detail URLs`);
                }
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

    // Parse detail page using JSON-LD (the ONLY method that works reliably)
    parseDetailPageJsonLD(html, url, parserConfig, cityConfig) {
        try {
            // Extract JSON-LD schema - Chunk detail pages ALWAYS have this
            const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
            
            if (!jsonLdMatch || !jsonLdMatch[1]) {
                console.warn(`🎉 Chunk: No JSON-LD found on detail page: ${url}`);
                return null;
            }
            
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
            
            if (jsonData['@type'] !== 'Event') {
                console.warn(`🎉 Chunk: JSON-LD is not an Event type: ${jsonData['@type']}`);
                return null;
            }
            
            // Extract all the data we need from JSON-LD
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
            
            // Extract image URL
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
            
            console.log(`🎉 Chunk: Successfully parsed event: ${title} on ${startDate}`);
            
            return event;
            
        } catch (error) {
            console.error(`🎉 Chunk: Failed to parse JSON-LD: ${error}`);
            return null;
        }
    }

    // Extract event detail URLs - the ONLY thing we need from the main page
    extractEventDetailUrls(html) {
        const urls = new Set();
        
        try {
            // Look for event detail page links - these are the ONLY URLs we care about
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
                    
                    // Only add valid event detail URLs
                    if (url.includes('chunk-party.com') && url.includes('/event-details/')) {
                        urls.add(url);
                    }
                }
            }
            
        } catch (error) {
            console.warn(`🎉 Chunk: Error extracting event detail URLs: ${error}`);
        }
        
        // Return all found URLs (no limit if maxAdditionalUrls is null)
        return Array.from(urls);
    }

    // Extract city from text - simple pattern matching
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
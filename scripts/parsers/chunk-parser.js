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
            
            // Replace HTML entities - these are the most common issues
            jsonString = jsonString
                .replace(/&quot;/g, '"')
                .replace(/&#010;/g, ' ')  // Replace newline entities with space
                .replace(/&#x27;/g, "'")
                .replace(/&apos;/g, "'")   // Apostrophe entity
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&nbsp;/g, ' ')
                .replace(/&#039;/g, "'")
                .replace(/&#8217;/g, "'")  // Right single quote
                .replace(/&#8220;/g, '"')  // Left double quote
                .replace(/&#8221;/g, '"'); // Right double quote
            
            // Clean up common JSON issues before parsing
            jsonString = jsonString
                .replace(/,(\s*[}\]])/g, '$1')  // Remove trailing commas
                .replace(/([^\\])\\n/g, '$1 ')  // Replace literal \n with space
                .replace(/([^\\])\\r/g, '$1')   // Remove literal \r
                .replace(/([^\\])\\t/g, '$1 '); // Replace literal \t with space
            
            // Try to parse the JSON
            let jsonData;
            try {
                jsonData = JSON.parse(jsonString);
            } catch (parseError) {
                // If parsing fails, try more aggressive cleaning
                console.warn(`🎉 Chunk: Initial JSON parse failed, attempting cleanup: ${parseError.message}`);
                
                // Remove any control characters that might be causing issues
                jsonString = jsonString
                    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' '); // Replace control chars with space
                
                // Try one more time
                try {
                    jsonData = JSON.parse(jsonString);
                } catch (finalError) {
                    console.error(`🎉 Chunk: Failed to parse JSON-LD: ${finalError}`);
                    return null;
                }
            }
            
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
            
            if (jsonData.location) {
                venue = jsonData.location.name || '';
                address = jsonData.location.address || '';
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
            
            // Extract image URL - handle various formats
            let image = '';
            if (jsonData.image) {
                if (typeof jsonData.image === 'string') {
                    // Simple string URL
                    image = jsonData.image;
                } else if (typeof jsonData.image === 'object') {
                    // ImageObject with url property
                    if (jsonData.image.url) {
                        image = jsonData.image.url;
                    } else if (jsonData.image['@type'] === 'ImageObject' && jsonData.image.contentUrl) {
                        image = jsonData.image.contentUrl;
                    }
                } else if (Array.isArray(jsonData.image) && jsonData.image.length > 0) {
                    // Array of images - take the first one
                    const firstImage = jsonData.image[0];
                    if (typeof firstImage === 'string') {
                        image = firstImage;
                    } else if (typeof firstImage === 'object' && firstImage.url) {
                        image = firstImage.url;
                    } else if (typeof firstImage === 'object' && firstImage.contentUrl) {
                        image = firstImage.contentUrl;
                    }
                }
            }
            
            // Get ticket URL from offers or use the detail page URL
            const ticketUrl = (jsonData.offers && jsonData.offers.url) || url;
            
            // Try to extract coordinates from Wix warmup data
            let location = null;
            const wixWarmupMatch = html.match(/"coordinates":\s*{\s*"lat":\s*([\d.-]+),\s*"lng":\s*([\d.-]+)/);
            if (wixWarmupMatch) {
                location = {
                    lat: parseFloat(wixWarmupMatch[1]),
                    lng: parseFloat(wixWarmupMatch[2])
                };
            }
            
            const event = {
                title: title,
                description: description,
                startDate: startDate,
                endDate: endDate,
                bar: venue,
                location: location, // Coordinates from Wix warmup data
                address: address,
                city: null, // Let SharedCore detect city from address/venue
                timezone: null, // Let SharedCore assign timezone based on detected city
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
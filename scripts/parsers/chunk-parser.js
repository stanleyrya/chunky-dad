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
            
            // ONLY TWO PATHS: Detail page with JSON-LD, or main page for URL extraction
            const isDetailPage = url.includes('/event-details/');
            
            if (isDetailPage) {
                // Detail pages ALWAYS have JSON-LD - this is the ONLY way we parse them
                const event = this.parseDetailPageJsonLD(html, url, parserConfig, cityConfig);
                if (event) {
                    events.push(event);
                }
            }
            
            // Extract additional event detail URLs (works on both main and detail pages)
            let additionalLinks = [];
            if (parserConfig.urlDiscoveryDepth > 0) {
                additionalLinks = this.extractEventDetailUrls(html);
            }

            const linkSuffix = additionalLinks.length > 0
                ? `, ${additionalLinks.length} link${additionalLinks.length === 1 ? '' : 's'}`
                : '';
            console.log(`🎉 Chunk: Parsed ${events.length} event${events.length === 1 ? '' : 's'}${linkSuffix}`);
            
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
            // Extract ALL JSON-LD schemas - Chunk detail pages have multiple, we need the right one
            const jsonLdMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
            
            if (!jsonLdMatches || jsonLdMatches.length === 0) {
                console.warn(`🎉 Chunk: No JSON-LD found on detail page: ${url}`);
                return null;
            }
            
            // Try each JSON-LD block to find the Event one with timezone information
            let jsonData = null;
            let selectedJsonString = null;
            
            for (const match of jsonLdMatches) {
                const contentMatch = match.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
                if (!contentMatch || !contentMatch[1]) continue;
                
                // Clean up the JSON string for this block
                let testJsonString = contentMatch[1].trim();
                testJsonString = testJsonString
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
                testJsonString = testJsonString
                    .replace(/,(\s*[}\]])/g, '$1')  // Remove trailing commas
                    .replace(/([^\\])\\n/g, '$1 ')  // Replace literal \n with space
                    .replace(/([^\\])\\r/g, '$1')   // Remove literal \r
                    .replace(/([^\\])\\t/g, '$1 '); // Replace literal \t with space
                
                // Try to parse this JSON block
                let testJsonData;
                try {
                    testJsonData = JSON.parse(testJsonString);
                } catch (parseError) {
                    // If parsing fails, try more aggressive cleaning
                    testJsonString = testJsonString
                        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' '); // Replace control chars with space
                    
                    try {
                        testJsonData = JSON.parse(testJsonString);
                    } catch (finalError) {
                        console.warn(`🎉 Chunk: Failed to parse JSON-LD block: ${finalError.message}`);
                        continue; // Try next JSON-LD block
                    }
                }
                
                // Check if this is an Event type
                if (testJsonData['@type'] !== 'Event') {
                    continue; // Not an event, try next block
                }
                
                // Use the first valid Event JSON-LD block we find
                // JavaScript Date() will handle any timezone format correctly
                if (!jsonData) {
                    jsonData = testJsonData;
                    selectedJsonString = testJsonString;
                }
            }
            
            if (!jsonData) {
                console.warn(`🎉 Chunk: No valid Event JSON-LD found on detail page: ${url}`);
                return null;
            }
            
            // Extract all the data we need from JSON-LD
            const title = jsonData.name || 'Untitled Event';
            const description = jsonData.description || '';
            
            // Extract venue information first to detect location
            let venue = '';
            let address = '';
            if (jsonData.location) {
                venue = jsonData.location.name || '';
                address = jsonData.location.address || '';
            }
            
            // CHUNK provides dates with timezone offsets in their JSON-LD
            // BUG FIX: CHUNK website publishes incorrect timezone offsets for non-Pacific events
            // Chicago events show -07:00 (Pacific) instead of -06:00 (Central)
            let startDate = null;
            let endDate = null;
            
            if (jsonData.startDate) {
                // Detect city from address to determine correct timezone
                const detectedCity = this.detectCityFromAddress(address, cityConfig);
                const correctedStartDate = this.correctTimezoneIfNeeded(jsonData.startDate, detectedCity, cityConfig);
                
                try {
                    startDate = new Date(correctedStartDate);
                } catch (error) {
                    console.warn(`🎉 Chunk: Could not parse date format: ${correctedStartDate}, error: ${error}`);
                    startDate = null;
                }
            }
            
            if (jsonData.endDate) {
                // Apply same timezone correction to end date
                const detectedCity = this.detectCityFromAddress(address, cityConfig);
                const correctedEndDate = this.correctTimezoneIfNeeded(jsonData.endDate, detectedCity, cityConfig);
                
                try {
                    endDate = new Date(correctedEndDate);
                } catch (error) {
                    console.warn(`🎉 Chunk: Could not parse end date format: ${correctedEndDate}, error: ${error}`);
                    endDate = null;
                }
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
            
            // Try to extract coordinates from Wix warmup data and format as string
            let location = null;
            const wixWarmupMatch = html.match(/"coordinates":\s*{\s*"lat":\s*([\d.-]+),\s*"lng":\s*([\d.-]+)/);
            if (wixWarmupMatch) {
                const lat = parseFloat(wixWarmupMatch[1]);
                const lng = parseFloat(wixWarmupMatch[2]);
                location = `${lat}, ${lng}`; // Store as "lat, lng" string like eventbrite parser
            }
            
            const event = {
                title: title,
                description: description,
                startDate: startDate,
                endDate: endDate,
                bar: venue,
                location: location, // Coordinates as "lat, lng" string (same format as eventbrite parser)
                address: address,
                city: null, // Let SharedCore detect city from address/venue
                timezone: null, // Will be set by SharedCore after city detection
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

    // Detect city from address using centralized city configuration
    detectCityFromAddress(address, cityConfig) {
        if (!address || !cityConfig) return null;
        
        const addressLower = address.toLowerCase();
        
        // Use centralized city configuration from scraper-cities.js
        for (const [cityKey, cityData] of Object.entries(cityConfig)) {
            if (cityData.patterns) {
                for (const pattern of cityData.patterns) {
                    // Use word boundaries to avoid substring matches
                    const regex = new RegExp(`\\b${pattern.replace(/\s+/g, '\\s+')}\\b`, 'i');
                    if (regex.test(addressLower)) {
                        return cityKey;
                    }
                }
            }
        }
        
        console.warn(`🎉 Chunk: Could not detect city from address: ${address}`);
        return null;
    }

    // Correct timezone offset if CHUNK published wrong timezone data
    correctTimezoneIfNeeded(dateString, detectedCity, cityConfig) {
        if (!dateString || !detectedCity || !cityConfig) {
            return dateString; // No correction possible
        }
        
        // Get timezone from centralized city configuration
        const cityData = cityConfig[detectedCity];
        if (!cityData || !cityData.timezone) {
            return dateString; // No correction for unknown cities
        }
        
        // Extract the current timezone offset from the date string
        const timezoneMatch = dateString.match(/([+-]\d{2}:\d{2})$/);
        if (!timezoneMatch) {
            return dateString; // No timezone offset to correct
        }
        
        const currentOffset = timezoneMatch[1];
        
        // Create a temporary date object in the city's timezone to get the correct offset
        // This uses the browser's built-in timezone handling
        const tempDate = new Date(dateString.replace(currentOffset, ''));
        
        // Use Intl.DateTimeFormat to get the correct offset for this city's timezone at this date
        try {
            const formatter = new Intl.DateTimeFormat('en', {
                timeZone: cityData.timezone,
                timeZoneName: 'longOffset'
            });
            
            const parts = formatter.formatToParts(tempDate);
            const offsetPart = parts.find(part => part.type === 'timeZoneName');
            
            if (offsetPart && offsetPart.value) {
                // Convert from "GMT-05:00" format to "-05:00" format
                const expectedOffset = offsetPart.value.replace('GMT', '');
                
                if (currentOffset === expectedOffset) {
                    return dateString; // Already correct
                }
                
                // Apply timezone correction
                const correctedDateString = dateString.replace(currentOffset, expectedOffset);
                return correctedDateString;
            }
        } catch (error) {
            console.warn(`🎉 Chunk: Could not determine timezone offset for ${cityData.timezone}: ${error}`);
        }
        
        // Fallback: return original if we can't determine the correct offset
        return dateString;
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
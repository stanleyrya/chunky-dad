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
                    console.log(`🎉 Chunk: Selected JSON-LD: ${testJsonData.startDate}`);
                }
            }
            
            if (!jsonData) {
                console.warn(`🎉 Chunk: No valid Event JSON-LD found on detail page: ${url}`);
                return null;
            }
            
            // Extract all the data we need from JSON-LD
            const title = jsonData.name || 'Untitled Event';
            const description = jsonData.description || '';
            
            // Smart timezone handling - detect and correct website timezone misconfigurations
            let startDate = jsonData.startDate ? new Date(jsonData.startDate) : null;
            let endDate = jsonData.endDate ? new Date(jsonData.endDate) : null;
            
            // Extract venue information first to detect location
            let venue = '';
            let address = '';
            if (jsonData.location) {
                venue = jsonData.location.name || '';
                address = jsonData.location.address || '';
            }
            
            // Attempt to correct timezone misconfigurations
            if (startDate && address) {
                const correctedTimes = this.correctTimezoneIfNeeded(startDate, endDate, address, html, jsonData.startDate);
                startDate = correctedTimes.startDate;
                endDate = correctedTimes.endDate;
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

    // Smart timezone correction - detect and fix website timezone misconfigurations
    correctTimezoneIfNeeded(startDate, endDate, address, html, originalStartDateString) {
        try {
            // Detect the actual city from the address
            const detectedCity = this.detectCityFromAddress(address);
            if (!detectedCity) {
                // Can't detect city, return original dates
                return { startDate, endDate };
            }
            
            // Get the correct timezone for this city
            const correctTimezone = this.getTimezoneForCity(detectedCity);
            if (!correctTimezone) {
                return { startDate, endDate };
            }
            
            // Extract the displayed time from the HTML to compare with JSON-LD
            const displayedTime = this.extractDisplayedTime(html);
            if (!displayedTime) {
                return { startDate, endDate };
            }
            
            // Check if there's a timezone mismatch
            const jsonTimezone = this.extractTimezoneFromDateString(originalStartDateString);
            
            // If JSON timezone doesn't match the city's timezone, we might need to correct it
            if (jsonTimezone && correctTimezone && jsonTimezone !== correctTimezone) {
                console.log(`🎉 Chunk: Timezone mismatch detected - JSON: ${jsonTimezone}, Expected: ${correctTimezone}`);
                
                // Try to reconstruct the correct time using displayed time + correct timezone
                const correctedTimes = this.reconstructTimesWithCorrectTimezone(
                    displayedTime, 
                    startDate, 
                    endDate, 
                    correctTimezone,
                    detectedCity
                );
                
                if (correctedTimes) {
                    console.log(`🎉 Chunk: Corrected timezone for ${detectedCity} event`);
                    return correctedTimes;
                }
            }
            
            // No correction needed or correction failed, return original
            return { startDate, endDate };
            
        } catch (error) {
            console.warn(`🎉 Chunk: Timezone correction failed: ${error.message}`);
            return { startDate, endDate };
        }
    }
    
    // Detect city from address string
    detectCityFromAddress(address) {
        if (!address) return null;
        
        const cityPatterns = {
            'chicago': ['chicago', 'chi'],
            'sf': ['san francisco', 'sf'],
            'la': ['los angeles', 'hollywood', 'west hollywood', 'weho'],
            'nyc': ['new york', 'nyc', 'manhattan', 'brooklyn'],
            'portland': ['portland'],
            'seattle': ['seattle'],
            'atlanta': ['atlanta'],
            'miami': ['miami'],
            'denver': ['denver'],
            'austin': ['austin'],
            'dallas': ['dallas'],
            'houston': ['houston']
        };
        
        const lowerAddress = address.toLowerCase();
        for (const [city, patterns] of Object.entries(cityPatterns)) {
            for (const pattern of patterns) {
                if (lowerAddress.includes(pattern)) {
                    return city;
                }
            }
        }
        return null;
    }
    
    // Get correct timezone for a city
    getTimezoneForCity(city) {
        const timezoneMap = {
            'chicago': 'America/Chicago',
            'sf': 'America/Los_Angeles', 
            'la': 'America/Los_Angeles',
            'nyc': 'America/New_York',
            'portland': 'America/Los_Angeles',
            'seattle': 'America/Los_Angeles',
            'atlanta': 'America/New_York',
            'miami': 'America/New_York',
            'denver': 'America/Denver',
            'austin': 'America/Chicago',
            'dallas': 'America/Chicago',
            'houston': 'America/Chicago'
        };
        return timezoneMap[city] || null;
    }
    
    // Extract timezone from date string
    extractTimezoneFromDateString(dateString) {
        if (!dateString) return null;
        
        // Extract timezone offset (e.g., -07:00, +05:30)
        const offsetMatch = dateString.match(/([+-]\d{2}:\d{2})$/);
        if (offsetMatch) {
            // Convert offset to timezone name (approximate)
            const offset = offsetMatch[1];
            const offsetMap = {
                '-08:00': 'America/Los_Angeles', // PST
                '-07:00': 'America/Los_Angeles', // PDT  
                '-06:00': 'America/Chicago',     // CST
                '-05:00': 'America/Chicago',     // CDT
                '-05:00': 'America/New_York',    // EST
                '-04:00': 'America/New_York',    // EDT
            };
            return offsetMap[offset];
        }
        
        return null;
    }
    
    // Extract displayed time from HTML (what users see)
    extractDisplayedTime(html) {
        try {
            // Look for time patterns in the HTML content
            const timePatterns = [
                /(\d{1,2}):(\d{2})\s*(AM|PM)/gi,
                /(\d{1,2})\s*(AM|PM)/gi
            ];
            
            for (const pattern of timePatterns) {
                const matches = [...html.matchAll(pattern)];
                for (const match of matches) {
                    const timeStr = match[0];
                    // Look for context that suggests this is the event time
                    const context = html.substring(Math.max(0, match.index - 100), match.index + 100);
                    
                    // Check if this time appears near event-related content
                    if (context.toLowerCase().includes('event') || 
                        context.toLowerCase().includes('time') ||
                        context.toLowerCase().includes('start') ||
                        context.includes('Oct') || context.includes('Nov') || context.includes('Sep')) {
                        
                        return timeStr.trim();
                    }
                }
            }
        } catch (error) {
            console.warn(`🎉 Chunk: Error extracting displayed time: ${error.message}`);
        }
        return null;
    }
    
    // Reconstruct correct times using displayed time + correct timezone
    reconstructTimesWithCorrectTimezone(displayedTime, originalStartDate, originalEndDate, correctTimezone, city) {
        try {
            // Parse the displayed time (e.g., "9:00 PM")
            const timeMatch = displayedTime.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)/i);
            if (!timeMatch) return null;
            
            let hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2] || '0');
            const period = timeMatch[3].toUpperCase();
            
            // Convert to 24-hour format
            if (period === 'PM' && hours !== 12) hours += 12;
            if (period === 'AM' && hours === 12) hours = 0;
            
            // Get the date components from original (assuming date is correct, just timezone is wrong)
            const originalDate = new Date(originalStartDate);
            
            // Create a new date in the correct timezone
            // We need to be careful here - we want the displayed time in the local timezone
            const year = originalDate.getUTCFullYear();
            const month = originalDate.getUTCMonth();
            const date = originalDate.getUTCDate();
            
            // Create date string in local timezone format
            const localDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
            
            // Check if timezone correction is enabled and we have confidence in the correction
            const shouldCorrect = this.shouldCorrectTimezone(detectedCity, displayedTime, originalStartDate, correctTimezone);
            
            if (shouldCorrect) {
                // Calculate the correct time in the event's local timezone
                const correctedStartDate = this.createCorrectDate(originalStartDate, hours, minutes, correctTimezone);
                const correctedEndDate = originalEndDate ? 
                    new Date(correctedStartDate.getTime() + (originalEndDate.getTime() - originalStartDate.getTime())) : 
                    null;
                
                console.log(`🎉 Chunk: Corrected ${city} event time:`);
                console.log(`🎉 Chunk:   Original: ${originalStartDate.toISOString()} (${originalStartDate.toLocaleString('en-US', {timeZone: correctTimezone})})`);
                console.log(`🎉 Chunk:   Corrected: ${correctedStartDate.toISOString()} (${correctedStartDate.toLocaleString('en-US', {timeZone: correctTimezone})})`);
                
                return { startDate: correctedStartDate, endDate: correctedEndDate };
            } else {
                console.log(`🎉 Chunk: Timezone correction analysis for ${city}:`);
                console.log(`🎉 Chunk:   Displayed: ${displayedTime}`);
                console.log(`🎉 Chunk:   Expected timezone: ${correctTimezone}`);
                console.log(`🎉 Chunk:   Keeping original times (conservative approach)`);
                
                return { startDate: originalStartDate, endDate: originalEndDate };
            }
            
        } catch (error) {
            console.warn(`🎉 Chunk: Timezone reconstruction failed: ${error.message}`);
            return { startDate: originalStartDate, endDate: originalEndDate };
        }
    }
    
    // Determine if we should correct the timezone (configurable and conservative)
    shouldCorrectTimezone(city, displayedTime, originalDate, correctTimezone) {
        // For now, be conservative and only log the analysis
        // This can be enabled later when we're more confident
        
        // Known problematic patterns we're confident about correcting
        const knownIssues = {
            'chicago': {
                // Chicago events stored in Pacific time
                problemTimezone: 'America/Los_Angeles',
                correctTimezone: 'America/Chicago'
            }
        };
        
        // Only correct if this is a known issue pattern
        const knownIssue = knownIssues[city];
        if (!knownIssue) {
            return false; // No known issue for this city
        }
        
        // Check if current timezone matches the problematic pattern
        const currentTimezone = this.extractTimezoneFromDateString(originalDate.toISOString());
        if (currentTimezone !== knownIssue.problemTimezone) {
            return false; // Not the problematic pattern
        }
        
        // Additional confidence checks could go here
        // For example: time format validation, consistency checks, etc.
        
        // For now, return false to be conservative
        // Change this to true when ready to enable corrections
        return false;
    }
    
    // Create a corrected date in the proper timezone
    createCorrectDate(originalDate, hours, minutes, targetTimezone) {
        // Get the original date components
        const year = originalDate.getUTCFullYear();
        const month = originalDate.getUTCMonth();
        const date = originalDate.getUTCDate();
        
        // Create a date string that represents the local time in the target timezone
        // This is complex because we need to account for DST and timezone offsets
        
        // For simplicity, create a date that represents the desired local time
        // and let the system handle the UTC conversion
        const localDate = new Date(year, month, date, hours, minutes, 0);
        
        // This is a simplified approach - in production, you'd want to use a proper
        // timezone library like date-fns-tz or moment-timezone for accuracy
        return localDate;
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
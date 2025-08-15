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
            requireDetailPages: true, // Bearracuda uses individual event pages
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
            
            // Check if this is an individual event page
            if (this.isEventDetailPage(html, htmlData.url)) {
                console.log('🐻 Bearracuda: Detected individual event page');
                const event = this.parseEventDetailPage(html, htmlData.url, parserConfig);
                if (event) {
                    events.push(event);
                }
            } else {
                // Try to parse as a listing page (though main /events/ returns 404)
                console.log('🐻 Bearracuda: Trying to parse as event listing page');
                const listingEvents = this.parseEventListingPage(html, htmlData.url, parserConfig);
                events.push(...listingEvents);
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

    // Check if this is an individual event detail page
    isEventDetailPage(html, url) {
        // Check URL pattern: /events/{city-event}/
        if (!/\/events\/[^\/]+\/$/.test(url)) {
            return false;
        }
        
        // Check for Bearracuda event page indicators
        return html.includes('📅') || html.includes('🪩') || 
               html.includes('Doors Open') || html.includes('Party Goes Until') ||
               html.includes('elementor-heading-title') || html.includes('Heretic') ||
               (html.includes('bearracuda') && html.includes('Atlanta'));
    }

    // Parse an individual event detail page
    parseEventDetailPage(html, sourceUrl, parserConfig = {}) {
        try {
            console.log(`🐻 Bearracuda: Parsing individual event page: ${sourceUrl}`);
            
            // Extract title (usually the city name)
            let title = this.extractTitle(html);
            
            // Extract date
            const dateInfo = this.extractDate(html);
            
            // Extract time information
            const timeInfo = this.extractTime(html);
            
            // Extract venue information
            const venueInfo = this.extractVenue(html);
            
            // Extract address
            const address = this.extractAddress(html);
            
            // Extract entertainment/performers
            const performers = this.extractPerformers(html);
            
            // Extract ticket/external links
            const links = this.extractExternalLinks(html);
            
            // Extract special info (like anniversary details)
            const specialInfo = this.extractSpecialInfo(html);
            
            // Extract city from URL and title
            const city = this.extractCityFromUrl(sourceUrl) || this.extractCityFromText(title);
            
            // Build description
            let description = '';
            if (specialInfo) description += specialInfo + '\n';
            if (performers) description += 'Entertainment: ' + performers + '\n';
            if (timeInfo.details) description += timeInfo.details + '\n';
            description = description.trim();
            
            // Create start date
            let startDate = null;
            if (dateInfo && timeInfo.startTime) {
                // Combine date and start time with city timezone
                startDate = this.combineDateTime(dateInfo, timeInfo.startTime, city);
            } else if (dateInfo) {
                startDate = dateInfo;
            }
            
            // Create end date
            let endDate = null;
            if (dateInfo && timeInfo.endTime) {
                endDate = this.combineDateTime(dateInfo, timeInfo.endTime, city);
                // If end time is earlier than start time, assume it's next day
                if (endDate <= startDate) {
                    endDate = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
                }
            }
            
            const event = {
                title: title,
                description: description,
                startDate: startDate,
                endDate: endDate,
                bar: venueInfo.name, // Use 'bar' field name that calendar-core.js expects
                location: null, // No coordinates available in HTML parsing
                address: address,
                city: city,
                website: links.eventbrite || sourceUrl, // Prefer eventbrite link if available
                cover: '', // No cover charge info found in the sample
                image: this.extractImage(html),
                gmaps: this.generateGoogleMapsUrl(address),
                source: this.config.source,
                // Additional bearracuda-specific fields
                facebookEvent: links.facebook,
                ticketUrl: links.eventbrite,
                eventbriteUrl: links.eventbrite, // Store eventbrite URL separately
                detailPageUrl: sourceUrl, // Store the bearracuda detail page URL
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
            
            console.log(`🐻 Bearracuda: Created event "${title}" for ${city} on ${startDate}`);
            
            return event;
            
        } catch (error) {
            console.warn(`🐻 Bearracuda: Failed to parse event detail page: ${error}`);
            return null;
        }
    }

    // Parse event listing page (though main /events/ doesn't exist)
    parseEventListingPage(html, sourceUrl, parserConfig = {}) {
        const events = [];
        
        try {
            // Look for event links on main page or other listing pages
            const eventLinkPattern = /href="(https:\/\/bearracuda\.com\/events\/[^"]+)"/gi;
            let match;
            const eventUrls = new Set();
            
            while ((match = eventLinkPattern.exec(html)) !== null) {
                eventUrls.add(match[1]);
            }
            
            console.log(`🐻 Bearracuda: Found ${eventUrls.size} event links on listing page`);
            
            // For listing pages, we return empty events but provide additional links
            // The actual parsing happens when the detail pages are processed
            
        } catch (error) {
            console.warn(`🐻 Bearracuda: Error parsing listing page: ${error}`);
        }
        
        return events;
    }

    // Extract title from page
    extractTitle(html) {
        // Look for the main heading in Elementor structure
        const patterns = [
            /<h1[^>]*class="[^"]*elementor-heading-title[^>]*>([^<]+)<\/h1>/i,
            /<h1[^>]*>([^<]+)<\/h1>/i,
            /<title>([^|<]+)/i
        ];
        
        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                let title = match[1].trim();
                // Clean up title
                title = title.replace(/\s*\|\s*Bearracuda\.com$/, '');
                if (title && title !== 'Page not found') {
                    return title;
                }
            }
        }
        
        return 'Bearracuda Event';
    }

    // Extract date from page
    extractDate(html) {
        // Look for date with emoji pattern: 📅  August 23, 2025
        const datePattern = /📅\s*([^<]+)/;
        const match = html.match(datePattern);
        
        if (match && match[1]) {
            const dateString = match[1].trim();
            console.log(`🐻 Bearracuda: Found date string: "${dateString}"`);
            
            // Parse various date formats
            const parsedDate = this.parseDate(dateString);
            if (parsedDate) {
                return parsedDate;
            }
        }
        
        // Fallback: look for other date patterns
        const fallbackPatterns = [
            /(\w+\s+\d{1,2},\s+\d{4})/i, // "August 23, 2025"
            /(\d{1,2}\/\d{1,2}\/\d{4})/,   // "8/23/2025"
            /(\d{4}-\d{2}-\d{2})/          // "2025-08-23"
        ];
        
        for (const pattern of fallbackPatterns) {
            const match = html.match(pattern);
            if (match) {
                const parsedDate = this.parseDate(match[1]);
                if (parsedDate) {
                    return parsedDate;
                }
            }
        }
        
        return null;
    }

    // Extract time information
    extractTime(html) {
        const result = {
            startTime: null,
            endTime: null,
            details: null
        };
        
        // Look for door time pattern: "Doors Open at 10:00 pm"
        const doorPattern = /Doors Open at (\d{1,2}:\d{2}\s*[ap]m)/i;
        const doorMatch = html.match(doorPattern);
        if (doorMatch) {
            result.startTime = this.parseTime(doorMatch[1]);
            result.details = doorMatch[0];
        }
        
        // Look for end time pattern: "Party Goes Until 3:00 am!"
        const endPattern = /Party Goes Until (\d{1,2}:\d{2}\s*[ap]m)/i;
        const endMatch = html.match(endPattern);
        if (endMatch) {
            result.endTime = this.parseTime(endMatch[1]);
            if (result.details) {
                result.details += ' - ' + endMatch[0];
            } else {
                result.details = endMatch[0];
            }
        }
        
        return result;
    }

    // Extract venue information
    extractVenue(html) {
        // Look for venue with emoji: 🪩  Heretic
        const venuePattern = /🪩\s*([^<]+)/;
        const match = html.match(venuePattern);
        
        if (match && match[1]) {
            return {
                name: match[1].trim(),
                emoji: '🪩'
            };
        }
        
        return { name: '', emoji: '' };
    }

    // Extract address
    extractAddress(html) {
        // Look for address pattern: "2069 Cheshire Bridge Road, Atlanta, GA"
        const addressPatterns = [
            /<div[^>]*>(\d+\s+[^,<]+,\s*[^,<]+,\s*[A-Z]{2})<\/div>/i, // "2069 Cheshire Bridge Road, Atlanta, GA"
            /(\d+\s+[^,<]+,\s*[^,<]+,\s*[A-Z]{2})/i, // Fallback without div tags
            /(\d+\s+[^<>\n]+(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Drive|Dr)[^<>\n]*)/i
        ];
        
        for (const pattern of addressPatterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                return match[1].trim();
            }
        }
        
        return '';
    }

    // Extract performers/entertainment
    extractPerformers(html) {
        // Look for entertainment section: "Matt Consola"
        const patterns = [
            /🎧[^<]*<\/strong><br><p>([^<]+)<\/p>/i,
            /Music\s*&\s*Entertainment[^<]*<\/strong><br><p>([^<]+)<\/p>/i,
            /Entertainment[^<]*<\/strong>[^<]*<[^>]*>([^<]+)</i
        ];
        
        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                return match[1].trim();
            }
        }
        
        return '';
    }

    // Extract external links (Facebook, Eventbrite)
    extractExternalLinks(html) {
        const links = {
            facebook: null,
            eventbrite: null
        };
        
        // Extract Facebook event link
        const fbPattern = /href="(https:\/\/www\.facebook\.com\/events\/[^"]+)"/i;
        const fbMatch = html.match(fbPattern);
        if (fbMatch) {
            links.facebook = fbMatch[1];
        }
        
        // Extract Eventbrite link
        const ebPattern = /href="(https:\/\/www\.eventbrite\.com\/e\/[^"]+)"/i;
        const ebMatch = html.match(ebPattern);
        if (ebMatch) {
            links.eventbrite = ebMatch[1];
        }
        
        return links;
    }

    // Extract special information (anniversaries, etc.)
    extractSpecialInfo(html) {
        // Look for special info like "16 YEAR ANNIVERSARY"
        const patterns = [
            /(\d+\s+YEAR\s+ANNIVERSARY)/i,
            /<p>([^<]*ANNIVERSARY[^<]*)<\/p>/i,
            /<p>([^<]*CELEBRATION[^<]*)<\/p>/i
        ];
        
        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                return match[1].trim();
            }
        }
        
        return '';
    }

    // Extract image URL
    extractImage(html) {
        // Look for featured image in meta tags or img elements
        const patterns = [
            /property="og:image"\s+content="([^"]+)"/i,
            /cuda-atlanta[^"]*\.jpg/i,
            /bearracuda\.com\/wp-content\/uploads[^"]*\.(jpg|png|jpeg)/i
        ];
        
        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) {
                return match[0].includes('content="') ? match[1] : match[0];
            }
        }
        
        return '';
    }

    // Extract city from URL
    extractCityFromUrl(url) {
        const urlPatterns = {
            'atlanta': /atlantabearpride|atlanta/i,
            'new-orleans': /new-orleans/i,
            'chicago': /chicagoaug|chicago/i,
            'denver': /denverpride|denver/i,
            'sf': /sanfrancisco|sf/i,
            'la': /losangeles|la/i,
            'nyc': /newyork|nyc/i
        };
        
        for (const [city, pattern] of Object.entries(urlPatterns)) {
            if (pattern.test(url)) {
                console.log(`🐻 Bearracuda: Extracted city "${city}" from URL: ${url}`);
                return city;
            }
        }
        
        return null;
    }

    // Extract additional URLs for detail page processing
    extractAdditionalUrls(html, sourceUrl, parserConfig) {
        const urls = new Set();
        
        try {
            console.log(`🐻 Bearracuda: Extracting additional event URLs from HTML`);
            
            // Look for bearracuda event URLs
            const urlPatterns = [
                // Event detail page links
                /href="(https:\/\/bearracuda\.com\/events\/[^"]+)"/gi,
                // Relative event links
                /href="(\/events\/[^"]+)"/gi
            ];
            
            for (const pattern of urlPatterns) {
                let match;
                while ((match = pattern.exec(html)) !== null) {
                    let url = match[1];
                    
                    // Convert relative URLs to absolute
                    if (url.startsWith('/')) {
                        url = 'https://bearracuda.com' + url;
                    }
                    
                    // Ensure URL ends with slash
                    if (!url.endsWith('/')) {
                        url += '/';
                    }
                    
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
            
            // Must be Bearracuda domain
            if (!urlObj.hostname.includes('bearracuda.com')) return false;
            
            // Must be event page pattern
            if (!/\/events\/[^\/]+\/?$/.test(urlObj.pathname)) return false;
            
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

    // Parse date string into Date object
    parseDate(dateString) {
        if (!dateString) return null;
        
        try {
            // Clean up the date string
            dateString = dateString.replace(/\s+/g, ' ').trim();
            
            // Try various date formats common in event listings
            const formats = [
                // Month DD, YYYY
                /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})/i,
                // MM/DD/YYYY
                /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
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
                            'january': 0, 'february': 1, 'march': 2, 'april': 3,
                            'may': 4, 'june': 5, 'july': 6, 'august': 7,
                            'september': 8, 'october': 9, 'november': 10, 'december': 11
                        };
                        
                        const month = months[match[1].toLowerCase()];
                        const day = parseInt(match[2]);
                        const year = parseInt(match[3]);
                        date = new Date(year, month, day);
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

    // Parse time string to hours and minutes
    parseTime(timeString) {
        if (!timeString) return null;
        
        const timePattern = /(\d{1,2}):(\d{2})\s*(am|pm)/i;
        const match = timeString.match(timePattern);
        
        if (match) {
            let hours = parseInt(match[1]);
            const minutes = parseInt(match[2]);
            const ampm = match[3].toLowerCase();
            
            if (ampm === 'pm' && hours !== 12) {
                hours += 12;
            } else if (ampm === 'am' && hours === 12) {
                hours = 0;
            }
            
            return { hours, minutes };
        }
        
        return null;
    }

    // Combine date and time into a single Date object with timezone handling
    combineDateTime(date, time, city = null) {
        if (!date || !time) return date;
        
        // Get timezone offset for the city
        const timezoneOffset = this.getTimezoneOffsetForCity(city);
        
        // Create date in local timezone first
        const combined = new Date(date);
        combined.setHours(time.hours, time.minutes, 0, 0);
        
        // Convert to UTC by adding the timezone offset
        // Note: getTimezoneOffset returns minutes west of UTC, so we subtract
        const utcTime = new Date(combined.getTime() - (timezoneOffset * 60 * 1000));
        
        console.log(`🐻 Bearracuda: Converting ${city} time ${time.hours}:${time.minutes} to UTC: ${utcTime.toISOString()}`);
        
        return utcTime;
    }
    
    // Get timezone offset in minutes for a city
    getTimezoneOffsetForCity(city) {
        // City to timezone mapping (in minutes offset from UTC)
        // Note: These are standard time offsets. DST handling would require more complex logic
        const cityTimezones = {
            'atlanta': -5 * 60,      // EST (UTC-5)
            'chicago': -6 * 60,      // CST (UTC-6)
            'denver': -7 * 60,       // MST (UTC-7)
            'la': -8 * 60,           // PST (UTC-8)
            'sf': -8 * 60,           // PST (UTC-8)
            'seattle': -8 * 60,      // PST (UTC-8)
            'portland': -8 * 60,     // PST (UTC-8)
            'vegas': -8 * 60,        // PST (UTC-8)
            'nyc': -5 * 60,          // EST (UTC-5)
            'miami': -5 * 60,        // EST (UTC-5)
            'boston': -5 * 60,       // EST (UTC-5)
            'philadelphia': -5 * 60, // EST (UTC-5)
            'dc': -5 * 60,           // EST (UTC-5)
            'austin': -6 * 60,       // CST (UTC-6)
            'dallas': -6 * 60,       // CST (UTC-6)
            'houston': -6 * 60,      // CST (UTC-6)
            'phoenix': -7 * 60,      // MST (UTC-7, no DST)
            'orlando': -5 * 60,      // EST (UTC-5)
            'tampa': -5 * 60,        // EST (UTC-5)
            'new-orleans': -6 * 60   // CST (UTC-6)
        };
        
        return cityTimezones[city] || -5 * 60; // Default to EST if city not found
    }

    // Generate Google Maps URL from address
    generateGoogleMapsUrl(address) {
        if (!address) return '';
        
        const encoded = encodeURIComponent(address);
        return `https://maps.google.com/maps?q=${encoded}`;
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
            'tampa': /(tampa)/i,
            'new-orleans': /(new orleans|nola)/i
        };
        
        for (const [city, pattern] of Object.entries(cityPatterns)) {
            if (pattern.test(text)) {
                console.log(`🐻 Bearracuda: Extracted city "${city}" from text: "${text.substring(0, 100)}..."`);
                return city;
            }
        }
        
        return null;
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
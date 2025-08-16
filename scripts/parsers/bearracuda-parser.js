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
                console.log('🐻 Bearracuda: Detected individual event page, parsing event details...');
                const event = this.parseEventDetailPage(html, htmlData.url, parserConfig);
                if (event) {
                    console.log(`🐻 Bearracuda: Successfully parsed event: ${event.title}`);
                    events.push(event);
                } else {
                    console.log('🐻 Bearracuda: Failed to parse event from detail page');
                }
            } else {
                // Try to parse as a listing page (though main /events/ returns 404)
                console.log('🐻 Bearracuda: Trying to parse as event listing page');
                const listingEvents = this.parseEventListingPage(html, htmlData.url, parserConfig);
                console.log(`🐻 Bearracuda: Parsed ${listingEvents.length} events from listing page`);
                events.push(...listingEvents);
            }
            
            // Extract additional URLs if required
            let additionalLinks = [];
            if (parserConfig.requireDetailPages) {
                console.log('🐻 Bearracuda: Detail pages required, extracting additional URLs...');
                additionalLinks = this.extractAdditionalUrls(html, htmlData.url, parserConfig);
            } else {
                console.log('🐻 Bearracuda: Detail pages not required, skipping URL extraction');
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
            
            // Extract full description content
            const fullDescription = this.extractFullDescription(html);
            
            // Extract city from URL and title
            const city = this.extractCityFromUrl(sourceUrl) || this.extractCityFromText(title);
            
            // Build description
            let description = '';
            if (fullDescription) {
                description += fullDescription + '\n';
            } else {
                // Fallback to old logic if full description not found
                if (specialInfo) description += specialInfo + '\n';
                if (performers) description += 'Entertainment: ' + performers + '\n';
                if (timeInfo.details) description += timeInfo.details + '\n';
            }
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
                website: sourceUrl, // Always use the bearracuda.com detail page URL
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
            console.log(`🐻 Bearracuda: Parsing listing page: ${sourceUrl}`);
            
            // Look for event links on main page or other listing pages
            const eventLinkPattern = /href="(https:\/\/bearracuda\.com\/events\/[^"]+)"/gi;
            let match;
            const eventUrls = new Set();
            
            while ((match = eventLinkPattern.exec(html)) !== null) {
                eventUrls.add(match[1]);
                console.log(`🐻 Bearracuda: Found event link in listing: ${match[1]}`);
            }
            
            console.log(`🐻 Bearracuda: Found ${eventUrls.size} event links on listing page`);
            
            // For listing pages, we return empty events but provide additional links
            // The actual parsing happens when the detail pages are processed
            console.log(`🐻 Bearracuda: Listing page parsing complete - returning 0 events (detail pages will be processed separately)`);
            
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
            let venueName = match[1].trim();
            // Clean HTML entities like &nbsp;
            venueName = venueName.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
            return {
                name: venueName,
                emoji: '🪩'
            };
        }
        
        return { name: '', emoji: '' };
    }

    // Extract address
    extractAddress(html) {
        // Look for address pattern: "2069 Cheshire Bridge Road, Atlanta, GA" or "619 E. Pine St, Seattle, WA"
        const addressPatterns = [
            // Match addresses in div tags, avoiding script content
            /<div[^>]*>(\d+\s+[^,<]+,\s*[^,<]+,\s*[A-Z]{2})<\/div>/i, 
            // Match addresses in paragraph tags
            /<p[^>]*>(\d+\s+[^,<]+,\s*[^,<]+,\s*[A-Z]{2})<\/p>/i,
            // Match addresses with directional prefixes like "619 E. Pine St"
            /(\d+\s+[NSEW]\.?\s+[^,<]+,\s*[^,<]+,\s*[A-Z]{2})/i,
            // Standard address pattern without tags
            /(\d+\s+[^,<]+,\s*[^,<]+,\s*[A-Z]{2})/i,
            // Street name patterns
            /(\d+\s+[^<>\n]+(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Pine|Bridge)[^<>\n]*)/i
        ];
        
        for (const pattern of addressPatterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                let address = match[1].trim();
                
                // Skip if this looks like JavaScript code or contains suspicious content
                if (address.includes('function') || 
                    address.includes('window.') || 
                    address.includes('document.') ||
                    address.includes('return') ||
                    address.includes('%') ||
                    address.includes('javascript') ||
                    address.length > 100) {
                    console.log(`🐻 Bearracuda: Skipping suspicious address content: ${address.substring(0, 50)}...`);
                    continue;
                }
                
                // Clean HTML entities and normalize
                address = address.replace(/&nbsp;/g, ' ')
                                .replace(/&amp;/g, '&')
                                .replace(/&lt;/g, '<')
                                .replace(/&gt;/g, '>')
                                .replace(/&quot;/g, '"')
                                .replace(/\s+/g, ' ')
                                .trim();
                
                // Final validation - should look like a real address
                if (/^\d+\s+[A-Za-z\s\.,]+[A-Z]{2}$/.test(address.replace(/[,\s]+/g, ' ').trim())) {
                    console.log(`🐻 Bearracuda: Extracted valid address: ${address}`);
                    return address;
                }
            }
        }
        
        console.log(`🐻 Bearracuda: No valid address found`);
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

    // Extract full description content
    extractFullDescription(html) {
        // Look for detailed event descriptions in various formats
        const descriptionPatterns = [
            // Look for content in paragraph tags that contains detailed descriptions
            /<p[^>]*>([^<]*(?:wristband|choose|adventure|cruise|meet|consent|clothes check)[^<]*)<\/p>/gi,
            // Look for content after specific headings or before contact info
            /<p[^>]*>([^<]{100,})<\/p>/gi, // Long paragraphs likely to be descriptions
            // Look for content in divs with specific classes
            /<div[^>]*class="[^"]*content[^"]*"[^>]*>([^<]+)<\/div>/gi,
            // Look for text blocks with event details
            /([^<>\n]*(?:returns to|invite you|grab a wristband|choose your own|cruise and meet|consent is mandatory|clothes check)[^<>\n]*)/gi
        ];
        
        let descriptions = [];
        
        for (const pattern of descriptionPatterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                let desc = match[1].trim();
                if (desc && desc.length > 50) { // Only include substantial content
                    // Clean HTML entities and normalize whitespace
                    desc = desc.replace(/&nbsp;/g, ' ')
                              .replace(/&amp;/g, '&')
                              .replace(/&lt;/g, '<')
                              .replace(/&gt;/g, '>')
                              .replace(/&quot;/g, '"')
                              .replace(/\s+/g, ' ')
                              .trim();
                    
                    // Avoid duplicates
                    if (!descriptions.some(existing => existing.includes(desc) || desc.includes(existing))) {
                        descriptions.push(desc);
                    }
                }
            }
        }
        
        // Join descriptions with double newlines for readability
        return descriptions.length > 0 ? descriptions.join('\n\n') : '';
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
            'nyc': /newyork|nyc/i,
            'seattle': /treasureseattle|seattle/i,
            'portland': /treasureportland|portland/i
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
            console.log(`🐻 Bearracuda: HTML length: ${html.length} characters`);
            
            // Check URL discovery depth configuration
            const maxDepth = parserConfig.urlDiscoveryDepth || 1;
            console.log(`🐻 Bearracuda: URL discovery depth limit: ${maxDepth}`);
            
            // Check if this is already a detail page - if so, don't extract more URLs to prevent recursion
            if (this.isEventDetailPage(html, sourceUrl)) {
                console.log(`🐻 Bearracuda: This is a detail page, skipping URL extraction to prevent recursion`);
                return [];
            }
            
            // Check if URL discovery is disabled
            if (!parserConfig.requireDetailPages || parserConfig.maxAdditionalUrls === 0) {
                console.log(`🐻 Bearracuda: URL discovery disabled by configuration (requireDetailPages: ${parserConfig.requireDetailPages}, maxAdditionalUrls: ${parserConfig.maxAdditionalUrls})`);
                return [];
            }
            
            // Look for bearracuda event URLs with multiple patterns
            const urlPatterns = [
                // Event detail page links with full URLs
                /href="(https:\/\/bearracuda\.com\/events\/[^"]+)"/gi,
                // Relative event links
                /href="(\/events\/[^"]+)"/gi,
                // Additional pattern to catch any missed links
                /<a[^>]+href="([^"]*\/events\/[^"]*)"[^>]*>/gi
            ];
            
            console.log(`🐻 Bearracuda: Testing ${urlPatterns.length} URL patterns`);
            
            // Collect all potential URLs first, then deduplicate
            const potentialUrls = new Set();
            
            for (let i = 0; i < urlPatterns.length; i++) {
                const pattern = urlPatterns[i];
                console.log(`🐻 Bearracuda: Testing pattern ${i + 1}: ${pattern.source}`);
                
                let match;
                // Reset regex lastIndex to ensure we start from the beginning
                pattern.lastIndex = 0;
                
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
                    
                    // Add to potential URLs set (automatically deduplicates)
                    potentialUrls.add(url);
                    
                    // Limit to prevent infinite loops
                    if (potentialUrls.size >= (this.config.maxAdditionalUrls || 20)) {
                        console.log(`🐻 Bearracuda: Reached maximum URL limit (${this.config.maxAdditionalUrls || 20})`);
                        break;
                    }
                }
                
                console.log(`🐻 Bearracuda: Pattern ${i + 1} found ${potentialUrls.size} unique URLs so far`);
            }
            
            console.log(`🐻 Bearracuda: Found ${potentialUrls.size} potential unique URLs, validating...`);
            
            // Now validate each unique URL
            for (const url of potentialUrls) {
                console.log(`🐻 Bearracuda: Validating URL: ${url}`);
                if (this.isValidEventUrl(url, parserConfig)) {
                    urls.add(url);
                    console.log(`🐻 Bearracuda: ✓ Valid event detail URL: ${url}`);
                } else {
                    console.log(`🐻 Bearracuda: ✗ Invalid event URL: ${url}`);
                }
            }
            
            console.log(`🐻 Bearracuda: Extracted ${urls.size} additional event links`);
            
            // Log all found URLs for debugging
            if (urls.size > 0) {
                console.log(`🐻 Bearracuda: Final list of valid URLs:`);
                Array.from(urls).forEach((url, index) => {
                    console.log(`🐻 Bearracuda: ${index + 1}. ${url}`);
                });
            } else {
                console.log(`🐻 Bearracuda: No valid URLs found. Debugging info:`);
                console.log(`🐻 Bearracuda: - HTML contains 'bearracuda.com': ${html.includes('bearracuda.com')}`);
                console.log(`🐻 Bearracuda: - HTML contains '/events/': ${html.includes('/events/')}`);
                console.log(`🐻 Bearracuda: - HTML contains 'atlantabearpride': ${html.includes('atlantabearpride')}`);
                
                // Show a sample of the HTML to see what we're working with
                const htmlSample = html.substring(0, 1000);
                console.log(`🐻 Bearracuda: HTML sample (first 1000 chars): ${htmlSample}`);
            }
            
        } catch (error) {
            console.warn(`🐻 Bearracuda: Error extracting additional URLs: ${error}`);
        }
        
        return Array.from(urls);
    }

    // Validate if URL is a valid event URL
    isValidEventUrl(url, parserConfig) {
        if (!url || typeof url !== 'string') {
            console.log(`🐻 Bearracuda: URL validation failed - invalid URL: ${url}`);
            return false;
        }
        
        try {
            // Use simple URL parsing that works in Scriptable
            const urlPattern = /^(https?:)\/\/([^\/]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/;
            const match = url.match(urlPattern);
            
            if (!match) {
                console.log(`🐻 Bearracuda: URL validation failed - invalid URL format: ${url}`);
                return false;
            }
            
            const [, protocol, host, pathname = '/', search = '', hash = ''] = match;
            const hostname = host.split(':')[0]; // Remove port if present
            
            console.log(`🐻 Bearracuda: Validating URL - hostname: ${hostname}, pathname: ${pathname}`);
            
            // Must be Bearracuda domain
            if (!hostname.includes('bearracuda.com')) {
                console.log(`🐻 Bearracuda: URL validation failed - not bearracuda.com domain: ${hostname}`);
                return false;
            }
            
            // Must be event page pattern
            if (!/\/events\/[^\/]+\/?$/.test(pathname)) {
                console.log(`🐻 Bearracuda: URL validation failed - doesn't match event path pattern: ${pathname}`);
                return false;
            }
            
            // Avoid admin, login, or social media links
            const invalidPaths = ['/admin', '/login', '/wp-admin', '/wp-login', '#', 'javascript:', 'mailto:'];
            if (invalidPaths.some(invalid => url.includes(invalid))) {
                console.log(`🐻 Bearracuda: URL validation failed - contains invalid path: ${url}`);
                return false;
            }
            
            // Apply URL filters if configured
            if (parserConfig.urlFilters) {
                console.log(`🐻 Bearracuda: Applying URL filters to: ${url}`);
                console.log(`🐻 Bearracuda: URL filters config:`, JSON.stringify(parserConfig.urlFilters));
                
                if (parserConfig.urlFilters.include) {
                    const includePatterns = Array.isArray(parserConfig.urlFilters.include) ? 
                        parserConfig.urlFilters.include : [parserConfig.urlFilters.include];
                    
                    console.log(`🐻 Bearracuda: Testing include patterns:`, includePatterns);
                    
                    const matchesInclude = includePatterns.some(pattern => {
                        const regex = new RegExp(pattern, 'i');
                        const matches = regex.test(url);
                        console.log(`🐻 Bearracuda: Pattern "${pattern}" ${matches ? 'MATCHES' : 'DOES NOT MATCH'} URL: ${url}`);
                        return matches;
                    });
                    
                    if (!matchesInclude) {
                        console.log(`🐻 Bearracuda: URL validation failed - doesn't match any include patterns`);
                        return false;
                    }
                }
                
                if (parserConfig.urlFilters.exclude) {
                    const excludePatterns = Array.isArray(parserConfig.urlFilters.exclude) ? 
                        parserConfig.urlFilters.exclude : [parserConfig.urlFilters.exclude];
                    
                    console.log(`🐻 Bearracuda: Testing exclude patterns:`, excludePatterns);
                    
                    const matchesExclude = excludePatterns.some(pattern => {
                        const regex = new RegExp(pattern, 'i');
                        const matches = regex.test(url);
                        console.log(`🐻 Bearracuda: Exclude pattern "${pattern}" ${matches ? 'MATCHES' : 'DOES NOT MATCH'} URL: ${url}`);
                        return matches;
                    });
                    
                    if (matchesExclude) {
                        console.log(`🐻 Bearracuda: URL validation failed - matches exclude pattern`);
                        return false;
                    }
                }
            } else {
                console.log(`🐻 Bearracuda: No URL filters configured`);
            }
            
            console.log(`🐻 Bearracuda: URL validation passed: ${url}`);
            return true;
            
        } catch (error) {
            console.log(`🐻 Bearracuda: URL validation failed - error parsing URL: ${error}`);
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
        
        // Additional validation to prevent corrupted URLs
        if (address.includes('function') || 
            address.includes('window.') || 
            address.includes('document.') ||
            address.includes('javascript') ||
            address.includes('%') ||
            address.length > 100) {
            console.log(`🐻 Bearracuda: Skipping Google Maps URL generation for suspicious address: ${address.substring(0, 50)}...`);
            return '';
        }
        
        try {
            const encoded = encodeURIComponent(address);
            const url = `https://maps.google.com/maps?q=${encoded}`;
            console.log(`🐻 Bearracuda: Generated Google Maps URL: ${url}`);
            return url;
        } catch (error) {
            console.log(`🐻 Bearracuda: Error generating Google Maps URL: ${error}`);
            return '';
        }
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
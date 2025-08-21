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
    parseEvents(htmlData, parserConfig = {}, cityConfig = null) {
        try {
            console.log(`🐻 Bearracuda: Parsing events from ${htmlData.url}`);
            
            const events = [];
            const html = htmlData.html;
            
            if (!html) {
                console.warn('🐻 Bearracuda: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }
            
            // Check if this is an individual event page
            const isDetailPage = this.isEventDetailPage(html, htmlData.url);
            console.log(`🐻 Bearracuda: Page type detection result: ${isDetailPage ? 'detail page' : 'listing page'}`);
            
            if (isDetailPage) {
                console.log('🐻 Bearracuda: Detected individual event page, parsing event details...');
                const event = this.parseEventDetailPage(html, htmlData.url, parserConfig, cityConfig);
                if (event) {
                    console.log(`🐻 Bearracuda: Successfully parsed event: ${event.title}`);
                    events.push(event);
                } else {
                    console.log('🐻 Bearracuda: Failed to parse event from detail page - parseEventDetailPage returned null');
                }
            } else {
                // Try to parse as a listing page (though main /events/ returns 404)
                console.log('🐻 Bearracuda: Trying to parse as event listing page');
                const listingEvents = this.parseEventListingPage(html, htmlData.url, parserConfig, cityConfig);
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
            console.log(`🐻 Bearracuda: URL pattern check failed for: ${url}`);
            return false;
        }
        
        // Enhanced detection with more indicators and better logging
        const indicators = [
            { name: 'calendar emoji', test: () => html.includes('📅') },
            { name: 'disco ball emoji', test: () => html.includes('🪩') },
            { name: 'doors open text', test: () => html.includes('Doors Open') },
            { name: 'party goes until text', test: () => html.includes('Party Goes Until') },
            { name: 'elementor heading', test: () => html.includes('elementor-heading-title') },
            { name: 'heretic venue', test: () => html.includes('Heretic') },
            { name: 'bearracuda brand', test: () => html.includes('bearracuda') || html.includes('Bearracuda') },
            { name: 'event page title', test: () => html.includes('<title>') && !html.includes('Page not found') },
            { name: 'wp-content', test: () => html.includes('wp-content') }, // WordPress content indicator
            { name: 'elementor widget', test: () => html.includes('elementor-widget') }, // Elementor page builder
            { name: 'event meta', test: () => html.includes('events/') && html.includes('wp-json') }, // WordPress event post
            { name: 'event schema', test: () => html.includes('"@type":"Event"') }, // JSON-LD event schema
            { name: 'city name in content', test: () => {
                if (!cityConfig) return false;
                return Object.values(cityConfig).some(city => 
                    city.patterns && city.patterns.some(pattern => 
                        html.toLowerCase().includes(pattern.toLowerCase())
                    )
                );
            }},
            // Additional indicators for current Bearracuda site structure
            { name: 'wordpress post', test: () => html.includes('wp-json/wp/v2/events/') }, // WordPress event post type
            { name: 'event content', test: () => html.includes('event') || html.includes('Event') },
            { name: 'dance party content', test: () => html.includes('dance') || html.includes('party') || html.includes('Party') },
            { name: 'venue content', test: () => html.includes('venue') || html.includes('Venue') || html.includes('location') },
            { name: 'date content', test: () => /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/.test(html) },
            { name: 'time content', test: () => /\d{1,2}:\d{2}\s*(am|pm|AM|PM)/.test(html) }
        ];
        
        const matchingIndicators = indicators.filter(indicator => {
            try {
                return indicator.test();
            } catch (error) {
                console.log(`🐻 Bearracuda: Error testing indicator ${indicator.name}: ${error}`);
                return false;
            }
        });
        
        console.log(`🐻 Bearracuda: Event page detection for ${url}:`);
        console.log(`🐻 Bearracuda: Found ${matchingIndicators.length}/${indicators.length} indicators:`);
        matchingIndicators.forEach(indicator => {
            console.log(`🐻 Bearracuda: ✓ ${indicator.name}`);
        });
        
        if (matchingIndicators.length === 0) {
            console.log(`🐻 Bearracuda: No indicators found. HTML sample (first 500 chars):`);
            console.log(`🐻 Bearracuda: ${html.substring(0, 500)}`);
        }
        
        // Consider it an event page if we find at least 1 indicator (more flexible than before)
        const isEventPage = matchingIndicators.length >= 1;
        console.log(`🐻 Bearracuda: Event page detection result: ${isEventPage}`);
        
        return isEventPage;
    }

    // Parse an individual event detail page
    parseEventDetailPage(html, sourceUrl, parserConfig = {}, cityConfig = null) {
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
            const city = this.extractCityFromUrl(sourceUrl, cityConfig) || this.extractCityFromText(title, cityConfig);
            
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
                startDate = this.combineDateTime(dateInfo, timeInfo.startTime, city, cityConfig);
            } else if (dateInfo) {
                startDate = dateInfo;
            }
            
            // Create end date
            let endDate = null;
            if (dateInfo && timeInfo.endTime) {
                endDate = this.combineDateTime(dateInfo, timeInfo.endTime, city, cityConfig);
                // If end time is earlier than start time, assume it's next day
                if (endDate && startDate && endDate <= startDate) {
                    endDate = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
                }
            }
            
            // Log parsing results for debugging
            console.log(`🐻 Bearracuda: Parsing results for ${sourceUrl}:`);
            console.log(`🐻 Bearracuda: - Title: "${title}"`);
            console.log(`🐻 Bearracuda: - Date: ${dateInfo ? dateInfo.toISOString() : 'null'}`);
            console.log(`🐻 Bearracuda: - Start time: ${timeInfo.startTime ? `${timeInfo.startTime.hours}:${timeInfo.startTime.minutes}` : 'null'}`);
            console.log(`🐻 Bearracuda: - End time: ${timeInfo.endTime ? `${timeInfo.endTime.hours}:${timeInfo.endTime.minutes}` : 'null'}`);
            console.log(`🐻 Bearracuda: - Venue: "${venueInfo.name}"`);
            console.log(`🐻 Bearracuda: - Address: "${address}"`);
            console.log(`🐻 Bearracuda: - City: "${city}"`);
            console.log(`🐻 Bearracuda: - Start Date: ${startDate ? startDate.toISOString() : 'null'}`);
            console.log(`🐻 Bearracuda: - End Date: ${endDate ? endDate.toISOString() : 'null'}`);
            
            // Validate that we have minimum required information
            if (!title || title === 'Bearracuda Event') {
                console.warn(`🐻 Bearracuda: Warning - No specific title found, using generic title`);
            }
            if (!dateInfo) {
                console.warn(`🐻 Bearracuda: Warning - No date information found`);
            }
            if (!venueInfo.name) {
                console.warn(`🐻 Bearracuda: Warning - No venue information found`);
            }
            if (!city) {
                console.warn(`🐻 Bearracuda: Warning - No city information found`);
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
            
            // Validate that we have minimum required information
            if (!title || title === 'Bearracuda Event') {
                console.warn(`🐻 Bearracuda: No valid title found - cannot create event`);
                return null;
            }
            if (!dateInfo) {
                console.warn(`🐻 Bearracuda: No date information found - cannot create event`);
                return null;
            }
            if (!city) {
                console.warn(`🐻 Bearracuda: No city information found - cannot create event`);
                return null;
            }
            
            console.log(`🐻 Bearracuda: Created event "${title}" for ${city} on ${startDate || dateInfo}`);
            return event;
            
        } catch (error) {
            console.warn(`🐻 Bearracuda: Failed to parse event detail page ${sourceUrl}: ${error}`);
            console.warn(`🐻 Bearracuda: Error details: ${error.stack || error.message || error}`);
            
            // Provide debugging information
            console.warn(`🐻 Bearracuda: HTML length: ${html ? html.length : 'undefined'} characters`);
            if (html) {
                console.warn(`🐻 Bearracuda: HTML sample: ${html.substring(0, 200)}...`);
                console.warn(`🐻 Bearracuda: Contains title tag: ${html.includes('<title>')}`);
                console.warn(`🐻 Bearracuda: Contains elementor: ${html.includes('elementor')}`);
                console.warn(`🐻 Bearracuda: Contains bearracuda: ${html.toLowerCase().includes('bearracuda')}`);
            }
            
            return null;
        }
    }

    // Parse event listing page (though main /events/ doesn't exist)
    parseEventListingPage(html, sourceUrl, parserConfig = {}, cityConfig = null) {
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
        console.log(`🐻 Bearracuda: Extracting title from HTML`);
        
        // Look for the main heading in Elementor structure and other patterns
        const patterns = [
            { name: 'elementor h1', pattern: /<h1[^>]*class="[^"]*elementor-heading-title[^>]*>([^<]+)<\/h1>/i },
            { name: 'any h1', pattern: /<h1[^>]*>([^<]+)<\/h1>/i },
            { name: 'title tag', pattern: /<title>([^|<]+)/i },
            { name: 'og:title', pattern: /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i },
            { name: 'elementor heading span', pattern: /<span[^>]*class="[^"]*elementor-heading-title[^>]*>([^<]+)<\/span>/i }
        ];
        
        for (const { name, pattern } of patterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                let title = match[1].trim();
                
                // Clean up title
                title = title.replace(/\s*\|\s*Bearracuda\.com$/, '');
                title = title.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
                
                if (title && title !== 'Page not found' && title.length > 0) {
                    console.log(`🐻 Bearracuda: Found title using ${name}: "${title}"`);
                    return title;
                }
            }
        }
        
        // Try to extract city name from URL as fallback
        const urlMatch = html.match(/bearracuda\.com\/events\/([^\/]+)/);
        if (urlMatch && urlMatch[1]) {
            const citySlug = urlMatch[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            console.log(`🐻 Bearracuda: Using city slug as title fallback: "${citySlug}"`);
            return `Bearracuda ${citySlug}`;
        }
        
        console.log(`🐻 Bearracuda: No title found, using default`);
        return 'Bearracuda Event';
    }

    // Extract date from page
    extractDate(html) {
        console.log(`🐻 Bearracuda: Extracting date from HTML`);
        
        // Look for date with emoji pattern: 📅  August 23, 2025
        const emojiDatePattern = /📅\s*([^<\n]+)/;
        const emojiMatch = html.match(emojiDatePattern);
        
        if (emojiMatch && emojiMatch[1]) {
            const dateString = emojiMatch[1].trim();
            console.log(`🐻 Bearracuda: Found emoji date string: "${dateString}"`);
            
            // Parse various date formats
            const parsedDate = this.parseDate(dateString);
            if (parsedDate) {
                console.log(`🐻 Bearracuda: Successfully parsed emoji date: ${parsedDate}`);
                return parsedDate;
            }
        }
        
        // Look for structured data dates
        const structuredDatePatterns = [
            /"startDate":\s*"([^"]+)"/i,
            /"dateTime":\s*"([^"]+)"/i,
            /property="event:start_time"\s+content="([^"]+)"/i
        ];
        
        for (const pattern of structuredDatePatterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                console.log(`🐻 Bearracuda: Found structured date: "${match[1]}"`);
                const parsedDate = this.parseDate(match[1]);
                if (parsedDate) {
                    console.log(`🐻 Bearracuda: Successfully parsed structured date: ${parsedDate}`);
                    return parsedDate;
                }
            }
        }
        
        // Fallback: look for other date patterns in content
        const fallbackPatterns = [
            { name: 'month day year', pattern: /(\w+\s+\d{1,2},?\s+\d{4})/i },
            { name: 'mm/dd/yyyy', pattern: /(\d{1,2}\/\d{1,2}\/\d{4})/ },
            { name: 'yyyy-mm-dd', pattern: /(\d{4}-\d{2}-\d{2})/ },
            { name: 'day month year', pattern: /(\d{1,2}\s+\w+\s+\d{4})/i }
        ];
        
        for (const { name, pattern } of fallbackPatterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                console.log(`🐻 Bearracuda: Found ${name} date pattern: "${match[1]}"`);
                const parsedDate = this.parseDate(match[1]);
                if (parsedDate) {
                    console.log(`🐻 Bearracuda: Successfully parsed ${name} date: ${parsedDate}`);
                    return parsedDate;
                }
            }
        }
        
        console.log(`🐻 Bearracuda: No date found in HTML`);
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
        // Look for address pattern in text-editor widgets first (most reliable for Bearracuda)
        const textEditorPatterns = [
            // Match addresses in elementor text-editor widgets
            /<div class="elementor-widget-container"[^>]*>\s*(\d+\s+[NSEW]\.?\s+[^,<]+,\s*[^,<]+,\s*[A-Z]{2})\s*<\/div>/i,
            /<div class="elementor-widget-container"[^>]*>\s*([^<]*\d+\s+[^,<]+,\s*[^,<]+,\s*[A-Z]{2}[^<]*)\s*<\/div>/i,
            // Look for addresses in paragraph tags within widgets
            /<p[^>]*>(\d+\s+[NSEW]\.?\s+[^,<]+,\s*[^,<]+,\s*[A-Z]{2})<\/p>/i,
        ];
        
        // Try text editor patterns first
        for (const pattern of textEditorPatterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                let address = match[1].trim();
                
                // Clean HTML entities and normalize
                address = address.replace(/&nbsp;/g, ' ')
                                .replace(/&amp;/g, '&')
                                .replace(/&lt;/g, '<')
                                .replace(/&gt;/g, '>')
                                .replace(/&quot;/g, '"')
                                .replace(/\s+/g, ' ')
                                .trim();
                
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
                
                // Final validation - should look like a real address
                if (/^\d+\s+[A-Za-z\s\.,]+[A-Z]{2}$/.test(address.replace(/[,\s]+/g, ' ').trim())) {
                    console.log(`🐻 Bearracuda: Extracted valid address: ${address}`);
                    return address;
                }
            }
        }
        
        // Fallback to original patterns if text editor patterns don't work
        const fallbackPatterns = [
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
        
        for (const pattern of fallbackPatterns) {
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
        // Look for detailed event descriptions in various formats, avoiding cookie consent text
        const descriptionPatterns = [
            // Look for content in text-editor widgets that contains event details (most reliable for Bearracuda)
            /<div class="elementor-widget-container"[^>]*>\s*<p>([^<]*(?:cruise|meet|consent|clothing|phone|photos|floor|wristband|adventure|choose)[^<]*)<\/p>/gi,
            /<div class="elementor-widget-container"[^>]*>([^<]*(?:cruise|meet|consent|clothing|phone|photos|floor|wristband|adventure|choose)[^<]*)<\/div>/gi,
            // Look for content in paragraph tags that contains detailed descriptions
            /<p[^>]*>([^<]*(?:cruise|meet|consent|clothing|phone|photos|floor|wristband|adventure|choose)[^<]*)<\/p>/gi,
            // Look for content after specific headings or before contact info
            /<p[^>]*>([^<]{50,})<\/p>/gi, // Long paragraphs likely to be descriptions
            // Look for content in divs with specific classes
            /<div[^>]*class="[^"]*content[^"]*"[^>]*>([^<]+)<\/div>/gi,
        ];
        
        let descriptions = [];
        
        for (const pattern of descriptionPatterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                let desc = match[1].trim();
                if (desc && desc.length > 20) { // Only include substantial content
                    // Clean HTML entities and normalize whitespace
                    desc = desc.replace(/&nbsp;/g, ' ')
                              .replace(/&amp;/g, '&')
                              .replace(/&lt;/g, '<')
                              .replace(/&gt;/g, '>')
                              .replace(/&quot;/g, '"')
                              .replace(/\s+/g, ' ')
                              .trim();
                    
                    // Filter out cookie consent text and other unwanted content
                    if (this.isCookieConsentText(desc) || this.isUnwantedContent(desc)) {
                        continue;
                    }
                    
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

    // Check if text is cookie consent related
    isCookieConsentText(text) {
        const cookieIndicators = [
            'this website uses cookies',
            'cookie consent',
            'cookies that are categorized as necessary',
            'third-party cookies',
            'analyze and understand how you use',
            'stored on your browser',
            'opt-out of these cookies',
            'browsing experience',
            'essential for the working of basic functionalities',
            'cookies will be stored in your browser only with your consent'
        ];
        
        const lowerText = text.toLowerCase();
        return cookieIndicators.some(indicator => lowerText.includes(indicator));
    }

    // Check if text is other unwanted content
    isUnwantedContent(text) {
        const unwantedIndicators = [
            'manage consent',
            'privacy overview',
            'cookie settings',
            'save & accept',
            'necessary cookies are absolutely essential',
            'performance cookies are used to understand',
            'analytical cookies are used to understand',
            'advertisement cookies are used to provide',
            'functional cookies help to perform',
            'uncategorized cookies are those that are being analyzed'
        ];
        
        const lowerText = text.toLowerCase();
        return unwantedIndicators.some(indicator => lowerText.includes(indicator));
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

    // Extract city from URL using only city config patterns
    extractCityFromUrl(url, cityConfig = null) {
        if (!cityConfig) {
            console.log(`🐻 Bearracuda: No city config provided - cannot extract city from URL`);
            return null;
        }
        
        // Use only city config patterns - no hardcoded assumptions
        for (const [cityKey, cityData] of Object.entries(cityConfig)) {
            if (cityData.patterns) {
                for (const pattern of cityData.patterns) {
                    if (url.toLowerCase().includes(pattern.toLowerCase())) {
                        console.log(`🐻 Bearracuda: Extracted city "${cityKey}" from URL using config pattern "${pattern}": ${url}`);
                        return cityKey;
                    }
                }
            }
        }
        
        console.log(`🐻 Bearracuda: No city patterns matched URL: ${url}`);
        return null;
    }

    // Extract additional URLs for detail page processing
    extractAdditionalUrls(html, sourceUrl, parserConfig) {
        const urls = [];
        
        try {
            console.log(`🐻 Bearracuda: Extracting additional event URLs from HTML`);
            console.log(`🐻 Bearracuda: HTML length: ${html.length} characters`);
            
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
                    
                    // Validate and add URL (shared-core will handle deduplication)
                    if (this.isValidEventUrl(url, parserConfig)) {
                        urls.push(url);
                        console.log(`🐻 Bearracuda: ✓ Found valid event URL: ${url}`);
                    } else {
                        console.log(`🐻 Bearracuda: ✗ Invalid event URL: ${url}`);
                    }
                    
                    // Limit to prevent infinite loops (shared-core will also limit)
                    if (urls.length >= (this.config.maxAdditionalUrls || 20)) {
                        console.log(`🐻 Bearracuda: Reached maximum URL limit (${this.config.maxAdditionalUrls || 20})`);
                        break;
                    }
                }
                
                console.log(`🐻 Bearracuda: Pattern ${i + 1} found ${urls.length} valid URLs total so far`);
            }
            
            console.log(`🐻 Bearracuda: Extracted ${urls.length} additional event links`);
            
            // Log found URLs for debugging
            if (urls.length > 0) {
                console.log(`🐻 Bearracuda: Found URLs (before shared-core deduplication):`);
                urls.forEach((url, index) => {
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
        
        return urls;
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

    // Get timezone identifier for a city using centralized configuration
    getTimezoneForCity(city, cityConfig = null) {
        // City config must be provided - no fallbacks
        if (!cityConfig || !cityConfig[city]) {
            console.log(`🐻 Bearracuda: No timezone configuration found for city: ${city}`);
            return null;
        }
        
        return cityConfig[city].timezone;
    }

    // Combine date and time into a single Date object with timezone handling
    combineDateTime(date, time, city = null, cityConfig = null) {
        if (!date || !time) return date;
        
        // Get timezone identifier for the city
        const timezone = this.getTimezoneForCity(city, cityConfig);
        
        // If no timezone configuration is available, return null
        if (!timezone) {
            console.log(`🐻 Bearracuda: Cannot convert time for ${city} - no timezone config, returning null`);
            return null;
        }
        
        // Create the date string in the city's local timezone
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(time.hours).padStart(2, '0');
        const minutes = String(time.minutes).padStart(2, '0');
        
        try {
            // Use a temporary date to determine the timezone offset for this specific date
            // This automatically handles DST transitions
            const tempDate = new Date(`${year}-${month}-${day}T12:00:00`);
            
            // Get the timezone offset for this specific date in this city
            // Using Intl.DateTimeFormat to get accurate offset including DST
            const formatter = new Intl.DateTimeFormat('en', {
                timeZone: timezone,
                timeZoneName: 'longOffset'
            });
            
            const parts = formatter.formatToParts(tempDate);
            const offsetPart = parts.find(part => part.type === 'timeZoneName');
            
            if (offsetPart && offsetPart.value) {
                // Parse offset like "GMT-04:00" or "GMT+09:00"
                const offsetMatch = offsetPart.value.match(/GMT([+-])(\d{2}):(\d{2})/);
                if (offsetMatch) {
                    const sign = offsetMatch[1] === '+' ? 1 : -1;
                    const offsetHours = parseInt(offsetMatch[2]);
                    const offsetMinutes = parseInt(offsetMatch[3]);
                    const totalOffsetMinutes = sign * (offsetHours * 60 + offsetMinutes);
                    
                    // Create local time and convert to UTC
                    const localTime = new Date(date);
                    localTime.setHours(time.hours, time.minutes, 0, 0);
                    const utcTime = new Date(localTime.getTime() - (totalOffsetMinutes * 60 * 1000));
                    
                    console.log(`🐻 Bearracuda: Converting ${city} time ${time.hours}:${time.minutes} (${timezone}) to UTC: ${utcTime.toISOString()}`);
                    
                    return utcTime;
                }
            }
            
            // If timezone conversion fails, return null instead of using complex fallbacks
            console.log(`🐻 Bearracuda: Could not determine timezone for ${city}, returning null`);
            return null;
            
        } catch (error) {
            console.log(`🐻 Bearracuda: Error in timezone conversion: ${error.message}, returning null`);
            return null;
        }
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

    // Extract city from text content using only city config patterns
    extractCityFromText(text, cityConfig = null) {
        if (!text) return null;
        if (!cityConfig) {
            console.log(`🐻 Bearracuda: No city config provided - cannot extract city from text`);
            return null;
        }
        
        for (const [cityKey, cityData] of Object.entries(cityConfig)) {
            if (cityData.patterns) {
                for (const pattern of cityData.patterns) {
                    if (text.toLowerCase().includes(pattern.toLowerCase())) {
                        console.log(`🐻 Bearracuda: Extracted city "${cityKey}" from text using config pattern "${pattern}": "${text.substring(0, 100)}..."`);
                        return cityKey;
                    }
                }
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
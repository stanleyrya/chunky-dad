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
            const events = [];
            const html = htmlData.html;
            
            if (!html) {
                console.warn('🐻 Bearracuda: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }
            
            // Check if this is an individual event page based on URL pattern
            const isDetailPage = /\/events\/[^\/]+\/$/.test(htmlData.url);
            
            let additionalLinks = [];
            
            if (isDetailPage) {

                const event = this.parseEventDetailPage(html, htmlData.url, parserConfig, cityConfig);
                if (event) {

                    events.push(event);
                    
                    // If ticket URL is found and it's an eventbrite URL, add it as an additional link
                    if (event.ticketUrl && event.ticketUrl.includes('eventbrite') && parserConfig.urlDiscoveryDepth > 0) {
                        additionalLinks.push(event.ticketUrl);

                    }
                } else {

                }
            } else {
                // Try to parse as a listing page (though main /events/ returns 404)

                const listingEvents = this.parseEventListingPage(html, htmlData.url, parserConfig, cityConfig);

                events.push(...listingEvents);
            }
            
            // Extract additional URLs if urlDiscoveryDepth > 0 (for listing pages)
            if (parserConfig.urlDiscoveryDepth > 0 && !isDetailPage) {

                const extractedLinks = this.extractAdditionalUrls(html, htmlData.url, parserConfig);
                additionalLinks.push(...extractedLinks);
            } else if (!isDetailPage) {

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

    // Parse an individual event detail page
    parseEventDetailPage(html, sourceUrl, parserConfig = {}, cityConfig = null) {
        try {
            // Extract title (usually the city name)
            let title = this.extractTitle(html);
            
            // Extract date
            const dateInfo = this.extractDate(html);
            
            // Extract structured description content first (contains venue, address, links, timing)
            const structuredSections = this.extractStructuredDescription(html);
            const structuredDescription = this.buildFormattedDescription(structuredSections);
            
            // Extract venue information - prefer structured data
            let venueInfo = { name: '', address: '' };
            if (structuredSections.location.venue) {
                venueInfo.name = structuredSections.location.venue;
            } else {
                venueInfo = this.extractVenue(html);
            }
            
            // Extract address - prefer structured data
            let address = '';
            if (structuredSections.location.address) {
                address = structuredSections.location.address;
            } else {
                address = this.extractAddress(html);
            }
            
            // Extract entertainment/performers
            const performers = this.extractPerformers(html);
            
            // Extract ticket/external links - prefer structured data
            let links = { facebook: '', eventbrite: '' };
            if (structuredSections.links.facebook || structuredSections.links.eventbrite || structuredSections.links.tickets) {
                links.facebook = structuredSections.links.facebook;
                links.eventbrite = structuredSections.links.eventbrite;
                links.tickets = structuredSections.links.tickets;
            } else {
                links = this.extractExternalLinks(html);
            }
            
            // Extract special info (like anniversary details)
            const specialInfo = this.extractSpecialInfo(html);
            
            // Extract full description content (fallback)
            const fullDescription = this.extractFullDescription(html);
            
            // Extract city from URL and title
            const city = this.extractCityFromUrl(sourceUrl, cityConfig) || this.extractCityFromText(title, cityConfig);
            
            // Build description - prefer structured approach
            let description = '';
            if (structuredDescription && structuredDescription.length > 50) {
                // Use structured description if it contains substantial content
                description = structuredDescription;
            } else if (fullDescription) {
                // Fallback to full description extraction
                description += fullDescription + '\n';
            } else {
                // Final fallback to old logic
                if (specialInfo) description += specialInfo + '\n';
                if (performers) description += 'Entertainment: ' + performers + '\n';
                // Add timing details from structured data
                if (structuredSections.timing.startText || structuredSections.timing.endText) {
                    let timingText = '';
                    if (structuredSections.timing.startText) timingText += structuredSections.timing.startText;
                    if (structuredSections.timing.endText) {
                        if (timingText) timingText += ' - ';
                        timingText += structuredSections.timing.endText;
                    }
                    description += timingText + '\n';
                }
            }
            description = description.trim();
            
            // Create start date using structured timing data
            let startDate = null;
            if (dateInfo && structuredSections.timing.start) {
                // Combine date and start time with city timezone
                startDate = this.combineDateTime(dateInfo, structuredSections.timing.start, city, cityConfig);
            } else if (dateInfo) {
                startDate = dateInfo;
            }
            
            // Create end date using structured timing data
            let endDate = null;
            if (dateInfo && structuredSections.timing.end) {
                endDate = this.combineDateTime(dateInfo, structuredSections.timing.end, city, cityConfig);
                // If end time is earlier than start time, assume it's next day
                if (endDate && startDate && endDate <= startDate) {
                    endDate = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
                }
            }
            
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
                timezone: this.getTimezoneForCity(city, cityConfig),
                url: sourceUrl, // Use consistent 'url' field name across all parsers
                cover: '', // No cover charge info found in the sample
                image: this.extractImage(html),
                // Don't include gmaps here - let SharedCore generate it from address/placeId
                source: this.config.source,
                // Additional bearracuda-specific fields
                facebook: links.facebook,
                ticketUrl: links.tickets || links.eventbrite, // Use ticketUrl as the primary ticket field
                placeId: structuredSections.location.placeId || null, // Pass place ID to shared-core for gmaps generation
                isBearEvent: true // Bearracuda events are always bear events
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
            
            return event;
            
        } catch (error) {
            console.warn(`🐻 Bearracuda: Failed to parse event detail page ${sourceUrl}: ${error.message || error}`);
            
            return null;
        }
    }

    // Parse event listing page (though main /events/ doesn't exist)
    parseEventListingPage(html, sourceUrl, parserConfig = {}, cityConfig = null) {
        const events = [];
        
        try {
            // Look for event links on main page or other listing pages
            const eventLinkPattern = /href="(https:\/\/bearracuda\.com\/events\/[^"]+)"/gi;
            let match;
            const eventUrls = new Set();
            
            while ((match = eventLinkPattern.exec(html)) !== null) {
                eventUrls.add(match[1]);
            }
            
            // For listing pages, we return empty events but provide additional links
            // The actual parsing happens when the detail pages are processed
            
        } catch (error) {
            console.warn(`🐻 Bearracuda: Error parsing listing page: ${error}`);
        }
        
        return events;
    }

    // Extract title from page
    extractTitle(html) {
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
                    return title;
                }
            }
        }
        
        // Try to extract city name from URL as fallback
        const urlMatch = html.match(/bearracuda\.com\/events\/([^\/]+)/);
        if (urlMatch && urlMatch[1]) {
            const citySlug = urlMatch[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            return `Bearracuda ${citySlug}`;
        }
        return 'Bearracuda Event';
    }

    // Extract date from page
    extractDate(html) {
        // Look for date with emoji pattern: 📅  August 23, 2025
        const emojiDatePattern = /📅\s*([^<\n]+)/;
        const emojiMatch = html.match(emojiDatePattern);
        
        if (emojiMatch && emojiMatch[1]) {
            const dateString = emojiMatch[1].trim();
            
            // Parse various date formats
            const parsedDate = this.parseDate(dateString);
            if (parsedDate) {
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
                const parsedDate = this.parseDate(match[1]);
                if (parsedDate) {
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
                    continue;
                }
                
                // Final validation - should look like a real address
                if (/^\d+\s+[A-Za-z\s\.,]+[A-Z]{2}$/.test(address.replace(/[,\s]+/g, ' ').trim())) {
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
                    return address;
                }
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

    // Extract structured content using consistent Bearracuda page structure
    extractStructuredDescription(html) {
        const sections = {
            timing: { start: null, end: null, startText: '', endText: '' },
            location: { venue: '', address: '', placeId: null },
            description: '',
            entertainment: { music: [], host: [] },
            links: { facebook: '', tickets: '', eventbrite: '' }
        };

        try {
            // STRUCTURE-BASED EXTRACTION leveraging consistent elementor patterns
            
            // 1. TIMING: Use existing time extraction method for proper parsing
            const timeInfo = this.extractTime(html);
            if (timeInfo.startTime) {
                sections.timing.start = timeInfo.startTime; // Structured time object with hours/minutes
                sections.timing.startText = timeInfo.details ? timeInfo.details.split(' - ')[0] : '';
            }
            if (timeInfo.endTime) {
                sections.timing.end = timeInfo.endTime; // Structured time object with hours/minutes  
                sections.timing.endText = timeInfo.details ? timeInfo.details.split(' - ')[1] || timeInfo.details : '';
            }

            // 2. VENUE: Always h2 heading with 🪩 emoji - the bar is ALWAYS in this container
            const venueMatch = html.match(/<h2[^>]*elementor-heading-title[^>]*>🪩&nbsp;&nbsp;([^<]+)<\/h2>/i);
            if (venueMatch) {
                sections.location.venue = venueMatch[1].replace(/&nbsp;/g, ' ').trim();
            }

            // 3. ADDRESS: ALWAYS immediately follows venue in the very next text-editor widget
            if (sections.location.venue) {
                // Use the venue as anchor to find address in next widget
                const addressMatch = html.match(new RegExp(`<h2[^>]*>🪩&nbsp;&nbsp;${sections.location.venue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/h2>[\\s\\S]*?<div[^>]*text-editor[^>]*>[\\s\\S]*?<div[^>]*elementor-widget-container[^>]*>\\s*([^<]*\\d+[^<]*(?:St|Ave|Rd|Blvd|Way|Drive|Lane)[^<]*)<\\/div>`, 'i'));
                if (addressMatch) {
                    sections.location.address = addressMatch[1].replace(/&nbsp;/g, ' ').trim();
                }
            }

            // 4. DESCRIPTION: Look for x14z9mp class content (Facebook-style description container)
            const descriptionMatch = html.match(/<div[^>]*x14z9mp[^>]*>([\s\S]*?)<\/div>/i);
            if (descriptionMatch) {
                sections.description = descriptionMatch[1]
                    .replace(/<br[^>]*>/gi, '\n')
                    .replace(/<[^>]*>/g, '') // Strip all HTML tags
                    .replace(/&nbsp;/g, ' ')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/\s+/g, ' ') // Normalize whitespace
                    .trim();
            }

            // 5. ENTERTAINMENT: Look for 🎧 and 🎤 sections (emojis are consistent markers)
            const musicMatch = html.match(/🎧[^<]*<strong>Music[^<]*Entertainment<\/strong><br>([\s\S]*?)(?=<\/div>)/i);
            if (musicMatch) {
                const performers = musicMatch[1].match(/<p>([^<]+)<\/p>/g);
                if (performers) {
                    sections.entertainment.music = performers
                        .map(p => p.replace(/<\/?p>/g, '').trim())
                        .filter(p => p && p !== '&nbsp;');
                }
            }

            const hostMatch = html.match(/🎤[^<]*<strong>Hosted by<\/strong><br>([\s\S]*?)(?=<\/div>)/i);
            if (hostMatch) {
                const hosts = hostMatch[1].match(/<p>([^<]+)<\/p>/g);
                if (hosts) {
                    sections.entertainment.host = hosts
                        .map(h => h.replace(/<\/?p>/g, '').trim())
                        .filter(h => h && h !== '&nbsp;');
                }
            }

            // 6. ROBUST BUTTON EXTRACTION: Use elementor-button structure (works for ANY ticket provider)
            this.extractAllButtons(html, sections);

            // 7. PLACE ID: Extract from any Google Maps embed
            const placeIdPatterns = [
                /place_id=([A-Za-z0-9_-]+)/i,
                /cid=(\d+)/i
            ];
            
            for (const pattern of placeIdPatterns) {
                const placeIdMatch = html.match(pattern);
                if (placeIdMatch) {
                    sections.location.placeId = placeIdMatch[1];
                    break;
                }
            }

        } catch (error) {
            console.warn(`🐻 Bearracuda: Error extracting structured description: ${error.message}`);
        }

        return sections;
    }

    // Extract ALL buttons using consistent elementor structure - future-proof for any ticket provider
    extractAllButtons(html, sections) {
        // Find all elementor buttons and categorize by text content
        const buttonPattern = /<a[^>]*class="[^"]*elementor-button[^"]*"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<span[^>]*elementor-button-text[^>]*>([^<]+)<\/span>[\s\S]*?<\/a>/gi;
        let match;
        
        while ((match = buttonPattern.exec(html)) !== null) {
            const url = match[1];
            const text = match[2].trim().toLowerCase();
            
            // Categorize based on button text (flexible for future providers)
            if (text.includes('rsvp')) {
                sections.links.facebook = url;
            } else if (text.includes('ticket') || text.includes('buy') || text.includes('purchase')) {
                sections.links.tickets = url;
                
                // Also categorize by URL domain for specific tracking
                if (url.includes('eventbrite.com')) {
                    sections.links.eventbrite = url;
                }
                // Future: could add ticketmaster.com, stubhub.com, etc.
            }
        }
    }

    // Build formatted description from structured sections
    buildFormattedDescription(sections) {
        let description = '';

        // Add main description/theme
        if (sections.description) {
            description += sections.description + '\n\n';
        }

        // Add entertainment information
        if (sections.entertainment.music.length > 0) {
            description += 'Music & Entertainment\n';
            sections.entertainment.music.forEach(performer => {
                // Replace colons with dashes to avoid key-value parsing issues in calendar-core
                const safePerformer = performer.replace(/:/g, ' -');
                description += `• ${safePerformer}\n`;
            });
            description += '\n';
        }

        return description.trim();
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
            return null;
        }
        
        // Use only city config patterns - no hardcoded assumptions
        for (const [cityKey, cityData] of Object.entries(cityConfig)) {
            if (cityData.patterns) {
                for (const pattern of cityData.patterns) {
                    if (url.toLowerCase().includes(pattern.toLowerCase())) {
                        return cityKey;
                    }
                }
            }
        }
        return null;
    }

    // Extract additional URLs for detail page processing
    extractAdditionalUrls(html, sourceUrl, parserConfig) {
        const urls = [];
        
        try {
            // Look for bearracuda event URLs with multiple patterns
            const urlPatterns = [
                // Event detail page links with full URLs
                /href="(https:\/\/bearracuda\.com\/events\/[^"]+)"/gi,
                // Relative event links
                /href="(\/events\/[^"]+)"/gi,
                // Additional pattern to catch any missed links
                /<a[^>]+href="([^"]*\/events\/[^"]*)"[^>]*>/gi
            ];
            
            const foundUrls = new Set(); // Track unique URLs found
            
            for (let i = 0; i < urlPatterns.length; i++) {
                const pattern = urlPatterns[i];
                let match;
                let patternCount = 0;
                
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
                    
                    // Skip if already found (avoid duplicate validation logs)
                    if (foundUrls.has(url)) {
                        continue;
                    }
                    foundUrls.add(url);
                    
                    // Validate and add URL (shared-core will handle deduplication)
                    if (this.isValidEventUrl(url, parserConfig)) {
                        urls.push(url);
                        patternCount++;
                    }
                    
                    // Limit to prevent infinite loops (shared-core will also limit)
                    const maxUrls = parserConfig.maxAdditionalUrls || this.config.maxAdditionalUrls || 20;
                    if (urls.length >= maxUrls) {
                        break;
                    }
                }
            }
        } catch (error) {
            console.warn(`🐻 Bearracuda: Error extracting additional URLs: ${error}`);
        }
        
        return urls;
    }

    // Validate if URL is a valid event URL
    isValidEventUrl(url, parserConfig) {
        if (!url || typeof url !== 'string') {
            return false;
        }
        
        try {
            // Use simple URL parsing that works in Scriptable
            const urlPattern = /^(https?:)\/\/([^\/]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/;
            const match = url.match(urlPattern);
            
            if (!match) {
                return false;
            }
            
            const [, protocol, host, pathname = '/', search = '', hash = ''] = match;
            const hostname = host.split(':')[0]; // Remove port if present
            
            // Must be Bearracuda domain
            if (!hostname.includes('bearracuda.com')) {
                return false;
            }
            
            // Must be event page pattern
            if (!/\/events\/[^\/]+\/?$/.test(pathname)) {
                return false;
            }
            
            // Avoid admin, login, or social media links
            const invalidPaths = ['/admin', '/login', '/wp-admin', '/wp-login', '#', 'javascript:', 'mailto:'];
            if (invalidPaths.some(invalid => url.includes(invalid))) {
                return false;
            }
            
            // URL filtering is now handled automatically by parser selection
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
                        date = new Date(Date.UTC(year, month, day));
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
                    
                    // Create local time as UTC first, then apply timezone offset
                    const year = date.getUTCFullYear();
                    const month = date.getUTCMonth();
                    const day = date.getUTCDate();
                    const localTimeAsUTC = new Date(Date.UTC(year, month, day, time.hours, time.minutes, 0, 0));
                    const utcTime = new Date(localTimeAsUTC.getTime() - (totalOffsetMinutes * 60 * 1000));
                    
                    return utcTime;
                }
            }
            
            // If timezone conversion fails, return null instead of using complex fallbacks
            return null;
            
        } catch (error) {
            return null;
        }
    }

    // Extract city from text content using only city config patterns
    extractCityFromText(text, cityConfig = null) {
        if (!text) return null;
        if (!cityConfig) {
            return null;
        }
        
        for (const [cityKey, cityData] of Object.entries(cityConfig)) {
            if (cityData.patterns) {
                for (const pattern of cityData.patterns) {
                    if (text.toLowerCase().includes(pattern.toLowerCase())) {
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

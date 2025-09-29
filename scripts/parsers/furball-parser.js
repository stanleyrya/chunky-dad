// ============================================================================
// FURBALL PARSER - PURE PARSING LOGIC
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE parsing logic only
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Pure JavaScript parsing functions (HTML processing)
// ✅ Venue-specific extraction logic for furball.nyc ticket page
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

class FurballParser {
    constructor(config = {}) {
        this.config = {
            source: 'furball',
            maxAdditionalUrls: 10,
            ...config
        };
    }

    // Main parsing method - receives HTML data and returns events + additional links
    parseEvents(htmlData, parserConfig = {}, cityConfig = null) {
        try {
            const events = [];
            const additionalLinks = [];
            const html = htmlData && htmlData.html ? htmlData.html : '';

            if (!html) {
                console.warn('🐻‍❄️ Furball: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }

            // Extract event sections from the HTML
            const eventSections = this.extractEventSections(html);
            for (const section of eventSections) {
                const event = this.parseEventSection(section, htmlData.url);
                if (event) {
                    // Enforce endDate since system does not support missing end dates
                    if (!event.endDate && event.startDate) {
                        event.endDate = new Date(event.startDate);
                    }
                    events.push(event);
                }

                // Collect ticket links from the section
                const links = this.extractTicketLinks(section);
                for (const link of links) {
                    if (!additionalLinks.includes(link)) {
                        additionalLinks.push(link);
                    }
                }
            }

            console.log(`🐻‍❄️ Furball: Found ${events.length} events, ${additionalLinks.length} additional links`);

            return {
                events,
                additionalLinks: parserConfig.urlDiscoveryDepth > 0 ? additionalLinks : [],
                source: this.config.source,
                url: htmlData.url
            };
        } catch (error) {
            console.error(`🐻‍❄️ Furball: Error parsing events: ${error}`);
            return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
        }
    }

    // Extract event sections from HTML - look for sections containing date patterns
    extractEventSections(html) {
        const sections = [];
        try {
            // Look for the main content section that contains all events
            const mainSectionMatch = html.match(/<section[^>]*id="comp-l6nopnaw"[^>]*>([\s\S]*?)<\/section>/i);
            if (mainSectionMatch) {
                const mainSection = mainSectionMatch[1];
                // Split by date patterns to get individual events
                const eventBlocks = this.splitByEventDate(mainSection);
                sections.push(...eventBlocks);
            } else {
                // Fallback: look for any sections with date patterns
                const sectionRegex = /<section[^>]*>([\s\S]*?)<\/section>/gi;
                let match;
                while ((match = sectionRegex.exec(html)) !== null) {
                    const sectionContent = match[1];
                    if (this.containsEventDate(sectionContent)) {
                        sections.push(sectionContent);
                    }
                }
            }
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to extract event sections: ${error}`);
        }
        return sections;
    }

    // Split content by event dates to get individual event blocks
    splitByEventDate(content) {
        const events = [];
        const datePattern = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}/gi;
        
        // Find all date matches with their positions
        const dateMatches = [];
        let match;
        while ((match = datePattern.exec(content)) !== null) {
            dateMatches.push({
                date: match[0],
                index: match.index
            });
        }
        
        // Create event blocks for each date
        for (let i = 0; i < dateMatches.length; i++) {
            const currentDate = dateMatches[i];
            const nextDate = dateMatches[i + 1];
            
            const startIndex = currentDate.index;
            const endIndex = nextDate ? nextDate.index : content.length;
            
            const eventBlock = content.substring(startIndex, endIndex);
            events.push(eventBlock);
        }
        
        return events;
    }

    // Check if section content contains an event date
    containsEventDate(content) {
        const datePatterns = [
            /(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+\d{1,2},\s*\d{4}/i,
            /(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{1,2},\s*\d{4}/i
        ];
        return datePatterns.some(pattern => pattern.test(content));
    }

    // Parse a single event section into an event object
    parseEventSection(section, sourceUrl) {
        try {
            // Extract date from the section
            const dateMatch = section.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}/i);
            if (!dateMatch) {
                return null;
            }
            const startDate = this.parseDate(dateMatch[0]);
            if (!startDate) {
                return null;
            }

            // Extract event title and venue from text content
            const textContent = this.extractTextContent(section);
            const lines = textContent.split('\n').map(s => s.trim()).filter(Boolean);
            
            // Find the event title and venue information
            let title = '';
            let bar = '';
            let address = '';
            
            // Process the text content to extract title, venue, and address
            // The text is usually in one line with format: "DATE FURBALL EVENT_NAME VENUE - LOCATION BUTTON_TEXT"
            const fullText = lines.join(' ');
            
            // Extract title (everything between FURBALL and venue)
            const titleMatch = fullText.match(/FURBALL\s+([^-]+?)(?:\s+(?:Eagle|Legacy|Bar|Club|Theater|Hall|Center|Lounge))/i);
            if (titleMatch) {
                title = titleMatch[1].trim();
                // Clean up the title
                title = title.replace(/More Info Here!.*$/, '').trim();
                title = title.replace(/FOXY Tickets Here!.*$/, '').trim();
                title = title.replace(/Tickets Here!.*$/, '').trim();
                title = title.replace(/Buy Tickets.*$/, '').trim();
                title = title.replace(/Purchase.*$/, '').trim();
                title = title.replace(/&nbsp;/g, ' ').trim();
            }
            
            // Extract venue and address (look for "VENUE - LOCATION" pattern)
            const venueMatch = fullText.match(/(Eagle|Legacy|Bar|Club|Theater|Hall|Center|Lounge)[^a-zA-Z]*?-\s*([^!]+)/i);
            if (venueMatch) {
                bar = venueMatch[1].trim();
                address = venueMatch[2].trim();
                // Clean up address
                address = address.replace(/More Info Here!.*$/, '').trim();
                address = address.replace(/FOXY Tickets Here!.*$/, '').trim();
                address = address.replace(/Tickets Here!.*$/, '').trim();
                address = address.replace(/Buy Tickets.*$/, '').trim();
                address = address.replace(/Purchase.*$/, '').trim();
            }

            // Extract images from this section
            const images = this.extractImagesFromSection(section);

            // Extract ticket URL
            const ticketUrl = this.extractTicketUrl(section);

            // FURBALL events always run 10 PM - 2 AM (next day)
            const startDateTime = new Date(startDate);
            startDateTime.setHours(22, 0, 0, 0); // 10 PM
            
            const endDateTime = new Date(startDate);
            endDateTime.setHours(2, 0, 0, 0); // 2 AM next day
            endDateTime.setDate(endDateTime.getDate() + 1); // Move to next day

            const event = {
                title,
                startDate: startDateTime,
                endDate: endDateTime,
                bar,
                address,
                url: sourceUrl,
                ticketUrl,
                source: this.config.source,
                images: images
            };

            return event;
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to parse event section: ${error}`);
            return null;
        }
    }

    // Extract text content from HTML, removing tags
    extractTextContent(html) {
        return html
            .replace(/<br[^>]*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Extract images from a specific section
    extractImagesFromSection(section) {
        const images = [];
        try {
            // Match img tags with src attributes
            const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi;
            let match;
            while ((match = imgRegex.exec(section)) !== null) {
                const src = match[1];
                const altMatch = match[0].match(/alt="([^"]*)"/i);
                const alt = altMatch ? altMatch[1] : '';
                
                // Filter out common non-content images (logos, icons, etc.)
                if (this.isContentImage(src, alt)) {
                    images.push({
                        src: src,
                        alt: alt,
                        type: this.getImageType(src, alt)
                    });
                }
            }
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to extract images from section: ${error}`);
        }
        return images;
    }

    // Determine if an image is likely content (not just logos/icons)
    isContentImage(src, alt) {
        // Skip common non-content images
        const skipPatterns = [
            /logo/i,
            /icon/i,
            /favicon/i,
            /button/i,
            /arrow/i,
            /social/i,
            /facebook/i,
            /twitter/i,
            /instagram/i,
            /youtube/i,
            /linkedin/i,
            /\.svg$/i,
            /placeholder/i,
            /loading/i,
            /spinner/i
        ];
        
        const combinedText = `${src} ${alt}`.toLowerCase();
        return !skipPatterns.some(pattern => pattern.test(combinedText));
    }

    // Determine image type based on src and alt
    getImageType(src, alt) {
        const combinedText = `${src} ${alt}`.toLowerCase();
        
        if (combinedText.includes('poster') || combinedText.includes('flyer')) {
            return 'poster';
        } else if (combinedText.includes('photo') || combinedText.includes('image')) {
            return 'photo';
        } else if (combinedText.includes('banner') || combinedText.includes('header')) {
            return 'banner';
        } else {
            return 'image';
        }
    }

    // Extract ticket URL from section
    extractTicketUrl(section) {
        try {
            // Look for ticket links
            const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
            let match;
            while ((match = linkRegex.exec(section)) !== null) {
                const href = match[1];
                const text = match[2].replace(/<[^>]+>/g, '').trim();
                if (this.isLikelyTicketLink(text, href)) {
                    return href;
                }
            }
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to extract ticket URL: ${error}`);
        }
        return '';
    }

    // Check if a link is likely a ticket link
    isLikelyTicketLink(text, href) {
        const ticketKeywords = ['ticket', 'buy', 'purchase', 'eventbrite', 'ticketweb', 'tickets'];
        const textLower = text.toLowerCase();
        const hrefLower = href.toLowerCase();
        
        return ticketKeywords.some(keyword => 
            textLower.includes(keyword) || hrefLower.includes(keyword)
        );
    }

    // Extract ticket links from section
    extractTicketLinks(section) {
        const links = [];
        try {
            const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
            let match;
            while ((match = linkRegex.exec(section)) !== null) {
                const href = match[1];
                const text = match[2].replace(/<[^>]+>/g, '').trim();
                if (this.isLikelyTicketLink(text, href)) {
                    links.push(href);
                }
            }
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to extract ticket links: ${error}`);
        }
        return links;
    }

    // Extract location from venue text
    extractLocationFromVenue(venueText) {
        // Look for common location patterns
        const locationPatterns = [
            /(NYC|New York)/i,
            /(Boston|MA|Massachusetts)/i,
            /(Chicago|IL|Illinois)/i,
            /(Los Angeles|LA|CA|California)/i,
            /(San Francisco|SF|CA|California)/i,
            /(Miami|FL|Florida)/i,
            /(Atlanta|GA|Georgia)/i,
            /(Seattle|WA|Washington)/i,
            /(Portland|OR|Oregon)/i,
            /(Denver|CO|Colorado)/i,
            /(Austin|TX|Texas)/i,
            /(Dallas|TX|Texas)/i,
            /(Houston|TX|Texas)/i,
            /(Phoenix|AZ|Arizona)/i,
            /(Las Vegas|NV|Nevada)/i
        ];
        
        for (const pattern of locationPatterns) {
            const match = venueText.match(pattern);
            if (match) {
                return match[0];
            }
        }
        
        // Look for state abbreviations or common city patterns
        const statePattern = /\b([A-Z]{2})\b/;
        const stateMatch = venueText.match(statePattern);
        if (stateMatch) {
            return stateMatch[0];
        }
        
        // If no location found, return empty string
        return '';
    }

    // Parse date string into a Date object
    parseDate(dateString) {
        if (!dateString) return null;
        const date = new Date(dateString);
        return isNaN(date.getTime()) ? null : date;
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FurballParser };
} else if (typeof window !== 'undefined') {
    window.FurballParser = FurballParser;
}
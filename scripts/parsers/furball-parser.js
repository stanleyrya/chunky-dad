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

            // Extract images from the page
            const images = this.extractImages(html);

            // Extract events from repeated H2 blocks that include a DATE line
            const blocks = this.extractEventBlocks(html);
            for (const block of blocks) {
                const event = this.parseEventBlock(block, htmlData.url, images);
                if (event) {
                    // Enforce endDate since system does not support missing end dates
                    if (!event.endDate && event.startDate) {
                        event.endDate = new Date(event.startDate);
                    }
                    events.push(event);
                }

                // Collect nearby vendor ticket links for optional discovery
                const links = this.extractNearbyTicketLinks(block);
                for (const link of links) {
                    if (!additionalLinks.includes(link)) {
                        additionalLinks.push(link);
                    }
                }
            }

            console.log(`🐻‍❄️ Furball: Found ${events.length} events, ${additionalLinks.length} additional links, ${images.length} images`);

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

    // Extract candidate H2 blocks that contain the date + title + venue lines
    extractEventBlocks(html) {
        const blocks = [];
        try {
            // Grab <h2 ...> ... </h2> content chunks (non-greedy)
            const h2Regex = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
            let match;
            while ((match = h2Regex.exec(html)) !== null) {
                const content = match[1];
                // Must contain a full month-date-year in uppercase or regular case
                if (/(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+\d{1,2},\s*\d{4}/i.test(content)) {
                    // Capture a neighborhood around this block to find nearby ticket links
                    const startIdx = Math.max(0, match.index - 1500);
                    const endIdx = Math.min(html.length, h2Regex.lastIndex + 1500);
                    const neighborhood = html.slice(startIdx, endIdx);
                    blocks.push({ raw: content, neighborhood });
                }
            }
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to extract event blocks: ${error}`);
        }
        return blocks;
    }

    // Extract images from HTML content
    extractImages(html) {
        const images = [];
        try {
            // Match img tags with src attributes
            const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi;
            let match;
            while ((match = imgRegex.exec(html)) !== null) {
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
            console.warn(`🐻‍❄️ Furball: Failed to extract images: ${error}`);
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

    // Parse a single H2 block into an event object
    parseEventBlock(block, sourceUrl, images = []) {
        try {
            const content = block.raw
                .replace(/\r/g, ' ')
                .replace(/\n/g, ' ')
                .replace(/<br[^>]*\/?>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/[ \t]+/g, ' ')
                .trim();

            // The first line should be a date like "AUGUST 30, 2025"
            const dateMatch = content.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}/i);
            if (!dateMatch) {
                return null;
            }
            const startDate = this.parseDate(dateMatch[0]);
            if (!startDate) {
                return null;
            }

            // Split lines based on our injected newlines from <br>
            const lines = content.split('\n').map(s => s.trim()).filter(Boolean);

            // Find the venue line that contains " - " (e.g., "Heretic - Atlanta, GA")
            let venueLine = lines.find(l => /\s-\s/.test(l));
            let bar = '';
            let address = '';
            if (venueLine) {
                const parts = venueLine.split(/\s-\s/);
                bar = (parts[0] || '').trim();
                address = (parts[1] || '').trim();
                // Clean up address - remove HTML entities and extra spaces
                address = address.replace(/&nbsp;/g, '').replace(/\s+/g, ' ').trim();
            }

            // Build title from non-date, non-venue lines
            // Example: "FURBALL Atlanta" + "CAMP: Underwear + Gear Party"
            const titleParts = lines.filter(l => l !== dateMatch[0] && l !== venueLine);
            let title = titleParts.join(' ').trim();
            // Clean up HTML entities
            title = title.replace(/&nbsp;/g, '').replace(/\s+/g, ' ').trim();

            // Ticket URL: pick anchor hrefs by label/text only
            const ticketUrls = this.extractNearbyTicketLinks(block);
            const ticketUrl = ticketUrls.length > 0 ? ticketUrls[0] : '';

            // FURBALL events always run 10 PM - 2 AM (next day)
            const startDateTime = new Date(startDate);
            startDateTime.setHours(22, 0, 0, 0); // 10 PM
            
            const endDateTime = new Date(startDate);
            endDateTime.setHours(2, 0, 0, 0); // 2 AM next day
            endDateTime.setDate(endDateTime.getDate() + 1); // Move to next day

            // Find relevant images for this event
            const eventImages = this.findRelevantImages(images, title, bar);

            const event = {
                title,
                startDate: startDateTime,
                endDate: endDateTime,
                bar,
                address,
                url: sourceUrl,
                ticketUrl,
                source: this.config.source,
                images: eventImages
            };

            return event;
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to parse event block: ${error}`);
            return null;
        }
    }

    // Find nearby ticket links relying solely on anchor label/text
    extractNearbyTicketLinks(block) {
        const links = [];
        try {
            const html = block.neighborhood || '';
            // Match anchor tags
            const anchorRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
            let m;
            while ((m = anchorRegex.exec(html)) !== null) {
                const href = (m[1] || '').trim();
                const text = (m[2] || '').replace(/<[^>]+>/g, ' ').trim();
                if (this.isLikelyTicketByText(text)) {
                    links.push(href);
                }
            }
        } catch (_) { /* no-op */ }
        return Array.from(new Set(links));
    }

    isLikelyTicketByText(text) {
        if (!text) return false;
        return /ticket|admission|rsvp|buy now|get tickets|purchase/i.test(text);
    }

    // Find images relevant to a specific event
    findRelevantImages(images, title, bar) {
        const relevantImages = [];
        
        try {
            for (const image of images) {
                const imageText = `${image.src} ${image.alt}`.toLowerCase();
                const eventText = `${title} ${bar}`.toLowerCase();
                
                // Check if image is relevant to this event
                if (this.isImageRelevantToEvent(imageText, eventText, image)) {
                    relevantImages.push(image);
                }
            }
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to find relevant images: ${error}`);
        }
        
        return relevantImages;
    }

    // Determine if an image is relevant to a specific event
    isImageRelevantToEvent(imageText, eventText, image) {
        // If it's a poster or flyer, it's likely relevant
        if (image.type === 'poster' || image.type === 'flyer') {
            return true;
        }
        
        // Check for common event-related keywords
        const eventKeywords = [
            'furball',
            'party',
            'event',
            'dance',
            'club',
            'night',
            'october',
            'november',
            'december',
            'january',
            'february',
            'march',
            'april',
            'may',
            'june',
            'july',
            'august',
            'september'
        ];
        
        // Check if image contains event-related keywords
        const hasEventKeywords = eventKeywords.some(keyword => 
            imageText.includes(keyword.toLowerCase())
        );
        
        // Check if image alt text or src contains venue name
        const hasVenueMatch = eventText.split(' ').some(word => 
            word.length > 3 && imageText.includes(word)
        );
        
        return hasEventKeywords || hasVenueMatch;
    }

    // Parse date string into a Date object (simplified as requested)
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


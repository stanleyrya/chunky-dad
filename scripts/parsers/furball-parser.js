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

            // Extract events from repeated H2 blocks that include a DATE line
            const blocks = this.extractEventBlocks(html);
            for (const block of blocks) {
                const event = this.parseEventBlock(block, htmlData.url);
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

    // Parse a single H2 block into an event object
    parseEventBlock(block, sourceUrl) {
        try {
            const content = block.raw
                .replace(/\r/g, ' ')
                .replace(/\n/g, ' ')
                .replace(/<br[^>]*>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/\s+/g, ' ')
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

            // Find a line that looks like "Venue - City[, ST]"
            let venueLine = lines.find(l => /\s-\s/.test(l));
            let bar = '';
            let address = '';
            if (venueLine) {
                const parts = venueLine.split(/\s-\s/);
                bar = (parts[0] || '').trim();
                address = (parts[1] || '').trim();
            }

            // Build title by taking non-date, non-venue lines
            const titleParts = lines.filter(l => l !== dateMatch[0] && l !== venueLine);
            let title = titleParts.join(' — ').trim();

            // Ticket URL: pick anchor hrefs by label/text only
            const ticketUrls = this.extractNearbyTicketLinks(block);
            const ticketUrl = ticketUrls.length > 0 ? ticketUrls[0] : '';

            const event = {
                title,
                startDate,
                endDate: new Date(startDate),
                bar,
                address,
                url: sourceUrl,
                ticketUrl,
                source: this.config.source
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


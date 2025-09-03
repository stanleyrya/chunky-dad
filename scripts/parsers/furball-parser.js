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
            if (!title) {
                title = 'FURBALL';
            }

            // Ticket URL: look in neighborhood for vendor links or "Tickets Here!" buttons
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

    // Find nearby ticket links from common vendors or labeled buttons
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
                if (this.isLikelyTicketUrl(href, text)) {
                    links.push(href);
                }
            }
        } catch (_) { /* no-op */ }
        return Array.from(new Set(links));
    }

    isLikelyTicketUrl(href, text) {
        if (!href) return false;
        const lower = href.toLowerCase();
        const vendors = [
            'ticketleap.com',
            'ticketweb.com',
            'tixr.com',
            'dice.fm',
            'seetickets',
            'eventbrite.com',
            'posh.vip',
            'purplepass',
            'feverup',
            'stubhub'
        ];
        const isVendor = vendors.some(v => lower.includes(v));
        const isLabeled = /tickets?\s+here/i.test(text || '');
        return isVendor || isLabeled;
    }

    // Parse date string into a Date object (reused logic from generic parser)
    parseDate(dateString) {
        if (!dateString) return null;
        try {
            dateString = dateString.replace(/\s+/g, ' ').trim();
            const formats = [
                /(\d{1,2})\/(\d{1,2})\/(\d{4})/,         // MM/DD/YYYY
                /(\d{1,2})-(\d{1,2})-(\d{4})/,             // MM-DD-YYYY
                /(\d{4})-(\d{2})-(\d{2})/,                 // YYYY-MM-DD
                /(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}/i, // Month DD, YYYY
                /(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i // DD Month YYYY
            ];
            for (const format of formats) {
                const match = dateString.match(format);
                if (match) {
                    let date;
                    if (format.source.includes('january|february')) {
                        const months = {
                            'january': '01', 'february': '02', 'march': '03', 'april': '04',
                            'may': '05', 'june': '06', 'july': '07', 'august': '08',
                            'september': '09', 'october': '10', 'november': '11', 'december': '12'
                        };
                        if (match[3]) {
                            // Month DD, YYYY
                            const month = months[match[1].toLowerCase()];
                            const day = match[2].padStart(2, '0');
                            const year = match[3];
                            date = new Date(`${year}-${month}-${day}`);
                        } else {
                            // DD Month YYYY
                            const day = match[1].padStart(2, '0');
                            const month = months[match[2].toLowerCase()];
                            const year = match[3];
                            date = new Date(`${year}-${month}-${day}`);
                        }
                    } else if (match[3] && match[3].length === 4) {
                        // YYYY-MM-DD
                        date = new Date(`${match[1]}-${match[2]}-${match[3]}`);
                    } else {
                        // MM/DD/YYYY or MM-DD-YYYY
                        const month = match[1].padStart(2, '0');
                        const day = match[2].padStart(2, '0');
                        const year = match[3];
                        date = new Date(`${year}-${month}-${day}`);
                    }
                    if (!isNaN(date.getTime())) {
                        return date;
                    }
                }
            }
            const date = new Date(dateString);
            if (!isNaN(date.getTime())) {
                return date;
            }
        } catch (error) {
            console.warn(`🐻‍❄️ Furball: Failed to parse date "${dateString}": ${error}`);
        }
        return null;
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FurballParser };
} else if (typeof window !== 'undefined') {
    window.FurballParser = FurballParser;
}


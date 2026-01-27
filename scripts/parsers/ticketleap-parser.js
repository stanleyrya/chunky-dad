// ============================================================================
// TICKETLEAP PARSER - PURE PARSING LOGIC
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE parsing logic only
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Pure JavaScript parsing functions (HTML/JSON processing)
// ✅ Ticketleap event extraction from JSON-LD
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

class TicketleapParser {
    constructor(config = {}) {
        this.config = {
            source: 'ticketleap',
            maxAdditionalUrls: 10,
            ...config
        };
    }

    // Main parsing method - receives HTML data and returns events + additional links
    parseEvents(htmlData, parserConfig = {}, cityConfig = null) {
        try {
            const events = [];
            const html = htmlData.html;

            if (!html) {
                console.warn('Ticketleap: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }

            const jsonLdEvents = this.extractEventsFromJsonLd(html, htmlData.url);
            if (jsonLdEvents.length > 0) {
                events.push(...jsonLdEvents);
            }

            let additionalLinks = [];
            if (parserConfig.urlDiscoveryDepth > 0) {
                additionalLinks = this.extractAdditionalUrls(html, htmlData.url, parserConfig);
            }

            console.log(`Ticketleap: Found ${events.length} events, ${additionalLinks.length} additional links`);

            return {
                events,
                additionalLinks,
                source: this.config.source,
                url: htmlData.url
            };
        } catch (error) {
            console.error(`Ticketleap: Error parsing events: ${error}`);
            return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
        }
    }

    extractEventsFromJsonLd(html, sourceUrl) {
        const events = [];
        try {
            const jsonLdRegex = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
            let match;
            while ((match = jsonLdRegex.exec(html)) !== null) {
                const rawJson = match[1].trim();
                if (!rawJson) {
                    continue;
                }

                const parsed = this.safeJsonParse(rawJson);
                const items = Array.isArray(parsed) ? parsed : [parsed];

                for (const item of items) {
                    if (!item || item['@type'] !== 'Event') {
                        continue;
                    }
                    const event = this.createEventFromJsonLd(item, sourceUrl);
                    if (event) {
                        events.push(event);
                    }
                }
            }
        } catch (error) {
            console.warn(`Ticketleap: Failed to extract JSON-LD events: ${error}`);
        }
        return events;
    }

    createEventFromJsonLd(data, sourceUrl) {
        try {
            const title = this.decodeHtml(data.name || '');
            const startDate = this.parseDateString(data.startDate);
            const endDate = this.parseDateString(data.endDate);
            const description = this.decodeHtml(data.description || '');
            const url = data.url || sourceUrl;
            const image = Array.isArray(data.image) ? data.image[0] : data.image || '';

            if (!title || !startDate) {
                return null;
            }

            const location = data.location || {};
            const venueName = location.name || '';
            const addressData = location.address || {};
            const address = this.formatAddress(addressData);

            const event = {
                title,
                startDate,
                endDate: endDate || new Date(startDate),
                bar: venueName,
                address,
                url,
                ticketUrl: url,
                description,
                image,
                source: this.config.source
            };

            if (addressData.addressLocality) {
                event.city = String(addressData.addressLocality).toLowerCase().trim();
            }

            return event;
        } catch (error) {
            console.warn(`Ticketleap: Failed to create event: ${error}`);
            return null;
        }
    }

    parseDateString(dateString) {
        if (!dateString) return null;
        const date = new Date(dateString);
        return isNaN(date.getTime()) ? null : date;
    }

    formatAddress(address) {
        if (!address || typeof address !== 'object') {
            return '';
        }

        const parts = [
            address.streetAddress,
            address.addressLocality,
            address.addressRegion,
            address.postalCode,
            address.addressCountry
        ].filter(Boolean);

        return parts.join(', ');
    }

    decodeHtml(text) {
        return String(text || '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim();
    }

    safeJsonParse(text) {
        try {
            return JSON.parse(text);
        } catch (error) {
            return null;
        }
    }

    // Extract additional URLs (ticket pages often include other events)
    extractAdditionalUrls(html, sourceUrl, parserConfig) {
        const urls = new Set();
        try {
            const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>/gi;
            let match;
            while ((match = linkRegex.exec(html)) !== null) {
                const url = match[1];
                if (this.isValidAdditionalUrl(url)) {
                    urls.add(url);
                }
            }
        } catch (error) {
            console.warn(`Ticketleap: Failed to extract additional URLs: ${error}`);
        }

        return Array.from(urls).slice(0, this.config.maxAdditionalUrls);
    }

    isValidAdditionalUrl(url) {
        if (!url || typeof url !== 'string') return false;
        if (url.startsWith('#') || url.startsWith('javascript:')) return false;
        return /^https?:\/\//i.test(url);
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TicketleapParser };
} else if (typeof window !== 'undefined') {
    window.TicketleapParser = TicketleapParser;
} else {
    // Scriptable environment
    this.TicketleapParser = TicketleapParser;
}

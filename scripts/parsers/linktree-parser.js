// ============================================================================
// LINKTREE PARSER - PURE PARSING LOGIC
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE parsing logic only
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Pure JavaScript parsing functions (HTML/JSON processing)
// ✅ Generic Linktree page parsing for any linktr.ee page
// ✅ Ticket link extraction based on button text
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

class LinktreeParser {
    constructor(config = {}) {
        this.config = {
            source: 'linktree',
            maxAdditionalUrls: 15,
            ...config
        };
    }

    // Main parsing method - receives HTML data and returns events + additional links
    parseEvents(htmlData, parserConfig = {}, cityConfig = null) {
        try {
            const events = [];
            const html = htmlData.html;
            
            if (!html) {
                console.warn('🔗 Linktree: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }
            
            // Extract ticket links from the Linktree page
            const ticketLinks = this.extractTicketLinks(html, htmlData.url);
            console.log(`🔗 Linktree: Found ${ticketLinks.length} ticket links`);
            
            // For each ticket link, create an event placeholder
            for (const ticketLink of ticketLinks) {
                const event = this.createEventFromLink(ticketLink, htmlData.url, parserConfig);
                if (event) {
                    events.push(event);
                    console.log(`🔗 Linktree: Created event placeholder for: ${event.title}`);
                }
            }
            
            // Extract additional URLs if urlDiscoveryDepth > 0 (depth checking is handled by shared-core)
            let additionalLinks = [];
            if (parserConfig.urlDiscoveryDepth > 0) {
                additionalLinks = this.extractAdditionalUrls(html, htmlData.url, parserConfig);
            }
            
            console.log(`🔗 Linktree: Found ${events.length} events, ${additionalLinks.length} additional links`);
            
            return {
                events: events,
                additionalLinks: additionalLinks,
                source: this.config.source,
                url: htmlData.url
            };
            
        } catch (error) {
            console.error(`🔗 Linktree: Error parsing events: ${error}`);
            return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
        }
    }

    // Extract ticket links from the Linktree page
    extractTicketLinks(html, sourceUrl) {
        const ticketLinks = [];
        
        try {
            console.log(`🔗 Linktree: Extracting ticket links from Linktree page`);
            
            // Look for links with data-testid="LinkClickTriggerLink" that contain ticket-related text
            const linkPattern = /<a[^>]*href="([^"]+)"[^>]*data-testid="LinkClickTriggerLink"[^>]*>[\s\S]*?<\/a>/g;
            let match;
            let matchCount = 0;
            
            while ((match = linkPattern.exec(html)) !== null) {
                const fullLinkHtml = match[0];
                const url = this.normalizeUrl(match[1], sourceUrl);
                
                if (url && this.isTicketLink(fullLinkHtml, url)) {
                    ticketLinks.push({
                        url: url,
                        html: fullLinkHtml,
                        title: this.extractLinkTitle(fullLinkHtml)
                    });
                    console.log(`🔗 Linktree: Found ticket link: ${url} (${this.extractLinkTitle(fullLinkHtml)})`);
                }
            }
            
        } catch (error) {
            console.warn(`🔗 Linktree: Error extracting ticket links: ${error}`);
        }
        
        return ticketLinks;
    }

    // Check if a link is a ticket link - super simple: just look for "ticket" in the text
    isTicketLink(linkHtml, url) {
        try {
            const linkText = this.extractLinkTitle(linkHtml).toLowerCase();
            return linkText.includes('ticket');
        } catch (error) {
            console.warn(`🔗 Linktree: Error checking if link is ticket link: ${error}`);
            return false;
        }
    }


    // Extract the title/text from a link HTML element
    extractLinkTitle(linkHtml) {
        try {
            // Look for text content in various possible locations
            const patterns = [
                // Text directly in the link
                /<a[^>]*>([^<]+)<\/a>/,
                // Text in div elements within the link
                /<div[^>]*>([^<]+)<\/div>/,
                // Text in span elements
                /<span[^>]*>([^<]+)<\/span>/,
                // Text in h1-h6 elements
                /<h[1-6][^>]*>([^<]+)<\/h[1-6]>/,
                // Text in p elements
                /<p[^>]*>([^<]+)<\/p>/
            ];
            
            for (const pattern of patterns) {
                const match = linkHtml.match(pattern);
                if (match && match[1]) {
                    const title = match[1].trim();
                    if (title && title.length > 0) {
                        return title;
                    }
                }
            }
            
            return 'Untitled Link';
            
        } catch (error) {
            console.warn(`🔗 Linktree: Error extracting link title: ${error}`);
            return 'Untitled Link';
        }
    }

    // Create a placeholder event from a ticket link
    createEventFromLink(ticketLink, sourceUrl, parserConfig) {
        try {
            const { url, title } = ticketLink;
            
            // Create a basic event object that will be enriched by other parsers
            const event = {
                title: title,
                description: `Event from Linktree: ${title}`, // Will be overridden by other parsers
                startDate: null, // Will be filled by other parsers
                endDate: null, // Will be filled by other parsers
                bar: null, // Will be filled by other parsers
                location: null, // Will be filled by other parsers
                address: null, // Will be filled by other parsers
                city: null, // Will be filled by other parsers
                timezone: null, // Will be filled by other parsers
                url: sourceUrl, // The linktree URL goes in url field
                ticketUrl: url, // The ticket/event URL goes in ticketUrl field
                cover: '', // Will be filled by other parsers
                image: '', // Will be filled by other parsers
                source: this.config.source,
                isBearEvent: false, // Will be determined by other parsers
                // Add metadata to indicate this needs further processing
                _needsFurtherProcessing: true,
                _originalLinkTitle: title
            };
            
            console.log(`🔗 Linktree: Created event "${title}" with url: ${event.url}, ticketUrl: ${event.ticketUrl}`);
            
            return event;
            
        } catch (error) {
            console.warn(`🔗 Linktree: Failed to create event from link: ${error}`);
            return null;
        }
    }

    // Extract additional URLs for detail page processing
    extractAdditionalUrls(html, sourceUrl, parserConfig) {
        const urls = new Set();
        
        try {
            console.log(`🔗 Linktree: Extracting additional URLs`);
            
            // Extract all ticket links as additional URLs for processing
            const ticketLinks = this.extractTicketLinks(html, sourceUrl);
            ticketLinks.forEach(link => urls.add(link.url));
            
            // Also look for other potential event-related links
            const linkPattern = /<a[^>]*data-testid="LinkClickTriggerLink"[^>]*href="([^"]+)"[^>]*>/gi;
            let match;
            
            while ((match = linkPattern.exec(html)) !== null) {
                const url = this.normalizeUrl(match[1], sourceUrl);
                if (url && this.isValidAdditionalUrl(url)) {
                    urls.add(url);
                }
            }
            
            console.log(`🔗 Linktree: Extracted ${urls.size} additional URLs`);
            
        } catch (error) {
            console.warn(`🔗 Linktree: Error extracting additional URLs: ${error}`);
        }
        
        return Array.from(urls).slice(0, this.config.maxAdditionalUrls);
    }

    // Validate if URL is a valid additional URL
    isValidAdditionalUrl(url) {
        if (!url || typeof url !== 'string') return false;
        
        try {
            // Use simple URL parsing that works in Scriptable
            const urlPattern = /^(https?:)\/\/([^\/]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/;
            const match = url.match(urlPattern);
            
            if (!match) return false;
            
            const hostname = match[2].split(':')[0]; // Remove port if present
            
            // Skip social media and non-event links
            const skipDomains = [
                'instagram.com', 'facebook.com', 'twitter.com', 'tiktok.com',
                'youtube.com', 'bsky.app', 'pixieset.com', 'linktr.ee',
                'snapchat.com', 'linkedin.com', 'pinterest.com'
            ];
            
            if (skipDomains.some(domain => hostname.includes(domain))) return false;
            
            // Skip anchor links and javascript
            if (url.startsWith('#') || url.startsWith('javascript:')) return false;
            
            return true;
            
        } catch (error) {
            return false;
        }
    }



    // Normalize URLs
    normalizeUrl(url, baseUrl) {
        if (!url) return null;
        
        // Remove HTML entities
        url = url.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        
        // Handle relative URLs
        if (url.startsWith('/')) {
            // Simple URL parsing for Scriptable compatibility
            const urlPattern = /^(https?:)\/\/([^\/]+)/;
            const match = baseUrl.match(urlPattern);
            if (match) {
                const [, protocol, host] = match;
                return `${protocol}//${host}${url}`;
            }
        }
        
        // Handle protocol-relative URLs
        if (url.startsWith('//')) {
            // Simple URL parsing for Scriptable compatibility
            const urlPattern = /^(https?:)/;
            const match = baseUrl.match(urlPattern);
            if (match) {
                const [, protocol] = match;
                return `${protocol}${url}`;
            }
        }
        
        return url;
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LinktreeParser };
} else if (typeof window !== 'undefined') {
    window.LinktreeParser = LinktreeParser;
} else {
    // Scriptable environment
    this.LinktreeParser = LinktreeParser;
}
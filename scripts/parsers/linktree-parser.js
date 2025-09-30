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
        
        this.bearKeywords = [
            'bear', 'bears', 'woof', 'grr', 'furry', 'hairy',
            'daddy', 'cub', 'otter', 'leather', 'muscle bear', 'bearracuda',
            'furball', 'leather bears', 'bear night', 'bear party', 'queer',
            'dance party', 'cubhouse', 'philly', 'philadelphia'
        ];
        
        // Keywords that indicate ticket/event links
        this.ticketKeywords = [
            'tickets', 'ticket', 'buy tickets', 'get tickets', 'purchase',
            'eventbrite', 'event', 'party', 'show', 'concert', 'festival'
        ];
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

    // Check if a link is a ticket/event link based on its content and URL
    isTicketLink(linkHtml, url) {
        try {
            // Extract the text content from the link
            const linkText = this.extractLinkTitle(linkHtml).toLowerCase();
            
            // Check if the link text contains ticket keywords
            const hasTicketKeyword = this.ticketKeywords.some(keyword => 
                linkText.includes(keyword.toLowerCase())
            );
            
            // Check if the URL is from a known event platform
            const isEventPlatform = this.isEventPlatformUrl(url);
            
            // Check if the link text suggests it's an event (not just social media)
            const isEventRelated = this.isEventRelatedText(linkText);
            
            // A link is considered a ticket link if:
            // 1. It has ticket keywords in the text, OR
            // 2. It's from an event platform, OR  
            // 3. It has event-related text and isn't obviously social media
            return hasTicketKeyword || isEventPlatform || isEventRelated;
            
        } catch (error) {
            console.warn(`🔗 Linktree: Error checking if link is ticket link: ${error}`);
            return false;
        }
    }

    // Check if URL is from a known event platform
    isEventPlatformUrl(url) {
        if (!url) return false;
        
        const eventPlatforms = [
            'eventbrite.com',
            'ticketmaster.com',
            'stubhub.com',
            'seatgeek.com',
            'axs.com',
            'tickets.com',
            'ticketfly.com',
            'brownpapertickets.com',
            'universe.com',
            'eventful.com',
            'meetup.com'
        ];
        
        return eventPlatforms.some(platform => url.toLowerCase().includes(platform));
    }

    // Check if link text suggests it's event-related (not social media)
    isEventRelatedText(text) {
        const eventIndicators = [
            'event', 'party', 'show', 'concert', 'festival', 'gala',
            'dance', 'night', 'celebration', 'gathering', 'meetup',
            'conference', 'workshop', 'seminar', 'exhibition'
        ];
        
        const socialMediaIndicators = [
            'instagram', 'facebook', 'twitter', 'tiktok', 'youtube',
            'snapchat', 'linkedin', 'pinterest', 'follow', 'like',
            'subscribe', 'share', 'photos', 'videos', 'stories'
        ];
        
        const hasEventIndicators = eventIndicators.some(indicator => 
            text.includes(indicator.toLowerCase())
        );
        
        const hasSocialMediaIndicators = socialMediaIndicators.some(indicator => 
            text.includes(indicator.toLowerCase())
        );
        
        return hasEventIndicators && !hasSocialMediaIndicators;
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
            
            // Try to extract basic info from the URL if possible
            const urlParts = url.split('/');
            const eventId = urlParts[urlParts.length - 1];
            
            // Determine if this is likely a bear event based on the source URL and title
            const isBearEvent = this.isBearEvent({
                title: title,
                description: '',
                venue: '',
                url: url
            }) || this.isBearEventFromUrl(sourceUrl);
            
            // Try to extract city from the source URL or title
            const city = this.extractCityFromUrl(sourceUrl) || this.extractCityFromTitle(title);
            
            // Create a basic event object that will be enriched by other parsers
            const event = {
                title: title,
                description: `Event from Linktree: ${title}`, // Will be overridden by other parsers
                startDate: null, // Will be filled by other parsers
                endDate: null, // Will be filled by other parsers
                bar: null, // Will be filled by other parsers
                location: null, // Will be filled by other parsers
                address: null, // Will be filled by other parsers
                city: city,
                timezone: city ? this.getTimezoneForCity(city) : null,
                url: url, // The ticket/event URL
                ticketUrl: url, // Same as URL for most cases
                cover: '', // Will be filled by other parsers
                image: '', // Will be filled by other parsers
                source: this.config.source,
                isBearEvent: isBearEvent,
                // Add metadata to indicate this needs further processing
                _needsFurtherProcessing: true,
                _originalLinkTitle: title
            };
            
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

    // Extract city from URL (e.g., linktr.ee/cubhouse -> philadelphia)
    extractCityFromUrl(url) {
        if (!url) return null;
        
        const cityMappings = {
            'cubhouse': 'philadelphia',
            'nyc': 'nyc',
            'la': 'la',
            'sf': 'sf',
            'chicago': 'chicago',
            'miami': 'miami',
            'atlanta': 'atlanta',
            'denver': 'denver',
            'vegas': 'vegas',
            'seattle': 'seattle',
            'portland': 'portland',
            'austin': 'austin',
            'dallas': 'dallas',
            'houston': 'houston',
            'phoenix': 'phoenix',
            'boston': 'boston',
            'philadelphia': 'philadelphia'
        };
        
        for (const [key, city] of Object.entries(cityMappings)) {
            if (url.toLowerCase().includes(key)) {
                return city;
            }
        }
        
        return null;
    }

    // Extract city from title text
    extractCityFromTitle(title) {
        if (!title) return null;
        
        const cityPatterns = {
            'philly': 'philadelphia',
            'philadelphia': 'philadelphia',
            'new york': 'nyc',
            'nyc': 'nyc',
            'los angeles': 'la',
            'la': 'la',
            'san francisco': 'sf',
            'sf': 'sf',
            'chicago': 'chicago',
            'miami': 'miami',
            'atlanta': 'atlanta',
            'denver': 'denver',
            'vegas': 'vegas',
            'seattle': 'seattle',
            'portland': 'portland',
            'austin': 'austin',
            'dallas': 'dallas',
            'houston': 'houston',
            'phoenix': 'phoenix',
            'boston': 'boston'
        };
        
        const lowerTitle = title.toLowerCase();
        for (const [pattern, city] of Object.entries(cityPatterns)) {
            if (lowerTitle.includes(pattern)) {
                return city;
            }
        }
        
        return null;
    }

    // Get timezone for a city
    getTimezoneForCity(city) {
        const timezoneMappings = {
            'philadelphia': 'America/New_York',
            'nyc': 'America/New_York',
            'la': 'America/Los_Angeles',
            'sf': 'America/Los_Angeles',
            'chicago': 'America/Chicago',
            'miami': 'America/New_York',
            'atlanta': 'America/New_York',
            'denver': 'America/Denver',
            'vegas': 'America/Los_Angeles',
            'seattle': 'America/Los_Angeles',
            'portland': 'America/Los_Angeles',
            'austin': 'America/Chicago',
            'dallas': 'America/Chicago',
            'houston': 'America/Chicago',
            'phoenix': 'America/Phoenix',
            'boston': 'America/New_York'
        };
        
        return timezoneMappings[city] || null;
    }

    // Check if an event is a bear event based on keywords
    isBearEvent(event) {
        const title = event.title || '';
        const description = event.description || '';
        const venue = event.venue || '';
        const url = event.url || '';

        // Check if the title, description, venue, or URL contains bear keywords
        if (this.bearKeywords.some(keyword => 
            title.toLowerCase().includes(keyword) || 
            description.toLowerCase().includes(keyword) || 
            venue.toLowerCase().includes(keyword) || 
            url.toLowerCase().includes(keyword)
        )) {
            return true;
        }

        return false;
    }

    // Check if the source URL suggests this is a bear event
    isBearEventFromUrl(url) {
        if (!url) return false;
        
        const bearUrlPatterns = [
            'cubhouse', 'bear', 'woof', 'furry', 'leather'
        ];
        
        return bearUrlPatterns.some(pattern => 
            url.toLowerCase().includes(pattern)
        );
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
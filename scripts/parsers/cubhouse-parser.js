// ============================================================================
// CUBHOUSE PARSER - PURE PARSING LOGIC
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE parsing logic only
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Pure JavaScript parsing functions (HTML/JSON processing)
// ✅ Venue-specific extraction logic for linktr.ee/cubhouse
// ✅ Eventbrite link extraction and processing
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

class CubhouseParser {
    constructor(config = {}) {
        this.config = {
            source: 'cubhouse',
            maxAdditionalUrls: 10,
            ...config
        };
        
        this.bearKeywords = [
            'cubhouse', 'bear', 'bears', 'woof', 'grr', 'furry', 'hairy',
            'daddy', 'cub', 'otter', 'leather', 'muscle bear', 'bearracuda',
            'furball', 'leather bears', 'bear night', 'bear party', 'queer',
            'dance party', 'philly', 'philadelphia'
        ];
    }

    // Main parsing method - receives HTML data and returns events + additional links
    parseEvents(htmlData, parserConfig = {}, cityConfig = null) {
        try {
            const events = [];
            const html = htmlData.html;
            
            if (!html) {
                console.warn('🐻 Cubhouse: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }
            
            // Extract Eventbrite links from the Linktree page
            const eventbriteLinks = this.extractEventbriteLinks(html, htmlData.url);
            console.log(`🐻 Cubhouse: Found ${eventbriteLinks.length} Eventbrite links`);
            
            // For each Eventbrite link, create a placeholder event that will be processed by Eventbrite parser
            for (const eventbriteUrl of eventbriteLinks) {
                const event = this.createEventFromLink(eventbriteUrl, htmlData.url);
                if (event) {
                    events.push(event);
                    console.log(`🐻 Cubhouse: Created event placeholder for: ${event.title}`);
                }
            }
            
            // Extract additional URLs if urlDiscoveryDepth > 0 (depth checking is handled by shared-core)
            let additionalLinks = [];
            if (parserConfig.urlDiscoveryDepth > 0) {
                additionalLinks = this.extractAdditionalUrls(html, htmlData.url, parserConfig);
            }
            
            console.log(`🐻 Cubhouse: Found ${events.length} events, ${additionalLinks.length} additional links`);
            
            return {
                events: events,
                additionalLinks: additionalLinks,
                source: this.config.source,
                url: htmlData.url
            };
            
        } catch (error) {
            console.error(`🐻 Cubhouse: Error parsing events: ${error}`);
            return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
        }
    }

    // Extract Eventbrite links from the Linktree page
    extractEventbriteLinks(html, sourceUrl) {
        const eventbriteLinks = [];
        
        try {
            console.log(`🐻 Cubhouse: Extracting Eventbrite links from Linktree page`);
            
            // Look for links with data-testid="LinkClickTriggerLink" that contain eventbrite.com
            const linkPattern = /<a[^>]*data-testid="LinkClickTriggerLink"[^>]*href="([^"]*eventbrite\.com[^"]*)"[^>]*>/gi;
            let match;
            
            while ((match = linkPattern.exec(html)) !== null) {
                const url = this.normalizeUrl(match[1], sourceUrl);
                if (url && this.isValidEventbriteUrl(url)) {
                    eventbriteLinks.push(url);
                    console.log(`🐻 Cubhouse: Found Eventbrite link: ${url}`);
                }
            }
            
            // Also check for any href containing eventbrite.com as a fallback
            if (eventbriteLinks.length === 0) {
                const fallbackPattern = /href="([^"]*eventbrite\.com[^"]*)"/gi;
                let fallbackMatch;
                
                while ((fallbackMatch = fallbackPattern.exec(html)) !== null) {
                    const url = this.normalizeUrl(fallbackMatch[1], sourceUrl);
                    if (url && this.isValidEventbriteUrl(url)) {
                        eventbriteLinks.push(url);
                        console.log(`🐻 Cubhouse: Found Eventbrite link (fallback): ${url}`);
                    }
                }
            }
            
        } catch (error) {
            console.warn(`🐻 Cubhouse: Error extracting Eventbrite links: ${error}`);
        }
        
        return eventbriteLinks;
    }

    // Create a placeholder event from an Eventbrite link
    createEventFromLink(eventbriteUrl, sourceUrl) {
        try {
            // Extract basic info from the URL if possible
            const urlParts = eventbriteUrl.split('/');
            const eventId = urlParts[urlParts.length - 1];
            
            // Create a basic event object that will be enriched by the Eventbrite parser
            const event = {
                title: 'Cubhouse Event', // Will be overridden by Eventbrite parser
                description: 'Bear dance party event from Cubhouse', // Will be overridden by Eventbrite parser
                startDate: null, // Will be filled by Eventbrite parser
                endDate: null, // Will be filled by Eventbrite parser
                bar: null, // Will be filled by Eventbrite parser
                location: null, // Will be filled by Eventbrite parser
                address: null, // Will be filled by Eventbrite parser
                city: 'philadelphia', // Cubhouse is based in Philadelphia
                timezone: 'America/New_York', // Philadelphia timezone
                url: eventbriteUrl, // The Eventbrite URL
                ticketUrl: eventbriteUrl, // Same as URL for Eventbrite events
                cover: '', // Will be filled by Eventbrite parser
                image: '', // Will be filled by Eventbrite parser
                source: this.config.source,
                isBearEvent: true, // Cubhouse events are always bear events
                // Add metadata to indicate this needs Eventbrite processing
                _needsEventbriteProcessing: true,
                _eventbriteUrl: eventbriteUrl
            };
            
            return event;
            
        } catch (error) {
            console.warn(`🐻 Cubhouse: Failed to create event from link: ${error}`);
            return null;
        }
    }

    // Extract additional URLs for detail page processing
    extractAdditionalUrls(html, sourceUrl, parserConfig) {
        const urls = new Set();
        
        try {
            console.log(`🐻 Cubhouse: Extracting additional URLs`);
            
            // Extract all Eventbrite links as additional URLs for processing
            const eventbriteLinks = this.extractEventbriteLinks(html, sourceUrl);
            eventbriteLinks.forEach(url => urls.add(url));
            
            // Also look for other potential event-related links
            const linkPattern = /<a[^>]*data-testid="LinkClickTriggerLink"[^>]*href="([^"]+)"[^>]*>/gi;
            let match;
            
            while ((match = linkPattern.exec(html)) !== null) {
                const url = this.normalizeUrl(match[1], sourceUrl);
                if (url && this.isValidAdditionalUrl(url)) {
                    urls.add(url);
                }
            }
            
            console.log(`🐻 Cubhouse: Extracted ${urls.size} additional URLs`);
            
        } catch (error) {
            console.warn(`🐻 Cubhouse: Error extracting additional URLs: ${error}`);
        }
        
        return Array.from(urls).slice(0, this.config.maxAdditionalUrls);
    }

    // Validate if URL is a valid Eventbrite URL
    isValidEventbriteUrl(url) {
        if (!url || typeof url !== 'string') return false;
        
        try {
            // Use simple URL parsing that works in Scriptable
            const urlPattern = /^(https?:)\/\/([^\/]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/;
            const match = url.match(urlPattern);
            
            if (!match) return false;
            
            const hostname = match[2].split(':')[0]; // Remove port if present
            
            // Must be Eventbrite domain
            if (!hostname.includes('eventbrite.com')) return false;
            
            // Must be event page
            if (!match[3] || !match[3].includes('/e/')) return false;
            
            return true;
            
        } catch (error) {
            return false;
        }
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
                'youtube.com', 'bsky.app', 'pixieset.com', 'linktr.ee'
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
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CubhouseParser };
} else if (typeof window !== 'undefined') {
    window.CubhouseParser = CubhouseParser;
} else {
    // Scriptable environment
    this.CubhouseParser = CubhouseParser;
}
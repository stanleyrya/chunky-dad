// Event Parser - Bearraccuda
// Specialized parser for Bearraccuda event website structure

// Prevent duplicate class declaration in browser environment only
if (typeof window !== 'undefined' && typeof BearraccudaEventParser !== 'undefined') {
    console.warn('BearraccudaEventParser already defined, skipping redefinition');
} else {

class BearraccudaEventParser {
    constructor(config = {}) {
        this.config = {
            source: 'Bearraccuda',
            baseUrl: 'https://bearracuda.com',
            ...config
        };
        
        this.bearKeywords = [
            'bearraccuda', 'bearracuda', 'bear', 'bears', 'woof', 'grr', 
            'dance party', 'go-go', 'dj', 'furry', 'hairy', 'muscle'
        ];
    }

    // Parse HTML content from Bearraccuda
    parseEvents(htmlData) {
        try {
            console.log(`🐻 Bearraccuda: Parsing events from ${htmlData.url}`);
            
            const events = [];
            const html = htmlData.html;
            
            if (!html) {
                console.warn('🐻 Bearraccuda: No HTML content to parse');
                return events;
            }
            
            // Create a temporary DOM element to parse HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // Bearraccuda-specific selectors (adjust based on actual site structure)
            const eventElements = doc.querySelectorAll('.event, .party, .show, .event-listing, [class*="event"], [class*="party"]');
            
            eventElements.forEach((element, index) => {
                try {
                    const event = this.parseEventElement(element, htmlData.url);
                    if (event && this.isBearEvent(event)) {
                        events.push(event);
                    }
                } catch (error) {
                    console.warn(`🐻 Bearraccuda: Failed to parse event ${index}:`, error);
                }
            });
            
            // Look for additional links
            const additionalLinks = this.extractAdditionalLinks(doc, htmlData.url);
            
            console.log(`🐻 Bearraccuda: Found ${events.length} bear events, ${additionalLinks.length} additional links`);
            
            return {
                events,
                additionalLinks,
                source: this.config.source,
                url: htmlData.url
            };
            
        } catch (error) {
            console.error('🐻 Bearraccuda: Error parsing events:', error);
            return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
        }
    }

    parseEventElement(element, sourceUrl) {
        const event = {
            source: this.config.source,
            url: sourceUrl,
            timestamp: new Date().toISOString()
        };

        // Extract title - Bearraccuda often has distinctive naming
        const titleElement = element.querySelector('h1, h2, h3, h4, .title, .event-title, .party-title, [class*="title"]');
        event.title = titleElement ? titleElement.textContent.trim() : 'Bearraccuda Event';

        // Extract date/time
        const dateElement = element.querySelector('.date, .event-date, .party-date, .datetime, [class*="date"], time');
        if (dateElement) {
            event.dateString = dateElement.textContent.trim();
            event.date = this.parseDate(event.dateString);
        }

        // Extract venue/location - Bearraccuda parties are often at specific venues
        const venueElement = element.querySelector('.venue, .location, .club, .event-venue, [class*="venue"], [class*="location"]');
        event.venue = venueElement ? venueElement.textContent.trim() : '';

        // Extract description/details
        const descElement = element.querySelector('.description, .details, .event-description, .party-details, p');
        event.description = descElement ? descElement.textContent.trim() : '';

        // Extract DJ/performer info if available
        const performerElement = element.querySelector('.dj, .performer, .artist, [class*="dj"], [class*="performer"]');
        if (performerElement) {
            const performer = performerElement.textContent.trim();
            event.description = event.description ? `${event.description} | DJ: ${performer}` : `DJ: ${performer}`;
        }

        // Extract event URL
        const linkElement = element.querySelector('a[href]');
        if (linkElement) {
            const href = linkElement.getAttribute('href');
            if (href && href.startsWith('http')) {
                event.eventUrl = href;
            } else if (href) {
                event.eventUrl = new URL(href, this.config.baseUrl).href;
            }
        }

        // Extract city
        event.city = this.extractCity(event.venue + ' ' + event.description);

        // Bearraccuda events are inherently bear events
        event.isBearEvent = true;

        // Apply source-specific metadata if configured
        if (this.config.metadata) {
            this.applyMetadata(event, this.config.metadata);
        }

        return event;
    }

    parseDate(dateString) {
        if (!dateString) return null;
        
        try {
            // Clean up the date string
            const cleanDateString = dateString.replace(/[^\w\s:,-]/g, ' ').trim();
            
            // Bearraccuda often uses specific date formats
            const patterns = [
                /(\w+)\s+(\d{1,2}),?\s+(\d{4})/i, // "Saturday January 15, 2024"
                /(\d{1,2})\/(\d{1,2})\/(\d{4})/,   // "01/15/2024"
                /(\d{4})-(\d{1,2})-(\d{1,2})/,    // "2024-01-15"
                /(\w+)\s+(\d{1,2})/i,             // "January 15" (current year assumed)
            ];
            
            for (const pattern of patterns) {
                const match = cleanDateString.match(pattern);
                if (match) {
                    const parsed = new Date(cleanDateString);
                    if (!isNaN(parsed.getTime())) {
                        return parsed.toISOString();
                    }
                }
            }
            
            // Try direct parsing
            const parsed = new Date(cleanDateString);
            return !isNaN(parsed.getTime()) ? parsed.toISOString() : null;
            
        } catch (error) {
            console.warn(`🐻 Bearraccuda: Failed to parse date "${dateString}":`, error);
            return null;
        }
    }

    extractCity(text) {
        // Bearraccuda operates in specific cities
        const cityPatterns = {
            'sf': /san francisco|sf|castro|soma|mission/i,
            'la': /los angeles|la|west hollywood|weho|silver lake/i,
            'nyc': /new york|nyc|manhattan|brooklyn|hell\'s kitchen/i,
            'chicago': /chicago|boystown|andersonville/i,
            'seattle': /seattle|capitol hill/i,
            'dc': /washington|dc|dupont/i,
            'boston': /boston|south end/i,
            'atlanta': /atlanta|midtown/i,
            'miami': /miami|south beach|wilton manors/i,
            'dallas': /dallas|oak lawn/i,
            'denver': /denver/i,
            'portland': /portland/i,
            'philadelphia': /philadelphia|philly|gayborhood/i,
            'phoenix': /phoenix|scottsdale/i,
            'austin': /austin/i,
            'vegas': /las vegas|vegas/i
        };

        for (const [city, pattern] of Object.entries(cityPatterns)) {
            if (pattern.test(text)) {
                return city;
            }
        }
        
        // Default to SF since that's where Bearraccuda started
        return 'sf';
    }

    isBearEvent(event) {
        // Bearraccuda events are always bear events, but double-check
        const searchText = `${event.title} ${event.description} ${event.venue}`.toLowerCase();
        return this.bearKeywords.some(keyword => searchText.includes(keyword.toLowerCase())) || 
               event.source === 'Bearraccuda';
    }

    // Apply source-specific metadata to events
    applyMetadata(event, metadata) {
        console.log(`🐻 Bearraccuda: Applying metadata to event: ${event.title}`);
        
        // Override title if configured
        if (metadata.overrideTitle && metadata.title) {
            console.log(`🐻 Bearraccuda: Overriding title "${event.title}" with "${metadata.title}"`);
            event.originalTitle = event.title; // Preserve original title
            event.title = metadata.title;
        }
        
        // Add short title if provided
        if (metadata.shortTitle) {
            event.shortTitle = metadata.shortTitle;
        }
        
        // Add Instagram link if provided
        if (metadata.instagram) {
            event.instagram = metadata.instagram;
        }
        
        // Apply any other metadata fields
        Object.keys(metadata).forEach(key => {
            if (!['overrideTitle', 'title', 'shortTitle', 'instagram'].includes(key)) {
                event[key] = metadata[key];
            }
        });
        
        console.log(`🐻 Bearraccuda: Applied metadata to event: ${event.title}`);
    }

    extractAdditionalLinks(doc, baseUrl) {
        const links = [];
        
        // Look for ticket links, event detail pages, etc.
        const linkElements = doc.querySelectorAll(
            'a[href*="ticket"], a[href*="event"], a[href*="party"], a[href*="details"], a[href*="more"]'
        );
        
        linkElements.forEach(link => {
            const href = link.getAttribute('href');
            if (href) {
                try {
                    const fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).href;
                    if (!links.includes(fullUrl)) {
                        links.push(fullUrl);
                    }
                } catch (error) {
                    console.warn(`🐻 Bearraccuda: Invalid link found: ${href}`);
                }
            }
        });
        
        return links.slice(0, 8); // Limit to 8 additional links per page
    }
}

    // Export for both environments
    if (typeof window !== 'undefined') {
        window.BearraccudaEventParser = BearraccudaEventParser;
    } else if (typeof module !== 'undefined' && module.exports) {
        module.exports = { BearraccudaEventParser };
    } else {
        // Scriptable environment
        this.BearraccudaEventParser = BearraccudaEventParser;
    }

} // End of conditional class declaration
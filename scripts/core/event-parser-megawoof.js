// Event Parser - Megawoof
// Specialized parser for Megawoof event website structure

class MegawoofEventParser {
    constructor(config = {}) {
        this.config = {
            source: 'Megawoof',
            baseUrl: 'https://megawoof.com',
            ...config
        };
        
        this.bearKeywords = [
            'megawoof', 'bear', 'bears', 'woof', 'grr', 'furry', 'hairy',
            'daddy', 'cub', 'otter', 'leather', 'muscle bear'
        ];
    }

    // Parse HTML content from Megawoof
    parseEvents(htmlData) {
        try {
            console.log(`🐻 Megawoof: Parsing events from ${htmlData.url}`);
            
            const events = [];
            const html = htmlData.html;
            
            if (!html) {
                console.warn('🐻 Megawoof: No HTML content to parse');
                return events;
            }
            
            // Create a temporary DOM element to parse HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // Megawoof-specific selectors (adjust based on actual site structure)
            const eventElements = doc.querySelectorAll('.event-item, .event-card, .event-listing, [class*="event"]');
            
            eventElements.forEach((element, index) => {
                try {
                    const event = this.parseEventElement(element, htmlData.url);
                    if (event && this.isBearEvent(event)) {
                        events.push(event);
                    }
                } catch (error) {
                    console.warn(`🐻 Megawoof: Failed to parse event ${index}:`, error);
                }
            });
            
            // Also look for additional links that might contain more event details
            const additionalLinks = this.extractAdditionalLinks(doc, htmlData.url);
            
            console.log(`🐻 Megawoof: Found ${events.length} bear events, ${additionalLinks.length} additional links`);
            
            return {
                events,
                additionalLinks,
                source: this.config.source,
                url: htmlData.url
            };
            
        } catch (error) {
            console.error('🐻 Megawoof: Error parsing events:', error);
            return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
        }
    }

    parseEventElement(element, sourceUrl) {
        const event = {
            source: this.config.source,
            url: sourceUrl,
            timestamp: new Date().toISOString()
        };

        // Extract title
        const titleElement = element.querySelector('h1, h2, h3, h4, .title, .event-title, [class*="title"]');
        event.title = titleElement ? titleElement.textContent.trim() : 'Untitled Event';

        // Extract date/time
        const dateElement = element.querySelector('.date, .event-date, .datetime, [class*="date"], time');
        if (dateElement) {
            event.dateString = dateElement.textContent.trim();
            event.date = this.parseDate(event.dateString);
        }

        // Extract venue/location
        const venueElement = element.querySelector('.venue, .location, .event-venue, [class*="venue"], [class*="location"]');
        event.venue = venueElement ? venueElement.textContent.trim() : '';

        // Extract description
        const descElement = element.querySelector('.description, .event-description, .summary, p');
        event.description = descElement ? descElement.textContent.trim() : '';

        // Extract event URL if different from source
        const linkElement = element.querySelector('a[href]');
        if (linkElement) {
            const href = linkElement.getAttribute('href');
            if (href && href.startsWith('http')) {
                event.eventUrl = href;
            } else if (href) {
                event.eventUrl = new URL(href, this.config.baseUrl).href;
            }
        }

        // Extract city from venue or other indicators
        event.city = this.extractCity(event.venue + ' ' + event.description);

        // Check if this is a bear event
        event.isBearEvent = this.isBearEvent(event);

        return event;
    }

    parseDate(dateString) {
        if (!dateString) return null;
        
        try {
            // Try various date formats common on event sites
            const cleanDateString = dateString.replace(/[^\w\s:,-]/g, ' ').trim();
            
            // Common patterns
            const patterns = [
                /(\w+)\s+(\d{1,2}),?\s+(\d{4})/i, // "January 15, 2024"
                /(\d{1,2})\/(\d{1,2})\/(\d{4})/,   // "01/15/2024"
                /(\d{4})-(\d{1,2})-(\d{1,2})/,    // "2024-01-15"
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
            
            // Fallback to Date constructor
            const parsed = new Date(cleanDateString);
            return !isNaN(parsed.getTime()) ? parsed.toISOString() : null;
            
        } catch (error) {
            console.warn(`🐻 Megawoof: Failed to parse date "${dateString}":`, error);
            return null;
        }
    }

    extractCity(text) {
        const cityPatterns = {
            'nyc': /new york|nyc|manhattan|brooklyn|queens|bronx/i,
            'sf': /san francisco|sf|bay area/i,
            'la': /los angeles|la|hollywood|west hollywood/i,
            'chicago': /chicago/i,
            'seattle': /seattle/i,
            'dc': /washington|dc|district of columbia/i,
            'boston': /boston/i,
            'atlanta': /atlanta/i,
            'miami': /miami|south beach/i,
            'dallas': /dallas/i,
            'denver': /denver/i,
            'portland': /portland/i,
            'philadelphia': /philadelphia|philly/i,
            'phoenix': /phoenix/i,
            'austin': /austin/i,
            'vegas': /las vegas|vegas/i
        };

        for (const [city, pattern] of Object.entries(cityPatterns)) {
            if (pattern.test(text)) {
                return city;
            }
        }
        
        return 'unknown';
    }

    isBearEvent(event) {
        const searchText = `${event.title} ${event.description} ${event.venue}`.toLowerCase();
        return this.bearKeywords.some(keyword => searchText.includes(keyword.toLowerCase()));
    }

    extractAdditionalLinks(doc, baseUrl) {
        const links = [];
        const linkElements = doc.querySelectorAll('a[href*="event"], a[href*="details"], a[href*="more"]');
        
        linkElements.forEach(link => {
            const href = link.getAttribute('href');
            if (href) {
                try {
                    const fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).href;
                    if (!links.includes(fullUrl)) {
                        links.push(fullUrl);
                    }
                } catch (error) {
                    console.warn(`🐻 Megawoof: Invalid link found: ${href}`);
                }
            }
        });
        
        return links.slice(0, 10); // Limit to 10 additional links per page
    }
}

// Export for both environments
if (typeof window !== 'undefined') {
    window.MegawoofEventParser = MegawoofEventParser;
} else if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MegawoofEventParser };
} else {
    // Scriptable environment
    this.MegawoofEventParser = MegawoofEventParser;
}
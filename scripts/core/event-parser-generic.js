// Event Parser - Generic
// General-purpose parser for various bear event websites

// Prevent duplicate class declaration in browser environment only
if (typeof window !== 'undefined' && typeof GenericEventParser !== 'undefined') {
    console.warn('GenericEventParser already defined, skipping redefinition');
} else {

class GenericEventParser {
    constructor(config = {}) {
        this.config = {
            source: config.source || 'Generic',
            baseUrl: config.baseUrl || '',
            ...config
        };
        
        this.bearKeywords = [
            'bear', 'bears', 'cub', 'cubs', 'otter', 'otters',
            'daddy', 'daddies', 'woof', 'grr', 'furry', 'hairy',
            'beef', 'chunk', 'chub', 'muscle bear', 'leather bear',
            'polar bear', 'grizzly', 'bearracuda', 'furball', 'megawoof',
            'diaper happy hour', 'bears night out', 'rockstrap', 'underbear',
            'filth', 'jizznasium', 'club chub', 'young hearts', 'xl',
            'blufsf', 'adonis', 'beer bust', 'disco daddy'
        ];
    }

    // Parse HTML content from any generic source
    parseEvents(htmlData) {
        try {
            console.log(`🐻 Generic: Parsing events from ${htmlData.url}`);
            
            const events = [];
            const html = htmlData.html;
            
            if (!html) {
                console.warn('🐻 Generic: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }
            
            // Create a temporary DOM element to parse HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // Generic selectors that work for most event sites
            const eventElements = doc.querySelectorAll(`
                .event, .event-item, .event-card, .event-listing,
                .party, .show, .listing,
                [class*="event"], [class*="party"], [class*="show"],
                article, .post, .entry
            `.replace(/\s+/g, ' ').trim());
            
            eventElements.forEach((element, index) => {
                try {
                    const event = this.parseEventElement(element, htmlData.url);
                    if (event && this.isBearEvent(event)) {
                        events.push(event);
                    }
                } catch (error) {
                    console.warn(`🐻 Generic: Failed to parse event ${index}:`, error);
                }
            });
            
            // Look for additional links
            const additionalLinks = this.extractAdditionalLinks(doc, htmlData.url);
            
            console.log(`🐻 Generic: Found ${events.length} bear events, ${additionalLinks.length} additional links`);
            
            return {
                events,
                additionalLinks,
                source: this.config.source,
                url: htmlData.url
            };
            
        } catch (error) {
            console.error('🐻 Generic: Error parsing events:', error);
            return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
        }
    }

    parseEventElement(element, sourceUrl) {
        const event = {
            source: this.config.source,
            url: sourceUrl,
            timestamp: new Date().toISOString()
        };

        // Extract title using multiple possible selectors
        const titleSelectors = [
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            '.title', '.event-title', '.party-title', '.show-title',
            '[class*="title"]', '.name', '.event-name',
            'strong', 'b'
        ];
        
        const titleElement = this.findFirstElement(element, titleSelectors);
        event.title = titleElement ? titleElement.textContent.trim() : 'Untitled Event';

        // Extract date/time
        const dateSelectors = [
            '.date', '.event-date', '.party-date', '.show-date',
            '.datetime', '.when', '.time',
            '[class*="date"]', '[class*="time"]',
            'time', '[datetime]'
        ];
        
        const dateElement = this.findFirstElement(element, dateSelectors);
        if (dateElement) {
            event.dateString = dateElement.textContent.trim();
            event.date = this.parseDate(event.dateString);
            
            // Also check for datetime attribute
            const datetimeAttr = dateElement.getAttribute('datetime');
            if (datetimeAttr && !event.date) {
                event.date = this.parseDate(datetimeAttr);
            }
        }

        // Extract venue/location
        const venueSelectors = [
            '.venue', '.location', '.where', '.place',
            '.event-venue', '.party-venue', '.club',
            '[class*="venue"]', '[class*="location"]',
            '.address'
        ];
        
        const venueElement = this.findFirstElement(element, venueSelectors);
        event.venue = venueElement ? venueElement.textContent.trim() : '';

        // Extract description
        const descSelectors = [
            '.description', '.event-description', '.summary',
            '.details', '.content', '.body',
            'p', '.text'
        ];
        
        const descElement = this.findFirstElement(element, descSelectors);
        event.description = descElement ? descElement.textContent.trim() : '';

        // Extract event URL
        const linkElement = element.querySelector('a[href]');
        if (linkElement) {
            const href = linkElement.getAttribute('href');
            if (href && href.startsWith('http')) {
                event.eventUrl = href;
            } else if (href && this.config.baseUrl) {
                try {
                    event.eventUrl = new URL(href, this.config.baseUrl).href;
                } catch (e) {
                    console.warn(`🐻 Generic: Invalid URL: ${href}`);
                }
            }
        }

        // Extract city
        event.city = this.extractCity(event.venue + ' ' + event.description + ' ' + event.title);

        // Check if this is a bear event
        event.isBearEvent = this.isBearEvent(event);

        return event;
    }

    findFirstElement(parent, selectors) {
        for (const selector of selectors) {
            const element = parent.querySelector(selector);
            if (element && element.textContent.trim()) {
                return element;
            }
        }
        return null;
    }

    parseDate(dateString) {
        if (!dateString) return null;
        
        try {
            // Clean up the date string
            const cleanDateString = dateString.replace(/[^\w\s:,-]/g, ' ').trim();
            
            // Try various date formats
            const patterns = [
                /(\w+),?\s+(\w+)\s+(\d{1,2}),?\s+(\d{4})/i, // "Friday, January 15, 2024"
                /(\w+)\s+(\d{1,2}),?\s+(\d{4})/i,           // "January 15, 2024"
                /(\d{1,2})\/(\d{1,2})\/(\d{4})/,             // "01/15/2024"
                /(\d{4})-(\d{1,2})-(\d{1,2})/,              // "2024-01-15"
                /(\d{1,2})-(\d{1,2})-(\d{4})/,              // "15-01-2024"
                /(\w+)\s+(\d{1,2})/i,                       // "January 15" (current year)
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
            console.warn(`🐻 Generic: Failed to parse date "${dateString}":`, error);
            return null;
        }
    }

    extractCity(text) {
        const cityPatterns = {
            'nyc': /new york|nyc|manhattan|brooklyn|queens|bronx|ny\b/i,
            'sf': /san francisco|sf|bay area|castro|soma|mission/i,
            'la': /los angeles|la|hollywood|west hollywood|weho|beverly hills|ca\b/i,
            'chicago': /chicago|chi|il\b/i,
            'seattle': /seattle|sea|wa\b/i,
            'dc': /washington|dc|district of columbia/i,
            'boston': /boston|ma\b/i,
            'atlanta': /atlanta|atl|ga\b/i,
            'miami': /miami|south beach|fl\b/i,
            'dallas': /dallas|tx\b/i,
            'denver': /denver|co\b/i,
            'portland': /portland|pdx|or\b/i,
            'philadelphia': /philadelphia|philly|pa\b/i,
            'phoenix': /phoenix|az\b/i,
            'austin': /austin|tx\b/i,
            'vegas': /las vegas|vegas|nv\b/i,
            'nola': /new orleans|nola|la\b/i
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
        
        // Look for various types of links that might contain more event info
        const linkElements = doc.querySelectorAll(`
            a[href*="event"], a[href*="party"], a[href*="show"],
            a[href*="details"], a[href*="more"], a[href*="info"],
            a[href*="ticket"], a[href*="rsvp"]
        `.replace(/\s+/g, ' ').trim());
        
        linkElements.forEach(link => {
            const href = link.getAttribute('href');
            if (href) {
                try {
                    let fullUrl;
                    if (href.startsWith('http')) {
                        fullUrl = href;
                    } else if (baseUrl) {
                        fullUrl = new URL(href, baseUrl).href;
                    } else {
                        return; // Skip relative URLs without base
                    }
                    
                    if (!links.includes(fullUrl)) {
                        links.push(fullUrl);
                    }
                } catch (error) {
                    console.warn(`🐻 Generic: Invalid link found: ${href}`);
                }
            }
        });
        
        return links.slice(0, 12); // Limit to 12 additional links per page
    }
}

    // Export for both environments
    if (typeof window !== 'undefined') {
        window.GenericEventParser = GenericEventParser;
    } else if (typeof module !== 'undefined' && module.exports) {
        module.exports = { GenericEventParser };
    } else {
        // Scriptable environment
        this.GenericEventParser = GenericEventParser;
    }

} // End of conditional class declaration
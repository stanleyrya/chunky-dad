// Event Parser - Eventbrite
// Specialized parser for Eventbrite event website structure
// Works with all Eventbrite events, not just Megawoof

class EventbriteEventParser {
    constructor(config = {}) {
        this.config = {
            source: 'Eventbrite',
            baseUrl: 'https://www.eventbrite.com',
            ...config
        };
        
        this.bearKeywords = [
            'megawoof', 'bear', 'bears', 'woof', 'grr', 'furry', 'hairy',
            'daddy', 'cub', 'otter', 'leather', 'muscle bear', 'bearracuda',
            'furball', 'leather bears', 'bear night', 'bear party'
        ];
    }

    // Parse HTML content from Eventbrite
    parseEvents(htmlData) {
        try {
            console.log(`🐻 Eventbrite: Parsing events from ${htmlData.url}`);
            
            const events = [];
            const html = htmlData.html;
            
            if (!html) {
                console.warn('🐻 Eventbrite: No HTML content to parse');
                return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
            }
            
            // Create a temporary DOM element to parse HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // Eventbrite-specific selectors - updated for the provided HTML structure
            const eventElements = doc.querySelectorAll('.event-card, .Container_root__4i85v, [data-testid="event-card-tracking-layer"], .event-card-link, [class*="event"]');
            
            console.log(`🐻 Eventbrite: Found ${eventElements.length} potential event elements`);
            
            eventElements.forEach((element, index) => {
                try {
                    const event = this.parseEventElement(element, htmlData.url);
                    if (event && event.title && event.title !== 'Untitled Event') {
                        // For eventbrite, we consider all events as potentially bear events
                        // but still run the bear check for proper classification
                        event.isBearEvent = this.isBearEvent(event);
                        events.push(event);
                    }
                } catch (error) {
                    console.warn(`🐻 Eventbrite: Failed to parse event ${index}:`, error);
                }
            });
            
            // Also look for additional event links
            const additionalLinks = this.extractAdditionalLinks(doc, htmlData.url);
            
            console.log(`🐻 Eventbrite: Found ${events.length} events, ${additionalLinks.length} additional links`);
            
            return {
                events,
                additionalLinks,
                source: this.config.source,
                url: htmlData.url
            };
            
        } catch (error) {
            console.error('🐻 Eventbrite: Error parsing events:', error);
            return { events: [], additionalLinks: [], source: this.config.source, url: htmlData.url };
        }
    }

    parseEventElement(element, sourceUrl) {
        const event = {
            source: this.config.source,
            url: sourceUrl,
            timestamp: new Date().toISOString()
        };

        // Extract title - Eventbrite specific selectors
        const titleElement = element.querySelector('h3, .Typography_body-lg__487rx, .event-card__clamp-line--two, [aria-label*="View"], [class*="title"]');
        if (titleElement) {
            event.title = titleElement.textContent.trim();
        } else {
            // Try to get title from aria-label if available
            const linkElement = element.querySelector('a[aria-label]');
            if (linkElement) {
                const ariaLabel = linkElement.getAttribute('aria-label');
                if (ariaLabel && ariaLabel.startsWith('View ')) {
                    event.title = ariaLabel.replace('View ', '').trim();
                }
            }
        }

        // Extract date/time - Eventbrite specific
        const dateElement = element.querySelector('.Typography_body-md__487rx, [class*="date"], time, p');
        if (dateElement) {
            const dateText = dateElement.textContent.trim();
            // Look for date patterns like "Sat, Aug 23 • 9:00 PM"
            if (dateText.match(/\w+,\s+\w+\s+\d+|\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/)) {
                event.dateString = dateText;
                event.date = this.parseDate(dateText);
            }
        }

        // Extract venue/location - Eventbrite specific
        const venueElements = element.querySelectorAll('.Typography_body-md__487rx');
        if (venueElements.length > 1) {
            // Usually the second Typography_body-md element is the venue
            event.venue = venueElements[1].textContent.trim();
        }

        // Extract price
        const priceElement = element.querySelector('.Typography_body-md-bold__487rx, [class*="price"]');
        if (priceElement) {
            event.price = priceElement.textContent.trim();
        }

        // Extract event URL - This is crucial for Eventbrite
        const linkElement = element.querySelector('a[href*="eventbrite.com/e/"]') || 
                          element.querySelector('a[data-event-id]') ||
                          element.closest('a[href*="eventbrite.com/e/"]');
        
        if (linkElement) {
            let href = linkElement.getAttribute('href');
            if (href) {
                // Clean up the URL - remove query parameters that aren't needed
                if (href.includes('?')) {
                    href = href.split('?')[0];
                }
                
                if (href.startsWith('http')) {
                    event.eventUrl = href;
                } else if (href.startsWith('/')) {
                    event.eventUrl = `https://www.eventbrite.com${href}`;
                } else {
                    event.eventUrl = `https://www.eventbrite.com/${href}`;
                }
            }
        }

        // Extract city from venue, URL, or other indicators
        event.city = this.extractCity(event.venue + ' ' + (event.description || '') + ' ' + sourceUrl);

        // Extract description from various possible elements
        const descElement = element.querySelector('.event-description, .summary, p:not([class*="Typography"])');
        event.description = descElement ? descElement.textContent.trim() : '';

        return event;
    }

    parseDate(dateString) {
        if (!dateString) return null;
        
        try {
            // Clean up the date string
            let cleanDateString = dateString.replace(/[^\w\s:,-]/g, ' ').trim();
            
            // Handle Eventbrite date formats like "Sat, Aug 23 • 9:00 PM"
            if (cleanDateString.includes('•')) {
                cleanDateString = cleanDateString.replace('•', '').trim();
            }
            
            // Try to parse various date formats
            const patterns = [
                /(\w{3}),?\s+(\w{3})\s+(\d{1,2})\s+(\d{1,2}:\d{2}\s*(AM|PM)?)/i, // "Sat, Aug 23 9:00 PM"
                /(\w+)\s+(\d{1,2}),?\s+(\d{4})/i, // "January 15, 2024"
                /(\d{1,2})\/(\d{1,2})\/(\d{4})/,   // "01/15/2024"
                /(\d{4})-(\d{1,2})-(\d{1,2})/,    // "2024-01-15"
            ];
            
            // For Eventbrite dates without year, assume current or next year
            if (cleanDateString.match(/\w{3},?\s+\w{3}\s+\d{1,2}/i) && !cleanDateString.match(/\d{4}/)) {
                const currentYear = new Date().getFullYear();
                cleanDateString += ` ${currentYear}`;
            }
            
            const parsed = new Date(cleanDateString);
            if (!isNaN(parsed.getTime())) {
                return parsed.toISOString();
            }
            
            // If that fails, try with a more aggressive cleanup
            const fallbackString = dateString.replace(/[^\w\s:]/g, ' ').replace(/\s+/g, ' ').trim();
            const fallbackParsed = new Date(fallbackString);
            return !isNaN(fallbackParsed.getTime()) ? fallbackParsed.toISOString() : null;
            
        } catch (error) {
            console.warn(`🐻 Eventbrite: Failed to parse date "${dateString}":`, error);
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
        const searchText = `${event.title} ${event.description || ''} ${event.venue || ''}`.toLowerCase();
        return this.bearKeywords.some(keyword => searchText.includes(keyword.toLowerCase()));
    }

    extractAdditionalLinks(doc, baseUrl) {
        const links = [];
        
        // Look for eventbrite event links specifically
        const linkElements = doc.querySelectorAll('a[href*="eventbrite.com/e/"]');
        
        linkElements.forEach(link => {
            const href = link.getAttribute('href');
            if (href) {
                try {
                    let fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).href;
                    
                    // Clean up URL - remove query parameters except event ID
                    if (fullUrl.includes('?')) {
                        const [baseEventUrl] = fullUrl.split('?');
                        fullUrl = baseEventUrl;
                    }
                    
                    if (!links.includes(fullUrl)) {
                        links.push(fullUrl);
                    }
                } catch (error) {
                    console.warn(`🐻 Eventbrite: Invalid link found: ${href}`);
                }
            }
        });
        
        return links.slice(0, 20); // Limit to 20 additional links per page
    }
}

// Export for both environments
if (typeof window !== 'undefined') {
    window.EventbriteEventParser = EventbriteEventParser;
} else if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EventbriteEventParser };
} else {
    // Scriptable environment
    this.EventbriteEventParser = EventbriteEventParser;
}
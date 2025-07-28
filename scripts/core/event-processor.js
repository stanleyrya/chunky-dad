// Event Processor - Core processing logic that works the same in both environments
// Handles parsing, validation, and standardization of event data

class EventProcessor {
    constructor(config = {}) {
        this.config = {
            maxEvents: config.maxEvents || 100,
            daysToLookAhead: config.daysToLookAhead || 90,
            enableDebugMode: config.enableDebugMode || false,
            ...config
        };
        
        // Enhanced bear keywords based on real website analysis
        this.bearKeywords = [
            'bear', 'bears', 'cub', 'cubs', 'otter', 'otters',
            'daddy', 'daddies', 'woof', 'grr', 'furry', 'hairy',
            'beef', 'chunk', 'chub', 'muscle bear', 'leather bear',
            'polar bear', 'grizzly', 'bearracuda', 'furball', 'megawoof',
            'diaper happy hour', 'bears night out', 'rockstrap', 'underbear',
            'filth', 'jizznasium', 'club chub', 'young hearts', 'xl',
            'blufsf', 'adonis', 'beer bust', 'disco daddy'
        ];
        
        // City calendar mapping
        this.cityCalendarMap = {
            'nyc': 'chunky-dad-nyc',
            'new york': 'chunky-dad-nyc',
            'manhattan': 'chunky-dad-nyc',
            'brooklyn': 'chunky-dad-nyc',
            'la': 'chunky-dad-la',
            'los angeles': 'chunky-dad-la',
            'long beach': 'chunky-dad-la',
            'chicago': 'chunky-dad-chicago',
            'sf': 'chunky-dad-sf',
            'san francisco': 'chunky-dad-sf',
            'seattle': 'chunky-dad-seattle',
            'dc': 'chunky-dad-dc',
            'washington': 'chunky-dad-dc',
            'boston': 'chunky-dad-boston',
            'atlanta': 'chunky-dad-atlanta',
            'miami': 'chunky-dad-miami',
            'dallas': 'chunky-dad-dallas',
            'denver': 'chunky-dad-denver',
            'portland': 'chunky-dad-portland',
            'philadelphia': 'chunky-dad-philadelphia',
            'phoenix': 'chunky-dad-phoenix',
            'austin': 'chunky-dad-austin',
            'new orleans': 'chunky-dad-nola',
            'nola': 'chunky-dad-nola',
            'las vegas': 'chunky-dad-vegas',
            'vegas': 'chunky-dad-vegas'
        };
        
        // Venue location defaults
        this.venueDefaults = {
            'eagle bar': { 
                city: 'nyc', 
                address: '554 W 28th St, New York, NY',
                coordinates: { lat: 40.7505, lng: -73.9934 }
            },
            'rockbar': { 
                city: 'nyc', 
                address: '185 Christopher St, New York, NY',
                coordinates: { lat: 40.7338, lng: -74.0027 }
            },
            'sf eagle': { 
                city: 'sf', 
                address: '398 12th St, San Francisco, CA',
                coordinates: { lat: 37.7697, lng: -122.4131 }
            }
        };
    }

    // Main processing method - same logic for all environments
    async processEvents(rawData, parserConfig) {
        const events = [];
        
        try {
            // Parse HTML based on parser type
            const parsedEvents = await this.parseHTML(rawData.html, parserConfig);
            
            // Process each event
            for (const eventData of parsedEvents) {
                const processedEvent = await this.processEvent(eventData, parserConfig);
                if (processedEvent && this.isValidEvent(processedEvent)) {
                    events.push(processedEvent);
                }
                
                // Respect max events limit
                if (events.length >= this.config.maxEvents) {
                    break;
                }
            }
            
            return {
                success: true,
                events: events,
                source: parserConfig.name,
                timestamp: new Date().toISOString(),
                rawDataUrl: rawData.url
            };
            
        } catch (error) {
            return {
                success: false,
                error: error.message,
                source: parserConfig.name,
                timestamp: new Date().toISOString(),
                rawDataUrl: rawData.url
            };
        }
    }

    async parseHTML(html, parserConfig) {
        // Different parsing strategies based on parser type
        switch (parserConfig.parser) {
            case 'furball':
                return this.parseFurballHTML(html);
            case 'rockbar':
                return this.parseRockbarHTML(html);
            case 'sf-eagle':
                return this.parseSFEagleHTML(html);
            case 'bearracuda':
                return this.parseBearracudaHTML(html);
            default:
                return this.parseGenericHTML(html);
        }
    }

    parseFurballHTML(html) {
        // Furball-specific parsing logic
        const events = [];
        
        // Mock parsing for now - replace with actual DOM parsing logic
        const eventPattern = /<div[^>]*class="[^"]*event[^"]*"[^>]*>[\s\S]*?<\/div>/gi;
        const matches = html.match(eventPattern) || [];
        
        for (const match of matches) {
            const titleMatch = match.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i);
            const dateMatch = match.match(/<time[^>]*>([^<]+)<\/time>/i) || 
                            match.match(/(\d{4}-\d{2}-\d{2})/);
            
            if (titleMatch) {
                events.push({
                    title: titleMatch[1].trim(),
                    date: dateMatch ? dateMatch[1].trim() : null,
                    rawHTML: match
                });
            }
        }
        
        return events;
    }

    parseRockbarHTML(html) {
        // Rockbar-specific parsing logic
        const events = [];
        
        const eventPattern = /<div[^>]*class="[^"]*event-item[^"]*"[^>]*>[\s\S]*?<\/div>/gi;
        const matches = html.match(eventPattern) || [];
        
        for (const match of matches) {
            const titleMatch = match.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i);
            const dateMatch = match.match(/<span[^>]*class="[^"]*date[^"]*"[^>]*>([^<]+)<\/span>/i);
            
            if (titleMatch) {
                events.push({
                    title: titleMatch[1].trim(),
                    date: dateMatch ? dateMatch[1].trim() : null,
                    venue: 'Rockbar',
                    city: 'nyc',
                    rawHTML: match
                });
            }
        }
        
        return events;
    }

    parseSFEagleHTML(html) {
        // SF Eagle-specific parsing logic
        const events = [];
        
        const eventPattern = /<div[^>]*class="[^"]*event[^"]*"[^>]*>[\s\S]*?<\/div>/gi;
        const matches = html.match(eventPattern) || [];
        
        for (const match of matches) {
            const titleMatch = match.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i);
            const dateMatch = match.match(/<div[^>]*class="[^"]*date[^"]*"[^>]*>([^<]+)<\/div>/i);
            
            if (titleMatch) {
                events.push({
                    title: titleMatch[1].trim(),
                    date: dateMatch ? dateMatch[1].trim() : null,
                    venue: 'SF Eagle',
                    city: 'sf',
                    rawHTML: match
                });
            }
        }
        
        return events;
    }

    parseBearracudaHTML(html) {
        // Bearracuda-specific parsing logic - similar to generic but with multi-city support
        return this.parseGenericHTML(html);
    }

    parseGenericHTML(html) {
        // Generic parsing logic for unknown sites
        const events = [];
        
        // Look for common event patterns
        const patterns = [
            /<div[^>]*class="[^"]*event[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
            /<article[^>]*class="[^"]*event[^"]*"[^>]*>[\s\S]*?<\/article>/gi,
            /<li[^>]*class="[^"]*event[^"]*"[^>]*>[\s\S]*?<\/li>/gi
        ];
        
        for (const pattern of patterns) {
            const matches = html.match(pattern) || [];
            for (const match of matches) {
                const titleMatch = match.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i) ||
                                 match.match(/<[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)<\/[^>]*>/i);
                
                if (titleMatch) {
                    events.push({
                        title: titleMatch[1].trim(),
                        rawHTML: match
                    });
                }
            }
        }
        
        return events;
    }

    async processEvent(eventData, parserConfig) {
        // Standardize event data format
        const processedEvent = {
            title: this.cleanTitle(eventData.title),
            date: this.parseDate(eventData.date),
            venue: eventData.venue || parserConfig.defaultVenue,
            city: eventData.city || parserConfig.defaultCity,
            source: parserConfig.name,
            url: eventData.url,
            description: eventData.description,
            isBearEvent: this.isBearEvent(eventData, parserConfig),
            rawData: eventData
        };

        // Add venue defaults if available
        if (processedEvent.venue) {
            const venueKey = processedEvent.venue.toLowerCase();
            if (this.venueDefaults[venueKey]) {
                Object.assign(processedEvent, this.venueDefaults[venueKey]);
            }
        }

        // Map city to calendar
        if (processedEvent.city) {
            const cityKey = processedEvent.city.toLowerCase();
            processedEvent.calendar = this.cityCalendarMap[cityKey];
        }

        return processedEvent;
    }

    cleanTitle(title) {
        if (!title) return '';
        return title.trim().replace(/\s+/g, ' ');
    }

    parseDate(dateStr) {
        if (!dateStr) return null;
        
        try {
            // Handle various date formats
            const date = new Date(dateStr);
            return isNaN(date.getTime()) ? null : date.toISOString();
        } catch (error) {
            return null;
        }
    }

    isBearEvent(eventData, parserConfig) {
        // If parser always contains bear events
        if (parserConfig.alwaysBear) {
            return true;
        }

        // Check allowlist if provided
        if (parserConfig.allowlist && parserConfig.allowlist.length > 0) {
            const text = (eventData.title + ' ' + (eventData.description || '')).toLowerCase();
            return parserConfig.allowlist.some(keyword => 
                text.includes(keyword.toLowerCase())
            );
        }

        // Check against bear keywords
        const text = (eventData.title + ' ' + (eventData.description || '')).toLowerCase();
        return this.bearKeywords.some(keyword => 
            text.includes(keyword.toLowerCase())
        );
    }

    isValidEvent(event) {
        // Basic validation
        if (!event.title || event.title.trim().length === 0) {
            return false;
        }

        // Check if event is within date range
        if (event.date) {
            const eventDate = new Date(event.date);
            const now = new Date();
            const maxDate = new Date(now.getTime() + (this.config.daysToLookAhead * 24 * 60 * 60 * 1000));
            
            if (eventDate < now || eventDate > maxDate) {
                return false;
            }
        }

        return true;
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    // Node.js/CommonJS
    module.exports = { EventProcessor };
} else if (typeof window !== 'undefined') {
    // Browser
    window.EventProcessor = EventProcessor;
}
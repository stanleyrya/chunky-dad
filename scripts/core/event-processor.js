// Event Processor - Core processing logic that works the same in both environments
// Handles parsing, validation, and standardization of event data

class EventProcessor {
    constructor(config = {}) {
        this.config = {
            daysToLookAhead: config.daysToLookAhead, // undefined by default
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

        // Initialize input adapter for additional URL processing
        this.inputAdapter = null;
        
        // Initialize processing statistics
        this.resetStatistics();
    }
    
    // Reset statistics for new processing session
    resetStatistics() {
        this.statistics = {
            totalParsed: 0,
            validEvents: 0,
            invalidEvents: 0,
            bearEvents: 0,
            nonBearEvents: 0,
            pastEvents: 0,
            futureEvents: 0,
            eventsWithDates: 0,
            eventsWithoutDates: 0,
            duplicatesRemoved: 0,
            discardedEvents: [],
            eventStructures: new Map(), // Track different event structures found
            processingErrors: [],
            bearKeywordMatches: new Map(), // Track which keywords matched
            venueDistribution: new Map(), // Track venue frequency
            cityDistribution: new Map(), // Track city frequency
            dateRangeStats: {
                earliest: null,
                latest: null,
                averageDaysOut: 0
            }
        };
    }

    // Set input adapter for processing additional URLs
    setInputAdapter(inputAdapter) {
        this.inputAdapter = inputAdapter;
    }

    // Main processing method - same logic for all environments
    async processEvents(rawData, parserConfig) {
        // Reset statistics for this processing session
        this.resetStatistics();
        
        const events = [];
        
        try {
            console.log(`🔍 Processing events for ${parserConfig.name}`);
            console.log(`   Parser type: ${parserConfig.parser}`);
            console.log(`   Raw data: ${rawData.error ? `Error - ${rawData.error}` : `HTML received (${rawData.html?.length || 0} chars)`}`);
            
            if (rawData.error) {
                throw new Error(`Failed to fetch data: ${rawData.error}`);
            }
            
            if (!rawData.html || rawData.html.length === 0) {
                throw new Error('No HTML content received');
            }
            
            // Parse HTML based on parser type
            const parsedEvents = await this.parseHTML(rawData.html, parserConfig);
            this.statistics.totalParsed = parsedEvents.length;
            
            console.log(`   📋 Parsed ${parsedEvents.length} raw events`);
            
            // Process each event
            for (const eventData of parsedEvents) {
                try {
                    const processedEvent = await this.processEvent(eventData, parserConfig);
                    if (processedEvent) {
                        // Analyze event structure
                        this.analyzeEventStructure(processedEvent);
                        
                        if (this.isValidEvent(processedEvent)) {
                            events.push(processedEvent);
                            this.statistics.validEvents++;
                            
                            // Update bear event statistics
                            if (processedEvent.isBearEvent) {
                                this.statistics.bearEvents++;
                                this.trackBearKeywordMatches(eventData, parserConfig);
                            } else {
                                this.statistics.nonBearEvents++;
                            }
                            
                            // Update distribution statistics
                            this.updateDistributionStats(processedEvent);
                            
                            // Update date statistics
                            this.updateDateStats(processedEvent);
                            
                        } else {
                            this.statistics.invalidEvents++;
                            this.trackDiscardedEvent(processedEvent, 'Failed validation');
                        }
                    }
                } catch (error) {
                    this.statistics.processingErrors.push({
                        event: eventData,
                        error: error.message
                    });
                    console.error(`   ⚠️ Error processing event: ${error.message}`);
                }
            }
            
            console.log(`   ✅ Valid events: ${events.length} (${this.statistics.bearEvents} bear events)`);
            
            // Process additional URLs if configured
            if (parserConfig.requireDetailPages && this.inputAdapter) {
                console.log(`   🔗 Processing additional detail pages...`);
                const additionalEvents = await this.processAdditionalUrls(rawData.html, parserConfig);
                events.push(...additionalEvents);
                console.log(`   📄 Found ${additionalEvents.length} additional events from detail pages`);
            }
            
        } catch (error) {
            console.error(`❌ Fatal error processing events: ${error.message}`);
            this.statistics.processingErrors.push({
                source: parserConfig.name,
                error: error.message,
                fatal: true
            });
        }
        
        return events;
    }
    
    // Analyze the structure of events to understand data patterns
    analyzeEventStructure(event) {
        const structure = {
            hasTitle: !!event.title,
            hasDate: !!event.date,
            hasVenue: !!event.venue,
            hasCity: !!event.city,
            hasDescription: !!event.description,
            hasUrl: !!event.url,
            hasCoordinates: !!(event.coordinates && event.coordinates.lat && event.coordinates.lng),
            hasAddress: !!event.address,
            fieldCount: Object.keys(event).filter(key => 
                event[key] !== null && 
                event[key] !== undefined && 
                event[key] !== ''
            ).length
        };
        
        const structureKey = JSON.stringify(structure);
        const count = this.statistics.eventStructures.get(structureKey) || 0;
        this.statistics.eventStructures.set(structureKey, count + 1);
    }
    
    // Track which bear keywords matched for analysis
    trackBearKeywordMatches(eventData, parserConfig) {
        if (parserConfig.alwaysBear) {
            const key = 'alwaysBear (parser setting)';
            this.statistics.bearKeywordMatches.set(key, 
                (this.statistics.bearKeywordMatches.get(key) || 0) + 1);
            return;
        }
        
        const text = (eventData.title + ' ' + (eventData.description || '')).toLowerCase();
        
        // Check allowlist keywords
        if (parserConfig.allowlist && parserConfig.allowlist.length > 0) {
            for (const keyword of parserConfig.allowlist) {
                if (text.includes(keyword.toLowerCase())) {
                    const key = `allowlist: ${keyword}`;
                    this.statistics.bearKeywordMatches.set(key, 
                        (this.statistics.bearKeywordMatches.get(key) || 0) + 1);
                }
            }
        } else {
            // Check bear keywords
            for (const keyword of this.bearKeywords) {
                if (text.includes(keyword.toLowerCase())) {
                    const key = `bear keyword: ${keyword}`;
                    this.statistics.bearKeywordMatches.set(key, 
                        (this.statistics.bearKeywordMatches.get(key) || 0) + 1);
                }
            }
        }
    }
    
    // Track events that were discarded and why
    trackDiscardedEvent(event, reason) {
        this.statistics.discardedEvents.push({
            title: event.title,
            date: event.date,
            venue: event.venue,
            city: event.city,
            reason: reason,
            isBearEvent: event.isBearEvent
        });
    }
    
    // Update venue and city distribution statistics
    updateDistributionStats(event) {
        if (event.venue) {
            const venue = event.venue.toLowerCase();
            this.statistics.venueDistribution.set(venue, 
                (this.statistics.venueDistribution.get(venue) || 0) + 1);
        }
        
        if (event.city) {
            const city = event.city.toLowerCase();
            this.statistics.cityDistribution.set(city, 
                (this.statistics.cityDistribution.get(city) || 0) + 1);
        }
    }
    
    // Update date-related statistics
    updateDateStats(event) {
        if (event.date) {
            this.statistics.eventsWithDates++;
            const eventDate = new Date(event.date);
            const now = new Date();
            
            if (eventDate >= now) {
                this.statistics.futureEvents++;
                
                // Update date range
                if (!this.statistics.dateRangeStats.earliest || eventDate < this.statistics.dateRangeStats.earliest) {
                    this.statistics.dateRangeStats.earliest = eventDate;
                }
                if (!this.statistics.dateRangeStats.latest || eventDate > this.statistics.dateRangeStats.latest) {
                    this.statistics.dateRangeStats.latest = eventDate;
                }
            } else {
                this.statistics.pastEvents++;
                this.trackDiscardedEvent(event, 'Event is in the past');
            }
        } else {
            this.statistics.eventsWithoutDates++;
        }
    }
    
    // Get comprehensive processing statistics
    getProcessingStatistics() {
        // Calculate average days out for future events
        if (this.statistics.futureEvents > 0 && this.statistics.dateRangeStats.earliest) {
            const now = new Date();
            const totalDays = this.statistics.futureEvents > 0 ? 
                Array.from({length: this.statistics.futureEvents}, (_, i) => {
                    // This is a simplified calculation - in practice we'd track each event's days
                    const avgDate = new Date((this.statistics.dateRangeStats.earliest.getTime() + 
                                            this.statistics.dateRangeStats.latest.getTime()) / 2);
                    return Math.ceil((avgDate - now) / (1000 * 60 * 60 * 24));
                }).reduce((sum, days) => sum + days, 0) : 0;
            
            this.statistics.dateRangeStats.averageDaysOut = Math.round(totalDays / this.statistics.futureEvents);
        }
        
        return {
            ...this.statistics,
            // Convert Maps to Objects for easier serialization
            eventStructures: Object.fromEntries(this.statistics.eventStructures),
            bearKeywordMatches: Object.fromEntries(this.statistics.bearKeywordMatches),
            venueDistribution: Object.fromEntries(this.statistics.venueDistribution),
            cityDistribution: Object.fromEntries(this.statistics.cityDistribution)
        };
    }

    // Process additional URLs found on the main page
    async processAdditionalUrls(html, parserConfig) {
        const additionalEvents = [];
        
        try {
            // Extract additional URLs based on parser type
            const additionalUrls = this.extractAdditionalUrls(html, parserConfig);
            
            console.log(`  → Found ${additionalUrls.length} additional URLs to process`);
            
            // Process each additional URL
            for (const url of additionalUrls) {
                try {
                    console.log(`    → Processing detail page: ${url}`);
                    
                    const detailData = await this.inputAdapter.fetchData({
                        url: url,
                        parser: parserConfig.parser,
                        timeout: 10000
                    });
                    
                    if (detailData.error) {
                        console.error(`    ✗ Error fetching ${url}: ${detailData.error}`);
                        continue;
                    }
                    
                    // Parse the detail page
                    const detailEvents = await this.parseHTML(detailData.html, parserConfig);
                    
                    // Process each event from the detail page
                    for (const eventData of detailEvents) {
                        // Add the source URL to the event data
                        eventData.detailUrl = url;
                        
                        const processedEvent = await this.processEvent(eventData, parserConfig);
                        if (processedEvent && this.isValidEvent(processedEvent)) {
                            additionalEvents.push(processedEvent);
                        }
                    }
                    
                    console.log(`    ✓ Processed ${detailEvents.length} events from detail page`);
                    
                } catch (error) {
                    console.error(`    ✗ Error processing detail page ${url}:`, error);
                }
            }
            
        } catch (error) {
            console.error(`Error processing additional URLs: ${error.message}`);
        }
        
        return additionalEvents;
    }

    // Extract additional URLs to process based on parser type
    extractAdditionalUrls(html, parserConfig) {
        // Use parser-specific extraction if available and configured
        if (parserConfig.urlExtractionMethod === 'parser-specific') {
            switch (parserConfig.parser) {
                case 'bearracuda':
                    return this.extractBearracudaUrls(html);
                case 'megawoof':
                    return this.extractMegawoofUrls(html);
                default:
                    // Fall back to configurable patterns
                    return this.extractUrlsWithPatterns(html, parserConfig);
            }
        }
        
        // Default: Use configurable pattern-based extraction
        return this.extractUrlsWithPatterns(html, parserConfig);
    }

    // Generic URL extraction using configurable patterns
    extractUrlsWithPatterns(html, parserConfig) {
        const urls = [];
        const baseUrl = this.getBaseUrl(parserConfig);
        
        // Get URL patterns from config, with sensible defaults
        const urlPatterns = this.getUrlPatterns(parserConfig);
        
        console.log(`    → Using ${urlPatterns.length} URL patterns for extraction`);
        
        for (const patternConfig of urlPatterns) {
            const pattern = new RegExp(patternConfig.regex, patternConfig.flags || 'gi');
            let match;
            let matchCount = 0;
            
            while ((match = pattern.exec(html)) !== null && matchCount < (patternConfig.maxMatches || 10)) {
                let url = match[1]; // Assume first capture group contains the URL
                
                // Convert relative URLs to absolute
                if (url.startsWith('/')) {
                    url = baseUrl + url;
                } else if (!url.startsWith('http') && baseUrl) {
                    url = baseUrl + '/' + url;
                }
                
                // Apply filters
                if (this.shouldIncludeUrl(url, patternConfig, parserConfig)) {
                    urls.push(url);
                    matchCount++;
                }
            }
            
            console.log(`    → Pattern "${patternConfig.name}" found ${matchCount} URLs`);
        }
        
        // Remove duplicates and apply global limits
        const uniqueUrls = [...new Set(urls)];
        const maxUrls = parserConfig.maxAdditionalUrls || 12;
        
        return uniqueUrls.slice(0, maxUrls);
    }

    // Get base URL for converting relative URLs to absolute
    getBaseUrl(parserConfig) {
        if (parserConfig.urls && parserConfig.urls.length > 0) {
            try {
                const url = new URL(parserConfig.urls[0]);
                return `${url.protocol}//${url.host}`;
            } catch (e) {
                console.warn(`Invalid base URL: ${parserConfig.urls[0]}`);
            }
        }
        return null;
    }

    // Get URL patterns from config with intelligent defaults
    getUrlPatterns(parserConfig) {
        // Use custom patterns if provided
        if (parserConfig.urlPatterns && parserConfig.urlPatterns.length > 0) {
            return parserConfig.urlPatterns;
        }
        
        // Generate intelligent default patterns based on parser type and website
        return this.generateDefaultUrlPatterns(parserConfig);
    }

    // Generate default URL patterns based on the website structure
    generateDefaultUrlPatterns(parserConfig) {
        const patterns = [];
        const baseUrl = this.getBaseUrl(parserConfig);
        
        // Common event page patterns (universal)
        patterns.push({
            name: 'Event Pages',
            regex: 'href="([^"]*\\/events?\\/[^"]*)"[^>]*>',
            maxMatches: 8,
            description: 'Standard /events/ pages'
        });
        
        patterns.push({
            name: 'Show Pages', 
            regex: 'href="([^"]*\\/shows?\\/[^"]*)"[^>]*>',
            maxMatches: 6,
            description: 'Standard /shows/ pages'
        });
        
        patterns.push({
            name: 'Calendar Pages',
            regex: 'href="([^"]*\\/calendar\\/[^"]*)"[^>]*>',
            maxMatches: 5,
            description: 'Calendar detail pages'
        });
        
        // Add website-specific patterns based on known structures
        if (baseUrl) {
            if (baseUrl.includes('bearracuda.com')) {
                patterns.push({
                    name: 'Bearracuda Cities',
                    regex: 'href="([^"]*\\/(?:sf|atlanta|denver|la|nyc|seattle|portland|vancouver|chicago|new-orleans|miami)[^"]*)"[^>]*>',
                    maxMatches: 15,
                    description: 'Bearracuda city-specific pages'
                });
            } else if (baseUrl.includes('eventbrite.com')) {
                patterns.push({
                    name: 'Eventbrite Events',
                    regex: 'href="(https:\\/\\/www\\.eventbrite\\.com\\/e\\/[^"]+)"',
                    maxMatches: 20,
                    description: 'Individual Eventbrite event pages'
                });
            } else if (baseUrl.includes('eagle')) {
                patterns.push({
                    name: 'Eagle Events',
                    regex: 'href="([^"]*\\/(?:event|party|night)\\/[^"]*)"[^>]*>',
                    maxMatches: 10,
                    description: 'Eagle bar event pages'
                });
            } else if (baseUrl.includes('facebook.com')) {
                patterns.push({
                    name: 'Facebook Events',
                    regex: 'href="([^"]*\\/events\\/\\d+[^"]*)"[^>]*>',
                    maxMatches: 15,
                    description: 'Facebook event pages'
                });
            }
        }
        
        // Add generic patterns for common website structures
        patterns.push({
            name: 'Date-based URLs',
            regex: 'href="([^"]*\\/\\d{4}\\/\\d{2}\\/[^"]*)"[^>]*>',
            maxMatches: 8,
            description: 'Date-based URLs (YYYY/MM/)'
        });
        
        patterns.push({
            name: 'ID-based Events',
            regex: 'href="([^"]*\\/(?:event|show|party)[-_]?\\d+[^"]*)"[^>]*>',
            maxMatches: 10,
            description: 'ID-based event URLs'
        });
        
        return patterns;
    }

    // Determine if a URL should be included based on filters
    shouldIncludeUrl(url, patternConfig, parserConfig) {
        // Basic validation
        if (!url || url === parserConfig.urls?.[0]) {
            return false; // Skip empty URLs or same as main URL
        }
        
        // Skip anchors, javascript, mailto, etc.
        if (url.includes('#') || url.startsWith('javascript:') || url.startsWith('mailto:')) {
            return false;
        }
        
        // Apply pattern-specific filters
        if (patternConfig.excludePatterns) {
            for (const excludePattern of patternConfig.excludePatterns) {
                if (new RegExp(excludePattern, 'i').test(url)) {
                    return false;
                }
            }
        }
        
        // Apply parser-specific filters
        if (parserConfig.urlFilters) {
            if (parserConfig.urlFilters.exclude) {
                for (const excludePattern of parserConfig.urlFilters.exclude) {
                    if (new RegExp(excludePattern, 'i').test(url)) {
                        return false;
                    }
                }
            }
            
            if (parserConfig.urlFilters.include) {
                let matchesInclude = false;
                for (const includePattern of parserConfig.urlFilters.include) {
                    if (new RegExp(includePattern, 'i').test(url)) {
                        matchesInclude = true;
                        break;
                    }
                }
                if (!matchesInclude) {
                    return false;
                }
            }
        }
        
        return true;
    }

    // Keep parser-specific methods for complex cases that need custom logic
    extractBearracudaUrls(html) {
        const urls = [];
        const baseUrl = 'https://bearracuda.com';
        
        // Look for city-specific links like /sf/, /atlanta/, /vancouver-pride/, etc.
        const cityLinkPatterns = [
            /href="([^"]*\/[a-z-]+\/?)"[^>]*>.*?(?:atlanta|denver|los angeles|new orleans|portland|san francisco|seattle|vancouver|chicago|sf|la|nyc)/gi,
            /href="([^"]*\/(?:sf|atlanta|denver|la|nyc|seattle|portland|vancouver|chicago|new-orleans)[^"]*)"[^>]*>/gi,
            /href="([^"]*\/[a-z-]+-pride[^"]*)"[^>]*>/gi
        ];
        
        for (const pattern of cityLinkPatterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                let url = match[1];
                
                // Convert relative URLs to absolute
                if (url.startsWith('/')) {
                    url = baseUrl + url;
                } else if (!url.startsWith('http')) {
                    url = baseUrl + '/' + url;
                }
                
                // Avoid duplicates
                if (!urls.includes(url) && url !== baseUrl && !url.includes('#')) {
                    urls.push(url);
                }
            }
        }
        
        // Also look for event-specific links
        const eventLinkPattern = /href="([^"]*\/events?\/[^"]*)"[^>]*>/gi;
        let match;
        while ((match = eventLinkPattern.exec(html)) !== null) {
            let url = match[1];
            if (url.startsWith('/')) {
                url = baseUrl + url;
            }
            if (!urls.includes(url)) {
                urls.push(url);
            }
        }
        
        return urls.slice(0, 10); // Limit to prevent excessive requests
    }

    // Extract Megawoof Eventbrite URLs
    extractMegawoofUrls(html) {
        const urls = [];
        
        // Look for Eventbrite event links
        const eventbritePattern = /href="(https:\/\/www\.eventbrite\.com\/e\/[^"]+)"/gi;
        let match;
        while ((match = eventbritePattern.exec(html)) !== null) {
            const url = match[1];
            if (!urls.includes(url)) {
                urls.push(url);
            }
        }
        
        return urls.slice(0, 15); // Limit to prevent excessive requests
    }

    // Legacy method - now delegates to the new pattern-based system
    extractGenericUrls(html, parserConfig) {
        return this.extractUrlsWithPatterns(html, parserConfig);
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
        // Enhanced Bearracuda-specific parsing logic
        const events = [];
        
        // Look for upcoming events section
        const upcomingEventsPattern = /<h[1-6][^>]*>.*?upcoming events.*?<\/h[1-6]>[\s\S]*?(?=<h[1-6]|$)/gi;
        const upcomingMatch = html.match(upcomingEventsPattern);
        
        if (upcomingMatch) {
            const upcomingSection = upcomingMatch[0];
            
            // Extract city/event combinations
            const cityEventPattern = /<h[1-6][^>]*>([^<]+)<\/h[1-6]>[\s\S]*?<h[2-6][^>]*>([^<]+)<\/h[2-6]>/gi;
            let match;
            while ((match = cityEventPattern.exec(upcomingSection)) !== null) {
                const city = match[1].trim();
                const dateInfo = match[2].trim();
                
                // Try to parse the date
                let eventDate = null;
                const dateMatch = dateInfo.match(/(\w+)\s+(\d+),?\s+(\d{4})/i);
                if (dateMatch) {
                    eventDate = new Date(`${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`).toISOString();
                }
                
                events.push({
                    title: `Bearracuda ${city}`,
                    date: eventDate,
                    venue: `Bearracuda ${city}`,
                    city: this.normalizeCityName(city),
                    description: `Bearracuda bear dance party in ${city}`,
                    rawHTML: match[0]
                });
            }
        }
        
        // Alternative pattern: Look for consecutive h3/h4 pairs (city/date)
        if (events.length === 0) {
            const cityDatePattern = /<h3[^>]*>([^<]+)<\/h3>[\s\S]*?<h4[^>]*>([^<]+)<\/h4>/gi;
            let match;
            while ((match = cityDatePattern.exec(html)) !== null) {
                const city = match[1].trim();
                const dateInfo = match[2].trim();
                
                // Try to parse the date
                let eventDate = null;
                const dateMatch = dateInfo.match(/(\w+)\s+(\d+),?\s+(\d{4})/i);
                if (dateMatch) {
                    try {
                        eventDate = new Date(`${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`).toISOString();
                    } catch (e) {
                        // Date parsing failed, leave as null
                    }
                }
                
                events.push({
                    title: `Bearracuda ${city}`,
                    date: eventDate,
                    venue: `Bearracuda ${city}`,
                    city: this.normalizeCityName(city),
                    description: `Bearracuda bear dance party in ${city}`,
                    rawHTML: match[0]
                });
            }
        }
        
        // Also look for individual event pages (when processing detail pages)
        const eventTitlePattern = /<h1[^>]*>([^<]*bearracuda[^<]*)<\/h1>/gi;
        const titleMatch = html.match(eventTitlePattern);
        if (titleMatch) {
            const title = titleMatch[0].replace(/<[^>]*>/g, '').trim();
            
            // Look for date information
            const datePattern = /<time[^>]*>([^<]+)<\/time>|<span[^>]*class="[^"]*date[^"]*"[^>]*>([^<]+)<\/span>/gi;
            const dateMatch = html.match(datePattern);
            let eventDate = null;
            if (dateMatch && dateMatch[0]) {
                const dateText = dateMatch[0].replace(/<[^>]*>/g, '').trim();
                try {
                    eventDate = new Date(dateText).toISOString();
                } catch (e) {
                    // Date parsing failed, leave as null
                }
            }
            
            // Extract city from URL or content
            let city = 'multi';
            const cityFromUrl = html.match(/bearracuda\.com\/([a-z-]+)/i);
            if (cityFromUrl) {
                city = this.normalizeCityName(cityFromUrl[1]);
            }
            
            events.push({
                title: title,
                date: eventDate,
                venue: `Bearracuda ${city}`,
                city: city,
                description: `Bearracuda bear dance party`,
                rawHTML: html.substring(0, 500) // First 500 chars for context
            });
        }
        
        // Fallback: look for generic event patterns
        if (events.length === 0) {
            return this.parseGenericHTML(html);
        }
        
        return events;
    }

    // Normalize city names for consistent mapping
    normalizeCityName(cityName) {
        const normalizedName = cityName.toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[^a-z\s]/g, '')
            .trim();
        
        const cityMappings = {
            'san francisco': 'sf',
            'los angeles': 'la',
            'new york': 'nyc',
            'new orleans': 'nola',
            'las vegas': 'vegas',
            'vancouver pride': 'vancouver',
            'sf hmd': 'sf'
        };
        
        return cityMappings[normalizedName] || normalizedName;
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
            url: eventData.url || eventData.detailUrl,
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
            
            if (this.config.daysToLookAhead) {
                const maxDate = new Date(now.getTime() + (this.config.daysToLookAhead * 24 * 60 * 60 * 1000));
                if (eventDate < now || eventDate > maxDate) {
                    return false;
                }
            } else {
                // Just check if it's not in the past
                if (eventDate < now) {
                    return false;
                }
            }
        }

        return true;
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    // Node.js/CommonJS
    module.exports = { EventProcessor };
}

// Always export to window if it exists (for browser environment)
if (typeof window !== 'undefined') {
    window.EventProcessor = EventProcessor;
}
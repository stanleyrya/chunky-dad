// ============================================================================
// SHARED CORE - PURE JAVASCRIPT BUSINESS LOGIC
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains PURE JavaScript business logic
// 
// 🚨 CRITICAL RESTRICTIONS - NEVER ADD THESE TO THIS FILE:
// ❌ NO environment detection (typeof importModule, typeof window, typeof DOMParser)
// ❌ NO Scriptable APIs (Request, Calendar, FileManager, Alert, Notification)
// ❌ NO DOM APIs (DOMParser, document, window, fetch)
// ❌ NO HTTP requests (parsers receive data, they don't fetch it)
// ❌ NO calendar operations (return event objects, don't save them)
//
// ✅ THIS FILE SHOULD ONLY CONTAIN:
// ✅ Pure JavaScript functions that work in any environment
// ✅ Event processing, filtering, deduplication logic
// ✅ Date/string utilities and validation
// ✅ Business logic that calls adapter interfaces
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

class SharedCore {
    constructor() {
        this.visitedUrls = new Set();
        this.bearKeywords = [
            'bear', 'bears', 'woof', 'grr', 'furry', 'hairy', 'daddy', 'cub', 
            'otter', 'leather', 'muscle bear', 'bearracuda', 'furball', 'megawoof',
            'leather bears', 'bear night', 'bear party', 'polar bear', 'grizzly'
        ];
        
        // City mapping for consistent location detection across all parsers
        this.cityMappings = {
            'new york|nyc|manhattan|brooklyn|queens|bronx': 'nyc',
            'los angeles|hollywood|west hollywood|weho|dtla|downtown los angeles': 'la',
            'san francisco|sf|castro': 'sf',
            'chicago|chi': 'chicago',
            'atlanta|atl': 'atlanta',
            'miami|south beach|miami beach': 'miami',
            'seattle': 'seattle',
            'portland': 'portland',
            'denver': 'denver',
            'las vegas|vegas': 'vegas',
            'boston': 'boston',
            'philadelphia|philly': 'philadelphia',
            'austin': 'austin',
            'dallas': 'dallas',
            'houston': 'houston',
            'phoenix': 'phoenix',
            'long beach': 'la',  // Long Beach is part of LA metro area
            'santa monica': 'la',
            'palm springs': 'palm-springs',  // Palm Springs gets its own area
            'san diego': 'san diego',
            'sacramento': 'sacramento',
            'san jose': 'sf',  // Bay Area
            'oakland': 'sf',   // Bay Area
            'fort lauderdale': 'miami',
            'key west': 'miami',
            'toronto': 'toronto',
            'london': 'london',
            'berlin': 'berlin'
        };
    }

    // Pure business logic for processing events
    async processEvents(config, httpAdapter, displayAdapter, parsers) {
        await displayAdapter.logInfo('SYSTEM: Starting event processing...');
        await displayAdapter.logInfo(`SYSTEM: Processing ${config.parsers?.length || 0} parser configurations`);
        
        const results = {
            totalEvents: 0,
            bearEvents: 0,
            calendarEvents: 0,
            errors: [],
            parserResults: []
        };

        if (!config.parsers || config.parsers.length === 0) {
            await displayAdapter.logWarn('SYSTEM: No parser configurations found in config');
            return results;
        }

        for (let i = 0; i < config.parsers.length; i++) {
            const parserConfig = config.parsers[i];
            try {
                await displayAdapter.logInfo(`SYSTEM: Processing parser ${i + 1}/${config.parsers.length}: ${parserConfig.name}`);
                
                const parserResult = await this.processParser(parserConfig, httpAdapter, displayAdapter, parsers);
                results.parserResults.push(parserResult);
                results.totalEvents += parserResult.totalEvents;
                results.bearEvents += parserResult.bearEvents;
                results.calendarEvents += parserResult.calendarEvents;
                
                await displayAdapter.logSuccess(`SYSTEM: Completed parser ${parserConfig.name}: ${parserResult.bearEvents} bear events found`);
                
            } catch (error) {
                const errorMsg = `SYSTEM: Failed to process ${parserConfig.name}: ${error.message || 'Unknown error'}`;
                results.errors.push(errorMsg);
                await displayAdapter.logError(errorMsg);
                // Only log stack trace if it exists and is meaningful
                if (error.stack && error.stack.trim()) {
                    await displayAdapter.logError(`SYSTEM: Stack trace for ${parserConfig.name}: ${error.stack}`);
                }
            }
        }

        await displayAdapter.logInfo(`SYSTEM: Event processing complete. Total: ${results.totalEvents}, Bear: ${results.bearEvents}, Calendar: ${results.calendarEvents}`);
        return results;
    }

    async processParser(parserConfig, httpAdapter, displayAdapter, parsers) {
        const parserName = parserConfig.parser;
        const parser = parsers[parserName];
        
        if (!parser) {
            await displayAdapter.logError(`SYSTEM: Parser '${parserName}' not found in available parsers: ${Object.keys(parsers).join(', ')}`);
            throw new Error(`Parser '${parserName}' not found`);
        }

        await displayAdapter.logInfo(`SYSTEM: Processing: ${parserConfig.name} using ${parserName} parser`);
        await displayAdapter.logInfo(`SYSTEM: URLs to process: ${parserConfig.urls?.length || 0}`);
        if (parserConfig.urls) {
            parserConfig.urls.forEach((url, i) => {
                displayAdapter.logInfo(`SYSTEM:   URL ${i + 1}: ${url}`);
            });
        }
        
        const allEvents = [];
        const processedUrls = new Set();

        // Process main URLs
        for (let i = 0; i < (parserConfig.urls || []).length; i++) {
            const url = parserConfig.urls[i];
            if (processedUrls.has(url)) {
                await displayAdapter.logWarn(`SYSTEM: Skipping duplicate URL: ${url}`);
                continue;
            }
            processedUrls.add(url);

            try {
                await displayAdapter.logInfo(`SYSTEM: Fetching URL ${i + 1}/${parserConfig.urls.length}: ${url}`);
                const htmlData = await httpAdapter.fetchData(url);
                
                await displayAdapter.logInfo(`SYSTEM: HTML data received: ${htmlData?.html?.length || 0} characters`);
                
                await displayAdapter.logInfo(`SYSTEM: Parsing events with ${parserName} parser...`);
                const parseResult = parser.parseEvents(htmlData, parserConfig);
                
                await displayAdapter.logInfo(`SYSTEM: Parse result: ${parseResult?.events?.length || 0} events found`);
                if (parseResult?.additionalLinks) {
                    await displayAdapter.logInfo(`SYSTEM: Additional links found: ${parseResult.additionalLinks.length}`);
                }
                
                if (parseResult.events) {
                    allEvents.push(...parseResult.events);
                    await displayAdapter.logSuccess(`SYSTEM: Added ${parseResult.events.length} events from ${url}`);
                }

                // Process additional URLs if required
                if (parserConfig.requireDetailPages && parseResult.additionalLinks) {
                    await displayAdapter.logInfo(`SYSTEM: Processing ${parseResult.additionalLinks.length} additional URLs for detail pages...`);
                    const additionalEvents = await this.processAdditionalUrls(
                        parseResult.additionalLinks, 
                        parser, 
                        parserConfig, 
                        httpAdapter, 
                        displayAdapter,
                        processedUrls
                    );
                    allEvents.push(...additionalEvents);
                    await displayAdapter.logSuccess(`SYSTEM: Added ${additionalEvents.length} events from detail pages`);
                }
            } catch (error) {
                await displayAdapter.logError(`SYSTEM: Failed to process URL ${url}: ${error.message || 'Unknown error'}`);
                // Only log stack trace if it exists and is meaningful
                if (error.stack && error.stack.trim()) {
                    await displayAdapter.logError(`SYSTEM: URL processing stack trace: ${error.stack}`);
                }
            }
        }

        await displayAdapter.logInfo(`SYSTEM: Total events collected: ${allEvents.length}`);

        // Filter and process events
        await displayAdapter.logInfo('SYSTEM: Filtering future events...');
        const futureEvents = this.filterFutureEvents(allEvents, parserConfig.daysToLookAhead);
        await displayAdapter.logInfo(`SYSTEM: Future events: ${futureEvents.length}/${allEvents.length}`);
        
        await displayAdapter.logInfo('SYSTEM: Filtering bear events...');
        const bearEvents = this.filterBearEvents(futureEvents, parserConfig);
        await displayAdapter.logInfo(`SYSTEM: Bear events: ${bearEvents.length}/${futureEvents.length}`);
        
        await displayAdapter.logInfo('SYSTEM: Deduplicating events...');
        const deduplicatedEvents = this.deduplicateEvents(bearEvents);
        await displayAdapter.logInfo(`SYSTEM: Deduplicated events: ${deduplicatedEvents.length}/${bearEvents.length}`);

        // Add to calendar if not dry run
        let calendarEvents = 0;
        if (!parserConfig.dryRun && displayAdapter.addToCalendar) {
            await displayAdapter.logInfo(`SYSTEM: Adding ${deduplicatedEvents.length} events to calendar (not dry run)...`);
            calendarEvents = await displayAdapter.addToCalendar(deduplicatedEvents, parserConfig);
        } else {
            await displayAdapter.logInfo(`SYSTEM: Dry run mode: would add ${deduplicatedEvents.length} events to calendar`);
        }

        await displayAdapter.logSuccess(`SYSTEM: ${parserConfig.name}: ${deduplicatedEvents.length} bear events found, ${calendarEvents} added to calendar`);

        return {
            name: parserConfig.name,
            totalEvents: allEvents.length,
            bearEvents: deduplicatedEvents.length,
            calendarEvents: calendarEvents,
            events: deduplicatedEvents
        };
    }

    async processAdditionalUrls(additionalLinks, parser, parserConfig, httpAdapter, displayAdapter, processedUrls) {
        const maxUrls = parserConfig.maxAdditionalUrls || 12;
        const urlsToProcess = additionalLinks.slice(0, maxUrls);
        const events = [];

        await displayAdapter.logInfo(`SYSTEM: Processing ${urlsToProcess.length} additional URLs`);

        for (const url of urlsToProcess) {
            if (processedUrls.has(url)) continue;
            processedUrls.add(url);

            try {
                const htmlData = await httpAdapter.fetchData(url);
                const parseResult = parser.parseEvents(htmlData, parserConfig);
                
                if (parseResult.events) {
                    events.push(...parseResult.events);
                }
            } catch (error) {
                await displayAdapter.logWarn(`SYSTEM: Failed to process additional URL: ${url}`);
            }
        }

        return events;
    }

    // Pure utility functions
    filterFutureEvents(events, daysToLookAhead = null) {
        const now = new Date();
        const cutoffDate = daysToLookAhead ? 
            new Date(now.getTime() + (daysToLookAhead * 24 * 60 * 60 * 1000)) : 
            null;

        return events.filter(event => {
            if (!event.startDate) return false;
            
            const eventDate = new Date(event.startDate);
            if (eventDate <= now) return false;
            
            if (cutoffDate && eventDate > cutoffDate) return false;
            
            return true;
        });
    }

    filterBearEvents(events, parserConfig) {
        // If alwaysBear is true, return all events
        if (parserConfig.alwaysBear) {
            return events.map(event => ({...event, isBearEvent: true}));
        }

        // Filter based on keywords and allowlist
        return events.filter(event => this.isBearEvent(event, parserConfig));
    }

    isBearEvent(event, parserConfig) {
        if (parserConfig.alwaysBear) return true;

        const searchText = `${event.title || ''} ${event.description || ''} ${event.venue || ''}`.toLowerCase();
        
        // Check allowlist first (if provided)
        if (parserConfig.allowlist && parserConfig.allowlist.length > 0) {
            const hasAllowlistKeyword = parserConfig.allowlist.some(keyword => 
                searchText.includes(keyword.toLowerCase())
            );
            if (parserConfig.requireKeywords && !hasAllowlistKeyword) {
                return false;
            }
        }

        // Check bear keywords
        return this.bearKeywords.some(keyword => searchText.includes(keyword));
    }

    deduplicateEvents(events) {
        const seen = new Map();
        const deduplicated = [];

        for (const event of events) {
            const key = this.createEventKey(event);
            
            if (!seen.has(key)) {
                seen.set(key, event);
                deduplicated.push(event);
            } else {
                // Merge with existing event if needed
                const existing = seen.get(key);
                const merged = this.mergeEvents(existing, event);
                seen.set(key, merged);
                
                // Update in deduplicated array
                const index = deduplicated.findIndex(e => this.createEventKey(e) === key);
                if (index !== -1) {
                    deduplicated[index] = merged;
                }
            }
        }

        return deduplicated;
    }

    createEventKey(event) {
        // Debug the event structure
        if (typeof event.title !== 'string') {
            console.log(`🔍 DEBUG: event.title type: ${typeof event.title}, value:`, event.title);
            console.log(`🔍 DEBUG: Full event object:`, JSON.stringify(event, null, 2));
        }
        
        const title = String(event.title || '').toLowerCase().trim();
        const date = event.startDate ? new Date(event.startDate).toDateString() : '';
        const venue = String(event.venue || '').toLowerCase().trim();
        
        return `${title}|${date}|${venue}`;
    }

    mergeEvents(existing, newEvent) {
        return {
            ...existing,
            description: existing.description || newEvent.description,
            url: existing.url || newEvent.url,
            image: existing.image || newEvent.image,
            price: existing.price || newEvent.price,
            // Keep the most complete event data
        };
    }

    // URL processing utilities
    extractUrls(html, patterns, baseUrl) {
        const urls = new Set();
        
        for (const pattern of patterns) {
            const regex = new RegExp(pattern.regex, 'gi');
            let match;
            
            while ((match = regex.exec(html)) !== null && urls.size < (pattern.maxMatches || 10)) {
                const url = this.normalizeUrl(match[1], baseUrl);
                if (this.isValidUrl(url)) {
                    urls.add(url);
                }
            }
        }
        
        return Array.from(urls);
    }

    normalizeUrl(url, baseUrl) {
        if (!url) return null;
        
        // Remove HTML entities
        url = url.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        
        // Handle relative URLs
        if (url.startsWith('/')) {
            const base = new URL(baseUrl);
            return `${base.protocol}//${base.host}${url}`;
        }
        
        // Handle protocol-relative URLs
        if (url.startsWith('//')) {
            const base = new URL(baseUrl);
            return `${base.protocol}${url}`;
        }
        
        return url;
    }

    isValidUrl(url) {
        if (!url || typeof url !== 'string') return false;
        
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    // Date utilities
    parseDate(dateString) {
        if (!dateString) return null;
        
        // Try various date formats
        const formats = [
            // ISO formats
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
            // Common formats
            /^\d{1,2}\/\d{1,2}\/\d{4}/,
            /^\d{4}-\d{2}-\d{2}/,
        ];
        
        for (const format of formats) {
            if (format.test(dateString)) {
                const date = new Date(dateString);
                if (!isNaN(date.getTime())) {
                    return date;
                }
            }
        }
        
        // Fallback to Date constructor
        const date = new Date(dateString);
        return isNaN(date.getTime()) ? null : date;
    }

    formatDateForCalendar(date) {
        if (!date) return null;
        if (typeof date === 'string') date = new Date(date);
        return date.toISOString();
    }
    
    // ============================================================================
    // CITY UTILITIES - Shared location detection and mapping
    // ============================================================================
    
    // Extract city from address string
    extractCityFromAddress(address) {
        if (!address || typeof address !== 'string') return null;
        
        const lowerAddress = address.toLowerCase();
        
        // First try exact matches in address
        for (const [patterns, city] of Object.entries(this.cityMappings)) {
            const patternList = patterns.split('|');
            for (const pattern of patternList) {
                // Use word boundaries to avoid substring matches (e.g., "la" in "Atlanta")
                const regex = new RegExp(`\\b${pattern.replace(/\s+/g, '\\s+')}\\b`, 'i');
                if (regex.test(lowerAddress)) {
                    return city;
                }
            }
        }
        
        // Try to extract city name from address components
        const addressParts = address.split(',').map(part => part.trim());
        if (addressParts.length >= 2) {
            const cityName = addressParts[1].toLowerCase(); // Usually city is second component
            
            // Check if the extracted city matches our mappings
            for (const [patterns, city] of Object.entries(this.cityMappings)) {
                const patternList = patterns.split('|');
                for (const pattern of patternList) {
                    // Use word boundaries to avoid substring matches
                    const regex = new RegExp(`\\b${pattern.replace(/\s+/g, '\\s+')}\\b`, 'i');
                    if (regex.test(cityName)) {
                        return city;
                    }
                }
            }
            
            // Return normalized city name if no mapping found
            return this.normalizeCityName(cityName);
        }
        
        return null;
    }
    
    // Extract city from text content (titles, descriptions, etc.)
    extractCityFromText(text) {
        if (!text || typeof text !== 'string') return null;
        
        const lowerText = text.toLowerCase();
        
        // Check each city mapping pattern
        for (const [patterns, city] of Object.entries(this.cityMappings)) {
            const patternList = patterns.split('|');
            for (const pattern of patternList) {
                // Use word boundaries for precise matching
                const regex = new RegExp(`\\b${pattern.replace(/\s+/g, '\\s+')}\\b`, 'i');
                if (regex.test(lowerText)) {
                    return city;
                }
            }
        }
        
        return null;
    }
    
    // Extract city from event data or URL
    extractCityFromEvent(eventData, url) {
        // Try venue address first
        if (eventData.venue?.address) {
            const address = eventData.venue.address;
            const cityFromAddress = address.city || address.localized_area_display || '';
            if (cityFromAddress) {
                return this.normalizeCityName(cityFromAddress);
            }
        }
        
        // Try extracting from text
        const searchText = `${eventData.name || ''} ${eventData.description || ''} ${url || ''}`;
        return this.extractCityFromText(searchText);
    }
    
    // Normalize city name to lowercase, handle common variations
    normalizeCityName(cityName) {
        if (!cityName || typeof cityName !== 'string') return null;
        
        const normalized = cityName.toLowerCase().trim();
        
        // Check if normalized name matches any of our mappings
        for (const [patterns, city] of Object.entries(this.cityMappings)) {
            const patternList = patterns.split('|');
            if (patternList.includes(normalized)) {
                return city;
            }
        }
        
        // Return as-is if no mapping found
        return normalized;
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SharedCore };
} else if (typeof window !== 'undefined') {
    window.SharedCore = SharedCore;
} else {
    // Scriptable environment
    this.SharedCore = SharedCore;
}
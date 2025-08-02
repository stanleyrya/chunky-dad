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
            errors: [],
            parserResults: [],
            allProcessedEvents: [] // All events ready for calendar
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
                
                // Collect all processed events
                if (parserResult.events && parserResult.events.length > 0) {
                    // Add parser config reference to each event for later use
                    parserResult.events.forEach(event => {
                        event._parserConfig = parserConfig;
                    });
                    results.allProcessedEvents.push(...parserResult.events);
                }
                
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

        await displayAdapter.logInfo(`SYSTEM: Event processing complete. Total: ${results.totalEvents}, Bear: ${results.bearEvents}`);
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

                // Process additional URLs if required (for enriching existing events, not creating new ones)
                if (parserConfig.requireDetailPages && parseResult.additionalLinks) {
                    await displayAdapter.logInfo(`SYSTEM: Processing ${parseResult.additionalLinks.length} additional URLs for detail pages...`);
                    await this.enrichEventsWithDetailPages(
                        allEvents,
                        parseResult.additionalLinks, 
                        parser, 
                        parserConfig, 
                        httpAdapter, 
                        displayAdapter,
                        processedUrls
                    );
                    await displayAdapter.logSuccess(`SYSTEM: Enriched ${allEvents.length} events with detail page information`);
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

        // Apply metadata overrides if configured
        if (parserConfig.metadata && parserConfig.metadata.overrideTitle) {
            await displayAdapter.logInfo('SYSTEM: Applying metadata overrides...');
            this.applyMetadataOverrides(allEvents, parserConfig.metadata);
            await displayAdapter.logInfo(`SYSTEM: Applied metadata overrides to ${allEvents.length} events`);
        }

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

        await displayAdapter.logSuccess(`SYSTEM: ${parserConfig.name}: ${deduplicatedEvents.length} bear events found`);

        return {
            name: parserConfig.name,
            totalEvents: allEvents.length,
            bearEvents: deduplicatedEvents.length,
            events: deduplicatedEvents,
            config: parserConfig // Include config for orchestrator to use
        };
    }

    async enrichEventsWithDetailPages(existingEvents, additionalLinks, parser, parserConfig, httpAdapter, displayAdapter, processedUrls) {
        const maxUrls = parserConfig.maxAdditionalUrls || 12;
        const urlsToProcess = additionalLinks.slice(0, maxUrls);

        await displayAdapter.logInfo(`SYSTEM: Processing ${urlsToProcess.length} additional URLs for event enrichment`);

        for (const url of urlsToProcess) {
            if (processedUrls.has(url)) continue;
            processedUrls.add(url);

            try {
                const htmlData = await httpAdapter.fetchData(url);
                const parseResult = parser.parseEvents(htmlData, parserConfig);
                
                // Instead of adding new events, use detail page data to enrich existing events
                if (parseResult.events && parseResult.events.length > 0) {
                    const detailEvent = parseResult.events[0]; // Detail pages should only have one event
                    
                    // Find the matching existing event by URL
                    const matchingEvent = existingEvents.find(event => 
                        event.url === detailEvent.url || 
                        event.url === url ||
                        (event.title && detailEvent.title && event.title.trim() === detailEvent.title.trim())
                    );
                    
                    if (matchingEvent) {
                        // Enrich the existing event with additional details from the detail page
                        Object.keys(detailEvent).forEach(key => {
                            // Only update if the existing event doesn't have this property or it's empty/null
                            if (!matchingEvent[key] || matchingEvent[key] === '' || matchingEvent[key] === null) {
                                matchingEvent[key] = detailEvent[key];
                            }
                        });
                        await displayAdapter.logInfo(`SYSTEM: Enriched event "${matchingEvent.title}" with detail page data`);
                    } else {
                        await displayAdapter.logWarn(`SYSTEM: Could not match detail page ${url} to existing event`);
                    }
                }
            } catch (error) {
                await displayAdapter.logWarn(`SYSTEM: Failed to process detail page URL: ${url}`);
            }
        }
    }

    // Legacy method kept for backward compatibility (but not used for detail pages anymore)
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

    // Apply metadata overrides to events (for hardcoded titles, etc.)
    applyMetadataOverrides(events, metadata) {
        if (!metadata || !events) return;
        
        events.forEach(event => {
            // Store original title for debugging if we're overriding
            if (metadata.overrideTitle && metadata.title && event.title !== metadata.title) {
                event.originalTitle = event.title;
                event.title = metadata.title;
                console.log(`🔄 SharedCore: Override title applied - Original: "${event.originalTitle}" → New: "${event.title}"`);
            }
            
            // Apply short title if provided
            if (metadata.shortTitle) {
                event.shortTitle = metadata.shortTitle;
            }
            
            // Apply other metadata properties
            if (metadata.instagram) {
                event.instagram = metadata.instagram;
            }
            
            // Add any other metadata properties that might be useful
            Object.keys(metadata).forEach(key => {
                if (!['overrideTitle', 'title', 'shortTitle'].includes(key)) {
                    event[key] = metadata[key];
                }
            });
        });
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
            
            // Set the key on the event for later use
            event.key = key;
            
            if (!seen.has(key)) {
                seen.set(key, event);
                deduplicated.push(event);
            } else {
                // Merge with existing event if needed
                const existing = seen.get(key);
                const merged = this.mergeEvents(existing, event);
                merged.key = key; // Ensure merged event has the key
                seen.set(key, merged);
                
                // Update in deduplicated array
                const index = deduplicated.findIndex(e => e.key === key);
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
            console.log(`🔍 DEBUG: event.title type: ${typeof event.title}, value: ${JSON.stringify(event.title)}`);
            console.log(`🔍 DEBUG: Full event object:`, JSON.stringify(event, null, 2));
        }
        
        // Use original title if available (before metadata override), otherwise use current title
        let title = String(event.originalTitle || event.title || '').toLowerCase().trim();
        const wasOverridden = event.originalTitle && event.originalTitle !== event.title;
        
        if (wasOverridden) {
            console.log(`🔄 SharedCore: Using original title for deduplication: "${event.title}" → "${title}"`);
        }
        
        // Normalize Megawoof/DURO event titles for better deduplication
        // Convert variations like "D>U>R>O!", "DURO", "D U R O" to a standard form
        if (/d[\s\>\-]*u[\s\>\-]*r[\s\>\-]*o/i.test(title) || /megawoof/i.test(title)) {
            const originalTitle = title;
            // Extract the core event identifier (DURO) and normalize it
            const duroMatch = title.match(/d[\s\>\-]*u[\s\>\-]*r[\s\>\-]*o/i);
            if (duroMatch) {
                title = title.replace(/d[\s\>\-]*u[\s\>\-]*r[\s\>\-]*o[^\w]*/i, 'megawoof-duro');
            } else if (/megawoof/i.test(title)) {
                title = title.replace(/megawoof[:\s\-]*/i, 'megawoof-');
            }
            console.log(`🔄 SharedCore: Normalized Megawoof title for deduplication: "${originalTitle}" → "${title}"`);
        }
        
        const date = this.normalizeEventDate(event.startDate);
        const venue = String(event.venue || '').toLowerCase().trim();
        
        const key = `${title}|${date}|${venue}`;
        console.log(`🔄 SharedCore: Created event key: "${key}" for event "${event.title}"`);
        
        return key;
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

    // Helper method to normalize event dates for consistent comparison across timezones
    normalizeEventDate(dateInput) {
        if (!dateInput) return '';
        
        try {
            const date = new Date(dateInput);
            if (isNaN(date.getTime())) return '';
            
            // Use a consistent date format that ignores time zone differences
            // This uses the local date components to create a date string
            // that will be the same regardless of the device's timezone
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            
            return `${year}-${month}-${day}`;
        } catch (error) {
            console.log(`🔄 SharedCore: Warning - Failed to normalize date: ${dateInput}, error: ${error.message}`);
            return '';
        }
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

    // Check if two events should be merged based on key similarity
    shouldMergeEvents(event1, event2) {
        const key1 = this.createEventKey(event1);
        const key2 = this.createEventKey(event2);
        return key1 === key2;
    }
    
    // Format event for calendar integration
    formatEventForCalendar(event) {
        const calendarEvent = {
            title: event.title || event.name || 'Untitled Event',
            startDate: event.startDate,
            endDate: event.endDate || event.startDate,
            location: this.formatLocationForCalendar(event),
            notes: this.formatEventNotes(event),
            // Don't use url field - it goes in notes instead
            city: event.city || 'default', // Include city for calendar selection
            key: event.key, // Key should already be set during deduplication
            _parserConfig: event._parserConfig, // Preserve parser config
            _fieldMergeStrategies: event._fieldMergeStrategies // Preserve field strategies
        };
        
        // Copy over all other fields that might have merge strategies
        Object.keys(event).forEach(key => {
            if (!key.startsWith('_') && !(key in calendarEvent)) {
                calendarEvent[key] = event[key];
            }
        });
        
        return calendarEvent;
    }
    
    // Format location for calendar (GPS coordinates only)
    formatLocationForCalendar(event) {
        if (event.coordinates && event.coordinates.lat && event.coordinates.lng) {
            return `${event.coordinates.lat}, ${event.coordinates.lng}`;
        }
        return ''; // Never use bar name in location field
    }
    
    // Format event notes with all metadata in key-value format
    formatEventNotes(event) {
        const notes = [];
        
        // Add bar/venue name first if available
        if (event.venue || event.bar) {
            notes.push(`Bar: ${event.venue || event.bar}`);
        }
        
        // Add description/tea in key-value format
        if (event.description || event.tea) {
            notes.push(`Description: ${event.description || event.tea}`);
        }
        
        // Add event key if available (for merging logic)
        if (event.key) {
            notes.push(`Key: ${event.key}`);
        }
        
        // Add city (renamed to debugCity)
        if (event.city) {
            notes.push(`DebugCity: ${event.city}`);
        }
        
        // Add source (renamed to debugSource)
        if (event.source) {
            notes.push(`DebugSource: ${event.source}`);
        }
        
        // Add social media links
        if (event.instagram) {
            notes.push(`Instagram: ${event.instagram}`);
        }
        
        if (event.facebook) {
            notes.push(`Facebook: ${event.facebook}`);
        }
        
        // Add website URL - prefer event.website, fallback to event.url
        if (event.website || event.url) {
            notes.push(`Website: ${event.website || event.url}`);
        }
        
        // Handle both gmaps and googleMapsLink fields
        if (event.gmaps || event.googleMapsLink) {
            notes.push(`Gmaps: ${event.gmaps || event.googleMapsLink}`);
        }
        
        // Add price/cover
        if (event.price || event.cover) {
            notes.push(`Price: ${event.price || event.cover}`);
        }
        
        // Add recurrence info
        if (event.recurring && event.recurrence) {
            notes.push(`Recurrence: ${event.recurrence}`);
        }
        
        // Add event type
        if (event.eventType) {
            notes.push(`Type: ${event.eventType}`);
        }
        
        // Add timezone if different from device
        if (event.timezone) {
            notes.push(`Timezone: ${event.timezone}`);
        }
        
        // Add short names if available - using the keys that calendar-core.js expects
        if (event.shortName) {
            notes.push(`Short Name: ${event.shortName}`);
        }
        
        if (event.shorterName) {
            notes.push(`Shorter Name: ${event.shorterName}`);
        }
        
        // Add shortTitle as Short Name (which calendar-core.js understands)
        if (event.shortTitle && !event.shortName) {
            notes.push(`Short Name: ${event.shortTitle}`);
        }
        
        // Add image URL if available
        if (event.image || event.imageUrl) {
            notes.push(`Image: ${event.image || event.imageUrl}`);
        }
        
        // Add any additional custom metadata fields that aren't already handled
        const handledFields = new Set([
            'title', 'description', 'tea', 'startDate', 'endDate', 'venue', 'bar', 
            'location', 'address', 'coordinates', 'city', 'source', 'key', 
            'instagram', 'facebook', 'website', 'gmaps', 'googleMapsLink', 
            'price', 'cover', 'recurring', 'recurrence', 'eventType', 'timezone', 
            'url', 'isBearEvent', 'setDescription', '_analysis', '_action', 
            '_existingEvent', '_existingKey', '_conflicts', '_parserConfig', '_fieldMergeStrategies',
            'shortName', 'shorterName', 'shortTitle', 'image', 'imageUrl'
        ]);
        
        // Add any custom fields from metadata
        Object.keys(event).forEach(key => {
            if (!handledFields.has(key) && event[key] !== undefined && event[key] !== null && event[key] !== '') {
                // Format the key nicely (capitalize first letter)
                const formattedKey = key.charAt(0).toUpperCase() + key.slice(1);
                notes.push(`${formattedKey}: ${event[key]}`);
            }
        });
        
        return notes.join('\n');
    }
    
    // Get event date ranges with optional expansion
    getEventDateRange(event, expandRange = false) {
        const startDate = new Date(event.startDate);
        const endDate = new Date(event.endDate || event.startDate);
        
        if (expandRange) {
            const searchStart = new Date(startDate);
            searchStart.setHours(0, 0, 0, 0);
            const searchEnd = new Date(endDate);
            searchEnd.setHours(23, 59, 59, 999);
            return { startDate, endDate, searchStart, searchEnd };
        }
        
        return { startDate, endDate };
    }

    // Prepare events for calendar integration with conflict analysis
    async prepareEventsForCalendar(events, calendarAdapter, config = {}) {
        const preparedEvents = events.map(event => this.formatEventForCalendar(event));
        
        // Analyze each event against existing calendar events
        const analyzedEvents = [];
        
        for (const event of preparedEvents) {
            // Get merge mode from parser config if available, otherwise use global default
            const mergeMode = event._parserConfig?.mergeMode || config.mergeMode || 'upsert';
            
            // Get existing events from the adapter
            const existingEvents = await calendarAdapter.getExistingEvents(event);
            
            // Analyze what action to take
            const analysis = this.analyzeEventAction(event, existingEvents, mergeMode);
            
            // Add analysis to event
            event._analysis = analysis;
            event._action = analysis.action;
            if (analysis.existingEvent) {
                event._existingEvent = analysis.existingEvent;
            }
            if (analysis.existingKey) {
                event._existingKey = analysis.existingKey;
            }
            if (analysis.conflicts) {
                event._conflicts = analysis.conflicts;
            }
            
            analyzedEvents.push(event);
        }
        
        return analyzedEvents;
    }
    
    // Analyze events against existing calendar events and determine actions
    // This is pure business logic - adapters provide the existing events data
    analyzeEventActions(newEvents, existingEventsData) {
        const actions = {
            newEvents: [],
            updateEvents: [],
            mergeEvents: [],
            conflictEvents: []
        };
        
        for (const event of newEvents) {
            const analysis = this.analyzeEventAction(event, existingEventsData);
            
            switch (analysis.action) {
                case 'new':
                    actions.newEvents.push({ event, analysis });
                    break;
                case 'update':
                    actions.updateEvents.push({ event, analysis });
                    break;
                case 'merge':
                    actions.mergeEvents.push({ event, analysis });
                    break;
                case 'conflict':
                    actions.conflictEvents.push({ event, analysis });
                    break;
            }
        }
        
        return actions;
    }
    
    // Analyze a single event against existing events
    analyzeEventAction(event, existingEventsData, mergeMode = 'upsert') {
        if (!existingEventsData || existingEventsData.length === 0) {
            return { action: 'new', reason: 'No existing events found' };
        }
        
        // Check for key-based merging first
        const keyBasedMatch = this.findEventByKey(existingEventsData, event.key);
        
        if (keyBasedMatch) {
            const existingKey = this.extractKeyFromNotes(keyBasedMatch.notes);
            if (existingKey === event.key) {
                // In clobber mode, we update instead of merge
                return {
                    action: mergeMode === 'clobber' ? 'update' : 'merge',
                    reason: 'Key match found',
                    existingEvent: keyBasedMatch,
                    existingKey: existingKey
                };
            } else if (existingKey && existingKey !== event.key) {
                return {
                    action: 'conflict',
                    reason: 'Key conflict detected',
                    conflictType: 'key_conflict',
                    existingEvent: keyBasedMatch,
                    existingKey: existingKey
                };
            }
        }
        
        // Check for exact duplicates
        const exactMatch = existingEventsData.find(existing => 
            existing.title === event.title &&
            this.areDatesEqual(existing.startDate, new Date(event.startDate), 1)
        );
        
        if (exactMatch) {
            return {
                action: 'update',
                reason: 'Exact duplicate found',
                existingEvent: exactMatch
            };
        }
        
        // Check for time conflicts that can be merged
        const timeConflicts = existingEventsData.filter(existing => 
            this.doDatesOverlap(existing.startDate, existing.endDate, 
                               new Date(event.startDate), new Date(event.endDate || event.startDate))
        );
        
        if (timeConflicts.length > 0) {
            // Check if these are mergeable conflicts (adding info to existing events)
            const mergeableConflict = timeConflicts.find(existing => 
                existing.title === event.title || 
                (existing.location === (event.venue || event.bar) && 
                 this.areDatesEqual(existing.startDate, new Date(event.startDate), 60))
            );
            
            if (mergeableConflict) {
                // In clobber mode, we update instead of merge
                return {
                    action: mergeMode === 'clobber' ? 'update' : 'merge',
                    reason: 'Mergeable time conflict',
                    existingEvent: mergeableConflict
                };
            } else {
                return {
                    action: 'conflict',
                    reason: 'Time conflict detected',
                    conflictType: 'time_conflict',
                    conflicts: timeConflicts
                };
            }
        }
        
        return { action: 'new', reason: 'No conflicts found' };
    }
    
    // Find event by key in existing events (pure logic, no calendar APIs)
    findEventByKey(existingEvents, targetKey) {
        if (!targetKey) return null;
        
        for (const event of existingEvents) {
            const eventKey = this.extractKeyFromNotes(event.notes);
            if (eventKey === targetKey) {
                return event;
            }
        }
        return null;
    }
    
    // Extract key from event notes (pure string processing)
    extractKeyFromNotes(notes) {
        if (!notes) return null;
        
        const keyMatch = notes.match(/^Key: (.+)$/m);
        return keyMatch ? keyMatch[1] : null;
    }
    
    // Check if two dates are equal within a tolerance (pure logic)
    areDatesEqual(date1, date2, toleranceMinutes) {
        const diff = Math.abs(date1.getTime() - date2.getTime());
        return diff <= (toleranceMinutes * 60 * 1000);
    }
    
    // Check if two date ranges overlap (pure logic)
    doDatesOverlap(start1, end1, start2, end2) {
        return start1 < end2 && end1 > start2;
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
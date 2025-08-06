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
                    // Apply field merge strategies to filter out fields that should be preserved
                    const filteredEvents = parseResult.events.map(event => 
                        this.applyFieldMergeStrategies(event, parserConfig)
                    );
                    
                    // Enrich events with location data (Google Maps links, city extraction)
                    const enrichedEvents = filteredEvents.map(event => this.enrichEventLocation(event));
                    
                    allEvents.push(...enrichedEvents);
                    await displayAdapter.logSuccess(`SYSTEM: Added ${enrichedEvents.length} enriched events from ${url}`);
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

        // Metadata is applied dynamically by parsers using the {value, merge} format

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
                    // Apply field merge strategies before using detail event
                    const filteredEvents = parseResult.events.map(event => 
                        this.applyFieldMergeStrategies(event, parserConfig)
                    );
                    const detailEvent = filteredEvents[0]; // Detail pages should only have one event
                    
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
                        
                        // Re-enrich location data since we may have new address/venue info
                        this.enrichEventLocation(matchingEvent);
                        
                        await displayAdapter.logInfo(`SYSTEM: Enriched event "${matchingEvent.title}" with detail page data and location info`);
                    } else {
                        await displayAdapter.logWarn(`SYSTEM: Could not match detail page ${url} to existing event`);
                    }
                }
            } catch (error) {
                await displayAdapter.logWarn(`SYSTEM: Failed to process detail page URL: ${url}`);
            }
        }
    }



    // Pure utility functions
    filterFutureEvents(events, daysToLookAhead = null) {
        const now = new Date();
        const cutoffDate = daysToLookAhead ? 
            new Date(now.getTime() + (daysToLookAhead * 24 * 60 * 60 * 1000)) : 
            null;

        return events.filter(event => {
            if (!event.startDate) return false;
            
            const eventDate = event.startDate;
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
                const merged = this.mergeEventData(existing, event);
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
        
        // Generic text normalization for better deduplication
        // This handles titles with special characters, spacing variations, etc.
        const originalTitle = title;
        
        // Normalize text patterns with special characters between letters
        // Examples: "D>U>R>O!", "A-B-C", "X Y Z" -> normalized forms
        title = title
            // Replace sequences of special chars between letters with a single hyphen
            .replace(/([a-z])[\s\>\<\-\.\,\!\@\#\$\%\^\&\*\(\)\_\+\=\{\}\[\]\|\\\:\;\"\'\?\/]+([a-z])/gi, '$1-$2')
            // Remove trailing special characters after words
            .replace(/([a-z])[\!\@\#\$\%\^\&\*\(\)\_\+\=\{\}\[\]\|\\\:\;\"\'\?\,\.]+(?=\s|$)/gi, '$1')
            // Collapse multiple spaces/hyphens into single hyphen
            .replace(/[\s\-]+/g, '-')
            // Remove leading/trailing hyphens
            .replace(/^-+|-+$/g, '');
        
        if (title !== originalTitle) {
            console.log(`🔄 SharedCore: Normalized title for deduplication: "${originalTitle}" → "${title}"`);
        }
        
        const date = this.normalizeEventDate(event.startDate);
        const venue = String(event.venue || '').toLowerCase().trim();
        
        const key = `${title}|${date}|${venue}`;
        console.log(`🔄 SharedCore: Created event key: "${key}" for event "${event.title}"`);
        
        return key;
    }

    // Enhanced merge function that respects field-level merge strategies
    mergeEventData(existingEvent, newEvent) {
        const existingNotes = existingEvent.notes || '';
        const fieldStrategies = newEvent._fieldMergeStrategies || {};
        
        // Parse existing notes to extract current field values
        const existingFields = this.parseNotesIntoFields(existingNotes);
        
        // Build updated fields based on merge strategies
        const updatedFields = {};
        
        // First, preserve all existing fields
        Object.keys(existingFields).forEach(key => {
            updatedFields[key] = existingFields[key];
        });
        
        // Then apply new fields based on their merge strategies
        // Parse the new event's notes to get its fields
        const newEventNotes = newEvent.notes || '';
        const newFields = this.parseNotesIntoFields(newEventNotes);
        
        // Apply merge strategies for each field in the new event
        Object.keys(newFields).forEach(key => {
            const strategy = fieldStrategies[key] || 'preserve'; // Default to preserve
            
            switch (strategy) {
                case 'clobber':
                    // Always replace with new value
                    updatedFields[key] = newFields[key];
                    break;
                    
                case 'upsert':
                    // Add if missing, keep existing if present
                    if (!existingFields[key] && newFields[key]) {
                        updatedFields[key] = newFields[key];
                    }
                    break;
                    
                case 'preserve':
                default:
                    // Do nothing - keep existing value as is
                    // Don't add if missing, don't update if exists
                    break;
            }
        });
        
        // Rebuild notes from updated fields
        const notes = this.buildNotesFromFields(updatedFields);
        
        return {
            title: existingEvent.title, // Keep existing title unless clobbered
            notes: notes,
            url: existingEvent.url || newEvent.url
        };
    }
    
    // Parse notes back into field/value pairs
    parseNotesIntoFields(notes) {
        const fields = {};
        const lines = notes.split('\n');
        
        // Define field aliases for normalization
        // Maps various names to canonical field names
        const fieldAliases = {
            // Description aliases
            'tea': 'description',
            'info': 'description',
            
            // Venue/location aliases
            'bar': 'venue',
            'location': 'venue',
            'host': 'venue',
            
            // Price aliases
            'cover': 'price',
            'cost': 'price',
            
            // Name aliases
            'shortname': 'shortname',
            'short name': 'shortname',
            'shorter name': 'shortername',
            'shortername': 'shortername',
            'shorttitle': 'shorttitle',
            'short title': 'shorttitle',
            
            // Type aliases
            'type': 'eventtype',
            'event type': 'eventtype',
            
            // Social/web aliases
            'gmaps': 'gmaps',
            'google maps': 'gmaps',
            
            // Debug aliases (keep as-is but normalized)
            'debugcity': 'debugcity',
            'debugsource': 'debugsource',
            'debugtimezone': 'debugtimezone',
            'debugimage': 'debugimage'
        };
        
        lines.forEach(line => {
            const colonIndex = line.indexOf(':');
            // A valid metadata line has a colon that's not at the start
            if (colonIndex > 0) {
                const key = line.substring(0, colonIndex).trim();
                const value = line.substring(colonIndex + 1).trim();
                
                if (key && value) {
                    // Normalize key names - convert to lowercase and remove extra spaces
                    let normalizedKey = key.toLowerCase().trim();
                    
                    // Apply alias mapping if exists
                    if (fieldAliases[normalizedKey]) {
                        normalizedKey = fieldAliases[normalizedKey];
                    } else {
                        // For unrecognized keys, just remove spaces
                        normalizedKey = normalizedKey.replace(/\s+/g, '');
                    }
                    
                    fields[normalizedKey] = value;
                }
            }
        });
        
        return fields;
    }
    
    // Build notes from field/value pairs
    buildNotesFromFields(fields) {
        const lines = [];
        
        // Just add all fields that have values
        Object.keys(fields).forEach(key => {
            const value = fields[key];
            if (value !== undefined && value !== null && value !== '') {
                lines.push(`${key}: ${value}`);
            }
        });
        
        return lines.join('\n');
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
    // EVENT ENRICHMENT - Add Google Maps links, validate addresses, extract cities
    // ============================================================================
    
    // Enrich event with Google Maps links and city information
    enrichEventLocation(event) {
        if (!event) return event;
        
        // Extract city if not already present (parser may have set it for venue-specific logic)
        if (!event.city) {
            event.city = this.extractCityFromEvent(event);
        }
        
        // Add Google Maps link - prefer address over coordinates
        if (event.address && this.isFullAddress(event.address)) {
            // Use address when available and it's a full address
            event.googleMapsLink = `https://maps.google.com/?q=${encodeURIComponent(event.address)}`;
        } else if (event.coordinates && event.coordinates.lat && event.coordinates.lng) {
            // Fall back to coordinates if no full address
            event.googleMapsLink = `https://maps.google.com/?q=${event.coordinates.lat},${event.coordinates.lng}`;
        }
        
        return event;
    }
    

    
    // ============================================================================
    // CITY UTILITIES - Shared location detection and mapping
    // ============================================================================
    
    // Check if an address is a full address (not just a city or region)
    isFullAddress(address) {
        if (!address || typeof address !== 'string') return false;
        
        // Clean up the address
        const cleanAddress = address.trim();
        if (cleanAddress.length < 10) return false; // Too short to be a full address
        
        // Check for TBA or similar placeholder values
        if (/^(TBA|TBD|To Be Announced|To Be Determined)$/i.test(cleanAddress)) {
            return false;
        }
        
        // Check for partial addresses that are just area/neighborhood + city + zip
        // Examples: "DTLA Los Angeles, CA 90013", "Downtown Denver, CO 80202"
        const partialAddressPatterns = [
            /^(DTLA|Downtown|Midtown|Uptown|North|South|East|West|Central)\s+[A-Za-z\s]+,\s*[A-Z]{2}\s*\d{5}$/i,
            /^[A-Za-z\s]+\s+(District|Area|Zone|Neighborhood)\s*,?\s*[A-Za-z\s]+,\s*[A-Z]{2}\s*\d{5}$/i
        ];
        
        // If it matches a partial address pattern, it's not a full address
        if (partialAddressPatterns.some(pattern => pattern.test(cleanAddress))) {
            return false;
        }
        
        // Check for common full address patterns
        const fullAddressPatterns = [
            /\d+\s+\w+.*street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|way|place|pl|court|ct/i,
            /\d+\s+\w+.*\s+\w+/i, // Number + words (likely street address)
            /\w+.*,\s*\w+.*,\s*\w+/i // Multiple comma-separated components
        ];
        
        // Must contain at least one full address pattern
        const hasAddressPattern = fullAddressPatterns.some(pattern => pattern.test(cleanAddress));
        if (!hasAddressPattern) return false;
        
        // Check if it's just a city name (common city patterns to exclude)
        const cityOnlyPatterns = [
            /^(new york|nyc|los angeles|san francisco|chicago|atlanta|miami|seattle|portland|denver|las vegas|vegas|boston|philadelphia|austin|dallas|houston|phoenix|toronto|london|berlin|palm springs)$/i,
            /^[a-z\s]{3,25}$/i // Simple city name pattern (3-25 characters, letters and spaces only)
        ];
        
        // If it matches a city-only pattern and has no numbers/street indicators, it's not a full address
        const isCityOnly = cityOnlyPatterns.some(pattern => pattern.test(cleanAddress)) && 
                          !/\d/.test(cleanAddress) && 
                          !/street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|way|place|pl|court|ct/i.test(cleanAddress);
        
        return !isCityOnly;
    }
    
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
        
        // Try address field
        if (eventData.address) {
            const cityFromAddress = this.extractCityFromAddress(eventData.address);
            if (cityFromAddress) {
                return cityFromAddress;
            }
        }
        
        // Try extracting from text content
        const searchText = `${eventData.title || eventData.name || ''} ${eventData.description || ''} ${eventData.venue || ''} ${url || ''}`;
        const cityFromText = this.extractCityFromText(searchText);
        if (cityFromText) {
            return cityFromText;
        }
        

        
        return null;
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
    
    // Apply field-level merge strategies to filter out fields that should be preserved
    // This prevents parsers from including fields that should be kept from existing events
    applyFieldMergeStrategies(event, parserConfig) {
        // Always attach parser config
        event._parserConfig = parserConfig;
        
        // Attach field merge strategies if metadata is configured
        if (parserConfig?.metadata) {
            Object.keys(parserConfig.metadata).forEach(key => {
                const metaValue = parserConfig.metadata[key];
                if (typeof metaValue === 'object' && metaValue !== null && 'merge' in metaValue) {
                    if (!event._fieldMergeStrategies) {
                        event._fieldMergeStrategies = {};
                    }
                    event._fieldMergeStrategies[key] = metaValue.merge || 'preserve';
                }
            });
        }
        
        // Return the event with all fields intact
        // The actual merge logic will be handled later based on the strategies
        return event;
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
        const fieldStrategies = event._fieldMergeStrategies || {};
        
        // Helper function to check if a field should be included
        const shouldIncludeField = (fieldName) => {
            const strategy = fieldStrategies[fieldName];
            // Only include if not "preserve" or if it's a new event
            return strategy !== 'preserve' || event._action === 'new';
        };
        
        // Fields to exclude from notes
        const excludeFields = new Set([
            'title', 'startDate', 'endDate', 'location', 'address', 'coordinates',
            'isBearEvent', 'setDescription', '_analysis', '_action', 
            '_existingEvent', '_existingKey', '_conflicts', '_parserConfig', '_fieldMergeStrategies',
            'originalTitle', 'name' // These are usually duplicates of title
        ]);
        
        // Add all fields that have values
        Object.keys(event).forEach(fieldName => {
            if (!excludeFields.has(fieldName) && 
                event[fieldName] !== undefined && 
                event[fieldName] !== null && 
                event[fieldName] !== '') {
                if (shouldIncludeField(fieldName)) {
                    notes.push(`${fieldName}: ${event[fieldName]}`);
                }
            }
        });
        
        return notes.join('\n');
    }
    
    // Get event date ranges with optional expansion
    getEventDateRange(event, expandRange = false) {
        const startDate = event.startDate;
        const endDate = event.endDate || event.startDate;
        
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
            
            // Create a new object with all properties to avoid readonly errors
            let analyzedEvent = { ...event };
            
            // Add analysis to the new event object
            analyzedEvent._analysis = {
                action: analysis.action,
                reason: analysis.reason
            };
            analyzedEvent._action = analysis.action;
            
            // Handle merge action by performing the merge here
            if (analysis.action === 'merge' && analysis.existingEvent) {
                // Perform the merge and store the result
                const mergedData = this.mergeEventData(analysis.existingEvent, event);
                
                // Store merge information for the adapter
                analyzedEvent._mergedNotes = mergedData.notes;
                analyzedEvent._mergedUrl = mergedData.url;
                analyzedEvent._existingEvent = analysis.existingEvent;
                
                // Store original data for comparison display
                analyzedEvent._original = {
                    new: { ...event },
                    existing: analysis.existingEvent
                };
                
                // Calculate merge diff for display purposes
                const originalFields = this.parseNotesIntoFields(analysis.existingEvent.notes || '');
                const mergedFields = this.parseNotesIntoFields(mergedData.notes);
                
                analyzedEvent._mergeDiff = {
                    preserved: [],
                    added: [],
                    updated: [],
                    removed: []
                };
                
                // Analyze what changed
                Object.keys(originalFields).forEach(key => {
                    if (mergedFields[key] === originalFields[key]) {
                        analyzedEvent._mergeDiff.preserved.push(key);
                    } else if (!mergedFields[key]) {
                        analyzedEvent._mergeDiff.removed.push({ key, value: originalFields[key] });
                    } else {
                        analyzedEvent._mergeDiff.updated.push({ 
                            key, 
                            from: originalFields[key], 
                            to: mergedFields[key] 
                        });
                    }
                });
                
                // Check for added fields
                Object.keys(mergedFields).forEach(key => {
                    if (!originalFields[key]) {
                        analyzedEvent._mergeDiff.added.push({ key, value: mergedFields[key] });
                    }
                });
            } else if (analysis.existingEvent) {
                analyzedEvent._existingEvent = analysis.existingEvent;
            }
            
            if (analysis.existingKey) {
                analyzedEvent._existingKey = analysis.existingKey;
            }
            if (analysis.conflicts) {
                analyzedEvent._conflicts = analysis.conflicts;
                // Process conflicts to extract important information
                analyzedEvent = this.processEventWithConflicts(analyzedEvent);
            }
            
            analyzedEvents.push(analyzedEvent);
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
            const existingFields = this.parseNotesIntoFields(keyBasedMatch.notes || '');
            const existingKey = existingFields.key || null;
            if (existingKey === event.key) {
                return {
                    action: 'merge',
                    reason: 'Key match found',
                    existingEvent: keyBasedMatch,
                    existingKey: existingKey
                };
            } else if (existingKey && existingKey !== event.key) {
                return {
                    action: 'conflict',
                    reason: 'Key conflict detected',
                    existingEvent: keyBasedMatch,
                    existingKey: existingKey
                };
            }
        }
        
        // Check for exact or similar duplicates
        const exactMatch = existingEventsData.find(existing => 
            this.areTitlesSimilar(existing.title, event.title) &&
            this.areDatesEqual(existing.startDate, event.startDate, 1)
        );
        
        if (exactMatch) {
            return {
                action: 'merge',
                reason: 'Similar event found',
                existingEvent: exactMatch
            };
        }
        
        // Check for time conflicts that can be merged
        const timeConflicts = existingEventsData.filter(existing => 
            this.doDatesOverlap(existing.startDate, existing.endDate, 
                               event.startDate, event.endDate || event.startDate)
        );
        
        if (timeConflicts.length > 0) {
            // Check if these are mergeable conflicts (adding info to existing events)
            const mergeableConflict = timeConflicts.find(existing => 
                this.areTitlesSimilar(existing.title, event.title) || 
                (existing.location === (event.venue || event.bar) && 
                 this.areDatesEqual(existing.startDate, event.startDate, 60))
            );
            
            if (mergeableConflict) {
                return {
                    action: 'merge',
                    reason: 'Mergeable time conflict',
                    existingEvent: mergeableConflict
                };
            } else {
                return {
                    action: 'conflict',
                    reason: 'Time conflict detected',
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
            const fields = this.parseNotesIntoFields(event.notes || '');
            const eventKey = fields.key || null;
            if (eventKey === targetKey) {
                return event;
            }
        }
        return null;
    }
    

    // Check if two dates are equal within a tolerance (pure logic)
    areDatesEqual(date1, date2, toleranceMinutes) {
        // Convert to Date objects if they're strings
        const d1 = typeof date1 === 'string' ? new Date(date1) : date1;
        const d2 = typeof date2 === 'string' ? new Date(date2) : date2;
        
        // Check if both are valid dates
        if (!d1 || !d2 || isNaN(d1.getTime()) || isNaN(d2.getTime())) {
            return false;
        }
        
        const diff = Math.abs(d1.getTime() - d2.getTime());
        return diff <= (toleranceMinutes * 60 * 1000);
    }
    
    // Check if two date ranges overlap (pure logic)
    doDatesOverlap(start1, end1, start2, end2) {
        // Convert to Date objects if they're strings
        const s1 = typeof start1 === 'string' ? new Date(start1) : start1;
        const e1 = typeof end1 === 'string' ? new Date(end1) : end1;
        const s2 = typeof start2 === 'string' ? new Date(start2) : start2;
        const e2 = typeof end2 === 'string' ? new Date(end2) : end2;
        
        // Check if all are valid dates
        if (!s1 || !e1 || !s2 || !e2 || 
            isNaN(s1.getTime()) || isNaN(e1.getTime()) || 
            isNaN(s2.getTime()) || isNaN(e2.getTime())) {
            return false;
        }
        
        return s1 < e2 && e1 > s2;
    }
    
    // Fuzzy title matching to handle variations
    areTitlesSimilar(title1, title2) {
        if (!title1 || !title2) return false;
        
        // Normalize titles for comparison
        const normalize = (str) => {
            return str
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '') // Remove special chars
                .replace(/\s+/g, ''); // Remove spaces
        };
        
        const norm1 = normalize(title1);
        const norm2 = normalize(title2);
        
        // Exact match after normalization
        if (norm1 === norm2) return true;
        
        // Check if one contains the other (handles "Megawoof" vs "Megawoof: DURO")
        if (norm1.includes(norm2) || norm2.includes(norm1)) return true;
        
        // Check for common event name patterns
        const extractEventName = (title) => {
            // Extract before colon or dash
            const match = title.match(/^([^:\-–—]+)/);
            return match ? normalize(match[1]) : normalize(title);
        };
        
        const eventName1 = extractEventName(title1);
        const eventName2 = extractEventName(title2);
        
        return eventName1 === eventName2;
    }
    

    // Process event with conflicts - extract and merge based on strategies
    processEventWithConflicts(event) {
        if (!event._conflicts || event._conflicts.length === 0) {
            return event;
        }
        
        // Store original event data before processing
        event._original = {
            new: { ...event },
            existing: event._conflicts[0] // Usually just one conflict
        };
        
        // Get merge strategies
        const mergeStrategies = event._fieldMergeStrategies || {};
        
        // Track what was merged and from where
        event._mergeInfo = {
            extractedFields: {},
            mergedFields: {},
            strategy: mergeStrategies
        };
        
        // Helper function to apply merge strategy
        const applyMergeStrategy = (fieldName, existingValue, newValue) => {
            const strategy = mergeStrategies[fieldName] || 'preserve';
            
            switch (strategy) {
                case 'preserve':
                    // Always use existing value if it exists
                    if (existingValue !== undefined && existingValue !== null && existingValue !== '') {
                        event[fieldName] = existingValue;
                        event._mergeInfo.mergedFields[fieldName] = 'existing';
                        return true;
                    }
                    break;
                    
                case 'upsert':
                    // Only add new value if existing doesn't have it
                    if (!existingValue && newValue) {
                        // Keep new value (do nothing as it's already in event)
                        event._mergeInfo.mergedFields[fieldName] = 'new';
                        return true;
                    } else if (existingValue) {
                        // Existing has value, keep it
                        event[fieldName] = existingValue;
                        event._mergeInfo.mergedFields[fieldName] = 'existing';
                        return true;
                    }
                    break;
                    
                case 'clobber':
                    // Use new value if it exists, otherwise keep existing
                    if (newValue !== undefined && newValue !== null && newValue !== '') {
                        // Keep new value (do nothing as it's already in event)
                        event._mergeInfo.mergedFields[fieldName] = 'new';
                        return true;
                    } else if (existingValue) {
                        event[fieldName] = existingValue;
                        event._mergeInfo.mergedFields[fieldName] = 'existing';
                        return true;
                    }
                    break;
            }
            
            return false;
        };
        
        // Process each conflict (usually the existing calendar event)
        event._conflicts.forEach(conflict => {
            // First, parse fields from existing event's notes
            const existingFieldsFromNotes = conflict.notes ? this.parseNotesIntoFields(conflict.notes) : {};
            
            // Process fields from notes
            Object.entries(existingFieldsFromNotes).forEach(([fieldName, value]) => {
                // Track extraction
                event._mergeInfo.extractedFields[fieldName] = {
                    value: value,
                    source: 'existing.notes'
                };
                
                // Apply merge strategy
                applyMergeStrategy(fieldName, value, event[fieldName]);
            });
            
            // Process direct fields from conflict object
            // Handle 'location' -> 'venue' mapping
            if (conflict.location && !existingFieldsFromNotes.venue) {
                applyMergeStrategy('venue', conflict.location, event.venue);
            }
            
            // Process other direct fields that might exist on conflict
            const directFields = ['title', 'description', 'startDate', 'endDate', 'recurrence', 'eventType', 'recurring'];
            directFields.forEach(fieldName => {
                if (conflict[fieldName] && !existingFieldsFromNotes[fieldName]) {
                    applyMergeStrategy(fieldName, conflict[fieldName], event[fieldName]);
                }
            });
        });
        
        return event;
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
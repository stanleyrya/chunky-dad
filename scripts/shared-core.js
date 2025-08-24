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
            'sitges': 'sitges',  // Sitges gets its own area
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
        
        // URL-to-parser mapping for automatic parser detection
        this.urlParserMappings = [
            {
                pattern: /eventbrite\.com/i,
                parser: 'eventbrite'
            },
            {
                pattern: /bearracuda\.com/i,
                parser: 'bearracuda'
            }
            // Generic parser will be used as fallback if no pattern matches
        ];
    }

    // Detect parser type from URL - allows automatic parser selection based on URL patterns
    // This enables configurations to omit the 'parser' field and have it auto-detected
    detectParserFromUrl(url) {
        if (!url) {
            return 'generic';
        }
        
        for (const mapping of this.urlParserMappings) {
            if (mapping.pattern.test(url)) {
                return mapping.parser;
            }
        }
        
        // Default to generic parser if no pattern matches
        return 'generic';
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
            
            // Check if parser is enabled (default to true if not specified)
            if (parserConfig.enabled === false) {
                await displayAdapter.logInfo(`SYSTEM: Skipping disabled parser: ${parserConfig.name}`);
                continue;
            }
            
            try {
                await displayAdapter.logInfo(`SYSTEM: Processing parser ${i + 1}/${config.parsers.length}: ${parserConfig.name}`);
                
                const parserResult = await this.processParser(parserConfig, config, httpAdapter, displayAdapter, parsers);
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

    async processParser(parserConfig, mainConfig, httpAdapter, displayAdapter, parsers) {
        let parserName = parserConfig.parser;
        
        // If no parser is explicitly configured, try to detect from the first URL
        if (!parserName && parserConfig.urls && parserConfig.urls.length > 0) {
            parserName = this.detectParserFromUrl(parserConfig.urls[0]);
            await displayAdapter.logInfo(`SYSTEM: No parser specified, detected '${parserName}' from URL: ${parserConfig.urls[0]}`);
        }
        
        // Fallback to generic parser if still no parser found
        if (!parserName) {
            parserName = 'generic';
            await displayAdapter.logInfo('SYSTEM: No parser specified and no URLs provided, using generic parser');
        }
        
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
                
                // Detect parser for this specific URL (allows mid-run switching)
                const urlParserName = this.detectParserFromUrl(url) || parserConfig.parser;
                const urlParser = parsers[urlParserName];
                
                if (urlParserName !== parserName) {
                    await displayAdapter.logInfo(`SYSTEM: Switching to ${urlParserName} parser for URL: ${url}`);
                }
                
                await displayAdapter.logInfo(`SYSTEM: Parsing events with ${urlParserName} parser...`);
                // Pass parser config and city config separately
                const parseResult = urlParser.parseEvents(htmlData, parserConfig, mainConfig?.cities || null);
                
                await displayAdapter.logInfo(`SYSTEM: Parse result: ${parseResult?.events?.length || 0} events found`);
                if (parseResult?.additionalLinks) {
                    await displayAdapter.logInfo(`SYSTEM: Additional links found: ${parseResult.additionalLinks.length}`);
                }
                
                if (parseResult.events) {
                    // Apply field priorities to determine which parser data to trust
                    const filteredEvents = parseResult.events.map(event => 
                        this.applyFieldPriorities(event, parserConfig, mainConfig)
                    );
                    
                    // Enrich events with location data (Google Maps links, city extraction)
                    const enrichedEvents = filteredEvents.map(event => this.enrichEventLocation(event));
                    
                    allEvents.push(...enrichedEvents);
                    await displayAdapter.logSuccess(`SYSTEM: Added ${enrichedEvents.length} enriched events from ${url}`);
                }

                // Process additional URLs if required (for enriching existing events, not creating new ones)
                if (parserConfig.requireDetailPages && parseResult.additionalLinks) {
                    await displayAdapter.logInfo(`SYSTEM: Processing ${parseResult.additionalLinks.length} additional URLs for detail pages...`);
                    
                    // Deduplicate additional URLs before processing
                    const deduplicatedUrls = this.deduplicateUrls(parseResult.additionalLinks, processedUrls);
                    await displayAdapter.logInfo(`SYSTEM: After deduplication: ${deduplicatedUrls.length} unique URLs to process`);
                    
                    await this.enrichEventsWithDetailPages(
                        allEvents,
                        deduplicatedUrls, 
                        parsers, 
                        parserConfig, 
                        httpAdapter, 
                        displayAdapter,
                        processedUrls,
                        undefined,
                        mainConfig
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

    async enrichEventsWithDetailPages(existingEvents, additionalLinks, parsers, parserConfig, httpAdapter, displayAdapter, processedUrls, currentDepth = 1, mainConfig = null) {
        const maxUrls = parserConfig.maxAdditionalUrls || 12;
        const urlsToProcess = additionalLinks.slice(0, maxUrls);
        const maxDepth = parserConfig.urlDiscoveryDepth || 1;

        await displayAdapter.logInfo(`SYSTEM: Processing ${urlsToProcess.length} additional URLs for event enrichment (depth: ${currentDepth}/${maxDepth})`);

        for (const url of urlsToProcess) {
            if (processedUrls.has(url)) {
                await displayAdapter.logInfo(`SYSTEM: Skipping already processed URL: ${url}`);
                continue;
            }

            processedUrls.add(url);

            try {
                const htmlData = await httpAdapter.fetchData(url);
                
                // Detect parser for this specific URL (allows mid-run switching)
                const urlParserName = this.detectParserFromUrl(url) || parserConfig.parser;
                const urlParser = parsers[urlParserName];
                
                // CRITICAL FIX: Look up the correct parser configuration for the detected parser type
                // This ensures secondary parsers (like eventbrite) get their proper merge strategies
                // when called from primary parsers (like bearracuda)
                let detailPageConfig = parserConfig; // Default fallback
                
                if (urlParserName !== parserConfig.parser && mainConfig?.parsers) {
                    // Find the configuration for the detected parser type
                    const matchingParserConfig = mainConfig.parsers.find(p => p.parser === urlParserName);
                    if (matchingParserConfig) {
                        await displayAdapter.logInfo(`SYSTEM: Using ${urlParserName} parser config for ${url} (switched from ${parserConfig.parser})`);
                        detailPageConfig = matchingParserConfig;
                    }
                }
                
                // Create a modified parser config that controls further URL discovery based on depth
                // If we're at max depth, disable further URL discovery entirely
                const shouldAllowMoreUrls = currentDepth < maxDepth;
                const finalDetailPageConfig = {
                    ...detailPageConfig,
                    requireDetailPages: shouldAllowMoreUrls,
                    maxAdditionalUrls: shouldAllowMoreUrls ? detailPageConfig.maxAdditionalUrls : 0
                };
                
                // Pass detail page config and city config separately
                const parseResult = urlParser.parseEvents(htmlData, finalDetailPageConfig, mainConfig?.cities || null);
                
                // Handle additional URLs if depth allows
                if (parseResult.additionalLinks && parseResult.additionalLinks.length > 0) {
                    if (shouldAllowMoreUrls) {
                        await displayAdapter.logInfo(`SYSTEM: Detail page ${url} found ${parseResult.additionalLinks.length} additional URLs (depth ${currentDepth + 1} allowed)`);
                        
                        // Deduplicate URLs before recursive processing
                        const deduplicatedUrls = this.deduplicateUrls(parseResult.additionalLinks, processedUrls);
                        await displayAdapter.logInfo(`SYSTEM: After deduplication: ${deduplicatedUrls.length} unique URLs for depth ${currentDepth + 1}`);
                        
                        // Recursively process additional URLs if we haven't reached max depth
                        if (deduplicatedUrls.length > 0) {
                            await this.enrichEventsWithDetailPages(
                                existingEvents,
                                deduplicatedUrls,
                                parsers,
                                finalDetailPageConfig, // Use the correct config for recursive calls too
                                httpAdapter,
                                displayAdapter,
                                processedUrls,
                                currentDepth + 1,
                                mainConfig
                            );
                        }
                    } else {
                        await displayAdapter.logInfo(`SYSTEM: Detail page ${url} found ${parseResult.additionalLinks.length} additional URLs, but depth limit (${maxDepth}) reached - ignoring to prevent recursion`);
                    }
                }
                
                // Process detail page events - either enrich existing or add new events
                if (parseResult.events && parseResult.events.length > 0) {
                    await displayAdapter.logSuccess(`SYSTEM: Added ${parseResult.events.length} new events from detail page ${url}`);
                    
                    // Apply field priorities to detail page events (same as main page events)
                    const enrichedDetailEvents = parseResult.events.map(event => 
                        this.applyFieldPriorities(event, parserConfig, mainConfig)
                    );
                    
                    // Add these events to the existing events collection for potential merging
                    existingEvents.push(...enrichedDetailEvents);
                } else {
                    await displayAdapter.logInfo(`SYSTEM: No new events found on detail page ${url}`);
                }
                
            } catch (error) {
                await displayAdapter.logError(`SYSTEM: Failed to process detail page ${url}: ${error.message}`);
            }
        }
    }

    // Generic URL deduplication utility
    deduplicateUrls(urls, processedUrls = new Set()) {
        if (!urls || !Array.isArray(urls)) {
            return [];
        }
        
        const uniqueUrls = new Set();
        const result = [];
        
        for (const url of urls) {
            if (!url || typeof url !== 'string') {
                continue;
            }
            
            // Skip if already processed globally
            if (processedUrls.has(url)) {
                continue;
            }
            
            // Skip if already in this batch
            if (uniqueUrls.has(url)) {
                continue;
            }
            
            uniqueUrls.add(url);
            result.push(url);
        }
        
        return result;
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

        const searchText = `${event.title || ''} ${event.description || ''} ${event.bar || ''}`.toLowerCase();
        
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

    createEventKey(event, format = null) {
        // Debug the event structure
        if (typeof event.title !== 'string') {
            console.log(`🔍 DEBUG: event.title type: ${typeof event.title}, value: ${JSON.stringify(event.title)}`);
            console.log(`🔍 DEBUG: Full event object:`, JSON.stringify(event, null, 2));
        }
        
        // Determine the format to use
        let keyFormat = format;
        if (!keyFormat && event._parserConfig && event._parserConfig.keyTemplate) {
            keyFormat = event._parserConfig.keyTemplate;
        }
        
        // Default format is the traditional pipe-separated format
        if (!keyFormat) {
            keyFormat = '${normalizedTitle}|${date}|${venue}|${source}';
        }
        
        const key = this.generateKeyFromFormat(event, keyFormat);
        console.log(`🔄 SharedCore: Generated key from format "${keyFormat}": "${key}" for event "${event.title}"`);
        
        return key;
    }

    // Generate key from format string using event data
    generateKeyFromFormat(event, format) {
        if (!format) {
            throw new Error('Format is required for generateKeyFromFormat');
        }
        
        let key = format;
        
        // Extract city from event data
        const city = this.extractCityFromEvent(event);
        
        // Handle normalized title (with the original title normalization logic)
        let normalizedTitle = String(event.originalTitle || event.title || '').toLowerCase().trim();
        
        // Apply the original title normalization for ${normalizedTitle}
        if (format.includes('${normalizedTitle}')) {
            const originalTitle = normalizedTitle;
            
            // Generic text normalization for better deduplication
            normalizedTitle = normalizedTitle
                // Replace sequences of special chars between letters with a single hyphen
                .replace(/([a-z])[\s\>\<\-\.\,\!\@\#\$\%\^\&\*\(\)\_\+\=\{\}\[\]\|\\\:\;\"\'\?\/]+([a-z])/gi, '$1-$2')
                // Remove trailing special characters after words
                .replace(/([a-z])[\!\@\#\$\%\^\&\*\(\)\_\+\=\{\}\[\]\|\\\:\;\"\'\?\,\.]+(?=\s|$)/gi, '$1')
                // Collapse multiple spaces/hyphens into single hyphen
                .replace(/[\s\-]+/g, '-')
                // Remove leading/trailing hyphens
                .replace(/^-+|-+$/g, '');
            
            if (normalizedTitle !== originalTitle) {
                console.log(`🔄 SharedCore: Normalized title for deduplication: "${originalTitle}" → "${normalizedTitle}"`);
            }
        }
        
        // Replace template variables
        key = key.replace(/\$\{title\}/g, String(event.title || '').toLowerCase().trim());
        key = key.replace(/\$\{normalizedTitle\}/g, normalizedTitle);
        key = key.replace(/\$\{startDate\}/g, this.normalizeEventDate(event.startDate));
        key = key.replace(/\$\{date\}/g, this.normalizeEventDate(event.startDate));
        key = key.replace(/\$\{venue\}/g, String(event.bar || '').toLowerCase().trim());
        key = key.replace(/\$\{source\}/g, String(event.source || '').toLowerCase().trim());
        key = key.replace(/\$\{city\}/g, city.toLowerCase().trim());
        
        // Clean up the key
        key = key.toLowerCase().trim();
        
        return key;
    }

        // Merge function: first merge parser data, then merge with calendar
    mergeEventData(existingEvent, newEvent) {
        const fieldPriorities = newEvent._fieldPriorities || {};
        
        // Field priorities are used to determine merge strategies
        
        // Parse existing notes to get all the stored field data  
        const existingFields = this.parseNotesIntoFields(existingEvent.notes || '');
        
        // Step 1: Create final scraped values by merging parser data using priorities
        // (This handles Bearracuda + Eventbrite data merging)
        const finalScrapedValues = { ...newEvent };
        
        // Step 2: Merge final scraped values with existing calendar using merge strategies
        // Only copy essential calendar properties, not Scriptable-specific methods/properties
        const mergedEvent = {
            // Core calendar fields that need to be preserved
            title: existingEvent.title,
            startDate: existingEvent.startDate,
            endDate: existingEvent.endDate,
            location: existingEvent.location,
            notes: existingEvent.notes,
            url: existingEvent.url,
            // Metadata fields
            _fieldPriorities: fieldPriorities,
            _action: newEvent._action || 'merge',
            key: newEvent.key || existingEvent.key,
            _parserConfig: newEvent._parserConfig || existingEvent._parserConfig
        };
        
        // Apply merge strategies for ALL fields (both scraped and existing)
        // Filter out Scriptable-specific methods and properties
        const scriptableFields = new Set([
            'identifier', 'availability', 'timeZone', 'calendar', 'addRecurrenceRule',
            'removeAllRecurrenceRules', 'save', 'remove', 'presentEdit', '_staticFields'
        ]);
        
        const allFieldNames = new Set([
            ...Object.keys(finalScrapedValues),
            ...Object.keys(existingFields),
            ...Object.keys(existingEvent).filter(key => !scriptableFields.has(key))
        ]);
        
        allFieldNames.forEach(fieldName => {
            if (fieldName.startsWith('_')) return; // Skip metadata fields
            
            const priorityConfig = fieldPriorities[fieldName];
            const mergeStrategy = priorityConfig?.merge || 'preserve';
            // Check event field first, then notes fields, but be explicit about undefined vs empty string
            const existingValue = existingEvent[fieldName] !== undefined ? existingEvent[fieldName] : existingFields[fieldName];
            const scrapedValue = finalScrapedValues[fieldName];
            
            // Debug merge logic - can be controlled via debug flags if needed
            const existingFromEvent = existingEvent[fieldName];
            const existingFromFields = existingFields[fieldName];
            
            switch (mergeStrategy) {
                case 'clobber':
                    mergedEvent[fieldName] = scrapedValue;
                    break;
                case 'preserve':
                    // For preserve: only add field if it exists in existing event, otherwise leave undefined
                    if (existingValue !== undefined) {
                        mergedEvent[fieldName] = existingValue;
                    }
                    // Don't set the field at all if existing is undefined - preserve the undefined state
                    break;
                case 'upsert':
                default:
                    mergedEvent[fieldName] = existingValue || scrapedValue;
                    break;
            }
        });
        
        // Add any existing fields that weren't in scraped data
        Object.keys(existingFields).forEach(fieldName => {
            if (!mergedEvent[fieldName] && existingFields[fieldName]) {
                mergedEvent[fieldName] = existingFields[fieldName];
            }
        });
        
        // Regenerate notes from all merged fields
        mergedEvent.notes = this.formatEventNotes(mergedEvent);
        
        // Re-enrich the merged event with location data
        // This ensures that gmaps URLs are regenerated if they were removed during merge
        const enrichedMergedEvent = this.enrichEventLocation(mergedEvent);
        
        // Regenerate notes after enrichment to include any newly generated fields
        enrichedMergedEvent.notes = this.formatEventNotes(enrichedMergedEvent);
        
        // Create _original object for display purposes (same as createFinalEventObject)
        enrichedMergedEvent._original = {
            existing: { 
                // These are the CURRENT values that will be replaced during save
                title: existingEvent.title || '',
                startDate: existingEvent.startDate || '',
                endDate: existingEvent.endDate || '',
                location: existingEvent.location || '',
                notes: existingEvent.notes || '',
                url: existingEvent.url || '',
                // Add fields extracted from current notes for rich comparison
                ...existingFields
            },
            new: { 
                // Include ALL scraped values from newEvent for comparison
                // This ensures preserve fields show what was scraped vs what was kept
                ...newEvent,
                // Override with final calendar values for core fields
                title: enrichedMergedEvent.title,
                startDate: enrichedMergedEvent.startDate,
                endDate: enrichedMergedEvent.endDate,
                location: enrichedMergedEvent.location,
                notes: enrichedMergedEvent.notes,
                url: enrichedMergedEvent.url
            }
        };

        
        return enrichedMergedEvent;
    }

    // Create complete merged event object that represents exactly what will be saved
    createFinalEventObject(existingEvent, newEvent) {
        console.log(`🔄 SharedCore: Creating merged event for "${newEvent.title}" with existing event "${existingEvent.title}"`);
        
        // Use the existing merge function to do all the heavy lifting
        const mergedData = this.mergeEventData(existingEvent, newEvent);
        
        // Helper to apply priority strategy for core calendar fields
        const fieldPriorities = newEvent._fieldPriorities || {};
        const applyPriority = (fieldName, existingValue, newValue) => {
            const priorityConfig = fieldPriorities[fieldName];
            if (!priorityConfig || !priorityConfig.priority) {
                // Default to upsert behavior for fields without priority rules
                return (existingValue !== undefined && existingValue !== null && existingValue !== '')
                    ? existingValue
                    : ((newValue !== undefined && newValue !== null && newValue !== '') ? newValue : existingValue);
            }
            
            // Apply priority logic based on merge strategy from calendar conflict
            const mergeStrategy = priorityConfig.merge || 'preserve';
            switch (mergeStrategy) {
                case 'clobber':
                    return newValue; // Always use new value for clobber, even if empty/null/undefined
                case 'upsert':
                    return (existingValue !== undefined && existingValue !== null && existingValue !== '')
                        ? existingValue
                        : ((newValue !== undefined && newValue !== null && newValue !== '') ? newValue : existingValue);
                case 'preserve':
                default:
                    return existingValue;
            }
        };
        
        // Resolve calendar core fields using priority strategies
        const resolvedStartDate = applyPriority('startDate', existingEvent.startDate, newEvent.startDate);
        const resolvedEndDate = applyPriority('endDate', existingEvent.endDate, newEvent.endDate || newEvent.startDate);
        const resolvedLocation = applyPriority('location', existingEvent.location, newEvent.location);
        
        // Create the final event object that represents exactly what will be saved
        const finalEvent = {
            // Core calendar fields that actually get saved (from mergedData + strategy application)
            title: mergedData.title,
            startDate: resolvedStartDate,
            endDate: resolvedEndDate,
            location: resolvedLocation,
            notes: mergedData.notes,
            url: mergedData.url,
            
            // Preserve existing event reference for saving
            _existingEvent: existingEvent,
            _action: 'merge',
            
            // Keep metadata for display and comparison tables
            city: newEvent.city,
            key: newEvent.key,
            source: newEvent.source,
            _parserConfig: newEvent._parserConfig,
            _fieldPriorities: newEvent._fieldPriorities
        };
        
        // Parse the final notes to get all the merged fields for display
        const finalFields = this.parseNotesIntoFields(finalEvent.notes || '');
        
        // Prepare priority config and existing fields for comparison blocks below
        const fieldPrioritiesForCompare = newEvent._fieldPriorities || {};
        const existingFields = this.parseNotesIntoFields(existingEvent.notes || '');

        // Add all fields from notes to the final event for display purposes
        Object.keys(finalFields).forEach(fieldName => {
            if (finalFields[fieldName] && !finalEvent[fieldName]) {
                // Check merge strategy before adding field
                const priorityConfig = fieldPrioritiesForCompare[fieldName];
                const mergeStrategy = priorityConfig?.merge || 'preserve';
                
                // For preserve strategy, don't add fields that don't exist in calendar (preserve undefined)
                if (mergeStrategy === 'preserve') {
                    // Don't add - preserve the undefined calendar value
                    return;
                } else if (mergeStrategy === 'upsert') {
                    // Only add if calendar doesn't have the field (which we already checked with !finalEvent[fieldName])
                    finalEvent[fieldName] = finalFields[fieldName];
                } else if (mergeStrategy === 'clobber') {
                    // Always add the scraped value (this should have been handled by merge logic above, but ensure it's here)
                    finalEvent[fieldName] = finalFields[fieldName];
                }
            }
        });
        
        console.log(`🔄 SharedCore: Final merged event has ${Object.keys(finalFields).length} fields in notes`);
        
        // Store comparison data for display - use the EXACT same structure as the save operation
        // The save operation uses: targetEvent.field = event.field for these fields:
        // targetEvent.title = event.title;
        // targetEvent.startDate = event.startDate;
        // targetEvent.endDate = event.endDate;
        // targetEvent.location = event.location;
        // targetEvent.notes = event.notes;
        // targetEvent.url = event.url;
        
        // Use existing fields already parsed above
        
        finalEvent._original = {
            existing: { 
                // These are the CURRENT values that will be replaced during save
                title: existingEvent.title || '',
                startDate: existingEvent.startDate || '',
                endDate: existingEvent.endDate || '',
                location: existingEvent.location || '',
                notes: existingEvent.notes || '',
                url: existingEvent.url || '', // Legacy field for comparison
                // Add fields extracted from current notes for rich comparison
                ...existingFields
            },
            new: { 
                // Include ALL scraped values from newEvent for comparison
                // This ensures preserve fields show what was scraped vs what was kept
                ...newEvent,
                // Override with final calendar values for core fields
                title: finalEvent.title,
                startDate: finalEvent.startDate,
                endDate: finalEvent.endDate,
                location: finalEvent.location,
                notes: finalEvent.notes,
                url: finalEvent.url // This comes from mergeEventData which handles website->url mapping
            }
        };

        
        // Create merge info for comparison tables
        finalEvent._mergeInfo = {
            extractedFields: {},
            mergedFields: {},
            strategy: fieldPrioritiesForCompare
        };
        
        // Track which fields were merged and how - include all fields with priorities plus standard calendar fields
        const fieldsToTrack = new Set(['title', 'startDate', 'endDate', 'location', 'url', 'notes']);
        
        // Add all fields that have priority configurations
        if (fieldPriorities) {
            Object.keys(fieldPriorities).forEach(field => fieldsToTrack.add(field));
        }
        
        // Add all fields from existing and new events to ensure comprehensive tracking
        Object.keys(existingFields || {}).forEach(field => fieldsToTrack.add(field));
        Object.keys(newEvent || {}).forEach(field => {
            if (!field.startsWith('_') && typeof newEvent[field] !== 'function') {
                fieldsToTrack.add(field);
            }
        });
        
        fieldsToTrack.forEach(field => {
            const existingValue = existingEvent[field] || existingFields[field];
            const newValue = newEvent[field];
            const finalValue = finalEvent[field];
            
            if (finalValue === existingValue && existingValue !== newValue) {
                finalEvent._mergeInfo.mergedFields[field] = 'existing';
            } else if (newValue !== undefined && finalValue === newValue && newValue !== existingValue) {
                finalEvent._mergeInfo.mergedFields[field] = 'new';
            }
        });
        
        // Extract fields from existing notes for display
        if (existingEvent.notes) {
            const existingFieldsForExtract = this.parseNotesIntoFields(existingEvent.notes || '');
            Object.entries(existingFieldsForExtract).forEach(([fieldName, value]) => {
                finalEvent._mergeInfo.extractedFields[fieldName] = {
                    value: value,
                    source: 'existing.notes'
                };
            });
        }
        
        // Calculate what actually changed
        const changes = [];
        if (finalEvent.title !== existingEvent.title) changes.push('title');
        
        // Inline date equality checks using display-aware comparison
        if (!this.datesEqualForDisplay(finalEvent.startDate, existingEvent.startDate)) changes.push('startDate');
        if (!this.datesEqualForDisplay(finalEvent.endDate, existingEvent.endDate)) changes.push('endDate');
        
        if (finalEvent.location !== existingEvent.location) changes.push('location');
        if (finalEvent.url !== existingEvent.url) changes.push('url'); // URL comparison for change detection
        if (finalEvent.notes !== existingEvent.notes) changes.push('notes');
        
        finalEvent._changes = changes;
        
        // Add extracted fields back to the event object for priority-based merging
        // This ensures the object structure matches what gets saved and makes debugging easier
        if (finalEvent._mergeInfo?.extractedFields && finalEvent._fieldPriorities) {
            Object.entries(finalEvent._mergeInfo.extractedFields).forEach(([fieldName, fieldInfo]) => {
                const priorityConfig = finalEvent._fieldPriorities[fieldName];
                const mergeStrategy = priorityConfig?.merge || 'preserve';
                
                if (mergeStrategy === 'preserve') {
                    // For preserve: don't add fields - use calendar value (even if undefined)
                    // Do nothing - preserve strategy should have been handled by main merge logic
                } else if (mergeStrategy === 'upsert' && !finalEvent[fieldName]) {
                    // For upsert: only add if field is missing from calendar
                    finalEvent[fieldName] = fieldInfo.value;
                } else if (mergeStrategy === 'clobber') {
                    // For clobber: always use scraped value (should already be set by main merge logic)
                    finalEvent[fieldName] = fieldInfo.value;
                }
                // For preserve strategy: do nothing - keep existing value or undefined
            });
        }
        
        // Re-enrich the final event with location data after merging
        // This ensures that gmaps URLs are regenerated if they were removed during clobber merge
        const enrichedFinalEvent = this.enrichEventLocation(finalEvent);
        
        // Regenerate notes after enrichment to include any newly generated fields
        enrichedFinalEvent.notes = this.formatEventNotes(enrichedFinalEvent);
        
        return enrichedFinalEvent;
    }
    
    // Parse notes back into field/value pairs
    parseNotesIntoFields(notes) {
        const fields = {};
        
        // Handle undefined or null notes
        if (!notes) {
            return fields;
        }
        
        const lines = notes.split('\n');
        
        // Map of normalized aliases (lowercased, spaces removed) to canonical field names
        const aliasToCanonical = {
            // Description aliases
            'tea': 'description',
            'info': 'description',
            
            // Venue/location aliases
            'venue': 'bar',
            'location': 'bar',
            'host': 'bar',
            
            // Price aliases
            'price': 'cover',
            'cost': 'cover',
            
            // Name aliases
            'shortname': 'shortName',
            'shortername': 'shortName',
            'shorter name': 'shortName',
            'short title': 'shortName',
            'shorttitle': 'shortName',
            
            // Social/web aliases (canonicalize case and common variants)
            'instagram': 'instagram',
            'ig': 'instagram',
            'facebook': 'facebook',
            'fb': 'facebook',
            'website': 'website',
            'site': 'website',

            'twitter': 'twitter',
            'xtwitter': 'twitter',
            'x': 'twitter',
            'email': 'email',
            'e-mail': 'email',
            'phone': 'phone',
            'phonenumber': 'phone',
            'phone number': 'phone',
            
            // Social/web aliases
            'googleMapsLink': 'gmaps',
            'googlemaps': 'gmaps',
            'googlemapslink': 'gmaps',
            'google maps': 'gmaps'
        };
        
        const normalize = (str) => (str || '').toLowerCase().replace(/\s+/g, '');
        
        lines.forEach(line => {
            const colonIndex = line.indexOf(':');
            // A valid metadata line has a colon that's not at the start
            if (colonIndex > 0) {
                const rawKey = line.substring(0, colonIndex).trim();
                const value = line.substring(colonIndex + 1).trim();
                
                if (rawKey && value) {
                    const normalizedKey = normalize(rawKey);
                    // Prefer canonical mapping when recognized; otherwise, keep original key casing
                    const canonicalKey = aliasToCanonical.hasOwnProperty(normalizedKey)
                        ? aliasToCanonical[normalizedKey]
                        : rawKey;
                    fields[canonicalKey] = value;
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
            
            // Use UTC date components to ensure consistent keys regardless of timezone
            // This prevents keys from changing based on when/where the script is run
            const year = date.getUTCFullYear();
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const day = String(date.getUTCDate()).padStart(2, '0');
            
            return `${year}-${month}-${day}`;
        } catch (error) {
            console.log(`🔄 SharedCore: Warning - Failed to normalize date: ${dateInput}, error: ${error.message}`);
            return '';
        }
    }

    // Compare two date inputs for display equality, avoiding timezone-related false diffs
    datesEqualForDisplay(a, b) {
        if (a === b) return true;
        if (!a || !b) return false;
        const da = new Date(a);
        const db = new Date(b);
        if (isNaN(da.getTime()) || isNaN(db.getTime())) {
            return String(a) === String(b);
        }
        if (da.getTime() === db.getTime()) return true;
        try {
            return da.toLocaleString() === db.toLocaleString();
        } catch (e) {
            return da.toString() === db.toString();
        }
    }

    // URL processing utilities
    
    // Scriptable-compatible URL parsing utility
    parseUrl(url) {
        if (!url || typeof url !== 'string') return null;
        
        try {
            // Simple regex-based URL parsing that works in Scriptable
            const urlPattern = /^(https?:)\/\/([^\/]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/;
            const match = url.match(urlPattern);
            
            if (!match) return null;
            
            const [, protocol, host, pathname = '/', search = '', hash = ''] = match;
            
            return {
                protocol,
                host,
                hostname: host.split(':')[0], // Remove port if present
                pathname,
                search,
                hash,
                href: url
            };
        } catch (error) {
            return null;
        }
    }
    
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
            const base = this.parseUrl(baseUrl);
            if (base) {
                return `${base.protocol}//${base.host}${url}`;
            }
        }
        
        // Handle protocol-relative URLs
        if (url.startsWith('//')) {
            const base = this.parseUrl(baseUrl);
            if (base) {
                return `${base.protocol}${url}`;
            }
        }
        
        return url;
    }

    isValidUrl(url) {
        if (!url || typeof url !== 'string') return false;
        
        const parsed = this.parseUrl(url);
        return parsed !== null;
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
    // GOOGLE MAPS URL GENERATION - iOS-compatible URL construction
    // ============================================================================
    
    // Static method to generate iOS-compatible Google Maps URLs
    // Works on Android, iOS (including iOS 11+), and web without API tokens
    static generateGoogleMapsUrl({ coordinates, placeId, address }) {
        if (placeId && coordinates) {
            // Best case: use coordinates with place_id for maximum compatibility
            return `https://www.google.com/maps/search/?api=1&query=${coordinates.lat}%2C${coordinates.lng}&query_place_id=${placeId}`;
        } else if (placeId && address) {
            // Fallback: use address with place_id (graceful degradation if place_id doesn't exist)
            return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}&query_place_id=${placeId}`;
        } else if (coordinates) {
            // Fallback: coordinates only
            return `https://maps.google.com/?q=${coordinates.lat},${coordinates.lng}`;
        } else if (address) {
            // Final fallback: address only
            return `https://maps.google.com/?q=${encodeURIComponent(address)}`;
        }
        return null;
    }
    
    // ============================================================================
    // EVENT ENRICHMENT - Add Google Maps links, validate addresses, extract cities
    // ============================================================================
    
    // Enrich event with Google Maps links and city information
    enrichEventLocation(event) {
        if (!event) return event;
        
        // DEBUG: Check URL field before enrichment
        const hadUrlBefore = 'url' in event;
        const urlValueBefore = event.url;
        
        // Extract city if not already present (parser may have set it for venue-specific logic)
        if (!event.city) {
            event.city = this.extractCityFromEvent(event);
        }
        
        // Check if venue name indicates TBA/placeholder (these often have fake addresses/coordinates)
        const isTBAVenue = event.bar && (
                          event.bar.toLowerCase().includes('tba') || 
                          event.bar.toLowerCase().includes('to be announced'));
        
        if (isTBAVenue) {
            console.log(`🗺️ SharedCore: TBA venue "${event.bar}" detected for "${event.title}" - removing fake location data`);
            // Remove all location data for TBA venues (coordinates are usually fake city center)
            event.location = null;
            event.address = null;
            event.gmaps = '';
            // Keep placeId even for TBA venues - don't delete it
            // delete event.placeId;
            return event;
        }
        
        // Generate iOS-compatible Google Maps URL using available data (address, coordinates, place_id)
        // Always generate if gmaps field is empty or undefined - merge strategies are handled later
        if (!event.gmaps) {
            // Parse coordinates from location field if available
            let coordinates = null;
            if (event.location && typeof event.location === 'string' && event.location.includes(',')) {
                const [lat, lng] = event.location.split(',').map(coord => parseFloat(coord.trim()));
                if (!isNaN(lat) && !isNaN(lng)) {
                    coordinates = { lat, lng };
                }
            }
            
            // Use available data to generate iOS-compatible URL
            const urlData = {
                coordinates: coordinates,
                placeId: event.placeId || null,
                address: (event.address && this.isFullAddress(event.address)) ? event.address : null
            };
            
            event.gmaps = SharedCore.generateGoogleMapsUrl(urlData);
            
            if (event.gmaps) {
                const method = event.placeId ? 
                    (coordinates ? 'place_id + coordinates' : 'place_id + address') : 
                    (coordinates ? 'coordinates only' : 'address only');
                console.log(`🗺️ SharedCore: Generated iOS-compatible Google Maps URL using ${method} for "${event.title}"`);
            }
        }
        
        // Clean up location data based on what we have
        if (event.address && this.isFullAddress(event.address)) {
            // Keep address and gmaps URL
        } else if (!event.address && event.location && event.gmaps) {
            // Keep coordinates and gmaps URL
        } else if (!event.address && event.location && !event.gmaps) {
            // No valid address or gmaps URL - keep location data anyway
            // delete event.gmaps;
            // event.location = null;
        } else {
            // Address present but not full (isFullAddress caught placeholder): keep data anyway
            console.log(`🗺️ SharedCore: Placeholder address "${event.address}" detected for "${event.title}" - keeping location data`);
            // delete event.gmaps;
            // event.location = null;
            // delete event.address;
        }
        
        // Keep placeId for future URL generation - don't delete it
        // delete event.placeId;
        
        // DEBUG: Check URL field after enrichment
        const hasUrlAfter = 'url' in event;
        const urlValueAfter = event.url;
        
        if (hadUrlBefore !== hasUrlAfter || urlValueBefore !== urlValueAfter) {
            console.error(`🗺️ SharedCore: URL FIELD LOST in enrichEventLocation for "${event.title}"!`);
            console.error(`🗺️ SharedCore: Before: hadUrl=${hadUrlBefore}, value="${urlValueBefore}"`);
            console.error(`🗺️ SharedCore: After: hasUrl=${hasUrlAfter}, value="${urlValueAfter}"`);
        }
        
        return event;
    }
    
    
    
    // =========================================================================
    // CITY UTILITIES - Shared location detection and mapping
    // =========================================================================
    
    // Check if an address is a full address (not just a city or region)
    isFullAddress(address) {
        if (!address || typeof address !== 'string') return false;
        
        // Clean up the address
        const cleanAddress = address.trim();
        if (cleanAddress.length < 10) return false; // Too short to be a full address
        
        // Check for TBA or similar placeholder values (including venue names)
        if (/^(TBA|TBD|To Be Announced|To Be Determined)$/i.test(cleanAddress)) {
            return false;
        }
        
        // Check for other placeholder patterns that indicate incomplete addresses
        const placeholderPatterns = [
            /^(venue|location|address)?\s*(tba|tbd|pending|coming soon|announced soon)$/i,
            /^(details|info|information)?\s*(coming|to follow|tba|tbd)$/i,
            /^(will be announced|location pending|venue pending)$/i
        ];
        
        if (placeholderPatterns.some(pattern => pattern.test(cleanAddress))) {
            return false;
        }
        
        // Check for partial addresses that are just area/neighborhood + city + zip
        // Examples: "DTLA Los Angeles, CA 90013", "Downtown Denver, CO 80202"
        const partialAddressPatterns = [
            /^(DTLA|Downtown|Midtown|Uptown|North|South|East|West|Central)\s*,?\s*[A-Za-z\s]+,\s*[A-Z]{2}\s*\d{5}$/i,
            /^[A-Za-z\s]+\s+(District|Area|Zone|Neighborhood)\s*,?\s*[A-Za-z\s]+,\s*[A-Z]{2}\s*\d{5}$/i
        ];
        
        // If it matches a partial address pattern, it's not a full address
        if (partialAddressPatterns.some(pattern => pattern.test(cleanAddress))) {
            return false;
        }
        
        // Check for common full address patterns
        const fullAddressPatterns = [
            /\d+\s+\w+.*street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|way|place|pl|court|ct/i,
            /\d+\s+\w+.*\s+\w+/i // Number + words (likely street address)
        ];
        
        // Must contain at least one full address pattern
        const hasAddressPattern = fullAddressPatterns.some(pattern => pattern.test(cleanAddress));
        if (!hasAddressPattern) return false;
        
        // Check if it's just a city name (common city patterns to exclude)
        const cityOnlyPatterns = [
            /^(new york|nyc|los angeles|san francisco|chicago|atlanta|miami|seattle|portland|denver|las vegas|vegas|boston|philadelphia|austin|dallas|houston|phoenix|toronto|london|berlin|palm springs|sitges)$/i,
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
    extractCityFromEvent(event) {
        // Try city field first
        if (event.city) {
            return String(event.city);
        }
        
        // Try to extract from title
        const title = String(event.title || '').toLowerCase();
        
        // Check for city names in title
        for (const [patterns, city] of Object.entries(this.cityMappings)) {
            const cityPatterns = patterns.split('|');
            for (const pattern of cityPatterns) {
                if (title.includes(pattern)) {
                    return city;
                }
            }
        }
        
        // Try to extract from venue address or name
        const venue = String(event.bar || '').toLowerCase();
        for (const [patterns, city] of Object.entries(this.cityMappings)) {
            const cityPatterns = patterns.split('|');
            for (const pattern of cityPatterns) {
                if (venue.includes(pattern)) {
                    return city;
                }
            }
        }
        
        // Try venue address first (keeping venue for backward compatibility with eventbrite data structure)
        if (event.venue?.address) {
            const address = event.venue.address;
            const cityFromAddress = address.city || address.localized_area_display || '';
            if (cityFromAddress) {
                return this.normalizeCityName(cityFromAddress);
            }
        }
        
        // Try address field
        if (event.address) {
            const cityFromAddress = this.extractCityFromAddress(event.address);
            if (cityFromAddress) {
                return cityFromAddress;
            }
        }
        
        // Try extracting from text content
        const searchText = `${event.title || event.name || ''} ${event.description || ''} ${event.bar || ''}`;
        const cityFromText = this.extractCityFromText(searchText);
        if (cityFromText) {
            return cityFromText;
        }
        
        return 'unknown';
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
    
    // Apply field-level priority strategies from the parser config
    // This determines which parser's data to trust for each field
    applyFieldPriorities(event, parserConfig, mainConfig) {
        // Always attach parser config
        event._parserConfig = parserConfig;
        
        // Get the field priorities configuration from this parser's config
        const fieldPriorities = parserConfig?.fieldPriorities || {};
        
        // Field priorities loaded from parser configuration
        
        // Store field priorities for later use during merging
        if (!event._fieldPriorities) {
            event._fieldPriorities = {};
        }
        
        // Copy field priorities to event for later use
        Object.keys(fieldPriorities).forEach(fieldName => {
            event._fieldPriorities[fieldName] = fieldPriorities[fieldName];
        });
        
        // Apply static metadata values based on priority system
        if (parserConfig?.metadata) {
            Object.keys(parserConfig.metadata).forEach(key => {
                const metaValue = parserConfig.metadata[key];
                if (typeof metaValue === 'object' && metaValue !== null && 'value' in metaValue) {
                    const priorityConfig = fieldPriorities[key];
                    
                    // Check if "static" has priority for this field
                    if (priorityConfig && priorityConfig.priority && priorityConfig.priority.includes('static')) {
                        // Apply static value since it's in the priority list
                        event[key] = metaValue.value;
                        // Mark this field as coming from static source
                        if (!event._staticFields) event._staticFields = {};
                        event._staticFields[key] = metaValue.value;
                    } else {
                        // Fallback: if no priority config, apply static value (backward compatibility)
                        event[key] = metaValue.value;
                        if (!event._staticFields) event._staticFields = {};
                        event._staticFields[key] = metaValue.value;
                    }
                }
            });
        }
        
        // Return the event with all fields intact
        // The actual priority logic will be handled later during event merging
        return event;
    }
    
    // Format event notes with all metadata in key-value format
    formatEventNotes(event) {
        const notes = [];
        
        // Fields to exclude from notes (core calendar fields, internal metadata, and Scriptable-specific properties)
        const excludeFields = new Set([
            'title', 'startDate', 'endDate', 'location', 'coordinates', 'notes',
            'isBearEvent', 'source', 'city', 'setDescription', '_analysis', '_action', 
            '_existingEvent', '_existingKey', '_conflicts', '_parserConfig', '_fieldPriorities',
            '_original', '_mergeInfo', '_changes', '_mergeDiff',
            'originalTitle', 'name', // These are usually duplicates of title
            // Scriptable-specific properties that shouldn't be in notes
            'identifier', 'availability', 'timeZone', 'calendar', 'addRecurrenceRule',
            'removeAllRecurrenceRules', 'save', 'remove', 'presentEdit', '_staticFields'
        ]);
        
        // Add all fields that have values (merge logic has already determined correct values)
        let savedFieldCount = 0;
        Object.keys(event).forEach(fieldName => {
            if (!excludeFields.has(fieldName) && 
                event[fieldName] !== undefined && 
                event[fieldName] !== null && 
                event[fieldName] !== '') {
                notes.push(`${fieldName}: ${event[fieldName]}`);
                savedFieldCount++;
            }
        });
        
        console.log(`📝 SharedCore: Formatted notes for "${event.title}" with ${savedFieldCount} fields (excluding ${excludeFields.size} system fields)`);
        
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
        // Events are already properly formatted - no need for additional formatting
        const preparedEvents = events;
        
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
            
            // Handle merge action by creating complete final event object
            if (analysis.action === 'merge' && analysis.existingEvent) {
                // Create final merged event that represents exactly what will be saved
                analyzedEvent = this.createFinalEventObject(analysis.existingEvent, event);
                
                // Calculate merge diff for display purposes
                const originalFields = this.parseNotesIntoFields(analysis.existingEvent.notes || '');
                const mergedFields = this.parseNotesIntoFields(analyzedEvent.notes || '');
                
                console.log(`📊 SharedCore: Comparing fields for merge diff - Original: ${Object.keys(originalFields).length} fields, Merged: ${Object.keys(mergedFields).length} fields`);
                
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
                        // Check if this is preserve strategy - if so, undefined should be preserved, not removed
                        const fieldPriorities = analyzedEvent._fieldPriorities || {};
                        const priorityConfig = fieldPriorities[key];
                        const mergeStrategy = priorityConfig?.merge || 'preserve';
                        
                        if (mergeStrategy === 'preserve' && originalFields[key] === undefined) {
                            // For preserve strategy, if original was undefined and merged is undefined, it's preserved
                            analyzedEvent._mergeDiff.preserved.push(key);
                        } else {
                            // Otherwise it's truly removed
                            analyzedEvent._mergeDiff.removed.push({ key, value: originalFields[key] });
                        }
                    } else {
                        analyzedEvent._mergeDiff.updated.push({ 
                            key, 
                            from: originalFields[key], 
                            to: mergedFields[key] 
                        });
                    }
                });
                
                // Check for added fields - but handle preserve strategy correctly
                Object.keys(mergedFields).forEach(key => {
                    if (!originalFields[key]) {
                        // Check if this field has preserve strategy and should be treated as preserved
                        const fieldPriorities = analyzedEvent._fieldPriorities || {};
                        const priorityConfig = fieldPriorities[key];
                        const mergeStrategy = priorityConfig?.merge || 'preserve';
                        
                        if (mergeStrategy === 'preserve') {
                            // For preserve strategy, if the field wasn't in original notes but is now present,
                            // it should be marked as preserved (the undefined existing value was preserved)
                            analyzedEvent._mergeDiff.preserved.push(key);
                        } else {
                            // For other strategies (clobber, upsert), it's truly added
                            analyzedEvent._mergeDiff.added.push({ key, value: mergedFields[key] });
                        }
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
                (existing.location === (event.bar || event.venue) && 
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
        const diff = Math.abs(date1.getTime() - date2.getTime());
        return diff <= (toleranceMinutes * 60 * 1000);
    }
    
    // Check if two date ranges overlap (pure logic)
    doDatesOverlap(start1, end1, start2, end2) {
        return start1 < end2 && end1 > start2;
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
                    // Always use calendar value, even if undefined
                    event[fieldName] = existingValue;
                    event._mergeInfo.mergedFields[fieldName] = 'existing';
                    return true;
                    
                case 'upsert':
                    // Prefer calendar if exists, otherwise add scraped
                    if (existingValue !== undefined && existingValue !== null && existingValue !== '') {
                        // Calendar has value, use it
                        event[fieldName] = existingValue;
                        event._mergeInfo.mergedFields[fieldName] = 'existing';
                        return true;
                    } else if (newValue !== undefined && newValue !== null && newValue !== '') {
                        // Calendar doesn't have value, use scraped
                        event[fieldName] = newValue;
                        event._mergeInfo.mergedFields[fieldName] = 'new';
                        return true;
                    } else {
                        // Neither has value, use calendar (undefined)
                        event[fieldName] = existingValue;
                        event._mergeInfo.mergedFields[fieldName] = 'existing';
                        return true;
                    }
                    
                case 'clobber':
                    // Always use scraped value
                    event[fieldName] = newValue;
                    event._mergeInfo.mergedFields[fieldName] = 'new';
                    return true;
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
            // Handle 'location' -> 'bar' mapping
            if (conflict.location && !existingFieldsFromNotes.bar) {
                applyMergeStrategy('bar', conflict.location, event.bar);
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
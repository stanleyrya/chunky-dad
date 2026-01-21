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
    constructor(cities) {
        if (!cities || typeof cities !== 'object') {
            throw new Error('SharedCore requires cities configuration - pass config.cities from scraper-cities.js');
        }

        this.visitedUrls = new Set();
        this.bearKeywords = [
            'bear', 'bears', 'woof', 'grr', 'furry', 'hairy', 'daddy', 'cub', 
            'otter', 'leather', 'muscle bear', 'bearracuda', 'furball', 'megawoof',
            'leather bears', 'bear night', 'bear party', 'polar bear', 'grizzly'
        ];
        
        // Store cities config for timezone assignment
        this.cities = cities;
        
        // Initialize city mappings from centralized cities config
        this.cityMappings = this.convertCitiesConfigToCityMappings(this.cities);
        
        // URL-to-parser mapping for automatic parser detection
        this.urlParserMappings = [
            {
                pattern: /eventbrite\.com/i,
                parser: 'eventbrite'
            },
            {
                pattern: /bearracuda\.com/i,
                parser: 'bearracuda'
            },
            {
                pattern: /chunk-party\.com/i,
                parser: 'chunk'
            },
            {
                pattern: /furball\.nyc/i,
                parser: 'furball'
            },
            {
                pattern: /linktr\.ee/i,
                parser: 'linktree'
            },
            {
                pattern: /redeyetickets\.com/i,
                parser: 'redeyetickets'
            }
            // Generic parser will be used as fallback if no pattern matches
        ];
    }

    // Convert cities config format to internal cityMappings format
    convertCitiesConfigToCityMappings(cities) {
        const cityMappings = {};
        
        for (const [cityKey, cityConfig] of Object.entries(cities)) {
            if (cityConfig.patterns && Array.isArray(cityConfig.patterns)) {
                // Convert array of patterns to pipe-separated string format
                const pipePatterns = cityConfig.patterns.join('|');
                cityMappings[pipePatterns] = cityKey;
            }
        }
        
        console.log(`🗺️ SharedCore: Created city mappings: ${JSON.stringify(cityMappings)}`);
        return cityMappings;
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
            rawBearEvents: 0,
            bearEvents: 0,
            duplicatesRemoved: 0,
            errors: [],
            parserResults: [],
            allProcessedEvents: [] // All events ready for calendar
        };

        if (!config.parsers || config.parsers.length === 0) {
            await displayAdapter.logWarn('SYSTEM: No parser configurations found in config');
            return results;
        }

        // Global URL tracking across all parsers to prevent duplicate processing
        const globalProcessedUrls = new Set();

        for (let i = 0; i < config.parsers.length; i++) {
            const parserConfig = config.parsers[i];
            
            // Check if parser is enabled (default to true if not specified)
            if (parserConfig.enabled === false) {
                await displayAdapter.logInfo(`SYSTEM: Skipping disabled parser: ${parserConfig.name}`);
                continue;
            }
            
            try {
                await displayAdapter.logInfo(`SYSTEM: Processing parser ${i + 1}/${config.parsers.length}: ${parserConfig.name}`);
                
                const parserResult = await this.processParser(parserConfig, config, httpAdapter, displayAdapter, parsers, globalProcessedUrls);
                results.parserResults.push(parserResult);
                results.totalEvents += parserResult.totalEvents;
                results.rawBearEvents += parserResult.rawBearEvents;
                results.bearEvents += parserResult.bearEvents;
                results.duplicatesRemoved += parserResult.duplicatesRemoved;
                
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

        if (results.duplicatesRemoved > 0) {
            await displayAdapter.logInfo(`SYSTEM: Event processing complete. Total: ${results.totalEvents} (all sources), Raw bear: ${results.rawBearEvents} (after bear filtering), Duplicates removed: ${results.duplicatesRemoved}, Final bear: ${results.bearEvents} (${results.rawBearEvents} - ${results.duplicatesRemoved})`);
        } else {
            await displayAdapter.logInfo(`SYSTEM: Event processing complete. Total: ${results.totalEvents} (all sources), Final bear: ${results.bearEvents} (no duplicates)`);
        }
        return results;
    }

    async processParser(parserConfig, mainConfig, httpAdapter, displayAdapter, parsers, globalProcessedUrls = new Set()) {
        // Automatically detect parser from the first URL
        let parserName = null;
        if (parserConfig.urls && parserConfig.urls.length > 0) {
            parserName = this.detectParserFromUrl(parserConfig.urls[0]);
            await displayAdapter.logInfo(`SYSTEM: Detected '${parserName}' parser from URL: ${parserConfig.urls[0]}`);
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
        if (parserConfig.urls && parserConfig.urls.length <= 3) {
            // Only log individual URLs if there are 3 or fewer
            parserConfig.urls.forEach((url, i) => {
                displayAdapter.logInfo(`SYSTEM:   URL ${i + 1}: ${url}`);
            });
        } else if (parserConfig.urls && parserConfig.urls.length > 3) {
            await displayAdapter.logInfo(`SYSTEM:   First URL: ${parserConfig.urls[0]} (and ${parserConfig.urls.length - 1} more)`);
        }
        
        const allEvents = [];
        // Use global processedUrls to prevent duplicate processing across all parsers

        // Process main URLs
        for (let i = 0; i < (parserConfig.urls || []).length; i++) {
            const url = parserConfig.urls[i];
            if (globalProcessedUrls.has(url)) {
                await displayAdapter.logWarn(`SYSTEM: Skipping duplicate URL (already processed globally): ${url}`);
                continue;
            }
            globalProcessedUrls.add(url);

            try {
                await displayAdapter.logInfo(`SYSTEM: Fetching URL ${i + 1}/${parserConfig.urls.length}: ${url}`);
                const htmlData = await httpAdapter.fetchData(url);
                
                // Detect parser for this specific URL (allows mid-run switching)
                const urlParserName = this.detectParserFromUrl(url) || parserName;
                const urlParser = parsers[urlParserName];
                
                if (urlParserName !== parserName) {
                    await displayAdapter.logInfo(`SYSTEM: Switching to ${urlParserName} parser for URL: ${url}`);
                }
                
                // Parse events (consolidated logging)
                const parseResult = urlParser.parseEvents(htmlData, parserConfig, mainConfig?.cities || null);
                
                const eventCount = parseResult?.events?.length || 0;
                const linkCount = parseResult?.additionalLinks?.length || 0;
                await displayAdapter.logInfo(`SYSTEM: Parsed ${htmlData?.html?.length || 0} chars → ${eventCount} events, ${linkCount} additional links`);
                
                if (parseResult.events) {
                    // Apply field priorities to determine which parser data to trust
                    const filteredEvents = parseResult.events.map(event => 
                        this.applyFieldPriorities(event, parserConfig, mainConfig)
                    );
                    
                    // Normalize text fields and enrich events with location data (Google Maps links, city extraction)
                    const enrichedEvents = filteredEvents.map(event => 
                        this.enrichEventLocation(this.normalizeEventTextFields(event))
                    );
                    
                    allEvents.push(...enrichedEvents);
                    await displayAdapter.logSuccess(`SYSTEM: Added ${enrichedEvents.length} enriched events from ${url}`);
                }

                // Process additional URLs if we have them (for enriching existing events, not creating new ones)
                if (parseResult.additionalLinks && parseResult.additionalLinks.length > 0) {
                    // Deduplicate additional URLs before processing
                    const deduplicatedUrls = this.deduplicateUrls(parseResult.additionalLinks, globalProcessedUrls);
                    await displayAdapter.logInfo(`SYSTEM: Processing ${parseResult.additionalLinks.length} additional URLs → ${deduplicatedUrls.length} unique for detail pages`);
                    
                    await this.enrichEventsWithDetailPages(
                        allEvents,
                        deduplicatedUrls, 
                        parsers, 
                        parserConfig, 
                        httpAdapter, 
                        displayAdapter,
                        globalProcessedUrls,
                        undefined,
                        mainConfig,
                        parserName
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
        await displayAdapter.logInfo(`SYSTEM: Filtering events: ${allEvents.length} total → processing...`);
        const futureEvents = this.filterFutureEvents(allEvents, parserConfig.daysToLookAhead, parserConfig.allowPastEvents);
        const bearEvents = this.filterBearEvents(futureEvents, parserConfig);
        const deduplicatedEvents = this.deduplicateEvents(bearEvents);
        
        // Calculate deduplication stats
        const duplicatesRemoved = bearEvents.length - deduplicatedEvents.length;
        
        await displayAdapter.logInfo(`SYSTEM: Event filtering complete: ${allEvents.length} → ${futureEvents.length} future → ${bearEvents.length} bear → ${deduplicatedEvents.length} final`);

        await displayAdapter.logSuccess(`SYSTEM: ${parserConfig.name}: ${deduplicatedEvents.length} bear events found`);

        return {
            name: parserConfig.name,
            totalEvents: allEvents.length,
            rawBearEvents: bearEvents.length,
            bearEvents: deduplicatedEvents.length,
            duplicatesRemoved: duplicatesRemoved,
            events: deduplicatedEvents,
            config: parserConfig // Include config for orchestrator to use
        };
    }

    async enrichEventsWithDetailPages(existingEvents, additionalLinks, parsers, parserConfig, httpAdapter, displayAdapter, processedUrls, currentDepth = 1, mainConfig = null, parserName = null) {
        const maxUrls = parserConfig.maxAdditionalUrls || 12;
        const urlsToProcess = additionalLinks.slice(0, maxUrls);
        const maxDepth = parserConfig.urlDiscoveryDepth || 1;

        await displayAdapter.logInfo(`SYSTEM: Processing ${urlsToProcess.length} additional URLs for event enrichment (depth: ${currentDepth}/${maxDepth})`);

        for (const url of urlsToProcess) {
            if (processedUrls.has(url)) {
                continue; // Skip already processed URLs without logging each one
            }

            processedUrls.add(url);

            try {
                const htmlData = await httpAdapter.fetchData(url);
                
                // Detect parser for this specific URL (allows mid-run switching)
                const urlParserName = this.detectParserFromUrl(url) || parserName || 'generic';
                const urlParser = parsers[urlParserName];
                
                const parseResult = urlParser.parseEvents(htmlData, parserConfig, mainConfig?.cities || null);
                
                // Handle additional URLs if depth allows and parser wants URL discovery
                const shouldProcessUrls = parseResult.additionalLinks && 
                                        parseResult.additionalLinks.length > 0 &&
                                        currentDepth < maxDepth &&
                                        parserConfig.urlDiscoveryDepth > 0;
                
                if (shouldProcessUrls) {
                        // Deduplicate URLs before recursive processing
                        const deduplicatedUrls = this.deduplicateUrls(parseResult.additionalLinks, processedUrls);
                        await displayAdapter.logInfo(`SYSTEM: Detail page ${url} found ${parseResult.additionalLinks.length} URLs → ${deduplicatedUrls.length} unique for depth ${currentDepth + 1}`);
                        
                        // Recursively process additional URLs if we haven't reached max depth
                        if (deduplicatedUrls.length > 0) {
                            await this.enrichEventsWithDetailPages(
                                existingEvents,
                                deduplicatedUrls,
                                parsers,
                                parserConfig,
                                httpAdapter,
                                displayAdapter,
                                processedUrls,
                                currentDepth + 1,
                                mainConfig,
                                urlParserName
                            );
                        }
                } else if (parseResult.additionalLinks && parseResult.additionalLinks.length > 0) {
                    await displayAdapter.logInfo(`SYSTEM: Detail page ${url} found ${parseResult.additionalLinks.length} additional URLs, but depth limit (${maxDepth}) reached or URL discovery disabled - ignoring`);
                }
                
                // Process detail page events - either enrich existing or add new events
                if (parseResult.events && parseResult.events.length > 0) {
                    // Apply field priorities to detail page events (same as main page events)
                    // CRITICAL FIX: Detail page events need the same enrichment as main page events
                    const enrichedDetailEvents = parseResult.events.map(event => 
                        this.enrichEventLocation(this.normalizeEventTextFields(this.applyFieldPriorities(event, parserConfig, mainConfig)))
                    );
                    
                    // Add these events to the existing events collection for potential merging
                    existingEvents.push(...enrichedDetailEvents);
                    await displayAdapter.logSuccess(`SYSTEM: Added ${parseResult.events.length} new events from detail page ${url}`);
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
    filterFutureEvents(events, daysToLookAhead = null, allowPastEvents = false) {
        const now = new Date();
        const cutoffDate = daysToLookAhead ? 
            new Date(now.getTime() + (daysToLookAhead * 24 * 60 * 60 * 1000)) : 
            null;

        return events.filter(event => {
            if (!event.startDate) return false;
            
            const eventDate = event.startDate;
            
            // Skip past events unless explicitly allowed
            if (!allowPastEvents && eventDate <= now) return false;
            
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
        
        // Log progress for large batches
        const logProgress = events.length > 10;
        if (logProgress) {
            console.log(`🔄 SharedCore: Deduplicating ${events.length} events...`);
        }

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
                const merged = this.mergeParsedEvents(existing, event);
                merged.key = key; // Ensure merged event has the key
                seen.set(key, merged);
                
                // Update in deduplicated array
                const index = deduplicated.findIndex(e => e.key === key);
                if (index !== -1) {
                    deduplicated[index] = merged;
                }
            }
        }
        
        // Log results for large batches
        if (logProgress) {
            const duplicatesFound = events.length - deduplicated.length;
            if (duplicatesFound > 0) {
                console.log(`🔄 SharedCore: Removed ${duplicatesFound} duplicates, ${deduplicated.length} unique events remaining`);
            } else {
                console.log(`🔄 SharedCore: No duplicates found, all ${deduplicated.length} events are unique`);
            }
        }

        return deduplicated;
    }

    createEventKey(event, format = null) {
        // Validate event structure
        if (typeof event.title !== 'string') {
            console.error(`⚠️ SharedCore: Invalid event.title type: ${typeof event.title} for event: ${event.title}`);
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
        
        return key;
    }

    // Generate key from format string using event data
    generateKeyFromFormat(event, format) {
        if (!format) {
            throw new Error('Format is required for generateKeyFromFormat');
        }
        
        // Extract city from event data
        const city = this.extractCityFromEvent(event);
        
        // Handle normalized title (with the original title normalization logic)
        let normalizedTitle = String(event.originalTitle || event.title || '').toLowerCase().trim();
        const originalTitle = normalizedTitle; // Store original value before normalization
        
        // Apply the original title normalization for ${normalizedTitle}
        if (format.includes('${normalizedTitle}')) {
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
                // Title was normalized for deduplication
            }
        }
        
        // Initialize key from format template
        let key = format;
        
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

    // Merge two parsed events based on field priorities (for deduplication)
    mergeParsedEvents(existingEvent, newEvent) {
        const fieldPriorities = newEvent._fieldPriorities || existingEvent._fieldPriorities || {};
        
        // Log the merge operation
        console.log(`🔄 PARSER MERGE: Merging "${existingEvent.title}" (${existingEvent.source}) with "${newEvent.title}" (${newEvent.source})`);
        
        // Start with newEvent as base to preserve metadata
        const mergedEvent = { ...newEvent };
        
        // Helper function to check if a value is empty/null/undefined
        const isEmpty = (value) => {
            return value === null || value === undefined || value === '' || 
                   (typeof value === 'string' && value.trim() === '');
        };
        
        // Get all field names from both events
        const allFields = new Set([
            ...Object.keys(existingEvent),
            ...Object.keys(newEvent)
        ]);
        
        console.log(`🔄 MERGE DEBUG: All fields to process: ${Array.from(allFields).join(', ')}`);
        console.log(`🔄 MERGE DEBUG: existingEvent fields: ${JSON.stringify(Object.keys(existingEvent))}`);
        console.log(`🔄 MERGE DEBUG: newEvent fields: ${JSON.stringify(Object.keys(newEvent))}`);
        
        // Track merge decisions for important fields
        const mergeDecisions = [];
        
        // Apply field priorities for each field
        allFields.forEach(fieldName => {
            if (fieldName.startsWith('_')) return; // Skip metadata fields
            
            const priorityConfig = fieldPriorities[fieldName];
            const existingValue = existingEvent[fieldName];
            const newValue = newEvent[fieldName];
            const existingSource = existingEvent.source;
            const newSource = newEvent.source;
            
            console.log(`🔄 MERGE DEBUG: Processing field '${fieldName}'`);
            console.log(`🔄 MERGE DEBUG:   existingValue: "${existingValue}" (${existingSource})`);
            console.log(`🔄 MERGE DEBUG:   newValue: "${newValue}" (${newSource})`);
            console.log(`🔄 MERGE DEBUG:   priorityConfig: ${priorityConfig ? JSON.stringify(priorityConfig) : 'NONE'}`);
            
            if (!priorityConfig || !priorityConfig.priority) {
                console.log(`🔄 MERGE DEBUG:   NO PRIORITY CONFIG - skipping field`);
                return; // No priority config, keep newEvent value
            }
            
            // Find which source has higher priority
            const existingIndex = priorityConfig.priority.indexOf(existingSource);
            const newIndex = priorityConfig.priority.indexOf(newSource);
            
            console.log(`🔄 MERGE DEBUG:   existingIndex: ${existingIndex}, newIndex: ${newIndex}`);
            
            let chosenValue = newValue; // Default
            let reason = 'default';
            
            // If both sources are in the priority list, use the one with lower index (higher priority)
            if (existingIndex !== -1 && newIndex !== -1) {
                if (existingIndex < newIndex) {
                    // Existing source has higher priority
                    // But if existing value is empty and new value is not empty, use new value
                    if (isEmpty(existingValue) && !isEmpty(newValue)) {
                        chosenValue = newValue;
                        reason = `${newSource} value used because ${existingSource} value is empty`;
                    } else {
                        chosenValue = existingValue;
                        reason = `${existingSource} has higher priority (index ${existingIndex} vs ${newIndex})`;
                    }
                } else if (newIndex < existingIndex) {
                    // New source has higher priority
                    // But if new value is empty and existing value is not empty, use existing value
                    if (isEmpty(newValue) && !isEmpty(existingValue)) {
                        chosenValue = existingValue;
                        reason = `${existingSource} value used because ${newSource} value is empty`;
                    } else {
                        chosenValue = newValue;
                        reason = `${newSource} has higher priority (index ${newIndex} vs ${existingIndex})`;
                    }
                } else {
                    // Same priority - preserve existing value to avoid overriding previous merges
                    chosenValue = existingValue;
                    reason = `same priority (index ${existingIndex} vs ${newIndex}) - preserving existing`;
                }
            } else if (existingIndex !== -1) {
                // Only existing source is in priority list
                chosenValue = existingValue;
                reason = `only ${existingSource} in priority list`;
            } else if (newIndex !== -1) {
                // Only new source is in priority list
                chosenValue = newValue;
                reason = `only ${newSource} in priority list`;
            }
            
            console.log(`🔄 MERGE DEBUG:   CHOSEN: "${chosenValue}" (reason: ${reason})`);
            
            mergedEvent[fieldName] = chosenValue;
            
            // Log decisions when values differ
            if (existingValue !== newValue) {
                mergeDecisions.push({
                    field: fieldName,
                    existingValue: existingValue,
                    newValue: newValue,
                    chosenValue: chosenValue,
                    reason: reason
                });
            }
        });
        
        // Log merge decisions
        if (mergeDecisions.length > 0) {
            console.log(`🔄 PARSER MERGE DECISIONS for "${mergedEvent.title}":`);
            mergeDecisions.forEach(decision => {
                const existingStr = decision.existingValue === undefined ? 'undefined' : 
                                   decision.existingValue === null ? 'null' :
                                   decision.existingValue === '' ? 'empty' : 
                                   `"${decision.existingValue}"`;
                const newStr = decision.newValue === undefined ? 'undefined' : 
                               decision.newValue === null ? 'null' :
                               decision.newValue === '' ? 'empty' : 
                               `"${decision.newValue}"`;
                const chosenStr = decision.chosenValue === undefined ? 'undefined' : 
                                  decision.chosenValue === null ? 'null' :
                                  decision.chosenValue === '' ? 'empty' : 
                                  `"${decision.chosenValue}"`;
                console.log(`🔄   ${decision.field}: ${existingStr} vs ${newStr} → ${chosenStr} (${decision.reason})`);
            });
        }
        
        console.log(`🔄 MERGE DEBUG: Final merged event fields: ${JSON.stringify(Object.keys(mergedEvent))}`);
        console.log(`🔄 MERGE DEBUG: Final merged event 'url': "${mergedEvent.url}"`);
        
        return mergedEvent;
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
            // Core calendar fields that need to be preserved initially
            // These will be overridden by merge logic based on field priorities
            title: existingEvent.title,
            startDate: existingEvent.startDate,
            endDate: existingEvent.endDate,
            location: existingEvent.location,
            notes: existingEvent.notes,
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
        
        // Track clobbered fields for summary logging
        const clobberedFields = [];
        
        allFieldNames.forEach(fieldName => {
            if (fieldName.startsWith('_')) return; // Skip metadata fields
            
            const priorityConfig = fieldPriorities[fieldName];
            const mergeStrategy = priorityConfig?.merge || 'upsert';
            // Check event field first, then notes fields, but be explicit about undefined vs empty string
            const existingValue = existingEvent[fieldName] !== undefined ? existingEvent[fieldName] : existingFields[fieldName];
            const scrapedValue = finalScrapedValues[fieldName];
            
            // Debug merge logic - can be controlled via debug flags if needed
            const existingFromEvent = existingEvent[fieldName];
            const existingFromFields = existingFields[fieldName];
            
            switch (mergeStrategy) {
                case 'clobber':
                    mergedEvent[fieldName] = scrapedValue;
                    // Track when clobber actually changes a value
                    if (scrapedValue !== existingValue) {
                        clobberedFields.push(fieldName);
                    }
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
        
        // Log summary of clobbered fields
        if (clobberedFields.length > 0) {
            console.log(`🔄 CLOBBER: Updated ${clobberedFields.length} fields for "${mergedEvent.title || 'event'}": ${clobberedFields.join(', ')}`);
        }
        
        // Log coordinate handling specifically
        if (mergedEvent.location) {
            console.log(`🗺️ MERGE: Coordinates preserved for "${mergedEvent.title || 'event'}": ${mergedEvent.location}`);
        } else if (newEvent.location) {
            console.log(`🗺️ MERGE: Coordinates missing in merged event for "${mergedEvent.title || 'event'}" (original had: ${newEvent.location})`);
        }
        
        // Add any existing fields that weren't in scraped data
        // BUT respect merge strategies - don't override clobber results
        Object.keys(existingFields).forEach(fieldName => {
            if (!(fieldName in mergedEvent) && existingFields[fieldName]) {
                // Check if this field has a merge strategy that should be respected
                const priorityConfig = fieldPriorities[fieldName];
                const mergeStrategy = priorityConfig?.merge || 'upsert';
                
                // Only add existing fields if NOT clobber strategy
                // Clobber should be allowed to clear fields (set to undefined)
                if (mergeStrategy !== 'clobber') {
                    mergedEvent[fieldName] = existingFields[fieldName];
                }
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
    // Following the 6-step process: 1) scraper object, 2) calendar object, 3) simple merge, 4) gmaps, 5) notes, 6) display
    createFinalEventObject(existingEvent, newEvent) {
        // STEP 1: Build scraper object using priority list (already done - newEvent)
        const scraperObject = { ...newEvent };
        
        // STEP 2: Build calendar object using calendar data
        const calendarObject = {
            title: existingEvent.title,
            startDate: existingEvent.startDate,
            endDate: existingEvent.endDate,
            location: existingEvent.location,
            notes: existingEvent.notes,
            url: existingEvent.url,
            // Parse existing notes to get all stored field data
            ...this.parseNotesIntoFields(existingEvent.notes || '')
        };
        
        // STEP 3: Simple merge - respect merge logic, grab from correct object
        const fieldPriorities = newEvent._fieldPriorities || {};
        const mergedObject = {};
        
        // Get all possible field names from both objects
        const allFields = new Set([
            ...Object.keys(scraperObject),
            ...Object.keys(calendarObject)
        ]);
        
        // Track clobbered fields for summary logging
        const clobberedFields = [];
        
        // Apply merge logic for each field
        allFields.forEach(fieldName => {
            // Skip internal fields
            if (fieldName.startsWith('_') || fieldName === 'notes') return;
            
            const priorityConfig = fieldPriorities[fieldName];
            const mergeStrategy = priorityConfig?.merge || 'upsert';
            const scraperValue = scraperObject[fieldName];
            const calendarValue = calendarObject[fieldName];
            
            switch (mergeStrategy) {
                case 'clobber':
                    mergedObject[fieldName] = scraperValue;
                    // Track when clobber actually changes a value
                    if (scraperValue !== calendarValue) {
                        clobberedFields.push(fieldName);
                    }
                    break;
                case 'upsert':
                    mergedObject[fieldName] = calendarValue || scraperValue;
                    break;
                case 'preserve':
                default:
                    mergedObject[fieldName] = calendarValue;
                    break;
            }
        });
        
        // Log summary of clobbered fields
        if (clobberedFields.length > 0) {
            console.log(`🔄 CLOBBER: Updated ${clobberedFields.length} fields for "${mergedObject.title || 'event'}": ${clobberedFields.join(', ')}`);
        }
        
        // Log coordinate handling specifically
        if (mergedObject.location) {
            console.log(`🗺️ FINAL: Coordinates in final event for "${mergedObject.title || 'event'}": ${mergedObject.location}`);
        } else if (newEvent.location) {
            console.log(`🗺️ FINAL: Coordinates missing in final event for "${mergedObject.title || 'event'}" (scraper had: ${newEvent.location})`);
        } else if (calendarObject.location) {
            console.log(`🗺️ FINAL: Coordinates missing in final event for "${mergedObject.title || 'event'}" (calendar had: ${calendarObject.location})`);
        }
        
        // STEP 4: Gmaps URLs are already built by parsers and enrichEventLocation()
        // The merge strategy above has already chosen the correct gmaps URL
        
        // STEP 5: Build new notes from merged object
        const newNotes = this.formatEventNotes(mergedObject);
        
        // Create the final event object that represents exactly what will be saved
        const finalEvent = {
            // Core calendar fields
            title: mergedObject.title || calendarObject.title,
            startDate: mergedObject.startDate || calendarObject.startDate,
            endDate: mergedObject.endDate || calendarObject.endDate,
            location: mergedObject.location || calendarObject.location,
            notes: newNotes,
            url: mergedObject.url || calendarObject.url,
            
            // Copy all merged fields to final event
            ...mergedObject,
            
            // Override notes with the newly built ones
            notes: newNotes,
            
            // Preserve existing event reference for saving
            _existingEvent: existingEvent,
            _action: 'merge',
            
            // Keep metadata for display and comparison tables
            city: newEvent.city,
            key: newEvent.key || mergedObject.key,
            source: newEvent.source,
            _parserConfig: newEvent._parserConfig,
            _fieldPriorities: newEvent._fieldPriorities
        };
        
        // STEP 6: Pass all three objects to rich display for comparison
        
        // Store the three objects for display comparison
        finalEvent._original = {
            scraper: scraperObject,    // What the scraper found
            calendar: calendarObject,  // What was in the calendar
            merged: mergedObject       // What the merge logic produced
        };
        
        // Simple change detection for display
        const changes = [];
        if (finalEvent.title !== existingEvent.title) changes.push('title');
        if (!this.datesEqualForDisplay(finalEvent.startDate, existingEvent.startDate)) changes.push('startDate');
        if (!this.datesEqualForDisplay(finalEvent.endDate, existingEvent.endDate)) changes.push('endDate');
        if (finalEvent.location !== existingEvent.location) changes.push('location');
        if (finalEvent.url !== existingEvent.url) changes.push('url');
        if (finalEvent.notes !== existingEvent.notes) changes.push('notes');
        
        finalEvent._changes = changes;
        
        return finalEvent;
    }
    
    // ============================================================================
    // ESCAPE CHARACTER UTILITIES - Handle escaped colons in text
    // ============================================================================
    // 
    // Problem: Time formats like "Doors open at 9:00" were being parsed as metadata
    // Solution: Use backslash (\) to escape colons that should not be treated as separators
    // 
    // Examples:
    //   "Doors open at 9\:00 PM"     -> Not parsed as metadata (colon is escaped)
    //   "venue: The Bear Den"         -> Parsed as metadata (single-word key)
    //   "doors open at 9: 00"         -> Not parsed as metadata (multi-word key rejected)
    //   "description: Show at 8\:30"  -> Parsed as metadata, value = "Show at 8:30"
    // 
    // Escape Rules:
    //   \: -> :     (escaped colon becomes literal colon)
    //   \\ -> \     (escaped backslash becomes literal backslash)
    //   
    // Key Validation:
    //   - Must be single word (no spaces)
    //   - Must start with letter
    //   - Must be 2-20 characters long
    //   - Must be alphanumeric only
    // ============================================================================
    
    // Find first unescaped occurrence of a character in text
    findUnescaped(text, char, startIndex = 0) {
        for (let i = startIndex; i < text.length; i++) {
            if (text[i] === char) {
                // Count preceding backslashes to determine if this character is escaped
                let backslashCount = 0;
                for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) {
                    backslashCount++;
                }
                
                // If even number of backslashes (including 0), the character is not escaped
                if (backslashCount % 2 === 0) {
                    return i;
                }
            }
        }
        return -1;
    }
    
    // Remove escape characters from text
    unescapeText(text) {
        if (!text || typeof text !== 'string') {
            return text;
        }
        
        return text
            .replace(/\\:/g, ':')      // Unescape colons (\: -> :)
            .replace(/\\\\/g, '\\');   // Unescape backslashes (\\ -> \)
    }
    
    // Add escape characters to text to prevent parsing issues
    escapeText(text) {
        if (!text || typeof text !== 'string') {
            return text;
        }
        
        return text
            .replace(/\\/g, '\\\\')    // Escape backslashes (\ -> \\)
            .replace(/:/g, '\\:');     // Escape colons (: -> \:)
    }
    
    // Check if a key is valid for metadata (words with spaces allowed, reasonable length)
    isValidMetadataKey(key) {
        if (!key || typeof key !== 'string') {
            return false;
        }
        
        const trimmedKey = key.trim();
        
        // Must be words (spaces allowed between words) and reasonable length
        return /^[a-zA-Z][a-zA-Z0-9\s]*[a-zA-Z0-9]$/.test(trimmedKey) && 
               trimmedKey.length >= 2 && 
               trimmedKey.length <= 30;
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
            'description': 'description',
            
            // Venue/location aliases
            'venue': 'bar',
            'location': 'bar',
            'host': 'bar',
            'bar': 'bar',
            
            // Price aliases
            'price': 'cover',
            'cost': 'cover',
            'cover': 'cover',
            
            // Name aliases
            'shortname': 'shortName',
            'shortername': 'shorterName',
            'shorter name': 'shorterName',
            'shorter': 'shorterName',
            'short title': 'shortName',
            'shorttitle': 'shortName',
            'nickname': 'shortName',
            
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
            'google maps': 'gmaps',
            'gmaps': 'gmaps',
            
            // Ticket/purchase aliases
            'ticketurl': 'ticketUrl',
            'ticket url': 'ticketUrl',
            'tickets': 'ticketUrl',
            'ticket': 'ticketUrl',
            'ticketUrl': 'ticketUrl',
            
            // Other common fields
            'description': 'description',
            'image': 'image',
            'url': 'url',
            'timezone': 'timezone',
            'key': 'key'
        };
        
        const normalize = (str) => (str || '').toLowerCase().replace(/\s+/g, '');
        
        let currentKey = null;
        let currentValue = '';
        
        lines.forEach((line, index) => {
            // Use escape-aware parsing to find the first unescaped colon
            const colonIndex = this.findUnescaped(line, ':');
            
            // A valid metadata line has an unescaped colon that's not at the start
            if (colonIndex > 0) {
                // Save previous field if we have one
                if (currentKey && currentValue) {
                    const normalizedKey = normalize(currentKey);
                    const canonicalKey = aliasToCanonical.hasOwnProperty(normalizedKey)
                        ? aliasToCanonical[normalizedKey]
                        : currentKey;
                    // Description field is now saved and read literally - no normalization
                    fields[canonicalKey] = this.unescapeText(currentValue);
                }
                
                // Extract key and value, then unescape them
                const rawKey = line.substring(0, colonIndex).trim();
                const rawValue = line.substring(colonIndex + 1).trim();
                
                const unescapedKey = this.unescapeText(rawKey);
                const unescapedValue = this.unescapeText(rawValue);
                
                // Only accept valid metadata keys (single word, reasonable length)
                if (unescapedKey && this.isValidMetadataKey(unescapedKey)) {
                    currentKey = unescapedKey;
                    currentValue = unescapedValue;
                } else {
                    // Invalid key - treat this line as continuation of previous field or ignore
                    if (currentKey && line.trim()) {
                        // Add as continuation line for current field
                        if (currentValue) {
                            currentValue += '\n' + this.unescapeText(line);
                        } else {
                            currentValue = this.unescapeText(line);
                        }
                    }
                    // If no current key, ignore this line (it's not valid metadata)
                }
            } else if (currentKey && line.trim()) {
                // This is a continuation line for the current field
                // Add it to the current value with a newline, unescaping the text
                const unescapedLine = this.unescapeText(line);
                if (currentValue) {
                    currentValue += '\n' + unescapedLine;
                } else {
                    currentValue = unescapedLine;
                }
            }
            
            // Handle the last field
            if (index === lines.length - 1 && currentKey && currentValue) {
                const normalizedKey = normalize(currentKey);
                const canonicalKey = aliasToCanonical.hasOwnProperty(normalizedKey)
                    ? aliasToCanonical[normalizedKey]
                    : currentKey;
                // Description field is now saved and read literally - no normalization
                // Value is already unescaped from the parsing logic above
                fields[canonicalKey] = currentValue;
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
                // Escape selectively: do not escape URL-like fields
                const valueString = String(value);
                const valueForNotes = this.isUrlLikeField(key, valueString)
                    ? valueString
                    : this.escapeText(valueString);
                lines.push(`${key}: ${valueForNotes}`);
            }
        });
        
        return lines.join('\n');
    }

    // Normalize multi-line text to ensure consistent formatting
    // This helps prevent subtle whitespace differences between scraper runs
    normalizeMultilineText(text) {
        if (!text || typeof text !== 'string') {
            return text;
        }
        
        // Comprehensive text normalization to prevent whitespace differences from causing merge issues
        return text
            .trim()                           // Remove leading/trailing whitespace
            .replace(/\s+\n/g, '\n')         // Remove trailing spaces before newlines
            .replace(/\n\s+/g, '\n')         // Remove leading spaces after newlines
            .replace(/\s{2,}/g, ' ')         // Collapse multiple spaces into single spaces
            .replace(/\n{3,}/g, '\n\n');     // Collapse multiple newlines into double newlines
    }

    // Normalize text fields in an event object to ensure consistent comparison
    // This centralizes all text normalization logic in shared-core
    normalizeEventTextFields(event) {
        if (!event) return event;
        
        // Create a copy to avoid modifying the original
        const normalizedEvent = { ...event };
        
        // Description field is now saved and read literally - no normalization
        // We could normalize other text fields here if needed in the future
        // For example: title, bar, address, etc.
        
        return normalizedEvent;
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
            console.warn(`⚠️ SharedCore: Failed to normalize date: ${dateInput}`);
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
        console.log(`🗺️ SharedCore: generateGoogleMapsUrl called with coordinates: ${coordinates}, placeId: "${placeId}", address: "${address}"`);
        
        if (placeId && coordinates) {
            // Best case: use coordinates with place_id for maximum compatibility
            console.log(`🗺️ SharedCore: Using place_id + coordinates method`);
            return `https://www.google.com/maps/search/?api=1&query=${coordinates.lat}%2C${coordinates.lng}&query_place_id=${placeId}`;
        } else if (placeId && address) {
            // Fallback: use address with place_id (graceful degradation if place_id doesn't exist)
            console.log(`🗺️ SharedCore: Using place_id + address method`);
            return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}&query_place_id=${placeId}`;
        } else if (coordinates) {
            // Fallback: coordinates only
            console.log(`🗺️ SharedCore: Using coordinates only method`);
            return `https://maps.google.com/?q=${coordinates.lat},${coordinates.lng}`;
        } else if (address) {
            // Final fallback: address only
            console.log(`🗺️ SharedCore: Using address only method`);
            return `https://maps.google.com/?q=${encodeURIComponent(address)}`;
        }
        console.log(`🗺️ SharedCore: No valid data for URL generation, returning null`);
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
        
        // Extract and normalize city (parser may have set it for venue-specific logic, but we need to normalize it)
        const extractedCity = this.extractCityFromEvent(event);
        if (extractedCity) {
            event.city = extractedCity;
        }
        
        // Apply timezone from city configuration if not already set
        // This is needed for parsers like chunk that pass timezone: null
        if (!event.timezone && event.city && this.cities[event.city]) {
            event.timezone = this.cities[event.city].timezone;
            console.log(`🗺️ SharedCore: Applied timezone ${event.timezone} for city ${event.city}`);
        } else if (!event.timezone && event.city && !this.cities[event.city]) {
            console.log(`🚨 ERROR: No timezone configuration found for city: ${event.city}`);
            console.log(`🚨 EVENT DETAILS:`);
            console.log(`   Title: "${event.title}"`);
            console.log(`   Address: "${event.address}"`);
            console.log(`   Venue: "${event.bar}"`);
            console.log(`   URL: "${event.url}"`);
            console.log(`   Source: "${event.source}"`);
            console.log(`   City extracted from: ${event.city ? 'event.city field' : 'address parsing'}`);
            console.log(`🚨 Available cities: ${JSON.stringify(Object.keys(this.cities || {}))}`);
            console.log(`🚨 This error is coming from SharedCore`);
        }
        
        // Check if venue name indicates TBA/placeholder (these often have fake addresses/coordinates)
        const isTBAVenue = event.bar && (
                          event.bar.toLowerCase().includes('tba') || 
                          event.bar.toLowerCase().includes('to be announced'));
        
        if (isTBAVenue) {
            console.log(`🗺️ SharedCore: TBA venue "${event.bar}" detected - removing fake location data`);
            // Remove all location data for TBA venues (coordinates are usually fake city center)
            event.location = null;
            event.address = null;
            event.gmaps = '';
            return event;
        }
        
        // Generate iOS-compatible Google Maps URL using available data (address, coordinates, place_id)
        // Always generate if gmaps field is empty or undefined - merge strategies are handled later
        if (!event.gmaps) {
            // Try to enhance incomplete addresses with city information before gmaps generation
            if (event.address && event.city && !this.isFullAddress(event.address)) {
                const enhancedAddress = this.enhanceAddressWithCity(event.address, event.city);
                if (enhancedAddress !== event.address) {
                    event.address = enhancedAddress;
                }
            }
            
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
                address: event.address || null
            };
            
            event.gmaps = SharedCore.generateGoogleMapsUrl(urlData);
            
            if (event.gmaps) {
                const method = event.placeId ? 
                    (coordinates ? 'place_id + coordinates' : 'place_id + address') : 
                    (coordinates ? 'coordinates only' : 'address only');

            }
        }
        
        // Clean up location data based on what we have
        if (event.address && this.isFullAddress(event.address)) {
            // Keep address and gmaps URL
        } else if (!event.address && event.location && event.gmaps) {
            // Keep coordinates and gmaps URL
        } else if (!event.address && event.location && !event.gmaps) {
            // No valid address or gmaps URL - keep location data anyway
        }
        
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
    
    // Enhance address with city information if it's incomplete
    enhanceAddressWithCity(address, city) {
        if (!address || !city || !this.cityMappings) {
            return address;
        }

        // Find city data from cityMappings (which uses "patterns|patterns" format)
        let cityName = '';
        for (const [patterns, mappedCity] of Object.entries(this.cityMappings)) {
            if (mappedCity === city) {
                // Use the longest pattern as it's likely the most complete city name
                const patternList = patterns.split('|');
                cityName = patternList.reduce((longest, current) => 
                    current.length > longest.length ? current : longest
                );
                break;
            }
        }

        if (!cityName) {
            return address; // No city patterns found
        }

        // Check if address already contains city information (city name or state)
        const lowerAddress = address.toLowerCase();
        const lowerCityName = cityName.toLowerCase();
        
        // Check for city name or any US state abbreviation
        const stateAbbreviations = [
            'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'dc', 'fl',
            'ga', 'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me',
            'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh',
            'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri',
            'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy'
        ];
        
        if (lowerAddress.includes(lowerCityName) || 
            stateAbbreviations.some(state => lowerAddress.includes(`, ${state}`))) {
            return address; // Already contains city/state info
        }

        // Check if address needs enhancement (incomplete street address)
        const needsEnhancement = 
            // Very short addresses
            address.length < 15 ||
            // No comma (likely missing city/state)
            !address.includes(',') ||
            // Just street number and name pattern
            /^\d+\s+[NSEW]?\.?\s*[A-Za-z\s]+$/i.test(address.trim());

        if (needsEnhancement) {
            // Add proper capitalization to city name
            const properCityName = cityName.split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');
            
            return `${address.trim()}, ${properCityName}`;
        }

        return address;
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
        console.log(`🗺️ SharedCore: Address parts for "${address}": ${JSON.stringify(addressParts)}`);
        
        // Check each address part for city matches
        for (const part of addressParts) {
            const cityName = part.toLowerCase();
            console.log(`🗺️ SharedCore: Checking address part: "${cityName}"`);
            
            // Check if the city matches our mappings (includes misspellings in patterns)
            for (const [patterns, city] of Object.entries(this.cityMappings)) {
                const patternList = patterns.split('|');
                for (const pattern of patternList) {
                    // Try exact match first (simpler and more reliable)
                    if (cityName === pattern) {
                        console.log(`🗺️ SharedCore: Found exact city pattern match "${pattern}" in address part "${cityName}", returning: "${city}"`);
                        return city;
                    }
                    // Then use word boundaries to avoid substring matches
                    const regex = new RegExp(`\\b${pattern.replace(/\s+/g, '\\s+')}\\b`, 'i');
                    if (regex.test(cityName)) {
                        console.log(`🗺️ SharedCore: Found city pattern "${pattern}" in address part "${cityName}", returning: "${city}"`);
                        return city;
                    }
                }
            }
        }
        
        // If no city found in any part, try normalizing the first part
        if (addressParts.length > 0) {
            const firstPart = addressParts[0].toLowerCase();
            console.log(`🗺️ SharedCore: No pattern matched for any address part, normalizing first part "${firstPart}"`);
            const normalizedCity = this.normalizeCityName(firstPart);
            if (normalizedCity && !this.cities[normalizedCity]) {
                console.log(`⚠️  WARNING: Extracted city "${normalizedCity}" from address "${address}" has no timezone configuration`);
            }
            return normalizedCity;
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
            console.log(`🗺️ SharedCore: Using city from event.city: "${event.city}" for event: "${event.title}"`);
            // Normalize the city name to handle misspellings like "boton" -> "boston"
            const normalizedCity = this.normalizeCityName(String(event.city));
            console.log(`🗺️ SharedCore: Normalized city "${event.city}" to "${normalizedCity}"`);
            return normalizedCity;
        }
        
        // Try to extract from title
        const title = String(event.title || '').toLowerCase();
        console.log(`🗺️ SharedCore: Extracting city from title: "${title}"`);
        
        // Check for city names in title
        for (const [patterns, city] of Object.entries(this.cityMappings)) {
            const cityPatterns = patterns.split('|');
            for (const pattern of cityPatterns) {
                if (title.includes(pattern)) {
                    console.log(`🗺️ SharedCore: Found city pattern "${pattern}" in title, returning city: "${city}"`);
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
        console.log(`🗺️ SharedCore: Normalizing city name "${cityName}" to "${normalized}"`);
        
        // Check if normalized name matches any of our mappings
        for (const [patterns, city] of Object.entries(this.cityMappings)) {
            const patternList = patterns.split('|');
            if (patternList.includes(normalized)) {
                console.log(`🗺️ SharedCore: Found mapping for "${normalized}" -> "${city}"`);
                return city;
            }
        }
        
        // Return as-is if no mapping found
        console.log(`🗺️ SharedCore: No mapping found for "${normalized}", returning as-is`);
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
            'removeAllRecurrenceRules', 'save', 'remove', 'presentEdit', '_staticFields',
            // Location-specific fields that shouldn't be in notes (used internally)
            'placeId'
        ]);
        
        // Add all fields that have values (merge logic has already determined correct values)
        let savedFieldCount = 0;
        Object.keys(event).forEach(fieldName => {
            if (!excludeFields.has(fieldName) && 
                event[fieldName] !== undefined && 
                event[fieldName] !== null && 
                event[fieldName] !== '') {
                // Description field is now saved and read literally - no normalization
                const value = event[fieldName];
                const valueString = String(value);
                // Escape selectively: do not escape URL-like fields
                const valueForNotes = this.isUrlLikeField(fieldName, valueString)
                    ? valueString
                    : this.escapeText(valueString);
                notes.push(`${fieldName}: ${valueForNotes}`);
                savedFieldCount++;
            }
        });
        
        return notes.join('\n');
    }

    // Determine if a field/value should be treated as URL-like (no colon escaping)
    isUrlLikeField(fieldName, valueString) {
        // Known URL-bearing fields
        const urlFields = new Set([
            'url', 'ticketUrl', 'gmaps', 'website', 'facebook', 'instagram', 'twitter', 'image'
        ]);
        if (urlFields.has(fieldName)) return true;
        if (!valueString || typeof valueString !== 'string') return false;
        const lower = valueString.trim().toLowerCase();
        return lower.startsWith('http://') ||
               lower.startsWith('https://') ||
               lower.startsWith('mailto:') ||
               lower.startsWith('tel:') ||
               lower.startsWith('sms:');
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
        
        // Analyze each event against existing calendar events
        const analyzedEvents = [];
        
        for (const event of events) {
            // Use default merge mode since parser-level mergeMode is handled by field priorities
            const mergeMode = config.mergeMode || 'upsert';
            
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
                
                analyzedEvent._mergeDiff = {
                    preserved: [],
                    added: [],
                    updated: [],
                    removed: []
                };
                
                // Analyze what changed
                Object.keys(originalFields).forEach(key => {
                    // Check the merge strategy for this field
                    const fieldPriorities = analyzedEvent._fieldPriorities || {};
                    const priorityConfig = fieldPriorities[key];
                    const mergeStrategy = priorityConfig?.merge || 'preserve';
                    
                    if (mergedFields[key] === originalFields[key]) {
                        // For clobber strategy, even if values are the same, it should be marked as updated
                        // because the intent was to replace the value
                        if (mergeStrategy === 'clobber') {
                            analyzedEvent._mergeDiff.updated.push({ 
                                key, 
                                from: originalFields[key], 
                                to: mergedFields[key] 
                            });
                        } else {
                            analyzedEvent._mergeDiff.preserved.push(key);
                        }
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
            
            // Generate notes for ALL events to ensure consistent preview display
            // This ensures new, merge, and conflict events all have notes for the preview
            if (!analyzedEvent.notes) {
                analyzedEvent.notes = this.formatEventNotes(analyzedEvent);
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
    
    // Check if a key matches a pattern with simple wildcards (pure logic)
    // Supports * wildcards that get converted to .* for regex matching
    // Example: "chunk-chicago-presents-sausage-party|2025-10-*|*|chunk" matches "chunk-chicago-presents-sausage-party|2025-10-15|cell-block|chunk"
    matchesKeyPattern(pattern, key) {
        if (!pattern || !key) return false;
        
        // Convert * to .* for simple wildcards, but escape pipe characters
        const regexPattern = pattern.replace(/\*/g, '.*').replace(/\|/g, '\\|');
        
        try {
            const regex = new RegExp('^' + regexPattern + '$');
            return regex.test(key);
        } catch (error) {
            // If pattern is not valid regex, fall back to exact match
            return pattern === key;
        }
    }
    
    // Find event by key in existing events (pure logic, no calendar APIs)
    // First tries exact match, then tries wildcard pattern matching
    findEventByKey(existingEvents, targetKey) {
        if (!targetKey) return null;
        
        // First pass: exact match
        for (const event of existingEvents) {
            const fields = this.parseNotesIntoFields(event.notes || '');
            const eventKey = fields.key || null;
            if (eventKey === targetKey) {
                return event;
            }
        }
        
        // Second pass: wildcard pattern matching
        // Look for existing events that have wildcard patterns that match the target key
        for (const event of existingEvents) {
            const fields = this.parseNotesIntoFields(event.notes || '');
            const eventKey = fields.key || null;
            if (eventKey && eventKey.includes('*')) {
                // This existing event has a wildcard pattern, check if it matches our target
                if (this.matchesKeyPattern(eventKey, targetKey)) {
                    return event;
                }
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

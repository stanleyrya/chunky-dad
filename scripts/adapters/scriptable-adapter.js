// ============================================================================
// SCRIPTABLE ADAPTER - iOS ENVIRONMENT SPECIFIC CODE
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains iOS/Scriptable ONLY code
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Scriptable APIs (Request, Calendar, FileManager, Alert, Notification)
// ✅ iOS-specific HTTP requests and calendar operations
// ✅ Scriptable-specific file operations and UI
//
// ❌ NEVER ADD THESE TO THIS FILE:
// ❌ Web APIs (fetch, DOMParser, localStorage, document, window)
// ❌ Business logic (that belongs in shared-core.js)
// ❌ Parsing logic (that belongs in parsers/)
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

class ScriptableAdapter {
    constructor(config = {}) {
        this.config = {
            timeout: config.timeout || 30000,
            userAgent: config.userAgent || 'chunky-dad-scraper/1.0',
            ...config
        };
        
        this.calendarMappings = config.calendarMappings || {};
    }

    // HTTP Adapter Implementation
    async fetchData(url, options = {}) {
        try {
            console.log(`📱 Scriptable: Starting HTTP request to ${url}`);
            console.log(`📱 Scriptable: Request options: ${JSON.stringify(options)}`);
            
            const request = new Request(url);
            request.method = options.method || 'GET';
            request.headers = {
                'User-Agent': this.config.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                ...options.headers
            };
            
            console.log(`📱 Scriptable: Request method: ${request.method}`);
            console.log(`📱 Scriptable: Request headers: ${JSON.stringify(request.headers)}`);
            
            if (options.body) {
                request.body = options.body;
                console.log(`📱 Scriptable: Request body length: ${options.body.length}`);
            }
            
            console.log(`📱 Scriptable: Executing HTTP request...`);
            const response = await request.loadString();
            
            // Enhanced debugging - log response details
            const statusCode = request.response ? request.response.statusCode : 200;
            const headers = request.response ? request.response.headers : {};
            
            console.log(`📱 Scriptable: Response received`);
            console.log(`📱 Scriptable: Response status: ${statusCode}`);
            console.log(`📱 Scriptable: Response headers: ${JSON.stringify(headers)}`);
            console.log(`📱 Scriptable: Response length: ${response ? response.length : 0} characters`);
            
            if (statusCode >= 400) {
                throw new Error(`HTTP ${statusCode} error from ${url}`);
            }
            
            if (response && response.length > 0) {
                console.log(`📱 Scriptable: ✓ Successfully fetched ${response.length} characters of HTML from ${url}`);
                // Log first 200 characters for debugging (truncated)
                const preview = response.substring(0, 200).replace(/\s+/g, ' ');
                console.log(`📱 Scriptable: Response preview: ${preview}...`);
                
                return {
                    html: response,
                    url: url,
                    statusCode: statusCode,
                    headers: headers
                };
            } else {
                console.error(`📱 Scriptable: ✗ Empty response from ${url}`);
                throw new Error(`Empty response from ${url}`);
            }
            
        } catch (error) {
            const errorMessage = `📱 Scriptable: ✗ HTTP request failed for ${url}: ${error.message}`;
            console.log(errorMessage);
            throw new Error(`HTTP request failed for ${url}: ${error.message}`);
        }
    }

    // Configuration Loading
    async loadConfiguration() {
        try {
            console.log('📱 Scriptable: Starting configuration loading process...');
            console.log('📱 Scriptable: Loading configuration from iCloud Drive/Scriptable/scraper-input.json');
            
            const fm = FileManager.iCloud();
            console.log('📱 Scriptable: ✓ FileManager.iCloud() created');
            
            const scriptableDir = fm.documentsDirectory();
            console.log(`📱 Scriptable: Documents directory: ${scriptableDir}`);
            
            const configPath = fm.joinPath(scriptableDir, 'scraper-input.json');
            console.log(`📱 Scriptable: Configuration path: ${configPath}`);
            
            if (!fm.fileExists(configPath)) {
                console.error(`📱 Scriptable: ✗ Configuration file not found at: ${configPath}`);
                // List files in directory for debugging
                try {
                    const files = fm.listContents(scriptableDir);
                    console.log(`📱 Scriptable: Files in ${scriptableDir}: ${JSON.stringify(files)}`);
                } catch (listError) {
                    console.log(`📱 Scriptable: ✗ Failed to list directory contents: ${listError.message}`);
                }
                throw new Error('Configuration file not found at iCloud Drive/Scriptable/scraper-input.json');
            }
            
            console.log('📱 Scriptable: ✓ Configuration file exists, reading...');
            const configText = fm.readString(configPath);
            console.log(`📱 Scriptable: Configuration text length: ${configText?.length || 0} characters`);
            
            if (!configText || configText.trim().length === 0) {
                throw new Error('Configuration file is empty');
            }
            
            console.log('📱 Scriptable: Parsing JSON configuration...');
            const config = JSON.parse(configText);
            console.log('📱 Scriptable: ✓ JSON parsed successfully');
            
            // Validate configuration structure
            if (!config.parsers || !Array.isArray(config.parsers)) {
                throw new Error('Configuration missing parsers array');
            }
            
            console.log('📱 Scriptable: ✓ Configuration loaded successfully');
            console.log(`📱 Scriptable: Found ${config.parsers?.length || 0} parser configurations`);
            
            // Log parser details
            config.parsers.forEach((parser, i) => {
                console.log(`📱 Scriptable: Parser ${i + 1}: ${parser.name} (${parser.parser}) - ${parser.urls?.length || 0} URLs`);
            });
            
            return config;
            
        } catch (error) {
            console.log(`📱 Scriptable: ✗ Failed to load configuration: ${error.message}`);
            throw new Error(`Configuration loading failed: ${error.message}`);
        }
    }

    // Calendar Integration
    async addToCalendar(events, parserConfig) {
        if (!events || events.length === 0) {
            console.log('📱 Scriptable: No events to add to calendar');
            return 0;
        }

        try {
            console.log(`📱 Scriptable: Adding ${events.length} events to calendar`);
            
            let addedCount = 0;
            
            for (const event of events) {
                try {
                    const calendarName = this.getCalendarName(event, parserConfig);
                    const calendar = await this.getOrCreateCalendar(calendarName);
                    
                    // Check for existing events in a broader time range for better conflict detection
                    const startDate = new Date(event.startDate);
                    const endDate = new Date(event.endDate || event.startDate);
                    
                    // Expand search range to catch potential conflicts
                    const searchStart = new Date(startDate);
                    searchStart.setHours(0, 0, 0, 0); // Start of day
                    const searchEnd = new Date(endDate);
                    searchEnd.setHours(23, 59, 59, 999); // End of day
                    
                    const existingEvents = await CalendarEvent.between(searchStart, searchEnd, [calendar]);
                    
                    // Check for exact duplicates first (same title and time within 1 minute)
                    const exactDuplicate = existingEvents.find(existing => 
                        existing.title === event.title &&
                        this.areDatesEqual(existing.startDate, startDate, 1) // Within 1 minute, timezone-aware
                    );
                    
                    if (exactDuplicate) {
                        console.log(`📱 Scriptable: Skipping exact duplicate event: ${event.title}`);
                        continue;
                    }
                    
                    // Check for similar events that should be merged (using same logic as shared-core deduplication)
                    const similarEvent = existingEvents.find(existing => {
                        const existingKey = this.createEventKey({
                            title: existing.title,
                            startDate: existing.startDate,
                            venue: existing.location || ''
                        });
                        const newEventKey = this.createEventKey(event);
                        return existingKey === newEventKey;
                    });
                    
                    if (similarEvent) {
                        console.log(`📱 Scriptable: Found similar event to merge: "${similarEvent.title}" with "${event.title}"`);
                        
                        // Update the existing event with merged data
                        const mergedData = this.mergeEventData(similarEvent, event);
                        
                        // Update existing calendar event
                        similarEvent.title = mergedData.title;
                        similarEvent.notes = mergedData.notes;
                        if (mergedData.url && !similarEvent.url) {
                            similarEvent.url = mergedData.url;
                        }
                        if (mergedData.location && !similarEvent.location) {
                            similarEvent.location = mergedData.location;
                        }
                        
                        await similarEvent.save();
                        console.log(`📱 Scriptable: ✓ Merged event: ${similarEvent.title}`);
                        addedCount++; // Count as an update
                        continue;
                    }
                    
                    // Check for time conflicts (overlapping events) that might need merging
                    const timeConflicts = existingEvents.filter(existing => {
                        return this.doDatesOverlap(
                            existing.startDate, 
                            existing.endDate, 
                            startDate, 
                            endDate
                        );
                    });
                    
                    // For MEGAWOOF/DURO events, check if time conflicts should be merged
                    if (timeConflicts.length > 0) {
                        const shouldMergeConflict = timeConflicts.find(conflict => {
                            return this.shouldMergeTimeConflict(conflict, event);
                        });
                        
                        if (shouldMergeConflict) {
                            console.log(`📱 Scriptable: Merging time conflict: "${shouldMergeConflict.title}" with "${event.title}"`);
                            
                            // Update the existing event with merged data
                            const mergedData = this.mergeEventData(shouldMergeConflict, event);
                            
                            shouldMergeConflict.title = mergedData.title;
                            shouldMergeConflict.notes = mergedData.notes;
                            if (mergedData.url && !shouldMergeConflict.url) {
                                shouldMergeConflict.url = mergedData.url;
                            }
                            if (mergedData.location && !shouldMergeConflict.location) {
                                shouldMergeConflict.location = mergedData.location;
                            }
                            
                            await shouldMergeConflict.save();
                            console.log(`📱 Scriptable: ✓ Merged time conflict: ${shouldMergeConflict.title}`);
                            addedCount++; // Count as an update
                            continue;
                        } else {
                            console.log(`📱 Scriptable: ⚠️ Time conflict detected but not merging: ${event.title}`);
                            timeConflicts.forEach(conflict => {
                                console.log(`   - Conflicts with: "${conflict.title}": ${conflict.startDate.toLocaleString()} - ${conflict.endDate.toLocaleString()}`);
                            });
                        }
                    }
                    
                    // Create new calendar event if no conflicts or merges
                    const calendarEvent = new CalendarEvent();
                    calendarEvent.title = event.title;
                    calendarEvent.startDate = startDate;
                    calendarEvent.endDate = endDate;
                    calendarEvent.location = event.venue || '';
                    calendarEvent.notes = this.formatEventNotes(event);
                    calendarEvent.calendar = calendar;
                    
                    // Set URL if available
                    if (event.url) {
                        calendarEvent.url = event.url;
                    }
                    
                    await calendarEvent.save();
                    addedCount++;
                    
                    console.log(`📱 Scriptable: ✓ Added event: ${event.title}`);
                    
                } catch (error) {
                    console.log(`📱 Scriptable: ✗ Failed to add event "${event.title}": ${error.message}`);
                }
            }
            
            console.log(`📱 Scriptable: ✓ Successfully processed ${addedCount} events to calendar`);
            return addedCount;
            
        } catch (error) {
            console.log(`📱 Scriptable: ✗ Calendar integration error: ${error.message}`);
            throw new Error(`Calendar integration failed: ${error.message}`);
        }
    }

    async getOrCreateCalendar(calendarName) {
        try {
            // Try to find existing calendar
            const calendars = await Calendar.forEvents();
            let calendar = calendars.find(cal => cal.title === calendarName);
            
            if (!calendar) {
                // NEVER create new calendars - throw error instead
                const errorMsg = `Calendar "${calendarName}" does not exist. Please create it manually first.`;
                console.log(`📱 Scriptable: ✗ ${errorMsg}`);
                throw new Error(errorMsg);
            }
            
            return calendar;
            
        } catch (error) {
            console.log(`📱 Scriptable: ✗ Failed to get calendar "${calendarName}": ${error.message}`);
            throw error;
        }
    }

    getCalendarName(event, parserConfig) {
        // Use calendar mapping from config
        const city = event.city || 'default';
        return this.calendarMappings[city] || `chunky-dad-${city}`;
    }

    formatEventNotes(event) {
        const notes = [];
        
        if (event.description) {
            notes.push(event.description);
        }
        
        if (event.price) {
            notes.push(`Price: ${event.price}`);
        }
        
        if (event.source) {
            notes.push(`Source: ${event.source}`);
        }
        
        if (event.url && !notes.join(' ').includes(event.url)) {
            notes.push(`More info: ${event.url}`);
        }
        
        return notes.join('\n\n');
    }

    // Display/Logging Adapter Implementation
    async logInfo(message) {
        console.log(message);
    }

    async logSuccess(message) {
        console.log(message);
    }

    async logWarn(message) {
        console.warn(message);
    }

    async logError(message) {
        console.error(message);
    }

    // Results Display - Enhanced with calendar preview and comparison
    async displayResults(results) {
        try {
            // First show the enhanced display features
            await this.displayCalendarProperties(results);
            await this.compareWithExistingCalendars(results);
            await this.displayAvailableCalendars();
            await this.displayEnrichedEvents(results);
            
            // Then show the standard results summary
            console.log('\n' + '='.repeat(60));
            console.log('🐻 BEAR EVENT SCRAPER RESULTS');
            console.log('='.repeat(60));
            
            console.log(`📊 Total Events Found: ${results.totalEvents}`);
            console.log(`🐻 Bear Events: ${results.bearEvents}`);
            console.log(`📅 Added to Calendar: ${results.calendarEvents}`);
            
            if (results.errors.length > 0) {
                console.log(`❌ Errors: ${results.errors.length}`);
                results.errors.forEach(error => console.log(`   • ${error}`));
            }
            
            console.log('\n📋 Parser Results:');
            results.parserResults.forEach(result => {
                console.log(`   • ${result.name}: ${result.bearEvents} bear events`);
            });
            
            // Show summary and recommended actions
            await this.displaySummaryAndActions(results);
            
            console.log('\n' + '='.repeat(60));
            
        } catch (error) {
            console.log(`📱 Scriptable: Error displaying results: ${error.message}`);
        }
    }

    // Error handling with user-friendly alerts
    async showError(title, message) {
        try {
            const alert = new Alert();
            alert.title = title;
            alert.message = message;
            alert.addAction('OK');
            await alert.present();
        } catch (error) {
            console.log(`Failed to show error alert: ${error.message}`);
        }
    }

    // Enhanced Display Methods
    async displayCalendarProperties(results) {
        console.log('\n' + '='.repeat(60));
        console.log('📅 CALENDAR PROPERTIES & STORAGE PREVIEW');
        console.log('='.repeat(60));
        
        // Get all events from all parser results
        const allEvents = this.getAllEventsFromResults(results);
        if (!allEvents || !allEvents.length) {
            console.log('❌ No event data available for preview');
            return;
        }

        // Get available calendars for comparison
        const availableCalendars = await Calendar.forEvents();

        // Show how events will be stored
        allEvents.forEach((event, i) => {
            console.log(`\n🐻 Event ${i + 1}: ${event.title || event.name}`);
            console.log('─'.repeat(40));
            
            // Calendar assignment
            const calendarName = this.getCalendarName(event, null);
            console.log(`📅 Target Calendar: "${calendarName}"`);
            
            // Check if calendar exists
            const existingCalendar = availableCalendars.find(cal => cal.title === calendarName);
            if (existingCalendar) {
                console.log(`✅ Calendar exists: ${existingCalendar.identifier}`);
                console.log(`   Color: ${existingCalendar.color.hex}`);
                console.log(`   Modifications allowed: ${existingCalendar.allowsContentModifications}`);
            } else {
                console.log(`❌ Calendar does not exist - must be created manually first`);
            }
            
            // Event properties that will be stored
            console.log(`\n📋 CalendarEvent Properties:`);
            console.log(`   title: "${event.title || event.name}"`);
            console.log(`   startDate: ${new Date(event.startDate).toLocaleString()}`);
            console.log(`   endDate: ${new Date(event.endDate || event.startDate).toLocaleString()}`);
            console.log(`   location: "${event.venue || event.bar || ''}"`);
            console.log(`   timeZone: "${event.timezone || 'device default'}"`);
            console.log(`   isAllDay: false`);
            
            // Recurrence handling
            if (event.recurring && event.recurrence) {
                console.log(`   🔄 Recurrence: ${event.recurrence}`);
                console.log(`   Event Type: ${event.eventType || 'recurring'}`);
            } else {
                console.log(`   🔄 Recurrence: None (one-time event)`);
            }
            
            // Notes field content
            const notes = this.formatEventNotes(event);
            console.log(`\n📝 Notes field content (${notes.length} chars):`);
            console.log(`"${notes.substring(0, 100)}${notes.length > 100 ? '...' : ''}"`);
            
            // Availability setting
            console.log(`\n⏰ Availability: busy`);
            
            // City and timezone info
            console.log(`\n🌍 Location Data:`);
            console.log(`   City: ${event.city || 'unknown'}`);
            if (event.coordinates) {
                console.log(`   Coordinates: ${event.coordinates.lat}, ${event.coordinates.lng}`);
            }
            console.log(`   Timezone: ${event.timezone || 'device default'}`);
        });
        
        console.log('\n' + '='.repeat(60));
    }

    async compareWithExistingCalendars(results) {
        console.log('\n' + '='.repeat(60));
        console.log('🔍 CALENDAR COMPARISON & CONFLICT DETECTION');
        console.log('='.repeat(60));
        
        // Get all events from all parser results
        const allEvents = this.getAllEventsFromResults(results);
        if (!allEvents || !allEvents.length) {
            console.log('❌ No events to compare');
            return;
        }

        const availableCalendars = await Calendar.forEvents();
        
        for (const event of allEvents) {
            const calendarName = this.getCalendarName(event, null);
            const calendar = availableCalendars.find(cal => cal.title === calendarName);
            
            console.log(`\n🐻 Checking: ${event.title || event.name}`);
            console.log(`📅 Target Calendar: ${calendarName}`);
            
            if (!calendar) {
                console.log(`❌ Calendar "${calendarName}" doesn't exist - must be created manually first`);
                continue;
            }
            
            try {
                // Check for existing events in the time range
                const startDate = new Date(event.startDate);
                const endDate = new Date(event.endDate || event.startDate);
                
                // Expand search range for recurring events
                const searchStart = new Date(startDate);
                searchStart.setDate(searchStart.getDate() - 7); // Look back a week
                const searchEnd = new Date(endDate);
                searchEnd.setDate(searchEnd.getDate() + 30); // Look ahead a month
                
                const existingEvents = await CalendarEvent.between(searchStart, searchEnd, [calendar]);
                
                console.log(`📊 Found ${existingEvents.length} existing events in calendar`);
                
                // Check for exact duplicates
                const duplicates = existingEvents.filter(existing => {
                    const titleMatch = existing.title === (event.title || event.name);
                    const timeMatch = Math.abs(existing.startDate.getTime() - startDate.getTime()) < 60000; // Within 1 minute
                    return titleMatch && timeMatch;
                });
                
                if (duplicates.length > 0) {
                    console.log(`⚠️  Found ${duplicates.length} potential duplicate(s):`);
                    duplicates.forEach(dup => {
                        console.log(`   - "${dup.title}" at ${dup.startDate.toLocaleString()}`);
                    });
                } else {
                    console.log(`✅ No duplicates found - safe to add`);
                }
                
                // Check for time conflicts (overlapping events)
                const conflicts = existingEvents.filter(existing => {
                    const existingStart = existing.startDate.getTime();
                    const existingEnd = existing.endDate.getTime();
                    const newStart = startDate.getTime();
                    const newEnd = endDate.getTime();
                    
                    // Check for overlap
                    return (newStart < existingEnd && newEnd > existingStart);
                });
                
                if (conflicts.length > 0) {
                    console.log(`⏰ Found ${conflicts.length} time conflict(s):`);
                    conflicts.forEach(conflict => {
                        console.log(`   - "${conflict.title}": ${conflict.startDate.toLocaleString()} - ${conflict.endDate.toLocaleString()}`);
                    });
                } else {
                    console.log(`✅ No time conflicts found`);
                }
                
            } catch (error) {
                console.error(`❌ Failed to check calendar "${calendarName}": ${error}`);
            }
        }
        
        console.log('\n' + '='.repeat(60));
    }

    async displayAvailableCalendars() {
        console.log('\n' + '='.repeat(60));
        console.log('📅 AVAILABLE CALENDARS (DEBUG INFO)');
        console.log('='.repeat(60));
        
        try {
            const availableCalendars = await Calendar.forEvents();
            
            if (availableCalendars.length === 0) {
                console.log('❌ No calendars found or failed to load');
                return;
            }
            
            console.log(`📊 Total calendars: ${availableCalendars.length}\n`);
            
            availableCalendars.forEach((calendar, i) => {
                console.log(`📅 Calendar ${i + 1}: "${calendar.title}"`);
                console.log(`   ID: ${calendar.identifier}`);
                console.log(`   Color: ${calendar.color.hex}`);
                console.log(`   Subscribed: ${calendar.isSubscribed ? 'Yes' : 'No'}`);
                console.log(`   Modifications: ${calendar.allowsContentModifications ? 'Allowed' : 'Read-only'}`);
                console.log('');
            });
            
            // Show which calendars are mapped
            console.log('🗺️  Calendar Mappings:');
            Object.entries(this.calendarMappings).forEach(([city, calendarName]) => {
                const exists = availableCalendars.find(cal => cal.title === calendarName);
                const status = exists ? '✅ Exists' : '❌ Missing (create manually)';
                console.log(`   ${city} → "${calendarName}" ${status}`);
            });
            
        } catch (error) {
            console.error(`❌ Failed to load calendars: ${error}`);
        }
        
        console.log('\n' + '='.repeat(60));
    }

    async displayEnrichedEvents(results) {
        console.log('\n' + '='.repeat(60));
        console.log('🐻 ENRICHED EVENT INFORMATION');
        console.log('='.repeat(60));
        
        // Get all events from all parser results
        const allEvents = this.getAllEventsFromResults(results);
        if (!allEvents || !allEvents.length) {
            console.log('❌ No events to display');
            return;
        }
        
        allEvents.forEach((event, i) => {
            console.log(`\n🎉 Event ${i + 1}: ${event.title || event.name}`);
            console.log('─'.repeat(50));
            
            // Basic info
            console.log(`📍 Venue: ${event.venue || event.bar || 'TBD'}`);
            console.log(`📅 When: ${event.day || 'TBD'} ${event.time || 'TBD'}`);
            console.log(`🌍 City: ${(event.city || 'unknown').toUpperCase()}`);
            console.log(`🕐 Timezone: ${event.timezone || 'device default'}`);
            
            // Event type and recurrence
            if (event.recurring) {
                console.log(`🔄 Type: ${event.eventType || 'recurring'} recurring event`);
                if (event.recurrence) {
                    console.log(`📋 Pattern: ${event.recurrence}`);
                }
            } else {
                console.log(`📅 Type: One-time event`);
            }
            
            // Cover and pricing
            if (event.price || event.cover) {
                const price = event.price || event.cover;
                const coverIcon = price.toLowerCase().includes('free') ? '🆓' : '💰';
                console.log(`${coverIcon} Cover: ${price}`);
            }
            
            // Location with coordinates
            if (event.coordinates) {
                console.log(`🗺️  Coordinates: ${event.coordinates.lat}, ${event.coordinates.lng}`);
            }
            
            // Description
            if (event.description || event.tea) {
                console.log(`\n☕ Description:`);
                console.log(`   ${event.description || event.tea}`);
            }
            
            // Links and social media
            if (event.links && event.links.length > 0) {
                console.log(`\n🔗 Links:`);
                event.links.forEach(link => {
                    console.log(`   ${link.label}: ${link.url}`);
                });
            } else if (event.url) {
                console.log(`\n🔗 URL: ${event.url}`);
            }
            
            // Short names for display optimization
            if (event.shortName && event.shortName !== (event.title || event.name)) {
                console.log(`\n📱 Display Names:`);
                console.log(`   Short: "${event.shortName}"`);
                if (event.shorterName) {
                    console.log(`   Shorter: "${event.shorterName}"`);
                }
            }
            
            // Calendar event preview
            console.log(`\n📅 Calendar Event Preview:`);
            console.log(`   Title: "${event.title || event.name}"`);
            console.log(`   Start: ${new Date(event.startDate).toLocaleString()}`);
            console.log(`   End: ${new Date(event.endDate || event.startDate).toLocaleString()}`);
            console.log(`   Location: "${event.venue || event.bar || ''}"`);
            console.log(`   Notes: ${this.formatEventNotes(event).length} characters`);
        });
        
        console.log('\n' + '='.repeat(60));
    }

    async displaySummaryAndActions(results) {
        console.log('\n' + '='.repeat(60));
        console.log('📊 SUMMARY & RECOMMENDED ACTIONS');
        console.log('='.repeat(60));
        
        // Get all events from all parser results
        const allEvents = this.getAllEventsFromResults(results);
        if (!allEvents || !allEvents.length) {
            console.log('❌ No event data available for summary');
            return;
        }
        
        const summary = {
            totalEvents: allEvents.length,
            cities: [...new Set(allEvents.map(e => e.city).filter(Boolean))],
            recurringEvents: allEvents.filter(e => e.recurring).length,
            oneTimeEvents: allEvents.filter(e => !e.recurring).length,
            calendarsNeeded: [...new Set(allEvents.map(e => this.getCalendarName(e, null)))],
            timezones: [...new Set(allEvents.map(e => e.timezone).filter(Boolean))]
        };
        
        console.log(`📊 Events: ${summary.totalEvents} total`);
        console.log(`   🔄 Recurring: ${summary.recurringEvents}`);
        console.log(`   📅 One-time: ${summary.oneTimeEvents}`);
        
        if (summary.cities.length > 0) {
            console.log(`\n🌍 Cities: ${summary.cities.join(', ')}`);
        }
        
        console.log(`📅 Calendars needed: ${summary.calendarsNeeded.length}`);
        try {
            const availableCalendars = await Calendar.forEvents();
            summary.calendarsNeeded.forEach(cal => {
                const exists = availableCalendars.find(c => c.title === cal);
                console.log(`   - "${cal}" ${exists ? '(exists)' : '(will create)'}`);
            });
        } catch (error) {
            summary.calendarsNeeded.forEach(cal => {
                console.log(`   - "${cal}" (status unknown)`);
            });
        }
        
        if (summary.timezones.length > 0) {
            console.log(`\n🕐 Timezones: ${summary.timezones.join(', ')}`);
        }
        
        console.log(`\n🎯 Recommended Actions:`);
        console.log(`   1. Review calendar properties above`);
        console.log(`   2. Check for conflicts in comparison section`);
        console.log(`   3. Verify calendar permissions and settings`);
        console.log(`   4. Set dryRun: false in config to actually add events`);
        
        console.log('\n' + '='.repeat(60));
    }

    // Helper method to extract all events from parser results
    getAllEventsFromResults(results) {
        if (!results || !results.parserResults) {
            return [];
        }
        
        const allEvents = [];
        for (const parserResult of results.parserResults) {
            if (parserResult.events && parserResult.events.length > 0) {
                allEvents.push(...parserResult.events);
            }
        }
        
        return allEvents;
    }

    // Helper method to create event keys for comparison (same logic as shared-core)
    createEventKey(event) {
        let title = String(event.title || '').toLowerCase().trim();
        
        // Normalize Megawoof/DURO event titles for better deduplication
        if (/d[\s\>\-]*u[\s\>\-]*r[\s\>\-]*o/i.test(title) || /megawoof/i.test(title)) {
            const duroMatch = title.match(/d[\s\>\-]*u[\s\>\-]*r[\s\>\-]*o/i);
            if (duroMatch) {
                title = title.replace(/d[\s\>\-]*u[\s\>\-]*r[\s\>\-]*o[^\w]*/i, 'megawoof-duro');
            } else if (/megawoof/i.test(title)) {
                title = title.replace(/megawoof[:\s\-]*/i, 'megawoof-');
            }
        }
        
        // Use a more robust date comparison that handles timezones better
        const date = this.normalizeEventDate(event.startDate);
        const venue = String(event.venue || event.location || '').toLowerCase().trim();
        
        return `${title}|${date}|${venue}`;
    }

    // Helper method to normalize event dates for consistent comparison
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
            console.log(`📱 Scriptable: Warning - Failed to normalize date: ${dateInput}, error: ${error.message}`);
            return '';
        }
    }

    // Helper method to compare dates with timezone awareness
    areDatesEqual(date1, date2, toleranceMinutes = 1) {
        try {
            const d1 = new Date(date1);
            const d2 = new Date(date2);
            
            if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
                return false;
            }
            
            const diffMs = Math.abs(d1.getTime() - d2.getTime());
            const toleranceMs = toleranceMinutes * 60 * 1000;
            
            return diffMs <= toleranceMs;
        } catch (error) {
            console.log(`📱 Scriptable: Warning - Failed to compare dates: ${error.message}`);
            return false;
        }
    }

    // Helper method to check if two dates overlap (for time conflict detection)
    doDatesOverlap(start1, end1, start2, end2) {
        try {
            const s1 = new Date(start1).getTime();
            const e1 = new Date(end1).getTime();
            const s2 = new Date(start2).getTime();
            const e2 = new Date(end2).getTime();
            
            // Check for any overlap
            return s1 < e2 && s2 < e1;
        } catch (error) {
            console.log(`📱 Scriptable: Warning - Failed to check date overlap: ${error.message}`);
            return false;
        }
    }

    // Helper method to determine if time conflicts should be merged
    shouldMergeTimeConflict(existingEvent, newEvent) {
        // Check if both events are similar enough to be the same event
        const existingTitle = existingEvent.title.toLowerCase().trim();
        const newTitle = newEvent.title.toLowerCase().trim();
        
        // For MEGAWOOF/DURO events, be more aggressive about merging
        const isMegawoofConflict = (
            (/megawoof|d[\s\>\-]*u[\s\>\-]*r[\s\>\-]*o/i.test(existingTitle) && 
             /megawoof|d[\s\>\-]*u[\s\>\-]*r[\s\>\-]*o/i.test(newTitle))
        );
        
        if (isMegawoofConflict) {
            console.log(`📱 Scriptable: MEGAWOOF conflict detected - should merge: "${existingEvent.title}" vs "${newEvent.title}"`);
            return true;
        }
        
        // Check for other similar event patterns
        const titleSimilarity = this.calculateTitleSimilarity(existingTitle, newTitle);
        if (titleSimilarity > 0.8) { // 80% similarity threshold
            console.log(`📱 Scriptable: High title similarity (${Math.round(titleSimilarity * 100)}%) - should merge: "${existingEvent.title}" vs "${newEvent.title}"`);
            return true;
        }
        
        return false;
    }

    // Helper method to calculate title similarity
    calculateTitleSimilarity(title1, title2) {
        // Simple Jaccard similarity based on words
        const words1 = new Set(title1.split(/\s+/));
        const words2 = new Set(title2.split(/\s+/));
        
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);
        
        return intersection.size / union.size;
    }

    // Helper method to merge event data
    mergeEventData(existingEvent, newEvent) {
        const existingNotes = existingEvent.notes || '';
        const newNotes = this.formatEventNotes(newEvent);
        
        // Combine notes if they're different
        let mergedNotes = existingNotes;
        if (newNotes && newNotes !== existingNotes) {
            mergedNotes = existingNotes ? `${existingNotes}\n\n--- Additional Info ---\n${newNotes}` : newNotes;
        }
        
        return {
            title: existingEvent.title, // Keep existing title
            notes: mergedNotes,
            url: existingEvent.url || newEvent.url,
            location: existingEvent.location || newEvent.venue
        };
    }
}

// Export for Scriptable environment
module.exports = { ScriptableAdapter };
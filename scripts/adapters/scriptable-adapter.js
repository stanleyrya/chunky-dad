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
        this.lastResults = null; // Store last results for calendar display
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

    // Get existing events for a specific event (called by shared-core)
    async getExistingEvents(event) {
        try {
            // Determine calendar name from city
            const city = event.city || 'default';
            const calendarName = this.calendarMappings[city] || `chunky-dad-${city}`;
            const calendar = await this.getOrCreateCalendar(calendarName);
            
            // Parse dates from formatted event
            const startDate = new Date(event.startDate);
            const endDate = new Date(event.endDate);
            
            // Expand search range for conflict detection
            const searchStart = new Date(startDate);
            searchStart.setHours(0, 0, 0, 0);
            const searchEnd = new Date(endDate);
            searchEnd.setHours(23, 59, 59, 999);
            
            const existingEvents = await CalendarEvent.between(searchStart, searchEnd, [calendar]);
            return existingEvents;
            
        } catch (error) {
            console.log(`📱 Scriptable: ✗ Failed to get existing events: ${error.message}`);
            return [];
        }
    }
    
    // Execute calendar actions determined by shared-core
    async executeCalendarActions(analyzedEvents, config) {
        if (!analyzedEvents || analyzedEvents.length === 0) {
            console.log('📱 Scriptable: No events to process');
            return 0;
        }

        try {
            console.log(`📱 Scriptable: Executing actions for ${analyzedEvents.length} events`);
            
            let processedCount = 0;
            const calendarMappings = config.calendarMappings || this.calendarMappings;
            
            for (const event of analyzedEvents) {
                try {
                    const city = event.city || 'default';
                    const calendarName = calendarMappings[city] || `chunky-dad-${city}`;
                    const calendar = await this.getOrCreateCalendar(calendarName);
                    
                    switch (event._action) {
                        case 'merge':
                            console.log(`📱 Scriptable: Merging event: ${event.title}`);
                            const targetEvent = event._existingEvent;
                            const mergedData = this.mergeEventData(targetEvent, event);
                            
                            // Log what's being changed
                            const changes = [];
                            if (targetEvent.notes !== mergedData.notes) {
                                changes.push('notes');
                            }
                            if (!targetEvent.url && event.url) {
                                changes.push('url (added)');
                            }
                            if (targetEvent.location !== event.location && event.location) {
                                changes.push('location (updated)');
                            }
                            
                            console.log(`📱 Scriptable: Changes to apply: ${changes.length > 0 ? changes.join(', ') : 'none'}`);
                            
                            targetEvent.notes = mergedData.notes;
                            if (!targetEvent.url && event.url) {
                                targetEvent.url = event.url;
                            }
                            // Update location only if new event has coordinates
                            if (event.location && event.location.includes(',')) {
                                targetEvent.location = event.location;
                            }
                            await targetEvent.save();
                            processedCount++;
                            break;
                            
                        case 'update':
                            console.log(`📱 Scriptable: Updating event: ${event.title}`);
                            const updateTarget = event._existingEvent;
                            
                            // For updates (exact duplicates), replace everything
                            const updateChanges = [];
                            if (updateTarget.title !== event.title) {
                                updateChanges.push('title');
                                updateTarget.title = event.title;
                            }
                            if (updateTarget.notes !== event.notes) {
                                updateChanges.push('notes (replaced)');
                                updateTarget.notes = event.notes;
                            }
                            if (updateTarget.location !== event.location) {
                                updateChanges.push('location (replaced)');
                                updateTarget.location = event.location;
                            }
                            if (updateTarget.url !== event.url && event.url) {
                                updateChanges.push('url (replaced)');
                                updateTarget.url = event.url;
                            }
                            
                            console.log(`📱 Scriptable: Changes to apply: ${updateChanges.length > 0 ? updateChanges.join(', ') : 'none'}`);
                            
                            await updateTarget.save();
                            processedCount++;
                            break;
                            
                        case 'conflict':
                            console.log(`📱 Scriptable: Skipping conflicted event: ${event.title} (${event._analysis?.reason || 'conflict detected'})`);
                            break;
                            
                        case 'new':
                            console.log(`📱 Scriptable: Creating new event: ${event.title}`);
                            const calendarEvent = new CalendarEvent();
                            calendarEvent.title = event.title;
                            calendarEvent.startDate = new Date(event.startDate);
                            calendarEvent.endDate = new Date(event.endDate);
                            calendarEvent.location = event.location;
                            calendarEvent.notes = event.notes;
                            calendarEvent.calendar = calendar;
                            
                            if (event.url) {
                                calendarEvent.url = event.url;
                            }
                            
                            await calendarEvent.save();
                            processedCount++;
                            break;
                    }
                    
                } catch (error) {
                    console.log(`📱 Scriptable: ✗ Failed to process event "${event.title}": ${error.message}`);
                }
            }
            
            console.log(`📱 Scriptable: ✓ Successfully processed ${processedCount} events to calendar`);
            return processedCount;
            
        } catch (error) {
            console.log(`📱 Scriptable: ✗ Calendar execution error: ${error.message}`);
            throw new Error(`Calendar execution failed: ${error.message}`);
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
            // Store results for use in other methods
            this.lastResults = results;
            
            // First show the enhanced display features in console for debugging
            await this.displayCalendarProperties(results);
            await this.compareWithExistingCalendars(results);
            await this.displayAvailableCalendars();
            await this.displayEnrichedEvents(results);
            
            // Show console summary
            console.log('\n' + '='.repeat(60));
            console.log('🐻 BEAR EVENT SCRAPER RESULTS');
            console.log('='.repeat(60));
            
            console.log(`📊 Total Events Found: ${results.totalEvents}`);
            console.log(`🐻 Bear Events: ${results.bearEvents}`);
            console.log(`📅 Added to Calendar: ${results.calendarEvents}`);
            
            // Show event actions summary if available
            const allEvents = this.getAllEventsFromResults(results);
            if (allEvents && allEvents.length > 0) {
                const actionsCount = {
                    new: 0, add: 0, merge: 0, update: 0, conflict: 0, enriched: 0
                };
                
                let hasActions = false;
                allEvents.forEach(event => {
                    if (event._action) {
                        hasActions = true;
                        const action = event._action.toLowerCase();
                        if (actionsCount.hasOwnProperty(action)) {
                            actionsCount[action]++;
                        }
                    }
                });
                
                if (hasActions) {
                    console.log('\n🎯 Event Actions:');
                    Object.entries(actionsCount).forEach(([action, count]) => {
                        if (count > 0) {
                            const actionIcon = {
                                'new': '➕', 'add': '➕', 'merge': '🔄', 
                                'update': '📝', 'conflict': '⚠️', 'enriched': '✨'
                            }[action] || '❓';
                            console.log(`   ${actionIcon} ${action.toUpperCase()}: ${count}`);
                        }
                    });
                }
            }
            
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
            
            // Present rich UI display
            await this.presentRichResults(results);
            
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
            const calendarName = this.getCalendarNameForDisplay(event);
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
            
            // Notes field content (should already be formatted by shared-core)
            const notes = event.notes || '';
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
            const calendarName = this.getCalendarNameForDisplay(event);
            const calendar = availableCalendars.find(cal => cal.title === calendarName);
            
            console.log(`\n🐻 Checking: ${event.title || event.name}`);
            console.log(`📅 Target Calendar: ${calendarName}`);
            
            if (!calendar) {
                console.log(`❌ Calendar "${calendarName}" doesn't exist - must be created manually first`);
                // Mark event as missing calendar for display
                event._action = 'missing_calendar';
                event._analysis = {
                    action: 'missing_calendar',
                    reason: `Calendar "${calendarName}" does not exist`,
                    calendarName: calendarName
                };
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
                        
                        // Check if this conflict should be merged
                        const shouldMerge = this.shouldMergeTimeConflict(conflict, event);
                        if (shouldMerge) {
                            console.log(`     🔄 This conflict SHOULD BE MERGED based on merge rules`);
                        } else {
                            console.log(`     ⚠️  This conflict will NOT be merged - different events`);
                        }
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
        console.log('📅 CALENDAR STATUS');
        console.log('='.repeat(60));
        
        try {
            const availableCalendars = await Calendar.forEvents();
            
            if (availableCalendars.length === 0) {
                console.log('❌ No calendars found or failed to load');
                return;
            }
            
            // Get all events to see which calendars we need
            const allEvents = this.getAllEventsFromResults(this.lastResults);
            const neededCalendars = new Set();
            allEvents.forEach(event => {
                const calendarName = this.getCalendarNameForDisplay(event);
                neededCalendars.add(calendarName);
            });
            
            console.log(`📊 Calendars needed for events: ${neededCalendars.size}`);
            
            // Show only the calendars we need and their status
            const foundCalendars = [];
            const missingCalendars = [];
            
            neededCalendars.forEach(calendarName => {
                const exists = availableCalendars.find(cal => cal.title === calendarName);
                if (exists) {
                    foundCalendars.push(calendarName);
                } else {
                    missingCalendars.push(calendarName);
                }
            });
            
            if (foundCalendars.length > 0) {
                console.log(`\n✅ Found calendars (${foundCalendars.length}):`);
                foundCalendars.forEach(cal => console.log(`   • ${cal}`));
            }
            
            if (missingCalendars.length > 0) {
                console.log(`\n❌ Missing calendars (${missingCalendars.length}) - create manually:`);
                missingCalendars.forEach(cal => console.log(`   • ${cal}`));
            }
            
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
            
            // Calendar action information
            if (event._action || event._analysis) {
                console.log(`\n🎯 Calendar Action:`);
                const actionIcon = {
                    'new': '➕',
                    'add': '➕', 
                    'merge': '🔄',
                    'update': '📝',
                    'conflict': '⚠️',
                    'enriched': '✨'
                }[event._action] || '❓';
                
                console.log(`   ${actionIcon} Action: ${(event._action || 'unknown').toUpperCase()}`);
                
                if (event._analysis?.reason) {
                    console.log(`   📋 Reason: ${event._analysis.reason}`);
                }
                
                if (event._existingEvent) {
                    console.log(`   🔗 Existing Event: "${event._existingEvent.title}"`);
                }
                
                if (event._existingKey) {
                    console.log(`   🔑 Existing Key: ${event._existingKey}`);
                }
                
                if (event._conflicts && event._conflicts.length > 0) {
                    console.log(`   ⚠️ Conflicts: ${event._conflicts.length} found`);
                    event._conflicts.forEach(conflict => {
                        console.log(`      - "${conflict.title}"`);
                    });
                }
            }

            // Calendar event preview
            console.log(`\n📅 Calendar Event Preview:`);
            console.log(`   Title: "${event.title || event.name}"`);
            console.log(`   Start: ${new Date(event.startDate).toLocaleString()}`);
            console.log(`   End: ${new Date(event.endDate || event.startDate).toLocaleString()}`);
            console.log(`   Location: "${event.venue || event.bar || ''}"`);
            const eventNotes = event.notes || '';
            console.log(`   Notes: ${eventNotes.length} characters`);
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
            calendarsNeeded: [...new Set(allEvents.map(e => this.getCalendarNameForDisplay(e)))],
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
        
        // Show action breakdown if events have been analyzed
        const actionsCount = {
            new: 0,
            add: 0,
            merge: 0,
            update: 0,
            conflict: 0,
            enriched: 0,
            unknown: 0
        };
        
        let hasActions = false;
        allEvents.forEach(event => {
            if (event._action) {
                hasActions = true;
                const action = event._action.toLowerCase();
                if (actionsCount.hasOwnProperty(action)) {
                    actionsCount[action]++;
                } else {
                    actionsCount.unknown++;
                }
            }
        });
        
        if (hasActions) {
            console.log(`\n🎯 Event Actions Analysis:`);
            Object.entries(actionsCount).forEach(([action, count]) => {
                if (count > 0) {
                    const actionIcon = {
                        'new': '➕',
                        'add': '➕',
                        'merge': '🔄',
                        'update': '📝',
                        'conflict': '⚠️',
                        'enriched': '✨',
                        'unknown': '❓'
                    }[action] || '❓';
                    
                    console.log(`   ${actionIcon} ${action.toUpperCase()}: ${count} events`);
                }
            });
        }

        console.log(`\n🎯 Recommended Actions:`);
        console.log(`   1. Review calendar properties above`);
        console.log(`   2. Check for conflicts in comparison section`);
        console.log(`   3. Verify calendar permissions and settings`);
        console.log(`   4. Set dryRun: false in config to actually add events`);
        
        console.log('\n' + '='.repeat(60));
    }

    // Rich UI presentation using WebView with HTML
    async presentRichResults(results) {
        try {
            console.log('📱 Scriptable: Preparing rich HTML UI display...');
            
            // Generate HTML for rich display
            const html = await this.generateRichHTML(results);
            
            // Present using WebView
            await WebView.loadHTML(html, null, null, true);
            
            console.log('📱 Scriptable: ✓ Rich HTML display completed');
            
        } catch (error) {
            console.log(`📱 Scriptable: ✗ Failed to present rich UI: ${error.message}`);
            // Fallback to UITable
            try {
                console.log('📱 Scriptable: Attempting UITable fallback...');
                await this.presentUITableFallback(results);
            } catch (tableError) {
                console.log(`📱 Scriptable: ✗ UITable fallback also failed: ${tableError.message}`);
                // Final fallback to QuickLook
                try {
                    console.log('📱 Scriptable: Attempting QuickLook fallback...');
                    const summary = this.createResultsSummary(results);
                    await QuickLook.present(summary, false);
                    console.log('📱 Scriptable: ✓ QuickLook display completed');
                } catch (quickLookError) {
                    console.log(`📱 Scriptable: ✗ All display methods failed: ${quickLookError.message}`);
                }
            }
        }
    }

    // Generate rich HTML for WebView display
    async generateRichHTML(results) {
        const allEvents = this.getAllEventsFromResults(results);
        const availableCalendars = await Calendar.forEvents();
        
        // Group events by their pre-analyzed actions (set by shared-core)
        const newEvents = [];
        const updatedEvents = [];
        const mergeEvents = [];
        const conflictEvents = [];
        
        for (const event of allEvents) {
            // Events should already have _action set by shared-core
            switch (event._action) {
                case 'new':
                    newEvents.push(event);
                    break;
                case 'update':
                    updatedEvents.push(event);
                    break;
                case 'merge':
                    mergeEvents.push(event);
                    break;
                case 'conflict':
                case 'key_conflict':
                case 'time_conflict':
                case 'missing_calendar':
                    conflictEvents.push(event);
                    break;
                default:
                    // Fallback for events without analysis
                    newEvents.push(event);
                    break;
            }
        }
        
        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bear Event Scraper Results</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f7;
            color: #1d1d1f;
        }
        
        .header {
            background: linear-gradient(135deg, #8B4513 0%, #D2691E 100%);
            color: white;
            padding: 30px;
            border-radius: 15px;
            margin-bottom: 30px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        }
        
        .header h1 {
            margin: 0 0 10px 0;
            font-size: 28px;
            display: flex;
            align-items: center;
        }
        
        .header .stats {
            display: flex;
            gap: 30px;
            margin-top: 20px;
        }
        
        .stat {
            display: flex;
            flex-direction: column;
        }
        
        .stat-value {
            font-size: 32px;
            font-weight: 600;
        }
        
        .stat-label {
            font-size: 14px;
            opacity: 0.9;
        }
        
        .section {
            background: white;
            border-radius: 15px;
            padding: 25px;
            margin-bottom: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }
        
        .section-header {
            display: flex;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid #f0f0f0;
        }
        
        .section-icon {
            font-size: 24px;
            margin-right: 10px;
        }
        
        .section-title {
            font-size: 20px;
            font-weight: 600;
            flex: 1;
        }
        
        .section-count {
            background: #e0e0e0;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 500;
        }
        
        .event-card {
            background: #f8f8f8;
            border: 1px solid #e0e0e0;
            border-radius: 10px;
            padding: 15px;
            margin-bottom: 15px;
            transition: all 0.2s ease;
        }
        
        .event-card:hover {
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            transform: translateY(-2px);
        }
        
        .event-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 8px;
            color: #1d1d1f;
        }
        
        .event-details {
            display: flex;
            flex-wrap: wrap;
            gap: 15px;
            font-size: 14px;
            color: #666;
            margin-bottom: 10px;
        }
        
        .event-detail {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        
        .event-metadata {
            background: #fff;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 10px;
            margin-top: 10px;
            font-size: 13px;
        }
        
        .metadata-item {
            display: flex;
            margin-bottom: 5px;
        }
        
        .metadata-label {
            font-weight: 500;
            margin-right: 8px;
            color: #666;
            min-width: 80px;
        }
        
        .action-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 15px;
            font-size: 12px;
            font-weight: 500;
            margin-bottom: 10px;
        }
        
        .badge-new {
            background: #34c759;
            color: white;
        }
        
        .badge-new::before {
            content: "➕ ";
        }
        
        .badge-update {
            background: #007aff;
            color: white;
        }
        
        .badge-update::before {
            content: "🔄 ";
        }
        
        .badge-merge {
            background: #32d74b;
            color: white;
        }
        
        .badge-merge::before {
            content: "🔀 ";
        }
        
        .badge-conflict {
            background: #ff9500;
            color: white;
        }
        
        .badge-conflict::before {
            content: "⚠️ ";
        }
        
        .badge-warning {
            background: #ff9500;
            color: white;
        }
        
        .badge-warning::before {
            content: "⚠️ ";
        }
        
        .badge-error {
            background: #ff3b30;
            color: white;
        }
        
        .badge-error::before {
            content: "❌ ";
        }
        
        .conflict-info {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 8px;
            padding: 10px;
            margin-top: 10px;
            font-size: 13px;
        }
        
        .existing-info {
            background: #d1ecf1;
            border: 1px solid #bee5eb;
            border-radius: 8px;
            padding: 10px;
            margin-top: 10px;
            font-size: 13px;
        }
        
        .empty-state {
            text-align: center;
            padding: 40px;
            color: #999;
        }
        
        .error-item {
            background: #ffebee;
            border: 1px solid #ffcdd2;
            border-radius: 8px;
            padding: 10px;
            margin-bottom: 10px;
            font-size: 14px;
            color: #c62828;
        }
        
        .calendar-status {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px;
            background: #f0f0f0;
            border-radius: 8px;
            margin-bottom: 10px;
        }
        
        .status-icon {
            font-size: 20px;
        }
        
        .notes-preview {
            background: #f8f8f8;
            border-left: 3px solid #007aff;
            padding: 10px;
            margin-top: 10px;
            font-size: 12px;
            font-family: monospace;
            white-space: pre-wrap;
            max-height: 150px;
            overflow-y: auto;
        }
        
        .coordinates {
            font-family: monospace;
            font-size: 12px;
            color: #666;
        }
        
        .display-toggle {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 20px;
            padding: 15px;
            background: white;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }
        
        .toggle-switch {
            position: relative;
            display: inline-block;
            width: 60px;
            height: 34px;
        }
        
        .toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        
        .slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: #ccc;
            transition: .4s;
            border-radius: 34px;
        }
        
        .slider:before {
            position: absolute;
            content: "";
            height: 26px;
            width: 26px;
            left: 4px;
            bottom: 4px;
            background-color: white;
            transition: .4s;
            border-radius: 50%;
        }
        
        input:checked + .slider {
            background-color: #007aff;
        }
        
        input:checked + .slider:before {
            transform: translateX(26px);
        }
        
        .raw-display {
            display: none;
            background: #f8f8f8;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 15px;
            margin-top: 10px;
            font-family: monospace;
            font-size: 12px;
            line-height: 1.4;
            white-space: pre-wrap;
            max-height: 300px;
            overflow-y: auto;
        }
        
        .event-card.raw-mode .event-metadata {
            display: none;
        }
        
        .event-card.raw-mode .raw-display {
            display: block;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🐻 Bear Event Scraper Results</h1>
        <div class="stats">
            <div class="stat">
                <div class="stat-value">${results.totalEvents}</div>
                <div class="stat-label">Total Events</div>
            </div>
            <div class="stat">
                <div class="stat-value">${results.bearEvents}</div>
                <div class="stat-label">Bear Events</div>
            </div>
            <div class="stat">
                <div class="stat-value">${results.calendarEvents}</div>
                <div class="stat-label">Calendar Actions</div>
            </div>
        </div>
    </div>
    
    <div class="display-toggle">
        <span style="font-weight: 500;">Display Mode:</span>
        <span>Pretty</span>
        <label class="toggle-switch">
            <input type="checkbox" id="displayToggle" onchange="toggleDisplayMode()">
            <span class="slider"></span>
        </label>
        <span>Raw</span>
    </div>
    
    ${newEvents.length > 0 ? `
    <div class="section">
        <div class="section-header">
            <span class="section-icon">✨</span>
            <span class="section-title">New Events to Add</span>
            <span class="section-count">${newEvents.length}</span>
        </div>
        ${newEvents.map(event => this.generateEventCard(event)).join('')}
    </div>
    ` : ''}
    
    ${updatedEvents.length > 0 ? `
    <div class="section">
        <div class="section-header">
            <span class="section-icon">🔄</span>
            <span class="section-title">Events to Update</span>
            <span class="section-count">${updatedEvents.length}</span>
        </div>
        ${updatedEvents.map(event => this.generateEventCard(event)).join('')}
    </div>
    ` : ''}
    
    ${mergeEvents.length > 0 ? `
    <div class="section">
        <div class="section-header">
            <span class="section-icon">🔀</span>
            <span class="section-title">Events to Merge (Adding Info)</span>
            <span class="section-count">${mergeEvents.length}</span>
        </div>
        ${mergeEvents.map(event => this.generateEventCard(event)).join('')}
    </div>
    ` : ''}
    
    ${conflictEvents.length > 0 ? `
    <div class="section">
        <div class="section-header">
            <span class="section-icon">⚠️</span>
                            <span class="section-title">Events Requiring Review</span>
            <span class="section-count">${conflictEvents.length}</span>
        </div>
        ${conflictEvents.map(event => this.generateEventCard(event)).join('')}
    </div>
    ` : ''}
    
    ${results.errors && results.errors.length > 0 ? `
    <div class="section">
        <div class="section-header">
            <span class="section-icon">❌</span>
            <span class="section-title">Errors</span>
            <span class="section-count">${results.errors.length}</span>
        </div>
        ${results.errors.map(error => `
            <div class="error-item">${this.escapeHtml(error)}</div>
        `).join('')}
    </div>
    ` : ''}
    
    ${allEvents.length === 0 ? `
    <div class="section">
        <div class="empty-state">
            <div style="font-size: 48px; margin-bottom: 20px;">🔍</div>
            <div>No events found to process</div>
        </div>
    </div>
    ` : ''}
    
    <script>
        function toggleDisplayMode() {
            const toggle = document.getElementById('displayToggle');
            const eventCards = document.querySelectorAll('.event-card');
            
            eventCards.forEach(card => {
                if (toggle.checked) {
                    card.classList.add('raw-mode');
                } else {
                    card.classList.remove('raw-mode');
                }
            });
        }
    </script>
</body>
</html>
        `;
        
        return html;
    }
    
    // Generate HTML for individual event card
    generateEventCard(event) {
        const actionBadge = {
            'new': '<span class="action-badge badge-new">NEW</span>',
            'update': '<span class="action-badge badge-update">UPDATE</span>',
            'merge': '<span class="action-badge badge-merge">MERGE</span>',
            'key_conflict': '<span class="action-badge badge-warning">KEY MISMATCH</span>',
            'time_conflict': '<span class="action-badge badge-warning">TIME OVERLAP</span>',
            'missing_calendar': '<span class="action-badge badge-error">MISSING CALENDAR</span>'
        }[event._action] || '';
        
        const eventDate = new Date(event.startDate);
        const dateStr = eventDate.toLocaleDateString('en-US', { 
            weekday: 'short', 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        });
        const timeStr = eventDate.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit' 
        });
        
        const notes = event.notes || '';
        const calendarName = this.getCalendarNameForDisplay(event);
        
        let html = `
        <div class="event-card">
            ${actionBadge}
            <div class="event-title">${this.escapeHtml(event.title || event.name)}</div>
            <div class="event-details">
                ${event.venue || event.bar ? `
                    <div class="event-detail">
                        <span>📍</span>
                        <span>${this.escapeHtml(event.venue || event.bar)}</span>
                    </div>
                ` : ''}
                <div class="event-detail">
                    <span>📅</span>
                    <span>${dateStr} at ${timeStr}</span>
                </div>
                ${event.city ? `
                    <div class="event-detail">
                        <span>🌍</span>
                        <span>${this.escapeHtml(event.city.toUpperCase())}</span>
                    </div>
                ` : ''}
                <div class="event-detail">
                    <span>📱</span>
                    <span>${this.escapeHtml(calendarName)}</span>
                </div>
            </div>
            
            <div class="event-metadata">
                ${event.coordinates && event.coordinates.lat && event.coordinates.lng ? `
                    <div class="metadata-item">
                        <span class="metadata-label">Location:</span>
                        <span class="coordinates">${event.coordinates.lat}, ${event.coordinates.lng}</span>
                    </div>
                ` : ''}
                ${event.key ? `
                    <div class="metadata-item">
                        <span class="metadata-label">Key:</span>
                        <span>${this.escapeHtml(event.key)}</span>
                    </div>
                ` : ''}
                ${event.price || event.cover ? `
                    <div class="metadata-item">
                        <span class="metadata-label">Price:</span>
                        <span>${this.escapeHtml(event.price || event.cover)}</span>
                    </div>
                ` : ''}
                ${event.recurring ? `
                    <div class="metadata-item">
                        <span class="metadata-label">Recurring:</span>
                        <span>${event.recurrence || 'Yes'}</span>
                    </div>
                ` : ''}
            </div>
            
            ${event._action === 'update' && event._existingEvent ? `
                <div class="existing-info">
                    <strong>Existing Event:</strong> Will update with new information
                    ${event._existingEvent.title !== event.title ? `<br>• Title: "${this.escapeHtml(event._existingEvent.title)}" → "${this.escapeHtml(event.title)}"` : ''}
                    ${event._existingEvent.location !== event.location ? `<br>• Location: "${this.escapeHtml(event._existingEvent.location || 'None')}" → "${this.escapeHtml(event.location || 'None')}"` : ''}
                    ${!event._existingEvent.url && event.url ? '<br>• Add URL: ' + this.escapeHtml(event.url) : ''}
                    ${event._existingEvent.url && event.url && event._existingEvent.url !== event.url ? `<br>• URL: "${this.escapeHtml(event._existingEvent.url)}" → "${this.escapeHtml(event.url)}"` : ''}
                    <br>• Notes: Will be completely replaced with new event data
                    ${event.coordinates ? '<br>• GPS coordinates will be updated' : ''}
                </div>
            ` : ''}
            
            ${event._action === 'merge' && event._existingEvent ? `
                <div class="existing-info">
                    <strong>Merging With:</strong> "${this.escapeHtml(event._existingEvent.title)}"
                    <br>• <strong>PRESERVED:</strong> Existing event description will be kept
                    ${event._existingEvent.title !== event.title ? `<br>• Title: "${this.escapeHtml(event._existingEvent.title)}" → "${this.escapeHtml(event.title)}"` : ''}
                    ${event._existingEvent.location !== event.location ? `<br>• Location: "${this.escapeHtml(event._existingEvent.location || 'None')}" → "${this.escapeHtml(event.location || 'None')}"` : ''}
                    ${!event._existingEvent.url && event.url ? '<br>• Add URL: ' + this.escapeHtml(event.url) : ''}
                    ${event._existingEvent.url && event.url && event._existingEvent.url !== event.url ? `<br>• URL: "${this.escapeHtml(event._existingEvent.url)}" → "${this.escapeHtml(event.url)}"` : ''}
                    <br>• Metadata (Key, City, Source) will be updated/added
                    ${event.key ? `<br>• Key match confirmed: ${this.escapeHtml(event.key)}` : ''}
                </div>
            ` : ''}
            
            ${(event._action === 'key_conflict' || event._action === 'time_conflict') && event._conflicts ? `
                <div class="conflict-info">
                    <strong>Overlapping Events:</strong> ${event._conflicts.length} event(s) at same time
                    ${event._conflicts.map(conflict => `
                        <br>• "${this.escapeHtml(conflict.title)}" - ${conflict.startDate.toLocaleString()}
                    `).join('')}
                </div>
            ` : ''}
            
            ${event._action === 'key_conflict' && event._existingKey ? `
                <div class="conflict-info">
                    <strong>Key Mismatch:</strong>
                    <br>• Existing key: ${this.escapeHtml(event._existingKey)}
                    <br>• New key: ${this.escapeHtml(event.key)}
                    <br>• Cannot automatically merge - manual review needed
                </div>
            ` : ''}
            
            ${event._action === 'missing_calendar' ? `
                <div class="conflict-info">
                    <strong>Calendar "${this.escapeHtml(calendarName)}" not found!</strong>
                    <br>Please create this calendar manually before running the scraper.
                </div>
            ` : ''}
            
            <details style="margin-top: 10px;">
                <summary style="cursor: pointer; font-size: 13px; color: #007aff;">View Calendar Notes Preview</summary>
                <div class="notes-preview">${this.escapeHtml(notes)}</div>
            </details>
            
            <div class="raw-display">
<strong>Raw Calendar Event Data:</strong>

Title: ${this.escapeHtml(event.title || event.name)}
Start Date: ${new Date(event.startDate).toISOString()}
End Date: ${new Date(event.endDate || event.startDate).toISOString()}
Location: ${this.escapeHtml(event.venue || event.bar || '')}
Calendar: ${this.escapeHtml(calendarName)}
URL: ${event.url || 'None'}

Notes Field Content:
${this.escapeHtml(notes)}

Event Object (JSON):
${this.escapeHtml(JSON.stringify({
    title: event.title || event.name,
    startDate: event.startDate,
    endDate: event.endDate || event.startDate,
    location: event.venue || event.bar || '',
    city: event.city,
    key: event.key,
    url: event.url,
    source: event.source,
    coordinates: event.coordinates
}, null, 2))}
            </div>
        </div>
        `;
        
        return html;
    }
    
    // Helper to escape HTML
    escapeHtml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.toString().replace(/[&<>"']/g, m => map[m]);
    }

    // Fallback to UITable if WebView fails
    async presentUITableFallback(results) {
        try {
            const table = new UITable();
        table.showSeparators = true;
            
            // Header row
            const headerRow = new UITableRow();
            headerRow.isHeader = true;
            headerRow.height = 50;
            
            const headerCell = headerRow.addText('🐻 Bear Event Scraper Results');
            headerCell.titleFont = Font.boldSystemFont(18);
            headerCell.titleColor = Color.white();
            headerCell.backgroundColor = Color.brown();
            
            table.addRow(headerRow);
            
            // Summary section
            const summaryRow = new UITableRow();
            summaryRow.height = 80;
            
            const summaryText = `📊 Total Events: ${results.totalEvents}
🐻 Bear Events: ${results.bearEvents}
📅 Added to Calendar: ${results.calendarEvents}
${results.errors.length > 0 ? `❌ Errors: ${results.errors.length}` : '✅ No errors'}`;
            
            const summaryCell = summaryRow.addText(summaryText);
            summaryCell.titleFont = Font.systemFont(14);
            summaryCell.subtitleColor = Color.gray();
            
            table.addRow(summaryRow);
            
            // Parser results section
            if (results.parserResults && results.parserResults.length > 0) {
                const parserHeaderRow = new UITableRow();
                parserHeaderRow.height = 40;
                
                const parserHeaderCell = parserHeaderRow.addText('📋 Parser Results');
                parserHeaderCell.titleFont = Font.boldSystemFont(16);
                parserHeaderCell.titleColor = Color.blue();
                
                table.addRow(parserHeaderRow);
                
                results.parserResults.forEach(result => {
                    const parserRow = new UITableRow();
                    parserRow.height = 50;
                    
                    const parserCell = parserRow.addText(`${result.name}`);
                    parserCell.titleFont = Font.systemFont(14);
                    parserCell.subtitleText = `${result.bearEvents} bear events found`;
                    parserCell.subtitleColor = Color.gray();
                    
                    table.addRow(parserRow);
                });
            }
            
            // Events section
            const allEvents = this.getAllEventsFromResults(results);
            if (allEvents && allEvents.length > 0) {
                const eventsHeaderRow = new UITableRow();
                eventsHeaderRow.height = 40;
                
                const eventsHeaderCell = eventsHeaderRow.addText('🎉 Found Events');
                eventsHeaderCell.titleFont = Font.boldSystemFont(16);
                eventsHeaderCell.titleColor = Color.green();
                
                table.addRow(eventsHeaderRow);
                
                allEvents.slice(0, 10).forEach((event, i) => { // Show first 10 events
                    const eventRow = new UITableRow();
                    eventRow.height = 60;
                    
                    const eventCell = eventRow.addText(event.title || event.name || `Event ${i + 1}`);
                    eventCell.titleFont = Font.systemFont(14);
                    
                    const subtitle = [];
                    if (event.venue || event.bar) {
                        subtitle.push(`📍 ${event.venue || event.bar}`);
                    }
                    if (event.day || event.time) {
                        subtitle.push(`📅 ${event.day || ''} ${event.time || ''}`.trim());
                    }
                    if (event.city) {
                        subtitle.push(`🌍 ${event.city.toUpperCase()}`);
                    }
                    
                    eventCell.subtitleText = subtitle.join(' • ') || 'Event details';
                    eventCell.subtitleColor = Color.gray();
                    
                    table.addRow(eventRow);
                });
                
                if (allEvents.length > 10) {
                    const moreRow = new UITableRow();
                    moreRow.height = 40;
                    
                    const moreCell = moreRow.addText(`... and ${allEvents.length - 10} more events`);
                    moreCell.titleFont = Font.italicSystemFont(12);
                    moreCell.titleColor = Color.gray();
                    
                    table.addRow(moreRow);
                }
            }
            
            // Errors section
            if (results.errors && results.errors.length > 0) {
                const errorsHeaderRow = new UITableRow();
                errorsHeaderRow.height = 40;
                
                const errorsHeaderCell = errorsHeaderRow.addText('❌ Errors');
                errorsHeaderCell.titleFont = Font.boldSystemFont(16);
                errorsHeaderCell.titleColor = Color.red();
                
                table.addRow(errorsHeaderRow);
                
                results.errors.slice(0, 5).forEach(error => { // Show first 5 errors
                    const errorRow = new UITableRow();
                    errorRow.height = 50;
                    
                    const errorCell = errorRow.addText(error);
                    errorCell.titleFont = Font.systemFont(12);
                    errorCell.titleColor = Color.red();
                    
                    table.addRow(errorRow);
                });
            }
            
            // Actions section
            const actionsRow = new UITableRow();
            actionsRow.height = 80;
            
            const actionsText = `🎯 Next Steps:
• Review calendar conflicts above
• Check calendar permissions
• Set dryRun: false to add events
• Verify timezone settings`;
            
            const actionsCell = actionsRow.addText(actionsText);
            actionsCell.titleFont = Font.systemFont(12);
            actionsCell.titleColor = Color.blue();
            
            table.addRow(actionsRow);
            
            console.log('📱 Scriptable: Presenting rich UI table...');
            await table.present(false); // Present in normal mode (not fullscreen)
            
            console.log('📱 Scriptable: ✓ UITable display completed');
            
        } catch (error) {
            console.log(`📱 Scriptable: ✗ Failed to present UITable: ${error.message}`);
            throw error;
        }
    }

    // Helper method to create a text summary for QuickLook
    createResultsSummary(results) {
        const lines = [];
        lines.push('🐻 BEAR EVENT SCRAPER RESULTS');
        lines.push('='.repeat(40));
        lines.push('');
        lines.push(`📊 Total Events Found: ${results.totalEvents}`);
        lines.push(`🐻 Bear Events: ${results.bearEvents}`);
        lines.push(`📅 Added to Calendar: ${results.calendarEvents}`);
        
        if (results.errors && results.errors.length > 0) {
            lines.push(`❌ Errors: ${results.errors.length}`);
        }
        
        lines.push('');
        lines.push('📋 Parser Results:');
        if (results.parserResults) {
            results.parserResults.forEach(result => {
                lines.push(`  • ${result.name}: ${result.bearEvents} bear events`);
            });
        }
        
        const allEvents = this.getAllEventsFromResults(results);
        if (allEvents && allEvents.length > 0) {
            lines.push('');
            lines.push('🎉 Found Events:');
            allEvents.slice(0, 5).forEach((event, i) => {
                const title = event.title || event.name || `Event ${i + 1}`;
                const venue = event.venue || event.bar || '';
                const city = event.city || '';
                lines.push(`  • ${title}`);
                if (venue) lines.push(`    📍 ${venue}`);
                if (city) lines.push(`    🌍 ${city.toUpperCase()}`);
            });
            
            if (allEvents.length > 5) {
                lines.push(`  ... and ${allEvents.length - 5} more events`);
            }
        }
        
        if (results.errors && results.errors.length > 0) {
            lines.push('');
            lines.push('❌ Errors:');
            results.errors.slice(0, 3).forEach(error => {
                lines.push(`  • ${error}`);
            });
        }
        
        lines.push('');
        lines.push('🎯 Next Steps:');
        lines.push('  • Review calendar conflicts');
        lines.push('  • Check calendar permissions');
        lines.push('  • Set dryRun: false to add events');
        
        return lines.join('\n');
    }

    // Helper method to extract all events from parser results
    getAllEventsFromResults(results) {
        // Prefer analyzed events if available (they have action types)
        if (results && results.analyzedEvents && Array.isArray(results.analyzedEvents)) {
            return results.analyzedEvents;
        }
        
        // Fall back to original events
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
        
        // For new events, check both the current title and original title (if title was overridden)
        const newTitle = (newEvent.title || newEvent.name || '').toLowerCase().trim();
        const newOriginalTitle = (newEvent.originalTitle || '').toLowerCase().trim();
        
        console.log(`📱 Scriptable: Checking merge eligibility:`);
        console.log(`   Existing: "${existingTitle}"`);
        console.log(`   New: "${newTitle}"`);
        if (newOriginalTitle) {
            console.log(`   New (original): "${newOriginalTitle}"`);
        }
        
        // Check both current and original titles for MEGAWOOF/DURO patterns
        const existingHasMegawoof = /megawoof/i.test(existingTitle);
        const existingHasDuro = /d[\s\>\-]*u[\s\>\-]*r[\s\>\-]*o/i.test(existingTitle);
        
        const newHasMegawoof = /megawoof/i.test(newTitle) || /megawoof/i.test(newOriginalTitle);
        const newHasDuro = /d[\s\>\-]*u[\s\>\-]*r[\s\>\-]*o/i.test(newTitle) || /d[\s\>\-]*u[\s\>\-]*r[\s\>\-]*o/i.test(newOriginalTitle);
        
        const isMegawoofConflict = (
            (existingHasMegawoof || existingHasDuro) && 
            (newHasMegawoof || newHasDuro)
        );
        
        if (isMegawoofConflict) {
            console.log(`📱 Scriptable: MEGAWOOF/DURO conflict detected - should merge: "${existingEvent.title}" vs "${newTitle}" (orig: "${newOriginalTitle}")`);
            return true;
        }
        
        // Check for exact title matches (case insensitive) - check both titles
        if (existingTitle === newTitle || (newOriginalTitle && existingTitle === newOriginalTitle)) {
            console.log(`📱 Scriptable: Exact title match - should merge: "${existingEvent.title}" vs "${newTitle}"`);
            return true;
        }
        
        // Check for similarity with both current and original titles
        const titleSimilarity = this.calculateTitleSimilarity(existingTitle, newTitle);
        const originalTitleSimilarity = newOriginalTitle ? this.calculateTitleSimilarity(existingTitle, newOriginalTitle) : 0;
        const maxSimilarity = Math.max(titleSimilarity, originalTitleSimilarity);
        
        if (maxSimilarity > 0.8) { // 80% similarity threshold
            console.log(`📱 Scriptable: High title similarity (${Math.round(maxSimilarity * 100)}%) - should merge: "${existingEvent.title}" vs "${newTitle}"`);
            return true;
        }
        
        console.log(`📱 Scriptable: No merge criteria met - similarity: ${Math.round(maxSimilarity * 100)}%`);
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

    // Helper method to merge event data with per-field merge strategies
    mergeEventData(existingEvent, newEvent) {
        const existingNotes = existingEvent.notes || '';
        const fieldStrategies = newEvent._fieldMergeStrategies || {};
        
        // Parse existing notes to extract current field values
        const existingFields = this.parseNotesIntoFields(existingNotes);
        
        // Build updated notes based on merge strategies
        const updatedFields = {};
        
        // First, preserve all existing fields
        Object.keys(existingFields).forEach(key => {
            updatedFields[key] = existingFields[key];
        });
        
        // Then apply new fields based on their merge strategies
        Object.keys(newEvent).forEach(key => {
            // Skip internal fields
            if (key.startsWith('_') || key === 'startDate' || key === 'endDate' || key === 'location') {
                return;
            }
            
            const value = newEvent[key];
            const strategy = fieldStrategies[key] || 'preserve'; // Default to preserve
            
            switch (strategy) {
                case 'clobber':
                    // Always replace with new value
                    updatedFields[key] = value;
                    break;
                    
                case 'upsert':
                    // Add if missing, keep existing if present
                    if (!existingFields[key] && value) {
                        updatedFields[key] = value;
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
        
        lines.forEach(line => {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const key = line.substring(0, colonIndex).trim();
                const value = line.substring(colonIndex + 1).trim();
                
                // Normalize key names
                const normalizedKey = key.toLowerCase().replace(/^debug/, '');
                fields[normalizedKey] = value;
            }
        });
        
        return fields;
    }
    
    // Build notes from field/value pairs
    buildNotesFromFields(fields) {
        const lines = [];
        
        // Add fields in a consistent order
        const fieldOrder = ['bar', 'description', 'key', 'coordinates', 'debugcity', 'debugsource', 
                          'instagram', 'facebook', 'website', 'gmaps', 'price', 'recurrence', 
                          'timezone', 'shorttitle'];
        
        // First add ordered fields
        fieldOrder.forEach(key => {
            if (fields[key]) {
                const displayKey = key === 'debugcity' ? 'DebugCity' : 
                                 key === 'debugsource' ? 'DebugSource' :
                                 key.charAt(0).toUpperCase() + key.slice(1);
                lines.push(`${displayKey}: ${fields[key]}`);
            }
        });
        
        // Then add any remaining fields
        Object.keys(fields).forEach(key => {
            if (!fieldOrder.includes(key) && key !== 'url') {
                const displayKey = key.charAt(0).toUpperCase() + key.slice(1);
                lines.push(`${displayKey}: ${fields[key]}`);
            }
        });
        
        // Add URL at the end
        if (fields.url) {
            lines.push('', `More info: ${fields.url}`);
        }
        
        return lines.join('\n');
    }


    


    // Helper to get calendar name for display purposes only
    getCalendarNameForDisplay(event) {
        const city = event.city || 'default';
        return this.calendarMappings[city] || `chunky-dad-${city}`;
    }
    
    // Intelligently merge event notes, preserving existing description while updating metadata
    mergeEventNotes(existingNotes, newNotes, event = null) {
        if (!existingNotes) return newNotes;
        if (!newNotes) return existingNotes;
        
        const existingLines = existingNotes.split('\n');
        const newLines = newNotes.split('\n');
        
        // Extract description from existing notes (everything before metadata)
        const existingDescriptionLines = [];
        let foundMetadata = false;
        
        for (const line of existingLines) {
            if (line.startsWith('Bar:') || line.startsWith('Key:') || line.startsWith('City:') || 
                line.startsWith('Source:') || line.startsWith('Instagram:') || line.startsWith('Facebook:') ||
                line.includes('More info:')) {
                foundMetadata = true;
                break;
            }
            if (line.trim() !== '' || !foundMetadata) {
                existingDescriptionLines.push(line);
            }
        }
        
        // Extract metadata from new notes
        const newMetadataLines = [];
        let inMetadata = false;
        
        for (const line of newLines) {
            if (line.startsWith('Bar:') || line.startsWith('Key:') || line.startsWith('DebugCity:') || 
                line.startsWith('DebugSource:') || line.startsWith('Instagram:') || line.startsWith('Facebook:') ||
                line.startsWith('Coordinates:') || line.startsWith('Gmaps:') ||
                line.includes('More info:')) {
                inMetadata = true;
            }
            if (inMetadata) {
                newMetadataLines.push(line);
            }
        }
        
        // Combine: existing description + new metadata
        const result = [];
        
        // Add existing description (preserve original event description)
        if (existingDescriptionLines.length > 0) {
            result.push(...existingDescriptionLines);
        }
        
        // Add separator if we have both description and metadata
        if (existingDescriptionLines.length > 0 && newMetadataLines.length > 0) {
            result.push('');
        }
        
        // Add new metadata
        if (newMetadataLines.length > 0) {
            result.push(...newMetadataLines);
        }
        
        return result.join('\n');
    }
}

// Export for Scriptable environment
module.exports = { ScriptableAdapter };
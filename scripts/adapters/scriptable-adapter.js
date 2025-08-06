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
            const startDate = event.startDate;
            const endDate = event.endDate;
            
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
                            
                            // Use the pre-merged data from shared-core
                            if (event._mergedNotes) {
                                // Show detailed diff (already calculated by shared-core)
                                console.log('\n📊 MERGE DIFF:');
                                console.log('─'.repeat(60));
                                
                                const diff = event._mergeDiff;
                                
                                // Show what's being preserved
                                if (diff.preserved.length > 0) {
                                    console.log('✅ PRESERVED:');
                                    diff.preserved.forEach(key => {
                                        console.log(`   ${key}`);
                                    });
                                }
                                
                                // Show what's being added
                                if (diff.added.length > 0) {
                                    console.log('\n➕ ADDED:');
                                    diff.added.forEach(({ key, value }) => {
                                        const displayValue = value.length > 50 ? value.substring(0, 47) + '...' : value;
                                        console.log(`   ${key}: ${displayValue}`);
                                    });
                                }
                                
                                // Show what's being updated
                                if (diff.updated.length > 0) {
                                    console.log('\n🔄 UPDATED:');
                                    diff.updated.forEach(({ key, from, to }) => {
                                        const oldDisplay = from.length > 30 ? from.substring(0, 27) + '...' : from;
                                        const newDisplay = to.length > 30 ? to.substring(0, 27) + '...' : to;
                                        console.log(`   ${key}: "${oldDisplay}" → "${newDisplay}"`);
                                    });
                                }
                                
                                // Show what's being removed (shouldn't happen in merge)
                                if (diff.removed.length > 0) {
                                    console.log('\n❌ REMOVED (WARNING - this shouldn\'t happen in merge):');
                                    diff.removed.forEach(({ key, value }) => {
                                        console.log(`   ${key}: ${value}`);
                                    });
                                }
                                
                                console.log('─'.repeat(60));
                                
                                // Apply the pre-merged changes
                                targetEvent.notes = event._mergedNotes;
                                if (event._mergedUrl) {
                                    targetEvent.url = event._mergedUrl;
                                }
                                // Update location only if new event has coordinates
                                if (event.location && event.location.includes(',')) {
                                    targetEvent.location = event.location;
                                }
                                await targetEvent.save();
                                processedCount++;
                            } else {
                                console.log(`📱 Scriptable: ⚠️ No merged data available for event: ${event.title}`);
                            }
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
                            calendarEvent.startDate = event.startDate;
                            calendarEvent.endDate = event.endDate;
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
            
            // Display full event objects at the end (for debugging)
            await this.displayFullEventObjects(results);
            
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
        
        // Get unique calendars needed
        const calendarsNeeded = new Map();
        allEvents.forEach(event => {
            const calendarName = this.getCalendarNameForDisplay(event);
            if (!calendarsNeeded.has(calendarName)) {
                const exists = availableCalendars.find(cal => cal.title === calendarName);
                calendarsNeeded.set(calendarName, {
                    name: calendarName,
                    exists: !!exists,
                    calendar: exists,
                    eventCount: 0
                });
            }
            calendarsNeeded.get(calendarName).eventCount++;
        });

        // Show calendar summary
        console.log(`\n📊 Summary:`);
        console.log(`   Total events: ${allEvents.length}`);
        console.log(`   Calendars needed: ${calendarsNeeded.size}`);
        
        console.log(`\n📅 Calendar Status:`);
        for (const [name, info] of calendarsNeeded) {
            if (info.exists) {
                console.log(`   ✅ ${name} (${info.eventCount} events)`);
            } else {
                console.log(`   ❌ ${name} (${info.eventCount} events) - must be created manually`);
            }
        }
        
        // Show sample event structure (just first one)
        if (allEvents.length > 0) {
            const sampleEvent = allEvents[0];
            console.log(`\n📋 Sample Event Structure:`);
            console.log(`   Title: "${sampleEvent.title || sampleEvent.name}"`);
            console.log(`   Date: ${new Date(sampleEvent.startDate).toLocaleString()}`);
            console.log(`   Location: "${sampleEvent.venue || sampleEvent.bar || 'TBD'}"`);
            console.log(`   City: ${sampleEvent.city || 'unknown'}`);
            console.log(`   Notes: ${(sampleEvent.notes || '').length} characters`);
            if (sampleEvent.recurring) {
                console.log(`   Recurring: ${sampleEvent.recurrence || 'Yes'}`);
            }
        }
        
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
                const startDate = event.startDate;
                const endDate = event.endDate || event.startDate;
                
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
        
        // Group events by action type
        const eventsByAction = {
            new: [],
            merge: [],
            update: [],
            conflict: [],
            other: []
        };
        
        allEvents.forEach(event => {
            const action = event._action || 'other';
            if (eventsByAction[action]) {
                eventsByAction[action].push(event);
            } else {
                eventsByAction.other.push(event);
            }
        });
        
        // Show summary by action type
        console.log(`\n📊 Event Actions Summary:`);
        console.log(`   ➕ New: ${eventsByAction.new.length} events`);
        console.log(`   🔀 Merge: ${eventsByAction.merge.length} events`);
        console.log(`   🔄 Update: ${eventsByAction.update.length} events`);
        console.log(`   ⚠️  Conflict: ${eventsByAction.conflict.length} events`);
        if (eventsByAction.other.length > 0) {
            console.log(`   ❓ Other: ${eventsByAction.other.length} events`);
        }
        
        // Show sample events for each action type (max 2 per type)
        Object.entries(eventsByAction).forEach(([action, events]) => {
            if (events.length === 0) return;
            
            console.log(`\n${action.toUpperCase()} Events (showing ${Math.min(2, events.length)} of ${events.length}):`);
            console.log('─'.repeat(50));
            
            events.slice(0, 2).forEach(event => {
                console.log(`• ${event.title || event.name}`);
                console.log(`  📍 ${event.venue || event.bar || 'TBD'} | 🌍 ${(event.city || 'unknown').toUpperCase()}`);
                console.log(`  📅 ${new Date(event.startDate).toLocaleDateString()} ${new Date(event.startDate).toLocaleTimeString()}`);
                
                if (action === 'merge' && event._mergeDiff) {
                    console.log(`  🔀 Merge: ${event._mergeDiff.preserved.length} preserved, ${event._mergeDiff.updated.length} updated, ${event._mergeDiff.added.length} added`);
                } else if (action === 'conflict' && event._analysis?.reason) {
                    console.log(`  ⚠️  Reason: ${event._analysis.reason}`);
                }
            });
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
    
    async displayFullEventObjects(results) {
        console.log('\n' + '='.repeat(60));
        console.log('🔍 FULL EVENT OBJECTS (DEBUG)');
        console.log('='.repeat(60));
        
        const allEvents = this.getAllEventsFromResults(results);
        if (!allEvents || !allEvents.length) {
            console.log('❌ No events to display');
            return;
        }
        
        // Group events by action type
        const eventsByAction = {};
        allEvents.forEach(event => {
            const action = event._action || 'unprocessed';
            if (!eventsByAction[action]) {
                eventsByAction[action] = [];
            }
            eventsByAction[action].push(event);
        });
        
        // Display events grouped by action
        Object.entries(eventsByAction).forEach(([action, events]) => {
            console.log(`\n━━━ ${action.toUpperCase()} EVENTS (${events.length}) ━━━`);
            
            events.forEach((event, index) => {
                console.log(`\n[${action.toUpperCase()} ${index + 1}/${events.length}] ${event.title || event.name}`);
                console.log('─'.repeat(60));
                
                // Create a clean object for logging (remove circular references)
                const cleanEvent = JSON.parse(JSON.stringify(event, (key, value) => {
                    // Skip internal fields that might have circular references
                    if (key === '_parserConfig' && value) {
                        return { name: value.name, parser: value.parser };
                    }
                    if (key === '_existingEvent' && value) {
                        return { 
                            title: value.title, 
                            identifier: value.identifier,
                            startDate: value.startDate,
                            endDate: value.endDate,
                            notesLength: value.notes ? value.notes.length : 0
                        };
                    }
                    if (key === '_conflicts' && value && Array.isArray(value)) {
                        return value.map(c => ({
                            title: c.title,
                            startDate: c.startDate,
                            identifier: c.identifier
                        }));
                    }
                    if (typeof value === 'function') {
                        return '[Function]';
                    }
                    return value;
                }, 2));
                
                console.log(JSON.stringify(cleanEvent, null, 2));
            });
        });
        
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
            
            // After displaying results, prompt for calendar execution if we have analyzed events
            if (results.analyzedEvents && results.analyzedEvents.length > 0 && !results.calendarEvents) {
                // Only prompt if we haven't already executed (calendarEvents would be > 0)
                const isDryRun = results.config?.parsers?.some(p => p.dryRun === true);
                if (!isDryRun) {
                    console.log('📱 Scriptable: Prompting for calendar execution...');
                    const executedCount = await this.promptForCalendarExecution(results.analyzedEvents, results.config);
                    results.calendarEvents = executedCount;
                }
            }
            
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
            background: white;
            border: 1px solid rgba(0,0,0,0.08);
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 16px;
            transition: all 0.2s ease;
            box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        }
        
        .event-card:hover {
            box-shadow: 0 6px 20px rgba(0,0,0,0.08);
            transform: translateY(-2px);
            border-color: rgba(0,0,0,0.12);
        }
        
        .event-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 12px;
            color: #1d1d1f;
            line-height: 1.3;
        }
        
        .event-details {
            display: flex;
            flex-direction: column;
            gap: 8px;
            font-size: 14px;
            color: #333;
        }
        
        .event-detail {
            display: flex;
            align-items: flex-start;
            gap: 8px;
        }
        
        .event-detail span:first-child {
            font-size: 16px;
            min-width: 24px;
            text-align: center;
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
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.5;
            max-height: 250px;
            overflow-y: auto;
        }
        
        .notes-preview strong {
            font-weight: 600;
            color: #333;
        }
        
        details {
            background: rgba(255, 255, 255, 0.5);
            border: 1px solid rgba(0, 0, 0, 0.1);
            border-radius: 8px;
            padding: 5px;
            transition: all 0.2s ease;
        }
        
        details summary {
            padding: 5px 10px;
            font-weight: 500;
            user-select: none;
            outline: none;
            list-style: none;
        }
        
        details summary::-webkit-details-marker {
            display: none;
        }
        
        details summary:before {
            content: '▶';
            display: inline-block;
            margin-right: 5px;
            transition: transform 0.2s ease;
        }
        
        details[open] summary:before {
            transform: rotate(90deg);
        }
        
        details summary:hover {
            background: rgba(0, 0, 0, 0.05);
            border-radius: 5px;
        }
        
        details[open] {
            background: rgba(255, 255, 255, 0.8);
        }
        
        details[open] summary {
            border-bottom: 1px solid rgba(0, 0, 0, 0.1);
            margin-bottom: 10px;
        }
        
        /* Responsive Design */
        @media (max-width: 768px) {
            body {
                padding: 10px;
            }
            
            .header {
                padding: 20px;
                margin-bottom: 20px;
            }
            
            .header h1 {
                font-size: 24px;
            }
            
            .header .stats {
                flex-direction: column;
                gap: 15px;
            }
            
            .stat {
                text-align: center;
            }
            
            .controls-section {
                flex-direction: column !important;
                gap: 15px !important;
                align-items: stretch !important;
            }
            
            .search-container {
                max-width: none !important;
                order: 2;
            }
            
            .display-toggle {
                justify-content: center;
                order: 1;
            }
            
            .action-buttons {
                justify-content: center;
                order: 3;
            }
            
            .action-buttons button {
                flex: 1;
                max-width: 150px;
            }
            
            .section {
                padding: 15px;
            }
            
            .event-card {
                margin-bottom: 15px;
            }
            
            .event-title {
                font-size: 16px;
            }
            
            .event-detail {
                font-size: 13px;
                padding: 6px 0;
            }
            
            .raw-display {
                font-size: 11px;
                max-height: 200px;
            }
        }
        
        @media (max-width: 480px) {
            .header .stats {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
            }
            
            .stat:last-child {
                grid-column: 1 / -1;
            }
            
            .action-buttons {
                flex-direction: column;
            }
            
            .action-buttons button {
                max-width: none;
            }
        }
        
        details pre {
            margin: 0;
            font-family: 'SF Mono', Monaco, 'Courier New', monospace;
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
        
        .event-card.raw-mode .event-details,
        .event-card.raw-mode .event-metadata,
        .event-card.raw-mode .existing-info,
        .event-card.raw-mode .conflict-info,
        .event-card.raw-mode details:not(.raw-json-details) {
            display: none !important;
        }
        
        .event-card.raw-mode .raw-display {
            display: block;
        }
        
        .event-card.raw-mode {
            background: #1e1e1e;
            border-color: #333;
        }
        
        .event-card.raw-mode .event-title {
            color: #fff;
            font-family: monospace;
            font-size: 14px;
        }
        
        .event-card.raw-mode .action-badge {
            background: #333;
            border: 1px solid #555;
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
    
    <div class="controls-section" style="
        background: white;
        border-radius: 15px;
        padding: 20px;
        margin-bottom: 20px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
        align-items: center;
        justify-content: space-between;
    ">
        <div class="display-toggle">
            <span style="font-weight: 500;">Display Mode:</span>
            <span>Pretty</span>
            <label class="toggle-switch">
                <input type="checkbox" id="displayToggle" onchange="toggleDisplayMode()">
                <span class="slider"></span>
            </label>
            <span>Raw</span>
        </div>
        
        <div class="search-container" style="
            display: flex;
            align-items: center;
            gap: 10px;
            flex-grow: 1;
            max-width: 400px;
        ">
            <span style="font-weight: 500;">🔍</span>
            <input type="text" id="searchInput" placeholder="Search events..." onkeyup="filterEvents()" style="
                flex-grow: 1;
                padding: 8px 12px;
                border: 2px solid #e0e0e0;
                border-radius: 8px;
                font-size: 14px;
                outline: none;
                transition: border-color 0.2s ease;
            " onfocus="this.style.borderColor='#007aff'" onblur="this.style.borderColor='#e0e0e0'">
            <button onclick="clearSearch()" style="
                padding: 6px 10px;
                background: #f0f0f0;
                border: none;
                border-radius: 6px;
                font-size: 12px;
                cursor: pointer;
                transition: background 0.2s ease;
            " onmouseover="this.style.background='#e0e0e0'" onmouseout="this.style.background='#f0f0f0'">
                Clear
            </button>
        </div>
        
        <div class="action-buttons" style="display: flex; gap: 10px;">
            <button onclick="copyRawOutput()" style="
                padding: 8px 16px;
                background: #007aff;
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s ease;
            " onmouseover="this.style.background='#0056b3'" onmouseout="this.style.background='#007aff'">
                📋 Copy Raw Output
            </button>
            
            <button onclick="exportAsJSON()" style="
                padding: 8px 16px;
                background: #34c759;
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s ease;
            " onmouseover="this.style.background='#28a745'" onmouseout="this.style.background='#34c759'">
                📄 Export JSON
            </button>
        </div>
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
        
        function toggleDiffView(button, eventKey) {
            const tableView = document.getElementById('table-view-' + eventKey);
            const lineView = document.getElementById('line-view-' + eventKey);
            
            if (tableView.style.display === 'none') {
                // Switch to table view
                tableView.style.display = 'block';
                lineView.style.display = 'none';
                button.textContent = 'Switch to Line View';
            } else {
                // Switch to line view
                tableView.style.display = 'none';
                lineView.style.display = 'block';
                button.textContent = 'Switch to Table View';
            }
        }
        
        function toggleComparisonSection(eventId) {
            const content = document.getElementById('comparison-content-' + eventId);
            const icon = document.getElementById('expand-icon-' + eventId);
            const diffToggle = document.getElementById('diff-toggle-' + eventId);
            
            if (content.style.display === 'none') {
                content.style.display = 'block';
                icon.textContent = '▼';
                if (diffToggle) diffToggle.style.display = 'block';
            } else {
                content.style.display = 'none';
                icon.textContent = '▶';
                if (diffToggle) diffToggle.style.display = 'none';
            }
        }
        
        function copyRawOutput() {
            // Get all event cards
            const eventCards = document.querySelectorAll('.event-card');
            let rawOutput = '';
            
            // Add header
            rawOutput += '🐻 BEAR EVENT SCRAPER - RAW OUTPUT\\n';
            rawOutput += '=' + '='.repeat(50) + '\\n\\n';
            
            // Add summary stats
            const totalEvents = document.querySelector('.stat-value').textContent;
            const bearEvents = document.querySelectorAll('.stat-value')[1].textContent;
            const calendarActions = document.querySelectorAll('.stat-value')[2].textContent;
            
            rawOutput += \`📊 SUMMARY:\\\\n\`;
            rawOutput += \`Total Events: \${totalEvents}\\\\n\`;
            rawOutput += \`Bear Events: \${bearEvents}\\\\n\`;
            rawOutput += \`Calendar Actions: \${calendarActions}\\\\n\\\\n\`;
            
            // Process each event
            eventCards.forEach((card, index) => {
                const title = card.querySelector('.event-title')?.textContent || 'Untitled Event';
                const rawData = card.querySelector('.raw-display')?.textContent || 'No raw data available';
                
                rawOutput += \`EVENT \${index + 1}: \${title}\\\\n\`;
                rawOutput += '-'.repeat(60) + '\\n';
                rawOutput += rawData + '\\n\\n';
            });
            
            // Copy to clipboard (modern iOS WebView supports this)
            navigator.clipboard.writeText(rawOutput).then(() => {
                // Show success feedback
                const button = event.target;
                const originalText = button.innerHTML;
                button.innerHTML = '✅ Copied!';
                button.style.background = '#34c759';
                
                setTimeout(() => {
                    button.innerHTML = originalText;
                    button.style.background = '#007aff';
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy: ', err);
                alert('Copy failed. Please try again.');
            });
        }
        

        
        function filterEvents() {
            const searchTerm = document.getElementById('searchInput').value.toLowerCase();
            const eventCards = document.querySelectorAll('.event-card');
            const sections = document.querySelectorAll('.section');
            let visibleCount = 0;
            
            eventCards.forEach(card => {
                const title = card.querySelector('.event-title')?.textContent.toLowerCase() || '';
                const venue = card.querySelector('.event-detail span')?.textContent.toLowerCase() || '';
                const content = card.textContent.toLowerCase();
                
                const isVisible = searchTerm === '' || 
                                title.includes(searchTerm) || 
                                venue.includes(searchTerm) || 
                                content.includes(searchTerm);
                
                if (isVisible) {
                    card.style.display = 'block';
                    visibleCount++;
                } else {
                    card.style.display = 'none';
                }
            });
            
            // Update section visibility and counts
            sections.forEach(section => {
                const visibleCards = section.querySelectorAll('.event-card[style*="block"], .event-card:not([style*="none"])').length;
                const sectionCount = section.querySelector('.section-count');
                
                if (visibleCards > 0) {
                    section.style.display = 'block';
                    if (sectionCount) {
                        sectionCount.textContent = visibleCards;
                    }
                } else {
                    section.style.display = 'none';
                }
            });
            
            // Show/hide "no results" message
            let noResultsMsg = document.getElementById('noResultsMessage');
            if (visibleCount === 0 && searchTerm !== '') {
                if (!noResultsMsg) {
                    noResultsMsg = document.createElement('div');
                    noResultsMsg.id = 'noResultsMessage';
                    noResultsMsg.innerHTML = \`
                        <div style="
                            background: white;
                            border-radius: 15px;
                            padding: 40px;
                            margin-bottom: 20px;
                            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
                            text-align: center;
                            color: #666;
                        ">
                            <div style="font-size: 48px; margin-bottom: 20px;">🔍</div>
                            <h3 style="margin: 0 0 10px 0; color: #333;">No events found</h3>
                            <p style="margin: 0; font-size: 14px;">Try adjusting your search terms or clearing the search.</p>
                        </div>
                    \`;
                    document.body.appendChild(noResultsMsg);
                }
                noResultsMsg.style.display = 'block';
            } else if (noResultsMsg) {
                noResultsMsg.style.display = 'none';
            }
        }
        
        function clearSearch() {
            document.getElementById('searchInput').value = '';
            filterEvents();
        }
        
        function copyEventJSON(button) {
            const eventJSON = button.getAttribute('data-event-json');
            
            navigator.clipboard.writeText(eventJSON).then(() => {
                const originalText = button.innerHTML;
                button.innerHTML = '✅ Copied!';
                button.style.background = '#28a745';
                
                setTimeout(() => {
                    button.innerHTML = originalText;
                    button.style.background = '#007aff';
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy event JSON: ', err);
                alert('Event JSON copy failed. Please try again.');
            });
        }
        
        function exportAsJSON() {
            const eventCards = document.querySelectorAll('.event-card');
            const exportData = {
                timestamp: new Date().toISOString(),
                summary: {
                    totalEvents: document.querySelector('.stat-value').textContent,
                    bearEvents: document.querySelectorAll('.stat-value')[1].textContent,
                    calendarActions: document.querySelectorAll('.stat-value')[2].textContent
                },
                events: []
            };
            
            eventCards.forEach(card => {
                const title = card.querySelector('.event-title')?.textContent || 'Untitled Event';
                const rawData = card.querySelector('.raw-display')?.textContent || '';
                const action = card.querySelector('.action-badge')?.textContent || 'UNKNOWN';
                
                // Try to parse raw data for structured information
                let eventData = { title, action, rawData };
                
                // Extract key information from the card
                const eventDetails = card.querySelectorAll('.event-detail');
                eventDetails.forEach(detail => {
                    const spans = detail.querySelectorAll('span');
                    if (spans.length >= 2) {
                        const key = spans[0].textContent.trim();
                        const value = spans[1].textContent.trim();
                        
                        // Map emoji keys to readable names
                        const keyMapping = {
                            '📍': 'venue',
                            '📅': 'date',
                            '🕐': 'time',
                            '📱': 'calendar',
                            '☕': 'tea',
                            '📸': 'instagram',
                            '👥': 'facebook',
                            '🌐': 'website',
                            '🗺️': 'googleMaps',
                            '💵': 'price'
                        };
                        
                        const mappedKey = keyMapping[key] || key;
                        eventData[mappedKey] = value;
                    }
                });
                
                exportData.events.push(eventData);
            });
            
            const jsonString = JSON.stringify(exportData, null, 2);
            
            // Copy to clipboard (modern iOS WebView supports this)
            navigator.clipboard.writeText(jsonString).then(() => {
                const button = event.target;
                const originalText = button.innerHTML;
                button.innerHTML = '✅ JSON Copied!';
                button.style.background = '#28a745';
                
                setTimeout(() => {
                    button.innerHTML = originalText;
                    button.style.background = '#34c759';
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy JSON: ', err);
                alert('JSON copy failed. Please try again.');
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
        /*
         * EVENT OBJECT LIFECYCLE DOCUMENTATION
         * ===================================
         * 
         * This function displays events that have gone through the following lifecycle:
         * 
         * 1. PARSING PHASE:
         *    - Events are scraped from external sources (Eventbrite, Facebook, etc.)
         *    - Raw data is parsed into standardized event objects
         *    - Basic fields are extracted: title, startDate, endDate, venue, etc.
         *    - Events get a unique 'key' for deduplication
         * 
         * 2. ANALYSIS PHASE (by shared-core.js):
         *    - Events are compared against existing calendar events
         *    - Each event gets an '_action' field indicating what should happen:
         *      • 'new': Brand new event, add to calendar
         *      • 'merge': Similar event exists, merge additional info
         *      • 'update': Event exists but needs updates
         *      • 'conflict': Multiple matching events found, needs review
         *      • 'missing_calendar': Target calendar doesn't exist
         * 
         * 3. MERGE STRATEGY APPLICATION:
         *    - For merge actions, field-level merge strategies are applied:
         *      • 'clobber': New value overwrites existing
         *      • 'preserve': Keep existing value, ignore new
         *      • 'upsert': Update if new value is better/longer
         *    - Results stored in '_fieldMergeStrategies' and applied to create merged fields
         * 
         * 4. ENRICHMENT PHASE:
         *    - Additional metadata is added for display and debugging:
         *      • '_original': Contains both 'new' and 'existing' event data
         *      • '_mergeDiff': Shows what was preserved/added/updated/removed
         *      • '_mergedNotes': Final notes after merge strategy application
         *      • '_existingEvent': Reference to the calendar event being merged with
         *      • '_conflicts': Array of conflicting events for manual review
         * 
         * 5. DISPLAY PHASE (this function):
         *    - Events are rendered in the UI with their action badges
         *    - Comparison tables show before/after for merge operations
         *    - Raw JSON is displayed with all debugging information
         *    - Individual copy buttons allow copying specific event data
         * 
         * 6. SAVING PHASE (executeCalendarActions):
         *    - Events are processed based on their '_action' field:
         *      • 'new': Create new CalendarEvent and save to iOS Calendar
         *      • 'merge': Update existing event with merged notes/url/location, then save
         *      • 'update': Replace existing event fields entirely, then save
         *      • 'conflict': Skip - requires manual review
         *    - Calendar mapping determines which iOS calendar to use (chunky-dad-{city})
         *    - Actual iOS Calendar.save() calls persist changes to device calendar
         * 
         * REDUNDANCIES IN EVENT OBJECT:
         * - 'location' field appears both as GPS coordinates AND in 'googleMapsLink'
         * - 'venue' info duplicated in 'notes' field and top-level 'venue' field
         * - 'url' appears both as top-level field AND in 'notes' as "url: ..."
         * - 'instagram' appears both as top-level field AND in 'notes' as "instagram: ..."
         * - 'image' URL stored separately but also embedded in 'notes' as "image: ..."
         * - 'shortTitle' often duplicates or abbreviates the main 'title'
         * - 'address' and 'coordinates' contain overlapping location data
         * - '_mergedNotes' and 'notes' can contain similar information post-merge
         * 
         * FIELD FILTERING FOR DISPLAY:
         * - Functions are completely hidden from comparison tables
         * - Raw JSON shows full object including all internal fields for debugging
         * - Circular references are simplified to prevent JSON errors
         * 
         * EXAMPLE EVENT STRUCTURE (as displayed):
         * {
         *   "title": "MEGAWOOF",
         *   "startDate": "2025-08-17T05:00:00.000Z",
         *   "endDate": "2025-08-17T10:00:00.000Z",
         *   "venue": "TBA",
         *   "city": "la",
         *   "key": "megawoof|2025-08-17|tba",
         *   "_action": "merge",
         *   "_parserConfig": { "name": "Megawoof America", "parser": "eventbrite" },
         *   "_existingEvent": { "title": "Megawoof: DURO", "identifier": "..." },
         *   "isBearEvent": true,
         *   "source": "eventbrite"
         * }
         */
        
        const actionBadge = {
            'new': '<span class="action-badge badge-new">NEW</span>',
            'merge': '<span class="action-badge badge-merge">MERGE</span>',
            'conflict': '<span class="action-badge badge-warning">CONFLICT</span>',
            'missing_calendar': '<span class="action-badge badge-error">MISSING CALENDAR</span>'
        }[event._action] || '';
        
        const eventDate = new Date(event.startDate);
        const endDate = event.endDate ? new Date(event.endDate) : null;
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
        const endTimeStr = endDate ? endDate.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit' 
        }) : '';
        
        // For merged events, use the merged notes which contain the preserved description
        const notes = (event._action === 'merge' && event._mergedNotes) ? event._mergedNotes : (event.notes || '');
        const calendarName = this.getCalendarNameForDisplay(event);
        
        let html = `
        <div class="event-card">
            ${actionBadge}
            <div class="event-title">${this.escapeHtml(event.title || event.name)}</div>
            
            <!-- Main Event Info -->
            <div class="event-details">
                ${event.venue || event.bar ? `
                    <div class="event-detail">
                        <span>📍</span>
                        <span>${this.escapeHtml(event.venue || event.bar)}</span>
                    </div>
                ` : ''}
                <div class="event-detail">
                    <span>📅</span>
                    <span>${dateStr} ${timeStr}${endTimeStr ? ` - ${endTimeStr}` : ''}</span>
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
                ${event.tea ? `
                    <div class="event-detail" style="background: #e8f5e9; padding: 8px; border-radius: 5px; margin-top: 8px;">
                        <span>☕</span>
                        <span style="font-style: italic;">${this.escapeHtml(event.tea)}</span>
                    </div>
                ` : ''}
                ${event.instagram ? `
                    <div class="event-detail">
                        <span>📸</span>
                        <span><a href="${this.escapeHtml(event.instagram)}" style="color: #007aff;">Instagram</a></span>
                    </div>
                ` : ''}
                ${event.facebook ? `
                    <div class="event-detail">
                        <span>👥</span>
                        <span><a href="${this.escapeHtml(event.facebook)}" style="color: #007aff;">Facebook</a></span>
                    </div>
                ` : ''}
                ${event.website ? `
                    <div class="event-detail">
                        <span>🌐</span>
                        <span><a href="${this.escapeHtml(event.website)}" style="color: #007aff;">Website</a></span>
                    </div>
                ` : ''}
                ${event.gmaps || event.googleMapsLink ? `
                    <div class="event-detail">
                        <span>🗺️</span>
                        <span><a href="${this.escapeHtml(event.gmaps || event.googleMapsLink)}" style="color: #007aff;">Google Maps</a></span>
                    </div>
                ` : ''}
                ${event.price ? `
                    <div class="event-detail">
                        <span>💵</span>
                        <span>${this.escapeHtml(event.price)}</span>
                    </div>
                ` : ''}
            </div>
            
            <!-- Show comparison for all non-new events with original data -->
            ${event._original && event._action !== 'new' ? (() => {
                const hasDifferences = this.hasEventDifferences(event);
                const eventId = event.key || Math.random();
                const isExpanded = hasDifferences; // Auto-expand if there are differences
                
                return `
                <div style="margin-top: 15px; border-top: 1px solid #e0e0e0; padding-top: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; cursor: pointer;"
                         onclick="toggleComparisonSection('${eventId}')">
                        <h4 style="margin: 0; font-size: 14px;">
                            <span id="expand-icon-${eventId}" style="display: inline-block; width: 20px; transition: transform 0.2s;">
                                ${isExpanded ? '▼' : '▶'}
                            </span>
                            📊 ${event._action === 'conflict' ? 'Conflict Resolution' : 'Merge Comparison'}
                            ${hasDifferences ? '<span style="color: #ff9500; font-size: 12px; margin-left: 8px;">• Has changes</span>' : ''}
                        </h4>
                        <button onclick="event.stopPropagation(); toggleDiffView(this, '${eventId}');" 
                                style="padding: 4px 10px; font-size: 11px; background: #007aff; color: white; border: none; border-radius: 4px; cursor: pointer; ${!isExpanded ? 'display: none;' : ''}"
                                id="diff-toggle-${eventId}">
                            Switch to Line View
                        </button>
                    </div>
                    
                    <div id="comparison-content-${eventId}" style="${!isExpanded ? 'display: none;' : ''}">
                    <!-- Show what was extracted -->
                    ${event._mergeInfo?.extractedFields && Object.keys(event._mergeInfo.extractedFields).length > 0 ? `
                        <div style="background: #f5f5f5; padding: 10px; border-radius: 5px; margin-bottom: 10px;">
                            <strong style="font-size: 12px;">Extracted from existing event:</strong>
                            ${Object.entries(event._mergeInfo.extractedFields).map(([field, info]) => `
                                <div style="margin-top: 5px; font-size: 12px;">
                                    • <strong>${field}:</strong> "${this.escapeHtml(info.value)}"
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                    
                    <!-- Table view (default) -->
                    <div id="table-view-${eventId}" class="diff-view">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <div style="font-size: 12px; color: #666;">Comparison Table</div>
                            <button onclick="copyEventJSON(this)" 
                                    style="padding: 4px 8px; font-size: 11px; background: #007aff; color: white; border: none; border-radius: 4px; cursor: pointer;"
                                    data-event-json='${this.escapeHtml(JSON.stringify(event, (key, value) => {
                                        if (key === '_parserConfig' && value) {
                                            return { name: value.name, parser: value.parser };
                                        }
                                        if (key === '_existingEvent' && value) {
                                            return { title: value.title, identifier: value.identifier };
                                        }
                                        if (key === '_conflicts' && value && Array.isArray(value)) {
                                            return value.map(c => ({
                                                title: c.title,
                                                startDate: c.startDate,
                                                identifier: c.identifier
                                            }));
                                        }
                                        if (typeof value === 'function') {
                                            return '[Function]';
                                        }
                                        return value;
                                    }, 2))}'>
                                📋 Copy JSON
                            </button>
                        </div>
                        <table style="width: 100%; font-size: 12px; border-collapse: collapse; table-layout: fixed;">
                            <tr>
                                <th style="text-align: left; padding: 5px; border-bottom: 1px solid #ddd; width: 20%;">Field</th>
                                <th style="text-align: left; padding: 5px; border-bottom: 1px solid #ddd; width: 30%;">Existing Event</th>
                                <th style="text-align: center; padding: 5px; border-bottom: 1px solid #ddd; width: 10%;">Flow</th>
                                <th style="text-align: left; padding: 5px; border-bottom: 1px solid #ddd; width: 30%;">New Event</th>
                                <th style="text-align: left; padding: 5px; border-bottom: 1px solid #ddd; width: 10%;">Result</th>
                            </tr>
                            ${this.generateComparisonRows(event)}
                        </table>
                    </div>
                    
                    <!-- Line view (hidden by default) -->
                    <div id="line-view-${eventId}" class="diff-view" style="display: none;">
                        ${this.generateLineDiffView(event)}
                    </div>
                    </div>
                </div>
                `;
            })() : ''}
            
            <!-- Simplified metadata -->
            ${event.key || event.source ? `
                <div class="event-metadata" style="margin-top: 10px; font-size: 11px; color: #666;">
                    ${event.source ? `<span>Source: ${event.source}</span>` : ''}
                    ${event.key ? `<span style="margin-left: 10px;">Key: ${this.escapeHtml(event.key)}</span>` : ''}
                </div>
            ` : ''}
            

            
            ${event._action === 'conflict' && event._conflicts ? `
                <div class="conflict-info">
                    <strong>⚠️ Overlapping Events:</strong> ${event._conflicts.length} event(s) at same time
                    <div style="margin-top: 10px;">
                    ${event._conflicts.map(conflict => {
                        const shouldMerge = event._conflictAnalysis?.find(a => a.event === conflict)?.shouldMerge;
                        return `
                        <div style="background: ${shouldMerge ? '#d4edda' : '#f8d7da'}; padding: 8px; border-radius: 5px; margin-bottom: 5px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <strong>"${this.escapeHtml(conflict.title)}"</strong>
                                    <div style="font-size: 12px; color: #666; margin-top: 2px;">
                                        ${new Date(conflict.startDate).toLocaleString()}
                                    </div>
                                </div>
                                <div style="font-size: 12px; font-weight: 600; color: ${shouldMerge ? '#155724' : '#721c24'};">
                                    ${shouldMerge ? '✓ Will Merge' : '✗ Different Event'}
                                </div>
                            </div>
                        </div>
                        `;
                    }).join('')}
                    </div>
                </div>
            ` : ''}
            

            
            ${event._action === 'missing_calendar' ? `
                <div class="conflict-info">
                    <strong>Calendar "${this.escapeHtml(calendarName)}" not found!</strong>
                    <br>Please create this calendar manually before running the scraper.
                </div>
            ` : ''}
            
            <details style="margin-top: 10px;">
                <summary style="cursor: pointer; font-size: 13px; color: #007aff;">📝 View Calendar Notes Preview</summary>
                <div class="notes-preview">
                    ${(() => {
                        // Parse and format notes for better readability
                        const lines = notes.split('\n');
                        let formattedHtml = '';
                        let inDescription = true;
                        
                        lines.forEach(line => {
                            if (line.includes(':') && !inDescription) {
                                // This is a metadata field
                                const [key, ...valueParts] = line.split(':');
                                const value = valueParts.join(':').trim();
                                formattedHtml += `<div style="margin: 2px 0;"><strong style="color: #666;">${this.escapeHtml(key)}:</strong> ${this.escapeHtml(value)}</div>`;
                            } else if (line.trim() === '') {
                                formattedHtml += '<br>';
                                inDescription = false;
                            } else {
                                // Part of description
                                formattedHtml += `<div style="margin: 2px 0;">${this.escapeHtml(line)}</div>`;
                            }
                        });
                        
                        return formattedHtml || '<em>No notes</em>';
                    })()}
                </div>
            </details>
            
            ${event._action === 'merge' && event._mergedNotes !== event.notes ? `
            <details style="margin-top: 10px;">
                <summary style="cursor: pointer; font-size: 13px; color: #ff9500;">🔄 Compare Original vs Merged Notes</summary>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px;">
                    <div style="background: #fff3cd; padding: 10px; border-radius: 5px;">
                        <strong>Original Notes (New Event):</strong>
                        <pre style="font-size: 11px; margin: 5px 0; white-space: pre-wrap;">${this.escapeHtml(event.notes || 'No notes')}</pre>
                    </div>
                    <div style="background: #d4edda; padding: 10px; border-radius: 5px;">
                        <strong>Merged Notes (Final):</strong>
                        <pre style="font-size: 11px; margin: 5px 0; white-space: pre-wrap;">${this.escapeHtml(event._mergedNotes || 'No notes')}</pre>
                    </div>
                </div>
            </details>
            ` : ''}
            

            
            <div class="raw-display">
                <pre style="font-size: 11px; background: #333; color: #fff; padding: 10px; border-radius: 5px; overflow-x: auto;">${this.escapeHtml(JSON.stringify(event, (key, value) => {
                    // Keep full object for debugging, only filter out circular references and functions
                    if (key === '_parserConfig' && value) {
                        return { name: value.name, parser: value.parser };
                    }
                    if (key === '_existingEvent' && value) {
                        return { title: value.title, identifier: value.identifier };
                    }
                    if (key === '_conflicts' && value && Array.isArray(value)) {
                        return value.map(c => ({
                            title: c.title,
                            startDate: c.startDate,
                            identifier: c.identifier
                        }));
                    }
                    if (typeof value === 'function') {
                        return '[Function]'; // Show functions exist but don't break JSON
                    }
                    return value;
                }, 2))}</pre>
                <div style="margin-top: 8px; text-align: right;">
                    <button onclick="copyEventJSON(this)" 
                            style="padding: 4px 8px; font-size: 11px; background: #007aff; color: white; border: none; border-radius: 4px; cursor: pointer;"
                            data-event-json='${this.escapeHtml(JSON.stringify(event, (key, value) => {
                                if (key === '_parserConfig' && value) {
                                    return { name: value.name, parser: value.parser };
                                }
                                if (key === '_existingEvent' && value) {
                                    return { title: value.title, identifier: value.identifier };
                                }
                                if (key === '_conflicts' && value && Array.isArray(value)) {
                                    return value.map(c => ({
                                        title: c.title,
                                        startDate: c.startDate,
                                        identifier: c.identifier
                                    }));
                                }
                                if (typeof value === 'function') {
                                    return '[Function]';
                                }
                                return value;
                            }, 2))}'>
                        📋 Copy JSON
                    </button>
                </div>
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
        
        // Generic pattern detection for events with complex text formatting
        // This helps merge events that have variations like "A>B>C", "A-B-C", "A B C"
        const hasComplexPattern = (text) => {
            // Check if text has letters separated by special characters
            return /[a-z][\s\>\<\-\.\,\!\@\#\$\%\^\&\*\(\)\_\+\=\{\}\[\]\|\\\:\;\"\'\?\/]+[a-z]/i.test(text);
        };
        
        const normalizeComplexText = (text) => {
            return text
                // Replace sequences of special chars between letters with a single hyphen
                .replace(/([a-z])[\s\>\<\-\.\,\!\@\#\$\%\^\&\*\(\)\_\+\=\{\}\[\]\|\\\:\;\"\'\?\/]+([a-z])/gi, '$1-$2')
                // Remove trailing special characters after words
                .replace(/([a-z])[\!\@\#\$\%\^\&\*\(\)\_\+\=\{\}\[\]\|\\\:\;\"\'\?\,\.]+(?=\s|$)/gi, '$1')
                // Collapse multiple spaces/hyphens into single hyphen
                .replace(/[\s\-]+/g, '-')
                // Remove leading/trailing hyphens
                .replace(/^-+|-+$/g, '');
        };
        
        // Check if both titles have complex patterns that normalize to the same value
        if (hasComplexPattern(existingTitle) || hasComplexPattern(newTitle) || hasComplexPattern(newOriginalTitle)) {
            const normalizedExisting = normalizeComplexText(existingTitle);
            const normalizedNew = normalizeComplexText(newTitle);
            const normalizedNewOriginal = normalizeComplexText(newOriginalTitle);
            
            if (normalizedExisting === normalizedNew || normalizedExisting === normalizedNewOriginal) {
                console.log(`📱 Scriptable: Complex pattern match detected - should merge:`);
                console.log(`   Normalized existing: "${normalizedExisting}"`);
                console.log(`   Normalized new: "${normalizedNew}"`);
                return true;
            }
        }
        
        // Check for exact title matches (case insensitive) - check both titles
        if (existingTitle === newTitle || (newOriginalTitle && existingTitle === newOriginalTitle)) {
            console.log(`📱 Scriptable: Exact title match - should merge: "${existingEvent.title}" vs "${newTitle}"`);
            return true;
        }
        
        console.log(`📱 Scriptable: No merge criteria met`);
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




    // Helper to get calendar name for display purposes only
    getCalendarNameForDisplay(event) {
        const city = event.city || 'default';
        return this.calendarMappings[city] || `chunky-dad-${city}`;
    }
    
    // Check if event has actual differences to show
    hasEventDifferences(event) {
        if (!event._original) return false;
        
        // Get all fields that would be included in the calendar event, using the same logic as formatEventNotes
        const fieldsToCheck = this.getFieldsForComparison(event);
        
        for (const field of fieldsToCheck) {
            let newValue = event._original.new[field] || '';
            let existingValue = event._original.existing?.[field] || '';
            
            // Check if field was extracted from notes
            if (!existingValue && event._mergeInfo?.extractedFields?.[field]) {
                existingValue = event._mergeInfo.extractedFields[field].value;
            }
            
            // Skip empty fields
            if (!newValue && !existingValue) continue;
            
            // Check for differences
            if (newValue !== existingValue) {
                return true;
            }
        }
        
        return false;
    }

    // Get all fields that should be compared/displayed - check ALL fields except underscore fields and functions
    getFieldsForComparison(event) {
        // Get all fields from both new and existing events
        const allFields = new Set();
        
        // Helper function to check if a field should be included
        const shouldIncludeField = (obj, field) => {
            if (field.startsWith('_')) return false;
            if (typeof obj[field] === 'function') return false;
            return true;
        };
        
        // Add fields from new event
        if (event._original?.new) {
            Object.keys(event._original.new).forEach(field => {
                if (shouldIncludeField(event._original.new, field)) {
                    allFields.add(field);
                }
            });
        }
        
        // Add fields from existing event
        if (event._original?.existing) {
            Object.keys(event._original.existing).forEach(field => {
                if (shouldIncludeField(event._original.existing, field)) {
                    allFields.add(field);
                }
            });
        }
        
        // Add fields from extracted fields
        if (event._mergeInfo?.extractedFields) {
            Object.keys(event._mergeInfo.extractedFields).forEach(field => {
                if (!field.startsWith('_')) {
                    allFields.add(field);
                }
            });
        }
        
        // Add fields from final event
        Object.keys(event).forEach(field => {
            if (shouldIncludeField(event, field)) {
                allFields.add(field);
            }
        });
        
        // Convert to array and sort for consistent display
        return Array.from(allFields).sort();
    }
    
    // Generate comparison rows for conflict display
    generateComparisonRows(event) {
        if (!event._original) return '';
        
        // Use the same field logic as what goes into calendar notes
        const fieldsToCompare = this.getFieldsForComparison(event);
        const rows = [];
        
        fieldsToCompare.forEach(field => {
            let newValue = event._original.new[field] || '';
            let existingValue = event._original.existing?.[field] || '';
            const finalValue = event[field] || '';
            const strategy = event._fieldMergeStrategies?.[field] || 'preserve';
            const wasUsed = event._mergeInfo?.mergedFields?.[field];
            
            // Check if this field was extracted from existing event's notes
            if (!existingValue && event._mergeInfo?.extractedFields?.[field]) {
                existingValue = event._mergeInfo.extractedFields[field].value;
            }
            
            // Skip if both are empty and no final value
            if (!newValue && !existingValue && !finalValue) return;
            
            // Format values for display
            const formatValue = (val, maxLength = 30) => {
                if (!val) return '<em style="color: #999;">empty</em>';
                if (field.includes('Date') && val) {
                    return new Date(val).toLocaleString('en-US', { 
                        month: 'short', 
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit'
                    });
                }
                const str = val.toString();
                if (str.length > maxLength) {
                    return `<span title="${this.escapeHtml(str)}">${this.escapeHtml(str.substring(0, maxLength))}...</span>`;
                }
                return this.escapeHtml(str);
            };
            
            // Determine flow direction and result
            let flowIcon = '';
            let resultText = '';
            
            if (!existingValue && newValue) {
                // New field being added
                flowIcon = '→';
                resultText = '<span style="color: #34c759;">ADDED</span>';
            } else if (existingValue && newValue && existingValue === newValue) {
                // Both values are identical - no change needed
                flowIcon = '—';
                resultText = '<span style="color: #999;">NO CHANGE</span>';
            } else if (wasUsed === 'existing') {
                // Merge strategy explicitly chose existing value
                flowIcon = '←';
                resultText = '<span style="color: #007aff;">EXISTING</span>';
            } else if (finalValue === newValue) {
                // Replaced with new value
                flowIcon = '→';
                resultText = '<span style="color: #ff9500;">NEW</span>';
            } else if (finalValue && finalValue !== existingValue && finalValue !== newValue) {
                // Merged/combined value
                flowIcon = '↔';
                resultText = '<span style="color: #32d74b;">MERGED</span>';
            } else {
                flowIcon = '—';
                resultText = '<span style="color: #999;">NO CHANGE</span>';
            }
            
            rows.push(`
                <tr>
                    <td style="padding: 5px; border-bottom: 1px solid #eee; vertical-align: top;">
                        <strong>${field}</strong>
                        <br><small style="color: #666;">${strategy}</small>
                    </td>
                    <td style="padding: 5px; border-bottom: 1px solid #eee; word-break: break-word; max-width: 150px;">
                        ${formatValue(existingValue)}
                    </td>
                    <td style="padding: 5px; border-bottom: 1px solid #eee; text-align: center; font-size: 16px; color: #007aff;">
                        ${flowIcon}
                    </td>
                    <td style="padding: 5px; border-bottom: 1px solid #eee; word-break: break-word; max-width: 150px;">
                        ${formatValue(newValue)}
                    </td>
                    <td style="padding: 5px; border-bottom: 1px solid #eee; text-align: center;">
                        ${resultText}
                    </td>
                </tr>
            `);
        });
        
        return rows.join('');
    }
    
    // Generate line-by-line diff view
    generateLineDiffView(event) {
        if (!event._original) return '<p>No comparison data available</p>';
        
        // Use the same field logic as what goes into calendar notes
        const fieldsToCompare = this.getFieldsForComparison(event);
        let html = '<div style="font-family: monospace; font-size: 12px; background: #f8f8f8; padding: 10px; border-radius: 5px;">';
        
        fieldsToCompare.forEach(field => {
            let newValue = event._original.new[field] || '';
            let existingValue = event._original.existing?.[field] || '';
            const finalValue = event[field] || '';
            const strategy = event._fieldMergeStrategies?.[field] || 'preserve';
            
            // Check if this field was extracted from existing event's notes
            if (!existingValue && event._mergeInfo?.extractedFields?.[field]) {
                existingValue = event._mergeInfo.extractedFields[field].value;
            }
            
            // Skip if both are empty and no final value
            if (!newValue && !existingValue && !finalValue) return;
            
            // Format dates
            const formatValue = (val) => {
                if (!val) return '';
                if (field.includes('Date') && val) {
                    return new Date(val).toLocaleString();
                }
                return val.toString();
            };
            
            html += `<div style="margin-bottom: 15px; border-bottom: 1px solid #ddd; padding-bottom: 10px;">`;
            html += `<div style="font-weight: bold; color: #333; margin-bottom: 5px;">${field} (${strategy}):</div>`;
            
            // Determine what happened with this field
            const wasUsed = event._mergeInfo?.mergedFields?.[field];
            const isNew = !existingValue && newValue;
            const isUnchanged = existingValue && !newValue;
            const isReplaced = existingValue && newValue && finalValue === newValue;
            const isKept = existingValue && newValue && finalValue === existingValue;
            const isMerged = existingValue && newValue && finalValue && finalValue !== existingValue && finalValue !== newValue;
            
            // Show git-style diff
            if (isNew) {
                // Only new value exists - show as addition
                html += `<div style="background: #e6ffec; padding: 5px; margin: 2px 0; border-left: 3px solid #34d058;">`;
                html += `<span style="color: #28a745;">+</span> ${this.escapeHtml(formatValue(newValue))}`;
                html += `</div>`;
            } else if (isUnchanged) {
                // Only existing value exists - show as context (orange)
                html += `<div style="background: #fff3cd; padding: 5px; margin: 2px 0; border-left: 3px solid #ffc107;">`;
                html += `<span style="color: #ff9500;"> </span> ${this.escapeHtml(formatValue(existingValue))} <em style="color: #666;">(existing)</em>`;
                html += `</div>`;
            } else if (isReplaced) {
                // Value was replaced - show old as deletion, new as addition
                html += `<div style="background: #ffecec; padding: 5px; margin: 2px 0; border-left: 3px solid #ff6b6b;">`;
                html += `<span style="color: #d73a49;">-</span> ${this.escapeHtml(formatValue(existingValue))}`;
                html += `</div>`;
                html += `<div style="background: #e6ffec; padding: 5px; margin: 2px 0; border-left: 3px solid #34d058;">`;
                html += `<span style="color: #28a745;">+</span> ${this.escapeHtml(formatValue(newValue))}`;
                html += `</div>`;
            } else if (isKept) {
                // New value exists but existing was kept - show both with context
                html += `<div style="background: #fff3cd; padding: 5px; margin: 2px 0; border-left: 3px solid #ffc107;">`;
                html += `<span style="color: #ff9500;"> </span> ${this.escapeHtml(formatValue(existingValue))} <em style="color: #666;">(kept existing)</em>`;
                html += `</div>`;
                html += `<div style="background: #f8f8f8; padding: 5px; margin: 2px 0; border-left: 3px solid #999; opacity: 0.6;">`;
                html += `<span style="color: #999;">~</span> ${this.escapeHtml(formatValue(newValue))} <em style="color: #666;">(new value ignored)</em>`;
                html += `</div>`;
            } else if (isMerged) {
                // Values were merged - show all three
                html += `<div style="background: #ffecec; padding: 5px; margin: 2px 0; border-left: 3px solid #ff6b6b;">`;
                html += `<span style="color: #d73a49;">-</span> ${this.escapeHtml(formatValue(existingValue))}`;
                html += `</div>`;
                html += `<div style="background: #f8f8f8; padding: 5px; margin: 2px 0; border-left: 3px solid #999;">`;
                html += `<span style="color: #999;">~</span> ${this.escapeHtml(formatValue(newValue))} <em style="color: #666;">(proposed)</em>`;
                html += `</div>`;
                html += `<div style="background: #e6ffec; padding: 5px; margin: 2px 0; border-left: 3px solid #34d058;">`;
                html += `<span style="color: #28a745;">+</span> ${this.escapeHtml(formatValue(finalValue))} <em style="color: #666;">(merged result)</em>`;
                html += `</div>`;
            }
            
            html += `</div>`;
        });
        
        html += '</div>';
        return html;
    }

    // Prompt user for calendar execution after displaying results
    async promptForCalendarExecution(analyzedEvents, config) {
        if (!analyzedEvents || analyzedEvents.length === 0) {
            return false;
        }
        
        const alert = new Alert();
        alert.title = "Execute Calendar Actions?";
        
        // Count actions by type
        const actionCounts = {};
        analyzedEvents.forEach(event => {
            const action = event._action || 'unknown';
            actionCounts[action] = (actionCounts[action] || 0) + 1;
        });
        
        let message = "Ready to execute the following calendar actions:\n\n";
        if (actionCounts.new) message += `➕ Create ${actionCounts.new} new events\n`;
        if (actionCounts.merge) message += `🔄 Merge ${actionCounts.merge} events\n`;
        if (actionCounts.update) message += `📝 Update ${actionCounts.update} events\n`;
        if (actionCounts.conflict) message += `⚠️ Skip ${actionCounts.conflict} conflicted events\n`;
        if (actionCounts.missing_calendar) message += `❌ Skip ${actionCounts.missing_calendar} events (missing calendars)\n`;
        
        alert.message = message;
        alert.addAction("Execute");
        alert.addCancelAction("Cancel");
        
        const response = await alert.presentAlert();
        
        if (response === 0) {
            // User selected Execute
            try {
                const processedCount = await this.executeCalendarActions(analyzedEvents, config);
                
                const successAlert = new Alert();
                successAlert.title = "Calendar Updated";
                successAlert.message = `Successfully processed ${processedCount} events.`;
                successAlert.addAction("OK");
                await successAlert.presentAlert();
                
                return processedCount;
            } catch (error) {
                const errorAlert = new Alert();
                errorAlert.title = "Error";
                errorAlert.message = `Failed to update calendar: ${error.message}`;
                errorAlert.addAction("OK");
                await errorAlert.presentAlert();
                
                return 0;
            }
        }
        
        return 0;
    }
}

// Export for Scriptable environment
module.exports = { ScriptableAdapter };
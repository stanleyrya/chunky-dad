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
        this.sharedCore = null; // Will be set by orchestrator
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

    // Calendar Integration - receives pre-formatted calendar events
    async addToCalendar(calendarEvents, config) {
        if (!calendarEvents || calendarEvents.length === 0) {
            console.log('📱 Scriptable: No events to add to calendar');
            return 0;
        }

        try {
            console.log(`📱 Scriptable: Adding ${calendarEvents.length} events to calendar`);
            
            let addedCount = 0;
            const calendarMappings = config.calendarMappings || this.calendarMappings;
            
            for (const event of calendarEvents) {
                try {
                    // Determine calendar name from city
                    const city = event.city || 'default';
                    const calendarName = calendarMappings[city] || `chunky-dad-${city}`;
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
                    
                    // Check for exact duplicates first (same title and time within 1 minute)
                    const exactDuplicate = existingEvents.find(existing => 
                        existing.title === event.title &&
                        this.areDatesEqual(existing.startDate, startDate, 1)
                    );
                    
                    if (exactDuplicate) {
                        console.log(`📱 Scriptable: Skipping exact duplicate event: ${event.title}`);
                        continue;
                    }
                    
                    // Check if we should update an existing event
                    const existingEvent = existingEvents.find(existing => {
                        // Check if this is the same event that needs updating
                        return existing.title === event.title || 
                               (existing.location === event.location && 
                                this.areDatesEqual(existing.startDate, startDate, 60)); // Within 1 hour
                    });
                    
                    if (existingEvent) {
                        // Update existing event
                        console.log(`📱 Scriptable: Updating existing event: ${event.title}`);
                        existingEvent.title = event.title;
                        existingEvent.notes = event.notes;
                        existingEvent.location = event.location;
                        if (event.url) {
                            existingEvent.url = event.url;
                        }
                        await existingEvent.save();
                        addedCount++;
                        continue;
                    }
                    
                    // Create new calendar event
                    const calendarEvent = new CalendarEvent();
                    calendarEvent.title = event.title;
                    calendarEvent.startDate = startDate;
                    calendarEvent.endDate = endDate;
                    calendarEvent.location = event.location;
                    calendarEvent.notes = event.notes;
                    calendarEvent.calendar = calendar;
                    
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
            
            // Notes field content
            const notes = this.sharedCore ? this.sharedCore.formatEventNotes(event) : '';
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
                continue;
            }
            
            try {
                // Check for existing events in the time range
                const { startDate, endDate } = this.sharedCore ? 
                    this.sharedCore.getEventDateRange(event, false) :
                    { startDate: new Date(event.startDate), endDate: new Date(event.endDate || event.startDate) };
                
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

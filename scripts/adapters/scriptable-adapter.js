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
            console.log(`📱 Scriptable: Request options:`, options);
            
            const request = new Request(url);
            request.method = options.method || 'GET';
            request.headers = {
                'User-Agent': this.config.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                ...options.headers
            };
            
            console.log(`📱 Scriptable: Request method: ${request.method}`);
            console.log(`📱 Scriptable: Request headers:`, request.headers);
            
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
            console.log(`📱 Scriptable: Response headers:`, headers);
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
            console.error(`📱 Scriptable: ✗ HTTP request failed for ${url}:`, error);
            console.error(`📱 Scriptable: ✗ HTTP error stack trace:`, error.stack);
            console.error(`📱 Scriptable: ✗ HTTP error name: ${error.name}, message: ${error.message}`);
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
                    console.log(`📱 Scriptable: Files in ${scriptableDir}:`, files);
                } catch (listError) {
                    console.error('📱 Scriptable: ✗ Failed to list directory contents:', listError);
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
            console.error('📱 Scriptable: ✗ Failed to load configuration:', error);
            console.error('📱 Scriptable: ✗ Configuration loading stack trace:', error.stack);
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
                    
                    // Check if event already exists
                    const existingEvents = await CalendarEvent.between(
                        new Date(event.startDate),
                        new Date(event.endDate || event.startDate),
                        [calendar]
                    );
                    
                    const isDuplicate = existingEvents.some(existing => 
                        existing.title === event.title &&
                        Math.abs(existing.startDate.getTime() - new Date(event.startDate).getTime()) < 60000 // Within 1 minute
                    );
                    
                    if (isDuplicate) {
                        console.log(`📱 Scriptable: Skipping duplicate event: ${event.title}`);
                        continue;
                    }
                    
                    // Create new calendar event
                    const calendarEvent = new CalendarEvent();
                    calendarEvent.title = event.title;
                    calendarEvent.startDate = new Date(event.startDate);
                    calendarEvent.endDate = new Date(event.endDate || event.startDate);
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
                    console.error(`📱 Scriptable: ✗ Failed to add event "${event.title}":`, error);
                }
            }
            
            console.log(`📱 Scriptable: ✓ Successfully added ${addedCount} events to calendar`);
            return addedCount;
            
        } catch (error) {
            console.error('📱 Scriptable: ✗ Calendar integration error:', error);
            throw new Error(`Calendar integration failed: ${error.message}`);
        }
    }

    async getOrCreateCalendar(calendarName) {
        try {
            // Try to find existing calendar
            const calendars = await Calendar.forEvents();
            let calendar = calendars.find(cal => cal.title === calendarName);
            
            if (!calendar) {
                // Create new calendar
                console.log(`📱 Scriptable: Creating new calendar: ${calendarName}`);
                calendar = new Calendar();
                calendar.title = calendarName;
                calendar.color = Color.orange(); // Bear-themed color
                await calendar.save();
                console.log(`📱 Scriptable: ✓ Created calendar: ${calendarName}`);
            }
            
            return calendar;
            
        } catch (error) {
            console.error(`📱 Scriptable: ✗ Failed to get/create calendar "${calendarName}":`, error);
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
    async logInfo(component, message, data = null) {
        const logMessage = `ℹ️ ${component}: ${message}`;
        console.log(logMessage);
        if (data) {
            console.log(data);
        }
    }

    async logSuccess(component, message, data = null) {
        const logMessage = `✅ ${component}: ${message}`;
        console.log(logMessage);
        if (data) {
            console.log(data);
        }
    }

    async logWarn(component, message, data = null) {
        const logMessage = `⚠️ ${component}: ${message}`;
        console.log(logMessage);
        if (data) {
            console.log(data);
        }
    }

    async logError(component, message, error = null) {
        const logMessage = `❌ ${component}: ${message}`;
        console.error(logMessage);
        if (error) {
            console.error(error);
        }
    }

    // Results Display
    async displayResults(results) {
        try {
            console.log('\n' + '='.repeat(50));
            console.log('🐻 BEAR EVENT SCRAPER RESULTS');
            console.log('='.repeat(50));
            
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
            
            console.log('\n' + '='.repeat(50));
            
            // Show notification if significant events found
            if (results.bearEvents > 0) {
                const notification = new Notification();
                notification.title = '🐻 Bear Events Found!';
                notification.body = `Found ${results.bearEvents} bear events${results.calendarEvents > 0 ? `, added ${results.calendarEvents} to calendar` : ''}`;
                notification.sound = 'default';
                await notification.schedule();
            }
            
        } catch (error) {
            console.error('📱 Scriptable: Error displaying results:', error);
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
            console.error('Failed to show error alert:', error);
        }
    }
}

// Export for Scriptable environment
this.ScriptableAdapter = ScriptableAdapter;
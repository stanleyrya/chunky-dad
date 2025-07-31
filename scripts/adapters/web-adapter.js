// ============================================================================
// WEB ADAPTER - BROWSER ENVIRONMENT SPECIFIC CODE
// ============================================================================
// ⚠️  AI ASSISTANT WARNING: This file contains Browser/Web ONLY code
//
// ✅ THIS FILE SHOULD CONTAIN:
// ✅ Web APIs (fetch, DOMParser, localStorage, document, window)
// ✅ Browser-specific HTTP requests and DOM operations
// ✅ Web-specific UI and display functionality
//
// ❌ NEVER ADD THESE TO THIS FILE:
// ❌ Scriptable APIs (Request, Calendar, FileManager, Alert, Notification)
// ❌ Business logic (that belongs in shared-core.js)
// ❌ Parsing logic (that belongs in parsers/)
//
// 📖 READ scripts/README.md BEFORE EDITING - Contains full architecture rules
// ============================================================================

class WebAdapter {
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
            console.log(`🌐 Web: Fetching data from ${url}`);
            
            const fetchOptions = {
                method: options.method || 'GET',
                headers: {
                    'User-Agent': this.config.userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    ...options.headers
                },
                signal: AbortSignal.timeout(this.config.timeout)
            };
            
            if (options.body) {
                fetchOptions.body = options.body;
            }
            
            const response = await fetch(url, fetchOptions);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const html = await response.text();
            
            console.log(`🌐 Web: Response status: ${response.status}`);
            console.log(`🌐 Web: Response length: ${html.length} characters`);
            
            if (html && html.length > 0) {
                console.log(`🌐 Web: ✓ Fetched ${html.length} characters of HTML`);
                return {
                    html: html,
                    url: url,
                    statusCode: response.status
                };
            } else {
                throw new Error(`Empty response from ${url}`);
            }
            
        } catch (error) {
            console.error(`🌐 Web: ✗ Failed to fetch ${url}:`);
            this._logErrorDetails(error, '🌐 Web: ✗');
            throw new Error(`HTTP request failed: ${error.message}`);
        }
    }

    // Configuration Loading
    async loadConfiguration() {
        try {
            console.log('🌐 Web: Loading configuration from scraper-input.json');
            
            // Try to load from same directory as script
            const response = await fetch('./scraper-input.json');
            
            if (!response.ok) {
                throw new Error(`Configuration file not found: ${response.status} ${response.statusText}`);
            }
            
            const config = await response.json();
            
            console.log('🌐 Web: ✓ Configuration loaded successfully');
            console.log(`🌐 Web: Found ${config.parsers?.length || 0} parser configurations`);
            
            return config;
            
        } catch (error) {
            console.error('🌐 Web: ✗ Failed to load configuration:');
            this._logErrorDetails(error, '🌐 Web: ✗');
            throw new Error(`Configuration loading failed: ${error.message}`);
        }
    }

    // Calendar Integration (Web version - display only, no actual calendar writes)
    async addToCalendar(events, parserConfig) {
        if (!events || events.length === 0) {
            console.log('🌐 Web: No events to add to calendar');
            return 0;
        }

        try {
            console.log(`🌐 Web: Would add ${events.length} events to calendar (web environment - display only)`);
            
            // In web environment, we can't actually write to calendar
            // Instead, we could generate .ics files or display the events
            this.displayCalendarEvents(events, parserConfig);
            
            // Return the count as if we added them (for consistency with Scriptable)
            return events.length;
            
        } catch (error) {
            console.error('🌐 Web: ✗ Calendar display error:');
            this._logErrorDetails(error, '🌐 Web: ✗');
            throw new Error(`Calendar display failed: ${error.message}`);
        }
    }

    displayCalendarEvents(events, parserConfig) {
        console.log(`🌐 Web: Calendar Events for ${parserConfig.name}:`);
        
        events.forEach((event, index) => {
            console.log(`📅 Event ${index + 1}:`);
            console.log(`   Title: ${event.title}`);
            console.log(`   Date: ${event.startDate}`);
            console.log(`   Venue: ${event.venue || 'N/A'}`);
            console.log(`   URL: ${event.url || 'N/A'}`);
            console.log('   ---');
        });
    }

    // Generate downloadable .ics file for calendar import
    generateICSFile(events, filename = 'bear-events.ics') {
        const icsContent = this.eventsToICS(events);
        const blob = new Blob([icsContent], { type: 'text/calendar' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log(`🌐 Web: Generated ${filename} for download`);
    }

    eventsToICS(events) {
        const lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Chunky Dad//Bear Event Scraper//EN'
        ];
        
        events.forEach(event => {
            const startDate = new Date(event.startDate).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
            const endDate = event.endDate ? 
                new Date(event.endDate).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z' :
                startDate;
            
            lines.push(
                'BEGIN:VEVENT',
                `DTSTART:${startDate}`,
                `DTEND:${endDate}`,
                `SUMMARY:${event.title}`,
                `DESCRIPTION:${event.description || ''}`,
                `LOCATION:${event.venue || ''}`,
                event.url ? `URL:${event.url}` : '',
                `UID:${event.title}-${startDate}@chunkydad.com`,
                'END:VEVENT'
            );
        });
        
        lines.push('END:VCALENDAR');
        return lines.filter(line => line).join('\r\n');
    }

    // Display/Logging Adapter Implementation
    async logInfo(component, message, data = null) {
        const logMessage = `ℹ️ ${component}: ${message}`;
        console.log(`%c${logMessage}`, 'color: #2196F3');
        if (data) {
            console.log(data);
        }
    }

    async logSuccess(component, message, data = null) {
        const logMessage = `✅ ${component}: ${message}`;
        console.log(`%c${logMessage}`, 'color: #4CAF50');
        if (data) {
            console.log(data);
        }
    }

    async logWarn(component, message, data = null) {
        const logMessage = `⚠️ ${component}: ${message}`;
        console.log(`%c${logMessage}`, 'color: #FF9800');
        if (data) {
            console.log(data);
        }
    }

    // Helper method to properly log error objects in web environment
    _logErrorDetails(error, prefix = '') {
        if (!error) return;
        
        const errorPrefix = prefix ? `${prefix} ` : '';
        console.error(`${errorPrefix}Error name: ${error.name || 'Unknown'}`);
        console.error(`${errorPrefix}Error message: ${error.message || 'No message'}`);
        console.error(`${errorPrefix}Error stack: ${error.stack || 'No stack trace'}`);
        
        // Also log the error object in case there are additional properties
        try {
            const errorObj = JSON.stringify(error, Object.getOwnPropertyNames(error));
            if (errorObj !== '{}') {
                console.error(`${errorPrefix}Error object: ${errorObj}`);
            }
        } catch (stringifyError) {
            console.error(`${errorPrefix}Error object could not be stringified`);
        }
    }

    async logError(component, message, error = null) {
        const logMessage = `❌ ${component}: ${message}`;
        console.error(`%c${logMessage}`, 'color: #F44336');
        if (error) {
            this._logErrorDetails(error);
        }
    }

    // Results Display
    async displayResults(results) {
        try {
            console.log('\n' + '='.repeat(50));
            console.log('%c🐻 BEAR EVENT SCRAPER RESULTS', 'font-size: 16px; font-weight: bold; color: #FF6B35');
            console.log('='.repeat(50));
            
            console.log(`📊 Total Events Found: ${results.totalEvents}`);
            console.log(`🐻 Bear Events: ${results.bearEvents}`);
            console.log(`📅 Calendar Events: ${results.calendarEvents}`);
            
            if (results.errors.length > 0) {
                console.log(`❌ Errors: ${results.errors.length}`);
                results.errors.forEach(error => console.log(`   • ${error}`));
            }
            
            console.log('\n📋 Parser Results:');
            results.parserResults.forEach(result => {
                console.log(`   • ${result.name}: ${result.bearEvents} bear events`);
            });
            
            console.log('\n' + '='.repeat(50));
            
            // Create results display in DOM if possible
            this.createResultsDisplay(results);
            
            // Offer to download .ics file if events found
            if (results.bearEvents > 0) {
                const allEvents = results.parserResults.flatMap(r => r.events || []);
                console.log('🌐 Web: Events available for .ics download');
                
                // You could automatically trigger download or show a button
                // this.generateICSFile(allEvents);
            }
            
        } catch (error) {
            console.error('🌐 Web: Error displaying results:');
            this._logErrorDetails(error, '🌐 Web: ✗');
        }
    }

    createResultsDisplay(results) {
        try {
            // Create or update results display in DOM
            let resultsDiv = document.getElementById('scraper-results');
            if (!resultsDiv) {
                resultsDiv = document.createElement('div');
                resultsDiv.id = 'scraper-results';
                resultsDiv.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: #fff;
                    border: 2px solid #FF6B35;
                    border-radius: 8px;
                    padding: 16px;
                    max-width: 300px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    z-index: 9999;
                    font-family: monospace;
                    font-size: 12px;
                `;
                document.body.appendChild(resultsDiv);
            }
            
            resultsDiv.innerHTML = `
                <h3 style="margin: 0 0 12px 0; color: #FF6B35;">🐻 Bear Events Found</h3>
                <div><strong>Total Events:</strong> ${results.totalEvents}</div>
                <div><strong>Bear Events:</strong> ${results.bearEvents}</div>
                <div><strong>Calendar Events:</strong> ${results.calendarEvents}</div>
                ${results.errors.length > 0 ? `<div style="color: #F44336;"><strong>Errors:</strong> ${results.errors.length}</div>` : ''}
                <div style="margin-top: 12px; font-size: 10px;">
                    ${results.parserResults.map(r => `• ${r.name}: ${r.bearEvents} events`).join('<br>')}
                </div>
                <button onclick="this.parentElement.remove()" style="
                    position: absolute;
                    top: 4px;
                    right: 8px;
                    background: none;
                    border: none;
                    font-size: 16px;
                    cursor: pointer;
                ">×</button>
            `;
            
        } catch (error) {
            console.error('🌐 Web: Error creating results display:');
            this._logErrorDetails(error, '🌐 Web: ✗');
        }
    }

    // Error handling with browser alerts
    async showError(title, message) {
        try {
            // Use browser alert as fallback
            alert(`${title}\n\n${message}`);
            
            // Could also create a custom modal here
            console.error(`🌐 Web: ${title} - ${message}`);
        } catch (error) {
            console.error('Failed to show error alert:');
            this._logErrorDetails(error, '🌐 Web: ✗');
        }
    }
}

// Export for web environment
if (typeof window !== 'undefined') {
    window.WebAdapter = WebAdapter;
} else if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WebAdapter };
}
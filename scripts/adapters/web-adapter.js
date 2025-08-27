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
        
        // Store cities configuration for calendar mapping
        this.cities = config.cities || {};
    }

    // Get calendar name for a city (matching scriptable-adapter pattern)
    getCalendarName(city) {
        if (city && this.cities[city] && this.cities[city].calendar) {
            return this.cities[city].calendar;
        }
        // Return fallback name - system will handle missing calendar appropriately
        return `chunky-dad-${city}`;
    }

    // HTTP Adapter Implementation
    async fetchData(url, options = {}) {
        try {

            
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
            
            if (html && html.length > 0) {
                return {
                    html: html,
                    url: url,
                    statusCode: response.status
                };
            } else {
                throw new Error(`Empty response from ${url}`);
            }
            
        } catch (error) {
            console.log(`🌐 Web: ✗ Failed to fetch ${url}: ${error.message}`);
            throw new Error(`HTTP request failed: ${error.message}`);
        }
    }

    // Configuration Loading
    async loadConfiguration() {
        try {

            
            let config;
            
            // Check if we're in Node.js environment
            if (typeof window === 'undefined' && typeof require !== 'undefined') {
                // Node.js environment - use require to load JS module
                const configPath = require('path').join(__dirname, '..', 'scraper-input.js');
                delete require.cache[require.resolve(configPath)]; // Clear cache for fresh load
                config = require(configPath);
            } else {
                // Browser environment - load JS file and evaluate
                const response = await fetch('./scraper-input.js');
                
                if (!response.ok) {
                    throw new Error(`Configuration file not found: ${response.status} ${response.statusText}`);
                }
                
                const configText = await response.text();
                // Execute the JS file to get the configuration
                eval(configText);
                config = window.scraperConfig;
            }
            


            
            return config;
            
        } catch (error) {
            console.log(`🌐 Web: ✗ Failed to load configuration: ${error.message}`);
            throw new Error(`Configuration loading failed: ${error.message}`);
        }
    }

    // Calendar Integration (Web version - display only, no actual calendar writes)
    async addToCalendar(events, parserConfig) {
        if (!events || events.length === 0) {

            return 0;
        }

        try {

            
            // In web environment, we can't actually write to calendar
            // Instead, we could generate .ics files or display the events
            this.displayCalendarEvents(events, parserConfig);
            
            // Return the count as if we added them (for consistency with Scriptable)
            return events.length;
            
        } catch (error) {
            console.log(`🌐 Web: ✗ Calendar display error: ${error.message}`);
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

    // Get existing events for a specific event (called by shared-core for analysis)
    // In web environment, we can't access real calendar data, so return empty array
    async getExistingEvents(event) {

        return [];
    }

    // Display/Logging Adapter Implementation
    async logInfo(message) {
        console.log(`%cℹ️ ${message}`, 'color: #2196F3');
    }

    async logSuccess(message) {
        console.log(`%c✅ ${message}`, 'color: #4CAF50');
    }

    async logWarn(message) {
        console.warn(`%c⚠️ ${message}`, 'color: #FF9800');
    }



    async logError(message) {
        console.error(`%c❌ ${message}`, 'color: #F44336');
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
            console.log(`🌐 Web: Error displaying results: ${error.message}`);
        }
    }

    createResultsDisplay(results) {
        try {
            // Skip DOM manipulation in Node.js environment
            if (typeof document === 'undefined') {
                console.log('🟢 Node.js: Skipping DOM results display (not available in Node.js)');
                return;
            }
            
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
            console.log(`🌐 Web: Error creating results display: ${error.message}`);
        }
    }

    // Error handling with browser alerts
    async showError(title, message) {
        try {
            // Skip alert in Node.js environment
            if (typeof alert !== 'undefined') {
                alert(`${title}\n\n${message}`);
            } else {
                console.log(`🟢 Node.js: ${title} - ${message}`);
            }
            
            // Could also create a custom modal here
            console.error(`🌐 Web: ${title} - ${message}`);
        } catch (error) {
            console.log(`Failed to show error alert: ${error.message}`);
        }
    }

    // Helper method to extract all events from parser results
    getAllEventsFromResults(results) {
        // Events must be analyzed to have action types - no fallback to raw parser results
        if (!results || !results.analyzedEvents || !Array.isArray(results.analyzedEvents)) {
            throw new Error('No analyzed events available - event analysis must succeed for the system to function');
        }
        
        return results.analyzedEvents;
    }
}

// Export for both environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WebAdapter };
} else if (typeof window !== 'undefined') {
    window.WebAdapter = WebAdapter;
} else {
    // Scriptable environment
    this.WebAdapter = WebAdapter;
}
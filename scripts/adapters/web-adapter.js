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
        this.runtimeConfig = config.runtimeConfig || {};
        this.isNode = typeof window === 'undefined' && typeof require !== 'undefined';
        this.pageCacheConfig = this.normalizePageCacheConfig(this.runtimeConfig.pageCache);

        if (this.isNode) {
            const path = require('path');
            const os = require('os');
            this.fs = require('fs');
            this.path = path;
            this.baseDir = path.join(os.homedir(), '.chunky-dad-scraper');
            this.cacheDir = path.join(this.baseDir, 'cache');
            this.pagesCacheDir = path.join(this.cacheDir, 'pages');
        } else {
            this.fs = null;
            this.path = null;
            this.baseDir = null;
            this.cacheDir = null;
            this.pagesCacheDir = null;
        }
    }
    
    getRunContext() {
        const isNode = typeof window === 'undefined';
        const environment = isNode ? 'node' : 'web';
        return {
            type: 'manual',
            environment,
            trigger: environment
        };
    }

    normalizePageCacheConfig(pageCacheConfig = {}) {
        const ttlDays = Number(pageCacheConfig && pageCacheConfig.ttlDays);
        return {
            enabled: pageCacheConfig?.enabled !== false,
            ttlDays: Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 7
        };
    }

    shouldUsePageCache(url, options = {}) {
        if (!this.isNode || !this.pageCacheConfig.enabled) {
            return false;
        }
        if (options.forceRefresh === true || options.useCache === false) {
            return false;
        }
        if ((options.method || 'GET').toUpperCase() !== 'GET' || options.body) {
            return false;
        }
        return /^https?:\/\//i.test(String(url || ''));
    }

    getTrackingParamPattern() {
        return /^(aff|affix|affiliate|utm_source|utm_medium|utm_campaign|utm_content|utm_term|ref|referral|fbclid|gclid|msclkid|dclid|source|mc_cid|mc_eid)$/i;
    }

    normalizeCacheUrl(url) {
        const parsed = new URL(url);
        const normalized = new URL(parsed.toString());
        normalized.protocol = normalized.protocol.toLowerCase();
        normalized.hostname = normalized.hostname.toLowerCase();

        const keptParams = Array.from(normalized.searchParams.entries())
            .filter(([key]) => !this.getTrackingParamPattern().test(key))
            .sort(([aKey, aValue], [bKey, bValue]) => {
                if (aKey === bKey) {
                    return String(aValue).localeCompare(String(bValue));
                }
                return String(aKey).localeCompare(String(bKey));
            });

        normalized.search = '';
        keptParams.forEach(([key, value]) => normalized.searchParams.append(key, value));

        if (normalized.pathname.length > 1) {
            normalized.pathname = normalized.pathname.replace(/\/+$/, '');
        }

        return normalized.toString();
    }

    sanitizeCachePathPart(value, fallback = '__root__') {
        const normalized = String(value || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 80);
        return normalized || fallback;
    }

    hashString(value) {
        let hash = 0;
        const input = String(value || '');
        for (let i = 0; i < input.length; i += 1) {
            hash = ((hash << 5) - hash) + input.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }

    getPageCachePath(url) {
        const normalizedUrl = this.normalizeCacheUrl(url);
        const parsed = new URL(normalizedUrl);
        const pathSegments = parsed.pathname.split('/').filter(Boolean);
        const sanitizedSegments = pathSegments.map(segment => this.sanitizeCachePathPart(segment));
        const fileStem = sanitizedSegments.length > 0
            ? sanitizedSegments[sanitizedSegments.length - 1]
            : '__root__';
        const directoryParts = [
            this.pagesCacheDir,
            this.sanitizeCachePathPart(parsed.hostname, 'unknown-host'),
            ...sanitizedSegments.slice(0, -1)
        ];
        const queryHash = parsed.search ? `--q-${this.hashString(parsed.search.slice(1))}` : '';
        const fileName = `${fileStem}${queryHash}--${this.hashString(normalizedUrl)}.json`;
        return {
            cachePath: this.path.join(...directoryParts, fileName),
            normalizedUrl
        };
    }

    async ensurePageCacheDir(cachePath) {
        if (!this.fs || !cachePath) {
            return;
        }
        await this.fs.promises.mkdir(this.path.dirname(cachePath), { recursive: true });
    }

    buildCachedResponse(cacheEntry) {
        return {
            html: cacheEntry.html,
            url: cacheEntry.url,
            statusCode: cacheEntry.statusCode,
            headers: cacheEntry.headers || {},
            cache: {
                hit: true,
                stale: false,
                fetchedAt: cacheEntry.fetchedAt,
                expiresAt: cacheEntry.expiresAt,
                normalizedUrl: cacheEntry.normalizedUrl,
                path: cacheEntry.path || null
            }
        };
    }

    async readPageCache(url, options = {}) {
        if (!this.shouldUsePageCache(url, options)) {
            return null;
        }
        try {
            const { cachePath } = this.getPageCachePath(url);
            const exists = await this.fs.promises.access(cachePath).then(() => true).catch(() => false);
            if (!exists) {
                return null;
            }
            const content = await this.fs.promises.readFile(cachePath, 'utf8');
            const cacheEntry = JSON.parse(content);
            if (!cacheEntry || typeof cacheEntry.html !== 'string') {
                return null;
            }
            const expiresAt = Date.parse(cacheEntry.expiresAt || '');
            if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
                return null;
            }
            cacheEntry.path = cachePath;
            console.log(`🟢 Node.js: Using cached page for ${url}`);
            return this.buildCachedResponse(cacheEntry);
        } catch (error) {
            console.log(`🟢 Node.js: Page cache read failed for ${url}: ${error.message}`);
            return null;
        }
    }

    async writePageCache(url, responseData, options = {}) {
        if (!this.shouldUsePageCache(url, options) || !responseData || typeof responseData.html !== 'string') {
            return;
        }
        try {
            const { cachePath, normalizedUrl } = this.getPageCachePath(url);
            await this.ensurePageCacheDir(cachePath);
            const fetchedAt = new Date();
            const expiresAt = new Date(fetchedAt.getTime() + (this.pageCacheConfig.ttlDays * 24 * 60 * 60 * 1000));
            const payload = {
                version: 1,
                type: 'page',
                url,
                normalizedUrl,
                fetchedAt: fetchedAt.toISOString(),
                expiresAt: expiresAt.toISOString(),
                statusCode: responseData.statusCode,
                headers: responseData.headers || {},
                html: responseData.html
            };
            await this.fs.promises.writeFile(cachePath, JSON.stringify(payload), 'utf8');
            responseData.cache = {
                hit: false,
                stale: false,
                fetchedAt: payload.fetchedAt,
                expiresAt: payload.expiresAt,
                normalizedUrl,
                path: cachePath
            };
            console.log(`🟢 Node.js: Cached page for ${url}`);
        } catch (error) {
            console.log(`🟢 Node.js: Page cache write failed for ${url}: ${error.message}`);
        }
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
            const cachedResponse = await this.readPageCache(url, options);
            if (cachedResponse) {
                return cachedResponse;
            }

            const fetchUrl = this.config.corsProxy
                ? `${this.config.corsProxy}${encodeURIComponent(url)}`
                : url;

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
            
            const response = await fetch(fetchUrl, fetchOptions);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const html = await response.text();
            
            if (html && html.length > 0) {
                const responseData = {
                    html: html,
                    url: url,
                    statusCode: response.status,
                    headers: Object.fromEntries(response.headers.entries())
                };
                await this.writePageCache(url, responseData, options);
                return responseData;
            } else {
                console.error(`🌐 Web: ✗ Empty response from ${url}`);
                throw new Error(`Empty response from ${url}`);
            }
            
        } catch (error) {
            const errorMessage = `🌐 Web: ✗ HTTP request failed for ${url}: ${error.message}`;
            console.log(errorMessage);
            throw new Error(`HTTP request failed for ${url}: ${error.message}`);
        }
    }

    // Configuration Loading
    async loadConfiguration() {
        try {
            let config;
            let cities;
            
            // Check if we're in Node.js environment
            if (typeof window === 'undefined' && typeof require !== 'undefined') {
                // Node.js environment - use require to load JS module
                const configPath = require('path').join(__dirname, '..', 'scraper-input.js');
                delete require.cache[require.resolve(configPath)]; // Clear cache for fresh load
                config = require(configPath);
                
                const citiesPath = require('path').join(__dirname, '..', 'scraper-cities.js');
                delete require.cache[require.resolve(citiesPath)]; // Clear cache for fresh load
                cities = require(citiesPath);
            } else {
                // Browser environment - use pre-loaded globals if available (loaded via script tags),
                // otherwise fall back to fetching (only works when page is served from scripts/ directory)
                if (typeof window.scraperConfig !== 'undefined') {
                    config = window.scraperConfig;
                } else {
                    const response = await fetch('./scraper-input.js');
                    
                    if (!response.ok) {
                        throw new Error(`Configuration file not found: ${response.status} ${response.statusText}`);
                    }
                    
                    const configText = await response.text();
                    
                    if (!configText || configText.trim().length === 0) {
                        throw new Error('Configuration file is empty');
                    }
                    
                    // Execute the JS file to get the configuration
                    eval(configText);
                    config = window.scraperConfig;
                }
                
                if (typeof window.scraperCities !== 'undefined') {
                    cities = window.scraperCities;
                } else {
                    const citiesResponse = await fetch('./scraper-cities.js');
                    
                    if (!citiesResponse.ok) {
                        throw new Error(`City configuration file not found: ${citiesResponse.status} ${citiesResponse.statusText}`);
                    }
                    
                    const citiesText = await citiesResponse.text();
                    
                    if (!citiesText || citiesText.trim().length === 0) {
                        throw new Error('City configuration file is empty');
                    }
                    
                    eval(citiesText);
                    cities = window.scraperCities;
                }
            }
            
            // Validate configuration structure
            if (!config.parsers || !Array.isArray(config.parsers)) {
                throw new Error('Configuration missing parsers array');
            }
            
            if (!cities || typeof cities !== 'object') {
                throw new Error('Configuration missing cities data');
            }
            
            config.cities = cities;
            
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
        
        // Show summary for large batches, details for small batches
        if (events.length > 5) {
            console.log(`📅 Summary: ${events.length} events found`);
            const venues = [...new Set(events.map(e => e.venue).filter(Boolean))];
            if (venues.length > 0) {
                console.log(`📍 Venues: ${venues.slice(0, 3).join(', ')}${venues.length > 3 ? ` + ${venues.length - 3} more` : ''}`);
            }
            const dateRange = events.length > 1 ? 
                `${events[0].startDate} to ${events[events.length - 1].startDate}` : 
                events[0].startDate;
            console.log(`📅 Date range: ${dateRange}`);
            console.log('   ---');
        } else {
            events.forEach((event, index) => {
                console.log(`📅 Event ${index + 1}:`);
                console.log(`   Title: ${event.title}`);
                console.log(`   Date: ${event.startDate}`);
                console.log(`   Venue: ${event.venue || 'N/A'}`);
                console.log(`   URL: ${event.url || 'N/A'}`);
                console.log('   ---');
            });
        }
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

    // Results Display - Enhanced with detailed analysis
    async displayResults(results) {
        try {
            // Store results for use in other methods
            this.lastResults = results;
            results.runContext = results.runContext || this.getRunContext();
            console.log(`Run Type: ${results.runContext.type} (${results.runContext.trigger})`);
            
            // Show enhanced display features in console for debugging
            await this.displayEventAnalysis(results);
            await this.displayParserBreakdown(results);
            
            // Show console summary
            console.log('\n' + '='.repeat(60));
            console.log('%c🐻 BEAR EVENT SCRAPER RESULTS', 'font-size: 16px; font-weight: bold; color: #FF6B35');
            console.log('='.repeat(60));
            
            console.log(`📊 Total Events Found: ${results.totalEvents} (all events from all sources)`);
            console.log(`🐻 Raw Bear Events: ${results.rawBearEvents || 'N/A'} (after bear filtering)`);
            if (results.duplicatesRemoved > 0) {
                console.log(`🔄 Duplicates Removed: ${results.duplicatesRemoved}`);
                console.log(`🐻 Final Bear Events: ${results.bearEvents} (${results.rawBearEvents} - ${results.duplicatesRemoved} dupes)`);
            } else {
                console.log(`🐻 Final Bear Events: ${results.bearEvents} (no duplicates found)`);
            }
            console.log(`📅 Calendar Events: ${results.calendarEvents}${results.calendarEvents === 0 ? ' (dry run/preview mode - no events written)' : ''}`);
            
            // Explain the math breakdown
            if (results.totalEvents > results.bearEvents) {
                const pastEvents = results.totalEvents - (results.rawBearEvents || results.bearEvents);
                if (pastEvents > 0) {
                    console.log(`💡 Math Breakdown: ${results.totalEvents} total → ${pastEvents} past events filtered out → ${results.rawBearEvents || results.bearEvents} future bear events${results.duplicatesRemoved > 0 ? ` → ${results.duplicatesRemoved} duplicates removed → ${results.bearEvents} final` : ''}`);
                }
            }
            
            // Show event actions summary if available
            const allEvents = this.getAllEventsFromResults(results);
            if (allEvents && allEvents.length > 0) {
                const actionsCount = {
                    new: 0, add: 0, merge: 0, conflict: 0, enriched: 0
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
                                'conflict': '⚠️', 'enriched': '✨'
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
            
            const deduplicationInfo = results.duplicatesRemoved > 0 ? 
                `<div style="font-size: 12px; color: #666;"><strong>Raw Bear Events:</strong> ${results.rawBearEvents} | <strong>Duplicates removed:</strong> ${results.duplicatesRemoved}</div>` : 
                `<div style="font-size: 12px; color: #666;"><strong>Raw Bear Events:</strong> ${results.rawBearEvents || 'N/A'}</div>`;
            resultsDiv.innerHTML = `
                <h3 style="margin: 0 0 12px 0; color: #FF6B35;">🐻 Bear Events Found</h3>
                <div><strong>Total Events Found:</strong> ${results.totalEvents} (all sources)</div>
                ${deduplicationInfo}
                <div><strong>Final Bear Events:</strong> ${results.bearEvents}${results.duplicatesRemoved > 0 ? ` (${results.rawBearEvents} - ${results.duplicatesRemoved} dupes)` : ''}</div>
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

    // Enhanced Display Methods
    async displayEventAnalysis(results) {
        console.log('\n' + '='.repeat(60));
        console.log('📊 EVENT ANALYSIS & BREAKDOWN');
        console.log('='.repeat(60));
        
        const allEvents = this.getAllEventsFromResults(results);
        if (!allEvents || !allEvents.length) {
            console.log('❌ No event data available for analysis');
            return;
        }

        // Analyze events by city
        const cityBreakdown = {};
        const venueBreakdown = {};
        const dateBreakdown = {};
        
        allEvents.forEach(event => {
            // City analysis
            const city = event.city || 'unknown';
            cityBreakdown[city] = (cityBreakdown[city] || 0) + 1;
            
            // Venue analysis
            const venue = event.venue || 'unknown';
            venueBreakdown[venue] = (venueBreakdown[venue] || 0) + 1;
            
            // Date analysis (by month)
            if (event.startDate) {
                const date = new Date(event.startDate);
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                dateBreakdown[monthKey] = (dateBreakdown[monthKey] || 0) + 1;
            }
        });
        
        console.log('🏙️ Events by City:');
        Object.entries(cityBreakdown)
            .sort(([,a], [,b]) => b - a)
            .forEach(([city, count]) => {
                console.log(`   • ${city}: ${count} events`);
            });
        
        console.log('\n📍 Top Venues:');
        Object.entries(venueBreakdown)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)
            .forEach(([venue, count]) => {
                console.log(`   • ${venue}: ${count} events`);
            });
        
        console.log('\n📅 Events by Month:');
        Object.entries(dateBreakdown)
            .sort(([a], [b]) => a.localeCompare(b))
            .forEach(([month, count]) => {
                console.log(`   • ${month}: ${count} events`);
            });
    }

    async displayParserBreakdown(results) {
        console.log('\n' + '='.repeat(60));
        console.log('🔧 PARSER PERFORMANCE BREAKDOWN');
        console.log('='.repeat(60));
        
        if (!results.parserResults || !results.parserResults.length) {
            console.log('❌ No parser results available');
            return;
        }
        
        results.parserResults.forEach((result, index) => {
            console.log(`\n📋 Parser ${index + 1}: ${result.name}`);
            console.log(`   • Total Events: ${result.totalEvents || 0}`);
            console.log(`   • Bear Events: ${result.bearEvents || 0}`);
            console.log(`   • Success Rate: ${result.totalEvents > 0 ? Math.round((result.bearEvents / result.totalEvents) * 100) : 0}%`);
            
            if (result.errors && result.errors.length > 0) {
                console.log(`   • Errors: ${result.errors.length}`);
                result.errors.forEach(error => {
                    console.log(`     - ${error}`);
                });
            }
        });
    }

    async displaySummaryAndActions(results) {
        console.log('\n' + '='.repeat(60));
        console.log('📋 SUMMARY & RECOMMENDED ACTIONS');
        console.log('='.repeat(60));
        
        const allEvents = this.getAllEventsFromResults(results);
        
        if (results.bearEvents === 0) {
            console.log('⚠️ No bear events found. Consider:');
            console.log('   • Checking bear keyword filters');
            console.log('   • Verifying event sources are active');
            console.log('   • Expanding date range');
            console.log('   • Reviewing parser configurations');
        } else if (results.calendarEvents === 0) {
            console.log('🔒 Dry run mode - events found but not written to calendar');
            console.log('   • Set dryRun: false to enable calendar writes');
            console.log('   • Review event details before enabling writes');
        } else {
            console.log('✅ Events successfully processed');
            console.log(`   • ${results.bearEvents} bear events found`);
            console.log(`   • ${results.calendarEvents} events written to calendar`);
        }
        
        if (results.errors.length > 0) {
            console.log('\n⚠️ Issues to address:');
            results.errors.forEach(error => {
                console.log(`   • ${error}`);
            });
        }
        
        // Show next steps
        console.log('\n🎯 Next Steps:');
        if (results.bearEvents > 0) {
            console.log('   • Review events in calendar app');
            console.log('   • Share .ics file with others');
            console.log('   • Set up automated runs');
        } else {
            console.log('   • Check parser configurations');
            console.log('   • Verify event sources');
            console.log('   • Review bear detection keywords');
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

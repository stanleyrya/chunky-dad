// Bear Event Scraper v2 for Scriptable (First Scraper Version)
// Auto-checks target websites, parses events, and merges into Google Calendars
// Note: No safety mode implementation

// ===== EMBEDDED MINIFIED MODULES =====

// minified-json-file-manager.js
class JsonFileManager{constructor(e,t=!0){this.fileManager=FileManager.iCloud(),this.documentsDirectory=this.fileManager.documentsDirectory(),this.baseFileName=e,this.shouldLogTiming=t}getPath(e){return this.fileManager.joinPath(this.documentsDirectory,e)}async readJsonFile(e){const t=this.getPath(e);if(!this.fileManager.fileExists(t))return null;const i=Date.now(),n=this.fileManager.readString(t),a=Date.now()-i;this.shouldLogTiming&&console.log(`Read ${e} in ${a}ms`);try{return JSON.parse(n)}catch(t){return console.error(`Error parsing JSON from ${e}:`,t),null}}async writeJsonFile(e,t){const i=this.getPath(e),n=Date.now(),a=JSON.stringify(t,null,2);this.fileManager.writeString(i,a);const o=Date.now()-n;this.shouldLogTiming&&console.log(`Wrote ${e} in ${o}ms`)}async deleteJsonFile(e){const t=this.getPath(e);this.fileManager.fileExists(t)&&this.fileManager.remove(t)}async listJsonFiles(e=""){const t=this.fileManager.listContents(this.documentsDirectory);return e?t.filter(t=>t.startsWith(e)&&t.endsWith(".json")):t.filter(e=>e.endsWith(".json"))}async getVersionedFileName(e,t=null){const i=t||new Date,n=`${i.getFullYear()}-${String(i.getMonth()+1).padStart(2,"0")}-${String(i.getDate()).padStart(2,"0")}`;return`${this.baseFileName}-${e}-${n}.json`}async readLatestVersionedFile(e){const t=(await this.listJsonFiles(`${this.baseFileName}-${e}-`)).sort().reverse();return t.length>0?await this.readJsonFile(t[0]):null}async writeVersionedFile(e,t,i=null){const n=await this.getVersionedFileName(e,i);await this.writeJsonFile(n,t)}async cleanupOldVersions(e,t=7){const i=await this.listJsonFiles(`${this.baseFileName}-${e}-`),n=i.sort().reverse();if(n.length>t){const e=n.slice(t);for(const t of e)await this.deleteJsonFile(t)}}}

// minified-file-logger.js
class FileLogger{constructor(e,t=!1){this.logFileName=e,this.debugMode=t,this.fileManager=FileManager.iCloud(),this.documentsDirectory=this.fileManager.documentsDirectory(),this.logPath=this.fileManager.joinPath(this.documentsDirectory,this.logFileName),this.sessionId=Date.now(),this.sessionStartTime=new Date}log(e,t="INFO"){const i=`[${(new Date).toISOString()}] [${t}] [Session:${this.sessionId}] ${e}`;this.debugMode&&console.log(i),this.fileManager.fileExists(this.logPath)||this.fileManager.writeString(this.logPath,""),this.fileManager.writeString(this.logPath,this.fileManager.readString(this.logPath)+i+"\n")}debug(e){this.log(e,"DEBUG")}info(e){this.log(e,"INFO")}warn(e){this.log(e,"WARN")}error(e){this.log(e,"ERROR")}async readLogs(){return this.fileManager.fileExists(this.logPath)?this.fileManager.readString(this.logPath):"No logs found"}async clearLogs(){this.fileManager.fileExists(this.logPath)&&this.fileManager.remove(this.logPath),this.log("Logs cleared")}async getLogSize(){if(!this.fileManager.fileExists(this.logPath))return 0;const e=this.fileManager.readString(this.logPath);return(new TextEncoder).encode(e).length}logSessionStart(e=""){this.log(`Session started${e?` - ${e}`:""}`),this.log(`Session start time: ${this.sessionStartTime.toLocaleString()}`)}logSessionEnd(){const e=new Date,t=e-this.sessionStartTime,i=Math.floor(t/1e3),n=Math.floor(i/60),a=i%60;this.log(`Session ended - Duration: ${n}m ${a}s`),this.log(`Session end time: ${e.toLocaleString()}`)}}

// minified-performance-debugger.js
class PerformanceDebugger{constructor(e=!0,t="performance-debug.log"){this.enabled=e,this.timers=new Map,this.metrics=new Map,this.fileLogger=new FileLogger(t,e)}startTimer(e){this.enabled&&(this.timers.set(e,Date.now()),this.fileLogger.debug(`Timer started: ${e}`))}endTimer(e){if(!this.enabled)return;const t=this.timers.get(e);if(!t)return void this.fileLogger.warn(`Timer not found: ${e}`);const i=Date.now()-t;this.timers.delete(e),this.recordMetric(e,i),this.fileLogger.info(`Timer ended: ${e} - Duration: ${i}ms`)}recordMetric(e,t){if(!this.enabled)return;this.metrics.has(e)||this.metrics.set(e,[]);this.metrics.get(e).push(t)}getMetrics(e){return this.enabled?this.metrics.get(e)||[]:null}getAverageMetric(e){const t=this.getMetrics(e);return t&&t.length>0?t.reduce((e,t)=>e+t,0)/t.length:null}getAllMetrics(){if(!this.enabled)return{};const e={};for(const[t,i]of this.metrics){const n=i.reduce((e,t)=>e+t,0)/i.length;e[t]={count:i.length,average:n,min:Math.min(...i),max:Math.max(...i),total:i.reduce((e,t)=>e+t,0)}}return e}logSummary(){if(!this.enabled)return;const e=this.getAllMetrics();this.fileLogger.info("Performance Summary:"),Object.entries(e).forEach(([e,t])=>{this.fileLogger.info(`  ${e}: avg=${t.average.toFixed(2)}ms, min=${t.min}ms, max=${t.max}ms, count=${t.count}`)})}reset(){this.enabled&&(this.timers.clear(),this.metrics.clear(),this.fileLogger.debug("Performance debugger reset"))}}

// ===== MAIN SCRAPER CLASS =====

class BearEventScraper {
    constructor() {
        this.jsonManager = new JsonFileManager('bear-events', true);
        this.logger = new FileLogger('bear-event-scraper.log', true);
        this.perfDebugger = new PerformanceDebugger(true, 'bear-scraper-performance.log');
        
        // Bear-related keywords for filtering
        this.bearKeywords = [
            'bear', 'bears', 'cub', 'cubs', 'otter', 'otters',
            'woof', 'grr', 'furball', 'bearracuda', 'megawoof',
            'rockstrap', 'underbear', 'bearnight', 'bearpride',
            'bearweek', 'tbru', 'bearcrazy', 'bearparty'
        ];
        
        // City mapping for calendar names
        this.cityCalendarMap = {
            'nyc': 'chunky-dad-nyc',
            'new york': 'chunky-dad-nyc',
            'la': 'chunky-dad-la',
            'los angeles': 'chunky-dad-la',
            'sf': 'chunky-dad-sf',
            'san francisco': 'chunky-dad-sf',
            'chicago': 'chunky-dad-chicago',
            'seattle': 'chunky-dad-seattle',
            'portland': 'chunky-dad-portland',
            'denver': 'chunky-dad-denver',
            'austin': 'chunky-dad-austin',
            'miami': 'chunky-dad-miami',
            'boston': 'chunky-dad-boston',
            'dc': 'chunky-dad-dc',
            'washington': 'chunky-dad-dc'
        };
        
        this.logger.logSessionStart('Bear Event Scraper');
    }
    
    // Load configuration from JSON file
    async loadConfig() {
        this.perfDebugger.startTimer('loadConfig');
        
        const config = await this.jsonManager.readJsonFile('scraper-config.json');
        if (!config) {
            this.logger.warn('No config file found, using default configuration');
            // Default configuration
            return {
                sources: [
                    {
                        name: 'Furball NYC',
                        city: 'nyc',
                        urls: [
                            'https://www.furball.nyc',
                            'https://www.furball.nyc/ticket-information',
                            'https://www.furball.nyc/upcoming-schedule'
                        ],
                        alwaysBear: true
                    },
                    {
                        name: 'Rockbar NYC',
                        city: 'nyc',
                        url: 'https://www.rockbarnyc.com/calendar',
                        allowlist: ['rockstrap', 'underbear'],
                        requireKeywords: true
                    },
                    {
                        name: 'Bearracuda',
                        city: 'multi',
                        url: 'https://bearracuda.com/#events',
                        requireDetailPages: true
                    },
                    {
                        name: 'Megawoof',
                        city: 'multi',
                        url: 'https://www.eventbrite.com/o/megawoof-america-18118978189',
                        requireDetailPages: true
                    }
                ]
            };
        }
        
        this.perfDebugger.endTimer('loadConfig');
        return config;
    }
    
    // Check if text contains bear-related keywords
    containsBearKeywords(text, allowlist = []) {
        if (!text) return false;
        
        const lowerText = text.toLowerCase();
        const allKeywords = [...this.bearKeywords, ...allowlist.map(k => k.toLowerCase())];
        
        return allKeywords.some(keyword => lowerText.includes(keyword));
    }
    
    // Parse event from HTML content
    parseEventFromHTML(html, sourceInfo) {
        // This is a simplified parser - in reality, each source would need custom parsing
        const event = {
            title: '',
            startDate: null,
            endDate: null,
            location: '',
            description: '',
            url: '',
            source: sourceInfo.name,
            city: sourceInfo.city,
            confidence: 'high',
            lastUpdated: new Date().toISOString()
        };
        
        // Extract title (looking for common patterns)
        const titleMatch = html.match(/<h[1-3][^>]*>([^<]+)<\/h[1-3]>/i);
        if (titleMatch) {
            event.title = titleMatch[1].trim();
        }
        
        // Extract date (looking for common date patterns)
        const datePatterns = [
            /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
            /(\w+)\s+(\d{1,2}),?\s+(\d{4})/,
            /(\d{1,2})\s+(\w+)\s+(\d{4})/
        ];
        
        for (const pattern of datePatterns) {
            const dateMatch = html.match(pattern);
            if (dateMatch) {
                // Simplified date parsing
                event.startDate = new Date(dateMatch[0]);
                event.endDate = event.startDate;
                break;
            }
        }
        
        // Extract location
        const locationPatterns = [
            /<(?:address|div class="location"|span class="venue")[^>]*>([^<]+)</i,
            /(?:Location|Venue|Where):\s*([^<\n]+)/i
        ];
        
        for (const pattern of locationPatterns) {
            const locationMatch = html.match(pattern);
            if (locationMatch) {
                event.location = locationMatch[1].trim();
                break;
            }
        }
        
        // If we couldn't parse essential fields, mark as low confidence
        if (!event.title || !event.startDate) {
            event.confidence = 'low';
        }
        
        return event;
    }
    
    // Fetch and parse events from a single URL
    async fetchEventsFromURL(url, sourceInfo) {
        this.perfDebugger.startTimer(`fetch-${url}`);
        this.logger.info(`Fetching events from: ${url}`);
        
        try {
            const request = new Request(url);
            const html = await request.loadString();
            
            const events = [];
            
            // For sources that require detail pages, we need to find links first
            if (sourceInfo.requireDetailPages) {
                const linkPattern = /<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
                let match;
                
                while ((match = linkPattern.exec(html)) !== null) {
                    const [, href, linkText] = match;
                    
                    // Check if this link might be an event
                    if (sourceInfo.alwaysBear || this.containsBearKeywords(linkText, sourceInfo.allowlist || [])) {
                        // Fetch detail page
                        try {
                            const detailUrl = new URL(href, url).toString();
                            const detailRequest = new Request(detailUrl);
                            const detailHtml = await detailRequest.loadString();
                            
                            const event = this.parseEventFromHTML(detailHtml, sourceInfo);
                            event.url = detailUrl;
                            
                            if (event.title && event.startDate) {
                                events.push(event);
                            }
                        } catch (detailError) {
                            this.logger.error(`Error fetching detail page ${href}: ${detailError.message}`);
                        }
                    }
                }
            } else {
                // Parse events directly from the page
                const event = this.parseEventFromHTML(html, sourceInfo);
                event.url = url;
                
                if (sourceInfo.requireKeywords && !sourceInfo.alwaysBear) {
                    // Check if event contains required keywords
                    const eventText = `${event.title} ${event.description}`;
                    if (this.containsBearKeywords(eventText, sourceInfo.allowlist || [])) {
                        events.push(event);
                    }
                } else if (sourceInfo.alwaysBear || event.title) {
                    events.push(event);
                }
            }
            
            this.perfDebugger.endTimer(`fetch-${url}`);
            this.logger.info(`Found ${events.length} events from ${url}`);
            
            return events;
            
        } catch (error) {
            this.perfDebugger.endTimer(`fetch-${url}`);
            this.logger.error(`Error fetching ${url}: ${error.message}`);
            return [];
        }
    }
    
    // Get calendar for a city
    async getCalendarForCity(city) {
        const calendarName = this.cityCalendarMap[city.toLowerCase()];
        if (!calendarName) {
            this.logger.warn(`No calendar mapping for city: ${city}`);
            return null;
        }
        
        const calendars = await Calendar.forEvents();
        const calendar = calendars.find(cal => cal.title === calendarName);
        
        if (!calendar) {
            this.logger.warn(`Calendar not found: ${calendarName}`);
            return null;
        }
        
        return calendar;
    }
    
    // Check if an event already exists in the calendar
    async eventExistsInCalendar(event, calendar) {
        // Search for events on the same day
        const startOfDay = new Date(event.startDate);
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date(event.startDate);
        endOfDay.setHours(23, 59, 59, 999);
        
        const existingEvents = await CalendarEvent.between(startOfDay, endOfDay, [calendar]);
        
        // Check for matching events
        for (const existing of existingEvents) {
            // Simple matching based on title and time
            if (existing.title.toLowerCase() === event.title.toLowerCase()) {
                return existing;
            }
            
            // Check for similar titles (fuzzy matching)
            const titleSimilarity = this.calculateSimilarity(existing.title, event.title);
            if (titleSimilarity > 0.8) {
                return existing;
            }
        }
        
        return null;
    }
    
    // Calculate string similarity (simple implementation)
    calculateSimilarity(str1, str2) {
        const s1 = str1.toLowerCase();
        const s2 = str2.toLowerCase();
        
        if (s1 === s2) return 1;
        
        const longer = s1.length > s2.length ? s1 : s2;
        const shorter = s1.length > s2.length ? s2 : s1;
        
        if (longer.includes(shorter)) return shorter.length / longer.length;
        
        // Simple character overlap
        let matches = 0;
        for (let i = 0; i < shorter.length; i++) {
            if (longer.includes(shorter[i])) matches++;
        }
        
        return matches / longer.length;
    }
    
    // Create or update calendar event
    async syncEventToCalendar(event, calendar) {
        try {
            // Check if event already exists
            const existingEvent = await this.eventExistsInCalendar(event, calendar);
            
            if (existingEvent) {
                this.logger.info(`Updating existing event: ${event.title}`);
                
                // Update fields if they're missing in the existing event
                let updated = false;
                
                if (!existingEvent.location && event.location) {
                    existingEvent.location = event.location;
                    updated = true;
                }
                
                if (!existingEvent.notes && event.description) {
                    existingEvent.notes = event.description;
                    updated = true;
                }
                
                if (updated) {
                    await existingEvent.save();
                    this.logger.info(`Updated event: ${event.title}`);
                }
                
                return { action: 'updated', event: existingEvent };
            } else {
                this.logger.info(`Creating new event: ${event.title}`);
                
                // Create new event
                const calendarEvent = new CalendarEvent();
                calendarEvent.title = event.title;
                calendarEvent.startDate = event.startDate;
                calendarEvent.endDate = event.endDate || event.startDate;
                calendarEvent.location = event.location;
                calendarEvent.notes = `${event.description}\n\nSource: ${event.source}\nURL: ${event.url}`;
                calendarEvent.calendar = calendar;
                
                // Add confidence flag for low-confidence events
                if (event.confidence === 'low') {
                    calendarEvent.notes += '\n\n[not-checked] This event needs verification';
                }
                
                await calendarEvent.save();
                this.logger.info(`Created event: ${event.title}`);
                
                return { action: 'created', event: calendarEvent };
            }
        } catch (error) {
            this.logger.error(`Error syncing event ${event.title}: ${error.message}`);
            return { action: 'error', error: error.message };
        }
    }
    
    // Main scraping function
    async scrapeAllSources() {
        this.logger.info('Starting bear event scraping');
        this.perfDebugger.startTimer('scrapeAllSources');
        
        const config = await this.loadConfig();
        const allEvents = [];
        const results = {
            sources: [],
            totalEvents: 0,
            created: 0,
            updated: 0,
            errors: 0,
            unmatched: []
        };
        
        // Process each source
        for (const source of config.sources) {
            this.logger.info(`Processing source: ${source.name}`);
            
            const sourceResult = {
                name: source.name,
                events: [],
                errors: []
            };
            
            // Handle multiple URLs for a source
            const urls = source.urls || [source.url];
            
            for (const url of urls) {
                try {
                    const events = await this.fetchEventsFromURL(url, source);
                    sourceResult.events.push(...events);
                    allEvents.push(...events);
                } catch (error) {
                    sourceResult.errors.push({
                        url,
                        error: error.message
                    });
                    this.logger.error(`Error processing ${url}: ${error.message}`);
                }
            }
            
            results.sources.push(sourceResult);
        }
        
        results.totalEvents = allEvents.length;
        this.logger.info(`Total events found: ${allEvents.length}`);
        
        // Sync events to calendars
        for (const event of allEvents) {
            const calendar = await this.getCalendarForCity(event.city);
            
            if (!calendar) {
                results.unmatched.push(event);
                continue;
            }
            
            const syncResult = await this.syncEventToCalendar(event, calendar);
            
            switch (syncResult.action) {
                case 'created':
                    results.created++;
                    break;
                case 'updated':
                    results.updated++;
                    break;
                case 'error':
                    results.errors++;
                    break;
            }
        }
        
        // Save results
        await this.jsonManager.writeVersionedFile('results', results);
        
        // Log summary
        this.logger.info('=== Scraping Summary ===');
        this.logger.info(`Total events found: ${results.totalEvents}`);
        this.logger.info(`Events created: ${results.created}`);
        this.logger.info(`Events updated: ${results.updated}`);
        this.logger.info(`Errors: ${results.errors}`);
        this.logger.info(`Unmatched events: ${results.unmatched.length}`);
        
        this.perfDebugger.endTimer('scrapeAllSources');
        this.perfDebugger.logSummary();
        this.logger.logSessionEnd();
        
        return results;
    }
    
    // Create a visual summary for Scriptable
    async createSummaryWidget(results) {
        const widget = new ListWidget();
        widget.backgroundColor = new Color('#1a1a1a');
        
        // Title
        const title = widget.addText('🐻 Bear Events');
        title.font = Font.boldSystemFont(16);
        title.textColor = Color.white();
        
        widget.addSpacer(8);
        
        // Stats
        const stats = [
            { label: 'Found', value: results.totalEvents, color: '#4a90e2' },
            { label: 'Created', value: results.created, color: '#7ed321' },
            { label: 'Updated', value: results.updated, color: '#f5a623' },
            { label: 'Errors', value: results.errors, color: '#d0021b' }
        ];
        
        for (const stat of stats) {
            const row = widget.addStack();
            row.layoutHorizontally();
            
            const label = row.addText(`${stat.label}:`);
            label.font = Font.systemFont(12);
            label.textColor = Color.gray();
            
            row.addSpacer(4);
            
            const value = row.addText(stat.value.toString());
            value.font = Font.boldSystemFont(12);
            value.textColor = new Color(stat.color);
        }
        
        widget.addSpacer(8);
        
        // Last update
        const updateText = widget.addText(`Updated: ${new Date().toLocaleTimeString()}`);
        updateText.font = Font.systemFont(10);
        updateText.textColor = Color.gray();
        
        return widget;
    }
}

// ===== MAIN EXECUTION =====

async function main() {
    const scraper = new BearEventScraper();
    
    try {
        const results = await scraper.scrapeAllSources();
        
        if (config.runsInWidget) {
            const widget = await scraper.createSummaryWidget(results);
            Script.setWidget(widget);
        } else {
            // Show results in app
            const alert = new Alert();
            alert.title = '🐻 Bear Event Scraper';
            alert.message = `Found: ${results.totalEvents} events\nCreated: ${results.created}\nUpdated: ${results.updated}\nErrors: ${results.errors}`;
            
            alert.addAction('View Logs');
            alert.addAction('Done');
            
            const choice = await alert.presentAlert();
            
            if (choice === 0) {
                // View logs
                const logs = await scraper.logger.readLogs();
                QuickLook.present(logs);
            }
        }
        
        Script.complete();
    } catch (error) {
        console.error('Fatal error:', error);
        const alert = new Alert();
        alert.title = 'Error';
        alert.message = error.message;
        await alert.present();
    }
}

// Run the script
await main();